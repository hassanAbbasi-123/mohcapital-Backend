// routes/profileRoutes.js
const express = require("express");
const router = express.Router();
const profileController = require("../controllers/profileController");
const { protect } = require("../middleware/authMiddleware");
const { profileUpload, profilePictureUpload } = require("../config/multer"); // ✅ use centralized multer

// ===== Routes =====

// @route   GET /api/profile
// @desc    Get user profile (user + seller profile if applicable)
// @access  Private
router.get("/profile", protect, profileController.getProfile);

// @route   PUT /api/profile
// @desc    Update user profile + seller profile (if seller)
// @access  Private
router.put(
  "/update-profile",
  protect,
  profileUpload, // ✅ handles logo + documents
  profileController.updateProfile
);

// @route   PUT /api/profile/change-password
// @desc    Change user password
// @access  Private
router.put("/change-password", protect, profileController.changePassword);

// @route   POST /api/profile/upload-picture
// @desc    Upload profile picture
// @access  Private
router.post(
  "/upload-picture",
  protect,
  profilePictureUpload, // ✅ handles profile picture
  profileController.uploadProfilePicture
);

module.exports = router;
