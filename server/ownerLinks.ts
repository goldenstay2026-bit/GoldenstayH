// Signed, expiring links for the owner's "Review & confirm booking" email.
// A link names one QR payment; it can only confirm or reject that payment,
// and only while it is still waiting for verification (so it works once).

import crypto from 'node:crypto';

const LINK_DAYS = 7;

const sign = (secret: string, data: string) => crypto.createHmac('sha256', secret).update(data).digest('base64url');

export function createOwnerLinkToken(secret: string, paymentId: number, nowMs: number): string {
  const exp = nowMs + LINK_DAYS * 86_400_000;
  const data = `${paymentId}.${exp}`;
  return `${data}.${sign(secret, `owner-verify:${data}`)}`;
}

export type OwnerLinkCheck = { ok: true; paymentId: number } | { ok: false; reason: 'invalid' | 'expired' };

export function verifyOwnerLinkToken(secret: string, token: string, nowMs: number): OwnerLinkCheck {
  const m = /^(\d+)\.(\d+)\.([A-Za-z0-9_-]+)$/.exec(token);
  if (!m) return { ok: false, reason: 'invalid' };
  const expected = Buffer.from(sign(secret, `owner-verify:${m[1]}.${m[2]}`));
  const given = Buffer.from(m[3]);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return { ok: false, reason: 'invalid' };
  if (Number(m[2]) < nowMs) return { ok: false, reason: 'expired' };
  return { ok: true, paymentId: Number(m[1]) };
}
