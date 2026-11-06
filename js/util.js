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

// Generador pseudoaleatorio reproducible (misiones del día...)
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

// el día anterior según el calendario (restar 24 h fallaba los días de cambio de hora, que duran 23 o 25: se rompía la racha)
PM.ayer = function () {
  const d = new Date(); d.setDate(d.getDate() - 1);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

// número con decimales a la manera de cada idioma (1,10 en castellano; 1.10 en inglés)
PM._decF = {};
PM.dec = (n, d = 1) => (PM._decF[d] || (PM._decF[d] = new Intl.NumberFormat(PM.LOCALE || 'es-ES', { minimumFractionDigits: d, maximumFractionDigits: d }))).format(n);
PM.fmtDist = function (m) {
  return m >= 1000 ? PM.dec(m / 1000, m >= 10000 ? 1 : 2) + ' km' : Math.round(m) + ' m';
};

// Textos que vienen de fuera (nombres de lugares, barrios, ciudades, pintores, copias importadas, la nube): nunca pueden
// colarse como HTML. PM.esc para pintarlos dentro de una plantilla; PM.limpio quita de raíz lo que podría abrir una
// etiqueta o salirse de un atributo (ningún nombre real lleva < >; las comillas dobles pasan a tipográficas).
PM.esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
PM.limpio = (t) => (t == null ? t : String(t).replace(/[<>]/g, '').replace(/"/g, '”').replace(/[\u0000-\u001f]/g, ' ').slice(0, 300));
// ...y lo mismo con todos los nombres que guarda una partida (al cargarla, al importar una copia o al traerla de la nube)
// una posición de verdad: [lat, lon, …] con cifras finitas y en su rango
PM.puntoOk = (p) => Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number' && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;
// contornos de barrios conquistados ({ id: { name, segs:[[punto…]…], pos } }): solo los que se pueden dibujar
PM.bgeoSano = function (o) {
  const out = {};
  if (!o || typeof o !== 'object' || Array.isArray(o)) return out;
  for (const [id, g] of Object.entries(o)) {
    if (!g || typeof g !== 'object' || !Array.isArray(g.segs)) continue;
    const segs = g.segs.filter((sg) => Array.isArray(sg)).map((sg) => sg.filter(PM.puntoOk)).filter((sg) => sg.length >= 2);
    out[id] = { name: typeof g.name === 'string' ? PM.limpio(g.name) : '', segs, pos: PM.puntoOk(g.pos) ? g.pos : null };
  }
  return out;
};
PM.limpiarPartida = function (d) {
  if (!d || typeof d !== 'object') return d;
  const L = PM.limpio, obj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : null);
  for (const k of ['landmarks', 'barrioCards', 'cityCards', 'cardPhotos', 'cardInfo']) {
    const o = obj(d[k]); if (!o) { if (d[k] != null) d[k] = {}; continue; }
    for (const id of Object.keys(o)) {
      const r = o[id];
      if (!r || typeof r !== 'object') { delete o[id]; continue; }   // registro roto (null, número…): fuera
      for (const f of ['name', 'city', 'barrio', 'kind', 'addr', 'ctx', 'desc', 'credit', 'porque', 'texto', 'fuente', 'emoji', 'rarity', 'color']) if (typeof r[f] === 'string') r[f] = L(r[f]);
      if (r.pos != null && !PM.puntoOk(r.pos)) delete r.pos;   // (una posición imposible no se lleva al mapa)
    }
  }
  for (const k of ['barrioNames']) { const o = obj(d[k]); if (o) for (const id of Object.keys(o)) o[id] = typeof o[id] === 'string' ? L(o[id]) : ''; }
  { const o = obj(d.tileNames); if (o) for (const id of Object.keys(o)) { const v = o[id]; if (!v || typeof v !== 'object') delete o[id]; else { v.name = L(v.name); v.city = L(v.city); } } }
  { const o = obj(d.countries); if (o) for (const id of Object.keys(o)) { const v = o[id]; if (!v || typeof v !== 'object') delete o[id]; else v.name = L(v.name); } }
  for (const k of ['citiesWon', 'cities', 'cityRank', 'albumes']) {   // (ciudades como clave: una clave con < > se renombra)
    const o = obj(d[k]); if (!o) continue;
    for (const id of Object.keys(o)) if (/[<>"]/.test(id)) { const v = o[id]; delete o[id]; o[L(id)] = v; }
  }
  if (Array.isArray(d.avoid)) d.avoid = d.avoid.filter((a) => a && typeof a === 'object').map((a) => Object.assign(a, { name: L(a.name) }));
  if (d.walks && !Array.isArray(d.walks)) d.walks = [];
  // (lo que no es un nombre también llega a la pantalla: misiones, desglose de puntos y cifras de cada paseo. Una copia manipulada no puede colar nada)
  if (d.daily != null) {
    if (typeof d.daily !== 'object' || !Array.isArray(d.daily.missions)) d.daily = null;
    else d.daily.missions = d.daily.missions.filter((m) => m && typeof m === 'object').map((m) => Object.assign(m, { text: L(m.text), goal: +m.goal || 1, progress: +m.progress || 0, reward: +m.reward || 0 }));
  }
  { const o = obj(d.xpBy); if (o) for (const id of Object.keys(o)) if (!/^[a-z_]{1,24}$/.test(id) || typeof o[id] !== 'number') delete o[id]; }
  { const o = obj(d.stats); if (o) { for (const k of Object.keys(o)) if (k !== 'lastDay' && typeof o[k] !== 'number') o[k] = +o[k] || 0; if (o.lastDay != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(o.lastDay))) o.lastDay = null; } }
  if (Array.isArray(d.walks)) {
    d.walks = d.walks.filter((w) => w && typeof w === 'object' && !Array.isArray(w));
    for (const w of d.walks) {
      const st = obj(w.st) || (w.st = {}); for (const k of Object.keys(st)) if (typeof st[k] !== 'number') st[k] = +st[k] || 0;
      if (!(isFinite(w.elapsed) && w.elapsed >= 0)) w.elapsed = 0;
      if (w.start != null && !isFinite(w.start)) w.start = isFinite(+w.id) ? +w.id : 0;
      // (un punto que no es una posición —{}, [999, 999]— rompía el dibujo y la repetición del paseo; null es un corte: se queda)
      if (w.track != null) w.track = Array.isArray(w.track) ? w.track.filter((q) => q === null || PM.puntoOk(q)) : [];
    }
  }
  if (d.lastPos != null && !PM.puntoOk(d.lastPos)) d.lastPos = null;
  if (d.session != null && !(obj(d.session) && isFinite(d.session.start) && obj(d.session.st))) d.session = null;
  if (d.session && Array.isArray(d.session.track)) d.session.track = d.session.track.filter((q) => q === null || PM.puntoOk(q));
  if (Array.isArray(d.avoid)) d.avoid = d.avoid.filter((a) => a.type !== 'circle' || (PM.puntoOk(a.c) && isFinite(a.r) && a.r > 0));
  // (el color y la foto de perfil van dentro de un style="…": solo un color y una imagen de verdad)
  if (d.color != null && !/^#[0-9a-f]{3,8}$/i.test(String(d.color))) d.color = '#2563eb';
  if (d.avatar != null && !/^data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+$/.test(String(d.avatar))) delete d.avatar;
  return d;
};
PM.fmtNum = function (n) { return Math.round(n).toLocaleString(PM.LOCALE || 'es-ES'); };

// ---------- Sonido (sintetizado, sin ficheros) ----------
PM.sound = {
  ctx: null,
  enabled: (() => { try { return localStorage.getItem('pintamapa_sonido') !== '0'; } catch (e) { return true; } })(),   // (se recuerda: antes volvía a sonar al abrir la app)
  poner(on) { this.enabled = !!on; try { localStorage.setItem('pintamapa_sonido', on ? '1' : '0'); } catch (e) {} },
  _ctx() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.enabled = false; }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },
  // El canal de audio solo se mantiene abierto mientras suena algo: 1,5 s después del último sonido se suspende.
  // (Abierto sin sonar, Android lo cuenta como «reproduciendo» y no deja dormir al móvil: horas de batería.)
  _endAt: 0, _sleepT: null,
  _sleepSoon(endAt) {
    this._endAt = Math.max(this._endAt, endAt);
    clearTimeout(this._sleepT);
    const ms = Math.max(0, (this._endAt - Date.now())) + 1500;
    this._sleepT = setTimeout(() => { if (this.ctx && this.ctx.state === 'running' && Date.now() >= this._endAt) this.ctx.suspend().catch(() => {}); }, ms);
  },
  sleep() { clearTimeout(this._sleepT); if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); },
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
    this._sleepSoon(Date.now() + (when + dur + 0.05) * 1000);
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
  // combo: arpegio que sube; cuanto más combo, más notas y más agudo (10 → 4 notas … 80+ → 8 notas)
  combo(n) {
    const steps = Math.min(8, 3 + Math.floor(n / 10)), base = 392 * Math.pow(2, Math.min(n, 80) / 120);
    for (let i = 0; i < steps; i++) this.tone(base * Math.pow(2, [0, 4, 7, 12, 16, 19, 24, 28][i] / 12), 0.16, 'triangle', 0.06, i * 0.07);
    this.tone(base * 4, 0.35, 'sine', 0.035, steps * 0.07);   // brillo final
  },
  warn() { this.tone(180, 0.3, 'sawtooth', 0.05); },
};

if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('visibilitychange', () => { if (document.hidden) PM.sound.sleep(); });

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

// Carga bajo demanda de lo que casi nunca se usa (vídeos, póster, compartir imagen): la app arranca más rápido.
// PM.need('lib/mp4-muxer.js', 'js/replay.js') carga en orden lo que falte (una sola vez cada archivo).
PM._lz = {};
PM.lazy = function (src) {
  if (PM._lz[src]) return PM._lz[src];
  if ([...document.scripts].some((s) => s.src && s.src.endsWith('/' + src))) return (PM._lz[src] = Promise.resolve());   // ya estaba en la página
  return (PM._lz[src] = new Promise((ok, ko) => {
    const s = document.createElement('script'); s.src = src;
    s.onload = ok; s.onerror = () => { delete PM._lz[src]; ko(new Error('No se pudo cargar ' + src)); };
    document.head.appendChild(s);
  }));
};
PM.need = async function (...srcs) { for (const s of srcs) await PM.lazy(s); };

// Ciudad de un lugar conquistado al que le falta (se capturó antes de que llegara el nombre de la ciudad):
// por el nombre ya guardado de su zona (~1 km) o, si no, por el lugar conquistado con ciudad más cercano (< 3 km).
PM.fillLandmarkCities = function (s) {
  if (!s || !s.landmarks) return 0;
  let n = 0;
  const withCity = Object.values(s.landmarks).filter((r) => r.city && r.pos);
  for (const r of Object.values(s.landmarks)) {
    if (r.city || !r.pos) continue;
    const k = Math.floor(r.pos[0] / 0.01) + '_' + Math.floor(r.pos[1] / 0.01);
    let c = s.tileNames && s.tileNames[k] && s.tileNames[k].city;
    if (!c) {
      let bd = 3000;
      for (const o of withCity) { const d = PM.geo.dist(r.pos, o.pos); if (d < bd) { bd = d; c = o.city; } }
    }
    if (c && !/^(Zona sin nombre|Ciudad desconocida)$/.test(c)) { r.city = c; n++; }
  }
  return n;
};

// País de cada ciudad (para agrupar las cartas): se pregunta una vez por ciudad y se guarda en la partida (s.countries)
PM.flag = (cc) => (cc && cc.length === 2 ? String.fromCodePoint(...cc.toUpperCase().split('').map((c) => 127397 + c.charCodeAt(0))) : '🏳️');
// Nominatim (nombres de sitios de OpenStreetMap) admite UNA petición por segundo y, si se pasa, bloquea un rato. Antes cada
// parte de la app llevaba su propio ritmo (nombres de zonas, países, fichas de las cartas: estas, sin pausa) y juntas se
// pasaban; al abrir los cromos con muchas fichas caducadas salían cientos seguidas. Ahora todo va por esta cola.
let nomiCola = Promise.resolve(), nomiT = 0;
PM.nominatim = function (url, ms = 15000) {
  const turno = nomiCola.then(async () => {
    const espera = 1100 - (Date.now() - nomiT);
    if (espera > 0) await new Promise((res) => setTimeout(res, espera));
    nomiT = Date.now();
    return fetch(url, AbortSignal.timeout ? { signal: AbortSignal.timeout(ms) } : {});
  });
  nomiCola = turno.catch(() => {});   // (un fallo no para la cola)
  return turno;
};
PM.ensureCountries = async function (s, cityPos) {
  s.countries = s.countries || {};
  let changed = false;
  for (const [city, pos] of Object.entries(cityPos)) {
    if (s.countries[city] || !pos || city === 'Otros lugares') continue;
    try {
      const r = await PM.nominatim(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=3&accept-language=es&lat=${pos[0]}&lon=${pos[1]}`);   // (por la cola: 1 por segundo)
      const a = (await r.json()).address || {};
      if (a.country) { s.countries[city] = { name: a.country, cc: a.country_code || '' }; changed = true; }
    } catch (e) { /* sin conexión: se agrupa como "Otros países" */ }
  }
  return changed;
};

// Tiempo EN MOVIMIENTO de un paseo (como Strava): solo cuentan los tramos a más de 0,5 m/s;
// los semáforos, las fotos y los ratos parado no bajan el ritmo. Paseos sin hora en el recorrido: el tiempo total.
PM._movCache = new WeakMap();
PM.movingMs = function (w) {
  if (!w) return 0;
  if (w.mov) return w.mov;   // paseo comprimido: se guardó al comprimirlo
  if (PM._movCache.has(w)) return PM._movCache.get(w);
  let mv = 0, prev = null;
  for (const q of w.track || []) {
    if (!q) { prev = null; continue; }
    if (prev && q[2] != null && prev[2] != null) {
      const dt = q[2] - prev[2], dd = PM.geo.dist(prev, q);
      if (dt > 0 && dt < (w.slim ? 1e9 : 120) && dd / dt > 0.5) mv += dt;   // comprimido: los puntos están más separados
    }
    prev = q;
  }
  mv *= 1000;
  const r = mv >= 60000 ? Math.min(mv, w.elapsed || mv) : (w.elapsed || 0);
  PM._movCache.set(w, r);
  return r;
};

// ¿Quince minutos sin moverte? lecturas {p, t, blanda}: todas las de ese rato cerca de su centro (70 m; 150 m las imprecisas).
// Sin ninguna lectura en ese rato, también (quieto, el GPS no avisa). Antes era un círculo de 50 m alrededor de la primera
// lectura: en interior el GPS baila 30-40 m, una sola desviada reiniciaba la cuenta y el paseo seguía encendido una hora y media.
// Los tramos de un recorrido GPX/TCX: cada <trkseg> (o <Track> de un TCX) por separado, con sus puntos {lat, lon, t, e}.
// Dos tramos seguidos se juntan si el corte es solo de grabación (≤ 30 s y < 50 m: las vueltas automáticas de un reloj);
// si no (el GPS se cortó, una pausa larga), quedan separados y entre ellos no se pinta nada
PM.tramosGPX = function (xml) {
  const txt = (n, tag) => { const x = n.getElementsByTagName(tag)[0]; return x ? x.textContent : ''; };
  const gpx = (n) => ({ lat: +n.getAttribute('lat'), lon: +n.getAttribute('lon'), t: Date.parse(txt(n, 'time')), e: parseFloat(txt(n, 'ele')) });
  const tcx = (n) => ({ lat: +txt(n, 'LatitudeDegrees'), lon: +txt(n, 'LongitudeDegrees'), t: Date.parse(txt(n, 'Time')), e: parseFloat(txt(n, 'AltitudeMeters')) });
  const todos = (tag, f) => { const p = [...xml.getElementsByTagName(tag)].map(f); return p.length ? [p] : []; };
  let grupos = [...xml.getElementsByTagName('trkseg')].map((s) => [...s.getElementsByTagName('trkpt')].map(gpx));
  if (!grupos.length) grupos = todos('trkpt', gpx);
  if (!grupos.length) grupos = [...xml.getElementsByTagName('Track')].map((s) => [...s.getElementsByTagName('Trackpoint')].map(tcx));
  if (!grupos.length) grupos = todos('Trackpoint', tcx);
  const out = [];
  for (const g of grupos) {
    const s = g.filter((q) => PM.puntoOk([q.lat, q.lon]) && isFinite(q.lat) && isFinite(q.lon) && (q.lat || q.lon));
    if (!s.length) continue;
    for (let i = 1; i < s.length; i++) if (!(s[i].t >= s[i - 1].t) && isFinite(s[i - 1].t)) s[i].t = s[i - 1].t;   // (hora que falta o retrocede: la anterior)
    const prev = out[out.length - 1], a = prev && prev[prev.length - 1], b = s[0];
    if (a && b.t - a.t >= 0 && b.t - a.t <= 30000 && PM.geo.dist([a.lat, a.lon], [b.lat, b.lon]) < 50) prev.push(...s);
    else out.push(s);
  }
  return out;
};
PM.estaQuieto = function (lecturas, ahora, min = 15) {
  const L = (lecturas || []).filter((q) => ahora - q.t <= min * 60000);
  if (!L.length) return true;
  const base = L.some((q) => !q.blanda) ? L.filter((q) => !q.blanda) : L;
  const c = [base.reduce((s, q) => s + q.p[0], 0) / base.length, base.reduce((s, q) => s + q.p[1], 0) / base.length];
  return L.every((q) => PM.geo.dist(c, q.p) <= (q.blanda ? 150 : 70));
};

// Conquista y rangos: barrio 60 % bronce · 80 % plata · 90 % oro (· leyenda: 100 % y todos sus lugares)
//                     ciudad 70 % bronce · 80 % plata · 90 % oro
PM.CONQ = { barrio: 0.6, city: 0.7 };
PM.RANKS = [
  { id: 'bronce', ic: '🥉', name: 'Bronce', color: '#cd7f32' },
  { id: 'plata', ic: '🥈', name: 'Plata', color: '#a8b0bd' },
  { id: 'oro', ic: '🥇', name: 'Oro', color: '#eab308' },
  { id: 'leyenda', ic: '🏆', name: 'Leyenda', color: '#a855f7' },
];
PM.RANK_MIN = { barrio: [0.6, 0.8, 0.9], city: [0.7, 0.8, 0.9] };
PM.rankFor = (kind, pct) => { const m = PM.RANK_MIN[kind]; return pct >= m[2] ? 2 : pct >= m[1] ? 1 : pct >= m[0] ? 0 : -1; };

// ---------- Iconos iguales en todos los móviles (Twemoji, CC-BY 4.0, dentro de la app) ----------
PM.TWEMOJI = new Set('1f4fa 1f309 1f32c 1f333 1f393 1f3a8 1f3ad 1f3c6 1f3d9 1f3db 1f3df 1f3e5 1f3ed 1f3f0 1f3fa 1f451 1f4cd 1f4da 1f4dc 1f525 1f52d 1f54c 1f54d 1f58c 1f5bc 1f5fa 1f5fb 1f5fc 1f5fd 1f5ff 1f689 1f68b 1f692 1f6a9 1f6d2 1f6d5 1f947 1f948 2615 26bd 26e9 26ea 26f2 2728 2b50'.split(' '));
PM.emojiCode = (e) => [...String(e || '')].map((c) => c.codePointAt(0).toString(16)).filter((h) => h !== 'fe0f').join('-');
PM.emojiURL = (e) => { const c = PM.emojiCode(e); return PM.TWEMOJI.has(c) ? 'lib/twemoji/' + c + '.svg' : null; };
PM._emojiImg = {};
// imagen ya cargada (para dibujar en canvas); si aún no está, se pide y devuelve null
PM.emojiImg = (e, onload) => {
  const url = PM.emojiURL(e); if (!url) return null;
  let im = PM._emojiImg[url];
  if (!im) { im = PM._emojiImg[url] = new Image(); im.onload = () => { im._ok = true; onload && onload(); }; im.src = url; }
  return im._ok ? im : null;
};

// ---------- Simplificar un recorrido (Douglas-Peucker, en metros): mismo dibujo, muchos menos puntos ----------
// Los puntos son [lat, lon, t?, alt?]; los null (cortes por pausa) se respetan.
PM.simplifyTrack = function (track, tol = 3) {
  const out = [];
  let seg = [];
  const flush = () => {
    if (seg.length <= 2) { out.push(...seg); seg = []; return; }
    const keep = new Uint8Array(seg.length); keep[0] = keep[seg.length - 1] = 1;
    const stack = [[0, seg.length - 1]];
    const k = PM.geo.mPerDegLon(seg[0][0]);
    while (stack.length) {
      const [a, b] = stack.pop();
      let best = -1, bd = tol;
      const ax = seg[a][1] * k, ay = seg[a][0] * PM.geo.mPerDegLat, bx = seg[b][1] * k, by = seg[b][0] * PM.geo.mPerDegLat;
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      for (let i = a + 1; i < b; i++) {
        const px = seg[i][1] * k, py = seg[i][0] * PM.geo.mPerDegLat;
        let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0; t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
        if (d > bd) { bd = d; best = i; }
      }
      if (best > 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
    }
    seg.forEach((q, i) => { if (keep[i]) out.push(q); });
    seg = [];
  };
  for (const q of track || []) { if (!q) { flush(); out.push(null); } else seg.push(q); }
  flush();
  return out;
};

// ---------------- Registro de errores (Perfil → Ajustes → «Informe de errores») ----------------
// Los fallos de la app quedaban invisibles en el móvil. Se guardan los últimos 50 (los repetidos, juntos, con cuántas veces),
// con la versión y la hora, SIN nada que diga dónde estás: se borran coordenadas y claves de zona del texto.
PM.errores = (function () {
  const KEY = 'pintamapa_errores', MAX = 50;
  let lista = [];
  try { lista = JSON.parse(localStorage.getItem(KEY) || '[]'); if (!Array.isArray(lista)) lista = []; } catch (e) { lista = []; }
  const limpia = (t) => String(t == null ? '' : t)
    .replace(/-?\d{1,3}\.\d{3,}/g, '·')                 // coordenadas
    .replace(/\b\d{4}_\d{3,4}\b/g, 'zona')              // claves de zona (~1 km)
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s)]*/g, '$1') // sin parámetros en las direcciones
    .replace(/https?:\/\/[^\s)]*\/(js|lib)\//g, '')     // solo el nombre del archivo
    .slice(0, 400);
  let guardarT = null;
  const guardar = () => { clearTimeout(guardarT); guardarT = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(lista)); } catch (e) {} }, 500); };
  function add(tipo, msg, donde) {
    const m = limpia(msg), d = limpia(donde || ''), ult = lista[lista.length - 1];
    if (!m) return;
    if (ult && ult.m === m && ult.tipo === tipo) { ult.n = (ult.n || 1) + 1; ult.t = Date.now(); guardar(); return; }
    lista.push({ t: Date.now(), v: (PM.VERSION && PM.VERSION.app) || '?', tipo, m, d });
    if (lista.length > MAX) lista = lista.slice(-MAX);
    guardar();
  }
  // fallos de red de los servidores de mapas o de Wikipedia: no son fallos de la app (sin cobertura, servidor caído)
  const RED = /Failed to fetch|NetworkError|Load failed|AJAXError|HTTP [45]\d\d|tiempo agotado|aborted|AbortError|timeout|sin red/i;
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('error', (e) => {
      if (!e || !e.message) return;   // (una imagen o un archivo que no carga: no es un fallo de la app)
      if (/ResizeObserver loop/.test(e.message)) return;
      add('error', e.message, (e.filename || '').split('/').pop() + ':' + (e.lineno || '') + (e.error && e.error.stack ? ' · ' + String(e.error.stack).split('\n').slice(1, 3).join(' ') : ''));
    });
    window.addEventListener('unhandledrejection', (e) => {
      const r = e && e.reason, msg = r && (r.message || String(r));
      if (!msg || RED.test(msg)) return;
      add('promesa', msg, r && r.stack ? String(r.stack).split('\n').slice(1, 3).join(' ') : '');
    });
  }
  // los avisos de la propia app (console.warn) también: «Zona sin completar», «Repaso del paseo»…
  if (typeof console !== 'undefined' && console.warn && !console.warn.__pm) {
    const w0 = console.warn.bind(console);
    const w = function (...a) {
      try { const txt = a.map((x) => (x && x.message ? x.message : typeof x === 'string' ? x : '')).filter(Boolean).join(' · '); if (txt && !RED.test(txt)) add('aviso', txt); } catch (e) {}
      return w0(...a);
    };
    w.__pm = true; console.warn = w;
  }
  return {
    add, lista: () => lista.slice(),
    borrar() { lista = []; try { localStorage.removeItem(KEY); } catch (e) {} },
    // el informe para enviar: versión, móvil y los errores (sin ubicaciones ni nada personal)
    informe() {
      const ua = (typeof navigator !== 'undefined' && navigator.userAgent || '').replace(/\s*\([^)]*Build[^)]*\)/, '');
      const cab = `PintaMapa ${(PM.VERSION && PM.VERSION.app) || '?'} (nativa ${(PM.VERSION && PM.VERSION.native) || '?'}) · ${PM.isNative ? 'app' : 'web'} · ${ua.slice(0, 160)}`;   // (el navegador y la versión de Android: sin pasar por limpia, que se comería los números de versión)
      return [cab, `${lista.length} registro(s)`, ''].concat(lista.slice().reverse().map((x) => `${new Date(x.t).toISOString().slice(0, 16).replace('T', ' ')} · v${x.v} · ${x.tipo}${x.n > 1 ? ' ×' + x.n : ''}: ${x.m}${x.d ? ' (' + x.d + ')' : ''}`)).join('\n');
    },
  };
})();
