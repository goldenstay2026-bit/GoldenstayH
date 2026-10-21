// Firestore security-rules tests. Run with the emulator:  npm run test:rules
// (firebase emulators:exec starts a local Firestore and sets FIRESTORE_EMULATOR_HOST.)

import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import fs from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';

let env: RulesTestEnvironment;

before(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8085').split(':');
  env = await initializeTestEnvironment({
    projectId: 'demo-goldenstay',
    firestore: { rules: fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host, port: Number(port) },
  });
});
after(() => env.cleanup());
beforeEach(() => env.clearFirestore());

const riya = () => env.authenticatedContext('riya', { email: 'riya@example.com' }).firestore();
const amit = () => env.authenticatedContext('amit', { email: 'amit@example.com' }).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const profile = (over: Record<string, unknown> = {}) => ({
  name: 'Riya Sharma',
  phone: '9876543210',
  email: 'riya@example.com',
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...over,
});

describe('users/{uid} profile', () => {
  test('a guest can create and read their own profile', async () => {
    await assertSucceeds(setDoc(doc(riya(), 'users/riya'), profile()));
    await assertSucceeds(getDoc(doc(riya(), 'users/riya')));
  });

  test('a guest can update their profile but not change createdAt', async () => {
    await setDoc(doc(riya(), 'users/riya'), profile());
    await assertSucceeds(updateDoc(doc(riya(), 'users/riya'), { name: 'Riya S', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(riya(), 'users/riya'), { createdAt: new Date(2000, 0, 1), updatedAt: serverTimestamp() }));
  });

  test('nobody can read or write another guest’s profile', async () => {
    await setDoc(doc(riya(), 'users/riya'), profile());
    await assertFails(getDoc(doc(amit(), 'users/riya')));
    await assertFails(setDoc(doc(amit(), 'users/riya'), profile()));
    await assertFails(getDoc(doc(anon(), 'users/riya')));
    await assertFails(getDocs(collection(riya(), 'users')));
  });

  test('profiles are validated', async () => {
    const bad = [
      { phone: '12345' },
      { phone: '+919876543210' },
      { name: 'R' },
      { name: 'x'.repeat(81) },
      { email: 'someone-else@example.com' },
      { role: 'admin' },
      { updatedAt: new Date(2000, 0, 1) },
    ];
    for (const over of bad) await assertFails(setDoc(doc(riya(), 'users/riya'), profile(over)));
  });

  test('profiles cannot be deleted from the browser', async () => {
    await setDoc(doc(riya(), 'users/riya'), profile());
    await assertFails(deleteDoc(doc(riya(), 'users/riya')));
  });
});

describe('users/{uid}/bookings/{ref} (server-written copies)', () => {
  beforeEach(() =>
    env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/riya/bookings/GSABC234'), { ref: 'GSABC234', status: 'pending_payment', totalPaise: 319800 });
    }),
  );

  test('the guest can read their own booking copies', async () => {
    await assertSucceeds(getDoc(doc(riya(), 'users/riya/bookings/GSABC234')));
    await assertSucceeds(getDocs(collection(riya(), 'users/riya/bookings')));
  });

  test('the guest cannot change a booking copy (e.g. mark it confirmed)', async () => {
    await assertFails(setDoc(doc(riya(), 'users/riya/bookings/GSABC234'), { status: 'confirmed' }, { merge: true }));
    await assertFails(setDoc(doc(riya(), 'users/riya/bookings/GSNEW999'), { status: 'confirmed' }));
    await assertFails(deleteDoc(doc(riya(), 'users/riya/bookings/GSABC234')));
  });

  test('other guests and signed-out visitors cannot read them', async () => {
    await assertFails(getDoc(doc(amit(), 'users/riya/bookings/GSABC234')));
    await assertFails(getDocs(collection(amit(), 'users/riya/bookings')));
    await assertFails(getDoc(doc(anon(), 'users/riya/bookings/GSABC234')));
  });
});

describe('everything else', () => {
  test('any other collection is closed', async () => {
    await assertFails(setDoc(doc(riya(), 'bookings/GSABC234'), { status: 'confirmed' }));
    await assertFails(getDoc(doc(riya(), 'rooms/ac-1bhk')));
  });

  test('the server collections (bookings, payments, guest details …) are closed to every browser', async () => {
    const server = ['bookings/1', 'booking_nights/ac_2026-11-22', 'payments/1', 'refunds/1', 'booking_requests/1', 'audit_log/x', 'admin_sessions/x', 'counters/bookings', 'meta/changes-bookings', 'webhook_events/x'];
    // Seed real documents (as the server would), then try them from the browser.
    await env.withSecurityRulesDisabled(async (c) => {
      for (const path of server) await setDoc(doc(c.firestore(), path), { guest_name: 'Arjun Das', guest_phone: '9864012345' });
    });
    for (const db of [riya(), anon()]) {
      for (const path of server) {
        await assertFails(getDoc(doc(db, path)));
        await assertFails(setDoc(doc(db, path), { status: 'confirmed' }));
      }
      await assertFails(getDocs(collection(db, 'bookings')));
      await assertFails(getDocs(collection(db, 'booking_requests')));
    }
  });
});
