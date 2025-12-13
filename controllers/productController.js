// controllers/productController.js
const {
  productModel: Product,
  categoryModel: Category,
  coupon: Coupon,
  SellerProfile,
  User
} = require("../models/indexModel");
const slugify = require("slugify");
const mongoose = require("mongoose");
const { uploadToCloudinary } = require("../config/multer"); // Import the Cloudinary upload helper (adjust path if in middleware)

const getSellerConditions = async (userId) => {
  const sellerDoc = await SellerProfile.findOne({ user: userId }).lean();
  const sellerId = sellerDoc?._id;
  return [
    { seller: sellerId },
    { seller: userId }, // backward compatibility
  ];
};

// ADMIN FUNCTIONS

// ✅ Get all products (admin overview)
const getAllProducts = async (req, res) => {
  try {
    const products = await Product.find()
      .populate("category", "name slug")
      .populate({
        path: "seller", // Product → SellerProfile
        populate: {
          path: "user", // SellerProfile → User
          select: "name email", // fetch seller's name + email
        },
      })
      .populate("coupons", "code discountValue discountType isActive expiryDate")
      .sort({ createdAt: -1 });

    res.json(products);
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ message: "Error fetching products", error: error.message });
  }
};

//  Approve a product
const approveProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    if (product.status === "approved") {
      return res.status(400).json({ message: "Product is already approved" });
    }

    product.status = "approved";
    product.approvedBy = req.user._id; // admin ID from token
    product.approvedAt = new Date();

    const updatedProduct = await product.save();

    res.json({
      message: "Product approved successfully",
      product: updatedProduct,
    });
  } catch (error) {
    res.status(500).json({ message: "Error approving product", error: error.message });
  }
};

// reject a product
const rejectProduct = async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { status: "rejected" },
      { new: true }
    );
    if (!product) return res.status(404).json({ message: "Product not found" });
    res.json({ message: "Product rejected", product });
  } catch (error) {
    res.status(500).json({ message: "Error rejecting product", error: error.message });
  }
};

//  Delete any product
const deleteProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });

    // TODO: Optionally delete images from Cloudinary if public_id is stored in model
    // e.g., if (product.imagePublicId) cloudinary.uploader.destroy(product.imagePublicId);
    // For gallery: product.galleryPublicIds.forEach(id => cloudinary.uploader.destroy(id));

    await Product.findByIdAndDelete(req.params.id);
    res.json({ message: "Product deleted by admin" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting product", error: error.message });
  }
};

// Assign coupon to product
const assignCouponToProduct = async (req, res) => {
  try {
    const { couponId } = req.body;

    // 1. Validate coupon
    const coupon = await Coupon.findById(couponId);
    if (!coupon) {
      return res.status(404).json({ message: "Coupon not found" });
    }
    if (!coupon.isActive) {
      return res.status(400).json({ message: "Coupon is not active" });
    }
    if (coupon.expiryDate && coupon.expiryDate < new Date()) {
      return res.status(400).json({ message: "Coupon is expired" });
    }

    // 2. Check if coupon applies to this product
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    // If coupon has specific products
    if (coupon.applicableProducts?.length > 0 &&
      !coupon.applicableProducts.includes(product._id)) {
      return res.status(400).json({ message: "Coupon not applicable to this product" });
    }

    // If coupon has specific categories
    if (coupon.applicableCategories?.length > 0 &&
      !coupon.applicableCategories.includes(product.category)) {
      return res.status(400).json({ message: "Coupon not applicable to this category" });
    }

    // Add coupon to product if not already assigned
    if (!product.coupons.includes(couponId)) {
      product.coupons.push(couponId);
      await product.save();
    }

    res.json({ message: "Coupon assigned successfully", product });
  } catch (error) {
    res.status(500).json({ message: "Error assigning coupon", error: error.message });
  }
};

// Remove coupon from product
const removeCouponFromProduct = async (req, res) => {
  try {
    const { couponId } = req.body;
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });

    product.coupons.pull(couponId);
    await product.save();

    res.json({ message: "Coupon removed successfully", product });
  } catch (error) {
    res.status(500).json({ message: "Error removing coupon", error: error.message });
  }
};

// ==============================
// SELLER FUNCTIONS
// ==============================

// Create product
const createProduct = async (req, res) => {
  try {
    const {
      name,
      description,
      category,
      price,
      originalPrice,
      discount,
      quantity,
      minOrderQuantity,
      unit,
      variety,
      weight,
      isOrganic,
      harvestDate,
      bestBefore,
      storageInstructions,
      features,
      attributes,
      isSeasonal,
    } = req.body;

    // Validate required fields
    if (!name || !category || !price || !unit || !bestBefore) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Validate seller
    const sellerConditions = await getSellerConditions(req.user._id);
    const existingProduct = await Product.findOne({
      name,
      $or: sellerConditions,
    });
    if (existingProduct) {
      return res.status(400).json({ message: "Product with this name already exists for seller" });
    }

    // Handle image upload to Cloudinary
    let image = "";
    if (req.files?.image?.[0]) {
      const uploadResult = await uploadToCloudinary(req.files.image[0], req);
      image = uploadResult.secure_url;
      // Optionally store public_id: imagePublicId: uploadResult.public_id
    }

    // Handle gallery uploads to Cloudinary
    let gallery = [];
    if (req.files?.gallery) {
      for (const file of req.files.gallery) {
        const uploadResult = await uploadToCloudinary(file, req);
        gallery.push(uploadResult.secure_url);
        // Optionally: galleryPublicIds.push(uploadResult.public_id)
      }
    }

    const product = new Product({
      name,
      slug: slugify(name, { lower: true }),
      description,
      category,
      seller: req.user._id, // or sellerProfile._id if available
      price: parseFloat(price),
      originalPrice: originalPrice ? parseFloat(originalPrice) : undefined,
      discount: discount ? parseFloat(discount) : 0,
      quantity: parseFloat(quantity) || 0,
      minOrderQuantity: parseFloat(minOrderQuantity) || 0.25,
      unit,
      variety,
      weight: weight ? parseFloat(weight) : undefined,
      isOrganic: isOrganic === "true",
      harvestDate: harvestDate ? new Date(harvestDate) : undefined,
      bestBefore: new Date(bestBefore),
      storageInstructions,
      features: features ? JSON.parse(features) : [],
      attributes: attributes ? JSON.parse(attributes) : {},
      isSeasonal: isSeasonal === "true",
      image,
      gallery,
      inStock: true,
      status: "pending", // Awaits admin approval
    });

    await product.save();
    res.status(201).json({ message: "Product created successfully", product });
  } catch (error) {
    console.error("Error creating product:", error);
    res.status(500).json({ message: "Error creating product", error: error.message });
  }
};

// Update own product
const updateOwnProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Validate seller ownership
    const sellerConditions = await getSellerConditions(req.user._id);
    const product = await Product.findOne({ _id: id, $or: sellerConditions });
    if (!product) {
      return res.status(404).json({ message: "Product not found or not owned by seller" });
    }

    // Handle new image upload (replace)
    if (req.files?.image?.[0]) {
      // TODO: Delete old image from Cloudinary if public_id stored
      const uploadResult = await uploadToCloudinary(req.files.image[0], req);
      updates.image = uploadResult.secure_url;
      // updates.imagePublicId = uploadResult.public_id;
    }

    // Handle new gallery uploads (append or replace)
    if (req.files?.gallery) {
      const newGalleryUrls = [];
      // TODO: If replacing, clear old galleryPublicIds
      for (const file of req.files.gallery) {
        const uploadResult = await uploadToCloudinary(file, req);
        newGalleryUrls.push(uploadResult.secure_url);
        // newGalleryPublicIds.push(uploadResult.public_id);
      }
      // Append to existing gallery
      product.gallery = [...product.gallery, ...newGalleryUrls];
      // Or replace: product.gallery = newGalleryUrls;
    }

    // Update other fields (with validation)
    const allowedFields = [
      "name", "description", "category", "price", "originalPrice", "discount",
      "quantity", "minOrderQuantity", "unit", "variety", "weight",
      "isOrganic", "harvestDate", "bestBefore", "storageInstructions",
      "features", "attributes", "isSeasonal"
    ];
    allowedFields.forEach(field => {
      if (updates[field] !== undefined) {
        if (field === "features" || field === "attributes") {
          product[field] = JSON.parse(updates[field]);
        } else if (["price", "originalPrice", "discount", "quantity", "minOrderQuantity", "weight"].includes(field)) {
          product[field] = parseFloat(updates[field]);
        } else if (["isOrganic", "isSeasonal"].includes(field)) {
          product[field] = updates[field] === "true";
        } else if (["harvestDate", "bestBefore"].includes(field)) {
          product[field] = new Date(updates[field]);
        } else {
          product[field] = updates[field];
        }
      }
    });

    // Regenerate slug if name changed
    if (updates.name) {
      product.slug = slugify(updates.name, { lower: true });
    }

    await product.save();
    res.json({ message: "Product updated successfully", product });
  } catch (error) {
    console.error("Error updating product:", error);
    res.status(500).json({ message: "Error updating product", error: error.message });
  }
};

// Delete own product
const deleteOwnProduct = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate seller ownership
    const sellerConditions = await getSellerConditions(req.user._id);
    const product = await Product.findOne({ _id: id, $or: sellerConditions });
    if (!product) {
      return res.status(404).json({ message: "Product not found or not owned by seller" });
    }

    // TODO: Delete images from Cloudinary if public_id stored
    // e.g., if (product.imagePublicId) cloudinary.uploader.destroy(product.imagePublicId);
    // product.galleryPublicIds.forEach(id => cloudinary.uploader.destroy(id));

    await Product.findByIdAndDelete(id);
    res.json({ message: "Product deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting product", error: error.message });
  }
};

// Toggle stock
const toggleStock = async (req, res) => {
  try {
    const { id } = req.params;
    const sellerConditions = await getSellerConditions(req.user._id);
    const product = await Product.findOne({ _id: id, $or: sellerConditions });
    if (!product) return res.status(404).json({ message: "Product not found" });

    product.inStock = !product.inStock;
    await product.save();
    res.json({ message: `Product ${product.inStock ? "in stock" : "out of stock"}`, product });
  } catch (error) {
    res.status(500).json({ message: "Error toggling stock", error: error.message });
  }
};

// Toggle sale
const toggleSale = async (req, res) => {
  try {
    const { id } = req.params;
    const sellerConditions = await getSellerConditions(req.user._id);
    const product = await Product.findOne({ _id: id, $or: sellerConditions });
    if (!product) return res.status(404).json({ message: "Product not found" });

    product.isOnSale = !product.isOnSale;
    await product.save();
    res.json({ message: `Product ${product.isOnSale ? "on sale" : "off sale"}`, product });
  } catch (error) {
    res.status(500).json({ message: "Error toggling sale", error: error.message });
  }
};

// Apply coupon (seller version, similar to admin)
const applyCoupon = async (req, res) => {
  try {
    const { couponId } = req.body;
    const { id } = req.params; // product id

    const sellerConditions = await getSellerConditions(req.user._id);
    const product = await Product.findOne({ _id: id, $or: sellerConditions });
    if (!product) return res.status(404).json({ message: "Product not found" });

    const coupon = await Coupon.findById(couponId);
    if (!coupon || !coupon.isActive) {
      return res.status(400).json({ message: "Invalid or inactive coupon" });
    }

    if (!product.coupons.includes(couponId)) {
      product.coupons.push(couponId);
      await product.save();
    }

    res.json({ message: "Coupon applied successfully", product });
  } catch (error) {
    res.status(500).json({ message: "Error applying coupon", error: error.message });
  }
};

// Get my products
const getMyProducts = async (req, res) => {
  try {
    const sellerConditions = await getSellerConditions(req.user._id);
    const products = await Product.find({ $or: sellerConditions })
      .populate("category", "name slug")
      .populate("coupons", "code discountValue discountType isActive expiryDate")
      .sort({ createdAt: -1 });

    res.json(products);
  } catch (error) {
    res.status(500).json({ message: "Error fetching products", error: error.message });
  }
};

// ==============================
// USER FUNCTIONS
// ==============================

// Get approved products with filters
const getApprovedProducts = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 12,
      category,
      minPrice,
      maxPrice,
      unit,
      variety,
      isOrganic,
      isOnSale,
      isSeasonal,
      search,
    } = req.query;

    let filter = { status: "approved", inStock: true };
    if (category) filter.category = category;
    if (minPrice) filter.price = { ...filter.price, $gte: parseFloat(minPrice) };
    if (maxPrice) filter.price = { ...filter.price, $lte: parseFloat(maxPrice) };
    if (isOrganic === "true") filter.isOrganic = true;
    if (isOnSale === "true") filter.isOnSale = true;
    if (isSeasonal === "true") filter.isSeasonal = true;
    if (unit) filter.unit = unit;
    if (variety) filter.variety = { $regex: variety, $options: "i" };

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { variety: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await Product.countDocuments(filter);

    const products = await Product.find(filter)
      .populate("category", "name slug")
      .populate({
        path: "seller",
        populate: { path: "user", select: "name email" }
      })
      .populate("coupons", "code discountValue discountType isActive expiryDate")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Optional personalization (silent for guests)
    if (req.user) {
      // e.g., add wishlist or personalized tags later
    }

    res.json({
      products,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
        total
      }
    });
  } catch (error) {
    res.status(500).json({ message: "Error fetching products", error: error.message });
  }
};

//  Get product by slug
const getProductBySlug = async (req, res) => {
  try {
    const product = await Product.findOne({ slug: req.params.slug, status: "approved" })
      .populate({
        path: "seller",
        populate: { path: "user", select: "name email" }
      })
      .populate("category", "name slug")
      .populate("coupons", "code discountValue discountType isActive expiryDate");
    if (!product) return res.status(404).json({ message: "Product not found" });
    res.json(product);
  } catch (error) {
    res.status(500).json({ message: "Error fetching product", error: error.message });
  }
};

//  Like/unlike a product
const likeProduct = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });

    const userId = req.user._id;
    if (product.likes.includes(userId)) {
      product.likes.pull(userId);
      await product.save();
      return res.json({ message: "Product unliked", product });
    } else {
      product.likes.push(userId);
      await product.save();
      return res.json({ message: "Product liked", product });
    }
  } catch (error) {
    res.status(500).json({ message: "Error liking product", error: error.message });
  }
};

//  Add review (basic rating system)
const addReview = async (req, res) => {
  try {
    const { rating } = req.body;
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: "Product not found" });

    // Simple avg rating system
    product.rating = (product.rating * product.reviewCount + rating) / (product.reviewCount + 1);
    product.reviewCount += 1;

    await product.save();
    res.json({ message: "Review added", product });
  } catch (error) {
    res.status(500).json({ message: "Error adding review", error: error.message });
  }
};

//  Get wishlist (liked products)
const getWishlist = async (req, res) => {
  try {
    const products = await Product.find({ likes: req.user._id })
      .populate("category", "name slug")
      .populate({
        path: "seller",
        populate: { path: "user", select: "name email" }
      });
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: "Error fetching wishlist", error: error.message });
  }
};

module.exports = {
  // Admin
  getAllProducts,
  approveProduct,
  rejectProduct,
  deleteProduct,
  assignCouponToProduct,
  removeCouponFromProduct,

  // Seller
  createProduct,
  updateOwnProduct,
  deleteOwnProduct,
  toggleStock,
  toggleSale,
  applyCoupon,
  getMyProducts,

  // User
  getApprovedProducts,
  getProductBySlug,
  likeProduct,
  addReview,
  getWishlist,
};