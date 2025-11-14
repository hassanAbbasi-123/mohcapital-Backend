const express = require("express");
const router = express.Router();
const { protect, isAdmin } = require("../middleware/authMiddleware");
const {userManagement} = require("../controllers/indexController");



router.get("/get-users",protect, isAdmin, userManagement.getUsers); // list users
router.get("/get-user-by-id/:id",protect, isAdmin, userManagement.getUserById); // single user
router.put("/update-user/:id",protect, isAdmin, userManagement.updateUser); // update user
router.delete("/delete-user/:id",protect, isAdmin, userManagement.deleteUser); // delete user
router.patch("/change-user-status/:id",protect, isAdmin, userManagement.changeUserStatus); // change status

module.exports = router;
