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
    Q845945: { amenity: 'place_of_worship', religion: 'shinto' }, Q842402: { amenity: 'place_of_worship', religion: 'hindu' }, Q1456832: { amenity: 'place_of_worship', religion: 'sikh' },   // (Q622425 es «club nocturno», no gurdwara: Studio 54 salía como templo)
    Q32815: { amenity: 'place_of_worship', religion: 'muslim' }, Q34627: { amenity: 'place_of_worship', religion: 'jewish' }, Q44539: { amenity: 'place_of_worship', religion: 'other' },
    Q2977: { building: 'cathedral' }, Q163687: { building: 'basilica' },
    Q56242215: { building: 'cathedral' }, Q56242250: { building: 'cathedral' }, Q56242225: { building: 'cathedral' },   // catedral católica, anglicana, ortodoxa
    Q1088552: { amenity: 'place_of_worship', religion: 'christian' }, Q2031836: { amenity: 'place_of_worship', religion: 'christian' }, Q1129743: { amenity: 'place_of_worship', religion: 'christian' },
    Q160742: { amenity: 'place_of_worship', religion: 'christian', building: 'monastery' }, Q24398318: { amenity: 'place_of_worship', religion: 'other' },
    Q181368: { place: 'square' }, Q167346: { leisure: 'garden' },
    Q1279431: { tourism: 'artwork' }, Q219423: { tourism: 'artwork' },   // fotomosaico (el mural del beso de Barcelona), mural
    Q4989906: { historic: 'monument' }, Q5003624: { historic: 'monument' }, Q179700: { historic: 'monument' }, Q860861: { historic: 'monument' }, Q557141: { historic: 'monument' },
    Q12277: { historic: 'city_gate' }, Q82117: { historic: 'city_gate' }, Q53060: { historic: 'city_gate' }, Q19675: { historic: 'city_gate' },
    Q483453: { amenity: 'fountain' }, Q174782: { place: 'square' },
    Q24354: { amenity: 'theatre' }, Q41253: { amenity: 'theatre' }, Q153562: { amenity: 'theatre' }, Q1060829: { amenity: 'theatre' },
    Q483110: { leisure: 'stadium' }, Q1076486: { leisure: 'stadium' }, Q641226: { leisure: 'stadium' },
    Q39715: { man_made: 'lighthouse' }, Q839954: { historic: 'ruins' }, Q109607: { historic: 'ruins' }, Q474: { historic: 'monument' }, Q12280: { man_made: 'bridge' },
    Q2080521: { amenity: 'marketplace' }, Q1192284: { amenity: 'marketplace' }, Q7075: { amenity: 'library' }, Q28564: { amenity: 'library' }, Q3918: { amenity: 'university' },
    Q511355: { amenity: 'studio', studio: 'television' }, Q1474414: { amenity: 'studio', studio: 'television' },   // estudios de televisión y sedes de emisión
    Q543654: { amenity: 'townhall' }, Q25550691: { amenity: 'townhall' }, Q112793351: { amenity: 'townhall' },
    Q43501: { tourism: 'zoo' }, Q2281788: { tourism: 'aquarium' }, Q2416723: { tourism: 'theme_park' }, Q148319: { tourism: 'museum' }, Q194195: { tourism: 'attraction' }, Q6017969: { tourism: 'viewpoint' }, Q12280: { historic: 'monument' },
    Q38720: { man_made: 'windmill' }, Q39614: { historic: 'monument' },
    Q1154710: { leisure: 'stadium' }, Q120560: { building: 'basilica' }, Q22746: { leisure: 'park' }, Q143912: { historic: 'city_gate' }, Q2293362: { historic: 'monument' },
    // museos que Wikidata da con una clase más concreta (historia natural, arte, arqueología, ciencia, casa museo…):
    // antes se perdían (el Art Institute de Chicago, el Royal Ontario Museum, la Casa de Ana Frank)
    Q1970365: { tourism: 'museum' }, Q16735822: { tourism: 'museum' }, Q3329412: { tourism: 'museum' }, Q2772772: { tourism: 'museum' }, Q1007870: { tourism: 'museum' },
    Q28737012: { tourism: 'museum' }, Q3196771: { tourism: 'museum' }, Q10624527: { tourism: 'museum' }, Q1595639: { tourism: 'museum' }, Q24699794: { tourism: 'museum' },
    Q588140: { tourism: 'museum' }, Q2087181: { tourism: 'museum' }, Q756102: { tourism: 'museum' }, Q1475403: { tourism: 'museum' }, Q3499307: { tourism: 'museum' },
    Q2398990: { tourism: 'museum' }, Q866133: { tourism: 'museum' }, Q3844310: { tourism: 'museum' },
    // puentes (el de Brooklyn, el de Carlos, el de la Torre…), torres de reloj y campanarios civiles (el Big Ben),
    // torres fortificadas (Belém) y «punto de referencia» (el Atomium)
    Q12570: { man_made: 'bridge' }, Q158555: { man_made: 'bridge' }, Q537127: { man_made: 'bridge' }, Q158438: { man_made: 'bridge' }, Q1068842: { man_made: 'bridge' },
    Q3397526: { man_made: 'bridge' }, Q12042110: { man_made: 'bridge' }, Q1210334: { man_made: 'bridge' }, Q158218: { man_made: 'bridge' }, Q1825472: { man_made: 'bridge' },
    Q853854: { man_made: 'tower' }, Q81917: { man_made: 'tower' }, Q815448: { man_made: 'tower' }, Q2319498: { tourism: 'attraction' }, Q57660343: { amenity: 'theatre' },   // («punto de referencia», débil: no tapa «parque» ni «monasterio»)
    Q11784935: { amenity: 'place_of_worship', religion: 'christian', building: 'monastery' }, Q53536964: { building: 'palace' },   // monasterio ortodoxo, residencia real (Palacio Imperial de Tokio)
    Q1150958: { historic: 'fort' },   // kremlin
    Q1248784: { aeroway: 'aerodrome' }, Q644371: { aeroway: 'aerodrome' }, Q94993988: { aeroway: 'aerodrome' },   // aeropuertos (internacionales, comerciales)
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
  // y conjuntos y cascos antiguos (la ficha UNESCO «Catedral, Alcázar y Archivo de Indias», «Centro histórico de…»)
  const NO_CLS = new Set(['Q928830', 'Q2175765', 'Q22808403', 'Q123705', 'Q1574228', 'Q10564515', 'Q2983893', 'Q188509', 'Q3305213', 'Q134307', 'Q1144689', 'Q676050', 'Q3317612']);
  // nivel de protección (P1435): 3 Patrimonio de la Humanidad · 2 nacional (BIC, BCIN, monumento histórico clasificado,
  // Grado I, monumento nacional…) · 1 el resto · 0 catálogos que no protegen (arte público de Barcelona)
  const HER3 = new Set(['Q9259']);
  const HER2 = new Set(['Q23712', 'Q1019352', 'Q10387684', 'Q15700818', 'Q908411', 'Q1967454']);
  const HER0 = new Set(['Q15945449']);
  // uso que no es para visitar (un hotel, una escuela, un polideportivo…): el motor lo puntúa a la baja y nunca es imprescindible
  const USO = { Q27686: 'hotel', Q1021645: 'oficinas', Q3914: 'escuela', Q9842: 'escuela', Q1076486: 'deporte', Q11315: 'comercial', Q4287745: 'salud', Q1059324: 'salud', Q16917: 'salud' };
  // preferencia entre clases (menor = más específica): catedral > basílica > castillo > palacio > ruinas > museo > …
  // (lo que el edificio ES va antes que el museo que tenga dentro: un monasterio, una torre o un jardín botánico)
  const PREF = ['cathedral', 'basilica', 'castle', 'fort', 'palace', 'ruins', 'monastery', 'place_of_worship', 'city_gate', 'tower', 'bridge', 'skyscraper',
    'lighthouse', 'windmill', 'garden', 'museum', 'zoo', 'aquarium', 'theme_park', 'stadium', 'theatre', 'monument', 'station', 'townhall',
    'marketplace', 'library', 'university', 'studio', 'park', 'square', 'fountain', 'viewpoint', 'attraction', 'shop', 'cafe', 'bar', 'restaurant', 'pharmacy', 'yes'];
  const rango = (tg) => { const v = tg.building === 'yes' ? 'yes' : tg.building || (tg.amenity === 'place_of_worship' ? 'place_of_worship' : '') || tg.historic || tg.tourism || tg.man_made || tg.leisure || tg.railway || tg.place || tg.amenity || (tg.shop ? 'shop' : ''); const i = PREF.indexOf(v); return i < 0 ? PREF.length - 1 : i; };
  // estrechos, ríos, lagos, bahías, calles, avenidas, líneas de tren y aeropuertos: no son un sitio que visitar (aunque
  // estén protegidos: el Bósforo, el ferrocarril Transiraní, el aeropuerto de Congonhas). Solo si no tienen además una
  // clase reconocible (el Puente de Carlos también es «calle», y es un puente)
  const AREA = new Set(['Q37901', 'Q4022', 'Q23397', 'Q39594', 'Q79007', 'Q34442', 'Q7543083', 'Q54114', 'Q728937', 'Q22667', 'Q1311958']);
  const herLevel = (list) => list.reduce((m, h) => Math.max(m, HER3.has(h) ? 3 : HER2.has(h) ? 2 : HER0.has(h) ? 0 : 1), 0);
  const DULL = /^(habitatges?|edificis?|edifici d'habitatges|casa al |cases al |casa a la |conjunt|carrer|farmàcia|porteria|masoveria|viviendas?|edificio de viviendas|bloque)/i;

  function query(s, w, n, e) {
    return `SELECT ?item ?itemLabel ?coord (COUNT(DISTINCT ?art) AS ?wp) (GROUP_CONCAT(DISTINCT STRAFTER(STR(?h), "entity/"); separator=",") AS ?her) (MIN(YEAR(?inc)) AS ?y) (SAMPLE(?col) AS ?coll) (MAX(?vis) AS ?visit) (SAMPLE(?arq) AS ?arqs) (GROUP_CONCAT(DISTINCT STRAFTER(STR(?c), "entity/"); separator=",") AS ?cls) WHERE {
 SERVICE wikibase:box { ?item wdt:P625 ?coord. bd:serviceParam wikibase:cornerSouthWest "Point(${w} ${s})"^^geo:wktLiteral. bd:serviceParam wikibase:cornerNorthEast "Point(${e} ${n})"^^geo:wktLiteral. }
 ?art schema:about ?item; schema:isPartOf/wikibase:wikiGroup "wikipedia".
 FILTER NOT EXISTS { ?item wdt:P1082 [] } 
 FILTER NOT EXISTS { ?item wdt:P576 [] } FILTER NOT EXISTS { ?item wdt:P5817 wd:Q56556915 }
 OPTIONAL { ?item wdt:P1435 ?h } OPTIONAL { ?item wdt:P31 ?c } OPTIONAL { ?item wdt:P571|wdt:P1619 ?inc } OPTIONAL { ?item wdt:P195 ?col } OPTIONAL { ?item wdt:P1174 ?vis } OPTIONAL { ?item wdt:P84 ?arq }
 SERVICE wikibase:label { bd:serviceParam wikibase:language "es,ca,en,fr,de,it,pt,nl,mul". }
} GROUP BY ?item ?itemLabel ?coord`;   // (P576 / derribado: lo que ya cerró o no existe no sale; las estaciones las decide parse: el metro y los tranvías, nunca)
  }

  // (año: el más antiguo entre «fundación» P571 e «inauguración» P1619: las estaciones —la de Cornellà, de 1855— y
  // muchos puentes, teatros o mercados solo tienen la segunda)
  // Los lugares más conocidos de una zona grande (una ciudad entera): por número de artículos en wikis (sitelinks), de más a menos
  // (limit: cuántos como mucho; con 400 en Londres se quedaba fuera todo lo que tuviera menos de 19 Wikipedias)
  function topQuery(s, w, n, e, minSl, limit) {
    return `SELECT ?item ?itemLabel ?coord (?sl AS ?wp) (GROUP_CONCAT(DISTINCT STRAFTER(STR(?h), "entity/"); separator=",") AS ?her) (MIN(YEAR(?inc)) AS ?y) (SAMPLE(?col) AS ?coll) (MAX(?vis) AS ?visit) (SAMPLE(?arq) AS ?arqs) (GROUP_CONCAT(DISTINCT STRAFTER(STR(?c), "entity/"); separator=",") AS ?cls) WHERE {
 { SELECT ?item ?coord ?sl WHERE {
   SERVICE wikibase:box { ?item wdt:P625 ?coord. bd:serviceParam wikibase:cornerSouthWest "Point(${w} ${s})"^^geo:wktLiteral. bd:serviceParam wikibase:cornerNorthEast "Point(${e} ${n})"^^geo:wktLiteral. }
   ?item wikibase:sitelinks ?sl. FILTER(?sl >= ${minSl})
   FILTER NOT EXISTS { ?item wdt:P1082 [] } 
   FILTER NOT EXISTS { ?item wdt:P576 [] } FILTER NOT EXISTS { ?item wdt:P5817 wd:Q56556915 }
 } ORDER BY DESC(?sl) LIMIT ${limit || 400} }
 OPTIONAL { ?item wdt:P1435 ?h } OPTIONAL { ?item wdt:P31 ?c } OPTIONAL { ?item wdt:P571|wdt:P1619 ?inc } OPTIONAL { ?item wdt:P195 ?col } OPTIONAL { ?item wdt:P1174 ?vis } OPTIONAL { ?item wdt:P84 ?arq }
 SERVICE wikibase:label { bd:serviceParam wikibase:language "es,ca,en,fr,de,it,pt,nl,mul". }
} GROUP BY ?item ?itemLabel ?coord ?sl`;
  }

  // Convierte la respuesta en elementos tipo OSM: { type:'node', id:'Q123', lat, lon, tags }
  function parse(json) {
    const out = [];
    for (const b of (json && json.results && json.results.bindings) || []) {
      const q = b.item.value.split('/').pop(), name = b.itemLabel && (PM.limpio ? PM.limpio(b.itemLabel.value) : b.itemLabel.value);
      if (!name || name === q) continue;
      const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord.value);
      if (!m) continue;
      const hers = (b.her && b.her.value || '').split(',').filter(Boolean), her = hers.length > 0, cls = (b.cls && b.cls.value || '').split(',').filter(Boolean);
      const wp = +b.wp.value;
      // metro, tranvía, barrios, cuadros, cascos antiguos (una plaza que Wikidata da también como barrio —Times Square— sí)
      // (y una estación subterránea que también es de ferrocarril —Sants— la deciden las reglas de estación; el metro, nunca)
      const tren = cls.includes('Q55488') || cls.includes('Q1339195') || cls.includes('Q18543139');
      if (cls.some((c) => NO_CLS.has(c) && !(c === 'Q123705' && (cls.includes('Q174782') || cls.includes('Q181368'))) && !(c === 'Q22808403' && tren))) continue;
      if (cls.includes('Q1497375') && /,| y | e | and | et | i /.test(name)) continue;   // conjunto de varios monumentos (cada uno sale por su cuenta)
      // varias clases: gana la más específica por un orden FIJO (antes, la primera que llegara: Wikidata no garantiza
      // el orden y el Foro Romano salía como «iglesia»; y dos móviles podían clasificar distinto el mismo sitio)
      let tags = null, best = 1e9;
      for (const c of cls) { const tg = CLS[c]; if (!tg) continue; const r = rango(tg); if (r < best || (r === best && tags && c < tags.__c)) { best = r; tags = Object.assign({ __c: c }, tg); } }
      if (tags) delete tags.__c;
      // estaciones de tren: las protegidas, las antiguas y conocidas (Atocha, 1851), las monumentales de autor
      // (Liège-Guillemins, de Calatrava) y las principales de cada gran ciudad; no los apeaderos ni las de barrio
      const anio = b.y && +b.y.value, arq = !!(b.arqs && b.arqs.value);
      // (y las principales de las grandes ciudades, muy conocidas: Sants, Chamartín, Shinjuku)
      if (tags && tags._tren && !her && !((anio && anio < 1930 && wp >= 10) || (arq && wp >= 10) || wp >= 15)) continue;
      if (!tags && !her) continue;                    // ni lugar reconocible ni patrimonio: barrio, empresa, colegio, evento…
      if (!tags && cls.some((c) => AREA.has(c))) continue;   // un estrecho, una calle, un aeropuerto… (aunque sean patrimonio)
      if (b.coll && (!tags || tags.historic === 'monument' || tags.tourism === 'artwork')) continue;   // pieza de la colección de un museo (la Venus de Milo, los Mármoles de Elgin)
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
      if (b.y && +b.y.value) t.start_date = String(+b.y.value);
      if (arq) t._arq = 1;                                        // obra de un arquitecto conocido (P84)   // año de fundación (comercios centenarios)
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
