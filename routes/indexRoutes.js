const express = require("express");
const router = express.Router();

// Importing route modules
const authRoutes = require("./authRoutes");
const categoryRoutes = require("./categoryRoutes");
const productRoutes = require("./productRoutes");
const brandRoutes = require("./brandRoutes");
const couponRoutes = require("./couponRoutes");
const wishlistRoutes=require("./wishlistRoutes");
const cartRoutes=require("./cartRoutes");
const orderRoutes=require("./orderRoutes");
const reviewRoutes=require("./reviewRoutes");
const chatRoutes=require("./chatRoutes");
const analyticsRoutes=require("./analyticsRoutes");
const inventoryRoutes=require("./inventoryRoutes");
const profileRoutes=require("./profileRoutes");
const usermanageRoutes=require("./usermanageRoutes");
const sellermanageRoutes=require("./sellermanageRoutes");
const bannerRoutes=require("./bannerRoutes");
const leadRoutes=require("./leadRoutes")
// Using route modules
router.use("/auth", authRoutes);
router.use("/categories", categoryRoutes);
router.use("/products", productRoutes);
router.use("/brands", brandRoutes);
router.use("/coupons", couponRoutes);
router.use("/wishlist",wishlistRoutes);
router.use("/cart",cartRoutes);
router.use("/order",orderRoutes);
router.use("/review",reviewRoutes);
router.use("/chat",chatRoutes);
router.use("/analytics",analyticsRoutes);
router.use("/inventory",inventoryRoutes);
router.use("/profile",profileRoutes); 
router.use("/user-management",usermanageRoutes);
router.use("/seller-management",sellermanageRoutes);
router.use("/banners",bannerRoutes);
router.use("/leads",leadRoutes);
module.exports = router;