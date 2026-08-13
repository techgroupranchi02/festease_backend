/**
 * Migration: drop_saas_checkins_unique_key
 *
 * Drops UNIQUE key uq_attendee_venue on saas_checkins and replaces it with a non-unique index
 * allowing attendees to check in multiple times over time (after 1 minute has elapsed).
 */

async function up({ query }) {
  // 1. Add non-unique index idx_attendee_venue first so FK constraint stays satisfied
  const [idxRows] = await query(`SHOW INDEX FROM saas_checkins WHERE Key_name = 'idx_attendee_venue'`);
  if (idxRows.length === 0) {
    await query(`ALTER TABLE saas_checkins ADD INDEX idx_attendee_venue (attendee_id, checkin_venue_id);`);
  }

  // 2. Drop UNIQUE KEY uq_attendee_venue
  const [venueIndexes] = await query(`SHOW INDEX FROM saas_checkins WHERE Key_name = 'uq_attendee_venue'`);
  if (venueIndexes.length > 0) {
    await query(`ALTER TABLE saas_checkins DROP INDEX uq_attendee_venue;`);
  }
}

async function down({ query }) {
  const [idxRows] = await query(`SHOW INDEX FROM saas_checkins WHERE Key_name = 'idx_attendee_venue'`);
  if (idxRows.length > 0) {
    await query(`ALTER TABLE saas_checkins DROP INDEX idx_attendee_venue;`);
  }

  const [venueIndexes] = await query(`SHOW INDEX FROM saas_checkins WHERE Key_name = 'uq_attendee_venue'`);
  if (venueIndexes.length === 0) {
    await query(`ALTER TABLE saas_checkins ADD UNIQUE KEY uq_attendee_venue (attendee_id, checkin_venue_id);`);
  }
}

module.exports = { up, down };
