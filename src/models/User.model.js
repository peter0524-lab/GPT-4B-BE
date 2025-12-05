import pool from "../config/database.js";

class User {
  // Find user by ID
  static async findById(id) {
    const [rows] = await pool.query(
      "SELECT id, username, email, name, phone, cardDesign, company, position, profileImage, oauthProvider, oauthId, subscription, cardLimit, isActive, createdAt, updatedAt FROM users WHERE id = ?",
      [id]
    );
    return rows[0] || null;
  }

  // Find user by username
  static async findByUsername(username) {
    const [rows] = await pool.query("SELECT * FROM users WHERE username = ?", [
      username,
    ]);
    return rows[0] || null;
  }

  // Find user by email
  static async findByEmail(email) {
    const [rows] = await pool.query("SELECT * FROM users WHERE email = ?", [
      email,
    ]);
    return rows[0] || null;
  }

  // Create new user
  static async create(userData) {
    const {
      email,
      username,
      password,
      cardDesign,
      name,
      phone,
      company,
      position,
      profileImage,
      oauthProvider,
      oauthId,
      subscription = "free",
      cardLimit = 200,
    } = userData;

    const [result] = await pool.query(
      `INSERT INTO users (email, username, password, cardDesign, name, phone, company, position, profileImage, oauthProvider, oauthId, subscription, cardLimit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        email,
        username,
        password,
        cardDesign,
        name,
        phone,
        company,
        position,
        profileImage,
        oauthProvider,
        oauthId,
        subscription,
        cardLimit,
      ]
    );

    return await this.findById(result.insertId);
  }

  // Update user
  static async update(id, updateData) {
    const fields = [];
    const values = [];

    Object.keys(updateData).forEach((key) => {
      if (updateData[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(updateData[key]);
      }
    });

    if (fields.length === 0) {
      return await this.findById(id);
    }

    values.push(id);
    await pool.query(
      `UPDATE users SET ${fields.join(", ")} WHERE id = ?`,
      values
    );

    return await this.findById(id);
  }

  // Delete user (soft delete)
  static async delete(id) {
    await pool.query("UPDATE users SET isActive = FALSE WHERE id = ?", [id]);
    return true;
  }
}

export default User;
