// "Something changed" markers for the admin's live refresh.
//
// Serverless functions can't hold a live connection open to every admin
// screen, so each change stamps a tiny document (meta/changes-bookings or
// meta/changes-requests) and open admin screens check the stamps every few
// seconds (GET /api/admin/changes, two document reads). When a stamp moves,
// the screen refetches.

import type { Ctx } from './bookings.ts';
import { inBackground } from './background.ts';

export type ChangeTopic = 'bookings' | 'requests';

const queued = new WeakMap<object, Set<ChangeTopic>>();

/** Records a change (coalesced: many changes in one tick → one write per topic). */
export function markChanged(ctx: Ctx, topic: ChangeTopic) {
  const set = queued.get(ctx.db) ?? new Set<ChangeTopic>();
  queued.set(ctx.db, set);
  if (set.has(topic)) return;
  set.add(topic);
  queueMicrotask(() => {
    set.delete(topic);
    inBackground(`change ${topic}`, () => ctx.db.set('meta', `changes-${topic}`, { at: new Date().toISOString() }));
  });
}

export async function readChanges(ctx: Ctx): Promise<Record<ChangeTopic, string>> {
  const docs = await ctx.db.getMany<{ at: string }>('meta', ['changes-bookings', 'changes-requests']);
  return { bookings: docs.get('changes-bookings')?.at ?? '', requests: docs.get('changes-requests')?.at ?? '' };
}
