// models/chatmodel/conversationModel.js
const mongoose = require("mongoose");

const conversationSchema = new mongoose.Schema(
  {
    // keep buyer/seller for 1:1 clarity, and also store participants for flexibility
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // general participants array (useful for group chats or generic queries)
    participants: [
      { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    ],

    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", default: null },

    lastMessage: { type: String, default: "" },
    lastMessageAt: { type: Date, default: Date.now },

    status: {
      type: String,
      enum: ["active", "blocked", "closed"],
      default: "active",
    },

    blockedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Conversation", conversationSchema);
