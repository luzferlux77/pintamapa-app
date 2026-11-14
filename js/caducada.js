// PintaMapa — versiones caducadas (petición del usuario, 14-nov-2026: «que los usuarios de antes de esta última versión no
// puedan usar la aplicación y les quede invalidada»).
// Las APK antiguas se bajan este código igual que cualquier actualización (app.json lleva "native": 1 para que TODAS las
// versiones viejas lo acepten: desde la 0.3.0 miran ese número). Aquí se mira qué APK hay instalada de verdad y, si es
// anterior a PM.VERSION.apkMin (la primera APK con la parte nativa que necesita este código), se tapa el juego entero con
// un aviso que no se puede cerrar y un botón para bajar la APK nueva. La partida NO se toca: instalando la APK encima,
// todo sigue como estaba.
// Va justo detrás de version.js y no depende de nada: aunque el resto del código fallara en una APK vieja, el aviso sale.
(function () {
  var PM = (window.PM = window.PM || {});
  var APP_JSON = 'https://raw.githubusercontent.com/luzferlux77/pintamapa-app/main/app.json';
  var DESCARGAS = 'https://github.com/luzferlux77/pintamapa-app/releases/latest';

  // ¿la versión a es anterior a la b? ('0.9.3' < '0.9.4')
  function anterior(a, b) {
    var pa = String(a).split('.'), pb = String(b).split('.');
    for (var i = 0; i < 3; i++) { var x = +pa[i] || 0, y = +pb[i] || 0; if (x !== y) return x < y; }
    return false;
  }
  function t(s, vars) {
    if (PM.t) return PM.t(s, vars);
    return String(s).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? vars[k] : m; });
  }

  function mostrar(tengo, hace) {
    if (document.getElementById('pm-caducada')) return;
    PM.caducadaYa = true;
    var el = document.createElement('div');
    el.id = 'pm-caducada';
    el.setAttribute('translate', 'no');
    el.innerHTML =
      '<style>' +
      '#pm-caducada { position: fixed; inset: 0; z-index: 2147483647; background: #f4f6fb; color: #1a1d29; display: flex; align-items: center; justify-content: center; padding: 24px 20px calc(24px + env(safe-area-inset-bottom)); box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; touch-action: none; }' +
      '#pm-caducada .c { max-width: 380px; width: 100%; text-align: center; }' +
      '#pm-caducada .i { font-size: 64px; line-height: 1; margin-bottom: 18px; }' +
      '#pm-caducada h1 { font-size: 23px; line-height: 1.2; margin: 0 0 12px; font-weight: 800; }' +
      '#pm-caducada p { font-size: 16px; line-height: 1.45; margin: 0 0 22px; color: #3a4154; }' +
      '#pm-caducada button { display: block; width: 100%; border: 0; border-radius: 14px; background: #ff2e88; color: #fff; font: inherit; font-size: 17px; font-weight: 800; padding: 16px 18px; box-shadow: 0 6px 18px rgba(255, 46, 136, .32); }' +
      '#pm-caducada button:active { transform: scale(.98); }' +
      '#pm-caducada small { display: block; margin-top: 16px; font-size: 13px; line-height: 1.4; color: #5d6578; }' +
      '</style>' +
      '<div class="c"><div class="i">🎨</div>' +
      '<h1>' + t('Esta versión de PintaMapa ya no funciona') + '</h1>' +
      '<p>' + t('Para seguir jugando, instala la versión nueva. Tu partida, tus calles y tus cartas se quedan como están.') + '</p>' +
      '<button type="button">' + t('Descargar la versión nueva') + '</button>' +
      '<small>' + t('Cuando termine la descarga, ábrela e instálala encima de esta.') + '<br>' +
      t('Tienes la {a}; hace falta la {b} o una posterior.', { a: tengo, b: hace }) + '</small></div>';
    // nada de lo de debajo se puede tocar
    ['click', 'pointerdown', 'touchstart', 'keydown'].forEach(function (ev) { el.addEventListener(ev, function (e) { e.stopPropagation(); }, true); });
    var btn = el.querySelector('button');
    btn.addEventListener('click', function () {
      btn.textContent = '⏳';
      var ir = function (url) { location.href = url || DESCARGAS; setTimeout(function () { btn.textContent = t('Descargar la versión nueva'); }, 4000); };
      fetch(APP_JSON + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.json(); })
        .then(function (j) { ir(j && j.apk); }, function () { ir(null); });
    });
    (document.body || document.documentElement).appendChild(el);
    // que no se pueda quitar desde el juego (p. ej. una ventana que vacíe el cuerpo de la página)
    setInterval(function () { if (!document.getElementById('pm-caducada')) (document.body || document.documentElement).appendChild(el); }, 1000);
  }

  // La APK instalada: el actualizador la sabe (es el versionName de Android)
  function apkInstalada(U) {
    return U.current().then(function (r) { return r && r.native; }, function () { return null; })
      .then(function (v) {
        if (v || !U.getBuiltinVersion) return v || null;
        return U.getBuiltinVersion().then(function (r) { return r && r.version; }, function () { return null; });
      });
  }

  function comprobar() {
    var C = window.Capacitor;
    if (!(C && C.isNativePlatform && C.isNativePlatform())) return Promise.resolve(false);   // la web siempre es la última
    var U = C.Plugins && C.Plugins.CapacitorUpdater;
    var min = PM.VERSION && PM.VERSION.apkMin;
    if (!U || !min) return Promise.resolve(false);
    return apkInstalada(U).then(function (v) {
      if (!v || !/^\d+\.\d+/.test(v) || !anterior(v, min)) return false;
      // se confirma este código ante el actualizador: si no, a los 15 s volvería solo a la versión vieja y se saltaría el aviso
      try { U.notifyAppReady().catch(function () {}); } catch (e) {}
      var poner = function () { mostrar(v, min); };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', poner); else poner();
      return true;
    });
  }

  PM.caducada = { comprobar: comprobar, anterior: anterior };
  comprobar().catch(function () {});
})();
