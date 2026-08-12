const { query } = require('../config/db');

/**
 * SaasCheckin model
 *
 * Reflects the saas_checkins schema:
 *   checkin_id, attendee_id, event_id, festival_id,
 *   checkin_venue_id, checked_in_by_user_id, checked_in_by_role,
 *   checked_in_by_volunteer_id, check_in_at, status, remarks,
 *   created_at, updated_at
 */
class SaasCheckin {
  /**
   * Create a new check-in record.
   *
   * @param {object} params
   * @param {number} params.attendeeId
   * @param {number} params.eventId
   * @param {number} params.festivalId
   * @param {number|null} params.checkinVenueId
   * @param {number} params.checkedInByUserId
   * @param {string} params.checkedInByRole       - 'admin' | 'volunteer'
   * @param {number|null} params.checkedInByVolunteerId
   * @param {string|null} params.remarks
   * @returns {{ id: number }}
   */
  static async create({
    attendeeId,
    eventId,
    festivalId,
    checkinVenueId = null,
    delegateCategory = null,
    checkedInByUserId,
    checkedInByRole,
    checkedInByVolunteerId = null,
    remarks = null,
  }) {
    const [result] = await query(
      `INSERT INTO saas_checkins
         (attendee_id, event_id, festival_id, checkin_venue_id, delegate_category,
          checked_in_by_user_id, checked_in_by_role, checked_in_by_volunteer_id,
          check_in_at, status, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), 'checked_in', ?)`,
      [attendeeId, eventId, festivalId, checkinVenueId || null, delegateCategory || null,
       checkedInByUserId, checkedInByRole, checkedInByVolunteerId || null,
       remarks || null]
    );
    return { id: result.insertId };
  }

  /**
   * Find the most recent check-in record by attendee_id.
   *
   * @param {number} attendeeId
   * @returns {object|null}
   */
  static async findByAttendeeId(attendeeId) {
    const [rows] = await query(
      `SELECT * FROM saas_checkins WHERE attendee_id = ? ORDER BY check_in_at DESC, checkin_id DESC LIMIT 1`,
      [attendeeId]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Find a check-in record by attendee_id and checkin_venue_id.
   *
   * @param {number} attendeeId
   * @param {number|null} checkinVenueId
   * @returns {object|null}
   */
  static async findByAttendeeAndVenue(attendeeId, checkinVenueId) {
    if (checkinVenueId !== null && checkinVenueId !== undefined) {
      const [rows] = await query(
        `SELECT * FROM saas_checkins WHERE attendee_id = ? AND checkin_venue_id = ? LIMIT 1`,
        [attendeeId, checkinVenueId]
      );
      return rows.length > 0 ? rows[0] : null;
    } else {
      const [rows] = await query(
        `SELECT * FROM saas_checkins WHERE attendee_id = ? AND checkin_venue_id IS NULL LIMIT 1`,
        [attendeeId]
      );
      return rows.length > 0 ? rows[0] : null;
    }
  }

  /**
   * Find all check-in records for an attendee.
   *
   * @param {number} attendeeId
   * @returns {Array}
   */
  static async findAllByAttendeeId(attendeeId) {
    const [rows] = await query(
      `SELECT * FROM saas_checkins WHERE attendee_id = ? ORDER BY check_in_at DESC`,
      [attendeeId]
    );
    return rows;
  }

  /**
   * Find a check-in record by its own primary key.
   *
   * @param {number} checkinId
   * @returns {object|null}
   */
  static async findById(checkinId) {
    const [rows] = await query(
      `SELECT ci.*,
         sa.name AS attendee_name, sa.email AS attendee_email, sa.phone AS attendee_phone,
         CASE WHEN i.name IS NOT NULL THEN i.name ELSE o.name END AS checked_in_by_name
       FROM saas_checkins ci
       JOIN saas_attendees sa ON ci.attendee_id = sa.attendee_id
       LEFT JOIN users u ON ci.checked_in_by_user_id = u.id
       LEFT JOIN individuals i ON u.id = i.user_id
       LEFT JOIN organizations o ON u.id = o.user_id
       WHERE ci.checkin_id = ? LIMIT 1`,
      [checkinId]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Paginated search of checked-in records for a festival.
   *
   * @param {object} params
   * @param {number} params.festivalId
   * @param {string} [params.search]
   * @param {number} [params.page=1]
   * @param {number} [params.perPage=20]
   * @param {number|string} [params.venueId]     - filter by checkin_venue_id
   * @param {number|string} [params.checkedInBy]  - filter by checked_in_by_user_id
   * @returns {{ data: Array, total: number, page: number, perPage: number }}
   */
  static async search({ festivalId, search, page = 1, perPage = 20, venueId = '', checkedInBy = '', checkedInByRole = '', sortBy = 'recent' }) {
    const offset = (page - 1) * perPage;
    const conditions = ['ci.festival_id = ?'];
    const params = [festivalId];

    if (venueId && venueId !== '0' && venueId !== 0 && venueId !== 'all') {
      conditions.push('ci.checkin_venue_id = ?');
      params.push(venueId);
    }

    if (checkedInBy && checkedInBy !== 'all') {
      conditions.push('ci.checked_in_by_user_id = ?');
      params.push(checkedInBy);
    }

    if (checkedInByRole && checkedInByRole !== 'all') {
      conditions.push('ci.checked_in_by_role = ?');
      params.push(checkedInByRole);
    }

    if (search) {
      conditions.push(`(
        sa.name LIKE ? OR sa.email LIKE ? OR sa.phone LIKE ?
        OR sa.attendee_id = ?
      )`);
      const like = `%${search}%`;
      params.push(like, like, like, isNaN(search) ? -1 : parseInt(search));
    }

    const where = conditions.join(' AND ');

    let orderBy = 'MAX(ci.check_in_at) DESC';
    if (sortBy === 'oldest') {
      orderBy = 'MIN(ci.check_in_at) ASC';
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
         ci.attendee_id,
         MAX(ci.checkin_id) AS checkin_id,
         MAX(ci.event_id) AS event_id,
         MAX(ci.festival_id) AS festival_id,
         MAX(ci.check_in_at) AS check_in_at,
         MAX(ci.status) AS status,
         MAX(ci.remarks) AS remarks,
         sa.name  AS attendee_name,
         sa.email AS attendee_email,
         sa.phone AS attendee_phone,
         sa.registered_by_role,
         MAX(CASE WHEN i.name IS NOT NULL THEN i.name ELSE o.name END) AS checked_in_by_name,
         MAX(i.image_name) AS checked_in_by_image
       FROM saas_checkins ci
       JOIN saas_attendees sa ON ci.attendee_id = sa.attendee_id
       LEFT JOIN users u ON ci.checked_in_by_user_id = u.id
       LEFT JOIN individuals i ON u.id = i.user_id
       LEFT JOIN organizations o ON u.id = o.user_id
       WHERE ${where}
       GROUP BY ci.attendee_id, sa.name, sa.email, sa.phone, sa.registered_by_role
       ORDER BY ${orderBy}${limitClause}`,
      queryParams
    );

    const [[{ total }]] = await query(
      `SELECT COUNT(DISTINCT ci.attendee_id) AS total
       FROM saas_checkins ci
       JOIN saas_attendees sa ON ci.attendee_id = sa.attendee_id
       WHERE ${where}`,
      params
    );

    return { data: rows, total, page, perPage };
  }

  /**
   * Get distinct filter values for checked-in list (volunteers & venues).
   *
   * @param {number} festivalId
   * @returns {{ volunteers: Array, venues: Array }}
   */
  static async getCheckedInFilterList(festivalId) {
    const FestivalVenue = require('./FestivalVenue');

    const [volunteers] = await query(
      `SELECT DISTINCT
         u.id AS user_id,
         CASE WHEN i.name IS NOT NULL THEN i.name ELSE o.name END AS name
       FROM saas_checkins ci
       JOIN users u ON ci.checked_in_by_user_id = u.id
       LEFT JOIN individuals i ON u.id = i.user_id
       LEFT JOIN organizations o ON u.id = o.user_id
       WHERE ci.festival_id = ?`,
      [festivalId]
    );

    const allVenues = await FestivalVenue.findByFestivalId(festivalId);

    const [distinctVenueRows] = await query(
      `SELECT DISTINCT checkin_venue_id AS venue_id
       FROM saas_checkins
       WHERE festival_id = ? AND checkin_venue_id IS NOT NULL`,
      [festivalId]
    );

    const venues = distinctVenueRows.map(row => {
      const v = allVenues.find(item => Number(item.venue_id) === Number(row.venue_id));
      return {
        venue_id: row.venue_id,
        venue_name: v ? v.venue_name : `Venue #${row.venue_id}`
      };
    });

    const [roles] = await query(
      `SELECT DISTINCT checked_in_by_role
       FROM saas_checkins
       WHERE festival_id = ? AND checked_in_by_role IS NOT NULL`,
      [festivalId]
    );

    return { 
      volunteers, 
      venues,
      checked_in_by_role: roles.map(r => r.checked_in_by_role)
    };
  }
}

module.exports = SaasCheckin;
