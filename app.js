/* ================================================================
   AIML Quest — Interactive Visual Learning Platform
   Zero dependencies. Canvas-based visualizations.
   ================================================================ */

// ── helpers ──────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const hide = (n) => n.classList.add("hidden");
const show = (n) => n.classList.remove("hidden");
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ── localStorage helpers ─────────────────────────────────────────
const LS_USERS = "aq_users_v2";
const LS_SESS = "aq_sess_v2";
const LS_ACT = "aq_act_v2";
const jparse = (s, fb) => { try { return JSON.parse(s) ?? fb; } catch { return fb; } };
const rLS = (k, fb) => jparse(localStorage.getItem(k), fb);
const wLS = (k, v) => localStorage.setItem(k, JSON.stringify(v));

function nowISO() { return new Date().toISOString(); }
function todayKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
async function sha256(s) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join(""); }

// ── user model ───────────────────────────────────────────────────
function freshUser(email) {
  return { id:`u_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`, email, pw:"", createdAt:nowISO(), pts:0, badges:[], streak:{n:0,d:""}, prog:{mods:{},quiz:{},runs:0,sims:0} };
}
const loadUsers = () => rLS(LS_USERS, []);
const saveUsers = (u) => wLS(LS_USERS, u);
const loadSess = () => rLS(LS_SESS, null);
const saveSess = (s) => wLS(LS_SESS, s);
const clearSess = () => localStorage.removeItem(LS_SESS);

function me() { const s=loadSess(); if(!s?.uid) return null; return loadUsers().find(u=>u.id===s.uid)||null; }
function save(u) { const all=loadUsers(); const i=all.findIndex(x=>x.id===u.id); if(i>=0) all[i]=u; else all.push(u); saveUsers(all); }

function addPts(u, n, reason) {
  const t=todayKey(), y=new Date(); y.setDate(y.getDate()-1);
  const yk=`${y.getFullYear()}-${String(y.getMonth()+1).padStart(2,"0")}-${String(y.getDate()).padStart(2,"0")}`;
  u={...u}; u.streak={...u.streak};
  if(u.streak.d!==t){ u.streak.n = u.streak.d===yk ? u.streak.n+1 : 1; u.streak.d=t; }
  u.pts = Math.max(0,(u.pts||0)+n);
  const a=rLS(LS_ACT,[]); a.push({uid:u.id,t:nowISO(),type:"pts",n,reason}); wLS(LS_ACT,a.slice(-500));
  save(u); return u;
}
function addBadge(u,b){ u={...u}; if(!u.badges.includes(b)){ u.badges=[...u.badges,b]; save(u); } return u; }

// ── routing ──────────────────────────────────────────────────────
let curView = "topics";

function goView(name) {
  curView = name;
  document.querySelectorAll(".view").forEach(v => hide(v));
  const el = $(`v_${name}`);
  if (el) show(el);
  document.querySelectorAll(".navBtn").forEach(b => {
    b.classList.toggle("active", b.dataset.r === name);
  });
  renderView(name);
}

function renderView(name) {
  const u = me();
  if (!u) return;
  const map = {
    topics: renderTopics,
    perceptron: renderPerceptron,
    nn: renderNN,
    dtree: renderDTree,
    knn: renderKNN,
    linreg: renderLinReg,
    quiz: renderQuiz,
    playground: renderPlayground,
    simulate: renderSim,
    progress: renderProgress,
    leaderboard: renderLeaderboard,
  };
  if (map[name]) map[name](u);
}

function refreshView() { renderView(curView); updateChip(); }

// ── tooltip engine ───────────────────────────────────────────────
const tip = $("tooltip");
function showTip(x, y, html) {
  tip.innerHTML = html;
  show(tip);
  const r = tip.getBoundingClientRect();
  const tx = clamp(x + 14, 4, window.innerWidth - r.width - 8);
  const ty = clamp(y - r.height - 10, 4, window.innerHeight - r.height - 8);
  tip.style.left = tx + "px";
  tip.style.top = ty + "px";
}
function hideTip() { hide(tip); }
document.addEventListener("mousemove", () => {}); // keep alive

// ── topic picker ─────────────────────────────────────────────────
const TOPICS = [
  { id:"perceptron", icon:"🧠", title:"Perceptron", desc:"See inputs, weights, summation & activation fire in real time. Drag sliders to change values.", level:"Beginner" },
  { id:"nn",         icon:"🔗", title:"Neural Network", desc:"Multi-layer network with animated forward pass. Watch signals flow layer by layer.", level:"Intermediate" },
  { id:"dtree",      icon:"🌳", title:"Decision Tree",  desc:"Build a tree step by step. See how splits are chosen and data flows down branches.", level:"Beginner" },
  { id:"knn",        icon:"📍", title:"K-Nearest Neighbors", desc:"Place points on a 2D canvas. Click to classify — watch the K closest neighbors vote.", level:"Beginner" },
  { id:"linreg",     icon:"📈", title:"Linear Regression", desc:"Drag data points. Watch the best-fit line update live with loss visualized.", level:"Beginner" },
];

function renderTopics() {
  const root = $("v_topics");
  root.innerHTML = `
    <h2 style="margin:0 0 4px">Choose a topic to explore</h2>
    <p class="sub" style="margin:0 0 16px">Every topic is interactive. No walls of text — just visuals you can touch.</p>
    <div class="topicGrid">
      ${TOPICS.map(t => `
        <div class="topicCard" data-topic="${t.id}">
          <div class="topicIcon">${t.icon}</div>
          <h3>${esc(t.title)}</h3>
          <span class="pill">${esc(t.level)}</span>
          <div class="sub" style="margin-top:6px">${esc(t.desc)}</div>
        </div>
      `).join("")}
    </div>
  `;
  root.querySelectorAll(".topicCard").forEach(c => {
    c.addEventListener("click", () => goView(c.dataset.topic));
  });
}

// ═══════════════════════════════════════════════════════════════
// PERCEPTRON VISUALIZER
// ═══════════════════════════════════════════════════════════════

function renderPerceptron(user) {
  const root = $("v_perceptron");

  const state = { x1:0.6, x2:0.4, w1:0.7, w2:-0.3, bias:-0.2, lr:0.1, step:0 };

  root.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <button class="btn sm ghost" onclick="goView('topics')">← Back</button>
      <h2 style="margin:0">Perceptron — Interactive Visualizer</h2>
    </div>
    <p class="sub">Drag the sliders to change inputs & weights. Hover any part of the diagram to learn what it does. Watch the output change in real time.</p>
    <div class="g2" style="margin-top:12px">
      <div>
        <canvas id="pcCanvas" class="vizCanvas" width="560" height="400"></canvas>
      </div>
      <div>
        <div class="panel" style="margin-bottom:10px">
          <div class="panelTitle">Inputs & Weights</div>
          <div class="sliderRow"><label>x₁</label><input type="range" id="sl_x1" min="-1" max="1" step="0.05" value="${state.x1}"><span class="val" id="vx1">${state.x1.toFixed(2)}</span></div>
          <div class="sliderRow"><label>x₂</label><input type="range" id="sl_x2" min="-1" max="1" step="0.05" value="${state.x2}"><span class="val" id="vx2">${state.x2.toFixed(2)}</span></div>
          <div class="sliderRow"><label>w₁</label><input type="range" id="sl_w1" min="-2" max="2" step="0.05" value="${state.w1}"><span class="val" id="vw1">${state.w1.toFixed(2)}</span></div>
          <div class="sliderRow"><label>w₂</label><input type="range" id="sl_w2" min="-2" max="2" step="0.05" value="${state.w2}"><span class="val" id="vw2">${state.w2.toFixed(2)}</span></div>
          <div class="sliderRow"><label>bias</label><input type="range" id="sl_bias" min="-2" max="2" step="0.05" value="${state.bias}"><span class="val" id="vbias">${state.bias.toFixed(2)}</span></div>
        </div>
        <div class="panel" style="margin-bottom:10px">
          <div class="panelTitle">Live computation</div>
          <div id="pcMath" class="sub" style="font-family:var(--mono);white-space:pre-wrap"></div>
        </div>
        <div class="panel">
          <div class="panelTitle">Step-by-step walkthrough</div>
          <div class="steps" id="pcSteps"></div>
          <div id="pcStepText" class="sub"></div>
        </div>
      </div>
    </div>
  `;

  const canvas = $("pcCanvas");
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = 560 * dpr;
  canvas.height = 400 * dpr;
  ctx.scale(dpr, dpr);

  const W = 560, H = 400;

  const regions = [];

  function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }

  function draw() {
    const { x1, x2, w1, w2, bias } = state;
    const z = x1 * w1 + x2 * w2 + bias;
    const out = sigmoid(z);
    const activated = out > 0.5;

    ctx.clearRect(0, 0, W, H);
    regions.length = 0;

    const nodeR = 28;
    const inputNodes = [
      { label: "x₁", val: x1, x: 80, y: 130, tip: "<b>Input x₁</b><br>A feature value fed into the perceptron. In real ML, this could be a pixel value, word count, sensor reading, etc." },
      { label: "x₂", val: x2, x: 80, y: 270, tip: "<b>Input x₂</b><br>Another feature. The perceptron can have many inputs; we use 2 for visual clarity." },
    ];
    const sumNode = { label: "Σ", x: 280, y: 200, tip: "<b>Weighted Sum (Σ)</b><br>z = x₁·w₁ + x₂·w₂ + bias<br>= " + z.toFixed(3) + "<br>This is the linear combination of inputs and weights." };
    const actNode = { label: "σ", x: 400, y: 200, tip: `<b>Activation (σ = sigmoid)</b><br>σ(z) = 1/(1+e⁻ᶻ) = ${out.toFixed(4)}<br>Squashes any number into (0, 1). Values > 0.5 → class 1.` };
    const outNode = { label: activated ? "1" : "0", x: 500, y: 200, tip: `<b>Output</b><br>${out.toFixed(4)} → <b>${activated ? "Class 1" : "Class 0"}</b><br>The final prediction of this perceptron.` };

    function drawEdge(x1, y1, x2, y2, label, intensity, tipHtml) {
      const alpha = 0.15 + Math.abs(intensity) * 0.7;
      const color = intensity >= 0 ? `rgba(110,231,255,${alpha})` : `rgba(255,107,107,${alpha})`;
      const lw = 1.5 + Math.abs(intensity) * 3;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.stroke();

      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - 10;
      ctx.fillStyle = "rgba(183,192,255,.8)"; ctx.font = "bold 11px var(--mono)";
      ctx.textAlign = "center"; ctx.fillText(label, mx, my);

      regions.push({ x: mx - 30, y: my - 14, w: 60, h: 24, tip: tipHtml });
    }

    drawEdge(inputNodes[0].x + nodeR, inputNodes[0].y, sumNode.x - nodeR, sumNode.y,
      `w₁=${w1.toFixed(2)}`, w1, `<b>Weight w₁</b><br>Multiplied with x₁. Larger |w₁| = x₁ has more influence. Negative = inhibitory.`);
    drawEdge(inputNodes[1].x + nodeR, inputNodes[1].y, sumNode.x - nodeR, sumNode.y,
      `w₂=${w2.toFixed(2)}`, w2, `<b>Weight w₂</b><br>Multiplied with x₂. The perceptron learns by adjusting these weights.`);
    drawEdge(sumNode.x + nodeR, sumNode.y, actNode.x - nodeR, actNode.y,
      `z=${z.toFixed(2)}`, clamp(z / 3, -1, 1), `<b>Weighted sum z</b><br>z = ${z.toFixed(4)}<br>Passed to the activation function.`);
    drawEdge(actNode.x + nodeR, actNode.y, outNode.x - nodeR, outNode.y,
      `${out.toFixed(2)}`, out, `<b>Activation output</b><br>σ(${z.toFixed(2)}) = ${out.toFixed(4)}`);

    ctx.font = "10px var(--mono)"; ctx.fillStyle = "rgba(183,192,255,.5)";
    ctx.textAlign = "center"; ctx.fillText(`bias=${bias.toFixed(2)}`, sumNode.x, sumNode.y + nodeR + 18);
    regions.push({ x: sumNode.x - 30, y: sumNode.y + nodeR + 6, w: 60, h: 18, tip: "<b>Bias</b><br>An extra constant added before activation. Shifts the decision boundary. Like the y-intercept of a line." });

    function drawNode(n, fillColor) {
      ctx.beginPath(); ctx.arc(n.x, n.y, nodeR, 0, Math.PI * 2);
      ctx.fillStyle = fillColor; ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.15)"; ctx.lineWidth = 1.5; ctx.stroke();

      ctx.fillStyle = "#fff"; ctx.font = "bold 16px var(--sans)";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(n.label, n.x, n.y);

      if (n.val !== undefined) {
        ctx.font = "11px var(--mono)"; ctx.fillStyle = "rgba(183,192,255,.7)";
        ctx.fillText(n.val.toFixed(2), n.x, n.y - nodeR - 8);
      }
      ctx.textBaseline = "alphabetic";

      regions.push({ x: n.x - nodeR, y: n.y - nodeR, w: nodeR * 2, h: nodeR * 2, tip: n.tip });
    }

    inputNodes.forEach(n => drawNode(n, "rgba(110,231,255,.18)"));
    drawNode(sumNode, "rgba(167,139,250,.18)");
    drawNode(actNode, "rgba(167,139,250,.25)");
    drawNode(outNode, activated ? "rgba(107,255,184,.25)" : "rgba(255,107,107,.18)");

    // animated pulse on the output
    const pulse = (Date.now() % 1500) / 1500;
    const pr = nodeR + pulse * 14;
    ctx.beginPath(); ctx.arc(outNode.x, outNode.y, pr, 0, Math.PI * 2);
    ctx.strokeStyle = activated ? `rgba(107,255,184,${0.4 - pulse * 0.4})` : `rgba(255,107,107,${0.3 - pulse * 0.3})`;
    ctx.lineWidth = 2; ctx.stroke();

    // flow particles
    const t = (Date.now() % 2000) / 2000;
    function particle(ax, ay, bx, by) {
      const px = lerp(ax, bx, t), py = lerp(ay, by, t);
      ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(110,231,255,${0.7 - t * 0.5})`; ctx.fill();
    }
    particle(inputNodes[0].x + nodeR, inputNodes[0].y, sumNode.x - nodeR, sumNode.y);
    particle(inputNodes[1].x + nodeR, inputNodes[1].y, sumNode.x - nodeR, sumNode.y);
    particle(sumNode.x + nodeR, sumNode.y, actNode.x - nodeR, actNode.y);
    particle(actNode.x + nodeR, actNode.y, outNode.x - nodeR, outNode.y);

    $("pcMath").textContent = `z = x₁·w₁ + x₂·w₂ + bias\n  = ${x1.toFixed(2)}·${w1.toFixed(2)} + ${x2.toFixed(2)}·${w2.toFixed(2)} + ${bias.toFixed(2)}\n  = ${z.toFixed(4)}\n\nσ(z) = 1/(1+e^(-${z.toFixed(2)})) = ${out.toFixed(4)}\n\nOutput: ${out.toFixed(4)} → ${activated ? "Class 1 ✓" : "Class 0 ✗"}`;
  }

  const sliders = ["x1","x2","w1","w2","bias"];
  sliders.forEach(k => {
    const sl = $(`sl_${k}`);
    sl.addEventListener("input", () => { state[k] = parseFloat(sl.value); $(`v${k}`).textContent = state[k].toFixed(2); });
  });

  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (W / rect.width);
    const my = (e.clientY - rect.top) * (H / rect.height);
    for (const r of regions) {
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) {
        showTip(e.clientX, e.clientY, r.tip);
        return;
      }
    }
    hideTip();
  });
  canvas.addEventListener("mouseleave", hideTip);

  // steps walkthrough
  const stepsData = [
    { label: "1", text: "<b>Step 1 — Inputs:</b> Each input (x₁, x₂) represents a feature. Think of it as data the model receives — a pixel brightness, a word count, a sensor value." },
    { label: "2", text: "<b>Step 2 — Weights:</b> Each connection has a weight (w). Weights control <i>how much</i> each input matters. The perceptron learns by adjusting these." },
    { label: "3", text: "<b>Step 3 — Weighted sum:</b> Multiply each input by its weight, add them up, and add the bias: z = x₁·w₁ + x₂·w₂ + bias." },
    { label: "4", text: "<b>Step 4 — Activation:</b> Pass z through an activation function (here sigmoid). This squashes the value into (0, 1), making it interpretable as a probability." },
    { label: "5", text: "<b>Step 5 — Output:</b> If σ(z) > 0.5 → predict class 1, else class 0. That's it — this is the simplest neural unit, and every deep network is built from these." },
  ];
  $("pcSteps").innerHTML = stepsData.map((s, i) =>
    `<div class="stepDot ${i === 0 ? "active" : ""}" data-si="${i}">${s.label}</div>`
  ).join("");
  $("pcStepText").innerHTML = stepsData[0].text;
  $("pcSteps").querySelectorAll(".stepDot").forEach(d => {
    d.addEventListener("click", () => {
      $("pcSteps").querySelectorAll(".stepDot").forEach(x => x.classList.remove("active"));
      d.classList.add("active");
      $("pcStepText").innerHTML = stepsData[parseInt(d.dataset.si)].text;
    });
  });

  // mark module complete
  let u = me();
  if (u && !u.prog.mods.perceptron) {
    u.prog = { ...u.prog, mods: { ...u.prog.mods, perceptron: nowISO() } };
    save(u);
    addPts(u, 50, "module_perceptron");
    addBadge(u, "explorer");
  }

  let raf;
  function loop() { draw(); raf = requestAnimationFrame(loop); }
  loop();

  const obs = new MutationObserver(() => {
    if ($("v_perceptron").classList.contains("hidden")) { cancelAnimationFrame(raf); obs.disconnect(); }
  });
  obs.observe($("v_perceptron"), { attributes: true, attributeFilter: ["class"] });
}

// ═══════════════════════════════════════════════════════════════
// NEURAL NETWORK VISUALIZER
// ═══════════════════════════════════════════════════════════════

function renderNN(user) {
  const root = $("v_nn");
  root.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <button class="btn sm ghost" onclick="goView('topics')">← Back</button>
      <h2 style="margin:0">Neural Network — Forward Pass Visualizer</h2>
    </div>
    <p class="sub">Watch data flow through a 3-layer network. Hover neurons and connections for details. Click <b>Forward Pass</b> to animate.</p>
    <canvas id="nnCanvas" class="vizCanvas" width="700" height="420"></canvas>
    <div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap">
      <button id="nnForward" class="btn primary">Animate forward pass</button>
      <button id="nnRandom" class="btn ghost sm">Randomize weights</button>
    </div>
    <div id="nnInfo" class="panel sub" style="margin-top:10px;font-family:var(--mono);white-space:pre-wrap"></div>
  `;

  const canvas = $("nnCanvas");
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = 700 * dpr; canvas.height = 420 * dpr;
  ctx.scale(dpr, dpr);
  const W = 700, H = 420;

  const layers = [3, 4, 4, 2];
  let weights = [];
  let activations = layers.map(n => new Array(n).fill(0));
  activations[0] = [0.8, 0.4, -0.3];
  let animT = -1;
  const regions = [];

  function initWeights() {
    weights = [];
    for (let l = 0; l < layers.length - 1; l++) {
      const m = [];
      for (let j = 0; j < layers[l + 1]; j++) {
        const row = [];
        for (let i = 0; i < layers[l]; i++) row.push(+(Math.random() * 2 - 1).toFixed(2));
        m.push(row);
      }
      weights.push(m);
    }
  }
  initWeights();

  function forwardPass() {
    for (let l = 1; l < layers.length; l++) {
      for (let j = 0; j < layers[l]; j++) {
        let z = 0;
        for (let i = 0; i < layers[l - 1]; i++) z += activations[l - 1][i] * weights[l - 1][j][i];
        activations[l][j] = 1 / (1 + Math.exp(-z));
      }
    }
  }
  forwardPass();

  function nodePos(l, j) {
    const xGap = W / (layers.length + 1);
    const yGap = H / (layers[l] + 1);
    return { x: xGap * (l + 1), y: yGap * (j + 1) };
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    regions.length = 0;
    const nr = 18;

    for (let l = 0; l < layers.length - 1; l++) {
      for (let j = 0; j < layers[l + 1]; j++) {
        const to = nodePos(l + 1, j);
        for (let i = 0; i < layers[l]; i++) {
          const from = nodePos(l, i);
          const w = weights[l][j][i];
          const alpha = 0.1 + Math.abs(w) * 0.5;
          ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y);
          ctx.strokeStyle = w >= 0 ? `rgba(110,231,255,${alpha})` : `rgba(255,107,107,${alpha})`;
          ctx.lineWidth = 0.8 + Math.abs(w) * 2;
          ctx.stroke();

          const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
          regions.push({ x: mx - 12, y: my - 8, w: 24, h: 16,
            tip: `<b>Weight</b> L${l}→L${l+1} [${i}→${j}]<br>w = ${w.toFixed(3)}<br>${w >= 0 ? "Excitatory (positive)" : "Inhibitory (negative)"}` });
        }
      }
    }

    // particles during animation
    if (animT >= 0 && animT <= 1) {
      const layerIdx = Math.floor(animT * (layers.length - 1));
      const localT = (animT * (layers.length - 1)) - layerIdx;
      if (layerIdx < layers.length - 1) {
        for (let j = 0; j < layers[layerIdx + 1]; j++) {
          for (let i = 0; i < layers[layerIdx]; i++) {
            const from = nodePos(layerIdx, i), to = nodePos(layerIdx + 1, j);
            const px = lerp(from.x, to.x, localT), py = lerp(from.y, to.y, localT);
            ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(110,231,255,${0.8 - localT * 0.5})`; ctx.fill();
          }
        }
      }
    }

    const layerNames = ["Input", ...Array(layers.length - 2).fill("Hidden"), "Output"];
    for (let l = 0; l < layers.length; l++) {
      for (let j = 0; j < layers[l]; j++) {
        const p = nodePos(l, j);
        const a = activations[l][j];
        const bright = 0.1 + Math.abs(a) * 0.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, nr, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(110,231,255,${bright})`; ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,.15)"; ctx.lineWidth = 1; ctx.stroke();

        ctx.fillStyle = "#fff"; ctx.font = "bold 11px var(--mono)";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(a.toFixed(2), p.x, p.y);
        ctx.textBaseline = "alphabetic";

        regions.push({ x: p.x - nr, y: p.y - nr, w: nr * 2, h: nr * 2,
          tip: `<b>${layerNames[l]} neuron [${j}]</b><br>Activation = ${a.toFixed(4)}<br>${l === 0 ? "Raw input value" : "σ(weighted sum of previous layer)"}` });
      }
      ctx.fillStyle = "rgba(183,192,255,.4)"; ctx.font = "11px var(--sans)";
      ctx.textAlign = "center";
      ctx.fillText(layerNames[l] + ` (${layers[l]})`, nodePos(l, 0).x, 20);
    }
  }

  function animForward() {
    animT = 0;
    forwardPass();
    const start = performance.now();
    const dur = 2000;
    function tick(now) {
      animT = Math.min(1, (now - start) / dur);
      draw();
      if (animT < 1) requestAnimationFrame(tick);
      else { animT = -1; draw(); $("nnInfo").textContent = `Output: [${activations[layers.length-1].map(v=>v.toFixed(4)).join(", ")}]\nThe network processed ${layers[0]} inputs through ${layers.length-2} hidden layer(s) to produce ${layers[layers.length-1].length} outputs.`; }
    }
    requestAnimationFrame(tick);
  }

  $("nnForward").addEventListener("click", animForward);
  $("nnRandom").addEventListener("click", () => { initWeights(); forwardPass(); draw(); });

  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (W / rect.width);
    const my = (e.clientY - rect.top) * (H / rect.height);
    for (const r of regions) {
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) { showTip(e.clientX, e.clientY, r.tip); return; }
    }
    hideTip();
  });
  canvas.addEventListener("mouseleave", hideTip);

  draw();
  $("nnInfo").textContent = `Output: [${activations[layers.length-1].map(v=>v.toFixed(4)).join(", ")}]`;

  let u = me();
  if (u && !u.prog.mods.nn) { u.prog = { ...u.prog, mods: { ...u.prog.mods, nn: nowISO() } }; save(u); addPts(u, 50, "module_nn"); }
}

// ═══════════════════════════════════════════════════════════════
// DECISION TREE VISUALIZER
// ═══════════════════════════════════════════════════════════════

function renderDTree(user) {
  const root = $("v_dtree");
  root.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <button class="btn sm ghost" onclick="goView('topics')">← Back</button>
      <h2 style="margin:0">Decision Tree — Step-by-step Builder</h2>
    </div>
    <p class="sub">Click "Grow" to add splits. Hover nodes to see the rule. Watch how the tree classifies data by asking yes/no questions.</p>
    <canvas id="dtCanvas" class="vizCanvas" width="700" height="380"></canvas>
    <div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap">
      <button id="dtGrow" class="btn primary">Grow tree</button>
      <button id="dtReset" class="btn ghost sm">Reset</button>
      <button id="dtClassify" class="btn sm">Classify a sample</button>
    </div>
    <div id="dtInfo" class="panel sub" style="margin-top:10px"></div>
  `;

  const canvas = $("dtCanvas");
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = 700 * dpr; canvas.height = 380 * dpr;
  ctx.scale(dpr, dpr);
  const W = 700, H = 380;

  const questions = [
    { q: "Age > 30?", feat: "age", thresh: 30 },
    { q: "Income > 50k?", feat: "income", thresh: 50 },
    { q: "Has degree?", feat: "degree", thresh: 0.5 },
    { q: "Experience > 5y?", feat: "exp", thresh: 5 },
  ];

  let nodes = [{ id: 0, depth: 0, x: 350, y: 50, rule: "Root", leaf: true, label: "?" }];
  let edges = [];
  let growIdx = 0;
  const regions = [];

  function layout() {
    const byDepth = {};
    nodes.forEach(n => { if (!byDepth[n.depth]) byDepth[n.depth] = []; byDepth[n.depth].push(n); });
    Object.keys(byDepth).forEach(d => {
      const arr = byDepth[d];
      const gap = W / (arr.length + 1);
      arr.forEach((n, i) => { n.x = gap * (i + 1); n.y = 50 + parseInt(d) * 90; });
    });
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    regions.length = 0;

    edges.forEach(e => {
      const from = nodes.find(n => n.id === e.from);
      const to = nodes.find(n => n.id === e.to);
      if (!from || !to) return;
      ctx.beginPath(); ctx.moveTo(from.x, from.y + 22); ctx.lineTo(to.x, to.y - 22);
      ctx.strokeStyle = e.label === "Yes" ? "rgba(107,255,184,.5)" : "rgba(255,107,107,.4)";
      ctx.lineWidth = 2; ctx.stroke();
      const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
      ctx.fillStyle = e.label === "Yes" ? "rgba(107,255,184,.8)" : "rgba(255,107,107,.7)";
      ctx.font = "bold 11px var(--sans)"; ctx.textAlign = "center"; ctx.fillText(e.label, mx - (e.label === "Yes" ? 16 : -16), my);
    });

    nodes.forEach(n => {
      const r = 22;
      if (n.leaf) {
        ctx.beginPath(); ctx.roundRect(n.x - 30, n.y - 18, 60, 36, 10);
        ctx.fillStyle = n.label === "Approve" ? "rgba(107,255,184,.18)" : n.label === "Reject" ? "rgba(255,107,107,.15)" : "rgba(167,139,250,.15)";
        ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,.12)"; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = "#fff"; ctx.font = "bold 11px var(--sans)"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(n.label, n.x, n.y);
      } else {
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(110,231,255,.15)"; ctx.fill();
        ctx.strokeStyle = "rgba(110,231,255,.3)"; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = "#fff"; ctx.font = "bold 10px var(--sans)"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(n.rule, n.x, n.y);
      }
      ctx.textBaseline = "alphabetic";
      regions.push({ x: n.x - 30, y: n.y - 22, w: 60, h: 44,
        tip: n.leaf
          ? `<b>Leaf node</b><br>Prediction: <b>${n.label}</b><br>When we reach this node, we output this label.`
          : `<b>Decision node</b><br>Rule: ${n.rule}<br>Data is split here: items matching "Yes" go left, "No" go right.` });
    });
  }

  function grow() {
    if (growIdx >= questions.length) return;
    const leaves = nodes.filter(n => n.leaf);
    if (leaves.length === 0) return;
    const target = leaves[0];
    const q = questions[growIdx++];
    target.leaf = false;
    target.rule = q.q;

    const yesId = nodes.length;
    const noId = nodes.length + 1;
    const yesLabel = growIdx >= questions.length ? "Approve" : "?";
    const noLabel = growIdx >= questions.length - 1 ? "Reject" : "?";

    nodes.push({ id: yesId, depth: target.depth + 1, x: 0, y: 0, rule: "", leaf: true, label: yesLabel });
    nodes.push({ id: noId, depth: target.depth + 1, x: 0, y: 0, rule: "", leaf: true, label: noLabel });
    edges.push({ from: target.id, to: yesId, label: "Yes" });
    edges.push({ from: target.id, to: noId, label: "No" });
    layout();
    draw();
    $("dtInfo").innerHTML = `Added split: <b>${q.q}</b> — "Yes" branch goes left, "No" goes right.`;
  }

  $("dtGrow").addEventListener("click", grow);
  $("dtReset").addEventListener("click", () => {
    nodes = [{ id: 0, depth: 0, x: 350, y: 50, rule: "Root", leaf: true, label: "?" }];
    edges = []; growIdx = 0; layout(); draw();
    $("dtInfo").innerHTML = "Tree reset. Click Grow to start building.";
  });
  $("dtClassify").addEventListener("click", () => {
    if (growIdx === 0) { $("dtInfo").innerHTML = "Grow the tree first!"; return; }
    const sample = { age: Math.round(Math.random() * 50 + 18), income: Math.round(Math.random() * 80 + 20), degree: Math.random() > 0.5, exp: Math.round(Math.random() * 15) };
    let path = "Sample: age=" + sample.age + ", income=" + sample.income + "k, degree=" + (sample.degree ? "yes" : "no") + ", exp=" + sample.exp + "y\nPath: ";
    const vals = [sample.age > 30, sample.income > 50, sample.degree, sample.exp > 5];
    let nodeId = 0;
    for (let i = 0; i < growIdx; i++) {
      const n = nodes.find(x => x.id === nodeId);
      if (!n || n.leaf) break;
      const yes = vals[i];
      path += n.rule + " → " + (yes ? "Yes" : "No") + " → ";
      const edge = edges.find(e => e.from === nodeId && e.label === (yes ? "Yes" : "No"));
      if (edge) nodeId = edge.to; else break;
    }
    const final = nodes.find(x => x.id === nodeId);
    path += (final ? final.label : "?");
    $("dtInfo").innerHTML = path;
  });

  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (W / rect.width);
    const my = (e.clientY - rect.top) * (H / rect.height);
    for (const r of regions) {
      if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) { showTip(e.clientX, e.clientY, r.tip); return; }
    }
    hideTip();
  });
  canvas.addEventListener("mouseleave", hideTip);

  layout(); draw();

  let u = me();
  if (u && !u.prog.mods.dtree) { u.prog = { ...u.prog, mods: { ...u.prog.mods, dtree: nowISO() } }; save(u); addPts(u, 50, "module_dtree"); }
}

// ═══════════════════════════════════════════════════════════════
// KNN VISUALIZER
// ═══════════════════════════════════════════════════════════════

function renderKNN(user) {
  const root = $("v_knn");
  root.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <button class="btn sm ghost" onclick="goView('topics')">← Back</button>
      <h2 style="margin:0">K-Nearest Neighbors — Interactive 2D</h2>
    </div>
    <p class="sub">Left-click to place <b style="color:#6ee7ff">blue</b> points. Right-click for <b style="color:#ff6b6b">red</b>. Then click <b>Classify</b> and click the canvas to see how KNN votes.</p>
    <div class="g2" style="margin-top:10px">
      <div>
        <canvas id="knnCanvas" class="vizCanvas" width="500" height="400"></canvas>
      </div>
      <div>
        <div class="panel">
          <div class="panelTitle">Controls</div>
          <div class="sliderRow"><label>K</label><input type="range" id="knnK" min="1" max="9" step="2" value="3"><span class="val" id="knnKVal">3</span></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
            <button id="knnClassify" class="btn primary sm">Classify mode</button>
            <button id="knnClear" class="btn ghost sm">Clear</button>
          </div>
        </div>
        <div id="knnInfo" class="panel sub" style="margin-top:10px">Place some points to get started.</div>
      </div>
    </div>
  `;

  const canvas = $("knnCanvas");
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = 500 * dpr; canvas.height = 400 * dpr;
  ctx.scale(dpr, dpr);
  const CW = 500, CH = 400;

  let points = [];
  let classifyMode = false;
  let lastQuery = null;
  let lastNeighbors = [];

  function draw() {
    ctx.clearRect(0, 0, CW, CH);
    ctx.fillStyle = "rgba(6,10,28,.5)"; ctx.fillRect(0, 0, CW, CH);

    if (lastQuery && lastNeighbors.length) {
      lastNeighbors.forEach(n => {
        ctx.beginPath(); ctx.moveTo(lastQuery.x, lastQuery.y); ctx.lineTo(n.x, n.y);
        ctx.strokeStyle = "rgba(167,139,250,.3)"; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]);
      });
    }

    points.forEach(p => {
      ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = p.cls === 0 ? "rgba(110,231,255,.8)" : "rgba(255,107,107,.8)";
      ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,.2)"; ctx.lineWidth = 1; ctx.stroke();
    });

    if (lastQuery) {
      ctx.beginPath(); ctx.arc(lastQuery.x, lastQuery.y, 9, 0, Math.PI * 2);
      ctx.fillStyle = lastQuery.cls === 0 ? "rgba(110,231,255,.5)" : "rgba(255,107,107,.5)";
      ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.font = "bold 8px var(--sans)"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("?", lastQuery.x, lastQuery.y);
      ctx.textBaseline = "alphabetic";
    }
  }

  function classify(qx, qy) {
    const k = parseInt($("knnK").value);
    const dists = points.map(p => ({ ...p, d: Math.hypot(p.x - qx, p.y - qy) }));
    dists.sort((a, b) => a.d - b.d);
    const neighbors = dists.slice(0, k);
    lastNeighbors = neighbors;
    const votes = [0, 0];
    neighbors.forEach(n => votes[n.cls]++);
    const cls = votes[0] >= votes[1] ? 0 : 1;
    lastQuery = { x: qx, y: qy, cls };
    draw();
    $("knnInfo").innerHTML = `K=${k} | Votes: <b style="color:#6ee7ff">Blue ${votes[0]}</b> vs <b style="color:#ff6b6b">Red ${votes[1]}</b> → <b>${cls === 0 ? "Blue" : "Red"}</b>`;
  }

  canvas.addEventListener("click", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (CW / rect.width);
    const my = (e.clientY - rect.top) * (CH / rect.height);
    if (classifyMode && points.length >= 2) { classify(mx, my); return; }
    points.push({ x: mx, y: my, cls: 0 });
    draw();
  });
  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (CW / rect.width);
    const my = (e.clientY - rect.top) * (CH / rect.height);
    points.push({ x: mx, y: my, cls: 1 });
    draw();
  });

  $("knnK").addEventListener("input", () => { $("knnKVal").textContent = $("knnK").value; });
  $("knnClassify").addEventListener("click", () => {
    classifyMode = !classifyMode;
    $("knnClassify").textContent = classifyMode ? "Place mode" : "Classify mode";
    $("knnInfo").innerHTML = classifyMode ? "Click the canvas to classify a point." : "Left-click = blue, right-click = red.";
  });
  $("knnClear").addEventListener("click", () => { points = []; lastQuery = null; lastNeighbors = []; draw(); });

  draw();

  let u = me();
  if (u && !u.prog.mods.knn) { u.prog = { ...u.prog, mods: { ...u.prog.mods, knn: nowISO() } }; save(u); addPts(u, 50, "module_knn"); }
}

// ═══════════════════════════════════════════════════════════════
// LINEAR REGRESSION VISUALIZER
// ═══════════════════════════════════════════════════════════════

function renderLinReg(user) {
  const root = $("v_linreg");
  root.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <button class="btn sm ghost" onclick="goView('topics')">← Back</button>
      <h2 style="margin:0">Linear Regression — Drag to Fit</h2>
    </div>
    <p class="sub">Click to place data points. The best-fit line updates in real time. Watch the loss (MSE) decrease as the line fits the data.</p>
    <div class="g2" style="margin-top:10px">
      <div>
        <canvas id="lrCanvas" class="vizCanvas" width="500" height="400"></canvas>
      </div>
      <div>
        <div id="lrInfo" class="panel sub" style="font-family:var(--mono);white-space:pre-wrap">Click to add points.</div>
        <div style="margin-top:10px"><button id="lrClear" class="btn ghost sm">Clear</button></div>
      </div>
    </div>
  `;

  const canvas = $("lrCanvas");
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = 500 * dpr; canvas.height = 400 * dpr;
  ctx.scale(dpr, dpr);
  const CW = 500, CH = 400;
  let pts = [];

  function fitLine() {
    if (pts.length < 2) return null;
    const n = pts.length;
    let sx = 0, sy = 0, sxy = 0, sx2 = 0;
    pts.forEach(p => { sx += p.x; sy += p.y; sxy += p.x * p.y; sx2 += p.x * p.x; });
    const denom = n * sx2 - sx * sx;
    if (Math.abs(denom) < 1e-10) return null;
    const m = (n * sxy - sx * sy) / denom;
    const b = (sy - m * sx) / n;
    let mse = 0;
    pts.forEach(p => { const pred = m * p.x + b; mse += (p.y - pred) ** 2; });
    mse /= n;
    return { m, b, mse };
  }

  function draw() {
    ctx.clearRect(0, 0, CW, CH);
    ctx.fillStyle = "rgba(6,10,28,.5)"; ctx.fillRect(0, 0, CW, CH);

    const fit = fitLine();
    if (fit) {
      ctx.beginPath();
      ctx.moveTo(0, fit.b);
      ctx.lineTo(CW, fit.m * CW + fit.b);
      ctx.strokeStyle = "rgba(110,231,255,.7)"; ctx.lineWidth = 2; ctx.stroke();

      pts.forEach(p => {
        const pred = fit.m * p.x + fit.b;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, pred);
        ctx.strokeStyle = "rgba(255,107,107,.3)"; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
      });

      $("lrInfo").textContent = `y = ${fit.m.toFixed(3)}·x + ${fit.b.toFixed(3)}\nMSE (loss) = ${fit.mse.toFixed(2)}\nPoints: ${pts.length}\n\nThe red dashed lines show the error for each point.\nThe line minimizes the sum of squared errors.`;
    }

    pts.forEach(p => {
      ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(167,139,250,.8)"; ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.2)"; ctx.lineWidth = 1; ctx.stroke();
    });
  }

  canvas.addEventListener("click", (e) => {
    const rect = canvas.getBoundingClientRect();
    pts.push({ x: (e.clientX - rect.left) * (CW / rect.width), y: (e.clientY - rect.top) * (CH / rect.height) });
    draw();
  });
  $("lrClear").addEventListener("click", () => { pts = []; draw(); $("lrInfo").textContent = "Click to add points."; });

  draw();

  let u = me();
  if (u && !u.prog.mods.linreg) { u.prog = { ...u.prog, mods: { ...u.prog.mods, linreg: nowISO() } }; save(u); addPts(u, 50, "module_linreg"); }
}

// ═══════════════════════════════════════════════════════════════
// QUIZ (re-integrated)
// ═══════════════════════════════════════════════════════════════

const QUIZ_QS = [
  { id:"q1", prompt:"A perceptron computes a weighted sum and then applies…", opts:[{id:"a",t:"A random shuffle"},{id:"b",t:"An activation function"},{id:"c",t:"PCA"},{id:"d",t:"Gradient descent"}], ans:"b", why:"The activation function (e.g., sigmoid) transforms the weighted sum into an output." },
  { id:"q2", prompt:"In KNN, increasing K generally makes the boundary…", opts:[{id:"a",t:"More jagged"},{id:"b",t:"Smoother"},{id:"c",t:"Circular"},{id:"d",t:"Invisible"}], ans:"b", why:"Higher K averages more neighbors, smoothing the decision boundary." },
  { id:"q3", prompt:"A decision tree splits data by choosing the feature that…", opts:[{id:"a",t:"Is alphabetically first"},{id:"b",t:"Best separates the classes"},{id:"c",t:"Has the most missing values"},{id:"d",t:"Was added last"}], ans:"b", why:"Splits are chosen to maximize information gain (or minimize impurity)." },
  { id:"q4", prompt:"Linear regression minimizes which quantity?", opts:[{id:"a",t:"Sum of absolute values"},{id:"b",t:"Sum of squared errors (MSE)"},{id:"c",t:"Number of data points"},{id:"d",t:"Maximum prediction"}], ans:"b", why:"Ordinary Least Squares minimizes the mean squared error between predictions and actual values." },
  { id:"q5", prompt:"In a neural network, a 'hidden layer' is…", opts:[{id:"a",t:"A layer only visible to admins"},{id:"b",t:"A layer between input and output that transforms data"},{id:"c",t:"A layer that stores passwords"},{id:"d",t:"Always the last layer"}], ans:"b", why:"Hidden layers perform intermediate transformations, enabling the network to learn complex patterns." },
];

function renderQuiz(user) {
  const root = $("v_quiz");
  const prev = user.prog.quiz?.main;
  root.innerHTML = `
    <h2>AIML Concepts Quiz</h2>
    <p class="sub">Test your understanding of the visual modules. Instant feedback on every question.</p>
    <form id="quizForm" class="panel" style="margin-top:12px">
      ${QUIZ_QS.map((q, i) => `
        <div style="padding:12px 0;border-bottom:1px solid var(--border)">
          <div style="font-weight:700">${i+1}. ${esc(q.prompt)}</div>
          <div style="display:grid;gap:8px;margin-top:10px">
            ${q.opts.map(o => `<label style="display:flex;gap:10px;cursor:pointer"><input type="radio" name="${q.id}" value="${o.id}" required /><span>${esc(o.t)}</span></label>`).join("")}
          </div>
          <div id="qw_${q.id}" class="sub hidden" style="margin-top:8px"></div>
        </div>
      `).join("")}
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px">
        <button class="btn primary" type="submit">Submit</button>
        <span id="quizRes" class="sub" style="align-self:center"></span>
      </div>
      ${prev ? `<div class="sub" style="margin-top:10px">Last: <b>${prev.s}/${QUIZ_QS.length}</b></div>` : ""}
    </form>
  `;

  $("quizForm").addEventListener("submit", e => {
    e.preventDefault();
    let u = me(); if (!u) return;
    const fd = new FormData(e.currentTarget);
    let sc = 0;
    QUIZ_QS.forEach(q => {
      const a = fd.get(q.id);
      const ok = a === q.ans; if (ok) sc++;
      const w = $(`qw_${q.id}`);
      w.innerHTML = `${ok ? "✅ Correct." : "❌ Nope."} ${esc(q.why)}`;
      show(w);
    });
    const pts = sc * 20;
    u = addPts(u, pts, "quiz");
    u.prog = { ...u.prog, quiz: { ...u.prog.quiz, main: { s: sc, at: todayKey() } } };
    save(u);
    if (sc >= 4) addBadge(u, "quiz_master");
    $("quizRes").innerHTML = `<b>${sc}/${QUIZ_QS.length}</b> — +${pts} pts`;
    updateChip();
  });
}

// ═══════════════════════════════════════════════════════════════
// PLAYGROUND (re-integrated)
// ═══════════════════════════════════════════════════════════════

function runMini(code) {
  const out = [], vars = new Map();
  const lines = String(code).split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));
  function ev(expr) {
    const safe = expr.replace(/[A-Za-z_]\w*/g, n => vars.has(n) ? String(vars.get(n)) : n);
    return Function(`"use strict";return(${safe})`)();
  }
  for (const line of lines) {
    if (line.startsWith("print(") && line.endsWith(")")) {
      const inside = line.slice(6, -1).trim();
      if ((inside.startsWith('"') && inside.endsWith('"')) || (inside.startsWith("'") && inside.endsWith("'")))
        out.push(inside.slice(1, -1));
      else out.push(String(ev(inside)));
    } else if (line.includes("=")) {
      const [l, r] = line.split("=").map(s => s.trim());
      vars.set(l, ev(r));
    } else throw new Error("Unsupported: " + line);
  }
  return out.join("\n");
}

function renderPlayground(user) {
  const root = $("v_playground");
  root.innerHTML = `
    <h2>Coding Playground</h2>
    <p class="sub">A safe mini runner (Python-like). Supports print(), variables, and arithmetic.</p>
    <div class="g2" style="margin-top:12px">
      <div class="panel">
        <div class="panelTitle">Code</div>
        <textarea id="pgCode" class="codeArea" spellcheck="false"># Try it!\nx = 5\ny = x * 3 + 1\nprint(y)\nprint("Hello AIML!")</textarea>
        <button id="pgRun" class="btn primary sm" style="margin-top:10px">Run (+5 pts)</button>
      </div>
      <div class="panel">
        <div class="panelTitle">Output</div>
        <div id="pgOut" class="outBox"></div>
      </div>
    </div>
  `;
  $("pgRun").addEventListener("click", () => {
    let u = me(); if (!u) return;
    try {
      $("pgOut").textContent = runMini($("pgCode").value) || "(no output)";
      u = addPts(u, 5, "playground");
      u.prog = { ...u.prog, runs: (u.prog.runs || 0) + 1 }; save(u);
    } catch (err) { $("pgOut").textContent = "Error: " + (err?.message || err); }
    updateChip();
  });
}

// ═══════════════════════════════════════════════════════════════
// SIMULATION (spam detection, re-integrated)
// ═══════════════════════════════════════════════════════════════

function renderSim(user) {
  const root = $("v_simulate");
  const sim = user.prog.sim || { tp:0, fp:0, tn:0, fn:0 };
  const prec = sim.tp + sim.fp === 0 ? 0 : sim.tp / (sim.tp + sim.fp);
  const rec = sim.tp + sim.fn === 0 ? 0 : sim.tp / (sim.tp + sim.fn);

  root.innerHTML = `
    <h2>Spam Detection Simulation</h2>
    <p class="sub">Type a message. The model scores spam cues. You provide ground truth. Watch precision & recall update live.</p>
    <div class="g2" style="margin-top:12px">
      <div class="panel">
        <div class="panelTitle">Test message</div>
        <textarea id="simMsg" rows="3" placeholder="e.g., WIN a FREE prize!"></textarea>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button id="simSpam" class="btn primary sm">Truth: Spam</button>
          <button id="simHam" class="btn sm">Truth: Not spam</button>
        </div>
        <div id="simPred" class="sub" style="margin-top:10px"></div>
      </div>
      <div class="panel">
        <div class="panelTitle">Live metrics</div>
        <div class="sub">TP: <b>${sim.tp}</b> | FP: <b>${sim.fp}</b> | TN: <b>${sim.tn}</b> | FN: <b>${sim.fn}</b></div>
        <div style="margin-top:8px">
          <div class="sub">Precision: <b>${(prec*100).toFixed(0)}%</b></div>
          <div class="pbar"><div style="width:${Math.round(prec*100)}%"></div></div>
        </div>
        <div style="margin-top:6px">
          <div class="sub">Recall: <b>${(rec*100).toFixed(0)}%</b></div>
          <div class="pbar"><div style="width:${Math.round(rec*100)}%"></div></div>
        </div>
        <button id="simReset" class="btn ghost sm" style="margin-top:10px">Reset</button>
      </div>
    </div>
  `;

  function score(msg) {
    const m = msg.toLowerCase();
    let s = 0;
    [["free",2],["win",2],["click",1],["offer",1],["urgent",1],["money",2],["prize",2],["limited",1]].forEach(([w,p]) => { if (m.includes(w)) s += p; });
    if (m.length > 120) s++;
    return s;
  }

  function label(isSpam) {
    let u = me(); if (!u) return;
    const s = score($("simMsg").value);
    const pred = s >= 3;
    $("simPred").innerHTML = `Score: <b>${s}</b> → predicts <b>${pred ? "Spam" : "Not spam"}</b>`;
    const d = { ...(u.prog.sim || { tp:0, fp:0, tn:0, fn:0 }) };
    if (pred && isSpam) d.tp++; else if (pred && !isSpam) d.fp++; else if (!pred && !isSpam) d.tn++; else d.fn++;
    u.prog = { ...u.prog, sim: d, sims: (u.prog.sims || 0) + 1 }; save(u);
    u = addPts(u, 10, "simulation");
    refreshView();
  }

  $("simSpam").addEventListener("click", () => label(true));
  $("simHam").addEventListener("click", () => label(false));
  $("simReset").addEventListener("click", () => {
    let u = me(); if (!u) return;
    u.prog = { ...u.prog, sim: { tp:0, fp:0, tn:0, fn:0 } }; save(u); refreshView();
  });
}

// ═══════════════════════════════════════════════════════════════
// PROGRESS
// ═══════════════════════════════════════════════════════════════

function renderProgress(user) {
  const root = $("v_progress");
  const modsCompleted = Object.keys(user.prog.mods || {}).length;
  const totalMods = TOPICS.length;
  const pct = Math.round((modsCompleted / totalMods) * 100);

  root.innerHTML = `
    <h2>Progress Dashboard</h2>
    <div class="g2">
      <div class="panel">
        <div class="panelTitle">Stats</div>
        <div class="sub">Points: <b>${user.pts}</b></div>
        <div class="sub">Streak: <b>${user.streak?.n || 0}</b> day(s)</div>
        <div class="sub">Badges: ${user.badges.length ? user.badges.map(b => `<span class="pill pillGlow">${esc(b)}</span>`).join("") : "none yet"}</div>
      </div>
      <div class="panel">
        <div class="panelTitle">Topics explored: ${modsCompleted}/${totalMods}</div>
        <div class="pbar" style="margin-top:8px"><div style="width:${pct}%"></div></div>
        <div class="sub" style="margin-top:6px"><b>${pct}%</b> complete</div>
      </div>
    </div>
    <div class="panel" style="margin-top:12px">
      <div class="panelTitle">Vibethon criteria checklist</div>
      <div class="sub" style="margin-top:6px">✅ Working prototype</div>
      <div class="sub">✅ Structured learning module: <b>${modsCompleted > 0 ? "Yes" : "Not yet"}</b></div>
      <div class="sub">✅ Interactive feature: <b>${(user.prog.runs || 0) + (user.prog.sims || 0) + (user.prog.quiz?.main ? 1 : 0) > 0 ? "Yes" : "Not yet"}</b></div>
      <div class="sub">✅ Progress tracking: <b>Yes</b></div>
      <div class="sub">✅ Gamification: <b>Yes</b></div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// LEADERBOARD
// ═══════════════════════════════════════════════════════════════

function renderLeaderboard() {
  const root = $("v_leaderboard");
  const users = loadUsers().slice().sort((a, b) => (b.pts || 0) - (a.pts || 0)).slice(0, 20);
  root.innerHTML = `
    <h2>Leaderboard</h2>
    <div class="panel">
      <table class="tbl">
        <thead><tr><th>#</th><th>User</th><th style="text-align:right">Points</th><th style="text-align:right">Streak</th><th style="text-align:right">Badges</th></tr></thead>
        <tbody>
          ${users.map((u, i) => `<tr><td>${i+1}</td><td>${esc(u.email)}</td><td style="text-align:right"><b>${u.pts||0}</b></td><td style="text-align:right">${u.streak?.n||0}</td><td style="text-align:right">${u.badges?.length||0}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// AUTH + BOOT
// ═══════════════════════════════════════════════════════════════

let authMode = "login";

function updateChip() {
  const u = me(), c = $("userChip");
  if (!u) { hide(c); return; }
  c.textContent = `${u.email} · ${u.pts||0} pts · streak ${u.streak?.n||0}`;
  show(c);
}

function showApp() { hide($("authView")); show($("appView")); show($("btnLogout")); updateChip(); goView(curView); }
function showAuth() { show($("authView")); hide($("appView")); hide($("btnLogout")); hide($("userChip")); }

function boot() {
  // logo mini animation
  const lc = $("logoCanvas");
  if (lc) {
    const lx = lc.getContext("2d");
    lx.fillStyle = "rgba(110,231,255,.6)";
    lx.beginPath(); lx.arc(18, 18, 6, 0, Math.PI * 2); lx.fill();
    lx.strokeStyle = "rgba(167,139,250,.5)"; lx.lineWidth = 1.5;
    lx.beginPath(); lx.arc(18, 18, 14, 0, Math.PI * 2); lx.stroke();
  }

  $("tabLogin").addEventListener("click", () => { authMode = "login"; $("tabLogin").classList.add("active"); $("tabReg").classList.remove("active"); $("authBtn").textContent = "Login"; });
  $("tabReg").addEventListener("click", () => { authMode = "register"; $("tabReg").classList.add("active"); $("tabLogin").classList.remove("active"); $("authBtn").textContent = "Create account"; });

  $("authForm").addEventListener("submit", async e => {
    e.preventDefault();
    const email = $("inEmail").value.trim().toLowerCase();
    const pw = $("inPw").value;
    try {
      if (!email.includes("@")) throw new Error("Valid email required.");
      if (pw.length < 4) throw new Error("Password too short.");
      const h = await sha256(pw);
      const users = loadUsers();
      const ex = users.find(u => u.email === email);
      if (authMode === "register") {
        if (ex) throw new Error("Account exists.");
        const u = freshUser(email); u.pw = h; users.push(u); saveUsers(users);
        saveSess({ uid: u.id }); showApp();
      } else {
        if (!ex) throw new Error("No account. Register first.");
        if (ex.pw !== h) throw new Error("Wrong password.");
        saveSess({ uid: ex.id }); showApp();
      }
    } catch (err) {
      const e2 = $("authErr"); e2.textContent = err.message; show(e2);
    }
  });

  $("btnLogout").addEventListener("click", () => { clearSess(); showAuth(); });

  $("btnDemo").addEventListener("click", async () => {
    const users = loadUsers();
    if (!users.find(u => u.email === "ada@demo.ai")) {
      const h = await sha256("password");
      const mk = (em, p, b) => { const u = freshUser(em); u.pw = h; u.pts = p; u.badges = b; u.streak = { n: Math.ceil(Math.random()*5), d: todayKey() }; u.prog.mods = { perceptron: nowISO(), nn: nowISO() }; return u; };
      users.push(mk("ada@demo.ai", 280, ["explorer","quiz_master"]));
      users.push(mk("turing@demo.ai", 190, ["explorer"]));
      users.push(mk("grace@demo.ai", 340, ["explorer","quiz_master"]));
      saveUsers(users);
    }
    const ada = loadUsers().find(u => u.email === "ada@demo.ai");
    if (ada) { saveSess({ uid: ada.id }); showApp(); goView("topics"); }
  });

  document.querySelectorAll(".navBtn").forEach(b => {
    b.addEventListener("click", () => goView(b.dataset.r));
  });

  if (me()) showApp(); else showAuth();
}

boot();
