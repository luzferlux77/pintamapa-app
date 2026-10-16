// PintaMapa — utilidades: geometría, aleatorio con semilla, sonido, vibración
window.PM = window.PM || {};

PM.geo = {
  // metros por grado (aprox. equirectangular, suficiente a escala de barrio)
  mPerDegLat: 110540,
  mPerDegLon(lat) { return 111320 * Math.cos(lat * Math.PI / 180); },

  dist(a, b) {
    const dy = (b[0] - a[0]) * this.mPerDegLat;
    const dx = (b[1] - a[1]) * this.mPerDegLon((a[0] + b[0]) / 2);
    return Math.sqrt(dx * dx + dy * dy);
  },

  // desplaza un punto [lat,lon] dx,dy metros
  offset(p, dxM, dyM) {
    return [p[0] + dyM / this.mPerDegLat, p[1] + dxM / this.mPerDegLon(p[0])];
  },

  // distancia en metros de p a la polilínea pts
  distToPolyline(p, pts) {
    const kx = this.mPerDegLon(p[0]), ky = this.mPerDegLat;
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = (pts[i][1] - p[1]) * kx, ay = (pts[i][0] - p[0]) * ky;
      const bx = (pts[i + 1][1] - p[1]) * kx, by = (pts[i + 1][0] - p[0]) * ky;
      const vx = bx - ax, vy = by - ay;
      const len2 = vx * vx + vy * vy;
      let t = len2 ? -(ax * vx + ay * vy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const cx = ax + vx * t, cy = ay + vy * t;
      const d = Math.sqrt(cx * cx + cy * cy);
      if (d < best) best = d;
    }
    return best;
  },

  lerp(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; },
};

// Generador pseudoaleatorio reproducible (misiones del día, botes de pintura...)
PM.rng = function (seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
};

PM.today = function () {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

PM.fmtDist = function (m) {
  return m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 1 : 2) + ' km' : Math.round(m) + ' m';
};

PM.fmtNum = function (n) { return Math.round(n).toLocaleString('es-ES'); };

// ---------- Sonido (sintetizado, sin ficheros) ----------
PM.sound = {
  ctx: null,
  enabled: true,
  _ctx() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.enabled = false; }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },
  tone(freq, dur, type = 'sine', vol = 0.08, when = 0, slideTo = null) {
    if (!this.enabled) return;
    const ctx = this._ctx(); if (!ctx) return;
    const t0 = ctx.currentTime + when;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  },
  splat(combo) {
    // "plof" que sube de tono con el combo
    const f = 220 + Math.min(combo, 60) * 9;
    this.tone(f, 0.09, 'triangle', 0.05, 0, f * 0.6);
  },
  pickup() { [660, 880, 1100].forEach((f, i) => this.tone(f, 0.12, 'square', 0.04, i * 0.06)); },
  capture() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.07, i * 0.1)); },
  fanfare() {
    [392, 523, 659, 784, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.25, 'sawtooth', 0.04, i * 0.13));
  },
  levelUp() { [440, 554, 659, 880].forEach((f, i) => this.tone(f, 0.18, 'square', 0.05, i * 0.08)); },
  warn() { this.tone(180, 0.3, 'sawtooth', 0.05); },
};

PM.vibrate = function (pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* sin vibración */ }
};

// Niveles: del 1 al 99 y luego rangos de 100 niveles cada uno: Bronce 1…100 → Plata 1…100 → Oro → Platino → Diamante → Master
PM.LEVEL_TIERS = [
  { name: 'Bronce', icon: '🥉', color: '#cd7f32' }, { name: 'Plata', icon: '🥈', color: '#a8b0bb' },
  { name: 'Oro', icon: '🥇', color: '#e0a800' }, { name: 'Platino', icon: '💠', color: '#3fb8a8' },
  { name: 'Diamante', icon: '💎', color: '#3b9cff' }, { name: 'Master', icon: '👑', color: '#ff2e88' },
];
PM.LEVEL_MAX = 99 + PM.LEVEL_TIERS.length * 100;   // nivel interno 699 = Master 100
// xp acumulada para llegar al nivel interno lvl (curva suave: cada rango cuesta algo más que el anterior)
PM.xpForLevel = (lvl) => lvl <= 99 ? Math.round(400 * Math.pow(lvl - 1, 1.6))
  : Math.round(400 * Math.pow(98, 1.6) + (lvl - 99) * 6000 * Math.pow(1.25, Math.floor((lvl - 100) / 100)));
PM.levelName = (l) => {
  if (l <= 99) return { label: String(l), short: String(l), tier: null };
  const t = PM.LEVEL_TIERS[Math.floor((l - 100) / 100)], n = ((l - 100) % 100) + 1;
  return { label: t.name + ' ' + n, short: String(n), tier: t };
};
PM.levelInfo = function (xp) {
  xp = xp || 0;
  let l = 1;
  while (l < PM.LEVEL_MAX && xp >= PM.xpForLevel(l + 1)) l++;
  const a = PM.xpForLevel(l), b = PM.xpForLevel(l + 1), max = l >= PM.LEVEL_MAX, nm = PM.levelName(l);
  return { level: l, label: nm.label, short: nm.short, tier: nm.tier, max,
    nextLabel: max ? null : PM.levelName(l + 1).label, cur: xp - a, need: max ? 0 : b - a, pct: max ? 1 : (xp - a) / (b - a) };
};
