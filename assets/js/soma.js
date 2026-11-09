/* =====================================================================
   Section 04: SOMA — a live spiking network with dynamic weights.
   Leaky integrate-and-fire neurons with adaptive thresholds,
   excitatory + inhibitory cells, STDP, dopamine-gated (three-factor)
   learning, synaptogenesis between co-active neurons and pruning of
   weak synapses. Runs in slow motion so you can watch it think.
   ===================================================================== */
(function () {
  "use strict";
  const DUME = window.DUME;
  const canvas = document.getElementById("somaNet");
  if (!canvas) return;
  const stage = canvas.parentElement;
  const ctx = canvas.getContext("2d");

  let seed = 2024;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  // ---- layout --------------------------------------------------------
  let W = 1, H = 1, DPR = 1;
  const neurons = [];
  let synapses = [];
  const events = []; // spikes in flight
  let tSim = 0;
  let formed = 0, pruned = 0;
  let plastic = true, dopamine = 0;
  const spikeLog = [];
  const RECENT = 0.09;
  const GROW_WINDOW = 0.4;

  function build() {
    const r = DUME.fitCanvas(canvas);
    W = r.w; H = r.h; DPR = r.dpr;
    if (neurons.length || W < 50) return; // positions are normalised; keep the network
    const aspect = W / H;
    const target = aspect > 1.4 ? 96 : 70;
    const minD = aspect > 1.4 ? 0.068 : 0.085;
    for (let k = 0; k < 20000 && neurons.length < target; k++) {
      const x = 0.04 + rnd() * 0.92, y = 0.14 + rnd() * 0.72;
      if (neurons.some((n) => Math.hypot((n.x - x) * aspect, n.y - y) < minD * Math.max(1, aspect * 0.8))) continue;
      neurons.push({ x, y, v: rnd() * 0.5, thr: 1, last: -9, trace: 0, inh: rnd() < 0.2, grp: -1 });
    }
    // three cell assemblies that receive a repeating sequence (A → B → C)
    const anchors = [[0.18, 0.55], [0.5, 0.36], [0.82, 0.6]];
    anchors.forEach(([ax, ay], g) => {
      neurons
        .filter((n) => !n.inh && n.grp < 0)
        .map((n) => [Math.hypot((n.x - ax) * aspect, n.y - ay), n])
        .sort((a, b) => a[0] - b[0])
        .slice(0, 7)
        .forEach(([, n]) => (n.grp = g));
    });
    // sparse initial wiring to nearby cells
    neurons.forEach((n, i) => {
      neurons
        .map((m, j) => [Math.hypot((m.x - n.x) * aspect, m.y - n.y), j])
        .filter(([d, j]) => j !== i && d < 0.2)
        .sort((a, b) => a[0] - b[0])
        .slice(0, 3)
        .forEach(([d, j]) => { if (rnd() < 0.75) addSyn(i, j, 0.15 + rnd() * 0.4, -1); });
    });
  }

  function addSyn(pre, post, w, born) {
    if (synapses.some((s) => s.pre === pre && s.post === post)) return false;
    const a = neurons[pre], b = neurons[post];
    const d = Math.hypot((a.x - b.x) * (W / H), a.y - b.y);
    synapses.push({ pre, post, w, delay: 0.16 + d * 1.1, born, dying: -1, low: 0 });
    return true;
  }

  // ---- dynamics ------------------------------------------------------
  const TAU_M = 0.35, TAU_TR = 0.22, TAU_THR = 1.6, REFR = 0.06;
  const A_PLUS = 0.07, A_MINUS = 0.05;

  function spike(i) {
    const n = neurons[i];
    n.v = 0;
    n.last = tSim;
    n.thr += 0.28;
    n.trace += 1;
    spikeLog.push(tSim);
    for (const s of synapses) {
      if (s.pre !== i || s.dying >= 0) continue;
      events.push({ s, t0: tSim });
      if (plastic) {
        // post fired before this pre spike → depression
        const post = neurons[s.post];
        s.w = Math.max(0, s.w - A_MINUS * post.trace * (1 + dopamine * 2.5));
      }
    }
    if (plastic) {
      for (const s of synapses) {
        if (s.post !== i || s.dying >= 0) continue;
        // pre fired before this post spike → potentiation (dopamine-gated)
        const pre = neurons[s.pre];
        s.w = Math.min(1, s.w + A_PLUS * pre.trace * (1 + dopamine * 2.5));
      }
    }
  }

  let seqT = 0, seqStage = -1, growT = 0;
  function simStep(dt) {
    tSim += dt;
    dopamine = Math.max(0, dopamine - dt * 0.7);

    // repeating input sequence A → B → C
    seqT += dt;
    if (seqT > 2.6) { seqT = 0; seqStage = 0; }
    if (seqStage >= 0 && seqT > seqStage * 0.32) {
      neurons.forEach((n) => { if (n.grp === seqStage) n.v += 0.75 + rnd() * 0.5; });
      seqStage = seqStage < 2 ? seqStage + 1 : -1;
    }

    for (let i = 0; i < neurons.length; i++) {
      const n = neurons[i];
      n.v *= Math.exp(-dt / TAU_M);
      n.trace *= Math.exp(-dt / TAU_TR);
      n.thr = 1 + (n.thr - 1) * Math.exp(-dt / TAU_THR);
      if (rnd() < dt * 2.2) n.v += 0.42;           // background synaptic noise
      if (tSim - n.last > REFR && n.v >= n.thr) spike(i);
    }

    // deliver spikes
    for (let k = events.length - 1; k >= 0; k--) {
      const e = events[k];
      if (tSim - e.t0 < e.s.delay) continue;
      events.splice(k, 1);
      const pre = neurons[e.s.pre], post = neurons[e.s.post];
      if (tSim - post.last > REFR) post.v += e.s.w * (pre.inh ? -1.1 : 0.85);
    }

    // structural plasticity
    growT += dt;
    if (plastic && growT > 0.2) {
      growT = 0;
      // synaptogenesis: a neuron that fired shortly before another may grow a synapse onto it
      const recent = [];
      neurons.forEach((n, i) => { if (tSim - n.last < GROW_WINDOW && !n.inh) recent.push(i); });
      const aspect = W / H;
      for (let a = 0; a < recent.length; a++) {
        for (let b = 0; b < recent.length; b++) {
          if (a === b || synapses.length > neurons.length * 5) continue;
          const A = neurons[recent[a]], B = neurons[recent[b]];
          const lead = B.last - A.last;
          if (lead < 0.02 || lead > GROW_WINDOW) continue; // pre must lead post
          const d = Math.hypot((A.x - B.x) * aspect, A.y - B.y);
          if (d < 0.55 && rnd() < 0.05 * (1 + dopamine * 4) && addSyn(recent[a], recent[b], 0.24, tSim)) formed++;
        }
      }
      for (const s of synapses) {
        if (s.dying >= 0) continue;
        s.w *= 1 - 0.035 * 0.2; // slow forgetting of unused synapses
        s.low = s.w < 0.07 ? s.low + 0.2 : 0;
        if (s.low > 1.2) { s.dying = tSim; pruned++; }
      }
    }
    synapses = synapses.filter((s) => s.dying < 0 || tSim - s.dying < 0.6);
    while (spikeLog.length && tSim - spikeLog[0] > 1) spikeLog.shift();
  }

  // ---- drawing -------------------------------------------------------
  function px(n) { return [n.x * W, n.y * H]; }

  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const unit = Math.min(W, H) / 360;

    // synapses
    for (const s of synapses) {
      const a = neurons[s.pre], b = neurons[s.post];
      const [x1, y1] = px(a), [x2, y2] = px(b);
      let grow = 1, alpha = 0.1 + s.w * 0.6;
      const fresh = s.born >= 0 && tSim - s.born < 1.6;
      if (s.born >= 0) grow = Math.min(1, (tSim - s.born) / 0.5);
      if (s.dying >= 0) alpha *= 1 - (tSim - s.dying) / 0.6;
      ctx.lineWidth = (0.5 + s.w * 2.6) * unit;
      ctx.strokeStyle = a.inh ? `rgba(162,158,150,${alpha * 0.8})` : `rgba(236,232,225,${alpha})`;
      ctx.setLineDash(fresh ? [3 * unit, 3 * unit] : a.inh ? [1.5 * unit, 2.5 * unit] : []);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 + (x2 - x1) * grow, y1 + (y2 - y1) * grow);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // spikes in flight
    for (const e of events) {
      const a = neurons[e.s.pre], b = neurons[e.s.post];
      const k = Math.min(1, (tSim - e.t0) / e.s.delay);
      const [x1, y1] = px(a), [x2, y2] = px(b);
      const x = x1 + (x2 - x1) * k, y = y1 + (y2 - y1) * k;
      const r = (2 + e.s.w * 2.5) * unit;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.6);
      g.addColorStop(0, "rgba(255,255,255,0.95)");
      g.addColorStop(1, "rgba(255,250,240,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r * 2.6, 0, Math.PI * 2); ctx.fill();
    }

    // neurons
    for (const n of neurons) {
      const [x, y] = px(n);
      const glow = Math.exp(-(tSim - n.last) / 0.12);
      const r = (3.4 + glow * 2.6) * unit;
      if (glow > 0.05) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r * 5);
        g.addColorStop(0, `rgba(255,255,255,${0.55 * glow})`);
        g.addColorStop(1, "rgba(255,250,240,0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r * 5, 0, Math.PI * 2); ctx.fill();
      }
      // membrane potential ring
      const vv = Math.max(0, Math.min(1, n.v / n.thr));
      ctx.beginPath();
      ctx.arc(x, y, r + 3 * unit, -Math.PI / 2, -Math.PI / 2 + vv * Math.PI * 2);
      ctx.strokeStyle = "rgba(236,232,225,0.35)";
      ctx.lineWidth = 1.1 * unit;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      if (n.inh) {
        ctx.strokeStyle = `rgba(236,232,225,${0.55 + glow * 0.45})`;
        ctx.lineWidth = 1.4 * unit;
        ctx.fillStyle = "#0a0a0a";
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillStyle = `rgba(236,232,225,${0.6 + glow * 0.4})`;
        ctx.fill();
      }
    }

    // dopamine wave
    if (dopamine > 0.01) {
      const k = 1 - dopamine;
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, k * Math.max(W, H) * 0.75, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,250,240,${dopamine * 0.35})`;
      ctx.lineWidth = 30 * unit * dopamine;
      ctx.stroke();
    }
  }

  // ---- HUD & controls ------------------------------------------------
  const $ = (id) => document.getElementById(id);
  let hudT = 0;
  function hud() {
    const active = neurons.filter((n) => tSim - n.last < RECENT).length;
    $("snN").textContent = neurons.length;
    $("snS").textContent = synapses.filter((s) => s.dying < 0).length;
    $("snR").textContent = spikeLog.length;
    $("snA").textContent = ((active / neurons.length) * 100).toFixed(1) + "%";
    $("snG").textContent = `${formed} / ${pruned}`;
  }

  $("snReward").addEventListener("click", () => {
    dopamine = 1;
    stage.classList.add("reward");
    setTimeout(() => stage.classList.remove("reward"), 900);
  });
  const btnP = $("snPlastic");
  btnP.addEventListener("click", () => {
    plastic = !plastic;
    btnP.setAttribute("aria-pressed", String(plastic));
    btnP.textContent = `Plasticity: ${plastic ? "on" : "off"}`;
  });
  canvas.addEventListener("click", (e) => {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    const aspect = W / H;
    neurons.forEach((n) => { if (Math.hypot((n.x - x) * aspect, n.y - y) < 0.16) n.v += 1.4; });
  });

  window.addEventListener("resize", () => { if (neurons.length) build(); });

  let ready = false;
  DUME.loop(stage, (dt) => {
    if (!ready) {
      // build once the canvas has its real size, then warm the network up
      build();
      if (W < 50) return;
      ready = true;
      for (let k = 0; k < 600; k++) simStep(0.01);
      formed = 0; pruned = 0;
    }
    const scaled = dt * 0.8; // gentle slow motion
    const steps = Math.ceil(scaled / 0.004);
    for (let k = 0; k < steps; k++) simStep(scaled / steps);
    draw();
    hudT += dt;
    if (hudT > 0.25) { hudT = 0; hud(); }
  });
})();
