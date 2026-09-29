// Shared watch geometry: case/dial outlines, dial markings and hands, in world units (y up, 12 o'clock = +y).
// Used by the 3D engine (watch3d.js) and the 2D dial (Dial.dc.html) so both always match.
const TAU = Math.PI * 2;
export const METAL3D = { gold: '#D3B06A', steel: '#C9CDD2', rose: '#E8C2AE' };
export const METAL2D = { gold: '#C9A55C', steel: '#B3B9C0', rose: '#CC977D' };
export const DEFAULT_DIAL = { d0: '#1C3150', d1: '#132540', d2: '#0A1422', ink: '#EFE7D4', idx: '#D9BC7C', sheen: '#8FA8CC' };
export const FONTS = { roman: 'Marcellus', serif: 'Cormorant Garamond', script: 'Pinyon Script', sans: 'Karla' };

export const SHAPES = {
  round:   { caseA: 20.1, caseB: 20.1, caseN: 2,   casePinch: 0,    dialA: 16.6, dialB: 16.6, dialN: 2,   dialPinch: 0,    bezel: 'round',  bezelScale: 1,    lugs: true,  lugShift: 0,   attach: 24 },
  cushion: { caseA: 20.4, caseB: 20.4, caseN: 4.6, casePinch: 0,    dialA: 15.2, dialB: 15.2, dialN: 2,   dialPinch: 0,    bezel: 'round',  bezelScale: 0.92, lugs: true,  lugShift: 1.4, attach: 25.4 },
  eye:     { caseA: 11.2, caseB: 21, caseN: 0, casePinch: 0.12, dialA: 8.4, dialB: 17, dialN: 0, dialPinch: 0.12, bezel: 'shaped', bezelScale: 1, lugs: false, lugShift: 0, attach: 20.6 },
  tonneau: { caseA: 14.4, caseB: 19.2, caseN: 3.4, casePinch: 0.14, dialA: 11.2, dialB: 15.4, dialN: 3.4, dialPinch: 0.14, bezel: 'shaped', bezelScale: 1,    lugs: false, lugShift: 0,   attach: 19.2 },
};

export function ptAt(a, b, n, pinch, th) {
  if (n === 0) { const st = Math.sin(th), y = b * Math.cos(th), u = y / b; return [a * st * Math.pow(Math.abs(st), 0.35) + pinch * a * u * (1 - u * u) * 2, y]; }
  const dx = Math.sin(th), dy = Math.cos(th);
  const r = Math.pow(Math.pow(Math.abs(dx / a), n) + Math.pow(Math.abs(dy / b), n), -1 / n);
  const y = dy * r; return [dx * r * (1 - pinch * (y / b) * (y / b)), y];
}
export function outline(a, b, n, pinch, N = 120) { const o = []; for (let i = 0; i < N; i++) o.push(ptAt(a, b, n, pinch, i / N * TAU)); return o; }

function handSet(style, L) {
  const f = L / 16.6, sc = pts => pts.map(([x, y]) => [x * f, y * f]);
  if (style === 'slim') return {
    hour: [[-0.3, -1.2], [0.3, -1.2], [0.42, 1.2], [0, 0.6 * L], [-0.42, 1.2]],
    min: [[-0.26, -1.5], [0.26, -1.5], [0.34, 1.5], [0, 0.88 * L], [-0.34, 1.5]],
    sec: [[-0.1, -2.4], [0.1, -2.4], [0.06, 0.9 * L], [-0.06, 0.9 * L]] };
  if (style === 'baton') return {
    hour: [[-0.62, -2], [0.62, -2], [0.62, 0.55 * L], [0, 0.62 * L], [-0.62, 0.55 * L]],
    min: [[-0.5, -2.6], [0.5, -2.6], [0.5, 0.84 * L], [0, 0.9 * L], [-0.5, 0.84 * L]],
    sec: [[-0.55, -4.6], [0.55, -4.6], [0.16, -2.2], [0.08, 0.93 * L], [-0.08, 0.93 * L], [-0.16, -2.2]] };
  return {
    hour: sc([[-0.75, -2.2], [0.75, -2.2], [1.15, 1.6], [0, 9.8], [-1.15, 1.6]]),
    min: sc([[-0.55, -2.6], [0.55, -2.6], [0.9, 1.8], [0, 14.4], [-0.9, 1.8]]),
    sec: sc([[-0.55, -4.4], [0.55, -4.4], [0.3, -2.2], [0.1, 15.2], [-0.1, 15.2], [-0.3, -2.2]]) };
}

function dialPrims(sh, D) {
  const P = [], a = sh.dialA, b = sh.dialB, n = sh.dialN, pn = sh.dialPinch, L = Math.min(a, b);
  const at = (th, f) => { const [x, y] = ptAt(a, b, n, pn, th); return [x * f, y * f]; };
  const hr = i => i / 12 * TAU, mn = i => i / 60 * TAU;
  const bar = (th, f0, f1, w, fill, stroke, sw, op) => { const [x0, y0] = at(th, f0), [x1, y1] = at(th, f1); P.push({ t: 'bar', x0, y0, x1, y1, w, fill, stroke, sw, op }); };
  const dot = (th, f, r, fill, stroke, sw) => { const [x, y] = at(th, f); P.push({ t: 'dot', x, y, r, fill, stroke, sw }); };
  const tri = (f0, f1, w, fill, stroke, sw) => { const y0 = at(0, f0)[1], y1 = at(0, f1)[1]; P.push({ t: 'poly', pts: [[-w / 2, y0], [w / 2, y0], [0, y1]], fill, stroke, sw }); };
  const txt = (text, x, y, size, font, fill, track, weight) => P.push({ t: 'text', text, x, y, size, font, fill, track: track || 0, weight: weight || 400 });
  const mode = D.numerals || 'roman';
  if (mode !== 'tonneau') for (let i = 0; i < 60; i++) if (i % 5) bar(mn(i), 0.915, 0.955, 0.1, D.ink, null, 0, 0.75);
  const NUM = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
  if (mode === 'roman') {
    const y0 = at(0, 0.855)[1], y1 = at(0, 0.955)[1];
    [-0.37, 0.37].forEach(x => P.push({ t: 'bar', x0: x, y0, x1: x, y1, w: 0.36, fill: D.idx }));
    for (let i = 1; i < 12; i++) bar(hr(i), 0.855, 0.955, 0.45, D.idx);
    P.push({ t: 'ring', f: 0.835, stroke: D.idx, sw: 0.07, op: 0.45 });
    NUM.forEach((s, i) => { const [x, y] = at(hr(i), 0.665); txt(s, x, y - 0.008 * L, 0.12 * L, FONTS.roman, D.ink); });
  } else if (mode === 'xii-vi') {
    if (D.ring) P.push({ t: 'ring', f: 0.46, stroke: D.ink, sw: 0.065, op: 0.5, fill: D.ringFill || 'rgba(0,0,0,0.08)' });
    for (let i = 0; i < 12; i++) if (i % 6) bar(hr(i), 0.7, 0.9, 0.32, D.idx);
    [0, 6].forEach(i => { const [x, y] = at(hr(i), 0.72); txt(NUM[i], x, y - 0.01 * L, 0.15 * L, FONTS.roman, D.ink); });
  } else if (mode === 'sticks') {
    for (let i = 1; i < 12; i++) bar(hr(i), 0.68, 0.9, 0.42, D.idx);
    tri(0.9, 0.76, 1.7, D.idx);
  } else if (mode === 'tonneau') {
    P.push({ t: 'ring', f: 0.965, stroke: D.idx, sw: 0.14, op: 0.9 });
    [0, 6].forEach(i => bar(hr(i), 0.76, 0.9, 1.05, D.idx));
    [3, 9].forEach(i => dot(hr(i), 0.84, 0.46, '#FFFFFF', D.idx, 0.16));
  } else if (mode === 'eye') {
    P.push({ t: 'ring', f: 0.97, stroke: 'rgba(0,0,0,0.55)', sw: 0.5, op: 1 });
    [0, 6].forEach(i => dot(hr(i), 0.56, 0.42, '#FFFFFF', D.idx, 0.14));
  } else if (mode === 'dots') {
    for (let i = 1; i < 12; i++) {
      if (i % 3) dot(hr(i), 0.8, 0.72, D.idx, D.ink, 0.14);
      else bar(hr(i), 0.68, 0.9, 0.8, D.idx, D.ink, 0.14);
    }
    tri(0.92, 0.66, 2.4, D.idx, D.ink, 0.14);
  }
  const wf = D.font === 'serif' ? FONTS.serif : FONTS.roman, wy = (D.wordY ?? 0.36) * b;
  txt('MERAVS', 0, wy, (D.font === 'serif' ? 0.1 : 0.068) * Math.max(L, 14), wf, D.ink, 0.34, D.font === 'serif' ? 600 : 400);
  if (D.sub) txt(D.sub.text, 0, (D.sub.y ?? -0.36) * b, (D.sub.size ?? 0.12) * L, FONTS[D.sub.font] || FONTS.script, D.sub.color || D.ink, 0, 400);
  return P;
}

export function spec(m) {
  m = m || {};
  const shape = SHAPES[m.shape] ? m.shape : 'round', sh = SHAPES[shape], D = m.dial || DEFAULT_DIAL;
  const metal = m.metal || 'gold', accent = m.accent || metal, hand = m.hand || accent;
  const L = Math.min(sh.dialA, sh.dialB);
  return {
    ...sh, shape, D, metal, accent, hand, crown: m.crown || metal,
    caseFinish: m.caseFinish || (shape === 'round' ? 'brushed' : 'polished'),
    bezelType: m.bezel || 'smooth',
    handStyle: m.hands || 'dauphine', seconds: m.seconds !== false, secColor: m.secColor || '#D2543F',
    hands: handSet(m.hands || 'dauphine', L),
    bracelet: Object.assign({ center: metal === accent ? 'metal' : 'accent', centerFinish: 'polished', outerFinish: 'brushed', scale: 1, pitch: 4.75, centerW: 7, outerW: 5.3, outerX: 6.45 }, m.bracelet || {}),
    stripes: D.style === 'stripes' ? (D.stripeDir || 'h') : null, waves: D.style === 'waves',
    texHalf: Math.max(sh.dialA, sh.dialB),
    prims: dialPrims(sh, D),
    fonts: [...new Set([FONTS.roman, D.font === 'serif' ? FONTS.serif : null, D.sub ? (FONTS[D.sub.font] || FONTS.script) : null].filter(Boolean))],
  };
}

export function barPoly(p) {
  const dx = p.x1 - p.x0, dy = p.y1 - p.y0, l = Math.hypot(dx, dy) || 1, nx = -dy / l * p.w / 2, ny = dx / l * p.w / 2;
  return [[p.x0 + nx, p.y0 + ny], [p.x1 + nx, p.y1 + ny], [p.x1 - nx, p.y1 - ny], [p.x0 - nx, p.y0 - ny]];
}
