// routes/reviewRoutes.js
const express = require("express");
const router = express.Router();
const reviewController = require("../controllers/reviewController");
const { protect, isAdmin, isSeller } = require("../middleware/authMiddleware");

/**
 * Public / User routes
 * NOTE: route order matters. Keep specific routes before routes with ':id'
 */

// Get reviews for a product (public). Admin can pass ?all=true when authenticated to get all statuses.
router.get("/user/get-product-review/:productId", protectOptional, reviewController.getProductReviews);

// Create review (user must be logged in)
router.post("/user/add-review", protect, reviewController.addReview);

// Update review (owner or admin)
router.put("/user/update-review/:id", protect, reviewController.updateReview);

// Delete own review (owner or admin)
router.delete("/user/delete-review/:id", protect, reviewController.deleteReview);

// Mark helpful (logged-in user)
router.post("/user/mark-helpful/:id", protect, reviewController.markHelpful);



// Seller routes
router.get("/seller/my-reviews", protect, isSeller, reviewController.getSellerReviews);



// Admin routes:
//approve Review
router.put("/admin/moderate-review/:id", protect, isAdmin, reviewController.moderateReview);
//Delete Review
router.delete("/admin/delete-review/:id", protect, isAdmin, reviewController.deleteAnyReview);
//Get-All-Reviews
router.get("/admin/get-all-reviews", protect, isAdmin, reviewController.getAllReviews);

module.exports = router;

/**
 * Helper middleware: protectOptional
 * Allows route to be called publicly but attempts to attach user if token present.
 * If you do not want public with optional auth, remove this and use reviewController.getProductReviews directly.
 */
function protectOptional(req, res, next) {
  try {
    // If Authorization header exists, try to verify and attach user like your protect middleware.
    if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
      const jwt = require("jsonwebtoken");
      const { User } = require("../models/indexModel"); // ensure indexModel exports User
      const token = req.headers.authorization.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      User.findById(decoded.id)
        .select("-password")
        .then((user) => {
          if (user) {
            req.user = user;
          }
          next();
        })
        .catch(() => next());
    } else {
      next();
    }
  } catch (err) {
    // token invalid => proceed as unauthenticated
    next();
  }
}
