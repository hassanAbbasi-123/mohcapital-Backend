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
    enum: ["pending", "approved", "failed", "initiated", "cancelled", "manual_pending"],
    default: "pending"
  },
  payment_mode: {
    type: String,
    enum: ["razorpay", "paypal", "manual"],
    required: true
  },
  payment_id: { 
    type: String 
  },
  razorpay_order_id: {
    type: String
  },
  razorpay_payment_id: {
    type: String
  },
  razorpay_signature: {
    type: String
  },
  // Manual payment fields - SIMPLIFIED (only screenshot required)
  payment_proof: {
    type: String, // URL to uploaded screenshot/image
  },
  payment_date: {
    type: Date, // Date when payment was made
  },
  payment_response: {
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
leadPurchaseSchema.index({ razorpay_order_id: 1 });
leadPurchaseSchema.index({ payment_mode: 1 });

module.exports = mongoose.model("LeadPurchase", leadPurchaseSchema);