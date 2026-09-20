-- =====================================================================
--  Art Supply Exchange & Second-hand Material Marketplace
--  PostgreSQL schema  (tested on PostgreSQL 13+)
--
--  Run with:  psql -U marketplace_app -d marketplace_db -f db/schema.sql
-- =====================================================================

BEGIN;

DROP VIEW  IF EXISTS v_listing_summary   CASCADE;
DROP TABLE IF EXISTS reports             CASCADE;
DROP TABLE IF EXISTS transactions        CASCADE;
DROP TABLE IF EXISTS messages            CASCADE;
DROP TABLE IF EXISTS conversations       CASCADE;
DROP TABLE IF EXISTS swap_offers         CASCADE;
DROP TABLE IF EXISTS listing_images      CASCADE;
DROP TABLE IF EXISTS listings            CASCADE;
DROP TABLE IF EXISTS categories          CASCADE;
DROP TABLE IF EXISTS users               CASCADE;

DROP TYPE IF EXISTS user_role         CASCADE;
DROP TYPE IF EXISTS item_condition    CASCADE;
DROP TYPE IF EXISTS listing_type      CASCADE;
DROP TYPE IF EXISTS listing_status    CASCADE;
DROP TYPE IF EXISTS swap_status       CASCADE;
DROP TYPE IF EXISTS transaction_type  CASCADE;
DROP TYPE IF EXISTS transaction_status CASCADE;
DROP TYPE IF EXISTS report_status     CASCADE;

CREATE TYPE user_role          AS ENUM ('user', 'admin');
CREATE TYPE item_condition     AS ENUM ('new', 'like_new', 'used', 'fair');
CREATE TYPE listing_type       AS ENUM ('sale', 'swap', 'both');
CREATE TYPE listing_status     AS ENUM ('available', 'pending', 'sold', 'swapped', 'removed');
CREATE TYPE swap_status        AS ENUM ('pending', 'accepted', 'rejected', 'cancelled', 'completed');
CREATE TYPE transaction_type   AS ENUM ('purchase', 'swap');
CREATE TYPE transaction_status AS ENUM ('completed', 'cancelled');
CREATE TYPE report_status      AS ENUM ('open', 'reviewing', 'resolved', 'dismissed');

-- ---------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------
CREATE TABLE users (
    id             SERIAL PRIMARY KEY,
    full_name      VARCHAR(120) NOT NULL,
    email          VARCHAR(160) NOT NULL UNIQUE,
    phone          VARCHAR(20),
    password_hash  TEXT NOT NULL,
    role           user_role NOT NULL DEFAULT 'user',
    location       VARCHAR(120),
    bio            TEXT,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at  TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_users_role ON users(role);

-- ---------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------
CREATE TABLE categories (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(80) NOT NULL UNIQUE,
    description TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

-- ---------------------------------------------------------------------
-- Listings
-- ---------------------------------------------------------------------
CREATE TABLE listings (
    id             SERIAL PRIMARY KEY,
    seller_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id    INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    title          VARCHAR(160) NOT NULL,
    description    TEXT NOT NULL,
    condition      item_condition NOT NULL DEFAULT 'used',
    listing_type   listing_type NOT NULL DEFAULT 'sale',
    price          NUMERIC(10,2) CHECK (price IS NULL OR price >= 0),
    location       VARCHAR(120),
    status         listing_status NOT NULL DEFAULT 'available',
    view_count     INTEGER NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- a sale/both listing needs a price; a pure swap listing does not
    CONSTRAINT price_required_for_sale CHECK (
        listing_type = 'swap' OR price IS NOT NULL
    )
);

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_listings_touch
    BEFORE UPDATE ON listings
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX idx_listings_seller   ON listings(seller_id);
CREATE INDEX idx_listings_category ON listings(category_id);
CREATE INDEX idx_listings_status   ON listings(status);
CREATE INDEX idx_listings_type     ON listings(listing_type);
CREATE INDEX idx_listings_created  ON listings(created_at DESC);
CREATE INDEX idx_listings_location ON listings(location);

-- ---------------------------------------------------------------------
-- Listing images
-- ---------------------------------------------------------------------
CREATE TABLE listing_images (
    id           SERIAL PRIMARY KEY,
    listing_id   INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    file_name    VARCHAR(255) NOT NULL,
    stored_name  VARCHAR(255) NOT NULL,
    is_primary   BOOLEAN NOT NULL DEFAULT FALSE,
    uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_listing_images_listing ON listing_images(listing_id);

-- ---------------------------------------------------------------------
-- Swap offers
-- ---------------------------------------------------------------------
CREATE TABLE swap_offers (
    id                 SERIAL PRIMARY KEY,
    listing_id         INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    requester_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    offered_listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
    offered_title      VARCHAR(160) NOT NULL,
    offered_description TEXT,
    message            TEXT,
    status             swap_status NOT NULL DEFAULT 'pending',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT no_self_swap CHECK (TRUE) -- enforced in application (requester != seller)
);

CREATE TRIGGER trg_swap_offers_touch
    BEFORE UPDATE ON swap_offers
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX idx_swap_listing    ON swap_offers(listing_id);
CREATE INDEX idx_swap_requester  ON swap_offers(requester_id);
CREATE INDEX idx_swap_status     ON swap_offers(status);

-- ---------------------------------------------------------------------
-- Conversations & messages (buyer/seller chat, one thread per listing+buyer)
-- ---------------------------------------------------------------------
CREATE TABLE conversations (
    id           SERIAL PRIMARY KEY,
    listing_id   INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    buyer_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seller_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (listing_id, buyer_id)
);
CREATE INDEX idx_conversations_buyer  ON conversations(buyer_id);
CREATE INDEX idx_conversations_seller ON conversations(seller_id);

CREATE TABLE messages (
    id              BIGSERIAL PRIMARY KEY,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body            TEXT NOT NULL,
    is_read         BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);

-- ---------------------------------------------------------------------
-- Transactions (completed buy or swap — no payment gateway, seller-confirmed)
-- ---------------------------------------------------------------------
CREATE TABLE transactions (
    id            SERIAL PRIMARY KEY,
    listing_id    INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    buyer_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seller_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    swap_offer_id INTEGER REFERENCES swap_offers(id) ON DELETE SET NULL,
    type          transaction_type NOT NULL,
    amount        NUMERIC(10,2),
    status        transaction_status NOT NULL DEFAULT 'completed',
    completed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_transactions_listing ON transactions(listing_id);
CREATE INDEX idx_transactions_buyer   ON transactions(buyer_id);
CREATE INDEX idx_transactions_seller  ON transactions(seller_id);

-- ---------------------------------------------------------------------
-- Reports / disputes (admin module)
-- ---------------------------------------------------------------------
CREATE TABLE reports (
    id               SERIAL PRIMARY KEY,
    reporter_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listing_id       INTEGER REFERENCES listings(id) ON DELETE CASCADE,
    reported_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    reason           VARCHAR(160) NOT NULL,
    details          TEXT,
    status           report_status NOT NULL DEFAULT 'open',
    admin_notes      TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at      TIMESTAMPTZ
);
CREATE INDEX idx_reports_status ON reports(status);

-- ---------------------------------------------------------------------
-- Reporting view
-- ---------------------------------------------------------------------
CREATE VIEW v_listing_summary AS
SELECT
    l.id, l.title, l.condition, l.listing_type, l.price, l.status, l.location,
    l.view_count, l.created_at,
    cat.name AS category,
    u.full_name AS seller_name, u.id AS seller_id,
    (SELECT stored_name FROM listing_images li WHERE li.listing_id = l.id
       ORDER BY li.is_primary DESC, li.uploaded_at ASC LIMIT 1) AS primary_image
FROM listings l
JOIN categories cat ON cat.id = l.category_id
JOIN users u ON u.id = l.seller_id;

COMMIT;
