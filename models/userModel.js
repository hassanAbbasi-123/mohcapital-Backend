// models/userModel.js
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const sellerSubSchema = new mongoose.Schema({
  storeName: { type: String },
  logo: { type: String },
  gstin: { type: String },
  businessType: { type: String, enum: ["individual","trader","fpo","cooperative","mill","exporter","processor"], default: "trader" },
  city: String,
  state: String,
  kycStatus: { type: String, enum: ["pending","approved","rejected"], default: "pending" },
  documents: [{ type: String }],          // array of file paths
  verifiedAt: Date,
});

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role: { type: String, enum: ["admin","seller","user"], default: "user" },

  phone: { type: String, unique: true, sparse: true, match: [/^\d{10}$/] },
  aadhaar: { type: String, match: [/^\d{12}$/], sparse: true },

  // <-- NEW: embed seller data directly on User (mirrors old SellerProfile)
  seller: sellerSubSchema,

  isActive: { type: Boolean, default: true },
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