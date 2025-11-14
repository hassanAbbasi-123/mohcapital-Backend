// controllers/wishlistController.js
const { mongoose, Types } = require("mongoose");
const Wishlist = require("../models/wishlistModel");
const Product = require("../models/productModel");
const Category = require("../models/categoryModel");
const SellerProfile = require("../models/sellerProfile");

/**
 * Utility: ensure a wishlist doc exists for a user and return it
 */
async function ensureWishlist(userId) {
  let wl = await Wishlist.findOne({ user: userId });
  if (!wl) {
    wl = await Wishlist.create({ user: userId, products: [] });
  }
  return wl;
}

/**
 * Utility: basic auth guard (expects req.user from auth middleware)
 * - Users may only mutate their own wishlist (unless admin)
 */
function assertUserOrAdmin(req, targetUserId) {
  const isAdmin = req.user?.role === "admin";
  const isSelf = req.user && String(req.user._id) === String(targetUserId);
  if (!isAdmin && !isSelf) {
    const err = new Error("Forbidden: you can only act on your own wishlist");
    err.status = 403;
    throw err;
  }
}

/**
 * Utility: Normalize wishlist response with proper seller info
 */
function normalizeWishlistResponse(wishlist) {
  if (!wishlist || !wishlist.products) return wishlist;
  
  const normalizedProducts = wishlist.products.map(item => {
    let sellerInfo = {};
    
    if (item.seller) {
      if (typeof item.seller === 'object' && item.seller !== null) {
        sellerInfo = {
          id: item.seller._id,
          shopName: item.seller.shopName,
          user: item.seller.user
        };
      } else {
        sellerInfo = {
          id: item.seller,
          shopName: "Store"
        };
      }
    }
    
    return {
      ...item.toObject ? item.toObject() : item,
      seller: sellerInfo
    };
  });
  
  return {
    ...wishlist.toObject ? wishlist.toObject() : wishlist,
    products: normalizedProducts
  };
}

/* =========================================================
 * 👤 USER SIDE (Buyer)
 * =======================================================*/

/**
 * Add product to wishlist (soft-restore if previously removed)
 * - Accepts either:
 *   - productId in body (recommended). sellerId will be inferred from product.
 *   - If you still pass sellerId, it's ignored (product.seller is used).
 *
 * POST /wishlist/add  (or /user/add-to-wishlist)
 * Body: { productId }
 */
exports.addToWishlist = async (req, res) => {
  try {
    // Use authenticated user id; optional fallback if route passes userId param
    const targetUserId = req.params.userId || req.user._id;
    assertUserOrAdmin(req, targetUserId);

    const { productId } = req.body;
    if (!productId) {
      return res.status(400).json({ message: "productId is required" });
    }

    // Validate product and get seller from product
    const product = await Product.findById(productId).select("_id seller status");
    if (!product) return res.status(404).json({ message: "Product not found" });

    const sellerId = product.seller;
    if (!sellerId) return res.status(400).json({ message: "Product has no seller assigned" });

    // Validate seller exists
    const seller = await SellerProfile.findById(sellerId).select("_id");
    if (!seller) return res.status(404).json({ message: "Seller not found" });

    // Create or fetch wishlist
    const wishlist = await ensureWishlist(targetUserId);

    // Check if product already exists in wishlist
    const idx = wishlist.products.findIndex((p) => String(p.product) === String(productId));

    if (idx > -1) {
      // Already present
      if (wishlist.products[idx].status === "active") {
        // Return populated wishlist to client
        const populated = await Wishlist.findById(wishlist._id)
          .populate({ path: "products.product", select: "name slug price image category brand status" })
          .populate({ path: "products.seller", select: "shopName user" });
        
        const normalizedWishlist = normalizeWishlistResponse(populated);
        return res.status(200).json({ message: "Already in wishlist", wishlist: normalizedWishlist });
      }
      // Was removed before → restore (soft)
      wishlist.products[idx].status = "active";
      wishlist.products[idx].addedAt = new Date();
      wishlist.products[idx].seller = sellerId;
    } else {
      // New entry
      wishlist.products.push({
        product: productId,
        seller: sellerId,
        addedAt: new Date(),
        status: "active",
      });
    }

    await wishlist.save();

    const populated = await Wishlist.findById(wishlist._id)
      .populate({ path: "products.product", select: "name slug price image category brand status" })
      .populate({ path: "products.seller", select: "shopName user" });

    const normalizedWishlist = normalizeWishlistResponse(populated);
    return res.status(201).json({ message: "Added to wishlist", wishlist: normalizedWishlist });
  } catch (error) {
    console.error("addToWishlist error:", error);
    res.status(error.status || 500).json({ message: "Error adding to wishlist", error: error.message });
  }
};

/**
 * Remove product from wishlist (soft remove by default)
 * - Accepts productId in body.
 * PATCH /wishlist/remove  (or /wishlist/:userId/remove)
 * Body: { productId, hard?: boolean }
 */
exports.removeFromWishlist = async (req, res) => {
  try {
    // Use the logged-in user's ID from the JWT token
    const userId = req.user._id;

    // Ensure the user can only remove their own wishlist items (or admin can)
    assertUserOrAdmin(req, userId);

    const { productId, hard } = req.body;
    if (!productId) {
      return res.status(400).json({ message: "productId is required" });
    }

    const wishlist = await ensureWishlist(userId);

    const idx = wishlist.products.findIndex((p) => String(p.product) === String(productId));
    if (idx === -1) {
      return res.status(404).json({ message: "Product not found in wishlist" });
    }

    if (hard === true || hard === "true") {
      // Hard remove: delete from array
      wishlist.products.splice(idx, 1);
    } else {
      // Soft remove: set status to "removed"
      wishlist.products[idx].status = "removed";
    }

    await wishlist.save();

    const populated = await Wishlist.findById(wishlist._id)
      .populate({ path: "products.product", select: "name slug price image category brand status" })
      .populate({ path: "products.seller", select: "shopName user" });

    const normalizedWishlist = normalizeWishlistResponse(populated);
    return res.status(200).json({ message: "Removed from wishlist", wishlist: normalizedWishlist });
  } catch (error) {
    console.error("removeFromWishlist error:", error);
    res.status(error.status || 500).json({ message: "Error removing from wishlist", error: error.message });
  }
};

/**
 * View wishlist (active items only by default)
 * GET /wishlist/:userId?includeRemoved=false
 * If route doesn't include userId, authenticated user is used.
 */
exports.getWishlistByUser = async (req, res) => {
  try {
    // Get the user ID from the JWT token attached by `protect` middleware
    const userId = req.user._id;

    // Only the user themselves or an admin can access
    assertUserOrAdmin(req, userId);

    const includeRemoved = String(req.query.includeRemoved || "false") === "true";

    const wishlist = await ensureWishlist(userId);

    // Filter products based on status
    const items = (wishlist.products || []).filter((p) =>
      includeRemoved ? true : p.status === "active"
    );

    // Build a temp doc to populate filtered products
    const temp = new Wishlist({
      user: wishlist.user,
      products: items,
      _id: wishlist._id,
      createdAt: wishlist.createdAt,
      updatedAt: wishlist.updatedAt,
    });

    // 🔹 Populate product, category (with hierarchy), and seller
    const populated = await Wishlist.populate(temp, [
      {
        path: "products.product",
        select: "name slug price image category brand status",
        populate: {
          path: "category",
          select: "name slug parentCategory",
          populate: {
            path: "parentCategory",
            select: "name slug parentCategory",
            populate: {
              path: "parentCategory",
              select: "name slug", // 🔁 you can go deeper if needed
            },
          },
        },
      },
      { path: "products.seller", select: "shopName user" },
    ]);

    const counts = {
      total: wishlist.products.length,
      active: wishlist.products.filter((p) => p.status === "active").length,
      removed: wishlist.products.filter((p) => p.status === "removed").length,
    };

    const normalizedWishlist = normalizeWishlistResponse(populated);
    return res.status(200).json({ wishlist: normalizedWishlist, counts });
  } catch (error) {
    console.error("getWishlistByUser error:", error);
    res
      .status(error.status || 500)
      .json({ message: "Error fetching wishlist", error: error.message });
  }
};

/**
 * Clear wishlist
 * DELETE /wishlist/:userId?hard=false
 * - hard=true → remove all items from array
 * - hard=false → soft-remove (set all to status: "removed")
 */
exports.clearWishlist = async (req, res) => {
  try {
    // Use the logged-in user ID from JWT token
    const userId = req.user._id;

    // Only the user themselves or an admin can clear the wishlist
    assertUserOrAdmin(req, userId);

    const hard = String(req.query.hard || "false") === "true";

    if (hard) {
      const wl = await Wishlist.findOneAndUpdate(
        { user: userId },
        { $set: { products: [] } },
        { new: true, upsert: true }
      );
      return res.status(200).json({ message: "Wishlist cleared (hard)", wishlist: wl });
    }

    // Soft clear: set all products[].status = "removed"
    const wl = await Wishlist.findOneAndUpdate(
      { user: userId },
      { $set: { "products.$[].status": "removed" } },
      { new: true, upsert: true }
    );

    return res.status(200).json({ message: "Wishlist cleared (soft)", wishlist: wl });
  } catch (error) {
    console.error("clearWishlist error:", error);
    res.status(error.status || 500).json({ message: "Error clearing wishlist", error: error.message });
  }
};

/* =========================================================
 * 🛒 SELLER SIDE (Read-only analytics)
 * =======================================================*/

/**
 * Seller: wishlist stats & top wishlisted products
 * GET /wishlist/seller/:sellerId?limit=10
 * - Admins can view any sellerId; sellers can view only their own.
 */
exports.getSellerWishlistStats = async (req, res) => {
  try {
    let sellerId = req.params.sellerId;
    const limit = Math.max(parseInt(req.query.limit || "10", 10), 1);

    if (req.user?.role === "seller") {
      const mySeller = await SellerProfile.findOne({ user: req.user._id }).select("_id");
      if (!mySeller) {
        return res.status(404).json({ message: "Seller profile not found" });
      }
      sellerId = mySeller._id;
    }

    if (!sellerId) {
      return res.status(400).json({ message: "sellerId is required" });
    }

    const productCollection = Product.collection?.name || "products";

    const pipeline = [
      { $unwind: "$products" },
      { $match: { "products.status": "active", "products.seller": new mongoose.Types.ObjectId(sellerId) } },
      {
        $facet: {
          items: [
            { $group: { _id: "$products.product", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: limit },
            { $lookup: { from: productCollection, localField: "_id", foreignField: "_id", as: "product" } },
            { $unwind: "$product" },
            {
              $project: {
                _id: 0,
                productId: "$product._id",
                name: "$product.name",
                slug: "$product.slug",
                price: "$product.price",
                count: 1,
                image: "$product.image",
                gallery: "$product.gallery"
              }
            }
          ],
          totals: [
            { $group: { _id: null, totalAdds: { $sum: 1 }, usersSet: { $addToSet: "$user" } } },
            { $project: { _id: 0, totalAdds: 1, uniqueUsers: { $size: "$usersSet" } } }
          ]
        }
      }
    ];

    const [result = {}] = await Wishlist.aggregate(pipeline);

    // Post-process images
    const topProducts = (result.items || []).map(p => {
      let img = p.image;

      // Normalize paths: replace backslashes with forward slashes
      if (img) {
        img = img.replace(/\\/g, "/");
      }

      // If image is missing or is a video, fallback to first gallery item
      if (!img || img.endsWith(".mp4")) {
        img = (p.gallery && p.gallery.length > 0) ? p.gallery[0].replace(/\\/g, "/") : null;
      }

      // Build absolute URLs
      const baseUrl = process.env.BASE_URL || "";
      const imageUrl = img ? baseUrl + img : null;
      const galleryUrls = (p.gallery || []).map(g => baseUrl + g.replace(/\\/g, "/"));

      return {
        ...p,
        image: imageUrl,
        gallery: galleryUrls
      };
    });

    return res.status(200).json({
      topProducts,
      totals: (result.totals && result.totals[0]) || { totalAdds: 0, uniqueUsers: 0 }
    });

  } catch (error) {
    console.error("getSellerWishlistStats error:", error);
    res.status(500).json({ message: "Error fetching seller wishlist stats", error: error.message });
  }
};

/* =========================================================
 * 🛠️ ADMIN SIDE (View, moderation, analytics, reporting)
 * =======================================================*/

/**
 * Admin: view all wishlists (paginated)
 * GET /admin/wishlists?page=1&limit=20
 */
exports.getAllWishlistsAdmin = async (req, res) => {
  try {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ message: "Forbidden: admin only" });
    }

    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.max(parseInt(req.query.limit || "20", 10), 1);
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      Wishlist.find({})
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate({ path: "user", select: "name email" })
        .populate({ path: "products.product", select: "name slug price image category brand status" })
        .populate({ path: "products.seller", select: "shopName user" }),
      Wishlist.countDocuments({}),
    ]);

    // Normalize each wishlist in the response
    const normalizedItems = items.map(wishlist => normalizeWishlistResponse(wishlist));

    return res.status(200).json({
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      items: normalizedItems,
    });
  } catch (error) {
    console.error("getAllWishlistsAdmin error:", error);
    res.status(500).json({ message: "Error fetching wishlists", error: error.message });
  }
};

/**
 * Admin: remove a product from ALL wishlists (moderation)
 * POST /admin/wishlists/remove-product
 * Body: { productId, hard?: boolean }
 */
exports.removeProductFromAllWishlistsAdmin = async (req, res) => {
  try {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ message: "Forbidden: admin only" });
    }

    const { productId, hard } = req.body;
    if (!productId) return res.status(400).json({ message: "productId is required" });

    let result;
    if (hard === true || hard === "true") {
      // Pull out the entries entirely
      result = await Wishlist.updateMany({}, { $pull: { products: { product: new mongoose.Types.ObjectId(productId) } } });
      return res.status(200).json({ message: "Product hard-removed from all wishlists", result });
    }

    // Soft-remove: set status="removed" for matching embedded items
    result = await Wishlist.updateMany(
      { "products.product": new mongoose.Types.ObjectId(productId) },
      { $set: { "products.$[el].status": "removed" } },
      { arrayFilters: [{ "el.product": new mongoose.Types.ObjectId(productId) }] }
    );

    return res.status(200).json({ message: "Product soft-removed from all wishlists", result });
  } catch (error) {
    console.error("removeProductFromAllWishlistsAdmin error:", error);
    res.status(500).json({ message: "Error moderating wishlists", error: error.message });
  }
};

/**
 * Admin: most wishlisted products site-wide
 * GET /admin/wishlists/top-products?limit=20
 */
exports.getTopWishlistedProductsAdmin = async (req, res) => {
  try {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ message: "Forbidden: admin only" });
    }

    const limit = Math.max(parseInt(req.query.limit || "20", 10), 1);
    const productCollection = Product.collection?.name || "products";

    const pipeline = [
      { $unwind: "$products" },
      { $match: { "products.status": "active" } },
      { $group: { _id: "$products.product", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: limit },
      {
        $lookup: {
          from: productCollection,
          localField: "_id",
          foreignField: "_id",
          as: "product",
        },
      },
      { $unwind: "$product" },
      {
        $project: {
          _id: 0,
          productId: "$product._id",
          name: "$product.name",
          slug: "$product.slug",
          price: "$product.price",
          count: 1,
          image: "$product.image",
          gallery: "$product.gallery",
        },
      },
    ];

    const rawItems = await Wishlist.aggregate(pipeline);

    // ✅ Normalize image + gallery
    const baseUrl = process.env.BASE_URL || "";
    const items = rawItems.map((p) => {
      let img = p.image;

      // Normalize path slashes
      if (img) img = img.replace(/\\/g, "/");

      // If it's missing or a video, fallback to first gallery image
      if (!img || img.endsWith(".mp4")) {
        img =
          p.gallery && p.gallery.length > 0
            ? p.gallery[0].replace(/\\/g, "/")
            : null;
      }

      const imageUrl = img ? baseUrl + img : null;
      const galleryUrls = (p.gallery || []).map(
        (g) => baseUrl + g.replace(/\\/g, "/")
      );

      return {
        ...p,
        image: imageUrl,
        gallery: galleryUrls,
      };
    });

    return res.status(200).json({ topProducts: items });
  } catch (error) {
    console.error("getTopWishlistedProductsAdmin error:", error);
    res
      .status(500)
      .json({
        message: "Error fetching top wishlisted products",
        error: error.message,
      });
  }
};

/**
 * Admin: active users' wishlist activity (site-wide snapshot)
 * GET /admin/wishlists/activity?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 */
exports.getWishlistActivityAdmin = async (req, res) => {
  try {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ message: "Forbidden: admin only" });
    }

    const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
    const endDate = req.query.endDate ? new Date(req.query.endDate) : null;

    const match = {};
    if (startDate || endDate) {
      match.createdAt = {};
      if (startDate) match.createdAt.$gte = startDate;
      if (endDate) match.createdAt.$lte = endDate;
    }

    const pipeline = [
      ...(Object.keys(match).length ? [{ $match: match }] : []),
      { $unwind: "$products" },
      {
        $group: {
          _id: null,
          totalWishlistEntries: { $sum: 1 },
          activeEntries: {
            $sum: {
              $cond: [{ $eq: ["$products.status", "active"] }, 1, 0],
            },
          },
          removedEntries: {
            $sum: {
              $cond: [{ $eq: ["$products.status", "removed"] }, 1, 0],
            },
          },
          uniqueUsers: { $addToSet: "$user" },
        },
      },
      {
        $project: {
          _id: 0,
          totalWishlistEntries: 1,
          activeEntries: 1,
          removedEntries: 1,
          uniqueUsers: { $size: "$uniqueUsers" },
        },
      },
    ];

    const [snapshot] = await Wishlist.aggregate(pipeline);
    return res.status(200).json(snapshot || { totalWishlistEntries: 0, activeEntries: 0, removedEntries: 0, uniqueUsers: 0 });
  } catch (error) {
    console.error("getWishlistActivityAdmin error:", error);
    res.status(500).json({ message: "Error fetching wishlist activity", error: error.message });
  }
};

/**
 * Admin: most popular sellers by wishlist adds
 * GET /admin/wishlists/top-sellers?limit=10
 */
exports.getTopSellersByWishlistAdmin = async (req, res) => {
  try {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ message: "Forbidden: admin only" });
    }

    const limit = Math.max(parseInt(req.query.limit || "10", 10), 1);
    const sellerCollection = SellerProfile.collection?.name || "sellerprofiles";

    const pipeline = [
      { $unwind: "$products" },
      { $match: { "products.status": "active" } },
      { $group: { _id: "$products.seller", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: limit },
      { $lookup: { from: sellerCollection, localField: "_id", foreignField: "_id", as: "seller" } },
      { $unwind: "$seller" },
      {
        $project: {
          _id: 0,
          sellerId: "$seller._id",
          shopName: "$seller.shopName",
          count: 1,
        },
      },
    ];

    const items = await Wishlist.aggregate(pipeline);
    return res.status(200).json({ topSellers: items });
  } catch (error) {
    console.error("getTopSellersByWishlistAdmin error:", error);
    res.status(500).json({ message: "Error fetching top sellers", error: error.message });
  }
};

/**
 * Admin: most popular categories by wishlist adds
 * GET /admin/wishlists/top-categories?limit=10
 */
exports.getTopCategoriesByWishlistAdmin = async (req, res) => {
  try {
    if (req.user?.role !== "admin") {
      return res.status(403).json({ message: "Forbidden: admin only" });
    }

    const limit = Math.max(parseInt(req.query.limit || "10", 10), 1);

    const pipeline = [
      { $unwind: "$products" },
      { $match: { "products.status": "active" } },

      {
        $lookup: {
          from: "products",
          localField: "products.product",
          foreignField: "_id",
          as: "prod",
        },
      },
      { $unwind: "$prod" },
      { $match: { "prod.status": "approved" } },

      // Normalize category field -> always ObjectId
      {
        $addFields: {
          categoryObjId: {
            $cond: [
              { $eq: [{ $type: "$prod.category" }, "objectId"] },
              "$prod.category",
              {
                $cond: [
                  { $eq: [{ $type: "$prod.category" }, "string"] },
                  { $toObjectId: "$prod.category" },
                  null,
                ],
              },
            ],
          },
        },
      },

      {
        $group: {
          _id: "$categoryObjId",
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: limit },

      // 🔍 Debug stage: see what categoryObjId looks like
      {
        $project: {
          _id: 1,
          count: 1,
          debugCategoryId: "$_id",
        },
      },

      // Lookup category details
      {
        $lookup: {
          from: "categories",
          let: { catId: "$_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$_id", "$$catId"] } } },
            { $project: { _id: 1, name: 1, slug: 1 } },
          ],
          as: "category",
        },
      },
      { $unwind: { path: "$category", preserveNullAndEmptyArrays: true } },

      {
        $project: {
          _id: 0,
          categoryId: { $ifNull: ["$category._id", "$_id"] },
          name: { $ifNull: ["$category.name", "Unknown Category"] },
          slug: { $ifNull: ["$category.slug", "unknown-category"] },
          count: 1,
          debugCategoryId: 1,
        },
      },
    ];

    const items = await Wishlist.aggregate(pipeline);
    return res.status(200).json({ topCategories: items });
  } catch (error) {
    console.error("getTopCategoriesByWishlistAdmin error:", error);
    res.status(500).json({
      message: "Error fetching top categories",
      error: error.message,
    });
  }
};