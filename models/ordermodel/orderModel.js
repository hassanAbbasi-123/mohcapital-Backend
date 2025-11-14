// /models/orderModel.js
const mongoose = require("mongoose");

const addressSchema = new mongoose.Schema(
  {
    fullName: { type: String },
    street: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String },
    zip: { type: String, required: true },
    country: { type: String, required: true },
    phone: { type: String, required: true },
  },
  { _id: false }
);

const orderItemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: "SellerProfile", required: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },               // price at purchase
    discount: { type: Number, default: 0, min: 0 },
    subtotal: { type: Number, required: true, min: 0 },            // qty * price - discount
    taxAmount: { type: Number, default: 0, min: 0 },
    shippingFee: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ["pending", "paid", "shipped", "delivered", "cancelled", "return_requested", "returned"],
      default: "pending",
    },
    paymentCollectionStatus: { type: String, enum: ["pending", "collected", "refunded", "cancelled"], default: "pending" },
    trackingNumber: { type: String },
    shippingAddress: { type: addressSchema }, // optional per-item override for multi-address shipments
    appliedCoupons: [{ type: mongoose.Schema.Types.ObjectId, ref: "Coupon" }], // coupons applied to this item
    commissionRate: { type: Number, default: 0 }, // marketplace % (e.g. 0.1 for 10%)
    commissionAmount: { type: Number, default: 0 },
    escrowStatus: { type: String, enum: ["held", "released", "refunded", "n/a"], default: "held" }, // for prepaid
    payoutStatus: { type: String, enum: ["not_eligible", "eligible", "queued", "paid"], default: "not_eligible" },
  },
  { _id: true, timestamps: true }
);

const orderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // buyer

    items: [orderItemSchema],

    // Order-level totals
    merchandiseSubtotal: { type: Number, default: 0 }, // sum of items price*qty - item discounts
    discounts: { type: Number, default: 0 }, // Order-level discounts (e.g., global coupon)
    taxes: { type: Number, default: 0 }, // Total taxes (order-level)
    shippingFee: { type: Number, default: 0 }, // Order-level shipping (if any)
    totalAmount: { type: Number, required: true, default: 0 }, // computed

    // Coupon tracking
    appliedCoupons: [{ type: mongoose.Schema.Types.ObjectId, ref: "Coupon" }],

    // Payment & logistics
    paymentMethod: { type: String, enum: ["COD", "CARD", "WALLET"], default: "COD" },
    paymentStatus: { type: String, enum: ["pending", "paid", "refunded"], default: "pending" },
    orderStatus: { type: String, enum: ["pending", "processing", "completed", "cancelled"], default: "pending" },

    // Addresses
    shippingAddress: { type: addressSchema, required: true }, // default address for items
    alternateAddresses: [addressSchema], // optional additional addresses used by items
    trackingNumbers: [{ type: String }], // legacy / multi-seller shipments

    // Notes & audit
    notes: { type: String },
    cancellationReason: { type: String },
    refundReason: { type: String },

    // References
    cart: { type: mongoose.Schema.Types.ObjectId, ref: "Cart" },

    // Escrow flags (order-level)
    escrowEnabled: { type: Boolean, default: true },
    escrowHoldUntilDays: { type: Number, default: 7 }, // release escrow in X days after delivery if no dispute
  },
  { timestamps: true }
);

// Indexes
orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ orderStatus: 1 });
orderSchema.index({ "items.seller": 1 });
orderSchema.index({ "items.status": 1 });

// Compute totals before save
orderSchema.pre("save", function (next) {
  const merchandiseSubtotal = this.items.reduce((sum, it) => sum + (it.subtotal || 0), 0);
  const itemsShipping = this.items.reduce((sum, it) => sum + (it.shippingFee || 0), 0);
  const itemsTax = this.items.reduce((sum, it) => sum + (it.taxAmount || 0), 0);

  this.merchandiseSubtotal = merchandiseSubtotal;
  // Order-level shipping/tax + per-item shipping/tax combined
  const totalShipping = (this.shippingFee || 0) + itemsShipping;
  const totalTax = (this.taxes || 0) + itemsTax;

  this.totalAmount = merchandiseSubtotal + totalTax + totalShipping - (this.discounts || 0);
  next();
});

module.exports = mongoose.model("Order", orderSchema);
