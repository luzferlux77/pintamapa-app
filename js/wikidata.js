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
    Q12518: { man_made: 'tower' }, Q1440300: { man_made: 'tower' }, Q200334: { man_made: 'tower' }, Q2551475: { man_made: 'tower' }, Q11303: { man_made: 'tower' }, Q170980: { man_made: 'tower' },
    Q16970: { amenity: 'place_of_worship', religion: 'christian' }, Q108325: { amenity: 'place_of_worship', religion: 'christian' },
    Q44613: { amenity: 'place_of_worship', religion: 'christian' }, Q1128397: { amenity: 'place_of_worship', religion: 'christian' }, Q56750657: { amenity: 'place_of_worship', religion: 'christian' },
    Q32815: { amenity: 'place_of_worship', religion: 'muslim' }, Q34627: { amenity: 'place_of_worship', religion: 'jewish' }, Q44539: { amenity: 'place_of_worship', religion: 'other' },
    Q2977: { building: 'cathedral' }, Q163687: { building: 'basilica' },
    Q4989906: { historic: 'monument' }, Q5003624: { historic: 'monument' }, Q179700: { historic: 'monument' }, Q860861: { historic: 'monument' }, Q557141: { historic: 'monument' },
    Q12277: { historic: 'city_gate' }, Q82117: { historic: 'city_gate' }, Q53060: { historic: 'city_gate' }, Q19675: { historic: 'city_gate' },
    Q483453: { amenity: 'fountain' }, Q174782: { place: 'square' },
    Q24354: { amenity: 'theatre' }, Q41253: { amenity: 'theatre' }, Q153562: { amenity: 'theatre' }, Q1060829: { amenity: 'theatre' },
    Q483110: { leisure: 'stadium' }, Q1076486: { leisure: 'stadium' }, Q641226: { leisure: 'stadium' },
    Q39715: { man_made: 'lighthouse' }, Q839954: { historic: 'ruins' }, Q109607: { historic: 'ruins' }, Q474: { historic: 'monument' },
    Q2080521: { amenity: 'marketplace' }, Q1192284: { amenity: 'marketplace' }, Q7075: { amenity: 'library' }, Q28564: { amenity: 'library' }, Q3918: { amenity: 'university' },
    Q543654: { amenity: 'townhall' }, Q25550691: { amenity: 'townhall' }, Q112793351: { amenity: 'townhall' },
    Q43501: { tourism: 'attraction' }, Q194195: { tourism: 'attraction' }, Q6017969: { tourism: 'viewpoint' }, Q12280: { historic: 'monument' },
    Q38720: { man_made: 'tower' }, Q39614: { historic: 'monument' },
    // edificios: solo entran si además son patrimonio protegido
    Q41176: { building: 'yes' }, Q3947: { building: 'yes' }, Q585956: { building: 'yes' }, Q3950: { building: 'yes' }, Q83405: { building: 'yes' }, Q1662011: { building: 'yes' }, Q627236: { building: 'yes' },
  };
  // descripciones de viviendas/conjuntos de catálogo: protegidos, pero no los conoce nadie
  const DULL = /^(habitatges?|edificis?|edifici d'habitatges|casa al |cases al |casa a la |conjunt|carrer|farmàcia|porteria|masoveria|viviendas?|edificio de viviendas|bloque)/i;

  function query(s, w, n, e) {
    return `SELECT ?item ?itemLabel ?coord (COUNT(DISTINCT ?art) AS ?wp) (SAMPLE(?h) AS ?her) (GROUP_CONCAT(DISTINCT STRAFTER(STR(?c), "entity/"); separator=",") AS ?cls) WHERE {
 SERVICE wikibase:box { ?item wdt:P625 ?coord. bd:serviceParam wikibase:cornerSouthWest "Point(${w} ${s})"^^geo:wktLiteral. bd:serviceParam wikibase:cornerNorthEast "Point(${e} ${n})"^^geo:wktLiteral. }
 ?art schema:about ?item; schema:isPartOf/wikibase:wikiGroup "wikipedia".
 FILTER NOT EXISTS { ?item wdt:P1082 [] } FILTER NOT EXISTS { ?item wdt:P81 [] }
 OPTIONAL { ?item wdt:P1435 ?h } OPTIONAL { ?item wdt:P31 ?c }
 SERVICE wikibase:label { bd:serviceParam wikibase:language "es,ca,en,fr,de,it,pt,nl,mul". }
} GROUP BY ?item ?itemLabel ?coord`;
  }

  // Convierte la respuesta en elementos tipo OSM: { type:'node', id:'Q123', lat, lon, tags }
  function parse(json) {
    const out = [];
    for (const b of (json && json.results && json.results.bindings) || []) {
      const q = b.item.value.split('/').pop(), name = b.itemLabel && b.itemLabel.value;
      if (!name || name === q) continue;
      const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord.value);
      if (!m) continue;
      const wp = +b.wp.value, her = !!b.her, cls = (b.cls && b.cls.value || '').split(',').filter(Boolean);
      let tags = null;
      for (const c of cls) if (CLS[c] && (!tags || tags.building === 'yes')) tags = CLS[c];
      if (!tags && !her) continue;                    // ni lugar reconocible ni patrimonio: barrio, empresa, colegio, evento…
      if (tags && tags.building === 'yes' && !her) continue;
      if (!her && wp < 2) continue;                   // sin protección y casi sin artículos: poco conocido (cines cerrados, etc.)
      if (DULL.test(name) && wp < 2) continue;
      const t = Object.assign({ historic: 'building' }, tags && tags.building !== 'yes' ? tags : {}, { name, wikidata: q, _wp: wp });
      if (tags && tags.building === 'yes') t.building = 'yes';
      if (her) t.heritage = 'yes';
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

  const api = { fetchBox, parse, query };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.PM = root.PM || {}; root.PM.wikidata = api; }
})(typeof window !== 'undefined' ? window : globalThis);
