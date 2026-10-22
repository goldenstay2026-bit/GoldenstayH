// Firebase on the server (Admin SDK).
//
// • Firestore is the database (bookings, payments, requests, audit log …).
// • Verifies guests' and the owner's Firebase Auth ID tokens.
// • Writes a read-only copy of each guest's bookings to users/{uid}/bookings/{ref}.
//
// The service-account key is a SECRET and never leaves the server. Locally and
// in tests, the Firestore emulator is used instead (FIRESTORE_EMULATOR_HOST).

import fs from 'node:fs';
import { cert, getApps, initializeApp, type App, type ServiceAccount } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { Config } from './config.ts';
import { Store } from './db.ts';

export type Identity = { uid: string; email: string; emailVerified: boolean };

export type FirebaseServices = {
  /** Verifies a Firebase ID token. Throws if invalid or expired. */
  verifyIdToken(idToken: string): Promise<Identity>;
  /** Writes the guest's read-only booking copy. */
  mirrorBooking?: (uid: string, ref: string, data: Record<string, unknown>) => Promise<void>;
};

const usingEmulator = () => Boolean(process.env.FIRESTORE_EMULATOR_HOST);

/** The service-account key from FIREBASE_SERVICE_ACCOUNT (JSON or base64 JSON) or FIREBASE_SERVICE_ACCOUNT_FILE. */
function serviceAccount(cfg: Config['firebase']): ServiceAccount | null {
  let raw = cfg.serviceAccount;
  if (!raw && cfg.serviceAccountFile) {
    if (!fs.existsSync(cfg.serviceAccountFile)) {
      throw new Error(
        `FIREBASE_SERVICE_ACCOUNT_FILE points to ${cfg.serviceAccountFile}, which isn't on this server. ` +
          'On Vercel, delete FIREBASE_SERVICE_ACCOUNT_FILE and set FIREBASE_SERVICE_ACCOUNT to the key itself.',
      );
    }
    raw = fs.readFileSync(cfg.serviceAccountFile, 'utf8');
  }
  if (!raw) return null;
  return parseServiceAccount(raw);
}

/**
 * The key as pasted into a hosting dashboard: the whole JSON file or its base64,
 * forgiving the usual paste slips (surrounding quotes, a leading "NAME=").
 * Errors describe the problem but never echo any of the value.
 */
export function parseServiceAccount(pasted: string): ServiceAccount {
  let raw = pasted.trim().replace(/^FIREBASE_SERVICE_ACCOUNT\s*=\s*/, '').trim();
  if (/^(['"]).*\1$/s.test(raw)) raw = raw.slice(1, -1).trim();
  if (raw.includes('BEGIN PRIVATE KEY') && !raw.includes('client_email')) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT holds only the private key; paste the whole key file (it starts with {"type": "service_account").');
  }
  if (!raw.startsWith('{')) {
    if (!/^[A-Za-z0-9+/=\s]+$/.test(raw)) throw new Error('FIREBASE_SERVICE_ACCOUNT is neither the key file (starting with {) nor its base64 copy; paste the whole key file.');
    raw = Buffer.from(raw.replace(/\s/g, ''), 'base64').toString('utf8').trim();
    if (!raw.startsWith('{')) throw new Error('FIREBASE_SERVICE_ACCOUNT looks like base64 but isn\'t the key file; paste the whole key file instead.');
  }
  let j: { type?: string; project_id?: string; client_email?: string; private_key?: string };
  try {
    j = JSON.parse(raw) as typeof j;
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT starts like the key file but is cut off or changed; copy the whole file again, from the first { to the last }.');
  }
  if (j.type !== 'service_account' || !j.client_email || !j.private_key?.includes('PRIVATE KEY')) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is JSON but not a service-account key; use the file from Firebase → Project settings → Service accounts.');
  }
  return { projectId: j.project_id, clientEmail: j.client_email, privateKey: j.private_key };
}

/** One Admin SDK app per project id (tests use a separate project per test file). */
export function firebaseApp(cfg: Config['firebase']): App {
  const name = `gs-${cfg.projectId}`;
  const existing = getApps().find((a) => a.name === name);
  if (existing) return existing;
  const sa = usingEmulator() ? null : serviceAccount(cfg);
  if (!sa && !usingEmulator()) {
    throw new Error(
      'Firestore needs a service-account key: set FIREBASE_SERVICE_ACCOUNT (Firebase console → Project settings → Service accounts → Generate new private key), ' +
        'or run with the Firestore emulator (npm run dev starts it).',
    );
  }
  return initializeApp({ projectId: cfg.projectId, ...(sa ? { credential: cert(sa) } : {}) }, name);
}

const firestores = new WeakMap<App, Firestore>();
function firestoreFor(app: App): Firestore {
  let db = firestores.get(app);
  if (!db) {
    db = getFirestore(app);
    // REST transport avoids gRPC start-up cost on serverless. (The emulator connection
    // needs the default transport — with REST the SDK asks for Google credentials.)
    db.settings({ ignoreUndefinedProperties: true, ...(usingEmulator() ? {} : { preferRest: true }) });
    firestores.set(app, db);
  }
  return db;
}

/** The database. */
export function createStore(cfg: Config['firebase']): Store {
  if (!cfg.projectId) throw new Error('FIREBASE_PROJECT_ID is required (the database is Firestore).');
  return new Store(firestoreFor(firebaseApp(cfg)));
}

export function createFirebase(cfg: Config['firebase']): FirebaseServices | null {
  if (!cfg.projectId) return null;
  const app = firebaseApp(cfg);
  const auth = getAuth(app);
  const db = firestoreFor(app);
  return {
    async verifyIdToken(idToken) {
      const t = await auth.verifyIdToken(idToken);
      return { uid: t.uid, email: (t.email ?? '').toLowerCase(), emailVerified: t.email_verified === true };
    },
    async mirrorBooking(uid, ref, data) {
      await db.collection('users').doc(uid).collection('bookings').doc(ref).set({ ...data, syncedAt: FieldValue.serverTimestamp() }, { merge: true });
    },
  };
}
