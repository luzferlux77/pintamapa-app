// PintaMapa — estado del jugador, puntuación, niveles, misiones y logros
// Dos perfiles separados: 'real' (GPS del móvil, tu cuenta, se sincroniza con el PC)
// y 'prueba' (simulación con teclado/joystick, nunca se mezcla con el real).
PM.isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
PM.profile = (function () {
  let p = null;
  try { p = localStorage.getItem('pintamapa_profile'); } catch (e) {}
  if (!PM.isNative) return 'prueba';          // en el PC se juega siempre en prueba
  return 'real';                               // en el móvil solo existe la partida real (sin modo prueba)
})();
PM.switchProfile = function (p) {
  try { localStorage.setItem('pintamapa_profile', p); } catch (e) {}
  location.reload();
};

// Pintor (jugador) de este dispositivo: se pide el nombre al empezar. Cada nombre tiene su propia partida,
// así queda preparada la separación de perfiles (varias personas en el mismo móvil o PC).
PM.slug = (n) => String(n || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9_-]/g, '').slice(0, 30);
PM.player = (function () {
  try { const p = JSON.parse(localStorage.getItem('pintamapa_player') || 'null'); return p && p.slug ? p : null; } catch (e) { return null; }
})();
// Lista de pintores de este dispositivo (botones de la pantalla de inicio)
PM.players = function () {
  let list = [];
  try { list = JSON.parse(localStorage.getItem('pintamapa_players') || '[]'); } catch (e) {}
  if (PM.player && !list.some((x) => x.slug === PM.player.slug)) list.push({ name: PM.player.name, slug: PM.player.slug, last: Date.now() });
  return list.sort((a, b) => (b.last || 0) - (a.last || 0));
};
PM.setPlayer = function (name) {
  const p = { name: String(name).trim().slice(0, 24), slug: PM.slug(name) };
  const list = PM.players().filter((x) => x.slug !== p.slug);
  list.push({ name: p.name, slug: p.slug, last: Date.now() });
  try {
    localStorage.setItem('pintamapa_players', JSON.stringify(list));
    localStorage.setItem('pintamapa_player', JSON.stringify(p));
    sessionStorage.setItem('pintamapa_autostart', '1');
  } catch (e) {}
  location.reload();
};

PM.state = (function () {
  const LEGACY_KEY = 'pintamapa_save_' + PM.profile;
  const KEY = PM.player ? 'pintamapa_save_' + PM.player.slug + '_' + PM.profile : LEGACY_KEY;
  // la partida guardada antes de existir los nombres pasa al primer pintor que se registre
  try {
    if (KEY !== LEGACY_KEY && !localStorage.getItem(KEY) && localStorage.getItem(LEGACY_KEY)) {
      localStorage.setItem(KEY, localStorage.getItem(LEGACY_KEY));
      localStorage.removeItem(LEGACY_KEY);
    }
  } catch (e) {}
  const fresh = () => ({
    version: 1,
    xp: 0,
    color: '#2563eb',
    painted: {},        // pieceId -> 1
    heat: {},           // pieceId -> veces que has vuelto a pasar (el trazo se intensifica: "tu ruta habitual")
    paintedByTile: {},  // tileKey -> metros pintados
    landmarks: {},      // id -> {t, name, kind, emoji, rarity, visits, last}
    conquered: {},      // (antiguo, por cuadrícula)
    conqueredB: {},     // barrio real -> fecha de conquista
    perfectB: {},       // barrio real -> fecha (100 %)
    barrioNames: {},    // barrio real -> nombre
    perfect: {},        // tileKey -> fecha (100 %)
    citiesWon: {},      // ciudad -> fecha
    cities: {},         // ciudad -> {total}
    tileNames: {},
    cansTaken: {},      // id -> 1 (ids incluyen la fecha)
    achievements: {},
    cardInfo: {},       // cromos: foto/texto de Wikipedia por monumento
    cardPhotos: {},     // cromos con foto propia (la imagen está en el móvil)
    barrioCards: {},    // cromos de barrio: silueta de sus calles pintadas
    cityCards: {},      // cromos de ciudad (80 %)
    setsDone: {},       // colecciones temáticas: nivel conseguido (1 bronce, 2 plata, 3 oro)
    avoid: [],          // zonas a evitar: { id, type:'barrio', name } | { id, type:'circle', c:[lat,lon], r }
    avoidRemoved: {},   // zonas quitadas (para que la nube no las devuelva)
    stats: { paintedM: 0, walkedM: 0, bestCombo: 0, captures: 0, cans: 0, days: 0, streak: 0, lastDay: null, churches: 0 },
    daily: null,
    lastPos: null,
    walks: [],          // historial de paseos: {id, start, elapsed, st, track:[[lat,lon],...]}
    pendingGeo: {},     // geometría de tramos pintados aún no enviada al PC (perfil real)
    syncedAt: 0,
    session: null,
  });

  let data;
  try { data = Object.assign(fresh(), JSON.parse(localStorage.getItem(KEY) || '{}')); }
  catch (e) { data = fresh(); }
  data.stats = Object.assign(fresh().stats, data.stats);
  data.walks = (data.walks || []).filter((w) => (w.elapsed || 0) >= 120000);   // paseos de < 2 min: fuera del historial

  let dirty = false;
  function save() { dirty = true; }
  setInterval(() => {
    if (!dirty) return;
    dirty = false;
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { console.warn('No se pudo guardar', e); }
  }, 2000);
  let wiping = false;
  const flush = () => { if (!wiping) try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {} };
  window.addEventListener('beforeunload', flush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); }); // Android puede matar la app oculta

  function reset() { wiping = true; localStorage.removeItem(KEY); location.reload(); }

  function replace(d) { data = Object.assign(fresh(), d); data.stats = Object.assign(fresh().stats, data.stats); save(); }

  return { get data() { return data; }, save, reset, replace, flush };
})();

PM.game = (function () {
  const S = () => PM.state.data;
  const listeners = [];
  const emit = (ev, d) => listeners.forEach((fn) => fn(ev, d));

  // ---------------- Niveles ----------------
  // del 1 al 99 y luego 100 Bronce, Plata, Oro, Platino, Diamante y Master (ver PM.levelInfo en util.js)
  function level() { return PM.levelInfo(S().xp).level; }
  function levelProgress() { return PM.levelInfo(S().xp); }

  const COLORS = [
    { c: '#2563eb', name: 'Azul', lvl: 1 },
    { c: '#16a34a', name: 'Verde', lvl: 1 },
    { c: '#e4572e', name: 'Teja', lvl: 1 },
    { c: '#334155', name: 'Grafito', lvl: 1 },
    { c: '#ff2e88', name: 'Rosa neón', lvl: 1 },
    { c: '#22d3ee', name: 'Cian eléctrico', lvl: 1 },
    { c: '#a3e635', name: 'Lima ácida', lvl: 2 },
    { c: '#ff8a00', name: 'Naranja fuego', lvl: 3 },
    { c: '#a855f7', name: 'Violeta galaxia', lvl: 5 },
    { c: '#ef4444', name: 'Rojo tomate', lvl: 7 },
    { c: '#facc15', name: 'Oro puro', lvl: 10 },
    { c: '#f5f5f5', name: 'Blanco fantasma', lvl: 15 },
  ];

  function addXP(n, reason) {
    const before = level();
    S().xp += Math.round(n);
    const by = S().xpBy || (S().xpBy = {});   // de dónde vienen tus puntos (para explicar tu nivel)
    by[reason || 'otros'] = (by[reason || 'otros'] || 0) + Math.round(n);
    const after = level();
    PM.state.save();
    emit('xp', { n, reason });
    if (after > before) {
      emit('levelup', { level: after, colors: COLORS.filter((c) => c.lvl > before && c.lvl <= after) });
    }
  }

  // ---------------- Combo y potenciadores ----------------
  let combo = 0, lastPaintT = 0;
  let goldenUntil = 0;
  function comboMult() { return Math.min(3, 1 + Math.floor(combo / 10) * 0.25); }
  function tickCombo(now) {
    if (combo && now - lastPaintT > 12000) { combo = 0; emit('combo', { combo }); }
  }

  // ---------------- Pintar ----------------
  function paintPiece(piece, nearLandmark) {
    const s = S();
    if (s.painted[piece.id]) return 0;
    s.painted[piece.id] = 1;
    lastPass[piece.id] = Date.now();
    markActiveDay();
    if (PM.profile === 'real') s.pendingGeo[piece.id] = piece.pts.map((q) => [+q[0].toFixed(6), +q[1].toFixed(6)]);
    if (piece.trail) s.stats.trailM = (s.stats.trailM || 0) + piece.len;
    if (!piece.trail) s.paintedByTile[piece.tile] = (s.paintedByTile[piece.tile] || 0) + piece.len;   // senderos: no cuentan para el %
    s.stats.paintedM += piece.len;
    const now = Date.now();
    combo++; lastPaintT = now;
    if (combo > s.stats.bestCombo) s.stats.bestCombo = combo;
    let pts = 10 * comboMult();
    if (nearLandmark) pts *= 2;           // aura de monumento
    if (now < goldenUntil) pts *= 3;      // pintura dorada
    addXP(pts, 'paint');
    progressMission('paint', piece.len);
    progressMission('combo', combo, true);
    const hour = new Date().getHours();
    if (hour < 8) unlock('madrugador');
    if (hour >= 22) unlock('noctambulo');
    emit('painted', { piece, pts, combo, mult: comboMult(), aura: !!nearLandmark, golden: now < goldenUntil });
    checkTile(piece.tile);
    if (piece.barrio) checkBarrio(piece.barrio);
    checkPaintAchievements();
    return pts;
  }

  // Volver a pasar por una calle ya pintada: cuenta como "otra pasada" si hace más de 30 min de la anterior
  const lastPass = {};
  function repass(piece) {
    const s = S(), now = Date.now();
    if (!s.painted[piece.id] || now - (lastPass[piece.id] || 0) < 1800000) return;
    lastPass[piece.id] = now;
    if (!s.heat) s.heat = {};
    const n = Math.min(20, (s.heat[piece.id] || 1) + 1);
    s.heat[piece.id] = n;
    PM.state.save();
    emit('repass', { piece, n });
  }

  function tileProgress(key) {
    const t = PM.world.tiles[key];
    if (!t || !t.total) return 0;
    return Math.min(1, (S().paintedByTile[key] || 0) / t.total);
  }

  // la cuadrícula ya solo sirve para la ciudad; las conquistas son por barrio real
  function checkTile(key) {
    const t = PM.world.tiles[key];
    if (t && t.city) checkCity(t.city);
  }

  // ---------------- Barrios reales ----------------
  function barrioProgress(id) {
    const B = PM.world.barrios[id];
    if (!B || !B.total) return 0;
    const s = S();
    let m = 0;
    for (const pc of B.pieces) if (!pc.avoid && !pc.trail && s.painted[pc.id]) m += pc.len;
    return Math.min(1, m / B.total);
  }
  function checkBarrio(id) {
    const B = PM.world.barrios[id];
    if (!B || B.total < 150 || !PM.world.barrioComplete(id)) return;   // incompleto o sin apenas calles: no cuenta
    const p = barrioProgress(id);
    const s = S();
    if (p >= 0.8 && !s.conqueredB[id]) {
      s.conqueredB[id] = Date.now();
      s.barrioNames[id] = B.name;
      // cromo del barrio: silueta de las calles pintadas (muestra de hasta 500 tramos)
      const painted = B.pieces.filter((pc) => s.painted[pc.id]);
      const step = Math.max(1, Math.ceil(painted.length / 500));
      s.barrioCards[id] = { name: B.name, city: PM.world.cityAt(B.pos), t: Date.now(), color: s.color,
        lines: painted.filter((_, i) => i % step === 0).map((pc) => pc.pts.map((q) => [+q[0].toFixed(5), +q[1].toFixed(5)])) };
      addXP(2000, 'conquest');
      progressMission('conquer', 1);
      unlock('conquistador');
      if (Object.keys(s.conqueredB).length >= 5) unlock('senor_barrios');
      emit('conquered', { key: id, name: B.name });
    }
    if (p >= 0.995 && !s.perfectB[id]) {
      s.perfectB[id] = Date.now();
      addXP(1000, 'perfect');
      unlock('perfeccionista');
      emit('perfect', { key: id, name: B.name });
    }
  }

  // ---------------- Ciudad ----------------
  function cityProgress(city) {
    const s = S();
    let painted = 0, loadedTotal = 0;
    for (const k in PM.world.tiles) {
      const t = PM.world.tiles[k];
      if (t.city !== city) continue;
      painted += s.paintedByTile[k] || 0;
      loadedTotal += t.total;
    }
    // si no hay barrios cargados en esta sesión, usamos lo guardado
    if (!loadedTotal) for (const k in s.tileNames) if (s.tileNames[k].city === city) painted += s.paintedByTile[k] || 0;
    // calles en tus zonas a evitar: fuera del total y de lo pintado
    let avoidLen = 0, avoidPainted = 0;
    if ((s.avoid || []).length) for (const id in PM.world.pieces) {
      const pc = PM.world.pieces[id];
      if (!pc.avoid) continue;
      const t = PM.world.tiles[pc.tile];
      if (!t || t.city !== city) continue;
      avoidLen += pc.len;
      if (s.painted[pc.id]) avoidPainted += pc.len;
    }
    painted = Math.max(0, painted - avoidPainted);
    const real = s.cities[city] && s.cities[city].total;
    const total = Math.max(0, (real || loadedTotal) - avoidLen);
    return { painted, total, real: !!real, avoidLen, pct: total ? Math.min(1, painted / total) : 0 };
  }

  function checkCity(city) {
    const s = S();
    const cp = cityProgress(city);
    if (cp.real && cp.pct >= 0.8 && !s.citiesWon[city]) {
      s.citiesWon[city] = Date.now();
      s.cityCards[city] = { t: Date.now() };
      addXP(25000, 'city');
      unlock('rey_ciudad');
      emit('cityWon', { city });
    }
  }

  // ---------------- Monumentos ----------------
  const REVISIT_MS = 20 * 60 * 60 * 1000;   // "vuelve cada día": a partir de 20 h de la última visita
  function visitLandmark(lm) {
    const s = S();
    const rec = s.landmarks[lm.id];
    const now = Date.now();
    if (!rec) {
      // se guarda la posición: el monumento conquistado se dibuja para siempre, aunque esa zona no esté cargada
      s.landmarks[lm.id] = { t: now, last: now, visits: 1, name: lm.name, kind: lm.kind, emoji: lm.emoji, rarity: lm.rarity,
        pos: [+lm.pos[0].toFixed(6), +lm.pos[1].toFixed(6)], wiki: lm.wiki || null, wd: lm.wd || null,
        city: PM.world.cityAt(lm.pos), barrio: (PM.world.barrioAt(lm.pos) || {}).name || null };
      setTimeout(checkSets, 100);
      s.stats.captures++;
      if (/^(Iglesia|Iglesia principal|Basílica|Catedral|Templo|Ermita \/ Monasterio)$/.test(lm.kind)) s.stats.churches++;
      addXP(lm.points, 'landmark');
      progressMission('landmark', 1);
      unlock('primer_sello');
      if (s.stats.captures >= 10) unlock('coleccionista');
      if (s.stats.captures >= 50) unlock('enciclopedia');
      if (s.stats.churches >= 3) unlock('peregrino');
      if (lm.kind === 'Ayuntamiento') unlock('alcalde');
      if (lm.rarity === 'legendario') unlock('leyenda');
      emit('captured', { lm, first: true, pts: lm.points });
      return true;
    }
    if (now - rec.last > REVISIT_MS) {
      rec.last = now; rec.visits++;
      const pts = Math.round(lm.points * 0.2);
      addXP(pts, 'revisit');
      emit('captured', { lm, first: false, pts });
      return true;
    }
    return false;
  }

  // ---------------- Colecciones temáticas y fotos propias (cromos) ----------------
  const SET_XP = [300, 1000, 3000];
  function checkSets() {
    const s = S();
    if (!PM.cards) return;
    for (const set of PM.cards.SETS) {
      const n = PM.cards.setCount(set);
      let tier = s.setsDone[set.id] || 0;
      while (tier < 3 && n >= set.goals[tier]) {
        tier++;
        s.setsDone[set.id] = tier;
        addXP(SET_XP[tier - 1], 'set');
        emit('set', { set, tier });
      }
    }
    PM.state.save();
  }
  function photoTaken(id) {
    const s = S(), r = s.landmarks[id];
    const bonus = r ? Math.round(100 * (PM.world.RARITY[r.rarity] || { mult: 1 }).mult * 0.5) : 50;
    addXP(bonus, 'photo');
    const n = Object.keys(s.cardPhotos).length;
    unlock('fotografo');
    if (n >= 10) unlock('reportero');
    emit('photo', { id, bonus });
    checkSets();
  }

  // ---------------- Botes de pintura ----------------
  function takeCan(can) {
    const s = S();
    if (s.cansTaken[can.id]) return;
    s.cansTaken[can.id] = 1;
    s.stats.cans++;
    if (can.kind === 'gold') {
      goldenUntil = Math.max(Date.now(), goldenUntil) + 60000;
      addXP(100, 'can');
    } else addXP(50, 'can');
    progressMission('cans', 1);
    emit('can', { can });
  }

  // ---------------- Misiones diarias ----------------
  const MISSION_TEMPLATES = [
    { type: 'paint', goals: [300, 600, 1000, 2000], text: (g) => `Pinta ${PM.fmtDist(g)} de calles nuevas` },
    { type: 'landmark', goals: [1, 2, 3], text: (g) => `Captura ${g} monumento${g > 1 ? 's' : ''}` },
    { type: 'combo', goals: [15, 25, 40], text: (g) => `Consigue un combo x${g}` },
    { type: 'walk', goals: [1000, 2000, 4000], text: (g) => `Camina ${PM.fmtDist(g)}` },
  ];

  function ensureDaily() {
    const s = S();
    const today = PM.today();
    if (s.daily && s.daily.date === today) return s.daily;
    const rnd = PM.rng('missions' + today);
    const pool = MISSION_TEMPLATES.slice();
    const missions = [];
    for (let i = 0; i < 3; i++) {
      const tpl = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
      const goal = tpl.goals[Math.floor(rnd() * tpl.goals.length)];
      missions.push({ type: tpl.type, goal, text: tpl.text(goal), progress: 0, done: false, reward: 300 });
    }
    s.daily = { date: today, missions, chest: false };
    PM.state.save();
    return s.daily;
  }
  // día "jugado" = día en que has pintado o andado de verdad (abrir la app no cuenta)
  function markActiveDay() {
    const s = S(), today = PM.today();
    if (s.stats.lastDay === today) return;
    const yest = new Date(Date.now() - 86400000);
    const yKey = yest.getFullYear() + '-' + String(yest.getMonth() + 1).padStart(2, '0') + '-' + String(yest.getDate()).padStart(2, '0');
    s.stats.streak = s.stats.lastDay === yKey ? s.stats.streak + 1 : 1;
    s.stats.lastDay = today;
    s.stats.days++;
    if (s.stats.streak >= 3) unlock('racha3');
    if (s.stats.streak >= 7) unlock('racha7');
    PM.state.save();
  }

  function progressMission(type, amount, isMax) {
    const d = ensureDaily();
    for (const m of d.missions) {
      if (m.type !== type || m.done) continue;
      m.progress = isMax ? Math.max(m.progress, amount) : m.progress + amount;
      if (m.progress >= m.goal) {
        m.progress = m.goal; m.done = true;
        addXP(m.reward, 'mission');
        emit('mission', { m });
      }
    }
    if (!d.chest && d.missions.every((m) => m.done)) {
      d.chest = true;
      addXP(1000, 'chest');
      emit('chest', {});
    }
    PM.state.save();
  }

  function addWalk(m) {
    markActiveDay();
    S().stats.walkedM += m;
    progressMission('walk', m);
  }

  // ---------------- Logros ----------------
  const ACHIEVEMENTS = {
    primera_brocha: { name: 'Primera brocha', desc: 'Pinta tu primer tramo de calle', icon: '🖌️' },
    km1: { name: 'Kilómetro de color', desc: 'Pinta 1 km de calles', icon: '🛣️' },
    km10: { name: 'Maratón de pintura', desc: 'Pinta 10 km de calles', icon: '🏃' },
    km42: { name: 'Fidias urbano', desc: 'Pinta 42 km de calles', icon: '🏅' },
    combo50: { name: 'Imparable', desc: 'Combo x50', icon: '🔥' },
    primer_sello: { name: 'Turista', desc: 'Captura tu primer monumento', icon: '📸' },
    coleccionista: { name: 'Coleccionista', desc: 'Captura 10 monumentos', icon: '📚' },
    enciclopedia: { name: 'Enciclopedia andante', desc: 'Captura 50 monumentos', icon: '🧠' },
    peregrino: { name: 'Peregrino', desc: 'Visita 3 templos', icon: '⛪' },
    alcalde: { name: 'Señor alcalde', desc: 'Captura un ayuntamiento', icon: '🏛️' },
    leyenda: { name: 'Cazador de leyendas', desc: 'Captura un monumento legendario', icon: '👑' },
    conquistador: { name: 'Conquistador', desc: 'Conquista tu primer barrio (80 %)', icon: '🚩' },
    senor_barrios: { name: 'Señor de los barrios', desc: 'Conquista 5 barrios', icon: '🗺️' },
    perfeccionista: { name: 'Perfeccionista', desc: 'Pinta un barrio al 100 %', icon: '💯' },
    rey_ciudad: { name: 'Rey de la ciudad', desc: 'Pinta el 80 % de una ciudad', icon: '🏙️' },
    fotografo: { name: 'Fotógrafo', desc: 'Pon tu propia foto en un cromo', icon: '📸' },
    reportero: { name: 'Reportero', desc: '10 cromos con foto propia', icon: '🎞️' },
    madrugador: { name: 'Madrugador', desc: 'Pinta antes de las 8:00', icon: '🌅' },
    noctambulo: { name: 'Noctámbulo', desc: 'Pinta después de las 22:00', icon: '🌙' },
    racha3: { name: 'Constante', desc: 'Juega 3 días seguidos', icon: '📅' },
    racha7: { name: 'Hábito de hierro', desc: 'Juega 7 días seguidos', icon: '💪' },
  };

  // ---------- Logros en series (más de 200): se comprueban solos con el estado de la partida ----------
  const km = (m) => m / 1000;
  const fmtN = (n) => n >= 1000 ? (n / 1000) + ' mil' : String(n);
  function serie(prefix, icon, tiers, name, desc, value) {
    tiers.forEach((t, i) => {
      const id = prefix + '_' + t;
      if (ACHIEVEMENTS[id]) return;
      ACHIEVEMENTS[id] = { name: typeof name === 'function' ? name(t, i) : name + ' ' + ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV'][i],
        desc: desc(t), icon, check: (s) => value(s) >= t,
        prog: (s) => { try { return Math.max(0, Math.min(1, (value(s) || 0) / t)); } catch (e) { return 0; } }, goal: t, value };   // progreso (panel «Mi progreso»)
    });
  }
  const lmList = (s) => Object.values(s.landmarks || {});
  const byKind = (s, k) => lmList(s).filter((v) => (v.kind || '').replace(' principal', '') === k).length;
  const byRarity = (s, r) => lmList(s).filter((v) => v.rarity === r).length;
  const walksOf = (s) => s.walks || [];
  serie('pinta', '🛣️', [5, 21, 50, 75, 100, 150, 200, 300, 500, 750, 1000], 'Rodillo incansable', (t) => `Pinta ${t} km de calles`, (s) => km(s.stats.paintedM));
  serie('anda', '👟', [1, 5, 10, 25, 50, 100, 200, 300, 500, 1000, 2000], 'Caminante', (t) => `Camina ${t} km en total`, (s) => km(s.stats.walkedM));
  serie('captura', '📸', [5, 25, 75, 100, 150, 200, 300, 500, 750, 1000], 'Cazador de lugares', (t) => `Captura ${t} lugares`, (s) => lmList(s).length);
  const KINDS = [['Ayuntamiento', '🏛️'], ['Catedral', '⛪'], ['Basílica', '⛪'], ['Castillo', '🏰'], ['Palacio', '🏰'], ['Estadio', '🏟️'], ['Iglesia', '⛪'],
    ['Templo', '🛕'], ['Museo', '🖼️'], ['Monumento', '🗽'], ['Torre / Puerta', '🗼'], ['Teatro', '🎭'], ['Universidad', '🎓'], ['Plaza', '🏙️'], ['Faro', '🗼'],
    ['Estación', '🚉'], ['Parada de tranvía', '🚋'], ['Ermita / Monasterio', '⛪'], ['Comercio emblemático', '☕'], ['Parque', '🌳'], ['Ruinas', '🏺'], ['Mirador', '🔭'], ['Campo de fútbol', '⚽'], ['Mercado', '🛒'], ['Biblioteca', '📚'],
    ['Atracción', '⭐'], ['Memorial', '🗿'], ['Fuente', '⛲'], ['Arte urbano', '🎨'], ['Hospital', '🏥'], ['Bomberos', '🚒'], ['Patrimonio', '🏛️'], ['Molino', '🌬️'], ['Lugar histórico', '📜']];
  for (const [k, ic] of KINDS) {
    const slug = k.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]+/g, '');
    serie('k' + slug, ic, [1, 5, 15], (t, i) => `${k}: ${['primera', 'coleccionista', 'experto'][i]}`, (t) => `Captura ${t} ${t > 1 ? 'lugares' : 'lugar'} de tipo «${k}»`, (s) => byKind(s, k));
  }
  serie('legend', '👑', [5, 10, 25, 50], 'Cazador de leyendas', (t) => `Captura ${t} lugares legendarios`, (s) => byRarity(s, 'legendario'));
  serie('epico', '💜', [1, 10, 25, 50, 100], 'Épico', (t) => `Captura ${t} lugares épicos`, (s) => byRarity(s, 'epico'));
  serie('raro', '💙', [10, 50, 100, 200], 'Rarezas', (t) => `Captura ${t} lugares raros`, (s) => byRarity(s, 'raro'));
  serie('barrios', '🚩', [10, 15, 25, 50, 75, 100, 150, 200], 'Señor de los barrios', (t) => `Conquista ${t} barrios`, (s) => Object.keys(s.conqueredB || {}).length);
  serie('perfecto', '💯', [3, 5, 10, 25], 'Perfeccionista', (t) => `Pinta ${t} barrios al 100 %`, (s) => Object.keys(s.perfectB || {}).length);
  serie('reyes', '🏙️', [2, 3, 5, 10], 'Rey de ciudades', (t) => `Pinta el 80 % de ${t} ciudades`, (s) => Object.keys(s.citiesWon || {}).length);
  serie('viajero', '🧳', [2, 3, 5, 10, 20, 50], 'Viajero', (t) => `Pinta calles en ${t} ciudades distintas`,
    (s) => new Set(Object.entries(s.tileNames || {}).filter(([k, v]) => v.city && (s.paintedByTile || {})[k] > 0).map(([, v]) => v.city)).size);
  serie('racha', '📅', [14, 30, 60, 100, 365], 'Racha', (t) => `Juega ${t} días seguidos`, (s) => s.stats.streak || 0);
  serie('dias', '🗓️', [5, 10, 25, 50, 100, 200, 365], 'Veterano', (t) => `Juega ${t} días distintos`, (s) => s.stats.days || 0);
  serie('combo', '🔥', [10, 25, 100, 150, 200], 'Combo', (t) => `Consigue un combo x${t}`, (s) => s.stats.bestCombo || 0);
  const LV = [5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 99, 100, 150, 200, 300, 400, 500, 600, 699];
  serie('nivel', '⭐', LV, (t) => `Nivel ${PM.levelName(t).label}`, (t) => `Llega al nivel ${PM.levelName(t).label}`, (s) => PM.levelInfo(s.xp).level);
  serie('paseos', '🚶', [1, 5, 10, 25, 50, 100, 200, 365, 500], 'Paseante', (t) => `Completa ${t} paseo${t > 1 ? 's' : ''}`, (s) => walksOf(s).length);
  serie('largo', '🥾', [3, 5, 10, 15, 21, 30], 'Gran paseo', (t) => `Un paseo de ${t} km o más`, (s) => km(Math.max(0, ...walksOf(s).map((w) => (w.st && w.st.walked) || 0))));
  serie('horas', '⏱️', [30, 60, 120, 180], (t) => t < 60 ? 'Media hora' : `${t / 60} hora${t > 60 ? 's' : ''} sin parar`, (t) => `Un paseo de ${t} minutos o más`, (s) => Math.max(0, ...walksOf(s).map((w) => (w.elapsed || 0) / 60000)));
  serie('habitual', '♻️', [10, 50, 100, 500, 1000, 5000], 'Ruta habitual', (t) => `Repite ${fmtN(t)} tramos de calle ya pintados`, (s) => Object.keys(s.heat || {}).length);
  serie('fotos', '📷', [5, 25, 50, 100], 'Fotógrafo', (t) => `${t} cromos con foto propia`, (s) => Object.keys(s.cardPhotos || {}).length);
  serie('fiel', '🔁', [5, 10, 25], 'Fiel', (t) => `Visita ${t} veces el mismo lugar`, (s) => Math.max(0, ...lmList(s).map((v) => v.visits || 1)));
  serie('colec', '🗂️', [1, 3, 5, 10], 'Colecciones', (t) => `Completa ${t} colecci${t > 1 ? 'ones' : 'ón'}`, (s) => Object.keys(s.setsDone || {}).length);
  // tu perro
  const petOf = (s) => s.pet || {};
  serie('perro', '🐶', [1, 5, 10, 25, 50, 100, 250, 500, 1000], 'Mejor amigo', (t) => `Pasea ${t} km con tu perro`, (s) => km(s.stats.walkedM || 0) * (s.pet ? 1 : 0));
  serie('trucos', '🦴', [1, 10, 50, 100, 250, 500], 'Domador', (t) => `Tu perro hace ${t} truco${t > 1 ? 's' : ''}`, (s) => petOf(s).tricks || 0);
  serie('perrofeliz', '💖', [1, 7, 30, 100, 365], 'Perro feliz', (t) => `${t} día${t > 1 ? 's' : ''} con los 3 corazones de tu perro`, (s) => petOf(s).fullDays || 0);
  serie('razas', '🐕', [3, 6, 10], 'Amante de los perros', (t) => `Prueba ${t} razas de perro`, (s) => (petOf(s).breeds || []).length);
  serie('look', '🎀', [3, 7, 13], 'Perro con estilo', (t) => `Desbloquea ${t} accesorios para tu perro`, (s) => [5, 10, 15, 20, 30, 40, 60, 80, 100, 120, 150, 200, 250].filter((n) => Object.keys(s.achievements || {}).length >= n).length);
  serie('sendero', '🌲', [1, 5, 10, 25], 'Senderista', (t) => `Pinta ${t} km de senderos y caminos`, (s) => km(s.stats.trailM || 0));
  serie('puntos', '🏆', [10000, 50000, 100000, 250000, 500000, 1000000, 2000000, 5000000], 'Puntos', (t) => `Consigue ${PM.fmtNum ? PM.fmtNum(t) : t} puntos`, (s) => s.xp || 0);

  let achReady = false;
  function checkAll() {
    if (!document.getElementById('hud') || !PM.state) return;   // solo en el juego (no en la web de progreso)
    const s = S();
    const first = !s.achInit;   // la primera vez (partidas antiguas): se apuntan sin avisar de golpe
    for (const id in ACHIEVEMENTS) {
      const a = ACHIEVEMENTS[id];
      if (!a.check || s.achievements[id]) continue;
      try { if (a.check(s)) unlock(id, first); } catch (e) { /* dato que aún no existe */ }
    }
    if (first) { s.achInit = Date.now(); PM.state.save(); }
    achReady = true;
  }
  setInterval(checkAll, 8000);
  setTimeout(checkAll, 1500);

  function unlock(id, silent) {
    const s = S();
    if (s.achievements[id] || !ACHIEVEMENTS[id]) return;
    s.achievements[id] = Date.now();
    PM.state.save();
    if (!silent) emit('achievement', { id, a: ACHIEVEMENTS[id] });
  }

  function checkPaintAchievements() {
    const st = S().stats;
    unlock('primera_brocha');
    if (st.paintedM >= 1000) unlock('km1');
    if (st.paintedM >= 10000) unlock('km10');
    if (st.paintedM >= 42195) unlock('km42');
    if (combo >= 50) unlock('combo50');
  }

  return {
    on: (fn) => listeners.push(fn),
    level, levelProgress, COLORS, ACHIEVEMENTS, checkAchievements: checkAll, REVISIT_MS, addXP,
    paintPiece, repass, tileProgress, cityProgress, barrioProgress, checkBarrio, checkSets, photoTaken, visitLandmark, takeCan, ensureDaily, addWalk, tickCombo,
    get combo() { return combo; },
    comboMult,
    goldenLeft: () => Math.max(0, goldenUntil - Date.now()),
  };
})();
