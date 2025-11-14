// /controllers/orderController.js
const mongoose = require("mongoose");
const Order = require("../models/ordermodel/orderModel");
const SubOrder = require("../models/ordermodel/subOrderModel");
const Cart = require("../models/cartModel");
const Product = require("../models/productModel");
const SellerProfile = require("../models/sellerProfile");
const User = require("../models/userModel");
const Coupon = require("../models/couponModel"); // assumes exists
const Dispute = require("../models/ordermodel/disputeModel");
const ReturnRequest = require("../models/ordermodel/returnModel");

// ---------- Helpers (Taxes/Shipping/Coupons/Commission) ----------

// Example tax calc: flat % on taxable items
function calcItemTax({ price, quantity, taxRatePercent = 0, isTaxable = true, discount = 0 }) {
  if (!isTaxable) return 0;
  const base = Math.max(price * quantity - discount, 0);
  return Math.round((base * taxRatePercent) / 100 * 100) / 100;
}
// Simple tracking number generator
function generateTrackingNumber(orderId, sellerId) {
  return `TRK-${orderId.toString().slice(-6)}-${sellerId.toString().slice(-4)}-${Date.now().toString().slice(-5)}`;
}
// Example shipping calc: per item or weight-based (simple per-item here)
function calcItemShipping({ quantity, perItem = 150 }) {
  return (perItem || 0) * quantity;
}

// Apply coupons across cart
async function applyCouponsToCartItems({ items, couponCodes = [] }) {
  if (!couponCodes?.length) return { items, orderLevelDiscount: 0, appliedCoupons: [] };

  const coupons = await Coupon.find({ code: { $in: couponCodes }, isActive: true });
  const appliedCoupons = [];
  let orderLevelDiscount = 0;

  for (const coupon of coupons) {
    // Simple logic: if coupon applies to all, % off merchandise
    if (coupon.scope === "order") {
      const merchandiseTotal = items.reduce((s, it) => s + it.price * it.quantity, 0);
      const discount =
        coupon.type === "percentage"
          ? Math.round(merchandiseTotal * (coupon.value / 100) * 100) / 100
          : Math.min(coupon.value, merchandiseTotal);
      orderLevelDiscount += discount;
      appliedCoupons.push(coupon._id);
    } else if (coupon.scope === "product") {
      // apply to matching products
      for (const it of items) {
        const isMatch =
          (coupon.products?.length && coupon.products.some((p) => p.toString() === it.product._id.toString())) ||
          (coupon.categories?.length && it.product.category && coupon.categories.some((c) => c.toString() === it.product.category.toString()));
        if (isMatch) {
          const itemBase = it.price * it.quantity;
          const d = coupon.type === "percentage" ? Math.round(itemBase * (coupon.value / 100) * 100) / 100 : Math.min(coupon.value, itemBase);
          it._couponDiscount = (it._couponDiscount || 0) + d;
          if (!it.appliedCoupons) it.appliedCoupons = [];
          it.appliedCoupons.push(coupon._id);
        }
      }
      appliedCoupons.push(coupon._id);
    }
  }

  // Cap item discounts by base
  for (const it of items) {
    const maxDisc = it.price * it.quantity;
    if (it._couponDiscount && it._couponDiscount > maxDisc) it._couponDiscount = maxDisc;
  }

  return { items, orderLevelDiscount, appliedCoupons };

}

//  createOrder 

exports.createOrder = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { shippingAddress, notes, couponCodes = [], itemAddresses = [] } = req.body;

    const generateTrackingNumber = () =>
      `TRK-${Date.now()}-${Math.floor(100000 + Math.random() * 900000)}`;

    const requiredFields = ["street", "city", "zip", "country", "phone"];
    const hasAll = shippingAddress && requiredFields.every((f) => shippingAddress[f]);
    if (!hasAll) {
      await session.abortTransaction();
      return res.status(400).json({ message: "Complete shipping address is required" });
    }

    const cart = await Cart.findOne({ user: req.user._id })
      .populate("items.product", "name price quantity inStock status category seller image gallery")
      .populate("items.Seller", "storeName isVerified")
      .session(session);

    if (!cart || cart.items.length === 0) {
      await session.abortTransaction();
      return res.status(400).json({ message: "Cart is empty" });
    }

    for (const item of cart.items) {
      if (!item.product) {
        await session.abortTransaction();
        return res.status(400).json({ message: "A product in cart no longer exists" });
      }
      if (!item.Seller || !item.Seller.isVerified) {
        await session.abortTransaction();
        return res.status(403).json({ message: `Seller for product ${item.product.name} is not verified` });
      }
      if (!item.product.inStock || item.product.status !== "approved") {
        await session.abortTransaction();
        return res.status(400).json({ message: `Product ${item.product.name} is not available` });
      }
      if (item.product.quantity < item.quantity) {
        await session.abortTransaction();
        return res.status(400).json({ message: `Insufficient stock for ${item.product.name}` });
      }
    }

    const pricedItems = cart.items.map((ci) => ({
      product: ci.product,
      Seller: ci.Seller,
      quantity: ci.quantity,
      price: ci.price ?? ci.product.price,
    }));

    const { items: couponApplied, orderLevelDiscount, appliedCoupons } = await applyCouponsToCartItems({
      items: pricedItems,
      couponCodes,
    });

    const orderItems = [];
    const orderLevelTrackingNumbers = new Set();

    for (let idx = 0; idx < couponApplied.length; idx++) {
      const it = couponApplied[idx];
      const perItemDiscount = it._couponDiscount || 0;
      const taxAmount = calcItemTax({ price: it.price, quantity: it.quantity, discount: perItemDiscount });
      const shippingFee = calcItemShipping({ quantity: it.quantity });

      const subtotal = Math.max(it.price * it.quantity - perItemDiscount, 0);

      const perItemAddress = itemAddresses.find(
        (ia) => ia.seller?.toString?.() === it.Seller._id.toString()
      )?.address;

      const trackingNumber = generateTrackingNumber();
      orderLevelTrackingNumbers.add(trackingNumber);

      orderItems.push({
        product: it.product._id,
        seller: it.product.seller,
        quantity: it.quantity,
        price: it.price,
        discount: perItemDiscount,
        subtotal,
        taxAmount,
        shippingFee,
        status: "pending",
        paymentCollectionStatus: "pending",
        appliedCoupons: it.appliedCoupons || [],
        shippingAddress: perItemAddress || undefined,
        image: it.product?.image || (it.product?.gallery?.[0] ?? null),
        trackingNumber,
      });
    }

    const orderDoc = new Order({
      user: req.user._id,
      items: orderItems,
      discounts: Math.round(orderLevelDiscount * 100) / 100,
      taxes: 0,
      shippingFee: 0,
      appliedCoupons,
      paymentMethod: "COD",
      paymentStatus: "pending",
      orderStatus: "pending",
      shippingAddress,
      notes,
      cart: cart._id,
      trackingNumbers: Array.from(orderLevelTrackingNumbers),
    });

    await orderDoc.save({ session });

    const itemsBySeller = {};
    for (const item of orderDoc.items) {
      const sid = item.seller.toString();
      if (!itemsBySeller[sid]) itemsBySeller[sid] = [];
      itemsBySeller[sid].push(item);
    }

    const subOrders = [];
    for (const [sellerId, items] of Object.entries(itemsBySeller)) {
      const so = new SubOrder({
        order: orderDoc._id,
        seller: sellerId,
        items: items.map((it) => ({
          orderItemId: it._id,
          product: it.product,
          quantity: it.quantity,
          price: it.price,
          discount: it.discount,
          subtotal: it.subtotal,
          taxAmount: it.taxAmount,
          shippingFee: it.shippingFee,
          status: it.status,
          trackingNumber: it.trackingNumber || null,
          image: it.image || null,
        })),
        subOrderStatus: "pending",
      });
      await so.save({ session });
      subOrders.push(so);
    }

    for (const item of cart.items) {
      await Product.updateOne(
        { _id: item.product._id, quantity: { $gte: item.quantity } },
        { $inc: { quantity: -item.quantity } },
        { session }
      );
    }

    for (const couponId of appliedCoupons) {
      await Coupon.updateOne(
        { _id: couponId },
        {
          $inc: { usedCount: 1 },
          $push: { userUsage: { user: req.user._id, usedAt: new Date() } }
        },
        { session }
      );
    }

    cart.items = [];
    await cart.save({ session });

    await session.commitTransaction();

    let populatedOrder = await Order.findById(orderDoc._id)
      .populate("items.product", "name image gallery")
      .populate("items.seller", "storeName")
      .populate("appliedCoupons", "code")
      .lean();

    if (populatedOrder?.items?.length) {
      populatedOrder.items = populatedOrder.items.map((it) => {
        const productObj = it.product && typeof it.product === "object" ? it.product : null;
        return {
          ...it,
          product: productObj
            ? {
                ...productObj,
                image: productObj.image || (productObj.gallery?.[0] ?? it.image ?? null),
              }
            : it.product,
        };
      });
    }

    res.status(201).json({ message: "Order created successfully", order: populatedOrder });
  } catch (err) {
    await session.abortTransaction();
    console.error("Error creating order:", err);
    res.status(500).json({ message: "Error creating order", error: err.message });
  } finally {
    session.endSession();
  }
};



// 2) View My Orders
exports.getMyOrders = async (req, res) => {
  try {
    const { from, to, status } = req.query; // date range & status filter optional
    const filter = { user: req.user._id };
    if (status) filter.orderStatus = status;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to);
    }

    const orders = await Order.find(filter)
      .populate("items.product", "name image")
      .populate("items.seller", "storeName")
      .sort({ createdAt: -1 });

    res.json(orders);
  } catch (err) {
    console.error("Error fetching user orders:", err);
    res.status(500).json({ message: "Error fetching orders", error: err.message });
  }
};

// 3) View Order Details
exports.getOrderDetails = async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, user: req.user._id })
      .populate("items.product", "name image features price")
      .populate("items.seller", "storeName logo")
      .populate("appliedCoupons", "code value type scope");
    if (!order) return res.status(404).json({ message: "Order not found" });
    const subOrders = await SubOrder.find({ order: order._id }).populate("seller", "storeName logo");
    res.json({ order, subOrders });
  } catch (err) {
    console.error("Error fetching order details:", err);
    res.status(500).json({ message: "Error fetching order details", error: err.message });
  }
};

// 4) Cancel Order (full cancel if pending)
exports.cancelOrder = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { cancellationReason } = req.body;
    const order = await Order.findOne({ _id: req.params.id, user: req.user._id }).session(session);
    if (!order) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Order not found" });
    }
    if (order.orderStatus !== "pending") {
      await session.abortTransaction();
      return res.status(400).json({ message: "Cannot cancel non-pending order" });
    }

    // Restore product quantities
    for (const item of order.items) {
      await Product.findByIdAndUpdate(item.product, { $inc: { quantity: item.quantity } }, { session });
      item.status = "cancelled";
      item.paymentCollectionStatus = "cancelled";
    }

    order.orderStatus = "cancelled";
    order.paymentStatus = "pending";
    order.cancellationReason = cancellationReason || "Cancelled by user";

    await order.save({ session });

    // Cancel suborders & release holds
    const subOrders = await SubOrder.find({ order: order._id }).session(session);
    for (const so of subOrders) {
      so.subOrderStatus = "cancelled";
      await so.save({ session });
    }

    await session.commitTransaction();
    res.json({ message: "Order cancelled successfully", order });
  } catch (err) {
    await session.abortTransaction();
    console.error("Error cancelling order:", err);
    res.status(500).json({ message: "Error cancelling order", error: err.message });
  } finally {
    session.endSession();
  }
};

// 5) Confirm Delivery (buyer confirms all delivered)
exports.confirmDelivery = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const order = await Order.findOne({ _id: req.params.id, user: req.user._id }).session(session);
    if (!order) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Order not found" });
    }
    if (order.orderStatus !== "processing") {
      await session.abortTransaction();
      return res.status(400).json({ message: "Order not in processing state" });
    }
    const allDelivered = order.items.every((i) => i.status === "delivered");
    if (!allDelivered) {
      await session.abortTransaction();
      return res.status(400).json({ message: "Not all items are delivered" });
    }

    order.orderStatus = "completed";
    order.paymentStatus = "pending";
    order.items.forEach((i) => {
      i.paymentCollectionStatus = i.paymentCollectionStatus === "collected" ? "collected" : "pending";
    });
    await order.save({ session });

    const subOrders = await SubOrder.find({ order: order._id }).session(session);
    for (const so of subOrders) {
      so.subOrderStatus = "completed";
      await so.save({ session });
    }

    await session.commitTransaction();
    res.json({ message: "Delivery confirmed", order });
  } catch (err) {
    await session.abortTransaction();
    console.error("Error confirming delivery:", err);
    res.status(500).json({ message: "Error confirming delivery", error: err.message });
  } finally {
    session.endSession();
  }
};


// 6) Request Partial Return (item-level)
exports.requestReturn = async (req, res) => {
  try {
    const { itemId, quantity, reason } = req.body;
    if (!itemId || !quantity || !reason) {
      return res.status(400).json({ message: "itemId, quantity, reason required" });
    }

    // Trim orderId to avoid CastError from accidental spaces
    const orderId = req.params.id.trim();

    const order = await Order.findOne({ _id: orderId, user: req.user._id });
    if (!order) return res.status(404).json({ message: "Order not found" });

    const item = order.items.id(itemId);
    if (!item) return res.status(404).json({ message: "Order item not found" });
    if (!["delivered"].includes(item.status)) {
      return res.status(400).json({ message: "Only delivered items can be returned" });
    }
    if (quantity > item.quantity) {
      return res.status(400).json({ message: "Invalid quantity" });
    }

    item.status = "return_requested";
    await order.save();

    const subOrder = await SubOrder.findOne({ order: order._id, seller: item.seller });
    const rr = await ReturnRequest.create({
      order: order._id,
      subOrder: subOrder?._id,
      itemId: item._id,
      buyer: req.user._id,
      seller: item.seller,
      quantity,
      reason,
      status: "requested",
      refundAmount: Math.round(((item.subtotal / item.quantity) * quantity) * 100) / 100,
    });

    res.json({ message: "Return requested", returnRequest: rr });
  } catch (err) {
    console.error("Error requesting return:", err);
    res.status(500).json({ message: "Error requesting return", error: err.message });
  }
};


// BUY NOW CONTROLLER (updated to always return a non-null product.image in the response)
exports.buyNow = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { productId, quantity = 1, shippingAddress, notes = "", couponCodes = [] } = req.body;

    // ✅ Validate shipping address
    const requiredFields = ["street", "city", "zip", "country", "phone"];
    const hasAll = shippingAddress && requiredFields.every((f) => shippingAddress[f]);
    if (!hasAll) {
      await session.abortTransaction();
      return res.status(400).json({ message: "Complete shipping address is required" });
    }

    // ✅ Fetch product with seller
    const product = await Product.findById(productId).populate("seller").session(session);
    if (!product) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Product not found" });
    }

    const sellerProfile = product.seller;
    if (!sellerProfile || (typeof sellerProfile.isVerified !== "undefined" && !sellerProfile.isVerified)) {
      await session.abortTransaction();
      return res.status(403).json({ message: "Seller for this product is not verified" });
    }

    // ✅ Stock check
    const availableQty = product.quantity ?? product.stock ?? 0;
    if (!product.inStock || product.status === "draft" || availableQty < quantity) {
      await session.abortTransaction();
      return res.status(400).json({ message: "Product not available or insufficient stock" });
    }

    // ✅ Build cart-like structure for coupons
    const cartLikeItems = [
      {
        product,
        Seller: sellerProfile,
        quantity,
        price: product.price,
      },
    ];

    // ✅ Apply coupons
    const {
      items: couponAppliedItems,
      orderLevelDiscount = 0,
      appliedCoupons = [],
    } = await applyCouponsToCartItems({ items: cartLikeItems, couponCodes });

    // ✅ Build order items
    const orderItems = [];
    for (const it of couponAppliedItems) {
      const perItemDiscount = it._couponDiscount || 0;
      const taxAmount = calcItemTax({
        price: it.price,
        quantity: it.quantity,
        discount: perItemDiscount,
      });
      const shippingFee = calcItemShipping({ quantity: it.quantity });

      const subtotal = Math.max(it.price * it.quantity - perItemDiscount, 0);

      orderItems.push({
        product: it.product._id,
        seller: it.Seller._id,
        quantity: it.quantity,
        price: it.price,
        discount: perItemDiscount,
        subtotal,
        taxAmount,
        shippingFee,
        status: "pending",
        paymentCollectionStatus: "pending",
        appliedCoupons: it.appliedCoupons || [],
        shippingAddress,
      });
    }

    // ✅ Totals
    const itemsTotal = orderItems.reduce((s, i) => s + (i.subtotal || 0), 0);
    const taxesTotal = orderItems.reduce((s, i) => s + (i.taxAmount || 0), 0);
    const shippingTotal = orderItems.reduce((s, i) => s + (i.shippingFee || 0), 0);
    const discountsTotal =
      Math.round((orderLevelDiscount + orderItems.reduce((s, i) => s + (i.discount || 0), 0)) * 100) / 100;
    const grandTotal = Math.round((itemsTotal + taxesTotal + shippingTotal - orderLevelDiscount) * 100) / 100;

    // ✅ Create order document
    const orderDoc = new Order({
      user: req.user._id,
      items: orderItems,
      discounts: discountsTotal,
      taxes: taxesTotal,
      shippingFee: shippingTotal,
      appliedCoupons,
      paymentMethod: "COD",
      paymentStatus: "pending",
      orderStatus: "pending",
      shippingAddress,
      notes,
      totalAmount: grandTotal,
      cart: null,
      trackingNumbers: [],
    });

    const mainTrackingNumber = generateTrackingNumber(orderDoc._id, orderItems[0].seller);
    orderDoc.trackingNumbers.push(mainTrackingNumber);

    await orderDoc.save({ session });

    // ✅ Group items by seller for sub-orders
    const itemsBySeller = {};
    for (const item of orderDoc.items) {
      const sid = item.seller.toString();
      if (!itemsBySeller[sid]) itemsBySeller[sid] = [];
      itemsBySeller[sid].push(item);
    }

    // ✅ Create sub-orders
    const subOrders = [];
    for (const [sellerId, items] of Object.entries(itemsBySeller)) {
      const subTrackingNumber = generateTrackingNumber(orderDoc._id, sellerId);

      const so = new SubOrder({
        order: orderDoc._id,
        seller: sellerId,
        items: items.map((it) => ({
          orderItemId: it._id,
          product: it.product,
          quantity: it.quantity,
          price: it.price,
          discount: it.discount,
          subtotal: it.subtotal,
          taxAmount: it.taxAmount,
          shippingFee: it.shippingFee,
          status: it.status,
        })),
        subOrderStatus: "pending",
        trackingNumbers: [subTrackingNumber],
      });

      await so.save({ session });
      subOrders.push(so);

      orderDoc.trackingNumbers.push(subTrackingNumber);
    }

    // ✅ Deduct stock
    for (const it of orderDoc.items) {
      await Product.updateOne(
        { _id: it.product, quantity: { $gte: it.quantity } },
        { $inc: { quantity: -it.quantity } },
        { session }
      );
    }

    await session.commitTransaction();

    // ✅ Populate order for response
    const populatedOrder = await Order.findById(orderDoc._id)
      .populate("items.product", "name image gallery price")
      .populate("items.seller", "storeName")
      .populate("appliedCoupons", "code value type scope")
      .lean();

    // ✅ Fallback: ensure product image is not null (use first gallery image if needed)
    //    Also ensures the `image` key exists even if it was missing in the DB.
    const DEFAULT_PRODUCT_IMAGE = "uploads/products/placeholder.jpg";
    if (populatedOrder?.items?.length) {
      for (const item of populatedOrder.items) {
        if (item?.product) {
          const hasCover = !!item.product.image;
          const hasGallery = Array.isArray(item.product.gallery) && item.product.gallery.length > 0;
          if (!hasCover) {
            item.product.image = hasGallery ? item.product.gallery[0] : DEFAULT_PRODUCT_IMAGE;
          }
        }
      }
    }

    res.status(201).json({
      message: "Order placed (Buy Now) successfully",
      order: populatedOrder,
      subOrders,
    });
  } catch (err) {
    await session.abortTransaction();
    console.error("Error in buyNow:", err);
    res.status(500).json({
      message: "Error creating buy-now order",
      error: err.message,
    });
  } finally {
    session.endSession();
  }
};

// ---------- SELLER SIDE ----------
/*
  SELLER SIDE CONTROLLERS
  - getMySales
  - updateItemStatus
  - addTracking
  - cancelItem
  - confirmPaymentCollection
*/

//
// 1) View My Sales (SubOrders scoped)
//    - Populates order.user (name, email, phone) so frontend can show real customer info
//
exports.getMySales = async (req, res) => {
  try {
    const seller = await SellerProfile.findOne({ user: req.user._id });
    if (!seller) return res.status(404).json({ message: 'Seller profile not found' });

    const { from, to, status } = req.query;
    const filter = { seller: seller._id };
    if (status) filter.subOrderStatus = status;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to);
    }

    // Populate order (and inside it the user), plus product basic fields
    const subOrders = await SubOrder.find(filter)
      .populate({
        path: 'order',
        // select fields from order we want; populate user inside order with name,email,phone
        select: 'user totalAmount orderStatus createdAt shippingAddress paymentStatus paymentMethod trackingNumbers notes',
        populate: { path: 'user', select: 'name email phone' }
      })
      .populate('seller', 'name user')
      .populate('items.product', 'name image')
      .sort({ createdAt: -1 });

    res.json(subOrders);
  } catch (err) {
    console.error('Error fetching seller sales:', err);
    res.status(500).json({ message: 'Error fetching sales', error: err.message });
  }
};

//
// 2) Update Item Status (seller-owned item)
//    - Accepts orderId & itemId either in body or params (body preferred)
//    - Expanded allowed statuses to include 'processing' (so the frontend "Process" action works)
//    - Reasonable rollup logic: if all delivered => "completed", if some shipped/delivered => "processing", if all cancelled => "cancelled"
//
exports.updateItemStatus = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const orderId = req.body.orderId || req.params.orderId;
    const itemId = req.body.itemId || req.params.itemId; // this will be subOrder.items._id
    const { status, trackingNumber } = req.body;

    if (!orderId || !itemId || !status) {
      await session.abortTransaction();
      return res.status(400).json({ message: "orderId, itemId and status are required" });
    }

    // Find seller profile
    const seller = await SellerProfile.findOne({ user: req.user._id }).session(session);
    if (!seller) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Seller profile not found" });
    }

    // Find order
    const order = await Order.findById(orderId).session(session);
    if (!order) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Order not found" });
    }

    // Find seller’s subOrder
    const subOrder = await SubOrder.findOne({ order: order._id, seller: seller._id }).session(session);
    if (!subOrder) {
      await session.abortTransaction();
      return res.status(404).json({ message: "SubOrder not found for this seller" });
    }

    // Find item in subOrder
    const soItem = subOrder.items.id(itemId);
    if (!soItem) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Item not found in subOrder" });
    }

    // Verify linked orderItem exists
    const orderItem = order.items.id(soItem.orderItemId);
    if (!orderItem) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Linked order item not found" });
    }

    // Verify seller ownership
    if (!orderItem.seller || orderItem.seller.toString() !== seller._id.toString()) {
      await session.abortTransaction();
      return res.status(403).json({ message: "Unauthorized: Item not owned by seller" });
    }

    // Allowed statuses
    const allowed = ["pending", "processing", "paid", "shipped", "delivered", "cancelled", "returned", "refunded"];
    if (!allowed.includes(status)) {
      await session.abortTransaction();
      return res.status(400).json({ message: "Invalid status" });
    }

    // Update both orderItem and soItem
    orderItem.status = status;
    soItem.status = status;

    if (status === "shipped" && trackingNumber) {
      orderItem.trackingNumber = trackingNumber;
      soItem.trackingNumber = trackingNumber;

      if (!order.trackingNumbers) order.trackingNumbers = [];
      if (!order.trackingNumbers.includes(trackingNumber)) {
        order.trackingNumbers.push(trackingNumber);
      }
      order.orderStatus = "processing";
    }

    // Rollup order status
    if (order.items.every((i) => i.status === "delivered")) {
      order.orderStatus = "completed";
    } else if (order.items.every((i) => i.status === "cancelled")) {
      order.orderStatus = "cancelled";
    } else if (order.items.some((i) => ["shipped", "delivered", "processing"].includes(i.status))) {
      order.orderStatus = "processing";
    } else {
      order.orderStatus = order.orderStatus || "pending";
    }

    // Rollup subOrder status
    if (subOrder.items.every((i) => i.status === "delivered")) {
      subOrder.subOrderStatus = "completed";
    } else if (subOrder.items.every((i) => i.status === "cancelled")) {
      subOrder.subOrderStatus = "cancelled";
    } else if (subOrder.items.some((i) => ["shipped", "delivered", "processing"].includes(i.status))) {
      subOrder.subOrderStatus = "processing";
    } else {
      subOrder.subOrderStatus = subOrder.subOrderStatus || "pending";
    }

    await order.save({ session });
    await subOrder.save({ session });

    await session.commitTransaction();

    res.json({ message: "Item status updated", order, subOrder });
  } catch (err) {
    await session.abortTransaction();
    console.error("❌ Error updating item status:", err);
    res.status(500).json({ message: "Error updating item status", error: err.message });
  } finally {
    session.endSession();
  }
};


//
// 3) Add Tracking Number (bulk mark shipped for seller items)
//    - Accept orderId from params OR body (body preferred for consistency with frontend)
//    - Marks seller's items as shipped and attaches trackingNumber
//
exports.addTracking = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const trackingNumber = req.body.trackingNumber || req.query.trackingNumber;
    const orderId = req.params.orderId || req.body.orderId;
    if (!trackingNumber) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Tracking number is required' });
    }
    if (!orderId) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'orderId is required' });
    }

    const seller = await SellerProfile.findOne({ user: req.user._id }).session(session);
    if (!seller) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Seller profile not found' });
    }

    const order = await Order.findById(orderId).session(session);
    if (!order) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Order not found' });
    }

    const sellerItems = order.items.filter((i) => i.seller && i.seller.toString() === seller._id.toString());
    if (sellerItems.length === 0) {
      await session.abortTransaction();
      return res.status(403).json({ message: 'Unauthorized: No items for this seller' });
    }

    for (const it of sellerItems) {
      // mark pending/paid/processing => shipped
      if (['pending', 'paid', 'processing'].includes(it.status)) {
        it.status = 'shipped';
        it.trackingNumber = trackingNumber;
      }
    }

    // Avoid duplicate tracking numbers
    if (!order.trackingNumbers) order.trackingNumbers = [];
    if (!order.trackingNumbers.includes(trackingNumber)) order.trackingNumbers.push(trackingNumber);
    order.orderStatus = 'processing';
    await order.save({ session });

    const subOrder = await SubOrder.findOne({ order: order._id, seller: seller._id }).session(session);
    if (subOrder) {
      for (const soItem of subOrder.items) {
        if (['pending', 'paid', 'processing'].includes(soItem.status)) {
          soItem.status = 'shipped';
          soItem.trackingNumber = trackingNumber;
        }
      }
      subOrder.subOrderStatus = 'processing';
      await subOrder.save({ session });
    }

    await session.commitTransaction();
    res.json({ message: 'Tracking number added', order });
  } catch (err) {
    await session.abortTransaction();
    console.error('Error adding tracking number:', err);
    res.status(500).json({ message: 'Error adding tracking number', error: err.message });
  } finally {
    session.endSession();
  }
};

//
// 4) Cancel Item (seller)
//    - Accepts orderId & itemId in params OR body
//    - Restores product quantity, updates wallet/suborder rollups
//
exports.cancelItem = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const orderId = req.params.orderId || req.body.orderId;
    const itemId = req.params.itemId || req.body.itemId;
    const cancellationReason = req.body.cancellationReason;

    if (!orderId || !itemId) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'orderId and itemId required' });
    }

    const seller = await SellerProfile.findOne({ user: req.user._id }).session(session);
    if (!seller) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Seller profile not found' });
    }

    const order = await Order.findById(orderId).session(session);
    if (!order) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Order not found' });
    }

    const item = order.items.id(itemId);
    if (!item || !item.seller || item.seller.toString() !== seller._id.toString()) {
      await session.abortTransaction();
      return res.status(403).json({ message: 'Unauthorized: Item not owned by seller' });
    }

    if (item.status !== 'pending') {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Cannot cancel non-pending item' });
    }

    item.status = 'cancelled';
    item.paymentCollectionStatus = 'cancelled';
    order.cancellationReason = cancellationReason || 'Cancelled by seller';

    // Restore product stock
    await Product.findByIdAndUpdate(item.product, { $inc: { quantity: item.quantity } }, { session });

    // Rollups
    if (order.items.every((i) => i.status === 'cancelled')) order.orderStatus = 'cancelled';

    await order.save({ session });

    // SubOrder and other updates
    const subOrder = await SubOrder.findOne({ order: order._id, seller: seller._id }).session(session);
    if (subOrder) {
      const soItem = subOrder.items.find((x) => x.orderItemId.toString() === item._id.toString());
      if (soItem) soItem.status = 'cancelled';
      if (subOrder.items.every((i) => i.status === 'cancelled')) subOrder.subOrderStatus = 'cancelled';
      await subOrder.save({ session });
    }

    await session.commitTransaction();
    res.json({ message: 'Item cancelled successfully', order });
  } catch (err) {
    await session.abortTransaction();
    console.error('Error cancelling item:', err);
    res.status(500).json({ message: 'Error cancelling item', error: err.message });
  } finally {
    session.endSession();
  }
};

//
// 5) Confirm Payment Collection (COD) – seller confirms item-level collection
//    - Accepts orderId & itemId from body
//
exports.confirmPaymentCollection = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const orderId = req.body.orderId || req.params.orderId;
    const itemId = req.body.itemId || req.params.itemId;

    if (!orderId || !itemId) {
      await session.abortTransaction();
      return res.status(400).json({ message: 'orderId and itemId required' });
    }

    const seller = await SellerProfile.findOne({ user: req.user._id }).session(session);
    if (!seller) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Seller profile not found' });
    }

    const order = await Order.findById(orderId).session(session);
    if (!order) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Order not found' });
    }

    const item = order.items.id(itemId);
    if (!item) {
      await session.abortTransaction();
      return res.status(404).json({ message: 'Item not found in order' });
    }

    // ✅ More flexible seller ownership check
    let isOwnedBySeller = false;
    if (item.seller) {
      // item.seller might be a SellerProfile._id or directly a user._id
      if (
        item.seller.toString() === seller._id.toString() ||
        item.seller.toString() === req.user._id.toString()
      ) {
        isOwnedBySeller = true;
      }
    } else {
      // fallback: check SubOrder ownership
      const subOrderCheck = await SubOrder.findOne({
        order: order._id,
        seller: seller._id,
        "items._id": item._id
      }).session(session);
      if (subOrderCheck) {
        isOwnedBySeller = true;
      }
    }

    if (!isOwnedBySeller) {
      await session.abortTransaction();
      return res.status(403).json({ message: 'Unauthorized: Item not owned by seller' });
    }

    if (item.status !== 'delivered') {
      await session.abortTransaction();
      return res.status(400).json({ message: 'Item not delivered' });
    }

    // ✅ Mark as collected
    item.paymentCollectionStatus = 'collected';
    await order.save({ session });

    // ✅ When all collected (or cancelled), mark order paymentStatus = paid
    if (order.items.every((i) => i.paymentCollectionStatus === 'collected' || i.status === 'cancelled')) {
      order.paymentStatus = 'paid';
      await order.save({ session });
    }

    // ✅ SubOrder payout eligibility
    const subOrder = await SubOrder.findOne({ order: order._id, seller: seller._id }).session(session);
    if (subOrder) {
      if (subOrder.items.every((i) => i.status === 'delivered')) {
        await subOrder.save({ session });
      }
    }

    await session.commitTransaction();
    res.json({ message: 'Payment collection confirmed', order });
  } catch (err) {
    await session.abortTransaction();
    console.error('Error confirming payment collection:', err);
    res.status(500).json({ message: 'Error confirming payment collection', error: err.message });
  } finally {
    session.endSession();
  }
};


// ---------- DISPUTES (Buyer/Admin) ----------
// Open dispute (buyer)
exports.openDispute = async (req, res) => {
  try {
    const { itemId, reason } = req.body;
    if (!reason) return res.status(400).json({ message: "Reason is required" });

    const order = await Order.findOne({ _id: req.params.id, user: req.user._id });
    if (!order) return res.status(404).json({ message: "Order not found" });

    let againstSeller = undefined;
    if (itemId) {
      const item = order.items.id(itemId);
      if (!item) return res.status(404).json({ message: "Order item not found" });
      againstSeller = item.seller;

      const existingDispute = await Dispute.findOne({
        order: order._id,
        itemId,
        openedBy: req.user._id
      });
      if (existingDispute) {
        return res.status(400).json({ message: "You already opened a dispute for this product." });
      }
    }

    const subOrder = againstSeller 
      ? await SubOrder.findOne({ order: order._id, seller: againstSeller }) 
      : null;

 const attachments = req.files
  ? req.files.map(file => file.path.replace(/\\/g, "/")) // normalize for Windows paths
  : [];

const dispute = await Dispute.create({
  order: order._id,
  subOrder: subOrder?._id,
  itemId: itemId || undefined,
  openedBy: req.user._id,
  againstSeller,
  reason,
  status: "open",
  attachments, // save file paths
});

    res.json({ message: "Dispute opened", dispute });
  } catch (err) {
    console.error("Error opening dispute:", err);
    res.status(500).json({ message: "Error opening dispute", error: err.message });
  }
};

// Admin resolve dispute
exports.resolveDispute = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { resolution, outcome } = req.body;
    // outcome: "resolved_buyer" | "resolved_seller" | "cancelled"

    const dispute = await Dispute.findById(req.params.disputeId).session(session);
    if (!dispute) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Dispute not found" });
    }

    // ✅ Update fields properly
    dispute.status = outcome || "cancelled"; // must match enum values
    dispute.outcome = outcome || "cancelled";
    dispute.resolution = resolution || "";
    await dispute.save({ session });

    // ✅ Handle refund logic if buyer wins
    if (outcome === "resolved_buyer" && dispute.itemId) {
      const order = await Order.findById(dispute.order).session(session);
      if (!order) throw new Error("Order not found for dispute");

      const item = order.items.id(dispute.itemId);
      if (item) {
        if (item.status === "delivered" || item.status === "shipped") {
          item.paymentCollectionStatus = "refunded";
          item.status = "returned";
        }
      }
      await order.save({ session });
    }

    await session.commitTransaction();
    res.json({ message: "Dispute resolved", dispute });
  } catch (err) {
    await session.abortTransaction();
    console.error("Error resolving dispute:", err);
    res.status(500).json({ message: "Error resolving dispute", error: err.message });
  } finally {
    session.endSession();
  }
};

// ---------- RETURNS (Admin/Seller) ----------

exports.updateReturnStatus = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { status, adminNote } = req.body; // approved | rejected | received | refunded
    const rr = await ReturnRequest.findById(req.params.returnId).session(session);
    if (!rr) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Return request not found" });
    }

    rr.status = status;
    if (adminNote) rr.adminNote = adminNote;
    await rr.save({ session });

    const order = await Order.findById(rr.order).session(session);
    const item = order.items.id(rr.itemId);
    const subOrder = await SubOrder.findById(rr.subOrder).session(session);

    if (!item) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Order item not found" });
    }

    if (status === "approved") {
      // Await seller receiving the product
    } else if (status === "received") {
      // Restock the quantity received
      await Product.findByIdAndUpdate(item.product, { $inc: { quantity: rr.quantity } }, { session });
    } else if (status === "refunded") {
      // Process refund amount
      item.paymentCollectionStatus = "refunded";
      item.status = "returned";
      await order.save({ session });
    } else if (status === "rejected") {
      // No-op
    }

    await session.commitTransaction();
    res.json({ message: "Return updated", returnRequest: rr });
  } catch (err) {
    await session.abortTransaction();
    console.error("Error updating return:", err);
    res.status(500).json({ message: "Error updating return", error: err.message });
  } finally {
    session.endSession();
  }
};

// ---------- ADMIN SIDE ----------

// 1) View All Orders (with filters)
exports.getAllOrders = async (req, res) => {
  try {
    const { from, to, status, sellerId, userId } = req.query;
    const filter = {};
    if (status) filter.orderStatus = status;
    if (userId) filter.user = userId;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to);
    }

    let query = Order.find(filter)
      .populate("user", "name email")
      .populate("items.product", "name image")
      .populate("items.seller", "storeName logo")
      .sort({ createdAt: -1 });

    // If seller filter, show orders that include that seller
    if (sellerId) query = query.where("items.seller").equals(sellerId);

    const orders = await query.exec();
    res.json(orders);
  } catch (err) {
    console.error("Error fetching all orders:", err);
    res.status(500).json({ message: "Error fetching orders", error: err.message });
  }
};

// 2) Update Order Status (admin)
exports.updateOrderStatus = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { orderStatus, cancellationReason } = req.body;
    if (!["pending", "processing", "completed", "cancelled"].includes(orderStatus)) {
      await session.abortTransaction();
      return res.status(400).json({ message: "Invalid order status" });
    }

    const order = await Order.findById(req.params.id).session(session);
    if (!order) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Order not found" });
    }

    if (orderStatus === "cancelled") {
      order.cancellationReason = cancellationReason || "Cancelled by admin";
      order.paymentStatus = "pending";
      for (const item of order.items) {
        if (item.status !== "cancelled") {
          await Product.findByIdAndUpdate(item.product, { $inc: { quantity: item.quantity } }, { session });
          item.status = "cancelled";
          item.paymentCollectionStatus = "cancelled";
        }
      }

      const subOrders = await SubOrder.find({ order: order._id }).session(session);
      for (const so of subOrders) {
        so.subOrderStatus = "cancelled";
        await so.save({ session });
      }
    } else if (orderStatus === "completed") {
      if (!order.items.every((i) => i.status === "delivered" || i.status === "returned" || i.status === "cancelled")) {
        await session.abortTransaction();
        return res.status(400).json({ message: "Not all items are delivered/returned/cancelled" });
      }
      order.paymentStatus = "pending";
      for (const it of order.items) {
        if (it.status === "delivered") it.paymentCollectionStatus = "pending";
      }

      const subOrders = await SubOrder.find({ order: order._id }).session(session);
      for (const so of subOrders) {
        await so.save({ session });
      }
    }

    order.orderStatus = orderStatus;
    await order.save({ session });
    await session.commitTransaction();

    res.json({ message: "Order status updated", order });
  } catch (err) {
    await session.abortTransaction();
    console.error("Error updating order status:", err);
    res.status(500).json({ message: "Error updating order status", error: err.message });
  } finally {
    session.endSession();
  }
};

// 3) Process Refund (admin full refund)
exports.processRefund = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { refundReason } = req.body;

    const order = await Order.findById(req.params.id).session(session);
    if (!order) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Order not found" });
    }

    if (!["processing", "completed", "pending"].includes(order.orderStatus)) {
      await session.abortTransaction();
      return res.status(400).json({ message: "Refund not allowed in current order status" });
    }

    // Mark all items refunded or cancelled
    for (const item of order.items) {
      if (item.status !== "cancelled" && item.status !== "returned") {
        item.status = "refunded";
        item.paymentCollectionStatus = "refunded";
        // Restore stock if not delivered
        if (item.status !== "delivered") {
          await Product.findByIdAndUpdate(
            item.product,
            { $inc: { quantity: item.quantity } },
            { session }
          );
        }
      }
    }

    order.orderStatus = "refunded";
    order.paymentStatus = "refunded";
    order.refundReason = refundReason || "Refunded by admin";

    await order.save({ session });

    // Update suborders
    const subOrders = await SubOrder.find({ order: order._id }).session(session);
    for (const so of subOrders) {
      so.subOrderStatus = "refunded";
      await so.save({ session });
    }

    // Optionally credit to buyer wallet
    const buyer = await User.findById(order.user).session(session);
    if (buyer) {
      const refundAmount = order.items.reduce((sum, it) => sum + (it.subtotal || 0), 0);
      if (!buyer.wallet) buyer.wallet = { balance: 0, transactions: [] };
      buyer.wallet.balance += refundAmount;
      buyer.wallet.transactions.push({
        type: "refund",
        amount: refundAmount,
        order: order._id,
        createdAt: new Date(),
      });
      await buyer.save({ session });
    }

    await session.commitTransaction();
    res.json({ message: "Refund processed successfully", order });
  } catch (err) {
    await session.abortTransaction();
    console.error("Error processing refund:", err);
    res.status(500).json({ message: "Error processing refund", error: err.message });
  } finally {
    session.endSession();
  }
};

// 4) Order Analytics (date-range, status, top sellers/products)
exports.getOrderAnalytics = async (req, res) => {
  try {
    const { from, to } = req.query;
    const match = {};
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = new Date(from);
      if (to) match.createdAt.$lte = new Date(to);
    }

    const totalOrders = await Order.countDocuments(match);

    const totalSalesAgg = await Order.aggregate([
      { $match: match },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } },
    ]);
    const totalSales = totalSalesAgg[0]?.total || 0;

    const statusCounts = await Order.aggregate([
      { $match: match },
      { $group: { _id: "$orderStatus", count: { $sum: 1 } } },
      { $project: { _id: 0, status: "$_id", count: 1 } },
    ]);

    const topSellers = await Order.aggregate([
      { $match: match },
      { $unwind: "$items" },
      { $group: { _id: "$items.seller", total: { $sum: "$items.subtotal" } } },
      { $sort: { total: -1 } },
      { $limit: 5 },
      { $lookup: { from: "sellerprofiles", localField: "_id", foreignField: "_id", as: "seller" } },
      { $unwind: "$seller" },
      { $project: { storeName: "$seller.storeName", total: 1 } },
    ]);

    const topProducts = await Order.aggregate([
      { $match: match },
      { $unwind: "$items" },
      { $group: { _id: "$items.product", totalQuantity: { $sum: "$items.quantity" } } },
      { $sort: { totalQuantity: -1 } },
      { $limit: 5 },
      { $lookup: { from: "products", localField: "_id", foreignField: "_id", as: "product" } },
      { $unwind: "$product" },
      { $project: { name: "$product.name", totalQuantity: 1 } },
    ]);

    res.json({ totalOrders, totalSales, statusCounts, topSellers, topProducts });
  } catch (err) {
    console.error("Error fetching order analytics:", err);
    res.status(500).json({ message: "Error fetching analytics", error: err.message });
  }
};

// 5) Delete Order (Admin cleanup)
exports.deleteOrder = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const order = await Order.findById(req.params.id).session(session);
    if (!order) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Order not found" });
    }

    // Restore quantities for non-cancelled items
    for (const item of order.items) {
      if (item.status !== "cancelled") {
        await Product.findByIdAndUpdate(item.product, { $inc: { quantity: item.quantity } }, { session });
      }
    }

    // Delete suborders
    await SubOrder.deleteMany({ order: order._id }).session(session);

    await order.deleteOne({ session });
    await session.commitTransaction();
    res.json({ message: "Order deleted successfully" });
  } catch (err) {
    await session.abortTransaction();
    console.error("Error deleting order:", err);
    res.status(500).json({ message: "Error deleting order", error: err.message });
  } finally {
    session.endSession();
  }
};