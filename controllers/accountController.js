const mongoose = require("mongoose");
const { Customer, Transaction, Inventory, StockPurchase } = require("../models/accountModel");
const PDFDocument = require('pdfkit');

// Generate unique customer ID
const generateCustomerId = async () => {
  const count = await Customer.countDocuments();
  return `CUST${String(count + 1).padStart(4, '0')}`;
};

// Generate unique product ID
const generateProductId = async (category) => {
  const prefix = category.substring(0, 3).toUpperCase();
  const count = await Inventory.countDocuments({ category });
  return `${prefix}${String(count + 1).padStart(4, '0')}`;
};

// Convert units to base unit (kg)
const convertToBaseUnit = (quantity, unit) => {
  switch (unit) {
    case 'ton':
      return quantity * 1000; // 1 ton = 1000 kg
    case 'piece':
    case 'bag':
    case 'liter':
      return quantity; // For now, treating as same
    default:
      return quantity; // kg
  }
};

// Update inventory stock and calculate profit
const updateInventoryStock = async (inventoryId, quantity, unit, sellingPrice, type, session, oldQuantity = 0) => {
  const inventory = await Inventory.findById(inventoryId).session(session);
  
  if (!inventory) {
    throw new Error('Inventory item not found');
  }

  const quantityInBaseUnit = convertToBaseUnit(quantity, unit);
  const oldQuantityInBaseUnit = convertToBaseUnit(oldQuantity, unit);
  const inventoryQuantityInBaseUnit = convertToBaseUnit(inventory.currentStock, inventory.unit);

  if (type === 'stock_purchase') {
    // Adding stock - calculate weighted average cost
    const newStock = inventoryQuantityInBaseUnit + quantityInBaseUnit;
    const totalInvestment = inventory.totalInvestment + (quantity * sellingPrice);
    
    // Update cost price (weighted average)
    const newCostPrice = totalInvestment / (newStock / convertToBaseUnit(1, inventory.unit));
    
    inventory.currentStock = newStock;
    inventory.costPrice = newCostPrice;
    inventory.totalInvestment = totalInvestment;
    
  } else if (type === 'purchase' || type === 'bully_purchase') {
    // Selling stock
    if (inventoryQuantityInBaseUnit < quantityInBaseUnit) {
      throw new Error(`Insufficient stock. Available: ${inventory.currentStock} ${inventory.unit}`);
    }

    const newStock = inventoryQuantityInBaseUnit - quantityInBaseUnit;
    const cost = quantity * inventory.costPrice;
    const revenue = quantity * sellingPrice;
    const profit = revenue - cost;

    inventory.currentStock = newStock;
    inventory.totalSales += revenue;
    inventory.totalProfit += profit;

    return {
      cost,
      revenue,
      profit
    };
  } else if (type === 'damaged_goods') {
    // Removing damaged stock
    if (inventoryQuantityInBaseUnit < quantityInBaseUnit) {
      throw new Error(`Insufficient stock for damage. Available: ${inventory.currentStock} ${inventory.unit}`);
    }

    const newStock = inventoryQuantityInBaseUnit - quantityInBaseUnit;
    const loss = quantity * inventory.costPrice;

    inventory.currentStock = newStock;
    inventory.totalProfit -= loss; // Reduce profit by loss amount

    return {
      loss
    };
  } else if (type === 'purchase_update') {
    // Reverting old purchase and applying new one
    const revertedStock = inventoryQuantityInBaseUnit + oldQuantityInBaseUnit;
    
    // Check if we have enough stock after reverting
    if (revertedStock < quantityInBaseUnit) {
      throw new Error(`Insufficient stock after update. Available: ${revertedStock} ${inventory.unit}`);
    }

    const newStock = revertedStock - quantityInBaseUnit;
    
    // Revert old profit and calculate new profit
    const oldCost = oldQuantity * inventory.costPrice;
    const oldRevenue = oldQuantity * sellingPrice; // This should be the old selling price
    const oldProfit = oldRevenue - oldCost;
    
    const newCost = quantity * inventory.costPrice;
    const newRevenue = quantity * sellingPrice;
    const newProfit = newRevenue - newCost;
    
    const profitDifference = newProfit - oldProfit;

    inventory.currentStock = newStock;
    inventory.totalSales = inventory.totalSales - oldRevenue + newRevenue;
    inventory.totalProfit = inventory.totalProfit - oldProfit + newProfit;

    return {
      cost: newCost,
      revenue: newRevenue,
      profit: profitDifference
    };
  }

  await inventory.save({ session });
  return {};
};

// ✅ Get all customers (Admin only)
exports.getAllCustomers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 1000;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';

    const searchFilter = search ? {
      $or: [
        { name: { $regex: search, $options: 'i' } },
        { customerId: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ]
    } : {};

    const customers = await Customer.find(searchFilter)
      .select('-password')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Customer.countDocuments(searchFilter);

    res.status(200).json({
      status: 'success',
      data: {
        customers,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get customers error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Server error while fetching customers' 
    });
  }
};

// ✅ Create new customer (Admin only)
exports.createCustomer = async (req, res) => {
  try {
    const { name, phone, email, address } = req.body;
    
    if (!name || !phone) {
      return res.status(400).json({ 
        status: 'error',
        message: 'Name and phone are required' 
      });
    }

    const existingCustomer = await Customer.findOne({ phone });
    if (existingCustomer) {
      return res.status(400).json({ 
        status: 'error',
        message: 'Customer with this phone number already exists' 
      });
    }

    const customerId = await generateCustomerId();
    const defaultPassword = Math.random().toString(36).slice(-8);

    const customer = await Customer.create({
      customerId,
      name,
      phone,
      email,
      address,
      password: defaultPassword,
      currentBalance: 0,
      totalPurchases: 0,
      totalPayments: 0,
      createdBy: req.user._id
    });

    const customerResponse = customer.toObject();
    delete customerResponse.password;

    res.status(201).json({
      status: 'success',
      data: {
        customer: customerResponse,
        loginCredentials: {
          customerId,
          password: defaultPassword
        }
      }
    });
  } catch (error) {
    console.error('Create customer error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Server error while creating customer' 
    });
  }
};

// ✅ Get single customer
exports.getCustomer = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id)
      .select('-password')
      .populate('createdBy', 'name email');

    if (!customer) {
      return res.status(404).json({ 
        status: 'error',
        message: 'Customer not found' 
      });
    }

    res.status(200).json({
      status: 'success',
      data: { customer }
    });
  } catch (error) {
    console.error('Get customer error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Server error while fetching customer' 
    });
  }
};

// ✅ Update customer
exports.updateCustomer = async (req, res) => {
  try {
    const customer = await Customer.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).select('-password');

    if (!customer) {
      return res.status(404).json({ 
        status: 'error',
        message: 'Customer not found' 
      });
    }

    res.status(200).json({
      status: 'success',
      data: { customer }
    });
  } catch (error) {
    console.error('Update customer error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Server error while updating customer' 
    });
  }
};

// ✅ Delete customer
exports.deleteCustomer = async (req, res) => {
  try {
    const customer = await Customer.findByIdAndDelete(req.params.id);

    if (!customer) {
      return res.status(404).json({ 
        status: 'error',
        message: 'Customer not found' 
      });
    }

    await Transaction.deleteMany({ customer: req.params.id });

    res.status(200).json({
      status: 'success',
      message: 'Customer deleted successfully',
      data: null
    });
  } catch (error) {
    console.error('Delete customer error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Server error while deleting customer' 
    });
  }
};

// ✅ Toggle customer status
exports.toggleCustomerStatus = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);

    if (!customer) {
      return res.status(404).json({ 
        status: 'error',
        message: 'Customer not found' 
      });
    }

    customer.isActive = !customer.isActive;
    await customer.save();

    const customerResponse = customer.toObject();
    delete customerResponse.password;

    res.status(200).json({
      status: 'success',
      data: { customer: customerResponse }
    });
  } catch (error) {
    console.error('Toggle status error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Server error while updating customer status' 
    });
  }
};

// ✅ NEW: Add Inventory Item - REMOVED sellingPrice
exports.addInventory = async (req, res) => {
  try {
    const { productName, category, currentStock, unit, costPrice, minStockLevel } = req.body;

    if (!productName || !category || !unit || !costPrice) {
      return res.status(400).json({ 
        status: 'error',
        message: 'Product name, category, unit, and cost price are required' 
      });
    }

    const productId = await generateProductId(category);

    const inventory = await Inventory.create({
      productId,
      productName,
      category,
      currentStock: currentStock || 0,
      unit,
      costPrice,
      minStockLevel: minStockLevel || 0,
      totalInvestment: (currentStock || 0) * costPrice,
      createdBy: req.user._id
    });

    res.status(201).json({
      status: 'success',
      data: {
        inventory,
        message: 'Inventory item added successfully'
      }
    });
  } catch (error) {
    console.error('Add inventory error:', error);
    res.status(500).json({ 
      status: 'error',
      message: error.message || 'Server error while adding inventory item' 
    });
  }
};

// ✅ NEW: Add Stock Purchase (Admin buying stock) - UPDATED with weighted average
exports.addStockPurchase = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { inventoryId, supplier, quantity, unit, pricePerUnit, billNumber, billDate, note } = req.body;

    if (!inventoryId || !supplier || !quantity || !unit || !pricePerUnit) {
      await session.abortTransaction();
      return res.status(400).json({ 
        status: 'error',
        message: 'Inventory, supplier, quantity, unit and price are required' 
      });
    }

    const inventory = await Inventory.findById(inventoryId).session(session);
    if (!inventory) {
      await session.abortTransaction();
      return res.status(404).json({ 
        status: 'error',
        message: 'Inventory item not found' 
      });
    }

    const totalAmount = quantity * pricePerUnit;

    // Update inventory stock with weighted average cost
    await updateInventoryStock(inventoryId, quantity, unit, pricePerUnit, 'stock_purchase', session);

    // Create stock purchase record
    const stockPurchase = await StockPurchase.create([{
      inventory: inventoryId,
      supplier,
      quantity,
      unit,
      pricePerUnit,
      totalAmount,
      billNumber,
      billDate: billDate || new Date(),
      note,
      createdBy: req.user._id
    }], { session }).then(d => d[0]);

    // Create transaction record
    const transaction = await Transaction.create([{
      type: 'stock_purchase',
      amount: totalAmount,
      paidAmount: totalAmount,
      note: note || `Stock purchase from ${supplier}`,
      stockPurchase: stockPurchase._id,
      createdBy: req.user._id
    }], { session }).then(d => d[0]);

    await session.commitTransaction();
    session.endSession();

    // Get updated inventory
    const updatedInventory = await Inventory.findById(inventoryId);

    res.status(201).json({
      status: 'success',
      data: {
        stockPurchase,
        transaction,
        inventory: updatedInventory,
        message: 'Stock purchased successfully'
      }
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Stock purchase error:', error);
    res.status(500).json({ 
      status: 'error',
      message: error.message || 'Server error while purchasing stock' 
    });
  }
};

// ✅ NEW: Add Expense
exports.addExpense = async (req, res) => {
  try {
    const { amount, expenseCategory, expenseTo, note } = req.body;

    if (!amount || amount <= 0 || !expenseCategory) {
      return res.status(400).json({ 
        status: 'error',
        message: 'Valid amount and expense category are required' 
      });
    }

    const transaction = await Transaction.create({
      type: 'expense',
      amount,
      paidAmount: amount,
      note,
      expenseCategory,
      expenseTo,
      createdBy: req.user._id
    });

    res.status(201).json({
      status: 'success',
      data: {
        transaction,
        message: 'Expense added successfully'
      }
    });
  } catch (error) {
    console.error('Add expense error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Server error while adding expense' 
    });
  }
};

// ✅ NEW: Add Commission
exports.addCommission = async (req, res) => {
  try {
    const { amount, commissionFrom, commissionType, note } = req.body;

    if (!amount || amount <= 0 || !commissionFrom) {
      return res.status(400).json({ 
        status: 'error',
        message: 'Valid amount and commission from are required' 
      });
    }

    const transaction = await Transaction.create({
      type: 'commission',
      amount,
      paidAmount: amount,
      note,
      commissionFrom,
      commissionType: commissionType || 'cash',
      createdBy: req.user._id
    });

    res.status(201).json({
      status: 'success',
      data: {
        transaction,
        message: 'Commission added successfully'
      }
    });
  } catch (error) {
    console.error('Add commission error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Server error while adding commission' 
    });
  }
};

// ✅ NEW: Add Damaged Goods
exports.addDamagedGoods = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { inventoryId, quantity, unit, damageReason, note } = req.body;

    if (!inventoryId || !quantity || !unit || !damageReason) {
      await session.abortTransaction();
      return res.status(400).json({ 
        status: 'error',
        message: 'Inventory, quantity, unit and damage reason are required' 
      });
    }

    const inventory = await Inventory.findById(inventoryId).session(session);
    if (!inventory) {
      await session.abortTransaction();
      return res.status(404).json({ 
        status: 'error',
        message: 'Inventory item not found' 
      });
    }

    // Update inventory and calculate loss
    const result = await updateInventoryStock(inventoryId, quantity, unit, 0, 'damaged_goods', session);
    const lossAmount = result.loss;

    const transaction = await Transaction.create([{
      type: 'damaged_goods',
      amount: lossAmount,
      paidAmount: 0,
      note,
      damageReason,
      damageQuantity: quantity,
      createdBy: req.user._id
    }], { session }).then(d => d[0]);

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      status: 'success',
      data: {
        transaction,
        message: 'Damaged goods recorded successfully',
        loss: lossAmount
      }
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Add damaged goods error:', error);
    res.status(500).json({ 
      status: 'error',
      message: error.message || 'Server error while recording damaged goods' 
    });
  }
};

// ✅ NEW: Add Bully Purchase (Admin personal purchase)
exports.addBullyPurchase = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { items, bullySupplier, bullyBillNumber, note } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0 || !bullySupplier) {
      await session.abortTransaction();
      return res.status(400).json({ 
        status: 'error',
        message: 'Items and supplier are required' 
      });
    }

    let totalAmount = 0;
    const purchaseItems = [];

    for (const item of items) {
      const { inventoryId, quantity, unit } = item;

      if (!inventoryId || !quantity || !unit) {
        await session.abortTransaction();
        return res.status(400).json({ 
          status: 'error',
          message: 'Each item must have inventory, quantity and unit' 
        });
      }

      const inventory = await Inventory.findById(inventoryId).session(session);
      if (!inventory) {
        await session.abortTransaction();
        return res.status(404).json({ 
          status: 'error',
          message: `Inventory item not found: ${inventoryId}` 
        });
      }

      // Update inventory and calculate profit
      const result = await updateInventoryStock(
        inventoryId, 
        quantity, 
        unit, 
        inventory.costPrice, // For bully purchase, we sell at cost price (no profit)
        'bully_purchase', 
        session
      );

      const itemTotal = quantity * inventory.costPrice;
      totalAmount += itemTotal;

      purchaseItems.push({
        inventory: inventoryId,
        productName: inventory.productName,
        category: inventory.category,
        quantity,
        unit,
        costPrice: inventory.costPrice,
        sellingPrice: inventory.costPrice, // No profit
        total: itemTotal,
        profit: 0 // No profit for bully purchases
      });
    }

    const transaction = await Transaction.create([{
      type: 'bully_purchase',
      amount: totalAmount,
      paidAmount: totalAmount,
      note,
      bullySupplier,
      bullyBillNumber,
      items: purchaseItems,
      createdBy: req.user._id
    }], { session }).then(d => d[0]);

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      status: 'success',
      data: {
        transaction,
        message: 'Bully purchase recorded successfully'
      }
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Add bully purchase error:', error);
    res.status(500).json({ 
      status: 'error',
      message: error.message || 'Server error while recording bully purchase' 
    });
  }
};

// ✅ NEW: Add Reminder
exports.addReminder = async (req, res) => {
  try {
    const { customerId, amount, reminderDate, note } = req.body;

    if (!customerId || !amount || !reminderDate) {
      return res.status(400).json({ 
        status: 'error',
        message: 'Customer ID, amount and reminder date are required' 
      });
    }

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ 
        status: 'error',
        message: 'Customer not found' 
      });
    }

    const transaction = await Transaction.create({
      customer: customerId,
      type: 'reminder',
      amount,
      note,
      reminderDate: new Date(reminderDate),
      createdBy: req.user._id
    });

    res.status(201).json({
      status: 'success',
      data: {
        transaction,
        message: 'Reminder added successfully'
      }
    });
  } catch (error) {
    console.error('Add reminder error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Server error while adding reminder' 
    });
  }
};

// ✅ UPDATED: Create purchase with inventory management and dynamic selling price
exports.createPurchase = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { items, totalAmount, paidAmount = 0, note } = req.body;
    const customerId = req.params.id;

    if (!items || !Array.isArray(items) || items.length === 0) {
      await session.abortTransaction();
      return res.status(400).json({ 
        status: 'error',
        message: 'Purchase items are required' 
      });
    }

    if (!totalAmount || totalAmount <= 0) {
      await session.abortTransaction();
      return res.status(400).json({ 
        status: 'error',
        message: 'Valid total amount is required' 
      });
    }

    if (paidAmount > totalAmount) {
      await session.abortTransaction();
      return res.status(400).json({ 
        status: 'error',
        message: 'Paid amount cannot be greater than total amount' 
      });
    }

    const customer = await Customer.findById(customerId).session(session);
    if (!customer) {
      await session.abortTransaction();
      return res.status(404).json({ 
        status: 'error',
        message: 'Customer not found' 
      });
    }

    let totalProfit = 0;
    const purchaseItems = [];

    for (const item of items) {
      const { inventoryId, quantity, unit, sellingPrice } = item;

      if (!inventoryId || !quantity || !unit || !sellingPrice) {
        await session.abortTransaction();
        return res.status(400).json({ 
          status: 'error',
          message: 'Each item must have inventory, quantity, unit and selling price' 
        });
      }

      const inventory = await Inventory.findById(inventoryId).session(session);
      if (!inventory) {
        await session.abortTransaction();
        return res.status(404).json({ 
          status: 'error',
          message: `Inventory item not found: ${inventoryId}` 
        });
      }

      // Update inventory and calculate profit
      const result = await updateInventoryStock(
        inventoryId, 
        quantity, 
        unit, 
        sellingPrice, 
        'purchase', 
        session
      );

      const itemTotal = quantity * sellingPrice;
      totalProfit += result.profit;

      purchaseItems.push({
        inventory: inventoryId,
        productName: inventory.productName,
        category: inventory.category,
        quantity,
        unit,
        costPrice: inventory.costPrice,
        sellingPrice: sellingPrice,
        total: itemTotal,
        profit: result.profit
      });
    }

    const remainingBalance = customer.currentBalance + (totalAmount - paidAmount);
    
    customer.totalPurchases += totalAmount;
    customer.totalPayments += paidAmount;
    customer.currentBalance = remainingBalance;

    await customer.save({ session });

    const transaction = await Transaction.create([{
      customer: customerId,
      type: 'purchase',
      amount: totalAmount,
      paidAmount,
      remainingBalance,
      note,
      items: purchaseItems,
      createdBy: req.user._id
    }], { session }).then(d => d[0]);

    await transaction.populate('customer', 'name customerId');
    await transaction.populate('createdBy', 'name email');

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      status: 'success',
      data: {
        transaction,
        profit: totalProfit,
        customer: {
          _id: customer._id,
          name: customer.name,
          customerId: customer.customerId,
          totalPurchases: customer.totalPurchases,
          totalPayments: customer.totalPayments,
          currentBalance: customer.currentBalance
        }
      }
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Create purchase error:', error);
    res.status(500).json({ 
      status: 'error',
      message: error.message || 'Server error while creating purchase' 
    });
  }
};

// ✅ NEW: Update purchase transaction
exports.updatePurchase = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { items, totalAmount, paidAmount = 0, note } = req.body;
    const { id, transactionId } = req.params;

    if (!items || !Array.isArray(items) || items.length === 0) {
      await session.abortTransaction();
      return res.status(400).json({ 
        status: 'error',
        message: 'Purchase items are required' 
      });
    }

    if (!totalAmount || totalAmount <= 0) {
      await session.abortTransaction();
      return res.status(400).json({ 
        status: 'error',
        message: 'Valid total amount is required' 
      });
    }

    if (paidAmount > totalAmount) {
      await session.abortTransaction();
      return res.status(400).json({ 
        status: 'error',
        message: 'Paid amount cannot be greater than total amount' 
      });
    }

    const customer = await Customer.findById(id).session(session);
    if (!customer) {
      await session.abortTransaction();
      return res.status(404).json({ 
        status: 'error',
        message: 'Customer not found' 
      });
    }

    const existingTransaction = await Transaction.findById(transactionId).session(session);
    if (!existingTransaction || existingTransaction.type !== 'purchase') {
      await session.abortTransaction();
      return res.status(404).json({ 
        status: 'error',
        message: 'Purchase transaction not found' 
      });
    }

    // Revert old purchase
    const oldItems = existingTransaction.items;
    const oldTotalAmount = existingTransaction.amount;
    const oldPaidAmount = existingTransaction.paidAmount;

    // Revert customer balance
    customer.totalPurchases -= oldTotalAmount;
    customer.totalPayments -= oldPaidAmount;
    customer.currentBalance = customer.currentBalance - (oldTotalAmount - oldPaidAmount);

    // Revert inventory for old items
    for (const oldItem of oldItems) {
      await updateInventoryStock(
        oldItem.inventory, 
        oldItem.quantity, 
        oldItem.unit, 
        oldItem.sellingPrice, 
        'purchase_update', 
        session,
        oldItem.quantity
      );
    }

    let totalProfit = 0;
    const purchaseItems = [];

    // Process new items
    for (const item of items) {
      const { inventoryId, quantity, unit, sellingPrice } = item;

      if (!inventoryId || !quantity || !unit || !sellingPrice) {
        await session.abortTransaction();
        return res.status(400).json({ 
          status: 'error',
          message: 'Each item must have inventory, quantity, unit and selling price' 
        });
      }

      const inventory = await Inventory.findById(inventoryId).session(session);
      if (!inventory) {
        await session.abortTransaction();
        return res.status(404).json({ 
          status: 'error',
          message: `Inventory item not found: ${inventoryId}` 
        });
      }

      // Update inventory and calculate profit
      const result = await updateInventoryStock(
        inventoryId, 
        quantity, 
        unit, 
        sellingPrice, 
        'purchase', 
        session
      );

      const itemTotal = quantity * sellingPrice;
      totalProfit += result.profit;

      purchaseItems.push({
        inventory: inventoryId,
        productName: inventory.productName,
        category: inventory.category,
        quantity,
        unit,
        costPrice: inventory.costPrice,
        sellingPrice: sellingPrice,
        total: itemTotal,
        profit: result.profit
      });
    }

    // Update customer with new values
    const remainingBalance = customer.currentBalance + (totalAmount - paidAmount);
    
    customer.totalPurchases += totalAmount;
    customer.totalPayments += paidAmount;
    customer.currentBalance = remainingBalance;

    await customer.save({ session });

    // Update transaction
    existingTransaction.items = purchaseItems;
    existingTransaction.amount = totalAmount;
    existingTransaction.paidAmount = paidAmount;
    existingTransaction.remainingBalance = remainingBalance;
    existingTransaction.note = note;
    existingTransaction.updatedAt = new Date();

    await existingTransaction.save({ session });

    await existingTransaction.populate('customer', 'name customerId');
    await existingTransaction.populate('createdBy', 'name email');

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      status: 'success',
      data: {
        transaction: existingTransaction,
        profit: totalProfit,
        customer: {
          _id: customer._id,
          name: customer.name,
          customerId: customer.customerId,
          totalPurchases: customer.totalPurchases,
          totalPayments: customer.totalPayments,
          currentBalance: customer.currentBalance
        }
      }
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Update purchase error:', error);
    res.status(500).json({ 
      status: 'error',
      message: error.message || 'Server error while updating purchase' 
    });
  }
};

// ✅ Make payment (Admin only)
exports.makePayment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { amount, paymentMethod = 'cash', note } = req.body;
    const customerId = req.params.id;

    if (!amount || amount <= 0) {
      await session.abortTransaction();
      return res.status(400).json({ 
        status: 'error',
        message: 'Valid amount is required' 
      });
    }

    const customer = await Customer.findById(customerId).session(session);
    if (!customer) {
      await session.abortTransaction();
      return res.status(404).json({ 
        status: 'error',
        message: 'Customer not found' 
      });
    }

    if (amount > customer.currentBalance) {
      await session.abortTransaction();
      return res.status(400).json({ 
        status: 'error',
        message: 'Payment amount cannot be greater than current balance' 
      });
    }

    const remainingBalance = customer.currentBalance - amount;
    
    customer.totalPayments += amount;
    customer.currentBalance = remainingBalance;

    await customer.save({ session });

    const transaction = await Transaction.create([{
      customer: customerId,
      type: 'payment',
      amount,
      paidAmount: amount,
      remainingBalance,
      note: note || `Payment via ${paymentMethod}`,
      createdBy: req.user._id
    }], { session }).then(d => d[0]);

    await transaction.populate('customer', 'name customerId');
    await transaction.populate('createdBy', 'name email');

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({
      status: 'success',
      data: {
        transaction,
        customer: {
          _id: customer._id,
          name: customer.name,
          customerId: customer.customerId,
          totalPurchases: customer.totalPurchases,
          totalPayments: customer.totalPayments,
          currentBalance: customer.currentBalance
        }
      }
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error('Make payment error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Server error while processing payment' 
    });
  }
};

// ✅ NEW: Get all inventory
exports.getInventory = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 1000;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';

    const searchFilter = search ? {
      $or: [
        { productName: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } },
        { productId: { $regex: search, $options: 'i' } }
      ]
    } : {};

    const inventory = await Inventory.find(searchFilter)
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Inventory.countDocuments(searchFilter);

    res.status(200).json({
      status: 'success',
      data: {
        inventory,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get inventory error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Server error while fetching inventory' 
    });
  }
};

// ✅ NEW: Get profit/loss report with time filter
exports.getProfitLossReport = async (req, res) => {
  try {
    const { period = 'all' } = req.query;
    
    const dateFilter = {};
    const now = new Date();
    
    switch (period) {
      case '1d':
        dateFilter.createdAt = { $gte: new Date(now.setDate(now.getDate() - 1)) };
        break;
      case '7d':
        dateFilter.createdAt = { $gte: new Date(now.setDate(now.getDate() - 7)) };
        break;
      case '30d':
        dateFilter.createdAt = { $gte: new Date(now.setDate(now.getDate() - 30)) };
        break;
      case 'all':
      default:
        // No date filter for all time
        break;
    }

    // Get all transactions for profit calculation
    const transactions = await Transaction.find({
      ...dateFilter,
      type: { 
        $in: ['purchase', 'damaged_goods', 'stock_purchase', 'expense', 'commission', 'bully_purchase'] 
      }
    })
    .populate('customer', 'name customerId')
    .populate('items.inventory', 'productName');

    let totalRevenue = 0;
    let totalCost = 0;
    let totalExpenses = 0;
    let totalCommissions = 0;
    let totalDamages = 0;

    // Calculate from transactions
    for (const transaction of transactions) {
      switch (transaction.type) {
        case 'purchase':
          totalRevenue += transaction.amount;
          // Cost is calculated from items
          const purchaseCost = transaction.items.reduce((sum, item) => 
            sum + (item.quantity * item.costPrice), 0);
          totalCost += purchaseCost;
          break;

        case 'stock_purchase':
          totalCost += transaction.amount;
          break;

        case 'expense':
          totalExpenses += transaction.amount;
          break;

        case 'commission':
          totalCommissions += transaction.amount;
          break;

        case 'damaged_goods':
          totalDamages += transaction.amount;
          break;

        case 'bully_purchase':
          // Bully purchases are at cost, so no profit/loss
          totalCost += transaction.amount;
          break;
      }
    }

    const grossProfit = totalRevenue - totalCost;
    const netProfit = grossProfit - totalExpenses + totalCommissions - totalDamages;

    res.status(200).json({
      status: 'success',
      data: {
        report: {
          totalRevenue,
          totalCost,
          grossProfit,
          totalExpenses,
          totalCommissions,
          totalDamages,
          netProfit
        },
        summary: {
          totalTransactions: transactions.length,
          period: period === '1d' ? '1 Day' : 
                  period === '7d' ? '7 Days' : 
                  period === '30d' ? '30 Days' : 'All Time'
        }
      }
    });
  } catch (error) {
    console.error('Get profit loss report error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Server error while generating report' 
    });
  }
};

// ✅ NEW: Get low stock alerts
exports.getLowStockAlerts = async (req, res) => {
  try {
    const inventory = await Inventory.find({
      $expr: { $lte: ['$currentStock', '$minStockLevel'] }
    }).sort({ currentStock: 1 });

    res.status(200).json({
      status: 'success',
      data: {
        lowStockItems: inventory,
        count: inventory.length
      }
    });
  } catch (error) {
    console.error('Get low stock alerts error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Server error while fetching low stock alerts' 
    });
  }
};

// ✅ NEW: Update inventory item
exports.updateInventory = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const inventory = await Inventory.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!inventory) {
      return res.status(404).json({ 
        status: 'error',
        message: 'Inventory item not found' 
      });
    }

    res.status(200).json({
      status: 'success',
      data: {
        inventory,
        message: 'Inventory updated successfully'
      }
    });
  } catch (error) {
    console.error('Update inventory error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Server error while updating inventory' 
    });
  }
};

// ✅ Get customer transactions
exports.getCustomerTransactions = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const transactions = await Transaction.find({ customer: req.params.id })
      .populate('customer', 'name customerId')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Transaction.countDocuments({ customer: req.params.id });

    res.status(200).json({
      status: 'success',
      data: {
        transactions,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Server error while fetching transactions' 
    });
  }
};

// ✅ Get customer ledger
exports.getCustomerLedger = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id).select('-password');
    if (!customer) {
      return res.status(404).json({ 
        status: 'error',
        message: 'Customer not found' 
      });
    }

    const transactions = await Transaction.find({ customer: req.params.id })
      .sort({ createdAt: -1 })
      .populate('customer', 'name customerId')
      .populate('createdBy', 'name email');

    const ledgerSummary = {
      customer: {
        _id: customer._id,
        name: customer.name,
        customerId: customer.customerId,
        phone: customer.phone,
        email: customer.email,
        address: customer.address,
        isActive: customer.isActive,
        createdAt: customer.createdAt
      },
      summary: {
        totalPurchases: customer.totalPurchases,
        totalPayments: customer.totalPayments,
        currentBalance: customer.currentBalance
      },
      transactions
    };

    res.status(200).json({
      status: 'success',
      data: ledgerSummary
    });
  } catch (error) {
    console.error('Get ledger error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Server error while fetching ledger' 
    });
  }
};

// ✅ Download ledger PDF
exports.downloadLedgerPDF = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id).select('-password');
    if (!customer) {
      return res.status(404).json({ 
        status: 'error',
        message: 'Customer not found' 
      });
    }

    const transactions = await Transaction.find({ customer: req.params.id })
      .sort({ createdAt: -1 })
      .populate('customer', 'name customerId');

    const doc = new PDFDocument();
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=account-ledger-${customer.customerId}.pdf`);

    doc.pipe(res);

    doc.fontSize(20).text('Customer Account Ledger', { align: 'center' });
    doc.moveDown();
    
    doc.fontSize(12).text(`Customer: ${customer.name} (${customer.customerId})`);
    doc.text(`Phone: ${customer.phone}`);
    doc.text(`Email: ${customer.email || 'N/A'}`);
    doc.text(`Address: ${customer.address || 'N/A'}`);
    doc.text(`Current Balance: ₹${customer.currentBalance}`);
    doc.moveDown();

    doc.text('Account Summary:', { underline: true });
    doc.text(`Total Purchases: ₹${customer.totalPurchases}`);
    doc.text(`Total Payments: ₹${customer.totalPayments}`);
    doc.text(`Outstanding Balance: ₹${customer.currentBalance}`);
    doc.moveDown();

    doc.text('Transaction History:', { underline: true });
    doc.moveDown();

    const tableTop = doc.y;
    const tableLeft = 50;
    
    doc.fontSize(10);
    doc.text('Date', tableLeft, tableTop);
    doc.text('Type', tableLeft + 80, tableTop);
    doc.text('Amount', tableLeft + 150, tableTop);
    doc.text('Paid', tableLeft + 220, tableTop);
    doc.text('Balance', tableLeft + 290, tableTop);
    doc.text('Note', tableLeft + 370, tableTop);
    
    doc.moveTo(tableLeft, tableTop + 15)
       .lineTo(550, tableTop + 15)
       .stroke();

    let y = tableTop + 25;

    transactions.forEach(transaction => {
      if (y > 700) {
        doc.addPage();
        y = 50;
      }

      doc.text(new Date(transaction.createdAt).toLocaleDateString(), tableLeft, y);
      doc.text(transaction.type.toUpperCase(), tableLeft + 80, y);
      doc.text(`₹${transaction.amount}`, tableLeft + 150, y);
      doc.text(`₹${transaction.type === 'purchase' ? transaction.paidAmount : transaction.amount}`, tableLeft + 220, y);
      doc.text(`₹${transaction.remainingBalance}`, tableLeft + 290, y);
      doc.text(transaction.note || '-', tableLeft + 370, y, { width: 150 });
      
      y += 20;
    });

    doc.end();
  } catch (error) {
    console.error('Download PDF error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Server error while generating PDF' 
    });
  }
};

// ✅ Customer Login
exports.customerLogin = async (req, res) => {
  try {
    const { customerId, password } = req.body;

    if (!customerId || !password) {
      return res.status(400).json({ 
        status: 'error',
        message: 'Customer ID and password are required' 
      });
    }

    const customer = await Customer.findOne({ customerId });
    if (!customer || !(await customer.correctPassword(password))) {
      return res.status(401).json({ 
        status: 'error',
        message: 'Invalid customer ID or password' 
      });
    }

    if (!customer.isActive) {
      return res.status(403).json({ 
        status: 'error',
        message: 'Customer account is deactivated' 
      });
    }

    const customerResponse = customer.toObject();
    delete customerResponse.password;

    res.status(200).json({
      status: 'success',
      data: {
        customer: customerResponse,
        message: 'Login successful'
      }
    });
  } catch (error) {
    console.error('Customer login error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Server error during login' 
    });
  }
};

// ✅ Get my ledger (Customer)
exports.getMyLedger = async (req, res) => {
  try {
    const customer = await Customer.findById(req.user._id).select('-password');
    if (!customer) {
      return res.status(404).json({ 
        status: 'error',
        message: 'Customer not found' 
      });
    }

    const transactions = await Transaction.find({ customer: req.user._id })
      .sort({ createdAt: -1 })
      .populate('customer', 'name customerId');

    const ledgerSummary = {
      customer: {
        _id: customer._id,
        name: customer.name,
        customerId: customer.customerId,
        phone: customer.phone,
        email: customer.email,
        address: customer.address
      },
      summary: {
        totalPurchases: customer.totalPurchases,
        totalPayments: customer.totalPayments,
        currentBalance: customer.currentBalance
      },
      transactions
    };

    res.status(200).json({
      status: 'success',
      data: ledgerSummary
    });
  } catch (error) {
    console.error('Get my ledger error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Server error while fetching ledger' 
    });
  }
};

// ✅ Get my transactions (Customer)
exports.getMyTransactions = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const transactions = await Transaction.find({ customer: req.user._id })
      .populate('customer', 'name customerId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Transaction.countDocuments({ customer: req.user._id });

    res.status(200).json({
      status: 'success',
      data: {
        transactions,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    console.error('Get my transactions error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Server error while fetching transactions' 
    });
  }
};

// ✅ Download my ledger PDF (Customer)
exports.downloadMyLedgerPDF = async (req, res) => {
  try {
    const customer = await Customer.findById(req.user._id).select('-password');
    if (!customer) {
      return res.status(404).json({ 
        status: 'error',
        message: 'Customer not found' 
      });
    }

    const transactions = await Transaction.find({ customer: req.user._id })
      .sort({ createdAt: -1 })
      .populate('customer', 'name customerId');

    const doc = new PDFDocument();
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=my-account-ledger-${customer.customerId}.pdf`);

    doc.pipe(res);

    doc.fontSize(20).text('My Account Ledger', { align: 'center' });
    doc.moveDown();
    
    doc.fontSize(12).text(`Customer: ${customer.name} (${customer.customerId})`);
    doc.text(`Phone: ${customer.phone}`);
    doc.text(`Email: ${customer.email || 'N/A'}`);
    doc.text(`Address: ${customer.address || 'N/A'}`);
    doc.moveDown();

    doc.text('Account Summary:', { underline: true });
    doc.text(`Total Purchases: ₹${customer.totalPurchases}`);
    doc.text(`Total Payments: ₹${customer.totalPayments}`);
    doc.text(`Outstanding Balance: ₹${customer.currentBalance}`);
    doc.moveDown();

    doc.text('Transaction History:', { underline: true });
    doc.moveDown();

    const tableTop = doc.y;
    const tableLeft = 50;
    
    doc.fontSize(10);
    doc.text('Date', tableLeft, tableTop);
    doc.text('Type', tableLeft + 80, tableTop);
    doc.text('Amount', tableLeft + 150, tableTop);
    doc.text('Paid', tableLeft + 220, tableTop);
    doc.text('Balance', tableLeft + 290, tableTop);
    doc.text('Note', tableLeft + 370, tableTop);
    
    doc.moveTo(tableLeft, tableTop + 15)
       .lineTo(550, tableTop + 15)
       .stroke();

    let y = tableTop + 25;

    transactions.forEach(transaction => {
      if (y > 700) {
        doc.addPage();
        y = 50;
      }

      doc.text(new Date(transaction.createdAt).toLocaleDateString(), tableLeft, y);
      doc.text(transaction.type.toUpperCase(), tableLeft + 80, y);
      doc.text(`₹${transaction.amount}`, tableLeft + 150, y);
      doc.text(`₹${transaction.type === 'purchase' ? transaction.paidAmount : transaction.amount}`, tableLeft + 220, y);
      doc.text(`₹${transaction.remainingBalance}`, tableLeft + 290, y);
      doc.text(transaction.note || '-', tableLeft + 370, y, { width: 150 });
      
      y += 20;
    });

    doc.end();
  } catch (error) {
    console.error('Download my PDF error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Server error while generating PDF' 
    });
  }
};