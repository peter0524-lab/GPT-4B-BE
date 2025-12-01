import express from 'express';
import { body, validationResult } from 'express-validator';
import BusinessCard from '../models/BusinessCard.model.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// @route   GET /api/cards
// @desc    Get all business cards for user
// @access  Private
router.get('/', async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;

    const cards = await BusinessCard.findByUserId(req.user.id, { search, page, limit });
    const total = await BusinessCard.countByUserId(req.user.id, search);

    res.json({
      success: true,
      data: cards,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   GET /api/cards/:id
// @desc    Get single business card
// @access  Private
router.get('/:id', async (req, res) => {
  try {
    const card = await BusinessCard.findById(req.params.id, req.user.id);

    if (!card) {
      return res.status(404).json({
        success: false,
        message: 'Business card not found'
      });
    }

    res.json({
      success: true,
      data: card
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   POST /api/cards
// @desc    Create new business card
// @access  Private
router.post('/', [
  body('name').notEmpty().trim(),
  body('email').optional().isEmail().normalizeEmail(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    // Check card limit
    const cardCount = await BusinessCard.countByUserId(req.user.id);
    if (cardCount >= req.user.cardLimit) {
      return res.status(403).json({
        success: false,
        message: `Card limit reached (${req.user.cardLimit}). Please upgrade to premium.`
      });
    }

    const card = await BusinessCard.create({
      ...req.body,
      userId: req.user.id
    });

    res.status(201).json({
      success: true,
      data: card
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   PUT /api/cards/:id
// @desc    Update business card
// @access  Private
router.put('/:id', [
  body('email').optional().isEmail().normalizeEmail(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const card = await BusinessCard.update(
      req.params.id,
      req.user.id,
      req.body
    );

    if (!card) {
      return res.status(404).json({
        success: false,
        message: 'Business card not found'
      });
    }

    res.json({
      success: true,
      data: card
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   DELETE /api/cards/:id
// @desc    Delete business card
// @access  Private
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await BusinessCard.delete(req.params.id, req.user.id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Business card not found'
      });
    }

    res.json({
      success: true,
      message: 'Business card deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

export default router;

