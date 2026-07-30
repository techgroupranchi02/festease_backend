/**
 * Migration: alter_saas_volunteers_roles_to_json
 */

async function up({ query }) {
  await query(`
    ALTER TABLE saas_volunteers 
    MODIFY COLUMN roles JSON DEFAULT (JSON_ARRAY('admin', 'registration', 'checkin'));
  `);
}

async function down({ query }) {
  await query(`
    ALTER TABLE saas_volunteers 
    MODIFY COLUMN roles VARCHAR(255) NOT NULL DEFAULT 'unassigned';
  `);
}

module.exports = {
  up,
  down
};
