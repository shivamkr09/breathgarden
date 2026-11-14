// garden.js — the night garden, drawn on a 2D canvas.
//
// Inputs (all optional, all smoothed here):
//   breath  0..1   your live chest movement (normalized by the app)
//   pacer   0..1   where the guide ring is in its in/out cycle
//   pulse   bpm    sets firefly blink tempo + a faint warmth in the sky
//   sync    0..1   how closely your breathing rate matches the pacer
// Flowers are added by the app when you've breathed in sync for a while.

'use strict';

const TAU = Math.PI * 2;
const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function mulberry(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

class Garden {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.state = { breath: 0.5, pacer: 0.5, pulse: null, sync: 0, listening: false };
    this.s = { breath: 0.5, pacer: 0.5, warmth: 0, sync: 0, presence: 0 };
    this.flowers = [];
    const r = mulberry(7);
    this.stars = Array.from({ length: 140 }, () => ({ x: r(), y: r() * 0.62, z: r(), p: r() * TAU }));
    this.grass = Array.from({ length: 90 }, (_, i) => ({ x: i / 89 + (r() - 0.5) * 0.01, h: 0.04 + r() * 0.07, p: r() * TAU }));
    this.flies = Array.from({ length: 14 }, () => ({ x: r(), y: 0.45 + r() * 0.35, p: r(), dx: r() * TAU }));
    this.beat = 0;
    this._last = performance.now();
    this._resize = () => this.resize();
    addEventListener('resize', this._resize);
    this.resize();
    const loop = (now) => { this.frame(now); this._raf = requestAnimationFrame(loop); };
    this._raf = requestAnimationFrame(loop);
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const { width, height } = this.c.getBoundingClientRect();
    this.w = Math.max(1, width); this.h = Math.max(1, height);
    this.c.width = Math.round(this.w * dpr); this.c.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  set(partial) { Object.assign(this.state, partial); }

  addFlower(seed = Math.random() * 1e9) {
    const r = mulberry(seed | 0);
    // Place flowers on the meadow band either side of the pond, avoiding overlap-ish.
    const side = this.flowers.length % 2 ? 1 : -1;
    const x = 0.5 + side * (0.2 + r() * 0.27);
    const y = 0.74 + r() * 0.2;
    const pulse = this.state.pulse || 70;
    // Hue follows your pulse at the moment it bloomed: calmer → cooler violets, livelier → warmer pinks.
    const hue = clamp(lerp(250, 340, (pulse - 55) / 45), 220, 350) + (r() - 0.5) * 20;
    this.flowers.push({ x, y, hue, petals: 5 + Math.floor(r() * 4), size: 0.6 + r() * 0.5, born: performance.now(), sway: r() * TAU });
  }

  clearFlowers() { this.flowers.length = 0; }

  frame(now) {
    const dt = Math.min(0.1, (now - this._last) / 1000); this._last = now;
    const { ctx, w, h, s, state } = this;
    const k = 1 - Math.exp(-dt * 6);
    s.breath = lerp(s.breath, state.breath ?? 0.5, k);
    s.pacer = lerp(s.pacer, state.pacer, 1 - Math.exp(-dt * 12));
    s.sync = lerp(s.sync, state.sync, 1 - Math.exp(-dt * 1.5));
    s.presence = lerp(s.presence, state.listening ? 1 : 0.35, 1 - Math.exp(-dt * 2));
    const warmth = state.pulse ? clamp((state.pulse - 55) / 45, 0, 1) : 0;
    s.warmth = lerp(s.warmth, warmth, 1 - Math.exp(-dt * 0.5));
    if (state.pulse) { this.beat += dt * (state.pulse / 60); }
    const t = now / 1000;
    const motion = this.reducedMotion ? 0.15 : 1;

    // Sky
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, `hsl(${lerp(232, 258, s.warmth)}, 45%, ${lerp(6, 9, s.sync)}%)`);
    sky.addColorStop(0.6, `hsl(${lerp(228, 275, s.warmth)}, 38%, ${lerp(12, 16, s.sync)}%)`);
    sky.addColorStop(1, `hsl(${lerp(200, 230, s.warmth)}, 35%, 8%)`);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

    // Stars twinkle a little more as you settle into sync.
    for (const st of this.stars) {
      const a = (0.25 + 0.55 * st.z) * (0.6 + 0.4 * Math.sin(t * (0.6 + st.z) * motion + st.p)) * (0.7 + 0.3 * s.sync);
      ctx.fillStyle = `rgba(220,230,255,${a.toFixed(3)})`;
      ctx.fillRect(st.x * w, st.y * h, 1 + st.z, 1 + st.z);
    }

    // Moon
    const mx = w * 0.82, my = h * 0.16, mr = Math.min(w, h) * 0.045;
    const mg = ctx.createRadialGradient(mx, my, mr * 0.2, mx, my, mr * 4);
    mg.addColorStop(0, 'rgba(255,248,225,0.35)'); mg.addColorStop(1, 'rgba(255,248,225,0)');
    ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(mx, my, mr * 4, 0, TAU); ctx.fill();
    ctx.fillStyle = '#f6efd9'; ctx.beginPath(); ctx.arc(mx, my, mr, 0, TAU); ctx.fill();

    // Hills / meadow
    ctx.fillStyle = `hsl(${lerp(160, 175, s.sync)}, 30%, ${lerp(9, 12, s.sync)}%)`;
    ctx.beginPath(); ctx.moveTo(0, h * 0.68);
    for (let x = 0; x <= w; x += 20) ctx.lineTo(x, h * (0.68 + 0.03 * Math.sin(x / w * 5 + 1)));
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fill();

    // Pond (reflects the bloom)
    const cx = w / 2, cy = h * 0.47;
    const base = Math.min(w, h) * 0.13;
    const amp = Math.min(w, h) * 0.09;
    const pondY = h * 0.84;
    ctx.save();
    ctx.beginPath(); ctx.ellipse(cx, pondY, w * 0.17, h * 0.06, 0, 0, TAU);
    const pg = ctx.createLinearGradient(0, pondY - h * 0.06, 0, pondY + h * 0.06);
    pg.addColorStop(0, '#0d1e33'); pg.addColorStop(1, '#081321');
    ctx.fillStyle = pg; ctx.fill(); ctx.clip();
    for (let i = 0; i < 3; i++) {
      const rp = ((t * 0.25 * motion + i / 3) % 1);
      ctx.strokeStyle = `rgba(150,200,255,${(0.25 * (1 - rp)).toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(cx, pondY, w * 0.17 * rp, h * 0.06 * rp, 0, 0, TAU); ctx.stroke();
    }
    const refl = ctx.createRadialGradient(cx, pondY, 0, cx, pondY, base * 1.2);
    refl.addColorStop(0, `hsla(${lerp(190, 160, s.sync)}, 90%, 70%, ${0.25 * s.presence})`);
    refl.addColorStop(1, 'hsla(190, 90%, 70%, 0)');
    ctx.fillStyle = refl; ctx.fillRect(cx - base * 1.5, pondY - base, base * 3, base * 2);
    ctx.restore();

    // Grass sways with your breath.
    ctx.strokeStyle = 'rgba(80,140,120,0.55)'; ctx.lineWidth = 1.4;
    for (const g of this.grass) {
      const gx = g.x * w, gy = h * (0.69 + 0.03 * Math.sin(g.x * 5 + 1)) + 4;
      const lean = (s.breath - 0.5) * 14 * motion + Math.sin(t * 0.8 * motion + g.p) * 2;
      ctx.beginPath(); ctx.moveTo(gx, gy); ctx.quadraticCurveTo(gx + lean * 0.5, gy - g.h * h * 0.6, gx + lean, gy - g.h * h); ctx.stroke();
    }

    // Flowers grow in, then breathe with you.
    for (const f of this.flowers) this.drawFlower(f, now, t, motion);

    // Fireflies blink on the pulse beat.
    const beatPhase = this.beat % 1;
    const blink = state.pulse ? Math.exp(-beatPhase * 6) : 0.3;
    const nFlies = Math.min(this.flies.length, 3 + this.flowers.length);
    for (let i = 0; i < nFlies; i++) {
      const fl = this.flies[i];
      const fx = (fl.x + 0.03 * Math.sin(t * 0.3 * motion + fl.dx)) * w;
      const fy = (fl.y + 0.02 * Math.cos(t * 0.4 * motion + fl.dx)) * h;
      const a = 0.25 + 0.75 * blink * (0.6 + 0.4 * Math.sin(fl.p * TAU));
      const fg = ctx.createRadialGradient(fx, fy, 0, fx, fy, 10);
      fg.addColorStop(0, `rgba(255,236,150,${a.toFixed(3)})`); fg.addColorStop(1, 'rgba(255,236,150,0)');
      ctx.fillStyle = fg; ctx.beginPath(); ctx.arc(fx, fy, 10, 0, TAU); ctx.fill();
    }

    // Your breath bloom — an organic glowing shape that follows your chest.
    const br = base * 0.75 + amp * 1.1 * s.breath;
    const hue = lerp(195, 150, s.sync);
    const glow = ctx.createRadialGradient(cx, cy, br * 0.2, cx, cy, br * 1.9);
    glow.addColorStop(0, `hsla(${hue}, 85%, 70%, ${0.35 * s.presence})`);
    glow.addColorStop(1, `hsla(${hue}, 85%, 60%, 0)`);
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, br * 1.9, 0, TAU); ctx.fill();
    ctx.beginPath();
    for (let i = 0; i <= 72; i++) {
      const a = (i / 72) * TAU;
      const wob = 1 + 0.035 * Math.sin(a * 5 + t * 0.9 * motion) + 0.025 * Math.sin(a * 3 - t * 0.6 * motion);
      const x = cx + Math.cos(a) * br * wob, y = cy + Math.sin(a) * br * wob;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    const body = ctx.createRadialGradient(cx - br * 0.3, cy - br * 0.3, br * 0.1, cx, cy, br);
    body.addColorStop(0, `hsla(${hue - 10}, 90%, 82%, ${0.9 * s.presence})`);
    body.addColorStop(1, `hsla(${hue + 20}, 70%, 45%, ${0.75 * s.presence})`);
    ctx.fillStyle = body; ctx.fill();

    // Pacer ring — drawn on top so the guide stays visible over your bloom.
    const pr = base + amp * s.pacer;
    ctx.strokeStyle = `rgba(230,240,255,${(0.35 + 0.25 * s.presence).toFixed(3)})`;
    ctx.lineWidth = 2; ctx.setLineDash([2, 7]);
    ctx.beginPath(); ctx.arc(cx, cy, pr, 0, TAU); ctx.stroke(); ctx.setLineDash([]);

  }

  drawFlower(f, now, t, motion) {
    const { ctx, w, h, s } = this;
    const age = (now - f.born) / 1000;
    const grow = clamp(age / 2.5, 0, 1);
    const e = 1 - Math.pow(1 - grow, 3);
    const x = f.x * w, y = f.y * h;
    const stem = (30 + 26 * f.size) * e;
    const lean = Math.sin(t * 0.7 * motion + f.sway) * 3 + (s.breath - 0.5) * 6 * motion;
    ctx.strokeStyle = 'rgba(90,160,120,0.9)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + lean * 0.4, y - stem * 0.5, x + lean, y - stem); ctx.stroke();
    const hx = x + lean, hy = y - stem;
    const open = e * (0.85 + 0.25 * s.breath);
    const pr = (7 + 6 * f.size) * open;
    ctx.save(); ctx.translate(hx, hy); ctx.rotate(t * 0.05 * motion + f.sway);
    for (let i = 0; i < f.petals; i++) {
      ctx.rotate(TAU / f.petals);
      ctx.fillStyle = `hsla(${f.hue}, 75%, ${62 + 10 * s.breath}%, 0.9)`;
      ctx.beginPath(); ctx.ellipse(pr * 0.9, 0, pr, pr * 0.45, 0, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = '#ffe9a8'; ctx.beginPath(); ctx.arc(0, 0, pr * 0.38, 0, TAU); ctx.fill();
    ctx.restore();
    if (age < 2.5) { // a little sparkle when it blooms
      const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, 40);
      g.addColorStop(0, `hsla(${f.hue}, 90%, 80%, ${(0.5 * (1 - grow)).toFixed(3)})`); g.addColorStop(1, 'hsla(0,0%,100%,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(hx, hy, 40, 0, TAU); ctx.fill();
    }
  }
}

module.exports = { Garden };
