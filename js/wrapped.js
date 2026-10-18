// PintaMapa — «Tu semana pintando»: resumen animado de los últimos 7 días (estilo stories, vertical 720×1280),
// se ve dentro de la app y se exporta a MP4 para compartir.
PM.wrapped = (function () {
  const W = 720, H = 1280, FPS = 30, DUR = 17;   // segundos
  const SCENES = [[0, 2.8], [2.8, 7.4], [7.4, 10.8], [10.8, 14], [14, 17]];
  const ease = (t) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
  const clamp01 = (t) => Math.max(0, Math.min(1, t));
  const RC = { comun: '#9aa4b2', raro: '#3fa9ff', epico: '#b65cff', legendario: '#ffb700' };
  const RN = { comun: 'Común', raro: 'Rara', epico: 'Épica', legendario: 'Legendaria' };

  // ---------- datos de la semana ----------
  function weekData(S, Wd) {
    const s = S(), DAY = 86400000, now = Date.now(), from = now - 7 * DAY;
    const walks = (s.walks || []).filter((w) => w.start >= from);
    const sum = (f) => walks.reduce((a, w) => a + (f(w) || 0), 0);
    const lms = Object.entries(s.landmarks || {}).filter(([, v]) => v.t >= from).map(([id, v]) => Object.assign({ id }, v));
    const rank = { legendario: 4, epico: 3, raro: 2, comun: 1 };
    lms.sort((a, b) => (b.shiny ? 10 : 0) + rank[b.rarity] - ((a.shiny ? 10 : 0) + rank[a.rarity]));
    const tracks = walks.map((w) => (w.track || []).filter(Boolean).map((q) => [q[0], q[1]])).filter((t) => t.length > 1);
    const days = new Set(walks.map((w) => new Date(w.start).toDateString())).size;
    const barrios = Object.values(s.barrioCards || {}).filter((b) => b.t >= from).length;
    // calles pintadas (todas, en gris suave de fondo) dentro de la zona de la semana
    const painted = [];
    for (const id in s.painted) { const pc = Wd.pieces[id]; if (pc) painted.push(pc.pts); }
    return { s, walks, from, to: now, walked: sum((w) => w.st.walked), painted: sum((w) => w.st.painted), ms: sum((w) => PM.movingMs(w)), pts: sum((w) => w.st.pts),
      best: lms[0] || null, nCards: lms.length, tracks, paintedAll: painted, days, barrios, streak: s.stats.streak || 0, lvl: PM.levelInfo(s.xp), color: s.color || '#2563eb' };
  }
  function loadImg(src) { return new Promise((r) => { if (!src) return r(null); const im = new Image(); im.onload = () => r(im); im.onerror = () => r(null); im.src = src; }); }
  async function assets(D) {
    return { avatar: await loadImg(D.s.avatar) };
  }

  // ---------- dibujo ----------
  function bg(c, D, a, b) {
    const g = c.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, a || D.color); g.addColorStop(1, b || '#111827');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
  }
  function text(c, s, x, y, size, opts = {}) {
    c.font = `${opts.w || 800} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    c.fillStyle = opts.c || '#fff'; c.textAlign = opts.a || 'center'; c.textBaseline = 'middle';
    c.globalAlpha = opts.o == null ? 1 : opts.o; c.fillText(s, x, y); c.globalAlpha = 1;
  }
  const km = (m) => (m / 1000).toFixed(m >= 10000 ? 1 : 2).replace('.', ',') + ' km';
  const dmy = (t) => new Date(t).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  function confettiBits(c, t, D, n = 40) {
    for (let i = 0; i < n; i++) {
      const x = (i * 137.5 % W), y = ((i * 89 + t * 260) % (H + 60)) - 30, r = (i % 5) + 4;
      c.fillStyle = [D.color, '#facc15', '#22d3ee', '#f472b6', '#fff'][i % 5]; c.globalAlpha = 0.55;
      c.save(); c.translate(x, y); c.rotate(t * 3 + i); c.fillRect(-r, -r / 2, r * 2, r); c.restore();
    }
    c.globalAlpha = 1;
  }
  // tu foto de perfil en un círculo (o un pincel gigante) que bota
  function dogAt(c, A, x, y, size, t, bounce) {
    const b = bounce ? Math.abs(Math.sin(t * 5)) * 16 : 0, r = size * 0.42, cy = y - size * 0.6 - b;
    if (A.avatar) {
      c.save(); c.beginPath(); c.arc(x, cy, r, 0, 7); c.closePath(); c.fillStyle = '#fff'; c.shadowColor = 'rgba(0,0,0,.35)'; c.shadowBlur = 24; c.fill(); c.restore();
      c.save(); c.beginPath(); c.arc(x, cy, r - 8, 0, 7); c.clip(); c.drawImage(A.avatar, x - r + 8, cy - r + 8, (r - 8) * 2, (r - 8) * 2); c.restore();
    } else text(c, '🖌️', x, cy, size * 0.6);
  }
  // escena 1: portada
  function s1(c, t, D, A) {
    bg(c, D);
    confettiBits(c, t, D, 30);
    const e = ease(t / 1.2);
    text(c, 'TU SEMANA', W / 2, 330 - (1 - e) * 60, 64, { o: e, w: 900 });
    text(c, 'PINTANDO', W / 2, 410 - (1 - e) * 60, 88, { o: e, w: 900 });
    text(c, `${dmy(D.from)} – ${dmy(D.to)}`, W / 2, 490, 34, { o: ease((t - 0.4) / 1), w: 600 });
    dogAt(c, A, W / 2, 1000, 330 * ease((t - 0.3) / 1), t, true);
    text(c, (D.s.player || (PM.player && PM.player.name) || 'Pintor') + ' · PintaMapa', W / 2, 1180, 30, { o: 0.85, w: 600 });
  }
  // escena 2: mapa de la semana dibujándose
  function s2(c, t, D) {
    bg(c, D, '#0f172a', '#1e293b');
    text(c, 'Tus calles de la semana', W / 2, 120, 46);
    const all = D.tracks.flat();
    if (!all.length) { text(c, 'Esta semana no saliste a pintar…', W / 2, H / 2, 38, { w: 600 }); text(c, '¡Tu perro te espera! 🐾', W / 2, H / 2 + 60, 34, { w: 600, o: 0.8 }); return; }
    let a = 90, b = -90, l = 180, r = -180;
    all.forEach((q) => { a = Math.min(a, q[0]); b = Math.max(b, q[0]); l = Math.min(l, q[1]); r = Math.max(r, q[1]); });
    const k = Math.cos((a + b) / 2 * Math.PI / 180), bx = 60, by = 200, bw = W - 120, bh = 900;
    const sx = Math.max(1e-6, (r - l) * k), sy = Math.max(1e-6, b - a), sc = Math.min(bw / sx, bh / sy) * 0.9;
    const ox = bx + (bw - sx * sc) / 2, oy = by + (bh - sy * sc) / 2;
    const P = (q) => [ox + (q[1] - l) * k * sc, oy + (b - q[0]) * sc];
    c.save(); c.beginPath(); c.roundRect ? c.roundRect(bx - 10, by - 10, bw + 20, bh + 20, 28) : c.rect(bx - 10, by - 10, bw + 20, bh + 20); c.fillStyle = 'rgba(255,255,255,.05)'; c.fill(); c.clip();
    // calles ya pintadas (fondo)
    c.strokeStyle = 'rgba(255,255,255,.16)'; c.lineWidth = 3; c.lineCap = 'round';
    for (const pts of D.paintedAll) { const p0 = P(pts[0]); if (p0[0] < bx - 50 || p0[0] > bx + bw + 50 || p0[1] < by - 50 || p0[1] > by + bh + 50) continue; c.beginPath(); pts.forEach((q, i) => { const [x, y] = P(q); i ? c.lineTo(x, y) : c.moveTo(x, y); }); c.stroke(); }
    // recorridos de la semana dibujándose
    const prog = ease(t / 3.6), total = all.length, upto = Math.floor(total * prog);
    let n = 0;
    c.strokeStyle = D.color; c.lineWidth = 9; c.lineJoin = 'round'; c.shadowColor = D.color; c.shadowBlur = 18;
    for (const tr of D.tracks) {
      if (n >= upto) break;
      c.beginPath();
      for (let i = 0; i < tr.length && n < upto; i++, n++) { const [x, y] = P(tr[i]); i ? c.lineTo(x, y) : c.moveTo(x, y); }
      c.stroke();
    }
    c.shadowBlur = 0; c.restore();
    text(c, `${D.walks.length} paseo${D.walks.length === 1 ? '' : 's'} · ${D.days} día${D.days === 1 ? '' : 's'} en la calle`, W / 2, 1180, 34, { w: 600, o: ease((t - 1) / 1) });
  }
  // escena 3: cifras que suben
  function s3(c, t, D) {
    bg(c, D, '#111827', D.color);
    text(c, 'En números', W / 2, 150, 50);
    const rows = [['🚶', km(D.walked * ease(t / 2)), 'andados'], ['🖌️', km(D.painted * ease((t - 0.3) / 2)), 'de calles nuevas'],
      ['⏱️', Math.round(D.ms / 60000 * ease((t - 0.6) / 2)) + ' min', 'en movimiento'], ['⭐', '+' + Math.round(D.pts * ease((t - 0.9) / 2)).toLocaleString('es-ES'), 'puntos']];
    rows.forEach(([ic, v, l], i) => {
      const y = 330 + i * 220, o = ease((t - i * 0.3) / 0.6);
      text(c, ic, 140, y, 70, { o });
      text(c, v, 230, y - 20, 76, { a: 'left', o, w: 900 });
      text(c, l, 232, y + 50, 32, { a: 'left', o: o * 0.8, w: 600 });
    });
  }
  // escena 4: la mejor carta
  function s4(c, t, D) {
    bg(c, D, '#1e1b4b', '#0f172a');
    text(c, D.best ? 'Tu mejor carta' : 'Esta semana', W / 2, 150, 50);
    if (!D.best) { text(c, D.barrios ? `🚩 ${D.barrios} barrio${D.barrios > 1 ? 's' : ''} conquistado${D.barrios > 1 ? 's' : ''}` : '🃏 Sin cartas nuevas', W / 2, H / 2, 46); text(c, 'Captura lugares quedándote 10 s junto a ellos', W / 2, H / 2 + 70, 28, { w: 500, o: 0.8 }); return; }
    const L = D.best, e = ease(t / 0.9), cw = 460, ch = 640, x = W / 2 - cw / 2, y = 260;
    c.save(); c.translate(W / 2, y + ch / 2); c.rotate((1 - e) * -0.5); c.scale(0.6 + 0.4 * e, 0.6 + 0.4 * e); c.translate(-W / 2, -(y + ch / 2));
    c.shadowColor = L.shiny ? '#facc15' : RC[L.rarity]; c.shadowBlur = 50;
    c.fillStyle = L.shiny ? '#facc15' : RC[L.rarity]; c.beginPath(); c.roundRect ? c.roundRect(x - 10, y - 10, cw + 20, ch + 20, 34) : c.rect(x - 10, y - 10, cw + 20, ch + 20); c.fill();
    c.shadowBlur = 0; c.fillStyle = '#fff'; c.beginPath(); c.roundRect ? c.roundRect(x, y, cw, ch, 26) : c.rect(x, y, cw, ch); c.fill();
    text(c, L.emoji || '📍', W / 2, y + 230, 180);
    text(c, (L.name || '').length > 22 ? L.name.slice(0, 21) + '…' : L.name, W / 2, y + 430, 38, { c: '#111827' });
    text(c, L.kind || '', W / 2, y + 480, 28, { c: '#6b7280', w: 600 });
    text(c, (L.shiny ? '✨ BRILLANTE · ' : '') + RN[L.rarity], W / 2, y + 560, 30, { c: L.shiny ? '#b45309' : RC[L.rarity] });
    if (L.shiny) { const sx = x + ((t * 400) % (cw + 200)) - 100; const g = c.createLinearGradient(sx - 80, 0, sx + 80, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,240,180,.6)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(x, y, cw, ch); }
    c.restore();
    if (D.nCards > 1) text(c, `y ${D.nCards - 1} carta${D.nCards > 2 ? 's' : ''} más esta semana`, W / 2, 1060, 32, { w: 600, o: ease((t - 1) / 1) });
  }
  // escena 5: despedida con racha, nivel y el perro
  function s5(c, t, D, A) {
    bg(c, D);
    confettiBits(c, t, D, 50);
    text(c, `🔥 ${D.streak} día${D.streak === 1 ? '' : 's'} de racha`, W / 2, 250, 52, { o: ease(t / 0.6) });
    text(c, `${D.lvl.tier ? D.lvl.tier.icon + ' ' : '⭐ '}Nivel ${D.lvl.label}`, W / 2, 330, 46, { o: ease((t - 0.3) / 0.6), w: 700 });
    dogAt(c, A, W / 2, 1010, 360, t, true);
    text(c, '¡A por la próxima semana!', W / 2, 1100, 44, { o: ease((t - 0.8) / 0.6) });
    text(c, 'PintaMapa', W / 2, 1190, 30, { w: 700, o: 0.8 });
  }
  function draw(c, tt, D, A) {
    const fns = [s1, s2, s3, s4, s5];
    for (let i = 0; i < SCENES.length; i++) {
      const [a, b] = SCENES[i];
      if (tt < b || i === SCENES.length - 1) {
        fns[i](c, tt - a, D, A);
        // fundido entre escenas
        const fin = clamp01((tt - a) / 0.35), fout = i < SCENES.length - 1 ? clamp01((b - tt) / 0.35) : 1;
        const k = Math.min(fin, fout);
        if (k < 1) { c.fillStyle = '#000'; c.globalAlpha = 1 - k; c.fillRect(0, 0, W, H); c.globalAlpha = 1; }
        break;
      }
    }
    // barras de progreso tipo stories
    SCENES.forEach(([a, b], i) => {
      const w = (W - 60 - 8 * 4) / 5, x = 30 + i * (w + 8);
      c.fillStyle = 'rgba(255,255,255,.3)'; c.fillRect(x, 28, w, 6);
      c.fillStyle = '#fff'; c.fillRect(x, 28, w * clamp01((tt - a) / (b - a)), 6);
    });
  }

  // ---------- vídeo MP4 ----------
  async function encode(D, A, progress) {
    if (!window.VideoEncoder || !window.Mp4Muxer) return null;
    let codec = null;
    for (const cd of ['avc1.4d0028', 'avc1.42e028', 'avc1.640028', 'avc1.42001f']) {
      try { const r = await VideoEncoder.isConfigSupported({ codec: cd, width: W, height: H, bitrate: 5e6, framerate: FPS }); if (r.supported) { codec = cd; break; } } catch (e) {}
    }
    if (!codec) return null;
    const muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H, frameRate: FPS }, fastStart: 'in-memory' });
    let err = null;
    const enc = new VideoEncoder({ output: (ch, meta) => muxer.addVideoChunk(ch, meta), error: (e) => { err = e; } });
    enc.configure({ codec, width: W, height: H, bitrate: 5e6, framerate: FPS, avc: { format: 'avc' } });
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d'), total = DUR * FPS, us = 1e6 / FPS;
    for (let i = 0; i < total; i++) {
      if (err) throw err;
      draw(c, i / FPS, D, A);
      const fr = new VideoFrame(cv, { timestamp: Math.round(i * us), duration: Math.round(us) });
      enc.encode(fr, { keyFrame: i % (FPS * 2) === 0 }); fr.close();
      while (enc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 5));
      if (i % 10 === 0) { progress(i / total); await new Promise((r) => setTimeout(r, 0)); }
    }
    await enc.flush(); enc.close();
    if (err) throw err;
    muxer.finalize();
    return new Blob([muxer.target.buffer], { type: 'video/mp4' });
  }

  // ---------- ventana ----------
  let raf = 0;
  async function open(ctx) {
    close();
    const D = weekData(ctx.S, ctx.W), A = await assets(D);
    const ov = document.createElement('div'); ov.id = 'wrapped-view';
    ov.innerHTML = `<div class="wr-box"><canvas width="${W}" height="${H}"></canvas>
      <div class="wr-bar"><button class="wr-replay">↻ Repetir</button><button class="wr-share">📤 Compartir vídeo</button><button class="wr-close">✕</button></div>
      <div class="wr-msg"></div></div>`;
    document.body.appendChild(ov);
    const cv = ov.querySelector('canvas'), c = cv.getContext('2d');
    let t0 = performance.now();
    const loop = (now) => { const tt = (now - t0) / 1000; draw(c, Math.min(DUR, tt), D, A); if (tt < DUR) raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    ov.querySelector('.wr-replay').onclick = () => { cancelAnimationFrame(raf); t0 = performance.now(); raf = requestAnimationFrame(loop); };
    ov.querySelector('.wr-close').onclick = close;
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    ov.querySelector('.wr-share').onclick = async (e) => {
      const b = e.currentTarget, msg = ov.querySelector('.wr-msg');
      b.disabled = true;
      try {
        const blob = await encode(D, A, (p) => { msg.textContent = `🎬 Creando vídeo… ${Math.round(p * 100)} %`; });
        if (!blob) { msg.textContent = 'Este móvil no puede crear el vídeo MP4.'; return; }
        msg.textContent = '✅ Vídeo listo';
        const name = 'PintaMapa-mi-semana-' + new Date().toISOString().slice(0, 10) + '.mp4';
        if (PM.replay && PM.replay.save) await PM.replay.save(blob, name, 'Mi semana pintando');
      } catch (er) { msg.textContent = '❌ ' + (er.message || er); } finally { b.disabled = false; }
    };
  }
  function close() { cancelAnimationFrame(raf); const ov = document.getElementById('wrapped-view'); if (ov) ov.remove(); }

  const st = document.createElement('style');
  st.textContent = `
  #wrapped-view { position: fixed; inset: 0; z-index: 3200; background: rgba(0,0,0,.85); display: flex; align-items: center; justify-content: center; padding: 12px; }
  #wrapped-view .wr-box { display: flex; flex-direction: column; align-items: center; gap: 10px; max-height: 100%; }
  #wrapped-view canvas { height: min(78vh, calc((100vw - 24px) * 16 / 9)); width: auto; aspect-ratio: 9 / 16; border-radius: 18px; box-shadow: 0 10px 40px rgba(0,0,0,.5); background: #111; }
  #wrapped-view .wr-bar { display: flex; gap: 8px; }
  #wrapped-view button { border: 0; border-radius: 12px; padding: 10px 14px; font: 700 14px system-ui, sans-serif; background: #fff; color: #111827; cursor: pointer; }
  #wrapped-view .wr-share { background: #2563eb; color: #fff; }
  #wrapped-view .wr-msg { color: #fff; font: 600 13px system-ui, sans-serif; min-height: 18px; }`;
  document.head.appendChild(st);

  return { open, close, weekData, _draw: draw, _assets: assets };
})();
