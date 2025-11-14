const { User } = require("../models/indexModel");

// GET all users with optional filters (status, search)
// Only users with role "user"
exports.getUsers = async (req, res) => {
  try {
    const { search, status } = req.query;

    let query = { role: "user" }; // Only normal users

    if (status === "active") query.isActive = true;
    if (status === "suspended") query.isActive = false;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } }
      ];
    }

    const users = await User.find(query)
      .select("-password") // exclude password
      .sort({ createdAt: -1 });

    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET single user by ID
exports.getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// UPDATE user info
exports.updateUser = async (req, res) => {
  try {
    const { name, email, phone, address, isActive } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (name) user.name = name;
    if (email) user.email = email;
    if (phone) user.phone = phone;
    if (address) user.address = address;
    if (typeof isActive === "boolean") user.isActive = isActive;

    await user.save();
    res.json({ message: "User updated successfully", user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// DELETE a user
exports.deleteUser = async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ message: "User deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// CHANGE user status (active/suspended)
exports.changeUserStatus = async (req, res) => {
  try {
    const { status } = req.body; // "active" or "suspended"
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    user.isActive = status === "active";
    await user.save();

    res.json({ message: `User ${status} successfully`, user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
