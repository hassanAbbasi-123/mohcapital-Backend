const mongoose = require("mongoose");

const customerLedgerSchema = new mongoose.Schema(
  {
    customer: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "ShopCustomer",
      required: true 
    },

    // Transaction Type
    type: { 
      type: String, 
      enum: ["udhaar", "payment"], 
      required: true 
    },

    amount: { type: Number, required: true },

    // Any note, like "bought sugar 2kg"
    description: { type: String },

    date: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CustomerLedger", customerLedgerSchema);
