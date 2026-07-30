const { query } = require('../config/db');
const { getProfilePic, getThumbnailPic } = require('../utils/media');

function formatOrganization(row) {
  if (!row) return null;
  return {
    ...row,
    profile_pic: getProfilePic(row.image_name),
    thumbnail_pic: getThumbnailPic(row.image_name)
  };
}

class Organization {
  /**
   * Find organization profile by user_id
   */
  static async findByUserId(userId) {
    const [rows] = await query(
      `SELECT id, user_id, name, username, describes_me, phone, headline, bio, organization_industry_id, website, address, show_email, show_phone, organization_type_id, is_freelance, company_size, founding_year, image_name, created_at, updated_at
       FROM organizations WHERE user_id = ? LIMIT 1`,
      [userId]
    );
    return rows.length > 0 ? formatOrganization(rows[0]) : null;
  }

  /**
   * Find organization profile by ID
   */
  static async findById(id) {
    const [rows] = await query(
      `SELECT id, user_id, name, username, describes_me, phone, headline, bio, organization_industry_id, website, address, show_email, show_phone, organization_type_id, is_freelance, company_size, founding_year, image_name, created_at, updated_at
       FROM organizations WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows.length > 0 ? formatOrganization(rows[0]) : null;
  }

  /**
   * Find organization profile by username
   */
  static async findByUsername(username) {
    const [rows] = await query(
      `SELECT id, user_id, name, username, describes_me, phone, headline, bio, organization_industry_id, website, address, show_email, show_phone, organization_type_id, is_freelance, company_size, founding_year, image_name, created_at, updated_at
       FROM organizations WHERE username = ? LIMIT 1`,
      [username.trim()]
    );
    return rows.length > 0 ? formatOrganization(rows[0]) : null;
  }

  /**
   * Create a new organization profile
   */
  static async create(data) {
    const {
      user_id,
      name,
      username,
      describes_me = null,
      phone = null,
      headline = null,
      bio = null,
      organization_industry_id = null,
      website = null,
      address = null,
      show_email = 'yes',
      show_phone = 'no',
      organization_type_id = null,
      is_freelance = 0,
      company_size = null,
      founding_year = null,
      image_name = null
    } = data;

    const [result] = await query(
      `INSERT INTO organizations (user_id, name, username, describes_me, phone, headline, bio, organization_industry_id, website, address, show_email, show_phone, organization_type_id, is_freelance, company_size, founding_year, image_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        user_id, name, username, describes_me, phone, headline, bio,
        organization_industry_id, website,
        address ? JSON.stringify(address) : null,
        show_email, show_phone, organization_type_id, is_freelance,
        company_size, founding_year, image_name
      ]
    );

    return result.insertId;
  }

  /**
   * Update organization profile by user_id
   */
  static async updateByUserId(userId, data) {
    const fields = [];
    const values = [];

    const allowedFields = [
      'name', 'username', 'describes_me', 'phone', 'headline', 'bio',
      'organization_industry_id', 'website', 'address', 'show_email',
      'show_phone', 'organization_type_id', 'is_freelance', 'company_size',
      'founding_year', 'image_name'
    ];

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        fields.push(`${field} = ?`);
        values.push(field === 'address' && typeof data[field] === 'object' ? JSON.stringify(data[field]) : data[field]);
      }
    }

    if (fields.length === 0) return false;

    fields.push('updated_at = NOW()');
    values.push(userId);

    const [result] = await query(
      `UPDATE organizations SET ${fields.join(', ')} WHERE user_id = ?`,
      values
    );

    return result.affectedRows > 0;
  }
}

module.exports = Organization;
