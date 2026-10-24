// PintaMapa — póster de tu mapa pintado: lámina A4 a 300 ppp (2480×3508) lista para imprimir o compartir.
// Estilo de póster de ciudad: el mapa de calles con lo tuyo pintado, el nombre de la ciudad, tus cifras y coordenadas.
PM.poster = (function () {
  const PW = 2480, PH = 3508, M = 170;            // tamaño y margen
  const MAP = { x: M, y: M, w: PW - M * 2, h: 2480 };   // zona del mapa
  const THEMES = {
    claro: { name: 'Claro', bg: '#f7f3ea', street: '#d8d0bf', trail: '#cdbf9f', text: '#1f2937', soft: '#6b7280', line: '#1f2937', glow: 0 },
    noche: { name: 'Noche', bg: '#0b1220', street: '#1e293b', trail: '#2b3a52', text: '#e5e7eb', soft: '#94a3b8', line: '#e5e7eb', glow: 1 },
    papel: { name: 'Papel', bg: '#efe4cc', street: '#cbbd9b', trail: '#c2b28a', text: '#3b2f22', soft: '#7a6a55', line: '#3b2f22', glow: 0, paper: 1 },
  };
  const RC = ['#cd7f32', '#a8b0bd', '#eab308', '#a855f7'];

  // ---------- datos del área ----------
  function gather(ctx, area) {
    const { S, W } = ctx, s = S();
    const inArea = (p) => area === 'all' || W.cityAt(p) === area;
    const painted = [], streets = [];
    let paintedM = 0, nPieces = 0;
    // todo lo pintado, también lo de zonas que no están en memoria (sale del almacén de formas del móvil)
    const all = ctx.paintedAll ? ctx.paintedAll() : Object.keys(s.painted).map((id) => W.pieces[id]).filter(Boolean);
    const seen = new Set();
    for (const pc of all) if (inArea(pc.mid)) { painted.push(pc); seen.add(pc.id); if (!pc.trail) paintedM += pc.len; nPieces++; }
    // tramos pendientes de subir a la nube de los que aún no hay forma guardada
    for (const [id, pts] of Object.entries(s.pendingGeo || {})) if (!seen.has(id) && !W.pieces[id] && pts && pts.length > 1 && inArea(pts[0])) painted.push({ pts, len: 0, mid: pts[0] });
    if (!painted.length) return null;
    let a = 90, b = -90, l = 180, r = -180;
    painted.forEach((pc) => pc.pts.forEach((q) => { a = Math.min(a, q[0]); b = Math.max(b, q[0]); l = Math.min(l, q[1]); r = Math.max(r, q[1]); }));
    // la caja con la forma de la zona del mapa y un poco de aire
    const k = Math.cos((a + b) / 2 * Math.PI / 180);
    let sx = (r - l) * k, sy = b - a;
    const want = MAP.w / MAP.h;
    if (sx / sy > want) sy = sx / want; else sx = sy * want;
    sx *= 1.12; sy *= 1.12;
    const cy = (a + b) / 2, cx = (l + r) / 2;
    const box = [cy - sy / 2, cx - sx / k / 2, cy + sy / 2, cx + sx / k / 2];
    for (const id in W.pieces) { const pc = W.pieces[id]; if (pc.mid[0] > box[0] && pc.mid[0] < box[2] && pc.mid[1] > box[1] && pc.mid[1] < box[3]) streets.push(pc); }
    const barrios = [];
    for (const [id, B] of Object.entries(W.barrios)) if (s.conqueredB[id] && B.segs) barrios.push([B, (s.barrioRank || {})[id] || 0]);
    // los conquistados que no están cargados: con su contorno guardado
    const shapes = ctx.barrioShapes ? ctx.barrioShapes() : {};
    for (const [id, g] of Object.entries(shapes)) if (s.conqueredB[id] && !W.barrios[id] && g.segs && g.segs.length) barrios.push([{ id, name: g.name, segs: g.segs, pos: g.pos }, (s.barrioRank || {})[id] || 0]);
    const lms = Object.values(s.landmarks || {}).filter((v) => v.pos && v.pos[0] > box[0] && v.pos[0] < box[2] && v.pos[1] > box[1] && v.pos[1] < box[3]);
    const cities = {}; painted.forEach((pc) => { const c = pc.mid && W.cityAt(pc.mid); if (c) cities[c] = (cities[c] || 0) + 1; });
    const title = area !== 'all' ? area : (Object.entries(cities).sort((x, y) => y[1] - x[1])[0] || ['Mi mapa'])[0];
    const nB = Object.entries(s.barrioCards || {}).filter(([, v]) => area === 'all' || v.city === area).length;
    const nL = Object.values(s.landmarks || {}).filter((v) => area === 'all' || v.city === area).length;
    const first = (s.walks || []).length ? Math.min(...s.walks.map((w) => w.start)) : Date.now();
    return { box, k, painted, streets, barrios, lms, title, paintedM: area === 'all' ? (s.stats.paintedM || paintedM) : paintedM, nPieces, nB, nL, first, center: [cy, cx], color: s.color || '#2563eb', player: PM.player ? PM.player.name : '' };
  }

  // ---------- dibujo ----------
  function render(cv, D, themeId, scale) {
    const T = THEMES[themeId] || THEMES.claro, c = cv.getContext('2d');
    cv.width = Math.round(PW * scale); cv.height = Math.round(PH * scale);
    c.setTransform(scale, 0, 0, scale, 0, 0);
    c.fillStyle = T.bg; c.fillRect(0, 0, PW, PH);
    if (T.paper) {   // grano de papel
      const r = (n) => { n = Math.sin(n * 12.9898) * 43758.5453; return n - Math.floor(n); };
      c.globalAlpha = 0.06; for (let i = 0; i < 6000; i++) { c.fillStyle = r(i) > 0.5 ? '#000' : '#fff'; c.fillRect(r(i + 1) * PW, r(i + 2) * PH, 3, 3); } c.globalAlpha = 1;
    }
    const [s0, w0, n0, e0] = D.box, sxDeg = (e0 - w0), syDeg = (n0 - s0);
    const X = (q) => MAP.x + (q[1] - w0) / sxDeg * MAP.w, Y = (q) => MAP.y + (n0 - q[0]) / syDeg * MAP.h;
    const path = (pts) => { c.beginPath(); pts.forEach((q, i) => { const x = X(q), y = Y(q); i ? c.lineTo(x, y) : c.moveTo(x, y); }); };
    c.save(); c.beginPath(); c.rect(MAP.x, MAP.y, MAP.w, MAP.h); c.clip();
    c.lineCap = c.lineJoin = 'round';
    // calles
    c.strokeStyle = T.street; c.lineWidth = 3.2;
    D.streets.forEach((pc) => { if (pc.trail) return; path(pc.pts); c.stroke(); });
    c.strokeStyle = T.trail; c.lineWidth = 2.2; c.setLineDash([6, 8]);
    D.streets.forEach((pc) => { if (!pc.trail) return; path(pc.pts); c.stroke(); });
    c.setLineDash([]);
    // contornos de barrios conquistados (color de su rango)
    D.barrios.forEach(([B, rk]) => { c.strokeStyle = RC[rk] || RC[0]; c.lineWidth = 5; c.globalAlpha = 0.85; B.segs.forEach((sg) => { path(sg); c.stroke(); }); c.globalAlpha = 1; });
    // lo pintado (con brillo en el tema noche)
    if (T.glow) { c.shadowColor = D.color; c.shadowBlur = 22; }
    c.strokeStyle = D.color; c.lineWidth = 7.5;
    D.painted.forEach((pc) => { path(pc.pts); c.stroke(); });
    c.shadowBlur = 0;
    // lugares conquistados
    D.lms.forEach((v) => { const x = X(v.pos), y = Y(v.pos); c.beginPath(); c.arc(x, y, v.must ? 15 : 10, 0, 7); c.fillStyle = v.must ? '#f59e0b' : D.color; c.fill(); c.lineWidth = 4; c.strokeStyle = T.bg; c.stroke(); });
    c.restore();
    // marco
    c.strokeStyle = T.line; c.lineWidth = 3; c.strokeRect(MAP.x, MAP.y, MAP.w, MAP.h);
    if (T.paper) { c.lineWidth = 1.5; c.strokeRect(MAP.x - 16, MAP.y - 16, MAP.w + 32, MAP.h + 32); }
    // título y cifras
    const cx = PW / 2; let y = MAP.y + MAP.h + 210;
    const font = (w, px) => `${w} ${px}px "Inter", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif`;
    c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillStyle = T.text;
    const title = D.title.toUpperCase();
    let px = 170; c.font = font(800, px);
    const spaced = (txt, ls) => { const w = [...txt].reduce((a, ch) => a + c.measureText(ch).width, 0) + ls * (txt.length - 1); return w; };
    while (spaced(title, px * 0.18) > MAP.w && px > 60) { px -= 6; c.font = font(800, px); }
    const drawSpaced = (txt, ls, yy) => { let x = cx - spaced(txt, ls) / 2; c.textAlign = 'left'; [...txt].forEach((ch) => { c.fillText(ch, x, yy); x += c.measureText(ch).width + ls; }); c.textAlign = 'center'; };
    drawSpaced(title, px * 0.18, y);
    y += 62; c.fillStyle = D.color; c.fillRect(cx - 180, y, 360, 7);
    y += 95; c.fillStyle = T.soft; c.font = font(600, 46);
    drawSpaced(`PINTADO POR ${D.player.toUpperCase()} · DESDE ${new Date(D.first).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }).toUpperCase()}`, 7, y);
    // cifras
    y += 170;
    const stats = [[(D.paintedM / 1000).toFixed(D.paintedM >= 100000 ? 0 : 1).replace('.', ','), 'KM PINTADOS'], [PM.fmtNum ? PM.fmtNum(D.nPieces) : D.nPieces, 'TRAMOS'], [D.nB, 'BARRIOS'], [D.nL, 'LUGARES']];
    const colW = MAP.w / stats.length;
    stats.forEach(([v, l], i) => {
      const x = MAP.x + colW * i + colW / 2;
      c.fillStyle = T.text; c.font = font(800, 108); c.fillText(String(v), x, y);
      c.fillStyle = T.soft; c.font = font(700, 34); c.fillText(l, x, y + 62);
      if (i) { c.fillStyle = T.soft; c.globalAlpha = 0.35; c.fillRect(MAP.x + colW * i, y - 100, 2, 170); c.globalAlpha = 1; }
    });
    // coordenadas y firma
    const ll = (v, p, n) => `${Math.abs(v).toFixed(4)}° ${v >= 0 ? p : n}`;
    c.fillStyle = T.soft; c.font = font(500, 36);
    c.fillText(`${ll(D.center[0], 'N', 'S')}  ·  ${ll(D.center[1], 'E', 'O')}`, cx, PH - 120);
    c.textAlign = 'right'; c.font = font(800, 40); c.fillStyle = D.color; c.fillText('PintaMapa', PW - M, PH - 80);
    c.textAlign = 'left'; c.fillStyle = T.soft; c.font = font(500, 28); c.fillText('© OpenStreetMap', M, PH - 80);
  }

  // ---------- ventana ----------
  async function open(ctx) {
    const { S, W } = ctx, s = S();
    const cities = {}; for (const k in s.tileNames || {}) { const ci = s.tileNames[k].city; if (ci && (s.paintedByTile || {})[k]) cities[ci] = (cities[ci] || 0) + s.paintedByTile[k]; }
    const cityList = Object.entries(cities).sort((a, b) => b[1] - a[1]).map(([c]) => c);
    let theme = 'claro', area = cityList[0] || 'all';
    const ov = document.createElement('div'); ov.id = 'poster-view';
    ov.innerHTML = `<div class="po-box"><div class="po-head"><b>🖼️ Póster de tu mapa</b><button class="po-x">✕</button></div>
      <div class="po-prev"><canvas></canvas><div class="po-load">Preparando tus calles…</div></div>
      <div class="po-opts"><div class="po-row">${Object.entries(THEMES).map(([k, t]) => `<button class="po-th ${k === theme ? 'on' : ''}" data-th="${k}"><i style="background:${t.bg};border-color:${t.street}"></i>${t.name}</button>`).join('')}</div>
      <select class="po-area">${cityList.map((c) => `<option value="${c.replace(/"/g, '&quot;')}">${c}</option>`).join('')}<option value="all">Todo lo que has pintado</option></select>
      <button class="po-dl">⬇️ Guardar póster (A4, 300 ppp)</button><small class="po-msg">Para imprimir en A4 o enmarcar. También queda genial en el móvil.</small></div></div>`;
    document.body.appendChild(ov);
    const cv = ov.querySelector('canvas'), msg = ov.querySelector('.po-msg'), load = ov.querySelector('.po-load');
    ov.querySelector('.po-area').value = area;
    const close = () => ov.remove();
    ov.querySelector('.po-x').onclick = close;
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    // carga las calles de las zonas por las que has paseado (para que el póster salga completo)
    const keys = new Set();
    (s.walks || []).forEach((w) => (w.track || []).forEach((q, i) => { if (q && i % 5 === 0) keys.add(W.tileKeyOf(q[0], q[1])); }));
    const need = [...keys].filter((k) => !(W.tiles[k] && W.tiles[k].loaded)).slice(0, 60);
    if (need.length) { load.textContent = `Cargando las calles de ${need.length} zonas…`; try { await W.ensureKeys(need); } catch (e) {} }
    let D = null;
    const draw = () => {
      D = gather(ctx, area);
      if (!D) { load.style.display = ''; load.textContent = 'Aún no has pintado calles aquí.'; return; }
      load.style.display = 'none';
      render(cv, D, theme, 0.25);
    };
    draw();
    ov.querySelectorAll('.po-th').forEach((b) => b.addEventListener('click', () => { theme = b.dataset.th; ov.querySelectorAll('.po-th').forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
    ov.querySelector('.po-area').addEventListener('change', (e) => { area = e.target.value; draw(); });
    ov.querySelector('.po-dl').addEventListener('click', async (e) => {
      if (!D) return;
      const b = e.currentTarget; b.disabled = true; msg.textContent = '⏳ Creando el póster en alta resolución…';
      await new Promise((r) => setTimeout(r, 50));
      try {
        const big = document.createElement('canvas'); render(big, D, theme, 1);
        const blob = await new Promise((r) => big.toBlob(r, 'image/png'));
        const name = `PintaMapa-${D.title.replace(/[^\wÀ-ÿ]+/g, '-')}-${theme}.png`;
        await PM.replay.save(blob, name, 'Mi mapa pintado');
        msg.textContent = `✅ Póster listo (${(blob.size / 1048576).toFixed(1)} MB).`;
      } catch (er) { msg.textContent = '❌ ' + (er.message || er); } finally { b.disabled = false; }
    });
  }

  const st = document.createElement('style');
  st.textContent = `
  #poster-view { position: fixed; inset: 0; z-index: 3200; background: rgba(10,12,20,.82); display: flex; align-items: flex-end; justify-content: center; animation: fadein .2s ease both; }
  #poster-view .po-box { width: min(560px, 100%); max-height: 96vh; overflow-y: auto; background: var(--sheet, #fff); color: var(--text, #111); border-radius: 22px 22px 0 0; padding: 14px 16px calc(16px + env(safe-area-inset-bottom)); }
  #poster-view .po-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; } #poster-view .po-head b { font-size: 17px; }
  #poster-view .po-x { border: 0; background: var(--btn, #eee); width: 34px; height: 34px; border-radius: 50%; font-size: 16px; color: inherit; }
  #poster-view .po-prev { position: relative; display: flex; justify-content: center; background: repeating-conic-gradient(rgba(127,127,127,.08) 0 25%, transparent 0 50%) 0 0/20px 20px; border-radius: 14px; padding: 12px; }
  #poster-view canvas { width: min(62vw, 300px); height: auto; aspect-ratio: 2480 / 3508; box-shadow: 0 10px 30px rgba(0,0,0,.35); border-radius: 3px; background: #ddd; }
  #poster-view .po-load { position: absolute; inset: 0; display: grid; place-items: center; font-weight: 700; color: var(--muted, #666); }
  #poster-view .po-opts { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; }
  #poster-view .po-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  #poster-view .po-th { display: flex; align-items: center; gap: 8px; justify-content: center; border: 2px solid var(--line, #ddd); background: var(--panel, #fff); color: inherit; border-radius: 12px; padding: 9px; font: 600 14px system-ui, sans-serif; cursor: pointer; }
  #poster-view .po-th.on { border-color: var(--accent, #2563eb); } #poster-view .po-th i { width: 18px; height: 18px; border-radius: 5px; border: 3px solid; }
  #poster-view .po-area { padding: 11px; border-radius: 12px; border: 1px solid var(--line, #ddd); background: var(--panel, #fff); color: inherit; font: 600 14px system-ui, sans-serif; }
  #poster-view .po-dl { border: 0; border-radius: 14px; padding: 14px; background: var(--accent, #2563eb); color: #fff; font: 800 16px system-ui, sans-serif; cursor: pointer; }
  #poster-view .po-dl:disabled { opacity: .6; } #poster-view .po-msg { color: var(--muted, #666); text-align: center; }`;
  document.head.appendChild(st);
  return { open, render, gather };
})();
