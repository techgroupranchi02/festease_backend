const { query } = require('../config/db');

/**
 * SaasUnregisteredAttendee Model
 *
 * Table: saas_unregistered_attendees
 * Schema:
 *   saas_unregistered_attendee_id  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY
 *   festival_id                    BIGINT UNSIGNED NOT NULL
 *   event_id                       BIGINT UNSIGNED NOT NULL
 *   name                           VARCHAR(255) NULL
 *   email                          VARCHAR(255) NULL
 *   phone_number                   VARCHAR(30) NULL
 *   delegate_category              VARCHAR(100) NULL
 *   created_at                     TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
 *   updated_at                     TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
 */
class SaasUnregisteredAttendee {
  /**
   * Bulk insert attendees into saas_unregistered_attendees table.
   *
   * @param {number} festivalId
   * @param {number} eventId
   * @param {Array<{name: string|null, email: string|null, phone_number: string|null, delegate_category: string|null}>} attendees
   * @returns {Promise<number>} Number of inserted rows
   */
  static async bulkCreate(festivalId, eventId, attendees) {
    if (!attendees || attendees.length === 0) {
      return 0;
    }

    const values = [];
    const params = [];

    for (const item of attendees) {
      values.push('(?, ?, ?, ?, ?, ?)');
      params.push(
        festivalId,
        eventId,
        item.name || null,
        item.email || null,
        item.phone_number || null,
        item.delegate_category || null
      );
    }

    const sql = `
      INSERT INTO saas_unregistered_attendees
        (festival_id, event_id, name, email, phone_number, delegate_category)
      VALUES ${values.join(', ')}
    `;

    const [result] = await query(sql, params);
    return result.affectedRows || attendees.length;
  }

  /**
   * Fetch all unregistered attendees for a given festival ID.
   *
   * @param {number} festivalId
   * @returns {Promise<Array>}
   */
  static async findByFestivalId(festivalId) {
    const [rows] = await query(
      'SELECT * FROM saas_unregistered_attendees WHERE festival_id = ? ORDER BY saas_unregistered_attendee_id DESC',
      [festivalId]
    );
    return rows;
  }

  /**
   * Fetch attendees (merged unregistered and registered) with search and pagination for a festival.
   *
   * @param {object} options
   * @param {number} options.festivalId
   * @param {string} [options.search]
   * @param {number|string} [options.page=1]
   * @param {number|string} [options.limit=10]
   * @param {string} [options.delegateCategory]
   * @param {string} [options.registrationStatus]
   * @returns {Promise<{ data: Array, total: number, page: number, perPage: number, totalPages: number }>}
   */
  static async findWithPagination({ festivalId, search = '', page = 1, limit = 10, delegateCategory = '', registrationStatus = '' }) {
    const baseSql = `
      SELECT 
        u.saas_unregistered_attendee_id,
        sa.attendee_id,
        COALESCE(sa.event_id, u.event_id) AS event_id,
        COALESCE(sa.name, u.name) AS name,
        COALESCE(sa.email, u.email) AS email,
        COALESCE(sa.phone, u.phone_number) AS phone_number,
        COALESCE(sa.delegate_category, u.delegate_category) AS delegate_category,
        sa.registration_type,
        sa.qr_token,
        sa.registered_at,
        u.created_at,
        CASE WHEN sa.attendee_id IS NOT NULL THEN 1 ELSE 0 END AS is_registered,
        COALESCE(sa.status, 'unregistered') AS status
      FROM saas_unregistered_attendees u
      LEFT JOIN saas_attendees sa 
        ON sa.attendee_id = (
          SELECT sa2.attendee_id 
          FROM saas_attendees sa2 
          WHERE sa2.festival_id = u.festival_id 
            AND (sa2.status IS NULL OR sa2.status != 'cancelled')
            AND (
              (u.email IS NOT NULL AND u.email != '' AND sa2.email IS NOT NULL AND sa2.email != '' AND LOWER(u.email) = LOWER(sa2.email))
              OR
              ((u.email IS NULL OR u.email = '' OR sa2.email IS NULL OR sa2.email = '') AND u.phone_number IS NOT NULL AND u.phone_number != '' AND sa2.phone IS NOT NULL AND sa2.phone != '' AND u.phone_number = sa2.phone)
            )
          ORDER BY 
            CASE WHEN (u.email IS NOT NULL AND u.email != '' AND sa2.email IS NOT NULL AND sa2.email != '' AND LOWER(u.email) = LOWER(sa2.email)) THEN 1 ELSE 2 END,
            sa2.attendee_id DESC
          LIMIT 1
        )
      WHERE u.festival_id = ?

      UNION ALL

      SELECT 
        NULL AS saas_unregistered_attendee_id,
        sa.attendee_id,
        sa.event_id,
        sa.name,
        sa.email,
        sa.phone AS phone_number,
        sa.delegate_category,
        sa.registration_type,
        sa.qr_token,
        sa.registered_at,
        sa.created_at,
        1 AS is_registered,
        sa.status
      FROM saas_attendees sa
      WHERE sa.festival_id = ?
        AND (sa.status IS NULL OR sa.status != 'cancelled')
        AND NOT EXISTS (
          SELECT 1 FROM saas_unregistered_attendees u
          WHERE u.festival_id = sa.festival_id
            AND (
              (u.email IS NOT NULL AND u.email != '' AND sa.email IS NOT NULL AND sa.email != '' AND LOWER(u.email) = LOWER(sa.email))
              OR 
              ((u.email IS NULL OR u.email = '' OR sa.email IS NULL OR sa.email = '') AND u.phone_number IS NOT NULL AND u.phone_number != '' AND sa.phone IS NOT NULL AND sa.phone != '' AND u.phone_number = sa.phone)
            )
        )
    `;

    const conditions = [];
    const params = [festivalId, festivalId];

    if (delegateCategory && delegateCategory !== 'all') {
      conditions.push('delegate_category = ?');
      params.push(delegateCategory);
    }

    if (registrationStatus && registrationStatus !== 'all') {
      if (registrationStatus === 'registered' || registrationStatus === '1' || registrationStatus === 'true' || registrationStatus === true) {
        conditions.push('is_registered = 1');
      } else if (registrationStatus === 'unregistered' || registrationStatus === '0' || registrationStatus === 'false' || registrationStatus === false) {
        conditions.push('is_registered = 0');
      } else {
        conditions.push('status = ?');
        params.push(registrationStatus);
      }
    }

    let cleanSearch = (search !== null && search !== undefined) ? String(search).trim() : '';
    if (cleanSearch.includes('%')) {
      try {
        cleanSearch = decodeURIComponent(cleanSearch).trim();
      } catch (e) {
        // Keep cleanSearch as is if decoding fails
      }
    }

    if (cleanSearch) {
      conditions.push('(name LIKE ? OR email LIKE ? OR phone_number LIKE ? OR delegate_category LIKE ? OR qr_token LIKE ? OR registration_type LIKE ?)');
      const likeStr = `%${cleanSearch}%`;
      params.push(likeStr, likeStr, likeStr, likeStr, likeStr, likeStr);
    }

    const whereClause = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';

    // Total count
    const countSql = `SELECT COUNT(*) AS total FROM (${baseSql}) AS merged${whereClause}`;
    const [countRows] = await query(countSql, params);
    const totalRecords = countRows[0].total;

    // Pagination
    let limitClause = '';
    const queryParams = [...params];
    const parsedLimit = parseInt(limit) || 10;
    const parsedPage = parseInt(page) || 1;

    if (limit !== 'all' && parsedLimit > 0) {
      const offset = Math.max(0, (parsedPage - 1) * parsedLimit);
      limitClause = ' LIMIT ? OFFSET ?';
      queryParams.push(parsedLimit, offset);
    }

    // Query records
    const selectSql = `SELECT * FROM (${baseSql}) AS merged${whereClause} ORDER BY created_at DESC${limitClause}`;
    const [rows] = await query(selectSql, queryParams);

    const pageOffset = (limit === 'all' || parsedLimit <= 0) ? 0 : (parsedPage - 1) * parsedLimit;
    const formattedRows = rows.map((r, index) => ({
      ...r,
      id: pageOffset + index + 1,
      is_registered: Boolean(r.is_registered)
    }));

    const totalPages = (limit === 'all' || parsedLimit <= 0) ? 1 : Math.ceil(totalRecords / parsedLimit);
    const effectiveLimit = limit === 'all' ? totalRecords : parsedLimit;

    return {
      data: formattedRows,
      total: totalRecords,
      page: parsedPage,
      perPage: effectiveLimit,
      totalPages: totalPages,
      attendees: formattedRows,
      pagination: {
        total: totalRecords,
        page: parsedPage,
        limit: effectiveLimit,
        total_pages: totalPages
      }
    };
  }
}

module.exports = SaasUnregisteredAttendee;
