const SaasAttendee = require('../models/SaasAttendee');
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
const { sendTicketEmail } = require('../utils/mailer');

// Multer: in-memory CSV upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || path.extname(file.originalname).toLowerCase() === '.csv') {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed.'));
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
          const hasEmail = csvHeaders.includes('email');
          const hasPhone = csvHeaders.includes('phone');
          const hasCategory = csvHeaders.includes('delegate category') || csvHeaders.includes('delegate_category') || csvHeaders.includes('delegatecategory') || csvHeaders.includes('category');

          const missing = [];
          if (!hasName) missing.push('name');
          if (!hasEmail) missing.push('email');
          if (!hasPhone) missing.push('phone');
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

        //set


        // --- Validation ---
        const result = validate(req.body, {
          name:     [rules.required(), rules.string(), rules.maxLength(255)],
          email:    [rules.required(), rules.email(),  rules.maxLength(255)],
          phone:    [rules.required(), rules.string(), rules.minLength(10), rules.maxLength(30)],
          delegate_category: [
            rules.required(),
            rules.string(),
            rules.inList(['Student', 'Senior Citizen', 'Filmmaker', 'Film Fraternity', 'Guest', 'General Delegate', 'Discovery Market', 'Echoes Film Club'])
          ],
          registration_type: [
            rules.required(),
            rules.string(),
            rules.inList(['Pre-Registered', 'On-Spot'])
          ]
        });

        // --- Validate qr_id if provided ---
        let qrRecord = null;
        if (qrId !== null) {
          if (isNaN(qrId)) {
            return res.status(400).json({ success: false, message: 'qr_id must be a valid number.' });
          }

          qrRecord = await SaasQr.findById(qrId);
          if (!qrRecord) {
            return res.status(400).json({ success: false, message: `QR code with qr_id ${qrId} not found.` });
          }

          if (qrRecord.attendee_id !== null) {
            return res.status(400).json({ success: false, message: 'QR code provided already assigned to another attendee.' });
          }
        }

        // Check if email already registered for this festival
        const emailExists = await SaasAttendee.existsByEmail(email, festivalId);
        if (emailExists) {
          result.valid = false;
          result.errors.email = result.errors.email || [];
          result.errors.email.push('The email has already been registered for this festival.');
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
          await SaasQr.assignAttendee(qrId, reg.id);
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

      // Generate QR code from PASETO token
      const qrBuffer = await QRCode.toBuffer(pasetoToken, { width: 250, margin: 1 });
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

      // Generate QR code image from resolved content
      const qrBuffer = await QRCode.toBuffer(qrContent, { width: 250, margin: 1 });
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

}

module.exports = RegistrationController;
