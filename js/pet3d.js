// PintaMapa — tu perro en 3D (estilo mascota de consola): modelo hecho con formas suaves, sombreado "toon" con contorno,
// habitación con sombras, poses (de pie, sentado, tumbado, panza arriba), caminar a cuatro patas, cabeza que te sigue,
// parpadeo, orejas y cola con física sencilla, trucos y juegos. Usa Three.js (lib/three.min.js).
PM.pet3d = (function () {
  const T = () => window.THREE;
  const hex = (c) => new (T().Color)(c);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, k) => a + (b - a) * k;
  const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

  function toonGradient() {
    const THREE = T(), d = new Uint8Array([90, 170, 255]);
    const tx = new THREE.DataTexture(d, 3, 1, THREE.LuminanceFormat);
    tx.minFilter = tx.magFilter = THREE.NearestFilter; tx.needsUpdate = true;
    return tx;
  }
  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const tx = new (T().CanvasTexture)(c); tx.anisotropy = 4; return tx;
  }

  function mount(box, cfg) {
    const THREE = T();
    if (!THREE) return null;
    const W0 = box.clientWidth || 320, H0 = box.clientHeight || 250;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(W0, H0);
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    box.appendChild(renderer.domElement);
    renderer.domElement.className = 'p3-canvas';
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, W0 / H0, 0.1, 100);
    camera.position.set(0, 2.9, 8.6); camera.lookAt(0, 1.0, 0);
    const grad = toonGradient();
    const toon = (c, extra) => new THREE.MeshToonMaterial(Object.assign({ color: hex(c), gradientMap: grad }, extra || {}));
    const OUT = new THREE.MeshBasicMaterial({ color: 0x2a1a10, side: THREE.BackSide });
    const geoS = new THREE.SphereGeometry(1, 28, 20);
    // pieza con contorno (silueta de dibujo animado)
    function blob(color, sx, sy, sz, x, y, z, outline = true, mat) {
      const m = new THREE.Mesh(geoS, mat || toon(color)); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = true;
      if (outline) { const o = new THREE.Mesh(geoS, OUT); o.scale.setScalar(1.06); m.add(o); }
      return m;
    }

    // ---------------- HABITACIÓN ----------------
    const night = cfg.night;
    scene.background = hex(night ? '#2b2440' : '#fde9cf');
    const hemi = new THREE.HemisphereLight(night ? 0x8b8bd6 : 0xffffff, night ? 0x3a2a20 : 0xb98a5a, night ? 0.6 : 0.75); scene.add(hemi);
    const sun = new THREE.DirectionalLight(night ? 0xbfc7ff : 0xfff2dd, night ? 0.5 : 0.75);
    sun.position.set(-3, 7, 5); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 20 }); sun.shadow.radius = 4;
    scene.add(sun);
    const floorTex = canvasTex(512, 512, (c, w, h) => {
      for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? (night ? '#6b4f37' : '#c48a52') : (night ? '#634931' : '#b97f49'); c.fillRect(i * w / 8, 0, w / 8, h); }
      c.strokeStyle = 'rgba(0,0,0,.12)'; c.lineWidth = 2; for (let i = 0; i <= 8; i++) { c.beginPath(); c.moveTo(i * w / 8, 0); c.lineTo(i * w / 8, h); c.stroke(); }
    });
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(2, 2);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 10), new THREE.MeshLambertMaterial({ map: floorTex }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const wallTex = canvasTex(512, 256, (c, w, h) => {
      for (let i = 0; i < 16; i++) { c.fillStyle = i % 2 ? (night ? '#5b4a6b' : '#fde2bd') : (night ? '#554463' : '#fbd9ad'); c.fillRect(i * w / 16, 0, w / 16, h); }
      c.fillStyle = night ? '#3d2f4d' : '#d6a76a'; c.fillRect(0, h - 18, w, 18);
    });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(16, 7), new THREE.MeshLambertMaterial({ map: wallTex }));
    wall.position.set(0, 3.5, -3.2); wall.receiveShadow = true; scene.add(wall);
    const win = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.5), new THREE.MeshBasicMaterial({ map: canvasTex(200, 150, (c, w, h) => {
      const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, night ? '#0f172a' : '#7dd3fc'); g.addColorStop(1, night ? '#1e3a8a' : '#e0f2fe'); c.fillStyle = g; c.fillRect(0, 0, w, h);
      c.fillStyle = night ? '#fef9c3' : '#fde047'; c.beginPath(); c.arc(w * 0.72, h * 0.3, 18, 0, 7); c.fill();
      if (night) { c.fillStyle = '#fff'; for (let i = 0; i < 14; i++) c.fillRect((i * 53) % w, (i * 31) % (h * 0.8), 2, 2); }
      else { c.fillStyle = '#fff'; [[40, 60], [70, 55], [55, 50]].forEach(([x, y]) => { c.beginPath(); c.arc(x, y, 14, 0, 7); c.fill(); }); }
      c.strokeStyle = '#fff'; c.lineWidth = 10; c.strokeRect(0, 0, w, h); c.beginPath(); c.moveTo(w / 2, 0); c.lineTo(w / 2, h); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.lineWidth = 6; c.stroke();
    }) }));
    win.position.set(-3.1, 3.6, -3.18); scene.add(win);
    // camita
    const bedC = cfg.color || '#2563eb';
    const bed = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.32, 14, 32), toon(bedC)); ring.rotation.x = Math.PI / 2; ring.position.y = 0.3; ring.castShadow = true; ring.receiveShadow = true;
    const cush = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.22, 32), toon('#fef3c7')); cush.position.y = 0.16; cush.receiveShadow = true;
    bed.add(ring, cush); bed.position.set(-3.2, 0, -1.2); scene.add(bed);
    // cuenco
    const bowl = new THREE.Group();
    const bw = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.38, 0.32, 28, 1, true), toon('#ef4444', { side: THREE.DoubleSide })); bw.position.y = 0.16; bw.castShadow = true;
    const food = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.04, 28), toon('#a16207')); food.position.y = 0.26;
    bowl.add(bw, food); bowl.position.set(3.2, 0, -1.0); scene.add(bowl);
    // alfombra
    const rug = new THREE.Mesh(new THREE.CircleGeometry(1.7, 40), new THREE.MeshLambertMaterial({ color: night ? 0x3b5bab : 0x7cb3fb })); rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.01, 0.4); rug.scale.y = 0.62; rug.receiveShadow = true; scene.add(rug);
    // pelota
    const ballM = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), toon('#bef264')); ballM.castShadow = true; ballM.visible = false; scene.add(ballM);

    // ---------------- EL PERRO ----------------
    let dog = null, P = {};
    function build(look) {
      if (dog) { scene.remove(dog); dog.traverse((o) => { if (o.material && o.material !== OUT && o.material.dispose) o.material.dispose(); }); }
      const b = look.breed, c = look.color || '#2563eb', g = new Set(look.gear || []);
      const fur = b.fur, dark = b.dark, muz = ['#3a3a3a', '#44444e'].includes(b.muzzle) ? b.muzzle : b.muzzle;
      const darkFur = ['#262626', '#34343c'].includes(fur);
      dog = new THREE.Group(); P = {};
      const bodyP = new THREE.Group(); bodyP.position.y = 1.0; dog.add(bodyP); P.bodyP = bodyP;
      const body = blob(fur, 0.62, 0.58, 0.95, 0, 0, 0); bodyP.add(body); P.body = body;
      if (b.saddle) bodyP.add(blob(b.saddle, 0.6, 0.3, 0.75, 0, 0.32, -0.12, false));
      bodyP.add(blob(darkFur && !b.blaze ? '#6b7280' : (b.blaze || (['#3a3a3a', '#44444e'].includes(b.muzzle) ? fur : b.muzzle)), 0.38, 0.42, 0.3, 0, -0.08, 0.72, false));
      if (b.spots) [[0.4, 0.25, 0.3], [-0.45, 0.1, -0.3], [0.2, 0.4, -0.5], [-0.3, 0.35, 0.4]].forEach(([x, y, z]) => bodyP.add(blob(b.spots, 0.12, 0.1, 0.12, x * 1.0, y, z, false)));
      // patas: grupo con pivote arriba (cadera/hombro)
      P.legs = [];
      [[0.3, 0.55], [-0.3, 0.55], [0.32, -0.55], [-0.32, -0.55]].forEach(([x, z], i) => {
        const L = new THREE.Group(); L.position.set(x, -0.22, z);
        const up = blob(fur, 0.17, 0.42, 0.17, 0, -0.32, 0); L.add(up);
        const paw = blob(g.has('botas') ? c : (darkFur ? '#e5e7eb' : (b.blaze && i < 2 ? '#fafafa' : mix(fur, 0.15))), 0.2, 0.13, 0.26, 0, -0.74, 0.06); L.add(paw);
        bodyP.add(L); P.legs.push(L);
      });
      // cola
      const tailP = new THREE.Group(); tailP.position.set(0, 0.22, -0.86); bodyP.add(tailP); P.tail = tailP;
      const tail = blob(b.saddle || fur, 0.1, 0.42, 0.1, 0, 0.36, 0); tailP.add(tail);
      tailP.add(blob(b.blaze || mix(fur, 0.25), 0.11, 0.13, 0.11, 0, 0.74, 0, false));
      tailP.rotation.x = -0.6;
      // cuello y cabeza
      bodyP.add(blob(fur, 0.36, 0.42, 0.36, 0, 0.42, 0.62));
      const headP = new THREE.Group(); headP.position.set(0, 0.95, 0.8); bodyP.add(headP); P.headP = headP;
      const head = blob(fur, 0.62, 0.58, 0.58, 0, 0, 0); headP.add(head); P.head = head;
      if (b.pom) [[0, 0.58, -0.05, 0.3], [-0.25, 0.48, 0, 0.22], [0.25, 0.48, 0, 0.22]].forEach(([x, y, z, r]) => headP.add(blob(dark, r, r, r, x, y, z)));
      if (b.mask) headP.add(blob(b.mask, 0.5, 0.36, 0.3, 0, -0.12, 0.32, false));
      if (b.blaze) { const bz = blob(b.blaze, 0.1, 0.3, 0.1, 0, 0.16, 0.5, false); bz.rotation.x = -0.35; headP.add(bz); }
      if (b.spots) [[0.32, 0.3, 0.38], [-0.4, 0.05, 0.38], [0.1, 0.48, 0.2]].forEach(([x, y, z]) => headP.add(blob(b.spots, 0.09, 0.08, 0.06, x, y, z, false)));
      headP.add(blob(['#3a3a3a', '#44444e'].includes(b.muzzle) ? b.muzzle : b.muzzle, 0.34, 0.25, 0.3, 0, -0.2, 0.4));
      const nose = blob('#1b1210', 0.11, 0.08, 0.08, 0, -0.1, 0.68, false, new THREE.MeshPhongMaterial({ color: 0x1b1210, shininess: 90 })); headP.add(nose); P.nose = nose;
      // mejillas
      [-1, 1].forEach((s) => { const ck = new THREE.Mesh(geoS, new THREE.MeshBasicMaterial({ color: 0xff8fab, transparent: true, opacity: 0.45 })); ck.scale.set(0.11, 0.06, 0.03); ck.position.set(s * 0.36, -0.13, 0.45); ck.rotation.y = s * 0.6; headP.add(ck); });
      // ojos: brillantes y grandes; versiones cerradas para "feliz" y "dormido"
      P.eyes = []; P.eyesHappy = []; P.eyesSleep = []; P.pupils = [];
      const eyeMat = new THREE.MeshPhongMaterial({ color: hex(b.eye || '#141418'), shininess: 120, specular: 0x666666 });
      const lineMat = new THREE.MeshBasicMaterial({ color: darkFur ? 0xe5e7eb : 0x2a1a10 });
      [-1, 1].forEach((s) => {
        const eg = new THREE.Group(); eg.position.set(s * 0.22, 0.08, 0.5); eg.rotation.y = s * 0.25; headP.add(eg);
        if (b.sclera) { const w = new THREE.Mesh(geoS, new THREE.MeshBasicMaterial({ color: 0xffffff })); w.scale.set(0.15, 0.17, 0.05); eg.add(w); }
        const pup = new THREE.Group(); eg.add(pup); P.pupils.push(pup);
        const e = new THREE.Mesh(geoS, eyeMat); e.scale.set(0.12, 0.14, 0.07); e.position.z = 0.02; pup.add(e);
        const hl = new THREE.Mesh(geoS, new THREE.MeshBasicMaterial({ color: 0xffffff })); hl.scale.setScalar(0.035); hl.position.set(0.035, 0.05, 0.08); pup.add(hl);
        const hl2 = new THREE.Mesh(geoS, new THREE.MeshBasicMaterial({ color: 0xffffff })); hl2.scale.setScalar(0.017); hl2.position.set(-0.03, -0.045, 0.08); pup.add(hl2);
        P.eyes.push(eg);
        const hp = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.022, 8, 16, Math.PI), lineMat); hp.position.set(s * 0.22, 0.06, 0.55); hp.rotation.y = s * 0.25; hp.visible = false; headP.add(hp); P.eyesHappy.push(hp);
        const sl = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.022, 8, 16, Math.PI), lineMat); sl.position.set(s * 0.22, 0.1, 0.55); sl.rotation.set(0, s * 0.25, Math.PI); sl.visible = false; headP.add(sl); P.eyesSleep.push(sl);
      });
      // boca: sonrisa / abierta / lengua
      const smile = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.018, 8, 16, Math.PI), new THREE.MeshBasicMaterial({ color: 0x2a1a10 })); smile.position.set(0, -0.3, 0.6); smile.rotation.z = Math.PI; headP.add(smile); P.smile = smile;
      const mouth = new THREE.Mesh(geoS, new THREE.MeshBasicMaterial({ color: 0x7f1d1d })); mouth.scale.set(0.09, 0.08, 0.04); mouth.position.set(0, -0.32, 0.6); mouth.visible = false; headP.add(mouth); P.mouth = mouth;
      const tongue = new THREE.Mesh(geoS, toon('#fb7185')); tongue.scale.set(0.07, 0.09, 0.03); tongue.position.set(0, -0.4, 0.6); tongue.visible = false; headP.add(tongue); P.tongue = tongue;
      // orejas
      P.ears = [];
      [-1, 1].forEach((s) => {
        const E = new THREE.Group(); E.position.set(s * 0.42, 0.3, -0.02); headP.add(E); P.ears.push(E);
        const ec = dark, inC = '#f9b4c0';
        if (b.ear === 'pointy' || b.ear === 'big' || b.ear === 'semi') {
          const big = b.ear === 'big' ? 1.45 : 1;
          const cone = new THREE.Mesh(new THREE.ConeGeometry(0.2 * big, 0.5 * big, 14), toon(ec)); cone.position.y = 0.24 * big; cone.rotation.z = -s * 0.32; cone.castShadow = true;
          const o = new THREE.Mesh(cone.geometry, OUT); o.scale.setScalar(1.08); cone.add(o);
          const inn = new THREE.Mesh(new THREE.ConeGeometry(0.12 * big, 0.34 * big, 12), toon(inC)); inn.position.set(0, -0.02, 0.07); inn.scale.z = 0.4; cone.add(inn);
          if (b.ear === 'semi') { const tip = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.2, 10), toon(ec)); tip.position.set(0, 0.24, 0.06); tip.rotation.x = 1.2; cone.add(tip); }
          E.add(cone);
        } else if (b.ear === 'small') {
          const cone = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.25, 12), toon(ec)); cone.position.set(0, 0.08, 0.05); cone.rotation.set(0.9, 0, -s * 0.8); E.add(cone);
        } else if (b.ear === 'fluffy') {
          [[0, -0.1, 0.24], [0, -0.38, 0.22], [s * 0.05, -0.62, 0.18]].forEach(([x, y, r]) => E.add(blob(ec, r, r, r * 0.8, x, y, 0)));
        } else {
          const len = b.ear === 'long' ? 0.62 : 0.46;
          const ear = blob(ec, 0.17, len, 0.09, s * 0.05, -len * 0.75, 0.02); ear.rotation.z = s * 0.18; E.add(ear);
        }
        if (s < 0 && g.has('lazo')) { E.add(blob('#f472b6', 0.1, 0.08, 0.06, -0.06, 0.05, 0.12, false)); E.add(blob('#f472b6', 0.1, 0.08, 0.06, 0.1, 0.05, 0.12, false)); }
      });
      // accesorios
      const neckY = 0.66, neckZ = 0.62;
      if (g.has('collar')) { const col = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.06, 10, 28), toon('#dc2626')); col.position.set(0, neckY, neckZ); col.rotation.x = Math.PI / 2 - 0.35; bodyP.add(col); }
      if (g.has('chapa')) bodyP.add(blob('#facc15', 0.08, 0.08, 0.03, 0, neckY - 0.18, neckZ + 0.35, false, new THREE.MeshPhongMaterial({ color: 0xfacc15, shininess: 100 })));
      if (g.has('panuelo')) { const pn = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.5, 3), toon(c)); pn.position.set(0, neckY - 0.25, neckZ + 0.22); pn.rotation.set(Math.PI + 0.3, 0, 0); pn.scale.z = 0.35; bodyP.add(pn); }
      if (g.has('pajarita')) [-1, 1].forEach((s) => { const bt = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.22, 4), toon(c)); bt.position.set(s * 0.12, neckY - 0.1, neckZ + 0.36); bt.rotation.z = s * Math.PI / 2; bodyP.add(bt); });
      if (g.has('gorra') && !g.has('corona')) { const cap = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), toon(c)); cap.position.set(0, 0.32, 0); headP.add(cap); const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 20), toon(c)); brim.position.set(0, 0.34, 0.45); brim.scale.z = 1.2; headP.add(brim); }
      if (g.has('corona')) { const cr = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.22, 16, 1, true), new THREE.MeshPhongMaterial({ color: 0xfacc15, shininess: 110, side: THREE.DoubleSide })); cr.position.set(0, 0.62, 0); headP.add(cr);
        for (let i = 0; i < 6; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.14, 6), new THREE.MeshPhongMaterial({ color: 0xfacc15, shininess: 110 })); const a = i / 6 * Math.PI * 2; sp.position.set(Math.sin(a) * 0.28, 0.79, Math.cos(a) * 0.28); headP.add(sp); } }
      if (g.has('fiesta') && !g.has('corona') && !g.has('gorra')) { const hat = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.6, 16), toon(c)); hat.position.set(0.15, 0.78, 0); hat.rotation.z = -0.2; headP.add(hat); headP.add(blob('#facc15', 0.08, 0.08, 0.08, 0.22, 1.08, 0, false)); }
      if (g.has('vaquero') && !g.has('corona') && !g.has('gorra') && !g.has('fiesta')) { const br = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.05, 28), toon('#92400e')); br.position.set(0, 0.48, 0); headP.add(br); const cw = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 0.4, 20), toon('#b45309')); cw.position.set(0, 0.7, 0); headP.add(cw); }
      if (g.has('gafas')) [-1, 1].forEach((s) => { const gl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.05), new THREE.MeshPhongMaterial({ color: 0x111111, shininess: 120 })); gl.position.set(s * 0.22, 0.08, 0.6); gl.rotation.y = s * 0.25; headP.add(gl); });
      if (g.has('cascos')) { const band = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.05, 8, 24, Math.PI), toon('#111111')); band.position.set(0, 0.05, 0); headP.add(band); [-1, 1].forEach((s) => { const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.14, 16), toon(c)); cup.rotation.z = Math.PI / 2; cup.position.set(s * 0.62, 0.02, 0); headP.add(cup); }); }
      if (g.has('dino')) for (let i = 0; i < 6; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.24, 6), toon('#4ade80')); sp.position.set(0, i < 2 ? 0.62 - i * 0.05 : 0.55, i < 2 ? 0.1 - i * 0.25 : 0.3 - i * 0.22); if (i >= 2) bodyP.add(sp); else headP.add(sp); }
      if (g.has('capa')) { const cp = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.2), toon(c, { side: THREE.DoubleSide })); cp.position.set(0, 0.2, -0.55); cp.rotation.x = 0.5; bodyP.add(cp); P.cape = cp; }
      if (g.has('alas')) [-1, 1].forEach((s) => { const w = blob('#ffffff', 0.08, 0.32, 0.5, s * 0.66, 0.35, -0.1); w.rotation.z = s * 0.6; bodyP.add(w); (P.wings = P.wings || []).push(w); });
      if (g.has('mochila')) { const mb = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.32, 0.5), toon(c)); mb.position.set(0, 0.55, -0.15); bodyP.add(mb); }
      dog.traverse((o) => { if (o.isMesh && o.material !== OUT) o.castShadow = true; });
      dog.position.set(0, 0, 0.6);
      scene.add(dog);
      setFace(cur.face);
    }
    function mix(c, k) { const a = hex(c), w = new THREE.Color(0xffffff); a.lerp(w, k); return '#' + a.getHexString(); }

    // ---------------- ESTADO Y ANIMACIÓN ----------------
    const cur = { face: cfg.face || 'normal', pose: 'sit', moving: false, wag: 1 };
    const S = {
      pos: new THREE.Vector3(0, 0, 0.6), target: null, speed: 0, yaw: 0, yawT: 0,
      sit: 1, lie: 0, belly: 0, walkPh: 0, jumpY: 0, spinY: 0, flip: 0, roll: 0, headX: 0, headY: 0, headZ: 0, lookX: 0, lookY: 0,
      blinkT: 2, blink: 0, wagSpeed: 6, wagAmp: 0.5, earWob: 0, sniff: 0, beg: 0, dig: 0, scratch: 0, mouthOpen: 0, eat: 0, bob: 0,
    };
    function setFace(f) {
      cur.face = f;
      if (!P.eyes) return;
      const open = f === 'normal' || f === 'wow' || f === 'sad' || f === 'bored';
      P.eyes.forEach((e) => { e.visible = open; });
      P.eyesHappy.forEach((e) => { e.visible = f === 'happy'; });
      P.eyesSleep.forEach((e) => { e.visible = f === 'sleep'; });
      P.mouth.visible = f === 'wow';
      P.tongue.visible = f === 'happy';
      P.smile.visible = f !== 'wow';
      P.smile.rotation.z = f === 'sad' ? 0 : Math.PI;
      P.eyes.forEach((e) => { e.scale.y = f === 'bored' ? 0.55 : 1; });
    }
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
        P.pupils.forEach((pp) => { pp.position.x = clamp(S.lookX * 0.03, -0.03, 0.03); pp.position.y = clamp(-S.lookY * 0.04, -0.03, 0.03); });
        // parpadeo
        const bl = 1 - Math.sin(S.blink * Math.PI) * 0.92;
        P.eyes.forEach((e) => { e.scale.y = (cur.face === 'bored' ? 0.55 : 1) * bl; });
        // boca
        P.mouth.visible = cur.face === 'wow' || S.mouthOpen > 0.1; P.mouth.scale.y = 0.05 + S.mouthOpen * 0.06 + (cur.face === 'wow' ? 0.04 : 0);
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
