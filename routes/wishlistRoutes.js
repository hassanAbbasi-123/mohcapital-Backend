// routes/wishlistRoutes.js
const express = require("express");
const router = express.Router();
const wishlistController = require("../controllers/wishlistController");
const { protect, isAdmin } = require("../middleware/authMiddleware");

//Note: indexmodel: http://localhost/route/wishlistroutes

//   USER ROUTES


// Add product to user's wishlist[[user id getting from token]]
// POST  /wishlist/add
router.post("/user/add-to-wishlist", protect, wishlistController.addToWishlist);

// Remove product from user's wishlist (soft by default, hard if query/body sets hard=true)
// PATCH /wishlistremove
router.patch("/user/remove-from-wishlist", protect, wishlistController.removeFromWishlist);

// Get user's wishlist (query: includeRemoved=true to include removed items)
// GET   /wishlist
router.get("/user/get-wishlist", protect, wishlistController.getWishlistByUser);

// Clear user's wishlist (query: hard=true to hard-delete)
// DELETE /wishlist
router.delete("/user/clear-wishlist", protect, wishlistController.clearWishlist);


/* ==========================
   SELLER ROUTES (analytics/read-only)
   ==========================*/

// Get wishlist stats / top wishlisted products for a seller
// GET /wishlist/seller/:sellerId?limit=10
// Note: route is protected; controller allows admin or the seller themselves
router.get("/seller/wishlist-analytics", protect, wishlistController.getSellerWishlistStats);


/* ==========================
   ADMIN ROUTES
   ==========================*/

// View all wishlists (paginated)
// GET /wishlist/admin/wishlists?page=1&limit=20
router.get("/admin/get-all-wishlists", protect, isAdmin, wishlistController.getAllWishlistsAdmin);

// Remove a product from ALL wishlists (moderation)
// POST /wishlist/admin/wishlists/remove-product
// Body: { productId, hard?: boolean }
router.post("/admin/remove-product-from-wishlists", protect, isAdmin, wishlistController.removeProductFromAllWishlistsAdmin);

// Top wishlisted products site-wide
// GET /wishlist/admin/wishlists/top-products?limit=20
router.get("/admin/top-wishlists-products", protect, isAdmin, wishlistController.getTopWishlistedProductsAdmin);

// Wishlist activity snapshot
// GET /wishlist/admin/wishlists/activity?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
router.get("/admin/wishlists/activity", protect, isAdmin, wishlistController.getWishlistActivityAdmin);

// Top sellers by wishlist adds
// GET /wishlist/admin/wishlists/top-sellers?limit=10
router.get("/admin/top-sellers-by-wishlists", protect, isAdmin, wishlistController.getTopSellersByWishlistAdmin);

// Top categories by wishlist adds
// GET /wishlist/admin/wishlists/top-categories?limit=10
router.get("/admin/top-categories-wishlists", protect, isAdmin, wishlistController.getTopCategoriesByWishlistAdmin);

module.exports = router;
