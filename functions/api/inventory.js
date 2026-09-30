// GET  /api/inventory - public. Returns { site, models } in the exact shape the
//                       site's renderer already expects.
// PUT  /api/inventory  - admin only. Upserts one model, or a set of site settings.
// DELETE /api/inventory?ref=NN - admin only.
//
// Writes FAIL CLOSED: refused unless the request carries a Cloudflare Access JWT
// that verifies against the team's published keys. With ACCESS_TEAM_DOMAIN or
// ACCESS_AUD unset, nothing can write - including us.

import { json, verifyAdmin } from '../_lib.js';

// D1 keeps the flat fields as columns and the renderer's nested config in `design`.
// Recombine into the single object watchshape.js and the pages already consume.
function rowToModel(row) {
  let design = {};
  try { design = JSON.parse(row.design || '{}'); } catch (_) {}
  const m = {
    ref: row.ref,
    gender: row.gender,
    name: row.name,
    dialName: row.dial_name || undefined,
    note: row.note || undefined,
    tone: row.tone || undefined,
    metal: row.metal,
    size: row.size,
    price: row.price,
    status: row.status,
    photo: row.photo || undefined,
    photoAspect: row.photo_aspect || undefined,
    ...design,
  };
  for (const k of Object.keys(m)) if (m[k] === undefined) delete m[k];
  return m;
}

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ error: 'no_database' }, 503);
  try {
    const [models, site] = await Promise.all([
      env.DB.prepare('SELECT * FROM models ORDER BY sort_order').all(),
      env.DB.prepare('SELECT key, value FROM site').all(),
    ]);
    return json({
      site: Object.fromEntries((site.results || []).map(r => [r.key, r.value])),
      models: (models.results || []).map(rowToModel),
    }, 200, 'public, max-age=30, s-maxage=60');
  } catch (e) {
    return json({ error: 'query_failed', detail: String(e) }, 500);
  }
}

export async function onRequestPut({ request, env }) {
  const email = await verifyAdmin(request, env);
  if (!email) return json({ error: 'forbidden' }, 403);
  if (!env.DB) return json({ error: 'no_database' }, 503);

  let body;
  try { body = await request.json(); } catch (_) { return json({ error: 'bad_json' }, 400); }

  if (body && body.site && typeof body.site === 'object') {
    const entries = Object.entries(body.site).filter(([k, v]) => k && typeof v === 'string');
    if (!entries.length) return json({ error: 'nothing_to_write' }, 400);
    await env.DB.batch(entries.map(([k, v]) =>
      env.DB.prepare('INSERT OR REPLACE INTO site (key,value) VALUES (?,?)').bind(k, v)
    ));
    return json({ ok: true, wrote: 'site', by: email, keys: entries.map(e => e[0]) });
  }

  const m = body && body.model;
  if (!m || !m.ref) return json({ error: 'missing_model_or_ref' }, 400);

  const flat = new Set(['ref', 'gender', 'name', 'dialName', 'note', 'tone', 'metal',
    'size', 'price', 'status', 'photo', 'photoAspect', 'sort_order']);
  const design = {};
  for (const [k, v] of Object.entries(m)) if (!flat.has(k)) design[k] = v;

  const status = m.status === 'out' ? 'out' : 'in';
  const price = Number.isFinite(+m.price) ? Math.round(+m.price) : 0;
  const size = Number.isFinite(+m.size) ? Math.round(+m.size) : 0;
  const order = Number.isFinite(+m.sort_order) ? Math.round(+m.sort_order) : 99;

  try {
    await env.DB.prepare(
      `INSERT INTO models (ref,sort_order,name,gender,dial_name,note,tone,metal,size,price,status,photo,photo_aspect,design,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))
       ON CONFLICT(ref) DO UPDATE SET
         sort_order=excluded.sort_order, name=excluded.name, gender=excluded.gender,
         dial_name=excluded.dial_name, note=excluded.note, tone=excluded.tone,
         metal=excluded.metal, size=excluded.size, price=excluded.price,
         status=excluded.status, photo=excluded.photo, photo_aspect=excluded.photo_aspect,
         design=excluded.design, updated_at=datetime('now')`
    ).bind(
      String(m.ref), order, String(m.name || ''), m.gender === 'women' ? 'women' : 'men',
      m.dialName || null, m.note || null, m.tone || null, String(m.metal || 'steel'),
      size, price, status, m.photo || null, m.photoAspect || null, JSON.stringify(design)
    ).run();
    return json({ ok: true, wrote: 'model', ref: m.ref, by: email });
  } catch (e) {
    return json({ error: 'write_failed', detail: String(e) }, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  const email = await verifyAdmin(request, env);
  if (!email) return json({ error: 'forbidden' }, 403);
  if (!env.DB) return json({ error: 'no_database' }, 503);
  const ref = new URL(request.url).searchParams.get('ref');
  if (!ref) return json({ error: 'missing_ref' }, 400);
  await env.DB.prepare('DELETE FROM models WHERE ref = ?').bind(ref).run();
  return json({ ok: true, deleted: ref, by: email });
}
