const crypto = require('crypto');
const { query } = require('../config/db');

/**
 * In-memory store: Map<tokenHash, expiresAtMs>
 * Loaded from DB on startup, kept in sync on each logout.
 */
const revokedTokens = new Map();

/**
 * Hash a JWT string before storing
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Ensure revoked_tokens table exists and load active entries into memory
 */
async function initRevocationStore() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS revoked_tokens (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        token_hash VARCHAR(64) NOT NULL UNIQUE,
        expires_at TIMESTAMP NOT NULL,
        revoked_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_expires (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Clean up already-expired entries
    await query('DELETE FROM revoked_tokens WHERE expires_at < NOW()');

    // Load remaining (still-active) revoked tokens into memory
    const [rows] = await query('SELECT token_hash, expires_at FROM revoked_tokens');
    for (const row of rows) {
      const expiresAtMs = new Date(row.expires_at).getTime();
      revokedTokens.set(row.token_hash, expiresAtMs);
    }

    if (rows.length > 0) {
      console.log(`🔒 Loaded ${rows.length} revoked token(s) from DB into memory`);
    }
  } catch (err) {
    console.error('Failed to initialize revocation store:', err.message);
  }
}

// Load on startup
initRevocationStore();

/**
 * Periodic cleanup of expired in-memory entries (every 15 minutes)
 */
setInterval(() => {
  const now = Date.now();
  for (const [hash, expiresAt] of revokedTokens) {
    if (now > expiresAt) {
      revokedTokens.delete(hash);
    }
  }
}, 15 * 60 * 1000).unref();

/**
 * Revoke a token on logout — persists to DB + memory
 * @param {string} token - The raw JWT string
 * @param {number} exp   - JWT exp claim (seconds since epoch), optional
 */
async function revokeToken(token, exp) {
  if (!token) return;
  const tokenHash = hashToken(token);
  const expiresAtMs = exp
    ? exp * 1000
    : Date.now() + 24 * 60 * 60 * 1000;

  // Add to memory immediately
  revokedTokens.set(tokenHash, expiresAtMs);

  // Persist to DB so it survives server restarts
  try {
    const expiresAtDate = new Date(expiresAtMs);
    await query(
      'INSERT IGNORE INTO revoked_tokens (token_hash, expires_at) VALUES (?, ?)',
      [tokenHash, expiresAtDate]
    );
  } catch (err) {
    console.error('Error persisting revoked token to DB:', err.message);
  }
}

/**
 * Check if a token has been revoked — uses in-memory Map only (O(1), no DB hit)
 */
function isTokenRevoked(token) {
  if (!token) return false;
  const tokenHash = hashToken(token);
  const expiresAt = revokedTokens.get(tokenHash);

  if (expiresAt === undefined) return false;

  // Auto-clean if already expired
  if (Date.now() > expiresAt) {
    revokedTokens.delete(tokenHash);
    return false;
  }

  return true;
}

module.exports = {
  revokeToken,
  isTokenRevoked
};
