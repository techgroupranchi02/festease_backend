const { query } = require('../config/db');
const crypto = require('crypto');

/**
 * SaasAttendee model
 *
 * Reflects the new saas_attendees schema:
 *   attendee_id, event_id, festival_id, name, email, phone,
 *   registered_by_user_id, registered_by_role, volunteer_id,
 *   status, qr_token, registered_at, created_at, updated_at
 */
class SaasAttendee {
  /**
   * Generate a UUID v4 string for qr_token
   */
  static _uuid() {
    return crypto.randomUUID();
  }

  /**
   * Create a single attendee registration.
   *
   * @param {object} params
   * @param {number} params.festivalId
   * @param {number} params.eventId
   * @param {number} params.registeredByUserId
   * @param {string} params.registeredByRole  - 'admin' | 'volunteer'
   * @param {number|null} params.volunteerId  - nullable FK to saas_volunteers
   * @param {string} params.name
   * @param {string} params.email
   * @param {string} params.phone
   * @returns {{ id: number, qr_token: string }}
   */
  static async create({ festivalId, eventId, registeredByUserId, registeredByRole, volunteerId = null, qrId = null, name, email = null, phone = null, delegateCategory = null, registrationType = null }) {
    const qrToken = SaasAttendee._uuid();
    const cleanEmail = email && typeof email === 'string' && email.trim() ? email.trim() : null;
    const cleanPhone = phone && typeof phone === 'string' && phone.trim() ? phone.trim() : null;
    const [result] = await query(
      `INSERT INTO saas_attendees
         (event_id, festival_id, name, email, phone, delegate_category, registration_type,
          registered_by_user_id, registered_by_role, volunteer_id, qr_id,
          status, qr_token, registered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'registered', ?, NOW())`,
      [eventId, festivalId, name, cleanEmail, cleanPhone, delegateCategory, registrationType,
       registeredByUserId, registeredByRole, volunteerId || null, qrId || null,
       qrToken]
    );
    return { id: result.insertId, qr_token: qrToken };
  }

  /**
   * Check if an attendee with the same email exists for a festival (excluding cancelled ones)
   *
   * @param {string} email
   * @param {number} festivalId
   * @returns {boolean}
   */
  static async existsByEmail(email, festivalId) {
    if (!email || !email.trim()) return false;
    const [rows] = await query(
      'SELECT 1 FROM saas_attendees WHERE email = ? AND festival_id = ? AND status != \'cancelled\' LIMIT 1',
      [email.trim().toLowerCase(), festivalId]
    );
    return rows.length > 0;
  }

  /**
   * Bulk create attendee registrations from CSV rows.
   *
   * @param {Array}  rows
   * @param {number} festivalId
   * @param {number} eventId
   * @param {number} registeredByUserId
   * @param {string} registeredByRole
   * @param {number|null} volunteerId
   * @returns {Array}
   */
  static async bulkCreate(rows, festivalId, eventId, registeredByUserId, registeredByRole, volunteerId = null) {
    const results = [];
    const batchEmails = new Set();

    for (const row of rows) {
      try {
        const cleanEmail = (row.email || '').trim().toLowerCase();
        if (cleanEmail) {
          if (batchEmails.has(cleanEmail)) {
            throw new Error('Duplicate email in bulk upload.');
          }
          const emailExists = await this.existsByEmail(cleanEmail, festivalId);
          if (emailExists) {
            throw new Error('Email is already registered for this festival.');
          }
          batchEmails.add(cleanEmail);
        }

        const cleanPhone = (row.phone || '').trim();
        if (cleanPhone && cleanPhone.length < 10) {
          throw new Error('Phone must be at least 10 characters.');
        }

        // Find keys case-insensitively and normalize spaces/underscores
        const rowKeys = Object.keys(row);
        const findValue = (possibleKeys) => {
          const key = rowKeys.find(k => possibleKeys.includes(k.toLowerCase().replace(/_/g, ' ').trim()));
          return key ? (row[key] || '').trim() : '';
        };

        const delegateCategory = findValue(['delegate category', 'delegatecategory', 'delegate_category', 'category']);
        const registrationType = findValue(['registration type', 'registrationtype', 'registration_type', 'type']);

        const allowedCategories = ['Student', 'Senior Citizen', 'Filmmaker', 'Film Fraternity', 'Guest', 'General Delegate', 'Discovery Market', 'Echoes Film Club'];
        const matchedCategory = allowedCategories.find(c => c.toLowerCase() === delegateCategory.toLowerCase());
        if (!matchedCategory) {
          throw new Error(`Delegate Category must be one of: ${allowedCategories.join(', ')}.`);
        }

        const allowedTypes = ['Pre-Registered', 'On-Spot'];
        const cleanRegType = registrationType.toLowerCase().replace(/[\s\-_]/g, '');
        const matchedType = allowedTypes.find(t => t.toLowerCase().replace(/[\s\-_]/g, '') === cleanRegType);
        if (!matchedType) {
          throw new Error(`Registration Type must be one of: ${allowedTypes.join(', ')}.`);
        }

        const reg = await this.create({
          festivalId,
          eventId,
          registeredByUserId,
          registeredByRole,
          volunteerId,
          name:  row.name,
          email: cleanEmail || null,
          phone: cleanPhone || null,
          delegateCategory: matchedCategory,
          registrationType: matchedType,
        });
        results.push({
          ...row,
          ...reg,
          attendee_id: reg.id,
          delegate_category: matchedCategory,
          registration_type: matchedType,
          success: true
        });
      } catch (err) {
        results.push({ ...row, success: false, error: err.message });
      }
    }
    return results;
  }

  /**
   * Find attendee by primary key.
   *
   * @param {number} id - attendee_id
   * @returns {object|null}
   */
  static async findById(id) {
    const [rows] = await query(
      `SELECT
         sa.*,
         sa.attendee_id AS id,
         sq.qr_data,
         u.email AS registered_by_email,
         CASE WHEN i.name IS NOT NULL THEN i.name ELSE o.name END AS registered_by_name,
         ci.checkin_id,
         ci.check_in_at,
         ci.status       AS checkin_status,
         ci.checkin_venue_id,
         ci.remarks
       FROM saas_attendees sa
       LEFT JOIN saas_qr sq ON sa.qr_id = sq.qr_id
       LEFT JOIN users u   ON sa.registered_by_user_id = u.id
       LEFT JOIN individuals i ON u.id = i.user_id
       LEFT JOIN organizations o ON u.id = o.user_id
       LEFT JOIN saas_checkins ci ON sa.attendee_id = ci.attendee_id
       WHERE sa.attendee_id = ? LIMIT 1`,
      [id]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Find attendee by QR token.
   *
   * @param {string} qrToken
   * @returns {object|null}
   */
  static async findByQrToken(qrToken) {
    const [rows] = await query(
      `SELECT sa.*, sa.attendee_id AS id, sq.qr_data
       FROM saas_attendees sa
       LEFT JOIN saas_qr sq ON sa.qr_id = sq.qr_id
       WHERE sa.qr_token = ? LIMIT 1`,
      [qrToken]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Search / paginate attendee registrations.
   *
   * @param {object} params
   * @param {number} params.festivalId
   * @param {string} [params.search]
   * @param {number} [params.page=1]
   * @param {number} [params.perPage=20]
   * @param {string} [params.registeredByFilter]  - filter by registered_by_user_id
   * @param {string} [params.status]              - filter by status (e.g. 'cancelled')
   * @returns {{ data: Array, total: number, page: number, perPage: number }}
   */
  static async search({ festivalId, search, page = 1, perPage = 20, registeredByFilter = '', registeredByRole = '', status = '', sortBy = 'recent', delegateCategory = '', registrationType = '' }) {
    const offset = (page - 1) * perPage;
    const conditions = ['sa.festival_id = ?'];
    const params = [festivalId];

    if (status && status !== 'all') {
      conditions.push('sa.status = ?');
      params.push(status);
    }

    if (registeredByFilter && registeredByFilter !== 'all') {
      conditions.push('sa.registered_by_user_id = ?');
      params.push(registeredByFilter);
    }

    if (registeredByRole && registeredByRole !== 'all') {
      conditions.push('sa.registered_by_role = ?');
      params.push(registeredByRole);
    }

    if (delegateCategory && delegateCategory !== 'all') {
      conditions.push('sa.delegate_category = ?');
      params.push(delegateCategory);
    }

    if (registrationType && registrationType !== 'all') {
      conditions.push('sa.registration_type = ?');
      params.push(registrationType);
    }

    if (search) {
      conditions.push(`(
        sa.name LIKE ? OR sa.email LIKE ? OR sa.phone LIKE ?
        OR sa.qr_token = ? OR sa.attendee_id = ? OR sq.qr_data LIKE ?
        OR sa.delegate_category LIKE ? OR sa.registration_type LIKE ?
      )`);
      const like = `%${search}%`;
      params.push(like, like, like, search, isNaN(search) ? -1 : parseInt(search), like, like, like);
    }

    const where = conditions.join(' AND ');

    let orderBy = 'sa.created_at DESC';
    if (sortBy === 'oldest') {
      orderBy = 'sa.created_at ASC';
    } else if (sortBy === 'name_asc') {
      orderBy = 'sa.name ASC';
    } else if (sortBy === 'name_des') {
      orderBy = 'sa.name DESC';
    }

    let limitClause = '';
    const queryParams = [...params];
    if (perPage !== null && perPage !== undefined && perPage !== 'all') {
      const parsedPerPage = parseInt(perPage) || 20;
      const parsedPage = parseInt(page) || 1;
      const offset = (parsedPage - 1) * parsedPerPage;
      limitClause = ' LIMIT ? OFFSET ?';
      queryParams.push(parsedPerPage, offset);
    }

    const [rows] = await query(
      `SELECT
         sa.*,
         sa.attendee_id AS id,
         sq.qr_data,
         CASE WHEN i.name IS NOT NULL THEN i.name ELSE o.name END AS registered_by_name,
         ci.checkin_id,
         ci.check_in_at,
         ci.status       AS checkin_status,
         ci.checkin_venue_id
       FROM saas_attendees sa
       LEFT JOIN saas_qr sq ON sa.qr_id = sq.qr_id
       LEFT JOIN users u ON sa.registered_by_user_id = u.id
       LEFT JOIN individuals i ON u.id = i.user_id
       LEFT JOIN organizations o ON u.id = o.user_id
       LEFT JOIN saas_checkins ci ON sa.attendee_id = ci.attendee_id
       WHERE ${where}
       ORDER BY ${orderBy}${limitClause}`,
      queryParams
    );

    const [[{ total }]] = await query(
      `SELECT COUNT(*) AS total
       FROM saas_attendees sa
       LEFT JOIN saas_qr sq ON sa.qr_id = sq.qr_id
       WHERE ${where}`,
      params
    );

    return { data: rows, total, page, perPage };
  }

  /**
   * Dashboard stats for a festival.
   *
   * @param {number} festivalId
   * @returns {object}
   */
  /**
   * Dashboard stats for a festival.
   *
   * @param {number} festivalId
   * @returns {object}
   */
  static async getStats(festivalId) {
    const [[{ total_registrations }]] = await query(
      "SELECT COUNT(*) AS total_registrations FROM saas_attendees WHERE festival_id = ? AND (status != 'cancelled' OR status IS NULL)",
      [festivalId]
    );
    const [[{ total_checked_in }]] = await query(
      'SELECT COUNT(*) AS total_checked_in FROM saas_checkins WHERE festival_id = ?',
      [festivalId]
    );
    const [[{ total_reg_volunteers }]] = await query(
      `SELECT COUNT(DISTINCT sv.user_id) AS total_reg_volunteers
       FROM saas_volunteers sv
       WHERE (
         sv.festival_id = ?
         OR sv.event_id = (SELECT ff.event_id FROM film_festivals ff WHERE ff.film_festival_id = ? LIMIT 1)
       )
       AND sv.is_active = 1
       AND sv.status = 'active'
       AND (sv.expiry_date IS NULL OR sv.expiry_date > NOW())
       AND JSON_CONTAINS(sv.roles, '"registration"')`,
      [festivalId, festivalId]
    );
    const [[{ total_checkin_volunteers }]] = await query(
      `SELECT COUNT(DISTINCT sv.user_id) AS total_checkin_volunteers
       FROM saas_volunteers sv
       WHERE (
         sv.festival_id = ?
         OR sv.event_id = (SELECT ff.event_id FROM film_festivals ff WHERE ff.film_festival_id = ? LIMIT 1)
       )
       AND sv.is_active = 1
       AND sv.status = 'active'
       AND (sv.expiry_date IS NULL OR sv.expiry_date > NOW())
       AND JSON_CONTAINS(sv.roles, '"checkin"')`,
      [festivalId, festivalId]
    );

    // QR Passes stats
    const [[{ festival_assigned_passes }]] = await query(
      `SELECT COUNT(DISTINCT q.qr_id) AS festival_assigned_passes
       FROM saas_qr q
       LEFT JOIN saas_attendees a ON q.attendee_id = a.attendee_id
       WHERE (q.festival_id = ? OR a.festival_id = ?)
         AND q.attendee_id IS NOT NULL`,
      [festivalId, festivalId]
    );

    const [[{ unassigned_passes }]] = await query(
      `SELECT COUNT(*) AS unassigned_passes
       FROM saas_qr q
       WHERE (q.festival_id = ? OR q.festival_id IS NULL)
         AND q.attendee_id IS NULL`,
      [festivalId]
    );

    const total_qr_passes = Number(festival_assigned_passes || 0) + Number(unassigned_passes || 0);

    // Venue-wise Attendance
    const FestivalVenue = require('./FestivalVenue');
    const festivalVenues = await FestivalVenue.findByFestivalId(festivalId);

    const [venueCheckinRows] = await query(
      `SELECT checkin_venue_id, COUNT(*) AS count
       FROM saas_checkins
       WHERE festival_id = ?
       GROUP BY checkin_venue_id`,
      [festivalId]
    );

    const venueMap = new Map();
    for (const r of venueCheckinRows) {
      venueMap.set(r.checkin_venue_id !== null ? Number(r.checkin_venue_id) : null, Number(r.count || 0));
    }

    const processedVenueIds = new Set();
    const venue_wise_attendance = festivalVenues.map(v => {
      const vId = Number(v.venue_id);
      processedVenueIds.add(vId);
      const count = venueMap.get(vId) || 0;
      return {
        venue_id: vId,
        venue_name: v.venue_name,
        total_checkins: count,
        checked_in_count: count,
        count: count
      };
    });

    for (const [vId, count] of venueMap.entries()) {
      if (vId === null) {
        venue_wise_attendance.push({
          venue_id: null,
          venue_name: 'Unspecified Venue',
          total_checkins: count,
          checked_in_count: count,
          count: count
        });
      } else if (!processedVenueIds.has(vId)) {
        venue_wise_attendance.push({
          venue_id: vId,
          venue_name: `Venue #${vId}`,
          total_checkins: count,
          checked_in_count: count,
          count: count
        });
      }
    }

    // Category-wise Attendance
    const [categoryRows] = await query(
      `SELECT 
         sa.delegate_category,
         COUNT(DISTINCT sa.attendee_id) AS total_registrations,
         COUNT(DISTINCT ci.checkin_id) AS total_checkins
       FROM saas_attendees sa
       LEFT JOIN saas_checkins ci ON sa.attendee_id = ci.attendee_id AND ci.festival_id = ?
       WHERE sa.festival_id = ? AND (sa.status != 'cancelled' OR sa.status IS NULL)
       GROUP BY sa.delegate_category`,
      [festivalId, festivalId]
    );

    const catMap = new Map();
    for (const r of categoryRows) {
      const catName = (r.delegate_category && r.delegate_category.trim()) ? r.delegate_category.trim() : 'General Delegate';
      const checkins = Number(r.total_checkins || 0);
      const regs = Number(r.total_registrations || 0);

      if (catMap.has(catName)) {
        const existing = catMap.get(catName);
        existing.total_checkins += checkins;
        existing.checked_in_count += checkins;
        existing.total_registrations += regs;
        existing.registered_count += regs;
      } else {
        catMap.set(catName, {
          category_name: catName,
          category: catName,
          delegate_category: catName,
          total_checkins: checkins,
          checked_in_count: checkins,
          total_registrations: regs,
          registered_count: regs
        });
      }
    }

    return {
      total_registrations: Number(total_registrations || 0),
      total_checked_in: Number(total_checked_in || 0),
      total_checkins: Number(total_checked_in || 0),
      total_qr_passes: Number(total_qr_passes || 0),
      assigned_passes: Number(festival_assigned_passes || 0),
      unassigned_passes: Number(unassigned_passes || 0),
      total_reg_volunteers: Number(total_reg_volunteers || 0),
      total_checkin_volunteers: Number(total_checkin_volunteers || 0),
      venue_wise_attendance,
      category_wise_attendance: Array.from(catMap.values())
    };
  }

  /**
   * Get distinct volunteers who registered attendees (for filter dropdowns).
   *
   * @param {number} festivalId
   * @returns {{ volunteers: Array }}
   */
  static async getRegistrationsFilterList(festivalId) {
    const [volunteers] = await query(
      `SELECT DISTINCT
         u.id AS user_id,
         CASE WHEN i.name IS NOT NULL THEN i.name ELSE o.name END AS name
       FROM saas_attendees sa
       JOIN users u ON sa.registered_by_user_id = u.id
       LEFT JOIN individuals i ON u.id = i.user_id
       LEFT JOIN organizations o ON u.id = o.user_id
       WHERE sa.festival_id = ?`,
      [festivalId]
    );
    const [roles] = await query(
      `SELECT DISTINCT registered_by_role
       FROM saas_attendees
       WHERE festival_id = ? AND registered_by_role IS NOT NULL`,
      [festivalId]
    );

    return { 
      volunteers,
      registered_by_role: roles.map(r => r.registered_by_role)
    };
  }

  /**
   * Cancel an attendee registration (set status = 'cancelled').
   *
   * @param {number} attendeeId
   * @returns {boolean}
   */
  static async cancel(attendeeId) {
    const [result] = await query(
      `UPDATE saas_attendees SET status = 'cancelled' WHERE attendee_id = ? AND status = 'registered'`,
      [attendeeId]
    );
    return result.affectedRows > 0;
  }
}

module.exports = SaasAttendee;
