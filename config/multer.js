const multer = require("multer");
const path = require("path");
const cloudinary = require("./cloudinary");
const streamifier = require("streamifier");

// === Helper to determine Cloudinary folder (preserve all original paths) ===
const getCloudinaryFolder = (req, file) => {
  let folder = "others";

  // LEADS - For payment proofs
  if (req.baseUrl.includes("/leads")) {
    if (file.fieldname === "payment_proof") folder = "leads/payment-proofs";
    else folder = "leads";
  }

  // AUTH
  else if (req.baseUrl.includes("/auth")) {
    if (file.fieldname === "logo") folder = "auth/logos";
    else if (file.fieldname === "documents") folder = "auth/documents";
    else folder = "auth";
  }

  // BRANDS
  else if (req.baseUrl.includes("/brands")) {
    if (req.path.includes("/seller")) folder = "brands/sellerBrands";
    else if (req.path.includes("/admin")) folder = "brands/adminBrands";
  }

  // BANNERS
  else if (req.baseUrl.includes("/banners")) {
    folder = "banners/images";
  }

  // PRODUCTS
  else if (req.baseUrl.includes("/products")) {
    if (file.fieldname === "image") folder = "products/images";
    else if (file.fieldname === "gallery") folder = "products/gallery";
    else folder = "products";
  }

  // PROFILE
  else if (req.baseUrl.includes("/profile")) {
    if (file.fieldname === "logo") folder = "profile/logos";
    else if (file.fieldname === "documents") folder = "profile/documents";
    else if (file.fieldname === "profilePicture") folder = "profile/pictures";
    else folder = "profile";
  }

  // FALLBACK
  else {
    if (file.fieldname === "logo" && file.mimetype.startsWith("image")) folder = "others/images";
    else if (file.fieldname === "documents") folder = "others/documents";
    else if (file.fieldname === "image") folder = "others/images";
    else if (file.fieldname === "gallery") folder = "others/gallery";
    else if (file.fieldname === "payment_proof") folder = "leads/payment-proofs";
  }

  return folder;
};

// === Multer memory storage (we'll upload buffer to Cloudinary) ===
const storage = multer.memoryStorage();

// === File filter (same as original) ===
const fileFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|gif|pdf|mp4|csv|doc|docx/;
  const ext = path.extname(file.originalname).toLowerCase();

  console.log("📁 File upload attempt:", {
    fieldname: file.fieldname,
    originalname: file.originalname,
    mimetype: file.mimetype,
    extension: ext
  });

  if (allowed.test(ext) && allowed.test(file.mimetype)) {
    cb(null, true);
  } else {
    console.error("❌ Invalid file type:", { ext, mimetype: file.mimetype });
    cb(new Error("Invalid file type. Only JPEG, PNG, GIF, PDF, MP4, CSV, DOC, DOCX are allowed."));
  }
};

// === Multer instance ===
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter
});

// === Helper to upload a single file to Cloudinary ===
const uploadToCloudinary = (file, req) => {
  return new Promise((resolve, reject) => {
    const folder = getCloudinaryFolder(req, file);
    const public_id = `${file.fieldname}-${Date.now()}`;

    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "auto", public_id },
      (error, result) => {
        if (result) resolve(result);
        else reject(error);
      }
    );

    streamifier.createReadStream(file.buffer).pipe(stream);
  });
};

// === Specialized Uploads ===
const productUpload = upload.fields([
  { name: "image", maxCount: 1 },
  { name: "gallery", maxCount: 10 }
]);

const profileUpload = upload.fields([
  { name: "logo", maxCount: 1 },
  { name: "documents", maxCount: 5 },
  { name: "profilePicture", maxCount: 1 }
]);

const profilePictureUpload = upload.single("profilePicture");

const authUpload = upload.fields([
  { name: "logo", maxCount: 1 },
  { name: "documents", maxCount: 5 }
]);

const paymentProofUpload = upload.single("payment_proof");

// === Exports ===
module.exports = upload;
module.exports.upload = upload;
module.exports.productUpload = productUpload;
module.exports.profileUpload = profileUpload;
module.exports.profilePictureUpload = profilePictureUpload;
module.exports.authUpload = authUpload;
module.exports.paymentProofUpload = paymentProofUpload;
module.exports.uploadToCloudinary = uploadToCloudinary;
