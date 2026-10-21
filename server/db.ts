// Data layer on Cloud Firestore.
//
// Rows are plain Firestore documents whose fields keep the original column
// names (snake_case), so the rest of the server reads them as typed rows.
//
// Transactions: tx() runs in a Firestore transaction. Writes are buffered and
// sent together when the transaction finishes, so code can read, write and
// read again (Firestore itself needs every read before the first write).
// Reads inside a transaction see the transaction's own buffered writes.
// Nested tx() calls behave like savepoints: if the inner part throws, only its
// writes are undone. onCommit() callbacks run after a successful commit.
//
// Queries send at most ONE filter (or one ordering) to Firestore and apply the
// rest in memory. That needs only Firestore's automatic single-field indexes,
// so nothing has to be configured in the console. Data volumes here are small.

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Firestore, Query, Transaction } from 'firebase-admin/firestore';
import { BOOKING_OPTIONS, ROOM_CATALOG } from '../shared/catalog.ts';

export type Row = Record<string, any>;
export type Op = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in';
export type Where = [field: string, op: Op, value: unknown];
export type QueryOpts = {
  where?: Where[];
  orderBy?: [field: string, dir?: 'asc' | 'desc'][];
  limit?: number;
  /** With no `where`: let Firestore order + limit (one field only). Saves reads on big collections. */
  serverOrder?: boolean;
};

/** A document that must not exist yet (e.g. a room-night already held). */
export class ConflictError extends Error {
  constructor(message = 'already exists') {
    super(message);
    this.name = 'ConflictError';
  }
}

/** Collections whose documents get sequential numeric ids (1, 2, 3 …), like the old SQL tables. */
const NUMBERED = new Set(['bookings', 'payments', 'refunds', 'booking_requests']);

type Pending = { col: string; id: string; data: Row | null; create: boolean };
type TxState = { t: Transaction; writes: Map<string, Pending>; reads: Map<string, Row | null>; hooks: (() => void)[] };

const copy = <T>(v: T): T => (v === null || v === undefined ? v : structuredClone(v));

function matches(row: Row, [field, op, value]: Where): boolean {
  const v = row[field] ?? null;
  switch (op) {
    case '==':
      return v === value;
    case '!=':
      return v !== null && v !== value;
    case 'in':
      return (value as unknown[]).includes(v);
    default:
      if (v === null || value === null || value === undefined) return false;
      if (op === '<') return v < (value as never);
      if (op === '<=') return v <= (value as never);
      if (op === '>') return v > (value as never);
      return v >= (value as never);
  }
}

export class Store {
  private als = new AsyncLocalStorage<TxState>();
  readonly fs: Firestore;
  constructor(fs: Firestore) {
    this.fs = fs;
  }

  private ref(col: string, id: string | number) {
    return this.fs.collection(col).doc(String(id));
  }

  get inTransaction() {
    return this.als.getStore() !== undefined;
  }

  async get<T = Row>(col: string, id: string | number): Promise<T | undefined> {
    const key = `${col}/${id}`;
    const s = this.als.getStore();
    if (s) {
      if (s.writes.has(key)) return (copy(s.writes.get(key)!.data) ?? undefined) as T | undefined;
      if (!s.reads.has(key)) {
        const snap = await s.t.get(this.ref(col, id));
        s.reads.set(key, snap.exists ? (snap.data() as Row) : null);
      }
      return (copy(s.reads.get(key)) ?? undefined) as T | undefined;
    }
    const snap = await this.ref(col, id).get();
    return snap.exists ? (snap.data() as T) : undefined;
  }

  async getMany<T = Row>(col: string, ids: (string | number)[]): Promise<Map<string, T>> {
    const out = new Map<string, T>();
    const unique = [...new Set(ids.map(String))];
    if (unique.length === 0) return out;
    if (this.inTransaction) {
      for (const id of unique) {
        const r = await this.get<T>(col, id);
        if (r) out.set(id, r);
      }
      return out;
    }
    const snaps = await this.fs.getAll(...unique.map((id) => this.ref(col, id)));
    for (const s of snaps) if (s.exists) out.set(s.id, s.data() as T);
    return out;
  }

  async query<T = Row>(col: string, opts: QueryOpts = {}): Promise<T[]> {
    const where = opts.where ?? [];
    let q: Query = this.fs.collection(col);
    const RANGE = new Set(['<', '<=', '>', '>=']);
    if (where.length > 0) {
      q = q.where(where[0][0], where[0][1], where[0][2]);
      // A range on the first field may be closed on both sides (still one single-field index).
      const second = where[1];
      if (second && second[0] === where[0][0] && RANGE.has(where[0][1]) && RANGE.has(second[1])) q = q.where(second[0], second[1], second[2]);
    } else if (opts.serverOrder && opts.orderBy?.length === 1) {
      q = q.orderBy(opts.orderBy[0][0], opts.orderBy[0][1] ?? 'asc');
      if (opts.limit) q = q.limit(opts.limit);
    }
    const s = this.als.getStore();
    const snap = s ? await s.t.get(q) : await q.get();
    const rows = new Map<string, Row>();
    for (const d of snap.docs) {
      rows.set(d.id, d.data() as Row);
      if (s && !s.reads.has(`${col}/${d.id}`)) s.reads.set(`${col}/${d.id}`, d.data() as Row);
    }
    if (s) for (const w of s.writes.values()) if (w.col === col) (w.data === null ? rows.delete(w.id) : rows.set(w.id, w.data));
    let list = [...rows.values()].filter((r) => where.every((w) => matches(r, w)));
    if (opts.orderBy?.length) {
      const order = opts.orderBy;
      list.sort((a, b) => {
        for (const [f, dir = 'asc'] of order) {
          const x = a[f] ?? '';
          const y = b[f] ?? '';
          if (x < y) return dir === 'asc' ? -1 : 1;
          if (x > y) return dir === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }
    if (opts.limit) list = list.slice(0, opts.limit);
    return list.map((r) => copy(r)) as T[];
  }

  /** Adds a document. Numbered collections get the next id; others a random id. Returns the id. */
  async insert(col: string, data: Row): Promise<number | string> {
    if (!NUMBERED.has(col)) {
      const id = this.fs.collection(col).doc().id;
      if (this.inTransaction) this.buffer(col, id, { ...data, id }, true);
      else await this.ref(col, id).create({ ...data, id });
      return id;
    }
    return this.tx(async () => {
      const counter = await this.get<{ n: number }>('counters', col);
      const id = (counter?.n ?? 0) + 1;
      await this.set('counters', col, { n: id });
      this.buffer(col, String(id), { ...data, id }, true);
      return id;
    });
  }

  /** Creates a document that must not exist yet; throws ConflictError if it does. */
  async create(col: string, id: string, data: Row): Promise<void> {
    if (this.inTransaction) {
      if (await this.get(col, id)) throw new ConflictError(`${col}/${id} exists`);
      this.buffer(col, id, data, true);
      return;
    }
    try {
      await this.ref(col, id).create(data);
    } catch (e) {
      if ((e as { code?: number }).code === 6) throw new ConflictError(`${col}/${id} exists`);
      throw e;
    }
  }

  async set(col: string, id: string | number, data: Row): Promise<void> {
    if (this.inTransaction) return this.buffer(col, String(id), data, false);
    await this.ref(col, id).set(data);
  }

  /** Merges fields into an existing document (no-op if it doesn't exist). */
  async update(col: string, id: string | number, patch: Row): Promise<void> {
    if (this.inTransaction) {
      const cur = await this.get(col, id);
      if (!cur) return;
      return this.buffer(col, String(id), { ...cur, ...patch }, false);
    }
    await this.ref(col, id)
      .update(patch)
      .catch((e) => {
        if ((e as { code?: number }).code !== 5) throw e; // 5 = NOT_FOUND
      });
  }

  async delete(col: string, id: string | number): Promise<void> {
    if (this.inTransaction) return this.buffer(col, String(id), null, false);
    await this.ref(col, id).delete();
  }

  private buffer(col: string, id: string, data: Row | null, create: boolean) {
    const s = this.als.getStore()!;
    const key = `${col}/${id}`;
    const prev = s.writes.get(key);
    // A document created in this transaction and then deleted again never needs to exist.
    if (data === null && prev?.create) {
      s.writes.delete(key);
      s.reads.set(key, null);
      return;
    }
    // "create" (must not exist yet) only applies to a document this transaction is creating from
    // nothing. Deleted and then re-created in the same transaction = an overwrite of the stored one.
    const isNew = prev ? prev.create : create;
    s.writes.set(key, { col, id, data: copy(data), create: isNew });
  }

  /** Runs fn after the surrounding transaction commits (or on the next tick when there is none). */
  onCommit(fn: () => void) {
    const s = this.als.getStore();
    if (s) s.hooks.push(fn);
    else queueMicrotask(fn);
  }

  /** Runs fn atomically. Nested calls are savepoints: an inner failure undoes only the inner writes. */
  async tx<T>(fn: () => Promise<T>): Promise<T> {
    const cur = this.als.getStore();
    if (cur) {
      const writes = new Map(cur.writes);
      const reads = new Map(cur.reads);
      const hooks = cur.hooks.length;
      try {
        return await fn();
      } catch (e) {
        cur.writes = writes;
        cur.reads = reads;
        cur.hooks.length = hooks;
        throw e;
      }
    }
    let hooks: (() => void)[] = [];
    let out: T;
    try {
      out = await this.fs.runTransaction(
        async (t) => {
          const state: TxState = { t, writes: new Map(), reads: new Map(), hooks: [] };
          const result = await this.als.run(state, fn);
          for (const w of state.writes.values()) {
            const ref = this.ref(w.col, w.id);
            if (w.data === null) t.delete(ref);
            else if (w.create) t.create(ref, w.data);
            else t.set(ref, w.data);
          }
          hooks = state.hooks;
          return result;
        },
        { maxAttempts: 5 },
      );
    } catch (e) {
      // A create() lost a race at commit time (another request took the same room-night).
      if ((e as { code?: number }).code === 6) throw new ConflictError((e as Error).message);
      throw e;
    }
    for (const h of hooks) queueMicrotask(h);
    return out;
  }
}

// ---------- setup ----------

const ready = new WeakMap<Store, Promise<void>>();

/** Makes sure the room catalogue exists (once per server instance). Never overwrites edited prices. */
export function ensureSeeded(store: Store): Promise<void> {
  let p = ready.get(store);
  if (!p) {
    p = (async () => {
      const now = new Date().toISOString();
      const have = new Set((await store.query<{ id: string }>('rooms')).map((r) => r.id));
      for (const o of BOOKING_OPTIONS) {
        if (have.has(o.id)) continue;
        const room = ROOM_CATALOG.find((r) => r.id === o.id);
        // Non-room options (Entire Homestay) are owner-booked only: never priced or bookable online.
        const data = { id: o.id, name: o.name, price_paise: room ? room.pricePaise : 100, units: JSON.stringify(o.units), bookable: room ? 1 : 0, updated_at: now };
        await store.create('rooms', o.id, data).catch((e) => {
          if (!(e instanceof ConflictError)) throw e;
        });
      }
    })();
    p.catch(() => ready.delete(store));
    ready.set(store, p);
  }
  return p;
}
