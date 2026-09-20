#!/usr/bin/env node
'use strict';

/**
 * Creates demo accounts and a spread of realistic listings, swap requests,
 * conversations and completed transactions.
 *   npm run seed
 * All demo accounts share the password in SEED_PASSWORD (default: Passw0rd!).
 */

const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');
const config = require('../src/config');

const daysAgo = (d) => new Date(Date.now() - d * 86400 * 1000);

const USERS = [
  { full_name: 'Admin User',        email: 'admin@artexchange.example',  role: 'admin', location: 'Bengaluru' },
  { full_name: 'Ananya Rao',        email: 'ananya@example.com',         role: 'user',  location: 'Indiranagar, Bengaluru', phone: '9845011111' },
  { full_name: 'Kabir Singh',       email: 'kabir@example.com',          role: 'user',  location: 'Koramangala, Bengaluru', phone: '9845022222' },
  { full_name: 'Meera Pillai',      email: 'meera@example.com',          role: 'user',  location: 'Jayanagar, Bengaluru',   phone: '9845033333' },
  { full_name: 'Rohan Das',         email: 'rohan@example.com',          role: 'user',  location: 'Whitefield, Bengaluru',  phone: '9845044444' },
  { full_name: 'Fatima Sheikh',     email: 'fatima@example.com',         role: 'user',  location: 'HSR Layout, Bengaluru',  phone: '9845055555' },
];

/** title, description, category, condition, listing_type, price, location, ageDays */
const LISTINGS = [
  ['Winsor & Newton acrylic set (24 colours)', 'Barely used student-grade acrylic set, about 80% full on most tubes. Switching to oils so I no longer need these. Great starter set for someone learning colour mixing.', 'Paints', 'like_new', 'sale', 899, 'Indiranagar, Bengaluru', 2],
  ['Full set of round & flat brushes (12 pcs)', 'Mixed synthetic and natural bristle brushes, sizes 0 to 12. Used for one semester of college coursework, cleaned and stored well. A couple of the smaller rounds have slight wear on the tip.', 'Brushes', 'used', 'sale', 350, 'Koramangala, Bengaluru', 5],
  ['3 stretched canvases, 16x20 inch, unused', 'Bought in bulk for a project that got cancelled. Still shrink-wrapped, cotton canvas on wooden stretcher bars. Selling all three together.', 'Canvases', 'new', 'sale', 600, 'Jayanagar, Bengaluru', 1],
  ['A3 sketchbook, 80 pages, half used', 'Good quality 150gsm paper, works well with pencil and light watercolour wash. About 35 pages left blank at the back half.', 'Sketchbooks', 'used', 'both', 150, 'Whitefield, Bengaluru', 8],
  ['Prismacolor pencil set (48 colours) in tin', 'Complete set, all pencils present, tin has a small dent but closes fine. These blend beautifully — selling because I switched to Faber-Castell.', 'Drawing Tools', 'like_new', 'sale', 1400, 'HSR Layout, Bengaluru', 3],
  ['Tabletop easel, foldable, solid wood', 'Sturdy foldable tabletop easel, holds up to A2 size comfortably. One small scratch on the base, doesn\'t affect function.', 'Easels', 'used', 'sale', 700, 'Indiranagar, Bengaluru', 12],
  ['Air-dry clay, 2kg, unopened + sculpting tools', 'Bought for a class I ended up not taking. Clay is still sealed. Comes with a 5-piece basic sculpting tool set, lightly used.', 'Craft Supplies', 'new', 'both', 450, 'Koramangala, Bengaluru', 6],
  ['Set of 6 wooden frames, A4 size', 'Simple wooden photo/art frames, natural finish, glass intact on all six. Never used — bought as a set for an exhibition that got postponed indefinitely.', 'Frames & Display', 'new', 'sale', 1100, 'Jayanagar, Bengaluru', 20],
  ['Watercolour paper pad, cold press, 20 sheets', 'Half a pad left of good quality 300gsm cold-press paper. Only using hot-press now, would rather swap than let this go unused.', 'Sketchbooks', 'used', 'swap', null, 'Whitefield, Bengaluru', 4],
  ['Oil paint set + palette knife (partially used)', 'Titanium white, ochre, and a few earth tones are more than half full; other colours are lower. Palette knife included, barely used.', 'Paints', 'used', 'sale', 500, 'HSR Layout, Bengaluru', 15],
  ['Bamboo charcoal set + blending stumps', 'Full charcoal stick set plus 6 blending stumps and a kneaded eraser. Used for two portrait studies only.', 'Drawing Tools', 'like_new', 'swap', null, 'Indiranagar, Bengaluru', 9],
  ['Studio easel, adjustable height, some wear', 'Heavy-duty adjustable studio easel. Has some paint splatters on the frame (cosmetic only) but mechanically solid. Great for someone starting a home studio on a budget.', 'Easels', 'fair', 'sale', 1800, 'Koramangala, Bengaluru', 25],
];

async function main() {
  const client = await pool.connect();
  const password = await bcrypt.hash(config.seedPassword, 10);

  try {
    await client.query('BEGIN');

    await client.query('TRUNCATE reports, transactions, messages, conversations, swap_offers, listing_images, listings RESTART IDENTITY CASCADE');
    await client.query('DELETE FROM users');
    await client.query('ALTER SEQUENCE users_id_seq RESTART WITH 1');

    const users = {};
    for (const u of USERS) {
      const { rows } = await client.query(
        `INSERT INTO users (full_name, email, phone, password_hash, role, location)
         VALUES ($1,$2,$3,$4,$5::user_role,$6) RETURNING id, full_name, role`,
        [u.full_name, u.email, u.phone || null, password, u.role, u.location]
      );
      users[u.email] = rows[0];
    }

    const { rows: cats } = await client.query('SELECT id, name FROM categories');
    const catByName = Object.fromEntries(cats.map(c => [c.name, c.id]));

    const sellers = Object.values(users).filter(u => u.role === 'user');
    const listingIds = [];

    let i = 0;
    for (const [title, description, catName, condition, type, price, location, age] of LISTINGS) {
      const seller = sellers[i % sellers.length];
      const createdAt = daysAgo(age);
      const { rows } = await client.query(
        `INSERT INTO listings (seller_id, category_id, title, description, condition, listing_type, price, location, created_at)
         VALUES ($1,$2,$3,$4,$5::item_condition,$6::listing_type,$7,$8,$9)
         RETURNING id`,
        [seller.id, catByName[catName], title, description, condition, type, price, location, createdAt]
      );
      listingIds.push({ id: rows[0].id, seller, title, type, price });
      i += 1;
    }

    // ---- a couple of conversations with messages ----
    const buyer1 = sellers.find(s => s.email !== undefined) || sellers[1];
    const l0 = listingIds[0];
    const otherBuyer = sellers.find(u => u.id !== l0.seller.id);
    const convo1 = await client.query(
      `INSERT INTO conversations (listing_id, buyer_id, seller_id) VALUES ($1,$2,$3) RETURNING id`,
      [l0.id, otherBuyer.id, l0.seller.id]
    );
    await client.query(
      `INSERT INTO messages (conversation_id, sender_id, body, created_at) VALUES
        ($1,$2,'Hi, is this acrylic set still available?', $4),
        ($1,$3,'Yes it is! Still about 80% full on each tube.', $5)`,
      [convo1.rows[0].id, otherBuyer.id, l0.seller.id, daysAgo(2), daysAgo(1.9)]
    );

    // ---- one completed sale transaction ----
    const soldListing = listingIds[9]; // oil paint set
    await client.query(`UPDATE listings SET status = 'sold' WHERE id = $1`, [soldListing.id]);
    const buyerForSale = sellers.find(u => u.id !== soldListing.seller.id);
    await client.query(
      `INSERT INTO transactions (listing_id, buyer_id, seller_id, type, amount, status, completed_at)
       VALUES ($1,$2,$3,'purchase',$4,'completed',$5)`,
      [soldListing.id, buyerForSale.id, soldListing.seller.id, soldListing.price, daysAgo(3)]
    );

    // ---- one pending swap offer on a swap-only listing ----
    const swapListing = listingIds.find(l => l.type === 'swap');
    const requester = sellers.find(u => u.id !== swapListing.seller.id);
    await client.query(
      `INSERT INTO swap_offers (listing_id, requester_id, offered_title, offered_description, message)
       VALUES ($1,$2,$3,$4,$5)`,
      [swapListing.id, requester.id, 'Set of 6 dry pastels, lightly used',
       'I have a set of soft pastels I barely use, happy to swap for your watercolour paper.',
       'Let me know if this works for you!']
    );

    // ---- one accepted swap (completed) on another listing ----
    const swapListing2 = listingIds.filter(l => l.type === 'swap')[1];
    if (swapListing2) {
      const requester2 = sellers.find(u => u.id !== swapListing2.seller.id);
      const { rows: sw } = await client.query(
        `INSERT INTO swap_offers (listing_id, requester_id, offered_title, status)
         VALUES ($1,$2,'Set of blending stumps and a kneaded eraser','accepted') RETURNING id`,
        [swapListing2.id, requester2.id]
      );
      await client.query(`UPDATE listings SET status = 'swapped' WHERE id = $1`, [swapListing2.id]);
      await client.query(
        `INSERT INTO transactions (listing_id, buyer_id, seller_id, swap_offer_id, type, status, completed_at)
         VALUES ($1,$2,$3,$4,'swap','completed',$5)`,
        [swapListing2.id, requester2.id, swapListing2.seller.id, sw[0].id, daysAgo(1)]
      );
    }

    // ---- one open report for the admin panel to show ----
    await client.query(
      `INSERT INTO reports (reporter_id, listing_id, reason, details)
       VALUES ($1,$2,$3,$4)`,
      [otherBuyer.id, l0.id, 'Suspected inaccurate condition',
       'The seller described this as like-new but a friend who saw it in person says a few tubes are nearly empty. Could you please check?']
    );

    await client.query('COMMIT');

    console.log('\nDemo data loaded.\n');
    console.log(`  Password for every demo account: ${config.seedPassword}\n`);
    console.log('  Admin    admin@artexchange.example');
    console.log('  User     ananya@example.com');
    console.log('  User     kabir@example.com');
    console.log('  User     meera@example.com');
    console.log(`\n  ${LISTINGS.length} realistic listings created across every category and status.\n`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seeding failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
