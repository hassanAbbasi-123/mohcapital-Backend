const express = require("express");
const router = express.Router();
const leadController = require("../controllers/leadController");
const { protect, isAdmin, isSeller } = require("../middleware/authMiddleware");
const { paymentProofUpload } = require("../config/multer");

// Apply JWT authentication to ALL lead routes except webhook
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
router.put("/admin/reject-payment/:purchaseId", isAdmin, leadController.rejectPayment);

// ── SELLER ROUTES ─────────────────────────────────────────
router.get("/seller/available", isSeller, leadController.getAvailableLeads);
router.post("/seller/razorpay-order/:leadId", isSeller, leadController.createRazorpayOrder);
router.post("/seller/buy/:leadId", isSeller, leadController.buyLead);
router.get("/seller/purchased", isSeller, leadController.getMyPurchasedLeads);
router.get("/seller/payment-status/:purchaseId", isSeller, leadController.getPaymentStatus);
router.post("/seller/verify-razorpay", isSeller, leadController.verifyRazorpayPayment);

// ── SIMPLIFIED MANUAL PAYMENT ROUTES ──────────────────────
router.post("/seller/upload-payment-screenshot/:purchaseId", 
  isSeller,
  (req, res, next) => {
    console.log("📤 Payment proof upload middleware called");
    console.log("📤 Content-Type:", req.headers['content-type']);
    console.log("📤 Headers:", JSON.stringify(req.headers));
    
    paymentProofUpload(req, res, (err) => {
      if (err) {
        console.error("❌ Multer error:", {
          message: err.message,
          code: err.code,
          field: err.field
        });
        
        // Send more specific error messages
        let errorMessage = "File upload failed";
        if (err.code === "LIMIT_FILE_SIZE") {
          errorMessage = "File size too large. Maximum size is 10MB.";
        } else if (err.message === "Invalid file type") {
          errorMessage = "Invalid file type. Only JPEG, PNG, GIF, PDF, MP4, CSV, DOC, DOCX are allowed.";
        } else if (err.message === "Unexpected field") {
          errorMessage = "Invalid field name. Make sure the file field is named 'payment_proof'.";
        }
        
        return res.status(400).json({ 
          success: false, 
          message: errorMessage,
          details: err.message 
        });
      }
      
      console.log("✅ Multer processed successfully");
      console.log("📁 File:", req.file ? {
        originalname: req.file.originalname,
        filename: req.file.filename,
        size: req.file.size,
        mimetype: req.file.mimetype
      } : "No file");
      
      next();
    });
  },
  leadController.uploadPaymentProof
);

// ── PAYMENT WEBHOOK (No auth) ─────────────────────────────
router.post("/payment-webhook", leadController.paymentWebhook);

module.exports = router;