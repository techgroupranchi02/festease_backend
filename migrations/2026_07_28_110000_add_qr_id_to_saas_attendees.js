/**
 * Migration: add_qr_id_to_saas_attendees
 *
 * Adds qr_id column to saas_attendees table with index and foreign key reference to saas_qr(qr_id).
 */

async function up({ query }) {
  await query(`
    ALTER TABLE saas_attendees
    ADD COLUMN qr_id BIGINT UNSIGNED DEFAULT NULL AFTER volunteer_id,
    ADD INDEX idx_qr_id (qr_id),
    ADD CONSTRAINT fk_saas_attendees_qr
      FOREIGN KEY (qr_id) REFERENCES saas_qr (qr_id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  `);
}

async function down({ query }) {
  await query(`
    ALTER TABLE saas_attendees
    DROP FOREIGN KEY fk_saas_attendees_qr,
    DROP INDEX idx_qr_id,
    DROP COLUMN qr_id;
  `);
}

module.exports = { up, down };
