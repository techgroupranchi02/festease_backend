/**
 * Migration: add_status_to_saas_volunteers
 * Adds a status ENUM column ('active', 'disabled') to saas_volunteers with default 'active'.
 */

async function up({ query }) {
  // Check if status column already exists
  const [statusCols] = await query(`
    SELECT COLUMN_NAME 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'saas_volunteers' 
      AND COLUMN_NAME = 'status'
  `);

  if (statusCols.length === 0) {
    // Check if is_active column exists to determine if AFTER clause can be used
    const [isActiveCols] = await query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'saas_volunteers' 
        AND COLUMN_NAME = 'is_active'
    `);

    const afterClause = isActiveCols.length > 0 ? 'AFTER is_active' : '';
    await query(`
      ALTER TABLE saas_volunteers
      ADD COLUMN status ENUM('active', 'disabled') NOT NULL DEFAULT 'active'
      ${afterClause};
    `);
  }
}

async function down({ query }) {
  const [statusCols] = await query(`
    SELECT COLUMN_NAME 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'saas_volunteers' 
      AND COLUMN_NAME = 'status'
  `);

  if (statusCols.length > 0) {
    await query(`
      ALTER TABLE saas_volunteers
      DROP COLUMN status;
    `);
  }
}

module.exports = { up, down };
