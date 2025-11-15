const express = require("express");
const router = express.Router();
const leadController = require("../controllers/leadController");
const { protect, isAdmin, isSeller } = require("../middleware/authMiddleware");
const axios = require("axios");
// Apply JWT authentication to ALL lead routes
router.use(protect);

// ── BUYER ROUTES ──────────────────────────────────────────
router.post("/user/create", leadController.createLead);
router.get("/user/my-leads", leadController.getMyLeads);

// ── ADMIN ROUTES ──────────────────────────────────────────
router.get("/admin/pending", isAdmin, leadController.getPendingLeads);
router.get("/admin/all", isAdmin, leadController.getAllLeads);
router.put("/admin/approve/:leadId", isAdmin, leadController.approveLead);
router.get("/admin/analytics", isAdmin, leadController.getLeadAnalytics);
router.get("/admin/pending-payments", isAdmin, leadController.getPendingPayments);
router.put("/admin/verify-payment/:purchaseId", isAdmin, leadController.verifyPayment);

// ── SELLER ROUTES ─────────────────────────────────────────
router.get("/seller/available", isSeller, leadController.getAvailableLeads);
router.post("/seller/buy/:leadId", isSeller, leadController.buyLead);
router.get("/seller/purchased", isSeller, leadController.getMyPurchasedLeads);

// ── WEBHOOK ROUTES (No auth needed for webhooks) ───────────
router.post("/webhook/razorpay",express.raw({ type: "application/json" }), leadController.webhookRazorpay);  // NEW
router.post("/webhook/paypal", leadController.webhookPayPal);      // NEW




router.get("/test-razorpay", async (req, res) => {
  try {
    const r = await axios.get("https://api.razorpay.com/v1/checkout/public");
    return res.json({ ok: true, msg: "Razorpay reachable" });
  } catch (e) {
    return res.json({
      ok: false,
      msg: "Cannot reach Razorpay from this server",
      error: e.message
    });
  }
});


module.exports = router;