// /models/subOrderModel.js
const mongoose = require("mongoose");

const subOrderSchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: "SellerProfile", required: true },
    items: [
      {
        orderItemId: { type: mongoose.Schema.Types.ObjectId, required: true }, // reference Order.items._id
        product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
        quantity: { type: Number, required: true, min: 1 },
        price: { type: Number, required: true, min: 0 },
        discount: { type: Number, default: 0 },
        subtotal: { type: Number, required: true, min: 0 },
        taxAmount: { type: Number, default: 0 },
        shippingFee: { type: Number, default: 0 },
        status: {
          type: String,
          enum: ["pending", "paid", "shipped", "delivered", "cancelled", "return_requested", "returned"],
          default: "pending",
        },
        trackingNumber: { type: String },
      },
    ],
    // Totals for seller
    merchandiseSubtotal: { type: Number, default: 0 },
    taxes: { type: Number, default: 0 },
    shippingFee: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },

    // Escrow & payout
    escrowStatus: { type: String, enum: ["held", "released", "refunded"], default: "held" },
    payoutStatus: { type: String, enum: ["not_eligible", "eligible", "queued", "paid"], default: "not_eligible" },
    commissionRate: { type: Number, default: 0 },
    commissionAmount: { type: Number, default: 0 },
    sellerEarning: { type: Number, default: 0 }, // totalAmount - commission

    // Status rollup
    subOrderStatus: { type: String, enum: ["pending", "processing", "completed", "cancelled"], default: "pending" },
  },
  { timestamps: true }
);

subOrderSchema.index({ order: 1 });
subOrderSchema.index({ seller: 1, createdAt: -1 });
subOrderSchema.index({ subOrderStatus: 1 });

subOrderSchema.pre("save", function (next) {
  const merchandiseSubtotal = this.items.reduce((s, i) => s + i.subtotal, 0);
  const taxes = this.items.reduce((s, i) => s + (i.taxAmount || 0), 0);
  const shipping = this.items.reduce((s, i) => s + (i.shippingFee || 0), 0);
  this.merchandiseSubtotal = merchandiseSubtotal;
  this.taxes = taxes;
  this.shippingFee = shipping;
  this.totalAmount = merchandiseSubtotal + taxes + shipping;

  this.commissionAmount = Math.round((this.totalAmount * (this.commissionRate || 0)) * 100) / 100;
  this.sellerEarning = Math.max(this.totalAmount - this.commissionAmount, 0);
  next();
});

module.exports = mongoose.model("SubOrder", subOrderSchema);
