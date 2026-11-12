// PintaMapa — bienvenida: lo que ve quien abre la app por primera vez (unas pantallas cortas) y su primer paseo guiado.
// Solo se carga para quien la necesita (PM.need). abrir(fin): las pantallas. guia(ctx): los avisos del primer paseo.
PM.bienvenida = (function () {
  const tw = (c) => `<img src="lib/twemoji/${c}.svg" alt="">`;
  // (dibujos propios, sin archivos: cada uno se anima una vez al llegar a su pantalla)
  const CALLES = 'M-10 62L310 34M-10 128L310 98M-10 192L310 164M58 -10L84 230M150 -10L170 230M238 -10L252 230M-10 18L120 -10M180 230L310 196';
  const TRAZO = 'M30 124L72 120L65 55L155 48L160 112L245 104';
  const ARTE = {
    pinta: `<svg viewBox="0 0 300 220" aria-hidden="true"><rect class="bv-suelo" width="300" height="220"/><path class="bv-parque" d="M172 134l74-8 6 58-74 8z"/><path class="bv-calles" d="${CALLES}"/>
      <path class="bv-trazo" pathLength="1" d="${TRAZO}"/><circle class="bv-bola" r="10"/></svg><div class="bv-bandera">${tw('1f6a9')}</div>`,
    captura: `<div class="bv-lugar"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="f" cx="60" cy="60" r="54"/><circle class="p" cx="60" cy="60" r="54" pathLength="1"/></svg>${tw('1f3db')}</div>
      <div class="bv-carta"><span>${tw('1f3db')}</span><b>Ayuntamiento</b><small>+200 pts</small></div>`,
    album: `<div class="bv-albumes"><div class="bv-tiras"><i style="--c:#b7791f">★</i><i style="--c:#1f5fbf"></i><i style="--c:#0f766e"></i><i style="--c:#7c3aed"></i><i style="--c:#be123c"></i></div>
      <div class="bv-hoja">${['1f3f0', '26ea', '', '1f3a8', '', '1f333', '', '2b50', '26f2', '', '1f5fc', ''].map((c, i) => `<i style="--n:${i}" class="${c ? 'lleno' : ''}">${c ? tw(c) : ''}</i>`).join('')}</div></div>`,
    gps: `<div class="bv-pin"><i></i><i></i>${tw('1f4cd')}</div>`,
  };
  const PASOS = [
    { arte: 'pinta', t: 'Pinta tu ciudad andando', p: 'Cada calle que recorres se llena con tu color. Pinta el 60 % de un barrio y será tuyo.' },
    { arte: 'captura', t: 'Captura lugares de verdad', p: 'Quédate 10 segundos junto a un monumento, una iglesia o un parque y ganarás su carta.' },
    { arte: 'album', t: 'Completa el álbum de tu ciudad', p: 'Cada ciudad tiene su álbum, con sus imprescindibles y sus barrios. ¿Hasta dónde llegarás?' },
    // (antes de que Android pida el permiso: qué se hace con tu ubicación, también con la app en segundo plano)
    { arte: 'gps', movil: true, t: 'Para pintar necesito saber por dónde vas', p: 'PintaMapa usa tu ubicación para pintar las calles y capturar lugares, también con la pantalla apagada o la app en segundo plano, pero solo mientras hay un paseo en marcha.',
      nota: 'Tu recorrido se guarda en tu móvil. Para el mapa y los lugares se piden los datos de tu zona a servicios externos (OpenStreetMap y Wikipedia).' },
  ];

  function abrir(fin) {
    if (document.getElementById('bv')) return;
    const pasos = PASOS.filter((p) => !p.movil || PM.isNative), ultimo = pasos.length - 1;
    const ov = document.createElement('div');
    ov.id = 'bv'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', PM.t('Bienvenida a PintaMapa'));
    ov.innerHTML = `<button class="bv-salta">Saltar</button>
      <div class="bv-pista">${pasos.map((p) => `<section class="bv-pag"><div class="bv-arte bv-${p.arte}">${ARTE[p.arte]}</div><h2>${p.t}</h2><p>${p.p}</p>${p.nota ? `<small>${p.nota}</small>` : ''}</section>`).join('')}</div>
      <div class="bv-pie"><div class="bv-puntos" aria-hidden="true">${pasos.map(() => '<i></i>').join('')}</div><button class="btn primary bv-sigue">Siguiente</button></div>`;
    document.body.appendChild(ov);
    const pista = ov.querySelector('.bv-pista'), pags = [...ov.querySelectorAll('.bv-pag')], puntos = [...ov.querySelectorAll('.bv-puntos i')];
    const salta = ov.querySelector('.bv-salta'), sigue = ov.querySelector('.bv-sigue');
    let i = -1;
    const marca = (n) => {
      if (n === i) return;
      i = n;
      pags.forEach((p, k) => p.classList.toggle('on', k === i));
      puntos.forEach((p, k) => p.classList.toggle('on', k === i));
      sigue.textContent = i < ultimo ? PM.t('Siguiente') : PM.t(PM.isNative ? 'Entendido, continuar' : '¡A pintar!');
      salta.style.visibility = i < ultimo ? '' : 'hidden';
    };
    const suave = !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    // (mientras va sola hacia la pantalla pedida, su posición a medio camino no cuenta: si no, «Siguiente» volvía a la anterior)
    let quieto = null, yendo = 0;
    const ir = (n) => { marca(n); yendo = Date.now() + 900; pista.scrollTo({ left: n * pista.clientWidth, behavior: suave ? 'smooth' : 'auto' }); };
    pista.addEventListener('scroll', () => {
      clearTimeout(quieto);
      quieto = setTimeout(() => { if (Date.now() >= yendo) marca(Math.round(pista.scrollLeft / Math.max(1, pista.clientWidth))); }, 90);
    }, { passive: true });
    sigue.addEventListener('click', () => { if (i < ultimo) ir(i + 1); else { ov.remove(); fin(); } });
    // (en el móvil, saltar lleva a la última pantalla: el aviso de la ubicación se ve siempre antes del permiso)
    salta.addEventListener('click', () => { if (pasos[ultimo].movil) ir(ultimo); else { ov.remove(); fin(); } });
    marca(0);
    sigue.focus();
  }

  // ---------------- El primer paseo: un aviso cada vez, hasta tu primera carta ----------------
  // ctx: { S, G, W, pos(), enPaseo(), marcar(id), irA(lugar), toast }. Paso guardado en la partida (S().guia): 1 aún sin salir, 2 paseando, 3 ya has pintado.
  function guia(ctx) {
    if (document.getElementById('guia')) return;
    const { S, G, W } = ctx;
    const el = document.createElement('div');
    el.id = 'guia';
    document.body.appendChild(el);
    let obj = null, html = '', vivo = true, reloj = null;
    function fin(aviso) {
      vivo = false; clearInterval(reloj); el.remove(); ctx.marcar(null);
      delete S().guia; PM.state.save();
      if (aviso) setTimeout(() => ctx.toast(aviso, 'gold', 7000), 400);
    }
    // el lugar sin conquistar más cercano (se mantiene mientras siga a tiro: no va cambiando según andas)
    function objetivo() {
      const p = ctx.pos(), hay = (lm) => lm && W.landmarks[lm.id] && !S().landmarks[lm.id];
      if (hay(obj) && PM.geo.dist(p, obj.pos) < 1500) return obj;
      let mejor = null, bd = 1000;
      for (const id in W.landmarks) {
        if (S().landmarks[id]) continue;
        const d = PM.geo.dist(p, W.landmarks[id].pos);
        if (d < bd) { bd = d; mejor = W.landmarks[id]; }
      }
      obj = mejor; ctx.marcar(obj ? obj.id : null);
      return obj;
    }
    function dibuja() {
      if (!vivo || document.hidden) return;
      if (S().guia < 2 && ctx.enPaseo()) { S().guia = 2; PM.state.save(); }
      const paso = S().guia, o = paso === 2 ? null : objetivo();
      const titulo = paso === 3 ? '¡Primera calle pintada!' : paso === 2 ? 'Ya estás pintando' : o ? 'Tu primer objetivo' : 'Tu primer paseo';
      const texto = paso === 3 ? (o ? 'Ahora ve hasta este lugar y quédate 10 segundos a su lado para ganar su carta.' : 'Busca un lugar en el mapa y quédate 10 segundos a su lado para ganar su carta.')
        : paso === 2 ? (PM.isNative ? 'Camina por una calle: se pinta sola con tu color. Puedes guardar el móvil en el bolsillo.' : 'Haz clic en el mapa para caminar hasta allí: la calle se pinta sola con tu color.')
          : 'Cuando estés en la calle, pulsa «Empezar a pintar». Hasta entonces no se pinta nada.';
      const nuevo = `<button class="x" aria-label="Cerrar">✕</button><b>${titulo}</b>${o ? `<button class="g-obj" translate="no"><span></span><small></small><em>›</em></button>` : ''}<p>${texto}</p>`;
      if (nuevo !== html) {
        html = nuevo; el.innerHTML = nuevo;
        el.querySelector('.x').addEventListener('click', () => fin());
        const b = el.querySelector('.g-obj');
        if (b) b.addEventListener('click', () => { if (obj) ctx.irA({ pos: obj.pos, name: obj.name }); });
      }
      const s = el.querySelector('.g-obj span');
      if (s && o) { s.textContent = `${o.emoji || '📍'} ${o.name}`; el.querySelector('.g-obj small').textContent = PM.fmtDist(Math.max(10, Math.round(PM.geo.dist(ctx.pos(), o.pos) / 10) * 10)); }
    }
    G.on((ev, d) => {
      if (!vivo) return;
      if (ev === 'painted' && S().guia < 3) { S().guia = 3; PM.state.save(); dibuja(); }
      if (ev === 'captured' && d.first) fin('🎉 ' + PM.t('¡Tu primera carta! La tienes en el Álbum, en la página de tu ciudad.'));
    });
    reloj = setInterval(dibuja, 2000);
    dibuja();
  }

  return { abrir, guia };
})();
