const { query } = require('../config/db');

/**
 * SubmissionsController
 *
 * Provides festival submission lists and filter options for FestEase.
 * Fetches from the Freecomers core API (or queries the DB fallback).
 */
class SubmissionsController {

  /**
   * GET /api/festivals/:festival_id/submissions
   */
  static async getSubmissions(req, res) {
    try {
      const festivalId = parseInt(req.params.festival_id || req.festivalId || req.query.festival_id, 10);
      if (!festivalId) {
        return res.status(400).json({ success: false, message: 'Festival ID is required.' });
      }

      const page = parseInt(req.query.page, 10) || 1;
      const perPage = parseInt(req.query.per_page, 10) || 10;
      const category = req.query.category || '';
      const country = req.query.country || '';
      const search = req.query.search || '';

      const backendUrl = (process.env.FREECOMERS_BACKEND_URL || 'https://api.autovertest.com/').replace(/\/+$/, '');

      const params = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
      });
      if (category) params.append('category', category);
      if (country) params.append('country', country);
      if (search) params.append('search', search);

      const apiUrl = `${backendUrl}/api/v1/film-festivals/${festivalId}/submissions?${params.toString()}`;

      try {
        const response = await fetch(apiUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          },
        });

        if (response.ok) {
          const data = await response.json();
          return res.json(data);
        }
      } catch (fetchErr) {
        console.warn('SubmissionsController: Freecomers API fetch failed, trying local DB fallback:', fetchErr.message);
      }

      // Local DB Fallback if remote API is unreachable
      let whereClause = 'ffs.festival_id = ? AND ffs.submission_status = "submitted"';
      const sqlParams = [festivalId];

      if (category) {
        whereClause += ' AND cat.name LIKE ?';
        sqlParams.push(`%${category}%`);
      }
      if (country) {
        whereClause += ' AND (c.country LIKE ? OR c.country_iso LIKE ?)';
        sqlParams.push(`%${country}%`, `%${country}%`);
      }
      if (search) {
        whereClause += ' AND (p.title LIKE ? OR cat.name LIKE ? OR c.country LIKE ?)';
        const st = `%${search}%`;
        sqlParams.push(st, st, st);
      }

      const [countRows] = await query(
        `SELECT COUNT(*) as total
         FROM film_festivals_submissions ffs
         LEFT JOIN projects p ON ffs.film_id = p.project_id
         LEFT JOIN film_festivals_category_milestone_prices price ON ffs.film_festival_category_milestone_price_id = price.film_festival_category_milestone_price_id
         LEFT JOIN film_festivals_categories cat ON price.film_festival_category_id = cat.film_festival_category_id
         LEFT JOIN countries c ON p.country_id = c.country_id
         WHERE ${whereClause}`,
        sqlParams
      );
      const total = countRows?.[0]?.total || 0;
      const offset = (page - 1) * perPage;

      const [rows] = await query(
        `SELECT 
           ffs.film_festivals_submission_id as film_festival_submission_id,
           ffs.film_id,
           p.title as film_title,
           p.thumbnail_image_name as film_logo,
           cat.name as category,
           p.runtime_minutes as runtime,
           c.country_id,
           c.country,
           c.country_iso,
           ffs.created_at,
           ffs.updated_at
         FROM film_festivals_submissions ffs
         LEFT JOIN projects p ON ffs.film_id = p.project_id
         LEFT JOIN film_festivals_category_milestone_prices price ON ffs.film_festival_category_milestone_price_id = price.film_festival_category_milestone_price_id
         LEFT JOIN film_festivals_categories cat ON price.film_festival_category_id = cat.film_festival_category_id
         LEFT JOIN countries c ON p.country_id = c.country_id
         WHERE ${whereClause}
         ORDER BY ffs.created_at DESC
         LIMIT ? OFFSET ?`,
        [...sqlParams, perPage, offset]
      );

      const submissions = rows.map((r) => ({
        film_festival_submission_id: r.film_festival_submission_id,
        film_id: r.film_id,
        film_title: r.film_title || 'Untitled',
        film_logo: r.film_logo || '',
        directors: [],
        category: r.category || 'General',
        country: {
          country_id: r.country_id || 0,
          country: r.country || 'Unknown',
          country_iso: r.country_iso || '',
        },
        runtime: r.runtime || 0,
        created_at: r.created_at,
        updated_at: r.updated_at,
      }));

      return res.json({
        success: true,
        message: 'Film festival submissions fetched successfully',
        submissions,
        current_page: page,
        last_page: Math.ceil(total / perPage) || 1,
        per_page: perPage,
        total,
      });
    } catch (error) {
      console.error('SubmissionsController::getSubmissions error:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve submissions.',
      });
    }
  }

  /**
   * GET /api/festivals/:festival_id/submissions/filter-list
   */
  static async getFilterList(req, res) {
    try {
      const festivalId = parseInt(req.params.festival_id || req.festivalId || req.query.festival_id, 10);
      if (!festivalId) {
        return res.status(400).json({ success: false, message: 'Festival ID is required.' });
      }

      const backendUrl = (process.env.FREECOMERS_BACKEND_URL || 'https://api.autovertest.com/').replace(/\/+$/, '');
      const apiUrl = `${backendUrl}/api/v1/film-festivals/${festivalId}/submissions/filter-list`;

      try {
        const response = await fetch(apiUrl, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
        });

        if (response.ok) {
          const data = await response.json();
          return res.json(data);
        }
      } catch (fetchErr) {
        console.warn('SubmissionsController: Freecomers filter-list API fetch failed, trying local DB fallback:', fetchErr.message);
      }

      // Local DB Fallback for filter list
      const [catRows] = await query(
        `SELECT DISTINCT cat.film_festival_category_id as id, cat.name
         FROM film_festivals_submissions ffs
         JOIN film_festivals_category_milestone_prices price ON ffs.film_festival_category_milestone_price_id = price.film_festival_category_milestone_price_id
         JOIN film_festivals_categories cat ON price.film_festival_category_id = cat.film_festival_category_id
         WHERE ffs.festival_id = ? AND ffs.submission_status = "submitted"`,
        [festivalId]
      );

      const [countryRows] = await query(
        `SELECT DISTINCT c.country_id as id, c.country as name, c.country_iso
         FROM film_festivals_submissions ffs
         JOIN projects p ON ffs.film_id = p.project_id
         JOIN countries c ON p.country_id = c.country_id
         WHERE ffs.festival_id = ? AND ffs.submission_status = "submitted"`,
        [festivalId]
      );

      return res.json({
        success: true,
        categories: catRows,
        countries: countryRows,
      });
    } catch (error) {
      console.error('SubmissionsController::getFilterList error:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve filter list.',
      });
    }
  }
}

module.exports = SubmissionsController;
