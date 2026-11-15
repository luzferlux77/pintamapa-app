// PintaMapa — álbumes de ciudad: cada ciudad es un archivador con su portada y una carpeta de color por distrito, con sus
// barrios como separadores, cada cromo pegado en su sitio y un hueco con el nombre de lo que falta. El álbum aparece la
// primera vez que pisas la ciudad.
// La lista fija sale de scripts/pois/albumes.mjs; world.js (albumDe) la recorta con el contorno real del municipio.
PM.album = (function () {
  // (en «Mi progreso» la partida es la de la nube, y el contorno de cada ciudad se pide allí: usar({ save, albumDe }))
  let fuente = null;
  const usar = (f) => { fuente = f; };
  const S = () => (fuente ? fuente.save() : PM.state.data), esc = PM.esc, W = () => fuente || PM.world;
  const NO_ES_CIUDAD = /^(Zona sin nombre|Ciudad desconocida|Ciudad Demo|Otras|Otros lugares|Sector )/;
  // (la URL va dentro de url('…'): un apóstrofo del nombre del archivo la rompería)
  const fondo = (u) => (u ? `background-image:url('${esc(String(u).replace(/'/g, '%27'))}')` : '');

  // Qué carta tuya va en cada hueco: por identificador, por Wikidata o por ser el mismo sitio. Las que no tienen hueco, aparte.
  function enlazar(A, landmarks, city) {
    const mias = Object.entries(landmarks).filter(([, r]) => r.city === city), libres = new Map(mias), porWd = new Map();
    for (const [id, r] of mias) { if (r.wd) porWd.set(r.wd, id); if (/^n[QM]\d/.test(id)) porWd.set(id.slice(1), id); }
    const huecos = A.l.map((e) => Object.assign({}, e, { id: null }));
    for (const e of huecos) { const id = porWd.get(e.q); if (id && libres.has(id)) { e.id = id; libres.delete(id); } }
    for (const e of huecos) {
      if (e.id) continue;
      for (const [id, r] of libres) if (PM.lugares.esMust(e, id, r)) { e.id = id; libres.delete(id); break; }
    }
    // (ni los extras de las ciudades enormes ni lo tuyo fuera de la lista cuentan para completar el álbum; sin lista, tus cartas son el álbum)
    const principal = huecos.filter((e) => !e.extra), extras = huecos.filter((e) => e.extra), otras = [...libres.keys()];
    return { huecos, principal, extras, otras, got: principal.length ? principal.filter((e) => e.id).length : otras.length, total: principal.length || otras.length };
  }
  function ciudades() {
    const s = S(), set = new Set(Object.keys(s.albumes || {}));
    for (const r of Object.values(s.landmarks || {})) if (r.city && !NO_ES_CIUDAD.test(r.city)) set.add(r.city);
    return [...set];
  }

  // Colores de las carpetas: de papelería, oscuros para que el texto blanco se lea (contraste de 4,5 o más) y ordenados para que
  // dos carpetas seguidas nunca se parezcan
  const TINTAS = ['#b91c1c', '#1d4ed8', '#a16207', '#0f766e', '#be185d', '#15803d', '#6d28d9', '#c2410c', '#0e7490', '#a21caf', '#4d7c0f', '#4338ca'];
  const ORO = { c: '#f5b301', on: '#3b2a00', tx: '#7a5600' }, PIZARRA = { c: '#475569', on: '#fff' }, TAPA = { c: '#1f2937', on: '#fff', t: '#faf8f3', b: '#e6e1d6' };
  const claro = (hex, k) => '#' + [1, 3, 5].map((i) => { const v = parseInt(hex.slice(i, i + 2), 16); return Math.round(255 - (255 - v) * k).toString(16).padStart(2, '0'); }).join('');
  const tinta = (k) => { const { c, on, tx, t, b } = k.tinta; return `--c:${c};--on:${on};--tx:${tx || c};--t:${t || claro(c, 0.1)};--b:${b || claro(c, 0.38)}`; };

  // ---------------- Portada ----------------
  function portada(city, A, E, grande, sinPie) {
    const total = A ? E.total : 0, pct = total ? Math.min(100, Math.round(E.got / total * 100)) : 0, ex = A ? E.extras : [];
    return `<div class="ab-foto" style="${fondo(A && A.portada)}"></div><div class="ab-velo"></div>
      <div class="ab-marca" translate="no"><span>Pinta</span><span>Mapa</span></div>
      <div class="ab-tit"><small>${PM.t('Álbum de')}</small><b translate="no" class="${city.length > 14 ? 'largo' : ''}">${esc(city)}</b></div>
      ${A && !sinPie ? `<div class="ab-pie"><span class="ab-n">${total && pct >= 100 ? '🏅 ' : ''}${E.got}<small> / ${total}</small></span><i class="ab-bar"><em style="width:${pct}%"></em></i>${ex.length ? `<span class="ab-ex">✨ ${ex.filter((e) => e.id).length}/${ex.length}</span>` : ''}</div>` : ''}${grande ? '' : '<span class="ab-go">›</span>'}`;
  }

  // ---------------- Vistas: álbumes → archivador de una ciudad, con sus pestañas ----------------
  function montar(box, opts) {
    estilos();
    const volver = (txt, fn) => { const b = document.createElement('button'); b.className = 'ab-back'; b.textContent = '‹ ' + txt; b.addEventListener('click', fn); return b; };

    async function inicio() {
      const lista = ciudades(), s = S();
      box.dataset.vista = 'inicio';
      if (!lista.length) { box.innerHTML = '<p class="muted">Aún no tienes álbumes. Pisa una ciudad y aparecerá aquí.</p>'; return; }
      lista.sort((a, b) => (Object.values(s.landmarks).filter((r) => r.city === b).length - Object.values(s.landmarks).filter((r) => r.city === a).length) || a.localeCompare(b));
      const gr = PM.tcg.byCountry(lista.map((city) => ({ city, ids: [] })), s.countries);
      box.innerHTML = gr.map((g, i) => (i === 0 || gr[i - 1].country !== g.country ? `<h4 class="cs-country">${g.flag || ''} ${esc(g.country)}</h4>` : '') +
        `<button class="ab-cover" data-c="${esc(g.city)}">${portada(g.city, null, null)}</button>`).join('');
      box.querySelectorAll('.ab-cover').forEach(async (el) => {
        const city = el.dataset.c;
        el.addEventListener('click', () => ciudad(city));
        const A = await W().albumDe(city);
        if (el.isConnected) el.innerHTML = portada(city, A, enlazar(A, S().landmarks, city));
      });
      const pos = {}; for (const r of Object.values(s.landmarks)) if (r.city && r.pos && !pos[r.city]) pos[r.city] = r.pos;
      PM.ensureCountries(s, pos).then((ch) => { if (ch) { PM.state.save(); if (box.isConnected && box.querySelector('.ab-cover')) inicio(); } });
    }

    // El álbum es un archivador: la portada, y luego una carpeta de color por distrito. El orden y el color son fijos (por tamaño,
    // nunca por progreso): como en una carpeta de verdad, se recuerda dónde está cada cosa y qué color tiene
    function carpetasDe(city, A, E) {
      const cuenta = (x, y) => y.L.length - x.L.length || (x.nombre < y.nombre ? -1 : 1), C = [{ nombre: PM.t('Portada'), portada: true, L: [], subs: [], tinta: TAPA }];
      E.principal.concat(E.extras).forEach((e, i) => { e.n = i + 1; });   // (el número del cromo, como en los álbumes de papel)
      const cuadernos = A.b.map((n, i) => ({ nombre: n, d: (A.d || [])[i] || '', L: E.principal.filter((e) => e.bi === i) })).filter((x) => x.L.length);
      const sinNombre = cuadernos.length === 1 ? city : PM.t('Otros rincones'), porD = new Map();
      for (const x of cuadernos) { if (!porD.has(x.d)) porD.set(x.d, []); porD.get(x.d).push(x); }
      // (sin distritos, los barrios son las carpetas; un distrito de un solo barrio no necesita separadores)
      const carpetas = porD.size > 1
        ? [...porD].map(([d, l]) => ({ nombre: d || PM.t('Otros rincones'), L: [].concat(...l.map((x) => x.L)), subs: l.length > 1 ? l.map((x) => ({ nombre: x.nombre || d, L: x.L })).sort(cuenta) : [] }))
        : cuadernos.map((x) => ({ nombre: x.nombre || sinNombre, L: x.L, subs: [] }));
      const must = E.principal.filter((e) => e.must);
      if (must.length) C.push({ nombre: PM.t('Imprescindibles'), ic: '★', L: must, subs: [], tinta: ORO });
      carpetas.sort(cuenta).forEach((k, i) => { k.tinta = { c: TINTAS[i % TINTAS.length], on: '#fff' }; C.push(k); });
      if (E.otras.length) C.push({ nombre: PM.t('Otros lugares'), L: E.otras.map((id) => ({ id })), subs: [], tinta: PIZARRA });
      if (E.extras.length) {
        const por = new Map();
        for (const e of E.extras) { const n = (A.d || [])[e.bi] || A.b[e.bi] || PM.t('Otros rincones'); if (!por.has(n)) por.set(n, []); por.get(n).push(e); }
        C.push({ nombre: PM.t('Extras'), ic: '✦', L: E.extras, subs: por.size > 1 ? [...por].map(([nombre, L]) => ({ nombre, L })).sort(cuenta) : [], tinta: PIZARRA });
      }
      return C;
    }
    const cuantos = (L) => [L.filter((e) => e.id).length, L.length];

    async function ciudad(city) {
      box.dataset.vista = 'carpeta';
      box.innerHTML = '<p class="muted">Abriendo el álbum…</p>';
      const A = await W().albumDe(city), E = enlazar(A, S().landmarks, city);
      carpeta(city, { A, E, C: carpetasDe(city, A, E) }, 0);
    }

    // La portada: lo que dice de toda la ciudad, no una lista de lo que ya está en las pestañas de arriba
    function tapa(city, { A, E }) {
      const pct = E.total ? Math.min(100, Math.floor(E.got / E.total * 100)) : 0, [mg, mn] = cuantos(E.principal.filter((e) => e.must));
      const rar = ['legendario', 'epico', 'raro', 'comun'].map((r) => { const [g, n] = cuantos(E.principal.filter((e) => e.rarity === r)); return { r, g, n }; }).filter((x) => x.n);
      const extra = [];
      if (E.otras.length) extra.push(PM.t('Y {n} cartas más de esta ciudad, fuera de la lista.', { n: PM.fmtNum(E.otras.length) }));
      if (E.extras.length) extra.push(PM.t('{n} lugares más para completistas: no cuentan para completar el álbum.', { n: PM.fmtNum(E.extras.length) }));
      if (A.parcial) extra.push(PM.t('Este álbum crece al explorar: aparecen más lugares según recorres la ciudad.'));
      return `<div class="ab-tapa"><div class="ab-cover ab-hero">${portada(city, A, E, true, true)}</div>
        <div class="ab-res">
          <div class="ab-cifra"><b>${E.got && !pct ? '&lt;1' : pct}<small> %</small></b><span>${PM.t('{a} de {b} lugares', { a: PM.fmtNum(E.got), b: PM.fmtNum(E.total) })}</span></div>
          <i class="ab-bar"><em style="width:${pct}%"></em></i>
          ${mn ? `<div class="ab-linea"><span>★ ${PM.t('Imprescindibles')}</span><b>${mg}<small>/${mn}</small></b></div>` : ''}
          <div class="ab-rars">${rar.map((x) => `<div class="ab-rar"><i style="background:${PM.lugares.RARITY[x.r].color}"></i><span>${PM.t(PM.lugares.RARITY[x.r].label)}</span><b>${PM.fmtNum(x.g)}<small>/${PM.fmtNum(x.n)}</small></b></div>`).join('')}</div>
          ${extra.map((t) => `<p class="ab-nota">${t}</p>`).join('')}
        </div></div>`;
    }

    // El álbum abierto, como uno de papel: en la portada, el ÍNDICE con todas las carpetas (una por fila, con su color, su barra y
    // su cuenta); dentro de una carpeta, solo «‹ anterior · Índice · siguiente ›». Los barrios de un distrito son apartados de la
    // misma hoja, con su título. (Antes, pestañas en una tira lateral que escondía la mayoría y, después, etiquetas amontonadas en
    // varias filas: las dos cosas confundían, petición del usuario 15-nov-2026)
    function carpeta(city, V, i) {
      const { C } = V, k = C[i];
      box.dataset.vista = 'carpeta';
      const pct = (L) => { const [g, n] = cuantos(L); return n ? Math.round(g / n * 100) : 0; };
      const indice = () => `<div class="ab-indice"><h5>${PM.t('Índice')}</h5>${C.map((c, j) => {
        if (c.portada) return '';
        const [cg, cn] = cuantos(c.L), lleno = cn && cg >= cn;
        return `<button class="ab-fila" data-i="${j}" style="${tinta(c)}" translate="no"><i class="ab-tono"></i><span>${lleno ? '✓ ' : c.ic ? c.ic + ' ' : ''}${esc(c.nombre)}</span><b>${cg}<small>/${cn}</small></b><i class="ab-bar"><em style="width:${pct(c.L)}%"></em></i></button>`;
      }).join('')}</div>`;
      // apartados: los barrios del distrito (o la carpeta entera si no tiene); las casillas se numeran seguidas para pegar()
      const partes = k.subs.length ? k.subs : [{ nombre: null, L: k.L }], todo = [].concat(...partes.map((p) => p.L));
      let off = 0;
      const hojas = partes.map((p) => { const h = `${p.nombre ? `<h5 class="ab-sec" translate="no">${esc(p.nombre)} <span>${cuantos(p.L)[0]}/${p.L.length}</span></h5>` : ''}${rejilla(p.L, off)}`; off += p.L.length; return h; }).join('');
      const [g, n] = cuantos(k.L);
      box.innerHTML = k.portada ? `<div class="ab-hoja" style="${tinta(k)}">${tapa(city, V)}${indice()}</div>` : `
        <div class="ab-nav" style="${tinta(k)}"><button class="ab-paso" data-i="${i - 1}" aria-label="${PM.t('Carpeta anterior')}">‹</button>
          <button class="ab-ir-indice">${PM.t('Índice')}</button><span class="ab-donde">${i} / ${C.length - 1}</span>
          <button class="ab-paso" data-i="${i + 1}" ${C[i + 1] ? '' : 'disabled'} aria-label="${PM.t('Carpeta siguiente')}">›</button></div>
        <div class="ab-hoja" style="${tinta(k)}">
          <div class="ab-pag"><b translate="no">${k.ic ? k.ic + ' ' : ''}${esc(k.nombre)}</b><span>${g}/${n}</span></div>
          <i class="ab-bar"><em style="width:${pct(k.L)}%"></em></i>
          ${hojas}
        </div>`;
      box.prepend(volver(PM.t('Álbumes'), inicio));
      box.querySelectorAll('.ab-fila, .ab-paso').forEach((b) => b.addEventListener('click', () => carpeta(city, V, +b.dataset.i)));
      const ind = box.querySelector('.ab-ir-indice'); if (ind) ind.addEventListener('click', () => carpeta(city, V, 0));
      pegar(todo);
      // deslizar la hoja a un lado pasa a la carpeta de al lado, como pasar separadores con el dedo
      const hoja = box.querySelector('.ab-hoja'); let x0 = null, y0 = 0;
      hoja.addEventListener('touchstart', (e) => { const t = e.touches[0]; x0 = t.clientX; y0 = t.clientY; }, { passive: true });
      hoja.addEventListener('touchend', (e) => {
        if (x0 == null) return;
        const t = e.changedTouches[0], dx = t.clientX - x0, j = i + (dx < 0 ? 1 : -1);
        if (Math.abs(dx) > 70 && Math.abs(t.clientY - y0) < 45 && C[j]) carpeta(city, V, j);
      }, { passive: true });
      arriba();
    }

    function rejilla(L, off = 0) {
      return `<div class="cromos ab-grid">${L.map((e, k) => {
    const i = off + k;
    if (e.id) return `<div class="tcg-cell ab-pegado" data-i="${i}" data-lm="${esc(e.id)}"><div class="ab-slot"></div></div>`;
    const R = PM.lugares.RARITY[e.rarity] || {};
    return `<button class="ab-slot vacio ${e.must ? 'must' : ''}" data-i="${i}"><span class="ab-rz" style="color:${R.color || '#9aa4b2'}">${e.must ? '★ ' : ''}${esc(PM.t(R.label || ''))}</span><span class="ab-em">${esc(e.emoji || '📍')}</span><b translate="no">${esc(e.name)}</b><small>${esc(PM.t(e.kind || ''))}</small>${e.n ? `<span class="ab-num">Nº ${e.n}</span>` : ''}</button>`;
  }).join('')}</div>`;
    }
    function pegar(L) {
      box.querySelectorAll('.ab-pegado').forEach(async (el) => {
        const id = el.dataset.lm;
        el.addEventListener('click', () => opts.abrir(id));
        const d = await opts.datos(id);
        if (el.isConnected) { el.innerHTML = PM.tcg.html(d, { mini: true }); if (opts.pegada) opts.pegada(el, id); }
      });
      box.querySelectorAll('.ab-slot.vacio').forEach((b) => b.addEventListener('click', () => { const e = L[+b.dataset.i]; opts.irA({ pos: e.pos, name: e.name }); }));
    }
    const arriba = () => { if (box.parentElement && box.parentElement.scrollTo) box.parentElement.scrollTo(0, 0); };
    inicio();
    return { ciudad };
  }

  // ---------------- La primera vez que pisas una ciudad ----------------
  async function nuevo(city, abrir) {
    estilos();
    const A = await W().albumDe(city), E = enlazar(A, S().landmarks, city);
    if (document.getElementById('ab-nuevo')) return;
    const ov = document.createElement('div');
    ov.id = 'ab-nuevo';
    ov.innerHTML = `<div class="ab-nuevo-in"><p class="ab-ya">${PM.t('¡Nuevo álbum!')}</p><div class="ab-cover grande">${portada(city, A, E, true)}</div>
      <div class="cv-actions"><button class="btn" id="ab-luego">Luego</button><button class="btn on" id="ab-abrir">Abrir álbum</button></div></div>`;
    document.body.appendChild(ov);
    PM.sound.capture(); PM.vibrate([60, 40, 120]);
    ov.querySelector('#ab-luego').addEventListener('click', () => ov.remove());
    ov.querySelector('#ab-abrir').addEventListener('click', () => { ov.remove(); abrir(city); });
  }

  // ---------------- Estilos ----------------
  let hechos = false;
  function estilos() {
    if (hechos) return; hechos = true;
    const st = document.createElement('style');
    st.textContent = `
    #sheet:has(#album-box) { height: 92%; max-height: 92%; }   /* (un álbum se mira a pantalla casi completa) */
    .ab-cover { position: relative; display: block; width: 100%; aspect-ratio: 16 / 10; margin: 0 0 12px; padding: 0; border: 0; border-radius: 18px; overflow: hidden; cursor: pointer; text-align: left; color: #fff; font: inherit;
      background: linear-gradient(135deg, var(--paint, #2563eb), #111827); box-shadow: 0 8px 20px rgba(15,23,42,.28); }
    .ab-cover.grande { aspect-ratio: 4 / 5; cursor: default; }
    .ab-foto { position: absolute; inset: 0; background: center / cover no-repeat; }
    .ab-velo { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(10,14,24,.34) 0%, rgba(10,14,24,0) 30%, rgba(10,14,24,.2) 52%, rgba(10,14,24,.86) 100%); }
    .ab-marca { position: absolute; top: 10px; left: 14px; font-weight: 900; font-style: italic; font-size: 16px; letter-spacing: -.5px; text-shadow: 0 1px 4px rgba(0,0,0,.6); }
    .ab-marca span:last-child { color: #7dd3fc; }
    .ab-tit { position: absolute; left: 0; right: 10px; bottom: 44px; }
    .ab-tit small { display: block; margin: 0 0 2px 16px; font-size: 13px; font-weight: 700; letter-spacing: .04em; text-shadow: 0 1px 3px rgba(0,0,0,.7); }
    /* el nombre sobre un brochazo de tu color: bordes irregulares, como pintado con rodillo */
    .ab-tit b { display: inline-block; max-width: 100%; box-sizing: border-box; padding: 5px 26px 7px 16px; font-size: 36px; line-height: 1.02; font-weight: 900; font-style: italic; letter-spacing: -1.5px; overflow-wrap: anywhere;
      background: var(--paint, #2563eb); clip-path: polygon(0 5%, 22% 0, 48% 6%, 74% 1%, 97% 5%, 100% 30%, 96% 52%, 100% 76%, 95% 96%, 70% 100%, 44% 94%, 20% 100%, 0 95%); }
    .ab-tit b.largo { font-size: 26px; letter-spacing: -.8px; }
    .ab-cover.grande .ab-tit b { font-size: 46px; } .ab-cover.grande .ab-tit b.largo { font-size: 32px; }
    .ab-pie { position: absolute; left: 16px; right: 16px; bottom: 12px; display: flex; align-items: center; gap: 10px; }
    .ab-n { font-size: 17px; font-weight: 900; white-space: nowrap; } .ab-n small { font-size: 12px; font-weight: 700; opacity: .8; }
    .ab-bar { display: block; flex: 1; height: 7px; border-radius: 9px; background: rgba(127,127,127,.35); overflow: hidden; }
    .ab-bar em { display: block; height: 100%; border-radius: 9px; background: var(--paint, #2563eb); }
    .ab-pie .ab-bar { background: rgba(255,255,255,.3); }
    .ab-ex { font-size: 12px; font-weight: 800; white-space: nowrap; opacity: .9; }
    .ab-go { position: absolute; right: 12px; top: 6px; font-size: 26px; font-weight: 700; text-shadow: 0 1px 4px rgba(0,0,0,.6); }
    .ab-back { border: 0; background: none; color: var(--accent); font: inherit; font-weight: 700; padding: 4px 0 10px; cursor: pointer; }
    /* índice (en la portada): una carpeta por fila, con su color, su cuenta y su barra */
    .ab-indice { margin-top: 18px; } .ab-indice h5 { margin: 0 0 8px; font-size: 13px; font-weight: 800; color: var(--muted); }
    .ab-fila { display: grid; grid-template-columns: 6px minmax(0, 1fr) auto; grid-template-rows: auto auto; column-gap: 12px; row-gap: 6px; align-items: center; width: 100%; padding: 10px 12px 10px 0; margin-bottom: 6px; border: 0; border-radius: 12px; background: #fff; color: #1f2937; font: inherit; text-align: left; cursor: pointer; box-shadow: 0 1px 2px rgba(15,23,42,.06); }
    .ab-fila .ab-tono { grid-row: 1 / 3; align-self: stretch; border-radius: 12px 0 0 12px; background: var(--c); }
    .ab-fila span { font-size: 14px; font-weight: 800; color: var(--tx); overflow-wrap: anywhere; } .ab-fila b { font-size: 13.5px; font-variant-numeric: tabular-nums; } .ab-fila b small { font-weight: 700; opacity: .6; }
    .ab-fila .ab-bar { grid-column: 2 / 4; height: 5px; background: var(--b); } .ab-fila .ab-bar em { background: var(--c); }
    @media (hover: hover) { .ab-fila:hover { box-shadow: 0 0 0 2px var(--c); } }
    /* dentro de una carpeta: anterior · Índice · siguiente (nada más) */
    .ab-nav { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .ab-paso { width: 40px; height: 40px; flex: none; border: 0; border-radius: 12px; background: var(--b); color: var(--tx); font: inherit; font-size: 22px; font-weight: 800; line-height: 1; cursor: pointer; }
    .ab-paso:disabled { opacity: .35; cursor: default; }
    .ab-ir-indice { flex: 1; height: 40px; border: 0; border-radius: 12px; background: var(--c); color: var(--on); font: inherit; font-size: 14px; font-weight: 800; cursor: pointer; }
    .ab-donde { font-size: 12px; font-weight: 700; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
    /* los barrios de un distrito: apartados de la misma hoja */
    .ab-sec { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin: 18px 0 10px; padding-top: 12px; border-top: 1px solid var(--b); font-size: 15px; font-weight: 800; color: var(--tx); }
    .ab-sec span { font-size: 12.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
    .ab-hoja .ab-sec:first-of-type { margin-top: 12px; }
    .ab-fila:focus-visible, .ab-paso:focus-visible, .ab-ir-indice:focus-visible, .ab-slot:focus-visible { outline: 2px solid var(--tx); outline-offset: 2px; }
    .ab-hoja { padding: 14px 12px 18px; border-top: 4px solid var(--c); border-radius: 16px; background: var(--t); }
    .ab-hoja .ab-pag { margin-bottom: 6px; } .ab-hoja .ab-pag b { color: var(--tx); } .ab-hoja > .ab-bar { background: var(--b); margin-bottom: 12px; } .ab-hoja > .ab-bar em { background: var(--c); }
    /* portada: la foto y lo que dice de toda la ciudad */
    .ab-tapa { display: flex; flex-direction: column; gap: 16px; }
    .ab-cover.ab-hero { aspect-ratio: 4 / 3; margin: 0; border-radius: 14px; cursor: default; }
    .ab-hero .ab-tit { bottom: 16px; }
    .ab-res { padding: 0 4px; color: #1f2937; }
    .ab-cifra { display: flex; align-items: baseline; gap: 10px; } .ab-cifra b { font-size: 44px; font-weight: 900; letter-spacing: -2px; line-height: 1; font-variant-numeric: tabular-nums; } .ab-cifra b small { font-size: 20px; letter-spacing: 0; font-weight: 800; } .ab-cifra span { color: var(--muted); font-size: 14px; font-weight: 600; }
    .ab-res > .ab-bar { height: 8px; margin: 12px 0 16px; background: var(--b); } .ab-res > .ab-bar em { background: var(--paint, #2563eb); }
    .ab-linea { display: flex; justify-content: space-between; align-items: baseline; padding: 10px 12px; margin-bottom: 8px; border-radius: 12px; background: #fdf1cf; color: #7a5600; font-size: 14px; font-weight: 800; }
    .ab-linea small, .ab-rar small { font-size: 12px; font-weight: 700; opacity: .65; } .ab-rar b, .ab-linea b { font-variant-numeric: tabular-nums; }
    .ab-rars { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .ab-rar { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 7px; padding: 9px 12px; border: 1px solid var(--b); border-radius: 12px; background: #fff; font-size: 13px; font-weight: 700; }
    .ab-rar i { width: 9px; height: 9px; border-radius: 50%; }
    .ab-nota { margin: 12px 0 0; color: var(--muted); font-size: 12.5px; line-height: 1.4; }
    /* hueco: como un cromo por pegar. Rareza arriba, el lugar en medio y su número abajo */
    .ab-hoja .ab-slot.vacio { position: relative; gap: 4px; padding: 26px 8px 22px; border: 1.5px dashed var(--b); background: rgba(255,255,255,.82); box-shadow: inset 0 0 0 4px rgba(255,255,255,.9); transition: transform .14s, box-shadow .14s; }
    .ab-hoja .ab-slot.vacio.must { border-color: #eab308; }
    .ab-rz { position: absolute; top: 9px; left: 0; right: 0; font-size: 9.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; text-align: center; }
    .ab-num { position: absolute; bottom: 8px; left: 0; right: 0; color: var(--muted); font-size: 10.5px; font-weight: 700; text-align: center; font-variant-numeric: tabular-nums; opacity: .75; }
    .ab-hoja .ab-em { display: grid; place-items: center; width: 52px; height: 52px; margin-bottom: 4px; border-radius: 50%; background: var(--t); font-size: 26px; opacity: 1; } .ab-hoja .ab-em { filter: grayscale(.85); }
    @media (hover: hover) { .ab-hoja .ab-slot.vacio:hover { transform: translateY(-2px); box-shadow: inset 0 0 0 4px rgba(255,255,255,.9), 0 6px 14px rgba(15,23,42,.1); } }
    .ab-pag { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 10px; } .ab-pag b { font-size: 19px; } .ab-pag span { font-weight: 800; color: var(--muted); }
    .ab-slot { width: 100%; aspect-ratio: 63 / 88; box-sizing: border-box; border-radius: 10px; }
    .ab-slot.vacio { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 8px; border: 2px dashed var(--line); background: rgba(127,127,127,.07); color: inherit; font: inherit; cursor: pointer; }
    .ab-slot.vacio.must { border-color: #f59e0b; }
    .ab-em { font-size: 30px; filter: grayscale(1); opacity: .5; }
    .ab-slot.vacio b { font-size: 12.5px; line-height: 1.2; text-align: center; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
    .ab-slot.vacio small { font-size: 10.5px; color: var(--muted); text-align: center; }
    #ab-nuevo { position: fixed; inset: 0; z-index: 2900; display: grid; place-items: center; padding: 16px; background: rgba(5,8,18,.8); animation: abfade .3s ease-out; }
    .ab-nuevo-in { width: min(100%, 360px); animation: abpop .55s cubic-bezier(.2,1.4,.4,1); }
    .ab-ya { margin: 0 0 10px; text-align: center; color: #fff; font-size: 24px; font-weight: 900; font-style: italic; }
    @keyframes abfade { from { opacity: 0; } } @keyframes abpop { from { transform: scale(.7) rotate(-4deg); opacity: 0; } }`;
    document.head.appendChild(st);
  }
  return { montar, nuevo, enlazar, ciudades, usar, NO_ES_CIUDAD };
})();
