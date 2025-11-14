const mongoose = require("mongoose");
const Review = require("../models/reviewModel");
const Product = require("../models/productModel");
const { SellerProfile } = require("../models/indexModel");
const User = require("../models/userModel");
const Order = require("../models/ordermodel/orderModel");

// --- Constants/Enums ---
const REVIEW_STATUSES = Object.freeze({
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  DELETED: "deleted",
});

// --- Middleware to ensure req.user is always defined ---
function ensureUser(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized: user not found" });
  }
  next();
}

// --- Helper: Validate ObjectId ---
function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

// --- Helper: Sanitize and validate comment ---
function sanitizeComment(comment) {
  if (typeof comment !== "string") return "";
  // Remove dangerous HTML, trim, limit length
  let sanitized = comment.replace(/<[^>]*>?/gm, "").trim();
  if (sanitized.length > 1000) sanitized = sanitized.slice(0, 1000);
  return sanitized;
}

// --- Helper: Recalculate product average rating and reviewCount (with optional cache) ---
async function updateProductRating(productId, session = null) {
  if (!productId) return;
  const prodObjectId = new mongoose.Types.ObjectId(productId);

  const stats = await Review.aggregate([
    { $match: { product: prodObjectId, status: REVIEW_STATUSES.APPROVED } },
    {
      $group: {
        _id: "$product",
        avgRating: { $avg: "$rating" },
        count: { $sum: 1 },
      },
    },
  ]);
  if (stats.length > 0) {
    const avg = Number(Number(stats[0].avgRating).toFixed(1));
    await Product.findByIdAndUpdate(
      productId,
      { rating: avg, reviewCount: stats[0].count },
      { new: true, session }
    );
    // Optionally: cache rating in Redis or memory here
  } else {
    await Product.findByIdAndUpdate(
      productId,
      { rating: 0, reviewCount: 0 },
      { new: true, session }
    );
    // Optionally: cache rating in Redis or memory here
  }
}

// --- Add Review ---
exports.addReview = [
  ensureUser,
  async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { productId, rating, comment } = req.body;

      // Validate productId
      if (!productId || !isValidObjectId(productId)) {
        await session.abortTransaction();
        return res.status(400).json({ message: "Valid productId is required" });
      }

      // Validate rating
      const parsedRating = Number(rating);
      if (
        Number.isNaN(parsedRating) ||
        parsedRating < 1 ||
        parsedRating > 5
      ) {
        await session.abortTransaction();
        return res.status(400).json({
          message: "rating is required and must be a number between 1 and 5",
        });
      }

      // Prevent duplicate reviews
      const existingReview = await Review.findOne(
        { product: productId, user: req.user._id },
        null,
        { session }
      );
      if (existingReview) {
        await session.abortTransaction();
        return res.status(400).json({ message: "You have already reviewed this product" });
      }

      // Fetch product with seller
      const product = await Product.findById(productId).populate("seller").session(session);
      if (!product) {
        await session.abortTransaction();
        return res.status(404).json({ message: "Product not found" });
      }
      if (!product.seller) {
        await session.abortTransaction();
        return res.status(400).json({
          message: "This product has no seller assigned. Please contact admin.",
        });
      }

      // Check verified purchase
      const order = await Order.findOne(
        {
          user: req.user._id,
          orderStatus: { $in: ["delivered", "completed"] },
          "items.product": productId,
        },
        null,
        { session }
      );

      // Sanitize comment
      const safeComment = sanitizeComment(comment);

      // Create review
      const review = new Review({
        product: productId,
        seller: product.seller._id,
        user: req.user._id,
        rating: parsedRating,
        comment: safeComment,
        verifiedPurchase: !!order,
      });

      await review.save({ session });

      // Populate for response
      await review.populate([
        { path: "user", select: "name email" },
        { path: "seller", select: "storeName user" },
        { path: "product", select: "name slug" },
      ]);

      // Update product rating if auto-approved
      if (review.status === REVIEW_STATUSES.APPROVED) {
        await updateProductRating(productId, session);
      }

      await session.commitTransaction();
      return res.status(201).json({
        message: "Review submitted successfully",
        review,
      });
    } catch (error) {
      await session.abortTransaction();
      console.error("❌ Error adding review:", error);
      return res.status(500).json({
        message: "Error adding review",
        error: error.message,
      });
    } finally {
      session.endSession();
    }
  }
];

// --- Update Review ---
exports.updateReview = [
  ensureUser,
  async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { id } = req.params;
      const { rating, comment, status } = req.body;

      if (!isValidObjectId(id)) {
        await session.abortTransaction();
        return res.status(400).json({ message: "Invalid review id" });
      }

      const review = await Review.findById(id).session(session);
      if (!review) {
        await session.abortTransaction();
        return res.status(404).json({ message: "Review not found" });
      }

      // Authorization: only review owner or admin can update
      if (
        String(review.user) !== String(req.user._id) &&
        req.user.role !== "admin"
      ) {
        await session.abortTransaction();
        return res.status(403).json({ message: "Not authorized to update this review" });
      }

      const oldStatus = review.status;
      const oldRating = review.rating;

      // Prevent editing deleted reviews unless admin is restoring
      if (oldStatus === REVIEW_STATUSES.DELETED && req.user.role !== "admin") {
        await session.abortTransaction();
        return res.status(400).json({ message: "Deleted reviews cannot be updated" });
      }

      // Rating update
      if (rating !== undefined) {
        const parsed = Number(rating);
        if (Number.isNaN(parsed) || parsed < 1 || parsed > 5) {
          await session.abortTransaction();
          return res.status(400).json({ message: "Rating must be a number between 1 and 5" });
        }
        review.rating = parsed;
      }

      // Comment update
      if (comment !== undefined) {
        review.comment = sanitizeComment(comment);
      }

      // Status update
      if (status !== undefined) {
        const allowedStatuses = [
          REVIEW_STATUSES.PENDING,
          REVIEW_STATUSES.APPROVED,
          REVIEW_STATUSES.REJECTED,
        ];
        if (req.user.role === "admin") {
          allowedStatuses.push(REVIEW_STATUSES.DELETED);
        }
        if (!allowedStatuses.includes(status)) {
          await session.abortTransaction();
          return res.status(400).json({ message: "Invalid status value" });
        }
        review.status = status;
      }

      await review.save({ session });

      // Recalculate product rating if needed
      const needRecalc =
        oldStatus !== review.status ||
        (oldRating !== review.rating && review.status === REVIEW_STATUSES.APPROVED) ||
        (oldStatus === REVIEW_STATUSES.APPROVED && review.status !== REVIEW_STATUSES.APPROVED);

      if (needRecalc) {
        await updateProductRating(review.product, session);
      }

      await review.populate([
        { path: "user", select: "name email" },
        { path: "seller", select: "storeName" },
        { path: "product", select: "name slug" },
      ]);

      await session.commitTransaction();
      return res.json({ message: "Review updated", review });
    } catch (error) {
      await session.abortTransaction();
      return res.status(500).json({ message: "Error updating review", error: error.message });
    } finally {
      session.endSession();
    }
  }
];

// --- Delete Review ---
exports.deleteReview = [
  ensureUser,
  async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { id } = req.params;
      if (!isValidObjectId(id)) {
        await session.abortTransaction();
        return res.status(400).json({ message: "Invalid review id" });
      }
      const review = await Review.findById(id).session(session);
      if (!review) {
        await session.abortTransaction();
        return res.status(404).json({ message: "Review not found" });
      }

      // Only owner or admin can attempt deletion
      const isOwner = String(review.user) === String(req.user._id);
      const isAdmin = req.user.role === "admin";

      if (!isOwner && !isAdmin) {
        await session.abortTransaction();
        return res.status(403).json({ message: "Not authorized to delete this review" });
      }

      // Prevent users (but not admins) from deleting approved reviews
      if (review.status === REVIEW_STATUSES.APPROVED && !isAdmin) {
        await session.abortTransaction();
        return res.status(400).json({ message: "You cannot delete an approved review" });
      }

      const wasApproved = review.status === REVIEW_STATUSES.APPROVED;
      const productId = review.product;

      await Review.findByIdAndDelete(id, { session });

      // Recalculate product rating only if admin deleted an approved review
      if (wasApproved) {
        await updateProductRating(productId, session);
      }

      await session.commitTransaction();
      return res.json({ message: "Review deleted" });
    } catch (error) {
      await session.abortTransaction();
      return res.status(500).json({ message: "Error deleting review", error: error.message });
    } finally {
      session.endSession();
    }
  }
];

// --- Mark Review as Helpful ---
exports.markHelpful = [
  ensureUser,
  async (req, res) => {
    try {
      const { id } = req.params;
      if (!isValidObjectId(id)) {
        return res.status(400).json({ message: "Invalid review id" });
      }
      const review = await Review.findById(id);
      if (!review) {
        return res.status(404).json({ message: "Review not found" });
      }

      // Prevent users from marking their own review as helpful
      if (String(review.user) === String(req.user._id)) {
        return res.status(400).json({ message: "You cannot mark your own review as helpful" });
      }

      // Check if user already marked as helpful
      if (review.helpfulBy && review.helpfulBy.includes(req.user._id)) {
        return res.status(400).json({ message: "You already marked this review as helpful" });
      }

      // Add user to helpfulBy and increment counter
      review.helpfulBy.push(req.user._id);
      review.helpfulCount = (review.helpfulCount || 0) + 1;

      await review.save();

      return res.json({
        message: "Marked as helpful",
        helpfulCount: review.helpfulCount,
      });
    } catch (error) {
      return res.status(500).json({
        message: "Error marking review helpful",
        error: error.message,
      });
    }
  }
];

// --- Get Product Reviews (with pagination) ---
exports.getProductReviews = [
  ensureUser,
  async (req, res) => {
    try {
      const { productId } = req.params;
      if (!isValidObjectId(productId)) {
        return res.status(400).json({ message: "Invalid product id" });
      }
      const includeAll = req.query.all === "true" && req.user && req.user.role === "admin";
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 10));
      const skip = (page - 1) * limit;

      const filter = { product: productId };
      if (!includeAll) {
        filter.status = REVIEW_STATUSES.APPROVED;
      }

      const [reviews, total] = await Promise.all([
        Review.find(filter)
          .populate("user", "name")
          .populate("seller", "storeName")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        Review.countDocuments(filter),
      ]);

      return res.json({
        reviews,
        page,
        totalPages: Math.ceil(total / limit),
        total,
      });
    } catch (error) {
      return res.status(500).json({ message: "Error fetching reviews", error: error.message });
    }
  }
];

// --- Get Seller Reviews (with pagination) ---
exports.getSellerReviews = [
  ensureUser,
  async (req, res) => {
    try {
      const sellerProfile = await SellerProfile.findOne({ user: req.user._id });
      if (!sellerProfile) {
        return res.status(404).json({ message: "Seller profile not found for this user" });
      }

      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 10));
      const skip = (page - 1) * limit;

      const filter = { seller: sellerProfile._id };

      if (
        req.query.status &&
        [
          REVIEW_STATUSES.PENDING,
          REVIEW_STATUSES.APPROVED,
          REVIEW_STATUSES.REJECTED,
        ].includes(req.query.status)
      ) {
        filter.status = req.query.status;
      } else {
        filter.status = { $ne: REVIEW_STATUSES.DELETED };
      }

      const [reviews, total] = await Promise.all([
        Review.find(filter)
          .populate("user", "name email")
          .populate("product", "name slug")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        Review.countDocuments(filter),
      ]);

      return res.json({
        reviews,
        page,
        totalPages: Math.ceil(total / limit),
        total,
      });
    } catch (error) {
      return res.status(500).json({ message: "Error fetching seller reviews", error: error.message });
    }
  }
];

// --- Moderate Review (Admin) ---
exports.moderateReview = [
  ensureUser,
  async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!isValidObjectId(id)) {
        await session.abortTransaction();
        return res.status(400).json({ message: "Invalid review id" });
      }
      if (![REVIEW_STATUSES.APPROVED, REVIEW_STATUSES.REJECTED].includes(status)) {
        await session.abortTransaction();
        return res.status(400).json({ message: "Invalid status. Use 'approved' or 'rejected'." });
      }

      const review = await Review.findById(id).session(session);
      if (!review) {
        await session.abortTransaction();
        return res.status(404).json({ message: "Review not found" });
      }

      const oldStatus = review.status;
      review.status = status;
      await review.save({ session });

      // If status changed in a way that affects product stats, recalc
      if (oldStatus !== status) {
        await updateProductRating(review.product, session);
      }

      await review.populate([
        { path: "user", select: "name email" },
        { path: "product", select: "name" },
      ]);

      await session.commitTransaction();
      return res.json({ message: `Review ${status}`, review });
    } catch (error) {
      await session.abortTransaction();
      return res.status(500).json({ message: "Error moderating review", error: error.message });
    } finally {
      session.endSession();
    }
  }
];

// --- Delete Any Review (Admin) ---
exports.deleteAnyReview = [
  ensureUser,
  async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const { id } = req.params;
      if (!isValidObjectId(id)) {
        await session.abortTransaction();
        return res.status(400).json({ message: "Invalid review id" });
      }
      const review = await Review.findById(id).session(session);
      if (!review) {
        await session.abortTransaction();
        return res.status(404).json({ message: "Review not found" });
      }

      const wasApproved = review.status === REVIEW_STATUSES.APPROVED;
      const productId = review.product;

      await Review.findByIdAndDelete(id, { session });

      if (wasApproved) {
        await updateProductRating(productId, session);
      }

      await session.commitTransaction();
      return res.json({ message: "Review deleted by admin" });
    } catch (error) {
      await session.abortTransaction();
      return res.status(500).json({ message: "Error deleting review", error: error.message });
    } finally {
      session.endSession();
    }
  }
];

// --- Get All Reviews (Admin, with pagination) ---
exports.getAllReviews = [
  ensureUser,
  async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 10));
      const skip = (page - 1) * limit;

      const filter = {};

      // Allow filtering by status, including "deleted"
      if (
        req.query.status &&
        [
          REVIEW_STATUSES.PENDING,
          REVIEW_STATUSES.APPROVED,
          REVIEW_STATUSES.REJECTED,
          REVIEW_STATUSES.DELETED,
        ].includes(req.query.status)
      ) {
        filter.status = req.query.status;
      } else {
        filter.status = { $ne: REVIEW_STATUSES.DELETED };
      }

      if (req.query.seller && isValidObjectId(req.query.seller)) filter.seller = req.query.seller;
      if (req.query.product && isValidObjectId(req.query.product)) filter.product = req.query.product;
      if (req.query.user && isValidObjectId(req.query.user)) filter.user = req.query.user;

      const [reviews, total] = await Promise.all([
        Review.find(filter)
          .populate("user", "name email")
          .populate("seller", "storeName")
          .populate("product", "name slug")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        Review.countDocuments(filter),
      ]);

      return res.json({
        reviews,
        page,
        totalPages: Math.ceil(total / limit),
        total,
      });
    } catch (error) {
      return res.status(500).json({ message: "Error fetching all reviews", error: error.message });
    }
  }
];
