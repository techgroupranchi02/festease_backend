/**
 * Migration: create_saas_qr
 *
 * Table: saas_qr
 *   qr_id        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY (starts at 10001)
 *   qr_data      VARCHAR(255) NOT NULL UNIQUE
 *   attendee_id  BIGINT UNSIGNED NULL (FK -> saas_attendees.attendee_id)
 *   created_at   TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
 *   updated_at   TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
 *
 * Inserts 1000 entries:
 *   qr_id: 10001 to 11000
 *   qr_data: BISFF2026-10001 to BISFF2026-11000
 *   attendee_id: NULL
 */

async function up({ query }) {
  await query(`
    CREATE TABLE IF NOT EXISTS saas_qr (
      qr_id       BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      qr_data     VARCHAR(255) NOT NULL UNIQUE,
      attendee_id BIGINT UNSIGNED DEFAULT NULL,
      created_at  TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at  TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_attendee_id (attendee_id),
      CONSTRAINT fk_saas_qr_attendee
        FOREIGN KEY (attendee_id) REFERENCES saas_attendees (attendee_id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
    ) ENGINE=InnoDB AUTO_INCREMENT=10001 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  const values = [];
  for (let i = 10001; i <= 11000; i++) {
    values.push(`(${i}, 'BISFF2026-${i}', NULL)`);
  }

  await query(`
    INSERT INTO saas_qr (qr_id, qr_data, attendee_id)
    VALUES
      ${values.join(',\n      ')};
  `);
}

async function down({ query }) {
  await query(`DROP TABLE IF EXISTS saas_qr;`);
}

module.exports = { up, down };
