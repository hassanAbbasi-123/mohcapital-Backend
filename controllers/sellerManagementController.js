const mongoose = require("mongoose");
const User = require("../models/userModel");
const Order = require("../models/ordermodel/orderModel");
const SubOrder = require("../models/ordermodel/subOrderModel");
const SellerProfile = require("../models/sellerProfile");

// GET all seller applications (Admin only) — FULL HYBRID + ALL FIELDS
exports.getSellerApplications = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Access denied. Admin only." });
    }

    const { status, page = 1, limit = 10, search } = req.query;
    const skip = (page - 1) * limit;

    // Build base filter
    const userFilter = { role: "seller" };
    if (search) {
      userFilter.$or = [
        { "seller.storeName": { $regex: search, $options: "i" } },
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    // Fetch users + join SellerProfile
    const users = await User.aggregate([
      { $match: userFilter },
      {
        $lookup: {
          from: "sellerprofiles",
          localField: "_id",
          foreignField: "user",
          as: "profile",
        },
      },
      { $unwind: { path: "$profile", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          name: 1,
          email: 1,
          phone: 1,
          isActive: 1,
          createdAt: 1,
          seller: {
            // Core Info
            storeName: { $ifNull: ["$profile.storeName", "$seller.storeName"] },
            storeDescription: { $ifNull: ["$profile.storeDescription", "$seller.storeDescription"] },
            logo: { $ifNull: ["$profile.logo", "$seller.logo"] },

            // Tax & Identity
            gstin: { $ifNull: ["$profile.gstin", "$seller.gstin"] },
            pan: { $ifNull: ["$profile.pan", "$seller.pan"] },

            // Business
            businessType: { $ifNull: ["$profile.businessType", "$seller.businessType"] },

            // Full Location
            address: { $ifNull: ["$profile.location.address", "$seller.address"] },
            city: { $ifNull: ["$profile.location.city", "$seller.city"] },
            district: { $ifNull: ["$profile.location.district", "$seller.district"] },
            state: { $ifNull: ["$profile.location.state", "$seller.state"] },
            pincode: { $ifNull: ["$profile.location.pincode", "$seller.pincode"] },

            // KYC Status (Hybrid)
            kycStatus: {
              $cond: {
                if: { $ifNull: ["$profile._id", false] },
                then: {
                  $switch: {
                    branches: [
                      { case: { $eq: ["$profile.kyc.status", "verified"] }, then: "approved" },
                      { case: { $eq: ["$profile.kyc.status", "rejected"] }, then: "rejected" },
                    ],
                    default: "pending"
                  }
                },
                else: { $ifNull: ["$seller.kycStatus", "pending"] }
              }
            },

            // Documents (with type, url, uploadedAt)
            documents: {
              $cond: {
                if: { $ifNull: ["$profile.kyc.documents", false] },
                then: {
                  $map: {
                    input: "$profile.kyc.documents",
                    as: "doc",
                    in: {
                      type: "$$doc.type",
                      url: "$$doc.url",
                      uploadedAt: "$$doc.uploadedAt",
                    }
                  }
                },
                else: { $ifNull: ["$seller.documents", []] }
              }
            },

            // Verification Flags
            isVerified: { $ifNull: ["$profile.isVerified", "$seller.isVerified"] },
            verifiedAt: { $ifNull: ["$profile.kyc.verifiedAt", "$seller.verifiedAt"] },

            // Timestamps
            createdAt: { $ifNull: ["$profile.createdAt", "$seller.createdAt"] },
          },
        },
      },
      { $sort: { "seller.createdAt": -1 } },
      { $skip: skip },
      { $limit: +limit },
    ]);

    // Apply status filter *after* projection
    const statusMap = {
      pending: "pending",
      approved: "approved",
      rejected: "rejected",
    };

    const filteredSellers = status
      ? users.filter((u) => u.seller.kycStatus === statusMap[status])
      : users;

    const totalCount = filteredSellers.length > 0
      ? await User.countDocuments(userFilter)
      : 0;

    // Counts (with full hybrid logic)
    const counts = await User.aggregate([
      { $match: { role: "seller" } },
      {
        $lookup: {
          from: "sellerprofiles",
          localField: "_id",
          foreignField: "user",
          as: "profile",
        },
      },
      { $unwind: { path: "$profile", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          approved: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $eq: ["$profile.kyc.status", "verified"] },
                    { $eq: ["$seller.kycStatus", "approved"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          pending: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$profile.kyc.status", "verified"] },
                    { $ne: ["$profile.kyc.status", "rejected"] },
                    { $ne: ["$seller.kycStatus", "approved"] },
                    { $ne: ["$seller.kycStatus", "rejected"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          rejected: {
            $sum: {
              $cond: [
                {
                  $or: [
                    { $eq: ["$profile.kyc.status", "rejected"] },
                    { $eq: ["$seller.kycStatus", "rejected"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    const stats = counts[0] || { total: 0, approved: 0, pending: 0, rejected: 0 };

    res.json({
      totalCount,
      activeCount: stats.approved,
      pendingCount: stats.pending,
      rejectedCount: stats.rejected,
      sellers: filteredSellers,
    });
  } catch (err) {
    console.error("getSellerApplications error:", err);
    res.status(500).json({ message: err.message });
  }
};

// GET performance metrics for a specific seller (Admin or Seller themselves) — HYBRID
exports.getSellerPerformance = async (req, res) => {
  try {
    const { sellerId } = req.params;

    const sellerUser = await User.findById(sellerId).select("seller role");
    if (!sellerUser || sellerUser.role !== "seller") {
      return res.status(404).json({ message: "Seller not found" });
    }

    // Authorization: Admin or the seller themselves
    const isAdmin = req.user.role === "admin";
    const isOwner = req.user._id.toString() === sellerId;

    if (!isAdmin && !isOwner) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Get full seller data (hybrid)
    const sellerProfile = await SellerProfile.findOne({ user: sellerId });
    const sellerData = sellerProfile || sellerUser.seller;

    // Aggregate suborders for this seller
    const subOrders = await SubOrder.find({ seller: sellerId });

    const totalOrders = subOrders.length;
    const totalRevenue = subOrders.reduce((sum, so) => sum + (so.sellerEarning || 0), 0);
    const totalCommission = subOrders.reduce((sum, so) => sum + (so.commissionAmount || 0), 0);
    const pendingDeliveries = subOrders.filter(
      (so) => so.subOrderStatus === "pending" || so.subOrderStatus === "processing"
    ).length;
    const completedOrders = subOrders.filter((so) => so.subOrderStatus === "completed").length;
    const cancelledOrders = subOrders.filter((so) => so.subOrderStatus === "cancelled").length;

    res.json({
      seller: {
        _id: sellerUser._id,
        storeName: sellerData.storeName,
        gstin: sellerData.gstin,
        pan: sellerData.pan,
        businessType: sellerData.businessType,
        city: sellerData.location?.city || sellerData.city,
        state: sellerData.location?.state || sellerData.state,
        address: sellerData.location?.address || sellerData.address,
        kycStatus: sellerProfile?.kyc.status === "verified" ? "approved" : sellerUser.seller.kycStatus,
        logo: sellerData.logo,
        documents: sellerProfile?.kyc.documents.map(d => ({ type: d.type, url: d.url })) || sellerData.documents || [],
      },
      metrics: {
        totalOrders,
        totalRevenue,
        totalCommission,
        pendingDeliveries,
        completedOrders,
        cancelledOrders,
      },
    });
  } catch (err) {
    console.error("getSellerPerformance error:", err);
    res.status(500).json({ message: err.message });
  }
};

// APPROVE / REJECT — HYBRID
exports.approveOrDisapproveSeller = async (req, res) => {
  try {
    console.log("=== APPROVE/DISAPPROVE DEBUG ===");
    console.log("req.user:", req.user._id, req.user.role);
    console.log("sellerId:", req.params.sellerId);
    console.log("action:", req.body.action);

    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Access denied. Admin only." });
    }

    const { sellerId } = req.params;
    const { action } = req.body;

    if (!["approve", "reject"].includes(action)) {
      return res.status(400).json({ message: "action must be 'approve' or 'reject'" });
    }

    if (!mongoose.Types.ObjectId.isValid(sellerId)) {
      return res.status(400).json({ message: "Invalid sellerId" });
    }

    // Try new SellerProfile
    const sellerProfile = await SellerProfile.findOne({ user: sellerId }).populate("user", "role");

    if (sellerProfile) {
      console.log("Found SellerProfile:", sellerProfile._id);

      sellerProfile.kyc.status = action === "approve" ? "verified" : "rejected";
      if (action === "approve") {
        sellerProfile.isVerified = true;
        sellerProfile.kyc.verifiedAt = new Date();
        sellerProfile.kyc.verifiedBy = req.user._id;
      } else {
        sellerProfile.isVerified = false;
        sellerProfile.kyc.verifiedAt = null;
        sellerProfile.kyc.verifiedBy = null;
      }
      await sellerProfile.save();

      console.log("SellerProfile updated:", {
        kycStatus: sellerProfile.kyc.status,
        isVerified: sellerProfile.isVerified,
      });

      return res.json({
        message: `Seller ${action}d successfully`,
        seller: {
          _id: sellerProfile.user._id,
          storeName: sellerProfile.storeName,
          kycStatus: sellerProfile.kyc.status === "verified" ? "approved" : "rejected",
        },
      });
    }

    // Legacy fallback
    console.log("No SellerProfile found. Trying legacy User.seller...");
    const legacyUser = await User.findById(sellerId);
    if (!legacyUser || legacyUser.role !== "seller") {
      console.log("Legacy user not found or not seller");
      return res.status(404).json({ message: "Seller not found" });
    }

    if (!legacyUser.seller) {
      console.log("Legacy user.seller subdoc missing!");
      return res.status(500).json({ message: "Seller data incomplete (missing seller subdoc)" });
    }

    legacyUser.seller.kycStatus = action === "approve" ? "approved" : "rejected";
    legacyUser.seller.verifiedAt = action === "approve" ? new Date() : null;
    await legacyUser.save();

    console.log("Legacy user updated:", legacyUser.seller.kycStatus);

    res.json({
      message: `Seller ${action}d successfully`,
      seller: {
        _id: legacyUser._id,
        storeName: legacyUser.seller.storeName,
        kycStatus: legacyUser.seller.kycStatus,
      },
    });
  } catch (err) {
    console.error("approveOrDisapproveSeller error:", err);
    res.status(500).json({ message: err.message });
  }
};