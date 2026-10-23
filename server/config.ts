// Server configuration, read from environment variables (see .env.example).
import crypto from 'node:crypto';
import { siteOrigin } from '../shared/domain.ts';
// Secrets live ONLY here — nothing in this file is sent to the browser except
// the fields explicitly copied into PublicConfig by the API.

export type PhonePeEnv = 'sandbox' | 'production';

export type Config = {
  nodeEnv: string;
  port: number;
  /** Public origin of the site, e.g. https://www.goldenstay.space — owner email links, PhonePe return URL. */
  siteUrl: string;
  trustProxy: boolean;
  holdMinutes: number;
  /** emails: Firebase accounts allowed into /admin (verified email required). */
  admin: { passwordHash: string; sessionHours: number; emails: string[] };
  /** payload: the shop QR's exact contents; amount links add only am/cu/tn to it. */
  qr: { upiId: string; payeeLabel: string; imageUrl: string; payload: string };
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
    /**
     * EmailJS (emailjs.com) for guest emails, called from the server. The
     * private key is a secret: server settings only, never the website code.
     */
    emailjs: { serviceId: string; templateId: string; publicKey: string; privateKey: string; apiUrl: string };
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

/** Contents of the owner's PhonePe shop QR (public/images/phonepe-merchant-qr.jpg). */
const SHOP_QR = 'upi://pay?pa=Q089453569@ybl&pn=PhonePeMerchant&mc=0000&mode=02&purpose=00';

/**
 * The UPI payee. MERCHANT_UPI_QR = the text inside a shop QR (scan it with any
 * QR reader); MERCHANT_UPI_ID alone (e.g. a personal UPI ID) is also accepted.
 */
function merchantQr(): { upiId: string; payload: string } {
  const id = env('MERCHANT_UPI_ID');
  let payload = env('MERCHANT_UPI_QR') || (id && !SHOP_QR.includes(`pa=${id}&`) ?`upi://pay?pa=${id}&pn=${encodeURIComponent(env('MERCHANT_PAYEE_LABEL', 'Golden Stay'))}` : SHOP_QR);
  if (!/^upi:\/\/pay\?/i.test(payload)) throw new Error('MERCHANT_UPI_QR must be the text of a UPI QR (starting with upi://pay?).');
  // Drop anything the booking sets itself.
  const q = new URLSearchParams(payload.slice(payload.indexOf('?') + 1));
  for (const k of ['am', 'cu', 'tn', 'tr', 'tid']) q.delete(k);
  const upiId = q.get('pa') ?? '';
  if (!/^[\w.-]+@[\w.-]+$/.test(upiId)) throw new Error('The UPI QR has no valid UPI ID (pa=…).');
  payload = `upi://pay?${q.toString().replace(/\+/g, '%20').replace(/%40/g, '@')}`;
  return { upiId, payload };
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

  // Owner email links and PhonePe's return URL use the real site address in production
  // (https://www.goldenstay.space, or SITE_URL when it is an https:// address).
  const rawSiteUrl = env('SITE_URL');
  let siteUrl: string;
  if (nodeEnv === 'production') {
    siteUrl = siteOrigin(rawSiteUrl);
    if (rawSiteUrl && siteUrl !== rawSiteUrl.replace(/\/$/, '')) console.warn(`[config] SITE_URL "${rawSiteUrl}" is not an https:// address — using ${siteUrl}.`);
  } else {
    siteUrl = (rawSiteUrl || `http://localhost:${env('PORT', '8787')}`).replace(/\/$/, '');
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
      ...merchantQr(),
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
      emailjs: {
        serviceId: env('EMAILJS_SERVICE_ID'),
        templateId: env('EMAILJS_TEMPLATE_ID'),
        publicKey: env('EMAILJS_PUBLIC_KEY'),
        privateKey: env('EMAILJS_PRIVATE_KEY'),
        apiUrl: 'https://api.emailjs.com/api/v1.0/email/send',
      },
    },
  };
}
