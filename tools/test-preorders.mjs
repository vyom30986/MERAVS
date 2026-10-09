// Exercises functions/api/preorders.js against a stub that behaves like D1.
// Run:  node test-preorders.mjs <repo-root>
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const root = process.argv[2];
const mod = await import(pathToFileURL(join(root, 'functions/api/preorders.js')).href);

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + JSON.stringify(extra) : '')); }
};

/* ---------- a stub that answers the queries this module actually makes ---------- */
function makeDB(opts) {
  const state = { inserted: [], attempts: opts.attempts ?? 0, updates: [] };
  const run = (sql, args) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    const api = {
      async first() {
        if (/FROM admin_config/.test(s)) {
          return null; // handled by .all() below
        }
        if (/COUNT\(\*\) AS n FROM preorder_attempts/.test(s)) return { n: state.attempts };
        if (/FROM models WHERE ref/.test(s)) {
          return opts.model === null ? null : (opts.model ?? { ref: '01', name: 'Reference 01', price: 3950, status: 'in' });
        }
        if (/FROM site WHERE key = 'whatsapp'/.test(s)) return { value: '916388173047' };
        if (/FROM preorders WHERE id/.test(s)) return opts.order ?? null;
        if (/COUNT\(\*\) AS n,/.test(s)) return { n: 2, units: 3, gross: 9000, depositDue: 4500, depositPaid: 1000, balanceDue: 4500, balancePaid: 0 };
        return null;
      },
      async all() {
        if (/FROM admin_config/.test(s)) {
          return { results: [
            { key: 'sales_mode', value: opts.mode ?? 'preorder' },
            { key: 'deposit_pct', value: String(opts.pct ?? 50) },
          ] };
        }
        return { results: [] };
      },
      async run() {
        if (/INSERT INTO preorders/.test(s)) { state.inserted.push(args); return { success: true, meta: { last_row_id: 1 } }; }
        if (/UPDATE preorders/.test(s)) { state.updates.push({ sql: s, args }); return { success: true }; }
        return { success: true, meta: { last_row_id: 1 } };
      },
    };
    return api;
  };
  return {
    state,
    prepare(sql) { return { bind: (...args) => run(sql, args), ...run(sql, []) }; },
    async batch(list) { return Promise.all(list); },
  };
}

const req = (body, headers = {}) => new Request('https://meravs.pages.dev/api/preorders', {
  method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '1.2.3.4', ...headers },
  body: JSON.stringify(body),
});

const post = async (body, opts = {}) => {
  const db = makeDB(opts);
  const r = await mod.onRequestPost({ request: req(body), env: { DB: db } });
  return { status: r.status, body: await r.json(), db };
};

const GOOD = { ref: '01', name: 'Aarav Mehta', email: 'aarav@example.com', phone: '98765 43210', qty: 2 };

console.log('\nPaused mode');
{
  const r = await post(GOOD, { mode: 'paused' });
  ok('refuses with 409 while paused', r.status === 409 && r.body.error === 'preorders_closed', r.body);
  ok('writes nothing while paused', r.db.state.inserted.length === 0);
}

console.log('\nValidation');
for (const [label, patch, field] of [
  ['missing name', { name: '' }, 'name'],
  ['one-letter name', { name: 'A' }, 'name'],
  ['email with no domain', { email: 'nope' }, 'email'],
  ['email with no dot', { email: 'a@b' }, 'email'],
  ['9-digit phone', { phone: '987654321' }, 'phone'],
  ['phone that is words', { phone: 'call me' }, 'phone'],
  ['no ref', { ref: '' }, 'ref'],
]) {
  const r = await post({ ...GOOD, ...patch });
  ok(label + ' -> 400 on ' + field, r.status === 400 && r.body.error === 'invalid' && !!r.body.fields[field], r.body);
}
{
  const r = await post({ ...GOOD, phone: '+91 98765-43210' });
  ok('accepts a formatted phone number', r.status === 200, r.body);
  const stored = r.db.state.inserted[0];
  ok('stores the phone as digits only', stored && stored[5] === '919876543210', stored && stored[5]);
}

console.log('\nThe browser cannot set a price');
{
  // Everything a hostile client could try to send.
  const r = await post({ ...GOOD, price: 1, unit_price: 1, deposit_due: 1, balance_due: 0,
                         total: 1, deposit_paid: 99999, status: 'delivered', code: 'MV-FREE' });
  ok('still returns 200', r.status === 200, r.body);
  ok('unit price comes from the database (3950)', r.body.unitPrice === 3950, r.body.unitPrice);
  ok('total is price x qty (7900)', r.body.total === 7900, r.body.total);
  ok('deposit is 50% (3950)', r.body.depositDue === 3950, r.body.depositDue);
  ok('balance is the remainder (3950)', r.body.balanceDue === 3950, r.body.balanceDue);
  const ins = r.db.state.inserted[0];
  //  bind order: code, ref, model_name, name, email, phone, qty, unit_price, deposit_due, balance_due, notes
  ok('row stores unit_price 3950, not 1', ins[7] === 3950, ins[7]);
  ok('row stores deposit_due 3950, not 1', ins[8] === 3950, ins[8]);
  ok('row stores balance_due 3950, not 0', ins[9] === 3950, ins[9]);
  ok('injected code is ignored', ins[0] !== 'MV-FREE' && /^MV-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/.test(ins[0]), ins[0]);
  ok('status is not taken from the body', !ins.includes('delivered'));
}

console.log('\nDeposit percentage comes from the database');
for (const [pct, expected] of [[25, 1975], [50, 3950], [100, 7900], [10, 790]]) {
  const r = await post(GOOD, { pct });
  ok(`${pct}% of 7900 = ${expected}`, r.body.depositDue === expected && r.body.balanceDue === 7900 - expected, r.body);
}
{
  // An odd percentage must still add up to the total, to the rupee.
  const r = await post({ ...GOOD, qty: 3 }, { pct: 33 });
  ok('33% of 11850 adds up exactly', r.body.depositDue + r.body.balanceDue === r.body.total,
     { d: r.body.depositDue, b: r.body.balanceDue, t: r.body.total });
}

console.log('\nQuantity is clamped');
for (const [given, want] of [[0, 1], [1, 1], [5, 5], [99, 5], [-3, 1], ['2', 2], [2.6, 3], [null, 1]]) {
  const r = await post({ ...GOOD, qty: given });
  ok(`qty ${JSON.stringify(given)} -> ${want}`, r.body.qty === want, r.body.qty);
}

console.log('\nUnknown and unpriced watches');
{
  const r = await post(GOOD, { model: null });
  ok('unknown ref -> 404', r.status === 404 && r.body.error === 'unknown_ref', r.body);
}
{
  const r = await post(GOOD, { model: { ref: '01', name: 'Reference 01', price: 0, status: 'in' } });
  ok('no price -> 409, no deposit taken', r.status === 409 && r.body.error === 'no_price', r.body);
}

console.log('\nThrottle');
{
  const r = await post(GOOD, { attempts: 4 });
  ok('4 in the last hour is allowed', r.status === 200, r.body);
}
{
  const r = await post(GOOD, { attempts: 5 });
  ok('5 in the last hour -> 429', r.status === 429 && r.body.error === 'too_many', r.body);
  ok('throttled request writes no pre-order', r.db.state.inserted.length === 0);
}

console.log('\nField lengths are capped');
{
  const r = await post({ ...GOOD, name: 'x'.repeat(500), notes: 'y'.repeat(5000) });
  const ins = r.db.state.inserted[0];
  ok('name capped at 80', ins[3].length === 80, ins[3].length);
  ok('notes capped at 500', ins[10].length === 500, ins[10].length);
}
{
  const r = await post({ ...GOOD, email: 'AARAV@EXAMPLE.COM' });
  ok('email is lowercased', r.db.state.inserted[0][4] === 'aarav@example.com', r.db.state.inserted[0][4]);
}

console.log('\nThe WhatsApp handoff');
{
  const r = await post(GOOD);
  ok('link points at the site number', (r.body.whatsapp || '').startsWith('https://wa.me/916388173047?text='), r.body.whatsapp);
  ok('link carries the code', decodeURIComponent(r.body.whatsapp).includes(r.body.code), r.body.whatsapp);
  ok('link carries the deposit', decodeURIComponent(r.body.whatsapp).includes('3,950'), r.body.whatsapp);
}

console.log('\nCodes');
{
  const seen = new Set();
  for (let i = 0; i < 300; i++) {
    const r = await post(GOOD);
    seen.add(r.body.code);
    if (!/^MV-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/.test(r.body.code)) { ok('code shape', false, r.body.code); break; }
  }
  ok('300 codes all match MV-XXXXX with no 0/1/I/O', seen.size > 0);
  ok('300 codes are distinct', seen.size === 300, seen.size);
}

console.log('\nAdmin routes refuse without a session');
{
  const env = { DB: makeDB({}) };  // no session cookie, no ACCESS_* vars, auth_mode absent -> locked
  const g = await mod.onRequestGet({ request: new Request('https://x/api/preorders'), env });
  ok('GET -> 403', g.status === 403, await g.json());
  const pa = await mod.onRequestPatch({
    request: new Request('https://x/api/preorders', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"id":1,"deposit_paid":99999}' }), env });
  ok('PATCH -> 403', pa.status === 403, await pa.json());
  ok('PATCH wrote nothing', env.DB.state.updates.length === 0);
  const de = await mod.onRequestDelete({ request: new Request('https://x/api/preorders?id=1', { method: 'DELETE' }), env });
  ok('DELETE -> 403', de.status === 403, await de.json());
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
