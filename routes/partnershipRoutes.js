const express = require('express');
const router = express.Router();
const {
  createPartnershipInquiry,
  getAllPartnerships,
  createMeetingRequest,
  getAllMeetings,
} = require('../controllers/partnershipController');
// Critical: Parse JSON bodies for all routes in this router
router.use(express.json()); // This ensures req.body is parsed

// Public routes
router.post('/create-partnership-inquiry', createPartnershipInquiry);
router.post('/create-meeting-request', createMeetingRequest);

// Protected admin routes
router.get('/admin/get-all-partnerships', getAllPartnerships);
router.get('/admin/get-all-meetings', getAllMeetings);

module.exports = router;