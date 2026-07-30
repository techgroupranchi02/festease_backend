const { verifyToken } = require('../utils/jwt');
const { isTokenRevoked } = require('../utils/tokenBlacklist');

/**
 * Middleware to verify RS256 JWT Token in Authorization header
 */
function authenticateJwt(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Authorization token required.'
    });
  }

  const token = authHeader.split(' ')[1];

  // Check if token has been revoked (in-memory)
  if (isTokenRevoked(token)) {
    return res.status(401).json({
      success: false,
      message: 'Token has been revoked. Please log in again.'
    });
  }

  try {
    const decoded = verifyToken(token);
    req.token = token;
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token.'
    });
  }
}

module.exports = {
  authenticateJwt
};

