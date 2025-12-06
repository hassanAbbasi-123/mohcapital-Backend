// models/Product.js
const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    // 👇 Product belongs to a category
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true
    },

    // 👇 Product is owned by a vendor (seller)
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SellerProfile",       // reference to seller profile
      required: true
    },

    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true }, // SEO-friendly URL

    description: { type: String },
    features: [{ type: String }],               // ["5G Ready", "Wireless Charging"]

    attributes: { type: Map, of: String },      // Flexible attributes
    // Example: { "RAM": "16GB", "Storage": "512GB", "Color": "Blue", "Weight": "1.5kg", "Size": "M" }

    // ✅ Physical properties
    weight: { type: Number },                  // in grams or kg
    dimensions: {                              // optional structured dimensions
      length: Number,
      width: Number,
      height: Number
    },
    size: { type: String },                     // e.g., "S", "M", "L" for clothing

    // ✅ Pricing & stock
    price: { type: Number, required: true },
    originalPrice: { type: Number },            // Original price before discount
    discount: { type: Number, default: 0 },     // Product-level discount %
    quantity: { type: Number, default: 0 },     // Stock quantity

    inStock: { type: Boolean, default: true },
    isOnSale: { type: Boolean, default: false },

    // ✅ Images
    image: { type: String },                    // Cover image URL
    gallery: [{ type: String }],                // Multiple images

    // ✅ Ratings & reviews
    rating: { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 },

    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    // ✅ Admin/Vendor moderation
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending"
    },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approvedAt: { type: Date },

    // ✅ Coupons applied
    coupons: [{ type: mongoose.Schema.Types.ObjectId, ref: "Coupon" }],

    lowStockThreshold: { type: Number, default: 10 }, 
    lastStockUpdate: { type: Date },                   
    stockHistory: [                                    
      {
        date: { type: Date, default: Date.now },
        change: { type: Number },                      
        reason: { type: String },                      
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
      }
    ],
  },

  { timestamps: true }
);

module.exports = mongoose.model("Product", productSchema);