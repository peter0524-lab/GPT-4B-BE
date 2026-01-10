import pool from '../config/database.js';

class PreferenceEvent {
  // Create preference event
  static async create(eventData) {
    const { businessCardId, memoId, polarity, item, evidence, confidence = 0.5 } = eventData;

    const [result] = await pool.query(
      `INSERT INTO preference_event 
       (business_card_id, memo_id, polarity, item, evidence, confidence) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [businessCardId, memoId, polarity, item, evidence, confidence]
    );

    return await this.findById(result.insertId);
  }

  // Find event by ID
  static async findById(id) {
    const [rows] = await pool.query(
      'SELECT * FROM preference_event WHERE id = ?',
      [id]
    );
    return rows[0] || null;
  }

  // Find events by business card ID
  static async findByBusinessCardId(businessCardId) {
    const [rows] = await pool.query(
      'SELECT * FROM preference_event WHERE business_card_id = ? ORDER BY created_at DESC',
      [businessCardId]
    );
    return rows;
  }

  // Delete events by business card ID (for rebuild)
  static async deleteByBusinessCardId(businessCardId) {
    const [result] = await pool.query(
      'DELETE FROM preference_event WHERE business_card_id = ?',
      [businessCardId]
    );
    return result.affectedRows;
  }
}

export default PreferenceEvent;
