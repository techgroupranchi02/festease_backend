const { query } = require('../config/db');

class FestivalVenue {
  /**
   * Get venues for a festival.
   * Checks saas_venues table first. If no records found in saas_venues,
   * falls back to film_festivals.film_festival_venue JSON column for backward compatibility.
   */
  static async findByFestivalId(filmFestivalId) {
    const [saasRows] = await query(
      'SELECT venue_id, festival_id, event_id, venue_name FROM saas_venues WHERE festival_id = ? ORDER BY venue_id ASC',
      [filmFestivalId]
    );

    if (saasRows.length > 0) {
      return saasRows.map(v => ({
        venue_id: Number(v.venue_id),
        event_id: v.event_id ? Number(v.event_id) : null,
        festival_id: Number(v.festival_id),
        venue_name: v.venue_name
      }));
    }

    // Legacy fallback: film_festivals.film_festival_venue column
    const [rows] = await query(
      'SELECT event_id, film_festival_venue FROM film_festivals WHERE film_festival_id = ? LIMIT 1',
      [filmFestivalId]
    );
    if (!rows.length || !rows[0].film_festival_venue) return [];

    const eventId = rows[0].event_id;
    let venues = rows[0].film_festival_venue;
    if (typeof venues === 'string') {
      try { venues = JSON.parse(venues); } catch { return []; }
    }
    if (!Array.isArray(venues)) {
      venues = Object.values(venues);
    }
    return venues.map((v, i) => ({
      venue_id: i + 1,
      event_id: eventId ? Number(eventId) : null,
      festival_id: Number(filmFestivalId),
      venue_name: v.name || v.venue_name || String(v)
    }));
  }

  static async findById(filmFestivalId, venueId) {
    const venues = await this.findByFestivalId(filmFestivalId);
    const numericVenueId = Number(venueId);
    return venues.find(v => v.venue_id === numericVenueId) || null;
  }

  /**
   * Add or Update a venue in saas_venues table only
   * @param {number|string} filmFestivalId 
   * @param {object|string|array} venueData 
   * @param {number|string|null} targetVenueId 
   */
  static async addOrUpdateVenue(filmFestivalId, venueData, targetVenueId = null) {
    const [festRows] = await query(
      'SELECT event_id FROM film_festivals WHERE film_festival_id = ? LIMIT 1',
      [filmFestivalId]
    );

    if (!festRows.length) {
      return { success: false, code: 404, message: 'Film festival not found.' };
    }

    const eventId = festRows[0].event_id || null;
    const numericVenueId = targetVenueId ? parseInt(targetVenueId, 10) : null;

    if (numericVenueId) {
      // Update existing venue in saas_venues
      let venueName = '';
      if (typeof venueData === 'object' && venueData !== null && !Array.isArray(venueData)) {
        venueName = venueData.venue_name || venueData.name || String(venueData);
      } else {
        venueName = String(venueData);
      }

      const [updateResult] = await query(
        'UPDATE saas_venues SET venue_name = ?, updated_at = NOW() WHERE venue_id = ? AND festival_id = ?',
        [venueName, numericVenueId, filmFestivalId]
      );

      if (updateResult.affectedRows === 0) {
        return { success: false, code: 404, message: `Venue with ID ${numericVenueId} not found.` };
      }

      const updatedVenue = await this.findById(filmFestivalId, numericVenueId);
      return { success: true, data: updatedVenue };
    } else {
      // Add new venue(s) into saas_venues table
      const itemsToAdd = Array.isArray(venueData) ? venueData : [venueData];
      const insertedVenues = [];

      for (const item of itemsToAdd) {
        let venueName = '';
        if (typeof item === 'object' && item !== null) {
          venueName = item.venue_name || item.name || String(item);
        } else {
          venueName = String(item);
        }

        const [insertResult] = await query(
          'INSERT INTO saas_venues (festival_id, event_id, venue_name, created_at, updated_at) VALUES (?, ?, ?, NOW(), NOW())',
          [filmFestivalId, eventId, venueName]
        );

        insertedVenues.push({
          venue_id: insertResult.insertId,
          festival_id: Number(filmFestivalId),
          event_id: eventId ? Number(eventId) : null,
          venue_name: venueName
        });
      }

      const resultData = Array.isArray(venueData) ? insertedVenues : insertedVenues[0];
      return { success: true, data: resultData };
    }
  }

  /**
   * Delete a venue from saas_venues table
   * @param {number|string} filmFestivalId 
   * @param {number|string} targetVenueId 
   */
  static async deleteVenue(filmFestivalId, targetVenueId) {
    const numericVenueId = parseInt(targetVenueId, 10);
    const [deleteResult] = await query(
      'DELETE FROM saas_venues WHERE venue_id = ? AND festival_id = ?',
      [numericVenueId, filmFestivalId]
    );

    if (deleteResult.affectedRows === 0) {
      const venue = await this.findById(filmFestivalId, numericVenueId);
      if (!venue) {
        return { success: false, code: 404, message: `Venue with ID ${numericVenueId} not found.` };
      }
    }

    const updatedVenues = await this.findByFestivalId(filmFestivalId);
    return { success: true, data: updatedVenues };
  }
}

module.exports = FestivalVenue;
