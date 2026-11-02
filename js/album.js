// PintaMapa — álbumes de ciudad: cada ciudad es un álbum con portada; dentro, un cuaderno por barrio, con cada cromo pegado en
// su sitio y un hueco con el nombre de lo que falta. El álbum aparece la primera vez que pisas la ciudad.
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
    return { huecos, otras: [...libres.keys()], got: huecos.filter((e) => e.id).length + libres.size };
  }
  function ciudades() {
    const s = S(), set = new Set(Object.keys(s.albumes || {}));
    for (const r of Object.values(s.landmarks || {})) if (r.city && !NO_ES_CIUDAD.test(r.city)) set.add(r.city);
    return [...set];
  }

  // ---------------- Portada ----------------
  function portada(city, A, E, grande) {
    const total = A ? A.l.length + E.otras.length : 0, pct = total ? Math.round(E.got / total * 100) : 0;
    return `<div class="ab-foto" style="${fondo(A && A.portada)}"></div><div class="ab-velo"></div>
      <div class="ab-marca" translate="no"><span>Pinta</span><span>Mapa</span></div>
      <div class="ab-tit"><small>${PM.t('Álbum de')}</small><b translate="no" class="${city.length > 14 ? 'largo' : ''}">${esc(city)}</b></div>
      ${A ? `<div class="ab-pie"><span class="ab-n">${E.got}<small> / ${total}</small></span><i class="ab-bar"><em style="width:${pct}%"></em></i></div>` : ''}${grande ? '' : '<span class="ab-go">›</span>'}`;
  }

  // ---------------- Vistas: álbumes → cuadernos de una ciudad → páginas de un cuaderno ----------------
  function montar(box, opts) {
    estilos();
    const volver = (txt, fn) => { const b = document.createElement('button'); b.className = 'ab-back'; b.textContent = '‹ ' + txt; b.addEventListener('click', fn); return b; };

    async function inicio() {
      const lista = ciudades(), s = S();
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

    async function ciudad(city) {
      box.innerHTML = '<p class="muted">Abriendo el álbum…</p>';
      const A = await W().albumDe(city), E = enlazar(A, S().landmarks, city);
      const fila = (id, ic, nombre, L, extra) => { const g = L.filter((e) => e.id).length + (extra || 0), n = L.length + (extra || 0); return `<button class="ab-cuad ${g && g >= n ? 'hecho' : ''}" data-i="${id}">
        <span class="ab-ic">${g && g >= n ? '🏅' : ic}</span><span class="ab-nom"><b translate="no">${esc(nombre)}</b><i class="ab-bar"><em style="width:${n ? Math.round(g / n * 100) : 0}%"></em></i></span><span class="ab-cnt">${g}/${n}</span></button>`; };
      const orden = (x, y) => (y[2].filter((e) => e.id).length - x[2].filter((e) => e.id).length) || y[2].length - x[2].length;
      const barrios = A.b.map((n, i) => [i, n, E.huecos.filter((e) => e.bi === i), (A.d || [])[i] || '']).filter((x) => x[2].length).sort(orden);
      // distritos con sus barrios dentro (con un solo distrito, los barrios directamente)
      const distritos = new Map(); for (const x of barrios) { if (!distritos.has(x[3])) distritos.set(x[3], []); distritos.get(x[3]).push(x); }
      const filas = [...distritos].map(([d, l], i) => [i, d, [].concat(...l.map((x) => x[2])), l]).sort(orden);
      const conDistritos = distritos.size > 1, sinNombre = barrios.length === 1 ? city : PM.t('Otros rincones');   // (un solo cuaderno es la ciudad entera)
      const must = E.huecos.filter((e) => e.must);
      box.innerHTML = `<div class="ab-cover grande">${portada(city, A, E, true)}</div>
        ${A.parcial ? '<p class="muted">Este álbum crece al explorar: aparecen más lugares según recorres la ciudad.</p>' : ''}
        <div class="ab-lista">${must.length ? fila('m', '⭐', PM.t('Imprescindibles'), must) : ''}
        ${conDistritos ? filas.map(([i, d, L]) => fila('d' + i, '🗺️', d || PM.t('Otros rincones'), L)).join('') : barrios.map(([i, n, L]) => fila(i, '🏘️', n || sinNombre, L)).join('')}
        ${E.otras.length ? fila('o', '📍', PM.t('Otros lugares'), [], E.otras.length) : ''}</div>`;
      box.prepend(volver(PM.t('Álbumes'), inicio));
      box.querySelectorAll('.ab-cuad').forEach((b) => b.addEventListener('click', () => {
        const k = b.dataset.i;
        if (k === 'o') paginas(city, PM.t('Otros lugares'), E.otras.map((id) => ({ id })));
        else if (k === 'm') paginas(city, PM.t('Imprescindibles'), must);
        else if (k[0] === 'd') distrito(city, filas.find((y) => 'd' + y[0] === k), fila);
        else { const x = barrios.find((y) => String(y[0]) === k); paginas(city, x[1] || sinNombre, x[2]); }
      }));
      box.parentElement && box.parentElement.scrollTo && box.parentElement.scrollTo(0, 0);
    }

    function distrito(city, D, fila) {
      const [, nombre, , lista] = D, titulo = nombre || PM.t('Otros rincones');
      if (lista.length === 1) { paginas(city, titulo, lista[0][2]); return; }
      box.innerHTML = `<div class="ab-pag"><b translate="no">${esc(titulo)}</b><span>${lista.length} ${PM.t('barrios')}</span></div><div class="ab-lista">${lista.map(([i, n, L]) => fila(i, '🏘️', n || titulo, L)).join('')}</div>`;
      box.prepend(volver(city, () => ciudad(city)));
      box.querySelectorAll('.ab-cuad').forEach((b) => b.addEventListener('click', () => { const x = lista.find((y) => String(y[0]) === b.dataset.i); paginas(city, x[1] || titulo, x[2], () => distrito(city, D, fila), titulo); }));
      box.parentElement && box.parentElement.scrollTo && box.parentElement.scrollTo(0, 0);
    }

    function paginas(city, nombre, L, atras, atrasTxt) {
      const g = L.filter((e) => e.id).length;
      box.innerHTML = `<div class="ab-pag"><b translate="no">${esc(nombre)}</b><span>${g}/${L.length}</span></div>
        <div class="cromos ab-grid">${L.map((e, i) => (e.id ? `<div class="tcg-cell ab-pegado" data-i="${i}" data-lm="${esc(e.id)}"><div class="ab-slot"></div></div>`
          : `<button class="ab-slot vacio ${e.must ? 'must' : ''}" data-i="${i}"><span class="ab-em">${esc(e.emoji || '📍')}</span><b translate="no">${esc(e.name)}</b><small>${esc(PM.t(e.kind || ''))}</small></button>`)).join('')}</div>`;
      box.prepend(volver(atrasTxt || city, atras || (() => ciudad(city))));
      box.querySelectorAll('.ab-pegado').forEach(async (el) => {
        const id = el.dataset.lm;
        el.addEventListener('click', () => opts.abrir(id));
        const d = await opts.datos(id);
        if (el.isConnected) { el.innerHTML = PM.tcg.html(d, { mini: true }); if (opts.pegada) opts.pegada(el, id); }
      });
      box.querySelectorAll('.ab-slot.vacio').forEach((b) => b.addEventListener('click', () => { const e = L[+b.dataset.i]; opts.irA({ pos: e.pos, name: e.name }); }));
      box.parentElement && box.parentElement.scrollTo && box.parentElement.scrollTo(0, 0);
    }
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
    .ab-go { position: absolute; right: 12px; top: 6px; font-size: 26px; font-weight: 700; text-shadow: 0 1px 4px rgba(0,0,0,.6); }
    .ab-back { border: 0; background: none; color: var(--accent); font: inherit; font-weight: 700; padding: 4px 0 10px; cursor: pointer; }
    .ab-lista { display: flex; flex-direction: column; gap: 8px; }
    .ab-cuad { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 14px; background: var(--panel); color: inherit; font: inherit; text-align: left; cursor: pointer; }
    .ab-cuad.hecho { border-color: #f59e0b; }
    .ab-ic { font-size: 22px; } .ab-nom { flex: 1; min-width: 0; } .ab-nom b { display: block; margin-bottom: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ab-cnt { font-size: 13px; font-weight: 800; color: var(--muted); white-space: nowrap; }
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
