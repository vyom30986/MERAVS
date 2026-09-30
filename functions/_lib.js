// Shared helpers for the Meravs Pages Functions.
// Files under functions/ whose name starts with _ are not routed.

export const json = (body, status = 200, cache = 'no-store') =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': status === 200 ? cache : 'no-store',
    },
  });

/* ---------- Cloudflare Access verification ----------
   Fails closed. Returns the verified email, or null meaning refuse.
   Null is returned when Access is not configured at all, so no write path
   is ever open by default.                                              */

function b64urlToBytes(s) {
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const b64urlToJSON = s => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

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
      'RSASSA-PKCS1-v1_5', key, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`)
    );
    return ok ? (payload.email || 'unknown') : null;
  } catch (_) {
    return null;
  }
}
