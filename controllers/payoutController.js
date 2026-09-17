const FestivalPayment = require('../models/FestivalPayment');
const { query } = require('../config/db');
const { generateTaxInvoicePdf, formatDate, getSettlementPeriod } = require('../utils/taxInvoiceGenerator');

/**
 * PayoutController
 *
 * FestEase endpoints for festival organizers to view their payout details,
 * submission ledger, bank account info, and settlement parameters.
 */
class PayoutController {

  /**
   * GET /api/festivals/:festival_id/payouts
   * Paginated submission payout ledger for a specific festival.
   */
  static async getPayouts(req, res) {
    try {
      const festivalId = parseInt(req.params.festival_id || req.festivalId || req.query.festival_id, 10);
      if (!festivalId) {
        return res.status(400).json({ success: false, status: false, message: 'Festival ID is required.' });
      }

      const page = parseInt(req.query.page, 10) || 1;
      const perPage = parseInt(req.query.per_page, 10) || 20;
      const status = req.query.status || 'all';
      const search = req.query.search || '';

      // Get KPIs
      const kpis = await FestivalPayment.getKpis(festivalId);

      // Get paginated ledger
      const ledger = await FestivalPayment.getByFestival(festivalId, {
        page, perPage, status, search,
      });

      return res.json({
        success: true,
        status: true,
        message: 'Payout data retrieved.',
        data: {
          kpis,
          ledger,
        },
      });
    } catch (error) {
      console.error('PayoutController::getPayouts error:', error.message);
      return res.status(500).json({
        success: false,
        status: false,
        message: 'Failed to retrieve payout data.',
      });
    }
  }

  /**
   * GET /api/festivals/:festival_id/payouts/export-csv
   * Export payout ledger as CSV.
   */
  static async exportCsv(req, res) {
    try {
      const festivalId = parseInt(req.params.festival_id || req.festivalId || req.query.festival_id, 10);
      if (!festivalId) {
        return res.status(400).json({ success: false, status: false, message: 'Festival ID is required.' });
      }

      const ledger = await FestivalPayment.getByFestival(festivalId, {
        page: 1, perPage: 10000,
      });

      const csvHeader = [
        'Submission ID', 'Filmmaker', 'Email', 'Currency',
        'Base Fee', 'Platform Fee', 'GST', 'Gateway Fee', 'Gateway GST',
        'Gross Amount', 'Freecomers Fee', 'Route Fee', 'Route GST',
        'Net Settled', 'Transfer ID', 'Status', 'Refund ID', 'Refund Amount', 'Reverse Transfer ID', 'Refund Reason', 'Refunded At', 'Date'
      ].join(',');

      const csvRows = (ledger.data || []).map(p => [
        p.submission_id,
        `"${(p.filmmaker_name || 'N/A').replace(/"/g, '""')}"`,
        `"${(p.filmmaker_email || 'N/A').replace(/"/g, '""')}"`,
        p.currency,
        p.base_fee_amount,
        p.platform_fee_amount,
        p.freecomers_gst_amount,
        p.gateway_fee_amount,
        p.gateway_gst_amount,
        p.gross_amount,
        p.commission_amount,
        p.route_fee_amount,
        p.route_gst_amount,
        p.settlement_status === 'refunded' ? 0 : p.net_settled_amount,
        p.razorpay_transfer_id || '',
        p.settlement_status,
        p.refund_id || '',
        p.refund_amount || '',
        p.reverse_transfer_id || '',
        `"${(p.refund_reason || '').replace(/"/g, '""')}"`,
        p.refunded_at || '',
        p.created_at || '',
      ].join(','));

      const csv = [csvHeader, ...csvRows].join('\n');
      const filename = `festival_payouts_${festivalId}_${new Date().toISOString().split('T')[0]}.csv`;

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(csv);
    } catch (error) {
      console.error('PayoutController::exportCsv error:', error.message);
      return res.status(500).json({
        success: false,
        status: false,
        message: 'Failed to export CSV.',
      });
    }
  }

  /**
   * GET /api/festivals/:festival_id/settlement-settings
   * Bank account info + Route split parameters for the festival.
   */
  static async getSettlementSettings(req, res) {
    try {
      const festivalId = parseInt(req.params.festival_id || req.festivalId || req.query.festival_id, 10);
      if (!festivalId) {
        return res.status(400).json({ success: false, status: false, message: 'Festival ID is required.' });
      }

      const bankAccount = await FestivalPayment.getBankAccount(festivalId);
      const settlementParams = await FestivalPayment.getSettlementParams(festivalId);

      return res.json({
        success: true,
        status: true,
        message: 'Settlement settings retrieved.',
        data: {
          bank_account: bankAccount,
          settlement_params: settlementParams,
          route_constants: {
            route_fee_rate: 0.25,
            route_gst_rate: 18,
            domestic_gateway_rate: 2,
            international_gateway_rate: 3,
            settlement_cycle: 'T+7',
          },
        },
      });
    } catch (error) {
      console.error('PayoutController::getSettlementSettings error:', error.message);
      return res.status(500).json({
        success: false,
        status: false,
        message: 'Failed to retrieve settlement settings.',
      });
    }
  }

  /**
   * GET /api/festivals/:festival_id/payouts/:payment_id/receipt
   * Generate and download festival payout Tax Invoice PDF.
   */
  static async getReceipt(req, res) {
    try {
      const festivalId = parseInt(req.params.festival_id || req.festivalId || req.query.festival_id, 10);
      const paymentId = parseInt(req.params.payment_id, 10);
      if (!festivalId || !paymentId) {
        return res.status(400).json({ success: false, status: false, message: 'Festival ID and Payment ID are required.' });
      }

      // 1. Look up payment record
      const [rows] = await query(
        `SELECT id, festival_id, submission_id, transaction_record_id, user_id, project_id,
                currency, base_fee_amount, gross_amount, commission_rate, commission_amount,
                settlement_status, settled_at, created_at
         FROM festival_payments 
         WHERE festival_id = ? AND (id = ? OR transaction_record_id = ?)
         LIMIT 1`,
        [festivalId, paymentId, paymentId]
      );

      const payment = rows?.[0];
      if (!payment) {
        return res.status(404).json({ success: false, status: false, message: 'Payment record not found.' });
      }

      // 2. Look up festival, event, and bank account information
      const [festRows] = await query(
        `SELECT ff.film_festival_id, ff.film_festival_venue,
                e.name as festival_name,
                fba.beneficiary_name, fba.legal_entity_name, fba.email as bank_email, fba.pan_number,
                u.email as user_email,
                ind.name as individual_name,
                org.name as org_name, org.address as org_address
         FROM film_festivals ff
         LEFT JOIN events e ON e.event_id = ff.event_id
         LEFT JOIN festival_bank_accounts fba ON fba.festival_id = ff.film_festival_id
         LEFT JOIN users u ON u.id = ff.user_id
         LEFT JOIN individuals ind ON ind.user_id = ff.user_id
         LEFT JOIN organizations org ON org.id = ff.organization_id
         WHERE ff.film_festival_id = ?
         LIMIT 1`,
        [festivalId]
      );

      const fest = festRows?.[0] || {};

      // Parse venue if JSON array or string
      let venueAddress = fest.film_festival_venue;
      if (Array.isArray(venueAddress)) {
        venueAddress = venueAddress.filter(Boolean).join(', ');
      } else if (typeof venueAddress === 'string') {
        try {
          const parsed = JSON.parse(venueAddress);
          if (Array.isArray(parsed)) {
            venueAddress = parsed.filter(Boolean).join(', ');
          }
        } catch (_) {}
      }

      const festivalName = fest.festival_name || fest.org_name || 'Film Festival';
      const festivalCode = `FC-FEST-${String(festivalId).padStart(4, '0')}`;
      const contactPerson = fest.beneficiary_name || fest.legal_entity_name || fest.individual_name || fest.org_name || 'Festival Director';
      const email = fest.bank_email || fest.user_email || '—';
      const address = venueAddress || fest.org_address || '—';
      const gstin = fest.pan_number || '—';

      const invoiceId = payment.id || paymentId;
      const invoiceNumber = `FC-FEST-${String(invoiceId).padStart(6, '0')}`;
      const invoiceDate = formatDate(payment.created_at || new Date());
      const settlementPeriod = getSettlementPeriod(payment.settled_at || payment.created_at || new Date());
      const paymentStatus = (payment.settlement_status || 'PENDING').toUpperCase();

      const grossAmount = parseFloat(payment.base_fee_amount || payment.gross_amount || 0);
      const commissionRate = parseFloat(payment.commission_rate || 6.0);
      const commissionAmount = parseFloat((grossAmount * (commissionRate / 100)).toFixed(2));
      const totalInvoiceAmount = commissionAmount;

      // Real festival settlement: Route fee (0.25% + 18% GST) charged on transferred amount (gross - commission)
      const routeBase = grossAmount - commissionAmount;
      const routeFeeRate = 0.25;
      const routeGstRate = 18.0;
      const routeFeeAmount = parseFloat(
        (payment.route_fee_amount !== null && payment.route_fee_amount !== undefined && payment.route_gst_amount !== null && payment.route_gst_amount !== undefined)
          ? (Number(payment.route_fee_amount) + Number(payment.route_gst_amount)).toFixed(2)
          : (routeBase * (routeFeeRate / 100) * (1 + (routeGstRate / 100))).toFixed(2)
      );
      const netPayable = parseFloat(
        (payment.net_settled_amount !== null && payment.net_settled_amount !== undefined)
          ? Number(payment.net_settled_amount).toFixed(2)
          : (grossAmount - commissionAmount - routeFeeAmount).toFixed(2)
      );

      const pdfBuffer = await generateTaxInvoicePdf({
        invoiceNumber,
        invoiceDate,
        paymentStatus,
        settlementPeriod,
        festivalName,
        festivalId: festivalCode,
        contactPerson,
        email,
        address,
        gstin,
        grossAmount,
        commissionRate,
        commissionAmount,
        totalInvoiceAmount,
        routeFeeRate,
        routeGstRate,
        routeFeeAmount,
        netPayable,
      });

      const filename = `Tax_Invoice_${invoiceNumber}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      return res.send(pdfBuffer);
    } catch (error) {
      console.error('PayoutController::getReceipt error:', error);
      return res.status(500).json({
        success: false,
        status: false,
        message: 'Failed to generate tax invoice PDF.',
      });
    }
  }
}

module.exports = PayoutController;
