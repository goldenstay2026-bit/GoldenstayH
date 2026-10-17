import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { BOOKING_OPTIONS, ROOM_CATALOG } from '../shared/catalog.ts';

export type DB = DatabaseSync;

const SCHEMA = /* sql */ `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS rooms (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  price_paise  INTEGER NOT NULL CHECK (price_paise >= 100),
  units        TEXT NOT NULL,              -- JSON array of physical units, e.g. ["ac","nonac"]
  bookable     INTEGER NOT NULL DEFAULT 1,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id               INTEGER PRIMARY KEY,
  ref              TEXT NOT NULL UNIQUE,    -- public booking ID, e.g. GS7K3F9Q
  token_hash       TEXT NOT NULL,           -- sha256 of the guest's private access token
  status           TEXT NOT NULL,           -- pending_payment | pending_verification | confirmed | cancelled | expired
  payment_status   TEXT NOT NULL,           -- pending | pending_verification | successful | failed | refunded
  needs_attention  TEXT,                    -- reason an admin must look (e.g. paid after hold expired)
  room_id          TEXT NOT NULL REFERENCES rooms(id),
  room_name        TEXT NOT NULL,
  check_in         TEXT NOT NULL,
  check_out        TEXT NOT NULL,
  nights           INTEGER NOT NULL,
  guests           INTEGER NOT NULL,
  nightly_paise    INTEGER NOT NULL,        -- price locked at booking time
  lines_json       TEXT NOT NULL,           -- price breakdown, locked at booking time
  total_paise      INTEGER NOT NULL,
  pay_now_paise    INTEGER NOT NULL,
  guest_name       TEXT NOT NULL,
  guest_phone      TEXT NOT NULL,
  guest_email      TEXT NOT NULL,
  guest_message    TEXT NOT NULL DEFAULT '',
  hold_expires_at  TEXT,                    -- null once paid / submitted / closed
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  confirmed_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);

-- One row per physical unit per night held by a booking. The UNIQUE constraint
-- is what makes double booking impossible, even under concurrent requests.
CREATE TABLE IF NOT EXISTS booking_nights (
  booking_id  INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  unit        TEXT NOT NULL,
  night       TEXT NOT NULL,
  UNIQUE (unit, night)
);
CREATE INDEX IF NOT EXISTS idx_nights_booking ON booking_nights(booking_id);

CREATE TABLE IF NOT EXISTS payments (
  id                     INTEGER PRIMARY KEY,
  booking_id             INTEGER NOT NULL REFERENCES bookings(id),
  method                 TEXT NOT NULL,       -- gateway | qr
  state                  TEXT NOT NULL,       -- gateway: created|pending|completed|failed ; qr: submitted|verified|rejected
  amount_paise           INTEGER NOT NULL,    -- amount requested (server-calculated)
  merchant_order_id      TEXT UNIQUE,         -- gateway: our order ID sent to PhonePe
  gateway_order_id       TEXT,                -- gateway: PhonePe's orderId
  gateway_transaction_id TEXT,                -- gateway: PhonePe transactionId of the successful attempt
  gateway_payment_mode   TEXT,
  gateway_error_code     TEXT,
  redirect_url           TEXT,
  expires_at             TEXT,
  utr                    TEXT,                -- qr: guest-submitted UPI reference (12 digits)
  last_response_json     TEXT,                -- last status payload from PhonePe (no secrets)
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_booking ON payments(booking_id);
-- A UTR can back only one live QR payment.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_utr ON payments(utr) WHERE utr IS NOT NULL AND state <> 'rejected';

CREATE TABLE IF NOT EXISTS refunds (
  id                  INTEGER PRIMARY KEY,
  payment_id          INTEGER NOT NULL REFERENCES payments(id),
  method              TEXT NOT NULL,          -- gateway | manual
  merchant_refund_id  TEXT NOT NULL UNIQUE,
  gateway_refund_id   TEXT,
  amount_paise        INTEGER NOT NULL,
  state               TEXT NOT NULL,          -- pending | completed | failed
  note                TEXT NOT NULL DEFAULT '',
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id                 INTEGER PRIMARY KEY,
  received_at        TEXT NOT NULL,
  event              TEXT,
  merchant_order_id  TEXT,
  auth_ok            INTEGER NOT NULL,
  body_json          TEXT NOT NULL,
  result             TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY,
  at          TEXT NOT NULL,
  actor       TEXT NOT NULL,                 -- guest | system | phonepe | admin
  action      TEXT NOT NULL,
  booking_id  INTEGER REFERENCES bookings(id),
  details     TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_audit_booking ON audit_log(booking_id);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash  TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  ip          TEXT
);
`;

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  migrate(db);
  seedRooms(db);
  return db;
}

/** Additive schema upgrades for databases created by earlier versions. */
function migrate(db: DB) {
  const cols = (db.prepare('PRAGMA table_info(bookings)').all() as { name: string }[]).map((c) => c.name);
  // Firebase Auth user who made the booking (guests must sign in to book).
  if (!cols.includes('user_uid')) db.exec('ALTER TABLE bookings ADD COLUMN user_uid TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_uid)');

  // Owner-managed bookings and date blocks live in the same table, so the same
  // UNIQUE(unit, night) rule protects every kind of booking from overlaps.
  const add = (name: string, def: string) => {
    if (!cols.includes(name)) db.exec(`ALTER TABLE bookings ADD COLUMN ${name} ${def}`);
  };
  add('kind', "TEXT NOT NULL DEFAULT 'booking'"); // booking | block
  add('source', "TEXT NOT NULL DEFAULT 'website_online'"); // website_online | website_request | phone | whatsapp | walk_in | other | block
  add('occasion', "TEXT NOT NULL DEFAULT ''");
  add('notes', "TEXT NOT NULL DEFAULT ''");
  add('request_id', 'INTEGER');

  // Website enquiries ("requests"). Not bookings until the owner approves one.
  db.exec(`CREATE TABLE IF NOT EXISTS booking_requests (
    id            INTEGER PRIMARY KEY,
    status        TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | declined | expired
    booking_type  TEXT NOT NULL,                    -- room | entire | party
    option_id     TEXT NOT NULL,                    -- ac-1bhk | nonac-1bhk | 2bhk | entire | any
    check_in      TEXT NOT NULL,
    check_out     TEXT NOT NULL,
    nights        INTEGER NOT NULL,
    guests        INTEGER NOT NULL,
    guest_name    TEXT NOT NULL,
    guest_phone   TEXT NOT NULL,
    occasion      TEXT NOT NULL DEFAULT '',
    message       TEXT NOT NULL DEFAULT '',
    booking_id    INTEGER REFERENCES bookings(id),
    decided_at    TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_requests_status ON booking_requests(status)');
}

/** Inserts catalogue rooms that don't exist yet. Never overwrites admin-edited prices. */
function seedRooms(db: DB) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO rooms (id, name, price_paise, units, bookable, updated_at) VALUES (?, ?, ?, ?, 1, ?)',
  );
  const now = new Date().toISOString();
  for (const r of ROOM_CATALOG) insert.run(r.id, r.name, r.pricePaise, JSON.stringify(r.units), now);
  // Non-room options (Entire Homestay): owner-booked only, never priced or bookable online.
  // price_paise is a placeholder required by the schema and is never shown.
  const insertOption = db.prepare(
    'INSERT OR IGNORE INTO rooms (id, name, price_paise, units, bookable, updated_at) VALUES (?, ?, 100, ?, 0, ?)',
  );
  for (const o of BOOKING_OPTIONS) if (!ROOM_CATALOG.some((r) => r.id === o.id)) insertOption.run(o.id, o.name, JSON.stringify(o.units), now);
}

const depth = new WeakMap<DB, number>();
/** Callbacks to run after the outermost transaction commits, tagged with the depth they were queued at. */
const pending = new WeakMap<DB, { depth: number; fn: () => void }[]>();

/**
 * Runs fn after the current transaction commits (or right away, on the next
 * tick, when no transaction is open). Dropped if the transaction rolls back,
 * so side effects such as Firestore copies never reflect undone changes.
 */
export function onCommit(db: DB, fn: () => void) {
  const d = depth.get(db) ?? 0;
  if (d === 0) {
    queueMicrotask(fn);
    return;
  }
  const list = pending.get(db) ?? [];
  list.push({ depth: d, fn });
  pending.set(db, list);
}

/**
 * Runs fn inside a transaction (BEGIN IMMEDIATE takes the write lock up front).
 * Nested calls become savepoints, so helpers can compose safely.
 */
export function tx<T>(db: DB, fn: () => T): T {
  const d = depth.get(db) ?? 0;
  const sp = `sp${d}`;
  db.exec(d === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
  depth.set(db, d + 1);
  try {
    const out = fn();
    db.exec(d === 0 ? 'COMMIT' : `RELEASE ${sp}`);
    if (d === 0) {
      const list = pending.get(db) ?? [];
      pending.delete(db);
      for (const p of list) queueMicrotask(p.fn);
    }
    return out;
  } catch (e) {
    db.exec(d === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
    // Forget callbacks queued inside the part that was undone.
    const list = pending.get(db);
    if (list) pending.set(db, list.filter((p) => p.depth <= d));
    if (d === 0) pending.delete(db);
    throw e;
  } finally {
    depth.set(db, d);
  }
}
