// /models/payoutModel.js
const mongoose = require("mongoose");

const payoutSchema = new mongoose.Schema(
  {
    seller: { type: mongoose.Schema.Types.ObjectId, ref: "SellerProfile", required: true },
    amount: { type: Number, required: true, min: 1 },
    method: { type: String, enum: ["Bank", "Easypaisa", "JazzCash", "Manual"], required: true },
    accountMeta: { type: Object }, // account number, name, etc.
    status: { type: String, enum: ["requested", "approved", "rejected", "processing", "paid"], default: "requested" },
    adminNote: { type: String },
  },
  { timestamps: true }
);

payoutSchema.index({ seller: 1, createdAt: -1 });
payoutSchema.index({ status: 1 });

module.exports = mongoose.model("Payout", payoutSchema);
