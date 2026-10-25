// PintaMapa — tu progreso REAL en la nube (como BusMet: la clave de GitHub va dentro de la app).
// Cada jugador solo pone su nombre de pintor y una contraseña. Su partida se CIFRA con esa contraseña
// (AES-256-GCM) antes de subirse al repositorio público luzferlux77/pintamapa-progreso: nadie más puede leerla.
//   j/<huella>/partida.json   → progreso, logros, paseos, monumentos (cifrado)
//   j/<huella>/calles-AAAA-MM-DD.json → geometría de las calles pintadas cada día (cifrado; antes, un archivo por mes)
// <huella> = SHA-256(pintor + contraseña): ni siquiera el nombre se ve en el repositorio.
// Funciona por Wi-Fi o datos, sin depender de ningún PC encendido. «Mi progreso» lo lee con pintor + contraseña.
PM.cloud = (function () {
  const REPO = 'luzferlux77/pintamapa-progreso';
  const API = 'https://api.github.com/repos/' + REPO + '/contents/';
  const KEY = 'pintamapa_cloud';
  let cfg = {};
  try { cfg = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}
  let busy = false;

  // clave de escritura incluida en la app al compilar (www/js/clave.js, ofuscada)
  function writeToken() {
    if (!PM.CLAVE) return '';
    try {
      const raw = atob(PM.CLAVE.d), k = PM.CLAVE.k;
      let out = '';
      for (let i = 0; i < raw.length; i++) out += String.fromCharCode(raw.charCodeAt(i) ^ k.charCodeAt(i % k.length));
      return out.split('').reverse().join('');
    } catch (e) { return ''; }
  }

  // contraseña del pintor actual (guardada en este móvil)
  const passKey = () => 'pw_' + (PM.player ? PM.player.slug : '');
  const password = () => cfg[passKey()] || '';
  function setPassword(p) { cfg[passKey()] = String(p || ''); try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} }
  // De momento la nube es solo para el dueño de la app (no se pueden mantener servidores para más gente):
  // el resto de pintores juega igual, con todo guardado en su móvil (y copia de seguridad en archivo).
  const OWNER = 'luzfer';
  const allowed = () => !!(PM.player && PM.player.slug === OWNER);
  const ready = () => !!(allowed() && password() && writeToken());

  // ---- cifrado ----
  const enc = new TextEncoder(), dec = new TextDecoder();
  const toB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const fromB64 = (b) => { const s = atob(b); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  async function sha256hex(text) {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
    return [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  async function deriveKey(slug, pass) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: enc.encode('pintamapa:' + slug), iterations: 150000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encrypt(key, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj))));
    return { v: 1, iv: toB64(iv), ct: toB64(ct) };
  }
  async function decrypt(key, box) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(box.iv) }, key, fromB64(box.ct));
    return JSON.parse(dec.decode(pt));
  }
  // nombre del archivo de una foto: no revela qué lugar es
  async function photoName(id, pass) { return (await sha256hex(id + '|' + pass)).slice(0, 24); }
  async function folderOf(slug, pass) { return 'j/' + (await sha256hex(slug + '\n' + pass)).slice(0, 40) + '/'; }

  // ---- GitHub ----
  async function gh(path, opts = {}, token) {
    const headers = Object.assign({ 'X-GitHub-Api-Version': '2022-11-28', Accept: 'application/vnd.github+json' }, opts.headers || {});
    if (token) headers.Authorization = 'Bearer ' + token;
    const r = await fetch(API + path + (opts.method ? '' : '?t=' + Date.now()), Object.assign({}, opts, { cache: 'no-store', headers }));
    if (r.status === 404) return null;
    if (r.status === 401 || r.status === 403) throw new Error('La clave de la nube de esta versión no es válida (avisa a quien te pasó la app)');
    if (!r.ok) { const e = new Error('GitHub respondió ' + r.status); e.status = r.status; throw e; }
    return r.json();
  }
  // lee un archivo JSON del repositorio (público) → { data, sha } o null
  async function readRaw(path, token) {
    const meta = await gh(path, {}, token);
    if (!meta) return null;
    let text;
    if (meta.content && meta.encoding === 'base64') text = dec.decode(fromB64(meta.content.replace(/\n/g, '')));
    else text = await (await fetch(meta.download_url + '?t=' + Date.now(), { cache: 'no-store' })).text();
    return { data: JSON.parse(text), sha: meta.sha };
  }
  function write(path, data, sha, msg, token) {
    return gh(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, content: toB64(enc.encode(JSON.stringify(data))), sha: sha || undefined }) }, token);
  }

  // Sube tu partida: lee la de la nube, las fusiona (nunca se pierde nada) y guarda la unión, cifrada.
  // huella de la partida local (sin lo que cambia solo): si no ha cambiado desde la última copia, no se sube nada.
  // (antes cada copia descargaba y subía la partida entera aunque fuera igual: en un paseo, ~8 MB de datos móviles)
  async function huella() {
    const d = Object.assign({}, PM.state.data); delete d.pendingGeo; delete d.session; delete d.syncedAt;
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(JSON.stringify(d)));
    return toB64(new Uint8Array(buf)).slice(0, 24);
  }
  const saveCfg = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} };
  // force: comprobar la nube aunque aquí no haya cambios (al abrir la app: puede haber novedades de otro dispositivo)
  async function now(force) {
    if (!allowed()) throw new Error('La nube de momento solo está disponible para el dueño de la app');
    if (!writeToken()) throw new Error('Esta versión de la app no trae la clave de la nube');
    if (!PM.player) throw new Error('Elige tu pintor');
    if (!password()) throw new Error('Pon una contraseña de pintor en Perfil → Mi cuenta en la nube');
    if (busy) return;
    busy = true;
    try {
      const token = writeToken(), slug = PM.player.slug, pass = password();
      const key = await deriveKey(slug, pass);
      const base = await folderOf(slug, pass);
      PM.state.flush();
      const hk = 'h_' + slug, photosPend = Object.values(PM.state.data.cardPhotos || {}).some((v) => !(v.up && v.up >= (v.t || 0)));
      const sinCambios = !force && cfg[hk] && cfg[hk] === await huella();
      if (sinCambios && !Object.keys(PM.state.data.pendingGeo || {}).length && !photosPend) return 'sin cambios';
      for (let attempt = 0; attempt < 3 && !sinCambios; attempt++) {
        const local = PM.state.data;
        const mine = Object.assign({}, local); delete mine.pendingGeo; delete mine.session;
        mine.player = PM.player.name;
        const remote = await readRaw(base + 'partida.json', token);
        let remoteSave = null;
        if (remote) { try { remoteSave = await decrypt(key, remote.data); } catch (e) { throw new Error('No se pudo descifrar la partida de la nube'); } }
        const merged = PM.merge(remoteSave, mine);
        try { await write(base + 'partida.json', await encrypt(key, merged), remote && remote.sha, 'progreso', token); }
        catch (e) { if (e.status === 409 || e.status === 422) continue; throw e; }   // otro móvil escribió a la vez
        const cur = PM.state.data;
        // se vuelve a fusionar con lo actual: lo pintado durante la subida (segundos) no se pierde
        PM.state.replace(Object.assign({}, PM.merge(merged, cur), { session: cur.session, pendingGeo: cur.pendingGeo, syncedAt: Date.now() }));
        cfg[hk] = await huella(); saveCfg();
        break;
      }
      const pend = PM.state.data.pendingGeo || {};
      const ids = Object.keys(pend);
      if (ids.length) {
        // un archivo por día: cada copia sube solo lo de hoy (antes, el del mes entero, cada vez más grande)
        const d = new Date(), day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        const path = base + 'calles-' + day + '.json';
        for (let attempt = 0; attempt < 3; attempt++) {
          const cur = await readRaw(path, token);
          const prev = cur ? await decrypt(key, cur.data) : {};
          try { await write(path, await encrypt(key, Object.assign(prev, pend)), cur && cur.sha, 'calles', token); break; }
          catch (e) { if ((e.status === 409 || e.status === 422) && attempt < 2) continue; throw e; }
        }
        const left = Object.assign({}, PM.state.data.pendingGeo);
        ids.forEach((id) => delete left[id]);
        PM.state.data.pendingGeo = left;
        PM.state.save();
      }
      // fotos propias de los cromos (cifradas igual): así «Mi progreso» también enseña TU foto
      const photos = PM.state.data.cardPhotos || {};
      for (const [id, v] of Object.entries(photos)) {
        if (v.up && v.up >= (v.t || 0)) continue;
        const img = PM.cards && await PM.cards.getPhoto(id);
        if (!img) continue;
        const small = await shrink(img, 800);
        const path = base + 'fotos/' + (await photoName(id, pass)) + '.json';
        const cur = await readRaw(path, token).catch(() => null);
        await write(path, await encrypt(key, { id, img: small }), cur && cur.sha, 'foto', token);
        v.up = Date.now(); PM.state.save();
      }
      return true;
    } finally { busy = false; }
  }

  // reduce la foto (dataURL) a como mucho `max` px de lado, en JPEG
  function shrink(dataUrl, max) {
    return new Promise((res) => {
      const im = new Image();
      im.onload = () => {
        const k = Math.min(1, max / Math.max(im.width, im.height));
        const c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', 0.8));
      };
      im.onerror = () => res(dataUrl);
      im.src = dataUrl;
    });
  }

  // Silenciosa: al abrir la app y al terminar un paseo. Sin cobertura no pasa nada: se reintenta más tarde.
  async function auto(toast, force) {
    if (!ready() || PM.profile !== 'real') return;
    try { const r = await now(force); if (toast && r !== 'sin cambios') toast('☁️ Progreso guardado en la nube', 'info'); }
    catch (e) { console.warn('Guardado en la nube pendiente', e); }
  }

  // Para «Mi progreso»: carga la partida de un pintor con su contraseña (lectura pública, sin clave)
  async function load(name, pass) {
    const slug = PM.slug(name);
    const key = await deriveKey(slug, pass);
    const base = await folderOf(slug, pass);
    const p = await readRaw(base + 'partida.json');
    if (!p) return null;
    const save = await decrypt(key, p.data);
    const geo = {};
    const files = (await gh(base.replace(/\/$/, ''))) || [];
    for (const f of files) {
      if (!/^calles-.*\.json$/.test(f.name)) continue;
      const c = await readRaw(base + f.name);
      if (c) Object.assign(geo, await decrypt(key, c.data));
    }
    // tus fotos de cromo: se descargan al abrir cada carta
    const photo = async (id) => {
      try {
        const f = await readRaw(base + 'fotos/' + (await photoName(id, pass)) + '.json');
        return f ? (await decrypt(key, f.data)).img : null;
      } catch (e) { return null; }
    };
    return { save, geo, photo };
  }

  return { now, auto, ready, allowed, load, password, setPassword, hasKey: () => !!writeToken(), REPO,
    token: () => (password() ? 'ok' : '') };   // compatibilidad: "¿está conectada la nube?"
})();
PM.sync = PM.cloud;
