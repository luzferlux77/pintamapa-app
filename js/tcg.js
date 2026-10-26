// PintaMapa — cartas coleccionables estilo TCG (como las de Pokémon): anverso con "tipo", PTS, ataques,
// debilidad/resistencia, historia y número de colección; reverso con emblema; brillo holográfico que sigue
// al ratón o a la inclinación del móvil; se voltea al tocarla. Se usa en la app y en «Mi progreso».
PM.tcg = (function () {
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // "Tipos" según la clase de sitio: color de la carta y orbe
  const TYPES = {
    ayto:     { name: 'Gobierno',  c1: '#fff6d6', c2: '#f3cf6b', orb: '#e0a400', kinds: ['Ayuntamiento'] },
    templo:   { name: 'Espíritu',  c1: '#f1e6ff', c2: '#c7a6f2', orb: '#8b5cf6', kinds: ['Iglesia', 'Iglesia principal', 'Basílica', 'Catedral', 'Templo', 'Ermita / Monasterio'] },
    historia: { name: 'Historia',  c1: '#f5e9dc', c2: '#d6b48e', orb: '#a16207', kinds: ['Castillo', 'Palacio', 'Patrimonio', 'Molino', 'Monumento', 'Torre / Puerta', 'Puente', 'Ruinas', 'Lugar histórico', 'Memorial'] },
    cultura:  { name: 'Cultura',   c1: '#e3f1ff', c2: '#9cc7f2', orb: '#2563eb', kinds: ['Museo', 'Teatro', 'Biblioteca', 'Universidad', 'Estudio de televisión'] },
    deporte:  { name: 'Deporte',   c1: '#ffe6e1', c2: '#f5a08f', orb: '#e53e1f', kinds: ['Estadio', 'Campo de fútbol'] },
    verde:    { name: 'Naturaleza', c1: '#e3f7e3', c2: '#9fd89f', orb: '#16a34a', kinds: ['Parque', 'Mirador', 'Zoo / Acuario'] },
    ciudad:   { name: 'Ciudad',    c1: '#eef0f4', c2: '#c3c9d4', orb: '#64748b', kinds: ['Parque temático', 'Rascacielos', 'Aeropuerto', 'Estación', 'Plaza', 'Mercado'] },
  };
  const typeOf = (kind) => Object.entries(TYPES).find(([, t]) => t.kinds.includes(kind)) || ['ciudad', TYPES.ciudad];
  const RAR = { comun: { sym: '●', name: 'Común', holo: 0.15 }, raro: { sym: '◆', name: 'Rara', holo: 0.45 }, epico: { sym: '★', name: 'Épica', holo: 0.8 }, legendario: { sym: '★★', name: 'Legendaria', holo: 1 } };
  const WEAK = [['🛋️', 'Sofá', '×2'], ['📺', 'Series', '×2'], ['🛵', 'Prisas', '×2'], ['📱', 'Scroll', '×2']];
  const RES = [['☔', 'Lluvia', '−20'], ['🌙', 'Noche', '−20'], ['🥶', 'Frío', '−20'], ['🔥', 'Calor', '−20']];
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
    const out = [], her = +d.her || 0, y = +d.anio || 0, vis = +d.vis || 0, wp = +d.wp || 0;
    if (her === 3) out.push(T('Es Patrimonio de la Humanidad por la UNESCO.'));
    else if (her === 2) out.push(T('Está protegido como patrimonio nacional.'));
    else if (her === 1) out.push(T('Está catalogado como patrimonio protegido.'));
    if (y > 0 && y < 1800) { const sg = Math.floor((y - 1) / 100) + 1; out.push(T('Data del siglo {s}.', { s: ROM[sg] || sg })); }
    else if (y >= 1800) out.push(T('Es de {y}.', { y }));
    if (vis >= 1e6) out.push(T('Recibe unos {n} millones de visitantes al año.', { n: num(vis / 1e6, 1) }));
    else if (vis >= 20000) out.push(T('Recibe unos {n} mil visitantes al año.', { n: num(Math.round(vis / 1000)) }));
    if (wp >= 10) out.push(T('Tiene artículo en la Wikipedia de {n} idiomas.', { n: wp }));
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
        if (/Wikip[eè]dia/.test(f)) continue;   // (con su propio artículo, el número de idiomas no aporta)
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
  const fitClass = (t) => { const n = t.length; return n <= 300 ? 'f1' : n <= 390 ? 'f2' : n <= 470 ? 'f3' : 'f4'; };
  // ya en pantalla: la letra más grande con la que el texto cabe ENTERO (medido de verdad, no por número de letras)
  function autofit(el) {
    if (!el || !el.clientHeight) return;
    for (const c of ['f1', 'f2', 'f3', 'f4']) { el.className = 'tcg-flavor ' + c; if (el.scrollHeight <= el.clientHeight + 1) return; }
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
  function backHTML(d, R) {
    const seed = hash(d.id), uid = 'bk' + seed;
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
          <circle cx="100" cy="100" r="60" fill="${color}"/><circle cx="100" cy="100" r="60" fill="url(#${uid}g)"/>
          <circle cx="100" cy="100" r="60" class="s3"/><circle cx="100" cy="100" r="54" class="s4"/>
          <text x="100" y="114" class="se">${d.emoji || '📍'}</text>
          <text x="100" y="146" class="sr">${esc(R.sym)}</text>
        </svg>
        <div class="bk-name" translate="no">${esc(d.name)}</div>
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

  // «por qué merece la pena» (se guarda en castellano: se traduce cada trozo al enseñarlo)
  const porque = (p) => String(p).split(' · ').map((x) => T(x)).join(' · ');

  // ---------------- HTML de la carta ----------------
  // d = { id, name, kind, emoji, rarity, city, barrio, t, visits, img, own, text, points, number, total, player, credit }
  function html(d, opts = {}) {
    const [tk, T] = typeOf(d.kind);
    const R = RAR[d.rarity] || RAR.comun;
    const w = WEAK[hash(d.id) % WEAK.length], r = RES[hash(d.id + 'r') % RES.length];
    const pts = d.points || 100, revisit = Math.round(pts * 0.2);
    const energy = (n) => `<span class="tcg-en">${('<i style="background:' + T.orb + '"></i>').repeat(n)}</span>`;
    return `<div class="tcg r-${d.rarity || 'comun'} t-${tk} ${opts.mini ? 'mini' : ''} ${d.shiny ? 'shiny' : ''} ${d.must ? 'must' : ''}" style="--orb:${T.orb};--c1:${T.c1};--c2:${T.c2};--holo:${R.holo}" data-id="${esc(d.id)}">
      <div class="tcg-rot">
        <div class="tcg-face tcg-front">
          <div class="tcg-inner">
            <div class="tcg-top">
              <div class="tcg-stage"><span>${esc(PM.t(T.name))} · ${esc(PM.t(R.name))}</span><span class="tcg-code">${code(d)}</span></div>
              ${d.shiny || d.must ? `<div class="tcg-shinytag ${d.must ? 'musttag' : ''}">${d.must ? '⭐ IMPRESCINDIBLE' : ''}${d.must && d.shiny ? ' · ' : ''}${d.shiny ? '✨ BRILLANTE' : ''}</div>` : ''}
              <div class="tcg-title"><b translate="no">${esc(d.name)}</b><span class="tcg-hp"><small>PTS</small>${pts}<i class="tcg-orb">${d.emoji || '📍'}</i></span></div>
            </div>
            <div class="tcg-art">
              <div class="tcg-photo" ${d.img ? `style="background-image:url('${esc(d.img)}')"` : ''}>${d.img ? '' : `<span>${d.emoji || '📍'}</span>`}</div>
              <div class="tcg-shine"></div><div class="tcg-glitter"></div>
            </div>
            <div class="tcg-band" translate="no">${esc(PM.t(d.kind || ''))}${d.city ? ' · ' + esc(d.city) : ''}</div>
            ${d.porque ? `<div class="tcg-why" translate="no">${esc(porque(d.porque))}</div>` : ''}
            <div class="tcg-stats">
              <div><i>⏱</i><b>10 s</b><small>captura</small></div>
              <div><i>📍</i><b>${d.capR || (PM.capRadius ? PM.capRadius(d.kind) : 30)} m</b><small>radio</small></div>
              <div><i>✨</i><b>×2</b><small>aura 80 m</small></div>
              <div><i>💎</i><b>${R.sym}</b><small>${esc(PM.t(R.name).toLowerCase())}</small></div>
            </div>
            ${(() => { const tx = descText(d); return `<div class="tcg-flavor ${fitClass(tx)}" translate="no">${esc(tx)}</div>`; })()}
            <div class="tcg-rule"><b>REGLA</b> 🔁 Vuelve cada día y suma +${revisit} pts por visita · ✨ las calles que pintes a menos de 80 m valen el doble.</div>
            <div class="tcg-wrr">
              <div><small>debilidad</small>${w[0]} ${w[2]}</div>
              <div><small>resistencia</small>${r[0]} ${r[2]}</div>
              <div><small>retirada</small>👟👟</div>
            </div>
            <div class="tcg-foot"><span>${esc(d.own ? 'Foto: propia del pintor' : (d.credit || 'Foto: Wikimedia Commons'))}</span>
              <span class="tcg-set">🖌️ PintaMapa <b>${R.sym}</b></span></div>
          </div>
          <div class="tcg-foil"></div><div class="tcg-glare"></div>
        </div>
        ${backHTML(d, R)}
      </div>
    </div>`;
  }

  // ---------------- Interacción: inclinación 3D + brillo que sigue al puntero; tocar = voltear ----------------
  function interactive(el) {
    const rot = el.querySelector('.tcg-rot');
    let flipped = false, raf = null, target = { x: 50, y: 50 }, cur = { x: 50, y: 50 }, active = false;
    const touch = !!(window.matchMedia && matchMedia('(hover: none)').matches);
    const apply = () => {
      const k = el._soft ? 0.1 : 0.18; cur.x += (target.x - cur.x) * k; cur.y += (target.y - cur.y) * k;
      // en el móvil la carta no gira en 3D (eso parpadeaba): solo se mueve el holograma; en el PC, giro con el ratón
      const rx = touch ? 0 : (cur.y - 50) / 50 * -14, ry = touch ? 0 : (cur.x - 50) / 50 * 18;
      el.style.setProperty('--mx', cur.x + '%'); el.style.setProperty('--my', cur.y + '%');
      el.style.setProperty('--rx', rx + 'deg'); el.style.setProperty('--ry', (flipped ? 180 : 0) + ry + 'deg');
      el.style.setProperty('--hyp', Math.min(1, Math.hypot(cur.x - 50, cur.y - 50) / 50).toFixed(3));
      if (Math.abs(target.x - cur.x) > 0.1 || Math.abs(target.y - cur.y) > 0.1) raf = requestAnimationFrame(apply); else raf = null;
    };
    const go = () => { if (!raf) raf = requestAnimationFrame(apply); };
    const point = (cx, cy) => { const b = el.getBoundingClientRect(); target = { x: Math.max(0, Math.min(100, (cx - b.left) / b.width * 100)), y: Math.max(0, Math.min(100, (cy - b.top) / b.height * 100)) }; active = true; el.classList.add('active'); go(); };
    el.addEventListener('pointermove', (e) => { if (e.pointerType !== 'mouse') return; el._soft = false; point(e.clientX, e.clientY); });
    el.addEventListener('pointerleave', () => { target = { x: 50, y: 50 }; active = false; el.classList.remove('active'); go(); });
    el.addEventListener('click', () => { flipped = !flipped; el.classList.toggle('flipped', flipped); rot.style.transition = 'transform .8s cubic-bezier(.3,1.5,.5,1)'; go(); setTimeout(() => { rot.style.transition = ''; }, 800); });
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
      target = { x: 50 + clamp((e.gamma - base.g) * 1.8), y: 50 + clamp((e.beta - base.b) * 1.8) };
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
  .tcg { --mx: 50%; --my: 50%; --rx: 0deg; --ry: 0deg; --hyp: 0; --y: #f6d44c; position: relative; width: 100%; aspect-ratio: 63 / 88; perspective: 1200px; font-family: Inter, system-ui, sans-serif; font-size: calc(var(--w, 360px) / 26); user-select: none; cursor: pointer; }
  .tcg.mini { font-size: 6.4px; cursor: pointer; }
  .tcg-rot { position: absolute; inset: 0; transform-style: preserve-3d; transform: rotateX(var(--rx)) rotateY(var(--ry)); will-change: transform; }
  .tcg-face { position: absolute; inset: 0; border-radius: 4.5% / 3.3%; overflow: hidden; backface-visibility: hidden; -webkit-backface-visibility: hidden; box-shadow: 0 1.4em 3em rgba(0,0,0,.35), 0 0 0 1px rgba(0,0,0,.15); }
  .tcg-front { background: linear-gradient(135deg, #fff1a8, var(--y) 30%, #e8b923 60%, #fff3b0); padding: 3.6%; }
  .r-legendario .tcg-front { background: linear-gradient(135deg, #fff6cf, #e6c25a 20%, #fffbe8 40%, #d4a52c 60%, #fff2b8 80%, #c99a24); }
  .tcg-inner { position: relative; height: 100%; border-radius: 2.4% / 1.7%; background: linear-gradient(170deg, var(--c1), var(--c2)); padding: 2.6% 4%; display: flex; flex-direction: column; gap: .35em; box-shadow: inset 0 0 0 .18em rgba(0,0,0,.18); }
  .tcg-stage { display: flex; justify-content: space-between; font-size: .58em; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; color: rgba(0,0,0,.55); }
  .tcg-code { font-family: ui-monospace, Consolas, monospace; letter-spacing: .02em; color: rgba(0,0,0,.45); }
  .tcg-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: .3em; }
  .tcg-stats div { text-align: center; background: linear-gradient(180deg, rgba(255,255,255,.75), rgba(255,255,255,.35)); border: .08em solid rgba(0,0,0,.12); border-radius: .5em; padding: .15em 0 .2em; line-height: 1.05; }
  .tcg-stats i { font-style: normal; font-size: .7em; display: block; } .tcg-stats b { display: block; font-size: .78em; font-weight: 900; color: #1b1b1b; }
  .tcg-stats small { display: block; font-size: .46em; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: rgba(0,0,0,.5); }
  .tcg-rule { font-size: .52em; line-height: 1.35; color: #3a2500; background: linear-gradient(90deg, #ffe9a8, #f6d36b); border-radius: .45em; padding: .35em .6em; box-shadow: inset 0 0 0 .1em rgba(160,110,10,.45); }
  .tcg-rule b { background: #b45309; color: #fff; padding: .05em .45em; border-radius: .3em; margin-right: .3em; letter-spacing: .05em; }
  .tcg-title { display: flex; align-items: center; justify-content: space-between; gap: .5em; }
  .tcg-title b { font-size: 1.3em; font-weight: 900; color: #1b1b1b; line-height: 1.05; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; letter-spacing: -.01em; }
  .tcg-hp { display: flex; align-items: center; gap: .25em; font-weight: 900; font-size: 1.25em; color: #c81e1e; white-space: nowrap; }
  .tcg-hp small { font-size: .5em; color: #c81e1e; }
  .tcg-orb { display: grid; place-items: center; width: 1.6em; height: 1.6em; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #fff8, transparent 45%), var(--orb); font-style: normal; font-size: .85em; box-shadow: 0 .1em .25em rgba(0,0,0,.4), inset 0 -.15em .3em rgba(0,0,0,.25); }
  .tcg-art { position: relative; height: auto; flex: 1 1 33%; min-height: 28%; border-radius: .3em; overflow: hidden; border: .32em solid; border-image: linear-gradient(135deg, #f4f4f4, #9a9a9a, #fafafa, #8a8a8a) 1; box-shadow: 0 .2em .5em rgba(0,0,0,.35); background: #ddd; }
  .tcg-photo { position: absolute; inset: 0; background: center / cover no-repeat; display: grid; place-items: center; background-color: #e9e2d4; }
  .tcg-photo span { font-size: 4.5em; filter: drop-shadow(0 .1em .2em rgba(0,0,0,.3)); }
  .tcg-own { position: absolute; right: .4em; bottom: .4em; background: #ff2e88; color: #fff; font-size: .62em; font-weight: 800; padding: .2em .6em; border-radius: 99px; transform: rotate(-4deg); z-index: 3; }
  .tcg-why { margin: .15em auto 0; font-size: .55em; font-weight: 800; text-align: center; color: #7a4a00; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; padding: 0 1em; letter-spacing: .01em; }
  .tcg-band { margin: -.1em auto 0; font-size: .6em; font-style: italic; font-weight: 600; text-align: center; color: #3a2a00; background: linear-gradient(90deg, transparent, rgba(255,255,255,.75), transparent); padding: .2em 1.5em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  .tcg-moves { display: flex; flex-direction: column; justify-content: center; gap: .05em; margin-top: .2em; }
  .tcg-move { display: flex; align-items: center; gap: .45em; } .tcg-move b { flex: 1; font-size: .95em; font-weight: 900; color: #1b1b1b; } .tcg-move span { font-size: 1.05em; font-weight: 900; color: #1b1b1b; }
  .tcg-moves p { margin: 0 0 .2em 3.2em; font-size: .56em; line-height: 1.3; color: #2c2c2c; }
  .tcg-moves { gap: .15em !important; }
  .tcg-en { display: inline-flex; gap: .15em; min-width: 2.6em; } .tcg-en i { width: .95em; height: .95em; border-radius: 50%; box-shadow: inset 0 -.1em .15em rgba(0,0,0,.35), 0 0 0 .08em rgba(255,255,255,.7); }
  .tcg-wrr { display: flex; justify-content: space-between; border-top: .1em solid rgba(0,0,0,.25); padding-top: .2em; font-size: .7em; font-weight: 700; color: #222; }
  .tcg-wrr small { display: block; font-size: .7em; font-weight: 600; color: rgba(0,0,0,.55); text-transform: lowercase; }
  /* cuadro de descripción: alto fijo (ocupa también el hueco de las antiguas filas de conquista/revisita) y la letra
     se ajusta a lo largo del texto para que quepa ENTERO (f1 corto … f4 largo) */
  .tcg-flavor { flex: none; height: 7.9em; box-sizing: border-box; font-size: 1em; font-style: italic; line-height: 1.3; border: .12em solid rgba(160,120,20,.55); border-radius: .4em; padding: .35em .55em; background: rgba(255,255,255,.4);
    overflow: hidden; text-align: left; hyphens: auto; font-weight: 500; color: #1d1d1d; }
  .tcg-flavor.f1 { font-size: .74em; height: calc(7.9em / .74); } .tcg-flavor.f2 { font-size: .66em; height: calc(7.9em / .66); }
  .tcg-flavor.f3 { font-size: .59em; height: calc(7.9em / .59); } .tcg-flavor.f4 { font-size: .53em; height: calc(7.9em / .53); }
  .tcg-foot { display: flex; justify-content: space-between; align-items: center; font-size: .5em; color: rgba(0,0,0,.6); font-weight: 600; }
  .tcg-set b { color: #111; margin-left: .3em; }
  /* --- brillo holográfico --- */
  .tcg-shine, .tcg-glitter, .tcg-glare { position: absolute; inset: 0; pointer-events: none; z-index: 2; }
  /* franja holográfica suave que barre la carta al moverla */
  .tcg-shine { opacity: calc(var(--holo) * (.12 + var(--hyp) * .55)); mix-blend-mode: color-dodge;
    background: linear-gradient(115deg, transparent 18%, rgba(255,0,128,.65) 30%, rgba(255,200,0,.6) 38%, rgba(0,255,160,.55) 46%, rgba(0,190,255,.6) 54%, rgba(170,0,255,.6) 62%, transparent 75%);
    background-size: 260% 260%; background-position: var(--mx) var(--my); filter: saturate(1.2); }
  .r-legendario .tcg-inner::after { content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; mix-blend-mode: color-dodge; opacity: calc(.03 + var(--hyp) * .18);
    background: linear-gradient(115deg, transparent 20%, rgba(255,0,128,.6) 34%, rgba(255,210,0,.55) 44%, rgba(0,200,255,.55) 54%, rgba(170,0,255,.5) 64%, transparent 78%); background-size: 280% 280%; background-position: var(--mx) var(--my); }
  /* destellos finos y aleatorios (textura de ruido, como el foil real) solo alrededor del punto de luz */
  .tcg-glitter { opacity: calc(var(--holo) * var(--hyp)); mix-blend-mode: color-dodge;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.25' numOctaves='1' seed='7' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 16 -12.4'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    background-size: 11em 11em; background-position: calc(var(--mx) * -.15) calc(var(--my) * -.15);
    -webkit-mask-image: radial-gradient(circle at var(--mx) var(--my), #000 0%, rgba(0,0,0,.55) 16%, transparent 38%); mask-image: radial-gradient(circle at var(--mx) var(--my), #000 0%, rgba(0,0,0,.55) 16%, transparent 38%); }
  .tcg-glare { z-index: 4; mix-blend-mode: soft-light; opacity: calc(.25 + var(--hyp) * .6); background: radial-gradient(circle at var(--mx) var(--my), rgba(255,255,255,.95) 0%, rgba(255,255,255,.35) 12%, rgba(255,255,255,0) 32%, rgba(0,0,0,.18) 100%); }
  .tcg:not(.active) .tcg-glare { opacity: .15; }
  /* lámina holográfica sobre TODA la carta: bandas de arcoíris + reflejo que se deslizan al mover la carta (o el ratón) */
  /* (sutil, como un cromo de verdad: casi invisible de frente; una franja de color suave aparece al inclinar) */
  .tcg-foil { position: absolute; inset: 0; pointer-events: none; z-index: 3; border-radius: inherit; mix-blend-mode: overlay;
    opacity: calc(var(--holo) * (.07 + var(--hyp) * .45));
    background: linear-gradient(115deg, transparent 28%, rgba(255,140,200,.5) 38%, rgba(255,226,140,.45) 44%, rgba(150,255,215,.45) 50%, rgba(140,195,255,.5) 56%, rgba(200,160,255,.45) 62%, transparent 72%);
    background-size: 300% 300%; background-position: var(--mx) var(--my); }
  .tcg-foil::after { content: ''; position: absolute; inset: 0; border-radius: inherit; mix-blend-mode: soft-light;
    background: linear-gradient(115deg, transparent 44%, rgba(255,255,255,.7) 50%, transparent 56%); background-size: 260% 260%; background-position: var(--mx) var(--my); }
  .tcg.flat .tcg-foil { opacity: .12; }
  /* carta BRILLANTE: marco dorado, lámina dorada visible siempre y destellos que recorren la carta */
  .tcg.shiny { box-shadow: 0 0 0 .18em #f5c542, 0 0 1.4em rgba(250,204,21,.65); }
  .tcg.shiny .tcg-foil { opacity: calc(.32 + var(--hyp) * .5); mix-blend-mode: color-dodge;
    background: linear-gradient(115deg, rgba(255,215,0,0) 20%, rgba(255,223,90,.55) 35%, rgba(255,255,255,.65) 45%, rgba(255,190,60,.55) 55%, rgba(255,215,0,0) 72%); background-size: 260% 260%;
    animation: shinysweep 3.2s linear infinite; }
  @keyframes shinysweep { from { background-position: 120% 0; } to { background-position: -40% 0; } }
  .tcg.shiny .tcg-glitter { opacity: .9 !important; }
  /* IMPRESCINDIBLE: marco rojo y dorado, estrella y cinta (vale el doble) */
  .tcg.must { box-shadow: 0 0 0 .22em #f59e0b, 0 0 0 .42em #b91c1c, 0 0 1.6em rgba(245,158,11,.55); }
  .tcg.must .tcg-front::after { content: '⭐'; position: absolute; z-index: 7; right: .35em; bottom: .3em; font-size: 1.15em; filter: drop-shadow(0 1px 2px rgba(0,0,0,.4)); }
  .tcg-shinytag.musttag { background: linear-gradient(90deg, #991b1b, #f59e0b, #991b1b); color: #fff; text-shadow: 0 1px 1px rgba(0,0,0,.35); }
  .tcg-shinytag { position: absolute; z-index: 6; left: 50%; top: -.55em; transform: translateX(-50%); background: linear-gradient(90deg, #b45309, #facc15, #b45309);
    color: #1a1200; font-weight: 900; font-size: .62em; letter-spacing: .12em; padding: .18em .8em; border-radius: 99px; box-shadow: 0 2px 6px rgba(0,0,0,.3); white-space: nowrap; }
  .tcg.mini .tcg-shinytag { font-size: .55em; }
  /* holograma del reverso: arcoíris muy suave que se desliza al mover la carta */
  .bk-holo { position: absolute; inset: 0; pointer-events: none; z-index: 3; border-radius: inherit; mix-blend-mode: overlay; opacity: calc(.04 + var(--hyp) * .2);
    background: linear-gradient(120deg, transparent 20%, rgba(255,80,170,.55) 32%, rgba(255,220,90,.5) 40%, rgba(80,255,190,.45) 48%, rgba(90,190,255,.55) 56%, rgba(190,110,255,.5) 64%, transparent 76%);
    background-size: 280% 280%; background-position: var(--mx) var(--my); }
  @media (hover: none) {
    /* móvil: holograma estable (mezcla "overlay", sin destellos de ruido ni giro 3D) */
    .tcg-glitter { display: none; }
    .r-legendario .tcg-inner::after { display: none; }
    .tcg-shine { mix-blend-mode: overlay; opacity: calc(var(--holo) * (.12 + var(--hyp) * .45)); filter: none;
      background: linear-gradient(115deg, transparent 25%, rgba(255,120,190,.6) 37%, rgba(255,220,120,.55) 44%, rgba(130,255,205,.55) 51%, rgba(120,180,255,.6) 58%, rgba(190,140,255,.55) 65%, transparent 76%);
      background-size: 320% 320%; background-position: var(--mx) var(--my); }
    .tcg-shine::after { content: ''; position: absolute; inset: 0; mix-blend-mode: soft-light;
      background: linear-gradient(115deg, transparent 44%, rgba(255,255,255,.65) 50%, transparent 56%); background-size: 260% 260%; background-position: var(--mx) var(--my); }
    .tcg-glare { mix-blend-mode: soft-light; }
  }
  /* --- reverso: sello de conquista --- */
  .tcg-back { transform: rotateY(180deg); padding: 3.2%; background: linear-gradient(135deg, #e9d7a6, #b8955a 30%, #f3e6c4 50%, #a8844a 72%, #e2cd98); }
  .bk { position: relative; height: 100%; border-radius: 2.4% / 1.7%; overflow: hidden; color: #e9edf4; font-family: Inter, system-ui, sans-serif;
    background: radial-gradient(120% 80% at 50% 30%, #1c2638 0%, #121a28 55%, #0b1019 100%);
    box-shadow: inset 0 0 0 .14em #0b1019, inset 0 0 0 .26em rgba(212,175,106,.75), inset 0 0 0 .42em #0b1019, inset 0 0 0 .48em rgba(212,175,106,.35);
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
  .bk-seal { width: 56%; margin: 6% 0 3%; transform: rotate(-7deg); filter: drop-shadow(0 .4em .8em rgba(0,0,0,.45)); }
  .bk-seal .s1 { fill: rgba(11,16,25,.55); stroke: #d4af6a; stroke-width: 1.6; }
  .bk-seal .s2 { fill: none; stroke: #d4af6a; stroke-width: .7; stroke-dasharray: 1.5 3; opacity: .8; }
  .bk-seal .s3 { fill: none; stroke: #f1dfb2; stroke-width: 1.4; }
  .bk-seal .s4 { fill: none; stroke: rgba(255,255,255,.35); stroke-width: .6; stroke-dasharray: 2 2.5; }
  .bk-seal .st { fill: #e3c88d; font: 600 10.5px Inter, system-ui, sans-serif; letter-spacing: 1.5px; }
  .bk-seal .se { text-anchor: middle; font-size: 46px; }
  .bk-seal .sr { text-anchor: middle; fill: #fff4d6; font: 700 11px Inter, system-ui, sans-serif; letter-spacing: 3px; }
  .bk-name { font-family: Georgia, "Times New Roman", serif; font-size: 1.32em; line-height: 1.12; text-align: center; color: #fff; font-weight: 700; letter-spacing: -.01em;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; max-width: 100%; }
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
  .tcg-back .tcg-glare { opacity: .1 !important; }
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

  return { html, open, close, interactive, toPng, download, typeOf, stacks, byCountry };
})();
