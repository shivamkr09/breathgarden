// camview.js — "What you see / What the camera sees" framing view.
//
// The same camera stream is shown twice: in colour on the left of a draggable
// split, and in greyscale on the right with an overlay of where SmartSpectra
// looks (a face dot-grid that pulses with the pulse estimate, chest lines that
// rise and fall with the live breath trace). The overlay is a fixed framing
// guide, not face tracking: it shows where to sit.
'use strict';

const { fit } = require('./viz');
const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

class CameraView {
  /**
   * @param {HTMLElement} root  a .camview element
   * @param {{ cy?: number, bottomPad?: number }} [opts]  face centre (fraction of height) and
   *   space to keep clear at the bottom (px), so the overlay fits different card sizes.
   */
  constructor(root, opts = {}) {
    const q = (sel) => root.querySelector(sel);
    this.root = root;
    this.opts = { cy: 0.4, bottomPad: 70, ...opts };
    this.base = q('.cam-base');
    this.colorWrap = q('.cam-color-wrap');
    this.color = this.colorWrap ? this.colorWrap.querySelector('video') : null;
    this.overlay = q('.cam-overlay');
    this.sim = q('.cam-sim');
    this.handle = q('.split-handle');
    this.line = q('.split-line');
    this.coPulse = q('.co-pulse');
    this.coBreath = q('.co-breath');
    this.coPulseT = this.coPulse.querySelector('.co-t');
    this.coBreathT = this.coBreath.querySelector('.co-t');
    this.split = 0.18;
    this._beat = 0;
    this._last = performance.now();
    if (!this.handle) return; // no compare split on this view

    const setFromX = (clientX) => {
      const r = this.root.getBoundingClientRect();
      this.setSplit((clientX - r.left) / r.width);
    };
    let dragging = false;
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.split-handle') || Math.abs(e.clientX - (this.root.getBoundingClientRect().left + this.split * this.root.clientWidth)) < 40) {
        dragging = true; this.root.setPointerCapture(e.pointerId); setFromX(e.clientX);
      }
    });
    this.root.addEventListener('pointermove', (e) => { if (dragging) setFromX(e.clientX); });
    this.root.addEventListener('pointerup', () => { dragging = false; });
    this.handle.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { this.setSplit(this.split - 0.05); e.preventDefault(); }
      if (e.key === 'ArrowRight') { this.setSplit(this.split + 0.05); e.preventDefault(); }
    });
    this.setSplit(this.split);
  }

  setSplit(f) {
    this.split = clamp(f, 0, 1);
    const pct = (this.split * 100).toFixed(1);
    this.colorWrap.style.clipPath = `inset(0 ${(100 - this.split * 100).toFixed(1)}% 0 0)`;
    this.handle.style.left = `${pct}%`;
    this.line.style.left = `calc(${pct}% - 1px)`;
    this.handle.setAttribute('aria-valuenow', String(Math.round(this.split * 100)));
  }

  videos() { return [this.base, this.color].filter(Boolean); }
  attach(stream) { for (const v of this.videos()) { v.srcObject = stream; v.play().catch(() => {}); } }
  clear() { for (const v of this.videos()) v.srcObject = null; }
  setSimulated(on) { this.sim.hidden = !on; }

  /** @param {{ pulse?: number, breathing?: number, breath?: number|null, showNumbers: boolean }} d */
  draw(d) {
    const now = performance.now(), dt = Math.min(0.1, (now - this._last) / 1000); this._last = now;
    if (d.pulse) this._beat += dt * (d.pulse / 60);
    const { ctx, w, h } = fit(this.overlay);
    const cx = w * 0.5, cy = h * this.opts.cy;
    const ry = Math.min(h * 0.17, w * 0.16), rx = ry * 0.78;

    // Face dot-grid; forehead + cheeks glow on the pulse beat.
    const beat = d.pulse ? Math.exp(-(this._beat % 1) * 5) : 0.35;
    const step = Math.max(9, Math.round(ry / 10));
    for (let y = cy - ry; y <= cy + ry; y += step) {
      for (let x = cx - rx; x <= cx + rx; x += step) {
        const nx = (x - cx) / rx, ny = (y - cy) / ry;
        if (nx * nx + ny * ny > 1) continue;
        const warm = (ny < -0.45 && Math.abs(nx) < 0.7) || (Math.abs(nx) > 0.3 && ny > -0.05 && ny < 0.45);
        ctx.fillStyle = warm ? `rgba(239,90,96,${(0.45 + 0.5 * beat).toFixed(3)})` : 'rgba(255,255,255,0.5)';
        ctx.beginPath(); ctx.arc(x, y, 1.6, 0, TAU); ctx.fill();
      }
    }

    // Corner brackets around where your face should be.
    const bx = rx + 22, by = ry + 22, L = 26;
    ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - bx, cy - by + L); ctx.lineTo(cx - bx, cy - by); ctx.lineTo(cx - bx + L, cy - by);
    ctx.moveTo(cx + bx - L, cy - by); ctx.lineTo(cx + bx, cy - by); ctx.lineTo(cx + bx, cy - by + L);
    ctx.moveTo(cx + bx, cy + by - L); ctx.lineTo(cx + bx, cy + by); ctx.lineTo(cx + bx - L, cy + by);
    ctx.moveTo(cx - bx + L, cy + by); ctx.lineTo(cx - bx, cy + by); ctx.lineTo(cx - bx, cy + by - L);
    ctx.stroke();

    // Chest lines rise and fall with the live breath trace.
    const lift = d.breath == null ? 0 : (d.breath - 0.5) * h * 0.025;
    const chest0 = cy + ry + h * 0.13 - lift;
    ctx.setLineDash([6, 7]); ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const yy = chest0 + i * h * 0.05, half = w * (0.25 + i * 0.025);
      ctx.strokeStyle = `rgba(255,255,255,${(0.75 - i * 0.15).toFixed(2)})`;
      ctx.beginPath(); ctx.moveTo(cx - half, yy); ctx.quadraticCurveTo(cx, yy - h * 0.04, cx + half, yy); ctx.stroke();
    }
    ctx.setLineDash([]);

    // Callouts with leader lines.
    const place = (el, ax, ay, px, py) => {
      const pw = el.offsetWidth || 150, ph = el.offsetHeight || 36;
      const left = clamp(px, 12, w - pw - 12), top = clamp(py, 56, h - ph - this.opts.bottomPad);
      el.style.left = `${left}px`; el.style.top = `${top}px`;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(left, top + ph / 2); ctx.stroke();
      ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(ax, ay, 4, 0, TAU); ctx.fill();
    };
    place(this.coPulse, cx + rx * 0.25, cy - ry * 0.45, cx + bx + 40, cy - by - 10);
    place(this.coBreath, cx + w * 0.02, chest0 + h * 0.05, cx + w * 0.2, chest0 - h * 0.02);
    this.coPulseT.textContent = d.pulse && d.showNumbers ? `Pulse ${Math.round(d.pulse)} bpm` : d.pulse ? 'Pulse · live' : 'Pulse · reading…';
    this.coBreathT.textContent = d.breathing && d.showNumbers ? `Breathing ${d.breathing.toFixed(0)} /min` : d.breath != null ? 'Breathing · live' : 'Breathing · reading…';
  }
}

module.exports = { CameraView };
