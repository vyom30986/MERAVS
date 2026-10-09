// What the brand has spent. Admin only, in every direction - nothing here is
// public, and there is no POST a customer could reach.
//
// GET    /api/costs
// POST   /api/costs            - add a line
// PATCH  /api/costs            - edit a line
// DELETE /api/costs?id=N
//
// Amounts are whole rupees stored as integers. No floats anywhere near money:
// 0.1 + 0.2 is not 0.3, and that is not a thing to discover in a ledger.

import { json, verifyAdmin, audit } from '../_lib.js';

export const CATEGORIES = ['samples', 'inventory', 'packaging', 'shipping',
  'photography', 'ads', 'website', 'legal', 'fees', 'other'];

const str = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function onRequestGet({ request, env }) {
  const who = await verifyAdmin(request, env);
  if (!who) return json({ error: 'forbidden' }, 403);
  if (!env.DB) return json({ error: 'no_database' }, 503);

  const limit = Math.min(1000, Math.max(1, Number(new URL(request.url).searchParams.get('limit')) || 300));
  try {
    const [rows, total, byCat, byMonth] = await Promise.all([
      env.DB.prepare(`SELECT * FROM costs ORDER BY COALESCE(spent_on, created_at) DESC, id DESC LIMIT ?`).bind(limit).all(),
      env.DB.prepare('SELECT COUNT(*) AS n, SUM(amount) AS total FROM costs').first(),
      env.DB.prepare('SELECT category, SUM(amount) AS total, COUNT(*) AS n FROM costs GROUP BY category ORDER BY total DESC').all(),
      env.DB.prepare(`SELECT substr(COALESCE(spent_on, created_at), 1, 7) AS month, SUM(amount) AS total
                      FROM costs GROUP BY month ORDER BY month DESC LIMIT 12`).all(),
    ]);
    return json({
      costs: rows.results || [],
      categories: CATEGORIES,
      total: (total && total.total) || 0,
      count: (total && total.n) || 0,
      byCategory: byCat.results || [],
      byMonth: byMonth.results || [],
    });
  } catch (e) {
    return json({ error: 'query_failed', detail: String(e) }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const who = await verifyAdmin(request, env);
  if (!who) return json({ error: 'forbidden' }, 403);
  if (!env.DB) return json({ error: 'no_database' }, 503);

  let body;
  try { body = await request.json(); } catch (_) { return json({ error: 'bad_json' }, 400); }

  const amount = Math.round(Number(body.amount));
  if (!Number.isFinite(amount) || amount < 0) return json({ error: 'bad_amount' }, 400);

  const category = CATEGORIES.includes(body.category) ? body.category : 'other';
  const description = str(body.description, 200);
  const ref = str(body.ref, 8) || null;
  const spentOn = isDate(str(body.spent_on, 10)) ? str(body.spent_on, 10) : null;

  try {
    const r = await env.DB.prepare(
      `INSERT INTO costs (created_at, spent_on, category, description, amount, ref)
       VALUES (datetime('now'), COALESCE(?, date('now')), ?, ?, ?, ?)`
    ).bind(spentOn, category, description || null, amount, ref).run();
    await audit(env, request, who, `cost:+${amount}:${category}`, ref);
    return json({ ok: true, id: r.meta && r.meta.last_row_id, by: who });
  } catch (e) {
    return json({ error: 'write_failed', detail: String(e) }, 500);
  }
}

export async function onRequestPatch({ request, env }) {
  const who = await verifyAdmin(request, env);
  if (!who) return json({ error: 'forbidden' }, 403);
  if (!env.DB) return json({ error: 'no_database' }, 503);

  let body;
  try { body = await request.json(); } catch (_) { return json({ error: 'bad_json' }, 400); }
  const id = Math.round(Number(body.id) || 0);
  if (!id) return json({ error: 'missing_id' }, 400);

  const sets = [], vals = [];
  if (body.amount !== undefined) {
    const n = Math.round(Number(body.amount));
    if (!Number.isFinite(n) || n < 0) return json({ error: 'bad_amount' }, 400);
    sets.push('amount = ?'); vals.push(n);
  }
  if (typeof body.category === 'string') {
    if (!CATEGORIES.includes(body.category)) return json({ error: 'bad_category', allowed: CATEGORIES }, 400);
    sets.push('category = ?'); vals.push(body.category);
  }
  if (typeof body.description === 'string') { sets.push('description = ?'); vals.push(str(body.description, 200) || null); }
  if (typeof body.ref === 'string') { sets.push('ref = ?'); vals.push(str(body.ref, 8) || null); }
  if (typeof body.spent_on === 'string') {
    const d = str(body.spent_on, 10);
    if (!isDate(d)) return json({ error: 'bad_date' }, 400);
    sets.push('spent_on = ?'); vals.push(d);
  }
  if (!sets.length) return json({ error: 'nothing_to_write' }, 400);

  try {
    await env.DB.prepare(`UPDATE costs SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
    await audit(env, request, who, 'cost_edit:' + id, null);
    return json({ ok: true, by: who });
  } catch (e) {
    return json({ error: 'write_failed', detail: String(e) }, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  const who = await verifyAdmin(request, env);
  if (!who) return json({ error: 'forbidden' }, 403);
  if (!env.DB) return json({ error: 'no_database' }, 503);
  const id = Math.round(Number(new URL(request.url).searchParams.get('id')) || 0);
  if (!id) return json({ error: 'missing_id' }, 400);
  await env.DB.prepare('DELETE FROM costs WHERE id = ?').bind(id).run();
  await audit(env, request, who, 'cost_delete:' + id, null);
  return json({ ok: true, deleted: id, by: who });
}
