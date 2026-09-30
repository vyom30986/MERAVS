#!/usr/bin/env node
// Generate the two secrets the Meravs admin login needs.
//
//   node tools/hash-password.mjs
//
// It prompts for a password, prints an ADMIN_PASSWORD_HASH and a fresh
// SESSION_SECRET, and never writes either to disk or sends them anywhere.
// Paste both into the Cloudflare Pages project as ENCRYPTED variables:
//
//   Workers & Pages -> meravs -> Settings -> Variables and Secrets
//     ADMIN_PASSWORD_HASH = pbkdf2$...      (type: Secret)
//     SESSION_SECRET      = <random string> (type: Secret)
//
// Then redeploy. Nobody - not Cloudflare's dashboard, not this repo, not
// whoever helped you set this up - ever sees the password itself.

import { webcrypto as crypto } from 'node:crypto';
import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';

const ITERATIONS = 210_000; // OWASP's current PBKDF2-SHA256 guidance
const b64url = bytes => Buffer.from(bytes).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function ask(question) {
  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  // Mask the password as it is typed.
  const onData = () => { rl.output.write('\x1B[2K\x1B[200D' + question + '*'.repeat(rl.line.length)); };
  stdin.on('data', onData);
  return new Promise(res => rl.question(question, a => {
    stdin.off('data', onData);
    rl.close();
    stdout.write('\n');
    res(a);
  }));
}

const password = (await ask('Choose an admin password: ')).trim();

if (password.length < 12) {
  console.error('\nToo short. Use at least 12 characters - this is the only thing');
  console.error('standing between the internet and your prices. A passphrase of four');
  console.error('unrelated words is easier to remember and harder to crack than "Pa$$w0rd!".\n');
  process.exit(1);
}

const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
const bits = await crypto.subtle.deriveBits(
  { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256
);

const hash = `pbkdf2$${ITERATIONS}$${b64url(salt)}$${b64url(new Uint8Array(bits))}`;
const sessionSecret = b64url(crypto.getRandomValues(new Uint8Array(32)));

console.log('\nAdd both to Cloudflare Pages as encrypted Secrets, then redeploy.\n');
console.log('ADMIN_PASSWORD_HASH');
console.log(hash);
console.log('\nSESSION_SECRET');
console.log(sessionSecret);
console.log('\nThe password itself is not printed and not stored. If you forget it,');
console.log('run this again and replace the hash - there is no recovery.\n');
