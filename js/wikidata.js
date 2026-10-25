// PintaMapa — lugares emblemáticos desde Wikidata (en cualquier ciudad del mundo).
// OpenStreetMap a veces no etiqueta bien un palacio o una torre que conoce todo el mundo; Wikidata sí los tiene
// (con su artículo de Wikipedia y si están protegidos como patrimonio). Se piden los de una caja y se devuelven
// como elementos tipo OSM, con etiquetas equivalentes para que el juego los clasifique igual.
// Lo usan la app (www/js/world.js) y el generador de calles (tools/generar-calles.mjs).
(function (root) {
  // clase de Wikidata (P31) -> etiquetas equivalentes de OSM
  const CLS = {
    Q33506: { tourism: 'museum' }, Q207694: { tourism: 'museum' }, Q17431399: { tourism: 'museum' },
    Q22698: { leisure: 'park' }, Q1107656: { leisure: 'park' }, Q167346: { leisure: 'park' },
    Q23413: { historic: 'castle' }, Q751876: { historic: 'castle' }, Q57821: { historic: 'fort' }, Q1785071: { historic: 'fort' }, Q16748868: { historic: 'city_gate' },
    Q16560: { building: 'palace' }, Q1802963: { building: 'palace' }, Q879050: { building: 'palace' },
    Q12518: { man_made: 'tower' }, Q1440300: { man_made: 'tower' }, Q200334: { man_made: 'tower' }, Q2551475: { man_made: 'tower' }, Q11303: { building: 'skyscraper' }, Q170980: { man_made: 'tower' },
    Q16970: { amenity: 'place_of_worship', religion: 'christian' }, Q108325: { amenity: 'place_of_worship', religion: 'christian' },
    Q44613: { amenity: 'place_of_worship', religion: 'christian' }, Q1128397: { amenity: 'place_of_worship', religion: 'christian' }, Q56750657: { amenity: 'place_of_worship', religion: 'christian' },
    Q5393308: { amenity: 'place_of_worship', religion: 'buddhist' }, Q199451: { amenity: 'place_of_worship', religion: 'buddhist' },   // templo budista, pagoda
    Q845945: { amenity: 'place_of_worship', religion: 'shinto' }, Q842402: { amenity: 'place_of_worship', religion: 'hindu' }, Q622425: { amenity: 'place_of_worship', religion: 'sikh' },
    Q32815: { amenity: 'place_of_worship', religion: 'muslim' }, Q34627: { amenity: 'place_of_worship', religion: 'jewish' }, Q44539: { amenity: 'place_of_worship', religion: 'other' },
    Q2977: { building: 'cathedral' }, Q163687: { building: 'basilica' },
    Q4989906: { historic: 'monument' }, Q5003624: { historic: 'monument' }, Q179700: { historic: 'monument' }, Q860861: { historic: 'monument' }, Q557141: { historic: 'monument' },
    Q12277: { historic: 'city_gate' }, Q82117: { historic: 'city_gate' }, Q53060: { historic: 'city_gate' }, Q19675: { historic: 'city_gate' },
    Q483453: { amenity: 'fountain' }, Q174782: { place: 'square' },
    Q24354: { amenity: 'theatre' }, Q41253: { amenity: 'theatre' }, Q153562: { amenity: 'theatre' }, Q1060829: { amenity: 'theatre' },
    Q483110: { leisure: 'stadium' }, Q1076486: { leisure: 'stadium' }, Q641226: { leisure: 'stadium' },
    Q39715: { man_made: 'lighthouse' }, Q839954: { historic: 'ruins' }, Q109607: { historic: 'ruins' }, Q474: { historic: 'monument' },
    Q2080521: { amenity: 'marketplace' }, Q1192284: { amenity: 'marketplace' }, Q7075: { amenity: 'library' }, Q28564: { amenity: 'library' }, Q3918: { amenity: 'university' },
    Q511355: { amenity: 'studio', studio: 'television' }, Q1474414: { amenity: 'studio', studio: 'television' },   // estudios de televisión y sedes de emisión
    Q543654: { amenity: 'townhall' }, Q25550691: { amenity: 'townhall' }, Q112793351: { amenity: 'townhall' },
    Q43501: { tourism: 'zoo' }, Q2281788: { tourism: 'aquarium' }, Q2416723: { tourism: 'theme_park' }, Q148319: { tourism: 'museum' }, Q194195: { tourism: 'attraction' }, Q6017969: { tourism: 'viewpoint' }, Q12280: { historic: 'monument' },
    Q38720: { man_made: 'windmill' }, Q39614: { historic: 'monument' },
    Q1154710: { leisure: 'stadium' }, Q120560: { building: 'basilica' }, Q22746: { leisure: 'park' }, Q143912: { historic: 'city_gate' }, Q2293362: { historic: 'monument' },
    // comercios históricos (tiendas, bares, cafés, restaurantes, pastelerías, farmacias, librerías, heladerías)
    Q213441: { shop: 'yes' }, Q19471285: { shop: 'pastry' }, Q274393: { shop: 'bakery' }, Q200764: { shop: 'books' }, Q1311064: { shop: 'ice_cream' },
    Q187456: { amenity: 'bar' }, Q30022: { amenity: 'cafe' }, Q11707: { amenity: 'restaurant' }, Q13107184: { amenity: 'pharmacy' },
    // estaciones de tren (solo entran las históricas: patrimonio protegido)
    Q55488: { railway: 'station', _tren: 1 }, Q1339195: { railway: 'station', _tren: 1 }, Q18543139: { railway: 'station', _tren: 1 },
    // edificios: solo entran si además son patrimonio protegido
    Q41176: { building: 'yes' }, Q3947: { building: 'yes' }, Q585956: { building: 'yes' }, Q3950: { building: 'yes' }, Q83405: { building: 'yes' }, Q1662011: { building: 'yes' }, Q627236: { building: 'yes' },
  };
  // descripciones de viviendas/conjuntos de catálogo: protegidos, pero no los conoce nadie
  // metro, tranvía y estaciones subterráneas: nunca (no son lugares que visitar)
  // y barrios (Gion, el Born…) y obras de arte guardadas en un museo (cuadros, retratos, biombos): no son lugares que visitar
  const NO_CLS = new Set(['Q928830', 'Q2175765', 'Q22808403', 'Q123705', 'Q1574228', 'Q10564515', 'Q2983893', 'Q188509', 'Q3305213', 'Q134307', 'Q1144689']);
  // nivel de protección (P1435): 3 Patrimonio de la Humanidad · 2 nacional (BIC, BCIN, monumento histórico clasificado,
  // Grado I, monumento nacional…) · 1 el resto · 0 catálogos que no protegen (arte público de Barcelona)
  const HER3 = new Set(['Q9259']);
  const HER2 = new Set(['Q23712', 'Q1019352', 'Q10387684', 'Q15700818', 'Q908411', 'Q1967454']);
  const HER0 = new Set(['Q15945449']);
  // uso que no es para visitar (un hotel, una escuela, un polideportivo…): el motor lo puntúa a la baja y nunca es imprescindible
  const USO = { Q27686: 'hotel', Q1021645: 'oficinas', Q3914: 'escuela', Q9842: 'escuela', Q1076486: 'deporte', Q11315: 'comercial', Q4287745: 'salud', Q1059324: 'salud', Q16917: 'salud' };
  const herLevel = (list) => list.reduce((m, h) => Math.max(m, HER3.has(h) ? 3 : HER2.has(h) ? 2 : HER0.has(h) ? 0 : 1), 0);
  const DULL = /^(habitatges?|edificis?|edifici d'habitatges|casa al |cases al |casa a la |conjunt|carrer|farmàcia|porteria|masoveria|viviendas?|edificio de viviendas|bloque)/i;

  function query(s, w, n, e) {
    return `SELECT ?item ?itemLabel ?coord (COUNT(DISTINCT ?art) AS ?wp) (GROUP_CONCAT(DISTINCT STRAFTER(STR(?h), "entity/"); separator=",") AS ?her) (MIN(YEAR(?inc)) AS ?y) (SAMPLE(?col) AS ?coll) (MAX(?vis) AS ?visit) (GROUP_CONCAT(DISTINCT STRAFTER(STR(?c), "entity/"); separator=",") AS ?cls) WHERE {
 SERVICE wikibase:box { ?item wdt:P625 ?coord. bd:serviceParam wikibase:cornerSouthWest "Point(${w} ${s})"^^geo:wktLiteral. bd:serviceParam wikibase:cornerNorthEast "Point(${e} ${n})"^^geo:wktLiteral. }
 ?art schema:about ?item; schema:isPartOf/wikibase:wikiGroup "wikipedia".
 FILTER NOT EXISTS { ?item wdt:P1082 [] } FILTER (!EXISTS { ?item wdt:P81 [] } || EXISTS { ?item wdt:P1435 [] })
 FILTER NOT EXISTS { ?item wdt:P576 [] } FILTER NOT EXISTS { ?item wdt:P5817 wd:Q56556915 }
 OPTIONAL { ?item wdt:P1435 ?h } OPTIONAL { ?item wdt:P31 ?c } OPTIONAL { ?item wdt:P571 ?inc } OPTIONAL { ?item wdt:P195 ?col } OPTIONAL { ?item wdt:P1174 ?vis }
 SERVICE wikibase:label { bd:serviceParam wikibase:language "es,ca,en,fr,de,it,pt,nl,mul". }
} GROUP BY ?item ?itemLabel ?coord`;   // (P576 / derribado: lo que ya cerró o no existe no sale; P81 / con línea: estaciones, solo las protegidas)
  }

  // Los lugares más conocidos de una zona grande (una ciudad entera): por número de artículos en wikis (sitelinks), de más a menos
  function topQuery(s, w, n, e, minSl) {
    return `SELECT ?item ?itemLabel ?coord (?sl AS ?wp) (GROUP_CONCAT(DISTINCT STRAFTER(STR(?h), "entity/"); separator=",") AS ?her) (MIN(YEAR(?inc)) AS ?y) (SAMPLE(?col) AS ?coll) (MAX(?vis) AS ?visit) (GROUP_CONCAT(DISTINCT STRAFTER(STR(?c), "entity/"); separator=",") AS ?cls) WHERE {
 { SELECT ?item ?coord ?sl WHERE {
   SERVICE wikibase:box { ?item wdt:P625 ?coord. bd:serviceParam wikibase:cornerSouthWest "Point(${w} ${s})"^^geo:wktLiteral. bd:serviceParam wikibase:cornerNorthEast "Point(${e} ${n})"^^geo:wktLiteral. }
   ?item wikibase:sitelinks ?sl. FILTER(?sl >= ${minSl})
   FILTER NOT EXISTS { ?item wdt:P1082 [] } FILTER (!EXISTS { ?item wdt:P81 [] } || EXISTS { ?item wdt:P1435 [] })
   FILTER NOT EXISTS { ?item wdt:P576 [] } FILTER NOT EXISTS { ?item wdt:P5817 wd:Q56556915 }
 } ORDER BY DESC(?sl) LIMIT 400 }
 OPTIONAL { ?item wdt:P1435 ?h } OPTIONAL { ?item wdt:P31 ?c } OPTIONAL { ?item wdt:P571 ?inc } OPTIONAL { ?item wdt:P195 ?col } OPTIONAL { ?item wdt:P1174 ?vis }
 SERVICE wikibase:label { bd:serviceParam wikibase:language "es,ca,en,fr,de,it,pt,nl,mul". }
} GROUP BY ?item ?itemLabel ?coord ?sl`;
  }

  // Convierte la respuesta en elementos tipo OSM: { type:'node', id:'Q123', lat, lon, tags }
  function parse(json) {
    const out = [];
    for (const b of (json && json.results && json.results.bindings) || []) {
      const q = b.item.value.split('/').pop(), name = b.itemLabel && b.itemLabel.value;
      if (!name || name === q) continue;
      const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord.value);
      if (!m) continue;
      const hers = (b.her && b.her.value || '').split(',').filter(Boolean), her = hers.length > 0, cls = (b.cls && b.cls.value || '').split(',').filter(Boolean);
      const wp = +b.wp.value;
      if (cls.some((c) => NO_CLS.has(c))) continue;   // metro, tranvía
      let tags = null;
      for (const c of cls) if (CLS[c] && (!tags || tags.building === 'yes')) tags = CLS[c];
      if (tags && tags._tren && !her) continue;       // estación de tren moderna: solo las históricas (protegidas)
      if (!tags && !her) continue;                    // ni lugar reconocible ni patrimonio: barrio, empresa, colegio, evento…
      if (!tags && b.coll) continue;                  // pieza de la colección de un museo (cuadros, esculturas de sala…)
      if (tags && tags.building === 'yes' && !her) continue;
      if (!her && wp < 2) continue;                   // sin protección y casi sin artículos: poco conocido (cines cerrados, etc.)
      if (DULL.test(name) && wp < 2) continue;
      const t = Object.assign({ historic: 'building' }, tags && tags.building !== 'yes' ? tags : {}, { name, wikidata: q, _wp: wp });
      delete t._tren;
      for (const c of cls) if (USO[c]) { t._uso = USO[c]; break; }
      if (b.visit && +b.visit.value) t._vis = Math.round(+b.visit.value);   // visitantes al año (museos, monumentos…)
      if (cls.includes('Q570116')) t._atr = 1;                            // catalogado como atracción turística
      if (tags && tags.building === 'yes') t.building = 'yes';
      if (her) { t.heritage = 'yes'; t._her = herLevel(hers); }
      if (b.y && +b.y.value) t.start_date = String(+b.y.value);   // año de fundación (comercios centenarios)
      out.push({ type: 'node', id: q, lat: +(+m[2]).toFixed(6), lon: +(+m[1]).toFixed(6), tags: t });
    }
    return out;
  }

  async function fetchBox(s, w, n, e, fetchFn) {
    const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query(s, w, n, e));
    const r = await (fetchFn || fetch)(url, { headers: { Accept: 'application/sparql-results+json' } });
    if (!r.ok) throw new Error('Wikidata HTTP ' + r.status);
    return parse(await r.json());
  }

  async function fetchTop(s, w, n, e, minSl, fetchFn) {
    const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(topQuery(s, w, n, e, minSl));
    const r = await (fetchFn || fetch)(url, { headers: { Accept: 'application/sparql-results+json' } });
    if (!r.ok) throw new Error('Wikidata HTTP ' + r.status);
    return parse(await r.json()).sort((a, b) => b.tags._wp - a.tags._wp);   // de más a menos conocido
  }

  const api = { fetchBox, fetchTop, parse, query, topQuery };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.PM = root.PM || {}; root.PM.wikidata = api; }
})(typeof window !== 'undefined' ? window : globalThis);
