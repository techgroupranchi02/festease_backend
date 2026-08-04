/**
 * Migration: make_email_and_phone_nullable_in_saas_attendees
 *
 * Alters email and phone columns in saas_attendees table to be NULLABLE.
 */

async function up({ query }) {
  await query(`
    ALTER TABLE saas_attendees
    MODIFY COLUMN email VARCHAR(255) DEFAULT NULL,
    MODIFY COLUMN phone VARCHAR(30) DEFAULT NULL;
  `);
}

async function down({ query }) {
  await query(`
    ALTER TABLE saas_attendees
    MODIFY COLUMN email VARCHAR(255) NOT NULL,
    MODIFY COLUMN phone VARCHAR(30) NOT NULL;
  `);
}

module.exports = { up, down };
