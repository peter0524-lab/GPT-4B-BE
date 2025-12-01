import pool from '../config/database.js';

class Gift {
  // Find all gifts for a user
  static async findByUserId(userId, options = {}) {
    const { cardId, year } = options;

    let query = `
      SELECT g.*, bc.name as cardName, bc.company as cardCompany
      FROM gifts g
      LEFT JOIN business_cards bc ON g.cardId = bc.id
      WHERE g.userId = ?
    `;
    const params = [userId];

    if (cardId) {
      query += ' AND g.cardId = ?';
      params.push(cardId);
    }

    if (year) {
      query += ' AND g.year = ?';
      params.push(year);
    }

    query += ' ORDER BY g.purchaseDate DESC';

    const [rows] = await pool.query(query, params);
    return rows;
  }

  // Find gift by ID
  static async findById(id, userId = null) {
    let query = 'SELECT * FROM gifts WHERE id = ?';
    const params = [id];

    if (userId) {
      query += ' AND userId = ?';
      params.push(userId);
    }

    const [rows] = await pool.query(query, params);
    return rows[0] || null;
  }

  // Create new gift
  static async create(giftData) {
    const {
      userId,
      cardId,
      giftName,
      giftDescription,
      giftImage,
      price,
      category,
      occasion,
      notes,
      year = new Date().getFullYear().toString()
    } = giftData;

    const [result] = await pool.query(
      `INSERT INTO gifts (userId, cardId, giftName, giftDescription, giftImage, price, category, occasion, notes, year)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, cardId, giftName, giftDescription, giftImage, price, category, occasion, notes, year]
    );

    return await this.findById(result.insertId);
  }

  // Update gift
  static async update(id, userId, updateData) {
    const fields = [];
    const values = [];

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
      `UPDATE gifts SET ${fields.join(', ')} WHERE id = ? AND userId = ?`,
      values
    );

    return await this.findById(id, userId);
  }

  // Delete gift
  static async delete(id, userId) {
    const [result] = await pool.query(
      'DELETE FROM gifts WHERE id = ? AND userId = ?',
      [id, userId]
    );
    return result.affectedRows > 0;
  }
}

export default Gift;
