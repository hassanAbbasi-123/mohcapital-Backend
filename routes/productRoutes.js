// routes/productRoutes.js
const express = require("express");
const router = express.Router();

const {upload,productUpload } = require("../config/multer"); // ✅ multer instance
const { protect, isAdmin, isSeller,optionalAuth } = require("../middleware/authMiddleware");
const productController = require("../controllers/productController");



// router.get("/get-products-by-slug/:slug", productController.getProductBySlug);

//  ADMIN ROUTES
// Get all products
router.get(
  "/admin/get-all-products",
  protect,
  isAdmin,
  productController.getAllProducts
);
// Approve product
router.patch(
  "/admin/approve-products/:id",
  protect,
  isAdmin, 
  productController.approveProduct
);
// Reject product
router.patch(
  "/admin/reject-products/:id",
  protect,
  isAdmin,
  productController.rejectProduct
);
// Delete product
router.delete(
  "/admin/delete-product/:id",
  protect,
  isAdmin,
  productController.deleteProduct
);
//  Assign coupon to product()
router.patch(
  "/admin/assign-products-coupons/:id",
  protect,
  isAdmin,
  productController.assignCouponToProduct
);

//  Remove coupon from product
router.delete(
  "/admin/remove-coupons-products/:id",
  protect,
  isAdmin,
  productController.removeCouponFromProduct
);


// ===============================
// 📌 SELLER ROUTES
// ===============================

// ✅ Create new product (with image upload)
router.post(
  "/seller/add-products",
  protect,
  isSeller,
  productUpload, // ✅ handles both "image" + "gallery"
  productController.createProduct
);
// ✅ Update own product (with image upload)
router.patch(
  "/seller/update-products/:id",
  protect,
  isSeller,
  productUpload,
  productController.updateOwnProduct
);
// ✅ Delete own product
router.delete(
  "/seller/delet-products/:id",
  protect,
  isSeller,
  productController.deleteOwnProduct
);
// ✅ Toggle stock
router.patch(
  "/seller/products/:id/stock",
  protect,
  isSeller,
  productController.toggleStock
);
// ✅ Toggle sale
router.patch(
  "/seller/onsale-products/:id",
  protect,
  isSeller,
  productController.toggleSale
);
// ✅ Apply coupon
router.patch(
  "/seller/apply-coupon-onproduct/:id",
  protect,
  isSeller,
  productController.applyCoupon
);
//remove coupon
router.patch(
  "/seller/remove-coupon-fromproduct/:id",
  protect,
  isSeller,
  productController.removeCouponFromProduct
);
// ✅ Get my products
router.get(
  "/seller/get-seller-ownproducts",
  protect,
  isSeller,
  productController.getMyProducts
);

// ===============================
// 📌 USER ROUTES
// ===============================

// ✅ Get all approved products with filters
router.get("/products", optionalAuth, productController.getApprovedProducts);
// ✅ Get product by slug
router.get("/products/:slug", productController.getProductBySlug);
// ✅ Like / Unlike product
router.patch("/products/:id/like", protect, productController.likeProduct);
// ✅ Add review
router.post("/products/:id/review", protect, productController.addReview);
// ✅ Get wishlist (liked products)
router.get("/user/wishlist", protect, productController.getWishlist);

module.exports = router;
