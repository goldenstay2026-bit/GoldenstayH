// Runs the server tests against the Firestore emulator (never the real database).
// Each test file uses its own empty emulator project. On Windows the emulator's
// Java process can outlive `emulators:exec`, so it is stopped afterwards.
import { spawnSync } from 'node:child_process';

const files = process.argv.slice(2).join(' ') || '"server/test/**/*.test.ts"';
const r = spawnSync(
  'npx',
  ['firebase', 'emulators:exec', '--only', 'firestore', '--project', 'demo-goldenstay', `"node --disable-warning=ExperimentalWarning --test ${files.replace(/"/g, '\\"')}"`],
  { stdio: 'inherit', shell: true },
);

if (process.platform === 'win32') {
  spawnSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='java.exe'\" | Where-Object { $_.CommandLine -like '*cloud-firestore-emulator*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }",
    ],
    { stdio: 'ignore' },
  );
}
process.exit(r.status ?? 1);
