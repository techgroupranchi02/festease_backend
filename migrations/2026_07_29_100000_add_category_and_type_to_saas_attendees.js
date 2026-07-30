/**
 * Migration: add_category_and_type_to_saas_attendees
 *
 * Adds delegate_category and registration_type columns to saas_attendees table.
 */

async function up({ query }) {
  await query(`
    ALTER TABLE saas_attendees
    ADD COLUMN delegate_category VARCHAR(100) DEFAULT NULL AFTER phone,
    ADD COLUMN registration_type VARCHAR(50) DEFAULT NULL AFTER delegate_category;
  `);
}

async function down({ query }) {
  await query(`
    ALTER TABLE saas_attendees
    DROP COLUMN delegate_category,
    DROP COLUMN registration_type;
  `);
}

module.exports = { up, down };
