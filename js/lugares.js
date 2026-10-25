// PintaMapa — MOTOR DE LUGARES (el corazón del juego): qué es cada sitio, cuánto vale y cuáles salen en el mapa.
// Funciones puras, sin estado ni red: reciben datos y devuelven resultados. Las usan world.js (que carga los datos y
// guarda los candidatos), las pruebas (tests/seleccion.mjs, tests/motor-lugares.mjs) y el inspector de lugares
// (tests/inspector-lugares.html). Las reglas, explicadas, en LUGARES.md.
//
//   PM.lugares.clasificar(tags)          → { kind, emoji, rarity, prio } o null (no es un lugar del juego)
//   PM.lugares.candidato(el)             → { lm } o { motivo } (por qué no entra)
//   PM.lugares.seleccionar(cands, ctx)   → { keep: Set de ids, why: Map id → motivo }
(function (root) {
  const PM = root.PM = root.PM || {};

  const RARITY = {
    comun:      { label: 'Común',      color: '#9aa4b2', mult: 1 },
    raro:       { label: 'Raro',       color: '#3fa9ff', mult: 2 },
    epico:      { label: 'Épico',      color: '#b65cff', mult: 3 },
    legendario: { label: 'Legendario', color: '#ffb700', mult: 5 },
  };
  const RANK = { comun: 0, raro: 1, epico: 2, legendario: 3 };

  // Radio de captura: estadios y estudios de TV, desde fuera (no se suele poder entrar)
  const capRadius = (kind, big) => (kind === 'Estadio' && big ? 240 : ({ Estadio: 200, 'Estudio de televisión': 200, 'Campo de fútbol': 70, Parque: 45, 'Zoo / Acuario': 80, 'Parque temático': 120 })[kind]) || 30;

  // Reglas de la selección (ver LUGARES.md)
  // Como una buena guía: lo que de verdad merece la visita, bien repartido por cada barrio, sin saturar.
  const CONF = {
    MIN_GAP: 60, TOWNHALL_GAP: 100, SHOP_GAP: 25, FAMOUS_GAP: 35,   // separaciones (m)
    ZONE_QUOTA: 12, KIND_QUOTA: 4, SERVICE_QUOTA: 1, SHOP_QUOTA: 2,  // cupo por zona de ~1 km², por tipo, por servicio y de comercios (sin icónicos)
    RELLENO: 60, RELLENO_HASTA: 6,                                   // lo flojo (< 60 puntos) solo si la zona tiene menos de 6 lugares
    SIN_SEPARACION: 75, IMPORTANTE: 110,                             // lo que importa sale aunque tenga otro al lado; lo muy importante, sin cupos
    ICON_MAX: 18, ICON_KIND_MAX: 6, ZONE_MAX: 26,                    // topes en ciudades monumentales
    WORLD_FAMOUS: 20,                                                // idiomas: entra siempre
    GRID: 0.0015,                                                    // celda del índice de separación (~160 m)
    MAIN_CHURCH_M: 800,
  };

  // ---------------- Qué es cada sitio ----------------
  function clasificar(tags) {
    // prio: importancia para la conquista (decide qué se queda cuando dos están muy cerca). El ayuntamiento, siempre el primero.
    const a = tags.amenity, h = tags.historic, t = tags.tourism, b = tags.building, l = tags.leisure, n = tags.name || '';
    if (a === 'townhall' && /区役所|区民|ward office|junta (municipal )?de distrito|junta municipal|seu del districte|districte|distrito|arrondissement|mairie (du|annexe)|bezirksamt|borough hall|municipio [ivx\d]+\b/i.test(n))
      return tags.heritage ? { kind: 'Patrimonio', emoji: '🏛️', rarity: 'raro', prio: 62 } : null;   // juntas de distrito: no son el ayuntamiento
    if (a === 'townhall' && !/税務|警察|裁判|tax office|police|polic[ií]a|comisar|juzgado|court|tribunal|hacienda|agencia tributaria/i.test(n)) return { kind: 'Ayuntamiento', emoji: '🏛️', rarity: 'legendario', prio: 100 };
    // una plaza es una plaza aunque Wikidata la tenga además como sede olímpica (la Concordia de París 2024)
    if (!a && /^(plaza|place|piazza|square|pra[çc]a|platz|pla[çc]a|largo|rynek|n[aá]m[eě]st[ií])(\s|$)/i.test(n) && !/toros|bullring|arena|stadium|estadio/i.test(n)) return { kind: 'Plaza', emoji: '🏙️', rarity: 'raro', prio: 55 };
    // por el nombre, solo templos y edificios (no la «Piazza del Duomo»); «Dom» solo como en alemán (Kölner Dom, Dom St. Peter):
    // antes «Sant Domènec» o «Justo Domínguez» salían como catedrales (la tilde cortaba la palabra)
    const worship = a === 'place_of_worship' || h === 'building' || b === 'church';
    if (b === 'cathedral' || (worship && (/catedral|cathedral|cathédrale|cattedrale|kathedrale|domkirke|(^|[^a-zà-ÿ])duomo([^a-zà-ÿ]|$)/i.test(n) || /(^|\s)dom$|^dom\s+(st\.?|sankt|unser|zu|mari)/i.test(n))))
      return { kind: 'Catedral', emoji: '⛪', rarity: 'legendario', prio: 95 };
    // palacios y casas señoriales que OpenStreetMap marca como «castillo» (los del Gòtic y el Born): palacio o patrimonio
    const palaceName = /(^|[^a-zà-ÿ])(palau|palauet|palacio|palacete|palace|palais|palazzo|palazzetto|pałac|palácio|schloss|paleis)([^a-zà-ÿ]|$)/i.test(n)
      && !tags.place && !/^(pla|plaça|plaza|piazza|place|platz|carrer|calle|via|rua|font|fuente|fanals|farolas|estaci|parada|jardins?|jardines|parc|parque)\b/i.test(n)   // «Pla de Palau» es una plaza
      && !/esport|deport|sport|congr[eé]s|cinema|cine\b|sant jordi|blaugrana|fira|firal|vela|gel\b|hielo|theat|teatr|th[eé][aâ]tre|hotel|casino|ballroom/i.test(n);   // ni pabellones, cines, teatros ni hoteles que se llaman «Palau»/«Palace»
    // un «castillo» del mapa base que no se llama castillo (aduana, asilo, casa señorial…): patrimonio; los de Wikidata, sí
    const castleName = /castell|castillo|castle|ch[aâ]teau|castello|burg|fortale|fortress|fort\b|alc[aá]zar|alcazaba|kasteel|zamek|hrad|citadel|ciutadella|ciudadela|torre/i.test(n);
    if (h === 'castle' && !palaceName && (/^(casa|cal|can|ca l'|cases|sal[oó]|edifici|mansi[oó]n?|villa)\b/i.test(n) || (!tags._wp && !castleName))) return { kind: 'Patrimonio', emoji: '🏛️', rarity: 'raro', prio: 62 };
    if ((h === 'castle' && !palaceName) || h === 'fort') return { kind: 'Castillo', emoji: '🏰', rarity: 'legendario', prio: 90 };
    if (b === 'palace' || palaceName) return { kind: 'Palacio', emoji: '🏰', rarity: 'epico', prio: 84 };
    if (l === 'stadium' || b === 'stadium') return { kind: 'Estadio', emoji: '🏟️', rarity: 'epico', prio: 85 };
    if (b === 'basilica' || /bas[ií]lica|co-?catedral|concatedral/i.test(n)) return { kind: 'Basílica', emoji: '⛪', rarity: 'epico', prio: 80 };
    // ermitas y monasterios (siempre visibles si son patrimonio o tienen Wikipedia)
    if (a === 'place_of_worship' && /christian/.test(tags.religion || 'christian') && (b === 'chapel' || /ermita|eremitori|santuari|monasteri|monestir|convent|abad[ií]a|cartuja|cartoixa|hermitage|monastery|abbey/i.test(n)))
      return { kind: 'Ermita / Monasterio', emoji: '⛪', rarity: 'epico', prio: 74 };
    if (a === 'place_of_worship') return { kind: /christian/.test(tags.religion || 'christian') ? 'Iglesia' : 'Templo', emoji: '⛪', rarity: 'epico', prio: 75 };
    if (t === 'museum') return { kind: 'Museo', emoji: '🖼️', rarity: 'epico', prio: 70 };
    if (t === 'zoo' || t === 'aquarium') return { kind: 'Zoo / Acuario', emoji: t === 'aquarium' ? '🐠' : '🦁', rarity: 'epico', prio: 68 };
    if (t === 'theme_park') return { kind: 'Parque temático', emoji: '🎢', rarity: 'epico', prio: 64 };
    if (h === 'monument') return { kind: 'Monumento', emoji: '🗽', rarity: 'epico', prio: 70 };
    if (b === 'skyscraper') return { kind: 'Rascacielos', emoji: '🏙️', rarity: 'raro', prio: 60 };   // (no se mezclan con torres y puertas históricas)
    if (h === 'city_gate' || h === 'tower' || tags.man_made === 'tower' || tags.man_made === 'obelisk' || b === 'tower') return { kind: 'Torre / Puerta', emoji: '🗼', rarity: 'epico', prio: 65 };
    if (a === 'hospital') return { kind: 'Hospital', emoji: '🏥', rarity: 'raro', prio: 57 };
    if (a === 'fire_station') return { kind: 'Bomberos', emoji: '🚒', rarity: 'raro', prio: 56 };
    // estudios de televisión (no los de vídeo, radio o audio); las grandes cadenas, épicas
    if (a === 'studio' && /(^|;)\s*(television|tv)\s*(;|$)/.test(tags.studio || ''))
      return { kind: 'Estudio de televisión', emoji: '📺', prio: 62,
        rarity: /(^|[^a-zà-ÿ])(tv3|televisi[oó] de catalunya|rtve|tve|antena ?3|telecinco|mediaset|atresmedia|la ?sexta|cuatro|telemadrid|canal sur|[àa] punt|etb|tvg|crtvg|ib3|aragón tv|bbc|rai|tf1|france t[eé]l[eé]visions|zdf|ard)([^a-zà-ÿ]|$)/i.test(n) ? 'epico' : 'raro' };
    if (a === 'theatre') return { kind: 'Teatro', emoji: '🎭', rarity: 'raro', prio: 60 };
    if (a === 'university') return { kind: 'Universidad', emoji: '🎓', rarity: 'raro', prio: 58 };
    if (tags.place === 'square') return { kind: 'Plaza', emoji: '🏙️', rarity: 'raro', prio: 55 };
    if (tags.man_made === 'lighthouse') return { kind: 'Faro', emoji: '🗼', rarity: 'raro', prio: 55 };
    // estaciones: solo las de tren históricas (protegidas como patrimonio); nunca metro, tranvía ni apeaderos
    if (tags.railway === 'station' && tags.heritage && tags.station !== 'subway' && !/\bmetro\b/i.test(n)) return { kind: 'Estación', emoji: '🚉', rarity: 'epico', prio: 66 };
    if (/^(station|halt|tram_stop|subway_entrance)$/.test(tags.railway || '') || tags.station === 'subway') return null;
    // comercios históricos o de gran interés que siguen abiertos: protegidos, famosos en el mundo (8+ idiomas) o conocidos
    // y fundados antes de 1950 (no los restaurantes de moda); los cerrados ya no llegan de Wikidata
    if ((tags.heritage || (tags._wp || 0) >= 8 || ((tags._wp || 0) >= 2 && +tags.start_date && +tags.start_date <= 1950)) && (tags.shop || /^(cafe|bar|restaurant|pharmacy|pub|ice_cream)$/.test(a || ''))) return { kind: 'Comercio emblemático', emoji: '☕', rarity: 'raro', prio: 52 };
    if (tags.shop || /^(cafe|bar|restaurant|pharmacy|pub|ice_cream)$/.test(a || '')) return null;   // el resto de tiendas y bares: no
    if (l === 'park' || l === 'garden') return { kind: 'Parque', emoji: '🌳', rarity: 'raro', prio: 48 };
    if (tags.man_made === 'windmill' || tags.man_made === 'watermill') return { kind: 'Molino', emoji: '🌬️', rarity: 'raro', prio: 52 };
    if (a === 'fountain') return { kind: 'Fuente', emoji: '⛲', rarity: 'comun', prio: 30 };
    if (tags.heritage) return { kind: 'Patrimonio', emoji: /f[aàá]bri|factory|usine|fabbrica/i.test(n) ? '🏭' : '🏛️', rarity: 'raro', prio: 62 };
    if (h === 'ruins' || h === 'archaeological_site') return { kind: 'Ruinas', emoji: '🏺', rarity: 'raro', prio: 45 };
    if (t === 'viewpoint') return { kind: 'Mirador', emoji: '🔭', rarity: 'raro', prio: 45 };
    if (l === 'pitch' && tags.sport === 'soccer') return { kind: 'Campo de fútbol', emoji: '⚽', rarity: 'raro', prio: 44 };
    if (a === 'marketplace') return { kind: 'Mercado', emoji: '🛒', rarity: 'comun', prio: 40 };
    if (a === 'library') return { kind: 'Biblioteca', emoji: '📚', rarity: 'comun', prio: 38 };
    if (t === 'attraction') return { kind: 'Atracción', emoji: '⭐', rarity: 'raro', prio: 35 };
    if (h === 'memorial') return { kind: 'Memorial', emoji: '🗿', rarity: 'comun', prio: 30 };
    if (t === 'artwork') return { kind: 'Arte urbano', emoji: '🎨', rarity: 'comun', prio: 15 };
    if (h) return { kind: 'Lugar histórico', emoji: '📜', rarity: 'comun', prio: 10 };
    return null;
  }

  // ---------------- Valor de guía de cada tipo de lugar ----------------
  // Lo que recomiendan las guías, arriba (monumentos, miradores, ruinas, museos, mercados históricos); los servicios
  // (hospitales, bomberos, bibliotecas, campos de fútbol, facultades…) siguen siendo cartas, pero solo rellenan las
  // zonas que no tienen nada mejor.
  const TIPO_GUIA = { Ayuntamiento: 100, Catedral: 95, Castillo: 90, Basílica: 85, Palacio: 84, Museo: 78, Monumento: 75, 'Ermita / Monasterio': 74,
    Ruinas: 72, 'Torre / Puerta': 70, Estadio: 70, Iglesia: 66, Templo: 66, Estación: 66, 'Zoo / Acuario': 64, Mirador: 62, 'Iglesia principal': 75,
    Faro: 60, Rascacielos: 60, Plaza: 60, Patrimonio: 58, Teatro: 58, 'Parque temático': 58, Parque: 55, Mercado: 55, Molino: 55,
    'Comercio emblemático': 52, Atracción: 45, 'Estudio de televisión': 45, Fuente: 40, Universidad: 45, Hospital: 35, Memorial: 35,
    Biblioteca: 32, Bomberos: 30, 'Campo de fútbol': 30, 'Arte urbano': 30, 'Lugar histórico': 30 };
  const SERVICIO = /^(Hospital|Bomberos|Biblioteca|Campo de fútbol|Universidad|Estudio de televisión)$/;
  // trampas para turistas (museos del cannabis, eróticos, de ilusiones, de selfies…): puntúan menos y nunca son icónicas
  const TRAMPA = /(^|[^a-z])hash([^a-z]|$)|marihuana|marijuana|cannabis|er[oó]ti[ck]|sex museum|museo del sexo|selfie|museo de (la )?ilusi[oó]n|museum of illusions|upside ?down|museo de cera|wax museum|instagram/i;

  // ---------------- Uso e interés turístico ----------------
  // Usos que no son para visitar, por la clase de Wikidata (tags._uso) o por el nombre en varios idiomas: hoteles,
  // residencias, centros de salud, escuelas, polideportivos, oficinas, centros comerciales, aparcamientos.
  // Como carta normal restan puntos (a veces es un edificio histórico reutilizado); como imprescindible, nunca.
  // (por el nombre, solo lo inequívoco: «hôtel de …» en francés es un palacete —el Hôtel de Ville, los Invalides—;
  // el Liceu, el Pabellón Mies van der Rohe, The Mall, el General Post Office o el Cap de Creus NO son esto)
  const USO_RE = /(^|[^a-zà-ÿ])(hotel(?!\s+(de|des|du|d')(\s|$))|hostal(?!\s+(de|dos|dels)\s)|resid[eè]ncia geri[aà]trica|residencia (de ancianos|geri[aà]trica|de mayores)|geri[aà]tric[a-zà-ÿ]*|nursing home|retirement home|centro de salud|centre de salut|centre d'atenció primària|ambulatori[a-zà-ÿ]*|salud mental|salut mental|escola (p[uú]blica|bressol)|escuela (infantil|primaria)|colegio p[uú]blico|ceip|primary school|high school|polideportiv[a-zà-ÿ]*|poliesportiu|pabell[oó]n (deportivo|polideportivo|municipal)|pavell[oó] (esportiu|poliesportiu|municipal)|complejo deportivo|complex esportiu|edificio de oficinas|office building|centro comercial|centre comercial|shopping center|shopping centre|aparcament|aparcamiento|parking)([^a-zà-ÿ]|$)/i;
  // un edificio histórico reutilizado (el Hostal dels Reis Catòlics de Santiago es hotel) no pierde su sitio
  const usoNoTuristico = (tags) => (!!tags._uso || USO_RE.test(tags.name || '')) && !((+tags._her || 0) >= 2 || (+tags._wp || 0) >= 15);
  // antigüedad (año de fundación de Wikidata): lo medieval o anterior a 1800 tiene más interés
  const antiguedad = (tags) => { const y = +tags.start_date; return !y ? 0 : y < 1500 ? 10 : y < 1800 ? 6 : 0; };
  // Interés turístico de un tipo de lugar (para los imprescindibles): lo que de verdad se visita, arriba
  const INTERES_TIPO = { Catedral: 25, Basílica: 20, Castillo: 20, Ruinas: 15, 'Ermita / Monasterio': 12, Palacio: 12, Museo: 10, Monumento: 10,
    'Torre / Puerta': 8, 'Zoo / Acuario': 8, Iglesia: 6, Templo: 6, Estadio: 5, Plaza: 5, 'Parque temático': 5, Teatro: 3, Faro: 3, Molino: 3,
    Parque: 2, Patrimonio: 0, Mirador: 0, Universidad: -5, Rascacielos: -10 };
  // Interés de un lugar como IMPRESCINDIBLE de su ciudad: fama (sitelinks) + protección + tipo + antigüedad.
  // Devuelve null si no puede ser imprescindible (uso no turístico, hospitales, estaciones, cementerios…).
  const MUST_NO = /^(Estación|Parada de tranvía|Hospital|Bomberos|Arte urbano|Memorial|Comercio emblemático|Biblioteca|Mercado|Campo de fútbol)$/;
  const CEMENTERIO = /納骨|霊園|墓地|columbari|tanatori|crematori|cementeri|cementiri|cemetery|friedhof|cimeti[eè]re|cimitero|panteó|panteón/i;
  function interes(el) {
    const tags = el.tags || {}, c = clasificar(tags), nm = tags.name || '';
    if (!c || MUST_NO.test(c.kind) || CEMENTERIO.test(nm)) return null;
    const sl = +tags._wp || 0;
    if (usoNoTuristico(tags) && !(c.kind === 'Estadio' && sl >= 10)) return null;   // (los estadios de equipos profesionales, sí)
    if (TRAMPA.test(nm)) return null;   // (las trampas para turistas, nunca)
    const her = tags._her != null ? +tags._her : tags.heritage ? 1 : 0;
    const vis = +tags._vis > 10000 ? Math.min(20, Math.round(4 * Math.log2(+tags._vis / 10000))) : 0;   // visitantes al año
    return { c, puntos: Math.round(10 * Math.log2(1 + sl)) + [0, 4, 15, 30][Math.max(0, Math.min(3, her))] + (INTERES_TIPO[c.kind] || 0) + antiguedad(tags) + vis + (tags._atr ? 6 : 0) };
  }
  // Los imprescindibles de una ciudad: los N lugares de más interés dentro de su término (sin repetir el mismo sitio)
  function elegirImprescindibles(els, N) {
    const sc = [];
    for (const el of els) { const r = interes(el); if (r) sc.push({ el, r }); }
    sc.sort((a, b) => b.r.puntos - a.r.puntos || (a.el.id < b.el.id ? -1 : 1));
    const list = [];
    for (const { el, r } of sc) {
      const pos = [el.lat, el.lon], nm = el.tags.name;
      if (list.some((x) => geo().dist(x.pos, pos) < 40 || (sameName(x.name, nm) && geo().dist(x.pos, pos) < 400))) continue;   // el mismo sitio dos veces (no lo que está al lado)
      list.push({ q: el.id, name: nm, pos, kind: r.c.kind, emoji: r.c.emoji, sl: el.tags._wp || 0, interes: r.puntos });
      if (list.length >= N) break;
    }
    return list;
  }

  // ---------------- Candidato: un elemento del mapa o de Wikidata → lugar con su puntuación (o por qué no) ----------------
  const NO_EVANG_DEN = /evangel|pentecost|baptist|adventist|jehovah|protestant|neo/i;
  const NO_EVANG_NAME = /evang[eè]li|pentecost|bautista|baptist|adventista|filad[eè]lfia|sal[oó]n del reino|kingdom hall|testigos de jehov|centro cristiano|comunidad cristiana|ministerio|iglesia de dios|asamblea de dios|cuerpo de cristo|betel|el shaddai|nueva vida|manantial de vida|fuente de vida|casa de oraci[oó]n|tabern[aá]culo|elim\b/i;
  function evangelica(tags) {
    return tags.amenity === 'place_of_worship' && (NO_EVANG_DEN.test(tags.denomination || '') || NO_EVANG_NAME.test(tags.name || ''));
  }
  const geo = () => PM.geo;
  function candidato(el) {
    const tags = el.tags || {};
    if (!tags.name || !String(tags.name).trim()) return { motivo: 'sin nombre' };   // solo lugares con nombre: más "coleccionables"
    // nombres que son una dirección («1166», «750 Seventh Avenue»): solo si son famosos de verdad
    if (/^\d+([\s\-–]|$)/.test(tags.name) && (tags._wp || 0) < 15) return { motivo: 'nombre de dirección' };
    const important = !!(tags.wikipedia || tags.wikidata || tags._wp || tags.heritage);
    if (/plaque|stolperstein|blue_plaque|bench/.test(tags.memorial || '') && !(tags.wikipedia || tags.wikidata || tags._wp)) return { motivo: 'placa sin artículo' };
    // iglesias evangélicas / pentecostales / testigos…: no (sí las demás religiones y templos del mundo)
    if (evangelica(tags)) return { motivo: 'iglesia evangélica' };
    if (/scientolog|dian[eé]tic/i.test(tags.name)) return { motivo: 'no es un lugar de interés' };   // (cienciología)
    if (CEMENTERIO.test(tags.name) && (+tags._wp || 0) < 8) return { motivo: 'cementerio o columbario sin fama' };   // (Père-Lachaise o la Recoleta, sí)
    const c = clasificar(tags);
    if (!c) return { motivo: 'no es un lugar del juego' };
    if (c.kind === 'Atracción' && !(tags.wikipedia || tags.wikidata)) return { motivo: 'atracción sin artículo' };   // casi siempre ruido
    if (c.kind === 'Fuente' && !important) return { motivo: 'fuente sin importancia' };                                // solo fuentes monumentales
    if ((c.kind === 'Arte urbano' || c.kind === 'Memorial') && !(tags.wikipedia || tags.wikidata || tags._wp)) return { motivo: 'mural o memorial sin artículo' };
    if (tags.station === 'miniature' || tags.railway === 'station' && /miniature|museum/.test(tags.station || '')) return { motivo: 'tren en miniatura' };
    const b = el.bounds;
    const pos = el.type === 'node' ? [el.lat, el.lon] : el.center ? [el.center.lat, el.center.lon]
      : b ? [(b.minlat + b.maxlat) / 2, (b.minlon + b.maxlon) / 2] : null;
    // parques: solo los representativos (con artículo en Wikipedia o grandes: > ~3 hectáreas). Fuera parquecitos y plazas-jardín
    if (c.kind === 'Parque' && !(tags.wikipedia || tags.wikidata || tags._wp)) {
      const area = b ? (b.maxlat - b.minlat) * geo().mPerDegLat * (b.maxlon - b.minlon) * geo().mPerDegLon(b.minlat) * 0.6 : 0;
      if (area < 30000) return { motivo: 'parque pequeño' };
    }
    if (!pos || !Number.isFinite(pos[0]) || !Number.isFinite(pos[1]) || Math.abs(pos[0]) > 90 || Math.abs(pos[1]) > 180) return { motivo: 'sin posición válida' };
    // ---- Puntuación de calidad (prio): decide qué se queda cuando hay que elegir. Solo depende de los datos ----
    //  tipo de lugar (clasificar) + fama (idiomas con artículo en Wikipedia, en escala logarítmica: 1 → +10, 3 → +20,
    //  7 → +30, 15 → +40, 31 → +50) + nivel de protección (Patrimonio de la Humanidad +30, nacional +12, local +4)
    const wiki = !!(tags.wikipedia || tags.wikidata);
    const wp = Math.max(0, Math.min(400, +tags._wp || 0));
    const her = tags._her != null ? Math.max(0, Math.min(3, Math.round(+tags._her) || 0)) : tags.heritage ? 1 : 0;
    const fame = wp ? Math.round(10 * Math.log2(1 + wp)) : wiki ? 6 : 0;
    let rarity = c.rarity, ajuste = 0;
    // parques y plazas: solo los emblemáticos (con artículo) compiten con monumentos; el resto, al final de la cola
    const green = c.kind === 'Parque' || c.kind === 'Plaza';
    if (green && !wiki) { rarity = 'comun'; ajuste = -28; }
    if (wiki && rarity !== 'legendario' && !green) rarity = Object.keys(RANK)[RANK[rarity] + 1];
    // cuantos más idiomas tienen artículo, más famoso (el Coliseo, la Sagrada Família…); la UNESCO, legendaria
    if (wp >= 15 || her === 3) rarity = 'legendario'; else if ((wp >= 5 || her === 2) && RANK[rarity] < RANK.epico) rarity = 'epico';
    // estadios con artículo en Wikipedia (los de equipos profesionales, de primera y segunda): legendarios
    if (c.kind === 'Estadio' && wiki) rarity = 'legendario';
    // uso no turístico (hotel, residencia, escuela…): resta; lo antiguo: suma; visitantes al año y «atracción
    // turística» (de Wikidata): suman, como en una guía (no en los servicios: una biblioteca muy visitada sigue siéndolo)
    const uso = usoNoTuristico(tags) ? -25 : 0, edad = antiguedad(tags), serv = SERVICIO.test(c.kind);
    const vis = !serv && +tags._vis > 10000 ? Math.min(20, Math.round(4 * Math.log2(+tags._vis / 10000))) : 0, atr = !serv && tags._atr ? 8 : 0;
    const tipo = TIPO_GUIA[c.kind] != null ? TIPO_GUIA[c.kind] : c.prio, trampa = TRAMPA.test(tags.name) ? -30 : 0;
    const prot = [0, 4, 12, 30][her], prio = tipo + fame + prot + ajuste + uso + edad + vis + atr + trampa;
    const lm = { id: el.type[0] + el.id, name: tags.name, kind: c.kind, emoji: c.emoji, rarity, pos, prio, fromWd: !!tags._wp, wp, her, wiki: tags.wikipedia, wd: tags.wikidata,
      vis: +tags._vis || 0, anio: +tags.start_date || 0,
      desglose: { tipo, fama: fame, proteccion: prot, ajuste, uso, antiguedad: edad, visitantes: vis, atraccion: atr, trampa },
      townhall: c.kind === 'Ayuntamiento', church: /^(Iglesia|Basílica|Catedral)$/.test(c.kind), points: 100 * RARITY[rarity].mult,
      // icónicos: SIEMPRE visibles, sin separación mínima ni cupo de zona: ayuntamiento, catedral, basílica, castillo,
      // estación histórica, Patrimonio de la Humanidad o nacional, lo famoso de verdad (12+ idiomas) y los palacios,
      // museos, estadios, zoos, parques temáticos y monasterios con artículo en 5+ idiomas. El resto compite por su
      // sitio con cupo por zona y por tipo (seleccionar).
      principal: c.kind !== 'Comercio emblemático' && !trampa && (/^(Ayuntamiento|Catedral|Basílica|Castillo)$/.test(c.kind) || (c.kind === 'Estación' && (her >= 2 || wp >= 5))
        || her === 3 || (her === 2 && wp >= 4) || (wp >= 12 && (c.kind !== 'Rascacielos' || wp >= 25))   // (rascacielos: solo los famosos en todo el mundo)
        || (/^(Palacio|Museo|Estadio|Zoo \/ Acuario|Parque temático|Ermita \/ Monasterio)$/.test(c.kind) && wp >= 5)),
      capR: capRadius(c.kind, wiki || wp >= 2) };
    return { lm };
  }

  // ---------------- Por qué merece la pena (línea corta de la carta, como en una guía) ----------------
  // «🌍 UNESCO · 4,8 M visitas/año · s. XIV»: lo que lo hace especial, como mucho 3 cosas
  const ROMANO = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI'];
  function porQue(x) {
    if (!x) return '';
    const out = [], her = +x.her || 0, vis = +x.vis || 0, y = +x.anio || 0, wp = +x.wp || 0;
    if (her === 3) out.push('🌍 Patrimonio de la Humanidad'); else if (her === 2) out.push('🏛️ Patrimonio nacional');
    if (vis >= 1e6) out.push((vis / 1e6).toFixed(1).replace('.', ',').replace(',0', '') + ' M visitas/año');
    else if (vis >= 20000) out.push(Math.round(vis / 1000).toLocaleString('es-ES') + ' mil visitas/año');
    if (y && y < 1800) { const s = Math.floor((y - 1) / 100) + 1; out.push(y < 0 ? 'antigüedad' : s >= 1 && s <= 21 ? 's. ' + ROMANO[s] : String(y)); }
    else if (y && y <= 1950 && out.length < 2) out.push('de ' + y);
    if (wp >= 10 && out.length < 3) out.push('famoso en ' + wp + ' idiomas');
    if (her === 1 && out.length < 2) out.push('🏛️ patrimonio protegido');
    return out.slice(0, 3).join(' · ');
  }

  // ---------------- Nombres parecidos («Palau Güell» / «Palacio Güell» no; «Catedral del Salvador» / «… de Albarracín» sí) ----------------
  const normMemo = new Map();   // (cada nombre se normaliza una sola vez: la selección compara miles)
  const norm = (s) => {
    s = String(s || ''); let r = normMemo.get(s);
    if (r === undefined) { r = s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\b(de|del|la|el|les|los|las|dels|of|the|le|du|di|della)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim(); if (normMemo.size > 20000) normMemo.clear(); normMemo.set(s, r); }
    return r;
  };
  function sameName(a, b) { a = norm(a); b = norm(b); return !!a && !!b && (a === b || (a.length > 5 && b.includes(a)) || (b.length > 5 && a.includes(b))); }

  // ---------------- Iglesia principal de cada pueblo ----------------
  // Respaldo: si en un pueblo ninguna iglesia es "importante" (catedral, basílica, muy conocida…), se toma como
  // principal la más cercana a su ayuntamiento (a menos de 800 m). Se decide en cada selección con TODOS los
  // candidatos (antes, con lo que hubiera llegado hasta entonces: si luego llegaba una más cercana, cada móvil
  // podía quedarse con una distinta).
  function iglesiasPrincipales(all) {
    for (const lm of all) if (lm._main) { Object.assign(lm, lm._main); delete lm._main; delete lm.mainChurch; }
    const churches = all.filter((x) => x.church), byId = (x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
    for (const th of all.filter((x) => x.townhall).sort(byId)) {
      // ¿ya hay una iglesia principal en este pueblo? (a menos de 1,5 km de su ayuntamiento)
      if (churches.some((c) => c.principal && geo().dist(th.pos, c.pos) < 1500)) continue;
      let best = null, bd = CONF.MAIN_CHURCH_M;
      for (const c of churches) { const d = geo().dist(th.pos, c.pos); if (d < bd || (d === bd && best && c.id < best.id)) { bd = d; best = c; } }
      if (best && !best.principal) {
        best._main = { principal: best.principal, kind: best.kind, rarity: best.rarity, points: best.points };   // (para deshacerlo)
        best.principal = true; best.mainChurch = true; best.kind = 'Iglesia principal';
        if (RANK[best.rarity] < RANK.epico) best.rarity = 'epico';
        best.points = 100 * RARITY[best.rarity].mult;
      }
    }
  }

  // ---------------- Selección: cuáles salen en el mapa ----------------
  // DETERMINISTA: con los mismos candidatos sale lo mismo, lleguen en el orden que lleguen y se recalcule las veces que
  // se recalcule (antes, en un móvil llegaba antes lo de OpenStreetMap y en otro lo de Wikidata, y a cada uno le salían
  // lugares distintos: la Font dels Nens de la Ciutadella). Orden fijo: conquistados, icónicos, puntuación y, a
  // igualdad, el id.
  //   ctx.isCap(lm): ¿ya conquistado? (entra siempre) · ctx.zona(pos): clave de su zona de ~1 km²
  //   why: por qué entra o se queda fuera cada candidato (para depurar: inspector de lugares, W.porque(id))
  // (rápido: cada candidato guarda una vez su escala en metros y su nombre normalizado; las distancias se comparan al
  // cuadrado, sin raíces ni cosenos; los vecinos se recorren por celdas sin crear listas)
  const prep = (lm) => { if (lm._p !== lm.pos) { lm._p = lm.pos; lm._y = lm.pos[0] * 110540; lm._kx = 111320 * Math.cos(lm.pos[0] * Math.PI / 180); lm._n = norm(lm.name); } };
  const d2 = (a, b) => { const dy = a._y - b._y, dx = (a.pos[1] - b.pos[1]) * (a._kx + b._kx) / 2; return dx * dx + dy * dy; };
  const sameN = (a, b) => { const x = a._n, y = b._n; return !!x && !!y && (x === y || (x.length > 5 && y.includes(x)) || (y.length > 5 && x.includes(y))); };
  function seleccionar(cands, ctx) {
    const isCap = ctx.isCap || (() => false), zona = ctx.zona, C = CONF;
    const why = new Map(), byId = (x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
    // lo que se decide en cada pasada se recalcula desde cero (tipo heredado del mapa, iglesia principal)
    for (const lm of cands) { if (lm._spec) { lm.kind = 'Patrimonio'; lm.emoji = lm._spec; delete lm._spec; } prep(lm); }
    iglesiasPrincipales(cands);
    const cap = new Map(); for (const lm of cands) cap.set(lm, !!isCap(lm));
    const all = cands.slice().sort((x, y) => (cap.get(y) - cap.get(x)) || (y.principal - x.principal) || (y.prio - x.prio) || byId(x, y));
    const G = C.GRID, ck = (i, j) => i * 1e6 + j;
    const gridAdd = (M, lm) => { const k = ck(Math.floor(lm.pos[0] / G), Math.floor(lm.pos[1] / G)); const L0 = M.get(k); if (L0) L0.push(lm); else M.set(k, [lm]); };
    // recorre los vecinos (±r celdas) hasta que fn devuelva algo
    const near = (M, q, r, fn) => {
      const ci = Math.floor(q.pos[0] / G), cj = Math.floor(q.pos[1] / G);
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) { const L0 = M.get(ck(ci + i, cj + j)); if (L0) for (const o of L0) { const v = fn(o); if (v) return v; } }
      return null;
    };
    // 1) lo de Wikidata que es el MISMO sitio que algo del mapa (mismo Q, mismo tipo cerca o nombre parecido; no
    //    cualquier cosa a 40 m): se queda uno
    const osmGrid = new Map(), drop = new Map();   // id → motivo
    for (const o of all) if (!o.fromWd) gridAdd(osmGrid, o);
    for (const lm of all) {
      if (!lm.fromWd) continue;
      const same = [], close = [];
      near(osmGrid, lm, 2, (o) => {
        if (o.wd && o.wd === lm.wd) same.push(o);
        else { const dd = d2(o, lm); if ((o.kind === lm.kind && dd < 3600) || (dd < 90000 && sameN(o, lm))) close.push(o); }
      });
      if (same.length) {
        if (cap.get(lm) && !same.some((o) => cap.get(o))) same.forEach((o) => drop.set(o.id, 'duplicado de ' + lm.name + ' (conquistado)'));
        else drop.set(lm.id, 'duplicado de ' + same[0].name + ' (mismo Wikidata)');
        continue;
      }
      // el mismo sitio (mismo tipo cerca o nombre parecido): se queda la versión con mejor puntuación (la de Wikidata
      // suele saber más: fama, protección). Cosas distintas casi encima (estatua ante una iglesia): las dos (luego decide
      // la separación mínima)
      if (!close.length) continue;
      // si ya conquistaste la versión del mapa, se queda esa (antes salían las dos: «Ajuntament» y «casa consistorial»)
      const capO = close.find((o) => cap.get(o));
      if (capO && !cap.get(lm)) { drop.set(lm.id, 'duplicado de ' + capO.name + ' (ya conquistado)'); continue; }
      if (close.every((o) => !o.wd && !o.wiki) && lm.prio >= Math.max(...close.map((o) => o.prio))) {
        close.forEach((o) => { if (!cap.get(o)) drop.set(o.id, 'duplicado de ' + lm.name + ' (Wikidata sabe más)'); });
        // Wikidata solo sabe que es «patrimonio» y el mapa dice qué es (el Alcázar de Toledo, un castillo): ese tipo
        const spec = close.filter((o) => o.kind !== 'Patrimonio' && sameN(o, lm)).sort((x, y) => y.prio - x.prio || (x.id < y.id ? -1 : 1))[0];
        if (lm.kind === 'Patrimonio' && spec) { lm._spec = lm.emoji; lm.kind = spec.kind; lm.emoji = spec.emoji; }
      } else if (!cap.get(lm)) drop.set(lm.id, 'duplicado de ' + close[0].name + ' (del mapa)');
    }
    // 2) de más importante a menos: cada uno entra si no tiene otro ya elegido demasiado cerca y queda cupo
    //    (los icónicos entran siempre y no se tapan entre ellos; lo conquistado, siempre)
    const kept = new Map(), keep = new Set(), zoneN = {}, kindN = {}, iconN = {}, allN = {}, iconKindN = {};
    const sq = (m) => m * m, th2 = sq(C.TOWNHALL_GAP), sh2 = sq(C.SHOP_GAP);
    for (const lm of all) {
      if (drop.has(lm.id)) { why.set(lm.id, drop.get(lm.id)); continue; }
      const zk = zona(lm.pos), kk = zk + '|' + lm.kind.replace(' principal', ''), isC = cap.get(lm);
      // (pasado el tope, compite como los demás; lo famoso en todo el mundo, 20+ idiomas, entra siempre: el Arco de Tito)
      const icon = lm.principal && (((iconN[zk] || 0) < C.ICON_MAX && (iconKindN[kk] || 0) < C.ICON_KIND_MAX) || lm.wp >= C.WORLD_FAMOUS);
      const shop = lm.kind === 'Comercio emblemático';
      // lo importante aparece siempre: desde 110 puntos, sin cupos ni separación (como los icónicos, pero contando cupo)
      const imp = icon || lm.prio >= C.IMPORTANTE;
      if (!isC) {
        if (!imp && ((zoneN[zk] || 0) >= C.ZONE_QUOTA || (allN[zk] || 0) >= C.ZONE_MAX) && !shop) { why.set(lm.id, 'zona completa (' + ((allN[zk] || 0) >= C.ZONE_MAX ? C.ZONE_MAX + ' en total' : C.ZONE_QUOTA + ' normales') + ')'); continue; }
        const kq = SERVICIO.test(lm.kind) ? C.SERVICE_QUOTA : shop ? C.SHOP_QUOTA : C.KIND_QUOTA;
        if (!imp && (kindN[kk] || 0) >= kq) { why.set(lm.id, 'ya hay ' + kq + ' de su tipo en la zona'); continue; }
        // lo flojo solo rellena zonas con poco (en el Gòtic no hace falta; en un barrio sin monumentos, sí)
        if (!imp && !shop && lm.prio < C.RELLENO && (allN[zk] || 0) >= C.RELLENO_HASTA) { why.set(lm.id, 'poco interés para una zona que ya tiene ' + (allN[zk] || 0) + ' lugares'); continue; }
        // varios edificios del mismo sitio (TV3…): uno
        if (near(kept, lm, 2, (o) => o.name === lm.name && d2(o, lm) < (o.kind === lm.kind ? 90000 : 6400))) { why.set(lm.id, 'mismo nombre que otro ya elegido'); continue; }
        if (lm.kind === 'Estación' && !lm.wiki && !lm.wd) {
          const parque = (o) => o.kind === 'Parque' && d2(o, lm) < 250000 && sameN(o, lm);
          if (near(osmGrid, lm, 3, parque) || near(kept, lm, 3, parque)) { why.set(lm.id, 'estación que se llama como el parque'); continue; }
        }
        // separación (60 m) solo para el relleno: lo que tiene interés de guía (75+) sale aunque tenga otro al lado
        if (!imp && lm.prio < C.SIN_SEPARACION) {
          const gap2 = sq(lm.wp >= 8 ? C.FAMOUS_GAP : C.MIN_GAP);
          const vecino = near(kept, lm, 1, (o) => (d2(o, lm) < (o.townhall && lm.wp < 8 ? th2 : shop || o.kind === 'Comercio emblemático' ? sh2 : gap2)) && o);
          if (vecino) { why.set(lm.id, 'demasiado cerca de ' + vecino.name + ' (' + Math.round(Math.sqrt(d2(vecino, lm))) + ' m)'); continue; }
        }
      }
      keep.add(lm.id); gridAdd(kept, lm);
      why.set(lm.id, isC ? 'conquistado' : icon ? 'icónico' : 'entra');
      // (los comercios históricos tienen su propio cupo de tipo y no quitan sitio al resto: los pidió el jugador)
      if (icon) { iconN[zk] = (iconN[zk] || 0) + 1; iconKindN[kk] = (iconKindN[kk] || 0) + 1; }
      else if (!isC) { if (!shop) zoneN[zk] = (zoneN[zk] || 0) + 1; kindN[kk] = (kindN[kk] || 0) + 1; }
      if (!shop) allN[zk] = (allN[zk] || 0) + 1;
    }
    return { keep, why };
  }

  PM.capRadius = capRadius;
  PM.lugares = { RARITY, RANK, CONF, MUST_NO, TIPO_GUIA, SERVICIO, porQue, clasificar, candidato, evangelica, seleccionar, interes, elegirImprescindibles, usoNoTuristico, sameName, norm, capRadius };
})(typeof window !== 'undefined' ? window : globalThis);
