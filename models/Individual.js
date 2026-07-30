const { query } = require('../config/db');
const { getProfilePic, getThumbnailPic } = require('../utils/media');

function formatIndividual(row) {
  if (!row) return null;
  return {
    ...row,
    profile_pic: getProfilePic(row.image_name),
    thumbnail_pic: getThumbnailPic(row.image_name)
  };
}

class Individual {
  /**
   * Find individual profile by user_id
   */
  static async findByUserId(userId) {
    const [rows] = await query(
      `SELECT id, user_id, name, username, pronouns, describes_me, phone, headline, dob, bio, engagement, is_mentor, image_name, created_at, updated_at
       FROM individuals WHERE user_id = ? LIMIT 1`,
      [userId]
    );
    return rows.length > 0 ? formatIndividual(rows[0]) : null;
  }

  /**
   * Find individual profile by ID
   */
  static async findById(id) {
    const [rows] = await query(
      `SELECT id, user_id, name, username, pronouns, describes_me, phone, headline, dob, bio, engagement, is_mentor, image_name, created_at, updated_at
       FROM individuals WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows.length > 0 ? formatIndividual(rows[0]) : null;
  }

  /**
   * Find individual profile by username
   */
  static async findByUsername(username) {
    const [rows] = await query(
      `SELECT id, user_id, name, username, pronouns, describes_me, phone, headline, dob, bio, engagement, is_mentor, image_name, created_at, updated_at
       FROM individuals WHERE username = ? LIMIT 1`,
      [username.trim()]
    );
    return rows.length > 0 ? formatIndividual(rows[0]) : null;
  }

  /**
   * Create a new individual profile
   */
  static async create(data) {
    const {
      user_id,
      name,
      username,
      pronouns = null,
      describes_me = null,
      phone = null,
      headline = null,
      dob = null,
      bio = null,
      engagement = null,
      is_mentor = 0,
      image_name = null
    } = data;

    const [result] = await query(
      `INSERT INTO individuals (user_id, name, username, pronouns, describes_me, phone, headline, dob, bio, engagement, is_mentor, image_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [user_id, name, username, pronouns, describes_me, phone, headline, dob, bio, engagement, is_mentor, image_name]
    );

    return result.insertId;
  }

  /**
   * Update individual profile by user_id
   */
  static async updateByUserId(userId, data) {
    const fields = [];
    const values = [];

    const allowedFields = ['name', 'username', 'pronouns', 'describes_me', 'phone', 'headline', 'dob', 'bio', 'engagement', 'is_mentor', 'image_name'];

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        fields.push(`${field} = ?`);
        values.push(data[field]);
      }
    }

    if (fields.length === 0) return false;

    fields.push('updated_at = NOW()');
    values.push(userId);

    const [result] = await query(
      `UPDATE individuals SET ${fields.join(', ')} WHERE user_id = ?`,
      values
    );

    return result.affectedRows > 0;
  }
}

module.exports = Individual;
