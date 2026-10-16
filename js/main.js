// PintaMapa — mapa, movimiento (GPS o simulación), render e interfaz
(function () {
  const W = PM.world, G = PM.game, S = () => PM.state.data;
  const $ = (s) => document.querySelector(s);
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

  const PAINT_RADIUS = 14;      // m: margen para el error del GPS (calle por la que vas)
  const PAINT_CORE = 5;         // m: parado o sin dirección conocida, se pinta solo lo que pisas
  const WIDE_RADIUS = 40;       // m: en avenidas anchas basta una acera para pintar ambas calzadas
  const CAPTURE_RADIUS = 30;    // m: hay que estar así de cerca de un monumento…
  const CAPTURE_SECONDS = 10;   // …durante este tiempo para capturarlo (no vale pasar de largo)
  const CAPTURE_EXIT = 40;      // m: margen para que un salto del GPS no cancele la captura
  const AURA_RADIUS = 80;       // m de "aura" de monumento (puntos x2)
  const CAN_RADIUS = 25;        // m para recoger un bote
  const MAX_SPEED = 7;          // m/s (~25 km/h): más rápido no pinta (anti-coche) en modo GPS

  // Punto de inicio de la simulación (sin GPS): Carrer de Bellaterra, Cornellà de Llobregat
  const HOME = [41.35763, 2.07386];
  const PRESETS = [
    { name: '🏠 Casa · C/ Bellaterra, Cornellà', p: HOME },
    { name: 'Madrid · Puerta del Sol', p: [40.41688, -3.70379] },
    { name: 'Toledo · Catedral', p: [39.85716, -4.02393] },
    { name: 'Sevilla · Giralda', p: [37.38614, -5.99252] },
    { name: 'Salamanca · Plaza Mayor', p: [40.96498, -5.66406] },
    { name: 'Granada · Catedral', p: [37.17644, -3.59900] },
    { name: 'Barcelona · Barri Gòtic', p: [41.38365, 2.17617] },
    { name: 'Valencia · Ayuntamiento', p: [39.46975, -0.37641] },
    { name: 'Santiago · Obradoiro', p: [42.88050, -8.54569] },
    { name: 'Ciudad Demo (sin internet)', p: [39.6025, -3.0035], demo: true },
  ];

  // ---------------- Mapa ----------------
  const start = S().lastPos || HOME;
  const map = L.map('map', { zoomControl: false, attributionControl: true, preferCanvas: true,
    rotate: true, bearing: 0, rotateControl: false, touchRotate: false, shiftKeyRotate: false, compassBearing: false,
    touchZoom: 'center', scrollWheelZoom: 'center', doubleClickZoom: 'center' })
    .setView(start, 17);
  // Teselas estándar de OSM oscurecidas por CSS (prototipo; para la Play Store usar un proveedor con clave)
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, className: 'dark-tiles',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  const renderer = L.canvas({ padding: 0.5 });

  const layers = { avoid: L.layerGroup().addTo(map), barrios: L.layerGroup().addTo(map), tiles: L.layerGroup().addTo(map), lm: L.layerGroup().addTo(map), cans: L.layerGroup().addTo(map) };
  const tileLayers = {};  // key -> {base, glow, core, rect, flag, paintedPts}

  function paintColor() { return S().color; }
  function applyTheme() {
    const dark = S().theme === 'dark';   // claro por defecto
    document.body.classList.toggle('dark', dark);
    document.querySelector('meta[name=theme-color]').setAttribute('content', dark ? '#0d0f17' : '#f4f6fb');
  }
  applyTheme();

  function removeTileLayers(key) {
    const tl = tileLayers[key];
    if (!tl) return;
    ['base', 'trailBase', 'glow', 'core', 'rect', 'flag'].forEach((n) => tl[n] && tl[n].remove());
    (tl.heat || []).forEach((h) => h.remove());
    delete tileLayers[key];
  }
  // force: redibujar (p. ej. al pasar de carga parcial a barrio completo)
  function renderTile(key, force) {
    if (force === true) removeTileLayers(key);
    const t = W.tiles[key];
    if (!t || !(t.loaded || t.partial) || tileLayers[key]) return;
    const streets = t.pieces.filter((p) => !p.trail).map((p) => p.pts), trails = t.pieces.filter((p) => p.trail).map((p) => p.pts);
    const painted = t.pieces.filter((p) => S().painted[p.id]);
    const lv = (p) => heatLevel(p.id);
    const tl = { paintedPts: painted.filter((p) => !lv(p)).map((p) => p.pts), glowPts: painted.map((p) => p.pts) };
    if (t.pieces.length) {
      tl.base = L.polyline(streets, { renderer, color: '#6b7690', weight: 4, opacity: 0.8, interactive: false }).addTo(layers.tiles);
      // senderos y caminos: discontinuos (se pintan, pero no cuentan para el % de conquista)
      if (trails.length) tl.trailBase = L.polyline(trails, { renderer, color: '#9a8a66', weight: 2.5, opacity: 0.85, dashArray: '3 6', interactive: false }).addTo(layers.tiles);
      tl.glow = L.polyline(tl.glowPts, { renderer, color: paintColor(), weight: 14, opacity: 0.22, lineCap: 'round', interactive: false }).addTo(layers.tiles);
      tl.core = L.polyline(tl.paintedPts, { renderer, color: paintColor(), weight: 5, opacity: 1, lineCap: 'round', interactive: false }).addTo(layers.tiles);
      // tus calles de siempre: cuantas más veces pasas, más intenso y grueso el trazo
      tl.heat = [1, 2, 3].map((l) => L.polyline(painted.filter((p) => lv(p) === l).map((p) => p.pts),
        { renderer, color: heatColor(l), weight: 5 + l, opacity: 1, lineCap: 'round', interactive: false }).addTo(layers.tiles));
    }
    tileLayers[key] = tl;
    refreshFlag(key);
  }

  // ---------- Barrios reales: contorno del barrio donde estás y de los conquistados, con bandera ----------
  let curBarrio = null;
  function refreshFlag() { renderBarrios(); }
  // ---------- Zonas a evitar (personales, privadas): fuera del % de barrio y ciudad ----------
  let avoidEdit = false;
  function setAvoidEdit(on) {
    avoidEdit = on;
    $('#btn-avoid').classList.toggle('on', on);
    if (on) toast('🚫 Toca en el mapa la zona o el barrio que prefieras evitar', 'info', 4000);
  }
  $('#btn-avoid').addEventListener('click', () => setAvoidEdit(!avoidEdit));
  function avoidChanged() {
    PM.state.save();
    W.setAvoid(S().avoid);
    for (const id in canMarkers) { canMarkers[id].remove(); delete canMarkers[id]; }
    renderCans();
    setTimeout(renderBarrios, 400);   // tras recalcular los barrios
  }
  function addAvoid(z) {
    z.id = 'z' + Date.now().toString(36); z.t = Date.now();
    S().avoid.push(z);
    avoidChanged(); setAvoidEdit(false);
    $('#sheet').classList.remove('show');
    toast(`🚫 ${z.type === 'barrio' ? 'Barrio «' + z.name + '»' : 'Zona'} excluida: sus calles no cuentan para el %`, 'info', 4000);
  }
  function removeAvoid(id) {
    S().avoid = S().avoid.filter((z) => z.id !== id);
    S().avoidRemoved[id] = Date.now();
    avoidChanged();
    $('#sheet').classList.remove('show');
    toast('✅ Zona quitada: sus calles vuelven a contar', 'info');
  }
  function askAvoid(p) {
    const b = W.barrioAt(p);
    const already = S().avoid.find((z) => (z.type === 'barrio' && z.id === b.id) || (z.type === 'circle' && PM.geo.dist(p, z.c) <= z.r));
    if (already) { askRemoveAvoid(already); return; }
    openSheet('🚫 Zona a evitar', `
      <p class="muted">Sus calles quedan <b>fuera del porcentaje</b> del barrio y de la ciudad: puedes llegar al 80 % sin pasar por ahí. Allí no salen botes y el radar no te lleva. Solo lo ves tú.</p>
      <h4>Alrededor de este punto</h4>
      <div class="seg"><button class="btn" data-r="100">100 m</button><button class="btn" data-r="200">200 m</button><button class="btn" data-r="400">400 m</button></div>
      <h4>O el barrio entero</h4>
      <button class="btn" id="av-barrio" style="width:100%">🚫 Evitar todo «${b.name}»</button>`);
    document.querySelectorAll('#sheet [data-r]').forEach((bt) => bt.addEventListener('click', () => addAvoid({ type: 'circle', c: [+p[0].toFixed(6), +p[1].toFixed(6)], r: +bt.dataset.r })));
    $('#av-barrio').addEventListener('click', () => addAvoid({ type: 'barrio', id: b.id, name: b.name }));
  }
  function askRemoveAvoid(z) {
    openSheet('🚫 Zona evitada', `<p>${z.type === 'barrio' ? 'Barrio <b>' + z.name + '</b>' : 'Zona de ' + z.r + ' m'} · desde el ${new Date(z.t).toLocaleDateString('es-ES')}</p>
      <button class="btn on" id="av-del" style="width:100%">Quitar: que vuelva a contar</button>`);
    $('#av-del').addEventListener('click', () => removeAvoid(z.id));
  }
  function renderAvoid() {
    layers.avoid.clearLayers();
    const label = (p, txt, z) => L.marker(p, { icon: L.divIcon({ className: '', html: `<div class="avoidlbl">🚫 ${txt}</div>`, iconSize: [10, 10], iconAnchor: [5, 5] }) })
      .on('click', () => askRemoveAvoid(z)).addTo(layers.avoid);
    for (const z of S().avoid) {
      if (z.type === 'circle') {
        L.circle(z.c, { renderer, radius: z.r, color: '#6b7280', weight: 2, dashArray: '6 6', fillColor: '#6b7280', fillOpacity: 0.2 })
          .on('click', (e) => { L.DomEvent.stopPropagation(e); askRemoveAvoid(z); }).addTo(layers.avoid);
        label(z.c, '', z);
      } else {
        const B = W.barrios[z.id];
        if (B && B.segs) L.polyline(B.segs, { renderer, color: '#6b7280', weight: 5, opacity: 0.6, dashArray: '2 8', interactive: false }).addTo(layers.avoid);
        if (B && B.pos) label(B.pos, z.name, z);
      }
    }
  }

  function renderBarrios() {
    renderAvoid();
    layers.barrios.clearLayers();
    for (const B of Object.values(W.barrios)) {
      const conq = !!S().conqueredB[B.id], cur = B.id === curBarrio;
      if (B.segs && (cur || conq)) {
        L.polyline(B.segs, { renderer, color: conq ? paintColor() : '#5b6478', weight: cur ? 3 : 2, opacity: cur ? 0.85 : 0.6,
          dashArray: conq ? null : '6 8', interactive: false }).addTo(layers.barrios);
      }
      if (conq && B.pos) {
        L.marker(B.pos, { icon: L.divIcon({ className: '', html: `<div class="flag">🚩</div>`, iconSize: [30, 30], iconAnchor: [6, 28] }), interactive: false })
          .addTo(layers.barrios);
      }
    }
  }

  const dirtyTiles = new Set();
  const rerenderTiles = new Set();
  function flushPaint() {
    dirtyTiles.forEach((k) => {
      const tl = tileLayers[k];
      if (tl && tl.core) { tl.core.setLatLngs(tl.paintedPts); tl.glow.setLatLngs(tl.glowPts); }
    });
    dirtyTiles.clear();
    if (rerenderTiles.size && !document.hidden) { rerenderTiles.forEach((k) => renderTile(k, true)); rerenderTiles.clear(); }
  }
  // intensidad del trazo según las pasadas: 1 vez = normal · 2-3 · 4-6 · 7+ = tu ruta habitual
  function heatLevel(id) { const n = (S().heat || {})[id] || 1; return n >= 7 ? 3 : n >= 4 ? 2 : n >= 2 ? 1 : 0; }
  function heatColor(l) {
    const c = paintColor().replace('#', ''), k = [0, 0.2, 0.36, 0.5][l];
    const ch = (i) => Math.round(parseInt(c.substr(i, 2), 16) * (1 - k)).toString(16).padStart(2, '0');
    return c.length === 6 ? '#' + ch(0) + ch(2) + ch(4) : paintColor();
  }

  function recolorAll() {
    for (const k in tileLayers) {
      const tl = tileLayers[k];
      if (tl.core) { tl.core.setStyle({ color: paintColor() }); tl.glow.setStyle({ color: paintColor() }); }
      (tl.heat || []).forEach((h, i) => h.setStyle({ color: heatColor(i + 1) }));
    }
    renderBarrios();
    for (const id in lmHalos) lmHalos[id].setStyle({ color: paintColor(), fillColor: paintColor() });
    document.documentElement.style.setProperty('--paint', paintColor());
  }

  // Monumentos. Los conquistados (visitados) quedan para siempre en el mapa con tu color, bandera y halo de territorio.
  const lmMarkers = {}, lmHalos = {};
  function lmIcon(lm) {
    const got = !!S().landmarks[lm.id];
    return L.divIcon({
      className: '',
      html: got ? `<div class="lm conq r-${lm.rarity}"><span>${lm.emoji}</span><i class="lmflag">🚩</i></div>`
                : `<div class="lm r-${lm.rarity}"><span>${lm.emoji}</span></div>`,
      iconSize: [40, 40], iconAnchor: [20, 20],
    });
  }
  function placeLandmark(lm) {
    const got = !!S().landmarks[lm.id];
    if (lmMarkers[lm.id]) lmMarkers[lm.id].setIcon(lmIcon(lm));
    else lmMarkers[lm.id] = L.marker(lm.pos, { icon: lmIcon(lm), zIndexOffset: got ? 500 : 0 })
      .on('click', () => showLandmarkInfo(lm)).addTo(layers.lm);
    if (got && !lmHalos[lm.id]) {
      lmHalos[lm.id] = L.circle(lm.pos, { renderer, radius: (lm.capR || PM.capRadius(lm.kind)) + 10, color: paintColor(), weight: 2, opacity: 0.7,
        fillColor: paintColor(), fillOpacity: 0.18, interactive: false }).addTo(layers.lm);
    }
  }
  function renderLandmarks() {
    for (const id in W.landmarks) {
      const rec = S().landmarks[id];
      if (rec && !rec.pos) { rec.pos = W.landmarks[id].pos; PM.state.save(); }
      placeLandmark(W.landmarks[id]);
    }
    // conquistados guardados en tu partida (estén o no cargados ahora): siempre visibles
    for (const [id, rec] of Object.entries(S().landmarks)) {
      if (lmMarkers[id] || !rec.pos) continue;
      placeLandmark(Object.assign({ id, points: 0 }, rec));
    }
  }

  // Botes de pintura
  const canMarkers = {};
  function renderCans() {
    return;   // ya no hay botes de pintura en el mapa
    for (const id in W.cans) {
      if (canMarkers[id] || S().cansTaken[id]) continue;
      const c = W.cans[id];
      if (W.isAvoided(c.pos)) continue;   // en tus zonas a evitar no salen botes
      canMarkers[id] = L.marker(c.pos, {
        icon: L.divIcon({ className: '', html: `<div class="can ${c.kind}">🪣</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
        interactive: false,
      }).addTo(layers.cans);
    }
  }

  // Jugador
  let pos = start.slice();
  const player = L.marker(pos, {
    icon: L.divIcon({ className: '', html: '<div class="player"><div class="pulse"></div><div class="arrow"></div><div class="dot">🖌️</div></div>', iconSize: [44, 44], iconAnchor: [22, 22] }),
    zIndexOffset: 1000, interactive: false,
  }).addTo(map);
  const paintCircle = L.circle(pos, { renderer, radius: PAINT_RADIUS, color: '#fff', weight: 1, opacity: 0.35, fillOpacity: 0.05, interactive: false }).addTo(map);
  const auraCircle = L.circle(pos, { renderer, radius: CAPTURE_RADIUS, color: '#ffb700', weight: 2, dashArray: '3 6', opacity: 0, fill: false, interactive: false }).addTo(map);

  // ---------------- Movimiento y lógica de pintura ----------------
  let mode = PM.profile === 'real' ? 'gps' : 'sim';   // perfil real = GPS; perfil prueba = simulación
  let follow = true;
  let lastP = null, lastT = 0, speed = 0, tooFast = false;
  let curTile = null;
  let walkAnchor = null;
  let turbo = false;

  // ---------------- Cámara: tú siempre en el centro, lo que se mueve es el mapa ----------------
  // El centro es el de la zona visible (entre el panel de arriba y el de abajo). Entre lecturas del GPS
  // el punto se desliza suave. Si arrastras el mapa para mirar, vuelve solo a los 8 s.
  let disp = null, anim = null, recenterTimer = null;
  function viewCenterPx() {
    const r = map.getContainer().getBoundingClientRect();
    const top = Math.max(0, $('#hud').getBoundingClientRect().bottom - r.top);
    const sb = $('#session').getBoundingClientRect(), nb = $('#nav').getBoundingClientRect();
    const bottom = Math.min(sb.height ? sb.top : r.bottom, nb.height ? nb.top : r.bottom) - r.top;
    return L.point(r.width / 2, bottom > top + 100 ? (top + bottom) / 2 : r.height / 2);
  }
  function camera() {
    if (!follow || !disp || document.hidden) return;
    const want = viewCenterPx(), pt = map.latLngToContainerPoint(disp);
    const dx = pt.x - want.x, dy = pt.y - want.y;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) map.panBy([dx, dy], { animate: false });
  }
  function drawPlayer() { player.setLatLng(disp); paintCircle.setLatLng(disp); auraCircle.setLatLng(disp); camera(); }
  function showAt(p, smooth) {
    if (!disp || !smooth || PM.geo.dist(disp, p) > 300) { disp = p.slice(); anim = null; drawPlayer(); return; }
    anim = { from: disp.slice(), to: p.slice(), start: performance.now(), dur: 900 };
  }
  function stepDisplay(now) {
    if (!anim) return;
    const t = Math.min(1, (now - anim.start) / anim.dur);
    disp = PM.geo.lerp(anim.from, anim.to, t);
    if (t >= 1) anim = null;
    drawPlayer();
  }
  function recenter() { clearTimeout(recenterTimer); follow = true; $('#btn-center').classList.remove('show'); camera(); }

  function teleport(p) {
    pos = p.slice(); lastP = null; walkAnchor = null;
    map.setView(pos, Math.max(16, map.getZoom() || 17)); follow = true;
    showAt(pos, false);
    onMove(pos, true);
  }

  // fixTime: hora real de la lectura GPS. Con la pantalla bloqueada Android entrega las posiciones
  // en lotes; medir la velocidad por la hora de llegada daría velocidades absurdas (falso "vas en coche").
  function onMove(p, isTeleport, fixTime, fixSpeed, fixBearing) {
    const now = fixTime || Date.now();
    const visible = !document.hidden;
    if (visible) showAt(p, mode === 'gps' && !isTeleport);
    // rumbo que da el propio GPS (fiable al caminar): manda sobre el calculado
    if (fixBearing != null && !isNaN(fixBearing) && (fixSpeed || 0) > 0.9 && confirmTurn(fixBearing)) { setHeadingTarget(fixBearing); lastCourseT = Date.now(); }
    const painting = session && !session.paused;

    if (!painting) {
      // fuera de sesión te mueves por el mapa pero no se pinta nada
    } else if (lastP && !isTeleport) {
      const d = PM.geo.dist(lastP, p);
      const dt = (now - lastT) / 1000;
      // Velocidad: distancia / tiempo entre lecturas (hora real del GPS). Algunos móviles (y el emulador)
      // dicen siempre "velocidad 0", así que ese dato solo se usa si no hay otra forma de calcularla.
      const implied = dt > 0.3 ? d / dt : null;
      // Salto del GPS (túnel, edificio, primera lectura mala): imposible a pie → se ignora sin pintar
      const jump = mode === 'gps' && d > 40 && implied != null && implied > MAX_SPEED * 2;
      if (jump) {
        if (visible) toast('📡 Salto del GPS ignorado (no se pinta)', 'warn', 2500);
      } else if (implied != null) speed = speed * 0.6 + implied * 0.4;
      else if (fixSpeed != null && fixSpeed > 0) speed = speed * 0.5 + fixSpeed * 0.5;
      tooFast = mode === 'gps' && speed > MAX_SPEED;
      // Hueco entre lecturas (GPS en el bolsillo): se pinta el camino más corto POR LAS CALLES
      let routed = false;
      const via = softFixes.filter((f) => f.t > lastT && f.t < now).map((f) => f.p); softFixes = [];
      if (!jump && !tooFast && mode === 'gps' && d > 20 && d < 3000) {
        const maxLen = Math.max(d * 2, d + 250);
        const r = (via.length && routeVia(lastP, p, via)) || W.route(lastP, p, maxLen);
        if (r && r.len <= Math.max(maxLen, r.via ? r.len : 0) && (dt <= 0 || r.len / dt <= MAX_SPEED * 1.5)) {
          routed = true;
          const aura = nearestLandmark(p).d <= AURA_RADIUS;
          for (const id of r.pieces) { const pc = W.pieces[id]; if (pc) { if (S().painted[pc.id]) G.repass(pc); else G.paintPiece(pc, aura); } }
          paintAround(p, [p[0] - lastP[0], (p[1] - lastP[1]) * Math.cos(p[0] * Math.PI / 180)]);
          G.addWalk(r.len); session.st.walked += r.len; walkAnchor = p.slice();
          // el recorrido guarda el camino real por las calles (no una diagonal), con la hora repartida a lo largo del hueco
          const tr = session.track || (session.track = []);
          const way = (r.path || []).concat([p]);
          let acc = 0;
          for (let i = 0; i < way.length; i++) {
            if (i) acc += PM.geo.dist(way[i - 1], way[i]);
            const lt = tr[tr.length - 1];
            if (i < way.length - 1 && lt && PM.geo.dist(lt, way[i]) < 8) continue;
            tr.push(trackPt(way[i], lastT + (now - lastT) * Math.min(1, acc / Math.max(1, r.len))));
          }
        }
      }
      if (!routed && !jump && d > 0.01 && d < 400) {
        if (!tooFast) {
          const steps = Math.ceil(d / 4);
          const heading = [p[0] - lastP[0], (p[1] - lastP[1]) * Math.cos(p[0] * Math.PI / 180)];
          for (let i = 1; i <= steps; i++) paintAround(PM.geo.lerp(lastP, p, i / steps), heading);
          // distancia caminada: se cuenta de "ancla" en "ancla" (cada >= 10 m) para no sumar el zigzag del ruido GPS
          if (!walkAnchor) walkAnchor = lastP.slice();
          const wa = PM.geo.dist(walkAnchor, p);
          if (wa >= 10 || mode === 'sim') { G.addWalk(wa); session.st.walked += wa; walkAnchor = p.slice(); }
          const tr = session.track || (session.track = []), lt = tr[tr.length - 1];
          if (!lt || PM.geo.dist(lt, p) >= 8) tr.push(trackPt(p, now));
        }
      }
    } else {
      paintAround(p);
    }
    if (lastP && !isTeleport) updateHeading(lastP, p);
    lastP = p.slice(); lastT = now;
    S().lastPos = p.slice();
    PM.state.save();

    if (painting) checkLandmarksAndCans(p, visible, now);
    const tk = W.tileKeyOf(p[0], p[1]);
    if (tk !== curTile) { curTile = tk; W.ensureAround(p[0], p[1]); }
    if (visible) updateSpeedBadge();
  }

  // punto del recorrido: [lat, lon, segundos desde el inicio del paseo, altitud del GPS] (para las estadísticas tipo Strava)
  let lastAlt = null;
  const trackPt = (p, t) => { const q = [+p[0].toFixed(6), +p[1].toFixed(6), Math.round(((t || Date.now()) - session.start) / 1000)]; if (lastAlt != null) q.push(Math.round(lastAlt * 10) / 10); return q; };
  // lecturas con poca precisión (bolsillo, poca cobertura): no pintan solas, pero guían la ruta del hueco
  let softFixes = [], lastFixT = 0;
  function routeVia(a, b, via) {
    const pts = [a];
    for (const q of via) if (PM.geo.dist(pts[pts.length - 1], q) > 35 && PM.geo.dist(q, b) > 35) pts.push(q);
    if (pts.length < 2) return null;
    pts.push(b);
    let len = 0; const pieces = [], path = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const dl = PM.geo.dist(pts[i], pts[i + 1]);
      const r = W.route(pts[i], pts[i + 1], Math.max(dl * 2.2, dl + 200));
      if (!r) return null;
      len += r.len; pieces.push(...r.pieces); path.push(...(r.path || []));
    }
    return { len, pieces, path, via: true };
  }

  function nearestLandmark(p) {
    let best = null, bd = Infinity;
    for (const id in W.landmarks) {
      const d = PM.geo.dist(p, W.landmarks[id].pos);
      if (d < bd) { bd = d; best = W.landmarks[id]; }
    }
    return { lm: best, d: bd };
  }

  let nearCache = { t: 0, v: { lm: null, d: Infinity } };
  // Solo se pinta la geometría real de la calle (tramos de OSM), nunca el rastro del GPS.
  // Para no "manchar" calles perpendiculares al cruzarlas, un tramo se pinta si:
  //  - estás casi encima (<= PAINT_CORE m), o
  //  - estás dentro del radio y caminas en la dirección de esa calle.
  function paintAround(p, heading) {
    const now = performance.now();
    if (now - nearCache.t > 500) nearCache = { t: now, v: nearestLandmark(p) };
    const aura = nearCache.v.d <= AURA_RADIUS;
    const hl = heading ? Math.hypot(heading[0], heading[1]) : 0;
    for (const piece of W.piecesNear(p, WIDE_RADIUS)) {
      const done = S().painted[piece.id];
      const dist = PM.geo.distToPolyline(p, piece.pts);
      if (dist > (piece.wide ? WIDE_RADIUS : PAINT_RADIUS)) continue;
      // Sin dirección conocida (parado, primera lectura): solo lo que pisas. Con dirección: solo tramos
      // que van en tu misma dirección (al pasar por un cruce no se pinta el arranque de la calle lateral).
      let ok = !hl && dist <= PAINT_CORE;
      if (hl) {
        const a = piece.pts[0], b = piece.pts[piece.pts.length - 1];
        const v = [b[0] - a[0], (b[1] - a[1]) * Math.cos(a[0] * Math.PI / 180)];
        const vl = Math.hypot(v[0], v[1]);
        // lejos (otra calzada de una avenida) se exige ir casi paralelo: < ~30°; cerca basta < ~53°
        ok = vl > 0 && Math.abs((v[0] * heading[0] + v[1] * heading[1]) / (vl * hl)) >= (dist > PAINT_RADIUS ? 0.85 : 0.6);
      }
      if (ok) { if (done) G.repass(piece); else G.paintPiece(piece, aura); }
    }
  }

  // Radar: el monumento sin capturar y el bote más cercanos, con distancia y flecha (anima a desviarse un poco)
  function bearingTo(a, b) {
    const dx = (b[1] - a[1]) * PM.geo.mPerDegLon(a[0]), dy = (b[0] - a[0]) * PM.geo.mPerDegLat;
    return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
  }
  function updateRadar() {
    if (document.hidden || !session) { $('#radar').classList.remove('show'); return; }
    let lm = null, lmD = Infinity, can = null, canD = Infinity;
    for (const id in W.landmarks) {
      if (S().landmarks[id] || W.isAvoided(W.landmarks[id].pos)) continue;
      const d = PM.geo.dist(pos, W.landmarks[id].pos);
      if (d < lmD) { lmD = d; lm = W.landmarks[id]; }
    }
    for (const id in canMarkers) {
      const c = W.cans[id];
      if (!c || S().cansTaken[id]) continue;
      const d = PM.geo.dist(pos, c.pos);
      if (d < canD) { canD = d; can = c; }
    }
    const arrow = (t) => `<i class="rarrow" style="transform:rotate(${bearingTo(pos, t) + map.getBearing()}deg)">➤</i>`;
    const parts = [];
    if (lm && lmD < 1500) parts.push(`${lm.emoji} ${PM.fmtDist(lmD)} ${arrow(lm.pos)}`);
    $('#radar').innerHTML = parts.length ? '🎯 ' + parts.join(' · ') : '';
    $('#radar').classList.toggle('show', parts.length > 0);
  }
  setInterval(updateRadar, 1000);

  // Captura por permanencia: CAPTURE_SECONDS seguidos a menos de CAPTURE_RADIUS del monumento.
  // t = hora real de la lectura GPS (con la pantalla bloqueada las lecturas llegan luego, en lote).
  let dwell = null;   // { lm, since }
  const canCapture = (lm) => { const r = S().landmarks[lm.id]; return !r || Date.now() - r.last > 3600000; };
  function checkDwell(p, t, visible) {
    if (!session || session.paused) { dwell = null; showDwell(); return; }
    if (dwell) {
      if (PM.geo.dist(p, dwell.lm.pos) > (dwell.lm.capR || CAPTURE_RADIUS) + (CAPTURE_EXIT - CAPTURE_RADIUS) || !canCapture(dwell.lm)) {
        if (visible && canCapture(dwell.lm)) toast(`📸 Te has alejado de ${dwell.lm.emoji} ${dwell.lm.name}: captura cancelada`, 'warn', 2500);
        dwell = null;
      } else if (t - dwell.since >= CAPTURE_SECONDS * 1000) {
        const lm = dwell.lm; dwell = null;
        G.visitLandmark(lm);
      }
    }
    if (!dwell) {
      let best = null, bd = 1;   // distancia relativa a su radio de captura (los estadios tienen más)
      for (const id in W.landmarks) {
        const lm = W.landmarks[id], d = PM.geo.dist(p, lm.pos) / (lm.capR || CAPTURE_RADIUS);
        if (d <= bd && canCapture(lm)) { bd = d; best = lm; }
      }
      if (best) {
        dwell = { lm: best, since: t };
        if (visible) { toast(`📸 Quédate ${CAPTURE_SECONDS} s junto a ${best.emoji} <b>${best.name}</b> para capturarlo`, 'info', 3000); PM.vibrate(30); }
      }
    }
    if (visible) showDwell(t);
  }
  function showDwell(t) {
    const el = $('#capture');
    if (!dwell) { el.classList.remove('show'); return; }
    const left = Math.max(0, CAPTURE_SECONDS - Math.floor(((t || Date.now()) - dwell.since) / 1000));
    const pct = Math.min(100, (((t || Date.now()) - dwell.since) / (CAPTURE_SECONDS * 1000)) * 100);
    el.innerHTML = `📸 Capturando ${dwell.lm.emoji} ${dwell.lm.name}… <b>${left} s</b><span class="cbar"><i style="width:${pct}%"></i></span>`;
    el.classList.add('show');
  }
  // quieto junto al monumento no llegan lecturas nuevas del GPS: se comprueba cada segundo con la última posición
  setInterval(() => { if (session && !session.paused && !document.hidden) checkDwell(pos, Date.now(), true); }, 1000);

  function checkLandmarksAndCans(p, visible = true, t = Date.now()) {
    const n = nearestLandmark(p);
    nearCache = { t: performance.now(), v: n };
    if (visible) auraCircle.setLatLng(p);
    auraCircle.setStyle({ opacity: n.d <= AURA_RADIUS ? 0.8 : 0 });
    $('#aura').classList.toggle('show', n.d <= AURA_RADIUS);
    if (n.lm && n.d <= AURA_RADIUS) $('#aura').textContent = `✨ Aura de ${n.lm.kind.toLowerCase()} · pintura x2`;
    checkDwell(p, t, visible);
    for (const id in canMarkers) {
      const c = W.cans[id];
      if (c && !S().cansTaken[id] && PM.geo.dist(p, c.pos) <= CAN_RADIUS) G.takeCan(c);
    }
  }

  // Ritmos: todos pintan igual (de paseo lento a correr rápido). Solo por encima de MAX_SPEED (vehículo) no se pinta.
  const PACES = [
    { key: '1', v: 0.85, max: 3.5, icon: '🐢', name: 'paseo lento' },
    { key: '2', v: 1.4, max: 5.8, icon: '🚶', name: 'andando' },
    { key: '3', v: 1.9, max: 7.5, icon: '🚶‍♂️💨', name: 'andando rápido' },
    { key: '4', v: 2.8, max: 12, icon: '🏃', name: 'trotando' },
    { key: '5', v: 4.4, max: MAX_SPEED * 3.6, icon: '🏃💨', name: 'corriendo rápido' },
  ];
  let pace = 1;

  // --- Simulación: teclado, joystick, click para caminar ---
  const keys = {};
  let joy = { x: 0, y: 0 };
  let target = null;
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    keys[e.key.toLowerCase()] = true;
    if (e.key.toLowerCase() === 'g') { turbo = !turbo; toast(turbo ? '🚀 TURBO DEV activado (25 m/s)' : '🚶 Turbo desactivado', 'info'); }
    if (e.key.toLowerCase() === 'c') recenter();
    const pi = PACES.findIndex((p) => p.key === e.key);
    if (pi >= 0) { pace = pi; turbo = false; toast(`${PACES[pi].icon} Ritmo: ${PACES[pi].name} (${(PACES[pi].v * 3.6).toFixed(1)} km/h)`, 'info', 1800); }
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(e.key.toLowerCase())) e.preventDefault();
    if (mode === 'sim') target = null;
  });
  window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

  map.on('click', (e) => {
    if (avoidEdit) { askAvoid([e.latlng.lat, e.latlng.lng]); return; }
    if (mode !== 'sim') return;
    const p = [e.latlng.lat, e.latlng.lng];
    if (e.originalEvent.ctrlKey || e.originalEvent.metaKey) { teleport(p); return; }
    target = p;
    follow = true;
  });
  map.on('dragstart', () => { follow = false; $('#btn-center').classList.add('show'); clearTimeout(recenterTimer); });
  map.on('dragend', () => { clearTimeout(recenterTimer); recenterTimer = setTimeout(recenter, 8000); });
  map.on('zoomend', () => camera());
  window.addEventListener('resize', () => camera());

  // Joystick táctil (modo simulación en el móvil)
  (function joystick() {
    const base = $('#joy'), knob = $('#joy .knob');
    let active = false, cx = 0, cy = 0;
    const R = 45;
    const startJ = (x, y) => { active = true; const r = base.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; moveJ(x, y); };
    const moveJ = (x, y) => {
      if (!active) return;
      let dx = x - cx, dy = y - cy;
      const l = Math.hypot(dx, dy);
      if (l > R) { dx *= R / l; dy *= R / l; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      joy = { x: dx / R, y: -dy / R };
      target = null;
    };
    const endJ = () => { active = false; joy = { x: 0, y: 0 }; knob.style.transform = ''; };
    base.addEventListener('touchstart', (e) => { e.preventDefault(); startJ(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
    base.addEventListener('touchmove', (e) => { e.preventDefault(); moveJ(e.touches[0].clientX, e.touches[0].clientY); }, { passive: false });
    base.addEventListener('touchend', endJ);
    base.addEventListener('mousedown', (e) => { startJ(e.clientX, e.clientY); });
    window.addEventListener('mousemove', (e) => moveJ(e.clientX, e.clientY));
    window.addEventListener('mouseup', endJ);
  })();

  // ---------------- Orientación del mapa: norte fijo o girar hacia donde andas ----------------
  let orient = 'north';
  try { orient = localStorage.getItem('pintamapa_orient') || 'north'; } catch (e) {}
  let heading = 0;            // grados, 0 = norte, sentido horario (lo que se muestra, suavizado)
  let headingTarget = 0;      // hacia donde hay que girar
  let simTurned = false;      // en el simulador, el giro con A/D manda sobre el rumbo calculado
  let lastBearingT = 0, lastCourseT = 0;
  let compass = null;         // brújula del móvil (para cuando estás parado)
  const angDiff = (a, b) => ((b - a + 540) % 360) - 180;
  function setHeadingTarget(h) { headingTarget = (h + 360) % 360; }
  function onCompass(e) {
    let h = null;
    if (e.webkitCompassHeading != null) h = e.webkitCompassHeading;
    else if (e.absolute && e.alpha != null) h = (360 - e.alpha) % 360;
    if (h == null) return;
    compass = compass == null ? h : (compass + angDiff(compass, h) * 0.15 + 360) % 360;
    compassT = Date.now();
  }
  window.addEventListener('deviceorientationabsolute', onCompass);
  // En Android la web no recibe el norte: brújula nativa (sensor de rotación), solo en modo rumbo y con la app a la vista
  const CompassN = PM.isNative && window.Capacitor.registerPlugin ? window.Capacitor.registerPlugin('Compass') : null;
  let compassT = 0, compassOn = false, compassListen = false;
  function compassSync() {
    if (!CompassN) return;
    const want = orient === 'heading' && !document.hidden;
    if (want && !compassOn) {
      compassOn = true;
      if (!compassListen) {
        compassListen = true;
        CompassN.addListener('heading', (d) => {
          const h = d.heading;
          compass = compass == null ? h : (compass + angDiff(compass, h) * 0.35 + 360) % 360;
          compassT = Date.now();
        });
      }
      CompassN.start().catch(() => { compassOn = false; });
    } else if (!want && compassOn) { compassOn = false; CompassN.stop().catch(() => {}); }
  }
  document.addEventListener('visibilitychange', compassSync);
  window.addEventListener('deviceorientation', (e) => { if (e.webkitCompassHeading != null) onCompass(e); });
  // cada fotograma: girar poco a poco hacia el rumbo (sin saltos)
  function stepHeading(dt) {
    // brújula (hacia donde apunta el móvil) si la hay; si no, el rumbo del GPS / de la marcha
    const walkingNow = mode === 'gps' && speed > 0.6 && Date.now() - Math.max(lastMoveT, lastCourseT) < 6000;
    if (orient === 'heading' && compass != null && Date.now() - compassT < 1500 && !walkingNow && !(mode === 'sim' && (simTurned || target))) setHeadingTarget(compass);
    const d = angDiff(heading, headingTarget);
    if (Math.abs(d) < 0.3) return;
    heading = (heading + d * Math.min(1, dt * (mode === 'gps' ? 2.2 : 4)) + 360) % 360;
    applyBearing();
  }

  let lastMoveT = 0, headAnchor = null;
  // El rumbo se mide desde un punto de referencia que queda unos metros atrás (entre fotogramas o
  // lecturas seguidas apenas te mueves y el ángulo saldría con ruido o no se actualizaría nunca).
  function updateHeading(_a, b) {
    if (!headAnchor) { headAnchor = b.slice(); return; }
    const a = headAnchor;
    const d = PM.geo.dist(a, b);
    if (d > 60) { headAnchor = b.slice(); return; }       // salto (teletransporte, hueco): se reinicia
    if (d < (mode === 'gps' ? 12 : 4)) return;            // aún poco recorrido: se espera (con GPS, 12 m: menos tumbos)
    headAnchor = b.slice();
    if (simTurned && mode === 'sim' && orient === 'heading' && !target) return;
    const dx = (b[1] - a[1]) * PM.geo.mPerDegLon(a[0]), dy = (b[0] - a[0]) * PM.geo.mPerDegLat;
    const h = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
    lastMoveT = Date.now();
    if (mode === 'gps' && Date.now() - lastCourseT < 3000) return;   // ya hay rumbo del GPS, más fiable
    if (mode === 'gps' && !confirmTurn(h)) return;
    setHeadingTarget(h);
  }

  // un giro brusco (> 120°, "media vuelta") solo se acepta si la siguiente medida lo confirma: fuera tumbos por ruido
  let flipCand = null;
  function confirmTurn(h) {
    if (Math.abs(angDiff(headingTarget, h)) <= 120) { flipCand = null; return true; }
    if (flipCand != null && Math.abs(angDiff(flipCand, h)) < 45) { flipCand = null; return true; }
    flipCand = h; return false;
  }

  function applyBearing(force) {
    const now = performance.now();
    const want = orient === 'heading' ? -heading : 0;
    const cur = map.getBearing();
    const diff = Math.abs((((want - cur) % 360) + 540) % 360 - 180);
    // girar el mapa redibuja todas las calles: se limita a cambios de >3° y como mucho ~7 veces/seg
    if (force || (diff > 1.5 && now - lastBearingT > 90)) { map.setBearing(want); lastBearingT = now; camera(); }
    const el = document.querySelector('.player .arrow');
    if (el) el.style.transform = `rotate(${heading + map.getBearing()}deg)`;
  }

  function setOrient(o) {
    orient = o;
    try { localStorage.setItem('pintamapa_orient', o); } catch (e) {}
    simTurned = false;
    headingTarget = heading;
    compassSync();
    applyBearing(true);
    camera();
    $('#btn-orient').innerHTML = o === 'heading' ? '<span>➤</span><small>rumbo</small>' : '<span>N</span><small>norte</small>';
    $('#btn-orient').classList.toggle('on', o === 'heading');
  }
  $('#btn-orient').addEventListener('click', () => {
    setOrient(orient === 'heading' ? 'north' : 'heading');
    toast(orient === 'heading' ? '🧭 El mapa gira hacia donde andas' + (mode === 'sim' ? ' (A/D giran, W/S avanzan)' : '') : '🧭 Norte arriba (mapa fijo)', 'info');
  });

  // Gancho de pruebas (consola del navegador): PM.debug.walkTo([lat, lon]), PM.debug.setPace(0..4)
  PM.debug = { walkTo(p) { target = p; follow = true; }, setPace(i) { pace = i; turbo = false; }, get pos() { return pos.slice(); },
    get bearing() { return map.getBearing(); }, get heading() { return heading; },
    // avanza el juego n fotogramas a mano (pruebas con la pestaña oculta, donde el navegador congela la animación)
    frames(n, ms = 50) { let t = lastFrame; for (let i = 0; i < n; i++) { t += ms; loop(t, true); } } };

  let lastFrame = performance.now();
  function loop(now, manual) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    if (mode === 'sim') {
      let dx = 0, dy = 0;
      const fwd = (keys['arrowup'] || keys['w'] ? 1 : 0) - (keys['arrowdown'] || keys['s'] ? 1 : 0);
      const side = (keys['arrowright'] || keys['d'] ? 1 : 0) - (keys['arrowleft'] || keys['a'] ? 1 : 0);
      if (orient === 'heading') {
        if (side) { heading = (heading + side * 90 * dt + 360) % 360; headingTarget = heading; simTurned = true; applyBearing(); }
        const hr = heading * Math.PI / 180;
        dx = Math.sin(hr) * fwd; dy = Math.cos(hr) * fwd;
        // joystick: relativo a la pantalla (arriba = hacia delante)
        const br = -map.getBearing() * Math.PI / 180;
        const jx = joy.x * Math.cos(br) + joy.y * Math.sin(br), jy = -joy.x * Math.sin(br) + joy.y * Math.cos(br);
        dx = Math.sin(hr) * fwd + jx; dy = Math.cos(hr) * fwd + jy;
      } else {
        dx = side + joy.x; dy = fwd + joy.y;
      }
      if (target && !dx && !dy) {
        const d = PM.geo.dist(pos, target);
        if (d < 1) target = null;
        else {
          dx = (target[1] - pos[1]) * PM.geo.mPerDegLon(pos[0]) / d;
          dy = (target[0] - pos[0]) * PM.geo.mPerDegLat / d;
        }
      }
      const l = Math.hypot(dx, dy);
      if (l > 0.05) {
        if (l > 1) { dx /= l; dy /= l; }
        const v = turbo ? 25 : (keys['shift'] ? PACES[4].v : PACES[pace].v); // ritmo elegido / Shift = correr rápido / turbo dev
        pos = PM.geo.offset(pos, dx * v * dt, dy * v * dt);
        speed = v * Math.min(1, l);   // en simulación la velocidad es exacta
        onMove(pos);
      } else if (speed > 0) { speed = 0; updateSpeedBadge(); }
    }
    stepDisplay(now);
    stepHeading(dt);
    G.tickCombo(Date.now());
    flushPaint();
    if (!manual) requestAnimationFrame(loop);
  }

  // --- GPS real (con servicio en segundo plano en Android) ---
  // Ahorro de batería: el GPS solo está encendido durante una sesión activa (no en pausa),
  // el servicio nativo solo despierta cada DISTANCE_FILTER metros y con la app oculta no se redibuja nada.
  const DISTANCE_FILTER = 8;
  const BG = isNative && window.Capacitor.registerPlugin ? window.Capacitor.registerPlugin('BackgroundGeolocation') : null;
  let gpsWatch = null;

  function onFix(c, t) {
    if (mode !== 'gps' || !c) return;
    const acc = c.accuracy || 0;
    $('#gps').textContent = acc > 35 ? `📡 GPS impreciso (±${Math.round(acc)} m)` : `📡 GPS ±${Math.round(acc)} m`;
    $('#gps').classList.toggle('bad', acc > 35);
    lastFixT = Date.now();
    if (c.altitude != null && isFinite(c.altitude) && (c.altitudeAccuracy == null || c.altitudeAccuracy < 30)) lastAlt = c.altitude;
    if (acc > 35) {   // con mucho error podríamos pintar la calle de al lado: no pinta, pero sirve de guía para rellenar el hueco
      if (acc <= 120 && session && !session.paused) softFixes.push({ p: [c.latitude, c.longitude], t: t || c.time || Date.now() });
      if (softFixes.length > 60) softFixes.shift();
      return;
    }
    pos = [c.latitude, c.longitude];
    onMove(pos, false, t || c.time || Date.now(), c.speed, c.bearing != null ? c.bearing : c.heading);
  }

  async function startGPS() {
    stopGPS();
    try {
      if (BG) {
        const id = await BG.addWatcher({
          backgroundTitle: 'PintaMapa está pintando tus calles',
          backgroundMessage: 'Toca para volver al juego. Finaliza el paseo para apagar el GPS.',
          requestPermissions: true, stale: false, distanceFilter: DISTANCE_FILTER,
        }, (loc, err) => {
          if (err) {
            if (err.code === 'NOT_AUTHORIZED') toast('Necesito permiso de ubicación para pintar 📍', 'warn', 5000);
            return;
          }
          onFix(loc, loc.time);
        });
        gpsWatch = { bg: id };
      } else if (navigator.geolocation) {
        gpsWatch = { web: navigator.geolocation.watchPosition((p) => onFix(p.coords, p.timestamp),
          (e) => { toast('No se pudo obtener el GPS: ' + e.message, 'warn'); },
          { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }) };
      } else throw new Error('Este dispositivo no tiene GPS');
      $('#gps').textContent = '📡 Buscando GPS…';
    } catch (e) {
      toast('GPS: ' + (e.message || e) + ' — paso a modo simulación', 'warn');
      setMode('sim');
    }
  }
  function stopGPS() {
    if (!gpsWatch) return;
    if (gpsWatch.bg) BG.removeWatcher({ id: gpsWatch.bg });
    if (gpsWatch.web != null) navigator.geolocation.clearWatch(gpsWatch.web);
    gpsWatch = null;
    $('#gps').textContent = '📡 GPS apagado (ahorrando batería)';
    $('#gps').classList.remove('bad');
  }
  // Una sola lectura para situarte en el mapa sin dejar el GPS encendido
  function locateOnce() {
    const ok = (c) => { pos = [c.latitude, c.longitude]; teleport(pos); };
    if (isNative && window.Capacitor.Plugins.Geolocation) {
      const Geo = window.Capacitor.Plugins.Geolocation;
      Geo.requestPermissions().then(() => Geo.getCurrentPosition({ enableHighAccuracy: true, timeout: 20000 }))
        .then((p) => ok(p.coords)).catch(() => toast('No pude localizarte. ¿Tienes el GPS activado?', 'warn'));
    } else if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((p) => ok(p.coords), () => {}, { enableHighAccuracy: true, timeout: 20000 });
    }
  }
  const gpsWanted = () => mode === 'gps' && session && !session.paused;
  PM.walking = () => !!session && !session.paused;
  function syncGPS() { if (gpsWanted()) { if (!gpsWatch) startGPS(); } else stopGPS(); }

  function setMode(m) {
    mode = m;
    document.body.classList.toggle('sim', m === 'sim');
    $('#gps').classList.toggle('show', m === 'gps');
    lastP = null; speed = 0;
    if (m === 'gps') { if (!gpsWanted()) locateOnce(); syncGPS(); } else stopGPS();
    renderSimPanel();
  }

  // ---------------- Sesiones de paseo: empezar / pausar / reanudar / finalizar ----------------
  let session = S().session || null;   // sobrevive a cerrar la app
  if (session && !session.paused) {     // si la app se cerró en marcha, al reabrir queda en pausa
    session.elapsed += Math.max(0, (session.lastSeen || session.resumedAt) - session.resumedAt);
    session.paused = true;
  }
  const newSessionStats = () => ({ walked: 0, painted: 0, pts: 0, pieces: 0, captures: 0, cans: 0, bestCombo: 0, conquests: 0 });

  function sessionElapsed() {
    if (!session) return 0;
    return session.elapsed + (session.paused ? 0 : Date.now() - session.resumedAt);
  }
  function persistSession() { if (session) session.lastSeen = Date.now(); S().session = session; PM.state.save(); }

  function startSession() {
    session = { start: Date.now(), resumedAt: Date.now(), elapsed: 0, paused: false, st: newSessionStats(), track: [] };
    lastP = null; walkAnchor = null;
    persistSession(); syncGPS(); renderSession();
    PM.update.hold();
    PM.sound.pickup(); PM.vibrate(60);
    // la primera vez en el móvil: cómo evitar que Android frene el GPS con la pantalla apagada
    try {
      if (isNative && mode === 'gps' && !localStorage.getItem('pintamapa_bathint')) {
        localStorage.setItem('pintamapa_bathint', '1');
        openSheet('🔋 Para pintar con el móvil en el bolsillo', `
          <p>Algunos móviles frenan el GPS de las apps con la pantalla apagada para ahorrar batería, y entonces quedan tramos sin pintar. Revísalo una vez:</p>
          <ol class="keys" style="color:var(--text)">
            <li><b>Ajustes → Aplicaciones → PintaMapa → Batería</b> → <b>Sin restricciones</b> (o "No optimizar").</li>
            <li><b>Ubicación</b> → <b>Permitir siempre</b> y "Usar ubicación precisa".</li>
            <li>En Xiaomi/Huawei/Samsung: activa también <b>Inicio automático</b> y no la cierres desde "apps recientes".</li>
          </ol>
          <p class="muted">PintaMapa solo usa el GPS mientras hay un paseo activo: en pausa o al finalizar se apaga del todo.</p>`);
      }
    } catch (e) {}
    toast(mode === 'gps' ? '🖌️ ¡A pintar! Puedes bloquear el móvil: sigo pintando en segundo plano' : '🖌️ ¡A pintar! Muévete con WASD o haz clic en el mapa', 'info', 4500);
  }
  function pauseSession() {
    if (!session || session.paused) return;
    session.elapsed += Date.now() - session.resumedAt;
    session.paused = true;
    persistSession(); syncGPS(); renderSession();
    toast('⏸ En pausa: GPS apagado, no gasta batería', 'info');
  }
  function resumeSession() {
    if (!session || !session.paused) return;
    session.paused = false; session.resumedAt = Date.now();
    if (session.track && session.track.length) session.track.push(null);   // corte del recorrido (pausa)
    lastP = null; walkAnchor = null;   // no se pinta el "salto" desde donde pausaste
    persistSession(); syncGPS(); renderSession();
    PM.update.hold();
    toast('▶ ¡Seguimos pintando!', 'info');
  }
  function endSession() {
    if (!session) return;
    if (!session.paused) session.elapsed += Date.now() - session.resumedAt;
    const s = session; session = null;
    if (s.elapsed >= 120000) {   // los paseos de menos de 2 minutos no se guardan en el historial (lo pintado sí cuenta)
      S().walks.push({ id: String(s.start), start: s.start, elapsed: s.elapsed, st: s.st, track: s.track || [] });
    }
    persistSession(); syncGPS(); renderSession();
    showSummary(s);
    PM.sync.auto(toast);
    setTimeout(() => PM.update.check(false, toast), 5000);
  }

  function fmtTime(ms) {
    const t = Math.floor(ms / 1000), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
  }

  function renderSession() {
    const el = $('#session');
    document.body.classList.toggle('in-session', !!session);
    if (!session) {
      el.className = 'idle';
      el.innerHTML = '<button class="btn primary" id="s-start">▶ Empezar a pintar</button>';
      $('#s-start').addEventListener('click', startSession);
      return;
    }
    el.className = session.paused ? 'paused' : 'active';
    el.innerHTML = `<div class="sinfo"><b id="s-time"></b><small id="s-stats"></small></div>
      ${session.paused ? '<button class="btn sbtn go" id="s-resume" title="Reanudar">▶</button>' : '<button class="btn sbtn" id="s-pause" title="Pausar">⏸</button>'}
      <button class="btn sbtn stop" id="s-end" title="Finalizar">⏹</button>`;
    if (session.paused) $('#s-resume').addEventListener('click', resumeSession);
    else $('#s-pause').addEventListener('click', pauseSession);
    $('#s-end').addEventListener('click', () => { if (confirm('¿Finalizar el paseo? Se apagará el GPS.')) endSession(); });
    updateSessionInfo();
  }
  function updateSessionInfo() {
    if (!session || document.hidden) return;
    const t = $('#s-time'), st = $('#s-stats');
    if (!t) return;
    t.innerHTML = `${session.paused ? '⏸ En pausa ·' : '<i class="rec"></i>'} ${fmtTime(sessionElapsed())}`;
    st.textContent = `🚶 ${PM.fmtDist(session.st.walked)} · 🖌️ ${PM.fmtDist(session.st.painted)} · +${PM.fmtNum(session.st.pts)}`;
  }
  setInterval(updateSessionInfo, 1000);

  function showSummary(s) {
    const st = s.st, min = s.elapsed / 60000;
    const kmh = min > 0 ? (st.walked / 1000) / (min / 60) : 0;
    openSheet('🏁 Paseo terminado', `
      <p class="muted">${new Date(s.start).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })} · duración ${fmtTime(s.elapsed)}</p>
      <div class="stats">
        <div><b>${PM.fmtDist(st.walked)}</b><small>caminados</small></div>
        <div><b>${PM.fmtDist(st.painted)}</b><small>calles nuevas</small></div>
        <div><b>+${PM.fmtNum(st.pts)}</b><small>puntos</small></div>
        <div><b>${st.captures}</b><small>monumentos</small></div>
        <div><b>${PM.fmtDist(st.repassed || 0)}</b><small>repasados 🔥</small></div>
        <div><b>x${st.bestCombo}</b><small>mejor combo</small></div>
      </div>
      <p>${st.conquests ? `🚩 ¡Conquistaste ${st.conquests} barrio(s)! ` : ''}Velocidad media ${kmh.toFixed(1)} km/h.</p>
      <p class="muted">${st.painted > 0 ? '¡Buen paseo! Mañana tendrás misiones nuevas.' : 'Hoy no pintaste calles nuevas: prueba por calles que aún estén grises.'}</p>
      ${s.elapsed >= 120000 ? '<button class="btn on" id="sum-detail">📊 Estadísticas, vídeo y exportar</button>' : ''}`);
    if ($('#sum-detail')) $('#sum-detail').addEventListener('click', () => openWalk(S().walks.find((w) => w.id === String(s.start))));
    celebrate('¡Paseo completado!', `${PM.fmtDist(st.walked)} caminados · ${PM.fmtDist(st.painted)} pintados · +${PM.fmtNum(st.pts)} pts`, '🏁');
  }

  // Detalle de un paseo (estadísticas tipo Strava, vídeo y exportar GPX/KML/KMZ…)
  function openWalk(w) {
    if (!w) return;
    const geo = {};
    for (const id in S().painted) { const pc = W.pieces[id]; if (pc) geo[id] = pc.pts; }
    PM.replay.open(w, { geo, color: paintColor(), player: PM.player && PM.player.name });
  }
  function panelWalks() {
    const ws = (S().walks || []).slice().reverse();
    openSheet('🥾 Mis paseos', (ws.length ? ws.map((w, i) => `<div class="mission walk-row" data-i="${i}"><div class="mt">${new Date(w.start).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}<span>${PM.fmtDist(w.st.walked || 0)} ›</span></div>
      <small>⏱ ${fmtTime(w.elapsed)} · 🖌️ ${PM.fmtDist(w.st.painted || 0)} nuevas · +${PM.fmtNum(w.st.pts || 0)} pts${w.imported ? ' · ⌚ importado' : ''}</small></div>`).join('')
      : '<p class="muted">Aún no hay paseos de más de 2 minutos.</p>') +
      `<h4>⌚ Paseo grabado con un reloj</h4><p class="muted">¿Saliste solo con el reloj (Garmin, Apple Watch, Wear OS, Polar, Suunto…)? Exporta la actividad como <b>GPX</b> o <b>TCX</b> desde su app y súbela aquí: se pintan sus calles igual que andando con el móvil.</p>
      <button class="btn" id="imp-gpx">📂 Importar GPX / TCX</button><p class="muted" id="imp-msg"></p>`);
    document.querySelectorAll('.walk-row').forEach((el) => el.addEventListener('click', () => openWalk(ws[+el.dataset.i])));
    $('#imp-gpx').addEventListener('click', () => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.gpx,.tcx,application/gpx+xml,application/xml,text/xml';
      inp.onchange = () => inp.files[0] && importTrack(inp.files[0]);
      inp.click();
    });
  }
  // Importar un recorrido de reloj: lee los puntos (con hora y altitud), carga sus calles y las pinta siguiendo el trazado
  async function importTrack(file) {
    const msg = (t) => { const el = $('#imp-msg'); if (el) el.textContent = t; };
    try {
      const xml = new DOMParser().parseFromString(await file.text(), 'application/xml');
      let pts = [...xml.getElementsByTagName('trkpt')].map((n) => ({ lat: +n.getAttribute('lat'), lon: +n.getAttribute('lon'),
        t: Date.parse((n.getElementsByTagName('time')[0] || {}).textContent), e: parseFloat((n.getElementsByTagName('ele')[0] || {}).textContent) }));
      if (!pts.length) pts = [...xml.getElementsByTagName('Trackpoint')].map((n) => ({ lat: +((n.getElementsByTagName('LatitudeDegrees')[0] || {}).textContent), lon: +((n.getElementsByTagName('LongitudeDegrees')[0] || {}).textContent),
        t: Date.parse((n.getElementsByTagName('Time')[0] || {}).textContent), e: parseFloat((n.getElementsByTagName('AltitudeMeters')[0] || {}).textContent) }));
      pts = pts.filter((q) => isFinite(q.lat) && isFinite(q.lon) && (q.lat || q.lon));
      if (pts.length < 2) { msg('❌ No encuentro puntos de recorrido en el archivo.'); return; }
      const t0 = isFinite(pts[0].t) ? pts[0].t : Date.now(), t1 = isFinite(pts[pts.length - 1].t) ? pts[pts.length - 1].t : t0;
      if ((S().walks || []).some((w) => w.id === 'gpx' + t0)) { msg('Este recorrido ya estaba importado.'); return; }
      msg('⏳ Cargando las calles del recorrido…');
      const keys = [...new Set(pts.map((q) => W.tileKeyOf(q.lat, q.lon)))];
      for (let i = 0; i < keys.length; i++) {
        const [a, b] = keys[i].split('_').map(Number);
        msg(`⏳ Cargando calles (${i + 1}/${keys.length})…`);
        await W.ensureAround((a + 0.5) * W.TILE, (b + 0.5) * W.TILE);
      }
      msg('🖌️ Pintando…');
      const st = { walked: 0, painted: 0, pts: 0, pieces: 0, captures: 0, bestCombo: 0, conquests: 0, repassed: 0 };
      const before = { m: S().stats.paintedM, xp: S().xp };
      const track = [];
      for (let i = 0; i < pts.length; i++) {
        const q = [pts[i].lat, pts[i].lon];
        if (i) {
          const a = [pts[i - 1].lat, pts[i - 1].lon], d = PM.geo.dist(a, q);
          if (d < 400) { const n = Math.ceil(d / 4), hd = [q[0] - a[0], (q[1] - a[1]) * Math.cos(q[0] * Math.PI / 180)]; for (let k = 1; k <= n; k++) paintAround(PM.geo.lerp(a, q, k / n), hd); st.walked += d; }
        }
        if (!track.length || PM.geo.dist(track[track.length - 1], q) >= 8) {
          const p = [+q[0].toFixed(6), +q[1].toFixed(6), Math.round(((isFinite(pts[i].t) ? pts[i].t : t0) - t0) / 1000)];
          if (isFinite(pts[i].e)) p.push(Math.round(pts[i].e * 10) / 10);
          track.push(p);
        }
      }
      st.painted = S().stats.paintedM - before.m; st.pts = S().xp - before.xp;
      G.addWalk(st.walked);
      S().walks.push({ id: 'gpx' + t0, start: t0, elapsed: Math.max(120000, t1 - t0), st, track, imported: true });
      S().walks.sort((x, y) => x.start - y.start);
      PM.state.save(); flushPaint();
      msg(`✅ Importado: ${PM.fmtDist(st.walked)} recorridos · ${PM.fmtDist(st.painted)} de calles nuevas pintadas.`);
      PM.sync.auto();
    } catch (e) { msg('❌ No se pudo leer el archivo: ' + (e.message || e)); }
  }

  // Al volver de segundo plano: recolocar cámara y redibujar lo pintado mientras estaba oculta
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      showAt(pos, false);
      flushPaint(); updateSessionInfo();
      if (mode === 'gps') {
        if (gpsWanted()) { if (!gpsWatch || Date.now() - lastFixT > 20000) startGPS(); }   // el servicio pudo morir en el bolsillo
        else locateOnce();                                                               // sin paseo: una lectura para recolocarte
      }
      curTile = null; W.ensureAround(pos[0], pos[1]);
    }
  });

  function paceOf(kmh) {
    if (kmh < 0.8) return { icon: '🧍', name: 'parado' };
    for (const p of PACES) if (kmh <= p.max) return p;
    return PACES[PACES.length - 1];
  }
  function updateSpeedBadge() {
    const kmh = speed * 3.6;
    const el = $('#speed');
    const pc = paceOf(kmh);
    el.textContent = tooFast ? `🚗 ${kmh.toFixed(0)} km/h · ¡demasiado rápido, la pintura no se pega!`
      : (turbo && mode === 'sim' ? `🚀 TURBO ${kmh.toFixed(0)} km/h` : `${pc.icon} ${pc.name} · ${kmh.toFixed(1)} km/h`);
    el.classList.toggle('bad', tooFast);
  }

  // ---------------- HUD ----------------
  function updateHUD() {
    const lp = G.levelProgress();
    $('#lvl').textContent = lp.short; $('#lvl').title = 'Nivel ' + lp.label; $('#lvl').style.color = lp.tier ? lp.tier.color : '';
    $('#xpbar i').style.width = (lp.pct * 100).toFixed(1) + '%';
    $('#xptext').textContent = `${PM.fmtNum(S().xp)} pts · v${PM.VERSION.app}`;
    const t = W.tiles[curTile];
    const bq = t && (t.loaded || t.partial) ? W.barrioAt(pos) : null;
    const B = bq && W.barrios[bq.id];
    if (t && (t.loaded || t.partial)) {
      if (bq && bq.id !== curBarrio) { curBarrio = bq.id; W.ensureBarrio(bq.id); renderBarrios(); }
      const done = B && W.barrioComplete(bq.id);
      const pr = B ? G.barrioProgress(bq.id) : 0;
      $('#barrio-name').textContent = (bq && S().conqueredB[bq.id] ? '🚩 ' : '') + ((B && B.name) || (bq && bq.name) || t.name || 'Barrio sin explorar');
      const avoidedB = bq && S().avoid.some((z) => z.type === 'barrio' && z.id === bq.id);
      $('#barrio-pct').textContent = avoidedB ? '🚫 evitado' : !B ? '' : !done ? 'calculando…' : B.total ? (pr * 100).toFixed(1) + ' %' : 'sin calles';
      $('#barrio-bar i').style.width = (pr * 100).toFixed(1) + '%';
      if (t.city) {
        const cp = G.cityProgress(t.city);
        $('#city').textContent = `${S().citiesWon[t.city] ? '👑 ' : '🏙️ '}${t.city} · ${(cp.pct * 100).toFixed(cp.pct < 0.01 ? 2 : 1)} %` +
          (cp.real ? ` de ${PM.fmtDist(cp.total)} de calles` : ' (midiendo ciudad…)');
      } else $('#city').textContent = '🏙️ Localizando ciudad…';
    } else {
      $('#barrio-name').textContent = 'Cargando calles…';
      $('#barrio-pct').textContent = '';
      $('#barrio-bar i').style.width = '0%';
    }
    const c = G.combo;
    const cb = $('#combo');
    cb.classList.toggle('show', c >= 3);
    cb.innerHTML = `<b>x${G.comboMult().toFixed(2).replace(/\.?0+$/, '')}</b><span>COMBO ${c}</span>`;
    const gl = G.goldenLeft();
    $('#golden').classList.toggle('show', gl > 0);
    $('#golden').textContent = `✨ Pintura dorada x3 · ${Math.ceil(gl / 1000)} s`;
  }
  setInterval(updateHUD, 250);

  // ---------------- Notificaciones y efectos ----------------
  function toast(html, kind = 'ok', ms = 2600) {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.innerHTML = html;
    $('#toasts').appendChild(el);
    setTimeout(() => el.classList.add('out'), ms);
    setTimeout(() => el.remove(), ms + 400);
  }

  function floatText(txt, cls = '') {
    const pt = map.latLngToContainerPoint(pos);
    const el = document.createElement('div');
    el.className = 'float ' + cls;
    el.textContent = txt;
    el.style.left = pt.x + (Math.random() * 40 - 20) + 'px';
    el.style.top = pt.y - 30 + 'px';
    $('#fx').appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }

  function splat() {
    const pt = map.latLngToContainerPoint(pos);
    for (let i = 0; i < 5; i++) {
      const d = document.createElement('div');
      d.className = 'drop';
      const a = Math.random() * Math.PI * 2, r = 18 + Math.random() * 26;
      d.style.left = pt.x + 'px'; d.style.top = pt.y + 'px';
      d.style.setProperty('--dx', Math.cos(a) * r + 'px');
      d.style.setProperty('--dy', Math.sin(a) * r + 'px');
      $('#fx').appendChild(d);
      setTimeout(() => d.remove(), 600);
    }
  }

  function celebrate(title, sub, emoji) {
    const o = $('#celebrate');
    o.querySelector('.emoji').textContent = emoji;
    o.querySelector('h2').textContent = title;
    o.querySelector('p').textContent = sub;
    o.classList.add('show');
    confetti();
    PM.sound.fanfare();
    PM.vibrate([100, 60, 100, 60, 300]);
  }
  $('#celebrate').addEventListener('click', () => $('#celebrate').classList.remove('show'));

  function confetti() {
    const cv = $('#confetti'), ctx = cv.getContext('2d');
    cv.width = innerWidth; cv.height = innerHeight;
    const cols = [paintColor(), '#22d3ee', '#facc15', '#a3e635', '#ffffff', '#a855f7'];
    const parts = Array.from({ length: 160 }, () => ({
      x: innerWidth / 2, y: innerHeight / 2, vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 14 - 4,
      s: 4 + Math.random() * 6, c: cols[Math.floor(Math.random() * cols.length)], r: Math.random() * 6,
    }));
    let f = 0;
    (function frame() {
      ctx.clearRect(0, 0, cv.width, cv.height);
      parts.forEach((p) => {
        p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.r += 0.1;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
        ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6); ctx.restore();
      });
      if (f++ < 150) requestAnimationFrame(frame); else ctx.clearRect(0, 0, cv.width, cv.height);
    })();
  }

  // ---------------- Eventos del juego ----------------
  let splatThrottle = 0;
  G.on((ev, d) => {
    if (ev === 'xp' && session) { session.st.pts += d.n; persistSession(); }
    switch (ev) {
      case 'repass': {
        if ([2, 4, 7].includes(d.n)) rerenderTiles.add(d.piece.tile);   // cambia de intensidad: redibujar
        if (session) { session.st.repassed = (session.st.repassed || 0) + d.piece.len; }
        break;
      }
      case 'painted': {
        const tl = tileLayers[d.piece.tile];
        if (tl) { tl.paintedPts.push(d.piece.pts); tl.glowPts.push(d.piece.pts); dirtyTiles.add(d.piece.tile); }
        if (session) { session.st.painted += d.piece.len; session.st.pieces++; session.st.bestCombo = Math.max(session.st.bestCombo, d.combo); }
        const now = performance.now();
        if (!document.hidden && now - splatThrottle > 120) {
          splatThrottle = now;
          floatText('+' + Math.round(d.pts), d.golden ? 'gold' : d.aura ? 'aura' : '');
          splat();
          PM.sound.splat(d.combo);
        }
        if (d.combo === 10 || d.combo === 25 || d.combo === 50 || d.combo === 100) {
          toast(`🔥 ¡Combo x${d.combo}! Sigue pintando calles nuevas`, 'combo');
          PM.vibrate(40);
        }
        break;
      }
      case 'captured': {
        const lm = d.lm;
        if (session && d.first) session.st.captures++;
        placeLandmark(lm);
        if (d.first) {
          PM.cards.open(lm.id, { isNew: true, pts: d.pts });
          PM.sound.capture(); PM.vibrate([60, 40, 120]);
        } else toast(`${lm.emoji} Has vuelto a <b>${lm.name}</b> · +${d.pts}`, 'ok');
        break;
      }
      case 'can': {
        if (session) session.st.cans++;
        if (canMarkers[d.can.id]) { canMarkers[d.can.id].remove(); delete canMarkers[d.can.id]; }
        PM.sound.pickup(); PM.vibrate(50);
        toast(d.can.kind === 'gold' ? '✨ ¡Bote DORADO! Pintura x3 durante 60 s' : '🪣 ¡Bote de pintura! +50', d.can.kind === 'gold' ? 'gold' : 'ok');
        break;
      }
      case 'conquered':
        if (session) session.st.conquests++;
        refreshFlag(d.key);
        celebrate('¡Barrio conquistado!', `${d.name || 'Este barrio'} es tuyo: has pintado el 80 % de sus calles. +2000`, '🚩');
        break;
      case 'perfect':
        toast(`💯 ¡${d.name} pintado al 100 %! +1000`, 'gold', 4000);
        break;
      case 'cityWon':
        celebrate('¡CIUDAD CONQUISTADA!', `Has pintado el 80 % de las calles de ${d.city}. Eres leyenda. +25000`, '👑');
        break;
      case 'levelup':
        PM.sound.levelUp(); PM.vibrate([80, 40, 80]);
        toast(`${PM.levelName(d.level).tier ? PM.levelName(d.level).tier.icon : '⭐'} ¡Nivel ${PM.levelName(d.level).label}!` + (d.colors.length ? ` Nuevo color: <b style="color:${d.colors[0].c}">${d.colors[0].name}</b>` : ''), 'gold', 4000);
        break;
      case 'mission':
        toast(`🎯 Misión completada: ${d.m.text} · +${d.m.reward}`, 'gold', 3500);
        PM.sound.capture();
        break;
      case 'chest':
        celebrate('¡Cofre diario!', 'Has completado las 3 misiones de hoy. +1000. Mañana, más.', '🎁');
        break;
      case 'set':
        toast(`${d.set.icon} ¡Colección «${d.set.name}» ${['', '🥉 Bronce', '🥈 Plata', '🥇 Oro'][d.tier]}!`, 'gold', 4500);
        PM.sound.capture();
        break;
      case 'photo':
        toast(`📸 ¡Cromo con foto propia! +${d.bonus} pts`, 'gold', 3500);
        if (lmMarkers[d.id]) placeLandmark(W.landmarks[d.id] || Object.assign({ id: d.id }, S().landmarks[d.id]));
        break;
      case 'achievement':
        toast(`🏆 Logro: <b>${d.a.name}</b> — ${d.a.desc}`, 'gold', 4000);
        break;
    }
  });

  W.onChange((ev, d) => {
    if (ev === 'barrios') { renderBarrios(); return; }
    if (ev === 'loaded' || ev === 'partial') {
      d.tiles.forEach((k) => renderTile(k, true));
      renderLandmarks(); renderCans();
      if (ev === 'loaded') $('#loading').classList.remove('show');
      else $('#loading').textContent = '🗺️ Ya puedes pintar · completando el barrio…';
      if (lastP) paintAround(lastP);
    } else if (ev === 'loading') {
      $('#loading').textContent = d.quick ? '🗺️ Descargando las calles de tu alrededor…' : '🗺️ Descargando calles del barrio…';
      $('#loading').classList.add('show');
    } else if (ev === 'retry') {
      $('#loading').textContent = `📴 Sin respuesta de OpenStreetMap, reintento en ${d.inSec} s…`;
      $('#loading').classList.add('show');
    }
  });

  // ---------------- Paneles ----------------
  function openSheet(title, html) {
    $('#sheet h3').textContent = title;
    $('#sheet .body').innerHTML = html;
    $('#sheet').classList.add('show');
  }
  $('#sheet .close').addEventListener('click', () => $('#sheet').classList.remove('show'));

  function showCard(lm, pts) {
    const r = W.RARITY[lm.rarity];
    const o = $('#card');
    o.innerHTML = `<div class="cardin r-${lm.rarity}">
        <div class="rar" style="background:${r.color}">${r.label}</div>
        <div class="big">${lm.emoji}</div>
        <h2>${lm.name}</h2>
        <p>${lm.kind}</p>
        <div class="pts">+${pts} pts</div>
        <small>¡Nuevo sello en tu Álbum! Pintar a menos de ${AURA_RADIUS} m de aquí vale x2</small>
      </div>`;
    o.classList.add('show');
    setTimeout(() => o.classList.remove('show'), 4200);
  }
  $('#card').addEventListener('click', () => $('#card').classList.remove('show'));

  function showLandmarkInfo(lm) {
    const got = S().landmarks[lm.id];
    const r = W.RARITY[lm.rarity];
    const d = PM.geo.dist(pos, lm.pos);
    openSheet(lm.emoji + ' ' + (got ? lm.name : '???'), `
      <p><span class="pill" style="background:${r.color}">${r.label}</span> ${lm.kind} · ${lm.points} pts</p>
      <p>${got ? `Capturado el ${new Date(got.t).toLocaleDateString('es-ES')} · ${got.visits} visita(s)` :
        `Está a <b>${PM.fmtDist(d)}</b>. Acércate a menos de ${lm.capR || CAPTURE_RADIUS} m y quédate ${CAPTURE_SECONDS} s para capturarlo.`}</p>
      ${!got ? '<p class="muted">Pista: ' + lm.name.replace(/[^\s]/g, (ch, i) => (i % 3 === 0 ? ch : '•')) + '</p>' : ''}`);
  }

  function panelAlbum() {
    openSheet('🃏 Álbum de cromos', '<div id="album-box"></div>');
    PM.cards.album($('#album-box'));
  }
  function panelAlbumOld() {
    const s = S();
    const got = Object.entries(s.landmarks).sort((a, b) => b[1].t - a[1].t);
    const order = ['legendario', 'epico', 'raro', 'comun'];
    const near = Object.values(W.landmarks).filter((l) => !s.landmarks[l.id])
      .map((l) => ({ l, d: PM.geo.dist(pos, l.pos) })).sort((a, b) => a.d - b.d).slice(0, 12);
    let html = `<p class="muted">${got.length} sellos coleccionados. Como en una Pokédex: visita monumentos reales para llenarla.</p>`;
    for (const r of order) {
      const list = got.filter(([, v]) => v.rarity === r);
      if (!list.length) continue;
      html += `<h4 style="color:${W.RARITY[r].color}">${W.RARITY[r].label} (${list.length})</h4><div class="grid">`;
      html += list.map(([, v]) => `<div class="stamp r-${r}"><div>${v.emoji}</div><b>${v.name}</b><small>${v.kind}</small></div>`).join('');
      html += '</div>';
    }
    if (near.length) {
      html += '<h4>Por descubrir cerca de ti</h4><div class="grid">';
      html += near.map(({ l, d }) => `<div class="stamp unknown r-${l.rarity}"><div>${l.emoji}</div><b>???</b><small>${l.kind} · ${PM.fmtDist(d)}</small></div>`).join('');
      html += '</div>';
    }
    openSheet('📖 Álbum de monumentos', html);
  }

  function panelMissions() {
    const d = G.ensureDaily();
    const fmt = (m, v) => (m.type === 'paint' || m.type === 'walk' ? PM.fmtDist(v) : Math.round(v));
    let html = `<p class="muted">Se renuevan cada día a medianoche. Racha actual: <b>🔥 ${S().stats.streak} día(s)</b></p>`;
    html += d.missions.map((m) => `<div class="mission ${m.done ? 'done' : ''}">
        <div class="mt">${m.done ? '✅' : '🎯'} ${m.text}<span>+${m.reward}</span></div>
        <div class="bar"><i style="width:${(m.progress / m.goal * 100).toFixed(0)}%"></i></div>
        <small>${fmt(m, m.progress)} / ${fmt(m, m.goal)}</small></div>`).join('');
    html += `<div class="mission chest ${d.chest ? 'done' : ''}"><div class="mt">🎁 Cofre diario: completa las 3<span>+1000</span></div></div>`;
    openSheet('🎯 Misiones de hoy', html);
  }

  // Tocar el nivel: por qué tienes ese nivel, cuánto falta, de dónde vienen tus puntos y la escalera de rangos
  function panelLevel() {
    const s = S(), lp = G.levelProgress();
    const nf = PM.fmtNum;
    const from = PM.xpForLevel(lp.level), to = PM.xpForLevel(lp.level + 1);
    const LBL = { paint: '🖌️ Pintar calles nuevas', landmark: '📸 Capturar lugares', revisit: '🔁 Volver a lugares', conquest: '🚩 Conquistar barrios',
      perfect: '💯 Barrios al 100 %', city: '👑 Conquistar ciudades', mission: '🎯 Misiones diarias', chest: '🎁 Cofre diario', set: '🗂️ Colecciones',
      photo: '📷 Fotos de cromos', can: '🪣 Botes (antiguos)', otros: '✨ Otros' };
    const by = Object.assign({}, s.xpBy || {});
    const known = Object.values(by).reduce((a, b) => a + b, 0);
    if (s.xp - known > 0) by.antes = s.xp - known;   // puntos de antes de que se registrara el desglose
    LBL.antes = '🕰️ Antes de esta versión';
    const rows = Object.entries(by).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const ladder = [{ name: 'Niveles 1–99', icon: '⭐', from: 1 }, ...PM.LEVEL_TIERS.map((t, i) => ({ name: t.name + ' 1–100', icon: t.icon, from: 100 + i * 100, color: t.color }))];
    openSheet(`${lp.tier ? lp.tier.icon : '⭐'} Nivel ${lp.label}`, `
      <div class="lvl-big"><b style="${lp.tier ? 'color:' + lp.tier.color : ''}">${lp.short}</b><div><h2>Nivel ${lp.label}</h2><p class="muted">${nf(s.xp)} puntos en total</p></div></div>
      <div class="bar big"><i style="width:${(lp.pct * 100).toFixed(1)}%"></i></div>
      <p>${lp.max ? '🏆 ¡Has llegado al nivel máximo!' : `Te faltan <b>${nf(lp.need - lp.cur)} puntos</b> para el nivel <b>${lp.nextLabel}</b>.`}</p>
      <h4>¿Por qué este nivel?</h4>
      <p class="muted">Tu nivel depende solo de tus <b>puntos totales</b>. El nivel ${lp.label} empieza en ${nf(from)} puntos${lp.max ? '' : ` y el ${lp.nextLabel} en ${nf(to)}`}. Cada nivel pide algo más que el anterior.</p>
      <h4>De dónde vienen tus puntos</h4>
      ${rows.map(([k, v]) => `<div class="xprow"><span>${LBL[k] || k}</span><b>${nf(v)}</b><div class="bar"><i style="width:${(v / Math.max(1, s.xp) * 100).toFixed(1)}%"></i></div></div>`).join('') || '<p class="muted">Aún no tienes puntos: ¡sal a pintar!</p>'}
      <h4>Cómo ganar más puntos</h4>
      <ul class="xphow">
        <li>🖌️ <b>Pintar calle nueva</b>: 10 pts cada 12 m · el combo multiplica hasta ×3 · junto a un monumento ×2</li>
        <li>📸 <b>Capturar un lugar</b>: 100 (común) · 200 (raro) · 300 (épico) · 500 (legendario)</li>
        <li>🔁 <b>Volver a un lugar</b> (cada día): +20 % de sus puntos</li>
        <li>🚩 <b>Conquistar un barrio</b> (80 %): +2.000 · al 100 %: +1.000 más</li>
        <li>👑 <b>Conquistar una ciudad</b> (80 %): +25.000</li>
        <li>🎯 <b>Misiones del día</b> y 🎁 cofre al completarlas todas: +1.000</li>
        <li>🗂️ <b>Colecciones</b>: 300 · 1.000 · 3.000 · 📷 tu foto en un cromo</li>
      </ul>
      <h4>Escalera de niveles</h4>
      <div class="ladder">${ladder.map((r, i) => {
        const nextFrom = ladder[i + 1] ? ladder[i + 1].from : PM.LEVEL_MAX + 1;
        const here = lp.level >= r.from && lp.level < nextFrom, done = lp.level >= nextFrom;
        return `<div class="${here ? 'here' : done ? 'done' : ''}"><span style="${r.color ? 'color:' + r.color : ''}">${r.icon}</span><b>${r.name}</b><small>${done ? '✓' : here ? 'estás aquí' : 'desde ' + nf(PM.xpForLevel(r.from)) + ' pts'}</small></div>`;
      }).join('')}</div>`);
  }
  $('#hud .lvl').addEventListener('click', panelLevel);
  $('#hud .xp').addEventListener('click', panelLevel);

  function panelAchievements() {
    const s = S();
    const all = Object.entries(G.ACHIEVEMENTS);
    const n = all.filter(([id]) => s.achievements[id]).length;
    openSheet(`🏆 Logros ${n}/${all.length}`, '<div class="grid">' + all.map(([id, a]) =>
      `<div class="stamp ach ${s.achievements[id] ? '' : 'locked'}"><div>${s.achievements[id] ? a.icon : '🔒'}</div><b>${a.name}</b><small>${a.desc}</small></div>`).join('') + '</div>');
  }

  function panelProfile() {
    const s = S(), st = s.stats, lp = G.levelProgress();
    const cities = {};
    for (const k in s.tileNames) { const c = s.tileNames[k].city; if (c) cities[c] = true; }
    let html = `<div class="profile">
      <div class="avatar" style="background:${s.color}">🖌️</div>
      <div><h2>${PM.player ? PM.player.name : 'Pintor'} · nivel ${lp.label}${lp.tier ? ' ' + lp.tier.icon : ''}</h2><p>${PM.fmtNum(s.xp)} pts · ${lp.max ? '¡nivel máximo!' : `faltan ${PM.fmtNum(lp.need - lp.cur)} para el nivel ${lp.nextLabel}`}</p></div></div>
      <div class="stats">
        <div><b>${PM.fmtDist(st.paintedM)}</b><small>pintados</small></div>
        <div><b>${PM.fmtDist(st.walkedM)}</b><small>caminados</small></div>
        <div><b>${Object.keys(s.conqueredB || {}).length}</b><small>barrios 🚩</small></div>
        <div><b>${st.captures}</b><small>monumentos</small></div>
        <div><b>x${st.bestCombo}</b><small>mejor combo</small></div>
        <div><b>${Object.keys(s.heat || {}).length}</b><small>tramos habituales 🔥</small></div>
      </div>
      <h4>Color de tu pintura</h4><div class="colors">` +
      G.COLORS.map((c) => {
        const locked = lp.level < c.lvl;
        return `<button class="color ${s.color === c.c ? 'sel' : ''}" ${locked ? 'disabled' : ''} data-c="${c.c}" style="background:${c.c}" title="${c.name}">${locked ? '🔒' + c.lvl : ''}</button>`;
      }).join('') + '</div>';
    const cl = Object.keys(cities);
    if (cl.length) {
      html += '<h4>Tus ciudades</h4>' + cl.map((c) => {
        const cp = G.cityProgress(c);
        return `<div class="mission"><div class="mt">${s.citiesWon[c] ? '👑' : '🏙️'} ${c}<span>${(cp.pct * 100).toFixed(2)} %</span></div>
          <div class="bar"><i style="width:${Math.min(100, cp.pct / 0.8 * 100)}%"></i></div>
          <small>${PM.fmtDist(cp.painted)} de ${cp.total ? PM.fmtDist(cp.total) : '?'} · objetivo 80 %</small></div>`;
      }).join('');
    }
    if (PM.isNative && PM.profile === 'real') {
      const has = !!PM.cloud.password();
      html += `<h4>☁️ Mi cuenta en la nube</h4>
        <p class="muted">Tu progreso se guarda en la nube por Wi-Fi o datos, <b>cifrado con tu contraseña</b>: nadie más puede verlo. Con tu <b>nombre de pintor (${PM.player ? PM.player.name : ''}) y esta contraseña</b> lo ves en «Mi progreso» desde cualquier navegador:<br><b>luzferlux77.github.io/pintamapa-app/progreso.html</b></p>
        ${PM.cloud.hasKey() ? '' : '<p class="err">Esta versión no trae la clave de la nube: actualiza la app.</p>'}
        <input id="cl-pass" type="password" placeholder="${has ? 'Contraseña guardada ✓ (escribe otra para cambiarla)' : 'Inventa una contraseña de pintor (mín. 4)'}" autocomplete="new-password">
        <button class="btn on" id="cl-go">☁️ ${has ? 'Guardar en la nube ahora' : 'Activar y guardar'}</button>
        <p class="muted" id="cl-msg">${s.syncedAt ? 'Último guardado: ' + new Date(s.syncedAt).toLocaleString('es-ES') : 'Aún no guardado en la nube.'}
        ${Object.keys(s.pendingGeo || {}).length ? ' · ' + Object.keys(s.pendingGeo).length + ' tramos pendientes' : ''}</p>
        <p class="muted">⚠️ Apúntala: si la olvidas no se puede recuperar (por eso nadie más puede leer tu progreso). Si la cambias, empiezas una copia nueva en la nube con lo que tengas en el móvil.</p>`;
    } else if (!PM.isNative) {
      html += `<h4>📊 Tu progreso real</h4><p class="muted">Lo que pintas con el móvil por la calle (separado de esta partida de prueba). Se lee de la nube: no hace falta tener nada encendido.</p>
        <a class="btn on" href="progreso.html" target="_blank" style="display:inline-block;text-decoration:none">📊 Abrir «Mi progreso»</a>`;
    }
    if (s.avoid && s.avoid.length) {
      html += `<h4>🚫 Mis zonas a evitar</h4><p class="muted">Sus calles no cuentan para el %. Solo las ves tú.</p>` +
        s.avoid.map((z) => `<div class="mission"><div class="mt">🚫 ${z.type === 'barrio' ? z.name : 'Zona de ' + z.r + ' m'}<span><button class="btn av-rm" data-id="${z.id}">Quitar</button></span></div></div>`).join('');
    }
    html += `<p class="muted" style="margin-top:14px">Perfil actual: <b>${PM.profile === 'real' ? '📡 Real' : '🕹️ Prueba'}</b></p>`;
    html += `<h4>🥾 Mis paseos</h4><p class="muted">Estadísticas completas, vídeo del recorrido, exportar a GPX/KML/KMZ e importar desde un reloj.</p>
      <button class="btn" id="opt-walks">🥾 Ver mis paseos (${(s.walks || []).length})</button>`;
    html += `<h4>Ajustes</h4>
      <label class="row"><input type="checkbox" style="width:auto" id="opt-sound" ${PM.sound.enabled ? 'checked' : ''}> Sonido</label>
      <label class="row"><input type="checkbox" style="width:auto" id="opt-dark" ${s.theme === 'dark' ? 'checked' : ''}> Tema oscuro</label>
      <button class="btn danger" id="opt-reset">Borrar partida</button>
      <h4>🔄 Versión</h4>
      <p class="muted">PintaMapa <b>v${PM.VERSION.app}</b> · ${(PM.update.status() || {}).msg || 'Se busca actualización al abrir la app.'}</p>
      ${PM.isNative ? '<button class="btn" id="opt-upd">🔄 Buscar actualización ahora</button>' : ''}
      <p class="muted">Mapas y calles © OpenStreetMap</p>`;
    openSheet('👤 Perfil', html);
    document.querySelectorAll('.color:not([disabled])').forEach((b) => b.addEventListener('click', () => {
      s.color = b.dataset.c; PM.state.save(); recolorAll(); panelProfile();
    }));
    if ($('#cl-go')) $('#cl-go').addEventListener('click', async () => {
      const pw = $('#cl-pass').value;
      if (pw) { if (pw.length < 4) { $('#cl-msg').textContent = '❌ Mínimo 4 caracteres'; return; } PM.cloud.setPassword(pw); }
      if (!PM.cloud.password()) { $('#cl-pass').focus(); return; }
      $('#cl-msg').textContent = '⏳ Guardando en la nube…';
      try { await PM.cloud.now(); $('#cl-msg').textContent = '✅ ¡Guardado! Ya lo puedes ver en «Mi progreso» con tu pintor y contraseña.'; recolorAll(); }
      catch (e) { $('#cl-msg').textContent = '❌ ' + (e.message || e); }
    });
    document.querySelectorAll('.av-rm').forEach((b) => b.addEventListener('click', () => { removeAvoid(b.dataset.id); }));
    if ($('#opt-upd')) $('#opt-upd').addEventListener('click', async () => {
      $('#opt-upd').textContent = '⏳ Buscando…';
      await PM.update.check(true, toast);
      panelProfile();
    });
    $('#opt-sound').addEventListener('change', (e) => { PM.sound.enabled = e.target.checked; });
    $('#opt-dark').addEventListener('change', (e) => { s.theme = e.target.checked ? 'dark' : 'light'; PM.state.save(); applyTheme(); });
    $('#opt-walks').addEventListener('click', panelWalks);
    $('#opt-reset').addEventListener('click', () => { if (confirm('¿Seguro? Se perderá todo tu progreso.')) PM.state.reset(); });
  }

  function renderSimPanel() {
    if (PM.isNative) { $('#modebtn').style.display = 'none'; return; }   // móvil: solo real, sin selector de modo
    $('#modebtn').textContent = PM.isNative ? (PM.profile === 'real' ? '📡 Real' : '🕹️ Prueba')
      : (mode === 'sim' ? '🕹️ Prueba' : '📡 GPS (prueba)');
    $('#modebtn').classList.toggle('test', PM.profile === 'prueba');
  }
  function switchTo(p) {
    if (session && !confirm('Tienes un paseo en marcha en este perfil. Quedará en pausa. ¿Cambiar?')) return;
    if (session && !session.paused) pauseSession();
    stopGPS();
    PM.state.flush();
    PM.switchProfile(p);
  }
  function panelSim() {
    const html = `
      <div class="seg"><button class="btn ${mode === 'gps' ? 'on' : ''}" id="m-gps">📡 ${PM.isNative ? 'Real (GPS)' : 'GPS del PC'}</button>
      <button class="btn ${mode === 'sim' ? 'on' : ''}" id="m-sim">🕹️ Prueba</button></div>
      <p class="muted">${PM.isNative
        ? 'Son dos partidas separadas: <b>Real</b> es lo que pintas andando por la calle (se guarda en tu cuenta y se ve en tu PC). <b>Prueba</b> es para simular con el joystick sin tocar tu progreso real.'
        : 'En el PC siempre juegas en el perfil de <b>prueba</b>. Tu progreso real (el del móvil) lo ves en <a href="progreso.html" target="_blank">📊 Mi progreso</a>.'}</p>
      <h4>Teletransporte</h4>
      <select id="preset"><option value="">Elige una ciudad…</option>${PRESETS.map((p, i) => `<option value="${i}">${p.name}</option>`).join('')}</select>
      <div class="row"><input id="coords" placeholder="lat, lon (ej. 40.4168, -3.7038)"><button class="btn" id="go">Ir</button></div>
      <h4>Controles de simulación</h4>
      <ul class="keys">
        <li><kbd>W A S D</kbd> / <kbd>←↑↓→</kbd> caminar</li>
        <li><kbd>1</kbd>…<kbd>5</kbd> ritmo: 🐢 lento 3 · 🚶 andando 5 · 🚶‍♂️💨 rápido 6,8 · 🏃 trotando 10 · 🏃💨 corriendo 16 km/h</li>
        <li><kbd>Shift</kbd> mantener para correr rápido</li>
        <li><kbd>G</kbd> turbo dev (90 km/h, para probar)</li>
        <li><kbd>Clic</kbd> en el mapa: caminar hasta allí</li>
        <li><kbd>Ctrl + clic</kbd>: teletransporte</li>
        <li><kbd>C</kbd> centrar cámara</li>
        <li>Botón <b>N / ➤</b>: mapa con norte fijo o girando hacia donde andas (en modo giro: <kbd>A</kbd>/<kbd>D</kbd> giran)</li>
        <li>En el móvil: joystick abajo a la izquierda</li>
      </ul>
      <p class="muted">En modo GPS, si vas a más de 25 km/h la pintura no se pega: ¡hay que ir andando o corriendo!</p>`;
    openSheet('🕹️ Modo de juego', html);
    $('#m-gps').addEventListener('click', () => {
      if (PM.isNative) { if (PM.profile !== 'real') switchTo('real'); } else { setMode('gps'); panelSim(); }
    });
    $('#m-sim').addEventListener('click', () => {
      if (PM.isNative) { if (PM.profile !== 'prueba') switchTo('prueba'); } else { setMode('sim'); panelSim(); }
    });
    $('#preset').addEventListener('change', (e) => {
      const p = PRESETS[+e.target.value]; if (!p) return;
      W.setDemo(!!p.demo);
      if (PM.isNative && PM.profile === 'real') { toast('El teletransporte solo está en el perfil de Prueba 😉', 'warn'); return; }
      if (mode !== 'sim') setMode('sim');
      teleport(p.p); $('#sheet').classList.remove('show');
    });
    $('#go').addEventListener('click', () => {
      const m = $('#coords').value.split(',').map((x) => parseFloat(x));
      if (m.length === 2 && m.every(isFinite)) {
        W.setDemo(false);
        if (PM.isNative && PM.profile === 'real') { toast('El teletransporte solo está en el perfil de Prueba 😉', 'warn'); return; }
        if (mode !== 'sim') setMode('sim');
        teleport(m); $('#sheet').classList.remove('show');
      } else toast('Formato: lat, lon', 'warn');
    });
  }

  $('#nav-album').addEventListener('click', panelAlbum);
  $('#nav-missions').addEventListener('click', panelMissions);
  $('#nav-ach').addEventListener('click', panelAchievements);
  $('#nav-profile').addEventListener('click', panelProfile);
  $('#modebtn').addEventListener('click', panelSim);
  $('#btn-center').addEventListener('click', () => { if (map.getZoom() < 16) map.setZoom(16); recenter(); });

  // ---------------- Inicio ----------------
  // ---------------- ¿Quién pinta hoy? Botones de pintores + crear otro ----------------
  // Cada pintor tiene su partida; tocar su botón entra a jugar con ella.
  function playerCard(p) {
    let sv = {};
    try { sv = JSON.parse(localStorage.getItem('pintamapa_save_' + p.slug + '_' + PM.profile) || '{}'); } catch (e) {}
    let lvl = 1; const xp = sv.xp || 0;
    while (xp >= Math.round(400 * Math.pow(lvl, 1.6))) lvl++;
    const km = sv.stats ? PM.fmtDist(sv.stats.paintedM || 0) : '0 m';
    return `<button class="pcard ${PM.player && PM.player.slug === p.slug ? 'cur' : ''}" data-slug="${p.slug}">
      <span class="pav" style="background:${sv.color || '#ff2e88'}">${p.name.slice(0, 1).toUpperCase()}</span>
      <span class="pinfo"><b>${p.name}</b><small>nivel ${lvl} · ${km} pintados</small></span><span class="pgo">▶</span></button>`;
  }
  const players = PM.players();
  function nameValid() { return PM.slug($('#player-name').value).length >= 2; }
  function refreshStart() {
    $('#start').disabled = !nameValid();
    const typed = PM.slug($('#player-name').value);
    const exists = players.find((x) => x.slug === typed);
    $('#player-hint').textContent = exists ? `«${exists.name}» ya existe: entrarás con su partida.`
      : 'Tu nombre identifica tu partida (y tu cuenta al sincronizar con el PC).';
  }
  function showNewBox(open) {
    $('#new-box').hidden = !open;
    $('#new-player').hidden = open || !players.length;
    if (open) setTimeout(() => $('#player-name').focus(), 50);
  }
  $('#players').innerHTML = players.map(playerCard).join('');
  $('#who-title').textContent = players.length ? '¿Quién pinta hoy?' : '¿Cómo te llamas, pintor/a?';
  document.querySelectorAll('.pcard').forEach((b) => b.addEventListener('click', () => {
    const p = players.find((x) => x.slug === b.dataset.slug);
    if (PM.player && PM.player.slug === p.slug) begin(); else PM.setPlayer(p.name);
  }));
  $('#new-player').addEventListener('click', () => showNewBox(true));
  $('#player-name').addEventListener('input', refreshStart);
  $('#player-name').addEventListener('keydown', (e) => { if (e.key === 'Enter' && nameValid()) $('#start').click(); });
  showNewBox(!players.length);
  refreshStart();

  function begin(fromNew) {
    if (fromNew === true) {
      const name = $('#player-name').value.trim();
      if (!nameValid()) { $('#player-name').focus(); return; }
      if (!PM.player || PM.slug(name) !== PM.player.slug) { PM.setPlayer(name); return; }   // recarga con su partida
    }
    if (!PM.player) { showNewBox(true); return; }
    $('#intro').classList.remove('show');
    PM.sound._ctx();
    G.ensureDaily();
    recolorAll();
    W.setAvoid(S().avoid);
    teleport(pos);
    setMode(mode);
    setOrient(orient);
    renderSession();
    requestAnimationFrame(loop);
    PM.sync.auto();
    PM.update.watch(toast);
    // perfil real sin nube conectada: aviso claro (sin el token en el móvil, el PC no puede ver tu progreso)
    if (PM.isNative && PM.profile === 'real' && !PM.cloud.token()) {
      setTimeout(() => {
        const el = document.createElement('div');
        el.id = 'cloud-banner';
        el.innerHTML = `<span>☁️ <b>Conecta tu nube</b> para guardar tu progreso y verlo en el PC</span><button class="btn on">Conectar ahora</button><button class="x">✕</button>`;
        el.querySelector('.btn').addEventListener('click', () => { el.remove(); panelProfile(); setTimeout(() => { const t = $('#cl-pass'); if (t) { t.scrollIntoView({ block: 'center' }); t.focus(); } }, 350); });
        el.querySelector('.x').addEventListener('click', () => el.remove());
        document.body.appendChild(el);
      }, 2500);
    }
    setTimeout(() => toast(session ? '⏸ Tienes un paseo en pausa: pulsa ▶ para reanudar' :
      isNative ? '📡 Pulsa «Empezar a pintar» y sal a la calle' : '🕹️ Pulsa «Empezar a pintar» y muévete con WASD o clic', 'info', 4500), 600);
  }
  $('#start').addEventListener('click', () => begin(true));
  $('#intro-ver').textContent = `v${PM.VERSION.app} · datos © OpenStreetMap`;
  // versión bien visible (inicio y esquina del juego) para saber qué versión tienes instalada
  $('#intro-badge').innerHTML = `Versión <b>${PM.VERSION.app}</b> · ${new Date(PM.VERSION.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}` +
    (PM.isNative ? '' : ' · <i>web</i>');
  document.documentElement.style.setProperty('--paint', paintColor());
  $('#start').textContent = 'Crear y jugar';
  // recién elegido el nombre: se entra directamente sin volver a pulsar
  try { if (PM.player && sessionStorage.getItem('pintamapa_autostart')) { sessionStorage.removeItem('pintamapa_autostart'); begin(); } } catch (e) {}
})();
