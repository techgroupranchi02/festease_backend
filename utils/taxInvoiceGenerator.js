const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

let cachedLogoDataUri = null;
function getLogoDataUri() {
  if (cachedLogoDataUri) return cachedLogoDataUri;
  try {
    const p = path.join(__dirname, '../assets/logo-red.png');
    if (fs.existsSync(p)) {
      const b64 = fs.readFileSync(p).toString('base64');
      cachedLogoDataUri = `data:image/png;base64,${b64}`;
      return cachedLogoDataUri;
    }
  } catch (_) {}
  return '';
}

/**
 * Format number in Indian currency style (e.g. 1,00,000.00)
 */
function formatInr(num) {
  const n = Number(num) || 0;
  return n.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Format Date into "16 Sep 2026"
 */
function formatDate(dateObj) {
  const d = dateObj ? new Date(dateObj) : new Date();
  const day = String(d.getDate()).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

/**
 * Calculate bi-weekly settlement period based on transaction date
 * e.g. 01 Sep 2026 – 15 Sep 2026 or 16 Sep 2026 – 30 Sep 2026
 */
function getSettlementPeriod(dateObj) {
  const d = dateObj ? new Date(dateObj) : new Date();
  const year = d.getFullYear();
  const monthIdx = d.getMonth();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthStr = months[monthIdx];

  if (d.getDate() <= 15) {
    return `01 ${monthStr} ${year} – 15 ${monthStr} ${year}`;
  } else {
    const lastDay = new Date(year, monthIdx + 1, 0).getDate();
    return `16 ${monthStr} ${year} – ${lastDay} ${monthStr} ${year}`;
  }
}

/**
 * Generate Tax Invoice HTML string matching original Freecomers theme and colors
 */
function buildTaxInvoiceHtml(data = {}) {
  const invoiceNo = data.invoiceNo || data.invoiceNumber || 'FC-FEST-000001';
  const invoiceDate = data.invoiceDate || formatDate(new Date());
  const paymentStatus = (data.paymentStatus || 'PENDING').toUpperCase();
  const settlementPeriod = data.settlementPeriod || getSettlementPeriod(new Date());

  const fest = data.festival || {};
  const festivalName = data.festivalName || fest.festival_name || fest.name || 'Film Festival';
  const festivalId = data.festivalId || fest.film_festival_id || fest.festival_id || fest.id || 'N/A';
  const contactPerson = data.contactPerson || fest.contact_person || fest.beneficiary_name || fest.legal_entity_name || fest.org_name || fest.ind_name || 'Festival Organizer';
  const email = data.email || fest.email || fest.bank_email || fest.user_email || '—';
  let address = data.address || fest.address || fest.film_festival_venue || '—';
  if (Array.isArray(address)) {
    address = address.filter(Boolean).join(', ');
  }
  const gstin = data.gstin || fest.gstin || fest.pan_number || 'N/A';

  const fin = data.financials || {};
  const grossAmount = Number(data.grossAmount !== undefined ? data.grossAmount : (fin.grossAmount !== undefined ? fin.grossAmount : (fin.baseFeeAmount || 0)));
  const commissionRate = Number(data.commissionRate !== undefined ? data.commissionRate : (fin.commissionRate || 6));
  const commissionAmount = Number(data.commissionAmount !== undefined ? data.commissionAmount : (fin.commissionAmount !== undefined ? fin.commissionAmount : (grossAmount * (commissionRate / 100))));
  const totalInvoiceAmount = Number(data.totalInvoiceAmount !== undefined ? data.totalInvoiceAmount : (fin.totalInvoiceAmount !== undefined ? fin.totalInvoiceAmount : commissionAmount));

  const routeFeeRate = Number(data.routeFeeRate !== undefined ? data.routeFeeRate : (fin.routeFeeRate || 0.25));
  const routeGstRate = Number(data.routeGstRate !== undefined ? data.routeGstRate : (fin.routeGstRate || 18));
  const routeBase = grossAmount - commissionAmount;
  const routeFeeAmount = Number(data.routeFeeAmount !== undefined ? data.routeFeeAmount : (fin.routeFeeAmount !== undefined ? fin.routeFeeAmount : Number((routeBase * (routeFeeRate / 100) * (1 + routeGstRate / 100)).toFixed(2))));
  const netSettlement = Number(data.netSettlement !== undefined ? data.netSettlement : (data.netPayable !== undefined ? data.netPayable : (fin.netSettlement !== undefined ? fin.netSettlement : Number((grossAmount - commissionAmount - routeFeeAmount).toFixed(2)))));

  const logoUri = getLogoDataUri();

  // Status badge styling
  let badgeClass = 'status-pending';
  let badgeIcon = '&#9679;';
  if (paymentStatus === 'SETTLED' || paymentStatus === 'PAID' || paymentStatus === 'SUCCESS') {
    badgeClass = 'status-paid';
    badgeIcon = '&#10003;';
  } else if (paymentStatus === 'REFUNDED') {
    badgeClass = 'status-refunded';
    badgeIcon = '&#10007;';
  }

  const generatedDateStr = `${formatDate(new Date())}, ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Tax Invoice - ${invoiceNo}</title>
  <style>
    @page {
      size: A4;
      margin: 0;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      background-color: #ffffff;
      color: #1a1a2e;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      padding: 24px 34px;
      font-size: 11px;
      line-height: 1.35;
      width: 100%;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      position: relative;
    }

    /* Watermark */
    .watermark {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-35deg);
      font-size: 5.8rem;
      font-weight: 900;
      color: rgba(230, 57, 70, 0.035);
      letter-spacing: 8px;
      white-space: nowrap;
      pointer-events: none;
      z-index: -1000;
    }

    /* Top Header */
    .header-table {
      width: 100%;
      border-collapse: collapse;
      border-bottom: 3px solid #e63946;
      padding-bottom: 8px;
      margin-bottom: 12px;
    }
    .header-table td {
      border: none;
      vertical-align: middle;
    }
    .logo-container {
      width: 50%;
      text-align: left;
    }
    .logo-img {
      max-width: 175px;
      height: auto;
      display: block;
    }
    .invoice-title-container {
      width: 50%;
      text-align: right;
    }
    .invoice-title {
      font-size: 1.35rem;
      font-weight: 800;
      color: #1a1a2e;
      letter-spacing: 2px;
      text-transform: uppercase;
    }
    .invoice-number {
      font-size: 0.76rem;
      color: #555555;
      margin-top: 2px;
      font-weight: 600;
    }
    .status-badge {
      display: inline-block;
      padding: 2px 9px;
      border-radius: 12px;
      font-size: 0.64rem;
      font-weight: 700;
      letter-spacing: 0.5px;
      margin-top: 4px;
    }
    .status-paid {
      background: #d4edda;
      color: #155724;
    }
    .status-pending {
      background: #fff3cd;
      color: #856404;
    }
    .status-refunded {
      background: #f8d7da;
      color: #721c24;
    }

    /* Global Table Fix */
    table {
      width: 100%;
      table-layout: fixed;
      border-collapse: collapse;
    }

    /* Meta Table (Invoice No, Date, Status, Period) */
    .meta-table {
      background: #f8f9fa;
      border: 1px solid #e8e8e8;
      border-radius: 6px;
      margin-bottom: 12px;
    }
    .meta-table td {
      padding: 6px 12px;
      vertical-align: top;
      border-right: 1px solid #e8e8e8;
      border-bottom: 1px solid #e8e8e8;
    }
    .meta-table tr:last-child td {
      border-bottom: none;
    }
    .meta-table tr td:last-child {
      border-right: none;
    }
    .meta-label {
      font-size: 10px;
      color: #777777;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 2px;
    }
    .meta-value {
      font-size: 12px;
      font-weight: 700;
      color: #1a1a2e;
    }

    /* Billed To / Issued By Grid */
    .parties-table {
      margin-bottom: 12px;
    }
    .party-card {
      background: #f8f9fa;
      border: 1px solid #e8e8e8;
      border-radius: 6px;
      padding: 8px 12px;
      vertical-align: top;
    }
    .party-spacer {
      width: 3%;
      border: none;
      background: transparent;
    }
    .party-title {
      font-size: 10.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #e63946;
      margin-bottom: 6px;
      border-bottom: 1px solid #eeeeee;
      padding-bottom: 3px;
    }
    .party-row {
      margin-bottom: 3px;
      font-size: 10.5px;
      line-height: 1.35;
    }
    .party-key {
      color: #666666;
      display: inline-block;
      width: 35%;
      vertical-align: top;
    }
    .party-val {
      font-weight: 600;
      color: #1a1a2e;
      display: inline-block;
      width: 63%;
      text-align: right;
      vertical-align: top;
      word-break: break-word;
    }

    /* Section Headings */
    .section-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: #e63946;
      margin-top: 10px;
      margin-bottom: 5px;
    }

    /* Data Tables */
    .data-table {
      border: 1px solid #e0e0e0;
      border-radius: 6px;
      overflow: hidden;
      margin-bottom: 10px;
    }
    .data-table th {
      background: #f4f4f6;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #555555;
      padding: 6px 10px;
      border-bottom: 1px solid #ddd;
    }
    .data-table td {
      padding: 5.5px 10px;
      font-size: 11px;
      color: #333333;
      border-bottom: 1px solid #eeeeee;
      vertical-align: middle;
    }
    .data-table tr:last-child td {
      border-bottom: none;
    }
    .text-right {
      text-align: right;
    }
    .bold {
      font-weight: 700;
      color: #1a1a2e;
    }
    .total-row {
      background: #f8f9fa;
      border-top: 1.5px solid #dddddd;
    }
    .total-row td {
      font-size: 11.5px;
      font-weight: 700;
      color: #1a1a2e;
    }
    .total-amount {
      color: #e63946;
      font-weight: 800;
    }
    .net-settlement-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 6px;
      margin-bottom: 8px;
      padding: 6.5px 12px;
      background: rgba(230, 57, 70, 0.08);
      border: 1.5px solid #e63946;
      border-radius: 5px;
    }
    .net-label {
      font-size: 11.5px;
      font-weight: 800;
      letter-spacing: 0.6px;
      text-transform: uppercase;
      color: #1a1a2e;
    }
    .net-amount {
      font-size: 13.5px;
      font-weight: 800;
      color: #e63946;
    }

    /* Note & Text */
    .settlement-note {
      font-size: 9.8px;
      line-height: 1.45;
      color: #4b5563;
      margin-top: 8px;
      margin-bottom: 8px;
    }

    /* Footer */
    .footer-table {
      margin-top: 12px;
      border-top: 1px solid #e0e0e0;
      padding-top: 5px;
    }
    .footer-table td {
      font-size: 9.5px;
      color: #888888;
      border: none;
    }
    .disclaimer-text {
      text-align: center;
      font-size: 9px;
      color: #999999;
      margin-top: 4px;
    }
  </style>
</head>
<body>
  <div class="watermark">FREECOMERS</div>

  <!-- Header with Original Red Logo and Tax Invoice title -->
  <table class="header-table">
    <tr>
      <td class="logo-container">
        ${logoUri ? `<img src="${logoUri}" alt="freecomers" class="logo-img">` : `<div style="font-size: 1.6rem; font-weight: 700; color: #e63946; letter-spacing: 1px;">freecomers</div>`}
      </td>
      <td class="invoice-title-container">
        <div class="invoice-title">TAX INVOICE</div>
        <div class="invoice-number">${invoiceNo}</div>
        <div><span class="status-badge ${badgeClass}">${badgeIcon} ${paymentStatus}</span></div>
      </td>
    </tr>
  </table>

  <!-- Meta Table (Invoice No, Date, Status, Settlement Period) -->
  <table class="meta-table">
    <tr>
      <td style="width: 50%;">
        <div class="meta-label">Invoice No.</div>
        <div class="meta-value">${invoiceNo}</div>
      </td>
      <td style="width: 50%;">
        <div class="meta-label">Invoice Date</div>
        <div class="meta-value">${invoiceDate}</div>
      </td>
    </tr>
    <tr>
      <td>
        <div class="meta-label">Payment Status</div>
        <div class="meta-value">${paymentStatus}</div>
      </td>
      <td>
        <div class="meta-label">Settlement Period</div>
        <div class="meta-value">${settlementPeriod}</div>
      </td>
    </tr>
  </table>

  <!-- Billed To & Issued By Cards -->
  <table class="parties-table">
    <tr>
      <!-- Billed To -->
      <td class="party-card" style="width: 48.5%;">
        <div class="party-title">BILLED TO</div>
        <div class="party-row"><span class="party-key">Festival Name:</span> <span class="party-val">${festivalName}</span></div>
        <div class="party-row"><span class="party-key">Festival ID:</span> <span class="party-val">${festivalId}</span></div>
        <div class="party-row"><span class="party-key">Contact Person:</span> <span class="party-val">${contactPerson}</span></div>
        <div class="party-row"><span class="party-key">Email:</span> <span class="party-val">${email}</span></div>
        <div class="party-row"><span class="party-key">Address:</span> <span class="party-val">${address}</span></div>
        <div class="party-row"><span class="party-key">GSTIN:</span> <span class="party-val">${gstin}</span></div>
      </td>

      <!-- Spacer -->
      <td class="party-spacer"></td>

      <!-- Issued By -->
      <td class="party-card" style="width: 48.5%;">
        <div class="party-title">ISSUED BY</div>
        <div class="party-row"><span class="party-key">Entity:</span> <span class="party-val">Freecomers Filmtech Pvt Ltd</span></div>
        <div class="party-row"><span class="party-key">GSTIN:</span> <span class="party-val">N/A</span></div>
        <div class="party-row"><span class="party-key">SAC Code:</span> <span class="party-val">998314</span></div>
        <div class="party-row"><span class="party-key">State:</span> <span class="party-val">Maharashtra</span></div>
        <div class="party-row"><span class="party-key">Address:</span> <span class="party-val">Mumbai, Maharashtra</span></div>
        <div class="party-row"><span class="party-key">Email:</span> <span class="party-val">info@freecomers.com</span></div>
      </td>
    </tr>
  </table>

  <!-- FREECOMERS FEE DETAILS -->
  <div class="section-title">FREECOMERS FEE DETAILS</div>
  <table class="data-table">
    <thead>
      <tr>
        <th style="width: 55%; text-align: left;">Particular</th>
        <th style="width: 20%; text-align: left;">Rate</th>
        <th style="width: 25%; text-align: right;">Amount</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Gross Festival Submission Fees Collected</td>
        <td></td>
        <td class="text-right">₹${formatInr(grossAmount)}</td>
      </tr>
      <tr>
        <td>Freecomers Fee</td>
        <td>${commissionRate}%</td>
        <td class="text-right">₹${formatInr(commissionAmount)}</td>
      </tr>
      <tr class="total-row">
        <td class="bold">FREECOMERS FEE AMOUNT</td>
        <td></td>
        <td class="text-right bold total-amount">₹${formatInr(commissionAmount)}</td>
      </tr>
    </tbody>
  </table>

  <!-- FESTIVAL SETTLEMENT -->
  <div class="section-title">FESTIVAL SETTLEMENT</div>
  <table class="data-table">
    <tbody>
      <tr>
        <td style="width: 75%;">Gross Festival Submission Fees</td>
        <td style="width: 25%;" class="text-right">₹${formatInr(grossAmount)}</td>
      </tr>
      <tr>
        <td>Less: Freecomers Fee (${commissionRate}%)</td>
        <td class="text-right" style="color: #dc2626;">–₹${formatInr(commissionAmount)}</td>
      </tr>
      <tr>
        <td>Less: Razorpay Route Fee (${routeFeeRate}% + ${routeGstRate}% GST)</td>
        <td class="text-right" style="color: #dc2626;">–₹${formatInr(routeFeeAmount)}</td>
      </tr>
    </tbody>
  </table>

  <div class="net-settlement-bar">
    <div class="net-label">NET SETTLEMENT TO FESTIVAL</div>
    <div class="net-amount">₹${formatInr(netSettlement)}</div>
  </div>

  <div class="settlement-note">
    The Freecomers Fee is calculated at ${commissionRate}% of the gross festival submission fees collected through the Freecomers platform. The Razorpay Route Fee is deducted from the festival settlement as shown above.
  </div>

  <div class="disclaimer-text">
    This is a computer-generated document and does not require a physical signature.
  </div>

  <!-- Footer -->
  <table class="footer-table">
    <tr>
      <td style="text-align: left;">Generated on ${generatedDateStr} IST</td>
      <td style="text-align: right;">${invoiceNo} &nbsp;|&nbsp; Freecomers &copy; ${new Date().getFullYear()}</td>
    </tr>
  </table>

</body>
</html>`;
}

/**
 * Generate Tax Invoice PDF Buffer using Puppeteer
 */
async function generateTaxInvoicePdf(data) {
  const html = buildTaxInvoiceHtml(data);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '0px',
        right: '0px',
        bottom: '0px',
        left: '0px'
      }
    });

    return pdfBuffer;
  } finally {
    await browser.close();
  }
}

module.exports = {
  generateTaxInvoicePdf,
  buildTaxInvoiceHtml,
  formatInr,
  formatDate,
  getSettlementPeriod,
};
