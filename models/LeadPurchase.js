// models/LeadPurchase.js
const mongoose = require("mongoose");

const leadPurchaseSchema = new mongoose.Schema({
  lead: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Lead",
    required: true 
  },
  seller: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User", 
    required: true 
  },
  purchase_date: { 
    type: Date, 
    default: Date.now 
  },
  payment_status: {
    type: String,
    enum: ["pending", "approved", "failed"],
    default: "pending"
  },
  payment_mode: {
    type: String,
    enum: ["razorpay", "paypal", "manual"],
    default: "manual"
  },
  payment_proof: {
    type: String, // Store base64 string or file path (only for manual)
    required: false  // Now optional; required only for manual in controller
  },
  payment_id: { 
    type: String 
  },
  payment_response: {  // NEW: Store full payment response for integrated payments
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  approved_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },
  approved_at: {
    type: Date
  },
  notes: {
    type: String
  }
}, { 
  timestamps: true 
});

leadPurchaseSchema.index({ lead: 1 });
leadPurchaseSchema.index({ seller: 1, createdAt: -1 });
leadPurchaseSchema.index({ lead: 1, seller: 1 }, { unique: true });
leadPurchaseSchema.index({ payment_status: 1 });

module.exports = mongoose.model("LeadPurchase", leadPurchaseSchema);