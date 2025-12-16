// controllers/cartController.js
const mongoose = require("mongoose");
const Cart = require("../models/cartModel");
const Product = require("../models/productModel");
const SellerProfile = require("../models/sellerProfile");
const User = require("../models/userModel");
const { computeDiscountForCouponOnCart } = require("../utils/couponUtils");
const Coupon = require("../models/couponModel");

// ====================== USER SIDE ======================

// Helper: recalc coupon on cart
const recalcCartDiscount = async (cart) => {
  try {
    // Calculate subtotal
    const subtotal = cart.items.reduce((sum, item) => {
      return sum + (item.price * item.quantity);
    }, 0);

    let discount = 0;
    
    // Apply coupon discount if coupon exists
    if (cart.coupon) {
      const coupon = await Coupon.findById(cart.coupon);
      if (coupon && coupon.isActive) {
        if (coupon.discountType === 'percentage') {
          discount = subtotal * (coupon.discountValue / 100);
        } else if (coupon.discountType === 'fixed') {
          discount = coupon.discountValue;
        }
        
        // Ensure discount doesn't exceed subtotal
        discount = Math.min(discount, subtotal);
      }
    }

    cart.discount = discount;
    cart.cartTotal = subtotal;
    cart.finalTotal = subtotal - discount;
    
    return cart;
  } catch (error) {
    console.error("Error recalculating cart discount:", error);
    throw error;
  }
};

// Helper: populate cart consistently + fix missing image fallback
async function populateCart(cartId) {
  const populatedCart = await Cart.findById(cartId)
    .populate({
      path: "items.product",
      select: "name price image gallery inStock status",
    })
    .populate({
      path: "items.Seller",
      select: "storeName logo",
      populate: { path: "user", model: "User", select: "name email" },
    })
    .populate("coupon", "code discountType discountValue");

  if (populatedCart?.items) {
    populatedCart.items.forEach(item => {
      if (!item.product.image && item.product.gallery?.length > 0) {
        item.product.image = item.product.gallery[0];
      }
    });
  }
  return populatedCart;
}

// 1. View Cart
exports.getCart = async (req, res) => {
  try {
    let cart = await Cart.findOne({ user: req.user._id })
      .populate({
        path: "items.product",
        select: "name price image gallery inStock status",
      })
      .populate({
        path: "items.Seller",
        select: "storeName logo",
        populate: { path: "user", model: "User", select: "name email" },
      })
      .populate("coupon", "code discountType discountValue isActive expiryDate");

    if (!cart)
      return res.status(200).json({ message: "Cart is empty", items: [] });

    cart = await recalcCartDiscount(cart);
    await cart.save();

    const populatedCart = await populateCart(cart._id);
    res.json(populatedCart);
  } catch (err) {
    console.error("Error fetching cart:", err);
    res
      .status(500)
      .json({ message: "Error fetching cart", error: err.message });
  }
};

// 2. Add to Cart
exports.addToCart = async (req, res) => {
  try {
    const { productId, quantity } = req.body;

    if (
      !productId ||
      !quantity ||
      quantity < 1 ||
      !Number.isInteger(Number(quantity))
    ) {
      return res
        .status(400)
        .json({ message: "Invalid product ID or quantity" });
    }

    // Find product without populating seller yet
    const product = await Product.findById(productId)
      .select("name price image gallery seller inStock status quantity");

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    // Resolve correct SellerProfile _id (backward compatibility)
    let sellerId = product.seller;
    let sellerProfile = await SellerProfile.findById(sellerId);

    if (!sellerProfile) {
      // Fallback: seller field might store User ID directly
      sellerProfile = await SellerProfile.findOne({ user: sellerId });
      if (sellerProfile) {
        sellerId = sellerProfile._id;
      } else {
        return res.status(400).json({
          message: `Product ${productId} does not have a valid seller`,
        });
      }
    }

    if (!sellerProfile.isVerified) {
      return res.status(403).json({ message: "Seller is not verified" });
    }

    if (!product.inStock || product.status !== "approved") {
      return res
        .status(400)
        .json({ message: "Product not available for purchase" });
    }
    if (product.quantity < quantity) {
      return res.status(400).json({ message: "Not enough stock available" });
    }

    let cart = await Cart.findOne({ user: req.user._id });
    if (!cart) {
      cart = new Cart({ user: req.user._id, items: [] });
    }

    const existingItem = cart.items.find(
      i => i.product.toString() === productId
    );
    if (existingItem) {
      const newQuantity = existingItem.quantity + Number(quantity);
      if (product.quantity < newQuantity) {
        return res.status(400).json({ message: "Not enough stock available" });
      }
      existingItem.quantity = newQuantity;
      existingItem.price = product.price;
    } else {
      cart.items.push({
        product: product._id,
        Seller: sellerId,
        quantity: Number(quantity),
        price: product.price,
      });
    }

    cart = await recalcCartDiscount(cart);
    await cart.save();

    const populatedCart = await populateCart(cart._id);
    res.status(201).json({ message: "Product added to cart", cart: populatedCart });
  } catch (err) {
    console.error("Add to cart error:", err);
    res
      .status(500)
      .json({ message: "Error adding to cart", error: err.message });
  }
};

// The rest of the file remains exactly the same
// (updateCartItem, removeCartItem, clearCart, applyCouponToCart,
// removeCouponFromCart, getCartCount, seller & admin functions)

exports.updateCartItem = async (req, res) => {
  try {
    const { cartItemId, quantity } = req.body;

    if (
      !cartItemId ||
      !quantity ||
      quantity < 1 ||
      !Number.isInteger(Number(quantity))
    ) {
      return res
        .status(400)
        .json({ message: "Invalid cart item ID or quantity" });
    }

    let cart = await Cart.findOne({ user: req.user._id });
    if (!cart) return res.status(404).json({ message: "Cart not found" });

    const item = cart.items.id(cartItemId);
    if (!item) return res.status(404).json({ message: "Item not in cart" });

    const product = await Product.findById(item.product).select("quantity");
    if (product.quantity < quantity) {
      return res.status(400).json({ message: "Not enough stock available" });
    }

    item.quantity = Number(quantity);

    cart = await recalcCartDiscount(cart);
    await cart.save();

    const populatedCart = await populateCart(cart._id);
    res.json({ message: "Cart updated", cart: populatedCart });
  } catch (err) {
    console.error("Error updating cart:", err);
    res
      .status(500)
      .json({ message: "Error updating cart", error: err.message });
  }
};

exports.removeCartItem = async (req, res) => {
  try {
    const { cartItemId } = req.body;

    if (!cartItemId) {
      return res.status(400).json({ message: "Cart item ID is required" });
    }

    let cart = await Cart.findOne({ user: req.user._id });
    if (!cart) return res.status(404).json({ message: "Cart not found" });

    const item = cart.items.id(cartItemId);
    if (!item) return res.status(404).json({ message: "Item not found in cart" });

    cart.items.pull(cartItemId);

    cart = await recalcCartDiscount(cart);
    await cart.save();

    const populatedCart = await populateCart(cart._id);
    res.json({ message: "Item removed", cart: populatedCart });
  } catch (err) {
    console.error("Error removing item:", err);
    res
      .status(500)
      .json({ message: "Error removing item", error: err.message });
  }
};

exports.clearCart = async (req, res) => {
  try {
    let cart = await Cart.findOneAndUpdate(
      { user: req.user._id },
      { items: [], coupon: null, discount: 0, appliedCouponCode: null },
      { new: true }
    );
    if (!cart) {
      return res.status(404).json({ message: "Cart not found" });
    }

    const populatedCart = await populateCart(cart._id);
    res.json({ message: "Cart cleared", cart: populatedCart });
  } catch (err) {
    console.error("Error clearing cart:", err);
    res
      .status(500)
      .json({ message: "Error clearing cart", error: err.message });
  }
};

exports.applyCouponToCart = async (req, res) => {
  try {
    const { code } = req.body;
    console.log("🔍 Received coupon application request:", { code, user: req.user._id });
    
    if (!code)
      return res.status(400).json({ message: "Coupon code is required" });

    let cart = await Cart.findOne({ user: req.user._id })
      .populate("items.product")
      .populate("coupon");
    
    console.log("🔍 Found cart:", cart ? cart._id : "No cart found");
    
    if (!cart) return res.status(404).json({ message: "Cart not found" });

    const coupon = await Coupon.findOne({ 
      code: code.toUpperCase().trim(),
      isActive: true 
    });
    
    console.log("🔍 Found coupon:", coupon ? {_id: coupon._id, code: coupon.code} : "No coupon found");
    
    if (!coupon)
      return res.status(404).json({ message: "❌ Invalid or inactive coupon" });

    if (cart.coupon && cart.coupon._id.toString() === coupon._id.toString()) {
      return res.status(400).json({ message: "❌ This coupon is already applied" });
    }

    cart.coupon = coupon._id;
    console.log("🔍 Applied coupon to cart:", cart.coupon);

    cart = await recalcCartDiscount(cart);
    console.log("🔍 Recalculated cart discount:", cart.discount);

    await cart.save();
    console.log("✅ Cart saved successfully");

    const populatedCart = await Cart.findById(cart._id)
      .populate("items.product")
      .populate("coupon");
    
    console.log("✅ Final cart data after save:", {
      _id: populatedCart._id,
      coupon: populatedCart.coupon,
      discount: populatedCart.discount,
      finalTotal: populatedCart.finalTotal
    });
    
    res.json({ 
      message: "✅ Coupon applied successfully", 
      cart: populatedCart,
      discount: populatedCart.discount
    });
  } catch (err) {
    console.error("❌ Error applying coupon:", err);
    res.status(500).json({ message: "Error applying coupon", error: err.message });
  }
};

exports.removeCouponFromCart = async (req, res) => {
  try {
    let cart = await Cart.findOne({ user: req.user._id });
    if (!cart) return res.status(404).json({ message: "Cart not found" });

    cart.coupon = null;
    cart.discount = 0;
    cart.appliedCouponCode = null;
    await cart.save();

    const populatedCart = await populateCart(cart._id);
    res.json({ message: "Coupon removed", cart: populatedCart });
  } catch (err) {
    console.error("Error removing coupon:", err);
    res
      .status(500)
      .json({ message: "Error removing coupon", error: err.message });
  }
};

exports.getCartCount = async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user._id });
    
    if (!cart || cart.items.length === 0) {
      return res.json({ 
        totalItems: 0,
        cartTotal: 0,
        isEmpty: true 
      });
    }

    const totalItems = cart.items.reduce((sum, item) => sum + item.quantity, 0);
    const cartTotal = cart.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    res.json({
      totalItems,
      cartTotal,
      isEmpty: false
    });
  } catch (err) {
    console.error("Error fetching cart count:", err);
    res.status(500).json({ 
      message: "Error fetching cart count", 
      error: err.message 
    });
  }
};

// ====================== SELLER SIDE ======================

exports.getSellerCartInsights = async (req, res) => {
  try {
    const seller = await SellerProfile.findOne({ user: req.user._id });
    if (!seller)
      return res.status(404).json({ message: "Seller profile not found" });

    const carts = await Cart.aggregate([
      { $unwind: "$items" },
      { $match: { "items.Seller": seller._id } },
      {
        $group: {
          _id: "$items.product",
          count: { $sum: "$items.quantity" },
        },
      },
      {
        $lookup: {
          from: "products",
          localField: "_id",
          foreignField: "_id",
          as: "product",
        },
      },
      { $unwind: "$product" },
      {
        $project: {
          productId: "$product._id",
          name: "$product.name",
          count: 1,
        },
      },
    ]);

    res.json({ insights: carts });
  } catch (err) {
    console.error("Error fetching seller insights:", err);
    res.status(500).json({
      message: "Error fetching seller insights",
      error: err.message,
    });
  }
};

// ====================== ADMIN SIDE ======================

exports.getAllCarts = async (req, res) => {
  try {
    const carts = await Cart.find()
      .populate("user", "name email")
      .populate({
        path: "items.product",
        select: "name price image gallery inStock status",
      })
      .populate({
        path: "items.Seller",
        select: "storeName logo",
        populate: { path: "user", model: "User", select: "name email" },
      });

    res.json(carts);
  } catch (err) {
    console.error("Error fetching all carts:", err);
    res
      .status(500)
      .json({ message: "Error fetching all carts", error: err.message });
  }
};

exports.getTopSellersByCart = async (req, res) => {
  try {
    const topSellers = await Cart.aggregate([
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.Seller",
          count: { $sum: "$items.quantity" },
        },
      },
      { $sort: { count: -1 } },
      {
        $lookup: {
          from: "sellerprofiles",
          localField: "_id",
          foreignField: "_id",
          as: "seller",
        },
      },
      { $unwind: "$seller" },
      {
        $project: {
          sellerId: "$seller._id",
          storeName: "$seller.storeName",
          count: 1,
        },
      },
    ]);

    res.json({ topSellers });
  } catch (err) {
    console.error("Error fetching top sellers:", err);
    res
      .status(500)
      .json({ message: "Error fetching top sellers", error: err.message });
  }
};

exports.getTopProductsByCart = async (req, res) => {
  try {
    const topProducts = await Cart.aggregate([
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.product",
          count: { $sum: "$items.quantity" },
        },
      },
      { $sort: { count: -1 } },
      {
        $lookup: {
          from: "products",
          localField: "_id",
          foreignField: "_id",
          as: "product",
        },
      },
      { $unwind: "$product" },
      {
        $project: {
          productId: "$product._id",
          name: "$product.name",
          count: 1,
        },
      },
    ]);

    res.json({ topProducts });
  } catch (err) {
    console.error("Error fetching top products:", err);
    res.status(500).json({
      message: "Error fetching top products",
      error: err.message,
    });
  }
};

exports.getRevenueProjection = async (req, res) => {
  try {
    const projection = await Cart.aggregate([
      { $unwind: "$items" },
      {
        $group: {
          _id: null,
          totalRevenue: {
            $sum: { $multiply: ["$items.price", "$items.quantity"] },
          },
        },
      },
    ]);

    res.json({ revenueProjection: projection[0]?.totalRevenue || 0 });
  } catch (err) {
    console.error("Error calculating revenue projection:", err);
    res.status(500).json({
      message: "Error calculating revenue projection",
      error: err.message,
    });
  }
};