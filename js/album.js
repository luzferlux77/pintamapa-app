// PintaMapa — álbumes de ciudad. Cada ciudad tiene su lista fija de lugares (scripts/pois/albumes.mjs; world.js —albumDe— la
// recorta con el contorno real del municipio), repartida por distritos y barrios. El álbum aparece la primera vez que pisas la ciudad.
//
// REDISEÑO v0.9.32: ordenado, bonito y sin scroll tedioso:
//   · lista de ciudades: primero las activas ordenadas por progreso real (destacando dónde estás ahora) y abajo, plegadas,
//     las «Recién pisadas (0 cartas)»; cabecera de país solo cuando tienes más de uno;
//   · interior de ciudad: UNA sola barra fija («‹ Ciudad 56/500 ✕»), cifras honestas («56 de 500 · + 29 extras»), buscador con
//     botón desplegable de rareza, una sola fila de vistas (Todo · Me faltan · Tengo · ★ Imprescindibles · 📍 Cerca de ti);
//   · ciudades grandes (>45 lugares): distritos (y barrios en distritos grandes) en acordeón inteligente —por defecto abierto
//     solo tu distrito actual o el más avanzado, y auto-abierto al buscar o filtrar— + botón Desplegar/Plegar y subir arriba ↑;
//   · cromos conquistados en rejilla de 3 con banda de rareza visible, ★ y Nº; los que faltan debajo en fichas horizontales
//     compactas (mitad de altura, nombres sin partir con guiones, un toque lleva al mapa).
PM.album = (function () {
  // (en «Mi progreso» la partida es la de la nube, y el contorno de cada ciudad se pide allí: usar({ save, albumDe }))
  let fuente = null;
  const usar = (f) => { fuente = f; };
  const S = () => (fuente ? fuente.save() : PM.state.data), esc = PM.esc, W = () => fuente || PM.world;
  const NO_ES_CIUDAD = /^(Zona sin nombre|Ciudad desconocida|Ciudad Demo|Otras|Otros lugares|Sector )/;
  // (la URL va dentro de url('…'): un apóstrofo del nombre del archivo la rompería)
  const fondo = (u) => (u ? `background-image:url('${esc(String(u).replace(/'/g, '%27'))}')` : '');
  const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

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

  // Un color por distrito (solo una marca fina en su cabecera: identifica sin llenar la página de colores). Oscuros,
  // para que se lean sobre claro y oscuro, ordenados para que dos seguidos no se parezcan
  const TINTAS = ['#b91c1c', '#1d4ed8', '#a16207', '#0f766e', '#be185d', '#15803d', '#6d28d9', '#c2410c', '#0e7490', '#a21caf', '#4d7c0f', '#4338ca'];
  const cuantos = (L) => [L.filter((e) => e.id).length, L.length];
  const pctDe = (g, n) => (n ? (g && g < n / 100 ? '<1' : String(Math.min(100, Math.floor(g / n * 100)))) : '0');

  // ---------------- Portada (la del aviso «¡Nuevo álbum!») ----------------
  function portada(city, A, E) {
    const total = A ? E.total : 0, pct = total ? Math.min(100, Math.round(E.got / total * 100)) : 0;
    return `<div class="ab-foto" style="${fondo(A && A.portada)}"></div><div class="ab-velo"></div>
      <div class="ab-marca" translate="no"><span>Pinta</span><span>Mapa</span></div>
      <div class="ab-tit"><small>${PM.t('Álbum de')}</small><b translate="no" class="${city.length > 14 ? 'largo' : ''}">${esc(city)}</b></div>
      ${A ? `<div class="ab-pie"><span class="ab-n">${E.got}<small> / ${total}</small></span><i class="ab-bar"><em style="width:${pct}%"></em></i></div>` : ''}`;
  }

  // Distritos → barrios → lugares. TODO va en su distrito y su barrio: los huecos del álbum (lo único que cuenta para completarlo)
  // y lo de más —tus cartas fuera de la lista y los extras—, que no cuenta. El orden y el color son fijos (por tamaño, nunca por progreso).
  function estructura(city, A, E) {
    E.principal.concat(E.extras).forEach((e, i) => { e.n = i + 1; });   // (el número del cromo, como en los álbumes de papel)
    const rec = (id) => S().landmarks[id] || {};
    if (!E.principal.length && !E.extras.length) {
      return E.otras.length ? [{ nombre: city, tinta: TINTAS[0], L: E.otras.map((id) => ({ id, suelta: true })), barrios: [{ nombre: null, L: E.otras.map((id) => ({ id, suelta: true })), X: [] }] }] : [];
    }
    const claveBarrio = (t) => norm(t)
      .replace(/\s*\([^)]*\)\s*$/g, '')
      .replace(/^distrito\s+(?:de|del)\s+/i, '')
      .replace(/^barri(?:o)?\s+(?:de\s+l'|de\s+l[ao]s?\s+|del\s+|de\s+)/i, '')
      .replace(/^(el|la|els|les|l'|los|las)\s*/, '')
      .trim();
    const porNombre = new Map();
    A.b.forEach((n, i) => { const k = claveBarrio(n); if (!k) return; (porNombre.get(k) || porNombre.set(k, []).get(k)).push(i); });
    const con = A.l.filter((e) => e.pos && e.bi != null), d2 = (p, q) => (p[0] - q[0]) ** 2 + ((p[1] - q[1]) * Math.cos(p[0] * Math.PI / 180)) ** 2;
    const elegirBi = (lista, pos) => {
      if (lista.length === 1 || !pos) return lista[0];
      let mejor = lista[0], md = Infinity;
      for (const bi of lista) for (const e of con) if (e.bi === bi) { const dd = d2(e.pos, pos); if (dd < md) { md = dd; mejor = bi; } }
      return mejor;
    };
    const barrioDe = (id) => {
      const r = rec(id);
      // 1) En el móvil, prioridad absoluta al barrio REAL en vivo si es fiable (polígono oficial o zona cargada con OpenFreeMap)
      if (!fuente && r.pos && PM.world && PM.world.barrioAt) {
        const bw = PM.world.barrioAt(r.pos);
        if (bw && bw.fiable) {
          const kb = claveBarrio(bw.name);
          if (kb && porNombre.has(kb)) return elegirBi(porNombre.get(kb), r.pos);
        }
      }
      // 2) Barrio guardado en el registro de la carta (si coincide con algún cuaderno del álbum)
      if (r.barrio) {
        const kr = claveBarrio(r.barrio);
        if (kr && porNombre.has(kr)) return elegirBi(porNombre.get(kr), r.pos);
      }
      // 3) Respaldo: lugar del catálogo más cercano (solo si está razonablemente cerca, < ~1,5 km)
      if (!r.pos || !con.length) return -1;
      let mejor = con[0], md = d2(con[0].pos, r.pos);
      for (const e of con) { const dd = d2(e.pos, r.pos); if (dd < md) { md = dd; mejor = e; } }
      return md <= 0.0002 ? mejor.bi : -1;
    };
    const sueltas = E.otras.map((id) => ({ id, suelta: true, bi: barrioDe(id) }));
    const barrios = A.b.map((n, i) => ({ nombre: n, d: (A.d || [])[i] || '', L: E.principal.filter((e) => e.bi === i), X: sueltas.filter((e) => e.bi === i).concat(E.extras.filter((e) => e.bi === i)) }));
    const sinSitio = sueltas.filter((e) => e.bi < 0 || e.bi >= A.b.length);
    if (sinSitio.length) barrios.push({ nombre: PM.t('Otros rincones'), d: '', L: [], X: sinSitio });
    const llenos = barrios.filter((x) => x.L.length || x.X.length), porD = new Map();
    for (const x of llenos) { if (!porD.has(x.d)) porD.set(x.d, []); porD.get(x.d).push(x); }
    const cuenta = (x, y) => y.L.length - x.L.length || (x.nombre < y.nombre ? -1 : 1), junta = (l, f) => [].concat(...l.map(f));
    const D = porD.size > 1
      ? [...porD].map(([d, l]) => ({ nombre: d || PM.t('Otros rincones'), L: junta(l, (x) => x.L), barrios: l.length > 1 ? l.slice().sort(cuenta) : [{ nombre: null, L: l[0].L, X: l[0].X }] }))
      : llenos.map((x) => ({ nombre: x.nombre || (llenos.length === 1 ? city : PM.t('Otros rincones')), L: x.L, barrios: [{ nombre: null, L: x.L, X: x.X }] }));
    D.sort(cuenta).forEach((k, i) => { k.tinta = TINTAS[i % TINTAS.length]; });
    return D;
  }

  // ---------------- Vistas: lista de ciudades → álbum de una ciudad ----------------
  let modoAntes = 'todo', ordenAntes = 'cartas';
  function montar(box, opts) {
    estilos();
    const cache = new Map();
    const datos = (id) => { if (!cache.has(id)) cache.set(id, Promise.resolve().then(() => opts.datos(id)).catch(() => null)); return cache.get(id); };
    let obs = null, navSeq = 0, tq = null, scrollEl = null, onScroll = null;

    const limpiarScroll = () => {
      if (scrollEl && onScroll) scrollEl.removeEventListener('scroll', onScroll);
      scrollEl = null; onScroll = null;
    };
    const marcarVista = (v) => {
      box.dataset.vista = v;
      const sh = box.closest('#sheet');
      if (sh) sh.classList.toggle('en-ciudad', v === 'ciudad');
      const ab = box.closest('#album-box');
      if (ab) ab.classList.toggle('en-ciudad', v === 'ciudad');
    };
    const scroller = () => {
      for (let el = box.parentElement; el; el = el.parentElement) {
        const o = getComputedStyle(el).overflowY;
        if ((o === 'auto' || o === 'scroll') && el.scrollHeight >= el.clientHeight) return el;
      }
      return null;
    };
    // Arriba del álbum al cambiar de vista: en la hoja del móvil siempre a 0 para no esconder las pestañas de arriba
    const arriba = (alTope) => {
      const shBody = box.closest('#sheet .body');
      if (shBody) { shBody.scrollTop = 0; return; }
      const margen = parseFloat(getComputedStyle(box).scrollMarginTop) || 0;
      const el = scroller();
      if (el) {
        if (alTope) { el.scrollTop = 0; return; }
        const d = box.getBoundingClientRect().top - el.getBoundingClientRect().top - margen;
        if (d < 0) el.scrollTop += d;
        return;
      }
      const y = box.getBoundingClientRect().top + window.scrollY - margen;
      if (window.scrollY > y) window.scrollTo(0, Math.max(0, y));
    };

    async function inicio() {
      const seq = ++navSeq;
      clearTimeout(tq); limpiarScroll();
      if (obs) { obs.disconnect(); obs = null; }
      marcarVista('inicio');
      const lista = ciudades(), s = S();
      if (!lista.length) { box.innerHTML = `<p class="ab-vacio">${PM.t('Aún no tienes álbumes. Pisa una ciudad y aparecerá aquí.')}</p>`; return; }
      const mias = {}; for (const r of Object.values(s.landmarks || {})) if (r.city) mias[r.city] = (mias[r.city] || 0) + 1;
      const aqui = typeof opts.ciudadActual === 'function' ? opts.ciudadActual() : null;
      const cmp = (a, b) => {
        if (ordenAntes === 'az') return a.localeCompare(b, PM.LOCALE || 'es', { sensitivity: 'base' });
        return ((b === aqui) - (a === aqui)) || ((mias[b] || 0) - (mias[a] || 0)) || a.localeCompare(b, PM.LOCALE || 'es', { sensitivity: 'base' });
      };
      const activas = lista.filter((c) => (mias[c] || 0) > 0 || c === aqui).sort(cmp);
      const ceros = activas.length ? lista.filter((c) => !mias[c] && c !== aqui).sort((a, b) => a.localeCompare(b, PM.LOCALE || 'es', { sensitivity: 'base' })) : [];
      const principales = activas.length ? activas : lista.slice().sort(cmp);

      const gr = PM.tcg.byCountry(principales.map((city) => ({ city, ids: [] })), s.countries, ordenAntes !== 'az');
      const paises = new Set(gr.map((g) => g.country));
      const filaHTML = (city) => `<button class="ab-fila ${city === aqui ? 'aqui' : ''}" data-c="${esc(city)}"><span class="ab-mini"></span><span class="ab-fn" translate="no">${esc(city)}${city === aqui ? ` <em class="ab-aqui">📍 ${PM.t('Estás aquí')}</em>` : ''}</span><span class="ab-fc">${PM.fmtNum(mias[city] || 0)}</span><i class="ab-bar"><em style="width:0"></em></i><span class="ab-fs"></span></button>`;

      const barraOrd = principales.length >= 5 ? `<div class="ab-ord"><button class="ab-chip ${ordenAntes === 'cartas' ? 'on' : ''}" data-ord="cartas">${PM.t('Más cartas')}</button><button class="ab-chip ${ordenAntes === 'az' ? 'on' : ''}" data-ord="az">${PM.t('A–Z')}</button></div>` : '';
      let html = barraOrd + gr.map((g, i) => (paises.size > 1 && (i === 0 || gr[i - 1].country !== g.country)
        ? `<div class="ab-pais" role="heading" aria-level="3">${g.flag || ''} ${esc(g.country)}</div>` : '') + filaHTML(g.city)).join('');
      if (ceros.length) {
        const txtN = ceros.length === 1 ? PM.t('1 ciudad') : PM.t('{n} ciudades', { n: PM.fmtNum(ceros.length) });
        html += `<details class="ab-cero"><summary><span>${PM.t('Recién pisadas')} · ${txtN}</span><small>${PM.t('0 cartas')}</small></summary><div class="ab-cero-in">${ceros.map(filaHTML).join('')}</div></details>`;
      }
      box.innerHTML = html;
      box.querySelectorAll('[data-ord]').forEach((b) => b.addEventListener('click', () => { ordenAntes = b.dataset.ord; inicio(); }));
      const filas = [...box.querySelectorAll('.ab-fila')];
      filas.forEach((el) => el.addEventListener('click', () => ciudad(el.dataset.c)));

      // Cargar metadatos de álbumes con concurrencia controlada (4 en paralelo) para no saturar red/IDB
      let idx = 0;
      const worker = async () => {
        while (idx < filas.length && seq === navSeq && box.isConnected) {
          const el = filas[idx++], city = el.dataset.c;
          let A = null; try { A = await W().albumDe(city); } catch (e) { A = null; }
          if (seq !== navSeq || !el.isConnected || !A) continue;
          const E = enlazar(A, S().landmarks, city), [mg, mn] = cuantos(E.principal.filter((e) => e.must));
          el.querySelector('.ab-mini').setAttribute('style', fondo(A.portada));
          el.querySelector('.ab-fc').innerHTML = `${PM.fmtNum(E.got)}<small>/${PM.fmtNum(E.total)}</small>`;
          el.querySelector('.ab-bar em').style.width = (E.total ? Math.min(100, E.got / E.total * 100) : 0) + '%';
          el.querySelector('.ab-fs').textContent = `${pctDe(E.got, E.total)} %` + (mn ? ` · ★ ${mg}/${mn}` : '') + (E.got >= E.total && E.total ? ' · 🏅' : '');
          el.dataset.got = String(E.got);
          // Reordenar filas activas por cartas reales del álbum (no totales con extras) si estamos en modo «Más cartas» y sin cabeceras de país
          if (ordenAntes === 'cartas' && paises.size <= 1 && !el.closest('.ab-cero')) {
            const act = [...box.querySelectorAll(':scope > .ab-fila')];
            const gotOf = (x) => (x.dataset.got != null ? +x.dataset.got : (mias[x.dataset.c] || 0));
            const ord = act.slice().sort((a, b) => ((b.dataset.c === aqui) - (a.dataset.c === aqui))
              || (gotOf(b) - gotOf(a))
              || a.dataset.c.localeCompare(b.dataset.c, PM.LOCALE || 'es', { sensitivity: 'base' }));
            const ancla = box.querySelector('.ab-cero');
            for (const f of ord) box.insertBefore(f, ancla);
          }
        }
      };
      for (let k = 0; k < Math.min(4, filas.length); k++) worker();

      const pos = {}; for (const r of Object.values(s.landmarks)) if (r.city && r.pos && !pos[r.city]) pos[r.city] = r.pos;
      PM.ensureCountries(s, pos).then((ch) => {
        if (ch) {
          if (!fuente && PM.state) PM.state.save();
          if (seq === navSeq && box.isConnected && box.dataset.vista === 'inicio') inicio();
        }
      });
    }

    async function ciudad(city) {
      const seq = ++navSeq;
      clearTimeout(tq); limpiarScroll();
      if (obs) { obs.disconnect(); obs = null; }
      marcarVista('ciudad');
      box.innerHTML = `<div class="ab-barra"><button class="ab-atras" aria-label="${esc(PM.t('Volver a los álbumes'))}">‹</button><b translate="no">${esc(city)}</b><span></span>${opts.cerrar ? `<button class="ab-cerrar" aria-label="${esc(PM.t('Cerrar'))}">✕</button>` : ''}</div><p class="ab-vacio">${PM.t('Abriendo el álbum…')}</p>`;
      box.querySelector('.ab-atras').addEventListener('click', () => { inicio(); arriba(true); });
      const btnX0 = box.querySelector('.ab-cerrar'); if (btnX0) btnX0.addEventListener('click', () => opts.cerrar());
      arriba(true);

      let A = null; try { A = await W().albumDe(city); } catch (e) { A = null; }
      if (seq !== navSeq || !box.isConnected) return;
      if (!A) { box.querySelector('.ab-vacio').textContent = PM.t('No se pudo abrir el álbum. Prueba con conexión.'); return; }

      const E = enlazar(A, S().landmarks, city), D = estructura(city, A, E);
      const posFn = typeof opts.pos === 'function' ? opts.pos : null;
      const [mg, mn] = cuantos(E.principal.filter((e) => e.must));
      const tengoCat = E.got, demas = E.principal.length ? E.extras.filter((e) => e.id).length + E.otras.length : 0;
      const faltan = E.principal.filter((e) => !e.id).length;
      const disponibles = new Set(['todo', 'tengo']);
      if (faltan) disponibles.add('faltan');
      if (mn) disponibles.add('must');
      if (posFn && faltan && posFn()) disponibles.add('cerca');
      const st = { modo: disponibles.has(modoAntes) ? modoAntes : 'todo', rar: null, q: '', rarsOpen: false, todoAbierto: null };

      const rars = ['legendario', 'epico', 'raro', 'comun'].map((r) => { const [g, n] = cuantos(E.principal.filter((e) => e.rarity === r)); return { r, g, n }; }).filter((x) => x.n);
      const pct = pctDe(E.got, E.total), ancho = E.total ? Math.min(100, E.got / E.total * 100) : 0;
      const esGrande = E.total > 45 && D.length > 1;
      const extraTxt = demas ? ` · ${demas === 1 ? PM.t('1 extra más') : PM.t('+ {n} extras', { n: PM.fmtNum(demas) })}` : '';

      // Distrito inicial a abrir en ciudades grandes: donde estás por GPS (< ~2,2 km), o el que tiene más progreso
      let distInicial = 0;
      const miPos = posFn && posFn();
      if (esGrande) {
        let mejorG = -1, distProg = 0, mejorD = Infinity, distGPS = 0;
        D.forEach((d, i) => {
          const [g] = cuantos(d.L);
          if (g > mejorG) { mejorG = g; distProg = i; }
          if (miPos) {
            for (const e of d.L) {
              if (!e.pos) continue;
              const dd = (e.pos[0] - miPos[0]) ** 2 + (e.pos[1] - miPos[1]) ** 2;
              if (dd < mejorD) { mejorD = dd; distGPS = i; }
            }
          }
        });
        distInicial = mejorD <= 0.0004 ? distGPS : distProg;
      }

      const chip = (m, txt) => `<button class="ab-chip ${st.modo === m ? 'on' : ''}" data-m="${m}" aria-pressed="${st.modo === m}">${txt}</button>`;
      box.innerHTML = `
        <div class="ab-barra"><button class="ab-atras" aria-label="${esc(PM.t('Volver a los álbumes'))}">‹</button><b translate="no">${esc(city)}</b><span>${PM.fmtNum(E.got)}<small>/${PM.fmtNum(E.total)}</small></span>${opts.cerrar ? `<button class="ab-cerrar" aria-label="${esc(PM.t('Cerrar'))}">✕</button>` : ''}</div>
        <div class="ab-cab" style="${fondo(A.portada)}"><div class="ab-velo"></div>
          <div class="ab-tit"><small>${PM.t('Álbum de')}</small><b translate="no" class="${city.length > 14 ? 'largo' : ''}">${esc(city)}</b></div></div>
        <div class="ab-cifras"><b>${pct}<small> %</small></b><div><i class="ab-bar"><em style="width:${ancho}%"></em></i>
          <span>${PM.t('{a} de {b} lugares', { a: PM.fmtNum(E.got), b: PM.fmtNum(E.total) })}${mn ? ` · ★ ${PM.t('{a} de {b} imprescindibles', { a: mg, b: mn })}` : ''}${extraTxt}</span></div></div>
        ${A.parcial ? `<p class="ab-nota">${PM.t('Este álbum crece al explorar: aparecen más lugares según recorres la ciudad.')}</p>` : ''}
        <div class="ab-busc-row">
          <input class="ab-buscar" type="search" enterkeyhint="search" placeholder="${esc(PM.t('Buscar un lugar del álbum'))}" aria-label="${esc(PM.t('Buscar un lugar del álbum'))}">
          ${rars.length > 1 ? `<button class="ab-fbtn" type="button" aria-expanded="false"><span>🎚️ ${PM.t('Filtros')}</span><i class="ab-fdot"></i></button>` : ''}
        </div>
        ${rars.length > 1 ? `<div class="ab-chips ab-rars" role="group" aria-label="${esc(PM.t('Rareza'))}" hidden>${rars.map((x) => `<button class="ab-chip ab-rar" data-r="${x.r}" aria-pressed="false" style="--rz:${PM.lugares.RARITY[x.r].color}"><i></i>${PM.t(PM.lugares.RARITY[x.r].label)} <small>${PM.fmtNum(x.g)}/${PM.fmtNum(x.n)}</small></button>`).join('')}</div>` : ''}
        <div class="ab-chips" role="group" aria-label="${esc(PM.t('Qué ver'))}">
          ${chip('todo', PM.t('Todo'))}${faltan ? chip('faltan', `${PM.t('Me faltan')} <small>${PM.fmtNum(faltan)}</small>`) : ''}${chip('tengo', `${PM.t('Tengo')} <small>${PM.fmtNum(tengoCat)}</small>`)}
          ${mn ? chip('must', `★ ${PM.t('Imprescindibles')} <small>${mg}/${mn}</small>`) : ''}${posFn && faltan ? chip('cerca', `📍 ${PM.t('Cerca de ti')}`) : ''}</div>
        ${esGrande ? `<div class="ab-acc-bar"><button class="ab-acc-btn" type="button">${PM.t('Desplegar todo')}</button></div>` : ''}
        <div class="ab-lista"></div>
        <button class="ab-top" type="button" aria-label="${esc(PM.t('Subir arriba'))}" hidden>↑</button>`;

      box.querySelector('.ab-atras').addEventListener('click', () => { clearTimeout(tq); inicio(); arriba(true); });
      const btnX = box.querySelector('.ab-cerrar'); if (btnX) btnX.addEventListener('click', () => opts.cerrar());
      const fbtn = box.querySelector('.ab-fbtn'), rarsEl = box.querySelector('.ab-rars');
      if (fbtn && rarsEl) {
        fbtn.addEventListener('click', () => {
          st.rarsOpen = !st.rarsOpen;
          rarsEl.hidden = !st.rarsOpen;
          fbtn.setAttribute('aria-expanded', String(st.rarsOpen));
          fbtn.classList.toggle('open', st.rarsOpen);
        });
      }
      box.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => {
        st.modo = modoAntes = b.dataset.m;
        st.todoAbierto = null;
        box.querySelectorAll('[data-m]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
        lista();
      }));
      box.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => {
        st.rar = st.rar === b.dataset.r ? null : b.dataset.r;
        box.querySelectorAll('[data-r]').forEach((x) => { const on = x.dataset.r === st.rar; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
        if (fbtn) fbtn.classList.toggle('activo', !!st.rar);
        lista();
      }));
      const accBtn = box.querySelector('.ab-acc-btn');
      if (accBtn) {
        accBtn.addEventListener('click', () => {
          const abrir = accBtn.dataset.est !== 'abierto';
          st.todoAbierto = abrir;
          box.querySelectorAll('.ab-dis, .ab-barrio').forEach((d) => { d.open = abrir; });
          accBtn.dataset.est = abrir ? 'abierto' : 'cerrado';
          accBtn.textContent = abrir ? PM.t('Plegar todo') : PM.t('Desplegar todo');
        });
      }
      box.querySelector('.ab-buscar').addEventListener('input', (ev) => {
        clearTimeout(tq);
        tq = setTimeout(() => {
          if (seq !== navSeq || !box.isConnected || box.dataset.vista !== 'ciudad') return;
          st.q = norm(ev.target.value).trim();
          lista();
        }, 160);
      });
      const btnTop = box.querySelector('.ab-top');
      btnTop.addEventListener('click', () => arriba(true));
      scrollEl = box.closest('#sheet .body') || scroller() || window;
      onScroll = () => {
        if (!btnTop.isConnected) { limpiarScroll(); return; }
        const y = scrollEl === window ? window.scrollY : scrollEl.scrollTop;
        btnTop.hidden = y < 450;
      };
      scrollEl.addEventListener('scroll', onScroll, { passive: true });

      const info = (e) => {
        const r = e.id ? S().landmarks[e.id] || {} : {};
        return { name: e.name || r.name || '', emoji: e.emoji || r.emoji || '📍', rarity: e.rarity || r.rarity, kind: e.kind || r.kind || '', must: !!e.must, pos: e.pos || r.pos };
      };
      const pasa = (e) => {
        const i = info(e);
        if (st.rar && i.rarity !== st.rar) return false;
        if (st.q && !norm(i.name).includes(st.q)) return false;
        if (st.modo === 'faltan') return !e.id && !e.extra && !e.suelta;
        if (st.modo === 'tengo') return !!e.id;
        if (st.modo === 'must') return e.must;
        return !!e.id || (!e.extra && !e.suelta);
      };
      const todos = [];
      const cromoTengo = (e) => {
        const i = info(e), R = PM.lugares.RARITY[i.rarity] || {}, k = todos.push(e) - 1;
        return `<button class="ab-c tengo ${e.suelta || e.extra ? 'demas' : ''} ${i.must ? 'must' : ''}" data-k="${k}" data-lm="${esc(e.id)}" style="--rz:${R.color || '#9aa4b2'}" title="${esc(PM.t(R.label || ''))}"><span class="ab-ph">${esc(i.emoji)}<i class="ab-cam" aria-hidden="true">📷</i></span><b translate="no">${esc(i.name)}</b>${e.n ? `<small>Nº ${e.n}</small>` : ''}</button>`;
      };
      const cromoFalta = (e) => {
        const i = info(e), R = PM.lugares.RARITY[i.rarity] || {}, k = todos.push(e) - 1;
        return `<button class="ab-c falta ${i.must ? 'must' : ''}" data-k="${k}" style="--rz:${R.color || '#9aa4b2'}" title="${esc(PM.t(R.label || ''))}${i.kind ? ' · ' + esc(PM.t(i.kind)) : ''}"><span class="ab-fph">${esc(i.emoji)}</span><span class="ab-ftxt"><b translate="no">${esc(i.name)}</b>${e.n ? `<small>${i.must ? '★ ' : ''}Nº ${e.n}</small>` : ''}</span></button>`;
      };
      const pintarBloque = (ver) => {
        const gan = ver.filter((e) => e.id), fal = ver.filter((e) => !e.id);
        return (gan.length ? `<div class="ab-grid">${gan.map(cromoTengo).join('')}</div>` : '') +
          (fal.length ? `<div class="ab-faltan">${fal.map(cromoFalta).join('')}</div>` : '');
      };

      function lista() {
        const out = box.querySelector('.ab-lista');
        if (!out) return;
        todos.length = 0;
        if (obs) { obs.disconnect(); obs = null; }
        const enCerca = st.modo === 'cerca';
        box.classList.toggle('ab-en-cerca', enCerca);
        if (accBtn) accBtn.parentElement.hidden = enCerca;
        if (enCerca) { out.innerHTML = cerca(); enchufar(out); return; }
        const filtrado = !!(st.q || st.rar || st.modo === 'must' || st.modo === 'tengo');
        let html = '', hay = 0;
        D.forEach((d, i) => {
          const usarSubAc = esGrande && !filtrado && d.barrios.length > 1 && d.L.length > 35;
          let mejorB = 0, mejorBG = -1;
          if (usarSubAc) d.barrios.forEach((b, bi) => { const [g] = cuantos(b.L); if (g > mejorBG) { mejorBG = g; mejorB = bi; } });
          let cuerpo = '';
          d.barrios.forEach((b, bi) => {
            const X = b.X || [], ver = b.L.concat(X).filter(pasa).sort((x, y) => (y.id ? 1 : 0) - (x.id ? 1 : 0) || (x.n || 1e9) - (y.n || 1e9));
            const mas = st.modo === 'todo' || st.modo === 'faltan' ? X.filter((e) => !e.id && e.extra && (!st.rar || info(e).rarity === st.rar) && (!st.q || norm(info(e).name).includes(st.q))) : [];
            if (!ver.length && !mas.length) return;
            hay += ver.length + mas.length;
            const [g, n] = cuantos(b.L);
            const contenido = pintarBloque(ver) +
              (mas.length ? `<details class="ab-mas"><summary>＋ ${mas.length === 1 ? PM.t('1 lugar más') : PM.t('{n} lugares más', { n: PM.fmtNum(mas.length) })} <small>${PM.t('no cuentan para el álbum')}</small></summary><div class="ab-faltan">${mas.map(cromoFalta).join('')}</div></details>` : '');
            if (b.nombre && usarSubAc) {
              const bAbierto = st.todoAbierto != null ? st.todoAbierto : (bi === mejorB);
              cuerpo += `<details class="ab-barrio" ${bAbierto ? 'open' : ''}><summary class="ab-bh" translate="no"><span>${esc(b.nombre)}</span>${n ? `<small>${g}/${n}</small>` : ''}<i class="ab-chev" aria-hidden="true">▾</i></summary><div class="ab-barrio-in">${contenido}</div></details>`;
            } else {
              cuerpo += (b.nombre ? `<div class="ab-bh" role="heading" aria-level="4" translate="no"><span>${esc(b.nombre)}</span>${n ? `<small>${g}/${n}</small>` : ''}</div>` : '') + contenido;
            }
          });
          const [g, n] = cuantos(d.L);
          if (cuerpo) {
            const abierto = !esGrande || filtrado || (st.todoAbierto != null ? st.todoAbierto : i === distInicial);
            const pctD = n ? Math.min(100, g / n * 100) : 0;
            html += `<details class="ab-dis" data-d="${i}" style="--c:${d.tinta}" ${abierto ? 'open' : ''}><summary class="ab-dh" translate="no"><i></i><span>${esc(d.nombre)}</span>${n ? `<small>${g}/${n}</small><i class="ab-chev" aria-hidden="true">▾</i><i class="ab-bar"><em style="width:${pctD}%"></em></i>` : '<i class="ab-chev" aria-hidden="true">▾</i>'}</summary><div class="ab-dis-in">${cuerpo}</div></details>`;
          }
        });
        if (accBtn) {
          const allOpen = !esGrande || filtrado || st.todoAbierto === true;
          accBtn.dataset.est = allOpen ? 'abierto' : 'cerrado';
          accBtn.textContent = allOpen ? PM.t('Plegar todo') : PM.t('Desplegar todo');
        }
        out.innerHTML = hay ? html : `<p class="ab-vacio">${st.q ? PM.t('Ningún lugar del álbum se llama así.') : st.modo === 'faltan' ? PM.t('¡No te falta ninguno! 🏅') : st.modo === 'tengo' ? PM.t('Aún no tienes cartas de aquí: pasea cerca de sus lugares.') : PM.t('Nada con este filtro.')}</p>`;
        enchufar(out);
      }
      function cerca() {
        const p = posFn && posFn();
        if (!p) return `<p class="ab-vacio">${PM.t('Para ver lo que tienes cerca, activa el GPS.')}</p>`;
        const dist = (q) => (PM.geo && PM.geo.dist ? PM.geo.dist(p, q) : Math.sqrt(((p[0] - q[0]) * 111000) ** 2 + ((p[1] - q[1]) * 111000 * Math.cos(p[0] * Math.PI / 180)) ** 2));
        const L = E.principal.filter((e) => !e.id && e.pos && (!st.rar || e.rarity === st.rar) && (!st.q || norm(e.name).includes(st.q)))
          .map((e) => [e, dist(e.pos)]).sort((x, y) => x[1] - y[1]).slice(0, 40);
        if (!L.length) return `<p class="ab-vacio">${PM.t('Nada con este filtro.')}</p>`;
        return `<div class="ab-cerca">${L.map(([e, m]) => {
          const R = PM.lugares.RARITY[e.rarity] || {}, k = todos.push(e) - 1, b = A.b && e.bi != null ? A.b[e.bi] : '';
          return `<button class="ab-cf falta" data-k="${k}" style="--rz:${R.color || '#9aa4b2'}"><span class="ab-ph">${esc(e.emoji || '📍')}</span><span class="ab-cft"><b translate="no">${e.must ? '★ ' : ''}${esc(e.name)}</b><small>${[b, PM.t(R.label || '')].filter(Boolean).map(esc).join(' · ')}</small></span><em>${PM.fmtDist ? PM.fmtDist(m) : Math.round(m) + ' m'}</em></button>`;
        }).join('')}</div>`;
      }
      function enchufar(out) {
        out.querySelectorAll('[data-k]').forEach((el) => el.addEventListener('click', () => {
          const e = todos[+el.dataset.k]; if (!e) return;
          if (e.id) opts.abrir(e.id); else if (opts.irA && e.pos) opts.irA({ pos: e.pos, name: e.name });
        }));
        const llenar = (el) => { el.dataset.h = '1'; foto(el); };
        const mios = out.querySelectorAll('.ab-c.tengo');
        if ('IntersectionObserver' in window) {
          obs = new IntersectionObserver((es) => es.forEach((x) => { if (x.isIntersecting) { obs.unobserve(x.target); llenar(x.target); } }), { rootMargin: '300px 0px' });
          mios.forEach((el) => obs.observe(el));
        } else mios.forEach(llenar);
      }
      lista();
      arriba(true);
    }

    async function foto(el) {
      const id = el.dataset.lm, d = await datos(id);
      if (!el.isConnected || !d) return;
      const ph = el.querySelector('.ab-ph');
      if (d.img && !el.dataset.own) {
        const url = String(d.img), im = new Image();
        im.onload = () => {
          if (!el.isConnected || el.dataset.own) return;
          ph.style.backgroundImage = `url('${url.replace(/'/g, '%27')}')`;
          ph.textContent = '';
          ph.classList.add('con');
        };
        im.src = url;
      }
      if (d.shiny) el.classList.add('brilla');
      if (opts.pegada) opts.pegada(el, id);
    }
    function refrescar() {
      cache.clear();
      box.querySelectorAll('.ab-c.tengo[data-h]').forEach((el) => foto(el));
    }
    inicio();
    return { ciudad, refrescar, inicio, destruir: () => { clearTimeout(tq); limpiarScroll(); if (obs) { obs.disconnect(); obs = null; } } };
  }

  // ---------------- La primera vez que pisas una ciudad ----------------
  async function nuevo(city, abrir) {
    estilos();
    const A = await W().albumDe(city);
    if (!A) return false;
    const E = enlazar(A, S().landmarks, city);
    if (document.getElementById('ab-nuevo')) return false;
    const ov = document.createElement('div');
    ov.id = 'ab-nuevo';
    ov.innerHTML = `<div class="ab-nuevo-in"><p class="ab-ya">${PM.t('¡Nuevo álbum!')}</p><div class="ab-cover grande">${portada(city, A, E)}</div>
      <div class="cv-actions"><button class="btn" id="ab-luego">Luego</button><button class="btn on" id="ab-abrir">Abrir álbum</button></div></div>`;
    document.body.appendChild(ov);
    PM.sound.capture(); PM.vibrate([60, 40, 120]);
    ov.querySelector('#ab-luego').addEventListener('click', () => ov.remove());
    ov.querySelector('#ab-abrir').addEventListener('click', () => { ov.remove(); abrir(city); });
    return true;
  }

  // ---------------- Estilos ----------------
  let hechos = false;
  function estilos() {
    if (hechos) return; hechos = true;
    const st = document.createElement('style');
    st.textContent = `
    #sheet:has(#album-box) { height: 92%; max-height: 92%; }
    #sheet.en-ciudad .head { display: none; }
    #album-box.en-ciudad > .seg.tabs, #album-box.en-ciudad > .ab-sueltas,
    #album-box:has(#city-stacks[data-vista="ciudad"]) > .seg.tabs, #album-box:has(#city-stacks[data-vista="ciudad"]) > .ab-sueltas { display: none; }
    #album-box, #city-stacks { --ab-barh: 52px; }
    .ab-vacio { margin: 18px 4px; color: var(--muted); font-size: 14px; line-height: 1.45; }
    .ab-bar { display: block; height: 6px; border-radius: 9px; background: var(--track, rgba(127,127,127,.25)); overflow: hidden; }
    .ab-bar em { display: block; height: 100%; border-radius: 9px; background: var(--accent, #1f5fbf); }

    /* lista de ciudades */
    .ab-ord { display: flex; justify-content: flex-end; gap: 6px; margin: 2px 0 8px; }
    .ab-ord .ab-chip { height: 30px; padding: 0 11px; font-size: 12px; }
    .ab-pais { margin: 16px 2px 8px; font-size: 13px; font-weight: 800; color: var(--muted); }
    .ab-pais:first-child { margin-top: 4px; }
    .ab-fila { display: grid; grid-template-columns: 58px minmax(0, 1fr) auto; grid-template-rows: auto auto auto; column-gap: 12px; row-gap: 4px; align-items: center;
      width: 100%; margin: 0 0 8px; padding: 8px 12px 8px 8px; border: 1px solid var(--line); border-radius: 14px; background: var(--card); color: var(--text); font: inherit; text-align: left; cursor: pointer; }
    .ab-fila.aqui { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
    .ab-aqui { display: inline-block; margin-left: 6px; padding: 1px 7px; border-radius: 99px; background: var(--accent); color: #fff; font-style: normal; font-size: 11px; font-weight: 700; vertical-align: middle; }
    .ab-mini { grid-row: 1 / 4; width: 58px; height: 58px; border-radius: 10px; background: var(--btn, #e6eaf2) center / cover no-repeat; }
    .ab-fn { font-size: 15.5px; font-weight: 800; overflow-wrap: break-word; }
    .ab-fc { font-size: 14px; font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; } .ab-fc small { font-weight: 700; color: var(--muted); }
    .ab-fila .ab-bar { grid-column: 2 / 4; }
    .ab-fs { grid-column: 2 / 4; font-size: 12.5px; font-weight: 600; color: var(--muted); font-variant-numeric: tabular-nums; }
    .ab-cero { margin-top: 14px; }
    .ab-cero summary { list-style: none; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 11px 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--card); color: var(--text); font-size: 13.5px; font-weight: 800; cursor: pointer; }
    .ab-cero summary::-webkit-details-marker { display: none; }
    .ab-cero summary small { color: var(--muted); font-weight: 700; }
    .ab-cero-in { margin-top: 8px; }
    @media (hover: hover) { .ab-fila:hover { border-color: var(--accent); } }

    /* álbum de una ciudad: una sola barra fija */
    .ab-barra { position: sticky; top: var(--ab-tope, 0px); z-index: 6; display: flex; align-items: center; gap: 8px; height: var(--ab-barh); margin: 0 var(--ab-lado, -16px); padding: 0 var(--ab-lado-p, 16px); background: var(--ab-fondo, var(--sheet)); border-bottom: 1px solid var(--line); }
    .ab-atras, .ab-cerrar { flex: none; width: 40px; height: 40px; border: 0; border-radius: 12px; background: var(--btn, #e6eaf2); color: var(--text); font: inherit; font-size: 22px; font-weight: 800; line-height: 1; cursor: pointer; }
    .ab-cerrar { font-size: 16px; border-radius: 50%; }
    .ab-barra b { flex: 1; min-width: 0; font-size: 18px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ab-barra span { font-size: 14px; font-weight: 800; font-variant-numeric: tabular-nums; } .ab-barra span small { color: var(--muted); font-weight: 700; }
    .ab-cab { position: relative; height: 112px; margin: 10px 0 0; border-radius: 16px; overflow: hidden; background: linear-gradient(135deg, var(--paint, #2563eb), #111827) center / cover no-repeat; }
    .ab-cab[style*="background-image"] { background-size: cover; background-position: center; }
    .ab-velo { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(10,14,24,0) 28%, rgba(10,14,24,.72) 100%); }
    .ab-tit { position: absolute; left: 0; right: 10px; bottom: 10px; color: #fff; }
    .ab-tit small { display: block; margin: 0 0 2px 14px; font-size: 12px; font-weight: 700; text-shadow: 0 1px 3px rgba(0,0,0,.7); }
    .ab-tit b { display: inline-block; max-width: 100%; box-sizing: border-box; padding: 3px 20px 5px 14px; font-size: 28px; line-height: 1.02; font-weight: 900; font-style: italic; letter-spacing: -1px; overflow-wrap: anywhere;
      background: var(--paint, #2563eb); clip-path: polygon(0 5%, 22% 0, 48% 6%, 74% 1%, 97% 5%, 100% 30%, 96% 52%, 100% 76%, 95% 96%, 70% 100%, 44% 94%, 20% 100%, 0 95%); }
    .ab-tit b.largo { font-size: 22px; letter-spacing: -.5px; }
    .ab-cifras { display: flex; align-items: center; gap: 14px; margin: 10px 2px 2px; }
    .ab-cifras > b { font-size: 32px; font-weight: 900; letter-spacing: -1.5px; line-height: 1; font-variant-numeric: tabular-nums; white-space: nowrap; } .ab-cifras > b small { font-size: 15px; letter-spacing: 0; }
    .ab-cifras > div { flex: 1; min-width: 0; } .ab-cifras .ab-bar { height: 8px; margin-bottom: 5px; }
    .ab-cifras span { display: block; font-size: 12.5px; font-weight: 600; color: var(--muted); line-height: 1.35; }
    .ab-nota { margin: 6px 2px 0; font-size: 12.5px; color: var(--muted); line-height: 1.4; }
    .ab-busc-row { display: flex; gap: 8px; margin: 10px 0 0; }
    .ab-buscar { flex: 1; min-width: 0; height: 42px; padding: 0 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--card); color: var(--text); font: inherit; font-size: 14.5px; }
    .ab-buscar:focus { outline: 2px solid var(--accent); outline-offset: 0; border-color: transparent; }
    .ab-fbtn { position: relative; flex: none; display: inline-flex; align-items: center; gap: 6px; height: 42px; padding: 0 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--card); color: var(--text); font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
    .ab-fbtn.open, .ab-fbtn.activo { border-color: var(--accent); color: var(--accent); }
    .ab-fdot { display: none; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
    .ab-fbtn.activo .ab-fdot { display: inline-block; }
    .ab-chips { display: flex; gap: 8px; margin: 10px var(--ab-lado, -16px) 0; padding: 0 var(--ab-lado-p, 16px) 2px; overflow-x: auto; scrollbar-width: none; }
    .ab-chips[hidden] { display: none; }
    .ab-chips::-webkit-scrollbar { display: none; }
    .ab-chip { flex: none; display: inline-flex; align-items: center; gap: 6px; height: 34px; padding: 0 13px; border: 1px solid var(--line); border-radius: 99px; background: var(--card); color: var(--text); font: inherit; font-size: 13px; font-weight: 700; white-space: nowrap; cursor: pointer; }
    .ab-chip small { font-weight: 700; color: var(--muted); font-variant-numeric: tabular-nums; }
    .ab-chip.on { background: var(--accent); border-color: var(--accent); color: #fff; } .ab-chip.on small { color: rgba(255,255,255,.85); }
    .ab-rars .ab-chip { height: 31px; font-size: 12.5px; } .ab-rar i { width: 9px; height: 9px; border-radius: 50%; background: var(--rz); }
    .ab-rar.on { background: var(--rz); border-color: var(--rz); }
    .ab-acc-bar { display: flex; justify-content: flex-end; margin: 8px 0 0; }
    .ab-acc-btn { padding: 4px 10px; border: 0; border-radius: 8px; background: transparent; color: var(--accent); font: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; }

    /* distritos y barrios en acordeón limpio */
    .ab-lista { margin-top: 8px; padding-bottom: 42px; }
    .ab-dis { margin: 0 0 10px; border: 1px solid var(--line); border-radius: 14px; background: var(--card); overflow: clip; }
    .ab-dh { list-style: none; display: grid; grid-template-columns: 4px minmax(0, 1fr) auto auto; grid-template-rows: auto auto; column-gap: 10px; row-gap: 5px; align-items: center;
      padding: 10px 12px; background: var(--card); font-size: 15.5px; font-weight: 800; cursor: pointer; user-select: none; }
    .ab-dh::-webkit-details-marker { display: none; }
    .ab-dis[open] > .ab-dh { position: sticky; top: calc(var(--ab-tope, 0px) + var(--ab-barh)); z-index: 3; border-bottom: 1px solid var(--line); }
    .ab-dh > i:first-child { grid-row: 1 / 3; align-self: stretch; border-radius: 2px; background: var(--c); }
    .ab-dh span { overflow-wrap: break-word; } .ab-dh small { font-size: 13px; font-weight: 800; color: var(--muted); font-variant-numeric: tabular-nums; }
    .ab-dh .ab-bar { grid-column: 2 / 5; height: 4px; } .ab-dh .ab-bar em { background: var(--c); }
    .ab-chev { font-style: normal; font-size: 13px; color: var(--muted); transition: transform .15s; }
    .ab-dis:not([open]) > .ab-dh .ab-chev, .ab-barrio:not([open]) > .ab-bh .ab-chev { transform: rotate(-90deg); }
    .ab-dis-in { padding: 8px 10px 12px; background: var(--ab-fondo, var(--sheet)); }
    .ab-barrio { margin: 8px 0 0; border-top: 1px solid var(--line); padding-top: 6px; }
    .ab-barrio:first-child { margin-top: 0; border-top: 0; padding-top: 0; }
    .ab-barrio > summary.ab-bh { list-style: none; cursor: pointer; margin: 4px 2px 6px; padding: 4px 2px; }
    .ab-barrio > summary.ab-bh::-webkit-details-marker { display: none; }
    .ab-barrio-in { padding-bottom: 4px; }
    .ab-bh { display: flex; align-items: center; gap: 8px; margin: 12px 2px 8px; font-size: 13.5px; font-weight: 800; color: var(--text); }
    .ab-bh span { flex: 1; min-width: 0; }
    .ab-bh small { font-weight: 700; color: var(--muted); font-variant-numeric: tabular-nums; }

    /* cromos conquistados: rejilla de 3 con banda de rareza SIEMPRE visible */
    .ab-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(98px, 1fr)); gap: 9px; }
    .ab-c { position: relative; display: flex; flex-direction: column; min-width: 0; padding: 0; border: 0; border-radius: 12px; overflow: hidden; background: var(--card); color: var(--text); font: inherit; text-align: left; cursor: pointer; }
    .ab-c.tengo { border-top: 3.5px solid var(--rz); box-shadow: 0 1px 4px rgba(15,23,42,.16); padding-bottom: 7px; }
    .ab-c.tengo .ab-ph { position: relative; display: grid; place-items: center; aspect-ratio: 1; font-size: 30px; background: linear-gradient(135deg, color-mix(in srgb, var(--rz) 18%, var(--card)), var(--btn, #e6eaf2)) center / cover no-repeat; }
    .ab-c.tengo .ab-ph.con { font-size: 0; background-size: cover; background-position: center; }
    .ab-c.tengo .ab-ph.con .ab-cam { display: none; }
    .ab-cam { position: absolute; right: 6px; bottom: 5px; font-style: normal; font-size: 12px; opacity: .55; }
    .ab-c.tengo b { margin: 6px 7px 0; font-size: 12px; line-height: 1.25; font-weight: 700; overflow-wrap: break-word; }
    .ab-c.tengo small { margin: 2px 7px 0; font-size: 10.5px; font-weight: 700; color: var(--muted); font-variant-numeric: tabular-nums; }
    .ab-c.brilla .ab-ph { box-shadow: inset 0 0 0 2.5px #ffd54a; }
    .ab-c.tengo.must::before { content: '★'; position: absolute; top: 5px; left: 5px; z-index: 2; display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: rgba(15,23,42,.68); color: #ffd54a; font-size: 11px; }
    .ab-c.demas::after { content: '✦'; position: absolute; top: 5px; right: 5px; z-index: 2; display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: rgba(15,23,42,.68); color: #fff; font-size: 11px; }

    /* lugares que faltan: fichas horizontales compactas (mitad de scroll, mucho más legibles) */
    .ab-faltan { display: grid; grid-template-columns: repeat(auto-fill, minmax(148px, 1fr)); gap: 7px; margin-top: 8px; }
    .ab-grid + .ab-faltan { margin-top: 10px; }
    .ab-c.falta { flex-direction: row; align-items: center; gap: 8px; padding: 7px 9px 7px 8px; background: var(--card); border: 1px dashed var(--line); border-left: 3.5px solid var(--rz); border-radius: 11px; }
    .ab-c.falta.must { border-color: #d4a106; border-left-color: #d4a106; }
    .ab-fph { flex: none; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 8px; background: var(--btn, #e6eaf2); font-size: 17px; filter: grayscale(.65); opacity: .8; }
    .ab-ftxt { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 1px; }
    .ab-ftxt b { font-size: 12px; line-height: 1.22; font-weight: 700; color: var(--text); opacity: .82; overflow-wrap: break-word; }
    .ab-ftxt small { font-size: 10.5px; font-weight: 700; color: var(--muted); font-variant-numeric: tabular-nums; }
    @media (hover: hover) { .ab-c:hover { outline: 2px solid var(--accent); outline-offset: 1px; } }
    .ab-c:focus-visible, .ab-chip:focus-visible, .ab-atras:focus-visible, .ab-cerrar:focus-visible, .ab-fila:focus-visible, .ab-cf:focus-visible, .ab-fbtn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .ab-top { position: sticky; bottom: 12px; left: 100%; display: grid; place-items: center; width: 42px; height: 42px; margin-left: auto; border: 1px solid var(--line); border-radius: 50%; background: var(--card); color: var(--text); font: inherit; font-size: 18px; font-weight: 900; box-shadow: 0 3px 10px rgba(15,23,42,.22); cursor: pointer; z-index: 5; }
    .ab-top[hidden] { display: none; }

    /* extras que faltan, plegados al final del barrio */
    .ab-mas { margin-top: 8px; } .ab-mas summary { list-style: none; cursor: pointer; padding: 8px 10px; border-radius: 10px; background: var(--card); color: var(--text); font-size: 12.5px; font-weight: 800; }
    .ab-mas summary::-webkit-details-marker { display: none; } .ab-mas summary small { font-weight: 600; color: var(--muted); margin-left: 4px; }
    .ab-mas[open] summary { margin-bottom: 6px; }
    /* 📍 cerca de ti */
    .ab-cerca { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
    .ab-cf { display: grid; grid-template-columns: 46px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 8px 12px 8px 8px; border: 1px solid var(--line); border-left: 4px solid var(--rz); border-radius: 12px; background: var(--card); color: var(--text); font: inherit; text-align: left; cursor: pointer; }
    .ab-cf .ab-ph { display: grid; place-items: center; width: 46px; height: 46px; border-radius: 10px; background: var(--btn, #e6eaf2); font-size: 22px; filter: grayscale(.6); }
    .ab-cft b { display: block; font-size: 14px; font-weight: 800; overflow-wrap: break-word; } .ab-cft small { display: block; margin-top: 2px; font-size: 12px; color: var(--muted); }
    .ab-cf em { font-style: normal; font-size: 14px; font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; }

    /* «¡Nuevo álbum!»: la portada grande, una sola vez por ciudad */
    .ab-cover { position: relative; display: block; width: 100%; margin: 0 0 12px; padding: 0; border: 0; border-radius: 18px; overflow: hidden; text-align: left; color: #fff; font: inherit;
      background: linear-gradient(135deg, var(--paint, #2563eb), #111827); box-shadow: 0 8px 20px rgba(15,23,42,.28); }
    .ab-cover.grande { aspect-ratio: 4 / 5; }
    .ab-cover .ab-foto { position: absolute; inset: 0; background: center / cover no-repeat; }
    .ab-cover .ab-velo { background: linear-gradient(180deg, rgba(10,14,24,.34) 0%, rgba(10,14,24,0) 30%, rgba(10,14,24,.2) 52%, rgba(10,14,24,.86) 100%); }
    .ab-marca { position: absolute; top: 10px; left: 14px; font-weight: 900; font-style: italic; font-size: 16px; letter-spacing: -.5px; text-shadow: 0 1px 4px rgba(0,0,0,.6); }
    .ab-marca span:last-child { color: #7dd3fc; }
    .ab-cover .ab-tit { bottom: 44px; } .ab-cover.grande .ab-tit b { font-size: 46px; } .ab-cover.grande .ab-tit b.largo { font-size: 32px; }
    .ab-pie { position: absolute; left: 16px; right: 16px; bottom: 12px; display: flex; align-items: center; gap: 10px; }
    .ab-n { font-size: 17px; font-weight: 900; white-space: nowrap; } .ab-n small { font-size: 12px; font-weight: 700; opacity: .8; }
    .ab-pie .ab-bar { flex: 1; height: 7px; background: rgba(255,255,255,.3); } .ab-pie .ab-bar em { background: var(--paint, #2563eb); }
    #ab-nuevo { position: fixed; inset: 0; z-index: 2900; display: grid; place-items: center; padding: 16px; background: rgba(5,8,18,.8); animation: abfade .3s ease-out; }
    .ab-nuevo-in { width: min(100%, 360px); animation: abpop .55s cubic-bezier(.2,1.4,.4,1); }
    .ab-ya { margin: 0 0 10px; text-align: center; color: #fff; font-size: 24px; font-weight: 900; font-style: italic; }
    @keyframes abfade { from { opacity: 0; } } @keyframes abpop { from { transform: scale(.7) rotate(-4deg); opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { #ab-nuevo, .ab-nuevo-in { animation: none; } }`;
    document.head.appendChild(st);
  }
  return { montar, nuevo, enlazar, ciudades, usar, NO_ES_CIUDAD };
})();
