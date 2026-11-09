/* =====================================================================
   Section 02: interactive brain map + neuron / LIF membrane scope.
   The brain outline is the same geometry as the DUM-E Labs mark.
   ===================================================================== */
(function () {
  "use strict";
  const DUME = window.DUME;
  const MARK = window.DUME_MARK && window.DUME_MARK.full;

  /* ------------------------------------------------------------------ */
  /* Region data                                                         */
  /* ------------------------------------------------------------------ */
  const REGIONS = {
    frontal: {
      name: "Frontal lobe",
      title: "Planning, reasoning & working memory",
      brain: "The prefrontal cortex holds goals and plans as sustained, recurrent firing. The motor cortex along its back edge turns decisions into movement.",
      chip: "SOMA executive circuits keep the current goal in mind as recurrent spiking attractors: working memory made of live activity, not RAM.",
      stat: "About one-third of the cortex · the last region to mature, in the mid-20s",
      label: [22, 34],
    },
    parietal: {
      name: "Parietal lobe",
      title: "Space, touch & integration",
      brain: "Combines touch, vision and body position into one model of where things are, and steers attention toward what matters right now.",
      chip: "The MNEMOS spike router: events from different sensor cores meet here, and routing tables decide which cores hear which spikes.",
      stat: "Home of the somatosensory cortex, a map of the whole body",
      label: [64, 28],
    },
    temporal: {
      name: "Temporal lobe · hippocampus",
      title: "Hearing, language & new memories",
      brain: "Processes sound and language. Deep inside, the hippocampus captures new experiences in a single exposure and replays them during sleep.",
      chip: "Fast-plastic memory tiles: high-learning-rate synapses store new episodes instantly, then consolidation copies them into stable long-term arrays.",
      stat: "One-shot learning, consolidated by replay during sleep",
      label: [42, 68],
    },
    occipital: {
      name: "Occipital lobe",
      title: "Vision",
      brain: "Primary visual cortex detects edges and motion. Later areas build those into shapes, objects and faces, one layer at a time.",
      chip: "Sensory encoder cores turn camera or event-sensor input straight into spikes. Like the retina, they report only what changes.",
      stat: "Hierarchical: edges → shapes → objects → meaning",
      label: [89, 46],
    },
    cerebellum: {
      name: "Cerebellum",
      title: "Timing, prediction & fine control",
      brain: "Holds about 80 % of the brain's neurons in a compact, crystal-regular circuit that predicts the result of every movement and corrects errors in milliseconds.",
      chip: "Prediction cores: massively parallel, regular arrays that learn forward models and emit the error signals that drive learning elsewhere.",
      stat: "~69 of 86 billion neurons in ~10 % of the brain's mass",
      label: [78, 77],
    },
  };
  const ORDER = ["frontal", "parietal", "temporal", "occipital", "cerebellum"];

  // tracts between regions (white-matter bundles)
  const TRACTS = [
    ["frontal", "temporal", -14],  // arcuate fasciculus
    ["frontal", "parietal", -10],  // superior longitudinal fasciculus
    ["occipital", "temporal", 8],  // inferior longitudinal fasciculus
    ["occipital", "parietal", -8], // dorsal stream
    ["frontal", "occipital", -18], // fronto-occipital fasciculus
    ["parietal", "cerebellum", 10],
    ["frontal", "cerebellum", 16],
    ["temporal", "parietal", 6],
  ];

  // lobe boundaries in mark coordinates (100x100 box)
  const lateralY = (x) => 63 - (x - 19) * (11 / 47);  // sylvian fissure, rising toward the back
  const centralX = (y) => 52 - (y - 13) * (10 / 44);  // central sulcus, slanting forward
  const tentY = (x) => 74 - (x - 60) * (8 / 29);      // tentorium above the cerebellum

  function regionOf(x, y) {
    if (x > 60 && y > tentY(x)) return "cerebellum";
    if (x < 72 && y > lateralY(Math.min(x, 66))) return "temporal";
    if (x > 79) return "occipital";
    if (x < centralX(y)) return "frontal";
    return "parietal";
  }

  /* ------------------------------------------------------------------ */
  /* Brain map canvas                                                    */
  /* ------------------------------------------------------------------ */
  const canvas = document.getElementById("brainMap");
  if (canvas && MARK) initMap();

  function initMap() {
    const ctx = canvas.getContext("2d");
    const poly = MARK.nodes.slice(0, MARK.outline);

    const pip = (x, y) => {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    };
    const distPoly = (x, y) => {
      let best = 1e9;
      for (let i = 0; i < poly.length; i++) {
        const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
        const dx = bx - ax, dy = by - ay;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
        best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
      }
      return best;
    };

    // neurons: dart-throwing inside the outline
    let s = 42;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const nodes = [];
    for (let k = 0; k < 9000 && nodes.length < 230; k++) {
      const x = 2 + rnd() * 96, y = 12 + rnd() * 76;
      if (!pip(x, y) || distPoly(x, y) < 1.6) continue;
      if (nodes.some((n) => Math.hypot(n.x - x, n.y - y) < 4.4)) continue;
      nodes.push({ x, y, r: regionOf(x, y), act: 0, ph: rnd() * 6.28 });
    }
    const adj = nodes.map(() => []);
    const edges = [];
    nodes.forEach((n, i) => {
      const near = nodes
        .map((m, j) => [Math.hypot(m.x - n.x, m.y - n.y), j])
        .filter(([d, j]) => j !== i && d < 9.5)
        .sort((a, b) => a[0] - b[0])
        .slice(0, 3);
      near.forEach(([, j]) => {
        if (adj[i].includes(j)) return;
        adj[i].push(j); adj[j].push(i);
        edges.push([i, j]);
      });
    });

    const centers = {};
    ORDER.forEach((r) => {
      const ns = nodes.filter((n) => n.r === r);
      centers[r] = [ns.reduce((a, n) => a + n.x, 0) / ns.length, ns.reduce((a, n) => a + n.y, 0) / ns.length];
    });
    const tracts = TRACTS.map(([a, b, bow]) => {
      const A = centers[a], B = centers[b];
      const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;
      const len = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
      const nx = -(B[1] - A[1]) / len, ny = (B[0] - A[0]) / len;
      return { a, b, A, B, C: [mx + nx * bow, my + ny * bow] };
    });
    const qb = (t, A, C, B) => [
      (1 - t) * (1 - t) * A[0] + 2 * (1 - t) * t * C[0] + t * t * B[0],
      (1 - t) * (1 - t) * A[1] + 2 * (1 - t) * t * C[1] + t * t * B[1],
    ];

    // smooth outline (Catmull-Rom through the mark's outline points)
    function smoothPath(map) {
      const P = poly.map(map);
      const n = P.length;
      ctx.beginPath();
      ctx.moveTo(P[0][0], P[0][1]);
      for (let i = 0; i < n; i++) {
        const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
        ctx.bezierCurveTo(
          p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
          p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6,
          p2[0], p2[1]
        );
      }
      ctx.closePath();
    }

    // state
    let selected = "frontal";
    let userPicked = false, autoT = 0;
    const pulses = [];
    const tractPulses = [];

    // region tabs + card
    const tabs = document.getElementById("regionTabs");
    const card = document.getElementById("regionCard");
    const el = (id) => document.getElementById(id);
    ORDER.forEach((r) => {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "tab");
      b.dataset.region = r;
      b.textContent = REGIONS[r].name.split(" ·")[0].replace(" lobe", "");
      b.addEventListener("click", () => { userPicked = true; select(r, true); });
      tabs.appendChild(b);
    });
    function select(r, fire) {
      if (r === selected && !fire) return;
      selected = r;
      const R = REGIONS[r];
      el("rcKicker").textContent = R.name;
      el("rcTitle").textContent = R.title;
      el("rcBrain").textContent = R.brain;
      el("rcChip").textContent = R.chip;
      el("rcStat").textContent = R.stat;
      card.classList.remove("swap"); void card.offsetWidth; card.classList.add("swap");
      tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.region === r)));
      if (fire) burstRegion(r, 10);
    }
    select("frontal", false);
    // initial fill (select() early-returns when unchanged)
    (function () {
      const R = REGIONS.frontal;
      el("rcBrain").textContent = R.brain; el("rcChip").textContent = R.chip; el("rcStat").textContent = R.stat;
      tabs.querySelector("button").setAttribute("aria-selected", "true");
    })();

    function spawnPulse(i, hops) {
      if (pulses.length > 160 || !adj[i].length) return;
      pulses.push({ a: i, b: adj[i][(Math.random() * adj[i].length) | 0], t: 0, v: 2 + Math.random() * 2.5, hops: hops || 8 });
    }
    function burstRegion(r, n) {
      const ns = nodes.map((nd, i) => [nd, i]).filter(([nd]) => nd.r === r);
      for (let k = 0; k < n; k++) {
        const [nd, i] = ns[(Math.random() * ns.length) | 0];
        nd.act = 1;
        spawnPulse(i, 6 + ((Math.random() * 8) | 0));
      }
      tracts.forEach((t, ti) => { if (t.a === r || t.b === r) tractPulses.push({ ti, t: 0, dir: t.a === r ? 1 : -1, v: 0.7 + Math.random() * 0.4 }); });
    }

    // geometry mapping
    let view = { s: 1, ox: 0, oy: 0, w: 1, h: 1, dpr: 1 };
    const M = (p) => [view.ox + p[0] * view.s, view.oy + p[1] * view.s];
    function layout() {
      const { w, h, dpr } = DUME.fitCanvas(canvas);
      const sc = Math.min((w * 0.86) / 96, (h * 0.82) / 76);
      view = { s: sc, ox: (w - 96 * sc) / 2 - 2 * sc, oy: (h - 76 * sc) / 2 - 12 * sc - h * 0.02, w, h, dpr };
    }
    layout();
    window.addEventListener("resize", layout);

    function toMark(ev) {
      const r = canvas.getBoundingClientRect();
      return [(ev.clientX - r.left - view.ox) / view.s, (ev.clientY - r.top - view.oy) / view.s];
    }
    canvas.addEventListener("pointermove", (ev) => {
      if (ev.pointerType !== "mouse") return;
      const [x, y] = toMark(ev);
      if (pip(x, y)) { userPicked = true; select(regionOf(x, y), false); }
    });
    canvas.addEventListener("click", (ev) => {
      const [x, y] = toMark(ev);
      userPicked = true;
      if (pip(x, y)) select(regionOf(x, y), false);
      // fire a thought from the nearest neuron
      let bi = 0, bd = 1e9;
      nodes.forEach((n, i) => { const d = Math.hypot(n.x - x, n.y - y); if (d < bd) { bd = d; bi = i; } });
      nodes[bi].act = 1.4;
      for (let k = 0; k < 14; k++) spawnPulse(bi, 10 + ((Math.random() * 10) | 0));
    });

    function draw(dt, t) {
      if (!DUME.reduced) {
        autoT += dt;
        if (!userPicked && autoT > 5) { autoT = 0; select(ORDER[(ORDER.indexOf(selected) + 1) % ORDER.length], true); }
        if (Math.random() < dt * 9) spawnPulse((Math.random() * nodes.length) | 0, 4 + ((Math.random() * 6) | 0));
        if (Math.random() < dt * 1.2) burstRegion(selected, 3);
      }

      const { w, h, dpr } = view;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const unit = view.s;

      // brain silhouette
      smoothPath(M);
      ctx.fillStyle = "rgba(236,232,225,0.035)";
      ctx.fill();
      ctx.lineWidth = Math.max(1.2, unit * 0.32);
      ctx.strokeStyle = "rgba(236,232,225,0.75)";
      ctx.stroke();

      // selected region wash
      ctx.save();
      smoothPath(M);
      ctx.clip();
      const sn = nodes.filter((n) => n.r === selected);
      sn.forEach((n) => {
        const [x, y] = M([n.x, n.y]);
        const g = ctx.createRadialGradient(x, y, 0, x, y, unit * 7);
        g.addColorStop(0, "rgba(236,232,225,0.075)");
        g.addColorStop(1, "rgba(236,232,225,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x - unit * 7, y - unit * 7, unit * 14, unit * 14);
      });
      ctx.restore();

      // sulci (lobe boundaries)
      ctx.save();
      smoothPath(M);
      ctx.clip();
      ctx.setLineDash([unit * 1.2, unit * 1.2]);
      ctx.lineWidth = Math.max(1, unit * 0.18);
      ctx.strokeStyle = "rgba(236,232,225,0.28)";
      ctx.beginPath();
      let p = M([15, lateralY(15)]); ctx.moveTo(p[0], p[1]);
      p = M([70, lateralY(66) - 1]); ctx.lineTo(p[0], p[1]);
      p = M([centralX(10), 10]); ctx.moveTo(p[0], p[1]);
      p = M([centralX(lateralY(centralX(56))), lateralY(centralX(56))]); ctx.lineTo(p[0], p[1]);
      p = M([84, 16]); ctx.moveTo(p[0], p[1]);
      p = M([79, 62]); ctx.lineTo(p[0], p[1]);
      p = M([58, tentY(58)]); ctx.moveTo(p[0], p[1]);
      p = M([92, tentY(92)]); ctx.lineTo(p[0], p[1]);
      ctx.stroke();
      ctx.restore();

      // tracts
      tracts.forEach((tr) => {
        const on = tr.a === selected || tr.b === selected;
        const A = M(tr.A), B = M(tr.B), C = M(tr.C);
        ctx.beginPath();
        ctx.moveTo(A[0], A[1]);
        ctx.quadraticCurveTo(C[0], C[1], B[0], B[1]);
        ctx.setLineDash([]);
        ctx.lineWidth = on ? Math.max(1.2, unit * 0.28) : Math.max(0.8, unit * 0.14);
        ctx.strokeStyle = on ? "rgba(236,232,225,0.42)" : "rgba(236,232,225,0.1)";
        ctx.stroke();
      });

      // local synapses
      ctx.lineWidth = Math.max(0.6, unit * 0.1);
      edges.forEach(([a, b]) => {
        const A = nodes[a], B = nodes[b];
        const on = A.r === selected && B.r === selected;
        const lit = Math.max(A.act, B.act);
        ctx.strokeStyle = `rgba(236,232,225,${(on ? 0.3 : 0.11) + lit * 0.35})`;
        const pa = M([A.x, A.y]), pb = M([B.x, B.y]);
        ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
      });

      // neurons
      nodes.forEach((n) => {
        n.act *= Math.pow(0.04, dt);
        const on = n.r === selected;
        const [x, y] = M([n.x, n.y]);
        const r = unit * (on ? 0.62 : 0.45) + n.act * unit * 0.9;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(236,232,225,${(on ? 0.85 : 0.38) + n.act * 0.5})`;
        ctx.fill();
        if (n.act > 0.25) {
          ctx.beginPath();
          ctx.arc(x, y, r * 2.2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,255,255,${n.act * 0.08})`;
          ctx.fill();
        }
      });

      // pulses along synapses
      for (let i = pulses.length - 1; i >= 0; i--) {
        const q = pulses[i];
        q.t += dt * q.v;
        if (q.t >= 1) {
          nodes[q.b].act = Math.min(1.4, nodes[q.b].act + 0.8);
          if (--q.hops <= 0) { pulses.splice(i, 1); continue; }
          const nb = adj[q.b];
          let nx = nb[(Math.random() * nb.length) | 0];
          if (nx === q.a && nb.length > 1) nx = nb[(Math.random() * nb.length) | 0];
          q.a = q.b; q.b = nx; q.t = 0;
        }
        const A = nodes[q.a], B = nodes[q.b];
        const [x, y] = M([A.x + (B.x - A.x) * q.t, A.y + (B.y - A.y) * q.t]);
        glow(x, y, unit * 0.55, 1);
      }

      // pulses along tracts
      for (let i = tractPulses.length - 1; i >= 0; i--) {
        const q = tractPulses[i];
        q.t += dt * q.v;
        if (q.t >= 1) {
          tractPulses.splice(i, 1);
          const tr = tracts[q.ti];
          const target = q.dir > 0 ? tr.b : tr.a;
          const cand = nodes.map((n, k) => [n, k]).filter(([n]) => n.r === target);
          const [nd, k] = cand[(Math.random() * cand.length) | 0];
          nd.act = 1.2;
          spawnPulse(k, 5);
          continue;
        }
        const tr = tracts[q.ti];
        const tt = q.dir > 0 ? q.t : 1 - q.t;
        const [x, y] = M(qb(tt, tr.A, tr.C, tr.B));
        glow(x, y, unit * 0.8, 1);
      }

      // region labels
      ctx.font = `500 ${Math.max(9, Math.min(12, unit * 1.5))}px "JetBrains Mono", monospace`;
      ctx.textAlign = "center";
      ORDER.forEach((r) => {
        const [x, y] = M(REGIONS[r].label);
        const on = r === selected;
        const txt = REGIONS[r].name.split(" ·")[0].replace(" lobe", "").toUpperCase();
        if (on) {
          const tw = ctx.measureText(txt).width + 16;
          ctx.fillStyle = "rgba(236,232,225,0.95)";
          roundRect(x - tw / 2, y - 11, tw, 20, 10);
          ctx.fill();
          ctx.fillStyle = "#050505";
        } else {
          ctx.fillStyle = "rgba(236,232,225,0.55)";
        }
        ctx.fillText(txt, x, y + 3.5);
      });
    }

    function glow(x, y, r, a) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3.2);
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(0.35, `rgba(255,252,245,${a * 0.45})`);
      g.addColorStop(1, "rgba(255,250,240,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r * 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    DUME.loop(canvas, draw);
  }

  /* ------------------------------------------------------------------ */
  /* Neuron anatomy + leaky integrate-and-fire scope                     */
  /* ------------------------------------------------------------------ */
  const svg = document.getElementById("neuronSvg");
  const scope = document.getElementById("lifScope");
  if (svg && scope) initNeuron();

  function initNeuron() {
    const NS = "http://www.w3.org/2000/svg";
    const layer = document.getElementById("neuronPulses");
    const soma = document.getElementById("soma");
    const dend = ["d1", "d2", "d3"].map((id) => document.getElementById(id));
    const axon = document.getElementById("axon");
    const terms = ["t1", "t2", "t3"].map((id) => document.getElementById(id));
    const bulbs = [...svg.querySelectorAll(".nr-term circle")];
    const ctx = scope.getContext("2d");

    const sig = []; // travelling signals: {path, len, t, dur, kind, i}
    function emit(path, dur, kind, i, r) {
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("r", r || 6);
      layer.appendChild(c);
      sig.push({ path, len: path.getTotalLength(), t: 0, dur, kind, i, c });
    }

    const HIST = 360; // samples (~6 s at 60 Hz)
    const trace = new Float32Array(HIST);
    const spikes = new Uint8Array(HIST);
    let head = 0, V = 0, refr = 0, nextIn = 0.2, sample = 0;
    const TAU = 0.55, THR = 1;

    function step(dt) {
      // random input spikes arriving at the dendrites
      nextIn -= dt;
      if (nextIn <= 0 && !DUME.reduced) {
        nextIn = 0.05 + Math.random() * 0.24;
        const k = (Math.random() * 3) | 0;
        emit(dend[k], 0.45, "in", k, 5);
      }
      V *= Math.exp(-dt / TAU);
      if (refr > 0) refr -= dt;

      for (let i = sig.length - 1; i >= 0; i--) {
        const s = sig[i];
        s.t += dt / s.dur;
        if (s.t >= 1) {
          s.c.remove();
          sig.splice(i, 1);
          if (s.kind === "in" && refr <= 0) {
            V += 0.22 + Math.random() * 0.16;
            if (V >= THR) fire();
          } else if (s.kind === "axon") {
            terms.forEach((p, k) => emit(p, 0.3, "term", k, 6));
          } else if (s.kind === "term") {
            const b = bulbs[s.i];
            b.classList.add("hit");
            setTimeout(() => b.classList.remove("hit"), 220);
          }
          continue;
        }
        const pt = s.path.getPointAtLength(s.t * s.len);
        s.c.setAttribute("cx", pt.x.toFixed(1));
        s.c.setAttribute("cy", pt.y.toFixed(1));
      }

      sample += dt;
      while (sample >= 1 / 60) {
        sample -= 1 / 60;
        trace[head] = V;
        spikes[head] = 0;
        head = (head + 1) % HIST;
      }
    }
    let fired = false;
    function fire() {
      V = 0;
      refr = 0.12;
      fired = true;
      spikes[(head - 1 + HIST) % HIST] = 1;
      soma.classList.add("fire");
      setTimeout(() => soma.classList.remove("fire"), 160);
      emit(axon, 0.65, "axon", 0, 7);
    }

    function drawScope() {
      const { w, h, dpr } = DUME.fitCanvas(scope);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const top = 10, bot = h - 8;
      const y = (v) => bot - (v / 1.25) * (bot - top);
      // threshold
      ctx.setLineDash([4, 5]);
      ctx.strokeStyle = "rgba(162,158,150,0.7)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, y(THR)); ctx.lineTo(w, y(THR)); ctx.stroke();
      ctx.setLineDash([]);
      // baseline
      ctx.strokeStyle = "rgba(236,232,225,0.1)";
      ctx.beginPath(); ctx.moveTo(0, y(0)); ctx.lineTo(w, y(0)); ctx.stroke();
      // trace
      ctx.strokeStyle = "rgba(236,232,225,0.95)";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let i = 0; i < HIST; i++) {
        const idx = (head + i) % HIST;
        const x = (i / (HIST - 1)) * w;
        if (spikes[idx]) {
          ctx.lineTo(x, y(THR));
          ctx.lineTo(x, top - 4);
          ctx.lineTo(x, y(0));
        } else if (i === 0) ctx.moveTo(x, y(trace[idx]));
        else ctx.lineTo(x, y(trace[idx]));
      }
      ctx.stroke();
      // spike markers
      for (let i = 0; i < HIST; i++) {
        const idx = (head + i) % HIST;
        if (!spikes[idx]) continue;
        const x = (i / (HIST - 1)) * w;
        ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.arc(x, top - 4, 3, 0, Math.PI * 2); ctx.fill();
      }
    }

    DUME.loop(svg.closest(".neuron"), (dt) => {
      step(dt);
      if (fired) fired = false;
      drawScope();
    });
  }
})();
