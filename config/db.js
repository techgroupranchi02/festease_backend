const mysql = require('mysql2/promise');
require('dotenv').config();

// Create connection pool with keep-alive and resiliency options
const pool = mysql.createPool({
  host: process.env.DB_HOST || '147.93.105.85',
  port: parseInt(process.env.DB_PORT, 10) || 3306,
  user: process.env.DB_USERNAME || 'root',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE || 'freecomers_database',
  waitForConnections: true,
  connectionLimit: 10,
  maxIdle: 10,                   // Keep idle connections ready
  idleTimeout: 60000,            // Close idle connections after 60s to prevent stale server sockets
  enableKeepAlive: true,        // Send TCP keep-alive packets
  keepAliveInitialDelay: 10000,  // Start keep-alive after 10s of inactivity
  connectTimeout: 10000          // 10s connect timeout
});

// Handle pool level errors so idle socket drops don't crash process
pool.on('error', (err) => {
  console.error('⚠️ Unexpected Database Pool Error:', err.code || err.message);
});

/**
 * Execute parameterized query with automatic retry on connection drops
 */
async function query(sql, params = [], retries = 2) {
  let attempt = 0;
  while (attempt <= retries) {
    try {
      const [results, fields] = await pool.query(sql, params);
      return [results, fields];
    } catch (error) {
      attempt++;
      const isConnectionError = 
        error.code === 'PROTOCOL_CONNECTION_LOST' ||
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR';

      if (isConnectionError && attempt <= retries) {
        console.warn(`⚠️ DB Connection drop detected (${error.code}). Retrying query (Attempt ${attempt}/${retries})...`);
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
      } else {
        throw error;
      }
    }
  }
}

/**
 * Periodic Heartbeat Ping (keeps pool active and prevents server idle disconnects)
 */
const heartbeat = setInterval(async () => {
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    console.error('⚠️ Database heartbeat ping failed:', err.message);
  }
}, 45000);

// Prevent heartbeat from holding node process open on exit
if (heartbeat.unref) {
  heartbeat.unref();
}

/**
 * Helper function to test the database connection
 */
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('✅ MySQL Database connected successfully to:', process.env.DB_HOST);
    connection.release();
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    return false;
  }
}

module.exports = {
  pool,
  query,
  testConnection
};
