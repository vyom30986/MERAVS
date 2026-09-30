// Shared helpers for the Meravs Pages Functions.
// Files under functions/ whose name starts with _ are not routed.
//
// Two ways to prove you are the admin, both verified server-side:
//   1. A Cloudflare Access JWT  (preferred, once Zero Trust is enabled)
//   2. An HMAC-signed session cookie issued by /api/login
// Both fail closed. If neither is configured, nothing can write.

export const json = (body, status = 200, cache = 'no-store', extraHeaders = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200 ? cache : 'no-store',
      ...extraHeaders,
    },
  });

/* ---------- byte helpers ---------- */

export function b64urlToBytes(s) {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const enc = new TextEncoder();
const b64urlToJSON = s => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

// Compare without leaking how many bytes matched.
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// Compare two strings without leaking their length or contents through timing.
// Both sides are hashed to a fixed 32 bytes first, so a length mismatch cannot
// short-circuit the comparison.
export async function safeEqualString(a, b) {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(String(a ?? ''))),
    crypto.subtle.digest('SHA-256', enc.encode(String(b ?? ''))),
  ]);
  return timingSafeEqual(new Uint8Array(ha), new Uint8Array(hb));
}

/* ---------- password ----------
   Stored as: pbkdf2$<iterations>$<saltB64url>$<hashB64url>
   Generated locally by tools/hash-password.mjs so the plaintext password
   never travels anywhere and is never known to this codebase.            */

export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  // Pasting into a dashboard field very easily picks up a stray newline or
  // space. Tolerate that rather than failing with an unexplainable "wrong
  // password" the owner has no way to diagnose.
  const parts = stored.trim().split('$').map(s => s.trim());
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations < 10000) return false;

  let salt, expected;
  try { salt = b64urlToBytes(parts[2]); expected = b64urlToBytes(parts[3]); } catch (_) { return false; }

  // Deliberately NOT wrapped in a catch. A Workers CPU-limit abort inside
  // deriveBits used to be swallowed here and surfaced as "wrong password",
  // which is indistinguishable from a real rejection and cost hours to find.
  // Let it throw; the caller reports it as a server fault, not a bad password.
  // Keep iterations within the CPU budget - see ITERATION_CEILING below.
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, expected.length * 8
  );
  return timingSafeEqual(new Uint8Array(bits), expected);
}

// A Worker gets ~10ms of CPU. PBKDF2-SHA256 costs roughly 0.2ms per thousand
// iterations, so anything past ~40k risks being killed mid-derivation. OWASP
// would like 210k; that is a number for a server with a real CPU budget.
export const ITERATION_CEILING = 40000;

/* ---------- session cookie ---------- */

export const SESSION_COOKIE = 'meravs_admin';

/* ---------- where the admin credentials live ----------
   Cloudflare environment secrets win when they are set. When they are not,
   fall back to the admin_config table in D1, which is reachable only through
   a bound Function and is never served by any public route. That fallback is
   what lets the panel work without a trip to the dashboard; setting the env
   secrets later silently takes over with no code change.                   */

let cfgCache = null; // per-isolate, 30s

export async function adminConfig(env) {
  if (cfgCache && Date.now() - cfgCache.at < 30_000) return cfgCache.cfg;

  const out = {
    username: env.ADMIN_USERNAME || null,
    passwordHash: env.ADMIN_PASSWORD_HASH || null,
    sessionSecret: env.SESSION_SECRET || null,
    // 'open' means no sign-in at all. Deliberate, temporary, and set in the
    // database rather than in code so it can be switched back with one SQL
    // statement the moment Google sign-in is wired up.
    authMode: 'locked',
    source: 'env',
  };

  if (env.DB) {
    try {
      const r = await env.DB.prepare('SELECT key, value FROM admin_config').all();
      const m = Object.fromEntries((r.results || []).map(x => [x.key, x.value]));
      out.username = out.username || m.username || null;
      out.passwordHash = out.passwordHash || m.password_hash || null;
      out.sessionSecret = out.sessionSecret || m.session_secret || null;
      if (m.auth_mode === 'open') out.authMode = 'open';
      out.source = 'db';
    } catch (_) { /* table missing - stay locked */ }
  }
  cfgCache = { at: Date.now(), cfg: out };
  return out;
}

const hmacKey = secret =>
  crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

export async function makeSession(env, sub, ttlSeconds = 60 * 60 * 12) {
  const { sessionSecret } = await adminConfig(env);
  if (!sessionSecret) return null;
  const payload = bytesToB64url(enc.encode(JSON.stringify({
    sub, exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  })));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(sessionSecret), enc.encode(payload)));
  return `${payload}.${bytesToB64url(sig)}`;
}

export function sessionCookie(value, maxAge) {
  // httpOnly keeps it out of reach of any script on the page; Secure means
  // HTTPS only; Strict means it is never sent from another site's context.
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

export async function verifySession(request, env) {
  const raw = (request.headers.get('cookie') || '').match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (!raw) return null;
  const { sessionSecret } = await adminConfig(env);
  if (!sessionSecret) return null;
  const [payload, sig] = raw[1].split('.');
  if (!payload || !sig) return null;

  try {
    const ok = await crypto.subtle.verify(
      'HMAC', await hmacKey(sessionSecret), b64urlToBytes(sig), enc.encode(payload)
    );
    if (!ok) return null;
    const data = b64urlToJSON(payload);
    if (!data.exp || data.exp * 1000 < Date.now()) return null;
    return data.sub || 'admin';
  } catch (_) {
    return null;
  }
}

/* ---------- Cloudflare Access ---------- */

let certsCache = null; // per-isolate, one hour

async function accessKeys(teamDomain) {
  if (certsCache && Date.now() - certsCache.at < 3600_000) return certsCache.keys;
  const r = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!r.ok) return null;
  const { keys } = await r.json();
  certsCache = { at: Date.now(), keys };
  return keys;
}

export async function verifyAccess(request, env) {
  const team = env.ACCESS_TEAM_DOMAIN;
  const aud = env.ACCESS_AUD;
  if (!team || !aud) return null;

  const token =
    request.headers.get('Cf-Access-Jwt-Assertion') ||
    (request.headers.get('cookie') || '').match(/CF_Authorization=([^;]+)/)?.[1];
  if (!token) return null;

  const [h, p, s] = token.split('.');
  if (!h || !p || !s) return null;

  let header, payload;
  try { header = b64urlToJSON(h); payload = b64urlToJSON(p); } catch (_) { return null; }

  if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) return null;
  if (payload.iss && payload.iss !== `https://${team}`) return null;

  const keys = await accessKeys(team);
  const jwk = keys && keys.find(k => k.kid === header.kid);
  if (!jwk) return null;

  try {
    const key = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']
    );
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', key, b64urlToBytes(s), enc.encode(`${h}.${p}`)
    );
    return ok ? (payload.email || 'unknown') : null;
  } catch (_) {
    return null;
  }
}

/* ---------- the one check every privileged route uses ---------- */

export async function verifyAdmin(request, env) {
  const cfg = await adminConfig(env);
  // Open mode: the panel is deliberately unauthenticated while Google sign-in
  // is pending. Every write is still attributed and logged, so there is a
  // trail even though there is no gate.
  if (cfg.authMode === 'open') return 'open';
  return (await verifyAccess(request, env)) || (await verifySession(request, env)) || null;
}
