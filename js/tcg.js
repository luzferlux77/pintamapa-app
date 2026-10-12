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

  // Texto de la carta: la historia del sitio y, si es corta, sus datos de conquista (mínimo ~4 líneas)
  function flavorText(d, typeName, rarName) {
    const date = d.t ? new Date(d.t).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    let t = (d.text || '').trim();
    const extra = [
      date ? `Conquistado el ${date}${d.player ? ' por ' + d.player : ''}.` : '',
      d.barrio || d.city ? `Se encuentra en ${[d.barrio, d.city].filter(Boolean).join(', ')}.` : '',
      `Carta ${rarName.toLowerCase()} de tipo ${typeName.toLowerCase()}: ${d.points || 100} puntos al conquistarla.`,
      d.visits > 1 ? `La has visitado ${d.visits} veces.` : 'Vuelve cada día a visitarla para sumar más puntos.',
    ].filter(Boolean);
    if (!t) t = `${d.name}: ${(d.kind || 'lugar').toLowerCase()} descubierto paseando por la ciudad.`;
    for (const e of extra) { if (t.length >= 300) break; t += ' ' + e; }
    return t;
  }
  // historia más larga desde Wikipedia (introducción completa del artículo)
  async function longText(d) {
    let lang = null, title = null;
    if (d.wiki && /^[a-z]{2,3}:/.test(d.wiki)) { [lang, title] = [d.wiki.split(':')[0], d.wiki.split(':').slice(1).join(':')]; }
    if (d.wd) {
      try {
        const j = await (await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${d.wd}.json`)).json();
        const sl = (Object.values(j.entities)[0] || {}).sitelinks || {};
        const site = ['eswiki', 'cawiki', 'glwiki', 'euwiki', 'enwiki'].find((x) => sl[x]);
        if (site && (!lang || site === 'eswiki')) { lang = site.replace('wiki', ''); title = sl[site].title; }
      } catch (e) {}
    }
    if (!title) return null;
    const j = await (await fetch(`https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&redirects=1&format=json&origin=*&titles=${encodeURIComponent(title)}`)).json();
    let t = (Object.values((j.query && j.query.pages) || {})[0] || {}).extract || '';
    t = t.replace(/\s+/g, ' ').trim();
    if (t.length > 700) { const c = t.slice(0, 700); t = c.slice(0, Math.max(c.lastIndexOf('. ') + 1, 400)) || c; if (!/[.!?]$/.test(t)) t += '…'; }
    return t || null;
  }

  // ---------------- Reverso: plano de ciudad con calles pintadas, chincheta, anillo con lema ----------------
  function backHTML(d, R) {
    const seed = hash(d.id);
    let rnd = seed || 7;
    const rand = () => { rnd = (rnd * 1103515245 + 12345) % 2147483648; return rnd / 2147483648; };
    const painted = { comun: 0.25, raro: 0.4, epico: 0.55, legendario: 0.75 }[d.rarity] || 0.3;
    let streets = '';
    for (let i = 0; i < 9; i++) {   // calles "horizontales" algo torcidas
      const y = 6 + i * 16 + rand() * 6, y2 = y + (rand() - 0.5) * 18;
      const on = rand() < painted;
      streets += `<path d="M-5,${y.toFixed(1)} Q50,${((y + y2) / 2 + (rand() - 0.5) * 10).toFixed(1)} 105,${y2.toFixed(1)}" class="${on ? 'on' : ''}"/>`;
    }
    for (let i = 0; i < 7; i++) {   // calles "verticales"
      const x = 4 + i * 16 + rand() * 6, x2 = x + (rand() - 0.5) * 16;
      const on = rand() < painted;
      streets += `<path d="M${x.toFixed(1)},-5 Q${((x + x2) / 2 + (rand() - 0.5) * 10).toFixed(1)},70 ${x2.toFixed(1)},145" class="${on ? 'on c' : ''}"/>`;
    }
    streets += `<path d="M-5,${(20 + rand() * 30).toFixed(1)} L105,${(110 + rand() * 30).toFixed(1)}" class="on big"/>`;
    const tp = 'tp' + seed;
    const corner = `<svg viewBox="0 0 40 40"><path d="M2,38 L2,10 Q2,2 10,2 L38,2" /><path d="M8,38 L8,14 Q8,8 14,8 L38,8" class="thin"/><circle cx="8" cy="8" r="3.2"/></svg>`;
    const date = d.t ? new Date(d.t).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    return `<div class="tcg-face tcg-back">
      <div class="tcg-back-in">
        <svg class="tcg-map" viewBox="0 0 100 140" preserveAspectRatio="xMidYMid slice">${streets}</svg>
        <div class="tcg-rays"></div>
        <div class="tcg-stars">${R.sym.replace(/./g, '<i>$&</i>')}</div>
        <div class="tcg-crest">
          <svg class="tcg-ring" viewBox="0 0 100 100">
            <defs><path id="${tp}" d="M50,50 m-40,0 a40,40 0 1,1 80,0 a40,40 0 1,1 -80,0"/></defs>
            <circle cx="50" cy="50" r="47" class="r1"/><circle cx="50" cy="50" r="33" class="r2"/>
            <text><textPath href="#${tp}" startOffset="0">SAL A LA CALLE ✦ PINTA TU CIUDAD ✦ CONQUÍSTALA ✦</textPath></text>
          </svg>
          <svg class="tcg-pin" viewBox="0 0 100 120">
            <defs><linearGradient id="g${tp}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff6fb5"/><stop offset=".55" stop-color="#ff2e88"/><stop offset="1" stop-color="#b3125c"/></linearGradient></defs>
            <path d="M50,4 C27,4 11,21 11,43 C11,72 50,114 50,114 C50,114 89,72 89,43 C89,21 73,4 50,4 Z" fill="url(#g${tp})" stroke="#fff" stroke-width="3.5"/>
            <circle cx="50" cy="43" r="22" fill="#fff"/>
            <path d="M20,30 Q30,14 48,10" stroke="#fff" stroke-opacity=".55" stroke-width="4" fill="none" stroke-linecap="round"/>
          </svg>
          <div class="tcg-pin-ico">🖌️</div>
        </div>
        <div class="tcg-word"><span class="p">Pinta</span><span class="m">Mapa</span></div>
        <div class="tcg-ribbon"><span>CARTA DE CONQUISTA · Nº ${d.number || 1}/${d.total || 1}</span></div>
        <div class="tcg-back-txt">${d.player ? 'Conquistado por <b>' + esc(d.player) + '</b>' : ''}${date ? ' · ' + date : ''}</div>
        <div class="tcg-corner tl">${corner}</div><div class="tcg-corner tr">${corner}</div><div class="tcg-corner bl">${corner}</div><div class="tcg-corner br">${corner}</div>
      </div>
      <div class="tcg-shine back"></div><div class="tcg-glitter back"></div><div class="tcg-glare"></div>
    </div>`;
  }

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
            <div class="tcg-flavor">${esc(flavorText(d, T.name, R.name))}</div>
            <div class="tcg-foot"><span>${esc(d.credit || (d.own ? 'Foto: ' + (d.player || 'tuya') : 'Foto: Wikimedia Commons'))}</span>
              <span class="tcg-set">🖌️ ${d.number || 1}/${d.total || 1} <b>${R.sym}</b></span></div>
          </div>
          <div class="tcg-glare"></div>
        </div>
        ${backHTML(d, R)}
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
    if ((d.wiki || d.wd) && (!d.text || d.text.length < 350)) {
      longText(d).then((t) => {
        if (!t || t.length <= (d.text || '').length) return;
        d.text = t;
        const f = ov.querySelector(`.tcg[data-id="${d.id}"] .tcg-flavor`);
        const [, T] = typeOf(d.kind);
        if (f) f.textContent = flavorText(d, T.name, (RAR[d.rarity] || RAR.comun).name);
        if (opts.onText) opts.onText(t);
      }).catch(() => {});
    }
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
  .tcg-art { position: relative; height: 38%; flex: none; border-radius: .3em; overflow: hidden; border: .32em solid; border-image: linear-gradient(135deg, #f4f4f4, #9a9a9a, #fafafa, #8a8a8a) 1; box-shadow: 0 .2em .5em rgba(0,0,0,.35); background: #ddd; }
  .tcg-photo { position: absolute; inset: 0; background: center / cover no-repeat; display: grid; place-items: center; background-color: #e9e2d4; }
  .tcg-photo span { font-size: 4.5em; filter: drop-shadow(0 .1em .2em rgba(0,0,0,.3)); }
  .tcg-own { position: absolute; right: .4em; bottom: .4em; background: #ff2e88; color: #fff; font-size: .62em; font-weight: 800; padding: .2em .6em; border-radius: 99px; transform: rotate(-4deg); z-index: 3; }
  .tcg-band { margin: -.1em auto 0; font-size: .6em; font-style: italic; font-weight: 600; text-align: center; color: #3a2a00; background: linear-gradient(90deg, transparent, rgba(255,255,255,.75), transparent); padding: .2em 1.5em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  .tcg-moves { display: flex; flex-direction: column; justify-content: center; gap: .05em; margin-top: .2em; }
  .tcg-move { display: flex; align-items: center; gap: .45em; } .tcg-move b { flex: 1; font-size: .95em; font-weight: 900; color: #1b1b1b; } .tcg-move span { font-size: 1.05em; font-weight: 900; color: #1b1b1b; }
  .tcg-moves p { margin: 0 0 .25em 3.2em; font-size: .62em; line-height: 1.3; color: #2c2c2c; }
  .tcg-en { display: inline-flex; gap: .15em; min-width: 2.6em; } .tcg-en i { width: .95em; height: .95em; border-radius: 50%; box-shadow: inset 0 -.1em .15em rgba(0,0,0,.35), 0 0 0 .08em rgba(255,255,255,.7); }
  .tcg-wrr { display: flex; justify-content: space-between; border-top: .1em solid rgba(0,0,0,.25); padding-top: .2em; font-size: .7em; font-weight: 700; color: #222; }
  .tcg-wrr small { display: block; font-size: .7em; font-weight: 600; color: rgba(0,0,0,.55); text-transform: lowercase; }
  .tcg-flavor { flex: 1; min-height: 0; font-size: .6em; font-style: italic; line-height: 1.38; color: #2c2c2c; border: .12em solid rgba(160,120,20,.55); border-radius: .4em; padding: .4em .6em; background: rgba(255,255,255,.4);
    overflow: hidden; display: -webkit-box; -webkit-line-clamp: 9; -webkit-box-orient: vertical; text-align: justify; hyphens: auto; }
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
  .tcg-back { transform: rotateY(180deg); padding: 3.6%; background: linear-gradient(135deg, #f7d77a, #c9952a 30%, #fff1b8 50%, #b8841f 70%, #f3cf6b); }
  .tcg-back-in { position: relative; height: 100%; border-radius: 2.4% / 1.7%; overflow: hidden;
    background: radial-gradient(ellipse at 50% 38%, #3b1d6e 0%, #1a1550 45%, #0a0c2a 100%); box-shadow: inset 0 0 0 .18em #0a0c2a, inset 0 0 0 .32em #22d3ee, inset 0 0 2.5em rgba(0,0,0,.8); }
  .tcg-map { position: absolute; inset: 0; width: 100%; height: 100%; opacity: .9; animation: tcgpan 26s ease-in-out infinite alternate; }
  @keyframes tcgpan { to { transform: scale(1.12) translate(2%, -2%); } }
  .tcg-map path { fill: none; stroke: rgba(160,180,255,.16); stroke-width: 1.1; stroke-linecap: round; }
  .tcg-map path.on { stroke: #ff2e88; stroke-width: 1.5; filter: drop-shadow(0 0 1.4px #ff2e88); opacity: .85; }
  .tcg-map path.on.c { stroke: #22d3ee; filter: drop-shadow(0 0 1.4px #22d3ee); }
  .tcg-map path.big { stroke-width: 2.6; opacity: .7; }
  .tcg-rays { position: absolute; left: 50%; top: 40%; width: 170%; aspect-ratio: 1; transform: translate(-50%, -50%); border-radius: 50%;
    background: repeating-conic-gradient(from 0deg, rgba(255,46,136,.16) 0deg 6deg, transparent 6deg 15deg, rgba(34,211,238,.13) 15deg 21deg, transparent 21deg 30deg);
    -webkit-mask: radial-gradient(circle, #000 18%, transparent 62%); mask: radial-gradient(circle, #000 18%, transparent 62%); animation: tcgspin 60s linear infinite; }
  @keyframes tcgspin { to { transform: translate(-50%, -50%) rotate(360deg); } }
  .tcg-crest { position: absolute; left: 50%; top: 40%; width: 76%; aspect-ratio: 1; transform: translate(-50%, -50%); }
  .tcg-ring { position: absolute; inset: 0; width: 100%; height: 100%; animation: tcgring 40s linear infinite; filter: drop-shadow(0 0 .5em rgba(255,46,136,.6)); }
  @keyframes tcgring { to { transform: rotate(-360deg); } }
  .tcg-ring .r1 { fill: rgba(10,12,42,.55); stroke: #ffd166; stroke-width: 1.4; }
  .tcg-ring .r2 { fill: none; stroke: #ffd166; stroke-width: .8; stroke-dasharray: 1.5 2.2; }
  .tcg-ring text { fill: #ffe7a3; font: 800 7.2px Inter, system-ui, sans-serif; letter-spacing: 1.1px; }
  .tcg-pin { position: absolute; left: 50%; top: 47%; width: 44%; transform: translate(-50%, -50%); filter: drop-shadow(0 .4em .6em rgba(0,0,0,.6)) drop-shadow(0 0 1em rgba(255,46,136,.7)); animation: tcgbob 3.5s ease-in-out infinite; }
  @keyframes tcgbob { 50% { transform: translate(-50%, -56%); } }
  .tcg-pin-ico { position: absolute; left: 50%; top: 41%; transform: translate(-50%, -50%) rotate(-12deg); font-size: 2.6em; animation: tcgbob2 3.5s ease-in-out infinite; }
  @keyframes tcgbob2 { 50% { transform: translate(-50%, -62%) rotate(-12deg); } }
  .tcg-word { position: absolute; left: 0; right: 0; top: 71%; text-align: center; font-weight: 900; font-style: italic; letter-spacing: -.04em; font-size: 2.15em; line-height: 1; }
  .tcg-word .p { color: #ff2e88; text-shadow: 0 0 .35em #ff2e88, 0 .06em 0 #6d0b3c; } .tcg-word .m { color: #22d3ee; text-shadow: 0 0 .35em #22d3ee, 0 .06em 0 #064e5c; }
  .tcg-stars { position: absolute; top: 4.5%; left: 0; right: 0; text-align: center; letter-spacing: .3em; }
  .tcg-stars i { font-style: normal; color: #ffd166; font-size: 1em; text-shadow: 0 0 .5em #ffb700; }
  .tcg-ribbon { position: absolute; left: 50%; top: 81.5%; transform: translateX(-50%); white-space: nowrap; }
  .tcg-ribbon span { display: inline-block; font-size: .58em; font-weight: 900; letter-spacing: .14em; color: #3a2500; padding: .45em 1.6em; background: linear-gradient(180deg, #ffe7a3, #f2c14e 55%, #c99525);
    clip-path: polygon(0 0, 100% 0, 94% 50%, 100% 100%, 0 100%, 6% 50%); box-shadow: 0 .2em .4em rgba(0,0,0,.4); }
  .tcg-back-txt { position: absolute; bottom: 5.5%; left: 0; right: 0; text-align: center; color: #c9d1ff; font-size: .56em; }
  .tcg-back-txt b { color: #fff; }
  .tcg-corner { position: absolute; width: 15%; aspect-ratio: 1; } .tcg-corner svg { width: 100%; height: 100%; }
  .tcg-corner path { fill: none; stroke: #ffd166; stroke-width: 2.2; } .tcg-corner path.thin { stroke-width: 1; opacity: .7; } .tcg-corner circle { fill: #ffd166; filter: drop-shadow(0 0 2px #ffb700); }
  .tcg-corner.tl { top: 2.5%; left: 2.5%; } .tcg-corner.tr { top: 2.5%; right: 2.5%; transform: scaleX(-1); }
  .tcg-corner.bl { bottom: 2.5%; left: 2.5%; transform: scaleY(-1); } .tcg-corner.br { bottom: 2.5%; right: 2.5%; transform: scale(-1); }
  .tcg-shine.back { opacity: calc(.3 + var(--hyp) * .5); }
  .tcg-glitter.back { opacity: calc(.35 + var(--hyp) * .65); }
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
