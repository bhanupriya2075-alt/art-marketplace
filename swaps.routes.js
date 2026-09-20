'use strict';

const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

async function loadSwap(id) {
  return db.one(
    `SELECT s.*, l.title AS listing_title, l.seller_id, l.status AS listing_status, l.price AS listing_price,
            req.full_name AS requester_name, req.email AS requester_email,
            sel.full_name AS seller_name,
            ol.title AS offered_listing_title
       FROM swap_offers s
       JOIN listings l ON l.id = s.listing_id
       JOIN users req ON req.id = s.requester_id
       JOIN users sel ON sel.id = l.seller_id
       LEFT JOIN listings ol ON ol.id = s.offered_listing_id
      WHERE s.id = $1`,
    [id]
  );
}

// ---------------------------------------------------------------------
// Create a swap request on a listing
// ---------------------------------------------------------------------
router.post('/listings/:id/swap-requests', requireAuth, async (req, res, next) => {
  try {
    const listing = await db.one('SELECT * FROM listings WHERE id = $1', [req.params.id]);
    if (!listing) return res.status(404).json({ error: 'Listing not found.' });
    if (listing.seller_id === req.user.id) return res.status(400).json({ error: 'You cannot swap with your own listing.' });
    if (listing.status !== 'available') return res.status(400).json({ error: 'This item is no longer available.' });
    if (!['swap', 'both'].includes(listing.listing_type)) {
      return res.status(400).json({ error: 'This listing is not open to swaps.' });
    }

    const { offered_title, offered_description, offered_listing_id, message } = req.body || {};
    if (!offered_title || !offered_title.trim()) {
      return res.status(400).json({ error: 'Describe what you are offering in exchange.' });
    }

    if (offered_listing_id) {
      const owned = await db.one(
        'SELECT id FROM listings WHERE id = $1 AND seller_id = $2 AND status = $3',
        [offered_listing_id, req.user.id, 'available']
      );
      if (!owned) return res.status(400).json({ error: 'You can only offer one of your own available listings.' });
    }

    const swap = await db.withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO swap_offers (listing_id, requester_id, offered_listing_id, offered_title, offered_description, message)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [listing.id, req.user.id, offered_listing_id || null, offered_title.trim(), offered_description || null, message || null]
      );
      const created = rows[0];

      // Open a conversation so the two parties can negotiate.
      await client.query(
        `INSERT INTO conversations (listing_id, buyer_id, seller_id)
         VALUES ($1,$2,$3) ON CONFLICT (listing_id, buyer_id) DO NOTHING`,
        [listing.id, req.user.id, listing.seller_id]
      );
      const convo = await client.query(
        'SELECT id FROM conversations WHERE listing_id = $1 AND buyer_id = $2',
        [listing.id, req.user.id]
      );
      await client.query(
        `INSERT INTO messages (conversation_id, sender_id, body) VALUES ($1,$2,$3)`,
        [convo.rows[0].id, req.user.id, `Swap proposal: ${offered_title.trim()}${message ? ` — ${message.trim()}` : ''}`]
      );
      return created;
    });

    res.status(201).json({ swap_offer: await loadSwap(swap.id) });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------
// List my swap requests — sent or received
// ---------------------------------------------------------------------
router.get('/swap-requests', requireAuth, async (req, res, next) => {
  try {
    const role = req.query.role === 'received' ? 'received' : 'sent';
    const { rows } = await db.query(
      role === 'sent'
        ? `SELECT s.id, s.status, s.offered_title, s.created_at,
                  l.title AS listing_title, l.id AS listing_id, sel.full_name AS seller_name
             FROM swap_offers s JOIN listings l ON l.id = s.listing_id JOIN users sel ON sel.id = l.seller_id
            WHERE s.requester_id = $1 ORDER BY s.created_at DESC`
        : `SELECT s.id, s.status, s.offered_title, s.created_at,
                  l.title AS listing_title, l.id AS listing_id, req.full_name AS requester_name
             FROM swap_offers s JOIN listings l ON l.id = s.listing_id JOIN users req ON req.id = s.requester_id
            WHERE l.seller_id = $1 ORDER BY s.created_at DESC`,
      [req.user.id]
    );
    res.json({ swap_requests: rows, role });
  } catch (err) { next(err); }
});

router.get('/swap-requests/:id', requireAuth, async (req, res, next) => {
  try {
    const swap = await loadSwap(req.params.id);
    if (!swap) return res.status(404).json({ error: 'Swap request not found.' });
    if (swap.requester_id !== req.user.id && swap.seller_id !== req.user.id) {
      return res.status(403).json({ error: 'You do not have access to this swap request.' });
    }
    res.json({ swap_offer: swap });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------
// Seller accepts or rejects
// ---------------------------------------------------------------------
router.post('/swap-requests/:id/respond', requireAuth, async (req, res, next) => {
  try {
    const swap = await loadSwap(req.params.id);
    if (!swap) return res.status(404).json({ error: 'Swap request not found.' });
    if (swap.seller_id !== req.user.id) return res.status(403).json({ error: 'Only the listing owner can respond to this offer.' });
    if (swap.status !== 'pending') return res.status(400).json({ error: 'This offer has already been responded to.' });

    const decision = req.body && req.body.decision;
    if (!['accepted', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'Decision must be accepted or rejected.' });
    }

    await db.withTransaction(async (client) => {
      await client.query(`UPDATE swap_offers SET status = $2::swap_status WHERE id = $1`, [swap.id, decision]);

      if (decision === 'accepted') {
        await client.query(`UPDATE listings SET status = 'swapped' WHERE id = $1`, [swap.listing_id]);
        if (swap.offered_listing_id) {
          await client.query(`UPDATE listings SET status = 'swapped' WHERE id = $1`, [swap.offered_listing_id]);
        }
        await client.query(
          `INSERT INTO transactions (listing_id, buyer_id, seller_id, swap_offer_id, type, status)
           VALUES ($1,$2,$3,$4,'swap','completed')`,
          [swap.listing_id, swap.requester_id, swap.seller_id, swap.id]
        );
        // Auto-decline every other pending offer on the same listing.
        await client.query(
          `UPDATE swap_offers SET status = 'rejected'
            WHERE listing_id = $1 AND id <> $2 AND status = 'pending'`,
          [swap.listing_id, swap.id]
        );
      }
    });

    res.json({ swap_offer: await loadSwap(swap.id) });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------
// Requester cancels their own pending offer
// ---------------------------------------------------------------------
router.post('/swap-requests/:id/cancel', requireAuth, async (req, res, next) => {
  try {
    const swap = await loadSwap(req.params.id);
    if (!swap) return res.status(404).json({ error: 'Swap request not found.' });
    if (swap.requester_id !== req.user.id) return res.status(403).json({ error: 'You can only cancel your own offer.' });
    if (swap.status !== 'pending') return res.status(400).json({ error: 'Only a pending offer can be cancelled.' });

    await db.query(`UPDATE swap_offers SET status = 'cancelled' WHERE id = $1`, [swap.id]);
    res.json({ swap_offer: await loadSwap(swap.id) });
  } catch (err) { next(err); }
});

module.exports = router;
