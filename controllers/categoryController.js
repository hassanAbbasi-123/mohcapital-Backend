// controllers/categoryController.js
const Category = require("../models/categoryModel");
const Product = require("../models/productModel");
const slugify = require("slugify");


// ================== 📌 PUBLIC CONTROLLERS ==================

// @desc Get all active categories
// @route GET /api/categories
// @access Public
exports.getAllCategories = async (req, res) => {
  try {
    const categories = await Category.find({ isActive: true })
      .populate("parentCategory", "name slug")
      .sort({ createdAt: -1 });
    res.json(categories);
  } catch (error) {
    res.status(500).json({ message: "Error fetching categories", error: error.message });
  }
};

// @desc Get single category by ID or Slug
// @route GET /api/categories/:idOrSlug
// @access Public

exports.getCategoryByIdOrSlug = async (req, res) => {
  try {
    const { idOrSlug } = req.params;

    let category;
    if (idOrSlug.match(/^[0-9a-fA-F]{24}$/)) {
      category = await Category.findOne({ _id: idOrSlug, isActive: true });
    } else {
      category = await Category.findOne({ slug: idOrSlug, isActive: true });
    }

    if (!category) return res.status(404).json({ message: "Category not found" });

    res.json(category);
  } catch (error) {
    res.status(500).json({ message: "Error fetching category", error: error.message });
  }
};

// @desc Get subcategories of a category
// @route GET /api/categories/:parentId/subcategories
// @access Public
exports.getSubcategories = async (req, res) => {
  try {
    const { parentId } = req.params;

    const subcategories = await Category.find({ parentCategory: parentId, isActive: true })
      .populate("parentCategory", "name slug");

    res.json(subcategories);
  } catch (error) {
    res.status(500).json({ message: "Error fetching subcategories", error: error.message });
  }
};

// ================== 📌 SELLER CONTROLLERS ==================

// @desc Seller creates/proposes a category (needs admin approval)
// @route POST /api/categories/seller
// @access Seller (Verified)
exports.createCategory = async (req, res) => {
  try {
    const { name, description, parentCategory } = req.body;

    const slug = slugify(name, { lower: true });

    const categoryExists = await Category.findOne({ slug });
    if (categoryExists) {
      return res.status(400).json({ message: "Category with this name already exists" });
    }

    const category = new Category({
      name,
      slug,
      description,
      parentCategory: parentCategory || null,
      createdBy: req.user._id,
      isActive: false // requires admin approval
    });

    await category.save();
    res.status(201).json({ message: "Category proposed successfully, waiting for admin approval", category });
  } catch (error) {
    res.status(500).json({ message: "Error creating category", error: error.message });
  }
};

// @desc Seller fetch all categories with nested subcategories
// @route GET /seller/categories/seller/all-with-sub
// @access Seller (Verified)
// @desc Seller fetch all categories with nested subcategories (recursive for deeper levels)
// @route GET /api/categories/seller/all-with-sub
// @access Seller (Verified)
exports.getAllCategoriesWithSubForSeller = async (req, res) => {
  try {
    // Function to recursively build category tree
    const buildCategoryTree = async (categoryId = null, level = 0) => {
      const query = { isActive: true };
      if (categoryId) {
        query.parentCategory = categoryId;
      } else {
        query.parentCategory = null;
      }

      const categories = await Category.find(query).select("name slug _id").sort({ name: 1 }).lean();

      // Recursively fetch subcategories for each category
      const categoriesWithSubs = await Promise.all(
        categories.map(async (cat) => {
          const subcategories = await buildCategoryTree(cat._id, level + 1);
          return {
            ...cat,
            subcategories: subcategories.length > 0 ? subcategories : undefined,
            level, // Optional: for frontend indentation
          };
        })
      );

      return categoriesWithSubs;
    };

    // Fetch the full tree starting from top-level
    const categoriesWithSub = await buildCategoryTree();

    res.json(categoriesWithSub);
  } catch (error) {
    res.status(500).json({ message: "Error fetching categories with subcategories", error: error.message });
  }
};
// @desc Seller updates own category
// @route PUT /seller/categories/seller/:id
// @access Seller (Verified)
exports.updateOwnCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    const category = await Category.findById(id);
    if (!category) return res.status(404).json({ message: "Category not found" });

    if (String(category.createdBy) !== String(req.user._id)) {
      return res.status(403).json({ message: "You can only update your own categories" });
    }

    if (name) {
      category.name = name;
      category.slug = slugify(name, { lower: true });
    }
    if (description) category.description = description;

    await category.save();
    res.json({ message: "Category updated successfully", category });
  } catch (error) {
    res.status(500).json({ message: "Error updating category", error: error.message });
  }
};

// @desc Seller deletes own category (only if no products exist)
// @route DELETE /seller/categories/seller/:id
// @access Seller (Verified)
exports.deleteOwnCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const category = await Category.findById(id);
    if (!category) return res.status(404).json({ message: "Category not found" });

    if (String(category.createdBy) !== String(req.user._id)) {
      return res.status(403).json({ message: "You can only delete your own categories" });
    }

    const productsExist = await Product.exists({ category: id });
    if (productsExist) {
      return res.status(400).json({ message: "Cannot delete category with products assigned" });
    }

    await category.deleteOne();
    res.json({ message: "Category deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting category", error: error.message });
  }
};

// ================== 📌 ADMIN CONTROLLERS ==================

// @desc Admin creates category
// @route POST /api/categories/admin
// @access Admin
exports.createCategory = async (req, res) => {
  try {
    const { name, description, parentCategory } = req.body;

    const slug = slugify(name, { lower: true });

    const categoryExists = await Category.findOne({ slug });
    if (categoryExists) {
      return res.status(400).json({ message: "Category with this name already exists" });
    }

    const category = new Category({
      name,
      slug,
      description,
      parentCategory: parentCategory || null,
      createdBy: req.user._id, // admin user id
      isActive: true // admin creates directly as active
    });

    await category.save();
    res.status(201).json({ message: "Category created successfully", category });
  } catch (error) {
    res.status(500).json({ message: "Error creating category", error: error.message });
  }
};

// @desc Approve/Toggle Category Status
// @route PATCH /api/categories/admin/:id/toggle
// @access Admin
exports.toggleCategoryStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const category = await Category.findById(id);
    if (!category) return res.status(404).json({ message: "Category not found" });

    category.isActive = !category.isActive;
    await category.save();

    res.json({ message: `Category status updated to ${category.isActive ? "Active" : "Inactive"}`, category });
  } catch (error) {
    res.status(500).json({ message: "Error updating category status", error: error.message });
  }
};

// @desc Admin update category
// @route PUT /api/categories/admin/:id
// @access Admin
exports.updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, parentCategory, isActive } = req.body;

    const category = await Category.findById(id);
    if (!category) return res.status(404).json({ message: "Category not found" });

    if (name) {
      category.name = name;
      category.slug = slugify(name, { lower: true });
    }
    if (description) category.description = description;
    if (parentCategory !== undefined) category.parentCategory = parentCategory;
    if (isActive !== undefined) category.isActive = isActive;

    await category.save();
    res.json({ message: "Category updated successfully", category });
  } catch (error) {
    res.status(500).json({ message: "Error updating category", error: error.message });
  }
};

// @desc Admin delete category (restrict if products exist)
// @route DELETE /api/categories/admin/:id
// @access Admin
exports.deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const category = await Category.findById(id);
    if (!category) return res.status(404).json({ message: "Category not found" });

    const productsExist = await Product.exists({ category: id });
    if (productsExist) {
      return res.status(400).json({ message: "Cannot delete category with products assigned" });
    }

    await category.deleteOne();
    res.json({ message: "Category deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting category", error: error.message });
  }
};
exports.getAllCategoriesAdmin = async (req, res) => {
  try {
    const categories = await Category.find({})
      .populate("parentCategory", "name slug")
      .sort({ createdAt: -1 });
    res.json(categories);
  } catch (error) {
    res.status(500).json({ message: "Error fetching admin categories", error: error.message });
  }
};