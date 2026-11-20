// PintaMapa — fusión de dos partidas sin perder nada (móvil ↔ nube, o dos móviles del mismo pintor).
// Lo pintado/capturado se une; los contadores se quedan con el máximo; los paseos se juntan por id.
(function (root) {
  // Ciudades: la clave es el nombre visible y s.ciudadId la liga a su Q de Wikidata. Cambiar la clave de una ciudad en toda
  // la partida (zonas, cartas, cromos y lo que va por ciudad)
  const POR_CIUDAD = ['cities', 'citiesWon', 'cityRank', 'albumes', 'countries', 'cityCards', 'ciudadId'];
  function renombrarCiudad(s, de, a) {
    for (const k of ['tileNames', 'landmarks', 'barrioCards']) for (const r of Object.values(s[k] || {})) if (r && r.city === de) r.city = a;
    for (const k of POR_CIUDAD) { const o = s[k]; if (o && typeof o === 'object' && de in o) { if (!(a in o)) o[a] = o[de]; delete o[de]; } }
  }
  // La otra partida (b) con las claves de esta (a): la misma ciudad (mismo Q) con otra clave pasa a la de a; y una clave que en
  // cada partida es una ciudad distinta (San Fernando de Cádiz en un móvil, el de Bahamas en otro) se distingue con su región.
  // Antes se juntaban: lo de las dos ciudades acababa en una
  function igualarCiudades(a, b) {
    const ia = a.ciudadId || {}, ib = b.ciudadId || {}, porQ = {}, cambios = [], usadas = new Set(Object.keys(ia));
    for (const [k, v] of Object.entries(ia)) if (v && v.q) porQ[v.q] = k;
    for (const [k, v] of Object.entries(ib)) {
      if (!v) continue;
      if (v.q && porQ[v.q]) { if (porQ[v.q] !== k) cambios.push([k, porQ[v.q]]); continue; }
      const o = ia[k];
      if (o && (o.q && v.q ? o.q !== v.q : !!(o.r && v.r && o.r !== v.r))) {
        const base = v.n || k;
        let nk = `${base} (${v.r || v.q})`;
        for (let i = 2; usadas.has(nk) || (ib[nk] && nk !== k); i++) nk = `${base} (${i})`;
        usadas.add(nk); cambios.push([k, nk]);
      }
    }
    if (!cambios.length) return b;
    b = JSON.parse(JSON.stringify(b));   // (no se toca la partida que llegó)
    // (en dos pasos: una clave nueva puede ser la vieja de otra)
    cambios.forEach(([de], i) => renombrarCiudad(b, de, '\u0000' + i));
    cambios.forEach(([, nk], i) => renombrarCiudad(b, '\u0000' + i, nk));
    return b;
  }
  function merge(a, b) {
    if (!a && !b) return a;
    a = a || {}; b = b || {};   // también con una sola partida: así se aplican los filtros (p. ej. paseos < 2 min)
    b = igualarCiudades(a, b);
    const out = Object.assign({}, a, b);
    // (cada ciudad con su Q: si una partida lo sabe y la otra no, se queda el que lo sabe)
    out.ciudadId = Object.assign({}, a.ciudadId || {});
    for (const [k, v] of Object.entries(b.ciudadId || {})) { const o = out.ciudadId[k]; if (!o || (v && v.q && !o.q)) out.ciudadId[k] = v; }
    const union = (k) => { out[k] = Object.assign({}, a[k] || {}, b[k] || {}); };
    const unionMin = (k) => {
      out[k] = Object.assign({}, a[k] || {});
      for (const [id, v] of Object.entries(b[k] || {})) out[k][id] = out[k][id] ? Math.min(out[k][id], v) : v;
    };
    ['painted', 'tileNames', 'barrioNames', 'cardInfo', 'barrioCards', 'cityCards'].forEach(union);
    // fichas de carta: una vacía («no se encontró nada», p. ej. sin conexión) no pisa una buena; entre dos buenas, la de formato
    // más nuevo y luego la más reciente (informe de Gemini (2), 20-nov-2026)
    for (const [id, o] of Object.entries(a.cardInfo || {})) {
      const v = (b.cardInfo || {})[id];
      if (!o || !v || o === v) continue;
      const buena = (x) => x && typeof x === 'object' && !x.none;
      if (buena(o) && !buena(v)) out.cardInfo[id] = o;
      else if (buena(o) && buena(v)) out.cardInfo[id] = (o.v || 0) > (v.v || 0) || ((o.v || 0) === (v.v || 0) && (o.t || 0) > (v.t || 0)) ? o : v;
    }
    // fotos propias: por cada carta gana la foto MÁS RECIENTE (antes, siempre la del segundo: una copia vieja tapaba una nueva)
    out.cardPhotos = Object.assign({}, a.cardPhotos || {});
    // (una entrada vacía no borra una foto; y con la MISMA versión en las dos, se conserva la marca de «ya subida» de la que la
    // tenga: antes ganaba la segunda y, si era la local sin marca, la foto se volvía a subir o la nube perdía la marca —Gemini—)
    for (const [id, v] of Object.entries(b.cardPhotos || {})) {
      if (!v || typeof v !== 'object') continue;
      const o = out.cardPhotos[id];
      if (!o || typeof o !== 'object' || (v.t || 0) > (o.t || 0)) out.cardPhotos[id] = v;
      else if ((v.t || 0) === (o.t || 0)) { const up = Math.max(o.up || 0, v.up || 0); out.cardPhotos[id] = up ? Object.assign({}, v, { up }) : v; }
    }
    // país de cada ciudad: se juntan (antes se perdían los de una de las dos partidas)
    out.countries = Object.assign({}, a.countries || {});
    for (const [k, v] of Object.entries(b.countries || {})) { const o = out.countries[k]; if (!o || (v && v.cc && !o.cc)) out.countries[k] = v; }
    // longitud de calles de cada ciudad: gana la medida exacta (Overpass) a la aproximada (mapas vectoriales, src 'vt')
    out.cities = Object.assign({}, a.cities);
    for (const [k, v] of Object.entries(b.cities || {})) { const o = out.cities[k]; out.cities[k] = o && o.total && !o.src && v && v.src ? o : v; }
    out.setsDone = Object.assign({}, a.setsDone);
    for (const [k, v] of Object.entries(b.setsDone || {})) out.setsDone[k] = Math.max(out.setsDone[k] || 0, v);
    ['conquered', 'perfect', 'conqueredB', 'perfectB', 'citiesWon', 'achievements', 'albumes'].forEach(unionMin);
    out.xpBy = Object.assign({}, a.xpBy);
    for (const [k, v] of Object.entries(b.xpBy || {})) out.xpBy[k] = Math.max(out.xpBy[k] || 0, v);
    out.heat = Object.assign({}, a.heat);
    for (const [k, v] of Object.entries(b.heat || {})) out.heat[k] = Math.max(out.heat[k] || 0, v);
    out.paintedByTile = Object.assign({}, a.paintedByTile);
    for (const [k, v] of Object.entries(b.paintedByTile || {})) out.paintedByTile[k] = Math.max(out.paintedByTile[k] || 0, v);
    out.landmarks = Object.assign({}, a.landmarks);
    for (const [id, v] of Object.entries(b.landmarks || {})) {
      const o = out.landmarks[id];
      if (!v || typeof v !== 'object') continue;
      // (una carta brillante lo es para siempre: antes la otra partida, sin brillo, se lo quitaba; y sin fecha en una de las
      // dos, la fecha salía NaN —informe de Gemini (2), 20-nov-2026—)
      const tt = [o && o.t, v.t].filter((x) => Number.isFinite(x));
      out.landmarks[id] = o ? Object.assign({}, o, v, { t: tt.length ? Math.min(...tt) : o.t || v.t || 0, visits: Math.max(o.visits || 1, v.visits || 1),
        last: Math.max(o.last || 0, v.last || 0), pos: v.pos || o.pos }, o.shiny || v.shiny ? { shiny: 1 } : {}) : v;
    }
    // cartas quitadas o trasladadas a otro identificador (duplicados, lugares que ya no están): la copia de la otra partida
    // no las devuelve; si allí solo está la vieja, pasa al identificador nuevo
    // Informe de Codex (17-nov-2026): (1) con A→B y B→C, según el orden en que salieran, la carta acababa en B (que también
    // está retirado); ahora se sigue la cadena hasta el final, en cualquier orden, y si da la vuelta (A→B, B→A) no se mueve
    // nada (mejor una carta de más que perderla). (2) La ficha y la foto de la carta vieja volvían con la copia de la otra
    // partida: ahora pasan con ella al identificador nuevo (o se van, si la carta se quitó)
    out.lmGone = Object.assign({}, a.lmGone || {}, b.lmGone || {});
    const G = out.lmGone, tiene = (o, k) => Object.prototype.hasOwnProperty.call(o, k), finales = {};
    const destino = (id) => {   // identificador vigente, 1 si la carta se quitó, null si la cadena da la vuelta
      if (tiene(finales, id)) return finales[id];
      const visto = new Set([id]); let cur = id;
      while (tiene(G, cur) && G[cur] !== 1) { cur = G[cur]; if (visto.has(cur)) return (finales[id] = null); visto.add(cur); }
      return (finales[id] = tiene(G, cur) ? 1 : cur);
    };
    for (const old of Object.keys(G)) {
      const fin = destino(old);
      if (fin === null || fin === old) continue;
      const r = out.landmarks[old];
      if (r) {
        const k = fin !== 1 && out.landmarks[fin];
        if (fin !== 1) out.landmarks[fin] = k ? Object.assign({}, k, { t: Math.min(k.t || r.t, r.t || k.t), visits: Math.max(k.visits || 1, r.visits || 1), last: Math.max(k.last || 0, r.last || 0) }, k.shiny || r.shiny ? { shiny: 1 } : {}) : r;   // (y el brillo de cualquiera de las dos)
        delete out.landmarks[old];
      }
      for (const c of ['cardInfo', 'cardPhotos']) {
        if (!out[c] || !out[c][old]) continue;
        // (la foto, con up: 0: en la nube va con el identificador de la carta y hay que subirla con el nuevo, como en world.trasladar)
        if (fin !== 1 && !out[c][fin]) out[c][fin] = c === 'cardPhotos' ? Object.assign({}, out[c][old], { up: 0 }) : out[c][old];
        delete out[c][old];
      }
    }
    out.xp = Math.max(a.xp || 0, b.xp || 0);
    out.stats = Object.assign({}, a.stats);
    for (const [k, v] of Object.entries(b.stats || {})) out.stats[k] = typeof v === 'number' ? Math.max(out.stats[k] || 0, v) : v;
    // (el último día jugado es el más reciente de los dos, no el de la segunda partida: si no, ese día contaba dos veces)
    if (a.stats && b.stats && a.stats.lastDay && (!b.stats.lastDay || a.stats.lastDay > b.stats.lastDay)) out.stats.lastDay = a.stats.lastDay;
    // (la racha es la del último día jugado, no la mayor: con el máximo, una racha rota volvía sola al fusionar con la nube y ya nunca se perdía)
    if (a.stats && b.stats && (a.stats.lastDay || '') !== (b.stats.lastDay || '')) out.stats.streak = ((a.stats.lastDay || '') > (b.stats.lastDay || '') ? a : b).stats.streak || 0;
    const walks = {};
    // el mismo paseo en dos versiones: la más completa (más tiempo; a igualdad, la más reciente)
    // (con el mismo tiempo: el de recorrido detallado antes que el simplificado, y repasado si lo está en cualquiera —Gemini—)
    const detalle = (w) => (w.slim ? 0 : 1e9) + ((w.track && w.track.length) || 0);
    [...(a.walks || []), ...(b.walks || [])].forEach((w) => {
      if (!w || typeof w !== 'object' || w.id == null) return;
      const o = walks[w.id], ew = w.elapsed || 0, eo = o ? o.elapsed || 0 : -1;
      if (!o || ew > eo) walks[w.id] = w;
      else if (ew === eo) { const g = detalle(w) >= detalle(o) ? w : o; walks[w.id] = (o.rev || w.rev) && !g.rev ? Object.assign({}, g, { rev: 1 }) : g; }
    });
    out.walks = Object.values(walks).filter((w) => (w.elapsed || 0) >= 120000).sort((x, y) => x.start - y.start);   // < 2 min: no cuentan
    if (a.daily && (!b.daily || a.daily.date > b.daily.date)) out.daily = a.daily;   // (una partida sin misiones aún no borra las de la otra: se cobrarían dos veces)
    else if (a.daily && b.daily && a.daily.date === b.daily.date) {
      // el mismo día (las misiones del día son las mismas en todos los dispositivos): misión a misión, el mayor
      // progreso y hecha si lo está en cualquiera; el cofre, abierto si se abrió en alguno (sin premios dobles)
      const ma = a.daily.missions || [], mb = b.daily.missions || [];
      out.daily = Object.assign({}, b.daily, { chest: !!(a.daily.chest || b.daily.chest),
        missions: mb.map((m, i) => { const o = ma[i]; return o && o.type === m.type && o.goal === m.goal ? Object.assign({}, m, { progress: Math.max(o.progress || 0, m.progress || 0), done: !!(o.done || m.done) }) : m; }) });
    }
    // foto de perfil: la más reciente (también si la quitaste)
    const newer = (a.avatarT || 0) > (b.avatarT || 0) ? a : b;
    if (newer.avatarT) { out.avatarT = newer.avatarT; if (newer.avatar) out.avatar = newer.avatar; else delete out.avatar; }
    out.barrioRank = Object.assign({}, a.barrioRank);
    for (const [k, v] of Object.entries(b.barrioRank || {})) out.barrioRank[k] = Math.max(out.barrioRank[k] ?? -1, v);
    out.cityRank = Object.assign({}, a.cityRank);
    for (const [k, v] of Object.entries(b.cityRank || {})) out.cityRank[k] = Math.max(out.cityRank[k] ?? -1, v);
    delete out.pet; delete out.bones; delete out.mystery; delete out.cansTaken; if (out.stats) delete out.stats.cans;   // funciones retiradas: no se guardan ni vuelven de la nube
    out.barrioRankT = Object.assign({}, a.barrioRankT || {}); for (const [k, v] of Object.entries(b.barrioRankT || {})) out.barrioRankT[k] = Object.assign({}, out.barrioRankT[k] || {}, v);
    out.avoidRemoved = Object.assign({}, a.avoidRemoved || {}, b.avoidRemoved || {});
    const av = {};
    [...(a.avoid || []), ...(b.avoid || [])].forEach((z) => { if (z && z.id != null && !out.avoidRemoved[z.id]) av[z.id] = z; });
    out.avoid = Object.values(av);
    return out;
  }
  merge.renombrarCiudad = renombrarCiudad;
  if (typeof module !== 'undefined' && module.exports) module.exports = merge;
  else { root.PM = root.PM || {}; root.PM.merge = merge; }
})(typeof window !== 'undefined' ? window : globalThis);
