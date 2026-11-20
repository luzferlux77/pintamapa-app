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
    let hojaAntes = 0;   // (la carpeta que se veía: para saber hacia dónde se pasa la página)

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
      PM.ensureCountries(s, pos).then((ch) => { if (ch) { if (!fuente && PM.state) PM.state.save();   // (en «Mi progreso» la partida es la de la nube: no se guarda encima de la de este PC)
         if (box.isConnected && box.querySelector('.ab-cover')) inicio(); } });
    }

    // El álbum es un archivador: la portada, y luego una carpeta de color por distrito. El orden y el color son fijos (por tamaño,
    // nunca por progreso): como en una carpeta de verdad, se recuerda dónde está cada cosa y qué color tiene
    // TODO va en su distrito y su barrio (petición del usuario, 15-nov-2026: antes había dos carpetas aparte, «Otros lugares» con tus
    // cartas fuera de la lista y «Extras» con los lugares para completistas, todos revueltos). En cada barrio: L, los huecos del
    // álbum (lo único que cuenta para completarlo); X, lo de más: tus cartas fuera de la lista y los extras, que no cuentan
    function carpetasDe(city, A, E) {
      const cuenta = (x, y) => y.L.length - x.L.length || (x.nombre < y.nombre ? -1 : 1), C = [{ nombre: PM.t('Portada'), portada: true, L: [], X: [], subs: [], tinta: TAPA }];
      E.principal.concat(E.extras).forEach((e, i) => { e.n = i + 1; });   // (el número del cromo, como en los álbumes de papel)
      // sin lista (pueblos sin datos): tus cartas son el álbum
      if (!E.principal.length && !E.extras.length) { if (E.otras.length) C.push({ nombre: city, L: E.otras.map((id) => ({ id })), X: [], subs: [], tinta: { c: TINTAS[0], on: '#fff' } }); return C; }
      // tus cartas fuera de la lista: al barrio que dice la carta o, si no, al del lugar de la lista más cercano
      const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^(el|la|els|les|l'|los|las)\s*/, '').trim();
      const porNombre = new Map(A.b.map((n, i) => [norm(n), i]));
      const con = A.l.filter((e) => e.pos && e.bi != null), d2 = (p, q) => (p[0] - q[0]) ** 2 + ((p[1] - q[1]) * Math.cos(p[0] * Math.PI / 180)) ** 2;
      const barrioDe = (id) => {
        const r = S().landmarks[id] || {};
        if (r.barrio && porNombre.has(norm(r.barrio))) return porNombre.get(norm(r.barrio));
        if (!r.pos || !con.length) return -1;
        let mejor = con[0]; for (const e of con) if (d2(e.pos, r.pos) < d2(mejor.pos, r.pos)) mejor = e;
        return mejor.bi;
      };
      const sueltas = E.otras.map((id) => ({ id, suelta: true, bi: barrioDe(id) }));
      const cuadernos = A.b.map((n, i) => ({ nombre: n, d: (A.d || [])[i] || '', L: E.principal.filter((e) => e.bi === i), X: sueltas.filter((e) => e.bi === i).concat(E.extras.filter((e) => e.bi === i)) }));
      const sinSitio = sueltas.filter((e) => e.bi < 0 || e.bi >= A.b.length);
      if (sinSitio.length) cuadernos.push({ nombre: PM.t('Otros rincones'), d: '', L: [], X: sinSitio });
      const llenos = cuadernos.filter((x) => x.L.length || x.X.length);
      const sinNombre = llenos.length === 1 ? city : PM.t('Otros rincones'), porD = new Map();
      for (const x of llenos) { if (!porD.has(x.d)) porD.set(x.d, []); porD.get(x.d).push(x); }
      // (sin distritos, los barrios son las carpetas; un distrito de un solo barrio no necesita separadores)
      const junta = (l, f) => [].concat(...l.map(f));
      const carpetas = porD.size > 1
        ? [...porD].map(([d, l]) => ({ nombre: d || PM.t('Otros rincones'), L: junta(l, (x) => x.L), X: junta(l, (x) => x.X), subs: l.length > 1 ? l.map((x) => ({ nombre: x.nombre || d, L: x.L, X: x.X })).sort(cuenta) : [] }))
        : llenos.map((x) => ({ nombre: x.nombre || sinNombre, L: x.L, X: x.X, subs: [] }));
      const must = E.principal.filter((e) => e.must);
      if (must.length) C.push({ nombre: PM.t('Imprescindibles'), ic: '★', L: must, X: [], subs: [], tinta: ORO });
      carpetas.sort(cuenta).forEach((k, i) => { k.tinta = { c: TINTAS[i % TINTAS.length], on: '#fff' }; C.push(k); });
      return C;
    }
    const cuantos = (L) => [L.filter((e) => e.id).length, L.length];

    async function ciudad(city) {
      box.dataset.vista = 'carpeta';
      box.innerHTML = '<p class="muted">Abriendo el álbum…</p>';
      const A = await W().albumDe(city), E = enlazar(A, S().landmarks, city);
      hojaAntes = 0; carpeta(city, { A, E, C: carpetasDe(city, A, E) }, 0);
    }

    // La portada: lo que dice de toda la ciudad, no una lista de lo que ya está en las pestañas de arriba
    function tapa(city, { A, E }) {
      const pct = E.total ? Math.min(100, Math.floor(E.got / E.total * 100)) : 0, [mg, mn] = cuantos(E.principal.filter((e) => e.must));
      const rar = ['legendario', 'epico', 'raro', 'comun'].map((r) => { const [g, n] = cuantos(E.principal.filter((e) => e.rarity === r)); return { r, g, n }; }).filter((x) => x.n);
      const extra = [];
      // (lo de más ya no va aparte: está en su barrio, marcado con ✦)
      const mias = E.otras.length + E.extras.filter((e) => e.id).length;
      if (mias) extra.push(PM.t('✦ {n} cartas tuyas de más, cada una en su barrio.', { n: PM.fmtNum(mias) }));
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
      // índice: cada carpeta con su color, su barra, su cuenta y unas miniaturas de tus cartas de ahí (se reconoce de un vistazo)
      const indice = () => `<div class="ab-indice"><h5>${PM.t('Índice')}</h5>${C.map((c, j) => {
        if (c.portada) return '';
        const [cg, cn] = cuantos(c.L), lleno = cn && cg >= cn, mias = c.L.concat(c.X || []).filter((e) => e.id).slice(0, 4).map((e) => e.id);
        return `<button class="ab-fila" data-i="${j}" style="${tinta(c)}" translate="no"><i class="ab-tono"></i><span>${lleno ? '✓ ' : c.ic ? c.ic + ' ' : ''}${esc(c.nombre)}</span><b>${cg}<small>/${cn}</small></b><i class="ab-bar"><em style="width:${pct(c.L)}%"></em></i>${mias.length ? `<span class="ab-minis">${mias.map((id) => `<i data-lm="${esc(id)}"></i>`).join('')}</span>` : ''}</button>`;
      }).join('')}</div>`;
      // apartados: los barrios del distrito (o la carpeta entera si no tiene). En cada uno, primero TUS cartas (las del álbum y
      // las de más, con ✦) y después lo que te falta en casillas pequeñas, tres por fila: antes cada hueco ocupaba lo que una carta
      // y pesaba más que lo conseguido. Los extras que faltan, plegados al final (no cuentan). Las casillas se numeran seguidas
      const anillo = (L) => { const [a, n] = cuantos(L), v = n ? a / n : 0, r = 11, cc = 2 * Math.PI * r; return `<svg class="ab-anillo" viewBox="0 0 28 28" width="28" height="28" aria-hidden="true"><circle cx="14" cy="14" r="${r}" fill="none" stroke="var(--b)" stroke-width="4"/><circle cx="14" cy="14" r="${r}" fill="none" stroke="var(--c)" stroke-width="4" stroke-linecap="${v > 0.03 ? 'round' : 'butt'}" stroke-dasharray="${(cc * v).toFixed(1)} ${cc.toFixed(1)}" transform="rotate(-90 14 14)"/></svg>`; };
      const partes = k.subs.length ? k.subs : [{ nombre: null, L: k.L, X: k.X || [] }], todo = [];
      const hojas = partes.map((p) => {
        const X = p.X || [], tengo = p.L.filter((e) => e.id).concat(X.filter((e) => e.id)), falta = p.L.filter((e) => !e.id), extras = X.filter((e) => !e.id);
        const a = tengo.length ? rejilla(tengo, todo.length) : ''; todo.push(...tengo);
        const b = falta.length ? `<p class="ab-falta">${falta.length === 1 ? PM.t('Te falta 1') : PM.t('Te faltan {n}', { n: PM.fmtNum(falta.length) })}</p>${huecos(falta, todo.length)}` : ''; todo.push(...falta);
        const c = extras.length ? `<details class="ab-mas"><summary>＋ ${extras.length === 1 ? PM.t('1 lugar más') : PM.t('{n} lugares más', { n: PM.fmtNum(extras.length) })} <small>${PM.t('no cuentan para el álbum')}</small></summary>${huecos(extras, todo.length)}</details>` : ''; todo.push(...extras);
        const de = X.filter((e) => e.id).length;
        return `${p.nombre ? `<h5 class="ab-sec" translate="no">${p.L.length ? anillo(p.L) : ''}<b>${esc(p.nombre)}</b><span>${p.L.length ? `${cuantos(p.L)[0]}/${p.L.length}` : ''}${de ? ` · ✦${de}` : ''}</span></h5>` : ''}${a}${b}${c}`;
      }).join('');
      const [g, n] = cuantos(k.L);
      // barra de arriba que no se va al bajar: siempre se ve cómo volver (antes solo había la ✕, que cierra el álbum entero)
      const barra = k.portada ? `<div class="ab-barra"><button class="ab-atras" data-a="albumes">‹ ${PM.t('Álbumes')}</button></div>`
        : `<div class="ab-barra" style="${tinta(k)}"><button class="ab-atras" data-a="indice">‹ ${PM.t('Índice')}</button>
          <span class="ab-pasos"><button class="ab-paso" data-i="${i - 1}" aria-label="${PM.t('Carpeta anterior')}">‹</button><span class="ab-donde">${i}/${C.length - 1}</span>
          <button class="ab-paso" data-i="${i + 1}" ${C[i + 1] ? '' : 'disabled'} aria-label="${PM.t('Carpeta siguiente')}">›</button></span></div>`;
      // pasar página: la hoja entra por la derecha si avanzas y por la izquierda si vuelves (como un álbum de verdad)
      const giro = i > hojaAntes ? 'ab-der' : i < hojaAntes ? 'ab-izq' : ''; hojaAntes = i;
      box.innerHTML = barra + (k.portada ? `<div class="ab-hoja ${giro}" style="${tinta(k)}">${tapa(city, V)}${indice()}</div>` : `
        <div class="ab-hoja ${giro}" style="${tinta(k)}">
          <div class="ab-pag"><b translate="no">${k.ic ? k.ic + ' ' : ''}${esc(k.nombre)}</b><span>${g}/${n}</span></div>
          <i class="ab-bar"><em style="width:${pct(k.L)}%"></em></i>
          ${hojas}
        </div>`);
      box.querySelectorAll('.ab-fila, .ab-paso').forEach((b) => b.addEventListener('click', () => carpeta(city, V, +b.dataset.i)));
      box.querySelector('.ab-atras').addEventListener('click', (e) => { if (e.currentTarget.dataset.a === 'indice') carpeta(city, V, 0); else { inicio(); arriba(); } });
      pegar(todo);
      // miniaturas del índice: la foto de cada carta (o su emoji si no tiene)
      box.querySelectorAll('.ab-minis i[data-lm]').forEach(async (el) => {
        const d = await opts.datos(el.dataset.lm);
        if (!el.isConnected || !d) return;
        if (d.img) el.style.backgroundImage = `url('${String(d.img).replace(/'/g, '%27')}')`; else el.textContent = d.emoji || '📍';
      });
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
    if (e.id) return `<div class="tcg-cell ab-pegado ${e.suelta || e.extra ? 'ab-de-mas' : ''}" data-i="${i}" data-lm="${esc(e.id)}"><div class="ab-slot"></div></div>`;
    const R = PM.lugares.RARITY[e.rarity] || {};
    return `<button class="ab-slot vacio ${e.must ? 'must' : ''}" data-i="${i}"><span class="ab-rz" style="color:${R.color || '#9aa4b2'}">${e.must ? '★ ' : ''}${esc(PM.t(R.label || ''))}</span><span class="ab-em">${esc(e.emoji || '📍')}</span><b translate="no">${esc(e.name)}</b><small>${esc(PM.t(e.kind || ''))}</small>${e.n ? `<span class="ab-num">Nº ${e.n}</span>` : ''}</button>`;
  }).join('')}</div>`;
    }
    // lo que te falta: casillas pequeñas (tres por fila en el móvil), con su número, su emoji y el nombre ENTERO (nunca cortado)
    function huecos(L, off) {
      return `<div class="ab-huecos">${L.map((e, k) => {
        const R = PM.lugares.RARITY[e.rarity] || {};
        return `<button class="ab-hueco ${e.must ? 'must' : ''}" data-i="${off + k}" style="--rz:${R.color || '#9aa4b2'}" title="${esc(PM.t(R.label || ''))}${e.kind ? ' · ' + esc(PM.t(e.kind)) : ''}">${e.n ? `<span class="ab-hn">${e.must ? '★ ' : ''}${e.n}</span>` : ''}<span class="ab-he">${esc(e.emoji || '📍')}</span><b translate="no">${esc(e.name)}</b></button>`;
      }).join('')}</div>`;
    }
    function pegar(L) {
      box.querySelectorAll('.ab-pegado').forEach(async (el) => {
        const id = el.dataset.lm;
        el.addEventListener('click', () => opts.abrir(id));
        const d = await opts.datos(id);
        if (el.isConnected) { el.innerHTML = PM.tcg.html(d, { mini: true }); if (opts.pegada) opts.pegada(el, id); }
      });
      box.querySelectorAll('.ab-slot.vacio, .ab-hueco').forEach((b) => b.addEventListener('click', () => { const e = L[+b.dataset.i]; opts.irA({ pos: e.pos, name: e.name }); }));
    }
    // Arriba del álbum al cambiar de carpeta. Antes se desplazaba el contenedor de al lado, que no se mueve: en el móvil la carpeta
    // se abría a media altura (donde estabas en el índice) y no se veía ni su título ni cómo volver (15-nov-2026). Se busca lo que
    // de verdad se desplaza: en el móvil, el cuerpo de la ventana del álbum; en el PC, el panel o la página
    const arriba = () => {
      const margen = parseFloat(getComputedStyle(box).scrollMarginTop) || 0;
      for (let el = box.parentElement; el; el = el.parentElement) {
        const o = getComputedStyle(el).overflowY;
        if ((o === 'auto' || o === 'scroll') && el.scrollHeight > el.clientHeight) {
          const d = box.getBoundingClientRect().top - el.getBoundingClientRect().top - margen;
          if (d < 0) el.scrollTop += d;   // (solo si el álbum empieza más arriba de lo que se ve: si ya se ve entero, no se mueve)
          return;
        }
      }
      const y = box.getBoundingClientRect().top + window.scrollY - margen;
      if (window.scrollY > y) window.scrollTo(0, Math.max(0, y));
    };
    // cuando llega información nueva de las cartas (fotos, textos), se rehacen SOLO las cartas que se ven, sin moverte de donde
    // estás (antes se volvía a montar el álbum entero y te sacaba de la carpeta que mirabas)
    function refrescar() {
      box.querySelectorAll('.ab-pegado').forEach(async (el) => {
        const id = el.dataset.lm, d = await opts.datos(id);
        if (el.isConnected) { el.innerHTML = PM.tcg.html(d, { mini: true }); if (opts.pegada) opts.pegada(el, id); }
      });
    }
    inicio();
    return { ciudad, refrescar };
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
    /* índice (en la portada): una carpeta por fila, con su color, su cuenta y su barra */
    .ab-indice { margin-top: 18px; } .ab-indice h5 { margin: 0 0 8px; font-size: 13px; font-weight: 800; color: var(--muted); }
    .ab-fila { display: grid; grid-template-columns: 6px minmax(0, 1fr) auto; grid-template-rows: auto auto; column-gap: 12px; row-gap: 6px; align-items: center; width: 100%; padding: 10px 12px 10px 0; margin-bottom: 6px; border: 0; border-radius: 12px; background: #fff; color: #1f2937; font: inherit; text-align: left; cursor: pointer; box-shadow: 0 1px 2px rgba(15,23,42,.06); }
    .ab-fila .ab-tono { grid-row: 1 / 3; align-self: stretch; border-radius: 12px 0 0 12px; background: var(--c); }
    .ab-fila span { font-size: 14px; font-weight: 800; color: var(--tx); overflow-wrap: anywhere; } .ab-fila b { font-size: 13.5px; font-variant-numeric: tabular-nums; } .ab-fila b small { font-weight: 700; opacity: .6; }
    .ab-fila .ab-bar { grid-column: 2 / 4; height: 5px; background: var(--b); } .ab-fila .ab-bar em { background: var(--c); }
    /* miniaturas de tus cartas de esa carpeta, superpuestas como fotos en la mano */
    .ab-fila:has(.ab-minis) .ab-bar { grid-column: 2 / 3; }
    .ab-minis { grid-column: 3; grid-row: 2; display: flex; justify-self: end; }
    .ab-minis i { display: grid; place-items: center; width: 26px; height: 26px; margin-left: -8px; border-radius: 50%; border: 2px solid #fff; background: var(--b) center / cover no-repeat; font-size: 13px; font-style: normal; box-shadow: 0 1px 3px rgba(15,23,42,.2); }
    .ab-minis i:first-child { margin-left: 0; }
    @media (hover: hover) { .ab-fila:hover { box-shadow: 0 0 0 2px var(--c); } }
    /* barra de arriba, siempre a la vista al bajar: volver (‹ Álbumes / ‹ Índice) y, en una carpeta, ‹ nº/total › */
    .ab-barra { position: sticky; top: var(--ab-tope, 0px); z-index: 4; display: flex; align-items: center; gap: 8px; margin: 0 0 10px; padding: 8px 0; background: var(--ab-fondo, var(--sheet, #fff)); }
    .ab-atras { height: 40px; padding: 0 16px; border: 0; border-radius: 12px; background: var(--c, var(--accent, #1f5fbf)); color: var(--on, #fff); font: inherit; font-size: 14.5px; font-weight: 800; cursor: pointer; }
    .ab-pasos { margin-left: auto; display: flex; align-items: center; gap: 6px; }
    .ab-paso { width: 40px; height: 40px; flex: none; border: 0; border-radius: 12px; background: var(--b); color: var(--tx); font: inherit; font-size: 22px; font-weight: 800; line-height: 1; cursor: pointer; }
    .ab-paso:disabled { opacity: .35; cursor: default; }
    .ab-donde { font-size: 12px; font-weight: 700; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
    /* los barrios de un distrito: apartados de la misma hoja */
    /* cabecera de cada barrio: franja de su color, anillo de progreso, nombre y cuenta */
    .ab-sec { display: flex; align-items: center; gap: 10px; margin: 22px -12px 12px; padding: 9px 12px; border-left: 5px solid var(--c); background: rgba(255,255,255,.6); font-size: 15.5px; font-weight: 800; color: var(--tx); }
    .ab-sec b { flex: 1; min-width: 0; overflow-wrap: anywhere; } .ab-anillo { flex: none; }
    .ab-sec span { font-size: 12.5px; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .ab-hoja .ab-sec:first-of-type { margin-top: 14px; }
    /* lo que te falta: casillas pequeñas y ligeras (lo que destaca son tus cartas) */
    .ab-falta { margin: 14px 0 8px; font-size: 12.5px; font-weight: 800; color: var(--muted); }
    .ab-huecos { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 8px; }
    .ab-hueco { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 4px; min-height: 92px; padding: 20px 6px 9px; border: 1.5px dashed var(--b); border-radius: 10px; background: rgba(255,255,255,.72); box-shadow: inset 0 3px 0 var(--rz); color: #1f2937; font: inherit; text-align: center; cursor: pointer; }
    .ab-hueco.must { border-color: #eab308; }
    .ab-hn { position: absolute; top: 5px; left: 7px; font-size: 10.5px; font-weight: 800; color: var(--muted); font-variant-numeric: tabular-nums; }
    .ab-he { font-size: 20px; filter: grayscale(.85); opacity: .75; }
    .ab-hueco b { font-size: 11.5px; line-height: 1.2; font-weight: 700; overflow-wrap: anywhere; hyphens: auto; }   /* (el nombre, entero: nunca se corta) */
    @media (hover: hover) { .ab-hueco:hover { background: #fff; border-style: solid; } }
    /* pasar página: la hoja entra girando un poco desde el lado hacia el que vas */
    .ab-hoja.ab-der { animation: abPagDer .32s cubic-bezier(.2,.8,.3,1); transform-origin: left center; }
    .ab-hoja.ab-izq { animation: abPagIzq .32s cubic-bezier(.2,.8,.3,1); transform-origin: right center; }
    @keyframes abPagDer { from { opacity: 0; transform: perspective(1200px) translateX(36px) rotateY(-10deg); } }
    @keyframes abPagIzq { from { opacity: 0; transform: perspective(1200px) translateX(-36px) rotateY(10deg); } }
    @media (prefers-reduced-motion: reduce) { .ab-hoja.ab-der, .ab-hoja.ab-izq { animation: none; } }
    /* tus cartas de más (fuera de la lista o extras): en su barrio, con una ✦ en la esquina */
    .ab-de-mas { position: relative; } .ab-de-mas::after { content: '✦'; position: absolute; top: -7px; right: -7px; z-index: 2; display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--c); color: var(--on); font-size: 12px; box-shadow: 0 1px 4px rgba(15,23,42,.3); }
    /* los extras que faltan, plegados al final del barrio */
    .ab-mas { margin-top: 10px; } .ab-mas summary { list-style: none; cursor: pointer; padding: 10px 12px; border-radius: 12px; background: rgba(255,255,255,.7); color: var(--tx); font-size: 13.5px; font-weight: 800; }
    .ab-mas summary::-webkit-details-marker { display: none; } .ab-mas summary small { font-weight: 600; color: var(--muted); margin-left: 4px; }
    .ab-mas[open] summary { margin-bottom: 10px; } .ab-mas .ab-hueco { opacity: .85; }
    .ab-fila:focus-visible, .ab-paso:focus-visible, .ab-atras:focus-visible, .ab-hueco:focus-visible, .ab-slot:focus-visible { outline: 2px solid var(--tx); outline-offset: 2px; }
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
