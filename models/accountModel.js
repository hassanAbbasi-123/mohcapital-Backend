const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// ========== SCHEMA DEFINITIONS ==========

// Customer Schema
const customerSchema = new mongoose.Schema({
  customerId: {
    type: String,
    required: true,
    unique: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  address: {
    type: String,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  totalPurchases: {
    type: Number,
    default: 0
  },
  totalPayments: {
    type: Number,
    default: 0
  },
  currentBalance: {
    type: Number,
    default: 0
  },
  role: {
    type: String,
    default: 'customer',
    enum: ['customer']
  },
  createdBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Enhanced Inventory Schema - REMOVED sellingPrice
const inventorySchema = new mongoose.Schema({
  productId: {
    type: String,
    required: true,
    unique: true
  },
  productName: {
    type: String,
    required: true
  },
  category: {
    type: String,
    required: true
  },
  currentStock: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  unit: {
    type: String,
    enum: ['kg', 'ton', 'piece', 'bag', 'liter'],
    required: true
  },
  costPrice: {
    type: Number,
    required: true,
    min: 0
  },
  minStockLevel: {
    type: Number,
    default: 0
  },
  totalInvestment: {
    type: Number,
    default: 0
  },
  totalSales: {
    type: Number,
    default: 0
  },
  totalProfit: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Stock Purchase Schema (When admin buys stock)
const stockPurchaseSchema = new mongoose.Schema({
  inventory: {
    type: mongoose.Schema.ObjectId,
    ref: 'Inventory',
    required: true
  },
  supplier: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 0
  },
  unit: {
    type: String,
    enum: ['kg', 'ton', 'piece', 'bag', 'liter'],
    required: true
  },
  pricePerUnit: {
    type: Number,
    required: true,
    min: 0
  },
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  billNumber: {
    type: String
  },
  billDate: {
    type: Date,
    default: Date.now
  },
  note: {
    type: String
  },
  createdBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Purchase Item Schema - ADDED sellingPrice at purchase time
const purchaseItemSchema = new mongoose.Schema({
  inventory: {
    type: mongoose.Schema.ObjectId,
    ref: 'Inventory',
    required: true
  },
  productName: {
    type: String,
    required: true
  },
  category: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 0
  },
  unit: {
    type: String,
    enum: ['kg', 'ton', 'piece', 'bag', 'liter'],
    required: true
  },
  costPrice: {
    type: Number,
    required: true,
    min: 0
  },
  sellingPrice: {
    type: Number,
    required: true,
    min: 0
  },
  total: {
    type: Number,
    required: true,
    min: 0
  },
  profit: {
    type: Number,
    default: 0
  },
  // Commission for individual items
  commissionApplied: {
    type: Boolean,
    default: false
  },
  commissionCandidates: [{
    candidateType: {
      type: String,
      enum: ['exporter', 'worker', 'delivery', 'agent', 'broker', 'other'],
      required: true
    },
    candidateName: {
      type: String,
      required: function() {
        return this.candidateType === 'other';
      }
    },
    commissionRate: {
      type: Number,
      required: true,
      min: 0,
      max: 100
    },
    commissionAmount: {
      type: Number,
      default: 0
    }
  }],
  totalCommission: {
    type: Number,
    default: 0
  }
});

// Enhanced Transaction Schema
const transactionSchema = new mongoose.Schema({
  customer: {
    type: mongoose.Schema.ObjectId,
    ref: 'Customer',
    required: function() {
      return this.type === 'purchase' || this.type === 'payment' || this.type === 'reminder';
    }
  },
  type: {
    type: String,
    enum: [
      'purchase',           // Customer purchase
      'payment',            // Customer payment
      'stock_purchase',     // Admin buying stock
      'expense',            // Business expenses
      'commission',         // Commission received
      'damaged_goods',      // Stock damage/loss
      'reminder',           // Payment reminders
      'bully_purchase'      // Admin personal purchase
    ],
    required: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  paidAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  remainingBalance: {
    type: Number,
    default: 0
  },
  note: {
    type: String,
    trim: true
  },
  
  // For purchase transactions
  items: [purchaseItemSchema],
  
  // Purchase-level commission (if any)
  purchaseCommission: {
    totalCommission: {
      type: Number,
      default: 0
    },
    commissionCandidates: [{
      candidateType: {
        type: String,
        enum: ['exporter', 'worker', 'delivery', 'agent', 'broker', 'other'],
        required: true
      },
      candidateName: {
        type: String,
        required: function() {
          return this.candidateType === 'other';
        }
      },
      commissionRate: {
        type: Number,
        required: true,
        min: 0,
        max: 100
      },
      commissionAmount: {
        type: Number,
        default: 0
      }
    }]
  },
  
  // For stock purchase transactions
  stockPurchase: {
    type: mongoose.Schema.ObjectId,
    ref: 'StockPurchase'
  },
  
  // For expense transactions
  expenseCategory: {
    type: String,
    enum: ['transport', 'labor', 'utilities', 'maintenance', 'rent', 'other']
  },
  expenseTo: {
    type: String  // To whom expense paid
  },
  
  // For commission transactions
  commissionFrom: {
    type: String  // From whom commission received
  },
  commissionType: {
    type: String,
    enum: ['cash', 'bank', 'upi']
  },
  
  // For damaged goods
  damageReason: {
    type: String
  },
  damageQuantity: {
    type: Number
  },
  
  // For reminders
  reminderDate: {
    type: Date
  },
  isCompleted: {
    type: Boolean,
    default: false
  },
  
  // For bully purchases (admin personal purchases)
  bullySupplier: {
    type: String
  },
  bullyBillNumber: {
    type: String
  },
  
  transactionDate: {
    type: Date,
    default: Date.now
  },
  createdBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// ========== INDEXES ==========

// Indexes for better performance
transactionSchema.index({ customer: 1, createdAt: -1 });
transactionSchema.index({ type: 1 });
inventorySchema.index({ productId: 1 });
inventorySchema.index({ category: 1 });
customerSchema.index({ customerId: 1 });
customerSchema.index({ phone: 1 });
stockPurchaseSchema.index({ inventory: 1 });

// ========== MIDDLEWARE ==========

// Hash password before saving
customerSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Method to check password
customerSchema.methods.correctPassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// ========== MODEL CREATION ==========

// Check if models already exist before creating them
const Customer = mongoose.models.Customer || mongoose.model('Customer', customerSchema);
const Transaction = mongoose.models.Transaction || mongoose.model('Transaction', transactionSchema);
const Inventory = mongoose.models.Inventory || mongoose.model('Inventory', inventorySchema);
const StockPurchase = mongoose.models.StockPurchase || mongoose.model('StockPurchase', stockPurchaseSchema);

module.exports = { 
  Customer, 
  Transaction, 
  Inventory, 
  StockPurchase
};