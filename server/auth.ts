import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { iso, sha256, type Ctx } from './bookings.ts';
import { HttpError } from './http.ts';

// Password hashes look like: scrypt$<salt-hex>$<hash-hex>  (N=16384, r=8, p=1, 64-byte key)
const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

export const COOKIE = 'gs_admin';

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

type SessionRow = { token_hash: string; created_at: string; expires_at: string; ip: string | null };

export async function createSession(ctx: Ctx, req: Request, res: Response) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(ctx.now().getTime() + ctx.config.admin.sessionHours * 3_600_000);
  const old = await ctx.db.query<SessionRow>('admin_sessions', { where: [['expires_at', '<', iso(ctx)]] });
  for (const o of old) await ctx.db.delete('admin_sessions', o.token_hash);
  await ctx.db.set('admin_sessions', sha256(token), { token_hash: sha256(token), created_at: iso(ctx), expires_at: expires.toISOString(), ip: req.ip ?? null });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: ctx.config.nodeEnv === 'production',
    sameSite: 'strict',
    path: '/api/admin',
    expires,
  });
}

export async function destroySession(ctx: Ctx, req: Request, res: Response) {
  const token = readCookie(req, COOKIE);
  if (token) await ctx.db.delete('admin_sessions', sha256(token));
  res.clearCookie(COOKIE, { path: '/api/admin' });
}

export async function hasAdminSession(ctx: Ctx, req: Request): Promise<boolean> {
  const token = readCookie(req, COOKIE);
  const row = token ? await ctx.db.get<SessionRow>('admin_sessions', sha256(token)) : undefined;
  return row !== undefined && row.expires_at >= iso(ctx);
}

export type AdminIdentity = { via: 'session' } | { via: 'firebase'; uid: string; email: string };

const bearer = (req: Request) => /^Bearer\s+(.+)$/i.exec(req.get('authorization') ?? '')?.[1].trim();

/**
 * Who is using the admin, if anyone: a Firebase user whose VERIFIED email is
 * in ADMIN_EMAILS, or (legacy) the password session cookie. Throws 401/403
 * with a code the admin page turns into the right screen.
 */
export async function adminIdentity(ctx: Ctx, req: Request): Promise<AdminIdentity | null> {
  const token = bearer(req);
  if (token && ctx.firebase) {
    let id;
    try {
      id = await ctx.firebase.verifyIdToken(token);
    } catch {
      throw new HttpError(401, 'Your sign-in has expired. Please sign in again.', 'BAD_ID_TOKEN');
    }
    if (!id.email || !ctx.config.admin.emails.includes(id.email)) throw new HttpError(403, 'You don’t have access.', 'NOT_ADMIN');
    if (!id.emailVerified) throw new HttpError(403, 'Please verify your email address first.', 'EMAIL_NOT_VERIFIED');
    return { via: 'firebase', uid: id.uid, email: id.email };
  }
  return (await hasAdminSession(ctx, req)) ? { via: 'session' } : null;
}

/** Name recorded in the audit log for an admin action. */
export const adminActor = (req: Request) => {
  const who = (req as Request & { admin?: AdminIdentity }).admin;
  return who?.via === 'firebase' ? who.email : `admin@${req.ip}`;
};

/** Guards admin routes. Bearer tokens / SameSite=Strict cookies + JSON-only bodies protect against CSRF. */
export function requireAdmin(ctx: Ctx) {
  return (req: Request, _res: Response, next: NextFunction) => {
    adminIdentity(ctx, req).then(
      (who) => {
        if (!who) return next(new HttpError(401, 'Please sign in again.', 'UNAUTHENTICATED'));
        if (req.method !== 'GET' && !req.is('application/json')) return next(new HttpError(415, 'JSON required.', 'BAD_CONTENT_TYPE'));
        (req as Request & { admin?: AdminIdentity }).admin = who;
        next();
      },
      next,
    );
  };
}
