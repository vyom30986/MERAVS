#!/usr/bin/env node
// Generate the three secrets the Meravs admin login needs.
//
//   node tools/hash-password.mjs
//
// Prompts for an ID and a password (password masked), then prints the three
// values to paste into Cloudflare. The password itself is never printed,
// never written to disk and never leaves this machine - only a PBKDF2 hash
// of it, which cannot be reversed.
//
//   Workers & Pages -> meravs -> Settings -> Variables and Secrets
//     ADMIN_USERNAME      = your ID          (type: Secret)
//     ADMIN_PASSWORD_HASH = pbkdf2$...       (type: Secret)
//     SESSION_SECRET      = random string    (type: Secret)
//
// Then redeploy - secrets only take effect on a new deployment.

import { webcrypto as crypto } from 'node:crypto';
import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';

const ITERATIONS = 210_000; // OWASP's current PBKDF2-SHA256 guidance
const b64url = bytes => Buffer.from(bytes).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function ask(question, { mask = false } = {}) {
  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  const onData = () => {
    if (mask) rl.output.write('\x1B[2K\x1B[200D' + question + '*'.repeat(rl.line.length));
  };
  if (mask) stdin.on('data', onData);
  return new Promise(res => rl.question(question, a => {
    if (mask) { stdin.off('data', onData); stdout.write('\n'); }
    rl.close();
    res(a);
  }));
}

const username = (await ask('Choose an admin ID: ')).trim();
if (!username) {
  console.error('\nAn ID is required.\n');
  process.exit(1);
}

const password = (await ask('Choose an admin password: ', { mask: true })).trim();
if (password.length < 12) {
  console.error('\nToo short. Use at least 12 characters - this is what stands between');
  console.error('the internet and your prices. Four unrelated words is easier to');
  console.error('remember and much harder to crack than something like "Pa$$w0rd!".\n');
  process.exit(1);
}

const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey(
  'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
);
const bits = await crypto.subtle.deriveBits(
  { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256
);

console.log('\n' + '-'.repeat(64));
console.log('Add all three to Cloudflare Pages as encrypted Secrets, then redeploy.');
console.log('-'.repeat(64) + '\n');
console.log('ADMIN_USERNAME');
console.log(username + '\n');
console.log('ADMIN_PASSWORD_HASH');
console.log(`pbkdf2$${ITERATIONS}$${b64url(salt)}$${b64url(new Uint8Array(bits))}` + '\n');
console.log('SESSION_SECRET');
console.log(b64url(crypto.getRandomValues(new Uint8Array(32))) + '\n');
console.log('The password is not shown above and is not stored anywhere.');
console.log('If you forget it, run this again and replace the hash. There is no recovery.\n');
