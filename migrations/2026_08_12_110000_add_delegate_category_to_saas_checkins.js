/**
 * Migration: add_delegate_category_to_saas_checkins
 *
 * Adds delegate_category column to saas_checkins table.
 */

async function up({ query }) {
  const [cols] = await query(`SHOW COLUMNS FROM saas_checkins LIKE 'delegate_category'`);
  if (cols.length === 0) {
    await query(`ALTER TABLE saas_checkins ADD COLUMN delegate_category VARCHAR(255) DEFAULT NULL AFTER checkin_venue_id;`);
  }
}

async function down({ query }) {
  const [cols] = await query(`SHOW COLUMNS FROM saas_checkins LIKE 'delegate_category'`);
  if (cols.length > 0) {
    await query(`ALTER TABLE saas_checkins DROP COLUMN delegate_category;`);
  }
}

module.exports = { up, down };
