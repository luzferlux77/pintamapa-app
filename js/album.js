// PintaMapa — álbumes de ciudad. Cada ciudad tiene su lista fija de lugares (scripts/pois/albumes.mjs; world.js —albumDe— la
// recorta con el contorno real del municipio), repartida por distritos y barrios. El álbum aparece la primera vez que pisas la ciudad.
//
// REDISEÑO (23-nov-2026, petición del usuario: «lo veo caótico y poco práctico, rediséñalo al completo»). Antes: portadas a
// pantalla completa, un índice debajo de la portada y carpetas que se abrían de una en una con ‹ › — para saber qué te faltaba
// había que entrar carpeta por carpeta. Ahora:
//   · la lista de ciudades son filas compactas (miniatura, cuenta y barra);
//   · el álbum de una ciudad es UNA página: barra fija «‹ Ciudad 56/500», cabecera corta (foto y porcentaje), buscador, filtros
//     (Todo · Me faltan · Tengo · ★ Imprescindibles · 📍 Cerca de ti, y por rareza) y saltos a cada distrito;
//   · los distritos van seguidos, con su cabecera fija al bajar y sus barrios dentro; cada lugar es un cromo del mismo tamaño:
//     los tuyos con su foto, los que faltan atenuados con su número. Tocar uno tuyo abre la carta; uno que falta, el mapa.
PM.album = (function () {
  // (en «Mi progreso» la partida es la de la nube, y el contorno de cada ciudad se pide allí: usar({ save, albumDe }))
  let fuente = null;
  const usar = (f) => { fuente = f; };
  const S = () => (fuente ? fuente.save() : PM.state.data), esc = PM.esc, W = () => fuente || PM.world;
  const NO_ES_CIUDAD = /^(Zona sin nombre|Ciudad desconocida|Ciudad Demo|Otras|Otros lugares|Sector )/;
  // (la URL va dentro de url('…'): un apóstrofo del nombre del archivo la rompería)
  const fondo = (u) => (u ? `background-image:url('${esc(String(u).replace(/'/g, '%27'))}')` : '');
  const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

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

  // Un color por distrito (solo una marca fina en su cabecera y en su salto: identifica sin llenar la página de colores). Oscuros,
  // para que se lean sobre blanco, y ordenados para que dos seguidos no se parezcan
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

  // Distritos → barrios → lugares. TODO va en su distrito y su barrio (petición del usuario, 15-nov-2026): los huecos del álbum
  // (lo único que cuenta para completarlo) y lo de más —tus cartas fuera de la lista y los extras—, que no cuenta. El orden y el
  // color son fijos (por tamaño, nunca por progreso): como en un álbum de papel, se recuerda dónde está cada cosa
  function estructura(city, A, E) {
    E.principal.concat(E.extras).forEach((e, i) => { e.n = i + 1; });   // (el número del cromo, como en los álbumes de papel)
    const rec = (id) => S().landmarks[id] || {};
    // sin lista (pueblos sin datos): tus cartas son el álbum
    if (!E.principal.length && !E.extras.length) {
      return E.otras.length ? [{ nombre: city, tinta: TINTAS[0], L: E.otras.map((id) => ({ id, suelta: true })), barrios: [{ nombre: null, L: E.otras.map((id) => ({ id, suelta: true })), X: [] }] }] : [];
    }
    // tus cartas fuera de la lista: al barrio que dice la carta o, si no, al del lugar de la lista más cercano
    const sinArt = (t) => norm(t).replace(/^(el|la|els|les|l'|los|las)\s*/, '').trim();
    const porNombre = new Map(A.b.map((n, i) => [sinArt(n), i]));
    const con = A.l.filter((e) => e.pos && e.bi != null), d2 = (p, q) => (p[0] - q[0]) ** 2 + ((p[1] - q[1]) * Math.cos(p[0] * Math.PI / 180)) ** 2;
    const barrioDe = (id) => {
      const r = rec(id);
      if (r.barrio && porNombre.has(sinArt(r.barrio))) return porNombre.get(sinArt(r.barrio));
      if (!r.pos || !con.length) return -1;
      let mejor = con[0]; for (const e of con) if (d2(e.pos, r.pos) < d2(mejor.pos, r.pos)) mejor = e;
      return mejor.bi;
    };
    const sueltas = E.otras.map((id) => ({ id, suelta: true, bi: barrioDe(id) }));
    const barrios = A.b.map((n, i) => ({ nombre: n, d: (A.d || [])[i] || '', L: E.principal.filter((e) => e.bi === i), X: sueltas.filter((e) => e.bi === i).concat(E.extras.filter((e) => e.bi === i)) }));
    const sinSitio = sueltas.filter((e) => e.bi < 0 || e.bi >= A.b.length);
    if (sinSitio.length) barrios.push({ nombre: PM.t('Otros rincones'), d: '', L: [], X: sinSitio });
    const llenos = barrios.filter((x) => x.L.length || x.X.length), porD = new Map();
    for (const x of llenos) { if (!porD.has(x.d)) porD.set(x.d, []); porD.get(x.d).push(x); }
    const cuenta = (x, y) => y.L.length - x.L.length || (x.nombre < y.nombre ? -1 : 1), junta = (l, f) => [].concat(...l.map(f));
    // (sin distritos, cada barrio es un distrito; un distrito de un solo barrio no necesita subtítulo)
    const D = porD.size > 1
      ? [...porD].map(([d, l]) => ({ nombre: d || PM.t('Otros rincones'), L: junta(l, (x) => x.L), barrios: l.length > 1 ? l.slice().sort(cuenta) : [{ nombre: null, L: l[0].L, X: l[0].X }] }))
      : llenos.map((x) => ({ nombre: x.nombre || (llenos.length === 1 ? city : PM.t('Otros rincones')), L: x.L, barrios: [{ nombre: null, L: x.L, X: x.X }] }));
    D.sort(cuenta).forEach((k, i) => { k.tinta = TINTAS[i % TINTAS.length]; });
    return D;
  }

  // ---------------- Vistas: lista de ciudades → álbum de una ciudad ----------------
  let modoAntes = 'todo';   // (el filtro que usaste la última vez: al abrir otra ciudad se queda)
  function montar(box, opts) {
    estilos();
    // los datos de cada carta (foto, rareza…) se piden una vez y solo cuando el cromo se va a ver
    const cache = new Map();
    const datos = (id) => { if (!cache.has(id)) cache.set(id, Promise.resolve().then(() => opts.datos(id)).catch(() => null)); return cache.get(id); };
    let obs = null;

    async function inicio() {
      if (obs) { obs.disconnect(); obs = null; }
      const lista = ciudades(), s = S();
      box.dataset.vista = 'inicio';
      if (!lista.length) { box.innerHTML = `<p class="ab-vacio">${PM.t('Aún no tienes álbumes. Pisa una ciudad y aparecerá aquí.')}</p>`; return; }
      const mias = {}; for (const r of Object.values(s.landmarks || {})) if (r.city) mias[r.city] = (mias[r.city] || 0) + 1;
      lista.sort((a, b) => (mias[b] || 0) - (mias[a] || 0) || a.localeCompare(b));
      const gr = PM.tcg.byCountry(lista.map((city) => ({ city, ids: [] })), s.countries);
      box.innerHTML = gr.map((g, i) => (i === 0 || gr[i - 1].country !== g.country ? `<div class="ab-pais" role="heading" aria-level="3">${g.flag || ''} ${esc(g.country)}</div>` : '') +
        `<button class="ab-fila" data-c="${esc(g.city)}"><span class="ab-mini"></span><span class="ab-fn" translate="no">${esc(g.city)}</span><span class="ab-fc">${PM.fmtNum(mias[g.city] || 0)}</span><i class="ab-bar"><em style="width:0"></em></i><span class="ab-fs"></span></button>`).join('');
      box.querySelectorAll('.ab-fila').forEach(async (el) => {
        const city = el.dataset.c;
        el.addEventListener('click', () => ciudad(city));
        const A = await W().albumDe(city);
        if (!el.isConnected || !A) return;
        const E = enlazar(A, S().landmarks, city), [mg, mn] = cuantos(E.principal.filter((e) => e.must));
        el.querySelector('.ab-mini').setAttribute('style', fondo(A.portada));
        el.querySelector('.ab-fc').innerHTML = `${PM.fmtNum(E.got)}<small>/${PM.fmtNum(E.total)}</small>`;
        el.querySelector('.ab-bar em').style.width = (E.total ? Math.min(100, E.got / E.total * 100) : 0) + '%';
        el.querySelector('.ab-fs').textContent = `${pctDe(E.got, E.total)} %` + (mn ? ` · ★ ${mg}/${mn}` : '') + (E.got >= E.total && E.total ? ' · 🏅' : '');
      });
      const pos = {}; for (const r of Object.values(s.landmarks)) if (r.city && r.pos && !pos[r.city]) pos[r.city] = r.pos;
      PM.ensureCountries(s, pos).then((ch) => { if (ch) { if (!fuente && PM.state) PM.state.save();   // (en «Mi progreso» la partida es la de la nube: no se guarda encima de la de este PC)
        if (box.isConnected && box.dataset.vista === 'inicio') inicio(); } });
    }

    async function ciudad(city) {
      box.dataset.vista = 'ciudad';
      box.innerHTML = `<p class="ab-vacio">${PM.t('Abriendo el álbum…')}</p>`;
      const A = await W().albumDe(city);
      if (!A) { box.innerHTML = `<p class="ab-vacio">${PM.t('No se pudo abrir el álbum. Prueba con conexión.')}</p>`; return; }
      const E = enlazar(A, S().landmarks, city), D = estructura(city, A, E);
      const st = { modo: modoAntes, rar: null, q: '' };
      const posFn = typeof opts.pos === 'function' ? opts.pos : null;
      if (st.modo === 'cerca' && !(posFn && posFn())) st.modo = 'todo';
      const [mg, mn] = cuantos(E.principal.filter((e) => e.must));
      const tengo = E.huecos.filter((e) => e.id).length + E.otras.length, faltan = E.principal.filter((e) => !e.id).length;
      const rars = ['legendario', 'epico', 'raro', 'comun'].map((r) => { const [g, n] = cuantos(E.principal.filter((e) => e.rarity === r)); return { r, g, n }; }).filter((x) => x.n);
      const pct = pctDe(E.got, E.total), ancho = E.total ? Math.min(100, E.got / E.total * 100) : 0;
      const chip = (m, txt) => `<button class="ab-chip ${st.modo === m ? 'on' : ''}" data-m="${m}" aria-pressed="${st.modo === m}">${txt}</button>`;
      box.innerHTML = `
        <div class="ab-barra"><button class="ab-atras" aria-label="${esc(PM.t('Volver a los álbumes'))}">‹</button><b translate="no">${esc(city)}</b><span>${PM.fmtNum(E.got)}<small>/${PM.fmtNum(E.total)}</small></span></div>
        <div class="ab-cab" style="${fondo(A.portada)}"><div class="ab-velo"></div>
          <div class="ab-tit"><small>${PM.t('Álbum de')}</small><b translate="no" class="${city.length > 14 ? 'largo' : ''}">${esc(city)}</b></div></div>
        <div class="ab-cifras"><b>${pct}<small> %</small></b><div><i class="ab-bar"><em style="width:${ancho}%"></em></i>
          <span>${PM.t('{a} de {b} lugares', { a: PM.fmtNum(E.got), b: PM.fmtNum(E.total) })}${mn ? ` · ★ ${PM.t('{a} de {b} imprescindibles', { a: mg, b: mn })}` : ''}</span></div></div>
        ${A.parcial ? `<p class="ab-nota">${PM.t('Este álbum crece al explorar: aparecen más lugares según recorres la ciudad.')}</p>` : ''}
        <input class="ab-buscar" type="search" enterkeyhint="search" placeholder="${esc(PM.t('Buscar un lugar del álbum'))}" aria-label="${esc(PM.t('Buscar un lugar del álbum'))}">
        <div class="ab-chips" role="group" aria-label="${esc(PM.t('Qué ver'))}">
          ${chip('todo', PM.t('Todo'))}${faltan ? chip('faltan', `${PM.t('Me faltan')} <small>${PM.fmtNum(faltan)}</small>`) : ''}${chip('tengo', `${PM.t('Tengo')} <small>${PM.fmtNum(tengo)}</small>`)}
          ${mn ? chip('must', `★ ${PM.t('Imprescindibles')} <small>${mg}/${mn}</small>`) : ''}${posFn && faltan ? chip('cerca', `📍 ${PM.t('Cerca de ti')}`) : ''}</div>
        ${rars.length > 1 ? `<div class="ab-chips ab-rars" role="group" aria-label="${esc(PM.t('Rareza'))}">${rars.map((x) => `<button class="ab-chip ab-rar" data-r="${x.r}" aria-pressed="false" style="--rz:${PM.lugares.RARITY[x.r].color}"><i></i>${PM.t(PM.lugares.RARITY[x.r].label)} <small>${PM.fmtNum(x.g)}/${PM.fmtNum(x.n)}</small></button>`).join('')}</div>` : ''}
        ${D.length > 1 ? `<div class="ab-saltos" aria-label="${esc(PM.t('Distritos'))}">${D.map((d, i) => { const [g, n] = cuantos(d.L); return `<button class="ab-salto" data-d="${i}" style="--c:${d.tinta}" translate="no"><i></i>${esc(d.nombre)}${n ? ` <small>${g}/${n}</small>` : ''}</button>`; }).join('')}</div>` : ''}
        <div class="ab-lista"></div>`;
      box.querySelector('.ab-atras').addEventListener('click', () => { inicio(); arriba(); });
      box.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => {
        st.modo = modoAntes = b.dataset.m;
        box.querySelectorAll('[data-m]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
        lista();
      }));
      box.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => {
        st.rar = st.rar === b.dataset.r ? null : b.dataset.r;
        box.querySelectorAll('[data-r]').forEach((x) => { const on = x.dataset.r === st.rar; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
        lista();
      }));
      box.querySelectorAll('.ab-salto').forEach((b) => b.addEventListener('click', () => {
        const sec = box.querySelector(`.ab-dis[data-d="${b.dataset.d}"]`);
        if (sec) sec.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      }));
      let tq = null;
      box.querySelector('.ab-buscar').addEventListener('input', (ev) => { clearTimeout(tq); tq = setTimeout(() => { st.q = norm(ev.target.value).trim(); lista(); }, 160); });

      // los datos de un lugar, sea hueco de la lista o carta tuya de más
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
        return !!e.id || (!e.extra && !e.suelta);   // (todo: lo tuyo y lo que falta de la lista; los extras que faltan, plegados)
      };
      const todos = [];   // (cada cromo de la página, por su índice: para saber qué abrir al tocarlo)
      const cromo = (e) => {
        const i = info(e), R = PM.lugares.RARITY[i.rarity] || {}, k = todos.push(e) - 1;
        if (e.id) return `<button class="ab-c tengo ${e.suelta || e.extra ? 'demas' : ''}" data-k="${k}" data-lm="${esc(e.id)}" style="--rz:${R.color || '#9aa4b2'}" title="${esc(PM.t(R.label || ''))}"><span class="ab-ph">${esc(i.emoji)}</span><b translate="no">${esc(i.name)}</b></button>`;
        return `<button class="ab-c falta ${i.must ? 'must' : ''}" data-k="${k}" style="--rz:${R.color || '#9aa4b2'}" title="${esc(PM.t(R.label || ''))}${i.kind ? ' · ' + esc(PM.t(i.kind)) : ''}"><span class="ab-ph">${esc(i.emoji)}</span><b translate="no">${esc(i.name)}</b>${e.n ? `<small>${i.must ? '★ ' : ''}Nº ${e.n}</small>` : ''}</button>`;
      };

      function lista() {
        const out = box.querySelector('.ab-lista');
        todos.length = 0;
        if (obs) { obs.disconnect(); obs = null; }
        box.classList.toggle('ab-en-cerca', st.modo === 'cerca');   // (en «Cerca de ti» los saltos a distritos no sirven)
        if (st.modo === 'cerca') { out.innerHTML = cerca(); enchufar(out); return; }
        let html = '', hay = 0;
        D.forEach((d, i) => {
          let cuerpo = '';
          for (const b of d.barrios) {
            const X = b.X || [], ver = b.L.concat(X).filter(pasa).sort((x, y) => (y.id ? 1 : 0) - (x.id ? 1 : 0) || (x.n || 1e9) - (y.n || 1e9));
            // (los extras que faltan no cuentan: plegados al final del barrio, en «Todo» y «Me faltan»)
            const mas = st.modo === 'todo' || st.modo === 'faltan' ? X.filter((e) => !e.id && e.extra && (!st.rar || info(e).rarity === st.rar) && (!st.q || norm(info(e).name).includes(st.q))) : [];
            if (!ver.length && !mas.length) continue;
            hay += ver.length + mas.length;
            const [g, n] = cuantos(b.L);
            cuerpo += (b.nombre ? `<div class="ab-bh" role="heading" aria-level="4" translate="no"><span>${esc(b.nombre)}</span>${n ? `<small>${g}/${n}</small>` : ''}</div>` : '') +
              (ver.length ? `<div class="ab-grid">${ver.map(cromo).join('')}</div>` : '') +
              (mas.length ? `<details class="ab-mas"><summary>＋ ${mas.length === 1 ? PM.t('1 lugar más') : PM.t('{n} lugares más', { n: PM.fmtNum(mas.length) })} <small>${PM.t('no cuentan para el álbum')}</small></summary><div class="ab-grid">${mas.map(cromo).join('')}</div></details>` : '');
          }
          const [g, n] = cuantos(d.L);
          if (cuerpo) html += `<section class="ab-dis" data-d="${i}" style="--c:${d.tinta}"><div class="ab-dh" role="heading" aria-level="3" translate="no"><i></i><span>${esc(d.nombre)}</span>${n ? `<small>${g}/${n}</small><i class="ab-bar"><em style="width:${n ? g / n * 100 : 0}%"></em></i>` : ''}</div>${cuerpo}</section>`;
          const salto = box.querySelector(`.ab-salto[data-d="${i}"]`); if (salto) salto.disabled = !cuerpo;
        });
        out.innerHTML = hay ? html : `<p class="ab-vacio">${st.q ? PM.t('Ningún lugar del álbum se llama así.') : st.modo === 'faltan' ? PM.t('¡No te falta ninguno! 🏅') : st.modo === 'tengo' ? PM.t('Aún no tienes cartas de aquí: pasea cerca de sus lugares.') : PM.t('Nada con este filtro.')}</p>`;
        enchufar(out);
      }
      // 📍 Cerca de ti: lo que te falta, del más cercano al más lejano (con su barrio y su distancia)
      function cerca() {
        const p = posFn && posFn();
        if (!p) return `<p class="ab-vacio">${PM.t('Para ver lo que tienes cerca, activa el GPS.')}</p>`;
        const dist = (q) => (PM.geo && PM.geo.dist ? PM.geo.dist(p, q) : Math.sqrt(((p[0] - q[0]) * 111000) ** 2 + ((p[1] - q[1]) * 111000 * Math.cos(p[0] * Math.PI / 180)) ** 2));
        // (solo lo que cuenta para completar el álbum: los extras llenaban la lista de «no cuenta»)
        const L = E.principal.filter((e) => !e.id && e.pos && (!st.rar || e.rarity === st.rar) && (!st.q || norm(e.name).includes(st.q)))
          .map((e) => [e, dist(e.pos)]).sort((x, y) => x[1] - y[1]).slice(0, 40);
        if (!L.length) return `<p class="ab-vacio">${PM.t('Nada con este filtro.')}</p>`;
        return `<div class="ab-cerca">${L.map(([e, m]) => {
          const R = PM.lugares.RARITY[e.rarity] || {}, k = todos.push(e) - 1, b = A.b && e.bi != null ? A.b[e.bi] : '';
          return `<button class="ab-cf falta" data-k="${k}" style="--rz:${R.color || '#9aa4b2'}"><span class="ab-ph">${esc(e.emoji || '📍')}</span><span class="ab-cft"><b translate="no">${e.must ? '★ ' : ''}${esc(e.name)}</b><small>${[b, PM.t(R.label || '')].filter(Boolean).map(esc).join(' · ')}</small></span><em>${PM.fmtDist ? PM.fmtDist(m) : Math.round(m) + ' m'}</em></button>`;
        }).join('')}</div>`;
      }
      // tocar: lo tuyo abre la carta; lo que falta, el mapa. Y las fotos de tus cartas, cuando se van a ver
      function enchufar(out) {
        out.querySelectorAll('[data-k]').forEach((el) => el.addEventListener('click', () => {
          const e = todos[+el.dataset.k]; if (!e) return;
          if (e.id) opts.abrir(e.id); else if (opts.irA) opts.irA({ pos: e.pos, name: e.name });
        }));
        const llenar = (el) => { el.dataset.h = '1'; foto(el); };
        const mios = out.querySelectorAll('.ab-c.tengo');
        if ('IntersectionObserver' in window) {
          obs = new IntersectionObserver((es) => es.forEach((x) => { if (x.isIntersecting) { obs.unobserve(x.target); llenar(x.target); } }), { rootMargin: '300px 0px' });
          mios.forEach((el) => obs.observe(el));
        } else mios.forEach(llenar);
      }
      lista();
      arriba();
    }

    async function foto(el) {
      const id = el.dataset.lm, d = await datos(id);
      if (!el.isConnected || !d) return;
      const ph = el.querySelector('.ab-ph');
      // (la foto sustituye al emoji solo cuando ha cargado: si falla —sin red, enlace roto—, se queda el emoji y no un hueco gris)
      if (d.img) {
        const url = String(d.img), im = new Image();
        im.onload = () => { if (!el.isConnected) return; ph.style.backgroundImage = `url('${url.replace(/'/g, '%27')}')`; ph.textContent = ''; ph.classList.add('con'); };
        im.src = url;
      }
      if (d.shiny) el.classList.add('brilla');
      if (opts.pegada) opts.pegada(el, id);   // («Mi progreso»: tu foto de la carta, de la nube)
    }
    // Arriba del álbum al cambiar de vista: se busca lo que de verdad se desplaza (en el móvil, el cuerpo de la ventana del
    // álbum; en el PC, el panel o la página)
    const arriba = () => {
      const margen = parseFloat(getComputedStyle(box).scrollMarginTop) || 0;
      for (let el = box.parentElement; el; el = el.parentElement) {
        const o = getComputedStyle(el).overflowY;
        if ((o === 'auto' || o === 'scroll') && el.scrollHeight > el.clientHeight) {
          const d = box.getBoundingClientRect().top - el.getBoundingClientRect().top - margen;
          if (d < 0) el.scrollTop += d;
          return;
        }
      }
      const y = box.getBoundingClientRect().top + window.scrollY - margen;
      if (window.scrollY > y) window.scrollTo(0, Math.max(0, y));
    };
    // cuando llega información nueva de las cartas (fotos, textos), se rehacen SOLO las que ya se ven, sin moverte de donde estás
    function refrescar() {
      cache.clear();
      box.querySelectorAll('.ab-c.tengo[data-h]').forEach((el) => foto(el));
    }
    inicio();
    return { ciudad, refrescar, inicio };
  }

  // ---------------- La primera vez que pisas una ciudad ----------------
  async function nuevo(city, abrir) {
    estilos();
    const A = await W().albumDe(city), E = enlazar(A, S().landmarks, city);
    if (document.getElementById('ab-nuevo')) return;
    const ov = document.createElement('div');
    ov.id = 'ab-nuevo';
    ov.innerHTML = `<div class="ab-nuevo-in"><p class="ab-ya">${PM.t('¡Nuevo álbum!')}</p><div class="ab-cover grande">${portada(city, A, E)}</div>
      <div class="cv-actions"><button class="btn" id="ab-luego">Luego</button><button class="btn on" id="ab-abrir">Abrir álbum</button></div></div>`;
    document.body.appendChild(ov);
    PM.sound.capture(); PM.vibrate([60, 40, 120]);
    ov.querySelector('#ab-luego').addEventListener('click', () => ov.remove());
    ov.querySelector('#ab-abrir').addEventListener('click', () => { ov.remove(); abrir(city); });
  }

  // ---------------- Estilos ----------------
  // Sobrio y legible (como el resto de la app): los colores del tema (--text, --muted, --card, --sheet, --accent, también en
  // oscuro), el color de tu pintura solo en el nombre de la ciudad —el brochazo— y la rareza en una línea fina de cada cromo
  let hechos = false;
  function estilos() {
    if (hechos) return; hechos = true;
    const st = document.createElement('style');
    st.textContent = `
    #sheet:has(#album-box) { height: 92%; max-height: 92%; }   /* (un álbum se mira a pantalla casi completa) */
    #album-box:has(#city-stacks[data-vista="ciudad"]) > .seg.tabs, #album-box:has(#city-stacks[data-vista="ciudad"]) > .ab-sueltas { display: none; }
    #city-stacks { --ab-barh: 52px; }
    .ab-vacio { margin: 18px 4px; color: var(--muted); font-size: 14px; line-height: 1.45; }
    .ab-bar { display: block; height: 6px; border-radius: 9px; background: var(--track, rgba(127,127,127,.25)); overflow: hidden; }
    .ab-bar em { display: block; height: 100%; border-radius: 9px; background: var(--accent, #1f5fbf); }

    /* lista de ciudades: una fila por ciudad */
    .ab-pais { margin: 18px 2px 8px; font-size: 13px; font-weight: 800; color: var(--muted); }
    .ab-pais:first-child { margin-top: 4px; }
    .ab-fila { display: grid; grid-template-columns: 58px minmax(0, 1fr) auto; grid-template-rows: auto auto auto; column-gap: 12px; row-gap: 4px; align-items: center;
      width: 100%; margin: 0 0 8px; padding: 8px 12px 8px 8px; border: 1px solid var(--line); border-radius: 14px; background: var(--card); color: var(--text); font: inherit; text-align: left; cursor: pointer; }
    .ab-mini { grid-row: 1 / 4; width: 58px; height: 58px; border-radius: 10px; background: var(--btn, #e6eaf2) center / cover no-repeat; }
    .ab-fn { font-size: 16px; font-weight: 800; overflow-wrap: anywhere; }
    .ab-fc { font-size: 14px; font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; } .ab-fc small { font-weight: 700; color: var(--muted); }
    .ab-fila .ab-bar { grid-column: 2 / 4; }
    .ab-fs { grid-column: 2 / 4; font-size: 12.5px; font-weight: 600; color: var(--muted); font-variant-numeric: tabular-nums; }
    @media (hover: hover) { .ab-fila:hover { border-color: var(--accent); } }

    /* álbum de una ciudad: barra fija con volver, nombre y cuenta */
    /* (la barra y la cabecera de cada distrito ocupan todo el ancho de la ventana —el margen de la hoja es de 16 px—: si no, por los
       lados asomaban los filtros que se deslizan de lado) */
    .ab-barra { position: sticky; top: var(--ab-tope, 0px); z-index: 5; display: flex; align-items: center; gap: 10px; height: var(--ab-barh); margin: 0 var(--ab-lado, -16px); padding: 0 var(--ab-lado-p, 16px); background: var(--ab-fondo, var(--sheet)); border-bottom: 1px solid var(--line); }
    .ab-atras { flex: none; width: 42px; height: 40px; border: 0; border-radius: 12px; background: var(--btn, #e6eaf2); color: var(--text); font: inherit; font-size: 24px; font-weight: 800; line-height: 1; cursor: pointer; }
    .ab-barra b { flex: 1; min-width: 0; font-size: 18px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ab-barra span { font-size: 14px; font-weight: 800; font-variant-numeric: tabular-nums; } .ab-barra span small { color: var(--muted); font-weight: 700; }
    /* cabecera: la foto de la ciudad, corta, con su nombre en un brochazo de tu color (lo que hace reconocible el álbum) */
    .ab-cab { position: relative; height: 128px; margin: 12px 0 0; border-radius: 16px; overflow: hidden; background: linear-gradient(135deg, var(--paint, #2563eb), #111827) center / cover no-repeat; }
    .ab-cab[style*="background-image"] { background-size: cover; background-position: center; }
    .ab-velo { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(10,14,24,0) 30%, rgba(10,14,24,.7) 100%); }
    .ab-tit { position: absolute; left: 0; right: 10px; bottom: 12px; color: #fff; }
    .ab-tit small { display: block; margin: 0 0 2px 14px; font-size: 12.5px; font-weight: 700; text-shadow: 0 1px 3px rgba(0,0,0,.7); }
    .ab-tit b { display: inline-block; max-width: 100%; box-sizing: border-box; padding: 4px 22px 6px 14px; font-size: 30px; line-height: 1.02; font-weight: 900; font-style: italic; letter-spacing: -1px; overflow-wrap: anywhere;
      background: var(--paint, #2563eb); clip-path: polygon(0 5%, 22% 0, 48% 6%, 74% 1%, 97% 5%, 100% 30%, 96% 52%, 100% 76%, 95% 96%, 70% 100%, 44% 94%, 20% 100%, 0 95%); }
    .ab-tit b.largo { font-size: 23px; letter-spacing: -.5px; }
    .ab-cifras { display: flex; align-items: center; gap: 14px; margin: 12px 2px 4px; }
    .ab-cifras > b { font-size: 34px; font-weight: 900; letter-spacing: -1.5px; line-height: 1; font-variant-numeric: tabular-nums; white-space: nowrap; } .ab-cifras > b small { font-size: 16px; letter-spacing: 0; }
    .ab-cifras > div { flex: 1; min-width: 0; } .ab-cifras .ab-bar { height: 8px; margin-bottom: 6px; }
    .ab-cifras span { display: block; font-size: 12.5px; font-weight: 600; color: var(--muted); line-height: 1.35; }
    .ab-nota { margin: 6px 2px 0; font-size: 12.5px; color: var(--muted); line-height: 1.4; }
    .ab-buscar { display: block; width: 100%; height: 44px; margin: 12px 0 0; padding: 0 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--card); color: var(--text); font: inherit; font-size: 15px; }
    .ab-buscar:focus { outline: 2px solid var(--accent); outline-offset: 0; border-color: transparent; }
    /* filtros: una fila que se desliza de lado (nunca varias filas amontonadas) */
    .ab-chips, .ab-saltos { display: flex; gap: 8px; margin: 10px var(--ab-lado, -16px) 0; padding: 0 var(--ab-lado-p, 16px) 2px; overflow-x: auto; scrollbar-width: none; }
    .ab-chips::-webkit-scrollbar, .ab-saltos::-webkit-scrollbar { display: none; }
    .ab-chip, .ab-salto { flex: none; display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 14px; border: 1px solid var(--line); border-radius: 99px; background: var(--card); color: var(--text); font: inherit; font-size: 13.5px; font-weight: 700; white-space: nowrap; cursor: pointer; }
    .ab-chip small, .ab-salto small { font-weight: 700; color: var(--muted); font-variant-numeric: tabular-nums; }
    .ab-chip.on { background: var(--accent); border-color: var(--accent); color: #fff; } .ab-chip.on small { color: rgba(255,255,255,.85); }
    .ab-rars .ab-chip { height: 32px; font-size: 12.5px; } .ab-rar i { width: 9px; height: 9px; border-radius: 50%; background: var(--rz); }
    .ab-rar.on { background: var(--rz); border-color: var(--rz); }
    .ab-salto { height: 32px; padding: 0 12px; font-size: 12.5px; } .ab-salto i { width: 4px; height: 14px; border-radius: 2px; background: var(--c); }
    .ab-salto:disabled { opacity: .4; cursor: default; }
    .ab-en-cerca .ab-saltos { display: none; }
    /* distritos seguidos; su cabecera se queda arriba (bajo la barra) mientras estás en él */
    .ab-lista { margin-top: 6px; }
    .ab-dis { scroll-margin-top: calc(var(--ab-tope, 0px) + var(--ab-barh)); }
    .ab-dh { position: sticky; top: calc(var(--ab-tope, 0px) + var(--ab-barh)); z-index: 3; display: grid; grid-template-columns: 4px minmax(0, 1fr) auto; grid-template-rows: auto auto; column-gap: 10px; row-gap: 6px; align-items: center;
      margin: 14px var(--ab-lado, -16px) 6px; padding: 10px var(--ab-lado-p, 16px) 8px; background: var(--ab-fondo, var(--sheet)); font-size: 16px; font-weight: 800; }
    .ab-dh > i:first-child { grid-row: 1 / 3; align-self: stretch; border-radius: 2px; background: var(--c); }
    .ab-dh span { overflow-wrap: anywhere; } .ab-dh small { font-size: 13px; font-weight: 800; color: var(--muted); font-variant-numeric: tabular-nums; }
    .ab-dh .ab-bar { grid-column: 2 / 4; height: 4px; } .ab-dh .ab-bar em { background: var(--c); }
    .ab-bh { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin: 14px 2px 8px; font-size: 13.5px; font-weight: 800; color: var(--text); }
    .ab-bh small { font-weight: 700; color: var(--muted); font-variant-numeric: tabular-nums; }
    /* cromos: todos del mismo tamaño, tres por fila en el móvil. Los tuyos, con su foto; los que faltan, atenuados y con su número */
    .ab-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(98px, 1fr)); gap: 10px; }
    .ab-c { position: relative; display: flex; flex-direction: column; min-width: 0; padding: 0; border: 0; border-radius: 12px; overflow: hidden; background: var(--card); color: var(--text); font: inherit; text-align: left; cursor: pointer; }
    .ab-c .ab-ph { display: grid; place-items: center; aspect-ratio: 1; font-size: 30px; background: var(--btn, #e6eaf2) center / cover no-repeat; }
    .ab-c b { margin: 6px 8px 0; font-size: 12px; line-height: 1.25; font-weight: 700; overflow-wrap: anywhere; hyphens: auto; }   /* (el nombre, entero: nunca se corta) */
    .ab-c small { margin: 2px 8px 0; font-size: 10.5px; font-weight: 700; color: var(--muted); font-variant-numeric: tabular-nums; }
    .ab-c.tengo { box-shadow: inset 0 3px 0 var(--rz), 0 1px 3px rgba(15,23,42,.18); padding-bottom: 8px; }
    .ab-c.tengo .ab-ph.con { font-size: 0; }
    .ab-c.brilla .ab-ph { box-shadow: inset 0 0 0 2px #ffd54a; }
    .ab-c.demas::after { content: '✦'; position: absolute; top: 6px; right: 6px; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: rgba(15,23,42,.6); color: #fff; font-size: 11px; }
    .ab-c.falta { padding-bottom: 8px; background: transparent; border: 1.5px dashed var(--line); box-shadow: inset 0 3px 0 var(--rz); }
    .ab-c.falta .ab-ph { margin: 6px 6px 0; border-radius: 9px; background: var(--card); font-size: 26px; filter: grayscale(1); opacity: .55; }
    .ab-c.falta b { color: var(--muted); }
    .ab-c.must { border-color: #d4a106; }
    @media (hover: hover) { .ab-c:hover { outline: 2px solid var(--accent); outline-offset: 1px; } }
    .ab-c:focus-visible, .ab-chip:focus-visible, .ab-salto:focus-visible, .ab-atras:focus-visible, .ab-fila:focus-visible, .ab-cf:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    /* los extras que faltan, plegados al final del barrio (no cuentan) */
    .ab-mas { margin-top: 10px; } .ab-mas summary { list-style: none; cursor: pointer; padding: 10px 12px; border-radius: 12px; background: var(--card); color: var(--text); font-size: 13px; font-weight: 800; }
    .ab-mas summary::-webkit-details-marker { display: none; } .ab-mas summary small { font-weight: 600; color: var(--muted); margin-left: 4px; }
    .ab-mas[open] summary { margin-bottom: 10px; }
    /* 📍 cerca de ti: una lista, del más cercano al más lejano */
    .ab-cerca { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
    .ab-cf { display: grid; grid-template-columns: 46px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 8px 12px 8px 8px; border: 1px solid var(--line); border-left: 4px solid var(--rz); border-radius: 12px; background: var(--card); color: var(--text); font: inherit; text-align: left; cursor: pointer; }
    .ab-cf .ab-ph { display: grid; place-items: center; width: 46px; height: 46px; border-radius: 10px; background: var(--btn, #e6eaf2); font-size: 22px; filter: grayscale(.6); }
    .ab-cft b { display: block; font-size: 14px; font-weight: 800; overflow-wrap: anywhere; } .ab-cft small { display: block; margin-top: 2px; font-size: 12px; color: var(--muted); }
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
