// utils/sendEmail.js (Updated for Resend API - No SMTP needed)
const { Resend } = require('resend');

// Initialize Resend with your API key from environment variable
const resend = new Resend(process.env.RESEND_API_KEY);

// Reusable send email function (signature unchanged - works with your existing calls)
const sendEmail = async (to, subject, text, html = null) => {
  // Use Resend's shared onboarding address for instant testing (no domain verification required)
  // Later: Verify your own domain in Resend dashboard and change to e.g. "Moh-Capital Overseas <noreply@yourdomain.com>"
  const from = process.env.FROM_EMAIL || 'Moh-Capital Overseas <onboarding@resend.dev>';

  const emailData = {
    from,
    to,          // String for single recipient, or array for multiple
    subject,
    text,        // Plain text version (required by most providers)
  };

  if (html) {
    emailData.html = html; // HTML version if provided
  }

  // Send the email
  const { data, error } = await resend.emails.send(emailData);

  if (error) {
    console.error('Resend email error:', error);
    throw new Error(error.message || 'Failed to send email');
  }

  // Optional: Log success for debugging
  console.log('Email sent successfully:', data.id);
  return data;
};

module.exports = sendEmail;