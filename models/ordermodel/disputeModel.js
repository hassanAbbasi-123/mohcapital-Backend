// /models/disputeModel.js
const mongoose = require("mongoose");

const disputeSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
    subOrder: { type: mongoose.Schema.Types.ObjectId, ref: "SubOrder" },
    itemId: { type: mongoose.Schema.Types.ObjectId }, // Order.items._id (optional if dispute is order-level)
    openedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // buyer or admin
    againstSeller: { type: mongoose.Schema.Types.ObjectId, ref: "SellerProfile" },
    reason: { type: String, required: true },
    status: { type: String, enum: ["open", "in_review", "resolved_buyer", "resolved_seller", "cancelled"], default: "open" },
    resolution: { type: String },
     attachments: [{ type: String }],
  },
  { timestamps: true }
);

disputeSchema.index({ order: 1 });
disputeSchema.index({ againstSeller: 1 });
disputeSchema.index({ status: 1 });

module.exports = mongoose.model("Dispute", disputeSchema);
