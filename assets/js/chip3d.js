/* =====================================================================
   Section 03: MNEMOS-1 — 3D chip, scroll-driven walkthrough.
   Layers (bottom → top): synaptic memory arrays, neuron circuits,
   spike router mesh, plasticity engine / I/O ring, then the lid.
   ===================================================================== */
(function () {
  "use strict";
  const THREE = window.THREE;
  const DUME = window.DUME;
  const canvas = document.getElementById("chip3d");
  if (!THREE || !canvas) return;
  const stage = canvas.parentElement;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (e) {
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(4.2, 3.4, 4.6);
  const look = new THREE.Vector3(0, 0.2, 0);

  // soft studio environment for the metal lid
  (function env() {
    const pm = new THREE.PMREMGenerator(renderer);
    const es = new THREE.Scene();
    const room = new THREE.Mesh(new THREE.BoxGeometry(20, 12, 20), new THREE.MeshBasicMaterial({ color: 0x111111, side: THREE.BackSide }));
    es.add(room);
    const box = (w, h, x, y, z, ry, c) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      es.add(m);
    };
    box(8, 3, 0, 5.5, 0, 0, 0xffffff);
    box(3, 6, -9, 1, 2, 0, 0x9a9a9a);
    box(3, 6, 9, 1, -3, 0, 0x555555);
    scene.environment = pm.fromScene(es, 0.04).texture;
    pm.dispose();
  })();

  scene.add(new THREE.AmbientLight(0xffffff, 0.28));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(4, 7, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xfff4e6, 0.6);
  rim.position.set(-5, 2, -4);
  scene.add(rim);

  const chip = new THREE.Group();
  scene.add(chip);

  const BONE = new THREE.Color(0xece8e1);
  const G = 8;               // 8 x 8 neuro-cores
  const PITCH = 0.235;
  const tilePos = (i, j) => [(i - (G - 1) / 2) * PITCH, (j - (G - 1) / 2) * PITCH];

  // ---------------------------------------------------------------
  // Canvas textures
  // ---------------------------------------------------------------
  function canvasTex(size, draw) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    draw(c.getContext("2d"), size);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    return t;
  }

  const xbarTex = canvasTex(128, (g, s) => {
    g.fillStyle = "#262626";
    g.fillRect(0, 0, s, s);
    g.strokeStyle = "#8c8984";
    g.lineWidth = 2;
    for (let k = 0; k < 8; k++) {
      const p = 12 + k * 14.8;
      g.beginPath(); g.moveTo(6, p); g.lineTo(s - 6, p); g.stroke();
      g.beginPath(); g.moveTo(p, 6); g.lineTo(p, s - 6); g.stroke();
    }
    g.fillStyle = "#ffffff";
    for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) {
      g.globalAlpha = 0.35 + Math.random() * 0.65;
      g.fillRect(12 + a * 14.8 - 3.5, 12 + b * 14.8 - 3.5, 7, 7);
    }
    g.globalAlpha = 1;
    g.strokeStyle = "#ffffff";
    g.lineWidth = 3;
    g.strokeRect(2, 2, s - 4, s - 4);
  });

  const substrateTex = canvasTex(512, (g, s) => {
    g.fillStyle = "#131313";
    g.fillRect(0, 0, s, s);
    g.strokeStyle = "rgba(236,232,225,0.13)";
    g.lineWidth = 1.4;
    let seed = 9;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 140; k++) {
      // fan-out traces from the die edge to the package edge
      const side = k % 4, t = r();
      let x = s / 2 + (t - 0.5) * s * 0.66, y = s * 0.17;
      let ex = s / 2 + (t - 0.5) * s * 0.96, ey = 6;
      g.save();
      g.translate(s / 2, s / 2);
      g.rotate((side * Math.PI) / 2);
      g.translate(-s / 2, -s / 2);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, y - 20 - r() * 20);
      g.lineTo(ex, ey + 24);
      g.lineTo(ex, ey);
      g.stroke();
      g.restore();
    }
  });

  const lidTex = canvasTex(1024, (g, s) => drawLid(g, s));
  function drawLid(g, s) {
    const grad = g.createLinearGradient(0, 0, s, s);
    grad.addColorStop(0, "#e2ddd5");
    grad.addColorStop(0.5, "#cfcac2");
    grad.addColorStop(1, "#dcd7cf");
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    // brushed metal
    for (let y = 0; y < s; y += 2) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? "255,255,255" : "0,0,0"},${Math.random() * 0.035})`;
      g.fillRect(0, y, s, 1);
    }
    const ink = "#2b2a28";
    // mark
    const M = window.DUME_MARK && window.DUME_MARK.full;
    if (M) {
      const ox = s * 0.14, oy = s * 0.14, sc = s * 0.0032;
      g.strokeStyle = ink;
      g.lineWidth = 3.2;
      g.lineCap = "round";
      g.beginPath();
      M.edges.forEach(([a, b]) => {
        g.moveTo(ox + M.nodes[a][0] * sc, oy + M.nodes[a][1] * sc);
        g.lineTo(ox + M.nodes[b][0] * sc, oy + M.nodes[b][1] * sc);
      });
      g.stroke();
    }
    g.fillStyle = ink;
    g.textBaseline = "alphabetic";
    g.font = '500 44px "Montserrat", sans-serif';
    g.fillText("DUM-E LABS", s * 0.5, s * 0.255);
    g.font = '300 150px "Montserrat", sans-serif';
    g.fillText("MNEMOS-1", s * 0.14, s * 0.62);
    g.font = '400 30px "JetBrains Mono", monospace';
    g.fillText("NEUROMORPHIC · COMPUTE-IN-MEMORY", s * 0.145, s * 0.7);
    g.fillText("0 GB DRAM · 20–40 W · ES-00", s * 0.145, s * 0.75);
    // pin-1 marker
    g.beginPath();
    g.moveTo(s * 0.08, s * 0.92);
    g.lineTo(s * 0.13, s * 0.92);
    g.lineTo(s * 0.08, s * 0.87);
    g.closePath();
    g.fill();
  }
  if (document.fonts && document.fonts.load) {
    Promise.all([
      document.fonts.load('300 150px "Montserrat"'),
      document.fonts.load('500 44px "Montserrat"'),
      document.fonts.load('400 30px "JetBrains Mono"'),
    ]).then(() => {
      drawLid(lidTex.image.getContext("2d"), lidTex.image.width);
      lidTex.needsUpdate = true;
    }).catch(() => {});
  }

  const glowTex = canvasTex(64, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, "rgba(255,255,255,1)");
    r.addColorStop(0.3, "rgba(255,250,240,0.6)");
    r.addColorStop(1, "rgba(255,250,240,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, s, s);
  });

  // ---------------------------------------------------------------
  // Package
  // ---------------------------------------------------------------
  const side = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.6, metalness: 0.2 });
  const substrate = new THREE.Mesh(
    new THREE.BoxGeometry(3, 0.16, 3),
    [side, side, new THREE.MeshStandardMaterial({ map: substrateTex, roughness: 0.55, metalness: 0.15 }), side, side, side]
  );
  chip.add(substrate);
  const subEdges = new THREE.LineSegments(new THREE.EdgesGeometry(substrate.geometry), new THREE.LineBasicMaterial({ color: BONE, transparent: true, opacity: 0.28 }));
  substrate.add(subEdges);

  const balls = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.05, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0xbdb8b0, metalness: 0.9, roughness: 0.3 }),
    14 * 14
  );
  {
    const m = new THREE.Matrix4();
    let k = 0;
    for (let i = 0; i < 14; i++) for (let j = 0; j < 14; j++) {
      m.makeTranslation((i - 6.5) * 0.2, -0.11, (j - 6.5) * 0.2);
      balls.setMatrixAt(k++, m);
    }
  }
  chip.add(balls);

  // ---------------------------------------------------------------
  // Layers
  // ---------------------------------------------------------------
  const layers = [];
  function makeLayer(name) {
    const g = new THREE.Group();
    g.userData = { name, mats: [], y: 0, op: 1 };
    chip.add(g);
    layers.push(g);
    return g;
  }
  function track(layer, mat, base) {
    mat.transparent = true;
    mat.userData.base = base == null ? (mat.opacity == null ? 1 : mat.opacity) : base;
    layer.userData.mats.push(mat);
    return mat;
  }
  function slab(layer, w, h, color, op) {
    const mat = track(layer, new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.3, opacity: op }), op);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat);
    layer.add(mesh);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), track(layer, new THREE.LineBasicMaterial({ color: BONE, opacity: 0.35 }), 0.35));
    mesh.add(e);
    return mesh;
  }

  // L0 — synaptic memory arrays
  const L0 = makeLayer("Synaptic memory arrays");
  slab(L0, 2.02, 0.05, 0x0d0d0d, 1);
  const tileMat = track(L0, new THREE.MeshBasicMaterial({ map: xbarTex, opacity: 1 }), 1);
  const tiles = new THREE.InstancedMesh(new THREE.BoxGeometry(0.205, 0.024, 0.205), tileMat, G * G);
  const weight = new Float32Array(G * G);
  const tileAct = new Float32Array(G * G);
  {
    const m = new THREE.Matrix4();
    for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) {
      const [x, z] = tilePos(i, j);
      m.makeTranslation(x, 0.037, z);
      tiles.setMatrixAt(i * G + j, m);
      weight[i * G + j] = 0.25 + Math.random() * 0.75;
      tiles.setColorAt(i * G + j, new THREE.Color(0.5, 0.5, 0.5));
    }
  }
  L0.add(tiles);

  // L1 — neuron circuits
  const L1 = makeLayer("Neuron circuits");
  slab(L1, 2.02, 0.035, 0x101010, 0.92);
  const neuronMat = track(L1, new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 1 }), 1);
  const neurons = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.045, 0.045, 0.07, 18), neuronMat, G * G);
  const nAct = new Float32Array(G * G);
  {
    const m = new THREE.Matrix4();
    for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) {
      const [x, z] = tilePos(i, j);
      m.makeTranslation(x, 0.05, z);
      neurons.setMatrixAt(i * G + j, m);
      neurons.setColorAt(i * G + j, new THREE.Color(0.2, 0.2, 0.2));
    }
  }
  L1.add(neurons);

  // L2 — spike router mesh
  const L2 = makeLayer("Spike router mesh");
  slab(L2, 2.02, 0.02, 0x0f0f0f, 0.35);
  {
    const pts = [];
    for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) {
      const [x, z] = tilePos(i, j);
      if (i < G - 1) { const [x2] = tilePos(i + 1, j); pts.push(new THREE.Vector3(x, 0.02, z), new THREE.Vector3(x2, 0.02, z)); }
      if (j < G - 1) { const [, z2] = tilePos(i, j + 1); pts.push(new THREE.Vector3(x, 0.02, z), new THREE.Vector3(x, 0.02, z2)); }
    }
    L2.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), track(L2, new THREE.LineBasicMaterial({ color: BONE, opacity: 0.45 }), 0.45)));
    const routers = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.05, 0.03, 0.05),
      track(L2, new THREE.MeshStandardMaterial({ color: 0xd9d4cc, roughness: 0.4, metalness: 0.6, opacity: 1 }), 1),
      G * G
    );
    const m = new THREE.Matrix4();
    for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) {
      const [x, z] = tilePos(i, j);
      m.makeTranslation(x, 0.025, z);
      routers.setMatrixAt(i * G + j, m);
    }
    L2.add(routers);
  }
  const MAXPK = 90;
  const packets = [];
  const pkPos = new Float32Array(MAXPK * 3);
  const pkGeo = new THREE.BufferGeometry();
  const pkAttr = new THREE.BufferAttribute(pkPos, 3).setUsage(THREE.DynamicDrawUsage);
  pkGeo.setAttribute("position", pkAttr);
  const pkMat = track(L2, new THREE.PointsMaterial({ map: glowTex, size: 0.16, color: 0xffffff, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 1 }), 1);
  const pkPoints = new THREE.Points(pkGeo, pkMat);
  pkPoints.frustumCulled = false;
  L2.add(pkPoints);

  // L3 — plasticity engine + I/O ring
  const L3 = makeLayer("Plasticity engine · I/O ring");
  const ringMat = track(L3, new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5, metalness: 0.4, opacity: 1 }), 1);
  [[0, 1.04, 2.12, 0.1], [0, -1.04, 2.12, 0.1], [1.04, 0, 0.1, 2.12], [-1.04, 0, 0.1, 2.12]].forEach(([x, z, w, d]) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), ringMat);
    b.position.set(x, 0, z);
    L3.add(b);
  });
  const padMat = track(L3, new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 1 }), 1);
  const pads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.02, 0.06), padMat, 64);
  const padAct = new Float32Array(64);
  {
    const m = new THREE.Matrix4();
    for (let k = 0; k < 64; k++) {
      const s = k >> 4, t = ((k % 16) - 7.5) * 0.125;
      const [x, z] = [[t, 1.04], [t, -1.04], [1.04, t], [-1.04, t]][s];
      m.makeTranslation(x, 0.035, z);
      pads.setMatrixAt(k, m);
      pads.setColorAt(k, new THREE.Color(0.3, 0.3, 0.3));
    }
  }
  L3.add(pads);
  const l3Edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(2.18, 0.06, 2.18)),
    track(L3, new THREE.LineBasicMaterial({ color: BONE, opacity: 0.3 }), 0.3)
  );
  L3.add(l3Edges);

  // Lid
  const lidSide = new THREE.MeshStandardMaterial({ color: 0xd0cbc3, metalness: 0.85, roughness: 0.32, transparent: true });
  const lidTop = new THREE.MeshStandardMaterial({ map: lidTex, metalness: 0.6, roughness: 0.38, transparent: true });
  const lid = new THREE.Mesh(new THREE.BoxGeometry(2.32, 0.1, 2.32), [lidSide, lidSide, lidTop, lidSide, lidSide, lidSide]);
  chip.add(lid);

  // ---------------------------------------------------------------
  // States per scroll step
  // ---------------------------------------------------------------
  const STATES = [
    { ex: 0, lidOp: 1, cam: [4.3, 3.5, 4.7], look: [0, 0.15, 0], focus: -1, mode: "idle", hud: "MNEMOS-1 · assembled" },
    { ex: 1, lidOp: 0, cam: [4.6, 3.5, 4.8], look: [0, 0.9, 0], focus: -1, mode: "idle", labels: [0, 1, 2, 3], hud: "Exploded view · four layers" },
    { ex: 1, lidOp: 0, cam: [2.8, 2.6, 3.1], look: [0, 0.3, 0], focus: 0, mode: "weights", labels: [0], hud: "Weights stored as conductance G" },
    { ex: 1, lidOp: 0, cam: [2.5, 2.8, 2.7], look: [0, 0.3, 0], focus: 0, mode: "mvm", labels: [0], hud: "I = G·V · ΣI — multiply-accumulate in place" },
    { ex: 1, lidOp: 0, cam: [2.6, 2.8, 2.9], look: [0, 0.75, 0], focus: 1, mode: "fire", labels: [1], hud: "Neurons integrate & fire" },
    { ex: 1, lidOp: 0, cam: [2.9, 3.5, 3.1], look: [0, 1.25, 0], focus: 2, mode: "route", labels: [2], hud: "Spike router · only events travel" },
    { ex: 1, lidOp: 0, cam: [4.8, 3.6, 5.0], look: [0, 0.95, 0], focus: -1, mode: "learn", labels: [3], hud: "Plasticity engine · weights adapting live" },
    { ex: 0.55, lidOp: 0, cam: [4.4, 3.2, 4.6], look: [0, 0.6, 0], focus: 0, mode: "off", labels: [0], hud: "Power 0 W · weights retained" },
  ];
  const ASM = [0.115, 0.165, 0.205, 0.24];
  const EXP = [0.25, 0.75, 1.25, 1.72];
  let step = 0;
  const cur = { ex: 0, lidOp: 1, power: 1, cam: new THREE.Vector3(4.3, 3.5, 4.7), look: new THREE.Vector3(0, 0.15, 0) };

  const hudText = document.getElementById("chipHudText");
  const labelWrap = document.getElementById("chipLabels");
  const labelEls = [...labelWrap.querySelectorAll("span")];
  function setStep(k) {
    if (k === step) return;
    step = k;
    hudText.textContent = STATES[k].hud;
    document.querySelectorAll(".story .step").forEach((s) => s.classList.toggle("is-active", +s.dataset.step === k));
  }
  // on phones the sticky chip covers the top half, so read steps lower down
  const stacked = window.matchMedia("(max-width: 860px)").matches;
  const stepIO = new IntersectionObserver(
    (entries) => entries.forEach((en) => { if (en.isIntersecting) setStep(+en.target.dataset.step); }),
    { rootMargin: stacked ? "-62% 0px -18% 0px" : "-48% 0px -48% 0px" }
  );
  document.querySelectorAll(".story .step").forEach((s) => stepIO.observe(s));
  document.querySelector('.story .step[data-step="0"]').classList.add("is-active");

  // ---------------------------------------------------------------
  // Animation
  // ---------------------------------------------------------------
  const col = new THREE.Color();
  const v3 = new THREE.Vector3();
  let mvmRow = 0, mvmT = 0, t0 = 0;
  const mouse = { x: 0, y: 0 };
  stage.addEventListener("pointermove", (e) => {
    const r = stage.getBoundingClientRect();
    mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    mouse.y = ((e.clientY - r.top) / r.height) * 2 - 1;
  });

  function spawnPacket(i, j) {
    if (packets.length >= MAXPK) return;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const d = dirs[(Math.random() * 4) | 0];
    const ni = Math.max(0, Math.min(G - 1, i + d[0])), nj = Math.max(0, Math.min(G - 1, j + d[1]));
    packets.push({ i, j, ni, nj, t: 0, hops: 3 + ((Math.random() * 6) | 0) });
  }

  let zoomOut = 1.3;
  function resize() {
    const r = stage.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / Math.max(1, r.height);
    camera.fov = 38;
    camera.updateProjectionMatrix();
    zoomOut = Math.max(1.25, 1.2 / camera.aspect);
  }
  window.addEventListener("resize", resize);
  resize();

  function frame(dt, t) {
    const S = STATES[step];
    const k = 1 - Math.pow(0.03, dt); // smoothing
    cur.ex += (S.ex - cur.ex) * k;
    cur.lidOp += (S.lidOp - cur.lidOp) * k;
    cur.power += ((S.mode === "off" ? 0 : 1) - cur.power) * k * 0.7;
    cur.cam.lerp(v3.set(...S.cam), k * 0.8);
    cur.look.lerp(v3.set(...S.look), k * 0.8);
    camera.position.copy(cur.cam).multiplyScalar(zoomOut);
    camera.position.x += mouse.x * 0.25;
    camera.position.y -= mouse.y * 0.15;
    camera.lookAt(cur.look);

    if (!DUME.reduced) chip.rotation.y = Math.sin(t * 0.18) * 0.32;

    // layer heights & focus opacity
    layers.forEach((L, i) => {
      L.position.y = ASM[i] + (EXP[i] - ASM[i]) * cur.ex;
      const target = S.focus < 0 || S.focus === i ? 1 : 0.16;
      L.userData.op += (target - L.userData.op) * k;
      L.userData.mats.forEach((m) => { m.opacity = m.userData.base * L.userData.op; });
    });
    lid.position.y = 0.33 + cur.ex * 2.15 + (1 - cur.lidOp) * 0.6;
    lidSide.opacity = lidTop.opacity = cur.lidOp;
    lid.visible = cur.lidOp > 0.02;
    key.intensity = 0.5 + 0.9 * cur.power;

    // activity
    const mode = S.mode;
    const P = cur.power;
    mvmT += dt;
    if (mode === "mvm" && mvmT > 0.16) { mvmT = 0; mvmRow = (mvmRow + 1) % (G + 3); }

    for (let n = 0; n < G * G; n++) {
      const i = (n / G) | 0, j = n % G;
      // background sparse activity
      if (!DUME.reduced && Math.random() < dt * (mode === "fire" || mode === "route" ? 1.4 : 0.5) * P) {
        nAct[n] = 1;
        if (mode !== "weights") spawnPacket(i, j);
      }
      if (mode === "mvm" && j === mvmRow) tileAct[n] = 1;
      if (mode === "mvm" && mvmRow === G && Math.random() < 0.5) nAct[n] = 1;
      if (mode === "learn" && Math.random() < dt * 0.9) {
        weight[n] = Math.max(0.12, Math.min(1, weight[n] + (Math.random() - 0.5) * 0.5));
        tileAct[n] = 0.7;
      }
      tileAct[n] *= Math.pow(0.02, dt);
      nAct[n] *= Math.pow(0.004, dt);

      let tb;
      if (mode === "off") tb = 0.18 + weight[n] * 0.32;               // retained, unpowered
      else if (mode === "weights") tb = 0.15 + weight[n] * 0.95;       // show the stored pattern
      else tb = (0.25 + weight[n] * 0.5) * (0.55 + 0.45 * P) + tileAct[n] * 0.9;
      tiles.setColorAt(n, col.setScalar(Math.min(1.4, tb)));
      const nb = (0.12 + nAct[n] * 1.2) * P;
      neurons.setColorAt(n, col.setScalar(Math.min(1.3, nb)));
    }
    tiles.instanceColor.needsUpdate = true;
    neurons.instanceColor.needsUpdate = true;

    for (let p = 0; p < 64; p++) {
      if (!DUME.reduced && Math.random() < dt * (mode === "learn" ? 4 : 0.6) * P) padAct[p] = 1;
      padAct[p] *= Math.pow(0.02, dt);
      pads.setColorAt(p, col.setScalar((0.22 + padAct[p]) * (0.3 + 0.7 * P)));
    }
    pads.instanceColor.needsUpdate = true;

    // packets
    const speed = mode === "route" ? 3.4 : 2.2;
    for (let q = packets.length - 1; q >= 0; q--) {
      const pk = packets[q];
      pk.t += dt * speed;
      if (pk.t >= 1) {
        if (--pk.hops <= 0 || P < 0.2) { packets.splice(q, 1); continue; }
        pk.i = pk.ni; pk.j = pk.nj; pk.t = 0;
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        const d = dirs[(Math.random() * 4) | 0];
        pk.ni = Math.max(0, Math.min(G - 1, pk.i + d[0]));
        pk.nj = Math.max(0, Math.min(G - 1, pk.j + d[1]));
      }
    }
    for (let q = 0; q < MAXPK; q++) {
      const pk = packets[q];
      if (!pk) { pkPos[q * 3 + 1] = -99; continue; }
      const [x1, z1] = tilePos(pk.i, pk.j), [x2, z2] = tilePos(pk.ni, pk.nj);
      pkPos[q * 3] = x1 + (x2 - x1) * pk.t;
      pkPos[q * 3 + 1] = 0.05;
      pkPos[q * 3 + 2] = z1 + (z2 - z1) * pk.t;
    }
    pkAttr.needsUpdate = true;

    // HTML labels anchored to layer corners
    const rect = stage.getBoundingClientRect();
    labelEls.forEach((el) => {
      const li = +el.dataset.layer;
      const on = S.labels && S.labels.includes(li) && cur.ex > 0.6;
      el.style.opacity = on ? "1" : "0";
      if (!on) return;
      v3.set(1.02, 0.02, 1.02);
      layers[li].localToWorld(v3);
      v3.project(camera);
      const x = (v3.x * 0.5 + 0.5) * rect.width, y = (-v3.y * 0.5 + 0.5) * rect.height;
      const w = el.offsetWidth;
      let lx = x + 14;
      if (lx + w > rect.width - 8) lx = Math.max(8, x - w - 14); // keep inside the stage
      el.style.transform = `translate(${lx.toFixed(1)}px, ${(y - 12).toFixed(1)}px)`;
    });

    renderer.render(scene, camera);
  }

  DUME.loop(stage, frame, "200px");
})();
