// models/chatmodel/Message.js
const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  conversation: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation", required: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

  type: { type: String, enum: ["text", "image", "file", "system"], default: "text" },
  text: { type: String },
  attachments: [{ type: String }],

  status: { type: String, enum: ["sent", "delivered", "seen"], default: "sent" },
  seenBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  deletedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
}, { timestamps: true });

module.exports = mongoose.model("Message", messageSchema);
