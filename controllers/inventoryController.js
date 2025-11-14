const   SellerProfile  = require("../models/sellerProfile"); // Adjust import as needed
const Product = require("../models/productModel");
const mongoose = require("mongoose");

// Reuse or copy your global helper
const getSellerConditions = async (userId) => {
  const sellerDoc = await SellerProfile.findOne({ user: userId }).lean();
  const sellerId = sellerDoc?._id;
  return [
    { seller: sellerId },
    { seller: userId }, // Backward compatibility
  ];
};

// SELLER FUNCTIONS

// Get my inventory (seller's products with stock details)
const getMyInventory = async (req, res) => {
  try {
    const conditions = await getSellerConditions(req.user._id);

    const products = await Product.find({ $or: conditions })
      .select("name slug price quantity inStock lowStockThreshold lastStockUpdate") // Focus on stock-relevant fields
      .populate("category", "name")
      .populate("brand", "name")
      .sort({ quantity: 1 }); // Lowest stock first

    // Calculate low-stock items
    const lowStockItems = products.filter(p => p.quantity <= (p.lowStockThreshold || 10));

    res.json({
      totalProducts: products.length,
      lowStockCount: lowStockItems.length,
      products,
    });
  } catch (error) {
    res.status(500).json({ message: "Error fetching inventory", error: error.message });
  }
};

// Update quantity directly (full override, e.g., for manual sync)
const updateQuantity = async (req, res) => {
  try {
    const { quantity } = req.body;
    if (typeof quantity !== "number" || quantity < 0) {
      return res.status(400).json({ message: "Quantity must be a non-negative number" });
    }

    const conditions = await getSellerConditions(req.user._id);

    const product = await Product.findOne({ _id: req.params.id, $or: conditions });
    if (!product) return res.status(404).json({ message: "Product not found or not yours" });

    const change = quantity - product.quantity; // For history
    product.quantity = quantity;
    product.inStock = quantity > 0;
    product.lastStockUpdate = new Date();

    if (product.stockHistory) {
      product.stockHistory.push({
        change,
        reason: req.body.reason || "Manual update",
        updatedBy: req.user._id,
      });
    }

    await product.save();
    res.json({ message: "Quantity updated", product });
  } catch (error) {
    res.status(500).json({ message: "Error updating quantity", error: error.message });
  }
};

// Add stock (increment)
const addStock = async (req, res) => {
  try {
    const { amount, reason } = req.body;
    if (typeof amount !== "number" || amount <= 0) {
      return res.status(400).json({ message: "Amount must be a positive number" });
    }

    const conditions = await getSellerConditions(req.user._id);

    const product = await Product.findOne({ _id: req.params.id, $or: conditions });
    if (!product) return res.status(404).json({ message: "Product not found or not yours" });

    product.quantity += amount;
    product.inStock = product.quantity > 0;
    product.lastStockUpdate = new Date();

    if (product.stockHistory) {
      product.stockHistory.push({ change: +amount, reason, updatedBy: req.user._id });
    }

    await product.save();
    res.json({ message: "Stock added", product });
  } catch (error) {
    res.status(500).json({ message: "Error adding stock", error: error.message });
  }
};

// Remove stock (decrement, e.g., for damages/returns)
const removeStock = async (req, res) => {
  try {
    const { amount, reason } = req.body;
    if (typeof amount !== "number" || amount <= 0) {
      return res.status(400).json({ message: "Amount must be a positive number" });
    }

    const conditions = await getSellerConditions(req.user._id);

    const product = await Product.findOne({ _id: req.params.id, $or: conditions });
    if (!product) return res.status(404).json({ message: "Product not found or not yours" });

    if (product.quantity < amount) {
      return res.status(400).json({ message: "Insufficient stock" });
    }

    product.quantity -= amount;
    product.inStock = product.quantity > 0;
    product.lastStockUpdate = new Date();

    if (product.stockHistory) {
      product.stockHistory.push({ change: -amount, reason, updatedBy: req.user._id });
    }

    await product.save();
    res.json({ message: "Stock removed", product });
  } catch (error) {
    res.status(500).json({ message: "Error removing stock", error: error.message });
  }
};

// Toggle inStock
const toggleInStock = async (req, res) => {
  try {
    const conditions = await getSellerConditions(req.user._id);

    const product = await Product.findOne({ _id: req.params.id, $or: conditions });
    if (!product) return res.status(404).json({ message: "Product not found or not yours" });

    product.inStock = !product.inStock;
    product.lastStockUpdate = new Date();

    if (product.stockHistory && !product.inStock) {
      product.stockHistory.push({
        change: 0,
        reason: "Marked out of stock",
        updatedBy: req.user._id,
      });
    }

    await product.save();
    res.json({ message: "Stock availability toggled", product });
  } catch (error) {
    res.status(500).json({ message: "Error toggling stock", error: error.message });
  }
};

// Get stock history (if stockHistory field exists)
const getStockHistory = async (req, res) => {
  try {
    const conditions = await getSellerConditions(req.user._id);

    const product = await Product.findOne({ _id: req.params.id, $or: conditions })
      .select("name slug stockHistory");
    if (!product) return res.status(404).json({ message: "Product not found or not yours" });

    res.json({ history: product.stockHistory || [] });
  } catch (error) {
    res.status(500).json({ message: "Error fetching stock history", error: error.message });
  }
};

// ADMIN FUNCTIONS

// Get all inventory (across all sellers)
const getAllInventory = async (req, res) => {
  try {
    // Assuming admin role is checked via middleware

    const products = await Product.find({})
      .select("name slug price quantity inStock lowStockThreshold lastStockUpdate seller")
      .populate({
        path: "seller",
        select: "storeName",
        populate: { path: "user", select: "name email" }, // Get seller details
      })
      .populate("category", "name")
      .populate("brand", "name")
      .sort({ quantity: 1 });

    // Aggregations for overview
    const totalProducts = products.length;
    const totalStockValue = products.reduce((sum, p) => sum + (p.quantity * p.price), 0);
    const lowStockItems = products.filter(p => p.quantity <= (p.lowStockThreshold || 10));
    const outOfStockCount = products.filter(p => !p.inStock).length;

    res.json({
      totalProducts,
      totalStockValue,
      lowStockCount: lowStockItems.length,
      outOfStockCount,
      products,
    });
  } catch (error) {
    res.status(500).json({ message: "Error fetching all inventory", error: error.message });
  }
};

// Get inventory for a specific seller (admin only)
const getSellerInventory = async (req, res) => {
  try {
    // Assuming admin role checked; req.params.sellerId is SellerProfile _id

    const products = await Product.find({ seller: req.params.sellerId })
      .select("name slug price quantity inStock lowStockThreshold lastStockUpdate")
      .populate("category", "name")
      .populate("brand", "name")
      .sort({ quantity: 1 });

    const seller = await SellerProfile.findById(req.params.sellerId)
      .populate("user", "name email");

    if (!seller) return res.status(404).json({ message: "Seller not found" });

    const lowStockItems = products.filter(p => p.quantity <= (p.lowStockThreshold || 10));

    res.json({
      seller: { storeName: seller.storeName, user: seller.user },
      totalProducts: products.length,
      lowStockCount: lowStockItems.length,
      products,
    });
  } catch (error) {
    res.status(500).json({ message: "Error fetching seller inventory", error: error.message });
  }
};

module.exports = {
  // Seller
  getMyInventory,
  updateQuantity,
  addStock,
  removeStock,
  toggleInStock,
  getStockHistory,

  // Admin
  getAllInventory,
  getSellerInventory,
};