// PhonePe Payment Gateway — Standard Checkout (API v2) client.
//
// Implemented strictly from PhonePe's official developer docs
// (developer.phonepe.com → Payment Gateway → Website integration →
// Standard Checkout → API reference):
//   • Authorization   POST {auth}/v1/oauth/token               (form-encoded)
//   • Create payment  POST {pg}/checkout/v2/pay                 (O-Bearer token)
//   • Order status    GET  {pg}/checkout/v2/order/{id}/status
//   • Refund          POST {pg}/payments/v2/refund
//   • Refund status   GET  {pg}/payments/v2/refund/{id}/status
//   • Webhooks: Authorization header = SHA256(username:password)
//
// Credentials never leave the server. Responses are parsed leniently, as the
// docs advise, so new fields from PhonePe don't break the integration.

import crypto from 'node:crypto';
import type { Config } from './config.ts';

const HOSTS = {
  sandbox: {
    auth: 'https://api-preprod.phonepe.com/apis/pg-sandbox',
    pg: 'https://api-preprod.phonepe.com/apis/pg-sandbox',
  },
  production: {
    auth: 'https://api.phonepe.com/apis/identity-manager',
    pg: 'https://api.phonepe.com/apis/pg',
  },
} as const;

export type OrderState = 'PENDING' | 'FAILED' | 'COMPLETED';

export type OrderStatus = {
  orderId?: string;
  state: OrderState;
  amount: number;
  paymentDetails: Array<{
    transactionId?: string;
    paymentMode?: string;
    state?: string;
    amount?: number;
    timestamp?: number;
    errorCode?: string;
  }>;
  raw: unknown;
};

export class PhonePeError extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code = 'PHONEPE_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type PhonePeClient = ReturnType<typeof createPhonePeClient>;

export function createPhonePeClient(cfg: Config['phonepe'], nodeEnv: string) {
  if (cfg.apiBaseOverride && nodeEnv === 'production') {
    throw new Error('PhonePe API base override is test-only and refused in production.');
  }
  const hosts = cfg.apiBaseOverride ?? HOSTS[cfg.env];
  let cached: { token: string; expiresAtMs: number } | null = null;
  let inflight: Promise<string> | null = null;

  async function fetchToken(): Promise<string> {
    const body = new URLSearchParams({
      client_id: cfg.clientId,
      client_version: cfg.clientVersion,
      client_secret: cfg.clientSecret,
      grant_type: 'client_credentials',
    });
    const res = await fetch(`${hosts.auth}/v1/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || typeof json.access_token !== 'string') {
      throw new PhonePeError('PhonePe authorization failed', res.status, String(json.code ?? 'AUTH_FAILED'));
    }
    // expires_at is epoch seconds; refresh 2 minutes early.
    const expiresAt = typeof json.expires_at === 'number' ? json.expires_at * 1000 : Date.now() + 10 * 60_000;
    cached = { token: json.access_token, expiresAtMs: expiresAt - 120_000 };
    return cached.token;
  }

  async function token(): Promise<string> {
    if (cached && Date.now() < cached.expiresAtMs) return cached.token;
    inflight ??= fetchToken().finally(() => (inflight = null));
    return inflight;
  }

  async function call(method: 'GET' | 'POST', url: string, body?: unknown, retryAuth = true): Promise<Record<string, unknown>> {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `O-Bearer ${await token()}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401 && retryAuth) {
      cached = null;
      return call(method, url, body, false);
    }
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new PhonePeError(String(json.message ?? `PhonePe request failed (${res.status})`), res.status, String(json.code ?? 'REQUEST_FAILED'));
    }
    return json;
  }

  return {
    env: cfg.env,

    /** Creates a PG_CHECKOUT order. Amount is in paise and must come from the server's booking record. */
    async createPayment(input: { merchantOrderId: string; amountPaise: number; redirectUrl: string; bookingRef: string }) {
      if (!Number.isInteger(input.amountPaise) || input.amountPaise < 100) throw new Error('Invalid amount');
      const json = await call('POST', `${hosts.pg}/checkout/v2/pay`, {
        merchantOrderId: input.merchantOrderId,
        amount: input.amountPaise,
        expireAfter: cfg.orderExpirySeconds,
        metaInfo: { udf1: input.bookingRef },
        paymentFlow: {
          type: 'PG_CHECKOUT',
          message: `Golden Stay booking ${input.bookingRef}`,
          merchantUrls: { redirectUrl: input.redirectUrl },
        },
      });
      if (typeof json.redirectUrl !== 'string') throw new PhonePeError('PhonePe did not return a checkout URL', 502, 'NO_REDIRECT');
      return {
        orderId: typeof json.orderId === 'string' ? json.orderId : null,
        state: String(json.state ?? 'PENDING'),
        redirectUrl: json.redirectUrl,
        expireAt: typeof json.expireAt === 'number' ? json.expireAt : typeof json.expiryAt === 'number' ? json.expiryAt : null,
      };
    },

    /** Authoritative order state from PhonePe. */
    async orderStatus(merchantOrderId: string): Promise<OrderStatus> {
      const json = await call(
        'GET',
        `${hosts.pg}/checkout/v2/order/${encodeURIComponent(merchantOrderId)}/status?details=true&errorContext=true`,
      );
      const state = String(json.state);
      if (state !== 'PENDING' && state !== 'FAILED' && state !== 'COMPLETED') {
        throw new PhonePeError(`Unexpected order state: ${state}`, 502, 'BAD_STATE');
      }
      return {
        orderId: typeof json.orderId === 'string' ? json.orderId : undefined,
        state,
        amount: Number(json.amount),
        paymentDetails: Array.isArray(json.paymentDetails) ? (json.paymentDetails as OrderStatus['paymentDetails']) : [],
        raw: json,
      };
    },

    async refund(input: { merchantRefundId: string; originalMerchantOrderId: string; amountPaise: number }) {
      const json = await call('POST', `${hosts.pg}/payments/v2/refund`, {
        merchantRefundId: input.merchantRefundId,
        originalMerchantOrderId: input.originalMerchantOrderId,
        amount: input.amountPaise,
      });
      return { refundId: typeof json.refundId === 'string' ? json.refundId : null, state: String(json.state ?? 'PENDING') };
    },

    async refundStatus(merchantRefundId: string) {
      const json = await call('GET', `${hosts.pg}/payments/v2/refund/${encodeURIComponent(merchantRefundId)}/status`);
      return { state: String(json.state), raw: json };
    },

    /**
     * Webhook authentication: PhonePe sends Authorization = SHA256(username:password)
     * using the credentials configured in the PhonePe dashboard. Compared in
     * constant time. (The docs don't specify an encoding; we accept the hex
     * digest, optionally with a scheme prefix — confirm against a sandbox
     * webhook before go-live.)
     */
    verifyWebhookAuth(header: string | undefined): boolean {
      if (!header || !cfg.webhookUsername || !cfg.webhookPassword) return false;
      const value = header.trim().replace(/^(sha256|bearer|basic)\s+/i, '').toLowerCase();
      const expected = crypto.createHash('sha256').update(`${cfg.webhookUsername}:${cfg.webhookPassword}`).digest('hex');
      const a = Buffer.from(value);
      const b = Buffer.from(expected);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    },
  };
}
