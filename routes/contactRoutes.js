const express = require('express');
const router = express.Router();
const {
  createContact,
  getAllContacts,
} = require('../controllers/contactController');
const { isAdmin } = require("../middleware/authMiddleware");

// Submit contact form
router.post('/create', createContact);

// Admin route - get all contacts
router.get('/admin/get-all', getAllContacts);

module.exports = router;