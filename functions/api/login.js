// GET    /api/login  - who am I? { admin: true|false, via: 'access'|'session'|null }
// POST   /api/login  - { password } -> sets an HMAC-signed, httpOnly session cookie
// DELETE /api/login  - clears the session
//
// The password is never stored anywhere. ADMIN_PASSWORD_HASH holds a PBKDF2
// digest generated locally by tools/hash-password.mjs. With that secret or
// SESSION_SECRET unset, login is impossible and every write stays refused.

import {
  json, verifyPassword, safeEqualString, verifyAdmin, verifyAccess, verifySession,
  makeSession, sessionCookie, adminConfig,
} from '../_lib.js';

const WINDOW_MIN = 15;     // throttle window
const MAX_FAILURES = 8;    // failures per IP per window before lockout
const TTL = 60 * 60 * 12;  // session lifetime, 12 hours

const ipOf = request =>
  request.headers.get('cf-connecting-ip') ||
  request.headers.get('x-forwarded-for') ||
  'unknown';

export async function onRequestGet({ request, env }) {
  const viaAccess = await verifyAccess(request, env);
  if (viaAccess) return json({ admin: true, via: 'access', who: viaAccess });
  const viaSession = await verifySession(request, env);
  if (viaSession) return json({ admin: true, via: 'session', who: viaSession });
  const cfg = await adminConfig(env);
  return json({
    admin: false,
    via: null,
    // Tell the panel which login routes are actually usable, so it can show
    // the right thing instead of a form that cannot possibly work.
    passwordLoginAvailable: Boolean(cfg.username && cfg.passwordHash && cfg.sessionSecret),
    accessConfigured: Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD),
  });
}

export async function onRequestPost({ request, env }) {
  const cfg = await adminConfig(env);
  if (!cfg.username || !cfg.passwordHash || !cfg.sessionSecret) {
    return json({ error: 'login_not_configured' }, 503);
  }

  const ip = ipOf(request);

  // Throttle before doing any work, so a flood costs the attacker more than us.
  if (env.DB) {
    try {
      const recent = await env.DB.prepare(
        `SELECT COUNT(*) n FROM login_attempts
         WHERE ip = ? AND ok = 0 AND created_at >= datetime('now', ?)`
      ).bind(ip, `-${WINDOW_MIN} minutes`).first();
      if (recent && recent.n >= MAX_FAILURES) {
        return json({ error: 'too_many_attempts', retryAfterMinutes: WINDOW_MIN }, 429);
      }
    } catch (_) { /* never let the throttle check block a legitimate login */ }
  }

  let body;
  try { body = await request.json(); } catch (_) { return json({ error: 'bad_json' }, 400); }
  // Trim the ID on both sides - a trailing space from autofill or a paste is
  // not a different user, and an unexplainable rejection is worse than useless.
  // The password is never trimmed; whitespace there may be deliberate.
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!username || username.length > 256) return json({ error: 'invalid' }, 401);
  if (!password || password.length > 512) return json({ error: 'invalid' }, 401);

  // Always evaluate both checks. Bailing out early on a wrong username would
  // make it measurably faster than a wrong password, which tells an attacker
  // when they have guessed the ID correctly.
  let userOk, passOk;
  try {
    [userOk, passOk] = await Promise.all([
      safeEqualString(username, String(cfg.username).trim()),
      verifyPassword(password, cfg.passwordHash),
    ]);
  } catch (e) {
    // Crypto itself failed - almost always the CPU limit on an iteration count
    // that is too high. Say so, instead of blaming the password.
    return json({ error: 'hash_failed', detail: String(e).slice(0, 200) }, 500);
  }
  const ok = userOk && passOk;

  if (env.DB) {
    try {
      await env.DB.prepare(
        'INSERT INTO login_attempts (created_at, ip, ok) VALUES (datetime(\'now\'), ?, ?)'
      ).bind(ip, ok ? 1 : 0).run();
    } catch (_) {}
  }

  if (!ok) {
    // Constant-ish response time and no hint about why it failed.
    await new Promise(r => setTimeout(r, 400));
    return json({ error: 'invalid' }, 401);
  }

  const token = await makeSession(env, 'admin', TTL);
  if (!token) return json({ error: 'login_not_configured' }, 503);
  return json({ ok: true, via: 'session' }, 200, 'no-store', {
    'set-cookie': sessionCookie(token, TTL),
  });
}

export async function onRequestDelete({ request, env }) {
  // Only someone already signed in can sign out; stops a stray request
  // clearing a session as a nuisance.
  await verifyAdmin(request, env);
  return json({ ok: true }, 200, 'no-store', { 'set-cookie': sessionCookie('', 0) });
}
