// controllers/leadController.js
const Lead = require("../models/leadModel");
const LeadPurchase = require("../models/LeadPurchase");
const Conversation = require("../models/chatmodel/conversationModel");
const Message = require("../models/chatmodel/messageModel");
const User = require("../models/userModel");
const mongoose = require("mongoose");
const axios = require("axios");  // Keep for Razorpay/PayPal
const crypto = require("crypto");

// CRC32 Polyfill for PayPal webhook verification (Node crypto doesn't support 'crc32')
function crc32(str) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    crc = crc >>> 8 ^ table[(crc ^ code) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
const table = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

// ── NEW: PayPal Raw API Functions (replaces deprecated SDK) ──
async function getAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Missing PayPal CLIENT_ID or CLIENT_SECRET in .env");
  }
  const baseUrl = process.env.PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  try {
    const response = await axios({
      method: 'post',
      url: `${baseUrl}/v1/oauth2/token`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      auth: {
        username: clientId,
        password: clientSecret,
      },
      data: 'grant_type=client_credentials'
    });
    console.log("✅ PayPal access token obtained");
    return response.data.access_token;
  } catch (error) {
    console.error("❌ Error getting PayPal access token:", error.response?.data || error.message);
    throw new Error(`PayPal auth failed: ${error.response?.data?.message || error.message}`);
  }
}

async function createPayPalOrder(lead, purchase) {
  const accessToken = await getAccessToken();
  const baseUrl = process.env.PAYPAL_MODE === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  const customId = `lead_${lead._id}_seller_${purchase.seller}_purchase_${purchase._id}`;
  console.log("🔄 Creating PayPal order for lead_price:", lead.lead_price, "custom_id:", customId);
  try {
    const response = await axios({
      method: 'post',
      url: `${baseUrl}/v2/checkout/orders`,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      data: {
        intent: 'CAPTURE',
        purchase_units: [{
          amount: {
            currency_code: 'USD',  // Changed back to 'USD' for sandbox compatibility; adjust for live INR if merchant supports
            value: lead.lead_price.toFixed(2)
          },
          description: `Purchase lead for ${lead.product}`,
          custom_id: customId
        }]
      }
    });
    console.log("✅ PayPal full response:", {
      statusCode: response.status,
      statusMessage: response.statusText,
      body: JSON.stringify(response.data, null, 2)  // Pretty-print body (order or error)
    });
    if (response.status !== 201) {
      const errorDetails = response.data?.details || response.data?.message || 'Unknown error';
      throw new Error(`PayPal API failed: ${response.status} - ${errorDetails}`);
    }
    const approveLink = response.data.links.find(link => link.rel === 'approve')?.href;
    const orderDetails = {
      id: response.data.id,
      status: response.data.status,
      links: approveLink,
    };
    console.log("✅ Order created successfully, ID:", orderDetails.id);
    return orderDetails;
  } catch (error) {
    console.error("❌ Full PayPal error:", {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message
    });
    throw new Error(`PayPal creation failed: ${error.response?.data?.message || error.message}`);
  }
}

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
    console.log("🔄 approveLead request:", { leadId: req.params.leadId, body: req.body, userRole: req.user?.role });

    if (req.user.role !== "admin") {
      console.log("❌ Unauthorized: Not admin");
      return res.status(403).json({ message: "Admin access required" });
    }

    const { leadId } = req.params;
    const { status, lead_price, max_sellers = 1 } = req.body;

    console.log("🔄 Parsed inputs:", { status, lead_price, max_sellers });

    if (!mongoose.Types.ObjectId.isValid(leadId)) {
      console.log("❌ Invalid leadId");
      return res.status(400).json({ message: "Invalid lead ID" });
    }

    const lead = await Lead.findById(leadId);
    if (!lead) {
      console.log("❌ Lead not found:", leadId);
      return res.status(404).json({ message: "Lead not found" });
    }

    if (status === "approved" && (!lead.product || !lead.category || !lead.quantity || !lead.delivery_location || !lead.description)) {
      console.log("❌ Lead missing required fields for approval:", { product: lead.product, category: lead.category });
      return res.status(400).json({ message: "Lead is missing required fields (e.g., product) and cannot be approved. Please check the lead data." });
    }

    if (status === "approved") {
      const parsedPrice = parseFloat(lead_price);
      if (isNaN(parsedPrice) || parsedPrice < 0) {
        console.log("❌ Invalid lead_price:", lead_price);
        return res.status(400).json({ message: "Lead price must be a valid positive number" });
      }

      const parsedMaxSellers = parseInt(max_sellers, 10);
      if (isNaN(parsedMaxSellers) || parsedMaxSellers < 1) {
        console.log("❌ Invalid max_sellers:", max_sellers);
        return res.status(400).json({ message: "Max sellers must be a positive integer" });
      }

      lead.status = "approved";
      lead.lead_price = parsedPrice;
      lead.max_sellers = parsedMaxSellers;
      lead.approved_at = new Date();
      lead.approved_by = req.user._id;
      lead.expires_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);  // 30 days expiry
    } else if (status === "rejected") {
      lead.status = "rejected";
    } else {
      console.log("❌ Invalid status:", status);
      return res.status(400).json({ message: "Status must be 'approved' or 'rejected'" });
    }

    const savedLead = await lead.save();
    console.log("✅ Lead saved successfully:", savedLead._id, "Status:", savedLead.status);

    res.json({ message: `Lead ${status}`, lead: savedLead });
  } catch (error) {
    console.error("❌ Error in approveLead:", error);
    const errorMsg = error.message || error.toString() || "Unknown server error";
    res.status(500).json({
      message: "Failed to update lead",
      error: errorMsg
    });
  }
};

// ── SELLER: Get Available Leads ───────────────────────────
exports.getAvailableLeads = async (req, res) => {
  try {
    if (req.user.role !== "seller") {
      return res.status(403).json({ message: "Sellers only" });
    }

    const { page = 1, limit = 10, category, location } = req.query;
    const matchQuery = {
      status: { $in: ["approved"] },
      expires_at: { $gt: new Date() }
    };
    if (category) matchQuery.category = category;
    if (location) matchQuery.delivery_location = { $regex: location, $options: "i" };

    const leads = await Lead.aggregate([
      { $match: matchQuery },
      {
        $lookup: {
          from: "leadpurchases",
          let: { leadId: "$_id" },
          pipeline: [
            { $match: { 
              $expr: { $eq: ["$lead", "$$leadId"] }, 
              payment_status: "approved" 
            } }
          ],
          as: "purchases"
        }
      },
      {
        $addFields: {
          remaining_slots: {
            $subtract: ["$max_sellers", { $size: "$purchases" }]
          }
        }
      },
      { $match: { remaining_slots: { $gt: 0 } } },
      {
        $lookup: {
          from: "users",
          localField: "buyer",
          foreignField: "_id",
          as: "buyer",
          pipeline: [{ $project: { name: 1, email: 1 } }]
        }
      },
      { $unwind: "$buyer" },
      { $sort: { createdAt: -1 } },
      { $skip: (page - 1) * limit },
      { $limit: parseInt(limit) },
      {
        $project: {
          purchases: 0,
          buyer: { password: 0, __v: 0 }
        }
      }
    ]);

    const countPipeline = [
      { $match: matchQuery },
      {
        $lookup: {
          from: "leadpurchases",
          let: { leadId: "$_id" },
          pipeline: [
            { $match: { 
              $expr: { $eq: ["$lead", "$$leadId"] }, 
              payment_status: "approved" 
            } }
          ],
          as: "purchases"
        }
      },
      {
        $addFields: {
          remaining_slots: {
            $subtract: ["$max_sellers", { $size: "$purchases" }]
          }
        }
      },
      { $match: { remaining_slots: { $gt: 0 } } },
      { $count: "total" }
    ];
    const countResult = await Lead.aggregate(countPipeline);
    const total = countResult[0]?.total || 0;

    res.json({
      leads,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error("❌ Error in getAvailableLeads:", error);
    res.status(500).json({
      message: "Failed to fetch available leads",
      error: error.message
    });
  }
};

// ── SELLER: Buy Lead (UPDATED: Support Razorpay, PayPal, Manual) ──
exports.buyLead = async (req, res) => {
  try {
    if (req.user.role !== "seller") {
      return res.status(403).json({ message: "Sellers only" });
    }

    const { leadId } = req.params;
    const { payment_method = "manual", payment_proof } = req.body;

    if (!mongoose.Types.ObjectId.isValid(leadId)) {
      return res.status(400).json({ message: "Invalid lead ID" });
    }

    const lead = await Lead.findById(leadId).populate("buyer", "name email");
    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

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

    if (!["razorpay", "paypal", "manual"].includes(payment_method)) {
      return res.status(400).json({ message: "Invalid payment method" });
    }

    if (payment_method === "manual" && !payment_proof) {
      return res.status(400).json({ message: "Payment proof is required for manual payment" });
    }

    const purchase = new LeadPurchase({
      lead: lead._id,
      seller: req.user._id,
      payment_mode: payment_method,
      payment_proof: payment_method === "manual" ? payment_proof : undefined,
      payment_status: "pending"
    });
    await purchase.save();

    if (payment_method === "manual") {
      const populatedPurchase = await LeadPurchase.findById(purchase._id)
        .populate("lead", "product lead_price")
        .populate("seller", "name email")
        .lean();
      return res.json({ message: "Manual purchase created. Awaiting admin verification.", purchase: populatedPurchase });
    }

    let orderDetails;
    let orderError = null;

   if (payment_method === "razorpay") {
  // RAW Axios Razorpay order creation with full logging
  console.log("🔄 Attempting Razorpay order:", { leadId: lead._id.toString() });

  console.log("🔎 ENV Check - RAZORPAY_KEY_ID present:", !!process.env.RAZORPAY_KEY_ID);
  console.log("🔎 ENV Check - RAZORPAY_KEY_SECRET present:", !!process.env.RAZORPAY_KEY_SECRET);

  const rawPrice = lead.lead_price;
  const parsedPrice = Number(rawPrice);
  console.log("🔎 Lead price raw:", rawPrice, "parsed:", parsedPrice);

  if (!isFinite(parsedPrice) || parsedPrice <= 0) {
    throw new Error(`Invalid lead.lead_price (${rawPrice}). Must be a positive number.`);
  }

  const amountPaise = Math.round(parsedPrice * 100);
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw new Error(`Invalid amount in paise (${amountPaise}). Must be a positive integer paise value.`);
  }

  console.log("🔎 Amount to send to Razorpay (paise):", amountPaise, "currency: INR");

  try {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      throw new Error("Missing RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET in .env");
    }

    // 🔹 FIXED: Shorten receipt to <=40 chars
    const shortReceipt = `purchase_${purchase._id.toString().slice(-12)}`;

    const response = await axios({
      method: 'post',
      url: 'https://api.razorpay.com/v1/orders',
      auth: { username: keyId, password: keySecret },
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      data: {
        amount: amountPaise,
        currency: 'INR',
        receipt: shortReceipt, // ✅ Fixed
        notes: {
          lead_id: lead._id.toString(),
          seller_id: req.user._id.toString(),
          purchase_id: purchase._id.toString()
        }
      },
      timeout: 10000
    });

    console.log("✅ Razorpay order created via Axios:", response.data.id);
    const razorpayOrder = response.data;

    orderDetails = {
      id: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      key: keyId,
      name: "Lead Purchase",
      description: `Purchase lead for ${lead.product}`,
      handler: "/api/leads/webhook/razorpay",
      prefill: { name: req.user.name, email: req.user.email }
    };
  } catch (rzError) {
    const errorDetails = {
      message: rzError.message,
      status: rzError.response?.status,
      data: rzError.response?.data || 'Empty body (possible geo-restriction)',
      code: rzError.code,
      stack: rzError.stack?.substring(0, 200)
    };
    if (rzError.response?.status === 406 || rzError.response?.status === 403) {
      errorDetails.geoHint = 'Razorpay geo-restriction (India-only). Use PayPal or India-based server for testing.';
    }
    console.error("❌ Full Razorpay Axios error:", errorDetails);
    orderError = rzError;
  }

    } else if (payment_method === "paypal") {
      try {
        orderDetails = await createPayPalOrder(lead, purchase);
      } catch (ppError) {
        console.error("❌ PayPal order failed:", ppError.response?.data || ppError.message);
        orderError = ppError;
      }
    }

    if (orderError) {
      purchase.payment_status = "failed";
      const errMsg = orderError?.response?.data ? JSON.stringify(orderError.response.data) : (orderError.message || String(orderError));
      purchase.payment_response = { error: errMsg };
      await purchase.save();

      const safeMessage = orderError?.response?.data?.description || orderError.message || "Unknown payment provider error";
      console.error("❌ Finalized orderError (sanitized):", safeMessage);

      return res.status(500).json({
        message: "Failed to create purchase",
        error: `Payment order creation failed: ${safeMessage}`
      });
    }

    purchase.payment_id = orderDetails.id;
    await purchase.save();

    res.json({
      message: `${payment_method.toUpperCase()} order created successfully.`,
      purchase: purchase._id,
      order: orderDetails
    });
  } catch (error) {
    console.error("❌ Error in buyLead:", {
      err: error,
      message: error?.message
    });
    res.status(500).json({
      message: "Failed to create purchase",
      error: error.message || String(error)
    });
  }
};

// ── SELLER: Get My Purchased Leads ────────────────────────
exports.getMyPurchasedLeads = async (req, res) => {
  try {
    if (req.user.role !== "seller") {
      return res.status(403).json({ message: "Sellers only" });
    }

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

// ── ADMIN: Verify Payment & Create Chat (UPDATED: For manual only; integrated uses webhooks) ──
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
      return res.status(404).json({ message: "Purchase not found" });
    }

    if (purchase.payment_mode !== "manual") {
      return res.status(400).json({ message: "Only manual payments can be verified here. Integrated payments are auto-verified via webhooks." });
    }

    if (purchase.payment_status === "approved") {
      return res.status(400).json({ message: "Payment already approved" });
    }

    purchase.payment_status = "approved";
    purchase.approved_by = req.user._id;
    purchase.approved_at = new Date();
    await purchase.save();

    const lead = purchase.lead;
    lead.sold_count += 1;
    if (lead.sold_count >= lead.max_sellers) {
      lead.status = "sold";
    }
    await lead.save();

    let conversation = await Conversation.findOne({
      participants: { $all: [lead.buyer._id, purchase.seller._id] }
    });

    if (!conversation) {
      conversation = new Conversation({
        buyer: lead.buyer._id,
        seller: purchase.seller._id,
        participants: [lead.buyer._id, purchase.seller._id],
        lead: lead._id
      });
      await conversation.save();
    }

    const systemMessage = new Message({
      conversation: conversation._id,
      sender: req.user._id,
      type: "system",
      text: `🎉 Lead purchase verified! Seller ${purchase.seller.name} has purchased your lead for ${lead.product}. You can now communicate directly.`
    });
    await systemMessage.save();

    if (lead.allow_sellers_contact) {
      const contactMessage = new Message({
        conversation: conversation._id,
        sender: req.user._id,
        type: "system",
        text: `📞 Buyer Contact Details:\nName: ${lead.buyer.name}\nPhone: ${lead.buyer_contact_phone}\nEmail: ${lead.buyer_contact_email}`
      });
      await contactMessage.save();
    }

    res.json({
      message: "Payment verified successfully! Chat created between buyer and seller.",
      conversation_id: conversation._id,
      contact_shared: lead.allow_sellers_contact
    });
  } catch (error) {
    console.error("❌ Error in verifyPayment:", error);
    res.status(500).json({ message: "Failed to verify payment", error: error.message });
  }
};

// ── ADMIN: Get Pending Payments ───────────────────────────
exports.getPendingPayments = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Admin access required" });
    }

    const { page = 1, limit = 10 } = req.query;

    const pendingPayments = await LeadPurchase.find({ payment_status: "pending" })
      .populate({
        path: "lead",
        populate: [{ path: "buyer", select: "name email" }]
      })
      .populate("seller", "name email phone")
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await LeadPurchase.countDocuments({ payment_status: "pending" });

    res.json({
      payments: pendingPayments,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error("❌ Error in getPendingPayments:", error);
    res.status(500).json({ message: "Failed to fetch pending payments", error: error.message });
  }
};

// ── ADMIN: Revenue Analytics ─────────────────────────────
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
          leadsSold: { $sum: 1 }
        }
      }
    ]);

    res.json(stats[0] || { totalRevenue: 0, leadsSold: 0 });
  } catch (error) {
    console.error("❌ Error in getLeadAnalytics:", error);
    res.status(500).json({ message: "Failed to fetch analytics", error: error.message });
  }
};

// ── WEBHOOK: Razorpay Payment Verification ────────────────
exports.webhookRazorpay = async (req, res) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || "";
    const body = req.body;
    const receivedSignature = req.headers["x-razorpay-signature"];

    console.log("🔔 Razorpay webhook received. headers:", {
      signature: !!receivedSignature,
      webhookSecretPresent: !!webhookSecret
    });

    if (!webhookSecret) {
      console.warn("⚠️ RAZORPAY_WEBHOOK_SECRET missing from env. Skipping signature validation (not recommended).");
    }

    if (webhookSecret) {
      let expectedSignature;
      try {
        expectedSignature = crypto
          .createHmac("sha256", webhookSecret)
          .update(body)
          .digest("hex");
      } catch (sigErr) {
        console.error("❌ Error computing expected signature:", sigErr);
        return res.status(400).send("Signature computation error");
      }

      if (receivedSignature !== expectedSignature) {
        console.log("❌ Invalid webhook signature", { receivedSignature, expectedSignature });
        return res.status(400).send("Invalid signature");
      }
    }

    let data;
    try {
      data = typeof body === "string" ? JSON.parse(body) : body;
    } catch (parseErr) {
      console.error("❌ Failed to parse webhook body:", parseErr);
      return res.status(400).send("Invalid payload");
    }

    const event = data.event;
    const paymentEntity = data.payload?.payment?.entity;

    if (event === "payment.captured") {
      const paymentId = paymentEntity.id;

      const purchase = await LeadPurchase.findOne({
        payment_id: paymentId,
        payment_status: "pending",
        payment_mode: "razorpay"
      }).populate({
        path: "lead",
        populate: { path: "buyer", select: "name" }
      }).populate("seller", "name");

      if (!purchase) {
        console.warn("⚠️ Purchase not found for payment ID:", paymentId);
        return res.status(404).json({ message: "Purchase not found" });
      }

      purchase.payment_status = "approved";
      purchase.payment_response = paymentEntity;
      purchase.approved_at = new Date();
      await purchase.save();

      const lead = purchase.lead;
      lead.sold_count += 1;
      if (lead.sold_count >= lead.max_sellers) {
        lead.status = "sold";
      }
      await lead.save();

      console.log("✅ DB updates complete, starting chat...");
      try {
        let conversation = await Conversation.findOne({
          participants: { $all: [lead.buyer._id, purchase.seller._id] }
        });

        if (!conversation) {
          conversation = new Conversation({
            buyer: lead.buyer._id,
            seller: purchase.seller._id,
            participants: [lead.buyer._id, purchase.seller._id],
            lead: lead._id
          });
          await conversation.save();
          console.log("✅ Conversation created:", conversation._id);
        }

        await new Message({
          conversation: conversation._id,
          sender: null,
          type: "system",
          text: `🎉 Lead purchase successful via Razorpay! Seller ${purchase.seller.name} has purchased the lead.`
        }).save();
        console.log("✅ System message saved");

        if (lead.allow_sellers_contact) {
          await new Message({
            conversation: conversation._id,
            sender: null,
            type: "system",
            text: `📞 Buyer Contact:\nName: ${lead.buyer.name}\nPhone: ${lead.buyer_contact_phone}\nEmail: ${lead.buyer_contact_email}`
          }).save();
          console.log("✅ Contact message saved");
        }
      } catch (chatError) {
        console.error("❌ Chat creation failed (non-critical):", chatError.message);
      }

      console.log("✅ Razorpay payment captured:", paymentId);
    }

    if (event === "payment.failed") {
      const paymentId = paymentEntity.id;

      const purchase = await LeadPurchase.findOne({ payment_id: paymentId });

      if (purchase) {
        purchase.payment_status = "failed";
        purchase.payment_response = paymentEntity;
        await purchase.save();
      }

      console.log("❌ Razorpay payment failed:", paymentId);
    }

    return res.status(200).send("OK");
  } catch (error) {
    console.error("❌ Error in Razorpay webhook:", error);
    return res.status(500).send("Server error");
  }
};

// ── WEBHOOK: PayPal Payment Verification ──────────────────
exports.webhookPayPal = async (req, res) => {
  try {
    const event = req.body;
    console.log("🔄 Incoming PayPal webhook event:", JSON.stringify(event, null, 2));

    console.log("✅ Verification skipped for test; proceeding to handle event");

    if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
      const capture = event.resource;
      const customId = capture.custom_id;

      const parts = customId.split("_");
      if (parts.length < 6) {
        return res.status(400).json({ message: "Invalid custom_id format" });
      }

      const purchaseId = parts[5];
      const purchase = await LeadPurchase.findById(purchaseId)
        .populate({
          path: "lead",
          populate: { path: "buyer", select: "name" }
        })
        .populate("seller", "name");

      if (!purchase || purchase.payment_mode !== "paypal" || purchase.payment_status !== "pending") {
        return res.status(400).json({ message: "Invalid or already processed purchase" });
      }

      purchase.payment_status = "approved";
      purchase.payment_id = capture.id;
      purchase.payment_response = event;
      purchase.approved_at = new Date();
      await purchase.save();

      const lead = purchase.lead;
      lead.sold_count += 1;
      if (lead.sold_count >= lead.max_sellers) {
        lead.status = "sold";
      }
      await lead.save();

      console.log("✅ DB updates complete, starting chat...");
      try {
        let conversation = await Conversation.findOne({
          participants: { $all: [lead.buyer._id, purchase.seller._id] }
        });

        if (!conversation) {
          conversation = new Conversation({
            buyer: lead.buyer._id,
            seller: purchase.seller._id,
            participants: [lead.buyer._id, purchase.seller._id],
            lead: lead._id
          });
          await conversation.save();
          console.log("✅ Conversation created:", conversation._id);
        }

        const systemMessage = new Message({
          conversation: conversation._id,
          sender: null,
          type: "system",
          text: `Lead purchase successful via PayPal! Seller ${purchase.seller.name} has purchased your lead for ${lead.product}.`
        });
        await systemMessage.save();
        console.log("✅ System message saved");

        if (lead.allow_sellers_contact) {
          const contactMessage = new Message({
            conversation: conversation._id,
            sender: null,
            type: "system",
            text: `Buyer Contact:\nName: ${lead.buyer.name}\nPhone: ${lead.buyer_contact_phone}\nEmail: ${lead.buyer_contact_email}`
          });
          await contactMessage.save();
          console.log("✅ Contact message saved");
        }
      } catch (chatError) {
        console.error("❌ Chat creation failed (non-critical):", chatError.message);
      }

      console.log("PayPal payment verified:", capture.id);
    } else if (event.event_type === "PAYMENT.CAPTURE.DENIED") {
      const capture = event.resource;
      const customId = capture.custom_id;

      const parts = customId.split("_");
      if (parts.length < 6) {
        console.log("Invalid custom_id for denied event, skipping");
      } else {
        const purchaseId = parts[5];
        const purchase = await LeadPurchase.findById(purchaseId);

        if (purchase && purchase.payment_mode === "paypal") {
          purchase.payment_status = "failed";
          purchase.payment_response = event;
          await purchase.save();
          console.log("PayPal payment denied:", capture.id);
        }
      }
    }

    res.status(200).json({ message: "Webhook processed" });
  } catch (error) {
    console.error("Error in webhookPayPal:", error.message);
    res.status(500).json({ message: "Webhook processing failed" });
  }
};