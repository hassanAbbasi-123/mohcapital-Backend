// backend/routes/bannerRoutes.js
const express = require("express");
const router = express.Router();
const upload = require("../config/multer");

const {
  getAllBanners,
  getActiveBanners,
  createBanner,
  updateBanner,
  deleteBanner,
  toggleStatus,
} = require("../controllers/bannerController");

// ==========================
// Public Routes
// ==========================

// Fetch all active banners (for frontend display)
router.get("/active", getActiveBanners);

// ==========================
// Admin Routes (Protected)
// ==========================

// Get all banners (admin dashboard)
router.get("/get-all-banners", getAllBanners);

// Create a new banner (with image upload)
router.post("/create-banners", upload.single("image"), createBanner);

// Update an existing banner (with optional image upload)
router.put("/update-banners/:id", upload.single("image"), updateBanner);

// Delete a banner by ID
router.delete("/delete-banners/:id", deleteBanner);

// Toggle active/inactive status
router.patch("/toggle-status/:id", toggleStatus);

module.exports = router;