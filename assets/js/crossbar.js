/* =====================================================================
   Interactive memristive crossbar: I = Σ G·V, leaky integrate-and-fire
   neurons on each column, optional STDP on the stored conductances.
   ===================================================================== */
(function () {
  "use strict";
  const DUME = window.DUME;
  const grid = document.getElementById("xbGrid");
  if (!grid) return;

  const ROWS = 6, COLS = 4;
  const LEVELS = [0.12, 0.38, 0.66, 1];
  const G = [];
  const rowT = new Float32Array(ROWS);       // remaining "voltage on" time per row
  const rowLast = new Float32Array(ROWS).fill(-9);
  const v = new Float32Array(COLS);
  const lastFire = new Float32Array(COLS).fill(-9);
  let auto = true, learn = false, spikes = 0, now = 0;

  const randomise = () => {
    for (let i = 0; i < ROWS; i++) {
      G[i] = G[i] || [];
      for (let j = 0; j < COLS; j++) G[i][j] = LEVELS[(Math.random() * LEVELS.length) | 0];
    }
  };
  randomise();

  // ---- DOM -----------------------------------------------------------
  grid.style.setProperty("--cols", COLS);
  const inputs = [], cells = [], curs = [], neus = [];
  for (let i = 0; i < ROWS; i++) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "xb-in";
    b.innerHTML = `<i></i>in ${i + 1}`;
    b.setAttribute("aria-label", `Send a spike on input ${i + 1}`);
    b.addEventListener("click", () => fireRow(i));
    grid.appendChild(b);
    inputs.push(b);
    cells[i] = [];
    for (let j = 0; j < COLS; j++) {
      const c = document.createElement("div");
      c.className = "xb-cell";
      c.title = "Click to reprogram this synapse";
      c.addEventListener("click", () => {
        const k = LEVELS.indexOf(G[i][j]);
        G[i][j] = LEVELS[(k + 1) % LEVELS.length];
        paintCell(i, j);
      });
      grid.appendChild(c);
      cells[i][j] = c;
    }
  }
  const curLbl = document.createElement("span");
  curLbl.className = "xb-corner";
  curLbl.textContent = "I = ΣG·V";
  grid.appendChild(curLbl);
  for (let j = 0; j < COLS; j++) {
    const s = document.createElement("span");
    s.className = "xb-cur";
    s.textContent = "0.00";
    grid.appendChild(s);
    curs.push(s);
  }
  const neuLbl = document.createElement("span");
  neuLbl.className = "xb-corner";
  neuLbl.textContent = "neuron";
  grid.appendChild(neuLbl);
  for (let j = 0; j < COLS; j++) {
    const n = document.createElement("div");
    n.className = "xb-neuron";
    n.innerHTML = `<div class="v"></div><div class="th"></div><div class="lbl">N${j + 1}</div>`;
    grid.appendChild(n);
    neus.push(n);
  }

  function paintCell(i, j) { cells[i][j].style.setProperty("--g", (0.06 + G[i][j] * 0.7).toFixed(3)); }
  for (let i = 0; i < ROWS; i++) for (let j = 0; j < COLS; j++) paintCell(i, j);

  function fireRow(i) {
    rowT[i] = 0.22;
    rowLast[i] = now;
    if (learn) {
      // pre-after-post → depression
      for (let j = 0; j < COLS; j++) {
        const dtp = now - lastFire[j];
        if (dtp > 0 && dtp < 0.12) { G[i][j] = Math.max(0.05, G[i][j] - 0.06); paintCell(i, j); }
      }
    }
  }

  // ---- controls ------------------------------------------------------
  const btnAuto = document.getElementById("xbAuto");
  const btnLearn = document.getElementById("xbLearn");
  btnAuto.addEventListener("click", () => {
    auto = !auto;
    btnAuto.setAttribute("aria-pressed", String(auto));
    btnAuto.textContent = `Auto spikes: ${auto ? "on" : "off"}`;
  });
  btnLearn.addEventListener("click", () => {
    learn = !learn;
    btnLearn.setAttribute("aria-pressed", String(learn));
    btnLearn.textContent = `STDP learning: ${learn ? "on" : "off"}`;
  });
  document.getElementById("xbReset").addEventListener("click", () => {
    randomise();
    for (let i = 0; i < ROWS; i++) for (let j = 0; j < COLS; j++) paintCell(i, j);
  });
  if (DUME.reduced) btnAuto.click();

  const activeEl = document.getElementById("xbActive");
  const spikesEl = document.getElementById("xbSpikes");

  // ---- simulation ----------------------------------------------------
  DUME.loop(grid, (dt) => {
    now += dt;
    if (auto) for (let i = 0; i < ROWS; i++) if (Math.random() < dt * 1.8) fireRow(i);

    let active = 0;
    for (let i = 0; i < ROWS; i++) {
      const on = rowT[i] > 0;
      if (on) { rowT[i] -= dt; active++; }
      inputs[i].classList.toggle("on", on);
      for (let j = 0; j < COLS; j++) cells[i][j].classList.toggle("flow", on);
    }

    for (let j = 0; j < COLS; j++) {
      let I = 0;
      for (let i = 0; i < ROWS; i++) if (rowT[i] > 0) I += G[i][j];   // Ohm (G·V, V = 1) + Kirchhoff (Σ)
      curs[j].textContent = I.toFixed(2);
      v[j] = v[j] * Math.exp(-dt / 0.45) + I * dt * 2.6;
      if (v[j] >= 1) {
        v[j] = 0;
        lastFire[j] = now;
        spikes++;
        neus[j].classList.add("fire");
        setTimeout(() => neus[j].classList.remove("fire"), 180);
        if (learn) {
          // pre-before-post → potentiation
          for (let i = 0; i < ROWS; i++) {
            const dtp = now - rowLast[i];
            if (dtp >= 0 && dtp < 0.3) {
              G[i][j] = Math.min(1, G[i][j] + 0.09);
              paintCell(i, j);
              const c = cells[i][j];
              c.classList.remove("learn"); void c.offsetWidth; c.classList.add("learn");
            }
          }
        }
      }
      neus[j].querySelector(".v").style.height = `${Math.min(100, (v[j] / 1) * 82).toFixed(1)}%`;
    }
    activeEl.textContent = `${active} / ${ROWS}`;
    spikesEl.textContent = spikes;
  });
})();
