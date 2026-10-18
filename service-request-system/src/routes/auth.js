// Registration, login and "who am I" endpoints.
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const { requireAuth } = require('../middleware');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const signToken = (user) =>
  jwt.sign({ id: user.id, role: user.role }, config.JWT_SECRET, { expiresIn: config.TOKEN_TTL });

router.post('/register', (req, res) => {
  const { name, email, phone, password } = req.body || {};

  if (!name || name.trim().length < 2) return res.status(400).json({ error: 'Please enter your full name.' });
  if (!email || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const cleanEmail = email.trim().toLowerCase();
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(cleanEmail)) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  const info = db
    .prepare("INSERT INTO users (name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, 'citizen')")
    .run(name.trim(), cleanEmail, (phone || '').trim() || null, bcrypt.hashSync(password, 10));

  const user = db.prepare('SELECT id, name, email, phone, role FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ token: signToken(user), user });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
  // Same message for both failures so we don't reveal which emails exist.
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }

  const user = { id: row.id, name: row.name, email: row.email, phone: row.phone, role: row.role };
  res.json({ token: signToken(user), user });
});

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

module.exports = router;
