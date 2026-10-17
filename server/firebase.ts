// Firebase on the server (Admin SDK).
//
// • Verifies guests' Firebase Auth ID tokens (needs only the project ID —
//   Google's public signing keys are fetched automatically).
// • Writes a read-only copy of each guest's bookings to Firestore at
//   users/{uid}/bookings/{ref} (needs a service account, or the emulator).
//
// SQLite stays the source of truth for bookings and payments; Firestore holds
// user data. The service-account file is a SECRET and never leaves the server.

import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import type { Config } from './config.ts';

export type Identity = { uid: string; email: string; emailVerified: boolean };

export type FirebaseServices = {
  /** Verifies a Firebase ID token. Throws if invalid or expired. */
  verifyIdToken(idToken: string): Promise<Identity>;
  /** Present only when the server can write to Firestore. */
  mirrorBooking?: (uid: string, ref: string, data: Record<string, unknown>) => Promise<void>;
};

export function createFirebase(cfg: Config['firebase']): FirebaseServices | null {
  if (!cfg.projectId) return null;
  const usingEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST);

  const app: App =
    getApps()[0] ??
    initializeApp({
      projectId: cfg.projectId,
      ...(cfg.serviceAccountFile ? { credential: cert(cfg.serviceAccountFile) } : {}),
    });
  const auth = getAuth(app);
  const canWriteFirestore = Boolean(cfg.serviceAccountFile) || Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  const db = canWriteFirestore ? getFirestore(app) : null;

  if (!canWriteFirestore) {
    console.log('[firebase] No FIREBASE_SERVICE_ACCOUNT_FILE — sign-in checks ON, Firestore booking copies OFF.');
  }
  if (usingEmulator) console.log('[firebase] Using the Firebase Emulator Suite.');

  return {
    async verifyIdToken(idToken) {
      const t = await auth.verifyIdToken(idToken);
      return { uid: t.uid, email: (t.email ?? '').toLowerCase(), emailVerified: t.email_verified === true };
    },
    mirrorBooking: db
      ? async (uid, ref, data) => {
          await db
            .collection('users')
            .doc(uid)
            .collection('bookings')
            .doc(ref)
            .set({ ...data, syncedAt: FieldValue.serverTimestamp() }, { merge: true });
        }
      : undefined,
  };
}
