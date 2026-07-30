const fs = require('fs');
const path = require('path');
const { query } = require('../config/db');
const { validate, rules, sendValidationError } = require('../middlewares/validate');

class VolunteerController {
  /**
   * GET /api/v1/users?page=1&search=...
   * API 6 — List Freecomers users for volunteer assignment
   */
  static async getUsers(req, res, festival_id) {
    try {
      const page = parseInt(req.query.page) || 1;
      const search = req.query.search ? `%${req.query.search}%` : null;
      const perPage = 10;
      const offset = (page - 1) * perPage;

      const conditions = [
        `u.status = 1`,
        `u.account_type = 'individual'`,
        `(i.describes_me IS NULL OR i.describes_me != 'Film Festival / Event Organizer')`,
        // Exclude individual accounts whose email also belongs to an organization
        // account that owns at least one un-deleted festival event.
        `NOT EXISTS (
          SELECT 1 FROM users org_u
          INNER JOIN organizations org ON org_u.id = org.user_id
          WHERE LOWER(org_u.email) = LOWER(u.email)
            AND org_u.account_type = 'organization'
            AND (
              EXISTS (
                SELECT 1 FROM events e
                WHERE e.user_id = org_u.id AND e.event_type = 'film_festival'
                  AND (e.is_deleted = 0 OR e.is_deleted IS NULL)
              )
              OR EXISTS (
                SELECT 1 FROM film_festivals ff
                WHERE ff.user_id = org_u.id
                  AND (ff.is_deleted = 0 OR ff.is_deleted IS NULL)
              )
            )
        )`
      ];
      const params = [];
      const targetFestivalId = req.params.festival_id || (typeof festival_id !== 'function' && festival_id ? festival_id : null);
      const parsedFestivalId = targetFestivalId ? parseInt(targetFestivalId, 10) : null;
      const selectParams = parsedFestivalId ? [parsedFestivalId] : [];

      const roleFilter = (req.query.role || '').toLowerCase().trim();
      if (parsedFestivalId) {
        if (roleFilter === 'registration') {
          conditions.push(`JSON_CONTAINS(sv.roles, ?)`);
          params.push(JSON.stringify('registration'));
        } else if (roleFilter === 'checkin' || roleFilter === 'check-in' || roleFilter === 'check_in') {
          conditions.push(`JSON_CONTAINS(sv.roles, ?)`);
          params.push(JSON.stringify('checkin'));
        } else if (roleFilter === 'unassigned') {
          conditions.push(`sv.volunteer_id IS NULL`);
        }
      }

      // Exclude festival owner's individual account / requester's email
      const ownerEmailsSet = new Set();
      if (req.user && req.user.email) {
        ownerEmailsSet.add(req.user.email.trim().toLowerCase());
      }
      if (parsedFestivalId) {
        const [ownerRows] = await query(`
          SELECT u.email FROM users u WHERE u.id IN (
            SELECT e.user_id FROM film_festivals ff JOIN events e ON ff.event_id = e.event_id WHERE ff.film_festival_id = ?
            UNION
            SELECT ff.user_id FROM film_festivals ff WHERE ff.film_festival_id = ?
          )
        `, [parsedFestivalId, parsedFestivalId]);

        for (const row of ownerRows) {
          if (row.email) ownerEmailsSet.add(row.email.trim().toLowerCase());
        }
      }

      const ownerEmails = Array.from(ownerEmailsSet);
      if (ownerEmails.length > 0) {
        conditions.push(`LOWER(u.email) NOT IN (${ownerEmails.map(() => '?').join(',')})`);
        params.push(...ownerEmails);
      }

      if (search) {
        conditions.push(`(
          i.name LIKE ? OR i.username LIKE ? OR u.email LIKE ?
        )`);
        params.push(search, search, search);
      }

      const sortParam = (req.query.sort || '').toLowerCase().trim();
      const orderDir = (sortParam === 'des' || sortParam === 'desc') ? 'DESC' : 'ASC';

      const where = `WHERE ${conditions.join(' AND ')}`;

      const [rows] = await query(`
        SELECT
          u.id AS user_id,
          u.account_type,
          u.email,
          i.name AS name,
          i.username AS username,
          i.image_name AS image_name,
          i.headline AS headline,
          ${parsedFestivalId ? 'sv.roles AS sv_roles, sv.expiry_date AS expiry_date, sv.is_active AS is_active, CASE WHEN sv.volunteer_id IS NOT NULL THEN 1 ELSE 0 END AS is_assigned' : 'NULL AS sv_roles, NULL AS expiry_date, NULL AS is_active, 0 AS is_assigned'}
        FROM users u
        INNER JOIN individuals i ON u.id = i.user_id
        ${parsedFestivalId ? 'LEFT JOIN saas_volunteers sv ON u.id = sv.user_id AND sv.festival_id = ?' : ''}
        ${where}
        ORDER BY u.id ${orderDir}
        LIMIT ? OFFSET ?
      `, [...selectParams, ...params, perPage, offset]);

      const [[{ total }]] = await query(`
        SELECT COUNT(DISTINCT u.id) AS total
        FROM users u
        INNER JOIN individuals i ON u.id = i.user_id
        ${parsedFestivalId ? 'LEFT JOIN saas_volunteers sv ON u.id = sv.user_id AND sv.festival_id = ?' : ''}
        ${where}
      `, [...selectParams, ...params]);

      // Attach profile pic URLs and parse roles
      const authPrefix = (process.env.auth_image_url_prefix || 'https://api.autovertest.com/api/v1/retrieve-media').replace(/\/+$/, '');
      const data = rows.map(row => {
        let roles = [];
        if (row.sv_roles) {
          if (typeof row.sv_roles === 'string') {
            try {
              roles = JSON.parse(row.sv_roles);
            } catch (e) {
              roles = [row.sv_roles];
            }
          } else if (Array.isArray(row.sv_roles)) {
            roles = row.sv_roles;
          }
        }
        let formattedExpiryDate = null;
        if (row.expiry_date) {
          const d = new Date(row.expiry_date);
          if (!isNaN(d.getTime())) {
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const yyyy = d.getFullYear();
            formattedExpiryDate = `${dd}-${mm}-${yyyy}`;
          } else {
            formattedExpiryDate = row.expiry_date;
          }
        }

        return {
          user_id: row.user_id,
          account_type: row.account_type,
          email: row.email,
          name: row.name,
          username: row.username,
         // profile_pic: row.image_name ? `${authPrefix}/images/users/${row.image_name}` : null,
          thumbnail_pic: row.image_name ? `${authPrefix}/images/users/thumb_${row.image_name}` : null,
          is_assigned: !!row.is_assigned,
          roles: Array.isArray(roles) ? roles : [roles],
          expiry_date: formattedExpiryDate,
          is_active: row.is_active == 1 ? true : false
        };
      });

      return res.json({
        success: true,
        data,
        current_page: page,
        total_records: total,
        total_page: Math.ceil(total / perPage),
        per_page: perPage,
        last_page: Math.ceil(total / perPage),
        
      });
    } catch (err) {
      console.error('getUsers error:', err.message);
      return res.status(500).json({ success: false, message: 'Failed to fetch users.' });
    }
  }

  /**
   * GET /api/v1/users/:user_id
   * API 7 — Single user details
   */
  static async getUserById(req, res) {
    try {
      const userId = parseInt(req.params.user_id);
      if (isNaN(userId)) {
        return res.status(400).json({ success: false, message: 'Invalid user ID.' });
      }

      const [rows] = await query(`
        SELECT
          u.id AS user_id, u.account_type, u.email,
          CASE WHEN i.name IS NOT NULL THEN i.name ELSE o.name END AS name,
          CASE WHEN i.username IS NOT NULL THEN i.username ELSE o.username END AS username,
          CASE WHEN i.headline IS NOT NULL THEN i.headline ELSE o.headline END AS headline,
          CASE WHEN i.bio IS NOT NULL THEN i.bio ELSE o.bio END AS bio,
          CASE WHEN i.image_name IS NOT NULL THEN i.image_name ELSE o.image_name END AS image_name
        FROM users u
        LEFT JOIN individuals i ON u.id = i.user_id
        LEFT JOIN organizations o ON u.id = o.user_id
        WHERE u.id = ? LIMIT 1
      `, [userId]);

      if (!rows.length) {
        return res.status(404).json({ success: false, message: 'User not found.' });
      }

      const row = rows[0];
      const authPrefix = process.env.auth_image_url_prefix || '';
      return res.json({
        success: true,
        data: {
          ...row,
          profile_pic: row.image_name ? `${authPrefix}/images/users/${row.image_name}` : null,
          thumbnail_pic: row.image_name ? `${authPrefix}/images/users/thumb_${row.image_name}` : null,
          image_name: undefined
        }
      });
    } catch (err) {
      console.error('getUserById error:', err.message);
      return res.status(500).json({ success: false, message: 'Failed to fetch user.' });
    }
  }

  /**
   * POST /api/v1/festival/volunteers
   * API 8 — Assign role to single user or bulk assign roles
   * Body (single): { user_id, role_id }
   * Body (bulk):   { users: [{ user_id, role_id }] }
   */
  static async assignVolunteer(req, res) {
    try {
      // Log request body to api.log immediately upon entering the controller
      const logFilePath = path.join(__dirname, '../logs/api.log');
      const logEntry = `[${new Date().toISOString()}] ------req body-------user id ${JSON.stringify(req.body)}\n`;
      fs.appendFile(logFilePath, logEntry, (err) => {
        if (err) console.error('Failed to write to api.log:', err);
      });
      console.log("------req body-------user id", req.body);

      const festivalId = parseInt(req.params.festival_id || req.body.festival_id);
      if (!festivalId) {
        return res.status(400).json({ success: false, message: 'festival_id is required.' });
      }

      // Resolve event_id internally from film_festivals
      const [festRows] = await query(
        'SELECT event_id FROM film_festivals WHERE film_festival_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1',
        [festivalId]
      );
      if (festRows.length === 0) {
        return res.status(404).json({ success: false, message: 'Film festival not found.' });
      }
      const eventId = festRows[0].event_id;

      // Pre-process DD-MM-YYYY date format to YYYY-MM-DD (e.g. "31-07-2026" -> "2026-07-31")
      if (typeof req.body?.expiry_date === 'string' && /^\d{2}-\d{2}-\d{4}$/.test(req.body.expiry_date.trim())) {
        const [dd, mm, yyyy] = req.body.expiry_date.trim().split('-');
        req.body.expiry_date = `${yyyy}-${mm}-${dd}`;
      }

      const { user_id, roles, expiry_date, is_active } = req.body || {};

      // --- Validation ---
      const result = validate(req.body, {
        user_id:     [rules.required(), rules.positiveInt()],
        roles:       [rules.required(), rules.array()],
        expiry_date: [rules.required(), rules.date(), rules.futureDate()],
        is_active:   [rules.required(), rules.boolean()],
      });

      const ALLOWED_ROLES = ['registration', 'checkin'];
      if (Array.isArray(roles)) {
        const invalidRoles = roles.filter(r => !ALLOWED_ROLES.includes(r));
        if (invalidRoles.length > 0) {
          result.valid = false;
          result.errors.roles = result.errors.roles || [];
          result.errors.roles.push(`The roles field must only contain: ${ALLOWED_ROLES.join(', ')}.`);
        }
      }

      if (!result.valid) return sendValidationError(res, result.errors);

      // Convert expiry_date to MySQL DATETIME string
      const dateObj = new Date(Date.parse(expiry_date));
      const mysqlDate = dateObj.getFullYear() + '-' +
        String(dateObj.getMonth() + 1).padStart(2, '0') + '-' +
        String(dateObj.getDate()).padStart(2, '0') + ' ' +
        String(dateObj.getHours()).padStart(2, '0') + ':' +
        String(dateObj.getMinutes()).padStart(2, '0') + ':' +
        String(dateObj.getSeconds()).padStart(2, '0');

      // --- DB Existence Checks ---
      const dbErrors = {};

      // Check if user_id exists
      const [userExistRows] = await query('SELECT 1 FROM users WHERE id = ? LIMIT 1', [parseInt(user_id)]);
      if (userExistRows.length === 0) dbErrors.user_id = ['The selected user_id is invalid.'];

      if (Object.keys(dbErrors).length === 0) {
        // Check user is an individual account
        const [userRows] = await query(
          "SELECT 1 FROM users WHERE id = ? AND account_type = 'individual' LIMIT 1",
          [parseInt(user_id)]
        );
        if (userRows.length === 0) {
          dbErrors.user_id = ['The selected user_id must be an individual account.'];
        }
      }

      if (Object.keys(dbErrors).length > 0) {
        return sendValidationError(res, dbErrors);
      }

      const rolesJson = JSON.stringify(roles);
      const isActiveValue = is_active ? 1 : 0;

      const [existing] = await query(
        'SELECT volunteer_id FROM saas_volunteers WHERE user_id = ? AND festival_id = ? AND event_id = ? LIMIT 1',
        [parseInt(user_id), festivalId, eventId]
      );

      let isUpdate = false;

      if (existing.length > 0) {
        isUpdate = true;
        await query(
          'UPDATE saas_volunteers SET roles = ?, event_id = ?, expiry_date = ?, is_active = ?, updated_at = NOW() WHERE volunteer_id = ?',
          [rolesJson, eventId, mysqlDate, isActiveValue, existing[0].volunteer_id]
        );
      } else {
        await query(
          'INSERT INTO saas_volunteers (user_id, festival_id, event_id, roles, expiry_date, is_active, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, \'active\', NOW(), NOW())',
          [parseInt(user_id), festivalId, eventId, rolesJson, mysqlDate, isActiveValue]
        );
      }

      return res.json({
        success: true,
        message: isUpdate ? 'Volunteer updated successfully.' : 'Volunteer assigned successfully.',
        data: {
          user_id,
          success: true
        }
      });

    } catch (err) {
      console.error('assignVolunteer error:', err.message);
      return res.status(500).json({
        success: false,
        message: 'Failed to assign volunteer.'
      });
    }
  }
}

module.exports = VolunteerController;
