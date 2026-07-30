/**
 * Migration: create_saas_attendees (fresh schema)
 *
 * Drops the old saas_attendees table (old schema had attendance_id PK) and
 * recreates it with the updated schema.
 *
 * Table: saas_attendees
 *   attendee_id            PK
 *   event_id               BIGINT UNSIGNED NOT NULL
 *   festival_id            BIGINT UNSIGNED NOT NULL
 *   name                   VARCHAR(255) NOT NULL
 *   email                  VARCHAR(255) NOT NULL
 *   phone                  VARCHAR(30) NOT NULL
 *   registered_by_user_id  BIGINT UNSIGNED NOT NULL  FK -> users.id
 *   registered_by_role     ENUM('admin','volunteer') NOT NULL
 *   volunteer_id           BIGINT UNSIGNED NULL       FK -> saas_volunteers.volunteer_id
 *   status                 VARCHAR(50) NOT NULL DEFAULT 'registered'
 *   qr_token               VARCHAR(36) NOT NULL UNIQUE  (UUID for QR code scanning)
 *   registered_at          TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
 *   created_at             TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
 *   updated_at             TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
 */

async function up({ query }) {
  // Drop the old table first so the old schema does not silently persist
  await query(`DROP TABLE IF EXISTS saas_attendees;`);

  await query(`
    CREATE TABLE saas_attendees (
      attendee_id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      event_id               BIGINT UNSIGNED NOT NULL,
      festival_id            BIGINT UNSIGNED NOT NULL,
      name                   VARCHAR(255) NOT NULL,
      email                  VARCHAR(255) NOT NULL,
      phone                  VARCHAR(30) NOT NULL,
      registered_by_user_id  BIGINT UNSIGNED NOT NULL,
      registered_by_role     ENUM('admin', 'volunteer') NOT NULL,
      volunteer_id           BIGINT UNSIGNED DEFAULT NULL,
      status                 VARCHAR(50) NOT NULL DEFAULT 'registered',
      qr_token               VARCHAR(36) NOT NULL,
      registered_at          TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      created_at             TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at             TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_qr_token (qr_token),
      INDEX idx_festival_id (festival_id),
      INDEX idx_event_id (event_id),
      INDEX idx_registered_by_user_id (registered_by_user_id),
      INDEX idx_volunteer_id (volunteer_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
}

async function down({ query }) {
  await query(`DROP TABLE IF EXISTS saas_attendees;`);
}

module.exports = { up, down };
