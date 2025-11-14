// scripts/migrate-seller-profile.js
const mongoose = require("mongoose");
const User = require("../models/userModel");
const SellerProfile = require("../models/sellerProfile");

// --- CONFIG ---
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/your_db_name";

async function runMigration() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("Connected!");

    let migratedCount = 0;
    let skippedCount = 0;

    const cursor = SellerProfile.find().cursor();

    for await (const sp of cursor) {
      const updateResult = await User.updateOne(
        { _id: sp.user },
        {
          $set: {
            role: "seller",
            seller: {
              storeName: sp.storeName,
              logo: sp.logo,
              gstin: sp.gstin,
              businessType: sp.businessType,
              city: sp.location?.city,
              state: sp.location?.state,
              kycStatus:
                sp.kyc?.status === "submitted"
                  ? "pending"
                  : sp.kyc?.status || "pending",
              documents: sp.kyc?.documents?.map((d) => d.url) || [],
              verifiedAt: sp.kyc?.verifiedAt,
            },
          },
        }
      );

      if (updateResult.modifiedCount > 0) {
        migratedCount++;
        console.log(`Migrated: ${sp.storeName} (User ID: ${sp.user})`);
      } else {
        skippedCount++;
        console.log(`Skipped (no change): ${sp.storeName}`);
      }
    }

    console.log("\nMigration Complete!");
    console.log(`Migrated: ${migratedCount}`);
    console.log(`Skipped: ${skippedCount}`);

    // Optional: Drop old collection after verifying
    // await SellerProfile.collection.drop();
    // console.log("Dropped SellerProfile collection");

  } catch (error) {
    console.error("Migration failed:", error);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
  }
}

runMigration();