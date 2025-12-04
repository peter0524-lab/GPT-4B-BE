import express from "express";
import { body, validationResult } from "express-validator";
import Chat from "../models/Chat.model.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { processLLMChat } from "../services/llm.service.js";

const router = express.Router();

router.use(authenticate);

// @route   GET /api/chat
// @desc    Get all chat conversations
// @access  Private
router.get("/", async (req, res) => {
  try {
    const chats = await Chat.findByUserId(req.user.id, true);

    res.json({
      success: true,
      data: chats,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// @route   GET /api/chat/:id
// @desc    Get single chat conversation
// @access  Private
router.get("/:id", async (req, res) => {
  try {
    const chat = await Chat.findById(req.params.id, req.user.id);

    if (!chat) {
      return res.status(404).json({
        success: false,
        message: "Chat not found",
      });
    }

    res.json({
      success: true,
      data: chat,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// @route   POST /api/chat
// @desc    Create new chat or send message
// @access  Private
router.post(
  "/",
  [
    body("message").notEmpty().trim(),
    body("llmProvider").optional().isIn(["gpt", "claude", "gemini"]),
    body("chatId").optional(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      const { message, llmProvider = "gpt", chatId } = req.body;

      let chat;

      if (chatId) {
        // Continue existing chat
        chat = await Chat.findById(chatId, req.user.id);

        if (!chat) {
          return res.status(404).json({
            success: false,
            message: "Chat not found",
          });
        }
      } else {
        // Create new chat
        chat = await Chat.create({
          userId: req.user.id,
          llmProvider,
          messages: [],
          title: message.substring(0, 50), // Use first 50 chars as title
        });
      }

      // Add user message
      chat.messages.push({
        role: "user",
        content: message,
        timestamp: new Date(),
      });

      // Get LLM response
      const llmResponse = await processLLMChat(chat.messages, llmProvider);

      // Add assistant message
      chat.messages.push({
        role: "assistant",
        content: llmResponse,
        timestamp: new Date(),
      });

      // Update chat with new messages
      chat = await Chat.update(chat.id, req.user.id, {
        messages: chat.messages,
      });

      res.json({
        success: true,
        data: chat,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// @route   DELETE /api/chat/:id
// @desc    Delete chat conversation
// @access  Private
router.delete("/:id", async (req, res) => {
  try {
    const deleted = await Chat.delete(req.params.id, req.user.id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Chat not found",
      });
    }

    res.json({
      success: true,
      message: "Chat deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

export default router;
