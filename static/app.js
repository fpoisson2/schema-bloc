// Minimal vanilla JS UI + SVG board interactions
// Features: draw cards, add/move blocks, energy/signal links, double-click edit,
// grid snap, save/load via API, export PNG and print-to-PDF.

(function(){
  const $ = (sel, el=document) => el.querySelector(sel);
  const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));

  const state = {
    deck: null,
    puzzles: [],
    puzzle: null, // selected puzzle object
    roomId: null,
    team: "",
    mode: 'puzzle', // 'puzzle' | 'draw'
    ranked: false,
    grid: true,
    drawn: { cards: [], alea: null, proposals: [], chosenIndex: null },
    board: { blocks: [], links: [] },
  };

  // Views
  const viewHome = $('#view-home');
  const viewBoard = $('#view-board');
  const roomIndicator = $('#room-indicator');
  const teamDisplay = $('#team-display');
  const teamInput = $('#team-name');
  function teamInputValue(){ try{ return (teamInput && teamInput.value && teamInput.value.trim()) || ''; }catch{ return ''; } }
  const joinCode = $('#join-code');
  const aleaDisplay = $('#alea-display');
  const drawnCardsEl = $('#drawn-cards');
  const drawProposalsEl = $('#draw-proposals');
  const aleaNotes = $('#alea-notes');
  const toggleGrid = $('#toggle-grid');
  const drawCount = $('#draw-count');
  const drawSequences = $('#draw-sequences');
  const boardTitle = $('#board-title');
  // Puzzles UI
  const puzzleSelect = $('#puzzle-select');
  const puzzleDetails = $('#puzzle-details');
  const puzzlePanel = document.getElementById('puzzle-panel');
  const btnPuzzleApply = $('#btn-puzzle-apply');
  const btnPuzzlePrefill = $('#btn-puzzle-prefill');
  // Mode UI and score UI
  const modePanel = document.getElementById('mode-panel');
  const drawPanel = document.getElementById('draw-panel');
  const modeBtns = $$('.mode-btn');
  const modePuzzleBtn = document.getElementById('mode-puzzle');
  const modeDrawBtn = document.getElementById('mode-draw');
  const modeHint = document.getElementById('mode-hint');
  const linkOptions = document.getElementById('link-options');
  const linkSetEnergy = document.getElementById('link-set-energy');
  const linkSetSignal = document.getElementById('link-set-signal');
  const scoreValue = document.getElementById('score-value');
  const progressBar = document.getElementById('progress-bar');
  // Presence
  const clientId = Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4);
  let roomPresence = [];

  // Tools
  let currentTool = 'select';
  const toolButtons = $$('.tool');
  toolButtons.forEach(btn => btn.addEventListener('click', () => setTool(btn.dataset.tool)));
  function setTool(tool){
    currentTool = tool;
    toolButtons.forEach(b=>b.classList.toggle('active', b.dataset.tool===tool));
  }

  // Board SVG setup
  const boardDiv = $('#board');
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  const isCoarse = (("matchMedia" in window) && matchMedia('(pointer: coarse)').matches) || (navigator.maxTouchPoints>0) || ('ontouchstart' in window);
  const smallScreen = () => window.innerWidth < 900;
  svg.classList.add('svg-board');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.setAttribute('viewBox', '0 0 1200 800');
  boardDiv.appendChild(svg);

  // defs with arrow markers
  const defs = document.createElementNS(svgNS, 'defs');
  defs.innerHTML = `
    <marker id="arrow-red" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#d32f2f" />
    </marker>
    <marker id="arrow-blue" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#1976d2" />
    </marker>
    <marker id="arrow-green" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#2e7d32" />
    </marker>`;
  svg.appendChild(defs);

  const linksLayer = document.createElementNS(svgNS, 'g');
  const blocksLayer = document.createElementNS(svgNS, 'g');
  const uiLayer = document.createElementNS(svgNS, 'g');
  svg.appendChild(linksLayer);
  svg.appendChild(blocksLayer);
  svg.appendChild(uiLayer);

  // Helpers
  const id = () => Math.random().toString(36).slice(2,10);
  const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));
  const snap = (v)=> state.grid ? Math.round(v/20)*20 : v;
  function defaultBlockSize(){ return smallScreen() ? { w: 280, h: 120 } : { w: 220, h: 90 }; }

  function categoryColor(cat){
    switch(cat){
      case 'Sources': return '#b7791f';
      case 'Traitement': return '#2e7d32';
      case 'Communication': return '#1976d2';
      case 'Capteurs':
      case 'CapteursActionneurs': return '#ad1457';
      case 'Usages': return '#ef6c00';
      default: return '#6b7280';
    }
  }

  // API
  async function api(path, options){
    const res = await fetch(path, options);
    if(!res.ok){
      let msg = `${res.status}`;
      try{ const j = await res.json(); msg += ` ${j.error||''}` }catch{}
      throw new Error(msg);
    }
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.text();
  }

  async function loadDeck(){
    try { state.deck = await api('/api/deck'); }
    catch { state.deck = await api('/deck'); }
  }

  async function loadPuzzles(){
    try{
      const list = await api('/puzzles.json');
      if(Array.isArray(list)){
        state.puzzles = list;
        // populate select
        if(puzzleSelect){
          // keep current selection if exists
          const cur = puzzleSelect.value;
          puzzleSelect.innerHTML = '<option value="">— Aucun —</option>' +
            list.map(p=>`<option value="${p.id}">${escapeHtml(p.title)}</option>`).join('');
          if(cur) puzzleSelect.value = cur;
        }
      }
    }catch(e){ /* silently ignore if not available */ }
  }

  function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }

  function renderPuzzleDetails(){
    if(!puzzleDetails) return;
    const p = state.puzzle;
    if(!p){ puzzleDetails.classList.add('hidden'); puzzleDetails.innerHTML=''; return; }
    const tags = (p.tags||[]).join(' • ');
    const byLabel = state.deck ? buildLabelToCategory(state.deck) : new Map();
    const sugg = (p.suggested_blocks||[])
      .map(lbl=>({ label: lbl, category: byLabel.get(lbl) }))
      .filter(c=>!!c.category);
    const cardsHtml = sugg.map(c=>`<div class="card-item" data-label="${escapeHtml(c.label)}" data-category="${escapeHtml(c.category)}"><span>${escapeHtml(c.label)}</span> <span class="cat">(${escapeHtml(c.category)})</span></div>`).join('');
    puzzleDetails.innerHTML = `
      <div class="title">${escapeHtml(p.title)}</div>
      <div class="meta">Objectif: ${escapeHtml(p.target||'–')}</div>
      <div class="meta">Cartes suggérées: ${p.min_cards||'-'}–${p.max_cards||'-'}${tags? ' • ' + escapeHtml(tags):''}</div>
      <div class="problem">${escapeHtml(p.problem||'')}</div>
      <div class="cards">${cardsHtml}</div>
    `;
    // Allow clicking or glisser-déposer des cartes suggérées
    $$('.card-item', puzzleDetails).forEach(el=>{
      el.setAttribute('draggable','true');
      el.addEventListener('click', ()=>{
        const card = { label: el.dataset.label, category: el.dataset.category };
        addBlockFromCard(card);
      });
      el.addEventListener('dragstart', (e)=>{
        const payload = JSON.stringify({ label: el.dataset.label, category: el.dataset.category });
        e.dataTransfer.setData('application/json', payload);
        e.dataTransfer.effectAllowed = 'copy';
      });
    });
    puzzleDetails.classList.remove('hidden');
  }

  // Draw cards
async function drawCards(){
  try{
    const count = parseInt((drawCount && drawCount.value) || '4', 10);
    const seq = parseInt((drawSequences && drawSequences.value) || '1', 10);
    if(state.roomId && state.roomId !== 'SOLO' && state.roomId !== 'SANDBOX'){
      await api(`/api/room/${state.roomId}/draw`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ count, sequences: seq })});
      return; // SSE will update UI
    }
    const res = await api('/api/draw', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ roomId: state.roomId||'SOLO', count, sequences: seq })});
    if(res.proposals){ state.drawn.proposals = res.proposals; renderProposals(); return; }
    state.drawn.cards = res.elements || [];
    state.drawn.alea = (res.alea && res.alea.label) || null;
  }catch{
    const cats = state.deck.categories;
    const elementsPool = Object.entries(cats).flatMap(([cat, arr]) => (cat==='Sources'||cat==='Traitement'||cat==='Communication'||cat==='CapteursActionneurs'||cat==='Usages')
      ? arr.map(x=>({category:cat, label:x})) : []);
    const aleas = (state.deck.aleas||[]).slice();
    function pickMany(arr, n){ const tmp = arr.slice(); for(let i=tmp.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [tmp[i],tmp[j]]=[tmp[j],tmp[i]]; } return tmp.slice(0,n); }
    const n = parseInt((drawCount && drawCount.value) || '4', 10);
    state.drawn.cards = pickMany(elementsPool, n);
    state.drawn.alea = pickMany(aleas, 1)[0];
  }
  renderDrawn();
}

function renderDrawn(){
    drawnCardsEl.innerHTML = '';
    if(drawProposalsEl) drawProposalsEl.innerHTML = '';
    state.drawn.cards.forEach(c => {
      const el = document.createElement('div');
      el.className = 'card-item';
      el.style.borderColor = 'var(--border)';
      const label = c.label || c.name;
      const cat = c.category || c.cat;
      el.innerHTML = `<span>${label}</span> <span class="cat">(${cat})</span>`;
      el.title = 'Cliquer pour déposer sur le tableau';
      el.addEventListener('click', ()=> addBlockFromCard(c));
      drawnCardsEl.appendChild(el);
    });
    aleaDisplay.textContent = state.drawn.alea || '–';
    if(typeof renderScore === 'function') renderScore();
  }

  function renderProposals(){
    if(!drawProposalsEl) return;
    drawnCardsEl.innerHTML = '';
    drawProposalsEl.innerHTML = '';
    const proposals = state.drawn.proposals || [];
    proposals.forEach((p, idx)=>{
      const wrap = document.createElement('div');
      wrap.className = 'proposal';
      const list = document.createElement('div');
      list.className = 'cards';
      (p.elements||[]).forEach(c=>{
        const el = document.createElement('div');
        el.className = 'card-item';
        const label = c.label || c.name; const cat = c.category || c.cat;
        el.innerHTML = `<span>${label}</span> <span class="cat">(${cat})</span>`;
        list.appendChild(el);
      });
      const controls = document.createElement('div');
      controls.className = 'actions';
      const btn = document.createElement('button');
      btn.textContent = 'Choisir cette séquence';
      btn.addEventListener('click', async ()=>{
        if(state.roomId && state.roomId !== 'SOLO'){
          await api(`/api/room/${state.roomId}/choose_draw`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ index: idx })});
        } else {
          state.drawn.cards = p.elements||[];
          state.drawn.alea = (p.alea && p.alea.label) || null;
          state.drawn.proposals = [];
          renderDrawn();
        }
      });
      controls.appendChild(btn);
      const alea = document.createElement('div');
      alea.className = 'alea';
      alea.innerHTML = `<strong>Problématique:</strong> <span>${(p.alea && p.alea.label) || '–'}</span>`;
      wrap.appendChild(list);
      wrap.appendChild(alea);
      wrap.appendChild(controls);
      drawProposalsEl.appendChild(wrap);
    });
  }

  function addBlockFromCard(card){
    pushHistory();
    const sz = defaultBlockSize();
    const b = {
      id: id(), x: snap(120 + state.board.blocks.length*40), y: snap(120), w: sz.w, h: sz.h,
      title: (card.label || card.name), category: (card.category || card.cat)
    };
    state.board.blocks.push(b);
    renderBoard();
    syncIfRoom();
  }

  function addAdHocBlock(){
    const name = prompt('Nom du bloc ?');
    if(!name) return;
    pushHistory();
    const sz = defaultBlockSize();
    const b = { id:id(), x:snap(240), y:snap(220), w:sz.w, h:sz.h, title:name, category:'Personnalisé' };
    state.board.blocks.push(b);
    renderBoard();
  }

  // Board interactions
  // History for undo/redo
  const history = [];
  const redoStack = [];
  let moveStartSnapshot = null; // snapshot before a drag move
  function snapshotBoard(){ return JSON.parse(JSON.stringify(state.board)); }
  function pushHistoryFrom(snap){
    try{
      history.push(JSON.parse(JSON.stringify(snap)));
      if(history.length>100) history.shift();
      redoStack.length = 0;
    }catch{}
  }
  function pushHistory(){ pushHistoryFrom(snapshotBoard()); }
  function applySnapshot(snap){ state.board = JSON.parse(JSON.stringify(snap)); selected.clear(); selectedId=null; renderBoard(); syncIfRoom(); }
  let dragging = null; // {type:'block'|'multi', id, dx, dy, ids?, offsets?}
  let linkDraft = null; // {type:'energy'|'signal', fromId, x1,y1,x2,y2}
  let selectedId = null; // primary selection id
  const selected = new Set(); // multi-selection set of ids 'block:..' or 'link:..'
  let rubber = null; // {x1,y1,x2,y2}
  let linkBubble = null; // floating HTML bubble for link type
  let nodeBubble = null; // floating bubble for starting links from a selected block (mobile)
  let mobileToolbar = null; // floating toolbar (trash on mobile)
  let suppressClearClick = false; // avoid clearing selection right after rubber-band
  let quickLink = null; // {type:'energy'|'signal', fromId}
  let titleEditor = null; // HTML input for inline editing
  let longPress = null; // {timer, x, y, opened, id}
  let liveSyncAt = 0; // throttle timestamp for live sync during drag
  const LIVE_SYNC_EVERY_MS = 160;

  function viewScale(){ const rect = svg.getBoundingClientRect(); const vb = svg.viewBox.baseVal; return { sx: rect.width/vb.width, sy: rect.height/vb.height, rect }; }
  function openTitleEditor(B){
    closeTitleEditor(false);
    const { sx, sy, rect } = viewScale();
    let left = rect.left + (B.x + 12) * sx;
    let top = rect.top + (B.y + 8) * sy;
    const width = Math.max(60, (B.w - 24) * sx);
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'inline-editor';
    input.style.left = left + 'px';
    input.style.top = top + 'px';
    input.style.width = width + 'px';
    input.value = B.title || '';
    document.body.appendChild(input);
    // Clamp inside viewport for better mobile behavior
    try{
      const vw = window.innerWidth, vh = window.innerHeight;
      const iw = Math.min(width, Math.round(vw * 0.92));
      left = Math.max(8, Math.min(vw - iw - 8, left));
      top = Math.max(8, Math.min(vh - 44, top));
      input.style.left = left + 'px';
      input.style.top = top + 'px';
      input.style.width = iw + 'px';
    }catch{}
    setTimeout(()=>{ try{ input.focus(); input.select(); }catch{} }, 0);
    const onSave = ()=>{ const v = input.value.trim(); if(v !== B.title){ pushHistory(); B.title = v; renderBoard(); syncIfRoom(); } closeTitleEditor(false); };
    const onCancel = ()=>{ closeTitleEditor(false); };
    input.addEventListener('keydown', (e)=>{
      if(e.key === 'Enter'){ e.preventDefault(); onSave(); }
      else if(e.key === 'Escape'){ e.preventDefault(); onCancel(); }
    });
    input.addEventListener('blur', onSave);
    titleEditor = input;
  }
  function closeTitleEditor(render=true){ if(titleEditor){ try{ titleEditor.remove(); }catch{} titleEditor=null; if(render) renderBoard(); } }

  function renderBoard(){
    // clear layers
    linksLayer.innerHTML = '';
    blocksLayer.innerHTML = '';
    uiLayer.innerHTML = '';

    // Links first
    function computeAnchors(from, to){
      const fx = from.x, fy = from.y, fw = from.w, fh = from.h;
      const tx = to.x, ty = to.y, tw = to.w, th = to.h;
      const fc = { x: fx + fw/2, y: fy + fh/2 };
      const tc = { x: tx + tw/2, y: ty + th/2 };
      const dx = tc.x - fc.x, dy = tc.y - fc.y;
      // choose side by dominant axis
      let x1=fc.x, y1=fc.y, x2=tc.x, y2=tc.y;
      if(Math.abs(dx) > Math.abs(dy)){
        // horizontal attachment
        x1 = dx >= 0 ? fx + fw : fx; y1 = fc.y;
        x2 = dx >= 0 ? tx : tx + tw; y2 = tc.y;
      } else {
        // vertical attachment
        x1 = fc.x; y1 = dy >= 0 ? fy + fh : fy;
        x2 = tc.x; y2 = dy >= 0 ? ty : ty + th;
      }
      return { x1, y1, x2, y2 };
    }

    state.board.links.forEach(L => {
      const from = state.board.blocks.find(b=>b.id===L.from);
      const to = state.board.blocks.find(b=>b.id===L.to);
      if(!from || !to) return;
      const { x1, y1, x2, y2 } = computeAnchors(from, to);
      // Visual line (no hit)
      const vis = document.createElementNS(svgNS,'line');
      vis.setAttribute('x1', x1); vis.setAttribute('y1', y1);
      vis.setAttribute('x2', x2); vis.setAttribute('y2', y2);
      vis.classList.add('link');
      vis.style.pointerEvents = 'none';
      if(L.type==='energy'){
        vis.classList.add('energy');
        vis.setAttribute('stroke', '#d32f2f');
        vis.setAttribute('stroke-width', '4.5');
        vis.setAttribute('marker-end', 'url(#arrow-red)');
      } else if(L.type==='control'){
        vis.classList.add('control');
        vis.setAttribute('stroke', '#2e7d32');
        vis.setAttribute('stroke-width', '3.5');
        vis.setAttribute('marker-end', 'url(#arrow-green)');
      } else {
        vis.setAttribute('stroke', '#1976d2');
        vis.setAttribute('stroke-width', '2.5');
        vis.setAttribute('marker-end', 'url(#arrow-blue)');
      }
      if(selected.has(`link:${L.id}`)) vis.classList.add('selected');
      linksLayer.appendChild(vis);

      // Thin hit line for precise selection
      const hit = document.createElementNS(svgNS,'line');
      hit.setAttribute('x1', x1); hit.setAttribute('y1', y1);
      hit.setAttribute('x2', x2); hit.setAttribute('y2', y2);
      hit.setAttribute('stroke', '#000');
      hit.setAttribute('stroke-opacity', '0');
      // élargir encore la ligne d'accroche (invisible)
      const hitW = L.type==='energy' ? 10 : (L.type==='control' ? 9 : 9);
      hit.setAttribute('stroke-width', String(hitW));
      hit.setAttribute('pointer-events', 'stroke');
      hit.style.cursor = 'pointer';
      hit.dataset.id = L.id;
      hit.addEventListener('dblclick', ()=>{
        pushHistory();
        const t = prompt('Texte du lien ?', L.label||'');
        if(t!=null){ L.label = t; renderBoard(); }
      });
      hit.addEventListener('click', (e)=>{ e.stopPropagation(); select(`link:${L.id}`, e.shiftKey||e.metaKey||e.ctrlKey); });
      linksLayer.appendChild(hit);

      if(L.label){
        const midx = (x1+x2)/2, midy=(y1+y2)/2;
        const g = document.createElementNS(svgNS,'g');
        const rect = document.createElementNS(svgNS,'rect');
        const txt = document.createElementNS(svgNS,'text');
        // Ensure label overlay doesn't block link interactions
        g.style.pointerEvents = 'none';
        rect.style.pointerEvents = 'none';
        txt.style.pointerEvents = 'none';
        txt.setAttribute('x', midx); txt.setAttribute('y', midy);
        txt.setAttribute('text-anchor','middle'); txt.setAttribute('dominant-baseline','middle');
        txt.setAttribute('class','label-text');
        txt.setAttribute('fill', '#111827');
        txt.setAttribute('font-weight', '700');
        txt.textContent = L.label;
        const bboxW = Math.max(30, L.label.length*7);
        rect.setAttribute('x', midx - bboxW/2 - 6);
        rect.setAttribute('y', midy - 16);
        rect.setAttribute('rx', 6); rect.setAttribute('ry',6);
        rect.setAttribute('width', bboxW+12); rect.setAttribute('height', 24);
        rect.setAttribute('class','label-bg');
        rect.setAttribute('fill', 'rgba(17,24,39,.06)');
        rect.setAttribute('stroke', '#9ca3af');
        rect.setAttribute('stroke-width', '1');
        g.appendChild(rect); g.appendChild(txt);
        linksLayer.appendChild(g);
      }
    });

    // draft link
    if(linkDraft){
      const line = document.createElementNS(svgNS,'line');
      line.setAttribute('x1', linkDraft.x1); line.setAttribute('y1', linkDraft.y1);
      line.setAttribute('x2', linkDraft.x2); line.setAttribute('y2', linkDraft.y2);
      line.classList.add('link');
      if(linkDraft.type==='energy'){
        line.classList.add('energy');
        line.setAttribute('stroke', '#d32f2f');
        line.setAttribute('stroke-width', '4.5');
        line.setAttribute('marker-end', 'url(#arrow-red)');
      } else if(linkDraft.type==='control'){
        line.classList.add('control');
        line.setAttribute('stroke', '#2e7d32');
        line.setAttribute('stroke-width', '3.5');
        line.setAttribute('marker-end', 'url(#arrow-green)');
      } else {
        line.setAttribute('stroke', '#1976d2');
        line.setAttribute('stroke-width', '2.5');
        line.setAttribute('marker-end', 'url(#arrow-blue)');
      }
      linksLayer.appendChild(line);
    }

    // Blocks
    state.board.blocks.forEach(B => {
      const g = document.createElementNS(svgNS,'g');
      g.classList.add('block');
      if(selected.has(`block:${B.id}`)) g.classList.add('selected');
      g.dataset.id = B.id;
      g.addEventListener('pointerenter', ()=>{ g.classList.add('hover'); });
      g.addEventListener('pointerleave', ()=>{ g.classList.remove('hover'); });

      const rect = document.createElementNS(svgNS,'rect');
      rect.setAttribute('x', B.x); rect.setAttribute('y', B.y);
      rect.setAttribute('width', B.w); rect.setAttribute('height', B.h);
      rect.setAttribute('rx', 10); rect.setAttribute('ry',10);
      rect.setAttribute('fill', '#ffffff');
      rect.setAttribute('stroke', '#9ca3af');
      rect.setAttribute('stroke-width', '2.5');
      g.appendChild(rect);

      // title
      const t1 = document.createElementNS(svgNS,'text');
      t1.setAttribute('x', B.x + 12); t1.setAttribute('y', B.y + 28);
      t1.setAttribute('class','title');
      t1.setAttribute('fill', '#111827');
      t1.setAttribute('font-size', smallScreen() ? '22' : '16');
      t1.setAttribute('font-weight', '700');
      t1.textContent = B.title;
      g.appendChild(t1);

      // category badge (color)
      const t2 = document.createElementNS(svgNS,'text');
      t2.setAttribute('x', B.x + 12); t2.setAttribute('y', B.y + 52);
      t2.setAttribute('class','category');
      t2.setAttribute('fill', categoryColor(B.category));
      t2.setAttribute('font-size', smallScreen() ? '15' : '12');
      t2.setAttribute('font-weight', '700');
      t2.textContent = B.category;
      g.appendChild(t2);

      g.addEventListener('pointerdown', (e)=>{
        if(e.detail && e.detail > 1){ return; }
        if(g.setPointerCapture){ try{ g.setPointerCapture(e.pointerId); }catch(_){} }
        const pt = toSvgPoint(e);
        // arm long-press to edit on touch
        try{ if(longPress && longPress.timer) clearTimeout(longPress.timer); }catch{}
        longPress = { x: pt.x, y: pt.y, opened: false, id: B.id, timer: setTimeout(()=>{ openTitleEditor(B); if(longPress) longPress.opened = true; }, 600) };
        moveStartSnapshot = snapshotBoard();
        // Quick link creation if armed
        if(quickLink && quickLink.fromId && quickLink.type){
          if(quickLink.fromId !== B.id){
            state.board.links.push({ id:id(), type:quickLink.type, from:quickLink.fromId, to:B.id });
            quickLink = null;
            renderBoard();
            syncIfRoom();
            setTool('select');
            return;
          }
        }
        // group-drag support if multiple selected
        const isSel = selected.has(`block:${B.id}`);
        const multiIds = Array.from(selected).filter(s=>s.startsWith('block:')).map(s=>s.split(':')[1]);
        if(isSel && multiIds.length>1){
          const offsets = new Map();
          multiIds.forEach(idb=>{
            const bb = state.board.blocks.find(b=>b.id===idb);
            if(bb) offsets.set(idb, { dx: pt.x - bb.x, dy: pt.y - bb.y });
          });
          dragging = { type:'multi', ids: multiIds, offsets };
        } else {
          dragging = { type:'block', id:B.id, dx: pt.x - B.x, dy: pt.y - B.y };
          select(`block:${B.id}`, e.shiftKey||e.metaKey||e.ctrlKey);
        }
      });
      // also attach on rect for reliable hit
      rect.addEventListener('pointerdown', (e)=>{
        if(e.detail && e.detail > 1){ return; }
        if(g.setPointerCapture){ try{ g.setPointerCapture(e.pointerId); }catch(_){} }
        const pt = toSvgPoint(e);
        // arm long-press to edit on touch
        try{ if(longPress && longPress.timer) clearTimeout(longPress.timer); }catch{}
        longPress = { x: pt.x, y: pt.y, opened: false, id: B.id, timer: setTimeout(()=>{ openTitleEditor(B); if(longPress) longPress.opened = true; }, 600) };
        moveStartSnapshot = snapshotBoard();
        const isSel = selected.has(`block:${B.id}`);
        const multiIds = Array.from(selected).filter(s=>s.startsWith('block:')).map(s=>s.split(':')[1]);
        if(isSel && multiIds.length>1){
          const offsets = new Map();
          multiIds.forEach(idb=>{
            const bb = state.board.blocks.find(b=>b.id===idb);
            if(bb) offsets.set(idb, { dx: pt.x - bb.x, dy: pt.y - bb.y });
          });
          dragging = { type:'multi', ids: multiIds, offsets };
        } else {
          dragging = { type:'block', id:B.id, dx: pt.x - B.x, dy: pt.y - B.y };
          select(`block:${B.id}`, e.shiftKey||e.metaKey||e.ctrlKey);
        }
      });
      // Support dblclick on rect too (reliability for custom blocks)
      rect.addEventListener('dblclick', (e)=>{ e.stopPropagation(); e.preventDefault(); openTitleEditor(B); });
      // Also handle mousedown with detail>=2 for browsers not firing dblclick
      rect.addEventListener('mousedown', (e)=>{ if(e.detail && e.detail >= 2){ e.stopPropagation(); e.preventDefault(); openTitleEditor(B); } });
      // And click(detail>=2) as a fallback
      rect.addEventListener('click', (e)=>{ if(e.detail && e.detail >= 2){ e.stopPropagation(); e.preventDefault(); openTitleEditor(B); } });
      // Click to select; open editor on double-click (detail>=2 covers some touchpads)
      g.addEventListener('click', (e)=>{
        e.stopPropagation();
        if(e.detail && e.detail >= 2){ e.preventDefault(); openTitleEditor(B); return; }
        select(`block:${B.id}`, e.shiftKey||e.metaKey||e.ctrlKey);
      });
      g.addEventListener('dblclick', (e)=>{ e.stopPropagation(); e.preventDefault(); openTitleEditor(B); });
      // Handles au centre des arrêtes
      const handles = [
        { x: B.x + B.w/2, y: B.y },
        { x: B.x + B.w, y: B.y + B.h/2 },
        { x: B.x + B.w/2, y: B.y + B.h },
        { x: B.x, y: B.y + B.h/2 },
      ];
      const handleR = smallScreen() ? 12 : 9;
      handles.forEach(h => {
        const c = document.createElementNS(svgNS,'circle');
        c.setAttribute('cx', h.x); c.setAttribute('cy', h.y);
        c.setAttribute('r', handleR);
        c.setAttribute('class','handle');
        c.addEventListener('pointerdown', (e)=>{
          e.stopPropagation();
          if(g.setPointerCapture){ try{ g.setPointerCapture(e.pointerId); }catch(_){} }
          const tool = (currentTool==='energy' || currentTool==='signal') ? currentTool : 'signal';
          linkDraft = { type: tool, fromId: B.id, x1: h.x, y1: h.y, x2: h.x, y2: h.y };
        });
        g.appendChild(c);
      });

      blocksLayer.appendChild(g);
    });
    if(typeof renderScore === 'function') renderScore();
    updateLinkOptionsVisibility();
    renderLinkBubble();
    renderNodeBubble();
    renderMobileToolbar();
  }

  function select(idStr, additive=false){
    if(!idStr){ selected.clear(); selectedId = null; renderBoard(); return; }
    if(additive){
      if(selected.has(idStr)) selected.delete(idStr); else selected.add(idStr);
    } else {
      selected.clear(); selected.add(idStr);
    }
    selectedId = selected.size===1 ? Array.from(selected)[0] : null;
    renderBoard();
  }

  function toSvgPoint(evt){
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    const res = pt.matrixTransform(svg.getScreenCTM().inverse());
    return res;
  }

  svg.addEventListener('pointermove', (e)=>{
    const pt = toSvgPoint(e);
    // cancel long-press if moved significantly
    if(longPress){ const dx = pt.x - longPress.x, dy = pt.y - longPress.y; if((dx*dx + dy*dy) > 36){ try{ clearTimeout(longPress.timer); }catch{} longPress = null; } }
    if(dragging && dragging.type==='block'){
      const B = state.board.blocks.find(b=>b.id===dragging.id);
      if(!B) return;
      B.x = snap(pt.x - dragging.dx);
      B.y = snap(pt.y - dragging.dy);
      renderBoard();
      // live sync (throttled) for classroom mode
      const now = Date.now();
      if(state.roomId && state.roomId!=='SOLO' && now - liveSyncAt > LIVE_SYNC_EVERY_MS){ liveSyncAt = now; syncIfRoom(); }
    } else if(dragging && dragging.type==='multi'){
      dragging.ids.forEach(idb=>{
        const bb = state.board.blocks.find(b=>b.id===idb);
        const off = dragging.offsets.get(idb);
        if(bb && off){ bb.x = snap(pt.x - off.dx); bb.y = snap(pt.y - off.dy); }
      });
      renderBoard();
      const now = Date.now();
      if(state.roomId && state.roomId!=='SOLO' && now - liveSyncAt > LIVE_SYNC_EVERY_MS){ liveSyncAt = now; syncIfRoom(); }
    } else if(linkDraft){
      linkDraft.x2 = pt.x; linkDraft.y2 = pt.y; renderBoard();
    } else if(rubber){
      rubber.x2 = pt.x; rubber.y2 = pt.y;
      applyRubberSelection(true);
      drawRubber();
    }
  });
  svg.addEventListener('pointerup', (e)=>{
    const pt = toSvgPoint(e);
    if(longPress){ try{ clearTimeout(longPress.timer); }catch{} longPress = null; }
    if(dragging){
      if(moveStartSnapshot){ pushHistoryFrom(moveStartSnapshot); moveStartSnapshot=null; }
      dragging = null; syncIfRoom();
    }
    if(linkDraft){
      // check if released over a block
      const target = state.board.blocks.find(b => pt.x>=b.x && pt.x<=b.x+b.w && pt.y>=b.y && pt.y<=b.y+b.h);
      if(target && target.id !== linkDraft.fromId){
        pushHistory();
        state.board.links.push({ id:id(), type:linkDraft.type, from:linkDraft.fromId, to:target.id });
      }
      linkDraft = null; renderBoard();
      syncIfRoom();
      // After creating a link, return to select for smoother flow
      setTool('select');
    }
    if(rubber){
      const w = Math.abs(rubber.x2 - rubber.x1);
      const h = Math.abs(rubber.y2 - rubber.y1);
      // if rectangle had a minimal size, suppress the subsequent background click clear
      if(w > 3 || h > 3) suppressClearClick = true;
      applyRubberSelection();
      rubber = null; drawRubber();
    }
  });
  svg.addEventListener('pointerdown', (e)=>{
    const t = e.target;
    // Autoriser le démarrage du rectangle sur les couches vides
    if(t === svg || t === linksLayer || t === blocksLayer || t === uiLayer){
      suppressClearClick = false;
      const pt = toSvgPoint(e);
      rubber = { x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y };
      drawRubber();
    }
  });
  svg.addEventListener('click', ()=>{
    if(suppressClearClick){ suppressClearClick = false; return; }
    select(null);
  });

  // Drag & drop depuis les cartes suggérées vers le tableau
  boardDiv.addEventListener('dragover', (e)=>{ e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  boardDiv.addEventListener('drop', (e)=>{
    e.preventDefault();
    let data = null;
    try{ data = JSON.parse(e.dataTransfer.getData('application/json') || 'null'); }catch{}
    if(!data || !data.label) return;
    const pt = toSvgPoint(e);
    const sz = defaultBlockSize();
    const b = { id:id(), x: snap(pt.x - Math.round(sz.w/2)), y: snap(pt.y - Math.round(sz.h/2)), w:sz.w, h:sz.h, title:data.label, category:data.category||'Personnalisé' };
    state.board.blocks.push(b);
    renderBoard();
    syncIfRoom();
  });

  function drawRubber(){
    uiLayer.innerHTML = '';
    if(!rubber) return;
    const x = Math.min(rubber.x1, rubber.x2);
    const y = Math.min(rubber.y1, rubber.y2);
    const w = Math.abs(rubber.x2 - rubber.x1);
    const h = Math.abs(rubber.y2 - rubber.y1);
    const r = document.createElementNS(svgNS,'rect');
    r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', w); r.setAttribute('height', h);
    r.setAttribute('class','rubberband');
    uiLayer.appendChild(r);
  }

  function applyRubberSelection(live=false){
    if(!rubber) return;
    const x = Math.min(rubber.x1, rubber.x2);
    const y = Math.min(rubber.y1, rubber.y2);
    const w = Math.abs(rubber.x2 - rubber.x1);
    const h = Math.abs(rubber.y2 - rubber.y1);
    const x2 = x + w, y2 = y + h;
    selected.clear();
    state.board.blocks.forEach(b=>{
      const bx1=b.x, by1=b.y, bx2=b.x+b.w, by2=b.y+b.h;
      const inter = !(bx2 < x || bx1 > x2 || by2 < y || by1 > y2);
      if(inter) selected.add(`block:${b.id}`);
    });
    // helper: segment-rectangle intersection
    function segIntersectsRect(x1,y1,x2,y2, rx1,ry1,rx2,ry2){
      function inside(px,py){ return px>=rx1 && px<=rx2 && py>=ry1 && py<=ry2; }
      if(inside(x1,y1) || inside(x2,y2)) return true;
      function ccw(ax,ay,bx,by,cx,cy){ return (cy-ay)*(bx-ax) > (by-ay)*(cx-ax); }
      function segInter(ax,ay,bx,by,cx,cy,dx,dy){
        return ccw(ax,ay,cx,cy,dx,dy) !== ccw(bx,by,cx,cy,dx,dy) && ccw(ax,ay,bx,by,cx,cy) !== ccw(ax,ay,bx,by,dx,dy);
      }
      // rectangle edges
      const ex1=rx1, ey1=ry1, ex2=rx2, ey2=ry1; // top
      const fx1=rx2, fy1=ry1, fx2=rx2, fy2=ry2; // right
      const gx1=rx2, gy1=ry2, gx2=rx1, gy2=ry2; // bottom
      const hx1=rx1, hy1=ry2, hx2=rx1, hy2=ry1; // left
      return segInter(x1,y1,x2,y2, ex1,ey1,ex2,ey2) ||
             segInter(x1,y1,x2,y2, fx1,fy1,fx2,fy2) ||
             segInter(x1,y1,x2,y2, gx1,gy1,gx2,gy2) ||
             segInter(x1,y1,x2,y2, hx1,hy1,hx2,hy2);
    }
    state.board.links.forEach(L=>{
      const from = state.board.blocks.find(b=>b.id===L.from);
      const to = state.board.blocks.find(b=>b.id===L.to);
      if(!from||!to) return;
      const x1 = from.x + from.w/2, y1 = from.y + from.h/2;
      const x2l = to.x + to.w/2, y2l = to.y + to.h/2;
      if(segIntersectsRect(x1,y1,x2l,y2l, x,y,x2,y2)) selected.add(`link:${L.id}`);
    });
    selectedId = selected.size===1 ? Array.from(selected)[0] : null;
    renderBoard();
  }

  // Keyboard deletion of selected block/link (Del/Backspace)
  document.addEventListener('keydown', (e)=>{
    if(e.key !== 'Delete' && e.key !== 'Backspace') return;
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if(['INPUT','TEXTAREA','SELECT'].includes(tag)) return; // don't hijack typing
    if(selected.size===0) return;
    pushHistory();
    const blocksToDelete = new Set(Array.from(selected).filter(s=>s.startsWith('block:')).map(s=>s.split(':')[1]));
    const linksToDelete = new Set(Array.from(selected).filter(s=>s.startsWith('link:')).map(s=>s.split(':')[1]));
    state.board.links = state.board.links.filter(L => !blocksToDelete.has(L.from) && !blocksToDelete.has(L.to) && !linksToDelete.has(L.id));
    state.board.blocks = state.board.blocks.filter(b => !blocksToDelete.has(b.id));
    showToast(blocksToDelete.size+linksToDelete.size>1 ? 'Éléments supprimés' : 'Élément supprimé');
    selected.clear(); selectedId = null;
    renderBoard();
    syncIfRoom();
    e.preventDefault();
  });

  // Shortcuts + Quick link creation with E/S hotkeys
  document.addEventListener('keydown', (e)=>{
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if(e.ctrlKey || e.metaKey){
      if(!['INPUT','TEXTAREA'].includes(tag)){
        const key = e.key.toLowerCase();
        if(key==='a'){
          e.preventDefault();
          selected.clear();
          state.board.blocks.forEach(b=> selected.add(`block:${b.id}`));
          state.board.links.forEach(l=> selected.add(`link:${l.id}`));
          selectedId = null; renderBoard();
          return;
        }
        if(key==='z' && !e.shiftKey){
          e.preventDefault();
          const snap = history.pop();
          if(snap){ redoStack.push(snapshotBoard()); applySnapshot(snap); }
          return;
        }
        if(key==='y' || (key==='z' && e.shiftKey)){
          e.preventDefault();
          const snap = redoStack.pop();
          if(snap){ history.push(snapshotBoard()); applySnapshot(snap); }
          return;
        }
      }
    }
    if(['INPUT','TEXTAREA','SELECT'].includes(tag)) return;
    if(!e.key) return;
    const k = e.key.toLowerCase();
    // F2 or Enter to edit label/title
    if(e.key === 'F2' || k==='enter'){
      const [kind, rawId] = (selectedId||'').split(':');
      if(kind==='block' && rawId){
        const B = state.board.blocks.find(b=>b.id===rawId); if(B){ e.preventDefault(); openTitleEditor(B); return; }
      } else if(kind==='link' && rawId){
        const L = state.board.links.find(l=>l.id===rawId); if(L){ e.preventDefault(); const t = prompt('Texte du lien ?', L.label||''); if(t!=null){ pushHistory(); L.label = t; renderBoard(); syncIfRoom(); } return; }
      }
    }
    if(k==='e' || k==='s' || k==='c'){
      const [kind, rawId] = (selectedId||'').split(':');
      if(kind==='block' && rawId){
        quickLink = { type: k==='e' ? 'energy' : (k==='c' ? 'control' : 'signal'), fromId: rawId };
        setTool(quickLink.type);
        const name = k==='e'?'Énergie':(k==='c'?'Contrôle':'Signal');
        showToast(`Clique un autre bloc pour une flèche ${name}.`);
      }
    }
  });

  // Buttons
  const btnHomeTitle = document.getElementById('btn-home-title');
  const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
  const btnFocus = document.getElementById('btn-focus');
  if(btnHomeTitle){
    btnHomeTitle.addEventListener('click', ()=>{ showHome(); });
    btnHomeTitle.addEventListener('keydown', (e)=>{ if(e.key==='Enter' || e.key===' ') { e.preventDefault(); showHome(); } });
  }
  if(btnToggleSidebar){
    btnToggleSidebar.addEventListener('click', ()=>{
      if(window.innerWidth >= 900) return; // ignore on desktop
      document.body.classList.toggle('sidebar-collapsed');
      renderBoard();
    });
  }
  if(btnFocus){
    btnFocus.addEventListener('click', ()=>{
      const on = document.body.classList.toggle('focus-mode');
      btnFocus.textContent = on ? 'Quitter plein écran' : 'Plein écran';
      if(!on){ toggleOverlayPanels(false); }
      renderBoard();
    });
  }
  $('#btn-solo').addEventListener('click', async ()=>{ await ensureDeck(); state.roomId = 'SOLO'; state.team = ''; state.mode='puzzle'; state.ranked=false; enterBoard(); });
  const btnRanked = document.getElementById('btn-ranked');
  const btnSandbox = document.getElementById('btn-sandbox');
  if(btnRanked){ btnRanked.addEventListener('click', async ()=>{ await ensureDeck(); state.roomId = 'SOLO'; state.team = ''; state.mode='puzzle'; state.ranked=true; enterBoard(); }); }
  if(btnSandbox){ btnSandbox.addEventListener('click', async ()=>{ await ensureDeck(); state.roomId = 'SANDBOX'; state.team = ''; state.mode='puzzle'; state.ranked=false; enterBoard(); }); }
  $('#btn-create').addEventListener('click', async ()=>{
    await ensureDeck();
    const team = teamInputValue();
    const res = await api('/create', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({team})});
    state.roomId = res.roomId; state.team = team||`Équipe ${res.roomId}`; enterBoard();
  });
  $('#btn-join').addEventListener('click', async ()=>{
    await ensureDeck();
    const code = joinCode.value.trim(); if(!code) return alert('Entrez un code.');
    try{
      const res = await api('/join', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({roomId: code})});
      state.roomId = res.roomId; state.team = teamInputValue()||`Équipe ${res.roomId}`; enterBoard();
    }catch(err){ alert('Salle introuvable'); }
  });

  $('#btn-draw').addEventListener('click', ()=>{ if(!state.deck) return; drawCards(); });
  const btnAddEmpty = document.getElementById('btn-add-empty-block');
  if(btnAddEmpty){ btnAddEmpty.addEventListener('click', ()=>{
    const b = { id:id(), x:snap(240), y:snap(220), w:220, h:90, title:'', category:'Personnalisé' };
    pushHistory();
    state.board.blocks.push(b);
    renderBoard();
    // Ouvre l'éditeur inline directement
    openTitleEditor(b);
    syncIfRoom();
  }); }
  const btnAddBlock = $('#tool-add-block'); if(btnAddBlock){ btnAddBlock.addEventListener('click', addAdHocBlock); }
  if(toggleGrid){ toggleGrid.addEventListener('change', ()=>{ state.grid = toggleGrid.checked; }); }

  // Puzzles events
  if(puzzleSelect){
    puzzleSelect.addEventListener('change', ()=>{
      const selId = puzzleSelect.value;
      state.puzzle = state.puzzles.find(p=>p.id===selId) || null;
      renderPuzzleDetails();
      if(state.puzzle){
        if(drawCount && state.puzzle.min_cards){ drawCount.value = String(state.puzzle.min_cards); }
        // Update current problématique display but do not auto-place blocks
        state.drawn.alea = state.puzzle.title || state.puzzle.target || state.puzzle.id;
        aleaDisplay.textContent = state.drawn.alea || '–';
        // Force puzzle mode et cacher la pioche
        state.mode = 'puzzle';
        updateSidebarVisibility();
        syncIfRoom();
      } else {
        // When no puzzle selected, re-enable draw button depending on context
        updateSidebarVisibility();
        syncIfRoom();
      }
    });
  }
  if(btnPuzzleApply){
    btnPuzzleApply.addEventListener('click', ()=>{
      if(!state.puzzle) return showToast('Choisis un casse‑tête.');
      // Adjust draw count to min_cards and set alea to the puzzle title
      if(drawCount && state.puzzle.min_cards){ drawCount.value = String(state.puzzle.min_cards); }
      state.drawn.alea = state.puzzle.title || state.puzzle.target || state.puzzle.id;
      aleaDisplay.textContent = state.drawn.alea;
      showToast('Pioche adaptée au casse‑tête.');
    });
  }
  if(btnPuzzlePrefill){
    btnPuzzlePrefill.addEventListener('click', ()=>{
      if(!state.puzzle) return showToast('Choisis un casse‑tête.');
      if(!state.deck) return showToast('Le jeu de cartes n\'est pas prêt.');
      const byLabel = buildLabelToCategory(state.deck);
      const items = (state.puzzle.suggested_blocks||[])
        .map(lbl=>({ label: lbl, category: byLabel.get(lbl) }))
        .filter(c=>!!c.category);
      if(!items.length){ return showToast('Cartes suggérées introuvables dans le deck.'); }
      state.drawn.cards = items;
      state.drawn.proposals = [];
      state.drawn.alea = state.puzzle.title || state.puzzle.target || state.puzzle.id;
      renderDrawn();
      showToast('Cartes suggérées prêtes à déposer.');
    });
  }

  function buildLabelToCategory(deck){
    const m = new Map();
    const cats = deck && deck.categories || {};
    Object.keys(cats).forEach(cat=>{
      (cats[cat]||[]).forEach(lbl=>{ m.set(lbl, cat); });
    });
    return m;
  }

  $('#btn-save').addEventListener('click', saveToServer);
  $('#btn-load').addEventListener('click', loadFromServer);
  $('#btn-export-png').addEventListener('click', ()=>{ exportPNG(); });
  $('#btn-export-pdf').addEventListener('click', ()=>{ exportPDF(); });
  const helpModal = document.getElementById('help-modal');
  $('#btn-help').addEventListener('click', ()=> toggleHelp(true));
  $('#btn-help-close').addEventListener('click', (e)=>{ e.stopPropagation(); toggleHelp(false); });
  helpModal.addEventListener('click', (e)=>{
    if(e.target === helpModal){ toggleHelp(false); }
  });
  document.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape') toggleHelp(false);
  });

  async function ensureDeck(){ if(!state.deck) await loadDeck(); }
  async function ensurePuzzles(){ if(!state.puzzles.length) await loadPuzzles(); }
  async function setPuzzleById(puzzleId, { fromRemote=false } = {}){
    if(!puzzleId){
      state.puzzle = null;
      if(puzzleSelect){ puzzleSelect.value = ''; }
      renderPuzzleDetails();
      updateSidebarVisibility();
      if(!fromRemote) syncIfRoom();
      return;
    }
    await ensurePuzzles();
    const p = state.puzzles.find(x=>x.id===puzzleId) || null;
    state.puzzle = p;
    if(puzzleSelect){ puzzleSelect.value = p ? p.id : ''; }
    renderPuzzleDetails();
    if(p){ state.mode = 'puzzle'; updateSidebarVisibility(); }
    if(!fromRemote) syncIfRoom();
  }

  function showHome(){
    viewHome.classList.remove('hidden');
    viewBoard.classList.add('hidden');
    roomIndicator.textContent = '';
    try{ document.body.classList.add('home'); }catch{}
    try{ document.body.classList.remove('focus-mode'); document.body.classList.remove('overlay-open'); const el = document.getElementById('overlay-backdrop'); if(el) el.remove(); }catch{}
  }
  function enterBoard(){
    if(teamDisplay) teamDisplay.textContent = state.team||'–';
    roomIndicator.textContent = state.roomId ? `Salle: ${state.roomId}` : '';
    viewHome.classList.add('hidden');
    viewBoard.classList.remove('hidden');
    try{ document.body.classList.remove('home'); }catch{}
    renderBoard();
    // Charger les casse‑têtes
    ensurePuzzles();
    // Visibilité des panneaux selon le mode
    if(state.roomId==='SANDBOX'){
      if(puzzlePanel) puzzlePanel.classList.add('hidden');
      if(drawPanel) drawPanel.classList.remove('hidden');
    } else {
      if(puzzlePanel) puzzlePanel.classList.remove('hidden');
      updateSidebarVisibility();
    }
    if(state.roomId && state.roomId!=='SOLO' && state.roomId!=='SANDBOX'){
      loadFromServer().finally(()=>{ connectRoomStream(); });
    }
    // Maximize drawing space by default only on small screens
    try{
      if(window.innerWidth < 900){
        document.body.classList.add('sidebar-collapsed');
        document.body.classList.add('focus-mode');
        if(btnFocus) btnFocus.textContent='Quitter plein écran';
      } else {
        document.body.classList.remove('focus-mode');
        document.body.classList.remove('overlay-open');
        const el = document.getElementById('overlay-backdrop'); if(el) el.remove();
        if(btnFocus) btnFocus.textContent='Plein écran';
      }
    }catch{}
  }

  // Mode switching helpers
  function setMode(m){
    state.mode = m;
    if(modeBtns){ modeBtns.forEach(b=> b.classList.toggle('active', b.dataset.mode===m)); }
    updateSidebarVisibility();
  }
  function updateSidebarVisibility(){
    if(!drawPanel) return;
    if(state.roomId==='SANDBOX'){
      drawPanel.classList.remove('hidden');
      return;
    }
    const allowDraw = (state.roomId && state.roomId!=='SOLO') && !state.puzzle;
    const show = state.mode==='draw' && allowDraw;
    drawPanel.classList.toggle('hidden', !show);
  }
  // Collapsible panels on small screens
  function initCollapsiblePanels(){
    const panels = $$('.sidebar .panel');
    panels.forEach(p=>{
      if(p.classList.contains('collapsible')) return;
      const h3 = p.querySelector('h3');
      if(!h3) return;
      const content = document.createElement('div');
      content.className = 'panel-content';
      while(h3.nextSibling){ content.appendChild(h3.nextSibling); }
      p.appendChild(content);
      p.classList.add('collapsible');
      h3.addEventListener('click', ()=>{
        p.classList.toggle('collapsed');
      });
    });
    applyPanelCollapse();
    window.addEventListener('resize', applyPanelCollapse);
  }
  function applyPanelCollapse(){
    const small = window.innerWidth < 900;
    $$('.sidebar .panel.collapsible').forEach((p,idx)=>{
      if(small){ p.classList.add('collapsed'); if(idx===0) p.classList.remove('collapsed'); }
      else { p.classList.remove('collapsed'); }
    });
  }
  if(modePuzzleBtn){ modePuzzleBtn.addEventListener('click', ()=> setMode('puzzle')); }
  if(modeDrawBtn){ modeDrawBtn.addEventListener('click', ()=> setMode('draw')); }

  // Validation douce avant export
  function getNotes(){ return (aleaNotes && aleaNotes.value) || ''; }
  function setNotes(v){ if(aleaNotes) aleaNotes.value = v; }
  function validateBeforeExport(){
    const titleEl = document.querySelector('#board-title');
    const title = titleEl ? titleEl.value.trim() : '';
    const energy = state.board.links.some(l=>l.type==='energy');
    const signal = state.board.links.some(l=>l.type!=='energy');
    const chainOk = state.board.blocks.length >= 3 && state.board.links.length >= 2;
    const words = getNotes().trim().split(/\s+/).filter(Boolean);
    const aleaOk = aleaNotes ? (!!state.drawn.alea && words.length >= 6) : !!state.drawn.alea;

    const missing = [];
    if(!title) missing.push('Titre manquant');
    if(!energy) missing.push('Ajouter une flèche Énergie');
    if(!signal) missing.push('Ajouter une flèche Signal');
    if(!chainOk) missing.push('Au moins 3 blocs reliés');
    if(aleaNotes && !aleaOk) missing.push('Aléa + adaptation (≥ 6 mots)');

    if(missing.length){ showToast('Complète avant export: ' + missing.join(' • ')); return false; }
    return true;
  }

  function showToast(msg){
    let t = document.getElementById('toast');
    if(!t){ t = document.createElement('div'); t.id='toast'; Object.assign(t.style,{position:'fixed',bottom:'16px',left:'50%',transform:'translateX(-50%)',background:'#111827',color:'#fff',padding:'10px 14px',borderRadius:'8px',zIndex:2000,maxWidth:'90%'}); document.body.appendChild(t);} 
    t.textContent = msg; t.style.opacity='1'; t.style.transition='';
    setTimeout(()=>{ t.style.transition='opacity .4s'; t.style.opacity='0'; }, 2400);
  }

  // Save / Load
  async function saveToServer(){
    if(!state.roomId || state.roomId==='SOLO'){ return saveToLocal(); }
    const payload = {
      roomId: state.roomId,
      team: state.team,
      meta: { alea: state.drawn.alea, notes: aleaNotes.value },
      state: state.board,
    };
    try{
      await api('/save', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)});
      alert('Sauvegardé.');
    }catch(e){ alert('Erreur de sauvegarde'); }
  }
  function saveToLocal(){
    const content = { team: state.team, roomId: state.roomId, meta:{ alea: state.drawn.alea, notes: getNotes() }, state: state.board };
    localStorage.setItem('schema-bloc-save', JSON.stringify(content));
    alert('Sauvegardé en local.');
  }
  async function loadFromServer(){
    if(!state.roomId || state.roomId==='SOLO'){ return loadFromLocal(); }
    try{
      const data = await api(`/load/${state.roomId}`);
      state.team = data.team || state.team;
      state.board = data.state || state.board;
      state.drawn.alea = (data.meta && data.meta.alea) || state.drawn.alea;
      setNotes((data.meta && data.meta.notes) || '');
      if(data.meta && data.meta.puzzleId){ await setPuzzleById(data.meta.puzzleId, { fromRemote:true }); }
      if(teamDisplay) teamDisplay.textContent = state.team;
      aleaDisplay.textContent = state.drawn.alea||'–';
      renderBoard();
    }catch(e){ alert('Erreur de chargement'); }
  }
  function loadFromLocal(){
    const raw = localStorage.getItem('schema-bloc-save');
    if(!raw) return alert('Aucune sauvegarde locale.');
    try{
      const data = JSON.parse(raw);
      state.team = data.team; if(teamDisplay) teamDisplay.textContent = state.team;
      state.board = data.state||state.board; state.drawn.alea = (data.meta&&data.meta.alea)||state.drawn.alea;
      setNotes((data.meta&&data.meta.notes)||'');
      aleaDisplay.textContent = state.drawn.alea||'–';
      renderBoard();
    }catch(e){ alert('Sauvegarde corrompue'); }
  }

  // Export PNG
  async function exportPNG(){
    const { dataUrl } = await svgToPngFull();
    downloadData(dataUrl, `schema-bloc_${state.team||'export'}.png`);
  }
  function computeContentBBox(){
    if(!state.board.blocks.length){ return {x:0,y:0,w:1200,h:800}; }
    let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
    state.board.blocks.forEach(b=>{
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    });
    // include link extents (centers)
    state.board.links.forEach(L=>{
      const from = state.board.blocks.find(b=>b.id===L.from);
      const to = state.board.blocks.find(b=>b.id===L.to);
      if(from && to){
        const x1 = from.x + from.w/2, y1 = from.y + from.h/2;
        const x2 = to.x + to.w/2, y2 = to.y + to.h/2;
        minX = Math.min(minX, x1, x2);
        minY = Math.min(minY, y1, y2);
        maxX = Math.max(maxX, x1, x2);
        maxY = Math.max(maxY, y1, y2);
      }
    });
    const pad = 40;
    return { x: Math.floor(minX - pad), y: Math.floor(minY - pad), w: Math.ceil((maxX-minX) + 2*pad), h: Math.ceil((maxY-minY) + 2*pad) };
  }
  async function svgToPngFull(opts={}){
    const { includeTitle=true } = opts;
    const clone = svg.cloneNode(true);
    // remove selection glow
    $$('.selected', clone).forEach(g=>g.classList.remove('selected'));
    // remove edge handles so they don't appear
    $$('.handle', clone).forEach(h=> h.parentNode && h.parentNode.removeChild(h));
    // inline styles for link types to ensure proper rasterization
    $$('.link.energy', clone).forEach(line=>{ line.setAttribute('stroke', '#d32f2f'); line.setAttribute('stroke-width', '4.5'); line.setAttribute('marker-end', 'url(#arrow-red)'); });
    $$('.link.control', clone).forEach(line=>{ line.setAttribute('stroke', '#2e7d32'); line.setAttribute('stroke-width', '3.5'); line.setAttribute('marker-end', 'url(#arrow-green)'); line.setAttribute('stroke-dasharray','4 3'); });
    $$('.link:not(.energy):not(.control)', clone).forEach(line=>{ line.setAttribute('stroke', '#1976d2'); line.setAttribute('stroke-width', '2.5'); line.setAttribute('marker-end', 'url(#arrow-blue)'); line.setAttribute('stroke-dasharray','6 4'); });
    const bbox = computeContentBBox();
    clone.setAttribute('viewBox', `${bbox.x} ${bbox.y} ${bbox.w} ${bbox.h}`);
    const xml = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([xml], {type:'image/svg+xml;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const img = new Image();
    const dataUrl = await new Promise((resolve)=>{
      img.onload = ()=>{
        // Reserve extra bands: title (top) and legend (bottom)
        const titleBand = includeTitle ? 48 : 0; // px
        const legendBand = 56; // px always include legend band to avoid overlap
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, bbox.w);
        canvas.height = Math.max(1, bbox.h + titleBand + legendBand);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,canvas.width,canvas.height);
        // Draw title band
        if(includeTitle){
          try{
            const title = (boardTitle && boardTitle.value && boardTitle.value.trim()) ? boardTitle.value.trim() : 'Schéma-bloc';
            ctx.save();
            ctx.fillStyle = '#111827';
            ctx.font = 'bold 18px system-ui,Segoe UI,Roboto,Helvetica,Arial';
            ctx.textBaseline = 'middle';
            const tx = 16, ty = Math.round(titleBand/2);
            ctx.fillText(title, tx, ty);
            ctx.restore();
          }catch{}
        }
        // Draw board image below title band
        ctx.drawImage(img, 0, titleBand, canvas.width, bbox.h);
        // Draw legend in dedicated bottom band (no overlap)
        try{
          const margin = 12; let x = margin, y = titleBand + bbox.h + Math.round(legendBand/2) - 16;
          ctx.save();
          ctx.font = '12px system-ui,Segoe UI,Roboto,Helvetica,Arial';
          ctx.textBaseline = 'middle'; ctx.fillStyle = '#111827';
          // Énergie
          ctx.strokeStyle = '#d32f2f'; ctx.lineWidth = 4.5; ctx.setLineDash([]);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x+28, y); ctx.stroke();
          ctx.fillText('Énergie', x+36, y);
          // Communication
          y += 16; ctx.strokeStyle = '#1976d2'; ctx.lineWidth = 2.5; ctx.setLineDash([6,4]);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x+28, y); ctx.stroke();
          ctx.setLineDash([]); ctx.fillText('Communication', x+36, y);
          // Contrôle
          y += 16; ctx.strokeStyle = '#2e7d32'; ctx.lineWidth = 3.5; ctx.setLineDash([4,3]);
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x+28, y); ctx.stroke();
          ctx.setLineDash([]); ctx.fillText('Contrôle', x+36, y);
          ctx.restore();
        }catch{}
        resolve(canvas.toDataURL('image/png'));
        URL.revokeObjectURL(url);
      };
      img.src = url;
    });
    return { dataUrl };
  }
  function downloadData(dataUrl, filename){
    const a = document.createElement('a'); a.href = dataUrl; a.download = filename; a.click();
  }

  // Export PDF (print-friendly)
  async function exportPDF(){
    // Use image with reserved legend band to avoid overlap, but no title
    const { dataUrl } = await svgToPngFull({ includeTitle:false });
    const w = window.open('', '_blank');
    const title = 'Construis ton système — Schéma-bloc';
    const meta = `Équipe: ${state.team||'-'} | Problématique: ${state.drawn.alea||'-'}`;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
      <style>
        body{margin:0;padding:24px;font:14px/1.4 system-ui,Segoe UI,Roboto,Helvetica,Arial;color:#111}
        h1{margin:0 0 6px 0;font-size:18px}
        .meta{margin-bottom:12px;color:#333}
        img{max-width:100%;border:1px solid #ccc}
        @media print{.autoprint{display:none}}
      </style></head><body>
      <div class="autoprint"></div>
      <h1>${title}</h1>
      <div class="meta">${meta}</div>
      <img src="${dataUrl}" />
      <script>window.onload=function(){ setTimeout(function(){ window.print(); window.close(); }, 200); }<\/script>
      </body></html>`);
    w.document.close();
  }

  // Wire tool buttons to setTool
  function initTools(){
    const ts = $('#tool-select'); if(ts){ ts.addEventListener('click', ()=> setTool('select')); }
    const te = $('#tool-energy'); if(te){ te.addEventListener('click', ()=> setTool('energy')); }
    const tg = $('#tool-signal'); if(tg){ tg.addEventListener('click', ()=> setTool('signal')); }
  }

  // Init
  (async function init(){
    initTools();
    try{ await ensureDeck(); }catch{}
    showHome();
    initCollapsiblePanels();
    // By default, collapse sidebar on small screens
    if(window.innerWidth < 900){ try{ document.body.classList.add('sidebar-collapsed'); }catch{} }
  })();

  function toggleHelp(show){
    helpModal.classList.toggle('hidden', !show);
  }

  // --- Room sync via SSE ---
  let es = null;
  function connectRoomStream(){
    try{ if(es){ es.close(); } }catch{}
    if(!state.roomId || state.roomId==='SOLO') return;
    const name = encodeURIComponent(state.team || 'Invité');
    es = new EventSource(`/api/room/${state.roomId}/events?client=${clientId}&name=${name}`);
    es.addEventListener('state_sync', (e)=>{
      try{
        const data = JSON.parse(e.data||'{}');
        if(data.team) state.team = data.team;
        if(data.state){ state.board = data.state; }
        if(data.meta){
          state.drawn.alea = data.meta.alea || state.drawn.alea;
          setNotes(data.meta.notes || '');
          if(boardTitle) boardTitle.value = data.meta.title || '';
          if(data.meta.puzzleId){ setPuzzleById(data.meta.puzzleId, { fromRemote:true }); }
        }
        if(teamDisplay) teamDisplay.textContent = state.team||'–';
        aleaDisplay.textContent = state.drawn.alea||'–';
        renderBoard();
      }catch{}
    });
    es.addEventListener('draws_updated', (e)=>{
      try{
        const data = JSON.parse(e.data||'{}');
        state.drawn.proposals = data.proposals||[];
        renderProposals();
      }catch{}
    });
    es.addEventListener('draw_chosen', (e)=>{
      try{
        const data = JSON.parse(e.data||'{}');
        const p = data.proposal || {};
        state.drawn.cards = p.elements || [];
        state.drawn.alea = (p.alea && p.alea.label) || null;
        state.drawn.proposals = [];
        renderDrawn();
      }catch{}
    });
    es.addEventListener('presence', (e)=>{
      try{
        const data = JSON.parse(e.data||'{}');
        roomPresence = data.clients || [];
        renderRoomIndicator();
      }catch{}
    });
  }

  async function syncIfRoom(){
    if(!state.roomId || state.roomId==='SOLO') return;
    try{
      const meta = { alea: state.drawn.alea, notes: getNotes() };
      if(state.puzzle && state.puzzle.id){ meta.puzzleId = state.puzzle.id; }
      if(boardTitle && boardTitle.value) meta.title = boardTitle.value;
      await api(`/api/room/${state.roomId}/sync`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ team: state.team, state: state.board, meta }) });
    }catch{}
  }

  function renderRoomIndicator(){
    if(!roomIndicator){ return; }
    const count = (roomPresence||[]).length;
    const names = (roomPresence||[]).map(p=>p.name||'Invité').join(', ');
    const base = state.roomId ? `Salle: ${state.roomId}` : '';
    roomIndicator.textContent = count ? `${base} — ${count} en ligne` : base;
    roomIndicator.title = names || '';
  }

  if(boardTitle){ boardTitle.addEventListener('change', syncIfRoom); }
  if(aleaNotes){ aleaNotes.addEventListener('change', syncIfRoom); }

  // --- Scoring & progression ---
  function computeScore(){
    let score = 0;
    const blocks = state.board.blocks.length;
    const links = state.board.links.length;
    const energy = state.board.links.filter(l=>l.type==='energy').length;
    const signal = links - energy;
    score += blocks * 10;
    score += energy * 8;
    score += signal * 5;
    if(energy>0 && signal>0) score += 15;
    if(blocks>=3 && links>=2) score += 10;
    const words = getNotes().trim().split(/\s+/).filter(Boolean).length;
    if(words>=6) score += 12;
    if(state.puzzle && Array.isArray(state.puzzle.suggested_blocks)){
      const titles = new Set(state.board.blocks.map(b=>b.title));
      let used = 0;
      state.puzzle.suggested_blocks.forEach(lbl=>{ if(titles.has(lbl)) used++; });
      score += Math.min(used*6, 30);
    }
    return Math.max(0, score);
  }
  function renderScore(){
    if(!scoreValue || !progressBar) return;
    const s = computeScore();
    scoreValue.textContent = String(s);
    const lvl = Math.floor(s/60);
    const pct = Math.min(100, Math.round((s - lvl*60)/60*100));
    progressBar.style.width = pct + '%';
    progressBar.title = `Niveau ${lvl} — ${pct}%`;
  }

  function updateLinkOptionsVisibility(){
    if(!linkOptions) return;
    const isLink = selectedId && selectedId.startsWith('link:');
    linkOptions.classList.toggle('hidden', !isLink);
  }

  if(linkSetEnergy){
    linkSetEnergy.addEventListener('click', ()=>{
      if(!(selectedId && selectedId.startsWith('link:'))) return;
      const rawId = selectedId.split(':')[1];
      const L = state.board.links.find(l=>l.id===rawId);
      if(L){ pushHistory(); L.type = 'energy'; renderBoard(); syncIfRoom(); }
    });
  }
  if(linkSetSignal){
    linkSetSignal.addEventListener('click', ()=>{
      if(!(selectedId && selectedId.startsWith('link:'))) return;
      const rawId = selectedId.split(':')[1];
      const L = state.board.links.find(l=>l.id===rawId);
      if(L){ pushHistory(); L.type = 'signal'; renderBoard(); syncIfRoom(); }
    });
  }

  // Bulle contextuelle pour changer le type de flèche
  function renderLinkBubble(){
    if(linkBubble){ try{ linkBubble.remove(); }catch(_){} linkBubble = null; }
    if(!(selectedId && selectedId.startsWith('link:'))) return;
    const rawId = selectedId.split(':')[1];
    const L = state.board.links.find(l=>l.id===rawId);
    if(!L) return;
    const from = state.board.blocks.find(b=>b.id===L.from);
    const to = state.board.blocks.find(b=>b.id===L.to);
    if(!from || !to) return;
    // Anchor near dragged endpoint if moving; else midpoint
    let ax, ay;
    const draggingBlockId = (dragging && dragging.type==='block') ? dragging.id
                         : (dragging && dragging.type==='multi') ? (dragging.ids && dragging.ids[0])
                         : null;
    if(draggingBlockId && (draggingBlockId===from.id || draggingBlockId===to.id)){
      const B = draggingBlockId===from.id ? from : to;
      ax = B.x + B.w/2; ay = B.y - 10;
    } else {
      ax = (from.x+from.w/2 + to.x+to.w/2)/2;
      ay = (from.y+from.h/2 + to.y+to.h/2)/2;
    }
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal; const sx = rect.width/vb.width; const sy = rect.height/vb.height;
    let px = rect.left + ax*sx; let py = rect.top + ay*sy;
    const div = document.createElement('div');
    div.className = 'link-bubble';
    // Clamp into viewport to avoid overflow
    const vpw = window.innerWidth, vph = window.innerHeight;
    const pad = 8;
    px = Math.max(pad, Math.min(vpw - pad, px));
    py = Math.max(pad + 16, Math.min(vph - pad, py));
    div.style.left = Math.round(px)+'px'; div.style.top = Math.round(py)+'px';
    const bE = document.createElement('button'); bE.className='energy'; bE.textContent='Énergie';
    const bS = document.createElement('button'); bS.className='signal'; bS.textContent='Communication';
    const bC = document.createElement('button'); bC.className='control'; bC.textContent='Contrôle';
    const bD = document.createElement('button'); bD.className='danger'; bD.title='Supprimer'; bD.textContent='🗑';
    bE.addEventListener('click', ()=>{ pushHistory(); L.type='energy'; renderBoard(); syncIfRoom(); });
    bS.addEventListener('click', ()=>{ pushHistory(); L.type='signal'; renderBoard(); syncIfRoom(); });
    bC.addEventListener('click', ()=>{ pushHistory(); L.type='control'; renderBoard(); syncIfRoom(); });
    bD.addEventListener('click', ()=>{ pushHistory(); state.board.links = state.board.links.filter(x=>x.id!==L.id); selected.clear(); selectedId=null; renderBoard(); syncIfRoom(); });
    div.appendChild(bE); div.appendChild(bS); div.appendChild(bC); div.appendChild(bD);
    document.body.appendChild(div);
    linkBubble = div;
  }

  // Bubble near selected block on mobile to start links
  function renderNodeBubble(){
    if(nodeBubble){ try{ nodeBubble.remove(); }catch(_){} nodeBubble = null; }
    if(!(isCoarse || window.innerWidth<900)) return;
    if(!(selectedId && selectedId.startsWith('block:'))) return;
    const rawId = selectedId.split(':')[1];
    const B = state.board.blocks.find(b=>b.id===rawId);
    if(!B) return;
    const rect = svg.getBoundingClientRect(); const vb = svg.viewBox.baseVal; const sx = rect.width/vb.width; const sy = rect.height/vb.height;
    // Fixed offset above the block center (no viewport clamping so it stays consistent)
    let px = rect.left + (B.x + B.w/2) * sx; let py = rect.top + (B.y - 6) * sy;
    const div = document.createElement('div');
    div.className = 'link-bubble';
    div.style.left = Math.round(px)+'px'; div.style.top = Math.round(py)+'px';
    const bE = document.createElement('button'); bE.className='energy'; bE.textContent='Énergie';
    const bS = document.createElement('button'); bS.className='signal'; bS.textContent='Communication';
    const bC = document.createElement('button'); bC.className='control'; bC.textContent='Contrôle';
    const bD = document.createElement('button'); bD.className='danger'; bD.title='Supprimer'; bD.textContent='🗑';
    function arm(type){ quickLink = { type, fromId: B.id }; setTool(type); showToast('Choisis un autre bloc pour relier.'); try{ div.remove(); }catch{} }
    bE.addEventListener('click', ()=>arm('energy'));
    bS.addEventListener('click', ()=>arm('signal'));
    bC.addEventListener('click', ()=>arm('control'));
    bD.addEventListener('click', ()=>{
      pushHistory();
      state.board.links = state.board.links.filter(L2 => L2.from!==B.id && L2.to!==B.id);
      state.board.blocks = state.board.blocks.filter(bb => bb.id!==B.id);
      selected.clear(); selectedId=null; renderBoard(); syncIfRoom();
    });
    div.appendChild(bE); div.appendChild(bS); div.appendChild(bC); div.appendChild(bD);
    document.body.appendChild(div);
    nodeBubble = div;
  }

  // Mobile toolbar (trash)
  function deleteSelection(){
    if(selected.size===0) return;
    pushHistory();
    const blocksToDelete = new Set(Array.from(selected).filter(s=>s.startsWith('block:')).map(s=>s.split(':')[1]));
    const linksToDelete = new Set(Array.from(selected).filter(s=>s.startsWith('link:')).map(s=>s.split(':')[1]));
    state.board.links = state.board.links.filter(L => !blocksToDelete.has(L.from) && !blocksToDelete.has(L.to) && !linksToDelete.has(L.id));
    state.board.blocks = state.board.blocks.filter(b => !blocksToDelete.has(b.id));
    selected.clear(); selectedId = null;
    renderBoard();
    syncIfRoom();
  }
  function renderMobileToolbar(){
    if(mobileToolbar){ try{ mobileToolbar.remove(); }catch(_){} mobileToolbar = null; }
    const isFocus = document.body && document.body.classList.contains('focus-mode');
    if(!(isCoarse || window.innerWidth<900 || isFocus)) return;
    const hasSel = selected && selected.size>0;
    if(!hasSel && !isFocus) return;
    const div = document.createElement('div');
    div.className = 'mobile-toolbar';
    if(hasSel){
      const trash = document.createElement('button');
      trash.className = 'fab danger';
      trash.title = 'Supprimer';
      trash.setAttribute('aria-label','Supprimer la sélection');
      trash.textContent = '🗑';
      trash.addEventListener('click', deleteSelection);
      div.appendChild(trash);
    }
    if(isFocus){
      const menu = document.createElement('button');
      menu.className = 'fab';
      menu.title = 'Ouvrir les menus';
      menu.setAttribute('aria-label','Ouvrir les menus');
      menu.textContent = '≡';
      menu.addEventListener('click', ()=>{ toggleOverlayPanels(); });
      div.appendChild(menu);
      const exit = document.createElement('button');
      exit.className = 'fab';
      exit.title = 'Quitter plein écran';
      exit.setAttribute('aria-label','Quitter plein écran');
      exit.textContent = '⤢';
      exit.addEventListener('click', ()=>{
        try{ document.body.classList.remove('focus-mode'); if(btnFocus) btnFocus.textContent='Plein écran'; }catch{}
        renderBoard();
      });
      div.appendChild(exit);
    }
    document.body.appendChild(div);
    mobileToolbar = div;
  }

  function toggleOverlayPanels(force){
    const open = (typeof force==='boolean') ? force : !document.body.classList.contains('overlay-open');
    if(open){
      document.body.classList.add('overlay-open');
      const backdrop = document.createElement('div');
      backdrop.className = 'overlay-backdrop';
      backdrop.id = 'overlay-backdrop';
      backdrop.addEventListener('click', ()=> toggleOverlayPanels(false));
      document.body.appendChild(backdrop);
    } else {
      document.body.classList.remove('overlay-open');
      const el = document.getElementById('overlay-backdrop'); if(el) try{ el.remove(); }catch{}
    }
  }
})();
