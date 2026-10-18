// PintaMapa — estilo del mapa base: OpenFreeMap (datos de OpenStreetMap) con la paleta de PintaMapa encima.
// Claro: "Liberty" (con color) suavizado: suelo cálido, parques verdes, agua azul, edificios arena y en 3D al acercarse.
// Oscuro: "Dark" con agua, parques y edificios con un toque de color, y también 3D.
// Se ocultan los iconos de tiendas, paradas, etc.: en el mapa mandan tus lugares y lo que pintas.
PM.mapStyle = (function () {
  const URL = { light: 'https://tiles.openfreemap.org/styles/liberty', dark: 'https://tiles.openfreemap.org/styles/dark' };
  const PAL = {
    light: [
      [/^background$/, 'background-color', '#f4f0e8'],
      [/^park$|landcover_grass|landuse_pitch|landcover-grass/, 'fill-color', '#cfe7bf'],
      [/landcover_wood|landcover-wood/, 'fill-color', '#bcdca6'],
      [/^water$/, 'fill-color', '#a6d4ef'],
      [/^waterway/, 'line-color', '#a6d4ef'],
      [/landuse_residential|landuse-residential/, 'fill-color', '#eee8dd'],
      [/landuse_(school|hospital)|landuse-(school|hospital)/, 'fill-color', '#f1e5d3'],
      [/landcover_sand/, 'fill-color', '#f2e4c0'],
      [/^building$/, 'fill-color', '#e4dccf'],
    ],
    dark: [
      [/^background$/, 'background-color', '#121822'],
      [/^water$/, 'fill-color', '#1b3247'],
      [/^waterway/, 'line-color', '#1b3247'],
      [/^park$|landcover_wood|landcover_grass|grass/, 'fill-color', '#18291f'],
      [/^building$/, 'fill-color', '#1e2532'],
    ],
  };
  const HIDE = /^poi[_-]|one_way_arrow|^airport$/;
  const BLD = { light: '#e8e1d5', dark: '#283142' };

  function enhance(map, theme) {
    const style = map.getStyle(), layers = style.layers || [];
    for (const l of layers) {
      if (HIDE.test(l.id)) { try { map.setLayoutProperty(l.id, 'visibility', 'none'); } catch (e) {} continue; }
      for (const [re, prop, val] of PAL[theme] || []) {
        if (re.test(l.id) && prop.startsWith(l.type + '-')) { try { map.setPaintProperty(l.id, prop, val); } catch (e) {} }
      }
    }
    // Mapa siempre en 2D desde arriba: sin edificios 3D (son lo más pesado de dibujar y daban tirones al arrastrar).
    // Los edificios se ven planos a cualquier zoom.
    for (const l of layers) {
      if (l.type === 'fill-extrusion') { try { map.removeLayer(l.id); } catch (e) {} }
      else if (l.type === 'fill' && /^building/.test(l.id)) { try { map.setLayerZoomRange(l.id, l.minzoom || 13, 24); map.setPaintProperty(l.id, 'fill-color', BLD[theme]); } catch (e) {} }
    }
  }
  // ---------------- Mapa sin conexión ----------------
  // Todo lo del mapa base (estilo, teselas, letras, iconos) pasa por el protocolo «pmc://», que lo guarda en el móvil
  // (Cache Storage). Las teselas se sirven primero de lo guardado (son fijas); el estilo, primero de internet.
  // Así, lo que ya has visto (y la zona que descargues) se ve aunque no haya cobertura.
  const CACHE = 'pm-mapa-v1';
  const P = 'pmc://';
  const isTile = (u) => /\.(pbf|mvt|png|webp|jpg)(\?|$)/.test(u) || /\/\d+\/\d+\/\d+/.test(u);
  async function cachedFetch(url, tileFirst) {
    const c = window.caches ? await caches.open(CACHE) : null;
    if (c && tileFirst) { const m = await c.match(url); if (m) return m.arrayBuffer(); }
    try {
      const r = await fetch(url);
      if (r.ok) { if (c) c.put(url, r.clone()).catch(() => {}); return r.arrayBuffer(); }
      if (r.status === 404 || r.status === 204) return new ArrayBuffer(0);
    } catch (e) {}
    if (c) { const m = await c.match(url); if (m) return m.arrayBuffer(); }
    throw new Error('Sin conexión y sin copia de ' + url);
  }
  const pre = (u) => (typeof u === 'string' && /^https?:/.test(u) ? P + u : u);
  function rewrite(j) {
    if (j && j.sources) for (const k in j.sources) { const sr = j.sources[k]; if (sr.url) sr.url = pre(sr.url); if (sr.tiles) sr.tiles = sr.tiles.map(pre); }
    if (j && j.glyphs) j.glyphs = pre(j.glyphs);
    if (j && j.sprite) j.sprite = Array.isArray(j.sprite) ? j.sprite.map((x) => Object.assign({}, x, { url: pre(x.url) })) : pre(j.sprite);
    if (j && j.tiles) j.tiles = j.tiles.map(pre);
    return j;
  }
  let protoOn = false;
  function enableOffline() {
    if (protoOn || !window.maplibregl || !maplibregl.addProtocol) return false;
    maplibregl.addProtocol('pmc', async (params) => {
      const url = params.url.slice(P.length);
      const buf = await cachedFetch(url, isTile(url) || /fonts|sprite/.test(url));
      if (params.type === 'json') return { data: rewrite(JSON.parse(new TextDecoder().decode(buf))) };
      return { data: buf };
    });
    protoOn = true;
    return true;
  }
  const styleURL = (theme) => (enableOffline() ? P + URL[theme] : URL[theme]);

  // Descarga la zona alrededor de un punto (radio en km) para usarla sin conexión: teselas del mapa base (zoom 12-16),
  // letras y los iconos del estilo. progress(hechas, total).
  async function prefetch(center, km, theme, progress) {
    const getJSON = async (u) => JSON.parse(new TextDecoder().decode(await cachedFetch(u)));
    const style = await getJSON(URL[theme]);
    const urls = new Set();
    for (const sr of Object.values(style.sources || {})) {
      let tpl = sr.tiles && sr.tiles[0];
      if (!tpl && sr.url) { try { tpl = ((await getJSON(sr.url)).tiles || [])[0]; } catch (e) {} }
      if (!tpl || sr.type !== 'vector') continue;
      const maxz = Math.min(sr.maxzoom || 14, 16);
      const dLat = km / 111.32, dLon = km / (111.32 * Math.cos(center[0] * Math.PI / 180));
      for (let z = 10; z <= maxz; z++) {
        const t = (lat, lon) => { const n = 2 ** z; return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n)]; };
        const [x0, y0] = t(center[0] + dLat, center[1] - dLon), [x1, y1] = t(center[0] - dLat, center[1] + dLon);
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) urls.add(tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y));
      }
    }
    // letras (rangos latinos) de las fuentes que usa el estilo
    const fonts = new Set();
    (style.layers || []).forEach((l) => { const f = l.layout && l.layout['text-font']; if (Array.isArray(f) && typeof f[0] === 'string') fonts.add(f.join(',')); });
    if (style.glyphs) fonts.forEach((f) => ['0-255', '256-511', '8192-8447'].forEach((r) => urls.add(style.glyphs.replace('{fontstack}', encodeURIComponent(f)).replace('{range}', r))));
    if (typeof style.sprite === 'string') ['', '@2x'].forEach((x) => { urls.add(style.sprite + x + '.json'); urls.add(style.sprite + x + '.png'); });
    const list = [...urls]; let done = 0;
    const worker = async () => { while (list.length) { const u = list.pop(); try { await cachedFetch(u, true); } catch (e) {} done++; progress && progress(done, urls.size); } };
    await Promise.all(Array.from({ length: 6 }, worker));
    return urls.size;
  }
  async function cacheInfo() {
    if (!window.caches) return { n: 0, mb: 0 };
    const c = await caches.open(CACHE), keys = await c.keys();
    let est = null; try { est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null; } catch (e) {}
    return { n: keys.length, mb: est && est.usage ? est.usage / 1048576 : null };
  }
  return { URL, enhance, styleURL, enableOffline, prefetch, cacheInfo };
})();
