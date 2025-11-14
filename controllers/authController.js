// controllers/authController.js
const mongoose = require("mongoose");
const { User } = require("../models/indexModel"); // Only User is needed now
const jwt = require("jsonwebtoken");

const generateToken = (id, role) => {
  return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: "30d" });
};

// REGISTER
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
      const { SellerProfile } = require("../models/indexModel");
      const legacy = await SellerProfile.findOne({ $or: [{ storeName }, { gstin }] });
      if (legacy) return res.status(400).json({ message: "Store name or GSTIN already exists in legacy profile" });
    }

    const logo = req.files?.logo?.[0]?.path || "";

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
    const kycDocuments = uploadedDocs.map(f => f.path);

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const user = await User.create([{
        name, email, password, role: normalizedRole, phone, address, aadhaar
      }], { session }).then(d => d[0]);

      if (normalizedRole === "seller") {
        user.role = "seller";

        // EMBEDDED
        user.seller = {
          storeName,
          storeDescription: storeDescription || "",
          logo,
          gstin,
          pan: pan || "",
          businessType,
          city,
          state,
          kycStatus: "pending",
          documents: kycDocuments,
          verifiedAt: null,
        };

        // LEGACY
        const { SellerProfile } = require("../models/indexModel");
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

      const payload = {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone || null,
        token: generateToken(user._id, user.role),
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

// LOGIN
exports.login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password required" });
  }

  try {
    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: "Invalid email or password" });
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

// Approve or Disapprove Seller (Admin only)
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