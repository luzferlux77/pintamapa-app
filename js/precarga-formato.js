// PintaMapa — formato compacto de la precarga de ciudades (versión 2): el generador (scripts/pois/precarga.mjs) lo
// escribe y la app (world.js) lo lee. Cada lugar es una lista corta y las claves de sus datos van abreviadas; al leerlo
// se reconstruyen EXACTAMENTE los mismos elementos que da la consulta por zona (la puntuación no cambia).
//   lugar: [id, lat, lon, nombre, { clave abreviada: valor }]   imprescindible: [q, nombre, lat, lon, tipo, emoji, sl, interés, visitas]
(function (root) {
  const K = { historic: 'hi', amenity: 'am', tourism: 'to', building: 'bu', leisure: 'le', man_made: 'mm', railway: 'ra', place: 'pl', religion: 're', shop: 'sh',
    station: 'st', _wp: 'w', heritage: 'he', _her: 'h', start_date: 'y', _uso: 'u', _vis: 'v', _atr: 'a', _arq: 'q', _calle: 'c' };
  const R = Object.fromEntries(Object.entries(K).map(([a, b]) => [b, a]));
  const r6 = (x) => Math.round(x * 1e6) / 1e6;
  function encode(o) {
    return { v: 2, q: o.q, name: o.name, country: o.country, center: o.center, r: o.r, pop: o.pop, t: o.t,
      must: (o.must || []).map((m) => [m.q, m.name, r6(m.pos[0]), r6(m.pos[1]), m.kind, m.emoji, m.sl, m.interes, m.visitas || 0]),
      els: (o.els || []).map((e) => {
        const t = {};
        for (const [k, v] of Object.entries(e.tags || {})) if (k !== 'name' && k !== 'wikidata') t[K[k] || k] = k === 'heritage' && v === 'yes' ? 1 : v;
        return [e.id, r6(e.lat), r6(e.lon), e.tags.name, t];
      }) };
  }
  function decode(d) {
    if (!d || d.v !== 2) return d;   // (versión 1: ya viene expandida)
    return Object.assign({}, d, {
      must: d.must.map(([q, name, la, lo, kind, emoji, sl, interes, visitas]) => ({ q, name, pos: [la, lo], kind, emoji, sl, interes, visitas })),
      els: d.els.map(([id, lat, lon, name, t]) => {
        const tags = {};
        for (const [k, v] of Object.entries(t)) { const kk = R[k] || k; tags[kk] = kk === 'heritage' && v === 1 ? 'yes' : v; }
        // mismo orden de claves que la consulta por zona (por si algo dependiera del orden)
        return { type: 'node', id, lat, lon, tags: Object.assign({ historic: tags.historic }, tags, { name, wikidata: id }) };
      }),
    });
  }
  const api = { encode, decode };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.PM = root.PM || {}; root.PM.precargaFormato = api; }
})(typeof window !== 'undefined' ? window : globalThis);
