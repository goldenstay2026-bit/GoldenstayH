// Local development: the API server (port 8787, auto-restart) and the Vite dev server (5173).
//
// The database is Firestore. Without a service-account key in .env
// (FIREBASE_SERVICE_ACCOUNT / FIREBASE_SERVICE_ACCOUNT_FILE) this also starts the
// Firestore emulator, so development never touches the real bookings. Emulator
// data is kept in data/firestore-emulator between runs. Sign-in still uses the
// real Firebase Auth project from .env.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';

const env = fs.existsSync('.env')
  ? Object.fromEntries(
      fs
        .readFileSync('.env', 'utf8')
        .split(/\r?\n/)
        .filter((l) => /^[A-Z0-9_]+=/.test(l))
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
    )
  : {};
const realDb = Boolean(process.env.FIREBASE_SERVICE_ACCOUNT || env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_FILE || env.FIREBASE_SERVICE_ACCOUNT_FILE);
const project = env.FIREBASE_PROJECT_ID || 'demo-goldenstay';

const run = (cmd, extraEnv = {}) => spawn(cmd, { stdio: 'inherit', shell: true, env: { ...process.env, ...extraEnv } });
const procs = [];
const apiEnv = {};
if (!realDb) {
  console.log('[dev] No service-account key in .env — using the Firestore emulator (data kept in data/firestore-emulator).');
  fs.mkdirSync('data/firestore-emulator', { recursive: true });
  procs.push(run(`npx firebase emulators:start --only firestore --project ${project} --import data/firestore-emulator --export-on-exit data/firestore-emulator`));
  apiEnv.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';
  // Give the emulator a moment before the API's first request.
  await new Promise((r) => setTimeout(r, 4000));
} else {
  console.log('[dev] Using the REAL Firestore database from FIREBASE_SERVICE_ACCOUNT.');
}
procs.push(run('npm run dev:api', apiEnv), run('npm run dev:web'));

const stop = () => {
  if (process.platform === 'win32') {
    for (const p of procs) if (p.pid) spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
  } else procs.forEach((p) => p.kill('SIGINT'));
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', (code) => code && stop()));
