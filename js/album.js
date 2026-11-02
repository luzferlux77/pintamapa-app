// PintaMapa — álbumes de ciudad: cada ciudad es un archivador con portada; dentro, una carpeta de color por distrito, con sus
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
    // (los extras de las ciudades enormes no cuentan para completar el álbum; lo tuyo fuera de la lista, sí)
    const principal = huecos.filter((e) => !e.extra), extras = huecos.filter((e) => e.extra);
    return { huecos, principal, extras, otras: [...libres.keys()], got: principal.filter((e) => e.id).length + libres.size, total: principal.length + libres.size };
  }
  function ciudades() {
    const s = S(), set = new Set(Object.keys(s.albumes || {}));
    for (const r of Object.values(s.landmarks || {})) if (r.city && !NO_ES_CIUDAD.test(r.city)) set.add(r.city);
    return [...set];
  }

  // Colores de las carpetas: de papelería, oscuros para que el texto blanco se lea (contraste de 4,5 o más) y ordenados para que
  // dos carpetas seguidas nunca se parezcan
  const TINTAS = ['#b91c1c', '#1d4ed8', '#a16207', '#0f766e', '#be185d', '#15803d', '#6d28d9', '#c2410c', '#0e7490', '#a21caf', '#4d7c0f', '#4338ca'];
  const ORO = { c: '#f5b301', on: '#3b2a00', tx: '#7a5600' }, PIZARRA = { c: '#475569', on: '#fff' };
  const claro = (hex, k) => '#' + [1, 3, 5].map((i) => { const v = parseInt(hex.slice(i, i + 2), 16); return Math.round(255 - (255 - v) * k).toString(16).padStart(2, '0'); }).join('');
  const tinta = (k) => { const { c, on, tx } = k.tinta; return `--c:${c};--on:${on};--tx:${tx || c};--t:${claro(c, 0.1)};--b:${claro(c, 0.38)}`; };

  // ---------------- Portada ----------------
  function portada(city, A, E, grande) {
    const total = A ? E.total : 0, pct = total ? Math.min(100, Math.round(E.got / total * 100)) : 0, ex = A ? E.extras : [];
    return `<div class="ab-foto" style="${fondo(A && A.portada)}"></div><div class="ab-velo"></div>
      <div class="ab-marca" translate="no"><span>Pinta</span><span>Mapa</span></div>
      <div class="ab-tit"><small>${PM.t('Álbum de')}</small><b translate="no" class="${city.length > 14 ? 'largo' : ''}">${esc(city)}</b></div>
      ${A ? `<div class="ab-pie"><span class="ab-n">${total && pct >= 100 ? '🏅 ' : ''}${E.got}<small> / ${total}</small></span><i class="ab-bar"><em style="width:${pct}%"></em></i>${ex.length ? `<span class="ab-ex">✨ ${ex.filter((e) => e.id).length}/${ex.length}</span>` : ''}</div>` : ''}${grande ? '' : '<span class="ab-go">›</span>'}`;
  }

  // ---------------- Vistas: álbumes → archivador de una ciudad → carpeta abierta ----------------
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

    // El álbum es un archivador: cada distrito es una carpeta de su color, con su pestaña. El orden y el color son fijos (por
    // tamaño, nunca por progreso): como en una carpeta de verdad, se recuerda dónde está cada cosa y qué color tiene
    function carpetasDe(city, A, E) {
      const cuenta = (x, y) => y.L.length - x.L.length || (x.nombre < y.nombre ? -1 : 1), C = [];
      const cuadernos = A.b.map((n, i) => ({ nombre: n, d: (A.d || [])[i] || '', L: E.principal.filter((e) => e.bi === i) })).filter((x) => x.L.length);
      const sinNombre = cuadernos.length === 1 ? city : PM.t('Otros rincones'), porD = new Map();
      for (const x of cuadernos) { if (!porD.has(x.d)) porD.set(x.d, []); porD.get(x.d).push(x); }
      // (sin distritos, los barrios son las carpetas; un distrito de un solo barrio no necesita separadores)
      const carpetas = porD.size > 1
        ? [...porD].map(([d, l]) => ({ nombre: d || PM.t('Otros rincones'), L: [].concat(...l.map((x) => x.L)), subs: l.length > 1 ? l.map((x) => ({ nombre: x.nombre || d, L: x.L })).sort(cuenta) : [] }))
        : cuadernos.map((x) => ({ nombre: x.nombre || sinNombre, L: x.L, subs: [] }));
      const must = E.principal.filter((e) => e.must);
      if (must.length) C.push({ nombre: PM.t('Imprescindibles'), ic: '⭐', L: must, subs: [], tinta: ORO });
      carpetas.sort(cuenta).forEach((k, i) => { k.tinta = { c: TINTAS[i % TINTAS.length], on: '#fff' }; C.push(k); });
      if (E.otras.length) C.push({ nombre: PM.t('Otros lugares'), ic: '📍', L: E.otras.map((id) => ({ id })), subs: [], tinta: PIZARRA });
      if (E.extras.length) {
        const por = new Map();
        for (const e of E.extras) { const n = (A.d || [])[e.bi] || A.b[e.bi] || PM.t('Otros rincones'); if (!por.has(n)) por.set(n, []); por.get(n).push(e); }
        C.push({ nombre: PM.t('Extras'), ic: '✨', L: E.extras, subs: por.size > 1 ? [...por].map(([nombre, L]) => ({ nombre, L })).sort(cuenta) : [], tinta: PIZARRA });
      }
      return C;
    }
    const cuantos = (L) => [L.filter((e) => e.id).length, L.length];

    async function ciudad(city) {
      box.dataset.vista = 'ciudad';
      box.innerHTML = '<p class="muted">Abriendo el álbum…</p>';
      const A = await W().albumDe(city), E = enlazar(A, S().landmarks, city), C = carpetasDe(city, A, E);
      box.innerHTML = `<div class="ab-cover ab-hero">${portada(city, A, E, true)}</div>
        ${A.parcial ? '<p class="muted">Este álbum crece al explorar: aparecen más lugares según recorres la ciudad.</p>' : ''}
        <div class="ab-carpetas">${C.map((k, i) => {
    const [g, n] = cuantos(k.L), hecho = g && g >= n;
    return `<button class="ab-fold" data-i="${i}" style="${tinta(k)};--x:${[0, 19, 38][i % 3]}%;--r:${i % 3 ? 12 : 0}px;z-index:${i + 1}"><span class="ab-tab" translate="no">${k.ic ? k.ic + ' ' : ''}${esc(k.nombre)}</span>
          <span class="ab-lomo"><i class="ab-bar"><em style="width:${n ? Math.round(g / n * 100) : 0}%"></em></i><b>${hecho ? '🏅 ' : ''}${g}/${n}</b></span></button>`;
  }).join('')}</div>
        ${E.extras.length ? `<p class="muted ab-nota">${PM.t('{n} lugares más para completistas: no cuentan para completar el álbum.', { n: PM.fmtNum(E.extras.length) })}</p>` : ''}`;
      box.prepend(volver(PM.t('Álbumes'), inicio));
      box.querySelectorAll('.ab-fold').forEach((b) => b.addEventListener('click', () => carpeta(city, C, +b.dataset.i, 0)));
      arriba();
    }

    // Una carpeta abierta: las demás siguen arriba como pestañas (se cambia de distrito sin volver atrás) y sus barrios son
    // los separadores de dentro. s: 0, todo; n, el separador n
    function carpeta(city, C, i, s) {
      const k = C[i], L = s ? k.subs[s - 1].L : k.L, [g, n] = cuantos(L);
      box.dataset.vista = 'carpeta';
      box.innerHTML = `<div class="ab-tiras">${C.map((c, j) => `<button class="ab-t ${j === i ? 'on' : ''}" data-i="${j}" style="${tinta(c)}" translate="no">${c.ic ? c.ic + ' ' : ''}${esc(c.nombre)}</button>`).join('')}</div>
        <div class="ab-hoja" style="${tinta(k)}">
          <div class="ab-pag"><b translate="no">${esc(s ? k.subs[s - 1].nombre : k.nombre)}</b><span>${g}/${n}</span></div>
          <i class="ab-bar"><em style="width:${n ? Math.round(g / n * 100) : 0}%"></em></i>
          ${k.subs.length ? `<div class="ab-subs"><button class="ab-s ${s ? '' : 'on'}" data-s="0">${PM.t('Todo')} <small>${k.L.length}</small></button>${k.subs.map((b, j) => `<button class="ab-s ${s === j + 1 ? 'on' : ''}" data-s="${j + 1}" translate="no">${esc(b.nombre)} <small>${b.L.length}</small></button>`).join('')}</div>` : ''}
          ${rejilla(L)}
        </div>`;
      box.prepend(volver(city, () => ciudad(city)));
      const tiras = box.querySelector('.ab-tiras'), activa = tiras.querySelector('.on');
      if (activa) tiras.scrollLeft = activa.offsetLeft - (tiras.clientWidth - activa.offsetWidth) / 2;
      const sep = box.querySelector('.ab-s.on');
      if (sep) sep.parentElement.scrollLeft = sep.offsetLeft - 40;
      tiras.querySelectorAll('.ab-t').forEach((b) => b.addEventListener('click', () => carpeta(city, C, +b.dataset.i, 0)));
      box.querySelectorAll('.ab-s').forEach((b) => b.addEventListener('click', () => carpeta(city, C, i, +b.dataset.s)));
      pegar(L);
      // deslizar la hoja a un lado pasa a la carpeta de al lado, como pasar separadores con el dedo
      const hoja = box.querySelector('.ab-hoja'); let x0 = null, y0 = 0;
      hoja.addEventListener('touchstart', (e) => { const t = e.touches[0]; x0 = e.target.closest('.ab-subs') ? null : t.clientX; y0 = t.clientY; }, { passive: true });
      hoja.addEventListener('touchend', (e) => {
        if (x0 == null) return;
        const t = e.changedTouches[0], dx = t.clientX - x0, j = i + (dx < 0 ? 1 : -1);
        if (Math.abs(dx) > 70 && Math.abs(t.clientY - y0) < 45 && C[j]) carpeta(city, C, j, 0);
      }, { passive: true });
      arriba();
    }

    function rejilla(L) {
      return `<div class="cromos ab-grid">${L.map((e, i) => (e.id ? `<div class="tcg-cell ab-pegado" data-i="${i}" data-lm="${esc(e.id)}"><div class="ab-slot"></div></div>`
        : `<button class="ab-slot vacio ${e.must ? 'must' : ''}" data-i="${i}"><i class="ab-r" style="background:${(PM.lugares.RARITY[e.rarity] || {}).color || '#9aa4b2'}"></i><span class="ab-em">${esc(e.emoji || '📍')}</span><b translate="no">${esc(e.name)}</b><small>${esc(PM.t(e.kind || ''))}</small></button>`)).join('')}</div>`;
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
    .ab-cover.ab-hero { aspect-ratio: 16 / 8.5; margin-bottom: 14px; cursor: default; }
    .ab-hero .ab-tit { bottom: 38px; } .ab-hero .ab-tit small { font-size: 12px; } .ab-hero .ab-tit b { font-size: 32px; padding: 4px 22px 5px 14px; } .ab-hero .ab-tit b.largo { font-size: 24px; }
    /* carpetas: se solapan como en un archivador, con la pestaña a un tercio (izquierda, centro, derecha). El color fuerte, solo en
       la pestaña: es lo que se busca con la vista; el cuerpo en tono papel, para que doce carpetas juntas no cansen */
    .ab-carpetas { padding: 2px 0 8px; }
    .ab-fold { position: relative; display: block; box-sizing: border-box; width: 100%; height: 92px; margin: -32px 0 0; padding: 0; border: 0; background: none; color: #1f2937; font: inherit; text-align: left; cursor: pointer; transition: transform .16s; filter: drop-shadow(0 -1px 1.5px rgba(15,23,42,.28)); -webkit-tap-highlight-color: transparent; }
    .ab-fold:first-child { margin-top: 0; } .ab-fold:active { transform: translateY(-6px); } .ab-fold:focus-visible { outline: 2px solid var(--tx); outline-offset: 2px; }
    .ab-tab { position: absolute; top: 0; left: var(--x); box-sizing: border-box; max-width: 62%; height: 30px; padding: 7px 14px 0; border-radius: 11px 11px 0 0; background: var(--c); color: var(--on); font-size: 13px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ab-lomo { position: absolute; top: 28px; left: 0; right: 0; bottom: 0; display: flex; align-items: flex-start; gap: 10px; padding: 11px 14px; border-radius: var(--r) 12px 0 0; background: var(--b); box-shadow: inset 0 1px 0 rgba(255,255,255,.4); }
    .ab-fold:last-child .ab-lomo { border-radius: var(--r) 12px 12px 12px; }
    .ab-lomo .ab-bar { margin-top: 6px; background: rgba(255,255,255,.65); } .ab-lomo .ab-bar em { background: var(--c); }
    .ab-lomo b { font-size: 13px; font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .ab-nota { margin: 4px 4px 0; font-size: 12.5px; }
    /* carpeta abierta: las pestañas de todas arriba, y la activa se une a su hoja */
    .ab-tiras { position: sticky; top: 0; z-index: 3; display: flex; align-items: flex-end; gap: 3px; overflow-x: auto; padding-top: 6px; background: var(--ab-fondo, var(--panel, #fff)); scrollbar-width: none; }
    .ab-tiras::-webkit-scrollbar, .ab-subs::-webkit-scrollbar { display: none; }
    .ab-t { flex: none; max-width: 68%; padding: 8px 12px 7px; border: 0; border-radius: 10px 10px 0 0; background: var(--b); color: var(--tx); font: inherit; font-size: 13px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
    .ab-t.on { padding-top: 11px; background: var(--c); color: var(--on); }
    .ab-hoja { padding: 12px 10px 16px; border-top: 4px solid var(--c); border-radius: 0 0 14px 14px; background: var(--t); }
    .ab-hoja .ab-pag { margin-bottom: 6px; } .ab-hoja .ab-pag b { color: var(--tx); } .ab-hoja > .ab-bar { background: var(--b); margin-bottom: 12px; } .ab-hoja > .ab-bar em { background: var(--c); }
    .ab-subs { display: flex; gap: 6px; overflow-x: auto; margin: 0 -10px 12px; padding: 0 10px 2px; scrollbar-width: none; }
    .ab-s { flex: none; padding: 6px 11px; border: 1.5px solid var(--tx); border-radius: 99px; background: rgba(255,255,255,.7); color: var(--tx); font: inherit; font-size: 12.5px; font-weight: 700; white-space: nowrap; cursor: pointer; }
    .ab-s.on { border-color: var(--c); background: var(--c); color: var(--on); } .ab-s small { font-size: 11px; opacity: .75; }
    .ab-hoja .ab-slot.vacio { border-color: var(--b); background: rgba(255,255,255,.75); }
    .ab-hoja .ab-slot.vacio.must { border-color: #f59e0b; }
    .ab-r { position: absolute; top: 8px; right: 8px; width: 9px; height: 9px; border-radius: 50%; }
    .ab-pag { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 10px; } .ab-pag b { font-size: 19px; } .ab-pag span { font-weight: 800; color: var(--muted); }
    .ab-slot { width: 100%; aspect-ratio: 63 / 88; box-sizing: border-box; border-radius: 10px; }
    .ab-slot.vacio { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 8px; border: 2px dashed var(--line); background: rgba(127,127,127,.07); color: inherit; font: inherit; cursor: pointer; }
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
