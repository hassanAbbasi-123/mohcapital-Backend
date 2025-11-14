// ======= File: controllers/chatController.js =======

const Conversation = require("../models/chatmodel/conversationModel");
const Message = require("../models/chatmodel/messageModel");
const SellerProfile = require("../models/sellerProfile"); // adjust path if needed
const User = require("../models/userModel"); // adjust path if needed
const mongoose = require("mongoose");
const Product = require("../models/productModel"); // adjust path if needed 
// Utility helper
const getId = (v) => {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (v._id) return v._id.toString();
  if (v.toString) return v.toString();
  return null;
};


async function attachSellerProfilesToConversations(convos) {
  if (!Array.isArray(convos) || convos.length === 0) {
    return convos.map((c) => (c.toObject ? c.toObject() : c));
  }

  // Convert to plain objects
  const plainConvos = convos.map((c) => (c.toObject ? c.toObject() : c));

  // Collect seller IDs
  const sellerIds = plainConvos
    .map((c) => {
      if (!c.seller) return null;
      return typeof c.seller === "object" ? c.seller._id : c.seller;
    })
    .filter(Boolean);

  const uniqueSellerIds = [...new Set(sellerIds)];

  let profiles = [];
  if (uniqueSellerIds.length > 0) {
    profiles = await SellerProfile.find({ user: { $in: uniqueSellerIds } }).lean();
  }

  const profileMap = {};
  profiles.forEach((p) => {
    profileMap[p.user.toString()] = p;
  });

  // Fetch seller user objects if missing
  const sellerUsers = await User.find({ _id: { $in: uniqueSellerIds } })
    .select("_id name email avatar")
    .lean();

  const sellerMap = {};
  sellerUsers.forEach((s) => {
    sellerMap[s._id.toString()] = s;
  });

  // Attach seller profile and display names
  return plainConvos.map((c) => {
    const sellerId = c.seller
      ? typeof c.seller === "object"
        ? c.seller._id.toString()
        : c.seller.toString()
      : null;

    if (sellerId) {
      c.seller = sellerMap[sellerId] || { _id: sellerId, name: "Unknown Seller" };
    }

    // Attach sellerProfile
    c.sellerProfile = sellerId && profileMap[sellerId]
      ? {
          storeName: profileMap[sellerId].storeName,
          logo: profileMap[sellerId].logo,
          isVerified: profileMap[sellerId].isVerified,
        }
      : null;

    // Assign displayName to seller
    if (c.seller) {
      c.seller.displayName =
        (c.sellerProfile && c.sellerProfile.storeName) ||
        c.seller.name ||
        c.seller.email ||
        "Unknown Seller";
    }

    // Assign displayName to buyer
    if (c.buyer) {
      c.buyer.displayName = c.buyer.name || c.buyer.email || "Unknown Buyer";
    }

    // Assign displayName to participants
    if (Array.isArray(c.participants)) {
      c.participants = c.participants.map((p) => {
        const pid = typeof p === "object" ? p._id : p;
        const pObj = typeof p === "object" ? p : { _id: pid };
        const pProf = profileMap[pid];
        const display =
          (pProf && pProf.storeName) ||
          pObj.displayName ||
          pObj.name ||
          pObj.email ||
          "Unknown";
        return { ...pObj, displayName: display };
      });
    }

    return c;
  });
}



// -------------------------
// USER (Buyer) Functions
// -------------------------

// 1. Start conversation

// Start conversation
exports.startConversation = async (req, res) => {
  try {
    const buyerId = req.user._id;
    const { sellerId, productId } = req.body;

    // Validate inputs
    if (!sellerId) {
      return res.status(400).json({ message: "Seller ID is required" });
    }
    if (!mongoose.Types.ObjectId.isValid(sellerId)) {
      return res.status(400).json({ message: "Invalid seller ID" });
    }
    if (buyerId.toString() === sellerId.toString()) {
      return res.status(400).json({ message: "Buyer and seller cannot be the same" });
    }

    // Check if seller exists and is a seller
    console.log(`Querying seller with ID: ${sellerId}`);
    const seller = await User.findById(sellerId).select("_id name email avatar role").lean();
    if (!seller) {
      console.warn(`No user found for sellerId: ${sellerId}`);
      return res.status(404).json({ message: "Seller not found" });
    }
    if (seller.role !== "seller") {
      console.warn(`User ${sellerId} is not a seller, role: ${seller.role}`);
      return res.status(400).json({ message: "User is not a seller" });
    }

    // Check if product exists (if provided)
    let product = null;
    if (productId) {
      if (!mongoose.Types.ObjectId.isValid(productId)) {
        return res.status(400).json({ message: "Invalid product ID" });
      }
      product = await Product.findById(productId).select("name price").lean();
      if (!product) {
        console.warn(`No product found for productId: ${productId}`);
        return res.status(404).json({ message: "Product not found" });
      }
    }

    // Check if a conversation already exists
    console.log(`Checking for existing conversation: buyer=${buyerId}, seller=${sellerId}, product=${productId || "none"}`);
    let convo = await Conversation.findOne({
      buyer: buyerId,
      seller: sellerId,
      ...(productId && { product: productId }),
    });

    if (!convo) {
      // Create new conversation
      convo = new Conversation({
        buyer: buyerId,
        seller: sellerId,
        participants: [buyerId, sellerId],
        ...(productId && { product: productId }),
      });
      await convo.save();
      console.log(`New conversation created: ${convo._id}`);
    }

    // Use attachSellerProfilesToConversations to handle seller and buyer data
    const [convoObj] = await attachSellerProfilesToConversations([convo]);

    // Fetch buyer info (if not already populated)
    if (!convoObj.buyer || !convoObj.buyer.name) {
      const buyer = await User.findById(buyerId).select("_id name email avatar").lean();
      convoObj.buyer = buyer || { _id: buyerId, name: "Unknown Buyer" };
      convoObj.buyer.displayName = buyer?.name || buyer?.email || "Unknown Buyer";
    }

    // Attach product details if available
    if (product) {
      convoObj.product = product;
    }

    return res.status(201).json({
      message: "Conversation started",
      conversation: convoObj,
    });
  } catch (error) {
    console.error("Error starting conversation:", error);
    if (error.name === "ValidationError") {
      return res.status(400).json({ message: "Validation error", details: error.message });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
};

// 2. Get buyer conversations
exports.getUserConversations = async (req, res) => {
  try {
    const buyerId = req.user && req.user._id;
    if (!buyerId) return res.status(401).json({ message: "Unauthorized" });

    const convos = await Conversation.find({
      $or: [{ buyer: buyerId }, { participants: buyerId }],
    })
      .populate("seller", "name email avatar")
      .populate("buyer", "name email avatar")
      .populate("participants", "name email avatar")
      .sort({ updatedAt: -1 });

    const convosWithProfiles = await attachSellerProfilesToConversations(convos);

    res.json(convosWithProfiles);
  } catch (err) {
    console.error("getUserConversations error:", err);
    res
      .status(500)
      .json({ message: "Error fetching conversations", error: err.message });
  }
};

// 3. Block seller (user blocks)
exports.blockSeller = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user && req.user._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const convo = await Conversation.findByIdAndUpdate(
      conversationId,
      { $addToSet: { blockedBy: userId }, $set: { status: "blocked" } },
      { new: true }
    );

    if (!convo)
      return res.status(404).json({ message: "Conversation not found" });

    const [popConvo] = await attachSellerProfilesToConversations([convo]);

    res.json({ message: "Conversation blocked by user", conversation: popConvo });
  } catch (err) {
    console.error("blockSeller error:", err);
    res
      .status(500)
      .json({ message: "Error blocking seller", error: err.message });
  }
};

// -------------------------
// SELLER Functions
// -------------------------

// 4. Get seller conversations
exports.getSellerConversations = async (req, res) => {
  try {
    const sellerId =
      (req.seller && req.seller._id) || (req.user && req.user._id);
    if (!sellerId) return res.status(401).json({ message: "Unauthorized" });

    const convos = await Conversation.find({
      $or: [{ seller: sellerId }, { participants: sellerId }],
    })
      .populate("buyer", "name email avatar")
      .populate("seller", "name email avatar")
      .populate("participants", "name email avatar")
      .sort({ updatedAt: -1 });

    const convosWithProfiles = await attachSellerProfilesToConversations(convos);

    res.json(convosWithProfiles);
  } catch (err) {
    console.error("getSellerConversations error:", err);
    res
      .status(500)
      .json({ message: "Error fetching seller conversations", error: err.message });
  }
};

// 5. View conversation
exports.viewConversation = async (req, res) => {
  try {
    let convo = await Conversation.findById(req.params.id)
      .populate("buyer", "name email avatar")
      .populate("seller", "name email avatar")
      .populate("participants", "name email avatar");

    if (!convo)
      return res.status(404).json({ message: "Conversation not found" });

    const [popConvo] = await attachSellerProfilesToConversations([convo]);

    // Permission check
    const requesterId = req.user && req.user._id ? req.user._id.toString() : null;

    const isParticipant = Array.isArray(popConvo.participants)
      ? popConvo.participants.some((p) => getId(p) === requesterId)
      : false;

    const isBuyerOrSeller =
      getId(popConvo.buyer) === requesterId ||
      getId(popConvo.seller) === requesterId;

    if (
      req.user &&
      req.user.role !== "admin" &&
      !isParticipant &&
      !isBuyerOrSeller
    ) {
      return res.status(403).json({ message: "Forbidden" });
    }

    res.json(popConvo);
  } catch (err) {
    console.error("viewConversation error:", err);
    res
      .status(500)
      .json({ message: "Error fetching conversation", error: err.message });
  }
};

// 6. Block buyer (seller blocks)
exports.blockBuyer = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user && req.user._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const convo = await Conversation.findByIdAndUpdate(
      conversationId,
      { $addToSet: { blockedBy: userId }, $set: { status: "blocked" } },
      { new: true }
    );

    if (!convo)
      return res.status(404).json({ message: "Conversation not found" });

    const [popConvo] = await attachSellerProfilesToConversations([convo]);
    res.json({ message: "Conversation blocked by seller", conversation: popConvo });
  } catch (err) {
    console.error("blockBuyer error:", err);
    res
      .status(500)
      .json({ message: "Error blocking buyer", error: err.message });
  }
};

// -------------------------
// MESSAGE Functions
// -------------------------

// 7. Get messages
exports.getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user && req.user._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const messages = await Message.find({
      conversation: conversationId,
      $or: [
        { deletedBy: { $exists: false } },
        { deletedBy: { $size: 0 } },
        { deletedBy: { $ne: userId } },
      ],
    })
      .populate("sender", "name email avatar")
      .sort({ createdAt: 1 });

    res.json(messages);
  } catch (err) {
    console.error("getMessages error:", err);
    res
      .status(500)
      .json({ message: "Error fetching messages", error: err.message });
  }
};

// 8. Mark as seen
exports.markAsSeen = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.user && req.user._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    await Message.updateMany(
      { conversation: conversationId, seenBy: { $ne: userId } },
      { $addToSet: { seenBy: userId }, $set: { status: "seen" } }
    );

    res.json({ message: "Marked as seen" });
  } catch (err) {
    console.error("markAsSeen error:", err);
    res
      .status(500)
      .json({ message: "Error marking messages as seen", error: err.message });
  }
};

// 9. Delete message
exports.deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user && req.user._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const msg = await Message.findById(messageId);
    if (!msg) return res.status(404).json({ message: "Message not found" });

    await Message.findByIdAndUpdate(messageId, {
      $addToSet: { deletedBy: userId },
    });

    res.json({ message: "Message soft-deleted" });
  } catch (err) {
    console.error("deleteMessage error:", err);
    res
      .status(500)
      .json({ message: "Error deleting message", error: err.message });
  }
};

// -------------------------
// ADMIN Functions
// -------------------------

// 10. Get all conversations
exports.getAllConversations = async (req, res) => {
  try {
    const convos = await Conversation.find()
      .populate("buyer", "name email avatar")
      .populate("seller", "name email avatar")
      .populate("participants", "name email avatar")
      .sort({ updatedAt: -1 });

    const convosWithProfiles = await attachSellerProfilesToConversations(convos);

    res.json(convosWithProfiles);
  } catch (err) {
    console.error("getAllConversations error:", err);
    res
      .status(500)
      .json({ message: "Error fetching all conversations", error: err.message });
  }
};

// 11. Get specific conversation
exports.getConversationById = async (req, res) => {
  try {
    const convo = await Conversation.findById(req.params.id)
      .populate("buyer", "name email avatar")
      .populate("seller", "name email avatar")
      .populate("participants", "name email avatar");

    if (!convo)
      return res.status(404).json({ message: "Conversation not found" });

    const [popConvo] = await attachSellerProfilesToConversations([convo]);

    res.json(popConvo);
  } catch (err) {
    console.error("getConversationById error:", err);
    res
      .status(500)
      .json({ message: "Error fetching conversation", error: err.message });
  }
};

// 12. Admin hard delete message
exports.deleteMessageAdmin = async (req, res) => {
  try {
    const { messageId } = req.params;
    await Message.findByIdAndDelete(messageId);
    res.json({ message: "Message hard deleted by admin" });
  } catch (err) {
    console.error("deleteMessageAdmin error:", err);
    res
      .status(500)
      .json({ message: "Error deleting message", error: err.message });
  }
};

// 13. Flag message
exports.flagMessage = async (req, res) => {
  try {
    const { messageId, reason } = req.body;
    res.json({
      message: "Message flagged for review",
      messageId,
      reason: reason || null,
    });
  } catch (err) {
    console.error("flagMessage error:", err);
    res
      .status(500)
      .json({ message: "Error flagging message", error: err.message });
  }
};
