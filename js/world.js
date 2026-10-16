// PintaMapa — el mundo: barrios (celdas), calles troceadas en tramos, monumentos, botes de pintura
// Radio de captura según el sitio: los estadios son enormes (su centro está dentro del campo, donde no se puede entrar)
PM.capRadius = (kind) => ({ Estadio: 120, 'Campo de fútbol': 50, Parque: 45 })[kind] || 30;

PM.world = (function () {
  const TILE = 0.01;          // tamaño de barrio en grados (~1.1 km x 0.8 km en España)
  const PIECE_LEN = 12;       // cada calle se trocea en tramos de ~12 m pintables (fiel al trazado)
  const CELL = 0.0005;        // celda del índice espacial (~50 m)

  // calles "de verdad": se excluyen autopistas, aceras sueltas, caminos de servicio, etc.
  const HIGHWAYS = 'primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|unclassified|living_street|pedestrian|road';
  // senderos y caminos: se pintan (para el que sale al monte o al parque) pero NO cuentan para el % de barrio y ciudad
  const TRAILS = 'path|track|bridleway';   // (sin aceras ni pasos peatonales urbanos: pesan mucho y no son "senderos")
  const isTrailTags = (t) => !!t && new RegExp('^(' + TRAILS + ')$').test(t.highway || '') && !/^(sidewalk|crossing|traffic_island|access_aisle)$/.test(t.footway || '');

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
    if (b === 'cathedral' || /catedral|cathedral|cathédrale|cattedrale|\bduomo\b|\bdom\b|kathedrale|domkirke/i.test(n)) return { kind: 'Catedral', emoji: '⛪', rarity: 'legendario', prio: 95 };
    if (h === 'castle' || h === 'fort') return { kind: 'Castillo', emoji: '🏰', rarity: 'legendario', prio: 90 };
    if (b === 'palace' || /\b(palau|palacio|palace|palais|palazzo|pałac|palácio|schloss|paleis)\b/i.test(n)) return { kind: 'Palacio', emoji: '🏰', rarity: 'epico', prio: 84 };
    if (l === 'stadium' || b === 'stadium') return { kind: 'Estadio', emoji: '🏟️', rarity: 'epico', prio: 85 };
    if (b === 'basilica' || /bas[ií]lica|co-?catedral|concatedral/i.test(n)) return { kind: 'Basílica', emoji: '⛪', rarity: 'epico', prio: 80 };
    if (a === 'place_of_worship') return { kind: /christian/.test(tags.religion || 'christian') ? 'Iglesia' : 'Templo', emoji: '⛪', rarity: 'epico', prio: 75 };
    if (t === 'museum') return { kind: 'Museo', emoji: '🖼️', rarity: 'epico', prio: 70 };
    if (h === 'monument') return { kind: 'Monumento', emoji: '🗽', rarity: 'epico', prio: 70 };
    if (h === 'city_gate' || h === 'tower' || tags.man_made === 'tower' || tags.man_made === 'obelisk' || b === 'tower') return { kind: 'Torre / Puerta', emoji: '🗼', rarity: 'epico', prio: 65 };
    if (a === 'hospital') return { kind: 'Hospital', emoji: '🏥', rarity: 'raro', prio: 57 };
    if (a === 'fire_station') return { kind: 'Bomberos', emoji: '🚒', rarity: 'raro', prio: 56 };
    if (a === 'theatre') return { kind: 'Teatro', emoji: '🎭', rarity: 'raro', prio: 60 };
    if (a === 'university') return { kind: 'Universidad', emoji: '🎓', rarity: 'raro', prio: 58 };
    if (tags.place === 'square') return { kind: 'Plaza', emoji: '🏙️', rarity: 'raro', prio: 55 };
    if (tags.man_made === 'lighthouse') return { kind: 'Faro', emoji: '🗼', rarity: 'raro', prio: 55 };
    if (tags.railway === 'station') return { kind: 'Estación', emoji: '🚉', rarity: 'raro', prio: 50 };
    if (l === 'park' || l === 'garden') return { kind: 'Parque', emoji: '🌳', rarity: 'raro', prio: 48 };
    if (tags.man_made === 'windmill' || tags.man_made === 'watermill') return { kind: 'Molino', emoji: '🌬️', rarity: 'raro', prio: 52 };
    if (tags.heritage) return { kind: 'Patrimonio', emoji: /f[aàá]bri|factory|usine|fabbrica/i.test(n) ? '🏭' : '🏛️', rarity: 'raro', prio: 62 };
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
  const MIN_GAP = 60, TOWNHALL_GAP = 100;
  const GRID = 0.0015;                 // celda del índice de separación (~160 m)
  const RANK = { comun: 0, raro: 1, epico: 2, legendario: 3 };
  const lmGrid = {};                   // celda -> [landmarks aceptados]
  let lmBatch = null;                  // candidatos de la carga actual

  function addLandmark(el) {
    const tags = el.tags || {};
    if (!tags.name) return;               // solo lugares con nombre: más "coleccionables"
    if (/plaque|stolperstein|blue_plaque|bench/.test(tags.memorial || '')) return; // placas: demasiadas
    if (tags.historic === 'memorial' && !tags.memorial && el.type === 'node' && !tags.wikidata) return;
    // iglesias evangélicas / pentecostales / testigos…: no (sí las demás religiones y templos del mundo)
    if (tags.amenity === 'place_of_worship' && (/evangel|pentecost|baptist|adventist|jehovah|protestant|neo/i.test(tags.denomination || '')
      || /evang[eè]li|pentecost|bautista|baptist|adventista|filad[eè]lfia|sal[oó]n del reino|kingdom hall|testigos de jehov|centro cristiano|comunidad cristiana|ministerio|iglesia de dios|asamblea de dios|cuerpo de cristo|betel|el shaddai|nueva vida|elim\b/i.test(tags.name))) return;
    const c = classify(tags);
    if (!c) return;
    if (c.kind === 'Atracción' && !(tags.wikipedia || tags.wikidata)) return;   // "atracciones" sin artículo: casi siempre ruido
    if (tags.station === 'miniature' || tags.railway === 'station' && /miniature|museum/.test(tags.station || '')) return;
    const b = el.bounds;
    const pos = el.type === 'node' ? [el.lat, el.lon] : el.center ? [el.center.lat, el.center.lon]
      : b ? [(b.minlat + b.maxlat) / 2, (b.minlon + b.maxlon) / 2] : null;
    // parques: solo los representativos (con artículo en Wikipedia o grandes: > ~3 hectáreas). Fuera parquecitos y plazas-jardín
    if (c.kind === 'Parque' && !(tags.wikipedia || tags.wikidata || tags._wp)) {
      const area = b ? (b.maxlat - b.minlat) * PM.geo.mPerDegLat * (b.maxlon - b.minlon) * PM.geo.mPerDegLon(b.minlat) * 0.6 : 0;
      if (area < 30000) return;
    }
    if (!pos) return;
    let id = el.type[0] + el.id;
    // ya conquistado con otro id (llegó de otra fuente de datos): se usa el de tu conquista
    if (PM.state && !PM.state.data.landmarks[id]) {
      for (const [cid, r] of Object.entries(PM.state.data.landmarks)) if (r.name === tags.name && r.pos && PM.geo.dist(r.pos, pos) < 60) { id = cid; break; }
    }
    if (landmarks[id]) return;
    // los que tienen artículo en Wikipedia son más "importantes": suben un nivel de rareza y algo de prioridad
    const wiki = !!(tags.wikipedia || tags.wikidata);
    let rarity = c.rarity, prio = c.prio + (wiki ? 6 : 0);
    // parques y plazas: solo los emblemáticos (con artículo) compiten con monumentos; el resto, al final de la cola
    const green = c.kind === 'Parque' || c.kind === 'Plaza';
    if (green && !wiki) { rarity = 'comun'; prio -= 28; }
    if (wiki && rarity !== 'legendario' && !green) rarity = Object.keys(RANK)[RANK[rarity] + 1];
    // de Wikidata: cuantos más idiomas tienen artículo, más famoso (el Coliseo, la Sagrada Família…)
    const wp = tags._wp || 0;
    if (wp >= 15) rarity = 'legendario'; else if (wp >= 5 && RANK[rarity] < RANK.epico) rarity = 'epico';
    prio += Math.min(12, wp);
    // estadios con artículo en Wikipedia (los de equipos profesionales, de primera y segunda): legendarios
    if (c.kind === 'Estadio' && wiki) rarity = 'legendario';
    const church = /^(Iglesia|Basílica|Catedral)$/.test(c.kind);
    const lm = { id, name: tags.name, kind: c.kind, emoji: c.emoji, rarity, pos, prio, fromWd: !!tags._wp, wp, wiki: tags.wikipedia, wd: tags.wikidata,
      townhall: c.kind === 'Ayuntamiento', church, points: 100 * RARITY[rarity].mult,
      // importantes: SIEMPRE visibles y conquistables, sin restricción de cercanía con otros puntos:
      // ayuntamiento, catedral, basílica, castillo y cualquier lugar con artículo en Wikipedia o protegido como patrimonio
      // (de Wikidata: si tiene artículo en 2+ idiomas; parques y plazas: solo con artículo)
      principal: c.kind !== 'Estación' && (c.kind === 'Ayuntamiento' || /^(Catedral|Basílica|Castillo|Estadio|Palacio|Museo)$/.test(c.kind)
        || (tags._wp ? tags._wp >= 2 : (wiki || (!!tags.heritage && !green)))),
      capR: PM.capRadius(c.kind) };
    if (lmBatch) lmBatch.push(lm); else commitLandmarks([lm]);
  }

  function nearbyAccepted(pos) {
    const ci = Math.floor(pos[0] / GRID), cj = Math.floor(pos[1] / GRID), out = [];
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) out.push(...(lmGrid[(ci + di) + ':' + (cj + dj)] || []));
    return out;
  }
  // Respaldo: si en un pueblo ninguna iglesia es "importante" (Wikipedia, patrimonio, catedral…), se toma
  // como principal la más cercana a su ayuntamiento (a menos de 800 m). Se recuerdan las iglesias descartadas
  // por si su ayuntamiento llega en una carga posterior.
  const MAIN_CHURCH_M = 800;
  const churchPool = [];
  function markMainChurches(list) {
    for (const lm of list) if (lm.church && !churchPool.some((c) => c.id === lm.id)) churchPool.push(lm);
    const halls = [...list, ...Object.values(landmarks)].filter((x) => x.townhall);
    const promoted = [];
    for (const th of halls) {
      // ¿ya hay una iglesia principal en este pueblo? (a menos de 1,5 km de su ayuntamiento)
      if (churchPool.some((c) => c.principal && PM.geo.dist(th.pos, c.pos) < 1500)) continue;
      let best = null, bd = MAIN_CHURCH_M;
      for (const c of churchPool) { const d = PM.geo.dist(th.pos, c.pos); if (d < bd) { bd = d; best = c; } }
      if (best && !best.principal) { best.principal = true; best.mainChurch = true; best.kind = 'Iglesia principal';
        if (RANK[best.rarity] < RANK.epico) best.rarity = 'epico'; best.points = 100 * RARITY[best.rarity].mult; promoted.push(best); }
    }
    return promoted;
  }
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(de|del|la|el|les|los|las|dels|of|the|le|du|di|della)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  function sameName(a, b) { a = norm(a); b = norm(b); return !!a && !!b && (a === b || (a.length > 5 && b.includes(a)) || (b.length > 5 && a.includes(b))); }
  function accept(lm) {
    landmarks[lm.id] = lm;
    const cell = Math.floor(lm.pos[0] / GRID) + ':' + Math.floor(lm.pos[1] / GRID);
    (lmGrid[cell] = lmGrid[cell] || []).push(lm);
  }
  function commitLandmarks(list) {
    // iglesias principales que ya estaban descartadas de antes y ahora tienen su ayuntamiento: entran
    for (const c of markMainChurches(list)) if (!landmarks[c.id] && !list.includes(c)) accept(c);
    // de más importante a menos: cada uno entra solo si no tiene otro aceptado demasiado cerca.
    // Los principales entran siempre (y no se tapan entre ellos).
    list.sort((x, y) => (y.principal - x.principal) || (y.prio - x.prio));
    // lo de Wikidata que ya está en OpenStreetMap (mismo Q, o el mismo sitio con otro nombre) no se duplica
    // y si coinciden en el mismo sitio, gana el más conocido (p. ej. el Palau de Can Mercader frente al museo que hay dentro)
    const osm = list.filter((x) => !x.fromWd), skip = new Set();
    for (const lm of list) {
      if (!lm.fromWd) continue;
      const near = [...osm, ...nearbyAccepted(lm.pos)].filter((o) => o !== lm && !o.fromWd);
      if (near.some((o) => o.wd && o.wd === lm.wd)) { skip.add(lm); continue; }
      const close = near.filter((o) => { const d = PM.geo.dist(o.pos, lm.pos); return d < 40 || (o.kind === lm.kind && d < 150) || (sameName(o.name, lm.name) && d < 300); });
      if (!close.length) continue;
      if (lm.wp >= 2 && close.every((o) => !o.wd && !o.wiki && !landmarks[o.id])) close.forEach((o) => skip.add(o)); else skip.add(lm);
    }
    for (const lm of list) {
      if (landmarks[lm.id] || skip.has(lm)) continue;
      if (nearbyAccepted(lm.pos).some((o) => o.name === lm.name && PM.geo.dist(o.pos, lm.pos) < 80)) continue;
      if (!lm.principal) {
        const clash = nearbyAccepted(lm.pos).some((o) => PM.geo.dist(o.pos, lm.pos) < (o.townhall ? TOWNHALL_GAP : MIN_GAP));
        if (clash) continue;
      }
      accept(lm);
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

  // Tramos de calle "anclados al mapa": cada calle se corta donde cruza una cuadrícula fija de ~11 m, y el id del
  // tramo es la casilla + su dirección. Así el mismo trozo de calle tiene SIEMPRE el mismo id, venga de donde venga
  // (OpenFreeMap, OpenStreetMap oficial, VersaTiles u Overpass), y lo pintado se reconoce con cualquier fuente.
  const GLAT = 0.0001, GLON = 0.00013;
  function gridCut(geom) {
    const out = []; let cur = [geom[0]], curLen = 0;
    for (let i = 1; i < geom.length; i++) {
      const a = geom[i - 1], b = geom[i], ts = [];
      if (a[0] !== b[0]) for (let k = Math.floor(Math.min(a[0], b[0]) / GLAT) + 1; k * GLAT < Math.max(a[0], b[0]); k++) ts.push((k * GLAT - a[0]) / (b[0] - a[0]));
      if (a[1] !== b[1]) for (let k = Math.floor(Math.min(a[1], b[1]) / GLON) + 1; k * GLON < Math.max(a[1], b[1]); k++) ts.push((k * GLON - a[1]) / (b[1] - a[1]));
      ts.sort((x, y) => x - y);
      let last = a;
      for (const t of ts) {
        if (t <= 1e-9 || t >= 1 - 1e-9) continue;
        const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        curLen += PM.geo.dist(last, q); last = q;
        cur.push(q);
        if (curLen >= 1) { out.push(cur); cur = [q]; curLen = 0; }   // trozos de menos de 1 m: se quedan pegados al siguiente
      }
      curLen += PM.geo.dist(last, b);
      cur.push(b);
    }
    if (cur.length > 1) { if (curLen < 1 && out.length) out[out.length - 1].push(...cur.slice(1)); else out.push(cur); }
    return out;
  }
  function pieceId(pts, mid) {
    const a = pts[0], b = pts[pts.length - 1];
    const brg = (Math.atan2((b[1] - a[1]) * Math.cos(a[0] * Math.PI / 180), b[0] - a[0]) * 180 / Math.PI + 360) % 180;
    const sec = Math.floor(brg / 22.5) % 8;
    return { base: 'c' + Math.floor(mid[0] / GLAT) + '_' + Math.floor(mid[1] / GLON) + '.', sec };
  }

  function addWay(wayId, geom, acceptTiles, wide, trail) {
    const added = [];
    for (const pts of gridCut(geom)) {
      let len = 0;
      for (let i = 0; i < pts.length - 1; i++) len += PM.geo.dist(pts[i], pts[i + 1]);
      if (len < 0.3) continue;
      const mid = PM.geo.lerp(pts[0], pts[pts.length - 1], 0.5);
      const tk = tileKeyOf(mid[0], mid[1]);
      if (!acceptTiles.has(tk)) continue;
      const { base, sec } = pieceId(pts, mid);
      let id = base + sec;
      // el mismo tramo llegado por otra tesela o fuente: ya está
      if (pieces[id] && PM.geo.dist(pieces[id].mid, mid) < 4) continue;
      // si la dirección cae justo en el borde entre dos sectores, se reconoce lo ya pintado con el sector vecino
      const painted = PM.state ? PM.state.data.painted : {};
      if (!painted[id]) for (const alt of [base + (sec + 1) % 8, base + (sec + 7) % 8]) if (painted[alt] && !pieces[alt]) { id = alt; break; }
      if (pieces[id]) { let n = 2; while (pieces[id + '~' + n]) n++; id = id + '~' + n; }   // dos calles en la misma casilla
      const p = { id, tile: tk, pts, len, mid, wide: !!wide, trail: !!trail };
      graphAdd(p);
      p.avoid = inAvoidCircle(mid);
      pieces[id] = p;
      tiles[tk].pieces.push(p);
      if (!trail) tiles[tk].total += len;
      const cells = new Set(pts.map((q) => cellKey(q[0], q[1])));
      cells.add(cellKey(mid[0], mid[1]));
      cells.forEach((c) => (index[c] = index[c] || []).push(id));
      added.push(p);
    }
    return added;
  }

  // ---------------- Migración: lo pintado con los tramos antiguos (id "w<vía>:<n>") pasa a los tramos nuevos ----------------
  // Nada se pierde: los ids antiguos se quedan guardados; los tramos nuevos que caen encima de una calle que ya
  // pintaste se marcan como pintados (sin dar puntos otra vez). La geometría antigua sale de las calles guardadas
  // en el móvil (Overpass), de lo pendiente de subir y de tu nube.
  const LEGACY_RE = /^w\d+:\d+$/;
  let legacyOn = null;
  const legacyIdx = {};   // celda (~50 m) -> [{ pts, heat }]
  let legacyCount = 0;
  function legacyActive() {
    if (legacyOn === null && PM.state) legacyOn = Object.keys(PM.state.data.painted).some((k) => LEGACY_RE.test(k));
    return !!legacyOn;
  }
  function addLegacy(pts, heat) {
    const rec = { pts, heat: heat || 1 };
    const cells = new Set(pts.map((q) => cellKey(q[0], q[1])));
    cells.forEach((c) => (legacyIdx[c] = legacyIdx[c] || []).push(rec));
    legacyCount++;
  }
  // corte antiguo (cada 12 m desde el inicio de la vía), idéntico al de versiones anteriores, para saber qué geometría tenía cada id
  function legacyPieces(wayId, geom, cb) {
    let k = 0, cur = [geom[0]], acc = 0;
    const flush = () => { if (cur.length < 2) return; cb(wayId + ':' + k++, cur); };
    for (let i = 1; i < geom.length; i++) {
      let a = cur[cur.length - 1];
      const b = geom[i];
      let seg = PM.geo.dist(a, b);
      while (acc + seg >= 12) {
        const t = (12 - acc) / seg, cut = PM.geo.lerp(a, b, t);
        cur.push(cut); flush();
        cur = [cut]; a = cut; seg = PM.geo.dist(a, b); acc = 0;
      }
      acc += seg; cur.push(b);
    }
    if (acc > 3 || k === 0) flush();
  }
  function legacyFrom(el, geom) {
    if (!legacyActive() || el.src === 'vt' || typeof el.id !== 'number') return;
    const s = PM.state.data;
    legacyPieces('w' + el.id, geom, (id, pts) => { if (s.painted[id]) addLegacy(pts.slice(), (s.heat || {})[id]); });
  }
  function legacyCovers(p) {
    let heat = 0;
    for (const f of [0.2, 0.5, 0.8]) {
      const q = PM.geo.lerp(p.pts[0], p.pts[p.pts.length - 1], f);
      let hit = null;
      const ci = Math.floor(q[0] / CELL), cj = Math.floor(q[1] / CELL);
      for (let di = -1; di <= 1 && !hit; di++) for (let dj = -1; dj <= 1 && !hit; dj++)
        for (const rec of legacyIdx[(ci + di) + ':' + (cj + dj)] || []) if (PM.geo.distToPolyline(q, rec.pts) <= 5) { hit = rec; break; }
      if (!hit) return null;
      heat = Math.max(heat, hit.heat);
    }
    return { heat };
  }
  function migrate(list) {
    if (!legacyCount || !PM.state) return 0;
    const s = PM.state.data;
    let n = 0;
    for (const p of list) {
      if (s.painted[p.id]) continue;
      const c = legacyCovers(p);
      if (!c) continue;
      s.painted[p.id] = 1; n++;
      if (c.heat > 1) { s.heat = s.heat || {}; s.heat[p.id] = Math.max(s.heat[p.id] || 0, c.heat); }
    }
    if (n) PM.state.save();
    return n;
  }
  // geometría antigua conocida (id → puntos): pendientes de subir, nube…
  function addLegacyGeo(geo) {
    if (!legacyActive() || !geo) return 0;
    const s = PM.state.data;
    for (const [id, pts] of Object.entries(geo)) if (LEGACY_RE.test(id) && s.painted[id] && pts && pts.length > 1) addLegacy(pts, (s.heat || {})[id]);
    const n = migrate(Object.values(pieces));
    if (n) emit('migrated', { n });
    return n;
  }


  // ---------------- Carga desde Overpass ----------------
  // Peticiones "en carrera": se pregunta a un servidor y, si en HEDGE_MS no ha contestado, también al siguiente
  // (y así); gana el primero que responde. Los servidores públicos de OSM a veces tardan mucho: así no se espera al lento.
  const HEDGE_MS = 3000;
  function overpass(query, timeoutMs = 45000) {
    const Http = PM.isNative && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp;
    const urls = Http ? OVERPASS_NATIVE : OVERPASS_WEB;
    const ctls = [];
    return new Promise((resolve, reject) => {
      let done = false, failed = 0, started = 0, lastErr = null, timer = null;
      const launch = () => {
        if (done || started >= urls.length) return;
        const url = urls[started++];
        const ctl = new AbortController(); ctls.push(ctl);
        overpassOne(url, query, timeoutMs, ctl, Http).then((r) => {
          if (done) return;
          done = true; clearTimeout(timer); ctls.forEach((c) => c !== ctl && c.abort());
          resolve(r);
        }, (e) => {
          lastErr = e; failed++;
          if (done) return;
          if (failed >= urls.length) { done = true; clearTimeout(timer); reject(lastErr); } else { clearTimeout(timer); launch(); schedule(); }
        });
      };
      const schedule = () => { timer = setTimeout(() => { launch(); schedule(); }, HEDGE_MS); };
      launch(); schedule();
    });
  }
  async function overpassOne(url, query, timeoutMs, ctl, Http) {
    if (Http) {
      const r = await Http.request({ url, method: 'POST', data: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'PintaMapa/' + PM.VERSION.app + ' (Android; juego de exploración urbana)' },
        connectTimeout: 10000, readTimeout: timeoutMs });
      if (r.status !== 200) throw new Error('HTTP ' + r.status);
      return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
    }
    const to = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(query), signal: ctl.signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(to); }
  }

  function ensureTile(key) {
    if (!tiles[key]) tiles[key] = { key, pieces: [], total: 0, loaded: false, name: null, city: null, demo: false };
    return tiles[key];
  }

  // ---------------- Caché local de barrios (IndexedDB) ----------------
  // Cada barrio se descarga una vez y se guarda 30 días: menos datos móviles, menos batería y arranque instantáneo.
  const CACHE_DAYS = 90;
  const CACHE_V = 7;   // súbelo si cambia lo que se descarga (p. ej. nuevos tipos de puntos): fuerza a renovar la caché
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
    'wikipedia', 'wikidata', 'leisure', 'sport', 'place', 'man_made', 'railway', 'religion', 'admin_level', 'boundary', 'heritage', 'footway', 'denomination', 'emergency', 'station'];
  function slim(el) {
    const tags = {};
    for (const k of KEEP_TAGS) if (el.tags && el.tags[k] != null) tags[k] = el.tags[k];
    const o = { type: el.type, id: el.id, tags };
    if (el.geometry) o.geometry = el.geometry.map((g) => ({ lat: +g.lat.toFixed(7), lon: +g.lon.toFixed(7) }));
    if (el.lat != null) { o.lat = el.lat; o.lon = el.lon; }
    if (el.center) o.center = el.center;
    if (el.bounds) o.bounds = el.bounds;
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
    } else if (el.bounds) {   // contorno de barrio: todas las celdas que abarca
      const b = el.bounds;
      const [i0, j0] = tileIJ(tileKeyOf(b.minlat, b.minlon)), [i1, j1] = tileIJ(tileKeyOf(b.maxlat, b.maxlon));
      if ((i1 - i0 + 1) * (j1 - j0 + 1) <= 400) for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) out.add(i + '_' + j);
    } else {
      const c = el.center || el;
      if (c.lat != null) out.add(tileKeyOf(c.lat, c.lon));
    }
    return out;
  }

  // ---------------- Red de calles para rellenar huecos del GPS ----------------
  // Con la pantalla apagada (móvil en el bolsillo) el GPS a veces se salta lecturas. Entre dos lecturas
  // separadas se busca el camino más corto POR LAS CALLES y se pinta ese recorrido (no una línea recta).
  const gnodes = new Map();   // "lat,lon" -> { p:[lat,lon], e:[{ to, len, piece }] }
  const gkey = (q) => q[0].toFixed(5) + ',' + q[1].toFixed(5);
  function gnode(q) {
    const k = gkey(q);
    let n = gnodes.get(k);
    if (!n) {   // ¿hay un vértice a menos de 1 m en una casilla vecina? (la misma esquina llegada de dos teselas)
      const la = Math.round(q[0] * 1e5), lo = Math.round(q[1] * 1e5);
      for (let i = -1; i <= 1 && !n; i++) for (let j = -1; j <= 1 && !n; j++) {
        const o = gnodes.get(((la + i) / 1e5).toFixed(5) + ',' + ((lo + j) / 1e5).toFixed(5));
        if (o && PM.geo.dist(o.p, q) < 1) n = o;
      }
    }
    if (!n) { n = { k, p: q, e: [] }; gnodes.set(k, n); }
    return n;
  }
  function graphAdd(piece) {
    for (let i = 0; i < piece.pts.length - 1; i++) {
      const a = gnode(piece.pts[i]), b = gnode(piece.pts[i + 1]);
      if (a === b) continue;
      const len = PM.geo.dist(a.p, b.p);
      a.e.push({ to: b, len, piece: piece.id });
      b.e.push({ to: a, len, piece: piece.id });
    }
  }
  // vértice de la red más cercano a un punto (a menos de maxM)
  function nearestNode(p, maxM) {
    let best = null, bd = maxM;
    for (const pc of piecesNear(p, maxM)) for (const q of pc.pts) {
      const d = PM.geo.dist(p, q);
      if (d < bd) { bd = d; best = gnodes.get(gkey(q)); }
    }
    return best;
  }
  // Dijkstra acotado: devuelve { len, pieces:[ids] } o null si no hay camino razonable
  function route(a, b, maxLen) {
    if (!a || !b) return null;
    const s = nearestNode(a, 35), t = nearestNode(b, 35);
    if (!s || !t) return null;
    if (s === t) return { len: 0, pieces: [] };
    const dist = new Map([[s, 0]]), prev = new Map(), done = new Set();
    const heap = [[0, s]];
    const push = (x) => { heap.push(x); let i = heap.length - 1; while (i > 0) { const j = (i - 1) >> 1; if (heap[j][0] <= heap[i][0]) break; [heap[i], heap[j]] = [heap[j], heap[i]]; i = j; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } } return top; };
    let iter = 0;
    while (heap.length && iter++ < 60000) {
      const [d, n] = pop();
      if (done.has(n)) continue;
      done.add(n);
      if (n === t) break;
      if (d > maxLen) return null;
      for (const ed of n.e) {
        const nd = d + ed.len;
        if (nd < (dist.has(ed.to) ? dist.get(ed.to) : Infinity)) { dist.set(ed.to, nd); prev.set(ed.to, [n, ed.piece]); push([nd, ed.to]); }
      }
    }
    if (!done.has(t)) return null;
    const ids = new Set(), path = [t.p];
    for (let n = t; prev.has(n); n = prev.get(n)[0]) { ids.add(prev.get(n)[1]); path.push(prev.get(n)[0].p); }
    return { len: dist.get(t), pieces: [...ids], path: path.reverse() };   // path: el camino por las calles, de a a b
  }

  // ---------------- Zonas a evitar (personales) ----------------
  // Cada pintor puede marcar barrios enteros o zonas (círculos) por donde prefiere no pasar.
  // Sus calles quedan FUERA del porcentaje del barrio y de la ciudad: se puede llegar al 80 % sin pisarlas.
  let avoidCircles = [], avoidBarrios = new Set();
  function inAvoidCircle(p) { return avoidCircles.some((z) => PM.geo.dist(p, z.c) <= z.r); }
  function setAvoid(list) {
    avoidCircles = (list || []).filter((z) => z.type === 'circle');
    avoidBarrios = new Set((list || []).filter((z) => z.type === 'barrio').map((z) => z.id));
    for (const id in pieces) pieces[id].avoid = inAvoidCircle(pieces[id].mid);
    scheduleReassign();
  }
  const isAvoided = (p) => inAvoidCircle(p) || avoidBarrios.has(barrioOf(p).id);

  // ---------------- Barrios reales ----------------
  // Cada calle pertenece a un barrio de verdad, según lo que tenga OpenStreetMap en esa ciudad:
  //  1) contorno oficial (admin_level 10 = barrio; 9 = distrito): la calle es del barrio que la contiene;
  //  2) solo el punto con el nombre del barrio (place=neighbourhood/quarter/suburb): del punto más cercano
  //     (dentro de su distrito, si se conoce);
  //  3) nada: la cuadrícula de siempre.
  const NODE_LVL = { suburb: 1, quarter: 2, neighbourhood: 3 };
  const barrioNodes = {};     // id -> { id, name, pos, lvl }
  const barrioRels = {};      // id -> { id, name, lvl, bounds:[s,w,n,e], segs, loading, failed }
  const barrios = {};         // 'r123' | 'n456' | 't4135_207' -> { id, name, kind, pos, pieces:[], total, bbox }
  const REL_CDN = 'https://luzferlux77.github.io/pintamapa-app/calles/barrios/';

  function noteBarrio(el) {
    const t = el.tags || {};
    if (el.type === 'node' && NODE_LVL[t.place] && t.name) {
      // el mismo barrio llegado de otra fuente (con otro id): se queda el primero
      if (!barrioNodes[el.id] && Object.values(barrioNodes).some((b) => b.name === t.name && PM.geo.dist(b.pos, [el.lat, el.lon]) < 600)) return true;
      if (!barrioNodes[el.id]) { barrioNodes[el.id] = { id: el.id, name: t.name, pos: [el.lat, el.lon], lvl: NODE_LVL[t.place] }; scheduleReassign(); }
      return true;
    }
    if (el.type === 'relation' && t.boundary === 'administrative' && /^(9|10)$/.test(t.admin_level || '') && t.name && el.bounds) {
      if (!barrioRels[el.id]) {
        const b = el.bounds;
        barrioRels[el.id] = { id: el.id, name: t.name, lvl: +t.admin_level, bounds: [b.minlat, b.minlon, b.maxlat, b.maxlon], segs: null };
        loadRel(barrioRels[el.id]);
      }
      return true;
    }
    return false;
  }

  // Contorno del barrio: caché del móvil → GitHub → OpenStreetMap
  async function loadRel(r) {
    if (r.segs || r.loading || demoMode) return;
    r.loading = true;
    try {
      const key = 'rel' + r.id;
      let segs = null;
      const c = await cache.get(key);
      if (c && c.segs) segs = c.segs;
      if (!segs) {
        try {
          const res = await fetch(REL_CDN + 'r' + r.id + '.json');
          if (res.ok) segs = (await res.json()).segs;
        } catch (e) { /* sin GitHub: se pide a OpenStreetMap */ }
      }
      if (!segs) {
        const data = await overpass(`[out:json][timeout:60];rel(${r.id});out geom;`, 60000);
        const rel = data.elements.find((e) => e.type === 'relation');
        segs = relSegs(rel);
      }
      if (segs && segs.length) {
        r.segs = segs;
        cache.put(key, { t: Date.now(), segs });
        scheduleReassign();
      }
    } catch (e) {
      r.failed = (r.failed || 0) + 1;
      if (r.failed < 4) setTimeout(() => loadRel(r), 30000 * r.failed);   // servidor saturado: se reintenta
    } finally { r.loading = false; }
  }
  function relSegs(rel) {
    if (!rel || !rel.members) return null;
    return rel.members.filter((m) => m.type === 'way' && m.geometry && /^(outer|inner|)$/.test(m.role || ''))
      .map((m) => m.geometry.map((g) => [+g.lat.toFixed(6), +g.lon.toFixed(6)]));
  }
  const inBox = (p, b) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
  // punto dentro del contorno (par-impar sobre todos los tramos: sirve aunque no estén ordenados)
  function pip(p, segs) {
    let inside = false;
    const y = p[0], x = p[1];
    for (const s of segs) for (let i = 0; i < s.length - 1; i++) {
      const a = s[i], b = s[i + 1];
      if ((a[0] > y) !== (b[0] > y) && x < ((b[1] - a[1]) * (y - a[0])) / (b[0] - a[0]) + a[1]) inside = !inside;
    }
    return inside;
  }

  function barrioOf(p) {
    let poly10 = null, poly9 = null;
    for (const r of Object.values(barrioRels)) {
      if (!r.segs || !inBox(p, r.bounds) || !pip(p, r.segs)) continue;
      if (r.lvl === 10) poly10 = r; else if (r.lvl === 9) poly9 = r;
    }
    if (poly10) return { id: 'r' + poly10.id, name: poly10.name, kind: 'poly', rel: poly10 };
    // punto de barrio más cercano (del nivel más fino que haya cerca), dentro del distrito si se conoce
    let best = null, bd = 1500, lvl = 0;
    const near = [];
    for (const n of Object.values(barrioNodes)) {
      const d = PM.geo.dist(p, n.pos);
      if (d > 1500) continue;
      if (poly9 && !pip(n.pos, poly9.segs)) continue;
      near.push([n, d]); if (n.lvl > lvl) lvl = n.lvl;
    }
    for (const [n, d] of near) if (n.lvl === lvl && d < bd) { bd = d; best = n; }
    if (best) return { id: 'n' + best.id, name: best.name, kind: 'node', node: best };
    if (poly9) return { id: 'r' + poly9.id, name: poly9.name, kind: 'poly', rel: poly9 };
    const k = tileKeyOf(p[0], p[1]);
    return { id: 't' + k, name: (tiles[k] && tiles[k].name) || 'Zona ' + k.replace('_', '·'), kind: 'tile', tile: k };
  }

  // Reparte todas las calles cargadas entre sus barrios (tras cada carga o cuando llega un contorno)
  let reassignTimer = null;
  function scheduleReassign() { clearTimeout(reassignTimer); reassignTimer = setTimeout(reassignAll, 250); }
  function reassignAll() {
    for (const k in barrios) delete barrios[k];
    const memo = new Map();
    for (const id in pieces) {
      const pc = pieces[id];
      const ck = cellKey(pc.mid[0], pc.mid[1]);
      let b = memo.get(ck);
      if (!b) { b = barrioOf(pc.mid); memo.set(ck, b); }
      pc.barrio = b.id;
      let B = barrios[b.id];
      if (!B) {
        B = barrios[b.id] = { id: b.id, name: b.name, kind: b.kind, pieces: [], total: 0,
          pos: b.node ? b.node.pos : b.rel ? [(b.rel.bounds[0] + b.rel.bounds[2]) / 2, (b.rel.bounds[1] + b.rel.bounds[3]) / 2] : null,
          bbox: b.rel ? b.rel.bounds.slice() : null, segs: b.rel ? b.rel.segs : null, tile: b.tile };
      }
      if (avoidBarrios.has(b.id)) pc.avoid = true; else if (!inAvoidCircle(pc.mid)) pc.avoid = false;
      B.pieces.push(pc);
      if (pc.trail) continue;
      if (pc.avoid) B.avoidLen = (B.avoidLen || 0) + pc.len; else B.total += pc.len;
    }
    for (const B of Object.values(barrios)) {
      if (!B.bbox) {   // sin contorno: caja de sus calles + 300 m de margen
        let s = 90, w = 180, n = -90, e = -180;
        for (const pc of B.pieces) { s = Math.min(s, pc.mid[0]); n = Math.max(n, pc.mid[0]); w = Math.min(w, pc.mid[1]); e = Math.max(e, pc.mid[1]); }
        const m = 300 / PM.geo.mPerDegLat, mw = 300 / PM.geo.mPerDegLon(s);
        B.bbox = [s - m, w - mw, n + m, e + mw];
      }
      if (!B.pos) B.pos = B.pieces.length ? B.pieces[Math.floor(B.pieces.length / 2)].mid : [(B.bbox[0] + B.bbox[2]) / 2, (B.bbox[1] + B.bbox[3]) / 2];
      if (PM.state) PM.state.data.barrioNames[B.id] = B.name;
    }
    emit('barrios', {});
  }
  // ¿Están cargadas todas las calles del barrio? (para dar por bueno su %)
  function barrioComplete(id) {
    const B = barrios[id];
    if (!B) return false;
    const [i0, j0] = tileIJ(tileKeyOf(B.bbox[0], B.bbox[1])), [i1, j1] = tileIJ(tileKeyOf(B.bbox[2], B.bbox[3]));
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 30) return false;     // barrio enorme (distrito): demasiado para cargarlo entero
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const t = tiles[i + '_' + j]; if (!t || !t.loaded) return false; }
    return true;
  }

  // ---------------- Carga progresiva ----------------
  // 1) Entorno inmediato (~600 m alrededor del GPS): consulta pequeña → se pinta en segundos.
  // 2) Tu barrio completo (para el % de conquista). 3) Los 8 barrios de alrededor, en segundo plano.
  // Funciona igual en cualquier ciudad del mundo: abres la app allí y se carga lo que tienes alrededor.
  // Todo lo descargado queda en la caché del móvil (90 días).
  // Dos consultas: CALLES (ligera: se pinta en cuanto llega) y EXTRAS (lugares, parques, barrios; llega después)
  const STREETS = (bb) => `[out:json][timeout:40];
      (
        way["highway"~"^(${HIGHWAYS})$"](${bb});
        way["highway"~"^(${TRAILS})$"]["footway"!~"^(sidewalk|crossing|traffic_island|access_aisle)$"]["access"!~"^(private|no)$"](${bb});
      );
      out geom qt;`;
  const QUERY = (bb) => `[out:json][timeout:60];
      nwr["leisure"~"^(park|garden)$"]["name"](${bb});
      out tags bb;
      (
        nwr["amenity"~"^(townhall|place_of_worship|fountain|theatre|library|marketplace|university|hospital|fire_station)$"]["name"](${bb});
        nwr["historic"]["name"](${bb});
        nwr["tourism"~"^(museum|attraction|viewpoint|artwork)$"]["name"](${bb});
        nwr["leisure"="stadium"]["name"](${bb});
        nwr["building"="stadium"]["name"](${bb});
        nwr["leisure"="pitch"]["sport"="soccer"]["name"](${bb});
        nwr["place"="square"]["name"](${bb});
        nwr["man_made"="lighthouse"]["name"](${bb});
        nwr["railway"="station"]["name"](${bb});
        nwr["man_made"~"^(tower|windmill|watermill|obelisk)$"]["name"]["wikidata"](${bb});
        nwr["building"~"^(palace|castle|cathedral|basilica|tower)$"]["name"](${bb});
        nwr["heritage"]["name"]["highway"!~"."](${bb});
      );
      out center tags;
      node["place"~"^(suburb|quarter|neighbourhood)$"]["name"](${bb});
      out;
      rel["boundary"="administrative"]["admin_level"~"^(9|10)$"](${bb});
      out tags bb;`;
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
      if (!(j.v >= 3)) { cdnMissing.add(k); return null; }   // formato muy antiguo (sin barrios): mejor de OpenStreetMap
      const entry = { v: CACHE_V, t: Date.now(), els: j.els, wdMiss: !!j.wdMiss || j.v < 4 };
      cache.put(k, entry);
      if (entry.wdMiss) setTimeout(() => completeTile(k, entry), 4000);
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
    if (!(c && c.v >= 4 && Date.now() - c.t < CACHE_DAYS * 86400000)) return null;
    if (c.v < 6) c.wdMiss = true;   // guardado antes de Wikidata: se completa en segundo plano
    if (c.wdMiss || c.extrasMiss) setTimeout(() => completeTile(k, c), 3000);
    return c.els;
  }
  // Completa un barrio guardado sin los lugares de Wikidata (y los añade al mapa en cuanto llegan)
  // (de uno en uno, en segundo plano, para no saturar a los servidores mientras se cargan calles)
  const completing = new Set();
  let extrasFailT = 0;
  let completeChain = Promise.resolve();
  function completeTile(k, c) {
    if (completing.has(k)) return;
    completing.add(k);
    completeChain = completeChain.then(async () => {
      try {
        const [[s, w], [n, e]] = tileBounds(k);
        const bb = [s, w, n, e].map((v) => v.toFixed(5)).join(',');
        let add = [], extrasMiss = !!c.extrasMiss, wdMiss = !!c.wdMiss;
        if (extrasMiss && Date.now() - extrasFailT > 600000) {   // Overpass caído hace poco: ni lo intenta (10 min)
          try { const d = await overpass(QUERY(bb), 45000); add = add.concat(d.elements.map(slim).filter((el) => tilesOf(el).has(k))); extrasMiss = false; }
          catch (err) { extrasFailT = Date.now(); console.warn('Extras del barrio pendientes (Overpass no responde)', k, err); }
        }
        if (wdMiss) {
          const got = await wikidataBox(bb);
          if (got !== null) { add = add.concat(got.filter((el) => tilesOf(el).has(k))); wdMiss = false; }
        }
        const cur = (await cache.get(k)) || c;
        cache.put(k, Object.assign({}, cur, { els: cur.els.concat(add), wdMiss, extrasMiss }));
        if (add.length && tiles[k] && (tiles[k].loaded || tiles[k].partial)) { ingest(add, new Set([k])); emit('loaded', { tiles: [k] }); }
      } finally { completing.delete(k); }
    });
  }

  // Lugares emblemáticos de Wikidata (palacios, torres, patrimonio…). Si falla, se sigue solo con OpenStreetMap.
  async function wikidataBox(bb) {
    if (!PM.wikidata) return [];
    const [s, w, n, e] = bb.split(',').map(Number);
    try {
      const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 40000);
      const r = await PM.wikidata.fetchBox(s, w, n, e, (u, o) => fetch(u, { ...o, signal: ctl.signal }));
      clearTimeout(to); return r;
    } catch (err) { console.warn('Wikidata no disponible', err); return null; }   // null = falló (se reintentará)
  }
  // Calles y lugares desde los mapas vectoriales (en paralelo y en menos de un segundo normalmente)
  let vtFailT = 0;
  const vtDown = () => !PM.vtiles || Date.now() - vtFailT < 5 * 60000;   // si fallaron hace poco, 5 min por Overpass
  async function vectorTiles(keys) {
    try {
      const [s, w, n, e] = bboxOf(keys).split(',').map(Number);
      const { els, src } = await PM.vtiles.fetchBox(s + 1e-6, w + 1e-6, n - 1e-6, e - 1e-6);
      const per = {}; keys.forEach((k) => (per[k] = []));
      for (const el of els) for (const k of tilesOf(el)) if (per[k]) per[k].push(el);
      for (const k of keys) {
        const entry = { v: CACHE_V, t: Date.now(), els: per[k], wdMiss: true, extrasMiss: true, src };
        cache.put(k, entry);
        setTimeout(() => completeTile(k, entry), 1500);   // patrimonio, contornos de barrio y Wikidata: después, sin prisa
      }
      return per;
    } catch (err) { console.warn('Mapas vectoriales no disponibles; uso Overpass', err); vtFailT = Date.now(); return null; }
  }

  // Descarga barrios de Overpass (una consulta) y los guarda en caché; devuelve {barrio: elementos}
  async function fetchTiles(keys) {
    // solo calles (rápido); lugares, barrios y Wikidata se completan justo después en segundo plano
    const bb = bboxOf(keys);
    const data = await overpass(STREETS(bb), 30000);
    const per = {}; keys.forEach((k) => (per[k] = []));
    for (const raw of data.elements) {
      const el = slim(raw);
      for (const k of tilesOf(el)) if (per[k]) per[k].push(el);
    }
    for (const k of keys) {
      const entry = { v: CACHE_V, t: Date.now(), els: per[k], wdMiss: true, extrasMiss: true };
      cache.put(k, entry);
      setTimeout(() => completeTile(k, entry), 0);
    }
    return per;
  }

  // Mete elementos en el mundo (calles troceadas en los barrios aceptados + monumentos)
  function ingest(elements, accept) {
    lmBatch = [];
    const newPieces = [];
    const seen = new Set();
    for (const el of elements) {
      if (seen.has(el.type + el.id)) continue;
      seen.add(el.type + el.id);
      if (el.type === 'way' && el.geometry && el.tags && el.tags.highway && (HW_RE.test(el.tags.highway) || isTrailTags(el.tags))) {
        const trail = !HW_RE.test(el.tags.highway);
        const geom = el.geometry.map((g) => [g.lat, g.lon]);
        legacyFrom(el, geom);
        newPieces.push(...addWay('w' + el.id, geom, accept, !trail && isWide(el.tags), trail));
      } else if (el.tags && !noteBarrio(el)) addLandmark(el);
    }
    commitLandmarks(lmBatch); lmBatch = null;
    migrate(newPieces);
    scheduleReassign();
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
      // los que no están en el móvil: mapas vectoriales (OpenFreeMap → OSM oficial → VersaTiles), luego GitHub y, al final, Overpass
      if (fetchKeys.length && !demoMode && !vtDown()) {
        const per = await vectorTiles(fetchKeys);
        if (per) { for (const k of fetchKeys) els.push(...per[k]); fetchKeys.length = 0; }
      }
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

  // Carga estas celdas y espera a que estén listas (aunque otra carga las tuviera ya en marcha)
  async function ensureKeys(keys) {
    for (let i = 0; i < keys.length; i += 8) {
      try { await loadTiles(keys.slice(i, i + 8)); } catch (e) { /* sin red: se intenta lo que se pueda */ }
    }
    const t0 = Date.now();
    while (keys.some((k) => !(tiles[k] && tiles[k].loaded)) && Date.now() - t0 < 30000) await new Promise((r) => setTimeout(r, 400));
  }

  // Fase 1: solo el entorno inmediato, para empezar a pintar ya (no se guarda en caché: es parcial)
  async function quickLoad(lat, lon) {
    const dLat = 150 / PM.geo.mPerDegLat, dLon = 150 / PM.geo.mPerDegLon(lat);
    const bb = [lat - dLat, lon - dLon, lat + dLat, lon + dLon].map((v) => v.toFixed(5)).join(',');
    emit('loading', { count: 0, quick: true });
    const data = await overpass(STREETS(bb), 15000);   // solo calles: llega en un par de segundos
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
        // los mapas vectoriales ya son rápidos; la carga "de urgencia" por Overpass solo si esas fuentes están caídas
        if (vtDown() && !ensureTile(cur).loaded && !ensureTile(cur).partial && !demoMode && !(await cachedTile(cur)) && !(await cdnTile(cur))) await quickLoad(lat, lon);
        await loadTiles([cur]);
        // el anillo de alrededor en tandas de 2 (consultas pequeñas = rápidas, y si una falla no se pierde todo)
        const step = vtDown() ? 2 : 8;   // con mapas vectoriales, todo el anillo de una vez (en paralelo)
        for (let i = 0; i < ring.length; i += step) await loadTiles(ring.slice(i, i + step));
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
    return;   // los botes de pintura ya no salen en el mapa
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
    // consulta pesada (todo el municipio): espera a que terminen de cargarse las calles para no frenarlas
    while (loading.size || around) await new Promise((r) => setTimeout(r, 3000));
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
    barrios, barrioAt: barrioOf, barrioComplete, route, setAvoid, isAvoided, addLegacyGeo, ensureKeys,
    cityAt(p) { const t = tiles[tileKeyOf(p[0], p[1])]; return (t && t.city) || (PM.state && (PM.state.data.tileNames[tileKeyOf(p[0], p[1])] || {}).city) || null; },
    // carga las celdas que faltan para tener entero el barrio (hasta 12)
    ensureBarrio(id) {
      const B = barrios[id];
      if (!B || barrioComplete(id)) return;
      const [i0, j0] = tileIJ(tileKeyOf(B.bbox[0], B.bbox[1])), [i1, j1] = tileIJ(tileKeyOf(B.bbox[2], B.bbox[3]));
      const need = [];
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if (!ensureTile(i + '_' + j).loaded) need.push(i + '_' + j);
      if (need.length && need.length <= 12) loadTiles(need).catch(() => {});
    },
    isDemo: () => demoMode,
    setDemo: (v) => { demoMode = v; },
  };
})();
