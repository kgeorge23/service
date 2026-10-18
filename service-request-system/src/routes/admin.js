// Admin-only endpoints: list/filter all requests, update status, analytics.
const express = require('express');
const config = require('../config');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware');

const router = express.Router();
router.use(requireAuth, requireAdmin);

// GET /api/admin/requests?status=&category=&q=
router.get('/requests', (req, res) => {
  const { status, category, q } = req.query;
  const where = [];
  const params = [];

  if (status && config.STATUSES.includes(status)) { where.push('r.status = ?'); params.push(status); }
  if (category && config.CATEGORIES.includes(category)) { where.push('r.category = ?'); params.push(category); }
  if (q && q.trim()) {
    where.push('(r.ref_code LIKE ? OR r.location LIKE ? OR r.description LIKE ? OR u.name LIKE ?)');
    const like = `%${q.trim()}%`;
    params.push(like, like, like, like);
  }

  const sql = `
    SELECT r.*, u.name AS citizen_name, u.email AS citizen_email
    FROM requests r JOIN users u ON u.id = r.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY CASE r.status WHEN 'Pending' THEN 0 WHEN 'In Progress' THEN 1 ELSE 2 END, r.created_at DESC`;
  res.json({ requests: db.prepare(sql).all(...params) });
});

// PATCH /api/admin/requests/:id/status  { status, note }
router.patch('/requests/:id/status', (req, res) => {
  const { status, note } = req.body || {};
  if (!config.STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status.' });

  const row = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Request not found.' });
  if (row.status === status) return res.status(400).json({ error: `Request is already "${status}".` });

  db.transaction(() => {
    db.prepare("UPDATE requests SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, row.id);
    db.prepare('INSERT INTO status_history (request_id, status, note, changed_by) VALUES (?, ?, ?, ?)')
      .run(row.id, status, (note || '').trim() || null, req.user.id);
  })();

  res.json({ request: db.prepare('SELECT * FROM requests WHERE id = ?').get(row.id) });
});

// GET /api/admin/analytics
router.get('/analytics', (_req, res) => {
  const count = (sql, ...p) => db.prepare(sql).get(...p).n;

  const total = count('SELECT COUNT(*) n FROM requests');
  const pending = count("SELECT COUNT(*) n FROM requests WHERE status = 'Pending'");
  const inProgress = count("SELECT COUNT(*) n FROM requests WHERE status = 'In Progress'");
  const resolved = count("SELECT COUNT(*) n FROM requests WHERE status = 'Resolved'");
  const open = pending + inProgress;

  const byCategory = db
    .prepare(`SELECT category,
                     SUM(status != 'Resolved') AS open,
                     SUM(status = 'Resolved')  AS resolved
              FROM requests GROUP BY category ORDER BY COUNT(*) DESC`)
    .all();

  // Average hours from submission to resolution (resolved cases only).
  const avg = db
    .prepare("SELECT AVG((julianday(updated_at) - julianday(created_at)) * 24) AS h FROM requests WHERE status = 'Resolved'")
    .get().h;

  res.json({
    total, pending, inProgress, resolved, open,
    resolutionRate: total ? Math.round((resolved / total) * 100) : 0,
    avgResolutionHours: avg === null ? null : Math.round(avg * 10) / 10,
    citizens: count("SELECT COUNT(*) n FROM users WHERE role = 'citizen'"),
    byCategory,
  });
});

module.exports = router;
