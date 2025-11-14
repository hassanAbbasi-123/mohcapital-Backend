const express = require("express");
const router = express.Router();
const stockController = require("../controllers/inventoryController");
const { protect, isAdmin, isSeller } = require("../middleware/authMiddleware");

// ================== 📌 SELLER & ADMIN ROUTES ==================

// Seller routes
router.get("/stock/my-inventory",protect, isSeller, stockController.getMyInventory);
router.patch("/stock/:id/update-quantity",protect, isSeller, stockController.updateQuantity);
router.patch("/seller/add-stock/:id",protect, isSeller, stockController.addStock);
router.patch("/seller/remove-stock/:id",protect, isSeller, stockController.removeStock);
router.patch("/seller/toggle-stock/:id",protect, isSeller, stockController.toggleInStock);
router.get("/seller/stock-history/:id",protect, isSeller, stockController.getStockHistory);

// Admin routes
router.get("/admin/stock/all",protect, isAdmin, stockController.getAllInventory);
router.get("/admin/get-seller-inventory/:sellerId", protect,isAdmin, stockController.getSellerInventory);


module.exports = router;