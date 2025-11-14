// models/cartModel.js
const mongoose = require("mongoose");

const cartItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true
    },
    Seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SellerProfile",
      required: true
    },
    quantity: { 
      type: Number, 
      required: true, 
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: "{VALUE} is not an integer value"
      }
    },
    price: { 
      type: Number, 
      required: true,
      min: 0
    }
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Virtual for item total
cartItemSchema.virtual("itemTotal").get(function() {
  return this.price * this.quantity;
});

const cartSchema = new mongoose.Schema(
  {
    user: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User", 
      required: true 
    },
    items: [cartItemSchema],

    // 🔹 Coupon related
    coupon: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Coupon",
      default: null
    },
    discount: {
      type: Number,
      default: 0
    },
    appliedCouponCode: {
      type: String,
      default: null
    }
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Virtual for cart total
cartSchema.virtual("cartTotal").get(function() {
  return this.items.reduce((total, item) => total + (item.price * item.quantity), 0);
});

// Virtual for final total (after discount)
cartSchema.virtual("finalTotal").get(function() {
  return Math.max(this.cartTotal - this.discount, 0);
});

// Virtual for total items count
cartSchema.virtual("totalItems").get(function() {
  return this.items.reduce((total, item) => total + item.quantity, 0);
});

// Index for better performance
cartSchema.index({ user: 1 });
cartSchema.index({ "items.product": 1 });
cartSchema.index({ "items.Seller": 1 });

// Pre-save middleware to ensure data consistency
cartSchema.pre("save", function(next) {
  // Remove duplicate items (same product)
  const seen = new Set();
  this.items = this.items.filter(item => {
    const key = item.product.toString();
    if (!seen.has(key)) {
      seen.add(key);
      return true;
    }
    return false;
  });

  // Ensure discount doesn’t exceed cartTotal
  if (this.discount > this.cartTotal) {
    this.discount = this.cartTotal;
  }

  next();
});

module.exports = mongoose.model("Cart", cartSchema);
