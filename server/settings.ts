// Property settings the owner edits in Admin → Settings: stay details and
// house rules (shown on the public policy pages and in confirmation messages)
// and seasonal prices. Stored in Firestore: settings/property and
// seasonal_prices/{id}.

import type { PropertySettings } from '../shared/types.ts';
import { isRoomId, type RoomId } from '../shared/catalog.ts';
import { parseISODate } from '../shared/validate.ts';
import { audit, iso, type Ctx } from './bookings.ts';
import { HttpError } from './http.ts';

export const EMPTY_SETTINGS: PropertySettings = {
  checkInTime: null,
  checkOutTime: null,
  advanceRequired: null,
  freeCancellationHours: null,
  lateCancellationCharge: null,
  refundDays: null,
  smoking: null,
  alcohol: null,
  pets: null,
  visitors: null,
  quietHours: null,
  securityDeposit: null,
  eventDeposit: null,
};
const NUMBER_FIELDS = new Set<keyof PropertySettings>(['freeCancellationHours', 'refundDays']);
const TEXT_LIMIT = 160;

const cache = new WeakMap<object, { at: number; value: PropertySettings }>();

export async function getPropertySettings(ctx: Ctx): Promise<PropertySettings> {
  const hit = cache.get(ctx.db);
  if (hit && Date.now() - hit.at < 30_000) return hit.value;
  const doc = await ctx.db.get<Partial<PropertySettings>>('settings', 'property');
  const value = { ...EMPTY_SETTINGS, ...(doc ?? {}) } as PropertySettings;
  cache.set(ctx.db, { at: Date.now(), value });
  return value;
}

/** Validates and saves; empty fields become null (= not shown anywhere). */
export async function savePropertySettings(ctx: Ctx, input: Record<string, unknown>, actor: string): Promise<PropertySettings> {
  const next = { ...EMPTY_SETTINGS } as Record<keyof PropertySettings, string | number | null>;
  for (const key of Object.keys(EMPTY_SETTINGS) as (keyof PropertySettings)[]) {
    const raw = input[key];
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    if (NUMBER_FIELDS.has(key)) {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > 720) throw new HttpError(400, 'Enter a whole number of hours/days (0–720).', 'INVALID_INPUT', key);
      next[key] = n;
    } else {
      next[key] = String(raw).trim().replace(/\s+/g, ' ').slice(0, TEXT_LIMIT);
    }
  }
  await ctx.db.set('settings', 'property', { ...next, updated_at: iso(ctx) });
  cache.delete(ctx.db);
  await audit(ctx, actor, 'settings.property_updated', null, next);
  return next as PropertySettings;
}

// ---------- seasonal prices ----------

export type SeasonalPrice = { id: string; room_id: RoomId; from: string; to: string; price_paise: number; label: string; created_at: string };

/** Seasonal prices for a room (all, or only those that touch [from, to)). */
export async function seasonalPricesFor(ctx: Ctx, roomId: string): Promise<SeasonalPrice[]> {
  return ctx.db.query<SeasonalPrice>('seasonal_prices', { where: [['room_id', '==', roomId]], orderBy: [['created_at']] });
}

export const listSeasonalPrices = (ctx: Ctx) => ctx.db.query<SeasonalPrice>('seasonal_prices', { orderBy: [['from'], ['room_id']] });

/** A seasonal price covers the nights from `from` up to and including `to`. Later rules win where they overlap. */
export async function addSeasonalPrice(ctx: Ctx, input: Record<string, unknown>, actor: string): Promise<SeasonalPrice> {
  const roomId = String(input.roomId ?? '');
  if (!isRoomId(roomId)) throw new HttpError(400, 'Choose a room.', 'INVALID_INPUT', 'roomId');
  const from = String(input.from ?? '');
  const to = String(input.to ?? '');
  if (parseISODate(from) === null) throw new HttpError(400, 'Choose the first night.', 'INVALID_INPUT', 'from');
  if (parseISODate(to) === null || to < from) throw new HttpError(400, 'The last night must be on or after the first night.', 'INVALID_INPUT', 'to');
  const pricePaise = Math.round(Number(input.price) * 100);
  if (!Number.isInteger(pricePaise) || pricePaise < 100 || pricePaise > 10_000_000) throw new HttpError(400, 'Enter a nightly price between ₹1 and ₹1,00,000.', 'INVALID_PRICE', 'price');
  const label = String(input.label ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const row = { room_id: roomId, from, to, price_paise: pricePaise, label, created_at: iso(ctx) };
  const id = String(await ctx.db.insert('seasonal_prices', row));
  await audit(ctx, actor, 'price.seasonal_added', null, { room: roomId, from, to, pricePaise, label });
  return { id, ...row } as SeasonalPrice;
}

export async function deleteSeasonalPrice(ctx: Ctx, id: string, actor: string) {
  const row = await ctx.db.get<SeasonalPrice>('seasonal_prices', id);
  if (!row) throw new HttpError(404, 'That seasonal price no longer exists.', 'NOT_FOUND');
  await ctx.db.delete('seasonal_prices', id);
  await audit(ctx, actor, 'price.seasonal_removed', null, { room: row.room_id, from: row.from, to: row.to, pricePaise: row.price_paise });
}
