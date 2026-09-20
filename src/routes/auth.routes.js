'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { signToken, requireAuth } = require('../middleware/auth');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const publicUser = (u) => ({
  id: u.id, full_name: u.full_name, email: u.email, phone: u.phone,
  role: u.role, location: u.location,
});

router.post('/register', async (req, res, next) => {
  try {
    const { full_name, email, phone, password, location, bio } = req.body || {};

    if (!full_name || full_name.trim().length < 2) {
      return res.status(400).json({ error: 'Enter your full name.' });
    }
    if (!EMAIL_RE.test(email || '')) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const existing = await db.one('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing) return res.status(409).json({ error: 'An account with this email already exists.' });

    const hash = await bcrypt.hash(password, 10);
    const user = await db.one(
      `INSERT INTO users (full_name, email, phone, password_hash, location, bio)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, full_name, email, phone, role, location`,
      [full_name.trim(), email.toLowerCase(), phone || null, hash, location || null, bio || null]
    );

    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (err) { next(err); }
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Enter your email and password.' });

    const user = await db.one('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    const ok = user && user.is_active && await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Email or password is incorrect.' });

    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) { next(err); }
});

router.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

router.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const { full_name, phone, location, bio } = req.body || {};
    const updated = await db.one(
      `UPDATE users SET full_name = COALESCE($2, full_name), phone = COALESCE($3, phone),
              location = COALESCE($4, location), bio = COALESCE($5, bio)
        WHERE id = $1
        RETURNING id, full_name, email, phone, role, location`,
      [req.user.id, full_name || null, phone || null, location || null, bio || null]
    );
    res.json({ user: publicUser(updated) });
  } catch (err) { next(err); }
});

router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body || {};
    if (!new_password || new_password.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    }
    const row = await db.one('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!await bcrypt.compare(current_password || '', row.password_hash)) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }
    await db.query('UPDATE users SET password_hash = $2 WHERE id = $1',
      [req.user.id, await bcrypt.hash(new_password, 10)]);
    res.json({ message: 'Password changed.' });
  } catch (err) { next(err); }
});

module.exports = router;
