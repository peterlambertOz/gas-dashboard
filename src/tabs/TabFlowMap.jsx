import { useMemo, useState, useEffect, useCallback } from 'react';

// ─── Colour helpers ────────────────────────────────────────────────────────────
function flowColor(val, maxVal) {
  if (!val || Math.abs(val) < 1) return '#2a4060';
  if (val < 0) return '#60a5fa';
  const r = Math.min(val / maxVal, 1);
  if (r > 0.65) return '#f97316';
  if (r > 0.3)  return '#facc15';
  return '#4ade80';
}
function flowWidth(val, maxVal) {
  // Constant width — colour encodes flow level, not thickness
  return (!val || Math.abs(val) < 1) ? 1.5 : 3;
}
function fmtTJ(v) {
  if (v == null || isNaN(v) || Math.abs(v) < 0.5) return '—';
  return Math.round(Math.abs(v)).toLocaleString();
}

// ─── Geographic projection ────────────────────────────────────────────────────
// Bounding box: lon 136–154 E, lat -44 to -21 S → viewBox 0 0 900 720
const LON_MIN = 136.0, LON_MAX = 154.5, LAT_MIN = -44.5, LAT_MAX = -20.5;
const VB_W = 900, VB_H = 720;
function geo(lon, lat) {
  const x = ((lon - LON_MIN) / (LON_MAX - LON_MIN)) * VB_W;
  const y = VB_H - ((lat - LAT_MIN) / (LAT_MAX - LAT_MIN)) * VB_H;
  return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
}
function gp(lon, lat) { const [x,y] = geo(lon,lat); return `${x},${y}`; }

// ─── Eastern Australia coastline (detailed) ───────────────────────────────────
const COAST = [
  // Cape York south along QLD east coast
  [145.5,-10.7],[146.0,-12.0],[146.5,-14.0],[145.8,-16.8],[146.2,-18.0],
  [147.1,-19.3],[148.5,-20.7],[148.9,-21.6],[150.3,-22.5],[150.8,-23.4],
  [151.3,-23.7],[151.3,-24.2],[152.0,-24.9],[152.9,-25.3],[153.2,-26.4],
  [153.5,-27.5],[153.4,-28.0],[153.6,-29.0],[153.3,-30.0],[152.5,-31.5],
  // NSW south coast
  [152.0,-32.5],[151.5,-33.3],[151.2,-33.9],[151.3,-34.2],
  [150.8,-35.0],[150.5,-35.7],[149.9,-37.0],[148.3,-37.9],[147.8,-38.1],
  // VIC coast
  [147.3,-38.3],[146.0,-38.9],[145.0,-38.3],[144.7,-38.4],[144.2,-38.3],
  [143.5,-38.7],[142.5,-38.6],[141.7,-38.5],[141.0,-38.0],
  [140.4,-38.6],[139.8,-38.6],[139.2,-38.1],[138.8,-37.8],
  // SA gulfs
  [138.5,-36.9],[138.2,-36.0],[138.0,-35.7],[137.6,-35.6],[136.9,-35.7],
  [136.5,-35.6],[136.3,-34.9],[135.5,-35.0],[135.0,-34.8],
  [134.8,-33.4],[136.0,-33.2],[136.5,-34.0],[137.3,-33.0],
  [138.0,-33.2],[138.5,-34.9],[138.5,-35.5],
  // Spencer Gulf and back up
  [137.9,-35.7],[137.6,-35.6],[137.0,-35.7],[136.6,-35.5],[136.5,-34.9],
  [137.5,-34.0],[138.0,-33.2],
  // North SA coast up to NT border
  [138.5,-32.0],[138.5,-28.0],[137.5,-25.0],[136.8,-22.0],
  [136.5,-20.5]
].map(([lon,lat]) => gp(lon,lat)).join(' ');

// Tasmania outline
const TAS = [
  [144.8,-40.5],[145.3,-40.7],[146.5,-40.8],[148.3,-40.5],
  [148.5,-41.0],[148.3,-42.5],[147.8,-43.6],[147.1,-43.6],
  [146.0,-43.5],[145.2,-42.5],[144.8,-41.5],[144.8,-40.5]
].map(([lon,lat]) => gp(lon,lat)).join(' ');

// State border lines
const BORDERS = [
  // QLD/NSW (29°S from 141 to coast)
  [[141,-29],[148.5,-29],[150.5,-28.5],[151.2,-28.8],[153.1,-28.2]],
  // NSW/VIC (from 141°E south at 34°S then diagonal)
  [[141,-34],[143,-34],[145,-35.5],[147,-36.0],[149,-37.5],[150.0,-37.5]],
  // SA/NSW (141°E from 29°S to 34°S)
  [[141,-29],[141,-34]],
  // SA/VIC (141°E from 34°S to coast)
  [[141,-34],[141,-38.5]],
  // SA/QLD
  [[138,-26],[141,-26],[141,-29]],
  // SA/NT 
  [[138,-26],[138,-20.5]],
].map(pts => pts.map(([lon,lat]) => gp(lon,lat)).join(' '));

// ─── Node positions ───────────────────────────────────────────────────────────
const N = {
  // Production / hubs
  wallumbilla:   geo(148.68, -26.60),
  moomba:        geo(140.19, -28.10),
  longford:      geo(147.18, -38.10),
  iona:          geo(143.07, -38.50),
  otway:         geo(142.50, -38.90),
  ballera:       geo(141.80, -27.40),
  culcairn:      geo(147.02, -35.67),  // Culcairn — MSP spur terminus, connects to VNI
  young_junc:    geo(148.30, -34.30),  // virtual junction near Young NSW — MSP spur branches here
  msp_canberra_junc: geo(149.3, -34.5),  // virtual point on MSP north of Canberra → ACT spur
  egp_canberra_junc: geo(150.2, -35.3),  // virtual junction on EGP near Canberra
  vts_hub:       geo(144.96, -37.81),   // VTS zone centred on Melbourne
  curtis_island: geo(151.25, -23.55),  // Curtis Island LNG terminal
  // Demand cities
  brisbane:      geo(153.02, -27.47),
  gladstone:     geo(151.26, -24.00),  // Gladstone, slightly south of Curtis Island
  sydney:        geo(151.20, -33.87),
  canberra:      geo(149.13, -35.28),
  adelaide:      geo(138.60, -34.93),
  tasmania:      geo(146.00, -42.10),
};
// Helper to get x,y from node key
function np(key) { return N[key]; }
function nxy(key) { const [x,y] = N[key]; return {x,y}; }

// ─── Pipeline definitions ─────────────────────────────────────────────────────
// waypoints: array of [lon,lat] intermediate points for curved routes
// from/to: node keys; field: record key; maxVal for colour scaling
const PIPES = [
  // ── QLD LNG export: three independent pipes fanned NW→SE ─────────────────
  // labelFrac:0.3 anchors leader to western section where pipes are well separated
  { id:'glng',  label:'GLNG',  field:'map_glng',  maxVal:900,  labelFrac:0.3, labelOffset:[-20,-45],
    waypoints:[[147.8,-25.5],[149.0,-23.2],[150.6,-23.4]], from:'wallumbilla', to:'curtis_island' },
  { id:'aplng', label:'APLNG', field:'map_aplng', maxVal:1800, labelFrac:0.3, labelOffset:[0,-65],
    waypoints:[[149.2,-25.2],[150.5,-23.8],[151.0,-23.5]], from:'wallumbilla', to:'curtis_island' },
  { id:'wgp',   label:'WGP',   field:'map_wgp_lng', maxVal:1800, labelFrac:0.3, labelOffset:[30,-45],
    waypoints:[[149.8,-25.8],[151.3,-25.0],[151.4,-24.2]], from:'wallumbilla', to:'curtis_island' },

  // ── QLD domestic ──────────────────────────────────────────────────────────
  { id:'qgp',   label:'QGP',   field:'map_qgp_qld',  maxVal:250, labelFrac:0.5, labelOffset:[30,15],
    waypoints:[[150.2,-27.5],[151.2,-25.8]], from:'wallumbilla', to:'gladstone' },
  { id:'rbp',   label:'RBP',   field:'map_rbp_bris', maxVal:200, labelFrac:0.5, labelOffset:[0,35],
    waypoints:[[149.8,-27.0],[151.8,-27.3]], from:'wallumbilla', to:'brisbane' },

  // ── SWQP trunk (bidirectional, Wallumbilla ↔ Moomba) ─────────────────────
  { id:'swqp',  label:'SWQP',  field:'qld_net_flow', maxVal:700, bidir:true, labelFrac:0.5,
    waypoints:[[145.5,-27.2],[142.5,-27.8]], from:'wallumbilla', to:'moomba' },

  // CGP: Ballera junction (ghost)
  { id:'cgp',   label:'CGP',   field:'map_cgp_ball', maxVal:100, labelFrac:0.5,
    waypoints:[], from:'ballera', to:'moomba', ghost:true },

  // ── Cooper Basin south ────────────────────────────────────────────────────
  { id:'maps',  label:'MAPS',  field:'map_maps_sa',  maxVal:350, labelFrac:0.5,
    waypoints:[[139.5,-31.5],[139.2,-33.0]], from:'moomba', to:'adelaide' },

  // ── MSP: Moomba → Sydney via Young (main trunk, no hubs at Young) ──────────
  { id:'msp',    label:'MSP',  field:'map_msp_nsw',  maxVal:600, labelFrac:0.4,
    waypoints:[[144.0,-30.5],[147.5,-32.5],[148.30,-34.30],[149.3,-34.5],[150.0,-33.9]],
    from:'moomba', to:'sydney' },

  // ── MSP spur: Young → Culcairn (south through Wagga Wagga, no intermediate hubs) ─
  { id:'msp_culcairn', label:'', field:'map_msp_nsw', maxVal:600,
    waypoints:[[147.8,-34.9],[147.4,-35.2]], from:'young_junc', to:'culcairn' },

  // ── MSP spur to Canberra: branches east off MSP trunk near Yass ──────────
  { id:'msp_cbr', label:'',   field:'map_msp_nsw',  maxVal:200,
    waypoints:[[149.3,-35.0]], from:'msp_canberra_junc', to:'canberra' },

  // ── EGP: Longford → (east of Canberra) → Sydney (coastal route) ──────────
  // EGP runs east of MSP/VNI — separate physical pipeline up the coast
  { id:'egp',   label:'EGP',  field:'map_egp_nsw',  maxVal:280, labelFrac:0.55, labelOffset:[10, 30],
    waypoints:[[148.8,-37.2],[149.5,-36.2],[150.2,-35.0],[150.7,-34.0],[151.0,-33.8]],
    from:'longford', to:'sydney' },

  // ── EGP spur to Canberra (branch east of Canberra) ───────────────────────
  { id:'egp_cbr', label:'',   field:'map_egp_nsw',  maxVal:200,
    waypoints:[[149.8,-35.0]], from:'egp_canberra_junc', to:'canberra' },

  // ── VNI: Culcairn → VTS hub (runs SW, west of Canberra) ─────────────────
  { id:'vni',   label:'VNI',  field:'map_vni',       maxVal:250, labelFrac:0.45,
    waypoints:[[147.2,-36.0],[146.0,-37.0]], from:'culcairn', to:'vts_hub' },

  // ── VTS spokes ────────────────────────────────────────────────────────────
  { id:'lmp',   label:'LMP',  field:'map_vts_vic',   maxVal:1200, labelFrac:0.4,
    waypoints:[[146.2,-37.9]], from:'longford', to:'vts_hub' },
  { id:'swp',   label:'SWP',  field:'map_swp',       maxVal:400, labelFrac:0.5,
    waypoints:[[143.8,-38.1],[144.5,-38.0]], from:'iona', to:'vts_hub' },

  // ── Otway Basin ───────────────────────────────────────────────────────────
  { id:'pci',   label:'PCI',  field:'map_pci_iona',  maxVal:300, labelFrac:0.5, bidir:true,
    waypoints:[], from:'otway', to:'iona' },
  // PCA mainline (SEA Gas system): Port Campbell → Adelaide (680km)
  // The WUGS lateral connecting the Iona Gas Plant joins at Port Campbell
  // PCI handles Port Campbell ↔ Iona (already shown separately above)
  // map_pca_sa = SA deliveries from this pipeline; map_sesa = gas tracked via Iona
  { id:'pca',   label:'PCA (SEA Gas)', field:'map_pca_sa', maxVal:314, labelFrac:0.4,
    waypoints:[[141.5,-38.6],[140.0,-37.8],[139.0,-36.5],[138.5,-35.8]], from:'otway', to:'adelaide' },

  // ── TGP ───────────────────────────────────────────────────────────────────
  { id:'tgp',   label:'TGP',  field:'map_tgp_tas',   maxVal:120, labelFrac:0.5,
    waypoints:[[147.2,-40.2]], from:'longford', to:'tasmania' },
];

// ─── Build SVG path from waypoints ───────────────────────────────────────────
function buildPath(pipe) {
  const [x1, y1] = np(pipe.from);
  const [x2, y2] = np(pipe.to);
  const pts = [[...np(pipe.from)], ...pipe.waypoints.map(([lon,lat]) => geo(lon,lat)), [...np(pipe.to)]];

  if (pts.length === 2) return `M ${x1} ${y1} L ${x2} ${y2}`;

  // Catmull-Rom → cubic bezier approximation
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i-1)];
    const p1 = pts[i];
    const p2 = pts[i+1];
    const p3 = pts[Math.min(pts.length-1, i+2)];
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}

// Offset a path perpendicular by `offset` pixels (for parallel pipes)
function buildOffsetPath(pipe, offset) {
  if (!offset) return buildPath(pipe);
  const [fx, fy] = np(pipe.from);
  const [tx, ty] = np(pipe.to);
  // Simple: translate the direct segment perpendicular
  const angle = Math.atan2(ty - fy, tx - fx);
  const dx = -Math.sin(angle) * offset;
  const dy =  Math.cos(angle) * offset;
  const pts = [[...np(pipe.from)], ...pipe.waypoints.map(([lon,lat]) => geo(lon,lat)), [...np(pipe.to)]];
  const shifted = pts.map(([x,y]) => [x+dx, y+dy]);
  if (shifted.length === 2) return `M ${shifted[0][0]} ${shifted[0][1]} L ${shifted[1][0]} ${shifted[1][1]}`;
  let d = `M ${shifted[0][0]} ${shifted[0][1]}`;
  for (let i = 0; i < shifted.length - 1; i++) {
    const p0 = shifted[Math.max(0, i-1)];
    const p1 = shifted[i]; const p2 = shifted[i+1];
    const p3 = shifted[Math.min(shifted.length-1, i+2)];
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6; const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6; const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}

// Get midpoint along path for label placement
function pathMid(pipe) {
  const pts = [[...np(pipe.from)], ...pipe.waypoints.map(([lon,lat]) => geo(lon,lat)), [...np(pipe.to)]];
  const mid = pts[Math.floor(pts.length / 2)];
  const nxt = pts[Math.min(Math.floor(pts.length / 2) + 1, pts.length - 1)];
  return { x: (mid[0] + nxt[0]) / 2, y: (mid[1] + nxt[1]) / 2 };
}

// ─── Pipe segment component ───────────────────────────────────────────────────
function PipeSegment({ pipe, rec }) {
  const raw = rec?.[pipe.field] ?? 0;
  if (pipe.ghost && Math.abs(raw) < 1) return null;
  const reversed = pipe.bidir && raw < -1;
  const absVal = Math.abs(raw);
  const color  = pipe.ghost ? '#1a3050' : flowColor(raw, pipe.maxVal);
  const width  = pipe.ghost ? 1.2 : flowWidth(absVal, pipe.maxVal);
  const flowing = absVal > 1 && !pipe.ghost;
  const off = pipe.offset || 0;
  const pathD = buildOffsetPath(pipe, off);
  const mid = pathMid(pipe);
  const markId = `arr-${pipe.id}`;

  // For reversed bidir: rebuild path in opposite direction
  const reversedPipe = reversed ? { ...pipe, from: pipe.to, to: pipe.from,
    waypoints: [...pipe.waypoints].reverse() } : pipe;
  const flowPathD = reversed ? buildOffsetPath(reversedPipe, off) : pathD;

  return (
    <g>
      {flowing && (
        <defs>
          <marker id={markId} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <polygon points="0,0.5 5.5,3 0,5.5" fill={color} />
          </marker>
        </defs>
      )}
      {/* Dark track */}
      <path d={pathD} fill="none" stroke="#030810" strokeWidth={width + 6} />
      {/* Flow path */}
      <path d={flowPathD} fill="none" stroke={color} strokeWidth={width}
        strokeDasharray={flowing ? '10 6' : (pipe.ghost ? '3 4' : 'none')}
        markerEnd={flowing ? `url(#${markId})` : undefined}
        style={flowing ? { animation:'flowDash 1.5s linear infinite' } : {}} />
      {/* Label — positioned at labelFrac along path; optional labelOffset [dx,dy] adds a leader line */}
      {pipe.label && absVal > 1 && !pipe.ghost && (() => {
        const allPts = [[...np(pipe.from)], ...pipe.waypoints.map(([lon,lat]) => geo(lon,lat)), [...np(pipe.to)]];
        const frac = pipe.labelFrac ?? 0.5;
        const lIdx = Math.min(Math.floor(frac * (allPts.length - 1)), allPts.length - 2);
        const ax = (allPts[lIdx][0] + allPts[lIdx+1][0]) / 2;
        const ay = (allPts[lIdx][1] + allPts[lIdx+1][1]) / 2;
        const [dx, dy] = pipe.labelOffset ?? [0, 0];
        const lx = ax + dx;
        const ly = ay + dy;
        const hasLeader = dx !== 0 || dy !== 0;
        return (
          <g>
            {hasLeader && (
              <line x1={ax} y1={ay} x2={lx + 2} y2={ly}
                stroke={color} strokeWidth={0.8} strokeDasharray="3 2" opacity={0.6} />
            )}
            <g transform={`translate(${lx},${ly})`}>
              <rect x={1} y={-13} width={76} height={26} rx={3}
                fill="#060e1c" fillOpacity={0.97} stroke="#1e3a55" strokeWidth={0.8} />
              <text x={4} y={-3} fill="#7dd3fc" fontSize={8.5} fontFamily="DM Mono, monospace">{pipe.label}</text>
              <text x={4} y={10} fill={color} fontSize={11.5} fontFamily="DM Mono, monospace" fontWeight="700">
                {fmtTJ(absVal)} TJ{pipe.bidir ? (raw < -1 ? ' ↑' : raw > 1 ? ' ↓' : '') : ''}
              </text>
            </g>
          </g>
        );
      })()}
    </g>
  );
}

// ─── Node component ───────────────────────────────────────────────────────────
const NODE_CFG = {
  wallumbilla:   { label:'Wallumbilla', sub:'QLD CSG hub', icon:'⛽', color:'#c084fc', r:17, field:'production_swqp' },
  moomba:        { label:'Moomba Hub',  sub:'Cooper Basin',icon:'⚙',  color:'#c084fc', r:19, field:'production_moomba' },
  longford:      { label:'Longford',    sub:'Gippsland',   icon:'⛽', color:'#c084fc', r:16, field:'production_longford' },
  iona:          { label:'Iona UGS',    sub:'',            icon:'🏭', color:'#34d399', r:15, field:'storage_iona', labelAbove:true },
  otway:         { label:'Otway',       sub:'Otway Basin', icon:'⛽', color:'#c084fc', r:11, field:'production_other_south' },
  ballera:       { label:'Ballera',     sub:null,          icon:null,  color:'#4a6a8a', r:5,  field:null },
  culcairn:      { label:'Culcairn',    sub:'MSP spur/VNI', icon:'◉',  color:'#a78bfa', r:8,  field:'map_vni', labelRight:true },
  vts_hub:       { label:'VTS / Melbourne', sub:'VIC demand', icon:'🏙', color:'#38bdf8', r:22, field:'pipe_vic', vts:true, labelAbove:true },
  curtis_island: { label:'Curtis Is.',  sub:'LNG terminal',icon:'🚢', color:'#f43f5e', r:15, field:null, labelRight:true },
  brisbane:      { label:'Brisbane',    sub:'QLD demand',  icon:'🏙', color:'#38bdf8', r:15, field:'map_rbp_bris', labelRight:true },
  gladstone:     { label:'Gladstone',   sub:'QGP demand',  icon:'🏙', color:'#38bdf8', r:11, field:'map_qgp_qld', labelRight:true, labelLeader:true, labelRightOffset:18, labelDropY:28 },
  sydney:        { label:'Sydney',      sub:'NSW demand',  icon:'🏙', color:'#38bdf8', r:17, field:'pipe_nsw' },
  canberra:      { label:'Canberra',    sub:'ACT',         icon:'🏛', color:'#38bdf8', r:9,  field:null },
  adelaide:      { label:'Adelaide',    sub:'SA demand',   icon:'🏙', color:'#38bdf8', r:16, field:'pipe_sa' },
  tasmania:      { label:'Tasmania',    sub:'TAS demand',  icon:'🏙', color:'#38bdf8', r:12, field:'pipe_tas' },
};

function MapNode({ id, rec }) {
  const [cx, cy] = N[id];
  const cfg = NODE_CFG[id];
  if (!cfg) return null;
  if (!cfg.icon) return <circle cx={cx} cy={cy} r={cfg.r} fill={cfg.color} opacity={0.7} />;

  let val = cfg.field ? (rec?.[cfg.field] ?? null) : null;
  let nodeColor = cfg.color;
  let sub = cfg.sub;
  if (id === 'iona') {
    nodeColor = val > 0 ? '#4ade80' : val < 0 ? '#f87171' : '#374151';
    sub = val > 0 ? 'withdrawal' : val < 0 ? 'injection' : 'neutral';
  }

  const r = cfg.r;
  const showVal = val != null && !isNaN(val) && Math.abs(val) > 0.4;

  // Label positioning: avoid map edges & overlaps
  const above = ['wallumbilla','moomba','ballera','curtis_island'].includes(id) || cfg.labelAbove;
  const below = cfg.labelBelow;
  const left  = ['adelaide','otway','moomba'].includes(id) && !above;
  const right = (['sydney','longford','brisbane','curtis_island'].includes(id) || cfg.labelRight) && !above;
  const aboveRight = cfg.labelAboveRight && !above;

  // ly = node name text position; valY = TJ value position (above name for above-nodes)
  let lx = cx, ly = above ? cy - r - 14 : below ? cy + r + 14 : cy + r + 14, anchor = 'middle';
  if (left)       { lx = cx - r - 5; ly = cy - 2; anchor = 'end'; }
  if (right)      { lx = cx + r + (cfg.labelRightOffset ?? 5); ly = cy + (cfg.labelDropY ?? -2); anchor = 'start'; }
  if (aboveRight) { lx = cx + r + 5; ly = cy - r - 10; anchor = 'start'; }

  const valY = above      ? ly - 14
             : aboveRight ? cy - r + 5
             : left || right ? cy + (cfg.labelDropY ?? 0) + 11
             : ly + 13;

  // Leader line: thin dashed line from circle edge to label (e.g. Gladstone)
  const leaderEnd = cfg.labelLeader ? { x: lx - 4, y: ly + 4 } : null;

  // VTS hub gets an extra outer zone ring
  const vtsRing = cfg.vts ? (
    <circle cx={cx} cy={cy} r={r + 22} fill="none"
      stroke="#38bdf8" strokeWidth={1} strokeOpacity={0.25} strokeDasharray="6 4" />
  ) : null;

  return (
    <g>
      {leaderEnd && (
        <line x1={cx + r} y1={cy} x2={leaderEnd.x} y2={leaderEnd.y}
          stroke={nodeColor} strokeWidth={0.8} strokeDasharray="3 2" opacity={0.5} />
      )}
      {vtsRing}
      <circle cx={cx} cy={cy} r={r + 6} fill={nodeColor} fillOpacity={0.12} />
      <circle cx={cx} cy={cy} r={r + 2} fill="none" stroke={nodeColor} strokeWidth={1.5} strokeOpacity={0.4} />
      <circle cx={cx} cy={cy} r={r} fill="#0b1525" stroke={nodeColor} strokeWidth={2.5} />
      <text x={cx} y={cy + 5} textAnchor="middle" fontSize={r * 0.95}>{cfg.icon}</text>
      <text x={lx} y={ly} textAnchor={anchor} fill="#ffffff" fontSize={10}
        fontFamily="DM Mono, monospace" fontWeight="700"
        style={{ paintOrder:'stroke', stroke:'#0b1525', strokeWidth:3 }}>{cfg.label}</text>
      {showVal && (
        <text x={lx} y={valY} textAnchor={anchor} fill={nodeColor} fontSize={11.5}
          fontFamily="DM Mono, monospace" fontWeight="700"
          style={{ paintOrder:'stroke', stroke:'#0b1525', strokeWidth:3 }}>
          {fmtTJ(Math.abs(val))} TJ
        </text>
      )}
      {showVal && sub && (
        <text x={lx} y={above ? ly + 11 : valY + 12} textAnchor={anchor} fill="#64748b" fontSize={8.5}
          fontFamily="DM Mono, monospace"
          style={{ paintOrder:'stroke', stroke:'#0b1525', strokeWidth:2 }}>{sub}</text>
      )}
      {id === 'iona' && rec?.storage_balance_iona != null && (
        <text x={lx} y={above ? ly + 22 : valY + 24} textAnchor={anchor} fill="#334155" fontSize={8.5}
          fontFamily="DM Mono, monospace"
          style={{ paintOrder:'stroke', stroke:'#0b1525', strokeWidth:2 }}>
          bal {Math.round(rec.storage_balance_iona).toLocaleString()} TJ
        </text>
      )}
    </g>
  );
}

// ─── KPI strip ────────────────────────────────────────────────────────────────
function KpiStrip({ rec }) {
  if (!rec) return null;
  const pct = (val, cap) => cap > 0 ? `${Math.round(Math.abs(val) / cap * 100)}%` : '—';
  const ionaColor  = (rec.storage_iona||0)  >= 0 ? '#4ade80' : '#f87171';
  const otherColor = (rec.storage_other||0) >= 0 ? '#4ade80' : '#f87171';
  const qldColor   = (rec.qld_net_flow||0)  >= 0 ? '#facc15' : '#60a5fa';

  // Capacities (TJ/day): pipes from GBB, storage from operator data
  const CAP = { msp:565, maps:249, egp:349, iona:570, other:447 }; // other = Dandenong(237)+NGS(120)+Moomba(90)

  const items = [
    { label:'SE City Demand', v:fmtTJ((rec.pipe_vic||0)+(rec.pipe_nsw||0)+(rec.pipe_sa||0)+(rec.pipe_tas||0)), color:'#38bdf8', cap:null, sub:'TJ/day' },
    { label:'SE GPG',         v:fmtTJ(rec.gpg_se),        color:'#f472b6', cap:null, sub:'TJ/day' },
    { label:'SE Industry',    v:fmtTJ(rec.industrial),    color:'#a78bfa', cap:null, sub:'TJ/day' },
    { label:'QLD→SE Net', v:fmtTJ(rec.qld_net_flow), color:qldColor,  cap:null, sub:'TJ/day' },
    { label:'Iona Net',       v:fmtTJ(rec.storage_iona),  color:ionaColor, cap:CAP.iona,  raw:rec.storage_iona,  sub:(rec.storage_iona||0)>=0?'withdrawal':'injection' },
    { label:'Other Storage',  v:fmtTJ(rec.storage_other), color:otherColor,cap:CAP.other, raw:rec.storage_other, sub:(rec.storage_other||0)>=0?'withdrawal':'injection' },
    { label:'MSP (NSW)',      v:fmtTJ(rec.map_msp_nsw),   color:'#fb923c', cap:CAP.msp,  raw:rec.map_msp_nsw,  sub:'TJ/day' },
    { label:'MAPS (SA)',      v:fmtTJ(rec.map_maps_sa),   color:'#fb923c', cap:CAP.maps, raw:rec.map_maps_sa,  sub:'TJ/day' },
    { label:'EGP (NSW)',      v:fmtTJ(rec.map_egp_nsw),   color:'#fb923c', cap:CAP.egp,  raw:rec.map_egp_nsw,  sub:'TJ/day' },
  ];
  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(9,1fr)', gap:5 }}>
      {items.map(({label,v,color,cap,raw,sub}) => (
        <div key={label} style={{ background:'#071020', border:'1px solid #1e3a5a', borderRadius:6, padding:'7px 10px' }}>
          <div style={{ fontSize:9, color:'#7dd3fc', fontFamily:'DM Mono, monospace',
            textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:3 }}>{label}</div>
          <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between' }}>
            <span style={{ fontSize:14, fontWeight:700, fontFamily:'DM Mono, monospace', color }}>{v}</span>
            {cap != null && (
              <span style={{ fontSize:13, fontWeight:700, fontFamily:'DM Mono, monospace', color }}>{pct(raw||0, cap)}</span>
            )}
          </div>
          <div style={{ fontSize:9, color:'#475569', fontFamily:'DM Mono, monospace', marginTop:2 }}>{sub}</div>
        </div>
      ))}
    </div>
  );
}


// ─── Main tab ─────────────────────────────────────────────────────────────────
export default function TabFlowMap({ records }) {
  const recByDate = useMemo(() => {
    const m = {};
    for (const r of records) m[r.date] = r;
    return m;
  }, [records]);

  const dates = useMemo(() => Object.keys(recByDate).sort(), [recByDate]);

  const [selectedDate, setSelectedDate] = useState('');
  useEffect(() => {
    if (dates.length && !selectedDate) setSelectedDate(dates[dates.length - 1]);
  }, [dates, selectedDate]);

  const step = useCallback((dir) => {
    const i = dates.indexOf(selectedDate);
    if (dates[i + dir]) setSelectedDate(dates[i + dir]);
  }, [dates, selectedDate]);

  const rec = recByDate[selectedDate] ?? null;
  const idx = dates.indexOf(selectedDate);

  const handleDate = e => {
    const v = e.target.value;
    if (recByDate[v]) { setSelectedDate(v); return; }
    const nearest = dates.reduce((a,b) =>
      Math.abs(b.localeCompare(v)) < Math.abs(a.localeCompare(v)) ? b : a);
    setSelectedDate(nearest);
  };

  const btnStyle = dis => ({
    background:'#071020', border:'1px solid #1e3a5a',
    color: dis ? '#1e3a5a' : '#94a3b8',
    borderRadius:4, padding:'5px 12px', cursor: dis ? 'default':'pointer', fontSize:15,
  });

  const jumps = ['2019-07-15','2021-06-15','2022-06-01','2024-07-15','2025-01-20'].filter(d => recByDate[d]);

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
      <style>{`@keyframes flowDash { to { stroke-dashoffset: -26; } }`}</style>

      {/* Controls */}
      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap',
        background:'#071020', border:'1px solid #1e3a5a', borderRadius:8, padding:'8px 14px' }}>
        <span style={{ fontSize:10, color:'#94a3b8', fontFamily:'DM Mono, monospace',
          textTransform:'uppercase', letterSpacing:'0.08em' }}>Gas Day</span>
        <button onClick={() => step(-1)} disabled={idx <= 0} style={btnStyle(idx <= 0)}>‹</button>
        <input type="date" value={selectedDate} min={dates[0]} max={dates[dates.length-1]}
          onChange={handleDate}
          style={{ background:'#071020', border:'1px solid #1e3a5a', borderRadius:4,
            padding:'5px 10px', color:'#e2e8f0', fontSize:12, fontFamily:'DM Mono, monospace' }} />
        <button onClick={() => step(1)} disabled={idx >= dates.length-1} style={btnStyle(idx >= dates.length-1)}>›</button>
        <span style={{ fontSize:10, color:'#475569', fontFamily:'DM Mono, monospace' }}>Jump:</span>
        {jumps.map(d => (
          <button key={d} onClick={() => setSelectedDate(d)} style={{
            ...btnStyle(false), fontSize:10, padding:'3px 8px',
            color: selectedDate===d ? '#38bdf8':'#475569',
            border:`1px solid ${selectedDate===d ? '#38bdf8':'#1e3a5a'}`,
            background: selectedDate===d ? '#0f2233':'#071020',
          }}>{d}</button>
        ))}
        <span style={{ marginLeft:'auto', fontSize:10, color:'#1e3a5a', fontFamily:'DM Mono, monospace' }}>
          {dates.length.toLocaleString()} days · {dates[0]} → {dates[dates.length-1]}
        </span>
      </div>

      {/* KPIs */}
      <KpiStrip rec={rec} />

      {/* Map */}
      <div style={{ background:'#040d1a', border:'1px solid #1e3a5a', borderRadius:10, overflow:'hidden' }}>
        <div style={{ padding:'10px 16px 4px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <span style={{ fontFamily:'Syne, sans-serif', fontWeight:700, fontSize:14, color:'#f1f5f9' }}>
              Eastern Australia Gas Network — Flow Map
            </span>
            <span style={{ marginLeft:12, fontSize:11, color:'#38bdf8', fontFamily:'DM Mono, monospace' }}>
              {selectedDate || '—'}
            </span>
          </div>
          <span style={{ fontSize:10, color:'#2a4a6a', fontFamily:'DM Mono, monospace' }}>
            colour = flow level · animated arrow = direction
          </span>
        </div>

        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} style={{ width:'100%', maxHeight:640, display:'block' }}>
          {/* Ocean */}
          <rect width={VB_W} height={VB_H} fill="#071828" />
          {/* Land */}
          <polygon points={COAST} fill="#0d1f2d" stroke="#1a3a52" strokeWidth={1} />
          <polygon points={TAS}   fill="#0d1f2d" stroke="#1a3a52" strokeWidth={1} />
          {/* State borders */}
          {BORDERS.map((pts, i) => (
            <polyline key={i} points={pts} fill="none" stroke="#1a3a52" strokeWidth={0.8} strokeDasharray="5 4" />
          ))}
          {/* State labels */}
          {[
            { label:'QLD', lon:146.5, lat:-24.5 },
            { label:'NSW', lon:146.5, lat:-32.0 },
            { label:'VIC', lon:145.0, lat:-36.7 },
            { label:'SA',  lon:137.2, lat:-31.0 },
            { label:'TAS', lon:146.2, lat:-42.2 },
          ].map(({ label, lon, lat }) => {
            const [x, y] = geo(lon, lat);
            return <text key={label} x={x} y={y} textAnchor="middle"
              fill="#1a3d5c" fontSize={22} fontFamily="Syne, sans-serif" fontWeight="900">{label}</text>;
          })}

          {/* Pipes (behind nodes) */}
          {PIPES.map(p => <PipeSegment key={p.id} pipe={p} rec={rec} />)}

          {/* Nodes */}
          {Object.keys(NODE_CFG).map(id => <MapNode key={id} id={id} rec={rec} />)}
        </svg>
      </div>

      {/* Legend */}
      <div style={{ display:'flex', gap:'8px 22px', flexWrap:'wrap',
        background:'#071020', border:'1px solid #1e3a5a', borderRadius:8, padding:'10px 16px' }}>
        {[
          { color:'#f97316', w:3,   label:'High flow (>65% cap)' },
          { color:'#facc15', w:3,   label:'Moderate flow' },
          { color:'#4ade80', w:3,   label:'Low flow' },
          { color:'#60a5fa', w:5,   label:'Reverse / SE→QLD' },
          { color:'#2a4060', w:2,   label:'No / minimal flow' },
          { color:'#c084fc', dot:true, label:'Production node' },
          { color:'#38bdf8', dot:true, label:'City demand' },
          { color:'#f43f5e', dot:true, label:'LNG export terminal' },
          { color:'#4ade80', dot:true, label:'Iona: withdrawal' },
          { color:'#f87171', dot:true, label:'Iona: injection' },
        ].map(({ color, w, dot, label }) => (
          <div key={label} style={{ display:'flex', alignItems:'center', gap:7 }}>
            {dot
              ? <div style={{ width:11, height:11, borderRadius:'50%', border:`2.5px solid ${color}`, background:'#040d1a' }} />
              : <div style={{ width:28, height:w, borderRadius:2, background:color }} />}
            <span style={{ fontSize:11, color:'#cbd5e1', fontFamily:'DM Mono, monospace' }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Note */}
      <div style={{ background:'#071020', border:'1px solid #1e3a5a', borderLeft:'3px solid #e6a817',
        borderRadius:6, padding:'10px 14px', fontSize:11, color:'#94a3b8', lineHeight:1.8 }}>
        <strong style={{ color:'#e2e8f0' }}>Pipeline key</strong>
        {' — flows measured at the upstream injection point unless noted:'}
        <br />
        <strong style={{ color:'#e2e8f0' }}>SWQP</strong> = South West Queensland Pipeline (bidirectional) — flow shown is net QLD→SE, measured at Moomba Hub ·
        <strong style={{ color:'#e2e8f0' }}> MAPS</strong> = Moomba to Adelaide Pipeline System — measured at Moomba Hub ·
        <strong style={{ color:'#e2e8f0' }}> MSP</strong> = Moomba to Sydney Pipeline — measured at Moomba Hub ·
        <strong style={{ color:'#e2e8f0' }}> EGP</strong> = Eastern Gas Pipeline (Longford→Sydney, coastal route) — measured at Longford Hub ·
        <strong style={{ color:'#e2e8f0' }}> VTS</strong> = Victorian Transmission System — measured at Longford Hub, Iona Hub and Culcairn ·
        <strong style={{ color:'#e2e8f0' }}> VNI</strong> = Victorian–NSW Interconnect — measured at Culcairn ·
        <strong style={{ color:'#e2e8f0' }}> PCA</strong> = Port Campbell to Adelaide (SEA Gas Pipeline, ~680 km) — measured at Iona Hub ·
        <strong style={{ color:'#e2e8f0' }}> PCI</strong> = Port Campbell to Iona connector — measured at Iona Hub; bidirectional ·
        <strong style={{ color:'#e2e8f0' }}> TGP</strong> = Tasmanian Gas Pipeline — measured at Longford Hub ·
        <strong style={{ color:'#e2e8f0' }}> MPL</strong> = Minerva Pipeline (Otway→VIC regional) — measured at Iona Hub ·
        <strong style={{ color:'#e2e8f0' }}> RBP</strong> = Roma–Brisbane Pipeline — measured at Brisbane ·
        <strong style={{ color:'#e2e8f0' }}> QGP</strong> = Queensland Gas Pipeline — measured at Gladstone (Regional QLD) ·
        <strong style={{ color:'#e2e8f0' }}> WGP/APLNG/GLNG</strong> = QLD LNG export pipelines — all measured at Curtis Island (gas delivered to LNG trains).
        <br />
        <span style={{ color:'#f59e0b' }}>⚠ Northern Trunkline (NSW) not in GBB dataset:</span>
        {" Jemena's Northern Trunkline (Hunter Valley/Central Coast) is not separately reported. "}
        {'Colongra Gas Storage, Kurri Kurri PS, Orica Kooragang Island, and Newcastle Gas Storage '}
        {'all connect via this trunkline — their flows appear aggregated under Sydney/Regional NSW nodes.'}
      </div>
    </div>
  );
}
