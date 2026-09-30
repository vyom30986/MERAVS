// GET /api/events - admin only. Recent interaction events plus rollups.
// Same fail-closed rule as every other privileged endpoint: no verified
// Cloudflare Access token, no data. This returns visitor data, so it must
// never be readable without auth.
//
//   ?limit=200   how many raw rows (max 500)
//   ?kind=waitlist   filter to one kind

import { json, verifyAccess } from '../_lib.js';

export async function onRequestGet({ request, env }) {
  const email = await verifyAccess(request, env);
  if (!email) return json({ error: 'forbidden' }, 403);
  if (!env.DB) return json({ error: 'no_database' }, 503);

  const url = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '200', 10) || 200, 1), 500);
  const kind = url.searchParams.get('kind');

  try {
    const rows = kind
      ? await env.DB.prepare(
          'SELECT * FROM events WHERE kind = ? ORDER BY id DESC LIMIT ?'
        ).bind(kind, limit).all()
      : await env.DB.prepare(
          'SELECT * FROM events ORDER BY id DESC LIMIT ?'
        ).bind(limit).all();

    const [byKind, byDay, topRefs, total] = await Promise.all([
      env.DB.prepare('SELECT kind, COUNT(*) n FROM events GROUP BY kind ORDER BY n DESC').all(),
      env.DB.prepare(
        `SELECT date(created_at) d, COUNT(*) n FROM events
         WHERE created_at >= datetime('now','-30 days')
         GROUP BY d ORDER BY d DESC`
      ).all(),
      env.DB.prepare(
        `SELECT ref, COUNT(*) n FROM events
         WHERE ref IS NOT NULL GROUP BY ref ORDER BY n DESC LIMIT 20`
      ).all(),
      env.DB.prepare('SELECT COUNT(*) n FROM events').first(),
    ]);

    return json({
      viewer: email,
      total: total ? total.n : 0,
      byKind: byKind.results || [],
      byDay: byDay.results || [],
      topRefs: topRefs.results || [],
      events: rows.results || [],
    });
  } catch (e) {
    return json({ error: 'query_failed', detail: String(e) }, 500);
  }
}
