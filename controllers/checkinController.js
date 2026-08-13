'use strict';

const SaasAttendee                        = require('../models/SaasAttendee');
const SaasCheckin                         = require('../models/SaasCheckin');
const SaasQr                              = require('../models/SaasQr');
const FestivalVenue                       = require('../models/FestivalVenue');
const { validate, rules, sendValidationError } = require('../middlewares/validate');
const { decryptQrPayload }                = require('../utils/paseto');
const { query }                           = require('../config/db');

/**
 * Format a date object or date string to "12 Aug 2026, 11:18 AM" format.
 * @param {Date|string} dateInput
 * @returns {string}
 */
function formatCheckinTime(dateInput) {
  if (!dateInput) return '';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return String(dateInput);

  const day = d.getDate();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[d.getMonth()];
  const year = d.getFullYear();

  let hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const timeStr = `${hours}:${minutes} ${ampm}`;

  return `${day} ${month} ${year}, ${timeStr}`;
}

class CheckinController {
  /**
   * GET /api/v1/festivals/:festival_id/registrations/:registration_id?
   *      or /api/v1/festivals/:festival_id/registrations?search=...
   * Fetch registration details by ID or search.
   */
  static async getRegistration(req, res) {
    try {
      const festivalId = parseInt(req.params.festival_id);
      if (!festivalId) {
        return res.status(400).json({ success: false, message: 'festival_id is required.' });
      }

      const loggedInUserId = req.user.user_id;

      // Fetch festival owner
      const [festivalRows] = await query(
        'SELECT user_id FROM film_festivals WHERE film_festival_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1',
        [festivalId]
      );
      const festivalOwnerUserId = festivalRows.length > 0 ? festivalRows[0].user_id : null;
      const isOwner = loggedInUserId === festivalOwnerUserId;

      const regId = req.params.registration_id ? parseInt(req.params.registration_id) : null;

      // Fetch by ID
      if (regId && !isNaN(regId)) {
        const reg = await SaasAttendee.findById(regId);
        if (!reg || reg.festival_id !== festivalId) {
          return res.status(404).json({ success: false, message: 'Registration not found.' });
        }

        // Volunteers can only view their own registrations
        if (!isOwner && reg.registered_by_user_id !== loggedInUserId) {
          return res.status(404).json({ success: false, message: 'Registration not found.' });
        }

        return res.json({ success: true, data: reg });
      }

      // Fetch by search
      const search  = req.query.search || '';
      const page    = parseInt(req.query.page) || 1;
      const status  = req.query.status || '';
      const delegateCategory = req.query.delegate_category || '';
      const registrationType = req.query.registration_type || '';

      // Volunteers only search/view their own registrations
      const registeredByFilter = isOwner ? '' : loggedInUserId;

      const result = await SaasAttendee.search({
        festivalId,
        search,
        page,
        perPage: 20,
        status,
        registeredByFilter,
        delegateCategory,
        registrationType
      });

      return res.json({
        success: true,
        message: 'Registrations fetched successfully.',
        data:    result.data,
        total:   result.total,
        page:    result.page,
        per_page: result.perPage,
      });
    } catch (err) {
      console.error('getRegistration error:', err.message);
      return res.status(500).json({ success: false, message: 'Failed to fetch registration.' });
    }
  }

  /**
   * GET /api/v1/festivals/:festival_id/venues-list
   * Fetch assigned venue(s) list for the festival.
   */
  static async getVenues(req, res) {
    try {
      const festivalId = parseInt(req.params.festival_id);
      if (!festivalId) {
        return res.status(400).json({ success: false, message: 'festival_id is required.' });
      }

      const venues = await FestivalVenue.findByFestivalId(festivalId);
      return res.json({ success: true, data: venues });
    } catch (err) {
      console.error('getVenues error:', err.message);
      return res.status(500).json({ success: false, message: 'Failed to fetch venues.' });
    }
  }

  /**
   * POST /api/v1/festivals/:festival_id/check-in
   * Mark a registered attendee as checked in.
   *
   * Body: { qr_token, checkin_venue_id?, remarks? }
   */
  static async checkIn(req, res) {
    try {
      const festivalId         = parseInt(req.params.festival_id);
      const checkedInByUserId  = req.user.user_id;
      const { qr_token, checkin_venue_id, delegate_category, remarks } = req.body || {};

      // --- Input validation ---
      const validationRules = {
        qr_token: [rules.required(), rules.string()]
      };
      if (delegate_category !== undefined && delegate_category !== null && delegate_category !== '') {
        validationRules.delegate_category = [rules.string()];
      }
      const result = validate(req.body, validationRules);
      if (!result.valid) return sendValidationError(res, result.errors);

      // --- Decrypt & verify PASETO token ---
      let payload;
      try {
        payload = await decryptQrPayload(qr_token);
      } catch {
        return res.status(400).json({ success: false, message: 'Invalid or expired QR code.' });
      }

      // Cross-check the festival embedded in the token against the route param (if present)
      if (payload.festival_id && payload.festival_id !== festivalId) {
        return res.status(403).json({ success: false, message: 'QR code does not belong to this festival.' });
      }

      // --- Load attendee ---
      let reg;
      if (payload.qr_data) {
        const qrRecord = await SaasQr.findByQrData(payload.qr_data);
        if (!qrRecord) {
          return res.status(404).json({ success: false, message: `QR code "${payload.qr_data}" not found.` });
        }
        if (!qrRecord.attendee_id) {
          return res.status(400).json({ success: false, message: `QR code "${payload.qr_data}" is not yet assigned to any attendee.` });
        }
        reg = await SaasAttendee.findById(parseInt(qrRecord.attendee_id));
      } else {
        reg = await SaasAttendee.findById(parseInt(payload.attendee_id));
      }
      if (!reg) {
        return res.status(404).json({ success: false, message: 'Registration not found.' });
      }

      if (reg.festival_id !== festivalId) {
        return res.status(403).json({ success: false, message: 'Registration does not belong to your festival.' });
      }
      if (reg.status === 'cancelled') {
        return res.status(409).json({ success: false, message: 'Attendee registration has been cancelled.' });
      }

      // --- Check if already checked in at this venue ---
      const venueId = checkin_venue_id ? parseInt(checkin_venue_id) : null;
      const existing = await SaasCheckin.findByAttendeeAndVenue(reg.id, venueId);
      if (existing) {
        const venues = await FestivalVenue.findByFestivalId(festivalId);
        const matchedVenue = venues.find(v => Number(v.venue_id) === Number(existing.checkin_venue_id || venueId));
        const venueName = matchedVenue ? matchedVenue.venue_name : (existing.checkin_venue_id ? `Venue #${existing.checkin_venue_id}` : 'this venue');
        const formattedTime = formatCheckinTime(existing.check_in_at || existing.created_at);

        return res.status(409).json({
          success: false,
          message: `Attendee already checked in at ${formattedTime} at ${venueName}.`,
          data: {
            checkin_id: existing.checkin_id,
            check_in_at: existing.check_in_at,
            checkin_venue_id: existing.checkin_venue_id,
            venue_name: venueName,
            formatted_check_in_at: formattedTime
          },
        });
      }

      // --- Determine role ---
      const [festivalRows] = await query(
        'SELECT user_id FROM film_festivals WHERE film_festival_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1',
        [festivalId]
      );
      const festivalOwnerUserId = festivalRows.length > 0 ? festivalRows[0].user_id : null;
      const checkedInByRole = checkedInByUserId === festivalOwnerUserId ? 'admin' : 'volunteer';

      // --- Clean delegate_category ---
      const cleanDelegateCategory = (delegate_category && typeof delegate_category === 'string' && delegate_category.trim() !== '')
        ? delegate_category.trim()
        : null;

      // --- Create check-in record ---
      const checkin = await SaasCheckin.create({
        attendeeId:              reg.id,
        eventId:                 reg.event_id,
        festivalId,
        checkinVenueId:          checkin_venue_id ? parseInt(checkin_venue_id) : null,
        delegateCategory:        cleanDelegateCategory,
        checkedInByUserId,
        checkedInByRole,
        checkedInByVolunteerId:  checkedInByRole === 'volunteer' ? checkedInByUserId : null,
        remarks:                 remarks || null,
      });

      // --- Override delegate_category in saas_attendees table to latest check-in if provided ---
      if (cleanDelegateCategory) {
        await SaasAttendee.updateDelegateCategory(reg.id, cleanDelegateCategory);
      }

      return res.json({
        success: true,
        message: `${reg.name} successfully checked in.`,
        data: {
          checkin_id:       checkin.id,
          registration_id:  reg.id,
          name:             reg.name,
          email:            reg.email,
          delegate_category: cleanDelegateCategory || reg.delegate_category || null,
          checkin_venue_id: checkin_venue_id || null,
        },
      });
    } catch (err) {
      console.error('checkIn error:', err.message);
      return res.status(500).json({ success: false, message: 'Failed to process check-in.' });
    }
  }

  static async scanQrCode(req, res) {
    try {
      const festivalId = parseInt(req.params.festival_id);
      const qr_token = req.params.qr_token;

      if (!qr_token) {
        return res.status(400).json({ success: false, message: 'QR token is required.' });
      }

      // Fetch venues for the festival to construct venue array and status evaluation
      const venues = await FestivalVenue.findByFestivalId(festivalId);
      const venueNamesArray = venues.map(v => v.venue_name);

      // Helper to return error response with specific entry_status and message
      const returnError = (entryStatus, message) => {
        return res.status(400).json({
          success: false,
          message: message || entryStatus,
          data: {
            name: null,
            category: null,
            registration_type: null,
            venue: [],
            email: null,
            phone: null,
            entry_status: entryStatus,
            registration_time: null,
            checkin_time: null
          }
        });
      };

      // --- Decrypt PASETO token ---
      let payload;
      try {
        payload = await decryptQrPayload(qr_token);
      } catch {
        return returnError('Invalid QR', 'Invalid QR code.');
      }

      // Cross-check the festival embedded in the token against the route param (if present)
      if (payload.festival_id && payload.festival_id !== festivalId) {
        return returnError('Different Festival QR', 'QR code belongs to a different festival.');
      }

      // --- Load attendee ---
      let reg;
      if (payload.qr_data) {
        const qrRecord = await SaasQr.findByQrData(payload.qr_data);
        if (!qrRecord) {
          return returnError('Invalid QR', 'Invalid QR code.');
        }
        if (!qrRecord.attendee_id) {
          return returnError('Unassigned QR', 'QR code is unassigned.');
        }
        reg = await SaasAttendee.findById(parseInt(qrRecord.attendee_id));
      } else if (payload.attendee_id) {
        reg = await SaasAttendee.findById(parseInt(payload.attendee_id));
      }

      if (!reg) {
        return returnError('Invalid QR', 'Attendee registration not found.');
      }

      if (reg.festival_id !== festivalId) {
        return returnError('Different Festival QR', 'QR code belongs to a different festival.');
      }

      // Get all check-ins for this attendee
      const allCheckins = await SaasCheckin.findAllByAttendeeId(reg.id);
      const festivalCheckins = allCheckins.filter(c => Number(c.festival_id) === Number(festivalId));

      const checkedInVenueIds = new Set(
        festivalCheckins
          .map(c => c.checkin_venue_id !== null ? Number(c.checkin_venue_id) : null)
          .filter(id => id !== null && !isNaN(id))
      );

      // Filter venues to ONLY show already checked in venues
      const checkedInVenueNames = venues
        .filter(v => checkedInVenueIds.has(Number(v.venue_id)))
        .map(v => v.venue_name);

      // Calculate entry_status:
      // "Checked In" only when checked in at ALL venues listed in festival venues.
      // If checked in at some (or 0) venues but not all venues, return "Not Checked In".
      let entryStatus = 'Not Checked In';
      if (reg.status === 'cancelled') {
        entryStatus = 'Cancelled';
      } else if (venues.length > 0) {
        const festivalVenueIds = venues.map(v => Number(v.venue_id));
        const checkedInAllVenues = festivalVenueIds.every(id => checkedInVenueIds.has(id));
        if (checkedInAllVenues) {
          entryStatus = 'Checked In';
        }
      } else {
        // If festival has no registered venues, consider checked in if there is at least 1 check-in
        if (festivalCheckins.length > 0) {
          entryStatus = 'Checked In';
        }
      }

      // Determine venue-specific check-in time
      const checkin_venue_id = req.query.checkin_venue_id ? parseInt(req.query.checkin_venue_id) : null;
      let targetVenueId = checkin_venue_id;
      if (!targetVenueId && venues.length === 1) {
        targetVenueId = venues[0].venue_id;
      }

      let checkinTime = null;
      if (targetVenueId) {
        const venueCheckin = festivalCheckins.find(c => Number(c.checkin_venue_id) === Number(targetVenueId));
        checkinTime = venueCheckin ? (venueCheckin.check_in_at || venueCheckin.created_at || null) : null;
      } else {
        const latestCheckin = festivalCheckins.length > 0 ? festivalCheckins[0] : null;
        checkinTime = latestCheckin ? (latestCheckin.check_in_at || latestCheckin.created_at || null) : null;
      }

      // Detailed check-in info per venue
      const venueCheckins = venues
        .filter(v => checkedInVenueIds.has(Number(v.venue_id)))
        .map(v => {
          const fc = festivalCheckins.find(c => Number(c.checkin_venue_id) === Number(v.venue_id));
          return {
            venue_id: v.venue_id,
            venue_name: v.venue_name,
            category: fc && fc.delegate_category ? fc.delegate_category : (reg.delegate_category || null),
            checkin_time: fc ? (fc.check_in_at || fc.created_at || null) : null
          };
        });

      const registrationTime = reg.registered_at || reg.created_at || null;

      // Delegate category from saas_checkins table (or fallback to registration category)
      const checkinWithCategory = festivalCheckins.find(c => c.delegate_category);
      const categoryFromCheckin = checkinWithCategory
        ? checkinWithCategory.delegate_category
        : (reg.delegate_category || null);

      return res.status(200).json({
        success: true,
        message: 'QR scan processed successfully.',
        data: {
          name: reg.name,
          category: categoryFromCheckin,
          registration_type: reg.registration_type || null,
          // venue: checkedInVenueNames,
          venue_checkins: venueCheckins,
          email: SaasQr.maskEmail(reg.email),
          phone: SaasQr.maskPhone(reg.phone),
          entry_status: entryStatus,
          registration_time: registrationTime,
          // checkin_time: checkinTime
        }
      });
    } catch (err) {
      console.error('scanQrCode error:', err.message);
      return res.status(500).json({ success: false, message: 'Failed to process QR scan.' });
    }
  }
}

module.exports = CheckinController;
