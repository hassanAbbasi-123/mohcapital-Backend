// backend/controllers/bannerController.js
const Banner = require("../models/bannerModel");
const fs = require("fs");
const path = require("path");

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

    // Ensure image path consistency with multer
    const image = req.file
      ? `/uploads/banners/images/${req.file.filename}`
      : "";

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
      const banner = await Banner.findById(id);
      if (banner && banner.image) {
        const oldImagePath = path.join(__dirname, "..", "..", banner.image);
        if (fs.existsSync(oldImagePath)) {
          fs.unlinkSync(oldImagePath);
        }
      }

      image = `/uploads/banners/images/${req.file.filename}`;
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

    if (banner.image) {
      const imagePath = path.join(__dirname, "..", "..", banner.image);
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
      }
    }

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
