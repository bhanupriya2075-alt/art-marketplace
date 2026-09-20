'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

async function canAccess(conversationId, userId) {
  return db.one(
    'SELECT * FROM conversations WHERE id = $1 AND (buyer_id = $2 OR seller_id = $2)',
    [conversationId, userId]
  );
}

// ---------------------------------------------------------------------
// List my conversations, newest activity first, with unread counts
// ---------------------------------------------------------------------
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT c.id, c.listing_id, l.title AS listing_title, l.status AS listing_status,
              CASE WHEN c.buyer_id = $1 THEN c.seller_id ELSE c.buyer_id END AS other_user_id,
              CASE WHEN c.buyer_id = $1 THEN sel.full_name ELSE buy.full_name END AS other_user_name,
              (SELECT body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
              (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_at,
              (SELECT COUNT(*)::int FROM messages m WHERE m.conversation_id = c.id AND m.sender_id <> $1 AND m.is_read = FALSE) AS unread
         FROM conversations c
         JOIN listings l ON l.id = c.listing_id
         JOIN users buy ON buy.id = c.buyer_id
         JOIN users sel ON sel.id = c.seller_id
        WHERE c.buyer_id = $1 OR c.seller_id = $1
        ORDER BY last_at DESC NULLS LAST`,
      [req.user.id]
    );
    res.json({ conversations: rows });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------
// Start (or fetch) a conversation about a listing directly
// ---------------------------------------------------------------------
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { listing_id, message } = req.body || {};
    const listing = await db.one('SELECT * FROM listings WHERE id = $1', [listing_id]);
    if (!listing) return res.status(404).json({ error: 'Listing not found.' });
    if (listing.seller_id === req.user.id) return res.status(400).json({ error: 'You cannot start a conversation about your own listing.' });

    const convo = await db.withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO conversations (listing_id, buyer_id, seller_id)
         VALUES ($1,$2,$3) ON CONFLICT (listing_id, buyer_id) DO UPDATE SET listing_id = EXCLUDED.listing_id
         RETURNING *`,
        [listing.id, req.user.id, listing.seller_id]
      );
      if (message && message.trim()) {
        await client.query(
          'INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1,$2,$3)',
          [rows[0].id, req.user.id, message.trim()]
        );
      }
      return rows[0];
    });

    res.status(201).json({ conversation_id: convo.id });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------
// Messages in a conversation
// ---------------------------------------------------------------------
router.get('/:id/messages', requireAuth, async (req, res, next) => {
  try {
    const convo = await canAccess(req.params.id, req.user.id);
    if (!convo) return res.status(404).json({ error: 'Conversation not found.' });

    const { rows } = await db.query(
      `SELECT m.id, m.sender_id, m.body, m.is_read, m.created_at, u.full_name AS sender_name
         FROM messages m JOIN users u ON u.id = m.sender_id
        WHERE m.conversation_id = $1 ORDER BY m.created_at`,
      [convo.id]
    );

    await db.query(
      'UPDATE messages SET is_read = TRUE WHERE conversation_id = $1 AND sender_id <> $2',
      [convo.id, req.user.id]
    );

    const listing = await db.one(
      `SELECT l.id, l.title, l.status, l.price, l.listing_type,
              c.buyer_id, c.seller_id
         FROM listings l JOIN conversations c ON c.listing_id = l.id
        WHERE c.id = $1`,
      [convo.id]
    );

    res.json({ messages: rows, listing });
  } catch (err) { next(err); }
});

router.post('/:id/messages', requireAuth, async (req, res, next) => {
  try {
    const convo = await canAccess(req.params.id, req.user.id);
    if (!convo) return res.status(404).json({ error: 'Conversation not found.' });

    const body = req.body && req.body.body;
    if (!body || !body.trim()) return res.status(400).json({ error: 'Write a message first.' });

    const { rows } = await db.query(
      `INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1,$2,$3)
       RETURNING id, sender_id, body, created_at`,
      [convo.id, req.user.id, body.trim()]
    );
    res.status(201).json({ message: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
