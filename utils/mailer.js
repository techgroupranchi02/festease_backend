'use strict';

const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

// Load SMTP settings from .env
const smtpHost = process.env.SMTP_HOST || process.env.MAIL_HOST || '';
const smtpPort = parseInt(process.env.SMTP_PORT || process.env.MAIL_PORT) || 587;
const smtpUser = process.env.SMTP_USER || process.env.MAIL_USERNAME || '';
const smtpPass = process.env.SMTP_PASS || process.env.MAIL_PASSWORD || '';
const mailFromAddr = process.env.MAIL_FROM_ADDRESS || '';
const mailFromName = process.env.MAIL_FROM_NAME || 'FestEase Support';
const smtpFrom = process.env.SMTP_FROM || (mailFromAddr ? `"${mailFromName}" <${mailFromAddr}>` : (smtpUser && smtpUser.includes('@') ? `"${mailFromName}" <${smtpUser}>` : `"${mailFromName}" <info@freecomers.com>`));

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

/**
 * Send volunteer assignment email notification.
 *
 * @param {object} params
 * @param {string} params.to
 * @param {string} params.volunteerName
 * @param {string} params.festivalName
 * @param {string} params.loginLink
 * @param {string} params.deskName
 */
async function sendVolunteerAssignmentEmail({ to, volunteerName, festivalName, loginLink, deskName, logoUrl, festivalLogoUrl, festivalBannerUrl }) {
  const templatePath = path.join(__dirname, '../templates/volunteerAssignedEmail.html');
  let htmlBody = fs.readFileSync(templatePath, 'utf8');

  const defaultLogo = 'https://freecomers.com/_next/image?url=%2Flogo.png&w=640&q=75';

  let festivalBannerHtml = '';

  if (festivalBannerUrl) {
    festivalBannerHtml = `
      <tr>
        <td align="center" style="padding: 20px 24px 0 24px;">
          <!-- Main Table Container -->
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb; background-color: #ffffff; table-layout: fixed;">
            <!-- [IF IE]> <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="border: 1px solid #e5e7eb;"> <![ENDIF]-->
            
            <!-- Banner Image Row -->
            <tr>
              <td style="font-size: 0; line-height: 0;">
                <img src="${festivalBannerUrl}" alt="${festivalName || 'Festival'} Banner" width="600" style="width: 100%; max-width: 100%; height: auto; max-height: 200px; object-fit: cover; display: block; border-radius: 12px 12px 0 0;" />
              </td>
            </tr>

            <!-- Overlapping Row (Logo Left, Name Right, Left-Aligned) -->
            <tr>
              <td align="left" style="padding: 0 24px 20px 24px;">
                <!-- This empty row pushes the subsequent content up for the overlap -->
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                    <tr><td height="40" style="font-size: 40px; line-height: 40px;">&nbsp;</td></tr>
                </table>

                <!-- Content Container (Shifted Up via Outlook-safe technique) -->
                <!-- [IF GTE MSO 9]> <v:rect xmlns:v="urn:schemas-microsoft-com:vml" stroked="false" filled="false" style="width:552px;height:72px;v-text-anchor:top-baseline;position:absolute;top:-40px;"> <v:textbox inset="0,0,0,0"> <![ENDIF]-->
                <div style="margin-top: -40px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="left">
                      <tr>
                        <!-- Logo (Left) -->
                        ${festivalLogoUrl ? `
                        <td valign="middle" style="padding-right: 16px;">
                          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                            <tr>
                              <td style="background-color: #ffffff; padding: 4px; border-radius: 50%; border: 1px solid #ffffff; box-shadow: 0 4px 14px rgba(0,0,0,0.18);">
                                <img src="${festivalLogoUrl}" alt="${festivalName || 'Festival'} Logo" width="68" height="68" style="width: 68px; height: 68px; border-radius: 50%; object-fit: contain; display: block;" />
                              </td>
                            </tr>
                          </table>
                        </td>
                        ` : ''}

                        <!-- Name (Right) -->
                        ${festivalName ? `
                        <td valign="middle" align="left">
                          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol'; font-size: 20px; font-weight: 700; color: #111827; letter-spacing: -0.5px; line-height: 1.2;">
                            ${festivalName}
                          </div>
                        </td>
                        ` : ''}
                      </tr>
                    </table>
                </div>
                <!-- [IF GTE MSO 9]> </v:textbox> </v:rect> <![ENDIF]-->

              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  } else if (festivalLogoUrl || festivalName) {
    // If no banner exists, keep the elements stacked and left-aligned
    festivalBannerHtml = `
      <tr>
        <td align="center" style="padding: 24px 24px 0 24px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; text-align: left;">
            <tr>
              <td align="left">
                ${festivalLogoUrl ? `
                  <div style="display: inline-block; background-color: #ffffff; padding: 6px; border-radius: 50%; border: 2px solid #e5e7eb; box-shadow: 0 4px 12px rgba(0,0,0,0.08); vertical-align: middle;">
                    <img src="${festivalLogoUrl}" alt="${festivalName || 'Festival'} Logo" width="76" height="76" style="width: 76px; height: 76px; border-radius: 50%; object-fit: contain; display: block;" />
                  </div>
                ` : ''}
                ${festivalName ? `
                  <div style="margin-top: 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol'; font-size: 22px; font-weight: 700; color: #111827; vertical-align: middle;">
                    ${festivalName}
                  </div>
                ` : ''}
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  }

  htmlBody = htmlBody
    .replace(/\{\{\s*logo_url\s*\}\}/g, logoUrl || defaultLogo)
    .replace(/\{\{\s*festival_banner_html\s*\}\}/g, festivalBannerHtml)
    .replace(/\{\{\s*volunteer_name\s*\}\}/g, volunteerName || 'Volunteer')
    .replace(/\{\{\s*festival_name\s*\}\}/g, festivalName || 'BISFF')
    .replace(/\{\{\s*login_link\s*\}\}/g, loginLink)
    .replace(/\{\{\s*desk_name\s*\}\}/g, deskName || 'Registration Desk');

  const subject = `Welcome as Volunteer for ${festivalName || 'BISFF'}`;

  return sendTicketEmail({ to, subject, htmlBody });
}

module.exports = { sendTicketEmail, sendVolunteerAssignmentEmail };
