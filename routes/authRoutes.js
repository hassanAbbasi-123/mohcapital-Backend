// routes/authRoutes.js
const express = require("express");
const router = express.Router();
const { authController } = require("../controllers/indexController");
const { authUpload } = require("../config/multer"); // ← Use named export
const { protect } = require("../middleware/authMiddleware");

// REGISTER (seller + user)
router.post("/register", authUpload, authController.register);

// APPROVE / REJECT SELLER (admin only)
router.patch(
  "/approve-seller/:sellerId",
  protect,
  (req, res, next) => {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }
    next();
  },
  authController.approveOrDisapproveSeller
);

// LOGIN
router.post("/login", authController.login);

module.exports = router;