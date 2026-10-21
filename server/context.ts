// Builds the server context (config + database + Firebase + PhonePe) from
// environment variables. Shared by the long-running server (index.ts) and
// the Vercel function (vercel.ts).

import type { Ctx } from './bookings.ts';
import { loadConfig } from './config.ts';
import { createFirebase, createStore } from './firebase.ts';
import { createPhonePeClient } from './phonepe.ts';

export function createContext(): Ctx {
  const config = loadConfig();
  return {
    db: createStore(config.firebase),
    config,
    phonepe: config.phonepe.enabled ? createPhonePeClient(config.phonepe, config.nodeEnv) : null,
    now: () => new Date(),
    firebase: createFirebase(config.firebase),
  };
}
