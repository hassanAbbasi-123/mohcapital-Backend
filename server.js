const express = require("express");
const http = require("http");
const path = require("path");
const cors = require("cors");
require("dotenv").config();
const connectDB = require("./config/db");
const indexRoutes = require("./routes/indexRoutes");
const { initSocket } = require("./socket");

// Connect to MongoDB
connectDB();

const app = express();
const server = http.createServer(app);

// ✅ Enable CORS
app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);

// Middleware
app.use(express.json());

// ✅ FIXED: Serve static files from multiple directories
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Serve specific subdirectories explicitly
app.use("/uploads/leads/payment-proofs", express.static(path.join(__dirname, "uploads/leads/payment-proofs")));
app.use("/uploads/auth", express.static(path.join(__dirname, "uploads/auth")));
app.use("/uploads/products", express.static(path.join(__dirname, "uploads/products")));
app.use("/uploads/profile", express.static(path.join(__dirname, "uploads/profile")));
app.use("/uploads/banners", express.static(path.join(__dirname, "uploads/banners")));
app.use("/uploads/brands", express.static(path.join(__dirname, "uploads/brands")));

// Add a route to debug file access
app.get("/debug/files", (req, res) => {
  const fs = require("fs");
  const leadsPath = path.join(__dirname, "uploads/leads/payment-proofs");
  
  try {
    const files = fs.readdirSync(leadsPath);
    const fileDetails = files.map(file => {
      const filePath = path.join(leadsPath, file);
      const stats = fs.statSync(filePath);
      return {
        name: file,
        path: `/uploads/leads/payment-proofs/${file}`,
        size: stats.size,
        created: stats.birthtime
      };
    });
    
    res.json({
      success: true,
      directory: leadsPath,
      files: fileDetails
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      path: leadsPath
    });
  }
});

// Routes
app.use("/", indexRoutes);

// Initialize Socket.IO
initSocket(server);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server started on port ${PORT}`);
  console.log(`📁 Static files served from: ${path.join(__dirname, "uploads")}`);
});