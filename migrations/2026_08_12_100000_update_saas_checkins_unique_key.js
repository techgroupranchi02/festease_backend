/**
 * Migration: update_saas_checkins_unique_key
 *
 * Changes saas_checkins UNIQUE constraint from (attendee_id) to (attendee_id, checkin_venue_id)
 * allowing one check-in per venue instead of one check-in overall.
 */

async function up({ query }) {
  // 1. Add uq_attendee_venue index first so FK constraint has an index on attendee_id
  const [venueIndexes] = await query(`SHOW INDEX FROM saas_checkins WHERE Key_name = 'uq_attendee_venue'`);
  if (venueIndexes.length === 0) {
    await query(`ALTER TABLE saas_checkins ADD UNIQUE KEY uq_attendee_venue (attendee_id, checkin_venue_id);`);
  }

  // 2. Drop old single-column uq_attendee_checkin index
  const [indexes] = await query(`SHOW INDEX FROM saas_checkins WHERE Key_name = 'uq_attendee_checkin'`);
  if (indexes.length > 0) {
    await query(`ALTER TABLE saas_checkins DROP INDEX uq_attendee_checkin;`);
  }
}

async function down({ query }) {
  const [venueIndexes] = await query(`SHOW INDEX FROM saas_checkins WHERE Key_name = 'uq_attendee_venue'`);
  if (venueIndexes.length > 0) {
    await query(`ALTER TABLE saas_checkins DROP INDEX uq_attendee_venue;`);
  }

  const [indexes] = await query(`SHOW INDEX FROM saas_checkins WHERE Key_name = 'uq_attendee_checkin'`);
  if (indexes.length === 0) {
    await query(`ALTER TABLE saas_checkins ADD UNIQUE KEY uq_attendee_checkin (attendee_id);`);
  }
}

module.exports = { up, down };
