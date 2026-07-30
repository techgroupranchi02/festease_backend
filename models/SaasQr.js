const { query } = require('../config/db');

/**
 * SaasQr model
 *
 * Reflects the saas_qr schema:
 *   qr_id        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY
 *   qr_data      VARCHAR(255) NOT NULL UNIQUE
 *   attendee_id  BIGINT UNSIGNED DEFAULT NULL (FK -> saas_attendees.attendee_id)
 *   created_at   TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
 *   updated_at   TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
 */
class SaasQr {
  /**
   * Helper to mask email addresses (e.g., techgroupranchi01@gmail.com -> te******01@gmail.com)
   */
  static maskEmail(email) {
    if (!email || typeof email !== 'string') return null;
    const parts = email.trim().split('@');
    if (parts.length !== 2) return email;
    const [user, domain] = parts;
    if (user.length <= 2) {
      return `${user[0] || '*'}*@${domain}`;
    }
    const front = user.slice(0, 2);
    const back = user.slice(-2);
    const masked = '*'.repeat(Math.max(user.length - 4, 3));
    return `${front}${masked}${back}@${domain}`;
  }

  /**
   * Helper to mask phone numbers (e.g., 1299658799 -> 12******99)
   */
  static maskPhone(phone) {
    if (!phone || typeof phone !== 'string') return null;
    const clean = phone.trim();
    if (clean.length <= 4) return '*'.repeat(clean.length);
    const front = clean.slice(0, 2);
    const back = clean.slice(-2);
    const masked = '*'.repeat(clean.length - 4);
    return `${front}${masked}${back}`;
  }
  /**
   * Create a new QR code entry.
   *
   * @param {object} params
   * @param {string} params.qrData
   * @param {number|null} [params.attendeeId=null]
   * @returns {Promise<{ id: number }>}
   */
  static async create({ qrData, attendeeId = null }) {
    const [result] = await query(
      `INSERT INTO saas_qr (qr_data, attendee_id) VALUES (?, ?)`,
      [qrData, attendeeId || null]
    );
    return { id: result.insertId };
  }

  /**
   * Find a QR record by qr_id.
   *
   * @param {number} qrId
   * @returns {Promise<object|null>}
   */
  static async findById(qrId) {
    const [rows] = await query(
      `SELECT q.*,
              a.name AS attendee_name,
              a.email AS attendee_email,
              a.phone AS attendee_phone
       FROM saas_qr q
       LEFT JOIN saas_attendees a ON q.attendee_id = a.attendee_id
       WHERE q.qr_id = ? LIMIT 1`,
      [qrId]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Find a QR record by qr_data string.
   *
   * @param {string} qrData
   * @returns {Promise<object|null>}
   */
  static async findByQrData(qrData) {
    const [rows] = await query(
      `SELECT q.*,
              a.name AS attendee_name,
              a.email AS attendee_email,
              a.phone AS attendee_phone
       FROM saas_qr q
       LEFT JOIN saas_attendees a ON q.attendee_id = a.attendee_id
       WHERE q.qr_data = ? LIMIT 1`,
      [qrData]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Find a QR record assigned to a specific attendee_id.
   *
   * @param {number} attendeeId
   * @returns {Promise<object|null>}
   */
  static async findByAttendeeId(attendeeId) {
    const [rows] = await query(
      `SELECT q.*,
              a.name AS attendee_name,
              a.email AS attendee_email,
              a.phone AS attendee_phone
       FROM saas_qr q
       LEFT JOIN saas_attendees a ON q.attendee_id = a.attendee_id
       WHERE q.attendee_id = ? LIMIT 1`,
      [attendeeId]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * Assign an attendee to a QR code by qr_id.
   *
   * @param {number} qrId
   * @param {number} attendeeId
   * @returns {Promise<boolean>}
   */
  static async assignAttendee(qrId, attendeeId) {
    const [result] = await query(
      `UPDATE saas_qr SET attendee_id = ? WHERE qr_id = ?`,
      [attendeeId, qrId]
    );
    return result.affectedRows > 0;
  }

  /**
   * Assign an attendee to a QR code by qr_data.
   *
   * @param {string} qrData
   * @param {number} attendeeId
   * @returns {Promise<boolean>}
   */
  static async assignAttendeeByQrData(qrData, attendeeId) {
    const [result] = await query(
      `UPDATE saas_qr SET attendee_id = ? WHERE qr_data = ?`,
      [attendeeId, qrData]
    );
    return result.affectedRows > 0;
  }

  /**
   * Unassign attendee from a QR code.
   *
   * @param {number} qrId
   * @returns {Promise<boolean>}
   */
  static async unassignAttendee(qrId) {
    const [result] = await query(
      `UPDATE saas_qr SET attendee_id = NULL WHERE qr_id = ?`,
      [qrId]
    );
    return result.affectedRows > 0;
  }

  /**
   * Find available (unassigned) QR codes.
   *
   * @param {number} [limit=100]
   * @returns {Promise<Array>}
   */
  static async findAvailable(limit = 100) {
    const [rows] = await query(
      `SELECT * FROM saas_qr WHERE attendee_id IS NULL ORDER BY qr_id ASC LIMIT ?`,
      [limit]
    );
    return rows;
  }

  /**
   * Fetch every row from saas_qr ordered by qr_id ASC.
   * @returns {Array}
   */
  static async findAll() {
    const [rows] = await query(`SELECT * FROM saas_qr ORDER BY qr_id ASC`);
    return rows;
  }

  /**
   * Get QR data with optional status filter ('all', 'unused', 'assigned'), search filtering and pagination.
   *
   * @param {object|number} [options] - Options object or limit number
   * @param {string} [options.status='all'] - 'all' | 'unused' | 'unassigned' | 'assigned' | 'used'
   * @param {string} [options.search='']
   * @param {number} [options.page=1]
   * @param {number|string|null} [options.perPage=1000]
   * @returns {Promise<{ data: Array, total: number, page: number, perPage: number|null }>}
   */
  static async getUnusedQrData(options = {}) {
    let search = '';
    let page = 1;
    let perPage = 1000;
    let status = 'all';

    if (typeof options === 'number') {
      perPage = options;
    } else if (options && typeof options === 'object') {
      search = options.search || '';
      status = options.status || options.assignedStatus || 'all';
      page = parseInt(options.page) || 1;
      if (options.perPage !== undefined && options.perPage !== null) {
        perPage = options.perPage === 'all' ? null : (parseInt(options.perPage) || 1000);
      } else if (options.limit !== undefined && options.limit !== null) {
        perPage = options.limit === 'all' ? null : (parseInt(options.limit) || 1000);
      }
    }

    const conditions = [];
    const params = [];

    if (status === 'unused' || status === 'unassigned') {
      conditions.push('q.attendee_id IS NULL');
    } else if (status === 'assigned' || status === 'used') {
      conditions.push('q.attendee_id IS NOT NULL');
    }

    if (search) {
      conditions.push(`(
        q.qr_data LIKE ? OR
        CAST(q.qr_id AS CHAR) LIKE ? OR
        a.name LIKE ? OR
        a.email LIKE ? OR
        a.phone LIKE ?
      )`);
      const like = `%${search}%`;
      params.push(like, like, like, like, like);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    let limitClause = '';
    const queryParams = [...params];

    if (perPage !== null && perPage > 0) {
      const offset = (page - 1) * perPage;
      limitClause = ` LIMIT ? OFFSET ?`;
      queryParams.push(perPage, offset);
    }

    const [rows] = await query(
      `SELECT q.*,
              a.name AS attendee_name,
              a.email AS attendee_email,
              a.phone AS attendee_phone
       FROM saas_qr q
       LEFT JOIN saas_attendees a ON q.attendee_id = a.attendee_id
       ${whereClause}
       ORDER BY q.qr_id ASC
       ${limitClause}`,
      queryParams
    );

    const maskedRows = rows.map(row => ({
      ...row,
      is_attendee_registered: row.attendee_id !== null,
      attendee_email: SaasQr.maskEmail(row.attendee_email),
      attendee_phone: SaasQr.maskPhone(row.attendee_phone),
    }));

    const [[{ total }]] = await query(
      `SELECT COUNT(*) AS total
       FROM saas_qr q
       LEFT JOIN saas_attendees a ON q.attendee_id = a.attendee_id
       ${whereClause}`,
      params
    );

    return {
      data: maskedRows,
      total,
      page,
      perPage
    };
  }

  /**
   * Paginated search for QR records.
   *
   * @param {object} params
   * @param {string} [params.search]
   * @param {string} [params.assignedStatus] - 'assigned' | 'unassigned' | 'all'
   * @param {number} [params.page=1]
   * @param {number} [params.perPage=20]
   * @returns {Promise<{ data: Array, total: number, page: number, perPage: number }>}
   */
  static async search({ search = '', assignedStatus = 'all', page = 1, perPage = 20 }) {
    const conditions = [];
    const params = [];

    if (assignedStatus === 'assigned') {
      conditions.push('q.attendee_id IS NOT NULL');
    } else if (assignedStatus === 'unassigned') {
      conditions.push('q.attendee_id IS NULL');
    }

    if (search) {
      conditions.push(`(
        q.qr_data LIKE ? OR
        a.name LIKE ? OR
        a.email LIKE ? OR
        a.phone LIKE ?
      )`);
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const parsedPerPage = parseInt(perPage) || 20;
    const parsedPage = parseInt(page) || 1;
    const offset = (parsedPage - 1) * parsedPerPage;

    const queryParams = [...params, parsedPerPage, offset];

    const [rows] = await query(
      `SELECT q.*,
              a.name AS attendee_name,
              a.email AS attendee_email,
              a.phone AS attendee_phone
       FROM saas_qr q
       LEFT JOIN saas_attendees a ON q.attendee_id = a.attendee_id
       ${where}
       ORDER BY q.qr_id ASC
       LIMIT ? OFFSET ?`,
      queryParams
    );

    const [[{ total }]] = await query(
      `SELECT COUNT(*) AS total
       FROM saas_qr q
       LEFT JOIN saas_attendees a ON q.attendee_id = a.attendee_id
       ${where}`,
      params
    );

    return { data: rows, total, page: parsedPage, perPage: parsedPerPage };
  }
}

module.exports = SaasQr;
