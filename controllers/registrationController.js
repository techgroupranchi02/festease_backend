const SaasAttendee = require('../models/SaasAttendee');
const SaasUnregisteredAttendee = require('../models/SaasUnregisteredAttendee');
const SaasQr = require('../models/SaasQr');
const FestivalVenue = require('../models/FestivalVenue');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const { validate, rules, sendValidationError } = require('../middlewares/validate');
const { query } = require('../config/db');
const { encryptQrPayload } = require('../utils/paseto');
const { generateQrWithCenterLogo } = require('../utils/qrLogoHelper');
const { sendTicketEmail } = require('../utils/mailer');

const XLSX = require('xlsx');

// Multer: in-memory CSV & Excel upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = ['.csv', '.xlsx', '.xls'];
    const allowedMimeTypes = [
      'text/csv',
      'application/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ];
    if (allowedExts.includes(ext) || allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and Excel (.xlsx, .xls) files are allowed.'));
    }
  }
});

class RegistrationController {
  /**
   * POST /api/v1/festivals/:festival_id/registrations
   * Register a single attendee (JSON) or bulk via CSV upload.
   *
   * Single JSON body: { name, email, phone, qr_id? }
   *   - If qr_id is provided, it must exist in saas_qr and not yet be assigned.
   *     The attendee is linked to that QR and no qr_token is generated.
   * CSV upload:       multipart/form-data with field "file" (.csv)
   */
  static register(req, res) {
    upload.single('file')(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ success: false, message: err.message });
      }

      try {
        const festivalId   = parseInt(req.params.festival_id);
        const registeredBy = req.user.user_id;

        if (!festivalId) {
          return res.status(400).json({ success: false, message: 'festival_id is required.' });
        }

        // Resolve event_id and festival owner internally from film_festivals
        const [festRows] = await query(
          'SELECT event_id, user_id, film_festival_start_date, film_festival_end_date FROM film_festivals WHERE film_festival_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1',
          [festivalId]
        );
        if (festRows.length === 0) {
          return res.status(404).json({ success: false, message: 'Film festival not found.' });
        }
        const eventId = festRows[0].event_id;
        const festivalOwnerUserId = festRows[0].user_id;

        // Compute automatic registration_type based on festival dates
        const startDate = festRows[0].film_festival_start_date ? new Date(festRows[0].film_festival_start_date) : null;
        const endDate   = festRows[0].film_festival_end_date ? new Date(festRows[0].film_festival_end_date) : null;
        const now       = new Date();

        let autoRegistrationType = 'Pre-Registered';
        if (!startDate || now < startDate) {
          autoRegistrationType = 'Pre-Registered';
        } else if (now >= startDate && (!endDate || now <= endDate)) {
          autoRegistrationType = 'On-Spot';
        } else {
          autoRegistrationType = 'On-Spot';
        }

        // 1. Check if user is registered as an active volunteer for this festival/event
        const [volRows] = await query(
          `SELECT volunteer_id FROM saas_volunteers
           WHERE user_id = ?
             AND (festival_id = ? OR event_id = ?)
             AND is_active = 1
             AND status = 'active'
             AND (expiry_date IS NULL OR expiry_date > NOW())
           LIMIT 1`,
          [registeredBy, festivalId, eventId]
        );

        let registeredByRole = 'volunteer';
        let volunteerId = null;

        if (volRows.length > 0) {
          registeredByRole = 'volunteer';
          volunteerId = volRows[0].volunteer_id;
        } else {
          // 2. If not a volunteer, check if user is the festival owner or event owner
          const [eventOwnerRows] = await query(
            `SELECT 1 FROM events WHERE user_id = ? AND event_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1`,
            [registeredBy, eventId]
          );

          const isOwner =
            Number(registeredBy) === Number(festivalOwnerUserId) ||
            eventOwnerRows.length > 0;

          registeredByRole = isOwner ? 'admin' : 'volunteer';
        }

        // ── CSV Bulk Registration ─────────────────────────────────────────────
        if (req.file) {
          const csvContent = req.file.buffer.toString('utf-8');
          let rows;
          try {
            rows = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true });
          } catch {
            return res.status(400).json({ success: false, message: 'Invalid CSV format.' });
          }

          if (!rows.length) {
            return res.status(400).json({ success: false, message: 'CSV file is empty.' });
          }

          const csvHeaders = Object.keys(rows[0]).map(k => k.toLowerCase().replace(/_/g, ' ').trim());
          const hasName = csvHeaders.includes('name');
          const hasCategory = csvHeaders.includes('delegate category') || csvHeaders.includes('delegate_category') || csvHeaders.includes('delegatecategory') || csvHeaders.includes('category');

          const missing = [];
          if (!hasName) missing.push('name');
          if (!hasCategory) missing.push('delegate category');

          if (missing.length) {
            return res.status(400).json({
              success: false,
              message: `CSV missing required columns: ${missing.join(', ')}`,
            });
          }

          // Populate registration_type automatically for each CSV row
          for (const row of rows) {
            row['registration_type'] = autoRegistrationType;
          }

          const results    = await SaasAttendee.bulkCreate(rows, festivalId, eventId, registeredBy, registeredByRole, volunteerId);
          const successful = results.filter(r => r.success).length;

          // Asynchronously send ticket emails sequentially in background
          (async () => {
            for (const item of results) {
              const attendeeId = item.id || item.attendee_id;
              if (item.success && attendeeId) {
                try {
                  const sendRes = await RegistrationController.sendTicketHelper(attendeeId, festivalId);
                  console.log(`[BULK EMAIL] Ticket email result for attendee ${attendeeId}:`, sendRes);
                } catch (err) {
                  console.error(`[BULK EMAIL ERROR] Attendee ${attendeeId}:`, err.message);
                }
              }
            }
          })();

          return res.json({
            success: true,
            message: `Bulk registration complete: ${successful}/${rows.length} registered. Ticket emails are being sent out.`,
            data: results,
          });
        }

        // ── Single JSON Registration ──────────────────────────────────────────
        req.body = req.body || {};
        req.body.registration_type = autoRegistrationType;
        const { name, email, phone, qr_id: rawQrId, delegate_category, registration_type } = req.body;
        const qrId = rawQrId ? parseInt(rawQrId) : null;

        const cleanEmail = email && typeof email === 'string' && email.trim() !== '' ? email.trim() : null;
        const cleanPhone = phone && typeof phone === 'string' && phone.trim() !== '' ? phone.trim() : null;

        // --- Validation ---
        const validationSchema = {
          name: [rules.required(), rules.string(), rules.maxLength(255)],
          delegate_category: [
            rules.required(),
            rules.string(),
            rules.inList(['Student / Senior Citizen', 'Student', 'Cinephile', 'Senior Citizen', 'Filmmaker', 'Film Fraternity', 'Guest', 'General Delegate', 'Discovery Film', 'Echoes School'])
          ],
          registration_type: [
            rules.required(),
            rules.string(),
            rules.inList(['Pre-Registered', 'On-Spot'])
          ]
        };

        if (cleanEmail) {
          validationSchema.email = [rules.email(), rules.maxLength(255)];
        }
        if (cleanPhone) {
          validationSchema.phone = [rules.string(), rules.minLength(10), rules.maxLength(30)];
        }

        const result = validate(req.body, validationSchema);

        // --- Validate qr_id if provided ---
        let qrRecord = null;
        if (qrId !== null) {
          if (isNaN(qrId)) {
            return res.status(400).json({ success: false, message: 'qr_id must be a valid number.' });
          }

          qrRecord = await SaasQr.findById(qrId);
          if (!qrRecord) {
            return res.status(400).json({ success: false, message: `QR ${qrId} does not exist.` });
          }
          if (qrRecord.festival_id !== null && Number(qrRecord.festival_id) !== Number(festivalId)) {
            return res.status(400).json({ success: false, message: 'This QR is not registered for this festival.' });
          }
          if (qrRecord.event_id !== null && Number(qrRecord.event_id) !== Number(eventId)) {
            return res.status(400).json({ success: false, message: 'This QR is not registered for this event.' });
          }
          if (qrRecord.attendee_id !== null) {
            return res.status(400).json({ success: false, message: 'QR Already Assigned' });
          }
        }

        // Check if email already registered for this festival
        if (cleanEmail) {
          const emailExists = await SaasAttendee.existsByEmail(cleanEmail, festivalId);
          if (emailExists) {
            result.valid = false;
            result.errors.email = result.errors.email || [];
            result.errors.email.push('The email has already been registered for this festival.');
          }
        }

        if (!result.valid) return sendValidationError(res, result.errors);

        const reg = await SaasAttendee.create({
          festivalId,
          eventId,
          registeredByUserId: registeredBy,
          registeredByRole,
          volunteerId,
          qrId,
          name,
          email,
          phone,
          delegateCategory: delegate_category,
          registrationType: registration_type,
        });

        // If a pre-listed qr_id was provided, link the attendee to the QR record
        if (qrId !== null) {
          await SaasQr.assignAttendee(qrId, reg.id, festivalId, eventId);
        }

        // Build response: only generate PASETO token when no pre-listed QR was used
        let pasetoToken = null;
        if (qrId === null) {
          pasetoToken = await encryptQrPayload({
            attendee_id: reg.id,
            event_id:    eventId,
            festival_id: festivalId,
            iat:         Math.floor(Date.now() / 1000),
          });
        }

        // Asynchronously send ticket email with PDF attachment
        RegistrationController.sendTicketHelper(reg.id, festivalId).catch(err => {
          console.error(`Single registration ticket email error for attendee ${reg.id}:`, err.message);
        });

        return res.status(201).json({
          success: true,
          message: 'Registration successful. Ticket email sent.',
          data: {
            attendee_id: reg.id,
            qr_id:       qrId,
            qr_token:    pasetoToken,
            name,
            email,
            phone,
            delegate_category,
            registration_type,
          },
        });

      } catch (error) {
        console.error('Registration error:', error.message);
        return res.status(500).json({ success: false, message: 'Registration failed.' });
      }
    });
  }


  /**
   * POST /api/v1/festivals/:festival_id/registrations/bulk
   * Bulk register attendees from uploaded CSV or Excel file into saas_unregistered_attendees table.
   * Expects multipart/form-data with field "file" (.csv).
   */
  static bulkUnregisteredRegister(req, res) {
    upload.single('file')(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ success: false, message: err.message });
      }

      if (!req.file) {
        return res.status(400).json({ success: false, message: 'File is required.' });
      }

      try {
        const festivalId = parseInt(req.params.festival_id);
        if (isNaN(festivalId)) {
          return res.status(400).json({ success: false, message: 'Invalid festival_id.' });
        }

        // Fetch event_id from film_festivals table
        const [festRows] = await query(
          'SELECT event_id FROM film_festivals WHERE film_festival_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1',
          [festivalId]
        );
        if (festRows.length === 0) {
          return res.status(404).json({ success: false, message: 'Film festival not found.' });
        }
        const eventId = festRows[0].event_id;

        // Parse CSV or Excel file
        let records = [];
        const fileExt = path.extname(req.file.originalname).toLowerCase();

        try {
          if (fileExt === '.xlsx' || fileExt === '.xls' || req.file.mimetype.includes('excel') || req.file.mimetype.includes('spreadsheetml')) {
            const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            records = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
          } else {
            try {
              records = parse(req.file.buffer, {
                columns: true,
                skip_empty_lines: true,
                trim: true,
              });
            } catch (csvErr) {
              const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
              const firstSheetName = workbook.SheetNames[0];
              const worksheet = workbook.Sheets[firstSheetName];
              records = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
            }
          }
        } catch (parseErr) {
          return res.status(400).json({ success: false, message: `Failed to parse file: ${parseErr.message}` });
        }

        if (!records || records.length === 0) {
          return res.status(400).json({ success: false, message: 'Uploaded file is empty.' });
        }

        const getRowValue = (row, possibleKeys) => {
          const rowKeys = Object.keys(row);
          const key = rowKeys.find(k => possibleKeys.includes(k.toLowerCase().replace(/[\s_]/g, '')));
          return key ? String(row[key] || '').trim() : '';
        };

        const attendeesToInsert = records.map(row => ({
          name: getRowValue(row, ['name', 'fullname']) || null,
          email: getRowValue(row, ['email', 'emailaddress']) || null,
          phone_number: getRowValue(row, ['phonenumber', 'phone', 'mobile', 'mobilenumber']) || null,
          delegate_category: getRowValue(row, ['delegatecategory', 'category']) || null,
        }));

        const insertedCount = await SaasUnregisteredAttendee.bulkCreate(festivalId, eventId, attendeesToInsert);

        return res.status(201).json({
          success: true,
          message: `Successfully added ${insertedCount} attendee(s) to saas_unregistered_attendees.`,
          data: {
            festival_id: festivalId,
            event_id: eventId,
            inserted_count: insertedCount,
          }
        });

      } catch (error) {
        console.error('Bulk registration error:', error.message);
        return res.status(500).json({ success: false, message: 'Bulk registration failed.' });
      }
    });
  }


  /**
   * GET /api/v1/festivals/:festival_id/un-registered
   * Get merged attendees (bulk unregistered and registered) with search, status filter, and pagination.
   * Query params: page, limit (or per_page), search, delegate_category, registration_status (or status / is_registered)
   */
  static async bulkGetUnregistered(req, res) {
    try {
      const festivalId = parseInt(req.params.festival_id);
      if (isNaN(festivalId)) {
        return res.status(400).json({ success: false, message: 'Invalid festival_id.' });
      }

      const page = parseInt(req.query.page) || 1;
      const limit = req.query.limit || req.query.per_page || 10;
      let search = req.query.search || req.query.Search || '';
      let delegateCategory = req.query.delegate_category || req.query.delegateCategory || '';
      let registrationStatus = req.query.registration_status || req.query.status || req.query.is_registered || '';

      if (typeof search === 'string' && search.includes('%')) {
        try {
          search = decodeURIComponent(search);
        } catch (e) {
          // ignore decode error if malformed % sequence
        }
      }
      if (typeof delegateCategory === 'string' && delegateCategory.includes('%')) {
        try {
          delegateCategory = decodeURIComponent(delegateCategory);
        } catch (e) {
          // ignore decode error if malformed % sequence
        }
      }
      if (typeof registrationStatus === 'string' && registrationStatus.includes('%')) {
        try {
          registrationStatus = decodeURIComponent(registrationStatus);
        } catch (e) {
          // ignore decode error if malformed % sequence
        }
      }

      const result = await SaasUnregisteredAttendee.findWithPagination({
        festivalId,
        search,
        page,
        limit,
        delegateCategory,
        registrationStatus,
      });

      const pageOffset = (result.page - 1) * (result.perPage || 10);
      const dataWithId = await Promise.all(result.data.map(async (item, index) => {
        let qrToken = item.qr_token || null;
        const qrId = item.qr_id || null;
        if (item.status === 'registered' && item.attendee_id && !qrToken) {
          try {
            if (qrId) {
              const qrRecord = await SaasQr.findById(qrId);
              const qrData = qrRecord ? qrRecord.qr_data : `BISFF2026-${qrId}`;
              qrToken = await encryptQrPayload({
                qr_id:       qrId,
                qr_data:     qrData,
                attendee_id: item.attendee_id,
                event_id:    item.event_id,
                festival_id: festivalId,
                iat:         Math.floor(Date.now() / 1000),
              });
            } else {
              qrToken = await encryptQrPayload({
                attendee_id: item.attendee_id,
                event_id:    item.event_id,
                festival_id: festivalId,
                iat:         Math.floor(Date.now() / 1000),
              });
            }
          } catch (pasetoErr) {
            console.error('Failed to generate PASETO token in bulkGetUnregistered:', pasetoErr.message);
          }
        }

        return {
          ...item,
          qr_id: qrId,
          id: pageOffset + index + 1,
          qr_token: qrToken,
        };
      }));

      return res.status(200).json({
        success: true,
        data: dataWithId,
        total: result.total,
        page: result.page,
        per_page: result.perPage,
        total_pages: result.totalPages,
      });
    } catch (error) {
      console.error('Bulk get error:', error.message);
      return res.status(500).json({ success: false, message: 'Bulk get failed.' });
    }
  }

  /**
   * GET /api/v1/festivals/:festival_id/registrations/:registration_id/pdf
   * Generate and stream ticket PDF for an attendee using Puppeteer to convert HTML.
   */
  static async downloadPdf(req, res) {
    let browser;
    try {
      const id = parseInt(req.params.registration_id);
      if (isNaN(id)) {
        return res.status(400).json({ success: false, message: 'Invalid registration ID.' });
      }

      const reg = await SaasAttendee.findById(id);
      if (!reg) {
        return res.status(404).json({ success: false, message: 'Registration not found.' });
      }

      const festivalId = parseInt(req.params.festival_id);
      if (festivalId && reg.festival_id !== festivalId) {
        return res.status(403).json({ success: false, message: 'Registration not in your festival.' });
      }

      // Fetch event name
      const [eventRows] = await query('SELECT name FROM events WHERE event_id = ? LIMIT 1', [reg.event_id]);
      const eventName = eventRows.length > 0 ? eventRows[0].name : 'Unknown Event';

      // Fetch venues
      const venuesList = await FestivalVenue.findByFestivalId(reg.festival_id);

      // Encrypt attendee identity as a PASETO v4 local token
      const pasetoToken = await encryptQrPayload({
        attendee_id: reg.id,
        event_id:    reg.event_id,
        festival_id: reg.festival_id,
        iat:         Math.floor(Date.now() / 1000),
      });

      // Generate QR code image with center festival logo (error correction level H)
      const qrBuffer = await generateQrWithCenterLogo(pasetoToken, reg.festival_id);
      const qrBase64 = qrBuffer.toString('base64');
      const qrDataUrl = `data:image/png;base64,${qrBase64}`;

      // Build HTML template by reading from the templates directory
      const templatePath = path.join(__dirname, '../templates/downloadPDF.html');
      let htmlContent = fs.readFileSync(templatePath, 'utf8');

      // Build venues HTML
      let venuesHtml = '';
      if (venuesList.length === 1) {
        venuesHtml = `
        <div class="info-row">
          <span class="info-label">Venue</span>
          <span class="info-value">${venuesList[0].venue_name}</span>
        </div>`;
      } else if (venuesList.length > 1) {
        venuesHtml = `
        <div style="margin-top: 0.5rem;">
          <span class="info-label" style="display: block; margin-bottom: 0.25rem;">Venues:</span>
          <ul class="venue-list">
            ${venuesList.map(v => `<li class="venue-item">${v.venue_name}</li>`).join('')}
          </ul>
        </div>`;
      }

      // Build phone HTML conditionally to avoid inline style interpolation errors
      const attendeePhoneHtml = reg.phone ? `
        <div class="info-row">
          <span class="info-label">Phone</span>
          <span class="info-value">${reg.phone}</span>
        </div>` : '';

      // Substitute template placeholders
      htmlContent = htmlContent
        .replace(/\{\{\s*attendee_name\s*\}\}/g, reg.name)
        .replace(/\{\{\s*attendee_email\s*\}\}/g, reg.email)
        .replace(/\{\{\s*attendee_phone_html\s*\}\}/g, attendeePhoneHtml)
        .replace(/\{\{\s*attendee_category\s*\}\}/g, reg.delegate_category || 'N/A')
        .replace(/\{\{\s*registration_type\s*\}\}/g, reg.registration_type || 'N/A')
        .replace(/\{\{\s*ticket_id\s*\}\}/g, reg.id)
        .replace(/\{\{\s*registered_on\s*\}\}/g, new Date(reg.registered_at || reg.created_at).toLocaleDateString())
        .replace(/\{\{\s*event_name\s*\}\}/g, eventName)
        .replace(/\{\{\s*venues_html\s*\}\}/g, venuesHtml)
        .replace(/\{\{\s*qr_data_url\s*\}\}/g, qrDataUrl);

      // Launch headless browser to render HTML and convert to PDF
      const puppeteer = require('puppeteer');
      browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      const page = await browser.newPage();
      await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

      // Generate PDF buffer
      const pdfBuffer = await page.pdf({
        format: 'A5',
        printBackground: true,
        margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' }
      });

      await browser.close();
      browser = null;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="ticket-${id}.pdf"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      return res.end(pdfBuffer);
    } catch (err) {
      console.error('downloadPdf error:', err.message);
      if (browser) {
        try { await browser.close(); } catch (_) {}
      }
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: 'Failed to generate ticket PDF.' });
      }
    }
  }

  /**
   * POST /api/v1/festivals/:festival_id/registrations/:registration_id/email
   * Send ticket HTML via email and attach the generated ticket PDF.
   */
  /**
   * Helper function to generate QR, render PDF ticket, and send email to attendee.
   */
  static async sendTicketHelper(registrationId, festivalId) {
    let browser;
    try {
      const id = parseInt(registrationId);
      if (isNaN(id)) return { success: false, message: 'Invalid registration ID.' };

      const reg = await SaasAttendee.findById(id);
      if (!reg) return { success: false, message: 'Registration not found.' };

      if (festivalId && reg.festival_id !== parseInt(festivalId)) {
        return { success: false, message: 'Registration not in specified festival.' };
      }

      // Fetch event name
      const [eventRows] = await query('SELECT name FROM events WHERE event_id = ? LIMIT 1', [reg.event_id]);
      const eventName = eventRows.length > 0 ? eventRows[0].name : 'Unknown Event';

      // Fetch venues
      const venuesList = await FestivalVenue.findByFestivalId(reg.festival_id);

      // Determine QR code content:
      //   - If attendee is linked to a pre-listed QR (qr_id set), PASETO-encrypt the qr_data payload.
      //   - Otherwise, PASETO-encrypt attendee identity as usual.
      let qrContent;
      if (reg.qr_id) {
        const qrRecord = await SaasQr.findById(reg.qr_id);
        const qrData = qrRecord ? qrRecord.qr_data : `BISFF2026-${reg.qr_id}`;
        qrContent = await encryptQrPayload({
          qr_id:       reg.qr_id,
          qr_data:     qrData,
          attendee_id: reg.id,
          event_id:    reg.event_id,
          festival_id: reg.festival_id,
          iat:         Math.floor(Date.now() / 1000),
        });
      } else {
        qrContent = await encryptQrPayload({
          attendee_id: reg.id,
          event_id:    reg.event_id,
          festival_id: reg.festival_id,
          iat:         Math.floor(Date.now() / 1000),
        });
      }

      // Generate QR code image with center festival logo (error correction level H)
      const qrBuffer = await generateQrWithCenterLogo(qrContent, reg.festival_id);
      const qrBase64 = qrBuffer.toString('base64');
      const qrDataUrl = `data:image/png;base64,${qrBase64}`;

      // ── Build venues HTML (email table-row style) ──
      let venuesHtml = '';
      if (venuesList.length === 1) {
        venuesHtml = `
          <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="font-size:13px;color:#6b7280;">Venue</td>
            <td style="font-size:13px;font-weight:600;color:#111827;text-align:right;">${venuesList[0].venue_name}</td>
          </tr></table>`;
      } else if (venuesList.length > 1) {
        venuesHtml = `
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="font-size:13px;color:#6b7280;padding-bottom:6px;">Venues</td></tr>
            ${venuesList.map(v => `
            <tr><td style="font-size:13px;font-weight:600;color:#111827;padding:2px 0 2px 12px;">&#8226; ${v.venue_name}</td></tr>`).join('')}
          </table>`;
      }

      // ── Build phone row (email table-row style) ──
      const attendeePhoneHtml = reg.phone ? `
        <tr><td style="padding:10px 0;border-bottom:1px solid #f3f4f6;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="font-size:13px;color:#6b7280;">Phone</td>
            <td style="font-size:13px;font-weight:600;color:#111827;text-align:right;">${reg.phone}</td>
          </tr></table>
        </td></tr>` : '';

      // ── Load and fill QREmail.html for the email body (using CID inline image) ──
      const emailTemplatePath = path.join(__dirname, '../templates/QREmail.html');
      let emailHtml = fs.readFileSync(emailTemplatePath, 'utf8');
      emailHtml = emailHtml
        .replace(/\{\{\s*attendee_name\s*\}\}/g,    reg.name)
        .replace(/\{\{\s*attendee_email\s*\}\}/g,   reg.email)
        .replace(/\{\{\s*attendee_phone_html\s*\}\}/g, attendeePhoneHtml)
        .replace(/\{\{\s*attendee_category\s*\}\}/g, reg.delegate_category || 'N/A')
        .replace(/\{\{\s*registration_type\s*\}\}/g, reg.registration_type || 'N/A')
        .replace(/\{\{\s*ticket_id\s*\}\}/g,         reg.id)
        .replace(/\{\{\s*registered_on\s*\}\}/g,     new Date(reg.registered_at || reg.created_at).toLocaleDateString())
        .replace(/\{\{\s*event_name\s*\}\}/g,        eventName)
        .replace(/\{\{\s*venues_html\s*\}\}/g,       venuesHtml)
        .replace(/\{\{\s*qr_data_url\s*\}\}/g,       'cid:qrcode_cid');

      // ── Generate PDF attachment using downloadPDF.html via Puppeteer ──
      const pdfTemplatePath = path.join(__dirname, '../templates/downloadPDF.html');
      let pdfHtml = fs.readFileSync(pdfTemplatePath, 'utf8');

      let pdfVenuesHtml = '';
      if (venuesList.length === 1) {
        pdfVenuesHtml = `<div class="info-row"><span class="info-label">Venue</span><span class="info-value">${venuesList[0].venue_name}</span></div>`;
      } else if (venuesList.length > 1) {
        pdfVenuesHtml = `<div style="margin-top:0.5rem;"><span class="info-label" style="display:block;margin-bottom:0.25rem;">Venues:</span><ul class="venue-list">${venuesList.map(v => `<li class="venue-item">${v.venue_name}</li>`).join('')}</ul></div>`;
      }
      const pdfPhoneHtml = reg.phone ? `<div class="info-row"><span class="info-label">Phone</span><span class="info-value">${reg.phone}</span></div>` : '';

      pdfHtml = pdfHtml
        .replace(/\{\{\s*attendee_name\s*\}\}/g,    reg.name)
        .replace(/\{\{\s*attendee_email\s*\}\}/g,   reg.email)
        .replace(/\{\{\s*attendee_phone_html\s*\}\}/g, pdfPhoneHtml)
        .replace(/\{\{\s*attendee_category\s*\}\}/g, reg.delegate_category || 'N/A')
        .replace(/\{\{\s*registration_type\s*\}\}/g, reg.registration_type || 'N/A')
        .replace(/\{\{\s*ticket_id\s*\}\}/g,         reg.id)
        .replace(/\{\{\s*registered_on\s*\}\}/g,     new Date(reg.registered_at || reg.created_at).toLocaleDateString())
        .replace(/\{\{\s*event_name\s*\}\}/g,        eventName)
        .replace(/\{\{\s*venues_html\s*\}\}/g,       pdfVenuesHtml)
        .replace(/\{\{\s*qr_data_url\s*\}\}/g,       qrDataUrl);

      const puppeteer = require('puppeteer');
      browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
      const page = await browser.newPage();
      await page.setContent(pdfHtml, { waitUntil: 'networkidle0' });
      const pdfBuffer = await page.pdf({
        format: 'A5',
        printBackground: true,
        margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' }
      });
      await browser.close();
      browser = null;

      // ── Send email with QREmail.html as body and PDF + CID QR image as attachments ──
      const subject = `Your Ticket for ${eventName}`;
      await sendTicketEmail({
        to:       reg.email,
        subject,
        htmlBody: emailHtml,
        qrBuffer,
        pdfBuffer,
        filename: `ticket-${id}.pdf`
      });

      return { success: true, recipient: reg.email };
    } catch (err) {
      console.error('sendTicketHelper error:', err.message);
      if (browser) {
        try { await browser.close(); } catch (_) {}
      }
      return { success: false, message: err.message };
    }
  }

  /**
   * POST /api/v1/festivals/:festival_id/registrations/:registration_id/email
   * Send ticket HTML via email and attach the generated ticket PDF.
   */
  static async sendTicket(req, res) {
    try {
      const id = parseInt(req.params.registration_id);
      const festivalId = parseInt(req.params.festival_id);
      const { channel = 'email' } = req.body || {};

      const sendRes = await RegistrationController.sendTicketHelper(id, festivalId);
      if (!sendRes.success) {
        return res.status(500).json({ success: false, message: sendRes.message || 'Failed to send ticket email.' });
      }

      return res.json({
        success: true,
        message: `Ticket successfully sent to ${sendRes.recipient} via ${channel}.`,
        data: {
          registration_id: id,
          channel,
          recipient: sendRes.recipient,
          status: 'sent',
        },
      });
    } catch (err) {
      console.error('sendTicket error:', err.message);
      return res.status(500).json({ success: false, message: 'Failed to send ticket email.' });
    }
  }

  /**
   * POST /api/v1/public/festivals/:festival_id/registrations
   * Public endpoint to insert attendees into saas_attendees table from CSV/Excel file.
   * Requires: file, delegate_category
   * Optional: qr_id_from, qr_id_to
   * Email sending is disabled for public registrations.
   */
  static publicRegister(req, res) {
    upload.any()(req, res, async (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          message: 'Validation error',
          errors: { file: err.message }
        });
      }

      try {
        const reqBody  = req.body || {};
        const reqQuery = req.query || {};

        const rawFestivalId = req.params.festival_id || reqBody.festival_id || reqQuery.festival_id;
        const festivalId    = parseInt(rawFestivalId);

        const validationErrors = {};

        if (!festivalId || isNaN(festivalId)) {
          validationErrors.festival_id = 'required';
        }

        // Check for uploaded file across any field name (file, csv, excel, upload, etc.)
        const uploadedFile = req.file || (req.files && req.files.length > 0 ? req.files[0] : null);
        if (!uploadedFile) {
          validationErrors.file = 'required';
        }

        // ── Extract delegate_category ────────────────────────────────────
        const fallbackCategory = (reqBody.delegate_category || reqBody.deligate_category || reqQuery.delegate_category || reqQuery.deligate_category)
          ? String(reqBody.delegate_category || reqBody.deligate_category || reqQuery.delegate_category || reqQuery.deligate_category).trim()
          : null;

        if (!fallbackCategory) {
          validationErrors.delegate_category = 'required';
        }

        // ── Extract optional QR ID Range ───────────────────────────────
        const rawQrFrom = reqBody.qr_id_from || reqBody.qr_from || reqQuery.qr_id_from || reqQuery.qr_from;
        const rawQrTo   = reqBody.qr_id_to   || reqBody.qr_to   || reqQuery.qr_id_to   || reqQuery.qr_to;

        const qrIdFrom = rawQrFrom ? parseInt(rawQrFrom) : null;
        const qrIdTo   = rawQrTo   ? parseInt(rawQrTo)   : null;

        if (qrIdFrom !== null && !isNaN(qrIdFrom)) {
          const fromId = qrIdFrom;
          const toId   = (qrIdTo !== null && !isNaN(qrIdTo)) ? qrIdTo : fromId;
          if (toId < fromId) {
            validationErrors.qr_id_to = 'must be greater than or equal to qr_id_from';
          }
        }

        if (Object.keys(validationErrors).length > 0) {
          return res.status(400).json({
            success: false,
            message: 'Validation error',
            errors: validationErrors
          });
        }

        // Fetch festival details to resolve event_id and owner user_id
        const [festRows] = await query(
          'SELECT event_id, user_id, film_festival_start_date, film_festival_end_date FROM film_festivals WHERE film_festival_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1',
          [festivalId]
        );
        if (festRows.length === 0) {
          return res.status(404).json({ success: false, message: 'Film festival not found.' });
        }

        const eventId = festRows[0].event_id;
        const festivalOwnerUserId = festRows[0].user_id || 1;

        // Auto-calculate registration_type based on festival dates
        const startDate = festRows[0].film_festival_start_date ? new Date(festRows[0].film_festival_start_date) : null;
        const endDate   = festRows[0].film_festival_end_date ? new Date(festRows[0].film_festival_end_date) : null;
        const now       = new Date();

        let autoRegistrationType = 'Pre-Registered';
        if (startDate && now >= startDate) {
          autoRegistrationType = 'On-Spot';
        }

        let availableQrIds = [];
        if (qrIdFrom !== null && !isNaN(qrIdFrom)) {
          const fromId = qrIdFrom;
          const toId   = (qrIdTo !== null && !isNaN(qrIdTo)) ? qrIdTo : fromId;

          // Query saas_qr table for unassigned QR IDs in range
          const [qrRows] = await query(
            `SELECT qr_id FROM saas_qr 
             WHERE qr_id BETWEEN ? AND ? 
               AND attendee_id IS NULL 
             ORDER BY qr_id ASC`,
            [fromId, toId]
          );

          availableQrIds = qrRows.map(r => r.qr_id);
        }

        let records = [];
        const fileExt = path.extname(uploadedFile.originalname).toLowerCase();

        try {
          if (fileExt === '.xlsx' || fileExt === '.xls' || (uploadedFile.mimetype && (uploadedFile.mimetype.includes('excel') || uploadedFile.mimetype.includes('spreadsheetml')))) {
            const workbook = XLSX.read(uploadedFile.buffer, { type: 'buffer' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            records = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
          } else {
            try {
              records = parse(uploadedFile.buffer, {
                columns: true,
                skip_empty_lines: true,
                trim: true,
              });
            } catch (csvErr) {
              const workbook = XLSX.read(uploadedFile.buffer, { type: 'buffer' });
              const firstSheetName = workbook.SheetNames[0];
              const worksheet = workbook.Sheets[firstSheetName];
              records = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
            }
          }
        } catch (parseErr) {
          return res.status(400).json({
            success: false,
            message: 'Validation error',
            errors: { file: `Failed to parse file: ${parseErr.message}` }
          });
        }

        if (!records || records.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'Validation error',
            errors: { file: 'Uploaded file is empty.' }
          });
        }

        const getRowValue = (row, possibleKeys) => {
          const rowKeys = Object.keys(row);
          const key = rowKeys.find(k => possibleKeys.includes(k.toLowerCase().replace(/[\s_]/g, '')));
          return key ? String(row[key] || '').trim() : '';
        };

        const results = [];
        const batchEmails = new Set();

        for (const row of records) {
          // Skip completely empty rows
          const rowValues = Object.values(row).map(v => String(v || '').trim()).filter(Boolean);
          if (rowValues.length === 0) continue;

          try {
            const name = getRowValue(row, ['name', 'fullname', 'full_name', 'attendee_name', 'attendeename']);
            if (!name) {
              throw new Error('Name is required.');
            }

            const rawEmail = getRowValue(row, ['email', 'emailaddress', 'email_address']);
            const cleanEmail = rawEmail ? rawEmail.toLowerCase().trim() : null;

            if (cleanEmail) {
              if (batchEmails.has(cleanEmail)) {
                throw new Error('Duplicate email in upload file.');
              }
              const emailExists = await SaasAttendee.existsByEmail(cleanEmail, festivalId);
              if (emailExists) {
                throw new Error('Email is already registered for this festival.');
              }
              batchEmails.add(cleanEmail);
            }

            const rawPhone = getRowValue(row, ['phone', 'phonenumber', 'phone_number', 'mobile', 'mobilenumber', 'mobile_number']);
            const cleanPhone = rawPhone ? rawPhone.trim() : null;

            const delegateCategory = getRowValue(row, ['delegatecategory', 'deligatecategory', 'delegate_category', 'deligate_category', 'category']) || fallbackCategory;
            if (!delegateCategory) {
              throw new Error('delegate_category is required.');
            }

            const registrationType = getRowValue(row, ['registrationtype', 'registration_type', 'type']) || autoRegistrationType;

            let assignedQrId = null;
            if (qrIdFrom !== null && !isNaN(qrIdFrom)) {
              if (availableQrIds.length === 0) {
                throw new Error('No available unassigned QR code left in specified range [qr_id_from, qr_id_to].');
              }
              assignedQrId = availableQrIds.shift();
            }

            const reg = await SaasAttendee.create({
              festivalId,
              eventId,
              registeredByUserId: festivalOwnerUserId,
              registeredByRole: 'admin',
              qrId: assignedQrId,
              name,
              email: cleanEmail,
              phone: cleanPhone,
              delegateCategory,
              registrationType,
            });

            if (assignedQrId) {
              await SaasQr.updateAttendeeId(assignedQrId, reg.id);
            }

            results.push({
              attendee_id: reg.id,
              qr_id: assignedQrId,
              qr_token: reg.qr_token,
              name,
              email: cleanEmail,
              phone: cleanPhone,
              delegate_category: delegateCategory,
              registration_type: registrationType,
              success: true,
            });
          } catch (rowErr) {
            results.push({
              row,
              success: false,
              error: rowErr.message,
            });
          }
        }

        const successfulCount = results.filter(r => r.success).length;

        return res.status(201).json({
          success: true,
          message: `Public bulk registration complete: ${successfulCount}/${results.length} registered successfully.`,
          data: results,
        });

      } catch (error) {
        console.error('Public registration error:', error.message);
        return res.status(500).json({ success: false, message: 'Public registration failed.' });
      }
    });
  }

}

module.exports = RegistrationController;
