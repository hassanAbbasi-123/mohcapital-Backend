// Updated bannerController.js
// backend/controllers/bannerController.js
const Banner = require("../models/bannerModel");
const { uploadToCloudinary } = require("../config/multer"); // Import the Cloudinary upload helper

// ==============================
// Get All Banners (Admin)
// ==============================
const getAllBanners = async (req, res) => {
  try {
    const banners = await Banner.find({});
    res.status(200).json(banners);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ==============================
// Get Active Banners (Frontend)
// ==============================
const getActiveBanners = async (req, res) => {
  try {
    const banners = await Banner.find({ status: true });
    res.status(200).json(banners);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ==============================
// Create New Banner
// ==============================
const createBanner = async (req, res) => {
  try {
    const { title, subtitle, cta, bgColor, overlay, textColor, status } = req.body;

    // Ensure image upload to Cloudinary
    let image = "";
    if (req.file) {
      const uploadResult = await uploadToCloudinary(req.file, req);
      image = uploadResult.secure_url;
    }

    if (!image) {
      return res.status(400).json({ message: "Image is required" });
    }

    const banner = new Banner({
      title,
      subtitle,
      cta,
      bgColor,
      image,
      overlay,
      textColor,
      status: status === "true",
    });

    await banner.save();
    res.status(201).json(banner);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ==============================
// Update Banner
// ==============================
const updateBanner = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, subtitle, cta, bgColor, overlay, textColor, status } = req.body;

    let image = req.body.image; // Keep existing image if not replaced

    if (req.file) {
      // TODO: Optionally delete old image from Cloudinary if you store public_id
      // For now, just upload new one
      const uploadResult = await uploadToCloudinary(req.file, req);
      image = uploadResult.secure_url;
    }

    const updatedBanner = await Banner.findByIdAndUpdate(
      id,
      {
        title,
        subtitle,
        cta,
        bgColor,
        image,
        overlay,
        textColor,
        status: status === "true",
      },
      { new: true }
    );

    if (!updatedBanner) {
      return res.status(404).json({ message: "Banner not found" });
    }

    res.status(200).json(updatedBanner);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ==============================
// Delete Banner
// ==============================
const deleteBanner = async (req, res) => {
  try {
    const { id } = req.params;
    const banner = await Banner.findById(id);

    if (!banner) {
      return res.status(404).json({ message: "Banner not found" });
    }

    // TODO: Optionally delete image from Cloudinary if you store public_id
    // For now, just remove from DB

    await Banner.findByIdAndDelete(id);
    res.status(200).json({ message: "Banner deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ==============================
// Toggle Status (Active/Inactive)
// ==============================
const toggleStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const banner = await Banner.findById(id);

    if (!banner) {
      return res.status(404).json({ message: "Banner not found" });
    }

    banner.status = !banner.status;
    await banner.save();

    res.status(200).json(banner);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getAllBanners,
  getActiveBanners,
  createBanner,
  updateBanner,
  deleteBanner,
  toggleStatus,
};