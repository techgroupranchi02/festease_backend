/**
 * Migration: create_saas_unregistered_attendees
 *
 * Table: saas_unregistered_attendees
 *   saas_unregistered_attendee_id  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY
 *   festival_id                    BIGINT UNSIGNED NOT NULL
 *   event_id                       BIGINT UNSIGNED NOT NULL
 *   name                           VARCHAR(255) DEFAULT NULL
 *   email                          VARCHAR(255) DEFAULT NULL
 *   phone_number                   VARCHAR(30) DEFAULT NULL
 *   delegate_category              VARCHAR(100) DEFAULT NULL
 *   created_at                     TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
 *   updated_at                     TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
 */

async function up({ query }) {
  await query(`
    CREATE TABLE IF NOT EXISTS saas_unregistered_attendees (
      saas_unregistered_attendee_id  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      festival_id                    BIGINT UNSIGNED NOT NULL,
      event_id                       BIGINT UNSIGNED NOT NULL,
      name                           VARCHAR(255) DEFAULT NULL,
      email                          VARCHAR(255) DEFAULT NULL,
      phone_number                   VARCHAR(30) DEFAULT NULL,
      delegate_category              VARCHAR(100) DEFAULT NULL,
      created_at                     TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at                     TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_festival_id (festival_id),
      INDEX idx_event_id (event_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
}

async function down({ query }) {
  await query(`DROP TABLE IF EXISTS saas_unregistered_attendees;`);
}

module.exports = { up, down };
