// PintaMapa — estado del jugador, puntuación, niveles, misiones y logros
// Dos perfiles separados: 'real' (GPS del móvil, tu cuenta, se sincroniza con el PC)
// y 'prueba' (simulación con teclado/joystick, nunca se mezcla con el real).
PM.isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
PM.profile = (function () {
  let p = null;
  try { p = localStorage.getItem('pintamapa_profile'); } catch (e) {}
  if (!PM.isNative) return 'prueba';          // en el PC se juega siempre en prueba
  return p === 'prueba' ? 'prueba' : 'real';
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
    color: '#ff2e88',
    painted: {},        // pieceId -> 1
    paintedByTile: {},  // tileKey -> metros pintados
    landmarks: {},      // id -> {t, name, kind, emoji, rarity, visits, last}
    conquered: {},      // tileKey -> fecha
    perfect: {},        // tileKey -> fecha (100 %)
    citiesWon: {},      // ciudad -> fecha
    cities: {},         // ciudad -> {total}
    tileNames: {},
    cansTaken: {},      // id -> 1 (ids incluyen la fecha)
    achievements: {},
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
  const xpForLevel = (lvl) => Math.round(400 * Math.pow(lvl - 1, 1.6)); // xp acumulada para llegar a lvl
  function level() { let l = 1; while (S().xp >= xpForLevel(l + 1)) l++; return l; }
  function levelProgress() {
    const l = level(), a = xpForLevel(l), b = xpForLevel(l + 1);
    return { level: l, cur: S().xp - a, need: b - a, pct: (S().xp - a) / (b - a) };
  }

  const COLORS = [
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
    if (PM.profile === 'real') s.pendingGeo[piece.id] = piece.pts.map((q) => [+q[0].toFixed(6), +q[1].toFixed(6)]);
    s.paintedByTile[piece.tile] = (s.paintedByTile[piece.tile] || 0) + piece.len;
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
    checkPaintAchievements();
    return pts;
  }

  function tileProgress(key) {
    const t = PM.world.tiles[key];
    if (!t || !t.total) return 0;
    return Math.min(1, (S().paintedByTile[key] || 0) / t.total);
  }

  function checkTile(key) {
    const t = PM.world.tiles[key];
    if (!t || !t.loaded || t.total < 150) return;   // barrio incompleto o sin apenas calles: no cuenta
    const p = tileProgress(key);
    const s = S();
    if (p >= 0.8 && !s.conquered[key]) {
      s.conquered[key] = Date.now();
      addXP(2000, 'conquest');
      progressMission('conquer', 1);
      unlock('conquistador');
      if (Object.keys(s.conquered).length >= 5) unlock('senor_barrios');
      emit('conquered', { key, name: t.name });
    }
    if (p >= 0.995 && !s.perfect[key]) {
      s.perfect[key] = Date.now();
      addXP(1000, 'perfect');
      unlock('perfeccionista');
      emit('perfect', { key, name: t.name });
    }
    if (t.city) checkCity(t.city);
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
    const real = s.cities[city] && s.cities[city].total;
    const total = real || loadedTotal;
    return { painted, total, real: !!real, pct: total ? Math.min(1, painted / total) : 0 };
  }

  function checkCity(city) {
    const s = S();
    const cp = cityProgress(city);
    if (cp.real && cp.pct >= 0.8 && !s.citiesWon[city]) {
      s.citiesWon[city] = Date.now();
      addXP(25000, 'city');
      unlock('rey_ciudad');
      emit('cityWon', { city });
    }
  }

  // ---------------- Monumentos ----------------
  const REVISIT_MS = 60 * 60 * 1000;
  function visitLandmark(lm) {
    const s = S();
    const rec = s.landmarks[lm.id];
    const now = Date.now();
    if (!rec) {
      // se guarda la posición: el monumento conquistado se dibuja para siempre, aunque esa zona no esté cargada
      s.landmarks[lm.id] = { t: now, last: now, visits: 1, name: lm.name, kind: lm.kind, emoji: lm.emoji, rarity: lm.rarity,
        pos: [+lm.pos[0].toFixed(6), +lm.pos[1].toFixed(6)] };
      s.stats.captures++;
      if (lm.kind === 'Templo' || lm.kind === 'Catedral') s.stats.churches++;
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
    { type: 'cans', goals: [2, 3, 5], text: (g) => `Recoge ${g} botes de pintura` },
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
    // racha de días
    const yest = new Date(Date.now() - 86400000);
    const yKey = yest.getFullYear() + '-' + String(yest.getMonth() + 1).padStart(2, '0') + '-' + String(yest.getDate()).padStart(2, '0');
    s.stats.streak = s.stats.lastDay === yKey ? s.stats.streak + 1 : 1;
    s.stats.lastDay = today;
    s.stats.days++;
    if (s.stats.streak >= 3) unlock('racha3');
    if (s.stats.streak >= 7) unlock('racha7');
    PM.state.save();
    return s.daily;
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
    madrugador: { name: 'Madrugador', desc: 'Pinta antes de las 8:00', icon: '🌅' },
    noctambulo: { name: 'Noctámbulo', desc: 'Pinta después de las 22:00', icon: '🌙' },
    racha3: { name: 'Constante', desc: 'Juega 3 días seguidos', icon: '📅' },
    racha7: { name: 'Hábito de hierro', desc: 'Juega 7 días seguidos', icon: '💪' },
  };

  function unlock(id) {
    const s = S();
    if (s.achievements[id] || !ACHIEVEMENTS[id]) return;
    s.achievements[id] = Date.now();
    PM.state.save();
    emit('achievement', { id, a: ACHIEVEMENTS[id] });
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
    level, levelProgress, COLORS, ACHIEVEMENTS,
    paintPiece, tileProgress, cityProgress, visitLandmark, takeCan, ensureDaily, addWalk, tickCombo,
    get combo() { return combo; },
    comboMult,
    goldenLeft: () => Math.max(0, goldenUntil - Date.now()),
  };
})();
