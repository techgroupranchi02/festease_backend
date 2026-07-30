const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const keysDir = path.join(__dirname, '../keys');

/**
 * Obtain RSA Private and Public Keypair from Environment or local keys directory
 */
function getJwtKeys() {
  let privateKey = process.env.JWT_PRIVATE_KEY;
  let publicKey = process.env.JWT_PUBLIC_KEY;

  if (privateKey && publicKey) {
    if (!privateKey.includes('-----BEGIN')) {
      privateKey = Buffer.from(privateKey, 'base64').toString('utf-8');
    }
    if (!publicKey.includes('-----BEGIN')) {
      publicKey = Buffer.from(publicKey, 'base64').toString('utf-8');
    }
    return { privateKey, publicKey };
  }

  // Check local keys directory (jwt_private.pem & jwt_public.pem)
  const localPrivate = path.join(keysDir, 'jwt_private.pem');
  const localPublic = path.join(keysDir, 'jwt_public.pem');

  if (fs.existsSync(localPrivate) && fs.existsSync(localPublic)) {
    privateKey = fs.readFileSync(localPrivate, 'utf8');
    publicKey = fs.readFileSync(localPublic, 'utf8');
    return { privateKey, publicKey };
  }

  // Fallback: Generate 2048-bit RSA Key Pair if local keys do not exist
  console.log('🔑 Generating 2048-bit RSA key pair for JWT (RS256)...');
  const { privateKey: genPrivate, publicKey: genPublic } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  if (!fs.existsSync(keysDir)) {
    fs.mkdirSync(keysDir, { recursive: true });
  }

  fs.writeFileSync(localPrivate, genPrivate, { mode: 0o600 });
  fs.writeFileSync(localPublic, genPublic, { mode: 0o644 });

  return { privateKey: genPrivate, publicKey: genPublic };
}

const { privateKey, publicKey } = getJwtKeys();

/**
 * Asynchronously / RSA Sign JWT (RS256)
 */
function generateToken(payload, expiresIn = '24h') {
  return jwt.sign(payload, privateKey, {
    algorithm: 'RS256',
    expiresIn
  });
}

/**
 * Asynchronously / RSA Verify JWT (RS256)
 */
function verifyToken(token) {
  return jwt.verify(token, publicKey, {
    algorithms: ['RS256']
  });
}

module.exports = {
  generateToken,
  verifyToken,
  publicKey,
  privateKey
};
