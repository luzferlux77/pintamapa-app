// PintaMapa — fiestas al subir de nivel (petición del usuario, 12-nov-2026: «muy viral, generador de dopamina para seguir»).
//   · HITO: cada 10 niveles (10, 20… 90, y dentro de cada rango Bronce 10, 20… 100). Pantalla de fiesta: el número sube con un
//     golpe, rayos de luz, fuegos artificiales, confeti, el camino de hitos y «Presumir» (imagen para compartir).
//   · RANGO: al pasar a Bronce (99 → Bronce 1), a Plata, Oro, Platino, Diamante y Master. Lo mismo pero épico: fogonazo,
//     medalla metálica del color del rango que cae y rebota con brillo, ondas, temblor, fuegos en sus colores, fanfarria
//     larga y la escalera de rangos con el tuyo encendido.
// Se carga solo cuando hace falta (PM.need('js/fiesta.js')). Todas sus animaciones viven mientras la fiesta está en pantalla:
// al cerrarla se quita todo (nada de animaciones infinitas en el mapa: gastan batería).
PM.fiesta = (function () {
  const esc = (s) => PM.esc(String(s == null ? '' : s));
  const reduce = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } })();
  // colores de cada rango: [principal, claro, oscuro]
  const PALETA = {
    Bronce: ['#cd7f32', '#f3c08e', '#7a4316'], Plata: ['#b9c1cc', '#ffffff', '#6b7480'], Oro: ['#f5c400', '#fff1a6', '#a77700'],
    Platino: ['#3fb8a8', '#c8fff4', '#17695f'], Diamante: ['#3b9cff', '#d6ecff', '#1747a6'], Master: ['#ff2e88', '#ffd1e6', '#7c1fd6'],
  };
  // niveles normales: cada decena con su color (10 turquesa, 20 violeta, 30 azul…), para que cada hito sea distinto
  const DECENAS = [['#14b8a6', '#99f6e4', '#115e59'], ['#8b5cf6', '#ddd6fe', '#4c1d95'], ['#2563eb', '#93c5fd', '#1e3a8a'], ['#f97316', '#fed7aa', '#9a3412'],
    ['#ec4899', '#fbcfe8', '#9d174d'], ['#22c55e', '#bbf7d0', '#14532d'], ['#ef4444', '#fecaca', '#991b1b'], ['#06b6d4', '#a5f3fc', '#155e75'], ['#eab308', '#fef08a', '#854d0e']];

  // ---------- fuegos artificiales y confeti (un lienzo, solo mientras dura la fiesta) ----------
  function fuegos(cv, cols, o = {}) {
    const dpr = Math.min(2, devicePixelRatio || 1), W = innerWidth, H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    const x = cv.getContext('2d'); x.scale(dpr, dpr);
    const parts = [], cohetes = [], fin = performance.now() + (o.ms || 6000);
    let vivo = true, last = performance.now(), sigCohete = 0;
    const col = () => cols[Math.floor(Math.random() * cols.length)];
    const estalla = (px, py, n, c) => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.2, v = (o.fuerte ? 5 : 3.6) * (0.55 + Math.random() * 0.6);
        parts.push({ x: px, y: py, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 0.05, life: 1, dec: 0.011 + Math.random() * 0.008, c: Math.random() < 0.25 ? '#ffffff' : c, s: 2 + Math.random() * 2, chispa: Math.random() < 0.3 });
      }
    };
    const confeti = (n) => { for (let i = 0; i < n; i++) parts.push({ x: Math.random() * W, y: -10 - Math.random() * H * 0.4, vx: (Math.random() - 0.5) * 2, vy: 1.5 + Math.random() * 2.5, g: 0.03, life: 1, dec: 0.0035, c: col(), s: 5 + Math.random() * 5, conf: true, r: Math.random() * 6 }); };
    confeti(reduce ? 40 : o.fuerte ? 170 : 110);
    function frame(now) {
      if (!vivo) return;
      const k = Math.min(3, (now - last) / 16.7); last = now;
      if (now < fin && now > sigCohete && !reduce) {
        sigCohete = now + (o.fuerte ? 260 : 420) + Math.random() * 300;
        cohetes.push({ x: W * (0.15 + Math.random() * 0.7), y: H + 10, vy: -(7 + Math.random() * 3.5) * (H / 800), top: H * (0.15 + Math.random() * 0.3), c: col() });
      }
      x.clearRect(0, 0, W, H);
      for (let i = cohetes.length - 1; i >= 0; i--) {
        const r = cohetes[i]; r.y += r.vy * k;
        x.fillStyle = '#fff'; x.globalAlpha = 0.9; x.fillRect(r.x - 1, r.y, 2, 9);
        if (r.y <= r.top) { estalla(r.x, r.y, o.fuerte ? 90 : 60, r.c); cohetes.splice(i, 1); }
      }
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.vy += p.g * k; p.vx *= p.conf ? 1 : Math.pow(0.985, k); p.x += (p.vx + (p.conf ? Math.sin((now / 300) + p.r) * 0.6 : 0)) * k; p.y += p.vy * k; p.life -= p.dec * k;
        if (p.life <= 0 || p.y > H + 20) { parts.splice(i, 1); continue; }
        x.globalAlpha = Math.max(0, Math.min(1, p.life * (p.chispa ? 0.6 + Math.random() * 0.4 : 1)));
        x.fillStyle = p.c;
        if (p.conf) { x.save(); x.translate(p.x, p.y); x.rotate(p.r + now / 400); x.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); x.restore(); }
        else { x.beginPath(); x.arc(p.x, p.y, p.s * Math.max(0.3, p.life), 0, Math.PI * 2); x.fill(); }
      }
      x.globalAlpha = 1;
      if (now < fin || parts.length || cohetes.length) requestAnimationFrame(frame); else vivo = false;
    }
    requestAnimationFrame(frame);
    return () => { vivo = false; };
  }

  // ---------- sonido y vibración ----------
  function sonido(tipo) {
    const S = PM.sound; if (!S || !S.enabled) return;
    const t = (f, d, w, v, at, sl) => S.tone(f, d, w, v, at, sl);
    if (tipo === 'rango') {
      t(140, 0.5, 'sine', 0.16, 0, 40);   // golpe grave
      [262, 330, 392, 523].forEach((f, i) => t(f, 0.28, 'sawtooth', 0.045, 0.25 + i * 0.12));
      [523, 659, 784, 1046].forEach((f) => t(f, 1.1, 'triangle', 0.05, 0.8));   // acorde final
      [1568, 2093, 2637, 3136].forEach((f, i) => t(f, 0.18, 'sine', 0.025, 1.0 + i * 0.09));   // brillo
    } else {
      [523, 659, 784, 1046, 1318].forEach((f, i) => t(f, 0.2, 'square', 0.04, i * 0.08));
      [784, 988, 1175].forEach((f) => t(f, 0.7, 'triangle', 0.045, 0.45));
    }
  }

  // ---------- imagen para compartir (1080×1350, como un post) ----------
  function imagen(d) {
    const W = 1080, H = 1350, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const x = cv.getContext('2d'), [c1, c2, c3] = d.pal;
    const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, c3); g.addColorStop(0.55, c1); g.addColorStop(1, c2);
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    // rayos
    x.save(); x.translate(W / 2, 560); x.globalAlpha = 0.13; x.fillStyle = '#fff';
    for (let i = 0; i < 18; i++) { x.rotate(Math.PI / 9); x.beginPath(); x.moveTo(0, 0); x.lineTo(-60, -900); x.lineTo(60, -900); x.closePath(); x.fill(); }
    x.restore();
    const font = (w, s) => `${w} ${s}px Inter, system-ui, sans-serif`;
    x.textAlign = 'center'; x.fillStyle = '#fff';
    x.font = font(800, 46); x.globalAlpha = 0.9; x.fillText(d.rango ? PM.t('¡NUEVO RANGO!') : PM.t('¡NUEVO HITO!'), W / 2, 200); x.globalAlpha = 1;
    if (d.rango) {
      // medalla
      const R = 230, cx = W / 2, cy = 560, m = x.createRadialGradient(cx - 70, cy - 90, 20, cx, cy, R);
      m.addColorStop(0, c2); m.addColorStop(0.55, c1); m.addColorStop(1, c3);
      x.beginPath(); x.arc(cx, cy, R + 18, 0, Math.PI * 2); x.fillStyle = 'rgba(255,255,255,.35)'; x.fill();
      x.beginPath(); x.arc(cx, cy, R, 0, Math.PI * 2); x.fillStyle = m; x.fill();
      x.font = font(400, 230); x.textBaseline = 'middle'; x.fillText(d.icono, cx, cy + 10); x.textBaseline = 'alphabetic';
      x.font = font(900, 120); x.fillText(String(d.titulo).toUpperCase(), W / 2, 950);
    } else {
      x.font = font(900, 360); x.shadowColor = 'rgba(0,0,0,.25)'; x.shadowBlur = 30; x.fillText(d.numero, W / 2, 700); x.shadowBlur = 0;
      x.font = font(800, 84); x.fillText(d.titulo, W / 2, 860);
    }
    x.font = font(600, 46); x.globalAlpha = 0.95; x.fillText(d.quien, W / 2, d.rango ? 1040 : 950);
    x.font = font(500, 40); x.fillText(d.cifras, W / 2, d.rango ? 1110 : 1020); x.globalAlpha = 1;
    x.fillStyle = 'rgba(0,0,0,.22)'; x.fillRect(0, H - 150, W, 150);
    x.fillStyle = '#fff'; x.font = font(900, 64); x.fillText('PintaMapa', W / 2, H - 70);
    x.font = font(500, 32); x.globalAlpha = 0.85; x.fillText(PM.t('Pinta tu ciudad andando'), W / 2, H - 28); x.globalAlpha = 1;
    return cv.toDataURL('image/png');
  }
  async function compartir(d) {
    const url = imagen(d), nombre = 'PintaMapa-' + (d.rango ? d.titulo : 'nivel-' + d.numero).replace(/\s+/g, '-');
    const texto = d.rango ? PM.t('¡Ya soy {r} en PintaMapa! 🖌️ Pinto mi ciudad andando', { r: d.titulo }) : PM.t('¡Nivel {n} en PintaMapa! 🖌️ Pinto mi ciudad andando', { n: d.titulo });
    try {
      if (PM.isNative && window.Capacitor.Plugins.Filesystem && window.Capacitor.Plugins.Share) {
        const f = await window.Capacitor.Plugins.Filesystem.writeFile({ path: nombre + '.png', data: url.split(',')[1], directory: 'CACHE' });
        await window.Capacitor.Plugins.Share.share({ title: 'PintaMapa', text: texto, files: [f.uri] }).catch(() => {});
        return;
      }
      if (navigator.canShare) {
        const file = new File([await (await fetch(url)).blob()], nombre + '.png', { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text: texto }).catch(() => {}); return; }
      }
      const a = document.createElement('a'); a.href = url; a.download = nombre + '.png'; a.click();
    } catch (e) { /* sin compartir: no pasa nada */ }
  }

  // ---------- la fiesta ----------
  let abierta = null;
  // h: { tipo: 'hito'|'rango', nivel }; ctx: { nombre, km, lugares, barrios, colores: [{c, name}], enPaseo }
  function mostrar(h, ctx = {}) {
    if (abierta) abierta();
    const nm = PM.levelName(h.nivel), rango = h.tipo === 'rango', tier = nm.tier;
    const pal = tier ? PALETA[tier.name] || DECENAS[2] : DECENAS[(Math.max(1, Math.floor(h.nivel / 10)) - 1) % DECENAS.length];
    const numero = nm.short, titulo = rango ? tier.name : (tier ? nm.label : PM.t('Nivel {n}', { n: nm.label }));
    const cifras = [ctx.km ? PM.fmtDist(ctx.km) + ' ' + PM.t('pintados') : '', ctx.lugares ? ctx.lugares + ' ' + PM.t('lugares') : '', ctx.barrios ? ctx.barrios + ' ' + PM.t('barrios') : ''].filter(Boolean).join(' · ');
    const d = { rango, numero, titulo, icono: tier ? tier.icon : '⭐', pal, quien: ctx.nombre || 'PintaMapa', cifras };
    // camino: los hitos de alrededor (hito) o la escalera de rangos (rango)
    let camino = '';
    if (rango) {
      const ti = PM.LEVEL_TIERS.indexOf(tier);
      camino = `<div class="fz-escalera">${[{ icon: '⭐', name: PM.t('Normal') }].concat(PM.LEVEL_TIERS).map((t, i) => `<span class="${i - 1 < ti ? 'ok' : ''} ${i - 1 === ti ? 'aqui' : ''}"><i>${t.icon}</i><small>${esc(t.name)}</small></span>`).join('')}</div>`;
    } else {
      const n = Number(nm.short);
      const marcas = []; for (let k = n - 20; k <= n + 20; k += 10) if (k >= 10 && k <= (nm.tier ? 100 : 90)) marcas.push(k);
      camino = `<div class="fz-camino">${marcas.map((k) => `<span class="${k < n ? 'ok' : k === n ? 'aqui' : ''}"><b>${k}</b></span>`).join('<i></i>')}</div>`;
    }
    const sig = rango ? null : (() => { const n = Number(nm.short), tope = nm.tier ? 100 : 90; return n + 10 <= tope ? n + 10 : null; })();
    const nuevoColor = (ctx.colores || [])[0];
    const ov = document.createElement('div');
    ov.id = 'fiesta'; ov.className = rango ? 'fz-rango' : 'fz-hito';
    ov.style.setProperty('--c1', pal[0]); ov.style.setProperty('--c2', pal[1]); ov.style.setProperty('--c3', pal[2]);
    ov.innerHTML = `<canvas class="fz-cv"></canvas><div class="fz-rayos"></div>${rango ? '<div class="fz-flash"></div><div class="fz-onda"></div><div class="fz-onda o2"></div>' : ''}
      <div class="fz-in">
        <div class="fz-kicker">${rango ? PM.t('¡NUEVO RANGO!') : PM.t('¡NUEVO HITO!')}</div>
        ${rango ? `<div class="fz-medalla"><div class="fz-brillo"></div><span>${tier.icon}</span></div><div class="fz-tit grande">${esc(tier.name.toUpperCase())}</div>
          <div class="fz-sub">${h.nivel === 100 ? PM.t('Dejas atrás los niveles normales: empieza tu camino de rangos') : PM.t('Has subido de rango. Muy pocos pintores llegan aquí.')}</div>`
          : `<div class="fz-num">${esc(numero)}</div><div class="fz-tit">${esc(titulo)}</div>`}
        ${cifras ? `<div class="fz-cifras">${esc(cifras)}</div>` : ''}
        ${nuevoColor ? `<div class="fz-color"><i style="background:${nuevoColor.c}"></i>${PM.t('Nuevo color')}: <b>${esc(nuevoColor.name)}</b></div>` : ''}
        ${camino}
        <div class="fz-bot"><button class="fz-share">📤 ${PM.t('Presumir')}</button><button class="fz-go">${sig ? PM.t('¡A por el {n}!', { n: sig }) : PM.t('¡A seguir pintando!')}</button></div>
      </div>`;
    document.body.appendChild(ov);
    const parar = fuegos(ov.querySelector('.fz-cv'), [pal[0], pal[1], '#ffffff', '#facc15', '#22d3ee', '#ff2e88'], { fuerte: rango, ms: rango ? 7000 : 4500 });
    sonido(rango ? 'rango' : 'hito');
    PM.vibrate(rango ? [60, 40, 60, 40, 120, 80, 400] : [50, 40, 50, 40, 200]);
    requestAnimationFrame(() => ov.classList.add('on'));
    let cerrado = false;
    const cerrar = () => { if (cerrado) return; cerrado = true; parar(); ov.classList.add('out'); setTimeout(() => ov.remove(), 350); abierta = null; };
    abierta = cerrar;
    ov.querySelector('.fz-go').addEventListener('click', cerrar);
    ov.querySelector('.fz-share').addEventListener('click', (e) => { e.stopPropagation(); compartir(d); });
    // paseando (el móvil en la mano): un hito se va solo a los 9 s para no tapar el mapa mucho rato; un rango espera
    if (ctx.enPaseo && !rango) setTimeout(cerrar, 9000);
  }

  // ---------- estilos (solo existen mientras se usa: la hoja va con el módulo) ----------
  const css = document.createElement('style');
  css.textContent = `
  #fiesta { position: fixed; inset: 0; z-index: 5000; display: flex; align-items: center; justify-content: center; overflow: hidden; opacity: 0; transition: opacity .3s; font-family: Inter, system-ui, sans-serif; color: #fff;
    background: #0b1020; background: radial-gradient(circle at 50% 40%, color-mix(in srgb, var(--c1) 70%, #000) 0%, #0b1020 75%); }
  #fiesta.on { opacity: 1; } #fiesta.out { opacity: 0; }
  #fiesta .fz-cv { position: absolute; inset: 0; pointer-events: none; z-index: 2; }
  #fiesta .fz-rayos { position: absolute; left: 50%; top: 40%; width: 220vmax; height: 220vmax; margin: -110vmax 0 0 -110vmax; opacity: .22;
    background: repeating-conic-gradient(from 0deg, var(--c2) 0deg 7deg, transparent 7deg 22deg); animation: fzGira 18s linear infinite; mask: radial-gradient(circle, #000 10%, transparent 60%); -webkit-mask: radial-gradient(circle, #000 10%, transparent 60%); }
  #fiesta .fz-in { position: relative; z-index: 3; text-align: center; padding: 24px 22px calc(24px + env(safe-area-inset-bottom)); width: min(420px, 100%); }
  #fiesta .fz-kicker { font-weight: 900; letter-spacing: .18em; font-size: 15px; color: var(--c2); text-shadow: 0 0 18px var(--c1); animation: fzSube .5s .1s both; }
  #fiesta .fz-num { font-size: clamp(110px, 38vw, 170px); font-weight: 900; line-height: 1; margin: 6px 0 2px; background: linear-gradient(180deg, #fff 20%, var(--c2) 60%, var(--c1));
    -webkit-background-clip: text; background-clip: text; color: transparent; filter: drop-shadow(0 6px 24px color-mix(in srgb, var(--c1) 70%, transparent)); animation: fzGolpe .7s cubic-bezier(.2,1.6,.4,1) .15s both; }
  #fiesta .fz-tit { font-size: 26px; font-weight: 900; animation: fzSube .5s .45s both; }
  #fiesta .fz-tit.grande { font-size: clamp(40px, 13vw, 58px); letter-spacing: .06em; margin-top: 10px; background: linear-gradient(90deg, var(--c2), #fff, var(--c1), #fff, var(--c2)); background-size: 300% 100%;
    -webkit-background-clip: text; background-clip: text; color: transparent; animation: fzSube .5s 1s both, fzMetal 3s 1.4s linear infinite; }
  #fiesta .fz-sub { font-size: 15px; opacity: .9; margin-top: 6px; animation: fzSube .5s 1.2s both; }
  #fiesta .fz-cifras { margin-top: 14px; font-size: 15px; font-weight: 600; opacity: .95; animation: fzSube .5s .7s both; }
  #fiesta .fz-color { margin-top: 10px; font-size: 14px; animation: fzSube .5s .8s both; } #fiesta .fz-color i { display: inline-block; width: 14px; height: 14px; border-radius: 50%; vertical-align: -2px; margin-right: 6px; box-shadow: 0 0 0 2px #fff; }
  #fiesta .fz-camino { display: flex; align-items: center; justify-content: center; margin: 22px 0 6px; animation: fzSube .5s .9s both; }
  #fiesta .fz-camino > i { width: 26px; height: 3px; background: rgba(255,255,255,.35); }
  #fiesta .fz-camino span { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; font-size: 13px; background: rgba(255,255,255,.12); border: 2px solid rgba(255,255,255,.3); }
  #fiesta .fz-camino span.ok { background: var(--c1); border-color: var(--c2); }
  #fiesta .fz-camino span.aqui { width: 52px; height: 52px; font-size: 17px; background: #fff; color: var(--c3); border-color: var(--c2); box-shadow: 0 0 0 6px color-mix(in srgb, var(--c2) 45%, transparent), 0 0 28px var(--c2); }
  #fiesta .fz-escalera { display: flex; justify-content: center; gap: 4px; margin: 22px 0 6px; animation: fzSube .5s 1.4s both; }
  #fiesta .fz-escalera span { flex: 1; max-width: 54px; opacity: .35; filter: grayscale(1); } #fiesta .fz-escalera span i { display: block; font-style: normal; font-size: 24px; }
  #fiesta .fz-escalera span small { font-size: 10.5px; } #fiesta .fz-escalera span.ok { opacity: .85; filter: none; }
  #fiesta .fz-escalera span.aqui { opacity: 1; transform: scale(1.3); filter: drop-shadow(0 0 10px var(--c2)); }
  #fiesta .fz-bot { display: flex; gap: 10px; margin-top: 26px; animation: fzSube .5s 1.1s both; }
  #fiesta .fz-bot button { flex: 1; min-height: 50px; border-radius: 16px; border: 0; font: 800 16px Inter, system-ui, sans-serif; cursor: pointer; }
  #fiesta .fz-share { background: rgba(255,255,255,.16); color: #fff; box-shadow: inset 0 0 0 2px rgba(255,255,255,.5); }
  #fiesta .fz-go { background: #fff; color: var(--c3); box-shadow: 0 8px 24px rgba(0,0,0,.3); }
  /* rango: fogonazo, ondas, medalla que cae, brillo y temblor */
  #fiesta .fz-flash { position: absolute; inset: 0; z-index: 4; background: #fff; pointer-events: none; animation: fzFlash .7s .25s both; }
  #fiesta .fz-onda { position: absolute; left: 50%; top: 34%; width: 40px; height: 40px; margin: -20px 0 0 -20px; border-radius: 50%; border: 6px solid var(--c2); z-index: 1; animation: fzOnda 1.4s .55s ease-out both; }
  #fiesta .fz-onda.o2 { animation-delay: .85s; border-color: #fff; }
  #fiesta .fz-medalla { position: relative; width: 170px; height: 170px; margin: 12px auto 0; border-radius: 50%; display: grid; place-items: center; overflow: hidden;
    background: radial-gradient(circle at 32% 28%, var(--c2), var(--c1) 55%, var(--c3)); box-shadow: 0 0 0 8px rgba(255,255,255,.25), 0 0 60px var(--c1), inset 0 -10px 30px rgba(0,0,0,.35);
    animation: fzCae .9s cubic-bezier(.25,1.5,.45,1) .35s both; }
  #fiesta .fz-medalla span { font-size: 92px; filter: drop-shadow(0 4px 10px rgba(0,0,0,.35)); }
  #fiesta .fz-brillo { position: absolute; inset: -40%; background: linear-gradient(115deg, transparent 40%, rgba(255,255,255,.75) 50%, transparent 60%); animation: fzBrillo 2.6s 1.2s ease-in-out infinite; }
  #fiesta.fz-rango.on .fz-in { animation: fzTiembla .45s .6s both; }
  @keyframes fzGira { to { transform: rotate(360deg); } }
  @keyframes fzSube { from { opacity: 0; transform: translateY(16px); } }
  @keyframes fzGolpe { 0% { opacity: 0; transform: scale(3); } 60% { opacity: 1; } 100% { transform: scale(1); } }
  @keyframes fzMetal { to { background-position: 300% 0; } }
  @keyframes fzFlash { 0% { opacity: 0; } 15% { opacity: .95; } 100% { opacity: 0; } }
  @keyframes fzOnda { from { transform: scale(1); opacity: .9; } to { transform: scale(22); opacity: 0; } }
  @keyframes fzCae { 0% { opacity: 0; transform: translateY(-60vh) scale(1.6) rotate(-25deg); } 70% { opacity: 1; } 100% { transform: none; } }
  @keyframes fzBrillo { 0% { transform: translateX(-60%); } 60%, 100% { transform: translateX(60%); } }
  @keyframes fzTiembla { 0%, 100% { transform: none; } 20% { transform: translate(-6px, 3px); } 40% { transform: translate(5px, -4px); } 60% { transform: translate(-4px, 2px); } 80% { transform: translate(3px, -1px); } }
  @media (prefers-reduced-motion: reduce) { #fiesta *, #fiesta.on .fz-in { animation-duration: .01s !important; animation-iteration-count: 1 !important; } #fiesta .fz-rayos { display: none; } }`;
  document.head.appendChild(css);

  return { mostrar, imagen, cerrar: () => abierta && abierta() };
})();
