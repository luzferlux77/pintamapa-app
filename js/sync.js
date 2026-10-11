// PintaMapa — tu progreso REAL guardado en la nube (repositorio privado de GitHub).
// No depende de ningún PC encendido: funciona por Wi-Fi o datos móviles, desde cualquier sitio.
//   jugadores/<pintor>/partida.json          → progreso, logros, paseos, monumentos
//   jugadores/<pintor>/calles/<año-mes>.json → geometría de las calles pintadas (para el mapa de «Mi progreso»)
// Acceso con un "token" de GitHub que solo puede tocar ese repositorio (lo pegas una vez en Perfil).
PM.cloud = (function () {
  const REPO = 'luzferlux77/pintamapa-progreso';
  const KEY = 'pintamapa_cloud';
  const API = 'https://api.github.com/repos/' + REPO + '/contents/';
  let cfg = {};
  try { cfg = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) {}
  let busy = false;

  const token = () => cfg.token || '';
  function setToken(t) { cfg.token = String(t || '').trim(); try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} }
  const slug = () => (PM.player ? PM.player.slug : '');
  const ready = () => !!(token() && slug());

  // ---- base64 <-> UTF-8 (trozos para no desbordar con partidas grandes) ----
  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64decode(b64) {
    const bin = atob(b64.replace(/\n/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  async function gh(path, opts = {}, raw = false) {
    const r = await fetch(API + path + (opts.method ? '' : '?t=' + Date.now()), Object.assign({}, opts, {
      cache: 'no-store',
      headers: Object.assign({ Authorization: 'Bearer ' + token(), 'X-GitHub-Api-Version': '2022-11-28',
        Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json' }, opts.headers || {}),
    }));
    if (r.status === 404) return null;
    if (r.status === 401) throw new Error('El token no es válido o ha caducado');
    if (r.status === 403) throw new Error('El token no tiene permiso de escritura en ' + REPO);
    if (!r.ok) { const e = new Error('GitHub respondió ' + r.status); e.status = r.status; throw e; }
    return raw ? r.text() : r.json();
  }
  // Lee un JSON del repositorio → { data, sha } (o null si no existe). Admite archivos de más de 1 MB.
  async function read(path) {
    const meta = await gh(path);
    if (!meta) return null;
    const text = meta.content && meta.encoding === 'base64' ? b64decode(meta.content) : await gh(path, {}, true);
    return { data: JSON.parse(text), sha: meta.sha };
  }
  function write(path, data, sha, msg) {
    return gh(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, content: b64encode(JSON.stringify(data)), sha: sha || undefined }) });
  }

  // Sube tu partida: lee la de la nube, las fusiona (nunca se pierde nada) y guarda la unión en los dos sitios.
  async function now() {
    if (!ready()) throw new Error('Pega tu token de GitHub en Perfil → Mi cuenta en la nube');
    if (busy) return;
    busy = true;
    try {
      PM.state.flush();
      const base = 'jugadores/' + slug() + '/';
      for (let attempt = 0; attempt < 3; attempt++) {
        const local = PM.state.data;
        const mine = Object.assign({}, local); delete mine.pendingGeo; delete mine.session;
        mine.player = PM.player.name;
        const remote = await read(base + 'partida.json');
        const merged = PM.merge(remote && remote.data, mine);
        try {
          await write(base + 'partida.json', merged, remote && remote.sha, `${PM.player.name}: progreso`);
        } catch (e) { if (e.status === 409 || e.status === 422) continue; throw e; }   // otro móvil escribió a la vez: reintentar
        const cur = PM.state.data;
        PM.state.replace(Object.assign({}, merged, { session: cur.session, pendingGeo: cur.pendingGeo, syncedAt: Date.now() }));
        break;
      }
      // calles pintadas (geometría), por meses para que cada archivo sea pequeño
      const pend = PM.state.data.pendingGeo || {};
      const ids = Object.keys(pend);
      if (ids.length) {
        const d = new Date(), month = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        const path = base + 'calles/' + month + '.json';
        for (let attempt = 0; attempt < 3; attempt++) {
          const cur = await read(path);
          const all = Object.assign({}, cur && cur.data, pend);
          try { await write(path, all, cur && cur.sha, `${PM.player.name}: ${ids.length} tramos`); break; }
          catch (e) { if ((e.status === 409 || e.status === 422) && attempt < 2) continue; throw e; }
        }
        const left = Object.assign({}, PM.state.data.pendingGeo);
        ids.forEach((id) => delete left[id]);
        PM.state.data.pendingGeo = left;
        PM.state.save();
      }
      return true;
    } finally { busy = false; }
  }

  // Silenciosa: al abrir la app y al terminar un paseo. Sin cobertura no pasa nada: se reintenta más tarde.
  async function auto(toast) {
    if (!ready() || PM.profile !== 'real') return;
    try { await now(); if (toast) toast('☁️ Progreso guardado en la nube', 'info'); }
    catch (e) { console.warn('Guardado en la nube pendiente', e); }
  }

  return { now, auto, ready, token, setToken, read, REPO };
})();
// compatibilidad con el nombre anterior
PM.sync = PM.cloud;
