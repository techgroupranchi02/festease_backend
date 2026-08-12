const SaasAttendee = require('../models/SaasAttendee');
const SaasCheckin  = require('../models/SaasCheckin');
const { query }    = require('../config/db');
const { listImages, getDriveFileMap } = require('../utils/googleDrive');
const { encryptQrPayload } = require('../utils/paseto');

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

/** Format date to "DD-MM-YYYY hh:mm:ss A" for CSV export */
function formatCsvCheckinTime(dateInput) {
  if (!dateInput) return '';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return String(dateInput);

  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const year = d.getFullYear();

  let hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, '0');
  const seconds = d.getSeconds().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const timeStr = `${hours.toString().padStart(2, '0')}:${minutes}:${seconds} ${ampm}`;

  return `${day}-${month}-${year} ${timeStr}`;
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

      const FestivalVenue = require('../models/FestivalVenue');
      const festivalVenues = await FestivalVenue.findByFestivalId(festivalId);
      const venueMap = new Map(festivalVenues.map(v => [Number(v.venue_id), v.venue_name]));

      const authPrefix = (process.env.non_auth_image_url_prefix || process.env.auth_image_url_prefix || 'https://api.autovertest.com/api/v1/non-auth-user/retrieve-media').replace(/\/+$/, '');
      const eventDetails = festRows.length > 0 ? {
        event_name: festRows[0].event_name,
        logo: festRows[0].film_festival_logo_image_name ? `${authPrefix}/images/film-festivals/${festRows[0].film_festival_logo_image_name}` : null,
        banner: festRows[0].film_festival_banner_image_name ? `${authPrefix}/images/film-festivals/${festRows[0].film_festival_banner_image_name}` : null
      } : { event_name: null, logo: null, banner: null };

      const mappedData = await Promise.all(result.data.map(async row => {
        const attendeeCheckins = await SaasCheckin.findAllByAttendeeId(row.attendee_id);
        const festivalCheckins = attendeeCheckins.filter(c => Number(c.festival_id) === Number(festivalId));

        const venueCheckins = festivalCheckins
          .filter(c => c.checkin_venue_id !== null && c.checkin_venue_id !== undefined)
          .map(c => {
            const vId = Number(c.checkin_venue_id);
            const vName = venueMap.get(vId) || `Venue #${vId}`;
            return {
              venue_id: vId,
              venue_name: vName,
              checkin_time: c.check_in_at || c.created_at || null
            };
          });

        const { check_in_at, ...cleanedRow } = row;

        return {
          ...cleanedRow,
          venue_checkins: venueCheckins,
          checked_in_by_profile_pic: row.checked_in_by_image ? `${authPrefix}/images/users/${row.checked_in_by_image}` : null,
          checked_in_by_thumbnail_pic: row.checked_in_by_image ? `${authPrefix}/images/users/thumb_${row.checked_in_by_image}` : null
        };
      }));

      // ── CSV download ───────────────────────────────────────────────────────
      if (isCsvDownload) {
        const csvRows = [];
        let slNo = 1;
        for (const item of mappedData) {
          if (Array.isArray(item.venue_checkins) && item.venue_checkins.length > 0) {
            for (const vc of item.venue_checkins) {
              csvRows.push({
                sl_no: slNo++,
                attendee_id: item.attendee_id,
                attendee_name: item.attendee_name || item.name || '',
                attendee_email: item.attendee_email || item.email || '',
                attendee_phone: item.attendee_phone || item.phone || '',
                venue_name: vc.venue_name || '',
                checked_in_at: formatCsvCheckinTime(vc.checkin_time),
                status: item.status || 'checked_in'
              });
            }
          } else {
            csvRows.push({
              sl_no: slNo++,
              attendee_id: item.attendee_id,
              attendee_name: item.attendee_name || item.name || '',
              attendee_email: item.attendee_email || item.email || '',
              attendee_phone: item.attendee_phone || item.phone || '',
              venue_name: '',
              checked_in_at: '',
              status: item.status || 'checked_in'
            });
          }
        }

        const cols = [
          { label: 'Sl. No.',      key: 'sl_no' },
          { label: 'Reg ID',       key: 'attendee_id' },
          { label: 'Name',         key: 'attendee_name' },
          { label: 'Email',        key: 'attendee_email' },
          { label: 'Phone',        key: 'attendee_phone' },
          { label: 'Venue',        key: 'venue_name' },
          { label: 'checked-in at', key: 'checked_in_at' },
          { label: 'Status',       key: 'status' },
        ];
        const csv = buildCsv(csvRows, cols);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="checkedin_festival_${festivalId}.csv"`);
        return res.send(csv);
      }
      // ──────────────────────────────────────────────────────────────────────

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


  /**
   * GET /api/v1/festivals/:festival_id/dashboard/qr-attendees
   *
   * Fetches data from saas_qr table joined with saas_attendees.
   * Fields returned: qr_id, qr_data, file_url, attendee_id.
   * If attendee_id is present, also returns:
   *   name, email, phone, delegate_category, registration_type, status.
   */
  static async getQrWithAttendees(req, res) {
    try {
      const festivalId = parseInt(req.params.festival_id);
      if (!festivalId) {
        return res.status(400).json({ success: false, message: 'festival_id is required.' });
      }

      const page         = parseInt(req.query.page) || 1;
      const perPage      = req.query.per_page === 'all' || req.query.perPage === 'all' ? null : (parseInt(req.query.per_page || req.query.perPage) || 20);
      const search       = req.query.search || req.query.q || '';
      const sort = req.query.sort || req.query.sort_by || req.query.status || req.query.assignedStatus || 'oldest';

      const conditions = ['(q.festival_id = ? OR q.festival_id IS NULL OR a.festival_id = ?)'];
      const params = [festivalId, festivalId];

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

      let orderByClause = 'ORDER BY q.qr_id ASC';
      if (sort === 'assigned' || sort === 'used' || sort === 'assigned_first') {
        orderByClause = 'ORDER BY CASE WHEN q.attendee_id IS NOT NULL THEN 0 ELSE 1 END, q.qr_id ASC';
      } else if (sort === 'unassigned' || sort === 'unused' || sort === 'unassigned_first') {
        orderByClause = 'ORDER BY CASE WHEN q.attendee_id IS NULL THEN 0 ELSE 1 END, q.qr_id ASC';
      } else if (sort === 'recent') {
        orderByClause = 'ORDER BY q.qr_id DESC';
      } else if (sort === 'name_asc') {
        orderByClause = 'ORDER BY CASE WHEN a.name IS NOT NULL THEN 0 ELSE 1 END, a.name ASC, q.qr_id ASC';
      } else if (sort === 'name_des') {
        orderByClause = 'ORDER BY CASE WHEN a.name IS NOT NULL THEN 0 ELSE 1 END, a.name DESC, q.qr_id ASC';
      }

      const whereClause = `WHERE ${conditions.join(' AND ')}`;

      let limitClause = '';
      const queryParams = [...params];
      if (perPage !== null && perPage > 0) {
        const offset = (page - 1) * perPage;
        limitClause = ' LIMIT ? OFFSET ?';
        queryParams.push(perPage, offset);
      }

      const [rows] = await query(
        `SELECT
           q.qr_id,
           q.qr_data,
           q.attendee_id,
           a.name,
           a.email,
           a.phone,
           a.delegate_category,
           a.registration_type,
           a.status
         FROM saas_qr q
         LEFT JOIN saas_attendees a ON q.attendee_id = a.attendee_id
         ${whereClause}
         ${orderByClause}
         ${limitClause}`,
        queryParams
      );

      const [[{ total }]] = await query(
        `SELECT COUNT(*) AS total
         FROM saas_qr q
         LEFT JOIN saas_attendees a ON q.attendee_id = a.attendee_id
         ${whereClause}`,
        params
      );

      // ── Resolve Drive proxy URLs ──────────────────────────────────────────
      // const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;
      // const baseUrl   = (process.env.FESTEASE_BACKEND_URL || '').replace(/\/+$/, '');

      // let driveFileMap = new Map(); // key: qr_data (e.g. "BISFF2026-10001"), value: Drive file id

      // if (FOLDER_ID && rows.length > 0) {
      //   try {
      //     driveFileMap = await getDriveFileMap(FOLDER_ID);
      //   } catch (driveErr) {
      //     console.error('getQrWithAttendees: Drive listing failed:', driveErr.message);
      //   }
      // }

      const data = await Promise.all(
        rows.map(async (row) => {
          // const driveId     = driveFileMap.get(row.qr_data);
          // const file_url    = driveId ? `${baseUrl}/api/v1/festivals/${festivalId}/drive/images/${driveId}` : null;
          const hasAttendee = row.attendee_id !== null && row.attendee_id !== undefined;

          let qr_token = null;
          try {
            qr_token = await encryptQrPayload({
              qr_data:     row.qr_data,
            });
          } catch (pasetoErr) {
            console.error('getQrWithAttendees: PASETO token generation failed:', pasetoErr.message);
          }

          return {
            qr_id:             row.qr_id,
            qr_data:           row.qr_data,
            qr_token:          qr_token,
            // file_url:          file_url?? null,
            attendee_id:       hasAttendee ? row.attendee_id : null,
            name:              hasAttendee ? row.name : null,
            email:             hasAttendee ? row.email : null,
            phone:             hasAttendee ? row.phone : null,
            delegate_category: hasAttendee ? row.delegate_category : null,
            registration_type: hasAttendee ? row.registration_type : null,
            status:            hasAttendee ? row.status : null,
          };
        })
      );

      return res.json({
        success:       true,
        message:       'qr attendees fetched successfully',
        data,
        total_records: total,
        current_page:  page,
        per_page:      perPage,
        last_page:     perPage ? Math.ceil(total / perPage) : 1,
        total_pages:   perPage ? Math.ceil(total / perPage) : 1,
      });
    } catch (err) {
      console.error('getQrWithAttendees error:', err.message);
      return res.status(500).json({ success: false, message: 'Failed to fetch qr attendees.' });
    }
  }


}

module.exports = DashboardController;
