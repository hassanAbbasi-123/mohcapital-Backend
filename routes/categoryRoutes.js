const express = require("express");
const router = express.Router();

const {
    categoryController
} = require("../controllers/indexController");

const { protect, isAdmin, isSeller ,optionalAuth} = require("../middleware/authMiddleware");

// ================== 📌 PUBLIC ROUTES ==================
router.get("/user/get-all-cat",optionalAuth, categoryController.getAllCategories);
router.get("/user/get-cat-by-id/:idOrSlug", categoryController.getCategoryByIdOrSlug);
router.get("/user/subcategories/get-by-sub-cat/:parentId", categoryController.getSubcategories);
router.get("/get-all-categories", categoryController.getAllCategories);
// ================== 📌 SELLER ROUTES ==================
router.post("/seller/create-cat",  isSeller, categoryController.createCategory);
router.put("/seller/update-cat/:id", protect, isSeller, categoryController.updateOwnCategory);
router.delete("/seller/delete-cat/:id", protect, isSeller, categoryController.deleteOwnCategory);
router.get("/seller/get-all-categories-with-sub", protect, isSeller, categoryController.getAllCategoriesWithSubForSeller);


// ================== 📌 ADMIN ROUTES ==================
router.post("/admin/create-cat", protect, isAdmin, categoryController.createCategory);
router.patch("/admin/toggle-cat/:id", protect, isAdmin, categoryController.toggleCategoryStatus);
router.put("/admin/update-cat/:id", protect, isAdmin, categoryController.updateCategory);
router.delete("/admin/delete-cat/:id", protect, isAdmin, categoryController.deleteCategory);
router.get("/admin/get-all-categories", protect, isAdmin, categoryController.getAllCategoriesAdmin);

module.exports = router;
