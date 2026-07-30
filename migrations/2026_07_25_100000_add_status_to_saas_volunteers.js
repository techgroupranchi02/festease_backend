/**
 * Migration: add_status_to_saas_volunteers
 * Adds a status ENUM column ('active', 'disabled') to saas_volunteers with default 'active'.
 */

async function up({ query }) {
  await query(`
    ALTER TABLE saas_volunteers
    ADD COLUMN status ENUM('active', 'disabled') NOT NULL DEFAULT 'active'
    AFTER is_active;
  `);
}

async function down({ query }) {
  await query(`
    ALTER TABLE saas_volunteers
    DROP COLUMN status;
  `);
}

module.exports = { up, down };
