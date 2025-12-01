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
    return rows;
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
      isAllDay = false
    } = eventData;

    // Convert participants array to comma-separated string
    const participantsStr = Array.isArray(participants) ? participants.join(', ') : participants;

    const [result] = await pool.query(
      `INSERT INTO events (userId, title, startDate, endDate, category, color, description, location, participants, memo, notification, googleCalendarEventId, isAllDay)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, title, startDate, endDate, category, color, description, location, participantsStr, memo, notification, googleCalendarEventId, isAllDay]
    );

    const event = await this.findById(result.insertId);
    // Convert participants string back to array
    if (event && event.participants) {
      event.participants = event.participants.split(', ').filter(p => p);
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
}

export default Event;
