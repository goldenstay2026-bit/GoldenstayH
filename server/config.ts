// Server configuration, read from environment variables (see .env.example).
import crypto from 'node:crypto';
// Secrets live ONLY here — nothing in this file is sent to the browser except
// the fields explicitly copied into PublicConfig by the API.

export type PhonePeEnv = 'sandbox' | 'production';

export type Config = {
  nodeEnv: string;
  port: number;
  /** Public origin of the site, e.g. https://goldenstay.in — used for PhonePe redirect URLs. */
  siteUrl: string;
  trustProxy: boolean;
  holdMinutes: number;
  /** emails: Firebase accounts allowed into /admin (verified email required). */
  admin: { passwordHash: string; sessionHours: number; emails: string[] };
  qr: { upiId: string; payeeLabel: string; imageUrl: string };
  phonepe: {
    enabled: boolean;
    env: PhonePeEnv;
    clientId: string;
    clientSecret: string;
    clientVersion: string;
    webhookUsername: string;
    webhookPassword: string;
    /** Seconds until a PhonePe order expires (PhonePe allows 300–3600). */
    orderExpirySeconds: number;
    /** Test-only override of the PhonePe hosts; refused in production. */
    apiBaseOverride?: { auth: string; pg: string };
  };
  /** Signs the owner's "Review & confirm booking" email links (SECRET). */
  ownerLinkSecret: string;
  /**
   * Firebase project: guest + owner sign-in (Auth) and the database (Firestore).
   * serviceAccount = the service-account key JSON (or base64 of it) — SECRET;
   * serviceAccountFile = a path to that JSON file (alternative to serviceAccount).
   */
  firebase: { projectId: string; serviceAccount: string; serviceAccountFile: string };
  /** Owner notifications for website enquiries (and QR payment alerts). */
  notify: {
    telegramBotToken: string;
    telegramChatId: string;
    sheetsWebhookUrl: string;
    sheetsSecret: string;
    /** Test-only override of https://api.telegram.org; refused in production. */
    telegramApiBase?: string;
  };
};

const env = (k: string, d = '') => (process.env[k] ?? d).trim();

function ownerLinkSecret(nodeEnv: string): string {
  const v = env('OWNER_LINK_SECRET');
  if (v.length >= 32) return v;
  if (nodeEnv === 'production') throw new Error('OWNER_LINK_SECRET (32+ random characters) is required in production.');
  console.warn('[config] OWNER_LINK_SECRET not set — using a temporary one; owner email links stop working after a restart.');
  return crypto.randomBytes(32).toString('hex');
}

export function loadConfig(): Config {
  const nodeEnv = env('NODE_ENV', 'development');
  const phonepeEnv = env('PHONEPE_ENV', 'sandbox') === 'production' ? 'production' : 'sandbox';

  const phonepe = {
    clientId: env('PHONEPE_CLIENT_ID'),
    clientSecret: env('PHONEPE_CLIENT_SECRET'),
    clientVersion: env('PHONEPE_CLIENT_VERSION', '1'),
    webhookUsername: env('PHONEPE_WEBHOOK_USERNAME'),
    webhookPassword: env('PHONEPE_WEBHOOK_PASSWORD'),
  };
  const credsPresent = Boolean(
    phonepe.clientId && phonepe.clientSecret && phonepe.webhookUsername && phonepe.webhookPassword,
  );
  const wantEnabled = env('PHONEPE_ENABLED', 'false') === 'true';
  if (wantEnabled && !credsPresent) {
    console.warn('[config] PHONEPE_ENABLED=true but credentials are incomplete — gateway stays OFF.');
  }

  // On Vercel, fall back to the project's production domain when SITE_URL isn't set.
  const vercelUrl = env('VERCEL_PROJECT_PRODUCTION_URL') ? `https://${env('VERCEL_PROJECT_PRODUCTION_URL')}` : '';
  const siteUrl = env('SITE_URL', vercelUrl || `http://localhost:${env('PORT', '8787')}`).replace(/\/$/, '');
  if (nodeEnv === 'production' && !siteUrl.startsWith('https://')) {
    throw new Error('SITE_URL must be an https:// URL in production.');
  }
  // Optional: the owner normally signs in with Firebase (ADMIN_EMAILS); this is the backup password.
  const passwordHash = env('ADMIN_PASSWORD_HASH');

  return {
    nodeEnv,
    port: Number(env('PORT', '8787')),
    siteUrl,
    trustProxy: env('TRUST_PROXY', process.env.VERCEL ? 'true' : 'false') === 'true',
    holdMinutes: Math.max(10, Number(env('BOOKING_HOLD_MINUTES', '30'))),
    admin: {
      passwordHash,
      sessionHours: 12,
      emails: env('ADMIN_EMAILS', 'goldenstay2026@gmail.com')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    },
    qr: {
      // From the owner's PhonePe merchant QR (upi://pay?pa=Q089453569@ybl…).
      upiId: env('MERCHANT_UPI_ID', 'Q089453569@ybl'),
      payeeLabel: env('MERCHANT_PAYEE_LABEL', 'P.S'),
      imageUrl: '/images/phonepe-merchant-qr.jpg',
    },
    phonepe: {
      ...phonepe,
      enabled: wantEnabled && credsPresent,
      env: phonepeEnv,
      orderExpirySeconds: 900,
    },
    ownerLinkSecret: ownerLinkSecret(nodeEnv),
    firebase: {
      projectId: env('FIREBASE_PROJECT_ID'),
      serviceAccount: env('FIREBASE_SERVICE_ACCOUNT'),
      serviceAccountFile: env('FIREBASE_SERVICE_ACCOUNT_FILE'),
    },
    notify: {
      telegramBotToken: env('TELEGRAM_BOT_TOKEN'),
      telegramChatId: env('TELEGRAM_CHAT_ID'),
      sheetsWebhookUrl: env('SHEETS_WEBHOOK_URL'),
      sheetsSecret: env('SHEETS_SECRET'),
    },
  };
}
