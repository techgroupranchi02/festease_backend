'use strict';

const QRCode = require('qrcode');
const { createCanvas, loadImage } = require('canvas');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { query } = require('../config/db');

/**
 * Generate a QR code image PNG buffer with the festival logo centered.
 * Uses Error Correction Level 'H' (30% damage tolerance) to guarantee
 * 100% scanability with central logo overlay.
 *
 * @param {string} text - QR content (PASETO token)
 * @param {number|null} [festivalId] - Festival ID to retrieve festival logo
 * @param {object} [options]
 * @param {number} [options.width=350] - QR canvas width/height in px
 * @returns {Promise<Buffer>} PNG image buffer
 */
async function generateQrWithCenterLogo(text, festivalId = null, options = {}) {
  const canvasWidth = options.width || 350;
  let logoImg = null;

  try {
    if (festivalId) {
      const [festRows] = await query(
        'SELECT film_festival_logo_image_name FROM film_festivals WHERE film_festival_id = ? LIMIT 1',
        [festivalId]
      );

      if (festRows && festRows.length > 0 && festRows[0].film_festival_logo_image_name) {
        const logoName = festRows[0].film_festival_logo_image_name;
        const possiblePaths = [
          path.join('/var/www/Freecomers_backend/public/images/film-festivals', logoName),
          path.join(__dirname, '../public/images/film-festivals', logoName),
          path.join(__dirname, '../assets', logoName),
        ];

        const foundPath = possiblePaths.find(p => fs.existsSync(p));

        if (foundPath) {
          if (foundPath.endsWith('.webp')) {
            const pyCode = 'from PIL import Image; import sys; img=Image.open(sys.argv[1]).convert("RGBA"); img.save(sys.stdout.buffer, "PNG")';
            const pngBuf = execFileSync('python3', ['-c', pyCode, foundPath]);
            logoImg = await loadImage(pngBuf);
          } else {
            logoImg = await loadImage(foundPath);
          }
        }
      }
    }
  } catch (err) {
    console.error('[qrLogoHelper] Festival logo fetch error:', err.message);
  }

  // Fallback to default festival logo if festival logo not found
  if (!logoImg) {
    const fallbackPath = path.join(__dirname, '../assets/bisff_logo.png');
    if (fs.existsSync(fallbackPath)) {
      try {
        logoImg = await loadImage(fallbackPath);
      } catch (_) {}
    }
  }

  const canvas = createCanvas(canvasWidth, canvasWidth);

  // Generate QR code onto Canvas with Error Correction Level 'H' (High - 30%)
  await QRCode.toCanvas(canvas, text, {
    errorCorrectionLevel: 'H',
    width: canvasWidth,
    margin: 1,
    color: {
      dark: '#000000',
      light: '#FFFFFF',
    },
  });

  if (logoImg) {
    const ctx = canvas.getContext('2d');

    // Logo dimensions: 22% of total QR canvas width
    const logoSize = Math.floor(canvasWidth * 0.22);
    const logoX = Math.floor((canvasWidth - logoSize) / 2);
    const logoY = Math.floor((canvasWidth - logoSize) / 2);

    // Rounded white background behind logo for high contrast & scan stability
    const bgPadding = 6;
    const bgSize = logoSize + bgPadding;
    const bgX = Math.floor((canvasWidth - bgSize) / 2);
    const bgY = Math.floor((canvasWidth - bgSize) / 2);

    ctx.fillStyle = '#FFFFFF';
    const radius = 6;
    ctx.beginPath();
    ctx.moveTo(bgX + radius, bgY);
    ctx.arcTo(bgX + bgSize, bgY, bgX + bgSize, bgY + bgSize, radius);
    ctx.arcTo(bgX + bgSize, bgY + bgSize, bgX, bgY + bgSize, radius);
    ctx.arcTo(bgX, bgY + bgSize, bgX, bgY, radius);
    ctx.arcTo(bgX, bgY, bgX + bgSize, bgY, radius);
    ctx.closePath();
    ctx.fill();

    // Draw logo inside center box
    ctx.drawImage(logoImg, logoX, logoY, logoSize, logoSize);
  }

  return canvas.toBuffer('image/png');
}

module.exports = { generateQrWithCenterLogo };
