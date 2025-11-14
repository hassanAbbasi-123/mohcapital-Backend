const mongoose = require("mongoose");

const brandSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true }, // e.g. Apple, Samsung
    slug: { type: String, required: true, unique: true }, // SEO-friendly
    logo: { type: String }, // image URL
    description: { type: String },

    // Metadata
    website: { type: String },
    country: { type: String },
    establishedYear: { type: Number },

    // Flags
    isFeatured: { type: Boolean, default: false }, // homepage brands
    isApproved: { type: Boolean, default: false }, // only approved brands show
    isActive: { type: Boolean, default: true }, // soft delete toggle

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "SellerProfile" }, // seller/admin
  },
  { timestamps: true }
);

module.exports = mongoose.model("Brand", brandSchema);
