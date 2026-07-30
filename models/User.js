const { query } = require('../config/db');
const Individual = require('./Individual');
const Organization = require('./Organization');

class User {
  /**
   * Find a user by email address (returns first match)
   */
  static async findByEmail(email) {
    const [rows] = await query(
      'SELECT id, account_type, email, password, status FROM users WHERE email = ? LIMIT 1',
      [email.trim().toLowerCase()]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Find all user accounts matching an email address
   */
  static async findAllByEmail(email) {
    const [rows] = await query(
      'SELECT id, account_type, email, password, status FROM users WHERE email = ?',
      [email.trim().toLowerCase()]
    );
    return rows;
  }

  /**
   * Find a user by ID
   */
  static async findById(id) {
    const [rows] = await query(
      'SELECT id, account_type, email, status, is_verified, created_at FROM users WHERE id = ? LIMIT 1',
      [id]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Get full profile for a user (Individual or Organization depending on account_type)
   * Falls back to checking both profile tables if primary returns null.
   */
  static async getProfile(userId) {
    const user = await this.findById(userId);
    if (!user) return null;

    let profile = null;
    if (user.account_type === 'individual') {
      profile = await Individual.findByUserId(userId);
      if (!profile) {
        profile = await Organization.findByUserId(userId);
      }
    } else if (user.account_type === 'organization') {
      profile = await Organization.findByUserId(userId);
      if (!profile) {
        profile = await Individual.findByUserId(userId);
      }
    } else {
      profile = (await Individual.findByUserId(userId)) || (await Organization.findByUserId(userId));
    }

    return {
      ...user,
      profile
    };
  }

  /**
   * Update user password
   */
  static async updatePassword(userId, passwordHash) {
    const [result] = await query(
      'UPDATE users SET password = ? WHERE id = ?',
      [passwordHash, userId]
    );
    return result.affectedRows > 0;
  }
}

module.exports = User;
