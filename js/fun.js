// PintaMapa — extras divertidos: la calle misteriosa del día, Pincel (tu perro) y la foto de perfil.
// main.js crea el módulo con PM.fun.create({...}) y le pasa lo que necesita del juego.
PM.fun = (function () {
  // ---------------- utilidades ----------------
  const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const rnd = (seed) => () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const DIRS = ['norte', 'noreste', 'este', 'sureste', 'sur', 'suroeste', 'oeste', 'noroeste'];
  const dirOf = (a, b) => {
    const dx = (b[1] - a[1]) * PM.geo.mPerDegLon(a[0]), dy = (b[0] - a[0]) * PM.geo.mPerDegLat;
    return DIRS[Math.round(((Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360) / 45) % 8];
  };

  // ---------------- Pincel, el perro ----------------
  // Accesorios que se ganan con logros (se dibujan encima del perro)
  const GEAR = [
    { id: 'collar', n: 5, name: 'Collar rojo', ic: '🔴' },
    { id: 'chapa', n: 15, name: 'Chapa dorada', ic: '🏅' },
    { id: 'panuelo', n: 30, name: 'Pañuelo de tu color', ic: '🧣' },
    { id: 'gorra', n: 60, name: 'Gorra de pintor', ic: '🧢' },
    { id: 'gafas', n: 100, name: 'Gafas de sol', ic: '🕶️' },
    { id: 'capa', n: 150, name: 'Capa de superperro', ic: '🦸' },
    { id: 'corona', n: 200, name: 'Corona', ic: '👑' },
  ];
  const STAGES = [
    { km: 0, name: 'Cachorro', k: 0.82 }, { km: 10, name: 'Joven', k: 0.92 }, { km: 50, name: 'Adulto', k: 1 }, { km: 200, name: 'Veterano', k: 1.04 },
  ];
  const MOODS = {
    paseando: { t: '¡De paseo contigo!', face: 'happy', wag: 2 },
    feliz: { t: 'Feliz: hoy ya habéis salido', face: 'happy', wag: 1 },
    contento: { t: 'Contento, pero quiere salir hoy', face: 'normal', wag: 1 },
    aburrido: { t: 'Aburrido… lleva días sin paseo', face: 'bored', wag: 0 },
    triste: { t: 'Triste: te echa mucho de menos', face: 'sad', wag: 0 },
  };

  // dibujo del perro (SVG): cara según el ánimo y accesorios ganados
  function dogSVG(o) {
    const c = o.color || '#ff2e88', fur = '#e0a96d', dark = '#a8713f', face = o.face || 'normal', g = new Set(o.gear || []);
    const eyes = {
      happy: '<path d="M38 52 q5 -6 10 0" stroke="#222" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M62 52 q5 -6 10 0" stroke="#222" stroke-width="3" fill="none" stroke-linecap="round"/>',
      normal: '<circle cx="43" cy="51" r="4.2" fill="#222"/><circle cx="67" cy="51" r="4.2" fill="#222"/><circle cx="44.5" cy="49.5" r="1.4" fill="#fff"/><circle cx="68.5" cy="49.5" r="1.4" fill="#fff"/>',
      bored: '<path d="M38 52 h10" stroke="#222" stroke-width="3" stroke-linecap="round"/><path d="M62 52 h10" stroke="#222" stroke-width="3" stroke-linecap="round"/><path d="M37 47 h11 M61 47 h11" stroke="#7a5230" stroke-width="2.5" stroke-linecap="round"/>',
      sad: '<circle cx="43" cy="53" r="4" fill="#222"/><circle cx="67" cy="53" r="4" fill="#222"/><path d="M36 49 l10 -4 M74 49 l-10 -4" stroke="#7a5230" stroke-width="2.5" stroke-linecap="round"/><path d="M41 59 q-2 5 0 7 q2 -2 0 -7" fill="#60a5fa"/>',
    }[face];
    const mouth = face === 'happy'
      ? '<path d="M49 66 q6 6 12 0" stroke="#222" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="M52 69 q3 9 6 0" fill="#f87171"/>'
      : face === 'sad' ? '<path d="M49 70 q6 -5 12 0" stroke="#222" stroke-width="2.6" fill="none" stroke-linecap="round"/>'
        : '<path d="M50 68 q5 3 10 0" stroke="#222" stroke-width="2.6" fill="none" stroke-linecap="round"/>';
    const head = `<g class="dog-head">
      <ellipse cx="25" cy="44" rx="11" ry="21" fill="${dark}" transform="rotate(18 25 44)"/>
      <ellipse cx="85" cy="44" rx="11" ry="21" fill="${dark}" transform="rotate(-18 85 44)"/>
      <ellipse cx="55" cy="52" rx="30" ry="28" fill="${fur}"/>
      <ellipse cx="55" cy="64" rx="16" ry="12" fill="#f6dcc0"/>
      <ellipse cx="67" cy="45" rx="9" ry="8" fill="#f6dcc0" opacity=".55"/>
      ${eyes}<ellipse cx="55" cy="60" rx="5.5" ry="4" fill="#222"/>${mouth}
      ${g.has('gorra') && !g.has('corona') ? `<path d="M28 34 q27 -24 54 0 z" fill="${c}"/><path d="M76 33 q14 0 18 6 h-18 z" fill="${c}" opacity=".85"/><circle cx="55" cy="18" r="3" fill="#fff"/>` : ''}
      ${g.has('corona') ? '<path d="M38 28 l5 -14 l7 9 l5 -12 l5 12 l7 -9 l5 14 z" fill="#facc15" stroke="#b45309" stroke-width="1.5"/>' : ''}
      ${g.has('gafas') ? '<rect x="33" y="44" width="18" height="11" rx="4" fill="#111" opacity=".9"/><rect x="59" y="44" width="18" height="11" rx="4" fill="#111" opacity=".9"/><path d="M51 49 h8" stroke="#111" stroke-width="2.5"/>' : ''}
    </g>`;
    const body = `<g class="dog-body">
      ${g.has('capa') ? `<path d="M34 86 q-12 26 -4 40 h50 q8 -14 -4 -40 z" fill="${c}" opacity=".9"/>` : ''}
      <ellipse cx="55" cy="104" rx="25" ry="20" fill="${fur}"/>
      <ellipse cx="55" cy="108" rx="13" ry="12" fill="#f6dcc0"/>
      <ellipse cx="41" cy="122" rx="7" ry="5" fill="${dark}"/><ellipse cx="69" cy="122" rx="7" ry="5" fill="${dark}"/>
      <g class="dog-tail"><path d="M78 104 q16 -6 14 -22" stroke="${dark}" stroke-width="7" fill="none" stroke-linecap="round"/></g>
      ${g.has('collar') ? '<path d="M36 82 q19 10 38 0" stroke="#dc2626" stroke-width="5" fill="none" stroke-linecap="round"/>' : ''}
      ${g.has('chapa') ? '<circle cx="55" cy="90" r="4.5" fill="#facc15" stroke="#b45309" stroke-width="1.2"/>' : ''}
      ${g.has('panuelo') ? `<path d="M38 82 q17 9 34 0 l-17 16 z" fill="${c}"/>` : ''}
    </g>`;
    if (o.headOnly) return `<svg class="dog" viewBox="12 8 86 82">${head}</svg>`;
    return `<svg class="dog wag${o.wag || 0}" viewBox="0 0 110 132" ${o.size ? `width="${o.size}" height="${Math.round(o.size * 1.2)}"` : ''}>${body}${head}</svg>`;
  }
  // solo la cabeza (botón del mapa)
  function dogHead(o) {
    return dogSVG(Object.assign({}, o, { headOnly: true }));
  }

  function create(ctx) {
    const { map, S, W, G, toast, openSheet, celebrate, setSrc, FC, ll, circlePoly, $ } = ctx;

    // =============== CALLE MISTERIOSA ===============
    const REWARD = 500, FOUND_R = 35, AREA_R = 170;
    let hotSaid = '', lastTemp = '';
    function today() { return PM.today(); }
    function M() { return S().mystery; }
    // elige la calle del día: sin pintar, ni sendero ni zona evitada, a 250–900 m de ti, en una zona sin pintar alrededor
    function pick(pos, force) {
      const s = S(), cur = s.mystery;
      if (!force && cur && cur.day === today() && (cur.found || PM.geo.dist(cur.pos, pos) < 4000)) return cur;
      const r = rnd(hash(today() + '|' + (PM.player ? PM.player.slug : '') + '|' + (force ? Date.now() : '')));
      const cand = [];
      for (const id in W.pieces) {
        const p = W.pieces[id];
        if (p.trail || p.avoid || s.painted[id] || p.len < 6) continue;
        const d = PM.geo.dist(p.mid, pos);
        if (d >= 250 && d <= 900) cand.push(p);
      }
      if (!cand.length) return cur && cur.day === today() ? cur : null;
      cand.sort((a, b) => (a.id < b.id ? -1 : 1));
      let target = null;
      for (let tries = 0; tries < 40 && !target; tries++) {
        const p = cand[Math.floor(r() * cand.length)];
        if (!W.piecesNear(p.mid, 40).some((q) => s.painted[q.id])) target = p;   // calle de verdad nueva (nada pintado al lado)
      }
      if (!target) target = cand[Math.floor(r() * cand.length)];
      // la zona morada del mapa: un círculo que contiene la calle, pero sin estar centrado en ella
      const a = r() * 2 * Math.PI, off = 40 + r() * 70;
      const c = PM.geo.offset(target.mid, Math.cos(a) * off, Math.sin(a) * off);
      s.mystery = { day: today(), pos: target.mid.slice(), piece: target.id, c, r: AREA_R, found: false };
      PM.state.save();
      drawMystery();
      return s.mystery;
    }
    function temp(d) {
      if (d > 700) return { ic: '🧊', t: 'Helado', k: 0 };
      if (d > 400) return { ic: '❄️', t: 'Frío', k: 1 };
      if (d > 200) return { ic: '🌤️', t: 'Templado', k: 2 };
      if (d > 90) return { ic: '🔥', t: 'Caliente', k: 3 };
      return { ic: '🔥🔥', t: '¡Te quemas!', k: 4 };
    }
    function drawMystery() {
      const m = M();
      if (!m || m.day !== today() || m.found) { setSrc('pm-mystery', FC([])); return; }
      setSrc('pm-mystery', FC([circlePoly(m.c, m.r), { type: 'Feature', properties: { q: 1 }, geometry: { type: 'Point', coordinates: ll(m.c) } }]));
    }
    // ¿has pintado la calle misteriosa?
    function onPainted(piece) {
      const m = M();
      if (!m || m.found || m.day !== today()) return;
      if (piece.id !== m.piece && PM.geo.dist(piece.mid, m.pos) > FOUND_R) return;
      m.found = Date.now();
      const s = S(); s.stats.mystery = (s.stats.mystery || 0) + 1;
      G.addXP(REWARD, 'mystery');
      PM.state.save();
      drawMystery();
      celebrate('¡Calle misteriosa encontrada!', `Has descubierto la calle escondida de hoy. +${REWARD} pts · Mañana habrá otra.`, '🕵️');
      say('¡Guau! ¡La encontramos! 🦴', true);
      G.checkAchievements();
    }
    function badge(pos) {
      const el = $('#mystery'); if (!el) return;
      const m = M();
      let html = '';
      if (m && m.day === today()) {
        if (m.found) html = '🕵️ Calle misteriosa ✅';
        else {
          const t = temp(PM.geo.dist(pos, m.pos));
          html = `🕵️ ${t.ic} ${t.t}`;
          if (t.k >= 3 && hotSaid !== today() && ctx.inSession()) { hotSaid = today(); say('¡Huelo algo por aquí! 👃'); }
          if (lastTemp && t.k !== +lastTemp && ctx.inSession() && t.k >= 2) PM.vibrate && PM.vibrate(t.k >= 4 ? [40, 30, 40] : 30);
          lastTemp = String(t.k);
        }
      }
      if (el.dataset.h !== html) { el.dataset.h = html; el.innerHTML = html; el.classList.toggle('show', !!html); }
    }
    function nearestPlace(p) {
      let best = null, bd = Infinity;
      for (const id in W.landmarks) { const d = PM.geo.dist(p, W.landmarks[id].pos); if (d < bd) { bd = d; best = W.landmarks[id]; } }
      return best && bd < 600 ? { lm: best, d: bd } : null;
    }
    function showMystery() {
      const m = M(), pos = ctx.getPos();
      if (!m || m.day !== today()) { openSheet('🕵️ Calle misteriosa', '<p>Aún no hay calle misteriosa: espera a que carguen las calles de tu zona.</p>'); return; }
      if (m.found) {
        openSheet('🕵️ Calle misteriosa', `<div class="mys-done">✅</div><p style="text-align:center"><b>¡Ya la encontraste hoy!</b><br>Mañana se esconderá otra calle cerca de ti.</p>
          <p class="muted" style="text-align:center">Calles misteriosas encontradas: <b>${S().stats.mystery || 0}</b></p>`);
        return;
      }
      const d = PM.geo.dist(pos, m.pos), t = temp(d);
      const b = W.barrioAt ? W.barrioAt(m.pos) : null, bn = b && ((W.barrios[b.id] && W.barrios[b.id].name) || b.name);
      const np = nearestPlace(m.pos);
      const hints = [];
      hints.push(`🧭 Está hacia el <b>${dirOf(pos, m.c)}</b> de donde estás (busca la zona morada del mapa).`);
      if (bn) hints.push(`🏘️ En el barrio de <b>${esc(bn)}</b>.`);
      if (np) hints.push(`${np.lm.emoji} A unos <b>${Math.max(50, Math.round(np.d / 50) * 50)} m</b> de <b>${esc(np.lm.name)}</b>.`);
      hints.push('🎨 Es una calle que <b>todavía no has pintado</b>: cuando la pintes, ¡premio!');
      openSheet('🕵️ Calle misteriosa', `<div class="mys-temp k${t.k}"><span>${t.ic}</span><b>${t.t}</b><small>cuanto más cerca, más caliente</small></div>
        <p>Hoy hay una calle escondida cerca de ti. Píntala y ganas <b>+${REWARD} pts</b>.</p>
        <div class="mys-hints">${hints.map((h) => `<div>${h}</div>`).join('')}</div>
        <button class="btn on" id="mys-go">🗺️ Ver la zona en el mapa</button>`);
      $('#mys-go').addEventListener('click', () => {
        $('#sheet').classList.remove('show');
        ctx.lookAt(m.c, 15.6);
      });
    }

    // =============== PINCEL, EL PERRO ===============
    function pet() { const s = S(); if (!s.pet) { s.pet = { name: 'Pincel', born: Date.now() }; PM.state.save(); } return s.pet; }
    function walkedTodayM() {
      const s = S(), t0 = new Date(); t0.setHours(0, 0, 0, 0);
      let m = (s.walks || []).filter((w) => w.start >= t0.getTime()).reduce((a, w) => a + ((w.st && w.st.walked) || 0), 0);
      return m + (ctx.sessionWalked() || 0);
    }
    function daysAway() {
      const last = S().stats.lastDay;
      if (!last) return 99;
      const a = new Date(last + 'T12:00'), b = new Date(today() + 'T12:00');
      return Math.round((b - a) / 86400000);
    }
    function petState() {
      const s = S(), p = pet();
      const nAch = Object.keys(s.achievements || {}).length;
      const gear = GEAR.filter((g) => nAch >= g.n).map((g) => g.id);
      const km = (s.stats.walkedM || 0) / 1000;
      const stage = STAGES.filter((x) => km >= x.km).pop();
      const wt = walkedTodayM();
      const hearts = wt >= 3000 ? 3 : wt >= 1500 ? 2 : wt >= 500 ? 1 : 0;
      const away = daysAway();
      const mood = ctx.inSession() ? 'paseando' : hearts > 0 || away === 0 ? 'feliz' : away === 1 ? 'contento' : away <= 3 ? 'aburrido' : 'triste';
      return { p, gear, km, stage, hearts, wt, mood, M: MOODS[mood], nAch, next: GEAR.find((g) => nAch < g.n) };
    }
    let petKey = '';
    function drawPetBtn() {
      const el = $('#btn-pet'); if (!el) return;
      const st = petState();
      const key = st.mood + st.gear.join() + S().color;
      if (key === petKey) return;
      petKey = key;
      el.innerHTML = dogHead({ face: st.M.face, gear: st.gear, color: S().color, wag: st.M.wag }) + (st.mood === 'aburrido' || st.mood === 'triste' ? '<i class="pet-alert">!</i>' : '');
      el.className = 'mood-' + st.mood;
    }
    // bocadillo de Pincel junto a su botón
    let sayT = 0, sayTimer = null;
    function say(text, important) {
      const now = Date.now();
      if (!important && now - sayT < 20000) return;
      sayT = now;
      const b = $('#pet-say'); if (!b) return;
      b.innerHTML = esc(text).replace(/&lt;b&gt;|&lt;\/b&gt;/g, '');
      b.classList.add('show');
      clearTimeout(sayTimer); sayTimer = setTimeout(() => b.classList.remove('show'), 3600);
    }
    function showPet() {
      const st = petState(), p = st.p;
      const nextStage = STAGES.find((x) => x.km > st.km);
      const tip = st.hearts >= 3 ? '¡Hoy ya está a tope! 💖' : `Sácalo a pasear: ${st.hearts === 0 ? '500 m' : st.hearts === 1 ? '1,5 km' : '3 km'} hoy para ${st.hearts === 0 ? 'su primer corazón' : 'otro corazón'}.`;
      openSheet('🐶 ' + p.name, `<div class="pet-card mood-${st.mood}">
          <div class="pet-big" style="--k:${st.stage.k}">${dogSVG({ face: st.M.face, gear: st.gear, color: S().color, wag: st.M.wag, size: 150 })}</div>
          <div class="pet-name"><input id="pet-name" value="${esc(p.name)}" maxlength="16" aria-label="Nombre del perro"><span>✏️</span></div>
          <div class="pet-mood">${st.M.t}</div>
          <div class="pet-hearts">${[0, 1, 2].map((i) => `<span class="${i < st.hearts ? 'on' : ''}">❤</span>`).join('')}<small>${PM.fmtDist(st.wt)} hoy</small></div>
          <p class="muted" style="text-align:center;margin:4px 0 12px">${tip}</p>
        </div>
        <div class="stats">
          <div><b>${st.stage.name}</b><small>${nextStage ? `${Math.max(0, nextStage.km - st.km).toFixed(1)} km para ${nextStage.name.toLowerCase()}` : 'el más sabio'}</small></div>
          <div><b>${st.km.toFixed(1)} km</b><small>paseados juntos</small></div>
          <div><b>${S().stats.streak || 0} 🔥</b><small>días seguidos</small></div>
        </div>
        <h4 style="margin:16px 0 8px">Accesorios <small class="muted">· se ganan con logros (${st.nAch})</small></h4>
        <div class="pet-gear">${GEAR.map((g) => `<div class="${st.gear.includes(g.id) ? 'on' : ''}"><span>${st.gear.includes(g.id) ? g.ic : '🔒'}</span><b>${g.name}</b><small>${g.n} logros</small></div>`).join('')}</div>
        ${st.next ? `<p class="muted" style="margin-top:10px">Siguiente: <b>${st.next.name}</b> con ${st.next.n} logros (te faltan ${st.next.n - st.nAch}).</p>` : ''}`);
      const inp = $('#pet-name');
      inp.addEventListener('change', () => { const v = inp.value.trim().slice(0, 16); if (v) { pet().name = v; PM.state.save(); $('#sheet h3').textContent = '🐶 ' + v; } });
      const big = document.querySelector('.pet-big');
      big.addEventListener('click', () => { big.classList.remove('jump'); void big.offsetWidth; big.classList.add('jump'); say(['¡Guau!', '¿Salimos?', '¡Guau guau! 🐾', '*mueve la cola*', '¿Pintamos?'][Math.floor(Math.random() * 5)], true); PM.vibrate && PM.vibrate(20); });
    }

    // =============== FOTO DE PERFIL ===============
    function avatarHTML(cls) {
      const s = S();
      return s.avatar ? `<div class="${cls} has-photo" style="background-image:url('${s.avatar}')"></div>` : `<div class="${cls}" style="background:${s.color}">🖌️</div>`;
    }
    function squareJpeg(dataUrl, size) {
      return new Promise((res) => {
        const im = new Image();
        im.onload = () => {
          const m = Math.min(im.width, im.height), c = document.createElement('canvas'); c.width = size; c.height = size;
          c.getContext('2d').drawImage(im, (im.width - m) / 2, (im.height - m) / 2, m, m, 0, 0, size, size);
          res(c.toDataURL('image/jpeg', 0.82));
        };
        im.onerror = () => res(null);
        im.src = dataUrl;
      });
    }
    async function changeAvatar() {
      let raw;
      try { raw = await PM.cards.takePhoto('Foto de perfil'); } catch (e) { return false; }
      if (!raw) return false;
      const img = await squareJpeg(raw, 320);
      if (!img) { toast('No se pudo leer la foto', 'warn'); return false; }
      S().avatar = img; S().avatarT = Date.now(); PM.state.save();
      refreshAvatar();
      toast('📸 Foto de perfil guardada', 'ok');
      return true;
    }
    function removeAvatar() { delete S().avatar; S().avatarT = Date.now(); PM.state.save(); refreshAvatar(); }
    function refreshAvatar() {
      const n = $('#nav-profile span, #nav-profile .pico');
      const b = $('#nav-profile');
      if (!b) return;
      b.classList.toggle('has-avatar', !!S().avatar);
      b.style.setProperty('--avatar', S().avatar ? `url('${S().avatar}')` : 'none');
    }

    // =============== ciclo ===============
    let ensured = false;
    function tick() {
      const pos = ctx.getPos();
      if (!pos) return;
      const m = M();
      if (!m || m.day !== today() || (!m.found && PM.geo.dist(m.pos, pos) > 4000)) { if (Object.keys(W.pieces).length > 50) pick(pos); }
      else if (!ensured) { ensured = true; drawMystery(); }
      badge(pos);
      drawPetBtn();
    }
    function onEvent(ev, d) {
      if (ev === 'start') say(petState().mood === 'triste' ? '¡Por fin! ¡Te echaba de menos! 🐾' : '¡Guau! ¡Vamos a pintar! 🐾', true);
      else if (ev === 'km') say(`¡${d} km! Sigue, sigue 🐾`);
      else if (ev === 'captured' && d.first) say(['¡Qué sitio más chulo!', '¡Otro para la colección! 🃏', '¡Guau, qué bonito!'][Math.floor(Math.random() * 3)]);
      else if (ev === 'conquered') say('¡Este barrio ya es nuestro! 🚩', true);
      else if (ev === 'levelup') say('¡Subimos de nivel! ⭐', true);
      else if (ev === 'end') say(petState().hearts >= 2 ? '¡Qué buen paseo! Estoy agotado 😴' : '¡Gracias por el paseo! 🦴', true);
      petKey = '';
    }
    function greet() {
      const away = daysAway();
      if (away >= 2 && away < 99) setTimeout(() => say(away >= 4 ? `Llevamos ${away} días sin salir… 🥺` : '¿Salimos hoy? 🐾', true), 2500);
    }
    function addLayers(add, beforeTop) {
      add({ id: 'pm-mys-fill', type: 'fill', source: 'pm-mystery', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#8b5cf6', 'fill-opacity': 0.1 } });
      add({ id: 'pm-mys-line', type: 'line', source: 'pm-mystery', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'line-color': '#7c3aed', 'line-width': 2.5, 'line-dasharray': [2, 2], 'line-opacity': 0.85 } });
      if (!map.hasImage('pm-mys-q')) {
        const k = 2, sz = 40 * k, cv = document.createElement('canvas'); cv.width = sz; cv.height = sz;
        const x = cv.getContext('2d');
        x.beginPath(); x.arc(sz / 2, sz / 2, 16 * k, 0, 2 * Math.PI); x.fillStyle = '#7c3aed'; x.fill(); x.lineWidth = 3 * k; x.strokeStyle = '#fff'; x.stroke();
        x.fillStyle = '#fff'; x.font = `900 ${20 * k}px system-ui, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('?', sz / 2, sz / 2 + k);
        try { map.addImage('pm-mys-q', x.getImageData(0, 0, sz, sz), { pixelRatio: k }); } catch (e) {}
      }
      add({ id: 'pm-mys-q', type: 'symbol', source: 'pm-mystery', filter: ['==', ['geometry-type'], 'Point'], layout: { 'icon-image': 'pm-mys-q', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.6, 16, 1] } }, true);
      drawMystery();
    }

    $('#mystery') && $('#mystery').addEventListener('click', showMystery);
    $('#btn-pet') && $('#btn-pet').addEventListener('click', showPet);
    refreshAvatar();
    return { tick, onPainted, onEvent, addLayers, greet, say, showPet, showMystery, avatarHTML, changeAvatar, removeAvatar, refreshAvatar, pick, drawMystery };
  }
  return { create, dogSVG, dogHead, GEAR };
})();
