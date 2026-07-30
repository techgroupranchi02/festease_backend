'use strict';

const SaasAttendee                        = require('../models/SaasAttendee');
const SaasCheckin                         = require('../models/SaasCheckin');
const SaasQr                              = require('../models/SaasQr');
const FestivalVenue                       = require('../models/FestivalVenue');
const { validate, rules, sendValidationError } = require('../middlewares/validate');
const { decryptQrPayload }                = require('../utils/paseto');
const { query }                           = require('../config/db');

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
   *
   * `qr_token` is the PASETO v4.local token embedded in the attendee's QR code.
   *
   * Two token shapes are supported:
   *   1. Pre-listed QR token: { qr_id, qr_data, attendee_id, event_id, festival_id, iat }
   *      → The qr_data (e.g. "BISFF2026-10001") is used to look up the
   *        attendee via the saas_qr table (qr_data → attendee_id).
   *   2. Legacy attendee token: { attendee_id, event_id, festival_id, iat }
   *      → attendee_id is used directly for the DB lookup.
   */
  static async checkIn(req, res) {
    try {
      const festivalId         = parseInt(req.params.festival_id);
      const checkedInByUserId  = req.user.user_id;
      const { qr_token, checkin_venue_id, remarks } = req.body || {};

      // --- Input validation ---
      const result = validate(req.body, {
        qr_token: [rules.required(), rules.string()],
      });
      if (!result.valid) return sendValidationError(res, result.errors);

      // --- Decrypt & verify PASETO token ---
      let payload;
      try {
        payload = await decryptQrPayload(qr_token);
      } catch {
        // Do not reveal token internals in the error message
        return res.status(400).json({ success: false, message: 'Invalid or expired QR code.' });
      }

      // Cross-check the festival embedded in the token against the route param (if present)
      if (payload.festival_id && payload.festival_id !== festivalId) {
        return res.status(403).json({ success: false, message: 'QR code does not belong to this festival.' });
      }

      // --- Load attendee ---
      // If the token contains qr_data (pre-listed QR flow), find the attendee
      // via the saas_qr table.  Otherwise fall back to the attendee_id in the token.
      let reg;
      if (payload.qr_data) {
        // Pre-listed QR: look up the saas_qr row by qr_data
        const qrRecord = await SaasQr.findByQrData(payload.qr_data);
        if (!qrRecord) {
          return res.status(404).json({ success: false, message: `QR code "${payload.qr_data}" not found.` });
        }
        if (!qrRecord.attendee_id) {
          return res.status(400).json({ success: false, message: `QR code "${payload.qr_data}" is not yet assigned to any attendee.` });
        }
        reg = await SaasAttendee.findById(parseInt(qrRecord.attendee_id));
      } else {
        // Legacy token: attendee_id embedded directly
        reg = await SaasAttendee.findById(parseInt(payload.attendee_id));
      }
      if (!reg) {
        return res.status(404).json({ success: false, message: 'Registration not found.' });
      }

      // Belt-and-suspenders: ensure DB record matches token festival
      if (reg.festival_id !== festivalId) {
        return res.status(403).json({ success: false, message: 'Registration does not belong to your festival.' });
      }
      if (reg.status === 'cancelled') {
        return res.status(409).json({ success: false, message: 'Attendee registration has been cancelled.' });
      }

      // --- Check if already checked in ---
      const existing = await SaasCheckin.findByAttendeeId(reg.id);
      if (existing) {
        return res.status(409).json({
          success: false,
          message: 'Attendee is already checked in.',
          data: { checkin_id: existing.checkin_id, check_in_at: existing.check_in_at, checkin_venue_id: existing.checkin_venue_id },
        });
      }

      // --- Determine role from JWT ---
      // --- Determine role ---
      // If the logged-in user is the festival owner, record role as 'admin', otherwise 'volunteer'
      const [festivalRows] = await query(
        'SELECT user_id FROM film_festivals WHERE film_festival_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1',
        [festivalId]
      );
      const festivalOwnerUserId = festivalRows.length > 0 ? festivalRows[0].user_id : null;
      const checkedInByRole = checkedInByUserId === festivalOwnerUserId ? 'admin' : 'volunteer';

      // --- Create check-in record ---
      const checkin = await SaasCheckin.create({
        attendeeId:              reg.id,
        eventId:                 reg.event_id,
        festivalId,
        checkinVenueId:          checkin_venue_id ? parseInt(checkin_venue_id) : null,
        checkedInByUserId,
        checkedInByRole,
        checkedInByVolunteerId:  checkedInByRole === 'volunteer' ? checkedInByUserId : null,
        remarks:                 remarks || null,
      });

      return res.json({
        success: true,
        message: `${reg.name} successfully checked in.`,
        data: {
          checkin_id:       checkin.id,
          registration_id:  reg.id,
          name:             reg.name,
          email:            reg.email,
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

      // Helper to return Invalid / Unassigned QR response
      const returnUnassigned = () => {
        return res.status(400).json({
          success: false,
          message: 'Invalid / Unassigned QR',
          data: {
            name: 'N/A',
            category: 'N/A',
            registration_type: 'N/A',
            venue: 'N/A',
            entry_status: 'Invalid / Unassigned QR'
          }
        });
      };

      // --- Decrypt PASETO token ---
      let payload;
      try {
        payload = await decryptQrPayload(qr_token);
      } catch {
        return returnUnassigned();
      }

      // Cross-check the festival embedded in the token against the route param (if present)
      if (payload.festival_id && payload.festival_id !== festivalId) {
        return returnUnassigned();
      }

      // --- Load attendee ---
      // If the token contains qr_data (pre-listed QR flow), find the attendee
      // via the saas_qr table.  Otherwise fall back to the attendee_id in the token.
      let reg;
      if (payload.qr_data) {
        const qrRecord = await SaasQr.findByQrData(payload.qr_data);
        if (!qrRecord || !qrRecord.attendee_id) {
          return returnUnassigned();
        }
        reg = await SaasAttendee.findById(parseInt(qrRecord.attendee_id));
      } else if (payload.attendee_id) {
        reg = await SaasAttendee.findById(parseInt(payload.attendee_id));
      }

      if (!reg || reg.festival_id !== festivalId) {
        return returnUnassigned();
      }

      // Check check-in status
      const existing = await SaasCheckin.findByAttendeeId(reg.id);

      // Fetch venues for the festival to resolve names
      const venues = await FestivalVenue.findByFestivalId(festivalId);

      // If already checked in
      if (existing) {
        let venueName = 'N/A';
        if (existing.checkin_venue_id) {
          const matchedVenue = venues.find(v => v.venue_id === existing.checkin_venue_id);
          if (matchedVenue) {
            venueName = matchedVenue.venue_name;
          }
        }
        return res.status(200).json({
          success: true,
          message: 'Already Checked In',
          data: {
            name: reg.name,
            category: reg.delegate_category || 'N/A',
            registration_type: reg.registration_type || 'N/A',
            venue: venueName,
            entry_status: 'Already Checked In'
          }
        });
      }

      // If not yet checked in, register check-in
      const loggedInUserId = req.user.user_id;

      // Resolve roles
      const [festivalRows] = await query(
        'SELECT user_id FROM film_festivals WHERE film_festival_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1',
        [festivalId]
      );
      const festivalOwnerUserId = festivalRows.length > 0 ? festivalRows[0].user_id : null;
      const checkedInByRole = Number(loggedInUserId) === Number(festivalOwnerUserId) ? 'admin' : 'volunteer';

      // Read checkin_venue_id from query parameters if present
      const checkin_venue_id = req.query.checkin_venue_id ? parseInt(req.query.checkin_venue_id) : null;
      const remarks = req.query.remarks || null;

      // Default venue resolution: if no checkin_venue_id is specified but there is exactly 1 venue, default to it
      let resolvedVenueId = checkin_venue_id;
      if (!resolvedVenueId && venues.length === 1) {
        resolvedVenueId = venues[0].venue_id;
      }

      // Create check-in
      await SaasCheckin.create({
        attendeeId:              reg.id,
        eventId:                 reg.event_id,
        festivalId,
        checkinVenueId:          resolvedVenueId,
        checkedInByUserId:       loggedInUserId,
        checkedInByRole,
        checkedInByVolunteerId:  checkedInByRole === 'volunteer' ? loggedInUserId : null,
        remarks,
      });

      // Fetch venue name for the checked-in record
      let venueName = 'N/A';
      if (resolvedVenueId) {
        const matchedVenue = venues.find(v => v.venue_id === resolvedVenueId);
        if (matchedVenue) {
          venueName = matchedVenue.venue_name;
        }
      }

      return res.json({
        success: true,
        message: 'Checked In',
        data: {
          name: reg.name,
          category: reg.delegate_category || 'N/A',
          registration_type: reg.registration_type || 'N/A',
          venue: venueName,
          entry_status: 'Checked In'
        }
      });
    } catch (err) {
      console.error('scanQrCode error:', err.message);
      return res.status(500).json({ success: false, message: 'Failed to process QR scan.' });
    }
  }

















}

module.exports = CheckinController;
