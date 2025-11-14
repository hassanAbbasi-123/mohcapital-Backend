const Brand = require("../models/brandModel");
const slugify = require("slugify");
const Product = require("../models/productModel"); // for cascade checks
const path = require("path");

// ===================================
// SELLER SIDE
// ===================================

// Seller → propose a brand
exports.createBrand = async (req, res) => {
  try {
    const { name, description, website, country, establishedYear } = req.body;

    const existing = await Brand.findOne({ name });
    if (existing) return res.status(400).json({ message: "Brand already exists" });

    // Logo upload path (sellerBrands)
    let logoPath = null;
    if (req.file) {
      logoPath = `/uploads/brands/sellerBrands/${req.file.filename}`;
    }

    const brand = new Brand({
      name,
      slug: slugify(name, { lower: true }),
      logo: logoPath,
      description,
      website,
      country,
      establishedYear,
      createdBy: req.user._id, // seller id
      isApproved: false, // pending approval
      isFeatured: false,
      isActive: true,
    });

    await brand.save();
    res.status(201).json({ message: "Brand proposed successfully. Awaiting admin approval.", brand });
  } catch (error) {
    res.status(500).json({ message: "Error creating brand", error: error.message });
  }
};

// Seller → update own brand (only before approval full edit, after approval limited edit)
exports.updateBrandBySeller = async (req, res) => {
  try {
    const { brandId } = req.params;
    const updates = req.body;

    const brand = await Brand.findOne({ _id: brandId, createdBy: req.user._id });
    if (!brand) return res.status(404).json({ message: "Brand not found or not owned by seller" });

    // Handle new logo upload (replace)
    if (req.file) {
      updates.logo = `/uploads/brands/sellerBrands/${req.file.filename}`;
    }

    if (!brand.isApproved) {
      // Before approval → seller can update everything except approval/feature fields
      const restricted = ["isApproved", "isFeatured", "isActive"];
      restricted.forEach((field) => delete updates[field]);
    } else {
      // After approval → only logo and description allowed
      const allowed = ["logo", "description"];
      Object.keys(updates).forEach((key) => {
        if (!allowed.includes(key)) delete updates[key];
      });
    }

    Object.assign(brand, updates);
    await brand.save();

    res.json({ message: "Brand updated successfully", brand });
  } catch (error) {
    res.status(500).json({ message: "Error updating brand", error: error.message });
  }
};

// Seller → delete own brand (only if not approved or has no products)
exports.deleteBrandBySeller = async (req, res) => {
  try {
    const { brandId } = req.params;

    const brand = await Brand.findOne({ _id: brandId, createdBy: req.user._id });
    if (!brand) {
      return res.status(404).json({ message: "Brand not found or not owned by seller" });
    }

    // Prevent deleting if brand has linked products (when approved)
    if (brand.isApproved) {
      const products = await Product.findOne({ brand: brand._id, isActive: true });
      if (products) {
        return res.status(400).json({ message: "Cannot delete brand linked with active products" });
      }
    }

    // ✅ Soft delete instead of hard delete
    brand.isActive = false;
    await brand.save();

    res.json({ message: "Brand soft-deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting brand", error: error.message });
  }
};
// Seller → get all approved + active brands (to attach products)

exports.getApprovedBrandsForSeller = async (req, res) => {
  try {
    const brands = await Brand.find({ isApproved: true, isActive: true });
    res.json(brands);
  } catch (error) {
    res.status(500).json({ message: "Error fetching approved brands", error: error.message });
  }
};

// =======================
// ADMIN SIDE
// =======================
// Admin → add brand directly (bypass approval, auto-featured)
exports.addBrandByAdmin = async (req, res) => {
  try {
    const { name, slug, description, website, country, establishedYear } = req.body;

    if (!name || !slug) {
      return res.status(400).json({ message: "Name and slug are required" });
    }

    let logo = null;
    if (req.file) {
      logo = req.file.path.replace(/\\/g, "/"); // normalize for cross-platform
    }

    const brand = new Brand({
      name,
      slug,
      description,
      website,
      country,
      establishedYear,
      logo,
      isApproved: true,   // ✅ auto-approved
      isFeatured: true,   // ✅ featured by default
      isActive: true,     // ✅ active by default
      createdBy: null     // ✅ admin has no SellerProfile, so set null
    });

    await brand.save();

    res.status(201).json({
      message: "Brand added by admin successfully and marked as featured",
      brand,
    });
  } catch (error) {
    res.status(500).json({ message: "Error adding brand by admin", error: error.message });
  }
};
// Admin → approve/reject brand
exports.approveBrand = async (req, res) => {
  try {
    const { brandId } = req.params;
    const { approve } = req.body; // true/false

    const brand = await Brand.findById(brandId);
    if (!brand) return res.status(404).json({ message: "Brand not found" });

    brand.isApproved = approve;
    await brand.save();

    res.json({ message: `Brand ${approve ? "approved" : "rejected"}`, brand });
  } catch (error) {
    res.status(500).json({ message: "Error approving brand", error: error.message });
  }
};

// Admin → update any brand
exports.updateBrandByAdmin = async (req, res) => {
  try {
    const { brandId } = req.params;
    const updates = req.body;

    // Handle logo upload (adminBrands)
    if (req.file) {
      updates.logo = `/uploads/brands/adminBrands/${req.file.filename}`;
    }

    const brand = await Brand.findByIdAndUpdate(brandId, updates, { new: true });
    if (!brand) return res.status(404).json({ message: "Brand not found" });

    res.json({ message: "Brand updated by admin", brand });
  } catch (error) {
    res.status(500).json({ message: "Error updating brand", error: error.message });
  }
};
// Admin → delete brand (only if no products linked)
exports.deleteBrandByAdmin = async (req, res) => {
  try {
    const { brandId } = req.params;

    const products = await Product.findOne({ brand: brandId });
    if (products) return res.status(400).json({ message: "Cannot delete brand linked with products" });

    await Brand.findByIdAndDelete(brandId);
    res.json({ message: "Brand deleted by admin" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting brand", error: error.message });
  }
};
// Admin → toggle featured
exports.toggleFeatured = async (req, res) => {
  try {
    const { brandId } = req.params;
    const brand = await Brand.findById(brandId);
    if (!brand) return res.status(404).json({ message: "Brand not found" });

    brand.isFeatured = !brand.isFeatured;
    await brand.save();

    res.json({ message: `Brand ${brand.isFeatured ? "featured" : "unfeatured"}`, brand });
  } catch (error) {
    res.status(500).json({ message: "Error toggling featured", error: error.message });
  }
};
// Admin → analytics
exports.getBrandAnalytics = async (req, res) => {
  try {
    const analytics = await Product.aggregate([
      { $group: { _id: "$brand", productCount: { $sum: 1 }, totalSold: { $sum: "$sold" } } },
      {
        $lookup: {
          from: "brands",
          localField: "_id",
          foreignField: "_id",
          as: "brandDetails",
        },
      },
      { $unwind: "$brandDetails" },
    ]);

    res.json(analytics);
  } catch (error) {
    res.status(500).json({ message: "Error fetching analytics", error: error.message });
  }
};
// Admin → get all brands (including pending for approval)
exports.getAllBrandsForAdmin = async (req, res) => {
  try {
    const brands = await Brand.find({});
    res.json(brands);
  } catch (error) {
    res.status(500).json({ message: "Error fetching all brands", error: error.message });
  }
};
// =======================
// USER SIDE
// =======================
// User → get all approved + active brands
exports.getBrands = async (req, res) => {
  try {
    const brands = await Brand.find({ isApproved: true, isActive: true });
    res.json(brands);
  } catch (error) {
    res.status(500).json({ message: "Error fetching brands", error: error.message });
  }
};
// User → get featured brands
exports.getFeaturedBrands = async (req, res) => {
  try {
    const brands = await Brand.find({ isApproved: true, isActive: true, isFeatured: true });
    res.json(brands);
  } catch (error) {
    res.status(500).json({ message: "Error fetching featured brands", error: error.message });
  }
};
// User → get brand details with products
exports.getBrandDetails = async (req, res) => {
  try {
    const { slug } = req.params;
    const brand = await Brand.findOne({ slug, isApproved: true, isActive: true });
    if (!brand) return res.status(404).json({ message: "Brand not found" });

    const products = await Product.find({ brand: brand._id, isActive: true });

    res.json({ brand, products });
  } catch (error) {
    res.status(500).json({ message: "Error fetching brand details", error: error.message });
  }
};