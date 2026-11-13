// PintaMapa — abrir un sobre al conquistar una carta (petición del usuario, 12-nov-2026: «que salga de un sobre como cuando
// abres cartas de Pokémon», «el sobre lo abrimos al rasgarlo con el dedo»).
// 1) Aparece el sobre (cae con un rebote; el foil brilla). 2) Lo rasgas deslizando el dedo por arriba: la tira se va soltando
// con tu dedo, suena a papel y por la raja sale luz DEL COLOR DE LA RAREZA (el suspense). Si sueltas antes de tiempo, se
// vuelve a cerrar. 3) Al abrirse: la tira sale volando, un haz de luz, la carta sube boca abajo desde dentro, el sobre cae y
// la carta se da la vuelta con una explosión según su rareza. 4) La vista normal de la carta.
// Se carga solo al conquistar (PM.need('js/sobre.js')). Al terminar no queda nada en pantalla (ni animaciones gastando).
PM.sobre = (function () {
  const reduce = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();
  // luz de cada rareza: [principal, claro, oscuro]
  const COL = { comun: ['#9aa4b2', '#f1f5f9', '#475569'], raro: ['#3fa9ff', '#d6efff', '#1d4ed8'], epico: ['#b65cff', '#efdcff', '#6d28d9'], legendario: ['#ffb700', '#fff3c4', '#b45309'] };
  const NIVEL = { comun: 0, raro: 1, epico: 2, legendario: 3 };

  // ---------- sonidos (con el sintetizador de la app; el rasgado es ruido filtrado) ----------
  function ruido(dur, vol, desde, hasta) {
    const S = PM.sound; if (!S || !S.enabled) return;
    const ctx = S._ctx(); if (!ctx) return;
    const n = Math.floor(ctx.sampleRate * dur), buf = ctx.createBuffer(1, n, ctx.sampleRate), ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), t0 = ctx.currentTime;
    src.buffer = buf; f.type = 'bandpass'; f.Q.value = 1.4;
    f.frequency.setValueAtTime(desde, t0); f.frequency.exponentialRampToValueAtTime(hasta, t0 + dur);
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(ctx.destination); src.start(t0); src.stop(t0 + dur + 0.02);
    S._sleepSoon(Date.now() + dur * 1000 + 100);
  }
  function sonidoCarta(r, shiny) {
    const S = PM.sound; if (!S || !S.enabled) return;
    const t = (f, d, w, v, at, sl) => S.tone(f, d, w, v, at, sl);
    const k = NIVEL[r] || 0;
    if (k >= 3) t(110, 0.6, 'sine', 0.16, 0, 45);   // golpe grave de las legendarias
    const notas = [[659, 988], [523, 659, 988], [523, 659, 784, 1046], [392, 523, 659, 784, 1046, 1318]][k];
    notas.forEach((f, i) => t(f, 0.22 + k * 0.05, k >= 2 ? 'triangle' : 'sine', 0.06, 0.05 + i * 0.08));
    if (k >= 2) [1568, 2093, 2637].forEach((f, i) => t(f, 0.2, 'sine', 0.025, 0.4 + i * 0.07));   // brillo
    if (shiny) [2349, 2794, 3136, 3729].forEach((f, i) => t(f, 0.15, 'sine', 0.02, 0.7 + i * 0.06));
  }

  // ---------- chispas (lienzo, solo mientras se ve) ----------
  function chispas(cv, cols, cuantas, fuerza) {
    const dpr = Math.min(2, devicePixelRatio || 1), W = innerWidth, H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    const x = cv.getContext('2d'); x.scale(dpr, dpr);
    const P = [];
    for (let i = 0; i < cuantas; i++) {
      const a = Math.random() * Math.PI * 2, v = fuerza * (0.4 + Math.random() * 0.8);
      P.push({ x: W / 2, y: H * 0.42, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2, life: 1, dec: 0.008 + Math.random() * 0.012, s: 2 + Math.random() * 3.5, c: cols[Math.floor(Math.random() * cols.length)], estrella: Math.random() < 0.35 });
    }
    let vivo = true, last = performance.now();
    (function frame(now) {
      if (!vivo) return;
      const k = Math.min(3, (now - last) / 16.7); last = now;
      x.clearRect(0, 0, W, H);
      for (let i = P.length - 1; i >= 0; i--) {
        const p = P[i]; p.vy += 0.07 * k; p.vx *= Math.pow(0.985, k); p.x += p.vx * k; p.y += p.vy * k; p.life -= p.dec * k;
        if (p.life <= 0) { P.splice(i, 1); continue; }
        x.globalAlpha = p.life; x.fillStyle = p.c;
        if (p.estrella) { x.save(); x.translate(p.x, p.y); x.rotate(now / 200); x.fillRect(-p.s * 1.6, -p.s / 4, p.s * 3.2, p.s / 2); x.fillRect(-p.s / 4, -p.s * 1.6, p.s / 2, p.s * 3.2); x.restore(); }
        else { x.beginPath(); x.arc(p.x, p.y, p.s, 0, Math.PI * 2); x.fill(); }
      }
      if (P.length) requestAnimationFrame(frame); else vivo = false;
    })(last);
    return () => { vivo = false; };
  }

  // ---------- el sello dorado (lacre): «Carta de conquista · ciudad» en círculo y la P de PintaMapa ----------
  let selloN = 0;
  function sello(ciudad, cls) {
    const id = 'sbs' + (++selloN), txt = (PM.t('Carta de conquista') + (ciudad ? ' · ' + ciudad : '') + ' · ').toUpperCase();
    return `<svg class="sb-sello ${cls}" viewBox="0 0 120 120" aria-hidden="true"><defs>
      <radialGradient id="${id}g" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#f6e3a1"/><stop offset=".45" stop-color="#d4af5a"/><stop offset="1" stop-color="#7d5c19"/></radialGradient>
      <path id="${id}p" d="M60,60 m-41,0 a41,41 0 1,1 82,0 a41,41 0 1,1 -82,0"/></defs>
      <circle cx="60" cy="60" r="57" fill="url(#${id}g)"/><circle cx="60" cy="60" r="52" fill="none" stroke="#5e4412" stroke-width="1" opacity=".55"/>
      <circle cx="60" cy="60" r="31" fill="none" stroke="#5e4412" stroke-width="1" opacity=".55"/>
      <text font-family="Georgia, 'Noto Serif', serif" font-size="8.2" letter-spacing="1.6" fill="#4a3510"><textPath href="#${id}p" textLength="252">${PM.esc(txt)}</textPath></text>
      <text x="60" y="73" text-anchor="middle" font-family="Georgia, 'Noto Serif', serif" font-size="38" font-weight="700" fill="#4a3510">P</text></svg>`;
  }
  // el plano de las calles alrededor del lugar conquistado (las que has pintado, en tu color); sin calles cargadas, una trama
  function plano(cv, pos) {
    if (!cv) return;
    const W = cv.clientWidth || 260, H = cv.clientHeight || 340, dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr;
    const x = cv.getContext('2d'); x.scale(dpr, dpr);
    // (todas las calles cargadas dentro del recuadro, unos 600 × 800 m: piecesNear solo da las más cercanas)
    const pcs = [];
    if (pos && PM.world && PM.world.pieces) { const dLat = 0.0045, dLon = 0.0045 / Math.cos(pos[0] * Math.PI / 180); for (const pc of Object.values(PM.world.pieces)) { const m = pc.mid; if (m && Math.abs(m[0] - pos[0]) < dLat && Math.abs(m[1] - pos[1]) < dLon) pcs.push(pc); } }
    if (!pcs.length) { cv.classList.add('vacio'); return; }
    const k = Math.cos(pos[0] * Math.PI / 180), esc = W / 0.0072;   // ~600 m de ancho
    const px = (q) => [W / 2 + (q[1] - pos[1]) * k * esc, H * 0.44 - (q[0] - pos[0]) * esc];
    const pintado = (PM.state && PM.state.data && PM.state.data.painted) || {};
    const traza = (pc, w) => { x.beginPath(); pc.pts.forEach((q, i) => { const [a, b] = px(q); if (i) x.lineTo(a, b); else x.moveTo(a, b); }); x.lineWidth = w; x.stroke(); };
    x.lineCap = 'round'; x.lineJoin = 'round';
    x.strokeStyle = 'rgba(237,230,214,.30)';
    for (const pc of pcs) if (!pintado[pc.id]) traza(pc, pc.wide ? 2.2 : pc.trail ? 0.8 : 1.2);
    // las que ya has pintado, en dorado holográfico: se dibujan aparte (en blanco) y esa capa hace de plantilla de un oro
    // tornasolado que se mueve (.sb-oro). Sin ninguna pintada, no hay capa
    const tuyas = pcs.filter((pc) => pintado[pc.id]);
    const oro = cv.parentElement && cv.parentElement.querySelector('.sb-oro');
    if (!tuyas.length || !oro) return;
    const m = document.createElement('canvas'); m.width = cv.width; m.height = cv.height;
    const mx = m.getContext('2d'); mx.scale(dpr, dpr); mx.lineCap = 'round'; mx.lineJoin = 'round'; mx.strokeStyle = '#fff';
    for (const pc of tuyas) { mx.beginPath(); pc.pts.forEach((q, i) => { const [a, b] = px(q); if (i) mx.lineTo(a, b); else mx.moveTo(a, b); }); mx.lineWidth = pc.wide ? 4.2 : 3.2; mx.stroke(); }
    const url = 'url(' + m.toDataURL('image/png') + ')';
    oro.style.webkitMaskImage = url; oro.style.maskImage = url;
    oro.classList.add('si');
  }

  // ---------- el sobre ----------
  function abrir(d, alFinal) {
    const viejo = document.getElementById('sobre'); if (viejo) viejo.remove();
    const r = COL[d.rarity] ? d.rarity : 'comun', k = NIVEL[r], [c1, c2, c3] = COL[r];
    const ov = document.createElement('div');
    ov.id = 'sobre'; ov.className = 'r-' + r + (d.shiny ? ' shiny' : '');
    ov.style.setProperty('--l1', c1); ov.style.setProperty('--l2', c2); ov.style.setProperty('--l3', c3);
    ov.innerHTML = `<canvas class="sb-cv"></canvas><div class="sb-rayos"></div>
      <button class="sb-saltar">${PM.t('Saltar')} ›</button>
      <div class="sb-escena">
        <div class="sb-carta" style="--w: calc(var(--cw) * .86)">${PM.tcg.html(d)}<div class="sb-dorso">${sello(d.city, 'dorso')}<b translate="no">PintaMapa</b></div></div>
        <div class="sb-pack">
          <div class="sb-tapa"><i></i></div>
          <div class="sb-cuerpo">
            <canvas class="sb-mapa"></canvas><div class="sb-oro"></div><div class="sb-foil"></div>
            ${sello(d.city, 'frente')}
            <div class="sb-marca" translate="no"><b>PintaMapa</b>${d.city ? `<em>${PM.esc(d.city)}</em>` : ''}</div>
            ${d.number ? `<div class="sb-num">Nº ${d.number}</div>` : ''}
          </div>
          <div class="sb-raja"></div>
        </div>
        <span class="sb-mano">👆</span>
      </div>
      <div class="sb-guia"><p>${PM.t('Desliza el dedo por arriba para rasgarlo')}</p></div>`;
    document.body.appendChild(ov);
    plano(ov.querySelector('.sb-mapa'), d.pos);
    const pack = ov.querySelector('.sb-pack');
    // (boca abajo con un dorso genérico hasta darse la vuelta: el reverso de la carta ya enseña la foto y el nombre)
    requestAnimationFrame(() => ov.classList.add('on'));
    PM.vibrate(20);

    let p = 0, x0 = null, ultimoTick = 0, abierto = false, terminado = false, pararChispas = null, toques = 0;
    const pon = (v) => { p = Math.max(0, Math.min(1, v)); ov.style.setProperty('--p', p.toFixed(3)); };
    const fin = () => {
      if (terminado) return; terminado = true;
      if (pararChispas) pararChispas();
      ov.classList.add('out'); setTimeout(() => ov.remove(), 300);
      alFinal();
    };
    ov.querySelector('.sb-saltar').addEventListener('click', (e) => { e.stopPropagation(); fin(); });

    function abrirYa() {
      if (abierto) return; abierto = true;
      pon(1); ov.classList.add('abierto');
      ruido(0.35, 0.5, 2600, 700); PM.vibrate([30, 30, 60]);
      // luz por la raja, la carta sube, el sobre cae, la carta se gira
      setTimeout(() => ov.classList.add('sube'), reduce ? 0 : 380);
      setTimeout(() => ov.classList.add('fuera'), reduce ? 0 : 1100);
      setTimeout(() => {
        ov.classList.add('gira');
        sonidoCarta(r, d.shiny);
        PM.vibrate(k >= 3 ? [80, 40, 80, 40, 260] : k >= 2 ? [60, 40, 140] : [50]);
        pararChispas = chispas(ov.querySelector('.sb-cv'), [c1, c2, '#ffffff'].concat(d.shiny ? ['#ff2e88', '#22d3ee', '#a3e635'] : []), [24, 60, 120, 220][k] + (d.shiny ? 80 : 0), 4 + k * 2);
      }, reduce ? 50 : 1500);
      setTimeout(fin, reduce ? 400 : 2900 + k * 250);
    }
    // rasgar: el dedo (o el ratón) se arrastra de lado a lado por la parte de arriba del sobre
    pack.addEventListener('pointerdown', (e) => {
      if (abierto) return;
      const b = pack.getBoundingClientRect();
      if (e.clientY > b.top + b.height * 0.5) { toques++; pack.classList.remove('sacude'); void pack.offsetWidth; pack.classList.add('sacude'); if (toques >= 3) abrirYa(); return; }   // (abajo: no rasga; a los 3 toques se abre solo)
      x0 = e.clientX; ov.classList.add('rasgando');
      try { pack.setPointerCapture(e.pointerId); } catch (er) { /* (sin captura: el dedo sigue funcionando sobre el sobre) */ }
    });
    pack.addEventListener('pointermove', (e) => {
      if (x0 == null || abierto) return;
      const w = pack.getBoundingClientRect().width;
      pon(Math.abs(e.clientX - x0) / (w * 0.75));
      if (p - ultimoTick >= 0.1) { ultimoTick = p; ruido(0.07, 0.25, 1800 + p * 1500, 900); PM.vibrate(8); }
      if (p >= 1) { x0 = null; abrirYa(); }
    });
    const suelta = () => {
      if (x0 == null || abierto) return; x0 = null; ov.classList.remove('rasgando');
      if (p >= 0.6) abrirYa(); else { ultimoTick = 0; pon(0); }   // (poco rasgado: se vuelve a cerrar)
    };
    pack.addEventListener('pointerup', suelta); pack.addEventListener('pointercancel', suelta);
    if (reduce) setTimeout(abrirYa, 600);
  }

  // ---------- estilos ----------
  const css = document.createElement('style');
  css.textContent = `
  #sobre { --cw: min(70vw, 300px); position: fixed; inset: 0; z-index: 3200; overflow: hidden; display: grid; place-items: center; opacity: 0; transition: opacity .25s;
    background: #0a1424; background: radial-gradient(circle at 50% 42%, #1b3152 0%, #0a1424 70%); font-family: Inter, system-ui, sans-serif; color: #fff; touch-action: none; user-select: none; -webkit-user-select: none; }
  #sobre.on { opacity: 1; } #sobre.out { opacity: 0; }
  #sobre .sb-cv { position: absolute; inset: 0; z-index: 5; pointer-events: none; }
  #sobre .sb-saltar { position: absolute; top: calc(14px + env(safe-area-inset-top)); right: 14px; z-index: 6; border: 0; background: none; color: rgba(237,230,214,.75); border-radius: 99px; padding: 10px 16px; font: 400 15px Georgia, 'Noto Serif', serif; min-height: 40px; }
  #sobre .sb-escena { position: relative; width: var(--cw); height: calc(var(--cw) * 1.5); }
  /* el sobre */
  #sobre .sb-pack { position: absolute; inset: 0; z-index: 3; animation: sbCae .7s cubic-bezier(.25,1.5,.45,1) both; filter: drop-shadow(0 18px 30px rgba(0,0,0,.55)); cursor: grab; }
  #sobre .sb-cuerpo { position: absolute; left: 0; right: 0; top: 13%; bottom: 0; border-radius: 4px 4px 8px 8px; overflow: hidden;
    background: linear-gradient(160deg, #142a47 0%, #0f1e33 46%, #1a3557 100%);
    box-shadow: inset 0 0 0 1.5px rgba(212,175,90,.55), inset 0 0 0 5px #0f1e33, inset 0 0 0 6px rgba(212,175,90,.28);
    -webkit-mask: linear-gradient(#000 0 0) top / 100% calc(100% - 8px) no-repeat, conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) bottom / 10px 8px repeat-x;
    mask: linear-gradient(#000 0 0) top / 100% calc(100% - 8px) no-repeat, conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) bottom / 10px 8px repeat-x; }
  #sobre .sb-mapa { position: absolute; inset: 0; width: 100%; height: 100%; }
  /* tus calles: oro con reflejos tornasolados que se desplazan (como el foil holográfico de una carta) */
  #sobre .sb-oro { position: absolute; inset: 0; z-index: 1; display: none; -webkit-mask-size: 100% 100%; mask-size: 100% 100%;
    background: linear-gradient(115deg, #8c6a1e 0%, #f6e3a1 12%, #d4af5a 22%, #fff6d8 30%, #f3c9e4 36%, #bfeaff 42%, #f6e3a1 50%, #b88a2c 62%, #fff1bf 72%, #d4af5a 84%, #8c6a1e 100%);
    background-size: 300% 100%; animation: sbHolo 3.2s linear infinite; filter: drop-shadow(0 0 2px #fff3c4) drop-shadow(0 0 6px rgba(246,227,161,.95)) drop-shadow(0 0 14px rgba(212,175,90,.7)); }
  #sobre .sb-oro.si { display: block; }
  #sobre .sb-mapa.vacio { background: repeating-linear-gradient(0deg, transparent 0 21px, rgba(237,230,214,.08) 21px 22px), repeating-linear-gradient(90deg, transparent 0 27px, rgba(237,230,214,.08) 27px 28px); transform: rotate(-9deg) scale(1.3); }
  /* (el mapa se apaga hacia los bordes y deja sitio a la marca abajo) */
  #sobre .sb-cuerpo::after { content: ''; position: absolute; inset: 0; background: radial-gradient(120% 75% at 50% 40%, transparent 35%, rgba(15,30,51,.85) 75%), linear-gradient(transparent 62%, #0f1e33 86%); }
  #sobre .sb-foil { position: absolute; inset: -30%; z-index: 2; background: linear-gradient(115deg, transparent 42%, rgba(246,227,161,.18) 49%, rgba(255,255,255,.28) 50%, rgba(246,227,161,.12) 52%, transparent 58%); animation: sbFoil 4.5s ease-in-out infinite; }
  #sobre .sb-sello.frente { position: absolute; z-index: 3; left: 50%; top: 44%; width: 38%; transform: translate(-50%, -50%) rotate(-8deg); filter: drop-shadow(0 4px 10px rgba(0,0,0,.55)); }
  #sobre .sb-marca { position: absolute; z-index: 3; left: 0; right: 0; bottom: 12%; text-align: center; color: #ede6d6; }
  #sobre .sb-marca b { display: block; font: 400 calc(var(--cw) * .118) / 1 Georgia, 'Noto Serif', serif; letter-spacing: .02em; }
  #sobre .sb-marca em { display: block; margin-top: .45em; font: italic 400 calc(var(--cw) * .052) Georgia, 'Noto Serif', serif; color: #d4af5a; letter-spacing: .03em; }
  #sobre .sb-num { position: absolute; z-index: 3; right: 7%; top: 5%; font: italic 400 calc(var(--cw) * .042) Georgia, 'Noto Serif', serif; color: rgba(212,175,90,.85); }
  /* la tira de arriba (se rasga) */
  #sobre .sb-tapa { position: absolute; left: 0; right: 0; top: 0; height: 14%; z-index: 2; transform-origin: 100% 100%;
    background: linear-gradient(160deg, #1d3b62, #132743 70%); border-radius: 8px 8px 2px 2px; box-shadow: inset 0 0 0 1.5px rgba(212,175,90,.5);
    -webkit-mask: linear-gradient(#000 0 0) bottom / 100% calc(100% - 9px) no-repeat, conic-gradient(from 135deg at top, #0000, #000 1deg 89deg, #0000 90deg) top / 12px 9px repeat-x;
    mask: linear-gradient(#000 0 0) bottom / 100% calc(100% - 9px) no-repeat, conic-gradient(from 135deg at top, #0000, #000 1deg 89deg, #0000 90deg) top / 12px 9px repeat-x;
    transform: rotate(calc(var(--p, 0) * -9deg)) translateY(calc(var(--p, 0) * -10px)); transition: transform .25s; }
  #sobre.rasgando .sb-tapa { transition: none; }
  #sobre .sb-tapa i { position: absolute; left: 5%; right: 5%; bottom: 0; height: 3px; background: radial-gradient(circle, rgba(212,175,90,.9) 1.1px, transparent 1.6px) 0 50% / 7px 3px repeat-x; }
  /* la raja: luz del color de la rareza que sale según avanzas */
  #sobre .sb-raja { position: absolute; left: 0; top: 12.6%; height: 3px; z-index: 4; width: calc(var(--p, 0) * 100%); border-radius: 3px; transition: width .25s;
    background: linear-gradient(90deg, var(--l2), #fff); box-shadow: 0 0 12px 4px var(--l1), 0 0 40px 10px var(--l1); opacity: calc(var(--p, 0) * 30); }   /* (sin rasgar no se ve: no delata la rareza) */
  #sobre.rasgando .sb-raja { transition: none; }
  #sobre.abierto .sb-raja { opacity: 0; transition: opacity .5s .25s; }   /* (al abrirse, la luz pasa a los rayos: no se queda encima de la carta) */
  #sobre .sb-pack.sacude { animation: sbSacude .4s; }
  /* la carta (dentro del sobre, boca abajo) */
  #sobre .sb-carta { position: absolute; left: 7%; right: 7%; top: 16%; z-index: 2; opacity: 0; transition: transform .8s cubic-bezier(.3,1.25,.5,1), opacity .2s; }
  #sobre .sb-carta .tcg { width: 100%; }
  /* dorso genérico: el lugar no se ve hasta que la carta se da la vuelta */
  #sobre .sb-dorso { position: absolute; inset: 0; border-radius: 4.5% / 3.3%; display: grid; place-items: center; align-content: center; gap: 6%; overflow: hidden;
    background: radial-gradient(circle at 50% 40%, #1d3b62, #0f1e33 70%); box-shadow: inset 0 0 0 calc(var(--cw) * .022) #0f1e33, inset 0 0 0 calc(var(--cw) * .028) #d4af5a, inset 0 0 0 calc(var(--cw) * .05) #0f1e33, inset 0 0 0 calc(var(--cw) * .053) rgba(212,175,90,.45); }
  #sobre .sb-dorso .sb-sello { width: 46%; }
  #sobre .sb-dorso b { font: 400 calc(var(--cw) * .085) Georgia, 'Noto Serif', serif; color: #ede6d6; letter-spacing: .02em; }
  #sobre.gira .sb-carta { animation: sbVuelta .9s cubic-bezier(.3,1.2,.5,1) both; }
  #sobre.gira .sb-dorso { animation: sbDorso .9s both; }
  /* guía */
  #sobre .sb-guia { position: absolute; left: 0; right: 0; bottom: calc(10% + env(safe-area-inset-bottom)); text-align: center; z-index: 4; transition: opacity .3s; }
  #sobre .sb-guia p { margin: 8px 24px 0; font: italic 400 16px Georgia, 'Noto Serif', serif; color: rgba(237,230,214,.8); }
  #sobre .sb-mano { position: absolute; z-index: 5; left: 50%; top: 9%; margin-left: -17px; font-size: 34px; pointer-events: none; animation: sbMano 1.6s ease-in-out .8s infinite both; transition: opacity .3s; filter: drop-shadow(0 2px 6px rgba(0,0,0,.5)); }
  #sobre.rasgando .sb-mano, #sobre.abierto .sb-mano { opacity: 0; animation: none; }
  #sobre.rasgando .sb-guia, #sobre.abierto .sb-guia { opacity: 0; }
  /* abrir: la tira vuela, luz, la carta sube, el sobre cae y la carta se gira en el centro */
  #sobre .sb-rayos { position: absolute; left: 50%; top: 42%; width: 200vmax; height: 200vmax; margin: -100vmax 0 0 -100vmax; opacity: 0; transition: opacity .5s;
    background: repeating-conic-gradient(from 0deg, var(--l1) 0deg 6deg, transparent 6deg 20deg); -webkit-mask: radial-gradient(circle, #000 5%, transparent 55%); mask: radial-gradient(circle, #000 5%, transparent 55%); }
  #sobre.abierto .sb-rayos { opacity: .35; animation: sbGira 14s linear infinite; }
  #sobre.abierto .sb-tapa { animation: sbVuela .6s cubic-bezier(.3,.6,.4,1) forwards; }
  #sobre.sube .sb-carta { opacity: 1; transform: translateY(-62%); }
  #sobre.fuera .sb-pack { animation: sbBaja .6s cubic-bezier(.5,0,.8,.4) forwards; }
  #sobre.fuera .sb-carta { transform: translateY(-4%) scale(1.12); z-index: 4; }
  #sobre.gira .sb-carta { filter: drop-shadow(0 0 30px var(--l1)); }
  #sobre.r-legendario.gira .sb-escena { animation: sbTiembla .5s .1s; }
  #sobre.shiny.gira .sb-carta { filter: drop-shadow(0 0 22px #ff2e88) drop-shadow(0 0 22px #22d3ee); }
  @keyframes sbCae { 0% { transform: translateY(-70vh) rotate(-12deg); } 100% { transform: none; } }
  @keyframes sbFoil { 0% { transform: translateX(-40%); } 55%, 100% { transform: translateX(40%); } }
  @keyframes sbMano { 0% { transform: translateX(calc(var(--cw) * -.4)); opacity: 0; } 15% { opacity: 1; } 85% { opacity: 1; } 100% { transform: translateX(calc(var(--cw) * .4)); opacity: 0; } }
  @keyframes sbSacude { 25% { transform: rotate(-4deg); } 50% { transform: rotate(4deg); } 75% { transform: rotate(-2deg); } }
  @keyframes sbVuela { to { transform: translate(140px, -180px) rotate(48deg); opacity: 0; } }
  @keyframes sbBaja { to { transform: translateY(80vh) rotate(8deg); opacity: 0; } }
  @keyframes sbGira { to { transform: rotate(360deg); } }
  @keyframes sbHolo { to { background-position: -300% 0; } }
  @keyframes sbVuelta { 0% { transform: translateY(-4%) scale(1.12) rotateY(0); } 45% { transform: translateY(-4%) scale(1.2) rotateY(90deg); } 100% { transform: translateY(-4%) scale(1.12) rotateY(0); } }
  @keyframes sbDorso { 0%, 44% { opacity: 1; } 46%, 100% { opacity: 0; } }
  @keyframes sbTiembla { 20% { transform: translate(-6px, 3px); } 40% { transform: translate(5px, -4px); } 60% { transform: translate(-4px, 2px); } 80% { transform: translate(3px, -1px); } }
  @media (prefers-reduced-motion: reduce) { #sobre *, #sobre.abierto .sb-rayos { animation: none !important; } }`;
  document.head.appendChild(css);

  return { abrir };
})();
