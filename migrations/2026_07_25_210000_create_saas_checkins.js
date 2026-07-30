/**
 * Migration: create_saas_checkins
 *
 * Table: saas_checkins
 *   checkin_id                  PK
 *   attendee_id                 BIGINT UNSIGNED NOT NULL  FK -> saas_attendees.attendee_id
 *   event_id                    BIGINT UNSIGNED NOT NULL
 *   festival_id                 BIGINT UNSIGNED NOT NULL
 *   checkin_venue_id            BIGINT UNSIGNED NULL       FK -> saas_venues.venue_id (nullable)
 *   checked_in_by_user_id       BIGINT UNSIGNED NOT NULL  FK -> users.id
 *   checked_in_by_role          ENUM('admin','volunteer') NOT NULL
 *   checked_in_by_volunteer_id  BIGINT UNSIGNED NULL       FK -> saas_volunteers.volunteer_id
 *   check_in_at                 TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
 *   status                      VARCHAR(50) NOT NULL DEFAULT 'checked_in'
 *   remarks                     TEXT NULL
 *   created_at                  TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
 *   updated_at                  TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
 */

async function up({ query }) {
  await query(`
    CREATE TABLE IF NOT EXISTS saas_checkins (
      checkin_id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      attendee_id                 BIGINT UNSIGNED NOT NULL,
      event_id                    BIGINT UNSIGNED NOT NULL,
      festival_id                 BIGINT UNSIGNED NOT NULL,
      checkin_venue_id            BIGINT UNSIGNED DEFAULT NULL,
      checked_in_by_user_id       BIGINT UNSIGNED NOT NULL,
      checked_in_by_role          ENUM('admin', 'volunteer') NOT NULL,
      checked_in_by_volunteer_id  BIGINT UNSIGNED DEFAULT NULL,
      check_in_at                 TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      status                      VARCHAR(50) NOT NULL DEFAULT 'checked_in',
      remarks                     TEXT DEFAULT NULL,
      created_at                  TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at                  TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_attendee_checkin (attendee_id),
      INDEX idx_festival_id (festival_id),
      INDEX idx_event_id (event_id),
      INDEX idx_checked_in_by_user_id (checked_in_by_user_id),
      CONSTRAINT fk_checkins_attendee
        FOREIGN KEY (attendee_id) REFERENCES saas_attendees (attendee_id)
        ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
}

async function down({ query }) {
  await query(`DROP TABLE IF EXISTS saas_checkins;`);
}

module.exports = { up, down };
