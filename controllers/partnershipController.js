const Partnership = require('../models/partnershipModel');
const Meeting = require('../models/meetingModel');

exports.createPartnershipInquiry = async (req, res) => {
  try {
    const { name, email, phone, company, message } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    const inquiry = new Partnership({
      name,
      email,
      phone,
      company,
      message,
    });

    await inquiry.save();

    res.json({
      success: true,
      message: 'Partnership inquiry submitted successfully',
      inquiryId: inquiry._id,
    });
  } catch (error) {
    console.error('Partnership inquiry error:', error);
    res.status(500).json({
      error: 'Failed to submit inquiry',
      details: error.message,
    });
  }
};

exports.createMeetingRequest = async (req, res) => {
  try {
    const { name, email, phone, company, preferredDate, preferredTime, message } = req.body;

    if (!name || !email || !preferredDate || !preferredTime) {
      return res.status(400).json({
        error: 'Name, email, preferred date, and preferred time are required',
      });
    }

    // Validate date format (basic check)
    if (isNaN(Date.parse(preferredDate))) {
      return res.status(400).json({ error: 'Invalid date format' });
    }

    const meeting = new Meeting({
      name,
      email,
      phone,
      company,
      preferredDate: new Date(preferredDate), // Stored as Date object
      preferredTime,
      message,
    });

    await meeting.save();

    res.json({
      success: true,
      message: 'Meeting request submitted successfully',
      meetingId: meeting._id,
    });
  } catch (error) {
    console.error('Meeting request error:', error);
    res.status(500).json({
      error: 'Failed to submit meeting request',
      details: error.message,
    });
  }
};

exports.getAllPartnerships = async (req, res) => {
  try {
    const partnerships = await Partnership.find({}).sort({ createdAt: -1 });
    res.json(partnerships);
  } catch (error) {
    console.error('Get partnerships error:', error);
    res.status(500).json({ error: 'Failed to fetch partnerships' });
  }
};

exports.getAllMeetings = async (req, res) => {
  try {
    const meetings = await Meeting.find({}).sort({ createdAt: -1 });
    res.json(meetings);
  } catch (error) {
    console.error('Get meetings error:', error);
    res.status(500).json({ error: 'Failed to fetch meetings' });
  }
};