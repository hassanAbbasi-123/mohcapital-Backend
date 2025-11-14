// /models/sellerWalletModel.js
const mongoose = require("mongoose");

const walletTxnSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["credit", "debit", "hold", "release", "refund", "payout"], required: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "PKR" },
    reference: { type: String }, // e.g., order/suborder id
    meta: { type: Object },
  },
  { timestamps: true }
);

const sellerWalletSchema = new mongoose.Schema(
  {
    seller: { type: mongoose.Schema.Types.ObjectId, ref: "SellerProfile", unique: true, required: true },
    balance: { type: Number, default: 0 },         // available for withdrawal
    onHold: { type: Number, default: 0 },          // escrow
    pendingPayout: { type: Number, default: 0 },   // queued
    transactions: [walletTxnSchema],
  },
  { timestamps: true }
);

sellerWalletSchema.index({ seller: 1 });

module.exports = mongoose.model("SellerWallet", sellerWalletSchema);
