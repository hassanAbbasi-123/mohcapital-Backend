const express = require('express');
const router = express.Router();
const { protect, isAdmin, isSeller } = require('../middleware/authMiddleware');
const { analyticsController } = require('../controllers/indexController');

// ---------- ADMIN ANALYTICS ROUTES ----------

// 1) Get Dashboard Overview (Admin)
router.get('/admin/dashboard', protect, isAdmin, analyticsController.getAdminDashboard);

// 2) Get Sales Reports (Admin)
router.get('/admin/sales-report', protect, isAdmin, analyticsController.getSalesReport);

// 3) Get Product Performance Report (Admin)
router.get('/admin/product-performance', protect, isAdmin, analyticsController.getProductPerformance);

// 4) Get Customer Analytics (Admin)
router.get('/admin/customer-analytics', protect, isAdmin, analyticsController.getCustomerAnalytics);

// 5) Get Financial Reports (Admin)
router.get('/admin/financial-report', protect, isAdmin, analyticsController.getFinancialReport);

// ---------- SELLER ANALYTICS ROUTES ----------

// 1) Get Seller Dashboard
router.get('/seller/dashboard', protect, isSeller, analyticsController.getSellerDashboard);

// 2) Get Seller Sales Report
router.get('/seller/sales-report', protect, isSeller, analyticsController.getSellerSalesReport);

// 3) Get Seller Product Performance
router.get('/seller/product-performance', protect, isSeller, analyticsController.getSellerProductPerformance);

// 4) Get Seller Order Analytics
router.get('/seller/order-analytics', protect, isSeller, analyticsController.getSellerOrderAnalytics);

// 5) Get Seller Customer Insights
router.get('/seller/customer-insights', protect, isSeller, analyticsController.getSellerCustomerInsights);

module.exports = router;