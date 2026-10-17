// Usage: npm run admin:hash   (prompts for the password; nothing is echoed or saved)
import readline from 'node:readline';
import { hashPassword } from './auth.ts';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
const mute = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
let muted = false;
mute._writeToOutput = (s: string) => {
  if (!muted) mute.output.write(s);
};
rl.question('New admin password (min 10 characters): ', (pw) => {
  muted = false;
  console.log('');
  rl.close();
  if (pw.length < 10) {
    console.error('Password must be at least 10 characters.');
    process.exit(1);
  }
  console.log('\nAdd this line to your server .env file:\n');
  console.log(`ADMIN_PASSWORD_HASH=${hashPassword(pw)}\n`);
});
muted = true;
