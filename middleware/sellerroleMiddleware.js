// const userModel = require("../models/userModel");

// // ✅ Middleware to check role

// function checkSellerRole(req, res, next) {
//   if (!req.userModel || req.userModel.role !== "seller") {
//     return res.status(403).json({ message: "Access denied. Only sellers can perform this action." });
//   }
//   next();
// }