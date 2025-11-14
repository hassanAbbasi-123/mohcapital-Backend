// routes/sellerRoutes.js
const express = require("express");
const router = express.Router();
const {
  getSellerApplications,
  getSellerPerformance,
  approveOrDisapproveSeller,   // <-- moved from authController
} = require("../controllers/sellerManagementController");
const { protect } = require("../middleware/authMiddleware");

// ---------------------------------------------------------------------
// All routes require a logged-in user (admin for most)
// ---------------------------------------------------------------------
router.use(protect);

/**
 * GET  /seller-management/admin/sellers
 *   →  getSellerApplications (admin only)
 */
router.get("/admin/sellers", getSellerApplications);

/**
 * PATCH  /seller-management/admin/approve-seller/:sellerId
 *   →  approveOrDisapproveSeller (admin only)
 *   body: { action: "approve" | "reject" }
 */
router.patch("/admin/approve-seller/:sellerId", approveOrDisapproveSeller);

/**
 * GET  /seller-management/admin/seller-performance/:sellerId
 *   →  getSellerPerformance (admin or the seller themselves)
 */
router.get("/admin/seller-performance/:sellerId", getSellerPerformance);

module.exports = router;