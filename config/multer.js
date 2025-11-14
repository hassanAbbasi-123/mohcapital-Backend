// config/multer.js
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Ensure directory
const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const base = "uploads";
    let folder = `${base}/others`;

    // AUTH
    if (req.baseUrl.includes("/auth")) {
      if (file.fieldname === "logo") folder = `${base}/auth/logos`;
      else if (file.fieldname === "documents") folder = `${base}/auth/documents`;
      else folder = `${base}/auth`;
    }

    // BRANDS
    else if (req.baseUrl.includes("/brands")) {
      if (req.path.includes("/seller")) folder = `${base}/brands/sellerBrands`;
      else if (req.path.includes("/admin")) folder = `${base}/brands/adminBrands`;
    }

    // BANNERS
    else if (req.baseUrl.includes("/banners")) {
      folder = `${base}/banners`;
    }

    // PRODUCTS
    else if (req.baseUrl.includes("/products")) {
      if (file.fieldname === "image") folder = `${base}/products/images`;
      else if (file.fieldname === "gallery") folder = `${base}/products/gallery`;
      else folder = `${base}/products`;
    }

    // PROFILE
    else if (req.baseUrl.includes("/profile")) {
      if (file.fieldname === "logo") folder = `${base}/profile/logos`;
      else if (file.fieldname === "documents") folder = `${base}/profile/documents`;
      else if (file.fieldname === "profilePicture") folder = `${base}/profile/pictures`;
      else folder = `${base}/profile`;
    }

    // FALLBACK
    else {
      if (file.fieldname === "logo" && file.mimetype.startsWith("image")) {
        folder = `${base}/others/images`;
      } else if (file.fieldname === "documents") {
        folder = `${base}/others/documents`;
      } else if (file.fieldname === "image") {
        folder = `${base}/others/images`;
      } else if (file.fieldname === "gallery") {
        folder = `${base}/others/gallery`;
      }
    }

    ensureDir(folder);
    cb(null, folder);
  },

  filename: (req, file, cb) => {
    cb(null, `${file.fieldname}-${Date.now()}${path.extname(file.originalname)}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|gif|pdf|mp4|csv|doc|docx/;
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.test(ext) && allowed.test(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Invalid file type"));
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter
});

// === SPECIALIZED UPLOADS ===
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

// NEW: For auth register
const authUpload = upload.fields([
  { name: "logo", maxCount: 1 },
  { name: "documents", maxCount: 5 }
]);

// === EXPORTS ===
// Keep old way (for brandRoutes, etc.)
module.exports = upload;
module.exports.upload = upload;

// Named exports (new)
module.exports.productUpload = productUpload;
module.exports.profileUpload = profileUpload;
module.exports.profilePictureUpload = profilePictureUpload;
module.exports.authUpload = authUpload;