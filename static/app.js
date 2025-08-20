// Minimal vanilla JS UI + SVG board interactions
// Features: draw cards, add/move blocks, energy/signal links, double-click edit,
// grid snap, save/load via API, export PNG and print-to-PDF.

(function(){
  const $ = (sel, el=document) => el.querySelector(sel);
  const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));

  const state = {
    deck: null,
    roomId: null,
    team: "",
    grid: true,
    drawn: { cards: [], alea: null },
    board: { blocks: [], links: [] },
  };

  // Views
  const viewHome = $('#view-home');
  const viewBoard = $('#view-board');
  const roomIndicator = $('#room-indicator');
  const teamDisplay = $('#team-display');
  const teamInput = $('#team-name');
  const joinCode = $('#join-code');
  const aleaDisplay = $('#alea-display');
  const drawnCardsEl = $('#drawn-cards');
  const aleaNotes = $('#alea-notes');
  const toggleGrid = $('#toggle-grid');

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
    </marker>`;
  svg.appendChild(defs);

  const linksLayer = document.createElementNS(svgNS, 'g');
  const blocksLayer = document.createElementNS(svgNS, 'g');
  svg.appendChild(linksLayer);
  svg.appendChild(blocksLayer);

  // Helpers
  const id = () => Math.random().toString(36).slice(2,10);
  const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));
  const snap = (v)=> state.grid ? Math.round(v/20)*20 : v;

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

  // Draw cards
async function drawCards(){
  try{
    const res = await api('/api/draw', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ roomId: state.roomId||'SOLO' })});
    state.drawn.cards = res.elements || [];
    state.drawn.alea = res.alea && res.alea.label;
  }catch{
    const cats = state.deck.categories;
    const elementsPool = Object.entries(cats).flatMap(([cat, arr]) => (cat==='Sources'||cat==='Traitement'||cat==='Communication'||cat==='CapteursActionneurs'||cat==='Usages')
      ? arr.map(x=>({category:cat, label:x})) : []);
    const aleas = (state.deck.aleas||[]).slice();
    function pickMany(arr, n){ const tmp = arr.slice(); for(let i=tmp.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [tmp[i],tmp[j]]=[tmp[j],tmp[i]]; } return tmp.slice(0,n); }
    state.drawn.cards = pickMany(elementsPool, 4);
    state.drawn.alea = pickMany(aleas, 1)[0];
  }
  renderDrawn();
}

function renderDrawn(){
    drawnCardsEl.innerHTML = '';
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
  }

  function addBlockFromCard(card){
    const b = {
      id: id(), x: snap(120 + state.board.blocks.length*40), y: snap(120), w: 220, h: 90,
      title: (card.label || card.name), category: (card.category || card.cat)
    };
    state.board.blocks.push(b);
    renderBoard();
  }

  function addAdHocBlock(){
    const name = prompt('Nom du bloc ?');
    if(!name) return;
    const b = { id:id(), x:snap(240), y:snap(220), w:220, h:90, title:name, category:'Personnalisé' };
    state.board.blocks.push(b);
    renderBoard();
  }

  // Board interactions
  let dragging = null; // {type:'block', id, dx, dy}
  let linkDraft = null; // {type:'energy'|'signal', fromId, x1,y1,x2,y2}
  let selectedId = null; // block or link id prefix with type

  function renderBoard(){
    // clear layers
    linksLayer.innerHTML = '';
    blocksLayer.innerHTML = '';

    // Links first
    state.board.links.forEach(L => {
      const from = state.board.blocks.find(b=>b.id===L.from);
      const to = state.board.blocks.find(b=>b.id===L.to);
      if(!from || !to) return;
      const x1 = from.x + from.w/2; const y1 = from.y + from.h/2;
      const x2 = to.x + to.w/2; const y2 = to.y + to.h/2;
      const path = document.createElementNS(svgNS,'line');
      path.setAttribute('x1', x1); path.setAttribute('y1', y1);
      path.setAttribute('x2', x2); path.setAttribute('y2', y2);
      path.classList.add('link');
      if(L.type==='energy'){
        path.classList.add('energy');
        path.setAttribute('stroke', '#d32f2f');
        path.setAttribute('stroke-width', '4.5');
        path.setAttribute('marker-end', 'url(#arrow-red)');
      }else{
        path.setAttribute('stroke', '#1976d2');
        path.setAttribute('stroke-width', '2.5');
        path.setAttribute('marker-end', 'url(#arrow-blue)');
      }
      path.dataset.id = L.id;
      path.addEventListener('dblclick', ()=>{
        const t = prompt('Texte du lien ?', L.label||'');
        if(t!=null){ L.label = t; renderBoard(); }
      });
      path.addEventListener('click', (e)=>{ e.stopPropagation(); select(`link:${L.id}`); });
      linksLayer.appendChild(path);

      if(L.label){
        const midx = (x1+x2)/2, midy=(y1+y2)/2;
        const g = document.createElementNS(svgNS,'g');
        const rect = document.createElementNS(svgNS,'rect');
        const txt = document.createElementNS(svgNS,'text');
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
      }else{
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
      if(selectedId===`block:${B.id}`) g.classList.add('selected');
      g.dataset.id = B.id;

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
      t1.setAttribute('font-size', '16');
      t1.setAttribute('font-weight', '700');
      t1.textContent = B.title;
      g.appendChild(t1);

      // category badge (color)
      const t2 = document.createElementNS(svgNS,'text');
      t2.setAttribute('x', B.x + 12); t2.setAttribute('y', B.y + 52);
      t2.setAttribute('class','category');
      t2.setAttribute('fill', categoryColor(B.category));
      t2.setAttribute('font-size', '12');
      t2.setAttribute('font-weight', '700');
      t2.textContent = B.category;
      g.appendChild(t2);

      g.addEventListener('pointerdown', (e)=>{
        if(g.setPointerCapture){ try{ g.setPointerCapture(e.pointerId); }catch(_){} }
        const pt = toSvgPoint(e);
        if(currentTool==='select'){
          dragging = { type:'block', id:B.id, dx: pt.x - B.x, dy: pt.y - B.y };
          select(`block:${B.id}`);
        } else if(currentTool==='energy' || currentTool==='signal'){
          const cx = B.x + B.w/2, cy=B.y + B.h/2;
          linkDraft = { type:currentTool, fromId: B.id, x1: cx, y1: cy, x2: cx, y2: cy };
        }
      });
      // also attach on rect for reliable hit
      rect.addEventListener('pointerdown', (e)=>{
        if(g.setPointerCapture){ try{ g.setPointerCapture(e.pointerId); }catch(_){} }
        const pt = toSvgPoint(e);
        if(currentTool==='select'){
          dragging = { type:'block', id:B.id, dx: pt.x - B.x, dy: pt.y - B.y };
          select(`block:${B.id}`);
        } else if(currentTool==='energy' || currentTool==='signal'){
          const cx = B.x + B.w/2, cy=B.y + B.h/2;
          linkDraft = { type:currentTool, fromId: B.id, x1: cx, y1: cy, x2: cx, y2: cy };
        }
      });
      g.addEventListener('dblclick', ()=>{
        const t = prompt('Titre du bloc ?', B.title);
        if(t!=null){ B.title = t; renderBoard(); }
      });
      blocksLayer.appendChild(g);
    });
  }

  function select(idStr){ selectedId = idStr; renderBoard(); }

  function toSvgPoint(evt){
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    const res = pt.matrixTransform(svg.getScreenCTM().inverse());
    return res;
  }

  svg.addEventListener('pointermove', (e)=>{
    const pt = toSvgPoint(e);
    if(dragging && dragging.type==='block'){
      const B = state.board.blocks.find(b=>b.id===dragging.id);
      if(!B) return;
      B.x = snap(pt.x - dragging.dx);
      B.y = snap(pt.y - dragging.dy);
      renderBoard();
    } else if(linkDraft){
      linkDraft.x2 = pt.x; linkDraft.y2 = pt.y; renderBoard();
    }
  });
  svg.addEventListener('pointerup', (e)=>{
    const pt = toSvgPoint(e);
    if(dragging){ dragging = null; }
    if(linkDraft){
      // check if released over a block
      const target = state.board.blocks.find(b => pt.x>=b.x && pt.x<=b.x+b.w && pt.y>=b.y && pt.y<=b.y+b.h);
      if(target && target.id !== linkDraft.fromId){
        state.board.links.push({ id:id(), type:linkDraft.type, from:linkDraft.fromId, to:target.id });
      }
      linkDraft = null; renderBoard();
    }
  });
  svg.addEventListener('click', ()=> select(null));

  // Buttons
  $('#btn-home').addEventListener('click', ()=>{ showHome(); });
  $('#btn-solo').addEventListener('click', async ()=>{ await ensureDeck(); state.roomId = 'SOLO'; state.team = teamInput.value.trim()||'Solo'; enterBoard(); });
  $('#btn-create').addEventListener('click', async ()=>{
    await ensureDeck();
    const team = teamInput.value.trim();
    const res = await api('/create', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({team})});
    state.roomId = res.roomId; state.team = team||`Équipe ${res.roomId}`; enterBoard();
  });
  $('#btn-join').addEventListener('click', async ()=>{
    await ensureDeck();
    const code = joinCode.value.trim(); if(!code) return alert('Entrez un code.');
    try{
      const res = await api('/join', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({roomId: code})});
      state.roomId = res.roomId; state.team = teamInput.value.trim()||`Équipe ${res.roomId}`; enterBoard();
    }catch(err){ alert('Salle introuvable'); }
  });

  $('#btn-draw').addEventListener('click', ()=>{ if(!state.deck) return; drawCards(); });
  $('#tool-add-block').addEventListener('click', addAdHocBlock);
  toggleGrid.addEventListener('change', ()=>{ state.grid = toggleGrid.checked; });

  $('#btn-save').addEventListener('click', saveToServer);
  $('#btn-load').addEventListener('click', loadFromServer);
  $('#btn-export-png').addEventListener('click', ()=>{ if(validateBeforeExport()) exportPNG(); });
  $('#btn-export-pdf').addEventListener('click', ()=>{ if(validateBeforeExport()) exportPDF(); });
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

  function showHome(){
    viewHome.classList.remove('hidden');
    viewBoard.classList.add('hidden');
    roomIndicator.textContent = '';
  }
  function enterBoard(){
    teamDisplay.textContent = state.team||'–';
    roomIndicator.textContent = state.roomId ? `Salle: ${state.roomId}` : '';
    viewHome.classList.add('hidden');
    viewBoard.classList.remove('hidden');
    renderBoard();
  }

  // Validation douce avant export
  function validateBeforeExport(){
    const titleEl = document.querySelector('#board-title');
    const title = titleEl ? titleEl.value.trim() : '';
    const energy = state.board.links.some(l=>l.type==='energy');
    const signal = state.board.links.some(l=>l.type!=='energy');
    const chainOk = state.board.blocks.length >= 3 && state.board.links.length >= 2;
    const words = (aleaNotes.value||'').trim().split(/\s+/).filter(Boolean);
    const aleaOk = !!state.drawn.alea && words.length >= 6;

    const missing = [];
    if(!title) missing.push('Titre manquant');
    if(!energy) missing.push('Ajouter une flèche Énergie');
    if(!signal) missing.push('Ajouter une flèche Signal');
    if(!chainOk) missing.push('Au moins 3 blocs reliés');
    if(!aleaOk) missing.push('Aléa + adaptation (≥ 6 mots)');

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
    const content = { team: state.team, roomId: state.roomId, meta:{ alea: state.drawn.alea, notes: aleaNotes.value }, state: state.board };
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
      aleaNotes.value = (data.meta && data.meta.notes) || '';
      teamDisplay.textContent = state.team;
      aleaDisplay.textContent = state.drawn.alea||'–';
      renderBoard();
    }catch(e){ alert('Erreur de chargement'); }
  }
  function loadFromLocal(){
    const raw = localStorage.getItem('schema-bloc-save');
    if(!raw) return alert('Aucune sauvegarde locale.');
    try{
      const data = JSON.parse(raw);
      state.team = data.team; teamDisplay.textContent = state.team;
      state.board = data.state||state.board; state.drawn.alea = (data.meta&&data.meta.alea)||state.drawn.alea;
      aleaNotes.value = (data.meta&&data.meta.notes)||'';
      aleaDisplay.textContent = state.drawn.alea||'–';
      renderBoard();
    }catch(e){ alert('Sauvegarde corrompue'); }
  }

  // Export PNG
  async function exportPNG(){
    const { dataUrl } = await svgToPng();
    downloadData(dataUrl, `schema-bloc_${state.team||'export'}.png`);
  }
async function svgToPng(){
    const clone = svg.cloneNode(true);
    // remove selection glow
    $$('.selected', clone).forEach(g=>g.classList.remove('selected'));
    // inline styles for link types to ensure proper rasterization
    $$('.link.energy', clone).forEach(line=>{ line.setAttribute('stroke', '#d32f2f'); line.setAttribute('stroke-width', '4.5'); line.setAttribute('marker-end', 'url(#arrow-red)'); });
    $$('.link:not(.energy)', clone).forEach(line=>{ line.setAttribute('stroke', '#1976d2'); line.setAttribute('stroke-width', '2.5'); line.setAttribute('marker-end', 'url(#arrow-blue)'); line.setAttribute('stroke-dasharray','6 4'); });
    const xml = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([xml], {type:'image/svg+xml;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const img = new Image();
    const vw = 1200, vh = 800;
    const dataUrl = await new Promise((resolve)=>{
      img.onload = ()=>{
        const canvas = document.createElement('canvas');
        canvas.width = vw; canvas.height = vh;
        const ctx = canvas.getContext('2d');
        // background (light)
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,vw,vh);
        ctx.drawImage(img,0,0);
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
    const { dataUrl } = await svgToPng();
    const w = window.open('', '_blank');
    const title = 'Construis ton système — Schéma-bloc';
    const meta = `Équipe: ${state.team||'-'} | Aléa: ${state.drawn.alea||'-'}`;
    const notes = (aleaNotes.value||'').replace(/</g,'&lt;');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
      <style>
        body{font:14px/1.4 system-ui,Segoe UI,Roboto,Helvetica,Arial;padding:24px;color:#111}
        h1{margin:0 0 6px 0;font-size:20px}
        .meta{margin-bottom:12px;color:#333}
        img{max-width:100%;border:1px solid #ccc}
        .notes{margin-top:12px;white-space:pre-wrap}
        @media print{button{display:none}}
      </style></head><body>
      <button onclick="window.print()">Imprimer / Exporter en PDF</button>
      <h1>${title}</h1>
      <div class="meta">${meta}</div>
      <img src="${dataUrl}" />
      <h3>Adaptation à l’aléa</h3>
      <div class="notes">${notes}</div>
      </body></html>`);
    w.document.close();
  }

  // Wire tool buttons to setTool
  function initTools(){
    $('#tool-select').addEventListener('click', ()=> setTool('select'));
    $('#tool-energy').addEventListener('click', ()=> setTool('energy'));
    $('#tool-signal').addEventListener('click', ()=> setTool('signal'));
  }

  // Init
  (async function init(){
    initTools();
    try{ await ensureDeck(); }catch{}
    showHome();
  })();

  function toggleHelp(show){
    helpModal.classList.toggle('hidden', !show);
  }
})();
