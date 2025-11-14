// models/leadModel.js
const mongoose = require("mongoose");

const leadSchema = new mongoose.Schema({
  buyer: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User", 
    required: true 
  },
  category: { 
    type: String, 
    required: true 
  },
  product: { 
    type: String, 
    required: true 
  },
  quantity: { 
    type: String, 
    required: true 
  },
  quality_type: { 
    type: String 
  },
  delivery_location: { 
    type: String, 
    required: true 
  },
  description: { 
    type: String, 
    required: true 
  },
  price_range: { 
    type: String 
  },
  allow_sellers_contact: { 
    type: Boolean, 
    default: false 
  },
  status: {
    type: String,
    enum: ["pending", "approved", "rejected", "sold"],
    default: "pending"
  },
  lead_price: { 
    type: Number, 
    default: 0 
  },
  buyer_contact_phone: { 
    type: String 
  },
  buyer_contact_email: { 
    type: String 
  },
  approved_at: { 
    type: Date 
  },
  approved_by: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User" 
  },
  expires_at: { 
    type: Date 
  },
  max_sellers: { 
    type: Number, 
    enum: [1, 3], 
    default: 1 
  },
  sold_count: { 
    type: Number, 
    default: 0 
  }
}, { 
  timestamps: true 
});

// Indexes for performance
leadSchema.index({ status: 1 });
leadSchema.index({ buyer: 1, createdAt: -1 });
leadSchema.index({ category: 1 });
leadSchema.index({ status: 1, expires_at: 1 });
leadSchema.index({ sold_count: 1, max_sellers: 1 });
leadSchema.index({ createdAt: 1 });

module.exports = mongoose.model("Lead", leadSchema);
