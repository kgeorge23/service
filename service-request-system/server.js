// Entry point: wires up middleware, API routes and the static frontend.
const express = require('express');
const path = require('path');
const config = require('./src/config');
require('./src/db'); // opens DB + creates tables on startup

const app = express();
app.use(express.json());

// Static files: the frontend and uploaded images.
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(config.UPLOAD_DIR));

// API
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/requests', require('./src/routes/requests'));
app.use('/api/admin', require('./src/routes/admin'));

// Unknown API route -> JSON 404 (instead of HTML)
app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found.' }));

// Last-resort error handler
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

if (require.main === module) {
  app.listen(config.PORT, () => console.log(`✔ Service Request System running at http://localhost:${config.PORT}`));
}

module.exports = app;
