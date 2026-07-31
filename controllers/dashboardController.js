const SaasAttendee = require('../models/SaasAttendee');
const SaasCheckin = require('../models/SaasCheckin');
const { query } = require('../config/db');

/** Escape a single CSV cell value */
function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Convert array of objects to CSV string given column definitions */
function buildCsv(rows, cols) {
  const header = cols.map(c => csvCell(c.label)).join(',');
  const body   = rows.map(r => cols.map(c => {
    let val;
    if (typeof c.key === 'function') {
      val = c.key(r);
    } else if (Array.isArray(c.key)) {
      for (const k of c.key) {
        if (r[k] !== undefined && r[k] !== null) { val = r[k]; break; }
      }
    } else {
      val = r[c.key];
    }
    return csvCell(val);
  }).join(',')).join('\n');
  return `${header}\n${body}`;
}

class DashboardController {
  /**
   * GET /api/v1/festivals/:festival_id/dashboard
   * Dashboard stats: total registrations, total checked-in, volunteer counts.
   */
  static async getStats(req, res) {
    try {
      const festivalId = parseInt(req.params.festival_id);
      if (!festivalId) {
        return res.status(400).json({ success: false, message: 'festival_id is required.' });
      }
      const stats = await SaasAttendee.getStats(festivalId);

      // Fetch event name, logo, and banner
      const [festRows] = await query(
        `SELECT e.name AS event_name, ff.film_festival_logo_image_name, ff.film_festival_banner_image_name
         FROM film_festivals ff
         JOIN events e ON ff.event_id = e.event_id
         WHERE ff.film_festival_id = ? AND (ff.is_deleted = 0 OR ff.is_deleted IS NULL)
         LIMIT 1`,
        [festivalId]
      );

      const authPrefix = (process.env.non_auth_image_url_prefix || process.env.auth_image_url_prefix || 'https://api.autovertest.com/api/v1/non-auth-user/retrieve-media').replace(/\/+$/, '');
      const eventDetails = festRows.length > 0 ? {
        event_name: festRows[0].event_name,
        logo: festRows[0].film_festival_logo_image_name ? `${authPrefix}/images/film-festivals/${festRows[0].film_festival_logo_image_name}` : null,
        banner: festRows[0].film_festival_banner_image_name ? `${authPrefix}/images/film-festivals/${festRows[0].film_festival_banner_image_name}` : null
      } : { event_name: null, logo: null, banner: null };

      return res.json({
        success: true,
        data: {
          ...stats,
          ...eventDetails
        }
      });
    } catch (err) {
      console.error('Dashboard getStats error:', err.message);
      return res.status(500).json({ success: false, message: 'Failed to fetch dashboard stats.' });
    }
  }

  /**
   * GET /api/v1/festivals/:festival_id/dashboard/checkedins-users
   *     ?page=1&search=...&filter=<checked_in_by_user_id>&venue=<checkin_venue_id>
   * Paginated list of checked-in attendees.
   */
  static async getCheckedInList(req, res) {
    try {
      const festivalId = parseInt(req.params.festival_id);
      if (!festivalId) {
        return res.status(400).json({ success: false, message: 'festival_id is required.' });
      }

      const download     = req.query.download || '';
      const isCsvDownload = download === 'csv_file';
      const page         = parseInt(req.query.page) || 1;
      const search       = req.query.search || '';
      const checkedInBy  = req.query.filter || '';
      const venueId      = req.query.venue  || '';
      const checkedInByRole = req.query.checked_in_by_role || '';
      const sortBy       = req.query.sort || 'recent';
      const perPage = parseInt(req.query.per_page, 10) || 20;

      const [result, [festRows]] = await Promise.all([
        SaasCheckin.search({
          festivalId,
          search,
          page,
          perPage: isCsvDownload ? null : perPage,
          venueId,
          checkedInBy,
          checkedInByRole,
          sortBy,
        }),
        query(
          `SELECT e.name AS event_name, ff.film_festival_logo_image_name, ff.film_festival_banner_image_name
           FROM film_festivals ff
           JOIN events e ON ff.event_id = e.event_id
           WHERE ff.film_festival_id = ? AND (ff.is_deleted = 0 OR ff.is_deleted IS NULL)
           LIMIT 1`,
          [festivalId]
        )
      ]);

      // ── CSV download ───────────────────────────────────────────────────────
      if (isCsvDownload) {
        const cols = [
          { label: 'Reg ID',  key: ['attendee_id', 'id'] },
          { label: 'Name',    key: ['attendee_name', 'name'] },
          { label: 'Email',   key: ['attendee_email', 'email'] },
          { label: 'Phone',   key: ['attendee_phone', 'phone'] },
          { label: 'Status',  key: 'status' },
        ];
        const csv = buildCsv(result.data, cols);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="checkedin_festival_${festivalId}.csv"`);
        return res.send(csv);
      }
      // ──────────────────────────────────────────────────────────────────────

      const authPrefix = (process.env.non_auth_image_url_prefix || process.env.auth_image_url_prefix || 'https://api.autovertest.com/api/v1/non-auth-user/retrieve-media').replace(/\/+$/, '');
      const eventDetails = festRows.length > 0 ? {
        event_name: festRows[0].event_name,
        logo: festRows[0].film_festival_logo_image_name ? `${authPrefix}/images/film-festivals/${festRows[0].film_festival_logo_image_name}` : null,
        banner: festRows[0].film_festival_banner_image_name ? `${authPrefix}/images/film-festivals/${festRows[0].film_festival_banner_image_name}` : null
      } : { event_name: null, logo: null, banner: null };

      const mappedData = result.data.map(row => ({
        ...row,
        checked_in_by_profile_pic: row.checked_in_by_image ? `${authPrefix}/images/users/${row.checked_in_by_image}` : null,
        checked_in_by_thumbnail_pic: row.checked_in_by_image ? `${authPrefix}/images/users/thumb_${row.checked_in_by_image}` : null
      }));

      return res.json({
        success: true,
        data: mappedData,
        ...eventDetails,
        total_records: result.total, 
        current_page: result.page, 
        per_page: result.perPage,
        last_page: Math.ceil(result.total / result.perPage),
        total_pages: Math.ceil(result.total / result.perPage),
      });
    } catch (err) {
      console.error('getCheckedInList error:', err.message);
      return res.status(500).json({ success: false, message: 'Failed to fetch checked-in list.' });
    }
  }

  /**
   * GET /api/v1/festivals/:festival_id/dashboard/checkedins-filter-list
   * Distinct filter options (volunteers & venues) for the checked-in list.
   */
  static async getCheckedInFilterList(req, res) {
    try {
      const festivalId = parseInt(req.params.festival_id);
      if (!festivalId) {
        return res.status(400).json({ success: false, message: 'festival_id is required.' });
      }

      const filters = await SaasCheckin.getCheckedInFilterList(festivalId);

      const sort = [
        { label: 'Recently Checked In', value: 'recent' },
        { label: 'Oldest Checked In', value: 'oldest' },
        { lable: 'Name (A-Z)', value: 'name_asc' },
        { lable: 'Name (Z-A)', value: 'name_des' }
      ];

      // const volunteers = [
      //   { lable: 'All', value: 'all' },
      //   ...filters.volunteers.map(v => ({ lable: v.name || 'Unknown', value: String(v.user_id) }))
      // ];

      const venues = [
        { lable: 'All', venue_id: 0, venue_name: 'un-filtered' },
        ...filters.venues.map(v => ({ lable: v.venue_name || 'Unknown', venue_id: v.venue_id, venue_name: v.venue_name }))
      ];

      const checked_in_by_role = [
        { lable: 'All', value: 'all' },
        ...filters.checked_in_by_role.map(r => ({ lable: r.charAt(0).toUpperCase() + r.slice(1), value: r }))
      ];

      return res.json({
        success: true,
        message: 'checked-in filter-list fetched succesfully',
        data: {
          sort,
          venues,
          checked_in_by_role
        }
      });
    } catch (err) {
      console.error('getCheckedInFilterList error:', err.message);
      return res.status(500).json({ success: false, message: 'Failed to fetch filter list.' });
    }
  }

  /**
   * GET /api/v1/festivals/:festival_id/dashboard/registrations-users
   *     ?page=1&search=...&filter=<registered_by_user_id>
   * Paginated list of all attendee registrations.
   */
  static async getRegistrationsList(req, res) {
    try {
      const festivalId = parseInt(req.params.festival_id);
      if (!festivalId) {
        return res.status(400).json({ success: false, message: 'festival_id is required.' });
      }

      const download      = req.query.download || '';
      const isCsvDownload = download === 'csv_file';
      const page          = parseInt(req.query.page) || 1;
      const search        = req.query.search || '';
      const filter        = req.query.filter || '';
      const registeredByRole = req.query.registered_by_role || '';
      const delegateCategory = req.query.delegate_category || '';
      const registrationType = req.query.registration_type || '';
      const sortBy        = req.query.sort || 'recent';
      const perPage = parseInt(req.query.per_page, 10) || 20;

      const result = await SaasAttendee.search({
        festivalId,
        search,
        page,
        perPage: isCsvDownload ? null : perPage,
        registeredByFilter: filter,
        registeredByRole,
        sortBy,
        delegateCategory,
        registrationType,
      });

      // ── CSV download ───────────────────────────────────────────────────────
      if (isCsvDownload) {
        const cols = [
          { label: 'Reg ID',            key: ['attendee_id', 'id'] },
          { label: 'Name',              key: ['name', 'attendee_name'] },
          { label: 'Email',             key: ['email', 'attendee_email'] },
          { label: 'Phone',             key: ['phone', 'attendee_phone'] },
          { label: 'Delegate Category', key: 'delegate_category' },
          { label: 'Registration Type', key: 'registration_type' },
          { label: 'QR Data',           key: 'qr_data' },
          { label: 'Status',            key: 'status' },
        ];
        const csv = buildCsv(result.data, cols);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="registrations_festival_${festivalId}.csv"`);
        return res.send(csv);
      }
      // ──────────────────────────────────────────────────────────────────────

      return res.json({
        success: true,
        data: result.data,
        total_records: result.total, 
        current_page: result.page, 
        per_page: result.perPage,
        last_page: Math.ceil(result.total / result.perPage),
        total_pages: Math.ceil(result.total / result.perPage),
      });
    } catch (err) {
      console.error('getRegistrationsList error:', err.message);
      return res.status(500).json({ success: false, message: 'Failed to fetch registrations list.' });
    }
  }

  /**
   * GET /api/v1/festivals/:festival_id/dashboard/registrations-filter-list
   * Distinct filter options (volunteers who registered) for the registrations list.
   */
  static async getRegistrationsFilterList(req, res) {
    try {
      const festivalId = parseInt(req.params.festival_id);
      if (!festivalId) {
        return res.status(400).json({ success: false, message: 'festival_id is required.' });
      }

      const filters = await SaasAttendee.getRegistrationsFilterList(festivalId);

      const sort = [
        { label: 'Recently Registered', value: 'recent' },
        { label: 'Oldest Registered', value: 'oldest' },
        { lable: 'Name (A-Z)', value: 'name_asc' },
        { lable: 'Name (Z-A)', value: 'name_des' }
      ];

      const registered_by_role = [
        { lable: 'All', value: 'all' },
        ...filters.registered_by_role.map(r => ({ lable: r.charAt(0).toUpperCase() + r.slice(1), value: r }))
      ];

      return res.json({
        success: true,
        message: 'registrations filter-list fetched successfully',
        data: {
          sort,
          registered_by_role
        }
      });
    } catch (err) {
      console.error('getRegistrationsFilterList error:', err.message);
      return res.status(500).json({ success: false, message: 'Failed to fetch filter list.' });
    }
  }
}

module.exports = DashboardController;
