// utils/sendEmail.js (NEW FILE - Nodemailer setup from scratch)
const nodemailer = require("nodemailer");

// Create transporter using SMTP (works with Gmail, Brevo, SendGrid, etc. - configure via .env)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false, // true for port 465, false for 587 (STARTTLS)
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Reusable send email function
const sendEmail = async (to, subject, text, html = null) => {
  const mailOptions = {
    from: process.env.FROM_EMAIL || `"Moh-Capital Overseas" <${process.env.SMTP_USER}>`,
    to,
    subject,
    text,
  };

  if (html) {
    mailOptions.html = html;
  }

  await transporter.sendMail(mailOptions);
};

module.exports = sendEmail;