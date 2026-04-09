import type { WorldModelType } from "../schema/index.js";

/**
 * Export a world model as a self-contained HTML file with an interactive
 * SVG force-directed graph. No external dependencies — everything is inlined.
 */
export function toHtml(model: WorldModelType): string {
  const entities = model.entities;
  const relations = model.relations;

  // Color palette by entity type
  const TYPE_COLORS: Record<string, string> = {
    actor: "#4f86c6",
    system: "#6dab6d",
    object: "#b07cc6",
    concept: "#d4a843",
    location: "#e07050",
    event: "#50b0c0",
    group: "#a0c040",
    resource: "#c06080",
  };

  // Build JSON data for the embedded script
  const nodes = entities.map((e) => ({
    id: e.id,
    name: e.name,
    type: e.type,
    description: e.description,
    confidence: e.confidence ?? 1,
    color: TYPE_COLORS[e.type] ?? "#888",
  }));

  const links = relations.map((r) => ({
    id: r.id,
    source: r.source,
    target: r.target,
    type: r.type,
    label: r.label,
  }));

  const processes = model.processes.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    trigger: p.trigger ?? "",
    steps: p.steps.map((s) => ({
      order: s.order,
      action: s.action,
      actor:
        entities.find((e) => e.id === s.actor)?.name ?? s.actor ?? "—",
    })),
    outcomes: p.outcomes,
  }));

  const constraints = model.constraints.map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    severity: c.severity,
    description: c.description,
    scope: c.scope.map(
      (id) => entities.find((e) => e.id === id)?.name ?? id,
    ),
  }));

  const graphData = JSON.stringify({ nodes, links });
  const processData = JSON.stringify(processes);
  const constraintData = JSON.stringify(constraints);
  const modelMeta = JSON.stringify({
    id: model.id,
    name: model.name,
    description: model.description,
    version: model.version,
    created_at: model.created_at,
    confidence: model.metadata?.confidence ?? null,
    source_type: model.metadata?.source_type ?? null,
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(model.name)} — World Model</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#0f1117;color:#e0e0e0;min-height:100vh}
header{padding:20px 24px 12px;border-bottom:1px solid #2a2a3a}
header h1{font-size:1.5rem;font-weight:700;color:#fff}
header p{font-size:0.875rem;color:#8888aa;margin-top:4px}
.meta{display:flex;gap:16px;margin-top:8px;font-size:0.75rem;color:#6666aa}
.meta span{background:#1a1a2e;padding:2px 8px;border-radius:10px}
.layout{display:grid;grid-template-columns:1fr 280px;height:calc(100vh - 96px)}
#graph-container{position:relative;overflow:hidden;background:#0a0a14}
svg#graph{width:100%;height:100%;cursor:grab}
svg#graph.dragging{cursor:grabbing}
.node circle{cursor:pointer;stroke-width:2;stroke:rgba(255,255,255,0.2);transition:stroke 0.15s,r 0.15s}
.node circle:hover,.node circle.selected{stroke:#fff;stroke-width:2.5}
.node text{font-size:10px;fill:#ddd;pointer-events:none;text-shadow:0 0 3px #000}
.link line{stroke:rgba(255,255,255,0.25);stroke-width:1.5}
.link text{font-size:8px;fill:#888;pointer-events:none}
.link-arrow{fill:rgba(255,255,255,0.25)}
#sidebar{background:#13131f;overflow-y:auto;border-left:1px solid #2a2a3a;padding:0}
#sidebar-header{padding:14px 16px;border-bottom:1px solid #2a2a3a;font-size:0.8rem;font-weight:600;color:#8888cc;text-transform:uppercase;letter-spacing:0.05em}
#entity-panel{padding:14px 16px}
#entity-panel h2{font-size:1rem;font-weight:600;color:#fff;margin-bottom:4px}
.entity-type-badge{display:inline-block;font-size:0.7rem;padding:1px 8px;border-radius:10px;margin-bottom:10px;color:#fff;font-weight:600}
#entity-panel p{font-size:0.8rem;color:#aaa;line-height:1.5;margin-bottom:10px}
.prop-list{font-size:0.75rem}
.prop-list dt{color:#6666aa;font-weight:600;margin-top:6px}
.prop-list dd{color:#ccc;padding-left:8px}
.empty-state{color:#44445a;font-size:0.8rem;padding:20px 16px;text-align:center;line-height:1.6}
#legend{padding:12px 16px;border-top:1px solid #2a2a3a}
#legend h3{font-size:0.7rem;color:#6666aa;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px}
.legend-item{display:flex;align-items:center;gap:8px;font-size:0.75rem;color:#aaa;margin-bottom:4px}
.legend-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
#tables{padding:0 24px 24px;overflow-y:auto;background:#0f1117;grid-column:1/-1;border-top:1px solid #2a2a3a}
#tables h2{font-size:1rem;font-weight:600;color:#aaa;margin:20px 0 10px;text-transform:uppercase;letter-spacing:0.04em;font-size:0.8rem}
table{width:100%;border-collapse:collapse;font-size:0.8rem;margin-bottom:20px}
th{background:#1a1a2e;color:#8888cc;font-weight:600;padding:8px 12px;text-align:left;border-bottom:1px solid #2a2a3a}
td{padding:7px 12px;border-bottom:1px solid #1a1a2a;color:#ccc;vertical-align:top}
tr:hover td{background:#161626}
.badge{display:inline-block;padding:1px 7px;border-radius:10px;font-size:0.7rem;font-weight:600}
.badge-hard{background:#c0303050;color:#f07070}
.badge-soft{background:#c08a3050;color:#f0c070}
.confidence-low{color:#e07050}
</style>
</head>
<body>
<header>
  <h1 id="model-name"></h1>
  <p id="model-desc"></p>
  <div class="meta" id="meta-row"></div>
</header>
<div class="layout">
  <div id="graph-container">
    <svg id="graph">
      <defs>
        <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L0,6 L6,3 z" class="link-arrow"/>
        </marker>
      </defs>
      <g id="links-group"></g>
      <g id="nodes-group"></g>
    </svg>
  </div>
  <div id="sidebar">
    <div id="sidebar-header">Entity Details</div>
    <div id="entity-panel">
      <div class="empty-state">Click a node<br>to see details</div>
    </div>
    <div id="legend"></div>
  </div>
</div>
<div id="tables"></div>

<script>
(function(){
"use strict";

const GRAPH  = ${graphData};
const PROCS  = ${processData};
const CSTRS  = ${constraintData};
const META   = ${modelMeta};

// ── Meta header ────────────────────────────────────────────────
document.getElementById('model-name').textContent = META.name;
document.getElementById('model-desc').textContent = META.description;
const metaRow = document.getElementById('meta-row');
const addMeta = (label, val) => {
  if (!val) return;
  const s = document.createElement('span');
  s.textContent = label + ': ' + val;
  metaRow.appendChild(s);
};
addMeta('v', META.version);
addMeta('source', META.source_type);
if (META.confidence != null) addMeta('confidence', Math.round(META.confidence*100)+'%');
addMeta('entities', GRAPH.nodes.length);
addMeta('relations', GRAPH.links.length);

// ── Legend ─────────────────────────────────────────────────────
const legend = document.getElementById('legend');
legend.innerHTML = '<h3>Entity Types</h3>';
const seenTypes = [...new Set(GRAPH.nodes.map(n=>n.type))];
seenTypes.forEach(t => {
  const node = GRAPH.nodes.find(n=>n.type===t);
  const li = document.createElement('div');
  li.className = 'legend-item';
  li.innerHTML = '<span class="legend-dot" style="background:'+node.color+'"></span><span>'+t+'</span>';
  legend.appendChild(li);
});

// ── Tables ─────────────────────────────────────────────────────
const tables = document.getElementById('tables');

if (PROCS.length > 0) {
  let html = '<h2>Processes</h2><table><thead><tr><th>Name</th><th>Trigger</th><th>Steps</th><th>Outcomes</th></tr></thead><tbody>';
  PROCS.forEach(p => {
    const stepsHtml = p.steps.map(s=>s.order+'. '+esc(s.action)+(s.actor?' ('+esc(s.actor)+')':'')).join('<br>');
    html += '<tr><td><strong>'+esc(p.name)+'</strong><br><span style="color:#666;font-size:0.72rem">'+esc(p.description)+'</span></td>'
      + '<td>'+esc(p.trigger)+'</td>'
      + '<td>'+stepsHtml+'</td>'
      + '<td>'+p.outcomes.map(esc).join(', ')+'</td></tr>';
  });
  html += '</tbody></table>';
  tables.innerHTML += html;
}

if (CSTRS.length > 0) {
  let html = '<h2>Constraints</h2><table><thead><tr><th>Name</th><th>Type</th><th>Severity</th><th>Description</th><th>Scope</th></tr></thead><tbody>';
  CSTRS.forEach(c => {
    html += '<tr><td><strong>'+esc(c.name)+'</strong></td>'
      + '<td>'+esc(c.type)+'</td>'
      + '<td><span class="badge badge-'+c.severity+'">'+c.severity+'</span></td>'
      + '<td>'+esc(c.description)+'</td>'
      + '<td>'+c.scope.map(esc).join(', ')+'</td></tr>';
  });
  html += '</tbody></table>';
  tables.innerHTML += html;
}

function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── Force-directed graph ────────────────────────────────────────
const svgEl = document.getElementById('graph');
const linksG = document.getElementById('links-group');
const nodesG = document.getElementById('nodes-group');

const nodes = GRAPH.nodes.map(n => Object.assign({},n));
const links = GRAPH.links.map(l => Object.assign({},l));

// Build id → index map
const idxById = {};
nodes.forEach((n,i) => { idxById[n.id] = i; });
links.forEach(l => {
  l.si = idxById[l.source];
  l.ti = idxById[l.target];
});

// Init positions
let W = svgEl.clientWidth || 800;
let H = svgEl.clientHeight || 600;

nodes.forEach((n,i) => {
  const angle = (2*Math.PI*i)/nodes.length;
  const r = Math.min(W,H) * 0.3;
  n.x = W/2 + r*Math.cos(angle) + (Math.random()-0.5)*60;
  n.y = H/2 + r*Math.sin(angle) + (Math.random()-0.5)*60;
  n.vx = 0; n.vy = 0;
  n.pinned = false;
});

// Render links
function renderLinks() {
  linksG.innerHTML = '';
  links.forEach(l => {
    const g = document.createElementNS('http://www.w3.org/2000/svg','g');
    g.className.baseVal = 'link';
    const line = document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('marker-end','url(#arrow)');
    g.appendChild(line);
    const txt = document.createElementNS('http://www.w3.org/2000/svg','text');
    txt.textContent = l.type;
    g.appendChild(txt);
    linksG.appendChild(g);
    l._el = line;
    l._txt = txt;
  });
}

// Render nodes
const nodeEls = [];
function renderNodes() {
  nodesG.innerHTML = '';
  nodes.forEach((n,i) => {
    const g = document.createElementNS('http://www.w3.org/2000/svg','g');
    g.className.baseVal = 'node';
    const c = document.createElementNS('http://www.w3.org/2000/svg','circle');
    const radius = n.confidence < 0.5 ? 14 : 18;
    c.setAttribute('r', radius);
    c.setAttribute('fill', n.color);
    c.style.opacity = n.confidence < 0.5 ? '0.55' : '0.9';
    const txt = document.createElementNS('http://www.w3.org/2000/svg','text');
    txt.setAttribute('text-anchor','middle');
    txt.setAttribute('dy','30');
    txt.textContent = n.name.length > 14 ? n.name.slice(0,13)+'…' : n.name;
    g.appendChild(c);
    g.appendChild(txt);
    nodesG.appendChild(g);
    n._el = g;
    n._circle = c;
    nodeEls.push(g);

    // Click
    g.addEventListener('click', e => { e.stopPropagation(); selectNode(i); });

    // Drag
    let dragging = false, ox=0, oy=0;
    c.addEventListener('mousedown', e => {
      dragging = true; ox=e.clientX; oy=e.clientY;
      svgEl.classList.add('dragging');
      e.stopPropagation();
    });
    window.addEventListener('mousemove', e => {
      if(!dragging) return;
      const pt = svgPoint(e.clientX, e.clientY);
      n.x = pt.x; n.y = pt.y;
      n.vx=0; n.vy=0;
      n.pinned = true;
      tick();
    });
    window.addEventListener('mouseup', () => { if(dragging){ dragging=false; svgEl.classList.remove('dragging'); } });
  });
}

function svgPoint(cx,cy){
  const rect = svgEl.getBoundingClientRect();
  return { x: cx-rect.left, y: cy-rect.top };
}

// Sidebar
let selectedIdx = -1;
function selectNode(i){
  if(selectedIdx >= 0) nodes[selectedIdx]._circle.classList.remove('selected');
  selectedIdx = i;
  nodes[i]._circle.classList.add('selected');
  const n = nodes[i];
  const panel = document.getElementById('entity-panel');
  const cstrsForNode = CSTRS.filter(c=>c.scope.includes(n.name));
  const relList = links.filter(l=>l.si===i||l.ti===i).map(l=>{
    const other = l.si===i ? nodes[l.ti] : nodes[l.si];
    const dir = l.si===i ? '→' : '←';
    return dir+' '+esc(l.type)+' '+esc(other?.name||'?');
  }).join('<br>');
  panel.innerHTML = '<h2>'+esc(n.name)+'</h2>'
    +'<span class="entity-type-badge" style="background:'+n.color+'">'+esc(n.type)+'</span>'
    +'<p>'+esc(n.description)+'</p>'
    +(n.confidence<1?'<p class="confidence-low" style="font-size:0.72rem">Confidence: '+Math.round(n.confidence*100)+'%</p>':'')
    +(relList?'<dl class="prop-list"><dt>Relations</dt><dd>'+relList+'</dd></dl>':'')
    +(cstrsForNode.length?'<dl class="prop-list"><dt>Constraints</dt><dd>'+cstrsForNode.map(c=>'<span class="badge badge-'+c.severity+'">'+c.severity+'</span> '+esc(c.name)).join('<br>')+'</dd></dl>':'');
}

svgEl.addEventListener('click', () => {
  if(selectedIdx>=0){ nodes[selectedIdx]._circle.classList.remove('selected'); selectedIdx=-1; }
  document.getElementById('entity-panel').innerHTML='<div class="empty-state">Click a node<br>to see details</div>';
});

// Pan
let panning=false, panStart={x:0,y:0}, viewBox={x:0,y:0,w:W,h:H};
function setViewBox(){
  svgEl.setAttribute('viewBox',viewBox.x+' '+viewBox.y+' '+viewBox.w+' '+viewBox.h);
}
svgEl.addEventListener('mousedown', e=>{
  if(e.target===svgEl||e.target.tagName==='g'&&e.target.id==='links-group'||e.target.tagName==='g'&&e.target.id==='nodes-group'){
    panning=true; panStart={x:e.clientX,y:e.clientY};
  }
});
window.addEventListener('mousemove', e=>{
  if(!panning) return;
  const dx=(e.clientX-panStart.x)*(viewBox.w/W);
  const dy=(e.clientY-panStart.y)*(viewBox.h/H);
  viewBox.x-=dx; viewBox.y-=dy;
  panStart={x:e.clientX,y:e.clientY};
  setViewBox();
});
window.addEventListener('mouseup',()=>{ panning=false; });
svgEl.addEventListener('wheel', e=>{
  e.preventDefault();
  const factor = e.deltaY>0?1.1:0.9;
  const rect = svgEl.getBoundingClientRect();
  const mx = (e.clientX-rect.left)/W*viewBox.w+viewBox.x;
  const my = (e.clientY-rect.top)/H*viewBox.h+viewBox.y;
  viewBox.w*=factor; viewBox.h*=factor;
  viewBox.x=mx-(mx-viewBox.x)*factor;
  viewBox.y=my-(my-viewBox.y)*factor;
  setViewBox();
}, {passive:false});

// Force simulation (Euler integration)
const REPEL=4000, ATTRACT=0.04, DAMPING=0.85, CENTER=0.008, LINK_LEN=120;
let frame=0;

function simulate(){
  W = svgEl.clientWidth||800;
  H = svgEl.clientHeight||600;

  // Repulsion
  for(let i=0;i<nodes.length;i++){
    for(let j=i+1;j<nodes.length;j++){
      const dx=nodes[j].x-nodes[i].x, dy=nodes[j].y-nodes[i].y;
      const d2=Math.max(dx*dx+dy*dy,1);
      const f=REPEL/d2;
      const fx=f*dx/Math.sqrt(d2), fy=f*dy/Math.sqrt(d2);
      nodes[i].vx-=fx; nodes[i].vy-=fy;
      nodes[j].vx+=fx; nodes[j].vy+=fy;
    }
  }

  // Attraction along links
  links.forEach(l=>{
    const a=nodes[l.si], b=nodes[l.ti];
    if(!a||!b) return;
    const dx=b.x-a.x, dy=b.y-a.y;
    const d=Math.sqrt(dx*dx+dy*dy)||1;
    const f=ATTRACT*(d-LINK_LEN);
    const fx=f*dx/d, fy=f*dy/d;
    if(!a.pinned){a.vx+=fx;a.vy+=fy;}
    if(!b.pinned){b.vx-=fx;b.vy-=fy;}
  });

  // Center gravity
  nodes.forEach(n=>{
    if(n.pinned) return;
    n.vx+=CENTER*(W/2-n.x);
    n.vy+=CENTER*(H/2-n.y);
    n.vx*=DAMPING; n.vy*=DAMPING;
    n.x+=n.vx; n.y+=n.vy;
  });
}

function tick(){
  links.forEach(l=>{
    const a=nodes[l.si], b=nodes[l.ti];
    if(!a||!b) return;
    // shorten line by radius so arrow hits circle edge
    const dx=b.x-a.x, dy=b.y-a.y;
    const d=Math.sqrt(dx*dx+dy*dy)||1;
    const r=20;
    l._el.setAttribute('x1',a.x);
    l._el.setAttribute('y1',a.y);
    l._el.setAttribute('x2',b.x-dx/d*r);
    l._el.setAttribute('y2',b.y-dy/d*r);
    l._txt.setAttribute('x',(a.x+b.x)/2);
    l._txt.setAttribute('y',(a.y+b.y)/2-5);
  });
  nodes.forEach(n=>{
    n._el.setAttribute('transform','translate('+n.x+','+n.y+')');
  });
}

function loop(){
  if(frame<300) simulate();
  tick();
  frame++;
  requestAnimationFrame(loop);
}

// Init
viewBox = {x:0,y:0,w:W,h:H};
setViewBox();
renderLinks();
renderNodes();
loop();

// Handle resize
window.addEventListener('resize',()=>{
  W=svgEl.clientWidth||800;
  H=svgEl.clientHeight||600;
});

})();
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
