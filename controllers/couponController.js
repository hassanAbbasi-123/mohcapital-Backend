// controllers/couponController.js
const mongoose = require("mongoose");
const Coupon = require("../models/couponModel");
const Product = require("../models/productModel");
const Category = require("../models/categoryModel"); // optional, used for category validations
const Order = require("../models/ordermodel/orderModel"); // used for analytics/rollback (if available)
const SellerProfile =require("../models/sellerProfile");
const{getProductsForCart, countUserUsage ,computeDiscountForCouponOnCart}=require("../utils/couponUtils")

// ---------------------------
// ADMIN: Create coupon
// ---------------------------
exports.createCouponAdmin = async (req, res) => {
  try {
    const payload = { ...req.body };
    // Normalize fields: arrays may come as comma-separated strings
    if (payload.sellers && typeof payload.sellers === "string") {
      payload.sellers = payload.sellers.split(",").map((s) => s.trim());
    }
    if (payload.applicableProducts && typeof payload.applicableProducts === "string") {
      payload.applicableProducts = payload.applicableProducts.split(",").map((s) => s.trim());
    }
    if (payload.applicableCategories && typeof payload.applicableCategories === "string") {
      payload.applicableCategories = payload.applicableCategories.split(",").map((s) => s.trim());
    }
    payload.createdBy = req.user ? req.user._id : undefined;
    payload.createdByModel = req.user && req.user.role === "seller" ? "SellerProfile" : "Admin";

    const coupon = new Coupon(payload);
    await coupon.save();
    res.status(201).json({ message: "✅ Coupon created successfully", coupon });
  } catch (error) {
    console.error("createCouponAdmin error:", error);
    res.status(500).json({ message: "Error creating coupon", error: error.message });
  }
};

// ---------------------------
// ADMIN: Update coupon
// ---------------------------
exports.updateCouponAdmin = async (req, res) => {
  try {
    const coupon = await Coupon.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!coupon) return res.status(404).json({ message: "Coupon not found" });
    res.json({ message: "✅ Coupon updated", coupon });
  } catch (error) {
    console.error("updateCouponAdmin error:", error);
    res.status(500).json({ message: "Error updating coupon", error: error.message });
  }
};

// ---------------------------
// ADMIN: Toggle active
// ---------------------------
exports.toggleCouponAdmin = async (req, res) => {
  try {
    const coupon = await Coupon.findById(req.params.id);
    if (!coupon) return res.status(404).json({ message: "Coupon not found" });

    coupon.isActive = !coupon.isActive;
    await coupon.save();
    res.json({ message: `✅ Coupon ${coupon.isActive ? "activated" : "deactivated"}`, coupon });
  } catch (error) {
    console.error("toggleCouponAdmin error:", error);
    res.status(500).json({ message: "Error toggling coupon", error: error.message });
  }
};

// ---------------------------
// ADMIN: Delete
// ---------------------------
exports.deleteCouponAdmin = async (req, res) => {
  try {
    const coupon = await Coupon.findByIdAndDelete(req.params.id);
    if (!coupon) return res.status(404).json({ message: "Coupon not found" });
    res.json({ message: "✅ Coupon deleted" });
  } catch (error) {
    console.error("deleteCouponAdmin error:", error);
    res.status(500).json({ message: "Error deleting coupon", error: error.message });
  }
};

// ---------------------------
// ADMIN: List all coupons
// ---------------------------
exports.getAllCouponsAdmin = async (req, res) => {
  try {
    const coupons = await Coupon.find()
      .populate("sellers", "storeName")
      .populate("applicableProducts", "name")
      .populate("applicableCategories", "name")
      .lean();

    res.json(coupons);
  } catch (error) {
    console.error("getAllCouponsAdmin error:", error);
    res.status(500).json({ message: "Error fetching coupons", error: error.message });
  }
};

/// ---------------------------
// SELLER: Create coupon (auto-assign product/category if none)
// ---------------------------
exports.createCouponSeller = async (req, res) => {
  try {
    const seller = await SellerProfile.findOne({ user: req.user._id }).select("_id");
    if (!seller) {
      return res.status(400).json({
        message: "❌ Seller profile not found. Coupon cannot be created.",
      });
    }

    let { applicableProducts = [], applicableCategories = [] } = req.body;

    // Ensure arrays
    if (!Array.isArray(applicableProducts)) applicableProducts = [];
    if (!Array.isArray(applicableCategories)) applicableCategories = [];

    // Auto-fetch seller's products if none provided
    if (applicableProducts.length === 0) {
      const products = await Product.find({ seller: seller._id })
        .select("_id category")
        .lean();

      applicableProducts = products.map((p) => p._id);
      applicableCategories = [
        ...new Set(
          products
            .filter((p) => p.category)
            .map((p) => p.category.toString())
        ),
      ];
    }

    const payload = {
      ...req.body,
      sellers: [seller._id], // ✅ Always link to SellerProfile._id
      applicableProducts,
      applicableCategories,
      createdBy: seller._id, // ✅ Fix: should be SellerProfile._id
      createdByModel: "SellerProfile",
    };

    const coupon = new Coupon(payload);
    await coupon.save();

    res
      .status(201)
      .json({ message: "✅ Coupon created by seller", coupon });
  } catch (error) {
    console.error("createCouponSeller error:", error);
    res.status(500).json({
      message: "Error creating coupon",
      error: error.message,
    });
  }
};

// ---------------------------
// SELLER: Update own coupon
// ---------------------------
exports.updateCouponSeller = async (req, res) => {
  try {
    const seller = await SellerProfile.findOne({ user: req.user._id }).select("_id");
    if (!seller) {
      return res
        .status(400)
        .json({ message: "❌ Seller profile not found." });
    }

    // Ensure seller only updates their own coupons
    const coupon = await Coupon.findOneAndUpdate(
      { _id: req.params.id, sellers: seller._id },
      req.body,
      { new: true }
    );

    if (!coupon) {
      return res
        .status(404)
        .json({ message: "Coupon not found or not owned by you" });
    }

    res.json({ message: "✅ Coupon updated", coupon });
  } catch (error) {
    console.error("updateCouponSeller error:", error);
    res.status(500).json({
      message: "Error updating coupon",
      error: error.message,
    });
  }
};

// ---------------------------
// SELLER: Toggle own coupon
// ---------------------------

exports.toggleCouponSeller = async (req, res) => {
  try {
    const seller = await SellerProfile.findOne({ user: req.user._id }).select("_id");
    if (!seller) {
      return res.status(404).json({ message: "Seller profile not found" });
    }

    const coupon = await Coupon.findOne({ _id: req.params.id, sellers: seller._id });
    if (!coupon) return res.status(404).json({ message: "Coupon not found or not yours" });

    coupon.isActive = !coupon.isActive;
    await coupon.save();

    res.json({ message: `✅ Coupon ${coupon.isActive ? "activated" : "deactivated"}`, coupon });
  } catch (error) {
    console.error("toggleCouponSeller error:", error);
    res.status(500).json({ message: "Error toggling coupon", error: error.message });
  }
};

// ---------------------------
// SELLER: Delete own coupon
// ---------------------------
exports.deleteCouponSeller = async (req, res) => {
  try {
    const seller = await SellerProfile.findOne({ user: req.user._id }).select("_id");
    if (!seller) {
      return res.status(404).json({ message: "Seller profile not found" });
    }

    const coupon = await Coupon.findOneAndDelete({ _id: req.params.id, sellers: seller._id });
    if (!coupon) return res.status(404).json({ message: "Coupon not found or not yours" });

    res.json({ message: "✅ Coupon deleted" });
  } catch (error) {
    console.error("deleteCouponSeller error:", error);
    res.status(500).json({ message: "Error deleting coupon", error: error.message });
  }
};

// ---------------------------
// SELLER: Get own coupons
// ---------------------------
exports.getCouponsSeller = async (req, res) => {
  try {
    // find the seller profile linked to the logged-in user
    const sellerProfile = await SellerProfile.findOne({ user: req.user._id }).select("_id");

    if (!sellerProfile) {
      return res.status(404).json({ message: "Seller profile not found" });
    }

    // now fetch coupons linked to this seller
    const coupons = await Coupon.find({ sellers: sellerProfile._id }).lean();

    res.json(coupons);
  } catch (error) {
    console.error("getCouponsSeller error:", error);
    res.status(500).json({ message: "Error fetching coupons", error: error.message });
  }
};

// ---------------------------
// USER: Apply single coupon at checkout
// Request body:
// { code: "ABC10", cart: [{ productId, quantity, price }], userId (from req.user) }
// ---------------------------
exports.applyCoupon = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const userId = req.user && req.user._id;
    const { code, cart } = req.body;

    if (!code || !Array.isArray(cart)) {
      await session.abortTransaction();
      return res
        .status(400)
        .json({ message: "code and cart are required" });
    }

    const coupon = await Coupon.findOne({ code }).session(session);
    if (!coupon) {
      await session.abortTransaction();
      return res.status(404).json({ message: "❌ Invalid coupon" });
    }

    // ✅ Single validity check
    if (!coupon.isValidNow()) {
      await session.abortTransaction();
      return res.status(400).json({
        message: "❌ Coupon not valid (inactive/expired/usage limit reached)"
      });
    }

    // ✅ per-user usage check
    const userUsed = countUserUsage(coupon, userId);
    if (userUsed >= (coupon.maxUsagePerUser || 1)) {
      await session.abortTransaction();
      return res.status(400).json({
        message:
          "❌ You have already used this coupon the maximum allowed times"
      });
    }

    // ✅ fetch products for cart validation
    const productsMap = await getProductsForCart(cart);

    const {
      discount,
      breakdown,
      applicableCartValue,
      applicableItems,
      minCartNotMet
    } = computeDiscountForCouponOnCart(coupon, cart, productsMap);

    if (minCartNotMet) {
      await session.abortTransaction();
      return res.status(400).json({
        message: "❌ Minimum cart value not met for this coupon"
      });
    }
    if (discount <= 0) {
      await session.abortTransaction();
      return res.status(400).json({
        message: "❌ Coupon does not apply to any items in your cart"
      });
    }

    // ✅ Atomic update to prevent race conditions
    await Coupon.updateOne(
      { _id: coupon._id },
      {
        $inc: { usedCount: 1 },
        $push: { userUsage: { user: userId, usedAt: new Date() } }
      },
      { session }
    );

    await session.commitTransaction();

    const finalTotal = applicableCartValue - discount;

    res.json({
      message: "✅ Coupon applied",
      code: coupon.code,
      discount,
      breakdown,
      applicableCartValue,
      finalTotal,
      couponId: coupon._id,
      applicableItems
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("applyCoupon error:", error);
    res
      .status(500)
      .json({ message: "Error applying coupon", error: error.message });
  } finally {
    session.endSession();
  }
};


// ---------------------------
// USER: Apply multiple coupons (stacking)
// Request body: { codes: [..], cart: [...] }
// Rules:
// - All coupons must be stackable or only one non-stackable coupon allowed
// - Respect each coupon's minCartValue and seller/product/category restrictions
// - Respect maxStackPerOrder for each coupon
// ---------------------------
exports.applyCoupons = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const userId = req.user && req.user._id;
    const { codes, cart } = req.body;
    if (!Array.isArray(codes) || codes.length === 0 || !Array.isArray(cart)) {
      await session.abortTransaction();
      return res.status(400).json({ message: "codes (array) and cart are required" });
    }

    // fetch coupons
    const coupons = await Coupon.find({ code: { $in: codes } }).session(session);
    if (coupons.length !== codes.length) {
      const foundCodes = coupons.map((c) => c.code);
      const missing = codes.filter((c) => !foundCodes.includes(c));
      await session.abortTransaction();
      return res.status(404).json({ message: `Coupons not found: ${missing.join(", ")}` });
    }

    // stacking rules validation
    const nonStackables = coupons.filter((c) => !c.stackable);
    if (nonStackables.length > 1) {
      await session.abortTransaction();
      return res.status(400).json({ message: "Only one non-stackable coupon can be used per order" });
    }
    // check each coupon's maxStackPerOrder (simple approach: ensure total coupons <= min of maxStackPerOrder)
    const minStackLimit = Math.min(...coupons.map((c) => c.maxStackPerOrder || coupons.length));
    if (codes.length > minStackLimit) {
      await session.abortTransaction();
      return res.status(400).json({ message: `Too many coupons for stack limits (max ${minStackLimit})` });
    }

    // fetch products
    const productsMap = await getProductsForCart(cart);

    // Check per-coupon validations and compute their discounts
    let totalDiscount = 0;
    const applied = []; // { couponId, code, discount, breakdown }
    for (const coupon of coupons) {
      if (!coupon.isActive || (coupon.expiryDate && new Date() > coupon.expiryDate) || coupon.usedCount >= coupon.maxUsage) {
        await session.abortTransaction();
        return res.status(400).json({ message: `Coupon ${coupon.code} is invalid/expired/used up` });
      }
      // per-user check
      const userUsed = countUserUsage(coupon, userId);
      if (userUsed >= (coupon.maxUsagePerUser || 1)) {
        await session.abortTransaction();
        return res.status(400).json({ message: `You have already used coupon ${coupon.code} the maximum allowed times` });
      }
      // compute discount for this coupon on this cart
      const { discount, breakdown, applicableCartValue, applicableItems, minCartNotMet } =
        computeDiscountForCouponOnCart(coupon, cart, productsMap);
      if (minCartNotMet) {
        await session.abortTransaction();
        return res.status(400).json({ message: `Minimum cart value not met for coupon ${coupon.code}` });
      }
      if (!discount || discount <= 0) {
        await session.abortTransaction();
        return res.status(400).json({ message: `Coupon ${coupon.code} does not apply to your cart` });
      }
      // Mark coupon as applied in local list, we will persist later (after all pass)
      applied.push({ coupon, discount, breakdown });
      totalDiscount = Math.round((totalDiscount + discount) * 100) / 100;
    }

    // All good: persist usage for each coupon
    for (const a of applied) {
      const coupon = a.coupon;
      coupon.usedCount = (coupon.usedCount || 0) + 1;
      coupon.userUsage.push({ user: userId, usedAt: new Date() });
      await coupon.save({ session });
    }

    await session.commitTransaction();
    res.json({
      message: "✅ Coupons applied",
      totalDiscount,
      applied: applied.map((a) => ({ code: a.coupon.code, discount: a.discount, breakdown: a.breakdown }))
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("applyCoupons error:", error);
    res.status(500).json({ message: "Error applying coupons", error: error.message });
  } finally {
    session.endSession();
  }
};

// ---------------------------
// USER: Get available coupons (filtered by seller/product optionally)
// Query params: ?sellerId=&productId=
// ---------------------------
exports.getAvailableCoupons = async (req, res) => {
  try {
    const now = new Date();
    const { sellerId, productId } = req.query;
    const baseFilter = {
      isActive: true,
      $or: [{ expiryDate: { $gte: now } }, { expiryDate: null }],
      $expr: { $lt: ["$usedCount", "$maxUsage"] }
    };

    // If sellerId provided, return coupons that are either global or specifically for seller
    if (sellerId) {
      baseFilter.$or = baseFilter.$or.concat([{ sellers: mongoose.Types.ObjectId(sellerId) }, { sellers: { $size: 0 } }]);
    }

    let coupons = await Coupon.find(baseFilter)
      .populate("sellers", "storeName")
      .populate("applicableProducts", "name")
      .populate("applicableCategories", "name")
      .lean();

    // If productId provided, filter on applicableProducts or categories later by loading product
    if (productId) {
      const prod = await Product.findById(productId).select("category seller").lean();
      coupons = coupons.filter((c) => {
        // if coupon has applicableProducts and not include this product -> exclude
        if (c.applicableProducts && c.applicableProducts.length > 0) {
          const ids = c.applicableProducts.map((p) => p.toString());
          if (!ids.includes(productId.toString())) return false;
        }
        // categories
        if (c.applicableCategories && c.applicableCategories.length > 0) {
          const catIds = c.applicableCategories.map((x) => x.toString());
          if (!catIds.includes((prod.category || "").toString())) return false;
        }
        // seller
        if (c.sellers && c.sellers.length > 0) {
          const sIds = c.sellers.map((s) => s.toString());
          if (!sIds.includes((prod.seller || "").toString())) return false;
        }
        return true;
      });
    }

    res.json(coupons);
  } catch (error) {
    console.error("getAvailableCoupons error:", error);
    res.status(500).json({ message: "Error fetching coupons", error: error.message });
  }
};

// ---------------------------
// RESTORE COUPON USAGE (for refunds/cancellations)
// - Decrements usedCount and removes one userUsage entry for user
// - Use within a transaction when issuing refunds
// ---------------------------
exports.restoreCouponUsage = async (couponId, userId, session = null) => {
  // This function can be called by other controllers (order refunds)
  // If session provided, will use that session; otherwise creates its own
  let externalSession = !!session;
  let localSession;
  try {
    if (!externalSession) {
      localSession = await mongoose.startSession();
      session = localSession;
      session.startTransaction();
    }

    const coupon = await Coupon.findById(couponId).session(session);
    if (!coupon) {
      if (!externalSession) {
        await session.abortTransaction();
        session.endSession();
      }
      return { ok: false, message: "Coupon not found" };
    }

    // decrement usedCount safely
    coupon.usedCount = Math.max((coupon.usedCount || 1) - 1, 0);

    // remove one usage entry for this user (the most recent)
    const idx = coupon.userUsage.map((u) => u.user && u.user.toString()).lastIndexOf(userId.toString());
    if (idx >= 0) {
      coupon.userUsage.splice(idx, 1);
    }

    await coupon.save({ session });

    if (!externalSession) {
      await session.commitTransaction();
      session.endSession();
    }
    return { ok: true };
  } catch (error) {
    if (!externalSession && session) {
      await session.abortTransaction();
      session.endSession();
    }
    console.error("restoreCouponUsage error:", error);
    return { ok: false, error: error.message };
  }
};

// ---------------------------
// ADMIN: Coupon analytics
// - summary of usage (usedCount) and approximate total discount applied (from Orders)
// ---------------------------
exports.getCouponAnalytics = async (req, res) => {
  try {
    // Basic analytics: usedCount and userUsage per coupon
    const coupons = await Coupon.find().lean();

    // If Orders store coupon discount data, we can compute totalDiscount by aggregating orders.
    // We'll attempt best-effort: aggregate orders that have appliedCoupons and discounts fields.
    const agg = await Order.aggregate([
      { $unwind: { path: "$appliedCoupons", preserveNullAndEmptyArrays: true } },
      { $group: { _id: "$appliedCoupons", totalOrderDiscounts: { $sum: "$discounts" }, count: { $sum: 1 } } }
    ]);

    const mapAgg = {};
    agg.forEach((a) => {
      if (!a._id) return;
      mapAgg[a._id.toString()] = { totalOrderDiscounts: a.totalOrderDiscounts || 0, count: a.count || 0 };
    });

    const result = coupons.map((c) => ({
      couponId: c._id,
      code: c.code,
      usedCount: c.usedCount || 0,
      maxUsage: c.maxUsage,
      maxUsagePerUser: c.maxUsagePerUser,
      stackable: !!c.stackable,
      totalOrderDiscounts: mapAgg[c._id.toString()] ? mapAgg[c._id.toString()].totalOrderDiscounts : 0,
      orderCount: mapAgg[c._id.toString()] ? mapAgg[c._id.toString()].count : 0,
    }));

    res.json({ data: result });
  } catch (error) {
    console.error("getCouponAnalytics error:", error);
    res.status(500).json({ message: "Error fetching coupon analytics", error: error.message });
  }
};
// Rollback coupon usage (e.g., on refund/cancel)
exports.rollbackCouponUsage = async (req, res) => {
  try {
    const coupon = await Coupon.findById(req.params.id);
    if (!coupon) return res.status(404).json({ message: "Coupon not found" });

    // Check if user actually used it
    const usageIndex = coupon.userUsage.findIndex(u => u.user.toString() === req.user._id.toString());
    if (usageIndex === -1) {
      return res.status(400).json({ message: "Coupon was not used by this user" });
    }

    // Remove usage record & decrement counter safely
    coupon.userUsage.splice(usageIndex, 1);
    if (coupon.usedCount > 0) coupon.usedCount -= 1;

    await coupon.save();

    res.json({ message: "✅ Coupon usage rolled back", coupon });
  } catch (error) {
    res.status(500).json({ message: "Error rolling back coupon usage", error: error.message });
  }
};
