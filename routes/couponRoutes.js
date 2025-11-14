// routes/couponRoutes.js
const express = require("express");
const router = express.Router();
const couponController = require("../controllers/couponController");
const { protect, isAdmin, isSeller } = require("../middleware/authMiddleware");


// ---------------- ADMIN ROUTES ---------------- //
router.post("/admin/create-coupon", protect, isAdmin, couponController.createCouponAdmin);
router.put("/admin/update-coupon/:id", protect, isAdmin, couponController.updateCouponAdmin);
router.patch("/admin/toggle/:id", protect, isAdmin, couponController.toggleCouponAdmin);
router.delete("/admin/delete-coupon/:id", protect, isAdmin, couponController.deleteCouponAdmin);
router.get("/admin/get-all-coupon", protect, isAdmin, couponController.getAllCouponsAdmin);


// ---------------- SELLER ROUTES ---------------- //
router.post("/seller/create-coupon", protect, isSeller, couponController.createCouponSeller);
router.put("/seller/update-coupon/:id", protect, isSeller, couponController.updateCouponSeller);
router.patch("/seller/toggle-coupon/:id", protect, isSeller, couponController.toggleCouponSeller);
router.delete("/seller/delete-coupon/:id", protect, isSeller, couponController.deleteCouponSeller);
router.get("/seller/get-own-coupons", protect, isSeller, couponController.getCouponsSeller);


// ---------------- USER ROUTES ---------------- //
router.post("/user/apply-coupon", protect, couponController.applyCoupon);
router.get("/user/available-coupon", protect, couponController.getAvailableCoupons);

// ---------------- REFUND / ROLLBACK ROUTE ---------------- //
router.post("/user/rollback-coupon/:id", protect, couponController.rollbackCouponUsage);

module.exports = router;
