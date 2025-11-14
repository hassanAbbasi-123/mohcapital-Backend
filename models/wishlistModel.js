const mongoose = require("mongoose");

const wishlistSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    products: [
      {
        product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
        seller: { type: mongoose.Schema.Types.ObjectId, ref: "SellerProfile"}, 
        addedAt: { type: Date, default: Date.now },
        status: { type: String, enum: ["active", "removed"], default: "active" }
      }
    ]
  },
  { timestamps: true },
);

module.exports = mongoose.model("Wishlist", wishlistSchema);
