const FestivalPayment = require('../models/FestivalPayment');
const { query } = require('../config/db');

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
        'Gross Amount', 'Commission', 'Route Fee', 'Route GST',
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
   * Download payment receipt / transaction invoice PDF.
   */
  static async getReceipt(req, res) {
    try {
      const festivalId = parseInt(req.params.festival_id || req.festivalId || req.query.festival_id, 10);
      const paymentId = parseInt(req.params.payment_id, 10);
      if (!festivalId || !paymentId) {
        return res.status(400).json({ success: false, status: false, message: 'Festival ID and Payment ID are required.' });
      }

      // Look up payment to get transaction_record_id
      const [rows] = await query(
        `SELECT id, festival_id, transaction_record_id, submission_id 
         FROM festival_payments 
         WHERE festival_id = ? AND (id = ? OR transaction_record_id = ?)
         LIMIT 1`,
        [festivalId, paymentId, paymentId]
      );

      const payment = rows?.[0];
      const targetTxId = payment?.transaction_record_id || paymentId;

      const freecomersBackend = (process.env.FREECOMERS_BACKEND_URL || 'https://api.autovertest.com').replace(/\/+$/, '');
      const invoiceUrl = `${freecomersBackend}/api/v1/festivals/transactions/${targetTxId}/invoice?action=download`;

      const invoiceRes = await fetch(invoiceUrl, {
        headers: {
          'Accept': 'application/pdf',
        }
      });

      if (!invoiceRes.ok) {
        const errorText = await invoiceRes.text();
        console.error('Failed to fetch invoice from Freecomers backend:', invoiceRes.status, errorText);
        return res.status(invoiceRes.status).json({
          success: false,
          status: false,
          message: 'Failed to generate receipt PDF from payment processor.',
        });
      }

      const pdfBuffer = Buffer.from(await invoiceRes.arrayBuffer());
      const txFormatted = String(targetTxId).padStart(6, '0');
      const filename = `Receipt_FC-${txFormatted}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      return res.send(pdfBuffer);
    } catch (error) {
      console.error('PayoutController::getReceipt error:', error.message);
      return res.status(500).json({
        success: false,
        status: false,
        message: 'Failed to retrieve receipt PDF.',
      });
    }
  }
}

module.exports = PayoutController;
