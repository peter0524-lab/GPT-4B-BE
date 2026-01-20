import express from "express";
import { body, validationResult } from "express-validator";
import BusinessCard from "../models/BusinessCard.model.js";
import { authenticate } from "../middleware/auth.middleware.js";

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// @route   GET /api/cards
// @desc    Get all business cards for user
// @access  Private
router.get("/", async (req, res) => {
  try {
    const { search, page = 1, limit = 20, cardIds } = req.query;

    const parsedCardIds = cardIds
      ? String(cardIds)
          .split(",")
          .map((id) => id.trim())
          .filter((id) => id.length > 0)
      : [];

    const cards = await BusinessCard.findByUserId(req.user.id, {
      search,
      page,
      limit,
      cardIds: parsedCardIds,
    });
    const total = await BusinessCard.countByUserId(
      req.user.id,
      search,
      parsedCardIds
    );

    res.json({
      success: true,
      data: cards,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// @route   GET /api/cards/:id
// @desc    Get single business card
// @access  Private
router.get("/:id", async (req, res) => {
  try {
    const card = await BusinessCard.findById(req.params.id, req.user.id);

    if (!card) {
      return res.status(404).json({
        success: false,
        message: "Business card not found",
      });
    }

    res.json({
      success: true,
      data: card,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// @route   POST /api/cards
// @desc    Create new business card
// @access  Private
router.post(
  "/",
  // email 정리 미들웨어 (validation 전에 실행)
  (req, res, next) => {
    // email이 빈 값이거나 "@"만 있으면 필드 자체를 제거 (undefined로 설정)
    if (
      req.body.email !== undefined && (
        !req.body.email ||
        req.body.email === "@" ||
        (typeof req.body.email === 'string' && req.body.email.trim() === "")
      )
    ) {
      delete req.body.email; // 필드를 완전히 제거하여 validation을 건너뛰게 함
    }
    // "null" 문자열을 실제 null로 변환 (FE에서 전달된 경우)
    Object.keys(req.body).forEach((key) => {
      if (req.body[key] === "null") {
        req.body[key] = null;
      }
    });
    next();
  },
  [
    body("name").notEmpty().trim(),
    body("email").optional().isEmail().normalizeEmail(),
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

      // Check card limit
      const cardCount = await BusinessCard.countByUserId(req.user.id);
      if (cardCount >= req.user.cardLimit) {
        return res.status(403).json({
          success: false,
          message: `Card limit reached (${req.user.cardLimit}). Please upgrade to premium.`,
        });
      }

      const card = await BusinessCard.create({
        ...req.body,
        userId: req.user.id,
      });

      res.status(201).json({
        success: true,
        data: card,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// @route   PUT /api/cards/:id
// @desc    Update business card
// @access  Private
router.put(
  "/:id",
  // email 정리 미들웨어 (validation 전에 실행)
  (req, res, next) => {
    // email이 빈 값이거나 "@"만 있으면 null로 설정 (삭제된 필드 표시)
    // 하지만 null일 때는 validation을 건너뛰기 위해 필드를 제거하거나 nullable 옵션 사용
    if (
      req.body.email !== undefined && (
        !req.body.email ||
        req.body.email === "@" ||
        (typeof req.body.email === 'string' && req.body.email.trim() === "")
      )
    ) {
      req.body.email = null;
    }
    // "null" 문자열을 실제 null로 변환 (FE에서 전달된 경우)
    Object.keys(req.body).forEach((key) => {
      if (req.body[key] === "null") {
        req.body[key] = null;
      }
    });
    // null 값은 유지 (필드 삭제를 위해 null로 저장해야 함)
    next();
  },
  [body("email").optional({ nullable: true, checkFalsy: true }).isEmail().normalizeEmail()],
  async (req, res) => {
    // 디버깅: 받은 데이터 로그 (validation 전에 찍기)
    console.log("==========================================");
    console.log("📇 [명함 수정] PUT /api/cards/:id");
    console.log("==========================================");
    console.log(`명함 ID: ${req.params.id}`);
    console.log(`사용자 ID: ${req.user?.id}`);
    console.log(`받은 데이터:`, JSON.stringify(req.body, null, 2));
    if (req.body.design) {
      console.log(`✅ design 값 수신: "${req.body.design}"`);
    } else {
      console.log(`⚠️  design 값 없음`);
    }

    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        console.log(
          `❌ Validation 실패:`,
          JSON.stringify(errors.array(), null, 2)
        );
        return res.status(400).json({
          success: false,
          errors: errors.array(),
        });
      }

      // 디버깅: validation 통과
      console.log(`✅ Validation 통과`);

      const card = await BusinessCard.update(
        req.params.id,
        req.user.id,
        req.body
      );

      // 디버깅: 업데이트 결과 로그
      console.log(
        `업데이트 결과:`,
        card ? `성공 (design: ${card.design})` : "실패"
      );
      console.log("==========================================\n");

      if (!card) {
        return res.status(404).json({
          success: false,
          message: "Business card not found",
        });
      }

      res.json({
        success: true,
        data: card,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
);

// @route   DELETE /api/cards/:id
// @desc    Delete business card
// @access  Private
router.delete("/:id", async (req, res) => {
  try {
    const deleted = await BusinessCard.delete(req.params.id, req.user.id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Business card not found",
      });
    }

    res.json({
      success: true,
      message: "Business card deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

export default router;
