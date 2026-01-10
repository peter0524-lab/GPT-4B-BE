import pool from '../config/database.js';

class PreferenceProfile {
  // Find profile by business card ID
  static async findByBusinessCardId(businessCardId) {
    const [rows] = await pool.query(
      'SELECT * FROM preference_profile WHERE business_card_id = ?',
      [businessCardId]
    );
    return rows[0] || null;
  }

  // Create or update profile
  static async upsert(businessCardId, profileData) {
    const { likes, dislikes, uncertain, lastSourceCount } = profileData;

    // Convert arrays to JSON strings
    const likesJson = likes ? JSON.stringify(likes) : null;
    const dislikesJson = dislikes ? JSON.stringify(dislikes) : null;
    const uncertainJson = uncertain ? JSON.stringify(uncertain) : null;

    await pool.query(
      `INSERT INTO preference_profile 
       (business_card_id, likes, dislikes, uncertain, last_source_count) 
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
       likes = VALUES(likes),
       dislikes = VALUES(dislikes),
       uncertain = VALUES(uncertain),
       last_source_count = VALUES(last_source_count),
       updated_at = CURRENT_TIMESTAMP`,
      [businessCardId, likesJson, dislikesJson, uncertainJson, lastSourceCount || 0]
    );

    return await this.findByBusinessCardId(businessCardId);
  }

  // Delete profile
  static async delete(businessCardId) {
    const [result] = await pool.query(
      'DELETE FROM preference_profile WHERE business_card_id = ?',
      [businessCardId]
    );
    return result.affectedRows > 0;
  }
}

export default PreferenceProfile;
