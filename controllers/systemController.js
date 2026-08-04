const { query } = require('../config/db');

class SystemController {
  /**
   * GET /api/health
   */
  static async getHealth(req, res) {
    try {
      const [rows] = await query('SELECT 1 AS status');
      res.json({
        success: true,
        status: 'healthy',
        dbConnection: rows[0].status === 1 ? 'connected' : 'unknown',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Health check DB error:', error.message);
      res.status(500).json({
        success: false,
        status: 'unhealthy',
        error: 'Database connection failed'
      });
    }
  }

  /**
   * GET /api/tables
   */
  static async getTables(req, res) {
    try {
      const [rows] = await query('SHOW TABLES');
      const tables = rows.map(r => Object.values(r)[0]);
      res.json({
        success: true,
        tables
      });
    } catch (error) {
      console.error('Error fetching tables:', error.message);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch database tables'
      });
    }
  }

  /**
   * GET /api/v1/system/config
   */
  static async getConfig(req, res) {
    const backendUrl = (process.env.FESTEASE_BACKEND_URL || 'https://apifestease.autovertest.com').replace(/\/$/, '');
    res.json({
      success: true,
      backendUrl,
      apiBaseUrl: `${backendUrl}/api/v1`
    });
  }
}

module.exports = SystemController;
