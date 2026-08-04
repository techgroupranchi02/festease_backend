/**
 * Migration: add_event_id_and_festival_id_to_saas_qr
 *
 * Adds event_id and festival_id columns to saas_qr table with indexes.
 */

async function up({ query }) {
  await query(`
    ALTER TABLE saas_qr
    ADD COLUMN event_id BIGINT UNSIGNED DEFAULT NULL AFTER qr_data,
    ADD COLUMN festival_id BIGINT UNSIGNED DEFAULT NULL AFTER event_id,
    ADD INDEX idx_event_id (event_id),
    ADD INDEX idx_festival_id (festival_id);
  `);
}

async function down({ query }) {
  await query(`
    ALTER TABLE saas_qr
    DROP INDEX idx_festival_id,
    DROP INDEX idx_event_id,
    DROP COLUMN festival_id,
    DROP COLUMN event_id;
  `);
}

module.exports = { up, down };
