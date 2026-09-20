'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const multer = require('multer');

const config = require('./config');
const db = require('./db');

const app = express();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
    },
  },
}));
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
if (config.env !== 'test') app.use(morgan('dev'));

app.use(express.static(path.join(config.root, 'public')));

app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/listings', require('./routes/listings.routes'));
app.use('/api', require('./routes/swaps.routes')); // adds /listings/:id/swap-requests and /swap-requests
app.use('/api/conversations', require('./routes/chat.routes'));
app.use('/api/admin', require('./routes/admin.routes'));

app.get('/api/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', env: config.env, time: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'database unavailable', detail: err.message });
  }
});

app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(config.root, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE'
      ? `Each image must be under ${config.uploads.maxBytes / 1024 / 1024} MB.`
      : 'Upload failed. Attach up to 5 images.';
    return res.status(400).json({ error: msg });
  }
  if (err.code === '23505') return res.status(409).json({ error: 'That record already exists.' });
  if (err.code === '23503') return res.status(400).json({ error: 'A referenced record does not exist.' });
  if (err.code === '22P02') return res.status(400).json({ error: 'One of the values sent is not valid.' });

  console.error('[error]', err);
  const status = err.status || 500;
  res.status(status).json({ error: status === 500 ? 'Something went wrong on our side. Try again.' : err.message });
});

async function start() {
  try {
    await db.query('SELECT 1');
    console.log(`[db] connected to ${config.db.database}`);
    } catch (err) {
    console.error('[db] connection failed:', err && err.message ? err.message : err);
    console.error('[db] full error:', err);
    console.error('     Check your .env settings and that PostgreSQL is running.');
    process.exit(1);
  }

  app.listen(config.port, () => {
    console.log(`[server] Art Supply Marketplace running at http://localhost:${config.port}`);
  });
}

if (require.main === module) start();

module.exports = app;
