'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');

function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.full_name },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sign in to continue.' });
  try {
    const payload = jwt.verify(token, config.jwt.secret);
    const user = await db.one(
      `SELECT id, full_name, email, phone, role, location, is_active FROM users WHERE id = $1`,
      [payload.sub]
    );
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'This account is no longer active.' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Your session has expired. Sign in again.' });
  }
}

/** Attaches req.user if a valid token is present, but never blocks the request. */
async function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next();
  try {
    const payload = jwt.verify(token, config.jwt.secret);
    req.user = await db.one(
      `SELECT id, full_name, email, phone, role, location, is_active FROM users WHERE id = $1`,
      [payload.sub]
    );
  } catch (err) { /* ignore invalid token for optional auth */ }
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Sign in to continue.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have access to this action.' });
    }
    next();
  };
}

module.exports = { signToken, requireAuth, optionalAuth, requireRole };
