// PintaMapa — tu perro en 3D realista: anatomía de cachorro (cráneo, hocico, mandíbula, cuello, pecho, muslos, patas con
// articulación y dedos, cola curva), PELAJE con capas (técnica "shell fur" de los videojuegos), marcas de raza pintadas en
// el pelo, ojos con iris y reflejo, trufa húmeda, luz física con reflejos del entorno y sombras suaves.
// Habitación 3D, vida propia, trucos y juegos. Usa Three.js (lib/three.min.js).
PM.pet3d = (function () {
  const T = () => window.THREE;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
  const col = (c) => new (T().Color)(c).convertSRGBToLinear();
  // ruido determinista (las manchas no cambian de sitio al reabrir)
  const rng = (seed) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  function canvasTex(w, h, draw, srgb = true) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const tx = new (T().CanvasTexture)(c); tx.anisotropy = 4; if (srgb) tx.encoding = T().sRGBEncoding; return tx;
  }
  let NOISE = null;
  function noiseTex() {   // densidad de pelo: cada píxel es la altura de un pelo
    if (NOISE) return NOISE;
    const THREE = T(), n = 256, d = new Uint8Array(n * n * 4), r = rng(7);
    for (let i = 0; i < n * n; i++) { const v = Math.pow(r(), 1.6) * 255; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
    NOISE = new THREE.DataTexture(d, n, n, THREE.RGBAFormat);
    NOISE.wrapS = NOISE.wrapT = THREE.RepeatWrapping; NOISE.magFilter = THREE.LinearFilter; NOISE.minFilter = THREE.LinearFilter; NOISE.needsUpdate = true;
    return NOISE;
  }

  function mount(box, cfg) {
    const THREE = T();
    if (!THREE) return null;
    const W0 = box.clientWidth || 320, H0 = box.clientHeight || 290;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'default' });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(W0, H0);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.98;
    renderer.physicallyCorrectLights = false;
    box.appendChild(renderer.domElement);
    renderer.domElement.className = 'p3-canvas';
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, W0 / H0, 0.1, 100);
    camera.position.set(0, 1.85, 6.3); camera.lookAt(0, 0.82, 0);
    const night = cfg.night;
    const OUT = {};   // (compatibilidad: ya no hay contorno de dibujo animado)
    const std = (c, extra) => new THREE.MeshStandardMaterial(Object.assign({ color: col(c), roughness: 0.75, metalness: 0 }, extra || {}));
    const toon = std;

    // ---------- entorno para reflejos (una habitación cálida con ventana luminosa) ----------
    const pm = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(20, 32, 16), new THREE.MeshBasicMaterial({ side: THREE.BackSide,
      map: canvasTex(256, 128, (c, w, h) => { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, night ? '#30305a' : '#fff7ea'); g.addColorStop(0.5, night ? '#3a3248' : '#f3d9b8'); g.addColorStop(1, night ? '#2a1f18' : '#a8794d'); c.fillStyle = g; c.fillRect(0, 0, w, h); }) })));
    const winL = new THREE.Mesh(new THREE.PlaneGeometry(8, 5), new THREE.MeshBasicMaterial({ color: night ? 0x8090ff : 0xffffff })); winL.position.set(-8, 6, 8); winL.lookAt(0, 0, 0); envScene.add(winL);
    scene.environment = pm.fromScene(envScene, 0.04).texture;

    // ---------- HABITACIÓN ----------
    scene.background = col(night ? '#2b2440' : '#f7e3c8');
    const hemi = new THREE.HemisphereLight(night ? 0x9aa0ff : 0xfff4e6, night ? 0x2a2018 : 0x8a6a48, night ? 0.35 : 0.45); scene.add(hemi);
    const sun = new THREE.DirectionalLight(night ? 0xbfc7ff : 0xfff0dc, night ? 0.9 : 1.6);
    sun.position.set(-4, 7, 6); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); sun.shadow.bias = -0.0005;
    Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 22 }); sun.shadow.radius = 5;
    scene.add(sun);
    const rim = new THREE.DirectionalLight(0xffffff, night ? 0.25 : 0.45); rim.position.set(4, 3, -5); scene.add(rim);
    const floorTex = canvasTex(512, 512, (c, w, h) => {
      const r = rng(3);
      for (let i = 0; i < 8; i++) {
        const base = night ? [96, 72, 52] : [186, 132, 82], k = 0.9 + r() * 0.2;
        c.fillStyle = `rgb(${base.map((v) => Math.round(v * k)).join(',')})`; c.fillRect(i * w / 8, 0, w / 8, h);
        for (let j = 0; j < 40; j++) { c.strokeStyle = `rgba(60,35,15,${0.04 + r() * 0.06})`; c.lineWidth = 1 + r() * 2; const x = i * w / 8 + r() * w / 8; c.beginPath(); c.moveTo(x, 0); c.bezierCurveTo(x + 6, h / 3, x - 6, h * 2 / 3, x + r() * 4, h); c.stroke(); }
      }
      c.fillStyle = 'rgba(40,20,5,.35)'; for (let i = 0; i <= 8; i++) c.fillRect(i * w / 8 - 1, 0, 2, h);
    });
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(2, 2);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 10), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.55, metalness: 0 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const wallTex = canvasTex(512, 256, (c, w, h) => {
      c.fillStyle = night ? '#4e4060' : '#f6dcb6'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 16; i++) { c.fillStyle = night ? 'rgba(255,255,255,.03)' : 'rgba(255,255,255,.18)'; c.fillRect(i * w / 16, 0, w / 32, h); }
      c.fillStyle = night ? '#3d2f4d' : '#c8955c'; c.fillRect(0, h - 22, w, 22);
    });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(16, 7), new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95 }));
    wall.position.set(0, 3.5, -3.2); wall.receiveShadow = true; scene.add(wall);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.5), new THREE.MeshBasicMaterial({ map: canvasTex(200, 150, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, night ? '#0f172a' : '#8fd3ff'); g.addColorStop(1, night ? '#1e3a8a' : '#e6f6ff'); c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.fillStyle = night ? '#fef9c3' : '#fff3a0'; c.beginPath(); c.arc(w * 0.72, h * 0.3, 16, 0, 7); c.fill();
      if (night) { c.fillStyle = '#fff'; for (let i = 0; i < 14; i++) c.fillRect((i * 53) % w, (i * 31) % (h * 0.8), 2, 2); }
      else { c.fillStyle = 'rgba(255,255,255,.9)'; [[40, 60], [62, 54], [52, 48]].forEach(([x, y]) => { c.beginPath(); c.arc(x, y, 13, 0, 7); c.fill(); }); }
      c.strokeStyle = '#fbf6ef'; c.lineWidth = 10; c.strokeRect(0, 0, w, h); c.beginPath(); c.moveTo(w / 2, 0); c.lineTo(w / 2, h); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.lineWidth = 6; c.stroke();
    }) }));
    win.position.set(-3.1, 3.6, -3.18); scene.add(win);
    const bedC = cfg.color || '#2563eb';
    const bed = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.34, 18, 40), std(bedC, { roughness: 0.95 })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.32; ring.castShadow = ring.receiveShadow = true;
    const cush = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.24, 40), std('#f3e7cf', { roughness: 1 })); cush.position.y = 0.16; cush.receiveShadow = true;
    bed.add(ring, cush); bed.position.set(-3.1, 0, -1.3); scene.add(bed);
    const bowl = new THREE.Group();
    const bw = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.38, 0.3, 36, 1, true), std('#e2e8f0', { metalness: 0.8, roughness: 0.25, side: THREE.DoubleSide })); bw.position.y = 0.15; bw.castShadow = true;
    const food = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.04, 36), std('#8b5a2b', { roughness: 0.9 })); food.position.y = 0.25;
    bowl.add(bw, food); bowl.position.set(3.1, 0, -1.0); scene.add(bowl);
    const rug = new THREE.Mesh(new THREE.CircleGeometry(1.8, 48), std(night ? '#3b5bab' : '#9cc3f5', { roughness: 1 })); rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.01, 0.4); rug.scale.y = 0.6; rug.receiveShadow = true; scene.add(rug);
    const ballM = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 16), std('#c6f24e', { roughness: 0.9 })); ballM.castShadow = true; ballM.visible = false; scene.add(ballM);

    // ---------- PELAJE (shell fur) ----------
    const SHELLS = 9;
    function furMat(map, len, k, den) {
      const m = new THREE.MeshStandardMaterial({ map, roughness: 0.92, metalness: 0, envMapIntensity: 0.55 });
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uK = { value: k }; sh.uniforms.uLen = { value: len }; sh.uniforms.uNoise = { value: noiseTex() }; sh.uniforms.uDen = { value: den };
        sh.vertexShader = 'uniform float uK;\nuniform float uLen;\n' + sh.vertexShader.replace('#include <begin_vertex>',
          'vec3 transformed = vec3(position) + normal * uK * uLen; transformed.y -= uK * uK * uLen * 0.35;');
        sh.fragmentShader = 'uniform float uK;\nuniform sampler2D uNoise;\nuniform vec2 uDen;\n' + sh.fragmentShader.replace('#include <map_fragment>',
          '#include <map_fragment>\n float fn = texture2D(uNoise, vUv * uDen).r; if (uK > 0.0 && fn < uK * 0.95) discard; diffuseColor.rgb *= mix(0.42, 1.06, uK);');
      };
      m.customProgramCacheKey = () => 'fur1';
      return m;
    }
    // pieza de pelo: geometría con la forma ya horneada (escala) + capas
    function furPart(geo, map, len, den) {
      const g = new THREE.Group();
      for (let i = 0; i <= SHELLS; i++) {
        const k = i / SHELLS, m = new THREE.Mesh(geo, furMat(map, len, k, den));
        m.castShadow = i === 0; m.receiveShadow = i === 0; m.renderOrder = i;
        g.add(m);
      }
      return g;
    }
    const ell = (sx, sy, sz, seg = 36) => { const g = new THREE.SphereGeometry(1, seg, Math.round(seg * 0.7)); g.scale(sx, sy, sz); return g; };

    // ---------------- EL PERRO ----------------
    let dog = null, P = {};
    function build(look) {
      if (dog) { scene.remove(dog); dog.traverse((o) => { if (o.material && o.material.dispose) o.material.dispose(); if (o.material && o.material.map && o.material.map !== floorTex) o.material.map.dispose && o.material.map.dispose(); }); }
      const b = look.breed, c = look.color || '#2563eb', g = new Set(look.gear || []);
      const fur = b.fur, dark = b.dark;
      const darkFur = ['#262626', '#34343c'].includes(fur);
      const longFur = { husky: 1, caniche: 1, border: 1, mestizo: 0.6, corgi: 0.6 }[b.key] || 0.3;
      const L = 0.012 + longFur * 0.052;   // largo del pelo (labrador corto, husky/caniche largo)
      const light = b.blaze || (darkFur ? '#e5e7eb' : '#f3e6d3');
      const seed = [...(b.key || 'x')].reduce((a, ch) => a + ch.charCodeAt(0), 11);
      // textura de color de cada parte (en coordenadas de la esfera: u=0.25 es el frente, arriba es la parte de arriba)
      const tex = (part) => canvasTex(256, 128, (x, w, h) => {
        x.fillStyle = fur; x.fillRect(0, 0, w, h);
        const r = rng(seed + part.length * 97);
        // degradado natural: más claro por debajo
        const gg = x.createLinearGradient(0, 0, 0, h); gg.addColorStop(0, 'rgba(0,0,0,.10)'); gg.addColorStop(0.6, 'rgba(0,0,0,0)'); gg.addColorStop(1, 'rgba(255,255,255,.18)'); x.fillStyle = gg; x.fillRect(0, 0, w, h);
        const front = (cx, cy, rx, ry, color) => { x.fillStyle = color; x.beginPath(); x.ellipse(cx * w, cy * h, rx * w, ry * h, 0, 0, 7); x.fill(); };
        if (part === 'head') {
          if (b.mask) { front(0.25, 0.78, 0.2, 0.32, b.mask); front(0.2, 0.42, 0.035, 0.05, b.mask); front(0.3, 0.42, 0.035, 0.05, b.mask); }
          if (b.blaze) { x.fillStyle = b.blaze; x.beginPath(); x.moveTo(0.235 * w, 0); x.lineTo(0.265 * w, 0); x.lineTo(0.3 * w, 0.75 * h); x.lineTo(0.2 * w, 0.75 * h); x.fill(); }
          if (b.wrinkles) { x.strokeStyle = 'rgba(80,50,20,.35)'; x.lineWidth = 3; for (let i = 0; i < 3; i++) { x.beginPath(); x.moveTo(0.18 * w, (0.25 + i * 0.06) * h); x.quadraticCurveTo(0.25 * w, (0.22 + i * 0.06) * h, 0.32 * w, (0.25 + i * 0.06) * h); x.stroke(); } }
        }
        if (part === 'muzzle') { x.fillStyle = ['#3a3a3a', '#44444e'].includes(b.muzzle) ? b.muzzle : b.muzzle; x.fillRect(0, 0, w, h); if (b.blaze && !b.mask) { x.fillStyle = b.blaze; x.fillRect(0, 0, w, h); } }
        if (part === 'chest' && (b.blaze || b.mask || b.key === 'mestizo' || b.key === 'chihuahua')) front(0.25, 0.75, 0.16, 0.45, b.mask || light);
        if (part === 'hind' && b.saddle) { x.fillStyle = b.saddle; x.fillRect(0, 0, w, h * 0.45); }
        if (part === 'chest' && b.saddle) { x.fillStyle = b.saddle; x.fillRect(0.5 * w, 0, w * 0.5, h * 0.3); }
        if (part === 'ear') { x.fillStyle = dark; x.fillRect(0, 0, w, h); }
        if (part === 'paw' && (b.blaze || b.mask)) { x.fillStyle = light; x.fillRect(0, 0, w, h); }
        if (part === 'tail') { if (b.saddle) { x.fillStyle = b.saddle; x.fillRect(0, 0, w, h); } if (b.blaze) { x.fillStyle = b.blaze; x.fillRect(0, h * 0.82, w, h * 0.18); } }
        if (b.spots && part !== 'muzzle' && part !== 'ear') for (let i = 0; i < 14; i++) { x.fillStyle = b.spots; x.beginPath(); x.ellipse(r() * w, r() * h, (6 + r() * 9), (5 + r() * 8), r() * 3, 0, 7); x.fill(); }
      });
      const fine = Math.sqrt(0.05 / L), den = new THREE.Vector2(22 * fine, 11 * fine), denS = new THREE.Vector2(14 * fine, 8 * fine);
      const T0 = { body: tex('body'), chest: tex('chest'), hind: tex('hind'), head: tex('head'), muzzle: tex('muzzle'), ear: tex('ear'), leg: tex('leg'), paw: tex('paw'), tail: tex('tail') };
      const part = (geo, t, len = L, d = den) => furPart(geo, t, len, d);
      dog = new THREE.Group(); P = {};
      const bodyP = new THREE.Group(); bodyP.position.y = 1.0; dog.add(bodyP); P.bodyP = bodyP;
      // tronco: pecho profundo + vientre/caderas (se funden con el pelo)
      const chest = part(ell(0.42, 0.47, 0.52), T0.chest); chest.position.set(0, 0.04, 0.3); bodyP.add(chest);
      const hind = part(ell(0.38, 0.41, 0.5), T0.hind); hind.position.set(0, 0.06, -0.36); bodyP.add(hind);
      const belly = part(ell(0.34, 0.33, 0.5), T0.body); belly.position.set(0, -0.02, -0.02); bodyP.add(belly);
      P.body = chest;
      // patas: hombro/cadera → muslo → (rodilla) → pierna → pata con dedos
      P.legs = [];
      [[0.24, 0.42, true], [-0.24, 0.42, true], [0.25, -0.5, false], [-0.25, -0.5, false]].forEach(([x, z, front], i) => {
        const Lg = new THREE.Group(); Lg.position.set(x, front ? -0.12 : -0.02, z);
        const thigh = part(front ? ell(0.15, 0.3, 0.16) : ell(0.17, 0.32, 0.24), front ? T0.chest : T0.hind); thigh.position.y = -0.22; Lg.add(thigh);
        const knee = new THREE.Group(); knee.position.set(0, -0.45, front ? 0.02 : -0.05); Lg.add(knee);
        const shin = part(ell(0.095, 0.27, 0.105), T0.leg, L * 0.6, denS); shin.position.y = -0.2; knee.add(shin);
        const paw = part(ell(0.12, 0.075, 0.16), T0.paw, L * 0.5, denS); paw.position.set(0, -0.45, 0.05); knee.add(paw);
        for (let t = -1; t <= 1; t++) { const toe = part(ell(0.045, 0.04, 0.05, 16), T0.paw, L * 0.4, denS); toe.position.set(t * 0.06, -0.47, 0.17); knee.add(toe); }
        if (g.has('botas')) { const bt = new THREE.Mesh(ell(0.14, 0.11, 0.2), std(c)); bt.position.set(0, -0.44, 0.06); knee.add(bt); }
        Lg.userData.knee = knee; bodyP.add(Lg); P.legs.push(Lg);
      });
      // cola: tubo curvo que se estrecha, con pelo
      const tailP = new THREE.Group(); tailP.position.set(0, 0.28, -0.86); bodyP.add(tailP); P.tail = tailP;
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.25, -0.12), new THREE.Vector3(0, 0.55, -0.1), new THREE.Vector3(0, 0.78, 0.05)]);
      const tg = new THREE.TubeGeometry(curve, 24, 0.075, 12, false);
      const pos = tg.attributes.position, nrm = tg.attributes.normal;
      for (let i = 0; i < pos.count; i++) {   // se estrecha hacia la punta
        const seg = Math.floor(i / 13) / 24, k = 1 - seg * 0.65, pt = curve.getPoint(seg);
        pos.setXYZ(i, pt.x + (pos.getX(i) - pt.x) * k, pt.y + (pos.getY(i) - pt.y) * k, pt.z + (pos.getZ(i) - pt.z) * k);
      }
      tg.computeVertexNormals();
      tailP.add(part(tg, T0.tail, L * (b.key === 'husky' ? 2.2 : b.key === 'caniche' ? 1.6 : 1.1), new THREE.Vector2(14, 30)));
      tailP.rotation.x = -0.35;
      // cuello
      const neck = part(ell(0.3, 0.34, 0.3), T0.chest); neck.position.set(0, 0.34, 0.56); neck.rotation.x = -0.6; bodyP.add(neck);
      // cabeza: cráneo + mejillas + hocico + trufa + mandíbula
      const headP = new THREE.Group(); headP.position.set(0, 0.78, 0.8); bodyP.add(headP); P.headP = headP;
      const skull = part(ell(0.46, 0.42, 0.45), T0.head); headP.add(skull); P.head = skull;
      const cheeks = part(ell(0.4, 0.3, 0.36), T0.head); cheeks.position.set(0, -0.11, 0.12); headP.add(cheeks);
      const snoutLen = { carlino: 0.18, chihuahua: 0.24, husky: 0.34, labrador: 0.33, border: 0.33, dalmata: 0.32, beagle: 0.33 }[b.key] || 0.3;
      const muzzle = part(ell(0.19, 0.16, snoutLen), T0.muzzle, L * 0.5, denS); muzzle.position.set(0, -0.13, 0.32 + snoutLen * 0.4); headP.add(muzzle);
      if (b.wrinkles) { const fold = part(ell(0.22, 0.08, 0.12), T0.muzzle, L * 0.4, denS); fold.position.set(0, -0.02, 0.48); headP.add(fold); }
      if (b.pom) [[0, 0.4, -0.02, 0.24], [-0.2, 0.32, 0.02, 0.17], [0.2, 0.32, 0.02, 0.17]].forEach(([x, y, z, r]) => { const pp = part(ell(r, r, r), T0.ear, L * 1.6); pp.position.set(x, y, z); headP.add(pp); });
      const noseZ = 0.3 + snoutLen * 1.32 + L * 0.3;
      const nose = new THREE.Mesh(ell(0.085, 0.06, 0.06, 24), std('#1a1210', { roughness: 0.25, metalness: 0.1 })); nose.position.set(0, -0.06, noseZ); headP.add(nose); P.nose = nose;
      [-1, 1].forEach((s) => { const ns = new THREE.Mesh(ell(0.018, 0.012, 0.02, 10), std('#000000', { roughness: 1 })); ns.position.set(s * 0.035, -0.075, noseZ + 0.05); headP.add(ns); });
      const groove = new THREE.Mesh(ell(0.008, 0.05, 0.01, 8), std('#2a1a12')); groove.position.set(0, -0.13, noseZ - 0.01); headP.add(groove);
      // mandíbula (se abre para jadear, ladrar, comer)
      const jaw = new THREE.Group(); jaw.position.set(0, -0.2, 0.22); headP.add(jaw); P.jaw = jaw;
      const lower = part(ell(0.14, 0.06, snoutLen * 0.85), T0.muzzle, L * 0.4, denS); lower.position.set(0, -0.03, snoutLen * 0.75); jaw.add(lower);
      const mouthIn = new THREE.Mesh(ell(0.12, 0.03, snoutLen * 0.7, 16), std('#5b1a1a', { roughness: 0.6 })); mouthIn.position.set(0, 0.02, snoutLen * 0.78); jaw.add(mouthIn);
      const tongue = new THREE.Mesh(ell(0.075, 0.022, 0.15, 20), std('#e86a7a', { roughness: 0.35 })); tongue.position.set(0, 0.03, snoutLen * 1.05); jaw.add(tongue); P.tongue = tongue; tongue.userData.z0 = tongue.position.z;
      P.mouth = { visible: false, scale: { y: 0 } }; P.smile = { visible: false, rotation: {} };
      // ojos: iris marrón, pupila, córnea brillante; párpados del color del pelo para parpadear/entornar
      P.eyes = []; P.pupils = []; P.eyesHappy = []; P.eyesSleep = [];
      const irisC = b.eye || (darkFur ? '#3b2a1a' : '#4a2c14');
      const eyeTex = canvasTex(256, 128, (x, w, h) => {
        x.fillStyle = '#2a1a10'; x.fillRect(0, 0, w, h);
        const cx = 0.25 * w, cy = 0.5 * h, gi = x.createRadialGradient(cx, cy, 2, cx, cy, 0.155 * w);
        gi.addColorStop(0, '#000'); gi.addColorStop(0.32, '#000'); gi.addColorStop(0.36, irisC); gi.addColorStop(0.85, b.eye ? '#1e6aa8' : '#2a170a'); gi.addColorStop(1, '#120a05');
        x.fillStyle = gi; x.beginPath(); x.ellipse(cx, cy, 0.16 * w, 0.32 * h, 0, 0, 7); x.fill();
      });
      [-1, 1].forEach((s) => {
        const eg = new THREE.Group(); eg.position.set(s * 0.175, 0.07, 0.39 + L * 0.55); eg.rotation.y = s * 0.3; headP.add(eg);
        const rimE = new THREE.Mesh(new THREE.TorusGeometry(0.083, 0.014, 10, 28), std('#1a110b', { roughness: 0.6 })); rimE.position.z = 0.012; eg.add(rimE);
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.082, 28, 20), new THREE.MeshStandardMaterial({ map: eyeTex, roughness: 0.04, metalness: 0, envMapIntensity: 1.6 }));
        eg.add(eye); P.pupils.push(eye);
        const glint = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff })); glint.position.set(0.028, 0.034, 0.075); eg.add(glint);
        // párpado superior (cubre el ojo al parpadear o entornar)
        const lid = new THREE.Mesh(new THREE.SphereGeometry(0.09, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), std(darkFur ? fur : b.mask && s ? fur : fur, { roughness: 0.9, side: THREE.DoubleSide }));
        lid.rotation.x = -1.35; eg.add(lid); eg.userData.lid = lid;
        P.eyes.push(eg);
      });
      // orejas
      P.ears = [];
      [-1, 1].forEach((s) => {
        const E = new THREE.Group(); E.position.set(s * 0.3, 0.22, -0.04); headP.add(E); P.ears.push(E);
        if (b.ear === 'pointy' || b.ear === 'big' || b.ear === 'semi') {
          const big = b.ear === 'big' ? 1.5 : 1;
          const cg = new THREE.ConeGeometry(0.15 * big, 0.36 * big, 20, 1); cg.scale(1, 1, 0.42);
          const cone = part(cg, T0.ear, L * 0.7, denS); cone.position.y = 0.17 * big; cone.rotation.z = -s * 0.3; E.add(cone);
          const inn = new THREE.Mesh(new THREE.ConeGeometry(0.09 * big, 0.25 * big, 16), std('#f2a7b0', { roughness: 0.7 })); inn.scale.z = 0.25; inn.position.set(0, 0.15 * big, 0.04); inn.rotation.z = -s * 0.3; E.add(inn);
          if (b.ear === 'semi') { const tip = part(new THREE.ConeGeometry(0.08, 0.16, 12), T0.ear, L * 0.5, denS); tip.position.set(-s * 0.05, 0.36, 0.06); tip.rotation.set(1.3, 0, -s * 0.3); E.add(tip); }
        } else if (b.ear === 'small') {
          const cg = new THREE.ConeGeometry(0.1, 0.18, 16); cg.scale(1, 1, 0.4);
          const cone = part(cg, T0.ear, L * 0.4, denS); cone.position.set(s * 0.02, 0.06, 0.06); cone.rotation.set(1.0, 0, -s * 0.9); E.add(cone);
        } else if (b.ear === 'fluffy') {
          [[0, -0.08, 0.17], [0.02 * s, -0.3, 0.16], [0.04 * s, -0.5, 0.13]].forEach(([x, y, r]) => { const pp = part(ell(r, r, r * 0.8), T0.ear, L * 1.8); pp.position.set(x, y, 0); E.add(pp); });
        } else {
          const len = b.ear === 'long' ? 0.4 : 0.3;
          const eg2 = ell(0.12, len, 0.045); const ear = part(eg2, T0.ear, L * (b.ear === 'long' ? 0.8 : 0.6), denS); ear.position.set(s * 0.06, -len * 0.75, 0.02); ear.rotation.z = s * 0.2; E.add(ear);
        }
        if (s < 0 && g.has('lazo')) { const bw2 = std('#f472b6'); [-1, 1].forEach((t) => { const lo = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.12, 12), bw2); lo.position.set(t * 0.06, 0.05, 0.1); lo.rotation.z = t * Math.PI / 2; E.add(lo); }); }
      });
      // accesorios (sobre la nueva anatomía)
      const neckY = 0.45, neckZ = 0.64;
      if (g.has('collar')) { const cl = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.045, 12, 36), std('#c81e1e', { roughness: 0.5 })); cl.position.set(0, neckY, neckZ); cl.rotation.x = Math.PI / 2 - 0.55; bodyP.add(cl); }
      if (g.has('chapa')) { const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.015, 20), std('#facc15', { metalness: 1, roughness: 0.2 })); ch.rotation.x = Math.PI / 2 - 0.3; ch.position.set(0, neckY - 0.2, neckZ + 0.3); bodyP.add(ch); }
      if (g.has('panuelo')) { const pn = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.42, 3), std(c, { roughness: 0.8 })); pn.position.set(0, neckY - 0.22, neckZ + 0.2); pn.rotation.set(Math.PI + 0.45, 0, 0); pn.scale.z = 0.3; bodyP.add(pn); }
      if (g.has('pajarita')) [-1, 1].forEach((s) => { const bt = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.18, 4), std(c)); bt.position.set(s * 0.1, neckY - 0.12, neckZ + 0.3); bt.rotation.z = s * Math.PI / 2; bodyP.add(bt); });
      if (g.has('gorra') && !g.has('corona')) { const cap = new THREE.Mesh(new THREE.SphereGeometry(0.4, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), std(c)); cap.position.set(0, 0.2, -0.02); headP.add(cap); const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.03, 24), std(c)); brim.position.set(0, 0.22, 0.36); brim.scale.z = 1.3; headP.add(brim); }
      if (g.has('corona')) { const gm = std('#facc15', { metalness: 1, roughness: 0.25 }); const cr = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.16, 18, 1, true), Object.assign(gm, { side: THREE.DoubleSide })); cr.position.set(0, 0.44, 0); headP.add(cr); for (let i = 0; i < 6; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.11, 8), gm); const a = i / 6 * Math.PI * 2; sp.position.set(Math.sin(a) * 0.2, 0.57, Math.cos(a) * 0.2); headP.add(sp); } }
      if (g.has('fiesta') && !g.has('corona') && !g.has('gorra')) { const hat = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.45, 20), std(c)); hat.position.set(0.1, 0.58, 0); hat.rotation.z = -0.2; headP.add(hat); const pom = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), std('#facc15')); pom.position.set(0.15, 0.81, 0); headP.add(pom); }
      if (g.has('vaquero') && !g.has('corona') && !g.has('gorra') && !g.has('fiesta')) { const br = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.04, 32), std('#8a4b16')); br.position.set(0, 0.35, 0); headP.add(br); const cw = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.32, 24), std('#a55a1c')); cw.position.set(0, 0.52, 0); headP.add(cw); }
      if (g.has('gafas')) [-1, 1].forEach((s) => { const gl = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.13, 0.03), std('#0b0b0b', { roughness: 0.05, metalness: 0.4 })); gl.position.set(s * 0.17, 0.05, 0.42); gl.rotation.y = s * 0.3; headP.add(gl); });
      if (g.has('cascos')) { const band = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.035, 8, 24, Math.PI), std('#111111')); band.position.set(0, 0.04, 0); headP.add(band); [-1, 1].forEach((s) => { const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.1, 18), std(c)); cup.rotation.z = Math.PI / 2; cup.position.set(s * 0.45, 0.02, 0); headP.add(cup); }); }
      if (g.has('dino')) for (let i = 0; i < 6; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 8), std('#4ade80')); if (i < 2) { sp.position.set(0, 0.42, 0.08 - i * 0.2); headP.add(sp); } else { sp.position.set(0, 0.52, 0.3 - (i - 2) * 0.3); bodyP.add(sp); } }
      if (g.has('capa')) { const cp = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.1, 8, 8), std(c, { side: THREE.DoubleSide, roughness: 0.6 })); cp.position.set(0, 0.3, -0.5); cp.rotation.x = 0.5; bodyP.add(cp); P.cape = cp; }
      if (g.has('alas')) [-1, 1].forEach((s) => { const w = new THREE.Mesh(ell(0.06, 0.3, 0.45), std('#ffffff', { roughness: 0.9 })); w.position.set(s * 0.55, 0.42, -0.1); w.rotation.z = s * 0.6; bodyP.add(w); (P.wings = P.wings || []).push(w); });
      if (g.has('mochila')) { const mb = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 0.45), std(c)); mb.position.set(0, 0.52, -0.15); bodyP.add(mb); }
      dog.traverse((o) => { if (o.isMesh && !o.castShadow && o.material && !o.material.onBeforeCompile) o.castShadow = true; });
      dog.position.set(0, 0, 0.6);
      scene.add(dog);
      setFace(cur.face);
    }
    function mix(c, k) { const a = new THREE.Color(c), w = new THREE.Color(0xffffff); a.lerp(w, k); return '#' + a.getHexString(); }

    // ---------------- ESTADO Y ANIMACIÓN ----------------
    const cur = { face: cfg.face || 'normal', pose: 'sit', moving: false, wag: 1 };
    const S = {
      pos: new THREE.Vector3(0, 0, 0.6), target: null, speed: 0, yaw: 0, yawT: 0,
      sit: 1, lie: 0, belly: 0, walkPh: 0, jumpY: 0, spinY: 0, flip: 0, roll: 0, headX: 0, headY: 0, headZ: 0, lookX: 0, lookY: 0,
      blinkT: 2, blink: 0, wagSpeed: 6, wagAmp: 0.5, earWob: 0, sniff: 0, beg: 0, dig: 0, scratch: 0, mouthOpen: 0, eat: 0, bob: 0,
    };
    // caras: cuánto cierran los párpados y cuánto se abre la boca
    const LID = { normal: 0.24, happy: 0.6, bored: 0.55, sleep: 1, wow: 0.02, sad: 0.4 };
    const MOUTH = { normal: 0, happy: 0.42, bored: 0, sleep: 0.02, wow: 0.55, sad: 0 };
    function setFace(f) { cur.face = f; }
    // pequeña máquina de tareas: cada acción es una promesa que se cancela si llega otra (interacciones)
    let token = 0;
    const anims = [];
    function animate(ms, fn, tk) {
      return new Promise((res) => { anims.push({ t: 0, ms, fn, res, tk: tk == null ? token : tk }); });
    }
    const wait = (ms) => animate(ms, () => {});
    function walkTo(x, z, run) {
      x = clamp(x, -2.8, 2.8); z = clamp(z, -1.0, 1.6);
      S.target = new THREE.Vector3(x, 0, z); S.speed = run ? 2.6 : 1.1;
      const tk = token;
      return new Promise((res) => { const chk = () => { if (tk !== token || !S.target) return res(); requestAnimationFrame(chk); }; chk(); });
    }
    function interrupt() { token++; S.target = null; anims.splice(0).forEach((a) => a.res()); S.beg = S.dig = S.sniff = S.scratch = S.eat = 0; S.jumpY = 0; S.spinY = 0; S.flip = 0; S.roll = 0; }
    function faceCam() { S.yawT = Math.atan2(camera.position.x - S.pos.x, camera.position.z - S.pos.z); }

    // ---------------- pointer: mirar, acariciar, tocar ----------------
    const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
    let pointerWorld = null, rub = null, lastPointerT = 0;
    const cv = renderer.domElement;
    const toNdc = (e) => { const r = cv.getBoundingClientRect(); mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); };
    const hitDog = () => { ray.setFromCamera(mouse, camera); return dog ? ray.intersectObject(dog, true).filter((h) => h.object.material !== OUT).length > 0 : false; };
    cv.addEventListener('pointermove', (e) => {
      toNdc(e); lastPointerT = performance.now();
      ray.setFromCamera(mouse, camera);
      const pl = new THREE.Plane(new THREE.Vector3(0, 0, 1), -2.2), v = new THREE.Vector3();
      if (ray.ray.intersectPlane(pl, v)) pointerWorld = v;
      if (rub) {
        rub.d += Math.hypot(e.clientX - rub.x, e.clientY - rub.y); rub.x = e.clientX; rub.y = e.clientY;
        if (rub.d > 40) { rub.d = 0; rub.n++; setFace('happy'); S.wagSpeed = 16; cfg.onBurst && cfg.onBurst(['💕', '❤️', '✨'], 1); PM.vibrate && PM.vibrate(8); }
      }
    });
    cv.addEventListener('pointerdown', (e) => { toNdc(e); if (hitDog()) { rub = { x: e.clientX, y: e.clientY, d: 0, n: 0 }; try { cv.setPointerCapture(e.pointerId); } catch (er) {} interrupt(); } });
    const endRub = () => { if (!rub) return; const r = rub; rub = null; S.wagSpeed = 6; if (r.n === 0) cfg.onTap && cfg.onTap(); else cfg.onRub && cfg.onRub(r.n); };
    cv.addEventListener('pointerup', endRub); cv.addEventListener('pointercancel', endRub);

    // ---------------- bucle ----------------
    let last = performance.now(), raf = 0, alive = true;
    function frame(now) {
      if (!alive) return;
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      for (let i = anims.length - 1; i >= 0; i--) {
        const a = anims[i];
        if (a.tk !== token) { anims.splice(i, 1); a.res(); continue; }
        a.t += dt * 1000; const k = clamp(a.t / a.ms, 0, 1); a.fn(k, dt);
        if (k >= 1) { anims.splice(i, 1); a.res(); }
      }
      // caminar
      if (S.target) {
        const d = S.target.clone().sub(S.pos); d.y = 0;
        const dist = d.length();
        if (dist < 0.06) { S.target = null; }
        else {
          S.yawT = Math.atan2(d.x, d.z);
          const step = Math.min(dist, S.speed * dt); S.pos.add(d.normalize().multiplyScalar(step));
          S.walkPh += dt * S.speed * 7;
        }
      }
      const moving = !!S.target;
      S.sit = lerp(S.sit, moving || S.lie > 0.5 || S.beg > 0 ? 0 : (cur.pose === 'stand' ? 0 : 1), dt * 6);
      let dy = S.yawT - S.yaw; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2; S.yaw += dy * Math.min(1, dt * 8);
      // parpadeo
      S.blinkT -= dt; if (S.blinkT <= 0) { S.blink = 1; S.blinkT = 2.5 + Math.random() * 3; }
      S.blink = Math.max(0, S.blink - dt * 7);
      if (dog) {
        dog.position.set(S.pos.x, S.jumpY, S.pos.z);
        dog.rotation.set(S.flip, S.yaw + S.spinY, S.roll);
        const bp = P.bodyP, breathe = Math.sin(now / 520) * 0.012;
        // pose: de pie / sentado / tumbado / suplicando
        const sitK = S.sit, lieK = S.lie, begK = S.beg;
        bp.position.y = 1.0 - sitK * 0.2 - lieK * 0.48 + (moving ? Math.abs(Math.sin(S.walkPh)) * 0.06 : 0) + begK * 0.25;
        bp.rotation.x = -sitK * 0.48 - begK * 0.9 + S.dig * 0.25 + S.eat * 0.15;
        bp.position.z = -sitK * 0.12;
        bp.scale.set(1, 1 + breathe, 1);
        const sw = moving ? Math.sin(S.walkPh) * 0.65 : 0;
        P.legs.forEach((L, i) => {
          const front = i < 2, side = i % 2 ? -1 : 1;
          let rx = (front ? 1 : -1) * sw * (i === 0 || i === 3 ? 1 : -1);
          if (front) rx += sitK * 0.48 + begK * (0.9 - 1.2) - lieK * 1.25 + (S.dig ? Math.sin(now / 60 + i) * 0.7 : 0);
          else rx += -sitK * 1.0 + lieK * 1.3 + (S.scratch && side > 0 ? Math.sin(now / 35) * 0.7 - 0.6 : 0) + begK * 0.9;
          L.rotation.x = rx;
          L.rotation.z = front ? 0 : -side * sitK * 0.25;
          const kn = L.userData.knee;
          if (kn) kn.rotation.x = front ? -Math.max(0, sw * (i === 0 ? 1 : -1)) * 0.6 - begK * 0.9 + lieK * 0.4 : Math.max(0, -sw * (i === 3 ? 1 : -1)) * 0.6 + sitK * 1.6 + lieK * 0.8;
        });
        // cabeza: mira al dedo / alrededor
        let lx = 0, ly = 0;
        if (pointerWorld && performance.now() - lastPointerT < 4000) {
          const hp = new THREE.Vector3(); P.headP.getWorldPosition(hp);
          const v = pointerWorld.clone().sub(hp);
          const yawTo = Math.atan2(v.x, v.z) - (S.yaw + S.spinY);
          let yt = yawTo; while (yt > Math.PI) yt -= Math.PI * 2; while (yt < -Math.PI) yt += Math.PI * 2;
          lx = clamp(yt, -0.9, 0.9); ly = clamp(-Math.atan2(v.y, Math.hypot(v.x, v.z)), -0.5, 0.5);
        } else { lx = Math.sin(now / 2300) * 0.3; ly = Math.sin(now / 1700) * 0.08; }
        S.lookX = lerp(S.lookX, lx, dt * 5); S.lookY = lerp(S.lookY, ly, dt * 5);
        P.headP.rotation.y = S.lookX + S.headY;
        P.headP.rotation.x = S.lookY + S.headX + S.sniff * 0.6 + S.eat * 0.7 + lieK * 0.15 + sitK * 0.35 + begK * 0.5 + (moving ? Math.sin(S.walkPh * 2) * 0.04 : 0);
        P.headP.rotation.z = S.headZ + (S.scratch ? Math.sin(now / 40) * 0.12 : 0) + (S.sniff ? Math.sin(now / 90) * 0.05 : 0);
        // pupilas
        // los ojos giran para mirarte
        P.pupils.forEach((eye) => { eye.rotation.y = clamp(S.lookX * 0.5, -0.45, 0.45); eye.rotation.x = clamp(S.lookY * 0.6, -0.35, 0.35); });
        // parpadeo
        S.lid = lerp(S.lid == null ? 0 : S.lid, LID[cur.face] == null ? 0.08 : LID[cur.face], dt * 10);
        const close = Math.max(S.lid, Math.sin(S.blink * Math.PI));
        P.eyes.forEach((e) => { e.userData.lid.rotation.x = lerp(-1.35, 1.6, clamp(close, -0.15, 1)); });
        // boca
        // mandíbula: jadeo cuando está contento, abierta al sorprenderse, ladrar o comer
        const pant = cur.face === 'happy' ? 0.35 + Math.sin(now / 95) * 0.12 : 0;
        const mo = Math.max(MOUTH[cur.face] || 0, pant, S.mouthOpen);
        P.jaw.rotation.x = lerp(P.jaw.rotation.x, mo * 0.5, dt * 14);
        P.tongue.position.z = lerp(P.tongue.position.z, P.tongue.userData.z0 + (cur.face === 'happy' ? 0.1 : 0), dt * 8);
        P.tongue.rotation.x = cur.face === 'happy' ? 0.35 : 0;
        // cola y orejas
        const wag = Math.sin(now / 1000 * S.wagSpeed * Math.PI) * S.wagAmp * (cur.face === 'sad' || cur.face === 'sleep' ? 0.15 : 1);
        P.tail.rotation.z = wag; P.tail.rotation.x = -0.6 - (cur.face === 'sad' ? -0.9 : 0) - lieK * 0.6;
        S.earWob = lerp(S.earWob, (moving ? Math.sin(S.walkPh * 2) * 0.25 : 0) + S.lookX * -0.2, dt * 8);
        P.ears.forEach((E, i) => { E.rotation.z = (i ? -1 : 1) * (S.earWob * 0.6 + (cur.face === 'sad' ? 0.35 : 0)); E.rotation.x = moving ? Math.sin(S.walkPh * 2 + i) * 0.12 : 0; });
        if (P.wings) P.wings.forEach((w, i) => { w.rotation.z = (i ? -1 : 1) * (0.6 + Math.sin(now / 180) * 0.25); });
        if (P.cape) P.cape.rotation.x = 0.5 + (moving ? 0.5 + Math.sin(now / 120) * 0.1 : Math.sin(now / 700) * 0.05);
      }
      renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    }
    build(cfg.look);
    raf = requestAnimationFrame(frame);
    const ro = new ResizeObserver(() => { const w = box.clientWidth, h = box.clientHeight; if (w && h) { renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); } });
    ro.observe(box);

    // ---------------- ACCIONES (vida propia) ----------------
    const say = (t) => cfg.onSay && cfg.onSay(t);
    const R = {
      async wander() { faceCamLater(); await walkTo(-2.4 + Math.random() * 4.8, -0.6 + Math.random() * 1.9); },
      async sniff() { await walkTo(S.pos.x + Math.random() * 1.6 - 0.8, S.pos.z + Math.random() * 0.8 - 0.4); cur.pose = 'stand'; await animate(2200, (k) => { S.sniff = Math.sin(k * Math.PI); }); S.sniff = 0; cur.pose = 'sit'; },
      async scratch() { faceCam(); await animate(1600, (k) => { S.scratch = k < 1 ? 1 : 0; }); S.scratch = 0; },
      async yawn() { faceCam(); setFace('wow'); await animate(1300, (k) => { S.headX = -Math.sin(k * Math.PI) * 0.35; S.mouthOpen = Math.sin(k * Math.PI); }); S.headX = 0; S.mouthOpen = 0; setFace(cfg.baseFace()); },
      async chase() { setFace('happy'); cur.pose = 'stand'; S.wagSpeed = 14; await animate(1900, (k) => { S.spinY = ease(k) * Math.PI * 6; }); S.spinY = 0; S.wagSpeed = 6; cur.pose = 'sit'; setFace(cfg.baseFace()); },
      async look() { await animate(1700, (k) => { S.headZ = Math.sin(k * Math.PI) * 0.35; }); S.headZ = 0; },
      async drink() { await walkTo(2.55, -0.75); S.yawT = Math.atan2(3.2 - S.pos.x, -1.0 - S.pos.z); cur.pose = 'stand'; await animate(2400, (k) => { S.eat = Math.min(1, k * 4) * (0.8 + Math.sin(k * 40) * 0.2); }); S.eat = 0; cur.pose = 'sit'; },
      async nap() {
        await walkTo(-3.2, -1.2); setFace('sleep'); cfg.onSleep && cfg.onSleep(true);
        await animate(600, (k) => { S.lie = k; });
        await wait(cfg.night ? 9000 : 5500);
        cfg.onSleep && cfg.onSleep(false); setFace('wow'); await animate(500, (k) => { S.lie = 1 - k; }); S.lie = 0; setFace(cfg.baseFace());
      },
      async wag() { faceCam(); setFace('happy'); S.wagSpeed = 16; S.wagAmp = 0.8; await animate(1400, (k) => { S.jumpY = Math.abs(Math.sin(k * Math.PI * 3)) * 0.12; }); S.jumpY = 0; S.wagSpeed = 6; S.wagAmp = 0.5; setFace(cfg.baseFace()); },
      async sit() { faceCam(); cur.pose = 'sit'; await wait(1800 + Math.random() * 1800); },
      async lie() { faceCam(); await animate(500, (k) => { S.lie = k; }); await wait(2500); await animate(500, (k) => { S.lie = 1 - k; }); S.lie = 0; },
    };
    function faceCamLater() { setTimeout(() => { if (!S.target) faceCam(); }, 50); }
    // trucos (al tocarlo o desde la lista)
    const TR = {
      async jump() { faceCam(); setFace('happy'); await animate(650, (k) => { S.jumpY = Math.sin(k * Math.PI) * 1.0; }); S.jumpY = 0; },
      async spin() { setFace('happy'); await animate(900, (k) => { S.spinY = ease(k) * Math.PI * 2; S.jumpY = Math.sin(k * Math.PI) * 0.3; }); S.spinY = 0; S.jumpY = 0; },
      async shake() { faceCam(); cur.pose = 'stand'; await animate(800, (k) => { S.roll = Math.sin(k * Math.PI * 8) * 0.18 * (1 - k); }); S.roll = 0; cur.pose = 'sit'; },
      async bark() { faceCam(); setFace('wow'); for (let i = 0; i < 2; i++) await animate(350, (k) => { S.mouthOpen = Math.sin(k * Math.PI); S.headX = -Math.sin(k * Math.PI) * 0.25; S.jumpY = Math.sin(k * Math.PI) * 0.15; }); S.mouthOpen = 0; S.headX = 0; S.jumpY = 0; },
      async beg() { faceCam(); await animate(1300, (k) => { S.beg = Math.sin(k * Math.PI); }); S.beg = 0; },
      async hearts() { faceCam(); setFace('happy'); await animate(800, (k) => { S.jumpY = Math.abs(Math.sin(k * Math.PI * 2)) * 0.25; }); S.jumpY = 0; },
      async dance() { setFace('happy'); cur.pose = 'stand'; await animate(2000, (k) => { S.roll = Math.sin(k * Math.PI * 6) * 0.22; S.spinY = Math.sin(k * Math.PI * 3) * 0.6; S.jumpY = Math.abs(Math.sin(k * Math.PI * 6)) * 0.15; }); S.roll = 0; S.spinY = 0; S.jumpY = 0; cur.pose = 'sit'; },
      async flip() { faceCam(); await animate(950, (k) => { S.jumpY = Math.sin(k * Math.PI) * 1.4; S.flip = -ease(k) * Math.PI * 2; }); S.flip = 0; S.jumpY = 0; },
      async dig() { faceCam(); cur.pose = 'stand'; await animate(1800, (k) => { S.dig = k < 0.95 ? 1 : 0; }); S.dig = 0; cur.pose = 'sit'; },
      async sleep() { faceCam(); setFace('sleep'); await animate(500, (k) => { S.lie = k; }); await wait(1400); await animate(400, (k) => { S.lie = 1 - k; }); S.lie = 0; setFace(cfg.baseFace()); },
      async moon() { faceCam(); cur.pose = 'stand'; const x0 = S.pos.x; await animate(2000, (k) => { S.pos.x = x0 + Math.sin(k * Math.PI) * -1.4; S.walkPh += 0.4; }); cur.pose = 'sit'; },
      async rocket() { faceCam(); setFace('happy'); await animate(700, (k) => { S.jumpY = -Math.sin(k * Math.PI) * 0.15; }); await animate(900, (k) => { S.jumpY = ease(k) * 7; S.spinY = k * Math.PI * 4; }); S.spinY = 0; await animate(700, (k) => { S.jumpY = 7 * (1 - ease(k)); }); S.jumpY = 0; },
    };
    async function trick(name) { interrupt(); const f = TR[name] || TR.jump; busy = true; try { await f(); } finally { busy = false; setFace(cfg.baseFace()); } }
    let busy = false;
    async function act(name) { if (busy) return; busy = true; try { await (R[name] || R.sit)(); } finally { busy = false; } }
    // premio: la galleta vuela hasta su boca
    async function treat() {
      interrupt(); busy = true;
      const ck = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.06, 20), toon('#d97706')); scene.add(ck); ck.castShadow = true;
      faceCam(); setFace('wow');
      const from = new THREE.Vector3(0, 3.5, 6), hp = new THREE.Vector3();
      await animate(700, (k) => { P.headP.getWorldPosition(hp); ck.position.lerpVectors(from, hp, ease(k)); ck.position.y += Math.sin(k * Math.PI) * 0.8; ck.rotation.x += 0.3; S.mouthOpen = k; });
      scene.remove(ck);
      setFace('happy');
      await animate(1300, (k) => { S.mouthOpen = Math.abs(Math.sin(k * Math.PI * 5)) * 0.6; S.wagSpeed = 14; });
      S.mouthOpen = 0; S.wagSpeed = 6; busy = false; setFace(cfg.baseFace());
    }
    // pelota: vuela, rebota, la persigue, la recoge y te la trae
    async function fetch() {
      interrupt(); busy = true;
      const tx = S.pos.x > 0 ? -2.4 + Math.random() * 1.4 : 1 + Math.random() * 1.4, tz = -0.5 + Math.random() * 1.6;
      const from = new THREE.Vector3(0, 3, 5), to = new THREE.Vector3(tx, 0.2, tz);
      ballM.visible = true; setFace('wow');
      await animate(800, (k) => { ballM.position.lerpVectors(from, to, k); ballM.position.y = lerp(3, 0.2, k) + Math.sin(k * Math.PI) * 1.8; S.yawT = Math.atan2(ballM.position.x - S.pos.x, ballM.position.z - S.pos.z); });
      await animate(350, (k) => { ballM.position.y = 0.2 + Math.sin(k * Math.PI) * 0.4; });
      setFace('happy'); S.wagSpeed = 16;
      await walkTo(tx, tz + 0.3, true);
      const hp = new THREE.Vector3();
      const carry = () => { P.headP.getWorldPosition(hp); ballM.position.set(hp.x + Math.sin(S.yaw) * 0.55, hp.y - 0.35, hp.z + Math.cos(S.yaw) * 0.55); };
      const tk = token; let carrying = true; (function c() { if (!carrying || tk !== token) return; carry(); requestAnimationFrame(c); })();
      await walkTo(0, 1.0, true);
      carrying = false; faceCam();
      await animate(350, (k) => { ballM.position.y = lerp(ballM.position.y, 0.2, k); });
      await R.wag();
      ballM.visible = false; S.wagSpeed = 6; busy = false;
    }
    async function belly() {
      interrupt(); busy = true; setFace('happy'); faceCam();
      await animate(500, (k) => { S.lie = k; S.roll = ease(k) * Math.PI * 0.95; });
      await animate(1400, (k) => { S.wagSpeed = 18; S.jumpY = Math.abs(Math.sin(k * Math.PI * 4)) * 0.05; });
      await animate(500, (k) => { S.roll = Math.PI * 0.95 * (1 - ease(k)); S.lie = 1 - k; });
      S.roll = 0; S.lie = 0; S.jumpY = 0; S.wagSpeed = 6; busy = false; setFace(cfg.baseFace());
    }

    return {
      get busy() { return busy; },
      act, trick, treat, fetch, belly, setFace,
      setLook(look) { build(look); },
      headScreen() { if (!P.headP) return null; const v = new THREE.Vector3(); P.headP.getWorldPosition(v); v.project(camera); const r = cv.getBoundingClientRect(); return { x: (v.x + 1) / 2 * r.width, y: (1 - v.y) / 2 * r.height }; },
      destroy() { alive = false; cancelAnimationFrame(raf); ro.disconnect(); interrupt(); renderer.dispose(); renderer.forceContextLoss && renderer.forceContextLoss(); cv.remove(); },
    };
  }
  return { mount, available: () => !!window.THREE };
})();
