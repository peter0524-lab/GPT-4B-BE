import express from 'express';
import { body, validationResult } from 'express-validator';
import Event from '../models/Event.model.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = express.Router();

router.use(authenticate);

// @route   GET /api/calendar/events
// @desc    Get events for date range
// @access  Private
router.get('/events', async (req, res) => {
  try {
    const { start, end } = req.query;

    const events = await Event.findByUserId(
      req.user.id,
      start ? new Date(start) : null,
      end ? new Date(end) : null
    );

    res.json({
      success: true,
      data: events
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   POST /api/calendar/events
// @desc    Create new event
// @access  Private
router.post('/events', [
  body('title').notEmpty().trim(),
  body('startDate').isISO8601(),
  body('endDate').isISO8601(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const event = await Event.create({
      ...req.body,
      userId: req.user.id
    });

    res.status(201).json({
      success: true,
      data: event
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   PUT /api/calendar/events/:id
// @desc    Update event
// @access  Private
router.put('/events/:id', async (req, res) => {
  try {
    const event = await Event.update(
      req.params.id,
      req.user.id,
      req.body
    );

    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    res.json({
      success: true,
      data: event
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   DELETE /api/calendar/events/:id
// @desc    Delete event
// @access  Private
router.delete('/events/:id', async (req, res) => {
  try {
    const deleted = await Event.delete(req.params.id, req.user.id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    res.json({
      success: true,
      message: 'Event deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

export default router;

