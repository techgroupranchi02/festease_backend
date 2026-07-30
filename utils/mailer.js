'use strict';

const nodemailer = require('nodemailer');

// Load SMTP settings from .env
const smtpHost = process.env.SMTP_HOST || '';
const smtpPort = parseInt(process.env.SMTP_PORT) || 587;
const smtpUser = process.env.SMTP_USER || process.env.MAIL_USERNAME || '';
const smtpPass = process.env.SMTP_PASS || process.env.MAIL_PASSWORD || '';
const smtpFrom = process.env.SMTP_FROM || (smtpUser ? `"FestEase Support" <${smtpUser}>` : '"FestEase Support" <support@festease.com>');

let transporter = null;

if (smtpHost && smtpUser && smtpPass) {
  transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465, // true for 465, false for other ports
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });
  console.log(`[MAILER] SMTP Transporter configured for host: ${smtpHost}:${smtpPort}`);
} else {
  console.log('[MAILER] SMTP configuration not fully set in .env. Falling back to console logger.');
}

/**
 * Send an email with a ticket attachment.
 *
 * @param {object} params
 * @param {string} params.to          - Recipient email address
 * @param {string} params.subject     - Email subject line
 * @param {string} params.htmlBody    - HTML body content of the email
 * @param {Buffer} [params.pdfBuffer] - Optional ticket PDF buffer to attach
 * @param {string} [params.filename]  - Optional attachment filename
 * @returns {Promise<{ success: boolean, messageId?: string }>}
 */
async function sendTicketEmail({ to, subject, htmlBody, qrBuffer, pdfBuffer, filename = 'ticket.pdf' }) {
  const attachments = [];

  if (qrBuffer) {
    attachments.push({
      filename: 'qrcode.png',
      content: qrBuffer,
      cid: 'qrcode_cid',
    });
  }

  if (pdfBuffer) {
    attachments.push({
      filename,
      content: pdfBuffer,
      contentType: 'application/pdf',
    });
  }

  const mailOptions = {
    from: smtpFrom,
    to,
    subject,
    html: htmlBody,
    attachments,
  };

  if (transporter) {
    try {
      const info = await transporter.sendMail(mailOptions);
      console.log(`[MAILER] Email successfully sent to ${to}. Message ID: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (err) {
      console.error(`[MAILER] Failed to send email to ${to}:`, err.message);
      throw err;
    }
  } else {
    console.log('\n=================== MOCK EMAIL SENT ===================');
    console.log(`To:      ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Attachment: ${pdfBuffer ? `${filename} (${pdfBuffer.length} bytes)` : 'None'}`);
    console.log('-------------------------------------------------------');
    console.log('HTML Body (first 300 chars):');
    console.log(htmlBody.slice(0, 300) + '...');
    console.log('=======================================================\n');
    return { success: true, messageId: 'mock-id-log' };
  }
}

module.exports = { sendTicketEmail };
