'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// ---------------------------------------------------------------------
// File a report — any signed-in user
// ---------------------------------------------------------------------
router.post('/reports', async (req, res, next) => {
  try {
    const { listing_id, reported_user_id, reason, details } = req.body || {};
    if (!reason || !reason.trim()) return res.status(400).json({ error: 'Choose a reason for the report.' });
    if (!listing_id && !reported_user_id) {
      return res.status(400).json({ error: 'Report either a listing or a user.' });
    }

    const row = await db.one(
      `INSERT INTO reports (reporter_id, listing_id, reported_user_id, reason, details)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.user.id, listing_id || null, reported_user_id || null, reason.trim(), details || null]
    );
    res.status(201).json({ report: row });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------
// Everything below is admin-only
// ---------------------------------------------------------------------
router.use(requireRole('admin'));

router.get('/users', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT u.id, u.full_name, u.email, u.role, u.location, u.is_active, u.created_at,
              COUNT(DISTINCT l.id) FILTER (WHERE l.status <> 'removed')::int AS listing_count
         FROM users u
         LEFT JOIN listings l ON l.seller_id = u.id
        GROUP BY u.id ORDER BY u.created_at DESC`
    );
    res.json({ users: rows });
  } catch (err) { next(err); }
});

router.patch('/users/:id/status', async (req, res, next) => {
  try {
    const row = await db.one(
      'UPDATE users SET is_active = $2 WHERE id = $1 RETURNING id, full_name, is_active',
      [req.params.id, Boolean(req.body.is_active)]
    );
    if (!row) return res.status(404).json({ error: 'User not found.' });
    res.json({ user: row });
  } catch (err) { next(err); }
});

router.get('/listings', async (req, res, next) => {
  try {
    const { status } = req.query;
    const { rows } = await db.query(
      `SELECT l.id, l.title, l.status, l.listing_type, l.price, l.created_at,
              u.full_name AS seller_name, cat.name AS category
         FROM listings l
         JOIN users u ON u.id = l.seller_id
         JOIN categories cat ON cat.id = l.category_id
        WHERE ($1::text IS NULL OR l.status = $1::listing_status)
        ORDER BY l.created_at DESC LIMIT 200`,
      [status || null]
    );
    res.json({ listings: rows });
  } catch (err) { next(err); }
});

router.patch('/listings/:id/status', async (req, res, next) => {
  try {
    const row = await db.one(
      `UPDATE listings SET status = $2::listing_status WHERE id = $1 RETURNING id, title, status`,
      [req.params.id, req.body.status]
    );
    if (!row) return res.status(404).json({ error: 'Listing not found.' });
    res.json({ listing: row });
  } catch (err) { next(err); }
});

router.get('/reports', async (req, res, next) => {
  try {
    const { status } = req.query;
    const { rows } = await db.query(
      `SELECT r.id, r.reason, r.details, r.status, r.admin_notes, r.created_at, r.resolved_at,
              reporter.full_name AS reporter_name,
              l.title AS listing_title, l.id AS listing_id,
              target.full_name AS reported_user_name
         FROM reports r
         JOIN users reporter ON reporter.id = r.reporter_id
         LEFT JOIN listings l ON l.id = r.listing_id
         LEFT JOIN users target ON target.id = r.reported_user_id
        WHERE ($1::text IS NULL OR r.status = $1::report_status)
        ORDER BY r.created_at DESC`,
      [status || null]
    );
    res.json({ reports: rows });
  } catch (err) { next(err); }
});

router.patch('/reports/:id', async (req, res, next) => {
  try {
    const { status, admin_notes } = req.body || {};
    const row = await db.one(
      `UPDATE reports
          SET status = COALESCE($2::report_status, status),
              admin_notes = COALESCE($3, admin_notes),
              resolved_at = CASE WHEN $2 IN ('resolved','dismissed') THEN NOW() ELSE resolved_at END
        WHERE id = $1 RETURNING *`,
      [req.params.id, status || null, admin_notes || null]
    );
    if (!row) return res.status(404).json({ error: 'Report not found.' });
    res.json({ report: row });
  } catch (err) { next(err); }
});

router.get('/kpis', async (req, res, next) => {
  try {
    const listings = await db.one(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'available')::int AS available,
              COUNT(*) FILTER (WHERE status IN ('sold','swapped'))::int AS completed
         FROM listings WHERE status <> 'removed'`
    );
    const users = await db.one(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE last_login_at > NOW() - INTERVAL '30 days')::int AS active_30d
         FROM users WHERE role = 'user'`
    );
    const tx = await db.one(
      `SELECT COUNT(*) FILTER (WHERE type = 'purchase')::int AS purchases,
              COUNT(*) FILTER (WHERE type = 'swap')::int AS swaps
         FROM transactions WHERE status = 'completed'`
    );
    const reports = await db.one(`SELECT COUNT(*) FILTER (WHERE status = 'open')::int AS open FROM reports`);

    const conversion = listings.total > 0 ? Math.round((listings.completed / listings.total) * 1000) / 10 : 0;

    res.json({
      kpis: {
        total_listings: listings.total,
        available_listings: listings.available,
        completed_listings: listings.completed,
        listing_conversion_pct: conversion,
        total_users: users.total,
        active_users_30d: users.active_30d,
        purchases: tx.purchases,
        swaps: tx.swaps,
        open_reports: reports.open,
      },
    });
  } catch (err) { next(err); }
});

router.get('/categories/breakdown', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT cat.name AS label, COUNT(l.id)::int AS total,
              COUNT(*) FILTER (WHERE l.status IN ('sold','swapped'))::int AS completed
         FROM categories cat
         LEFT JOIN listings l ON l.category_id = cat.id AND l.status <> 'removed'
        GROUP BY cat.name ORDER BY total DESC`
    );
    res.json({ data: rows });
  } catch (err) { next(err); }
});

module.exports = router;
