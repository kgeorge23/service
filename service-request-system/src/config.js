// Central configuration. Override any value with an environment variable.
const path = require('path');

module.exports = {
  PORT: process.env.PORT || 3000,
  // CHANGE THIS in production – used to sign login tokens.
  JWT_SECRET: process.env.JWT_SECRET || 'dev-only-secret-change-me',
  TOKEN_TTL: '8h',
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.db'),
  UPLOAD_DIR: path.join(__dirname, '..', 'uploads'),
  MAX_UPLOAD_BYTES: 3 * 1024 * 1024, // 3 MB
  CATEGORIES: ['Streetlight', 'Water Issue', 'Garbage Collection', 'Road Damage', 'Drainage/Sewage', 'Other'],
  STATUSES: ['Pending', 'In Progress', 'Resolved'],
  DEFAULT_ADMIN: {
    name: 'System Admin',
    email: 'admin@example.com',
    password: 'Admin@123',
  },
};
