// models/otpModel.js (NEW FILE - from scratch)
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const otpSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  token: { type: String, required: true }, // hashed OTP
  type: { type: String, enum: ["verification", "reset"], required: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

// Auto-delete expired OTPs
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Hash token before saving
otpSchema.pre("save", async function (next) {
  if (this.isModified("token")) {
    this.token = await bcrypt.hash(this.token.toString(), 10);
  }
  next();
});

// Compare method
otpSchema.methods.compareToken = async function (candidateToken) {
  return await bcrypt.compare(candidateToken.toString(), this.token);
};

module.exports = mongoose.model("OTP", otpSchema);