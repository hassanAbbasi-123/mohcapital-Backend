// ======= File: socket.js =======

const { Server } = require("socket.io");
const Message = require("./models/chatmodel/messageModel");
const Conversation = require("./models/chatmodel/conversationModel");

let io;

function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: "*", // change this to your frontend origin in production
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    console.log("✅ User connected:", socket.id);

    // Join rooms: conversation room and personal room
    socket.on("joinRoom", async ({ conversationId, userId }) => {
      try {
        if (conversationId) {
          socket.join(conversationId);
          console.log(`✅ User ${userId || socket.id} joined room ${conversationId}`);

          // debug: list sockets in the room
          try {
            const socketsInRoom = await io.in(conversationId).allSockets();
            console.log(`👥 Current members in ${conversationId}:`, Array.from(socketsInRoom));
          } catch (err) {
            // ignore
          }
        }

        if (userId) {
          socket.join(`user_${userId}`);
          console.log(`🔔 User ${userId} joined personal room user_${userId}`);
        }
      } catch (err) {
        console.error("joinRoom error:", err.message || err);
      }
    });

    // Typing indicator
    socket.on("typing", ({ conversationId, userId }) => {
      if (!conversationId) return;
      socket.to(conversationId).emit("typing", { userId });
    });

    // Send message handler
    socket.on(
      "sendMessage",
      async ({ conversationId, senderId, text, attachments }) => {
        try {
          if (!conversationId || !senderId) {
            return socket.emit("messageSent", { status: "error", error: "Missing conversationId or senderId" });
          }

          const convo = await Conversation.findById(conversationId);
          if (!convo) {
            return socket.emit("messageSent", { status: "error", error: "Conversation not found" });
          }

          // If conversation is blocked and the sender is NOT one of the users who initiated the block,
          // prevent sending (i.e., the other side blocked them)
          if (Array.isArray(convo.blockedBy) && convo.blockedBy.length > 0) {
            const senderIsBlocker = convo.blockedBy.some((id) => id.toString() === String(senderId));
            if (!senderIsBlocker) {
              return socket.emit("messageSent", { status: "error", error: "You are blocked in this conversation" });
            }
          }

          // Ensure participants array exists and includes sender
          if (!Array.isArray(convo.participants)) convo.participants = [];
          if (!convo.participants.some((p) => p.toString() === String(senderId))) {
            convo.participants.push(senderId);
          }

          // Create and save message
          const message = new Message({
            conversation: conversationId,
            sender: senderId,
            text: text || "",
            attachments: attachments || [],
            seenBy: [senderId],
            status: "sent",
          });

          await message.save();

          // Update conversation preview and timestamps
          convo.lastMessage = text || (attachments && attachments.length ? "Attachment" : "");
          convo.lastMessageAt = new Date();
          convo.updatedAt = new Date();
          // ensure participants has sender (already attempted above)
          await convo.save();

          // Populate message sender for emitting
          const populatedMessage = await Message.findById(message._id).populate("sender", "name email");

          // Emit the new message to the conversation room
          io.to(conversationId).emit("receiveMessage", populatedMessage);

          // Also emit a debug string (useful for tooling)
          io.to(conversationId).emit("receiveMessageDebug", JSON.stringify(populatedMessage));

          // Prepare preview payload and emit updates
          const previewPayload = {
            conversationId,
            lastMessage: convo.lastMessage,
            lastMessageAt: convo.lastMessageAt,
          };

          // Emit to conversation room
          io.to(conversationId).emit("conversationUpdated", previewPayload);

          // Also emit to each participant's personal room (if present)
          if (Array.isArray(convo.participants)) {
            convo.participants.forEach((participantId) => {
              io.to(`user_${participantId}`).emit("conversationUpdated", previewPayload);
            });
          }

          // Acknowledge sender
          socket.emit("messageSent", { status: "ok", conversationId, messageId: message._id });
        } catch (err) {
          console.error("sendMessage error:", err);
          socket.emit("messageSent", { status: "error", error: err.message });
        }
      }
    );

    socket.on("disconnect", () => {
      console.log("❌ User disconnected:", socket.id);
    });
  });

  return io;
}

module.exports = { initSocket, getIO: () => io };
