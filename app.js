/* ================================================================
   AIML Quest — Interactive Visual Learning Platform
   Firebase Auth + Canvas-based visualizations.
   ================================================================ */

// ── Firebase Setup ──────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyD3OVuRbT_8uTgOtQpxk_eENtGNe5xwjZs",
  authDomain: "aiml-quest.firebaseapp.com",
  projectId: "aiml-quest",
  storageBucket: "aiml-quest.firebasestorage.app",
  messagingSenderId: "755057288339",
  appId: "1:755057288339:web:aa7ab690492daa70f45966"
};
firebase.initializeApp(firebaseConfig);
const fbAuth = firebase.auth();

// ── Section 1: Helpers ──────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const hide = (n) => n.classList.add("hidden");
const show = (n) => n.classList.remove("hidden");
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const LS_USERS = "aq_users_v3";
const LS_SESS = "aq_sess_v3";
const LS_ACT = "aq_act_v3";
const jparse = (s, fb) => { try { return JSON.parse(s) ?? fb; } catch { return fb; } };
const rLS = (k, fb) => jparse(localStorage.getItem(k), fb);
const wLS = (k, v) => localStorage.setItem(k, JSON.stringify(v));

function nowISO() { return new Date().toISOString(); }
function todayKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
async function sha256(s) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join(""); }

// ── Section 2: Gemini AI Core ───────────────────────────────────
// Calls go through our tiny backend endpoint `/api/gemini`
// so the Gemini key is never shipped to the browser.
const GEMINI_MODELS = ["gemini-2.0-flash-lite","gemini-2.0-flash","gemini-1.5-flash"];
const _geminiQueue = [];
let _geminiRunning = false;
const GEMINI_MIN_GAP = 4200;
let _lastGeminiCall = 0;
function _enqueue(fn) { return new Promise((resolve, reject) => { _geminiQueue.push({ fn, resolve, reject }); _drainQueue(); }); }
async function _drainQueue() { if (_geminiRunning || _geminiQueue.length === 0) return; _geminiRunning = true; const { fn, resolve, reject } = _geminiQueue.shift(); const wait = GEMINI_MIN_GAP - (Date.now() - _lastGeminiCall); if (wait > 0) await new Promise(r => setTimeout(r, wait)); try { resolve(await fn()); } catch (e) { reject(e); } _lastGeminiCall = Date.now(); _geminiRunning = false; _drainQueue(); }
async function _rawGeminiCall(prompt, maxTokens) {
  let lastErr = null;
  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch("/api/gemini", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, maxTokens, model }),
        });
        if (res.status === 429) {
          await new Promise(r => setTimeout(r, (attempt + 1) * 3000 + Math.random() * 2000));
          continue;
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { lastErr = new Error(data?.error?.message || `Gemini ${res.status}`); break; }
        const text = data?.text || "";
        if (text) return text;
        lastErr = new Error("Empty");
      } catch (err) {
        lastErr = err;
        if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
      }
    }
  }
  return "";
}
async function askGemini(prompt, maxTokens = 1024) { return _enqueue(() => _rawGeminiCall(prompt, maxTokens)); }
async function askGeminiJSON(prompt, maxTokens = 1024) { const raw = await askGemini(prompt + "\n\nRespond ONLY with valid JSON, no markdown fences, no extra text.", maxTokens); if (!raw) return null; const cleaned = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim(); try { return JSON.parse(cleaned); } catch { return null; } }
async function generateAIQuiz(topic, level, count = 5) { const prompt = `Generate ${count} multiple-choice quiz questions about "${topic}" for a ${level}-level AI/ML student. Return JSON array of objects with keys: "prompt" (question), "opts" (array of 4 {id,t} objects), "ans" (correct id), "why" (1 sentence explanation)`; return await askGeminiJSON(prompt, 1200); }
async function reviewCode(code) { const prompt = `Review this code briefly (4 bullet points max): what it does, bugs, improvement, encouragement.\n\`\`\`\n${code}\n\`\`\``; return await askGemini(prompt, 400); }
async function explainConcept(term, context) { const prompt = `Explain "${term}" in context of ${context || "AI/ML"} to a beginner. Simple analogy first, then 1-2 sentence technical definition. Under 60 words.`; return await askGemini(prompt, 200); }
const chatHistory = [];
async function chatWithTutor(message) { chatHistory.push({ role: "user", text: message }); const ctx = chatHistory.slice(-8).map(m => `${m.role === "user" ? "Student" : "Tutor"}: ${m.text}`).join("\n"); const reply = await askGemini(`You are a friendly AI/ML tutor. Keep answers concise (2-4 sentences). Use analogies.\n\n${ctx}\n\nTutor:`, 300); chatHistory.push({ role: "tutor", text: reply }); return reply; }

// ── Section 3: User Model ───────────────────────────────────────
function freshUser(email) {
  return { id:`u_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`, email, pw:"", createdAt:nowISO(), pts:0, badges:[], streak:{n:0,d:""}, prog:{mods:{},quiz:{},runs:0,sims:0,games:{}}, onboarded:false, level:"beginner", goal:"" };
}
const loadUsers = () => rLS(LS_USERS, []);
const saveUsers = (u) => wLS(LS_USERS, u);
const loadSess = () => rLS(LS_SESS, null);
const saveSess = (s) => wLS(LS_SESS, s);
const clearSess = () => localStorage.removeItem(LS_SESS);

function me() {
  const fbUser = fbAuth.currentUser;
  if (fbUser) {
    const all = loadUsers();
    let u = all.find(x => x.email === fbUser.email);
    if (!u) {
      u = freshUser(fbUser.email);
      u.id = fbUser.uid;
      all.push(u);
      saveUsers(all);
    }
    return u;
  }
  const s = loadSess();
  if (!s?.uid) return null;
  return loadUsers().find(u => u.id === s.uid) || null;
}
function save(u) { const all=loadUsers(); const i=all.findIndex(x=>x.id===u.id); if(i>=0) all[i]=u; else all.push(u); saveUsers(all); }
function addPts(u, n, reason) { const t=todayKey(), y=new Date(); y.setDate(y.getDate()-1); const yk=`${y.getFullYear()}-${String(y.getMonth()+1).padStart(2,"0")}-${String(y.getDate()).padStart(2,"0")}`; u={...u}; u.streak={...u.streak}; if(u.streak.d!==t){ u.streak.n = u.streak.d===yk ? u.streak.n+1 : 1; u.streak.d=t; } u.pts = Math.max(0,(u.pts||0)+n); const a=rLS(LS_ACT,[]); a.push({uid:u.id,t:nowISO(),type:"pts",n,reason}); wLS(LS_ACT,a.slice(-500)); save(u); return u; }
function addBadge(u,b){ u={...u}; if(!u.badges.includes(b)){ u.badges=[...u.badges,b]; save(u); } return u; }

// ── Section 4: Onboarding ───────────────────────────────────────
const ONBOARD_STEPS = [
  {
    title: "What's your experience with AI/ML?",
    sub: "We'll tailor the learning journey just for you.",
    options: [
      { id: "beginner", icon: "🌱", title: "Brand new", desc: "I've heard of AI but never studied it" },
      { id: "intermediate", icon: "🔧", title: "Some experience", desc: "I know basics like regression, classification" },
      { id: "advanced", icon: "🚀", title: "Experienced", desc: "I've built models and understand the math" },
    ],
    key: "level",
  },
  {
    title: "What's your learning goal?",
    sub: "This helps us pick the right depth and pace for you.",
    options: [
      { id: "understand", icon: "💡", title: "Understand how AI thinks", desc: "Visual intuition for how models work" },
      { id: "build", icon: "🔨", title: "Build & experiment", desc: "Hands-on — I want to tweak things and see results" },
      { id: "career", icon: "🎯", title: "Ace interviews & exams", desc: "Structured prep with quizzes and depth" },
    ],
    key: "goal",
  },
];

let obStep = 0;
let obAnswers = { level: "beginner", goal: "" };

function renderOnboard() {
  const root = $("onboardInner");
  const step = ONBOARD_STEPS[obStep];
  root.innerHTML = `
    <div class="obProgress">${ONBOARD_STEPS.map((_, i) => `<div class="obDot ${i <= obStep ? "active" : ""}"></div>`).join("")}</div>
    <h1>${step.title}</h1>
    <p class="sub">${step.sub}</p>
    <div class="obOptions">
      ${step.options.map(o => `
        <div class="obOpt" data-oid="${o.id}">
          <div class="obIcon">${o.icon}</div>
          <div class="obOptText">
            <h3>${esc(o.title)}</h3>
            <div class="sub">${esc(o.desc)}</div>
          </div>
        </div>
      `).join("")}
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:18px">
      <button id="obBack" class="btn ghost sm" ${obStep === 0 ? "disabled style='opacity:.3'" : ""}>Back</button>
      <button id="obNext" class="btn primary" disabled>Continue</button>
    </div>
  `;
  let selected = "";
  root.querySelectorAll(".obOpt").forEach(opt => {
    opt.addEventListener("click", () => {
      root.querySelectorAll(".obOpt").forEach(o => o.classList.remove("selected"));
      opt.classList.add("selected");
      selected = opt.dataset.oid;
      $("obNext").disabled = false;
    });
  });
  $("obBack").addEventListener("click", () => { if (obStep > 0) { obStep--; renderOnboard(); } });
  $("obNext").addEventListener("click", () => {
    obAnswers[step.key] = selected;
    if (obStep < ONBOARD_STEPS.length - 1) { obStep++; renderOnboard(); return; }
    let u = me();
    if (!u) return;
    u.level = obAnswers.level;
    u.goal = obAnswers.goal;
    u.onboarded = true;
    save(u);
    hide($("onboardView"));
    showApp();
  });
}

function showOnboard() {
  hide($("authView")); hide($("appView"));
  show($("onboardView"));
  obStep = 0;
  obAnswers = { level: "beginner", goal: "" };
  renderOnboard();
}

// ── Section 5: Master Topics Data ───────────────────────────────
const TOPICS = [
  { id:"linreg", icon:"📈", title:"Linear Regression", desc:"Fit a line to data and predict continuous values", level:"Beginner", category:"Supervised",
    subtopics:[
      { id:"linreg_1", title:"What is Regression?", desc:"Understanding prediction of continuous values" },
      { id:"linreg_2", title:"Best-Fit Line", desc:"How the line minimizes errors" },
      { id:"linreg_3", title:"MSE & Loss", desc:"Measuring how wrong predictions are" },
      { id:"linreg_4", title:"Interactive Visualizer", desc:"Drag points, watch the line fit" }
    ]},
  { id:"logreg", icon:"🔀", title:"Logistic Regression", desc:"Classify data into categories using probability curves", level:"Beginner", category:"Supervised",
    subtopics:[
      { id:"logreg_1", title:"From Regression to Classification", desc:"Why a straight line isn't enough for categories" },
      { id:"logreg_2", title:"The Sigmoid Function", desc:"Squashing outputs into probabilities" },
      { id:"logreg_3", title:"Decision Boundary", desc:"Where the model draws the line between classes" },
      { id:"logreg_4", title:"Interactive Visualizer", desc:"Tune w and b, watch the sigmoid and boundary move" }
    ]},
  { id:"perceptron", icon:"🧠", title:"Perceptron", desc:"The simplest neural unit — inputs, weights, and activation", level:"Beginner", category:"Neural Networks",
    subtopics:[
      { id:"perceptron_1", title:"What is a Neuron?", desc:"Biological inspiration for artificial neurons" },
      { id:"perceptron_2", title:"Weights & Bias", desc:"How the perceptron weighs its inputs" },
      { id:"perceptron_3", title:"Activation Functions", desc:"Turning sums into decisions" },
      { id:"perceptron_4", title:"Interactive Visualizer", desc:"Drag sliders, watch the perceptron fire" }
    ]},
  { id:"nn", icon:"🔗", title:"Neural Network", desc:"Multi-layer networks that learn complex patterns", level:"Intermediate", category:"Neural Networks",
    subtopics:[
      { id:"nn_1", title:"Layers & Architecture", desc:"How neurons are organized into layers" },
      { id:"nn_2", title:"Forward Pass", desc:"How data flows through the network" },
      { id:"nn_3", title:"Backpropagation", desc:"How the network learns from mistakes" },
      { id:"nn_4", title:"Interactive Visualizer", desc:"Change inputs, see activations and output update" }
    ]},
  { id:"cnn", icon:"🖼️", title:"Convolutional Neural Net", desc:"Specialized networks that see patterns in images", level:"Advanced", category:"Neural Networks",
    subtopics:[
      { id:"cnn_1", title:"Convolution Operation", desc:"Sliding filters across images to detect features" },
      { id:"cnn_2", title:"Pooling Layers", desc:"Shrinking feature maps while keeping important info" },
      { id:"cnn_3", title:"Feature Hierarchy", desc:"From edges to objects — how CNNs build understanding" },
      { id:"cnn_4", title:"Interactive Visualizer", desc:"Edit a filter and see convolution output" }
    ]},
  { id:"rnn", icon:"🔄", title:"Recurrent Neural Net", desc:"Networks with memory for sequential data", level:"Advanced", category:"Neural Networks",
    subtopics:[
      { id:"rnn_1", title:"Sequences & Time", desc:"Why order matters in language, music, and stock prices" },
      { id:"rnn_2", title:"Hidden State", desc:"The memory that carries information forward" },
      { id:"rnn_3", title:"Vanishing Gradients", desc:"Why basic RNNs forget and how LSTM fixes it" },
      { id:"rnn_4", title:"Interactive Visualizer", desc:"Watch hidden state evolve over a sequence" }
    ]},
  { id:"dtree", icon:"🌳", title:"Decision Tree", desc:"Classify data by asking yes/no questions", level:"Beginner", category:"Supervised",
    subtopics:[
      { id:"dtree_1", title:"Thinking in Questions", desc:"How trees split data with simple rules" },
      { id:"dtree_2", title:"Information Gain", desc:"Choosing the best question to ask" },
      { id:"dtree_3", title:"Overfitting & Pruning", desc:"When the tree learns too much detail" },
      { id:"dtree_4", title:"Interactive Visualizer", desc:"Build a tree step-by-step and classify samples" }
    ]},
  { id:"rf", icon:"🌲", title:"Random Forest", desc:"An ensemble of trees that vote together", level:"Intermediate", category:"Supervised",
    subtopics:[
      { id:"rf_1", title:"Wisdom of Crowds", desc:"Why many weak models beat one strong model" },
      { id:"rf_2", title:"Bagging", desc:"Training each tree on a random subset of data" },
      { id:"rf_3", title:"Feature Randomness", desc:"Each tree sees different features — reducing correlation" },
      { id:"rf_4", title:"Interactive Visualizer", desc:"See how many trees vote and why ensembles help" }
    ]},
  { id:"svm", icon:"⚔️", title:"Support Vector Machine", desc:"Find the widest gap between classes", level:"Intermediate", category:"Supervised",
    subtopics:[
      { id:"svm_1", title:"Maximum Margin", desc:"Why the widest street between classes generalizes best" },
      { id:"svm_2", title:"Support Vectors", desc:"The critical data points that define the boundary" },
      { id:"svm_3", title:"Kernel Trick", desc:"Bending space so curved boundaries become straight" },
      { id:"svm_4", title:"Interactive Visualizer", desc:"Adjust boundary and margin; watch violations" }
    ]},
  { id:"knn", icon:"📍", title:"K-Nearest Neighbors", desc:"Classify by asking your closest neighbors to vote", level:"Beginner", category:"Supervised",
    subtopics:[
      { id:"knn_1", title:"Distance & Similarity", desc:"How closeness in feature space means similarity" },
      { id:"knn_2", title:"Choosing K", desc:"How the number of neighbors changes the boundary" },
      { id:"knn_3", title:"Curse of Dimensionality", desc:"Why KNN struggles in high dimensions" },
      { id:"knn_4", title:"Interactive Visualizer", desc:"Place points and watch neighbors vote" }
    ]},
  { id:"kmeans", icon:"🎯", title:"K-Means Clustering", desc:"Group similar data points into K clusters", level:"Intermediate", category:"Unsupervised",
    subtopics:[
      { id:"kmeans_1", title:"What is Clustering?", desc:"Finding natural groups without labels" },
      { id:"kmeans_2", title:"The Algorithm", desc:"Assign, update centroids, repeat until stable" },
      { id:"kmeans_3", title:"Choosing K", desc:"The elbow method and silhouette scores" },
      { id:"kmeans_4", title:"Interactive Visualizer", desc:"Step assign/update and watch clusters form" }
    ]},
  { id:"pca", icon:"📐", title:"PCA", desc:"Reduce dimensions while keeping the most information", level:"Intermediate", category:"Unsupervised",
    subtopics:[
      { id:"pca_1", title:"The Curse of Dimensions", desc:"Why fewer features can mean better models" },
      { id:"pca_2", title:"Variance & Directions", desc:"Finding the axes of maximum spread" },
      { id:"pca_3", title:"Eigenvalues & Eigenvectors", desc:"The math behind principal components" },
      { id:"pca_4", title:"Interactive Visualizer", desc:"Rotate the axis and see variance captured" }
    ]},
  { id:"naive", icon:"📊", title:"Naive Bayes", desc:"Classify using probability and Bayes' theorem", level:"Beginner", category:"Supervised",
    subtopics:[
      { id:"naive_1", title:"Bayes' Theorem", desc:"Updating beliefs with new evidence" },
      { id:"naive_2", title:"The Naive Assumption", desc:"Treating features as independent — and why it works" },
      { id:"naive_3", title:"Spam Classification", desc:"A classic use case for Naive Bayes" },
      { id:"naive_4", title:"Interactive Visualizer", desc:"Move probabilities and see posterior update" }
    ]},
  { id:"gradient", icon:"⛰️", title:"Gradient Descent", desc:"Optimize models by rolling downhill on the loss surface", level:"Intermediate", category:"Optimization",
    subtopics:[
      { id:"gradient_1", title:"The Loss Landscape", desc:"Visualizing error as a surface to descend" },
      { id:"gradient_2", title:"Learning Rate", desc:"How big each step should be" },
      { id:"gradient_3", title:"SGD & Mini-Batch", desc:"Using subsets of data for faster updates" },
      { id:"gradient_4", title:"Interactive Visualizer", desc:"Step gradient descent and see loss drop" }
    ]},
  { id:"nlp", icon:"💬", title:"NLP Fundamentals", desc:"Teaching machines to understand human language", level:"Advanced", category:"Applied",
    subtopics:[
      { id:"nlp_1", title:"Tokenization", desc:"Breaking text into pieces a model can digest" },
      { id:"nlp_2", title:"Word Embeddings", desc:"Representing words as meaningful vectors" },
      { id:"nlp_3", title:"Attention Mechanism", desc:"How transformers focus on relevant words" },
      { id:"nlp_4", title:"Interactive Visualizer", desc:"Tokenize text and visualize bag-of-words" }
    ]},
  { id:"rl", icon:"🎮", title:"Reinforcement Learning", desc:"Agents that learn by trial, error, and reward", level:"Advanced", category:"Applied",
    subtopics:[
      { id:"rl_1", title:"Agent & Environment", desc:"The loop of observe, act, and receive reward" },
      { id:"rl_2", title:"Reward Signals", desc:"Designing rewards that lead to desired behavior" },
      { id:"rl_3", title:"Exploration vs Exploitation", desc:"Trying new things vs. sticking with what works" },
      { id:"rl_4", title:"Interactive Visualizer", desc:"Simulate ε-greedy exploration on a bandit" }
    ]},
];

const VISUALIZER_MAP = {
  linreg_4: "linreg",
  perceptron_4: "perceptron",
  nn_4: "nn",
  dtree_4: "dtree",
  knn_4: "knn",
};

// ── Section 6: Routing ──────────────────────────────────────────
let curView = "dashboard";

function goView(name) {
  curView = name;
  document.querySelectorAll(".view").forEach(v => hide(v));
  const target = $(`v_${name}`);
  if (target) show(target);
  document.querySelectorAll(".navBtn").forEach(b => {
    b.classList.toggle("active", b.dataset.r === name || (b.dataset.r === "learn" && ["learnTopic","lesson","perceptron","nn","dtree","knn","linreg"].includes(name)));
  });
  renderView(name);
}

function renderView(name) {
  const u = me();
  if (!u) return;
  const map = {
    dashboard: renderDashboard,
    progress: renderProgress,
    learn: renderLearn,
    learnTopic: () => {},
    lesson: () => {},
    perceptron: renderPerceptron,
    nn: renderNN,
    dtree: renderDTree,
    knn: renderKNN,
    linreg: renderLinReg,
    playground: renderPlayground,
    games: renderGames,
    game: () => {},
    quiz: renderQuiz,
    simulate: renderSimulate,
    simulation: () => {},
    leaderboard: renderLeaderboard,
    profile: renderProfile,
  };
  if (map[name]) map[name](u);
}

function refreshView() { goView(curView); }

function showTip(x, y, html) {
  const tip = $("tooltip");
  tip.innerHTML = html;
  tip.style.left = Math.min(x + 12, window.innerWidth - 320) + "px";
  tip.style.top = (y + 12) + "px";
  show(tip);
}
function hideTip() { hide($("tooltip")); }

// ── Section 7: Dashboard ────────────────────────────────────────
function buildHeatmapData(userId) {
  const WEEKS = 26;
  const totalDays = WEEKS * 7;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayOfWeek = today.getDay();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - (totalDays - 1) - dayOfWeek);

  const acts = rLS(LS_ACT, []).filter(a => a.uid === userId);
  const dayCounts = {};
  for (const a of acts) {
    const d = new Date(a.t);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    dayCounts[key] = (dayCounts[key] || 0) + (a.n || 1);
  }

  const cells = [];
  const cur = new Date(startDate);
  const totalCells = totalDays + dayOfWeek;
  let totalContribs = 0;
  let activeDays = 0;

  for (let i = 0; i < totalCells; i++) {
    const key = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,"0")}-${String(cur.getDate()).padStart(2,"0")}`;
    const count = dayCounts[key] || 0;
    const isFuture = cur > today;
    if (count > 0 && !isFuture) { totalContribs += count; activeDays++; }
    cells.push({
      date: new Date(cur),
      key,
      count: isFuture ? -1 : count,
      month: cur.getMonth(),
      day: cur.getDay(),
    });
    cur.setDate(cur.getDate() + 1);
  }

  return { cells, totalContribs, activeDays, startDate, WEEKS };
}

function levelClass(count) {
  if (count <= 0) return "";
  if (count <= 3) return "L1";
  if (count <= 8) return "L2";
  if (count <= 15) return "L3";
  return "L4";
}

function renderHeatmap(userId) {
  const { cells, totalContribs, activeDays, startDate, WEEKS } = buildHeatmapData(userId);
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  const cellsHtml = cells.map(c => {
    if (c.count === -1) return `<div class="heatmapCell" style="opacity:.25" title="Future"></div>`;
    const lv = levelClass(c.count);
    const label = `${c.count} activity pts on ${MONTHS[c.month]} ${c.date.getDate()}`;
    return `<div class="heatmapCell ${lv}" title="${label}"></div>`;
  }).join("");

  const monthLabels = [];
  let lastMonth = -1;
  let colIndex = 0;
  for (let i = 0; i < cells.length; i += 7) {
    const m = cells[i].month;
    if (m !== lastMonth) {
      monthLabels.push({ month: MONTHS[m], col: colIndex });
      lastMonth = m;
    }
    colIndex++;
  }
  const totalCols = Math.ceil(cells.length / 7);
  const colW = 16;
  const monthsHtml = monthLabels.map((m, i) => {
    const next = monthLabels[i + 1] ? monthLabels[i + 1].col : totalCols;
    const span = next - m.col;
    return `<span style="width:${span * colW}px">${m.month}</span>`;
  }).join("");

  return `
    <div class="heatmapWrap">
      <div class="heatmapHeader">
        <h3>Activity Map</h3>
        <div class="heatmapCount"><b>${totalContribs}</b> pts across <b>${activeDays}</b> active days</div>
      </div>
      <div class="heatmapScroll">
        <div class="heatmapGrid" style="grid-template-columns:repeat(${totalCols},13px)">
          ${cellsHtml}
        </div>
      </div>
      <div class="heatmapFooter">
        <div class="heatmapMonths">${monthsHtml}</div>
        <div class="heatmapLegend">
          Less
          <div class="heatmapCell" style="cursor:default"></div>
          <div class="heatmapCell L1" style="cursor:default"></div>
          <div class="heatmapCell L2" style="cursor:default"></div>
          <div class="heatmapCell L3" style="cursor:default"></div>
          <div class="heatmapCell L4" style="cursor:default"></div>
          More
        </div>
      </div>
    </div>`;
}

function renderDashboard(user) {
  const root = $("v_dashboard");
  const modsCompleted = Object.keys(user.prog.mods || {}).length;
  const topicsDone = TOPICS.filter(t => {
    const subs = t.subtopics;
    return subs.every(s => user.prog.mods[s.id]);
  }).length;
  const acts = rLS(LS_ACT, []).filter(a => a.uid === user.id).slice(-5).reverse();

  const nextTopic = TOPICS.find(t => !t.subtopics.every(s => user.prog.mods[s.id]));

  root.innerHTML = `
    <h2 style="margin:0 0 16px">Welcome back, ${esc(user.email.split("@")[0])}!</h2>
    <div class="dashGrid">
      <div class="statCard"><div class="statVal">${user.pts || 0}</div><div class="statLabel">Points</div></div>
      <div class="statCard"><div class="statVal">${user.streak?.n || 0}</div><div class="statLabel">Day Streak</div></div>
      <div class="statCard"><div class="statVal">${topicsDone}/16</div><div class="statLabel">Topics Done</div></div>
      <div class="statCard"><div class="statVal">${user.badges?.length || 0}</div><div class="statLabel">Badges</div></div>
    </div>
    ${renderHeatmap(user.id)}
    ${nextTopic ? `
    <div class="resumeCard" id="resumeCard">
      <div style="display:flex;align-items:center;gap:12px">
        <span style="font-size:32px">${nextTopic.icon}</span>
        <div>
          <h3 style="margin:0">Continue Learning</h3>
          <div class="sub">${esc(nextTopic.title)} — ${esc(nextTopic.desc)}</div>
        </div>
      </div>
      <button class="btn primary sm" id="resumeBtn">Continue</button>
    </div>` : `<div class="resumeCard"><h3>All topics complete! Try the quiz or games.</h3></div>`}
    <div class="panel" style="margin-top:16px">
      <div class="panelTitle">Recent Activity</div>
      ${acts.length === 0 ? '<div class="sub">No activity yet. Start learning!</div>' :
        acts.map(a => `<div class="sub" style="padding:4px 0;border-bottom:1px solid var(--light-border)">+${a.n} pts — ${esc(a.reason)} <span style="opacity:.5">${new Date(a.t).toLocaleTimeString()}</span></div>`).join("")}
    </div>
  `;

  if (nextTopic) {
    $("resumeBtn").addEventListener("click", () => openTopic(nextTopic.id));
    $("resumeCard").style.cursor = "pointer";
    $("resumeCard").addEventListener("click", (e) => {
      if (e.target.id !== "resumeBtn") openTopic(nextTopic.id);
    });
  }
}

// ── Progress Module ───────────────────────────────────────────────
function renderProgress(user) {
  const root = $("v_progress");
  const mods = user.prog?.mods || {};
  const totalLessons = TOPICS.reduce((acc, t) => acc + (t.subtopics?.length || 0), 0);
  const lessonsDone = Object.keys(mods).length;
  const lessonPct = totalLessons ? Math.round((lessonsDone / totalLessons) * 100) : 0;

  const topics = TOPICS.map(t => {
    const total = t.subtopics.length;
    const done = t.subtopics.filter(s => mods[s.id]).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    const nextSub = t.subtopics.find(s => !mods[s.id]) || null;
    const lastDoneIso = t.subtopics
      .map(s => mods[s.id])
      .filter(Boolean)
      .sort()
      .slice(-1)[0] || null;
    return { ...t, total, done, pct, nextSub, lastDoneIso };
  });

  const topicsDone = topics.filter(t => t.done === t.total && t.total > 0).length;
  const nextTopic = topics.find(t => t.nextSub) || null;

  const recent = Object.entries(mods)
    .map(([id, iso]) => ({ id, iso }))
    .sort((a, b) => (a.iso < b.iso ? 1 : -1))
    .slice(0, 8)
    .map(r => {
      const t = TOPICS.find(tp => tp.subtopics.some(s => s.id === r.id));
      const s = t?.subtopics.find(st => st.id === r.id);
      if (!t || !s) return null;
      return { topicId: t.id, topicTitle: t.title, subTitle: s.title, iso: r.iso, icon: t.icon };
    })
    .filter(Boolean);

  root.innerHTML = `
    <h2 style="margin:0 0 4px">Progress</h2>
    <p class="sub" style="margin:0 0 16px">Track your learning across topics and lessons.</p>

    <div class="panel" style="margin-bottom:16px">
      <div class="g3">
        <div class="statCard" style="box-shadow:none;background:var(--canvas)">
          <div class="statVal">${lessonPct}%</div>
          <div class="statLabel">Overall completion</div>
        </div>
        <div class="statCard" style="box-shadow:none;background:var(--canvas)">
          <div class="statVal">${lessonsDone}/${totalLessons}</div>
          <div class="statLabel">Lessons done</div>
        </div>
        <div class="statCard" style="box-shadow:none;background:var(--canvas)">
          <div class="statVal">${topicsDone}/16</div>
          <div class="statLabel">Topics completed</div>
        </div>
      </div>
      <div class="pbar" style="margin-top:14px"><div style="width:${lessonPct}%"></div></div>
      ${nextTopic ? `
        <div class="sub" style="margin-top:10px">
          Next up: <b>${esc(nextTopic.title)}</b> — ${esc(nextTopic.nextSub?.title || "")}
          <button class="btn sm" id="progResumeBtn" type="button" style="margin-left:10px">Resume</button>
        </div>
      ` : `<div class="sub" style="margin-top:10px">Everything complete. Try the quiz or games to keep practicing.</div>`}
    </div>

    <div class="g2">
      <div class="panel">
        <div class="panelTitle">By topic</div>
        <div style="display:grid;gap:10px;margin-top:10px">
          ${topics.map(t => `
            <div class="stNode" data-tid="${esc(t.id)}" style="margin:0;cursor:pointer">
              <div style="width:34px;text-align:center;font-size:22px;line-height:28px">${t.icon}</div>
              <div class="stInfo" style="flex:1">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
                  <div class="stTitle">${esc(t.title)}</div>
                  <div class="sub" style="white-space:nowrap">${t.done}/${t.total}</div>
                </div>
                <div class="pbar" style="margin:8px 0 6px"><div style="width:${t.pct}%"></div></div>
                <div class="sub">
                  ${t.done === t.total
                    ? `Completed ${t.lastDoneIso ? `• last: ${new Date(t.lastDoneIso).toLocaleDateString()}` : ""}`
                    : `Next: ${esc(t.nextSub?.title || "—")}`}
                </div>
              </div>
            </div>
          `).join("")}
        </div>
      </div>

      <div class="panel">
        <div class="panelTitle">Recent completions</div>
        ${recent.length === 0
          ? `<div class="sub" style="margin-top:10px">No completed lessons yet. Open a topic and tap “Mark Complete”.</div>`
          : `<div class="activityList" style="margin-top:10px">
              ${recent.map(r => `
                <div class="actItem" data-tid="${esc(r.topicId)}">
                  <div class="actDot" style="background:var(--success)"></div>
                  <div style="flex:1">
                    <div style="font-weight:700">${esc(r.topicTitle)} — ${esc(r.subTitle)}</div>
                    <div class="sub">${new Date(r.iso).toLocaleString()}</div>
                  </div>
                  <button class="btn sm" type="button" data-open="1">Open</button>
                </div>
              `).join("")}
            </div>`}
      </div>
    </div>
  `;

  const resumeBtn = $("progResumeBtn");
  if (resumeBtn && nextTopic) resumeBtn.addEventListener("click", () => openLesson(nextTopic.id, nextTopic.nextSub.id));

  root.querySelectorAll("[data-tid]").forEach(el => {
    el.addEventListener("click", (e) => {
      const tid = el.dataset.tid;
      if (!tid) return;
      // if "Open" button inside recent list, still open topic (simple + consistent)
      openTopic(tid);
    });
  });
}

function renderProfile(user) {
  const root = $("v_profile");
  const mods = user.prog?.mods || {};
  const totalLessons = TOPICS.reduce((acc, t) => acc + (t.subtopics?.length || 0), 0);
  const lessonsDone = Object.keys(mods).length;
  const lessonPct = totalLessons ? Math.round((lessonsDone / totalLessons) * 100) : 0;
  const totalTopics = TOPICS.length || 1;
  const topicsDone = TOPICS.filter(t => t.subtopics.every(s => mods[s.id])).length;

  root.innerHTML = `
    <h2 style="margin:0 0 4px">Profile</h2>
    <p class="sub" style="margin:0 0 16px">Your account and learning stats.</p>

    <div class="g2" style="gap:12px">
      <div class="panel">
        <div class="panelTitle">Account</div>
        <div class="sub" style="margin-top:10px"><b>Email:</b> ${esc(user.email)}</div>
        <div class="sub" style="margin-top:6px"><b>Joined:</b> ${user.createdAt ? new Date(user.createdAt).toLocaleDateString() : "—"}</div>
        <div class="sub" style="margin-top:12px"><b>Badges:</b> ${user.badges?.length ? user.badges.map(b => `<span class="pill" style="margin-right:6px">${esc(b)}</span>`).join("") : "—"}</div>

        <div style="margin-top:14px;display:grid;gap:10px">
          <label style="display:grid;gap:6px">
            <span class="sub" style="font-weight:600">Level</span>
            <select id="profLevel">
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </label>
          <label style="display:grid;gap:6px">
            <span class="sub" style="font-weight:600">Goal</span>
            <select id="profGoal">
              <option value="">—</option>
              <option value="understand">Understand</option>
              <option value="build">Build</option>
              <option value="career">Career</option>
            </select>
          </label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button id="profSave" class="btn primary sm" type="button">Save</button>
            <button id="profLogout" class="btn sm ghost" type="button">Logout</button>
          </div>
          <div id="profMsg" class="sub hidden" style="padding:10px;border-radius:10px;background:rgba(107,158,158,.12)"></div>
        </div>
      </div>

      <div class="panel">
        <div class="panelTitle">Learning</div>
        <div class="g3" style="margin-top:10px">
          <div class="statCard" style="box-shadow:none;background:var(--canvas)">
            <div class="statVal">${user.pts || 0}</div>
            <div class="statLabel">Points</div>
          </div>
          <div class="statCard" style="box-shadow:none;background:var(--canvas)">
            <div class="statVal">${user.streak?.n || 0}</div>
            <div class="statLabel">Streak</div>
          </div>
          <div class="statCard" style="box-shadow:none;background:var(--canvas)">
            <div class="statVal">${lessonsDone}/${totalLessons}</div>
            <div class="statLabel">Lessons done</div>
          </div>
        </div>
        <div class="sub" style="margin-top:10px">${topicsDone} of ${totalTopics} topics completed</div>
        <div class="pbar" style="margin-top:10px"><div style="width:${lessonPct}%"></div></div>
      </div>
    </div>
  `;

  const levelEl = $("profLevel");
  const goalEl = $("profGoal");
  if (levelEl) levelEl.value = user.level || "beginner";
  if (goalEl) goalEl.value = user.goal || "";

  const msg = $("profMsg");
  const showMsg = (t) => { if (!msg) return; msg.textContent = t; msg.classList.remove("hidden"); setTimeout(() => msg.classList.add("hidden"), 1800); };

  $("profSave")?.addEventListener("click", () => {
    let u = me();
    if (!u) return;
    u = { ...u, level: levelEl?.value || u.level, goal: goalEl?.value || u.goal };
    save(u);
    updateChip();
    showMsg("Saved.");
  });

  $("profLogout")?.addEventListener("click", () => {
    fbAuth.signOut();
    clearSess();
    showAuth();
  });
}

// ── Section 8: Learn Module ─────────────────────────────────────
function renderLearn(user) {
  user = user || me();
  if (!user) return;
  const root = $("v_learn");
  const totalTopics = TOPICS.length || 1;
  const topicsDone = TOPICS.filter(t => t.subtopics.every(s => user.prog.mods[s.id])).length;

  root.innerHTML = `
    <h2 style="margin:0 0 4px">Learn AI/ML</h2>
    <p class="sub" style="margin:0 0 16px">${topicsDone} of ${totalTopics} topics completed</p>
    <div class="pbar" style="margin-bottom:18px"><div style="width:${Math.round((topicsDone/totalTopics)*100)}%"></div></div>
    <div class="learnGrid">
      ${TOPICS.map(t => {
        const done = t.subtopics.filter(s => user.prog.mods[s.id]).length;
        const total = t.subtopics.length;
        const pct = Math.round((done/total)*100);
        return `
        <div class="learnCard" data-tid="${t.id}">
          <div class="learnCardIcon">${t.icon}</div>
          <h3>${esc(t.title)}</h3>
          <div class="sub" style="margin:4px 0 8px">${esc(t.desc)}</div>
          <span class="pill">${esc(t.level)}</span>
          <div class="pbar" style="margin-top:auto;padding-top:10px"><div style="width:${pct}%"></div></div>
          <div class="sub" style="font-size:11px;margin-top:4px">${done}/${total} done</div>
        </div>`;
      }).join("")}
    </div>
  `;

  root.querySelectorAll(".learnCard").forEach(c => {
    c.addEventListener("click", () => openTopic(c.dataset.tid));
  });
}

function openTopic(topicId) {
  const topic = TOPICS.find(t => t.id === topicId);
  if (!topic) return;
  curView = "learnTopic";
  document.querySelectorAll(".view").forEach(v => hide(v));
  const root = $("v_learnTopic");
  show(root);
  document.querySelectorAll(".navBtn").forEach(b => {
    b.classList.toggle("active", b.dataset.r === "learn");
  });

  const user = me();
  if (!user) return;
  const done = topic.subtopics.filter(s => user.prog.mods[s.id]).length;
  const total = topic.subtopics.length;
  const pct = Math.round((done/total)*100);

  let firstIncomplete = topic.subtopics.findIndex(s => !user.prog.mods[s.id]);
  if (firstIncomplete === -1) firstIncomplete = total;

  root.innerHTML = `
    <button class="btn sm ghost" onclick="goView('learn')" style="margin-bottom:12px">← Back to topics</button>
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px">
      <span style="font-size:40px">${topic.icon}</span>
      <div>
        <h2 style="margin:0">${esc(topic.title)}</h2>
        <div class="sub">${esc(topic.desc)}</div>
        <span class="pill" style="margin-top:6px">${esc(topic.level)}</span>
        <span class="pill" style="margin-top:6px">${esc(topic.category)}</span>
      </div>
    </div>
    <div class="topicProgress">
      <div class="sub" style="margin-bottom:6px">${done} of ${total} subtopics done</div>
      <div class="pbar"><div style="width:${pct}%"></div></div>
    </div>
    <div class="subtopicList">
      ${topic.subtopics.map((s, i) => {
        const isDone = !!user.prog.mods[s.id];
        const isCurrent = i === firstIncomplete;
        const isLocked = i > firstIncomplete;
        const stateClass = isDone ? "done" : isCurrent ? "current" : "locked";
        return `
        <div class="stNode ${stateClass}" data-sid="${s.id}" data-tid="${topicId}">
          <div class="stDot">${isDone ? "✓" : (i + 1)}</div>
          <div class="stContent">
            <div class="stTitle">${esc(s.title)}</div>
            <div class="sub">${esc(s.desc)}</div>
          </div>
          ${isLocked ? '<span class="sub" style="margin-left:auto">🔒</span>' : ''}
        </div>`;
      }).join("")}
    </div>
  `;

  root.querySelectorAll(".stNode:not(.locked)").forEach(node => {
    node.style.cursor = "pointer";
    node.addEventListener("click", () => {
      openLesson(node.dataset.tid, node.dataset.sid);
    });
  });
}

function openLesson(topicId, subtopicId) {
  curView = "lesson";
  document.querySelectorAll(".view").forEach(v => hide(v));
  show($("v_lesson"));
  document.querySelectorAll(".navBtn").forEach(b => {
    b.classList.toggle("active", b.dataset.r === "learn");
  });
  const user = me();
  if (user) renderLesson(topicId, subtopicId, user);
}

// ── Section 9: Lesson Renderer + Content ────────────────────────
const LESSON_CONTENT = {
  linreg_1: `
    <div class="concept">
      <h3>What is Regression?</h3>
      <p><b>Analogy:</b> Imagine you're a real estate agent who has seen thousands of house sales. When someone asks "How much is my 1500 sq ft house worth?", you mentally draw a trend from your experience. That mental trend is regression.</p>
      <p>Regression predicts a <b>continuous number</b> — not a category, but a value on a number line. The price of a house, tomorrow's temperature, or how many minutes a delivery will take.</p>
    </div>
    <div class="formula">y = f(x) + ε<br><span class="sub">Output = Function of input + Random noise</span></div>
    <div class="interactive">
      <b>Think about it:</b> Name three things in your daily life that could be predicted with regression. Consider: How much sleep you need based on hours worked? The time your commute takes based on departure time? Your phone battery % based on hours of use.
    </div>`,

  linreg_2: `
    <div class="concept">
      <h3>The Best-Fit Line</h3>
      <p><b>Analogy:</b> Imagine laying a ruler across a scatter of dots on paper. You'd tilt it until it "splits the difference" — roughly equal dots above and below. That's what regression does, but mathematically.</p>
      <p>The best-fit line minimizes the total distance between itself and every data point. We use <b>Ordinary Least Squares (OLS)</b> — find the line where the sum of squared vertical distances is smallest.</p>
    </div>
    <div class="formula">y = mx + b<br><span class="sub">m = slope (rise/run), b = y-intercept (where line crosses y-axis)</span></div>
    <div class="formula">m = (nΣxy - ΣxΣy) / (nΣx² - (Σx)²)<br><span class="sub">This closed-form solution gives the exact optimal slope</span></div>
    <div class="interactive">
      <b>Try it:</b> Given points (1,2), (2,4), (3,5) — the slope m ≈ 1.5. If you moved the third point to (3,6), the slope becomes exactly 2.0 — a perfect line! Why does one point shift matter so much?
    </div>`,

  linreg_3: `
    <div class="concept">
      <h3>MSE & Loss Functions</h3>
      <p><b>Analogy:</b> Think of a dartboard. Each dart is a prediction, the bullseye is the true value. MSE measures the average <i>squared</i> distance of your darts from center. Squaring means big misses are punished much more than small ones.</p>
      <p>The <b>Mean Squared Error</b> tells us how wrong our model is on average. A lower MSE = better fit. Training a model is just searching for the line that makes MSE as small as possible.</p>
    </div>
    <div class="formula">MSE = (1/n) Σ(yᵢ - ŷᵢ)²<br><span class="sub">Average of (actual - predicted)² across all points</span></div>
    <div class="interactive">
      <b>Think about it:</b> If your model predicts [3, 5, 7] but actual values are [2, 5, 10], MSE = ((1)² + (0)² + (3)²) / 3 = 10/3 ≈ 3.33. Notice the 3-unit error on point 3 contributes 9 — that's 90% of the total loss! This is why outliers matter.
    </div>`,

  logreg_1: `
    <div class="concept">
      <h3>From Regression to Classification</h3>
      <p><b>Analogy:</b> Imagine a straight line predicting "Will this email be spam?" If the line outputs 0.7, does that mean "70% spam"? A straight line can output values like -5 or 23 — those don't make sense as probabilities!</p>
      <p>Linear regression gives unbounded outputs. For classification, we need outputs between 0 and 1. Logistic regression wraps a linear model inside a <b>sigmoid function</b> that squashes any number into the (0, 1) range.</p>
    </div>
    <div class="formula">Linear: z = wx + b (unbounded)<br>Logistic: P(y=1) = σ(z) = 1/(1+e⁻ᶻ) (bounded 0-1)</div>
    <div class="interactive">
      <b>Think about it:</b> Why can't we just round linear regression output to 0 or 1? Consider what happens when a point is very far from the boundary — the linear model might output 100, but σ(100) ≈ 1.0. The sigmoid gracefully handles extremes.
    </div>`,

  logreg_2: `
    <div class="concept">
      <h3>The Sigmoid Function</h3>
      <p><b>Analogy:</b> A dimmer switch for a light. Turn the knob far left → light is off (0). Far right → fully on (1). In between, it smoothly transitions. The sigmoid does the same to numbers.</p>
      <p>The sigmoid function σ(z) = 1/(1+e⁻ᶻ) maps any real number to a value between 0 and 1. At z=0, output is 0.5 (maximum uncertainty). Large positive z → near 1. Large negative z → near 0.</p>
    </div>
    <div class="formula">σ(z) = 1 / (1 + e⁻ᶻ)<br><span class="sub">σ(0) = 0.5, σ(5) ≈ 0.993, σ(-5) ≈ 0.007</span></div>
    <div class="interactive">
      <b>Quick math:</b> Calculate σ(0), σ(2), and σ(-2) in your head. Remember: σ(0) = 0.5 always. σ(2) ≈ 0.88. σ(-2) ≈ 0.12. Notice they're symmetric: σ(z) + σ(-z) = 1 always!
    </div>`,

  logreg_3: `
    <div class="concept">
      <h3>Decision Boundary</h3>
      <p><b>Analogy:</b> Imagine a country border on a map. On one side, people speak French; on the other, German. The border is where the model says "50% chance of either class." Logistic regression draws this border as a straight line.</p>
      <p>The decision boundary is where σ(z) = 0.5, which means z = 0, which means wx + b = 0. Everything on one side is classified as class 0, the other as class 1.</p>
    </div>
    <div class="formula">Decision boundary: w₁x₁ + w₂x₂ + b = 0<br><span class="sub">A line (or hyperplane) in feature space</span></div>
    <div class="interactive">
      <b>Think about it:</b> If w₁=2, w₂=-1, b=1, the boundary is 2x₁ - x₂ + 1 = 0 → x₂ = 2x₁ + 1. Any point above this line gets one class, below gets the other. What happens if you change b to 3?
    </div>`,

  logreg_4: `
    <div class="concept">
      <h3>Log Loss (Cross-Entropy)</h3>
      <p><b>Analogy:</b> Imagine a weather forecaster. If they say "90% chance of rain" and it rains, they were good. If they say "90% no rain" and it rains, they were very wrong. Log loss punishes confident wrong predictions harshly.</p>
      <p><b>Log loss</b> (binary cross-entropy) measures how good the predicted probabilities are. Unlike MSE, it's designed specifically for probability outputs and penalizes confident mistakes exponentially.</p>
    </div>
    <div class="formula">L = -[y·log(p) + (1-y)·log(1-p)]<br><span class="sub">y = true label (0 or 1), p = predicted probability</span></div>
    <div class="interactive">
      <b>Calculate:</b> If true label y=1 and model predicts p=0.9: L = -log(0.9) ≈ 0.105. Good! But if p=0.1: L = -log(0.1) ≈ 2.303. That's 22x worse. Confident wrong answers are devastating!
    </div>`,

  perceptron_1: `
    <div class="concept">
      <h3>What is an Artificial Neuron?</h3>
      <p><b>Analogy:</b> Your brain has ~86 billion neurons. Each one collects electrical signals from neighbors, adds them up, and if the total exceeds a threshold, it fires its own signal. An artificial neuron does the same thing with numbers.</p>
      <p>The perceptron (1958, Frank Rosenblatt) is the simplest artificial neuron. It takes multiple inputs, multiplies each by a weight, sums them up, adds a bias, and passes through an activation function.</p>
    </div>
    <div class="formula">output = activation(Σ(wᵢ · xᵢ) + bias)<br><span class="sub">Weighted sum of inputs → activation → decision</span></div>
    <div class="interactive">
      <b>Think about it:</b> Consider deciding whether to go outside. Inputs: Is it sunny? (x₁=1) Is it warm? (x₂=1) Is it a workday? (x₃=-1). You weigh each factor differently. That's a perceptron deciding "go outside = 1" or "stay in = 0"!
    </div>`,

  perceptron_2: `
    <div class="concept">
      <h3>Weights & Bias</h3>
      <p><b>Analogy:</b> Weights are like volume knobs on a mixer. Each input channel has its own knob — turn it up (high weight) to make that input louder/more important, or turn it down. The bias is like a master threshold — how loud must the total be before you hear anything?</p>
      <p>Weights determine how much each input matters. A positive weight means "this input supports a positive output." Negative weight means "this input argues against." The bias shifts the entire decision boundary.</p>
    </div>
    <div class="formula">z = w₁x₁ + w₂x₂ + ... + wₙxₙ + b<br><span class="sub">Without bias, the boundary must pass through the origin</span></div>
    <div class="interactive">
      <b>Try it:</b> If x₁=0.5, x₂=0.8, w₁=1.0, w₂=-0.5, bias=0.2: z = (0.5)(1.0) + (0.8)(-0.5) + 0.2 = 0.5 - 0.4 + 0.2 = 0.3. Since 0.3 > 0, the perceptron fires! What if you change w₂ to -1.0?
    </div>`,

  perceptron_3: `
    <div class="concept">
      <h3>Activation Functions</h3>
      <p><b>Analogy:</b> A bouncer at a club. The step function says "VIP score above 5? Come in. Below 5? Rejected." The sigmoid is a nicer bouncer: "Score 3? 10% chance... Score 7? 95% chance..." Smoother, more nuanced.</p>
      <p>Activation functions add non-linearity. Without them, stacking layers would just be multiplying matrices — still a linear model. Common activations: Step (0 or 1), Sigmoid (smooth 0-1), ReLU (max(0,x)), Tanh (-1 to 1).</p>
    </div>
    <div class="formula">Step: f(z) = 1 if z > 0, else 0<br>Sigmoid: f(z) = 1/(1+e⁻ᶻ)<br>ReLU: f(z) = max(0, z)</div>
    <div class="interactive">
      <b>Compare:</b> For z = -2, 0, 2 — Step gives: 0, 0, 1. Sigmoid gives: 0.12, 0.5, 0.88. ReLU gives: 0, 0, 2. Notice how sigmoid is differentiable everywhere (great for learning), but ReLU is simpler and faster.
    </div>`,

  nn_1: `
    <div class="concept">
      <h3>Layers & Architecture</h3>
      <p><b>Analogy:</b> Think of a factory assembly line. Raw materials enter (input layer), go through processing stations (hidden layers) where each station transforms them, and finished products exit (output layer). Each station specializes in a different transformation.</p>
      <p>A neural network has an <b>input layer</b> (receives data), one or more <b>hidden layers</b> (transform data), and an <b>output layer</b> (produces predictions). More hidden layers = deeper network = can learn more complex patterns.</p>
    </div>
    <div class="formula">Layer sizes: [input_dim, h₁, h₂, ..., output_dim]<br><span class="sub">Example: [784, 128, 64, 10] for digit recognition</span></div>
    <div class="interactive">
      <b>Think about it:</b> For recognizing handwritten digits (28x28 pixel images, 10 possible digits): input = 784, output = 10. How many hidden neurons? Too few and it can't learn; too many and it overfits. Typical: 128-256.
    </div>`,

  nn_2: `
    <div class="concept">
      <h3>The Forward Pass</h3>
      <p><b>Analogy:</b> Imagine passing a note through a classroom. Each student reads it, changes it slightly (their weights + activation), and passes it to the next student. By the time it reaches the last student, the original message has been transformed into a prediction.</p>
      <p>Data flows forward: Input → multiply by weights → add bias → apply activation → pass to next layer. Each layer transforms the data, building increasingly abstract representations.</p>
    </div>
    <div class="formula">a⁽¹⁾ = σ(W⁽¹⁾·x + b⁽¹⁾)<br>a⁽²⁾ = σ(W⁽²⁾·a⁽¹⁾ + b⁽²⁾)<br><span class="sub">Each layer uses previous layer's output as input</span></div>
    <div class="interactive">
      <b>Trace it:</b> Input: [1, 0]. Layer 1 weights: [[0.5, -0.3], [0.8, 0.1]]. Neuron 1: 0.5×1 + (-0.3)×0 = 0.5, σ(0.5) ≈ 0.62. Neuron 2: 0.8×1 + 0.1×0 = 0.8, σ(0.8) ≈ 0.69. Output of layer 1: [0.62, 0.69].
    </div>`,

  nn_3: `
    <div class="concept">
      <h3>Backpropagation</h3>
      <p><b>Analogy:</b> A teacher grading exams. The final answer is wrong, so they trace back: "The conclusion was wrong because step 3 had an error, which happened because step 2 used the wrong formula." Each step gets feedback proportional to its blame.</p>
      <p>Backprop computes gradients — how much each weight contributed to the error. Using the chain rule of calculus, it flows the error signal backward through the network. Each weight gets adjusted in the direction that reduces the loss.</p>
    </div>
    <div class="formula">∂Loss/∂w = ∂Loss/∂output × ∂output/∂z × ∂z/∂w<br><span class="sub">Chain rule: multiply partial derivatives along the path</span></div>
    <div class="interactive">
      <b>Intuition:</b> If the output is too high by 0.5, and a weight contributed 30% of that output, then that weight should decrease by roughly 0.15 (scaled by learning rate). Weights that contributed more get bigger updates.
    </div>`,

  cnn_1: `
    <div class="concept">
      <h3>The Convolution Operation</h3>
      <p><b>Analogy:</b> Imagine scanning a photo with a magnifying glass. You slide it across every part, and at each position, you note a specific pattern — "is there a vertical edge here?" The magnifying glass is the <b>filter/kernel</b>, and the notes you take form a <b>feature map</b>.</p>
      <p>A convolution slides a small matrix (e.g., 3×3) across the input image, computing element-wise multiplication and summing at each position. Different filters detect different features: edges, textures, corners.</p>
    </div>
    <div class="formula">Output[i,j] = Σ Σ Input[i+m, j+n] × Filter[m,n]<br><span class="sub">For all m,n in the filter size</span></div>
    <div class="interactive">
      <b>Try it:</b> A vertical edge filter: [[-1,0,1],[-1,0,1],[-1,0,1]]. Applied to a region where left side is dark (0) and right is bright (255), the output is large. Applied to a uniform region → output is 0. The filter found the edge!
    </div>`,

  cnn_2: `
    <div class="concept">
      <h3>Pooling Layers</h3>
      <p><b>Analogy:</b> Think of summarizing a book chapter. Instead of keeping every word, you keep the main idea of each paragraph. <b>Max pooling</b> keeps the strongest signal from each region; <b>average pooling</b> keeps the average.</p>
      <p>Pooling reduces the spatial dimensions of feature maps (e.g., 2×2 max pooling halves width and height). This makes the network more computationally efficient and adds translation invariance — a cat is a cat whether it's in the top-left or bottom-right.</p>
    </div>
    <div class="formula">MaxPool(2×2): [[1,3],[5,2]] → 5<br><span class="sub">Take the maximum value from each 2×2 region</span></div>
    <div class="interactive">
      <b>Calculate:</b> Given a 4×4 feature map: [[6,2,8,1],[3,7,4,5],[9,1,3,6],[2,4,7,8]], apply 2×2 max pooling. Top-left 2×2: max(6,2,3,7) = 7. Top-right: max(8,1,4,5) = 8. Bottom-left: max(9,1,2,4) = 9. Bottom-right: max(3,6,7,8) = 8. Result: [[7,8],[9,8]].
    </div>`,

  cnn_3: `
    <div class="concept">
      <h3>Feature Hierarchy</h3>
      <p><b>Analogy:</b> Learning to read. First you learn strokes (edges), then letters (shapes), then words (combinations), then sentences (meaning). CNNs learn similarly — early layers detect edges, middle layers detect parts, deep layers detect whole objects.</p>
      <p>This hierarchy emerges naturally through training. Layer 1 might learn 64 edge detectors. Layer 2 combines edges into textures and corners. Layer 3 combines those into object parts (eyes, wheels). Deep layers combine parts into full objects.</p>
    </div>
    <div class="formula">Layer 1: Edges → Layer 2: Textures → Layer 3: Parts → Layer 4: Objects<br><span class="sub">Complexity increases with depth</span></div>
    <div class="interactive">
      <b>Think about it:</b> Why can a CNN trained on ImageNet (1000 object classes) be fine-tuned to detect medical tumors? Because the early layers learn universal features (edges, textures) that work for any image task. Only the last layers need retraining. This is <b>transfer learning</b>.
    </div>`,

  cnn_4: `
    <div class="concept">
      <h3>Famous CNN Architectures</h3>
      <p><b>LeNet-5 (1998):</b> Yann LeCun's pioneer. 2 conv layers, used for handwritten digit recognition. Just 60K parameters.</p>
      <p><b>AlexNet (2012):</b> Won ImageNet competition, proved deep CNNs work. Used ReLU, dropout, GPU training. 60M parameters.</p>
      <p><b>ResNet (2015):</b> Introduced skip connections — let gradients flow through "shortcuts." Enabled networks with 152+ layers without vanishing gradients.</p>
    </div>
    <div class="formula">ResNet skip connection: output = F(x) + x<br><span class="sub">The identity shortcut lets gradients bypass layers</span></div>
    <div class="interactive">
      <b>Think about it:</b> Without skip connections, a 50-layer network often performs worse than a 20-layer one (vanishing gradients). With skip connections, 152 layers outperforms 50. Why? Because the skip lets the network learn "corrections" (residuals) rather than entire transformations.
    </div>`,

  rnn_1: `
    <div class="concept">
      <h3>Sequences & Time</h3>
      <p><b>Analogy:</b> Reading a sentence. Each word's meaning depends on what came before. "Bank" means something different after "river" vs. "savings." Standard neural networks process each input independently — they have no memory of order.</p>
      <p>Recurrent Neural Networks process data sequentially, maintaining a <b>hidden state</b> that carries information from previous steps. They're natural for text, speech, music, time series, and any data where order matters.</p>
    </div>
    <div class="formula">hₜ = f(W·hₜ₋₁ + U·xₜ + b)<br><span class="sub">New state = function(previous state + current input)</span></div>
    <div class="interactive">
      <b>Think about it:</b> Predict the next word: "The cat sat on the ___". A feed-forward network sees each word independently. An RNN remembers "cat" and "sat" when processing "the" — context makes "mat" or "roof" likely, but "the" alone could go anywhere.
    </div>`,

  rnn_2: `
    <div class="concept">
      <h3>The Hidden State</h3>
      <p><b>Analogy:</b> A person writing a summary while reading a long article. They can't remember every word, so they maintain a running summary (hidden state) that updates with each sentence. The summary captures the essence of what's been read.</p>
      <p>The hidden state h is a vector that encodes everything the RNN has seen so far. At each time step, it mixes the current input with the previous state to create a new state. It's the network's working memory.</p>
    </div>
    <div class="formula">hₜ = tanh(Wₕhₜ₋₁ + Wₓxₜ + b)<br><span class="sub">tanh squashes the state into [-1, 1]</span></div>
    <div class="interactive">
      <b>Consider:</b> If h₀ = [0, 0, 0] and after processing "The" → h₁ = [0.3, -0.1, 0.5], then "cat" → h₂ = [0.7, 0.2, 0.8]. The state evolved to encode both words. By h₁₀₀, the network has "read" 100 words — but can it still remember word 1?
    </div>`,

  rnn_3: `
    <div class="concept">
      <h3>The Vanishing Gradient Problem</h3>
      <p><b>Analogy:</b> A game of telephone with 50 people. By the time the message reaches person 50, it's completely garbled. Similarly, gradients get multiplied at each time step during backpropagation — after 50 steps, they shrink to essentially zero.</p>
      <p>During backprop through time, gradients are multiplied by the weight matrix at each step. If weights are < 1, gradients shrink exponentially. After 20+ steps, early inputs have virtually zero gradient — the network can't learn long-range dependencies.</p>
    </div>
    <div class="formula">∂L/∂h₁ = ∂L/∂hₜ × Πₖ(∂hₖ/∂hₖ₋₁)<br><span class="sub">Product of many terms < 1 → vanishes to zero</span></div>
    <div class="interactive">
      <b>Calculate:</b> If each gradient multiplier is 0.9, after 10 steps: 0.9¹⁰ ≈ 0.35. After 50 steps: 0.9⁵⁰ ≈ 0.005. After 100 steps: 0.9¹⁰⁰ ≈ 0.00003. The gradient has essentially vanished! This is why vanilla RNNs struggle with long sequences.
    </div>`,

  rnn_4: `
    <div class="concept">
      <h3>LSTM & GRU</h3>
      <p><b>Analogy:</b> LSTM is like a person with a notebook. They can write new notes (input gate), erase old ones (forget gate), and choose what to share (output gate). This selective memory lets them remember important things from pages ago.</p>
      <p><b>LSTM</b> (Long Short-Term Memory) adds three gates to control information flow. The <b>cell state</b> acts as a conveyor belt — information can flow unchanged for many steps. Gates learn when to remember and when to forget.</p>
    </div>
    <div class="formula">Forget gate: fₜ = σ(Wf·[hₜ₋₁, xₜ] + bf)<br>Input gate: iₜ = σ(Wi·[hₜ₋₁, xₜ] + bi)<br>Cell: Cₜ = fₜ·Cₜ₋₁ + iₜ·tanh(Wc·[hₜ₋₁, xₜ] + bc)</div>
    <div class="interactive">
      <b>Think about it:</b> GRU (Gated Recurrent Unit) simplifies LSTM from 3 gates to 2, merging forget and input gates. It has fewer parameters and trains faster. In practice, LSTM and GRU perform similarly — GRU is preferred for smaller datasets due to fewer parameters.
    </div>`,

  dtree_1: `
    <div class="concept">
      <h3>Thinking in Questions</h3>
      <p><b>Analogy:</b> The game "20 Questions." You ask yes/no questions to narrow down possibilities: "Is it alive?" → "Does it have legs?" → "Can it fly?" Each question splits the remaining possibilities into two groups. A decision tree works exactly this way.</p>
      <p>A decision tree classifies by asking a sequence of questions about features. Each internal node is a question ("Is age > 30?"), branches are answers (Yes/No), and leaves are predictions ("Approve" / "Reject").</p>
    </div>
    <div class="formula">If feature₁ > threshold₁ → go left, else go right<br><span class="sub">Repeat until reaching a leaf node with a prediction</span></div>
    <div class="interactive">
      <b>Build one:</b> Classify animals: Is it bigger than a cat? (Yes → Is it a carnivore? Yes → Lion/No → Cow) (No → Does it fly? Yes → Sparrow/No → Hamster). You just built a decision tree with depth 2 and 4 leaf predictions!
    </div>`,

  dtree_2: `
    <div class="concept">
      <h3>Information Gain</h3>
      <p><b>Analogy:</b> Imagine sorting a mixed bag of red and blue marbles. Asking "Is it shiny?" might split them 50/50 in each group (useless). But "Is it larger than 1cm?" might put all reds in one group (very useful!). Information gain measures how useful a question is.</p>
      <p><b>Entropy</b> measures impurity — a bag of all-red marbles has entropy 0 (pure). A 50/50 mix has maximum entropy. Information gain = parent entropy - weighted average of children's entropy.</p>
    </div>
    <div class="formula">Entropy(S) = -Σ pᵢ log₂(pᵢ)<br>Gain(S, A) = Entropy(S) - Σ(|Sᵥ|/|S|)·Entropy(Sᵥ)<br><span class="sub">Pick the feature A that maximizes Gain</span></div>
    <div class="interactive">
      <b>Calculate:</b> 10 samples: 6 Yes, 4 No. Entropy = -0.6·log₂(0.6) - 0.4·log₂(0.4) ≈ 0.97. If a split gives Left: [5Y, 1N] (entropy ≈ 0.65) and Right: [1Y, 3N] (entropy ≈ 0.81). Gain = 0.97 - (6/10)(0.65) - (4/10)(0.81) ≈ 0.26. That's a decent split!
    </div>`,

  dtree_3: `
    <div class="concept">
      <h3>Overfitting & Pruning</h3>
      <p><b>Analogy:</b> A student who memorizes every practice exam word-for-word. They score 100% on practice but fail the real exam because they memorized noise, not concepts. An overfit tree memorizes training data quirks.</p>
      <p>A deep tree can perfectly classify every training sample — but it's memorizing, not learning. <b>Pruning</b> removes branches that don't improve validation accuracy. <b>Max depth</b> limits how deep the tree can grow. Both prevent overfitting.</p>
    </div>
    <div class="formula">Pre-pruning: Stop growing when depth > max_depth<br>Post-pruning: Remove subtrees that don't improve validation accuracy</div>
    <div class="interactive">
      <b>Think about it:</b> A tree with 100 leaves on 100 training samples gets 100% train accuracy but ~60% test accuracy. Pruning to 10 leaves drops train accuracy to 90% but raises test accuracy to 85%. Less memorization, better generalization.
    </div>`,

  rf_1: `
    <div class="concept">
      <h3>Wisdom of Crowds</h3>
      <p><b>Analogy:</b> Ask one person to guess the number of jelly beans in a jar — they might be way off. Ask 100 people and average their guesses — the average is usually remarkably close. Random Forest uses the same principle with decision trees.</p>
      <p>A Random Forest builds many decision trees and combines their predictions. For classification, each tree votes and the majority wins. For regression, predictions are averaged. Individual trees may be weak, but together they're strong.</p>
    </div>
    <div class="formula">Prediction = mode(Tree₁, Tree₂, ..., Treeₙ) for classification<br>Prediction = mean(Tree₁, Tree₂, ..., Treeₙ) for regression</div>
    <div class="interactive">
      <b>Think about it:</b> 5 trees predict: [Cat, Dog, Cat, Cat, Dog]. Majority vote → Cat (3-2). Even though 2 trees were wrong, the ensemble got it right. With 100 trees, the chance of a majority being wrong drops exponentially.
    </div>`,

  rf_2: `
    <div class="concept">
      <h3>Bagging (Bootstrap Aggregating)</h3>
      <p><b>Analogy:</b> Imagine 10 chefs each making soup, but each gets a slightly different random selection of ingredients from the pantry. Their soups will all taste different. Averaging all 10 soups gives a more balanced, robust flavor than any single soup.</p>
      <p>Each tree in a Random Forest is trained on a <b>bootstrap sample</b> — a random sample with replacement from the training data. This means each tree sees ~63.2% of unique training examples (some are repeated, some are missing).</p>
    </div>
    <div class="formula">Bootstrap sample: Draw n samples from n data points, with replacement<br><span class="sub">~63.2% unique samples per tree (1 - 1/e)</span></div>
    <div class="interactive">
      <b>Try it:</b> From dataset [A, B, C, D, E], a bootstrap sample of size 5 might be [A, A, C, D, E] or [B, B, B, D, E]. Point B appears 0 times in sample 1 and 3 times in sample 2. This randomness is what makes each tree different!
    </div>`,

  rf_3: `
    <div class="concept">
      <h3>Feature Randomness</h3>
      <p><b>Analogy:</b> Imagine a committee of experts, but each expert is only allowed to consider a random subset of evidence. One expert sees financial data, another sees weather data, another sees social data. Their diverse perspectives lead to better combined decisions.</p>
      <p>At each split, the tree only considers a random subset of features (typically √p for classification, p/3 for regression). This prevents every tree from using the same "obvious" feature first, increasing diversity among trees.</p>
    </div>
    <div class="formula">Features per split: m = √p (classification) or p/3 (regression)<br><span class="sub">p = total number of features</span></div>
    <div class="interactive">
      <b>Consider:</b> With 16 features, each split considers √16 = 4 random features. Tree 1 might see [age, income, color, size], Tree 2 might see [weight, height, color, age]. They develop different splitting strategies, reducing correlation between trees.
    </div>`,

  rf_4: `
    <div class="concept">
      <h3>Out-of-Bag (OOB) Error</h3>
      <p><b>Analogy:</b> Each student takes a different exam version. The questions they <i>didn't</i> study are a fair test of their real knowledge. Similarly, each tree is tested on the ~36.8% of data it never saw during training.</p>
      <p>Because each tree only sees ~63.2% of data, the remaining ~36.8% serves as a built-in validation set. The OOB error is the average error across all trees when predicting on their unseen data. It's nearly as good as cross-validation — for free!</p>
    </div>
    <div class="formula">OOB Error = (1/n) Σ I(OOB_prediction(xᵢ) ≠ yᵢ)<br><span class="sub">Average error on samples each tree did not train on</span></div>
    <div class="interactive">
      <b>Think about it:</b> Point x₅ was not in the bootstrap samples of Trees 2, 7, and 9. We get their predictions for x₅ and take a majority vote. If the vote is wrong, it counts toward OOB error. Repeat for all points → estimate of generalization error.
    </div>`,

  svm_1: `
    <div class="concept">
      <h3>Maximum Margin Classification</h3>
      <p><b>Analogy:</b> Imagine drawing a boundary between cats and dogs on a table. You could draw it just barely missing one cat — risky! Or you could draw it in the widest possible gap — much safer for new animals. SVM finds the widest gap.</p>
      <p>SVM finds the hyperplane that maximizes the <b>margin</b> — the distance between the boundary and the nearest data points from each class. A wider margin means better generalization to unseen data.</p>
    </div>
    <div class="formula">Margin = 2 / ||w||<br>Maximize margin = minimize ||w||²<br><span class="sub">Subject to: yᵢ(w·xᵢ + b) ≥ 1 for all i</span></div>
    <div class="interactive">
      <b>Think about it:</b> Two possible boundaries correctly classify all training points. Boundary A has margin 0.5, Boundary B has margin 2.0. SVM chooses B. Why? A new point falling in the margin would be misclassified by A but correctly classified by B.
    </div>`,

  svm_2: `
    <div class="concept">
      <h3>Support Vectors</h3>
      <p><b>Analogy:</b> In a tug of war, the people at the rope matter most. Remove someone in the back and nothing changes. Remove someone gripping the rope and the whole thing shifts. Support vectors are the critical "rope grippers" — the data points closest to the boundary.</p>
      <p>Support vectors are the data points that lie exactly on the margin boundary. They are the only points that determine the decision boundary. Remove any non-support vector and the boundary stays the same.</p>
    </div>
    <div class="formula">Support vectors satisfy: yᵢ(w·xᵢ + b) = 1<br><span class="sub">They lie exactly on the margin boundary</span></div>
    <div class="interactive">
      <b>Think about it:</b> With 10,000 training points, only maybe 50-100 are support vectors. This makes SVM memory-efficient at prediction time — you only need those 50-100 points. Also, adding points far from the boundary doesn't change anything!
    </div>`,

  svm_3: `
    <div class="concept">
      <h3>The Kernel Trick</h3>
      <p><b>Analogy:</b> Imagine red and blue dots arranged in concentric circles — impossible to separate with a straight line in 2D. But lift the dots into 3D (add height = x² + y²) and suddenly a flat plane separates them! The kernel trick does this lifting without actually computing the higher dimensions.</p>
      <p>Kernels map data to higher-dimensional spaces where linear separation is possible. The "trick" is that you never explicitly compute the high-dimensional coordinates — just the dot products, which are much cheaper.</p>
    </div>
    <div class="formula">K(x, y) = φ(x) · φ(y) without computing φ<br>RBF Kernel: K(x,y) = exp(-γ||x-y||²)<br><span class="sub">Maps to infinite dimensions!</span></div>
    <div class="interactive">
      <b>Example:</b> Points on a 1D line: [-2, -1, 1, 2] with labels [+, -, -, +]. Can't separate with a threshold. Map to 2D: (-2, 4), (-1, 1), (1, 1), (2, 4). Now a horizontal line at y=2 separates them! The kernel φ(x) = (x, x²) did this.
    </div>`,

  svm_4: `
    <div class="concept">
      <h3>Soft Margin SVM</h3>
      <p><b>Analogy:</b> A strict teacher fails everyone who makes one mistake. A wise teacher allows a few small mistakes to focus on overall understanding. Soft margin SVM tolerates some misclassifications to find a better overall boundary.</p>
      <p>Real data often has overlapping classes — no perfect boundary exists. Soft margin introduces <b>slack variables</b> (ξ) that allow points to be on the wrong side of the margin, penalized by a parameter C. High C = strict, low C = tolerant.</p>
    </div>
    <div class="formula">Minimize: (1/2)||w||² + C·Σξᵢ<br>Subject to: yᵢ(w·xᵢ+b) ≥ 1 - ξᵢ, ξᵢ ≥ 0<br><span class="sub">C controls trade-off: margin width vs. violations</span></div>
    <div class="interactive">
      <b>Experiment mentally:</b> C=0.01: Very wide margin, many violations allowed. Good for noisy data. C=1000: Very narrow margin, almost no violations. Good for clean data. Choosing C is typically done via cross-validation.
    </div>`,

  knn_1: `
    <div class="concept">
      <h3>Distance & Similarity</h3>
      <p><b>Analogy:</b> "Birds of a feather flock together." If you want to know what kind of bird you've spotted, look at the birds flying nearest to it. If 3 out of 4 nearby birds are sparrows, yours is probably a sparrow too. KNN uses this exact logic.</p>
      <p>KNN classifies a new point by finding its K closest neighbors in the training data and letting them vote. The most common class among neighbors wins. No training step — all the work happens at prediction time.</p>
    </div>
    <div class="formula">Euclidean distance: d(p,q) = √(Σ(pᵢ-qᵢ)²)<br>Manhattan distance: d(p,q) = Σ|pᵢ-qᵢ|<br><span class="sub">Choose based on your feature types</span></div>
    <div class="interactive">
      <b>Calculate:</b> Point A at (1,2), Point B at (4,6). Euclidean: √((4-1)²+(6-2)²) = √(9+16) = √25 = 5. Manhattan: |4-1|+|6-2| = 3+4 = 7. Euclidean is the "as the crow flies" distance; Manhattan is the "city blocks" distance.
    </div>`,

  knn_2: `
    <div class="concept">
      <h3>Choosing K</h3>
      <p><b>Analogy:</b> Asking 1 friend for a movie recommendation → biased by their taste. Asking 100 friends → the recommendation becomes "watch something popular" (too generic). K=5-15 usually balances diversity and specificity.</p>
      <p>Small K → complex, noisy boundary (overfitting). Large K → smooth, simple boundary (underfitting). K=1 memorizes training data. K=n predicts the most common class always. Use odd K for binary classification to avoid ties.</p>
    </div>
    <div class="formula">K too small → high variance (overfitting)<br>K too large → high bias (underfitting)<br><span class="sub">Optimal K found via cross-validation</span></div>
    <div class="interactive">
      <b>Think about it:</b> With K=1, a single outlier can create a wrong prediction island. With K=3, that outlier is outvoted. With K=100, you're averaging so much that local patterns disappear. The sweet spot depends on your data — try 3, 5, 7, 11 and compare validation accuracy.
    </div>`,

  knn_3: `
    <div class="concept">
      <h3>The Curse of Dimensionality</h3>
      <p><b>Analogy:</b> Finding your nearest neighbor in a hallway is easy. In a football stadium, harder. In a 100-dimensional stadium? Almost everyone is equally far away. As dimensions increase, distances become meaningless.</p>
      <p>In high dimensions, all points become roughly equidistant. A 2D square has corners √2 apart. A 100D cube has corners √100 ≈ 10 apart. The concept of "nearest" loses meaning. KNN needs exponentially more data as dimensions increase.</p>
    </div>
    <div class="formula">Volume of unit hypersphere: Vₙ → 0 as n → ∞<br><span class="sub">In 100D, a "neighborhood" covers almost no volume</span></div>
    <div class="interactive">
      <b>Consider:</b> In 2D, 100 points might densely cover a unit square. In 100D, you'd need 100¹⁰⁰ points to achieve the same density. Solutions: Use PCA to reduce dimensions first, use feature selection, or switch to a model that handles high dimensions better (like SVM or neural nets).
    </div>`,

  kmeans_1: `
    <div class="concept">
      <h3>What is Clustering?</h3>
      <p><b>Analogy:</b> Imagine dumping a bag of mixed candy on a table. Without any labels, you naturally group them: chocolates here, gummies there, hard candies over there. You're clustering based on visual similarity. K-Means does this with data.</p>
      <p>Clustering is <b>unsupervised learning</b> — no labels needed. The algorithm discovers natural groups (clusters) in data. Applications: customer segmentation, image compression, anomaly detection, document grouping.</p>
    </div>
    <div class="formula">Given data X = {x₁, ..., xₙ}, find K groups<br>Minimize: Σₖ Σ_{x∈Cₖ} ||x - μₖ||²<br><span class="sub">μₖ = centroid (mean) of cluster k</span></div>
    <div class="interactive">
      <b>Think about it:</b> A retail store has 10,000 customers. They want 4 marketing strategies. K-Means with K=4 groups customers by spending habits, visit frequency, and product preferences. Each cluster gets a tailored campaign.
    </div>`,

  kmeans_2: `
    <div class="concept">
      <h3>The K-Means Algorithm</h3>
      <p><b>Analogy:</b> Imagine 3 team captains picking teams on a playground. Each kid joins the nearest captain. Then each captain moves to the middle of their team. Kids re-choose. Captains re-center. Repeat until teams stabilize.</p>
      <p>Step 1: Randomly place K centroids. Step 2: Assign each point to nearest centroid. Step 3: Recompute centroids as mean of assigned points. Step 4: Repeat steps 2-3 until centroids stop moving (convergence).</p>
    </div>
    <div class="formula">Assign: argmin_k ||xᵢ - μₖ||²<br>Update: μₖ = (1/|Cₖ|) Σ_{x∈Cₖ} x<br><span class="sub">Guaranteed to converge (but maybe to local optimum)</span></div>
    <div class="interactive">
      <b>Trace it:</b> 4 points: (1,1), (1,2), (5,5), (6,5). K=2, initial centroids: (1,1) and (6,5). Assignment: {(1,1),(1,2)} → C1, {(5,5),(6,5)} → C2. New centroids: (1, 1.5) and (5.5, 5). Reassign — same groups. Converged in 1 step!
    </div>`,

  kmeans_3: `
    <div class="concept">
      <h3>Choosing K: The Elbow Method</h3>
      <p><b>Analogy:</b> If you group students into 1 team, lots of internal disagreement (high inertia). Into 30 teams of 1, zero disagreement but useless. Plot disagreement vs. number of teams — there's usually a "bend" where adding more teams stops helping much.</p>
      <p>Run K-Means for K=1,2,3,...,10. Plot the total within-cluster sum of squares (inertia) vs K. The graph looks like a bent arm — the "elbow" point is the best K. Beyond it, adding clusters gives diminishing returns.</p>
    </div>
    <div class="formula">Inertia(K) = Σₖ Σ_{x∈Cₖ} ||x - μₖ||²<br><span class="sub">Plot Inertia vs K → find the elbow</span></div>
    <div class="interactive">
      <b>Example:</b> K=1: inertia=100. K=2: 40. K=3: 20. K=4: 18. K=5: 17. The big drops happen at K=2 and K=3. After K=3, the improvement is tiny. The elbow is at K=3. Also consider the silhouette score for a more rigorous choice.
    </div>`,

  kmeans_4: `
    <div class="concept">
      <h3>K-Means Limitations</h3>
      <p><b>Analogy:</b> K-Means assumes clusters are round blobs of similar size. But what if your data looks like two interleaving spirals? Or one huge cluster and one tiny one? K-Means will force round boundaries even when they don't fit.</p>
      <p>Limitations: (1) Assumes spherical clusters. (2) Sensitive to initialization (fix: K-Means++). (3) Can't handle varying densities. (4) K must be chosen in advance. Alternatives: DBSCAN (finds arbitrary shapes), Gaussian Mixture Models (soft assignments).</p>
    </div>
    <div class="formula">K-Means++: Choose initial centroids that are far apart<br>DBSCAN: Finds clusters of arbitrary shape using density<br><span class="sub">No algorithm is universally best — match to your data</span></div>
    <div class="interactive">
      <b>Think about it:</b> Data with 3 clusters: a dense ball of 1000 points, a sparse ring of 50 points, and a crescent of 200 points. K-Means with K=3 will fail badly — it'll split the dense ball into pieces. DBSCAN would handle this naturally because it clusters by density.
    </div>`,

  pca_1: `
    <div class="concept">
      <h3>The Curse of Dimensions</h3>
      <p><b>Analogy:</b> Describing a person with 1000 features (height, weight, hair color, shoe size, etc.) is overkill — most of those features are correlated or irrelevant. PCA finds the 10-20 "super features" that capture 95% of the variation.</p>
      <p>High-dimensional data is computationally expensive, prone to overfitting, and hard to visualize. Dimensionality reduction finds a lower-dimensional representation that preserves the essential structure.</p>
    </div>
    <div class="formula">Original: X ∈ ℝⁿˣᵖ → Reduced: Z ∈ ℝⁿˣᵏ (k << p)<br><span class="sub">Keep k dimensions that explain the most variance</span></div>
    <div class="interactive">
      <b>Think about it:</b> Images of faces at 100×100 pixels = 10,000 dimensions. But faces vary mainly in ~50 ways (lighting, angle, expression, identity). PCA can compress to 50 dimensions and reconstruct faces with >95% accuracy. That's 200× compression!
    </div>`,

  pca_2: `
    <div class="concept">
      <h3>Variance & Principal Directions</h3>
      <p><b>Analogy:</b> Drop a handful of rice grains on a table. They form an elongated scatter. The "first principal component" is the direction the rice spreads the most (the long axis). The second is perpendicular — the direction of least spread.</p>
      <p>PCA finds the directions of maximum variance in the data. The first principal component (PC1) captures the most variance. PC2 is perpendicular to PC1 and captures the next most. And so on. Project data onto these directions to reduce dimensions.</p>
    </div>
    <div class="formula">PC1 = argmax ||Xw||² subject to ||w||=1<br><span class="sub">The direction that maximizes the spread of projected data</span></div>
    <div class="interactive">
      <b>Visualize:</b> 2D data scattered in an ellipse (tilted 45°). PC1 points along the long axis — projecting onto this captures most of the spread. PC2 points along the short axis — much less variance here. If the ellipse is very elongated, PC1 alone captures 95%+ of the variance.
    </div>`,

  pca_3: `
    <div class="concept">
      <h3>Eigenvalues & Eigenvectors</h3>
      <p><b>Analogy:</b> A spinning top has a natural axis of rotation (eigenvector) and a spin speed (eigenvalue). The covariance matrix of your data also has natural axes — directions where the data "spins" the fastest (highest variance).</p>
      <p>PCA computes the covariance matrix of the data, then finds its eigenvectors (principal directions) and eigenvalues (variance along each direction). Sort by eigenvalue descending → the top k eigenvectors are your principal components.</p>
    </div>
    <div class="formula">Covariance matrix: C = (1/n)XᵀX<br>Eigen decomposition: Cv = λv<br><span class="sub">v = eigenvector (direction), λ = eigenvalue (variance)</span></div>
    <div class="interactive">
      <b>Example:</b> Covariance matrix: [[4, 2],[2, 3]]. Eigenvalues: λ₁=5.24, λ₂=1.76. Eigenvectors: v₁=[0.79, 0.62], v₂=[-0.62, 0.79]. PC1 explains 5.24/(5.24+1.76) = 74.9% of variance. PC1 points roughly at 38° — the data's main spread direction.
    </div>`,

  pca_4: `
    <div class="concept">
      <h3>How Many Components to Keep</h3>
      <p><b>Analogy:</b> Summarizing a movie. The first sentence captures 60% of the plot. Adding a second captures 80%. A third reaches 92%. After 5 sentences, you're at 99% — extra sentences add almost nothing. Choose where "good enough" is.</p>
      <p>Plot cumulative explained variance vs. number of components. Common thresholds: keep enough components for 90% or 95% of total variance. This gives you the optimal trade-off between simplicity and information retention.</p>
    </div>
    <div class="formula">Explained variance ratio: λₖ / Σλᵢ<br>Cumulative: Σᵏ λᵢ / Σ λᵢ ≥ 0.95<br><span class="sub">Keep k components until 95% variance explained</span></div>
    <div class="interactive">
      <b>Example:</b> Eigenvalues: [10, 5, 2, 1, 0.5, 0.3, 0.1, 0.05, 0.03, 0.02]. Total = 19. Cumulative: 1 comp = 52.6%, 2 comp = 78.9%, 3 comp = 89.5%, 4 comp = 94.7%, 5 comp = 97.4%. Keeping 4 components gives >95% explained variance while reducing from 10 to 4 dimensions.
    </div>`,

  naive_1: `
    <div class="concept">
      <h3>Bayes' Theorem</h3>
      <p><b>Analogy:</b> You hear a dog barking behind a fence. You can't see it. What breed is it? Without hearing it, you'd guess based on breed popularity (prior). The bark gives you new evidence (likelihood). Bayes' theorem combines both to update your guess.</p>
      <p>Bayes' theorem describes how to update probabilities when new evidence arrives. P(A|B) = "probability of A given we observed B." It's the foundation of probabilistic classification.</p>
    </div>
    <div class="formula">P(A|B) = P(B|A) · P(A) / P(B)<br><span class="sub">Posterior = Likelihood × Prior / Evidence</span></div>
    <div class="interactive">
      <b>Calculate:</b> 1% of emails are spam (prior). The word "FREE" appears in 90% of spam and 1% of ham. An email contains "FREE." P(spam|FREE) = (0.9 × 0.01) / (0.9 × 0.01 + 0.01 × 0.99) = 0.009 / 0.0189 ≈ 47.6%. One word almost flips the odds!
    </div>`,

  naive_2: `
    <div class="concept">
      <h3>The Naive Assumption</h3>
      <p><b>Analogy:</b> Judging a restaurant by rating each aspect independently: food quality, cleanliness, service, ambiance. In reality, these are correlated (good food often means good service). But judging each separately is simpler and works surprisingly well.</p>
      <p>Naive Bayes assumes all features are <b>conditionally independent</b> given the class. This is almost never true in reality! But the simplification makes computation tractable and, empirically, NB works remarkably well despite the "naive" assumption.</p>
    </div>
    <div class="formula">P(x₁, x₂, ..., xₙ | C) = Π P(xᵢ | C)<br><span class="sub">Joint probability = product of individual probabilities</span></div>
    <div class="interactive">
      <b>Think about it:</b> Why does it work despite the wrong assumption? Because classification only needs to pick the <i>most likely</i> class — it doesn't need accurate probabilities. Even if P(spam) is estimated as 0.8 instead of 0.7, if P(ham) is 0.2, the classification is still correct.
    </div>`,

  naive_3: `
    <div class="concept">
      <h3>Spam Classification with Naive Bayes</h3>
      <p><b>Analogy:</b> A detective with a checklist. "FREE" → +3 suspicion. "Dear" → -1. "Winner" → +4. "Invoice" → -2. Add up the scores. High total? It's spam. Naive Bayes does this with log probabilities.</p>
      <p>For each word in the email, compute P(word|spam) and P(word|ham). Multiply all likelihood ratios. Multiply by the prior P(spam)/P(ham). The class with higher total posterior wins. Works with TF-IDF or simple word counts.</p>
    </div>
    <div class="formula">P(spam|words) ∝ P(spam) × Π P(wordᵢ|spam)<br><span class="sub">In log space: log P(spam) + Σ log P(wordᵢ|spam)</span></div>
    <div class="interactive">
      <b>Example:</b> Email: "Free money now." P(free|spam)=0.8, P(free|ham)=0.02. P(money|spam)=0.6, P(money|ham)=0.01. P(now|spam)=0.3, P(now|ham)=0.2. Score(spam) ∝ 0.4 × 0.8 × 0.6 × 0.3 = 0.0576. Score(ham) ∝ 0.6 × 0.02 × 0.01 × 0.2 = 0.000024. Spam wins by 2400×!
    </div>`,

  naive_4: `
    <div class="concept">
      <h3>Laplace Smoothing</h3>
      <p><b>Analogy:</b> If you've never seen a black swan, does that mean they don't exist? A strict counter says P(black swan) = 0. Laplace smoothing says "let's assume we've seen at least 1 of everything" — preventing zero probabilities from dominating.</p>
      <p>If a word never appears in spam training data, P(word|spam)=0, which zeroes out the entire product. Laplace smoothing adds a small count (α, usually 1) to every word count, ensuring no probability is ever exactly zero.</p>
    </div>
    <div class="formula">P(word|class) = (count(word, class) + α) / (count(class) + α·|V|)<br><span class="sub">α = smoothing parameter (usually 1), |V| = vocabulary size</span></div>
    <div class="interactive">
      <b>Calculate:</b> Word "blockchain" appears 0 times in 1000 spam emails. Vocabulary size |V|=5000. Without smoothing: P = 0/1000 = 0 (kills everything!). With Laplace: P = (0+1)/(1000+5000) = 1/6000 ≈ 0.000167. Small but non-zero — the model can still function.
    </div>`,

  gradient_1: `
    <div class="concept">
      <h3>The Loss Landscape</h3>
      <p><b>Analogy:</b> Imagine you're blindfolded on a hilly landscape and want to reach the lowest valley. You can feel the slope beneath your feet. Gradient descent = always step downhill. The landscape is the loss function; your position is the model's current parameters.</p>
      <p>Every set of model parameters (weights) corresponds to a point on the loss surface. The height is the loss value. Training = navigating this surface to find the lowest point (best parameters).</p>
    </div>
    <div class="formula">Loss = f(w₁, w₂, ..., wₙ)<br>Goal: Find w* = argmin f(w)<br><span class="sub">The loss surface can have valleys, ridges, and saddle points</span></div>
    <div class="interactive">
      <b>Think about it:</b> For linear regression with 2 parameters (slope, intercept), the loss surface is a bowl shape (convex) — there's exactly one minimum. For neural networks, the surface is complex with many local minima. Yet gradient descent still finds good (not necessarily global) minima.
    </div>`,

  gradient_2: `
    <div class="concept">
      <h3>Learning Rate</h3>
      <p><b>Analogy:</b> Walking downhill blindfolded. Take tiny steps → very slow but safe. Take huge steps → faster but you might overshoot the valley and end up on the other side. Learning rate controls your step size.</p>
      <p>The learning rate (η) multiplies the gradient to determine step size. Too small → slow convergence, stuck in flat regions. Too large → oscillating, overshooting, divergence. Typical starting values: 0.001 to 0.01.</p>
    </div>
    <div class="formula">w_new = w_old - η · ∂Loss/∂w<br><span class="sub">η = learning rate, ∂Loss/∂w = gradient</span></div>
    <div class="interactive">
      <b>Trace it:</b> Current weight w=5, gradient=2, η=0.1: w_new = 5 - 0.1×2 = 4.8. Next step: gradient=1.6, w = 4.8 - 0.16 = 4.64. Gradually approaches the minimum. With η=2: w = 5 - 2×2 = 1, then w = 1 - 2×(-3) = 7 — oscillating! Too big.
    </div>`,

  gradient_3: `
    <div class="concept">
      <h3>SGD & Mini-Batch Gradient Descent</h3>
      <p><b>Analogy:</b> Batch GD = surveying every customer before changing the menu. SGD = changing the menu after every single complaint. Mini-batch = surveying 32 customers at a time. Mini-batch balances speed and stability.</p>
      <p><b>Batch GD</b>: Uses entire dataset per step (accurate but slow). <b>SGD</b>: Uses 1 random sample (fast but noisy). <b>Mini-batch</b>: Uses a batch of 32-256 samples (best of both). Mini-batch is the standard in deep learning.</p>
    </div>
    <div class="formula">Batch: w -= η·(1/n)Σ∇Loss(xᵢ)<br>SGD: w -= η·∇Loss(xₖ) (random k)<br>Mini-batch: w -= η·(1/B)Σ∇Loss(xⱼ) (random batch of B)</div>
    <div class="interactive">
      <b>Consider:</b> Dataset of 1M samples. Batch: compute 1M gradients per step (accurate, slow). SGD: 1 gradient per step (fast, noisy path). Mini-batch of 64: 64 gradients per step (smooth enough, 15,625 steps per epoch). GPUs are optimized for batch operations, making mini-batch the fastest.
    </div>`,

  gradient_4: `
    <div class="concept">
      <h3>Momentum & Adam</h3>
      <p><b>Analogy:</b> Plain gradient descent is like walking downhill on ice — every step exactly follows the current slope. Momentum is like rolling a bowling ball — it accumulates speed and pushes through small bumps. Adam is a smart bowling ball that adjusts its speed per dimension.</p>
      <p><b>Momentum</b> accumulates past gradients to smooth out oscillations. <b>Adam</b> (Adaptive Moment Estimation) combines momentum with per-parameter learning rates. Adam is the default optimizer in most deep learning.</p>
    </div>
    <div class="formula">Momentum: v = β·v + ∇Loss; w -= η·v<br>Adam: m = β₁·m + (1-β₁)·g; v = β₂·v + (1-β₂)·g²<br>w -= η·m̂/(√v̂ + ε)</div>
    <div class="interactive">
      <b>Think about it:</b> Why does Adam work so well? It adapts: parameters with large gradients get smaller steps (preventing overshooting), parameters with small gradients get larger steps (escaping flat regions). It's like having a personal learning rate for each of the model's thousands of parameters.
    </div>`,

  nlp_1: `
    <div class="concept">
      <h3>Tokenization</h3>
      <p><b>Analogy:</b> Before a chef can cook, ingredients must be prepped — washed, chopped, measured. Before a model can process text, it must be chopped into tokens. A token might be a word, a subword, or even a character.</p>
      <p>Tokenization converts raw text into a sequence of tokens (integers). Modern tokenizers like BPE (Byte Pair Encoding) split rare words into subwords: "unbelievable" → ["un", "believ", "able"]. This handles any word without a huge vocabulary.</p>
    </div>
    <div class="formula">"Hello world" → [15496, 995] (GPT-2 tokens)<br>"Unbelievable" → ["Un", "believ", "able"] → [3118, 31141, 540]<br><span class="sub">Vocabulary: ~50,000 subword tokens</span></div>
    <div class="interactive">
      <b>Think about it:</b> Why not just use characters? "hello" = 5 tokens (h,e,l,l,o). Very long sequences for a model to process! Words? "xylophone" might not be in the vocabulary. Subwords balance: common words stay whole, rare words split into known pieces.
    </div>`,

  nlp_2: `
    <div class="concept">
      <h3>Word Embeddings</h3>
      <p><b>Analogy:</b> Imagine placing every word on a map. "King" and "Queen" are close together. "Cat" and "Dog" are close. "King" and "Banana" are far apart. Word embeddings are these coordinates — vectors that capture meaning.</p>
      <p>Each word is represented as a dense vector (e.g., 300 dimensions). Words with similar meanings have similar vectors. Famously: vec("King") - vec("Man") + vec("Woman") ≈ vec("Queen"). Learned from large text corpora (Word2Vec, GloVe).</p>
    </div>
    <div class="formula">word → [0.2, -0.5, 0.8, ..., 0.1] ∈ ℝᵈ<br>similarity(A,B) = cosine(vecA, vecB)<br><span class="sub">d = embedding dimension (typically 100-768)</span></div>
    <div class="interactive">
      <b>Famous result:</b> vec("Paris") - vec("France") + vec("Italy") ≈ vec("Rome"). The model learned that Paris is to France as Rome is to Italy — purely from reading text! No one taught it geography. This geometric structure emerges naturally from word co-occurrence patterns.
    </div>`,

  nlp_3: `
    <div class="concept">
      <h3>The Attention Mechanism</h3>
      <p><b>Analogy:</b> Reading a contract, you don't give equal attention to every word. When checking "Who signed?", you focus on names near "signed by." Attention lets models dynamically focus on the most relevant parts of the input for each part of the output.</p>
      <p>Attention computes a weighted sum of all input positions, where weights indicate relevance. For each output position, it asks: "How relevant is each input position?" This allows direct connections between distant words, solving the long-range dependency problem.</p>
    </div>
    <div class="formula">Attention(Q,K,V) = softmax(QKᵀ/√dₖ) · V<br><span class="sub">Q=queries, K=keys, V=values, dₖ=key dimension</span></div>
    <div class="interactive">
      <b>Example:</b> "The cat sat on the mat because it was tired." What does "it" refer to? Attention weights for "it" would peak at "cat" (high weight ~0.7) and be low for "mat" (~0.1). The model focuses on the right antecedent.
    </div>`,

  nlp_4: `
    <div class="concept">
      <h3>Transformers & GPT</h3>
      <p><b>Analogy:</b> RNNs read a book word by word. Transformers read the entire page at once and understand how every word relates to every other word simultaneously. This parallelism is why transformers train much faster.</p>
      <p>The Transformer architecture (2017, "Attention Is All You Need") replaced RNNs with self-attention layers. GPT (Generative Pre-trained Transformer) uses decoder-only transformers trained to predict the next word. Scale + simple objective = emergent intelligence.</p>
    </div>
    <div class="formula">Self-attention: each position attends to all positions<br>Multi-head: multiple parallel attention patterns<br>GPT: Predict P(next_word | previous_words)</div>
    <div class="interactive">
      <b>Think about it:</b> GPT-3 has 175 billion parameters trained on ~500GB of text. Its only task: predict the next word. Yet from this simple objective, it learns grammar, facts, reasoning, code, and even humor. Why? Because predicting the next word well requires understanding everything about language.
    </div>`,

  rl_1: `
    <div class="concept">
      <h3>Agent & Environment</h3>
      <p><b>Analogy:</b> A baby learning to walk. The baby (agent) takes actions (move legs), observes the result (standing/falling), and receives feedback (balance = reward, falling = punishment). Over thousands of tries, it learns to walk.</p>
      <p>RL has an <b>agent</b> that takes <b>actions</b> in an <b>environment</b>. After each action, it receives an <b>observation</b> (new state) and a <b>reward</b> (scalar feedback). The goal: learn a policy that maximizes cumulative reward over time.</p>
    </div>
    <div class="formula">Agent → Action(aₜ) → Environment → State(sₜ₊₁), Reward(rₜ)<br>Goal: max E[Σ γᵗ·rₜ]<br><span class="sub">γ = discount factor (how much to value future rewards)</span></div>
    <div class="interactive">
      <b>Think about it:</b> A chess agent: state = board position, action = move a piece, reward = +1 for win, -1 for loss, 0 otherwise. The reward is sparse (only at game end), making RL hard. The agent must learn that early moves matter for eventual victory.
    </div>`,

  rl_2: `
    <div class="concept">
      <h3>Reward Signals</h3>
      <p><b>Analogy:</b> Training a dog. Give a treat immediately after "sit" → dog learns fast. Give a treat 10 minutes later → dog is confused. Reward timing and design are crucial. Bad rewards lead to unexpected (sometimes hilarious) behavior.</p>
      <p>The reward function defines what the agent should optimize. Designing good rewards is an art. <b>Reward shaping</b> adds intermediate rewards to guide learning. <b>Sparse rewards</b> (only at task completion) are harder to learn from.</p>
    </div>
    <div class="formula">Reward = +1 for reaching goal, 0 otherwise (sparse)<br>Shaped: Reward = -distance_to_goal (dense, guides agent)<br><span class="sub">Dense rewards → faster learning but risk reward hacking</span></div>
    <div class="interactive">
      <b>Famous failure:</b> An RL agent in a boat racing game discovered it could earn more points by going in circles collecting turbo boosts than actually finishing the race. The reward function rewarded turbo boosts, not race completion. Lesson: agents optimize exactly what you reward, not what you intend!
    </div>`,

  rl_3: `
    <div class="concept">
      <h3>Exploration vs. Exploitation</h3>
      <p><b>Analogy:</b> Choosing restaurants. Exploitation: always go to your favorite (guaranteed good). Exploration: try somewhere new (might be great, might be awful). Only exploring → never enjoy the best. Only exploiting → miss discovering the best.</p>
      <p>An agent must balance trying new actions (exploration) with repeating successful ones (exploitation). ε-greedy: with probability ε, take a random action; otherwise, take the best known action. ε starts high (explore) and decreases over time (exploit).</p>
    </div>
    <div class="formula">ε-greedy: With prob ε → random action, else → argmax Q(s,a)<br>ε schedule: ε₀ = 1.0 → εₘᵢₙ = 0.01 (decay over training)<br><span class="sub">Boltzmann exploration: P(a) ∝ exp(Q(s,a)/τ)</span></div>
    <div class="interactive">
      <b>Think about it:</b> A slot machine has 3 arms with unknown payouts: [0.3, 0.7, 0.5]. After 10 pulls of arm 1 (avg 0.3), should you keep pulling it or try arm 2? The <b>multi-armed bandit</b> problem formalizes this — and it's the foundation of A/B testing and ad recommendation.
    </div>`,

  rl_4: `
    <div class="concept">
      <h3>Q-Learning</h3>
      <p><b>Analogy:</b> A tourist building a map of restaurant ratings for each neighborhood. After visiting a restaurant, they update their rating for that neighborhood-food combo. Over time, the map tells them the best food in each area. Q-values are these ratings.</p>
      <p>Q(s, a) represents the expected total reward for taking action a in state s, then acting optimally. Q-learning updates this table from experience: observe reward, update Q toward (immediate reward + best future value). Converges to optimal policy.</p>
    </div>
    <div class="formula">Q(s,a) ← Q(s,a) + α[r + γ·max_a' Q(s',a') - Q(s,a)]<br><span class="sub">α=learning rate, γ=discount factor, s'=next state</span></div>
    <div class="interactive">
      <b>Trace it:</b> State A, action Right → State B, reward +5. Q(A,Right) was 0. Learning rate α=0.5, γ=0.9. max Q(B,*) = 10. Update: Q(A,Right) = 0 + 0.5×(5 + 0.9×10 - 0) = 0.5×14 = 7. The agent learned that going Right from A is valuable!
    </div>`,
};

// ── Interactive lesson registry (visual, hands-on mini-labs) ─────
function labShell({ title, subtitle, controlsHtml, vizHtml, notesHtml }) {
  return `
    <div class="labWrap">
      <div class="labHead">
        <div>
          <div class="labKicker">${esc(subtitle || "")}</div>
          <h3 class="labTitle">${esc(title || "Interactive Lab")}</h3>
        </div>
      </div>
      <div class="labGrid">
        <div class="labControls">${controlsHtml || ""}</div>
        <div class="labViz">${vizHtml || ""}</div>
      </div>
      ${notesHtml ? `<div class="labNotes">${notesHtml}</div>` : ""}
    </div>
  `;
}

const LAB_NOTES = {
  linreg_4: `<div class="sub"><b>What to try:</b> seed points, then drag one point far away. Watch how the line and MSE change. Outliers matter.</div>`,
  logreg_4: `<div class="sub"><b>What to try:</b> flip the sign of w. Notice the sigmoid curve flips direction and the boundary shifts.</div>`,
  perceptron_4: `<div class="sub"><b>What to try:</b> keep inputs fixed and sweep the bias. You’re shifting the decision threshold.</div>`,
  nn_4: `<div class="sub"><b>What to try:</b> randomize weights a few times. Same inputs can produce different outputs depending on parameters.</div>`,
  cnn_4: `<div class="sub"><b>What to try:</b> draw an edge in the image (0s on left, 1s on right) and use an edge-style filter.</div>`,
  rnn_4: `<div class="sub"><b>What to try:</b> increase |w_state|. The hidden state “remembers” longer (or explodes/oscillates if too large).</div>`,
  dtree_4: `<div class="sub"><b>What to try:</b> grow 2–3 splits, then classify multiple samples. You’re traversing a decision path.</div>`,
  rf_4: `<div class="sub"><b>What to try:</b> increase the number of trees. Voting becomes more stable than a single stump.</div>`,
  svm_4: `<div class="sub"><b>What to try:</b> increase the margin and see more violations (harder constraint). Soft margins tolerate some errors.</div>`,
  knn_4: `<div class="sub"><b>What to try:</b> switch K from 1 to 9. Larger K smooths predictions and reduces sensitivity to noise.</div>`,
  kmeans_4: `<div class="sub"><b>What to try:</b> place centroids badly on purpose, then do Assign → Update repeatedly. It converges.</div>`,
  pca_4: `<div class="sub"><b>What to try:</b> find the angle that maximizes variance share. That’s the first principal component.</div>`,
  naive_4: `<div class="sub"><b>What to try:</b> make P(word|spam) close to P(word|ham). The word becomes uninformative.</div>`,
  gradient_4: `<div class="sub"><b>What to try:</b> raise learning rate too high. You’ll overshoot and bounce instead of converging.</div>`,
  nlp_4: `<div class="sub"><b>What to try:</b> repeat a word many times. Bag-of-words captures counts but ignores order.</div>`,
  rl_4: `<div class="sub"><b>What to try:</b> compare ε=0 vs ε=0.5. With no exploration, you can get stuck with a bad arm.</div>`,
};

const INTERACTIVE_LESSONS = {
  // Implementations are added/filled in below during the visualizer tasks.
  linreg_4: (mount) => {
    const uid = `lr_${Math.random().toString(36).slice(2, 8)}`;
    mount.controls.innerHTML = `
      <div class="labCard">
        <div class="labCardTitle">Controls</div>
        <div class="sub">Click on the canvas to add points. Drag a point to move it.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button class="btn primary sm" id="${uid}_snap" type="button">Seed points</button>
          <button class="btn ghost sm" id="${uid}_clear" type="button">Clear</button>
        </div>
      </div>
      <div class="labCard">
        <div class="labCardTitle">Live metrics</div>
        <div id="${uid}_info" class="sub labMono" style="white-space:pre-wrap">Add at least 2 points.</div>
      </div>
    `;
    mount.viz.innerHTML = `<canvas id="${uid}_c" class="labCanvas" width="720" height="420"></canvas>`;
    const canvas = $(uid + "_c");
    const info = $(uid + "_info");
    const ctx = canvas.getContext("2d");
    const W = 720, H = 420;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = "100%"; canvas.style.height = "auto";
    ctx.scale(dpr, dpr);

    let pts = [];
    let dragging = -1;

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
      pts.forEach(p => { mse += (p.y - (m * p.x + b)) ** 2; });
      mse /= n;
      return { m, b, mse };
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "rgba(42,42,60,.55)";
      ctx.fillRect(0, 0, W, H);

      // axes
      ctx.strokeStyle = "rgba(255,255,255,.07)";
      ctx.lineWidth = 1;
      for (let x = 60; x < W; x += 60) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 60; y < H; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

      const fit = fitLine();
      if (fit) {
        ctx.beginPath();
        ctx.moveTo(0, fit.b);
        ctx.lineTo(W, fit.m * W + fit.b);
        ctx.strokeStyle = "rgba(224,122,95,.85)";
        ctx.lineWidth = 2.2;
        ctx.stroke();

        // residuals
        pts.forEach(p => {
          const pred = fit.m * p.x + fit.b;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x, pred);
          ctx.strokeStyle = "rgba(255,107,107,.28)";
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.stroke();
          ctx.setLineDash([]);
        });
        info.textContent = `y = ${fit.m.toFixed(4)}·x + ${fit.b.toFixed(2)}\nMSE = ${fit.mse.toFixed(1)}\nPoints: ${pts.length}`;
      } else {
        info.textContent = pts.length < 2 ? "Add at least 2 points." : "Line fit is unstable (points nearly vertical).";
      }

      pts.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
        ctx.fillStyle = i === dragging ? "rgba(107,255,184,.75)" : "rgba(107,158,158,.85)";
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,.25)";
        ctx.lineWidth = 1;
        ctx.stroke();
      });
    }

    function toXY(e) {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
    }
    function hitTest(x, y) {
      for (let i = pts.length - 1; i >= 0; i--) {
        if (Math.hypot(pts[i].x - x, pts[i].y - y) <= 12) return i;
      }
      return -1;
    }

    canvas.addEventListener("mousedown", (e) => {
      const { x, y } = toXY(e);
      const hit = hitTest(x, y);
      if (hit >= 0) { dragging = hit; draw(); return; }
      pts.push({ x, y });
      draw();
    });
    window.addEventListener("mousemove", (e) => {
      if (dragging < 0) return;
      const { x, y } = toXY(e);
      pts[dragging] = { x: clamp(x, 0, W), y: clamp(y, 0, H) };
      draw();
    });
    window.addEventListener("mouseup", () => { if (dragging >= 0) { dragging = -1; draw(); } });

    $(uid + "_clear").addEventListener("click", () => { pts = []; draw(); });
    $(uid + "_snap").addEventListener("click", () => {
      pts = Array.from({ length: 6 }, (_, i) => ({
        x: 120 + i * 90 + (Math.random() * 20 - 10),
        y: 260 - i * 25 + (Math.random() * 40 - 20),
      }));
      draw();
    });
    draw();
  },

  knn_4: (mount) => {
    const uid = `knn_${Math.random().toString(36).slice(2, 8)}`;
    mount.controls.innerHTML = `
      <div class="labCard">
        <div class="labCardTitle">Controls</div>
        <div class="labRow"><label>K</label><input id="${uid}_k" type="range" min="1" max="9" step="2" value="3"><span class="labMono" id="${uid}_kv">3</span></div>
        <div class="sub">Left click = Blue, Right click = Red. Toggle classify mode, then click to predict.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button class="btn primary sm" id="${uid}_mode" type="button">Classify mode</button>
          <button class="btn ghost sm" id="${uid}_seed" type="button">Seed</button>
          <button class="btn ghost sm" id="${uid}_clear" type="button">Clear</button>
        </div>
      </div>
      <div class="labCard">
        <div class="labCardTitle">Result</div>
        <div id="${uid}_info" class="sub">Place some points to get started.</div>
      </div>
    `;
    mount.viz.innerHTML = `<canvas id="${uid}_c" class="labCanvas" width="720" height="420"></canvas>`;
    const canvas = $(uid + "_c");
    const ctx = canvas.getContext("2d");
    const W = 720, H = 420;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = "100%"; canvas.style.height = "auto";
    ctx.scale(dpr, dpr);

    let points = [];
    let classifyMode = false;
    let lastQuery = null;
    let lastNeighbors = [];

    const kEl = $(uid + "_k");
    const kv = $(uid + "_kv");
    const info = $(uid + "_info");
    const modeBtn = $(uid + "_mode");

    function draw() {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "rgba(42,42,60,.55)";
      ctx.fillRect(0, 0, W, H);

      if (lastQuery && lastNeighbors.length) {
        lastNeighbors.forEach(n => {
          ctx.beginPath();
          ctx.moveTo(lastQuery.x, lastQuery.y);
          ctx.lineTo(n.x, n.y);
          ctx.strokeStyle = "rgba(107,158,158,.35)";
          ctx.lineWidth = 1;
          ctx.setLineDash([5, 5]);
          ctx.stroke();
          ctx.setLineDash([]);
        });
      }

      points.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
        ctx.fillStyle = p.cls === 0 ? "rgba(224,122,95,.85)" : "rgba(255,107,107,.85)";
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,.2)";
        ctx.lineWidth = 1;
        ctx.stroke();
      });

      if (lastQuery) {
        ctx.beginPath();
        ctx.arc(lastQuery.x, lastQuery.y, 10, 0, Math.PI * 2);
        ctx.fillStyle = lastQuery.cls === 0 ? "rgba(224,122,95,.45)" : "rgba(255,107,107,.45)";
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.font = "bold 9px var(--sans)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("?", lastQuery.x, lastQuery.y);
        ctx.textBaseline = "alphabetic";
      }
    }

    function toXY(e) {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
    }
    function classify(qx, qy) {
      const k = parseInt(kEl.value, 10);
      const dists = points.map(p => ({ ...p, d: Math.hypot(p.x - qx, p.y - qy) }));
      dists.sort((a, b) => a.d - b.d);
      const neighbors = dists.slice(0, Math.min(k, dists.length));
      lastNeighbors = neighbors;
      const votes = [0, 0];
      neighbors.forEach(n => votes[n.cls]++);
      const cls = votes[0] >= votes[1] ? 0 : 1;
      lastQuery = { x: qx, y: qy, cls };
      draw();
      info.innerHTML = `K=${k} | Blue ${votes[0]} vs Red ${votes[1]} → <b>${cls === 0 ? "Blue" : "Red"}</b>`;
    }

    canvas.addEventListener("click", (e) => {
      const { x, y } = toXY(e);
      if (classifyMode && points.length >= 2) { classify(x, y); return; }
      points.push({ x, y, cls: 0 });
      draw();
    });
    canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const { x, y } = toXY(e);
      points.push({ x, y, cls: 1 });
      draw();
    });

    kEl.addEventListener("input", () => { kv.textContent = kEl.value; if (lastQuery) classify(lastQuery.x, lastQuery.y); });
    modeBtn.addEventListener("click", () => {
      classifyMode = !classifyMode;
      modeBtn.textContent = classifyMode ? "Place mode" : "Classify mode";
    });
    $(uid + "_clear").addEventListener("click", () => { points = []; lastQuery = null; lastNeighbors = []; info.textContent = "Cleared."; draw(); });
    $(uid + "_seed").addEventListener("click", () => {
      points = [];
      for (let i = 0; i < 8; i++) points.push({ x: 140 + Math.random() * 220, y: 90 + Math.random() * 260, cls: 0 });
      for (let i = 0; i < 8; i++) points.push({ x: 380 + Math.random() * 220, y: 90 + Math.random() * 260, cls: 1 });
      lastQuery = null; lastNeighbors = [];
      info.textContent = "Seeded. Try classify mode.";
      draw();
    });
    draw();
  },

  perceptron_4: (mount) => {
    const uid = `pc_${Math.random().toString(36).slice(2, 8)}`;
    const state = { x1: 0.6, x2: 0.4, w1: 0.7, w2: -0.3, bias: -0.2 };
    mount.controls.innerHTML = `
      <div class="labCard">
        <div class="labCardTitle">Inputs & weights</div>
        <div class="labRow"><label>x₁</label><input id="${uid}_x1" type="range" min="-1" max="1" step="0.05" value="${state.x1}"><span id="${uid}_vx1" class="labMono">${state.x1.toFixed(2)}</span></div>
        <div class="labRow"><label>x₂</label><input id="${uid}_x2" type="range" min="-1" max="1" step="0.05" value="${state.x2}"><span id="${uid}_vx2" class="labMono">${state.x2.toFixed(2)}</span></div>
        <div class="labRow"><label>w₁</label><input id="${uid}_w1" type="range" min="-2" max="2" step="0.05" value="${state.w1}"><span id="${uid}_vw1" class="labMono">${state.w1.toFixed(2)}</span></div>
        <div class="labRow"><label>w₂</label><input id="${uid}_w2" type="range" min="-2" max="2" step="0.05" value="${state.w2}"><span id="${uid}_vw2" class="labMono">${state.w2.toFixed(2)}</span></div>
        <div class="labRow"><label>bias</label><input id="${uid}_b" type="range" min="-2" max="2" step="0.05" value="${state.bias}"><span id="${uid}_vb" class="labMono">${state.bias.toFixed(2)}</span></div>
      </div>
      <div class="labCard">
        <div class="labCardTitle">Live computation</div>
        <div id="${uid}_math" class="sub labMono" style="white-space:pre-wrap"></div>
      </div>
    `;
    mount.viz.innerHTML = `<canvas id="${uid}_c" class="labCanvas" width="720" height="420"></canvas>`;
    const canvas = $(uid + "_c");
    const ctx = canvas.getContext("2d");
    const W = 720, H = 420;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = "100%"; canvas.style.height = "auto";
    ctx.scale(dpr, dpr);

    const mathEl = $(uid + "_math");
    const sigmoid = (z) => 1 / (1 + Math.exp(-z));

    function compute() {
      const z = state.x1 * state.w1 + state.x2 * state.w2 + state.bias;
      const out = sigmoid(z);
      return { z, out, fired: out > 0.5 };
    }

    function draw() {
      const { z, out, fired } = compute();
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "rgba(42,42,60,.55)";
      ctx.fillRect(0, 0, W, H);

      const nodeR = 30;
      const in1 = { x: 120, y: 150, label: "x₁", val: state.x1 };
      const in2 = { x: 120, y: 280, label: "x₂", val: state.x2 };
      const sum = { x: 360, y: 215, label: "Σ" };
      const act = { x: 520, y: 215, label: "σ" };
      const outN = { x: 650, y: 215, label: fired ? "1" : "0" };

      function edge(a, b, label, intensity) {
        const alpha = 0.15 + Math.min(1, Math.abs(intensity)) * 0.65;
        ctx.beginPath();
        ctx.moveTo(a.x + nodeR, a.y);
        ctx.lineTo(b.x - nodeR, b.y);
        ctx.strokeStyle = intensity >= 0 ? `rgba(224,122,95,${alpha})` : `rgba(255,107,107,${alpha})`;
        ctx.lineWidth = 1.5 + Math.min(1, Math.abs(intensity)) * 3;
        ctx.stroke();
        ctx.fillStyle = "rgba(200,195,185,.85)";
        ctx.font = "bold 11px var(--mono)";
        ctx.textAlign = "center";
        ctx.fillText(label, (a.x + b.x) / 2, (a.y + b.y) / 2 - 10);
      }
      edge(in1, sum, `w₁=${state.w1.toFixed(2)}`, state.w1);
      edge(in2, sum, `w₂=${state.w2.toFixed(2)}`, state.w2);
      edge(sum, act, `z=${z.toFixed(2)}`, clamp(z / 3, -1, 1));
      edge(act, outN, `${out.toFixed(2)}`, out);

      function node(n, fill) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, nodeR, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,.15)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.font = "bold 16px var(--sans)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(n.label, n.x, n.y);
        if (n.val !== undefined) {
          ctx.font = "11px var(--mono)";
          ctx.fillStyle = "rgba(200,195,185,.75)";
          ctx.fillText(n.val.toFixed(2), n.x, n.y - nodeR - 10);
        }
        ctx.textBaseline = "alphabetic";
      }
      node(in1, "rgba(224,122,95,.18)");
      node(in2, "rgba(224,122,95,.18)");
      node(sum, "rgba(107,158,158,.18)");
      node(act, "rgba(107,158,158,.25)");
      node(outN, fired ? "rgba(107,255,184,.22)" : "rgba(255,107,107,.16)");

      ctx.fillStyle = "rgba(200,195,185,.7)";
      ctx.font = "bold 12px var(--mono)";
      ctx.textAlign = "center";
      ctx.fillText(`bias=${state.bias.toFixed(2)}`, sum.x, sum.y + nodeR + 20);

      mathEl.textContent = `z = ${state.x1.toFixed(2)}·${state.w1.toFixed(2)} + ${state.x2.toFixed(2)}·${state.w2.toFixed(2)} + ${state.bias.toFixed(2)} = ${z.toFixed(4)}\nσ(z) = ${out.toFixed(4)}\nDecision: ${fired ? "Class 1" : "Class 0"}`;
    }

    function bind(key, elId, valId) {
      const el = $(elId);
      const v = $(valId);
      el.addEventListener("input", () => {
        state[key] = parseFloat(el.value);
        v.textContent = state[key].toFixed(2);
        draw();
      });
    }
    bind("x1", `${uid}_x1`, `${uid}_vx1`);
    bind("x2", `${uid}_x2`, `${uid}_vx2`);
    bind("w1", `${uid}_w1`, `${uid}_vw1`);
    bind("w2", `${uid}_w2`, `${uid}_vw2`);
    bind("bias", `${uid}_b`, `${uid}_vb`);
    draw();
  },

  dtree_4: (mount) => {
    const uid = `dt_${Math.random().toString(36).slice(2, 8)}`;
    mount.controls.innerHTML = `
      <div class="labCard">
        <div class="labCardTitle">Tree builder</div>
        <div class="sub">Grow splits one-by-one, then classify a random sample to see the path.</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button id="${uid}_grow" class="btn primary sm" type="button">Grow</button>
          <button id="${uid}_classify" class="btn sm" type="button">Classify sample</button>
          <button id="${uid}_reset" class="btn ghost sm" type="button">Reset</button>
        </div>
      </div>
      <div class="labCard">
        <div class="labCardTitle">Info</div>
        <div id="${uid}_info" class="sub labMono" style="white-space:pre-wrap">Click Grow to add the first split.</div>
      </div>
    `;
    mount.viz.innerHTML = `<canvas id="${uid}_c" class="labCanvas" width="820" height="420"></canvas>`;
    const canvas = $(uid + "_c");
    const ctx = canvas.getContext("2d");
    const W = 820, H = 420;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = "100%"; canvas.style.height = "auto";
    ctx.scale(dpr, dpr);

    const info = $(uid + "_info");
    const questions = [
      { q: "Age > 30?", test: (s) => s.age > 30 },
      { q: "Income > 50k?", test: (s) => s.income > 50 },
      { q: "Has degree?", test: (s) => !!s.degree },
      { q: "Experience > 5y?", test: (s) => s.exp > 5 },
    ];

    let nodes, edges, growIdx;
    function reset() {
      nodes = [{ id: 0, depth: 0, x: W / 2, y: 60, rule: "Root", leaf: true, label: "?" }];
      edges = [];
      growIdx = 0;
      layout(); draw();
      info.textContent = "Click Grow to add the first split.";
    }
    function layout() {
      const byDepth = {};
      nodes.forEach(n => { (byDepth[n.depth] ||= []).push(n); });
      Object.keys(byDepth).forEach(d => {
        const arr = byDepth[d];
        const gap = W / (arr.length + 1);
        arr.forEach((n, i) => { n.x = gap * (i + 1); n.y = 60 + parseInt(d, 10) * 110; });
      });
    }
    function draw() {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "rgba(42,42,60,.55)";
      ctx.fillRect(0, 0, W, H);

      edges.forEach(e => {
        const from = nodes.find(n => n.id === e.from);
        const to = nodes.find(n => n.id === e.to);
        if (!from || !to) return;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y + 24);
        ctx.lineTo(to.x, to.y - 24);
        ctx.strokeStyle = e.label === "Yes" ? "rgba(107,255,184,.55)" : "rgba(255,107,107,.45)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = e.label === "Yes" ? "rgba(107,255,184,.85)" : "rgba(255,107,107,.8)";
        ctx.font = "bold 11px var(--sans)";
        ctx.textAlign = "center";
        ctx.fillText(e.label, (from.x + to.x) / 2 + (e.label === "Yes" ? -16 : 16), (from.y + to.y) / 2);
      });

      nodes.forEach(n => {
        if (n.leaf) {
          ctx.beginPath();
          ctx.roundRect(n.x - 34, n.y - 20, 68, 40, 12);
          ctx.fillStyle =
            n.label === "Approve" ? "rgba(107,255,184,.18)" :
            n.label === "Reject" ? "rgba(255,107,107,.16)" :
            "rgba(107,158,158,.16)";
          ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,.12)";
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.fillStyle = "#fff";
          ctx.font = "bold 12px var(--sans)";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(n.label, n.x, n.y);
          ctx.textBaseline = "alphabetic";
        } else {
          ctx.beginPath();
          ctx.arc(n.x, n.y, 24, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(224,122,95,.15)";
          ctx.fill();
          ctx.strokeStyle = "rgba(224,122,95,.35)";
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.fillStyle = "#fff";
          ctx.font = "bold 10px var(--sans)";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(n.rule, n.x, n.y);
          ctx.textBaseline = "alphabetic";
        }
      });
    }

    function grow() {
      if (growIdx >= questions.length) { info.textContent = "Tree is fully grown."; return; }
      const leaves = nodes.filter(n => n.leaf);
      if (!leaves.length) return;
      const target = leaves[0];
      const q = questions[growIdx++];
      target.leaf = false;
      target.rule = q.q;
      const yesId = nodes.length;
      const noId = nodes.length + 1;
      nodes.push({ id: yesId, depth: target.depth + 1, x: 0, y: 0, leaf: true, label: growIdx >= questions.length ? "Approve" : "?" });
      nodes.push({ id: noId, depth: target.depth + 1, x: 0, y: 0, leaf: true, label: growIdx >= questions.length - 1 ? "Reject" : "?" });
      edges.push({ from: target.id, to: yesId, label: "Yes" });
      edges.push({ from: target.id, to: noId, label: "No" });
      layout(); draw();
      info.textContent = `Added split: ${q.q}`;
    }

    function classify() {
      if (growIdx === 0) { info.textContent = "Grow the tree first."; return; }
      const sample = {
        age: Math.round(Math.random() * 50 + 18),
        income: Math.round(Math.random() * 80 + 20),
        degree: Math.random() > 0.5,
        exp: Math.round(Math.random() * 15),
      };
      let path = `Sample: age=${sample.age}, income=${sample.income}k, degree=${sample.degree ? "yes" : "no"}, exp=${sample.exp}y\nPath: `;
      let nodeId = 0;
      for (let i = 0; i < growIdx; i++) {
        const n = nodes.find(x => x.id === nodeId);
        if (!n || n.leaf) break;
        const yes = questions[i].test(sample);
        path += `${n.rule} → ${yes ? "Yes" : "No"} → `;
        const edge = edges.find(e => e.from === nodeId && e.label === (yes ? "Yes" : "No"));
        if (!edge) break;
        nodeId = edge.to;
      }
      const final = nodes.find(x => x.id === nodeId);
      path += final ? final.label : "?";
      info.textContent = path;
    }

    $(uid + "_grow").addEventListener("click", grow);
    $(uid + "_classify").addEventListener("click", classify);
    $(uid + "_reset").addEventListener("click", reset);
    reset();
  },

  // Remaining topic visualizers (minimum viable interaction each)
  logreg_4: (mount) => {
    const uid = `lg_${Math.random().toString(36).slice(2, 8)}`;
    const st = { w: 2.0, b: -1.0, thr: 0.5 };
    mount.controls.innerHTML = `
      <div class="labCard">
        <div class="labCardTitle">Sigmoid classifier</div>
        <div class="labRow"><label>w</label><input id="${uid}_w" type="range" min="-6" max="6" step="0.1" value="${st.w}"><span id="${uid}_vw" class="labMono">${st.w.toFixed(1)}</span></div>
        <div class="labRow"><label>b</label><input id="${uid}_b" type="range" min="-6" max="6" step="0.1" value="${st.b}"><span id="${uid}_vb" class="labMono">${st.b.toFixed(1)}</span></div>
        <div class="labRow"><label>threshold</label><input id="${uid}_t" type="range" min="0.1" max="0.9" step="0.05" value="${st.thr}"><span id="${uid}_vt" class="labMono">${st.thr.toFixed(2)}</span></div>
        <div class="sub">This is 1D logistic regression: \(p=\\sigma(wx+b)\). Move sliders and watch the curve + decision point.</div>
      </div>
    `;
    mount.viz.innerHTML = `<canvas id="${uid}_c" class="labCanvas" width="720" height="420"></canvas>`;
    const canvas = $(uid + "_c");
    const ctx = canvas.getContext("2d");
    const W = 720, H = 420;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = "100%"; canvas.style.height = "auto";
    ctx.scale(dpr, dpr);
    const sig = (z) => 1 / (1 + Math.exp(-z));

    function draw() {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "rgba(42,42,60,.55)";
      ctx.fillRect(0, 0, W, H);
      // axes
      ctx.strokeStyle = "rgba(255,255,255,.12)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(60, H - 60); ctx.lineTo(W - 40, H - 60); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(60, H - 60); ctx.lineTo(60, 40); ctx.stroke();
      ctx.fillStyle = "rgba(200,195,185,.65)";
      ctx.font = "12px var(--mono)";
      ctx.fillText("x", W - 50, H - 40);
      ctx.fillText("p", 42, 50);

      // curve
      ctx.beginPath();
      for (let i = 0; i <= 240; i++) {
        const x = -6 + (12 * i) / 240;
        const p = sig(st.w * x + st.b);
        const px = 60 + ((x + 6) / 12) * (W - 120);
        const py = (H - 60) - p * (H - 120);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = "rgba(224,122,95,.9)";
      ctx.lineWidth = 2.2;
      ctx.stroke();

      // threshold line
      const thY = (H - 60) - st.thr * (H - 120);
      ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(60, thY); ctx.lineTo(W - 40, thY); ctx.strokeStyle = "rgba(107,158,158,.55)"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(200,195,185,.75)";
      ctx.fillText(`threshold=${st.thr.toFixed(2)}`, 70, thY - 8);

      // decision boundary at p=0.5 -> wx+b=0 -> x=-b/w
      const x0 = Math.abs(st.w) < 1e-6 ? 0 : -st.b / st.w;
      const px0 = 60 + ((clamp(x0, -6, 6) + 6) / 12) * (W - 120);
      ctx.beginPath();
      ctx.moveTo(px0, H - 60);
      ctx.lineTo(px0, 40);
      ctx.strokeStyle = "rgba(255,255,255,.18)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "rgba(200,195,185,.75)";
      ctx.fillText(`boundary x≈${x0.toFixed(2)}`, px0 + 8, 54);
    }

    function bind(id, key, fmt) {
      const el = $(id);
      const v = $(id.replace(/_.$/, "_v" + key[0])); // not used
    }
    const wEl = $(uid + "_w"), bEl = $(uid + "_b"), tEl = $(uid + "_t");
    const vw = $(uid + "_vw"), vb = $(uid + "_vb"), vt = $(uid + "_vt");
    wEl.addEventListener("input", () => { st.w = parseFloat(wEl.value); vw.textContent = st.w.toFixed(1); draw(); });
    bEl.addEventListener("input", () => { st.b = parseFloat(bEl.value); vb.textContent = st.b.toFixed(1); draw(); });
    tEl.addEventListener("input", () => { st.thr = parseFloat(tEl.value); vt.textContent = st.thr.toFixed(2); draw(); });
    draw();
  },

  nn_4: (mount) => {
    // Tiny forward-pass demo with random weights
    const uid = `nn_${Math.random().toString(36).slice(2, 8)}`;
    const st = { in1: 0.2, in2: 0.8 };
    mount.controls.innerHTML = `
      <div class="labCard">
        <div class="labCardTitle">Inputs</div>
        <div class="labRow"><label>x₁</label><input id="${uid}_i1" type="range" min="0" max="1" step="0.01" value="${st.in1}"><span id="${uid}_vi1" class="labMono">${st.in1.toFixed(2)}</span></div>
        <div class="labRow"><label>x₂</label><input id="${uid}_i2" type="range" min="0" max="1" step="0.01" value="${st.in2}"><span id="${uid}_vi2" class="labMono">${st.in2.toFixed(2)}</span></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button id="${uid}_rand" class="btn primary sm" type="button">Randomize weights</button>
        </div>
      </div>
      <div class="labCard">
        <div class="labCardTitle">Output</div>
        <div id="${uid}_out" class="sub labMono" style="white-space:pre-wrap"></div>
      </div>
    `;
    mount.viz.innerHTML = `<canvas id="${uid}_c" class="labCanvas" width="720" height="420"></canvas>`;
    const canvas = $(uid + "_c");
    const ctx = canvas.getContext("2d");
    const W = 720, H = 420;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = "100%"; canvas.style.height = "auto";
    ctx.scale(dpr, dpr);
    const outEl = $(uid + "_out");
    const sig = (z) => 1 / (1 + Math.exp(-z));

    let w = { h11: Math.random() * 2 - 1, h12: Math.random() * 2 - 1, h21: Math.random() * 2 - 1, h22: Math.random() * 2 - 1, o1: Math.random() * 2 - 1, o2: Math.random() * 2 - 1, b1: 0.2, b2: -0.1, bo: 0.1 };
    function forward() {
      const h1 = sig(st.in1 * w.h11 + st.in2 * w.h21 + w.b1);
      const h2 = sig(st.in1 * w.h12 + st.in2 * w.h22 + w.b2);
      const o = sig(h1 * w.o1 + h2 * w.o2 + w.bo);
      return { h1, h2, o };
    }
    function draw() {
      const { h1, h2, o } = forward();
      outEl.textContent = `Hidden: [${h1.toFixed(3)}, ${h2.toFixed(3)}]\nOutput: ${o.toFixed(4)}`;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "rgba(42,42,60,.55)";
      ctx.fillRect(0, 0, W, H);
      const nodes = {
        i1: { x: 140, y: 140, a: st.in1, l: "x₁" },
        i2: { x: 140, y: 280, a: st.in2, l: "x₂" },
        h1: { x: 360, y: 170, a: h1, l: "h₁" },
        h2: { x: 360, y: 250, a: h2, l: "h₂" },
        o: { x: 580, y: 210, a: o, l: "ŷ" },
      };
      function edge(a, b, ww) {
        ctx.beginPath(); ctx.moveTo(a.x + 22, a.y); ctx.lineTo(b.x - 22, b.y);
        ctx.strokeStyle = ww >= 0 ? `rgba(224,122,95,${0.15 + Math.abs(ww) * 0.35})` : `rgba(255,107,107,${0.15 + Math.abs(ww) * 0.35})`;
        ctx.lineWidth = 1 + Math.abs(ww) * 2;
        ctx.stroke();
      }
      edge(nodes.i1, nodes.h1, w.h11); edge(nodes.i2, nodes.h1, w.h21);
      edge(nodes.i1, nodes.h2, w.h12); edge(nodes.i2, nodes.h2, w.h22);
      edge(nodes.h1, nodes.o, w.o1); edge(nodes.h2, nodes.o, w.o2);
      function node(n) {
        ctx.beginPath(); ctx.arc(n.x, n.y, 22, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(107,158,158,${0.12 + n.a * 0.45})`;
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,.15)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = "#fff"; ctx.font = "bold 12px var(--mono)";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(n.a.toFixed(2), n.x, n.y);
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = "rgba(200,195,185,.75)"; ctx.font = "bold 12px var(--sans)";
        ctx.fillText(n.l, n.x, n.y - 32);
      }
      Object.values(nodes).forEach(node);
    }
    function bind(id, key, vid) {
      const el = $(id), v = $(vid);
      el.addEventListener("input", () => { st[key] = parseFloat(el.value); v.textContent = st[key].toFixed(2); draw(); });
    }
    bind(uid + "_i1", "in1", uid + "_vi1");
    bind(uid + "_i2", "in2", uid + "_vi2");
    $(uid + "_rand").addEventListener("click", () => { w = { h11: Math.random() * 2 - 1, h12: Math.random() * 2 - 1, h21: Math.random() * 2 - 1, h22: Math.random() * 2 - 1, o1: Math.random() * 2 - 1, o2: Math.random() * 2 - 1, b1: Math.random() * 0.6 - 0.3, b2: Math.random() * 0.6 - 0.3, bo: Math.random() * 0.6 - 0.3 }; draw(); });
    draw();
  },

  rf_4: (mount) => {
    const uid = `rf_${Math.random().toString(36).slice(2, 8)}`;
    const st = { x: 0.5, n: 7 };
    mount.controls.innerHTML = `
      <div class="labCard">
        <div class="labCardTitle">Forest vote (toy)</div>
        <div class="labRow"><label>trees</label><input id="${uid}_n" type="range" min="3" max="15" step="2" value="${st.n}"><span id="${uid}_vn" class="labMono">${st.n}</span></div>
        <div class="labRow"><label>x</label><input id="${uid}_x" type="range" min="0" max="1" step="0.01" value="${st.x}"><span id="${uid}_vx" class="labMono">${st.x.toFixed(2)}</span></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button id="${uid}_regen" class="btn primary sm" type="button">Regenerate trees</button>
        </div>
        <div class="sub">Each tree is a stump: “x &gt; threshold?”. The forest votes.</div>
      </div>
      <div class="labCard"><div class="labCardTitle">Result</div><div id="${uid}_info" class="sub"></div></div>
    `;
    mount.viz.innerHTML = `<div id="${uid}_bars"></div>`;
    const bars = $(uid + "_bars");
    const info = $(uid + "_info");
    let thresholds = [];
    function regen() {
      thresholds = Array.from({ length: st.n }, () => Math.random());
      render();
    }
    function render() {
      const yes = thresholds.filter(t => st.x > t).length;
      const no = thresholds.length - yes;
      const cls = yes >= no ? "Class 1" : "Class 0";
      info.innerHTML = `Votes: <b>${yes}</b> yes vs <b>${no}</b> no → <b>${cls}</b>`;
      bars.innerHTML = `
        <div class="panel">
          <div class="panelTitle">Tree votes</div>
          <div style="display:grid;gap:8px;margin-top:10px">
            ${thresholds.map((t, i) => {
              const v = st.x > t;
              return `<div class="sub" style="display:flex;align-items:center;gap:10px">
                <span class="labMono" style="width:52px">T${i + 1}</span>
                <div style="flex:1;height:10px;border-radius:999px;background:rgba(0,0,0,.06);overflow:hidden;box-shadow:var(--neo-sm-in)">
                  <div style="width:${Math.round(t * 100)}%;height:100%;background:rgba(107,158,158,.25)"></div>
                </div>
                <span class="pill ${v ? "pillGlow" : ""}" style="margin:0">${v ? "Yes" : "No"}</span>
              </div>`;
            }).join("")}
          </div>
        </div>
      `;
    }
    const nEl = $(uid + "_n"), xEl = $(uid + "_x"), vn = $(uid + "_vn"), vx = $(uid + "_vx");
    nEl.addEventListener("input", () => { st.n = parseInt(nEl.value, 10); vn.textContent = st.n; regen(); });
    xEl.addEventListener("input", () => { st.x = parseFloat(xEl.value); vx.textContent = st.x.toFixed(2); render(); });
    $(uid + "_regen").addEventListener("click", regen);
    regen();
  },

  svm_4: (mount) => {
    const uid = `svm_${Math.random().toString(36).slice(2, 8)}`;
    const st = { angle: 20, offset: 0.0, margin: 0.25 };
    mount.controls.innerHTML = `
      <div class="labCard">
        <div class="labCardTitle">Max-margin separator (toy)</div>
        <div class="labRow"><label>angle</label><input id="${uid}_a" type="range" min="-80" max="80" step="1" value="${st.angle}"><span id="${uid}_va" class="labMono">${st.angle}°</span></div>
        <div class="labRow"><label>offset</label><input id="${uid}_o" type="range" min="-0.6" max="0.6" step="0.01" value="${st.offset}"><span id="${uid}_vo" class="labMono">${st.offset.toFixed(2)}</span></div>
        <div class="labRow"><label>margin</label><input id="${uid}_m" type="range" min="0.05" max="0.5" step="0.01" value="${st.margin}"><span id="${uid}_vm" class="labMono">${st.margin.toFixed(2)}</span></div>
        <div class="sub">Rotate/shift the hyperplane and see which points violate the margin.</div>
      </div>
      <div class="labCard"><div class="labCardTitle">Stats</div><div id="${uid}_info" class="sub"></div></div>
    `;
    mount.viz.innerHTML = `<canvas id="${uid}_c" class="labCanvas" width="720" height="420"></canvas>`;
    const canvas = $(uid + "_c");
    const ctx = canvas.getContext("2d");
    const W = 720, H = 420;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = "100%"; canvas.style.height = "auto";
    ctx.scale(dpr, dpr);
    const info = $(uid + "_info");
    const pts = [];
    for (let i = 0; i < 18; i++) pts.push({ x: 0.25 + Math.random() * 0.18, y: 0.25 + Math.random() * 0.5, cls: 0 });
    for (let i = 0; i < 18; i++) pts.push({ x: 0.58 + Math.random() * 0.18, y: 0.25 + Math.random() * 0.5, cls: 1 });
    function sign(p) {
      const th = (st.angle * Math.PI) / 180;
      const nx = Math.cos(th), ny = Math.sin(th);
      const d = (p.x - 0.5) * nx + (p.y - 0.5) * ny + st.offset;
      return d;
    }
    function draw() {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "rgba(42,42,60,.55)";
      ctx.fillRect(0, 0, W, H);
      const th = (st.angle * Math.PI) / 180;
      const nx = Math.cos(th), ny = Math.sin(th);

      // draw decision line and margins in normalized space
      function lineAt(c, alpha) {
        // points satisfying (x-0.5)nx + (y-0.5)ny + offset = c
        const ptsL = [];
        for (let t = 0; t <= 1; t += 0.02) {
          // solve for y given x=t: (t-0.5)nx + (y-0.5)ny + offset = c
          if (Math.abs(ny) < 1e-6) continue;
          const y = 0.5 + (c - st.offset - (t - 0.5) * nx) / ny;
          if (y >= 0 && y <= 1) ptsL.push({ x: t, y });
        }
        if (ptsL.length < 2) return;
        ctx.beginPath();
        ptsL.forEach((p, i) => {
          const px = 70 + p.x * (W - 140);
          const py = 50 + p.y * (H - 100);
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        });
        ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      lineAt(0, 0.22);
      ctx.setLineDash([6, 6]);
      lineAt(st.margin, 0.14);
      lineAt(-st.margin, 0.14);
      ctx.setLineDash([]);

      let viol = 0;
      pts.forEach(p => {
        const d = sign(p);
        const y = p.cls === 0 ? -1 : 1;
        const m = y * d;
        const bad = m < st.margin;
        if (bad) viol++;
        const px = 70 + p.x * (W - 140);
        const py = 50 + p.y * (H - 100);
        ctx.beginPath();
        ctx.arc(px, py, bad ? 8 : 6, 0, Math.PI * 2);
        ctx.fillStyle = p.cls === 0 ? "rgba(224,122,95,.85)" : "rgba(107,255,184,.75)";
        ctx.fill();
        ctx.strokeStyle = bad ? "rgba(255,107,107,.9)" : "rgba(255,255,255,.18)";
        ctx.lineWidth = bad ? 2 : 1;
        ctx.stroke();
      });
      info.innerHTML = `Margin violations: <b>${viol}</b> / ${pts.length}`;
    }
    const aEl = $(uid + "_a"), oEl = $(uid + "_o"), mEl = $(uid + "_m");
    const va = $(uid + "_va"), vo = $(uid + "_vo"), vm = $(uid + "_vm");
    aEl.addEventListener("input", () => { st.angle = parseFloat(aEl.value); va.textContent = `${st.angle}°`; draw(); });
    oEl.addEventListener("input", () => { st.offset = parseFloat(oEl.value); vo.textContent = st.offset.toFixed(2); draw(); });
    mEl.addEventListener("input", () => { st.margin = parseFloat(mEl.value); vm.textContent = st.margin.toFixed(2); draw(); });
    draw();
  },

  kmeans_4: (mount) => {
    const uid = `km_${Math.random().toString(36).slice(2, 8)}`;
    const st = { k: 3 };
    mount.controls.innerHTML = `
      <div class="labCard">
        <div class="labCardTitle">K-Means (stepper)</div>
        <div class="sub">Click to place centroids (up to K). Then step: assign → update.</div>
        <div class="labRow"><label>K</label><input id="${uid}_k" type="range" min="2" max="5" step="1" value="${st.k}"><span id="${uid}_vk" class="labMono">${st.k}</span></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button id="${uid}_assign" class="btn primary sm" type="button">Assign</button>
          <button id="${uid}_update" class="btn sm" type="button">Update</button>
          <button id="${uid}_reset" class="btn ghost sm" type="button">Reset</button>
        </div>
      </div>
      <div class="labCard"><div class="labCardTitle">Inertia</div><div id="${uid}_info" class="sub labMono"></div></div>
    `;
    mount.viz.innerHTML = `<canvas id="${uid}_c" class="labCanvas" width="720" height="420"></canvas>`;
    const canvas = $(uid + "_c");
    const ctx = canvas.getContext("2d");
    const W = 720, H = 420;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = "100%"; canvas.style.height = "auto";
    ctx.scale(dpr, dpr);

    const colors = ["rgba(224,122,95,.85)", "rgba(107,255,184,.75)", "rgba(107,158,158,.85)", "rgba(255,107,107,.85)", "rgba(255,210,107,.85)"];
    let points = [];
    let centroids = [];
    const info = $(uid + "_info");
    function gen() {
      points = [];
      for (let i = 0; i < 45; i++) points.push({ x: 70 + Math.random() * (W - 140), y: 60 + Math.random() * (H - 120), c: -1 });
    }
    function assign() {
      points.forEach(p => {
        if (!centroids.length) { p.c = -1; return; }
        let best = 0, bd = 1e9;
        centroids.forEach((c, i) => {
          const d = (p.x - c.x) ** 2 + (p.y - c.y) ** 2;
          if (d < bd) { bd = d; best = i; }
        });
        p.c = best;
      });
      draw();
    }
    function update() {
      if (!centroids.length) return;
      const sums = centroids.map(() => ({ x: 0, y: 0, n: 0 }));
      points.forEach(p => {
        if (p.c < 0) return;
        const s = sums[p.c];
        s.x += p.x; s.y += p.y; s.n++;
      });
      centroids = centroids.map((c, i) => sums[i].n ? ({ x: sums[i].x / sums[i].n, y: sums[i].y / sums[i].n }) : c);
      draw();
    }
    function inertia() {
      let s = 0;
      points.forEach(p => {
        if (p.c < 0 || !centroids[p.c]) return;
        s += (p.x - centroids[p.c].x) ** 2 + (p.y - centroids[p.c].y) ** 2;
      });
      return s;
    }
    function draw() {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "rgba(42,42,60,.55)";
      ctx.fillRect(0, 0, W, H);
      points.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = p.c < 0 ? "rgba(200,195,185,.35)" : colors[p.c % colors.length];
        ctx.fill();
      });
      centroids.forEach((c, i) => {
        ctx.beginPath();
        ctx.arc(c.x, c.y, 10, 0, Math.PI * 2);
        ctx.fillStyle = colors[i % colors.length];
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.stroke();
      });
      info.textContent = `inertia=${Math.round(inertia())} | centroids=${centroids.length}/${st.k}`;
    }
    canvas.addEventListener("click", (e) => {
      if (centroids.length >= st.k) return;
      const r = canvas.getBoundingClientRect();
      centroids.push({ x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) });
      draw();
    });
    $(uid + "_assign").addEventListener("click", assign);
    $(uid + "_update").addEventListener("click", update);
    $(uid + "_reset").addEventListener("click", () => { centroids = []; gen(); draw(); });
    const kEl = $(uid + "_k"), vk = $(uid + "_vk");
    kEl.addEventListener("input", () => { st.k = parseInt(kEl.value, 10); vk.textContent = st.k; centroids = []; gen(); draw(); });
    gen(); draw();
  },

  pca_4: (mount) => {
    const uid = `pca_${Math.random().toString(36).slice(2, 8)}`;
    const st = { ang: 30 };
    mount.controls.innerHTML = `
      <div class="labCard">
        <div class="labCardTitle">PCA intuition (2D)</div>
        <div class="labRow"><label>axis angle</label><input id="${uid}_a" type="range" min="0" max="180" step="1" value="${st.ang}"><span id="${uid}_va" class="labMono">${st.ang}°</span></div>
        <div class="sub">Rotate the axis and see how much variance you capture along that direction.</div>
      </div>
      <div class="labCard"><div class="labCardTitle">Variance captured</div><div id="${uid}_info" class="sub labMono"></div></div>
    `;
    mount.viz.innerHTML = `<canvas id="${uid}_c" class="labCanvas" width="720" height="420"></canvas>`;
    const canvas = $(uid + "_c");
    const ctx = canvas.getContext("2d");
    const W = 720, H = 420;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = "100%"; canvas.style.height = "auto";
    ctx.scale(dpr, dpr);
    const info = $(uid + "_info");
    const pts = Array.from({ length: 60 }, () => {
      // elongated cloud
      const t = (Math.random() * 2 - 1) * 1.4;
      const n = (Math.random() * 2 - 1) * 0.35;
      const x = 0.5 + 0.28 * t + 0.08 * n;
      const y = 0.5 + 0.10 * t - 0.20 * n;
      return { x, y };
    });
    function varianceAlong(theta) {
      const ux = Math.cos(theta), uy = Math.sin(theta);
      const proj = pts.map(p => (p.x - 0.5) * ux + (p.y - 0.5) * uy);
      const mean = proj.reduce((a, b) => a + b, 0) / proj.length;
      return proj.reduce((s, v) => s + (v - mean) ** 2, 0) / proj.length;
    }
    function draw() {
      const th = (st.ang * Math.PI) / 180;
      const v = varianceAlong(th);
      const v90 = varianceAlong(th + Math.PI / 2);
      const ratio = v / (v + v90);
      info.textContent = `var_axis=${v.toFixed(4)} | share=${(ratio * 100).toFixed(1)}%`;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "rgba(42,42,60,.55)";
      ctx.fillRect(0, 0, W, H);
      const ox = W / 2, oy = H / 2;
      pts.forEach(p => {
        const x = ox + (p.x - 0.5) * 520;
        const y = oy + (p.y - 0.5) * 320;
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(107,158,158,.85)";
        ctx.fill();
      });
      // axis line
      const ux = Math.cos(th), uy = Math.sin(th);
      ctx.beginPath();
      ctx.moveTo(ox - ux * 260, oy - uy * 260);
      ctx.lineTo(ox + ux * 260, oy + uy * 260);
      ctx.strokeStyle = "rgba(224,122,95,.9)";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    const aEl = $(uid + "_a"), va = $(uid + "_va");
    aEl.addEventListener("input", () => { st.ang = parseFloat(aEl.value); va.textContent = `${st.ang}°`; draw(); });
    draw();
  },

  naive_4: (mount) => {
    const uid = `nb_${Math.random().toString(36).slice(2, 8)}`;
    const st = { pSpam: 0.4, pWordSpam: 0.7, pWordHam: 0.1 };
    mount.controls.innerHTML = `
      <div class="labCard">
        <div class="labCardTitle">Naive Bayes posterior</div>
        <div class="labRow"><label>P(spam)</label><input id="${uid}_ps" type="range" min="0.05" max="0.95" step="0.01" value="${st.pSpam}"><span id="${uid}_vps" class="labMono">${st.pSpam.toFixed(2)}</span></div>
        <div class="labRow"><label>P(word|spam)</label><input id="${uid}_pws" type="range" min="0.01" max="0.99" step="0.01" value="${st.pWordSpam}"><span id="${uid}_vpws" class="labMono">${st.pWordSpam.toFixed(2)}</span></div>
        <div class="labRow"><label>P(word|ham)</label><input id="${uid}_pwh" type="range" min="0.01" max="0.99" step="0.01" value="${st.pWordHam}"><span id="${uid}_vpwh" class="labMono">${st.pWordHam.toFixed(2)}</span></div>
        <div class="sub">Compute \(P(spam|word) \\propto P(word|spam)P(spam)\).</div>
      </div>
    `;
    mount.viz.innerHTML = `<div class="panel"><div class="panelTitle">Posterior</div><div id="${uid}_out" class="sub labMono" style="white-space:pre-wrap;margin-top:8px"></div><div style="display:grid;gap:8px;margin-top:10px"><div style="height:14px;border-radius:999px;background:rgba(0,0,0,.06);overflow:hidden;box-shadow:var(--neo-sm-in)"><div id="${uid}_barS" style="height:100%"></div></div><div style="height:14px;border-radius:999px;background:rgba(0,0,0,.06);overflow:hidden;box-shadow:var(--neo-sm-in)"><div id="${uid}_barH" style="height:100%"></div></div></div><div class="sub" style="margin-top:8px">Top bar = spam posterior, bottom = ham posterior.</div></div>`;
    const out = $(uid + "_out");
    const barS = $(uid + "_barS");
    const barH = $(uid + "_barH");
    function render() {
      const pHam = 1 - st.pSpam;
      const numS = st.pWordSpam * st.pSpam;
      const numH = st.pWordHam * pHam;
      const denom = numS + numH;
      const postS = denom ? numS / denom : 0.5;
      const postH = 1 - postS;
      out.textContent = `P(spam|word) = ${postS.toFixed(4)}\nP(ham|word)  = ${postH.toFixed(4)}`;
      barS.style.width = `${Math.round(postS * 100)}%`;
      barS.style.background = "linear-gradient(90deg, var(--coral), var(--teal))";
      barH.style.width = `${Math.round(postH * 100)}%`;
      barH.style.background = "linear-gradient(90deg, rgba(107,158,158,.7), rgba(224,122,95,.35))";
    }
    const ps = $(uid + "_ps"), pws = $(uid + "_pws"), pwh = $(uid + "_pwh");
    const vps = $(uid + "_vps"), vpws = $(uid + "_vpws"), vpwh = $(uid + "_vpwh");
    ps.addEventListener("input", () => { st.pSpam = parseFloat(ps.value); vps.textContent = st.pSpam.toFixed(2); render(); });
    pws.addEventListener("input", () => { st.pWordSpam = parseFloat(pws.value); vpws.textContent = st.pWordSpam.toFixed(2); render(); });
    pwh.addEventListener("input", () => { st.pWordHam = parseFloat(pwh.value); vpwh.textContent = st.pWordHam.toFixed(2); render(); });
    render();
  },

  gradient_4: (mount) => {
    const uid = `gd_${Math.random().toString(36).slice(2, 8)}`;
    const st = { w: -3.0, lr: 0.2, steps: 0 };
    mount.controls.innerHTML = `
      <div class="labCard">
        <div class="labCardTitle">Gradient descent (1D)</div>
        <div class="labRow"><label>learning rate</label><input id="${uid}_lr" type="range" min="0.01" max="0.6" step="0.01" value="${st.lr}"><span id="${uid}_vlr" class="labMono">${st.lr.toFixed(2)}</span></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button id="${uid}_step" class="btn primary sm" type="button">Step</button>
          <button id="${uid}_run" class="btn sm" type="button">Run 10</button>
          <button id="${uid}_reset" class="btn ghost sm" type="button">Reset</button>
        </div>
        <div class="sub">We minimize \(L(w)=(w-2)^2\\). Gradient is \(dL/dw=2(w-2)\\).</div>
      </div>
      <div class="labCard"><div class="labCardTitle">State</div><div id="${uid}_info" class="sub labMono" style="white-space:pre-wrap"></div></div>
    `;
    mount.viz.innerHTML = `<canvas id="${uid}_c" class="labCanvas" width="720" height="420"></canvas>`;
    const canvas = $(uid + "_c");
    const ctx = canvas.getContext("2d");
    const W = 720, H = 420;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.width = "100%"; canvas.style.height = "auto";
    ctx.scale(dpr, dpr);
    const info = $(uid + "_info");
    function loss(w) { return (w - 2) ** 2; }
    function grad(w) { return 2 * (w - 2); }
    function draw() {
      info.textContent = `w=${st.w.toFixed(4)}\nL=${loss(st.w).toFixed(4)}\nsteps=${st.steps}`;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "rgba(42,42,60,.55)";
      ctx.fillRect(0, 0, W, H);
      // plot curve for w in [-6, 6]
      const x0 = 70, y0 = H - 70, pw = W - 140, ph = H - 140;
      let maxL = 0;
      for (let i = 0; i <= 240; i++) { const wv = -6 + (12 * i) / 240; maxL = Math.max(maxL, loss(wv)); }
      ctx.beginPath();
      for (let i = 0; i <= 240; i++) {
        const wv = -6 + (12 * i) / 240;
        const L = loss(wv);
        const px = x0 + ((wv + 6) / 12) * pw;
        const py = y0 - (L / maxL) * ph;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = "rgba(224,122,95,.9)";
      ctx.lineWidth = 2.2;
      ctx.stroke();
      // current point
      const px = x0 + ((st.w + 6) / 12) * pw;
      const py = y0 - (loss(st.w) / maxL) * ph;
      ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(107,255,184,.75)";
      ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.stroke();
    }
    function step() {
      st.w = st.w - st.lr * grad(st.w);
      st.steps++;
      draw();
    }
    const lrEl = $(uid + "_lr"), vlr = $(uid + "_vlr");
    lrEl.addEventListener("input", () => { st.lr = parseFloat(lrEl.value); vlr.textContent = st.lr.toFixed(2); });
    $(uid + "_step").addEventListener("click", step);
    $(uid + "_run").addEventListener("click", () => { for (let i = 0; i < 10; i++) step(); });
    $(uid + "_reset").addEventListener("click", () => { st.w = -3; st.steps = 0; draw(); });
    draw();
  },

  cnn_4: (mount) => {
    const uid = `cnn_${Math.random().toString(36).slice(2, 8)}`;
    // 5x5 image + 3x3 filter -> 3x3 output
    let img = Array.from({ length: 25 }, () => 0);
    let ker = [0, -1, 0, -1, 5, -1, 0, -1, 0];
    function cellHtml(id, v) {
      const a = clamp((v + 2) / 6, 0, 1);
      return `<div data-c="${id}" style="aspect-ratio:1;border-radius:6px;box-shadow:var(--neo-sm-in);background:rgba(224,122,95,${0.15 + a * 0.6});display:grid;place-items:center;color:rgba(0,0,0,.65);font-family:var(--mono);font-size:12px;cursor:pointer">${v}</div>`;
    }
    function gridHtml(prefix, arr, n, editable) {
      return `<div class="vizGrid" style="grid-template-columns:repeat(${n},1fr);gap:8px;background:transparent">
        ${arr.map((v, i) => editable ? cellHtml(prefix + "_" + i, v) : `<div style="aspect-ratio:1;border-radius:6px;box-shadow:var(--neo-sm-in);background:rgba(107,158,158,${0.12 + clamp((v + 10) / 20, 0, 1) * 0.5});display:grid;place-items:center;color:rgba(0,0,0,.65);font-family:var(--mono);font-size:12px">${v.toFixed ? v.toFixed(0) : v}</div>`).join("")}
      </div>`;
    }
    mount.controls.innerHTML = `
      <div class="labCard">
        <div class="labCardTitle">5×5 image</div>
        <div class="sub">Click cells to toggle 0/1.</div>
        <div id="${uid}_img" style="margin-top:10px"></div>
      </div>
      <div class="labCard">
        <div class="labCardTitle">3×3 filter</div>
        <div class="sub">Click to cycle -1 → 0 → 1.</div>
        <div id="${uid}_ker" style="margin-top:10px"></div>
      </div>
    `;
    mount.viz.innerHTML = `
      <div class="panel">
        <div class="panelTitle">Convolution output (3×3)</div>
        <div id="${uid}_out" style="margin-top:10px"></div>
        <div class="sub" style="margin-top:10px">Try making a vertical edge in the image, then use an edge-detect filter.</div>
      </div>
    `;
    const imgEl = $(uid + "_img");
    const kerEl = $(uid + "_ker");
    const outEl = $(uid + "_out");
    function conv() {
      const out = [];
      for (let y = 0; y < 3; y++) {
        for (let x = 0; x < 3; x++) {
          let s = 0;
          for (let ky = 0; ky < 3; ky++) for (let kx = 0; kx < 3; kx++) {
            const iv = img[(y + ky) * 5 + (x + kx)];
            const kv = ker[ky * 3 + kx];
            s += iv * kv;
          }
          out.push(s);
        }
      }
      return out;
    }
    function render() {
      imgEl.innerHTML = gridHtml(uid + "img", img, 5, true);
      kerEl.innerHTML = gridHtml(uid + "ker", ker, 3, true);
      const out = conv();
      outEl.innerHTML = gridHtml(uid + "out", out, 3, false);
      imgEl.querySelectorAll("[data-c]").forEach(n => n.addEventListener("click", () => {
        const i = parseInt(n.dataset.c.split("_").pop(), 10);
        img[i] = img[i] ? 0 : 1;
        render();
      }));
      kerEl.querySelectorAll("[data-c]").forEach(n => n.addEventListener("click", () => {
        const i = parseInt(n.dataset.c.split("_").pop(), 10);
        ker[i] = ker[i] === -1 ? 0 : ker[i] === 0 ? 1 : -1;
        render();
      }));
    }
    render();
  },

  rnn_4: (mount) => {
    const uid = `rnn_${Math.random().toString(36).slice(2, 8)}`;
    const st = { wIn: 0.9, wState: 0.7, steps: 6 };
    mount.controls.innerHTML = `
      <div class="labCard">
        <div class="labCardTitle">RNN state update</div>
        <div class="labRow"><label>w_in</label><input id="${uid}_wi" type="range" min="-1.5" max="1.5" step="0.05" value="${st.wIn}"><span id="${uid}_vwi" class="labMono">${st.wIn.toFixed(2)}</span></div>
        <div class="labRow"><label>w_state</label><input id="${uid}_ws" type="range" min="-1.5" max="1.5" step="0.05" value="${st.wState}"><span id="${uid}_vws" class="labMono">${st.wState.toFixed(2)}</span></div>
        <div class="labRow"><label>length</label><input id="${uid}_len" type="range" min="3" max="12" step="1" value="${st.steps}"><span id="${uid}_vlen" class="labMono">${st.steps}</span></div>
        <div class="sub">State: \(h_t=\\tanh(w_{in}x_t+w_{state}h_{t-1})\\).</div>
      </div>
      <div class="labCard"><div class="labCardTitle">Sequence</div><div id="${uid}_seq" class="sub labMono"></div></div>
    `;
    mount.viz.innerHTML = `<div class="panel"><div class="panelTitle">State over time</div><div id="${uid}_bars" style="margin-top:10px"></div></div>`;
    const seqEl = $(uid + "_seq");
    const bars = $(uid + "_bars");
    let xs = [];
    function regen() { xs = Array.from({ length: st.steps }, () => (Math.random() * 2 - 1)); }
    function compute() {
      const hs = [];
      let h = 0;
      xs.forEach(x => { h = Math.tanh(st.wIn * x + st.wState * h); hs.push(h); });
      return hs;
    }
    function render() {
      seqEl.textContent = `x: [${xs.map(v => v.toFixed(2)).join(", ")}]`;
      const hs = compute();
      bars.innerHTML = hs.map((h, i) => {
        const w = Math.round(Math.abs(h) * 100);
        const col = h >= 0 ? "linear-gradient(90deg, var(--teal), var(--coral))" : "linear-gradient(90deg, rgba(255,107,107,.65), rgba(224,122,95,.35))";
        return `<div class="sub" style="display:flex;align-items:center;gap:10px;margin:6px 0">
          <span class="labMono" style="width:54px">t=${i + 1}</span>
          <div style="flex:1;height:12px;border-radius:999px;background:rgba(0,0,0,.06);overflow:hidden;box-shadow:var(--neo-sm-in)">
            <div style="width:${w}%;height:100%;background:${col}"></div>
          </div>
          <span class="labMono" style="width:56px;text-align:right">${h.toFixed(2)}</span>
        </div>`;
      }).join("");
    }
    function bind(id, key, vId, fmt) {
      const el = $(id), v = $(vId);
      el.addEventListener("input", () => { st[key] = key === "steps" ? parseInt(el.value, 10) : parseFloat(el.value); v.textContent = fmt(st[key]); regen(); render(); });
    }
    bind(uid + "_wi", "wIn", uid + "_vwi", (x) => x.toFixed(2));
    bind(uid + "_ws", "wState", uid + "_vws", (x) => x.toFixed(2));
    bind(uid + "_len", "steps", uid + "_vlen", (x) => String(x));
    regen(); render();
  },

  nlp_4: (mount) => {
    const uid = `nlp_${Math.random().toString(36).slice(2, 8)}`;
    mount.controls.innerHTML = `
      <div class="labCard">
        <div class="labCardTitle">Tokenize text</div>
        <div class="sub">Type a sentence. We’ll tokenize + show bag-of-words counts.</div>
        <input id="${uid}_in" type="text" value="I love AI and I love visuals" style="width:100%;padding:10px 12px;border-radius:12px;border:none;box-shadow:var(--neo-sm-in);background:var(--canvas);font-family:var(--sans)" />
      </div>
      <div class="labCard"><div class="labCardTitle">Tokens</div><div id="${uid}_tok"></div></div>
    `;
    mount.viz.innerHTML = `<div class="panel"><div class="panelTitle">Bag-of-words</div><div id="${uid}_bow" style="margin-top:10px"></div></div>`;
    const input = $(uid + "_in");
    const tok = $(uid + "_tok");
    const bow = $(uid + "_bow");
    function tokenize(s) {
      return String(s).toLowerCase().replace(/[^a-z0-9\\s]/g, " ").split(/\\s+/).filter(Boolean);
    }
    function render() {
      const ts = tokenize(input.value);
      tok.innerHTML = ts.map(t => `<span class="vizToken">${esc(t)}</span>`).join("") || `<div class="sub">No tokens.</div>`;
      const counts = {};
      ts.forEach(t => { counts[t] = (counts[t] || 0) + 1; });
      const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
      const max = Math.max(1, ...entries.map(e => e[1]));
      bow.innerHTML = entries.map(([w, c]) => `
        <div class="sub" style="display:flex;align-items:center;gap:10px;margin:6px 0">
          <span class="labMono" style="width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(w)}</span>
          <div style="flex:1;height:12px;border-radius:999px;background:rgba(0,0,0,.06);overflow:hidden;box-shadow:var(--neo-sm-in)">
            <div style="width:${Math.round((c / max) * 100)}%;height:100%;background:linear-gradient(90deg,var(--coral),var(--teal))"></div>
          </div>
          <span class="labMono" style="width:22px;text-align:right">${c}</span>
        </div>
      `).join("") || `<div class="sub">No counts.</div>`;
    }
    input.addEventListener("input", render);
    render();
  },

  rl_4: (mount) => {
    const uid = `rl_${Math.random().toString(36).slice(2, 8)}`;
    const st = { eps: 0.3, pulls: 40 };
    const arms = [0.3, 0.7, 0.5];
    mount.controls.innerHTML = `
      <div class="labCard">
        <div class="labCardTitle">ε-greedy bandit</div>
        <div class="labRow"><label>ε</label><input id="${uid}_e" type="range" min="0" max="1" step="0.05" value="${st.eps}"><span id="${uid}_ve" class="labMono">${st.eps.toFixed(2)}</span></div>
        <div class="labRow"><label>pulls</label><input id="${uid}_p" type="range" min="10" max="120" step="5" value="${st.pulls}"><span id="${uid}_vp" class="labMono">${st.pulls}</span></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
          <button id="${uid}_run" class="btn primary sm" type="button">Simulate</button>
        </div>
        <div class="sub">Arms have true win rates: [0.3, 0.7, 0.5]. ε controls exploration.</div>
      </div>
      <div class="labCard"><div class="labCardTitle">Summary</div><div id="${uid}_sum" class="sub labMono" style="white-space:pre-wrap"></div></div>
    `;
    mount.viz.innerHTML = `<div class="panel"><div class="panelTitle">Pull counts</div><div id="${uid}_bars" style="margin-top:10px"></div></div>`;
    const sum = $(uid + "_sum");
    const bars = $(uid + "_bars");
    function simulate() {
      const q = [0, 0, 0];
      const n = [0, 0, 0];
      let reward = 0;
      for (let t = 0; t < st.pulls; t++) {
        const explore = Math.random() < st.eps;
        let a = 0;
        if (explore) a = Math.floor(Math.random() * 3);
        else {
          a = q.indexOf(Math.max(...q));
        }
        // pull
        const r = Math.random() < arms[a] ? 1 : 0;
        reward += r;
        n[a] += 1;
        q[a] += (r - q[a]) / n[a];
      }
      sum.textContent = `total_reward=${reward}\nq_est=[${q.map(x => x.toFixed(2)).join(", ")}]`;
      const max = Math.max(1, ...n);
      bars.innerHTML = n.map((c, i) => `
        <div class="sub" style="display:flex;align-items:center;gap:10px;margin:8px 0">
          <span class="labMono" style="width:60px">arm ${i + 1}</span>
          <div style="flex:1;height:14px;border-radius:999px;background:rgba(0,0,0,.06);overflow:hidden;box-shadow:var(--neo-sm-in)">
            <div style="width:${Math.round((c / max) * 100)}%;height:100%;background:linear-gradient(90deg,var(--coral),var(--teal))"></div>
          </div>
          <span class="labMono" style="width:36px;text-align:right">${c}</span>
        </div>
      `).join("");
    }
    const eEl = $(uid + "_e"), pEl = $(uid + "_p"), ve = $(uid + "_ve"), vp = $(uid + "_vp");
    eEl.addEventListener("input", () => { st.eps = parseFloat(eEl.value); ve.textContent = st.eps.toFixed(2); });
    pEl.addEventListener("input", () => { st.pulls = parseInt(pEl.value, 10); vp.textContent = st.pulls; });
    $(uid + "_run").addEventListener("click", simulate);
    simulate();
  },
};

function renderLesson(topicId, subtopicId, user) {
  const root = $("v_lesson");
  const topic = TOPICS.find(t => t.id === topicId);
  const sub = topic?.subtopics.find(s => s.id === subtopicId);
  if (!topic || !sub) return;

  const interactive = INTERACTIVE_LESSONS[subtopicId];
  const content = LESSON_CONTENT[subtopicId] || `<div class="concept"><h3>${esc(sub.title)}</h3><p>${esc(sub.desc)}</p><p>This topic covers an important concept in ${esc(topic.title)}. Explore the interactive visualizer and quiz to deepen your understanding.</p></div>`;
  const isDone = !!user.prog.mods[subtopicId];

  root.innerHTML = `
    <button class="btn sm ghost" onclick="openTopic('${topicId}')" style="margin-bottom:12px">← Back to ${esc(topic.title)}</button>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
      <span style="font-size:28px">${topic.icon}</span>
      <div>
        <div class="sub">${esc(topic.title)}</div>
        <h2 style="margin:0">${esc(sub.title)}</h2>
      </div>
    </div>
    <div class="lessonContent">
      ${typeof interactive === "function"
        ? labShell({
            title: sub.title,
            subtitle: topic.title,
            controlsHtml: `<div id="labControls"></div>`,
            vizHtml: `<div id="labViz"></div>`,
            notesHtml: LAB_NOTES[subtopicId] || `<div class="sub"><b>Tip:</b> interact with the controls and watch the visualization update live.</div>`,
          })
        : content}
    </div>
    <div style="margin-top:20px;display:flex;gap:10px;align-items:center">
      ${isDone
        ? '<span class="pill pillGlow">✓ Completed</span>'
        : `<button class="btn primary" id="markDoneBtn">Mark Complete (+25 pts)</button>`}
    </div>
  `;

  if (typeof interactive === "function") {
    try {
      const mount = { controls: $("labControls"), viz: $("labViz"), root };
      interactive(mount, { topicId, subtopicId, topic, sub, user });
    } catch (e) {
      const box = document.createElement("div");
      box.className = "errBox";
      box.textContent = "Interactive lab failed to load. Please refresh.";
      const host = $("labViz");
      if (host) host.prepend(box);
      console.error(e);
    }
  }

  if (!isDone) {
    $("markDoneBtn").addEventListener("click", () => {
      let u = me();
      if (!u) return;
      u.prog = { ...u.prog, mods: { ...u.prog.mods, [subtopicId]: nowISO() } };
      save(u);
      u = addPts(u, 25, `lesson_${subtopicId}`);
      const allTopicDone = topic.subtopics.every(s => me().prog.mods[s.id]);
      if (allTopicDone) {
        addBadge(u, `topic_${topicId}`);
      }
      openTopic(topicId);
    });
  }
}

// ── Section 10: Games Module ────────────────────────────────────
const GAMES = [
  { id: "classifySort", icon: "🎯", title: "Classification Sorter", desc: "Sort falling items into the right category before time runs out!" },
  { id: "nnBuilder", icon: "🔗", title: "Neural Net Builder", desc: "Place neurons and connect them to build your own network." },
  { id: "boundaryDraw", icon: "✏️", title: "Decision Boundary", desc: "Draw a line to separate two classes of points." },
  { id: "gradientRoll", icon: "⛰️", title: "Gradient Descent", desc: "Guide a ball to the lowest point on a bumpy landscape." },
  { id: "clusterMatch", icon: "🎨", title: "Cluster Match", desc: "Place centroids to cluster scattered points." },
];

function renderGames(user) {
  const root = $("v_games");
  root.innerHTML = `
    <h2 style="margin:0 0 4px">Games</h2>
    <p class="sub" style="margin:0 0 16px">Learn AI/ML concepts through play. Earn points for high scores!</p>
    <div class="gamesGrid">
      ${GAMES.map(g => `
        <div class="gameCard" data-gid="${g.id}">
          <div style="font-size:36px;margin-bottom:8px">${g.icon}</div>
          <h3>${esc(g.title)}</h3>
          <div class="sub">${esc(g.desc)}</div>
          <div class="sub" style="margin-top:8px">Best: ${user.prog.games?.[g.id] || 0} pts</div>
        </div>
      `).join("")}
    </div>
  `;
  root.querySelectorAll(".gameCard").forEach(c => {
    c.addEventListener("click", () => startGame(c.dataset.gid));
  });
}

function startGame(gameId) {
  curView = "game";
  document.querySelectorAll(".view").forEach(v => hide(v));
  show($("v_game"));
  document.querySelectorAll(".navBtn").forEach(b => {
    b.classList.toggle("active", b.dataset.r === "games");
  });
  const root = $("v_game");
  root.innerHTML = `
    <button class="btn sm ghost" onclick="goView('games')" style="margin-bottom:10px">← Back to games</button>
    <div id="gameArea"></div>
  `;
  const area = $("gameArea");
  const handlers = { classifySort: gameClassifySort, nnBuilder: gameNNBuilder, boundaryDraw: gameBoundaryDraw, gradientRoll: gameGradientRoll, clusterMatch: gameClusterMatch };
  if (handlers[gameId]) handlers[gameId](area);
}

function gameClassifySort(area) {
  area.innerHTML = `
    <h3>Classification Sorter</h3>
    <div class="sub" style="margin-bottom:10px">Press LEFT arrow for Category A, RIGHT for Category B. Sort the falling items!</div>
    <div class="gameHud"><span id="csScore">Score: 0</span> | <span id="csTime">Time: 30</span></div>
    <canvas id="csCanvas" width="600" height="400" style="background:rgba(30,30,48,.9);border-radius:12px;display:block;max-width:100%"></canvas>
  `;
  const canvas = $("csCanvas");
  const ctx = canvas.getContext("2d");
  const W = 600, H = 400;
  let score = 0, timeLeft = 30, running = true;
  const ITEMS_DATA = [
    { text: "4 legs, fur", cat: "A", label: "Animal" },
    { text: "4 wheels, metal", cat: "B", label: "Vehicle" },
    { text: "Barks, tail", cat: "A", label: "Animal" },
    { text: "Engine, seats", cat: "B", label: "Vehicle" },
    { text: "Wings, feathers", cat: "A", label: "Animal" },
    { text: "Pedals, chain", cat: "B", label: "Vehicle" },
    { text: "Scales, gills", cat: "A", label: "Animal" },
    { text: "Propeller, wings", cat: "B", label: "Vehicle" },
    { text: "Whiskers, purrs", cat: "A", label: "Animal" },
    { text: "Sails, hull", cat: "B", label: "Vehicle" },
    { text: "Hooves, mane", cat: "A", label: "Animal" },
    { text: "Tracks, steam", cat: "B", label: "Vehicle" },
  ];
  let items = [];
  let spawnTimer = 0;

  function spawnItem() {
    const d = ITEMS_DATA[Math.floor(Math.random() * ITEMS_DATA.length)];
    items.push({ ...d, x: 100 + Math.random() * 400, y: -30, speed: 1 + Math.random() * 1.5 });
  }

  const timer = setInterval(() => {
    if (!running) return;
    timeLeft--;
    $("csTime").textContent = `Time: ${timeLeft}`;
    if (timeLeft <= 0) {
      running = false;
      clearInterval(timer);
      ctx.fillStyle = "rgba(0,0,0,.7)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#fff"; ctx.font = "bold 28px var(--sans)"; ctx.textAlign = "center";
      ctx.fillText(`Game Over! Score: ${score}`, W / 2, H / 2);
      let u = me();
      if (u) {
        u = addPts(u, Math.max(5, score * 2), "game_classifySort");
        u.prog = { ...u.prog, games: { ...u.prog.games, classifySort: Math.max(u.prog.games?.classifySort || 0, score) } };
        save(u);
      }
    }
  }, 1000);

  function sortItem(dir) {
    if (!running || items.length === 0) return;
    const lowest = items.reduce((a, b) => a.y > b.y ? a : b);
    const chosen = dir === "left" ? "A" : "B";
    if (chosen === lowest.cat) { score += 10; } else { score = Math.max(0, score - 5); }
    items = items.filter(i => i !== lowest);
    $("csScore").textContent = `Score: ${score}`;
  }

  document.addEventListener("keydown", function handler(e) {
    if (!running) { document.removeEventListener("keydown", handler); return; }
    if (e.key === "ArrowLeft") sortItem("left");
    if (e.key === "ArrowRight") sortItem("right");
  });

  canvas.addEventListener("click", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    if (mx < W / 2) sortItem("left"); else sortItem("right");
  });

  let raf;
  function loop() {
    if (!running) return;
    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = "rgba(107,255,184,.15)"; ctx.fillRect(0, H - 60, W / 2, 60);
    ctx.fillStyle = "rgba(255,107,107,.15)"; ctx.fillRect(W / 2, H - 60, W / 2, 60);
    ctx.fillStyle = "rgba(107,255,184,.8)"; ctx.font = "bold 16px var(--sans)"; ctx.textAlign = "center";
    ctx.fillText("← A: Animal", W / 4, H - 25);
    ctx.fillStyle = "rgba(255,107,107,.8)";
    ctx.fillText("B: Vehicle →", 3 * W / 4, H - 25);

    spawnTimer++;
    if (spawnTimer > 60) { spawnItem(); spawnTimer = 0; }

    items.forEach(it => {
      it.y += it.speed;
      ctx.fillStyle = "rgba(224,122,95,.2)";
      ctx.beginPath(); ctx.roundRect(it.x - 70, it.y - 18, 140, 36, 8); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.15)"; ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.font = "13px var(--sans)"; ctx.textAlign = "center";
      ctx.fillText(it.text, it.x, it.y + 5);
    });

    items = items.filter(i => {
      if (i.y > H - 60) { score = Math.max(0, score - 3); $("csScore").textContent = `Score: ${score}`; return false; }
      return true;
    });

    raf = requestAnimationFrame(loop);
  }
  loop();

  const obs = new MutationObserver(() => {
    if ($("v_game").classList.contains("hidden")) { cancelAnimationFrame(raf); clearInterval(timer); running = false; obs.disconnect(); }
  });
  obs.observe($("v_game"), { attributes: true, attributeFilter: ["class"] });
}

function gameNNBuilder(area) {
  area.innerHTML = `
    <h3>Neural Net Builder</h3>
    <div class="sub" style="margin-bottom:10px">Click to place neurons. Click two neurons to connect them. Build 3+ layers, then click Run!</div>
    <div class="gameHud"><span id="nnbScore">Neurons: 0 | Connections: 0</span></div>
    <canvas id="nnbCanvas" width="600" height="400" style="background:rgba(30,30,48,.9);border-radius:12px;display:block;max-width:100%"></canvas>
    <div style="margin-top:10px;display:flex;gap:8px">
      <button id="nnbRun" class="btn primary sm">Run Network</button>
      <button id="nnbClear" class="btn ghost sm">Clear</button>
    </div>
    <div id="nnbInfo" class="sub" style="margin-top:8px"></div>
  `;
  const canvas = $("nnbCanvas");
  const ctx = canvas.getContext("2d");
  const W = 600, H = 400;
  let neurons = [], connections = [], selected = null, particles = [], animating = false;

  function draw() {
    ctx.clearRect(0, 0, W, H);
    connections.forEach(c => {
      ctx.beginPath(); ctx.moveTo(c.from.x, c.from.y); ctx.lineTo(c.to.x, c.to.y);
      ctx.strokeStyle = "rgba(224,122,95,.4)"; ctx.lineWidth = 2; ctx.stroke();
    });
    particles.forEach(p => {
      ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(107,255,184,${1 - p.t})`; ctx.fill();
    });
    neurons.forEach((n, i) => {
      ctx.beginPath(); ctx.arc(n.x, n.y, 18, 0, Math.PI * 2);
      ctx.fillStyle = n === selected ? "rgba(107,255,184,.3)" : "rgba(224,122,95,.2)";
      ctx.fill();
      ctx.strokeStyle = n === selected ? "rgba(107,255,184,.6)" : "rgba(255,255,255,.15)";
      ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.font = "bold 11px var(--sans)"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(i + 1, n.x, n.y);
      ctx.textBaseline = "alphabetic";
    });
    $("nnbScore").textContent = `Neurons: ${neurons.length} | Connections: ${connections.length}`;
  }

  canvas.addEventListener("click", (e) => {
    if (animating) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (W / rect.width);
    const my = (e.clientY - rect.top) * (H / rect.height);
    const hit = neurons.find(n => Math.hypot(n.x - mx, n.y - my) < 20);
    if (hit) {
      if (selected && selected !== hit) {
        if (!connections.find(c => (c.from === selected && c.to === hit) || (c.from === hit && c.to === selected))) {
          connections.push({ from: selected, to: hit });
        }
        selected = null;
      } else {
        selected = selected === hit ? null : hit;
      }
    } else {
      neurons.push({ x: mx, y: my });
      selected = null;
    }
    draw();
  });

  $("nnbRun").addEventListener("click", () => {
    if (neurons.length < 3 || connections.length < 2) {
      $("nnbInfo").textContent = "Need at least 3 neurons and 2 connections!";
      return;
    }
    animating = true;
    particles = [];
    connections.forEach(c => {
      for (let i = 0; i < 3; i++) {
        particles.push({ from: c.from, to: c.to, t: -i * 0.15, x: c.from.x, y: c.from.y });
      }
    });
    let frame = 0;
    function animate() {
      frame++;
      particles.forEach(p => {
        p.t += 0.015;
        if (p.t < 0) return;
        const ct = clamp(p.t, 0, 1);
        p.x = lerp(p.from.x, p.to.x, ct);
        p.y = lerp(p.from.y, p.to.y, ct);
      });
      particles = particles.filter(p => p.t < 1.1);
      draw();
      if (particles.length > 0 && frame < 300) requestAnimationFrame(animate);
      else {
        animating = false;
        const sc = neurons.length * connections.length;
        $("nnbInfo").textContent = `Network score: ${sc} (${neurons.length} neurons × ${connections.length} connections)`;
        let u = me();
        if (u) {
          u = addPts(u, Math.min(50, sc), "game_nnBuilder");
          u.prog = { ...u.prog, games: { ...u.prog.games, nnBuilder: Math.max(u.prog.games?.nnBuilder || 0, sc) } };
          save(u);
        }
        draw();
      }
    }
    animate();
  });

  $("nnbClear").addEventListener("click", () => { neurons = []; connections = []; selected = null; particles = []; animating = false; draw(); });
  draw();
}

function gameBoundaryDraw(area) {
  area.innerHTML = `
    <h3>Decision Boundary</h3>
    <div class="sub" style="margin-bottom:10px">Click two points to draw a line separating the red and blue dots. Best of 5 rounds!</div>
    <div class="gameHud"><span id="bdScore">Round: 1/5 | Best: 0%</span></div>
    <canvas id="bdCanvas" width="600" height="400" style="background:rgba(30,30,48,.9);border-radius:12px;display:block;max-width:100%"></canvas>
    <div style="margin-top:10px"><button id="bdNext" class="btn primary sm">Next Round</button></div>
    <div id="bdInfo" class="sub" style="margin-top:8px"></div>
  `;
  const canvas = $("bdCanvas");
  const ctx = canvas.getContext("2d");
  const W = 600, H = 400;
  let points = [], lineP1 = null, lineP2 = null, round = 1, bestAcc = 0, scores = [];

  function genPoints() {
    points = [];
    const cx1 = 150 + Math.random() * 100, cy1 = 100 + Math.random() * 100;
    const cx2 = 350 + Math.random() * 100, cy2 = 200 + Math.random() * 100;
    for (let i = 0; i < 25; i++) {
      points.push({ x: cx1 + (Math.random() - 0.5) * 140, y: cy1 + (Math.random() - 0.5) * 140, cls: 0 });
      points.push({ x: cx2 + (Math.random() - 0.5) * 140, y: cy2 + (Math.random() - 0.5) * 140, cls: 1 });
    }
    lineP1 = null; lineP2 = null;
  }

  function scoreAccuracy() {
    if (!lineP1 || !lineP2) return 0;
    const dx = lineP2.x - lineP1.x, dy = lineP2.y - lineP1.y;
    let correct = 0;
    points.forEach(p => {
      const side = (dx * (p.y - lineP1.y) - dy * (p.x - lineP1.x)) > 0 ? 0 : 1;
      if (side === p.cls) correct++;
    });
    return Math.round((correct / points.length) * 100);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    points.forEach(p => {
      ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = p.cls === 0 ? "rgba(100,150,255,.8)" : "rgba(255,100,100,.8)";
      ctx.fill();
    });
    if (lineP1 && lineP2) {
      const dx = lineP2.x - lineP1.x, dy = lineP2.y - lineP1.y;
      const len = Math.hypot(dx, dy) || 1;
      const ex = dx / len, ey = dy / len;
      ctx.beginPath();
      ctx.moveTo(lineP1.x - ex * 1000, lineP1.y - ey * 1000);
      ctx.lineTo(lineP2.x + ex * 1000, lineP2.y + ey * 1000);
      ctx.strokeStyle = "rgba(255,215,0,.7)"; ctx.lineWidth = 2; ctx.stroke();
    }
    if (lineP1 && !lineP2) {
      ctx.beginPath(); ctx.arc(lineP1.x, lineP1.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,215,0,.8)"; ctx.fill();
    }
  }

  canvas.addEventListener("click", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (W / rect.width);
    const my = (e.clientY - rect.top) * (H / rect.height);
    if (!lineP1) { lineP1 = { x: mx, y: my }; }
    else if (!lineP2) {
      lineP2 = { x: mx, y: my };
      const acc = scoreAccuracy();
      bestAcc = Math.max(bestAcc, acc);
      scores.push(acc);
      $("bdInfo").textContent = `Accuracy: ${acc}% (${acc >= 80 ? "Great!" : acc >= 60 ? "Good" : "Try again"})`;
      $("bdScore").textContent = `Round: ${round}/5 | Best: ${bestAcc}%`;
    }
    draw();
  });

  $("bdNext").addEventListener("click", () => {
    if (round >= 5) {
      const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
      $("bdInfo").textContent = `Game over! Average: ${avg}%, Best: ${bestAcc}%`;
      let u = me();
      if (u) {
        u = addPts(u, Math.max(5, Math.floor(bestAcc / 5)), "game_boundaryDraw");
        u.prog = { ...u.prog, games: { ...u.prog.games, boundaryDraw: Math.max(u.prog.games?.boundaryDraw || 0, bestAcc) } };
        save(u);
      }
      return;
    }
    round++;
    genPoints();
    draw();
    $("bdScore").textContent = `Round: ${round}/5 | Best: ${bestAcc}%`;
    $("bdInfo").textContent = "";
  });

  genPoints(); draw();
}

function gameGradientRoll(area) {
  area.innerHTML = `
    <h3>Gradient Descent Ball</h3>
    <div class="sub" style="margin-bottom:10px">Use LEFT/RIGHT arrow keys (or tap left/right side) to guide the ball to the global minimum!</div>
    <div class="gameHud"><span id="grScore">Round: 1/3 | Score: 0</span></div>
    <canvas id="grCanvas" width="600" height="400" style="background:rgba(30,30,48,.9);border-radius:12px;display:block;max-width:100%"></canvas>
    <div style="margin-top:10px"><button id="grSubmit" class="btn primary sm">Submit Position</button></div>
    <div id="grInfo" class="sub" style="margin-top:8px">Find the lowest point!</div>
  `;
  const canvas = $("grCanvas");
  const ctx = canvas.getContext("2d");
  const W = 600, H = 400;
  let round = 1, totalScore = 0, ballX = 0.5, velocity = 0;
  let landscape, globalMin;

  function genLandscape() {
    const a = 1 + Math.random() * 2;
    const b = 2 + Math.random() * 3;
    const c = Math.random() * 0.5;
    const d = 0.3 + Math.random() * 0.4;
    landscape = (x) => 0.3 * Math.sin(a * x * Math.PI) + 0.2 * Math.cos(b * x * Math.PI) + c * (x - d) * (x - d);
    let minVal = Infinity, minX = 0;
    for (let x = 0; x <= 1; x += 0.001) {
      const v = landscape(x);
      if (v < minVal) { minVal = v; minX = x; }
    }
    globalMin = minX;
    ballX = Math.random();
    velocity = 0;
  }

  function toScreen(x) {
    const sx = x * W;
    const sy = H * 0.3 + landscape(x) * H * 0.5;
    return { x: sx, y: sy };
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let px = 0; px <= W; px++) {
      const x = px / W;
      const p = toScreen(x);
      ctx.lineTo(p.x, p.y);
    }
    ctx.lineTo(W, H); ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "rgba(107,158,158,.3)");
    grad.addColorStop(1, "rgba(30,30,48,.9)");
    ctx.fillStyle = grad; ctx.fill();

    ctx.beginPath();
    for (let px = 0; px <= W; px++) {
      const p = toScreen(px / W);
      if (px === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = "rgba(224,122,95,.7)"; ctx.lineWidth = 2; ctx.stroke();

    const gm = toScreen(globalMin);
    ctx.beginPath(); ctx.arc(gm.x, gm.y - 5, 6, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(107,255,184,.4)"; ctx.fill();
    ctx.fillStyle = "rgba(107,255,184,.7)"; ctx.font = "10px var(--sans)"; ctx.textAlign = "center";
    ctx.fillText("min", gm.x, gm.y - 16);

    const bp = toScreen(ballX);
    ctx.beginPath(); ctx.arc(bp.x, bp.y - 10, 10, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,215,0,.8)"; ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.3)"; ctx.lineWidth = 1.5; ctx.stroke();
  }

  let keys = {};
  function keyHandler(e) { keys[e.key] = e.type === "keydown"; }
  document.addEventListener("keydown", keyHandler);
  document.addEventListener("keyup", keyHandler);

  canvas.addEventListener("click", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    if (mx < W / 2) velocity -= 0.008; else velocity += 0.008;
  });

  let raf;
  function loop() {
    if (keys["ArrowLeft"]) velocity -= 0.003;
    if (keys["ArrowRight"]) velocity += 0.003;
    velocity *= 0.97;
    ballX = clamp(ballX + velocity, 0.01, 0.99);
    const slope = (landscape(ballX + 0.01) - landscape(ballX - 0.01)) / 0.02;
    velocity -= slope * 0.0005;
    draw();
    raf = requestAnimationFrame(loop);
  }
  genLandscape(); loop();

  $("grSubmit").addEventListener("click", () => {
    const dist = Math.abs(ballX - globalMin);
    const roundScore = Math.max(0, Math.round((1 - dist * 5) * 100));
    totalScore += roundScore;
    $("grInfo").textContent = `Distance from min: ${(dist * 100).toFixed(1)}% → +${roundScore} points`;
    $("grScore").textContent = `Round: ${round}/3 | Score: ${totalScore}`;

    if (round >= 3) {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", keyHandler);
      document.removeEventListener("keyup", keyHandler);
      $("grInfo").textContent += ` | Final score: ${totalScore}!`;
      let u = me();
      if (u) {
        u = addPts(u, Math.max(5, Math.floor(totalScore / 10)), "game_gradientRoll");
        u.prog = { ...u.prog, games: { ...u.prog.games, gradientRoll: Math.max(u.prog.games?.gradientRoll || 0, totalScore) } };
        save(u);
      }
    } else {
      round++;
      genLandscape();
    }
  });

  const obs = new MutationObserver(() => {
    if ($("v_game").classList.contains("hidden")) { cancelAnimationFrame(raf); document.removeEventListener("keydown", keyHandler); document.removeEventListener("keyup", keyHandler); obs.disconnect(); }
  });
  obs.observe($("v_game"), { attributes: true, attributeFilter: ["class"] });
}

function gameClusterMatch(area) {
  area.innerHTML = `
    <h3>Cluster Match</h3>
    <div class="sub" style="margin-bottom:10px">Click to place 3 centroids. Points will snap to the nearest one. Drag to adjust. Click Submit when happy!</div>
    <div class="gameHud"><span id="cmScore">Centroids: 0/3</span></div>
    <canvas id="cmCanvas" width="600" height="400" style="background:rgba(30,30,48,.9);border-radius:12px;display:block;max-width:100%"></canvas>
    <div style="margin-top:10px;display:flex;gap:8px">
      <button id="cmSubmit" class="btn primary sm">Submit</button>
      <button id="cmReset" class="btn ghost sm">Reset Centroids</button>
    </div>
    <div id="cmInfo" class="sub" style="margin-top:8px"></div>
  `;
  const canvas = $("cmCanvas");
  const ctx = canvas.getContext("2d");
  const W = 600, H = 400;
  const COLORS = ["rgba(100,150,255,.8)", "rgba(255,100,100,.8)", "rgba(100,255,150,.8)"];
  const CENTROID_COLORS = ["rgba(100,150,255,1)", "rgba(255,100,100,1)", "rgba(100,255,150,1)"];
  let points = [], centroids = [], dragging = null;

  function genPoints() {
    points = [];
    const centers = [
      { x: 100 + Math.random() * 150, y: 80 + Math.random() * 120 },
      { x: 350 + Math.random() * 150, y: 80 + Math.random() * 120 },
      { x: 200 + Math.random() * 200, y: 250 + Math.random() * 100 },
    ];
    centers.forEach((c, ci) => {
      for (let i = 0; i < 20; i++) {
        points.push({ x: c.x + (Math.random() - 0.5) * 120, y: c.y + (Math.random() - 0.5) * 120, trueCluster: ci, assigned: -1 });
      }
    });
  }

  function assignPoints() {
    if (centroids.length === 0) { points.forEach(p => p.assigned = -1); return; }
    points.forEach(p => {
      let minD = Infinity, minI = 0;
      centroids.forEach((c, i) => {
        const d = Math.hypot(p.x - c.x, p.y - c.y);
        if (d < minD) { minD = d; minI = i; }
      });
      p.assigned = minI;
    });
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    points.forEach(p => {
      ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = p.assigned >= 0 ? COLORS[p.assigned] : "rgba(200,200,200,.5)";
      ctx.fill();
    });
    centroids.forEach((c, i) => {
      ctx.beginPath(); ctx.arc(c.x, c.y, 12, 0, Math.PI * 2);
      ctx.fillStyle = CENTROID_COLORS[i]; ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.font = "bold 10px var(--sans)"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("C" + (i + 1), c.x, c.y);
      ctx.textBaseline = "alphabetic";
    });
    $("cmScore").textContent = `Centroids: ${centroids.length}/3`;
  }

  canvas.addEventListener("mousedown", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (W / rect.width);
    const my = (e.clientY - rect.top) * (H / rect.height);
    const hit = centroids.findIndex(c => Math.hypot(c.x - mx, c.y - my) < 16);
    if (hit >= 0) { dragging = hit; return; }
    if (centroids.length < 3) {
      centroids.push({ x: mx, y: my });
      assignPoints(); draw();
    }
  });

  canvas.addEventListener("mousemove", (e) => {
    if (dragging === null) return;
    const rect = canvas.getBoundingClientRect();
    centroids[dragging].x = (e.clientX - rect.left) * (W / rect.width);
    centroids[dragging].y = (e.clientY - rect.top) * (H / rect.height);
    assignPoints(); draw();
  });

  canvas.addEventListener("mouseup", () => { dragging = null; });

  $("cmSubmit").addEventListener("click", () => {
    if (centroids.length < 3) { $("cmInfo").textContent = "Place all 3 centroids first!"; return; }
    let totalDist = 0;
    centroids.forEach((c, i) => {
      const cluster = points.filter(p => p.assigned === i);
      cluster.forEach(p => { totalDist += Math.hypot(p.x - c.x, p.y - c.y); });
    });
    const avgDist = totalDist / points.length;
    const score = Math.max(0, Math.round(100 - avgDist));
    $("cmInfo").textContent = `Tightness score: ${score}/100 (avg distance: ${avgDist.toFixed(1)}px)`;
    let u = me();
    if (u) {
      u = addPts(u, Math.max(5, Math.floor(score / 5)), "game_clusterMatch");
      u.prog = { ...u.prog, games: { ...u.prog.games, clusterMatch: Math.max(u.prog.games?.clusterMatch || 0, score) } };
      save(u);
    }
  });

  $("cmReset").addEventListener("click", () => { centroids = []; assignPoints(); draw(); $("cmInfo").textContent = ""; });

  genPoints(); draw();
}

// ── Section 11: Existing Visualizers ────────────────────────────
function renderPerceptron(user) {
  const root = $("v_perceptron");
  const state = { x1:0.6, x2:0.4, w1:0.7, w2:-0.3, bias:-0.2, lr:0.1, step:0 };
  root.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <button class="btn sm ghost" onclick="openTopic('perceptron')">← Back to topic</button>
      <h2 style="margin:0">Perceptron — Interactive Visualizer</h2>
    </div>
    <p class="sub">Drag the sliders to change inputs & weights. Hover any part of the diagram to learn what it does.</p>
    <div class="g2" style="margin-top:12px">
      <div><canvas id="pcCanvas" class="vizCanvas" width="560" height="400"></canvas></div>
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
  canvas.width = 560 * dpr; canvas.height = 400 * dpr; ctx.scale(dpr, dpr);
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
      { label: "x₁", val: x1, x: 80, y: 130, tip: "<b>Input x₁</b><br>A feature value fed into the perceptron." },
      { label: "x₂", val: x2, x: 80, y: 270, tip: "<b>Input x₂</b><br>Another feature input." },
    ];
    const sumNode = { label: "Σ", x: 280, y: 200, tip: "<b>Weighted Sum (Σ)</b><br>z = x₁·w₁ + x₂·w₂ + bias = " + z.toFixed(3) };
    const actNode = { label: "σ", x: 400, y: 200, tip: `<b>Activation (σ)</b><br>σ(z) = ${out.toFixed(4)}` };
    const outNode = { label: activated ? "1" : "0", x: 500, y: 200, tip: `<b>Output</b><br>${out.toFixed(4)} → ${activated ? "Class 1" : "Class 0"}` };

    function drawEdge(x1e, y1e, x2e, y2e, label, intensity, tipHtml) {
      const alpha = 0.15 + Math.abs(intensity) * 0.7;
      const color = intensity >= 0 ? `rgba(224,122,95,${alpha})` : `rgba(255,107,107,${alpha})`;
      ctx.beginPath(); ctx.moveTo(x1e, y1e); ctx.lineTo(x2e, y2e);
      ctx.strokeStyle = color; ctx.lineWidth = 1.5 + Math.abs(intensity) * 3; ctx.stroke();
      const mx = (x1e + x2e) / 2, my = (y1e + y2e) / 2 - 10;
      ctx.fillStyle = "rgba(200,195,185,.8)"; ctx.font = "bold 11px var(--mono)"; ctx.textAlign = "center"; ctx.fillText(label, mx, my);
      regions.push({ x: mx - 30, y: my - 14, w: 60, h: 24, tip: tipHtml });
    }
    drawEdge(inputNodes[0].x + nodeR, inputNodes[0].y, sumNode.x - nodeR, sumNode.y, `w₁=${w1.toFixed(2)}`, w1, `<b>Weight w₁</b><br>Multiplied with x₁.`);
    drawEdge(inputNodes[1].x + nodeR, inputNodes[1].y, sumNode.x - nodeR, sumNode.y, `w₂=${w2.toFixed(2)}`, w2, `<b>Weight w₂</b><br>Multiplied with x₂.`);
    drawEdge(sumNode.x + nodeR, sumNode.y, actNode.x - nodeR, actNode.y, `z=${z.toFixed(2)}`, clamp(z / 3, -1, 1), `<b>z</b> = ${z.toFixed(4)}`);
    drawEdge(actNode.x + nodeR, actNode.y, outNode.x - nodeR, outNode.y, `${out.toFixed(2)}`, out, `<b>σ(z)</b> = ${out.toFixed(4)}`);

    ctx.font = "10px var(--mono)"; ctx.fillStyle = "rgba(200,195,185,.5)"; ctx.textAlign = "center";
    ctx.fillText(`bias=${bias.toFixed(2)}`, sumNode.x, sumNode.y + nodeR + 18);
    regions.push({ x: sumNode.x - 30, y: sumNode.y + nodeR + 6, w: 60, h: 18, tip: "<b>Bias</b><br>Shifts the decision boundary." });

    function drawNode(n, fillColor) {
      ctx.beginPath(); ctx.arc(n.x, n.y, nodeR, 0, Math.PI * 2);
      ctx.fillStyle = fillColor; ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.15)"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.font = "bold 16px var(--sans)"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(n.label, n.x, n.y);
      if (n.val !== undefined) { ctx.font = "11px var(--mono)"; ctx.fillStyle = "rgba(200,195,185,.7)"; ctx.fillText(n.val.toFixed(2), n.x, n.y - nodeR - 8); }
      ctx.textBaseline = "alphabetic";
      regions.push({ x: n.x - nodeR, y: n.y - nodeR, w: nodeR * 2, h: nodeR * 2, tip: n.tip });
    }
    inputNodes.forEach(n => drawNode(n, "rgba(224,122,95,.18)"));
    drawNode(sumNode, "rgba(107,158,158,.18)");
    drawNode(actNode, "rgba(107,158,158,.25)");
    drawNode(outNode, activated ? "rgba(107,255,184,.25)" : "rgba(255,107,107,.18)");

    const pulse = (Date.now() % 1500) / 1500;
    const pr = nodeR + pulse * 14;
    ctx.beginPath(); ctx.arc(outNode.x, outNode.y, pr, 0, Math.PI * 2);
    ctx.strokeStyle = activated ? `rgba(107,255,184,${0.4 - pulse * 0.4})` : `rgba(255,107,107,${0.3 - pulse * 0.3})`;
    ctx.lineWidth = 2; ctx.stroke();

    const t = (Date.now() % 2000) / 2000;
    function particle(ax, ay, bx, by) {
      const px = lerp(ax, bx, t), py = lerp(ay, by, t);
      ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(224,122,95,${0.7 - t * 0.5})`; ctx.fill();
    }
    particle(inputNodes[0].x + nodeR, inputNodes[0].y, sumNode.x - nodeR, sumNode.y);
    particle(inputNodes[1].x + nodeR, inputNodes[1].y, sumNode.x - nodeR, sumNode.y);
    particle(sumNode.x + nodeR, sumNode.y, actNode.x - nodeR, actNode.y);
    particle(actNode.x + nodeR, actNode.y, outNode.x - nodeR, outNode.y);
    $("pcMath").textContent = `z = ${x1.toFixed(2)}·${w1.toFixed(2)} + ${x2.toFixed(2)}·${w2.toFixed(2)} + ${bias.toFixed(2)} = ${z.toFixed(4)}\nσ(z) = ${out.toFixed(4)}\nOutput: ${activated ? "Class 1 ✓" : "Class 0 ✗"}`;
  }

  ["x1","x2","w1","w2","bias"].forEach(k => {
    $(`sl_${k}`).addEventListener("input", () => { state[k] = parseFloat($(`sl_${k}`).value); $(`v${k}`).textContent = state[k].toFixed(2); });
  });

  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (W / rect.width), my = (e.clientY - rect.top) * (H / rect.height);
    for (const r of regions) { if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) { showTip(e.clientX, e.clientY, r.tip); return; } }
    hideTip();
  });
  canvas.addEventListener("mouseleave", hideTip);

  const stepsData = [
    { label: "1", text: "<b>Step 1 — Inputs:</b> Each input represents a feature fed to the neuron." },
    { label: "2", text: "<b>Step 2 — Weights:</b> Each connection has a weight controlling importance." },
    { label: "3", text: "<b>Step 3 — Weighted sum:</b> z = x₁·w₁ + x₂·w₂ + bias." },
    { label: "4", text: "<b>Step 4 — Activation:</b> σ(z) squashes the value into (0, 1)." },
    { label: "5", text: "<b>Step 5 — Output:</b> If σ(z) > 0.5 → class 1, else class 0." },
  ];
  $("pcSteps").innerHTML = stepsData.map((s, i) => `<div class="stepDot ${i === 0 ? "active" : ""}" data-si="${i}">${s.label}</div>`).join("");
  $("pcStepText").innerHTML = stepsData[0].text;
  $("pcSteps").querySelectorAll(".stepDot").forEach(d => {
    d.addEventListener("click", () => {
      $("pcSteps").querySelectorAll(".stepDot").forEach(x => x.classList.remove("active"));
      d.classList.add("active");
      $("pcStepText").innerHTML = stepsData[parseInt(d.dataset.si)].text;
    });
  });

  let u = me();
  if (u && !u.prog.mods.perceptron_4) {
    u.prog = { ...u.prog, mods: { ...u.prog.mods, perceptron_4: nowISO() } };
    save(u); addPts(u, 50, "module_perceptron");
  }

  let raf;
  function loop() { draw(); raf = requestAnimationFrame(loop); }
  loop();
  const obs = new MutationObserver(() => { if ($("v_perceptron").classList.contains("hidden")) { cancelAnimationFrame(raf); obs.disconnect(); } });
  obs.observe($("v_perceptron"), { attributes: true, attributeFilter: ["class"] });
}

function renderNN(user) {
  const root = $("v_nn");
  root.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <button class="btn sm ghost" onclick="openTopic('nn')">← Back to topic</button>
      <h2 style="margin:0">Neural Network — Forward Pass Visualizer</h2>
    </div>
    <p class="sub">Watch data flow through a 3-layer network. Click Forward Pass to animate.</p>
    <canvas id="nnCanvas" class="vizCanvas" width="700" height="420"></canvas>
    <div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap">
      <button id="nnForward" class="btn primary">Animate forward pass</button>
      <button id="nnRandom" class="btn ghost sm">Randomize weights</button>
    </div>
    <div id="nnInfo" class="panel sub" style="margin-top:10px;font-family:var(--mono);white-space:pre-wrap"></div>
  `;
  const canvas = $("nnCanvas"); const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = 700 * dpr; canvas.height = 420 * dpr; ctx.scale(dpr, dpr);
  const W = 700, H = 420;
  const layers = [3, 4, 4, 2];
  let weights = [];
  let activations = layers.map(n => new Array(n).fill(0));
  activations[0] = [0.8, 0.4, -0.3];
  let animT = -1; const regions = [];

  function initWeights() { weights = []; for (let l = 0; l < layers.length - 1; l++) { const m = []; for (let j = 0; j < layers[l + 1]; j++) { const row = []; for (let i = 0; i < layers[l]; i++) row.push(+(Math.random() * 2 - 1).toFixed(2)); m.push(row); } weights.push(m); } }
  initWeights();
  function forwardPass() { for (let l = 1; l < layers.length; l++) { for (let j = 0; j < layers[l]; j++) { let z = 0; for (let i = 0; i < layers[l - 1]; i++) z += activations[l - 1][i] * weights[l - 1][j][i]; activations[l][j] = 1 / (1 + Math.exp(-z)); } } }
  forwardPass();
  function nodePos(l, j) { return { x: (W / (layers.length + 1)) * (l + 1), y: (H / (layers[l] + 1)) * (j + 1) }; }

  function draw() {
    ctx.clearRect(0, 0, W, H); regions.length = 0; const nr = 18;
    for (let l = 0; l < layers.length - 1; l++) { for (let j = 0; j < layers[l + 1]; j++) { const to = nodePos(l + 1, j); for (let i = 0; i < layers[l]; i++) { const from = nodePos(l, i); const w = weights[l][j][i]; ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.strokeStyle = w >= 0 ? `rgba(224,122,95,${0.1 + Math.abs(w) * 0.5})` : `rgba(255,107,107,${0.1 + Math.abs(w) * 0.5})`; ctx.lineWidth = 0.8 + Math.abs(w) * 2; ctx.stroke(); } } }
    if (animT >= 0 && animT <= 1) { const li = Math.floor(animT * (layers.length - 1)); const lt = (animT * (layers.length - 1)) - li; if (li < layers.length - 1) { for (let j = 0; j < layers[li + 1]; j++) { for (let i = 0; i < layers[li]; i++) { const from = nodePos(li, i), to = nodePos(li + 1, j); ctx.beginPath(); ctx.arc(lerp(from.x, to.x, lt), lerp(from.y, to.y, lt), 3, 0, Math.PI * 2); ctx.fillStyle = `rgba(224,122,95,${0.8 - lt * 0.5})`; ctx.fill(); } } } }
    const layerNames = ["Input", ...Array(layers.length - 2).fill("Hidden"), "Output"];
    for (let l = 0; l < layers.length; l++) { for (let j = 0; j < layers[l]; j++) { const p = nodePos(l, j); const a = activations[l][j]; ctx.beginPath(); ctx.arc(p.x, p.y, nr, 0, Math.PI * 2); ctx.fillStyle = `rgba(224,122,95,${0.1 + Math.abs(a) * 0.5})`; ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,.15)"; ctx.lineWidth = 1; ctx.stroke(); ctx.fillStyle = "#fff"; ctx.font = "bold 11px var(--mono)"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(a.toFixed(2), p.x, p.y); ctx.textBaseline = "alphabetic"; regions.push({ x: p.x - nr, y: p.y - nr, w: nr * 2, h: nr * 2, tip: `<b>${layerNames[l]} [${j}]</b><br>Activation = ${a.toFixed(4)}` }); } ctx.fillStyle = "rgba(200,195,185,.4)"; ctx.font = "11px var(--sans)"; ctx.textAlign = "center"; ctx.fillText(layerNames[l] + ` (${layers[l]})`, nodePos(l, 0).x, 20); }
  }

  function animForward() {
    animT = 0; forwardPass(); const start = performance.now();
    function tick(now) { animT = Math.min(1, (now - start) / 2000); draw(); if (animT < 1) requestAnimationFrame(tick); else { animT = -1; draw(); $("nnInfo").textContent = `Output: [${activations[layers.length-1].map(v=>v.toFixed(4)).join(", ")}]`; } }
    requestAnimationFrame(tick);
  }
  $("nnForward").addEventListener("click", animForward);
  $("nnRandom").addEventListener("click", () => { initWeights(); forwardPass(); draw(); });
  canvas.addEventListener("mousemove", (e) => { const rect = canvas.getBoundingClientRect(); const mx = (e.clientX - rect.left) * (W / rect.width), my = (e.clientY - rect.top) * (H / rect.height); for (const r of regions) { if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) { showTip(e.clientX, e.clientY, r.tip); return; } } hideTip(); });
  canvas.addEventListener("mouseleave", hideTip);
  draw(); $("nnInfo").textContent = `Output: [${activations[layers.length-1].map(v=>v.toFixed(4)).join(", ")}]`;
  let u = me();
  if (u && !u.prog.mods.nn_4) { u.prog = { ...u.prog, mods: { ...u.prog.mods, nn_4: nowISO() } }; save(u); addPts(u, 50, "module_nn"); }
}

function renderDTree(user) {
  const root = $("v_dtree");
  root.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <button class="btn sm ghost" onclick="openTopic('dtree')">← Back to topic</button>
      <h2 style="margin:0">Decision Tree — Step-by-step Builder</h2>
    </div>
    <p class="sub">Click "Grow" to add splits. Watch how the tree classifies data.</p>
    <canvas id="dtCanvas" class="vizCanvas" width="700" height="380"></canvas>
    <div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap">
      <button id="dtGrow" class="btn primary">Grow tree</button>
      <button id="dtReset" class="btn ghost sm">Reset</button>
      <button id="dtClassify" class="btn sm">Classify a sample</button>
    </div>
    <div id="dtInfo" class="panel sub" style="margin-top:10px"></div>
  `;
  const canvas = $("dtCanvas"); const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = 700 * dpr; canvas.height = 380 * dpr; ctx.scale(dpr, dpr);
  const W = 700, H = 380;
  const questions = [ { q: "Age > 30?", feat: "age", thresh: 30 }, { q: "Income > 50k?", feat: "income", thresh: 50 }, { q: "Has degree?", feat: "degree", thresh: 0.5 }, { q: "Experience > 5y?", feat: "exp", thresh: 5 } ];
  let nodes = [{ id: 0, depth: 0, x: 350, y: 50, rule: "Root", leaf: true, label: "?" }];
  let edges = [], growIdx = 0;
  const regions = [];

  function layout() { const byDepth = {}; nodes.forEach(n => { if (!byDepth[n.depth]) byDepth[n.depth] = []; byDepth[n.depth].push(n); }); Object.keys(byDepth).forEach(d => { const arr = byDepth[d]; const gap = W / (arr.length + 1); arr.forEach((n, i) => { n.x = gap * (i + 1); n.y = 50 + parseInt(d) * 90; }); }); }

  function draw() {
    ctx.clearRect(0, 0, W, H); regions.length = 0;
    edges.forEach(e => { const from = nodes.find(n => n.id === e.from), to = nodes.find(n => n.id === e.to); if (!from || !to) return; ctx.beginPath(); ctx.moveTo(from.x, from.y + 22); ctx.lineTo(to.x, to.y - 22); ctx.strokeStyle = e.label === "Yes" ? "rgba(107,255,184,.5)" : "rgba(255,107,107,.4)"; ctx.lineWidth = 2; ctx.stroke(); const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2; ctx.fillStyle = e.label === "Yes" ? "rgba(107,255,184,.8)" : "rgba(255,107,107,.7)"; ctx.font = "bold 11px var(--sans)"; ctx.textAlign = "center"; ctx.fillText(e.label, mx - (e.label === "Yes" ? 16 : -16), my); });
    nodes.forEach(n => { if (n.leaf) { ctx.beginPath(); ctx.roundRect(n.x - 30, n.y - 18, 60, 36, 10); ctx.fillStyle = n.label === "Approve" ? "rgba(107,255,184,.18)" : n.label === "Reject" ? "rgba(255,107,107,.15)" : "rgba(107,158,158,.15)"; ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,.12)"; ctx.lineWidth = 1; ctx.stroke(); ctx.fillStyle = "#fff"; ctx.font = "bold 11px var(--sans)"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(n.label, n.x, n.y); } else { ctx.beginPath(); ctx.arc(n.x, n.y, 22, 0, Math.PI * 2); ctx.fillStyle = "rgba(224,122,95,.15)"; ctx.fill(); ctx.strokeStyle = "rgba(224,122,95,.3)"; ctx.lineWidth = 1.5; ctx.stroke(); ctx.fillStyle = "#fff"; ctx.font = "bold 10px var(--sans)"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(n.rule, n.x, n.y); } ctx.textBaseline = "alphabetic"; regions.push({ x: n.x - 30, y: n.y - 22, w: 60, h: 44, tip: n.leaf ? `<b>Leaf:</b> ${n.label}` : `<b>Split:</b> ${n.rule}` }); });
  }

  function grow() { if (growIdx >= questions.length) return; const leaves = nodes.filter(n => n.leaf); if (leaves.length === 0) return; const target = leaves[0]; const q = questions[growIdx++]; target.leaf = false; target.rule = q.q; const yesId = nodes.length, noId = nodes.length + 1; nodes.push({ id: yesId, depth: target.depth + 1, x: 0, y: 0, rule: "", leaf: true, label: growIdx >= questions.length ? "Approve" : "?" }); nodes.push({ id: noId, depth: target.depth + 1, x: 0, y: 0, rule: "", leaf: true, label: growIdx >= questions.length - 1 ? "Reject" : "?" }); edges.push({ from: target.id, to: yesId, label: "Yes" }); edges.push({ from: target.id, to: noId, label: "No" }); layout(); draw(); $("dtInfo").innerHTML = `Added split: <b>${q.q}</b>`; }

  $("dtGrow").addEventListener("click", grow);
  $("dtReset").addEventListener("click", () => { nodes = [{ id: 0, depth: 0, x: 350, y: 50, rule: "Root", leaf: true, label: "?" }]; edges = []; growIdx = 0; layout(); draw(); $("dtInfo").innerHTML = "Tree reset."; });
  $("dtClassify").addEventListener("click", () => { if (growIdx === 0) { $("dtInfo").innerHTML = "Grow the tree first!"; return; } const sample = { age: Math.round(Math.random() * 50 + 18), income: Math.round(Math.random() * 80 + 20), degree: Math.random() > 0.5, exp: Math.round(Math.random() * 15) }; let path = "Sample: age=" + sample.age + ", income=" + sample.income + "k, degree=" + (sample.degree ? "yes" : "no") + ", exp=" + sample.exp + "y\nPath: "; const vals = [sample.age > 30, sample.income > 50, sample.degree, sample.exp > 5]; let nodeId = 0; for (let i = 0; i < growIdx; i++) { const n = nodes.find(x => x.id === nodeId); if (!n || n.leaf) break; path += n.rule + " → " + (vals[i] ? "Yes" : "No") + " → "; const edge = edges.find(e => e.from === nodeId && e.label === (vals[i] ? "Yes" : "No")); if (edge) nodeId = edge.to; else break; } const final = nodes.find(x => x.id === nodeId); path += (final ? final.label : "?"); $("dtInfo").innerHTML = path; });
  canvas.addEventListener("mousemove", (e) => { const rect = canvas.getBoundingClientRect(); const mx = (e.clientX - rect.left) * (W / rect.width), my = (e.clientY - rect.top) * (H / rect.height); for (const r of regions) { if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) { showTip(e.clientX, e.clientY, r.tip); return; } } hideTip(); });
  canvas.addEventListener("mouseleave", hideTip);
  layout(); draw();
  let u = me();
  if (u && !u.prog.mods.dtree_4) { u.prog = { ...u.prog, mods: { ...u.prog.mods, dtree_4: nowISO() } }; save(u); addPts(u, 50, "module_dtree"); }
}

function renderKNN(user) {
  const root = $("v_knn");
  root.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <button class="btn sm ghost" onclick="openTopic('knn')">← Back to topic</button>
      <h2 style="margin:0">K-Nearest Neighbors — Interactive 2D</h2>
    </div>
    <p class="sub">Left-click for blue, right-click for red. Then click Classify and click canvas.</p>
    <div class="g2" style="margin-top:10px">
      <div><canvas id="knnCanvas" class="vizCanvas" width="500" height="400"></canvas></div>
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
  const canvas = $("knnCanvas"); const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1; canvas.width = 500 * dpr; canvas.height = 400 * dpr; ctx.scale(dpr, dpr);
  const CW = 500, CH = 400;
  let points = [], classifyMode = false, lastQuery = null, lastNeighbors = [];

  function draw() {
    ctx.clearRect(0, 0, CW, CH); ctx.fillStyle = "rgba(42,42,60,.5)"; ctx.fillRect(0, 0, CW, CH);
    if (lastQuery && lastNeighbors.length) { lastNeighbors.forEach(n => { ctx.beginPath(); ctx.moveTo(lastQuery.x, lastQuery.y); ctx.lineTo(n.x, n.y); ctx.strokeStyle = "rgba(107,158,158,.3)"; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([]); }); }
    points.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.fillStyle = p.cls === 0 ? "rgba(224,122,95,.8)" : "rgba(255,107,107,.8)"; ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,.2)"; ctx.lineWidth = 1; ctx.stroke(); });
    if (lastQuery) { ctx.beginPath(); ctx.arc(lastQuery.x, lastQuery.y, 9, 0, Math.PI * 2); ctx.fillStyle = lastQuery.cls === 0 ? "rgba(224,122,95,.5)" : "rgba(255,107,107,.5)"; ctx.fill(); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke(); ctx.fillStyle = "#fff"; ctx.font = "bold 8px var(--sans)"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("?", lastQuery.x, lastQuery.y); ctx.textBaseline = "alphabetic"; }
  }

  function classify(qx, qy) { const k = parseInt($("knnK").value); const dists = points.map(p => ({ ...p, d: Math.hypot(p.x - qx, p.y - qy) })); dists.sort((a, b) => a.d - b.d); const neighbors = dists.slice(0, k); lastNeighbors = neighbors; const votes = [0, 0]; neighbors.forEach(n => votes[n.cls]++); const cls = votes[0] >= votes[1] ? 0 : 1; lastQuery = { x: qx, y: qy, cls }; draw(); $("knnInfo").innerHTML = `K=${k} | Blue ${votes[0]} vs Red ${votes[1]} → <b>${cls === 0 ? "Blue" : "Red"}</b>`; }

  canvas.addEventListener("click", (e) => { const rect = canvas.getBoundingClientRect(); const mx = (e.clientX - rect.left) * (CW / rect.width), my = (e.clientY - rect.top) * (CH / rect.height); if (classifyMode && points.length >= 2) { classify(mx, my); return; } points.push({ x: mx, y: my, cls: 0 }); draw(); });
  canvas.addEventListener("contextmenu", (e) => { e.preventDefault(); const rect = canvas.getBoundingClientRect(); points.push({ x: (e.clientX - rect.left) * (CW / rect.width), y: (e.clientY - rect.top) * (CH / rect.height), cls: 1 }); draw(); });
  $("knnK").addEventListener("input", () => { $("knnKVal").textContent = $("knnK").value; });
  $("knnClassify").addEventListener("click", () => { classifyMode = !classifyMode; $("knnClassify").textContent = classifyMode ? "Place mode" : "Classify mode"; });
  $("knnClear").addEventListener("click", () => { points = []; lastQuery = null; lastNeighbors = []; draw(); });
  draw();
  let u = me();
  if (u && !u.prog.mods.knn_4) { u.prog = { ...u.prog, mods: { ...u.prog.mods, knn_4: nowISO() } }; save(u); addPts(u, 50, "module_knn"); }
}

function renderLinReg(user) {
  const root = $("v_linreg");
  root.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
      <button class="btn sm ghost" onclick="openTopic('linreg')">← Back to topic</button>
      <h2 style="margin:0">Linear Regression — Drag to Fit</h2>
    </div>
    <p class="sub">Click to place data points. The best-fit line updates in real time.</p>
    <div class="g2" style="margin-top:10px">
      <div><canvas id="lrCanvas" class="vizCanvas" width="500" height="400"></canvas></div>
      <div>
        <div id="lrInfo" class="panel sub" style="font-family:var(--mono);white-space:pre-wrap">Click to add points.</div>
        <div style="margin-top:10px"><button id="lrClear" class="btn ghost sm">Clear</button></div>
      </div>
    </div>
  `;
  const canvas = $("lrCanvas"); const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1; canvas.width = 500 * dpr; canvas.height = 400 * dpr; ctx.scale(dpr, dpr);
  const CW = 500, CH = 400;
  let pts = [];

  function fitLine() { if (pts.length < 2) return null; const n = pts.length; let sx = 0, sy = 0, sxy = 0, sx2 = 0; pts.forEach(p => { sx += p.x; sy += p.y; sxy += p.x * p.y; sx2 += p.x * p.x; }); const denom = n * sx2 - sx * sx; if (Math.abs(denom) < 1e-10) return null; const m = (n * sxy - sx * sy) / denom; const b = (sy - m * sx) / n; let mse = 0; pts.forEach(p => { mse += (p.y - (m * p.x + b)) ** 2; }); mse /= n; return { m, b, mse }; }

  function draw() {
    ctx.clearRect(0, 0, CW, CH); ctx.fillStyle = "rgba(42,42,60,.5)"; ctx.fillRect(0, 0, CW, CH);
    const fit = fitLine();
    if (fit) { ctx.beginPath(); ctx.moveTo(0, fit.b); ctx.lineTo(CW, fit.m * CW + fit.b); ctx.strokeStyle = "rgba(224,122,95,.7)"; ctx.lineWidth = 2; ctx.stroke(); pts.forEach(p => { const pred = fit.m * p.x + fit.b; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, pred); ctx.strokeStyle = "rgba(255,107,107,.3)"; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]); }); $("lrInfo").textContent = `y = ${fit.m.toFixed(3)}·x + ${fit.b.toFixed(3)}\nMSE = ${fit.mse.toFixed(2)}\nPoints: ${pts.length}`; }
    pts.forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fillStyle = "rgba(107,158,158,.8)"; ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,.2)"; ctx.lineWidth = 1; ctx.stroke(); });
  }

  canvas.addEventListener("click", (e) => { const rect = canvas.getBoundingClientRect(); pts.push({ x: (e.clientX - rect.left) * (CW / rect.width), y: (e.clientY - rect.top) * (CH / rect.height) }); draw(); });
  $("lrClear").addEventListener("click", () => { pts = []; draw(); $("lrInfo").textContent = "Click to add points."; });
  draw();
  let u = me();
  if (u && !u.prog.mods.linreg_4) { u.prog = { ...u.prog, mods: { ...u.prog.mods, linreg_4: nowISO() } }; save(u); addPts(u, 50, "module_linreg"); }
}

// ── Section 12: Quiz ────────────────────────────────────────────
const QUIZ_QS = [
  { id:"q1", prompt:"A perceptron computes a weighted sum and then applies…", opts:[{id:"a",t:"A random shuffle"},{id:"b",t:"An activation function"},{id:"c",t:"PCA"},{id:"d",t:"Gradient descent"}], ans:"b", why:"The activation function transforms the weighted sum into an output." },
  { id:"q2", prompt:"In KNN, increasing K generally makes the boundary…", opts:[{id:"a",t:"More jagged"},{id:"b",t:"Smoother"},{id:"c",t:"Circular"},{id:"d",t:"Invisible"}], ans:"b", why:"Higher K averages more neighbors, smoothing the decision boundary." },
  { id:"q3", prompt:"A decision tree splits data by choosing the feature that…", opts:[{id:"a",t:"Is alphabetically first"},{id:"b",t:"Best separates the classes"},{id:"c",t:"Has the most missing values"},{id:"d",t:"Was added last"}], ans:"b", why:"Splits maximize information gain (or minimize impurity)." },
  { id:"q4", prompt:"Linear regression minimizes which quantity?", opts:[{id:"a",t:"Sum of absolute values"},{id:"b",t:"Sum of squared errors (MSE)"},{id:"c",t:"Number of data points"},{id:"d",t:"Maximum prediction"}], ans:"b", why:"OLS minimizes mean squared error." },
  { id:"q5", prompt:"In a neural network, a 'hidden layer' is…", opts:[{id:"a",t:"A layer only visible to admins"},{id:"b",t:"A layer between input and output that transforms data"},{id:"c",t:"A layer that stores passwords"},{id:"d",t:"Always the last layer"}], ans:"b", why:"Hidden layers perform intermediate transformations." },
];

function renderQuiz(user) {
  const root = $("v_quiz");
  const prev = user.prog.quiz?.main;

  root.innerHTML = `
    <h2>AI-Powered Quiz</h2>
    <p class="sub">Gemini generates fresh questions every time — tailored to your level.</p>
    <div class="panel" style="margin-top:12px">
      <div class="panelTitle">Pick a topic</div>
      <div class="g3" style="gap:8px;margin-top:8px">
        ${TOPICS.map(t => `<button class="btn ghost sm quizTopic" data-tid="${esc(t.id)}" data-tname="${esc(t.title)}">${esc(t.title)}</button>`).join("")}
        <button class="btn ghost sm quizTopic" data-tid="mixed" data-tname="Mixed AI/ML">Surprise me!</button>
      </div>
    </div>
    <div id="quizArea" style="margin-top:12px"></div>
    ${prev ? `<div class="sub" style="margin-top:10px">Last score: <b>${prev.s}/${prev.total || "?"}</b></div>` : ""}
  `;

  root.querySelectorAll(".quizTopic").forEach(btn => {
    btn.addEventListener("click", async () => {
      const topicName = btn.dataset.tname;
      const quizArea = $("quizArea");
      quizArea.innerHTML = `<div class="panel"><div class="aiBadge" style="margin:20px auto;display:flex;width:fit-content">✨ Generating questions about ${esc(topicName)}...</div></div>`;
      const qs = await generateAIQuiz(topicName, user.level || "beginner", 5);
      if (!qs || !Array.isArray(qs) || qs.length === 0) { renderFallbackQuiz(user, root); return; }
      quizArea.innerHTML = `
        <form id="aiQuizForm" class="panel">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <div class="panelTitle">Quiz: ${esc(topicName)}</div>
            <span class="aiBadge">✨ AI-generated</span>
          </div>
          ${qs.map((q, i) => `
            <div style="padding:12px 0;border-bottom:1px solid var(--light-border)">
              <div style="font-weight:700">${i+1}. ${esc(q.prompt)}</div>
              <div style="display:grid;gap:8px;margin-top:10px">
                ${(q.opts || []).map(o => `<label style="display:flex;gap:10px;cursor:pointer"><input type="radio" name="aq${i}" value="${o.id}" required /><span>${esc(o.t)}</span></label>`).join("")}
              </div>
              <div id="aqw_${i}" class="sub hidden" style="margin-top:8px"></div>
            </div>
          `).join("")}
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px">
            <button class="btn primary" type="submit">Submit</button>
            <span id="aiQuizRes" class="sub" style="align-self:center"></span>
          </div>
        </form>
      `;
      $("aiQuizForm").addEventListener("submit", e => {
        e.preventDefault();
        let u = me(); if (!u) return;
        const fd = new FormData(e.currentTarget);
        let sc = 0;
        qs.forEach((q, i) => { const a = fd.get(`aq${i}`); const ok = a === q.ans; if (ok) sc++; const w = $(`aqw_${i}`); w.innerHTML = `${ok ? "✅ Correct!" : "❌ Not quite."} ${esc(q.why || "")}`; show(w); });
        const pts = sc * 20;
        u = addPts(u, pts, "ai_quiz");
        u.prog = { ...u.prog, quiz: { ...u.prog.quiz, main: { s: sc, total: qs.length, at: todayKey() } } }; save(u);
        if (sc >= 4) addBadge(u, "quiz_master");
        $("aiQuizRes").innerHTML = `<b>${sc}/${qs.length}</b> — +${pts} pts`;
        updateChip();
      });
    });
  });
}

function renderFallbackQuiz(user, root) {
  const quizArea = $("quizArea");
  quizArea.innerHTML = `
    <form id="quizForm" class="panel">
      <div class="sub" style="margin-bottom:10px">AI unavailable — using built-in questions</div>
      ${QUIZ_QS.map((q, i) => `
        <div style="padding:12px 0;border-bottom:1px solid var(--light-border)">
          <div style="font-weight:700">${i+1}. ${esc(q.prompt)}</div>
          <div style="display:grid;gap:8px;margin-top:10px">
            ${q.opts.map(o => `<label style="display:flex;gap:10px;cursor:pointer"><input type="radio" name="${q.id}" value="${o.id}" required /><span>${esc(o.t)}</span></label>`).join("")}
          </div>
          <div id="qw_${q.id}" class="sub hidden" style="margin-top:8px"></div>
        </div>
      `).join("")}
      <div style="display:flex;gap:10px;margin-top:14px">
        <button class="btn primary" type="submit">Submit</button>
        <span id="quizRes" class="sub" style="align-self:center"></span>
      </div>
    </form>
  `;
  $("quizForm").addEventListener("submit", e => {
    e.preventDefault();
    let u = me(); if (!u) return;
    const fd = new FormData(e.currentTarget);
    let sc = 0;
    QUIZ_QS.forEach(q => { const a = fd.get(q.id); const ok = a === q.ans; if (ok) sc++; const w = $(`qw_${q.id}`); w.innerHTML = `${ok ? "✅ Correct." : "❌ Nope."} ${esc(q.why)}`; show(w); });
    const pts = sc * 20;
    u = addPts(u, pts, "quiz");
    u.prog = { ...u.prog, quiz: { ...u.prog.quiz, main: { s: sc, total: QUIZ_QS.length, at: todayKey() } } }; save(u);
    if (sc >= 4) addBadge(u, "quiz_master");
    $("quizRes").innerHTML = `<b>${sc}/${QUIZ_QS.length}</b> — +${pts} pts`;
    updateChip();
  });
}

// ── Section 13: Playground (Enhanced — 4 modes) ─────────────────
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

// ── BUG FIX CHALLENGES ──
const BUG_CHALLENGES = [
  { id:"bug1", title:"Broken Average", difficulty:1,
    desc:"This code should compute the average of 3 numbers, but the result is wrong.",
    buggy:   ["a = 10","b = 20","c = 30","total = a + b + c","average = total / 2","print(average)"],
    errorLines:[4],
    fixed:   ["a = 10","b = 20","c = 30","total = a + b + c","average = total / 3","print(average)"],
    hint:"How many numbers are we averaging? Is the divisor correct?",
    expected:"20" },
  { id:"bug2", title:"Off-by-one Factorial", difficulty:1,
    desc:"This should print 5! = 120, but it prints something else.",
    buggy:   ["result = 1","i = 0","result = result * 1","result = result * 2","result = result * 3","result = result * 4","print(result)"],
    errorLines:[6],
    fixed:   ["result = 1","i = 0","result = result * 1","result = result * 2","result = result * 3","result = result * 4","result = result * 5","print(result)"],
    hint:"5! means 1×2×3×4×5. Are we multiplying by 5?",
    expected:"120" },
  { id:"bug3", title:"Wrong Comparison", difficulty:1,
    desc:"Should print the bigger of two numbers. It prints the wrong one.",
    buggy:   ["x = 15","y = 42","bigger = x","print(bigger)"],
    errorLines:[2],
    fixed:   ["x = 15","y = 42","bigger = y","print(bigger)"],
    hint:"Which variable is actually larger: x or y?",
    expected:"42" },
  { id:"bug4", title:"Celsius Conversion", difficulty:2,
    desc:"Convert 100°C to Fahrenheit (should be 212). The formula is wrong.",
    buggy:   ["celsius = 100","fahrenheit = celsius * 9 / 5","print(fahrenheit)"],
    errorLines:[1],
    fixed:   ["celsius = 100","fahrenheit = celsius * 9 / 5 + 32","print(fahrenheit)"],
    hint:"The formula is F = C × 9/5 + 32. What's missing?",
    expected:"212" },
  { id:"bug5", title:"Area Calculation", difficulty:2,
    desc:"Calculate the area of a rectangle 7×5. Should print 35.",
    buggy:   ["width = 7","height = 5","area = width + height","print(area)"],
    errorLines:[2],
    fixed:   ["width = 7","height = 5","area = width * height","print(area)"],
    hint:"Area = width × height, not width + height.",
    expected:"35" },
  { id:"bug6", title:"Percentage Score", difficulty:2,
    desc:"Student got 45 out of 50. Should print 90 (percent). It prints wrong.",
    buggy:   ["scored = 45","total = 50","pct = scored / total * 10","print(pct)"],
    errorLines:[2],
    fixed:   ["scored = 45","total = 50","pct = scored / total * 100","print(pct)"],
    hint:"To get a percentage, multiply by 100, not 10.",
    expected:"90" },
  { id:"bug7", title:"Swap Fail", difficulty:2,
    desc:"Should swap a and b, then print b (originally 10). Prints wrong value.",
    buggy:   ["a = 10","b = 20","a = b","b = a","print(b)"],
    errorLines:[2,3],
    fixed:   ["a = 10","b = 20","temp = a","a = b","b = temp","print(b)"],
    hint:"When you set a = b, the old value of a is lost. You need a temporary variable.",
    expected:"10" },
  { id:"bug8", title:"Discount Price", difficulty:3,
    desc:"Apply 20% discount to $80. Final price should be 64.",
    buggy:   ["price = 80","discount = 20","final = price - discount","print(final)"],
    errorLines:[2],
    fixed:   ["price = 80","discount = price * 20 / 100","final = price - discount","print(final)"],
    hint:"20% of 80 is not 20. You need to calculate the percentage of the price.",
    expected:"64" },
  { id:"bug9", title:"Power Calc", difficulty:3,
    desc:"Calculate 2^8 = 256. This code gets it wrong.",
    buggy:   ["base = 2","result = base * base * base * base * base * base * base","print(result)"],
    errorLines:[1],
    fixed:   ["base = 2","result = base * base * base * base * base * base * base * base","print(result)"],
    hint:"2^8 means multiplying 2 eight times. Count the multiplications.",
    expected:"256" },
  { id:"bug10", title:"Speed Calculation", difficulty:3,
    desc:"Car travels 150 km in 2.5 hours. Speed should be 60 km/h.",
    buggy:   ["distance = 150","time = 2.5","speed = distance * time","print(speed)"],
    errorLines:[2],
    fixed:   ["distance = 150","time = 2.5","speed = distance / time","print(speed)"],
    hint:"Speed = distance / time, not distance × time.",
    expected:"60" },
];

// ── FILL-THE-BLANKS CHALLENGES ──
const BLANK_CHALLENGES = [
  { id:"bl1", title:"Sum Two Numbers", difficulty:1,
    desc:"Complete the code to add two numbers and print the result.",
    template:"a = 5\nb = 3\nresult = a {{0}} b\nprint(result)",
    blanks:["+"], expected:"8" },
  { id:"bl2", title:"Circle Area", difficulty:1,
    desc:"Calculate area of a circle with radius 7. Use pi ≈ 3.14.",
    template:"radius = 7\npi = 3.14\narea = pi {{0}} radius * radius\nprint(area)",
    blanks:["*"], expected:"153.86" },
  { id:"bl3", title:"Remainder", difficulty:1,
    desc:"Find the remainder when 17 is divided by 5. Should print 2.",
    template:"a = 17\nb = 5\nresult = a {{0}} b\nprint(result)",
    blanks:["%"], expected:"2" },
  { id:"bl4", title:"Rectangle Perimeter", difficulty:2,
    desc:"Calculate the perimeter of a rectangle 8×3. Should print 22.",
    template:"length = 8\nwidth = 3\nperimeter = {{0}} * (length + width)\nprint(perimeter)",
    blanks:["2"], expected:"22" },
  { id:"bl5", title:"Fahrenheit to Celsius", difficulty:2,
    desc:"Convert 212°F to Celsius. Should print 100.",
    template:"f = 212\nc = (f - {{0}}) * 5 / 9\nprint(c)",
    blanks:["32"], expected:"100" },
  { id:"bl6", title:"Simple Interest", difficulty:2,
    desc:"Principal=1000, rate=5%, time=2 years. SI should be 100.",
    template:"p = 1000\nr = 5\nt = 2\nsi = p * r * t / {{0}}\nprint(si)",
    blanks:["100"], expected:"100" },
  { id:"bl7", title:"Average of Four", difficulty:2,
    desc:"Calculate average of 10, 20, 30, 40. Should print 25.",
    template:"total = 10 + 20 + 30 + 40\naverage = total / {{0}}\nprint(average)",
    blanks:["4"], expected:"25" },
  { id:"bl8", title:"Hypotenuse", difficulty:3,
    desc:"Right triangle with sides 3 and 4. Hypotenuse squared should be 25.",
    template:"a = 3\nb = 4\nh_sq = a {{0}} a + b * b\nprint(h_sq)",
    blanks:["*"], expected:"25" },
  { id:"bl9", title:"BMI Calculator", difficulty:3,
    desc:"Weight=70 kg, height=1.75 m. BMI ≈ 22.86 (print weight/(height^2)).",
    template:"weight = 70\nheight = 1.75\nbmi = weight / (height {{0}} height)\nprint(bmi)",
    blanks:["*"], expected:"22.857142857142858" },
  { id:"bl10", title:"Compound Expression", difficulty:3,
    desc:"Evaluate: (8 + 2) × (6 − 1) = 50",
    template:"a = 8 + 2\nb = 6 {{0}} 1\nresult = a * b\nprint(result)",
    blanks:["-"], expected:"50" },
];

// ── CODING CHALLENGES ──
const CODE_CHALLENGES = [
  { id:"ch1", title:"Double It", difficulty:1,
    desc:"Create a variable x with value 7, double it, and print the result.",
    expected:"14", hint:"x = 7, then multiply by 2, then print." },
  { id:"ch2", title:"Sum 1 to 5", difficulty:1,
    desc:"Calculate the sum of 1 + 2 + 3 + 4 + 5 and print it.",
    expected:"15", hint:"Just add them all: s = 1 + 2 + 3 + 4 + 5" },
  { id:"ch3", title:"Square a Number", difficulty:1,
    desc:"Set n = 9, compute n squared, and print the result.",
    expected:"81", hint:"Square means n * n." },
  { id:"ch4", title:"Swap and Print", difficulty:2,
    desc:"Set a = 5, b = 10. Swap them using a temp variable. Print a (should be 10).",
    expected:"10", hint:"Use temp = a, then a = b, then b = temp." },
  { id:"ch5", title:"Max of Three", difficulty:2,
    desc:"Given x=12, y=45, z=30. Print the largest value.",
    expected:"45", hint:"Think about which variable has the biggest number." },
  { id:"ch6", title:"Even or Odd Check", difficulty:2,
    desc:"Set n = 17. Print n % 2 (0 = even, 1 = odd).",
    expected:"1", hint:"The modulo operator % gives the remainder." },
  { id:"ch7", title:"Triangle Area", difficulty:2,
    desc:"Base = 10, height = 6. Print the area (0.5 × base × height).",
    expected:"30", hint:"area = 0.5 * base * height" },
  { id:"ch8", title:"Convert Minutes", difficulty:3,
    desc:"Given 135 minutes, print how many full hours that is (integer).",
    expected:"2", hint:"Divide by 60. Remember, 135/60 = 2.25, we want just the integer part. Use (135 - 135 % 60) / 60." },
  { id:"ch9", title:"Distance Formula Part", difficulty:3,
    desc:"Points: (3,0) and (0,4). Print dx² + dy² (should be 25).",
    expected:"25", hint:"dx = 3-0 = 3, dy = 0-4 = -4. dx*dx + dy*dy = 9+16 = 25" },
  { id:"ch10", title:"Digit Sum", difficulty:3,
    desc:"Number = 123. Print the sum of its digits (1+2+3=6). Use division and modulo.",
    expected:"6", hint:"d1 = 123 % 10 (=3), then 123 - 3 = 120, 120/10=12, d2 = 12 % 10 (=2), etc." },
];

let pgMode = "free";

function renderPlayground(user) {
  const root = $("v_playground");
  root.innerHTML = `
    <h2 style="margin:0 0 4px">Coding Playground</h2>
    <div class="sub" style="margin-bottom:16px">Write code, fix bugs, fill blanks, and solve challenges. Earn points for every correct answer!</div>
    <div class="pgTabs">
      <button class="pgTab ${pgMode==="free"?"active":""}" data-m="free"><span class="pgTabIcon">💻</span>Free Code</button>
      <button class="pgTab ${pgMode==="bugfix"?"active":""}" data-m="bugfix"><span class="pgTabIcon">🐛</span>Bug Fix</button>
      <button class="pgTab ${pgMode==="blanks"?"active":""}" data-m="blanks"><span class="pgTabIcon">✏️</span>Fill Blanks</button>
      <button class="pgTab ${pgMode==="challenge"?"active":""}" data-m="challenge"><span class="pgTabIcon">🏆</span>Challenges</button>
    </div>
    <div id="pgContent"></div>
  `;
  root.querySelectorAll(".pgTab").forEach(t => {
    t.addEventListener("click", () => { pgMode = t.dataset.m; renderPlayground(user); });
  });
  const pgMap = { free: pgFreeMode, bugfix: pgBugFixMode, blanks: pgBlanksMode, challenge: pgChallengeMode };
  pgMap[pgMode](user);
}

// ── MODE 1: FREE CODE ──
function pgFreeMode(user) {
  const area = $("pgContent");
  area.innerHTML = `
    <div class="g2">
      <div class="panel">
        <div class="panelTitle">Code</div>
        <textarea id="pgCode" class="codeArea" spellcheck="false"># Try it!\nx = 5\ny = x * 3 + 1\nprint(y)\nprint("Hello AIML!")</textarea>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button id="pgRun" class="btn primary sm">Run (+5 pts)</button>
          <button id="pgReview" class="btn ghost sm">✨ AI Review</button>
        </div>
      </div>
      <div class="panel">
        <div class="panelTitle">Output</div>
        <div id="pgOut" class="outBox"></div>
        <div id="pgReviewBox" class="hidden" style="margin-top:12px;border-top:1px solid var(--light-border);padding-top:12px">
          <span class="aiBadge">✨ AI Code Review</span>
          <div id="pgReviewText" class="sub" style="white-space:pre-wrap;line-height:1.6;margin-top:8px"></div>
        </div>
      </div>
    </div>
  `;
  $("pgRun").addEventListener("click", () => {
    let u = me(); if (!u) return;
    hide($("pgReviewBox"));
    try { $("pgOut").textContent = runMini($("pgCode").value) || "(no output)"; u = addPts(u, 5, "playground"); u.prog = { ...u.prog, runs: (u.prog.runs || 0) + 1 }; save(u); } catch (err) { $("pgOut").textContent = "Error: " + (err?.message || err); }
    updateChip();
  });
  $("pgReview").addEventListener("click", async () => {
    const code = $("pgCode").value.trim(); if (!code) return;
    show($("pgReviewBox")); $("pgReviewText").textContent = "Gemini is reviewing...";
    const review = await reviewCode(code);
    $("pgReviewText").textContent = review || "Could not review right now.";
    let u = me(); if (u) { u = addPts(u, 3, "ai_review"); save(u); updateChip(); }
  });
}

// ── MODE 2: BUG FIX ──
let bugIdx = 0;
function pgBugFixMode(user) {
  const ch = BUG_CHALLENGES[bugIdx];
  const area = $("pgContent");
  const dots = Array.from({length: ch.difficulty}, () => '<div class="dot fill"></div>').join("") +
               Array.from({length: 3 - ch.difficulty}, () => '<div class="dot"></div>').join("");
  area.innerHTML = `
    <div class="pgModeHeader">
      <h3>🐛 ${esc(ch.title)}</h3>
      <div class="pgDifficulty">${dots}</div>
    </div>
    <div class="sub" style="margin-bottom:12px">${esc(ch.desc)}</div>
    <div class="panel" style="margin-bottom:12px">
      <div class="panelTitle">Buggy Code — Edit to fix it</div>
      <textarea id="bugEditor" class="codeArea" spellcheck="false">${ch.buggy.join("\n")}</textarea>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button id="bugCheck" class="btn primary sm">Check Fix (+15 pts)</button>
      <button id="bugHint" class="btn ghost sm">💡 Hint</button>
      <button id="bugShowAnswer" class="btn ghost sm">Show Answer</button>
    </div>
    <div id="bugResult"></div>
    <div class="pgNav">
      <div class="pgCounter">${bugIdx + 1} / ${BUG_CHALLENGES.length}</div>
      <div style="display:flex;gap:8px">
        <button id="bugPrev" class="btn ghost sm" ${bugIdx===0?"disabled":""}>← Prev</button>
        <button id="bugNext" class="btn ghost sm" ${bugIdx>=BUG_CHALLENGES.length-1?"disabled":""}>Next →</button>
      </div>
    </div>
  `;

  $("bugCheck").addEventListener("click", () => {
    const userCode = $("bugEditor").value.trim();
    let output;
    try { output = runMini(userCode); } catch(e) { output = "ERROR"; }
    const pass = output.trim() === ch.expected.trim();
    $("bugResult").innerHTML = pass
      ? `<div class="pgResult pass">✅ Correct! The output is ${esc(ch.expected)}. Bug squashed!</div>`
      : `<div class="pgResult fail">❌ Expected output: <b>${esc(ch.expected)}</b>, but got: <b>${esc(output)}</b>. Try again!</div>`;
    if (pass) { let u = me(); if (u) { addPts(u, 15, "bugfix_" + ch.id); updateChip(); } }
  });

  $("bugHint").addEventListener("click", () => {
    $("bugResult").innerHTML = `<div class="pgResult" style="background:var(--coral-soft);color:var(--coral)">💡 ${esc(ch.hint)}</div>`;
  });

  $("bugShowAnswer").addEventListener("click", () => {
    $("bugEditor").value = ch.fixed.join("\n");
    $("bugResult").innerHTML = `<div class="pgResult" style="background:var(--coral-soft);color:var(--sub)">Answer revealed. Try the next one to earn points!</div>`;
  });

  $("bugPrev").addEventListener("click", () => { if (bugIdx > 0) { bugIdx--; pgBugFixMode(user); } });
  $("bugNext").addEventListener("click", () => { if (bugIdx < BUG_CHALLENGES.length - 1) { bugIdx++; pgBugFixMode(user); } });
}

// ── MODE 3: FILL THE BLANKS ──
let blankIdx = 0;
function pgBlanksMode(user) {
  const ch = BLANK_CHALLENGES[blankIdx];
  const area = $("pgContent");
  const dots = Array.from({length: ch.difficulty}, () => '<div class="dot fill"></div>').join("") +
               Array.from({length: 3 - ch.difficulty}, () => '<div class="dot"></div>').join("");

  let displayCode = ch.template;
  const blankInputs = [];
  ch.blanks.forEach((ans, i) => {
    const placeholder = `{{${i}}}`;
    const inputHtml = `<input type="text" class="blankSlot" id="blank_${i}" data-idx="${i}" autocomplete="off" placeholder="___" style="width:${Math.max(40, ans.length * 14)}px">`;
    displayCode = displayCode.replace(placeholder, inputHtml);
  });

  const codeLines = displayCode.split("\n").map((line, i) =>
    `<div class="bugLine"><div class="bugLineNum">${i+1}</div><div class="bugLineCode">${line}</div></div>`
  ).join("");

  area.innerHTML = `
    <div class="pgModeHeader">
      <h3>✏️ ${esc(ch.title)}</h3>
      <div class="pgDifficulty">${dots}</div>
    </div>
    <div class="sub" style="margin-bottom:12px">${esc(ch.desc)}</div>
    <div class="panel" style="margin-bottom:12px">
      <div class="panelTitle">Fill in the blanks to make the code work</div>
      <div style="padding:14px;background:var(--dark);border-radius:12px;color:var(--dark-text)">
        ${codeLines}
      </div>
      <div class="sub" style="margin-top:8px">Expected output: <code style="background:var(--inset);padding:2px 8px;border-radius:6px">${esc(ch.expected)}</code></div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button id="blankCheck" class="btn primary sm">Check Answer (+20 pts)</button>
      <button id="blankReveal" class="btn ghost sm">Show Answer</button>
    </div>
    <div id="blankResult"></div>
    <div class="pgNav">
      <div class="pgCounter">${blankIdx + 1} / ${BLANK_CHALLENGES.length}</div>
      <div style="display:flex;gap:8px">
        <button id="blankPrev" class="btn ghost sm" ${blankIdx===0?"disabled":""}>← Prev</button>
        <button id="blankNext" class="btn ghost sm" ${blankIdx>=BLANK_CHALLENGES.length-1?"disabled":""}>Next →</button>
      </div>
    </div>
  `;

  $("blankCheck").addEventListener("click", () => {
    let allCorrect = true;
    ch.blanks.forEach((ans, i) => {
      const input = $(`blank_${i}`);
      const val = input.value.trim();
      if (val === ans) {
        input.classList.add("correct"); input.classList.remove("wrong");
      } else {
        input.classList.add("wrong"); input.classList.remove("correct");
        allCorrect = false;
      }
    });

    let code = ch.template;
    ch.blanks.forEach((_, i) => { code = code.replace(`{{${i}}}`, $(`blank_${i}`).value.trim()); });
    let output;
    try { output = runMini(code); } catch(e) { output = "ERROR"; }
    const outMatch = output.trim() === ch.expected.trim();

    if (allCorrect && outMatch) {
      $("blankResult").innerHTML = `<div class="pgResult pass">✅ Perfect! All blanks correct. Output: ${esc(ch.expected)}</div>`;
      let u = me(); if (u) { addPts(u, 20, "blanks_" + ch.id); updateChip(); }
    } else if (outMatch) {
      $("blankResult").innerHTML = `<div class="pgResult pass">✅ Output is correct! There might be an alternative solution. +20 pts</div>`;
      let u = me(); if (u) { addPts(u, 20, "blanks_" + ch.id); updateChip(); }
    } else {
      $("blankResult").innerHTML = `<div class="pgResult fail">❌ Output: <b>${esc(output)}</b> — expected: <b>${esc(ch.expected)}</b>. Check the blanks!</div>`;
    }
  });

  $("blankReveal").addEventListener("click", () => {
    ch.blanks.forEach((ans, i) => {
      const input = $(`blank_${i}`); input.value = ans;
      input.classList.add("correct"); input.classList.remove("wrong");
    });
    $("blankResult").innerHTML = `<div class="pgResult" style="background:var(--coral-soft);color:var(--sub)">Answers revealed. Try the next one!</div>`;
  });

  $("blankPrev").addEventListener("click", () => { if (blankIdx > 0) { blankIdx--; pgBlanksMode(user); } });
  $("blankNext").addEventListener("click", () => { if (blankIdx < BLANK_CHALLENGES.length - 1) { blankIdx++; pgBlanksMode(user); } });
}

// ── MODE 4: CODING CHALLENGES ──
let chIdx = 0;
function pgChallengeMode(user) {
  const ch = CODE_CHALLENGES[chIdx];
  const area = $("pgContent");
  const dots = Array.from({length: ch.difficulty}, () => '<div class="dot fill"></div>').join("") +
               Array.from({length: 3 - ch.difficulty}, () => '<div class="dot"></div>').join("");

  area.innerHTML = `
    <div class="pgModeHeader">
      <h3>🏆 ${esc(ch.title)}</h3>
      <div class="pgDifficulty">${dots}</div>
    </div>
    <div class="challengePrompt">
      <h4>Challenge</h4>
      <div>${esc(ch.desc)}</div>
      <div class="challengeExpected">Expected output: ${esc(ch.expected)}</div>
    </div>
    <div class="panel">
      <div class="panelTitle">Your Solution</div>
      <textarea id="chCode" class="codeArea" spellcheck="false" placeholder="# Write your code here\n"># Write your solution here\n</textarea>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button id="chRun" class="btn primary sm">Submit (+25 pts)</button>
        <button id="chHint" class="btn ghost sm">💡 Hint</button>
        <button id="chTest" class="btn ghost sm">Test Run</button>
      </div>
    </div>
    <div id="chResult"></div>
    <div class="pgNav">
      <div class="pgCounter">${chIdx + 1} / ${CODE_CHALLENGES.length}</div>
      <div style="display:flex;gap:8px">
        <button id="chPrev" class="btn ghost sm" ${chIdx===0?"disabled":""}>← Prev</button>
        <button id="chNext" class="btn ghost sm" ${chIdx>=CODE_CHALLENGES.length-1?"disabled":""}>Next →</button>
      </div>
    </div>
  `;

  $("chTest").addEventListener("click", () => {
    const code = $("chCode").value.trim();
    if (!code) return;
    let output;
    try { output = runMini(code); } catch(e) { output = "Error: " + (e?.message || e); }
    $("chResult").innerHTML = `<div class="pgResult" style="background:var(--inset);color:var(--text)">Output: <code>${esc(output)}</code></div>`;
  });

  $("chRun").addEventListener("click", () => {
    const code = $("chCode").value.trim();
    if (!code || code === "# Write your solution here") {
      $("chResult").innerHTML = `<div class="pgResult fail">Write some code first!</div>`;
      return;
    }
    let output;
    try { output = runMini(code); } catch(e) { output = "ERROR: " + (e?.message || e); }
    const pass = output.trim() === ch.expected.trim();
    if (pass) {
      $("chResult").innerHTML = `<div class="pgResult pass">✅ Challenge solved! Output: ${esc(ch.expected)} — well done!</div>`;
      let u = me(); if (u) { addPts(u, 25, "challenge_" + ch.id); addBadge(u, "coder"); updateChip(); }
    } else {
      $("chResult").innerHTML = `<div class="pgResult fail">❌ Output: <b>${esc(output)}</b> — expected: <b>${esc(ch.expected)}</b>. Keep trying!</div>`;
    }
  });

  $("chHint").addEventListener("click", () => {
    $("chResult").innerHTML = `<div class="pgResult" style="background:var(--coral-soft);color:var(--coral)">💡 ${esc(ch.hint)}</div>`;
  });

  $("chPrev").addEventListener("click", () => { if (chIdx > 0) { chIdx--; pgChallengeMode(user); } });
  $("chNext").addEventListener("click", () => { if (chIdx < CODE_CHALLENGES.length - 1) { chIdx++; pgChallengeMode(user); } });
}

// ── Section 13.5: Simulation (Spam Detector) ────────────────────
function renderSimulate(user) {
  const root = $("v_simulate");
  root.innerHTML = `
    <h2>Learn Through Simulation</h2>
    <p class="sub">Interactive real-world scenarios. Watch metrics change as you make decisions.</p>
    <div class="gamesGrid" style="margin-top:12px">
      <div class="gameCard" data-sim="spam" style="cursor:pointer">
        <div style="font-size:36px;margin-bottom:8px">🚨</div>
        <h3>Spam Detector</h3>
        <div class="sub">Label emails. Watch precision & recall update live. Build an ML intuition for classification metrics.</div>
        <div class="sub" style="margin-top:8px">Accuracy: ${(user.prog.sims?.spam?.acc||0)*100|0}%</div>
      </div>
    </div>
  `;
  document.querySelectorAll("[data-sim]").forEach(card => {
    card.addEventListener("click", () => {
      const sim = card.dataset.sim;
      if (sim === "spam") startSpamSim(user);
    });
  });
}

function startSpamSim(user) {
  curView = "simulation";
  document.querySelectorAll(".view").forEach(v => hide(v));
  show($("v_simulation"));
  document.querySelectorAll(".navBtn").forEach(b => {
    b.classList.toggle("active", b.dataset.r === "simulate");
  });
  
  const root = $("v_simulation");
  const spamExamples = [
    { text: "Congratulations! You won a FREE prize. Click now!", label: "spam", keywords: ["FREE", "won", "click now"] },
    { text: "Your account has been compromised. Verify immediately.", label: "spam", keywords: ["compromised", "verify"] },
    { text: "Meeting scheduled for 2 PM tomorrow in conference room B", label: "ham", keywords: [] },
    { text: "URGENT: Wire transfer needed. Reply ASAP!", label: "spam", keywords: ["URGENT", "wire", "ASAP"] },
    { text: "Project update: Q2 goals are on track", label: "ham", keywords: [] },
    { text: "Act NOW! Limited time offer - 90% OFF everything!!!", label: "spam", keywords: ["NOW", "LIMITED", "OFF"] },
    { text: "Can you review the attached document by EOD?", label: "ham", keywords: [] },
    { text: "You have inherited $5 million. Send bank details to claim.", label: "spam", keywords: ["inherited", "million", "bank"] },
  ];
  
  let stats = { tp: 0, fp: 0, tn: 0, fn: 0, total: 0 };
  let currentIdx = 0;
  let labeled = new Set();

  function updateMetrics() {
    const precision = stats.tp + stats.fp > 0 ? stats.tp / (stats.tp + stats.fp) : 0;
    const recall = stats.tp + stats.fn > 0 ? stats.tp / (stats.tp + stats.fn) : 0;
    const accuracy = stats.total > 0 ? (stats.tp + stats.tn) / stats.total : 0;
    return { precision, recall, accuracy };
  }

  function renderEmail() {
    if (currentIdx >= spamExamples.length) {
      const m = updateMetrics();
      user.prog = { ...user.prog, sims: { ...user.prog.sims, spam: { acc: m.accuracy, tp: stats.tp, total: stats.total } } };
      save(user);
      root.innerHTML = `
        <button class="btn sm ghost" onclick="goView('simulate')" style="margin-bottom:10px">← Back</button>
        <div class="panel" style="margin-top:12px">
          <h3>Simulation Complete!</h3>
          <div style="display:grid;gap:8px;margin-top:12px">
            <div><b>Accuracy:</b> ${(m.accuracy*100|0)}%</div>
            <div><b>Precision:</b> ${(m.precision*100|0)}% (TP/(TP+FP))</div>
            <div><b>Recall:</b> ${(m.recall*100|0)}% (TP/(TP+FN))</div>
            <div class="sub" style="margin-top:8px"><b>Confusion Matrix:</b><br>TP: ${stats.tp} | FP: ${stats.fp}<br>TN: ${stats.tn} | FN: ${stats.fn}</div>
          </div>
          <button class="btn primary" onclick="goView('simulate')" style="margin-top:12px">Back to Simulations</button>
        </div>
      `;
      user = addPts(user, Math.max(10, Math.floor(m.accuracy * 50)), "simulation_spam");
      updateChip();
      return;
    }

    const email = spamExamples[currentIdx];
    const m = updateMetrics();
    root.innerHTML = `
      <button class="btn sm ghost" onclick="goView('simulate')" style="margin-bottom:10px">← Back</button>
      <div class="g2" style="gap:12px;margin-top:12px">
        <div class="panel">
          <div class="panelTitle">Email ${currentIdx + 1}/${spamExamples.length}</div>
          <div style="padding:12px;background:var(--canvas);border-radius:10px;margin:8px 0;box-shadow:var(--neo-sm-in)">
            <div style="font-size:14px;line-height:1.6;word-break:break-word;color:var(--text)">"${esc(email.text)}"</div>
          </div>
          <div style="font-size:12px;color:var(--sub);margin-top:8px"><b>Keywords:</b> ${email.keywords.join(", ") || "None obvious"}</div>
          <div style="display:flex;gap:8px;margin-top:12px">
            <button id="hamBtn" class="btn primary">✓ Ham (Legitimate)</button>
            <button id="spamBtn" class="btn danger">✗ Spam</button>
          </div>
          <div id="simFeedback" class="sub hidden" style="margin-top:10px;padding:10px;border-radius:8px"></div>
        </div>
        <div class="panel">
          <div class="panelTitle">Metrics</div>
          <div class="sliderRow" style="display:flex;flex-direction:column;gap:12px;margin-top:8px">
            <div>
              <label style="display:block;margin-bottom:4px">Accuracy: <b>${(m.accuracy*100|0)}%</b></div>
              <div style="height:8px;background:var(--inset);border-radius:4px;overflow:hidden;box-shadow:var(--neo-sm-in)">
                <div style="height:100%;width:${m.accuracy*100}%;background:var(--success);transition:width 0.3s"></div>
              </div>
            </div>
            <div>
              <label style="display:block;margin-bottom:4px">Precision: <b>${(m.precision*100|0)}%</b></label>
              <div style="height:8px;background:var(--inset);border-radius:4px;overflow:hidden;box-shadow:var(--neo-sm-in)">
                <div style="height:100%;width:${m.precision*100}%;background:var(--coral);transition:width 0.3s"></div>
              </div>
            </div>
            <div>
              <label style="display:block;margin-bottom:4px">Recall: <b>${(m.recall*100|0)}%</b></label>
              <div style="height:8px;background:var(--inset);border-radius:4px;overflow:hidden;box-shadow:var(--neo-sm-in)">
                <div style="height:100%;width:${m.recall*100}%;background:var(--danger);transition:width 0.3s"></div>
              </div>
            </div>
          </div>
          <div class="sub" style="margin-top:12px;padding:10px;background:var(--canvas);border-radius:8px;font-size:12px;box-shadow:var(--neo-sm-in)">
            <b>Tip:</b> Spam has urgent words like "FREE", "NOW", "WINNER". Legitimate emails discuss work/accounts.
          </div>
        </div>
      </div>
    `;

    const recordLabel = (userLabel) => {
      const correct = userLabel === email.label;
      if (userLabel === "spam") {
        if (correct) stats.tp++;
        else stats.fp++;
      } else {
        if (correct) stats.tn++;
        else stats.fn++;
      }
      stats.total++;
      labeled.add(currentIdx);

      const fb = $("simFeedback");
      if (correct) {
        fb.style.background = "rgba(107,255,184,.15)";
        fb.innerHTML = `✅ <b>Correct!</b> This ${email.label === "spam" ? "is spam" : "is legitimate"}.`;
      } else {
        fb.style.background = "rgba(255,107,107,.15)";
        fb.innerHTML = `❌ <b>Not quite.</b> This is actually <b>${email.label}</b>.`;
      }
      fb.classList.remove("hidden");

      setTimeout(() => {
        currentIdx++;
        renderEmail();
      }, 1500);
    };

    $("hamBtn").addEventListener("click", () => recordLabel("ham"));
    $("spamBtn").addEventListener("click", () => recordLabel("spam"));
  }

  renderEmail();
}

// ── Section 14: Leaderboard ─────────────────────────────────────
function renderLeaderboard() {
  const root = $("v_leaderboard");
  const users = loadUsers().slice().sort((a, b) => (b.pts || 0) - (a.pts || 0)).slice(0, 20);
  const top = users.slice(0, 10);
  const maxPts = Math.max(1, ...top.map(u => u.pts || 0));
  const meUser = me();
  const myId = meUser?.id || "";
  root.innerHTML = `
    <h2>Leaderboard</h2>
    <div class="panel" style="margin-bottom:14px">
      <div class="lbHeader">
        <div>
          <div class="lbTitle">Top rankings</div>
          <div class="sub">Sorted by points • showing top ${users.length}</div>
        </div>
      </div>
      <div class="lbList" role="list">
        ${users.map((u, i) => {
          const pts = u.pts || 0;
          const w = Math.round((pts / Math.max(1, users[0]?.pts || 1)) * 100);
          const initials = (u.email || "U").split("@")[0].slice(0, 2).toUpperCase();
          const isMe = myId && u.id === myId;
          return `
            <div class="lbCard ${isMe ? "me" : ""}" role="listitem">
              <div class="lbLeft">
                <div class="lbAvatar" aria-hidden="true">${esc(initials)}</div>
                <div class="lbMeta">
                  <div class="lbNameRow">
                    <div class="lbName" title="${esc(u.email)}">${esc(u.email)}</div>
                    ${i < 3 ? `<span class="lbCrown" title="Top ${i + 1}">${i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉"}</span>` : ""}
                  </div>
                  <div class="sub">streak <b>${u.streak?.n || 0}</b> • badges <b>${u.badges?.length || 0}</b></div>
                  <div class="lbBarWrap" aria-hidden="true">
                    <div class="lbBar" style="width:${w}%"></div>
                  </div>
                </div>
              </div>
              <div class="lbRight">
                <div class="lbRankPill">#${i + 1}</div>
                <div class="lbVal"><b>${pts}</b><div class="sub" style="margin-top:2px">pts</div></div>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

// ── Section 15: Auth + Boot ─────────────────────────────────────
let authMode = "login";

function updateChip() {
  const u = me(), c = $("userChip");
  if (!u) { hide(c); return; }
  c.textContent = `${u.email} · ${u.pts||0} pts · streak ${u.streak?.n||0}`;
  show(c);
}

function showApp() { hide($("authView")); hide($("onboardView")); show($("appView")); show($("btnLogout")); updateChip(); goView("dashboard"); }
function showAuth() { show($("authView")); hide($("appView")); hide($("onboardView")); hide($("btnLogout")); hide($("userChip")); }

function enterApp() {
  const u = me();
  if (!u) { showAuth(); return; }
  if (!u.onboarded) { showOnboard(); return; }
  showApp();
}

function firebaseErrorMsg(code) {
  const map = {
    "auth/email-already-in-use": "An account with this email already exists.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/user-not-found": "No account found. Register first.",
    "auth/wrong-password": "Incorrect password.",
    "auth/weak-password": "Password should be at least 6 characters.",
    "auth/too-many-requests": "Too many attempts. Please try again later.",
    "auth/invalid-credential": "Invalid email or password.",
    "auth/network-request-failed": "Network error. Check your connection.",
  };
  return map[code] || "Authentication failed. Please try again.";
}

function boot() {
  const lc = $("logoCanvas");
  if (lc) {
    const lx = lc.getContext("2d");
    lx.fillStyle = "rgba(224,122,95,.6)";
    lx.beginPath(); lx.arc(18, 18, 6, 0, Math.PI * 2); lx.fill();
    lx.strokeStyle = "rgba(107,158,158,.5)"; lx.lineWidth = 1.5;
    lx.beginPath(); lx.arc(18, 18, 14, 0, Math.PI * 2); lx.stroke();
  }

  $("tabLogin").addEventListener("click", () => { authMode = "login"; $("tabLogin").classList.add("active"); $("tabReg").classList.remove("active"); $("authBtn").textContent = "Login"; });
  $("tabReg").addEventListener("click", () => { authMode = "register"; $("tabReg").classList.add("active"); $("tabLogin").classList.remove("active"); $("authBtn").textContent = "Create account"; });

  $("authForm").addEventListener("submit", async e => {
    e.preventDefault();
    const errBox = $("authErr");
    hide(errBox);
    const email = $("inEmail").value.trim().toLowerCase();
    const pw = $("inPw").value;
    const btn = $("authBtn");
    btn.disabled = true;
    btn.textContent = authMode === "register" ? "Creating account…" : "Logging in…";
    try {
      if (authMode === "register") {
        await fbAuth.createUserWithEmailAndPassword(email, pw);
      } else {
        await fbAuth.signInWithEmailAndPassword(email, pw);
      }
    } catch (err) {
      errBox.textContent = firebaseErrorMsg(err.code);
      show(errBox);
    } finally {
      btn.disabled = false;
      btn.textContent = authMode === "register" ? "Create account" : "Login";
    }
  });

  $("btnGoogle").addEventListener("click", async () => {
    const errBox = $("authErr");
    hide(errBox);
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      await fbAuth.signInWithPopup(provider);
    } catch (err) {
      if (err.code !== "auth/popup-closed-by-user") {
        errBox.textContent = firebaseErrorMsg(err.code);
        show(errBox);
      }
    }
  });

  $("btnLogout").addEventListener("click", () => {
    fbAuth.signOut();
    clearSess();
    showAuth();
  });

  // Make the top user chip open Profile quickly
  $("userChip").addEventListener("click", () => goView("profile"));
  $("userChip").style.cursor = "pointer";

  $("btnDemo").addEventListener("click", async () => {
    const users = loadUsers();
    if (!users.find(u => u.email === "ada@demo.ai")) {
      const h = await sha256("password");
      const mk = (em, p, b, lv, gl) => { const u = freshUser(em); u.pw = h; u.pts = p; u.badges = b; u.streak = { n: Math.ceil(Math.random()*5), d: todayKey() }; u.prog.mods = { linreg_1: nowISO(), linreg_2: nowISO(), perceptron_1: nowISO() }; u.onboarded = true; u.level = lv; u.goal = gl; return u; };
      users.push(mk("ada@demo.ai", 280, ["explorer","quiz_master"], "intermediate", "understand"));
      users.push(mk("turing@demo.ai", 190, ["explorer"], "beginner", "build"));
      users.push(mk("grace@demo.ai", 340, ["explorer","quiz_master"], "advanced", "career"));
      saveUsers(users);
    }
    const ada = loadUsers().find(u => u.email === "ada@demo.ai");
    if (ada) { saveSess({ uid: ada.id }); showApp(); }
  });

  document.querySelectorAll(".navBtn").forEach(b => {
    b.addEventListener("click", () => goView(b.dataset.r));
  });

  fbAuth.onAuthStateChanged(user => {
    if (user) {
      const all = loadUsers();
      let u = all.find(x => x.email === user.email);
      if (!u) {
        u = freshUser(user.email);
        u.id = user.uid;
        all.push(u);
        saveUsers(all);
      }
      saveSess({ uid: u.id });
      enterApp();
    } else {
      if (!loadSess()?.uid) showAuth();
    }
  });
}

// ── AI Tutor Chatbot UI ─────────────────────────────────────────
function initChatbot() {
  const fab = document.createElement("button");
  fab.id = "chatFab"; fab.className = "chatFab";
  fab.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  fab.title = "AI Tutor";
  document.body.appendChild(fab);

  const panel = document.createElement("div");
  panel.id = "chatPanel"; panel.className = "chatPanel hidden";
  panel.innerHTML = `
    <div class="chatHeader">
      <div><strong>AI Tutor</strong><span class="aiBadge" style="font-size:9px;padding:2px 8px;margin-left:6px">Gemini</span></div>
      <button id="chatClose" class="btn ghost sm" style="padding:4px 8px;min-width:0">✕</button>
    </div>
    <div id="chatMessages" class="chatMessages">
      <div class="chatMsg tutor"><div class="chatBubble tutor">Hey! I'm your AI tutor. Ask me anything about AI/ML!</div></div>
    </div>
    <form id="chatForm" class="chatInputRow">
      <input id="chatInput" type="text" placeholder="Ask anything about AI/ML..." autocomplete="off" />
      <button type="submit" class="btn primary sm" style="min-width:0;padding:8px 14px">→</button>
    </form>
  `;
  document.body.appendChild(panel);

  let chatOpen = false;
  fab.addEventListener("click", () => { chatOpen = !chatOpen; panel.classList.toggle("hidden", !chatOpen); fab.classList.toggle("active", chatOpen); if (chatOpen) $("chatInput").focus(); });
  $("chatClose").addEventListener("click", () => { chatOpen = false; panel.classList.add("hidden"); fab.classList.remove("active"); });

  $("chatForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("chatInput"); const msg = input.value.trim(); if (!msg) return; input.value = "";
    const msgs = $("chatMessages");
    msgs.innerHTML += `<div class="chatMsg user"><div class="chatBubble user">${esc(msg)}</div></div>`;
    msgs.innerHTML += `<div class="chatMsg tutor" id="chatTyping"><div class="chatBubble tutor chatTypingAnim">Thinking...</div></div>`;
    msgs.scrollTop = msgs.scrollHeight;
    const reply = await chatWithTutor(msg);
    const typing = $("chatTyping"); if (typing) typing.remove();
    msgs.innerHTML += `<div class="chatMsg tutor"><div class="chatBubble tutor">${esc(reply || "Hmm, I couldn't think of a response. Try asking differently!")}</div></div>`;
    msgs.scrollTop = msgs.scrollHeight;
    let u = me(); if (u) { u = addPts(u, 2, "tutor_chat"); save(u); }
  });
}

function attachAIExplain(container) {
  container.querySelectorAll("[data-explain]").forEach(el => {
    el.style.cursor = "pointer";
    el.style.borderBottom = "1px dashed rgba(224,122,95,.6)";
    el.addEventListener("click", async () => {
      const term = el.dataset.explain;
      const context = el.dataset.context || "AI/ML";
      const tip = $("tooltip");
      tip.textContent = "✨ AI explaining...";
      tip.style.left = el.getBoundingClientRect().left + "px";
      tip.style.top = (el.getBoundingClientRect().bottom + 6) + "px";
      show(tip);
      const explanation = await explainConcept(term, context);
      tip.textContent = explanation || `${term}: a core AI/ML concept.`;
      setTimeout(() => hide(tip), 8000);
    });
  });
}

boot();
initChatbot();
