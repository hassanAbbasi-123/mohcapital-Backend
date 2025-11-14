const mongoose = require("mongoose");
const Product = require("../models/productModel");

// ---------------------------
// getProductsForCart
// ---------------------------
async function getProductsForCart(cart) {
  const ids = cart.map((c) => new mongoose.Types.ObjectId(c.productId));
  const products = await Product.find({ _id: { $in: ids } })
    .select("price category seller name")
    .lean();

  const map = {};
  products.forEach((p) => {
    map[p._id.toString()] = p;
  });

  return map;
}

// ---------------------------
// countUserUsage
// ---------------------------
function countUserUsage(coupon, userId) {
  if (!coupon.userUsage || coupon.userUsage.length === 0) return 0;
  return coupon.userUsage.filter(
    (u) => u.user && u.user.toString() === userId.toString()
  ).length;
}

// ---------------------------
// computeDiscountForCouponOnCart
// (stub — implement your business rules)
// ---------------------------
function computeDiscountForCouponOnCart(coupon, cart, productsMap) {
  let discount = 0;
  let applicableCartValue = 0;
  let breakdown = [];
  let applicableItems = [];
  let minCartNotMet = false;

  for (const item of cart) {
    const product = productsMap[item.productId];
    if (!product) continue;

    const subtotal = item.price * item.quantity;

    // --- restriction checks ---
    const sellerAllowed =
      !coupon.sellers?.length ||
      coupon.sellers.some((s) => s.toString() === product.seller.toString());

    const productAllowed =
      !coupon.applicableProducts?.length ||
      coupon.applicableProducts.some((p) => p.toString() === product._id.toString());

    const categoryAllowed =
      !coupon.applicableCategories?.length ||
      coupon.applicableCategories.some((c) => c.toString() === product.category.toString());

    if (!sellerAllowed || !productAllowed || !categoryAllowed) {
      continue; // ❌ not eligible for this coupon
    }

    applicableCartValue += subtotal;

    // --- percentage discount ---
    if (coupon.discountType === "percentage") {
      let itemDiscount = (subtotal * coupon.discountValue) / 100;

      // cap discount if maxDiscount is set
      if (coupon.maxDiscount && itemDiscount > coupon.maxDiscount) {
        itemDiscount = coupon.maxDiscount;
      }

      discount += itemDiscount;
      breakdown.push({ productId: product._id, discount: itemDiscount });
      applicableItems.push(product._id);
    }

    // --- fixed discount ---
    if (coupon.discountType === "fixed") {
      const itemDiscount = coupon.discountValue;
      discount += itemDiscount;
      breakdown.push({ productId: product._id, discount: itemDiscount });
      applicableItems.push(product._id);
    }
  }

  if (coupon.minCartValue && applicableCartValue < coupon.minCartValue) {
    minCartNotMet = true;
  }

  return { discount, breakdown, applicableCartValue, applicableItems, minCartNotMet };
}

// ---------------------------
// Export properly
// ---------------------------
module.exports = {
  getProductsForCart,
  countUserUsage,
  computeDiscountForCouponOnCart,
};
