// PintaMapa — fusión de dos partidas sin perder nada (móvil ↔ nube, o dos móviles del mismo pintor).
// Lo pintado/capturado se une; los contadores se quedan con el máximo; los paseos se juntan por id.
(function (root) {
  function merge(a, b) {
    if (!a) return b;
    if (!b) return a;
    const out = Object.assign({}, a, b);
    const union = (k) => { out[k] = Object.assign({}, a[k] || {}, b[k] || {}); };
    const unionMin = (k) => {
      out[k] = Object.assign({}, a[k] || {});
      for (const [id, v] of Object.entries(b[k] || {})) out[k][id] = out[k][id] ? Math.min(out[k][id], v) : v;
    };
    ['painted', 'cansTaken', 'tileNames', 'cities', 'barrioNames', 'cardInfo', 'cardPhotos', 'barrioCards', 'cityCards'].forEach(union);
    out.setsDone = Object.assign({}, a.setsDone);
    for (const [k, v] of Object.entries(b.setsDone || {})) out.setsDone[k] = Math.max(out.setsDone[k] || 0, v);
    ['conquered', 'perfect', 'conqueredB', 'perfectB', 'citiesWon', 'achievements'].forEach(unionMin);
    out.paintedByTile = Object.assign({}, a.paintedByTile);
    for (const [k, v] of Object.entries(b.paintedByTile || {})) out.paintedByTile[k] = Math.max(out.paintedByTile[k] || 0, v);
    out.landmarks = Object.assign({}, a.landmarks);
    for (const [id, v] of Object.entries(b.landmarks || {})) {
      const o = out.landmarks[id];
      out.landmarks[id] = o ? Object.assign({}, o, v, { t: Math.min(o.t, v.t), visits: Math.max(o.visits || 1, v.visits || 1),
        last: Math.max(o.last || 0, v.last || 0), pos: v.pos || o.pos }) : v;
    }
    out.xp = Math.max(a.xp || 0, b.xp || 0);
    out.stats = Object.assign({}, a.stats);
    for (const [k, v] of Object.entries(b.stats || {})) out.stats[k] = typeof v === 'number' ? Math.max(out.stats[k] || 0, v) : v;
    const walks = {};
    [...(a.walks || []), ...(b.walks || [])].forEach((w) => { walks[w.id] = w; });
    out.walks = Object.values(walks).sort((x, y) => x.start - y.start);
    if (a.daily && b.daily && a.daily.date > b.daily.date) out.daily = a.daily;
    out.avoidRemoved = Object.assign({}, a.avoidRemoved || {}, b.avoidRemoved || {});
    const av = {};
    [...(a.avoid || []), ...(b.avoid || [])].forEach((z) => { if (!out.avoidRemoved[z.id]) av[z.id] = z; });
    out.avoid = Object.values(av);
    return out;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = merge;
  else { root.PM = root.PM || {}; root.PM.merge = merge; }
})(typeof window !== 'undefined' ? window : globalThis);
