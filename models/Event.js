const { query } = require('../config/db');

class Event {
  /**
   * Check if a user is associated with an event of type 'film_festival'
   */
  static async hasFilmFestivalEvent(userId) {
    const [rows] = await query(`
      SELECT 1 FROM events e 
      WHERE e.user_id = ? AND e.event_type = 'film_festival' AND (e.is_deleted = 0 OR e.is_deleted IS NULL) AND (e.is_saas = 1 OR e.is_saas IS TRUE)
      UNION
      SELECT 1 FROM film_festivals ff 
      JOIN events e ON ff.event_id = e.event_id 
      WHERE ff.user_id = ? AND e.event_type = 'film_festival' AND (e.is_deleted = 0 OR e.is_deleted IS NULL) AND (e.is_saas = 1 OR e.is_saas IS TRUE)
      UNION
      SELECT 1 FROM film_festivals_organisers ffo 
      JOIN film_festivals ff ON ffo.film_festival_id = ff.film_festival_id 
      JOIN events e ON ff.event_id = e.event_id 
      WHERE ffo.user_id = ? AND e.event_type = 'film_festival' AND (e.is_deleted = 0 OR e.is_deleted IS NULL) AND (e.is_saas = 1 OR e.is_saas IS TRUE)
      UNION
      SELECT 1 FROM saas_volunteers sv
      JOIN film_festivals ff ON (sv.festival_id = ff.film_festival_id OR sv.event_id = ff.event_id)
      JOIN events e ON ff.event_id = e.event_id
      WHERE sv.user_id = ? AND (sv.expiry_date IS NULL OR sv.expiry_date > NOW()) AND sv.is_active = 1
        AND e.event_type = 'film_festival' AND (e.is_deleted = 0 OR e.is_deleted IS NULL) AND (e.is_saas = 1 OR e.is_saas IS TRUE)
      LIMIT 1
    `, [userId, userId, userId, userId]);

    return rows.length > 0;
  }

  /**
   * Check if a user is associated with any film_festival event regardless of is_saas.
   * Used to detect if access is blocked specifically because is_saas = false.
   */
  static async hasAnyFestivalAssociation(userId) {
    const [rows] = await query(`
      SELECT 1 FROM events e 
      WHERE e.user_id = ? AND e.event_type = 'film_festival' AND (e.is_deleted = 0 OR e.is_deleted IS NULL)
      UNION
      SELECT 1 FROM film_festivals ff 
      JOIN events e ON ff.event_id = e.event_id 
      WHERE ff.user_id = ? AND e.event_type = 'film_festival' AND (e.is_deleted = 0 OR e.is_deleted IS NULL)
      UNION
      SELECT 1 FROM film_festivals_organisers ffo 
      JOIN film_festivals ff ON ffo.film_festival_id = ff.film_festival_id 
      JOIN events e ON ff.event_id = e.event_id 
      WHERE ffo.user_id = ? AND e.event_type = 'film_festival' AND (e.is_deleted = 0 OR e.is_deleted IS NULL)
      UNION
      SELECT 1 FROM saas_volunteers sv
      JOIN film_festivals ff ON (sv.festival_id = ff.film_festival_id OR sv.event_id = ff.event_id)
      JOIN events e ON ff.event_id = e.event_id
      WHERE sv.user_id = ? AND (sv.expiry_date IS NULL OR sv.expiry_date > NOW()) AND sv.is_active = 1
        AND e.event_type = 'film_festival' AND (e.is_deleted = 0 OR e.is_deleted IS NULL)
      LIMIT 1
    `, [userId, userId, userId, userId]);

    return rows.length > 0;
  }

  /**
   * Get the film_festival_id associated with a user (first match — organiser or owner or volunteer)
   */
  static async getFilmFestivalIdForUser(userId) {
    // First check organisers table
    const [orgRows] = await query(`
      SELECT ffo.film_festival_id
      FROM film_festivals_organisers ffo
      JOIN film_festivals ff ON ffo.film_festival_id = ff.film_festival_id
      JOIN events e ON ff.event_id = e.event_id
      WHERE ffo.user_id = ? AND e.event_type = 'film_festival' AND (e.is_deleted = 0 OR e.is_deleted IS NULL) AND (e.is_saas = 1 OR e.is_saas IS TRUE)
      LIMIT 1
    `, [userId]);
    if (orgRows.length > 0) return orgRows[0].film_festival_id;

    // Check saas_volunteers table
    const [volRows] = await query(`
      SELECT ff.film_festival_id
      FROM saas_volunteers sv
      JOIN film_festivals ff ON (sv.festival_id = ff.film_festival_id OR sv.event_id = ff.event_id)
      JOIN events e ON ff.event_id = e.event_id
      WHERE sv.user_id = ? AND (sv.expiry_date IS NULL OR sv.expiry_date > NOW()) AND sv.is_active = 1
        AND e.event_type = 'film_festival' AND (e.is_deleted = 0 OR e.is_deleted IS NULL) AND (e.is_saas = 1 OR e.is_saas IS TRUE)
      LIMIT 1
    `, [userId]);
    if (volRows.length > 0) return volRows[0].film_festival_id;

    // Then check direct film_festival owner
    const [ownerRows] = await query(`
      SELECT ff.film_festival_id
      FROM film_festivals ff
      JOIN events e ON ff.event_id = e.event_id
      WHERE ff.user_id = ? AND e.event_type = 'film_festival' AND (e.is_deleted = 0 OR e.is_deleted IS NULL) AND (e.is_saas = 1 OR e.is_saas IS TRUE)
      LIMIT 1
    `, [userId]);
    if (ownerRows.length > 0) return ownerRows[0].film_festival_id;

    // Then check event owner
    const [eventRows] = await query(`
      SELECT ff.film_festival_id
      FROM events e
      JOIN film_festivals ff ON ff.event_id = e.event_id
      WHERE e.user_id = ? AND e.event_type = 'film_festival' AND (e.is_deleted = 0 OR e.is_deleted IS NULL) AND (e.is_saas = 1 OR e.is_saas IS TRUE)
      LIMIT 1
    `, [userId]);
    if (eventRows.length > 0) return eventRows[0].film_festival_id;

    return null;
  }

  /**
   * Get all film festivals associated with a user (owner, organizer, or volunteer)
   */
  static async getAssociatedFestivals(userId) {
    const [rows] = await query(`
      SELECT DISTINCT
          e.event_id,
          ff.film_festival_id AS festival_id,
          e.name AS event_name,
          ff.film_festival_banner_image_name AS festival_banner,
          ff.film_festival_logo_image_name AS festival_logo
      FROM events e
      JOIN film_festivals ff ON ff.event_id = e.event_id
      WHERE e.user_id = ?
        AND e.event_type = 'film_festival'
        AND (e.is_deleted = 0 OR e.is_deleted IS NULL)
        AND (e.is_saas = 1 OR e.is_saas IS TRUE)

      UNION

      SELECT DISTINCT
          ff.event_id,
          ff.film_festival_id AS festival_id,
          e.name AS event_name,
          ff.film_festival_banner_image_name AS festival_banner,
          ff.film_festival_logo_image_name AS festival_logo
      FROM film_festivals ff
      JOIN events e ON ff.event_id = e.event_id
      WHERE ff.user_id = ?
        AND e.event_type = 'film_festival'
        AND (e.is_deleted = 0 OR e.is_deleted IS NULL)
        AND (e.is_saas = 1 OR e.is_saas IS TRUE)

      UNION

      SELECT DISTINCT
          ff.event_id,
          ff.film_festival_id AS festival_id,
          e.name AS event_name,
          ff.film_festival_banner_image_name AS festival_banner,
          ff.film_festival_logo_image_name AS festival_logo
      FROM film_festivals_organisers ffo
      JOIN film_festivals ff ON ffo.film_festival_id = ff.film_festival_id
      JOIN events e ON ff.event_id = e.event_id
      WHERE ffo.user_id = ?
        AND e.event_type = 'film_festival'
        AND (e.is_deleted = 0 OR e.is_deleted IS NULL)
        AND (e.is_saas = 1 OR e.is_saas IS TRUE)

      UNION

      SELECT DISTINCT
          ff.event_id,
          ff.film_festival_id AS festival_id,
          e.name AS event_name,
          ff.film_festival_banner_image_name AS festival_banner,
          ff.film_festival_logo_image_name AS festival_logo
      FROM saas_volunteers sv
      JOIN film_festivals ff ON (sv.festival_id = ff.film_festival_id OR sv.event_id = ff.event_id)
      JOIN events e ON ff.event_id = e.event_id
      WHERE sv.user_id = ?
        AND (sv.expiry_date IS NULL OR sv.expiry_date > NOW())
        AND sv.is_active = 1
        AND e.event_type = 'film_festival'
        AND (e.is_deleted = 0 OR e.is_deleted IS NULL)
        AND (e.is_saas = 1 OR e.is_saas IS TRUE)
    `, [userId, userId, userId, userId]);
    return rows;
  }

  /**
   * Get all is_saas enabled festivals owned by the user (event owner / festival owner / organizer)
   * Returns each festival — caller assigns hardcoded admin roles.
   */
  static async getOwnerFestivals(userId) {
    const [rows] = await query(`
      SELECT DISTINCT
          e.event_id,
          ff.film_festival_id AS festival_id,
          e.name AS event_name,
          ff.film_festival_banner_image_name AS festival_banner,
          ff.film_festival_logo_image_name AS festival_logo
      FROM events e
      JOIN film_festivals ff ON ff.event_id = e.event_id
      WHERE e.user_id = ?
        AND e.event_type = 'film_festival'
        AND (e.is_deleted = 0 OR e.is_deleted IS NULL)
        AND (e.is_saas = 1 OR e.is_saas IS TRUE)

      UNION

      SELECT DISTINCT
          ff.event_id,
          ff.film_festival_id AS festival_id,
          e.name AS event_name,
          ff.film_festival_banner_image_name AS festival_banner,
          ff.film_festival_logo_image_name AS festival_logo
      FROM film_festivals ff
      JOIN events e ON ff.event_id = e.event_id
      WHERE ff.user_id = ?
        AND e.event_type = 'film_festival'
        AND (e.is_deleted = 0 OR e.is_deleted IS NULL)
        AND (e.is_saas = 1 OR e.is_saas IS TRUE)

      UNION

      SELECT DISTINCT
          ff.event_id,
          ff.film_festival_id AS festival_id,
          e.name AS event_name,
          ff.film_festival_banner_image_name AS festival_banner,
          ff.film_festival_logo_image_name AS festival_logo
      FROM film_festivals_organisers ffo
      JOIN film_festivals ff ON ffo.film_festival_id = ff.film_festival_id
      JOIN events e ON ff.event_id = e.event_id
      WHERE ffo.user_id = ?
        AND e.event_type = 'film_festival'
        AND (e.is_deleted = 0 OR e.is_deleted IS NULL)
        AND (e.is_saas = 1 OR e.is_saas IS TRUE)
    `, [userId, userId, userId]);
    return rows;
  }

  /**
   * Get all is_saas enabled festivals a volunteer is assigned to,
   * along with their per-festival roles from saas_volunteers.
   */
  static async getVolunteerFestivals(userId) {
    const [rows] = await query(`
      SELECT DISTINCT
          e.event_id,
          ff.film_festival_id AS festival_id,
          e.name AS event_name,
          ff.film_festival_banner_image_name AS festival_banner,
          ff.film_festival_logo_image_name AS festival_logo,
          sv.roles AS roles
      FROM saas_volunteers sv
      JOIN film_festivals ff ON (sv.festival_id = ff.film_festival_id OR sv.event_id = ff.event_id)
      JOIN events e ON ff.event_id = e.event_id
      WHERE sv.user_id = ?
        AND (sv.expiry_date IS NULL OR sv.expiry_date > NOW())
        AND sv.is_active = 1
        AND sv.status = 'active'
        AND e.event_type = 'film_festival'
        AND (e.is_deleted = 0 OR e.is_deleted IS NULL)
        AND (e.is_saas = 1 OR e.is_saas IS TRUE)
    `, [userId]);
    return rows;
  }
}

module.exports = Event;
