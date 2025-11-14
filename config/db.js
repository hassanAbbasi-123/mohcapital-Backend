require ("dotenv").config();
const mongoose = require("mongoose");
const MONGO_URI = process.env.MONGO_URI;

const connectDB = async () => {
  try {
    await mongoose.connect(MONGO_URI);

    console.log("Connected to the database");
  } catch (err) {
    console.error("Database connection error:", err);
    process.exit(1); // Exit the process with failure
  }
};
module.exports = connectDB;