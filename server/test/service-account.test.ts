// The service-account key as pasted into Vercel: accepted forms, and error
// messages that never repeat any of the pasted value.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseServiceAccount } from '../firebase.ts';

const KEY = {
  type: 'service_account',
  project_id: 'demo-key',
  client_email: 'sa@demo-key.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nZmFrZQ==\n-----END PRIVATE KEY-----\n',
};
const json = JSON.stringify(KEY, null, 2);
const b64 = Buffer.from(json).toString('base64');

test('accepts the key file, its base64, and common paste slips', () => {
  for (const pasted of [json, b64, `  ${b64}\n`, `"${b64}"`, `'${json}'`, `FIREBASE_SERVICE_ACCOUNT=${b64}`, b64.replace(/(.{60})/g, '$1\n')]) {
    const sa = parseServiceAccount(pasted);
    assert.equal(sa.projectId, 'demo-key');
    assert.equal(sa.clientEmail, KEY.client_email);
  }
});

test('explains what is wrong without echoing the value', () => {
  const cases: [string, RegExp][] = [
    [KEY.private_key, /only the private key/],
    ['C:/Users/someone/Downloads/key.json', /neither the key file/],
    [Buffer.from('not a key at all').toString('base64'), /looks like base64/],
    [json.slice(0, 120), /cut off/],
    [JSON.stringify({ hello: 'world' }), /not a service-account key/],
  ];
  for (const [pasted, why] of cases) {
    assert.throws(
      () => parseServiceAccount(pasted),
      (e: Error) => why.test(e.message) && !e.message.includes(pasted.slice(0, 12)),
    );
  }
});
