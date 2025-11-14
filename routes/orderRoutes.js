const express = require("express");
const router = express.Router();

const orderController = require("../controllers/orderController");
const { protect, isAdmin, isSeller } = require("../middleware/authMiddleware");
const upload=require("../config/multer");


// ==========================
// 🔹 USER ROUTES (Buyer)
// ==========================
router.post("/user/create-orders", protect, orderController.createOrder);          // place order from cart
router.get("/user/get-my-orders", protect, orderController.getMyOrders);        // list logged-in user's orders
router.get("/user/get-my-order-by-id/:id", protect, orderController.getOrderDetails); // get single order details
router.put("/user/cancel-order/:id", protect, orderController.cancelOrder);       // cancel full order
router.put("/user/confirm-delivery/:id", protect, orderController.confirmDelivery); // confirm delivery
router.post("/user/request-return/:id", protect, orderController.requestReturn);   // request partial return
router.post(
  "/user/dispute/:id",
  protect,
  upload.array("attachments", 5), // max 5 attachments
  orderController.openDispute
);  
 // open dispute
router.post("/user/buy-now", protect, orderController.buyNow);

// ==========================
// 🔹 SELLER ROUTES
// ==========================
router.get("/seller/my-sales", protect, isSeller, orderController.getMySales);
router.put("/seller/update-item-status", protect, isSeller, orderController.updateItemStatus);
router.put("/seller/cancel-item/:orderId/:itemId", protect, isSeller, orderController.cancelItem);
// routes/orderRoutes.js
router.put(
  "/seller/confirm-cod",
  protect,
  isSeller,
  orderController.confirmPaymentCollection
);
router.put("/seller/add-tracking/:orderId", protect, isSeller, orderController.addTracking);


// ==========================
// 🔹 ADMIN ROUTES
// ==========================
router.get("/admin/get-all-orders", protect, isAdmin, orderController.getAllOrders);
router.put("/admin/update-status/:id", protect, isAdmin, orderController.updateOrderStatus);
router.post("/admin/refund/:id", protect, isAdmin, orderController.processRefund); // ⚠️ not yet in controller
router.delete("/admin/delete/:id", protect, isAdmin, orderController.deleteOrder); // ⚠️ not yet in controller


// ==========================
// 🔹 ADMIN ANALYTICS
// ==========================
 router.get("/admin/analytics/sales", protect, isAdmin, orderController.getOrderAnalytics);
// router.get("/admin/analytics/top-sellers", protect, isAdmin, orderController.getTopSellers);
// router.get("/admin/analytics/top-products", protect, isAdmin, orderController.getTopProducts);
// router.get("/admin/analytics/status-count", protect, isAdmin, orderController.getOrderStatusCount);



// 🔹 DISPUTES & RETURNS (Admin)
router.put(
  "/admin/dispute/:disputeId",
  protect,
  isAdmin,
  orderController.resolveDispute
);

router.put("/admin/return/:returnId", protect, isAdmin, orderController.updateReturnStatus);

module.exports = router;
