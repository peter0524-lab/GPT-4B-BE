import pool from '../config/database.js';

class Event {
  // Find events for a user within date range
  static async findByUserId(userId, startDate = null, endDate = null) {
    let query = 'SELECT * FROM events WHERE userId = ?';
    const params = [userId];

    if (startDate && endDate) {
      query += ' AND startDate >= ? AND startDate <= ?';
      params.push(startDate, endDate);
    }

    query += ' ORDER BY startDate ASC';

    const [rows] = await pool.query(query, params);
    
    // Convert participants and linked_card_ids for each event
    return rows.map(event => ({
      ...event,
      participants: event.participants ? event.participants.split(', ').filter(p => p) : [],
      linkedCardIds: event.linked_card_ids ? event.linked_card_ids.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : []
    }));
  }

  // Find event by ID
  static async findById(id, userId = null) {
    let query = 'SELECT * FROM events WHERE id = ?';
    const params = [id];

    if (userId) {
      query += ' AND userId = ?';
      params.push(userId);
    }

    const [rows] = await pool.query(query, params);
    return rows[0] || null;
  }

  // Create new event
  static async create(eventData) {
    const {
      userId,
      title,
      startDate,
      endDate,
      category = '기타',
      color = '#9ca3af',
      description,
      location,
      participants,
      memo,
      notification,
      googleCalendarEventId,
      isAllDay = false,
      linkedCardIds = null
    } = eventData;

    // Convert participants array to comma-separated string
    const participantsStr = Array.isArray(participants) ? participants.join(', ') : participants;
    // Convert linkedCardIds array to comma-separated string
    const linkedCardIdsStr = Array.isArray(linkedCardIds) ? linkedCardIds.join(',') : linkedCardIds;

    const [result] = await pool.query(
      `INSERT INTO events (userId, title, startDate, endDate, category, color, description, location, participants, memo, notification, googleCalendarEventId, isAllDay, linked_card_ids)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, title, startDate, endDate, category, color, description, location, participantsStr, memo, notification, googleCalendarEventId, isAllDay, linkedCardIdsStr]
    );

    const event = await this.findById(result.insertId);
    // Convert participants string back to array
    if (event && event.participants) {
      event.participants = event.participants.split(', ').filter(p => p);
    }
    // Convert linked_card_ids string back to array
    if (event && event.linked_card_ids) {
      event.linkedCardIds = event.linked_card_ids.split(',').map(id => parseInt(id)).filter(id => !isNaN(id));
    }
    return event;
  }

  // Update event
  static async update(id, userId, updateData) {
    const fields = [];
    const values = [];

    // Handle participants array
    if (updateData.participants && Array.isArray(updateData.participants)) {
      updateData.participants = updateData.participants.join(', ');
    }

    // Handle linkedCardIds array
    if (updateData.linkedCardIds && Array.isArray(updateData.linkedCardIds)) {
      updateData.linked_card_ids = updateData.linkedCardIds.join(',');
      delete updateData.linkedCardIds;
    }

    Object.keys(updateData).forEach(key => {
      if (updateData[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(updateData[key]);
      }
    });

    if (fields.length === 0) {
      return await this.findById(id, userId);
    }

    values.push(id, userId);
    await pool.query(
      `UPDATE events SET ${fields.join(', ')} WHERE id = ? AND userId = ?`,
      values
    );

    const event = await this.findById(id, userId);
    // Convert participants string back to array
    if (event && event.participants) {
      event.participants = event.participants.split(', ').filter(p => p);
    }
    // Convert linked_card_ids string back to array
    if (event && event.linked_card_ids) {
      event.linkedCardIds = event.linked_card_ids.split(',').map(id => parseInt(id)).filter(id => !isNaN(id));
    }
    return event;
  }

  // Delete event
  static async delete(id, userId) {
    const [result] = await pool.query(
      'DELETE FROM events WHERE id = ? AND userId = ?',
      [id, userId]
    );
    return result.affectedRows > 0;
  }

  // Find upcoming events within a time range (for notifications)
  static async findUpcomingEvents(userId, minutesBefore = 5) {
    const now = new Date();
    const targetTime = new Date(now.getTime() + minutesBefore * 60 * 1000);
    
    // Find events that start within the next 'minutesBefore' minutes
    const query = `
      SELECT e.*, 
             GROUP_CONCAT(bc.id) as card_ids,
             GROUP_CONCAT(bc.name) as card_names,
             GROUP_CONCAT(bc.company) as card_companies,
             GROUP_CONCAT(bc.position) as card_positions
      FROM events e
      LEFT JOIN business_cards bc ON FIND_IN_SET(bc.id, e.linked_card_ids) > 0 AND bc.userId = e.userId
      WHERE e.userId = ?
        AND e.startDate > ?
        AND e.startDate <= ?
      GROUP BY e.id
      ORDER BY e.startDate ASC
    `;
    
    const [rows] = await pool.query(query, [userId, now, targetTime]);
    return rows.map(row => ({
      ...row,
      participants: row.participants ? row.participants.split(', ').filter(p => p) : [],
      linkedCardIds: row.linked_card_ids ? row.linked_card_ids.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : [],
      linkedCards: row.card_ids ? row.card_ids.split(',').map((id, index) => ({
        id: parseInt(id),
        name: row.card_names ? row.card_names.split(',')[index] : null,
        company: row.card_companies ? row.card_companies.split(',')[index] : null,
        position: row.card_positions ? row.card_positions.split(',')[index] : null
      })).filter(card => card.id && !isNaN(card.id)) : []
    }));
  }

  // Find events that have ended recently (for memo prompt)
  static async findRecentlyEndedEvents(userId, minutesAfter = 5) {
    const now = new Date();
    const pastTime = new Date(now.getTime() - minutesAfter * 60 * 1000);
    
    const query = `
      SELECT e.*, 
             GROUP_CONCAT(bc.id) as card_ids,
             GROUP_CONCAT(bc.name) as card_names
      FROM events e
      LEFT JOIN business_cards bc ON FIND_IN_SET(bc.id, e.linked_card_ids) > 0 AND bc.userId = e.userId
      WHERE e.userId = ?
        AND e.endDate >= ?
        AND e.endDate <= ?
        AND e.linked_card_ids IS NOT NULL
        AND e.linked_card_ids != ''
      GROUP BY e.id
      ORDER BY e.endDate DESC
    `;
    
    const [rows] = await pool.query(query, [userId, pastTime, now]);
    return rows.map(row => ({
      ...row,
      participants: row.participants ? row.participants.split(', ').filter(p => p) : [],
      linkedCardIds: row.linked_card_ids ? row.linked_card_ids.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : [],
      linkedCards: row.card_ids ? row.card_ids.split(',').map((id, index) => ({
        id: parseInt(id),
        name: row.card_names ? row.card_names.split(',')[index] : null
      })).filter(card => card.id && !isNaN(card.id)) : []
    }));
  }

  // Find event with linked card details
  static async findByIdWithCards(id, userId) {
    const query = `
      SELECT e.*, 
             GROUP_CONCAT(bc.id) as card_ids,
             GROUP_CONCAT(bc.name) as card_names,
             GROUP_CONCAT(bc.company) as card_companies,
             GROUP_CONCAT(bc.position) as card_positions,
             GROUP_CONCAT(bc.phone) as card_phones,
             GROUP_CONCAT(bc.email) as card_emails
      FROM events e
      LEFT JOIN business_cards bc ON FIND_IN_SET(bc.id, e.linked_card_ids) > 0 AND bc.userId = e.userId
      WHERE e.id = ? AND e.userId = ?
      GROUP BY e.id
    `;
    
    const [rows] = await pool.query(query, [id, userId]);
    if (!rows[0]) return null;
    
    const row = rows[0];
    return {
      ...row,
      participants: row.participants ? row.participants.split(', ').filter(p => p) : [],
      linkedCardIds: row.linked_card_ids ? row.linked_card_ids.split(',').map(id => parseInt(id)).filter(id => !isNaN(id)) : [],
      linkedCards: row.card_ids ? row.card_ids.split(',').map((id, index) => ({
        id: parseInt(id),
        name: row.card_names ? row.card_names.split(',')[index] : null,
        company: row.card_companies ? row.card_companies.split(',')[index] : null,
        position: row.card_positions ? row.card_positions.split(',')[index] : null,
        phone: row.card_phones ? row.card_phones.split(',')[index] : null,
        email: row.card_emails ? row.card_emails.split(',')[index] : null
      })).filter(card => card.id && !isNaN(card.id)) : []
    };
  }
}

export default Event;
