// Firebase in the browser: Authentication (email + password) and Firestore
// (guest profiles, read-only copies of their bookings).
//
// The config values are PUBLIC by design — they identify the project. Access
// is controlled by Firebase Auth and firestore.rules, not by hiding these.
// Loaded only on pages that need sign-in (checkout, booking, account), never
// on the homepage, so the main site stays light.

import { initializeApp, type FirebaseApp } from 'firebase/app';
import { browserLocalPersistence, connectAuthEmulator, indexedDBLocalPersistence, initializeAuth, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore/lite';

const env = import.meta.env;

const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

/** False when the VITE_FIREBASE_* values are missing (sign-in then shows a friendly notice). */
export const firebaseConfigured = Boolean(config.apiKey && config.projectId && config.appId);
const useEmulators = env.VITE_FIREBASE_EMULATORS === 'true';

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

function init() {
  if (app || !firebaseConfigured) return;
  app = initializeApp(useEmulators ? { ...config, projectId: 'demo-goldenstay' } : config);
  // Email/password only: no popup/redirect resolver, which keeps the bundle small.
  auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  db = getFirestore(app);
  if (useEmulators) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8085);
  }
}

export function getFirebaseAuth(): Auth | null {
  init();
  return auth;
}

export function getDb(): Firestore | null {
  init();
  return db;
}
