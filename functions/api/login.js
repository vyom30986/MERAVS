// GET    /api/login  - who am I? { admin: true|false, via: 'access'|'session'|null }
// POST   /api/login  - { password } -> sets an HMAC-signed, httpOnly session cookie
// DELETE /api/login  - clears the session
//
// The password is never stored anywhere. ADMIN_PASSWORD_HASH holds a PBKDF2
// digest generated locally by tools/hash-password.mjs. With that secret or
// SESSION_SECRET unset, login is impossible and every write stays refused.

import {
  json, verifyPassword, safeEqualString, verifyAdmin, verifyAccess, verifySession,
  makeSession, sessionCookie, adminConfig, verifyGoogleToken, sessionIdentity,
} from '../_lib.js';

const WINDOW_MIN = 15;     // throttle window
const MAX_FAILURES = 8;    // failures per IP per window before lockout
const TTL = 60 * 60 * 12;  // session lifetime, 12 hours

const ipOf = request =>
  request.headers.get('cf-connecting-ip') ||
  request.headers.get('x-forwarded-for') ||
  'unknown';

export async function onRequestGet({ request, env }) {
  const cfgEarly = await adminConfig(env);
  if (cfgEarly.authMode === 'open') {
    return json({ admin: true, signedIn: true, via: 'open', who: 'open access', openMode: true });
  }
  const viaAccess = await verifyAccess(request, env);
  if (viaAccess) return json({ admin: true, signedIn: true, via: 'access', who: viaAccess });

  // A customer session and an admin session look the same here except for
  // one flag. The site header reads `admin` to decide whether to show the
  // Admin link; nothing is authorised on the strength of this response.
  const id = await sessionIdentity(request, env);
  if (id) {
    return json({
      admin: id.isAdmin, signedIn: true, via: 'session', who: id.email,
      googleClientId: cfgEarly.googleClientId || null,
    });
  }
  const cfg = await adminConfig(env);
  return json({
    admin: false,
    signedIn: false,
    via: null,
    // Tell the panel which login routes are actually usable, so it can show
    // the right thing instead of a form that cannot possibly work.
    passwordLoginAvailable: Boolean(cfg.username && cfg.passwordHash && cfg.sessionSecret),
    googleClientId: cfg.googleClientId || null,
    accessConfigured: Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD),
  });
}

export async function onRequestPost({ request, env }) {
  const cfg = await adminConfig(env);

  // --- Google sign-in -------------------------------------------------
  // The page posts the ID token Google handed it. Peek at the body first so
  // a Google sign-in does not need a username or a password hash to exist.
  let peek = null;
  try { peek = await request.clone().json(); } catch (_) {}

  if (peek && peek.credential) {
    if (!cfg.googleClientId || !cfg.sessionSecret) {
      return json({ error: 'google_not_configured' }, 503);
    }
    let email;
    try {
      email = await verifyGoogleToken(peek.credential, cfg.googleClientId);
    } catch (e) {
      return json({ error: 'verify_failed', detail: String(e).slice(0, 200) }, 500);
    }
    if (!email) return json({ error: 'invalid_google_token' }, 401);

    // Anyone with a verified Google account may sign in to the SITE. That is
    // how customers get identified on a waitlist or order tap. Being signed
    // in grants nothing beyond that: the allowlist, checked separately in
    // verifyAdmin, is the only thing that makes an account an admin.
    const admin = cfg.allowedEmails.includes(email);
    const tok = await makeSession(env, email, TTL);
    if (!tok) return json({ error: 'google_not_configured' }, 503);
    return json({ ok: true, via: 'google', who: email, isAdmin: admin }, 200, 'no-store', {
      'set-cookie': sessionCookie(tok, TTL),
    });
  }

  // --- password sign-in (kept as the fallback) ------------------------
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
    // Passwords are not trimmed by default, because whitespace in one may be
    // deliberate. But a trailing space on a pasted passphrase is a clipboard
    // artifact every single time, and rejecting it gives the user no way to
    // see what went wrong. So try the trimmed form as a second chance, only
    // when the two actually differ.
    if (!passOk && password !== password.trim()) {
      passOk = await verifyPassword(password.trim(), cfg.passwordHash);
    }
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
    // Constant-ish response time, and still no hint about WHICH field was
    // wrong. But do say how many tries are left - being locked out with no
    // warning is worse than useless, and the count leaks nothing an attacker
    // could not measure by counting their own requests.
    await new Promise(r => setTimeout(r, 400));
    let left = null;
    if (env.DB) {
      try {
        const r = await env.DB.prepare(
          `SELECT COUNT(*) n FROM login_attempts
           WHERE ip = ? AND ok = 0 AND created_at >= datetime('now', ?)`
        ).bind(ip, `-${WINDOW_MIN} minutes`).first();
        left = Math.max(0, MAX_FAILURES - ((r && r.n) || 0));
      } catch (_) {}
    }
    return json({ error: 'invalid', attemptsRemaining: left, windowMinutes: WINDOW_MIN }, 401);
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
