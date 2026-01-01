// models/userModel.js (FULLY UPDATED - no lines skipped, added emailVerified + expanded sellerSubSchema for full sync with SellerProfile)
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const sellerSubSchema = new mongoose.Schema({
  storeName: { type: String },
  storeDescription: { type: String },
  logo: { type: String },
  gstin: { type: String }, // Optional
  pan: { type: String }, // Optional
  businessType: { type: String, enum: ["individual","trader","fpo","cooperative","mill","exporter","processor"], default: "trader" },
  location: {
    address: { type: String },
    city: { type: String },
    state: { type: String },
    pincode: { type: String },
    district: { type: String },
  },
  kycStatus: { type: String, enum: ["pending","approved","rejected"], default: "pending" },
  documents: [
    {
      type: { type: String },
      url: { type: String, required: true },
      uploadedAt: { type: Date, default: Date.now },
    }
  ],
  verifiedAt: Date,
});

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role: { type: String, enum: ["admin","seller","user"], default: "user" },
  phone: { type: String, unique: true, sparse: true, match: [/^\d{10}$/] },
  aadhaar: { type: String, match: [/^\d{12}$/], sparse: true }, // Optional
  // Embedded seller data (now fully synced with SellerProfile fields)
  seller: sellerSubSchema,
  isActive: { type: Boolean, default: true },
  emailVerified: { type: Boolean, default: true }, // default true for backward compatibility with existing users
}, { timestamps: true });

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = async function (cand) {
  return bcrypt.compare(cand, this.password);
};

module.exports = mongoose.model("User", userSchema);