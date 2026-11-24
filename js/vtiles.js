// PintaMapa — calles y lugares desde mapas vectoriales ya preparados (rápidos y estables), con datos de OpenStreetMap.
// Fuentes en cadena: OpenFreeMap → mapas vectoriales oficiales de OpenStreetMap → VersaTiles. Si todas fallan,
// world.js usa Overpass como último recurso. Devuelve elementos con el mismo formato que Overpass (tipo OSM),
// así el resto del juego no cambia.
//   PM.vtiles.fetchBox(s, w, n, e) → { els, src }
PM.vtiles = (function () {
  const Z = 14;   // a este zoom van todas las calles con su forma exacta

  // ---------------- Lector de Mapbox Vector Tiles (protobuf), mínimo ----------------
  function reader(buf) {
    let pos = 0;
    const u8 = new Uint8Array(buf);
    const varint = () => {
      let v = 0, s = 1, b;
      do {
        if (pos >= u8.length) throw new Error('mvt truncado');
        b = u8[pos++]; v += (b & 0x7f) * s; s *= 128;
      } while (b & 0x80);
      return v;
    };
    const skip = (wt) => { if (wt === 0) varint(); else if (wt === 1) pos += 8; else if (wt === 2) pos += varint(); else if (wt === 5) pos += 4; else throw new Error('wire ' + wt); };
    const str = (len) => { const s = new TextDecoder().decode(u8.subarray(pos, pos + len)); pos += len; return s; };
    return { u8, get pos() { return pos; }, set pos(p) { pos = p; }, varint, skip, str, dv: new DataView(u8.buffer, u8.byteOffset, u8.byteLength) };
  }
  const zz = (n) => (n % 2 ? -(n + 1) / 2 : n / 2);
  function decode(buf) {
    const r = reader(buf), layers = {};
    while (r.pos < r.u8.length) {
      const tag = r.varint(), f = tag >> 3, wt = tag & 7;
      if (f !== 3 || wt !== 2) { r.skip(wt); continue; }
      const end = r.varint() + r.pos;
      const L = { name: '', keys: [], values: [], extent: 4096, feats: [] };
      while (r.pos < end) {
        const t = r.varint(), lf = t >> 3, lw = t & 7;
        if (lf === 1) L.name = r.str(r.varint());
        else if (lf === 3) L.keys.push(r.str(r.varint()));
        else if (lf === 5) L.extent = r.varint();
        else if (lf === 4) {
          const ve = r.varint() + r.pos; let v = null;
          while (r.pos < ve) {
            const vt = r.varint(), vf = vt >> 3;
            if (vf === 1) v = r.str(r.varint());
            else if (vf === 2) { v = r.dv.getFloat32(r.pos, true); r.pos += 4; }
            else if (vf === 3) { v = r.dv.getFloat64(r.pos, true); r.pos += 8; }
            else if (vf === 4 || vf === 5) v = r.varint();
            else if (vf === 6) v = zz(r.varint());
            else if (vf === 7) v = !!r.varint();
            else r.skip(vt & 7);
          }
          L.values.push(v);
        } else if (lf === 2) {
          const fe = r.varint() + r.pos;
          const F = { id: null, tags: [], type: 0, geom: [] };
          while (r.pos < fe) {
            const ft = r.varint(), ff = ft >> 3;
            if (ff === 1) F.id = r.varint();
            else if (ff === 3) F.type = r.varint();
            else if (ff === 2 || ff === 4) { const pe = r.varint() + r.pos; const arr = ff === 2 ? F.tags : F.geom; while (r.pos < pe) arr.push(r.varint()); }
            else r.skip(ft & 7);
          }
          L.feats.push(F);
        } else r.skip(lw);
      }
      layers[L.name] = L;
    }
    return layers;
  }
  // clave de un barrio sin identificador de OSM: su nombre en letras latinas, como siempre (así no cambia la de los barrios ya
  // conquistados); si el nombre no tiene casi letras latinas (japonés, árabe, chino…) salía vacía y TODOS esos barrios eran
  // el mismo «pl»: entonces, con sus propias letras (informe de Gemini, 20-nov-2026)
  function plClave(name) {
    const n = String(name).toLowerCase(), lat = n.replace(/[^a-z0-9]+/g, '');
    return lat.length >= 2 ? lat : n.replace(/[^\p{L}\p{N}]+/gu, '');
  }
  function props(L, F) { const o = {}; for (let i = 0; i < F.tags.length; i += 2) o[L.keys[F.tags[i]]] = L.values[F.tags[i + 1]]; return o; }
  // geometría → listas de puntos en coordenadas de la tesela (0..extent)
  function lines(F) {
    const out = []; let x = 0, y = 0, cur = null, i = 0;
    while (i < F.geom.length) {
      const c = F.geom[i++], cmd = c & 7, n = c >> 3;
      if (cmd === 7) { if (cur && cur.length) cur.push(cur[0]); continue; }
      for (let k = 0; k < n; k++) {
        if (i + 1 >= F.geom.length) return out;
        x += zz(F.geom[i++]); y += zz(F.geom[i++]);
        if (cmd === 1) { cur = [[x, y]]; out.push(cur); } else if (cur) cur.push([x, y]);   // (tesela mal formada: una línea sin su punto de inicio se salta)
      }
    }
    return out;
  }

  // ---------------- Tesela ↔ coordenadas ----------------
  const tx = (lon) => Math.floor((lon + 180) / 360 * 2 ** Z);
  const ty = (lat) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** Z); };
  const toLL = (x, y, X, Y, ext) => {
    const lon = (X + x / ext) / 2 ** Z * 360 - 180;
    const n = Math.PI * (1 - 2 * (Y + y / ext) / 2 ** Z);
    return { lat: +(Math.atan(Math.sinh(n)) * 180 / Math.PI).toFixed(7), lon: +lon.toFixed(7) };
  };

  // ---------------- Conversión a elementos tipo OSM ----------------
  // OpenFreeMap (esquema OpenMapTiles): clase de vía → valor "highway" de OSM
  function omtHighway(p) {
    const c = p.class, s = p.subclass, ramp = p.ramp == 1;
    if (/^(primary|secondary|tertiary)$/.test(c)) return c + (ramp ? '_link' : '');
    if (c === 'minor') return 'residential';
    if (c === 'track') return 'track';
    if (c === 'path') return s === 'pedestrian' ? 'pedestrian' : s === 'path' || s === 'bridleway' || s === 'footway' ? s : null;   // footway: el juego descarta las aceras
    return null;   // autopistas, servicio, aceras, carriles bici, escaleras, tren…: fuera
  }
  // OpenMapTiles: clase/subclase de punto de interés → etiquetas de OSM (las que entiende el juego)
  function omtPoiTags(p) {
    const c = p.class, s = p.subclass, t = {};
    if (c === 'town_hall' && s === 'townhall') t.amenity = 'townhall';
    else if (c === 'place_of_worship') { t.amenity = 'place_of_worship'; if (s && s !== 'place_of_worship') t.religion = s; }
    else if (c === 'museum') t.tourism = 'museum';
    else if (c === 'theatre') t.amenity = 'theatre';
    // estudios de televisión: en estos mapas salen como «oficina de telecomunicaciones» (TV3, RTVE…)
    else if (c === 'office' && s === 'telecommunication' && /(^|[^a-z])(tv|tv3|televisi|television|rtve|tve|telecinco|antena ?3|la ?sexta|bet[eé]v[eé])([^a-z]|$)/i.test(p.name || '')) { t.amenity = 'studio'; t.studio = 'television'; }
    else if (c === 'library' && s === 'library') t.amenity = 'library';   // (la misma clase incluye librerías: Fnac, Casa del Libro…)
    else if (c === 'stadium') t.leisure = 'stadium';
    else if (c === 'pitch' && s === 'soccer') { t.leisure = 'pitch'; t.sport = 'soccer'; }
    else if (c === 'hospital' && s === 'hospital') t.amenity = 'hospital';
    else if (c === 'fire_station') t.amenity = 'fire_station';
    else if (c === 'castle') t.historic = s === 'fort' ? 'fort' : s === 'ruins' ? 'ruins' : 'castle';   // (las ruinas no son castillos)
    else if (c === 'sally_port' || s === 'city_gate') t.historic = 'city_gate';   // puertas de muralla (Portal de Santa Madrona, Puerta del Cambrón…)
    else if (c === 'zoo' && s === 'zoo') t.tourism = 'zoo';
    else if (c === 'aquarium') t.tourism = 'aquarium';
    else if (c === 'theme_park' || s === 'theme_park') t.tourism = 'theme_park';
    else if (c === 'monument') t.historic = s === 'memorial' ? 'memorial' : 'monument';
    else if (c === 'attraction') { if (s === 'viewpoint') t.tourism = 'viewpoint'; else if (s === 'attraction') t.tourism = 'attraction'; else if (s === 'fountain') t.amenity = 'fountain'; else return null; }
    else if (c === 'grocery' && s === 'marketplace') t.amenity = 'marketplace';
    else if (c === 'college' && s === 'university') t.amenity = 'university';
    else if (c === 'railway' && s === 'station') t.railway = 'station';   // (metro, apeaderos y tranvía: no son lugares del juego)
    else if (c === 'park' && s === 'park') t.leisure = 'park';
    else if (c === 'lighthouse' || s === 'lighthouse') t.man_made = 'lighthouse';
    else if (s === 'ruins' || s === 'archaeological_site') t.historic = s;
    else if (s === 'artwork') t.tourism = 'artwork';
    else return null;
    return t;
  }
  // esquema Shortbread (OSM oficial y VersaTiles): "kind" ya es el valor de OSM
  function sbHighway(p) {
    const k = p.kind, ok = /^(primary|secondary|tertiary|residential|unclassified|living_street|pedestrian|road|track|path|bridleway|footway)$/.test(k);
    return ok ? (p.link && /^(primary|secondary|tertiary)$/.test(k) ? k + '_link' : k) : null;
  }
  const SB_KEYS = ['amenity', 'tourism', 'historic', 'leisure', 'man_made', 'sport', 'religion', 'railway', 'building'];

  function convert(layers, X, Y, schema, key) {
    const els = [];
    const ll = (pts, ext) => pts.map(([x, y]) => toLL(x, y, X, Y, ext));
    // calles
    const T = layers[schema === 'omt' ? 'transportation' : 'streets'];
    if (T) T.feats.forEach((F, i) => {
      if (F.type !== 2) return;   // solo líneas (las plazas peatonales como polígono no se pintan)
      const p = props(T, F);
      if (p.brunnel === 'tunnel' || p.tunnel === true) return;
      const hw = schema === 'omt' ? omtHighway(p) : sbHighway(p);
      if (!hw) return;
      const tags = { highway: hw };
      if (p.oneway == 1 || p.oneway === true) tags.oneway = 'yes';
      lines(F).forEach((g, j) => { if (g.length > 1) els.push({ type: 'way', id: `v${key}.${i}.${j}`, tags, geometry: ll(g, T.extent), src: 'vt' }); });
    });
    // lugares
    const P = layers[schema === 'omt' ? 'poi' : 'pois'];
    if (P) P.feats.forEach((F) => {
      const p = props(P, F);
      if (!p.name) return;
      let tags;
      if (schema === 'omt') tags = omtPoiTags(p);
      else { tags = {}; for (const k of SB_KEYS) if (p[k] != null) tags[k] = p[k]; if (!Object.keys(tags).length) tags = null; }
      if (!tags) return;
      tags.name = p.name;   // nombre local (como en Overpass)
      const g = lines(F)[0];
      if (!g || !g.length) return;
      const pt = toLL(g[0][0], g[0][1], X, Y, P.extent);
      // OpenFreeMap: id = id de OSM × 10 + tipo (1 nodo, 2 vía, 3 relación) → mismo id que con Overpass (tus conquistas se mantienen)
      let type = 'node', id = null;
      if (F.id != null && schema === 'omt') { const k = F.id % 10; if (k >= 1 && k <= 3) { type = ['', 'node', 'way', 'relation'][k]; id = Math.floor(F.id / 10); } }
      const el = { type, id: id != null ? id : 'p' + key + '.' + els.length, tags, src: 'vt' };
      if (type === 'node') { el.lat = pt.lat; el.lon = pt.lon; } else el.center = pt;
      els.push(el);
    });
    // nombres de barrio (puntos)
    const PL = layers[schema === 'omt' ? 'place' : 'place_labels'];
    const LATINO = /^[\p{Script=Latin}\p{M}\p{N}\p{P}\p{Zs}]+$/u;
    const limpiarBarrio = (s) => String(s || '')
      .replace(/\s*\([^)]*\)\s*$/g, '')
      .replace(/^distrito (de |del )/i, '')
      .replace(/^barri(?:o)?\s+(?:de\s+l[ao]s?\s+|de\s+)/i, '')
      .replace(/^barri(?:o)?\s+del\s+/i, 'el ')
      .trim();
    if (PL) PL.feats.forEach((F) => {
      const p = props(PL, F), kind = p.class || p.kind;
      if (!p.name || !/^(suburb|quarter|neighbourhood)$/.test(kind)) return;
      const g = lines(F)[0];
      // mismo id que en OpenStreetMap si se puede (OpenFreeMap: id × 10 + 1): así tus barrios conquistados se reconocen
      const osmId = schema === 'omt' && F.id != null && F.id % 10 === 1 ? Math.floor(F.id / 10) : 'pl' + plClave(p.name);
      const nom = limpiarBarrio(LATINO.test(p.name) ? p.name : (p['name:es'] || p['name:latin'] || p.name)) || p.name;
      if (g && g.length) { const pt = toLL(g[0][0], g[0][1], X, Y, PL.extent); els.push({ type: 'node', id: osmId, lat: pt.lat, lon: pt.lon, tags: { place: kind, name: nom }, src: 'vt' }); }
    });
    return els;
  }

  // ---------------- Fuentes ----------------
  const SOURCES = [
    { name: 'OpenFreeMap', schema: 'omt', tilejson: 'https://tiles.openfreemap.org/planet' },
    { name: 'OpenStreetMap', schema: 'sb', url: 'https://vector.openstreetmap.org/shortbread_v1/{z}/{x}/{y}.mvt' },
    { name: 'VersaTiles', schema: 'sb', url: 'https://tiles.versatiles.org/tiles/osm/{z}/{x}/{y}' },
  ];
  // OpenFreeMap cambia la ruta de sus teselas con cada actualización semanal: se lee de su "tilejson" (y se recuerda un día)
  async function fetchConPlazo(url, ms, leer) {
    if (typeof AbortController !== 'undefined') {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), ms);
      try {
        const r = await fetch(url, { signal: ctl.signal });
        return leer ? await leer(r) : r;
      } finally { clearTimeout(to); }
    }
    let to;
    try {
      const p = fetch(url).then((r) => (leer ? leer(r) : r));
      return await Promise.race([p, new Promise((_, rej) => { to = setTimeout(() => rej(new Error('tiempo agotado')), ms); })]);
    } finally { clearTimeout(to); }
  }
  async function urlOf(src) {
    if (src.url) return src.url;
    try {
      const c = JSON.parse(localStorage.getItem('pm_tj_' + src.name) || 'null');
      if (c && Date.now() - c.t < 86400000) return c.url;
    } catch (e) {}
    const j = await fetchConPlazo(src.tilejson, 6000, async (r) => {
      if (!r.ok) throw new Error(src.name + ' tilejson HTTP ' + r.status);
      return await r.json();
    });
    const url = j && j.tiles && j.tiles[0];
    if (!url) throw new Error(src.name + ' tilejson sin tiles');
    try { localStorage.setItem('pm_tj_' + src.name, JSON.stringify({ url, t: Date.now() })); } catch (e) {}
    return url;
  }
  async function fetchTile(src, X, Y) {
    const url = (await urlOf(src)).replace('{z}', Z).replace('{x}', X).replace('{y}', Y);
    const buf = await fetchConPlazo(url, 12000, async (r) => {
      if (!r.ok) throw new Error(src.name + ' HTTP ' + r.status);
      return await r.arrayBuffer();
    });
    return convert(decode(buf), X, Y, src.schema, Z + '/' + X + '/' + Y);
  }
  // Una tesela: se pide a la primera fuente; si en 2,5 s no ha llegado, también a la siguiente (gana la primera)
  function fetchAny(X, Y) {
    return new Promise((resolve, reject) => {
      let i = 0, done = false, fails = 0, timer;
      const next = () => {
        if (done || i >= SOURCES.length) return;
        const src = SOURCES[i++];
        fetchTile(src, X, Y).then((els) => { if (!done) { done = true; clearTimeout(timer); resolve({ els, src: src.name }); } },
          (e) => { if (++fails >= SOURCES.length && !done) { done = true; reject(e); } else if (!done) { clearTimeout(timer); next(); timer = setTimeout(next, 2500); } });
      };
      next(); timer = setTimeout(next, 2500);
    });
  }
  // Los LUGARES del juego salen solo de la primera fuente (OpenFreeMap): las otras usan otro esquema, con otra lista de
  // lugares y sin el id de OpenStreetMap (los numeran por orden), y según cuál contestara antes cada móvil veía lugares
  // distintos. Las calles sí pueden venir de cualquiera (solo sirven para pintar).
  const CANON = SOURCES[0].name;
  const esLugar = (el) => !!(el.tags && !el.tags.highway && !el.tags.place);
  const cajaDe = (s, w, n, e) => { const t = []; for (let X = tx(w); X <= tx(e); X++) for (let Y = ty(n); Y <= ty(s); Y++) t.push([X, Y]); return t; };
  async function fetchBox(s, w, n, e) {
    const tiles = cajaDe(s, w, n, e);
    // si un trozo falla, se reintenta solo ese (una vez, al segundo); los demás no se tiran
    const got = await Promise.all(tiles.map(([X, Y]) => fetchAny(X, Y).catch(() => new Promise((r) => setTimeout(r, 1200)).then(() => fetchAny(X, Y)))));
    // poisOk: todos los trozos son de la fuente de los lugares (si no, los lugares se piden luego solo a ella: fetchPois)
    // (de las otras fuentes, solo las calles: ni lugares ni nombres de barrio —los nombran a su manera y en la misma calle
    // salía otro barrio, 21-nov-2026—)
    return { els: got.flatMap((g) => (g.src === CANON ? g.els : g.els.filter((el) => el.tags && el.tags.highway))), src: [...new Set(got.map((g) => g.src))].join('+'), poisOk: got.every((g) => g.src === CANON) };
  }
  // solo los lugares y los nombres de barrio, y solo de la fuente de los lugares (si no contesta, error: se reintenta más tarde,
  // nunca con otra)
  async function fetchPois(s, w, n, e) {
    const src = SOURCES[0];
    const got = await Promise.all(cajaDe(s, w, n, e).map(([X, Y]) => fetchTile(src, X, Y).catch(() => new Promise((r) => setTimeout(r, 1200)).then(() => fetchTile(src, X, Y)))));
    return got.flat().filter((el) => esLugar(el) || (el.tags && el.tags.place));
  }

  // una tesela concreta (z14) y sus límites: para medir una ciudad entera sin contar dos veces el borde de cada tesela
  const lonOf = (x) => x / 2 ** Z * 360 - 180;
  const latOf = (y) => { const n = Math.PI - 2 * Math.PI * y / 2 ** Z; return 180 / Math.PI * Math.atan(Math.sinh(n)); };
  const tileBox = (X, Y) => [latOf(Y + 1), lonOf(X), latOf(Y), lonOf(X + 1)];   // [s, w, n, e]
  const fetchXY = (X, Y) => fetchAny(X, Y);
  return { fetchBox, fetchPois, decode, convert, SOURCES, CANON, tx, ty, tileBox, fetchXY };
})();
