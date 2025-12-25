const nodemailer = require("nodemailer");

// Create transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: Number(process.env.SMTP_PORT) === 465, // auto-handle 465 vs 587
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: {
    rejectUnauthorized: false, // IMPORTANT for Render / cloud TLS
  },
});

// Verify SMTP connection on server start
transporter.verify((err, success) => {
  if (err) {
    console.error("❌ SMTP CONFIG ERROR:", err);
  } else {
    console.log("✅ SMTP READY");
  }
});

// Reusable send email function
const sendEmail = async (to, subject, text, html = null) => {
  try {
    await transporter.sendMail({
      from: `Moh-Capital Overseas <${process.env.FROM_EMAIL || process.env.SMTP_USER}>`,
      to,
      subject,
      text,
      ...(html && { html }),
    });
  } catch (error) {
    console.error("❌ EMAIL SEND ERROR:", error);
    throw error; // let route decide whether to fail or ignore
  }
};

module.exports = sendEmail;
