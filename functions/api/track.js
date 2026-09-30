// POST /api/track - public, fire-and-forget. Records one interaction event.
//
// The client sends this with navigator.sendBeacon, which survives the page
// navigating away to WhatsApp. sendBeacon posts text/plain, so parse the body
// as text and JSON.parse it rather than trusting the content-type.
//
// Identity: the `email` column stays null until email login exists. When it
// lands, read the verified email off the signed session cookie HERE - never
// from the request body, which the client controls.

import { json } from '../_lib.js';

const KINDS = new Set(['waitlist', 'order', 'ask', 'view']);

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return new Response(null, { status: 204 });

  let body = {};
  try {
    const raw = await request.text();
    if (raw && raw.length < 2000) body = JSON.parse(raw);
  } catch (_) {
    return new Response(null, { status: 204 });
  }

  const kind = KINDS.has(body.kind) ? body.kind : null;
  if (!kind) return new Response(null, { status: 204 });

  const clip = (v, n) => (typeof v === 'string' && v ? v.slice(0, n) : null);
  const cf = request.cf || {};

  const write = env.DB.prepare(
    `INSERT INTO events (created_at, kind, ref, email, country, city, referrer, path, user_agent)
     VALUES (datetime('now'), ?, ?, NULL, ?, ?, ?, ?, ?)`
  ).bind(
    kind,
    clip(body.ref, 16),
    clip(cf.country, 8),
    clip(cf.city, 64),
    clip(request.headers.get('referer'), 300),
    clip(body.path, 200),
    clip(request.headers.get('user-agent'), 300)
  ).run();

  // Don't make the visitor wait on a database write they get nothing from.
  if (context.waitUntil) context.waitUntil(write); else await write;

  return new Response(null, { status: 204 });
}

// Anything other than POST is not useful here and should not hint at the schema.
export const onRequestGet = () => json({ error: 'method_not_allowed' }, 405);
