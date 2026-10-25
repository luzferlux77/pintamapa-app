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
  // las cartas se cuentan en el idioma elegido: su Wikipedia, su descripción de Wikidata, su barrio…
  const LANG = () => (PM.i18n && PM.i18n.lang) || 'es';
  const commonsFile = (f) => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(f)}?width=960`;
  async function fromWikidata(qid) {
    const j = await getJSON(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`);
    const e = j.entities[qid] || Object.values(j.entities)[0];
    const sl = e.sitelinks || {};
    const L = LANG(), site = sl[L + 'wiki'] ? L + 'wiki' : null;   // (el artículo solo si está en el idioma elegido)
    const p18 = e.claims && e.claims.P18 && e.claims.P18[0].mainsnak.datavalue && e.claims.P18[0].mainsnak.datavalue.value;
    const ds = e.descriptions || {}, desc = (ds[L] || {}).value || null;   // «biblioteca pública de Barcelona»…
    // (sin artículo en el idioma: el de otro sirve para la FOTO)
    const otro = ['eswiki', 'cawiki', 'enwiki', 'frwiki', 'itwiki', 'dewiki'].find((x) => sl[x]);
    return { lang: site ? L : null, title: site ? sl[site].title : null, img: p18 ? commonsFile(p18) : null, desc,
      otro: otro ? [otro.replace('wiki', ''), sl[otro].title] : null };
  }
  const words = (t) => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  // palabras que no identifican un sitio (tipos de lugar, ciudades, países…): no bastan para decir que una foto o un
  // artículo de los alrededores es de ESTE lugar (con «catedral», el «Hotel Catalonia Catedral» cogía la foto del mural
  // del beso y podía coger el artículo de la catedral)
  const GENERICAS = new Set(('catedral cathedral iglesia esglesia eglise church chiesa basilica capilla capella chapel ermita convento convent monasterio monestir ' +
    'hotel hostal hostel apartamentos restaurante restaurant cafe cafeteria plaza placa piazza place square carrer calle avenida avinguda passeig paseo street ' +
    'museo museu museum musee palacio palau palace castillo castell castle torre tower puerta porta gate parque park jardin jardi garden fuente font fountain ' +
    'mercado mercat market teatro teatre theatre theater biblioteca library escuela escola school casa house edificio edifici building monumento monument estatua statue ' +
    'barcelona madrid valencia sevilla catalonia catalunya cataluna spain espana espanya europe paris london londres roma rome mexico city ciudad ciutat ' +
    'santa santo sant saint nuestra senora mare deu').split(' '));
  const propias = (t) => words(t).filter((w) => !GENERICAS.has(w));
  // ¿el título (de un artículo o una foto) es de este lugar? Hace falta compartir sus palabras PROPIAS (todas si son 1-2)
  function esDeEste(title, name) {
    const mine = propias(name), his = new Set(propias(title));
    if (!mine.length) return false;   // nombre sin nada propio («Catedral», «Hotel Plaza»): mejor sin foto que con la de otro
    const hits = mine.filter((w) => his.has(w)).length;
    return hits >= Math.min(2, mine.length);
  }
  // el título de este artículo en el idioma elegido (por los enlaces entre Wikipedias)
  async function enIdioma(lang, title) {
    const L = LANG();
    if (lang === L) return title;
    const j = await getJSON(`https://${lang}.wikipedia.org/w/api.php?action=query&prop=langlinks&lllang=${L}&titles=${encodeURIComponent(title)}&format=json&origin=*`);
    const pg = Object.values((j.query && j.query.pages) || {})[0];
    return (pg && pg.langlinks && pg.langlinks[0] && pg.langlinks[0]['*']) || null;
  }
  async function nearbyArticle(lm) {
    for (const lang of [LANG()]) {
      const j = await getJSON(`https://${lang}.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${lm.pos[0]}|${lm.pos[1]}&gsradius=120&gslimit=8&format=json&origin=*`);
      const hit = (j.query && j.query.geosearch || []).find((g) => esDeEste(g.title, lm.name));
      if (hit) return summary(lang, hit.title);
    }
    return null;
  }
  async function nearbyPhoto(lm) {
    const j = await getJSON(`https://commons.wikimedia.org/w/api.php?action=query&generator=geosearch&ggscoord=${lm.pos[0]}|${lm.pos[1]}&ggsradius=60&ggsnamespace=6&ggslimit=6&prop=imageinfo&iiprop=url&iiurlwidth=960&format=json&origin=*`);
    // (solo una foto cuyo nombre de archivo sea de ESTE sitio: antes valía cualquiera a menos de 60 m)
    const pages = Object.values((j.query && j.query.pages) || {}).filter((p) => p.imageinfo && /\.(jpe?g|png)$/i.test(p.title) && esDeEste(p.title.replace(/^File:|\.[a-z]+$/gi, ''), lm.name));
    return pages.length ? pages[0].imageinfo[0].thumburl : null;
  }
  // dirección (OpenStreetMap) y primera frase del artículo de su barrio en Wikipedia
  async function contexto(lm) {
    const out = {};
    try {
      const j = await getJSON(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=${LANG()}&lat=${lm.pos[0]}&lon=${lm.pos[1]}`);
      const a = (j && j.address) || {};
      if (a.road) out.addr = a.road + (a.house_number ? ', ' + a.house_number : '');
      const barrio = a.neighbourhood || a.quarter || a.suburb, city = a.city || a.town || a.village;
      if (barrio) {
        for (const t of [barrio + ' (' + city + ')', barrio]) {
          try {
            const s = await getJSON(`https://${LANG()}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t.replace(/ /g, '_'))}`);
            if (s && s.type === 'standard' && s.extract && (!city || s.extract.includes(city) || t !== barrio)) { out.ctx = (s.extract.match(/^[^.!?]+[.!?]/) || [s.extract])[0]; break; }
          } catch (e) { /* sin artículo con ese título */ }
        }
      }
    } catch (e) { /* sin conexión */ }
    return out;
  }
  const vieja = (c) => c.v !== 2 && c.credit === 'Foto: Wikimedia Commons' && !c.text;
  const otraLengua = (c) => (c.lang || 'es') !== LANG();
  // ¿hay que volver a buscar la información de esta carta?
  const caduca = (c) => !c || vieja(c) || otraLengua(c) || (c.none && Date.now() - c.t > 7 * 86400000);
  async function fetchInfo(id, lm) {
    const cache = S().cardInfo[id], L = LANG();
    // (las fotos de los alrededores elegidas con la regla antigua —cualquier foto a menos de 60 m— se revisan; y al
    // cambiar de idioma, el texto se vuelve a buscar en el nuevo)
    if (cache && !caduca(cache)) return cache;
    let info = null, foto = null;
    try {
      // su artículo de Wikipedia EN EL IDIOMA ELEGIDO (de un artículo en otro idioma solo se aprovecha la foto)
      if (lm.wiki && /^[a-z]{2,3}:/.test(lm.wiki)) {
        const [lang, ...t] = lm.wiki.split(':');
        const tl = await enIdioma(lang, t.join(':')).catch(() => null);
        if (tl) info = await summary(L, tl);
        else foto = (await summary(lang, t.join(':')).catch(() => ({}))).img || null;
      }
      if (lm.wd && (!info || !info.img || !info.text)) {
        const wd = await fromWikidata(lm.wd);
        if (wd.title && (!info || !info.text)) info = await summary(L, wd.title);
        if (!foto && !wd.img && wd.otro && !(info && info.img)) foto = (await summary(wd.otro[0], wd.otro[1]).catch(() => ({}))).img || null;
        if (info && !info.img && wd.img) info.img = wd.img;
        if (!info && (wd.img || wd.desc)) info = { img: wd.img || null, text: '' };
        if (info && wd.desc) info.desc = wd.desc;
      }
      if (foto && !(info && info.img)) info = Object.assign(info || { text: '' }, { img: foto, credit: 'Foto: Wikipedia (CC BY-SA)' });
      if (!info || (!info.text && !info.img)) info = (await nearbyArticle(lm)) || info;
      if (!info || !info.img) { const ph = await nearbyPhoto(lm); if (ph) info = Object.assign(info || { text: '' }, { img: ph, credit: 'Foto: Wikimedia Commons' }); }
      // sin artículo propio: datos reales de ESE sitio para la descripción (su dirección y una frase de su barrio)
      if (!info || !info.text) Object.assign(info || (info = { text: '' }), await contexto(lm));
    } catch (e) { if (!info) return cache || null; }   // sin conexión: se reintentará
    const rec = info && (info.img || info.text || info.desc || info.addr || info.ctx)
      ? { v: 2, lang: L, img: info.img || null, text: info.text || '', desc: info.desc || null, addr: info.addr || null, ctx: info.ctx || null, url: info.url || null, credit: info.credit || (info.url ? 'Texto y foto: Wikipedia (CC BY-SA)' : 'Foto: Wikimedia Commons'), t: Date.now() }
      : { none: true, lang: L, t: Date.now() };
    S().cardInfo[id] = rec; PM.state.save();
    return rec;
  }

  // ---------------- Fotos propias (en el móvil, IndexedDB) ----------------
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((res, rej) => { const r = indexedDB.open('pintamapa_fotos', 1); r.onupgradeneeded = () => r.result.createObjectStore('fotos'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    return dbp;
  }
  // Cada pintor tiene sus fotos («pintor:lugar»): antes la clave era solo el lugar y otro pintor del mismo móvil veía
  // (y firmaba) la foto ajena. Las fotos antiguas, guardadas solo con el lugar, siguen valiendo para el pintor que
  // tiene esa foto apuntada en su partida.
  const fotoKey = (id) => (PM.player ? PM.player.slug + ':' : '') + id;
  async function getPhoto(id) {
    if (!(S().cardPhotos || {})[id]) return null;   // (este pintor no le hizo foto)
    try {
      const d = await db();
      const get = (k) => new Promise((res) => { const q = d.transaction('fotos').objectStore('fotos').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); });
      return (await get(fotoKey(id))) || (await get(id));
    } catch (e) { return null; }
  }
  // la foto de una carta que pasa a otro identificador (mismo sitio, identificador nuevo)
  async function moverFoto(oldId, newId) {
    try {
      const d = await db();
      const get = (k) => new Promise((res) => { const q = d.transaction('fotos').objectStore('fotos').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); });
      const img = (await get(fotoKey(oldId))) || (await get(oldId));
      if (img && !(await get(fotoKey(newId)))) await putPhoto(newId, img);
    } catch (e) { /* sin fotos */ }
  }
  // (se espera a que la escritura quede confirmada: si falla, el que llama se entera)
  async function putPhoto(id, dataUrl) {
    const d = await db();
    await new Promise((ok, ko) => {
      const tx = d.transaction('fotos', 'readwrite');
      tx.objectStore('fotos').put(dataUrl, fotoKey(id));
      tx.oncomplete = () => ok();
      tx.onerror = () => ko(tx.error || new Error('No se pudo guardar la foto'));
      tx.onabort = () => ko(tx.error || new Error('No se pudo guardar la foto'));
    });
  }

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
  async function takePhoto(header) {
    const Cam = isNative && window.Capacitor.Plugins && window.Capacitor.Plugins.Camera;
    if (Cam) {
      const p = await Cam.getPhoto({ quality: 85, width: 1400, allowEditing: false, resultType: 'dataUrl', source: 'PROMPT', correctOrientation: true,
        promptLabelHeader: header || 'Foto para el cromo', promptLabelPhoto: 'Elegir de la galería', promptLabelPicture: 'Hacer una foto', promptLabelCancel: 'Cancelar' });
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


  // datos de la carta (anverso estilo TCG) para un monumento conquistado
  async function dataFor(id) {
    const rec = recOf(id), ci = S().cardInfo[id] || {};
    // (un texto guardado en otro idioma no se enseña: mientras llega el del idioma elegido, la carta se cuenta sola)
    const info = otraLengua(ci) ? { img: ci.img, credit: ci.credit, addr: ci.addr } : ci;
    const img = await imageFor(id);
    const all = Object.keys(S().landmarks);
    const lm = PM.world.landmarks[id] || {};
    return { id, capR: lm.capR, shiny: !!rec.shiny, must: !!rec.must, name: rec.name, kind: rec.kind, emoji: rec.emoji, rarity: rec.rarity, city: rec.city, barrio: rec.barrio, t: rec.t, visits: rec.visits, pos: rec.pos || lm.pos, color: S().color,
      wiki: rec.wiki || lm.wiki, wd: rec.wd || lm.wd, porque: rec.porque || (lm.id && PM.lugares ? PM.lugares.porQue(lm) : ''), desc: info.desc, addr: info.addr, ctx: info.ctx,
      her: rec.her != null ? rec.her : lm.her, anio: rec.anio || lm.anio, vis: rec.vis || lm.vis, wp: rec.wp || lm.wp,
      img: img && img.src, own: !!(img && img.own), text: info.text, credit: img && img.own ? 'Foto: ' + (PM.player ? PM.player.name : 'tuya') : info.credit,
      points: 100 * ((PM.world.RARITY[rec.rarity] || {}).mult || 1) * (rec.must ? 2 : 1) * (rec.shiny ? 2 : 1), number: number(id), total: all.length, player: PM.player && PM.player.name };
  }

  async function open(id, opts = {}) {
    if (!recOf(id)) return;
    const show = async () => {
      const d = await dataFor(id);
      PM.tcg.open(d, {
        badge: opts.isNew ? `${recOf(id).shiny ? '✨ ¡CARTA BRILLANTE! ✨' : recOf(id).must ? '⭐ ¡IMPRESCINDIBLE! ⭐' : '¡Nueva carta!'} ${opts.pts ? '+' + opts.pts + ' pts' : ''}` : '',
        actions: [{ label: d.own ? '📸 Cambiar foto' : d.img ? '📸 Tu foto' : '📸 Hazle la foto', primary: !d.img, on: () => editPhoto(id, show) }],
        onText: (t) => { const ci = S().cardInfo[id] || (S().cardInfo[id] = { t: Date.now(), lang: LANG() }); ci.text = t; delete ci.none; PM.state.save(); },
      });
    };
    await show();
    if (caduca(S().cardInfo[id])) {
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
    // se abre ENCIMA de la carta, con el filtro ya puesto: un toque en «Usar foto» y listo (cambiar el filtro es opcional)
    ov.innerHTML = `<div class="fe-in"><h3>Tu foto para el cromo</h3><div class="fe-prev"><canvas></canvas><div class="holo"></div></div>
      <div class="fe-filters">${FILTERS.map((f) => `<button class="btn ${f.id === cur ? 'on' : ''}" data-f="${f.id}">${f.name}</button>`).join('')}</div>
      <div class="cv-actions"><button class="btn" id="fe-cancel">Cancelar</button><button class="btn" id="fe-again">📸 Otra</button><button class="btn on" id="fe-save">✓ Usar foto</button></div></div>`;
    document.body.appendChild(ov);
    const cv = ov.querySelector('canvas');
    const draw = () => { const out = applyFilter(crop, cur); cv.width = out.width; cv.height = out.height; cv.getContext('2d').drawImage(out, 0, 0); };
    draw();
    ov.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => {
      cur = b.dataset.f; ov.querySelectorAll('[data-f]').forEach((x) => x.classList.toggle('on', x === b)); draw();
    }));
    $('#fe-cancel').addEventListener('click', () => ov.remove());
    $('#fe-again').addEventListener('click', () => { ov.remove(); editPhoto(id, after); });
    $('#fe-save').addEventListener('click', async () => {
      try { await putPhoto(id, cv.toDataURL('image/jpeg', 0.82)); }
      catch (e) { alert(PM.t('No se pudo guardar la foto') + ': ' + ((e && e.message) || e)); return; }
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

  // ---------------- Colecciones ----------------
  const SETS = [
    { id: 'ayto', name: 'Ayuntamientos', icon: '🏛️', kinds: ['Ayuntamiento'], goals: [1, 3, 10] },
    { id: 'templos', name: 'Iglesias y catedrales', icon: '⛪', kinds: ['Iglesia', 'Iglesia principal', 'Basílica', 'Catedral', 'Templo'], goals: [3, 10, 25] },
    { id: 'historia', name: 'Historia', icon: '🏰', kinds: ['Castillo', 'Monumento', 'Torre / Puerta', 'Ruinas', 'Lugar histórico', 'Memorial'], goals: [3, 10, 25] },
    { id: 'cultura', name: 'Cultura', icon: '🎭', kinds: ['Museo', 'Teatro', 'Biblioteca', 'Universidad'], goals: [3, 10, 25] },
    { id: 'deporte', name: 'Deporte', icon: '🏟️', kinds: ['Estadio', 'Campo de fútbol'], goals: [2, 5, 15] },
    { id: 'verde', name: 'Parques y miradores', icon: '🌳', kinds: ['Parque', 'Mirador', 'Zoo / Acuario'], goals: [3, 10, 30] },
    { id: 'ciudad', name: 'Vida de ciudad', icon: '🏙️', kinds: ['Plaza', 'Fuente', 'Mercado', 'Estación', 'Arte urbano', 'Faro', 'Atracción', 'Parque temático', 'Rascacielos'], goals: [5, 15, 40] },
    { id: 'fotos', name: 'Fotógrafo', icon: '📸', photos: true, goals: [1, 10, 30] },
  ];
  const TIER = ['🥉 Bronce', '🥈 Plata', '🥇 Oro'];
  function setCount(set) {
    if (set.photos) return Object.keys(S().cardPhotos || {}).length;
    return Object.values(S().landmarks).filter((r) => set.kinds.includes(r.kind)).length;
  }

  function album(container, opts = {}) {
    const s = S();
    const ids = Object.keys(s.landmarks).sort((a, b) => s.landmarks[b].t - s.landmarks[a].t);
    let tab = 'cromos';
    const draw = async () => {
      let html = `<div class="seg tabs"><button class="btn ${tab === 'cromos' ? 'on' : ''}" data-t="cromos">🃏 Cromos (${ids.length})</button>
        <button class="btn ${tab === 'col' ? 'on' : ''}" data-t="col">📚 Colecciones</button>
        <button class="btn ${tab === 'bar' ? 'on' : ''}" data-t="bar">🏘️ Barrios (${Object.keys(s.barrioCards || {}).length})</button>
        <button class="btn ${tab === 'must' ? 'on' : ''}" data-t="must">⭐ Imprescindibles</button></div>`;
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
      } else if (tab === 'must') {
        // los imprescindibles de cada ciudad: los que tienes (a color) y los que te faltan (en gris, toca para verlos en el mapa)
        // la lista FIJA de cada ciudad (los más conocidos de todo el municipio; más en las grandes), estén cargados o no en el mapa
        const byCity = {};
        const add = (c, x) => { const L = byCity[c] = byCity[c] || []; if (!L.some((y) => y.id === x.id)) L.push(x); };
        const fixed = PM.world.mustLists();
        for (const [c, L] of Object.entries(fixed)) L.forEach((e) => {
          // sin cargar en el mapa ahora: el tuyo ya conseguido de esa lista (mismo sitio)
          if (!e.id) { const r = Object.entries(s.landmarks).find(([id, v]) => id === e.q || (v.must && v.pos && v.city === c && PM.geo.dist(v.pos, e.pos) < 400)); if (r) e.id = r[0]; }
          const got = e.id && s.landmarks[e.id];
          add(c, { id: e.id || 'q:' + e.q, name: got ? got.name : e.name, emoji: got ? got.emoji : e.emoji, kind: e.kind });
        });
        for (const [id, r] of Object.entries(s.landmarks)) if (r.must && !fixed[r.city]) add(r.city || 'Otros lugares', { id, name: r.name, emoji: r.emoji, kind: r.kind });
        const cities = Object.entries(byCity).map(([c, L]) => [c, L, L.filter((x) => s.landmarks[x.id]).length]).sort((a, b) => b[2] - a[2] || b[1].length - a[1].length);
        html += cities.length ? '<p class="muted">Los lugares que no te puedes perder en cada ciudad. Valen el doble. Toca uno para verlo en el mapa.</p>' + cities.map(([c, L, g]) => `
          <div class="must-city"><div class="mc-h"><b>${esc(c)}</b><span>${g}/${L.length}${g >= L.length ? ' 🏆' : ''}</span></div><div class="bar"><i style="width:${Math.round(g / Math.max(1, L.length) * 100)}%"></i></div>
          <div class="must-grid">${L.map((x) => { const got = !!s.landmarks[x.id], u = PM.emojiURL(x.emoji); return `<button class="must-it ${got ? 'got' : ''}" data-go="${esc(x.id)}">
            <span class="mi-ic">${u ? `<img src="${u}" alt="">` : (x.emoji || '📍')}</span><b>${esc(x.name)}</b><small>${got ? '✓ conseguido' : '📍 ver en el mapa'}</small></button>`; }).join('')}</div></div>`).join('')
          : '<p class="muted">Aún no hay imprescindibles. Abre el mapa de una ciudad y aparecerán aquí los lugares que no te puedes perder (siempre los mismos; más cuanto más grande es la ciudad).</p>';
      } else {
        const bc = Object.entries(s.barrioCards || {}).sort((a, b) => b[1].t - a[1].t);
        html += bc.length ? '<div class="cromos">' + bc.map(([id, b]) => barrioCardHTML(b)).join('') + '</div>'
          : '<p class="muted">Conquista un barrio (pinta el 60 % de sus calles) y aquí aparecerá su cromo con la silueta pintada de tu color.</p>';
        const cities = Object.entries(s.cityCards || {});
        if (cities.length) html += '<h4>👑 Ciudades</h4><div class="cromos">' + cities.map(([c, v]) => `<div class="cromo r-legendario city"><div class="cromo-in"><div class="cara front">
          <div class="foto vacia"><span>👑</span></div><div class="holo"></div><div class="cinta" style="background:#ffb700">Ciudad</div>
          <div class="pie"><b>${esc(c)}</b><small>Conquistada el ${new Date(v.t).toLocaleDateString(PM.LOCALE)}</small></div></div></div></div>`).join('') + '</div>';
      }
      container.innerHTML = html;
      if (tab === 'cromos' && ids.length) {
        // mazos por ciudad (la que más cartas tiene, primero): se despliegan al tocar
        const byCity = {};
        for (const id of ids) { const c = s.landmarks[id].city || 'Otros lugares'; (byCity[c] = byCity[c] || []).push(id); }
        const draw2 = () => PM.tcg.stacks(container.querySelector('#city-stacks'),
          PM.tcg.byCountry(Object.entries(byCity).map(([city, list]) => ({ city, ids: list })), s.countries), dataFor, (el, id) => el.addEventListener('click', () => open(id)), 'cromos');
        draw2();
        // ciudades sin país aún: se averigua (una vez) y se recoloca
        const cityPos = {}; for (const [c, list] of Object.entries(byCity)) cityPos[c] = s.landmarks[list[0]].pos;
        PM.ensureCountries(s, cityPos).then((ch) => { if (ch) { PM.state.save(); if (container.querySelector('#city-stacks')) draw2(); } });
      }
      container.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.t; draw(); }));
      container.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { const id = b.dataset.go; if (s.landmarks[id]) open(id); else if (opts.goTo) opts.goTo(id); }));
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
      <div class="pie"><b>${esc(b.name)}</b><small>${b.city ? esc(b.city) + ' · ' : ''}${new Date(b.t).toLocaleDateString(PM.LOCALE)}</small></div></div></div></div>`;
  }

  return { open, close, album, fetchInfo, dataFor, SETS, setCount, getPhoto, putPhoto, moverFoto, takePhoto, FILTERS, _img: { loadImg, cropCard, applyFilter } };
})();
