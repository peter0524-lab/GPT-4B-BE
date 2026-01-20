import pool from "../config/database.js";

class BusinessCard {
  // Find all cards for a user
  static async findByUserId(userId, options = {}) {
    const { search, page = 1, limit = 20, cardIds = [] } = options;
    const offset = (page - 1) * limit;

    let query = "SELECT * FROM business_cards WHERE userId = ?";
    const params = [userId];

    if (Array.isArray(cardIds) && cardIds.length > 0) {
      const placeholders = cardIds.map(() => "?").join(", ");
      query += ` AND id IN (${placeholders})`;
      params.push(...cardIds);
    }

    if (search) {
      query += " AND (name LIKE ? OR company LIKE ? OR position LIKE ?)";
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    query += " ORDER BY createdAt DESC LIMIT ? OFFSET ?";
    params.push(parseInt(limit), offset);

    const [rows] = await pool.query(query, params);
    return rows;
  }

  // Count cards for a user
  static async countByUserId(userId, search = null, cardIds = []) {
    let query = "SELECT COUNT(*) as total FROM business_cards WHERE userId = ?";
    const params = [userId];

    if (Array.isArray(cardIds) && cardIds.length > 0) {
      const placeholders = cardIds.map(() => "?").join(", ");
      query += ` AND id IN (${placeholders})`;
      params.push(...cardIds);
    }

    if (search) {
      query += " AND (name LIKE ? OR company LIKE ? OR position LIKE ?)";
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern);
    }

    const [rows] = await pool.query(query, params);
    return rows[0].total;
  }

  // Find card by ID
  static async findById(id, userId = null) {
    let query = "SELECT * FROM business_cards WHERE id = ?";
    const params = [id];

    if (userId) {
      query += " AND userId = ?";
      params.push(userId);
    }

    const [rows] = await pool.query(query, params);
    return rows[0] || null;
  }

  // Create new card
  static async create(cardData) {
    const {
      userId,
      name,
      position,
      company,
      phone,
      email,
      memo,
      image,
      gender,
      design = "design-1",
      isFavorite = false,
    } = cardData;

    const [result] = await pool.query(
      `INSERT INTO business_cards (userId, name, position, company, phone, email, memo, image, gender, design, isFavorite)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        name,
        position,
        company,
        phone,
        email,
        memo,
        image,
        gender,
        design,
        isFavorite,
      ]
    );

    return await this.findById(result.insertId);
  }

  // Update card
  static async update(id, userId, updateData) {
    const fields = [];
    const values = [];

    Object.keys(updateData).forEach((key) => {
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
      `UPDATE business_cards SET ${fields.join(
        ", "
      )} WHERE id = ? AND userId = ?`,
      values
    );

    return await this.findById(id, userId);
  }

  // Delete card
  static async delete(id, userId) {
    const [result] = await pool.query(
      "DELETE FROM business_cards WHERE id = ? AND userId = ?",
      [id, userId]
    );
    return result.affectedRows > 0;
  }
}

export default BusinessCard;
