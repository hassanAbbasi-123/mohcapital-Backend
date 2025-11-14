// models/Category.js
const mongoose = require("mongoose");

const CategorySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },       // e.g. Electronics, Mobiles
  slug: { type: String, required: true, unique: true },       // SEO-friendly URL
  description: { type: String },

  // Parent category for subcategories
  parentCategory: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Category", 
    default: null 
  },

  // Vendor/Admin who created the category
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

  // Status to enable/disable categories
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model("Category", CategorySchema);
