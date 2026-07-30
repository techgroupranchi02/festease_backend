const path = require('path');
const fs = require('fs');
const { query, pool } = require('../config/db');

async function runMigrations() {
  console.log('🚀 Starting Database Migrations...');

  try {
    // 1. Ensure migrations table exists
    await query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        migration VARCHAR(255) NOT NULL,
        batch INT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 2. Fetch executed migrations
    const [executedRows] = await query('SELECT migration FROM migrations');
    const executedMigrations = new Set(executedRows.map(r => r.migration));

    // 3. Get next batch number
    const [batchRow] = await query('SELECT MAX(batch) as max_batch FROM migrations');
    const nextBatch = (batchRow[0].max_batch || 0) + 1;

    // 4. Read migration files from directory
    const migrationsDir = __dirname;
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.js') && f !== 'runner.js')
      .sort();

    let ranCount = 0;

    for (const file of files) {
      const migrationName = path.basename(file, '.js');
      if (executedMigrations.has(migrationName)) {
        console.log(`  [Skipped] ${migrationName} (already executed)`);
        continue;
      }

      console.log(`  [Executing] ${migrationName}...`);
      const migrationPath = path.join(migrationsDir, file);
      const migrationModule = require(migrationPath);

      if (typeof migrationModule.up === 'function') {
        await migrationModule.up({ query, pool });
      } else {
        throw new Error(`Migration file ${file} does not export an 'up' function.`);
      }

      await query('INSERT INTO migrations (migration, batch) VALUES (?, ?)', [migrationName, nextBatch]);
      console.log(`  ✅ [Completed] ${migrationName}`);
      ranCount++;
    }

    if (ranCount === 0) {
      console.log('✨ Database is already up to date. No pending migrations.');
    } else {
      console.log(`🎉 Successfully executed ${ranCount} migration(s) (Batch #${nextBatch}).`);
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exitCode = 1;
  } finally {
    // Close connection pool if run directly from CLI
    if (require.main === module) {
      await pool.end();
    }
  }
}

if (require.main === module) {
  runMigrations();
}

module.exports = runMigrations;
