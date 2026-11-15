// PintaMapa — cartas coleccionables: anverso con la foto a sangre, el nombre, el tipo con su color, los puntos, por qué merece
// la pena y su historia; reverso con el sello de conquista; holograma por capas (más cuanto más rara) que sigue al ratón o a la
// inclinación del móvil; se voltea al tocarla. Se usa en la app y en «Mi progreso».
PM.tcg = (function () {
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // El nombre de la carta NUNCA se corta (petición del usuario, 13-nov-2026: salía «Torre de telecomunicaciones de…»). Se
  // calcula el tamaño de letra por su longitud, simulando el salto de línea palabra a palabra: en 2 líneas si cabe sin
  // bajar mucho la letra; si no, en 3. Como depende solo del texto, sale igual en la carta grande, en las miniaturas del
  // álbum y en la imagen para compartir. porLinea = letras que caben en una línea con la letra a tamaño normal.
  function lineasDe(txt, cabe) {
    let n = 1, ancho = 0;
    for (const w of String(txt).split(/\s+/).filter(Boolean)) {
      if (w.length > cabe) return 99;   // (una palabra que no cabe ni sola: hay que bajar la letra)
      if (!ancho) ancho = w.length; else if (ancho + 1 + w.length <= cabe) ancho += 1 + w.length; else { n++; ancho = w.length; }
    }
    return n;
  }
  function tamTitulo(txt, porLinea) {
    for (const [lineas, desde, hasta] of [[2, 1, 0.74], [3, 0.9, 0.5]]) {
      for (let k = desde; k >= hasta - 1e-9; k -= 0.02) if (lineasDe(txt, porLinea / k) <= lineas) return +k.toFixed(2);
    }
    return 0.5;
  }
  // (una foto de Commons con apóstrofo —«Sant Pere d'Or.jpg»— rompía el url('…') y la carta salía sin foto)
  const cssUrl = (u) => String(u).replace(/'/g, '%27').replace(/\\/g, '%5C');

  // "Tipos" según la clase de sitio: color de la carta y orbe
  // (v0.9.15: colores vivos, «de dopamina»: t1/t2 = degradado del tipo; c1/c2 = el panel claro de abajo; ic = su símbolo)
  const TYPES = {
    ayto:     { name: 'Gobierno',  ic: '🏛️', t1: '#ffb300', t2: '#ff5e00', c1: '#fff8e1', c2: '#ffe2a8', orb: '#e0a400', kinds: ['Ayuntamiento'] },
    templo:   { name: 'Espíritu',  ic: '🕊️', t1: '#a855f7', t2: '#ec4899', c1: '#f7efff', c2: '#ecd6ff', orb: '#8b5cf6', kinds: ['Iglesia', 'Iglesia principal', 'Basílica', 'Catedral', 'Templo', 'Ermita / Monasterio'] },
    historia: { name: 'Historia',  ic: '🏰', t1: '#f97316', t2: '#b45309', c1: '#fff3e6', c2: '#fbd9b4', orb: '#a16207', kinds: ['Castillo', 'Palacio', 'Patrimonio', 'Molino', 'Monumento', 'Torre / Puerta', 'Puente', 'Ruinas', 'Lugar histórico', 'Memorial'] },
    cultura:  { name: 'Cultura',   ic: '🎭', t1: '#06b6d4', t2: '#3b5bf6', c1: '#eaf8ff', c2: '#c4e6ff', orb: '#2563eb', kinds: ['Museo', 'Teatro', 'Biblioteca', 'Universidad', 'Estudio de televisión'] },
    deporte:  { name: 'Deporte',   ic: '⚽', t1: '#ff3d3d', t2: '#ff9a1f', c1: '#fff0ec', c2: '#ffd0c4', orb: '#e53e1f', kinds: ['Estadio', 'Campo de fútbol'] },
    verde:    { name: 'Naturaleza', ic: '🌿', t1: '#22c55e', t2: '#0d9488', c1: '#ecfbf1', c2: '#c3f0d4', orb: '#16a34a', kinds: ['Parque', 'Mirador', 'Zoo / Acuario'] },
    ciudad:   { name: 'Ciudad',    ic: '🏙️', t1: '#6366f1', t2: '#0ea5e9', c1: '#eef1ff', c2: '#d3dcff', orb: '#64748b', kinds: ['Parque temático', 'Rascacielos', 'Aeropuerto', 'Estación', 'Plaza', 'Mercado', 'Calle emblemática'] },
  };
  const typeOf = (kind) => Object.entries(TYPES).find(([, t]) => t.kinds.includes(kind)) || ['ciudad', TYPES.ciudad];
  const RAR = { comun: { sym: '●', name: 'Común', holo: 0.15 }, raro: { sym: '◆', name: 'Rara', holo: 0.45 }, epico: { sym: '★', name: 'Épica', holo: 0.8 }, legendario: { sym: '★★', name: 'Legendaria', holo: 1 } };
  const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };

  // Descripción del sitio: IGUAL PARA TODOS (sin datos personales) y SIEMPRE de ese lugar en concreto: el texto de
  // Wikipedia y, si no hay, frases con sus datos reales (descripción de Wikidata, barrio y ciudad, siglo, patrimonio,
  // visitantes). Nunca frases de plantilla iguales para todas las cartas. Entera, sin cortar: el tamaño de la letra se
  // ajusta al cuadro (fitClass).
  const ROM = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI'];
  const cap1 = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const T = (s, v) => (PM.t ? PM.t(s, v) : s);   // (todo en el idioma elegido)
  const num = (x, dec) => x.toLocaleString(PM.LOCALE || 'es-ES', { maximumFractionDigits: dec || 0 });
  function datos(d) {
    const out = [], her = +d.her || 0, y = +d.anio || 0, vis = +d.vis || 0;   // (lo que se sabe del SITIO; lo del motor de lugares, como en cuántas Wikipedias está, no va en la carta)
    if (her === 3) out.push(T('Es Patrimonio de la Humanidad por la UNESCO.'));
    else if (her === 2) out.push(T('Está protegido como patrimonio nacional.'));
    else if (her === 1) out.push(T('Está catalogado como patrimonio protegido.'));
    if (y > 0 && y < 1800) { const sg = Math.floor((y - 1) / 100) + 1; out.push(T('Data del siglo {s}.', { s: ROM[sg] || sg })); }
    else if (y >= 1800) out.push(T('Es de {y}.', { y }));
    if (vis >= 1e6) out.push(T('Recibe unos {n} millones de visitantes al año.', { n: num(vis / 1e6, 1) }));
    else if (vis >= 20000) out.push(T('Recibe unos {n} mil visitantes al año.', { n: num(Math.round(vis / 1000)) }));
    return out;
  }
  // para no repetir lo que el texto ya dice (en cualquiera de los cuatro idiomas)
  const YA = {
    her: /patrimoni|unesco|bien de inter[eé]s|b[eé] cultural|monumento nacional|monument historique|heritage|protegi|prot[eé]g|listed/i,
    vis: /visitantes|visitas|visitants|visites|visitors|visiteurs/i,
    any: /siglo|segle|si[eè]cle|century|\b1\d{3}\b|\b20\d{2}\b/i,
  };
  function descText(d) {
    let t = String(d.text || '').replace(/\s*\([^)]*\)/g, '').replace(/\s*\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
    // (un texto guardado recortado a media frase —«…de Josep Llimona, Antoni…»— se deja en su última frase completa)
    t = t.replace(/([.!?])s*(…|...)$/, '$1');   // («…Provincial.…»: la frase ya estaba completa)
    if (/…$/.test(t)) { const k = Math.max(t.lastIndexOf('. '), t.lastIndexOf('! '), t.lastIndexOf('? ')); if (k > 80) t = t.slice(0, k + 1); }
    const lugar = d.barrio && d.city ? `${d.barrio}, ${d.city}` : d.city || d.barrio || '';
    const where = lugar ? T('en {lugar}', { lugar }) : '';
    if (t.length < 90) {
      // sin texto de Wikipedia: lo que se sabe de ESTE lugar
      const desc = String(d.desc || '').trim();
      const first = desc ? `${d.name}: ${desc}${where && !new RegExp((d.city || '###').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(desc) ? ', ' + where : ''}.`
        : `${cap1(T(d.kind || 'Lugar').toLowerCase())}${where ? ' ' + where : ''}.`;
      const dir = d.addr ? T('Dirección: {addr}.', { addr: d.addr }) : '';   // su dirección exacta
      t = [t, first, dir, ...datos(d), d.ctx || ''].filter(Boolean).join(' ').replace(/\.\./g, '.');   // y una frase de su barrio
    } else {
      // con Wikipedia: se añade lo que la haga especial y el texto no diga ya (patrimonio, visitantes)
      const ya = (re) => re.test(t);
      for (const f of datos(d)) {
        if ((t + ' ' + f).length > DESC_MAX) break;
        if (YA.her.test(f) && ya(YA.her)) continue;
        if (YA.vis.test(f) && ya(YA.vis)) continue;
        if ((YA.any.test(f) || /\d{4}\.$/.test(f)) && ya(YA.any)) continue;
        t += ' ' + f;
      }
    }
    return clip(t);
  }
  // Frases completas hasta DESC_MAX letras (nunca un texto cortado a media frase)
  const DESC_MAX = 540;
  function clip(t) {
    if (t.length <= DESC_MAX) return t;
    const sentences = t.match(/[^.!?]+[.!?]+(\s|$)/g) || [t];
    let out = '';
    for (const x of sentences) { if ((out + ' ' + x.trim()).trim().length > DESC_MAX) break; out = (out + ' ' + x.trim()).trim(); }
    if (!out) { const c = t.slice(0, DESC_MAX - 1); out = c.slice(0, c.lastIndexOf(' ')).replace(/[,;:\s]+$/, '') + '.'; }
    return out;
  }
  // tamaño de letra según lo largo del texto: siempre cabe entero en el cuadro
  const fitClass = (t) => { const n = t.length; return n <= 110 ? 'fx' : n <= 160 ? 'f0' : n <= 300 ? 'f1' : n <= 390 ? 'f2' : n <= 470 ? 'f3' : 'f4'; };
  // ya en pantalla: la letra más grande con la que el texto cabe ENTERO (medido de verdad, no por número de letras)
  function autofit(el) {
    if (!el || !el.clientHeight) return;
    for (const c of ['fx', 'f0', 'f1', 'f2', 'f3', 'f4']) { el.className = 'tcg-flavor ' + c; if (el.scrollHeight <= el.clientHeight + 1) return; }
  }
  const code = (d) => ((d.city || 'PM').normalize('NFD').replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase() || 'PM') + '·' + String(hash(d.id) % 10000).padStart(4, '0');

  // historia más larga desde Wikipedia (introducción completa del artículo)
  async function longText(d) {
    let lang = null, title = null;
    const L = (PM.i18n && PM.i18n.lang) || 'es';
    if (d.wiki && /^[a-z]{2,3}:/.test(d.wiki)) { [lang, title] = [d.wiki.split(':')[0], d.wiki.split(':').slice(1).join(':')]; }
    if (d.wd) {
      try {
        const j = await (await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${d.wd}.json`)).json();
        const sl = (Object.values(j.entities)[0] || {}).sitelinks || {};
        const site = sl[L + 'wiki'] ? L + 'wiki' : null;   // (siempre en el idioma elegido)
        if (site) { lang = L; title = sl[site].title; }
      } catch (e) {}
    }
    if (!title || lang !== L) return null;
    const j = await (await fetch(`https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&format=json&origin=*&titles=${encodeURIComponent(title)}`)).json();
    let t = (Object.values((j.query && j.query.pages) || {})[0] || {}).extract || '';
    t = t.replace(/\s+/g, ' ').trim();
    if (t.length > 700) { const c = t.slice(0, 700); t = c.slice(0, Math.max(c.lastIndexOf('. ') + 1, 400)) || c; if (!/[.!?]$/.test(t)) t += '…'; }
    return t || null;
  }

  // ---------------- Reverso: plano de ciudad con calles pintadas, chincheta, anillo con lema ----------------
  // Reverso: "sello de conquista" sobrio y elegante, como un visado de pasaporte. Fondo con grabado tipo billete
  // (guilloché) distinto en cada carta, sello circular con el nombre del lugar, y los datos de TU conquista.
  function guilloche(seed) {
    let r = seed || 7;
    const rand = () => { r = (r * 1103515245 + 12345) % 2147483648; return r / 2147483648; };
    let paths = '';
    for (let c = 0; c < 4; c++) {
      const R1 = 30 + c * 9 + rand() * 4, r1 = 3 + Math.floor(rand() * 5) + c, d1 = 10 + rand() * 12;
      let path = '';
      for (let i = 0; i <= 720; i++) {
        const t = i / 720 * Math.PI * 2 * r1;
        const x = 50 + ((R1 - r1) * Math.cos(t) + d1 * Math.cos((R1 - r1) / r1 * t)) * 0.62;
        const y = 42 + ((R1 - r1) * Math.sin(t) - d1 * Math.sin((R1 - r1) / r1 * t)) * 0.62;
        path += (i ? 'L' : 'M') + x.toFixed(2) + ',' + y.toFixed(2);
      }
      paths += `<path d="${path}"/>`;
    }
    return paths;
  }
  // Fondo del reverso: las calles REALES alrededor del lugar (de los mapas vectoriales), con el sello justo encima
  // de su ubicación. Mientras llegan (o sin conexión) se ve el grabado tipo billete.
  const STREETS = new Map();
  const posKey = (p) => (+p[0]).toFixed(5) + ',' + (+p[1]).toFixed(5);
  const SEAL_Y = 33;      // altura del centro del sello en el reverso (unidades 0..140)
  const M_PER_U = 4.2;    // metros por unidad de dibujo: ~420 m de ancho de carta
  async function streetsFor(pos) {
    const k = posKey(pos);
    if (STREETS.has(k)) return STREETS.get(k);
    if (!PM.vtiles) return null;
    const lat = pos[0], lon = pos[1], mLat = 111320, mLon = 111320 * Math.cos(lat * Math.PI / 180);
    const n = lat + (SEAL_Y * M_PER_U) / mLat, s = lat - ((140 - SEAL_Y) * M_PER_U) / mLat;
    const w = lon - (50 * M_PER_U) / mLon, e = lon + (50 * M_PER_U) / mLon;
    const { els } = await PM.vtiles.fetchBox(s, w, n, e);
    const X = (q) => (50 + (q.lon - lon) * mLon / M_PER_U).toFixed(1), Y = (q) => (SEAL_Y - (q.lat - lat) * mLat / M_PER_U).toFixed(1);
    const big = /^(primary|secondary|tertiary)/;
    let minor = '', major = '', trail = '';
    for (const el of els) {
      if (el.type !== 'way' || !el.geometry || !el.tags || !el.tags.highway) continue;
      const g = el.geometry;
      if (!g.some((q) => q.lat > s && q.lat < n && q.lon > w && q.lon < e)) continue;
      const d = 'M' + g.map((q) => X(q) + ' ' + Y(q)).join('L');
      if (big.test(el.tags.highway)) major += d; else if (/^(path|track|bridleway)$/.test(el.tags.highway)) trail += d; else minor += d;
    }
    const svg = `<path class="sm" d="${minor}"/><path class="sb" d="${major}"/><path class="st2" d="${trail}"/><circle class="sp" cx="50" cy="${SEAL_Y}" r="2.2"/>`;
    STREETS.set(k, svg);
    return svg;
  }
  // rellena los reversos que haya dentro de `root` (vista grande de la carta)
  function fillStreets(root) {
    root.querySelectorAll('.bk-map[data-pos]').forEach(async (el) => {
      const pos = el.dataset.pos.split(',').map(Number);
      try { const svg = await streetsFor(pos); if (svg) { el.innerHTML = svg; el.classList.add('real'); } } catch (e) { /* sin conexión: se queda el grabado */ }
    });
  }
  function backHTML(d, R, mini) {
    const seed = hash(d.id), uid = 'bk' + seed;
    // la foto del lugar dentro del sello, recortada en círculo por el centro y derecha aunque el sello vaya inclinado; debajo
    // queda el icono por si la foto tarda o no llega (las cartas pequeñas del álbum no enseñan el reverso: ahí no se carga)
    const foto = d.img && !mini ? `<image class="sf" href="${esc(d.img)}" x="33" y="33" width="134" height="134" preserveAspectRatio="xMidYMid slice"/>` : '';
    const date = d.t ? new Date(d.t).toLocaleDateString(PM.LOCALE, { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
    const year = d.t ? new Date(d.t).getFullYear() : new Date().getFullYear();
    const base = d.points || 100, earned = base + Math.max(0, (d.visits || 1) - 1) * Math.round(base * 0.2);
    const color = d.color || '#2563eb';
    const ring = `${String(d.name || '').toUpperCase()} · ${String(d.city || 'PINTAMAPA').toUpperCase()} · ${year} · `;
    const ringTxt = ring.length > 58 ? ring.slice(0, 55) + '… · ' : ring;
    const coord = (v, pos, neg) => Math.abs(v).toFixed(4) + '° ' + (v >= 0 ? pos : neg);
    const where = d.pos ? `${coord(d.pos[0], 'N', 'S')} · ${coord(d.pos[1], 'E', PM.i18n && PM.i18n.lang === 'en' ? 'W' : 'O')}` : '';
    return `<div class="tcg-face tcg-back">
      <div class="bk">
        <svg class="bk-guil${d.pos ? ' bk-map' : ''}" ${d.pos ? `data-pos="${d.pos[0]},${d.pos[1]}"` : ''} viewBox="0 0 100 140" preserveAspectRatio="xMidYMid slice">${d.pos && STREETS.has(posKey(d.pos)) ? STREETS.get(posKey(d.pos)) : guilloche(seed)}</svg>
        <div class="bk-top"><span>PintaMapa</span><i></i><span>Carta de conquista</span></div>
        <svg class="bk-seal" viewBox="0 0 200 200" style="--pc:${color}">
          <defs>
            <path id="${uid}" d="M100,100 m-76,0 a76,76 0 1,1 152,0 a76,76 0 1,1 -152,0"/>
            <radialGradient id="${uid}g" cx="40%" cy="35%" r="75%"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></radialGradient>
          </defs>
          <circle cx="100" cy="100" r="95" class="s1"/><circle cx="100" cy="100" r="89" class="s2"/>
          <text class="st"><textPath href="#${uid}" textLength="472" lengthAdjust="spacing">${esc(ringTxt)}</textPath></text>
          <circle cx="100" cy="100" r="${foto ? 67 : 60}" fill="${color}"/><circle cx="100" cy="100" r="${foto ? 67 : 60}" fill="url(#${uid}g)"/>
          <text x="100" y="114" class="se">${esc(d.emoji || '📍')}</text>
          ${foto || `<circle cx="100" cy="100" r="54" class="s4"/><text x="100" y="146" class="sr">${esc(R.sym)}</text>`}
          <circle cx="100" cy="100" r="${foto ? 67 : 60}" class="s3"/>
        </svg>
        <div class="bk-name" translate="no" style="--k: ${tamTitulo(d.name, 24)}">${esc(d.name)}</div>
        <div class="bk-sub" translate="no">${esc([d.barrio, d.city].filter(Boolean).join(' · ') || d.kind || '')}</div>
        <div class="bk-motto"><i></i><span>Sal a la calle · Pinta tu ciudad · Conquístala</span><i></i></div>
        <div class="bk-grid">
          <div><small>Conquistado por</small><b>${esc(d.player || '—')}</b></div>
          <div><small>Fecha</small><b>${esc(date)}</b></div>
          <div><small>Visitas</small><b>${d.visits || 1}</b></div>
          <div><small>Puntos</small><b>${earned.toLocaleString(PM.LOCALE)}</b></div>
          <div><small>Colección</small><b>Nº ${d.number || 1} / ${d.total || 1}</b></div>
          <div><small>Rareza</small><b>${esc(PM.t(R.name))}</b></div>
        </div>
        <div class="bk-foot"><span>${esc(where)}</span><span>${esc(code(d))}</span></div>
      </div>
      <div class="bk-holo"></div><div class="tcg-glare"></div>
    </div>`;
  }


  // ---------------- HTML de la carta ----------------
  // d = { id, name, kind, emoji, rarity, city, barrio, t, visits, img, own, text, points, number, total, player, credit }
  // Rediseño v0.9.15 (petición del usuario, 15-nov-2026: «más visuales, estilo dopamina, brillo holográfico supremo»; fuera
  // la «REGLA», la debilidad/resistencia/retirada y la rejilla de captura, que eran relleno). La foto, a sangre arriba; el nombre
  // grande encima (nunca cortado); el tipo con su color vivo; y debajo, en un panel de cristal, por qué merece la pena y su historia.
  // El holograma crece con la rareza: común, solo reflejo; rara, marco holográfico; épica, además la foto con lámina arcoíris y
  // polvo de estrellas; legendaria, marco de oro que gira con la luz, holograma en toda la carta y estrellas que titilan.
  function html(d, opts = {}) {
    const [tk, T] = typeOf(d.kind);
    const R = RAR[d.rarity] || RAR.comun;
    const pts = d.points || 100;
    const sitio = [d.barrio, d.city].filter(Boolean).join(', ');
    return `<div class="tcg r-${d.rarity || 'comun'} t-${tk} ${opts.mini ? 'mini' : ''} ${d.shiny ? 'shiny' : ''} ${d.must ? 'must' : ''}" style="--orb:${T.orb};--t1:${T.t1};--t2:${T.t2};--c1:${T.c1};--c2:${T.c2};--holo:${R.holo}" data-id="${esc(d.id)}">
      <div class="tcg-rot">
        <div class="tcg-face tcg-front">
          <div class="tcg-inner">
            <div class="tcg-art">
              <div class="tcg-photo" ${d.img ? `style="background-image:url('${esc(cssUrl(d.img))}')"` : ''}>${d.img ? '' : `<span>${esc(d.emoji || '📍')}</span>`}</div>
              <div class="tcg-holo"></div><div class="tcg-veil"></div>
              <div class="tcg-head">
                <span class="tcg-gem" title="${esc(PM.t(R.name))}"><b>${R.sym}</b></span>
                <span class="tcg-tipo">${T.ic} ${esc(PM.t(T.name))}</span>
                <span class="tcg-hp"><small>PTS</small>${pts}</span>
              </div>
              <div class="tcg-name">
                <div class="tcg-title"><b translate="no" style="--k: ${tamTitulo(d.name, 19)}">${esc(d.name)}</b></div>
                <div class="tcg-sub" translate="no"><i class="tcg-orb">${esc(d.emoji || '📍')}</i><span>${esc(PM.t(d.kind || ''))}${sitio ? ' · ' + esc(sitio) : ''}</span></div>
              </div>
            </div>
            <div class="tcg-panel" data-ic="${T.ic}">
              ${d.must || d.shiny ? `<div class="tcg-etiquetas">${d.must ? `<span class="tcg-shinytag musttag">★ ${esc(PM.t('IMPRESCINDIBLE'))}</span>` : ''}${d.shiny ? `<span class="tcg-shinytag">✨ ${esc(PM.t('BRILLANTE'))}</span>` : ''}</div>` : ''}
              ${(() => { const tx = descText(d); return `<div class="tcg-flavor ${fitClass(tx)}" translate="no">${esc(tx)}</div>`; })()}
              <div class="tcg-foot"><span class="tcg-num">Nº ${d.number || 1}<small>/${d.total || 1}</small></span>
                <span class="tcg-credit">${esc(d.own ? PM.t('Foto propia') : (d.credit || 'Foto: Wikimedia Commons'))}</span>
                <span class="tcg-set">Pinta<b>Mapa</b> <i>${R.sym}</i></span></div>
            </div>
          </div>
          <div class="tcg-foil"></div><div class="tcg-glitter"></div><div class="tcg-glare"></div>
        </div>
        ${backHTML(d, R, opts.mini)}
      </div>
    </div>`;
  }

  // ---------------- Interacción: inclinación 3D + brillo que sigue al puntero; tocar = voltear ----------------
  const CON_RATON = !!(window.matchMedia && matchMedia("(hover: hover)").matches);   // (en el móvil el marco no gira: parpadeaba)
  function interactive(el) {
    const rot = el.querySelector('.tcg-rot');
    let flipped = false, raf = null, target = { x: 50, y: 50 }, cur = { x: 50, y: 50 }, active = false, dedo = null, movido = false;
    // (igual en el móvil que en el PC: ±14° y ±18°. Antes en el móvil era la mitad y el usuario notaba que giraba poco)
    const GIRO = 1;
    const apply = () => {
      const k = el._soft ? 0.1 : 0.18; cur.x += (target.x - cur.x) * k; cur.y += (target.y - cur.y) * k;
      const rx = (cur.y - 50) / 50 * -14 * GIRO, ry = (cur.x - 50) / 50 * 18 * GIRO;
      el.style.setProperty('--mx', cur.x + '%'); el.style.setProperty('--my', cur.y + '%');
      el.style.setProperty('--rx', rx + 'deg'); el.style.setProperty('--ry', (flipped ? 180 : 0) + ry + 'deg');
      el.style.setProperty('--hyp', Math.min(1, Math.hypot(cur.x - 50, cur.y - 50) / 50).toFixed(3));
      if (CON_RATON) el.style.setProperty('--ang', (cur.x * 3.6 + cur.y * 1.2).toFixed(1) + 'deg');   // (el marco de oro y el arcoíris del marco giran con la luz)
      if (Math.abs(target.x - cur.x) > 0.1 || Math.abs(target.y - cur.y) > 0.1) raf = requestAnimationFrame(apply); else raf = null;
    };
    const go = () => { if (!raf) raf = requestAnimationFrame(apply); };
    const point = (cx, cy) => { const b = el.getBoundingClientRect(); target = { x: Math.max(0, Math.min(100, (cx - b.left) / b.width * 100)), y: Math.max(0, Math.min(100, (cy - b.top) / b.height * 100)) }; active = true; el.classList.add('active'); go(); };
    const soltar = () => { target = { x: 50, y: 50 }; active = false; dedo = null; el.classList.remove('active'); go(); };
    // en el móvil también se inclina con el dedo: arrastrarlo sobre la carta la mueve; un toque sin arrastrar le da la vuelta
    el.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') return; dedo = [e.clientX, e.clientY]; movido = false; });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') { el._soft = false; point(e.clientX, e.clientY); return; }
      if (!dedo) return;
      if (Math.hypot(e.clientX - dedo[0], e.clientY - dedo[1]) > 10) movido = true;
      if (movido) { el._soft = false; point(e.clientX, e.clientY); }
    });
    el.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') soltar(); });
    el.addEventListener('pointercancel', soltar);
    el.addEventListener('pointerleave', soltar);
    el.addEventListener('click', () => {
      if (movido) { movido = false; return; }   // (venía de arrastrar: no se voltea)
      flipped = !flipped; el.classList.toggle('flipped', flipped); rot.style.transition = 'transform .8s cubic-bezier(.3,1.5,.5,1)'; go(); setTimeout(() => { rot.style.transition = ''; }, 800);
    });
    // móvil: al inclinarlo, el holograma se desliza por la carta (como un cromo de verdad bajo la luz).
    // La postura con la que la miras es el "centro" y se recalibra despacio si cambias de postura.
    let base = null;
    const clamp = (v) => Math.max(-48, Math.min(48, v));
    const tilt = (e) => {
      if (!document.body.contains(el)) { window.removeEventListener('deviceorientation', tilt); return; }
      if (active || e.beta == null || e.gamma == null) return;
      if (!base) base = { g: e.gamma, b: e.beta };
      base.g += (e.gamma - base.g) * 0.004; base.b += (e.beta - base.b) * 0.004;
      el._soft = true;
      // (2,6: inclinar el móvil unos 18° lleva la carta al tope; antes hacían falta 27°)
      const nx = 50 + clamp((e.gamma - base.g) * 2.6), ny = 50 + clamp((e.beta - base.b) * 2.6);
      if (Math.abs(nx - target.x) < 0.6 && Math.abs(ny - target.y) < 0.6) return;   // (el temblor del sensor no mueve la carta: así no parpadea ni gasta)
      target = { x: nx, y: ny };
      el.classList.add('active'); go();
    };
    window.addEventListener('deviceorientation', tilt);
    // vaivén suave al aparecer (para que se vea el brillo sin tocar)
    let t0 = performance.now();
    const idle = (now) => { if (active || !document.body.contains(el)) return; const k = (now - t0) / 1000; if (k > 3.2) return; target = { x: 50 + Math.sin(k * 2.2) * 30, y: 50 + Math.cos(k * 1.7) * 18 }; el.classList.add('active'); go(); requestAnimationFrame(idle); };
    requestAnimationFrame(idle);
    return { flip: () => el.click() };
  }

  // ---------------- Vista grande ----------------
  // ⓘ artículo de Wikipedia del lugar (en el idioma que tenga; si solo hay Wikidata, su página en español)
  const INFO_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v6"/><circle cx="12" cy="7.6" r="0.6" fill="currentColor"/></svg>';
  function wikiUrl(d) {
    if (d.wiki) {
      const m = String(d.wiki).match(/^([a-z-]{2,12}):(.+)$/);
      const lang = m ? m[1] : 'es', title = m ? m[2] : d.wiki;
      return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
    }
    if (d.wd && /^Q\d+$/.test(d.wd)) return `https://www.wikidata.org/wiki/Special:GoToLinkedPage?site=${(PM.i18n && PM.i18n.lang) || 'es'}wiki&itemid=${d.wd}`;
    return null;
  }
  // abre fuera de la app (en el navegador del móvil)
  function openExternal(url) {
    const Br = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser;
    if (Br && Br.open) { Br.open({ url }).catch(() => window.open(url, '_blank')); return; }
    const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
  }
  function open(d, opts = {}) {
    let ov = document.getElementById('tcg-view');
    if (!ov) { ov = document.createElement('div'); ov.id = 'tcg-view'; document.body.appendChild(ov); }
    ov.innerHTML = `<div class="tcg-stage-wrap">
      ${opts.badge ? `<div class="tcg-badge">${opts.badge}</div>` : ''}
      ${html(d)}
      <p class="tcg-hint">Toca la carta para darle la vuelta</p>
    </div>
    <div class="tcg-actions">
      ${btn('flip', '↻', 'Girar')}
      ${(opts.actions || []).map((a, i) => { const m = String(a.label).match(/^(\S+)\s+(.*)$/); return btn('', m ? m[1] : '★', m ? m[2] : a.label, a.primary, i); }).join('')}
      ${wikiUrl(d) ? btn('wiki', INFO_ICON, 'Info') : ''}
      ${btn('png', SHARE_ICON, 'Compartir')}
      ${btn('close', '✕', 'Cerrar')}
    </div>`;
    ov.classList.add('show');
    const card = ov.querySelector('.tcg');
    const ctl = interactive(card);
    fillStreets(ov);
    ov.querySelector('[data-a=flip]').addEventListener('click', () => ctl.flip());
    ov.querySelector('[data-a=close]').addEventListener('click', close);
    ov.querySelector('[data-a=png]').addEventListener('click', () => download(d));
    const wb = ov.querySelector('[data-a=wiki]');
    if (wb) {
      // solo Wikidata: se busca en qué idioma hay artículo (español, catalán, inglés… el primero que exista)
      if (!d.wiki && d.wd && !d._wikiUrl) fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${d.wd}&props=sitelinks/urls&format=json&origin=*`)
        .then((r) => r.json()).then((j) => {
          const sl = ((j.entities || {})[d.wd] || {}).sitelinks || {};
          const pick = [((PM.i18n && PM.i18n.lang) || 'es') + 'wiki', 'eswiki', 'cawiki', 'glwiki', 'euwiki', 'enwiki', 'frwiki', 'itwiki', 'ptwiki', 'dewiki'].find((k) => sl[k]) || Object.keys(sl).find((k) => /wiki$/.test(k) && !/commons|species/.test(k));
          d._wikiUrl = pick ? sl[pick].url : `https://www.wikidata.org/wiki/${d.wd}`;
        }).catch(() => {});
      wb.addEventListener('click', () => openExternal(d._wikiUrl || wikiUrl(d)));
    }
    (opts.actions || []).forEach((a, i) => ov.querySelector(`[data-x="${i}"]`).addEventListener('click', a.on));
    requestAnimationFrame(() => autofit(ov.querySelector(`.tcg[data-id="${d.id}"] .tcg-flavor`)));
    ov.onclick = (e) => { if (e.target === ov) close(); };
    if ((d.wiki || d.wd) && (!d.text || d.text.length < 350)) {
      longText(d).then((t) => {
        if (!t || t.length <= (d.text || '').length) return;
        d.text = t;
        const f = ov.querySelector(`.tcg[data-id="${d.id}"] .tcg-flavor`);
        if (f) { f.textContent = descText(d); autofit(f); }
        if (opts.onText) opts.onText(t);
      }).catch(() => {});
    }
    document.addEventListener('keydown', esc1);
  }
  function btn(a, ico, txt, pri, x) {
    return `<button ${a ? `data-a="${a}"` : `data-x="${x}"`} class="${pri ? 'pri' : ''}"><i>${ico}</i><span>${txt}</span></button>`;
  }
  function esc1(e) { if (e.key === 'Escape') close(); }
  function close() { const ov = document.getElementById('tcg-view'); if (ov) ov.classList.remove('show'); document.removeEventListener('keydown', esc1); }

  // ---------------- Exportar como imagen (para compartir) ----------------
  async function toPng(d) {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:-9999px;top:0;width:630px;padding:24px;background:transparent;--w:630px';
    box.innerHTML = html(d, { flat: true });
    const card = box.firstElementChild; card.classList.add('flat', 'active'); card.style.setProperty('--mx', '35%'); card.style.setProperty('--my', '30%'); card.style.setProperty('--hyp', '.6');
    document.body.appendChild(box);
    try {
      await new Promise((r) => setTimeout(r, 300));
      if (!window.htmlToImage && PM.lazy) await PM.lazy('lib/html-to-image.js');
      return await window.htmlToImage.toPng(card, { pixelRatio: 2, cacheBust: true, filter: (n) => !(n.classList && n.classList.contains('tcg-back')) });
    } finally { box.remove(); }
  }
  // símbolo de compartir (tres puntos unidos)
  const SHARE_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>';
  async function download(d) {
    try {
      const url = await toPng(d);
      // navegador del móvil o PC compatible: el menú de compartir del sistema (WhatsApp, Instagram…)
      if (!PM.isNative && navigator.canShare) {
        const blob = await (await fetch(url)).blob();
        const file = new File([blob], `PintaMapa - ${d.name}.png`, { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: d.name, text: PM.t('He conquistado «{n}» en PintaMapa 🖌️🚩', { n: d.name }) }).catch(() => {}); return; }
      }
      if (PM.isNative && window.Capacitor.Plugins.Filesystem && window.Capacitor.Plugins.Share) {
        const f = await window.Capacitor.Plugins.Filesystem.writeFile({ path: `carta-${d.id}.png`, data: url.split(',')[1], directory: 'CACHE' });
        await window.Capacitor.Plugins.Share.share({ title: d.name, text: PM.t('He conquistado «{n}» en PintaMapa 🖌️🚩', { n: d.name }), files: [f.uri] }).catch(() => {});
        return;
      }
      const a = document.createElement('a'); a.href = url; a.download = `PintaMapa - ${d.name}.png`; a.click();
    } catch (e) { alert('No se pudo crear la imagen: ' + (e.message || e)); }
  }

  // ---------------- Estilos ----------------
  const css = `
  .tcg { --mx: 50%; --my: 50%; --rx: 0deg; --ry: 0deg; --hyp: 0; --y: #f6d44c; position: relative; width: 100%; aspect-ratio: 63 / 88; perspective: 1200px; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-size: calc(var(--w, 360px) / 26); user-select: none; cursor: pointer; }
  .tcg.mini { font-size: 6.4px; cursor: pointer; }
  .tcg-rot { position: absolute; inset: 0; transform-style: preserve-3d; transform: rotateX(var(--rx)) rotateY(var(--ry)); will-change: transform; }
  .tcg-face { position: absolute; inset: 0; border-radius: 4.5% / 3.3%; overflow: hidden; backface-visibility: hidden; -webkit-backface-visibility: hidden; box-shadow: 0 1.4em 3em rgba(0,0,0,.35), 0 0 0 1px rgba(0,0,0,.15); }
  /* marco según la rareza (los mismos colores que en el mapa): gris, azul, violeta y dorado */
  .tcg { --b1: #f1f3f6; --b2: #b9c1cc; --b3: #8e98a6; --b4: #e6e9ee; --bl: rgba(178,187,200,.75); --bl2: rgba(178,187,200,.35); }
  .tcg.r-raro { --b1: #d9eeff; --b2: #63b7f6; --b3: #2b86d6; --b4: #d2e9ff; --bl: rgba(99,183,246,.75); --bl2: rgba(99,183,246,.35); }
  .tcg.r-epico { --b1: #f0e0ff; --b2: #b97cf1; --b3: #8a3fd1; --b4: #e8d6ff; --bl: rgba(185,124,241,.75); --bl2: rgba(185,124,241,.35); }
  .tcg.r-legendario { --b1: #fff1a8; --b2: #f6d44c; --b3: #d4a52c; --b4: #fff3b0; --bl: rgba(212,175,106,.75); --bl2: rgba(212,175,106,.35); }
  /* ===== Anverso (v0.9.15): marco de rareza · foto a sangre con el nombre encima · panel de cristal del color del tipo ===== */
  .tcg { --ang: 0deg; }
  .tcg-front { padding: 3.2%; background: linear-gradient(135deg, var(--b1), var(--b2) 30%, var(--b3) 60%, var(--b4)); }
  /* marco holográfico (rara y épica): arcoíris de metal que cambia de color al mover la carta */
  .r-raro .tcg-front, .r-epico .tcg-front { background: conic-gradient(from var(--ang) at 50% 50%, var(--b2), #7dd3fc, #c4b5fd, #f9a8d4, #fde68a, #86efac, var(--b2)); }
  .r-raro .tcg-front { background: conic-gradient(from var(--ang) at 50% 50%, #1e7fd6, #7dd3fc, #e0f2fe, #38bdf8, #a5b4fc, #1e7fd6); }
  .r-epico .tcg-front { background: conic-gradient(from var(--ang) at 50% 50%, #7c3aed, #f0abfc, #fde68a, #c084fc, #67e8f9, #a855f7, #7c3aed); }
  /* legendaria: oro de verdad, con una veta de luz que gira con la carta */
  .r-legendario .tcg-front { background: conic-gradient(from var(--ang) at 50% 50%, #b8860b, #ffe680, #fff8d6, #e6b422, #8a6100, #ffd84d, #fffbe6, #c99a24, #b8860b); }
  .tcg-inner { position: relative; height: 100%; border-radius: 2.6% / 1.8%; overflow: hidden; display: flex; flex-direction: column; background: linear-gradient(170deg, var(--c1), var(--c2)); box-shadow: inset 0 0 0 .14em rgba(255,255,255,.55), 0 0 0 .1em rgba(0,0,0,.25); }
  /* --- la foto, a sangre, con el degradado del tipo detrás (si no hay foto, el emoji grande sobre el color) --- */
  .tcg-art { position: relative; flex: 0 0 60%; overflow: hidden; background: linear-gradient(150deg, var(--t1), var(--t2)); }
  .tcg-photo { position: absolute; inset: 0; background: center / cover no-repeat; display: grid; place-items: center; }
  .tcg-photo span { font-size: 6em; filter: drop-shadow(0 .15em .3em rgba(0,0,0,.35)); transform: translateY(-.1em); }
  .tcg-veil { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(180deg, rgba(0,0,0,.42) 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,0) 48%, rgba(0,0,0,.18) 62%, rgba(0,0,0,.78) 100%); }
  /* arriba: gema de rareza · tipo · puntos */
  .tcg-head { position: absolute; z-index: 3; left: 4%; right: 4%; top: 3.2%; display: flex; align-items: center; gap: .4em; }
  .tcg-gem { display: grid; place-items: center; width: 1.9em; height: 1.9em; flex: none; border-radius: .55em; transform: rotate(45deg); font-size: .78em; font-weight: 900; color: #fff;
    background: linear-gradient(135deg, var(--b2), var(--b3)); box-shadow: 0 0 0 .12em rgba(255,255,255,.85), 0 .15em .4em rgba(0,0,0,.35), 0 0 1em var(--bl); }
  .tcg-gem { text-shadow: 0 1px 2px rgba(0,0,0,.4); }
  .r-legendario .tcg-gem { background: linear-gradient(135deg, #fff1a8, #e6b422 50%, #a8790a); color: #3b2a00; text-shadow: none; }
  .tcg-gem > * { transform: rotate(-45deg); }
  .tcg-tipo { padding: .28em .7em; border-radius: 99px; font-size: .62em; font-weight: 900; letter-spacing: .04em; text-transform: uppercase; color: #fff; white-space: nowrap;
    background: linear-gradient(90deg, var(--t1), var(--t2)); box-shadow: 0 .1em .35em rgba(0,0,0,.3), inset 0 .08em 0 rgba(255,255,255,.4); }
  .tcg-hp { margin-left: auto; display: flex; align-items: baseline; gap: .2em; padding: .18em .65em .22em; border-radius: 99px; font-size: 1.05em; font-weight: 900; line-height: 1; color: #fff; white-space: nowrap;
    background: linear-gradient(180deg, #ff5f8f, #e11d48); box-shadow: 0 .12em .4em rgba(225,29,72,.55), inset 0 .1em 0 rgba(255,255,255,.45); text-shadow: 0 1px 1px rgba(0,0,0,.25); }
  .tcg-hp small { font-size: .5em; letter-spacing: .06em; opacity: .9; }
  /* abajo de la foto: el nombre, grande y blanco (nunca cortado: ver tamTitulo), y qué es y dónde */
  .tcg-name { position: absolute; z-index: 3; left: 5%; right: 5%; bottom: 4%; }
  .tcg-title b { display: block; font-size: calc(1.45em * var(--k, 1)); font-weight: 900; line-height: 1.04; letter-spacing: -.015em; color: #fff; min-width: 0; overflow-wrap: break-word;
    text-shadow: 0 .06em .02em rgba(0,0,0,.35), 0 .1em .6em rgba(0,0,0,.55); }   /* (nunca cortado: ver tamTitulo) */
  .tcg-sub { display: flex; align-items: center; gap: .4em; margin-top: .35em; font-size: .62em; font-weight: 700; color: rgba(255,255,255,.92); text-shadow: 0 1px 3px rgba(0,0,0,.6); }
  .tcg-sub span { min-width: 0; overflow-wrap: anywhere; }
  .tcg-orb { display: grid; place-items: center; width: 1.9em; height: 1.9em; flex: none; border-radius: 50%; font-style: normal; font-size: 1.05em;
    background: radial-gradient(circle at 35% 30%, rgba(255,255,255,.75), transparent 45%), linear-gradient(135deg, var(--t1), var(--t2)); box-shadow: 0 0 0 .1em rgba(255,255,255,.8), 0 .1em .3em rgba(0,0,0,.4); }
  /* --- panel de abajo: cristal del color del tipo --- */
  .tcg-panel { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; gap: .4em; padding: .55em 5% .45em;
    background: radial-gradient(120% 90% at 0% 0%, rgba(255,255,255,.9), rgba(255,255,255,0) 60%), linear-gradient(160deg, var(--c1), var(--c2)); }
  .tcg-panel::before { content: ''; position: absolute; left: 0; right: 0; top: 0; height: .22em; background: linear-gradient(90deg, var(--t1), var(--t2)); }
  .tcg-panel::after { content: attr(data-ic); position: absolute; right: -.08em; bottom: -.25em; font-size: 4.6em; line-height: 1; opacity: .09; pointer-events: none; transform: rotate(-12deg); }
  .tcg-panel > * { position: relative; z-index: 1; }
  /* descripción: alto que queda y letra que se ajusta para que quepa ENTERA (f1 corto … f4 largo; autofit la mide de verdad) */
  .tcg-flavor { flex: 1; min-height: 0; box-sizing: border-box; font-size: .7em; line-height: 1.32; color: #27272a; overflow: hidden; hyphens: auto; font-weight: 500; }
  .tcg-flavor.fx { font-size: 1em; line-height: 1.38; } .tcg-flavor.f0 { font-size: .86em; line-height: 1.36; } .tcg-flavor.f1 { font-size: .74em; } .tcg-flavor.f2 { font-size: .63em; } .tcg-flavor.f3 { font-size: .57em; } .tcg-flavor.f4 { font-size: .52em; }
  .tcg-foot { display: flex; align-items: center; gap: .6em; font-size: .5em; color: rgba(0,0,0,.55); font-weight: 700; }
  .tcg-num { font-weight: 900; color: #1b1b1b; } .tcg-num small { font-weight: 700; opacity: .55; }
  .tcg-credit { flex: 1; min-width: 0; overflow-wrap: anywhere; font-weight: 600; opacity: .8; }
  .tcg-set { font-weight: 900; font-style: italic; color: #1b1b1b; white-space: nowrap; } .tcg-set b { color: var(--t2); } .tcg-set i { font-style: normal; color: var(--b3); margin-left: .15em; }
  /* --- miniaturas (álbum, mazos): la foto y el nombre mandan; la historia se lee al abrirla --- */
  .tcg.mini .tcg-art { flex-basis: 87%; } .tcg.mini .tcg-flavor, .tcg.mini .tcg-credit { display: none; }
  .tcg.mini .tcg-panel { justify-content: center; padding-top: .45em; } .tcg.mini .tcg-foot { font-size: .62em; }
  /* ===== Holograma (por capas; cuanto más rara, más) ===== */
  .tcg-holo, .tcg-foil, .tcg-glitter, .tcg-glare { position: absolute; inset: 0; pointer-events: none; }
  .tcg-holo { z-index: 1; }
  .tcg-foil, .tcg-glitter { z-index: 5; border-radius: inherit; } .tcg-glare { z-index: 6; border-radius: inherit; }
  /* 1) lámina arcoíris de la foto (épica y legendaria): bandas finas que se deslizan al mover la carta */
  .tcg-holo { opacity: 0; mix-blend-mode: color-dodge; background-size: 300% 300%; background-position: var(--mx) var(--my);
    background-image: repeating-linear-gradient(115deg, transparent 0%, rgba(255,0,140,.55) 2.2%, rgba(255,210,0,.5) 3.6%, rgba(0,255,170,.5) 5%, rgba(0,170,255,.55) 6.4%, rgba(190,0,255,.5) 7.8%, transparent 10%, transparent 16%); }
  .r-epico .tcg-holo { opacity: calc(.08 + var(--hyp) * .38); }
  .r-legendario .tcg-holo { opacity: calc(.12 + var(--hyp) * .45); }
  /* 3) lámina holográfica de TODA la carta: arcoíris + raya de luz; muy suave en común, a tope en legendaria y brillante */
  .tcg-foil { mix-blend-mode: color-dodge; opacity: calc(var(--holo) * (.04 + var(--hyp) * .32));
    background-image: linear-gradient(115deg, transparent 22%, rgba(255,90,180,.55) 34%, rgba(255,226,120,.5) 42%, rgba(110,255,210,.5) 50%, rgba(110,190,255,.55) 58%, rgba(200,140,255,.5) 66%, transparent 78%),
      repeating-linear-gradient(45deg, rgba(255,255,255,0) 0 .6em, rgba(255,255,255,.12) .6em .7em);
    background-size: 300% 300%, 100% 100%; background-position: var(--mx) var(--my), 0 0; }
  .r-legendario .tcg-foil { opacity: calc(.14 + var(--hyp) * .5); }
  /* 4) destellos finos (textura de ruido, como el foil real) alrededor del punto de luz */
  .tcg-glitter { opacity: calc(var(--holo) * var(--hyp)); mix-blend-mode: color-dodge;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.25' numOctaves='1' seed='7' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 16 -12.4'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    background-size: 11em 11em; background-position: calc(var(--mx) * -.15) calc(var(--my) * -.15);
    -webkit-mask-image: radial-gradient(circle at var(--mx) var(--my), #000 0%, rgba(0,0,0,.55) 18%, transparent 42%); mask-image: radial-gradient(circle at var(--mx) var(--my), #000 0%, rgba(0,0,0,.55) 18%, transparent 42%); }
  /* 5) reflejo de la luz */
  .tcg-glare { mix-blend-mode: soft-light; opacity: calc(.2 + var(--hyp) * .65); background: radial-gradient(circle at var(--mx) var(--my), rgba(255,255,255,.95) 0%, rgba(255,255,255,.35) 12%, rgba(255,255,255,0) 32%, rgba(0,0,0,.18) 100%); }
  .tcg:not(.active) .tcg-glare { opacity: .15; }
  .tcg.flat .tcg-foil { opacity: .18; }
  /* BRILLANTE: lámina dorada siempre visible que recorre la carta y destellos a tope */
  .tcg.shiny .tcg-rot, .tcg.must .tcg-rot { border-radius: 4.5% / 3.3%; }   /* (el halo va en lo que gira: si no, era un rectángulo quieto detrás de la carta) */
  .tcg.shiny .tcg-rot { box-shadow: 0 0 0 .18em #f5c542, 0 0 1.6em rgba(250,204,21,.7); }
  .tcg.shiny .tcg-foil { opacity: calc(.3 + var(--hyp) * .5);
    background-image: linear-gradient(115deg, rgba(255,215,0,0) 20%, rgba(255,223,90,.55) 35%, rgba(255,255,255,.65) 45%, rgba(255,190,60,.55) 55%, rgba(255,215,0,0) 72%); background-size: 260% 260%;
    animation: shinysweep 3.2s linear infinite; }
  @keyframes shinysweep { from { background-position: 120% 0; } to { background-position: -40% 0; } }
  .tcg.shiny .tcg-glitter { opacity: .9 !important; }
  /* IMPRESCINDIBLE: doble aro rojo y oro con resplandor, y su cinta */
  .tcg.must .tcg-rot { box-shadow: 0 0 0 .22em #f59e0b, 0 0 0 .42em #b91c1c, 0 0 1.8em rgba(245,158,11,.6); }
  /* etiquetas (imprescindible, brillante): en una fila justo antes de la descripción, nunca encima de la foto */
  .tcg-etiquetas { display: flex; flex-wrap: wrap; gap: .35em; }
  .tcg-shinytag { display: inline-block; background: linear-gradient(90deg, #b45309, #facc15, #b45309); color: #1a1200; font-weight: 900; font-size: .56em; letter-spacing: .1em; padding: .25em .8em; border-radius: 99px; box-shadow: 0 .1em .3em rgba(0,0,0,.2); white-space: nowrap; }
  .tcg-shinytag.musttag { background: linear-gradient(90deg, #991b1b, #f59e0b, #991b1b); color: #fff; text-shadow: 0 1px 1px rgba(0,0,0,.35); }
  .tcg.mini .tcg-shinytag { font-size: .66em; }
  /* sin animaciones en las miniaturas (en el álbum hay decenas a la vez) ni si el sistema pide reducir el movimiento */
  .tcg.mini.shiny .tcg-foil { animation: none; }
  @media (prefers-reduced-motion: reduce) { .tcg.shiny .tcg-foil { animation: none !important; } }
  /* holograma del reverso: arcoíris muy suave que se desliza al mover la carta */
  .bk-holo { position: absolute; inset: 0; pointer-events: none; z-index: 3; border-radius: inherit; mix-blend-mode: overlay; opacity: calc(.04 + var(--hyp) * .2);
    background: linear-gradient(120deg, transparent 20%, rgba(255,80,170,.55) 32%, rgba(255,220,90,.5) 40%, rgba(80,255,190,.45) 48%, rgba(90,190,255,.55) 56%, rgba(190,110,255,.5) 64%, transparent 76%);
    background-size: 280% 280%; background-position: var(--mx) var(--my); }
  #tcg-view .tcg { touch-action: none; }   /* (el dedo inclina la carta: no desplaza la pantalla) */
  @media (hover: none) {
    /* móvil: la carta gira en 3D y ahí Android dibuja mal las MEZCLAS de color (franjas cortadas, bordes que bailan, parpadeos).
       El mismo holograma, sin mezclas: capas de color con transparencia que aparecen al inclinar */
    .tcg-glitter { display: none; }
    .tcg-holo { mix-blend-mode: normal; }
    .r-epico .tcg-holo { opacity: calc(var(--hyp) * .32); } .r-legendario .tcg-holo { opacity: calc(.06 + var(--hyp) * .34); }
    .tcg-foil { mix-blend-mode: normal; opacity: calc(var(--holo) * var(--hyp) * .22); }
    .r-legendario .tcg-foil { opacity: calc(.05 + var(--hyp) * .3); }
    .tcg.shiny .tcg-foil { animation: none; opacity: calc(.12 + var(--hyp) * .25); }
    .tcg.shiny .tcg-glitter { display: none; }
    .tcg-glare { mix-blend-mode: normal; opacity: calc(var(--hyp) * .22); background: radial-gradient(circle at var(--mx) var(--my), rgba(255,255,255,.75) 0%, rgba(255,255,255,0) 45%); }
    .tcg:not(.active) .tcg-glare { opacity: 0; }
    .bk-holo { mix-blend-mode: normal; opacity: calc(var(--hyp) * .1); }
    .tcg-back .tcg-glare { opacity: calc(var(--hyp) * .12) !important; }
  }
  /* --- reverso: sello de conquista --- */
  .tcg-back { transform: rotateY(180deg); padding: 3.2%; background: linear-gradient(135deg, var(--b1), var(--b3) 30%, var(--b4) 50%, var(--b3) 72%, var(--b1)); }
  .bk { position: relative; height: 100%; border-radius: 2.4% / 1.7%; overflow: hidden; color: #e9edf4; font-family: Inter, system-ui, sans-serif;
    background: radial-gradient(120% 80% at 50% 30%, #1c2638 0%, #121a28 55%, #0b1019 100%);
    box-shadow: inset 0 0 0 .14em #0b1019, inset 0 0 0 .26em var(--bl), inset 0 0 0 .42em #0b1019, inset 0 0 0 .48em var(--bl2);
    display: flex; flex-direction: column; align-items: center; padding: 7% 8% 5.5%; }
  .bk-guil { position: absolute; inset: 0; width: 100%; height: 100%; -webkit-mask-image: radial-gradient(ellipse 75% 42% at 50% 30%, #000 35%, transparent 78%); mask-image: radial-gradient(ellipse 75% 42% at 50% 30%, #000 35%, transparent 78%); }
  .bk-guil path { fill: none; stroke: #d4af6a; stroke-width: .16; opacity: .26; }
  /* calles reales del lugar */
  .bk-map.real { -webkit-mask-image: radial-gradient(ellipse 85% 55% at 50% 26%, #000 40%, transparent 85%); mask-image: radial-gradient(ellipse 85% 55% at 50% 26%, #000 40%, transparent 85%); }
  .bk-map.real path { opacity: 1; stroke-linecap: round; stroke-linejoin: round; }
  .bk-map.real .sm { stroke: rgba(212,175,106,.42); stroke-width: .55; }
  .bk-map.real .sb { stroke: rgba(230,200,140,.7); stroke-width: 1.15; }
  .bk-map.real .st2 { stroke: rgba(212,175,106,.3); stroke-width: .4; stroke-dasharray: 1 1.4; }
  .bk-map.real .sp { fill: #f1dfb2; }
  .bk > *:not(.bk-guil) { position: relative; }
  .bk-top { width: 100%; display: flex; align-items: center; gap: .6em; font-size: .52em; letter-spacing: .28em; text-transform: uppercase; color: #d4af6a; font-weight: 600; }
  .bk-top i { flex: 1; height: 1px; background: linear-gradient(90deg, rgba(212,175,106,.6), rgba(212,175,106,.1)); }
  .bk-seal { width: 62%; margin: 5% 0 2%; transform: rotate(-7deg); filter: drop-shadow(0 .4em .8em rgba(0,0,0,.45)); }
  .bk-seal .s1 { fill: rgba(11,16,25,.55); stroke: #d4af6a; stroke-width: 1.6; }
  .bk-seal .s2 { fill: none; stroke: #d4af6a; stroke-width: .7; stroke-dasharray: 1.5 3; opacity: .8; }
  .bk-seal .sf { clip-path: circle(50%); transform-box: fill-box; transform-origin: center; transform: rotate(7deg); }   /* (el sello va girado -7°: la foto, derecha) */
  .bk-seal .s3 { fill: none; stroke: #f1dfb2; stroke-width: 1.4; }
  .bk-seal .s4 { fill: none; stroke: rgba(255,255,255,.35); stroke-width: .6; stroke-dasharray: 2 2.5; }
  .bk-seal .st { fill: #e3c88d; font: 600 10.5px Inter, system-ui, sans-serif; letter-spacing: 1.5px; }
  .bk-seal .se { text-anchor: middle; font-size: 46px; }
  .bk-seal .sr { text-anchor: middle; fill: #fff4d6; font: 700 11px Inter, system-ui, sans-serif; letter-spacing: 3px; }
  .bk-name { font-family: Georgia, "Times New Roman", serif; font-size: calc(1.32em * var(--k, 1)); line-height: 1.12; text-align: center; color: #fff; font-weight: 700; letter-spacing: -.01em;
    max-width: 100%; overflow-wrap: break-word; }
  .bk-sub { font-size: .66em; color: #9aa6ba; margin-top: .35em; letter-spacing: .04em; text-align: center; }
  .bk-motto { margin-top: auto; margin-bottom: .9em; width: 100%; display: flex; align-items: center; gap: .6em; font-family: Georgia, serif; font-style: italic; font-size: .58em; color: #c9b27c; white-space: nowrap; }
  .bk-motto i { flex: 1; height: 1px; background: rgba(212,175,106,.35); }
  .bk-grid { width: 100%; display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid rgba(212,175,106,.35); }
  .bk-grid div { padding: .5em .2em .45em; border-bottom: 1px solid rgba(212,175,106,.18); min-width: 0; }
  .bk-grid div:nth-child(odd) { border-right: 1px solid rgba(212,175,106,.18); padding-right: .6em; }
  .bk-grid div:nth-child(even) { padding-left: .7em; }
  .bk-grid small { display: block; font-size: .5em; letter-spacing: .16em; text-transform: uppercase; color: #a08a5c; font-weight: 600; }
  .bk-grid b { display: block; font-size: .78em; font-weight: 600; color: #f2f4f8; margin-top: .15em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bk-foot { width: 100%; display: flex; justify-content: space-between; margin-top: .7em; font-size: .5em; letter-spacing: .12em; color: #7f8aa0; font-family: ui-monospace, Consolas, monospace; }
  @media (hover: hover) { .tcg-back .tcg-glare { opacity: .1 !important; } }
  .tcg.flat .tcg-rot { transform: none; } .tcg.flat .tcg-face { box-shadow: none; }
  /* --- mazos por ciudad --- */
  .cstack { margin: 10px 0; }
  .cs-country { margin: 18px 2px 4px; font-size: 18px; font-weight: 800; } .cs-country span { opacity: .55; font-weight: 600; font-size: 14px; margin-left: 4px; }
  .cs-head { width: 100%; display: flex; align-items: center; gap: 16px; padding: 12px 14px; border-radius: 16px; border: 1px solid rgba(127,127,127,.22); background: rgba(127,127,127,.06); cursor: pointer; text-align: left; font: inherit; color: inherit; }
  .cstack.open .cs-head { background: rgba(127,127,127,.12); }
  .cs-deck { position: relative; width: 86px; height: 120px; flex: none; }
  .cs-c { position: absolute; left: 6px; top: 4px; width: 72px; --w: 72px; transform: rotate(calc((var(--k) - 1) * 7deg)) translateX(calc((var(--k) - 1) * 6px)); transform-origin: 50% 90%; filter: drop-shadow(0 3px 5px rgba(0,0,0,.25)); pointer-events: none; }
  .cs-c .tcg.mini { font-size: calc(72px / 26); }
  .cs-info { flex: 1; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .cs-info b { font-size: 17px; } .cs-info small { opacity: .7; font-size: 13.5px; }
  .cs-rar { font-size: 12.5px; opacity: .85; } .cs-rar i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin: 0 3px 0 6px; }
  .cs-rar i.r-legendario { background: #f5b301; } .cs-rar i.r-epico { background: #a855f7; } .cs-rar i.r-raro { background: #3b82f6; } .cs-rar i.r-comun { background: #9aa4b2; }
  .cs-chev { font-size: 26px; opacity: .5; transition: transform .2s; } .cstack.open .cs-chev { transform: rotate(90deg); }
  .cs-grid { padding: 12px 2px 4px; }
  .cs-grid[hidden] { display: none !important; }   /* la rejilla de cartas no debe ganar al "cerrado" */
  /* --- vista grande --- */
  #tcg-view { position: fixed; inset: 0; z-index: 3000; display: none; place-items: center; padding-bottom: calc(92px + env(safe-area-inset-bottom)); background: radial-gradient(circle at 50% 40%, rgba(40,20,80,.75), rgba(5,5,20,.92)); backdrop-filter: blur(6px); }
  #tcg-view.show { display: grid; animation: tcgfade .25s ease-out; }
  @keyframes tcgfade { from { opacity: 0; } }
  .tcg-stage-wrap { --w: min(94vw, 460px, calc((100vh - 150px) * .63)); width: var(--w); display: flex; flex-direction: column; align-items: center; gap: 10px; animation: tcgpop .6s cubic-bezier(.2,1.5,.4,1); }
  .tcg-stage-wrap .tcg { aspect-ratio: 63 / 98; }
  @keyframes tcgpop { from { transform: scale(.4) rotate(-12deg); opacity: 0; } }
  .tcg-badge { background: linear-gradient(90deg, #ffd166, #ffb700); color: #3a2500; font-weight: 900; padding: 6px 16px; border-radius: 99px; box-shadow: 0 0 30px #ffb700aa; font-size: 15px; }
  .tcg-actions { position: fixed; left: 50%; bottom: calc(14px + env(safe-area-inset-bottom)); transform: translateX(-50%); display: flex; gap: 4px; padding: 6px;
    border-radius: 22px; background: rgba(20,18,40,.72); border: 1px solid rgba(255,255,255,.12); backdrop-filter: blur(14px); box-shadow: 0 10px 30px rgba(0,0,0,.45); max-width: calc(100vw - 20px); }
  .tcg-actions button { border: 0; background: transparent; color: #fff; min-width: 64px; padding: 8px 10px 6px; border-radius: 16px; cursor: pointer;
    display: flex; flex-direction: column; align-items: center; gap: 3px; font: 600 11.5px Inter, system-ui, sans-serif; letter-spacing: .01em; -webkit-tap-highlight-color: transparent; transition: background .15s, transform .15s; }
  .tcg-actions button i { font-style: normal; font-size: 20px; line-height: 1; display: grid; place-items: center; width: 38px; height: 38px; border-radius: 50%; background: rgba(255,255,255,.1); }
  .tcg-actions button span { opacity: .85; white-space: nowrap; }
  .tcg-actions button:hover { background: rgba(255,255,255,.08); } .tcg-actions button:active { transform: scale(.94); }
  .tcg-actions button.pri i { background: linear-gradient(135deg, #ff2e88, #ff7a3d); box-shadow: 0 0 16px rgba(255,46,136,.6); }
  .tcg-actions button.pri span { opacity: 1; color: #ffb3d1; }
  .tcg-hint { color: rgba(255,255,255,.6); font: 12.5px Inter, system-ui, sans-serif; margin: 0; text-align: center; }
  `;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  // ---------------- Mazos por ciudad: cada ciudad es un mazo cerrado; al tocarlo se despliegan sus cartas ----------------
  // groups: [{ city, ids:[...] }] · getData(id) → datos de la carta (puede ser async) · onCell(el, id) al dibujar cada carta
  const RANKR = { legendario: 3, epico: 2, raro: 1, comun: 0 };
  // agrupa ciudades por país (con bandera) y ordena ambos alfabéticamente; "Otros" al final
  // nombre del país en el idioma elegido (por su código: el guardado viene de OpenStreetMap en castellano)
  let regiones = null;
  try { regiones = new Intl.DisplayNames([PM.LOCALE || 'es-ES'], { type: 'region' }); } catch (e) { /* navegador antiguo */ }
  const paisNombre = (c) => { try { if (regiones && c.cc && c.cc.length === 2) return regiones.of(c.cc.toUpperCase()); } catch (e) { /* código raro */ } return c.name; };
  function byCountry(groups, countries) {
    const col = (a, b) => a.localeCompare(b, PM.LOCALE || 'es', { sensitivity: 'base' });
    groups.forEach((g) => { const c = (countries || {})[g.city]; g.country = c ? paisNombre(c) : 'Otros países'; g.flag = c ? PM.flag(c.cc) : '🌍'; });
    return groups.sort((a, b) => ((a.country === 'Otros países') - (b.country === 'Otros países')) || col(a.country, b.country)
      || ((a.city === 'Otros lugares') - (b.city === 'Otros lugares')) || col(a.city, b.city));
  }
  async function stacks(container, groups, getData, onCell, gridClass) {
    container.innerHTML = groups.map((g, i) => (g.country && (i === 0 || groups[i - 1].country !== g.country)
      ? `<h4 class="cs-country">${g.flag || ''} ${esc(g.country)} <span>${groups.filter((x) => x.country === g.country).reduce((n, x) => n + x.ids.length, 0)}</span></h4>` : '') +
      `<div class="cstack" data-i="${i}">
      <button class="cs-head"><div class="cs-deck"></div>
        <div class="cs-info"><b>🏙️ ${esc(g.city)}</b><small>${g.ids.length} carta${g.ids.length > 1 ? 's' : ''}</small><span class="cs-rar"></span></div>
        <span class="cs-chev">›</span></button>
      <div class="cs-grid ${gridClass || ''}" hidden></div></div>`).join('');
    container.querySelectorAll('.cstack').forEach(async (el) => {
      const g = groups[+el.dataset.i];
      const datas = await Promise.all(g.ids.map(async (id) => [id, await getData(id)]));
      // las 3 más valiosas (y recientes) arriba del mazo
      datas.sort((a, b) => (RANKR[b[1].rarity] || 0) - (RANKR[a[1].rarity] || 0) || (b[1].t || 0) - (a[1].t || 0));
      el.querySelector('.cs-deck').innerHTML = datas.slice(0, 3).reverse().map(([, d], k, arr) =>
        `<div class="cs-c" style="--k:${arr.length - 1 - k}">${html(d, { mini: true })}</div>`).join('');
      const cnt = {}; datas.forEach(([, d]) => (cnt[d.rarity] = (cnt[d.rarity] || 0) + 1));
      el.querySelector('.cs-rar').innerHTML = ['legendario', 'epico', 'raro', 'comun'].filter((r) => cnt[r]).map((r) => `<i class="r-${r}"></i>${cnt[r]}`).join(' ');
      const grid = el.querySelector('.cs-grid');
      el.querySelector('.cs-head').addEventListener('click', () => {
        const open = grid.hidden;
        grid.hidden = !open; el.classList.toggle('open', open);
        if (open && !grid.childElementCount) {   // las cartas se dibujan solo al abrir el mazo
          datas.sort((a, b) => (b[1].t || 0) - (a[1].t || 0));
          grid.innerHTML = datas.map(([id, d]) => `<div class="tcg-cell" data-lm="${esc(id)}">${html(d, { mini: true })}</div>`).join('');
          grid.querySelectorAll('.tcg-cell').forEach((c) => onCell && onCell(c, c.dataset.lm));
        }
        if (open) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
      });
    });
  }

  return { _tamTitulo: tamTitulo, html, open, close, interactive, toPng, download, typeOf, stacks, byCountry };
})();
