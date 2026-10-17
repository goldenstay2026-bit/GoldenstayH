// Local development against the Firebase Emulator Suite — no real Firebase
// project is touched. Starts: Auth + Firestore emulators (UI at
// http://127.0.0.1:4000), the API on :8787 and the site on :5173.
import { spawn, spawnSync } from 'node:child_process';

const emulatorEnv = {
  FIREBASE_PROJECT_ID: 'demo-goldenstay',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085',
  DATABASE_PATH: 'data/dev-emulators.db',
  SITE_URL: 'http://localhost:5173',
};
const run = (cmd, env = {}) => spawn(cmd, { stdio: 'inherit', shell: true, env: { ...process.env, ...env } });

const procs = [
  run('npx firebase emulators:start --only auth,firestore --project demo-goldenstay'),
  run('node --watch --env-file-if-exists=.env --disable-warning=ExperimentalWarning server/index.ts', emulatorEnv),
  run('npx vite', { VITE_FIREBASE_EMULATORS: 'true' }),
];
const stop = () => {
  if (process.platform === 'win32') {
    // On Windows, kill each whole process tree (npx/shell → node --watch → server, emulator → java).
    for (const p of procs) if (p.pid) spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    procs.forEach((p) => p.kill());
  }
  if (process.platform === 'win32') {
    spawnSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"Name='java.exe'\" | Where-Object { $_.CommandLine -like '*cloud-firestore-emulator*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"], { stdio: 'ignore' });
  }
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
