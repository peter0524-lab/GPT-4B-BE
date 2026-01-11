import express from "express";
import { body, validationResult } from "express-validator";
import Chat from "../models/Chat.model.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { processLLMChat } from "../services/llm.service.js";
import { logger } from "../utils/logger.js";

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
      logger.info("Chat request", { message: message?.substring(0, 50), llmProvider, chatId, userId: req.user.id });

      let chat;

      if (chatId) {
        // Continue existing chat
        logger.debug("Finding existing chat", { chatId });
        chat = await Chat.findById(chatId, req.user.id);

        if (!chat) {
          return res.status(404).json({
            success: false,
            message: "Chat not found",
          });
        }
        logger.debug("Found existing chat", { chatId: chat.id });
      } else {
        // Create new chat
        logger.debug("Creating new chat");
        chat = await Chat.create({
          userId: req.user.id,
          llmProvider,
          messages: [],
          title: message.substring(0, 50), // Use first 50 chars as title
        });
        logger.info("Created new chat", { chatId: chat.id });
      }

      // Add user message
      chat.messages.push({
        role: "user",
        content: message,
        timestamp: new Date(),
      });

      // Get LLM response
      let llmResponse;
      try {
        logger.debug("Calling LLM", { messageCount: chat.messages.length, llmProvider });
        llmResponse = await processLLMChat(chat.messages, llmProvider);
        logger.debug("LLM response received", { length: llmResponse?.length });
      } catch (llmError) {
        logger.error("LLM processing error", llmError);
        return res.status(500).json({
          success: false,
          message: llmError.message || "LLM 처리 중 오류가 발생했습니다.",
        });
      }

      // Add assistant message
      chat.messages.push({
        role: "assistant",
        content: llmResponse,
        timestamp: new Date(),
      });

      // Update chat with new messages
      try {
        logger.debug("Updating chat", { chatId: chat.id, messageCount: chat.messages.length });
        chat = await Chat.update(chat.id, req.user.id, {
          messages: chat.messages,
        });
        logger.debug("Chat updated successfully", { chatId: chat.id });
      } catch (updateError) {
        logger.error("Chat update error", updateError);
        return res.status(500).json({
          success: false,
          message: `채팅 저장 중 오류가 발생했습니다: ${updateError.message}`,
        });
      }

      // Ensure messages is an array (not a string)
      if (chat && typeof chat.messages === 'string') {
        try {
          chat.messages = JSON.parse(chat.messages);
        } catch (parseError) {
          logger.error("Failed to parse messages in response", parseError);
        }
      }

      logger.debug("Final chat object before sending", {
        id: chat.id,
        messagesCount: Array.isArray(chat.messages) ? chat.messages.length : 'not array',
        messagesType: typeof chat.messages,
      });

      res.json({
        success: true,
        data: chat,
      });
    } catch (error) {
      logger.error("Chat route error", error);
      res.status(500).json({
        success: false,
        message: error.message || "서버 오류가 발생했습니다.",
      });
    }
  }
);

// @route   POST /api/chat/create-history
// @desc    Create chat history with full conversation
// @access  Private
router.post("/create-history", [
  body("messages").isArray().notEmpty(),
  body("title").optional().trim(),
  body("llmProvider").optional().isIn(["gpt", "claude", "gemini"]),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array(),
      });
    }

    const { messages, title, llmProvider = "gpt" } = req.body;

    // Ensure messages have proper format
    const formattedMessages = messages.map(msg => ({
      role: msg.role || "assistant",
      content: msg.content || "",
      timestamp: msg.timestamp || new Date().toISOString(),
    }));

    const chat = await Chat.create({
      userId: req.user.id,
      llmProvider,
      title: title || "선물 추천 대화",
      messages: formattedMessages,
    });

    res.json({
      success: true,
      data: chat,
    });
  } catch (error) {
    logger.error("Create chat history error", error);
    res.status(500).json({
      success: false,
      message: error.message || "대화 내역 저장 중 오류가 발생했습니다.",
    });
  }
});

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
