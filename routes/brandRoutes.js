const express = require("express");
const router = express.Router();
const {brandController} = require("../controllers/indexController");
const { protect, isAdmin, isSeller } = require("../middleware/authMiddleware");
const upload = require("../config/multer"); // ✅ centralized multer
// ================ Seller Routes =================
// ✅ Seller can propose/create a brand
router.post(
  "/seller/create-brand",
  protect,
  isSeller,
  upload.single("logo"),
  brandController.createBrand
);
// ✅ Seller can update own brand (rules applied in controller)
router.put(
  "/seller/update-brand/:brandId",
  protect,
  isSeller,
  upload.single("logo"),
  brandController.updateBrandBySeller
);
// ✅ Seller can delete own brand (only if pending/not linked to products)
router.delete(
  "/seller/delete-brand/:brandId",
  protect,
  isSeller,
  brandController.deleteBrandBySeller
);
// ✅ Seller can view all approved + active brands
router.get(
  "/seller/get-approved-brands",
  protect,
  isSeller,
  brandController.getApprovedBrandsForSeller
);

// ================= Admin Routes =================
// ✅ Admin can create brand directly (with logo upload)and auto-approved/featured
router.post(
  "/admin/create-feature-brand",
  protect,
  isAdmin,
  upload.single("logo"),
  brandController.addBrandByAdmin
);
// ✅ Approve/Reject brand
router.put("/admin/approve-brand/:brandId", protect, isAdmin, brandController.approveBrand);
// ✅ Admin can update any brand details (with logo upload)
router.put(
  "/admin/update-brand/:brandId",
  protect,
  isAdmin,
  upload.single("logo"),
  brandController.updateBrandByAdmin
);
// ✅ Admin can delete brands
router.delete("/admin/delete-brand/:brandId", protect, isAdmin, brandController.deleteBrandByAdmin);
// ✅ Feature/unfeature a brand
router.put("/admin/feature-brand/:brandId", protect, isAdmin, brandController.toggleFeatured);
// ✅ Analytics (e.g., product count under each brand)
router.get("/admin/brand-analytics", protect, isAdmin, brandController.getBrandAnalytics);
// ✅ Get all brands for admin (including pending)
router.get("/admin/get-all-brands", protect, isAdmin, brandController.getAllBrandsForAdmin);
// ================= User/Public Routes =================
// ✅ Get all approved & active brands
router.get("/user/get-active-brands", brandController.getBrands);
// ✅ Get featured brands (for homepage slider etc.)
router.get("/user/feature-brands", brandController.getFeaturedBrands);
// ✅ Get brand details by slug (with products)
router.get("/user/get-brands-details/:slug", brandController.getBrandDetails);
module.exports = router;