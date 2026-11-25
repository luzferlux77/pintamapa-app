// PintaMapa — MOTOR DE LUGARES (el corazón del juego): qué es cada sitio, cuánto vale y cuáles salen en el mapa.
// Funciones puras, sin estado ni red: reciben datos y devuelven resultados. Las usan world.js (que carga los datos y
// guarda los candidatos), las pruebas (tests/seleccion.mjs, tests/motor-lugares.mjs) y el inspector de lugares
// (tests/inspector-lugares.html). Las reglas, explicadas, en LUGARES.md.
//
//   PM.lugares.clasificar(tags)          → { kind, emoji, prio } o null (no es un lugar del juego)
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
  // (aeropuertos: se capturan desde fuera de sus instalaciones —la terminal, el parking, la carretera de acceso—: 1,5 km
  // desde su punto, 2,5 km en los grandes)
  const capRadius = (kind, big) => (kind === 'Estadio' && big ? 240 : kind === 'Aeropuerto' ? (big === 'grande' ? 2500 : 1500)
    : ({ Estadio: 200, 'Estudio de televisión': 200, 'Calle emblemática': 60, 'Campo de fútbol': 70, Parque: 45, 'Zoo / Acuario': 80, 'Parque temático': 120 })[kind]) || 30;

  // Sitio grande (la precarga sabe su tamaño, _lado: el lado corto en metros): hay que poder capturarlo desde su borde,
  // sin entrar. Un palacio de 200 m no se alcanza a 30 m de su centro desde la calle, ni un zoo de pago.
  const capDeLado = (lado) => (+lado > 0 ? Math.min(300, Math.round(lado / 2) + 30) : 0);

  // Reglas de la selección (ver LUGARES.md)
  // Como una buena guía: lo que de verdad merece la visita, bien repartido por cada barrio, sin saturar.
  const CONF = {
    MIN_GAP: 60, TOWNHALL_GAP: 100, SHOP_GAP: 25, FAMOUS_GAP: 35,   // separaciones (m)
    RAREZA: { legendario: 135, epico: 110, raro: 90 },               // puntos: en los álbumes, 7 % legendarios, 18 % épicos, 29 % raros (en España, 4, 14 y 28)
    ZONE_QUOTA: 12, KIND_QUOTA: 4, SERVICE_QUOTA: 1, SHOP_QUOTA: 2,  // cupo por zona de ~1 km², por tipo, por servicio y de comercios (sin icónicos)
    RELLENO: 60, RELLENO_HASTA: 6,                                   // lo flojo (< 60 puntos) solo si la zona tiene menos de 6 lugares
    SIN_SEPARACION: 75, IMPORTANTE: 110,                             // lo que importa sale aunque tenga otro al lado; lo muy importante, sin cupos
    DE_GUIA: 90,                                                     // lo raro o más (o lo que cita una guía) no se queda fuera por cupos de zona ni de tipo
    ICON_MAX: 18, ICON_KIND_MAX: 6, ZONE_MAX: 26,                    // topes en ciudades monumentales
    // centro histórico: zona de ~1 km² con HIST_MIN lugares de guía o más (el casco de Sevilla, el Gòtic, el centro de Roma):
    // ahí caben más (antes se quedaban fuera la Plaza Nueva o las Setas de Sevilla por «zona completa», 20-nov-2026)
    // (techo 90, no 60: con las clases nuevas de Wikidata compiten más lugares, y con 60 se quedaban fuera el Chiostro dello Scalzo,
    // la Piazza dei Martiri o la sinagoga de Nápoles —22-nov-2026—. Con 90 solo quedan fuera las tumbas de Luxor y el km² más
    // denso de Roma, Florencia y Venecia, que ya pasan de 90 con lo muy importante)
    HIST_MIN: 10, HIST_ZONE_QUOTA: 20, HIST_KIND_QUOTA: 6, HIST_ZONE_MAX: 45, HIST_TECHO: 90,
    WORLD_FAMOUS: 15,                                                // idiomas: entra siempre (lo legendario por fama no se queda fuera por un tope: la plaza de Sant Jaume)
    GRID: 0.0015,                                                    // celda del índice de separación (~160 m)
    MAIN_CHURCH_M: 800,
  };

  // ---------------- Qué es cada sitio ----------------
  // nombres de otra cosa: aunque lleven «catedral», «basílica», «palau» o «castell», no son eso
  const NO_POR_NOMBRE = /^(hotel(?!\s+(?:(?:de|des|du)(?:\s|$)|d['’]))|h[oô]tel(?!\s+(?:(?:de|des|du)(?:\s|$)|d['’])) |hostal|hostel|apartament|apartamento|apartments|parking|aparcamiento|aparcament|restaurante?|bar |cafeter[ií]a|caf[eé] |cervecer[ií]a|tienda|botiga|shop |farmacia|farm[aà]cia|mercado|mercat|museo|museu|museum|mus[eé]e|plaza|pla[çc]a|piazza|place |carrer|calle|avinguda|avenida|via |rua |paseo|passeig|escuela|escola|colegio|instituto|parada|estaci[oó]n|metro )/i;
  // Universidades y facultades: NO van (el usuario, 25-oct-2026). Solo si es patrimonio protegido o histórica
  // (Salamanca, Alcalá…) sale, como el monumento que es (Patrimonio). Por el nombre también, porque Wikidata a veces las
  // trae con otra clase (la Universidad Católica Andrés Bello de Caracas salía como «Patrimonio»).
  const UNI_NAME = /(^|[^a-zà-ÿ])(universidad|universitat|university|universit[eé]|universit[äà]t?|universiteit|universidade|uniwersytet|universitet[a-z]*|[üu]niversitesi|universitas|polit[eé]cnic[ao]|politecnico|polytechnic|facultad de|faculty of|facult[eé] de|institute of (technology|science|sciences|health)|instituto (tecnol[oó]gico|polit[eé]cnico))([^a-zà-ÿ]|$)/i;
  // (lo que pertenece a una universidad pero se visita por sí mismo —su museo, su jardín botánico, su capilla, su
  // biblioteca histórica, su teatro— sigue siendo eso)
  const UNI_OTRO = /(^|[^a-zà-ÿ])(museo|museu|museum|mus[eé]e|jard[ií]n|jardí|garden|bot[aá]ni|capilla|capella|chapel|iglesia|church|templo|temple|observatori|biblioteca|library|teatro|theatre|theater|estadio|stadium|hospital|palacio|palau|palazzo|palace|torre|tower|monumento|monument|plaza|pla[çc]a|place|square|piazza|pra[çc]a|platz|calle|carrer|street|avenida|avinguda|parque|parc|parks?|puerta|porta|gate|fuente|font|fountain|estatua|statue|puente|ponte|pont|bridge)([^a-zà-ÿ]|$)/i;
  // ¿es patrimonio protegido? (de Wikidata: cualquier nivel de protección real; del mapa: la etiqueta heritage)
  const esPatrimonio = (tags) => (tags._her != null ? +tags._her >= 1 : !!tags.heritage);
  // una universidad histórica también entra (Oxford, Bolonia, Salamanca, Coimbra, la Carolina de Praga, Harvard…):
  // fundada antes de 1800 y conocida
  const universidadHistorica = (tags) => esPatrimonio(tags) || ((+tags.start_date || 9999) < 1800 && (+tags._wp || 0) >= 15);
  const esUniversidad = (tags) => tags.amenity === 'university' || (UNI_NAME.test(tags.name || '') && !UNI_OTRO.test(tags.name || ''));
  const otroUsoNombre = (n) => NO_POR_NOMBRE.test(n);
  const TIPO_POR_NOMBRE = [
    [/^(castillo|castell|castle|castello|fortaleza|fortress)\s/i, { kind: 'Castillo', emoji: '🏰', prio: 90 }],
    [/^(puente|pont|ponte|bridge)\s/i, { kind: 'Puente', emoji: '🌉', prio: 64 }],
    [/^(iglesia|esgl[eé]sia|capilla|capella|chapel)\s/i, { kind: 'Iglesia', emoji: '⛪', prio: 75 }],
    [/^(abad[ií]a|abbaye|abbey|convento|convent|monasterio|monestir|monastery|priorato)\s/i, { kind: 'Ermita / Monasterio', emoji: '⛪', prio: 74 }],
    [/^(pir[aá]mides?|pyramids?|muro|mausoleo|tumba)\s/i, { kind: 'Monumento', emoji: '🗽', prio: 70 }],
  ];
  function clasificar(tags) {
    // prio: importancia para la conquista (decide qué se queda cuando dos están muy cerca). El ayuntamiento, siempre el primero.
    const a = tags.amenity, h = tags.historic, t = tags.tourism, b = tags.building, l = tags.leisure, n = tags.name || '';
    if (esUniversidad(tags)) return universidadHistorica(tags) ? { kind: 'Patrimonio', emoji: '🏛️', prio: 62 } : null;
    if (a === 'townhall' && /区役所|区民|ward office|junta (municipal )?de distrito|junta municipal|seu del districte|districte|distrito|arrondissement|mairie (du|annexe)|bezirksamt|borough hall|municipio [ivx\d]+\b/i.test(n))
      return esPatrimonio(tags) ? { kind: 'Patrimonio', emoji: '🏛️', prio: 62 } : null;   // juntas de distrito: no son el ayuntamiento
    if (a === 'townhall' && !/税務|警察|裁判|tax office|police|polic[ií]a|comisar|juzgado|court|tribunal|hacienda|agencia tributaria/i.test(n)) return { kind: 'Ayuntamiento', emoji: '🏛️', prio: 100 };
    // una plaza es una plaza aunque Wikidata la tenga además como sede olímpica (la Concordia de París 2024)
    // (también con mercado: la plaza de Yamaa el Fna; no una plaza de abastos, ni un centro comercial o una torre que se llaman Plaza,
    // ni un «square» de París, que es un jardín)
    // (ni una estación, una tienda, un aeropuerto o un museo que se llaman «Plaza…»: la estación Plaza de España, «Plaza Modas»
    // —informe de Gemini (2), 20-nov-2026—)
    if ((!a || (a === 'marketplace' && !/abastos|mercado|mercat|market/i.test(n))) && !tags._uso && b !== 'skyscraper' && !(l && /^square\s/i.test(n))
      && !tags.railway && !tags.station && !tags.public_transport && !tags.shop && !tags.aeroway && !(t && t !== 'attraction' && t !== 'viewpoint')
      && /^(plaza|place|piazza|square|pra[çc]a|platz|pla[çc]a|largo|rynek|n[aá]m[eě]st[ií])(\s|$)/i.test(n) && !/toros|bullring|arena|stadium|estadio/i.test(n)) return { kind: 'Plaza', emoji: '🏙️', prio: 55 };
    // por el nombre, solo templos y edificios (no la «Piazza del Duomo»); «Dom» solo como en alemán (Kölner Dom, Dom St. Peter):
    // antes «Sant Domènec» o «Justo Domínguez» salían como catedrales (la tilde cortaba la palabra)
    // El tipo por el NOMBRE solo cuando encaja: en un templo, la palabra en cualquier parte; en otro edificio, solo si el
    // nombre EMPIEZA por ella («Catedral de…»). Y un nombre que empieza por hotel, parking, restaurante, museo, plaza o
    // calle nunca es catedral, basílica, castillo ni palacio por llevar esa palabra (el «Hotel Catalonia Catedral» salía
    // como catedral legendaria).
    const otroUso = NO_POR_NOMBRE.test(n) || !!tags._uso;
    const temple = a === 'place_of_worship' || b === 'church';
    // (una capilla, sacristía, cripta o claustro «de la Catedral» es una parte de ella, no otra catedral: la Capilla Real de la
    // Catedral de Sevilla salía como catedral —20-nov-2026—)
    const parteDe = /^(la |el |the )?(capilla|capella|cappella|chapel|chapelle|kapelle|sagrario|sacrist[ií]a|cripta|crypt|claustro|cloister|cloître|chiostro)\b/i.test(n);
    const catName = !parteDe && (/catedral|cathedral|cathédrale|cattedrale|kathedrale|domkirke|(^|[^a-zà-ÿ])duomo([^a-zà-ÿ]|$)/i.test(n) || /(^|\s)dom$|^dom\s+(st\.?|sankt|unser|zu|mari)/i.test(n));
    if (b === 'cathedral' || (!otroUso && catName && !tags.place && !/(^|\s)(square|plaza|pla[çc]a|piazza|platz)(\s|$)/i.test(n) && (temple || (h === 'building' && /^(la |le |the |santa |s\.\s*)?(catedral|cathedral|cathédrale|cattedrale|kathedrale|duomo|concatedral)/i.test(n)))))
      return { kind: 'Catedral', emoji: '⛪', prio: 95 };
    // palacios y casas señoriales que OpenStreetMap marca como «castillo» (los del Gòtic y el Born): palacio o patrimonio
    const palaceName = /(^|[^a-zà-ÿ])(palau|palauet|palacio|palacete|palace|palais|palazzo|palazzetto|pałac|palácio|schloss|paleis)([^a-zà-ÿ]|$)/i.test(n)
      && !tags.place && !/^(pla|plaça|plaza|piazza|place|platz|carrer|calle|via|rua|font|fuente|fanals|farolas|estaci|parada|jardins?|jardines|parc|parque)\b/i.test(n)   // «Pla de Palau» es una plaza
      && !/esport|deport|sport|congr[eé]s|cinema|cine\b|sant jordi|blaugrana|fira|firal|vela|gel\b|hielo|\bice\b|wedding|theat|teatr|th[eé][aâ]tre|hotel|casino|ballroom/i.test(n) && !otroUso   // ni pabellones, cines, teatros ni hoteles que se llaman «Palau»/«Palace»
      // ni lo que es parte o vecino de un palacio («Puente del Palacio», «Capilla del Palacio», «Dinosaurios de Crystal Palace»)…
      && !/(^|\s)(de|del|della|di|al|of|du|des|the)\s+(l[ao]\s+|el\s+)?([\p{L}.-]+\s+)?(palau|palauet|palacio|palacete|palace|palais|palazzo|palazzetto|pałac|palácio|schloss|paleis)(\s|$)/iu.test(n)
      // …ni lo que ya se sabe qué es: un teatro, un estadio, un puente, una calle, un templo (salvo el palacio que lleva su uso en la ficha: «Palacio Monasterio del Temple»)
      && !(a === 'theatre' || l === 'stadium' || b === 'stadium' || tags.man_made || tags._calle || tags.railway || (t === 'museum' && /\bmuse(o|u|um)\b/i.test(n)) || (temple && !/^(palau|palacio|palace|palais|palazzo)\b/i.test(n)) || /chapel|capilla|capella|church|iglesia/i.test(n));
    // un «castillo» del mapa base que no se llama castillo (aduana, asilo, casa señorial…): patrimonio; los de Wikidata, sí
    const castleName = /castell|castillo|castle|ch[aâ]teau|castello|burg|fortale|fortress|fort\b|alc[aá]zar|alcazaba|kasteel|zamek|hrad|citadel|ciutadella|ciudadela|torre/i.test(n);
    if (h === 'castle' && !palaceName && (/^(casa|cal|can|ca l'|cases|sal[oó]|edifici|mansi[oó]n?|villa)\b/i.test(n) || (!tags._wp && !castleName))) return { kind: 'Patrimonio', emoji: '🏛️', prio: 62 };
    // una puerta o unas murallas de una fortificación no son un castillo (la Puerta dorada de Kiev, las murallas de Jerusalén);
    // y la residencia de un rey, aunque Wikidata la dé como castillo, es un palacio (la Residencia de Múnich)
    if ((h === 'castle' || h === 'fort') && /^(puertas?|portal|porta|gate)\b/i.test(n)) return { kind: 'Torre / Puerta', emoji: '🗼', prio: 65 };
    if ((h === 'castle' || h === 'fort') && /^(murallas?|muraille|mura|walls?|l[ií]nea)\b/i.test(n)) return { kind: 'Monumento', emoji: '🗽', prio: 70 };
    const residencia = h === 'castle' && /^(residencia|residenz|residence)\b/i.test(n);
    if ((h === 'castle' && !palaceName && !residencia) || h === 'fort') return { kind: 'Castillo', emoji: '🏰', prio: 90 };
    // (un rascacielos que se llama «Palais Royale» es un rascacielos)
    if (b === 'skyscraper') return { kind: 'Rascacielos', emoji: '🏙️', prio: 60 };
    if (b === 'palace' || palaceName || residencia) return { kind: 'Palacio', emoji: '🏰', prio: 84 };
    if (l === 'stadium' || b === 'stadium') return { kind: 'Estadio', emoji: '🏟️', prio: 85 };
    if (b === 'basilica' || (!otroUso && (temple || h === 'building') && /bas[ií]lica|co-?catedral|concatedral/i.test(n))) return { kind: 'Basílica', emoji: '⛪', prio: 80 };
    // ermitas y monasterios (siempre visibles si son patrimonio o tienen Wikipedia)
    // (también el que Wikidata da como edificio-monasterio, y los nombres en otras lenguas: Kloster, abbaye, abdij, priorato,
    // certosa, mosteiro… —informe de Gemini (2)—)
    if (a === 'place_of_worship' && /christian/.test(tags.religion || 'christian') && (b === 'chapel' || b === 'monastery' || /ermita|eremitori|santuari|monasteri|monestir|convent|couvent|abad[ií]a|abbaye|abdij|kloster|prieur|priorat|priory|certosa|mosteiro|cartuja|cartoixa|hermitage|monastery|abbey/i.test(n)))
      return { kind: 'Ermita / Monasterio', emoji: '⛪', prio: 74 };
    if (a === 'place_of_worship') return { kind: /christian/.test(tags.religion || 'christian') ? 'Iglesia' : 'Templo', emoji: '⛪', prio: 75 };
    if (t === 'museum') return { kind: 'Museo', emoji: '🖼️', prio: 70 };
    if (t === 'zoo' || t === 'aquarium') return { kind: 'Zoo / Acuario', emoji: t === 'aquarium' ? '🐠' : '🦁', prio: 68 };
    if (t === 'theme_park') return { kind: 'Parque temático', emoji: '🎢', prio: 64 };
    // (una locomotora expuesta como monumento lleva su tren, no la estatua: la nº 37 de Cornellà, 15-nov-2026)
    if (h === 'monument' && /^(locomotora|locomotiva|locomotive|lokomotive)\b/i.test(n)) return { kind: 'Monumento', emoji: '🚂', prio: 70 };
    if (h === 'monument') return { kind: 'Monumento', emoji: '🗽', prio: 70 };
    if (h === 'city_gate' || h === 'tower' || tags.man_made === 'tower' || tags.man_made === 'obelisk' || b === 'tower') return { kind: 'Torre / Puerta', emoji: '🗼', prio: 65 };
    // (Wikidata da como «puente» los acueductos y algún ascensor: el de Segovia es un monumento)
    if (tags.man_made === 'bridge' && /^(acueducto|aqueduct|aqueduc|acquedotto|aqueduto|ascensor|elevador|elevator)\b/i.test(n)) return { kind: 'Monumento', emoji: '🗽', prio: 70 };
    if (tags.man_made === 'bridge') return { kind: 'Puente', emoji: '🌉', prio: 64 };
    if (tags._calle) return { kind: 'Calle emblemática', emoji: '🛣️', prio: 58 };
    // aeropuertos (los comerciales e internacionales conocidos; no aeródromos de avionetas ni helipuertos)
    if (tags.aeroway === 'aerodrome') return (+tags._wp || 0) >= 10 ? { kind: 'Aeropuerto', emoji: '✈️', prio: 60 } : null;
    // mercados: un mercado histórico es un mercado (antes, si era patrimonio, salía como «Patrimonio» genérico)
    if (a === 'marketplace') return { kind: 'Mercado', emoji: '🛒', prio: 52 };
    // hospitales: NO van (el usuario, 25-oct-2026); solo uno histórico y protegido que se visita como monumento
    // (el Hospital de Sant Pau de Barcelona, Patrimonio de la Humanidad), y como eso: Patrimonio
    if (a === 'hospital') return esPatrimonio(tags) ? { kind: 'Patrimonio', emoji: '🏛️', prio: 62 } : null;
    // parques de bomberos: NO van (el usuario, 25-oct-2026); solo uno histórico y protegido, como Patrimonio
    if (a === 'fire_station') return esPatrimonio(tags) ? { kind: 'Patrimonio', emoji: '🏛️', prio: 62 } : null;
    // estudios de televisión (no los de vídeo, radio o audio); las grandes cadenas, épicas
    if (a === 'studio' && /(^|;)\s*(television|tv)\s*(;|$)/.test(tags.studio || ''))
      return { kind: 'Estudio de televisión', emoji: '📺', prio: 62 };
    if (a === 'theatre') return { kind: 'Teatro', emoji: '🎭', prio: 60 };
    if (tags.place === 'square') return { kind: 'Plaza', emoji: '🏙️', prio: 55 };
    if (tags.man_made === 'lighthouse') return { kind: 'Faro', emoji: '🗼', prio: 55 };
    // estaciones: solo las de tren históricas (protegidas como patrimonio); nunca metro, tranvía ni apeaderos
    // (histórica DE VERDAD: protegida a nivel nacional o mundial, anterior a 1930 o muy conocida; un catálogo local no
    // basta —la estación de Cornellà, un intercambiador de metro, tranvía y Cercanías, salía como carta—)
    const swp = +tags._wp || 0, sy = +tags.start_date || 9999;
    const estHistorica = (+tags._her || 0) >= 2 || sy < 1930 || swp >= 15 || (tags._her == null && tags.heritage && !tags.wikidata);
    // estación monumental: protegida y antigua o conocida; o antigua y conocida aunque no esté protegida (Atocha, 1851);
    // o de un arquitecto conocido (Liège-Guillemins). Nunca metro ni apeaderos.
    // y las PRINCIPALES de las grandes ciudades (muy conocidas: Sants, Chamartín, Shinjuku, Berlín Central…)
    const estMonumental = (esPatrimonio(tags) && estHistorica) || (sy < 1930 && swp >= 10) || (tags._arq && swp >= 10) || swp >= 15;
    if (tags.railway === 'station' && estMonumental && tags.station !== 'subway' && !/\bmetro\b|intercambiador|interchange/i.test(n)) return { kind: 'Estación', emoji: '🚉', prio: 66 };
    if (/^(station|halt|tram_stop|subway_entrance)$/.test(tags.railway || '') || tags.station === 'subway') return null;
    // comercios históricos o de gran interés que siguen abiertos: protegidos, famosos en el mundo (8+ idiomas) o conocidos
    // y fundados antes de 1950 (no los restaurantes de moda); los cerrados ya no llegan de Wikidata
    if ((esPatrimonio(tags) || (tags._wp || 0) >= 8 || ((tags._wp || 0) >= 2 && +tags.start_date && +tags.start_date <= 1950)) && (tags.shop || /^(cafe|bar|restaurant|pharmacy|pub|ice_cream)$/.test(a || ''))) return { kind: 'Comercio emblemático', emoji: '☕', prio: 52 };
    if (tags.shop || /^(cafe|bar|restaurant|pharmacy|pub|ice_cream)$/.test(a || '')) return null;   // el resto de tiendas y bares: no
    if (l === 'park' || l === 'garden') return { kind: 'Parque', emoji: '🌳', prio: 48 };   // (jardines botánicos incluidos)
    if (tags.man_made === 'windmill' || tags.man_made === 'watermill') return { kind: 'Molino', emoji: '🌬️', prio: 52 };
    if (a === 'fountain') return { kind: 'Fuente', emoji: '⛲', prio: 30 };
    // (ruinas y miradores antes que el «patrimonio» genérico: unas ruinas protegidas son ruinas —el Foro Romano—)
    if (h === 'ruins' || h === 'archaeological_site') return { kind: 'Ruinas', emoji: '🏺', prio: 45 };
    if (t === 'viewpoint') return { kind: 'Mirador', emoji: '🔭', prio: 45 };
    // (una biblioteca protegida es una biblioteca: la Británica o la Bodleiana salían como «Patrimonio»)
    if (a === 'library') return { kind: 'Biblioteca', emoji: '📚', prio: 38 };
    if (esPatrimonio(tags)) {
      // sin una clase que diga qué es, lo dice el nombre (solo lo inequívoco, y nunca un edificio con otro uso): el Castillo Edo, el Museo delle Mura
      if (!tags._uso && !otroUsoNombre(n)) for (const [re, r] of TIPO_POR_NOMBRE) if (re.test(n)) return r;
      if (!tags._uso && /^(museo|museu|museum|mus[eé]e)\b/i.test(n)) return { kind: 'Museo', emoji: '🖼️', prio: 70 };
      return { kind: 'Patrimonio', emoji: /f[aàá]bri|factory|usine|fabbrica/i.test(n) ? '🏭' : '🏛️', prio: 62 };
    }
    if (l === 'pitch' && tags.sport === 'soccer') return { kind: 'Campo de fútbol', emoji: '⚽', prio: 44 };
    if (t === 'attraction') return { kind: 'Atracción', emoji: '⭐', prio: 35 };
    if (h === 'memorial') return { kind: 'Memorial', emoji: '🗿', prio: 30 };
    if (t === 'artwork') return { kind: 'Arte urbano', emoji: '🎨', prio: 15 };
    if (h) return { kind: 'Lugar histórico', emoji: '📜', prio: 10 };
    return null;
  }

  // ---------------- Valor de guía de cada tipo de lugar ----------------
  // Lo que recomiendan las guías, arriba (monumentos, miradores, ruinas, museos, mercados históricos); los servicios
  // (bibliotecas, campos de fútbol…) siguen siendo cartas, pero solo rellenan las zonas que no tienen nada mejor.
  // (Hospital y Bomberos ya no salen en el mapa: siguen aquí por las cartas antiguas, hasta que las revise revisarRegistro)
  const TIPO_GUIA = { Ayuntamiento: 100, Catedral: 95, Castillo: 90, Basílica: 85, Palacio: 84, Museo: 78, Monumento: 75, 'Ermita / Monasterio': 74,
    Ruinas: 72, 'Torre / Puerta': 70, Estadio: 70, Iglesia: 66, Templo: 66, Estación: 66, 'Zoo / Acuario': 64, Mirador: 62, 'Iglesia principal': 75,
    Faro: 60, Rascacielos: 60, Plaza: 60, Puente: 64, Aeropuerto: 60, 'Calle emblemática': 62, Patrimonio: 58, Teatro: 58, 'Parque temático': 58, Parque: 55, Mercado: 55, Molino: 55,
    'Comercio emblemático': 52, Atracción: 45, 'Estudio de televisión': 45, Fuente: 40, Hospital: 35, Memorial: 35,
    Biblioteca: 32, Bomberos: 30, 'Campo de fútbol': 30, 'Arte urbano': 50, 'Lugar histórico': 30 };
  const SERVICIO = /^(Hospital|Bomberos|Biblioteca|Campo de fútbol|Estudio de televisión)$/;
  // trampas para turistas (museos del cannabis, eróticos, de ilusiones, de selfies…): puntúan menos y nunca son icónicas
  // nombres que son una dirección («House in carrer Rubió i Ors, 24», «Major 33», «Katharinenstraße 9»): un portal
  // catalogado vale menos que un sitio con nombre propio (Torre Gelabert, Can Tirel) cuando hay que elegir
  const DIRECCION = /^(former\s+)?(house|houses|building|buildings|habitatges?|cases?|casa|edificis?|edificio|vivienda|viviendas|immeuble|maison|haus|wohnhaus)( d'habitatges| de viviendas)? (in|at|on|al|a la|a l'|de la|del|en|dans|rue|in der)\b.*\d/i;
  const PORTAL_FIN = /^[\p{L}\s.'’-]{3,40}\s+\d{1,4}(?:[-–]\d{1,4})?(?:\s*\([^)]*\))?$/u;
  const NO_PORTAL = /\b(siglo|segle|s\.|nº|n\.|km|l[ií]nea|pabell[oó]n|pavell[oó]|torre|puerta|porta|puente|pont|plaza|pla[çc]a|parque|parc|teatr|muse|estadi|iglesia|esgl[eé]sia|castillo|castell|palacio|palau|estaci[oó]n|fort|bunker|gate|house no\.?|engine|mission)\b/i;
  const esDireccion = (n, kind) => DIRECCION.test(n) || (kind === 'Patrimonio' && PORTAL_FIN.test(n) && !NO_PORTAL.test(n));
  const TRAMPA = /(^|[^a-z])hash([^a-z]|$)|marihuana|marijuana|cannabis|er[oó]ti[ck]|sex museum|museo del sexo|selfie|museo de (la )?ilusi[oó]n|museum of illusions|upside ?down|museo de cera|wax museum|instagram/i;

  // ---------------- Uso e interés turístico ----------------
  // Usos que no son para visitar, por la clase de Wikidata (tags._uso) o por el nombre en varios idiomas: hoteles,
  // residencias, centros de salud, escuelas, polideportivos, oficinas, centros comerciales, aparcamientos.
  // Como carta normal restan puntos (a veces es un edificio histórico reutilizado); como imprescindible, nunca.
  // (por el nombre, solo lo inequívoco: «hôtel de …» en francés es un palacete —el Hôtel de Ville, los Invalides—;
  // el Liceu, el Pabellón Mies van der Rohe, The Mall, el General Post Office o el Cap de Creus NO son esto)
  const USO_RE = /(^|[^a-zà-ÿ])(hotel(?!\s+(?:(?:de|des|du)(?:\s|$)|d['’]))|hostal(?!\s+(de|dos|dels)\s)|resid[eè]ncia geri[aà]trica|residencia (de ancianos|geri[aà]trica|de mayores)|geri[aà]tric[a-zà-ÿ]*|nursing home|retirement home|centro de salud|centre de salut|centre d'atenció primària|ambulatori[a-zà-ÿ]*|salud mental|salut mental|escola (p[uú]blica|bressol)|escuela (infantil|primaria)|colegio p[uú]blico|ceip|primary school|high school|polideportiv[a-zà-ÿ]*|poliesportiu|pabell[oó]n (deportivo|polideportivo|municipal)|pavell[oó] (esportiu|poliesportiu|municipal)|complejo deportivo|complex esportiu|edificio de oficinas|office building|centro comercial|centre comercial|shopping center|shopping centre|aparcament|aparcamiento|parking)([^a-zà-ÿ]|$)/i;
  // un edificio histórico reutilizado (el Hostal dels Reis Catòlics de Santiago es hotel) no pierde su sitio
  const usoNoTuristico = (tags) => (!!tags._uso || USO_RE.test(tags.name || '')) && !((+tags._her || 0) >= 2 || (+tags._wp || 0) >= 15);
  // antigüedad (año de fundación de Wikidata): lo medieval o anterior a 1800 tiene más interés
  const antiguedad = (tags) => { const y = +tags.start_date; return !y ? 0 : y < 1500 ? 10 : y < 1800 ? 6 : 0; };
  // Interés turístico de un tipo de lugar (para los imprescindibles): lo que de verdad se visita, arriba
  const INTERES_TIPO = { Catedral: 25, Basílica: 20, Castillo: 20, Ruinas: 15, 'Ermita / Monasterio': 12, Palacio: 12, Museo: 10, Monumento: 10,
    'Torre / Puerta': 8, 'Zoo / Acuario': 8, Iglesia: 6, Templo: 6, Estadio: -15, Plaza: 12, Puente: 8, Mercado: 8, 'Calle emblemática': 8, 'Parque temático': 5, Teatro: 3, Faro: 3, Molino: 3,
    Parque: 2, Patrimonio: 0, Mirador: 0, Rascacielos: -10 };
  // Interés de un lugar como IMPRESCINDIBLE de su ciudad: fama (sitelinks) + protección + tipo + antigüedad.
  // Devuelve null si no puede ser imprescindible (uso no turístico, hospitales, estaciones, cementerios…).
  const MUST_NO = /^(Aeropuerto|Parada de tranvía|Hospital|Bomberos|Arte urbano|Memorial|Comercio emblemático|Biblioteca|Campo de fútbol)$/;
  const CEMENTERIO = /納骨|霊園|墓地|columbari|tanatori|crematori|cementeri|cementiri|cemetery|friedhof|cimeti[eè]re|cimitero|panteó|panteón/i;
  function interes(el) {
    const tags = el.tags || {}, c = clasificar(tags), nm = tags.name || '';
    const sl = +tags._wp || 0, her = tags._her != null ? +tags._her : tags.heritage ? 1 : 0;
    // (los cementerios famosos —la Recoleta, Père-Lachaise, Highgate— sí son imprescindibles)
    if (!c || MUST_NO.test(c.kind) || (CEMENTERIO.test(nm) && sl < 15)) return null;
    // estaciones: solo las que son Patrimonio de la Humanidad o famosísimas (Chhatrapati Shivaji, Grand Central, St Pancras)
    if (c.kind === 'Estación' && her < 3 && sl < 40) return null;
    // mercados: solo los históricos o famosos (la Boqueria, el Gran Bazar, el Mercado del Puerto)
    if (c.kind === 'Mercado' && !esPatrimonio(tags) && sl < 10) return null;
    // puentes: solo los conocidos
    if (c.kind === 'Puente' && !esPatrimonio(tags) && sl < 8) return null;
    // Estadios: cartas sí, pero imprescindible solo uno de fama mundial (Camp Nou, Bernabéu, el Nido de Pekín…). Ni los
    // artículos de Wikipedia ni sus visitas distinguen un estadio turístico de uno cualquiera (los inflan la liga y los
    // conciertos): salían estadios de primero en 226 de 500 ciudades.
    if (c.kind === 'Estadio' && sl < ESTADIO_MUST) return null;
    if (usoNoTuristico(tags) && c.kind !== 'Estadio') return null;
    if (TRAMPA.test(nm)) return null;   // (las trampas para turistas, nunca)
    const vis = +tags._vis > 10000 ? Math.min(20, Math.round(4 * Math.log2(+tags._vis / 10000))) : 0;   // visitantes al año
    // (una catedral pequeña —de otro rito, casi sin artículos— no suma como la catedral de la ciudad)
    const tipo = (c.kind === 'Catedral' || c.kind === 'Basílica') && sl < 10 ? 6 : (INTERES_TIPO[c.kind] || 0);
    // (la protección nacional pesa entera solo en lo conocido: en El Cairo, una madrasa de 8 Wikipedias dentro del sitio
    // UNESCO no puede quitarle el sitio a la mezquita de Muhammad Alí)
    const prot = her === 2 && sl < 15 ? 6 : [0, 4, 15, 30][Math.max(0, Math.min(3, her))];
    return { c, puntos: Math.round(10 * Math.log2(1 + sl)) + prot + tipo + antiguedad(tags) + vis + (tags._atr ? 6 : 0) + guiaPuntos(tags) };
  }
  const ESTADIO_MUST = 60;
  // lo recomiendan las guías de viaje (Wikivoyage, de 1 a 3 idiomas o más): la mejor señal de «merece la visita»
  const guiaN = (tags) => Math.max(0, Math.min(3, +tags._guia || 0));
  const guiaPuntos = (tags) => 8 * guiaN(tags);
  // visitas al año a su artículo de Wikipedia, inglés + español (solo la precarga las sabe): 1 000 → +2 · 10 000 → +7 · 100 000 → +13 · 1 millón o más → +20
  const lecturasPuntos = (tags) => (+tags._pv > 0 ? Math.min(20, Math.round(2 * Math.log2(1 + tags._pv / 1000))) : 0);
  // como mucho tantos imprescindibles de un mismo tipo (una lista de guía es variada: no cinco rascacielos ni tres estadios)
  // y ningún tipo pasa del 30 % de la lista (Montevideo tenía once «palacios», casi todos edificios de viviendas)
  const MUST_TOPE = { Estadio: 1, Rascacielos: 3, Teatro: 3, 'Zoo / Acuario': 2, Parque: 4, 'Parque temático': 1, Mercado: 2, Puente: 3, Catedral: 3, 'Calle emblemática': 2 };
  const topeMust = (list, kind, N) => {
    const n = list.filter((x) => x.kind === kind).length;
    return (MUST_TOPE[kind] != null && n >= MUST_TOPE[kind]) || n >= Math.max(3, Math.ceil((N || list.length + 1) * 0.3));
  };
  // ¿ya está en la lista? El mismo sitio dos veces (no lo que está al lado), y una ficha de conjunto junto a lo que contiene
  // («Conjunto arqueológico de Tarraco» y su anfiteatro, «Centre històric d'Split i Palau de Dioclecià» y el palacio)
  const CONJUNTO = /^(conjunto|conjunt|ensemble|complejo|centre hist[oò]ric|centro hist[oó]rico|casco (antiguo|hist[oó]rico)|historic cent(er|re))\b/i;
  function repetidoMust(list, pos, nm) {
    return list.some((x) => { const d = geo().dist(x.pos, pos); return d < 40 || (sameName(x.name, nm) && d < 400) || (norm(x.name) === norm(nm) && d < 1000) || (d < 150 && (CONJUNTO.test(x.name) || CONJUNTO.test(nm))); });
  }
  // Los imprescindibles de una ciudad: los N lugares de más interés dentro de su término (sin repetir el mismo sitio)
  function elegirImprescindibles(els, N) {
    const sc = [];
    for (const el of els) { const r = interes(el); if (r) sc.push({ el, r }); }
    sc.sort((a, b) => b.r.puntos - a.r.puntos || (a.el.id < b.el.id ? -1 : 1));
    const list = [];
    for (const { el, r } of sc) {
      const pos = [el.lat, el.lon], nm = el.tags.name;
      if (topeMust(list, r.c.kind, N)) continue;
      if (repetidoMust(list, pos, nm)) continue;
      list.push({ q: el.id, name: nm, pos, kind: r.c.kind, emoji: r.c.emoji, sl: el.tags._wp || 0, interes: r.puntos });
      if (list.length >= N) break;
    }
    return list;
  }

  // ---------------- Candidato: un elemento del mapa o de Wikidata → lugar con su puntuación (o por qué no) ----------------
  const NO_EVANG_DEN = /evangel|pentecost|baptist|adventist|jehovah|protestant|neo/i;
  const NO_EVANG_NAME = /[eé]vang[eèé]li|pentecost|bautista|baptist(?!er|[eè]re)|adventista|filad[eè]lfia|sal[oó]n del reino|kingdom hall|testigos de jehov|centro cristiano|comunidad cristiana|ministerio|iglesia de dios|asamblea de dios|cuerpo de cristo|betel|el shaddai|nueva vida|manantial de vida|fuente de vida|casa de oraci[oó]n|tabern[aá]culo|\belim\b/i;   // (con \b: si no, la mezquita de Yavuz Selim salía como evangélica)
  // (San Juan Bautista y los cuatro evangelistas son santos, no una confesión: se quitaban iglesias católicas de todo el mundo, como
  // la de San Juan Bautista de Pozuelo de Calatrava, Bien de Interés Cultural, o la románica de San Juan Evangelista de Arroyo)
  const SANTO_EVANG = /\b(juan|joan|john|johann(es)?|jean|giovanni|jan|jo[aã]o|ioan|mateo|matteo|matthew|matth[aä]us|marcos|marco|mark|markus|lucas|luca|luke|lukas)\b[\s-]+((el|the|il|o|de)[\s-]+)?(bautista|baptist[ae]?|battista|evangelist[ae]?)/gi;
  const nombreEvangelico = (n) => NO_EVANG_NAME.test(String(n || '').replace(SANTO_EVANG, ' '));
  function evangelica(tags) {
    return tags.amenity === 'place_of_worship' && (NO_EVANG_DEN.test(tags.denomination || '') || nombreEvangelico(tags.name));
  }
  const geo = () => PM.geo;
  function candidato(el) {
    const tags = el.tags || {};
    if (!tags.name || !String(tags.name).trim()) return { motivo: 'sin nombre' };   // solo lugares con nombre: más "coleccionables"
    // nombres que son una dirección («1166», «750 Seventh Avenue»): solo si son famosos de verdad
    if (/^\d+([\s\-–]|$)/.test(tags.name) && (tags._wp || 0) < 15) return { motivo: 'nombre de dirección' };
    const important = !!(tags.wikipedia || tags.wikidata || tags._wp || esPatrimonio(tags));
    if (/plaque|stolperstein|blue_plaque|bench/.test(tags.memorial || '') && !(tags.wikipedia || tags.wikidata || tags._wp)) return { motivo: 'placa sin artículo' };
    // hospitales y centros de salud (por su clase de Wikidata o por el nombre): no, salvo los históricos protegidos
    if ((tags._uso === 'salud' || /^(hospital|h[oô]pital|ospedale|krankenhaus|cl[ií]nica|clinic|sanatori)/i.test(tags.name)) && !(tags.tourism === 'museum') && !esPatrimonio(tags)) return { motivo: 'hospital' };
    // puentes: los conocidos o protegidos (no cada paso elevado con su artículo)
    // (lo añadido a mano, obligatorios.json, ya está revisado: no pasa por los filtros de fama —la Passarel·la de Cornellà—)
    const aMano = !!tags._oblig;
    if (tags.man_made === 'bridge' && !aMano && !esPatrimonio(tags) && (+tags._wp || 0) < 5) return { motivo: 'puente sin fama' };
    // iglesias evangélicas / pentecostales / testigos…: no (sí las demás religiones y templos del mundo)
    if (evangelica(tags)) return { motivo: 'iglesia evangélica' };
    if (/scientolog|dian[eé]tic/i.test(tags.name)) return { motivo: 'no es un lugar de interés' };   // (cienciología)
    if (CEMENTERIO.test(tags.name) && (+tags._wp || 0) < 8) return { motivo: 'cementerio o columbario sin fama' };   // (Père-Lachaise o la Recoleta, sí)
    const c = clasificar(tags);
    if (!c) return { motivo: 'no es un lugar del juego' };
    if (c.kind === 'Atracción' && !aMano && !(tags.wikipedia || tags.wikidata)) return { motivo: 'atracción sin artículo' };   // casi siempre ruido
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
    // parques y plazas: solo los emblemáticos (con artículo) compiten con monumentos; el resto, al final de la cola
    const green = c.kind === 'Parque' || c.kind === 'Plaza', ajuste = green && !wiki ? -28 : 0;
    // uso no turístico (hotel, residencia, escuela…): resta; lo antiguo: suma; visitantes al año y «atracción
    // turística» (de Wikidata): suman, como en una guía (no en los servicios: una biblioteca muy visitada sigue siéndolo)
    // (una biblioteca protegida se visita como el monumento que es: no es un servicio de barrio)
    const uso = usoNoTuristico(tags) ? -25 : 0, edad = antiguedad(tags), bibHist = c.kind === 'Biblioteca' && her >= 1, serv = SERVICIO.test(c.kind) && !bibHist;
    const vis = !serv && +tags._vis > 10000 ? Math.min(20, Math.round(4 * Math.log2(+tags._vis / 10000))) : 0, atr = !serv && tags._atr ? 8 : 0;
    const tipo = bibHist ? TIPO_GUIA.Patrimonio : TIPO_GUIA[c.kind] != null ? TIPO_GUIA[c.kind] : c.prio, trampa = TRAMPA.test(tags.name) ? -30 : 0, dir = esDireccion(tags.name, c.kind) ? -10 : 0;
    const guia = serv ? 0 : guiaPuntos(tags), lect = serv ? 0 : lecturasPuntos(tags), prot = [0, 4, 12, 30][her], prio = tipo + fame + prot + ajuste + uso + edad + vis + atr + trampa + dir + guia + lect;
    // La rareza sale de esa misma puntuación, con cortes fijos: es lo que hace que cada nivel signifique algo. Antes iba por tipo
    // de lugar y subía un nivel por tener ficha en Wikidata: en el mundo salían legendarios 6 de cada 10 lugares
    const rarity = her === 3 || prio >= CONF.RAREZA.legendario ? 'legendario' : prio >= CONF.RAREZA.epico ? 'epico' : prio >= CONF.RAREZA.raro ? 'raro' : 'comun';
    const lm = { id: el.type[0] + el.id, name: tags.name, kind: c.kind, emoji: c.emoji, rarity, pos, prio, fromWd: !!tags._wp, wp, her, wiki: tags.wikipedia, wd: tags.wikidata,
      texto: tags._txt || null, fuente: tags._fte || null, vis: +tags._vis || 0, anio: +tags.start_date || 0, arq: !!tags._arq, guia: guiaN(tags), pv: +tags._pv || 0, osm: tags._osm ? String(tags._osm).split(',') : null,
      desglose: { tipo, fama: fame, proteccion: prot, ajuste, uso, antiguedad: edad, visitantes: vis, atraccion: atr, trampa, direccion: dir, guia, lecturas: lect },
      inst: tags.amenity === 'university',   // (la institución, no un edificio: ver edificioDe)
      oblig: !!tags._oblig,   // (añadido a mano, scripts/pois/obligatorios.json: sale siempre; y must —imprescindible de su ciudad, lo marca quien lo sabe—, también)
      townhall: c.kind === 'Ayuntamiento', church: /^(Iglesia|Basílica|Catedral)$/.test(c.kind), points: 100 * RARITY[rarity].mult,
      // icónicos: SIEMPRE visibles, sin separación mínima ni cupo de zona: ayuntamiento, catedral, basílica, castillo,
      // estación histórica, Patrimonio de la Humanidad o nacional, lo famoso de verdad (12+ idiomas) y los palacios,
      // museos, estadios, zoos, parques temáticos y monasterios con artículo en 5+ idiomas. El resto compite por su
      // sitio con cupo por zona y por tipo (seleccionar).
      principal: !!tags._oblig || c.kind !== 'Comercio emblemático' && !trampa && (/^(Ayuntamiento|Catedral|Basílica|Castillo)$/.test(c.kind) || (c.kind === 'Estación' && (her >= 2 || wp >= 5))
        || her === 3 || (her === 2 && wp >= 4) || (wp >= 12 && (c.kind !== 'Rascacielos' || wp >= 25))   // (rascacielos: solo los famosos en todo el mundo)
        || (/^(Palacio|Museo|Estadio|Zoo \/ Acuario|Parque temático|Ermita \/ Monasterio)$/.test(c.kind) && wp >= 5)),
      capR: Math.max(capRadius(c.kind, c.kind === 'Aeropuerto' ? (wp >= 30 ? 'grande' : '') : wiki || wp >= 2), capDeLado(tags._lado)) };
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
  const ES = { museu: 'museo', poble: 'pueblo', espanyol: 'espanol' };   // (el mapa da el nombre local y Wikidata en español: «Museu Fran Daurel» / «Museo Fran Daurel»)
  const LAT = { 'ł': 'l', 'ø': 'o', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ı': 'i', 'đ': 'd', 'þ': 'th' };
  const normMemo = new Map();   // (cada nombre se normaliza una sola vez: la selección compara miles)
  const norm = (s) => {
    s = String(s || ''); let r = normMemo.get(s);
    // (las letras de cualquier alfabeto se quedan: antes solo a-z, y «清水寺» o «Храм…» quedaban vacíos —dos templos distintos
    // parecían el mismo—; y las latinas que no se descomponen se igualan: ł→l, ø→o, ß→ss… —informe de Gemini (2)—)
    if (r === undefined) { r = s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[łøßæœıđþ]/g, (c) => LAT[c]).replace(/\b(de|del|la|el|les|los|las|dels|of|the|le|du|di|della)\b/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\b(museu|poble|espanyol)\b/g, (w) => ES[w]).trim(); if (normMemo.size > 20000) normMemo.clear(); normMemo.set(s, r); }
    return r;
  };
  // ¿este nombre es otra ciudad que la que ya conocíamos? (Córdoba, Valencia, San Fernando: hay varias en el mundo)
  function otraCiudad(prev, q, bb) {
    if (!prev) return false;
    if (prev.q && q) return prev.q !== q;
    const b = prev.bbox;
    return !b || b[0] > bb[2] || b[2] < bb[0] || b[1] > bb[3] || b[3] < bb[1];
  }
  // (por palabras enteras: «Santa Ana» está en «Santa Ana Vieja», no en «Santa Anastasia»)
  const contenido = (x, y) => (' ' + y + ' ').includes(' ' + x + ' ');
  function sameName(a, b) { a = norm(a); b = norm(b); return !!a && !!b && (a === b || (a.length > 5 && contenido(a, b)) || (b.length > 5 && contenido(b, a))); }

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
  // el tipo sin matices: la «Iglesia principal» del mapa y la «Iglesia» de Wikidata son lo mismo, y también el «Patrimonio»
  // que se llama iglesia (salían dos círculos en la misma iglesia, en Cornellà y en Esplugues)
  const tipoBase = (x) => { const k = x.kind.replace(' principal', ''); return k === 'Patrimonio' && /^(iglesia|esgl[eé]sia|parroquia|parr[oò]quia|bas[ií]lica|catedral)\b/i.test(x.name) ? 'Iglesia' : k; };
  const sameN = (a, b) => { const x = a._n, y = b._n; return !!x && !!y && (x === y || (x.length > 5 && contenido(x, y)) || (y.length > 5 && contenido(y, x))); };
  // La institución y su edificio con el mismo nombre (la Universidad Estatal de Moscú y el «Edificio principal de la
  // Universidad Estatal de Moscú», a 62 m): la carta es el edificio, que es lo que se visita; una universidad como institución
  // no es un lugar. Antes la regla de «mismo nombre» se quedaba con la institución, que tenía más puntos, y quitaba el
  // edificio (auditoría v0.9.25, ML-01). Devuelve institución → edificio
  function edificioDe(cands) {
    const out = new Map();
    for (const u of cands) {
      if (!u.inst) continue;
      prep(u);
      let mejor = null;
      for (const o of cands) {
        // (solo un EDIFICIO: el estadio, el museo o la iglesia «de la Universidad X» son otra cosa —la Universidad de San Marcos de
        // Lima le pasaba su carta a su estadio—)
        if (o === u || o.inst || !/^(Patrimonio|Palacio|Rascacielos)$/.test(o.kind)) continue;
        prep(o);
        if (d2(o, u) < 90000 && sameN(o, u) && o.prio >= u.prio - 40 && (!mejor || o.prio > mejor.prio)) mejor = o;
      }
      if (mejor) out.set(u, mejor);
    }
    return out;
  }
  function seleccionar(cands, ctx) {
    const isCap = ctx.isCap || (() => false), zona = ctx.zona, C = CONF;
    const why = new Map(), byId = (x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
    // lo que se decide en cada pasada se recalcula desde cero (tipo heredado del mapa, iglesia principal)
    // (y el enlace a Wikidata de un candidato del mapa vuelve al suyo: el de la pasada anterior no puede decidir esta)
    for (const lm of cands) {
      if (lm._spec) { lm.kind = 'Patrimonio'; lm.emoji = lm._spec; delete lm._spec; }
      if (!lm.fromWd) { if (!('_wd0' in lm)) lm._wd0 = lm.wd || null; lm.wd = lm._wd0; }
      if (lm._mustEd) { delete lm.must; delete lm._mustEd; }
      if (lm._obligEd) { delete lm.oblig; delete lm._obligEd; }
      prep(lm);
    }
    iglesiasPrincipales(cands);
    const cap = new Map(); for (const lm of cands) cap.set(lm, !!isCap(lm));
    const all = cands.slice().sort((x, y) => (cap.get(y) - cap.get(x)) || (((y.oblig || y.must) ? 1 : 0) - ((x.oblig || x.must) ? 1 : 0)) || (y.principal - x.principal) || (y.prio - x.prio) || byId(x, y));
    const G = C.GRID, ck = (i, j) => i * 1e6 + j;
    const gridAdd = (M, lm) => { const k = ck(Math.floor(lm.pos[0] / G), Math.floor(lm.pos[1] / G)); const L0 = M.get(k); if (L0) L0.push(lm); else M.set(k, [lm]); };
    // recorre los vecinos a menos de maxM metros hasta que fn devuelva algo. (Las celdas encogen de este a oeste con la
    // latitud: antes se miraba un número fijo de celdas y en Barcelona se escapaban duplicados a 269 m de los 300 que se
    // miran, y en Oslo la separación de 100 m del ayuntamiento —informe de Gemini (2), 20-nov-2026—)
    const near = (M, q, maxM, fn) => {
      const ci = Math.floor(q.pos[0] / G), cj = Math.floor(q.pos[1] / G);
      const ri = Math.ceil(maxM / (G * 111320)), rj = Math.ceil(maxM / (G * 111320 * Math.max(0.05, Math.cos(q.pos[0] * Math.PI / 180))));
      for (let i = -ri; i <= ri; i++) for (let j = -rj; j <= rj; j++) { const L0 = M.get(ck(ci + i, cj + j)); if (L0) for (const o of L0) { const v = fn(o); if (v) return v; } }
      return null;
    };
    // 1) lo de Wikidata que es el MISMO sitio que algo del mapa (mismo Q, mismo tipo cerca o nombre parecido; no
    //    cualquier cosa a 40 m): se queda uno
    const osmGrid = new Map(), drop = new Map(), mapaId = new Map(), dup = new Map();   // id → motivo · dup: id → id del que se queda (es el mismo sitio)
    for (const o of all) if (!o.fromWd) { gridAdd(osmGrid, o); mapaId.set(o.id, o); }
    // enlace exacto (la precarga sabe qué objetos del mapa son cada lugar de Wikidata): se anota antes de comparar nada (gana el de mayor prioridad)
    for (const lm of all) if (lm.fromWd && lm.osm) for (const id of lm.osm) { const o = mapaId.get(id); if (o && !o.wd) o.wd = lm.wd; }
    for (const lm of all) {
      if (!lm.fromWd) continue;
      const same = (lm.osm || []).map((id) => mapaId.get(id)).filter((o) => o && !drop.has(o.id)), close = [];
      near(osmGrid, lm, 300, (o) => {
        if (drop.has(o.id)) return;
        if (o.wd) { if (o.wd === lm.wd && !same.includes(o)) same.push(o); return; }   // (enlazado a otro lugar: es otra cosa, aunque esté al lado)
        const dd = d2(o, lm); if ((tipoBase(o) === tipoBase(lm) && dd < 3600) || (dd < 90000 && sameN(o, lm))) close.push(o);
      });
      if (same.length) {
        // seguro que es el mismo: se queda la versión de Wikidata (sabe más), salvo que ya conquistaras la del mapa
        const capS = same.find((o) => cap.get(o));
        if (capS && !cap.get(lm)) { drop.set(lm.id, 'duplicado de ' + capS.name + ' (ya conquistado)'); continue; }
        same.forEach((o) => { if (!cap.get(o)) { drop.set(o.id, 'duplicado de ' + lm.name + ' (mismo Wikidata)'); dup.set(o.id, lm.id); } });
        const spec = same.filter((o) => o.kind !== 'Patrimonio').sort((x, y) => y.prio - x.prio || (x.id < y.id ? -1 : 1))[0];
        if (lm.kind === 'Patrimonio' && spec) { lm._spec = lm.emoji; lm.kind = spec.kind; lm.emoji = spec.emoji; }
        continue;
      }
      // el mismo sitio (mismo tipo cerca o nombre parecido): se queda la versión con mejor puntuación (la de Wikidata
      // suele saber más: fama, protección). Cosas distintas casi encima (estatua ante una iglesia): las dos (luego decide
      // la separación mínima)
      if (!close.length) continue;
      // si ya conquistaste la versión del mapa, se queda esa (antes salían las dos: «Ajuntament» y «casa consistorial»)
      const capO = close.find((o) => cap.get(o));
      if (capO && !cap.get(lm)) { drop.set(lm.id, 'duplicado de ' + capO.name + ' (ya conquistado)'); continue; }
      // (un lugar añadido a mano gana siempre a sus copias del mapa: antes, si la del mapa tenía Wikipedia, se perdía el
      // obligatorio con su texto y su fuente —«Cornellà canta a Estopa», informe de Gemini (2)—)
      if (lm.oblig || (close.every((o) => !o.wd && !o.wiki) && lm.prio >= Math.max(...close.map((o) => o.prio)))) {
        close.forEach((o) => { if (!cap.get(o)) { drop.set(o.id, 'duplicado de ' + lm.name + ' (Wikidata sabe más)'); dup.set(o.id, lm.id); } });
        // Wikidata solo sabe que es «patrimonio» y el mapa dice qué es (el Alcázar de Toledo, un castillo): ese tipo
        const spec = close.filter((o) => o.kind !== 'Patrimonio' && o._n && o._n === lm._n).sort((x, y) => y.prio - x.prio || (x.id < y.id ? -1 : 1))[0];
        if (lm.kind === 'Patrimonio' && spec) { lm._spec = lm.emoji; lm.kind = spec.kind; lm.emoji = spec.emoji; }
      } else if (!cap.get(lm)) {
        const bestO = close.slice().sort((x, y) => (y.prio - x.prio) || byId(x, y))[0];
        drop.set(lm.id, 'duplicado de ' + bestO.name + ' (del mapa)'); dup.set(lm.id, bestO.id);
      }
    }
    // 1b) la institución con su edificio al lado (mismo nombre): sale el edificio, con la estrella de imprescindible si la tenía
    for (const [u, ed] of edificioDe(all.filter((x) => !drop.has(x.id)))) {
      if (cap.get(u)) continue;   // (ya conquistada: se queda)
      drop.set(u.id, 'es la institución: sale su edificio, ' + ed.name); dup.set(u.id, ed.id);
      if (u.must && !ed.must) { ed._mustEd = true; ed.must = true; }
      if (u.oblig && !ed.oblig) { ed._obligEd = true; ed.oblig = true; }
    }
    // 2) de más importante a menos: cada uno entra si no tiene otro ya elegido demasiado cerca y queda cupo
    //    (los icónicos entran siempre y no se tapan entre ellos; lo conquistado, siempre)
    const kept = new Map(), keep = new Set(), zoneN = {}, kindN = {}, iconN = {}, allN = {}, iconKindN = {};
    const sq = (m) => m * m, th2 = sq(C.TOWNHALL_GAP), sh2 = sq(C.SHOP_GAP);
    const deGuia = (lm) => lm.prio >= C.DE_GUIA || lm.guia > 0;
    // centros históricos: las zonas con muchos lugares de guía (contados antes de elegir, sin los duplicados)
    // (y cuántos candidatos hay de cada tipo en cada zona: el cupo de tipo es para que haya variedad, y solo actúa si los
    // demás tipos pueden llenar la zona. En Cornellà casi todo es patrimonio catalogado —masías, fábricas— y el cupo dejaba
    // fuera Can Tirel o Can Vallhonrat sin nada que ocupara su sitio: el usuario, 20-nov-2026)
    const guiaZ = {}, candZ = {}, candK = {};
    for (const lm of all) {
      if (drop.has(lm.id)) continue;
      const z = zona(lm.pos);
      if (deGuia(lm) || lm.principal) guiaZ[z] = (guiaZ[z] || 0) + 1;
      if (lm.kind !== 'Comercio emblemático' && !lm.principal) { const k = z + '|' + lm.kind.replace(' principal', ''); candZ[z] = (candZ[z] || 0) + 1; candK[k] = (candK[k] || 0) + 1; }
    }
    for (const lm of all) {
      if (drop.has(lm.id)) { why.set(lm.id, drop.get(lm.id)); continue; }
      const zk = zona(lm.pos), kk = zk + '|' + lm.kind.replace(' principal', ''), isC = cap.get(lm);
      const hist = (guiaZ[zk] || 0) >= C.HIST_MIN, zq = hist ? C.HIST_ZONE_QUOTA : C.ZONE_QUOTA, zmax = hist ? C.HIST_ZONE_MAX : C.ZONE_MAX;
      // (pasado el tope, compite como los demás; lo famoso en todo el mundo, 15+ idiomas, entra siempre: el Arco de Tito)
      const icon = lm.oblig || lm.must || (lm.principal && (((iconN[zk] || 0) < C.ICON_MAX && (iconKindN[kk] || 0) < C.ICON_KIND_MAX) || lm.wp >= C.WORLD_FAMOUS));   // (lo añadido a mano, sin cupos)
      const shop = lm.kind === 'Comercio emblemático';
      // lo importante aparece siempre: desde 110 puntos, sin cupos ni separación (como los icónicos, pero contando cupo)
      const imp = icon || lm.prio >= C.IMPORTANTE;
      // (lo de guía no se queda fuera por cupos: «no te dejes nada importante», el usuario, 20-nov-2026. Los servicios —una
      // biblioteca, un mercado de barrio— siguen con su cupo)
      // (una biblioteca protegida es un monumento: la Casanatense. Y con techo: en el km² más denso del mundo —las tumbas
      // de Luxor, el centro de Roma— salían 200-300 cartas, una cada 60 m; entran las HIST_TECHO mejores)
      // de guía de verdad); lo que cita una guía de viaje entra siempre
      const noServ = !SERVICIO.test(lm.kind) || (lm.kind === 'Biblioteca' && lm.her >= 1);
      const sinCupo = imp || (noServ && (lm.guia > 0 || (deGuia(lm) && (allN[zk] || 0) < C.HIST_TECHO)));
      if (!isC) {
        if (!sinCupo && ((zoneN[zk] || 0) >= zq || (allN[zk] || 0) >= zmax) && !shop) { why.set(lm.id, 'zona completa (' + ((allN[zk] || 0) >= zmax ? zmax + ' en total' : zq + ' normales') + ')'); continue; }
        const serv = SERVICIO.test(lm.kind) && !(lm.kind === 'Biblioteca' && lm.her >= 1), kq = serv ? C.SERVICE_QUOTA : shop ? C.SHOP_QUOTA : hist ? C.HIST_KIND_QUOTA : C.KIND_QUOTA;
        // (sin variedad posible —aunque entraran todos los de otros tipos sobraría sitio—, el patrimonio catalogado con nombre
        // propio no tiene cupo de tipo: no quita el sitio a ningún parque, teatro o mercado, que caben todos)
        const catalogado = lm.her >= 1 && !(lm.desglose && lm.desglose.direccion);
        const variedad = serv || shop || !catalogado || (kindN[kk] || 0) + (candZ[zk] || 0) - (candK[kk] || 0) >= zq;
        if (!sinCupo && variedad && (kindN[kk] || 0) >= kq) { why.set(lm.id, 'ya hay ' + kq + ' de su tipo en la zona'); continue; }
        // lo flojo solo rellena zonas con poco (en el Gòtic no hace falta; en un barrio sin monumentos, sí)
        if (!imp && !shop && lm.prio < C.RELLENO && (allN[zk] || 0) >= C.RELLENO_HASTA) { why.set(lm.id, 'poco interés para una zona que ya tiene ' + (allN[zk] || 0) + ' lugares'); continue; }
        // varios edificios del mismo sitio (TV3…): uno (un obligatorio/imprescindible no cae por nombre parecido, salvo duplicado idéntico < 80 m)
        if (near(kept, lm, 300, (o) => (o.name === lm.name && d2(o, lm) < 6400) || (!lm.oblig && !lm.must && (o.name === lm.name || (o.kind === lm.kind && sameN(o, lm))) && d2(o, lm) < (o.kind === lm.kind ? 90000 : 6400)))) { why.set(lm.id, 'mismo nombre que otro ya elegido'); continue; }
        if (lm.kind === 'Estación' && !lm.wiki && !lm.wd) {
          const parque = (o) => o.kind === 'Parque' && d2(o, lm) < 250000 && sameN(o, lm);
          if (near(osmGrid, lm, 500, parque) || near(kept, lm, 500, parque)) { why.set(lm.id, 'estación que se llama como el parque'); continue; }
        }
        // separación (60 m) solo para el relleno: lo que tiene interés de guía (75+) sale aunque tenga otro al lado
        if (!imp && lm.prio < C.SIN_SEPARACION) {
          // (lo famoso y el patrimonio catalogado con nombre propio pueden estar a 35 m: en un casco antiguo los edificios
          // catalogados van pegados —Can Vallhonrat junto al Ayuntamiento de Cornellà— y se conquistan por separado)
          const cerca = lm.wp >= 8 || (lm.her >= 1 && !(lm.desglose && lm.desglose.direccion)), gap2 = sq(cerca ? C.FAMOUS_GAP : C.MIN_GAP);
          const vecino = near(kept, lm, C.TOWNHALL_GAP, (o) => (d2(o, lm) < (o.townhall && !cerca ? th2 : shop || o.kind === 'Comercio emblemático' ? sh2 : gap2)) && o);
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
    return { keep, why, dup };
  }

  PM.capRadius = capRadius;
  // Una carta ya conquistada con un tipo que su nombre contradice (de cuando cualquier nombre con «Catedral» era una
  // catedral): se corrige el tipo y la rareza (los puntos ganados no se tocan). Devuelve los cambios o null.
  function revisarRegistro(r) {
    if (!r || !r.name || !/^(Catedral|Basílica|Iglesia|Templo|Castillo|Palacio)$/.test(r.kind || '') || !NO_POR_NOMBRE.test(r.name)) return null;
    const n = r.name;
    if (/^(museo|museu|museum|mus[eé]e)/i.test(n)) return { kind: 'Museo', emoji: '🖼️', rarity: 'raro' };
    if (/^(plaza|pla[çc]a|piazza|place )/i.test(n)) return { kind: 'Plaza', emoji: '🏙️', rarity: 'raro' };
    if (/^(mercado|mercat)/i.test(n)) return { kind: 'Mercado', emoji: '🛒', rarity: 'comun' };
    return { kind: 'Patrimonio', emoji: '🏛️', rarity: 'comun' };
  }

  // Una carta conquistada de algo que el motor ya no pone (universidad, hospital o bomberos que no son patrimonio,
  // iglesia evangélica, hotel, metro, trampa para turistas…): se quita del álbum (los puntos ganados no se tocan).
  // Devuelve 'quitar', unos cambios (una universidad histórica pasa a «Patrimonio») o null si sigue vigente.
  function vigencia(r) {
    if (!r || !r.name) return null;
    const n = r.name;
    // (lo que no depende de si es patrimonio: siempre)
    if (/^(Iglesia|Iglesia principal|Templo)$/.test(r.kind || '') && nombreEvangelico(n)) return 'quitar';
    if (r.kind === 'Estación' && /(^|[^a-zà-ÿ])metro([^a-zà-ÿ]|$)/i.test(n)) return 'quitar';
    if (TRAMPA.test(n)) return 'quitar';
    const dudoso = r.kind === 'Universidad' || r.kind === 'Hospital' || r.kind === 'Bomberos' || r.kind === 'Estación' || USO_RE.test(n) || (UNI_NAME.test(n) && !UNI_OTRO.test(n));
    if (!dudoso) return null;
    // las cartas antiguas no guardaban si eran patrimonio: sin ese dato no se decide aquí ('dudosa': lo decide el mapa,
    // mirando si el lugar sigue en el motor cuando los datos de su zona están completos)
    if (r.her == null) return 'dudosa';
    const her = +r.her || 0, wp = +r.wp || 0, viejo = (+r.anio || 9999) < 1800;
    if (r.kind === 'Universidad' || (UNI_NAME.test(n) && !UNI_OTRO.test(n))) return her >= 1 || (viejo && wp >= 15) ? (r.kind === 'Patrimonio' ? null : { kind: 'Patrimonio', emoji: '🏛️', rarity: 'raro' }) : 'quitar';
    // (solo las históricas de verdad o de arquitecto conocido con 10+ idiomas; sin año guardado lo decide el mapa con los datos nuevos)
    if (r.kind === 'Estación') return her >= 2 || (+r.anio || 9999) < 1930 || wp >= 15 || (r.arq && wp >= 10) ? null : !r.anio ? 'dudosa' : 'quitar';
    if (r.kind === 'Hospital' || r.kind === 'Bomberos') return her >= 1 ? { kind: 'Patrimonio', emoji: '🏛️', rarity: 'raro' } : 'quitar';
    return her < 2 && wp < 15 ? 'quitar' : null;   // (hotel, oficinas…: salvo un edificio histórico reutilizado)
  }
  // ¿Es el mismo sitio? (una carta conquistada con el identificador de otra fuente o de una versión anterior, y el lugar
  // que llega ahora: la iglesia de la Gavarra salía dos veces, la conquistada dentro del edificio y otra en la calle)
  const GRUPO = (k) => (/^(Iglesia|Iglesia principal|Catedral|Basílica|Templo|Ermita \/ Monasterio)$/.test(k || '') ? 'templo' : k || '');
  const GEN = new Set(('iglesia esglesia església parroquia parròquia parroquial capilla capella ermita santuario santuari convento convent monasterio monestir ' +
    'catedral basilica basílica templo temple church chapel cathedral saint sant santa santo san nuestra senora señora mare deu museo museu museum ' +
    'plaza plaça place parque parc park fuente font palacio palau castillo castell torre').split(' '));
  // (en chino, japonés o coreano una palabra de 2-3 signos ya es un nombre propio: 清水寺)
  const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
  const palabras = (t) => norm(t).split(' ').filter((w) => (w.length > 3 || (w.length >= 2 && CJK.test(w))) && !GEN.has(w));
  const sinLatin = (t) => { const x = norm(t); return !!x && !/[a-z]/.test(x); };
  function mismoSitio(a, b) {
    if (!a || !b || !a.pos || !b.pos) return false;
    const d = geo().dist(a.pos, b.pos);
    if (d < 250 && sameName(a.name, b.name)) return true;
    if (GRUPO(a.kind) !== GRUPO(b.kind)) return false;
    if (d < 60) return true;
    const pa = palabras(a.name), pb = new Set(palabras(b.name));
    return d < 150 && pa.some((w) => pb.has(w));
  }
  // ¿Dos cartas son la MISMA, o una carta es este lugar? Más estricto que mismoSitio, porque aquí se junta o se traslada una
  // carta conquistada: dos fichas distintas de Wikidata son dos sitios, y a menos de 60 m hay sitios distintos del mismo tipo
  // (la Casa Batlló y la Casa Amatller; dos iglesias en una misma plaza de Roma). Con dos nombres con palabras propias
  // que no se parecen en nada, tampoco.
  function mismaCarta(a, b) {
    if (!mismoSitio(a, b)) return false;
    if (a.wd && b.wd) return a.wd === b.wd;
    if (sameName(a.name, b.name)) return true;
    const pa = palabras(a.name), pb = new Set(palabras(b.name));
    // (sin palabras propias en uno de los dos —«Iglesia»—, como siempre: la misma. Pero si alguno está en otro alfabeto, sus
    // nombres distintos dicen que son dos sitios distintos: antes se juntaban dos templos de Kioto a 38 m)
    if (!pa.length || !pb.size) return !(sinLatin(a.name) || sinLatin(b.name));
    return pa.some((w) => pb.has(w));
  }

  // ¿Esta carta (id y registro) es este imprescindible de la lista? Los lugares de Wikidata tienen id «nQ123». Si la que
  // conquistaste es la versión del mapa, su nombre y su tipo pueden ser otros («Temple Expiatori» / «Templo del Sagrado
  // Corazón», «Patrimonio» / «Palacio»): sin esto perdía la estrella.
  function esMust(e, id, r) {
    if (e.q === id || 'n' + e.q === id || e.q === r.wd) return true;
    if (!r.pos) return false;
    if (sameName(e.name, r.name) && geo().dist(e.pos, r.pos) < 400) return true;
    return !(r.wd && r.wd !== e.q) && mismoSitio(e, r);   // (otra ficha de Wikidata es otro sitio, por cerca que esté)
  }
  // qué lugar del mapa es cada imprescindible de la lista: el mismo de Wikidata, el mismo nombre o el importante que hay justo ahí
  function matchMust(e, lms) {
    let best = lms.find((lm) => lm.wd === e.q || lm.id === 'n' + e.q);
    if (best) return best;
    let bd = 1e9;
    for (const lm of lms) { const d = geo().dist(lm.pos, e.pos); if (d < 400 && d < bd && sameName(lm.name, e.name)) { bd = d; best = lm; } }
    if (best) return best;
    bd = 80;
    // (lo que tiene su propia ficha de Wikidata es otro sitio: la estrella de la Casa Batlló no puede caer en la Casa Amatller)
    for (const lm of lms) { const d = geo().dist(lm.pos, e.pos); if (d < bd && !(lm.wd && lm.wd !== e.q) && (lm.wiki || lm.wp || mismoSitio(e, lm)) && !MUST_NO.test(lm.kind)) { bd = d; best = lm; } }
    return best || null;
  }

  PM.lugares = { RARITY, RANK, CONF, MUST_NO, TIPO_GUIA, SERVICIO, edificioDe, porQue, revisarRegistro, vigencia, mismoSitio, mismaCarta, esMust, matchMust, clasificar, candidato, evangelica, seleccionar, interes, elegirImprescindibles, topeMust, repetidoMust, otraCiudad, esUniversidad, usoNoTuristico, sameName, norm, capRadius };
})(typeof window !== 'undefined' ? window : globalThis);
