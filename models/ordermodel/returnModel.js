// /models/returnModel.js
const mongoose = require("mongoose");

const returnRequestSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
    subOrder: { type: mongoose.Schema.Types.ObjectId, ref: "SubOrder" },
    itemId: { type: mongoose.Schema.Types.ObjectId, required: true }, // Order.items._id
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: "SellerProfile", required: true },
    quantity: { type: Number, required: true, min: 1 },
    reason: { type: String, required: true },
    status: { type: String, enum: ["requested", "approved", "rejected", "received", "refunded"], default: "requested" },
    adminNote: { type: String },
    photos: [{ url: String, name: String }],
    refundAmount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

returnRequestSchema.index({ order: 1 });
returnRequestSchema.index({ seller: 1, createdAt: -1 });
returnRequestSchema.index({ status: 1 });

module.exports = mongoose.model("ReturnRequest", returnRequestSchema);
