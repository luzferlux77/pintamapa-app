// PintaMapa — cartas coleccionables estilo TCG (como las de Pokémon): anverso con "tipo", PTS, ataques,
// debilidad/resistencia, historia y número de colección; reverso con emblema; brillo holográfico que sigue
// al ratón o a la inclinación del móvil; se voltea al tocarla. Se usa en la app y en «Mi progreso».
PM.tcg = (function () {
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // "Tipos" según la clase de sitio: color de la carta y orbe
  const TYPES = {
    ayto:     { name: 'Gobierno',  c1: '#fff6d6', c2: '#f3cf6b', orb: '#e0a400', kinds: ['Ayuntamiento'] },
    templo:   { name: 'Espíritu',  c1: '#f1e6ff', c2: '#c7a6f2', orb: '#8b5cf6', kinds: ['Iglesia', 'Iglesia principal', 'Basílica', 'Catedral', 'Templo'] },
    historia: { name: 'Historia',  c1: '#f5e9dc', c2: '#d6b48e', orb: '#a16207', kinds: ['Castillo', 'Monumento', 'Torre / Puerta', 'Ruinas', 'Lugar histórico', 'Memorial'] },
    cultura:  { name: 'Cultura',   c1: '#e3f1ff', c2: '#9cc7f2', orb: '#2563eb', kinds: ['Museo', 'Teatro', 'Biblioteca', 'Universidad'] },
    deporte:  { name: 'Deporte',   c1: '#ffe6e1', c2: '#f5a08f', orb: '#e53e1f', kinds: ['Estadio', 'Campo de fútbol'] },
    verde:    { name: 'Naturaleza', c1: '#e3f7e3', c2: '#9fd89f', orb: '#16a34a', kinds: ['Parque', 'Mirador'] },
    ciudad:   { name: 'Ciudad',    c1: '#eef0f4', c2: '#c3c9d4', orb: '#64748b', kinds: [] },
  };
  const typeOf = (kind) => Object.entries(TYPES).find(([, t]) => t.kinds.includes(kind)) || ['ciudad', TYPES.ciudad];
  const RAR = { comun: { sym: '●', name: 'Común', holo: 0.15 }, raro: { sym: '◆', name: 'Rara', holo: 0.45 }, epico: { sym: '★', name: 'Épica', holo: 0.8 }, legendario: { sym: '★★', name: 'Legendaria', holo: 1 } };
  const WEAK = [['🛋️', 'Sofá', '×2'], ['📺', 'Series', '×2'], ['🛵', 'Prisas', '×2'], ['📱', 'Scroll', '×2']];
  const RES = [['☔', 'Lluvia', '−20'], ['🌙', 'Noche', '−20'], ['🥶', 'Frío', '−20'], ['🔥', 'Calor', '−20']];
  const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };

  // ---------------- HTML de la carta ----------------
  // d = { id, name, kind, emoji, rarity, city, barrio, t, visits, img, own, text, points, number, total, player, credit }
  function html(d, opts = {}) {
    const [tk, T] = typeOf(d.kind);
    const R = RAR[d.rarity] || RAR.comun;
    const w = WEAK[hash(d.id) % WEAK.length], r = RES[hash(d.id + 'r') % RES.length];
    const date = d.t ? new Date(d.t).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    const energy = (n) => `<span class="tcg-en">${('<i style="background:' + T.orb + '"></i>').repeat(n)}</span>`;
    return `<div class="tcg r-${d.rarity || 'comun'} t-${tk} ${opts.mini ? 'mini' : ''}" style="--orb:${T.orb};--c1:${T.c1};--c2:${T.c2};--holo:${R.holo}" data-id="${esc(d.id)}">
      <div class="tcg-rot">
        <div class="tcg-face tcg-front">
          <div class="tcg-inner">
            <div class="tcg-top">
              <div class="tcg-stage">${esc(T.name)} · ${esc(R.name)}</div>
              <div class="tcg-title"><b>${esc(d.name)}</b><span class="tcg-hp"><small>PTS</small>${d.points || 100}<i class="tcg-orb">${d.emoji || '📍'}</i></span></div>
            </div>
            <div class="tcg-art">
              <div class="tcg-photo" ${d.img ? `style="background-image:url('${esc(d.img)}')"` : ''}>${d.img ? '' : `<span>${d.emoji || '📍'}</span>`}</div>
              <div class="tcg-shine"></div><div class="tcg-glitter"></div>
              ${d.own ? '<div class="tcg-own">📸 Foto propia</div>' : ''}
            </div>
            <div class="tcg-band">${esc(d.kind || '')}${d.city ? ' · ' + esc(d.city) : ''}${d.visits ? ' · Visitas: ' + d.visits : ''}</div>
            <div class="tcg-moves">
              <div class="tcg-move">${energy(2)}<b>Conquista</b><span>+${d.points || 100}</span></div>
              <p>Quédate 10 s a menos de 30 m y este lugar será tuyo para siempre.</p>
              <div class="tcg-move">${energy(1)}<b>Aura de pintura</b><span>×2</span></div>
              <p>Las calles que pintes a menos de 80 m valen el doble.</p>
            </div>
            <div class="tcg-wrr">
              <div><small>debilidad</small>${w[0]} ${w[2]}</div>
              <div><small>resistencia</small>${r[0]} ${r[2]}</div>
              <div><small>retirada</small>👟👟</div>
            </div>
            <div class="tcg-flavor">${d.text ? esc(d.text) : `Descubierto por ${esc(d.player || 'un pintor')} paseando por ${esc(d.barrio || d.city || 'la ciudad')}.`}</div>
            <div class="tcg-foot"><span>${esc(d.credit || (d.own ? 'Foto: ' + (d.player || 'tuya') : 'Foto: Wikimedia Commons'))}</span>
              <span class="tcg-set">🖌️ ${d.number || 1}/${d.total || 1} <b>${R.sym}</b></span></div>
          </div>
          <div class="tcg-glare"></div>
        </div>
        <div class="tcg-face tcg-back">
          <div class="tcg-back-in">
            <div class="tcg-swirl"></div>
            <div class="tcg-emblem"><div class="tcg-emblem-in"><span class="p">Pinta</span><span class="m">Mapa</span><em>🖌️</em></div></div>
            <div class="tcg-back-txt">${d.player ? 'Conquistado por <b>' + esc(d.player) + '</b>' : 'Carta de conquista'}${date ? '<br>' + date : ''}</div>
          </div>
          <div class="tcg-shine back"></div><div class="tcg-glare"></div>
        </div>
      </div>
    </div>`;
  }

  // ---------------- Interacción: inclinación 3D + brillo que sigue al puntero; tocar = voltear ----------------
  function interactive(el) {
    const rot = el.querySelector('.tcg-rot');
    let flipped = false, raf = null, target = { x: 50, y: 50 }, cur = { x: 50, y: 50 }, active = false;
    const apply = () => {
      cur.x += (target.x - cur.x) * 0.18; cur.y += (target.y - cur.y) * 0.18;
      const rx = (cur.y - 50) / 50 * -14, ry = (cur.x - 50) / 50 * 18;
      el.style.setProperty('--mx', cur.x + '%'); el.style.setProperty('--my', cur.y + '%');
      el.style.setProperty('--rx', rx + 'deg'); el.style.setProperty('--ry', (flipped ? 180 : 0) + ry + 'deg');
      el.style.setProperty('--hyp', Math.min(1, Math.hypot(cur.x - 50, cur.y - 50) / 50).toFixed(3));
      if (Math.abs(target.x - cur.x) > 0.1 || Math.abs(target.y - cur.y) > 0.1) raf = requestAnimationFrame(apply); else raf = null;
    };
    const go = () => { if (!raf) raf = requestAnimationFrame(apply); };
    const point = (cx, cy) => { const b = el.getBoundingClientRect(); target = { x: Math.max(0, Math.min(100, (cx - b.left) / b.width * 100)), y: Math.max(0, Math.min(100, (cy - b.top) / b.height * 100)) }; active = true; el.classList.add('active'); go(); };
    el.addEventListener('pointermove', (e) => point(e.clientX, e.clientY));
    el.addEventListener('pointerleave', () => { target = { x: 50, y: 50 }; active = false; el.classList.remove('active'); go(); });
    el.addEventListener('click', () => { flipped = !flipped; el.classList.toggle('flipped', flipped); rot.style.transition = 'transform .8s cubic-bezier(.3,1.5,.5,1)'; go(); setTimeout(() => { rot.style.transition = ''; }, 800); });
    // móvil: inclinación
    const tilt = (e) => { if (active || e.beta == null || !document.body.contains(el)) return; target = { x: 50 + Math.max(-45, Math.min(45, e.gamma)) * 1.1, y: 50 + Math.max(-45, Math.min(45, e.beta - 40)) * 1.1 }; el.classList.add('active'); go(); };
    window.addEventListener('deviceorientation', tilt);
    // vaivén suave al aparecer (para que se vea el brillo sin tocar)
    let t0 = performance.now();
    const idle = (now) => { if (active || !document.body.contains(el)) return; const k = (now - t0) / 1000; if (k > 3.2) return; target = { x: 50 + Math.sin(k * 2.2) * 30, y: 50 + Math.cos(k * 1.7) * 18 }; el.classList.add('active'); go(); requestAnimationFrame(idle); };
    requestAnimationFrame(idle);
    return { flip: () => el.click() };
  }

  // ---------------- Vista grande ----------------
  function open(d, opts = {}) {
    let ov = document.getElementById('tcg-view');
    if (!ov) { ov = document.createElement('div'); ov.id = 'tcg-view'; document.body.appendChild(ov); }
    ov.innerHTML = `<div class="tcg-stage-wrap">
      ${opts.badge ? `<div class="tcg-badge">${opts.badge}</div>` : ''}
      ${html(d)}
      <div class="tcg-actions">
        <button data-a="flip">↻ Girar</button>
        ${(opts.actions || []).map((a, i) => `<button data-x="${i}" class="${a.primary ? 'pri' : ''}">${a.label}</button>`).join('')}
        <button data-a="png">⬇️ Imagen</button>
        <button data-a="close">✕</button>
      </div>
      <p class="tcg-hint">Mueve el ratón (o inclina el móvil) para ver el brillo · tócala para darle la vuelta</p>
    </div>`;
    ov.classList.add('show');
    const card = ov.querySelector('.tcg');
    const ctl = interactive(card);
    ov.querySelector('[data-a=flip]').addEventListener('click', () => ctl.flip());
    ov.querySelector('[data-a=close]').addEventListener('click', close);
    ov.querySelector('[data-a=png]').addEventListener('click', () => download(d));
    (opts.actions || []).forEach((a, i) => ov.querySelector(`[data-x="${i}"]`).addEventListener('click', a.on));
    ov.onclick = (e) => { if (e.target === ov) close(); };
    document.addEventListener('keydown', esc1);
  }
  function esc1(e) { if (e.key === 'Escape') close(); }
  function close() { const ov = document.getElementById('tcg-view'); if (ov) ov.classList.remove('show'); document.removeEventListener('keydown', esc1); }

  // ---------------- Exportar como imagen (para compartir) ----------------
  async function toPng(d) {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:-9999px;top:0;width:630px;padding:24px;background:transparent;--w:630px';
    box.innerHTML = html(d, { flat: true });
    const card = box.firstElementChild; card.classList.add('flat', 'active'); card.style.setProperty('--mx', '35%'); card.style.setProperty('--my', '30%'); card.style.setProperty('--hyp', '.6');
    document.body.appendChild(box);
    try {
      await new Promise((r) => setTimeout(r, 300));
      return await window.htmlToImage.toPng(card, { pixelRatio: 2, cacheBust: true, filter: (n) => !(n.classList && n.classList.contains('tcg-back')) });
    } finally { box.remove(); }
  }
  async function download(d) {
    try {
      const url = await toPng(d);
      if (PM.isNative && window.Capacitor.Plugins.Filesystem && window.Capacitor.Plugins.Share) {
        const f = await window.Capacitor.Plugins.Filesystem.writeFile({ path: `carta-${d.id}.png`, data: url.split(',')[1], directory: 'CACHE' });
        await window.Capacitor.Plugins.Share.share({ title: d.name, text: `He conquistado «${d.name}» en PintaMapa 🖌️🚩`, files: [f.uri] }).catch(() => {});
        return;
      }
      const a = document.createElement('a'); a.href = url; a.download = `PintaMapa - ${d.name}.png`; a.click();
    } catch (e) { alert('No se pudo crear la imagen: ' + (e.message || e)); }
  }

  // ---------------- Estilos ----------------
  const css = `
  .tcg { --mx: 50%; --my: 50%; --rx: 0deg; --ry: 0deg; --hyp: 0; --y: #f6d44c; position: relative; width: 100%; aspect-ratio: 63 / 88; perspective: 1200px; font-family: Inter, system-ui, sans-serif; font-size: calc(var(--w, 360px) / 26); user-select: none; cursor: pointer; }
  .tcg.mini { font-size: 6.4px; cursor: pointer; }
  .tcg-rot { position: absolute; inset: 0; transform-style: preserve-3d; transform: rotateX(var(--rx)) rotateY(var(--ry)); will-change: transform; }
  .tcg-face { position: absolute; inset: 0; border-radius: 4.5% / 3.3%; overflow: hidden; backface-visibility: hidden; -webkit-backface-visibility: hidden; box-shadow: 0 1.4em 3em rgba(0,0,0,.35), 0 0 0 1px rgba(0,0,0,.15); }
  .tcg-front { background: linear-gradient(135deg, #fff1a8, var(--y) 30%, #e8b923 60%, #fff3b0); padding: 3.6%; }
  .r-legendario .tcg-front { background: linear-gradient(135deg, #fff6cf, #e6c25a 20%, #fffbe8 40%, #d4a52c 60%, #fff2b8 80%, #c99a24); }
  .tcg-inner { position: relative; height: 100%; border-radius: 2.4% / 1.7%; background: linear-gradient(170deg, var(--c1), var(--c2)); padding: 2.6% 4%; display: flex; flex-direction: column; gap: .35em; box-shadow: inset 0 0 0 .18em rgba(0,0,0,.18); }
  .tcg-stage { font-size: .62em; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; color: rgba(0,0,0,.55); }
  .tcg-title { display: flex; align-items: center; justify-content: space-between; gap: .5em; }
  .tcg-title b { font-size: 1.3em; font-weight: 900; color: #1b1b1b; line-height: 1.05; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; letter-spacing: -.01em; }
  .tcg-hp { display: flex; align-items: center; gap: .25em; font-weight: 900; font-size: 1.25em; color: #c81e1e; white-space: nowrap; }
  .tcg-hp small { font-size: .5em; color: #c81e1e; }
  .tcg-orb { display: grid; place-items: center; width: 1.6em; height: 1.6em; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #fff8, transparent 45%), var(--orb); font-style: normal; font-size: .85em; box-shadow: 0 .1em .25em rgba(0,0,0,.4), inset 0 -.15em .3em rgba(0,0,0,.25); }
  .tcg-art { position: relative; height: 45%; border-radius: .3em; overflow: hidden; border: .32em solid; border-image: linear-gradient(135deg, #f4f4f4, #9a9a9a, #fafafa, #8a8a8a) 1; box-shadow: 0 .2em .5em rgba(0,0,0,.35); background: #ddd; }
  .tcg-photo { position: absolute; inset: 0; background: center / cover no-repeat; display: grid; place-items: center; background-color: #e9e2d4; }
  .tcg-photo span { font-size: 4.5em; filter: drop-shadow(0 .1em .2em rgba(0,0,0,.3)); }
  .tcg-own { position: absolute; right: .4em; bottom: .4em; background: #ff2e88; color: #fff; font-size: .62em; font-weight: 800; padding: .2em .6em; border-radius: 99px; transform: rotate(-4deg); z-index: 3; }
  .tcg-band { margin: -.1em auto 0; font-size: .6em; font-style: italic; font-weight: 600; text-align: center; color: #3a2a00; background: linear-gradient(90deg, transparent, rgba(255,255,255,.75), transparent); padding: .2em 1.5em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  .tcg-moves { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: .1em; }
  .tcg-move { display: flex; align-items: center; gap: .45em; } .tcg-move b { flex: 1; font-size: .95em; font-weight: 900; color: #1b1b1b; } .tcg-move span { font-size: 1.05em; font-weight: 900; color: #1b1b1b; }
  .tcg-moves p { margin: 0 0 .25em 3.2em; font-size: .62em; line-height: 1.3; color: #2c2c2c; }
  .tcg-en { display: inline-flex; gap: .15em; min-width: 2.6em; } .tcg-en i { width: .95em; height: .95em; border-radius: 50%; box-shadow: inset 0 -.1em .15em rgba(0,0,0,.35), 0 0 0 .08em rgba(255,255,255,.7); }
  .tcg-wrr { display: flex; justify-content: space-between; border-top: .1em solid rgba(0,0,0,.25); padding-top: .2em; font-size: .7em; font-weight: 700; color: #222; }
  .tcg-wrr small { display: block; font-size: .7em; font-weight: 600; color: rgba(0,0,0,.55); text-transform: lowercase; }
  .tcg-flavor { font-size: .56em; font-style: italic; line-height: 1.35; color: #2c2c2c; border: .12em solid rgba(160,120,20,.55); border-radius: .4em; padding: .35em .55em; background: rgba(255,255,255,.35); max-height: 5.5em; overflow: hidden; }
  .tcg-foot { display: flex; justify-content: space-between; align-items: center; font-size: .5em; color: rgba(0,0,0,.6); font-weight: 600; }
  .tcg-set b { color: #111; margin-left: .3em; }
  /* --- brillo holográfico --- */
  .tcg-shine, .tcg-glitter, .tcg-glare { position: absolute; inset: 0; pointer-events: none; z-index: 2; }
  .tcg-shine { opacity: calc(var(--holo) * (.2 + var(--hyp) * .6)); mix-blend-mode: color-dodge; filter: brightness(.85) contrast(1.4) saturate(1.3);
    background: repeating-linear-gradient(110deg, #ff0080 0%, #ffd000 7%, #00ff9d 14%, #00c3ff 21%, #b400ff 28%, #ff0080 35%), linear-gradient(var(--mx), transparent 30%, #000 50%, transparent 70%);
    background-size: 300% 300%, 100% 100%; background-position: var(--mx) var(--my), center; background-blend-mode: hue; }
  .r-legendario .tcg-front > .tcg-glare + * { }
  .r-legendario .tcg-inner::after { content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; mix-blend-mode: color-dodge; opacity: calc(.04 + var(--hyp) * .2);
    background: repeating-linear-gradient(115deg, #ff0080 0%, #ffd000 6%, #00ff9d 12%, #00c3ff 18%, #b400ff 24%, #ff0080 30%); background-size: 400% 400%; background-position: var(--mx) var(--my); }
  .tcg-glitter { opacity: calc(var(--holo) * var(--hyp) * .9); mix-blend-mode: color-dodge;
    background-image: radial-gradient(circle at 20% 30%, #fff 0 .06em, transparent .1em), radial-gradient(circle at 70% 60%, #fff 0 .05em, transparent .09em), radial-gradient(circle at 40% 80%, #fff 0 .05em, transparent .09em), radial-gradient(circle at 85% 20%, #fff 0 .06em, transparent .1em);
    background-size: 2.3em 2.1em, 1.9em 2.6em, 2.7em 1.7em, 3.1em 2.9em; background-position: calc(var(--mx) * .3) calc(var(--my) * .3); }
  .tcg-glare { z-index: 4; mix-blend-mode: soft-light; opacity: calc(.25 + var(--hyp) * .6); background: radial-gradient(circle at var(--mx) var(--my), rgba(255,255,255,.95) 0%, rgba(255,255,255,.35) 12%, rgba(255,255,255,0) 32%, rgba(0,0,0,.18) 100%); }
  .tcg:not(.active) .tcg-glare { opacity: .15; }
  /* --- reverso --- */
  .tcg-back { transform: rotateY(180deg); background: #0f1640; padding: 3.6%; background: linear-gradient(135deg, #1b2a6b, #0b1033); }
  .tcg-back-in { position: relative; height: 100%; border-radius: 2.4% / 1.7%; overflow: hidden; display: grid; place-items: center; box-shadow: inset 0 0 0 .2em #ff2e88, inset 0 0 0 .55em #0b1033, inset 0 0 0 .7em #22d3ee;
    background: radial-gradient(circle at 50% 46%, #ff2e8866, transparent 55%), radial-gradient(circle at 50% 46%, #22d3ee33, transparent 75%), #121a4a; }
  .tcg-swirl { position: absolute; inset: -40%; background: repeating-conic-gradient(from 0deg at 50% 50%, #ff2e8826 0deg 9deg, transparent 9deg 18deg, #22d3ee22 18deg 27deg, transparent 27deg 36deg); animation: tcgspin 40s linear infinite; }
  @keyframes tcgspin { to { transform: rotate(360deg); } }
  .tcg-emblem { position: relative; width: 62%; aspect-ratio: 1; border-radius: 50%; display: grid; place-items: center;
    background: radial-gradient(circle at 35% 30%, #ffffff, #f2f4ff 40%, #c9d2ff 75%, #8fa0ff); box-shadow: 0 0 0 .45em #ff2e88, 0 0 0 .9em #0b1033, 0 0 0 1.15em #22d3ee, 0 0 3em #ff2e88aa; }
  .tcg-emblem::before { content: ''; position: absolute; inset: 0; border-radius: 50%; background: linear-gradient(transparent 46%, #0b1033 46% 54%, transparent 54%); opacity: .9; }
  .tcg-emblem-in { position: relative; text-align: center; font-weight: 900; font-style: italic; letter-spacing: -.04em; line-height: .95; background: #fff; padding: .4em .8em; border-radius: 99px; box-shadow: 0 0 0 .2em #0b1033; }
  .tcg-emblem-in .p { color: #ff2e88; font-size: 1.7em; } .tcg-emblem-in .m { color: #06b6d4; font-size: 1.7em; }
  .tcg-emblem-in em { position: absolute; right: -.6em; top: -.9em; font-size: 1.6em; font-style: normal; transform: rotate(18deg); }
  .tcg-back-txt { position: absolute; bottom: 7%; left: 0; right: 0; text-align: center; color: #cfd6ff; font-size: .62em; line-height: 1.4; }
  .tcg-back-txt b { color: #fff; }
  .tcg-shine.back { opacity: calc(.25 + var(--hyp) * .45); }
  .tcg.flat .tcg-rot { transform: none; } .tcg.flat .tcg-face { box-shadow: none; }
  /* --- vista grande --- */
  #tcg-view { position: fixed; inset: 0; z-index: 3000; display: none; place-items: center; background: radial-gradient(circle at 50% 40%, rgba(40,20,80,.75), rgba(5,5,20,.92)); backdrop-filter: blur(6px); }
  #tcg-view.show { display: grid; animation: tcgfade .25s ease-out; }
  @keyframes tcgfade { from { opacity: 0; } }
  .tcg-stage-wrap { --w: min(86vw, 400px, 58vh); width: var(--w); display: flex; flex-direction: column; align-items: center; gap: 16px; animation: tcgpop .6s cubic-bezier(.2,1.5,.4,1); }
  @keyframes tcgpop { from { transform: scale(.4) rotate(-12deg); opacity: 0; } }
  .tcg-badge { background: linear-gradient(90deg, #ffd166, #ffb700); color: #3a2500; font-weight: 900; padding: 6px 16px; border-radius: 99px; box-shadow: 0 0 30px #ffb700aa; font-size: 15px; }
  .tcg-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
  .tcg-actions button { border: 0; background: rgba(255,255,255,.12); color: #fff; padding: 10px 14px; border-radius: 12px; font: 600 14px Inter, system-ui, sans-serif; cursor: pointer; backdrop-filter: blur(4px); }
  .tcg-actions button:hover { background: rgba(255,255,255,.22); } .tcg-actions button.pri { background: #ff2e88; }
  .tcg-hint { color: rgba(255,255,255,.6); font: 12.5px Inter, system-ui, sans-serif; margin: 0; text-align: center; }
  `;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  return { html, open, close, interactive, toPng, download, typeOf };
})();
