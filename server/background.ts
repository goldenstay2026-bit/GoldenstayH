// Tracks fire-and-forget work (owner emails, Sheet rows, Telegram messages)
// so shutdown and tests can wait for it to finish instead of guessing.
//
// On Vercel a function may be frozen as soon as the response is sent, so each
// task is also handed to waitUntil(), which keeps the function alive until
// the task finishes.

import { waitUntil } from '@vercel/functions';

let pending = 0;
const onVercel = Boolean(process.env.VERCEL);

/** Runs a background task; never throws, failures are logged. */
export function inBackground(label: string, task: () => Promise<unknown>): void {
  pending++;
  const p = Promise.resolve()
    .then(task)
    .catch((e) => console.error(`[background] ${label} failed:`, (e as Error)?.message ?? e))
    .finally(() => pending--);
  if (onVercel) waitUntil(p);
}

export const backgroundPending = () => pending;

/** Resolves once no background work is running (or after timeoutMs). */
export async function backgroundIdle(timeoutMs = 10_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  // Two quiet checks in a row: work started by finishing work is caught too.
  let quiet = 0;
  while (Date.now() < until && quiet < 2) {
    await new Promise((r) => setTimeout(r, 15));
    quiet = pending === 0 ? quiet + 1 : 0;
  }
}
