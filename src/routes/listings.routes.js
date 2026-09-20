'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const db = require('../db');
const config = require('../config');
const { requireAuth, optionalAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

fs.mkdirSync(config.uploads.dir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.uploads.dir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 10);
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.uploads.maxBytes, files: 5 },
  fileFilter: (req, file, cb) => {
    if (!config.uploads.allowedMime.includes(file.mimetype)) {
      return cb(new Error('Attach JPG, PNG or WEBP images only.'));
    }
    cb(null, true);
  },
});

async function loadListing(id) {
  return db.one(
    `SELECT l.*, cat.name AS category, u.full_name AS seller_name, u.email AS seller_email,
            u.phone AS seller_phone, u.location AS seller_location
       FROM listings l
       JOIN categories cat ON cat.id = l.category_id
       JOIN users u ON u.id = l.seller_id
      WHERE l.id = $1`,
    [id]
  );
}

// ---------------------------------------------------------------------
// Categories (public)
// ---------------------------------------------------------------------
router.get('/categories', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT id, name, description FROM categories WHERE is_active ORDER BY name'
    );
    res.json({ categories: rows });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------
// Create a listing
// ---------------------------------------------------------------------
router.post('/', requireAuth, upload.array('images', 5), async (req, res, next) => {
  try {
    const { category_id, title, description, condition, listing_type, price, location } = req.body || {};

    if (!category_id) return res.status(400).json({ error: 'Choose a category.' });
    if (!title || title.trim().length < 3) return res.status(400).json({ error: 'Add a title (at least 3 characters).' });
    if (!description || description.trim().length < 15) {
      return res.status(400).json({ error: 'Describe the item in at least 15 characters.' });
    }
    const type = ['sale', 'swap', 'both'].includes(listing_type) ? listing_type : 'sale';
    if (type !== 'swap' && (price === undefined || price === '' || Number(price) < 0)) {
      return res.status(400).json({ error: 'Enter a price, or set the listing to swap-only.' });
    }

    const category = await db.one('SELECT id FROM categories WHERE id = $1 AND is_active', [category_id]);
    if (!category) return res.status(400).json({ error: 'That category is not available.' });

    const listing = await db.withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO listings (seller_id, category_id, title, description, condition, listing_type, price, location)
         VALUES ($1,$2,$3,$4,$5::item_condition,$6::listing_type,$7,$8)
         RETURNING *`,
        [req.user.id, category_id, title.trim(), description.trim(),
         condition || 'used', type, type === 'swap' ? null : Number(price), location || req.user.location || null]
      );
      const created = rows[0];

      const files = req.files || [];
      for (let i = 0; i < files.length; i++) {
        await client.query(
          `INSERT INTO listing_images (listing_id, file_name, stored_name, is_primary)
           VALUES ($1,$2,$3,$4)`,
          [created.id, files[i].originalname, files[i].filename, i === 0]
        );
      }
      return created;
    });

    res.status(201).json({ listing: await loadListing(listing.id) });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------
// Browse / search / filter
// ---------------------------------------------------------------------
router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const { category_id, condition, listing_type, min_price, max_price, location, q, status, mine } = req.query;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(60, Number(req.query.limit) || 20);

    const where = [];
    const params = [];
    const add = (sql, value) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)); };

    if (mine === 'true' && req.user) {
      add('l.seller_id = ?', req.user.id);
    } else {
      add('l.status = ?::listing_status', status || 'available');
    }
    if (category_id)   add('l.category_id = ?', category_id);
    if (condition)     add('l.condition = ?::item_condition', condition);
    if (listing_type)  add('l.listing_type = ?', listing_type);
    if (min_price)     add('l.price >= ?', Number(min_price));
    if (max_price)     add('l.price <= ?', Number(max_price));
    if (location) {
      params.push(`%${location}%`);
      where.push(`l.location ILIKE $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      where.push(`(l.title ILIKE $${params.length} OR l.description ILIKE $${params.length})`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sort = req.query.sort === 'price_asc' ? 'l.price ASC NULLS LAST'
      : req.query.sort === 'price_desc' ? 'l.price DESC NULLS LAST'
      : 'l.created_at DESC';

    const totalRow = await db.one(`SELECT COUNT(*)::int AS total FROM listings l ${whereSql}`, params);

    params.push(limit, (page - 1) * limit);
    const { rows } = await db.query(
      `SELECT l.id, l.title, l.condition, l.listing_type, l.price, l.status, l.location, l.created_at,
              cat.name AS category, u.full_name AS seller_name,
              (SELECT id FROM listing_images li WHERE li.listing_id = l.id
                 ORDER BY li.is_primary DESC, li.uploaded_at ASC LIMIT 1) AS primary_image_id
         FROM listings l
         JOIN categories cat ON cat.id = l.category_id
         JOIN users u ON u.id = l.seller_id
         ${whereSql}
        ORDER BY ${sort}
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ listings: rows, total: totalRow.total, page, limit });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------
// Listing detail
// ---------------------------------------------------------------------
router.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const listing = await loadListing(req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found.' });

    if (!req.user || req.user.id !== listing.seller_id) {
      await db.query('UPDATE listings SET view_count = view_count + 1 WHERE id = $1', [listing.id]);
    }

    const { rows: images } = await db.query(
      'SELECT id, file_name, is_primary FROM listing_images WHERE listing_id = $1 ORDER BY is_primary DESC, uploaded_at',
      [listing.id]
    );

    res.json({ listing, images });
  } catch (err) { next(err); }
});

router.get('/:id/images/:imageId', async (req, res, next) => {
  try {
    const img = await db.one(
      'SELECT * FROM listing_images WHERE id = $1 AND listing_id = $2',
      [req.params.imageId, req.params.id]
    );
    if (!img) return res.status(404).json({ error: 'Image not found.' });
    res.sendFile(path.join(config.uploads.dir, img.stored_name));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------
// Edit a listing (owner only)
// ---------------------------------------------------------------------
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    const listing = await loadListing(req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found.' });
    if (listing.seller_id !== req.user.id) return res.status(403).json({ error: 'You can only edit your own listings.' });

    const { title, description, condition, price, location, status } = req.body || {};
    const allowedStatus = ['available', 'pending', 'removed'];
    const updated = await db.one(
      `UPDATE listings
          SET title = COALESCE($2, title),
              description = COALESCE($3, description),
              condition = COALESCE($4::item_condition, condition),
              price = CASE WHEN $5::text IS NOT NULL THEN $5::numeric ELSE price END,
              location = COALESCE($6, location),
              status = CASE WHEN $7::text IN ('available','pending','removed') THEN $7::listing_status ELSE status END
        WHERE id = $1
        RETURNING *`,
      [listing.id, title || null, description || null, condition || null,
       price === undefined ? null : String(price), location || null,
       allowedStatus.includes(status) ? status : null]
    );
    res.json({ listing: await loadListing(updated.id) });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------
// Buyer expresses interest: opens/returns a conversation with the seller
// ---------------------------------------------------------------------
router.post('/:id/interest', requireAuth, async (req, res, next) => {
  try {
    const listing = await loadListing(req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found.' });
    if (listing.seller_id === req.user.id) return res.status(400).json({ error: 'You cannot message yourself about your own listing.' });
    if (listing.status !== 'available') return res.status(400).json({ error: 'This item is no longer available.' });

    const message = (req.body && req.body.message) || `Hi, I'm interested in "${listing.title}". Is it still available?`;

    const conversation = await db.withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO conversations (listing_id, buyer_id, seller_id)
         VALUES ($1,$2,$3)
         ON CONFLICT (listing_id, buyer_id) DO UPDATE SET listing_id = EXCLUDED.listing_id
         RETURNING *`,
        [listing.id, req.user.id, listing.seller_id]
      );
      const convo = rows[0];
      await client.query(
        `INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1,$2,$3)`,
        [convo.id, req.user.id, message.trim()]
      );
      return convo;
    });

    res.status(201).json({ conversation_id: conversation.id });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------
// Seller completes a sale (marks sold, records a transaction)
// ---------------------------------------------------------------------
router.post('/:id/complete-sale', requireAuth, async (req, res, next) => {
  try {
    const listing = await loadListing(req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found.' });
    if (listing.seller_id !== req.user.id) return res.status(403).json({ error: 'Only the seller can complete this sale.' });
    if (listing.status === 'sold' || listing.status === 'swapped') {
      return res.status(400).json({ error: 'This listing has already been completed.' });
    }
    const buyerId = req.body && req.body.buyer_id;
    if (!buyerId) return res.status(400).json({ error: 'Choose which buyer completed the purchase.' });

    await db.withTransaction(async (client) => {
      await client.query(`UPDATE listings SET status = 'sold' WHERE id = $1`, [listing.id]);
      await client.query(
        `INSERT INTO transactions (listing_id, buyer_id, seller_id, type, amount, status)
         VALUES ($1,$2,$3,'purchase',$4,'completed')`,
        [listing.id, buyerId, req.user.id, listing.price]
      );
    });

    res.json({ listing: await loadListing(listing.id) });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------
// Remove a listing (owner only, soft delete)
// ---------------------------------------------------------------------
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const listing = await loadListing(req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found.' });
    if (listing.seller_id !== req.user.id) return res.status(403).json({ error: 'You can only remove your own listings.' });

    await db.query(`UPDATE listings SET status = 'removed' WHERE id = $1`, [listing.id]);
    res.json({ message: 'Listing removed.' });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------
// Buyers/sellers who have a conversation about a listing they don't own
// ---------------------------------------------------------------------
router.get('/:id/interested-buyers', requireAuth, async (req, res, next) => {
  try {
    const listing = await loadListing(req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found.' });
    if (listing.seller_id !== req.user.id) return res.status(403).json({ error: 'Only the seller can see interested buyers.' });

    const { rows } = await db.query(
      `SELECT u.id, u.full_name, u.email, c.id AS conversation_id
         FROM conversations c JOIN users u ON u.id = c.buyer_id
        WHERE c.listing_id = $1 ORDER BY c.created_at`,
      [listing.id]
    );
    res.json({ buyers: rows });
  } catch (err) { next(err); }
});

module.exports = router;
