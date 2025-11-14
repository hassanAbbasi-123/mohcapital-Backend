// controllers/profileController.js
const mongoose = require("mongoose");
const { User, SellerProfile } = require("../models/indexModel");

/**
 * Helper: Build full URL for a saved filepath.
 * Uses SERVER_URL env var if available, otherwise falls back to request's host.
 */
const buildFileUrl = (req, filepath) => {
  if (!filepath) return "";
  const serverUrl = process.env.SERVER_URL || `${req.protocol}://${req.get("host")}`;
  // Normalize Windows backslashes to forward slashes
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

    // If avatar is a stored relative path, convert to full URL
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

      // Handle file uploads (logo & documents)
      if (req.files?.logo && req.files.logo.length > 0) {
        const savedPath = req.files.logo[0].path;
        sellerUpdateData.logo = savedPath;
      }

      if (req.files?.documents && req.files.documents.length > 0) {
        const docPaths = req.files.documents.map((file) => file.path);
        sellerUpdateData.documents = docPaths;
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

      // Convert stored paths to accessible URLs for the response
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

// Change password
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

    // Build full URL to return to client
    const imageUrl = buildFileUrl(req, req.file.path);

    // Update only the user's avatar field
    await User.findByIdAndUpdate(
      userId,
      { avatar: req.file.path },
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

