import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  createUserWithEmailAndPassword,
  onIdTokenChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore/lite';
import { firebaseConfigured, getDb, getFirebaseAuth } from './firebase';

/** Guest profile stored in Firestore at users/{uid} (see firestore.rules). */
export type Profile = { name: string; phone: string };

type AuthState = {
  /** false until Firebase has told us whether someone is signed in */
  ready: boolean;
  configured: boolean;
  user: User | null;
  profile: Profile | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: { name: string; email: string; password: string }) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  /** Fresh Firebase ID token for API calls (null when signed out). */
  idToken: () => Promise<string | null>;
  saveProfile: (p: Profile) => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

async function loadProfile(uid: string): Promise<Profile | null> {
  const db = getDb();
  if (!db) return null;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    const d = snap.data();
    return d && typeof d.name === 'string' && typeof d.phone === 'string' ? { name: d.name, phone: d.phone } : null;
  } catch {
    return null; // e.g. rules not deployed yet — profile is optional
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!firebaseConfigured);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    const auth = getFirebaseAuth();
    if (!auth) return;
    return onIdTokenChanged(auth, async (u) => {
      setUser(u);
      const loaded = u ? await loadProfile(u.uid) : null;
      // Keep a just-entered sign-up name if there's no saved profile yet.
      setProfile((prev) => (u ? (loaded ?? (prev?.name ? prev : null)) : null));
      setReady(true);
    });
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const auth = getFirebaseAuth();
    if (!auth) throw new Error('auth/not-configured');
    await signInWithEmailAndPassword(auth, email.trim(), password);
  }, []);

  const signUp = useCallback(async ({ name, email, password }: { name: string; email: string; password: string }) => {
    const auth = getFirebaseAuth();
    if (!auth) throw new Error('auth/not-configured');
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
    await updateProfile(cred.user, { displayName: name.trim() });
    // Firebase announces the new user before displayName is set; hand the name to the UI directly.
    setProfile((p) => p ?? { name: name.trim(), phone: '' });
    // Verification email is a courtesy; booking doesn't wait for it.
    sendEmailVerification(cred.user).catch(() => undefined);
  }, []);

  const signOut = useCallback(async () => {
    const auth = getFirebaseAuth();
    if (auth) await fbSignOut(auth);
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    const auth = getFirebaseAuth();
    if (!auth) throw new Error('auth/not-configured');
    await sendPasswordResetEmail(auth, email.trim());
  }, []);

  const idToken = useCallback(async () => (user ? user.getIdToken() : null), [user]);

  const saveProfile = useCallback(
    async (p: Profile) => {
      const db = getDb();
      if (!db || !user) return;
      const ref = doc(db, 'users', user.uid);
      const exists = (await getDoc(ref).catch(() => null))?.exists() ?? false;
      await setDoc(
        ref,
        {
          name: p.name.trim(),
          phone: p.phone,
          ...(user.email ? { email: user.email } : {}),
          updatedAt: serverTimestamp(),
          ...(exists ? {} : { createdAt: serverTimestamp() }),
        },
        { merge: true },
      );
      setProfile({ name: p.name.trim(), phone: p.phone });
    },
    [user],
  );

  const value = useMemo<AuthState>(
    () => ({ ready, configured: firebaseConfigured, user, profile, signIn, signUp, signOut, resetPassword, idToken, saveProfile }),
    [ready, user, profile, signIn, signUp, signOut, resetPassword, idToken, saveProfile],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth must be used inside <AuthProvider>');
  return c;
}

/** Plain-English messages for Firebase Auth error codes. */
export function authErrorMessage(e: unknown): string {
  const code = (e as { code?: string; message?: string })?.code ?? (e as Error)?.message ?? '';
  const map: Record<string, string> = {
    'auth/invalid-credential': 'That email and password don’t match. Please try again.',
    'auth/wrong-password': 'That email and password don’t match. Please try again.',
    'auth/user-not-found': 'No account with that email. Create one below.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/email-already-in-use': 'An account with this email already exists. Sign in instead.',
    'auth/weak-password': 'Please choose a password with at least 6 characters.',
    'auth/missing-password': 'Please enter your password.',
    'auth/too-many-requests': 'Too many attempts. Please wait a few minutes and try again.',
    'auth/network-request-failed': 'Can’t reach the sign-in service. Check your connection and try again.',
    'auth/operation-not-allowed': 'Email sign-in isn’t enabled yet for this site. Please enquire on WhatsApp.',
    'auth/not-configured': 'Sign-in isn’t set up yet for this site. Please enquire on WhatsApp.',
  };
  return map[code] ?? 'Something went wrong signing in. Please try again.';
}
