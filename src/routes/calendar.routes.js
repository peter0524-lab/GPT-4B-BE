import express from 'express';
import { body, validationResult } from 'express-validator';
import Event from '../models/Event.model.js';
import BusinessCard from '../models/BusinessCard.model.js';
import Memo from '../models/Memo.model.js';
import PreferenceProfile from '../models/PreferenceProfile.model.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = express.Router();

router.use(authenticate);

// @route   GET /api/calendar/contacts-autocomplete
// @desc    Get business cards for participant autocomplete
// @access  Private
router.get('/contacts-autocomplete', async (req, res) => {
  try {
    const { search } = req.query;
    
    // Get all business cards for user (with optional search)
    const cards = await BusinessCard.findByUserId(req.user.id, {
      search,
      page: 1,
      limit: 50 // Limit for autocomplete
    });

    // Transform to autocomplete format
    const contacts = cards.map(card => ({
      id: card.id,
      name: card.name,
      company: card.company,
      position: card.position,
      displayText: `${card.name}${card.company ? ` (${card.company})` : ''}${card.position ? ` - ${card.position}` : ''}`
    }));

    res.json({
      success: true,
      data: contacts
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   GET /api/calendar/upcoming-alerts
// @desc    Get events starting soon (for 5-minute alerts) with linked card info
// @access  Private
router.get('/upcoming-alerts', async (req, res) => {
  try {
    const { minutes = 5 } = req.query;
    
    const events = await Event.findUpcomingEvents(req.user.id, parseInt(minutes));

    // For each event with linked cards, get memo and preference info
    const eventsWithDetails = await Promise.all(events.map(async (event) => {
      if (event.linkedCardIds && event.linkedCardIds.length > 0) {
        const cardDetails = await Promise.all(event.linkedCardIds.map(async (cardId) => {
          const [memos, preferenceProfile] = await Promise.all([
            Memo.findByBusinessCardId(cardId, req.user.id),
            PreferenceProfile.findByBusinessCardId(cardId)
          ]);
          
          const card = event.linkedCards.find(c => c.id === cardId);
          return {
            ...card,
            memos: memos || [],
            preferenceProfile: preferenceProfile || null
          };
        }));
        
        return {
          ...event,
          linkedCards: cardDetails
        };
      }
      return event;
    }));

    res.json({
      success: true,
      data: eventsWithDetails
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   GET /api/calendar/recently-ended
// @desc    Get events that recently ended (for memo prompt)
// @access  Private
router.get('/recently-ended', async (req, res) => {
  try {
    const { minutes = 5 } = req.query;
    
    const events = await Event.findRecentlyEndedEvents(req.user.id, parseInt(minutes));

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

// @route   GET /api/calendar/events/:id/with-cards
// @desc    Get single event with linked card details
// @access  Private
router.get('/events/:id/with-cards', async (req, res) => {
  try {
    const event = await Event.findByIdWithCards(req.params.id, req.user.id);

    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Get memo and preference info for linked cards
    if (event.linkedCardIds && event.linkedCardIds.length > 0) {
      const cardDetails = await Promise.all(event.linkedCardIds.map(async (cardId) => {
        const [memos, preferenceProfile] = await Promise.all([
          Memo.findByBusinessCardId(cardId, req.user.id),
          PreferenceProfile.findByBusinessCardId(cardId)
        ]);
        
        const card = event.linkedCards.find(c => c.id === cardId);
        return {
          ...card,
          memos: memos || [],
          preferenceProfile: preferenceProfile || null
        };
      }));
      
      event.linkedCards = cardDetails;
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
  body('startDate').notEmpty().isString(),
  body('endDate').notEmpty().isString(),
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

