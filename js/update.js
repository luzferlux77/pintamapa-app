// PintaMapa — actualizaciones automáticas desde GitHub (como BusMet)
// - Cambios del juego (casi todos): se descarga el código nuevo en segundo plano y se aplica al volver
//   a abrir la app («actualización en caliente», @capgo/capacitor-updater). No hay que reinstalar.
// - Cambios internos de Android (permisos, plugins nativos): aviso para descargar e instalar la APK nueva.
PM.update = (function () {
  const REPO = 'luzferlux77/pintamapa-app';
  const APP_JSON = `https://raw.githubusercontent.com/${REPO}/main/app.json`;
  const ST_KEY = 'pintamapa_upd';
  const U = () => (PM.isNative && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorUpdater) || null;
  let busy = false, lastCheck = 0;

  // Hay que confirmar cada arranque o el actualizador vuelve a la versión anterior (protección ante fallos). Se confirma
  // cuando el juego ha arrancado de verdad (al final de main.js), no al cargar este archivo: si una versión nueva
  // fallara al arrancar, a los 15 s se vuelve sola a la anterior.
  let listoHecho = false;
  function listo() { if (listoHecho || !U()) return; listoHecho = true; U().notifyAppReady().catch(() => {}); }
  // (red de seguridad: si el juego está en marcha —partida, mapa, cartas y paseos cargados— aunque algo del final de
  // main.js fallara, la versión vale; solo vuelve atrás una versión que de verdad no arranca)
  setTimeout(() => { if (PM.state && PM.world && PM.game && PM.cards && PM.walking) listo(); }, 6000);

  function newer(a, b) {
    const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0); }
    return false;
  }
  function setStatus(msg) { try { localStorage.setItem(ST_KEY, JSON.stringify({ at: Date.now(), msg })); } catch (e) {} }
  function status() { try { return JSON.parse(localStorage.getItem(ST_KEY) || 'null'); } catch (e) { return null; } }

  async function fetchRemote() {
    const r = await fetch(APP_JSON + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  async function prepared(version) {
    try {
      const cur = await U().current();
      if (cur.bundle && cur.bundle.version === version) return true;
      const next = await U().getNextBundle().catch(() => null);
      if (next && next.version === version && next.status !== 'error') return true;
    } catch (e) {}
    return false;
  }

  // Nunca durante un paseo: el actualizador recarga la app al pasar a segundo plano (pantalla bloqueada)
  // y cortaría el seguimiento GPS. Se aplaza hasta finalizar el paseo.
  async function hold() {
    if (!U()) return;
    try {
      const cur = await U().current();
      const nx = await U().getNextBundle().catch(() => null);
      if (nx && cur.bundle && nx.id !== cur.bundle.id) await U().next({ id: cur.bundle.id });
    } catch (e) {}
  }

  async function check(manual, toast) {
    lastCheck = Date.now();
    if (PM.walking && PM.walking()) { setStatus('Actualización en espera: se buscará al terminar el paseo'); return; }
    let remote;
    try { remote = await fetchRemote(); }
    catch (e) { setStatus('No se pudo consultar la última versión (¿sin conexión?)'); return; }
    const mine = PM.VERSION.app;
    if (!newer(remote.version, mine)) { setStatus(`Al día: tienes la última versión (${mine})`); return; }
    if (!U()) { setStatus(`Hay una versión nueva (${remote.version})`); return; }
    if ((remote.native || 0) > PM.VERSION.native || !remote.bundle) {
      setStatus(`La ${remote.version} necesita instalar la APK nueva`);
      showApkBanner(remote);
      return;
    }
    if (busy) return;
    busy = true;
    try {
      const cur = await U().current().catch(() => null);
      if (cur && cur.bundle && cur.bundle.version === remote.version) { setStatus(`Al día: tienes la última versión (${remote.version})`); return; }
      const paseando = () => PM.walking && PM.walking();
      if (await prepared(remote.version)) {
        if (paseando()) { await hold(); setStatus('Actualización en espera: se buscará al terminar el paseo'); return; }
        setStatus(`La ${remote.version} está descargada: se aplica al volver a abrir la app`);
        if (manual) await applyVersion(remote.version); else showReadyBanner(remote);
        return;
      }
      // ¿ya estaba descargada? (p. ej. se apartó durante un paseo): se reutiliza; si quedó rota, se borra y se baja otra vez.
      // Antes se intentaba descargar de nuevo, el actualizador decía "esa versión ya existe" y la app se quedaba atascada.
      const list = await U().list().catch(() => ({ bundles: [] }));
      let b = (list.bundles || []).find((x) => x.version === remote.version);
      if (b && b.status === 'error') { await U().delete({ id: b.id }).catch(() => {}); b = null; }
      if (!b) {
        setStatus(`Descargando la ${remote.version}…`);
        b = await U().download({ url: remote.bundle, version: remote.version, checksum: remote.checksum });
      }
      // (la descarga tarda: si mientras tanto empezó un paseo, se queda apartada y no se programa hasta terminarlo)
      if (paseando()) { setStatus('Actualización en espera: se buscará al terminar el paseo'); return; }
      await U().next({ id: b.id });
      setStatus(`La ${remote.version} está descargada: se aplica al volver a abrir la app`);
      if (manual) await U().set({ id: b.id });                 // «Actualizar ahora»: se recarga ya
      else showReadyBanner(remote);
    } catch (e) {
      setStatus(`No se pudo descargar la ${remote.version}: ${(e && e.message) || e}. Se reintentará.`);
    } finally { busy = false; }
  }

  async function applyVersion(version) {
    const list = await U().list().catch(() => ({ bundles: [] }));
    const b = list.bundles.find((x) => x.version === version && x.status !== 'error');
    if (b) await U().set({ id: b.id });
  }

  // Versión nueva ya descargada: aviso visible (también encima de la pantalla de inicio) para aplicarla al momento
  function showReadyBanner(remote) {
    if (document.getElementById('apk-banner')) return;
    const el = document.createElement('div');
    el.id = 'apk-banner';
    el.innerHTML = `<span>🆕 <b>PintaMapa ${remote.version}</b> lista${remote.notes ? '<br><small>' + PM.esc(remote.notes) + '</small>' : ''}</span>
      <button class="btn on">Actualizar ahora</button><button class="x">✕</button>`;
    el.querySelector('.btn').addEventListener('click', async () => {
      if (PM.walking && PM.walking()) { el.querySelector('span').innerHTML = 'Termina el paseo y la aplico 😉'; return; }
      el.querySelector('.btn').textContent = '⏳';
      await applyVersion(remote.version);
    });
    el.querySelector('.x').addEventListener('click', () => el.remove());   // si no, se aplica sola al volver a abrir
    document.body.appendChild(el);
  }

  function showApkBanner(remote) {
    if (!remote.apk || document.getElementById('apk-banner')) return;
    const el = document.createElement('div');
    el.id = 'apk-banner';
    el.innerHTML = `<span>🆕 PintaMapa ${remote.version}: instala la versión nueva</span><button class="btn on">Instalar</button><button class="x">✕</button>`;
    el.querySelector('.btn').addEventListener('click', () => { location.href = remote.apk; });   // Android abre el navegador y descarga la APK
    el.querySelector('.x').addEventListener('click', () => el.remove());
    document.body.appendChild(el);
  }

  // Comprobaciones: al abrir, al volver a la app y cada cierto tiempo (Android puede tenerla días abierta)
  let watching = false;
  function watch(toast) {
    if (watching) return;
    watching = true;
    setTimeout(() => check(false, toast), 1500);
    const maybe = () => { if (!document.hidden && Date.now() - lastCheck > 30 * 60000) check(false, toast); };
    document.addEventListener('visibilitychange', maybe);
    setInterval(maybe, 15 * 60000);
  }

  return { check, watch, status, newer, hold, listo };
})();
// se comprueba nada más abrir la app (también en la pantalla de inicio, antes de elegir pintor)
PM.update.watch();
