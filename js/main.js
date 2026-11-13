// PintaMapa — mapa, movimiento (GPS o simulación), render e interfaz
(function () {
  const W = PM.world, G = PM.game, S = () => PM.state.data;
  const $ = (s) => document.querySelector(s);
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

  const PAINT_RADIUS = 12;      // m: margen para el error del GPS (calle por la que vas). Ajustado con pruebas de GPS realista (tests/pruebas-navegador.js)
  const TRAIL_RADIUS = 20;      // m: en senderos (GPS peor entre árboles)
  const ACERA_RADIUS = 18;      // m: por la acera de una calle con aceras anchas, si es la calle más cercana y vas en paralelo
  const PAINT_CORE = 5;        // m: parado o sin dirección conocida, se pinta solo lo que pisas
  const WIDE_RADIUS = 40;       // m: en avenidas anchas basta una acera para pintar ambas calzadas
  const CAPTURE_RADIUS = 30;    // m: hay que estar así de cerca de un monumento…
  const CAPTURE_SECONDS = 10;   // …durante este tiempo para capturarlo (no vale pasar de largo)
  const CAPTURE_EXIT = 40;      // m: margen para que un salto del GPS no cancele la captura
  const AURA_RADIUS = 80;       // m de "aura" de monumento (puntos x2)
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
  const ll = (p) => [p[1], p[0]];   // el juego usa [lat, lon]; MapLibre, [lon, lat]
  let curStyle = S().theme === 'dark' ? 'dark' : 'light';
  const map = new maplibregl.Map({ container: 'map', style: PM.mapStyle.styleURL(curStyle), center: ll(start), zoom: 17, attributionControl: false,
    dragRotate: false, pitchWithRotate: false, touchPitch: false, maxPitch: 0, pitch: 0, fadeDuration: 0, renderWorldCopies: false,
    pixelRatio: Math.min(1.75, window.devicePixelRatio || 1) });   // a más de 2× no se nota y cuesta mucho al móvil
  // ¿el dedo está moviendo el mapa? (mientras, ni la brújula ni la cámara lo mueven: si no, se pelean y va a tirones)
  let userGesture = false, gestureEnd = 0;
  map.on('movestart', (e) => { if (e.originalEvent) userGesture = true; });
  map.on('moveend', () => { if (userGesture) { userGesture = false; gestureEnd = performance.now(); } });
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
  const SRC = ['pm-streets', 'pm-painted', 'pm-barrios', 'pm-halos', 'pm-fx', 'pm-fxline', 'pm-lms', 'pm-mano'];
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
    // pintar a mano: el tramo que se pintaría, en amarillo (distinto de tu color: se ve qué es lo nuevo)
    add({ id: 'pm-mano', type: 'line', source: 'pm-mano', layout: round, paint: { 'line-color': '#facc15', 'line-width': zw(4, 9, 16), 'line-opacity': 0.9 } }, true);
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
    // (desde Android 15 la app se dibuja por debajo de las barras del sistema: sus iconos, según el tema de la app y no el del móvil)
    const barras = isNative && window.Capacitor.Plugins && window.Capacitor.Plugins.SystemBars;
    if (barras) barras.setStyle({ style: dark ? 'DARK' : 'LIGHT' }).catch(() => {});
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
  // (una transacción solo está escrita cuando termina: oncomplete; si falla o se aborta, error)
  const idbDone = (tx) => new Promise((ok, ko) => { tx.oncomplete = () => ok(); tx.onerror = () => ko(tx.error || new Error('IndexedDB')); tx.onabort = () => ko(tx.error || new Error('IndexedDB')); });
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
      bgeo = Object.assign(PM.bgeoSano(await idbReq(db.transaction('meta').objectStore('meta').get('barrios'))), bgeo);
    } catch (e) { /* sin base de datos (navegador privado): se dibuja lo cargado, como antes */ }
    geoReady = true; if (typeof wakeLoop === 'function') wakeLoop();
    if (Object.keys(bgeo).length) geoDb().then((db) => db.transaction('meta', 'readwrite').objectStore('meta').put(bgeo, 'barrios')).catch(() => {});
    paintedDirty = true; renderBarrios();
  })();
  function geoAdd(pc) {
    if (!pc) return;
    // (ya guardado: solo se cambia si ahora el tramo está más completo, para reparar los que quedaron recortados)
    const ya = pgeo.get(pc.id);
    if (ya && (ya.p.length >= pc.pts.length || PM.geo.dist(ya.p[0], ya.p[ya.p.length - 1]) + 0.5 >= PM.geo.dist(pc.pts[0], pc.pts[pc.pts.length - 1]))) return;
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
      // (se da por escrito solo cuando la base de datos lo confirma; si falla, esas zonas vuelven a la cola)
      const db = await geoDb(), tx = db.transaction('geo', 'readwrite'), st = tx.objectStore('geo');
      for (const k of tilesToWrite) { const o = {}; for (const id of pgeoTile.get(k) || []) o[id] = pgeo.get(id).p; st.put(o, k); }
      await idbDone(tx);
    } catch (e) { tilesToWrite.forEach((k) => pgeoNew.add(k)); clearTimeout(pgeoTimer); pgeoTimer = setTimeout(geoFlush, 30000); }
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
    wakeLoop();
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
    const f = [], painted = S().painted;
    for (const k of viewTiles()) {   // por zona, una figura por intensidad (0-3) en vez de una por tramo
      const by = [[], [], [], []], t = W.tiles[k], seen = new Set();
      const isP = (id) => !!painted[id];
      if (t) for (const p of t.pieces) if (painted[p.id]) { const h = heatLevel(p.id); by[h].push(p.pts); seen.add(p.id); for (const j of W.joinsOf(p, isP)) by[h].push(j); }   // (y sus uniones de cruce: sin cortes)
      const ids = pgeoTile.get(k);
      if (ids) for (const id of ids) if (painted[id] && !seen.has(id)) by[heatLevel(id)].push(pgeo.get(id).p);
      by.forEach((list, h) => { if (list.length) f.push({ type: 'Feature', properties: { h }, geometry: { type: 'MultiLineString', coordinates: list.map((pts) => pts.map(ll)) } }); });
    }
    paintedF = f;
    setSrc('pm-painted', FC(f));
  }


  // ---------- Barrios reales: contorno del barrio donde estás y de los conquistados, con bandera ----------
  let curBarrio = null, ensureBT = 0;
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
  let lmDirty = false, lmFlushT = null;
  function placeLandmark(lm) {
    const got = !!S().landmarks[lm.id], prev = lmIndex[lm.id];
    // (también si el mismo lugar llega con otros datos: posición, nombre, tipo o rareza; antes el mapa seguía con los viejos)
    const otro = (a, b) => a.pos[0] !== b.pos[0] || a.pos[1] !== b.pos[1] || a.name !== b.name || a.emoji !== b.emoji || a.rarity !== b.rarity || !!a.must !== !!b.must;
    if (!prev || prev.got !== got || (prev.lm !== lm && otro(prev.lm, lm))) lmDirty = true;
    lmIndex[lm.id] = { lm, got };
    if (got && lmHalos[lm.id] && prev && prev.lm.pos && (prev.lm.pos[0] !== lm.pos[0] || prev.lm.pos[1] !== lm.pos[1])) delete lmHalos[lm.id];
    if (got && !lmHalos[lm.id]) {
      lmHalos[lm.id] = { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: ll(lm.pos) } };
      setSrc('pm-halos', FC(Object.values(lmHalos)));
    }
    const h = lmHalos[lm.id], m = lm.must || (S().landmarks[lm.id] || {}).must ? 1 : 0;
    if (h && h.properties.m !== m) { h.properties.m = m; setSrc('pm-halos', FC(Object.values(lmHalos))); }
  }
  // Halo simbólico de los conquistados: un círculo de tu color y ondas que salen de él, en bucle, SOLO mientras pintas.
  // Parado o sin pintar, el lugar se ve conquistado (relleno de color) pero sin halo. En la versión web, nunca.
  let haloOn = false;
  const haloCol = () => ['case', ['==', ['get', 'm'], 1], '#eab308', paintColor()];   // imprescindibles: dorado
  function haloR(k) { return ['interpolate', ['linear'], ['zoom'], 12, 6 * k, 15, 13 * k, 17, 20 * k, 19, 26 * k]; }
  function stepHalos() {
    const want = PM.isNative && !!(session && !session.paused) && !placesOff && mapReady;
    if (want === haloOn) return;
    haloOn = want;
    if (map.getLayer('pm-halo-fill')) map.setLayoutProperty('pm-halo-fill', 'visibility', want ? 'visible' : 'none');
    fxSync();
  }
  // Latido de los imprescindibles sin conquistar (siempre) y ondas de los conquistados (pintando): marcadores con
  // animación CSS. Los anima la tarjeta gráfica sin tocar el mapa (antes, cambiar la capa 25 veces por segundo
  // obligaba a redibujarlo entero sin parar: más de la mitad del procesador y mucha batería).
  const fxMarks = new Map();
  let fxT = 0, guiaObj = null;
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
      const halos = [];
      for (const { lm, got } of Object.values(lmIndex)) {
        const must = !!(lm.must || (S().landmarks[lm.id] || {}).must);
        if (!got && (must || lm.id === guiaObj) && PM.geo.dist(lm.pos, ctr) < 5000) want.set('m' + lm.id, [lm, 'fx-must']);   // (también late tu primer objetivo)
        else if (got && haloOn) { const d = PM.geo.dist(lm.pos, pos); if (d < 800) halos.push([d, lm, must]); }
      }
      // ondas solo en los 6 conquistados más cercanos (antes, en todos a menos de 1,5 km: decenas de animaciones sin fin)
      halos.sort((a, b) => a[0] - b[0]).slice(0, 6).forEach(([, lm, must]) => want.set('h' + lm.id, [lm, 'fx-halo' + (must ? ' gold' : '')]));
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
  map.on('moveend', () => { if (Date.now() - fxT > 1500) fxSync(); fxReplay(); });
  // los imprescindibles laten 3 veces y descansan; vuelven a latir al mover el mapa o cada minuto
  function fxReplay() {
    for (const mk of fxMarks.values()) {
      if (mk._pmCls !== 'fx-must') continue;
      const i = mk.getElement().querySelector('i'); if (!i) continue;
      i.style.animation = 'none'; void i.offsetWidth; i.style.animation = '';
    }
  }
  setInterval(() => { if (!document.hidden) fxReplay(); }, 60000);
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
  const playerBox = playerEl.querySelector('.player');
  function beat() { playerBox.classList.remove('beat'); void playerBox.offsetWidth; playerBox.classList.add('beat'); }   // un latido por posición
  function showAt(p, smooth) {
    if (smooth && (!disp || PM.geo.dist(disp, p) > 0.5)) beat();
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
  function onMove(p, isTeleport, fixTime, fixSpeed, fixBearing, noShow) {
    // (la hora del GPS se usa tal cual aunque vaya por delante del reloj del móvil: con el reloj del móvil atrasado, todas
    // las lecturas parecen «del futuro» y recortarlas dejaba de pintar)
    const now = fixTime || Date.now();
    // Una lectura con la misma hora o poco anterior a la última ya procesada (repetida, o de un lote que llega desordenado) no
    // cuenta: no pinta, no suma metros ni rellena huecos. Antes, sin un tiempo positivo, el hueco se rellenaba por las calles
    // sin poder comprobar la velocidad, y la última hora retrocedía. Si retrocede MUCHO (más de 10 min: la anterior era una
    // hora rara, o el reloj del GPS saltó), se empieza un tramo nuevo sin rellenar, en vez de ignorar todo lo que venga
    if (session && !session.paused && lastP && !isTeleport && mode === 'gps' && now <= lastT) {
      if (lastT - now < 10 * 60000) return;
      isTeleport = true;
    }
    fixNow = now;
    if (isTeleport) cortarUnion();
    const visible = !document.hidden;
    if (visible && !noShow) showAt(p, mode === 'gps' && !isTeleport);
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
      // Quieto (en casa, en un bar), el GPS «se pasea» unos metros cada pocos minutos: eso no es andar. Una lectura cercana que
      // llega a menos de 0,2 m/s no pinta, no suma metros ni entra en el recorrido (un paseo del 3-nov sumó 240 m así, sentado)
      const deriva = mode === 'gps' && !jump && implied != null && implied < 0.2 && d < 40;
      if (mode === 'gps' && dt > 0 && dt < 3600) { const g = gpsSt(); g.t += dt; if (dt > 60 && d > 40) { g.cortes++; g.corte += dt; } if (jump) g.saltos++; }
      if (jump) {
        if (visible) toast('📡 Salto del GPS ignorado (no se pinta)', 'warn', 2500);
      } else if (implied != null) speed = speed * 0.6 + implied * 0.4;
      else if (fixSpeed != null && fixSpeed > 0) speed = speed * 0.5 + fixSpeed * 0.5;
      tooFast = mode === 'gps' && speed > MAX_SPEED;
      // (en vehículo no se pinta ni se guarda el recorrido: queda un corte, y el repaso del final no une lo de antes con lo de después)
      if (tooFast && session.track && session.track.length && session.track[session.track.length - 1] !== null) session.track.push(null);
      // Hueco entre lecturas (GPS en el bolsillo): se pinta el camino más corto POR LAS CALLES
      let routed = false;
      const via = softFixes.filter((f) => f.t > lastT && f.t < now).map((f) => f.p); softFixes = [];
      if (!jump && !deriva && !tooFast && mode === 'gps' && d > (PM.debug.umbralHueco || 20) && d < 3000) {
        const maxLen = Math.max(d * 2, d + 250);
        const r = (via.length && routeVia(lastP, p, via)) || W.route(lastP, p, maxLen);
        if (r && dt > 0 && r.len <= Math.max(maxLen, r.via ? r.len : 0) && r.len / dt <= MAX_SPEED * 1.5) {
          routed = true;
          fillGap(r, lastP, p, lastT, now); paintPrev = null; recentP = [];
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
      // Calles de la zona aún sin llegar (zona nueva, caché renovada, red lenta): lo andado no se pierde. Se guarda
      // como un hueco pendiente (con puntos intermedios para seguir tu camino) y se pinta por las calles al llegar.
      if (!routed && !jump && !deriva && !tooFast && d > 0.01 && d < 400 && !(streetsReady(p) && streetsReady(lastP))) {
        const g = pendingGaps[pendingGaps.length - 1];
        if (g && g.noStreets && PM.geo.dist(g.b, lastP) < 1) {
          if (PM.geo.dist(g.via.length ? g.via[g.via.length - 1] : g.a, g.b) > 30) g.via.push(g.b.slice());
          g.b = p.slice(); g.tb = now; g.d = PM.geo.dist(g.a, p); g.since = Date.now();
          if ((g.n = (g.n || 0) + 1) % 12 === 0) loadAlong(lastP, p);
        } else {
          pendingGaps.push({ a: lastP.slice(), b: p.slice(), ta: lastT, tb: now, via: [], d, since: Date.now(), noStreets: true });
          loadAlong(lastP, p);
        }
        walkAnchor = p.slice(); paintPrev = null; recentP = [];
        routed = true;
      }
      if (!routed && !jump && !deriva && d > 0.01 && d < 400) {
        if (!tooFast) {
          const steps = Math.ceil(d / 4);
          const heading = [p[0] - lastP[0], (p[1] - lastP[1]) * Math.cos(p[0] * Math.PI / 180)];
          // se pinta con la posición «suavizada» de lado (media de las 3 últimas lecturas): con el ruido del GPS
          // (5-10 m en ciudad) una lectura suelta caía más cerca de la calle paralela y se pintaba la que no era
          const a = paintPrev || lastP, b = PM.debug.sinSuavizado ? p : lateralSmooth(p);
          for (let i = 1; i <= steps; i++) paintAround(PM.geo.lerp(a, b, i / steps), heading);
          paintPrev = b;
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
      paintPrev = null; recentP = [];   // primera lectura del tramo: el suavizado empieza de cero
    }
    if (lastP && !isTeleport) updateHeading(lastP, p);
    if (isTeleport || !painting || (lastP && PM.geo.dist(lastP, p) > 40)) { recentP = []; paintPrev = null; }
    lastP = p.slice(); lastT = now;
    S().lastPos = p.slice();
    if (painting && !isTeleport) { session.lastSeen = Date.now(); session.gaps = pendingGaps; }   // si Android cierra la app, se sabe desde cuándo falta el recorrido
    PM.state.save();

    if (painting) { checkLandmarks(p, visible, now); if (!visible) checkNearCard(p); }
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
    if (miss.length && miss.length <= 40) W.ensureKeys(miss).then(() => retryGaps()).catch(() => {});
    else setTimeout(() => retryGaps(), 1500);
  }
  // (los huecos por rellenar se guardan con el paseo: si Android cierra la app antes de tener las calles, al volver
  // se recuperan; antes vivían solo en memoria y ese trozo del recorrido se perdía)
  const okGap = (g) => g && Array.isArray(g.a) && Array.isArray(g.b) && Array.isArray(g.via) && isFinite(g.d) && isFinite(g.ta) && isFinite(g.tb);
  let pendingGaps = (S().session && Array.isArray(S().session.gaps) ? S().session.gaps.filter(okGap) : []).map((g) => Object.assign(g, { since: Date.now() }));
  setInterval(() => { if (pendingGaps.length) retryGaps(); }, 20000);
  // final: al terminar el paseo, lo que siga sin camino ya no espera más
  function retryGaps(final) {
    if (!pendingGaps.length) return;
    if (!session) { pendingGaps = []; return; }
    const keep = [];
    for (const g of pendingGaps) {
      const maxLen = Math.max(g.d * 2, g.d + 250), dt = (g.tb - g.ta) / 1000;
      const r = (g.via.length && routeVia(g.a, g.b, g.via)) || W.route(g.a, g.b, maxLen);
      if (!(dt > 0)) continue;   // (hueco sin un tiempo válido —guardado por una versión anterior—: no se rellena)
      if (r && r.len <= Math.max(maxLen, r.via ? r.len : 0) && r.len / dt <= MAX_SPEED * 1.5) { fillGap(r, g.a, g.b, g.ta, g.tb); continue; }
      if (!final && Date.now() - g.since < (g.noStreets ? 30 : 3) * 60000) { keep.push(g); continue; }   // (sin calles aún: sin cobertura, hasta media hora)
      // sin camino posible (de verdad no lo hay): como antes, lo que haya justo en línea recta (si es corto)
      if (g.d < 400) { const st = Math.ceil(g.d / 4), h = [g.b[0] - g.a[0], (g.b[1] - g.a[1]) * Math.cos(g.b[0] * Math.PI / 180)]; for (let i = 1; i <= st; i++) paintAround(PM.geo.lerp(g.a, g.b, i / st), h); }
      // y lo andado cuenta igual: metros y recorrido por tus puntos (antes ese trozo desaparecía del paseo)
      const way = [g.a, ...g.via, g.b];
      let len = 0; for (let i = 1; i < way.length; i++) len += PM.geo.dist(way[i - 1], way[i]);
      fillGap({ len, pieces: [], path: way.slice(0, -1) }, g.a, g.b, g.ta, g.tb);
    }
    pendingGaps = keep;
    if (session) session.gaps = pendingGaps;
    paintedDirty = true; PM.state.save();
  }

  // ---------------- Memoria: las zonas lejanas salen; lo pintado de antes se recoge poco a poco ----------------
  // Con más de 36 zonas en memoria se quitan las más lejanas hasta dejar 25. Nunca: las que tienes a menos de 2
  // celdas (~2 km), las de lo que estás mirando, las de tu barrio ni las de un hueco del GPS por rellenar.
  // Lo pintado y lo conquistado se siguen viendo (salen del almacén de formas) y las calles vuelven al acercarte.
  const KEEP_MAX = 36, KEEP_TO = 25;
  const repZonas = new Set();   // (las zonas del trozo de un paseo que se está repasando —repasoPendiente—: no se quitan)
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
    for (const g of pendingGaps) { around(g.a, 1); around(g.b, 1); g.via.forEach((q) => around(q, 0)); }
    repZonas.forEach((k) => keep.add(k));
    return keep;
  }
  function trimMemory() {
    if (PM.debug.sinLimpieza) return;
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
  // Revisión de las cartas: cada carta se pone al día con las reglas de ahora aunque no vuelvas a pasar por su zona. Se carga
  // en segundo plano la zona de cada carta (sin paseo, con la app a la vista y de una en una), se corrige su tipo y su estrella y
  // se quita lo que el juego ya no da por bueno (un hotel, un metro…). Sube REV_CARTAS para repasarlas todas otra vez.
  const REV_CARTAS = 2;
  let revBusy = false;
  const revTry = {};
  async function revisarCartas() {
    if (!begun || revBusy || !mapReady || document.hidden || (session && !session.paused) || !geoReady) return;
    const s = S();
    if (!s.cartasRev || s.cartasRev.v !== REV_CARTAS) s.cartasRev = { v: REV_CARTAS, k: {} };
    const hechas = s.cartasRev.k;
    let k = null, r0 = null;
    for (const r of Object.values(s.landmarks)) {
      if (!r.pos) continue;
      const z = W.tileKeyOf(r.pos[0], r.pos[1]);
      if (!hechas[z] && !(Date.now() - (revTry[z] || 0) < 30 * 60000)) { k = z; r0 = r; break; }
    }
    if (!k) return;
    revBusy = true;
    try {
      await W.precargaCerca(r0.pos[0], r0.pos[1]);
      await W.ensureKeys([k]);
      if (!(W.tiles[k] && W.tiles[k].loaded)) { revTry[k] = Date.now(); return; }   // (sin conexión: en media hora)
      await Promise.race([W.completado(), new Promise((ok) => setTimeout(ok, 20000))]);
      S().cartasRev.k[k] = 1;
      if (PM.fillLandmarkCities(S()) + W.fixRecords(S(), k)) { lmDirty = true; flushLandmarks(true); }
      PM.state.save();
      if (!keepSet().has(k)) W.unloadTiles([k]);
    } catch (e) { revTry[k] = Date.now(); } finally { revBusy = false; }
  }
  setInterval(revisarCartas, 7000);

  // Suavizado lateral: la media de las 3 últimas lecturas solo corrige el desvío A LOS LADOS de la marcha (no
  // retrasa el pintado hacia delante). Se reinicia tras un salto o un hueco.
  let recentP = [], paintPrev = null;
  function lateralSmooth(p) {
    if (recentP.length && PM.geo.dist(recentP[recentP.length - 1], p) > 40) recentP = [];
    recentP.push(p.slice()); if (recentP.length > 3) recentP.shift();
    if (recentP.length < 3) return p;
    const kx = PM.geo.mPerDegLon(p[0]), ky = PM.geo.mPerDegLat, f = recentP[0];
    const ux0 = (p[1] - f[1]) * kx, uy0 = (p[0] - f[0]) * ky, ul = Math.hypot(ux0, uy0);
    if (ul < 6) return p;
    const ux = ux0 / ul, uy = uy0 / ul;
    const mx = (recentP.reduce((s0, q) => s0 + q[1], 0) / 3 - p[1]) * kx, my = (recentP.reduce((s0, q) => s0 + q[0], 0) / 3 - p[0]) * ky;
    const along = mx * ux + my * uy, px = mx - along * ux, py = my - along * uy;   // solo lo perpendicular
    return [p[0] + py / ky, p[1] + px / kx];
  }

  // punto del recorrido: [lat, lon, segundos desde el inicio del paseo, altitud del GPS] (para las estadísticas tipo Strava)
  let lastAlt = null;
  const trackPt = (p, t) => { const q = [+p[0].toFixed(6), +p[1].toFixed(6), Math.round(((t || Date.now()) - session.start) / 1000)]; if (lastAlt != null) q.push(Math.round(lastAlt * 10) / 10); return q; };
  // lecturas con poca precisión (bolsillo, poca cobertura): no pintan solas, pero guían la ruta del hueco
  let softFixes = [], lastFixT = 0, lastBuenaT = 0;   // (lastBuenaT: la última lectura precisa —≤ 35 m—, la que pinta)
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
    const { lista, nearest } = tramosEn(p, heading);
    for (const piece of lista) { if (S().painted[piece.id]) G.repass(piece); else G.paintPiece(piece, aura); }
    if (!walkedPts.length || PM.geo.dist(walkedPts[walkedPts.length - 1], p) > 3) { walkedPts.push(p); if (walkedPts.length > 40) walkedPts.shift(); }
    if (nearest && S().painted[nearest[0].id]) bridgeTo(nearest[0], p, aura);
  }
  // Los tramos de calle que corresponden a una posición y un rumbo (lo usan el pintado en marcha y el repaso del final)
  function tramosEn(p, heading) {
    const hl = heading ? Math.hypot(heading[0], heading[1]) : 0;
    // 1) candidatas: cerca y en tu dirección
    const cand = [], cerca = W.piecesNear(p, WIDE_RADIUS).map((pc) => [pc, PM.geo.distToPolyline(p, pc.pts)]);
    // la calle o camino más cercano de todos (cualquier dirección, senderos incluidos: si vas por un camino del mapa que
    // va junto a la calle, vas por el camino y no por la acera)
    let masCerca = Infinity; for (const [, d] of cerca) if (d < masCerca) masCerca = d;
    for (const [piece, dist] of cerca) {
      const lim = piece.wide ? WIDE_RADIUS : piece.trail ? TRAIL_RADIUS : (PM.debug.radio || PAINT_RADIUS);
      // Acera: en una calle con aceras anchas (o aparcamiento, o un bulevar) andas a 12-18 m de la línea de la calle, que el
      // mapa dibuja por el centro. Si es la calle más cercana de todas y vas en paralelo, es la tuya: se pinta. Antes esos
      // tramos se quedaban sin pintar si la calle no estaba marcada como ancha.
      const acera = !PM.debug.sinAcera && !piece.wide && !piece.trail && hl && dist > lim && dist <= ACERA_RADIUS && dist <= masCerca + 0.01;
      // senderos: el GPS va peor entre árboles y los caminos serpentean → más margen de distancia y de ángulo
      if (dist > lim && !acera) continue;
      // Sin dirección conocida (parado, primera lectura): solo lo que pisas. Con dirección: solo tramos
      // que van en tu misma dirección (al pasar por un cruce no se pinta el arranque de la calle lateral).
      let ok = !hl && dist <= PAINT_CORE;
      if (hl) {
        const a = piece.pts[0], b = piece.pts[piece.pts.length - 1];
        const v = [b[0] - a[0], (b[1] - a[1]) * Math.cos(a[0] * Math.PI / 180)];
        const vl = Math.hypot(v[0], v[1]);
        // lejos (otra calzada de una avenida) se exige ir casi paralelo: < ~30°; cerca basta < ~53°
        ok = vl > 0 && Math.abs((v[0] * heading[0] + v[1] * heading[1]) / (vl * hl)) >= (piece.trail ? 0.4 : acera ? 0.9 : dist > PAINT_RADIUS ? 0.85 : 0.6);
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
    const onAvenue = nearest && nearest[0].wide, lista = [];
    for (const [piece, dist] of cand) {
      if (piece.wide && !onAvenue && dist > PAINT_RADIUS) continue;
      if (!piece.wide && dist > best + (PM.debug.margen != null ? PM.debug.margen : 3) && !(piece.len < 8 && dist <= 5)) continue;   // (3 m: un tercio menos de calles paralelas pintadas sin pisarlas, misma cobertura)
      lista.push(piece);
    }
    return { lista, nearest };
  }
  // Sin cortes en lo pintado: si la calle que pintas ahora no enlaza con la anterior (cruzando una plaza en diagonal,
  // dos calles que en el mapa no llegan a tocarse…), se pinta también lo que las une POR LAS CALLES, solo si el
  // camino es casi recto y va por donde has andado: nada de rodeos ni de calles que no has pisado.
  // En plazas y calles peatonales (sus líneas del mapa no siguen tu paso) se permite más hueco y más separación.
  let bridgePc = null, bridgeP = null, bridgeT = 0, fixNow = 0;
  const walkedPts = [];   // tus últimas posiciones (para saber si la unión va por donde has andado)
  // al empezar o reanudar un paseo (o tras un salto) no se une con lo de antes: antes un paseo nuevo podía «unirse» con el
  // final del anterior si estaba cerca
  // (y la velocidad media se pone a cero: la del final del paseo anterior, o de antes de la pausa —en el autobús—, hacía
  // creer que ibas demasiado rápido y las primeras lecturas no pintaban)
  function cortarUnion() { bridgePc = null; bridgeP = null; bridgeT = 0; walkedPts.length = 0; speed = 0; tooFast = false; }
  function bridgeTo(pc, p, aura) {
    // (la hora de la lectura, no la del reloj: con la pantalla apagada las lecturas llegan en tanda)
    const prev = bridgePc, pp = bridgeP, now = fixNow || Date.now(), fresh = now - bridgeT < 60000;
    bridgePc = pc; bridgeP = p; bridgeT = now;
    if (!prev || !fresh || prev === pc || !W.pieces[prev.id] || PM.debug.sinPuentes || PM.geo.dist(pp, p) > 70) return;
    const ends = (x) => [x.pts[0], x.pts[x.pts.length - 1]];
    let gap = Infinity, a = null, b = null;
    for (const u of ends(prev)) for (const v of ends(pc)) { const d = PM.geo.dist(u, v); if (d < gap) { gap = d; a = u; b = v; } }
    if (gap < 1 || gap > 50) return;   // ya se tocan, o demasiado lejos para ser la misma marcha
    const r = W.route(a, b, gap * 1.5 + 12);
    if (!r || !r.pieces.length) return;
    const pcs = r.pieces.map((id) => W.pieces[id]).filter(Boolean);
    const ped = pcs.every((q) => q.ped);
    if (!ped && gap > 25) return;
    const track = walkedPts.filter((q) => PM.geo.dist(q, p) < 120);
    if (track.length > 1 && Math.max(...(r.path || []).map((q) => PM.geo.distToPolyline(q, track))) > (ped ? 25 : 12)) return;
    for (const q of pcs) { if (S().painted[q.id]) G.repass(q); else G.paintPiece(q, aura); }
  }

  // Radar: el monumento sin capturar más cercano, con distancia y flecha (anima a desviarse un poco)
  function bearingTo(a, b) {
    const dx = (b[1] - a[1]) * PM.geo.mPerDegLon(a[0]), dy = (b[0] - a[0]) * PM.geo.mPerDegLat;
    return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
  }
  function updateRadar() {
    if (document.hidden || !session) { $('#radar').classList.remove('show'); return; }
    let lm = null, lmD = Infinity;
    for (const id in W.landmarks) {
      if (S().landmarks[id]) continue;
      const d = PM.geo.dist(pos, W.landmarks[id].pos);
      if (d < lmD) { lmD = d; lm = W.landmarks[id]; }
    }
    const arrow = (t) => `<i class="rarrow" style="transform:rotate(${bearingTo(pos, t) - map.getBearing()}deg)">➤</i>`;
    const parts = [];
    if (lm && lmD < 1500) parts.push(`${lm.emoji} ${PM.fmtDist(lmD)} ${arrow(lm.pos)}`);
    $('#radar').innerHTML = parts.length ? parts.join(' · ') : '';
    $('#radar').classList.toggle('show', parts.length > 0);
  }
  setInterval(updateRadar, 1000);
  // parado, el GPS deja de dar lecturas (una cada 8 m): sin esto el indicador se quedaba con la última velocidad (5 km/h
  // quieto, o «¡muy rápido!» al bajar del autobús). Sin lecturas en 15 s, velocidad 0
  setInterval(() => {
    if (mode !== 'gps' || document.hidden || !lastFixT || Date.now() - lastFixT < 15000 || (speed === 0 && !tooFast)) return;
    speed = 0; tooFast = false; updateSpeedBadge();
  }, 3000);
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
        if (visible && canCapture(dw.lm)) toast(`📸 Te has alejado de ${dw.lm.emoji} ${PM.esc(dw.lm.name)}: captura cancelada`, 'warn', 2500);
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
      toast(nuevos.length === 1 ? `📸 Quédate ${CAPTURE_SECONDS} s junto a ${nuevos[0].emoji} <b>${PM.esc(nuevos[0].name)}</b> para capturarlo`
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
    const names = list.length === 1 ? `${dw.lm.emoji} ${PM.esc(dw.lm.name)}` : `${list.map((x) => x.lm.emoji).join(' ')} ${list.length} lugares`;
    el.innerHTML = `📸 Capturando ${names}… <b>${left} s</b><span class="cbar"><i style="width:${pct}%"></i></span>`;
    el.classList.add('show');
  }
  // quieto junto al monumento no llegan lecturas nuevas del GPS: se comprueba cada segundo con la última posición
  setInterval(() => { if (session && !session.paused) checkDwell(pos, Date.now(), !document.hidden); }, 1000);   // también en el bolsillo: quieto junto a un lugar, el GPS no manda nada nuevo

  function checkLandmarks(p, visible = true, t = Date.now()) {
    const n = nearestLandmark(p);
    nearCache = { t: performance.now(), v: n };
    auraEl.classList.toggle('on', n.d <= AURA_RADIUS);
    $('#aura').classList.toggle('show', n.d <= AURA_RADIUS);
    if (n.lm && n.d <= AURA_RADIUS) $('#aura').textContent = `✨ Aura de ${PM.t(n.lm.kind).toLowerCase()} · pintura x2`;
    checkDwell(p, t, visible);
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
  // ---------------- Pintar a mano (corregir lo que el GPS dejó sin pintar) ----------------
  // Mantén pulsada una calle: se pinta ese tramo (la misma calle, a los dos lados, hasta 150 m) si pasa junto a un
  // recorrido tuyo (a menos de 30 m). El GPS nunca será perfecto (una acera rara, un túnel): así no hace falta volver.
  // Solo junto a tus recorridos: no se puede pintar lo que no has andado.
  const MANO_PASILLO = 30, MANO_MAX = 150;   // (30 m: el GPS desviado más una acera ancha; una calle paralela suele quedar más lejos)
  function junto(p) {
    const tracks = (S().walks || []).map((w) => w.track || []).concat(session && session.track ? [session.track] : []);
    const dLat = MANO_PASILLO / 111320 * 3;
    for (const tr of tracks) for (let i = 1; i < tr.length; i++) {
      const a = tr[i - 1], b = tr[i];
      if (!a || !b || (Math.abs(a[0] - p[0]) > dLat && Math.abs(b[0] - p[0]) > dLat) || PM.geo.dist(a, b) > 400) continue;
      if (PM.geo.distToPolyline(p, [a, b]) <= MANO_PASILLO) return true;
    }
    return false;
  }
  function tramoAMano(p) {
    const c = W.piecesNear(p, 15).filter((pc) => !pc.trail).map((pc) => [pc, PM.geo.distToPolyline(p, pc.pts)]).sort((a, b) => a[1] - b[1])[0];
    if (!c) return { motivo: 'Ahí no hay ninguna calle del mapa.' };
    const pc0 = c[0];
    if (S().painted[pc0.id]) return { motivo: 'Esa calle ya está pintada.' };
    if (!junto(pc0.mid)) return { motivo: 'Solo puedes pintar a mano calles junto a un recorrido tuyo (a menos de 30 m).' };
    // la misma calle a los dos lados (en línea: menos de 25°), sin pintar y junto a tus recorridos
    const kx = Math.cos(p[0] * Math.PI / 180), vec = (a, b) => { const v = [b[0] - a[0], (b[1] - a[1]) * kx], l = Math.hypot(v[0], v[1]); return l ? [v[0] / l, v[1] / l] : null; };
    const pegados = (q) => W.piecesNear(q, 3).filter((o) => !o.trail && (PM.geo.dist(o.pts[0], q) < 1.5 || PM.geo.dist(o.pts[o.pts.length - 1], q) < 1.5));
    const out = [pc0], vistos = new Set([pc0.id]);
    let largo = pc0.len;
    for (const [desde, hacia] of [[pc0.pts[0], pc0.pts[pc0.pts.length - 1]], [pc0.pts[pc0.pts.length - 1], pc0.pts[0]]]) {
      let cur = hacia, dir = vec(desde, hacia);
      while (dir && largo < MANO_MAX) {
        let mejor = null, bc = 0.9;
        for (const o of pegados(cur)) {
          if (vistos.has(o.id)) continue;
          const lejos = PM.geo.dist(o.pts[0], cur) < PM.geo.dist(o.pts[o.pts.length - 1], cur) ? o.pts[o.pts.length - 1] : o.pts[0];
          const v = vec(cur, lejos), cs = v ? v[0] * dir[0] + v[1] * dir[1] : 0;
          if (cs > bc) { bc = cs; mejor = [o, lejos, v]; }
        }
        if (!mejor || S().painted[mejor[0].id] || !junto(mejor[0].mid)) break;
        vistos.add(mejor[0].id); out.push(mejor[0]); largo += mejor[0].len; cur = mejor[1]; dir = mejor[2];
      }
    }
    return { tramos: out, largo };
  }
  let manoT = 0;
  function pintarAMano(p) {
    if (Date.now() - manoT < 1200 || !mapReady) return;   // (en algunos móviles llegan la pulsación larga y el menú a la vez)
    manoT = Date.now();
    const r = tramoAMano(p);
    if (!r.tramos) { toast(r.motivo, 'info', 3500); return; }
    PM.vibrate(30);
    setSrc('pm-mano', FC(r.tramos.map((q) => lineF(q.pts))));   // lo que se pintaría, resaltado
    openSheet('🖌️ Pintar a mano', `<p>¿Pinto este tramo de calle (${PM.fmtDist(r.largo)})? Pasa junto a un recorrido tuyo: si el GPS lo dejó sin pintar, así queda como andado.</p>
      <button class="btn on" id="mano-si" style="width:100%;margin:6px 0">🖌️ Pintar ${PM.fmtDist(r.largo)}</button>`);
    const limpiar = () => setSrc('pm-mano', FC([]));
    const sh = $('#sheet'), obs = new MutationObserver(() => { if (!sh.classList.contains('show')) { limpiar(); obs.disconnect(); } });
    obs.observe(sh, { attributes: true, attributeFilter: ['class'] });
    $('#mano-si').addEventListener('click', () => {
      let n = 0; for (const q of r.tramos) if (!S().painted[q.id]) { G.paintPiece(q, false); n++; }
      const s = S(); s.stats.aMano = (s.stats.aMano || 0) + 1; PM.state.save();
      sh.classList.remove('show'); limpiar(); flushPaint();
      toast(`🖌️ Pintado a mano: ${PM.fmtDist(r.largo)}`, 'ok', 2500);
    });
  }
  // pulsación larga en el móvil (650 ms sin moverse) y botón derecho en el ordenador
  let lp = null;
  const lpFin = () => { if (lp) { clearTimeout(lp.t); lp = null; } };
  map.on('touchstart', (e) => {
    lpFin();
    if (!e.originalEvent.touches || e.originalEvent.touches.length !== 1) return;
    const ll0 = e.lngLat; lp = { pt: e.point, t: setTimeout(() => { lp = null; pintarAMano([ll0.lat, ll0.lng]); }, 650) };
  });
  map.on('touchmove', (e) => { if (lp && Math.hypot(e.point.x - lp.pt.x, e.point.y - lp.pt.y) > 10) lpFin(); });
  map.on('touchend', lpFin); map.on('touchcancel', lpFin); map.on('movestart', (e) => { if (e.originalEvent) lpFin(); });
  map.on('contextmenu', (e) => { lpFin(); pintarAMano([e.lngLat.lat, e.lngLat.lng]); });
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
  let compassWoke = null;
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
          // (16 avisos por segundo: solo se despierta el dibujo si el rumbo ha cambiado 1° desde la última vez, no por
          // el temblor del sensor con el móvil quieto)
          if (compassWoke == null || Math.abs(angDiff(compassWoke, compass)) >= 1) { compassWoke = compass; wakeLoop(); }
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
    if (aguja) aguja.style.transform = `rotate(${-map.getBearing()}deg)`;   // (la aguja del botón señala siempre el norte de verdad)
  }
  const aguja = document.querySelector('#btn-orient .aguja');

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
    botonEstado('#btn-orient', 'on', o === 'heading', o === 'heading' ? '🧭 El mapa gira hacia donde andas' : '🧭 Norte arriba (mapa fijo)');
  }
  // estado de un botón del mapa: su color y lo que dice quien lo lee en voz alta
  function botonEstado(sel, cls, on, txt) { const b = $(sel), t = PM.t(txt).replace(/^[^\p{L}]+/u, ''); b.classList.toggle(cls, on); b.title = t; b.setAttribute('aria-label', t); }
  // Ver solo tus calles pintadas: oculta los lugares para conquistar (al empezar a pintar vuelven a salir)
  let placesOff = false;
  try { placesOff = localStorage.getItem('pintamapa_places_off') === '1'; } catch (e) {}
  function setPlaces(off, quiet) {
    placesOff = off;
    try { localStorage.setItem('pintamapa_places_off', off ? '1' : '0'); } catch (e) {}
    if (map.getLayer('pm-lms')) map.setLayoutProperty('pm-lms', 'visibility', off ? 'none' : 'visible');   // los halos los decide stepHalos
    fxSync();
    lugaresEstado();
    if (!quiet) toast(off ? '🖌️ Solo tus calles pintadas (los lugares, ocultos)' : '📍 Lugares para conquistar visibles', 'info');
  }
  function lugaresEstado() { botonEstado('#btn-places', 'off', placesOff, placesOff ? '🖌️ Solo tus calles pintadas (los lugares, ocultos)' : '📍 Lugares para conquistar visibles'); }
  lugaresEstado();
  $('#btn-places').addEventListener('click', () => setPlaces(!placesOff));
  $('#gps').addEventListener('click', () => toast('📡 ' + PM.esc($('#gps').title), 'info'));
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
  // todo lo pintado con su forma (de la memoria o, si su zona no está cargada, del almacén) y los barrios guardados
  function paintedAll() {
    const out = [], s = S();
    for (const id in s.painted) {
      const pc = W.pieces[id];
      if (pc) { out.push(pc); continue; }
      const g = pgeo.get(id);
      if (!g) continue;
      let len = 0; for (let i = 1; i < g.p.length; i++) len += PM.geo.dist(g.p[i - 1], g.p[i]);
      out.push({ id, pts: g.p, len, mid: g.p[Math.floor(g.p.length / 2)], trail: false });
    }
    return out;
  }
  const artCtx = () => ({ S, W, paintedAll, barrioShapes: () => bgeo });
  const openWeek = () => PM.need('lib/mp4-muxer.js', 'js/replay.js', 'js/wrapped.js').then(() => PM.wrapped.open(artCtx())).catch(() => toast('Sin conexión para abrir el vídeo', 'warn'));
  setTimeout(() => {
    const d = new Date(), wk = d.getFullYear() + '-' + Math.floor((d - new Date(d.getFullYear(), 0, 1)) / 604800000);
    if ((d.getDay() === 0 || d.getDay() === 1) && S().wrappedWeek !== wk && (S().walks || []).some((w) => w.start > Date.now() - 7 * 86400000)) {
      S().wrappedWeek = wk; PM.state.save();
      const el = toast('📽️ <b>¡Tu semana pintando está lista!</b> Toca para verla', 'gold', 8000);
      el.style.pointerEvents = 'auto'; el.style.cursor = 'pointer'; el.addEventListener('click', openWeek);
    }
  }, 5000);

  // Gancho de pruebas (consola del navegador): PM.debug.walkTo([lat, lon]), PM.debug.setPace(0..4)
  PM.debug = { map, fiesta: (nivel, desde) => { const h = PM.hitoNivel(desde != null ? desde : nivel - 1, nivel); if (h) fiesta(h, []); return h; }, repasar: (x) => repasarPaseo(x), repintar: (t, a, b) => repintarRecorrido(t, a, b), repasoPendiente: () => repasoPendiente(), walkTo(p) { target = p; follow = true; }, setPace(i) { pace = i; turbo = false; }, get pos() { return pos.slice(); },
    get bearing() { return map.getBearing(); }, get heading() { return heading; }, get gap() { return { lastP, lastT, pending: pendingGaps.length, autoResumed, lastSeen: session && session.lastSeen }; }, trim: () => trimMemory(), revisar: () => revisarCartas(), backup: () => buildBackup(), importData: (d) => importData(d), fix(lat, lon, t, acc = 5, spd, brg) { const m = mode; mode = 'gps'; try { onFix({ latitude: lat, longitude: lon, accuracy: acc, speed: spd, bearing: brg }, t); } finally { mode = m; } }, newSession() { if (session) endSession(); startSession(); $('#sheet').classList.remove('show'); }, endSession: () => endSession(), get sessionTrack() { return session && session.track; }, harvest: () => harvestOld(), flushGeo: () => geoFlush(), get geo() { return { pgeo: pgeo.size, zonas: pgeoTile.size, barrios: Object.keys(bgeo).length, recogidas: Object.keys(harvested).length, ready: geoReady }; }, get painted() { return paintedF; },
    // avanza el juego n fotogramas a mano (pruebas con la pestaña oculta, donde el navegador congela la animación)
 };
  PM.debug.fx = (id) => conquestFX(id || curBarrio);   // pruebas: animación de conquista

  let lastFrame = performance.now();
  function loop(now) {
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
    el.className = 'fab mapa gps-' + st + (el.classList.contains('show') ? ' show' : '');
    el.title = PM.t({ search: 'Buscando GPS…', ok: `GPS con señal (±${Math.round(acc || 0)} m)`, weak: `GPS impreciso (±${Math.round(acc || 0)} m)`, off: 'GPS apagado (ahorrando batería)' }[st]);
    el.setAttribute('aria-label', el.title);
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
    if (acc <= 35) lastBuenaT = lastFixT;
    if (session && !session.paused) anotarDiario(acc);
    if (c.altitude != null && isFinite(c.altitude) && (c.altitudeAccuracy == null || c.altitudeAccuracy < 30)) lastAlt = c.altitude;
    if (acc > 35 && session && !session.paused) gpsSt().flojas++;
    if (acc > 35) {   // con mucho error podríamos pintar la calle de al lado: no pinta, pero sirve de guía para rellenar el hueco
      if (acc <= 120 && session && !session.paused) softFixes.push({ p: [c.latitude, c.longitude], t: t || c.time || Date.now() });
      if (softFixes.length > 60) softFixes.shift();
      return;
    }
    pos = [c.latitude, c.longitude];
    const f = { p: pos.slice(), t: t || c.time || Date.now(), acc, spd: c.speed, brg: c.bearing != null ? c.bearing : c.heading };
    if (!(session && !session.paused) || PM.debug.sinFiltro) { onMove(f.p, false, f.t, f.spd, f.brg); return; }
    // Pintando: cada lectura se confirma con la siguiente. Un rebote del GPS entre edificios (una lectura suelta
    // desviada 30-60 m) hacía que se trazara un camino hasta ella y de vuelta, pintando calles que no pisaste.
    if (!document.hidden) showAt(f.p, true);   // tu punto se mueve ya; lo que se pinta espera a la siguiente lectura
    holdFix(f);
  }
  let heldFix = null, heldTimer = null;
  function holdFix(f) {
    const h = heldFix; heldFix = null;
    if (h) {
      const base = lastP;
      if (base && f) {
        const dev = PM.geo.distToPolyline(h.p, [base, f.p]);
        const vuelta = PM.geo.dist(base, h.p) + PM.geo.dist(h.p, f.p), recta = PM.geo.dist(base, f.p);
        // muy fuera del camino entre la anterior y la siguiente, y un «pico» (ida y vuelta): rebote, se descarta
        if (!(dev > Math.max(20, h.acc * 1.5) && vuelta > recta * 1.6 + 20)) onMove(h.p, false, h.t, h.spd, h.brg, true);
        else if (session) gpsSt().rebotes++;
      } else onMove(h.p, false, h.t, h.spd, h.brg, true);
    }
    heldFix = f || null;
    clearTimeout(heldTimer);
    if (heldFix) heldTimer = setTimeout(() => holdFix(null), 12000);   // parado (no llega otra lectura): se acepta
  }
  const flushHeldFix = () => { if (heldFix) holdFix(null); };

  // ahorro de batería: parado más de 90 s → el GPS solo avisa si te mueves 25 m; en cuanto andas, vuelve a 8 m
  let gpsSaver = false, gpsSaverT = 0;
  function gpsSaverCheck() {
    if (!gpsWatch || !gpsWatch.bg || !session || session.paused || document.hidden) return;   // con la pantalla apagada no se toca el GPS
    // (quieto no llegan lecturas y la velocidad se queda en la última: sin lecturas hace un minuto, también es estar parado)
    const still = Date.now() - Math.max(lastMoveT || 0, session.resumedAt || 0) > 90000 && (speed < 0.4 || Date.now() - lastFixT > 60000);
    if (still !== gpsSaver && Date.now() - gpsSaverT > 60000) { gpsSaver = still; gpsSaverT = Date.now(); startGPS(); }
  }
  setInterval(gpsSaverCheck, 30000);
  // Al guardar el móvil vuelve la precisión normal: con la pantalla apagada ya no se toca el GPS, y si estaba en ahorro
  // (parado con la app abierta), todo el paseo en el bolsillo iría con lecturas cada 25 m
  document.addEventListener('visibilitychange', () => { if (document.hidden && gpsSaver && gpsWatch && gpsWatch.bg) { gpsSaver = false; gpsSaverT = Date.now(); startGPS(); } });
  // Diario del paseo, minuto a minuto: [minuto, lecturas buenas, imprecisas, mejor precisión (m), pantalla apagada 0/1] y avisos
  // [minuto, 'qué']. Ocupa poco (unos 2 KB por hora) y se guarda con el paseo: así se sabe qué hizo el GPS en el bolsillo
  // (antes solo quedaba el recorrido, y un tramo rellenado por las calles no decía si el GPS se había callado o daba lecturas
  // imprecisas)
  function anotarDiario(acc) {
    const d = session.diario || (session.diario = []), m = Math.floor((Date.now() - session.start) / 60000);
    let e = d[d.length - 1];
    if (!e || e[0] !== m) { if (d.length >= 600) return; e = [m, 0, 0, 999, 0]; d.push(e); }
    if (acc <= 35) e[1]++; else e[2]++;
    e[3] = Math.min(e[3], Math.round(acc || 0)); if (document.hidden) e[4] = 1;
  }
  function avisoDiario(que) {
    if (!session) return;
    const a = session.avisos || (session.avisos = []);
    if (a.length < 150) a.push([Math.floor((Date.now() - session.start) / 60000), String(que).slice(0, 24)]);
  }
  // El paseo NUNCA se pausa solo (orden del usuario, 8-nov-2026): solo con ⏸ o al finalizar. La pausa automática por «15 min
  // sin moverte» se equivocaba (GPS flojo o dormido en el bolsillo, un rato parado en un semáforo largo o un bar) y, como
  // apagaba el GPS, el resto del recorrido ya no se pintaba. Parado no se pinta ni se suma nada de todos modos (deriva).
  // ¿Quieto, o el GPS dormido? Sin lecturas no se sabe: el GPS no manda nada si no te mueves (filtro de 8-25 m), pero en el
  // bolsillo Android también puede dejar de darlas aunque andes. Antes, 15 min sin lecturas = «quieto»: se pausaba el paseo
  // y se APAGABA el GPS, y el resto del paseo ya no se pintaba. Ahora se pide una posición nueva: si te has movido (o el GPS
  // no contesta) era el GPS dormido, y se reinicia; si sigues en el mismo sitio, estabas quieto de verdad.
  let vigilando = false, vigilaT = 0;
  async function posicionAhora() {
    try {
      const Geo = isNative && window.Capacitor.Plugins.Geolocation;
      if (Geo) { const r = await Geo.getCurrentPosition({ enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }); return r && r.coords ? { p: [r.coords.latitude, r.coords.longitude], acc: r.coords.accuracy || 0, t: r.timestamp || Date.now() } : null; }
      if (navigator.geolocation) return await new Promise((ok) => navigator.geolocation.getCurrentPosition((r) => ok({ p: [r.coords.latitude, r.coords.longitude], acc: r.coords.accuracy || 0, t: r.timestamp || Date.now() }), () => ok(null), { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }));
    } catch (e) { /* sin respuesta */ }
    return null;
  }
  // Qué dice una posición pedida a propósito: 'movido' (el GPS estaba dormido: se reinicia), 'quieto' (precisa y en el
  // mismo sitio: solo esto permite pausar), 'incierto' (imprecisa, rara o sin respuesta: nunca justifica pausar) o
  // 'cancelado' (mientras se esperaba, el paseo terminó, se pausó o empezó otro: la respuesta ya no vale para nada)
  const coordOk = (p) => Array.isArray(p) && isFinite(p[0]) && isFinite(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180 && !(p[0] === 0 && p[1] === 0);
  async function gpsDespierto() {
    const ses = session;   // (la respuesta es para ESTE paseo)
    vigilando = true; vigilaT = Date.now();
    try {
      const q = await posicionAhora();
      if (session !== ses || !ses || ses.paused || mode !== 'gps') return 'cancelado';
      const ref = lastP || pos, g = gpsSt();
      const valida = q && coordOk(q.p), acc = valida ? +q.acc || 999 : 999;
      if (!valida) { if (g) g.reinicios = (g.reinicios || 0) + 1; avisoDiario('vig:sin respuesta'); PM.errores && PM.errores.add('aviso', 'GPS sin respuesta durante el paseo: se reinicia'); startGPS(); return 'incierto'; }
      const d = ref ? PM.geo.dist(q.p, ref) : 0;
      if (d > Math.max(60, acc)) {   // movido de verdad (más que su propio error): el GPS se había dormido
        if (g) g.reinicios = (g.reinicios || 0) + 1;
        avisoDiario('vig:movido ' + Math.round(d) + 'm');
        PM.errores && PM.errores.add('aviso', 'GPS dormido durante el paseo (te habías movido): se reinicia');
        startGPS();
        onFix({ latitude: q.p[0], longitude: q.p[1], accuracy: acc }, Date.now());   // (el tramo sin lecturas se rellena por las calles)
        return 'movido';
      }
      avisoDiario((acc <= 50 ? 'vig:quieto ' : 'vig:incierto ') + Math.round(acc) + 'm');
      return acc <= 50 ? 'quieto' : 'incierto';   // (en el mismo sitio: el GPS sigue vivo y no hay nada que rellenar)
    } finally { vigilando = false; }
  }
  // vigilante: 2 min sin ninguna lectura con el paseo en marcha → se mira si el GPS sigue vivo (andando llega una cada pocos
  // segundos; en el emulador, tras 5 min sin GPS con la pantalla bloqueada, el GPS ya no volvió solo hasta reiniciarlo).
  // También si el GPS se pidió y aún no ha dado NINGUNA lectura (antes ese caso quedaba fuera)
  var gpsPedidoT = 0;   // (var: startGPS puede llamarse antes de llegar aquí al arrancar)
  setInterval(() => {
    if (!gpsWanted() || vigilando) return;
    const ultimo = Math.max(lastBuenaT || 0, gpsPedidoT || 0, session.resumedAt || session.start || 0);
    if (!ultimo || Date.now() - ultimo < 2 * 60000 || Date.now() - vigilaT < 2 * 60000) return;
    gpsDespierto();
  }, 30000);
  // Al sacar el móvil del bolsillo (la app vuelve a verse) se mira en el acto: si hace más de 20 s que no llega ninguna
  // lectura, se pregunta ya la posición en vez de esperar a los 2 min del vigilante. Con la pantalla apagada Android puede
  // frenar los temporizadores de la app (el vigilante de arriba tarda más en saltar), pero este momento siempre llega.
  // Si te habías movido, el tramo se rellena por las calles; si no, no pasa nada.
  document.addEventListener('visibilitychange', () => {
    if (session && !session.paused) avisoDiario(document.hidden ? 'oculta' : 'visible');
    if (document.hidden || !gpsWanted() || vigilando) return;
    const ultimo = Math.max(lastBuenaT || 0, gpsPedidoT || 0, session.resumedAt || session.start || 0);
    if (Date.now() - ultimo < 20000 || Date.now() - vigilaT < 20000) return;
    gpsDespierto();
  });
  // Cada alta del GPS lleva un número: si mientras Android la prepara se finaliza o pausa el paseo (o se pide otra),
  // al llegar ya no vale y su vigilante se quita en el acto (antes quedaba un GPS encendido sin paseo).
  let gpsGen = 0, gpsPending = false;
  async function startGPS() {
    gpsPedidoT = Date.now();   // (el vigilante cuenta desde aquí si aún no llega ninguna lectura)
    // con el GPS nativo, el vigilante nuevo se crea ANTES de quitar el viejo: si el servicio se quedara un instante
    // sin vigilantes, Android le quita el «primer plano» y con la pantalla apagada ya no recibiría posiciones
    const old = gpsWatch && gpsWatch.bg ? gpsWatch : null;
    if (!old) stopGPS();
    const gen = ++gpsGen;
    gpsPending = true;
    try {
      if (BG) {
        // (una lectura solo vale de un vigilante en uso: el actual, o el que se está dando de alta y aún se quiere. Las que
        // llegan tarde de uno ya quitado o sustituido no mueven nada; el viejo sigue valiendo hasta que el nuevo esté listo)
        let mio = null;
        const vale = () => (mio != null && gpsWatch && gpsWatch.bg === mio) || (gen === gpsGen && gpsWanted());
        const id = await BG.addWatcher({
          backgroundTitle: PM.t('PintaMapa está pintando tus calles'),
          backgroundMessage: PM.t('Toca para volver al juego. Finaliza el paseo para apagar el GPS.'),
          requestPermissions: true, stale: false, distanceFilter: gpsSaver ? 25 : DISTANCE_FILTER,
        }, (loc, err) => {
          if (!vale()) return;
          if (err) {
            if (err.code === 'NOT_AUTHORIZED') toast('Necesito permiso de ubicación para pintar 📍', 'warn', 5000);
            return;
          }
          onFix(loc, loc.time);
        });
        if (gen !== gpsGen || !gpsWanted()) {   // ya no se quiere (o hay otra alta más nueva)
          Promise.resolve(BG.removeWatcher({ id })).catch(() => {});
          if (gen === gpsGen) gpsPending = false;
          if (gen === gpsGen && old) stopGPS();
          if (gpsWanted() && !gpsWatch && !gpsPending) startGPS();
          return;
        }
        mio = id;
        gpsWatch = { bg: id };
        if (old) Promise.resolve(BG.removeWatcher({ id: old.bg })).catch(() => {});
      } else if (navigator.geolocation) {
        const w = { web: null }, vale = () => gpsWatch === w;
        w.web = navigator.geolocation.watchPosition((p) => { if (vale()) onFix(p.coords, p.timestamp); },
          (e) => { if (vale()) toast('No se pudo obtener el GPS: ' + e.message, 'warn'); },
          { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
        gpsWatch = w;
      } else throw new Error('Este dispositivo no tiene GPS');
      gpsIcon('search');
    } catch (e) {
      // (en el móvil no hay simulación: el paseo sigue y el GPS se vuelve a pedir al volver a la app)
      if (PM.isNative) toast('GPS: ' + PM.esc(e.message || String(e)), 'warn', 5000);
      else { toast('GPS: ' + PM.esc(e.message || String(e)) + ' — paso a modo simulación', 'warn'); setMode('sim'); }
    } finally { if (gen === gpsGen) gpsPending = false; }
  }
  function stopGPS() {
    gpsGen++;   // (un alta a medio hacer ya no vale)
    gpsPending = false;
    gpsIcon('off');   // (también si no estaba en marcha: sin paseo el botón decía «Buscando GPS…»)
    if (!gpsWatch) return;
    if (gpsWatch.bg) Promise.resolve(BG.removeWatcher({ id: gpsWatch.bg })).catch(() => {});
    if (gpsWatch.web != null) navigator.geolocation.clearWatch(gpsWatch.web);
    gpsWatch = null;
  }
  // Una sola lectura para situarte en el mapa sin dejar el GPS encendido
  // (la lectura tarda: si mientras tanto empieza un paseo, o se pide otra, o se cambia de modo, ya no vale: no se salta a ella)
  let locateN = 0;
  function locateOnce() {
    const n = ++locateN;
    const ok = (c) => { if (n !== locateN || session || mode !== 'gps') return; pos = [c.latitude, c.longitude]; teleport(pos); };
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
  // con un paseo en marcha, el procesador del móvil no se suspende (la pantalla sí se apaga): si se suspendía, en el
  // bolsillo la app dejaba de recibir el GPS y de vigilarlo hasta que algo la despertaba (PmSystemPlugin.despierto)
  let despiertoOn = null;
  function despierto(on) {
    if (!isNative || despiertoOn === on) return;
    const P = nativePlugin('PmSystem');
    if (!P || !P.despierto) return;   // (APK anterior sin esta función: como antes)
    despiertoOn = on;
    P.despierto({ on }).catch(() => { despiertoOn = null; });
  }
  // (el bloqueo caduca solo a las 6 h, por seguridad: en un paseo más largo se renueva cada media hora; antes, pasadas 6 h, el
  // móvil volvía a poder dormirse en el bolsillo)
  setInterval(() => { if (gpsWanted() && despiertoOn === true) { despiertoOn = null; despierto(true); } }, 30 * 60000);
  function syncGPS() { despierto(!!gpsWanted()); if (gpsWanted()) { if (!gpsWatch && !gpsPending) startGPS(); } else stopGPS(); }

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
  // Android cerró la app con el paseo en marcha (en el bolsillo, o sin batería): el paseo SIGUE al volver, nunca queda en
  // pausa (antes, si habían pasado más de 20 min, se pausaba y lo que anduvieras después no se pintaba hasta pulsar ▶).
  // Si fue hace poco, el hueco desde tu última posición se rellena por las calles; si fue hace más de 20 min no se adivina
  // por dónde fuiste: empieza un tramo nuevo y ese rato sin la app no cuenta como tiempo de paseo
  let autoResumed = false, vueltaLarga = false;
  if (session && !session.paused) {
    autoResumed = true;
    if (Date.now() - (session.lastSeen || 0) >= 20 * 60000) {
      vueltaLarga = true;
      session.elapsed += Math.max(0, (session.lastSeen || session.resumedAt) - session.resumedAt);
      session.resumedAt = Date.now();
      if (session.track && session.track.length) session.track.push(null);   // corte del recorrido
    }
  }
  const newSessionStats = () => ({ walked: 0, painted: 0, pts: 0, pieces: 0, captures: 0, bestCombo: 0, conquests: 0 });
  // calidad del GPS del paseo (informe del resumen): t = segundos entre lecturas; corte = segundos de los cortes (más de 60 s sin
  // lecturas habiendo avanzado más de 40 m: parado no llegan lecturas y eso no es un corte); flojas, saltos y rebotes descartados
  function gpsSt() { return session && (session.st.gps || (session.st.gps = { t: 0, corte: 0, cortes: 0, flojas: 0, saltos: 0, rebotes: 0 })); }

  function sessionElapsed() {
    if (!session) return 0;
    return session.elapsed + (session.paused ? 0 : Date.now() - session.resumedAt);
  }
  function persistSession() { if (session) { session.lastSeen = Date.now(); session.gaps = pendingGaps; } S().session = session; PM.state.save(); }

  function startSession() {
    if (placesOff) setPlaces(false, true);   // pintando, los lugares se ven siempre (si no, pasarías de largo)
    session = { start: Date.now(), resumedAt: Date.now(), elapsed: 0, paused: false, st: newSessionStats(), track: [] };
    lastP = null; walkAnchor = null; cortarUnion();
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
    flushHeldFix();
    session.elapsed += Date.now() - session.resumedAt;
    session.paused = true;
    persistSession(); syncGPS(); renderSession();
    toast('⏸ En pausa: GPS apagado, no gasta batería', 'info');
  }
  function resumeSession() {
    if (!session || !session.paused) return;
    session.paused = false; session.resumedAt = Date.now();
    if (session.track && session.track.length && session.track[session.track.length - 1] !== null) session.track.push(null);   // corte del recorrido (pausa)
    lastP = null; walkAnchor = null; paintPrev = null; recentP = []; cortarUnion();   // no se pinta el "salto" desde donde pausaste
    persistSession(); syncGPS(); renderSession();
    PM.update.hold();
    toast('▶ ¡Seguimos pintando!', 'info');
  }
  // Repaso del recorrido al terminar el paseo (petición del usuario, 11-nov-2026): se vuelven a recorrer las posiciones GPS
  // guardadas y se pinta lo que se quedó sin pintar «por lo que sea»: calles que aún no habían llegado al móvil, un salto del
  // GPS en el bolsillo, un hueco que no se pudo rellenar a tiempo… Con las MISMAS reglas que al andar (tramosEn: la calle por
  // la que vas, en tu dirección; los huecos, por el camino más corto por las calles y solo si se pudo hacer a pie), así que no
  // pinta nada que no se hubiera pintado en marcha con todo a favor. Solo pinta lo nuevo: no cuenta pasadas otra vez.
  // Nunca cruza un corte del recorrido (una pausa, un trayecto en vehículo, la app cerrada mucho rato): ahí no se sabe por
  // dónde fuiste. Devuelve { n: tramos, m: metros pintados, falta: trozos cuyas calles no están cargadas (se repasan luego) }.
  let enRepaso = false;
  function repintarRecorrido(track, i0 = 1, i1 = track.length) {
    const painted = S().painted, res = { n: 0, m: 0, falta: 0 };
    const pinta = (pc) => { if (pc && !painted[pc.id]) { G.paintPiece(pc, false); res.n++; res.m += pc.len; } };
    // (paso a paso, un tramo solo se da por pisado si le toca en 2 pasos o más —van cada 4 m y un tramo mide unos 11—: una
    // lectura suelta desviada no pinta la calle de al lado. PM.debug.repasoMin lo cambia en las pruebas)
    const toques = new Map(), toca = (pc) => { if (!painted[pc.id]) toques.set(pc, (toques.get(pc) || 0) + 1); }, MIN = PM.debug.repasoMin || 2;
    const gR = recentP, gP = paintPrev, era = enRepaso;
    let prev = null; recentP = []; enRepaso = true;
    try {
      for (let i = Math.max(1, i0); i < i1; i++) {
        const a = track[i - 1], b = track[i];
        if (!a || !b) { prev = null; recentP = []; continue; }
        const d = PM.geo.dist(a, b);
        if (d < 0.5) continue;
        if (!streetsReady(a) || !streetsReady(b)) { res.falta++; prev = null; recentP = []; continue; }
        const rumbo = [b[0] - a[0], (b[1] - a[1]) * Math.cos(b[0] * Math.PI / 180)];
        const dt = (b[2] || 0) - (a[2] || 0);
        if (d <= 20) {
          // lecturas seguidas: como en marcha, con la posición suavizada de lado (media de las 3 últimas)
          if (!prev) for (const pc of tramosEn(a, null).lista) toca(pc);
          const bs = lateralSmooth(b), de = prev || a, st = Math.ceil(d / 4);
          for (let k = 1; k <= st; k++) for (const pc of tramosEn(PM.geo.lerp(de, bs, k / st), rumbo).lista) toca(pc);
          prev = bs;
          continue;
        }
        // hueco entre dos puntos del recorrido: el camino más corto por las calles, si se pudo hacer a pie
        prev = null; recentP = [];
        if (d >= 3000 || (dt > 0 && d / dt > MAX_SPEED)) continue;
        const maxLen = Math.max(d * 2, d + 250), r = W.route(a, b, maxLen);
        if (r && r.len <= maxLen && (!(dt > 0) || r.len / dt <= MAX_SPEED * 1.5)) { for (const id of r.pieces) pinta(W.pieces[id]); }
        else if (!r && d < 400) { const st = Math.ceil(d / 4); for (let k = 0; k <= st; k++) for (const pc of tramosEn(PM.geo.lerp(a, b, k / st), rumbo).lista) toca(pc); }   // (sin camino: lo que haya justo en línea recta, como en marcha)
      }
      for (const [pc, n] of toques) if (n >= MIN || pc.len < 8) pinta(pc);
    } finally { recentP = gR; paintPrev = gP; enRepaso = era; }
    return res;
  }
  // las zonas de calles que hacen falta para repasar un trozo del recorrido (con las vecinas si pasa junto al borde, y las
  // de en medio en los huecos largos)
  function zonasDe(pts) {
    const ks = new Set(), pon = (q, m) => { for (const dy of [-m, m]) for (const dx of [-m, m]) ks.add(W.tileKeyOf(q[0] + dy, q[1] + dx)); };
    for (let i = 0; i < pts.length; i++) {
      const q = pts[i]; if (!q) continue;
      pon(q, 0.0007);
      const a = pts[i - 1], d = a ? PM.geo.dist(a, q) : 0;
      if (a && d > 300 && d < 3000) { const n = Math.ceil(d / 300); for (let k = 1; k < n; k++) pon(PM.geo.lerp(a, q, k / n), 0.004); }
    }
    return ks;
  }
  // Repaso pendiente: al terminar solo se puede repasar lo que sigue cargado (unos 2 km alrededor; en un paseo largo las
  // calles del principio ya salieron de la memoria) y, sin cobertura, puede que ni eso. Lo que falta se repasa después, en
  // segundo plano: sin paseo en marcha, con la app a la vista y a trozos (las calles de cada trozo se cargan, se repasa y
  // se sigue). Si no hay red, se vuelve a intentar cada media hora.
  let repBusy = false;
  const repTry = {};
  async function repasoPendiente() {
    if (!begun || repBusy || !mapReady || document.hidden || session || !geoReady || PM.debug.sinRepaso) return;
    const w = (S().walks || []).slice().reverse().find((x) => x && x.rev === 0 && Array.isArray(x.track) && Date.now() - (repTry[x.id] || 0) > 30 * 60000);
    if (!w) return;
    repBusy = true; repTry[w.id] = Date.now();
    try {
      const tr = w.track;
      let m = 0, unidos = 0, falta = 0, i = 1;
      while (i < tr.length) {
        // un trozo del recorrido cuyas zonas quepan de sobra en memoria (unas 12)
        const ks = new Set();
        let j = i;
        for (; j < tr.length; j++) {
          const mas = [...zonasDe(tr.slice(j - 1, j + 1))].filter((k) => !ks.has(k));
          if (ks.size + mas.length > 12 && j > i) break;
          mas.forEach((k) => ks.add(k));
        }
        repZonas.clear(); ks.forEach((k) => repZonas.add(k));
        const miss = [...ks].filter((k) => !(W.tiles[k] && W.tiles[k].loaded));
        if (miss.length) { try { await W.ensureKeys(miss); } catch (e) { /* sin red: lo que haya */ } }
        if (session || document.hidden || !(S().walks || []).includes(w)) { delete repTry[w.id]; return; }   // (empezó un paseo, se guardó el móvil o cambió la partida: en otro momento)
        const r = repintarRecorrido(tr, i, j);
        let u = [0, 0]; try { enRepaso = true; u = repasarPaseo({ track: tr.slice(i - 1, j) }); } finally { enRepaso = false; }
        m += r.m + u[1]; falta += r.falta; unidos += u[0];
        i = j;
      }
      if (!falta) w.rev = 1;
      if (m > 0 || unidos) {
        const st = w.st || (w.st = {});
        st.repaso = (st.repaso || 0) + Math.round(m); if (unidos) st.unidos = (st.unidos || 0) + unidos;
        flushPaint();
        toast(`🧩 ${PM.t('Repaso de tu paseo')}: ${PM.fmtDist(m)} ${PM.t('más pintados')}`, 'ok', 6000);
        PM.sync.auto();
      }
      PM.state.save();
    } catch (e) { console.warn('Repaso pendiente', e); } finally { repBusy = false; enRepaso = false; repZonas.clear(); }
  }
  setInterval(repasoPendiente, 20000);
  // Repaso al acabar el paseo («postproducción», idea del usuario): con todo el recorrido delante se unen los cortes que
  // quedaron en lo pintado. Con el GPS cortando las esquinas (y algo desviado de la calle), la unión en el momento no
  // siempre se atreve: quedaban esquinas sin unir y trozos sueltos de 5-15 m. Aquí, cada dos extremos sueltos de lo pintado
  // junto a tu recorrido, a menos de 40 m, se unen por las calles si el camino es corto (sin rodeos) y va pegado a por
  // donde pasaste. Nada de calles que no has pisado. Devuelve [cortes unidos, metros pintados].
  function repasarPaseo(s) {
    const track = (s.track || []), tramos = [];
    for (let i = 1; i < track.length; i++) if (track[i] && track[i - 1] && PM.geo.dist(track[i - 1], track[i]) < 80) tramos.push([track[i - 1], track[i]]);
    if (!tramos.length) return [0, 0];
    const painted = S().painted;
    // pasillo de tu recorrido (rejilla de ~110 m para medir rápido)
    const GR = 0.001, rej = new Map(), kG = (p) => Math.floor(p[0] / GR) + '_' + Math.floor(p[1] / GR);
    for (const t of tramos) for (const q of [t[0], t[1], PM.geo.lerp(t[0], t[1], 0.5)]) { const k = kG(q); if (!rej.has(k)) rej.set(k, []); if (!rej.get(k).includes(t)) rej.get(k).push(t); }
    const aRecorrido = (p) => { const i = Math.floor(p[0] / GR), j = Math.floor(p[1] / GR); let d = Infinity; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const t of rej.get((i + a) + '_' + (j + b)) || []) d = Math.min(d, PM.geo.distToPolyline(p, t)); return d; };
    // lo pintado junto a tu recorrido y sus extremos sueltos (que no tocan otro tramo pintado)
    const cerca = new Map();
    for (const t of tramos) for (const q of [t[0], PM.geo.lerp(t[0], t[1], 0.5)]) for (const pc of W.piecesNear(q, 20)) if (painted[pc.id] && !pc.trail) cerca.set(pc.id, pc);
    const toca = (e, yo) => W.piecesNear(e, 3).some((o) => o.id !== yo && painted[o.id] && (PM.geo.dist(o.pts[0], e) < 2 || PM.geo.dist(o.pts[o.pts.length - 1], e) < 2 || PM.geo.distToPolyline(e, o.pts) < 1));
    const sueltos = [];
    for (const pc of [...cerca.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) for (const e of [pc.pts[0], pc.pts[pc.pts.length - 1]]) if (aRecorrido(e) < 25 && !toca(e, pc.id)) sueltos.push({ e, id: pc.id });
    // trazos: lo pintado que ya está unido entre sí (solo se juntan extremos de trazos DISTINTOS: dos extremos del mismo
    // trazo ya están unidos, y cerrarlos pintaba el otro lado de una rotonda o de una lágrima por donde no pasaste)
    const padre = new Map([...cerca.keys()].map((id) => [id, id]));
    const raiz = (x) => { while (padre.get(x) !== x) { padre.set(x, padre.get(padre.get(x))); x = padre.get(x); } return x; };
    const unir = (a, b) => { if (padre.has(a) && padre.has(b)) padre.set(raiz(a), raiz(b)); };
    for (const pc of cerca.values()) for (const e of [pc.pts[0], pc.pts[pc.pts.length - 1]]) for (const o of W.piecesNear(e, 3)) if (o.id !== pc.id && padre.has(o.id) && (PM.geo.dist(o.pts[0], e) < 2 || PM.geo.dist(o.pts[o.pts.length - 1], e) < 2 || PM.geo.distToPolyline(e, o.pts) < 1)) unir(pc.id, o.id);
    // pares de extremos sueltos, de más cerca a más lejos
    const pares = [];
    for (let i = 0; i < sueltos.length; i++) for (let j = i + 1; j < sueltos.length; j++) {
      if (sueltos[i].id === sueltos[j].id || raiz(sueltos[i].id) === raiz(sueltos[j].id)) continue;
      const d = PM.geo.dist(sueltos[i].e, sueltos[j].e);
      if (d >= 2 && d <= 40) pares.push([d, sueltos[i], sueltos[j]]);
    }
    pares.sort((x, y) => x[0] - y[0] || (x[1].id + x[2].id < y[1].id + y[2].id ? -1 : 1));
    // Esquinas: se prolonga cada calle pintada (la misma calle, en línea: < 25°) hasta 25 m. Si las prolongaciones de dos
    // extremos sueltos se encuentran en el mismo cruce, se pinta hasta ahí. Solo alarga lo que ya pintabas hasta donde se
    // junta (el GPS corta la esquina y, algo desviado, deja el cruce a 20 m de tus lecturas: el pasillo no lo alcanzaba)
    const pegados = (q) => W.piecesNear(q, 3).filter((o) => !o.trail && (PM.geo.dist(o.pts[0], q) < 1.5 || PM.geo.dist(o.pts[o.pts.length - 1], q) < 1.5));
    function prolongar(su) {
      const pc = W.pieces[su.id]; if (!pc) return null;
      const otro = PM.geo.dist(pc.pts[0], su.e) < PM.geo.dist(pc.pts[pc.pts.length - 1], su.e) ? pc.pts[pc.pts.length - 1] : pc.pts[0];
      const kx = Math.cos(su.e[0] * Math.PI / 180), vec = (a, b) => { const v = [b[0] - a[0], (b[1] - a[1]) * kx], l = Math.hypot(v[0], v[1]); return l ? [v[0] / l, v[1] / l] : null; };
      let dir = vec(otro, su.e), cur = su.e, largo = 0; const cadena = [], vistos = new Set([pc.id]), puntos = [su.e];
      while (dir && largo <= 25) {
        let mejor = null, bc = 0.9;
        for (const o of pegados(cur)) {
          if (vistos.has(o.id)) continue;
          const lejos = PM.geo.dist(o.pts[0], cur) < PM.geo.dist(o.pts[o.pts.length - 1], cur) ? o.pts[o.pts.length - 1] : o.pts[0];
          const v = vec(cur, lejos), c = v ? v[0] * dir[0] + v[1] * dir[1] : 0;
          if (c > bc) { bc = c; mejor = [o, lejos, v]; }
        }
        if (!mejor) break;
        const [o, lejos, v] = mejor;
        if (painted[o.id]) break;   // (sigue en algo ya pintado: hasta aquí)
        vistos.add(o.id); cadena.push(o); largo += o.len; cur = lejos; dir = v;
        puntos.push(cur);
      }
      return { cadena, puntos };   // (puntos[i]: hasta dónde llega con los i primeros tramos de la cadena)
    }
    // el primer sitio donde se encuentran las dos prolongaciones (o una llega al extremo de la otra): lo que hay que pintar
    function cierre(A, B) {
      const pa = prolongar(A), pb = prolongar(B);
      if (!pa || !pb) return null;
      let mejor = null;
      const toma = (i, j) => { if ((i || j) && (!mejor || i + j < mejor[0] + mejor[1])) mejor = [i, j]; };
      for (let i = 0; i < pa.puntos.length; i++) for (let j = 0; j < pb.puntos.length; j++) {
        if (PM.geo.dist(pa.puntos[i], pb.puntos[j]) < 2) toma(i, j);
        // (los tramos van por casillas de ~11 m y una calle desemboca en mitad de un tramo de la otra: también vale)
        if (i && PM.geo.distToPolyline(pb.puntos[j], pa.cadena[i - 1].pts) < 2) toma(i, j);
        if (j && PM.geo.distToPolyline(pa.puntos[i], pb.cadena[j - 1].pts) < 2) toma(i, j);
      }
      return mejor ? pa.cadena.slice(0, mejor[0]).concat(pb.cadena.slice(0, mejor[1])) : null;
    }
    let n = 0, m = 0;
    for (const [d, A, B] of pares) {
      if (raiz(A.id) === raiz(B.id) || (toca(A.e, A.id) && toca(B.e, B.id))) continue;   // (ya unidos por un par anterior)
      if (d <= 25) {
        const esquina = cierre(A, B);
        if (esquina && esquina.length && esquina.reduce((a, q) => a + q.len, 0) <= 40 &&esquina.every((q) => aRecorrido(q.mid) < 25)) {
          const nuevos = esquina.filter((q) => !painted[q.id]);
          for (const q of nuevos) G.paintPiece(q, false);
          n++; m += nuevos.reduce((a, q) => a + q.len, 0); unir(A.id, B.id);
          continue;
        }
      }
      const r = W.route(A.e, B.e, d * 1.6 + 15);
      if (!r || !r.pieces.length || r.len > d * 1.6 + 15) continue;
      const pcs = r.pieces.map((id) => W.pieces[id]).filter(Boolean);
      const nuevos = pcs.filter((q) => !painted[q.id]);
      if (!nuevos.length) continue;
      const largo = nuevos.reduce((a, q) => a + q.len, 0);
      if (largo > 45 || nuevos.some((q) => q.trail)) continue;
      // pegado a tu recorrido: el GPS se desvía de la calle y en las esquinas corta, así que el margen crece con el hueco
      const margen = (pcs.every((q) => q.ped) ? 25 : 15) + d * 0.3;
      const muestras = (r.path || []).concat(nuevos.map((q) => q.mid));
      if (muestras.some((q) => aRecorrido(q) > margen)) continue;
      for (const q of nuevos) G.paintPiece(q, false);
      n++; m += largo; unir(A.id, B.id);
    }
    return [n, m];
  }
  function endSession() {
    if (!session) return;
    flushHeldFix();
    // huecos pendientes (GPS en el bolsillo justo al final, calles aún sin llegar): se pintan si ya se puede; si no, al
    // menos cuentan los metros y el recorrido (antes se tiraban al cerrar el paseo)
    retryGaps(true);
    // repaso: se pinta lo que faltaba a lo largo del recorrido y se unen los cortes que quedaron en lo pintado
    let repaso = [0, 0], rp = { n: 0, m: 0, falta: 0 };
    if (!PM.debug.sinRepaso) {
      try { rp = repintarRecorrido(session.track || []); } catch (e) { console.warn('Repaso del recorrido', e); }
      try { enRepaso = true; repaso = repasarPaseo(session); } catch (e) { console.warn('Repaso del paseo', e); } finally { enRepaso = false; }
    }
    if (rp.m > 0) session.st.repaso = Math.round(rp.m);
    if (repaso[0]) session.st.unidos = repaso[0];
    if (rp.n || repaso[0]) flushPaint();
    if (!session.paused) session.elapsed += Date.now() - session.resumedAt;
    const s = session; session = null;
    if (s.elapsed >= 120000) {   // los paseos de menos de 2 minutos no se guardan en el historial (lo pintado sí cuenta)
      // (rev: 0 = quedan trozos por repasar cuando sus calles estén cargadas —repasoPendiente—; 1 = repasado entero)
      S().walks.push({ id: String(s.start), start: s.start, elapsed: s.elapsed, st: s.st, track: s.track || [], rev: rp.falta && !PM.debug.sinRepaso ? 0 : 1, diario: s.diario || [], avisos: s.avisos || [] });
    }
    persistSession(); syncGPS(); renderSession();
    showSummary(s);
    PM.sync.auto(toast);
    setTimeout(backupReminder, 8000);
    setTimeout(() => PM.update.check(false), 5000);
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
  // copia en la nube cada 30 min mientras paseas (si Android cierra la app, no se pierde lo pintado); al terminar, siempre
  setInterval(() => { if (session && !session.paused) PM.sync.auto(); }, 30 * 60000);

  // Informe de calidad del GPS del paseo: cuánto rato hubo lecturas y cuántas veces se cortó (para saber si un tramo sin
  // pintar es del GPS, de Android frenando la app con la pantalla apagada, o de una zona sin calles en el mapa)
  function informeGPS(st) {
    const g = st && st.gps;
    if (!g || g.t < 120) return '';
    const pct = Math.max(0, Math.min(100, Math.round(100 * (1 - g.corte / g.t))));
    const min = Math.max(1, Math.round(g.corte / 60));
    // (solo si hubo algo que contar: con el GPS bien todo el paseo, el resumen no lo menciona)
    if (!g.cortes && !g.reinicios && (g.flojas || 0) < 10 && (g.rebotes || 0) < 3 && pct >= 95) return '';
    const partes = [`<span>GPS con señal el ${pct} % del paseo.</span>`];
    partes.push(g.cortes ? `<span>${g.cortes === 1 ? `1 corte (${min} min sin lecturas).` : `${g.cortes} cortes (${min} min sin lecturas).`}</span>` : '<span>Sin cortes.</span>');
    if (g.flojas >= 10) partes.push(`<span>${g.flojas} lecturas imprecisas (en el bolsillo el GPS pierde precisión): ese tramo se ha pintado siguiendo las calles.</span>`);
    if (g.rebotes) partes.push(`<span>${g.rebotes === 1 ? '1 rebote del GPS descartado.' : `${g.rebotes} rebotes del GPS descartados.`}</span>`);
    if (g.reinicios) partes.push(`<span>${g.reinicios === 1 ? 'El GPS se durmió 1 vez y lo desperté.' : `El GPS se durmió ${g.reinicios} veces y lo desperté.`}</span>`);
    // muchos cortes: casi siempre es el ahorro de batería de Android frenando el GPS con la pantalla apagada
    const malo = g.cortes >= 2 || g.corte > 180 || g.reinicios >= 2;
    return `<p class="muted gps-inf">📡 ${partes.join(' ')}</p>` + (malo ? `<p class="muted">Los cortes suelen ser el ahorro de batería del móvil frenando el GPS con la pantalla apagada.${
      isNative && PmSys ? ' <button class="btn" id="gps-bat">🔋 Quitar el ahorro de batería</button>' : ''} Si alguna calle quedó sin pintar, mantenla pulsada en el mapa.</p>` : '');
  }
  function showSummary(s) {
    const st = s.st, movMs = PM.movingMs(s), min = movMs / 60000;   // velocidad con el tiempo en movimiento (como Strava)
    const kmh = min > 0 ? (st.walked / 1000) / (min / 60) : 0;
    // (empezar y terminar sin moverse: antes salía «¡Paseo completado!» a pantalla completa, con confeti, para 0 m)
    if ((st.walked || 0) < 20 && !(st.painted > 0) && !st.captures) { toast('🏁 Paseo terminado: no te has movido, así que no se guarda', 'info', 3500); return; }
    // cuatro cifras grandes (lo que importa) y el resto en una línea
    const extra = [st.captures ? `🏛️ ${st.captures} ${st.captures === 1 ? 'lugar' : 'lugares'}` : '', st.conquests ? `🚩 ${st.conquests} ${st.conquests === 1 ? 'barrio conquistado' : 'barrios conquistados'}` : '',
      st.repassed ? `🔥 ${PM.fmtDist(st.repassed)} repasados` : '', st.bestCombo > 1 ? `✖️ combo x${st.bestCombo}` : '', kmh > 0.5 && kmh < 25 ? `⚡ ${PM.dec(kmh, 1)} km/h` : ''].filter(Boolean);
    openSheet('🏁 Paseo terminado', `
      <p class="muted">${new Date(s.start).toLocaleString(PM.LOCALE, { dateStyle: 'medium', timeStyle: 'short' })}${movMs < s.elapsed - 60000 ? ` · total ${fmtTime(s.elapsed)}` : ''}</p>
      <div class="stats cuatro">
        <div><b>${PM.fmtDist(st.walked)}</b><small>caminados</small></div>
        <div><b>${PM.fmtDist(st.painted)}</b><small>calles nuevas</small></div>
        <div><b>${fmtTime(movMs)}</b><small>en movimiento</small></div>
        <div><b>+${PM.fmtNum(st.pts)}</b><small>puntos</small></div>
      </div>
      ${extra.length ? `<p class="sum-extra">${extra.map((x) => `<span>${x}</span>`).join(' · ')}</p>` : ''}
      ${informeGPS(st)}
      ${st.repaso ? `<p class="muted">🧩 Repaso: he pintado ${PM.fmtDist(st.repaso)} que se habían quedado sin pintar en tu recorrido.</p>` : ''}
      ${st.unidos ? `<p class="muted">🧩 Repaso: he unido ${st.unidos} ${st.unidos === 1 ? 'corte' : 'cortes'} de lo pintado (esquinas y trozos sueltos).</p>` : ''}
      ${st.painted > 0 ? '' : '<p class="muted">Hoy no pintaste calles nuevas: prueba por calles que aún estén grises.</p>'}
      ${s.elapsed >= 120000 ? '<button class="btn on" id="sum-detail">📊 Estadísticas, vídeo y exportar</button>' : ''}`);
    if ($('#sum-detail')) $('#sum-detail').addEventListener('click', () => openWalk(S().walks.find((w) => w.id === String(s.start))));
    if ($('#gps-bat')) $('#gps-bat').addEventListener('click', async () => { try { await PmSys.requestBattery(); } catch (e) { toast('Ábrelo en Ajustes → Aplicaciones → PintaMapa → Batería → Sin restricciones', 'warn', 6000); } });
    celebrate('¡Paseo completado!', `${PM.fmtDist(st.walked)} caminados · ${PM.fmtDist(st.painted)} pintados · +${PM.fmtNum(st.pts)} pts`, '🏁');
  }

  // Detalle de un paseo (estadísticas tipo Strava, vídeo y exportar GPX/KML/KMZ…)
  async function openWalk(w) {
    if (!w) return;
    const keys = [...new Set((w.track || []).filter(Boolean).map((q) => W.tileKeyOf(q[0], q[1])))].filter((k) => !(W.tiles[k] && W.tiles[k].loaded));
    if (keys.length && keys.length <= 40) { toast('🗺️ Cargando las calles del recorrido…', 'info', 2000); await W.ensureKeys(keys); }
    const geo = {};
    for (const id in S().painted) { const pc = W.pieces[id]; if (pc) geo[id] = pc.pts; else if (pgeo.has(id)) geo[id] = pgeo.get(id).p; }   // (también lo de zonas no cargadas)
    await PM.need('lib/mp4-muxer.js', 'js/replay.js');
    // lugares conquistados (o vueltos a visitar) durante ESTE paseo: salen en el vídeo con su círculo y confeti
    const fin = w.start + Math.max(w.elapsed || 0, ...(w.track || []).filter(Boolean).map((q) => (q[2] || 0) * 1000)) + 60000;
    const caps = Object.values(S().landmarks).filter((r) => r && r.pos && ((r.t >= w.start && r.t <= fin) || (r.last >= w.start && r.last <= fin)))
      .map((r) => ({ pos: r.pos, name: r.name, emoji: r.emoji || '📍', nuevo: r.t >= w.start, must: !!r.must }));
    PM.replay.open(w, { geo, color: paintColor(), player: PM.player && PM.player.name, caps });
  }
  // Tus mejores marcas (arriba de «Mis paseos»): cinco, las que más dicen; cada una abre su paseo
  function marcasHTML() {
    const D = profileData(), st = D.st;
    if (!D.walks.length) return '';
    const pace = (ms, m) => { if (!m || m < 50) return '—'; const sec = ms / 1000 / (m / 1000); return Math.floor(sec / 60) + ':' + String(Math.round(sec % 60)).padStart(2, '0') + ' /km'; };
    const when = (w) => w ? new Date(w.start).toLocaleDateString(PM.LOCALE, { day: 'numeric', month: 'short', year: '2-digit' }) : '';
    const rec = (ic, l, v, w) => `<div class="pf-rec" ${w ? `data-walk="${esc(w.id)}"` : ''}><span>${ic}</span><div><small>${l}</small><b>${v}</b></div><em>${w ? when(w) + ' ›' : ''}</em></div>`;
    const L = D.best((w) => w.st.walked || 0), P = D.best((w) => w.st.painted || 0);
    return `<div class="pf-card"><h5>🥇 Tus mejores marcas</h5>
      ${rec('🥾', 'Paseo más largo', PM.fmtDist(L.st.walked), L)}
      ${rec('🖌️', 'Más calles nuevas en un paseo', PM.fmtDist(P.st.painted), P)}
      ${D.fastest ? rec('⚡', 'Ritmo más rápido', pace(PM.movingMs(D.fastest), D.fastest.st.walked), D.fastest) : ''}
      ${D.bestDay ? rec('📅', 'Mejor día', PM.fmtDist(D.bestDay[1].painted) + ' pintados · ' + new Date(D.bestDay[0] + 'T12:00').toLocaleDateString(PM.LOCALE, { day: 'numeric', month: 'short' })) : ''}
      ${rec('🔥', 'Racha más larga', D.maxStreak + ' días')}</div><h4>📋 Todos tus paseos</h4>`;
  }
  function panelWalks() {
    const ws = (S().walks || []).slice().reverse();
    openSheet('🥾 Mis paseos', marcasHTML() + (ws.length ? ws.map((w, i) => `<div class="mission walk-row" data-i="${i}"><div class="mt">${new Date(w.start).toLocaleString(PM.LOCALE, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}<span>${PM.fmtDist(w.st.walked || 0)} ›</span></div>
      <small>⏱ ${fmtTime(PM.movingMs(w))} · 🖌️ ${PM.fmtDist(w.st.painted || 0)} nuevas · +${PM.fmtNum(w.st.pts || 0)} pts${w.imported ? ' · ⌚ importado' : ''}</small></div>`).join('')
      : '<p class="muted">Aún no hay paseos de más de 2 minutos.</p>') +
      `<h4>⌚ Paseo grabado con un reloj</h4><p class="muted">¿Saliste solo con el reloj (Garmin, Apple Watch, Wear OS, Polar, Suunto…)? Exporta la actividad como <b>GPX</b> o <b>TCX</b> desde su app y súbela aquí: se pintan sus calles igual que andando con el móvil.</p>
      <button class="btn" id="imp-gpx">📂 Importar GPX / TCX</button><p class="muted" id="imp-msg"></p>`);
    document.querySelectorAll('.walk-row').forEach((el) => el.addEventListener('click', () => openWalk(ws[+el.dataset.i])));
    document.querySelectorAll('.pf-rec[data-walk]').forEach((r) => r.addEventListener('click', () => openWalk(S().walks.find((w) => w.id === r.dataset.walk))));
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
      const segs = PM.tramosGPX(xml);
      const pts = [].concat(...segs);
      if (pts.length < 2) { msg('❌ No encuentro puntos de recorrido en el archivo.'); return; }
      // la duración es la del archivo (antes, uno corto se guardaba como de 2 min). Sin horas no es un recorrido hecho, es una
      // ruta planificada: no se pinta. Y de menos de 2 min no se importa, como los paseos cortos
      const horas = pts.map((q) => q.t).filter(isFinite), t0 = horas[0], t1 = horas[horas.length - 1];
      if (!isFinite(t0) || !isFinite(t1) || t1 <= t0) { msg('❌ ' + PM.t('El archivo no trae la hora de cada punto: parece una ruta planificada, no un recorrido hecho. No se importa.')); return; }
      if (t1 - t0 < 120000) { msg('❌ ' + PM.t('El recorrido dura menos de 2 minutos: no se importa (los paseos cortos no se guardan).')); return; }
      if ((S().walks || []).some((w) => w.id === 'gpx' + t0)) { msg('Este recorrido ya estaba importado.'); return; }
      msg('⏳ Cargando las calles del recorrido…');
      const keys = [...new Set(pts.map((q) => W.tileKeyOf(q.lat, q.lon)))];
      msg(`⏳ Cargando calles (${keys.length} zona${keys.length > 1 ? 's' : ''})…`);
      await W.ensureKeys(keys);
      msg('🖌️ Pintando…');
      const st = { walked: 0, painted: 0, pts: 0, pieces: 0, captures: 0, bestCombo: 0, conquests: 0, repassed: 0 };
      const before = { m: S().stats.paintedM, xp: S().xp };
      const track = [];
      // cada tramo del archivo por separado: entre uno y otro no se pinta ni se suma nada, y el recorrido guarda el corte
      segs.forEach((seg, si) => {
        if (si && track.length) track.push(null);
        let last = null;
        for (let i = 0; i < seg.length; i++) {
          const q = [seg[i].lat, seg[i].lon];
          if (i) {
            const a = [seg[i - 1].lat, seg[i - 1].lon], d = PM.geo.dist(a, q);
            if (d < 400) { const n = Math.ceil(d / 4), hd = [q[0] - a[0], (q[1] - a[1]) * Math.cos(q[0] * Math.PI / 180)]; for (let k = 1; k <= n; k++) paintAround(PM.geo.lerp(a, q, k / n), hd); st.walked += d; }
          }
          if (!last || PM.geo.dist(last, q) >= 8 || i === seg.length - 1) {
            const p = [+q[0].toFixed(6), +q[1].toFixed(6), Math.round(((isFinite(seg[i].t) ? seg[i].t : t0) - t0) / 1000)];
            if (isFinite(seg[i].e)) p.push(Math.round(seg[i].e * 10) / 10);
            track.push(p); last = q;
          }
        }
      });
      st.painted = S().stats.paintedM - before.m; st.pts = S().xp - before.xp;
      G.addWalk(st.walked);
      S().walks.push({ id: 'gpx' + t0, start: t0, elapsed: t1 - t0, st, track, imported: true });
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
      // (la zona de donde estás, no null: quieto no llega otra lectura y el rótulo se quedaba en «Cargando calles…»)
      curTile = W.tileKeyOf(pos[0], pos[1]); W.ensureAround(pos[0], pos[1]);
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
      : (turbo && mode === 'sim' ? `🚀 ${kmh.toFixed(0)} km/h` : `${pc.icon} ${PM.dec(kmh, 1)} km/h`);
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
  // los porcentajes recorren todos los tramos del barrio y todas las zonas: solo si has pintado algo, cambias de sitio o pasa 1 s
  let hudV = null;
  function hudPct(id, B, city) {
    const m = S().stats.paintedM, now = Date.now();
    if (!hudV || hudV.id !== id || hudV.city !== city || hudV.m !== m || now - hudV.t > 1000) hudV = { id, city, m, t: now, pr: B ? G.barrioProgress(id) : 0, cp: city ? G.cityProgress(city) : null };
    return hudV;
  }
  function updateHUD() {
    if (document.hidden) return;   // pantalla apagada: nada que pintar (antes, 4 veces por segundo en el bolsillo)
    const lp = G.levelProgress();
    setT('#lvl', lp.short); hudSet('lvlc', '#lvl', (e, x) => { e.title = 'Nivel ' + lp.label; e.style.color = x; }, lp.tier ? lp.tier.color : '');
    setW('#xpbar i', (lp.pct * 100).toFixed(1) + '%');
    setT('#xptext', `${PM.fmtNum(S().xp)} pts · v${PM.VERSION.app}`);
    const t = W.tiles[curTile];
    if (t && (t.loaded || t.partial) && (!hudB.p || hudB.dirty || PM.geo.dist(hudB.p, pos) > 8)) hudB = { p: pos.slice(), b: W.barrioAt(pos), dirty: false };
    const bq = t && (t.loaded || t.partial) ? hudB.b : null;
    const B = bq && W.barrios[bq.id];
    if (t && (t.loaded || t.partial)) {
      if (bq && bq.id !== curBarrio) { curBarrio = bq.id; ensureBT = 0; renderBarrios(); }
      const done = B && W.barrioComplete(bq.id);
      // sus zonas se piden al entrar y, mientras falte alguna, cada 15 s: si al entrar aún no había llegado el contorno del
      // barrio, la petición no hacía nada y el % se quedaba en «calculando…» hasta cambiar de barrio
      if (bq && !done && Date.now() - ensureBT > 15000) { ensureBT = Date.now(); W.ensureBarrio(bq.id); }
      const grande = B && !done && W.barrioGrande && W.barrioGrande(bq.id);
      const { pr, cp } = hudPct(bq && bq.id, B, t.city);
      if (bq && B && S().conqueredB[bq.id]) checkRank(bq.id, pr, B);
      if (bq && B && done) checkBarrioNear(bq.id, pr, B);
      setT('#barrio-name', (bq && S().conqueredB[bq.id] ? RANKS[rankOf(bq.id)].ic + ' ' : '') + ((B && B.name) || (bq && bq.name) || t.name || 'Barrio sin explorar'));
      setT('#barrio-pct', !B ? '' : grande ? 'barrio enorme' : !done ? 'calculando…' : B.total ? PM.dec(pr * 100, 1) + ' %' : 'sin calles');
      setW('#barrio-bar i', (pr * 100).toFixed(1) + '%');
      if (t.city) {
        if (begun) albumPisado(t);
        setT('#city', `${S().citiesWon[t.city] ? '👑 ' : '🏙️ '}${t.city} · ${PM.dec(cp.pct * 100, cp.pct < 0.01 ? 2 : 1)} %` +
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
  }
  setInterval(updateHUD, 250);

  // ---------------- Notificaciones y efectos ----------------
  // Un aviso a la vez (v0.9): antes se apilaban hasta tres y tapaban medio mapa. Los demás esperan su turno (como mucho 3 en
  // cola: sobra el más antiguo que no sea importante) y, si hay cola, el que se ve dura menos
  const colaToasts = [];
  let toastVivo = null;
  function toast(html, kind = 'ok', ms = 2600) {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.innerHTML = html;
    colaToasts.push([el, ms]);
    if (colaToasts.length > 3) { const i = colaToasts.findIndex(([e]) => !/\b(warn|gold)\b/.test(e.className)); colaToasts.splice(i >= 0 ? i : 0, 1); }
    if (!toastVivo) siguienteToast();
    return el;
  }
  function siguienteToast() {
    const nx = colaToasts.shift();
    if (!nx) { toastVivo = null; return; }
    const [el, ms] = nx, t = colaToasts.length ? Math.min(ms, 1800) : ms;
    toastVivo = el; $('#toasts').appendChild(el);
    setTimeout(() => el.classList.add('out'), t);
    setTimeout(() => { el.remove(); siguienteToast(); }, t + 400);
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

  // la partida no se pudo escribir en el móvil (sin espacio…): se avisa (se sigue reintentando sola)
  window.addEventListener('pm-save-error', (e) => toast('⚠️ ' + PM.t(e.detail === 'rota' ? 'Tu partida antigua no se podía leer y no hay sitio para apartarla: no se guarda nada encima hasta que liberes espacio en el móvil.' : 'No se pudo guardar la partida en el móvil (¿sin espacio?). Libera espacio o haz una copia de seguridad.'), 'warn', 8000));
  window.addEventListener('pm-rota-apartada', () => toast('✅ ' + PM.t('Tu partida antigua ya está apartada: se vuelve a guardar con normalidad.'), 'ok'));
  window.addEventListener('pm-save-ok', () => toast('✅ ' + PM.t('Partida guardada de nuevo'), 'ok'));
  // Fiesta de nivel (cada 10 niveles) o de rango (Bronce, Plata…): se carga fiesta.js al momento. Con el móvil guardado
  // espera a que vuelvas a verlo (si no, te la perderías)
  let fiestaPend = null;
  function fiesta(h, colores) {
    if (document.hidden) { if (!fiestaPend || h.tipo === 'rango' || fiestaPend.h.tipo !== 'rango') fiestaPend = { h, colores }; return; }
    const s = S();
    PM.need('js/fiesta.js').then(() => PM.fiesta.mostrar(h, { nombre: PM.player ? PM.player.name : '', km: (s.stats || {}).paintedM || 0, lugares: Object.keys(s.landmarks || {}).length,
      barrios: Object.keys(s.conqueredB || {}).length, colores: colores || [], enPaseo: !!(session && !session.paused) })).catch(() => toast('⭐ ¡' + PM.levelName(h.nivel).label + '!', 'gold'));
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && fiestaPend) { const p = fiestaPend; fiestaPend = null; setTimeout(() => fiesta(p.h, p.colores), 600); } });
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

  // confeti: estallido desde el centro (logros) o lluvia por toda la pantalla desde arriba (combos)
  let confettiRun = 0;
  function confetti(o = {}) {
    const cv = $('#confetti'), ctx = cv.getContext('2d'), run = ++confettiRun;
    cv.width = innerWidth; cv.height = innerHeight;
    const cols = [paintColor(), '#22d3ee', '#facc15', '#a3e635', '#ffffff', '#a855f7'];
    const parts = Array.from({ length: o.n || 160 }, () => (o.lluvia
      ? { x: Math.random() * innerWidth, y: -20 - Math.random() * innerHeight * 0.5, vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 4,
        s: 5 + Math.random() * 6, c: cols[Math.floor(Math.random() * cols.length)], r: Math.random() * 6, g: 0.12 }
      : { x: innerWidth / 2, y: innerHeight / 2, vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 14 - 4,
        s: 4 + Math.random() * 6, c: cols[Math.floor(Math.random() * cols.length)], r: Math.random() * 6, g: 0.35 }));
    // (en tiempo real: igual de rápido en una pantalla de 60 Hz que en una de 120 Hz)
    const t0 = performance.now(), dur = o.lluvia ? 2600 : 2200;
    let last = t0, f = 0;
    (function frame(now = performance.now()) {
      if (run !== confettiRun) return;   // (otro confeti más nuevo toma el relevo)
      const k = Math.min(3, (now - last) / 16.7); last = now; f += k;
      ctx.clearRect(0, 0, cv.width, cv.height);
      parts.forEach((p) => {
        p.vy += p.g * k; p.x += (p.vx + (o.lluvia ? Math.sin((f + p.r * 10) / 12) * 0.8 : 0)) * k; p.y += p.vy * k; p.r += 0.1 * k;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
        ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6); ctx.restore();
      });
      if (now - t0 < dur) requestAnimationFrame(frame); else ctx.clearRect(0, 0, cv.width, cv.height);
    })();
  }

  // ---------------- Eventos del juego ----------------
  let splatThrottle = 0, achQueue = [], achTimer = null;
  const cardQueue = [];
  function showNextCard() {
    if (document.hidden) return;
    const v = document.getElementById('tcg-view');
    if (!cardQueue.length || (v && v.classList.contains('show')) || document.getElementById('sobre')) return;   // (ni con un sobre abriéndose)
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
        paintedF.push(lineF(d.piece.pts, { h: 0 })); paintedAdd = true;   // solo el tramo nuevo (y sus uniones con lo ya pintado)
        for (const j of W.joinsOf(d.piece, (id) => !!S().painted[id])) paintedF.push(lineF(j, { h: 0 }));
        geoAdd(d.piece);
        if (session) { session.st.painted += d.piece.len; session.st.pieces++; session.st.bestCombo = Math.max(session.st.bestCombo, d.combo); }
        const now = performance.now();
        if (enRepaso) break;   // (el repaso del final pinta en silencio: ni salpicaduras ni avisos de combo)
        if (!document.hidden && now - splatThrottle > 120) {
          splatThrottle = now;
          floatText('+' + Math.round(d.pts), d.aura ? 'aura' : '');
          splat();
          PM.sound.splat(d.combo);
        }
        // combo: cada vez que sube el multiplicador (cada 10 calles nuevas seguidas, hasta ×3) y luego cada 50,
        // lluvia de confeti, sonido y vibración (solo con la pantalla encendida: en el bolsillo, nada que gastar)
        if (d.combo % 10 === 0 && (d.combo <= 80 || d.combo % 50 === 0)) {
          toast(`🔥 ¡Combo ${d.combo}! Pintura ×${d.mult.toFixed(2).replace(/\.?0+$/, '')} · sigue pintando calles nuevas`, 'combo');
          PM.vibrate([30, 40, 60]);
          if (!document.hidden) { confetti({ lluvia: true, n: Math.min(220, 70 + d.combo * 2) }); PM.sound.combo(d.combo); }
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
        } else toast(`${lm.emoji} Has vuelto a <b>${PM.esc(lm.name)}</b> · +${d.pts}`, 'ok');
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
        toast(`💯 ¡${PM.esc(d.name)} pintado al 100 %! +1000`, 'gold', 4000);
        break;
      case 'cityWon':
        celebrate('¡CIUDAD CONQUISTADA! 🥉', `Has pintado el 70 % de las calles de ${d.city}. Rango Bronce. +25000 · Plata al 80 %, Oro al 90 %`, '👑');
        break;
      case 'cityRank':
        celebrate(`¡${d.city}: ciudad de ${PM.RANKS[d.rank].name}! ${PM.RANKS[d.rank].ic}`, `Has pintado el ${d.rank === 1 ? 80 : 90} % de sus calles. +${d.rank === 1 ? '10000' : '15000'}`, PM.RANKS[d.rank].ic);
        break;
      case 'levelup': {
        // cada 10 niveles y al cambiar de rango: fiesta a pantalla completa (fiesta.js); el resto, el aviso de siempre
        const h = PM.hitoNivel(d.from != null ? d.from : d.level - 1, d.level);
        if (h) { fiesta(h, d.colors); break; }
        PM.sound.levelUp(); PM.vibrate([80, 40, 80]);
        toast(`${PM.levelName(d.level).tier ? PM.levelName(d.level).tier.icon : '⭐'} ¡Nivel ${PM.levelName(d.level).label}!` + (d.colors.length ? ` Nuevo color: <b style="color:${d.colors[0].c}">${d.colors[0].name}</b>` : ''), 'gold', 4000);
        break;
      }
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

  let fixT = null;
  W.onChange((ev, d) => {
    if (ev === 'barrios') { hudB.dirty = true; renderBarrios(); return; }
    if (ev === 'migrated') { paintedDirty = true; return; }
    if (ev === 'unloaded') {   // zonas lejanas quitadas de la memoria: sus calles grises dejan de dibujarse (lo pintado sigue)
      for (const k of [...rendered]) { const t = W.tiles[k]; if (!t || !(t.loaded || t.partial)) { rendered.delete(k); delete tileFeat[k]; } }
      streetsDirty = true; paintedDirty = true; hudB.dirty = true; wakeLoop();
      return;
    }
    if (ev === 'named') {
      if (W.updateMustSee()) { lmDirty = true; flushLandmarks(); }
      // (los nombres llegan de uno en uno, cada segundo, y repasar todas tus cartas por cada nombre pesa: una vez, al llegar el último)
      clearTimeout(fixT); fixT = setTimeout(() => { if (PM.fillLandmarkCities(S()) + W.fixRecords(S())) PM.state.save(); }, 1500);
      return;
    }
    if (ev === 'lmMigrated') { lmDirty = true; flushLandmarks(true); return; }   // (cartas pasadas al lugar vigente: se redibujan)
    // (varios de golpe, como al llegar la precarga de una ciudad: un solo redibujado, no uno de miles de iconos por cada lugar)
    if (ev === 'lmRemoved') { if (lmIndex[d.id]) { delete lmIndex[d.id]; clearTimeout(lmFlushT); lmFlushT = setTimeout(() => flushLandmarks(true), 60); } return; }
    if (ev === 'loaded' || ev === 'partial') {
      if (ev === 'loaded') { retryGaps(); geoHarvest(d.tiles); }
      d.tiles.forEach((k) => renderTile(k, true));
      renderLandmarks();
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
      ${lm.must ? `<p class="must-pill">⭐ <b>Imprescindible</b> de ${PM.esc(W.cityAt(lm.pos) || 'esta ciudad')} · vale el doble</p>` : ''}
      <p><span class="pill" style="background:${r.color}">${r.label}</span> ${PM.esc(lm.kind)} · ${lm.points * (lm.must ? 2 : 1)} pts</p>
      <p>${got ? `Capturado el ${new Date(got.t).toLocaleDateString(PM.LOCALE)} · ${got.visits} visita(s)` :
        `Está a <b>${PM.fmtDist(d)}</b>. Acércate a menos de ${lm.capR || CAPTURE_RADIUS} m y quédate ${CAPTURE_SECONDS} s para capturarlo.`}</p>
      ${!got ? '<p class="muted">Pista: ' + PM.esc(lm.name.replace(/[^\s]/g, (ch, i) => (i % 3 === 0 ? ch : '•'))) + '</p>' : ''}`);
  }

  function panelAlbum(ciudad) {
    openSheet('📖 Mis álbumes', '<div id="album-box"></div>');
    PM.cards.album($('#album-box'), { goTo: goToPlace, ciudad: typeof ciudad === 'string' ? ciudad : null });
  }
  // El álbum de una ciudad aparece la primera vez que la pisas. Las ciudades donde ya habías estado lo tienen desde el principio, sin aviso.
  function albumPisado(t) {
    const s = S();
    if (!s.albumes) {
      s.albumes = {};
      for (const r of Object.values(s.landmarks)) if (r.city && !PM.album.NO_ES_CIUDAD.test(r.city)) s.albumes[r.city] = r.t || Date.now();
      for (const [k, n] of Object.entries(s.tileNames || {})) if (n.city && (s.paintedByTile || {})[k] > 0 && !PM.album.NO_ES_CIUDAD.test(n.city) && !s.albumes[n.city]) s.albumes[n.city] = Date.now();
      PM.state.save();
    }
    const city = W.cityAt(pos) || t.city;
    if (!city || PM.album.NO_ES_CIUDAD.test(city) || s.albumes[city] || !t.loaded) return;
    s.albumes[city] = Date.now(); PM.state.save();
    if (s.guia) return;   // (en el primer paseo no se interrumpe: la bienvenida ya ha hablado del álbum)
    PM.album.nuevo(city, (c) => panelAlbum(c)).catch(() => {});
  }
  // centra el mapa en un lugar y abre su carta (o su ficha si aún no es tuyo)
  function goToPlace(id) {
    if (id && id.pos) {   // hueco del álbum: se va allí, aunque ese lugar aún no esté cargado
      $('#sheet').classList.remove('show');
      follow = false; zoomAround(); $('#btn-center').classList.add('show'); clearTimeout(recenterTimer); recenterTimer = setTimeout(recenter, 25000);
      map.easeTo({ center: ll(id.pos), zoom: Math.max(16.2, map.getZoom()), duration: 900 });
      W.ensureAround(id.pos[0], id.pos[1]);
      toast(`📍 ${esc(id.name)}: te falta en el álbum`, 'info');
      return;
    }
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
  // (ningún aviso necesita el minuto exacto; si no se dice, Android abre sus ajustes de «Alarmas y recordatorios» en plena partida)
  const NO_EXACTA = { isExactNotification: false };
  async function askNotifyPermission() {
    const L = LN(); if (!L || lnAsked) return; lnAsked = true;
    try { const p = await L.checkPermissions(); if (p.display !== 'granted') await L.requestPermissions(); } catch (e) {}
  }
  // (vibrar: por el canal «Cartas cerca», que vibra; el canal por defecto de Android viene sin vibración)
  let nearChannel = false;
  async function nearChannelReady(L) {
    if (nearChannel) return;
    nearChannel = true;
    try { await L.createChannel({ id: 'cerca', name: 'Cartas cerca', description: 'Vibra cuando pasas cerca de una carta que aún no tienes', importance: 4, vibration: true, visibility: 1 }); } catch (e) {}
  }
  function notify(title, body, kind = 'gold', vibrar = false) {
    title = PM.t(title); body = PM.t(body);   // (los avisos de Android, en el idioma elegido)
    const L = LN();
    if (L && document.hidden) (async () => {
      if (vibrar) await nearChannelReady(L);
      L.schedule({ notifications: [{ id: Math.floor(Date.now() % 2e9), title, body, ...NO_EXACTA, ...(vibrar ? { channelId: 'cerca' } : {}), schedule: { at: new Date(Date.now() + 500) } }] }).catch(() => {});
    })();
    else toast(`<b>${PM.esc(title)}</b> ${PM.esc(body)}`, kind, 5000);   // (llevan nombres de lugares y barrios: como texto)
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
    try { await L.schedule({ notifications: [{ id: 7001, ...NO_EXACTA, title: PM.t(`🔥 Tu racha de ${streak} día${streak > 1 ? 's' : ''} termina hoy`), body: PM.t('Sal a pintar un ratito para no perderla.'), schedule: { at } }] }); } catch (e) {}
  }
  // Carta por conquistar a menos de 100 m con el móvil en el bolsillo (pantalla apagada): vibra y avisa.
  // (navigator.vibrate no funciona con la pantalla apagada: se usa una notificación del sistema con vibración, en su
  // propio canal «Cartas cerca»). Una vez al día por carta, la más cercana y como mucho un aviso cada 45 s.
  const NEAR_CARD_M = 100;
  let nearCardT = 0;
  function checkNearCard(p) {
    if (!session || session.paused || Date.now() - nearCardT < 45000) return;
    let best = null, bd = NEAR_CARD_M + 0.01;
    for (const id in W.landmarks) {
      if (S().landmarks[id]) continue;   // ya la tienes
      // (distancia hasta donde ya se captura: un aeropuerto se captura a 1,5-2,5 km de su punto)
      const lmc = W.landmarks[id], d = Math.max(0, PM.geo.dist(p, lmc.pos) - Math.max(0, (lmc.capR || CAPTURE_RADIUS) - CAPTURE_RADIUS));
      if (d < bd && !(S().notified && S().notified['cerca:' + id] === PM.today())) { bd = d; best = W.landmarks[id]; }
    }
    if (!best || !once('cerca:' + best.id)) return;
    nearCardT = Date.now();
    const L = LN(), title = `${best.emoji} ${best.name}`, body = `Carta por conquistar a ${Math.max(10, Math.round(bd / 10) * 10)} m. ¡Saca el móvil y quédate 10 s a su lado!`;
    if (!L) { PM.vibrate([200, 100, 200]); return; }
    (async () => {
      await nearChannelReady(L);
      try { await L.schedule({ notifications: [{ id: 7100, channelId: 'cerca', ...NO_EXACTA, title: PM.t(title), body: PM.t(body), schedule: { at: new Date(Date.now() + 300) } }] }); } catch (e) {}
    })();
  }
  // imprescindible cerca (≤ 200 m, una vez al día cada uno)
  function checkNearMust(p) {
    if (!session || session.paused) return;
    for (const id in W.landmarks) {
      const lm = W.landmarks[id];
      if (!lm.must || S().landmarks[id]) continue;
      const d = PM.geo.dist(p, lm.pos);
      if (d > 40 && d <= 200 && once('must:' + id)) notify('⭐ Imprescindible cerca', `${lm.name} está a ${Math.round(d / 10) * 10} m. ¡Vale el doble!`, 'gold', true);
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
    const I = barrioInfo(id);
    const fmtD = (t) => new Date(t).toLocaleDateString(PM.LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
    const span = (a, b) => { const d = Math.max(0, Math.round((b - a) / 86400000)); return d === 0 ? 'el mismo día' : d === 1 ? 'en 1 día' : `en ${d} días`; };
    // línea de tiempo
    const ev = [];
    if (I.first) ev.push([I.first, '🎨', 'Primer paseo por el barrio', I.walks[0] ? PM.fmtDist(I.walks[0][0].st.walked || 0) + ' andados ese día' : '']);
    I.places.slice(0, 6).forEach((p) => ev.push([p.t, p.emoji || '📍', `Capturaste ${esc(p.name)}`, p.must ? '⭐ imprescindible' : (W.RARITY[p.rarity] || {}).label || '']));
    if (I.conq) ev.push([I.conq, '🥉', 'Conquistado · Bronce', I.first && I.first <= I.conq ? 'Lo conseguiste ' + span(I.first, I.conq) + ' después de empezar' : '60 % de sus calles']);
    [[1, '🥈', 'Rango Plata', '80 % de sus calles'], [2, '🥇', 'Rango Oro', '90 % de sus calles'], [3, '🏆', 'Rango Leyenda', '100 % y todos sus lugares']].forEach(([r, ic, t, d]) => { if (I.rt[r]) ev.push([I.rt[r], ic, t, d]); else if (I.rk >= r && r < 3 && !I.rt[r]) ev.push([null, ic, t, d + ' (antes de guardar fechas)']); });
    if (I.perfect) ev.push([I.perfect, '💯', 'Pintado al 100 %', 'Todas sus calles']);
    ev.sort((a, b) => (a[0] || 9e15) - (b[0] || 9e15));
    const pctTxt = I.pr != null ? PM.dec(I.pr * 100, 1) + ' %' : '—';
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
    if (I.best) { const w = I.best[0]; html += `<h4>Tu mejor paseo aquí</h4><button class="pf-rec bh-best" data-walk="${esc(w.id)}"><span>🥇</span><div><small>${fmtD(w.start)} · ${PM.fmtDist(w.st.walked || 0)} · +${PM.fmtNum(w.st.pts || 0)} pts</small><b>Ver estadísticas y vídeo</b></div><em>›</em></button>`; }
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
  // Copia de seguridad en archivo, en el propio móvil (Documentos/PintaMapa) y, si quieres, enviada a donde elijas.
  // Lleva TODA la partida, tus fotos de cromos, la forma de lo pintado, los contornos de tus barrios y los
  // imprescindibles de cada ciudad: en el móvil nuevo se ve todo al momento, sin nube.
  async function buildBackup() {
    // Una foto fija del momento en que empieza: la partida, las formas y los contornos se copian YA, antes de esperar a leer
    // las fotos. Antes se copiaban después, y una foto hecha mientras tanto entraba apuntada pero sin su imagen y sin avisar
    const s = S(), photos = {}, sinFoto = [], fallidas = [];
    const save = JSON.parse(JSON.stringify(s)); delete save.session; delete save.pendingGeo;
    const geo = {};
    for (const [k, ids] of pgeoTile) { const o = {}; for (const id of ids) if (s.painted[id] && pgeo.get(id)) o[id] = pgeo.get(id).p; if (Object.keys(o).length) geo[k] = o; }
    let cityinfo = null; try { cityinfo = JSON.parse(localStorage.getItem('pintamapa_cityinfo') || 'null'); } catch (e) {}
    // (una foto que no se puede leer se reintenta; las que faltan se cuentan y se avisa: la copia no se da por completa sin decirlo)
    for (const id of Object.keys(save.cardPhotos || {})) {
      let p = null, err = false;
      for (let i = 0; i < 2 && !p; i++) { try { p = await PM.cards.getPhoto(id, true); err = false; } catch (e) { err = true; } }
      // (si mientras se leía la foto se cambió por otra, la imagen leída es la nueva: van juntos sus datos nuevos)
      const ahora = (S().cardPhotos || {})[id];
      if (p && ahora && save.cardPhotos[id] && ahora.t !== save.cardPhotos[id].t) save.cardPhotos[id] = JSON.parse(JSON.stringify(ahora));
      if (p) photos[id] = p; else (err ? fallidas : sinFoto).push(id);
    }
    // fotosFaltan: apuntadas pero sin la imagen en este móvil (p. ej. llegaron de la nube); fotosFallidas: no se pudieron leer
    return { app: 'PintaMapa', version: PM.VERSION.app, player: PM.player ? PM.player.name : '', t: Date.now(), save, photos, geo, bgeo, cityinfo, fotosFaltan: sinFoto.length, fotosFallidas: fallidas.length };
  }
  // lo que le falta a una copia, para decirlo junto a «copia guardada»
  const copiaIncompleta = (d) => [d.fotosFallidas ? PM.t('{n} foto(s) no se pudieron leer y no van en la copia: vuelve a intentarlo.', { n: d.fotosFallidas }) : '',
    d.fotosFaltan ? PM.t('{n} foto(s) apuntadas no están en este móvil y no van en la copia.', { n: d.fotosFaltan }) : ''].filter(Boolean).join(' ');
  async function exportBackup() {
    const msg = $('#bk-msg');
    if (msg) msg.textContent = '⏳ Preparando la copia…';
    // (la fecha de «última copia» se apunta solo cuando la copia queda guardada de verdad)
    // (y con fotos que no se pudieron leer no es una copia completa: no se apunta)
    const hecha = () => { if (!data.fotosFallidas) { S().backupT = Date.now(); PM.state.save(); } };
    let data;
    try { data = await buildBackup(); } catch (e) { if (msg) msg.textContent = '❌ ' + PM.t('No se pudo preparar la copia') + ': ' + ((e && e.message) || e); return; }
    const falta = copiaIncompleta(data);
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const name = `PintaMapa-${(PM.player ? PM.player.slug : 'partida')}-${new Date().toISOString().slice(0, 10)}.json`;
    const mb = (blob.size / 1048576).toFixed(1);
    const FS = isNative && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem;
    if (FS) {
      try {
        const b64 = await new Promise((ok, ko) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1]); fr.onerror = ko; fr.readAsDataURL(blob); });
        await FS.writeFile({ path: 'PintaMapa/' + name, data: b64, directory: 'DOCUMENTS', recursive: true });
        hecha();
        if (msg) msg.innerHTML = `✅ Copia guardada en el móvil: <b>Documentos/PintaMapa/${name}</b> (${mb} MB). Si cambias de móvil, pásala al nuevo e impórtala.${falta ? '<br>⚠️ ' + PM.esc(falta) : ''}
          <button class="btn" id="bk-share" style="margin-top:6px;width:100%">📤 Guardarla también en otro sitio (Drive, correo…)</button>`;
        const sh = $('#bk-share');
        if (sh) sh.addEventListener('click', async () => { await PM.need('lib/mp4-muxer.js', 'js/replay.js'); await PM.replay.save(blob, name, 'Copia de PintaMapa'); });
        return;
      } catch (e) { /* sin acceso a Documentos: se comparte como antes */ }
    }
    try {
      await PM.need('lib/mp4-muxer.js', 'js/replay.js');
      const r = await PM.replay.save(blob, name, 'Copia de PintaMapa');
      if (r === false) { if (msg) msg.textContent = PM.t('Copia cancelada: no se ha guardado.'); return; }
      hecha();
      if (msg) msg.textContent = `✅ Copia lista (${mb} MB). Guárdala donde quieras: en el móvil nuevo, impórtala.` + (falta ? ' ⚠️ ' + falta : '');
    } catch (e) { if (msg) msg.textContent = '❌ ' + PM.t('No se pudo guardar') + ': ' + ((e && e.message) || e); }
  }
  // ¿es una copia de PintaMapa sana? Se mira TODO antes de tocar la partida (una copia rota o manipulada se
  // rechaza entera, con un mensaje claro). Devuelve el motivo del rechazo o null.
  function copiaRota(d) {
    const obj = (o) => o && typeof o === 'object' && !Array.isArray(o);
    if (!obj(d) || d.app !== 'PintaMapa' || !obj(d.save)) return 'Este archivo no es una copia de PintaMapa';
    const s = d.save;
    for (const k of ['painted', 'landmarks', 'heat', 'paintedByTile', 'conqueredB', 'perfectB', 'barrioNames', 'citiesWon', 'cities', 'tileNames', 'achievements', 'cardInfo', 'cardPhotos', 'barrioCards', 'cityCards', 'setsDone', 'countries', 'cityRank', 'barrioRank', 'ciudadId'])
      if (s[k] != null && !obj(s[k])) return 'La copia está dañada (' + k + ')';
    if (s.walks != null && !Array.isArray(s.walks)) return 'La copia está dañada (walks)';
    if (s.stats != null && !obj(s.stats)) return 'La copia está dañada (stats)';
    if (s.xp != null && !(typeof s.xp === 'number' && isFinite(s.xp) && s.xp >= 0)) return 'La copia está dañada (xp)';
    for (const [id, r] of Object.entries(s.landmarks || {})) if (!obj(r) || typeof r.name !== 'string') return 'La copia está dañada (lugar ' + String(id).slice(0, 20) + ')';
    for (const w of s.walks || []) if (!obj(w) || !isFinite(w.start) || (w.track != null && !Array.isArray(w.track))) return 'La copia está dañada (paseos)';
    if (d.photos != null && !obj(d.photos)) return 'La copia está dañada (fotos)';
    for (const v of Object.values(d.photos || {})) if (typeof v !== 'string' || !v.startsWith('data:image/')) return 'La copia está dañada (fotos)';
    if (d.geo != null && !obj(d.geo)) return 'La copia está dañada (geo)';
    for (const o of Object.values(d.geo || {})) if (!obj(o)) return 'La copia está dañada (geo)';
    if (d.bgeo != null && !obj(d.bgeo)) return 'La copia está dañada (barrios)';
    // y la fusión se prueba aparte, sobre copias, antes de cambiar nada
    try {
      const prueba = PM.merge(PM.limpiarPartida(JSON.parse(JSON.stringify(s))), JSON.parse(JSON.stringify(S())));
      PM.levelInfo(prueba.xp || 0);
      for (const r of Object.values(prueba.landmarks || {})) if (!obj(r)) throw new Error('lugar');
    } catch (e) { return 'La copia no se puede combinar con tu partida (' + ((e && e.message) || e) + ')'; }
    return null;
  }
  // formas de lo pintado de una copia ({ zona: { tramo: [punto…] } }): solo las que se pueden dibujar
  function geoSano(g) {
    const out = {};
    for (const [k, o] of Object.entries(g || {})) {
      if (!o || typeof o !== 'object' || Array.isArray(o)) continue;
      const t = {};
      for (const [id, pts] of Object.entries(o)) if (Array.isArray(pts)) { const q = pts.filter(PM.puntoOk); if (q.length >= 2) t[id] = q; }
      if (Object.keys(t).length) out[k] = t;
    }
    return out;
  }
  // mete una copia de seguridad en la partida actual (se suma: no se borra nada). Devuelve lo que no se pudo poner:
  // { fotos, formas } (si la partida no se puede guardar, error y la partida sigue como estaba)
  async function importData(d) {
    const bad = copiaRota(d);
    if (bad) throw new Error(bad);
    const cur = S(), fotosAntes = Object.assign({}, cur.cardPhotos || {}), merged = PM.merge(PM.limpiarPartida(d.save), cur);
    PM.state.replace(Object.assign({}, merged, { session: cur.session, pendingGeo: Object.assign({}, d.save.pendingGeo || {}, cur.pendingGeo || {}) }));
    if (!PM.state.flush()) {
      // (sin esto, la importación «fallida» se quedaba en la partida abierta y el siguiente guardado la escribía igualmente)
      PM.state.replace(cur);
      throw new Error(PM.t('No se pudo guardar la partida en el móvil (¿sin espacio?)'));
    }
    const res = { fotos: 0, formas: 0 };
    // fotos: solo la imagen de la versión que ha ganado (una copia vieja no pisa una foto más reciente de este móvil)
    const suya = (d.save && d.save.cardPhotos) || {};
    for (const [id, img] of Object.entries(d.photos || {})) {
      const mia = fotosAntes[id];
      if (mia && ((suya[id] && suya[id].t) || 0) < (mia.t || 0)) continue;
      try { await PM.cards.putPhoto(id, img); } catch (e) { res.fotos++; }
    }
    // formas de lo pintado y contornos de barrios: lo tuyo se ve al momento, también lo de zonas lejanas
    const geo = geoSano(d.geo), bg = PM.bgeoSano(d.bgeo);
    if (Object.keys(geo).length || Object.keys(bg).length) {
      try {
        const db = await geoDb(), tx = db.transaction(['geo', 'meta'], 'readwrite'), st = tx.objectStore('geo');
        for (const [k, o] of Object.entries(geo)) {
          const prev = (await idbReq(st.get(k))) || {};
          st.put(Object.assign(prev, o), k);
        }
        if (Object.keys(bg).length) tx.objectStore('meta').put(Object.assign({}, bg, bgeo), 'barrios');
        await idbDone(tx);
      } catch (e) { res.formas = Object.keys(geo).length + Object.keys(bg).length; }   // (se recogerán solas, zona a zona, al volver a pasar: se avisa)
    }
    // (esto estaba después del return: los imprescindibles de la copia nunca llegaban al móvil nuevo)
    // contornos de ciudad de la copia: solo los que están bien (uno roto rompía después las consultas del mapa)
    if (d.cityinfo && typeof d.cityinfo === 'object') { try { const ci = JSON.parse(localStorage.getItem('pintamapa_cityinfo') || '{}'), buenos = {}; for (const [k, v] of Object.entries(d.cityinfo)) { const ok = PM.ciudadValida(v); if (ok) buenos[k] = ok; } localStorage.setItem('pintamapa_cityinfo', JSON.stringify(Object.assign({}, buenos, ci))); } catch (e) {} }
    return res;
  }
  function importBackup() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      try {
        let d;
        try { d = JSON.parse(await f.text()); } catch (e) { throw new Error('Este archivo no es una copia de PintaMapa'); }
        const bad = copiaRota(d);
        if (bad) throw new Error(bad);
        if (!confirm(`¿Importar la copia de «${PM.limpio(String(d.player || '?')).slice(0, 40)}» del ${new Date(+d.t || 0).toLocaleString(PM.LOCALE)}? Se sumará a tu partida actual (no se borra nada).`)) return;
        const r = await importData(d), parcial = [r.fotos ? PM.t('{n} foto(s) no se pudieron guardar', { n: r.fotos }) : '', r.formas ? PM.t('las formas de {n} zona(s) no se pudieron guardar (se recuperan al volver a pasar)', { n: r.formas }) : ''].filter(Boolean).join('; ');
        toast(parcial ? '⚠️ ' + PM.t('Copia importada, pero') + ' ' + parcial + '. ' + PM.t('Guarda el archivo para reintentarlo.') + ' ' + PM.t('Recargando…') : '✅ Copia importada. Recargando…', parcial ? 'warn' : 'ok', parcial ? 6000 : 2500);
        setTimeout(() => location.reload(), parcial ? 6000 : 1200);
      } catch (e) { toast('❌ ' + PM.esc(PM.t(e.message || String(e))), 'warn', 5000); }   // (el mensaje puede citar texto del archivo: nunca como HTML)
    };
    inp.click();
  }
  // Sin nube: recordatorio suave para hacer copia (como mucho uno por semana, si la última tiene más de un mes)
  function backupReminder() {
    const s = S();
    if (PM.cloud.ready() || (s.stats.paintedM || 0) < 500 || Date.now() - (s.backupT || 0) < 30 * 86400000) return;
    let last = 0; try { last = +localStorage.getItem('pintamapa_bkrem') || 0; } catch (e) {}
    if (Date.now() - last < 7 * 86400000 || document.getElementById('bk-banner')) return;
    try { localStorage.setItem('pintamapa_bkrem', String(Date.now())); } catch (e) {}
    const el = document.createElement('div');
    el.id = 'bk-banner'; el.className = 'cloud-banner-like';
    el.innerHTML = `<span>💾 <b>Haz una copia</b> de tu partida por si cambias de móvil (se guarda en el propio móvil)</span><button class="btn on">Hacer copia</button><button class="x">✕</button>`;
    el.querySelector('.btn').addEventListener('click', () => { el.remove(); profTab = 'aj'; panelProfile(); setTimeout(exportBackup, 400); });
    el.querySelector('.x').addEventListener('click', () => el.remove());
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 20000);
  }

  function panelMissions() {
    const d = G.ensureDaily();
    const fmt = (m, v) => (m.type === 'paint' || m.type === 'walk' ? PM.fmtDist(v) : Math.round(v));
    let html = `<p class="muted">Se renuevan cada día a medianoche. Racha actual: <b>🔥 ${S().stats.streak} día(s)</b></p>`;
    html += d.missions.map((m) => `<div class="mission ${m.done ? 'done' : ''}">
        <div class="mt">${m.done ? '✅' : '🎯'} ${esc(m.text)}<span>+${m.reward}</span></div>
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
      ${rows.map(([k, v]) => `<div class="xprow"><span>${LBL[k] || esc(k)}</span><b>${nf(v)}</b><div class="bar"><i style="width:${(v / Math.max(1, s.xp) * 100).toFixed(1)}%"></i></div></div>`).join('') || '<p class="muted">Aún no tienes puntos: ¡sal a pintar!</p>'}
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
    if (!['res', 'cit', 'aj'].includes(profTab)) profTab = 'res';   // («Récords» pasó a Paseos)
    const D = profileData(), s = D.s, st = D.st, lp = G.levelProgress();
    const pace = (ms, m) => { if (!m || m < 50) return '—'; const sec = ms / 1000 / (m / 1000); return Math.floor(sec / 60) + ':' + String(Math.round(sec % 60)).padStart(2, '0') + ' /km'; };
    const dur = (ms) => { const m = Math.round(ms / 60000); return m >= 60 ? Math.floor(m / 60) + ' h ' + (m % 60) + ' min' : m + ' min'; };
    const tile = (ic, v, l, act) => `<div class="pf-tile" ${act ? `data-act="${act}"` : ''}><span>${ic}</span><b>${v}</b><small>${l}</small></div>`;
    const card = (title, inner, extra) => `<div class="pf-card"><h5>${title}${extra ? `<span>${extra}</span>` : ''}</h5>${inner}</div>`;
    const RC = { comun: '#9aa4b2', raro: '#3fa9ff', epico: '#b65cff', legendario: '#ffb700' };
    // cabecera
    let html = `<div class="pf-head">
      <div class="av-wrap">${FUN ? FUN.avatarHTML('avatar') : `<div class="avatar" style="background:${s.color}">🖌️</div>`}<button id="av-edit" class="av-edit" aria-label="Cambiar foto de perfil">📷</button></div>
      <div class="pf-who"><h2>${PM.player ? esc(PM.player.name) : 'Pintor'}</h2>
        <button class="pf-lvl" id="pf-lvl">${lp.tier ? lp.tier.icon + ' ' : '⭐ '}Nivel ${lp.label} ›</button>
        <div class="pf-xp"><i style="width:${(lp.pct * 100).toFixed(1)}%"></i></div>
        <small>${PM.fmtNum(s.xp)} pts · ${lp.max ? '¡nivel máximo!' : `faltan ${PM.fmtNum(lp.need - lp.cur)} para el ${lp.nextLabel}`}</small>
        ${D.first ? `<small class="pf-since">Pintando desde ${new Date(D.first).toLocaleDateString(PM.LOCALE, { month: 'long', year: 'numeric' })} · 🔥 ${st.streak || 0} día${st.streak === 1 ? '' : 's'} de racha</small>` : ''}</div></div>
      <div class="pf-tabs">${[['res', 'Resumen'], ['cit', 'Ciudades'], ['aj', 'Ajustes']].map(([k, l]) => `<button data-tab="${k}" class="${profTab === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;

    // (v0.9: tres pestañas y sin accesos rápidos. Paseos, Álbum y Misiones están en la barra de abajo; Logros y el vídeo de la
    // semana, en el Resumen; el póster, en Ciudades —uno por ciudad—; los récords, en Paseos)
    if (profTab === 'res') {
      html += card('📅 Esta semana', `<div class="pf-grid">${tile('🚶', PM.fmtDist(D.sum(D.wk, (w) => w.st.walked)), 'andados')}${tile('🖌️', PM.fmtDist(D.sum(D.wk, (w) => w.st.painted)), 'calles nuevas')}${tile('⏱️', dur(D.movWk), 'en movimiento')}</div>`,
        `${D.wk.length} paseo${D.wk.length === 1 ? '' : 's'}`);
      html += card('📈 En total', `<div class="pf-grid">
        ${tile('🖌️', PM.fmtDist(st.paintedM), 'pintados')}${tile('🚶', PM.fmtDist(st.walkedM), 'caminados')}${tile('🗓️', D.walks.length, 'paseos', 'walks')}
        ${tile('⏱️', dur(D.movAll), 'en movimiento')}${tile('🏛️', D.lms.length, 'lugares', 'album')}${tile('🚩', Object.keys(s.conqueredB || {}).length, 'barrios', 'cit')}</div>`);
      html += `<button class="pf-week sobrio" id="pf-ach"><span>🏆</span><div><b>Logros</b><small>${D.nAch} de ${Object.keys(G.ACHIEVEMENTS).length} conseguidos</small></div><em>›</em></button>`;
      html += `<button class="pf-week" id="pf-week"><span>📽️</span><div><b>Tu semana en vídeo</b><small>Resumen animado de los últimos 7 días para compartir</small></div><em>▶</em></button>`;
      html += card('🎨 Color de tu pintura', `<div class="colors">` + G.COLORS.map((c) => {
        const locked = lp.level < c.lvl;
        return `<button class="color ${s.color === c.c ? 'sel' : ''}" ${locked ? 'disabled' : ''} data-c="${c.c}" style="background:${c.c}" title="${c.name}" aria-label="${c.name}${locked ? ' (nivel ' + c.lvl + ')' : ''}">${locked ? '🔒' + c.lvl : ''}</button>`;
      }).join('') + '</div>', 'se desbloquean subiendo de nivel');
    }
    if (profTab === 'cit') {
      const cities = {};
      for (const k in s.tileNames) { const c = s.tileNames[k].city; if (c) cities[c] = true; }
      const todas = Object.keys(cities).map((c) => [c, G.cityProgress(c)]).sort((x, y) => y[1].painted - x[1].painted);
      // (solo las ciudades donde has pintado algo: las que solo has cruzado salían a 0,00 % y llenaban la lista)
      const cl = todas.filter(([, cp]) => cp.painted > 0), sinPintar = todas.length - cl.length;
      if (cl.length) html += `<button class="pf-week pf-poster" id="pf-poster"><span>🖼️</span><div><b>Póster de tu mapa</b><small>Cada ciudad con sus calles pintadas, en alta resolución, para imprimir o compartir</small></div><em>▶</em></button>`;
      html += card('🏙️ Tus ciudades', (cl.length ? cl.map(([c, cp]) => `<div class="mission"><div class="mt">${s.citiesWon[c] ? PM.RANKS[(s.cityRank || {})[c] || 0].ic : '🏙️'} ${esc(c)}<span>${PM.dec(cp.pct * 100, 2)} % <button class="ci-poster" data-poster="${esc(c)}" aria-label="Póster de ${esc(c)}" title="Póster de ${esc(c)}">🖼️</button></span></div>
          <div class="bar"><i style="width:${Math.min(100, cp.pct / PM.CONQ.city * 100)}%"></i></div>
          <small>${PM.fmtDist(cp.painted)} de ${cp.total ? PM.fmtDist(cp.total) : '?'} · ${(() => { const rk = PM.rankFor('city', cp.pct), nx = PM.RANK_MIN.city[rk + 1]; return (rk >= 0 ? `${PM.RANKS[rk].ic} ${PM.RANKS[rk].name} · ` : '') + (nx ? 'faltan ' + (cp.total ? PM.fmtDist(Math.max(0, cp.total * nx - cp.painted)) : '?') + ` para ${Math.round(nx * 100)} %` : '¡oro conseguido!'); })()}</small></div>`).join('') : '<p class="muted">Sal a pintar y aquí verás tus ciudades.</p>')
        + (sinPintar ? `<p class="muted">${sinPintar === 1 ? 'Y 1 ciudad más por la que has pasado sin pintar.' : PM.t('Y {n} ciudades más por las que has pasado sin pintar.', { n: sinPintar })}</p>` : ''), 'conquista 70 % · plata 80 · oro 90');
      const bc = Object.entries(s.barrioCards || {}).map(([id, v]) => Object.assign({ id }, v)).sort((x, y) => y.t - x.t);
      html += card('🏅 Barrios conquistados', bc.length ? bc.map((b) => { const rk = b.id != null ? rankOf(b.id) : 0; return `<div class="row bh-row" data-bid="${esc(b.id)}"><span>${RANKS[rk].ic} ${esc(b.name)} <small class="muted">· ${RANKS[rk].name}</small></span><small class="muted">${new Date(b.t).toLocaleDateString(PM.LOCALE)} ›</small></div>`; }).join('') : '<p class="muted">Pinta el 60 % de las calles de un barrio para conquistarlo (80 % plata, 90 % oro).</p>', bc.length || '');
    }
    if (profTab === 'aj') {
      // tres grupos: el juego, tus datos y ayuda (antes, once tarjetas seguidas sin orden)
      html += '<h4 class="pf-grupo">🎮 Juego</h4>';
      html += card('⚙️ Preferencias', `
        <label class="row"><span>🔊 Sonido</span><input type="checkbox" class="sw" id="opt-sound" ${PM.sound.enabled ? 'checked' : ''}></label>
        <label class="row"><span>🌙 Tema oscuro</span><input type="checkbox" class="sw" id="opt-dark" ${s.theme === 'dark' ? 'checked' : ''}></label>
        ${Object.keys(PM.i18n.LANGS).length > 1 ? `<label class="row"><span>🌐 Idioma</span><select id="opt-lang" translate="no">${Object.entries(PM.i18n.LANGS).map(([k, v]) => `<option value="${k}" ${k === PM.i18n.lang ? 'selected' : ''}>${v}</option>`).join('')}</select></label>` : ''}`);
      html += '<h4 class="pf-grupo">💾 Tus datos</h4>';
      if (PM.isNative && PM.profile === 'real' && PM.cloud.allowed()) {
        const has = !!PM.cloud.password();
        html += card('☁️ Mi cuenta en la nube', `
          <p class="muted">Tu progreso se guarda <b>cifrado con tu contraseña</b>. Con tu pintor (<b>${PM.player ? esc(PM.player.name) : ''}</b>) y la contraseña lo ves en <b>luzferlux77.github.io/pintamapa-app/progreso.html</b></p>
          ${PM.cloud.hasKey() ? '' : '<p class="err">Esta versión no trae la clave de la nube: actualiza la app.</p>'}
          <input id="cl-pass" type="password" placeholder="${has ? 'Contraseña guardada ✓ (escribe otra para cambiarla)' : 'Inventa una contraseña de pintor (mín. 8)'}" autocomplete="new-password">
          <button class="btn on" id="cl-go">☁️ ${has ? 'Guardar en la nube ahora' : 'Activar y guardar'}</button>
          <p class="muted" id="cl-msg">${s.syncedAt ? 'Último guardado: ' + new Date(s.syncedAt).toLocaleString(PM.LOCALE) : 'Aún no guardado en la nube.'}${Object.keys(s.pendingGeo || {}).length ? ' · ' + Object.keys(s.pendingGeo).length + ' tramos pendientes' : ''}</p>
          <p class="muted">⚠️ Apúntala: si la olvidas no se puede recuperar.</p>`);
      } else if (!PM.isNative) {
        html += card('📊 Tu progreso real', `<p class="muted">Lo que pintas con el móvil por la calle (separado de esta partida de prueba).</p>
          <a class="btn on" href="progreso.html" target="_blank" style="display:inline-block;text-decoration:none">📊 Abrir «Mi progreso»</a>`);
      }
      html += card('💾 Copia de seguridad', `<p class="muted">Toda tu partida en un archivo, en Documentos/PintaMapa. En otro móvil, impórtala: se suma a lo que tengas, sin perder nada.</p>
        <div class="seg"><button class="btn on" id="bk-exp">💾 Exportar copia</button><button class="btn" id="bk-imp">📂 Importar copia</button></div><p class="muted" id="bk-msg">${s.backupT ? 'Última copia: ' + new Date(s.backupT).toLocaleString(PM.LOCALE) : 'Aún no has hecho ninguna copia.'}</p>`);
      html += card('📴 Mapa sin conexión', `<p class="muted">Para ver el mapa y pintar sin cobertura (metro, montaña, viajes).</p>
        <div class="seg"><button class="btn on" id="off-dl" data-km="3">⬇️ Mi zona (3 km)</button><button class="btn" id="off-dl2" data-km="6">⬇️ Mi ciudad (6 km)</button></div><p class="muted" id="off-msg">Calculando lo guardado…</p>`);
      html += '<h4 class="pf-grupo">❓ Ayuda</h4>';
      { const E = PM.errores ? PM.errores.lista() : [], ult = E.slice(-4).reverse();
        html += card('🐞 Informe de errores', `<p class="muted">${E.length ? `La app ha apuntado ${E.length} ${E.length === 1 ? 'fallo' : 'fallos'}. Envíalo para que se pueda arreglar: se le quitan las coordenadas, las zonas del mapa y los nombres de tus sitios. Puedes leerlo antes de enviarlo.` : '👍 No hay ningún fallo apuntado.'}</p>
          ${ult.map((x) => `<p class="muted err-it"><b>${new Date(x.t).toLocaleString(PM.LOCALE, { dateStyle: 'short', timeStyle: 'short' })}</b> · ${esc(x.m.slice(0, 120))}${x.n > 1 ? ` <b>×${x.n}</b>` : ''}</p>`).join('')}
          ${E.length ? '<div class="seg"><button class="btn on" id="err-send">📤 Enviar informe</button><button class="btn" id="err-del">🗑️ Borrar</button></div>' : ''}`); }
      // versión, bienvenida y créditos juntos (las licencias piden tenerlos siempre a mano, con su enlace)
      const lic = (t, url, l) => `<li>${t}: <a href="${url}" target="_blank" rel="noopener">${l}</a></li>`;
      html += card('ℹ️ Acerca de PintaMapa', `<p class="muted">PintaMapa <b>v${PM.VERSION.app}</b> · <span>${(PM.update.status() || {}).msg || 'Se busca actualización al abrir la app.'}</span></p><p class="muted">Perfil: <b>${PM.profile === 'real' ? '📡 Real' : '🕹️ Prueba'}</b></p>
        <div class="seg">${PM.isNative ? '<button class="btn" id="opt-upd">🔄 Buscar actualización</button>' : ''}<button class="btn" id="opt-bv">👋 Ver la bienvenida</button></div>
        <details class="pf-cred"><summary>📜 Créditos y licencias</summary><ul class="creditos" translate="no">
        ${lic(PM.t('Mapas y calles'), 'https://www.openstreetmap.org/copyright', '© OpenStreetMap (ODbL)')}
        ${lic(PM.t('Mapa base'), 'https://openfreemap.org', 'OpenFreeMap © OpenMapTiles')}
        ${lic(PM.t('Lugares'), 'https://www.wikidata.org/wiki/Wikidata:Licensing', 'Wikidata (CC0)')}
        ${lic(PM.t('Textos y fotos de las cartas'), 'https://creativecommons.org/licenses/by-sa/4.0/deed.es', 'Wikipedia · Wikimedia Commons (CC BY-SA)')}
        ${lic(PM.t('Iconos'), 'https://creativecommons.org/licenses/by/4.0/deed.es', 'Twemoji (CC BY 4.0)')}
        ${lic(PM.t('Motor del mapa'), 'https://maplibre.org', 'MapLibre GL JS (BSD)')}</ul></details>`);
      html += `<div class="pf-danger"><button class="btn danger" id="opt-reset">🗑️ Borrar partida de este móvil</button></div>`;
    }
    openSheet('👤 Perfil', html);
    // cabecera y navegación
    const avEdit = () => FUN && FUN.changeAvatar().then((ok) => { if (ok) panelProfile(); });
    $('#av-edit') && $('#av-edit').addEventListener('click', avEdit);
    $('.av-wrap .avatar') && $('.av-wrap .avatar').addEventListener('click', avEdit);
    if (S().avatar) { const d = document.createElement('button'); d.className = 'av-del'; d.textContent = 'Quitar foto'; d.addEventListener('click', () => { FUN.removeAvatar(); panelProfile(); }); $('.av-wrap').appendChild(d); }
    $('#pf-lvl').addEventListener('click', panelLevel);
    $('#pf-week') && $('#pf-week').addEventListener('click', openWeek);
    $('#pf-ach') && $('#pf-ach').addEventListener('click', panelAchievements);
    // póster de tu mapa: en Ciudades, el general y uno por ciudad (abre con esa ciudad)
    const poster = (ciudad) => PM.need('lib/mp4-muxer.js', 'js/replay.js', 'js/poster.js').then(() => PM.poster.open(artCtx(), ciudad));
    $('#pf-poster') && $('#pf-poster').addEventListener('click', () => poster());
    document.querySelectorAll('[data-poster]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); poster(b.dataset.poster); }));
    const go = { walks: panelWalks, album: panelAlbum, ach: panelAchievements, cit: () => { profTab = 'cit'; panelProfile(); } };
    document.querySelectorAll('.pf-tile[data-act]').forEach((b) => b.addEventListener('click', () => go[b.dataset.act]()));
    document.querySelectorAll('.pf-tabs [data-tab]').forEach((b) => b.addEventListener('click', () => { profTab = b.dataset.tab; panelProfile(); }));
    document.querySelectorAll('.bh-row[data-bid]').forEach((r) => r.addEventListener('click', () => showBarrioHistory(r.dataset.bid)));
    // pestañas
    document.querySelectorAll('.color:not([disabled])').forEach((b) => b.addEventListener('click', () => {
      S().color = b.dataset.c; PM.state.save(); recolorAll(); panelProfile();   // (S(): si la nube guardó con el panel abierto, la partida ya es otro objeto y el cambio se perdía)
    }));
    if ($('#cl-go')) $('#cl-go').addEventListener('click', async () => {
      const pw = $('#cl-pass').value;
      // (contraseña nueva: mínimo 8 caracteres; el repositorio de la nube es público y una corta se adivina probando)
      if (pw) { if (pw.length < 8) { $('#cl-msg').textContent = '❌ Mínimo 8 caracteres (mejor una frase)'; return; } PM.cloud.setPassword(pw); }
      if (!PM.cloud.password()) { $('#cl-pass').focus(); return; }
      $('#cl-msg').textContent = '⏳ Guardando en la nube…';
      try {
        const r = await PM.cloud.now(true);
        $('#cl-msg').textContent = r === 'ocupado' ? '⏳ Ya se está guardando: inténtalo en un momento.' : '✅ ¡Guardado! Ya lo puedes ver en «Mi progreso» con tu pintor y contraseña.';
        recolorAll();
      }
      catch (e) { $('#cl-msg').textContent = '❌ ' + PM.t(e.message || String(e)); }
    });
    if ($('#opt-upd')) $('#opt-upd').addEventListener('click', async () => {
      $('#opt-upd').textContent = '⏳ Buscando…';
      await PM.update.check(true);
      panelProfile();
    });
    $('#opt-sound') && $('#opt-sound').addEventListener('change', (e) => PM.sound.poner(e.target.checked));
    $('#opt-lang') && $('#opt-lang').addEventListener('change', (e) => PM.i18n.set(e.target.value));
    $('#opt-dark') && $('#opt-dark').addEventListener('change', (e) => { S().theme = e.target.checked ? 'dark' : 'light'; PM.state.save(); applyTheme(); });
    // informe de errores: por compartir (correo, WhatsApp, Telegram…) o, en la web, copiado al portapapeles
    if ($('#err-send')) $('#err-send').addEventListener('click', async () => {
      const txt = PM.errores.informe();
      try {
        const Sh = isNative && window.Capacitor.Plugins.Share;
        if (Sh) { await Sh.share({ title: 'Informe de errores de PintaMapa', text: txt }); return; }
        if (navigator.share) { await navigator.share({ title: 'Informe de errores de PintaMapa', text: txt }); return; }
      } catch (e) { if (e && /cancel/i.test(e.message || '')) return; }
      try { await navigator.clipboard.writeText(txt); toast('📋 Informe copiado: pégalo en un mensaje', 'ok', 3500); } catch (e) { toast('No se pudo compartir el informe', 'warn'); }
    });
    if ($('#err-del')) $('#err-del').addEventListener('click', () => { if (!confirm(PM.t('¿Borrar los fallos apuntados?'))) return; PM.errores.borrar(); toast('🗑️ Informe borrado', 'ok'); profTab = 'aj'; panelProfile(); });
    $('#opt-bv') && $('#opt-bv').addEventListener('click', () => PM.need('js/bienvenida.js').then(() => PM.bienvenida.abrir(() => {})));
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
          const callesMal = keys.filter((k) => !(W.tiles[k] && W.tiles[k].loaded)).length;
          const r = await PM.mapStyle.prefetch(pos, km, curStyle, (d, t) => { msg.textContent = `⬇️ Descargando mapa… ${Math.round(d / t * 100)} % (${d}/${t})`; });
          // (solo se da por lista si TODO ha quedado guardado; si no, se dice qué falta y se puede volver a pulsar: lo guardado no se baja otra vez)
          if (!r.fallidas && !callesMal) {
            msg.textContent = `✅ Listo: tu zona (${km} km) está guardada en el móvil (${PM.fmtNum(r.ok)} piezas). Ya puedes usarla sin cobertura.`;
            toast('📴 Mapa guardado para usar sin conexión', 'ok');
          } else {
            msg.textContent = `⚠️ Guardado a medias: ${PM.fmtNum(r.ok)} de ${PM.fmtNum(r.total)} piezas de mapa` + (callesMal ? ` y faltan las calles del juego de ${callesMal} de ${keys.length} zonas` : '') + '. Vuelve a pulsar con cobertura para completar lo que falta.';
          }
        } catch (er) { msg.textContent = '❌ No se pudo descargar: ' + (er.message || er); }
        finally { document.querySelectorAll('#off-dl, #off-dl2').forEach((b) => { b.disabled = false; }); }
      }));
    }
    // Borra la partida de ESTE móvil. La copia de la nube (si la hay) no se borra: por eso también se olvida aquí la
    // contraseña de la nube; si no, al volver a entrar la nube devolvía la partida «borrada».
    $('#opt-reset') && $('#opt-reset').addEventListener('click', () => {
      if (!confirm(PM.t('¿Borrar la partida de este móvil? Se perderá todo el progreso guardado aquí. La copia de la nube, si la tienes, no se borra (podrás recuperarla poniendo otra vez tu contraseña).'))) return;
      try { PM.cloud.setPassword(''); } catch (e) { /* sin nube */ }
      PM.state.reset();
    });
  }

  function renderSimPanel() {
    if (PM.isNative) { $('#modebtn').style.display = 'none'; return; }   // móvil: solo real, sin selector de modo
    $('#modebtn').textContent = mode === 'sim' ? '🕹️ Prueba' : '📡 GPS (prueba)';
    $('#modebtn').classList.add('test');
  }
  function panelSim() {
    const html = `
      <div class="seg"><button class="btn ${mode === 'gps' ? 'on' : ''}" id="m-gps">📡 GPS del PC</button>
      <button class="btn ${mode === 'sim' ? 'on' : ''}" id="m-sim">🕹️ Prueba</button></div>
      <p class="muted">En el PC siempre juegas en el perfil de <b>prueba</b>. Tu progreso real (el del móvil) lo ves en <a href="progreso.html" target="_blank">📊 Mi progreso</a>.</p>
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
    $('#m-gps').addEventListener('click', () => { setMode('gps'); panelSim(); });
    $('#m-sim').addEventListener('click', () => { setMode('sim'); panelSim(); });
    $('#preset').addEventListener('change', (e) => {
      const p = PRESETS[+e.target.value]; if (!p) return;
      W.setDemo(!!p.demo);
      if (mode !== 'sim') setMode('sim');
      teleport(p.p); $('#sheet').classList.remove('show');
    });
    $('#go').addEventListener('click', () => {
      const m = $('#coords').value.split(',').map((x) => parseFloat(x));
      if (m.length === 2 && m.every(isFinite)) {
        W.setDemo(false);
        if (mode !== 'sim') setMode('sim');
        teleport(m); $('#sheet').classList.remove('show');
      } else toast('Formato: lat, lon', 'warn');
    });
  }

  $('#nav-album').addEventListener('click', panelAlbum);
  $('#nav-missions').addEventListener('click', panelMissions);
  $('#nav-walks').addEventListener('click', panelWalks);   // (v0.9: Paseos en la barra; Logros, en el Resumen del perfil)
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
    return `<button class="pcard ${PM.player && PM.player.slug === p.slug ? 'cur' : ''}" data-slug="${PM.esc(p.slug)}">
      <span class="pav" style="background:${/^#[0-9a-f]{3,8}$/i.test(sv.color || '') ? sv.color : '#ff2e88'}">${PM.esc(p.name.slice(0, 1).toUpperCase())}</span>
      <span class="pinfo" translate="no"><b>${PM.esc(p.name)}</b><small>nivel ${lvl} · ${km} pintados</small></span><span class="pgo">▶</span></button>`;
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
    const yest = PM.ayer();
    const msg = st.lastDay === today ? '✅ Hoy ya has salido. ¡Bien!' : streak && st.lastDay === yest ? `🔥 Sal hoy para no perder tu racha de ${streak} día${streak > 1 ? 's' : ''}` : 'Cada calle nueva cuenta. ¡A por ellas!';
    el.innerHTML = `<div class="hm-card">
      <div class="hm-me">${FUN ? FUN.avatarHTML('hm-av') : ''}<div class="hm-who"><b>${esc(PM.player.name)}</b><span class="hm-lvl">${lp.tier ? lp.tier.icon + ' ' : '⭐ '}Nivel ${lp.label}</span>
        <div class="pf-xp"><i style="width:${(lp.pct * 100).toFixed(1)}%"></i></div></div></div>
      <div class="hm-stats"><div><b>🔥 ${streak}</b><small>racha</small></div><div><b>${PM.fmtDist(st.paintedM || 0)}</b><small>pintados</small></div><div><b>${nL}</b><small>lugares</small></div><div><b>${nB}</b><small>barrios</small></div></div>
      <button class="btn primary hm-go" id="hm-go">${s.session ? '▶ Seguir con tu paseo' : '▶ Salir a pintar'}</button>
      <p class="hm-msg">${msg}</p></div>`;
    $('#hm-go').addEventListener('click', () => begin());
    // (tu pintor ya está en la tarjeta grande: en la lista solo los demás, y el título solo si hay otros)
    document.querySelectorAll('#players .pcard.cur').forEach((b) => { b.hidden = true; });
    const otros = document.querySelectorAll('#players .pcard:not(.cur)').length;
    $('#who-title').textContent = 'Cambiar de pintor'; $('#who-title').hidden = !otros;
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
  let begun = false;
  function begin(fromNew) {
    if (fromNew === true) {
      const name = $('#player-name').value.trim();
      if (!nameValid()) { $('#player-name').focus(); return; }
      if (!PM.player || PM.slug(name) !== PM.player.slug) { PM.setPlayer(name); return; }   // recarga con su partida
    }
    if (!PM.player) { showNewBox(true); return; }
    if (begun) return;   // (dos entradas a la vez —paseo que sigue y pintor recién elegido— eran dos bucles de dibujo para siempre)
    // pintor nuevo: primero la bienvenida (y en el móvil, el aviso de la ubicación ANTES de que Android pida el permiso, que se pide más abajo)
    if (!S().bienvenida && !S().xp && !(S().walks || []).length && !session) {
      const sigue = (guiar) => { S().bienvenida = Date.now(); if (guiar) S().guia = 1; PM.state.save(); begin(); };
      PM.need('js/bienvenida.js').then(() => PM.bienvenida.abrir(() => sigue(true))).catch(() => sigue(false));
      return;
    }
    begun = true;
    $('#intro').classList.remove('show');
    setTimeout(() => map.resize(), 50);
    // la pantalla de inicio pudo dejar la página desplazada (móviles bajos): el juego siempre pegado arriba
    const unscroll = () => { if (document.body.scrollTop) document.body.scrollTop = 0; if (document.documentElement.scrollTop) document.documentElement.scrollTop = 0; };
    unscroll(); document.body.addEventListener('scroll', unscroll, { passive: true }); window.addEventListener('scroll', unscroll, { passive: true });
    PM.sound._ctx(); PM.sound._sleepSoon(Date.now());   // (se desbloquea el audio con el toque y se suspende enseguida)
    G.ensureDaily();
    { const nt = S().notified; if (nt) { const hoy = PM.today(); for (const k of Object.keys(nt)) if (nt[k] !== hoy) delete nt[k]; } }   // (avisos de otros días: ya no sirven y crecían sin parar en la partida)
    W.migrarCiudades();   // (cada ciudad, ligada a su Q; lo de una homónima guardado con su nombre se separa)
    if (PM.fillLandmarkCities(S()) + W.fixRecords(S())) PM.state.save();   // lugares conquistados sin ciudad (o con la de la celda vecina): se corrige
    if (!PM.cloud.allowed() && Object.keys(S().pendingGeo || {}).length) { S().pendingGeo = {}; PM.state.save(); }   // sin nube: no hay nada que subir
    recolorAll();
    teleport(pos);
    // la app se cerró a mitad de paseo (Android, en el bolsillo): el hueco desde tu última posición se rellena
    // por las calles con la primera lectura buena (como si el GPS hubiera tardado en contestar)
    if (autoResumed && session && !session.paused) avisoDiario('reabierta ' + Math.round((Date.now() - (session.lastSeen || Date.now())) / 60000) + 'min');
    if (autoResumed && !vueltaLarga && session && !session.paused && session.lastSeen && S().lastPos) lastT = session.lastSeen;
    else if (vueltaLarga) { lastP = null; cortarUnion(); }   // (hace mucho: tramo nuevo, sin rellenar)
    setMode(mode);
    setOrient(orient);
    renderSession();
    requestAnimationFrame(loop);
    PM.sync.auto(null, true);   // al abrir: se mira la nube aunque aquí no haya cambios
    PM.update.watch(toast);
    compressOldWalks();
    setTimeout(() => PM.mapStyle.podar().catch(() => {}), 60000);
    setTimeout(() => W.purgarCache().catch(() => {}), 90000);
    if (PM.state.rota && !PM.state.bloqueada) setTimeout(() => toast('⚠️ ' + PM.t('Tu partida guardada no se podía leer: se ha apartado y empiezas de cero. Si tienes una copia de seguridad, impórtala en Perfil → Ajustes.'), 'warn', 10000), 1500);
    scheduleStreakReminder();
    document.addEventListener('visibilitychange', () => { if (document.hidden) scheduleStreakReminder(); });
    // tramos pintados con versiones anteriores: su geometría (pendiente de subir y la de tu nube) para reconocerlos con la nueva fuente de mapas
    W.addLegacyGeo(S().pendingGeo);
    if (PM.profile === 'real' && PM.player && PM.cloud.allowed() && PM.cloud.password() && Date.now() - (S().legacyCloudT || 0) > 7 * 86400000) {
      PM.cloud.load(PM.player.name, PM.cloud.password()).then((r) => {
        if (r && r.geo) { W.addLegacyGeo(r.geo); S().legacyCloudT = Date.now(); PM.state.save(); }
      }).catch((e) => console.warn('Geometría de la nube para la migración: pendiente', e));
    }
    // perfil real sin nube conectada: aviso claro (sin el token en el móvil, el PC no puede ver tu progreso)
    if (PM.isNative && PM.profile === 'real' && PM.cloud.allowed() && !PM.cloud.token()) {
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
    if (S().guia) PM.need('js/bienvenida.js').then(() => PM.bienvenida.guia({ S, G, W, toast, pos: () => pos, enPaseo: () => !!(session && !session.paused),
      marcar: (id) => { guiaObj = id; fxSync(); }, irA: goToPlace })).catch(() => {});
    else setTimeout(() => toast(autoResumed && session && !session.paused ? '▶ Tu paseo sigue: la app se había cerrado, seguimos pintando' : session ? '⏸ Tienes un paseo en pausa: pulsa ▶ para reanudar' :
      isNative ? '📡 Pulsa «Empezar a pintar» y sal a la calle' : '🕹️ Pulsa «Empezar a pintar» y muévete con WASD o clic', 'info', 4500), 600);
  }
  $('#start').addEventListener('click', () => begin(true));
  // paseo en marcha que Android cerró: se vuelve directo al mapa y sigue pintando (sin pasar por la pantalla de inicio)
  if (autoResumed && PM.player && session && !session.paused) setTimeout(() => begin(), 200);
  // idioma: se elige al principio (la primera vez, a pantalla completa) y se cambia aquí o en Perfil → Preferencias
  const langBtns = () => Object.entries(PM.i18n.LANGS).map(([k, v]) => `<button data-l="${k}" class="${k === PM.i18n.lang ? 'on' : ''}">${v}</button>`).join('');
  $('#lang-pick').innerHTML = Object.keys(PM.i18n.LANGS).length > 1 ? langBtns() : '';
  $('#lang-pick').addEventListener('click', (e) => { const b = e.target.closest('[data-l]'); if (b) PM.i18n.set(b.dataset.l); });
  if (!PM.i18n.chosen() && !(autoResumed && session && !session.paused)) {
    const el = document.createElement('div');
    el.id = 'lang-first'; el.setAttribute('translate', 'no');
    el.innerHTML = `<div class="lf-in"><div class="logo" translate="no"><span class="p">Pinta</span><span class="m">Mapa</span></div>
      <h2>🌐 Idioma · Idioma · Language · Langue</h2><div class="langs big">${langBtns()}</div></div>`;
    el.addEventListener('click', (e) => { const b = e.target.closest('[data-l]'); if (!b) return; PM.i18n.set(b.dataset.l); el.remove(); });
    document.body.appendChild(el);
  }
  $('#intro-ver').textContent = 'datos © OpenStreetMap · mapa OpenFreeMap © OpenMapTiles';   // (la versión ya va en la etiqueta de arriba)
  // versión bien visible (inicio y esquina del juego) para saber qué versión tienes instalada
  $('#intro-badge').innerHTML = `Versión <b>${PM.VERSION.app}</b> · ${new Date(PM.VERSION.date).toLocaleDateString(PM.LOCALE, { day: 'numeric', month: 'short', year: 'numeric' })}` +
    (PM.isNative ? '' : ' · <i>web</i>');
  document.documentElement.style.setProperty('--paint', paintColor());
  $('#start').textContent = 'Crear y jugar';
  // recién elegido el nombre: se entra directamente sin volver a pulsar
  try { if (PM.player && sessionStorage.getItem('pintamapa_autostart')) { sessionStorage.removeItem('pintamapa_autostart'); begin(); } } catch (e) {}
  PM.update.listo();   // el juego arrancó bien: esta versión se queda
})();
