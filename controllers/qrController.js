'use strict';

const SaasAttendee        = require('../models/SaasAttendee');
const SaasQr              = require('../models/SaasQr');
const QRCode              = require('qrcode');
const JSZip               = require('jszip');
const { encryptQrPayload, decryptQrPayload } = require('../utils/paseto');
const { generateQrWithCenterLogo } = require('../utils/qrLogoHelper');

class QrController {
  /**
   * GET /api/v1/festivals/:festival_id/registrations/:registration_id/qr
   *
   * Generate a QR code PNG whose content is a PASETO v3.local token
   * (encrypted, authenticated) containing:
   *   { qr_token, festival_id, attendee_id }
   *
   * The scanning client sends this token to the check-in endpoint, which
   * decrypts it with the same symmetric key and looks up the attendee.
   */
  static async generateQr(req, res) {
    try {
      const id = parseInt(req.params.registration_id);
      if (isNaN(id)) {
        return res.status(400).json({ success: false, message: 'Invalid registration ID.' });
      }

      const reg = await SaasAttendee.findById(id);
      if (!reg) {
        return res.status(404).json({ success: false, message: 'Registration not found.' });
      }

      // Verify it belongs to the festival in the route
      const festivalId = parseInt(req.params.festival_id);
      if (festivalId && reg.festival_id !== festivalId) {
        return res.status(403).json({ success: false, message: 'Registration not in your festival.' });
      }

      // Encrypt attendee identity as a PASETO v4 local token
      const pasetoToken = await encryptQrPayload({
        attendee_id: reg.id,
        event_id:    reg.event_id,
        festival_id: reg.festival_id,
      });

      // Encode the PASETO token string into the QR image with center festival logo
      const qrBuffer = await generateQrWithCenterLogo(pasetoToken, reg.festival_id, { width: 300 });

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', `inline; filename="qr-${id}.png"`);
      res.setHeader('Content-Length', qrBuffer.length);
      return res.end(qrBuffer);
    } catch (err) {
      console.error('generateQr error:', err.message);
      if (!res.headersSent) {
        return res.status(500).json({ success: false, message: 'Failed to generate QR code.' });
      }
    }
  }


  static async getUnusedQrData(req, res) {
    try {
      const festivalId = parseInt(req.params.festival_id) || (req.query.festival_id ? parseInt(req.query.festival_id) : null);
      const search = req.query.search || req.query.q || '';
      const status = req.query.status || 'all';
      const page = parseInt(req.query.page) || 1;
      const perPage = req.query.per_page || req.query.perPage || req.query.limit || 1000;

      const result = await SaasQr.getUnusedQrData({ search, status, page, perPage, festivalId });

      return res.status(200).json({
        success: true,
        data: result.data,
        total: result.total,
        page: result.page,
        per_page: result.perPage,
      });
    } catch (err) {
      console.error('getUnusedQrData error:', err);

      return res.status(500).json({
        success: false,
        message: 'Failed to fetch unused QR data.',
      });
    }
  }


  /**
   * GET /api/v1/festivals/:festival_id/registrations/qr-prelist
   *
   * Generate PASETO tokens (and base64 QR codes) for pre-listed QR data.
   */
  static async getPreListQrData(req, res) {
    try {
      const festivalId = parseInt(req.params.festival_id) || (req.query.festival_id ? parseInt(req.query.festival_id) : null);
      const search = req.query.search || req.query.q || '';
      const status = req.query.status || 'all';
      const page = parseInt(req.query.page) || 1;
      const perPage = req.query.per_page || req.query.perPage || req.query.limit || 1000;
      const includeImage = req.query.include_image === 'true' || req.query.image === 'true';

      const result = await SaasQr.getUnusedQrData({ search, status, page, perPage, festivalId });

      const dataWithPaseto = await Promise.all(
        result.data.map(async (item) => {
          const pasetoToken = await encryptQrPayload({
            qr_id: item.qr_id,
            qr_data: item.qr_data,
            attendee_id: item.attendee_id,
            festival_id: festivalId,
          });

          let qrImageBase64 = null;
          if (includeImage) {
            qrImageBase64 = await QRCode.toDataURL(pasetoToken, {
              width: 300,
              margin: 2,
              color: { dark: '#000000', light: '#FFFFFF' },
            });
          }

          return {
            ...item,
            paseto_token: pasetoToken,
            ...(includeImage && { qr_image_base64: qrImageBase64 }),
          };
        })
      );

      return res.status(200).json({
        success: true,
        data: dataWithPaseto,
        total: result.total,
        page: result.page,
        per_page: result.perPage,
      });
    } catch (err) {
      console.error('getPreListQrData error:', err);

      return res.status(500).json({
        success: false,
        message: 'Failed to generate pre-list QR data.',
      });
    }
  }

  /**
   * GET /api/v1/festivals/:festival_id/registrations/qr-prelist/:qr_id/image
   *
   * Stream PNG image of PASETO-encrypted QR code for a specific pre-listed QR entry.
   */
  static async generatePreListQrImage(req, res) {
    try {
      const qrId = parseInt(req.params.qr_id);
      if (isNaN(qrId)) {
        return res.status(400).json({ success: false, message: 'Invalid QR ID.' });
      }

      const qrItem = await SaasQr.findById(qrId);
      if (!qrItem) {
        return res.status(404).json({ success: false, message: 'QR data not found.' });
      }

      const festivalId = parseInt(req.params.festival_id) || null;

      const pasetoToken = await encryptQrPayload({
        qr_id: qrItem.qr_id,
        qr_data: qrItem.qr_data,
        attendee_id: qrItem.attendee_id,
        festival_id: festivalId,
      });

      const qrBuffer = await generateQrWithCenterLogo(pasetoToken, festivalId, { width: 300 });

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', `inline; filename="qr-${qrItem.qr_data}.png"`);
      res.setHeader('Content-Length', qrBuffer.length);
      return res.end(qrBuffer);
    } catch (err) {
      console.error('generatePreListQrImage error:', err);
      if (!res.headersSent) {
        return res.status(500).json({ success: false, message: 'Failed to generate QR image.' });
      }
    }
  }

  /**
   * GET /api/v1/download/all/pre-qr-images
   *
   * Generates a ZIP archive (QR.zip) containing one PNG per row in saas_qr.
   * Each PNG is a QR code whose content is the PASETO-encrypted payload:
   *   { qr_id, qr_data, attendee_id }
   *
   * ZIP structure:
   *   QR.zip
   *   └── QR/
   *       ├── BISFF2026-10001.png
   *       ├── BISFF2026-10002.png
   *       └── ...
   */
  static async generateAllPreListQrImage(req, res) {
    try {
      const rows = await SaasQr.findAll();
      if (!rows || rows.length === 0) {
        return res.status(404).json({ success: false, message: 'No QR data found in saas_qr table.' });
      }

      const zip = new JSZip();
      const folder = zip.folder('QR');

      // Generate each QR PNG and add to the zip folder
      for (const row of rows) {
        const pasetoToken = await encryptQrPayload({
          qr_id:       row.qr_id,
          qr_data:     row.qr_data,
          attendee_id: row.attendee_id,
        });

        const pngBuffer = await generateQrWithCenterLogo(pasetoToken, row.festival_id || null, { width: 300 });

        folder.file(`${row.qr_data}.png`, pngBuffer);
      }

      // Generate the ZIP buffer and send as download
      const zipBuffer = await zip.generateAsync({
        type:        'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="QR.zip"');
      res.setHeader('Content-Length', zipBuffer.length);
      return res.end(zipBuffer);
    } catch (err) {
      console.error('generateAllPreListQrImage error:', err.message);
      if (!res.headersSent) {
        return res.status(500).json({ success: false, message: 'Failed to generate QR ZIP archive.' });
      }
    }
  }

  /**
   * POST /api/v1/decrypt-qr
   *
   * Decrypts a PASETO v4 local token and returns the decoded payload.
   *
   * Body: { token: "v4.local.xxx..." }
   */
  static async decryptQr(req, res) {
    try {
      const { token } = req.body || {};
      if (!token) {
        return res.status(400).json({ success: false, message: 'token is required in the request body.' });
      }

      let payload;
      try {
        payload = await decryptQrPayload(token);
      } catch {
        return res.status(400).json({ success: false, message: 'Invalid or expired QR token.' });
      }

      return res.json({ success: true, data: payload });
    } catch (err) {
      console.error('decryptQr error:', err.message);
      return res.status(500).json({ success: false, message: 'Failed to decrypt QR token.' });
    }
  }
}

module.exports = QrController;
