const express = require("express");
const router = express.Router();
const accountController = require("../controllers/accountController");
const { protect, isAdmin, isCustomer } = require("../middleware/authMiddleware");

// Public routes
router.post("/customer-login", accountController.customerLogin);

// Protect all routes below
router.use(protect);

// Admin only routes
router.get("/admin/customers", isAdmin, accountController.getAllCustomers);
router.post("/admin/customers", isAdmin, accountController.createCustomer);
router.get("/admin/customers/:id", isAdmin, accountController.getCustomer);
router.patch("/admin/customers/:id", isAdmin, accountController.updateCustomer);
router.delete("/admin/customers/:id", isAdmin, accountController.deleteCustomer);
router.patch("/admin/customers/:id/toggle-status", isAdmin, accountController.toggleCustomerStatus);
router.get("/admin/customers/:id/ledger", isAdmin, accountController.getCustomerLedger);
router.post("/admin/customers/:id/purchases", isAdmin, accountController.createPurchase);
router.put("/admin/customers/:id/purchases/:transactionId", isAdmin, accountController.updatePurchase); // NEW: Update purchase
router.post("/admin/customers/:id/payments", isAdmin, accountController.makePayment);

// Inventory Management
router.get("/admin/inventory", isAdmin, accountController.getInventory);
router.post("/admin/inventory", isAdmin, accountController.addInventory);
router.patch("/admin/inventory/:id", isAdmin, accountController.updateInventory);

// Enhanced Functionality
router.post("/admin/stock-purchase", isAdmin, accountController.addStockPurchase);
router.post("/admin/expenses", isAdmin, accountController.addExpense);
router.post("/admin/commissions", isAdmin, accountController.addCommission);
router.post("/admin/damaged-goods", isAdmin, accountController.addDamagedGoods);
router.post("/admin/bully-purchase", isAdmin, accountController.addBullyPurchase);
router.post("/admin/reminders", isAdmin, accountController.addReminder);

// Reports
router.get("/admin/profit-loss", isAdmin, accountController.getProfitLossReport);
router.get("/admin/low-stock-alerts", isAdmin, accountController.getLowStockAlerts);

// Transactions
router.get("/admin/customers/:id/transactions", isAdmin, accountController.getCustomerTransactions);
router.get("/admin/customers/:id/ledger/pdf", isAdmin, accountController.downloadLedgerPDF);

// Customer routes
router.get("/customer/my-ledger", isCustomer, accountController.getMyLedger);
router.get("/customer/my-transactions", isCustomer, accountController.getMyTransactions);
router.get("/customer/my-ledger/pdf", isCustomer, accountController.downloadMyLedgerPDF);

module.exports = router;