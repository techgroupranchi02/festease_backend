const { query } = require('../config/db');

class FestivalPayment {
  /**
   * Get paginated payments for a specific festival with user and project details.
   * @param {number} festivalId
   * @param {object} options - { page, perPage, status, search }
   * @returns {object} { data, total, page, perPage, lastPage }
   */
  static async getByFestival(festivalId, options = {}) {
    const { page = 1, perPage = 20, status, search } = options;
    const offset = (page - 1) * perPage;

    let whereClause = 'fp.festival_id = ?';
    const params = [festivalId];

    if (status && status !== 'all') {
      whereClause += ' AND fp.settlement_status = ?';
      params.push(status);
    }

    if (search) {
      whereClause += ' AND (ind.name LIKE ? OR org.name LIKE ? OR u.email LIKE ? OR p.title LIKE ? OR fp.razorpay_transfer_id LIKE ? OR fp.razorpay_payment_id LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }

    // Count total
    const [countResults] = await query(
      `SELECT COUNT(*) as total 
       FROM festival_payments fp
       LEFT JOIN users u ON fp.user_id = u.id
       LEFT JOIN individuals ind ON ind.user_id = u.id
       LEFT JOIN organizations org ON org.user_id = u.id
       LEFT JOIN projects p ON fp.project_id = p.project_id
       WHERE ${whereClause}`,
      params
    );
    const total = countResults?.[0]?.total || 0;

    // Fetch paginated data
    const [dataRows] = await query(
      `SELECT 
        fp.*,
        COALESCE(p.title, "Untitled Film") as film_title,
        COALESCE(cat.name, "General Entry") as category_name,
        COALESCE(ind.name, org.name, "Filmmaker") as filmmaker_name,
        u.email as filmmaker_email,
        (fp.commission_amount + fp.route_fee_amount + fp.route_gst_amount) as total_deductions
       FROM festival_payments fp
       LEFT JOIN users u ON fp.user_id = u.id
       LEFT JOIN individuals ind ON ind.user_id = u.id
       LEFT JOIN organizations org ON org.user_id = u.id
       LEFT JOIN projects p ON fp.project_id = p.project_id
       LEFT JOIN film_festivals_submissions sub ON fp.submission_id = sub.film_festivals_submission_id
       LEFT JOIN film_festivals_category_milestone_prices price ON sub.film_festival_category_milestone_price_id = price.film_festival_category_milestone_price_id
       LEFT JOIN film_festivals_categories cat ON price.film_festival_category_id = cat.film_festival_category_id
       WHERE ${whereClause}
       ORDER BY fp.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, perPage, offset]
    );

    return {
      data: Array.isArray(dataRows) ? dataRows : [],
      total,
      page,
      per_page: perPage,
      last_page: Math.ceil(total / perPage) || 1,
    };
  }

  /**
   * Get aggregated KPIs for a specific festival.
   * @param {number} festivalId
   * @returns {object} KPI summary
   */
  static async getKpis(festivalId) {
    const [kpiRows] = await query(
      `SELECT 
        COUNT(*) as total_submissions,
        COALESCE(SUM(CASE WHEN settlement_status != 'refunded' THEN base_fee_amount ELSE 0 END), 0) as gross_revenue,
        COALESCE(SUM(CASE WHEN settlement_status != 'refunded' THEN platform_fee_amount ELSE 0 END), 0) as total_platform_fees,
        COALESCE(SUM(CASE WHEN settlement_status != 'refunded' THEN freecomers_earnings ELSE 0 END), 0) as freecomers_earnings,
        COALESCE(SUM(CASE WHEN settlement_status != 'refunded' THEN (commission_amount + route_fee_amount + route_gst_amount) ELSE 0 END), 0) as total_deductions,
        COALESCE(SUM(CASE WHEN settlement_status = 'settled' THEN net_settled_amount ELSE 0 END), 0) as net_settled_to_bank,
        COALESCE(SUM(CASE WHEN settlement_status = 'pending' THEN net_settled_amount ELSE 0 END), 0) as pending_amount,
        SUM(CASE WHEN settlement_status = 'settled' THEN 1 ELSE 0 END) as settled_count,
        SUM(CASE WHEN settlement_status = 'pending' THEN 1 ELSE 0 END) as pending_count,
        SUM(CASE WHEN settlement_status = 'refunded' THEN 1 ELSE 0 END) as refunded_count,
        COALESCE(SUM(CASE WHEN settlement_status = 'refunded' THEN refund_amount ELSE 0 END), 0) as total_refunded_amount,
        COALESCE(SUM(CASE WHEN settlement_status = 'refunded' THEN net_settled_amount ELSE 0 END), 0) as total_reversed_amount
       FROM festival_payments
       WHERE festival_id = ?`,
      [festivalId]
    );

    return (kpiRows && kpiRows.length > 0) ? kpiRows[0] : {
      total_submissions: 0,
      gross_revenue: 0,
      total_platform_fees: 0,
      freecomers_earnings: 0,
      total_deductions: 0,
      net_settled_to_bank: 0,
      settled_count: 0,
      pending_count: 0,
      refunded_count: 0,
      total_refunded_amount: 0,
      total_reversed_amount: 0,
    };
  }

  /**
   * Get bank account details for a festival.
   * @param {number} festivalId
   * @returns {object|null}
   */
  static async getBankAccount(festivalId) {
    const [bankRows] = await query(
      `SELECT 
        id, festival_id, beneficiary_name, account_type,
        account_number_masked, ifsc_code, bank_name, branch_name,
        pan_number, legal_entity_name, email, phone,
        razorpay_account_id, verification_status,
        penny_drop_verified, updated_at
       FROM festival_bank_accounts
       WHERE festival_id = ?`,
      [festivalId]
    );

    return (bankRows && bankRows.length > 0) ? bankRows[0] : null;
  }

  /**
   * Get settlement parameters (platform fee + commission) for a festival.
   * @param {number} festivalId
   * @returns {object}
   */
  static async getSettlementParams(festivalId) {
    // Platform fee
    let platformFee = { type: 'percentage', value: 3.0, is_override: false };
    try {
      const [rows] = await query(
        'SELECT * FROM film_festivals_platform_fee_overrides WHERE festival_id = ?',
        [festivalId]
      );
      if (rows && rows.length > 0 && rows[0].value) {
        platformFee = { type: rows[0].type || 'percentage', value: Number(rows[0].value), is_override: true };
      } else {
        const [gRows] = await query(
          'SELECT * FROM film_festivals_globle_platform_fee_settings ORDER BY id DESC LIMIT 1'
        );
        if (gRows && gRows.length > 0 && gRows[0].value) {
          platformFee = { type: gRows[0].type || 'percentage', value: Number(gRows[0].value), is_override: false };
        }
      }
    } catch (e) {
      console.warn('Could not fetch platform fee settings, using defaults', e.message);
    }

    // Commission
    let commission = { type: 'percentage', value: 6.0, is_override: false };
    try {
      const [rows] = await query(
        'SELECT * FROM festival_commission_overrides WHERE festival_id = ?',
        [festivalId]
      );
      if (rows && rows.length > 0 && rows[0].value) {
        commission = { type: rows[0].type || 'percentage', value: Number(rows[0].value), is_override: true };
      } else {
        const [gRows] = await query(
          'SELECT * FROM festival_commission_settings ORDER BY id DESC LIMIT 1'
        );
        if (gRows && gRows.length > 0 && gRows[0].value) {
          commission = { type: gRows[0].type || 'percentage', value: Number(gRows[0].value), is_override: false };
        }
      }
    } catch (e) {
      console.warn('Could not fetch commission settings, using defaults', e.message);
    }

    return { platform_fee: platformFee, commission };
  }
}

module.exports = FestivalPayment;
