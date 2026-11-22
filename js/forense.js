// PintaMapa — revisión forense del paseo (al terminar, y una vez con el último paseo al abrir la app).
// Lo pidió el usuario (22-nov-2026, paseo de 3 h 51 min y 18 km): «un motor post paseo que revise todo el trazado a nivel forense,
// que pinte lo que falte y que resuelva el GPS». Aquel paseo perdió 1,4 km: 14 minutos sin satélites (posiciones de antena,
// de 200 a 758 m de error) y, al volver la señal, el hueco se dio por perdido.
//
// Durante el paseo la app decide sobre la marcha con lo que le llega. Al terminar se sabe TODO: el diario GPS nativo tiene cada
// posición que dio el móvil (también las que no llegaron a la app, congelada en el bolsillo, y las flojas), y las pausas están
// apuntadas. Aquí se rehace el recorrido con todo eso:
//   1. las posiciones precisas (≤ 35 m) del diario que no entraron en el recorrido, se meten en su sitio por la hora;
//   2. cada corte se mira de nuevo: pausa (no se toca), vehículo (no se toca), parado (nada que pintar) o andando sin señal
//      (lecturas flojas o ninguna, a paso de persona): se quita el corte y el repaso lo rellena por las calles (estimado);
//   3. el recorrido nuevo se repasa entero (repasoPendiente en main.js): se pinta lo que falte, con sus calles cargadas.
// Lógica pura (sin mapa ni pantalla): devuelve el recorrido nuevo y el informe. La usa main.js; las pruebas, en robustez.
(function () {
  const raiz = typeof window !== 'undefined' ? window : globalThis;
  const PM = raiz.PM = raiz.PM || {};

  // filas: las del diario (PM.filasDiarioGps: { t, la, lo, a, s }) · track: el del paseo ([lat, lon, segundos desde start, alt?] o
  // null de corte) · start: hora de inicio (ms) · pausas: [[desde, hasta]] (ms; las de paseos de antes no las traen)
  // dist(a, b): metros · maxSpeed: m/s (lo más rápido a pie, 20 km/h)
  function reconstruir({ filas, track, start, pausas, maxSpeed = 5.6, dist }) {
    const abs = (p) => start + p[2] * 1000;
    const orig = (track || []).filter(Boolean).map((p) => ({ p: [p[0], p[1]], t: abs(p), alt: p[3], de: 't' }));
    const fin = orig.length ? orig[orig.length - 1].t + 120000 : Infinity;
    const rows = (filas || []).filter((f) => f.t >= start && f.t <= fin && isFinite(f.la) && isFinite(f.lo)).sort((x, y) => x.t - y.t);
    const conPausas = Array.isArray(pausas);
    const P = (pausas || []).map(([a, b]) => [a, b || Infinity]);
    const pausado = (t0, t1) => P.some(([a, b]) => a < t1 && b > t0 && Math.min(t1, b) - Math.max(t0, a) >= 0.5 * (t1 - t0));

    // 1) posiciones precisas del diario en vehículo (más de 20 km/h, medido en ventanas de 10 s o más, o por su velocidad): fuera
    const buenas = rows.filter((f) => f.a <= 35), flojas = rows.filter((f) => f.a > 35 && f.a <= 800);
    const enCoche = new Set();
    for (let i = 0, j = 0; i < buenas.length; i++) {
      while (j < i && buenas[i].t - buenas[j + 1].t >= 10000) j++;
      const dt = (buenas[i].t - buenas[j].t) / 1000;
      if ((buenas[i].s != null && buenas[i].s > maxSpeed) || (dt >= 10 && dist([buenas[j].la, buenas[j].lo], [buenas[i].la, buenas[i].lo]) / dt > maxSpeed)) enCoche.add(buenas[i]);
    }
    // 2) recorrido + lo que faltaba del diario (si no hay un punto del recorrido a menos de 3 s), en orden de hora
    const ts = orig.map((q) => q.t);
    const cerca = (t) => { let lo = 0, hi = ts.length; while (lo < hi) { const m = (lo + hi) >> 1; if (ts[m] < t) lo = m + 1; else hi = m; } return (lo < ts.length && ts[lo] - t <= 3000) || (lo > 0 && t - ts[lo - 1] <= 3000); };
    let recuperadas = 0;
    const todos = orig.slice();
    for (const f of buenas) if (!enCoche.has(f) && !(conPausas && pausado(f.t, f.t + 1)) && !cerca(f.t)) { todos.push({ p: [f.la, f.lo], t: f.t, de: 'd' }); recuperadas++; }
    todos.sort((x, y) => x.t - y.t);
    // 2b) rebotes: una posición que se va lejos y vuelve en poco tiempo (las de antes y después, juntas): fuera, o se pintaría la
    // calle de al lado (los del recorrido ya los quitaba el paseo; estos son sobre todo del diario)
    let rebotes = 0;
    for (let i = 1; i < todos.length - 1; i++) {
      const a = todos[i - 1], m = todos[i], b = todos[i + 1];
      if (b.t - a.t > 60000) continue;
      const am = dist(a.p, m.p), mb = dist(m.p, b.p), ab = dist(a.p, b.p);
      if (am > 40 && mb > 40 && ab < 0.5 * Math.min(am, mb)) { todos.splice(i, 1); i--; rebotes++; }
    }

    // 3) cada paso entre dos posiciones seguidas: ¿se sigue, o es un corte de verdad?
    const informe = { recuperadas, rebotes, huecos: [], pausas: 0, vehiculo: 0, parado: 0, sinDatos: 0, metros: 0 };
    const out = [], minDe = (t) => Math.round((t - start) / 60000);
    let ult = null;   // (el último punto guardado: de 8 en 8 m, como al andar; los del recorrido, siempre)
    const largo = (tr) => { let m = 0, a = null; for (const q of tr) { if (!q) { a = null; continue; } if (a) { const d = dist(a, q); if (d < 3000) m += d; } a = q; } return m; };
    const punto = (q) => { const x = [+q.p[0].toFixed(6), +q.p[1].toFixed(6), Math.round((q.t - start) / 1000)]; if (q.alt != null) x.push(q.alt); return x; };
    for (let i = 0; i < todos.length; i++) {
      const b = todos[i], a = todos[i - 1];
      if (a) {
        const d = dist(a.p, b.p), dt = (b.t - a.t) / 1000;
        let corte = false;
        if (conPausas && dt > 30 && pausado(a.t, b.t)) { corte = true; informe.pausas++; }
        else if ((dt >= 10 || d > 60) && dt > 0 && d / dt > maxSpeed) { corte = true; informe.vehiculo++; }
        else if ((dt > 60 && d > 40) || dt > 300) {
          // hueco: ¿hubo lecturas del GPS entre medias? (flojas: el GPS seguía, sin satélites; ninguna: apagado o sin datos)
          const entre = flojas.filter((f) => f.t > a.t && f.t < b.t);
          // (parado: nada que pintar; si fue un rato largo —una pausa de un paseo de antes, un bar—, el recorrido queda cortado)
          // (cada hueco lleva sus dos extremos, sus horas y las lecturas flojas de entre medias: con ellas main.js elige el camino
          // por las calles que mejor encaja —rutaDeHueco—)
          const h = (tipo) => ({ desde: minDe(a.t), hasta: minDe(b.t), m: Math.round(d), tipo, a: a.p, b: b.p, ta: a.t, tb: b.t, guias: entre.map((f) => [f.la, f.lo, Math.round(f.a), f.t]) });
          if (d < 100) { informe.parado++; if (dt > 300) corte = true; }
          else if (entre.length) informe.huecos.push(h('sin satélites'));
          else if (conPausas) informe.huecos.push(h('sin datos'));
          // (un paseo de antes no tiene sus pausas apuntadas: un hueco sin ninguna lectura puede ser una pausa, y en pausa no se
          // pinta nada. Se deja como estaba)
          else { corte = true; informe.sinDatos++; }
        }
        if (corte && out.length && out[out.length - 1] !== null) { out.push(null); ult = null; }
      }
      if (b.de === 't' || !ult || dist(ult.p, b.p) >= 8 || i === todos.length - 1) { out.push(punto(b)); ult = b; }
    }
    if (out.length && out[out.length - 1] === null) out.pop();
    informe.metros = Math.max(0, Math.round(largo(out) - largo(track || [])));
    return { track: out, informe };
  }

  PM.forense = { reconstruir };
  if (typeof module !== 'undefined') module.exports = PM.forense;
})();
