// PintaMapa — mapa, movimiento (GPS o simulación), render e interfaz
(function () {
  const W = PM.world, G = PM.game, S = () => PM.state.data;
  const $ = (s) => document.querySelector(s);
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

  const PAINT_RADIUS = 14;      // m: margen para el error del GPS (calle por la que vas)
  const TRAIL_RADIUS = 20;      // m: en senderos (GPS peor entre árboles)
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

  // ---------------- Mapa (MapLibre: mapa vectorial con estilo propio, dibujado por la tarjeta gráfica) ----------------
  // Mapa base de OpenFreeMap (datos de OpenStreetMap, gratis y sin clave). Encima, capas propias: calles jugables,
  // lo pintado (con intensidad por pasadas), contornos de barrio, zonas evitadas y halos de conquista.
  const start = S().lastPos || HOME;
  const STYLE = PM.mapStyle.URL;
  const ll = (p) => [p[1], p[0]];   // el juego usa [lat, lon]; MapLibre, [lon, lat]
  let curStyle = S().theme === 'dark' ? 'dark' : 'light';
  const map = new maplibregl.Map({ container: 'map', style: PM.mapStyle.styleURL(curStyle), center: ll(start), zoom: 17, attributionControl: false,
    dragRotate: false, pitchWithRotate: false, touchPitch: false, maxPitch: 0, pitch: 0, fadeDuration: 0, renderWorldCopies: false,
    pixelRatio: Math.min(1.75, window.devicePixelRatio || 1) });   // a más de 2× no se nota y cuesta mucho al móvil
  // ¿el dedo está moviendo el mapa? (mientras, ni la brújula ni la cámara lo mueven: si no, se pelean y va a tirones)
  let userGesture = false, gestureEnd = 0;
  map.on('movestart', (e) => { if (e.originalEvent) userGesture = true; });
  map.on('moveend', (e) => { if (userGesture) { userGesture = false; gestureEnd = performance.now(); } });
  // dedos sobre el mapa: mientras haya alguno (sobre todo al hacer pinza) la cámara que te sigue NO toca el mapa;
  // si lo hiciera cortaría el gesto a medias y el zoom costaría mucho
  let touching = 0;
  const tcont = map.getCanvasContainer();
  tcont.addEventListener('touchstart', (e) => { touching = e.touches.length; }, { passive: true });
  const tEnd = (e) => { touching = e.touches.length; if (!touching) gestureEnd = performance.now(); };
  tcont.addEventListener('touchend', tEnd, { passive: true });
  tcont.addEventListener('touchcancel', tEnd, { passive: true });
  const gestureBusy = () => touching > 0 || userGesture || performance.now() - gestureEnd < 400;
  // edificios 3D solo con el mapa inclinado (modo rumbo): de frente no se ven y son lo más pesado de dibujar
  function set3D(on) {
    if (!mapReady) return;
    for (const l of map.getStyle().layers || []) if (l.type === 'fill-extrusion') map.setLayoutProperty(l.id, 'visibility', on ? 'visible' : 'none');
  }
  map.touchZoomRotate.disableRotation();
  // si el hueco del mapa cambia de tamaño (pantalla de inicio, giro, teclado…), el mapa se reajusta
  if (window.ResizeObserver) new ResizeObserver(() => { map.resize(); padCache.t = 0; }).observe(map.getContainer());
  // sin la «i» de créditos en el mapa (molestaba): los créditos de OpenStreetMap y OpenFreeMap están en la pantalla de inicio
  let mapReady = false;
  const FC = (features) => ({ type: 'FeatureCollection', features });
  const lineF = (pts, props) => ({ type: 'Feature', properties: props || {}, geometry: { type: 'LineString', coordinates: pts.map(ll) } });
  const multiF = (pieces, props) => pieces.length ? { type: 'Feature', properties: props || {}, geometry: { type: 'MultiLineString', coordinates: pieces.map((p) => p.pts.map(ll)) } } : null;
  const circlePoly = (c, r, props) => {
    const out = [];
    for (let i = 0; i <= 48; i++) { const a = i / 48 * 2 * Math.PI; out.push(ll(PM.geo.offset(c, Math.cos(a) * r, Math.sin(a) * r))); }
    return { type: 'Feature', properties: props || {}, geometry: { type: 'Polygon', coordinates: [out] } };
  };
  const SRC = ['pm-streets', 'pm-painted', 'pm-barrios', 'pm-halos', 'pm-fx', 'pm-fxline', 'pm-lms'];
  let FUN = null;   // foto de perfil (js/fun.js)
  const srcData = {}; SRC.forEach((id) => (srcData[id] = FC([])));
  function setSrc(id, fc) { srcData[id] = fc; const src = mapReady && map.getSource(id); if (src) src.setData(fc); }
  // grosor según el zoom (las salidas pueden depender de datos: p. ej. la intensidad de la pasada)
  const zw = (a, b, c, f) => ['interpolate', ['exponential', 1.6], ['zoom'], 13, f ? ['*', a, f] : a, 17, f ? ['*', b, f] : b, 20, f ? ['*', c, f] : c];
  const paintExpr = () => ['match', ['get', 'h'], 1, heatColor(1), 2, heatColor(2), 3, heatColor(3), paintColor()];
  function addOverlay() {
    for (const id of SRC) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: srcData[id], tolerance: 0.25 });
    const firstSym = (map.getStyle().layers || []).find((l) => l.type === 'symbol');   // lo pintado, por debajo de los nombres de calle
    const add = (l, top) => { if (!map.getLayer(l.id)) map.addLayer(l, top ? undefined : firstSym && firstSym.id); };
    const round = { 'line-cap': 'round', 'line-join': 'round' };
    add({ id: 'pm-streets', type: 'line', source: 'pm-streets', filter: ['!=', ['get', 't'], 1], layout: round, paint: { 'line-color': '#9aa3b5', 'line-opacity': 0.38, 'line-width': zw(0.8, 2.4, 6) } });
    add({ id: 'pm-trails', type: 'line', source: 'pm-streets', filter: ['==', ['get', 't'], 1], paint: { 'line-color': '#9a8a66', 'line-opacity': 0.85, 'line-width': zw(0.8, 2.2, 4), 'line-dasharray': [1.5, 2] } });
    add({ id: 'pm-glow', type: 'line', source: 'pm-painted', layout: round, paint: { 'line-color': paintColor(), 'line-opacity': 0.22, 'line-width': zw(4, 14, 30), 'line-blur': zw(2, 6, 12) } });
    add({ id: 'pm-paint', type: 'line', source: 'pm-painted', layout: round, paint: { 'line-color': paintExpr(), 'line-width': zw(1.6, 5, 11, ['+', 1, ['*', 0.2, ['get', 'h']]]) } });
    // halo de los conquistados: simbólico (tamaño fijo en pantalla, no el radio real); solo mientras pintas.
    // Las ondas y el latido de los imprescindibles van aparte, con CSS (fxSync): así el mapa no se redibuja sin parar.
    const haloVis = { visibility: haloOn ? 'visible' : 'none' };
    add({ id: 'pm-halo-fill', type: 'circle', source: 'pm-halos', layout: haloVis, paint: { 'circle-radius': haloR(1), 'circle-color': haloCol(), 'circle-opacity': ['case', ['==', ['get', 'm'], 1], 0.16, 0.2],
      'circle-stroke-color': haloCol(), 'circle-stroke-width': 1.5, 'circle-stroke-opacity': 0.6, 'circle-pitch-alignment': 'map' } });
    add({ id: 'pm-barrio-cur', type: 'line', source: 'pm-barrios', filter: ['==', ['get', 'c'], 0], paint: { 'line-color': '#5b6478', 'line-opacity': 0.8, 'line-width': 2.5, 'line-dasharray': [3, 3] } }, true);
    // efecto de conquista (ola de color + contorno brillante)
    add({ id: 'pm-fx-fill', type: 'fill', source: 'pm-fx', paint: { 'fill-color': paintColor(), 'fill-opacity': ['get', 'o'] } });
    add({ id: 'pm-fx-line', type: 'line', source: 'pm-fxline', layout: round, paint: { 'line-color': paintColor(), 'line-width': ['get', 'w'], 'line-opacity': ['get', 'o'], 'line-blur': 1.5 } }, true);
    add({ id: 'pm-lms', type: 'symbol', source: 'pm-lms', layout: { 'icon-image': ['get', 'icon'], 'icon-allow-overlap': true, 'icon-ignore-placement': true,
      'symbol-sort-key': ['get', 'z'], 'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.55, 15, 0.85, 17, 1] } }, true);
    add({ id: 'pm-barrio-conq', type: 'line', source: 'pm-barrios', filter: ['==', ['get', 'c'], 1], layout: round,
      paint: { 'line-color': ['match', ['get', 'rk'], 1, PM.RANKS[1].color, 2, PM.RANKS[2].color, 3, PM.RANKS[3].color, PM.RANKS[0].color], 'line-opacity': 0.9,
        'line-width': ['+', ['case', ['==', ['get', 'cur'], 1], 3.5, 2.5], ['*', 0.8, ['get', 'rk']]] } }, true);
  }
  map.on('style.load', () => { mapReady = true; PM.mapStyle.enhance(map, curStyle); iconMade.clear(); addOverlay(); set3D(false); flushLandmarks(true); if (placesOff) setPlaces(true, true); });
  // marcador HTML (lugares, banderas, etiquetas)
  function htmlMarker(p, html, opts = {}) {
    const el = document.createElement('div');
    el.innerHTML = html;
    if (opts.onClick) el.addEventListener('click', (e) => { e.stopPropagation(); opts.onClick(); });
    if (opts.z) el.style.zIndex = opts.z;
    return new maplibregl.Marker({ element: el, anchor: opts.anchor || 'center' }).setLngLat(ll(p)).addTo(map);
  }

  function paintColor() { return S().color; }
  function applyTheme() {
    const dark = S().theme === 'dark';   // claro por defecto
    document.body.classList.toggle('dark', dark);
    document.querySelector('meta[name=theme-color]').setAttribute('content', dark ? '#0d0f17' : '#f4f6fb');
    const want = dark ? 'dark' : 'light';
    if (want !== curStyle) { curStyle = want; mapReady = false; map.setStyle(PM.mapStyle.styleURL(want), { diff: false }); }   // carga limpia: así salta 'style.load' y se vuelven a poner las capas
  }
  applyTheme();

  // Calles jugables y lo pintado: todo en dos capas (se reconstruyen como mucho cada 0,4 s mientras pintas)
  const rendered = new Set();
  let streetsDirty = false, paintedDirty = false, lastPaintFlush = 0;
  let paintedF = [], paintedAdd = false;   // lo pintado ya convertido (al pintar solo se añade el tramo nuevo)
  // solo se dibujan las zonas a menos de VIEW_R celdas (~3 km) de lo que estás mirando: aunque hayas viajado, el mapa no se carga
  const VIEW_R = 3;
  function nearView(key, r = VIEW_R) {
    const c = map.getCenter(), [i, j] = key.split('_').map(Number);
    return Math.abs(i - Math.floor(c.lat / W.TILE)) <= r && Math.abs(j - Math.floor(c.lng / W.TILE)) <= r;
  }
  // ---------------- Lo pintado y lo conquistado, visibles SIEMPRE y en cualquier lugar del mundo ----------------
  // La forma de cada calle que pintas y el contorno de cada barrio que conquistas se guardan aparte en el móvil
  // (base de datos ligera, ~40 bytes por tramo). Así el mapa los dibuja aunque esa zona no esté cargada en memoria:
  // puedes revisar todo lo tuyo desde cualquier sitio y con cualquier zoom, y las zonas lejanas se pueden
  // descargar de la memoria sin que desaparezca nada de lo que ves.
  const pgeo = new Map(), pgeoTile = new Map(), pgeoNew = new Set();   // id -> {k, p}; zona -> ids; zonas por guardar
  let bgeo = {};   // barrio conquistado -> { name, segs, pos }
  let pgeoTimer = null, harvested = {}, geoReady = false;
  const H_KEY = 'pintamapa_geo_h_' + (PM.player ? PM.player.slug : '') + '_' + PM.profile;   // (por pintor: cada uno recoge lo suyo)
  try { harvested = JSON.parse(localStorage.getItem(H_KEY) || '{}'); } catch (e) {}
  const idbReq = (r) => new Promise((ok, ko) => { r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
  let geoDbP = null;
  const geoDb = () => geoDbP || (geoDbP = new Promise((ok, ko) => {
    const r = indexedDB.open('pintamapa-geo', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('geo'); r.result.createObjectStore('meta'); };
    r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
  }));
  (async () => {
    try {
      const db = await geoDb(), st = db.transaction('geo').objectStore('geo');
      const [keys, vals] = await Promise.all([idbReq(st.getAllKeys()), idbReq(st.getAll())]);
      // (se mezcla con lo que se haya pintado mientras se leía: nada se pisa)
      keys.forEach((k, i) => { const set = pgeoTile.get(k) || new Set(); for (const [id, pts] of Object.entries(vals[i] || {})) { if (!pgeo.has(id)) pgeo.set(id, { k, p: pts }); set.add(id); } pgeoTile.set(k, set); });
      bgeo = Object.assign((await idbReq(db.transaction('meta').objectStore('meta').get('barrios'))) || {}, bgeo);
    } catch (e) { /* sin base de datos (navegador privado): se dibuja lo cargado, como antes */ }
    geoReady = true;
    if (Object.keys(bgeo).length) geoDb().then((db) => db.transaction('meta', 'readwrite').objectStore('meta').put(bgeo, 'barrios')).catch(() => {});
    paintedDirty = true; renderBarrios();
  })();
  function geoAdd(pc) {
    if (!pc || pgeo.has(pc.id)) return;
    pgeo.set(pc.id, { k: pc.tile, p: pc.pts.map((q) => [+q[0].toFixed(6), +q[1].toFixed(6)]) });
    (pgeoTile.get(pc.tile) || pgeoTile.set(pc.tile, new Set()).get(pc.tile)).add(pc.id);
    pgeoNew.add(pc.tile);
    clearTimeout(pgeoTimer); pgeoTimer = setTimeout(geoFlush, 3000);
  }
  async function geoFlush() {
    if (!pgeoNew.size) return;
    if (!geoReady) { pgeoTimer = setTimeout(geoFlush, 2000); return; }   // primero hay que leer lo guardado
    const tilesToWrite = [...pgeoNew]; pgeoNew.clear();
    try {
      const db = await geoDb(), st = db.transaction('geo', 'readwrite').objectStore('geo');
      for (const k of tilesToWrite) { const o = {}; for (const id of pgeoTile.get(k) || []) o[id] = pgeo.get(id).p; st.put(o, k); }
    } catch (e) { tilesToWrite.forEach((k) => pgeoNew.add(k)); }
  }
  // guarda la forma de lo pintado de unas zonas recién cargadas (y las da por «recogidas»)
  function geoHarvest(keys) {
    const painted = S().painted;
    for (const k of keys) {
      const t = W.tiles[k];
      if (!t || !t.loaded) continue;
      for (const pc of t.pieces) if (painted[pc.id]) geoAdd(pc);
      harvested[k] = 1;
    }
    try { localStorage.setItem(H_KEY, JSON.stringify(harvested)); } catch (e) {}
  }
  function bgeoSave(B) {   // contorno de un barrio conquistado (simplificado)
    const segs = (B.segs || []).map((sg) => PM.simplifyTrack(sg.map((q) => [q[0], q[1]]), 4).map((q) => [+q[0].toFixed(5), +q[1].toFixed(5)]));
    const cur = bgeo[B.id];
    if (cur && cur.segs.length === segs.length && cur.pos) return;
    bgeo[B.id] = { name: B.name, segs, pos: B.pos ? [+B.pos[0].toFixed(5), +B.pos[1].toFixed(5)] : null };
    if (geoReady) geoDb().then((db) => db.transaction('meta', 'readwrite').objectStore('meta').put(bgeo, 'barrios')).catch(() => {});
  }
  // zonas (celdas de 0,01°) que se ven ahora en el mapa (con un margen)
  function viewTiles() {
    const b = map.getBounds(), T = W.TILE;
    const s0 = Math.floor(b.getSouth() / T) - 1, n0 = Math.floor(b.getNorth() / T) + 1, w0 = Math.floor(b.getWest() / T) - 1, e0 = Math.floor(b.getEast() / T) + 1;
    const inView = (k) => { const [i, j] = k.split('_').map(Number); return i >= s0 && i <= n0 && j >= w0 && j <= e0; };
    const out = new Set();
    for (const k of pgeoTile.keys()) if (inView(k)) out.add(k);
    for (const k of rendered) out.add(k);
    for (const k in S().paintedByTile) if (inView(k)) out.add(k);
    return out;
  }

  const tileFeat = {};   // zona -> calles ya convertidas (al volver a dibujar no se rehacen)
  function renderTile(key) {
    const t = W.tiles[key];
    if (!t || !(t.loaded || t.partial) || !nearView(key)) return;
    delete tileFeat[key];
    rendered.add(key); streetsDirty = true; paintedDirty = true;
    refreshFlag(key);
  }
  // al terminar de mover el mapa: entran las zonas cercanas cargadas y salen las lejanas
  function refreshView() {
    let changed = false;
    for (const k of [...rendered]) if (!nearView(k, VIEW_R + 2)) { rendered.delete(k); delete tileFeat[k]; changed = true; }   // margen: no se rehace al cruzar un borde
    for (const k in W.tiles) if (!rendered.has(k) && (W.tiles[k].loaded || W.tiles[k].partial) && nearView(k)) { rendered.add(k); changed = true; }
    if (changed) streetsDirty = true;
    paintedDirty = true;   // lo pintado de lo que ahora miras (sale del almacén aunque no esté cargado)
  }
  map.on('moveend', () => { clearTimeout(viewTimer); viewTimer = setTimeout(refreshView, 250); });
  let viewTimer = null;
  function rebuildStreets() {
    const f = [];
    for (const k of rendered) {
      // una sola figura por zona (calles y senderos aparte), no una por tramo de 11 m: miles de objetos menos que
      // preparar y mandar al mapa cada vez que se carga una zona (se dibuja exactamente igual)
      if (!tileFeat[k]) {
        const pcs = W.tiles[k].pieces;
        tileFeat[k] = [multiF(pcs.filter((p) => !p.trail), null), multiF(pcs.filter((p) => p.trail), { t: 1 })].filter(Boolean);
      }
      for (const x of tileFeat[k]) f.push(x);
    }
    setSrc('pm-streets', FC(f));
  }
  function rebuildPainted() {
    const f = [], painted = S().painted, cos = [];
    for (const k of viewTiles()) {   // por zona, una figura por intensidad (0-3) en vez de una por tramo
      const by = [[], [], [], []], t = W.tiles[k], seen = new Set();
      if (t) for (const p of t.pieces) if (painted[p.id]) { by[heatLevel(p.id)].push(p.pts); seen.add(p.id); }
      const ids = pgeoTile.get(k);
      if (ids) for (const id of ids) if (painted[id] && !seen.has(id)) by[heatLevel(id)].push(pgeo.get(id).p);
      by.forEach((list, h) => { if (list.length) f.push({ type: 'Feature', properties: { h }, geometry: { type: 'MultiLineString', coordinates: list.map((pts) => pts.map(ll)) } }); });
    }
    paintedF = f;
    setSrc('pm-painted', FC(f));
  }


  // ---------- Barrios reales: contorno del barrio donde estás y de los conquistados, con bandera ----------
  let curBarrio = null;
  let flagTimer = null;
  function refreshFlag() { clearTimeout(flagTimer); flagTimer = setTimeout(renderBarrios, 120); }
  // (las «zonas a evitar» se retiraron: las que hubiera guardadas siguen en la partida, pero ya no se aplican)

  let flagMarkers = [];
  // ---------------- Rangos de barrio: bronce 60 % (conquista) · plata 80 % · oro 90 % · leyenda (100 % y todos sus lugares) ----------------
  const RANKS = PM.RANKS.map((r, i) => Object.assign({}, r, { min: [PM.RANK_MIN.barrio[0], PM.RANK_MIN.barrio[1], PM.RANK_MIN.barrio[2], 0.995][i], pts: [0, 1000, 1500, 3000][i] }));
  function rankOf(id) {
    const s = S(), r = (s.barrioRank || {})[id];
    if (r != null) return r;
    return (s.perfectB || {})[id] ? 2 : 0;   // partidas de antes: conquistado = bronce; al 100 % = oro (se recalcula al pasar por él)
  }
  let legendT = 0;
  function barrioPlacesDone(id) {   // ¿tienes todos los lugares de este barrio?
    const ids = Object.keys(W.landmarks).filter((k) => { const b = W.barrioAt(W.landmarks[k].pos); return b && b.id === id; });
    return ids.length > 0 && ids.every((k) => S().landmarks[k]);
  }
  function checkRank(id, pr, B) {
    const s = S();
    if (!s.conqueredB[id]) return;
    const cur = rankOf(id);
    let want = 0;
    for (let i = 1; i < 3; i++) if (pr >= RANKS[i].min) want = i;
    if (pr >= 0.995 && cur < 3 && Date.now() - legendT > 10000) { legendT = Date.now(); if (barrioPlacesDone(id)) want = 3; }
    if (want <= cur) { if ((s.barrioRank || {})[id] == null) { (s.barrioRank = s.barrioRank || {})[id] = cur; PM.state.save(); } return; }
    (s.barrioRank = s.barrioRank || {})[id] = want;
    const rt = (s.barrioRankT = s.barrioRankT || {})[id] = s.barrioRankT[id] || {}; for (let i = cur + 1; i <= want; i++) rt[i] = rt[i] || Date.now();
    const R = RANKS[want];
    if (R.pts) G.addXP(R.pts, 'rank');
    PM.state.save();
    renderBarrios();
    conquestFX(id);
    setTimeout(() => celebrate(`¡${B && B.name ? B.name : 'Barrio'}: rango ${R.name}!`, want === 3 ? `100 % pintado y todos sus lugares capturados. Eres leyenda del barrio. +${R.pts}` : `Has pintado el ${Math.round(R.min * 100)} % de sus calles. +${R.pts}`, R.ic), 1500);
    G.checkAchievements();
  }

  // ---------------- Animación de conquista: ola de tu color desde ti por el barrio, contorno que brilla y fuegos artificiales ----------------
  function conquestFX(id) {
    const B = W.barrios[id];
    if (!B || !mapReady) return;
    const c = disp || pos;
    let R = 400;
    if (B.bbox) { const [s_, w_, n_, e_] = B.bbox; R = Math.max(...[[s_, w_], [s_, e_], [n_, w_], [n_, e_]].map((q) => PM.geo.dist(c, q))) + 40; }
    R = Math.min(R, 2500);
    try { map.setPaintProperty('pm-fx-fill', 'fill-color', paintColor()); map.setPaintProperty('pm-fx-line', 'line-color', paintColor()); } catch (e) {}
    const segs = B.segs || [];
    const t0 = performance.now(), DUR = 2600;
    (function step(now) {
      const t = Math.min(1, (now - t0) / DUR);
      const e = 1 - Math.pow(1 - t, 3);
      const wave = [circlePoly(c, Math.max(5, R * e), { o: 0.42 * (1 - t) }), circlePoly(c, Math.max(4, R * e * 0.85), { o: 0.18 * (1 - t) })];
      setSrc('pm-fx', FC(t < 1 ? wave : []));
      const pulse = Math.sin(t * Math.PI * 3);
      setSrc('pm-fxline', FC(t < 1 ? segs.map((sg) => lineF(sg, { w: 3 + 9 * Math.abs(pulse), o: 0.9 * (1 - t * 0.6) })) : []));
      if (t < 1) requestAnimationFrame(step);
    })(t0);
    fireworks();
    PM.vibrate([80, 50, 80, 50, 200]);
  }
  function fireworks() {
    const cv = $('#confetti'), cx = cv.getContext('2d');
    cv.width = innerWidth; cv.height = innerHeight;
    const cols = [paintColor(), '#facc15', '#22d3ee', '#f472b6', '#a3e635', '#ffffff'];
    const rockets = [], sparks = [];
    for (let i = 0; i < 6; i++) rockets.push({ x: innerWidth * (0.15 + Math.random() * 0.7), y: innerHeight + 10, vy: -(9 + Math.random() * 4), at: innerHeight * (0.18 + Math.random() * 0.3), d: i * 12, c: cols[i % cols.length] });
    let f = 0;
    (function frame() {
      cx.clearRect(0, 0, cv.width, cv.height);
      for (const r of rockets) {
        if (r.done || f < r.d) continue;
        r.y += r.vy; r.vy *= 0.985;
        cx.fillStyle = '#fff'; cx.beginPath(); cx.arc(r.x, r.y, 2.5, 0, 7); cx.fill();
        if (r.y <= r.at) { r.done = true; for (let k = 0; k < 46; k++) { const a = k / 46 * Math.PI * 2, v = 2 + Math.random() * 4; sparks.push({ x: r.x, y: r.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, l: 1, c: r.c }); } }
      }
      for (const p of sparks) {
        p.vy += 0.06; p.x += p.vx; p.y += p.vy; p.vx *= 0.98; p.l -= 0.014;
        if (p.l <= 0) continue;
        cx.globalAlpha = Math.max(0, p.l); cx.fillStyle = p.c; cx.beginPath(); cx.arc(p.x, p.y, 2.6, 0, 7); cx.fill(); cx.globalAlpha = 1;
      }
      if (f++ < 200) requestAnimationFrame(frame); else cx.clearRect(0, 0, cv.width, cv.height);
    })();
  }

  function renderBarrios() {
    flagMarkers.forEach((m) => m.remove()); flagMarkers = [];
    const f = [];
    for (const B of Object.values(W.barrios)) {
      const conq = !!S().conqueredB[B.id], cur = B.id === curBarrio;
      if (conq) bgeoSave(B);
      if (B.segs && (cur || conq)) { const rk = conq ? rankOf(B.id) : 0; B.segs.forEach((sg) => f.push(lineF(sg, { c: conq ? 1 : 0, cur: cur ? 1 : 0, rk }))); }
      if (conq && B.pos) { const rk = rankOf(B.id); flagMarkers.push(htmlMarker(B.pos, `<div class="flag rk${rk}" title="${RANKS[rk].name}">${RANKS[rk].ic}</div>`, { anchor: 'bottom-left' })); }
    }
    // los conquistados que no están cargados ahora (lejos, en otra ciudad, en otro país): con su contorno guardado
    for (const [id, g] of Object.entries(bgeo)) {
      if (W.barrios[id] || !S().conqueredB[id]) continue;
      const rk = rankOf(id);
      g.segs.forEach((sg) => f.push(lineF(sg, { c: 1, cur: 0, rk })));
      if (g.pos) flagMarkers.push(htmlMarker(g.pos, `<div class="flag rk${rk}" title="${RANKS[rk].name}">${RANKS[rk].ic}</div>`, { anchor: 'bottom-left' }));
    }
    setSrc('pm-barrios', FC(f));
  }

  function flushPaint() {
    if (document.hidden) return;
    const now = performance.now();
    if (streetsDirty) { streetsDirty = false; rebuildStreets(); }
    if (paintedDirty && now - lastPaintFlush > 400) { paintedDirty = false; paintedAdd = false; lastPaintFlush = now; rebuildPainted(); }
    else if (paintedAdd && now - lastPaintFlush > 400) { paintedAdd = false; lastPaintFlush = now; setSrc('pm-painted', FC(paintedF)); }
  }
  // intensidad del trazo según las pasadas: 1 vez = normal · 2-3 · 4-6 · 7+ = tu ruta habitual
  function heatLevel(id) { const n = (S().heat || {})[id] || 1; return n >= 7 ? 3 : n >= 4 ? 2 : n >= 2 ? 1 : 0; }
  function heatColor(l) {
    const c = paintColor().replace('#', ''), k = [0, 0.2, 0.36, 0.5][l];
    const ch = (i) => Math.round(parseInt(c.substr(i, 2), 16) * (1 - k)).toString(16).padStart(2, '0');
    return c.length === 6 ? '#' + ch(0) + ch(2) + ch(4) : paintColor();
  }

  function recolorAll() {
    if (mapReady) {
      const c = paintColor();
      [['pm-glow', 'line-color', c], ['pm-paint', 'line-color', paintExpr()], ['pm-halo-fill', 'circle-color', haloCol()], ['pm-halo-fill', 'circle-stroke-color', haloCol()]]
        .forEach(([l, prop, v]) => map.getLayer(l) && map.setPaintProperty(l, prop, v));
    }
    renderBarrios();
    if (typeof flushLandmarks === 'function') flushLandmarks(true);   // los conquistados llevan tu color
    document.documentElement.style.setProperty('--paint', paintColor());
    document.documentElement.style.setProperty('--fxc', paintColor());
  }
  map.on('style.load', () => recolorAll());

  // Monumentos. Los conquistados (visitados) quedan para siempre en el mapa rellenos de tu color (los imprescindibles, de dorado).
  // Se dibujan como CAPA del mapa (iconos generados una vez y pintados por la tarjeta gráfica), no como cientos de
  // elementos sueltos que el móvil tendría que recolocar en cada fotograma al arrastrar: así el mapa va fluido.
  const lmHalos = {}, lmIndex = {};   // id -> { lm, got }
  const RCOL = { comun: '#9aa4b2', raro: '#3fa9ff', epico: '#b65cff', legendario: '#ffb700' };
  const iconMade = new Set();
  let iconPending = false, iconTimer = null;
  // cuando llegan las imágenes de los iconos, se redibujan los que salieron con el emoji del sistema
  function iconsReady() { if (!iconPending) return; clearTimeout(iconTimer); iconTimer = setTimeout(() => { iconPending = false; iconMade.forEach((k) => { try { map.removeImage(k); } catch (e) {} }); iconMade.clear(); flushLandmarks(true); }, 250); }
  function lmIcon(lm, got) {
    const must = !!(lm.must || (S().landmarks[lm.id] || {}).must);
    const key = 'pmi-' + (got ? 'g' + paintColor() : 'n') + '-' + lm.rarity + '-' + (lm.emoji || '') + (must ? '-m' : '');
    if (iconMade.has(key) && map.hasImage(key)) return key;
    const k = 2, size = (must ? 56 : 46) * k, cx = size / 2, r = (must ? 19 : 17) * k;
    const c = document.createElement('canvas'); c.width = size; c.height = size;
    const x = c.getContext('2d');
    // imprescindible: doble aro dorado con brillo
    if (must) {
      x.save(); x.shadowColor = 'rgba(250,204,21,.9)'; x.shadowBlur = 8 * k;
      x.beginPath(); x.arc(cx, cx, r + 6 * k, 0, 2 * Math.PI); x.fillStyle = '#facc15'; x.fill(); x.restore();
      x.beginPath(); x.arc(cx, cx, r + 3.4 * k, 0, 2 * Math.PI); x.fillStyle = '#b45309'; x.fill();
    }
    x.beginPath(); x.arc(cx, cx, r, 0, 2 * Math.PI);
    if (must && got) {   // imprescindible conquistado: relleno dorado (como los demás con tu color)
      const g = x.createRadialGradient(cx, cx - r * 0.3, r * 0.1, cx, cx, r);
      g.addColorStop(0, '#fff3b0'); g.addColorStop(0.55, '#fcd34d'); g.addColorStop(1, '#eab308');
      x.fillStyle = g;
    } else x.fillStyle = got ? paintColor() : '#ffffff';
    x.fill();
    x.lineWidth = 3 * k; x.strokeStyle = got ? '#ffffff' : (must ? '#fffbeb' : (RCOL[lm.rarity] || '#9aa4b2')); x.stroke();
    if (got && !must) { x.beginPath(); x.arc(cx, cx, r + 3 * k, 0, 2 * Math.PI); x.lineWidth = 2.5 * k; x.strokeStyle = paintColor(); x.stroke(); }
    x.textAlign = 'center'; x.textBaseline = 'middle';
    // iconos iguales en todos los móviles (Twemoji); mientras cargan, el emoji del sistema
    const emo = (e, px, ex, ey) => {
      const im = PM.emojiImg(e, iconsReady);
      if (im) x.drawImage(im, ex - px / 2, ey - px / 2, px, px);
      else { x.font = `${px}px "Noto Color Emoji","Apple Color Emoji","Segoe UI Emoji",sans-serif`; x.fillText(e, ex, ey + px * 0.05); iconPending = true; }
    };
    emo(lm.emoji || '📍', 19 * k, cx, cx);
    if (must) emo('⭐', 14 * k, 9 * k, 9 * k);
    try { if (map.hasImage(key)) map.removeImage(key); map.addImage(key, x.getImageData(0, 0, size, size), { pixelRatio: k }); iconMade.add(key); } catch (e) {}
    return key;
  }
  let lmDirty = false;
  function placeLandmark(lm) {
    const got = !!S().landmarks[lm.id], prev = lmIndex[lm.id];
    if (!prev || prev.got !== got) lmDirty = true;
    lmIndex[lm.id] = { lm, got };
    if (got && !lmHalos[lm.id]) {
      lmHalos[lm.id] = { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: ll(lm.pos) } };
      setSrc('pm-halos', FC(Object.values(lmHalos)));
    }
    const h = lmHalos[lm.id], m = !!(lm.must || (S().landmarks[lm.id] || {}).must) ? 1 : 0;
    if (h && h.properties.m !== m) { h.properties.m = m; setSrc('pm-halos', FC(Object.values(lmHalos))); }
  }
  // Halo simbólico de los conquistados: un círculo de tu color y ondas que salen de él, en bucle, SOLO mientras pintas.
  // Parado o sin pintar, el lugar se ve conquistado (relleno de color) pero sin halo.
  let haloOn = false;
  const haloCol = () => ['case', ['==', ['get', 'm'], 1], '#eab308', paintColor()];   // imprescindibles: dorado
  function haloR(k) { return ['interpolate', ['linear'], ['zoom'], 12, 6 * k, 15, 13 * k, 17, 20 * k, 19, 26 * k]; }
  function stepHalos() {
    const want = !!(session && !session.paused) && !placesOff && mapReady;
    if (want === haloOn) return;
    haloOn = want;
    if (map.getLayer('pm-halo-fill')) map.setLayoutProperty('pm-halo-fill', 'visibility', want ? 'visible' : 'none');
    fxSync();
  }
  // Latido de los imprescindibles sin conquistar (siempre) y ondas de los conquistados (pintando): marcadores con
  // animación CSS. Los anima la tarjeta gráfica sin tocar el mapa (antes, cambiar la capa 25 veces por segundo
  // obligaba a redibujarlo entero sin parar: más de la mitad del procesador y mucha batería).
  const fxMarks = new Map();
  let fxT = 0;
  function fxScale() {   // mismo tamaño que los iconos según el zoom
    const z = map.getZoom(), s = z <= 12 ? 0.55 : z <= 15 ? 0.55 + (z - 12) * 0.1 : z <= 17 ? 0.85 + (z - 15) * 0.075 : 1;
    map.getContainer().style.setProperty('--fxs', s.toFixed(3));
  }
  map.on('zoom', fxScale);
  function fxSync() {
    if (!mapReady) return;
    fxT = Date.now();
    const want = new Map();
    if (!placesOff) {
      const c = map.getCenter(), ctr = [c.lat, c.lng];
      for (const { lm, got } of Object.values(lmIndex)) {
        const must = !!(lm.must || (S().landmarks[lm.id] || {}).must);
        if (!got && must && PM.geo.dist(lm.pos, ctr) < 5000) want.set('m' + lm.id, [lm, 'fx-must']);
        else if (got && haloOn && PM.geo.dist(lm.pos, pos) < 1500) want.set('h' + lm.id, [lm, 'fx-halo' + (must ? ' gold' : '')]);
      }
    }
    for (const [k, mk] of fxMarks) if (!want.has(k) || mk._pmCls !== want.get(k)[1]) { mk.remove(); fxMarks.delete(k); }
    for (const [k, [lm, cls]] of want) {
      if (fxMarks.has(k)) continue;
      const el = document.createElement('div'); el.className = 'fxm ' + cls; el.innerHTML = '<i></i><i></i>';
      const mk = new maplibregl.Marker({ element: el }).setLngLat(ll(lm.pos)).addTo(map); mk._pmCls = cls;
      fxMarks.set(k, mk);
    }
    fxScale();
  }
  map.on('moveend', () => { if (Date.now() - fxT > 1500) fxSync(); });
  function flushLandmarks(force) {
    if (!(lmDirty || force) || !mapReady) return;
    lmDirty = false;
    setSrc('pm-lms', FC(Object.values(lmIndex).map(({ lm, got }) => ({ type: 'Feature',
      properties: { id: lm.id, icon: lmIcon(lm, got), z: (got ? 1 : 0) + (lm.must ? 2 : 0) }, geometry: { type: 'Point', coordinates: ll(lm.pos) } }))));
    fxSync();
  }
  function renderLandmarks() {
    for (const id in W.landmarks) {
      const rec = S().landmarks[id];
      if (rec && !rec.pos) { rec.pos = W.landmarks[id].pos; PM.state.save(); }
      placeLandmark(W.landmarks[id]);
    }
    if (W.updateMustSee()) lmDirty = true;   // imprescindibles de cada ciudad
    // conquistados guardados en tu partida (estén o no cargados ahora): siempre visibles
    for (const [id, rec] of Object.entries(S().landmarks)) if (!lmIndex[id] && rec.pos) placeLandmark(Object.assign({ id, points: 0 }, rec));
    flushLandmarks();
  }
  // tocar un lugar del mapa
  map.on('click', 'pm-lms', (e) => { const it = e.features && lmIndex[e.features[0].properties.id]; if (it) showLandmarkInfo(it.lm); });

  // Botes de pintura (ya no salen; se deja el hueco por compatibilidad)
  const canMarkers = {};
  function renderCans() {}

  // Jugador: punto con tu color, flecha de rumbo, anillo de pintura (alcance del pincel) y anillo dorado de captura
  let pos = start.slice();
  const playerEl = document.createElement('div');
  playerEl.innerHTML = '<div class="player"><div class="pring"></div><div class="aring"></div><div class="pulse"></div><div class="arrow"></div><div class="dot">🖌️</div></div>';
  const player = new maplibregl.Marker({ element: playerEl }).setLngLat(ll(pos)).addTo(map);
  const auraEl = playerEl.querySelector('.aring');
  function sizeRings() {
    const mpp = 40075016.686 * Math.cos(map.getCenter().lat * Math.PI / 180) / (512 * Math.pow(2, map.getZoom()));
    playerEl.style.setProperty('--pr', (PAINT_RADIUS * 2 / mpp).toFixed(1) + 'px');
    playerEl.style.setProperty('--ar', (CAPTURE_RADIUS * 2 / mpp).toFixed(1) + 'px');
  }
  map.on('zoom', sizeRings); sizeRings();

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
  // zona visible entre el panel de arriba y el de abajo (se recalcula como mucho 2 veces por segundo)
  let padCache = { t: 0, v: null };
  function viewPadding() {
    if (padCache.v && performance.now() - padCache.t < 500) return padCache.v;
    const r = map.getContainer().getBoundingClientRect();
    const top = Math.max(0, $('#hud').getBoundingClientRect().bottom - r.top);
    const sb = $('#session').getBoundingClientRect(), nb = $('#nav').getBoundingClientRect();
    const bottom = Math.max(0, r.bottom - Math.min(sb.height ? sb.top : r.bottom, nb.height ? nb.top : r.bottom));
    padCache = { t: performance.now(), v: r.height - top - bottom > 100 ? { top, bottom, left: 0, right: 0 } : { top: 0, bottom: 0, left: 0, right: 0 } };
    return padCache.v;
  }
  function camera() {
    if (!follow || !disp || document.hidden || gestureBusy()) return;
    map.jumpTo({ center: ll(disp), padding: viewPadding() });
  }
  function drawPlayer() { player.setLngLat(ll(disp)); camera(); }
  function showAt(p, smooth) {
    if (!disp || !smooth || PM.geo.dist(disp, p) > 300) { disp = p.slice(); anim = null; drawPlayer(); return; }
    anim = { from: disp.slice(), to: p.slice(), start: performance.now(), dur: 900 };
    wakeLoop();
  }
  function stepDisplay(now) {
    if (!anim) return;
    const t = Math.min(1, (now - anim.start) / anim.dur);
    disp = PM.geo.lerp(anim.from, anim.to, t);
    if (t >= 1) anim = null;
    drawPlayer();
  }
  function recenter() { clearTimeout(recenterTimer); follow = true; $('#btn-center').classList.remove('show'); zoomAround(); camera(); }
  // siguiéndote, la pinza y la rueda acercan/alejan alrededor de TI (centro), sin desplazar el mapa
  function zoomAround() {
    const o = follow ? { around: 'center' } : undefined;
    map.touchZoomRotate.enable(o); map.touchZoomRotate.disableRotation(); map.scrollZoom.enable(o);
  }
  zoomAround();

  function teleport(p) {
    pos = p.slice(); lastP = null; walkAnchor = null;
    map.jumpTo({ center: ll(pos), zoom: Math.max(16, map.getZoom() || 17), padding: viewPadding() }); follow = true;
    showAt(pos, false);
    onMove(pos, true);
  }

  // fixTime: hora real de la lectura GPS. Con la pantalla bloqueada Android entrega las posiciones
  // en lotes; medir la velocidad por la hora de llegada daría velocidades absurdas (falso "vas en coche").
  function onMove(p, isTeleport, fixTime, fixSpeed, fixBearing) {
    const now = fixTime || Date.now();
    const visible = !document.hidden;
    if (visible) showAt(p, mode === 'gps' && !isTeleport);
    if (visible && haloOn && Date.now() - fxT > 5000) fxSync();   // pintando: ondas en los conquistados que tienes cerca
    // rumbo que da el propio GPS (fiable al caminar): manda sobre el calculado
    // (un 0 exacto es «sin rumbo» en muchos móviles; y se alinea con la calle por la que vas)
    if (fixBearing != null && !isNaN(fixBearing) && fixBearing !== 0 && (fixSpeed || 0) > 0.9) { const h = alongStreet(p, fixBearing); if (confirmTurn(h)) { setHeadingTarget(h); lastCourseT = Date.now(); } }
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
          fillGap(r, lastP, p, lastT, now);
          paintAround(p, [p[0] - lastP[0], (p[1] - lastP[1]) * Math.cos(p[0] * Math.PI / 180)]);
          walkAnchor = p.slice();
        } else if (!r && d > 40) {
          // sin camino ahora: casi siempre porque aún no están cargadas las calles de la zona (p. ej. al reabrir la app
          // que Android cerró en el bolsillo). El hueco queda pendiente, se piden las calles que faltan y se rellena en
          // cuanto llegan (antes se pintaba en línea recta, atravesando manzanas: ese tramo se perdía)
          pendingGaps.push({ a: lastP.slice(), b: p.slice(), ta: lastT, tb: now, via, d, since: Date.now() }); walkAnchor = p.slice();   // (lo andado lo suma fillGap)
          loadAlong(lastP, p);
          routed = true;
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
    if (painting && !isTeleport) session.lastSeen = Date.now();   // si Android cierra la app, se sabe desde cuándo falta el recorrido
    PM.state.save();

    if (painting) checkLandmarksAndCans(p, visible, now);
    const tk = W.tileKeyOf(p[0], p[1]);
    if (tk !== curTile) { curTile = tk; W.ensureAround(p[0], p[1]); }
    if (visible) updateSpeedBadge();
  }

  // Rellena un hueco con el camino por las calles: pinta sus tramos, suma lo andado y lo guarda en el recorrido
  // (con la hora repartida a lo largo del hueco y en su sitio, aunque se rellene más tarde)
  function fillGap(r, a, b, ta, tb) {
    const aura = nearestLandmark(b).d <= AURA_RADIUS;
    for (const id of r.pieces) { const pc = W.pieces[id]; if (pc) { if (S().painted[pc.id]) G.repass(pc); else G.paintPiece(pc, aura); } }
    G.addWalk(r.len); session.st.walked += r.len;
    const tr = session.track || (session.track = []);
    const way = (r.path || []).concat([b]), pts = [];
    let acc = 0;
    for (let i = 0; i < way.length; i++) {
      if (i) acc += PM.geo.dist(way[i - 1], way[i]);
      const lt = pts[pts.length - 1] || tr[tr.length - 1];
      if (i < way.length - 1 && lt && PM.geo.dist(lt, way[i]) < 8) continue;
      pts.push(trackPt(way[i], ta + (tb - ta) * Math.min(1, acc / Math.max(1, r.len))));
    }
    let k = tr.length;
    const t0 = pts.length ? pts[0][2] : 0;
    while (k > 0 && tr[k - 1] && tr[k - 1][2] > t0) k--;
    tr.splice(k, 0, ...pts);
  }
  const streetsReady = (q) => { const t = W.tiles[W.tileKeyOf(q[0], q[1])]; return !!(t && t.loaded); };
  // carga las celdas de calles entre dos puntos (y las vecinas): el camino de un hueco puede pasar por ellas
  function loadAlong(a, b) {
    const keys = new Set(), n = Math.ceil(PM.geo.dist(a, b) / 300) + 1;
    for (let i = 0; i <= n; i++) {
      const q = PM.geo.lerp(a, b, i / n);
      for (const dy of [-0.006, 0, 0.006]) for (const dx of [-0.006, 0, 0.006]) keys.add(W.tileKeyOf(q[0] + dy, q[1] + dx));
    }
    const miss = [...keys].filter((k) => !(W.tiles[k] && W.tiles[k].loaded));
    if (miss.length && miss.length <= 40) W.ensureKeys(miss).then(retryGaps).catch(() => {});
    else setTimeout(retryGaps, 1500);
  }
  let pendingGaps = [];
  setInterval(() => { if (pendingGaps.length) retryGaps(); }, 20000);
  function retryGaps() {
    if (!pendingGaps.length) return;
    if (!session) { pendingGaps = []; return; }
    const keep = [];
    for (const g of pendingGaps) {
      const maxLen = Math.max(g.d * 2, g.d + 250), dt = (g.tb - g.ta) / 1000;
      const r = (g.via.length && routeVia(g.a, g.b, g.via)) || W.route(g.a, g.b, maxLen);
      if (r && r.len <= Math.max(maxLen, r.via ? r.len : 0) && (dt <= 0 || r.len / dt <= MAX_SPEED * 1.5)) { fillGap(r, g.a, g.b, g.ta, g.tb); continue; }
      if (Date.now() - g.since < 3 * 60000) { keep.push(g); continue; }
      // 3 minutos sin camino posible (de verdad no lo hay): como antes, lo que haya justo en línea recta (si es corto)
      if (g.d < 400) { const st = Math.ceil(g.d / 4), h = [g.b[0] - g.a[0], (g.b[1] - g.a[1]) * Math.cos(g.b[0] * Math.PI / 180)]; for (let i = 1; i <= st; i++) paintAround(PM.geo.lerp(g.a, g.b, i / st), h); }
    }
    pendingGaps = keep;
    paintedDirty = true; PM.state.save();
  }

  // ---------------- Memoria: las zonas lejanas salen; lo pintado de antes se recoge poco a poco ----------------
  // Con más de 36 zonas en memoria se quitan las más lejanas hasta dejar 25. Nunca: las que tienes a menos de 2
  // celdas (~2 km), las de lo que estás mirando, las de tu barrio ni las de un hueco del GPS por rellenar.
  // Lo pintado y lo conquistado se siguen viendo (salen del almacén de formas) y las calles vuelven al acercarte.
  const KEEP_MAX = 36, KEEP_TO = 25;
  function keepSet() {
    const keep = new Set(), T = W.TILE;
    const around = (p, r) => { const i = Math.floor(p[0] / T), j = Math.floor(p[1] / T); for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) keep.add((i + a) + '_' + (j + b)); };
    around(pos, 2);
    const c = map.getCenter(); around([c.lat, c.lng], 2);
    const B = curBarrio && W.barrios[curBarrio];
    if (B && B.bbox) {
      const i0 = Math.floor(B.bbox[0] / T), i1 = Math.floor(B.bbox[2] / T), j0 = Math.floor(B.bbox[1] / T), j1 = Math.floor(B.bbox[3] / T);
      if ((i1 - i0 + 1) * (j1 - j0 + 1) <= 30) for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) keep.add(i + '_' + j);
    }
    for (const g of pendingGaps) { around(g.a, 1); around(g.b, 1); }
    return keep;
  }
  function trimMemory() {
    const loaded = Object.keys(W.tiles).filter((k) => W.tiles[k].loaded);
    if (loaded.length <= KEEP_MAX) return;
    const keep = keepSet(), ip = Math.floor(pos[0] / W.TILE), jp = Math.floor(pos[1] / W.TILE);
    const far = (k) => { const [i, j] = k.split('_').map(Number); return Math.max(Math.abs(i - ip), Math.abs(j - jp)); };
    const cand = loaded.filter((k) => !keep.has(k)).sort((x, y) => far(y) - far(x));
    geoHarvest(cand);   // (por si acaso: su pintado queda guardado antes de quitarlas)
    W.unloadTiles(cand.slice(0, loaded.length - KEEP_TO));
  }
  setInterval(trimMemory, 30000);
  // Lo pintado antes de esta versión: sus formas se recogen en segundo plano, zona a zona, desde la copia del móvil
  // (sin pintar, con la app a la vista y de una en una). Al acabar, cada zona lejana vuelve a salir de la memoria.
  let harvestBusy = false;
  const harvestTry = {};
  async function harvestOld() {
    if (harvestBusy || !mapReady || document.hidden || (session && !session.paused) || !geoReady) return;
    const pb = S().paintedByTile;
    const k = Object.keys(pb).find((x) => pb[x] > 0 && !harvested[x] && !(Date.now() - (harvestTry[x] || 0) < 30 * 60000));
    if (!k) return;
    harvestBusy = true;
    try {
      if (W.tiles[k] && W.tiles[k].loaded) { geoHarvest([k]); return; }
      await W.ensureKeys([k]);
      if (W.tiles[k] && W.tiles[k].loaded) geoHarvest([k]); else harvestTry[k] = Date.now();   // no llegó (¿sin conexión?): en media hora
      if (!keepSet().has(k)) W.unloadTiles([k]);
      paintedDirty = true;
    } catch (e) { /* sin conexión: se probará más tarde */ } finally { harvestBusy = false; }
  }
  setInterval(harvestOld, 5000);

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
    // 1) candidatas: cerca y en tu dirección
    const cand = [];
    for (const piece of W.piecesNear(p, WIDE_RADIUS)) {
      const dist = PM.geo.distToPolyline(p, piece.pts);
      // senderos: el GPS va peor entre árboles y los caminos serpentean → más margen de distancia y de ángulo
      if (dist > (piece.wide ? WIDE_RADIUS : piece.trail ? TRAIL_RADIUS : PAINT_RADIUS)) continue;
      // Sin dirección conocida (parado, primera lectura): solo lo que pisas. Con dirección: solo tramos
      // que van en tu misma dirección (al pasar por un cruce no se pinta el arranque de la calle lateral).
      let ok = !hl && dist <= PAINT_CORE;
      if (hl) {
        const a = piece.pts[0], b = piece.pts[piece.pts.length - 1];
        const v = [b[0] - a[0], (b[1] - a[1]) * Math.cos(a[0] * Math.PI / 180)];
        const vl = Math.hypot(v[0], v[1]);
        // lejos (otra calzada de una avenida) se exige ir casi paralelo: < ~30°; cerca basta < ~53°
        ok = vl > 0 && Math.abs((v[0] * heading[0] + v[1] * heading[1]) / (vl * hl)) >= (piece.trail ? 0.4 : dist > PAINT_RADIUS ? 0.85 : 0.6);
      }
      // cruces: el arranque de la calle lateral justo en la esquina se pinta un poquito (si lo pisas)
      if (!ok && hl && piece.len < 8 && dist <= 5) ok = true;
      if (ok) cand.push([piece, dist]);
    }
    // 2) solo la calle por la que vas: la más cercana y las que estén casi igual de cerca (margen para el GPS).
    //    Así no se pintan calles paralelas a 12-14 m que no pisas (antes se pintaba bastante más de lo andado).
    //    Las avenidas anchas siguen pintando ambas calzadas.
    //    Las avenidas anchas pintan ambas calzadas SOLO si vas por la avenida (es lo más cercano a ti); si vas por
    //    una calle paralela a 20-40 m, la avenida no se pinta (antes sí: se pintaban tramos que no habías pisado).
    let best = Infinity, nearest = null;
    for (const [pc, d] of cand) { if (!pc.wide && d < best) best = d; if (!nearest || d < nearest[1]) nearest = [pc, d]; }
    const onAvenue = nearest && nearest[0].wide;
    for (const [piece, dist] of cand) {
      if (piece.wide && !onAvenue && dist > PAINT_RADIUS) continue;
      if (!piece.wide && dist > best + 7 && !(piece.len < 8 && dist <= 5)) continue;
      if (S().painted[piece.id]) G.repass(piece); else G.paintPiece(piece, aura);
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
      if (S().landmarks[id]) continue;
      const d = PM.geo.dist(pos, W.landmarks[id].pos);
      if (d < lmD) { lmD = d; lm = W.landmarks[id]; }
    }
    for (const id in canMarkers) {
      const c = W.cans[id];
      if (!c || S().cansTaken[id]) continue;
      const d = PM.geo.dist(pos, c.pos);
      if (d < canD) { canD = d; can = c; }
    }
    const arrow = (t) => `<i class="rarrow" style="transform:rotate(${bearingTo(pos, t) - map.getBearing()}deg)">➤</i>`;
    const parts = [];
    if (lm && lmD < 1500) parts.push(`${lm.emoji} ${PM.fmtDist(lmD)} ${arrow(lm.pos)}`);
    $('#radar').innerHTML = parts.length ? parts.join(' · ') : '';
    $('#radar').classList.toggle('show', parts.length > 0);
  }
  setInterval(updateRadar, 1000);
  setInterval(() => { if (session && !session.paused) checkNearMust(pos); }, 5000);

  // Captura por permanencia: CAPTURE_SECONDS seguidos a menos de CAPTURE_RADIUS del monumento.
  // t = hora real de la lectura GPS (con la pantalla bloqueada las lecturas llegan luego, en lote).
  // Captura de VARIOS a la vez: cada lugar en cuyo radio estás cuenta su propio tiempo; si hay varios juntos
  // (castillo + palacio + museo en la misma plaza…), a los 10 s se conquistan todos.
  let dwells = {};   // id -> { lm, since }
  const canCapture = (lm) => { const r = S().landmarks[lm.id]; return !r || Date.now() - r.last > G.REVISIT_MS; };
  function checkDwell(p, t, visible) {
    if (!session || session.paused) { dwells = {}; showDwell(); return; }
    // los que ya estaban en marcha: ¿sigues cerca?, ¿ha pasado el tiempo?
    for (const [id, dw] of Object.entries(dwells)) {
      if (PM.geo.dist(p, dw.lm.pos) > (dw.lm.capR || CAPTURE_RADIUS) + (CAPTURE_EXIT - CAPTURE_RADIUS) || !canCapture(dw.lm)) {
        if (visible && canCapture(dw.lm)) toast(`📸 Te has alejado de ${dw.lm.emoji} ${dw.lm.name}: captura cancelada`, 'warn', 2500);
        delete dwells[id];
      } else if (t - dw.since >= CAPTURE_SECONDS * 1000) {
        delete dwells[id];
        G.visitLandmark(dw.lm);
      }
    }
    // los nuevos dentro de su radio de captura (da igual lo cerca que estén unos de otros)
    const nuevos = [];
    for (const id in W.landmarks) {
      const lm = W.landmarks[id];
      if (dwells[id] || !canCapture(lm) || PM.geo.dist(p, lm.pos) > (lm.capR || CAPTURE_RADIUS)) continue;
      dwells[id] = { lm, since: t }; nuevos.push(lm);
    }
    if (nuevos.length && visible) {
      toast(nuevos.length === 1 ? `📸 Quédate ${CAPTURE_SECONDS} s junto a ${nuevos[0].emoji} <b>${nuevos[0].name}</b> para capturarlo`
        : `📸 Quédate ${CAPTURE_SECONDS} s: capturas <b>${nuevos.length} lugares</b> a la vez (${nuevos.map((l) => l.emoji).join(' ')})`, 'info', 3000);
      PM.vibrate(30);
    }
    if (visible) showDwell(t);
  }
  function showDwell(t) {
    const el = $('#capture');
    const list = Object.values(dwells).sort((x, y) => x.since - y.since);
    if (!list.length) { el.classList.remove('show'); return; }
    const dw = list[0], now = t || Date.now();
    const left = Math.max(0, CAPTURE_SECONDS - Math.floor((now - dw.since) / 1000));
    const pct = Math.min(100, ((now - dw.since) / (CAPTURE_SECONDS * 1000)) * 100);
    const names = list.length === 1 ? `${dw.lm.emoji} ${dw.lm.name}` : `${list.map((x) => x.lm.emoji).join(' ')} ${list.length} lugares`;
    el.innerHTML = `📸 Capturando ${names}… <b>${left} s</b><span class="cbar"><i style="width:${pct}%"></i></span>`;
    el.classList.add('show');
  }
  // quieto junto al monumento no llegan lecturas nuevas del GPS: se comprueba cada segundo con la última posición
  setInterval(() => { if (session && !session.paused) checkDwell(pos, Date.now(), !document.hidden); }, 1000);   // también en el bolsillo: quieto junto a un lugar, el GPS no manda nada nuevo

  function checkLandmarksAndCans(p, visible = true, t = Date.now()) {
    const n = nearestLandmark(p);
    nearCache = { t: performance.now(), v: n };
    auraEl.classList.toggle('on', n.d <= AURA_RADIUS);
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
    if (mapReady && map.getLayer('pm-lms') && map.queryRenderedFeatures(e.point, { layers: ['pm-lms'] }).length) return;   // tocó un lugar
    const p = [e.lngLat.lat, e.lngLat.lng];
    if (mode !== 'sim') return;
    if (e.originalEvent.ctrlKey || e.originalEvent.metaKey) { teleport(p); return; }
    target = p;
    follow = true; zoomAround();
  });
  map.on('dragstart', () => { if (touching >= 2 && follow) return;   // pinza siguiéndote: es zoom, no te dejo de seguir
    follow = false; zoomAround(); $('#btn-center').classList.add('show'); clearTimeout(recenterTimer); });
  map.on('dragend', () => { clearTimeout(recenterTimer); recenterTimer = setTimeout(recenter, 8000); });
  map.on('zoomend', () => camera());
  window.addEventListener('resize', () => { padCache.t = 0; camera(); });

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
  function setHeadingTarget(h) { headingTarget = (h + 360) % 360; wakeLoop(); }
  function onCompass(e) {
    let h = null;
    if (e.webkitCompassHeading != null) h = e.webkitCompassHeading;
    else if (e.absolute && e.alpha != null) h = (360 - e.alpha) % 360;
    if (h == null) return;
    compass = compass == null ? h : (compass + angDiff(compass, h) * 0.15 + 360) % 360;
    compassT = Date.now(); wakeLoop();
  }
  window.addEventListener('deviceorientationabsolute', onCompass);
  // En Android la web no recibe el norte: brújula nativa (sensor de rotación), solo en modo rumbo y con la app a la vista
  // Plugins nativos: en la app van en Capacitor.Plugins (la web cargada desde el móvil NO trae registerPlugin;
  // antes se buscaba ahí y por eso el GPS de segundo plano, la brújula y el aviso de batería nunca se activaban)
  function nativePlugin(name) { const C = window.Capacitor; return (PM.isNative && C && ((C.Plugins && C.Plugins[name]) || (C.registerPlugin && C.registerPlugin(name)))) || null; }
  const CompassN = nativePlugin('Compass');
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
          compassT = Date.now(); wakeLoop();
        });
      }
      CompassN.start().catch(() => { compassOn = false; });
    } else if (!want && compassOn) { compassOn = false; CompassN.stop().catch(() => {}); }
  }
  document.addEventListener('visibilitychange', compassSync);
  window.addEventListener('deviceorientation', (e) => { if (e.webkitCompassHeading != null) onCompass(e); });
  // cada fotograma: girar poco a poco hacia el rumbo (sin saltos)
  let pitchTarget = 0;
  function stepPitch(dt) {
    const p = map.getPitch(), d = pitchTarget - p;
    if (Math.abs(d) > 0.3 && !gestureBusy()) map.setPitch(p + d * Math.min(1, dt * 5));
  }
  function stepHeading(dt) {
    // brújula (hacia donde apunta el móvil) si la hay; si no, el rumbo del GPS / de la marcha
    const walkingNow = mode === 'gps' && speed > 0.6 && Date.now() - Math.max(lastMoveT, lastCourseT) < 6000;
    if (orient === 'heading' && compass != null && Date.now() - compassT < 1500 && !walkingNow && !(mode === 'sim' && (simTurned || target)) && Math.abs(angDiff(headingTarget, compass)) >= 2) setHeadingTarget(compass);   // (el temblor de la brújula, < 2°, no gira el mapa: menos batería)
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
    const hs = alongStreet(b, h);
    if (mode === 'gps' && !confirmTurn(hs)) return;
    setHeadingTarget(hs);
  }
  // Si vas por una calle, el mapa se alinea con ELLA (no con el rumbo del GPS, que baila unos grados de lado a lado):
  // la calle más cercana (< 15 m) cuyo sentido se parece al de la marcha (± 35°); en un cruce o en una plaza, el rumbo tal cual.
  function alongStreet(p, h) {
    let best = null, bd = 15;
    const kx = PM.geo.mPerDegLon(p[0]), ky = PM.geo.mPerDegLat;
    for (const pc of W.piecesNear(p, 15)) {
      const pts = pc.pts;
      for (let i = 1; i < pts.length; i++) {
        const ax = (pts[i - 1][1] - p[1]) * kx, ay = (pts[i - 1][0] - p[0]) * ky, bx = (pts[i][1] - p[1]) * kx, by = (pts[i][0] - p[0]) * ky;
        const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
        if (L < 1) continue;
        const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)), d = Math.hypot(ax + t * dx, ay + t * dy);
        if (d >= bd) continue;
        let sb = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
        if (Math.abs(angDiff(h, sb)) > 90) sb = (sb + 180) % 360;   // la calle en el sentido en que vas
        if (Math.abs(angDiff(h, sb)) > 35) continue;
        bd = d; best = sb;
      }
    }
    return best == null ? h : best;
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
    const want = orient === 'heading' ? heading : 0;
    const cur = map.getBearing();
    const diff = Math.abs((((want - cur) % 360) + 540) % 360 - 180);
    if (force || (diff > 0.4 && now - lastBearingT > 33 && !gestureBusy())) { map.setBearing(want); lastBearingT = now; }
    const el = playerEl.querySelector('.arrow');
    if (el) el.style.transform = `rotate(${heading - map.getBearing()}deg)`;
  }

  function setOrient(o) {
    orient = o;
    try { localStorage.setItem('pintamapa_orient', o); } catch (e) {}
    simTurned = false;
    headingTarget = heading;
    compassSync();
    applyBearing(true);
    pitchTarget = 0;   // siempre en 2D desde arriba (más claro y más fluido)
    set3D(false);
    camera();
    $('#btn-orient').innerHTML = o === 'heading' ? '<span>➤</span><small>rumbo</small>' : '<span>N</span><small>norte</small>';
    $('#btn-orient').classList.toggle('on', o === 'heading');
  }
  // Ver solo tus calles pintadas: oculta los lugares para conquistar (al empezar a pintar vuelven a salir)
  let placesOff = false;
  try { placesOff = localStorage.getItem('pintamapa_places_off') === '1'; } catch (e) {}
  function setPlaces(off, quiet) {
    placesOff = off;
    try { localStorage.setItem('pintamapa_places_off', off ? '1' : '0'); } catch (e) {}
    if (map.getLayer('pm-lms')) map.setLayoutProperty('pm-lms', 'visibility', off ? 'none' : 'visible');   // los halos los decide stepHalos
    fxSync();
    $('#btn-places').classList.toggle('off', off);
    $('#btn-places').innerHTML = off ? '<span>🖌️</span><small>calles</small>' : '<span>📍</span><small>lugares</small>';
    if (!quiet) toast(off ? '🖌️ Solo tus calles pintadas (los lugares, ocultos)' : '📍 Lugares para conquistar visibles', 'info');
  }
  $('#btn-places').addEventListener('click', () => setPlaces(!placesOff));
  $('#btn-orient').addEventListener('click', () => {
    setOrient(orient === 'heading' ? 'north' : 'heading');
    toast(orient === 'heading' ? '🧭 El mapa gira hacia donde andas' + (mode === 'sim' ? ' (A/D giran, W/S avanzan)' : '') : '🧭 Norte arriba (mapa fijo)', 'info');
  });

  // ---------------- Foto de perfil ----------------
  gpsIcon('search');
  if (S().mystery || S().pet || S().bones) { delete S().mystery; delete S().pet; delete S().bones; PM.state.save(); }   // restos de funciones retiradas
  FUN = PM.fun.create({ map, S, W, G, toast, openSheet, celebrate, setSrc, FC, ll, circlePoly, $,
    getPos: () => pos, inSession: () => !!(session && !session.paused), sessionWalked: () => (session ? session.st.walked : 0),
    lookAt: (c, z) => { follow = false; zoomAround(); $('#btn-center').classList.add('show'); clearTimeout(recenterTimer); recenterTimer = setTimeout(recenter, 20000); map.easeTo({ center: ll(c), zoom: z, duration: 900 }); } });
  // «Tu semana pintando»: el domingo y el lunes, una vez por semana, aviso para ver el resumen en vídeo
  const openWeek = () => PM.need('lib/mp4-muxer.js', 'js/replay.js', 'js/wrapped.js').then(() => PM.wrapped.open({ S, W })).catch(() => toast('Sin conexión para abrir el vídeo', 'warn'));
  setTimeout(() => {
    const d = new Date(), wk = d.getFullYear() + '-' + Math.floor((d - new Date(d.getFullYear(), 0, 1)) / 604800000);
    if ((d.getDay() === 0 || d.getDay() === 1) && S().wrappedWeek !== wk && (S().walks || []).some((w) => w.start > Date.now() - 7 * 86400000)) {
      S().wrappedWeek = wk; PM.state.save();
      const el = toast('📽️ <b>¡Tu semana pintando está lista!</b> Toca para verla', 'gold', 8000);
      el.style.pointerEvents = 'auto'; el.style.cursor = 'pointer'; el.addEventListener('click', openWeek);
    }
  }, 5000);

  // Gancho de pruebas (consola del navegador): PM.debug.walkTo([lat, lon]), PM.debug.setPace(0..4)
  PM.debug = { map, walkTo(p) { target = p; follow = true; }, setPace(i) { pace = i; turbo = false; }, get pos() { return pos.slice(); },
    get bearing() { return map.getBearing(); }, get heading() { return heading; }, get gap() { return { lastP, lastT, pending: pendingGaps.length, autoResumed, lastSeen: session && session.lastSeen }; }, trim: () => trimMemory(), harvest: () => harvestOld(), flushGeo: () => geoFlush(), get geo() { return { pgeo: pgeo.size, zonas: pgeoTile.size, barrios: Object.keys(bgeo).length, recogidas: Object.keys(harvested).length, ready: geoReady }; }, get painted() { return paintedF; },
    // avanza el juego n fotogramas a mano (pruebas con la pestaña oculta, donde el navegador congela la animación)
    frames(n, ms = 50) { let t = lastFrame; for (let i = 0; i < n; i++) { t += ms; loop(t, true); } } };
  PM.debug.fx = (id) => conquestFX(id || curBarrio);   // pruebas: animación de conquista

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
    stepPitch(dt);
    stepHalos();
    G.tickCombo(Date.now());
    flushPaint();
    if (manual) return;
    // sin nada que mover (quieto, sin girar, sin pintar pendiente): el bucle descansa 1/4 s en vez de ir a 60 por
    // segundo. Cualquier novedad (GPS, giro, simulador) lo despierta al momento con wakeLoop().
    const busy = mode === 'sim' || anim || Math.abs(angDiff(heading, headingTarget)) >= 0.3 || Math.abs(map.getPitch() - pitchTarget) > 0.3
      || streetsDirty || paintedDirty || paintedAdd;
    if (busy) requestAnimationFrame(loop);
    else loopSleep = setTimeout(() => { loopSleep = null; requestAnimationFrame(loop); }, 250);
  }
  let loopSleep = null;
  function wakeLoop() { if (loopSleep) { clearTimeout(loopSleep); loopSleep = null; lastFrame = performance.now(); requestAnimationFrame(loop); } }

  // icono del GPS junto a la velocidad: buscando = antena animada; con señal = fijo (verde, o ámbar si es impreciso)
  function gpsIcon(st, acc) {
    const el = $('#gps'), key = st + (st === 'weak' ? Math.round(acc / 10) : '');
    if (el.dataset.k === key) return;
    el.dataset.k = key;
    el.className = 'badge gpsi gps-' + st + (el.classList.contains('show') ? ' show' : '');
    el.title = { search: 'Buscando GPS…', ok: `GPS con señal (±${Math.round(acc || 0)} m)`, weak: `GPS impreciso (±${Math.round(acc || 0)} m)`, off: 'GPS apagado (ahorrando batería)' }[st];
    el.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle class="g-dot" cx="12" cy="12" r="3.2"/><circle class="g-r1" cx="12" cy="12" r="6.5"/><circle class="g-r2" cx="12" cy="12" r="10"/></svg>${st === 'weak' ? `<small>±${Math.round(acc)}</small>` : ''}`;
  }
  // --- GPS real (con servicio en segundo plano en Android) ---
  // Ahorro de batería: el GPS solo está encendido durante una sesión activa (no en pausa),
  // el servicio nativo solo despierta cada DISTANCE_FILTER metros y con la app oculta no se redibuja nada.
  const DISTANCE_FILTER = 8;
  const BG = nativePlugin('BackgroundGeolocation');
  let gpsWatch = null;

  function onFix(c, t) {
    if (mode !== 'gps' || !c) return;
    const acc = c.accuracy || 0;
    gpsIcon(acc > 35 ? 'weak' : 'ok', acc);
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

  // ahorro de batería: parado más de 90 s → el GPS solo avisa si te mueves 25 m; en cuanto andas, vuelve a 8 m
  let gpsSaver = false, gpsSaverT = 0;
  function gpsSaverCheck() {
    if (!gpsWatch || !gpsWatch.bg || !session || session.paused || document.hidden) return;   // con la pantalla apagada no se toca el GPS
    const still = Date.now() - Math.max(lastMoveT || 0, session.resumedAt || 0) > 90000 && speed < 0.4;
    if (still !== gpsSaver && Date.now() - gpsSaverT > 60000) { gpsSaver = still; gpsSaverT = Date.now(); startGPS(); }
  }
  setInterval(gpsSaverCheck, 30000);
  async function startGPS() {
    // con el GPS nativo, el vigilante nuevo se crea ANTES de quitar el viejo: si el servicio se quedara un instante
    // sin vigilantes, Android le quita el «primer plano» y con la pantalla apagada ya no recibiría posiciones
    const old = gpsWatch && gpsWatch.bg ? gpsWatch : null;
    if (!old) stopGPS();
    try {
      if (BG) {
        const id = await BG.addWatcher({
          backgroundTitle: 'PintaMapa está pintando tus calles',
          backgroundMessage: 'Toca para volver al juego. Finaliza el paseo para apagar el GPS.',
          requestPermissions: true, stale: false, distanceFilter: gpsSaver ? 25 : DISTANCE_FILTER,
        }, (loc, err) => {
          if (err) {
            if (err.code === 'NOT_AUTHORIZED') toast('Necesito permiso de ubicación para pintar 📍', 'warn', 5000);
            return;
          }
          onFix(loc, loc.time);
        });
        gpsWatch = { bg: id };
        if (old) Promise.resolve(BG.removeWatcher({ id: old.bg })).catch(() => {});
      } else if (navigator.geolocation) {
        gpsWatch = { web: navigator.geolocation.watchPosition((p) => onFix(p.coords, p.timestamp),
          (e) => { toast('No se pudo obtener el GPS: ' + e.message, 'warn'); },
          { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }) };
      } else throw new Error('Este dispositivo no tiene GPS');
      gpsIcon('search');
    } catch (e) {
      toast('GPS: ' + (e.message || e) + ' — paso a modo simulación', 'warn');
      setMode('sim');
    }
  }
  function stopGPS() {
    if (!gpsWatch) return;
    if (gpsWatch.bg) Promise.resolve(BG.removeWatcher({ id: gpsWatch.bg })).catch(() => {});
    if (gpsWatch.web != null) navigator.geolocation.clearWatch(gpsWatch.web);
    gpsWatch = null;
    gpsIcon('off');
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
    const changed = m !== mode;
    mode = m;
    document.body.classList.toggle('sim', m === 'sim');
    $('#gps').classList.toggle('show', m === 'gps');
    // solo al cambiar de modo se olvida la última posición (al abrir la app con un paseo en marcha se conserva:
    // es el punto de partida para rellenar el tramo hecho mientras Android la tuvo cerrada)
    if (changed) { lastP = null; speed = 0; }
    if (m === 'gps') { if (!gpsWanted()) locateOnce(); syncGPS(); } else stopGPS();
    renderSimPanel();
  }

  // ---------------- Sesiones de paseo: empezar / pausar / reanudar / finalizar ----------------
  let session = S().session || null;   // sobrevive a cerrar la app
  let autoResumed = false;
  if (session && !session.paused) {
    if (Date.now() - (session.lastSeen || 0) < 20 * 60000) autoResumed = true;   // Android la cerró hace poco: el paseo sigue solo
    else {                                                                          // hace mucho: queda en pausa
      session.elapsed += Math.max(0, (session.lastSeen || session.resumedAt) - session.resumedAt);
      session.paused = true;
    }
  }
  const newSessionStats = () => ({ walked: 0, painted: 0, pts: 0, pieces: 0, captures: 0, cans: 0, bestCombo: 0, conquests: 0 });

  function sessionElapsed() {
    if (!session) return 0;
    return session.elapsed + (session.paused ? 0 : Date.now() - session.resumedAt);
  }
  function persistSession() { if (session) session.lastSeen = Date.now(); S().session = session; PM.state.save(); }

  function startSession() {
    if (placesOff) setPlaces(false, true);   // pintando, los lugares se ven siempre (si no, pasarías de largo)
    session = { start: Date.now(), resumedAt: Date.now(), elapsed: 0, paused: false, st: newSessionStats(), track: [] };
    lastP = null; walkAnchor = null;
    persistSession(); syncGPS(); renderSession();
    PM.update.hold();
    PM.sound.pickup(); PM.vibrate(60);
    askNotifyPermission();
    // ¿Android puede frenar el GPS con la pantalla apagada? Se mira de verdad (ahorro de batería del sistema) y, si
    // la app sigue «optimizada», se ofrece el diálogo del propio Android para permitirlo (como mucho cada 3 días)
    if (isNative && mode === 'gps') checkBattery();
    toast(mode === 'gps' ? '🖌️ ¡A pintar! Puedes bloquear el móvil: sigo pintando en segundo plano' : '🖌️ ¡A pintar! Muévete con WASD o haz clic en el mapa', 'info', 4500);
  }
  const PmSys = nativePlugin('PmSystem');
  async function checkBattery() {
    let st = null;
    try { st = PmSys && await PmSys.batteryStatus(); } catch (e) { st = null; }   // APK antiguo sin el ajuste: nada
    if (!st || st.ignoring) return;
    let last = 0; try { last = +localStorage.getItem('pintamapa_bathint2') || 0; } catch (e) {}
    if (Date.now() - last < 3 * 86400000) return;
    try { localStorage.setItem('pintamapa_bathint2', String(Date.now())); } catch (e) {}
    openSheet('🔋 Para pintar con el móvil en el bolsillo', `
      <p>Tu móvil tiene PintaMapa en <b>ahorro de batería</b>: con la pantalla apagada puede frenar el GPS o cerrar la app, y quedarían tramos sin pintar.</p>
      <button class="btn on" id="bat-ok" style="width:100%;margin:6px 0 10px">🔋 Permitir que pinte en segundo plano</button>
      <p class="muted">Se abre el aviso de Android: elige <b>Permitir</b>. Si no sale, en <b>Ajustes → Aplicaciones → PintaMapa → Batería</b> pon <b>Sin restricciones</b>.
      PintaMapa solo usa el GPS mientras hay un paseo activo: en pausa o al finalizar se apaga del todo.</p>`);
    const btn = $('#bat-ok');
    if (btn) btn.addEventListener('click', async () => { $('#sheet').classList.remove('show'); try { await PmSys.requestBattery(); } catch (e) { toast('Ábrelo en Ajustes → Aplicaciones → PintaMapa → Batería', 'warn', 5000); } });
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
  // copia en la nube cada 10 min mientras paseas (si Android cierra la app, no se pierde lo pintado)
  setInterval(() => { if (session && !session.paused) PM.sync.auto(); }, 10 * 60000);

  function showSummary(s) {
    const st = s.st, movMs = PM.movingMs(s), min = movMs / 60000;   // velocidad con el tiempo en movimiento (como Strava)
    const kmh = min > 0 ? (st.walked / 1000) / (min / 60) : 0;
    openSheet('🏁 Paseo terminado', `
      <p class="muted">${new Date(s.start).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })} · ${fmtTime(movMs)} en movimiento${movMs < s.elapsed - 60000 ? ` (total ${fmtTime(s.elapsed)})` : ''}</p>
      <div class="stats">
        <div><b>${PM.fmtDist(st.walked)}</b><small>caminados</small></div>
        <div><b>${PM.fmtDist(st.painted)}</b><small>calles nuevas</small></div>
        <div><b>+${PM.fmtNum(st.pts)}</b><small>puntos</small></div>
        <div><b>${st.captures}</b><small>lugares</small></div>
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
  async function openWalk(w) {
    if (!w) return;
    const keys = [...new Set((w.track || []).filter(Boolean).map((q) => W.tileKeyOf(q[0], q[1])))].filter((k) => !(W.tiles[k] && W.tiles[k].loaded));
    if (keys.length && keys.length <= 40) { toast('🗺️ Cargando las calles del recorrido…', 'info', 2000); await W.ensureKeys(keys); }
    const geo = {};
    for (const id in S().painted) { const pc = W.pieces[id]; if (pc) geo[id] = pc.pts; }
    await PM.need('lib/mp4-muxer.js', 'js/replay.js');
    PM.replay.open(w, { geo, color: paintColor(), player: PM.player && PM.player.name });
  }
  function panelWalks() {
    const ws = (S().walks || []).slice().reverse();
    openSheet('🥾 Mis paseos', (ws.length ? ws.map((w, i) => `<div class="mission walk-row" data-i="${i}"><div class="mt">${new Date(w.start).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}<span>${PM.fmtDist(w.st.walked || 0)} ›</span></div>
      <small>⏱ ${fmtTime(PM.movingMs(w))} · 🖌️ ${PM.fmtDist(w.st.painted || 0)} nuevas · +${PM.fmtNum(w.st.pts || 0)} pts${w.imported ? ' · ⌚ importado' : ''}</small></div>`).join('')
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
      msg(`⏳ Cargando calles (${keys.length} zona${keys.length > 1 ? 's' : ''})…`);
      await W.ensureKeys(keys);
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
      flushPaint(); updateSessionInfo(); wakeLoop();
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
    el.textContent = tooFast ? `🚗 ${kmh.toFixed(0)} km/h ¡muy rápido!`
      : (turbo && mode === 'sim' ? `🚀 ${kmh.toFixed(0)} km/h` : `${pc.icon} ${kmh.toFixed(1)} km/h`);
    el.title = tooFast ? 'Demasiado rápido: la pintura no se pega' : pc.name;
    el.classList.toggle('bad', tooFast);
  }

  // ---------------- HUD ----------------
  let hudB = { p: null, b: null, dirty: true };
  // el marcador solo toca la pantalla si algo cambió (reescribirlo 4 veces por segundo obliga al móvil a recolocar
  // toda la interfaz y el mapa da tirones al arrastrarlo)
  const hudCache = new Map();
  const hudSet = (key, el, fn, v) => { if (hudCache.get(key) === v) return; hudCache.set(key, v); fn(typeof el === 'string' ? $(el) : el, v); };
  const setT = (sel, v) => hudSet('t' + sel, sel, (e, x) => { e.textContent = x; }, String(v));
  const setW = (sel, v) => hudSet('w' + sel, sel, (e, x) => { e.style.width = x; }, String(v));
  const setH = (el, v) => hudSet('h' + el.id, el, (e, x) => { e.innerHTML = x; }, String(v));
  function updateHUD() {
    const lp = G.levelProgress();
    setT('#lvl', lp.short); hudSet('lvlc', '#lvl', (e, x) => { e.title = 'Nivel ' + lp.label; e.style.color = x; }, lp.tier ? lp.tier.color : '');
    setW('#xpbar i', (lp.pct * 100).toFixed(1) + '%');
    setT('#xptext', `${PM.fmtNum(S().xp)} pts · v${PM.VERSION.app}`);
    const t = W.tiles[curTile];
    if (t && (t.loaded || t.partial) && (!hudB.p || hudB.dirty || PM.geo.dist(hudB.p, pos) > 8)) hudB = { p: pos.slice(), b: W.barrioAt(pos), dirty: false };
    const bq = t && (t.loaded || t.partial) ? hudB.b : null;
    const B = bq && W.barrios[bq.id];
    if (t && (t.loaded || t.partial)) {
      if (bq && bq.id !== curBarrio) { curBarrio = bq.id; W.ensureBarrio(bq.id); renderBarrios(); }
      const done = B && W.barrioComplete(bq.id);
      const pr = B ? G.barrioProgress(bq.id) : 0;
      if (bq && B && S().conqueredB[bq.id]) checkRank(bq.id, pr, B);
      if (bq && B && done) checkBarrioNear(bq.id, pr, B);
      setT('#barrio-name', (bq && S().conqueredB[bq.id] ? RANKS[rankOf(bq.id)].ic + ' ' : '') + ((B && B.name) || (bq && bq.name) || t.name || 'Barrio sin explorar'));
      setT('#barrio-pct', !B ? '' : !done ? 'calculando…' : B.total ? (pr * 100).toFixed(1) + ' %' : 'sin calles');
      setW('#barrio-bar i', (pr * 100).toFixed(1) + '%');
      if (t.city) {
        const cp = G.cityProgress(t.city);
        setT('#city', `${S().citiesWon[t.city] ? '👑 ' : '🏙️ '}${t.city} · ${(cp.pct * 100).toFixed(cp.pct < 0.01 ? 2 : 1)} %` +
          (cp.real ? ` de ${PM.fmtDist(cp.total)} de calles` : ' (midiendo ciudad…)'));
      } else setT('#city', '🏙️ Localizando ciudad…');
    } else {
      setT('#barrio-name', 'Cargando calles…');
      setT('#barrio-pct', '');
      setW('#barrio-bar i', '0%');
    }
    const c = G.combo;
    const cb = $('#combo');
    cb.classList.toggle('show', c >= 3);
    setH(cb, `<b>x${G.comboMult().toFixed(2).replace(/\.?0+$/, '')}</b><span>COMBO ${c}</span>`);
    const gl = G.goldenLeft();
    $('#golden').classList.toggle('show', gl > 0);
    setT('#golden', `✨ Pintura dorada x3 · ${Math.ceil(gl / 1000)} s`);
  }
  setInterval(updateHUD, 250);

  // ---------------- Notificaciones y efectos ----------------
  function toast(html, kind = 'ok', ms = 2600) {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.innerHTML = html;
    const box = $('#toasts');
    box.appendChild(el);
    while (box.children.length > 3) box.firstElementChild.remove();   // como mucho 3 avisos a la vez
    setTimeout(() => el.classList.add('out'), ms);
    setTimeout(() => el.remove(), ms + 400);
    return el;
  }

  function floatText(txt, cls = '') {
    const pt = map.project(ll(pos));
    const el = document.createElement('div');
    el.className = 'float ' + cls;
    el.textContent = txt;
    el.style.left = pt.x + (Math.random() * 40 - 20) + 'px';
    el.style.top = pt.y - 30 + 'px';
    $('#fx').appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }

  function splat() {
    const pt = map.project(ll(pos));
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
  let splatThrottle = 0, achQueue = [], achTimer = null;
  const cardQueue = [];
  function showNextCard() {
    const v = document.getElementById('tcg-view');
    if (!cardQueue.length || (v && v.classList.contains('show'))) return;
    const [id, pts] = cardQueue.shift();
    PM.cards.open(id, { isNew: true, pts });
  }
  setInterval(showNextCard, 600);
  G.on((ev, d) => {
    if (ev === 'xp' && session) { session.st.pts += d.n; persistSession(); }
    switch (ev) {
      case 'repass': {
        if ([2, 4, 7].includes(d.n)) paintedDirty = true;   // cambia de intensidad: redibujar
        if (session) { session.st.repassed = (session.st.repassed || 0) + d.piece.len; }
        break;
      }
      case 'painted': {
        paintedF.push(lineF(d.piece.pts, { h: 0 })); paintedAdd = true;   // solo el tramo nuevo
        geoAdd(d.piece);
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
        placeLandmark(lm); flushLandmarks();
        if (d.first) {
          cardQueue.push([lm.id, d.pts]); showNextCard();   // varias capturas a la vez: una carta detrás de otra
          PM.sound.capture(); PM.vibrate([60, 40, 120]);
          if (d.shiny) { setTimeout(() => { confetti(); PM.sound.fanfare(); PM.vibrate([100, 60, 100, 60, 300]); }, 400); }
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
        (S().barrioRank = S().barrioRank || {})[d.key] = 0; PM.state.save();
        conquestFX(d.key);
        setTimeout(() => celebrate('¡Barrio conquistado! 🥉', `${d.name || 'Este barrio'} es tuyo: has pintado el 60 % de sus calles. Rango Bronce. +2000 · Plata al 80 %, Oro al 90 %`, '🚩'), 1700);
        break;
      case 'perfect':
        toast(`💯 ¡${d.name} pintado al 100 %! +1000`, 'gold', 4000);
        break;
      case 'cityWon':
        celebrate('¡CIUDAD CONQUISTADA! 🥉', `Has pintado el 70 % de las calles de ${d.city}. Rango Bronce. +25000 · Plata al 80 %, Oro al 90 %`, '👑');
        break;
      case 'cityRank':
        celebrate(`¡${d.city}: ciudad de ${PM.RANKS[d.rank].name}! ${PM.RANKS[d.rank].ic}`, `Has pintado el ${d.rank === 1 ? 80 : 90} % de sus calles. +${d.rank === 1 ? '10000' : '15000'}`, PM.RANKS[d.rank].ic);
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
        if (lmIndex[d.id]) { placeLandmark(W.landmarks[d.id] || Object.assign({ id: d.id }, S().landmarks[d.id])); flushLandmarks(); }
        break;
      case 'achievement':   // los que llegan juntos se agrupan en un solo aviso
        achQueue.push(d.a);
        clearTimeout(achTimer);
        achTimer = setTimeout(() => {
          const q = achQueue.splice(0);
          toast(q.length === 1 ? `🏆 Logro: <b>${q[0].name}</b> — ${q[0].desc}`
            : `🏆 <b>${q.length} logros nuevos</b>: ${q.slice(0, 3).map((a) => a.name).join(', ')}${q.length > 3 ? '…' : ''}`, 'gold', 4500);
        }, 700);
        break;
    }
  });

  W.onChange((ev, d) => {
    if (ev === 'barrios') { hudB.dirty = true; renderBarrios(); return; }
    if (ev === 'migrated') { paintedDirty = true; return; }
    if (ev === 'unloaded') {   // zonas lejanas quitadas de la memoria: sus calles grises dejan de dibujarse (lo pintado sigue)
      for (const k of [...rendered]) { const t = W.tiles[k]; if (!t || !(t.loaded || t.partial)) { rendered.delete(k); delete tileFeat[k]; } }
      streetsDirty = true; paintedDirty = true; hudB.dirty = true;
      return;
    }
    if (ev === 'named') {
      if (W.updateMustSee()) { lmDirty = true; flushLandmarks(); }
      if (PM.fillLandmarkCities(S()) + W.fixRecords(S())) PM.state.save();
      return;
    }
    if (ev === 'lmRemoved') { if (lmIndex[d.id]) { delete lmIndex[d.id]; flushLandmarks(true); } return; }
    if (ev === 'loaded' || ev === 'partial') {
      if (ev === 'loaded') { retryGaps(); geoHarvest(d.tiles); }
      d.tiles.forEach((k) => renderTile(k, true));
      renderLandmarks(); renderCans();
      if (ev === 'loaded') $('#loading').classList.remove('show');
      else $('#loading').textContent = '🗺️ Ya puedes pintar · completando el barrio…';
      if (lastP && session && !session.paused) paintAround(lastP);
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

  $('#card').addEventListener('click', () => $('#card').classList.remove('show'));

  function showLandmarkInfo(lm) {
    const got = S().landmarks[lm.id];
    if (got) { PM.cards.open(lm.id); return; }   // conquistado: se abre su carta directamente
    const r = W.RARITY[lm.rarity];
    const d = PM.geo.dist(pos, lm.pos);
    openSheet(lm.emoji + ' ' + (got ? lm.name : '???'), `
      ${lm.must ? `<p class="must-pill">⭐ <b>Imprescindible</b> de ${W.cityAt(lm.pos) || 'esta ciudad'} · vale el doble</p>` : ''}
      <p><span class="pill" style="background:${r.color}">${r.label}</span> ${lm.kind} · ${lm.points * (lm.must ? 2 : 1)} pts</p>
      <p>${got ? `Capturado el ${new Date(got.t).toLocaleDateString('es-ES')} · ${got.visits} visita(s)` :
        `Está a <b>${PM.fmtDist(d)}</b>. Acércate a menos de ${lm.capR || CAPTURE_RADIUS} m y quédate ${CAPTURE_SECONDS} s para capturarlo.`}</p>
      ${!got ? '<p class="muted">Pista: ' + lm.name.replace(/[^\s]/g, (ch, i) => (i % 3 === 0 ? ch : '•')) + '</p>' : ''}`);
  }

  function panelAlbum() {
    openSheet('🃏 Álbum de cromos', '<div id="album-box"></div>');
    PM.cards.album($('#album-box'), { goTo: goToPlace });
  }
  // centra el mapa en un lugar y abre su carta (o su ficha si aún no es tuyo)
  function goToPlace(id) {
    let lm = W.landmarks[id] || (S().landmarks[id] && Object.assign({ id }, S().landmarks[id]));
    if (!lm && /^q:/.test(id)) {   // imprescindible de la lista de su ciudad que aún no se ha cargado: se va allí y aparece al cargar
      const e = [].concat(...Object.values(W.mustLists())).find((x) => x.q === id.slice(2));
      if (!e) return;
      $('#sheet').classList.remove('show');
      follow = false; zoomAround(); $('#btn-center').classList.add('show'); clearTimeout(recenterTimer); recenterTimer = setTimeout(recenter, 25000);
      map.easeTo({ center: ll(e.pos), zoom: Math.max(16.2, map.getZoom()), duration: 900 });
      W.ensureAround(e.pos[0], e.pos[1]);
      toast(`⭐ ${esc(e.name)}: imprescindible de esta ciudad`, 'info');
      return;
    }
    if (!lm || !lm.pos) return;
    $('#sheet').classList.remove('show');
    follow = false; zoomAround(); $('#btn-center').classList.add('show'); clearTimeout(recenterTimer); recenterTimer = setTimeout(recenter, 25000);
    map.easeTo({ center: ll(lm.pos), zoom: Math.max(16.2, map.getZoom()), duration: 900 });
    setTimeout(() => showLandmarkInfo(lm), 950);
  }
  // ---------------- Avisos útiles (pocos) ----------------
  // Con la app abierta, un aviso en pantalla; con el móvil en el bolsillo, una notificación del sistema.
  const LN = () => (isNative && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications) || null;
  let lnAsked = false;
  async function askNotifyPermission() {
    const L = LN(); if (!L || lnAsked) return; lnAsked = true;
    try { const p = await L.checkPermissions(); if (p.display !== 'granted') await L.requestPermissions(); } catch (e) {}
  }
  function notify(title, body, kind = 'gold') {
    const L = LN();
    if (L && document.hidden) L.schedule({ notifications: [{ id: Math.floor(Date.now() % 2e9), title, body, schedule: { at: new Date(Date.now() + 500) } }] }).catch(() => {});
    else toast(`<b>${title}</b> ${body}`, kind, 5000);
  }
  const once = (key) => { const s = S(), d = PM.today(); s.notified = s.notified || {}; if (s.notified[key] === d) return false; s.notified[key] = d; PM.state.save(); return true; };
  // racha: si llevas días seguidos y hoy aún no has salido, aviso a las 20:30
  async function scheduleStreakReminder() {
    const L = LN(); if (!L) return;
    try { await L.cancel({ notifications: [{ id: 7001 }] }); } catch (e) {}
    const st = S().stats || {}, streak = st.streak || 0;
    if (!streak || st.lastDay === PM.today()) return;
    const at = new Date(); at.setHours(20, 30, 0, 0);
    if (at <= new Date()) return;
    try { await L.schedule({ notifications: [{ id: 7001, title: `🔥 Tu racha de ${streak} día${streak > 1 ? 's' : ''} termina hoy`, body: 'Sal a pintar un ratito para no perderla.', schedule: { at } }] }); } catch (e) {}
  }
  // imprescindible cerca (≤ 200 m, una vez al día cada uno)
  function checkNearMust(p) {
    if (!session || session.paused) return;
    for (const id in W.landmarks) {
      const lm = W.landmarks[id];
      if (!lm.must || S().landmarks[id]) continue;
      const d = PM.geo.dist(p, lm.pos);
      if (d > 40 && d <= 200 && once('must:' + id)) notify('⭐ Imprescindible cerca', `${lm.name} está a ${Math.round(d / 10) * 10} m. ¡Vale el doble!`);
    }
  }
  // barrio a punto de conquistarse o de subir de rango (a menos de un 3 %)
  function checkBarrioNear(id, pr, B) {
    if (!session || !B || !B.name) return;
    const conq = !!S().conqueredB[id], rk = conq ? rankOf(id) : -1;
    const next = conq ? PM.RANK_MIN.barrio[rk + 1] : PM.CONQ.barrio;
    if (!next || pr >= next) return;
    const left = next - pr;
    if (left <= 0.03 && once('bar:' + id + ':' + next)) {
      const goal = conq ? `la ${PM.RANKS[rk + 1].name.toLowerCase()} ${PM.RANKS[rk + 1].ic}` : 'conquistarlo 🚩';
      notify(`🎯 ${B.name}`, `Te falta un ${Math.max(1, Math.round(left * 100))} % para ${goal}.`);
    }
  }

  // ---------------- Historial del barrio ----------------
  // Cuándo lo empezaste, cuándo lo conquistaste y cada rango, cuánto tardaste, sus lugares y tu mejor paseo allí.
  function barrioInfo(id) {
    const s = S(), B = W.barrios[id], card = (s.barrioCards || {})[id];
    const name = (B && B.name) || (card && card.name) || (s.barrioNames || {})[id] || 'Barrio';
    // caja del barrio: la de sus calles cargadas o la de su cromo
    let box = B && B.bbox ? B.bbox.slice() : null;
    if (!box && card && card.lines) { let a = 90, b = -90, l = 180, r = -180; card.lines.forEach((ln) => ln.forEach((q) => { a = Math.min(a, q[0]); b = Math.max(b, q[0]); l = Math.min(l, q[1]); r = Math.max(r, q[1]); })); box = [a, l, b, r]; }
    const inBarrio = (q) => {
      if (!box || q[0] < box[0] || q[0] > box[2] || q[1] < box[1] || q[1] > box[3]) return false;
      if (B) { const bb = W.barrioAt(q); return !!bb && bb.id === id; }
      return true;
    };
    // paseos que pasaron por él (con cuántos puntos dentro)
    const walks = [];
    for (const w of s.walks || []) {
      let n = 0; const tr = w.track || [];
      for (let i = 0; i < tr.length; i += 3) if (tr[i] && inBarrio(tr[i])) n++;
      if (n >= 2) walks.push([w, n]);
    }
    walks.sort((x, y) => x[0].start - y[0].start);
    const best = walks.slice().sort((x, y) => y[1] - x[1])[0];
    const first = walks[0] ? walks[0][0].start : null;
    const conq = (s.conqueredB || {})[id] || null;
    const rk = conq ? rankOf(id) : -1, rt = (s.barrioRankT || {})[id] || {};
    const pr = B && W.barrioComplete(id) ? G.barrioProgress(id) : null;
    let paintedM = 0, totalM = B ? B.total : 0;
    if (B) for (const pc of B.pieces) if (!pc.trail && s.painted[pc.id]) paintedM += pc.len;
    const places = Object.entries(s.landmarks || {}).filter(([, v]) => v.barrio === name).map(([lid, v]) => Object.assign({ id: lid }, v)).sort((a, b) => a.t - b.t);
    const totalPlaces = Object.values(W.landmarks).filter((l) => { const bb = B && W.barrioAt(l.pos); return bb && bb.id === id; }).length;
    return { id, name, B, card, box, walks, best, first, conq, rk, rt, pr, paintedM, totalM, places, totalPlaces, perfect: (s.perfectB || {})[id] };
  }
  function showBarrioHistory(id) {
    if (!id) return;
    const I = barrioInfo(id), s = S();
    const fmtD = (t) => new Date(t).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
    const span = (a, b) => { const d = Math.max(0, Math.round((b - a) / 86400000)); return d === 0 ? 'el mismo día' : d === 1 ? 'en 1 día' : `en ${d} días`; };
    // línea de tiempo
    const ev = [];
    if (I.first) ev.push([I.first, '🎨', 'Primer paseo por el barrio', I.walks[0] ? PM.fmtDist(I.walks[0][0].st.walked || 0) + ' andados ese día' : '']);
    I.places.slice(0, 6).forEach((p) => ev.push([p.t, p.emoji || '📍', `Capturaste ${esc(p.name)}`, p.must ? '⭐ imprescindible' : (W.RARITY[p.rarity] || {}).label || '']));
    if (I.conq) ev.push([I.conq, '🥉', 'Conquistado · Bronce', I.first && I.first <= I.conq ? 'Lo conseguiste ' + span(I.first, I.conq) + ' después de empezar' : '60 % de sus calles']);
    [[1, '🥈', 'Rango Plata', '80 % de sus calles'], [2, '🥇', 'Rango Oro', '90 % de sus calles'], [3, '🏆', 'Rango Leyenda', '100 % y todos sus lugares']].forEach(([r, ic, t, d]) => { if (I.rt[r]) ev.push([I.rt[r], ic, t, d]); else if (I.rk >= r && r < 3 && !I.rt[r]) ev.push([null, ic, t, d + ' (antes de guardar fechas)']); });
    if (I.perfect) ev.push([I.perfect, '💯', 'Pintado al 100 %', 'Todas sus calles']);
    ev.sort((a, b) => (a[0] || 9e15) - (b[0] || 9e15));
    const pctTxt = I.pr != null ? (I.pr * 100).toFixed(1) + ' %' : '—';
    const next = I.pr == null ? null : I.conq ? PM.RANK_MIN.barrio[I.rk + 1] : PM.CONQ.barrio;
    const R = I.rk >= 0 ? PM.RANKS[I.rk] : null;
    let html = `<div class="bh-head" style="--rk:${R ? R.color : 'var(--accent)'}">
        <div class="bh-sil">${barrioSilhouette(I)}</div>
        <div class="bh-t"><small>${R ? R.ic + ' ' + R.name : I.pr != null ? 'En conquista' : 'Barrio'}</small><b>${esc(I.name)}</b>
          <div class="bh-pct"><i style="width:${I.pr != null ? Math.min(100, I.pr * 100).toFixed(1) : 0}%"></i><em style="left:60%"></em><em style="left:80%"></em><em style="left:90%"></em></div>
          <small>${pctTxt} pintado${next && I.pr != null && I.pr < next ? ` · ${Math.round((next - I.pr) * 100)} % para ${I.conq ? PM.RANKS[I.rk + 1].name.toLowerCase() : 'conquistarlo'}` : ''}</small></div></div>
      <div class="pf-grid bh-stats">
        <div class="pf-tile"><span>🖌️</span><b>${I.B ? PM.fmtDist(I.paintedM) : '—'}</b><small>de ${I.B ? PM.fmtDist(I.totalM) : '?'}</small></div>
        <div class="pf-tile"><span>🥾</span><b>${I.walks.length}</b><small>paseos por él</small></div>
        <div class="pf-tile"><span>🏛️</span><b>${I.places.length}${I.totalPlaces ? '/' + I.totalPlaces : ''}</b><small>lugares</small></div>
      </div>`;
    html += `<h4>Su historia</h4><div class="bh-tl">${ev.length ? ev.map(([t, ic, tt, d]) => `<div class="bh-ev"><span>${ic}</span><div><b>${tt}</b><small>${t ? fmtD(t) : ''}${d ? (t ? ' · ' : '') + d : ''}</small></div></div>`).join('') : '<p class="muted">Aún no has pasado por aquí. ¡Empieza su historia!</p>'}</div>`;
    if (I.best) { const w = I.best[0]; html += `<h4>Tu mejor paseo aquí</h4><button class="pf-rec bh-best" data-walk="${w.id}"><span>🥇</span><div><small>${fmtD(w.start)} · ${PM.fmtDist(w.st.walked || 0)} · +${PM.fmtNum(w.st.pts || 0)} pts</small><b>Ver estadísticas y vídeo</b></div><em>›</em></button>`; }
    openSheet('🏘️ ' + I.name, html);
    const bb = document.querySelector('.bh-best'); if (bb) bb.addEventListener('click', () => openWalk(S().walks.find((w) => w.id === bb.dataset.walk)));
  }
  // dibujo del barrio: sus calles (gris) y lo que has pintado (tu color); sin calles cargadas, la silueta del cromo
  function barrioSilhouette(I) {
    const S0 = 120, pad = 8, lines = [], s = S();
    if (I.B) for (const pc of I.B.pieces) lines.push([pc.pts, !!s.painted[pc.id], pc.trail]);
    else if (I.card && I.card.lines) I.card.lines.forEach((l) => lines.push([l, true]));
    if (!lines.length) return '<div class="bh-empty">🏘️</div>';
    let a = 90, b = -90, l = 180, r = -180;
    lines.forEach(([pts]) => pts.forEach((q) => { a = Math.min(a, q[0]); b = Math.max(b, q[0]); l = Math.min(l, q[1]); r = Math.max(r, q[1]); }));
    const k = Math.cos((a + b) / 2 * Math.PI / 180), sx = Math.max(1e-6, (r - l) * k), sy = Math.max(1e-6, b - a), sc = (S0 - pad * 2) / Math.max(sx, sy);
    const ox = (S0 - sx * sc) / 2, oy = (S0 - sy * sc) / 2;
    const P = (q) => (ox + (q[1] - l) * k * sc).toFixed(1) + ',' + (oy + (b - q[0]) * sc).toFixed(1);
    const grey = lines.filter((x) => !x[1]).map(([pts, , tr]) => `<polyline points="${pts.map(P).join(' ')}" stroke="${tr ? '#c8b98f' : '#cbd2dc'}" stroke-width="${tr ? 0.8 : 1.2}" fill="none" stroke-linecap="round"/>`).join('');
    const col = lines.filter((x) => x[1]).map(([pts]) => `<polyline points="${pts.map(P).join(' ')}" stroke="${s.color}" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
    return `<svg viewBox="0 0 ${S0} ${S0}" width="${S0}" height="${S0}">${grey}${col}</svg>`;
  }
  $('#hud .barrio').addEventListener('click', () => showBarrioHistory(curBarrio));

  // ---------------- Copia de seguridad en archivo ----------------
  async function exportBackup() {
    const s = S(), msg = $('#bk-msg');
    if (msg) msg.textContent = '⏳ Preparando la copia…';
    const photos = {};
    for (const id of Object.keys(s.cardPhotos || {})) { try { const p = await PM.cards.getPhoto(id); if (p) photos[id] = p; } catch (e) {} }
    s.backupT = Date.now(); PM.state.save();
    const save = Object.assign({}, s); delete save.session;
    const data = { app: 'PintaMapa', version: PM.VERSION.app, player: PM.player ? PM.player.name : '', t: Date.now(), save, photos };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const name = `PintaMapa-${(PM.player ? PM.player.slug : 'partida')}-${new Date().toISOString().slice(0, 10)}.json`;
    await PM.need('lib/mp4-muxer.js', 'js/replay.js');
    await PM.replay.save(blob, name, 'Copia de PintaMapa');
    if (msg) msg.textContent = `✅ Copia lista (${(blob.size / 1048576).toFixed(1)} MB). Guárdala en tu Drive, correo o donde quieras.`;
  }
  function importBackup() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      try {
        const d = JSON.parse(await f.text());
        if (d.app !== 'PintaMapa' || !d.save) throw new Error('Este archivo no es una copia de PintaMapa');
        if (!confirm(`¿Importar la copia de «${d.player || '?'}» del ${new Date(d.t).toLocaleString('es-ES')}? Se sumará a tu partida actual (no se borra nada).`)) return;
        const cur = S(), merged = PM.merge(d.save, cur);
        PM.state.replace(Object.assign({}, merged, { session: cur.session, pendingGeo: Object.assign({}, d.save.pendingGeo || {}, cur.pendingGeo || {}) }));
        for (const [id, img] of Object.entries(d.photos || {})) { try { await PM.cards.putPhoto(id, img); } catch (e) {} }
        toast('✅ Copia importada. Recargando…', 'ok');
        setTimeout(() => location.reload(), 1200);
      } catch (e) { toast('❌ ' + (e.message || e), 'warn', 5000); }
    };
    inp.click();
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
      photo: '📷 Fotos de cromos', rank: '🏅 Rangos de barrio', shiny: '✨ Cartas brillantes', can: '🪣 Botes (antiguos)', bones: '🦴 Huesos (antiguos)', mystery: '🕵️ Calles misteriosas (antiguas)', otros: '✨ Otros' };
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
        <li>🖌️ <b>Pintar calle nueva</b>: 10 pts cada 12 m · el combo multiplica hasta ×3 · junto a un lugar ×2</li>
        <li>📸 <b>Capturar un lugar</b>: 100 (común) · 200 (raro) · 300 (épico) · 500 (legendario)</li>
        <li>⭐ <b>Imprescindibles</b> de cada ciudad: valen el doble · ✨ <b>carta brillante</b> (1 de cada 50): el doble otra vez</li>
        <li>🔁 <b>Volver a un lugar</b> (cada día): +20 % de sus puntos</li>
        <li>🚩 <b>Conquistar un barrio</b> (60 %, bronce): +2.000 · plata (80 %) +1.000 · oro (90 %) +1.500 · al 100 %: +1.000 · 🏆 leyenda (100 % y todos sus lugares): +3.000</li>
        <li>👑 <b>Conquistar una ciudad</b> (70 %, bronce): +25.000 · plata (80 %) +10.000 · oro (90 %) +15.000</li>
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

  // ---------------- Logros: agrupados por categoría, con barra de progreso y «casi lo tienes» ----------------
  const ACH_CATS = [
    { id: 'pin', name: 'Pintar y andar', ic: '🖌️', re: /^(primera_brocha|km\d|pinta|anda|sendero|habitual|largo|paseos|horas|combo)/ },
    { id: 'lug', name: 'Lugares y cartas', ic: '🏛️', re: /^(primer_sello|coleccionista|enciclopedia|peregrino|alcalde|leyenda$|captura|k[a-z]|legend|epico|raro|brillo|imprescindible|fiel|colec|fotografo|reportero|fotos)/ },
    { id: 'bar', name: 'Barrios y ciudades', ic: '🚩', re: /^(conquistador|senor_barrios|perfeccionista|rey_ciudad|barrios|perfecto|reyes|plata|oro|ciudadplata|ciudadoro|leyendab|viajero)/ },
    { id: 'con', name: 'Constancia', ic: '🔥', re: /^(madrugador|noctambulo|racha|dias)/ },
    { id: 'niv', name: 'Nivel y puntos', ic: '⭐', re: /^(nivel|puntos)/ },
  ];
  let achOpen = null;
  function panelAchievements() {
    const s = S(), all = Object.entries(G.ACHIEVEMENTS), got = s.achievements || {};
    const n = all.filter(([id]) => got[id]).length;
    const prog = (a) => { try { return a.prog ? a.prog(s) : 0; } catch (e) { return 0; } };
    const catOf = (id) => (ACH_CATS.find((c) => c.re.test(id)) || { id: 'otr' }).id;
    const groups = {}; all.forEach(([id, a]) => (groups[catOf(id)] = groups[catOf(id)] || []).push([id, a]));
    const cats = ACH_CATS.concat([{ id: 'otr', name: 'Otros', ic: '🎖️' }]).filter((c) => groups[c.id]);
    const near = all.filter(([id, a]) => !got[id] && prog(a) >= 0.4 && prog(a) < 1).sort((x, y) => prog(y[1]) - prog(x[1])).slice(0, 5);
    const stamp = ([id, a]) => { const p = got[id] ? 1 : prog(a); return `<div class="stamp ach ${got[id] ? '' : 'locked'}"><div>${got[id] ? a.icon : '🔒'}</div><b>${a.name}</b><small>${a.desc}</small>${!got[id] && p > 0 ? `<i class="ach-bar"><em style="width:${Math.round(p * 100)}%"></em></i>` : ''}</div>`; };
    let html = `<div class="ach-top"><div class="ach-ring" style="--p:${(n / all.length * 100).toFixed(1)}"><b>${n}</b><small>de ${all.length}</small></div><p>Logros conseguidos. Toca una categoría para verla.</p></div>`;
    if (near.length) html += `<h4>🎯 Casi lo tienes</h4>` + near.map(([id, a]) => `<div class="mission"><div class="mt">${a.icon} ${a.name}<span>${Math.round(prog(a) * 100)} %</span></div><div class="bar"><i style="width:${Math.round(prog(a) * 100)}%"></i></div><small>${a.desc}</small></div>`).join('');
    html += cats.map((c) => { const L = groups[c.id], g = L.filter(([id]) => got[id]).length; return `<details class="ach-cat" data-c="${c.id}" ${achOpen === c.id ? 'open' : ''}><summary><span>${c.ic}</span><b>${c.name}</b><em>${g}/${L.length}</em><i class="ach-bar"><em style="width:${Math.round(g / L.length * 100)}%"></em></i></summary>
      <div class="grid">${L.slice().sort((x, y) => (!!got[y[0]] - !!got[x[0]]) || prog(y[1]) - prog(x[1])).map(stamp).join('')}</div></details>`; }).join('');
    openSheet(`🏆 Logros ${n}/${all.length}`, html);
    document.querySelectorAll('.ach-cat').forEach((d) => d.addEventListener('toggle', () => { if (d.open) { achOpen = d.dataset.c; document.querySelectorAll('.ach-cat').forEach((o) => { if (o !== d) o.open = false; }); } }));
  }

  // ---------------- Perfil: cabecera + accesos rápidos + pestañas (Resumen · Récords · Ciudades · Ajustes) ----------------
  let profTab = 'res';
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function profileData() {
    const s = S(), st = s.stats, walks = (s.walks || []).slice();
    const DAY = 86400000, dk = (t) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    const days = {};
    walks.forEach((w) => { const k = dk(w.start), d = days[k] || (days[k] = { walked: 0, painted: 0 }); d.walked += w.st.walked || 0; d.painted += w.st.painted || 0; });
    let maxStreak = 0, cur = 0, prev = null;
    Object.keys(days).sort().forEach((k) => { const t = new Date(k + 'T12:00').getTime(); cur = prev != null && Math.round((t - prev) / DAY) === 1 ? cur + 1 : 1; maxStreak = Math.max(maxStreak, cur); prev = t; });
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    const mon = t0.getTime() - ((t0.getDay() + 6) % 7) * DAY;
    const wk = walks.filter((w) => w.start >= mon);
    const sum = (ws, f) => ws.reduce((x, w) => x + (f(w) || 0), 0);
    const best = (f) => walks.slice().sort((x, y) => f(y) - f(x))[0];
    const timed = walks.filter((w) => (w.st.walked || 0) > 500);
    const fastest = timed.slice().sort((x, y) => PM.movingMs(x) / x.st.walked - PM.movingMs(y) / y.st.walked)[0];
    const bestDay = Object.entries(days).sort((x, y) => y[1].painted - x[1].painted)[0];
    const lms = Object.values(s.landmarks || {});
    const byR = ['legendario', 'epico', 'raro', 'comun'].map((r) => ({ r, n: lms.filter((l) => l.rarity === r).length }));
    const nAch = Object.keys(s.achievements || {}).filter((k) => G.ACHIEVEMENTS[k]).length;
    const first = walks.length ? Math.min(...walks.map((w) => w.start)) : null;
    return { s, st, walks, days, maxStreak: Math.max(maxStreak, st.streak || 0), wk, sum, best, fastest, bestDay, lms, byR, nAch, first,
      movAll: sum(walks, (w) => PM.movingMs(w)), movWk: sum(wk, (w) => PM.movingMs(w)) };
  }
  function panelProfile() {
    const D = profileData(), s = D.s, st = D.st, lp = G.levelProgress();
    const pace = (ms, m) => { if (!m || m < 50) return '—'; const sec = ms / 1000 / (m / 1000); return Math.floor(sec / 60) + ':' + String(Math.round(sec % 60)).padStart(2, '0') + ' /km'; };
    const dur = (ms) => { const m = Math.round(ms / 60000); return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min'; };
    const tile = (ic, v, l, act) => `<div class="pf-tile" ${act ? `data-act="${act}"` : ''}><span>${ic}</span><b>${v}</b><small>${l}</small></div>`;
    const card = (title, inner, extra) => `<div class="pf-card"><h5>${title}${extra ? `<span>${extra}</span>` : ''}</h5>${inner}</div>`;
    const RC = { comun: '#9aa4b2', raro: '#3fa9ff', epico: '#b65cff', legendario: '#ffb700' };
    // cabecera
    let html = `<div class="pf-head">
      <div class="av-wrap">${FUN ? FUN.avatarHTML('avatar') : `<div class="avatar" style="background:${s.color}">🖌️</div>`}<button id="av-edit" class="av-edit" aria-label="Cambiar foto de perfil">📷</button></div>
      <div class="pf-who"><h2>${PM.player ? PM.player.name : 'Pintor'}</h2>
        <button class="pf-lvl" id="pf-lvl">${lp.tier ? lp.tier.icon + ' ' : '⭐ '}Nivel ${lp.label} ›</button>
        <div class="pf-xp"><i style="width:${(lp.pct * 100).toFixed(1)}%"></i></div>
        <small>${PM.fmtNum(s.xp)} pts · ${lp.max ? '¡nivel máximo!' : `faltan ${PM.fmtNum(lp.need - lp.cur)} para el ${lp.nextLabel}`}</small>
        ${D.first ? `<small class="pf-since">Pintando desde ${new Date(D.first).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })} · 🔥 ${st.streak || 0} día${st.streak === 1 ? '' : 's'} de racha</small>` : ''}</div></div>
      <div class="pf-quick">
        <button data-go="walks"><span>🥾</span>Paseos</button><button data-go="album"><span>🃏</span>Cromos</button>
        <button data-go="ach"><span>🏆</span>Logros</button><button data-go="week"><span>📽️</span>Mi semana</button>
      </div>
      <div class="pf-tabs">${[['res', 'Resumen'], ['rec', 'Récords'], ['cit', 'Ciudades'], ['aj', 'Ajustes']].map(([k, l]) => `<button data-tab="${k}" class="${profTab === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;

    if (profTab === 'res') {
      html += `<button class="pf-week" id="pf-week"><span>📽️</span><div><b>Tu semana en vídeo</b><small>Resumen animado de los últimos 7 días para compartir</small></div><em>▶</em></button>`;
      html += `<button class="pf-week pf-poster" id="pf-poster"><span>🖼️</span><div><b>Póster de tu mapa</b><small>Tu ciudad pintada en alta resolución, para imprimir o compartir</small></div><em>▶</em></button>`;
      html += card('📅 Esta semana', `<div class="pf-grid">${tile('🚶', PM.fmtDist(D.sum(D.wk, (w) => w.st.walked)), 'andados')}${tile('🖌️', PM.fmtDist(D.sum(D.wk, (w) => w.st.painted)), 'calles nuevas')}${tile('⏱️', dur(D.movWk), 'en movimiento')}</div>`,
        `${D.wk.length} paseo${D.wk.length === 1 ? '' : 's'}`);
      html += card('📈 En total', `<div class="pf-grid">
        ${tile('🖌️', PM.fmtDist(st.paintedM), 'pintados')}${tile('🚶', PM.fmtDist(st.walkedM), 'caminados')}${tile('🗓️', D.walks.length, 'paseos')}
        ${tile('⏱️', dur(D.movAll), 'en movimiento')}${tile('⚡', pace(D.movAll, D.sum(D.walks, (w) => w.st.walked)), 'ritmo medio')}${tile('📆', Object.keys(D.days).length, 'días activos')}
        ${tile('🌲', PM.fmtDist(st.trailM || 0), 'senderos')}${tile('♻️', Object.keys(s.heat || {}).length, 'tramos repetidos')}${tile('👣', PM.fmtNum(Math.round((st.walkedM || 0) / 0.75)), 'pasos aprox.')}</div>`);
      html += card('🏆 Conquistas', `<div class="pf-grid">
        ${tile('🚩', Object.keys(s.conqueredB || {}).length, 'barrios', 'cit')}${tile('👑', Object.keys(s.citiesWon || {}).length, 'ciudades', 'cit')}${tile('🏛️', D.lms.length, 'lugares', 'album')}
        ${tile('🏅', D.nAch + '/' + Object.keys(G.ACHIEVEMENTS).length, 'logros', 'ach')}${tile('📸', Object.keys(s.cardPhotos || {}).length, 'cartas con foto', 'album')}${tile('🗂️', Object.keys(s.setsDone || {}).length, 'colecciones', 'album')}</div>
        ${D.lms.length ? `<div class="pf-rar">${D.byR.filter((x) => x.n).map((x) => `<i style="flex:${x.n};background:${RC[x.r]}"></i>`).join('')}</div>
        <div class="pf-leg">${D.byR.map((x) => `<span><i style="background:${RC[x.r]}"></i>${W.RARITY[x.r].label} ${x.n}</span>`).join('')}</div>` : ''}`);
      html += card('🎨 Color de tu pintura', `<div class="colors">` + G.COLORS.map((c) => {
        const locked = lp.level < c.lvl;
        return `<button class="color ${s.color === c.c ? 'sel' : ''}" ${locked ? 'disabled' : ''} data-c="${c.c}" style="background:${c.c}" title="${c.name}">${locked ? '🔒' + c.lvl : ''}</button>`;
      }).join('') + '</div>', 'se desbloquean subiendo de nivel');
    }
    if (profTab === 'rec') {
      const when = (w) => w ? new Date(w.start).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: '2-digit' }) : '';
      const rec = (ic, l, v, w) => `<div class="pf-rec" ${w ? `data-walk="${w.id}"` : ''}><span>${ic}</span><div><small>${l}</small><b>${v}</b></div><em>${w ? when(w) + ' ›' : ''}</em></div>`;
      const L = D.best((w) => w.st.walked || 0), P = D.best((w) => w.st.painted || 0), T = D.best((w) => w.elapsed || 0), X = D.best((w) => w.st.pts || 0), C = D.best((w) => w.st.captures || 0);
      html += card('🥇 Tus mejores marcas', D.walks.length ? `
        ${rec('🥾', 'Paseo más largo', PM.fmtDist(L.st.walked), L)}
        ${rec('🖌️', 'Más calles nuevas en un paseo', PM.fmtDist(P.st.painted), P)}
        ${D.fastest ? rec('⚡', 'Ritmo más rápido', pace(PM.movingMs(D.fastest), D.fastest.st.walked), D.fastest) : ''}
        ${rec('⏱️', 'Paseo más largo en tiempo', dur(T.elapsed), T)}
        ${rec('⭐', 'Más puntos en un paseo', '+' + PM.fmtNum(X.st.pts || 0), X)}
        ${C && C.st.captures ? rec('🏛️', 'Más lugares en un paseo', C.st.captures, C) : ''}
        ${D.bestDay ? rec('📅', 'Mejor día', PM.fmtDist(D.bestDay[1].painted) + ' pintados · ' + new Date(D.bestDay[0] + 'T12:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })) : ''}
        ${rec('🔥', 'Racha más larga', D.maxStreak + ' días')}
        ${rec('✖️', 'Mejor combo', 'x' + (st.bestCombo || 0))}` : '<p class="muted">Aún no hay paseos de más de 2 minutos.</p>', 'toca uno para verlo');
    }
    if (profTab === 'cit') {
      const cities = {};
      for (const k in s.tileNames) { const c = s.tileNames[k].city; if (c) cities[c] = true; }
      const cl = Object.keys(cities).map((c) => [c, G.cityProgress(c)]).sort((x, y) => y[1].painted - x[1].painted);
      html += card('🏙️ Tus ciudades', cl.length ? cl.map(([c, cp]) => `<div class="mission"><div class="mt">${s.citiesWon[c] ? PM.RANKS[(s.cityRank || {})[c] || 0].ic : '🏙️'} ${esc(c)}<span>${(cp.pct * 100).toFixed(2)} %</span></div>
          <div class="bar"><i style="width:${Math.min(100, cp.pct / PM.CONQ.city * 100)}%"></i></div>
          <small>${PM.fmtDist(cp.painted)} de ${cp.total ? PM.fmtDist(cp.total) : '?'} · ${(() => { const rk = PM.rankFor('city', cp.pct), nx = PM.RANK_MIN.city[rk + 1]; return (rk >= 0 ? `${PM.RANKS[rk].ic} ${PM.RANKS[rk].name} · ` : '') + (nx ? 'faltan ' + (cp.total ? PM.fmtDist(Math.max(0, cp.total * nx - cp.painted)) : '?') + ` para ${Math.round(nx * 100)} %` : '¡oro conseguido!'); })()}</small></div>`).join('') : '<p class="muted">Sal a pintar y aquí verás tus ciudades.</p>', 'conquista 70 % · plata 80 · oro 90');
      const bc = Object.entries(s.barrioCards || {}).map(([id, v]) => Object.assign({ id }, v)).sort((x, y) => y.t - x.t);
      html += card('🏅 Barrios conquistados', bc.length ? bc.map((b) => { const rk = b.id != null ? rankOf(b.id) : 0; return `<div class="row bh-row" data-bid="${esc(b.id)}"><span>${RANKS[rk].ic} ${esc(b.name)} <small class="muted">· ${RANKS[rk].name}</small></span><small class="muted">${new Date(b.t).toLocaleDateString('es-ES')} ›</small></div>`; }).join('') : '<p class="muted">Pinta el 60 % de las calles de un barrio para conquistarlo (80 % plata, 90 % oro).</p>', bc.length || '');
    }
    if (profTab === 'aj') {
      if (PM.isNative && PM.profile === 'real') {
        const has = !!PM.cloud.password();
        html += card('☁️ Mi cuenta en la nube', `
          <p class="muted">Tu progreso se guarda <b>cifrado con tu contraseña</b>. Con tu pintor (<b>${PM.player ? esc(PM.player.name) : ''}</b>) y la contraseña lo ves en <b>luzferlux77.github.io/pintamapa-app/progreso.html</b></p>
          ${PM.cloud.hasKey() ? '' : '<p class="err">Esta versión no trae la clave de la nube: actualiza la app.</p>'}
          <input id="cl-pass" type="password" placeholder="${has ? 'Contraseña guardada ✓ (escribe otra para cambiarla)' : 'Inventa una contraseña de pintor (mín. 4)'}" autocomplete="new-password">
          <button class="btn on" id="cl-go">☁️ ${has ? 'Guardar en la nube ahora' : 'Activar y guardar'}</button>
          <p class="muted" id="cl-msg">${s.syncedAt ? 'Último guardado: ' + new Date(s.syncedAt).toLocaleString('es-ES') : 'Aún no guardado en la nube.'}${Object.keys(s.pendingGeo || {}).length ? ' · ' + Object.keys(s.pendingGeo).length + ' tramos pendientes' : ''}</p>
          <p class="muted">⚠️ Apúntala: si la olvidas no se puede recuperar.</p>`);
      } else if (!PM.isNative) {
        html += card('📊 Tu progreso real', `<p class="muted">Lo que pintas con el móvil por la calle (separado de esta partida de prueba).</p>
          <a class="btn on" href="progreso.html" target="_blank" style="display:inline-block;text-decoration:none">📊 Abrir «Mi progreso»</a>`);
      }
      html += card('⚙️ Preferencias', `
        <label class="row"><span>🔊 Sonido</span><input type="checkbox" class="sw" id="opt-sound" ${PM.sound.enabled ? 'checked' : ''}></label>
        <label class="row"><span>🌙 Tema oscuro</span><input type="checkbox" class="sw" id="opt-dark" ${s.theme === 'dark' ? 'checked' : ''}></label>`);
      html += card('💾 Copia de seguridad', `<p class="muted">Guarda TODA tu partida (con tus fotos de cromos) en un archivo, por si cambias de móvil o falla la nube. Al importarla se <b>suma</b> a lo que tengas: no se pierde nada.</p>
        <div class="seg"><button class="btn on" id="bk-exp">💾 Exportar copia</button><button class="btn" id="bk-imp">📂 Importar copia</button></div><p class="muted" id="bk-msg">${s.backupT ? 'Última copia: ' + new Date(s.backupT).toLocaleString('es-ES') : 'Aún no has hecho ninguna copia.'}</p>`);
      html += card('📴 Mapa sin conexión', `<p class="muted">Descarga tu zona para ver el mapa y pintar sin cobertura (metro, montaña, viajes). Lo que ya has visto también se guarda solo.</p>
        <div class="seg"><button class="btn on" id="off-dl" data-km="3">⬇️ Mi zona (3 km)</button><button class="btn" id="off-dl2" data-km="6">⬇️ Mi ciudad (6 km)</button></div><p class="muted" id="off-msg">Calculando lo guardado…</p>`);
      html += card('🥾 Paseos y reloj', `<p class="muted">Estadísticas, vídeo del recorrido, exportar a GPX/KML/KMZ e importar desde un reloj.</p>
        <button class="btn" id="opt-walks">🥾 Ver mis paseos (${D.walks.length})</button>`);
      html += card('🔄 Versión', `<p class="muted">PintaMapa <b>v${PM.VERSION.app}</b> · ${(PM.update.status() || {}).msg || 'Se busca actualización al abrir la app.'}</p>
        ${PM.isNative ? '<button class="btn" id="opt-upd">🔄 Buscar actualización ahora</button>' : ''}
        <p class="muted">Perfil: <b>${PM.profile === 'real' ? '📡 Real' : '🕹️ Prueba'}</b> · Mapas y calles © OpenStreetMap</p>`);
      html += `<div class="pf-danger"><button class="btn danger" id="opt-reset">🗑️ Borrar partida</button></div>`;
    }
    openSheet('👤 Perfil', html);
    // cabecera y navegación
    const avEdit = () => FUN && FUN.changeAvatar().then((ok) => { if (ok) panelProfile(); });
    $('#av-edit') && $('#av-edit').addEventListener('click', avEdit);
    $('.av-wrap .avatar') && $('.av-wrap .avatar').addEventListener('click', avEdit);
    if (S().avatar) { const d = document.createElement('button'); d.className = 'av-del'; d.textContent = 'Quitar foto'; d.addEventListener('click', () => { FUN.removeAvatar(); panelProfile(); }); $('.av-wrap').appendChild(d); }
    $('#pf-lvl').addEventListener('click', panelLevel);
    $('#pf-week') && $('#pf-week').addEventListener('click', openWeek);
    $('#pf-poster') && $('#pf-poster').addEventListener('click', () => PM.need('lib/mp4-muxer.js', 'js/replay.js', 'js/poster.js').then(() => PM.poster.open({ S, W })));
    const go = { walks: panelWalks, album: panelAlbum, ach: panelAchievements, week: openWeek, cit: () => { profTab = 'cit'; panelProfile(); } };
    document.querySelectorAll('.pf-quick [data-go]').forEach((b) => b.addEventListener('click', () => go[b.dataset.go]()));
    document.querySelectorAll('.pf-tile[data-act]').forEach((b) => b.addEventListener('click', () => go[b.dataset.act]()));
    document.querySelectorAll('.pf-tabs [data-tab]').forEach((b) => b.addEventListener('click', () => { profTab = b.dataset.tab; panelProfile(); }));
    document.querySelectorAll('.pf-rec[data-walk]').forEach((r) => r.addEventListener('click', () => openWalk(S().walks.find((w) => w.id === r.dataset.walk))));
    document.querySelectorAll('.bh-row[data-bid]').forEach((r) => r.addEventListener('click', () => showBarrioHistory(r.dataset.bid)));
    // pestañas
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
    if ($('#opt-upd')) $('#opt-upd').addEventListener('click', async () => {
      $('#opt-upd').textContent = '⏳ Buscando…';
      await PM.update.check(true, toast);
      panelProfile();
    });
    $('#opt-sound') && $('#opt-sound').addEventListener('change', (e) => { PM.sound.enabled = e.target.checked; });
    $('#opt-dark') && $('#opt-dark').addEventListener('change', (e) => { s.theme = e.target.checked ? 'dark' : 'light'; PM.state.save(); applyTheme(); });
    $('#opt-walks') && $('#opt-walks').addEventListener('click', panelWalks);
    if ($('#bk-exp')) $('#bk-exp').addEventListener('click', exportBackup);
    if ($('#bk-imp')) $('#bk-imp').addEventListener('click', importBackup);
    if ($('#off-msg')) {
      PM.mapStyle.cacheInfo().then((i) => { const m = $('#off-msg'); if (m) m.textContent = i.n ? `Guardado en el móvil: ${PM.fmtNum(i.n)} piezas de mapa${i.mb ? ' · ' + i.mb.toFixed(0) + ' MB' : ''}` : 'Aún no hay mapa guardado.'; });
      ['#off-dl', '#off-dl2'].forEach((sel) => $(sel).addEventListener('click', async (e) => {
        const km = +e.currentTarget.dataset.km, msg = $('#off-msg');
        document.querySelectorAll('#off-dl, #off-dl2').forEach((b) => { b.disabled = true; });
        try {
          msg.textContent = '⬇️ Descargando calles del juego…';
          const keys = []; const ti = Math.floor(pos[0] / W.TILE), tj = Math.floor(pos[1] / W.TILE), n = km <= 3 ? 2 : 3;   // calles del juego: 25 o 49 zonas (más dejaría el móvil sin memoria)
          for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) keys.push((ti + i) + '_' + (tj + j));
          await W.ensureKeys(keys).catch(() => {});
          const tot = await PM.mapStyle.prefetch(pos, km, curStyle, (d, t) => { msg.textContent = `⬇️ Descargando mapa… ${Math.round(d / t * 100)} % (${d}/${t})`; });
          msg.textContent = `✅ Listo: tu zona (${km} km) está guardada en el móvil (${PM.fmtNum(tot)} piezas). Ya puedes usarla sin cobertura.`;
          toast('📴 Mapa guardado para usar sin conexión', 'ok');
        } catch (er) { msg.textContent = '❌ No se pudo descargar: ' + (er.message || er); }
        finally { document.querySelectorAll('#off-dl, #off-dl2').forEach((b) => { b.disabled = false; }); }
      }));
    }
    $('#opt-reset') && $('#opt-reset').addEventListener('click', () => { if (confirm('¿Seguro? Se perderá todo tu progreso.')) PM.state.reset(); });
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
    const lvl = PM.levelInfo(sv.xp || 0).label;
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

  // ---------------- Pantalla de inicio: tú, tu nivel, tu racha y tus paseos dibujados de fondo ----------------
  function renderHome() {
    const el = $('#hm-hero'); if (!el) return;
    drawHomeArt();
    if (!PM.player || !players.length) { el.innerHTML = ''; return; }
    const s = S(), lp = G.levelProgress(), st = s.stats || {};
    const nB = Object.keys(s.conqueredB || {}).length, nL = Object.keys(s.landmarks || {}).length;
    const today = PM.today(), streak = st.streak || 0;
    const yest = (() => { const d = new Date(Date.now() - 86400000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
    const msg = st.lastDay === today ? '✅ Hoy ya has salido. ¡Bien!' : streak && st.lastDay === yest ? `🔥 Sal hoy para no perder tu racha de ${streak} día${streak > 1 ? 's' : ''}` : 'Cada calle nueva cuenta. ¡A por ellas!';
    el.innerHTML = `<div class="hm-card">
      <div class="hm-me">${FUN ? FUN.avatarHTML('hm-av') : ''}<div class="hm-who"><b>${esc(PM.player.name)}</b><span class="hm-lvl">${lp.tier ? lp.tier.icon + ' ' : '⭐ '}Nivel ${lp.label}</span>
        <div class="pf-xp"><i style="width:${(lp.pct * 100).toFixed(1)}%"></i></div></div></div>
      <div class="hm-stats"><div><b>🔥 ${streak}</b><small>racha</small></div><div><b>${PM.fmtDist(st.paintedM || 0)}</b><small>pintados</small></div><div><b>${nL}</b><small>lugares</small></div><div><b>${nB}</b><small>barrios</small></div></div>
      <button class="btn primary hm-go" id="hm-go">${s.session ? '▶ Seguir con tu paseo' : '▶ Salir a pintar'}</button>
      <p class="hm-msg">${msg}</p></div>`;
    $('#hm-go').addEventListener('click', () => begin());
    $('#who-title').textContent = 'Cambiar de pintor';
    document.querySelector('#intro .who').classList.add('small');
  }
  function drawHomeArt() {
    const cv = $('#hm-art'); if (!cv) return;
    const W0 = innerWidth, H0 = innerHeight, dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = W0 * dpr; cv.height = H0 * dpr; cv.style.width = W0 + 'px'; cv.style.height = H0 + 'px';
    const x = cv.getContext('2d'); x.scale(dpr, dpr);
    const tracks = PM.player ? (S().walks || []).map((w) => (w.track || []).filter(Boolean)).filter((t) => t.length > 1) : [];
    if (!tracks.length) return;
    let a = 90, b = -90, l = 180, r = -180;
    tracks.forEach((t) => t.forEach((q) => { a = Math.min(a, q[0]); b = Math.max(b, q[0]); l = Math.min(l, q[1]); r = Math.max(r, q[1]); }));
    const k = Math.cos((a + b) / 2 * Math.PI / 180), sx = Math.max(1e-6, (r - l) * k), sy = Math.max(1e-6, b - a);
    const sc = Math.min(W0 * 0.9 / sx, H0 * 0.9 / sy), ox = (W0 - sx * sc) / 2, oy = (H0 - sy * sc) / 2;
    x.strokeStyle = S().color || '#2563eb'; x.lineWidth = 3; x.lineJoin = x.lineCap = 'round'; x.globalAlpha = 0.22;
    x.shadowColor = S().color || '#2563eb'; x.shadowBlur = 8;
    tracks.forEach((t) => { x.beginPath(); t.forEach((q, i) => { const px = ox + (q[1] - l) * k * sc, py = oy + (b - q[0]) * sc; i ? x.lineTo(px, py) : x.moveTo(px, py); }); x.stroke(); });
  }
  renderHome();

  // Los paseos de hace más de 30 días se guardan simplificados (mismo dibujo con muchos menos puntos):
  // la partida no crece sin control y el guardado y la nube siguen rápidos.
  function compressOldWalks() {
    const s = S();
    if (s.compressT && Date.now() - s.compressT < 86400000) return;
    const old = Date.now() - 30 * 86400000;
    let before = 0, after = 0;
    for (const w of s.walks || []) {
      if (w.start > old || w.slim || !w.track || w.track.length < 40) continue;
      // antes de quitar puntos se guarda lo que depende de ellos (tiempo en movimiento y distancia exacta)
      w.mov = PM.movingMs(w); w.dist = w.dist || (w.st && w.st.walked) || 0;
      before += w.track.length; w.track = PM.simplifyTrack(w.track, 3); after += w.track.length; w.slim = 1;
    }
    s.compressT = Date.now();
    PM.state.save();
    if (before) console.log(`Paseos antiguos simplificados: ${before} → ${after} puntos`);
  }
  function begin(fromNew) {
    if (fromNew === true) {
      const name = $('#player-name').value.trim();
      if (!nameValid()) { $('#player-name').focus(); return; }
      if (!PM.player || PM.slug(name) !== PM.player.slug) { PM.setPlayer(name); return; }   // recarga con su partida
    }
    if (!PM.player) { showNewBox(true); return; }
    $('#intro').classList.remove('show');
    setTimeout(() => map.resize(), 50);
    // la pantalla de inicio pudo dejar la página desplazada (móviles bajos): el juego siempre pegado arriba
    const unscroll = () => { if (document.body.scrollTop) document.body.scrollTop = 0; if (document.documentElement.scrollTop) document.documentElement.scrollTop = 0; };
    unscroll(); document.body.addEventListener('scroll', unscroll, { passive: true }); window.addEventListener('scroll', unscroll, { passive: true });
    PM.sound._ctx();
    G.ensureDaily();
    if (PM.fillLandmarkCities(S()) + W.fixRecords(S())) PM.state.save();   // lugares conquistados sin ciudad (o con la de la celda vecina): se corrige
    recolorAll();
    teleport(pos);
    // la app se cerró a mitad de paseo (Android, en el bolsillo): el hueco desde tu última posición se rellena
    // por las calles con la primera lectura buena (como si el GPS hubiera tardado en contestar)
    if (autoResumed && session && !session.paused && session.lastSeen && S().lastPos) lastT = session.lastSeen;
    setMode(mode);
    setOrient(orient);
    renderSession();
    requestAnimationFrame(loop);
    PM.sync.auto();
    PM.update.watch(toast);
    compressOldWalks();
    scheduleStreakReminder();
    document.addEventListener('visibilitychange', () => { if (document.hidden) scheduleStreakReminder(); });
    // tramos pintados con versiones anteriores: su geometría (pendiente de subir y la de tu nube) para reconocerlos con la nueva fuente de mapas
    W.addLegacyGeo(S().pendingGeo);
    if (PM.profile === 'real' && PM.player && PM.cloud.password() && Date.now() - (S().legacyCloudT || 0) > 7 * 86400000) {
      PM.cloud.load(PM.player.name, PM.cloud.password()).then((r) => {
        if (r && r.geo) { W.addLegacyGeo(r.geo); S().legacyCloudT = Date.now(); PM.state.save(); }
      }).catch((e) => console.warn('Geometría de la nube para la migración: pendiente', e));
    }
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
    if (autoResumed && session && !session.paused) PM.update.hold();
    setTimeout(() => toast(autoResumed && session && !session.paused ? '▶ Tu paseo sigue: la app se había cerrado, seguimos pintando' : session ? '⏸ Tienes un paseo en pausa: pulsa ▶ para reanudar' :
      isNative ? '📡 Pulsa «Empezar a pintar» y sal a la calle' : '🕹️ Pulsa «Empezar a pintar» y muévete con WASD o clic', 'info', 4500), 600);
  }
  $('#start').addEventListener('click', () => begin(true));
  // paseo en marcha que Android cerró: se vuelve directo al mapa y sigue pintando (sin pasar por la pantalla de inicio)
  if (autoResumed && PM.player && session && !session.paused) setTimeout(() => begin(), 200);
  $('#intro-ver').textContent = `v${PM.VERSION.app} · datos © OpenStreetMap · mapa OpenFreeMap`;
  // versión bien visible (inicio y esquina del juego) para saber qué versión tienes instalada
  $('#intro-badge').innerHTML = `Versión <b>${PM.VERSION.app}</b> · ${new Date(PM.VERSION.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}` +
    (PM.isNative ? '' : ' · <i>web</i>');
  document.documentElement.style.setProperty('--paint', paintColor());
  $('#start').textContent = 'Crear y jugar';
  // recién elegido el nombre: se entra directamente sin volver a pulsar
  try { if (PM.player && sessionStorage.getItem('pintamapa_autostart')) { sessionStorage.removeItem('pintamapa_autostart'); begin(); } } catch (e) {}
})();
