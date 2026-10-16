// PintaMapa — cromos: cada monumento conquistado es un cromo con foto real (Wikipedia/Wikimedia) o TU foto
// con filtros de carta, marco según rareza (holográfico en legendarios), historia por detrás y para compartir.
PM.cards = (function () {
  const S = () => PM.state.data;
  const $ = (s) => document.querySelector(s);
  const isNative = PM.isNative;
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---------------- Información: Wikipedia → Wikidata → artículo cercano → foto cercana de Commons ----------------
  async function getJSON(url) {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 9000);
    try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
    finally { clearTimeout(to); }
  }
  const short = (t) => { t = String(t || '').replace(/\s+/g, ' ').trim(); if (t.length <= 280) return t; const c = t.slice(0, 280); return c.slice(0, c.lastIndexOf('. ') > 120 ? c.lastIndexOf('. ') + 1 : c.lastIndexOf(' ')) + '…'; };
  async function summary(lang, title) {
    const j = await getJSON(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
    // miniatura a 960 px (la original puede pesar varios MB)
    const th = j.thumbnail && j.thumbnail.source;
    const ow = j.originalimage && j.originalimage.width;   // Wikimedia solo sirve tamaños estándar (960 sí, 800 no)
    const img = th && /\/\d+px-/.test(th) && ow > 960 ? th.replace(/\/\d+px-/, '/960px-') : (j.originalimage && j.originalimage.source) || th || null;
    return { text: short(j.extract), img,
      thumb: j.thumbnail && j.thumbnail.source, url: j.content_urls && j.content_urls.desktop && j.content_urls.desktop.page, lang };
  }
  const commonsFile = (f) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(f)}?width=960`;
  async function fromWikidata(qid) {
    const j = await getJSON(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`);
    const e = j.entities[qid] || Object.values(j.entities)[0];
    const sl = e.sitelinks || {};
    const site = ['eswiki', 'cawiki', 'enwiki', 'glwiki', 'euwiki', 'frwiki', 'itwiki'].find((s) => sl[s]);
    const p18 = e.claims && e.claims.P18 && e.claims.P18[0].mainsnak.datavalue && e.claims.P18[0].mainsnak.datavalue.value;
    return { lang: site ? site.replace('wiki', '') : null, title: site ? sl[site].title : null, img: p18 ? commonsFile(p18) : null };
  }
  const words = (t) => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  async function nearbyArticle(lm) {
    for (const lang of ['es', 'ca']) {
      const j = await getJSON(`https://${lang}.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${lm.pos[0]}|${lm.pos[1]}&gsradius=120&gslimit=8&format=json&origin=*`);
      const mine = new Set(words(lm.name));
      const hit = (j.query && j.query.geosearch || []).find((g) => words(g.title).some((w) => mine.has(w)));
      if (hit) return summary(lang, hit.title);
    }
    return null;
  }
  async function nearbyPhoto(lm) {
    const j = await getJSON(`https://commons.wikimedia.org/w/api.php?action=query&generator=geosearch&ggscoord=${lm.pos[0]}|${lm.pos[1]}&ggsradius=60&ggsnamespace=6&ggslimit=6&prop=imageinfo&iiprop=url&iiurlwidth=960&format=json&origin=*`);
    const pages = Object.values((j.query && j.query.pages) || {}).filter((p) => p.imageinfo && /\.(jpe?g|png)$/i.test(p.title));
    return pages.length ? pages[0].imageinfo[0].thumburl : null;
  }
  async function fetchInfo(id, lm) {
    const cache = S().cardInfo[id];
    if (cache && (!cache.none || Date.now() - cache.t < 7 * 86400000)) return cache;
    let info = null;
    try {
      if (lm.wiki && /^[a-z]{2,3}:/.test(lm.wiki)) { const [lang, ...t] = lm.wiki.split(':'); info = await summary(lang, t.join(':')); }
      if (lm.wd && (!info || !info.img || info.lang !== 'es')) {
        const wd = await fromWikidata(lm.wd);
        if (wd.title && (!info || (info.lang !== 'es' && wd.lang === 'es'))) info = Object.assign(await summary(wd.lang, wd.title), info && !info.text ? {} : {});
        if (info && !info.img && wd.img) info.img = wd.img;
        if (!info && wd.img) info = { img: wd.img, text: '' };
      }
      if (!info || (!info.text && !info.img)) info = (await nearbyArticle(lm)) || info;
      if (!info || !info.img) { const ph = await nearbyPhoto(lm); if (ph) info = Object.assign(info || { text: '' }, { img: ph, credit: 'Foto: Wikimedia Commons' }); }
    } catch (e) { if (!info) return cache || null; }   // sin conexión: se reintentará
    const rec = info && (info.img || info.text)
      ? { img: info.img || null, text: info.text || '', url: info.url || null, credit: info.credit || (info.url ? 'Texto y foto: Wikipedia (CC BY-SA)' : 'Foto: Wikimedia Commons'), t: Date.now() }
      : { none: true, t: Date.now() };
    S().cardInfo[id] = rec; PM.state.save();
    return rec;
  }

  // ---------------- Fotos propias (en el móvil, IndexedDB) ----------------
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => { const r = indexedDB.open('pintamapa_fotos', 1); r.onupgradeneeded = () => r.result.createObjectStore('fotos'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return dbp;
  }
  async function getPhoto(id) { try { const d = await db(); return await new Promise((res) => { const q = d.transaction('fotos').objectStore('fotos').get(id); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch (e) { return null; } }
  async function putPhoto(id, dataUrl) { const d = await db(); d.transaction('fotos', 'readwrite').objectStore('fotos').put(dataUrl, id); }

  // ---------------- Filtros de cromo ----------------
  const FILTERS = [
    { id: 'holo', name: '✨ Holo' }, { id: 'neon', name: '💗 Neón' }, { id: 'retro', name: '📼 Retro' },
    { id: 'comic', name: '💥 Cómic' }, { id: 'orig', name: '📷 Original' },
  ];
  function loadImg(src) {
    return new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = src; });
  }
  // recorte "formato carta" (3:4), centrado
  function cropCard(img, w = 900) {
    const h = Math.round(w * 4 / 3);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const r = Math.max(w / img.width, h / img.height);
    const dw = img.width * r, dh = img.height * r;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    return c;
  }
  function applyFilter(src, id) {
    const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
    const ctx = c.getContext('2d'), W = c.width, H = c.height;
    const base = { holo: 'saturate(1.45) contrast(1.15) brightness(1.05)', neon: 'contrast(1.2)', retro: 'sepia(0.55) saturate(0.85) contrast(0.95) brightness(1.05)',
      comic: 'saturate(1.6) contrast(1.35)', orig: 'saturate(1.12) contrast(1.06)' }[id] || 'none';
    ctx.filter = base; ctx.drawImage(src, 0, 0); ctx.filter = 'none';
    const px = () => ctx.getImageData(0, 0, W, H);
    if (id === 'neon') {   // duotono PintaMapa: sombras moradas → rosa → cian
      const d = px(), a = d.data;
      const stops = [[26, 16, 51], [255, 46, 136], [34, 211, 238]];
      for (let i = 0; i < a.length; i += 4) {
        const l = (a[i] * 0.3 + a[i + 1] * 0.59 + a[i + 2] * 0.11) / 255;
        const [s0, s1, t] = l < 0.55 ? [stops[0], stops[1], l / 0.55] : [stops[1], stops[2], (l - 0.55) / 0.45];
        a[i] = s0[0] + (s1[0] - s0[0]) * t; a[i + 1] = s0[1] + (s1[1] - s0[1]) * t; a[i + 2] = s0[2] + (s1[2] - s0[2]) * t;
      }
      ctx.putImageData(d, 0, 0);
    }
    if (id === 'comic') {  // colores planos + tramado de puntos
      const d = px(), a = d.data, q = 64;
      for (let i = 0; i < a.length; i += 4) { a[i] = Math.round(a[i] / q) * q; a[i + 1] = Math.round(a[i + 1] / q) * q; a[i + 2] = Math.round(a[i + 2] / q) * q; }
      ctx.putImageData(d, 0, 0);
      ctx.globalCompositeOperation = 'multiply';
      for (let y = 0; y < H; y += 12) for (let x = (y / 12) % 2 ? 6 : 0; x < W; x += 12) {
        const p = ctx.getImageData(x, y, 1, 1).data, l = (p[0] + p[1] + p[2]) / 765;
        ctx.fillStyle = 'rgba(20,10,40,0.55)'; ctx.beginPath(); ctx.arc(x, y, (1 - l) * 4.5, 0, 6.29); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    if (id === 'retro') {  // grano
      const d = px(), a = d.data;
      for (let i = 0; i < a.length; i += 4) { const n = (Math.random() - 0.5) * 34; a[i] += n; a[i + 1] += n; a[i + 2] += n; }
      ctx.putImageData(d, 0, 0);
    }
    if (id === 'holo') {   // reflejo arcoíris
      const g = ctx.createLinearGradient(0, 0, W, H);
      ['#ff2e88', '#ffd166', '#22d3ee', '#a855f7', '#ff2e88'].forEach((col, i, arr) => g.addColorStop(i / (arr.length - 1), col));
      ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.35; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    // viñeta suave para todos
    const v = ctx.createRadialGradient(W / 2, H / 2, W * 0.35, W / 2, H / 2, W * 0.85);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, id === 'retro' ? 'rgba(40,20,0,0.55)' : 'rgba(0,0,0,0.35)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    return c;
  }

  // ---------------- Cámara ----------------
  async function takePhoto() {
    const Cam = isNative && window.Capacitor.Plugins && window.Capacitor.Plugins.Camera;
    if (Cam) {
      const p = await Cam.getPhoto({ quality: 85, width: 1400, allowEditing: false, resultType: 'dataUrl', source: 'PROMPT', correctOrientation: true,
        promptLabelHeader: 'Foto para el cromo', promptLabelPhoto: 'Elegir de la galería', promptLabelPicture: 'Hacer una foto', promptLabelCancel: 'Cancelar' });
      return p.dataUrl;
    }
    return new Promise((res, rej) => {   // web: selector de archivo / cámara del navegador
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment';
      inp.onchange = () => { const f = inp.files[0]; if (!f) return rej(new Error('cancelado')); const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(f); };
      inp.click();
    });
  }

  // ---------------- Vista del cromo ----------------
  function recOf(id) { return S().landmarks[id]; }
  function number(id) { return Object.keys(S().landmarks).sort((a, b) => S().landmarks[a].t - S().landmarks[b].t).indexOf(id) + 1; }
  async function imageFor(id) {
    const mine = await getPhoto(id);
    if (mine) return { src: mine, own: true };
    const info = S().cardInfo[id];
    return info && info.img ? { src: info.img, own: false } : null;
  }
  function cardHTML(id, rec, img, info, big) {
    const R = PM.world.RARITY[rec.rarity] || PM.world.RARITY.comun;
    const own = img && img.own;
    return `<div class="cromo r-${rec.rarity} ${big ? 'big' : ''}" data-id="${id}">
      <div class="cromo-in">
        <div class="cara front">
          <div class="foto ${img ? '' : 'vacia'}" ${img ? `style="background-image:url('${img.src}')"` : ''}>${img ? '' : `<span>${rec.emoji}</span><em>📸 Sin foto</em>`}</div>
          <div class="holo"></div>
          <div class="cinta" style="background:${R.color}">${R.label}</div>
          <div class="num">#${number(id)}</div>
          ${own ? '<div class="sello">📸 Foto propia</div>' : ''}
          <div class="pie"><b>${esc(rec.name)}</b><small>${rec.emoji} ${esc(rec.kind)}${rec.city ? ' · ' + esc(rec.city) : ''}</small></div>
        </div>
        ${big ? `<div class="cara back">
          <h3>${rec.emoji} ${esc(rec.name)}</h3>
          <p>${info && info.text ? esc(info.text) : 'Todavía no sabemos su historia. ¡Tú lo has descubierto!'}</p>
          <ul>
            <li>🚩 Conquistado el <b>${new Date(rec.t).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}</b></li>
            <li>🔁 Visitas: <b>${rec.visits || 1}</b></li>
            ${rec.barrio ? `<li>🏘️ Barrio: <b>${esc(rec.barrio)}</b></li>` : ''}
            <li>⭐ Rareza: <b>${R.label}</b></li>
          </ul>
          <small>${own ? 'Foto: tuya 📸' : esc((info && info.credit) || '')}${info && info.url ? ` · <a href="${info.url}" target="_blank">Leer más</a>` : ''}</small>
        </div>` : ''}
      </div></div>`;
  }

  // Inclinación del móvil → brillo holográfico
  let tiltOn = false;
  function tilt(e) {
    const el = document.querySelector('#cromo-view .cromo');
    if (!el || e.beta == null) return;
    const rx = Math.max(-18, Math.min(18, (e.beta - 45) / 2)), ry = Math.max(-18, Math.min(18, e.gamma / 2));
    el.style.setProperty('--rx', rx + 'deg'); el.style.setProperty('--ry', ry + 'deg');
    el.style.setProperty('--hx', (50 + ry * 2.5) + '%'); el.style.setProperty('--hy', (50 + rx * 2.5) + '%');
  }

  // datos de la carta (anverso estilo TCG) para un monumento conquistado
  async function dataFor(id) {
    const rec = recOf(id), info = S().cardInfo[id] || {};
    const img = await imageFor(id);
    const all = Object.keys(S().landmarks);
    const lm = PM.world.landmarks[id] || {};
    return { id, name: rec.name, kind: rec.kind, emoji: rec.emoji, rarity: rec.rarity, city: rec.city, barrio: rec.barrio, t: rec.t, visits: rec.visits, pos: rec.pos || lm.pos, color: S().color,
      wiki: rec.wiki || lm.wiki, wd: rec.wd || lm.wd,
      img: img && img.src, own: !!(img && img.own), text: info.text, credit: img && img.own ? 'Foto: ' + (PM.player ? PM.player.name : 'tuya') : info.credit,
      points: 100 * ((PM.world.RARITY[rec.rarity] || {}).mult || 1), number: number(id), total: all.length, player: PM.player && PM.player.name };
  }

  async function open(id, opts = {}) {
    if (!recOf(id)) return;
    const show = async () => {
      const d = await dataFor(id);
      PM.tcg.open(d, {
        badge: opts.isNew ? `¡Nueva carta! ${opts.pts ? '+' + opts.pts + ' pts' : ''}` : '',
        actions: [{ label: d.own ? '📸 Cambiar foto' : d.img ? '📸 Tu foto' : '📸 Hazle la foto', primary: !d.img, on: () => editPhoto(id, show) }],
        onText: (t) => { const ci = S().cardInfo[id] || (S().cardInfo[id] = { t: Date.now() }); ci.text = t; delete ci.none; PM.state.save(); },
      });
    };
    await show();
    const cache = S().cardInfo[id];
    if (!cache || (cache.none && Date.now() - cache.t > 7 * 86400000)) {
      const rec = recOf(id);
      fetchInfo(id, PM.world.landmarks[id] || Object.assign({ id, pos: rec.pos }, rec)).then((inf) => {
        const ov = document.getElementById('tcg-view');
        if (inf && !inf.none && ov && ov.classList.contains('show') && ov.querySelector(`.tcg[data-id="${id}"]`)) show();
      });
    }
  }
  function close() { PM.tcg.close(); }

  // ---------------- Editor de foto con filtros ----------------
  async function editPhoto(id, after) {
    let data;
    try { data = await takePhoto(); } catch (e) { return; }
    const img = await loadImg(data);
    const crop = cropCard(img);
    let cur = 'holo';
    const ov = document.createElement('div');
    ov.id = 'foto-editor';
    ov.innerHTML = `<div class="fe-in"><h3>Elige el filtro de tu cromo</h3><div class="fe-prev"><canvas></canvas><div class="holo"></div></div>
      <div class="fe-filters">${FILTERS.map((f) => `<button class="btn ${f.id === cur ? 'on' : ''}" data-f="${f.id}">${f.name}</button>`).join('')}</div>
      <div class="cv-actions"><button class="btn" id="fe-cancel">Cancelar</button><button class="btn on" id="fe-save">💾 Guardar cromo</button></div></div>`;
    document.body.appendChild(ov);
    const cv = ov.querySelector('canvas');
    const draw = () => { const out = applyFilter(crop, cur); cv.width = out.width; cv.height = out.height; cv.getContext('2d').drawImage(out, 0, 0); };
    draw();
    ov.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => {
      cur = b.dataset.f; ov.querySelectorAll('[data-f]').forEach((x) => x.classList.toggle('on', x === b)); draw();
    }));
    $('#fe-cancel').addEventListener('click', () => ov.remove());
    $('#fe-save').addEventListener('click', async () => {
      await putPhoto(id, cv.toDataURL('image/jpeg', 0.82));
      const first = !S().cardPhotos[id];
      S().cardPhotos[id] = { filter: cur, t: Date.now() };
      PM.state.save();
      ov.remove();
      if (first && PM.game.photoTaken) PM.game.photoTaken(id);
      if (PM.cloud && PM.cloud.auto) PM.cloud.auto();   // sube la foto (cifrada) para verla también en «Mi progreso»
      if (after) after();
    });
  }

  // ---------------- Compartir (imagen del cromo) ----------------
  async function renderShare(id) {
    const rec = recOf(id), R = PM.world.RARITY[rec.rarity] || PM.world.RARITY.comun;
    const W = 1080, H = 1512, c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const bg = ctx.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#141722'); bg.addColorStop(1, R.color);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); };
    ctx.fillStyle = '#fff'; rr(40, 40, W - 80, H - 80, 48); ctx.fill();
    ctx.lineWidth = 18; ctx.strokeStyle = R.color; rr(40, 40, W - 80, H - 80, 48); ctx.stroke();
    // foto
    const img = await imageFor(id);
    ctx.save(); rr(90, 170, W - 180, 860, 28); ctx.clip();
    if (img) {
      try {
        const i = await loadImg(img.src);
        const crop = img.own ? i : applyFilter(cropCard(i, 900), 'orig');
        const r = Math.max((W - 180) / crop.width, 860 / crop.height);
        ctx.drawImage(crop, 90 + ((W - 180) - crop.width * r) / 2, 170 + (860 - crop.height * r) / 2, crop.width * r, crop.height * r);
      } catch (e) { ctx.fillStyle = '#eef1f7'; ctx.fillRect(90, 170, W - 180, 860); }
    } else { ctx.fillStyle = '#eef1f7'; ctx.fillRect(90, 170, W - 180, 860); ctx.font = '260px serif'; ctx.textAlign = 'center'; ctx.fillText(rec.emoji, W / 2, 700); }
    if (rec.rarity === 'legendario' || rec.rarity === 'epico') {
      const g = ctx.createLinearGradient(90, 170, W - 90, 1030);
      ['rgba(255,46,136,.25)', 'rgba(255,209,102,.2)', 'rgba(34,211,238,.25)', 'rgba(168,85,247,.2)'].forEach((col, k, a) => g.addColorStop(k / (a.length - 1), col));
      ctx.fillStyle = g; ctx.fillRect(90, 170, W - 180, 860);
    }
    ctx.restore();
    // textos
    ctx.textAlign = 'left'; ctx.fillStyle = '#ff2e88'; ctx.font = 'italic 900 64px sans-serif'; ctx.fillText('Pinta', 90, 130);
    ctx.fillStyle = '#22d3ee'; ctx.fillText('Mapa', 90 + ctx.measureText('Pinta').width, 130);
    ctx.textAlign = 'right'; ctx.fillStyle = R.color; ctx.font = '900 44px sans-serif'; ctx.fillText(R.label.toUpperCase() + '  #' + number(id), W - 90, 125);
    ctx.textAlign = 'left'; ctx.fillStyle = '#1a1d29'; ctx.font = '900 66px sans-serif';
    const name = rec.name.length > 26 ? rec.name.slice(0, 25) + '…' : rec.name;
    ctx.fillText(name, 90, 1120);
    ctx.fillStyle = '#5d6578'; ctx.font = '500 40px sans-serif';
    ctx.fillText(`${rec.emoji} ${rec.kind}${rec.city ? ' · ' + rec.city : ''}`, 90, 1190);
    ctx.fillText(`🚩 Conquistado el ${new Date(rec.t).toLocaleDateString('es-ES')}${PM.player ? ' por ' + PM.player.name : ''}`, 90, 1260);
    if (img && img.own) { ctx.fillStyle = '#ff2e88'; ctx.font = '800 38px sans-serif'; ctx.fillText('📸 Foto propia', 90, 1330); }
    ctx.fillStyle = '#9aa3b5'; ctx.font = '400 28px sans-serif';
    ctx.fillText(img && !img.own ? 'Foto: Wikimedia Commons (CC BY-SA)' : 'Sal a la calle. Pinta tu ciudad. Conquístala.', 90, 1410);
    return c.toDataURL('image/png');
  }
  async function share(id) {
    const rec = recOf(id);
    let url;
    try { url = await renderShare(id); } catch (e) { alert('No se pudo crear la imagen del cromo'); return; }
    const text = `He conquistado «${rec.name}» en PintaMapa 🖌️🚩`;
    const P = isNative && window.Capacitor.Plugins;
    if (P && P.Filesystem && P.Share) {
      const f = await P.Filesystem.writeFile({ path: `cromo-${id}.png`, data: url.split(',')[1], directory: 'CACHE' });
      await P.Share.share({ title: rec.name, text, files: [f.uri], dialogTitle: 'Compartir cromo' }).catch(() => {});
      return;
    }
    const blob = await (await fetch(url)).blob();
    const file = new File([blob], `cromo-${id}.png`, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text }).catch(() => {}); return; }
    const a = document.createElement('a'); a.href = url; a.download = `PintaMapa-${rec.name}.png`; a.click();
  }

  // ---------------- Colecciones ----------------
  const SETS = [
    { id: 'ayto', name: 'Ayuntamientos', icon: '🏛️', kinds: ['Ayuntamiento'], goals: [1, 3, 10] },
    { id: 'templos', name: 'Iglesias y catedrales', icon: '⛪', kinds: ['Iglesia', 'Iglesia principal', 'Basílica', 'Catedral', 'Templo'], goals: [3, 10, 25] },
    { id: 'historia', name: 'Historia', icon: '🏰', kinds: ['Castillo', 'Monumento', 'Torre / Puerta', 'Ruinas', 'Lugar histórico', 'Memorial'], goals: [3, 10, 25] },
    { id: 'cultura', name: 'Cultura', icon: '🎭', kinds: ['Museo', 'Teatro', 'Biblioteca', 'Universidad'], goals: [3, 10, 25] },
    { id: 'deporte', name: 'Deporte', icon: '🏟️', kinds: ['Estadio', 'Campo de fútbol'], goals: [2, 5, 15] },
    { id: 'verde', name: 'Parques y miradores', icon: '🌳', kinds: ['Parque', 'Mirador'], goals: [3, 10, 30] },
    { id: 'ciudad', name: 'Vida de ciudad', icon: '🏙️', kinds: ['Plaza', 'Fuente', 'Mercado', 'Estación', 'Arte urbano', 'Faro', 'Atracción'], goals: [5, 15, 40] },
    { id: 'fotos', name: 'Fotógrafo', icon: '📸', photos: true, goals: [1, 10, 30] },
  ];
  const TIER = ['🥉 Bronce', '🥈 Plata', '🥇 Oro'];
  function setCount(set) {
    if (set.photos) return Object.keys(S().cardPhotos || {}).length;
    return Object.values(S().landmarks).filter((r) => set.kinds.includes(r.kind)).length;
  }

  function album(container) {
    const s = S();
    const ids = Object.keys(s.landmarks).sort((a, b) => s.landmarks[b].t - s.landmarks[a].t);
    let tab = 'cromos';
    const draw = async () => {
      let html = `<div class="seg tabs"><button class="btn ${tab === 'cromos' ? 'on' : ''}" data-t="cromos">🃏 Cromos (${ids.length})</button>
        <button class="btn ${tab === 'col' ? 'on' : ''}" data-t="col">📚 Colecciones</button>
        <button class="btn ${tab === 'bar' ? 'on' : ''}" data-t="bar">🏘️ Barrios (${Object.keys(s.barrioCards || {}).length})</button></div>`;
      if (tab === 'cromos') {
        if (!ids.length) html += '<p class="muted">Aún no tienes cromos. Quédate 10 s junto a un monumento, iglesia, plaza… para conquistarlo.</p>';
        html += '<div id="city-stacks"></div>';
      } else if (tab === 'col') {
        // por ciudad: conquistados / descubiertos
        const byCity = {};
        for (const [id, r] of Object.entries(s.landmarks)) { const c = r.city || 'Otras'; (byCity[c] = byCity[c] || { got: 0, known: new Set() }).got++; byCity[c].known.add(id); }
        for (const lm of Object.values(PM.world.landmarks)) { const c = PM.world.cityAt(lm.pos); if (c && byCity[c]) byCity[c].known.add(lm.id); else if (c) (byCity[c] = { got: 0, known: new Set([lm.id]) }); }
        html += '<h4>Por ciudad</h4>' + Object.entries(byCity).sort((a, b) => b[1].got - a[1].got).map(([c, v]) =>
          `<div class="mission"><div class="mt">🏙️ ${esc(c)}<span>${v.got}/${v.known.size}</span></div><div class="bar"><i style="width:${(v.got / Math.max(1, v.known.size) * 100).toFixed(0)}%"></i></div>
           <small>Descubiertos al explorar: cuanto más andes, más aparecen.</small></div>`).join('');
        html += '<h4>Colecciones temáticas</h4>' + SETS.map((set) => {
          const n = setCount(set), tier = s.setsDone[set.id] || 0, next = set.goals[tier];
          return `<div class="mission ${tier >= 3 ? 'done' : ''}"><div class="mt">${set.icon} ${set.name}<span>${tier ? TIER[tier - 1] : ''}</span></div>
            <div class="bar"><i style="width:${next ? Math.min(100, n / next * 100) : 100}%"></i></div>
            <small>${n} ${next ? '/ ' + next + ' para ' + TIER[tier] : '· ¡colección completa!'}</small></div>`;
        }).join('');
      } else {
        const bc = Object.entries(s.barrioCards || {}).sort((a, b) => b[1].t - a[1].t);
        html += bc.length ? '<div class="cromos">' + bc.map(([id, b]) => barrioCardHTML(b)).join('') + '</div>'
          : '<p class="muted">Conquista un barrio (pinta el 80 % de sus calles) y aquí aparecerá su cromo con la silueta pintada de tu color.</p>';
        const cities = Object.entries(s.cityCards || {});
        if (cities.length) html += '<h4>👑 Ciudades</h4><div class="cromos">' + cities.map(([c, v]) => `<div class="cromo r-legendario city"><div class="cromo-in"><div class="cara front">
          <div class="foto vacia"><span>👑</span></div><div class="holo"></div><div class="cinta" style="background:#ffb700">Ciudad</div>
          <div class="pie"><b>${esc(c)}</b><small>Conquistada el ${new Date(v.t).toLocaleDateString('es-ES')}</small></div></div></div></div>`).join('') + '</div>';
      }
      container.innerHTML = html;
      if (tab === 'cromos' && ids.length) {
        // mazos por ciudad (la que más cartas tiene, primero): se despliegan al tocar
        const byCity = {};
        for (const id of ids) { const c = s.landmarks[id].city || 'Otros lugares'; (byCity[c] = byCity[c] || []).push(id); }
        const groups = Object.entries(byCity).sort((a, b) => b[1].length - a[1].length).map(([city, list]) => ({ city, ids: list }));
        PM.tcg.stacks(container.querySelector('#city-stacks'), groups, dataFor, (el, id) => el.addEventListener('click', () => open(id)), 'cromos');
      }
      container.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.t; draw(); }));
      container.querySelectorAll('.cromo[data-id], .tcg[data-id]').forEach((el) => el.addEventListener('click', () => open(el.dataset.id)));
    };
    draw();
    // completar info de los cromos que aún no la tienen (poco a poco)
    (async () => { for (const id of ids) if (!s.cardInfo[id]) { const r = s.landmarks[id]; await fetchInfo(id, PM.world.landmarks[id] || Object.assign({ id, pos: r.pos }, r)); } if (tab === 'cromos') draw(); })();
  }

  function barrioCardHTML(b) {
    // silueta: las calles pintadas del barrio, en tu color
    let svg = '';
    if (b.lines && b.lines.length) {
      let s = 90, w = 180, n = -90, e = -180;
      b.lines.forEach((l) => l.forEach((p) => { s = Math.min(s, p[0]); n = Math.max(n, p[0]); w = Math.min(w, p[1]); e = Math.max(e, p[1]); }));
      const k = Math.cos(((s + n) / 2) * Math.PI / 180), sx = (e - w) * k || 1e-6, sy = (n - s) || 1e-6, sc = 90 / Math.max(sx, sy);
      const P = (p) => `${(5 + (p[1] - w) * k * sc).toFixed(1)},${(5 + (n - p[0]) * sc).toFixed(1)}`;
      svg = `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">${b.lines.map((l) => `<polyline points="${l.map(P).join(' ')}"/>`).join('')}</svg>`;
    }
    return `<div class="cromo r-epico barrio"><div class="cromo-in"><div class="cara front">
      <div class="foto vacia sil" style="--paint:${b.color || S().color}">${svg || '<span>🏘️</span>'}</div><div class="holo"></div>
      <div class="cinta" style="background:#b65cff">Barrio</div>
      <div class="pie"><b>${esc(b.name)}</b><small>${b.city ? esc(b.city) + ' · ' : ''}${new Date(b.t).toLocaleDateString('es-ES')}</small></div></div></div></div>`;
  }

  return { open, close, album, fetchInfo, dataFor, SETS, setCount, getPhoto, FILTERS, _img: { loadImg, cropCard, applyFilter } };
})();
