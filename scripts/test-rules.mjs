// Runs the Firestore security-rules tests against the Firestore emulator.
// On Windows the emulator's Java process can outlive `emulators:exec`, which
// then blocks the port next time — so we stop it afterwards (only processes
// whose command line is the Firestore emulator jar).
import { spawnSync } from 'node:child_process';

const r = spawnSync(
  'npx',
  ['firebase', 'emulators:exec', '--only', 'firestore', '--project', 'demo-goldenstay', '"node --test test/firestore-rules.test.ts"'],
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
