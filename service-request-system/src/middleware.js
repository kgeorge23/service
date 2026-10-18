// Authentication and authorisation middleware.
const jwt = require('jsonwebtoken');
const config = require('./config');
const db = require('./db');

// Requires a valid "Authorization: Bearer <token>" header.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Please log in to continue.' });

  try {
    const payload = jwt.verify(token, config.JWT_SECRET);
    const user = db.prepare('SELECT id, name, email, phone, role FROM users WHERE id = ?').get(payload.id);
    if (!user) return res.status(401).json({ error: 'Account no longer exists.' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
}

// Restricts a route to admins only (use after requireAuth).
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
  next();
}

module.exports = { requireAuth, requireAdmin };
