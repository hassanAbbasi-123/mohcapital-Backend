// controllers/authController.js (FULLY UPDATED - no lines skipped, added strong password validation, OTP verification flow, forgot/reset with OTP)
const { Customer } = require("../models/accountModel");
const mongoose = require("mongoose");
const { User } = require("../models/indexModel"); // Only User is needed now
const { SellerProfile } = require("../models/indexModel");
const jwt = require("jsonwebtoken");
const { uploadToCloudinary } = require("../config/multer");
const OTP = require("../models/otpModel");
const sendEmail = require("../utils/sendEmail");

const generateToken = (id, role) => {
  return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: "30d" });
};

// Strong password validation
const validatePassword = (password) => {
  if (!password || password.length < 8) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[a-z]/.test(password)) return false;
  if (!/\d/.test(password)) return false;
  if (!/[!@#$%^&*]/.test(password)) return false;
  return true;
};

// Generate 6-digit OTP
const generateOtp = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Send verification OTP
const sendVerificationOtp = async (user) => {
  await OTP.deleteMany({ userId: user._id, type: "verification" });

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await OTP.create({
    userId: user._id,
    token: otp,
    type: "verification",
    expiresAt,
  });

  const text = `Your email verification OTP is ${otp}. It is valid for 10 minutes.`;
  const html = `<p>Your email verification OTP is <strong>${otp}</strong>. It is valid for 10 minutes.</p>`;

  await sendEmail(user.email, "Verify Your Email - OTP", text, html);
};

// Send reset OTP
const sendResetOtp = async (user) => {
  await OTP.deleteMany({ userId: user._id, type: "reset" });

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  await OTP.create({
    userId: user._id,
    token: otp,
    type: "reset",
    expiresAt,
  });

  const text = `Your password reset OTP is ${otp}. It is valid for 15 minutes.`;
  const html = `<p>Your password reset OTP is <strong>${otp}</strong>. It is valid for 15 minutes.</p>`;

  await sendEmail(user.email, "Password Reset - OTP", text, html);
};

// REGISTER (now with OTP verification - account inactive until verified)
exports.register = async (req, res) => {
  const {
    name,
    email,
    password,
    role = "user",
    phone,
    address,
    aadhaar,
    storeName,
    storeDescription,
    gstin,
    pan,
    businessType = "trader",
    city,
    state,
    pincode,
    district,
  } = req.body;

  try {
    const normalizedRole = role.toLowerCase();

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email, and password are required" });
    }

    if (!validatePassword(password)) {
      return res.status(400).json({
        message: "Password must be at least 8 characters and contain at least one uppercase letter, one lowercase letter, one number, and one special character (!@#$%^&*)"
      });
    }

    if (!["admin", "seller", "user"].includes(normalizedRole)) {
      return res.status(400).json({ message: "Invalid role" });
    }

    const existingEmail = await User.findOne({ email });
    if (existingEmail) return res.status(400).json({ message: "Email already registered" });

    const existingPhone = phone && (await User.findOne({ phone }));
    if (existingPhone) return res.status(400).json({ message: "Phone already registered" });

    if (normalizedRole === "seller") {
      if (!storeName || !gstin || !city || !state) {
        return res.status(400).json({ message: "storeName, gstin, city, state required for seller" });
      }

      const existingStore = await User.findOne({ "seller.storeName": storeName });
      if (existingStore) return res.status(400).json({ message: "Store name already taken" });

      const existingGstin = await User.findOne({ "seller.gstin": gstin });
      if (existingGstin) return res.status(400).json({ message: "GSTIN already registered" });

      // Also check legacy SellerProfile
      const legacy = await SellerProfile.findOne({ $or: [{ storeName }, { gstin }] });
      if (legacy) return res.status(400).json({ message: "Store name or GSTIN already exists in legacy profile" });
    }

    // Upload logo to Cloudinary
    let logo = "";
    if (req.files?.logo?.[0]) {
      const uploadResult = await uploadToCloudinary(req.files.logo[0], req);
      logo = uploadResult.secure_url;
    }

    let documentTypes = [];
    if (req.body.documentTypes) {
      try {
        documentTypes = JSON.parse(req.body.documentTypes);
        if (!Array.isArray(documentTypes)) throw new Error();
      } catch {
        return res.status(400).json({ message: "documentTypes must be a JSON array" });
      }
    }

    const uploadedDocs = req.files?.documents || [];
    const kycDocuments = [];
    for (const file of uploadedDocs) {
      const uploadResult = await uploadToCloudinary(file, req);
      kycDocuments.push(uploadResult.secure_url);
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const user = await User.create([{
        name,
        email,
        password,
        role: normalizedRole,
        phone,
        address,
        aadhaar,
        emailVerified: false // Force false for new registrations
      }], { session }).then(d => d[0]);

      if (normalizedRole === "seller") {
        user.role = "seller";

        // EMBEDDED (full fields)
        user.seller = {
          storeName,
          storeDescription: storeDescription || "",
          logo,
          gstin,
          pan: pan || "",
          businessType,
          location: {
            address: address || "",
            city,
            state,
            pincode: pincode || "",
            district: district || "",
          },
          kycStatus: "pending",
          documents: kycDocuments.map((url, i) => ({
            type: documentTypes[i] || "gstin",
            url,
            uploadedAt: new Date(),
          })),
          verifiedAt: null,
        };

        // LEGACY SellerProfile (kept for sync)
        await SellerProfile.create([{
          user: user._id,
          storeName,
          storeDescription: storeDescription || "",
          logo,
          gstin,
          pan: pan || "",
          businessType,
          location: { address: address || "", city, state, pincode: pincode || "", district: district || "" },
          kyc: {
            status: "submitted",
            documents: kycDocuments.map((url, i) => ({ type: documentTypes[i] || "gstin", url }))
          },
          isVerified: false
        }], { session });

        await user.save({ session });
      }

      await session.commitTransaction();
      session.endSession();

      // Send verification OTP after successful registration
      await sendVerificationOtp(user);

      const payload = {
        message: "Registration successful. Please check your email for the verification OTP.",
        userId: user._id,
        email: user.email,
        role: user.role,
      };

      if (normalizedRole === "seller") {
        payload.seller = {
          storeName: user.seller.storeName,
          logo: user.seller.logo || null,
          kycStatus: user.seller.kycStatus,
        };
      }

      return res.status(201).json(payload);
    } catch (innerErr) {
      await session.abortTransaction();
      session.endSession();
      throw innerErr;
    }
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// VERIFY EMAIL OTP (new)
exports.verifyEmailOtp = async (req, res) => {
  const { userId, otp } = req.body;

  if (!userId || !otp) {
    return res.status(400).json({ message: "userId and otp are required" });
  }

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.emailVerified) {
      return res.status(400).json({ message: "Email already verified" });
    }

    const otpDoc = await OTP.findOne({
      userId,
      type: "verification",
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    if (!otpDoc || !(await otpDoc.compareToken(otp))) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    user.emailVerified = true;
    await user.save();

    await OTP.deleteMany({ userId, type: "verification" });

    const token = generateToken(user._id, user.role);

    const payload = {
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone || null,
      token,
    };

    if (user.role === "seller") {
      payload.seller = {
        storeName: user.seller.storeName,
        logo: user.seller.logo || null,
        kycStatus: user.seller.kycStatus,
      };
    }

    return res.json(payload);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// RESEND VERIFICATION OTP (new)
exports.resendVerificationOtp = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "Email not found" });
    }

    if (user.emailVerified) {
      return res.status(400).json({ message: "Email already verified" });
    }

    await sendVerificationOtp(user);

    return res.json({ message: "Verification OTP resent successfully" });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// FORGOT PASSWORD - SEND RESET OTP (new)
exports.forgotPassword = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  try {
    const user = await User.findOne({ email });
    // Always return success to prevent email enumeration
    if (user) {
      await sendResetOtp(user);
    }

    return res.json({ message: "If the email exists, a password reset OTP has been sent." });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// RESET PASSWORD WITH OTP (new)
exports.resetPassword = async (req, res) => {
  const { email, otp, newPassword } = req.body;

  if (!email || !otp || !newPassword) {
    return res.status(400).json({ message: "Email, OTP, and new password are required" });
  }

  if (!validatePassword(newPassword)) {
    return res.status(400).json({
      message: "New password must be at least 8 characters and contain at least one uppercase letter, one lowercase letter, one number, and one special character (!@#$%^&*)"
    });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "Invalid request" });
    }

    const otpDoc = await OTP.findOne({
      userId: user._id,
      type: "reset",
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    if (!otpDoc || !(await otpDoc.compareToken(otp))) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    user.password = newPassword;
    await user.save();

    await OTP.deleteMany({ userId: user._id, type: "reset" });

    const token = generateToken(user._id, user.role);

    return res.json({
      message: "Password reset successful",
      token,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// LOGIN (updated with email verification check)
exports.login = async (req, res) => {
  const { email, password, customerId } = req.body;

  // If customerId is provided, handle customer login
  if (customerId) {
    try {
      const customer = await Customer.findOne({ customerId });
      if (!customer || !(await customer.correctPassword(password))) {
        return res.status(401).json({ message: "Invalid customer ID or password" });
      }

      if (!customer.isActive) {
        return res.status(403).json({ message: "Customer account is deactivated" });
      }

      return res.json({
        _id: customer._id,
        name: customer.name,
        email: customer.email,
        customerId: customer.customerId,
        role: 'customer',
        phone: customer.phone || null,
        token: generateToken(customer._id, 'customer'),
      });
    } catch (err) {
      return res.status(500).json({ message: err.message });
    }
  }

  // Original email/password login for admin/seller/user
  if (!email || !password) {
    return res.status(400).json({ message: "Email and password required" });
  }

  try {
    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    // Email verification check (existing users without field are allowed)
    if (user.emailVerified === false) {
      return res.status(403).json({ message: "Please verify your email first" });
    }

    if (user.role === "seller") {
      if (!user.seller?.kycStatus || user.seller.kycStatus !== "approved") {
        return res.status(403).json({ message: "Seller account pending approval" });
      }
    }

    return res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone || null,
      token: generateToken(user._id, user.role),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// Approve or Disapprove Seller (Admin only) - kept exactly as original (you can replace with hybrid version if needed)
exports.approveOrDisapproveSeller = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Access denied. Admin only." });
    }

    const { sellerId } = req.params;
    const { action } = req.body; // "approve" or "reject"

    if (!["approve", "reject"].includes(action)) {
      return res.status(400).json({ message: "Invalid action. Use 'approve' or 'reject'." });
    }

    const user = await User.findById(sellerId);
    if (!user || user.role !== "seller") {
      return res.status(404).json({ message: "Seller not found" });
    }

    if (user.seller.kycStatus === "approved" && action === "approve") {
      return res.status(400).json({ message: "Seller already approved" });
    }

    user.seller.kycStatus = action === "approve" ? "approved" : "rejected";
    user.seller.verifiedAt = action === "approve" ? new Date() : null;

    await user.save();

    res.json({
      message: `Seller ${action === "approve" ? "approved" : "rejected"} successfully.`,
      seller: {
        _id: user._id,
        storeName: user.seller.storeName,
        kycStatus: user.seller.kycStatus,
      },
    });
  } catch (err) {
    console.error("approveOrDisapproveSeller error:", err);
    res.status(500).json({ message: err.message });
  }
};