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

// ── Section 9: Interactive Lessons — Canvas-based visualizers ─────
const INTERACTIVE_LESSONS = {};
function _regViz(topicId, fn) {
  const t = TOPICS.find(x => x.id === topicId);
  if (t) t.subtopics.forEach((s, i) => { INTERACTIVE_LESSONS[s.id] = (c, u) => fn(c, u, i); });
}

function _vizShell(container, topicId, subtopicId, user, stepIdx, steps, drawFn) {
  const topic = TOPICS.find(t => t.id === topicId);
  const sub = topic?.subtopics.find(s => s.id === subtopicId);
  const isDone = !!user.prog.mods[subtopicId];
  container.innerHTML = `
    <button class="btn sm ghost" onclick="openTopic('${topicId}')" style="margin-bottom:10px">&larr; ${esc(topic.title)}</button>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
      <span style="font-size:28px">${topic.icon}</span>
      <div><div class="sub">${esc(topic.title)}</div><h2 style="margin:0">${esc(sub?.title||'')}</h2></div>
    </div>
    <div class="vizSteps">${steps.map((s,i)=>`<button class="vizStep ${i===stepIdx?'active':''}" data-vi="${i}">${s}</button>`).join('')}</div>
    <div class="vizWrap">
      <div class="vizRow"><canvas id="vizCnv" class="vizCanvas" width="600" height="380"></canvas>
        <div class="vizControls" id="vizCtrl"></div>
      </div>
      <div id="vizInfo" class="vizDesc"></div>
      <div style="display:flex;gap:10px;align-items:center">${isDone
        ? '<span class="pill pillGlow">Completed</span>'
        : '<button class="btn primary" id="vizDone">Mark Complete (+25 pts)</button>'}</div>
    </div>`;
  container.querySelectorAll('.vizStep').forEach(b => {
    b.addEventListener('click', () => {
      const idx = parseInt(b.dataset.vi);
      const newSub = topic.subtopics[idx];
      if (newSub) openLesson(topicId, newSub.id);
    });
  });
  if (!isDone) {
    $('vizDone').addEventListener('click', () => {
      let u = me(); if (!u) return;
      u.prog = {...u.prog, mods:{...u.prog.mods, [subtopicId]: nowISO()}};
      save(u); addPts(u, 25, 'lesson_'+subtopicId);
      if (topic.subtopics.every(s => me().prog.mods[s.id])) addBadge(u, 'topic_'+topicId);
      updateChip(); openTopic(topicId);
    });
  }
  const cnv = $('vizCnv'), ctx = cnv.getContext('2d');
  const dpr = window.devicePixelRatio||1;
  cnv.width=600*dpr; cnv.height=380*dpr; ctx.scale(dpr,dpr);
  drawFn(cnv, ctx, 600, 380, $('vizCtrl'), $('vizInfo'));
}

// ═══════════════════════════════════════════════════════════════
// vizLogreg — Logistic Regression
// ═══════════════════════════════════════════════════════════════
_regViz('logreg', function(container, user, step) {
  const topic = TOPICS.find(t=>t.id==='logreg'), sub = topic.subtopics[step];
  _vizShell(container, 'logreg', sub.id, user, step, topic.subtopics.map(s=>s.title), (cnv, ctx, W, H, ctrl, info) => {
    const pts = [];
    for(let i=0;i<20;i++) pts.push({x:60+Math.random()*200,y:60+Math.random()*260,cls:0});
    for(let i=0;i<20;i++) pts.push({x:340+Math.random()*200,y:60+Math.random()*260,cls:1});
    let w1=0.02, w2=0, bias=-6;
    ctrl.innerHTML = `<div class="vizPanel"><div class="panelTitle">Controls</div>
      <div class="vizSlider"><label>w1</label><input type="range" id="lr_w1" min="-0.05" max="0.05" step="0.001" value="${w1}"><span class="sVal" id="lr_w1v">${w1}</span></div>
      <div class="vizSlider"><label>w2</label><input type="range" id="lr_w2" min="-0.05" max="0.05" step="0.001" value="${w2}"><span class="sVal" id="lr_w2v">${w2}</span></div>
      <div class="vizSlider"><label>bias</label><input type="range" id="lr_b" min="-10" max="10" step="0.1" value="${bias}"><span class="sVal" id="lr_bv">${bias}</span></div></div>
      <div class="vizPanel"><div class="panelTitle">Live Math</div><div id="lr_math" style="font-family:var(--mono);font-size:12px;white-space:pre-wrap"></div></div>`;
    function sigmoid(z){return 1/(1+Math.exp(-z));}
    function draw(){
      ctx.clearRect(0,0,W,H);
      for(let x=0;x<W;x+=3){const z=w1*x+w2*(H/2)+bias;const p=sigmoid(z);const r=Math.round(224*p+30*(1-p)),g=Math.round(122*p+158*(1-p)),b2=Math.round(95*p+158*(1-p));ctx.fillStyle=`rgba(${r},${g},${b2},0.08)`;ctx.fillRect(x,0,3,H);}
      const bx = -bias/w1;
      if(bx>0&&bx<W){ctx.beginPath();ctx.moveTo(bx,0);ctx.lineTo(bx,H);ctx.strokeStyle='rgba(255,255,255,.4)';ctx.lineWidth=2;ctx.setLineDash([6,4]);ctx.stroke();ctx.setLineDash([]);
        ctx.fillStyle='rgba(255,255,255,.5)';ctx.font='11px Inter,sans-serif';ctx.textAlign='center';ctx.fillText('boundary',bx,H-8);}
      pts.forEach(p=>{ctx.beginPath();ctx.arc(p.x,p.y,6,0,Math.PI*2);ctx.fillStyle=p.cls===0?'rgba(107,158,158,.85)':'rgba(224,122,95,.85)';ctx.fill();ctx.strokeStyle='rgba(255,255,255,.2)';ctx.lineWidth=1;ctx.stroke();});
      ctx.beginPath();for(let x=0;x<W;x++){const z=w1*x+bias;const y=H-sigmoid(z)*H;if(x===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.strokeStyle='rgba(224,122,95,.9)';ctx.lineWidth=3;ctx.stroke();
      $('lr_math').textContent=`z = w1*x + bias = ${w1.toFixed(3)}*x + ${bias.toFixed(1)}\nP(class=1) = sigmoid(z)\nBoundary at x = ${(-bias/w1).toFixed(0)}`;
    }
    ['lr_w1','lr_w2','lr_b'].forEach(id=>{$(id).addEventListener('input',()=>{
      w1=parseFloat($('lr_w1').value);w2=parseFloat($('lr_w2').value);bias=parseFloat($('lr_b').value);
      $('lr_w1v').textContent=w1.toFixed(3);$('lr_w2v').textContent=w2.toFixed(3);$('lr_bv').textContent=bias.toFixed(1);draw();
    });});
    const descs = ["Scatter: two classes of data. The model must learn where one ends and the other begins.",
      "The sigmoid S-curve squashes any value to 0-1 probability. Drag w1 to shift the curve.",
      "The dashed line is the decision boundary where P = 0.5. Move it with bias.",
      "Log loss penalizes confident wrong predictions. Points on the wrong side cost more."];
    info.innerHTML = `<b>Step ${step+1}:</b> ${descs[step]||descs[0]}`;
    draw();
    cnv.addEventListener('click', e=>{const r=cnv.getBoundingClientRect();const mx=(e.clientX-r.left)*(W/r.width),my=(e.clientY-r.top)*(H/r.height);pts.push({x:mx,y:my,cls:mx>W/2?1:0});draw();});
  });
});

// ═══════════════════════════════════════════════════════════════
// vizCNN — Convolutional Neural Net
// ═══════════════════════════════════════════════════════════════
_regViz('cnn', function(container, user, step) {
  const topic = TOPICS.find(t=>t.id==='cnn'), sub = topic.subtopics[step];
  _vizShell(container, 'cnn', sub.id, user, step, topic.subtopics.map(s=>s.title), (cnv, ctx, W, H, ctrl, info) => {
    const G=8, CS=32;
    let grid=Array.from({length:G},()=>Array.from({length:G},()=>Math.random()>.7?1:0));
    const filters={edge_h:[[1,1,1],[0,0,0],[-1,-1,-1]],edge_v:[[1,0,-1],[1,0,-1],[1,0,-1]],sharpen:[[0,-1,0],[-1,5,-1],[0,-1,0]],blur:[[1,1,1],[1,1,1],[1,1,1]]};
    let curFilter='edge_h', animPos=-1;
    ctrl.innerHTML=`<div class="vizPanel"><div class="panelTitle">Filter</div>
      <div class="vizBtnRow">${Object.keys(filters).map(k=>`<button class="btn sm ${k===curFilter?'primary':'ghost'}" data-f="${k}">${k.replace('_',' ')}</button>`).join('')}</div></div>
      <div class="vizPanel"><div class="panelTitle">Actions</div>
      <div class="vizBtnRow"><button class="btn primary sm" id="cnnSlide">Slide Filter</button><button class="btn ghost sm" id="cnnRand">Random</button><button class="btn ghost sm" id="cnnClear">Clear</button></div></div>
      <div class="vizPanel"><div class="panelTitle">Filter Values</div><div id="cnnFiltDisp" style="font-family:var(--mono);font-size:11px"></div></div>`;
    function convolve(){const f=filters[curFilter];const out=[];for(let r=0;r<=G-3;r++){out[r]=[];for(let c=0;c<=G-3;c++){let s=0;for(let fr=0;fr<3;fr++)for(let fc=0;fc<3;fc++)s+=grid[r+fr][c+fc]*f[fr][fc];out[r][c]=s;}}return out;}
    function draw(){
      ctx.clearRect(0,0,W,H);
      const ox=20,oy=30;
      ctx.fillStyle='rgba(200,195,185,.5)';ctx.font='bold 12px Inter,sans-serif';ctx.textAlign='center';
      ctx.fillText('Input (8x8)',ox+G*CS/2,oy-10);
      for(let r=0;r<G;r++)for(let c=0;c<G;c++){const v=grid[r][c];ctx.fillStyle=v?'rgba(224,122,95,.8)':'rgba(42,42,60,.8)';ctx.fillRect(ox+c*CS,oy+r*CS,CS-1,CS-1);}
      const fOx=ox+G*CS+40, fOy=oy+60;
      ctx.fillStyle='rgba(200,195,185,.5)';ctx.font='bold 12px Inter,sans-serif';ctx.textAlign='center';
      ctx.fillText('Filter (3x3)',fOx+1.5*CS,fOy-10);
      const f=filters[curFilter];
      for(let r=0;r<3;r++)for(let c=0;c<3;c++){const v=f[r][c];const bright=v>0?`rgba(107,158,158,${Math.min(1,v*0.3)})`:(v<0?`rgba(224,122,95,${Math.min(1,-v*0.3)})`:'rgba(42,42,60,.6)');ctx.fillStyle=bright;ctx.fillRect(fOx+c*CS,fOy+r*CS,CS-1,CS-1);ctx.fillStyle='rgba(255,255,255,.7)';ctx.font='10px monospace';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(v,fOx+c*CS+CS/2,fOy+r*CS+CS/2);ctx.textBaseline='alphabetic';}
      const outM=convolve(), oG=G-2, oCS=CS, oOx=20, oOy=oy+G*CS+50;
      ctx.fillStyle='rgba(200,195,185,.5)';ctx.font='bold 12px Inter,sans-serif';ctx.textAlign='center';
      ctx.fillText('Feature Map ('+oG+'x'+oG+')',oOx+oG*oCS/2,oOy-10);
      let mx=0;outM.forEach(r=>r.forEach(v=>{if(Math.abs(v)>mx)mx=Math.abs(v);}));if(mx===0)mx=1;
      for(let r=0;r<oG;r++)for(let c=0;c<oG;c++){const v=outM[r][c];const norm=v/mx;const bright=norm>0?`rgba(107,158,158,${norm*.8})`:`rgba(224,122,95,${-norm*.8})`;ctx.fillStyle=bright;ctx.fillRect(oOx+c*oCS,oOy+r*oCS,oCS-1,oCS-1);}
      if(animPos>=0){const ar=Math.floor(animPos/(G-2)),ac=animPos%(G-2);ctx.strokeStyle='rgba(224,122,95,.9)';ctx.lineWidth=2;ctx.strokeRect(ox+ac*CS-1,oy+ar*CS-1,3*CS+1,3*CS+1);}
      $('cnnFiltDisp').textContent=f.map(r=>r.map(v=>v>=0?' '+v:v).join(' ')).join('\n');
    }
    ctrl.querySelectorAll('[data-f]').forEach(b=>b.addEventListener('click',()=>{curFilter=b.dataset.f;ctrl.querySelectorAll('[data-f]').forEach(x=>x.className=x.dataset.f===curFilter?'btn sm primary':'btn sm ghost');draw();}));
    $('cnnSlide').addEventListener('click',()=>{animPos=0;const mx2=(G-2)*(G-2);const iv=setInterval(()=>{animPos++;draw();if(animPos>=mx2){clearInterval(iv);animPos=-1;draw();}},120);});
    $('cnnRand').addEventListener('click',()=>{grid=Array.from({length:G},()=>Array.from({length:G},()=>Math.random()>.5?1:0));draw();});
    $('cnnClear').addEventListener('click',()=>{grid=Array.from({length:G},()=>Array(G).fill(0));draw();});
    cnv.addEventListener('click',e=>{const r=cnv.getBoundingClientRect();const mx2=(e.clientX-r.left)*(W/r.width)-20,my=(e.clientY-r.top)*(H/r.height)-30;const gc=Math.floor(mx2/CS),gr=Math.floor(my/CS);if(gr>=0&&gr<G&&gc>=0&&gc<G){grid[gr][gc]=grid[gr][gc]?0:1;draw();}});
    const descs=["Click cells in the 8x8 grid to paint an image. This is raw pixel input.",
      "A 3x3 filter slides across the image, multiplying and summing at each position. Click Slide Filter!",
      "The feature map shows where the filter detected features. Try different filters!",
      "Real CNNs stack many filters: edges -> shapes -> objects. Each layer finds more complex patterns."];
    info.innerHTML=`<b>Step ${step+1}:</b> ${descs[step]||descs[0]}`;
    draw();
  });
});

// ═══════════════════════════════════════════════════════════════
// vizRNN — Recurrent Neural Net
// ═══════════════════════════════════════════════════════════════
_regViz('rnn', function(container, user, step) {
  const topic=TOPICS.find(t=>t.id==='rnn'), sub=topic.subtopics[step];
  _vizShell(container,'rnn',sub.id,user,step,topic.subtopics.map(s=>s.title),(cnv,ctx,W,H,ctrl,info)=>{
    let word="HELLO", cellIdx=-1, isLSTM=false;
    const nCells=5, cW=80, cH=60, startX=40, startY=100;
    let hiddenState=new Array(nCells).fill(0);
    ctrl.innerHTML=`<div class="vizPanel"><div class="panelTitle">Input</div>
      <input type="text" id="rnnWord" value="${word}" maxlength="8" style="width:100%;font-family:monospace;font-size:16px;padding:8px;border:none;border-radius:8px;background:var(--inset)">
      </div><div class="vizPanel"><div class="panelTitle">Controls</div>
      <div class="vizBtnRow"><button class="btn primary sm" id="rnnPlay">Play Sequence</button><button class="btn ghost sm" id="rnnReset">Reset</button></div>
      <div style="margin-top:8px"><label style="cursor:pointer;font-size:12px"><input type="checkbox" id="rnnLstm" ${isLSTM?'checked':''}> LSTM mode</label></div></div>
      <div class="vizPanel"><div class="panelTitle">Hidden State</div><div id="rnnBars" style="display:flex;gap:4px;height:60px;align-items:flex-end"></div></div>`;
    function drawBars(){const bars=$('rnnBars');bars.innerHTML=hiddenState.map((v,i)=>`<div style="flex:1;background:${i<=cellIdx?'var(--coral)':'var(--inset)'};height:${Math.max(5,Math.abs(v)*100)}%;border-radius:4px;transition:height .3s"></div>`).join('');}
    function draw(){
      ctx.clearRect(0,0,W,H);word=$('rnnWord').value.toUpperCase()||"HELLO";const gap2=20;
      for(let i=0;i<Math.min(word.length,nCells);i++){
        const x=startX+i*(cW+gap2), y=startY;
        ctx.fillStyle=i===cellIdx?'rgba(224,122,95,.3)':'rgba(107,158,158,.12)';ctx.beginPath();ctx.roundRect(x,y,cW,cH,10);ctx.fill();
        ctx.strokeStyle=i===cellIdx?'rgba(224,122,95,.8)':'rgba(107,158,158,.4)';ctx.lineWidth=2;ctx.stroke();
        ctx.fillStyle='#fff';ctx.font='bold 14px monospace';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(isLSTM?'LSTM':'RNN',x+cW/2,y+cH/2);ctx.textBaseline='alphabetic';
        ctx.fillStyle='rgba(224,122,95,.9)';ctx.font='bold 18px monospace';ctx.textAlign='center';ctx.fillText(word[i]||'',x+cW/2,y-16);
        if(i>0){ctx.beginPath();ctx.moveTo(x-gap2,y+cH/2);ctx.lineTo(x,y+cH/2);ctx.strokeStyle='rgba(224,122,95,.5)';ctx.lineWidth=2;ctx.stroke();
          ctx.beginPath();ctx.moveTo(x-4,y+cH/2-4);ctx.lineTo(x,y+cH/2);ctx.lineTo(x-4,y+cH/2+4);ctx.fillStyle='rgba(224,122,95,.5)';ctx.fill();}
        ctx.fillStyle='rgba(200,195,185,.5)';ctx.font='11px Inter,sans-serif';ctx.textAlign='center';ctx.fillText('h'+i,x+cW/2,y+cH+16);
        const outY=y+cH+40;ctx.fillStyle='rgba(107,158,158,.4)';ctx.beginPath();ctx.arc(x+cW/2,outY,12,0,Math.PI*2);ctx.fill();
        ctx.fillStyle='rgba(200,195,185,.6)';ctx.font='10px monospace';ctx.fillText(hiddenState[i].toFixed(1),x+cW/2,outY+4);
      }
      drawBars();
    }
    function playSeq(){cellIdx=-1;hiddenState.fill(0);word=$('rnnWord').value.toUpperCase()||"HELLO";const len=Math.min(word.length,nCells);let i=0;
      const iv=setInterval(()=>{cellIdx=i;const decay=isLSTM?0.95:0.5;hiddenState[i]=(i>0?hiddenState[i-1]*decay:0)+0.3+Math.random()*0.4;draw();i++;if(i>=len){clearInterval(iv);}},600);}
    $('rnnPlay').addEventListener('click',playSeq);
    $('rnnReset').addEventListener('click',()=>{cellIdx=-1;hiddenState.fill(0);draw();});
    $('rnnLstm').addEventListener('change',()=>{isLSTM=$('rnnLstm').checked;});
    const descs=["Characters flow through cells one at a time. Each cell processes input + previous hidden state.",
      "The hidden state carries memory forward. Watch the bars grow as more input is processed.",
      "In vanilla RNN, the hidden state decays rapidly. Toggle LSTM to see better memory retention.",
      "LSTM adds gates that control memory flow. The hidden state persists much longer with LSTM on."];
    info.innerHTML=`<b>Step ${step+1}:</b> ${descs[step]}`;
    draw();
  });
});

// ═══════════════════════════════════════════════════════════════
// vizRF — Random Forest
// ═══════════════════════════════════════════════════════════════
_regViz('rf', function(container, user, step) {
  const topic=TOPICS.find(t=>t.id==='rf'), sub=topic.subtopics[step];
  _vizShell(container,'rf',sub.id,user,step,topic.subtopics.map(s=>s.title),(cnv,ctx,W,H,ctrl,info)=>{
    let nTrees=5, trees=[], sample=null, votes=[0,0];
    function makeTree(){return{splits:Array.from({length:3},()=>({feat:Math.random()>.5?'x':'y',thresh:100+Math.random()*200})),pred:Math.random()>.5?1:0};}
    function initForest(){trees=Array.from({length:nTrees},makeTree);}initForest();
    function classify(t,s){let node=0;for(const sp of t.splits){if(s[sp.feat==='x'?0:1]>sp.thresh)node++;else break;}return(node+t.pred)%2;}
    ctrl.innerHTML=`<div class="vizPanel"><div class="panelTitle">Forest</div>
      <div class="vizSlider"><label>Trees</label><input type="range" id="rfN" min="1" max="9" step="2" value="${nTrees}"><span class="sVal" id="rfNv">${nTrees}</span></div>
      <div class="vizBtnRow" style="margin-top:8px"><button class="btn primary sm" id="rfSample">Classify Sample</button><button class="btn ghost sm" id="rfGrow">Regrow</button></div></div>
      <div class="vizPanel"><div class="panelTitle">Votes</div><div id="rfVotes" style="font-family:monospace;font-size:13px"></div></div>`;
    function draw(){
      ctx.clearRect(0,0,W,H);
      const tw=Math.min(100,W/(nTrees+1)),th=180,ty=30;
      trees.forEach((t,i)=>{
        const tx=20+i*(tw+10);
        ctx.fillStyle='rgba(107,158,158,.1)';ctx.beginPath();ctx.roundRect(tx,ty,tw,th,8);ctx.fill();
        ctx.strokeStyle='rgba(107,158,158,.3)';ctx.lineWidth=1;ctx.stroke();
        ctx.fillStyle='rgba(200,195,185,.6)';ctx.font='bold 10px Inter,sans-serif';ctx.textAlign='center';ctx.fillText('Tree '+(i+1),tx+tw/2,ty+14);
        for(let j=0;j<3;j++){const ny=ty+30+j*45,nx=tx+tw/2;ctx.beginPath();ctx.arc(nx,ny,10,0,Math.PI*2);ctx.fillStyle='rgba(224,122,95,.15)';ctx.fill();ctx.strokeStyle='rgba(224,122,95,.3)';ctx.lineWidth=1;ctx.stroke();if(j<2){ctx.beginPath();ctx.moveTo(nx,ny+10);ctx.lineTo(nx-12,ny+35);ctx.moveTo(nx,ny+10);ctx.lineTo(nx+12,ny+35);ctx.strokeStyle='rgba(200,195,185,.3)';ctx.lineWidth=1;ctx.stroke();}}
        if(sample){const pred=classify(t,sample);const py=ty+th+20;ctx.beginPath();ctx.arc(tx+tw/2,py,14,0,Math.PI*2);ctx.fillStyle=pred?'rgba(224,122,95,.6)':'rgba(107,158,158,.6)';ctx.fill();ctx.fillStyle='#fff';ctx.font='bold 11px Inter,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(pred?'B':'A',tx+tw/2,py);ctx.textBaseline='alphabetic';}
      });
      if(sample){const vy=H-50;ctx.fillStyle='rgba(200,195,185,.6)';ctx.font='bold 14px Inter,sans-serif';ctx.textAlign='center';ctx.fillText(`Final: A=${votes[0]} vs B=${votes[1]} => ${votes[0]>=votes[1]?'Class A':'Class B'}`,W/2,vy);
        $('rfVotes').textContent=`A: ${votes[0]} votes\nB: ${votes[1]} votes\nResult: ${votes[0]>=votes[1]?'A':'B'}`;}
    }
    $('rfN').addEventListener('input',()=>{nTrees=parseInt($('rfN').value);$('rfNv').textContent=nTrees;initForest();sample=null;draw();});
    $('rfSample').addEventListener('click',()=>{sample=[Math.random()*W,Math.random()*H];votes=[0,0];trees.forEach(t=>{const p=classify(t,sample);votes[p]++;});draw();});
    $('rfGrow').addEventListener('click',()=>{initForest();sample=null;draw();});
    const descs=["Each tree is trained on a random data subset. Click Classify to see them vote.",
      "Bagging: different data per tree means different perspectives. Disagreement = robustness.",
      "Feature randomness decorrelates trees, making the ensemble stronger than any single tree.",
      "Out-of-bag samples provide free error estimation without needing a separate test set."];
    info.innerHTML=`<b>Step ${step+1}:</b> ${descs[step]}`;draw();
  });
});

// ═══════════════════════════════════════════════════════════════
// vizSVM — Support Vector Machine
// ═══════════════════════════════════════════════════════════════
_regViz('svm', function(container, user, step) {
  const topic=TOPICS.find(t=>t.id==='svm'), sub=topic.subtopics[step];
  _vizShell(container,'svm',sub.id,user,step,topic.subtopics.map(s=>s.title),(cnv,ctx,W,H,ctrl,info)=>{
    const pts=[];
    for(let i=0;i<15;i++) pts.push({x:60+Math.random()*200,y:60+Math.random()*260,cls:0});
    for(let i=0;i<15;i++) pts.push({x:340+Math.random()*200,y:60+Math.random()*260,cls:1});
    let C=1.0, useRBF=false, margin=60;
    ctrl.innerHTML=`<div class="vizPanel"><div class="panelTitle">Parameters</div>
      <div class="vizSlider"><label>C</label><input type="range" id="svmC" min="0.1" max="5" step="0.1" value="${C}"><span class="sVal" id="svmCv">${C}</span></div>
      <div class="vizSlider"><label>Margin</label><input type="range" id="svmM" min="20" max="120" step="5" value="${margin}"><span class="sVal" id="svmMv">${margin}</span></div>
      <div style="margin-top:8px"><label style="cursor:pointer;font-size:12px"><input type="checkbox" id="svmRBF"> RBF Kernel</label></div></div>
      <div class="vizPanel"><div class="panelTitle">Support Vectors</div><div id="svmInfo2" style="font-family:monospace;font-size:12px"></div></div>`;
    function draw(){
      ctx.clearRect(0,0,W,H);const bx=W/2;
      if(useRBF){for(let x=0;x<W;x+=4)for(let y=0;y<H;y+=4){const d=Math.hypot(x-bx,y-H/2);const s=1/(1+Math.exp(-(d-120)/30));ctx.fillStyle=s>.5?'rgba(224,122,95,0.06)':'rgba(107,158,158,0.06)';ctx.fillRect(x,y,4,4);}}
      else{ctx.fillStyle='rgba(107,158,158,.06)';ctx.fillRect(0,0,bx-margin/2,H);ctx.fillStyle='rgba(224,122,95,.06)';ctx.fillRect(bx+margin/2,0,W-bx-margin/2,H);
        ctx.fillStyle='rgba(255,255,255,.04)';ctx.fillRect(bx-margin/2,0,margin,H);
        ctx.beginPath();ctx.moveTo(bx,0);ctx.lineTo(bx,H);ctx.strokeStyle='rgba(255,255,255,.5)';ctx.lineWidth=2;ctx.stroke();
        ctx.setLineDash([4,4]);ctx.beginPath();ctx.moveTo(bx-margin/2,0);ctx.lineTo(bx-margin/2,H);ctx.strokeStyle='rgba(107,158,158,.5)';ctx.stroke();
        ctx.beginPath();ctx.moveTo(bx+margin/2,0);ctx.lineTo(bx+margin/2,H);ctx.strokeStyle='rgba(224,122,95,.5)';ctx.stroke();ctx.setLineDash([]);}
      let svCount=0;
      pts.forEach(p=>{const inMargin=!useRBF&&Math.abs(p.x-bx)<margin/2+5;
        ctx.beginPath();ctx.arc(p.x,p.y,inMargin?8:6,0,Math.PI*2);ctx.fillStyle=p.cls===0?'rgba(107,158,158,.8)':'rgba(224,122,95,.8)';ctx.fill();
        if(inMargin){ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();svCount++;}else{ctx.strokeStyle='rgba(255,255,255,.15)';ctx.lineWidth=1;ctx.stroke();}});
      $('svmInfo2').textContent=`Support vectors: ${svCount}\nMargin: ${margin}px\nC = ${C.toFixed(1)} (${C<1?'soft':'hard'} margin)`;
    }
    $('svmC').addEventListener('input',()=>{C=parseFloat($('svmC').value);$('svmCv').textContent=C.toFixed(1);margin=Math.max(20,120-C*20);$('svmM').value=margin;$('svmMv').textContent=margin;draw();});
    $('svmM').addEventListener('input',()=>{margin=parseInt($('svmM').value);$('svmMv').textContent=margin;draw();});
    $('svmRBF').addEventListener('change',()=>{useRBF=$('svmRBF').checked;draw();});
    cnv.addEventListener('click',e=>{const r=cnv.getBoundingClientRect();const mx=(e.clientX-r.left)*(W/r.width),my=(e.clientY-r.top)*(H/r.height);pts.push({x:mx,y:my,cls:mx>W/2?1:0});draw();});
    const descs=["SVM finds the widest margin between classes. Wider margin = better generalization.",
      "Support vectors are the critical points on the margin edges. They alone define the boundary.",
      "Kernel trick maps data to higher dimensions. Toggle RBF to see a curved boundary.",
      "Soft margin (low C) allows some misclassification for a smoother overall boundary."];
    info.innerHTML=`<b>Step ${step+1}:</b> ${descs[step]}`;draw();
  });
});

// ═══════════════════════════════════════════════════════════════
// vizKMeans — K-Means Clustering
// ═══════════════════════════════════════════════════════════════
_regViz('kmeans', function(container, user, step) {
  const topic=TOPICS.find(t=>t.id==='kmeans'), sub=topic.subtopics[step];
  _vizShell(container,'kmeans',sub.id,user,step,topic.subtopics.map(s=>s.title),(cnv,ctx,W,H,ctrl,info)=>{
    const colors=['rgba(224,122,95,.7)','rgba(107,158,158,.7)','rgba(125,188,132,.7)','rgba(180,140,200,.7)','rgba(200,180,100,.7)'];
    const pts=[];for(let k=0;k<3;k++){const cx=100+k*200,cy=100+Math.random()*180;for(let i=0;i<20;i++)pts.push({x:cx+(Math.random()-.5)*160,y:cy+(Math.random()-.5)*140,c:-1});}
    let centroids=[], K=3, inertia=0, iters=0;
    ctrl.innerHTML=`<div class="vizPanel"><div class="panelTitle">Controls</div>
      <div class="vizSlider"><label>K</label><input type="range" id="kmK" min="2" max="5" value="${K}"><span class="sVal" id="kmKv">${K}</span></div>
      <div class="vizBtnRow" style="margin-top:8px"><button class="btn primary sm" id="kmStep">Step</button><button class="btn ghost sm" id="kmAuto">Auto</button><button class="btn ghost sm" id="kmReset">Reset</button></div></div>
      <div class="vizPanel"><div class="panelTitle">Metrics</div><div id="kmMet" style="font-family:monospace;font-size:12px"></div></div>`;
    function assign(){inertia=0;pts.forEach(p=>{let best=-1,bestD=Infinity;centroids.forEach((c,i)=>{const d=Math.hypot(p.x-c.x,p.y-c.y);if(d<bestD){bestD=d;best=i;}});p.c=best;inertia+=bestD*bestD;});}
    function update(){centroids.forEach((c,i)=>{const members=pts.filter(p=>p.c===i);if(members.length){c.x=members.reduce((s,p)=>s+p.x,0)/members.length;c.y=members.reduce((s,p)=>s+p.y,0)/members.length;}});}
    function draw(){
      ctx.clearRect(0,0,W,H);
      pts.forEach(p=>{ctx.beginPath();ctx.arc(p.x,p.y,5,0,Math.PI*2);ctx.fillStyle=p.c>=0?colors[p.c%5]:'rgba(200,195,185,.3)';ctx.fill();});
      centroids.forEach((c,i)=>{ctx.beginPath();ctx.arc(c.x,c.y,12,0,Math.PI*2);ctx.fillStyle=colors[i%5];ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
        ctx.fillStyle='#fff';ctx.font='bold 10px Inter,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('C'+(i+1),c.x,c.y);ctx.textBaseline='alphabetic';});
      $('kmMet').textContent=`K = ${K}\nIterations: ${iters}\nInertia: ${inertia.toFixed(0)}`;
    }
    cnv.addEventListener('click',e=>{if(centroids.length>=K)return;const r=cnv.getBoundingClientRect();centroids.push({x:(e.clientX-r.left)*(W/r.width),y:(e.clientY-r.top)*(H/r.height)});if(centroids.length===K){assign();iters=0;}draw();});
    $('kmStep').addEventListener('click',()=>{if(centroids.length<K){info.innerHTML='<b>Click canvas to place '+K+' centroids first!</b>';return;}assign();update();iters++;draw();});
    $('kmAuto').addEventListener('click',()=>{if(centroids.length<K)return;let n=0;const iv=setInterval(()=>{assign();update();iters++;draw();n++;if(n>=15)clearInterval(iv);},300);});
    $('kmReset').addEventListener('click',()=>{centroids=[];pts.forEach(p=>p.c=-1);iters=0;inertia=0;draw();});
    $('kmK').addEventListener('input',()=>{K=parseInt($('kmK').value);$('kmKv').textContent=K;centroids=[];pts.forEach(p=>p.c=-1);iters=0;draw();});
    const descs=["Click canvas to place K centroids. Points will be colored by nearest centroid.",
      "Click Step to run one iteration: assign points, then move centroids to the mean.",
      "Try different K. Lower K = fewer clusters. Use the elbow method: when does more K stop helping?",
      "K-Means assumes round clusters. Elongated or nested clusters break it."];
    info.innerHTML=`<b>Step ${step+1}:</b> ${descs[step]}`;draw();
  });
});

// ═══════════════════════════════════════════════════════════════
// vizPCA — PCA
// ═══════════════════════════════════════════════════════════════
_regViz('pca', function(container, user, step) {
  const topic=TOPICS.find(t=>t.id==='pca'), sub=topic.subtopics[step];
  _vizShell(container,'pca',sub.id,user,step,topic.subtopics.map(s=>s.title),(cnv,ctx,W,H,ctrl,info)=>{
    const pts=[];const angle=Math.PI/4,spread=120,narrow=30;
    for(let i=0;i<60;i++){const along=(Math.random()-.5)*spread*2,across=(Math.random()-.5)*narrow*2;pts.push({ox:W/2+along*Math.cos(angle)-across*Math.sin(angle),oy:H/2+along*Math.sin(angle)+across*Math.cos(angle)});}
    ctrl.innerHTML=`<div class="vizPanel"><div class="panelTitle">Projection</div>
      <div class="vizSlider"><label>Project</label><input type="range" id="pcaP" min="0" max="100" value="0"><span class="sVal" id="pcaPv">0%</span></div>
      <div class="sub" style="margin-top:6px">Slide to project onto PC1</div></div>
      <div class="vizPanel"><div class="panelTitle">Variance</div><div id="pcaVar" style="font-family:monospace;font-size:12px"></div></div>`;
    function draw(){
      ctx.clearRect(0,0,W,H);const proj=parseInt($('pcaP').value)/100;
      ctx.beginPath();ctx.moveTo(W/2-200*Math.cos(angle),H/2-200*Math.sin(angle));ctx.lineTo(W/2+200*Math.cos(angle),H/2+200*Math.sin(angle));ctx.strokeStyle='rgba(224,122,95,.6)';ctx.lineWidth=2;ctx.stroke();
      ctx.fillStyle='rgba(224,122,95,.5)';ctx.font='bold 11px Inter,sans-serif';ctx.textAlign='left';ctx.fillText('PC1',W/2+200*Math.cos(angle)+5,H/2+200*Math.sin(angle));
      if(proj<0.9){ctx.beginPath();ctx.moveTo(W/2-80*Math.cos(angle+Math.PI/2),H/2-80*Math.sin(angle+Math.PI/2));ctx.lineTo(W/2+80*Math.cos(angle+Math.PI/2),H/2+80*Math.sin(angle+Math.PI/2));ctx.strokeStyle=`rgba(107,158,158,${.5*(1-proj)})`;ctx.lineWidth=1.5;ctx.stroke();ctx.fillStyle=`rgba(107,158,158,${.5*(1-proj)})`;ctx.fillText('PC2',W/2+80*Math.cos(angle+Math.PI/2)+5,H/2+80*Math.sin(angle+Math.PI/2));}
      pts.forEach(p=>{const dx=p.ox-W/2,dy=p.oy-H/2;const dot=dx*Math.cos(angle)+dy*Math.sin(angle);const projX=W/2+dot*Math.cos(angle),projY=H/2+dot*Math.sin(angle);const px=lerp(p.ox,projX,proj),py=lerp(p.oy,projY,proj);
        ctx.beginPath();ctx.arc(px,py,4,0,Math.PI*2);ctx.fillStyle='rgba(107,158,158,.7)';ctx.fill();});
      $('pcaPv').textContent=Math.round(proj*100)+'%';$('pcaVar').textContent=`PC1: ~85% variance\nPC2: ~15% variance\n${proj>0.5?'Projected to 1D — most info kept!':'Full 2D view'}`;
    }
    $('pcaP').addEventListener('input',draw);
    cnv.addEventListener('click',e=>{const r=cnv.getBoundingClientRect();pts.push({ox:(e.clientX-r.left)*(W/r.width),oy:(e.clientY-r.top)*(H/r.height)});draw();});
    const descs=["A cloud of correlated data stretched along a diagonal. The variance is concentrated there.",
      "PC1 (red) points along max variance. PC2 is perpendicular. Together they explain everything.",
      "Eigenvalues measure each PC's share. PC1 here captures ~85% of the information.",
      "Slide to project 2D data onto PC1. Watch points collapse onto the line — dimension reduction!"];
    info.innerHTML=`<b>Step ${step+1}:</b> ${descs[step]}`;draw();
  });
});

// ═══════════════════════════════════════════════════════════════
// vizNaive — Naive Bayes: spam classifier
// ═══════════════════════════════════════════════════════════════
_regViz('naive', function(container, user, step) {
  const topic=TOPICS.find(t=>t.id==='naive'), sub=topic.subtopics[step];
  _vizShell(container,'naive',sub.id,user,step,topic.subtopics.map(s=>s.title),(cnv,ctx,W,H,ctrl,info)=>{
    const wordProbs={free:[.8,.1],win:[.7,.15],money:[.75,.1],click:[.6,.2],hello:[.1,.5],meeting:[.05,.4],report:[.08,.35],lunch:[.05,.3],urgent:[.5,.15],deal:[.6,.1]};
    let msg="Free money win click now", prior=0.3;
    ctrl.innerHTML=`<div class="vizPanel"><div class="panelTitle">Email</div>
      <input type="text" id="nbMsg" value="${msg}" style="width:100%;font-family:monospace;font-size:13px;padding:8px;border:none;border-radius:8px;background:var(--inset)">
      <button class="btn primary sm" id="nbClassify" style="margin-top:8px;width:100%">Classify</button></div>
      <div class="vizPanel"><div class="panelTitle">Prior P(spam)</div>
      <div class="vizSlider"><label>Prior</label><input type="range" id="nbPrior" min="0.1" max="0.9" step="0.05" value="${prior}"><span class="sVal" id="nbPv">${prior}</span></div></div>
      <div class="vizPanel"><div class="panelTitle">Result</div><div id="nbRes" style="font-family:monospace;font-size:12px">Click Classify</div></div>`;
    function draw(){
      ctx.clearRect(0,0,W,H);msg=$('nbMsg').value;const words=msg.toLowerCase().split(/\s+/).filter(w=>w.length>0);
      ctx.fillStyle='rgba(200,195,185,.5)';ctx.font='bold 13px Inter,sans-serif';ctx.textAlign='center';
      ctx.fillText('Word Probabilities: P(word|spam) vs P(word|ham)',W/2,25);
      const bw=Math.min(200,W/2-40),bh=20,startY=45;
      words.forEach((w,i)=>{const y=startY+i*(bh+18);const pr=wordProbs[w]||[0.3,0.3];
        ctx.fillStyle='rgba(200,195,185,.6)';ctx.font='12px monospace';ctx.textAlign='left';ctx.fillText(w,20,y+14);
        ctx.fillStyle='rgba(224,122,95,.15)';ctx.fillRect(100,y,bw,bh/2);ctx.fillStyle='rgba(224,122,95,.7)';ctx.fillRect(100,y,bw*pr[0],bh/2);
        ctx.fillStyle='rgba(107,158,158,.15)';ctx.fillRect(100,y+bh/2+2,bw,bh/2);ctx.fillStyle='rgba(107,158,158,.7)';ctx.fillRect(100,y+bh/2+2,bw*pr[1],bh/2);
        ctx.fillStyle='rgba(200,195,185,.5)';ctx.font='10px monospace';ctx.textAlign='left';ctx.fillText('spam: '+(pr[0]*100).toFixed(0)+'%',100+bw+8,y+8);ctx.fillText('ham: '+(pr[1]*100).toFixed(0)+'%',100+bw+8,y+bh/2+10);
      });
    }
    $('nbClassify').addEventListener('click',()=>{
      msg=$('nbMsg').value;prior=parseFloat($('nbPrior').value);const words=msg.toLowerCase().split(/\s+/).filter(w=>w.length>0);
      let logSpam=Math.log(prior),logHam=Math.log(1-prior);
      words.forEach(w=>{const pr=wordProbs[w]||[0.3,0.3];logSpam+=Math.log(pr[0]+.01);logHam+=Math.log(pr[1]+.01);});
      const pSpam=Math.exp(logSpam),pHam=Math.exp(logHam),posterior=pSpam/(pSpam+pHam);
      $('nbRes').textContent=`P(spam|words) = ${(posterior*100).toFixed(1)}%\nP(ham|words) = ${((1-posterior)*100).toFixed(1)}%\nVerdict: ${posterior>.5?'SPAM':'HAM'}`;
      draw();
    });
    $('nbPrior').addEventListener('input',()=>{prior=parseFloat($('nbPrior').value);$('nbPv').textContent=prior.toFixed(2);});
    const descs=["Each word is evidence. Bayes updates our belief about spam vs ham.",
      "Naive = treat words independently. Multiply each word's probability for the final score.",
      "Type an email and Classify. Watch how spammy words shift the probability.",
      "Unseen words get a small smoothed probability so they don't zero out the calculation."];
    info.innerHTML=`<b>Step ${step+1}:</b> ${descs[step]}`;draw();
  });
});

// ═══════════════════════════════════════════════════════════════
// vizGradient — Gradient Descent
// ═══════════════════════════════════════════════════════════════
_regViz('gradient', function(container, user, step) {
  const topic=TOPICS.find(t=>t.id==='gradient'), sub=topic.subtopics[step];
  _vizShell(container,'gradient',sub.id,user,step,topic.subtopics.map(s=>s.title),(cnv,ctx,W,H,ctrl,info)=>{
    function loss(x,y){return 3+Math.sin(x*0.02)*2+Math.cos(y*0.025)*1.5+(x-W/2)**2*0.00005+(y-H/2)**2*0.00005;}
    let ballX=80,ballY=80,lr=0.3,path=[];
    ctrl.innerHTML=`<div class="vizPanel"><div class="panelTitle">Controls</div>
      <div class="vizSlider"><label>LR</label><input type="range" id="gdLR" min="0.05" max="2" step="0.05" value="${lr}"><span class="sVal" id="gdLRv">${lr}</span></div>
      <div class="vizBtnRow" style="margin-top:8px"><button class="btn primary sm" id="gdStep">Step</button><button class="btn ghost sm" id="gdAuto">Auto (20)</button><button class="btn ghost sm" id="gdReset">Reset</button></div></div>
      <div class="vizPanel"><div class="panelTitle">Loss</div><div id="gdLoss" style="font-family:monospace;font-size:13px"></div></div>`;
    function draw(){
      ctx.clearRect(0,0,W,H);
      for(let x=0;x<W;x+=4)for(let y=0;y<H;y+=4){const l=loss(x,y);const norm=clamp((l-1)/6,0,1);ctx.fillStyle=`rgba(${Math.round(42+norm*50)},${Math.round(42+norm*20)},${Math.round(60+norm*30)},1)`;ctx.fillRect(x,y,4,4);}
      for(let l=1;l<8;l+=0.5){ctx.beginPath();for(let x=0;x<W;x++){for(let y=0;y<H;y++){if(Math.abs(loss(x,y)-l)<0.05){ctx.rect(x,y,1,1);}}}ctx.fillStyle='rgba(200,195,185,.15)';ctx.fill();}
      if(path.length>1){ctx.beginPath();ctx.moveTo(path[0].x,path[0].y);path.forEach(p=>ctx.lineTo(p.x,p.y));ctx.strokeStyle='rgba(224,122,95,.6)';ctx.lineWidth=2;ctx.stroke();}
      ctx.beginPath();ctx.arc(ballX,ballY,8,0,Math.PI*2);ctx.fillStyle='rgba(224,122,95,.9)';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
      const dx=(loss(ballX+1,ballY)-loss(ballX-1,ballY))/2,dy=(loss(ballX,ballY+1)-loss(ballX,ballY-1))/2;
      ctx.beginPath();ctx.moveTo(ballX,ballY);ctx.lineTo(ballX-dx*40,ballY-dy*40);ctx.strokeStyle='rgba(107,255,184,.6)';ctx.lineWidth=2;ctx.stroke();
      $('gdLoss').textContent=`Loss: ${loss(ballX,ballY).toFixed(3)}\nPos: (${ballX.toFixed(0)}, ${ballY.toFixed(0)})\nGrad: (${dx.toFixed(3)}, ${dy.toFixed(3)})`;
    }
    function doStep(){const dx=(loss(ballX+1,ballY)-loss(ballX-1,ballY))/2,dy=(loss(ballX,ballY+1)-loss(ballX,ballY-1))/2;ballX=clamp(ballX-lr*dx*50,10,W-10);ballY=clamp(ballY-lr*dy*50,10,H-10);path.push({x:ballX,y:ballY});draw();}
    $('gdStep').addEventListener('click',doStep);
    $('gdAuto').addEventListener('click',()=>{let n=0;const iv=setInterval(()=>{doStep();n++;if(n>=20)clearInterval(iv);},150);});
    $('gdReset').addEventListener('click',()=>{ballX=80;ballY=80;path=[{x:ballX,y:ballY}];draw();});
    $('gdLR').addEventListener('input',()=>{lr=parseFloat($('gdLR').value);$('gdLRv').textContent=lr.toFixed(2);});
    cnv.addEventListener('click',e=>{const r=cnv.getBoundingClientRect();ballX=(e.clientX-r.left)*(W/r.width);ballY=(e.clientY-r.top)*(H/r.height);path=[{x:ballX,y:ballY}];draw();});
    const descs=["The background is a loss landscape (darker = lower loss). The ball seeks the valley.",
      "Green arrow = gradient (steepest descent). LR controls step size. Try extreme values!",
      "Click to place the ball. Auto-run or step manually. Too-high LR = overshoot!",
      "Momentum and Adam are smarter: they remember past gradients and adapt step sizes."];
    info.innerHTML=`<b>Step ${step+1}:</b> ${descs[step]}`;path=[{x:ballX,y:ballY}];draw();
  });
});

// ═══════════════════════════════════════════════════════════════
// vizNLP — NLP Fundamentals
// ═══════════════════════════════════════════════════════════════
_regViz('nlp', function(container, user, step) {
  const topic=TOPICS.find(t=>t.id==='nlp'), sub=topic.subtopics[step];
  _vizShell(container,'nlp',sub.id,user,step,topic.subtopics.map(s=>s.title),(cnv,ctx,W,H,ctrl,info)=>{
    let sentence="The cat sat on the mat";
    ctrl.innerHTML=`<div class="vizPanel"><div class="panelTitle">Sentence</div>
      <input type="text" id="nlpSent" value="${sentence}" style="width:100%;font-family:monospace;font-size:13px;padding:8px;border:none;border-radius:8px;background:var(--inset)">
      <button class="btn primary sm" id="nlpProcess" style="margin-top:8px;width:100%">Process</button></div>
      <div class="vizPanel"><div class="panelTitle">View</div>
      <div class="vizBtnRow"><button class="btn sm primary" id="nlpTok">Tokens</button><button class="btn sm ghost" id="nlpEmb">Embeddings</button><button class="btn sm ghost" id="nlpAtt">Attention</button></div></div>`;
    let viewMode='tokens';
    function pseudoEmbed(w){const h=Array.from(w).reduce((s,c)=>s+c.charCodeAt(0),0);return Array.from({length:8},(_,i)=>Math.sin(h*(i+1)*0.1)*0.5+0.5);}
    function draw(){
      ctx.clearRect(0,0,W,H);const tokens=$('nlpSent').value.split(/\s+/).filter(w=>w.length>0);const tw=Math.min(80,(W-40)/tokens.length);const startX=20,startY=60;
      ctx.fillStyle='rgba(200,195,185,.6)';ctx.font='bold 12px Inter,sans-serif';ctx.textAlign='center';
      if(viewMode==='tokens'){
        ctx.fillText('Tokenization Pipeline',W/2,25);
        ctx.fillStyle='rgba(200,195,185,.3)';ctx.font='12px monospace';ctx.textAlign='left';ctx.fillText('Raw: "'+$('nlpSent').value+'"',20,50);
        tokens.forEach((t,i)=>{const x=startX+i*(tw+8),y=startY+40;ctx.fillStyle='rgba(224,122,95,.15)';ctx.beginPath();ctx.roundRect(x,y,tw,36,8);ctx.fill();ctx.strokeStyle='rgba(224,122,95,.4)';ctx.lineWidth=1;ctx.stroke();
          ctx.fillStyle='#fff';ctx.font='bold 12px monospace';ctx.textAlign='center';ctx.fillText(t,x+tw/2,y+22);
          ctx.fillStyle='rgba(200,195,185,.4)';ctx.font='9px monospace';ctx.fillText('id:'+(Array.from(t).reduce((s,c)=>s+c.charCodeAt(0),0)%1000),x+tw/2,y+46);});
      } else if(viewMode==='embeddings'){
        ctx.fillText('Word Embeddings (8-dim vectors)',W/2,25);
        tokens.forEach((t,i)=>{const x=startX+i*(tw+8),y=startY+10;const emb=pseudoEmbed(t);
          ctx.fillStyle='rgba(200,195,185,.5)';ctx.font='10px monospace';ctx.textAlign='center';ctx.fillText(t,x+tw/2,y);
          emb.forEach((v,j)=>{const by=y+14+j*20,bw2=tw*v;ctx.fillStyle=`rgba(${Math.round(107+117*v)},${Math.round(158-36*v)},${Math.round(158-63*v)},.6)`;ctx.fillRect(x,by,bw2,16);});
        });
      } else {
        ctx.fillText('Self-Attention Map',W/2,25);
        const cy=startY+50;
        tokens.forEach((t,i)=>{const x=startX+i*(tw+8)+tw/2;ctx.fillStyle='rgba(224,122,95,.15)';ctx.beginPath();ctx.arc(x,cy,18,0,Math.PI*2);ctx.fill();ctx.strokeStyle='rgba(224,122,95,.4)';ctx.lineWidth=1;ctx.stroke();
          ctx.fillStyle='#fff';ctx.font='bold 10px monospace';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(t,x,cy);ctx.textBaseline='alphabetic';});
        tokens.forEach((_,i)=>{tokens.forEach((_2,j)=>{if(i!==j){const x1=startX+i*(tw+8)+tw/2,x2=startX+j*(tw+8)+tw/2;const strength=Math.random()*0.5+0.1;
          ctx.beginPath();ctx.moveTo(x1,cy+20);const cpY=cy+40+Math.abs(i-j)*15;ctx.quadraticCurveTo((x1+x2)/2,cpY,x2,cy+20);ctx.strokeStyle=`rgba(107,158,158,${strength})`;ctx.lineWidth=strength*4;ctx.stroke();}});});
      }
    }
    $('nlpProcess').addEventListener('click',draw);
    ['nlpTok','nlpEmb','nlpAtt'].forEach(id=>{$(id).addEventListener('click',()=>{viewMode=id==='nlpTok'?'tokens':id==='nlpEmb'?'embeddings':'attention';ctrl.querySelectorAll('.vizBtnRow .btn').forEach((b,i)=>b.className='btn sm '+((['nlpTok','nlpEmb','nlpAtt'][i]===id)?'primary':'ghost'));draw();});});
    const descs=["Type a sentence and Process. Watch it split into tokens with numerical IDs.",
      "Each token becomes an 8-dim vector (embedding). Similar words get similar colored bars.",
      "Self-attention: each word looks at all others. Line thickness = attention strength.",
      "GPT stacks many attention layers. Each refines understanding further."];
    info.innerHTML=`<b>Step ${step+1}:</b> ${descs[step]}`;draw();
  });
});

// ═══════════════════════════════════════════════════════════════
// vizRL — Reinforcement Learning: grid world
// ═══════════════════════════════════════════════════════════════
_regViz('rl', function(container, user, step) {
  const topic=TOPICS.find(t=>t.id==='rl'), sub=topic.subtopics[step];
  _vizShell(container,'rl',sub.id,user,step,topic.subtopics.map(s=>s.title),(cnv,ctx,W,H,ctrl,info)=>{
    const GS=5, CS2=Math.min(60,Math.floor((W-40)/GS));
    let grid2=Array.from({length:GS},()=>Array(GS).fill(0));
    grid2[0][0]=2; grid2[GS-1][GS-1]=3; grid2[1][1]=1;grid2[2][3]=1;grid2[3][1]=1;
    let agentR=0,agentC=0,eps=0.3,episodes=0,totalReward=0;
    const Q=Array.from({length:GS},()=>Array.from({length:GS},()=>[0,0,0,0]));
    const dirs=[[0,-1],[0,1],[-1,0],[1,0]],dNames=['L','R','U','D'];
    ctrl.innerHTML=`<div class="vizPanel"><div class="panelTitle">Controls</div>
      <div class="vizSlider"><label>Epsilon</label><input type="range" id="rlEps" min="0.05" max="0.9" step="0.05" value="${eps}"><span class="sVal" id="rlEv">${eps}</span></div>
      <div class="vizBtnRow" style="margin-top:8px"><button class="btn primary sm" id="rlTrain">Train (50 ep)</button><button class="btn ghost sm" id="rlStep">Step</button><button class="btn ghost sm" id="rlReset">Reset</button></div></div>
      <div class="vizPanel"><div class="panelTitle">Stats</div><div id="rlStats" style="font-family:monospace;font-size:12px"></div></div>`;
    function reward(r,c){if(r<0||r>=GS||c<0||c>=GS)return{r:-1,valid:false};if(grid2[r][c]===1)return{r:-1,valid:false};if(grid2[r][c]===3)return{r:10,valid:true};return{r:-0.1,valid:true};}
    function bestAction(r,c){let best=0;Q[r][c].forEach((v,i)=>{if(v>Q[r][c][best])best=i;});return best;}
    function doStepRL(){
      const a=Math.random()<eps?Math.floor(Math.random()*4):bestAction(agentR,agentC);
      const nr=agentR+dirs[a][0],nc=agentC+dirs[a][1];const rw=reward(nr,nc);
      if(rw.valid){const maxNext=Math.max(...Q[nr][nc]);Q[agentR][agentC][a]+=0.5*(rw.r+0.9*maxNext-Q[agentR][agentC][a]);agentR=nr;agentC=nc;totalReward+=rw.r;}
      if(grid2[agentR][agentC]===3){agentR=0;agentC=0;episodes++;return true;}return false;
    }
    function draw(){
      ctx.clearRect(0,0,W,H);const ox=20,oy=20;
      for(let r=0;r<GS;r++)for(let c=0;c<GS;c++){const x=ox+c*CS2,y=oy+r*CS2;
        const maxQ=Math.max(...Q[r][c]);const qNorm=maxQ>0?clamp(maxQ/10,0,1):0;
        ctx.fillStyle=grid2[r][c]===1?'rgba(60,60,80,.9)':grid2[r][c]===3?'rgba(125,188,132,.3)':`rgba(224,122,95,${qNorm*0.3})`;ctx.fillRect(x,y,CS2-2,CS2-2);
        ctx.strokeStyle='rgba(255,255,255,.08)';ctx.lineWidth=1;ctx.strokeRect(x,y,CS2-2,CS2-2);
        if(grid2[r][c]===3){ctx.fillStyle='rgba(125,188,132,.8)';ctx.font='bold 16px Inter,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('\u2605',x+CS2/2-1,y+CS2/2);ctx.textBaseline='alphabetic';}
        if(grid2[r][c]===1){ctx.fillStyle='rgba(200,195,185,.3)';ctx.font='12px Inter,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('\u25AC',x+CS2/2-1,y+CS2/2);ctx.textBaseline='alphabetic';}
        if(maxQ>0.1){const ba=bestAction(r,c);ctx.fillStyle='rgba(224,122,95,.5)';ctx.font='bold 9px monospace';ctx.textAlign='center';ctx.fillText(dNames[ba],x+CS2/2-1,y+CS2-6);}
      }
      ctx.beginPath();ctx.arc(ox+agentC*CS2+CS2/2-1,oy+agentR*CS2+CS2/2-1,CS2/3,0,Math.PI*2);ctx.fillStyle='rgba(224,122,95,.9)';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
      $('rlStats').textContent=`Episodes: ${episodes}\nReward: ${totalReward.toFixed(1)}\nEpsilon: ${eps}`;
    }
    $('rlTrain').addEventListener('click',()=>{let ep=0;const iv=setInterval(()=>{for(let s=0;s<50;s++){if(doStepRL()){ep++;break;}}draw();if(ep>=50)clearInterval(iv);},50);});
    $('rlStep').addEventListener('click',()=>{doStepRL();draw();});
    $('rlReset').addEventListener('click',()=>{agentR=0;agentC=0;episodes=0;totalReward=0;Q.forEach(r=>r.forEach(c=>c.fill(0)));draw();});
    $('rlEps').addEventListener('input',()=>{eps=parseFloat($('rlEps').value);$('rlEv').textContent=eps.toFixed(2);});
    const descs=["Agent (circle) navigates a grid. Star = goal (+10). Dark cells = walls. Each step = -0.1.",
      "Rewards guide learning. Click Train to watch the agent explore and build Q-values over episodes.",
      "Epsilon: high = explore randomly, low = exploit learned policy. Find the sweet spot!",
      "Q-Learning: Q(s,a) = reward + discounted future. The letters show the best action per cell."];
    info.innerHTML=`<b>Step ${step+1}:</b> ${descs[step]}`;draw();
  });
});

// ═══════════════════════════════════════════════════════════════
// Upgrade existing topics' subtopics 1-3 (linreg, perceptron, nn, dtree, knn)
// ═══════════════════════════════════════════════════════════════
function _vizExistingStep(topicId, step, container, user) {
  const topic = TOPICS.find(t=>t.id===topicId), sub = topic.subtopics[step];
  const steps = topic.subtopics.map(s=>s.title);
  const isDone = !!user.prog.mods[sub.id];
  container.innerHTML = `
    <button class="btn sm ghost" onclick="openTopic('${topicId}')" style="margin-bottom:10px">&larr; ${esc(topic.title)}</button>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
      <span style="font-size:28px">${topic.icon}</span>
      <div><div class="sub">${esc(topic.title)}</div><h2 style="margin:0">${esc(sub.title)}</h2></div>
    </div>
    <div class="vizSteps">${steps.map((s,i)=>`<button class="vizStep ${i===step?'active':''}" data-vi="${i}">${s}</button>`).join('')}</div>
    <div class="vizDesc" id="exDesc" style="margin:12px 0"></div>
    <div class="vizBtnRow">
      <button class="btn primary" id="exGoViz">Open Full Visualizer</button>
      ${isDone?'<span class="pill pillGlow">Completed</span>':'<button class="btn ghost sm" id="exDone">Mark Complete (+25 pts)</button>'}
    </div>`;
  container.querySelectorAll('.vizStep').forEach(b=>{
    b.addEventListener('click',()=>{
      const idx=parseInt(b.dataset.vi);
      openLesson(topicId, topic.subtopics[idx].id);
    });
  });
  $('exGoViz').addEventListener('click',()=>goView(topicId));
  if(!isDone && $('exDone')){
    $('exDone').addEventListener('click',()=>{
      let u=me();if(!u)return;
      u.prog={...u.prog,mods:{...u.prog.mods,[sub.id]:nowISO()}};save(u);
      addPts(u,25,'lesson_'+sub.id);updateChip();openTopic(topicId);
    });
  }
}

const _existingDescs = {
  linreg: ["Regression predicts continuous numbers \u2014 prices, temperatures, scores. It draws the best mathematical relationship from data.",
    "The best-fit line minimizes total error by finding the optimal slope and intercept.",
    "MSE measures how wrong predictions are. Squaring penalizes big errors more than small ones."],
  perceptron: ["An artificial neuron takes inputs, multiplies each by a weight, sums them, and passes through an activation function.",
    "Weights are volume knobs controlling how much each input matters. Bias shifts the threshold.",
    "Activation functions add non-linearity. Without them, networks can only learn straight-line relationships."],
  nn: ["Networks organize neurons in layers: input receives data, hidden layers transform it, output gives predictions.",
    "The forward pass flows data through each layer: multiply by weights, add bias, apply activation.",
    "Backpropagation works backwards from the error, computing how much each weight contributed, then nudging weights."],
  dtree: ["Decision trees ask yes/no questions about features, splitting data at each node until leaves give predictions.",
    "Information gain measures which question best separates classes. The tree picks the best split greedily.",
    "Overfitting: trees can memorize training data. Pruning cuts unnecessary branches for better generalization."],
  knn: ["KNN classifies by finding the K closest points and taking a majority vote. No training needed.",
    "Small K = complex boundary (noisy). Large K = smooth boundary. Odd K avoids ties.",
    "In high dimensions, all points become equally distant. KNN struggles because 'nearest' loses meaning."],
};

['linreg','perceptron','nn','dtree','knn'].forEach(tid=>{
  const topic = TOPICS.find(t=>t.id===tid);
  topic.subtopics.slice(0,3).forEach((sub,i)=>{
    INTERACTIVE_LESSONS[sub.id] = (container, user) => {
      _vizExistingStep(tid, i, container, user);
      const desc = $('exDesc');
      if(desc) desc.innerHTML = `<b>${esc(sub.title)}:</b> ${_existingDescs[tid]?.[i]||sub.desc}`;
    };
  });
});

// ═══════════════════════════════════════════════════════════════
// renderLesson — calls INTERACTIVE_LESSONS or falls back
// ═══════════════════════════════════════════════════════════════
function renderLesson(topicId, subtopicId, user) {
  const root = $("v_lesson");
  const interactiveFn = INTERACTIVE_LESSONS[subtopicId];
  if (interactiveFn) {
    interactiveFn(root, user);
    return;
  }
  const topic = TOPICS.find(t => t.id === topicId);
  const sub = topic?.subtopics.find(s => s.id === subtopicId);
  if (!topic || !sub) return;
  const isDone = !!user.prog.mods[subtopicId];
  root.innerHTML = `
    <button class="btn sm ghost" onclick="openTopic('${topicId}')" style="margin-bottom:12px">&larr; ${esc(topic.title)}</button>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
      <span style="font-size:28px">${topic.icon}</span>
      <div><div class="sub">${esc(topic.title)}</div><h2 style="margin:0">${esc(sub.title)}</h2></div>
    </div>
    <div class="vizDesc">${esc(sub.desc)}</div>
    <div style="margin-top:20px">${isDone
      ? '<span class="pill pillGlow">Completed</span>'
      : '<button class="btn primary" id="markDoneBtn">Mark Complete (+25 pts)</button>'}</div>`;
  if (!isDone) {
    $("markDoneBtn").addEventListener("click", () => {
      let u = me(); if (!u) return;
      u.prog = {...u.prog, mods:{...u.prog.mods, [subtopicId]: nowISO()}};
      save(u); addPts(u, 25, 'lesson_'+subtopicId);
      if (topic.subtopics.every(s => me().prog.mods[s.id])) addBadge(u, 'topic_'+topicId);
      updateChip(); openTopic(topicId);
    });
  }
}

