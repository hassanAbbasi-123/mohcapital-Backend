// Updated profileController.js
// controllers/profileController.js
const mongoose = require("mongoose");
const { User, SellerProfile } = require("../models/indexModel");
const { uploadToCloudinary } = require("../config/multer"); // Import the Cloudinary upload helper

/**
 * Helper: No longer needed for Cloudinary URLs, but kept for backward compatibility if any local paths remain.
 */
const buildFileUrl = (req, filepath) => {
  if (!filepath) return "";
  // If it's already a full URL (Cloudinary), return as-is
  if (/^https?:\/\//i.test(filepath)) return filepath;
  const serverUrl = process.env.SERVER_URL || `${req.protocol}://${req.get("host")}`;
  const normalized = filepath.replace(/\\/g, "/").replace(/^\/+/g, "");
  return `${serverUrl}/${normalized}`;
};

// Get user profile (combines User + SellerProfile if seller)
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // If avatar is a stored relative path, convert to full URL (for legacy)
    if (user.avatar && typeof user.avatar === "string" && !/^https?:\/\//i.test(user.avatar)) {
      user.avatar = buildFileUrl(req, user.avatar);
    }

    let sellerProfile = null;
    if (user.role === "seller") {
      sellerProfile = await SellerProfile.findOne({ user: userId });
      // If seller profile exists and contains file paths, ensure they are returned as full URLs
      if (sellerProfile) {
        if (
          sellerProfile.logo &&
          typeof sellerProfile.logo === "string" &&
          !/^https?:\/\//i.test(sellerProfile.logo)
        ) {
          sellerProfile.logo = buildFileUrl(req, sellerProfile.logo);
        }
        if (Array.isArray(sellerProfile.documents) && sellerProfile.documents.length) {
          sellerProfile.documents = sellerProfile.documents.map((docPath) =>
            typeof docPath === "string" && !/^https?:\/\//i.test(docPath)
              ? buildFileUrl(req, docPath)
              : docPath
          );
        }
        // Handle kyc.documents if present
        if (sellerProfile.kyc && Array.isArray(sellerProfile.kyc.documents)) {
          sellerProfile.kyc.documents = sellerProfile.kyc.documents.map((doc) => ({
            ...doc,
            url: typeof doc.url === "string" && !/^https?:\/\//i.test(doc.url)
              ? buildFileUrl(req, doc.url)
              : doc.url
          }));
        }
      }
    }

    const profileData = {
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone || "",
        address: user.address || "",
        cnic: user.cnic || "",
        avatar: user.avatar || "",
        createdAt: user.createdAt,
      },
      sellerProfile: sellerProfile
        ? {
            _id: sellerProfile._id,
            storeName: sellerProfile.storeName || "",
            storeDescription: sellerProfile.storeDescription || "",
            logo: sellerProfile.logo || "",
            businessAddress: sellerProfile.address || "",
            isVerified: sellerProfile.isVerified,
            documents: sellerProfile.documents || [],
          }
        : null,
    };

    res.status(200).json(profileData);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching profile", error: error.message });
  }
};

// Update user profile
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const {
      name,
      // 🚫 ignore email completely (cannot be updated)
      phone,
      address,
      cnic,
      // Seller specific fields
      storeName,
      storeDescription,
      businessAddress,
    } = req.body;

    // Update user data
    const userUpdateData = {};
    if (name) userUpdateData.name = name;
    if (phone !== undefined) userUpdateData.phone = phone;
    if (address !== undefined) userUpdateData.address = address;
    if (cnic !== undefined) userUpdateData.cnic = cnic;

    // If no fields to update, keep the existing user doc; otherwise update
    let updatedUser = await User.findById(userId).select("-password");
    if (Object.keys(userUpdateData).length) {
      updatedUser = await User.findByIdAndUpdate(userId, userUpdateData, {
        new: true,
        runValidators: true,
      }).select("-password");
    }

    // Handle seller profile update (unchanged behavior)
    let updatedSellerProfile = null;
    if (req.user.role === "seller") {
      const sellerUpdateData = {};
      if (storeName) sellerUpdateData.storeName = storeName;
      if (storeDescription !== undefined)
        sellerUpdateData.storeDescription = storeDescription;
      if (businessAddress !== undefined)
        sellerUpdateData.address = businessAddress;

      // Handle file uploads (logo & documents) to Cloudinary
      if (req.files?.logo && req.files.logo.length > 0) {
        const uploadResult = await uploadToCloudinary(req.files.logo[0], req);
        sellerUpdateData.logo = uploadResult.secure_url;
      }

      if (req.files?.documents && req.files.documents.length > 0) {
        const docUrls = [];
        for (const file of req.files.documents) {
          const uploadResult = await uploadToCloudinary(file, req);
          docUrls.push(uploadResult.secure_url);
        }
        sellerUpdateData.documents = docUrls;
      }

      // Upsert the seller profile
      if (Object.keys(sellerUpdateData).length) {
        updatedSellerProfile = await SellerProfile.findOneAndUpdate(
          { user: userId },
          sellerUpdateData,
          { new: true, upsert: true }
        );
      } else {
        updatedSellerProfile = await SellerProfile.findOne({ user: userId });
      }

      // Convert stored paths to accessible URLs for the response (for legacy)
      if (updatedSellerProfile) {
        if (
          updatedSellerProfile.logo &&
          typeof updatedSellerProfile.logo === "string" &&
          !/^https?:\/\//i.test(updatedSellerProfile.logo)
        ) {
          updatedSellerProfile.logo = buildFileUrl(req, updatedSellerProfile.logo);
        }
        if (
          Array.isArray(updatedSellerProfile.documents) &&
          updatedSellerProfile.documents.length
        ) {
          updatedSellerProfile.documents = updatedSellerProfile.documents.map((docPath) =>
            typeof docPath === "string" && !/^https?:\/\//i.test(docPath)
              ? buildFileUrl(req, docPath)
              : docPath
          );
        }
      }
    }

    const responseData = {
      user: updatedUser,
      sellerProfile: updatedSellerProfile,
    };

    res.status(200).json({
      message: "Profile updated successfully",
      data: responseData,
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error updating profile", error: error.message });
  }
};

// Change password (unchanged)
exports.changePassword = async (req, res) => {
  try {
    const userId = req.user._id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .json({ message: "Current password and new password are required" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Verify current password
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    res.status(200).json({ message: "Password updated successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error changing password", error: error.message });
  }
};

// Upload profile picture
exports.uploadProfilePicture = async (req, res) => {
  try {
    const userId = req.user._id;

    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    // Upload to Cloudinary
    const uploadResult = await uploadToCloudinary(req.file, req);
    const imageUrl = uploadResult.secure_url;

    // Update only the user's avatar field
    await User.findByIdAndUpdate(
      userId,
      { avatar: imageUrl },
      { new: true, runValidators: true }
    );

    res.status(200).json({
      message: "Profile picture uploaded successfully",
      imageUrl,
    });
  } catch (error) {
    res.status(500).json({
      message: "Error uploading profile picture",
      error: error.message,
    });
  }
};