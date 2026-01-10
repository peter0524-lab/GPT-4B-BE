import express from 'express';
import PreferenceProfile from '../models/PreferenceProfile.model.js';
import { processMemosForPreference } from '../services/preference.service.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = express.Router();

// 모든 라우트에 인증 적용
router.use(authenticate);

// @route   GET /api/profile/:business_card_id/preferences
// @desc    Get preferences for a business card
// @access  Private
router.get('/:business_card_id/preferences', async (req, res) => {
  try {
    const { business_card_id } = req.params;
    const businessCardId = parseInt(business_card_id, 10);

    if (isNaN(businessCardId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid business_card_id',
      });
    }

    const profile = await PreferenceProfile.findByBusinessCardId(businessCardId);

    if (!profile) {
      return res.json({
        success: true,
        data: {
          likes: [],
          dislikes: [],
          uncertain: [],
          lastSourceCount: 0,
          updated_at: null
        },
      });
    }

    // Parse JSON fields
    const result = {
      likes: profile.likes ? (typeof profile.likes === 'string' ? JSON.parse(profile.likes) : profile.likes) : [],
      dislikes: profile.dislikes ? (typeof profile.dislikes === 'string' ? JSON.parse(profile.dislikes) : profile.dislikes) : [],
      uncertain: profile.uncertain ? (typeof profile.uncertain === 'string' ? JSON.parse(profile.uncertain) : profile.uncertain) : [],
      lastSourceCount: profile.last_source_count || 0,
      updated_at: profile.updated_at
    };

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error fetching preferences:', error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// @route   POST /api/profile/:business_card_id/preferences/rebuild
// @desc    Rebuild preference profile from memos
// @access  Private
router.post('/:business_card_id/preferences/rebuild', async (req, res) => {
  try {
    const { business_card_id } = req.params;
    const businessCardId = parseInt(business_card_id, 10);

    if (isNaN(businessCardId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid business_card_id',
      });
    }

    const { limit = 50 } = req.body;

    // Process memos and rebuild profile
    const preferences = await processMemosForPreference(businessCardId, limit);

    res.json({
      success: true,
      data: preferences,
      message: 'Preference profile rebuilt successfully',
    });
  } catch (error) {
    console.error('Error rebuilding preferences:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to rebuild preference profile',
    });
  }
});

export default router;
