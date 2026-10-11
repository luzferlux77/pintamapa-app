// PintaMapa — el mundo: barrios (celdas), calles troceadas en tramos, monumentos, botes de pintura
PM.world = (function () {
  const TILE = 0.01;          // tamaño de barrio en grados (~1.1 km x 0.8 km en España)
  const PIECE_LEN = 12;       // cada calle se trocea en tramos de ~12 m pintables (fiel al trazado)
  const CELL = 0.0005;        // celda del índice espacial (~50 m)

  // calles "de verdad": se excluyen autopistas, aceras sueltas, caminos de servicio, etc.
  const HIGHWAYS = 'primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|unclassified|living_street|pedestrian|road';

  // En el navegador solo sirven los servidores que permiten CORS; en Android se usa HTTP nativo (sin CORS)
  // y se puede tirar de todos, identificándonos con un User-Agent (algunos lo exigen).
  const OVERPASS_WEB = [
    'https://overpass-api.de/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  ];
  const OVERPASS_NATIVE = OVERPASS_WEB.concat([
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ]);

  const tiles = {};           // key -> {key, i, j, pieces:[], total, loaded, name, city, demo}
  const pieces = {};          // id -> {id, tile, pts, len, mid}
  const index = {};           // celda -> [ids]
  const landmarks = {};       // id -> {id, name, kind, pos, rarity, points, emoji}
  const loading = new Set();
  let retries = 0;
  let demoMode = false;
  let listeners = [];

  const tileKeyOf = (lat, lon) => Math.floor(lat / TILE) + '_' + Math.floor(lon / TILE);
  const tileIJ = (key) => key.split('_').map(Number);
  const tileBounds = (key) => {
    const [i, j] = tileIJ(key);
    return [[i * TILE, j * TILE], [(i + 1) * TILE, (j + 1) * TILE]];
  };
  const cellKey = (lat, lon) => Math.floor(lat / CELL) + ':' + Math.floor(lon / CELL);

  function onChange(fn) { listeners.push(fn); }
  function emit(ev, data) { listeners.forEach((fn) => fn(ev, data)); }

  // ---------------- Clasificación de monumentos (rarezas tipo "Pokédex") ----------------
  const RARITY = {
    comun:      { label: 'Común',      color: '#9aa4b2', mult: 1 },
    raro:       { label: 'Raro',       color: '#3fa9ff', mult: 2 },
    epico:      { label: 'Épico',      color: '#b65cff', mult: 3 },
    legendario: { label: 'Legendario', color: '#ffb700', mult: 5 },
  };

  function classify(tags) {
    // prio: importancia para la conquista (decide qué se queda cuando dos están muy cerca). El ayuntamiento, siempre el primero.
    const a = tags.amenity, h = tags.historic, t = tags.tourism, b = tags.building, l = tags.leisure, n = tags.name || '';
    if (a === 'townhall') return { kind: 'Ayuntamiento', emoji: '🏛️', rarity: 'legendario', prio: 100 };
    if (b === 'cathedral' || /catedral|cathedral|cathédrale|cattedrale|duomo|dom\b|kathedrale|domkirke/i.test(n)) return { kind: 'Catedral', emoji: '⛪', rarity: 'legendario', prio: 95 };
    if (h === 'castle' || h === 'fort') return { kind: 'Castillo', emoji: '🏰', rarity: 'legendario', prio: 90 };
    if (l === 'stadium') return { kind: 'Estadio', emoji: '🏟️', rarity: 'epico', prio: 85 };
    if (b === 'basilica' || /bas[ií]lica/i.test(n)) return { kind: 'Basílica', emoji: '⛪', rarity: 'epico', prio: 80 };
    if (a === 'place_of_worship') return { kind: /christian/.test(tags.religion || 'christian') ? 'Iglesia' : 'Templo', emoji: '⛪', rarity: 'epico', prio: 75 };
    if (t === 'museum') return { kind: 'Museo', emoji: '🖼️', rarity: 'epico', prio: 70 };
    if (h === 'monument') return { kind: 'Monumento', emoji: '🗽', rarity: 'epico', prio: 70 };
    if (h === 'city_gate' || h === 'tower') return { kind: 'Torre / Puerta', emoji: '🗼', rarity: 'epico', prio: 65 };
    if (a === 'theatre') return { kind: 'Teatro', emoji: '🎭', rarity: 'raro', prio: 60 };
    if (a === 'university') return { kind: 'Universidad', emoji: '🎓', rarity: 'raro', prio: 58 };
    if (tags.place === 'square') return { kind: 'Plaza', emoji: '🏙️', rarity: 'raro', prio: 55 };
    if (tags.man_made === 'lighthouse') return { kind: 'Faro', emoji: '🗼', rarity: 'raro', prio: 55 };
    if (tags.railway === 'station') return { kind: 'Estación', emoji: '🚉', rarity: 'raro', prio: 50 };
    if (l === 'park') return { kind: 'Parque', emoji: '🌳', rarity: 'raro', prio: 48 };
    if (h === 'ruins' || h === 'archaeological_site') return { kind: 'Ruinas', emoji: '🏺', rarity: 'raro', prio: 45 };
    if (t === 'viewpoint') return { kind: 'Mirador', emoji: '🔭', rarity: 'raro', prio: 45 };
    if (l === 'pitch' && tags.sport === 'soccer') return { kind: 'Campo de fútbol', emoji: '⚽', rarity: 'raro', prio: 44 };
    if (a === 'marketplace') return { kind: 'Mercado', emoji: '🛒', rarity: 'comun', prio: 40 };
    if (a === 'library') return { kind: 'Biblioteca', emoji: '📚', rarity: 'comun', prio: 38 };
    if (t === 'attraction') return { kind: 'Atracción', emoji: '⭐', rarity: 'raro', prio: 35 };
    if (h === 'memorial') return { kind: 'Memorial', emoji: '🗿', rarity: 'comun', prio: 30 };
    if (a === 'fountain') return { kind: 'Fuente', emoji: '⛲', rarity: 'comun', prio: 20 };
    if (t === 'artwork') return { kind: 'Arte urbano', emoji: '🎨', rarity: 'comun', prio: 15 };
    if (h) return { kind: 'Lugar histórico', emoji: '📜', rarity: 'comun', prio: 10 };
    return null;
  }

  // Que no se amontonen: entre dos puntos conquistables al menos MIN_GAP m (se queda el más importante).
  // El ayuntamiento manda: se muestra siempre y deja libre a su alrededor TOWNHALL_GAP m.
  const MIN_GAP = 90, TOWNHALL_GAP = 160;
  const GRID = 0.0015;                 // celda del índice de separación (~160 m)
  const RANK = { comun: 0, raro: 1, epico: 2, legendario: 3 };
  const lmGrid = {};                   // celda -> [landmarks aceptados]
  let lmBatch = null;                  // candidatos de la carga actual

  function addLandmark(el) {
    const tags = el.tags || {};
    if (!tags.name) return;               // solo lugares con nombre: más "coleccionables"
    if (/plaque|stolperstein|blue_plaque|bench/.test(tags.memorial || '')) return; // placas: demasiadas
    if (tags.historic === 'memorial' && !tags.memorial && el.type === 'node' && !tags.wikidata) return;
    const c = classify(tags);
    if (!c) return;
    const pos = el.type === 'node' ? [el.lat, el.lon] : el.center ? [el.center.lat, el.center.lon] : null;
    if (!pos) return;
    const id = el.type[0] + el.id;
    if (landmarks[id]) return;
    // los que tienen artículo en Wikipedia son más "importantes": suben un nivel de rareza y algo de prioridad
    const wiki = !!(tags.wikipedia || tags.wikidata);
    let rarity = c.rarity;
    if (wiki && rarity !== 'legendario') rarity = Object.keys(RANK)[RANK[rarity] + 1];
    const lm = { id, name: tags.name, kind: c.kind, emoji: c.emoji, rarity, pos, prio: c.prio + (wiki ? 6 : 0),
      townhall: c.kind === 'Ayuntamiento', points: 100 * RARITY[rarity].mult };
    if (lmBatch) lmBatch.push(lm); else commitLandmarks([lm]);
  }

  function nearbyAccepted(pos) {
    const ci = Math.floor(pos[0] / GRID), cj = Math.floor(pos[1] / GRID), out = [];
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) out.push(...(lmGrid[(ci + di) + ':' + (cj + dj)] || []));
    return out;
  }
  function commitLandmarks(list) {
    // de más importante a menos: cada uno entra solo si no tiene otro aceptado demasiado cerca
    list.sort((x, y) => y.prio - x.prio);
    for (const lm of list) {
      const clash = nearbyAccepted(lm.pos).some((o) => {
        const d = PM.geo.dist(o.pos, lm.pos);
        return d < (o.townhall || lm.townhall ? TOWNHALL_GAP : MIN_GAP);
      });
      if (clash && !lm.townhall) continue;
      landmarks[lm.id] = lm;
      const cell = Math.floor(lm.pos[0] / GRID) + ':' + Math.floor(lm.pos[1] / GRID);
      (lmGrid[cell] = lmGrid[cell] || []).push(lm);
    }
  }

  // ---------------- Trocear calles ----------------
  // Avenida ancha: se pinta entera (ambas calzadas) aunque la recorras por una sola acera
  function isWide(tags) {
    if (!tags) return false;
    const h = tags.highway || '';
    if (/^(primary|secondary)$/.test(h)) return true;
    if (tags.dual_carriageway === 'yes') return true;
    if (tags.oneway === 'yes' && /^(primary|secondary|tertiary)(_link)?$/.test(h)) return true;
    if (parseInt(tags.lanes, 10) >= 3) return true;
    if (parseFloat(tags.width) >= 12) return true;
    return false;
  }

  function addWay(wayId, geom, acceptTiles, wide) {
    // recorre la polilínea y corta cada PIECE_LEN metros; id estable: way:k
    let k = 0, cur = [geom[0]], acc = 0;
    const flush = () => {
      if (cur.length < 2) return;
      const id = wayId + ':' + k++;
      let len = 0;
      for (let i = 0; i < cur.length - 1; i++) len += PM.geo.dist(cur[i], cur[i + 1]);
      const mid = PM.geo.lerp(cur[0], cur[cur.length - 1], 0.5);
      const tk = tileKeyOf(mid[0], mid[1]);
      if (acceptTiles.has(tk) && !pieces[id] && len > 0.5) {
        const p = { id, tile: tk, pts: cur, len, mid, wide: !!wide };
        pieces[id] = p;
        tiles[tk].pieces.push(p);
        tiles[tk].total += len;
        const cells = new Set(cur.map((q) => cellKey(q[0], q[1])));
        cells.add(cellKey(mid[0], mid[1]));
        cells.forEach((c) => (index[c] = index[c] || []).push(id));
      }
    };
    for (let i = 1; i < geom.length; i++) {
      let a = cur[cur.length - 1];
      const b = geom[i];
      let seg = PM.geo.dist(a, b);
      while (acc + seg >= PIECE_LEN) {
        const t = (PIECE_LEN - acc) / seg;
        const cut = PM.geo.lerp(a, b, t);
        cur.push(cut);
        flush();
        cur = [cut]; a = cut; seg = PM.geo.dist(a, b); acc = 0;
      }
      acc += seg;
      cur.push(b);
    }
    if (acc > 3 || k === 0) flush();
  }


  // ---------------- Carga desde Overpass ----------------
  async function overpass(query, timeoutMs = 45000) {
    let lastErr;
    const Http = PM.isNative && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp;
    for (const url of Http ? OVERPASS_NATIVE : OVERPASS_WEB) {
      try {
        if (Http) {
          const r = await Http.request({ url, method: 'POST', data: 'data=' + encodeURIComponent(query),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'PintaMapa/' + PM.VERSION.app + ' (Android; juego de exploración urbana)' },
            connectTimeout: 10000, readTimeout: timeoutMs });
          if (r.status !== 200) throw new Error('HTTP ' + r.status);
          return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
        }
        const ctl = new AbortController();
        const to = setTimeout(() => ctl.abort(), timeoutMs);
        const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(query), signal: ctl.signal,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        clearTimeout(to);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return await r.json();
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }

  function ensureTile(key) {
    if (!tiles[key]) tiles[key] = { key, pieces: [], total: 0, loaded: false, name: null, city: null, demo: false };
    return tiles[key];
  }

  // ---------------- Caché local de barrios (IndexedDB) ----------------
  // Cada barrio se descarga una vez y se guarda 30 días: menos datos móviles, menos batería y arranque instantáneo.
  const CACHE_DAYS = 90;
  const CACHE_V = 2;   // súbelo si cambia lo que se descarga (p. ej. nuevos tipos de puntos): fuerza a renovar la caché
  const cache = (function () {
    let dbp = null;
    function db() {
      if (!dbp) dbp = new Promise((res, rej) => {
        const r = indexedDB.open('pintamapa', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('tiles');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      return dbp;
    }
    return {
      async get(k) {
        try {
          const d = await db();
          return await new Promise((res) => { const q = d.transaction('tiles').objectStore('tiles').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); });
        } catch (e) { return null; }
      },
      async put(k, v) {
        try { const d = await db(); d.transaction('tiles', 'readwrite').objectStore('tiles').put(v, k); } catch (e) { /* sin caché */ }
      },
    };
  })();

  // Solo guardamos lo que el juego usa de cada elemento (ocupa mucho menos)
  const KEEP_TAGS = ['highway', 'oneway', 'lanes', 'width', 'dual_carriageway', 'name', 'amenity', 'historic', 'tourism', 'building', 'memorial',
    'wikipedia', 'wikidata', 'leisure', 'sport', 'place', 'man_made', 'railway', 'religion'];
  function slim(el) {
    const tags = {};
    for (const k of KEEP_TAGS) if (el.tags && el.tags[k] != null) tags[k] = el.tags[k];
    const o = { type: el.type, id: el.id, tags };
    if (el.geometry) o.geometry = el.geometry.map((g) => ({ lat: +g.lat.toFixed(7), lon: +g.lon.toFixed(7) }));
    if (el.lat != null) { o.lat = el.lat; o.lon = el.lon; }
    if (el.center) o.center = el.center;
    return o;
  }
  // Barrios que toca un elemento (muestreando la calle cada ~10 m)
  function tilesOf(el) {
    const out = new Set();
    if (el.geometry) {
      const g = el.geometry;
      for (let i = 0; i < g.length; i++) {
        out.add(tileKeyOf(g[i].lat, g[i].lon));
        if (i < g.length - 1) {
          const a = [g[i].lat, g[i].lon], b = [g[i + 1].lat, g[i + 1].lon];
          const n = Math.ceil(PM.geo.dist(a, b) / 10);
          for (let k = 1; k < n; k++) { const q = PM.geo.lerp(a, b, k / n); out.add(tileKeyOf(q[0], q[1])); }
        }
      }
    } else {
      const c = el.center || el;
      if (c.lat != null) out.add(tileKeyOf(c.lat, c.lon));
    }
    return out;
  }

  // ---------------- Carga progresiva ----------------
  // 1) Entorno inmediato (~600 m alrededor del GPS): consulta pequeña → se pinta en segundos.
  // 2) Tu barrio completo (para el % de conquista). 3) Los 8 barrios de alrededor, en segundo plano.
  // Funciona igual en cualquier ciudad del mundo: abres la app allí y se carga lo que tienes alrededor.
  // Todo lo descargado queda en la caché del móvil (90 días).
  const QUERY = (bb) => `[out:json][timeout:60];
      way["highway"~"^(${HIGHWAYS})$"](${bb});
      out geom;
      (
        nwr["amenity"~"^(townhall|place_of_worship|fountain|theatre|library|marketplace|university)$"]["name"](${bb});
        nwr["historic"]["name"](${bb});
        nwr["tourism"~"^(museum|attraction|viewpoint|artwork)$"]["name"](${bb});
        nwr["leisure"~"^(stadium|park)$"]["name"](${bb});
        nwr["leisure"="pitch"]["sport"="soccer"]["name"](${bb});
        nwr["place"="square"]["name"](${bb});
        nwr["man_made"="lighthouse"]["name"](${bb});
        nwr["railway"="station"]["name"](${bb});
      );
      out center tags;`;
  const bboxOf = (keys) => {
    const ij = keys.map(tileIJ);
    const s = Math.min(...ij.map((x) => x[0])) * TILE, w = Math.min(...ij.map((x) => x[1])) * TILE;
    const n = (Math.max(...ij.map((x) => x[0])) + 1) * TILE, e = (Math.max(...ij.map((x) => x[1])) + 1) * TILE;
    return [s, w, n, e].map((v) => v.toFixed(5)).join(',');
  };
  const HW_RE = new RegExp('^(' + HIGHWAYS + ')$');

  // Atajo rápido: barrios pregenerados en GitHub Pages (tu zona). No es imprescindible: si un barrio no está
  // o GitHub no responde, se descarga de OpenStreetMap por datos como siempre.
  const CDN = 'https://luzferlux77.github.io/pintamapa-app/calles/';
  const cdnMissing = new Set();
  async function cdnTile(k) {
    if (demoMode || cdnMissing.has(k)) return null;
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 8000);
      const r = await fetch(CDN + k + '.json', { signal: ctl.signal });
      clearTimeout(to);
      if (!r.ok) { cdnMissing.add(k); return null; }
      const j = await r.json();
      cache.put(k, { v: CACHE_V, t: Date.now(), els: j.els });
      if (j.name || j.city) {
        const t = ensureTile(k);
        t.name = t.name || j.name; t.city = t.city || j.city;
        if (PM.state) PM.state.data.tileNames[k] = { name: t.name, city: t.city };
      }
      return j.els;
    } catch (e) { cdnMissing.add(k); return null; }
  }

  async function cachedTile(k) {
    if (demoMode) return null;
    const c = await cache.get(k);
    return c && c.v === CACHE_V && Date.now() - c.t < CACHE_DAYS * 86400000 ? c.els : null;
  }

  // Descarga barrios de Overpass (una consulta) y los guarda en caché; devuelve {barrio: elementos}
  async function fetchTiles(keys) {
    const data = await overpass(QUERY(bboxOf(keys)), 90000);
    const per = {}; keys.forEach((k) => (per[k] = []));
    for (const raw of data.elements) {
      const el = slim(raw);
      for (const k of tilesOf(el)) if (per[k]) per[k].push(el);
    }
    for (const k of keys) cache.put(k, { v: CACHE_V, t: Date.now(), els: per[k] });
    return per;
  }

  // Mete elementos en el mundo (calles troceadas en los barrios aceptados + monumentos)
  function ingest(elements, accept) {
    lmBatch = [];
    const seen = new Set();
    for (const el of elements) {
      if (seen.has(el.type + el.id)) continue;
      seen.add(el.type + el.id);
      if (el.type === 'way' && el.geometry && el.tags && el.tags.highway && HW_RE.test(el.tags.highway)) {
        addWay('w' + el.id, el.geometry.map((g) => [g.lat, g.lon]), accept, isWide(el.tags));
      } else if (el.tags) addLandmark(el);
    }
    commitLandmarks(lmBatch); lmBatch = null;
  }

  // Carga completa de unos barrios (caché o red). Lanza error si no hay red.
  async function loadTiles(keys) {
    keys = keys.filter((k) => !ensureTile(k).loaded && !loading.has(k));
    if (!keys.length) return;
    keys.forEach((k) => loading.add(k));
    try {
      const els = [];
      const fetchKeys = [];
      for (const k of keys) { const c = await cachedTile(k); if (c) els.push(...c); else fetchKeys.push(k); }
      // los que no están en el móvil: primero GitHub (rápido), el resto de OpenStreetMap
      if (fetchKeys.length && !demoMode) {
        const got = await Promise.all(fetchKeys.map((k) => cdnTile(k)));
        for (let i = fetchKeys.length - 1; i >= 0; i--) if (got[i]) { els.push(...got[i]); fetchKeys.splice(i, 1); }
      }
      if (demoMode) {
        lmBatch = []; keys.forEach((k) => buildDemoTile(k)); commitLandmarks(lmBatch); lmBatch = null;
      } else {
        if (fetchKeys.length) {
          emit('loading', { count: fetchKeys.length });
          const per = await fetchTiles(fetchKeys);
          for (const k of fetchKeys) els.push(...per[k]);
        }
        ingest(els, new Set(keys));
        keys.forEach((k) => { tiles[k].loaded = true; tiles[k].partial = false; });
      }
    } finally { keys.forEach((k) => loading.delete(k)); }
    keys.forEach((k) => spawnCans(k));
    emit('loaded', { tiles: keys });
    keys.forEach((k) => nameTile(k));
  }

  // Fase 1: solo el entorno inmediato, para empezar a pintar ya (no se guarda en caché: es parcial)
  async function quickLoad(lat, lon) {
    const dLat = 600 / PM.geo.mPerDegLat, dLon = 600 / PM.geo.mPerDegLon(lat);
    const bb = [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map((v) => v.toFixed(5)).join(',');
    emit('loading', { count: 0, quick: true });
    const data = await overpass(QUERY(bb), 15000);   // si un servidor tarda, se pasa pronto al siguiente
    const els = data.elements.map(slim);
    const touched = new Set();
    for (const el of els) for (const k of tilesOf(el)) touched.add(k);
    const accept = new Set([...touched].filter((k) => !ensureTile(k).loaded));
    ingest(els, accept);
    accept.forEach((k) => { tiles[k].partial = true; });
    emit('partial', { tiles: [...accept] });
  }

  let around = null, pending = null;   // carga en curso y la última petición llegada mientras tanto
  async function ensureAround(lat, lon) {
    if (around) { pending = [lat, lon]; return around; }
    around = (async () => {
      const cur = tileKeyOf(lat, lon);
      const [ci, cj] = tileIJ(cur);
      const ring = [];
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) if (di || dj) ring.push((ci + di) + '_' + (cj + dj));
      try {
        if (!ensureTile(cur).loaded && !ensureTile(cur).partial && !demoMode && !(await cachedTile(cur)) && !(await cdnTile(cur))) await quickLoad(lat, lon);
        await loadTiles([cur]);
        await loadTiles(ring);
        retries = 0;
      } catch (err) {
        // Nunca inventamos calles sobre una ciudad real: reintentamos más tarde
        console.warn('Overpass no disponible, reintento', err);
        retries++;
        const wait = Math.min(60, 5 * retries);
        emit('retry', { inSec: wait });
        setTimeout(() => ensureAround(lat, lon), wait * 1000);
      }
    })();
    try { await around; } finally { around = null; }
    if (pending) { const p = pending; pending = null; ensureAround(p[0], p[1]); }
  }

  // ---------------- Ciudad demo (sin internet) ----------------
  function buildDemoTile(key) {
    const t = ensureTile(key);
    const [[s, w], [n, e]] = tileBounds(key);
    const rnd = PM.rng('demo' + key);
    const accept = new Set([key]);
    const stepLat = TILE / 9, stepLon = TILE / 7;
    // cuadrícula de calles (tipo ensanche) con alguna calle cortada
    for (let r = 0; r <= 9; r++) {
      const lat = s + r * stepLat + (rnd() - 0.5) * stepLat * 0.2;
      if (rnd() < 0.1) continue;
      addWay('d' + key + 'h' + r, [[lat, w], [lat, e]], accept);
    }
    for (let c = 0; c <= 7; c++) {
      const lon = w + c * stepLon + (rnd() - 0.5) * stepLon * 0.2;
      if (rnd() < 0.1) continue;
      addWay('d' + key + 'v' + c, [[s, lon], [n, lon]], accept);
    }
    addWay('d' + key + 'diag', [[s, w], [n, e]], accept, true); // una gran avenida diagonal
    const kinds = [
      { tags: { amenity: 'townhall', name: 'Ayuntamiento Demo' } },
      { tags: { amenity: 'place_of_worship', name: 'Iglesia de San Pincel' } },
      { tags: { tourism: 'museum', name: 'Museo del Rodillo' } },
      { tags: { historic: 'monument', name: 'Monumento al Bote Perdido' } },
      { tags: { tourism: 'viewpoint', name: 'Mirador del Grafitero' } },
      { tags: { amenity: 'fountain', name: 'Fuente de los Colores' } },
    ];
    const nl = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < nl; i++) {
      const k = kinds[Math.floor(rnd() * kinds.length)];
      const r = 1 + Math.floor(rnd() * 8), c = 1 + Math.floor(rnd() * 6);
      addLandmark({ type: 'node', id: key + '_' + i, lat: s + r * stepLat + stepLat * 0.15, lon: w + c * stepLon,
        tags: { ...k.tags, name: k.tags.name + ' ' + (i + 1) } });
    }
    t.loaded = true; t.demo = true;
  }

  // ---------------- Botes de pintura del día (como "pokéballs" en el suelo) ----------------
  const cans = {}; // id -> {id, pos, tile, kind}
  function spawnCans(key) {
    const t = tiles[key];
    if (!t || !t.pieces.length) return;
    const rnd = PM.rng('cans' + key + PM.today());
    const pcs = t.pieces.slice().sort((a, b) => (a.id < b.id ? -1 : 1));   // mismo orden siempre → mismos botes
    const n = Math.min(30, Math.ceil(t.pieces.length / 60));   // ~1 bote cada 700 m de calle
    for (let i = 0; i < n; i++) {
      const p = pcs[Math.floor(rnd() * pcs.length)];
      const id = PM.today() + ':' + key + ':' + i;
      const golden = rnd() < 0.18;
      cans[id] = { id, pos: p.mid, tile: key, kind: golden ? 'gold' : 'normal' };
    }
  }

  // ---------------- Nombres de barrio y ciudad (Nominatim) ----------------
  const nameQueue = [];
  let naming = false;
  function nameTile(key) {
    const t = tiles[key];
    if (!t || t.name || !t.pieces.length) return;
    const saved = PM.state && PM.state.data.tileNames[key];
    if (saved) { t.name = saved.name; t.city = saved.city; emit('named', { key }); return; }
    if (t.demo) { t.name = 'Sector ' + key.replace('_', '·'); t.city = 'Ciudad Demo'; emit('named', { key }); return; }
    nameQueue.push(key);
    if (!naming) drainNames();
  }
  async function drainNames() {
    naming = true;
    while (nameQueue.length) {
      const key = nameQueue.shift();
      const [[s, w], [n, e]] = tileBounds(key);
      const t = tiles[key];
      try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=es&lat=${(s + n) / 2}&lon=${(w + e) / 2}`;
        const r = await fetch(url);
        const j = await r.json();
        const a = j.address || {};
        t.city = a.city || a.town || a.village || a.municipality || 'Zona sin nombre';
        t.name = a.suburb || a.neighbourhood || a.quarter || a.city_district || a.hamlet || t.city;
      } catch (e) {
        t.name = 'Sector ' + key.replace('_', '·'); t.city = t.city || 'Ciudad desconocida';
      }
      if (PM.state) PM.state.data.tileNames[key] = { name: t.name, city: t.city };
      emit('named', { key });
      ensureCityStats(t.city, (s + n) / 2, (w + e) / 2);
      await new Promise((res) => setTimeout(res, 1100)); // respeta 1 petición/seg
    }
    naming = false;
  }

  // Longitud total REAL de calles del municipio (para el objetivo del 80 %)
  const cityPending = new Set();
  async function ensureCityStats(city, lat, lon) {
    if (!city || !PM.state) return;
    const cs = PM.state.data.cities;
    let shared = {};
    try { shared = JSON.parse(localStorage.getItem('pintamapa_cities') || '{}'); } catch (e) {}
    if (shared[city] && !(cs[city] && cs[city].total)) { cs[city] = { total: shared[city] }; PM.state.save(); emit('city', { city }); return; }
    if ((cs[city] && cs[city].total) || cityPending.has(city)) return;
    cityPending.add(city);
    const q = `[out:json][timeout:90];
      is_in(${lat},${lon})->.a;
      area.a["boundary"="administrative"]["admin_level"="8"]->.c;
      way(area.c)["highway"~"^(${HIGHWAYS})$"];
      make stat len=sum(length());
      out;`;
    try {
      const data = await overpass(q, 100000);
      const st = data.elements.find((e) => e.type === 'stat');
      const len = st ? parseFloat(st.tags.len) : 0;
      if (len > 0) {
        cs[city] = Object.assign(cs[city] || {}, { total: len });
        try { shared[city] = len; localStorage.setItem('pintamapa_cities', JSON.stringify(shared)); } catch (e) {}
        PM.state.save();
        emit('city', { city });
      }
    } catch (e) { console.warn('No se pudo medir la ciudad', city, e); }
    cityPending.delete(city);
  }

  // ---------------- Consultas ----------------
  function piecesNear(p, radiusM) {
    const out = [];
    const ci = Math.floor(p[0] / CELL), cj = Math.floor(p[1] / CELL);
    const seen = new Set();
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const ids = index[(ci + di) + ':' + (cj + dj)];
      if (!ids) continue;
      for (const id of ids) {
        if (seen.has(id)) continue; seen.add(id);
        const pc = pieces[id];
        if (PM.geo.distToPolyline(p, pc.pts) <= radiusM) out.push(pc);
      }
    }
    return out;
  }

  return {
    TILE, RARITY, tiles, pieces, landmarks, cans,
    tileKeyOf, tileBounds, ensureAround, piecesNear, onChange,
    isDemo: () => demoMode,
    setDemo: (v) => { demoMode = v; },
  };
})();
