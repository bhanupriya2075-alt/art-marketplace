# Art Supply Exchange & Second-hand Material Marketplace

A community marketplace where art students, hobbyists and professionals can buy, sell and
swap second-hand art supplies locally — built with Node.js/Express, PostgreSQL, and a
dependency-free browser frontend (no build step; the server serves `public/` directly).

---

## Contents

1. [What's included](#1-whats-included)
2. [Prerequisites](#2-prerequisites)
3. [Database setup](#3-database-setup) ← start here
4. [Application setup](#4-application-setup)
5. [Demo accounts](#5-demo-accounts)
6. [The eight pages](#6-the-eight-pages)
7. [API reference](#7-api-reference)
8. [Data model](#8-data-model)
9. [Troubleshooting](#9-troubleshooting)
10. [Deployment notes](#10-deployment-notes)

---

## 1. What's included

**Marketplace** — browse, search and filter listings by category, condition, listing type
(sale/swap/both), price and area; sort by newest or price.

**Listings** — sellers create listings with up to 5 photos, condition and category; edit or
remove their own; mark a sale complete once a buyer is chosen.

**Swap requests** — buyers propose a swap, optionally offering one of their own listings in
exchange; sellers accept or reject; accepting a swap automatically marks both items swapped
and declines any other pending offers on the same listing.

**Chat** — a message thread opens automatically the moment a buyer contacts a seller or
proposes a swap, so negotiation happens in one place.

**Admin panel** — manage members (suspend/reactivate), monitor and remove listings, and
resolve reported disputes, plus KPIs (total listings, active members, purchases vs swaps
completed, listing conversion rate).

**Security** — bcrypt password hashing, JWT sessions, ownership checks on every write route,
rate-limited sign-in, Helmet CSP, parameterised SQL throughout, MIME/size limits on image
uploads.

```
art-marketplace/
├── db/
│   ├── schema.sql          tables, enums, triggers, reporting view
│   └── seed.sql            categories (reference data)
├── scripts/
│   ├── migrate.js          runs schema.sql + seed.sql
│   └── seed.js             demo users and realistic sample listings
├── src/
│   ├── server.js  config.js  db.js
│   ├── middleware/auth.js  JWT verification and role guards
│   └── routes/             auth, listings, swaps, chat, admin
├── public/                 the frontend (index.html, css, js)
├── uploads/                listing photo storage
├── docker-compose.yml      optional PostgreSQL container
└── .env.example
```

---

## 2. Prerequisites

| Requirement | Version | Check |
|---|---|---|
| Node.js | 18 or newer | `node -v` |
| npm | 9 or newer | `npm -v` |
| PostgreSQL | 13 or newer | `psql --version` |

---

## 3. Database setup

### Option A — PostgreSQL installed locally

#### A1. Confirm PostgreSQL is running

```bash
pg_isready
```

If that fails: Linux `sudo systemctl start postgresql`; macOS
`brew services start postgresql@16`; Windows — start the `postgresql-x64-...` service, or
open the **SQL Shell (psql)** app, which starts it automatically.

#### A2. Create the database and an application role

Open a superuser shell:

```bash
# Linux
sudo -u postgres psql
# macOS
psql postgres
# Windows: open "SQL Shell (psql)" and press Enter through Server/Database/Port/Username,
# then enter the postgres password you set at install time.
```

Then run, **changing the password**:

```sql
CREATE ROLE marketplace_app WITH LOGIN PASSWORD 'StrongPassword123!';
CREATE DATABASE marketplace_db OWNER marketplace_app;

\c marketplace_db
GRANT ALL ON SCHEMA public TO marketplace_app;
ALTER SCHEMA public OWNER TO marketplace_app;

\q
```

The `GRANT`/`ALTER` lines are required on PostgreSQL 15+, which revokes public-schema
rights by default — skip them and migration fails with "permission denied for schema public."

#### A3. Verify the app role can connect

```bash
psql -h localhost -U marketplace_app -d marketplace_db -c "SELECT current_database(), current_user;"
```

If that prints `marketplace_db` and `marketplace_app`, the database side is done.

---

### Option B — PostgreSQL in Docker

```bash
docker compose up -d
docker compose logs -f db      # wait for "database system is ready to accept connections"
```

This starts PostgreSQL 16 with database `marketplace_db`, user `marketplace_app`, password
`change_this_password` (already matching `.env.example`), and a named volume so data
survives restarts. `docker compose down` stops it; `docker compose down -v` also wipes data.

---

### Creating the tables

```bash
npm run migrate    # applies db/schema.sql then db/seed.sql
```

Expected output:

```
Migrating database "marketplace_db" …
  applied db/schema.sql
  applied db/seed.sql
Schema and reference data are ready.
```

This creates 9 tables, 8 enum types, two `updated_at` triggers, the `v_listing_summary`
reporting view, and 9 art-supply categories. **This command drops and recreates every
table** — safe to re-run in development, destructive anywhere else.

Applying the SQL directly instead:

```bash
psql -h localhost -U marketplace_app -d marketplace_db -f db/schema.sql
psql -h localhost -U marketplace_app -d marketplace_db -f db/seed.sql
```

### Loading demo data

```bash
npm run seed
```

Creates 6 accounts (1 admin, 5 members), 12 realistic listings spanning every category and
condition, a couple of chat conversations, a completed sale, an accepted swap and a pending
swap offer, and one open dispute for the admin panel to show. `npm run reset` runs migrate
and seed together.

### Confirming it worked

```bash
psql -h localhost -U marketplace_app -d marketplace_db
```
```sql
\dt                                    -- 9 tables
SELECT title, status, listing_type FROM listings LIMIT 5;
SELECT name FROM categories ORDER BY name;
\q
```

---

## 4. Application setup

```bash
cd art-marketplace
npm install
cp .env.example .env          # Windows: copy .env.example .env
```

Set at minimum in `.env`:

```ini
DATABASE_URL=postgresql://marketplace_app:StrongPassword123!@localhost:5432/marketplace_db
JWT_SECRET=<a long random string>
```

Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`.
If your password contains `@ : / #`, either URL-encode it or use the separate
`PGHOST`/`PGUSER`/`PGPASSWORD`/`PGDATABASE` variables instead of `DATABASE_URL`.

Then:

```bash
npm run migrate
npm run seed
npm start
```

Open **http://localhost:4100**. Health check: **http://localhost:4100/api/health**.
`npm run dev` restarts on file changes.

---

## 5. Demo accounts

Every account uses the password **`Passw0rd!`**.

| Role | Email | Sees |
|---|---|---|
| Member | `ananya@example.com` | Their own listings, swap requests, chats |
| Member | `kabir@example.com` | Same, as a second account for testing both sides of a chat/swap |
| Member | `meera@example.com` | Same |
| Member | `rohan@example.com` | Same |
| Member | `fatima@example.com` | Same |
| Admin | `admin@artexchange.example` | Every member, listing and open report |

A good tour: sign in as `ananya@example.com`, browse the marketplace, message a seller or
propose a swap on someone else's listing; sign in as that seller to reply and accept/decline;
sign in as `admin@artexchange.example` to see the KPI dashboard and resolve the seeded report.

---

## 6. The eight pages

| Page | Route | Purpose |
|---|---|---|
| Login / Register | `#/signin` | Sign in or create a member account |
| Dashboard | `#/` | Personal snapshot — active listings, pending swap offers, unread messages |
| Marketplace | `#/marketplace` | Browse, search and filter all available listings |
| Sell an item | `#/sell` | Create a new listing with photos |
| Product Detail | `#/listing/:id` | Full listing view; message the seller, propose a swap, or manage your own listing |
| Chat | `#/chat` | Conversation list and message thread |
| Swap Requests | `#/swaps` | Sent and received swap offers, with accept/reject/cancel |
| Admin Panel | `#/admin` | Members, listings, disputes and marketplace-wide KPIs |

---

## 7. API reference

All authenticated routes take `Authorization: Bearer <token>`.

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | public | Create a member account |
| POST | `/api/auth/login` | public | Sign in (rate limited) |
| GET | `/api/auth/me` | any | Current user |
| PATCH | `/api/auth/me` | any | Update profile |
| POST | `/api/auth/change-password` | any | Change password |
| GET | `/api/listings/categories` | public | List categories |
| POST | `/api/listings` | any | Create a listing (multipart, up to 5 images) |
| GET | `/api/listings` | public | Browse/filter; `category_id`, `condition`, `listing_type`, `min_price`, `max_price`, `location`, `q`, `sort`, `mine` |
| GET | `/api/listings/:id` | public | Listing detail (increments view count) |
| GET | `/api/listings/:id/images/:imgId` | public | Fetch an image |
| PATCH | `/api/listings/:id` | owner | Edit title/description/price/status |
| DELETE | `/api/listings/:id` | owner | Remove (soft delete) |
| POST | `/api/listings/:id/interest` | any | Message the seller, opens a conversation |
| POST | `/api/listings/:id/complete-sale` | owner | Mark sold, records a transaction |
| GET | `/api/listings/:id/interested-buyers` | owner | Buyers who have messaged about this listing |
| POST | `/api/listings/:id/swap-requests` | any | Propose a swap |
| GET | `/api/swap-requests` | any | `role=sent` or `role=received` |
| GET | `/api/swap-requests/:id` | party | Detail |
| POST | `/api/swap-requests/:id/respond` | seller | `{ decision: "accepted" \| "rejected" }` |
| POST | `/api/swap-requests/:id/cancel` | requester | Cancel a pending offer |
| GET | `/api/conversations` | any | My conversations with unread counts |
| POST | `/api/conversations` | any | Start/get a conversation for a listing |
| GET | `/api/conversations/:id/messages` | party | Thread (marks incoming as read) |
| POST | `/api/conversations/:id/messages` | party | Send a message |
| POST | `/api/admin/reports` | any | File a report on a listing or user |
| GET/PATCH | `/api/admin/reports` | admin | Review/resolve reports |
| GET | `/api/admin/users` | admin | Member directory |
| PATCH | `/api/admin/users/:id/status` | admin | Suspend/reactivate |
| GET/PATCH | `/api/admin/listings` | admin | Moderate any listing |
| GET | `/api/admin/kpis` | admin | Marketplace-wide KPIs |
| GET | `/api/admin/categories/breakdown` | admin | Listings per category |
| GET | `/api/health` | public | Liveness and database check |

---

## 8. Data model

```
categories ──< listings ──< listing_images
                  │  \
                  │   ──< swap_offers >── listings (offered_listing_id)
                  ├──< conversations ──< messages
                  └──< transactions
users ──< listings (seller)      users ──< conversations (buyer/seller)
users ──< swap_offers (requester)  users ──< reports (reporter/reported)
```

| Table | Holds |
|---|---|
| `users` | Members and admins |
| `categories` | Paints, Brushes, Canvases, Sketchbooks, Drawing Tools, Easels, Craft Supplies, Frames & Display, Other |
| `listings` | The item record — condition, listing type, price, status, view count |
| `listing_images` | Uploaded photos, metadata in the table, files on disk |
| `swap_offers` | Proposed trades, with optional counter-listing and full status history |
| `conversations` / `messages` | One thread per listing+buyer pair |
| `transactions` | Completed purchases and swaps, for KPI reporting |
| `reports` | Disputes filed by members, reviewed by admins |

Enum types (`user_role`, `item_condition`, `listing_type`, `listing_status`, `swap_status`,
`transaction_type`, `transaction_status`, `report_status`) keep invalid values out at the
database level. The `v_listing_summary` view flattens joins for reporting.

---

## 9. Troubleshooting

**`password authentication failed for user "marketplace_app"`** — the password in `.env`
doesn't match what you set in step A2. Reset it: `ALTER ROLE marketplace_app WITH PASSWORD
'NewPassword123';` in psql, then update `.env` to match exactly.

**`permission denied for schema public`** — run the `GRANT`/`ALTER SCHEMA` statements from
step A2; required on PostgreSQL 15+.

**`ECONNREFUSED 127.0.0.1:5432`** — PostgreSQL isn't running; start it or run
`docker compose up -d`.

**`relation "listings" does not exist`** — the schema hasn't been applied; run
`npm run migrate`.

**Images don't show** — check the `uploads/` folder exists and is writable, and that the
file is under 5 MB and JPG/PNG/WEBP.

**Sign-in fails with demo accounts** — `npm run seed` hasn't run, or ran with a different
`SEED_PASSWORD`; run `npm run reset`.

---

## 10. Deployment notes

- Set `NODE_ENV=production` and a strong `JWT_SECRET` before deploying — the app refuses to
  start in production with the placeholder secret.
- Set `PGSSL=true` for managed PostgreSQL (Render, RDS, Supabase, etc.).
- Move listing photos to object storage (S3 or equivalent) for any deployment where the
  filesystem doesn't persist across restarts — local disk uploads are for development only.
- Run `npm run migrate` and `npm run seed` once against the live database via your host's
  shell access after the first deploy.
- Take regular backups: `pg_dump -U marketplace_app marketplace_db > backup.sql`.

### Out of scope in this phase

Per the project brief: online payment integration, courier/logistics integration, an
AI-based recommendation system, and a native mobile app. The schema leaves room for all four
— for example, `transactions.amount` and `status` are already shaped for a future payment
gateway to write into.
