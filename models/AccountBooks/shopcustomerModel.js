const mongoose = require("mongoose");

const shopCustomerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    phone: { type: String },
    address: { type: String },

    // Optional: to track if customer is active/inactive
    status: { 
      type: String, 
      enum: ["active", "inactive"], 
      default: "active" 
    },

    // Cached current balance for fast access
    // Positive = customer owes you
    // Negative = you owe customer
    balance: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ShopCustomer", shopCustomerSchema);
