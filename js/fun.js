// PintaMapa — extras: tu perro (con razas a elegir y animaciones) y la foto de perfil.
// main.js crea el módulo con PM.fun.create({...}) y le pasa lo que necesita del juego.
PM.fun = (function () {
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pickOne = (a) => a[Math.floor(Math.random() * a.length)];

  // ---------------- el perro ----------------
  // Accesorios que se ganan con logros (se dibujan encima del perro)
  const GEAR = [
    { id: 'collar', n: 5, name: 'Collar rojo', ic: '🔴' },
    { id: 'lazo', n: 10, name: 'Lazo', ic: '🎀' },
    { id: 'chapa', n: 15, name: 'Chapa dorada', ic: '🏅' },
    { id: 'pelota', n: 20, name: 'Pelota', ic: '🎾' },
    { id: 'panuelo', n: 30, name: 'Pañuelo de tu color', ic: '🧣' },
    { id: 'botas', n: 40, name: 'Botas de lluvia', ic: '🥾' },
    { id: 'gorra', n: 60, name: 'Gorra de pintor', ic: '🧢' },
    { id: 'mochila', n: 80, name: 'Mochila', ic: '🎒' },
    { id: 'gafas', n: 100, name: 'Gafas de sol', ic: '🕶️' },
    { id: 'cascos', n: 120, name: 'Auriculares', ic: '🎧' },
    { id: 'capa', n: 150, name: 'Capa de superperro', ic: '🦸' },
    { id: 'corona', n: 200, name: 'Corona', ic: '👑' },
    { id: 'alas', n: 250, name: 'Alas de ángel', ic: '🪽' },
    // exclusivos: se consiguen con los huesos que encuentra tu perro
    { id: 'pajarita', b: 5, name: 'Pajarita', ic: '🎩' },
    { id: 'vaquero', b: 15, name: 'Sombrero vaquero', ic: '🤠' },
    { id: 'fiesta', b: 30, name: 'Gorro de fiesta', ic: '🥳' },
    { id: 'dino', b: 60, name: 'Disfraz de dinosaurio', ic: '🦖' },
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
  // Razas: colores, forma de las orejas y marcas
  const BREEDS = {
    mestizo: { name: 'Mestizo', fur: '#e0a96d', dark: '#a8713f', muzzle: '#f6dcc0', ear: 'floppy' },
    labrador: { name: 'Labrador', fur: '#f0c27b', dark: '#d39a45', muzzle: '#fae5c3', ear: 'floppy' },
    dalmata: { name: 'Dálmata', fur: '#fbfbfb', dark: '#262626', muzzle: '#ffffff', ear: 'floppy', spots: '#262626', line: '#d4d4d8' },
    husky: { name: 'Husky', fur: '#6f7888', dark: '#4b5563', muzzle: '#f8fafc', ear: 'pointy', mask: '#f8fafc', eye: '#38bdf8' },
    carlino: { name: 'Carlino', fur: '#e9d3a8', dark: '#2b2b2b', muzzle: '#3a3a3a', ear: 'small', wrinkles: true, noseLight: true },
    beagle: { name: 'Beagle', fur: '#c98a4b', dark: '#7a4a22', muzzle: '#fafafa', ear: 'long', blaze: '#fafafa', saddle: '#2d2d2d' },
    caniche: { name: 'Caniche', fur: '#34343c', dark: '#24242a', muzzle: '#44444e', ear: 'fluffy', pom: true, sclera: true },
    chihuahua: { name: 'Chihuahua', fur: '#dfa76a', dark: '#c98d4e', muzzle: '#f7e2c4', ear: 'big' },
    corgi: { name: 'Corgi', fur: '#e58a3a', dark: '#c96f22', muzzle: '#ffffff', ear: 'pointy', blaze: '#ffffff' },
    border: { name: 'Border collie', fur: '#262626', dark: '#1a1a1a', muzzle: '#fafafa', ear: 'semi', blaze: '#fafafa', sclera: true },
  };

  // orejas (la izquierda; la derecha es su reflejo)
  function earShape(b) {
    const d = b.dark, in_ = '#f3b6b6';
    switch (b.ear) {
      case 'long': return `<ellipse cx="24" cy="58" rx="11" ry="26" fill="${d}" transform="rotate(8 24 58)"/>`;
      case 'pointy': return `<path d="M27 42 L22 8 L47 27 Z" fill="${d}"/><path d="M29 36 L26 15 L42 28 Z" fill="${in_}"/>`;
      case 'big': return `<path d="M30 42 L8 4 L49 27 Z" fill="${d}"/><path d="M31 36 L15 12 L43 28 Z" fill="${in_}"/>`;
      case 'small': return `<path d="M30 33 L24 20 L44 26 Z" fill="${d}"/>`;
      case 'semi': return `<path d="M27 40 L25 12 L46 27 Z" fill="${d}"/><path d="M25 12 L33 20 L22 22 Z" fill="${d}" opacity=".7"/>`;
      case 'fluffy': return `<circle cx="25" cy="50" r="13" fill="${d}"/><circle cx="22" cy="64" r="11" fill="${d}"/><circle cx="29" cy="38" r="9" fill="${d}"/>`;
      default: return `<ellipse cx="25" cy="44" rx="11" ry="21" fill="${d}" transform="rotate(18 25 44)"/>`;
    }
  }

  // dibujo del perro (SVG): raza, cara según el ánimo y accesorios ganados
  function dogSVG(o) {
    const b = BREEDS[o.breed] || BREEDS.mestizo;
    const c = o.color || '#ff2e88', fur = b.fur, dark = b.dark, face = o.face || 'normal', g = new Set(o.gear || []);
    const eyeC = b.eye || '#1f1f1f';
    const sclera = b.sclera ? '<circle cx="43" cy="51" r="6" fill="#fff"/><circle cx="67" cy="51" r="6" fill="#fff"/>' : '';
    const lid = b.sclera ? '#fff' : '#222';
    const eyes = {
      happy: `<path d="M38 52 q5 -6 10 0" stroke="${lid}" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M62 52 q5 -6 10 0" stroke="${lid}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
      normal: `${sclera}<circle cx="43" cy="51" r="4.2" fill="${eyeC}"/><circle cx="67" cy="51" r="4.2" fill="${eyeC}"/><circle cx="44.5" cy="49.5" r="1.4" fill="#fff"/><circle cx="68.5" cy="49.5" r="1.4" fill="#fff"/>`,
      bored: `<path d="M38 52 h10" stroke="${lid}" stroke-width="3" stroke-linecap="round"/><path d="M62 52 h10" stroke="${lid}" stroke-width="3" stroke-linecap="round"/><path d="M37 47 h11 M61 47 h11" stroke="${b.sclera ? '#bbb' : '#7a5230'}" stroke-width="2.5" stroke-linecap="round"/>`,
      sad: `${sclera}<circle cx="43" cy="53" r="4" fill="${eyeC}"/><circle cx="67" cy="53" r="4" fill="${eyeC}"/><path d="M36 49 l10 -4 M74 49 l-10 -4" stroke="${b.sclera ? '#bbb' : '#7a5230'}" stroke-width="2.5" stroke-linecap="round"/><path d="M41 59 q-2 5 0 7 q2 -2 0 -7" fill="#60a5fa"/>`,
    }[face];
    const mouthC = b.noseLight ? '#111' : '#222';
    const mouth = face === 'happy'
      ? `<path d="M49 66 q6 6 12 0" stroke="${mouthC}" stroke-width="2.6" fill="none" stroke-linecap="round"/><path class="dog-tongue" d="M52 69 q3 9 6 0" fill="#f87171"/>`
      : face === 'sad' ? `<path d="M49 70 q6 -5 12 0" stroke="${mouthC}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`
        : `<path d="M50 68 q5 3 10 0" stroke="${mouthC}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
    const ear = earShape(b);
    const marks = [
      b.mask ? `<path d="M30 56 q4 -16 25 -14 q21 -2 25 14 q-4 22 -25 24 q-21 -2 -25 -24 z" fill="${b.mask}"/><path d="M36 40 q4 -5 8 0 M66 40 q4 -5 8 0" stroke="${b.mask}" stroke-width="5" stroke-linecap="round" fill="none"/>` : '',
      b.blaze ? `<path d="M51 24 q4 -2 8 0 l3 30 h-14 z" fill="${b.blaze}"/>` : '',
      b.spots ? `<circle cx="36" cy="38" r="3.2" fill="${b.spots}"/><circle cx="74" cy="36" r="2.6" fill="${b.spots}"/><circle cx="78" cy="58" r="3" fill="${b.spots}"/><circle cx="31" cy="60" r="2.4" fill="${b.spots}"/><circle cx="60" cy="30" r="2" fill="${b.spots}"/>` : '',
      b.wrinkles ? `<path d="M46 34 q9 -4 18 0 M44 39 q11 -4 22 0" stroke="#b9996a" stroke-width="2" fill="none" stroke-linecap="round"/>` : '',
    ].join('');
    const pom = b.pom ? `<circle cx="55" cy="25" r="12" fill="${dark}"/><circle cx="46" cy="28" r="8" fill="${dark}"/><circle cx="64" cy="28" r="8" fill="${dark}"/>` : '';
    const head = `<g class="dog-head">
      <g class="dog-ear dog-ear-l">${ear}</g>
      <g class="dog-ear dog-ear-r" transform="translate(110 0) scale(-1 1)">${ear}</g>
      ${pom}
      <ellipse cx="55" cy="52" rx="30" ry="28" fill="${fur}" ${b.line ? `stroke="${b.line}" stroke-width="1.2"` : ''}/>
      ${marks}
      <ellipse cx="55" cy="64" rx="16" ry="12" fill="${b.muzzle}"/>
      <g class="dog-eyes">${eyes}</g>
      <ellipse class="dog-nose" cx="55" cy="60" rx="5.5" ry="4" fill="${b.noseLight ? '#111' : '#222'}"/>${mouth}
      ${g.has('gorra') && !g.has('corona') ? `<path d="M28 34 q27 -24 54 0 z" fill="${c}"/><path d="M76 33 q14 0 18 6 h-18 z" fill="${c}" opacity=".85"/><circle cx="55" cy="18" r="3" fill="#fff"/>` : ''}
      ${g.has('corona') ? '<path d="M38 28 l5 -14 l7 9 l5 -12 l5 12 l7 -9 l5 14 z" fill="#facc15" stroke="#b45309" stroke-width="1.5"/>' : ''}
      ${g.has('dino') ? '<path d="M34 34 l5 -12 l5 10 l5 -13 l5 12 l5 -13 l5 12 l5 -11 l4 12" fill="#4ade80" stroke="#16a34a" stroke-width="1.5" stroke-linejoin="round"/>' : ''}
      ${g.has('vaquero') && !g.has('corona') && !g.has('gorra') ? '<ellipse cx="55" cy="28" rx="34" ry="6" fill="#92400e"/><path d="M40 28 q0 -18 15 -18 q15 0 15 18 z" fill="#b45309"/><path d="M41 23 h28" stroke="#78350f" stroke-width="3"/>' : ''}
      ${g.has('fiesta') && !g.has('corona') && !g.has('gorra') && !g.has('vaquero') ? `<path d="M60 28 l12 -24 l10 26 z" fill="${c}" stroke="#fff" stroke-width="1.5"/><circle cx="72" cy="4" r="4" fill="#facc15"/><circle cx="70" cy="18" r="1.8" fill="#fff"/><circle cx="76" cy="23" r="1.8" fill="#fff"/>` : ''}
      ${g.has('lazo') ? `<path d="M30 30 l-9 -7 l1 13 z M30 30 l9 -9 l2 12 z" fill="#f472b6"/><circle cx="30" cy="30" r="3" fill="#db2777"/>` : ''}
      ${g.has('cascos') ? `<path d="M27 50 q-2 -34 28 -36 q30 2 28 36" stroke="#111" stroke-width="5" fill="none"/><rect x="20" y="44" width="11" height="17" rx="5" fill="${c}"/><rect x="79" y="44" width="11" height="17" rx="5" fill="${c}"/>` : ''}
      ${g.has('gafas') ? '<rect x="33" y="44" width="18" height="11" rx="4" fill="#111" opacity=".92"/><rect x="59" y="44" width="18" height="11" rx="4" fill="#111" opacity=".92"/><path d="M51 49 h8" stroke="#111" stroke-width="2.5"/>' : ''}
    </g>`;
    if (o.headOnly) return `<svg class="dog live" viewBox="4 2 102 90">${head}</svg>`;
    const body = `<g class="dog-body">
      ${g.has('alas') ? '<g class="dog-wings"><path d="M34 96 q-30 -18 -30 6 q10 4 30 6 z" fill="#fff" stroke="#cbd5e1" stroke-width="1.5"/><path d="M76 96 q30 -18 30 6 q-10 4 -30 6 z" fill="#fff" stroke="#cbd5e1" stroke-width="1.5"/></g>' : ''}
      ${g.has('capa') ? `<path d="M34 86 q-12 26 -4 40 h50 q8 -14 -4 -40 z" fill="${c}" opacity=".9"/>` : ''}
      <g class="dog-tail"><path d="M78 104 q16 -6 14 -22" stroke="${b.saddle || dark}" stroke-width="7" fill="none" stroke-linecap="round"/>${b.blaze && b.saddle ? '<circle cx="92" cy="82" r="4" fill="#fafafa"/>' : ''}</g>
      <g class="dog-torso"><ellipse cx="55" cy="104" rx="25" ry="20" fill="${fur}" ${b.line ? `stroke="${b.line}" stroke-width="1.2"` : ''}/>
      ${b.saddle ? `<path d="M34 98 q21 -14 42 0 q-4 10 -21 10 q-17 0 -21 -10 z" fill="${b.saddle}"/>` : ''}
      ${b.spots ? `<circle cx="42" cy="100" r="3" fill="${b.spots}"/><circle cx="70" cy="108" r="3.5" fill="${b.spots}"/><circle cx="64" cy="96" r="2.2" fill="${b.spots}"/>` : ''}
      <ellipse cx="55" cy="108" rx="13" ry="12" fill="${b.muzzle === '#3a3a3a' || b.muzzle === '#44444e' ? fur : b.muzzle}" opacity="${b.sclera && !b.blaze ? 0.5 : 1}"/></g>
      <ellipse class="dog-paw dog-paw-l" cx="41" cy="122" rx="7" ry="5" fill="${dark}"/><ellipse class="dog-paw dog-paw-r" cx="69" cy="122" rx="7" ry="5" fill="${dark}"/>
      ${g.has('botas') ? `<ellipse cx="41" cy="122" rx="8" ry="6" fill="${c}"/><ellipse cx="69" cy="122" rx="8" ry="6" fill="${c}"/>` : ''}
      ${g.has('mochila') ? `<rect x="72" y="92" width="14" height="18" rx="4" fill="${c}"/><rect x="74" y="98" width="10" height="6" rx="2" fill="#fff" opacity=".5"/>` : ''}
      ${g.has('pelota') ? '<g class="dog-ball"><circle cx="16" cy="121" r="7" fill="#d9f99d" stroke="#65a30d" stroke-width="1.5"/><path d="M10 117 q6 4 12 0 M10 125 q6 -4 12 0" stroke="#fff" stroke-width="1.3" fill="none"/></g>' : ''}
      ${g.has('pajarita') ? `<path d="M55 86 l-11 -6 v12 z M55 86 l11 -6 v12 z" fill="${c}"/><circle cx="55" cy="86" r="3" fill="#111"/>` : ''}
      ${g.has('dino') ? '<path d="M72 92 l6 -6 l2 8 l6 -5 l1 9" fill="#4ade80" stroke="#16a34a" stroke-width="1.2"/>' : ''}
      ${g.has('collar') ? '<path d="M36 82 q19 10 38 0" stroke="#dc2626" stroke-width="5" fill="none" stroke-linecap="round"/>' : ''}
      ${g.has('chapa') ? '<circle cx="55" cy="90" r="4.5" fill="#facc15" stroke="#b45309" stroke-width="1.2"/>' : ''}
      ${g.has('panuelo') ? `<path d="M38 82 q17 9 34 0 l-17 16 z" fill="${c}"/>` : ''}
    </g>`;
    return `<svg class="dog live wag${o.wag || 0}" viewBox="0 0 110 132" ${o.size ? `width="${o.size}" height="${Math.round(o.size * 1.2)}"` : ''}>${body}${head}</svg>`;
  }
  function dogHead(o) { return dogSVG(Object.assign({}, o, { headOnly: true })); }

  // trucos al tocarlo (animaciones divertidas)
  const TRICKS = [
    { c: 'jump', km: 0, name: 'Saltar', ic: '⤴️', say: ['¡Guau!', '¡Hop!'] },
    { c: 'shake', km: 0, name: 'Sacudirse', ic: '💦', say: ['*se sacude*', '¡Brrr!'] },
    { c: 'bark', km: 0, name: 'Ladrar', ic: '🗯️', say: ['¡GUAU GUAU!', '¡Guau! ¿Salimos?'] },
    { c: 'spin', km: 2, name: 'Dar vueltas', ic: '🌀', say: ['¡Mira qué vuelta!', '¡Wiii!'] },
    { c: 'beg', km: 5, name: 'Pedir galleta', ic: '🍪', say: ['¿Una galleta? 🍪', '*pone ojitos*'] },
    { c: 'hearts', km: 10, name: 'Dar mimos', ic: '💖', say: ['¡Te quiero! 💖', '*lametón*'] },
    { c: 'dance', km: 20, name: 'Bailar', ic: '🎵', say: ['¡A bailar! 🎵', '*mueve el esqueleto*'] },
    { c: 'flip', km: 35, name: 'Voltereta', ic: '🤸', say: ['¡Voltereta!', '¡Ta-chán!'] },
    { c: 'dig', km: 50, name: 'Escarbar', ic: '🦴', say: ['*escarba*', '¡Aquí hay un hueso! 🦴'] },
    { c: 'sleep', km: 75, name: 'Hacerse el dormido', ic: '😴', say: ['Zzz…', '*ronca*'] },
    { c: 'moon', km: 100, name: 'Paso lunar', ic: '🕺', say: ['¡Hii-hii! 🕺', '¡Como Michael!'] },
    { c: 'rocket', km: 200, name: 'Superperro', ic: '🚀', say: ['¡Al infinito! 🚀', '¡Superperro al rescate!'] },
  ];

  function create(ctx) {
    const { S, toast, openSheet, $ } = ctx;
    const today = () => PM.today();

    // =============== EL PERRO ===============
    function pet() { const s = S(); if (!s.pet) { s.pet = { name: 'Pincel', born: Date.now(), breed: 'mestizo' }; PM.state.save(); } if (!s.pet.breed) s.pet.breed = 'mestizo'; return s.pet; }
    function walkedTodayM() {
      const s = S(), t0 = new Date(); t0.setHours(0, 0, 0, 0);
      const m = (s.walks || []).filter((w) => w.start >= t0.getTime()).reduce((a, w) => a + ((w.st && w.st.walked) || 0), 0);
      return m + (ctx.sessionWalked() || 0);
    }
    function daysAway() {
      const last = S().stats.lastDay;
      if (!last) return 99;
      return Math.round((new Date(today() + 'T12:00') - new Date(last + 'T12:00')) / 86400000);
    }
    function petState() {
      const s = S(), p = pet();
      const nAch = Object.keys(s.achievements || {}).length;
      const bones = p.bones || 0;
      const owned = GEAR.filter((g) => (g.b ? bones >= g.b : nAch >= g.n)).map((g) => g.id);
      const off = new Set(p.off || []);
      const gear = owned.filter((id) => !off.has(id));
      const km = (s.stats.walkedM || 0) / 1000;
      const stage = STAGES.filter((x) => km >= x.km).pop();
      const wt = walkedTodayM();
      const hearts = wt >= 3000 ? 3 : wt >= 1500 ? 2 : wt >= 500 ? 1 : 0;
      const away = daysAway();
      const mood = ctx.inSession() ? 'paseando' : hearts > 0 || away === 0 ? 'feliz' : away === 1 ? 'contento' : away <= 3 ? 'aburrido' : 'triste';
      // días con los 3 corazones (logro «Perro feliz»)
      if (hearts >= 3 && p.fullDay !== today()) { p.fullDay = today(); p.fullDays = (p.fullDays || 0) + 1; PM.state.save(); }
      const tricks = TRICKS.filter((t) => km >= t.km);
      return { p, gear, owned, km, stage, hearts, wt, mood, M: MOODS[mood], nAch, next: GEAR.find((g) => g.n && nAch < g.n), nextBone: GEAR.find((g) => g.b && bones < g.b), bones, tricks, nextTrick: TRICKS.find((t) => km < t.km) };
    }
    const look = (st, extra) => Object.assign({ breed: st.p.breed, face: st.M.face, gear: st.gear, color: S().color, wag: st.M.wag }, extra || {});
    let petKey = '';
    function drawPetBtn() {
      const el = $('#btn-pet'); if (!el) return;
      const st = petState();
      const key = st.mood + st.gear.join() + S().color + st.p.breed;
      if (key === petKey) return;
      petKey = key;
      el.innerHTML = dogHead(look(st)) + (st.mood === 'aburrido' || st.mood === 'triste' ? '<i class="pet-alert">!</i>' : '');
      el.className = 'mood-' + st.mood;
    }
    // el botón del mapa también hace gracias (al capturar, subir de nivel…)
    function btnTrick(cls) {
      const el = $('#btn-pet'); if (!el) return;
      el.classList.remove('trick-jump', 'trick-spin', 'trick-shake'); void el.offsetWidth; el.classList.add('trick-' + cls);
      setTimeout(() => el.classList.remove('trick-' + cls), 900);
    }
    // bocadillo junto a su botón
    let sayT = 0, sayTimer = null;
    function say(text, important) {
      const now = Date.now();
      if (!important && now - sayT < 20000) return;
      sayT = now;
      const b = $('#pet-say'); if (!b) return;
      b.textContent = text;
      b.classList.add('show');
      clearTimeout(sayTimer); sayTimer = setTimeout(() => b.classList.remove('show'), 3600);
    }
    // partículas (corazones, notas, tierra…) que salen del perro grande
    function burst(box, chars, n) {
      for (let i = 0; i < n; i++) {
        const sp = document.createElement('span');
        sp.className = 'pet-fx'; sp.textContent = pickOne(chars);
        sp.style.left = (35 + Math.random() * 30) + '%'; sp.style.setProperty('--dx', (Math.random() * 80 - 40) + 'px');
        sp.style.animationDelay = (i * 0.08) + 's';
        box.appendChild(sp); setTimeout(() => sp.remove(), 1600);
      }
    }
    function doTrick(big, which) {
      const st = petState();
      const t = which ? TRICKS.find((x) => x.c === which) : pickOne(st.tricks), cls = 'trick-' + t.c;
      const p = pet(); p.tricks = (p.tricks || 0) + 1; PM.state.save();
      TRICKS.forEach((x) => big.classList.remove('trick-' + x.c)); void big.offsetWidth; big.classList.add(cls);
      setTimeout(() => big.classList.remove(cls), t.c === 'sleep' || t.c === 'rocket' || t.c === 'dance' || t.c === 'moon' ? 2200 : 1300);
      if (t.c === 'hearts') burst(big, ['💖', '💕', '❤️'], 6);
      if (t.c === 'bark') burst(big, ['💬', '🎵', '!'], 3);
      if (t.c === 'dig') burst(big, ['🟫', '🦴', '·'], 5);
      if (t.c === 'flip' || t.c === 'spin') burst(big, ['✨', '⭐'], 4);
      if (t.c === 'dance' || t.c === 'moon') burst(big, ['🎵', '🎶', '✨'], 6);
      if (t.c === 'sleep') burst(big, ['z', 'Z', '💤'], 4);
      if (t.c === 'rocket') burst(big, ['🔥', '✨', '💨'], 7);
      say(pickOne(t.say), true);
      PM.vibrate && PM.vibrate(t.c === 'bark' ? [30, 40, 30] : 20);
    }
    function bonesLine() {
      const b = S().bones;
      if (!b || b.day !== today()) return '';
      const got = b.list.filter((x) => x.got).length;
      return `<div class="pet-bones">${b.list.map((x) => `<span class="${x.got ? 'on' : ''}">🦴</span>`).join('')}<small>${got}/${b.list.length} huesos hoy · ${got < b.list.length ? 'sal a pintar y tu perro los olfateará' : '¡todos encontrados!'}</small></div>`;
    }
    function showPet() {
      const st = petState(), p = st.p;
      const nextStage = STAGES.find((x) => x.km > st.km);
      const tip = st.hearts >= 3 ? '¡Hoy ya está a tope! 💖' : `Sácalo a pasear: ${st.hearts === 0 ? '500 m' : st.hearts === 1 ? '1,5 km' : '3 km'} hoy para ${st.hearts === 0 ? 'su primer corazón' : 'otro corazón'}.`;
      const sleepy = st.mood === 'aburrido' || st.mood === 'triste';
      openSheet('🐶 ' + p.name, `<div class="pet-card mood-${st.mood}">
          <div class="pet-stage"><button class="pet-swap" id="pet-swap" title="Cambiar de perro">🔄</button><div class="pet-big" style="--k:${st.stage.k}">${dogSVG(look(st, { size: 150 }))}</div>
            ${sleepy ? '<span class="pet-z">z</span><span class="pet-z z2">z</span><span class="pet-z z3">Z</span>' : ''}<div class="pet-shadow"></div></div>
          <div class="pet-name"><input id="pet-name" value="${esc(p.name)}" maxlength="16" aria-label="Nombre del perro"><span>✏️</span></div>
          <div class="pet-mood">${st.M.t} · <b>${BREEDS[p.breed].name}</b></div>
          <div class="pet-hearts">${[0, 1, 2].map((i) => `<span class="${i < st.hearts ? 'on' : ''}">❤</span>`).join('')}<small>${PM.fmtDist(st.wt)} hoy</small></div>
          <p class="muted" style="text-align:center;margin:4px 0 6px">${tip}</p>
          <small class="muted pet-hint">Tócalo y hará un truco 🐾</small>
          ${bonesLine()}
        </div>
        <div class="pet-breed-box" id="pet-breed-box" ${p.breedChosen ? 'hidden' : ''}>
        <h4 style="margin:14px 0 8px">${p.breedChosen ? 'Cambiar de perro' : '¿Qué perro quieres?'}</h4>
        <div class="pet-breeds">${Object.entries(BREEDS).map(([id, b]) => `<button class="${id === p.breed ? 'on' : ''}" data-breed="${id}">${dogHead({ breed: id, face: 'happy', color: S().color })}<small>${b.name}</small></button>`).join('')}</div></div>
        <div class="stats" style="margin-top:14px">
          <div><b>${st.stage.name}</b><small>${nextStage ? `${Math.max(0, nextStage.km - st.km).toFixed(1)} km para ${nextStage.name.toLowerCase()}` : 'el más sabio'}</small></div>
          <div><b>${st.km.toFixed(1)} km</b><small>paseados juntos</small></div>
          <div><b>${S().stats.streak || 0} 🔥</b><small>días seguidos</small></div>
        </div>
        <h4 style="margin:16px 0 8px">Trucos <small class="muted">· se aprenden paseando juntos</small></h4>
        <div class="pet-tricks">${TRICKS.map((t) => { const on = st.km >= t.km; return `<button class="${on ? 'on' : ''}" ${on ? `data-trick="${t.c}"` : 'disabled'}><span>${on ? t.ic : '🔒'}</span><b>${t.name}</b><small>${on ? 'toca para verlo' : t.km + ' km juntos'}</small></button>`; }).join('')}</div>
        ${st.nextTrick ? `<p class="muted" style="margin-top:8px">Próximo truco: <b>${st.nextTrick.name}</b> a los ${st.nextTrick.km} km (te faltan ${Math.max(0, st.nextTrick.km - st.km).toFixed(1)} km).</p>` : ''}
        <h4 style="margin:16px 0 8px">Accesorios <small class="muted">· se ganan con logros (${st.nAch}) · toca para ponérselo o quitárselo</small></h4>
        <div class="pet-gear">${GEAR.map((g) => { const has = st.owned.includes(g.id), on = st.gear.includes(g.id); return `<button class="${has ? (on ? 'on' : 'own') : ''}" ${has ? `data-gear="${g.id}"` : 'disabled'}><span>${has ? g.ic : '🔒'}</span><b>${g.name}</b><small>${has ? (on ? 'puesto ✓' : 'guardado') : g.b ? g.b + ' huesos 🦴' : g.n + ' logros'}</small></button>`; }).join('')}</div>
        ${st.next ? `<p class="muted" style="margin-top:10px">Siguiente: <b>${st.next.name}</b> con ${st.next.n} logros (te faltan ${st.next.n - st.nAch}).</p>` : ''}
        ${st.nextBone ? `<p class="muted">🦴 Huesos encontrados: <b>${st.bones}</b> · el próximo exclusivo (${st.nextBone.name}) a los ${st.nextBone.b}.</p>` : `<p class="muted">🦴 Huesos encontrados: <b>${st.bones}</b>.</p>`}`);
      const inp = $('#pet-name');
      inp.addEventListener('change', () => { const v = inp.value.trim().slice(0, 16); if (v) { pet().name = v; PM.state.save(); $('#sheet h3').textContent = '🐶 ' + v; } });
      const big = document.querySelector('.pet-big');
      big.addEventListener('click', () => doTrick(big));
      $('#pet-swap').addEventListener('click', () => { const bx = $('#pet-breed-box'); bx.hidden = !bx.hidden; if (!bx.hidden) bx.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
      document.querySelectorAll('.pet-tricks [data-trick]').forEach((b) => b.addEventListener('click', () => { big.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => doTrick(big, b.dataset.trick), 250); }));
      document.querySelectorAll('.pet-gear [data-gear]').forEach((b) => b.addEventListener('click', () => {
        const p = pet(), off = new Set(p.off || []), id = b.dataset.gear;
        if (off.has(id)) off.delete(id); else off.add(id);
        p.off = [...off]; PM.state.save(); petKey = '';
        const body = document.querySelector('#sheet .body'), y = body ? body.scrollTop : 0;
        showPet(); drawPetBtn(); if (body) document.querySelector('#sheet .body').scrollTop = y;
      }));
      document.querySelectorAll('.pet-breeds [data-breed]').forEach((bt) => bt.addEventListener('click', () => {
        const p = pet(); p.breed = bt.dataset.breed; p.breedChosen = true;
        p.breeds = [...new Set([...(p.breeds || []), bt.dataset.breed])]; PM.state.save(); petKey = '';
        const body = document.querySelector('#sheet .body'), y = body ? body.scrollTop : 0;
        showPet(); drawPetBtn();
        if (body) document.querySelector('#sheet .body').scrollTop = y;
        const nb = document.querySelector('.pet-big'); if (nb) { nb.classList.add('trick-jump'); burst(nb, ['✨', '🐾'], 4); }
        say(pickOne(['¡Guau! ¿Te gusta mi nuevo look?', '¡Soy yo, pero distinto! 🐾', '¡Qué guapo me veo!']), true);
      }));
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
      const b = $('#nav-profile');
      if (!b) return;
      b.classList.toggle('has-avatar', !!S().avatar);
      b.style.setProperty('--avatar', S().avatar ? `url('${S().avatar}')` : 'none');
    }

    // =============== TU PERRO EN EL MAPA ===============
    // camina a tu lado (un poco por detrás), se sienta cuando paras, corre si aceleras y olfatea cerca de lugares y huesos
    const map = ctx.map;
    let md = null, mdPos = null, mdKey = '', mdState = '', mdFlipX = 1, mdLastPx = null;
    function mapDogEl() {
      const el = document.createElement('div'); el.className = 'mapdog';
      el.innerHTML = '<div class="md-flip"><div class="md-body"></div></div><div class="md-shadow"></div>';
      return el;
    }
    function frame(dt, p, headingDeg, speed) {
      if (!p || !map) return;
      const z = map.getZoom();
      if (!md) { md = new maplibregl.Marker({ element: mapDogEl(), anchor: 'bottom' }).setLngLat([p[1], p[0]]).addTo(map); }
      const el = md.getElement();
      el.style.display = z < 14.3 ? 'none' : '';
      if (z < 14.3) return;
      const st = petState();
      const key = st.p.breed + st.gear.join() + st.M.face + S().color;
      if (key !== mdKey) { mdKey = key; el.querySelector('.md-body').innerHTML = dogSVG(look(st, { face: st.M.face === 'sad' ? 'normal' : st.M.face, wag: 2 })); }
      // sitio: unos metros por detrás y a tu derecha
      const h = (headingDeg || 0) * Math.PI / 180, back = 6, side = 3.5;
      const tgt = PM.geo.offset(p, -Math.sin(h) * back + Math.cos(h) * side, -Math.cos(h) * back - Math.sin(h) * side);
      if (!mdPos || PM.geo.dist(mdPos, tgt) > 80) mdPos = tgt.slice();
      else mdPos = PM.geo.lerp(mdPos, tgt, Math.min(1, dt * (speed > 2.5 ? 4 : 2.4)));
      md.setLngLat([mdPos[1], mdPos[0]]);
      // mira hacia donde va (en pantalla)
      const px = map.project([mdPos[1], mdPos[0]]).x;
      if (mdLastPx != null && Math.abs(px - mdLastPx) > 0.6) mdFlipX = px < mdLastPx ? -1 : 1;
      mdLastPx = px;
      const lag = PM.geo.dist(mdPos, tgt);
      let state = speed > 2.5 || lag > 12 ? 'run' : speed > 0.4 || lag > 2 ? 'walk' : 'sit';
      if (sniffing && state !== 'run') state = 'sniff';
      if (state !== mdState) { mdState = state; el.className = 'mapdog md-' + state; }
      el.querySelector('.md-flip').style.transform = `scaleX(${mdFlipX})`;
      el.style.setProperty('--mds', Math.max(0.65, Math.min(1.25, (z - 13.5) / 3.5)).toFixed(2));
    }
    function dogTrickOnMap(cls) {
      if (!md) return;
      const el = md.getElement(); el.classList.remove('md-t-jump', 'md-t-spin'); void el.offsetWidth; el.classList.add('md-t-' + cls);
      setTimeout(() => el.classList.remove('md-t-' + cls), 900);
    }

    // =============== HUESOS ESCONDIDOS ===============
    // cada día se esconden 5 huesos en calles sin pintar cerca de ti; tu perro los huele a 150 m y los coges al pasar (20 m)
    const BONES_N = 5, SNIFF_R = 150, GET_R = 22;
    let sniffing = false;
    function bonesGen(pos) {
      const s = S(), b = s.bones;
      if (b && b.day === today() && PM.geo.dist(b.c, pos) < 3000) return b;
      const W = ctx.W, cand = [];
      for (const id in W.pieces) {
        const pc = W.pieces[id];
        if (pc.trail || pc.avoid || s.painted[id] || pc.len < 5) continue;
        const d = PM.geo.dist(pc.mid, pos);
        if (d >= 120 && d <= 750) cand.push(pc);
      }
      if (cand.length < BONES_N) return b && b.day === today() ? b : null;
      const list = [];
      for (let tries = 0; tries < 300 && list.length < BONES_N; tries++) {
        const pc = cand[Math.floor(Math.random() * cand.length)];
        if (list.some((x) => PM.geo.dist(x.pos, pc.mid) < 160)) continue;
        list.push({ id: pc.id, pos: [+pc.mid[0].toFixed(6), +pc.mid[1].toFixed(6)], got: 0, seen: 0 });
      }
      s.bones = { day: today(), c: pos.slice(), list };
      PM.state.save();
      drawBones();
      return s.bones;
    }
    function drawBones() {
      const b = S().bones, f = [];
      if (b && b.day === today()) for (const x of b.list) if (x.seen && !x.got) f.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [x.pos[1], x.pos[0]] } });
      ctx.setSrc('pm-bones', ctx.FC(f));
    }
    function bonesTick(pos) {
      const b = S().bones;
      sniffing = false;
      if (!b || b.day !== today() || !ctx.inSession()) return;
      let changed = false;
      for (const x of b.list) {
        if (x.got) continue;
        const d = PM.geo.dist(pos, x.pos);
        if (d <= SNIFF_R) sniffing = true;
        if (d <= SNIFF_R && !x.seen) { x.seen = 1; changed = true; say('👃 ¡Huelo un hueso cerca! Mira el mapa 🦴', true); dogTrickOnMap('jump'); PM.vibrate && PM.vibrate([30, 60, 30]); }
        if (d <= GET_R) {
          x.got = Date.now(); changed = true;
          const p = pet(); p.bones = (p.bones || 0) + 1;
          ctx.G.addXP(50, 'bones');
          const got = b.list.filter((y) => y.got).length;
          toast(`🦴 ¡Hueso encontrado! +50 · ${got}/${b.list.length} hoy`, got === b.list.length ? 'gold' : 'ok', 3200);
          say(got === b.list.length ? '¡Todos los huesos de hoy! ¡Eres el mejor! 🏆' : pickOne(['¡Ñam! ¡Un hueso! 🦴', '¡Lo encontré! 🦴', '¡Guau! ¡Otro hueso!']), true);
          dogTrickOnMap('spin'); btnTrick('jump');
          const nb = GEAR.find((g) => g.b === p.bones);
          if (nb) setTimeout(() => toast(`🎁 ¡Accesorio exclusivo para tu perro: <b>${nb.name}</b>!`, 'gold', 4500), 1200);
          ctx.G.checkAchievements();
        }
      }
      if (changed) { PM.state.save(); drawBones(); }
    }
    function addLayers(add) {
      if (!map.hasImage('pm-bone')) {
        const k = 2, sz = 34 * k, cv = document.createElement('canvas'); cv.width = sz; cv.height = sz;
        const x = cv.getContext('2d');
        x.beginPath(); x.arc(sz / 2, sz / 2, 15 * k, 0, 2 * Math.PI); x.fillStyle = '#fff7ed'; x.fill(); x.lineWidth = 2.5 * k; x.strokeStyle = '#f59e0b'; x.stroke();
        x.font = `${18 * k}px "Noto Color Emoji","Apple Color Emoji","Segoe UI Emoji",sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('🦴', sz / 2, sz / 2 + k);
        try { map.addImage('pm-bone', x.getImageData(0, 0, sz, sz), { pixelRatio: k }); } catch (e) {}
      }
      add({ id: 'pm-bones', type: 'symbol', source: 'pm-bones', layout: { 'icon-image': 'pm-bone', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 13, 0.6, 17, 1.05] } }, true);
      drawBones();
    }

    // =============== ciclo ===============
    function tick() {
      drawPetBtn();
      const pos = ctx.getPos();
      if (pos && Object.keys(ctx.W.pieces).length > 50) { bonesGen(pos); bonesTick(pos); }
    }
    function onEvent(ev, d) {
      if (ev === 'captured' || ev === 'levelup' || ev === 'conquered') dogTrickOnMap(ev === 'captured' ? 'jump' : 'spin');
      if (ev === 'start') { btnTrick('jump'); say(petState().mood === 'triste' ? '¡Por fin! ¡Te echaba de menos! 🐾' : '¡Guau! ¡Vamos a pintar! 🐾', true); }
      else if (ev === 'km') { btnTrick('spin'); say(`¡${d} km! Sigue, sigue 🐾`); }
      else if (ev === 'captured' && d.first) { btnTrick('jump'); say(pickOne(['¡Qué sitio más chulo!', '¡Otro para la colección! 🃏', '¡Guau, qué bonito!'])); }
      else if (ev === 'conquered') { btnTrick('spin'); say('¡Este barrio ya es nuestro! 🚩', true); }
      else if (ev === 'levelup') { btnTrick('spin'); say('¡Subimos de nivel! ⭐', true); }
      else if (ev === 'end') { btnTrick('shake'); say(petState().hearts >= 2 ? '¡Qué buen paseo! Estoy agotado 😴' : '¡Gracias por el paseo! 🦴', true); }
      petKey = '';
    }
    function greet() {
      const away = daysAway();
      if (away >= 2 && away < 99) setTimeout(() => { btnTrick('shake'); say(away >= 4 ? `Llevamos ${away} días sin salir… 🥺` : '¿Salimos hoy? 🐾', true); }, 2500);
    }
    $('#btn-pet') && $('#btn-pet').addEventListener('click', showPet);
    refreshAvatar();
    return { tick, frame, addLayers, drawBones, onEvent, greet, say, showPet, avatarHTML, changeAvatar, removeAvatar, refreshAvatar };
  }
  return { create, dogSVG, dogHead, GEAR, BREEDS };
})();
