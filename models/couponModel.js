// models/couponModel.js
const mongoose = require("mongoose");

const userUsageSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    usedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const couponSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true }, // coupon code
    discountType: { type: String, enum: ["percentage", "fixed"], required: true },
    discountValue: { type: Number, required: true }, // percentage (0-100) or fixed currency value

    // Multi-vendor support
    sellers: [{ type: mongoose.Schema.Types.ObjectId, ref: "SellerProfile" }], // which seller(s) this coupon belongs to

    // Restrictions
    applicableProducts: [{ type: mongoose.Schema.Types.ObjectId, ref: "Product" }], // product-level
    applicableCategories: [{ type: mongoose.Schema.Types.ObjectId, ref: "Category" }], // category-level
    minCartValue: { type: Number, default: 0 }, // minimum cart value required to use coupon
    maxDiscount: { type: Number }, // cap discount amount for percentage coupons

    // Usage limits
    maxUsage: { type: Number, default: 1 }, // how many times coupon can be used globally
    usedCount: { type: Number, default: 0 }, // global usage counter
    maxUsagePerUser: { type: Number, default: 1 }, // how many times a single user can use this coupon
    userUsage: [userUsageSchema], // track per-user usage

    // stacking
    stackable: { type: Boolean, default: false }, // whether coupon can be used with other coupons
    maxStackPerOrder: { type: Number, default: 1 }, // maximum number of coupons that can be stacked in single order (if stackable true)

    // administrative
    expiryDate: Date,
    isActive: { type: Boolean, default: true },

    // optional metadata
    description: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, refPath: "createdByModel" }, // admin or seller id
    createdByModel: { type: String, enum: ["User", "SellerProfile", "Admin"], default: "Admin" }
  },
  { timestamps: true }
);

// Indexes

couponSchema.index({ sellers: 1 });
couponSchema.index({ isActive: 1, expiryDate: 1 });

// Utility method - check if coupon expired/active
couponSchema.methods.isValidNow = function () {
  if (!this.isActive) return false;
  if (this.expiryDate && new Date() > this.expiryDate) return false;
  if (this.usedCount >= (this.maxUsage || Infinity)) return false;
  return true;
};

// Export
module.exports = mongoose.model("Coupon", couponSchema);
