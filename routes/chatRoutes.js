const express = require("express");
const router = express.Router();
const chatController = require("../controllers/chatController");
const { protect, isAdmin, isSeller } = require("../middleware/authMiddleware");

// 🔹 User routes
router.post("/user/start-conversation", protect, chatController.startConversation);
router.get("/user/get-conversations", protect, chatController.getUserConversations);
router.patch("/conversation/:conversationId/block-seller", protect, chatController.blockSeller);

// 🔹 Seller routes
router.get("/conversations/seller", protect, isSeller, chatController.getSellerConversations);
router.get("/conversation/:id", protect, isSeller, chatController.viewConversation);
router.patch("/conversation/:conversationId/block-buyer", protect, isSeller, chatController.blockBuyer);

// 🔹 Messages (both sides)
// router.post("/message/send", protect, chatController.sendMessage);
router.get("/messages/:conversationId", protect, chatController.getMessages);
router.patch("/messages/:conversationId/seen", protect, chatController.markAsSeen);
router.delete("/message/:messageId", protect, chatController.deleteMessage);

// 🔹 Admin routes
router.get("/admin/conversations", protect, isAdmin, chatController.getAllConversations);
router.get("/admin/conversation/:id", protect, isAdmin, chatController.getConversationById);
router.delete("/admin/message/:messageId", protect, isAdmin, chatController.deleteMessageAdmin);
router.post("/admin/message/:messageId/flag", protect, isAdmin, chatController.flagMessage);

module.exports = router;
