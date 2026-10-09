// Pre-orders.
//
// GET    /api/preorders        - admin only. The list plus the money rollup.
// POST   /api/preorders        - public. A customer reserves a watch.
// PATCH  /api/preorders        - admin only. Move status, record a payment.
// DELETE /api/preorders?id=N   - admin only.
//
// Two rules hold this together:
//
//   1. The browser never sets a price. POST sends a reference and who you are;
//      the unit price, the deposit percentage and every total are read from the
//      database on the server. A customer cannot pre-order a 4,000 rupee watch
//      for 40 by editing a form.
//
//   2. A pre-order can only be created while sales_mode is 'preorder' or
//      'live'. While it is 'paused' this endpoint refuses, so the form cannot
//      take money for stock we have not sourced even if someone finds the URL.
//
// No money moves here. There is no gateway and no legal entity yet, so a new
// pre-order is a commitment, not a payment: status starts at 'enquiry' and a
// founder marks the deposit paid by hand when the UPI transfer lands. When a
// gateway exists, it writes the same columns and nothing else changes.

import { json, verifyAdmin, audit, clientIp, salesSettings } from '../_lib.js';

const STATUSES = ['enquiry', 'deposit_pending', 'deposit_paid', 'in_production',
  'shipped', 'delivered', 'cancelled', 'refunded'];

// No I, O, 0 or 1: these codes get read aloud over WhatsApp.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
function newCode() {
  const b = new Uint8Array(5);
  crypto.getRandomValues(b);
  return 'MV-' + Array.from(b, x => ALPHABET[x % ALPHABET.length]).join('');
}

const str = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// 10 digits for India, up to 15 with a country code. Stored as digits only so
// two spellings of the same number do not look like two customers.
function phoneDigits(v) {
  const d = String(v || '').replace(/\D/g, '').replace(/^0+/, '');
  return d.length >= 10 && d.length <= 15 ? d : '';
}

/* ---------- public: create ---------- */

export async function onRequestPost({ request, env }) {
  if (!env.DB) return json({ error: 'no_database' }, 503);

  const { salesMode, depositPct } = await salesSettings(env);
  if (salesMode === 'paused') {
    return json({ error: 'preorders_closed', message: 'Pre-orders are not open yet.' }, 409);
  }

  let body;
  try { body = await request.json(); } catch (_) { return json({ error: 'bad_json' }, 400); }

  const ref = str(body.ref, 8);
  const name = str(body.name, 80);
  const email = str(body.email, 160).toLowerCase();
  const phone = phoneDigits(body.phone);
  const notes = str(body.notes, 500);
  const qty = Math.min(5, Math.max(1, Math.round(Number(body.qty) || 1)));

  const bad = {};
  if (!ref) bad.ref = 'Pick a watch.';
  if (name.length < 2) bad.name = 'Tell us your name.';
  if (!EMAIL.test(email)) bad.email = 'That email address does not look right.';
  if (!phone) bad.phone = 'A 10-digit mobile number, please. We confirm on WhatsApp.';
  if (Object.keys(bad).length) return json({ error: 'invalid', fields: bad }, 400);

  // Throttle before doing any work: 5 pre-orders per IP per hour. Enough for a
  // family ordering together, not enough to fill the table with junk.
  const ip = clientIp(request);
  try {
    const n = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM preorder_attempts WHERE ip = ? AND created_at > datetime('now','-1 hour')"
    ).bind(ip).first();
    if (n && n.n >= 5) {
      return json({ error: 'too_many', message: 'That is a lot of pre-orders from one connection. Message us on WhatsApp instead.' }, 429);
    }
  } catch (_) { /* a missing throttle table must not block a real customer */ }

  const model = await env.DB.prepare(
    'SELECT ref, name, price, status FROM models WHERE ref = ?'
  ).bind(ref).first();
  if (!model) return json({ error: 'unknown_ref' }, 404);

  const unitPrice = Math.max(0, Math.round(Number(model.price) || 0));
  if (!unitPrice) {
    return json({ error: 'no_price', message: 'This watch has no price set yet, so we cannot take a deposit for it.' }, 409);
  }

  const total = unitPrice * qty;
  const depositDue = Math.round(total * depositPct / 100);
  const balanceDue = total - depositDue;

  // UNIQUE(code) is the real guard; retry a couple of times on the astronomically
  // unlikely collision rather than handing the customer an error.
  let code = '', inserted = null, lastErr = null;
  for (let i = 0; i < 3 && !inserted; i++) {
    code = newCode();
    try {
      inserted = await env.DB.prepare(
        `INSERT INTO preorders
           (code, created_at, updated_at, ref, model_name, customer_name, customer_email,
            customer_phone, qty, unit_price, deposit_due, deposit_paid, balance_due,
            balance_paid, status, notes)
         VALUES (?, datetime('now'), datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, 'enquiry', ?)`
      ).bind(code, model.ref, model.name, name, email, phone, qty, unitPrice,
        depositDue, balanceDue, notes || null).run();
    } catch (e) { lastErr = e; inserted = null; }
  }
  if (!inserted) return json({ error: 'write_failed', detail: String(lastErr) }, 500);

  try {
    await env.DB.prepare('INSERT INTO preorder_attempts (created_at, ip) VALUES (datetime("now"), ?)').bind(ip).run();
    await env.DB.prepare(
      `INSERT INTO events (created_at, kind, ref, email, country, city, referrer, path, user_agent)
       VALUES (datetime('now'), 'preorder', ?, ?, ?, ?, ?, ?, ?)`
    ).bind(model.ref, email,
      ((request.cf || {}).country || '').slice(0, 8) || null,
      ((request.cf || {}).city || '').slice(0, 64) || null,
      (request.headers.get('referer') || '').slice(0, 300) || null,
      'preorder:' + code,
      (request.headers.get('user-agent') || '').slice(0, 300) || null).run();
  } catch (_) { /* the pre-order is already saved; bookkeeping is best effort */ }

  const wa = await env.DB.prepare("SELECT value FROM site WHERE key = 'whatsapp'").first();
  const text = `Pre-order ${code} - ${model.name}${qty > 1 ? ' x' + qty : ''}. ` +
    `Deposit Rs ${depositDue.toLocaleString('en-IN')}. Where do I send it?`;

  return json({
    ok: true, code, ref: model.ref, modelName: model.name, qty,
    unitPrice, total, depositPct, depositDue, balanceDue,
    whatsapp: wa && wa.value ? `https://wa.me/${wa.value}?text=${encodeURIComponent(text)}` : null,
  });
}

/* ---------- admin: read ---------- */

const money = `SUM(deposit_due) AS depositDue, SUM(deposit_paid) AS depositPaid,
               SUM(balance_due) AS balanceDue, SUM(balance_paid) AS balancePaid,
               SUM(unit_price * qty) AS gross, SUM(qty) AS units`;

export async function onRequestGet({ request, env }) {
  const who = await verifyAdmin(request, env);
  if (!who) return json({ error: 'forbidden' }, 403);
  if (!env.DB) return json({ error: 'no_database' }, 503);

  const url = new URL(request.url);
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 200));

  try {
    // 'cancelled' and 'refunded' stay in the list but are kept out of every
    // total, so the headline numbers are money we can actually expect.
    const live = "status NOT IN ('cancelled','refunded')";
    const [orders, totals, byStatus, byModel] = await Promise.all([
      env.DB.prepare('SELECT * FROM preorders ORDER BY created_at DESC LIMIT ?').bind(limit).all(),
      env.DB.prepare(`SELECT COUNT(*) AS n, ${money} FROM preorders WHERE ${live}`).first(),
      env.DB.prepare('SELECT status, COUNT(*) AS n FROM preorders GROUP BY status').all(),
      env.DB.prepare(`SELECT ref, model_name, SUM(qty) AS units, SUM(unit_price * qty) AS gross
                      FROM preorders WHERE ${live} GROUP BY ref ORDER BY units DESC`).all(),
    ]);
    const t = totals || {};
    return json({
      orders: orders.results || [],
      statuses: STATUSES,
      totals: {
        count: t.n || 0, units: t.units || 0, gross: t.gross || 0,
        depositDue: t.depositDue || 0, depositPaid: t.depositPaid || 0,
        balanceDue: t.balanceDue || 0, balancePaid: t.balancePaid || 0,
      },
      byStatus: byStatus.results || [],
      byModel: byModel.results || [],
    });
  } catch (e) {
    return json({ error: 'query_failed', detail: String(e) }, 500);
  }
}

/* ---------- admin: update ---------- */

export async function onRequestPatch({ request, env }) {
  const who = await verifyAdmin(request, env);
  if (!who) return json({ error: 'forbidden' }, 403);
  if (!env.DB) return json({ error: 'no_database' }, 503);

  let body;
  try { body = await request.json(); } catch (_) { return json({ error: 'bad_json' }, 400); }

  const id = Math.round(Number(body.id) || 0);
  if (!id) return json({ error: 'missing_id' }, 400);

  const row = await env.DB.prepare('SELECT * FROM preorders WHERE id = ?').bind(id).first();
  if (!row) return json({ error: 'not_found' }, 404);

  const sets = [], vals = [];
  const put = (col, v) => { sets.push(col + ' = ?'); vals.push(v); };

  if (typeof body.status === 'string') {
    if (!STATUSES.includes(body.status)) return json({ error: 'bad_status', allowed: STATUSES }, 400);
    put('status', body.status);
  }
  for (const [key, col] of [['deposit_paid', 'deposit_paid'], ['balance_paid', 'balance_paid']]) {
    if (body[key] !== undefined) {
      const n = Math.round(Number(body[key]));
      if (!Number.isFinite(n) || n < 0) return json({ error: 'bad_amount', field: key }, 400);
      put(col, n);
    }
  }
  if (typeof body.payment_ref === 'string') put('payment_ref', str(body.payment_ref, 120) || null);
  if (typeof body.notes === 'string') put('notes', str(body.notes, 500) || null);
  if (typeof body.customer_name === 'string') put('customer_name', str(body.customer_name, 80) || null);
  if (typeof body.customer_email === 'string') put('customer_email', str(body.customer_email, 160).toLowerCase() || null);
  if (typeof body.customer_phone === 'string') {
    const p = phoneDigits(body.customer_phone);
    if (!p) return json({ error: 'bad_phone' }, 400);
    put('customer_phone', p);
  }
  if (!sets.length) return json({ error: 'nothing_to_write' }, 400);

  sets.push("updated_at = datetime('now')");
  try {
    await env.DB.prepare(`UPDATE preorders SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...vals, id).run();
    await audit(env, request, who, 'preorder:' + row.code, row.ref);
    const after = await env.DB.prepare('SELECT * FROM preorders WHERE id = ?').bind(id).first();
    return json({ ok: true, order: after, by: who });
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
  const row = await env.DB.prepare('SELECT code, ref FROM preorders WHERE id = ?').bind(id).first();
  if (!row) return json({ error: 'not_found' }, 404);
  await env.DB.prepare('DELETE FROM preorders WHERE id = ?').bind(id).run();
  await audit(env, request, who, 'preorder_delete:' + row.code, row.ref);
  return json({ ok: true, deleted: row.code, by: who });
}
