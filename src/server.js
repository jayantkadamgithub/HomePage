/**
 * Walking App - Express server
 */
const path = require('path');
const express = require('express');
const db = require('./config/db');
const authRoutes = require('./routes/auth');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check
app.get('/api/health', async (_req, res) => {
  const h = await db.healthCheck();
  res.status(h.ok ? 200 : 503).json(h);
});

// API routes
app.use('/api', authRoutes);

// Fallback to index.html for client-side routing
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Central error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ ok: false, message: 'Server error: ' + err.message });
});

const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await db.init();
    const h = await db.healthCheck();
    if (process.env.USE_MOCK_DB === 'true') {
      // eslint-disable-next-line no-console
      console.log('[db] using in-memory MOCK database');
    } else if (!h.ok) {
      // eslint-disable-next-line no-console
      console.warn('[db] Oracle health check failed:', h.error);
      console.warn('[db] Set USE_MOCK_DB=true in .env to run without Oracle.');
    } else {
      // eslint-disable-next-line no-console
      console.log('[db] connected to Oracle');
    }
    app.listen(PORT, () => {
      // eslint-disable-next-line no-console
      console.log(`Walking App running at http://localhost:${PORT}`);
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  start();
}

module.exports = { app, start };