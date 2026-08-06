const { query } = require('../config/db');

/**
 * authorizeRole(requiredRoles)
 *
 * Middleware factory that enforces role-based access per festival.
 * festival_id must be present in req.params.festival_id.
 *
 * Rules:
 *  - Checks that is_saas is enabled for the festival in the events table.
 *  - Strict owners (event creators / festival creators) → allowed on ALL routes including ['admin'].
 *  - Organisers (film_festivals_organisers) → allowed on volunteer-role routes only, NOT ['admin'].
 *  - Volunteers → must have at least one of requiredRoles in their
 *    active, non-expired, non-disabled saas_volunteers record for
 *    this specific festival.
 *  - Use ['admin'] for owner-only routes (organisers and volunteers are blocked).
 *  - Use ['registration'] or ['checkin'] for role-gated routes.
 *
 * @param {string[]} requiredRoles
 */
function authorizeRole(requiredRoles) {
  return async (req, res, next) => {
    try {
      const userId = req.user?.user_id || req.user?.userId || req.user?.sub;
      const festivalId = Number(req.params.festival_id);

      if (!userId) {
        return res.status(401).json({ success: false, message: 'Unauthorized.' });
      }

      if (!festivalId) {
        return res.status(400).json({ success: false, message: 'Festival ID is required.' });
      }

      // ── 1. Check is_saas status & strict ownership ──
      const [[saasRows], [eventOwnerRows], [festivalOwnerRows]] = await Promise.all([
        query(
          `SELECT e.is_saas
           FROM film_festivals ff
           JOIN events e ON ff.event_id = e.event_id
           WHERE ff.film_festival_id = ?
             AND (e.is_deleted = 0 OR e.is_deleted IS NULL)
           LIMIT 1`,
          [festivalId]
        ),
        query(
          `SELECT 1 FROM events e
           JOIN film_festivals ff ON ff.event_id = e.event_id
           WHERE e.user_id = ? AND ff.film_festival_id = ?
             AND (e.is_deleted = 0 OR e.is_deleted IS NULL)
           LIMIT 1`,
          [userId, festivalId]
        ),
        query(
          `SELECT 1 FROM film_festivals ff
           WHERE ff.user_id = ? AND ff.film_festival_id = ?
           LIMIT 1`,
          [userId, festivalId]
        ),
      ]);

      if (saasRows.length === 0) {
        return res.status(404).json({ success: false, message: 'Festival not found.' });
      }

      const isSaas = Number(saasRows[0].is_saas) === 1 || saasRows[0].is_saas === true;
      if (!isSaas) {
        return res.status(403).json({
          success: false,
          message: 'Access restricted: SaaS is disabled for this festival.'
        });
      }

      const isStrictOwner = eventOwnerRows.length > 0 || festivalOwnerRows.length > 0;

      // Strict owners bypass all role checks
      if (isStrictOwner) return next();

      // ── 2. Admin-only routes: block everyone who is not a strict owner ──
      if (requiredRoles.includes('admin')) {
        return res.status(403).json({
          success: false,
          message: 'Access restricted: This action requires festival owner permissions.'
        });
      }

      // ── 3. For non-admin routes, check if the user is a listed organiser ──
      //    Organisers get full volunteer-level access (registration + checkin)
      //    but are already blocked from ['admin'] routes above.
      const [[organizerRows]] = await Promise.all([
        query(
          `SELECT 1 FROM film_festivals_organisers ffo
           WHERE ffo.user_id = ? AND ffo.film_festival_id = ?
           LIMIT 1`,
          [userId, festivalId]
        ),
      ]);

      const isOrganiser = organizerRows.length > 0;
      if (isOrganiser) return next();

      // ── 4. Volunteer role check for this specific festival ──
      const [volRows] = await query(
        `SELECT sv.roles
         FROM saas_volunteers sv
         WHERE sv.user_id = ?
           AND (
             sv.festival_id = ?
             OR sv.event_id = (
               SELECT ff.event_id FROM film_festivals ff
               WHERE ff.film_festival_id = ? LIMIT 1
             )
           )
           AND sv.is_active = 1
           AND sv.status = 'active'
           AND (sv.expiry_date IS NULL OR sv.expiry_date > NOW())`,
        [userId, festivalId, festivalId]
      );

      if (volRows.length === 0) {
        return res.status(403).json({
          success: false,
          message: 'Access restricted: You are not assigned as an active volunteer for this festival.'
        });
      }

      // Parse all roles from matching volunteer rows
      const userRoles = new Set();
      for (const row of volRows) {
        if (row.roles) {
          let parsed = [];
          if (typeof row.roles === 'string') {
            try { parsed = JSON.parse(row.roles); } catch (e) { parsed = [row.roles]; }
          } else if (Array.isArray(row.roles)) {
            parsed = row.roles;
          }
          if (Array.isArray(parsed)) parsed.forEach(r => userRoles.add(r));
          else userRoles.add(parsed);
        }
      }

      // Allow if the volunteer has at least one required role
      const hasRole = requiredRoles.some(r => userRoles.has(r));
      if (!hasRole) {
        return res.status(403).json({
          success: false,
          message: `Access restricted: Required role(s): ${requiredRoles.join(', ')}.`
        });
      }

      next();
    } catch (err) {
      console.error('authorizeRole error:', err.message);
      return res.status(500).json({ success: false, message: 'Internal server error during authorization.' });
    }
  };
}

module.exports = authorizeRole;
