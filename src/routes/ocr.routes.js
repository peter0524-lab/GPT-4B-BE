import express from 'express';
import { body, validationResult } from 'express-validator';
import { authenticate } from '../middleware/auth.middleware.js';
import { processOCR } from '../services/ocr.service.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// @route   POST /api/ocr/process
// @desc    Process OCR from image
// @access  Private
router.post('/process', [
  body('image').notEmpty().withMessage('Image is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { image } = req.body; // Base64 encoded image

    // Process OCR
    const ocrResult = await processOCR(image);

    res.json({
      success: true,
      data: ocrResult
    });
  } catch (error) {
    console.error('OCR Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'OCR processing failed'
    });
  }
});

export default router;

