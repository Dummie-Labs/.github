/* =====================================================================
   DUM-E Labs — core site behaviour
   - animated brain-mesh marks
   - nav, reveal-on-scroll, counters
   - infinite marquees + back-to-top button
   - shared helpers for the visual modules (window.DUME)
   ===================================================================== */
(function () {
  "use strict";

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const DUME = (window.DUME = { reduced, heroVis: 1 });

  /** Run fn(dt, t) on animation frames only while el is near the viewport. */
  DUME.loop = function (el, fn, margin) {
    let vis = false, running = false, last = 0;
    const tick = (now) => {
      if (!vis) { running = false; return; }
      const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
      last = now;
      fn(dt, now / 1000);
      requestAnimationFrame(tick);
    };
    new IntersectionObserver(
      ([e]) => {
        vis = e.isIntersecting;
        if (vis && !running) { running = true; last = performance.now(); requestAnimationFrame(tick); }
      },
      { rootMargin: margin || "120px" }
    ).observe(el);
  };

  /** Size a canvas to its CSS box at device pixel ratio; returns {w,h,dpr}. */
  DUME.fitCanvas = function (canvas, maxDpr) {
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr || 2);
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    return { w, h, dpr };
  };

  /* ------------------------------------------------------------------ */
  /* Brain-mesh marks with travelling signal pulses                     */
  /* ------------------------------------------------------------------ */
  const NS = "http://www.w3.org/2000/svg";
  const marks = [];

  function buildMark(el) {
    const small = el.offsetWidth < 48;
    const M = (window.DUME_MARK || {})[small ? "small" : "full"];
    if (!M) return;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "-2 -2 104 104");
    svg.setAttribute("aria-hidden", "true");
    const N = M.nodes;
    let d = "";
    M.edges.forEach(([a, b]) => { d += `M${N[a][0]} ${N[a][1]}L${N[b][0]} ${N[b][1]}`; });
    const edges = document.createElementNS(NS, "path");
    edges.setAttribute("d", d);
    edges.setAttribute("class", "m-edges");
    const outline = document.createElementNS(NS, "path");
    outline.setAttribute("d", "M" + N.slice(0, M.outline).map((p) => p.join(" ")).join("L") + "Z");
    outline.setAttribute("class", "m-outline");
    svg.append(edges, outline);

    const adj = N.map(() => []);
    M.edges.forEach(([a, b]) => { adj[a].push(b); adj[b].push(a); });

    const count = reduced ? 0 : +(el.dataset.pulses || 4);
    const pulses = [];
    for (let i = 0; i < count; i++) {
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("r", small ? 4.5 : 3);
      c.setAttribute("class", "m-pulse");
      svg.appendChild(c);
      const a = (Math.random() * N.length) | 0;
      pulses.push({ c, a, b: adj[a][(Math.random() * adj[a].length) | 0], t: Math.random(), v: 0.9 + Math.random() * 0.9 });
    }
    el.appendChild(svg);
    marks.push({ N, adj, pulses });
  }

  document.querySelectorAll("[data-mark]").forEach(buildMark);

  if (!reduced && marks.length) {
    let last = performance.now();
    (function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      for (const m of marks) {
        for (const p of m.pulses) {
          p.t += dt * p.v;
          if (p.t >= 1) {
            p.t -= 1;
            const nb = m.adj[p.b];
            let nxt = nb[(Math.random() * nb.length) | 0];
            if (nxt === p.a && nb.length > 1) nxt = nb[(Math.random() * nb.length) | 0];
            p.a = p.b; p.b = nxt;
          }
          const A = m.N[p.a], B = m.N[p.b];
          p.c.setAttribute("cx", (A[0] + (B[0] - A[0]) * p.t).toFixed(2));
          p.c.setAttribute("cy", (A[1] + (B[1] - A[1]) * p.t).toFixed(2));
        }
      }
      requestAnimationFrame(frame);
    })(last);
  }

  /* ------------------------------------------------------------------ */
  /* Nav                                                                 */
  /* ------------------------------------------------------------------ */
  const nav = document.getElementById("nav");
  const toggle = document.getElementById("navToggle");
  toggle.addEventListener("click", () => {
    const open = !nav.classList.contains("is-open");
    nav.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  });

  // smooth in-page navigation (no CSS scroll-behavior so loop jumps stay instant)
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute("href").slice(1);
    const target = id ? document.getElementById(id) : null;
    if (!target) return;
    e.preventDefault();
    nav.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
    const top = id === "top" ? 0 : target.getBoundingClientRect().top + window.scrollY - nav.offsetHeight + 1;
    window.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
    history.replaceState(null, "", "#" + id);
  });

  const navLinks = [...document.querySelectorAll(".nav__links a")];
  const sectionIO = new IntersectionObserver(
    (entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        navLinks.forEach((l) => l.classList.toggle("is-active", l.getAttribute("href") === "#" + en.target.id));
      });
    },
    { rootMargin: "-45% 0px -50% 0px" }
  );
  ["wall", "brain", "chip", "soma", "road", "lab"].forEach((id) => {
    const s = document.getElementById(id);
    if (s) sectionIO.observe(s);
  });

  /* ------------------------------------------------------------------ */
  /* Reveal on scroll + counters                                         */
  /* ------------------------------------------------------------------ */
  const revealIO = new IntersectionObserver(
    (entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) { en.target.classList.add("is-in"); revealIO.unobserve(en.target); }
      });
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
  );
  document.querySelectorAll(".reveal").forEach((el) => revealIO.observe(el));

  const countIO = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      countIO.unobserve(en.target);
      const to = +en.target.dataset.count;
      if (!to || reduced) return;
      const t0 = performance.now();
      (function step(now) {
        const k = Math.min(1, (now - t0) / 1400);
        en.target.textContent = Math.round(to * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(step);
      })(t0);
    });
  });
  document.querySelectorAll("[data-count]").forEach((el) => countIO.observe(el));

  /* ------------------------------------------------------------------ */
  /* Infinite marquees (speed reacts to scroll velocity)                 */
  /* ------------------------------------------------------------------ */
  const marquees = [];
  function setupMarquee(m) {
    const track = m.querySelector(".marquee__track");
    if (!m.dataset.base) m.dataset.base = track.innerHTML;
    const base = m.dataset.base;
    track.innerHTML = base;
    const perUnit = track.children.length;
    let unitHtml = base, reps = 1;
    while (track.scrollWidth < window.innerWidth * 1.1 && reps < 12) {
      unitHtml += base; reps++;
      track.innerHTML = unitHtml;
    }
    track.innerHTML = unitHtml + unitHtml;
    const kids = track.children;
    const unit = kids[perUnit * reps].offsetLeft - kids[0].offsetLeft;
    return { m, track, unit, x: 0, speed: +m.dataset.speed || 40 };
  }
  document.querySelectorAll("[data-marquee]").forEach((m) => marquees.push(setupMarquee(m)));

  let scrollVel = 0, lastY = window.scrollY, lastT = performance.now();
  if (!reduced) {
    (function mq(now) {
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      scrollVel *= 0.92;
      for (const q of marquees) {
        const dir = Math.sign(q.speed);
        const v = q.speed + dir * Math.min(Math.abs(scrollVel) * 0.35, 900);
        q.x -= v * dt;
        if (q.x <= -q.unit) q.x += q.unit;
        if (q.x > 0) q.x -= q.unit;
        q.track.style.transform = `translate3d(${q.x.toFixed(2)}px,0,0)`;
      }
      requestAnimationFrame(mq);
    })(lastT);
  }

  /* ------------------------------------------------------------------ */
  /* Hero visibility (drives the 3D brain) + back-to-top button          */
  /* ------------------------------------------------------------------ */
  const heroes = [...document.querySelectorAll("[data-hero]")];
  const toTop = document.getElementById("toTop");

  function heroVisibility() {
    const vh = window.innerHeight;
    let v = 0;
    for (const h of heroes) {
      const top = h.getBoundingClientRect().top;
      v = Math.max(v, 1 - Math.min(1, Math.abs(top) / (vh * 0.9)));
    }
    return v;
  }

  function onScroll() {
    const y = window.scrollY;
    const now = performance.now();
    const dt = Math.max(1, now - (onScroll.t || now - 16));
    onScroll.t = now;
    scrollVel = scrollVel * 0.6 + ((y - lastY) / dt) * 1000 * 0.4;
    lastY = y;

    if (toTop) toTop.classList.toggle("show", y > window.innerHeight * 0.8);

    DUME.heroVis = heroVisibility();
    if (DUME.setBrainOpacity) DUME.setBrainOpacity(DUME.heroVis);
    nav.classList.toggle("is-solid", DUME.heroVis < 0.85 || nav.classList.contains("is-open"));
    updateRoad();
  }
  window.addEventListener("scroll", onScroll, { passive: true });

  if (toTop) toTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" }));

  /* ------------------------------------------------------------------ */
  /* Roadmap progress line                                               */
  /* ------------------------------------------------------------------ */
  const road = document.getElementById("roadList");
  function updateRoad() {
    if (!road) return;
    const r = road.getBoundingClientRect();
    const k = Math.max(0, Math.min(1, (window.innerHeight * 0.62 - r.top) / r.height));
    road.style.setProperty("--fill", (k * 100).toFixed(1) + "%");
  }

  /* ------------------------------------------------------------------ */
  /* Compute-in-memory grid (section 01)                                 */
  /* ------------------------------------------------------------------ */
  const cim = document.getElementById("cimGrid");
  if (cim) {
    const cols = 12, rows = 6, s = 24, g = 6;
    const x0 = (420 - (cols * s + (cols - 1) * g)) / 2, y0 = 14;
    const cells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const rect = document.createElementNS(NS, "rect");
        rect.setAttribute("x", x0 + c * (s + g));
        rect.setAttribute("y", y0 + r * (s + g));
        rect.setAttribute("width", s);
        rect.setAttribute("height", s);
        rect.setAttribute("rx", 4);
        cim.appendChild(rect);
        cells.push(rect);
      }
    }
    if (!reduced) {
      DUME.loop(cim.closest("svg"), (() => {
        let acc = 0;
        return (dt) => {
          acc += dt;
          if (acc < 0.09) return;
          acc = 0;
          // sparse, event-driven activity: a few cells compute in place
          const n = 1 + ((Math.random() * 3) | 0);
          for (let i = 0; i < n; i++) {
            const cell = cells[(Math.random() * cells.length) | 0];
            cell.classList.add("on");
            setTimeout(() => cell.classList.remove("on"), 140 + Math.random() * 200);
          }
        };
      })());
    }
  }

  /* ------------------------------------------------------------------ */
  /* Resize                                                              */
  /* ------------------------------------------------------------------ */
  let rT;
  window.addEventListener("resize", () => {
    clearTimeout(rT);
    rT = setTimeout(() => {
      for (let i = 0; i < marquees.length; i++) marquees[i] = setupMarquee(marquees[i].m);
      onScroll();
    }, 150);
  });

  const yr = document.getElementById("year");
  if (yr) yr.textContent = new Date().getFullYear();

  onScroll();
})();
