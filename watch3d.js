// Meravs procedural 3D watch. Shared by Home and Watch pages.
const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const D2R = Math.PI / 180;
import { spec, outline, barPoly, METAL3D, DEFAULT_DIAL } from './watchshape.js';

function loadThree() {
  if (window.THREE) return Promise.resolve(window.THREE);
  if (window.__meravsThree) return window.__meravsThree;
  window.__meravsThree = new Promise(res => {
    const sc = document.createElement('script');
    sc.src = THREE_URL; sc.async = true; sc.crossOrigin = 'anonymous';
    sc.onload = () => res(window.THREE || null); sc.onerror = () => res(null);
    document.head.appendChild(sc);
    setTimeout(() => res(window.THREE || null), 15000);
  });
  return window.__meravsThree;
}

export function light() {
  if (!window.MERAVS_LIGHT) window.MERAVS_LIGHT = { x: .3, y: .2, tx: .3, ty: .2 };
  return window.MERAVS_LIGHT;
}

export class MeravsWatch {
  constructor(o) {
    Object.assign(this, { explodeEl: null, pinEl: null, onProgress: null, labels: null, readout: null, onReady: () => {}, forceFallback: false }, o);
    this.model = o.model || { metal: 'gold', dial: DEFAULT_DIAL };
    this.yaw = o.yaw ?? -0.42; this.pitch = -0.2; this.vYaw = 0; this.vPitch = 0; this.lastTouch = -1e9; this.p = 0; this.lastSec = -1;
    this.reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.inView = true;
    this.onVis = () => { if (!document.hidden) this.kick(); };
    document.addEventListener('visibilitychange', this.onVis);
    if ('IntersectionObserver' in window) {
      this.io = new IntersectionObserver(([en]) => { this.inView = en.isIntersecting; if (this.gl) { this.gl.n = 0; this.gl.acc = 0; } if (this.inView) this.kick(); }, { rootMargin: '80px' });
      this.io.observe(this.wrap);
    }
    this.bindDrag();
    this.last = performance.now();
    this.frame(this.last);
    this.kick();
    this.start();
  }

  destroy() {
    this.dead = true; cancelAnimationFrame(this.raf);
    document.removeEventListener('visibilitychange', this.onVis);
    this.io && this.io.disconnect();
    this.unbind && this.unbind();
    this.teardown(true);
  }

  kick() { if (!this.raf && !this.dead) this.raf = requestAnimationFrame(this.loop); }
  loop = now => { this.raf = null; if (document.hidden || this.dead || !this.inView) return; this.frame(now); this.kick(); };

  bindDrag() {
    const el = this.wrap, K = 0.0065;
    const down = e => {
      if (!this.gl || (e.target.closest && e.target.closest('button'))) return;
      this.poseLock = false;
      this.drag = { x: e.clientX, y: e.clientY, t: performance.now() };
      this.vYaw = this.vPitch = 0;
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      el.style.cursor = 'grabbing';
    };
    const move = e => {
      const d = this.drag; if (!d) return;
      const now = performance.now(), dx = e.clientX - d.x, dy = e.clientY - d.y, dtm = Math.max(8, now - d.t);
      const py = e.pointerType === 'mouse' ? dy : 0;
      this.yaw += dx * K; this.pitch = clamp(this.pitch + py * K, -1.35, 1.35);
      this.vYaw = clamp(this.vYaw * 0.4 + (dx * K / dtm * 1000) * 0.6, -8, 8);
      this.vPitch = clamp(this.vPitch * 0.4 + (py * K / dtm * 1000) * 0.6, -8, 8);
      d.x = e.clientX; d.y = e.clientY; d.t = now; this.lastTouch = now;
      if (e.pointerType !== 'mouse') { const L = light(); L.tx = e.clientX / innerWidth; L.ty = e.clientY / innerHeight; }
    };
    const end = () => {
      if (!this.drag) return;
      if (performance.now() - this.drag.t > 90) this.vYaw = this.vPitch = 0;
      this.drag = null; this.lastTouch = performance.now(); el.style.cursor = 'grab';
    };
    const spin = () => { if (this.gl) { this.vYaw = 8; this.lastTouch = performance.now(); this.kick(); } };
    el.addEventListener('dblclick', spin);
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move);
    const ends = ['pointerup', 'pointercancel', 'lostpointercapture'];
    ends.forEach(n => el.addEventListener(n, end));
    this.unbind = () => { el.removeEventListener('dblclick', spin); el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); ends.forEach(n => el.removeEventListener(n, end)); };
  }

  frame(now) {
    const dt = clamp((now - this.last) / 1000, 0.001, 0.05); this.last = now;
    const ist = (Date.now() + 19800000) % 86400000;
    let s = (ist % 60000) / 1000; if (this.reduce) s = Math.floor(s);
    const mins = Math.floor(ist / 60000) % 60, hrs = Math.floor(ist / 3600000);
    const whole = Math.floor(ist / 1000);
    if (whole !== this.lastSec && this.readout) {
      this.lastSec = whole;
      const p2 = n => String(n).padStart(2, '0');
      const pose = hrs % 12 === 10 && mins === 10;
      this.readout.textContent = `IST ${p2(hrs)}:${p2(mins)}:${p2(Math.floor(s))}` + (pose ? ' · THE HOUR WATCHES POSE AT' : '');
    }
    if (this.gl) this.render(dt, now, s * 6, (mins + s / 60) * 6, ((hrs % 12) + mins / 60 + s / 3600) * 30);
  }

  async start() {
    if (this.forceFallback || this.reduce || this.gl) return;
    const mem = navigator.deviceMemory, cores = navigator.hardwareConcurrency;
    const save = navigator.connection && navigator.connection.saveData;
    if (save || (mem && mem < 2) || (cores && cores <= 2)) return;
    try { const t = document.createElement('canvas'); if (!(t.getContext('webgl') || t.getContext('experimental-webgl'))) return; } catch (_) { return; }
    const THREE = await loadThree();
    if (!THREE || this.dead || this.forceFallback) return;
    try { await Promise.race([document.fonts.load('400 64px "Marcellus"'), new Promise(r => setTimeout(r, 2500))]); } catch (_) {}
    if (this.dead || this.forceFallback || this.gl) return;
    try { this.build(THREE); } catch (e) { console.warn('Meravs: 3D unavailable, showing the 2D dial.', e); this.teardown(); }
  }

  setExplode(on) { this.manual = !!on; this.poseLock = !!on; this.kick(); }

  setFallback(on) { this.forceFallback = on; if (on) this.teardown(); else this.start(); }

  ensureFonts() {
    const sp = spec(this.model);
    const loads = sp.fonts.map(f => document.fonts.load((f === 'Cormorant Garamond' ? '600' : '400') + ' 48px "' + f + '"').catch(() => {}));
    Promise.race([Promise.all(loads), new Promise(r => setTimeout(r, 3000))]).then(() => { if (this.gl && !this.dead) this.drawDial(); });
  }

  drawDial() {
    const G = this.gl, x = G.dialCtx, S = 1024, c = S / 2, sp = spec(this.model), D = sp.D, k = c / sp.texHalf;
    const X = v => c + v * k, Y = v => c - v * k;
    const path = pts => { x.beginPath(); pts.forEach(([px, py], i) => i ? x.lineTo(X(px), Y(py)) : x.moveTo(X(px), Y(py))); x.closePath(); };
    const dialO = outline(sp.dialA, sp.dialB, sp.dialN, sp.dialPinch, 160);
    x.save(); x.clearRect(0, 0, S, S);
    path(dialO); x.clip();
    let g = x.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, D.d0); g.addColorStop(0.55, D.d1); g.addColorStop(1, D.d2);
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    if (sp.stripes === 'h') for (let yy = 0; yy < S; yy += 7) { x.fillStyle = 'rgba(0,0,0,0.055)'; x.fillRect(0, yy, S, 2.5); }
    else if (sp.waves) { x.lineWidth = 2.2; x.strokeStyle = 'rgba(255,255,255,0.10)'; for (let r = 40; r < S * 1.6; r += 13) { x.beginPath(); x.arc(-S * 0.25, S * 1.15, r, 0, Math.PI * 2); x.stroke(); } }
    else if (sp.stripes === 'v') for (let xx = 0; xx < S; xx += 6) { x.fillStyle = 'rgba(0,0,0,0.06)'; x.fillRect(xx, 0, 2.2, S); }
    else for (let i = 0; i < 540; i++) {
      const a0 = i / 540 * Math.PI * 2, a1 = (i + 1.05) / 540 * Math.PI * 2, v = G.rnd[i];
      x.beginPath(); x.moveTo(c, c); x.arc(c, c, c * 1.5, a0, a1); x.closePath();
      x.fillStyle = v > 0.5 ? 'rgba(210,218,230,' + ((v - 0.5) * 0.1).toFixed(3) + ')' : 'rgba(0,0,0,' + ((0.5 - v) * 0.16).toFixed(3) + ')';
      x.fill();
    }
    g = x.createRadialGradient(c, c, c * 0.72, c, c, c);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, sp.stripes ? 'rgba(0,0,0,0.16)' : 'rgba(0,0,0,0.42)');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    const paint = (p, fill) => { if (p.fill || fill) { x.fillStyle = p.fill || fill; x.fill(); } if (p.stroke && p.sw) { x.strokeStyle = p.stroke; x.lineWidth = p.sw * k; x.stroke(); } };
    sp.prims.forEach(p => {
      x.globalAlpha = p.op ?? 1;
      if (p.t === 'bar') { path(barPoly(p)); paint(p); }
      else if (p.t === 'poly') { path(p.pts); paint(p); }
      else if (p.t === 'dot') { x.beginPath(); x.arc(X(p.x), Y(p.y), p.r * k, 0, Math.PI * 2); paint(p); }
      else if (p.t === 'ring') {
        path(dialO.map(([px, py]) => [px * p.f, py * p.f]));
        if (p.fill) { x.fillStyle = p.fill; x.fill(); }
        x.strokeStyle = p.stroke; x.lineWidth = p.sw * k; x.stroke();
      } else if (p.t === 'text') {
        const px = p.size * k;
        x.font = p.weight + ' ' + px.toFixed(1) + 'px "' + p.font + '", serif';
        x.fillStyle = p.fill; x.textAlign = 'center'; x.textBaseline = 'middle';
        if (!p.track) x.fillText(p.text, X(p.x), Y(p.y));
        else {
          const tr = px * p.track, ws = [...p.text].map(ch => x.measureText(ch).width);
          let cx = X(p.x) - (ws.reduce((s, v) => s + v, 0) + tr * (ws.length - 1)) / 2;
          [...p.text].forEach((ch, i) => { x.fillText(ch, cx + ws[i] / 2, Y(p.y)); cx += ws[i] + tr; });
        }
      }
      x.globalAlpha = 1;
    });
    x.restore();
    G.dialTex.needsUpdate = true;
  }

  setModel(model) {
    this.model = model;
    const G = this.gl; if (!G) return;
    G.sheenMat.color.copy(new G.THREE.Color((model.dial || DEFAULT_DIAL).sheen).convertSRGBToLinear());
    this.buildWatch();
    this.drawDial(); this.ensureFonts();
    this.kick();
  }

  makeSheen(THREE) {
    const S = 512, c = S / 2;
    const cv = document.createElement('canvas'); cv.width = cv.height = S;
    const x = cv.getContext('2d'), N = 720;
    for (let i = 0; i < N; i++) {
      const a = i / N * Math.PI * 2, I = Math.pow(Math.abs(Math.cos(a)), 12) * (0.65 + 0.35 * Math.random());
      x.beginPath(); x.moveTo(c, c); x.arc(c, c, c, a, a + Math.PI * 2 / N * 1.1); x.closePath();
      x.fillStyle = 'rgba(255,255,255,' + I.toFixed(3) + ')'; x.fill();
    }
    x.globalCompositeOperation = 'destination-in';
    const g = x.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, 'rgba(0,0,0,0.1)'); g.addColorStop(0.3, 'rgba(0,0,0,0.75)'); g.addColorStop(0.85, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0.5)');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    const tex = new THREE.CanvasTexture(cv); tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  build(THREE) {
    const canvas = this.canvas;
    const touch = matchMedia('(hover: none)').matches;
    const pr = Math.min(touch ? 1.5 : 2, window.devicePixelRatio || 1);
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: pr < 1.5, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(pr); renderer.setClearColor(0x000000, 0);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    const lin = h => new THREE.Color(h).convertSRGBToLinear();
    const keyPos = new THREE.Vector3(-28, 32, 30);

    const env = new THREE.Scene();
    const sph = new THREE.SphereGeometry(50, 32, 16);
    const cols = [], pos = sph.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getY(i) / 50 * 0.5 + 0.5;
      const v = t < 0.5 ? 0.008 + t * 0.09 : 0.053 + (t - 0.5) * 0.3;
      cols.push(v * 0.92, v * 0.97, v * 1.08);
    }
    sph.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    env.add(new THREE.Mesh(sph, new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true })));
    const panel = (w, h, p, v) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(v, v, v * 1.02), side: THREE.DoubleSide }));
      m.position.set(p[0], p[1], p[2]); m.lookAt(0, 0, 0); env.add(m);
    };
    panel(34, 22, keyPos.toArray(), 7); panel(5, 44, [40, 4, -22], 4.5); panel(44, 8, [6, -30, 34], 1.1);
    panel(24, 24, [0, 46, -6], 2.2); panel(4, 30, [-40, -2, -10], 1.6);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(env, 0.035).texture;
    pmrem.dispose(); env.traverse(o => { o.geometry && o.geometry.dispose(); o.material && o.material.dispose(); });

    const scene = new THREE.Scene(); scene.environment = envTex;
    const key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.copy(keyPos); scene.add(key);
    const camera = new THREE.PerspectiveCamera(26, 1, 10, 500);
    const rig = new THREE.Group(); scene.add(rig); rig.add(camera);
    const pivot = new THREE.Group(); rig.add(pivot);
    const inner = new THREE.Group(); pivot.add(inner);

    const red = new THREE.MeshStandardMaterial({ color: lin('#D2543F'), metalness: 0.15, roughness: 0.42 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x000000, metalness: 0, roughness: 0.04, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const dialCv = document.createElement('canvas'); dialCv.width = dialCv.height = 1024;
    const dialTex = new THREE.CanvasTexture(dialCv); dialTex.encoding = THREE.sRGBEncoding;
    dialTex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    const sheenTex = this.makeSheen(THREE);
    const dialMat = new THREE.MeshPhysicalMaterial({ map: dialTex, metalness: 0.35, roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.06 });
    const sheenMat = new THREE.MeshBasicMaterial({ map: sheenTex, color: lin((this.model.dial || DEFAULT_DIAL).sheen), transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });

    this.gl = {
      THREE, renderer, scene, camera, rig, pivot, inner, red, glass, dialMat, sheenMat, dialTex,
      disposables: [envTex, red, glass, dialTex, sheenTex, dialMat, sheenMat],
      dialCtx: dialCv.getContext('2d'), rnd: Array.from({ length: 540 }, () => Math.random()),
      keyDir: keyPos.clone().normalize(), pr, fc: 0, n: 0, acc: 0, bad: 0, first: true, modelDisp: [],
      tmp: { p: new THREE.Vector3(), c: new THREE.Vector3(), v: new THREE.Vector3(), h: new THREE.Vector3(), q: new THREE.Quaternion() },
    };
    this.buildWatch();
    this.drawDial(); this.ensureFonts();
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(this.wrap);
    this.resize();
    this.kick();
  }

  buildWatch() {
    const G = this.gl, THREE = G.THREE, inner = G.inner, sp = spec(this.model);
    inner.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    G.modelDisp.forEach(d => d.dispose()); G.modelDisp = [];
    while (inner.children.length) inner.remove(inner.children[0]);
    const lin = h => new THREE.Color(h).convertSRGBToLinear();
    const mk = (tone, rough, extra) => { const pale = tone === 'steel' || tone === 'rose'; const m = new THREE.MeshStandardMaterial(Object.assign({ color: lin(METAL3D[tone] || METAL3D.gold), metalness: 1, roughness: pale ? Math.max(rough, tone === 'rose' ? 0.3 : 0.28) : rough, envMapIntensity: tone === 'rose' ? 2.8 : pale ? 1.9 : 1, side: THREE.DoubleSide }, extra || {})); G.modelDisp.push(m); return m; };
    const caseMat = mk(sp.metal, sp.caseFinish === 'polished' ? 0.16 : 0.34);
    const polished = mk(sp.metal, 0.15), bezelMat = mk(sp.accent, 0.15), handMat = mk(sp.hand, 0.18);
    const crownMat = mk(sp.crown, 0.25, { flatShading: true });
    const B = sp.bracelet;
    const linkC = mk(B.center === 'accent' ? sp.accent : sp.metal, B.centerFinish === 'brushed' ? 0.34 : 0.15, { side: THREE.FrontSide });
    const linkO = mk(sp.metal, B.outerFinish === 'polished' ? 0.15 : 0.34, { side: THREE.FrontSide });

    const V2 = p => new THREE.Vector2(p[0], p[1]);
    const shapeOf = (pts, holePts) => { const s = new THREE.Shape(pts.map(V2)); if (holePts) s.holes.push(new THREE.Path(holePts.map(V2))); return s; };
    const lathe = (pts, mat, seg = 72, scale = 1) => {
      const m = new THREE.Mesh(new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0] * scale, p[1])), seg), mat);
      m.rotation.x = Math.PI / 2; return m;
    };
    const ring = (outer, hole, z0, z1, bev, mat) => {
      const geo = new THREE.ExtrudeGeometry(shapeOf(outer, hole), { depth: Math.max(0.05, z1 - z0 - 2 * bev), bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev, bevelSegments: 3, curveSegments: 4 });
      const m = new THREE.Mesh(geo, mat); m.position.z = z0 + bev; return m;
    };
    const sc = (pts, f, g) => pts.map(([x, y]) => [x * f, y * (g ?? f)]);
    const Grp = () => { const g = new THREE.Group(); inner.add(g); return g; };
    const caseO = outline(sp.caseA, sp.caseB, sp.caseN, sp.casePinch, 140);
    const dialO = outline(sp.dialA, sp.dialB, sp.dialN, sp.dialPinch, 140);

    const caseG = Grp();
    if (sp.shape === 'round') {
      caseG.add(lathe([[17, -3.4], [19, -3.4], [19, -3.4], [19.8, -2.2], [20.1, 0], [19.8, 1.8], [19.2, 2.5], [19.2, 2.5], [17, 2.5], [17, 2.5], [17, -3.4]], caseMat));
    } else {
      const bev = 0.8, shrink = pts => pts.map(([x, y]) => { const l = Math.hypot(x, y) || 1; return [x - x / l * bev, y - y / l * bev]; });
      const hole = sp.bezel === 'round' ? outline(sp.dialA * 1.06, sp.dialA * 1.06, 2, 0, 96) : sc(dialO, 1.04);
      caseG.add(ring(shrink(caseO), hole, -3.4, 2.5, bev, caseMat));
    }
    if (sp.lugs) {
      const lugShape = new THREE.Shape();
      lugShape.moveTo(18.5, 1.6); lugShape.lineTo(23.6, 0.7); lugShape.lineTo(24.4, -0.5); lugShape.lineTo(23.8, -2.3); lugShape.lineTo(18.5, -3.0); lugShape.closePath();
      const lugGeo = new THREE.ExtrudeGeometry(lugShape, { depth: 1.8, bevelEnabled: true, bevelThickness: 0.3, bevelSize: 0.3, bevelSegments: 2, curveSegments: 4 });
      lugGeo.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
      [[1, 1], [-1, 1], [1, -1], [-1, -1]].forEach(([sx, sy]) => { const m = new THREE.Mesh(lugGeo, caseMat); m.position.x = sx > 0 ? 9.2 : -11; m.position.y = sy * sp.lugShift; m.scale.y = sy; caseG.add(m); });
    }
    const crownR = sp.shape === 'tonneau' ? 1.35 : 2.1, cx = sp.caseA;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(crownR * 0.42, crownR * 0.42, 1.6, 16), polished); stem.rotation.z = Math.PI / 2; stem.position.set(cx + 0.5, 0, -0.4); caseG.add(stem);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(crownR, crownR, crownR * 1.25, 28), crownMat); crown.rotation.z = Math.PI / 2; crown.position.set(cx + 1.3 + crownR * 0.62, 0, -0.4); caseG.add(crown);

    const bezelG = Grp();
    let bezelOuterA, crystalZ;
    if (sp.bezel === 'round') {
      const bs = sp.bezelScale, pts = [[16.9, 2.5], [19.3, 2.5], [19.3, 2.5], [19.45, 3.1], [18.8, 4.0], [17.6, 4.35], [16.9, 4.2], [16.9, 4.2], [16.9, 2.5]];
      const bz = lathe(pts, bezelMat, sp.bezelType === 'fluted' ? 240 : 72, bs);
      if (sp.bezelType === 'fluted') {
        const pa = bz.geometry.attributes.position;
        for (let i = 0; i < pa.count; i++) {
          const px = pa.getX(i), py = pa.getY(i), pz = pa.getZ(i), r = Math.hypot(px, pz);
          if (r > 17.4 * bs && py > 2.6) { const th = Math.atan2(pz, px), kk = 1 - 0.028 * Math.pow(Math.abs(Math.cos(th * 45)), 0.6) * Math.min(1, (r - 17.4 * bs) / 1.2); pa.setX(i, px * kk); pa.setZ(i, pz * kk); }
        }
        bz.geometry.computeVertexNormals();
      }
      bezelG.add(bz);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(sp.dialA + 0.15, 0.42, 10, 72), polished); rim.position.z = 1.3; bezelG.add(rim);
      bezelOuterA = 19.45 * bs; crystalZ = 4.15;
    } else {
      bezelG.add(ring(sc(caseO, 0.9), sc(dialO, 1.02), 2.3, 3.5, 0.4, bezelMat));
      bezelOuterA = sp.caseA * 0.9; crystalZ = 3.6;
    }

    const crystalG = Grp();
    if (sp.bezel === 'round') crystalG.add(lathe([[16.9, 4.15], [13, 4.5], [7, 4.75], [0, 4.82]], G.glass, 64, sp.bezelScale));
    else { const cr = ring(sc(dialO, 1.03), null, 3.3, 3.75, 0, G.glass); crystalG.add(cr); }

    const dialG = Grp();
    const th = sp.texHalf;
    const dialGeo = new THREE.ShapeGeometry(shapeOf(dialO), 1);
    { const pa = dialGeo.attributes.position, uv = dialGeo.attributes.uv; for (let i = 0; i < pa.count; i++) uv.setXY(i, pa.getX(i) / (2 * th) + 0.5, pa.getY(i) / (2 * th) + 0.5); uv.needsUpdate = true; }
    const dial = new THREE.Mesh(dialGeo, G.dialMat); dial.position.z = 1.0; dialG.add(dial);
    const sheen = new THREE.Mesh(dialGeo.clone(), G.sheenMat); sheen.position.z = 0.02; dial.add(sheen);

    const handGeo = (pts, depth) => new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(V2)), { depth, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 1, curveSegments: 4 });
    const handSetG = (pts, depth, mat, z) => { const e = Grp(), r = new THREE.Group(); e.add(r); r.position.z = z; r.add(new THREE.Mesh(handGeo(pts, depth), mat)); return { e, r }; };
    const L = Math.min(sp.dialA, sp.dialB), hubR = sp.handStyle === 'slim' ? 0.7 : 1.25;
    const hourH = handSetG(sp.hands.hour, 0.26, handMat, 1.35);
    const minH = handSetG(sp.hands.min, 0.26, handMat, 1.85);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(hubR, hubR, 0.5, 24), handMat); hub.rotation.x = Math.PI / 2; hub.position.z = 2.2; minH.e.add(hub);
    let secH = null;
    if (sp.seconds) {
      const secMat = new THREE.MeshStandardMaterial({ color: lin(sp.secColor), metalness: sp.secColor === '#D2543F' ? 0.15 : 1, roughness: sp.secColor === '#D2543F' ? 0.42 : 0.2, envMapIntensity: 1.8 }); G.modelDisp.push(secMat);
      secH = handSetG(sp.hands.sec, 0.16, secMat, 2.4);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.35, 16), secMat); cap.rotation.x = Math.PI / 2; cap.position.z = 2.75; secH.e.add(cap);
    }

    const moveG = Grp();
    {
      const MR = Math.min(sp.dialA, sp.dialB) * 0.86;
      const std = (hex, metal, rough) => { const m = new THREE.MeshStandardMaterial({ color: lin(hex), metalness: metal, roughness: rough, envMapIntensity: metal ? 1.8 : 1 }); G.modelDisp.push(m); return m; };
      const plastic = std('#1B1D22', 0, 0.55), pcb = std('#C9A55C', 1, 0.3), cell = std('#D5D9DE', 1, 0.22), copper = std('#C0763C', 1, 0.35), brass = std('#D8B970', 1, 0.28);
      const cyl = (r, h, mat, seg = 40) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
      const flat = m => { m.rotation.x = Math.PI / 2; return m; };
      const frame = flat(cyl(MR, 2.0, plastic, 64)); frame.position.z = -1.6; moveG.add(frame);
      const bz = -2.6;
      const board = new THREE.Mesh(new THREE.BoxGeometry(MR * 0.62, MR * 1.1, 0.16), pcb); board.position.set(-MR * 0.32, 0, bz - 0.08); moveG.add(board);
      const battery = flat(cyl(MR * 0.42, 0.6, cell, 48)); battery.position.set(MR * 0.38, -MR * 0.18, bz - 0.3); moveG.add(battery);
      const clip = new THREE.Mesh(new THREE.BoxGeometry(MR * 0.5, MR * 0.08, 0.1), pcb); clip.position.set(MR * 0.38, -MR * 0.18, bz - 0.65); moveG.add(clip);
      const coil = cyl(MR * 0.13, MR * 0.5, copper, 24); coil.rotation.z = Math.PI / 2; coil.position.set(-MR * 0.3, MR * 0.45, bz - 0.35); moveG.add(coil);
      const core = new THREE.Mesh(new THREE.BoxGeometry(MR * 0.9, MR * 0.09, 0.12), cell); core.position.set(-MR * 0.22, MR * 0.45, bz - 0.12); moveG.add(core);
      const xtal = cyl(MR * 0.06, MR * 0.26, cell, 16); xtal.rotation.z = Math.PI / 2; xtal.position.set(-MR * 0.4, -MR * 0.45, bz - 0.22); moveG.add(xtal);
      const chip = new THREE.Mesh(new THREE.BoxGeometry(MR * 0.14, MR * 0.14, 0.1), plastic); chip.position.set(-MR * 0.4, -MR * 0.12, bz - 0.2); moveG.add(chip);
      [[0, 0, 0.36], [MR * 0.34, MR * 0.3, 0.26], [-MR * 0.18, MR * 0.46, 0.2], [MR * 0.1, -MR * 0.42, 0.22]].forEach(([gx, gy, gr]) => {
        const g = flat(cyl(MR * gr, 0.2, brass, 30)); g.position.set(gx, gy, -0.5); moveG.add(g);
        const p = flat(cyl(MR * 0.05, 0.6, cell, 12)); p.position.set(gx, gy, -0.35); moveG.add(p);
      });
      G.moveR = MR;
    }
    const backG = Grp();
    if (sp.shape === 'round') backG.add(lathe([[0, -5.1], [14.5, -4.9], [17, -4.3], [17.4, -3.5], [17.4, -3.5], [0, -3.5]], caseMat));
    else backG.add(ring(sc(caseO, 0.84), null, -5.0, -3.4, 0.45, caseMat));

    const braceG = Grp();
    const s = B.scale, att = sp.attach, pitch = B.pitch;
    const start = sp.lugs ? att - 1.8 : att - 0.6, zT = sp.lugs ? -1.0 : -1.2;
    const run = 0.4, rx = Math.max(6, pitch * 2.2), h1 = Math.max(11, pitch * 3.4), Y = start + run + rx, az = Math.max(24, 44 - h1);
    const segs = [
      ['l', start, zT, start + run, zT],
      ['e', start + run, zT - h1, rx, h1, Math.PI / 2, 0],
      ['e', 0, zT - h1, Y, az, 0, -Math.PI],
      ['e', -(start + run), zT - h1, rx, h1, Math.PI, Math.PI / 2],
      ['l', -(start + run), zT, -start, zT],
    ];
    const path = [];
    segs.forEach(sg => {
      if (sg[0] === 'l') { const n = Math.max(2, Math.ceil(Math.hypot(sg[3] - sg[1], sg[4] - sg[2]) / 0.25)); for (let i = 0; i < n; i++) path.push([sg[1] + (sg[3] - sg[1]) * i / n, sg[2] + (sg[4] - sg[2]) * i / n]); }
      else if (sg[0] === 'e') { const n = 260; for (let i = 0; i < n; i++) { const t = sg[5] + (sg[6] - sg[5]) * i / n; path.push([sg[1] + sg[3] * Math.cos(t), sg[2] + sg[4] * Math.sin(t)]); } }
      else { const n = Math.max(4, Math.ceil(Math.abs(sg[5] - sg[4]) * sg[3] / 0.25)); for (let i = 0; i < n; i++) { const t = sg[4] + (sg[5] - sg[4]) * i / n; path.push([sg[1] + sg[3] * Math.cos(t), sg[2] + sg[3] * Math.sin(t)]); } }
    });
    path.push([-start, zT]);
    const lens = [0];
    for (let i = 1; i < path.length; i++) lens.push(lens[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
    const totalLen = lens[lens.length - 1], rows = [];
    const sample = q => {
      let j = 1; while (j < lens.length - 1 && lens[j] < q) j++;
      const f = (q - lens[j - 1]) / Math.max(1e-6, lens[j] - lens[j - 1]);
      const p0 = path[j - 1], p1 = path[j];
      return { y: p0[0] + (p1[0] - p0[0]) * f, z: p0[1] + (p1[1] - p0[1]) * f, a: Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) };
    };
    const nLinks = Math.max(4, Math.round((totalLen - pitch * 0.4) / pitch));
    const pAdj = (totalLen - pitch * 0.9) / Math.max(1, nLinks - 1);
    for (let i = 0; i < nLinks; i++) rows.push(sample(pitch * 0.45 + i * pAdj - (i === nLinks - 1 ? pitch * 0.3 : 0) * 0));
    while (rows.length && Math.abs(rows[rows.length - 1].y) < start - 0.2 && rows[rows.length - 1].z > zT - 1) rows.pop();
    const fullW = Math.max(B.centerW, 2 * (B.outerX + B.outerW / 2)) * s;
    const endGeo = new THREE.BoxGeometry(fullW, 2.4, 2.5 * Math.max(0.8, s));
    [1, -1].forEach(sg => { const e = new THREE.Mesh(endGeo, linkO); e.position.set(0, sg * (start - 0.1), zT); braceG.add(e); });
    if (sp.lugs) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 18.6, 12), polished); bar.rotation.z = Math.PI / 2;
      [1, -1].forEach(sg => { const m = bar.clone(); m.position.set(0, sg * (22.6 + sp.lugShift), -0.9); braceG.add(m); });
    }
    const rr = new THREE.Shape(), q0 = 0.5, rq = 0.24;
    rr.moveTo(-q0 + rq, -q0); rr.lineTo(q0 - rq, -q0); rr.quadraticCurveTo(q0, -q0, q0, -q0 + rq); rr.lineTo(q0, q0 - rq); rr.quadraticCurveTo(q0, q0, q0 - rq, q0);
    rr.lineTo(-q0 + rq, q0); rr.quadraticCurveTo(-q0, q0, -q0, q0 - rq); rr.lineTo(-q0, -q0 + rq); rr.quadraticCurveTo(-q0, -q0, -q0 + rq, -q0);
    const box = new THREE.ExtrudeGeometry(rr, { depth: 0.9, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 2, curveSegments: 5 });
    box.translate(0, 0, -0.45);
    box.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1));
    const centerI = new THREE.InstancedMesh(box, linkC, rows.length), outerI = new THREE.InstancedMesh(box, linkO, rows.length * 2);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), Sc = new THREE.Vector3(), X = new THREE.Vector3(1, 0, 0);
    const lh = pitch * 0.9;
    rows.forEach((r, i) => {
      Q.setFromAxisAngle(X, r.a);
      M.compose(P.set(0, r.y, r.z), Q, Sc.set(B.centerW * s, lh, 2.4 * Math.max(0.8, s))); centerI.setMatrixAt(i, M);
      M.compose(P.set(B.outerX * s, r.y, r.z), Q, Sc.set(B.outerW * s, lh * 0.95, 2.1 * Math.max(0.8, s))); outerI.setMatrixAt(i * 2, M);
      M.compose(P.set(-B.outerX * s, r.y, r.z), Q, Sc.set(B.outerW * s, lh * 0.95, 2.1 * Math.max(0.8, s))); outerI.setMatrixAt(i * 2 + 1, M);
    });
    braceG.add(centerI, outerI);
    if (B.gems) {
      const gemMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0.04, clearcoat: 1, envMapIntensity: 3 }); G.modelDisp.push(gemMat);
      const idx = []; for (let k = 0; k < B.gems; k++) { idx.push(k, rows.length - 1 - k); }
      const gems = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.62, 1), gemMat, idx.length * 2);
      let gi = 0; idx.forEach(k => { const r = rows[k]; if (!r) return; const lift = 1.25 * Math.max(0.8, s); [-1.6, 1.6].forEach(gx => { M.compose(P.set(gx * s, r.y + Math.sin(r.a) * 0, r.z + lift * Math.cos(r.a) * 0), Q.identity(), Sc.set(1, 1, 1)); const o = new THREE.Vector3(0, 0, lift).applyAxisAngle(X, r.a); M.setPosition(gx * s, r.y + o.y, r.z + o.z); gems.setMatrixAt(gi++, M); }); });
      gems.count = gi; braceG.add(gems);
    }

    G.parts = {
      crystal: { obj: crystalG, dz: 27, d: 0 }, bezel: { obj: bezelG, dz: 20, d: 0.05 },
      min: { obj: minH.e, dz: 13.5, d: 0.12 }, hour: { obj: hourH.e, dz: 11.5, d: 0.15 },
      dial: { obj: dialG, dz: 6.5, d: 0.2 }, caseback: { obj: backG, dz: -12, d: 0.08 },
      bracelet: { obj: braceG, dz: -14, d: 0.12 }, case: { obj: caseG, dz: 0, d: 0.2 },
      movement: { obj: moveG, dz: -6.5, d: 0.14 },
    };
    if (secH) G.parts.sec = { obj: secH.e, dz: 15.5, d: 0.09 };
    const bRow = rows[rows.length - 3] || { y: -att, z: -20 };
    const anchors = {
      crystal: [secH ? 'crystal' : 'crystal', [-sp.dialA, 0, crystalZ]], bezel: ['bezel', [-bezelOuterA, 0, 3.1]],
      hands: [secH ? 'sec' : 'min', [0, 0, 2.95]], dial: ['dial', [-sp.dialA, 0, 1.0]], case: ['case', [-sp.caseA, 0, 0]],
      caseback: ['caseback', [-sp.caseA * 0.84, 0, -3.9]], bracelet: ['bracelet', [-(B.outerX + B.outerW / 2) * s, bRow.y, bRow.z]], movement: ['movement', [-G.moveR, 0, -1.6]],
    };
    G.labels = this.labels ? [...this.labels.querySelectorAll('[data-part]')].filter(el => anchors[el.dataset.part]).map(el => {
      const [pk, a] = anchors[el.dataset.part];
      return { el, line: el.querySelector('[data-l]'), text: el.querySelector('[data-t]'), part: G.parts[pk], a: new THREE.Vector3(a[0], a[1], a[2]), tw: 0 };
    }) : [];
    G.dial = dial; G.sheen = sheen; G.braceG = braceG; G.bMats = [linkC, linkO];
    G.hands = { h: hourH.r, m: minH.r, s: secH ? secH.r : null };
  }

  resize() {
    const G = this.gl; if (!G) return;
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight; if (!w || !h) return;
    if (G.w === w && Math.abs(G.h - h) < 2 && !G.force) return; G.force = false;
    G.w = w; G.h = h; G.aspect = w / h;
    G.renderer.setSize(w, h, false);
    G.camera.aspect = G.aspect;
    const hv = G.camera.fov * D2R / 2, hh = Math.atan(Math.tan(hv) * G.aspect);
    G.dist = 37 / Math.sin(Math.min(hv, hh));
    G.camera.updateProjectionMatrix();
  }

  render(dt, now, sa, ma, ha) {
    const G = this.gl, T = G.tmp, L = light();
    let tgt = this.manual ? 1 : 0;
    if (!this.wideMQ) this.wideMQ = matchMedia('(min-width: 900px)');
    if (this.explodeEl && !this.manual && this.wideMQ.matches) {
      if (!this.vh || Math.abs(innerWidth - this.vw) > 1) { this.vw = innerWidth; this.vh = innerHeight; }
      const rect = this.explodeEl.getBoundingClientRect(), vh = this.vh;
      const q = clamp((vh - rect.top) / rect.height, 0, 1);
      tgt = q < 0.7 ? clamp((q - 0.18) / 0.27, 0, 1) : clamp((0.95 - q) / 0.25, 0, 1);
    } else if (this.pinEl && !this.manual && !this.wideMQ.matches) {
      if (!this.vh || Math.abs(innerWidth - this.vw) > 1) { this.vw = innerWidth; this.vh = innerHeight; }
      const rect = this.pinEl.getBoundingClientRect();
      const t = clamp(-rect.top / Math.max(1, rect.height - this.vh), 0, 1);
      tgt = t < 0.16 ? 0 : t < 0.4 ? (t - 0.16) / 0.24 : t < 0.6 ? 1 : t < 0.84 ? 1 - (t - 0.6) / 0.24 : 0;
    }
    this.p += (tgt - this.p) * (1 - Math.exp(-dt * 7));
    const P = this.p, sm = d => { const t = clamp((P - d) / 0.72, 0, 1); return t * t * (3 - 2 * t); };
    const E = sm(0);
    if (this.onProgress && Math.abs(E - (this.lastE ?? -1)) > 0.002) { this.lastE = E; this.onProgress(E); }
    for (const k in G.parts) { const pt = G.parts[k]; pt.e = sm(pt.d); pt.obj.position.z = pt.dz * pt.e; }
    const op = 1;
    G.bMats.forEach(m => { const tr = op < 0.999; if (m.transparent !== tr) { m.transparent = tr; m.depthWrite = !tr; m.needsUpdate = true; } m.opacity = op; });
    G.braceG.visible = op > 0.02;

    if (!this.drag) {
      const idle = now - this.lastTouch > 2500, decay = Math.exp(-dt * 2.6);
      if (idle) {
        this.vYaw += (0.16 * (1 - E) - this.vYaw) * (1 - Math.exp(-dt * 0.8));
        this.vPitch *= decay;
        this.pitch += (-0.2 - this.pitch) * (1 - Math.exp(-dt * 0.6)) * (1 - E);
      } else { this.vYaw *= decay; this.vPitch *= decay; }
      this.yaw += this.vYaw * dt; this.pitch = clamp(this.pitch + this.vPitch * dt, -1.35, 1.35);
      if (E > 0.001 && ((this.explodeEl && this.wideMQ.matches) || (this.pinEl && !this.wideMQ.matches) || this.poseLock)) {
        const ty = 0.38 + Math.PI * 2 * Math.round((this.yaw - 0.38) / (Math.PI * 2)), kk = 1 - Math.exp(-dt * 5 * E);
        this.yaw += (ty - this.yaw) * kk; this.pitch += (-1.08 - this.pitch) * kk; this.vYaw *= 1 - E * 0.5;
      }
    }
    G.pivot.rotation.set(this.pitch, this.yaw, 0);
    G.inner.position.z = 12 + 2.5 * E;
    const narrow = G.aspect < 1;
    G.pivot.position.x = (narrow ? 9 : 7) * E;
    G.pivot.position.y = -7 * E;
    G.camera.position.set(0, 0, G.dist * (1 + E * (narrow ? 0.6 : 0.42)));
    G.rig.rotation.set(-(L.y - 0.5) * 0.9, -(L.x - 0.5) * 1.3, 0);
    G.hands.h.rotation.z = -ha * D2R; G.hands.m.rotation.z = -ma * D2R; if (G.hands.s) G.hands.s.rotation.z = -sa * D2R;

    G.scene.updateMatrixWorld();
    G.dial.getWorldPosition(T.p); G.camera.getWorldPosition(T.c);
    T.v.subVectors(T.c, T.p).normalize(); T.h.copy(G.keyDir).add(T.v).normalize();
    G.dial.getWorldQuaternion(T.q); T.q.invert(); T.h.applyQuaternion(T.q);
    G.sheen.rotation.z = Math.atan2(T.h.y, T.h.x) + Math.PI / 2;
    G.sheenMat.opacity = 0.2 + 0.6 * Math.min(1, Math.hypot(T.h.x, T.h.y) * 1.8);

    G.renderer.render(G.scene, G.camera);

    if (G.labels.length && (E > 0.01 || G.labelsOn)) {
      let colX = Infinity, maxTw = 0;
      G.labels.forEach(lb => {
        if (!lb.tw) lb.tw = lb.text.offsetWidth;
        maxTw = Math.max(maxTw, lb.tw);
        T.p.copy(lb.a); lb.part.obj.localToWorld(T.p); T.p.project(G.camera);
        lb.sx = (T.p.x + 1) / 2 * G.w; lb.sy = (1 - T.p.y) / 2 * G.h; colX = Math.min(colX, lb.sx);
      });
      colX = Math.max(colX - 30, maxTw + 14);
      const sorted = G.labels.slice().sort((a, b) => a.sy - b.sy);
      if (sorted.length && sorted[0].sy < 24) sorted[0].sy = 24;
      for (let i = 1; i < sorted.length; i++) if (sorted[i].sy < sorted[i - 1].sy + 20) sorted[i].sy = sorted[i - 1].sy + 20;
      const maxY = G.h - 84;
      for (let i = sorted.length - 1; i >= 0; i--) { const lim = i === sorted.length - 1 ? maxY : sorted[i + 1].sy - 20; if (sorted[i].sy > lim) sorted[i].sy = lim; }
      G.labels.forEach(lb => {
        lb.el.style.opacity = clamp((lb.part.e - 0.55) / 0.35, 0, 1).toFixed(3);
        lb.line.style.width = Math.max(4, lb.sx - colX - 13).toFixed(1) + 'px';
        lb.el.style.transform = `translate3d(${(colX - lb.tw).toFixed(1)}px,${(lb.sy - 7).toFixed(1)}px,0)`;
      });
      G.labelsOn = E > 0.01;
    }

    if (G.first) {
      G.first = false;
      this.canvas.style.opacity = '1';
      if (this.svgWrap) this.svgWrap.style.opacity = '0';
      this.onReady(true);
    }
    if (++G.fc > 40) {
      G.acc += dt;
      if (++G.n === 60) {
        const avg = G.acc / 60; G.acc = 0; G.n = 0;
        if (avg > 0.024 && G.pr > 1) { G.pr = Math.max(1, G.pr - 0.5); G.renderer.setPixelRatio(G.pr); G.force = true; this.resize(); }
        else if (avg > 0.05 && G.pr <= 1) { if (++G.bad >= 2) this.teardown(); }
        else G.bad = 0;
      }
    }
  }

  teardown(silent) {
    const G = this.gl;
    this.ro && this.ro.disconnect(); this.ro = null;
    if (G) {
      G.scene.traverse(o => { o.geometry && o.geometry.dispose(); });
      G.disposables.forEach(d => d.dispose && d.dispose());
      G.modelDisp.forEach(d => d.dispose && d.dispose());
      G.renderer.dispose();
      this.gl = null;
    }
    if (this.canvas) this.canvas.style.opacity = '0';
    if (this.svgWrap) this.svgWrap.style.opacity = '1';
    if (this.labels) this.labels.querySelectorAll('[data-part]').forEach(el => { el.style.opacity = '0'; });
    if (!silent && !this.dead) this.onReady(false);
  }
}
