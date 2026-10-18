// Database layer: opens SQLite, creates tables, seeds the default admin.
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const config = require('./config');

fs.mkdirSync(path.dirname(config.DB_PATH), { recursive: true });
const db = new Database(config.DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    phone         TEXT,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'citizen' CHECK (role IN ('citizen','admin')),
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS requests (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ref_code    TEXT NOT NULL UNIQUE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category    TEXT NOT NULL,
    location    TEXT NOT NULL,
    description TEXT NOT NULL,
    image_path  TEXT,
    status      TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','In Progress','Resolved')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Every status change is logged so citizens can see a timeline.
  CREATE TABLE IF NOT EXISTS status_history (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    status     TEXT NOT NULL,
    note       TEXT,
    changed_by INTEGER REFERENCES users(id),
    changed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_requests_user   ON requests(user_id);
  CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
`);

// Create the default admin account on first run.
const adminExists = db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get();
if (!adminExists) {
  const a = config.DEFAULT_ADMIN;
  db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')")
    .run(a.name, a.email, bcrypt.hashSync(a.password, 10));
  console.log(`[db] Default admin created: ${a.email} / ${a.password}`);
}

module.exports = db;
