// Citizen-facing endpoints: submit a request, list own requests, view one.
const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const db = require('../db');
const { requireAuth } = require('../middleware');

const router = express.Router();

// ---- Image upload (optional, images only, 3 MB max) ----
const storage = multer.diskStorage({
  destination: config.UPLOAD_DIR,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, crypto.randomBytes(12).toString('hex') + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: config.MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype);
    cb(ok ? null : new Error('Only JPG, PNG, WEBP or GIF images are allowed.'), ok);
  },
});

// Generates a human-friendly reference such as SR-2026-000042.
function makeRefCode(id) {
  return `SR-${new Date().getFullYear()}-${String(id).padStart(6, '0')}`;
}

// POST /api/requests  – submit a new request
router.post('/', requireAuth, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Image must be 3 MB or smaller.' : err.message;
      return res.status(400).json({ error: msg });
    }

    const { category, location, description } = req.body || {};
    if (!config.CATEGORIES.includes(category)) return res.status(400).json({ error: 'Please choose a valid category.' });
    if (!location || location.trim().length < 3) return res.status(400).json({ error: 'Please enter the location.' });
    if (!description || description.trim().length < 10) {
      return res.status(400).json({ error: 'Please describe the issue (at least 10 characters).' });
    }

    const insert = db.transaction(() => {
      // Temporary ref code, replaced right after we know the row id.
      const info = db
        .prepare('INSERT INTO requests (ref_code, user_id, category, location, description, image_path) VALUES (?, ?, ?, ?, ?, ?)')
        .run('TMP-' + crypto.randomBytes(4).toString('hex'), req.user.id, category, location.trim(), description.trim(), req.file ? req.file.filename : null);
      const id = info.lastInsertRowid;
      db.prepare('UPDATE requests SET ref_code = ? WHERE id = ?').run(makeRefCode(id), id);
      db.prepare("INSERT INTO status_history (request_id, status, note, changed_by) VALUES (?, 'Pending', 'Request submitted', ?)")
        .run(id, req.user.id);
      return id;
    });

    const id = insert();
    res.status(201).json({ request: db.prepare('SELECT * FROM requests WHERE id = ?').get(id) });
  });
});

// GET /api/requests  – the logged-in citizen's own requests
router.get('/', requireAuth, (req, res) => {
  const rows = db
    .prepare('SELECT * FROM requests WHERE user_id = ? ORDER BY created_at DESC, id DESC')
    .all(req.user.id);
  res.json({ requests: rows });
});

// GET /api/requests/:id  – one request + its status timeline (owner or admin)
router.get('/:id', requireAuth, (req, res) => {
  const row = db
    .prepare('SELECT r.*, u.name AS citizen_name, u.email AS citizen_email, u.phone AS citizen_phone FROM requests r JOIN users u ON u.id = r.user_id WHERE r.id = ?')
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Request not found.' });
  if (req.user.role !== 'admin' && row.user_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only view your own requests.' });
  }
  const history = db
    .prepare('SELECT h.status, h.note, h.changed_at, u.name AS changed_by FROM status_history h LEFT JOIN users u ON u.id = h.changed_by WHERE h.request_id = ? ORDER BY h.id ASC')
    .all(row.id);
  res.json({ request: row, history });
});

// GET /api/requests/meta/options – categories & statuses for dropdowns
router.get('/meta/options', (_req, res) => {
  res.json({ categories: config.CATEGORIES, statuses: config.STATUSES });
});

module.exports = router;
