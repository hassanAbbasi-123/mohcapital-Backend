// models/Product.js
const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    // 👇 Product belongs to a category (hierarchical for produce types)
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: true
    },

    // 👇 Product is owned by a vendor (seller/farmer/supplier)
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SellerProfile",       // reference to seller profile
      required: true
    },

    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true }, // SEO-friendly URL

    description: { type: String },
    features: [{ type: String }],               // ["Organic", "Locally Sourced", "Seasonal"]

    attributes: { type: Map, of: String },      // Flexible attributes
    // Example: { "Variety": "Red Globe", "Grade": "A", "Origin": "Maharashtra", "Certifications": "Organic" }

    // ✅ Physical/Fresh Produce properties
    weight: { type: Number },                  // in grams (for small items) or kg (for bulk)
    dimensions: {                              // optional for packaged items
      length: Number,
      width: Number,
      height: Number
    },
    unit: {                                    // New: Measurement unit for fresh produce
      type: String,
      enum: ["kg", "g", "piece", "bunch", "dozen", "liter", "pack"], // e.g., "kg" for veggies, "piece" for fruits, "pack" for spices
      required: true
    },
    variety: { type: String },                 // New: e.g., "Red Delicious" for apples, "Alphonso" for mangoes

    // ✅ Freshness & Sourcing (key for perishables)
    isOrganic: { type: Boolean, default: false },
    harvestDate: { type: Date },               // When harvested (for freshness)
    bestBefore: { type: Date, required: true }, // Shelf life indicator
    storageInstructions: { type: String },     // e.g., "Refrigerate at 4°C"

    // ✅ Pricing & stock (adapted for weight-based sales)
    price: { type: Number, required: true },   // Price per unit (e.g., per kg)
    originalPrice: { type: Number },           // Original price before discount
    discount: { type: Number, default: 0 },    // Product-level discount %
    quantity: { type: Number, default: 0 },    // Available stock in base units (e.g., total kg available)
    minOrderQuantity: { type: Number, default: 0.25 }, // New: Minimum order (e.g., 0.25 kg)

    inStock: { type: Boolean, default: true },
    isOnSale: { type: Boolean, default: false },
    isSeasonal: { type: Boolean, default: false }, // New: Flag for seasonal availability

    // ✅ Images
    image: { type: String },                   // Cover image URL
    gallery: [{ type: String }],               // Multiple images

    // ✅ Ratings & reviews
    rating: { type: Number, default: 0 },
    reviewCount: { type: Number, default: 0 },

    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    // ✅ Admin/Vendor moderation
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "out-of-season"],
      default: "pending"
    },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approvedAt: { type: Date },

    // ✅ Coupons applied
    coupons: [{ type: mongoose.Schema.Types.ObjectId, ref: "Coupon" }],

    lowStockThreshold: { type: Number, default: 5 }, // Adjusted for produce (e.g., 5 kg)
    lastStockUpdate: { type: Date },                   
    stockHistory: [                                    
      {
        date: { type: Date, default: Date.now },
        change: { type: Number },                      
        reason: { type: String },                      // e.g., "New Harvest", "Sale", "Spoilage"
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
      }
    ],
  },

  { timestamps: true }
);

module.exports = mongoose.model("Product", productSchema);