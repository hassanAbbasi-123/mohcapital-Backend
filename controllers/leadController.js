const Lead = require("../models/leadModel");
const LeadPurchase = require("../models/LeadPurchase");
const Conversation = require("../models/chatmodel/conversationModel");
const Message = require("../models/chatmodel/messageModel");
const User = require("../models/userModel");
const mongoose = require("mongoose");
const Razorpay = require('razorpay');
const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// PayPal order creation function
const createPayPalOrder = async (lead, purchase, user) => {
  try {
    const paypalOrder = {
      id: `paypal_${purchase._id}_${Date.now()}`,
      status: "CREATED",
      links: [
        {
          href: "https://www.sandbox.paypal.com/checkoutnow?token=MOCK_TOKEN",
          rel: "approve",
          method: "GET"
        }
      ],
      create_time: new Date().toISOString(),
      amount: {
        value: (lead.lead_price * 0.012).toFixed(2),
        currency_code: "USD"
      }
    };

    return paypalOrder;
  } catch (error) {
    throw new Error(`PayPal order creation failed: ${error.message}`);
  }
};

// ── UPLOAD PAYMENT PROOF (UPDATED) ──────────────────────────
exports.uploadPaymentProof = async (req, res) => {
  try {
    console.log("=== PAYMENT PROOF UPLOAD START ===");
    console.log("🔄 Uploading payment screenshot for purchase:", req.params.purchaseId);
    console.log("👤 User ID:", req.user._id);
    
    if (req.user.role !== "seller") {
      return res.status(403).json({ 
        success: false, 
        message: "Seller access required" 
      });
    }

    const { purchaseId } = req.params;

    // Check if file was uploaded via multer
    if (!req.file) {
      console.error("❌ No file uploaded via multer");
      return res.status(400).json({
        success: false,
        message: "No file uploaded. Please select an image file and try again.",
        details: "Multer did not process any file. Check if the file field is named 'payment_proof'."
      });
    }

    console.log("📁 File details from multer:", {
      fieldname: req.file.fieldname,
      originalname: req.file.originalname,
      encoding: req.file.encoding,
      mimetype: req.file.mimetype,
      destination: req.file.destination,
      filename: req.file.filename,
      path: req.file.path,
      size: req.file.size
    });

    // Find the purchase
    console.log("🔍 Looking for purchase:", purchaseId);
    const purchase = await LeadPurchase.findOne({
      _id: purchaseId,
      seller: req.user._id,
      payment_mode: "manual",
      payment_status: { $in: ["pending", "manual_pending"] }
    }).populate("lead");

    if (!purchase) {
      console.error("❌ Purchase not found or invalid:", {
        purchaseId,
        sellerId: req.user._id,
        found: !!purchase
      });

      return res.status(404).json({
        success: false,
        message: "Purchase not found or invalid status.",
        details: "Make sure you have a pending manual payment for this lead."
      });
    }

    console.log("✅ Purchase found:", {
      purchaseId: purchase._id,
      leadId: purchase.lead?._id,
      payment_mode: purchase.payment_mode,
      payment_status: purchase.payment_status
    });

    // Check if lead is still available
    const lead = purchase.lead;
    if (!lead) {
      console.error("❌ Lead not found for purchase:", purchaseId);
      return res.status(400).json({
        success: false,
        message: "Associated lead not found. Please contact support."
      });
    }

    if (lead.sold_count >= lead.max_sellers) {
      console.error("❌ Lead sold out:", {
        leadId: lead._id,
        sold_count: lead.sold_count,
        max_sellers: lead.max_sellers
      });
      return res.status(400).json({
        success: false,
        message: "This lead is already sold out. Please contact support for a refund."
      });
    }

    // ✅ FIXED: Generate proper URL path
    // The file is saved to: uploads/leads/payment-proofs/
    // We need to create URL: /uploads/leads/payment-proofs/filename.ext
    
    const baseDir = "uploads/leads/payment-proofs/";
    const filename = req.file.filename;
    
    // Create URL path (relative to server root)
    const paymentProofUrl = `/uploads/leads/payment-proofs/${filename}`;
    
    console.log("📸 Generated payment proof URL:", paymentProofUrl);
    console.log("📁 Full server path:", path.join(process.cwd(), baseDir, filename));
    console.log("📁 File exists:", fs.existsSync(path.join(process.cwd(), baseDir, filename)));

    // Update purchase with payment details
    purchase.payment_proof = paymentProofUrl;
    purchase.payment_date = new Date();
    purchase.payment_status = "pending"; // Change to pending for admin verification
    purchase.notes = `Payment screenshot uploaded on ${new Date().toLocaleString()}. File: ${req.file.originalname}. Awaiting admin verification.`;

    await purchase.save();

    console.log("✅ Purchase updated successfully");
    console.log("=== PAYMENT PROOF UPLOAD COMPLETE ===");

    res.json({
      success: true,
      message: "Payment screenshot uploaded successfully!",
      details: "Our team will verify and approve within 24-48 hours.",
      purchase: {
        id: purchase._id,
        payment_proof: paymentProofUrl,
        payment_status: purchase.payment_status,
        payment_date: purchase.payment_date,
        notes: purchase.notes
      }
    });

  } catch (error) {
    console.error("❌ ERROR in uploadPaymentProof:", error);
    console.error("❌ Error stack:", error.stack);
    
    res.status(500).json({
      success: false,
      message: "Failed to upload payment screenshot",
      error: error.message,
      details: "Please try again or contact support if the issue persists."
    });
  }
};

// ── CREATE LEAD ──────────────────────────────────────────
exports.createLead = async (req, res) => {
  try {
    console.log("🔄 Incoming createLead request body:", req.body);
    const user = req.user;
    if (!user) return res.status(401).json({ message: "Not authorized" });

    const {
      category,
      product,
      quantity,
      quality_type,
      delivery_location,
      description,
      price_range,
      allow_sellers_contact = false,
      buyer_contact_phone,
      buyer_contact_email
    } = req.body;

    // Validate required fields
    if (!category || !product || !quantity || !delivery_location || !description) {
      console.error("❌ Missing required fields:", req.body);
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Validate buyer contact if sellers can contact
    if (allow_sellers_contact && (!buyer_contact_phone || !buyer_contact_email)) {
      console.error("❌ Contact info missing:", { buyer_contact_phone, buyer_contact_email });
      return res.status(400).json({
        message: "Buyer contact phone and email are required if sellers can contact"
      });
    }

    // Create new lead
    const lead = new Lead({
      buyer: user._id,
      category,
      product,
      quantity,
      quality_type,
      delivery_location,
      description,
      price_range,
      allow_sellers_contact,
      buyer_contact_phone: allow_sellers_contact ? buyer_contact_phone : undefined,
      buyer_contact_email: allow_sellers_contact ? buyer_contact_email : undefined
    });

    await lead.save();
    console.log("✅ Lead saved:", lead._id);

    const populatedLead = await Lead.findById(lead._id)
      .populate("buyer", "name email")
      .lean();

    res.status(201).json({ message: "Lead submitted", lead: populatedLead });
  } catch (error) {
    console.error("❌ createLead failed:", error);
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

// ── BUYER: Get My Leads ───────────────────────────────────
exports.getMyLeads = async (req, res) => {
  try {
    if (!["user", "buyer"].includes(req.user.role)) {
      return res.status(403).json({ message: "Buyers only" });
    }

    const { page = 1, limit = 10, status } = req.query;
    const query = { buyer: req.user._id };
    if (status) query.status = status;

    const leads = await Lead.find(query)
      .populate("buyer", "name email")
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Lead.countDocuments(query);

    res.json({
      leads,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error("❌ Error in getMyLeads:", error);
    res.status(500).json({
      message: "Failed to fetch leads",
      error: error.message
    });
  }
};

// ── ADMIN: Get Pending Leads ──────────────────────────────
exports.getPendingLeads = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }

    const { page = 1, limit = 10 } = req.query;
    const leads = await Lead.find({ status: "pending" })
      .populate("buyer", "name email phone")
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Lead.countDocuments({ status: "pending" });

    res.json({
      leads,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error("❌ Error in getPendingLeads:", error);
    res.status(500).json({
      message: "Failed to fetch pending leads",
      error: error.message
    });
  }
};

// ── ADMIN: Get All Leads (with filters) ───────────────────
exports.getAllLeads = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }

    const { status, category, page = 1, limit = 10 } = req.query;
    const query = {};
    if (status) query.status = status;
    if (category) query.category = category;

    const leads = await Lead.find(query)
      .populate("buyer", "name email phone")
      .populate("approved_by", "name")
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Lead.countDocuments(query);

    res.json({
      leads,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error("❌ Error in getAllLeads:", error);
    res.status(500).json({
      message: "Failed to fetch leads",
      error: error.message
    });
  }
};

// ── ADMIN: Approve / Reject + Set Price & max_sellers ─────
exports.approveLead = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }

    const { leadId } = req.params;
    const { status, lead_price, max_sellers = 1 } = req.body;

    console.log("🔄 Approve/Reject lead request:", {
      leadId,
      status,
      lead_price,
      max_sellers,
      user: req.user._id
    });

    if (!mongoose.Types.ObjectId.isValid(leadId)) {
      return res.status(400).json({ message: "Invalid lead ID" });
    }

    const lead = await Lead.findById(leadId);
    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({
        message: "Status must be 'approved' or 'rejected'"
      });
    }

    // Handle rejection
    if (status === "rejected") {
      lead.status = status;
      await lead.save();

      const populatedLead = await Lead.findById(lead._id)
        .populate("buyer", "name email phone")
        .populate("approved_by", "name");

      console.log("✅ Lead rejected successfully:", leadId);
      return res.json({
        message: "Lead rejected successfully",
        lead: populatedLead
      });
    }

    // Handle approval
    if (status === "approved") {
      if (!lead_price || lead_price < 50) {
        return res.status(400).json({ message: "Lead price must be at least ₹50" });
      }

      if (![1, 3, 5, 10].includes(max_sellers)) {
        return res.status(400).json({ message: "Maximum sellers must be 1, 3, 5, or 10" });
      }

      lead.lead_price = lead_price;
      lead.max_sellers = max_sellers;
      lead.sold_count = 0;
      lead.approved_at = Date.now();
      lead.approved_by = req.user._id;
      lead.expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      lead.status = "approved";

      await lead.save();

      const populatedLead = await Lead.findById(lead._id)
        .populate("buyer", "name email phone")
        .populate("approved_by", "name");

      console.log("✅ Lead approved successfully:", leadId);
      return res.json({
        message: "Lead approved successfully",
        lead: populatedLead
      });
    }
  } catch (error) {
    console.error("❌ Error in approveLead:", error);
    res.status(500).json({
      message: "Failed to process lead",
      error: error.message
    });
  }
};

// ── SELLER: Browse Available Leads ────────────────────────
exports.getAvailableLeads = async (req, res) => {
  try {
    console.log("🔍 getAvailableLeads called for seller:", req.user._id);

    if (req.user.role !== "seller") {
      return res.status(403).json({ message: "Seller access required" });
    }

    const { page = 1, limit = 10, category, location } = req.query;

    const query = {
      status: "approved",
      allow_sellers_contact: true,
      expires_at: { $gt: new Date() }
    };

    if (category && category !== "all") {
      query.category = category;
    }

    if (location) {
      query.delivery_location = { $regex: location, $options: "i" };
    }

    const leads = await Lead.find(query)
      .populate("buyer", "name email")
      .select("category product quantity delivery_location lead_price description createdAt max_sellers sold_count allow_sellers_contact buyer_contact_phone buyer_contact_email expires_at status")
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Lead.countDocuments(query);

    // Filter leads that have available slots and add computed fields
    const leadsWithAvailableSlots = leads.filter(lead =>
      lead.sold_count < lead.max_sellers
    );

    const leadsWithSlots = leadsWithAvailableSlots.map(lead => ({
      ...lead.toObject(),
      slots_left: lead.max_sellers - lead.sold_count,
      remaining_slots: lead.max_sellers - lead.sold_count // For frontend compatibility
    }));

    res.json({
      leads: leadsWithSlots,
      total: leadsWithAvailableSlots.length,
      page: parseInt(page),
      pages: Math.ceil(leadsWithAvailableSlots.length / limit)
    });
  } catch (error) {
    console.error("❌ Error in getAvailableLeads:", error);
    res.status(500).json({
      message: "Failed to fetch available leads",
      error: error.message
    });
  }
};

// ── Create Razorpay Order ─────────────────────────────────
exports.createRazorpayOrder = async (req, res) => {
  try {
    if (req.user.role !== "seller") {
      return res.status(403).json({ message: "Seller access required" });
    }

    const { leadId } = req.params;
    const sellerUser = req.user;

    console.log("🔄 Creating Razorpay order for lead:", leadId);

    const lead = await Lead.findById(leadId);
    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    if (lead.status !== "approved") {
      return res.status(400).json({ message: "Lead is not approved" });
    }

    if (lead.expires_at < new Date()) {
      return res.status(400).json({ message: "Lead has expired" });
    }

    if (lead.sold_count >= lead.max_sellers) {
      return res.status(400).json({ message: "Lead sold out" });
    }

    const alreadyBought = await LeadPurchase.findOne({
      lead: lead._id,
      seller: sellerUser._id
    });

    if (alreadyBought) {
      return res.status(400).json({ message: "You have already purchased this lead" });
    }

    const amount = Math.round(lead.lead_price * 100); // Convert to paise

    const options = {
      amount: amount,
      currency: "INR",
      receipt: `lead_${leadId}_${Date.now()}`,
      notes: {
        leadId: leadId.toString(),
        sellerId: sellerUser._id.toString(),
        product: lead.product,
        category: lead.category
      }
    };

    console.log("🔎 Razorpay order options:", {
      amount: options.amount,
      currency: options.currency,
      receipt: options.receipt,
      leadId: leadId,
      product: lead.product,
      price: lead.lead_price
    });

    const order = await razorpay.orders.create(options);

    console.log("✅ Razorpay order created:", order.id);

    res.json({
      id: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt,
      key: process.env.RAZORPAY_KEY_ID
    });

  } catch (error) {
    console.error("❌ Razorpay order creation failed:", error);

    if (error.statusCode === 400) {
      return res.status(400).json({
        message: "Invalid request to Razorpay",
        error: error.error?.description || error.message
      });
    }

    if (error.statusCode === 401) {
      return res.status(500).json({
        message: "Razorpay authentication failed. Check API keys."
      });
    }

    res.status(500).json({
      message: "Failed to create Razorpay order",
      error: error.message
    });
  }
};

// ── SELLER: Buy Lead (Payment Integration) ──────────────
exports.buyLead = async (req, res) => {
  try {
    if (req.user.role !== "seller") {
      return res.status(403).json({ message: "Sellers only" });
    }

    const { leadId } = req.params;
    const { payment_method } = req.body;

    // Validate payment method
    if (!["razorpay", "paypal", "manual"].includes(payment_method)) {
      return res.status(400).json({ message: "Invalid payment method" });
    }

    if (!mongoose.Types.ObjectId.isValid(leadId)) {
      return res.status(400).json({ message: "Invalid lead ID" });
    }

    const lead = await Lead.findById(leadId).populate("buyer", "name email");
    if (!lead) return res.status(404).json({ message: "Lead not found" });

    if (lead.status !== "approved") {
      return res.status(400).json({ message: "Lead is not available for purchase" });
    }

    if (lead.sold_count >= lead.max_sellers) {
      return res.status(400).json({ message: "No slots left for this lead" });
    }

    const existingPurchase = await LeadPurchase.findOne({ lead: leadId, seller: req.user._id });
    if (existingPurchase) {
      return res.status(400).json({ message: "You have already purchased this lead" });
    }

    // Create purchase entry
    const purchase = new LeadPurchase({
      lead: lead._id,
      seller: req.user._id,
      payment_mode: payment_method,
      payment_status: payment_method === "manual" ? "manual_pending" : "pending"
    });

    let orderDetails;
    let orderError = null;

    // 🟧 Razorpay order creation
    if (payment_method === "razorpay") {
      try {
        const keyId = process.env.RAZORPAY_KEY_ID;
        const keySecret = process.env.RAZORPAY_KEY_SECRET;

        if (!keyId || !keySecret) throw new Error("Razorpay keys missing");

        const amountPaise = Math.round(lead.lead_price * 100);

        const response = await axios({
          method: "post",
          url: "https://api.razorpay.com/v1/orders",
          auth: { username: keyId, password: keySecret },
          data: {
            amount: amountPaise,
            currency: "INR",
            receipt: `lead_${purchase._id.toString().slice(-8)}`,
            payment_capture: 1,
            notes: {
              lead_id: lead._id.toString(),
              seller_id: req.user._id.toString(),
              purchase_id: purchase._id.toString(),
              product: lead.product
            }
          }
        });

        orderDetails = {
          id: response.data.id,
          amount: response.data.amount,
          currency: response.data.currency,
          key: keyId,
          name: "Lead Purchase",
          description: `Purchase lead for ${lead.product}`,
          prefill: {
            name: req.user.name,
            email: req.user.email
          }
        };

        purchase.razorpay_order_id = orderDetails.id;
        purchase.payment_id = orderDetails.id;
        purchase.payment_status = "initiated";

      } catch (err) {
        orderError = err;
      }
    }

    // 🟦 PayPal order creation
    if (payment_method === "paypal") {
      try {
        orderDetails = await createPayPalOrder(lead, purchase, req.user);
        purchase.payment_id = orderDetails.id;
        purchase.payment_status = "initiated";
      } catch (err) {
        orderError = err;
      }
    }

    // 🟩 Manual payment - SIMPLIFIED (only screenshot required)
    if (payment_method === "manual") {
      purchase.payment_status = "manual_pending";
      purchase.notes = "Manual payment pending. Please upload payment screenshot.";
    }

    if (orderError && payment_method !== "manual") {
      purchase.payment_status = "failed";
      purchase.payment_response = { error: orderError.message };
      await purchase.save();

      return res.status(400).json({
        message: "Payment order creation failed",
        error: orderError.response?.data || orderError.message
      });
    }

    await purchase.save();

    return res.json({
      success: true,
      message: payment_method === "manual"
        ? "Manual purchase initiated. Please upload payment screenshot."
        : `${payment_method.toUpperCase()} order created successfully`,
      purchaseId: purchase._id,
      payment_mode: payment_method,
      order: orderDetails,
      requires_manual_upload: payment_method === "manual"
    });

  } catch (err) {
    console.error("❌ buyLead error:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: err.message
    });
  }
};

// ── Verify Razorpay Payment ──────────────────────────────
exports.verifyRazorpayPayment = async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      purchaseId
    } = req.body;

    const purchase = await LeadPurchase.findById(purchaseId);
    if (!purchase) {
      return res.status(404).json({ message: "Purchase not found" });
    }

    // Verify signature
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body.toString())
      .digest("hex");

    if (expectedSignature === razorpay_signature) {
      // Payment successful
      purchase.payment_status = "approved";
      purchase.razorpay_payment_id = razorpay_payment_id;
      purchase.razorpay_signature = razorpay_signature;
      purchase.approved_at = new Date();
      await purchase.save();

      // Update lead sold count
      const lead = await Lead.findById(purchase.lead);
      lead.sold_count += 1;
      if (lead.sold_count >= lead.max_sellers) {
        lead.status = "sold";
      }
      await lead.save();

      // Create conversation
      await this.createConversationForPurchase(purchase);

      res.json({
        success: true,
        message: "Payment verified successfully",
        purchase: purchase
      });
    } else {
      // Signature verification failed
      purchase.payment_status = "failed";
      await purchase.save();

      res.status(400).json({
        success: false,
        message: "Payment verification failed"
      });
    }
  } catch (error) {
    console.error("❌ Razorpay verification error:", error);
    res.status(500).json({
      success: false,
      message: "Payment verification failed",
      error: error.message
    });
  }
};

// ── Create Conversation for Purchase ─────────────────────
exports.createConversationForPurchase = async (purchase) => {
  try {
    const populatedPurchase = await LeadPurchase.findById(purchase._id)
      .populate("lead")
      .populate("seller")
      .populate("lead.buyer");

    const { lead, seller } = populatedPurchase;

    // Create conversation between buyer and seller
    let conversation = await Conversation.findOne({
      participants: { $all: [lead.buyer._id, seller._id] },
      lead: lead._id
    });

    if (!conversation) {
      conversation = new Conversation({
        buyer: lead.buyer._id,
        seller: seller._id,
        participants: [lead.buyer._id, seller._id],
        lead: lead._id
      });
      await conversation.save();
    }

    // Create system message
    const systemMessage = new Message({
      conversation: conversation._id,
      sender: seller._id, // Seller as sender for system message
      type: "system",
      text: `🎉 Lead purchase completed! Seller ${seller.name} has purchased your lead for ${lead.product}. You can now communicate directly.`
    });
    await systemMessage.save();

    // If buyer allowed contact sharing, send contact details
    if (lead.allow_sellers_contact) {
      const contactMessage = new Message({
        conversation: conversation._id,
        sender: seller._id,
        type: "system",
        text: `📞 Buyer Contact Details:\nName: ${lead.buyer.name}\nPhone: ${lead.buyer_contact_phone}\nEmail: ${lead.buyer_contact_email}`
      });
      await contactMessage.save();
    }

    return conversation;
  } catch (error) {
    console.error("❌ Error creating conversation:", error);
    throw error;
  }
};

// ── SELLER: Get My Purchased Leads ────────────────────────
exports.getMyPurchasedLeads = async (req, res) => {
  try {
    console.log("🔍 getMyPurchasedLeads called for seller:", req.user._id);

    if (req.user.role !== "seller") return res.status(403).json({ message: "Seller access required" });

    const { page = 1, limit = 10 } = req.query;

    const purchases = await LeadPurchase.find({ seller: req.user._id })
      .populate({
        path: "lead",
        populate: [{
          path: "buyer",
          select: "name phone email"
        }]
      })
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await LeadPurchase.countDocuments({ seller: req.user._id });

    res.json({
      purchases,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error("❌ Error in getMyPurchasedLeads:", error);
    res.status(500).json({
      message: "Failed to fetch purchased leads",
      error: error.message
    });
  }
};

// ── Get Payment Status ───────────────────────────────────
exports.getPaymentStatus = async (req, res) => {
  try {
    const { purchaseId } = req.params;

    const purchase = await LeadPurchase.findById(purchaseId)
      .populate('lead')
      .populate('seller');

    if (!purchase) {
      return res.status(404).json({ message: "Purchase not found" });
    }

    res.json({
      status: purchase.payment_status,
      purchase: purchase
    });
  } catch (error) {
    console.error("Error getting payment status:", error);
    res.status(500).json({ message: "Failed to get payment status" });
  }
};

// ── ADMIN: Verify Payment & Create Chat ───────────────────
exports.verifyPayment = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }

    const { purchaseId } = req.params;

    console.log("🔄 Verify payment request:", { purchaseId, admin: req.user._id });

    const purchase = await LeadPurchase.findById(purchaseId)
      .populate("lead")
      .populate("seller")
      .populate("lead.buyer");

    if (!purchase) {
      return res.status(404).json({ success: false, message: "Purchase not found" });
    }

    if (purchase.payment_status === "approved") {
      return res.status(400).json({ success: false, message: "Payment already approved" });
    }

    // Check if this is a manual payment with screenshot
    if (purchase.payment_mode === "manual" && !purchase.payment_proof) {
      return res.status(400).json({
        success: false,
        message: "Payment screenshot is required for manual payment verification"
      });
    }

    // Update payment status
    purchase.payment_status = "approved";
    purchase.approved_by = req.user._id;
    purchase.approved_at = new Date();
    await purchase.save();

    // Update lead sold count
    const lead = purchase.lead;
    lead.sold_count += 1;
    if (lead.sold_count >= lead.max_sellers) {
      lead.status = "sold";
    }
    await lead.save();

    // Create conversation
    const conversation = await this.createConversationForPurchase(purchase);

    res.json({
      success: true,
      message: "Payment verified successfully! Chat created between buyer and seller.",
      conversation_id: conversation._id,
      contact_shared: lead.allow_sellers_contact,
      payment_mode: purchase.payment_mode
    });
  } catch (error) {
    console.error("❌ Error in verifyPayment:", error);
    res.status(500).json({
      success: false,
      message: "Failed to verify payment",
      error: error.message
    });
  }
};

// ── ADMIN: Get Pending Payments ───────────────────────────
exports.getPendingPayments = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }

    const { page = 1, limit = 10 } = req.query;

    const pendingPayments = await LeadPurchase.find({
      payment_status: { $in: ["pending", "manual_pending"] }
    })
      .populate({
        path: "lead",
        populate: [{ path: "buyer", select: "name email" }]
      })
      .populate("seller", "name email phone")
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await LeadPurchase.countDocuments({
      payment_status: { $in: ["pending", "manual_pending"] }
    });

    res.json({
      success: true,
      payments: pendingPayments,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error("❌ Error in getPendingPayments:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch pending payments",
      error: error.message
    });
  }
};

// ── ADMIN: Reject Payment ─────────────────────────────────
exports.rejectPayment = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }

    const { purchaseId } = req.params;
    const { rejection_reason } = req.body;

    console.log("🔄 Reject payment request:", { purchaseId, admin: req.user._id, rejection_reason });

    const purchase = await LeadPurchase.findById(purchaseId);

    if (!purchase) {
      return res.status(404).json({ success: false, message: "Purchase not found" });
    }

    if (purchase.payment_status === "approved") {
      return res.status(400).json({ success: false, message: "Payment already approved" });
    }

    // Update payment status to failed
    purchase.payment_status = "failed";
    purchase.notes = rejection_reason
      ? `${purchase.notes || ''}\nRejected: ${rejection_reason}`
      : purchase.notes;
    await purchase.save();

    res.json({
      success: true,
      message: "Payment rejected successfully",
      purchase: purchase
    });
  } catch (error) {
    console.error("❌ Error in rejectPayment:", error);
    res.status(500).json({
      success: false,
      message: "Failed to reject payment",
      error: error.message
    });
  }
};

// ── ADMIN: Revenue Analytics ──────────────────────────────
exports.getLeadAnalytics = async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ message: "Admin access required" });

    const stats = await LeadPurchase.aggregate([
      {
        $match: {
          payment_status: "approved"
        }
      },
      {
        $lookup: {
          from: "leads",
          localField: "lead",
          foreignField: "_id",
          as: "lead"
        }
      },
      {
        $unwind: "$lead"
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: "$lead.lead_price" },
          leadsSold: { $sum: 1 },
          razorpayRevenue: {
            $sum: {
              $cond: [{ $eq: ["$payment_mode", "razorpay"] }, "$lead.lead_price", 0]
            }
          },
          paypalRevenue: {
            $sum: {
              $cond: [{ $eq: ["$payment_mode", "paypal"] }, "$lead.lead_price", 0]
            }
          },
          manualRevenue: {
            $sum: {
              $cond: [{ $eq: ["$payment_mode", "manual"] }, "$lead.lead_price", 0]
            }
          }
        }
      }
    ]);

    const result = stats[0] || {
      totalRevenue: 0,
      leadsSold: 0,
      razorpayRevenue: 0,
      paypalRevenue: 0,
      manualRevenue: 0
    };

    // Add conversion rate
    const totalLeads = await Lead.countDocuments({ status: "approved" });
    result.conversionRate = totalLeads > 0 ? (result.leadsSold / totalLeads * 100).toFixed(2) : 0;

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error("❌ Error in getLeadAnalytics:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch analytics",
      error: error.message
    });
  }
};

// ── Payment Webhook ──────────────────────────────────────
exports.paymentWebhook = async (req, res) => {
  try {
    const { event, payload } = req.body;

    if (event === "payment.captured") {
      const { payment, order } = payload;

      // Find purchase by Razorpay order ID
      const purchase = await LeadPurchase.findOne({
        razorpay_order_id: order.entity.id
      });

      if (purchase && purchase.payment_status !== "approved") {
        purchase.payment_status = "approved";
        purchase.razorpay_payment_id = payment.entity.id;
        purchase.approved_at = new Date();
        await purchase.save();

        // Update lead sold count
        const lead = await Lead.findById(purchase.lead);
        lead.sold_count += 1;
        if (lead.sold_count >= lead.max_sellers) {
          lead.status = "sold";
        }
        await lead.save();

        // Create conversation
        await this.createConversationForPurchase(purchase);
      }
    }

    res.json({ success: true, received: true });
  } catch (error) {
    console.error("Webhook error:", error);
    res.status(400).json({ success: false, error: "Webhook processing failed" });
  }
};