// Runs the API server (port 8787, auto-restart) and the Vite dev server (5173) together.
import { spawn } from 'node:child_process';

const run = (script) => spawn('npm', ['run', script], { stdio: 'inherit', shell: true });
const procs = [run('dev:api'), run('dev:web')];
const stop = () => procs.forEach((p) => p.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', (code) => code && stop()));
