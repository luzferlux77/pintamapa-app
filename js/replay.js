// PintaMapa — detalle de un paseo (al estilo de las apps de deporte):
//   · estadísticas completas: distancia, tiempo en movimiento, ritmo, parciales por km, velocidad máx., altitud, desnivel…
//   · gráficas de perfil de altitud y de ritmo
//   · vídeo del recorrido (animación que se graba en un vídeo vertical para compartir)
//   · exportar el recorrido: GPX, TCX, KML, KMZ, GeoJSON y CSV (para Strava, Garmin, Google Earth…)
//   PM.replay.open(walk, { geo, color, player })
//   walk = { id, start, elapsed, st:{walked,painted,pts,...}, track:[[lat,lon,seg?,alt?] | null, ...] }
//   (los puntos nuevos guardan [lat, lon, segundos desde el inicio, altitud]; los antiguos solo [lat, lon])
PM.replay = (function () {
  const W = 720, H = 1280, FPS = 30, DRAW_S = 12, HOLD_S = 2.5;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtKm = (m) => (m >= 1000 ? (m / 1000).toFixed(2).replace('.', ',') + ' km' : Math.round(m) + ' m');
  const fmtT = (s) => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m}:${String(x).padStart(2, '0')}`; };
  const fmtPace = (secPerKm) => !isFinite(secPerKm) || secPerKm <= 0 ? '—' : `${Math.floor(secPerKm / 60)}:${String(Math.round(secPerKm % 60)).padStart(2, '0')} /km`;
  const dist = (a, b) => { const dy = (b[0] - a[0]) * 110540, dx = (b[1] - a[1]) * 111320 * Math.cos(a[0] * Math.PI / 180); return Math.hypot(dx, dy); };

  function segsOf(track) {
    const segs = []; let cur = [];
    (track || []).forEach((p) => { if (!p) { if (cur.length > 1) segs.push(cur); cur = []; } else cur.push(p); });
    if (cur.length > 1) segs.push(cur);
    return segs;
  }

  // ---------------- Recorrido por las calles ----------------
  // Los paseos antiguos guardaban solo los extremos de cada hueco del GPS (móvil en el bolsillo) y salían diagonales.
  // Se reconstruye el camino por TUS calles pintadas (por donde de verdad pasaste): ruta más corta entre los dos puntos.
  function streetGraph(geo) {
    const nodes = new Map(), grid = new Map();
    const node = (q) => {
      const k = (+q[0]).toFixed(5) + ',' + (+q[1]).toFixed(5);
      let n = nodes.get(k);
      if (!n) {
        n = { p: [+q[0], +q[1]], e: [] }; nodes.set(k, n);
        const g = Math.floor(q[0] / 0.001) + ':' + Math.floor(q[1] / 0.001);
        (grid.get(g) || grid.set(g, []).get(g)).push(n);
      }
      return n;
    };
    for (const line of Object.values(geo || {})) for (let i = 0; i < line.length - 1; i++) {
      const a = node(line[i]), b = node(line[i + 1]);
      if (a === b) continue;
      const l = dist(a.p, b.p); a.e.push([b, l]); b.e.push([a, l]);
    }
    const near = (q, max) => {
      let best = null, bd = max; const gi = Math.floor(q[0] / 0.001), gj = Math.floor(q[1] / 0.001);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const n of grid.get((gi + di) + ':' + (gj + dj)) || []) { const d = dist(q, n.p); if (d < bd) { bd = d; best = n; } }
      return best;
    };
    return { size: nodes.size, near };
  }
  function graphRoute(G, a, b, maxLen) {
    const s = G.near(a, 45), t = G.near(b, 45);
    if (!s || !t || s === t) return null;
    const dd = new Map([[s, 0]]), prev = new Map(), done = new Set(), heap = [[0, s]];
    let it = 0;
    while (heap.length && it++ < 40000) {
      let m = 0; for (let i = 1; i < heap.length; i++) if (heap[i][0] < heap[m][0]) m = i;
      const [d, n] = heap.splice(m, 1)[0];
      if (done.has(n)) continue; done.add(n);
      if (n === t) break;
      if (d > maxLen) return null;
      for (const [to, l] of n.e) { const nd = d + l; if (nd < (dd.has(to) ? dd.get(to) : Infinity)) { dd.set(to, nd); prev.set(to, n); heap.push([nd, to]); } }
    }
    if (!done.has(t)) return null;
    const path = [t.p]; for (let n = t; prev.has(n); n = prev.get(n)) path.push(prev.get(n).p);
    return path.reverse();
  }
  function snapTrack(track, geo) {
    if (!geo || !track || track.length < 2) return track;
    const G = streetGraph(geo);
    if (!G.size) return track;
    const out = [];
    for (let i = 0; i < track.length; i++) {
      const a = track[i - 1], b = track[i];
      if (a && b) {
        const d = dist(a, b);
        if (d > 30 && d < 3000) {
          const path = graphRoute(G, a, b, Math.max(d * 2.5, d + 300));
          if (path) {
            let tot = 0; for (let k = 1; k < path.length; k++) tot += dist(path[k - 1], path[k]);
            let acc = dist(a, path[0]);
            tot += acc + dist(path[path.length - 1], b);
            for (let k = 0; k < path.length; k++) {
              if (k) acc += dist(path[k - 1], path[k]);
              const f = tot ? acc / tot : 0, q = [path[k][0], path[k][1]];
              if (a[2] != null && b[2] != null) q[2] = a[2] + (b[2] - a[2]) * f;
              if (a[3] != null && b[3] != null) q[3] = a[3] + (b[3] - a[3]) * f;
              out.push(q);
            }
          }
        }
      }
      out.push(b);
    }
    return out;
  }

  // ---------------- Estadísticas ----------------
  // puntos con distancia acumulada (d), tiempo (t, s) y altitud (e)
  function points(walk) {
    const segs = segsOf(walk.track);
    const out = []; let acc = 0;
    segs.forEach((sg, si) => sg.forEach((p, i) => { if (i) acc += dist(sg[i - 1], p); out.push({ lat: p[0], lon: p[1], d: acc, t: p[2], e: p[3], cut: i === 0 && si > 0 }); }));
    const total = acc, dur = (walk.elapsed || 0) / 1000;
    const timed = out.filter((q) => q.t != null).length > out.length * 0.8;
    // paseos antiguos sin hora por punto: se reparte el tiempo según la distancia
    out.forEach((q) => { if (!timed || q.t == null) q.t = total ? dur * q.d / total : 0; });
    return { pts: out, total, timed };
  }
  // altitud del terreno (Open-Meteo, gratis y sin clave) cuando el GPS no la dio
  async function elevations(pts) {
    if (pts.filter((q) => q.e != null).length > pts.length * 0.8) return true;
    const step = Math.max(1, Math.ceil(pts.length / 300)), idx = [];
    for (let i = 0; i < pts.length; i += step) idx.push(i);
    if (idx[idx.length - 1] !== pts.length - 1) idx.push(pts.length - 1);
    try {
      for (let k = 0; k < idx.length; k += 100) {
        const part = idx.slice(k, k + 100);
        const url = 'https://api.open-meteo.com/v1/elevation?latitude=' + part.map((i) => pts[i].lat.toFixed(5)).join(',') + '&longitude=' + part.map((i) => pts[i].lon.toFixed(5)).join(',');
        const j = await (await fetch(url)).json();
        (j.elevation || []).forEach((e, n) => { pts[part[n]].e = e; });
      }
      // los puntos intermedios: interpolados
      for (let n = 0; n < idx.length - 1; n++) {
        const a = idx[n], b = idx[n + 1];
        for (let i = a + 1; i < b; i++) pts[i].e = pts[a].e + (pts[b].e - pts[a].e) * (i - a) / (b - a);
      }
      return true;
    } catch (e) { return false; }
  }
  function analyze(walk, P) {
    const { pts, total } = P, st = walk.st || {};
    const elapsed = (walk.elapsed || 0) / 1000;
    const dTot = Math.max(total, st.walked || 0);
    // tiempo en movimiento: tramos a más de 0,5 m/s (los ratos parado no cuentan)
    let moving = 0, maxV = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], dt = b.t - a.t, dd = b.d - a.d;
      if (b.cut || dt <= 0) continue;
      if (dd / dt > 0.5 && dt < 120) moving += dt;
    }
    if (!moving) moving = elapsed;
    // velocidad máxima: en ventanas de >= 100 m (sin picos del GPS)
    for (let i = 0, j = 0; i < pts.length; i++) {
      while (j < pts.length - 1 && pts[j].d - pts[i].d < 100) j++;
      const dd = pts[j].d - pts[i].d, dt = pts[j].t - pts[i].t;
      if (dd >= 100 && dt > 0) maxV = Math.max(maxV, Math.min(dd / dt, 12));
    }
    // parciales por km
    const splits = []; let lastT = 0, lastE = pts[0] && pts[0].e, km = 1;
    for (let i = 1; i < pts.length; i++) {
      while (pts[i].d >= km * 1000) {
        const a = pts[i - 1], b = pts[i], f = (km * 1000 - a.d) / Math.max(1e-6, b.d - a.d);
        const t = a.t + (b.t - a.t) * f, e = a.e != null && b.e != null ? a.e + (b.e - a.e) * f : null;
        splits.push({ km, sec: t - lastT, de: e != null && lastE != null ? e - lastE : null });
        lastT = t; lastE = e; km++;
      }
    }
    const rest = total - (km - 1) * 1000;
    if (rest > 50 && pts.length) { const b = pts[pts.length - 1]; splits.push({ km: km - 1 + rest / 1000, sec: b.t - lastT, de: b.e != null && lastE != null ? b.e - lastE : null, partial: true }); }
    // altitud: suavizada y con umbral (el desnivel no se infla con el ruido)
    const el = pts.map((q) => q.e).filter((e) => e != null);
    let up = 0, down = 0, minE = null, maxE = null;
    if (el.length > 1) {
      const sm = el.map((_, i) => { const a = Math.max(0, i - 3), b = Math.min(el.length, i + 4); let s = 0; for (let k = a; k < b; k++) s += el[k]; return s / (b - a); });
      let ref = sm[0];
      sm.forEach((e) => { if (e - ref >= 2) { up += e - ref; ref = e; } else if (ref - e >= 2) { down += ref - e; ref = e; } });
      minE = Math.min(...sm); maxE = Math.max(...sm);
    }
    const kmTot = dTot / 1000;
    return {
      dTot, elapsed, moving, avgPace: kmTot > 0.05 ? moving / kmTot : null, avgV: moving ? dTot / moving : 0, maxV, splits,
      up, down, minE, maxE, hasEle: el.length > 1,
      steps: Math.round(dTot / 0.72), kcal: Math.round(kmTot * 55),   // estimaciones (persona de ~70 kg, paso de ~72 cm)
      startT: walk.start, endT: walk.start + (walk.elapsed || 0),
    };
  }

  // ---------------- Gráficas (SVG) ----------------
  function chart(pts, val, { color, unit, fmt, invert }) {
    const data = pts.map((q) => [q.d, val(q)]).filter((x) => x[1] != null && isFinite(x[1]));
    if (data.length < 2) return '<div class="rp-empty">Sin datos</div>';
    const w = 640, h = 150, pad = 26;
    const x0 = data[0][0], x1 = data[data.length - 1][0] || 1;
    let y0 = Math.min(...data.map((x) => x[1])), y1 = Math.max(...data.map((x) => x[1]));
    if (y1 - y0 < 1) { y0 -= 1; y1 += 1; }
    const X = (d) => pad + (d - x0) / Math.max(1, x1 - x0) * (w - pad * 2), Y = (v) => { const f = (v - y0) / (y1 - y0); return 10 + (invert ? f : 1 - f) * (h - 30); };
    const line = data.map((x, i) => (i ? 'L' : 'M') + X(x[0]).toFixed(1) + ',' + Y(x[1]).toFixed(1)).join('');
    const area = line + `L${X(data[data.length - 1][0]).toFixed(1)},${h - 20}L${X(data[0][0]).toFixed(1)},${h - 20}Z`;
    const ticks = []; const stepKm = x1 > 8000 ? 2000 : x1 > 3000 ? 1000 : 500;
    for (let d = stepKm; d < x1; d += stepKm) ticks.push(`<text x="${X(d)}" y="${h - 5}" text-anchor="middle">${(d / 1000).toString().replace('.', ',')} km</text><line x1="${X(d)}" x2="${X(d)}" y1="10" y2="${h - 20}"/>`);
    return `<svg viewBox="0 0 ${w} ${h}" class="rp-chart"><g class="ax">${ticks.join('')}</g>
      <path d="${area}" fill="${color}" fill-opacity=".18"/><path d="${line}" fill="none" stroke="${color}" stroke-width="2.2"/>
      <text x="${pad}" y="14" class="lab">${fmt(invert ? y0 : y1)} ${unit}</text><text x="${pad}" y="${h - 24}" class="lab">${fmt(invert ? y1 : y0)} ${unit}</text></svg>`;
  }
  function paceSeries(pts) {
    // ritmo suavizado en ventanas de ~150 m
    return pts.map((q, i) => {
      let j = i; while (j > 0 && q.d - pts[j].d < 150) j--;
      const dd = q.d - pts[j].d, dt = q.t - pts[j].t;
      return dd > 60 && dt > 0 ? Math.min(1200, dt / (dd / 1000)) / 60 : null;   // min/km
    });
  }

  // ---------------- Exportar ----------------
  const iso = (walk, q) => new Date(walk.start + (q.t || 0) * 1000).toISOString();
  function gpx(walk, P) {
    const segs = [[]]; P.pts.forEach((q) => { if (q.cut) segs.push([]); segs[segs.length - 1].push(q); });
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="PintaMapa" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>Paseo PintaMapa ${new Date(walk.start).toLocaleDateString('es-ES')}</name><time>${new Date(walk.start).toISOString()}</time></metadata>
<trk><name>Paseo ${new Date(walk.start).toLocaleString('es-ES')}</name><type>walking</type>
${segs.map((s) => `<trkseg>\n${s.map((q) => `<trkpt lat="${q.lat.toFixed(6)}" lon="${q.lon.toFixed(6)}">${q.e != null ? `<ele>${q.e.toFixed(1)}</ele>` : ''}<time>${iso(walk, q)}</time></trkpt>`).join('\n')}\n</trkseg>`).join('\n')}
</trk></gpx>`;
  }
  function tcx(walk, P, A) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
<Activities><Activity Sport="Other"><Id>${new Date(walk.start).toISOString()}</Id>
<Lap StartTime="${new Date(walk.start).toISOString()}"><TotalTimeSeconds>${A.elapsed.toFixed(0)}</TotalTimeSeconds><DistanceMeters>${A.dTot.toFixed(1)}</DistanceMeters><Calories>${A.kcal}</Calories><Intensity>Active</Intensity><TriggerMethod>Manual</TriggerMethod>
<Track>
${P.pts.map((q) => `<Trackpoint><Time>${iso(walk, q)}</Time><Position><LatitudeDegrees>${q.lat.toFixed(6)}</LatitudeDegrees><LongitudeDegrees>${q.lon.toFixed(6)}</LongitudeDegrees></Position>${q.e != null ? `<AltitudeMeters>${q.e.toFixed(1)}</AltitudeMeters>` : ''}<DistanceMeters>${q.d.toFixed(1)}</DistanceMeters></Trackpoint>`).join('\n')}
</Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
  }
  function kml(walk, P, A) {
    const segs = [[]]; P.pts.forEach((q) => { if (q.cut) segs.push([]); segs[segs.length - 1].push(q); });
    const c = (q) => `${q.lon.toFixed(6)},${q.lat.toFixed(6)},${(q.e || 0).toFixed(1)}`;
    const a = P.pts[0], b = P.pts[P.pts.length - 1];
    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Paseo PintaMapa ${new Date(walk.start).toLocaleDateString('es-ES')}</name>
<description>${esc(fmtKm(A.dTot))} · ${esc(fmtT(A.moving))} en movimiento · desnivel +${Math.round(A.up)} m</description>
<Style id="ruta"><LineStyle><color>ff2e57e4</color><width>5</width></LineStyle></Style>
<Placemark><name>Salida</name><Point><coordinates>${c(a)}</coordinates></Point></Placemark>
<Placemark><name>Llegada</name><Point><coordinates>${c(b)}</coordinates></Point></Placemark>
<Placemark><name>Recorrido</name><styleUrl>#ruta</styleUrl><MultiGeometry>
${segs.map((s) => `<LineString><tessellate>1</tessellate><altitudeMode>clampToGround</altitudeMode><coordinates>${s.map(c).join(' ')}</coordinates></LineString>`).join('\n')}
</MultiGeometry></Placemark></Document></kml>`;
  }
  function geojson(walk, P, A) {
    const segs = [[]]; P.pts.forEach((q) => { if (q.cut) segs.push([]); segs[segs.length - 1].push(q); });
    return JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature',
      properties: { name: 'Paseo PintaMapa', start: new Date(walk.start).toISOString(), distance_m: Math.round(A.dTot), moving_s: Math.round(A.moving), elapsed_s: Math.round(A.elapsed), elevation_gain_m: Math.round(A.up),
        times: P.pts.map((q) => iso(walk, q)) },
      geometry: { type: 'MultiLineString', coordinates: segs.map((s) => s.map((q) => q.e != null ? [+q.lon.toFixed(6), +q.lat.toFixed(6), +q.e.toFixed(1)] : [+q.lon.toFixed(6), +q.lat.toFixed(6)])) } }] });
  }
  function csv(walk, P) {
    return 'tiempo,latitud,longitud,altitud_m,distancia_m\n' + P.pts.map((q) => `${iso(walk, q)},${q.lat.toFixed(6)},${q.lon.toFixed(6)},${q.e != null ? q.e.toFixed(1) : ''},${q.d.toFixed(1)}`).join('\n');
  }
  // KMZ = ZIP con doc.kml dentro (ZIP sin comprimir: válido y sin librerías)
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function zip(name, text) {
    const data = new TextEncoder().encode(text), fn = new TextEncoder().encode(name), crc = crc32(data);
    const loc = new DataView(new ArrayBuffer(30)), cen = new DataView(new ArrayBuffer(46)), end = new DataView(new ArrayBuffer(22));
    loc.setUint32(0, 0x04034b50, true); loc.setUint16(4, 20, true); loc.setUint32(14, crc, true); loc.setUint32(18, data.length, true); loc.setUint32(22, data.length, true); loc.setUint16(26, fn.length, true);
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true); cen.setUint16(28, fn.length, true);
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, 1, true); end.setUint16(10, 1, true); end.setUint32(12, 46 + fn.length, true); end.setUint32(16, 30 + fn.length + data.length, true);
    return new Blob([loc, fn, data, cen, fn, end], { type: 'application/vnd.google-earth.kmz' });
  }

  // ---------------- Vídeo ----------------
  // proyección Mercator (la de los mapas web) para que el recorrido case con las calles del mapa de fondo
  const mx = (lon, z) => (lon + 180) / 360 * 256 * 2 ** z;
  const my = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 256 * 2 ** z; };
  function scene(walk, opts) {
    const segs = segsOf(walk.track);
    const pts = segs.flat();
    if (pts.length < 2) return null;
    let s = 90, n = -90, w = 180, e = -180;
    pts.forEach((p) => { s = Math.min(s, p[0]); n = Math.max(n, p[0]); w = Math.min(w, p[1]); e = Math.max(e, p[1]); });
    const box = { x: 60, y: 290, w: W - 120, h: H - 720 };
    // zoom de mapa en el que cabe el recorrido (máx. 18) y escala fina para encajarlo
    let z = 18;
    while (z > 3 && (mx(e, z) - mx(w, z) > box.w || my(s, z) - my(n, z) > box.h)) z--;
    const sc = Math.min(2, box.w / Math.max(1, mx(e, z) - mx(w, z)), box.h / Math.max(1, my(s, z) - my(n, z)));
    const cx = (mx(w, z) + mx(e, z)) / 2, cy = (my(n, z) + my(s, z)) / 2;
    const P = (p) => [W / 2 + (mx(p[1], z) - cx) * sc, box.y + box.h / 2 + (my(p[0], z) - cy) * sc];
    // teselas que cubren todo el vídeo
    const x0 = cx - (W / 2) / sc, x1 = cx + (W / 2) / sc, y0 = cy - (box.y + box.h / 2) / sc, y1 = cy + (H - box.y - box.h / 2) / sc;
    const tiles = [];
    for (let tx = Math.floor(x0 / 256); tx <= Math.floor(x1 / 256); tx++) for (let ty = Math.floor(y0 / 256); ty <= Math.floor(y1 / 256); ty++) {
      if (ty < 0 || ty >= 2 ** z) continue;
      tiles.push({ url: `https://tile.openstreetmap.org/${z}/${((tx % 2 ** z) + 2 ** z) % 2 ** z}/${ty}.png`, x: W / 2 + (tx * 256 - cx) * sc, y: box.y + box.h / 2 + (ty * 256 - cy) * sc, s: 256 * sc });
    }
    const path = []; let acc = 0;
    segs.forEach((sg, si) => sg.forEach((p, i) => { if (i) acc += dist(sg[i - 1], p); path.push({ p: P(p), d: acc, start: i === 0 && si > 0 }); }));
    const bg = [];
    const spanY = n - s, spanX = e - w;
    const mS = s - spanY * 0.8 - 0.002, mN = n + spanY * 0.8 + 0.002, mW = w - spanX * 0.8 - 0.002, mE = e + spanX * 0.8 + 0.002;
    for (const line of Object.values(opts.geo || {})) {
      const a = line[0];
      if (a && a[0] > mS && a[0] < mN && a[1] > mW && a[1] < mE) bg.push(line.map(P));
      if (bg.length > 6000) break;
    }
    return { path, total: acc, bg, tiles };
  }
  // descarga las teselas del mapa (si no hay conexión, el vídeo sale igual con tus calles pintadas de fondo)
  function loadTiles(sc) {
    return Promise.all(sc.tiles.map((t) => new Promise((res) => {
      const im = new Image(); im.crossOrigin = 'anonymous';
      const to = setTimeout(() => res(), 8000);
      im.onload = () => { clearTimeout(to); t.img = im; res(); };
      im.onerror = () => { clearTimeout(to); res(); };
      im.src = t.url;
    })));
  }
  function draw(ctx, sc, t, walk, opts, A) {
    const color = opts.color || '#e4572e';
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#111827'); g.addColorStop(1, '#0b1220');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // mapa de calles de fondo, en tono oscuro
    if (sc.tiles.some((t) => t.img)) {
      ctx.save(); ctx.filter = 'invert(1) hue-rotate(180deg) brightness(.85) contrast(1.05) saturate(.35)';
      for (const t of sc.tiles) if (t.img) ctx.drawImage(t.img, t.x, t.y, t.s + 0.5, t.s + 0.5);
      ctx.restore();
      // velo arriba y abajo para que se lean los textos
      const vt = ctx.createLinearGradient(0, 0, 0, 330); vt.addColorStop(0, 'rgba(11,18,32,.95)'); vt.addColorStop(1, 'rgba(11,18,32,0)');
      ctx.fillStyle = vt; ctx.fillRect(0, 0, W, 330);
      const vb = ctx.createLinearGradient(0, H - 420, 0, H); vb.addColorStop(0, 'rgba(11,18,32,0)'); vb.addColorStop(.35, 'rgba(11,18,32,.9)'); vb.addColorStop(1, 'rgba(11,18,32,.97)');
      ctx.fillStyle = vb; ctx.fillRect(0, H - 420, W, 420);
      ctx.fillStyle = 'rgba(160,170,190,.6)'; ctx.font = '500 16px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillText('© OpenStreetMap', 60, H - 40);
    }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = (opts.color || '#e4572e') + '55'; ctx.lineWidth = 4;
    for (const l of sc.bg) { ctx.beginPath(); l.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]))); ctx.stroke(); }
    const upto = sc.total * Math.min(1, t);
    let head = sc.path[0].p;
    const stroke = (w, col, blur) => {
      ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.shadowColor = color; ctx.shadowBlur = blur;
      ctx.beginPath();
      for (let i = 0; i < sc.path.length; i++) {
        const a = sc.path[i];
        if (a.d > upto) {
          const b = sc.path[i - 1];
          if (b && !a.start) { const f = (upto - b.d) / Math.max(1e-6, a.d - b.d); head = [b.p[0] + (a.p[0] - b.p[0]) * f, b.p[1] + (a.p[1] - b.p[1]) * f]; ctx.lineTo(head[0], head[1]); }
          break;
        }
        if (i === 0 || a.start) ctx.moveTo(a.p[0], a.p[1]); else ctx.lineTo(a.p[0], a.p[1]);
        head = a.p;
      }
      ctx.stroke(); ctx.restore();
    };
    stroke(14, color + '55', 0);
    stroke(7, color, 14);
    ctx.save(); ctx.fillStyle = '#fff'; ctx.shadowColor = color; ctx.shadowBlur = 20;
    ctx.beginPath(); ctx.arc(head[0], head[1], 11, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(head[0], head[1], 6, 0, Math.PI * 2); ctx.fill();
    const f = Math.min(1, t);
    ctx.textAlign = 'left';
    ctx.font = '600 30px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.fillText(new Date(walk.start).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), 60, 110);
    ctx.fillStyle = '#fff'; ctx.font = '800 54px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText(opts.title || 'Mi paseo', 60, 175);
    const st = walk.st || {};
    const stats = [['Distancia', fmtKm(A.dTot * f)], ['Tiempo', fmtT(A.moving * f)], ['Ritmo medio', fmtPace(A.avgPace)], ['Desnivel', A.hasEle ? '+' + Math.round(A.up * f) + ' m' : '—'],
      ['Calles nuevas', fmtKm((st.painted || 0) * f)], ['Puntos', '+' + Math.round((st.pts || 0) * f).toLocaleString('es-ES')]];
    stats.forEach(([k, v], i) => {
      const x = 60 + (i % 2) * 310, y = H - 330 + Math.floor(i / 2) * 100;
      ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = '500 25px system-ui, sans-serif'; ctx.fillText(k, x, y);
      ctx.fillStyle = '#fff'; ctx.font = '800 42px system-ui, sans-serif'; ctx.fillText(v, x, y + 46);
    });
    ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.font = '600 24px system-ui, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText('PintaMapa' + (opts.player ? ' · ' + opts.player : ''), W - 60, H - 40);
  }

  // ---------------- Ventana de detalle ----------------
  async function open(walk, opts = {}) {
    walk = Object.assign({}, walk, { track: snapTrack(walk.track, opts.geo) });
    const P = points(walk);
    if (P.pts.length < 2) { alert('Este paseo no tiene recorrido guardado.'); return; }
    close();
    const ov = document.createElement('div');
    ov.id = 'replay-view';
    ov.innerHTML = `<div class="rp-box"><div class="rp-head"><div><small>${esc(new Date(walk.start).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</small>
      <h2>${esc(opts.title || 'Paseo')} · ${new Date(walk.start).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</h2></div><button class="rp-x" data-a="close">✕</button></div>
      <div class="rp-body"><p class="rp-loading">Calculando estadísticas y altitud…</p></div></div>`;
    document.body.appendChild(ov);
    ov.querySelector('[data-a=close]').onclick = close;
    ov.onclick = (e) => { if (e.target === ov) close(); };
    await elevations(P.pts);
    const A = analyze(walk, P), st = walk.st || {};
    const body = ov.querySelector('.rp-body');
    const tile = (k, v, s) => `<div class="rp-k"><small>${k}</small><b>${v}</b>${s ? `<em>${s}</em>` : ''}</div>`;
    const best = A.splits.filter((x) => !x.partial).reduce((m, x) => (!m || x.sec < m.sec ? x : m), null);
    body.innerHTML = `
      <div class="rp-grid">
        ${tile('Distancia', fmtKm(A.dTot))}
        ${tile('Tiempo en movimiento', fmtT(A.moving), 'total ' + fmtT(A.elapsed))}
        ${tile('Ritmo medio', fmtPace(A.avgPace))}
        ${tile('Velocidad media', (A.avgV * 3.6).toFixed(1).replace('.', ',') + ' km/h', 'máx. ' + (A.maxV * 3.6).toFixed(1).replace('.', ',') + ' km/h')}
        ${tile('Desnivel positivo', A.hasEle ? '+' + Math.round(A.up) + ' m' : '—', A.hasEle ? '−' + Math.round(A.down) + ' m negativo' : '')}
        ${tile('Altitud', A.hasEle ? Math.round(A.minE) + '–' + Math.round(A.maxE) + ' m' : '—', A.hasEle ? 'mín. – máx.' : '')}
        ${tile('Pasos', '≈ ' + A.steps.toLocaleString('es-ES'), 'estimados')}
        ${tile('Calorías', '≈ ' + A.kcal + ' kcal', 'estimadas (70 kg)')}
        ${tile('Calles nuevas', fmtKm(st.painted || 0), st.repassed ? fmtKm(st.repassed) + ' repasadas' : '')}
        ${tile('Puntos', '+' + Math.round(st.pts || 0).toLocaleString('es-ES'), (st.captures || 0) + ' lugares capturados')}
        ${tile('Inicio', new Date(A.startT).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }), 'fin ' + new Date(A.endT).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }))}
        ${tile('Mejor combo', 'x' + (st.bestCombo || 0), st.conquests ? st.conquests + ' barrio(s) conquistado(s)' : '')}
      </div>
      <h3>Perfil de altitud</h3>${A.hasEle ? chart(P.pts, (q) => q.e, { color: '#16a34a', unit: 'm', fmt: (v) => Math.round(v) }) : '<div class="rp-empty">Sin datos de altitud (sin conexión)</div>'}
      <h3>Ritmo</h3>${P.timed ? chart(P.pts, ((s) => (q) => s[P.pts.indexOf(q)])(paceSeries(P.pts)), { color: '#2563eb', unit: 'min/km', fmt: (v) => v.toFixed(1).replace('.', ','), invert: true })
        : '<div class="rp-empty">Este paseo es anterior a la versión que guarda la hora de cada punto: aquí verás el ritmo de tus próximos paseos.</div>'}
      <h3>Parciales por kilómetro</h3>
      ${A.splits.length ? `<table class="rp-splits"><tr><th>Km</th><th>Ritmo</th><th>Desnivel</th><th></th></tr>${A.splits.map((x) => {
        const pace = x.sec / (x.partial ? (x.km % 1 || 1) : 1);
        const w = best ? Math.max(8, Math.min(100, best.sec / pace * 100)) : 50;
        return `<tr class="${best && x === best ? 'best' : ''}"><td>${x.partial ? x.km.toFixed(2).replace('.', ',') : x.km}</td><td>${fmtPace(pace)}</td><td>${x.de != null ? (x.de >= 0 ? '+' : '') + Math.round(x.de) + ' m' : '—'}</td><td><i style="width:${w}%"></i></td></tr>`;
      }).join('')}</table>` : '<div class="rp-empty">Menos de 1 km.</div>'}
      <h3>Vídeo del recorrido</h3>
      <div class="rp-video"><canvas width="${W}" height="${H}"></canvas>
        <div class="rp-actions"><button data-a="play">↻ Repetir</button><button data-a="rec" class="pri">🎬 Crear vídeo</button></div><p class="rp-msg"></p></div>
      <h3>Exportar recorrido</h3>
      <div class="rp-actions rp-exp">
        <button data-x="gpx">GPX</button><button data-x="tcx">TCX</button><button data-x="kml">KML</button><button data-x="kmz">KMZ</button><button data-x="geojson">GeoJSON</button><button data-x="csv">CSV</button>
      </div>
      <p class="rp-note">GPX y TCX sirven para Strava, Garmin Connect, Komoot o Wikiloc; KML y KMZ para Google Earth y Google Maps.</p>`;
    // vídeo
    const sc = scene(walk, opts);
    const cv = body.querySelector('canvas'), ctx = cv.getContext('2d'), msg = body.querySelector('.rp-msg');
    msg.textContent = 'Cargando el mapa…';
    await loadTiles(sc);
    msg.textContent = '';
    let t0 = performance.now(), raf = null, recording = false;
    const loop = (now) => {
      if (!document.body.contains(cv)) return;
      const t = (now - t0) / 1000 / DRAW_S;
      draw(ctx, sc, t, walk, opts, A);
      if (t < 1 + HOLD_S / DRAW_S || recording) raf = requestAnimationFrame(loop); else raf = null;
    };
    const play = () => { t0 = performance.now(); if (!raf) raf = requestAnimationFrame(loop); };
    play();
    body.querySelector('[data-a=play]').onclick = play;
    body.querySelector('[data-a=rec]').onclick = async () => {
      if (recording) return;
      if (!cv.captureStream || !window.MediaRecorder) { msg.textContent = 'Este navegador no puede grabar vídeo.'; return; }
      const type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((x) => MediaRecorder.isTypeSupported(x));
      const rec = new MediaRecorder(cv.captureStream(FPS), { mimeType: type, videoBitsPerSecond: 5e6 });
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recording = true; msg.textContent = '⏺ Grabando… (' + Math.round(DRAW_S + HOLD_S) + ' s)';
      rec.start(250); play();
      await new Promise((r) => setTimeout(r, (DRAW_S + HOLD_S) * 1000));
      rec.stop(); await new Promise((r) => (rec.onstop = r));
      recording = false;
      const ext = /mp4/.test(type) ? 'mp4' : 'webm';
      msg.textContent = '✅ Vídeo listo';
      await save(new Blob(chunks, { type: type.split(';')[0] }), `${fileBase(walk)}.${ext}`, 'Mi paseo en PintaMapa');
    };
    // exportar
    body.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => {
      const x = b.dataset.x, base = fileBase(walk);
      if (x === 'gpx') save(new Blob([gpx(walk, P)], { type: 'application/gpx+xml' }), base + '.gpx');
      if (x === 'tcx') save(new Blob([tcx(walk, P, A)], { type: 'application/vnd.garmin.tcx+xml' }), base + '.tcx');
      if (x === 'kml') save(new Blob([kml(walk, P, A)], { type: 'application/vnd.google-earth.kml+xml' }), base + '.kml');
      if (x === 'kmz') save(zip('doc.kml', kml(walk, P, A)), base + '.kmz');
      if (x === 'geojson') save(new Blob([geojson(walk, P, A)], { type: 'application/geo+json' }), base + '.geojson');
      if (x === 'csv') save(new Blob([csv(walk, P)], { type: 'text/csv' }), base + '.csv');
    }));
  }
  const fileBase = (walk) => 'PintaMapa-paseo-' + new Date(walk.start).toISOString().slice(0, 16).replace(/[T:]/g, '-');
  async function save(blob, name, title) {
    try {
      if (PM.isNative && window.Capacitor.Plugins.Filesystem && window.Capacitor.Plugins.Share) {
        const b64 = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
        const f = await window.Capacitor.Plugins.Filesystem.writeFile({ path: name, data: b64, directory: 'CACHE' });
        await window.Capacitor.Plugins.Share.share({ title: title || name, files: [f.uri] }).catch(() => {});
        return;
      }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    } catch (e) { alert('No se pudo guardar: ' + (e.message || e)); }
  }
  function close() { const ov = document.getElementById('replay-view'); if (ov) ov.remove(); }

  const st = document.createElement('style');
  st.textContent = `
  #replay-view { position: fixed; inset: 0; z-index: 3100; background: rgba(15,23,42,.55); display: flex; justify-content: center; align-items: flex-end; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  #replay-view .rp-box { background: #fff; color: #111827; width: min(760px, 100%); max-height: 94vh; border-radius: 18px 18px 0 0; display: flex; flex-direction: column; box-shadow: 0 -10px 40px rgba(0,0,0,.25); }
  @media (min-width: 800px) { #replay-view { align-items: center; } #replay-view .rp-box { border-radius: 18px; } }
  #replay-view .rp-head { display: flex; justify-content: space-between; align-items: center; padding: 16px 18px 10px; border-bottom: 1px solid #e5e7eb; }
  #replay-view .rp-head small { color: #6b7280; font-size: 13px; display: block; } #replay-view .rp-head small::first-letter { text-transform: uppercase; } #replay-view h2 { margin: 2px 0 0; font-size: 20px; }
  #replay-view .rp-x { border: 0; background: #f3f4f6; width: 40px; height: 40px; border-radius: 50%; font-size: 18px; cursor: pointer; }
  #replay-view .rp-body { overflow-y: auto; padding: 14px 18px 26px; }
  #replay-view h3 { font-size: 15px; margin: 22px 0 8px; color: #374151; }
  #replay-view .rp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
  #replay-view .rp-k { background: #f9fafb; border: 1px solid #eef0f3; border-radius: 12px; padding: 10px 12px; }
  #replay-view .rp-k small { display: block; color: #6b7280; font-size: 12px; } #replay-view .rp-k b { display: block; font-size: 20px; margin-top: 2px; }
  #replay-view .rp-k em { display: block; font-style: normal; color: #9ca3af; font-size: 12px; }
  #replay-view .rp-chart { width: 100%; height: auto; display: block; background: #f9fafb; border-radius: 12px; }
  #replay-view .rp-chart .ax text, #replay-view .rp-chart .lab { font-size: 11px; fill: #6b7280; } #replay-view .rp-chart .ax line { stroke: #e5e7eb; }
  #replay-view .rp-empty, #replay-view .rp-loading, #replay-view .rp-note { color: #6b7280; font-size: 14px; }
  #replay-view .rp-splits { width: 100%; border-collapse: collapse; font-size: 14px; }
  #replay-view .rp-splits th { text-align: left; color: #6b7280; font-weight: 600; padding: 4px 6px; } #replay-view .rp-splits td { padding: 6px; border-top: 1px solid #f1f5f9; }
  #replay-view .rp-splits td:last-child { width: 40%; } #replay-view .rp-splits i { display: block; height: 10px; border-radius: 5px; background: #93c5fd; }
  #replay-view .rp-splits tr.best i { background: #2563eb; } #replay-view .rp-splits tr.best td:nth-child(2) { font-weight: 700; color: #2563eb; }
  #replay-view .rp-video { display: flex; flex-direction: column; align-items: center; gap: 10px; }
  #replay-view canvas { height: min(60vh, 520px); width: auto; border-radius: 12px; }
  #replay-view .rp-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
  #replay-view .rp-exp { justify-content: flex-start; }
  #replay-view button[data-a], #replay-view button[data-x] { border: 1px solid #d1d5db; border-radius: 10px; padding: 10px 16px; font: 600 15px system-ui, sans-serif; background: #fff; color: #111827; cursor: pointer; }
  #replay-view button.pri { background: #2563eb; border-color: #2563eb; color: #fff; }
  #replay-view .rp-msg { color: #374151; font-size: 14px; margin: 0; min-height: 1.2em; }`;
  document.head.appendChild(st);

  return { open, close, analyze: (w) => analyze(w, points(w)) };
})();
