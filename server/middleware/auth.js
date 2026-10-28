const jwt = require('jsonwebtoken');

// One place decides whether a token is valid, so the HTTP middleware and the
// Socket.IO handshake cannot drift apart. Returns the payload or null.
function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET); // { user_id, role, name }
  } catch (err) {
    return null;
  }
}

function tokenFromHeader(header) {
  if (!header || typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

function requireAuth(req, res, next) {
  const payload = verifyToken(tokenFromHeader(req.headers.authorization));
  if (!payload) {
    return res.status(401).json({ message: 'Missing, malformed, or expired Authorization header' });
  }
  req.user = payload;
  next();
}

// Optional: restrict a route to specific roles, e.g. requireRole('Admin', 'ShelterCoordinator')
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, verifyToken, tokenFromHeader };
