import express from 'express';
import { body, validationResult } from 'express-validator';
import Gift from '../models/Gift.model.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = express.Router();

router.use(authenticate);

// @route   GET /api/gifts
// @desc    Get all gifts for user
// @access  Private
router.get('/', async (req, res) => {
  try {
    const { cardId, year } = req.query;

    const gifts = await Gift.findByUserId(req.user.id, { cardId, year });

    res.json({
      success: true,
      data: gifts
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   POST /api/gifts
// @desc    Create new gift record
// @access  Private
router.post('/', [
  body('cardId').notEmpty(),
  body('giftName').notEmpty().trim(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const gift = await Gift.create({
      ...req.body,
      userId: req.user.id,
      year: new Date().getFullYear().toString(),
    });

    res.status(201).json({
      success: true,
      data: gift
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   POST /api/gifts/recommend
// @desc    Get gift recommendations using LLM
// @access  Private
router.post('/recommend', [
  body('cardId').notEmpty(),
  body('additionalInfo').optional(),
], async (req, res) => {
  try {
    // TODO: Implement LLM-based gift recommendation
    // This would call OpenAI/Claude/Gemini API with card info and context
    
    res.status(501).json({
      success: false,
      message: 'Gift recommendation not implemented yet'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

export default router;

