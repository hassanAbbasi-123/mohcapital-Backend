const mongoose = require("mongoose");

const sellerProfileSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },

  storeName: { type: String, required: true },
  storeDescription: String,
  logo: String,

  gstin: { type: String, match: [/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/], unique: true, sparse: true },
  pan: { type: String, match: [/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/], unique: true, sparse: true },

  businessType: {
    type: String,
    enum: ["individual", "trader", "fpo", "cooperative", "mill", "exporter", "processor"],
    default: "trader"
  },

  location: {
    address: { type: String, required: true },
    city: { type: String, required: true },
    district: String,
    state: { type: String, required: true },
    pincode: { type: String, match: [/^\d{6}$/] },
    coordinates: { type: [Number], index: '2dsphere' }
  },

  kyc: {
    status: { type: String, enum: ["pending", "submitted", "verified", "rejected"], default: "pending" },
    documents: [
      {
        type: { type: String, enum: ["gstin", "pan", "aadhaar", "cancelled_cheque", "fssai", "msme"] },
        url: { type: String, required: true },
        uploadedAt: { type: Date, default: Date.now }
      }
    ],
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    verifiedAt: { type: Date }
  },

  isVerified: { type: Boolean, default: false },

  wallet: {
    balance: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: "INR" }
  },

  stats: {
    totalLeadsBought: { type: Number, default: 0 },
    successfulDeals: { type: Number, default: 0 },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    reviewCount: { type: Number, default: 0 }
  }
}, { timestamps: true });

module.exports = mongoose.model("SellerProfile", sellerProfileSchema);