'use strict';

/**
 * PASETO v4 Local (symmetric) helpers.
 *
 * Encrypted payload embedded in QR codes:
 *   { attendee_id, event_id, festival_id }
 *
 * Key storage:
 *   PASETO_LOCAL_KEY env var — PASERK format string (k4.local.xxx).
 *   Generate a new key with:
 *     node --input-type=module -e \
 *       "import {generateLocalKey,toPaserk} from 'paseto-kit';
 *        const k=await generateLocalKey(); console.log(await toPaserk(k));"
 *
 * SECURITY NOTES:
 *   - PASETO v4 local uses XChaCha20-Poly1305 (authenticated encryption).
 *   - The key MUST be kept secret; never expose it to clients.
 *   - The `festival_id` inside the token is re-validated against the route
 *     param in checkinController, preventing token reuse across festivals.
 *   - paseto-kit uses audited @noble/* cryptographic primitives.
 */

// paseto-kit ships as CJS via dist/index.cjs — compatible with require()
const { encrypt, decrypt, fromPaserk } = require('paseto-kit');

// ---------------------------------------------------------------------------
// Key bootstrap — fail fast if misconfigured
// ---------------------------------------------------------------------------
const PASERK = process.env.PASETO_LOCAL_KEY || '';

if (!PASERK || !PASERK.startsWith('k4.local.')) {
  // TODO(security): In production, replace process.exit with a startup-time
  // exception so the process manager surfaces the error clearly.
  console.error(
    '[PASETO] FATAL: PASETO_LOCAL_KEY env var is missing or invalid. ' +
    'It must be a PASERK v4.local key string starting with "k4.local.". Aborting.'
  );
  process.exit(1);
}

/**
 * Reusable LocalKey object loaded synchronously at startup.
 * fromPaserk() is synchronous in paseto-kit.
 */
let LOCAL_KEY;
try {
  LOCAL_KEY = fromPaserk(PASERK);
} catch (err) {
  console.error('[PASETO] FATAL: Failed to import PASETO_LOCAL_KEY:', err.message);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Encrypt attendee identity into a PASETO v4 local token.
 *
 * @param {object} params
 * @param {number}  params.attendee_id  - primary key of the attendee record
 * @param {number}  params.event_id     - event the attendee is registered for
 * @param {number}  params.festival_id  - festival the attendee belongs to
 * @param {number} [params.iat]         - issued-at Unix timestamp (seconds)
 * @returns {Promise<string>}  PASETO token string (v4.local....)
 */
async function encryptQrPayload(payload) {
  return encrypt(LOCAL_KEY, payload);
}

/**
 * Decrypt and verify a PASETO v4 local token produced by encryptQrPayload.
 *
 * @param {string} token  - The raw PASETO token string scanned from QR
 * @returns {Promise<{ attendee_id: number, event_id: number, festival_id: number }>}
 * @throws {Error}  if the token is invalid or tampered with
 */
async function decryptQrPayload(token) {
  // paseto-kit returns { payload, footer } — we only need payload
  const { payload } = await decrypt(LOCAL_KEY, token);
  return payload;
}

module.exports = { encryptQrPayload, decryptQrPayload };
