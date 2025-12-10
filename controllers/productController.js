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
      const product = await Product.findByIdAndDelete(req.params.id);
      if (!product) return res.status(404).json({ message: "Product not found" });
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

      // 3. Attach coupon if valid
      product.coupons.addToSet(coupon._id);
      await product.save();

      const updatedProduct = await Product.findById(product._id)
        .populate("coupons", "code discountValue discountType isActive expiryDate");

      res.json({ message: "✅ Coupon assigned successfully", product: updatedProduct });

    } catch (error) {
      res.status(500).json({ message: "Error assigning coupon", error: error.message });
    }
  };

  //  Remove coupon from product
  const removeCouponFromProduct = async (req, res) => {
    try {
      const { id } = req.params; // product id
      const { couponId } = req.body; // couponId comes from body

      if (!couponId) {
        return res.status(400).json({ message: "Coupon ID is required" });
      }

      const product = await Product.findByIdAndUpdate(
        id,
        { $pull: { coupons: couponId } },
        { new: true }
      );

      if (!product) {
        return res.status(404).json({ message: "Product not found" });
      }

      res.json({ message: "Coupon removed", product });
    } catch (error) {
      res
        .status(500)
        .json({ message: "Error removing coupon", error: error.message });
    }
  };

  //  SELLER FUNCTIONS

  //  Create product (seller)
  const createProduct = async (req, res) => {
    try {
      let { 
        category, name, slug, description, features, attributes, 
        weight, dimensions, unit, variety,
        isOrganic, harvestDate, bestBefore, storageInstructions,
        price, originalPrice, discount, quantity, minOrderQuantity,
        inStock, isOnSale, isSeasonal, lowStockThreshold, lastStockUpdate 
      } = req.body;

      // Required field validations for new model
      if (!unit) {
        return res.status(400).json({ message: "Unit is required" });
      }
      if (!bestBefore) {
        return res.status(400).json({ message: "bestBefore date is required" });
      }

      // Parse dates
      if (harvestDate) {
        harvestDate = new Date(harvestDate);
        if (isNaN(harvestDate)) {
          return res.status(400).json({ message: "Invalid harvestDate format" });
        }
      }
      const parsedBestBefore = new Date(bestBefore);
      if (isNaN(parsedBestBefore)) {
        return res.status(400).json({ message: "Invalid bestBefore format" });
      }
      bestBefore = parsedBestBefore;

      if (lastStockUpdate) {
        lastStockUpdate = new Date(lastStockUpdate);
        if (isNaN(lastStockUpdate)) {
          return res.status(400).json({ message: "Invalid lastStockUpdate format" });
        }
      }

      // Parse dimensions if provided
      if (dimensions && typeof dimensions === "string") {
        try {
          dimensions = JSON.parse(dimensions);
        } catch (e) {
          return res.status(400).json({ message: "Invalid JSON in dimensions" });
        }
      }

      // ✅ Parse JSON if coming as strings (from Postman/form-data)
      if (features && typeof features === "string") {
        try {
          features = JSON.parse(features);
        } catch (e) {
          return res.status(400).json({ message: "Invalid JSON in features" });
        }
      }
      if (attributes && typeof attributes === "string") {
        try {
          attributes = JSON.parse(attributes);
        } catch (e) {
          return res.status(400).json({ message: "Invalid JSON in attributes" });
        }
      }

      // ✅ Cover image
      const image = req.files?.image ? req.files.image[0].path : null;

      // ✅ Gallery images
      const gallery = req.files?.gallery ? req.files.gallery.map(file => file.path) : [];

      // ✅ Find seller profile for this user
      const sellerProfile = await SellerProfile.findOne({ user: req.user._id });
      if (!sellerProfile) {
        return res.status(400).json({ message: "Seller profile not found" });
      }

      // ✅ Ensure category is ObjectId
      if (category && typeof category === "string" && !category.match(/^[0-9a-fA-F]{24}$/)) {
        const foundCategory = await Category.findOne({ name: category });
        if (!foundCategory) {
          return res.status(400).json({ message: `Category '${category}' not found` });
        }
        category = foundCategory._id;
      }

      // ✅ Auto-generate slug if not provided
      if (!slug && name) {
        slug = slugify(name, { lower: true, strict: true });
      }

      const newProduct = new Product({
        category,
        seller: sellerProfile._id, // ✅ SellerProfile reference
        name,
        slug,
        description,
        features,
        attributes,
        weight,
        dimensions,
        unit,
        variety,
        isOrganic: isOrganic !== undefined ? isOrganic === 'true' || Boolean(isOrganic) : false,
        harvestDate,
        bestBefore,
        storageInstructions,
        price,
        originalPrice,
        discount: discount || 0,
        quantity: quantity || 0,
        minOrderQuantity: minOrderQuantity || 0.25,
        inStock: inStock !== undefined ? inStock === 'true' || Boolean(inStock) : true,
        isOnSale: isOnSale !== undefined ? isOnSale === 'true' || Boolean(isOnSale) : false,
        isSeasonal: isSeasonal !== undefined ? isSeasonal === 'true' || Boolean(isSeasonal) : false,
        lowStockThreshold: lowStockThreshold || 5,
        lastStockUpdate,
        stockHistory: [], // Initialize empty
        image,
        gallery,
        status: "pending", // 🔴 Force pending until admin approves
      });

      const savedProduct = await newProduct.save();

      res.status(201).json({
        message: "✅ Product created successfully, awaiting admin approval",
        product: savedProduct,
      });
    } catch (error) {
      console.error("❌ Error creating product:", error);
      res.status(500).json({ message: "Error creating product", error: error.message });
    }
  };

  //  Update own product
  const updateOwnProduct = async (req, res) => {
    try {
      const conditions = await getSellerConditions(req.user._id);

      const product = await Product.findOne({
        _id: req.params.id,
        $or: conditions,
      });

      if (!product) {
        return res.status(404).json({ message: "Product not found or not yours" });
      }

      // ✅ Handle file uploads
      if (req.files?.image) req.body.image = req.files.image[0].path;
      if (req.files?.gallery) {
        // Merge new gallery with existing to avoid overwriting
        const newGallery = req.files.gallery.map(f => f.path);
        req.body.gallery = [...(product.gallery || []), ...newGallery];
      }

      // ✅ Parse JSON strings
      if (typeof req.body.attributes === "string") req.body.attributes = JSON.parse(req.body.attributes);
      if (typeof req.body.features === "string") req.body.features = JSON.parse(req.body.features);
      if (typeof req.body.dimensions === "string") req.body.dimensions = JSON.parse(req.body.dimensions);

      // Parse dates if provided
      if (req.body.harvestDate) {
        req.body.harvestDate = new Date(req.body.harvestDate);
      }
      if (req.body.bestBefore) {
        req.body.bestBefore = new Date(req.body.bestBefore);
      }
      if (req.body.lastStockUpdate) {
        req.body.lastStockUpdate = new Date(req.body.lastStockUpdate);
      }

      // Boolean conversions
      if (req.body.isOrganic !== undefined) req.body.isOrganic = req.body.isOrganic === 'true' || Boolean(req.body.isOrganic);
      if (req.body.inStock !== undefined) req.body.inStock = req.body.inStock === 'true' || Boolean(req.body.inStock);
      if (req.body.isOnSale !== undefined) req.body.isOnSale = req.body.isOnSale === 'true' || Boolean(req.body.isOnSale);
      if (req.body.isSeasonal !== undefined) req.body.isSeasonal = req.body.isSeasonal === 'true' || Boolean(req.body.isSeasonal);

      // Defaults for optional numerics
      if (req.body.discount === undefined) req.body.discount = 0;
      if (req.body.quantity === undefined) req.body.quantity = 0;
      if (req.body.minOrderQuantity === undefined) req.body.minOrderQuantity = 0.25;
      if (req.body.lowStockThreshold === undefined) req.body.lowStockThreshold = 5;

      // For stockHistory, if updating stock, append to history (example: if quantity changed)
      const oldQuantity = product.quantity;
      if (req.body.quantity !== undefined && req.body.quantity !== oldQuantity) {
        product.stockHistory.push({
          date: new Date(),
          change: req.body.quantity - oldQuantity,
          reason: "Manual stock update",
          updatedBy: req.user._id
        });
        product.lastStockUpdate = new Date();
      }

      // ✅ Merge updates (Mongoose will handle Map for attributes)
      Object.assign(product, req.body);

      const updatedProduct = await product.save();
      res.json(updatedProduct);
    } catch (error) {
      res.status(500).json({ message: "Error updating product", error: error.message });
    }
  };

  //  Delete own product
  const deleteOwnProduct = async (req, res) => {
    try {
      const userId = req.user._id;

      // Find seller profile for this user
      const sellerDoc = await SellerProfile.findOne({ user: userId }).lean();
      const sellerId = sellerDoc?._id;

      // Match product by either sellerId or userId (backward compatibility)
      const product = await Product.findOneAndDelete({
        _id: req.params.id,
        $or: [
          { seller: sellerId },
          { seller: userId }, // in case some products still have userId directly
        ],
      });

      if (!product) {
        return res.status(404).json({ message: "Product not found or not yours" });
      }

      res.json({ message: "Product deleted successfully", product });
    } catch (error) {
      res.status(500).json({ message: "Error deleting product", error: error.message });
    }
  };

  //  Toggle stock
  const toggleStock = async (req, res) => {
    try {
      const conditions = await getSellerConditions(req.user._id);

      const product = await Product.findOne({
        _id: req.params.id,
        $or: conditions,
      });

      if (!product) return res.status(404).json({ message: "Product not found or not yours" });

      product.inStock = !product.inStock;
      product.lastStockUpdate = new Date();
      // Optionally append to stockHistory
      product.stockHistory.push({
        date: new Date(),
        change: product.inStock ? product.quantity : -product.quantity, // simplistic
        reason: `Stock toggled to ${product.inStock ? 'in stock' : 'out of stock'}`,
        updatedBy: req.user._id
      });
      await product.save();
      res.json({ message: "Stock toggled", product });
    } catch (error) {
      res.status(500).json({ message: "Error toggling stock", error: error.message });
    }
  };

  //  Toggle sale
  const toggleSale = async (req, res) => {
    try {
      const conditions = await getSellerConditions(req.user._id);

      const product = await Product.findOne({
        _id: req.params.id,
        $or: conditions,
      });

      if (!product) return res.status(404).json({ message: "Product not found or not yours" });

      product.isOnSale = !product.isOnSale;
      await product.save();
      res.json({ message: "Sale toggled", product });
    } catch (error) {
      res.status(500).json({ message: "Error toggling sale", error: error.message });
    }
  };

  //  Apply coupon to own product(need test)
  const applyCoupon = async (req, res) => {
    try {
      const { couponId } = req.body;

      // Find seller profile
      const sellerProfile = await SellerProfile.findOne({ user: req.user._id });
      if (!sellerProfile) {
        return res.status(400).json({ message: "Seller profile not found" });
      }

      // 1. Find the coupon
      const coupon = await Coupon.findById(couponId);
      if (!coupon) return res.status(404).json({ message: "Coupon not found" });

      // 2. Check if coupon belongs to this seller
      if (coupon.sellers.length > 0 && !coupon.sellers.includes(sellerProfile._id)) {
        return res.status(400).json({ message: "Coupon not applicable to this seller" });
      }

      // 3. Check if coupon is active
      if (!coupon.isActive) {
        return res.status(400).json({ message: "Coupon is not active" });
      }

      // 4. Check expiry date
      if (coupon.expiryDate && coupon.expiryDate < new Date()) {
        return res.status(400).json({ message: "Coupon has expired" });
      }

      // 5. Check usage limits
      if (coupon.maxUsage && coupon.usedCount >= coupon.maxUsage) {
        return res.status(400).json({ message: "Coupon usage limit reached" });
      }

      // 6. Check if user already used this coupon
      const alreadyUsed = coupon.userUsage.some(
        (u) => u.user.toString() === req.user._id.toString()
      );
      if (alreadyUsed) {
        return res.status(400).json({ message: "You already used this coupon" });
      }

      // 7. Find the product
      let product = await Product.findOne({ _id: req.params.id, seller: sellerProfile._id });
      if (!product) return res.status(404).json({ message: "Product not found" });

      // 8. Check product/category restrictions
      if (
        coupon.applicableProducts.length &&
        !coupon.applicableProducts.includes(product._id)
      ) {
        return res.status(400).json({ message: "This coupon is not valid for this product" });
      }

      if (
        coupon.applicableCategories.length &&
        !coupon.applicableCategories.includes(product.category)
      ) {
        return res.status(400).json({ message: "This coupon is not valid for this category" });
      }

      // 9. Save originalPrice if not already saved
      if (!product.originalPrice) {
        product.originalPrice = product.price;
      }

      // 10. Apply discount
      if (coupon.discountType === "percentage") {
        let discountAmount = (product.originalPrice * coupon.discountValue) / 100;

        // apply maxDiscount cap if exists
        if (coupon.maxDiscount && discountAmount > coupon.maxDiscount) {
          discountAmount = coupon.maxDiscount;
        }

        product.price = product.originalPrice - discountAmount;
        product.discount = coupon.discountValue; // Update product-level discount
      } else if (coupon.discountType === "fixed") {
        product.price = product.originalPrice - coupon.discountValue;
        product.discount = (coupon.discountValue / product.originalPrice) * 100; // Approximate %
      }

      // 11. Attach coupon reference
      if (!product.coupons.includes(coupon._id)) {
        product.coupons.push(coupon._id);
      }

      // 12. Update coupon usage
      coupon.usedCount += 1;
      coupon.userUsage.push({ user: req.user._id });
      await coupon.save();

      await product.save();

      // 13. Return updated product
      product = await product.populate("coupons", "code discountValue discountType isActive expiryDate");

      res.json({ message: "Coupon applied", product });
    } catch (error) {
      res.status(500).json({ message: "Error applying coupon", error: error.message });
    }
  };

  // Get my products
  const getMyProducts = async (req, res) => {
    try {
      const userId = req.user?._id;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized: no userId in req.user" });
      }

      // ✅ Use SellerProfile instead of undefined Seller
      const sellerDoc = await SellerProfile.findOne({ user: userId }).lean();
      const sellerId = sellerDoc?._id;

      if (!sellerId) {
        return res.status(400).json({ message: "Seller profile not found" });
      }

      // Build query conditions - updated for new model (no createdBy or user fields)
      const conditions = [{ seller: sellerId }];
      // Fallback for backward compatibility
      conditions.push({ seller: userId });

      const products = await Product.find({ $or: conditions })
        .populate("category", "name slug")
        .sort({ createdAt: -1 });

      res.json(products);
    } catch (error) {
      console.error("❌ Error in getMyProducts:", error);
      res.status(500).json({
        message: "Error fetching seller products",
        error: error.message,
      });
    }
  };

  // USER FUNCTIONS
  // Modified getApprovedProducts to support search and new filters
  const getApprovedProducts = async (req, res) => {
    try {
      const { 
        category, minPrice, maxPrice, search, isOrganic, isSeasonal, unit, variety, 
        page = 1, limit = 10 
      } = req.query;
      let filter = { status: "approved" };

      if (category) filter.category = category;
      if (minPrice || maxPrice)
        filter.price = { $gte: Number(minPrice) || 0, $lte: Number(maxPrice) || Infinity };
      if (isOrganic !== undefined) filter.isOrganic = isOrganic === 'true';
      if (isSeasonal !== undefined) filter.isSeasonal = isSeasonal === 'true';
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