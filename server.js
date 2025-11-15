const express = require("express");
const http = require("http"); // needed for Socket.IO
const path = require("path");
const cors = require("cors"); // ✅ add this
require("dotenv").config();
const connectDB = require("./config/db");
const indexRoutes = require("./routes/indexRoutes");
const { initSocket } = require("./socket");

// Connect to MongoDB
connectDB();

const app = express();
const server = http.createServer(app); // HTTP server wrapped for Socket.IO
app.get("/test-razorpay", async (req, res) => {
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
// ✅ Enable CORS (allow frontend http://localhost:3000)
app.use(
  cors({
    origin: "http://localhost:3000", // your Next.js frontend
    credentials: true, // if you want to allow cookies/auth headers
  })
);

// Middleware
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Routes
app.use("/", indexRoutes);

// Initialize Socket.IO
initSocket(server);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server started on port ${PORT}`));
