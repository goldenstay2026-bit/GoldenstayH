import type { NextFunction, Request, Response } from 'express';

/** An error whose message is safe to show to the user. */
export class HttpError extends Error {
  status: number;
  code: string;
  field?: string;
  constructor(status: number, message: string, code = 'ERROR', field?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

/** Wraps async route handlers so rejections reach the error middleware. */
export const route =
  (fn: (req: Request, res: Response) => unknown) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message, code: err.code, field: err.field });
    return;
  }
  const status = (err as { status?: number; type?: string }).status;
  if (status === 400 || status === 413) {
    res.status(status).json({ error: 'Invalid request.', code: 'BAD_REQUEST' });
    return;
  }
  // Never leak internals (stack traces, upstream responses) to clients.
  console.error('[error]', err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.', code: 'INTERNAL' });
}

/** Simple fixed-window rate limiter keyed by IP + bucket. In-memory: fine for one server process. */
export function rateLimit(bucket: string, max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${bucket}:${req.ip}`;
    const now = Date.now();
    const h = hits.get(key);
    if (!h || now > h.reset) {
      hits.set(key, { n: 1, reset: now + windowMs });
      if (hits.size > 10_000) for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
      return next();
    }
    if (++h.n > max) {
      res.setHeader('Retry-After', String(Math.ceil((h.reset - now) / 1000)));
      res.status(429).json({ error: 'Too many attempts. Please wait a minute and try again.', code: 'RATE_LIMITED' });
      return;
    }
    next();
  };
}
