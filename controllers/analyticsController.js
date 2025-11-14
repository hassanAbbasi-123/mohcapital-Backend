const mongoose = require("mongoose");
const {
  productModel: Product,categoryModel: Category,Brand,
  coupon: Coupon,SellerProfile, User, Order,SubOrder,ReturnRequest,Dispute
} = require("../models/indexModel");


// ---------- ADMIN ANALYTICS ----------
// 1) Get Dashboard Overview (Admin)
exports.getAdminDashboard = async (req, res) => {
  try {
    const { from, to } = req.query;
    const match = {};
    
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = new Date(from);
      if (to) match.createdAt.$lte = new Date(to);
    }

    // Total counts
    const totalUsers = await User.countDocuments();
    const totalSellers = await SellerProfile.countDocuments({ isVerified: true });
    const totalProducts = await Product.countDocuments();
    const totalOrders = await Order.countDocuments(match);
    const totalRevenue = await Order.aggregate([
      { $match: { ...match, paymentStatus: "paid" } },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } }
    ]);
    
    // Recent orders
    const recentOrders = await Order.find(match)
      .populate("user", "name email")
      .sort({ createdAt: -1 })
      .limit(10);
    
    // Pending approvals
    const pendingProducts = await Product.countDocuments({ status: "pending" });
    const pendingSellers = await SellerProfile.countDocuments({ 
      verificationStatus: "pending" 
    });
    
    // Order status counts
    const orderStatusCounts = await Order.aggregate([
      { $match: match },
      { $group: { _id: "$orderStatus", count: { $sum: 1 } } }
    ]);
    
    // Product status counts
    const productStatusCounts = await Product.aggregate([
      { $match: match },
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]);
    
    // Monthly revenue (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    const monthlyRevenue = await Order.aggregate([
      { 
        $match: { 
          createdAt: { $gte: sixMonthsAgo },
          paymentStatus: "paid" 
        } 
      },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" }
          },
          revenue: { $sum: "$totalAmount" },
          orders: { $sum: 1 }
        }
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } }
    ]);
    
    // Top performing categories
    const topCategories = await Order.aggregate([
      { $match: { ...match, paymentStatus: "paid" } },
      { $unwind: "$items" },
      {
        $lookup: {
          from: "products",
          localField: "items.product",
          foreignField: "_id",
          as: "product"
        }
      },
      { $unwind: "$product" },
      {
        $lookup: {
          from: "categories",
          localField: "product.category",
          foreignField: "_id",
          as: "category"
        }
      },
      { $unwind: "$category" },
      {
        $group: {
          _id: "$category._id",
          name: { $first: "$category.name" },
          revenue: { $sum: "$items.subtotal" },
          orders: { $sum: 1 },
          items: { $sum: "$items.quantity" }
        }
      },
      { $sort: { revenue: -1 } },
      { $limit: 5 }
    ]);
    
    // Top performing sellers
    const topSellers = await Order.aggregate([
      { $match: { ...match, paymentStatus: "paid" } },
      { $unwind: "$items" },
      {
        $lookup: {
          from: "sellerprofiles",
          localField: "items.seller",
          foreignField: "_id",
          as: "seller"
        }
      },
      { $unwind: "$seller" },
      {
        $group: {
          _id: "$seller._id",
          storeName: { $first: "$seller.storeName" },
          revenue: { $sum: "$items.subtotal" },
          orders: { $sum: 1 },
          items: { $sum: "$items.quantity" }
        }
      },
      { $sort: { revenue: -1 } },
      { $limit: 5 }
    ]);

    res.json({
      overview: {
        totalUsers,
        totalSellers,
        totalProducts,
        totalOrders,
        totalRevenue: totalRevenue[0]?.total || 0,
        pendingProducts,
        pendingSellers
      },
      orderStatusCounts,
      productStatusCounts,
      monthlyRevenue,
      topCategories,
      topSellers,
      recentOrders
    });
  } catch (err) {
    console.error("Error fetching admin dashboard:", err);
    res.status(500).json({ 
      message: "Error fetching admin dashboard", 
      error: err.message 
    });
  }
};
// 2) Get Sales Reports (Admin)
exports.getSalesReport = async (req, res) => {
  try {
    const { from, to, groupBy = "day" } = req.query;
    const match = {};
    
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = new Date(from);
      if (to) match.createdAt.$lte = new Date(to);
    }

    let groupFormat = {};
    if (groupBy === "day") {
      groupFormat = {
        year: { $year: "$createdAt" },
        month: { $month: "$createdAt" },
        day: { $dayOfMonth: "$createdAt" }
      };
    } else if (groupBy === "week") {
      groupFormat = {
        year: { $year: "$createdAt" },
        week: { $week: "$createdAt" }
      };
    } else if (groupBy === "month") {
      groupFormat = {
        year: { $year: "$createdAt" },
        month: { $month: "$createdAt" }
      };
    }

    const salesData = await Order.aggregate([
      { $match: { ...match, paymentStatus: "paid" } },
      {
        $group: {
          _id: groupFormat,
          revenue: { $sum: "$totalAmount" },
          orders: { $sum: 1 },
          averageOrderValue: { $avg: "$totalAmount" }
        }
      },
      { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1, "_id.week": 1 } }
    ]);

    // Get sales by payment method
    const salesByPaymentMethod = await Order.aggregate([
      { $match: { ...match, paymentStatus: "paid" } },
      {
        $group: {
          _id: "$paymentMethod",
          revenue: { $sum: "$totalAmount" },
          orders: { $sum: 1 }
        }
      }
    ]);

    // Get sales by category
    const salesByCategory = await Order.aggregate([
      { $match: { ...match, paymentStatus: "paid" } },
      { $unwind: "$items" },
      {
        $lookup: {
          from: "products",
          localField: "items.product",
          foreignField: "_id",
          as: "product"
        }
      },
      { $unwind: "$product" },
      {
        $lookup: {
          from: "categories",
          localField: "product.category",
          foreignField: "_id",
          as: "category"
        }
      },
      { $unwind: "$category" },
      {
        $group: {
          _id: "$category._id",
          name: { $first: "$category.name" },
          revenue: { $sum: "$items.subtotal" },
          orders: { $sum: 1 },
          items: { $sum: "$items.quantity" }
        }
      },
      { $sort: { revenue: -1 } }
    ]);

    res.json({
      salesData,
      salesByPaymentMethod,
      salesByCategory
    });
  } catch (err) {
    console.error("Error fetching sales report:", err);
    res.status(500).json({ 
      message: "Error fetching sales report", 
      error: err.message 
    });
  }
};
// 3) Get Product Performance Report (Admin)
exports.getProductPerformance = async (req, res) => {
  try {
    const { from, to, category, status } = req.query;
    const match = {};
    
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = new Date(from);
      if (to) match.createdAt.$lte = new Date(to);
    }
    
    if (category) match["product.category"] = new mongoose.Types.ObjectId(category);
    if (status) match.status = status;

    // Top selling products
    const topProducts = await Order.aggregate([
      { $match: { ...match, paymentStatus: "paid" } },
      { $unwind: "$items" },
      {
        $lookup: {
          from: "products",
          localField: "items.product",
          foreignField: "_id",
          as: "product"
        }
      },
      { $unwind: "$product" },
      {
        $group: {
          _id: "$product._id",
          name: { $first: "$product.name" },
          category: { $first: "$product.category" },
          price: { $first: "$product.price" },
          revenue: { $sum: "$items.subtotal" },
          orders: { $sum: 1 },
          quantity: { $sum: "$items.quantity" }
        }
      },
      { $sort: { revenue: -1 } },
      { $limit: 20 }
    ]);

    // Populate category names
    const categoryIds = [...new Set(topProducts.map(p => p.category))];
    const categories = await Category.find({ _id: { $in: categoryIds } });
    const categoryMap = {};
    categories.forEach(cat => {
      categoryMap[cat._id] = cat.name;
    });

    const productsWithCategory = topProducts.map(product => ({
      ...product,
      categoryName: categoryMap[product.category] || "Unknown"
    }));

    // Low stock products
    const lowStockProducts = await Product.find({
      quantity: { $lte: 10 },
      status: "approved"
    })
    .populate("category", "name")
    .populate("brand", "name")
    .sort({ quantity: 1 })
    .limit(20);

    // Product status distribution
    const productStatusDistribution = await Product.aggregate([
      { $match: match },
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]);

    res.json({
      topProducts: productsWithCategory,
      lowStockProducts,
      productStatusDistribution
    });
  } catch (err) {
    console.error("Error fetching product performance:", err);
    res.status(500).json({ 
      message: "Error fetching product performance", 
      error: err.message 
    });
  }
};
// 4) Get Customer Analytics (Admin)
exports.getCustomerAnalytics = async (req, res) => {
  try {
    const { from, to } = req.query;
    const match = {};
    
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = new Date(from);
      if (to) match.createdAt.$lte = new Date(to);
    }

    // Customer acquisition
    const customerAcquisition = await User.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" }
          },
          count: { $sum: 1 }
        }
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } }
    ]);

    // Top customers by spending
    const topCustomers = await Order.aggregate([
      { $match: { ...match, paymentStatus: "paid" } },
      {
        $group: {
          _id: "$user",
          totalSpent: { $sum: "$totalAmount" },
          orders: { $sum: 1 }
        }
      },
      { $sort: { totalSpent: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "user"
        }
      },
      { $unwind: "$user" },
      {
        $project: {
          _id: 0,
          userId: "$user._id",
          name: "$user.name",
          email: "$user.email",
          totalSpent: 1,
          orders: 1
        }
      }
    ]);

    // Customer geographic distribution
    const customerLocation = await Order.aggregate([
      { $match: { ...match, paymentStatus: "paid" } },
      {
        $group: {
          _id: "$shippingAddress.city",
          revenue: { $sum: "$totalAmount" },
          orders: { $sum: 1 },
          customers: { $addToSet: "$user" }
        }
      },
      {
        $project: {
          city: "$_id",
          revenue: 1,
          orders: 1,
          customerCount: { $size: "$customers" }
        }
      },
      { $sort: { revenue: -1 } },
      { $limit: 15 }
    ]);

    // Repeat customer rate
    const customerOrders = await Order.aggregate([
      { $match: { ...match, paymentStatus: "paid" } },
      {
        $group: {
          _id: "$user",
          orderCount: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: null,
          totalCustomers: { $sum: 1 },
          repeatCustomers: {
            $sum: {
              $cond: [{ $gt: ["$orderCount", 1] }, 1, 0]
            }
          }
        }
      }
    ]);

    const repeatCustomerRate = customerOrders.length > 0 
      ? (customerOrders[0].repeatCustomers / customerOrders[0].totalCustomers) * 100 
      : 0;

    res.json({
      customerAcquisition,
      topCustomers,
      customerLocation,
      repeatCustomerRate: Math.round(repeatCustomerRate * 100) / 100
    });
  } catch (err) {
    console.error("Error fetching customer analytics:", err);
    res.status(500).json({ 
      message: "Error fetching customer analytics", 
      error: err.message 
    });
  }
};
// 5) Get Financial Reports (Admin)
exports.getFinancialReport = async (req, res) => {
  try {
    const { from, to } = req.query;
    const match = {};
    
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = new Date(from);
      if (to) match.createdAt.$lte = new Date(to);
    }

    // Revenue breakdown
    const revenueBreakdown = await Order.aggregate([
      { $match: { ...match, paymentStatus: "paid" } },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: "$totalAmount" },
          productRevenue: { $sum: "$itemsTotal" },
          taxRevenue: { $sum: "$taxes" },
          shippingRevenue: { $sum: "$shippingFee" },
          discountAmount: { $sum: "$discounts" }
        }
      }
    ]);

    // Revenue by seller (for commission calculation)
    const revenueBySeller = await Order.aggregate([
      { $match: { ...match, paymentStatus: "paid" } },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.seller",
          revenue: { $sum: "$items.subtotal" },
          orders: { $sum: 1 },
          items: { $sum: "$items.quantity" }
        }
      },
      { $sort: { revenue: -1 } },
      {
        $lookup: {
          from: "sellerprofiles",
          localField: "_id",
          foreignField: "_id",
          as: "seller"
        }
      },
      { $unwind: "$seller" },
      {
        $project: {
          storeName: "$seller.storeName",
          revenue: 1,
          orders: 1,
          items: 1,
          commission: { $multiply: ["$revenue", 0.1] } // 10% commission example
        }
      }
    ]);

    // Refunds and disputes
    const refunds = await Order.aggregate([
      { $match: { ...match, orderStatus: "refunded" } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          amount: { $sum: "$totalAmount" }
        }
      }
    ]);

    const disputes = await Dispute.aggregate([
      { $match: match },
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]);

    res.json({
      revenueBreakdown: revenueBreakdown[0] || {},
      revenueBySeller,
      refunds: refunds[0] || { count: 0, amount: 0 },
      disputes
    });
  } catch (err) {
    console.error("Error fetching financial report:", err);
    res.status(500).json({ 
      message: "Error fetching financial report", 
      error: err.message 
    });
  }
};

// ---------- SELLER ANALYTICS ----------

// 1) Get Seller Dashboard
exports.getSellerDashboard = async (req, res) => {
  try {
    const seller = await SellerProfile.findOne({ user: req.user._id });
    if (!seller) {
      return res.status(404).json({ message: "Seller profile not found" });
    }

    const { from, to } = req.query;
    const match = { seller: seller._id };
    
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = new Date(from);
      if (to) match.createdAt.$lte = new Date(to);
    }

    // Seller overview
    const overview = await SubOrder.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: "$totalAmount" },
          pendingOrders: {
            $sum: { $cond: [{ $eq: ["$subOrderStatus", "pending"] }, 1, 0] }
          },
          processingOrders: {
            $sum: { $cond: [{ $eq: ["$subOrderStatus", "processing"] }, 1, 0] }
          },
          completedOrders: {
            $sum: { $cond: [{ $eq: ["$subOrderStatus", "completed"] }, 1, 0] }
          }
        }
      }
    ]);

    // Recent orders
    const recentOrders = await SubOrder.find(match)
      .populate({
        path: "order",
        populate: { path: "user", select: "name email" }
      })
      .sort({ createdAt: -1 })
      .limit(10);

    // Top products
    const topProducts = await SubOrder.aggregate([
      { $match: match },
      { $unwind: "$items" },
      {
        $lookup: {
          from: "products",
          localField: "items.product",
          foreignField: "_id",
          as: "product"
        }
      },
      { $unwind: "$product" },
      {
        $group: {
          _id: "$product._id",
          name: { $first: "$product.name" },
          revenue: { $sum: "$items.subtotal" },
          orders: { $sum: 1 },
          quantity: { $sum: "$items.quantity" }
        }
      },
      { $sort: { revenue: -1 } },
      { $limit: 5 }
    ]);

    // Monthly revenue (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    const monthlyRevenue = await SubOrder.aggregate([
      { 
        $match: { 
          seller: seller._id,
          createdAt: { $gte: sixMonthsAgo },
          subOrderStatus: "completed"
        } 
      },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" }
          },
          revenue: { $sum: "$totalAmount" },
          orders: { $sum: 1 }
        }
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } }
    ]);

    res.json({
      overview: overview[0] || {
        totalOrders: 0,
        totalRevenue: 0,
        pendingOrders: 0,
        processingOrders: 0,
        completedOrders: 0
      },
      recentOrders,
      topProducts,
      monthlyRevenue
    });
  } catch (err) {
    console.error("Error fetching seller dashboard:", err);
    res.status(500).json({ 
      message: "Error fetching seller dashboard", 
      error: err.message 
    });
  }
};
// 2) Get Seller Sales Report
exports.getSellerSalesReport = async (req, res) => {
  try {
    const seller = await SellerProfile.findOne({ user: req.user._id });
    if (!seller) {
      return res.status(404).json({ message: "Seller profile not found" });
    }

    const { from, to, groupBy = "day" } = req.query;
    const match = { seller: seller._id, subOrderStatus: "completed" };
    
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = new Date(from);
      if (to) match.createdAt.$lte = new Date(to);
    }

    let groupFormat = {};
    if (groupBy === "day") {
      groupFormat = {
        year: { $year: "$createdAt" },
        month: { $month: "$createdAt" },
        day: { $dayOfMonth: "$createdAt" }
      };
    } else if (groupBy === "week") {
      groupFormat = {
        year: { $year: "$createdAt" },
        week: { $week: "$createdAt" }
      };
    } else if (groupBy === "month") {
      groupFormat = {
        year: { $year: "$createdAt" },
        month: { $month: "$createdAt" }
      };
    }

    const salesData = await SubOrder.aggregate([
      { $match: match },
      {
        $group: {
          _id: groupFormat,
          revenue: { $sum: "$totalAmount" },
          orders: { $sum: 1 },
          averageOrderValue: { $avg: "$totalAmount" }
        }
      },
      { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1, "_id.week": 1 } }
    ]);

    // Sales by product category
    const salesByCategory = await SubOrder.aggregate([
      { $match: match },
      { $unwind: "$items" },
      {
        $lookup: {
          from: "products",
          localField: "items.product",
          foreignField: "_id",
          as: "product"
        }
      },
      { $unwind: "$product" },
      {
        $lookup: {
          from: "categories",
          localField: "product.category",
          foreignField: "_id",
          as: "category"
        }
      },
      { $unwind: "$category" },
      {
        $group: {
          _id: "$category._id",
          name: { $first: "$category.name" },
          revenue: { $sum: "$items.subtotal" },
          orders: { $sum: 1 },
          items: { $sum: "$items.quantity" }
        }
      },
      { $sort: { revenue: -1 } }
    ]);

    res.json({
      salesData,
      salesByCategory
    });
  } catch (err) {
    console.error("Error fetching seller sales report:", err);
    res.status(500).json({ 
      message: "Error fetching seller sales report", 
      error: err.message 
    });
  }
};
// 3) Get Seller Product Performance
exports.getSellerProductPerformance = async (req, res) => {
  try {
    const seller = await SellerProfile.findOne({ user: req.user._id });
    if (!seller) {
      return res.status(404).json({ message: "Seller profile not found" });
    }

    const { from, to } = req.query;
    const match = { seller: seller._id, subOrderStatus: "completed" };
    
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = new Date(from);
      if (to) match.createdAt.$lte = new Date(to);
    }

    // Top selling products
    const topProducts = await SubOrder.aggregate([
      { $match: match },
      { $unwind: "$items" },
      {
        $lookup: {
          from: "products",
          localField: "items.product",
          foreignField: "_id",
          as: "product"
        }
      },
      { $unwind: "$product" },
      {
        $group: {
          _id: "$product._id",
          name: { $first: "$product.name" },
          category: { $first: "$product.category" },
          price: { $first: "$product.price" },
          revenue: { $sum: "$items.subtotal" },
          orders: { $sum: 1 },
          quantity: { $sum: "$items.quantity" }
        }
      },
      { $sort: { revenue: -1 } }
    ]);

    // Populate category names
    const categoryIds = [...new Set(topProducts.map(p => p.category))];
    const categories = await Category.find({ _id: { $in: categoryIds } });
    const categoryMap = {};
    categories.forEach(cat => {
      categoryMap[cat._id] = cat.name;
    });

    const productsWithCategory = topProducts.map(product => ({
      ...product,
      categoryName: categoryMap[product.category] || "Unknown"
    }));

    // Inventory status
    const inventoryStatus = await Product.aggregate([
      { $match: { seller: seller._id } },
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          inStock: {
            $sum: { $cond: [{ $eq: ["$inStock", true] }, 1, 0] }
          },
          outOfStock: {
            $sum: { $cond: [{ $eq: ["$inStock", false] }, 1, 0] }
          },
          lowStock: {
            $sum: { $cond: [{ $and: [{ $lte: ["$quantity", 10] }, { $gt: ["$quantity", 0] }] }, 1, 0] }
          }
        }
      }
    ]);

    res.json({
      topProducts: productsWithCategory,
      inventoryStatus: inventoryStatus[0] || {
        totalProducts: 0,
        inStock: 0,
        outOfStock: 0,
        lowStock: 0
      }
    });
  } catch (err) {
    console.error("Error fetching seller product performance:", err);
    res.status(500).json({ 
      message: "Error fetching seller product performance", 
      error: err.message 
    });
  }
};
// 4) Get Seller Order Analytics
exports.getSellerOrderAnalytics = async (req, res) => {
  try {
    const seller = await SellerProfile.findOne({ user: req.user._id });
    if (!seller) {
      return res.status(404).json({ message: "Seller profile not found" });
    }

    const { from, to } = req.query;
    const match = { seller: seller._id };
    
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = new Date(from);
      if (to) match.createdAt.$lte = new Date(to);
    }

    // Order status distribution
    const orderStatusDistribution = await SubOrder.aggregate([
      { $match: match },
      { $group: { _id: "$subOrderStatus", count: { $sum: 1 } } }
    ]);

    // Average order value over time
    const avgOrderValue = await SubOrder.aggregate([
      { $match: { ...match, subOrderStatus: "completed" } },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" }
          },
          avgOrderValue: { $avg: "$totalAmount" },
          orderCount: { $sum: 1 }
        }
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } }
    ]);

    // Cancellation and return rates
    const cancellationStats = await SubOrder.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          cancelledOrders: {
            $sum: { $cond: [{ $eq: ["$subOrderStatus", "cancelled"] }, 1, 0] }
          }
        }
      }
    ]);

    const returnStats = await ReturnRequest.aggregate([
      { 
        $match: { 
          seller: seller._id,
          createdAt: from || to ? {
            ...(from && { $gte: new Date(from) }),
            ...(to && { $lte: new Date(to) })
          } : {}
        } 
      },
      {
        $group: {
          _id: null,
          totalReturns: { $sum: 1 },
          pendingReturns: {
            $sum: { $cond: [{ $eq: ["$status", "requested"] }, 1, 0] }
          },
          approvedReturns: {
            $sum: { $cond: [{ $eq: ["$status", "approved"] }, 1, 0] }
          },
          completedReturns: {
            $sum: { $cond: [{ $eq: ["$status", "refunded"] }, 1, 0] }
          }
        }
      }
    ]);

    const cancellationRate = cancellationStats.length > 0 && cancellationStats[0].totalOrders > 0
      ? (cancellationStats[0].cancelledOrders / cancellationStats[0].totalOrders) * 100
      : 0;

    res.json({
      orderStatusDistribution,
      avgOrderValue,
      cancellationStats: cancellationStats[0] || { totalOrders: 0, cancelledOrders: 0 },
      returnStats: returnStats[0] || {
        totalReturns: 0,
        pendingReturns: 0,
        approvedReturns: 0,
        completedReturns: 0
      },
      cancellationRate: Math.round(cancellationRate * 100) / 100
    });
  } catch (err) {
    console.error("Error fetching seller order analytics:", err);
    res.status(500).json({ 
      message: "Error fetching seller order analytics", 
      error: err.message 
    });
  }
};
// 5) Get Seller Customer Insights
exports.getSellerCustomerInsights = async (req, res) => {
  try {
    const seller = await SellerProfile.findOne({ user: req.user._id });
    if (!seller) {
      return res.status(404).json({ message: "Seller profile not found" });
    }

    const { from, to } = req.query;
    const match = { seller: seller._id, subOrderStatus: "completed" };
    
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = new Date(from);
      if (to) match.createdAt.$lte = new Date(to);
    }

    // Top customers
    const topCustomers = await SubOrder.aggregate([
      { $match: match },
      {
        $lookup: {
          from: "orders",
          localField: "order",
          foreignField: "_id",
          as: "order"
        }
      },
      { $unwind: "$order" },
      {
        $group: {
          _id: "$order.user",
          totalSpent: { $sum: "$totalAmount" },
          orders: { $sum: 1 }
        }
      },
      { $sort: { totalSpent: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "user"
        }
      },
      { $unwind: "$user" },
      {
        $project: {
          _id: 0,
          userId: "$user._id",
          name: "$user.name",
          email: "$user.email",
          totalSpent: 1,
          orders: 1
        }
      }
    ]);

    // Customer geographic distribution
    const customerLocation = await SubOrder.aggregate([
      { $match: match },
      {
        $lookup: {
          from: "orders",
          localField: "order",
          foreignField: "_id",
          as: "order"
        }
      },
      { $unwind: "$order" },
      {
        $group: {
          _id: "$order.shippingAddress.city",
          revenue: { $sum: "$totalAmount" },
          orders: { $sum: 1 },
          customers: { $addToSet: "$order.user" }
        }
      },
      {
        $project: {
          city: "$_id",
          revenue: 1,
          orders: 1,
          customerCount: { $size: "$customers" }
        }
      },
      { $sort: { revenue: -1 } },
      { $limit: 10 }
    ]);

    // Repeat customer rate
    const customerOrders = await SubOrder.aggregate([
      { $match: match },
      {
        $lookup: {
          from: "orders",
          localField: "order",
          foreignField: "_id",
          as: "order"
        }
      },
      { $unwind: "$order" },
      {
        $group: {
          _id: "$order.user",
          orderCount: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: null,
          totalCustomers: { $sum: 1 },
          repeatCustomers: {
            $sum: {
              $cond: [{ $gt: ["$orderCount", 1] }, 1, 0]
            }
          }
        }
      }
    ]);

    const repeatCustomerRate = customerOrders.length > 0 
      ? (customerOrders[0].repeatCustomers / customerOrders[0].totalCustomers) * 100 
      : 0;

    res.json({
      topCustomers,
      customerLocation,
      repeatCustomerRate: Math.round(repeatCustomerRate * 100) / 100
    });
  } catch (err) {
    console.error("Error fetching seller customer insights:", err);
    res.status(500).json({ 
      message: "Error fetching seller customer insights", 
      error: err.message 
    });
  }
};

module.exports = exports;