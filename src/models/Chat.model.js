import pool from '../config/database.js';

class Chat {
  // Find all chats for a user
  static async findByUserId(userId, isActive = true) {
    const [rows] = await pool.query(
      `SELECT id, userId, llmProvider, title, isActive, createdAt, updatedAt,
       JSON_LENGTH(messages) as messageCount
       FROM chats
       WHERE userId = ? AND isActive = ?
       ORDER BY updatedAt DESC`,
      [userId, isActive]
    );
    return rows;
  }

  // Find chat by ID
  static async findById(id, userId = null) {
    let query = 'SELECT * FROM chats WHERE id = ?';
    const params = [id];

    if (userId) {
      query += ' AND userId = ?';
      params.push(userId);
    }

    const [rows] = await pool.query(query, params);
    if (rows[0]) {
      // Parse JSON messages
      rows[0].messages = JSON.parse(rows[0].messages || '[]');
    }
    return rows[0] || null;
  }

  // Create new chat
  static async create(chatData) {
    const {
      userId,
      llmProvider = 'gpt',
      title,
      messages = []
    } = chatData;

    const [result] = await pool.query(
      `INSERT INTO chats (userId, llmProvider, title, messages, isActive)
       VALUES (?, ?, ?, ?, TRUE)`,
      [userId, llmProvider, title, JSON.stringify(messages)]
    );

    return await this.findById(result.insertId);
  }

  // Update chat (mainly for adding messages)
  static async update(id, userId, updateData) {
    const fields = [];
    const values = [];

    // Handle messages array
    if (updateData.messages && Array.isArray(updateData.messages)) {
      updateData.messages = JSON.stringify(updateData.messages);
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
      `UPDATE chats SET ${fields.join(', ')}, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND userId = ?`,
      values
    );

    const chat = await this.findById(id, userId);
    return chat;
  }

  // Soft delete chat
  static async delete(id, userId) {
    const [result] = await pool.query(
      'UPDATE chats SET isActive = FALSE WHERE id = ? AND userId = ?',
      [id, userId]
    );
    return result.affectedRows > 0;
  }
}

export default Chat;
