// routes/cartRoutes.js
const express = require("express");
const router = express.Router();
const CartController = require("../controllers/cartController");
const { protect, isAdmin, isSeller } = require("../middleware/authMiddleware");

// ====================== USER ======================

// View Cart
router.get("/user/get-cart", protect, CartController.getCart);

//get cart count for navbar

router.get("/user/cart-count",protect,CartController.getCartCount);
// Add Item to Cart
router.post("/user/add-to-cart", protect, CartController.addToCart);

// Update Item Quantity
router.put("/user/update-cart", protect, CartController.updateCartItem);

// Remove Item from Cart
router.delete("/user/remove-cart-item", protect, CartController.removeCartItem);

// Clear Entire Cart
router.delete("/user/clear-cart", protect, CartController.clearCart);

// Apply Coupon
router.post("/user/apply-coupon", protect, CartController.applyCouponToCart);

// Remove Coupon
router.delete("/user/remove-coupon", protect, CartController.removeCouponFromCart);

// Cart totals grouped by seller
// router.get("/user/cart-totals-by-seller", protect, CartController.getCartTotalsBySeller);

// ====================== SELLER ======================

// Seller insights: which of their products are in carts
router.get("/seller/cart-insights", protect, isSeller, CartController.getSellerCartInsights);

// ====================== ADMIN ======================

// View all carts
router.get("/admin/all-carts", protect, isAdmin, CartController.getAllCarts);
router.get("/admin/top-sellers", protect, isAdmin, CartController.getTopSellersByCart);
router.get("/admin/top-products", protect, isAdmin, CartController.getTopProductsByCart);
router.get("/admin/revenue-projection", protect, isAdmin, CartController.getRevenueProjection);


module.exports = router;
