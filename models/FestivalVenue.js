const { query } = require('../config/db');

class FestivalVenue {
  /**
   * Get venues for a festival from the film_festivals.film_festival_venue JSON column
   */
  static async findByFestivalId(filmFestivalId) {
    const [rows] = await query(
      'SELECT event_id, film_festival_venue FROM film_festivals WHERE film_festival_id = ? LIMIT 1',
      [filmFestivalId]
    );
    if (!rows.length || !rows[0].film_festival_venue) return [];

    const eventId = rows[0].event_id;
    let venues = rows[0].film_festival_venue;
    // If stored as a JSON string, parse it
    if (typeof venues === 'string') {
      try { venues = JSON.parse(venues); } catch { return []; }
    }
    // Normalize to array
    if (!Array.isArray(venues)) {
      venues = Object.values(venues);
    }
    return venues.map((v, i) => ({
      venue_id: i + 1,
      event_id: eventId,
      festival_id: Number(filmFestivalId),
      venue_name: v.name || v.venue_name || String(v)
    }));
  }
}

module.exports = FestivalVenue;
