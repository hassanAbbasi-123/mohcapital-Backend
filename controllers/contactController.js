                const Contact = require('../models/contactModel');

                // Create contact submission
                exports.createContact = async (req, res) => {
                try {
                    const { name, email, subject, message } = req.body;

                    if (!name || !email || !subject || !message) {
                    return res.status(400).json({ error: 'All fields are required' });
                    }

                    const contact = new Contact({
                    name,
                    email,
                    subject,
                    message,
                    });

                    await contact.save();

                    res.json({
                    success: true,
                    message: 'Contact message submitted successfully',
                    contactId: contact._id,
                    });
                } catch (error) {
                    console.error('Contact submission error:', error);
                    res.status(500).json({ error: 'Failed to submit contact message' });
                }
                };

                // Admin: get all contacts (optional, if needed)
                exports.getAllContacts = async (req, res) => {
                try {
                    const contacts = await Contact.find({}).sort({ createdAt: -1 });
                    res.json(contacts);
                } catch (error) {
                    console.error('Get contacts error:', error);
                    res.status(500).json({ error: 'Failed to fetch contacts' });
                }
                };