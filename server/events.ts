// Live updates for the admin (Server-Sent Events). When bookings or requests
// change, every open admin screen gets a tiny "changed" event and refetches —
// so the Calendar and Requests update without a page refresh.

import type { Response } from 'express';

export type ChangeTopic = 'bookings' | 'requests';

const clients = new Set<Response>();
const queued = new Set<ChangeTopic>();

/** Registers an admin client stream. Returns a cleanup function. */
export function addEventClient(res: Response): () => void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    // no-transform keeps the compression middleware from buffering the stream
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 5000\n\n');
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  ping.unref();
  return () => {
    clearInterval(ping);
    clients.delete(res);
  };
}

/** Announces a change (coalesced: many changes in one tick → one event per topic). */
export function emitChange(topic: ChangeTopic) {
  if (queued.has(topic)) return;
  queued.add(topic);
  queueMicrotask(() => {
    queued.delete(topic);
    for (const res of clients) res.write(`event: change\ndata: ${JSON.stringify({ topic })}\n\n`);
  });
}

export const eventClientCount = () => clients.size;
