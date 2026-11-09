/* =====================================================================
   Hero: a 3D neural brain.
   ~4k "neurons" sampled on a procedural brain surface (hemispheres,
   temporal lobes, cerebellum, brain stem), wired to their nearest
   neighbours, with spike pulses random-walking through the network.
   ===================================================================== */
(function () {
  "use strict";
  const THREE = window.THREE;
  const DUME = window.DUME || { heroVis: 1, reduced: false };
  const canvas = document.getElementById("brain3d");
  if (!THREE || !canvas) return;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch (e) {
    canvas.remove();
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 0, 7);

  const root = new THREE.Group();
  const brain = new THREE.Group();
  root.add(brain);
  scene.add(root);

  const BONE = new THREE.Color(0xece8e1);

  // ---------------------------------------------------------------
  // Procedural brain surface
  // ---------------------------------------------------------------
  // x = lateral, y = up, z = anterior (front)
  const parts = [
    { c: [0.4, 0.1, 0.0], r: [0.42, 0.62, 1.0], n: 1500 },     // right hemisphere
    { c: [-0.4, 0.1, 0.0], r: [0.42, 0.62, 1.0], n: 1500 },    // left hemisphere
    { c: [0.52, -0.3, 0.18], r: [0.27, 0.27, 0.56], n: 330 },  // temporal lobes
    { c: [-0.52, -0.3, 0.18], r: [0.27, 0.27, 0.56], n: 330 },
    { c: [0.26, -0.5, -0.66], r: [0.31, 0.22, 0.3], n: 260 },  // cerebellum
    { c: [-0.26, -0.5, -0.66], r: [0.31, 0.22, 0.3], n: 260 },
    { c: [0, -0.7, -0.3], r: [0.13, 0.44, 0.14], n: 110 },     // brain stem
  ];

  let seed = 1337;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  function inside(p, part, k) {
    const dx = (p[0] - part.c[0]) / part.r[0];
    const dy = (p[1] - part.c[1]) / part.r[1];
    const dz = (p[2] - part.c[2]) / part.r[2];
    return dx * dx + dy * dy + dz * dz < k;
  }

  function deform(p) {
    let [x, y, z] = p;
    const zn = Math.max(-1, Math.min(1, z));
    x *= 1 + 0.1 * -zn;                         // wider at the back (parietal)
    if (zn > 0) y -= 0.12 * zn * zn * (y > 0 ? 1 : 0.2); // frontal lobe slopes down
    if (y < -0.18 && Math.abs(x) > 0.15) y = -0.18 + (y + 0.18) * 0.85; // flatter base
    // gyri / sulci folding
    const fold = 0.028 * Math.sin(9 * x + 3 * Math.sin(5 * z)) * Math.sin(8 * y + 2.5 * z) +
      0.016 * Math.sin(17 * z + 4 * y);
    const len = Math.hypot(x, y * 1.2, z) || 1;
    return [x + (x / len) * fold, y + (y / len) * fold, z + (z / len) * fold];
  }

  const pts = [];
  const isDeep = [];
  parts.forEach((part, pi) => {
    let made = 0, guard = 0;
    while (made < part.n && guard++ < part.n * 20) {
      // random direction on the unit sphere
      const u = rand() * 2 - 1, th = rand() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const p = [part.c[0] + part.r[0] * s * Math.cos(th), part.c[1] + part.r[1] * u, part.c[2] + part.r[2] * s * Math.sin(th)];
      if (parts.some((o, oi) => oi !== pi && inside(p, o, 0.94))) continue;
      // keep a thin longitudinal fissure between hemispheres
      if (pi < 2 && Math.abs(p[0]) < 0.035 && p[1] > -0.1) continue;
      pts.push(deform(p));
      isDeep.push(0);
      made++;
    }
  });
  // a sprinkle of deep neurons (white-matter relay nodes)
  for (let i = 0; i < 260; i++) {
    const h = i % 2 ? 1 : -1;
    const p = [h * (0.38 + (rand() - 0.5) * 0.45), 0.05 + (rand() - 0.5) * 0.7, (rand() - 0.5) * 1.5];
    if (!inside(p, parts[i % 2 ? 0 : 1], 0.55)) continue;
    pts.push(deform(p));
    isDeep.push(1);
  }
  const N = pts.length;

  // ---------------------------------------------------------------
  // Wiring: k nearest neighbours via a spatial hash
  // ---------------------------------------------------------------
  const R = 0.15, K = 3;
  const grid = new Map();
  const key = (x, y, z) => `${Math.floor(x / R)},${Math.floor(y / R)},${Math.floor(z / R)}`;
  pts.forEach((p, i) => {
    const k = key(p[0], p[1], p[2]);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  const adj = Array.from({ length: N }, () => []);
  const edgeSet = new Set();
  const edges = [];
  for (let i = 0; i < N; i++) {
    const [x, y, z] = pts[i];
    const gx = Math.floor(x / R), gy = Math.floor(y / R), gz = Math.floor(z / R);
    const cand = [];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      const cell = grid.get(`${gx + a},${gy + b},${gz + c}`);
      if (!cell) continue;
      for (const j of cell) {
        if (j === i) continue;
        const d = Math.hypot(pts[j][0] - x, pts[j][1] - y, pts[j][2] - z);
        if (d < R) cand.push([d, j]);
      }
    }
    cand.sort((p, q) => p[0] - q[0]);
    const lim = isDeep[i] ? K + 2 : K;
    for (let n = 0; n < Math.min(lim, cand.length); n++) {
      const j = cand[n][1];
      const ek = i < j ? i * 100000 + j : j * 100000 + i;
      if (edgeSet.has(ek)) continue;
      edgeSet.add(ek);
      edges.push([i, j]);
      adj[i].push(j);
      adj[j].push(i);
    }
  }

  // long-range tracts (arcuate fasciculus, corpus callosum, …)
  const tracts = [];
  for (let t = 0; t < 46; t++) {
    const a = (rand() * N) | 0, b = (rand() * N) | 0;
    const A = pts[a], B = pts[b];
    const d = Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
    if (d < 0.8 || isDeep[a] || isDeep[b]) continue;
    const mid = [(A[0] + B[0]) * 0.25, (A[1] + B[1]) * 0.3 + 0.05, (A[2] + B[2]) * 0.4];
    tracts.push(new THREE.QuadraticBezierCurve3(new THREE.Vector3(...A), new THREE.Vector3(...mid), new THREE.Vector3(...B)));
  }

  // ---------------------------------------------------------------
  // Geometry
  // ---------------------------------------------------------------
  const pos = new Float32Array(N * 3);
  const size = new Float32Array(N);
  const act = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos.set(pts[i], i * 3);
    size[i] = isDeep[i] ? 1.6 : 1.2 + rand() * 1.6;
  }

  const pointGeo = new THREE.BufferGeometry();
  pointGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  pointGeo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  const actAttr = new THREE.BufferAttribute(act, 1);
  actAttr.setUsage(THREE.DynamicDrawUsage);
  pointGeo.setAttribute("aAct", actAttr);

  const pointMat = new THREE.ShaderMaterial({
    uniforms: { uPR: { value: renderer.getPixelRatio() }, uColor: { value: BONE }, uOpacity: { value: 1 } },
    vertexShader: `
      attribute float aSize; attribute float aAct;
      uniform float uPR;
      varying float vAct; varying float vFade;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        vAct = aAct;
        vFade = smoothstep(-8.6, -5.6, mv.z);
        gl_PointSize = (aSize + aAct * 6.0) * uPR * (7.0 / -mv.z);
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uOpacity;
      varying float vAct; varying float vFade;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = pow(smoothstep(0.5, 0.0, d), 1.7);
        vec3 col = mix(uColor, vec3(1.0), clamp(vAct, 0.0, 1.0));
        gl_FragColor = vec4(col, a * (0.25 + 0.75 * vFade) * (0.5 + vAct * 1.4) * uOpacity);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  brain.add(new THREE.Points(pointGeo, pointMat));

  const linePos = new Float32Array(edges.length * 6);
  edges.forEach(([a, b], k) => { linePos.set(pts[a], k * 6); linePos.set(pts[b], k * 6 + 3); });
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
  const lineMat = new THREE.LineBasicMaterial({ color: BONE, transparent: true, opacity: 0.17, depthWrite: false, blending: THREE.AdditiveBlending });
  brain.add(new THREE.LineSegments(lineGeo, lineMat));

  const tractPts = [];
  tracts.forEach((c) => {
    const s = c.getPoints(24);
    for (let i = 0; i < s.length - 1; i++) tractPts.push(s[i], s[i + 1]);
  });
  const tractGeo = new THREE.BufferGeometry().setFromPoints(tractPts);
  const tractMat = new THREE.LineBasicMaterial({ color: BONE, transparent: true, opacity: 0.07, depthWrite: false, blending: THREE.AdditiveBlending });
  brain.add(new THREE.LineSegments(tractGeo, tractMat));

  // ---------------------------------------------------------------
  // Spike pulses
  // ---------------------------------------------------------------
  const MAXP = 420;
  const pulses = [];
  const pPos = new Float32Array(MAXP * 3);
  const pAlpha = new Float32Array(MAXP);
  const pGeo = new THREE.BufferGeometry();
  const pPosAttr = new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage);
  const pAlphaAttr = new THREE.BufferAttribute(pAlpha, 1).setUsage(THREE.DynamicDrawUsage);
  pGeo.setAttribute("position", pPosAttr);
  pGeo.setAttribute("aAlpha", pAlphaAttr);
  const pMat = new THREE.ShaderMaterial({
    uniforms: { uPR: { value: renderer.getPixelRatio() }, uOpacity: { value: 1 } },
    vertexShader: `
      attribute float aAlpha; uniform float uPR; varying float vA;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        vA = aAlpha;
        gl_PointSize = 7.0 * uPR * (7.0 / -mv.z);
      }`,
    fragmentShader: `
      uniform float uOpacity; varying float vA;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(1.0, 0.99, 0.96, a * a * vA * uOpacity);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pulsePoints = new THREE.Points(pGeo, pMat);
  pulsePoints.frustumCulled = false;
  brain.add(pulsePoints);

  function spawn(at, hops) {
    if (pulses.length >= MAXP) return;
    const a = at == null ? (rand() * N) | 0 : at;
    if (!adj[a].length) return;
    const b = adj[a][(rand() * adj[a].length) | 0];
    pulses.push({ a, b, t: 0, v: 2.2 + rand() * 2.4, hops: hops || 6 + ((rand() * 18) | 0) });
  }
  for (let i = 0; i < 200; i++) { spawn(); pulses[pulses.length - 1].t = rand(); }

  function burst(n) {
    const c = (rand() * N) | 0;
    act[c] = 1.6;
    for (let i = 0; i < n; i++) spawn(c, 10 + ((rand() * 20) | 0));
    for (const j of adj[c]) { act[j] = 1.2; for (let k = 0; k < 4; k++) spawn(j, 12); }
  }

  // dust for depth
  const dustN = 700;
  const dPos = new Float32Array(dustN * 3);
  for (let i = 0; i < dustN; i++) {
    const r = 3 + rand() * 6, th = rand() * Math.PI * 2, ph = Math.acos(rand() * 2 - 1);
    dPos.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) * 0.6, r * Math.sin(ph) * Math.sin(th) - 2], i * 3);
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: BONE, size: 0.012, transparent: true, opacity: 0.35, depthWrite: false }));
  scene.add(dust);

  // ---------------------------------------------------------------
  // Layout, input, loop
  // ---------------------------------------------------------------
  const layout = { x: 1.3, y: 0.05, s: 1.32, base: 1 };
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const halfW = Math.tan((camera.fov * Math.PI) / 360) * camera.position.z * camera.aspect;
    if (camera.aspect < 0.9) {
      Object.assign(layout, { x: 0, y: 0.75, s: Math.min(1.05, halfW * 0.82), base: 0.55 });
    } else if (camera.aspect < 1.3) {
      Object.assign(layout, { x: halfW * 0.38, y: 0.2, s: 1.05, base: 0.8 });
    } else {
      Object.assign(layout, { x: Math.min(1.55, halfW * 0.46), y: 0.05, s: Math.min(1.32, halfW * 0.44), base: 1 });
    }
    pointMat.uniforms.uPR.value = pMat.uniforms.uPR.value = renderer.getPixelRatio();
  }
  window.addEventListener("resize", resize);
  resize();

  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  window.addEventListener("pointermove", (e) => {
    mouse.tx = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.ty = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  document.querySelectorAll("[data-hero]").forEach((h) =>
    h.addEventListener("click", (e) => { if (!e.target.closest("a,button")) { burst(40); } })
  );

  // also driven from the scroll handler, so the fade never lags behind a throttled frame loop
  DUME.setBrainOpacity = (vis) => { canvas.style.opacity = (Math.pow(vis, 1.3) * layout.base).toFixed(3); };

  let last = performance.now(), spin = 0, ambient = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const vis = DUME.heroVis;
    DUME.setBrainOpacity(vis);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (vis < 0.01) return;

    mouse.x += (mouse.tx - mouse.x) * 0.05;
    mouse.y += (mouse.ty - mouse.y) * 0.05;
    if (!DUME.reduced) spin += dt * 0.09;
    brain.rotation.set(0.12 + mouse.y * 0.18, -Math.PI / 2 + Math.sin(spin) * 0.85 + spin * 0.25 + mouse.x * 0.35, 0);
    const s = layout.s * (0.86 + 0.14 * vis);
    root.scale.setScalar(s);
    root.position.set(layout.x, layout.y + (1 - vis) * 0.4, 0);
    dust.rotation.y += dt * 0.01;

    // pulses
    if (!DUME.reduced) {
      ambient += dt;
      if (ambient > 0.03) { ambient = 0; spawn(); spawn(); }
      if (Math.random() < dt * 0.35) burst(18);
    }
    for (let i = 0; i < N; i++) act[i] *= 0.93;
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      p.t += dt * p.v;
      if (p.t >= 1) {
        act[p.b] = Math.min(1.5, act[p.b] + 0.9);
        p.hops--;
        if (p.hops <= 0) { pulses.splice(i, 1); continue; }
        if (Math.random() < 0.06 && pulses.length < MAXP) spawn(p.b, Math.max(3, p.hops - 2));
        const nb = adj[p.b];
        let nxt = nb[(Math.random() * nb.length) | 0];
        if (nxt === p.a && nb.length > 1) nxt = nb[(Math.random() * nb.length) | 0];
        p.a = p.b; p.b = nxt; p.t -= 1;
      }
    }
    for (let i = 0; i < MAXP; i++) {
      const p = pulses[i];
      if (!p) { pAlpha[i] = 0; continue; }
      const A = pts[p.a], B = pts[p.b];
      pPos[i * 3] = A[0] + (B[0] - A[0]) * p.t;
      pPos[i * 3 + 1] = A[1] + (B[1] - A[1]) * p.t;
      pPos[i * 3 + 2] = A[2] + (B[2] - A[2]) * p.t;
      pAlpha[i] = Math.min(1, p.hops / 4);
    }
    pPosAttr.needsUpdate = true;
    pAlphaAttr.needsUpdate = true;
    actAttr.needsUpdate = true;

    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
})();
