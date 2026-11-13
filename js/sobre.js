// PintaMapa — abrir un sobre al conquistar una carta (peticiones del usuario, 12/13-nov-2026: «que salga de un sobre como
// cuando abres cartas de Pokémon»; «como en Magic the Gathering de PC con los sobres»; «quiero rasgarlo y el sobre cerrado
// más realista: es algo principal del juego y muy cuidado»).
// 1) El sobre llega volando y flota: foil metálico arrugado, abombado, con sus cierres termosellados; el reflejo sigue el dedo.
// 2) Lo RASGAS deslizando el dedo por arriba: la tira se levanta con el dedo, suena a papel y por la raja sale la luz del
//    color de la rareza. Si sueltas antes de tiempo, se vuelve a cerrar.
// 3) Rasgado: la tira sale volando, el sobre se llena de luz, tiembla y ESTALLA (destello, onda, trozos de sobre).
// 4) La carta queda boca abajo flotando, con un aura de su rareza (épica: rayos; legendaria: además una columna de luz).
// 5) La tocas y se da la vuelta con su explosión. 6) La vista normal de la carta.
// Se carga solo al conquistar (PM.need('js/sobre.js')). Al terminar no queda nada en pantalla (ni animaciones gastando).
PM.sobre = (function () {
  const reduce = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();
  // luz de cada rareza: [principal, claro, oscuro]
  const COL = { comun: ['#9aa4b2', '#f1f5f9', '#475569'], raro: ['#3fa9ff', '#d6efff', '#1d4ed8'], epico: ['#b65cff', '#efdcff', '#6d28d9'], legendario: ['#ffb700', '#fff3c4', '#b45309'] };
  const NIVEL = { comun: 0, raro: 1, epico: 2, legendario: 3 };

  // ---------- sonidos (con el sintetizador de la app; los soplidos son ruido filtrado) ----------
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
  // la carga antes de estallar: un zumbido que sube
  function sonidoCarga() {
    const S = PM.sound; if (!S || !S.enabled) return;
    ruido(0.75, 0.16, 250, 2600);
    [196, 247, 294, 392].forEach((f, i) => S.tone(f, 0.25, 'triangle', 0.035, i * 0.16, f * 1.5));
  }
  // el estallido: golpe grave, soplido y un brillo
  function sonidoEstallido() {
    const S = PM.sound; if (!S || !S.enabled) return;
    S.tone(90, 0.5, 'sine', 0.2, 0, 38);
    ruido(0.6, 0.55, 2200, 140);
    [1318, 1760, 2349].forEach((f, i) => S.tone(f, 0.18, 'sine', 0.03, 0.08 + i * 0.05));
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

  // ---------- chispas y trozos de sobre (lienzo, solo mientras se ve) ----------
  // trozos: papel del sobre (tinta y oro) que sale volando dando vueltas al estallar
  function chispas(cv, cols, cuantas, fuerza, trozos) {
    const dpr = Math.min(2, devicePixelRatio || 1), W = innerWidth, H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    const x = cv.getContext('2d'); x.scale(dpr, dpr);
    const P = [], cy = H * 0.45;
    for (let i = 0; i < cuantas; i++) {
      const a = Math.random() * Math.PI * 2, v = fuerza * (0.4 + Math.random() * 0.8);
      P.push({ x: W / 2, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2, life: 1, dec: 0.008 + Math.random() * 0.012, s: 2 + Math.random() * 3.5, c: cols[Math.floor(Math.random() * cols.length)], estrella: Math.random() < 0.35 });
    }
    const papel = ['#0f1e33', '#1a3557', '#1d3b62', '#d4af5a', '#f6e3a1'];
    for (let i = 0; i < (trozos || 0); i++) {
      const a = Math.random() * Math.PI * 2, v = 5 + Math.random() * 9;
      P.push({ x: W / 2 + (Math.random() - 0.5) * 120, y: cy + (Math.random() - 0.5) * 170, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 3, life: 1, dec: 0.007 + Math.random() * 0.008,
        w: 7 + Math.random() * 16, h: 4 + Math.random() * 9, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.5, c: papel[Math.floor(Math.random() * papel.length)], trozo: true });
    }
    let vivo = true, last = performance.now();
    (function frame(now) {
      if (!vivo) return;
      const k = Math.min(3, (now - last) / 16.7); last = now;
      x.clearRect(0, 0, W, H);
      for (let i = P.length - 1; i >= 0; i--) {
        const p = P[i]; p.vy += (p.trozo ? 0.16 : 0.07) * k; p.vx *= Math.pow(p.trozo ? 0.975 : 0.985, k); p.x += p.vx * k; p.y += p.vy * k; p.life -= p.dec * k;
        if (p.life <= 0 || p.y > H + 40) { P.splice(i, 1); continue; }
        x.globalAlpha = Math.min(1, p.life * 1.6); x.fillStyle = p.c;
        if (p.trozo) { p.rot += p.vr * k; x.save(); x.translate(p.x, p.y); x.rotate(p.rot); x.scale(1, Math.cos(p.rot * 1.7)); x.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); x.restore(); }
        else if (p.estrella) { x.save(); x.translate(p.x, p.y); x.rotate(now / 200); x.fillRect(-p.s * 1.6, -p.s / 4, p.s * 3.2, p.s / 2); x.fillRect(-p.s / 4, -p.s * 1.6, p.s / 2, p.s * 3.2); x.restore(); }
        else { x.beginPath(); x.arc(p.x, p.y, p.s, 0, Math.PI * 2); x.fill(); }
      }
      if (P.length) requestAnimationFrame(frame); else { vivo = false; x.clearRect(0, 0, W, H); }
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
  function plano(cv, pos, reintento) {
    if (!cv) return;
    const W = cv.clientWidth || 260, H = cv.clientHeight || 340, dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = W * dpr; cv.height = H * dpr;
    const x = cv.getContext('2d'); x.scale(dpr, dpr);
    // (todas las calles cargadas dentro del recuadro, unos 600 × 800 m: piecesNear solo da las más cercanas)
    const pcs = [];
    if (pos && PM.world && PM.world.pieces) { const dLat = 0.0045, dLon = 0.0045 / Math.cos(pos[0] * Math.PI / 180); for (const pc of Object.values(PM.world.pieces)) { const m = pc.mid; if (m && Math.abs(m[0] - pos[0]) < dLat && Math.abs(m[1] - pos[1]) < dLon) pcs.push(pc); } }
    if (!pcs.length) {
      cv.classList.add('vacio');
      // (calles de esa zona aún sin cargar —la app recién abierta, una carta de otra ciudad—: se piden y, si el sobre sigue
      // cerrado cuando lleguen, se dibuja el plano)
      if (pos && !reintento && PM.world && PM.world.ensureKeys && PM.world.tileKeyOf) {
        const ks = new Set(); for (const dy of [-0.004, 0, 0.004]) for (const dx of [-0.005, 0, 0.005]) ks.add(PM.world.tileKeyOf(pos[0] + dy, pos[1] + dx));
        PM.world.ensureKeys([...ks]).then(() => { if (document.body.contains(cv) && !cv.closest('.abierto')) { cv.classList.remove('vacio'); plano(cv, pos, true); } }).catch(() => {});
      }
      return;
    }
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

  // ---------- arrugas del foil: relieve de ruido iluminado de lado (como el plástico metalizado de un sobre de verdad) ----------
  let arrN = 0;
  function arrugas() {
    const id = 'sbArr' + (++arrN);
    return `<svg class="sb-arrugas" viewBox="0 0 200 330" preserveAspectRatio="none" aria-hidden="true"><filter id="${id}" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.045 0.009" numOctaves="3" seed="${3 + arrN}"/>
      <feDiffuseLighting lighting-color="#fff" surfaceScale="2.6" diffuseConstant="1.05"><feDistantLight azimuth="235" elevation="38"/></feDiffuseLighting></filter>
      <rect width="200" height="330" filter="url(#${id})"/></svg>`;
  }

  // ---------- el sobre ----------
  function abrir(d, alFinal) {
    const viejo = document.getElementById('sobre'); if (viejo) viejo.remove();
    const r = COL[d.rarity] ? d.rarity : 'comun', k = NIVEL[r], [c1, c2, c3] = COL[r];
    const ov = document.createElement('div');
    ov.id = 'sobre'; ov.className = 'r-' + r + (d.shiny ? ' shiny' : '');
    ov.style.setProperty('--l1', c1); ov.style.setProperty('--l2', c2); ov.style.setProperty('--l3', c3);
    ov.innerHTML = `<div class="sb-rayos"></div><div class="sb-haz"></div><canvas class="sb-cv"></canvas><canvas class="sb-cv sb-cv2"></canvas>
      <div class="sb-onda"></div><div class="sb-flash"></div><div class="sb-destello"></div>
      <button class="sb-saltar">${PM.t('Saltar')} ›</button>
      <div class="sb-escena">
        <div class="sb-aura"></div>
        <div class="sb-carta" style="--w: calc(var(--cw) * .86)"><div class="sb-flota2">${PM.tcg.html(d)}<div class="sb-dorso">${sello(d.city, 'dorso')}<b translate="no">PintaMapa</b></div></div></div>
        <div class="sb-suelo"></div>
        <div class="sb-pack"><div class="sb-flota">
          <div class="sb-cuerpo">
            <canvas class="sb-mapa"></canvas><div class="sb-oro"></div>
            ${sello(d.city, 'frente')}
            <div class="sb-marca" translate="no"><i>${PM.t('Sobre de conquista')}</i><b>PintaMapa</b>${d.city ? `<em>${PM.esc(d.city)}</em>` : ''}</div>
            <div class="sb-pie"><span>${PM.t('Contiene 1 carta')}</span>${d.number ? `<span>Nº ${d.number}</span>` : ''}</div>
            ${arrugas()}
            <div class="sb-almohada"></div><div class="sb-foil"></div><div class="sb-reflejo"></div>
          </div>
          <div class="sb-cierre abajo"></div>
          <div class="sb-tira">
            <div class="sb-trozo fijo"><div class="sb-cierre arriba"></div>${arrugas()}<div class="sb-almohada"></div><div class="sb-reflejo"></div></div>
            <div class="sb-trozo suelto"><div class="sb-cierre arriba"></div>${arrugas()}<div class="sb-almohada"></div><div class="sb-reflejo"></div></div>
          </div>
          <div class="sb-boca"></div><div class="sb-raja"></div><div class="sb-chorro"></div>
          <div class="sb-brillo"></div>
        </div></div>
        <span class="sb-mano">👆</span>
      </div>
      <div class="sb-guia"><p class="g1">${PM.t('Desliza el dedo por arriba para rasgarlo')}</p></div>`;
    document.body.appendChild(ov);
    plano(ov.querySelector('.sb-mapa'), d.pos);
    const pack = ov.querySelector('.sb-pack'), [cvA, cvB] = ov.querySelectorAll('.sb-cv');
    requestAnimationFrame(() => ov.classList.add('on'));
    PM.vibrate(20);
    ruido(0.5, 0.14, 500, 1600);   // (llega volando)

    // fase: 0 sobre cerrado · 1 abriéndose · 2 carta boca abajo · 3 carta vuelta
    let fase = 0, terminado = false, paradas = [], autoGiro = 0;
    let p = 0, x0 = null, ultimoTick = 0, toques = 0;
    const T = (ms) => (reduce ? Math.min(ms, 60) : ms);
    const pon = (v) => { p = Math.max(0, Math.min(1, v)); ov.style.setProperty('--p', p.toFixed(3)); };
    const fin = () => {   // (Saltar: fuera el sobre y la carta directamente)
      if (terminado) return; terminado = true;
      clearTimeout(autoGiro); paradas.forEach((f) => f());
      ov.classList.add('out'); setTimeout(() => ov.remove(), 300);
      alFinal();
    };
    ov.querySelector('.sb-saltar').addEventListener('click', (e) => { e.stopPropagation(); fin(); });

    // rasgado entero: la tira sale volando, el sobre se llena de luz, tiembla y estalla; la carta sale boca abajo con el aura
    // de su rareza, se da la vuelta sola y vuelve a su tamaño, justo donde queda en la vista normal. Sin más toques
    // (petición del usuario, 13-nov-2026: «al rasgar, que la carta salga y recupere su tamaño original sin toques extras»)
    function abrirYa() {
      if (fase) return; fase = 1; x0 = null;
      pon(1); ov.classList.remove('rasgando'); ov.classList.add('abierto');
      pack.style.removeProperty('--rx'); pack.style.removeProperty('--ry');
      ruido(0.35, 0.5, 2600, 700); PM.vibrate([30, 30, 60]);
      setTimeout(() => { ov.classList.add('carga'); sonidoCarga(); PM.vibrate([12, 60, 14, 50, 18, 40, 24]); }, T(420));
      setTimeout(() => {   // estalla
        ov.classList.add('estalla');
        sonidoEstallido(); PM.vibrate([90]);
        paradas.push(chispas(cvA, ['#ffffff', '#fff3c4', '#f6e3a1', '#d4af5a'], 70, 9, 46));
      }, T(1200));
      setTimeout(() => {   // la carta, boca abajo, con el aura de su rareza (un instante de suspense) y se gira sola
        ov.classList.add('carta'); fase = 2;
        if (k >= 1) ruido(0.9, 0.08 + k * 0.04, 400, 1200 + k * 600);
        if (k >= 3) PM.sound && PM.sound.enabled && PM.sound.tone(55, 1.2, 'sine', 0.12, 0, 70);   // (la legendaria retumba)
        autoGiro = setTimeout(girar, T(850 + k * 150));
      }, T(1500));
    }
    function girar() {
      if (fase !== 2) return; fase = 3; clearTimeout(autoGiro);
      ov.classList.add('gira');
      sonidoCarta(r, d.shiny);
      PM.vibrate(k >= 3 ? [80, 40, 80, 40, 260] : k >= 2 ? [60, 40, 140] : [50]);
      paradas.push(chispas(cvB, [c1, c2, '#ffffff'].concat(d.shiny ? ['#ff2e88', '#22d3ee', '#a3e635'] : []), [24, 60, 120, 220][k] + (d.shiny ? 80 : 0), 4 + k * 2));
      autoGiro = setTimeout(aSuSitio, T(1500 + k * 250));
    }
    // la carta del sobre viaja hasta la carta de la vista normal (que se abre debajo, quieta y oculta) y se quita el sobre:
    // la misma carta, a su tamaño de siempre, sin saltos
    async function aSuSitio() {
      if (terminado) return; terminado = true;
      const yo = ov.querySelector('.sb-carta'), vista = () => document.getElementById('tcg-view');
      document.documentElement.classList.add('pm-desde-sobre');
      Promise.resolve(alFinal()).catch(() => {});
      let dest = null;
      for (let i = 0; i < 40 && !dest; i++) { await new Promise((ok) => setTimeout(ok, 40)); const v = vista(); dest = v && v.classList.contains('show') ? v.querySelector('.tcg') : null; }
      const quitar = () => { paradas.forEach((f) => f()); ov.remove(); document.documentElement.classList.remove('pm-desde-sobre'); if (dest) dest.style.visibility = ''; };
      if (!dest || reduce) { ov.classList.add('out'); setTimeout(quitar, 300); return; }
      dest.style.visibility = 'hidden';
      // (se parte de donde está ahora: sin la animación del giro, con la misma escala, y se lleva al hueco exacto)
      const escala = 1.1;
      yo.style.animation = 'none'; yo.style.transform = 'none'; yo.style.transformOrigin = '0 0';
      const a = yo.getBoundingClientRect(), b = dest.getBoundingClientRect();
      yo.style.transform = `translate(${(a.width * (1 - escala)) / 2}px, ${(a.height * (1 - escala)) / 2}px) scale(${escala})`;
      void yo.offsetWidth;
      ov.classList.add('paso');
      yo.style.transition = 'transform .55s cubic-bezier(.3,1.05,.4,1), filter .4s';
      yo.style.transform = `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(${b.width / a.width})`;
      yo.style.filter = 'none';
      setTimeout(quitar, 580);
    }
    // tocar después de rasgar solo adelanta (nunca hace falta)
    ov.addEventListener('click', () => { if (fase === 2) girar(); });
    // el reflejo del foil y la inclinación siguen al dedo (o al ratón) mientras no rasgas
    const inclina = (e) => {
      if (fase || x0 != null) return;
      const b = pack.getBoundingClientRect(), dx = (e.clientX - (b.left + b.width / 2)) / b.width, dy = (e.clientY - (b.top + b.height / 2)) / b.height;
      pack.style.setProperty('--ry', (Math.max(-1, Math.min(1, dx)) * 14).toFixed(1) + 'deg');
      pack.style.setProperty('--rx', (Math.max(-1, Math.min(1, -dy)) * 10).toFixed(1) + 'deg');
      ov.style.setProperty('--gx', (50 + dx * 70).toFixed(0) + '%'); ov.style.setProperty('--gy', (40 + dy * 50).toFixed(0) + '%');
    };
    ov.addEventListener('pointermove', inclina);
    // rasgar: el dedo se arrastra de lado a lado por la parte de arriba del sobre; la tira se levanta con él
    pack.addEventListener('pointerdown', (e) => {
      if (fase) return;
      const b = pack.getBoundingClientRect();
      if (e.clientY > b.top + b.height * 0.42) { toques++; pack.classList.remove('sacude'); void pack.offsetWidth; pack.classList.add('sacude'); PM.vibrate(15); if (toques >= 3) abrirYa(); return; }   // (abajo no rasga; a los 3 toques se abre solo)
      pack.style.removeProperty('--rx'); pack.style.removeProperty('--ry');
      x0 = e.clientX; ov.classList.add('rasgando');
      try { pack.setPointerCapture(e.pointerId); } catch (er) { /* (sin captura: el dedo sigue funcionando sobre el sobre) */ }
    });
    pack.addEventListener('pointermove', (e) => {
      if (x0 == null || fase) return;
      const w = pack.getBoundingClientRect().width;
      pon(Math.abs(e.clientX - x0) / (w * 0.75));
      if (p - ultimoTick >= 0.08) { ultimoTick = p; ruido(0.07, 0.25, 1800 + p * 1500, 900); PM.vibrate(8); }
      if (p >= 1) abrirYa();
    });
    const suelta = () => {
      if (x0 == null || fase) return; x0 = null; ov.classList.remove('rasgando');
      if (p >= 0.6) abrirYa(); else { ultimoTick = 0; pon(0); }   // (poco rasgado: se vuelve a cerrar)
    };
    pack.addEventListener('pointerup', suelta); pack.addEventListener('pointercancel', suelta);
    if (reduce) setTimeout(abrirYa, 600);
  }

  // ---------- estilos ----------
  const css = document.createElement('style');
  css.textContent = `
  #sobre { --cw: min(94vw, 460px, calc((100vh - 150px) * .63)); position: fixed; inset: 0; padding-bottom: calc(92px + env(safe-area-inset-bottom)); box-sizing: border-box; z-index: 3200; overflow: hidden; display: grid; place-items: center; opacity: 0; transition: opacity .25s;
    background: #0a1424; background: radial-gradient(circle at 50% 42%, #1b3152 0%, #0a1424 70%); font-family: Inter, system-ui, sans-serif; color: #fff; touch-action: none; user-select: none; -webkit-user-select: none; }
  #sobre.on { opacity: 1; } #sobre.out { opacity: 0; }
  #sobre .sb-cv { position: absolute; inset: 0; z-index: 6; pointer-events: none; }
  #sobre .sb-saltar { position: absolute; top: calc(14px + env(safe-area-inset-top)); right: 14px; z-index: 8; border: 0; background: none; color: rgba(237,230,214,.75); border-radius: 99px; padding: 10px 16px; font: 400 15px Georgia, 'Noto Serif', serif; min-height: 40px; }
  #sobre .sb-escena { position: relative; width: var(--cw); height: calc(var(--cw) * 98 / 63); perspective: 1200px; animation: sbLlega .9s cubic-bezier(.2,1.25,.4,1) both; }
  /* el sobre: del tamaño y formato de la carta que sale (y donde queda luego en su vista); llega volando, flota y se inclina con el dedo */
  #sobre .sb-pack { position: absolute; inset: 0; z-index: 3; cursor: grab; transform-style: preserve-3d;
    transform: rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg)); transition: transform .35s cubic-bezier(.2,.8,.3,1);
    filter: drop-shadow(0 2px 2px rgba(0,0,0,.5)) drop-shadow(0 16px 24px rgba(0,0,0,.45)); }
  #sobre.rasgando .sb-pack { cursor: grabbing; }
  #sobre .sb-flota { position: absolute; inset: 0; animation: sbFlota 3.2s ease-in-out .9s infinite alternate; }
  #sobre.rasgando .sb-flota { animation-play-state: paused; }
  #sobre .sb-suelo { position: absolute; left: 12%; right: 12%; bottom: -5%; height: 5%; border-radius: 50%; background: radial-gradient(closest-side, rgba(0,0,0,.55), transparent); filter: blur(4px); animation: sbSuelo 3.2s ease-in-out .9s infinite alternate; }
  #sobre.estalla .sb-suelo { opacity: 0; transition: opacity .2s; }
  /* el cuerpo: foil metalizado azul tinta, impreso con el plano; entre el cierre de abajo y la línea de rasgado */
  #sobre .sb-cuerpo { position: absolute; left: 0; right: 0; top: 11%; bottom: 7%; overflow: hidden;
    background: linear-gradient(100deg, #0b172a 0%, #1a3557 18%, #12284a 40%, #0f1e33 62%, #1d3b62 84%, #0b172a 100%); }
  #sobre .sb-mapa { position: absolute; inset: 0; width: 100%; height: 100%; }
  /* tus calles: oro con reflejos tornasolados que se desplazan (como el foil holográfico de una carta) */
  #sobre .sb-oro { position: absolute; inset: 0; z-index: 1; display: none; -webkit-mask-size: 100% 100%; mask-size: 100% 100%;
    background: linear-gradient(115deg, #8c6a1e 0%, #f6e3a1 12%, #d4af5a 22%, #fff6d8 30%, #f3c9e4 36%, #bfeaff 42%, #f6e3a1 50%, #b88a2c 62%, #fff1bf 72%, #d4af5a 84%, #8c6a1e 100%);
    background-size: 300% 100%; animation: sbHolo 3.2s linear infinite; filter: drop-shadow(0 0 2px #fff3c4) drop-shadow(0 0 6px rgba(246,227,161,.95)) drop-shadow(0 0 14px rgba(212,175,90,.7)); }
  #sobre .sb-oro.si { display: block; }
  #sobre .sb-mapa.vacio { background: repeating-linear-gradient(0deg, transparent 0 21px, rgba(237,230,214,.08) 21px 22px), repeating-linear-gradient(90deg, transparent 0 27px, rgba(237,230,214,.08) 27px 28px); transform: rotate(-9deg) scale(1.3); }
  /* (el mapa se apaga hacia los bordes y deja sitio a la marca abajo) */
  #sobre .sb-cuerpo::after { content: ''; position: absolute; inset: 0; z-index: 1; background: radial-gradient(120% 70% at 50% 38%, transparent 35%, rgba(11,23,42,.8) 78%), linear-gradient(transparent 58%, rgba(11,23,42,.92) 84%); }
  #sobre .sb-sello.frente { position: absolute; z-index: 3; left: 50%; top: 40%; width: 36%; transform: translate(-50%, -50%) rotate(-8deg); filter: drop-shadow(0 1px 0 rgba(255,255,255,.25)) drop-shadow(0 4px 8px rgba(0,0,0,.6)); }
  #sobre .sb-marca { position: absolute; z-index: 3; left: 0; right: 0; bottom: 13%; text-align: center; color: #ede6d6; }
  #sobre .sb-marca i { display: block; margin-bottom: .5em; font: italic 400 calc(var(--cw) * .044) Georgia, 'Noto Serif', serif; color: rgba(212,175,90,.9); letter-spacing: .04em; }
  /* (la marca en relieve: luz por arriba, sombra por abajo) */
  #sobre .sb-marca b { display: block; font: 400 calc(var(--cw) * .125) / 1 Georgia, 'Noto Serif', serif; letter-spacing: .015em; text-shadow: 0 -1px 0 rgba(255,255,255,.35), 0 1.5px 0 rgba(0,0,0,.65), 0 3px 10px rgba(0,0,0,.45); }
  #sobre .sb-marca em { display: block; margin-top: .45em; font: italic 400 calc(var(--cw) * .056) Georgia, 'Noto Serif', serif; color: #d4af5a; letter-spacing: .03em; text-shadow: 0 1px 0 rgba(0,0,0,.6); }
  #sobre .sb-pie { position: absolute; z-index: 3; left: 7%; right: 7%; bottom: 4%; display: flex; justify-content: space-between; font: italic 400 calc(var(--cw) * .036) Georgia, 'Noto Serif', serif; color: rgba(237,230,214,.55); }
  /* arrugas del foil (relieve iluminado) y el abombado de un sobre lleno: bordes que se curvan hacia atrás */
  #sobre .sb-arrugas { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 4; mix-blend-mode: overlay; opacity: .55; pointer-events: none; }
  #sobre .sb-almohada { position: absolute; inset: 0; z-index: 5; pointer-events: none;
    background: linear-gradient(90deg, rgba(0,0,0,.55) 0%, rgba(255,255,255,.14) 3.5%, rgba(255,255,255,0) 11%, rgba(0,0,0,0) 86%, rgba(255,255,255,.1) 95%, rgba(0,0,0,.6) 100%); }
  #sobre .sb-cuerpo > .sb-almohada::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,.45), transparent 5%, transparent 94%, rgba(0,0,0,.5)); }
  /* el brillo metálico: una franja que pasa sola y un reflejo que sigue al dedo */
  #sobre .sb-foil { position: absolute; inset: 0; z-index: 6; pointer-events: none; mix-blend-mode: screen;
    background: linear-gradient(105deg, transparent 38%, rgba(246,227,161,.12) 46%, rgba(255,255,255,.3) 50%, rgba(191,234,255,.12) 54%, transparent 62%) 0 0 / 300% 100%; animation: sbFoil 5s ease-in-out 1.2s infinite; }
  #sobre .sb-reflejo { position: absolute; inset: 0; z-index: 6; pointer-events: none; mix-blend-mode: screen;
    background: radial-gradient(55% 32% at var(--gx, 32%) var(--gy, 28%), rgba(255,255,255,.26), rgba(255,255,255,.06) 55%, transparent 75%); }
  /* los cierres termosellados: estrías verticales, borde dentado, más planos y claros que el cuerpo */
  #sobre .sb-cierre { position: absolute; left: 0; right: 0; height: 7%; z-index: 7;
    background: repeating-linear-gradient(90deg, rgba(255,255,255,.2) 0 1px, rgba(0,0,0,.28) 1px 2.4px, rgba(255,255,255,0) 2.4px 3.6px), linear-gradient(180deg, #355a87, #1d3b62 40%, #13284a 100%);
    box-shadow: inset 0 -1px 0 rgba(212,175,90,.55), inset 0 1px 0 rgba(255,255,255,.18); }
  #sobre .sb-cierre.abajo { bottom: 0; box-shadow: inset 0 1px 0 rgba(212,175,90,.55), inset 0 -1px 0 rgba(0,0,0,.3);
    -webkit-mask: linear-gradient(#000 0 0) top / 100% calc(100% - 6px) no-repeat, conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) bottom / 8px 6px repeat-x;
    mask: linear-gradient(#000 0 0) top / 100% calc(100% - 6px) no-repeat, conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) bottom / 8px 6px repeat-x; }
  /* la tira de arriba (cierre + franja hasta la línea de rasgado): un trozo fijo y otro que se levanta con el dedo */
  #sobre .sb-tira { position: absolute; left: 0; right: 0; top: 0; height: 11%; z-index: 8; }
  #sobre .sb-trozo { position: absolute; inset: 0; overflow: hidden; background: linear-gradient(100deg, #0b172a 0%, #1a3557 18%, #12284a 40%, #0f1e33 62%, #1d3b62 84%, #0b172a 100%); }
  #sobre .sb-trozo .sb-cierre { top: 0; height: 64%;
    -webkit-mask: linear-gradient(#000 0 0) bottom / 100% calc(100% - 6px) no-repeat, conic-gradient(from 135deg at top, #0000, #000 1deg 89deg, #0000 90deg) top / 8px 6px repeat-x;
    mask: linear-gradient(#000 0 0) bottom / 100% calc(100% - 6px) no-repeat, conic-gradient(from 135deg at top, #0000, #000 1deg 89deg, #0000 90deg) top / 8px 6px repeat-x; }
  /* la línea de rasgado (perforada) con su muesca a la izquierda */
  #sobre .sb-trozo.fijo { clip-path: inset(0 0 0 calc(var(--p, 0) * 100%)); }
  #sobre .sb-trozo.fijo::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 2px; z-index: 9; background: radial-gradient(circle, rgba(212,175,90,.85) .9px, transparent 1.3px) 0 50% / 6px 2px repeat-x; }
  #sobre .sb-trozo.fijo::before { content: ''; position: absolute; left: -1px; bottom: -5px; z-index: 9; border: 5px solid transparent; border-left: 7px solid #0a1424; }
  #sobre .sb-trozo.suelto { clip-path: inset(0 calc(100% - var(--p, 0) * 100%) 0 0); transform-origin: calc(var(--p, 0) * 100%) 100%;
    transform: translateY(calc(var(--p, 0) * -7px)) rotate(calc(var(--p, 0) * -24deg)); transition: transform .3s cubic-bezier(.3,1.4,.5,1), clip-path .3s;
    -webkit-mask: linear-gradient(#000 0 0) top / 100% calc(100% - 3px) no-repeat, conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) bottom / 5px 3px repeat-x;
    mask: linear-gradient(#000 0 0) top / 100% calc(100% - 3px) no-repeat, conic-gradient(from -45deg at bottom, #0000, #000 1deg 89deg, #0000 90deg) bottom / 5px 3px repeat-x; }
  #sobre.rasgando .sb-trozo.suelto, #sobre.rasgando .sb-trozo.fijo { transition: none; }
  #sobre.abierto .sb-trozo.suelto { animation: sbVuela .6s cubic-bezier(.3,.6,.4,1) forwards; }
  #sobre.abierto .sb-trozo.fijo { display: none; }
  /* lo que se ve al rasgar: la boca del sobre (oscura) y la luz de la rareza que sale por la raja */
  #sobre .sb-boca { position: absolute; left: 0; top: 10.2%; height: 1.6%; z-index: 7; width: calc(var(--p, 0) * 100%); background: linear-gradient(#000, #050b16); }
  #sobre .sb-raja { position: absolute; left: 0; top: 10.6%; height: 3px; z-index: 7; width: calc(var(--p, 0) * 100%); border-radius: 3px;
    background: linear-gradient(90deg, var(--l2), #fff); box-shadow: 0 0 12px 4px var(--l1), 0 0 40px 10px var(--l1); opacity: calc(var(--p, 0) * 30); }   /* (sin rasgar no se ve: no delata la rareza) */
  #sobre.estalla .sb-raja { opacity: 0; }
  /* abierto: la luz de la rareza sale a chorro por arriba */
  #sobre .sb-chorro { position: absolute; left: -10%; right: -10%; bottom: 89%; height: 70%; z-index: 2; opacity: 0; pointer-events: none; transform-origin: 50% 100%; transform: scaleY(.2);
    background: radial-gradient(60% 100% at 50% 100%, var(--l2), var(--l1) 30%, transparent 70%); filter: blur(8px); mix-blend-mode: screen; }
  #sobre.abierto .sb-chorro { opacity: .9; transform: scaleY(1); transition: opacity .4s .15s, transform .6s cubic-bezier(.2,1.2,.4,1) .15s; }
  #sobre .sb-pack.sacude .sb-flota { animation: sbSacude .4s; }
  #sobre .sb-mano { position: absolute; z-index: 9; left: 50%; top: 5%; margin-left: -17px; font-size: 34px; pointer-events: none; animation: sbMano 1.8s ease-in-out 1.4s infinite both; transition: opacity .3s; filter: drop-shadow(0 2px 6px rgba(0,0,0,.5)); }
  #sobre.rasgando .sb-mano, #sobre.abierto .sb-mano { opacity: 0; animation: none; }
  /* la carga: el sobre se llena de luz por dentro y tiembla cada vez más (luz neutra: aún no delata la rareza) */
  #sobre .sb-brillo { position: absolute; inset: 0; z-index: 4; border-radius: 6px; opacity: 0; pointer-events: none;
    background: radial-gradient(70% 55% at 50% 48%, #fff 0%, rgba(255,243,196,.85) 35%, rgba(212,175,90,.25) 70%, transparent 100%); mix-blend-mode: screen; }
  #sobre.carga .sb-flota { animation: sbCarga .78s cubic-bezier(.5,0,.9,.6) both; }
  #sobre.carga .sb-brillo { opacity: 1; transition: opacity .75s cubic-bezier(.6,0,1,1); }
  #sobre.carga .sb-pack { filter: drop-shadow(0 0 22px rgba(255,243,196,.9)) drop-shadow(0 0 60px rgba(212,175,90,.6)); transition: filter .7s; }
  /* el estallido: el sobre desaparece en luz, destello, onda */
  #sobre.estalla .sb-pack { animation: sbEstalla .22s ease-in forwards; pointer-events: none; }
  #sobre .sb-flash { position: absolute; inset: 0; z-index: 7; background: radial-gradient(circle at 50% 45%, #fff 0%, #fff8e1 40%, rgba(255,243,196,.85) 100%); opacity: 0; pointer-events: none; }
  #sobre.estalla .sb-flash { animation: sbFlash .75s ease-out forwards; }
  #sobre .sb-onda { position: absolute; left: 50%; top: 45%; width: 40vmin; height: 40vmin; margin: -20vmin 0 0 -20vmin; z-index: 6; border-radius: 50%; opacity: 0; pointer-events: none;
    border: 3px solid #fff3c4; box-shadow: 0 0 24px 6px rgba(255,243,196,.7), inset 0 0 24px 6px rgba(255,243,196,.5); }
  #sobre.estalla .sb-onda { animation: sbOnda .8s cubic-bezier(.1,.6,.3,1) forwards; }
  /* la carta boca abajo, flotando, con el aura de su rareza */
  #sobre .sb-carta { position: absolute; left: 7%; right: 7%; top: 12%; z-index: 4; opacity: 0; pointer-events: none; }
  #sobre .sb-flota2 { position: relative; }
  #sobre .sb-carta .tcg { width: 100%; aspect-ratio: 63 / 98; }   /* (el mismo formato que en la vista de la carta: al llegar a su sitio encaja exacta) */
  #sobre.carta .sb-carta { opacity: 1; pointer-events: auto; cursor: pointer; animation: sbSale .7s cubic-bezier(.2,1.4,.4,1) both; }
  #sobre.carta .sb-flota2 { animation: sbFlota2 2.6s ease-in-out .7s infinite alternate; }
  #sobre .sb-aura { position: absolute; left: -30%; right: -30%; top: 2%; bottom: 0; z-index: 1; opacity: 0; pointer-events: none; border-radius: 50%;
    background: radial-gradient(closest-side, var(--l1), transparent); filter: blur(18px); }
  #sobre.carta:not(.r-comun) .sb-aura { animation: sbAura 1.6s ease-in-out .2s infinite alternate both; }
  #sobre.r-raro.carta .sb-carta { filter: drop-shadow(0 0 14px var(--l1)); }
  #sobre.r-epico.carta .sb-carta, #sobre.r-legendario.carta .sb-carta { filter: drop-shadow(0 0 18px var(--l1)) drop-shadow(0 0 40px var(--l1)); }
  #sobre .sb-rayos { position: absolute; left: 50%; top: 42%; width: 200vmax; height: 200vmax; margin: -100vmax 0 0 -100vmax; opacity: 0; transition: opacity .6s; pointer-events: none;
    background: repeating-conic-gradient(from 0deg, var(--l1) 0deg 6deg, transparent 6deg 20deg); -webkit-mask: radial-gradient(circle, #000 5%, transparent 55%); mask: radial-gradient(circle, #000 5%, transparent 55%); }
  #sobre.r-epico.carta .sb-rayos, #sobre.r-legendario.carta .sb-rayos, #sobre.gira .sb-rayos { opacity: .35; animation: sbGira 14s linear infinite; }
  /* la legendaria: una columna de luz dorada cae sobre la carta */
  #sobre .sb-haz { position: absolute; left: 50%; top: -10%; bottom: -10%; width: calc(var(--cw) * .9); margin-left: calc(var(--cw) * -.45); opacity: 0; pointer-events: none;
    background: linear-gradient(90deg, transparent, rgba(255,243,196,.35) 30%, rgba(255,255,255,.7) 50%, rgba(255,243,196,.35) 70%, transparent); filter: blur(6px); transform-origin: 50% 0; }
  #sobre.r-legendario.carta .sb-haz { animation: sbHaz .9s cubic-bezier(.2,.8,.3,1) .15s both; }
  /* dorso genérico: el lugar no se ve hasta que la carta se da la vuelta */
  #sobre .sb-dorso { position: absolute; inset: 0; border-radius: 4.5% / 3.3%; display: grid; place-items: center; align-content: center; gap: 6%; overflow: hidden;
    background: radial-gradient(circle at 50% 40%, #1d3b62, #0f1e33 70%); box-shadow: inset 0 0 0 calc(var(--cw) * .022) #0f1e33, inset 0 0 0 calc(var(--cw) * .028) #d4af5a, inset 0 0 0 calc(var(--cw) * .05) #0f1e33, inset 0 0 0 calc(var(--cw) * .053) rgba(212,175,90,.45); }
  #sobre .sb-dorso .sb-sello { width: 46%; }
  #sobre .sb-dorso b { font: 400 calc(var(--cw) * .085) Georgia, 'Noto Serif', serif; color: #ede6d6; letter-spacing: .02em; }
  /* la vuelta: destello del color de la rareza y la carta gira */
  #sobre .sb-destello { position: absolute; inset: 0; z-index: 5; pointer-events: none; opacity: 0; background: radial-gradient(circle at 50% 45%, var(--l2) 0%, var(--l1) 30%, transparent 70%); }
  #sobre.gira .sb-destello { animation: sbDestello .9s ease-out forwards; }
  #sobre.gira .sb-carta { animation: sbVuelta .9s cubic-bezier(.3,1.2,.5,1) both; filter: drop-shadow(0 0 30px var(--l1)); }
  #sobre.gira .sb-flota2 { animation: none; }
  #sobre.gira .sb-dorso { animation: sbDorso .9s both; }
  #sobre.r-legendario.gira .sb-escena { animation: sbTiembla .5s .1s; }
  #sobre.shiny.gira .sb-carta { filter: drop-shadow(0 0 22px #ff2e88) drop-shadow(0 0 22px #22d3ee); }
  /* guía: una frase en cada momento */
  #sobre .sb-guia { position: absolute; left: 0; right: 0; bottom: calc(30px + env(safe-area-inset-bottom)); text-align: center; z-index: 4; height: 1.6em; }
  #sobre .sb-guia p { position: absolute; left: 0; right: 0; margin: 0 24px; font: italic 400 16px Georgia, 'Noto Serif', serif; color: rgba(237,230,214,.8); opacity: 0; transition: opacity .35s; }
  #sobre .sb-guia .g1 { opacity: 1; transition-delay: 1s; }
  #sobre.rasgando .sb-guia .g1, #sobre.abierto .sb-guia .g1 { opacity: 0; transition-delay: 0s; }
  #sobre.paso { background: transparent; transition: background .45s; }
  #sobre.paso .sb-rayos, #sobre.paso .sb-haz, #sobre.paso .sb-aura, #sobre.paso .sb-destello, #sobre.paso .sb-saltar, #sobre.paso .sb-guia { opacity: 0 !important; transition: opacity .35s; }
  html.pm-desde-sobre #tcg-view.show, html.pm-desde-sobre #tcg-view.show .tcg-stage-wrap { animation: none !important; }
  @keyframes sbLlega { 0% { transform: translateY(75vh) rotateX(50deg) rotateZ(-14deg) scale(.55); opacity: 0; } 40% { opacity: 1; } 100% { transform: none; } }
  @keyframes sbFlota { from { transform: translateY(0) rotateZ(-1.2deg); } to { transform: translateY(-10px) rotateZ(1.2deg); } }
  @keyframes sbSuelo { from { transform: scale(1); opacity: 1; } to { transform: scale(.88); opacity: .7; } }
  @keyframes sbMano { 0% { transform: translateX(calc(var(--cw) * -.4)); opacity: 0; } 15% { opacity: 1; } 85% { opacity: 1; } 100% { transform: translateX(calc(var(--cw) * .4)); opacity: 0; } }
  @keyframes sbSacude { 25% { transform: rotate(-4deg); } 50% { transform: rotate(4deg); } 75% { transform: rotate(-2deg); } }
  @keyframes sbVuela { to { transform: translate(140px, -200px) rotate(-60deg); opacity: 0; } }
  @keyframes sbFlota2 { from { transform: translateY(0); } to { transform: translateY(-8px); } }
  @keyframes sbFoil { 0% { background-position: 100% 0; } 55%, 100% { background-position: 0% 0; } }
  @keyframes sbCarga { 0% { transform: none; } 20% { transform: translate(-1px, 1px) rotate(-.6deg) scale(1.01); } 40% { transform: translate(2px, -1px) rotate(1deg) scale(1.025); }
    55% { transform: translate(-3px, 2px) rotate(-1.6deg) scale(1.04); } 70% { transform: translate(4px, -2px) rotate(2.2deg) scale(1.06); } 85% { transform: translate(-5px, 3px) rotate(-3deg) scale(1.08); } 100% { transform: translate(0, -4px) scale(1.12); } }
  @keyframes sbEstalla { to { transform: scale(1.35); opacity: 0; filter: brightness(3) blur(4px); } }
  @keyframes sbFlash { 0% { opacity: 0; } 12% { opacity: 1; } 100% { opacity: 0; } }
  @keyframes sbOnda { 0% { transform: scale(.2); opacity: 1; } 100% { transform: scale(4.5); opacity: 0; } }
  @keyframes sbSale { 0% { transform: translateY(12%) scale(.25) rotate(-18deg); opacity: 0; } 60% { opacity: 1; } 100% { transform: none; } }
  @keyframes sbAura { from { opacity: .45; transform: scale(.92); } to { opacity: .85; transform: scale(1.05); } }
  @keyframes sbHaz { 0% { opacity: 0; transform: scaleY(0); } 40% { opacity: 1; } 100% { opacity: .55; transform: scaleY(1); } }
  @keyframes sbDestello { 0% { opacity: 0; } 15% { opacity: .85; } 100% { opacity: 0; } }
  @keyframes sbGira { to { transform: rotate(360deg); } }
  @keyframes sbHolo { to { background-position: -300% 0; } }
  @keyframes sbVuelta { 0% { transform: scale(1) rotateY(0); } 45% { transform: scale(1.16) rotateY(90deg); } 100% { transform: scale(1.1) rotateY(0); } }
  @keyframes sbDorso { 0%, 44% { opacity: 1; } 46%, 100% { opacity: 0; } }
  @keyframes sbTiembla { 20% { transform: translate(-6px, 3px); } 40% { transform: translate(5px, -4px); } 60% { transform: translate(-4px, 2px); } 80% { transform: translate(3px, -1px); } }
  @media (prefers-reduced-motion: reduce) { #sobre *, #sobre.carta .sb-rayos { animation: none !important; } }`;
  document.head.appendChild(css);

  return { abrir };
})();
