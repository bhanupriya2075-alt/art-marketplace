'use strict';

const path = require('path');
require('dotenv').config();

const root = path.resolve(__dirname, '..');

const config = {
  root,
  port: Number(process.env.PORT || 4100),
  env: process.env.NODE_ENV || 'development',

  db: {
    connectionString: process.env.DATABASE_URL || undefined,
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'marketplace_app',
    password: process.env.PGPASSWORD || '',
    database: process.env.PGDATABASE || 'marketplace_db',
    ssl: String(process.env.PGSSL).toLowerCase() === 'true'
      ? { rejectUnauthorized: false }
      : false,
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'insecure-dev-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },

  uploads: {
    dir: path.resolve(root, process.env.UPLOAD_DIR || 'uploads'),
    maxBytes: Number(process.env.MAX_UPLOAD_MB || 5) * 1024 * 1024,
    allowedMime: ['image/jpeg', 'image/png', 'image/webp'],
  },

  seedPassword: process.env.SEED_PASSWORD || 'Passw0rd!',
};

if (config.env === 'production' && config.jwt.secret.startsWith('insecure')) {
  throw new Error('JWT_SECRET must be set to a strong value in production.');
}

module.exports = config;
