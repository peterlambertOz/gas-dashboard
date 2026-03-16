/**
 * patch-flowmap-labels.cjs
 * Applies all 5 flow map label repositioning changes.
 * Run from gas-dashboard root:  node patch-flowmap-labels.cjs
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'src', 'tabs', 'TabFlowMap.jsx');
let src = fs.readFileSync(FILE, 'utf8');
let changed = 0;

function replace(description, oldStr, newStr) {
  if (!src.includes(oldStr)) {
    console.error(`❌  Not found: ${description}`);
    return;
  }
  src = src.replace(oldStr, newStr);
  console.log(`✅  ${description}`);
  changed++;
}

// ── 1. Iona UGS: label above the circle ──────────────────────────────────────
replace(
  'Iona UGS — label above circle',
  `iona:          { label:'Iona UGS',    sub:'',            icon:'🏭', color:'#34d399', r:15, field:'storage_iona' },`,
  `iona:          { label:'Iona UGS',    sub:'',            icon:'🏭', color:'#34d399', r:15, field:'storage_iona', labelAbove:true },`
);

// ── 2. VTS/Melbourne: label above the circle ──────────────────────────────────
replace(
  'VTS/Melbourne — label above circle',
  `vts_hub:       { label:'VTS / Melbourne', sub:'VIC demand', icon:'🏙', color:'#38bdf8', r:22, field:'pipe_vic', vts:true },`,
  `vts_hub:       { label:'VTS / Melbourne', sub:'VIC demand', icon:'🏙', color:'#38bdf8', r:22, field:'pipe_vic', vts:true, labelAbove:true },`
);

// ── 3. Gladstone: label right + leader line ───────────────────────────────────
replace(
  'Gladstone — label right with leader line',
  `gladstone:     { label:'Gladstone',   sub:'QGP demand',  icon:'🏙', color:'#38bdf8', r:11, field:'map_qgp_qld'  },`,
  `gladstone:     { label:'Gladstone',   sub:'QGP demand',  icon:'🏙', color:'#38bdf8', r:11, field:'map_qgp_qld', labelRight:true, labelLeader:true },`
);

// ── 4. Rebuild label positioning logic to honour cfg flags ────────────────────
replace(
  'Label positioning logic — support labelAbove/labelRight/labelLeader',
  `  // Label positioning: avoid map edges & overlaps
  const above = ['wallumbilla','moomba','ballera','curtis_island','gladstone','brisbane'].includes(id);
  const left  = ['adelaide','iona','otway','moomba'].includes(id);
  const right = ['sydney','longford','brisbane','curtis_island','vts_hub'].includes(id) || cfg.labelRight;

  let lx = cx, ly = above ? cy - r - 14 : cy + r + 14, anchor = 'middle';
  if (left)  { lx = cx - r - 5; ly = cy - 2; anchor = 'end'; }
  if (right) { lx = cx + r + 5; ly = cy - 2; anchor = 'start'; }

  const valY = above ? cy + r + 15 : left || right ? cy + 13 : ly + 13;`,
  `  // Label positioning: avoid map edges & overlaps
  const above = ['wallumbilla','moomba','ballera','curtis_island'].includes(id) || cfg.labelAbove;
  const left  = ['adelaide','otway','moomba'].includes(id) && !above;
  const right = (['sydney','longford','brisbane','curtis_island'].includes(id) || cfg.labelRight) && !above;

  let lx = cx, ly = above ? cy - r - 14 : cy + r + 14, anchor = 'middle';
  if (left)  { lx = cx - r - 5; ly = cy - 2; anchor = 'end'; }
  if (right) { lx = cx + r + 5; ly = cy - 2; anchor = 'start'; }

  const valY = above ? cy - r - 28 : left || right ? cy + 13 : ly + 13;

  // Leader line: thin dashed line from circle edge to label (for Gladstone etc.)
  const leaderEnd = cfg.labelLeader ? { x: lx - 4, y: ly + 4 } : null;`
);

// ── 5. Inject leader line <line> into MapNode return ──────────────────────────
//    Inserts just before {vtsRing} inside the return <g>
replace(
  'Insert leader line into MapNode JSX',
  `  return (
    <g>
      {vtsRing}`,
  `  return (
    <g>
      {leaderEnd && (
        <line x1={cx + r} y1={cy} x2={leaderEnd.x} y2={leaderEnd.y}
          stroke={nodeColor} strokeWidth={0.8} strokeDasharray="3 2" opacity={0.5} />
      )}
      {vtsRing}`
);

// ── 6. EGP: move label to just below Canberra ─────────────────────────────────
replace(
  'EGP — label near Canberra (frac 0.55, offset below)',
  `  { id:'egp',   label:'EGP',  field:'map_egp_nsw',  maxVal:280, labelFrac:0.4,`,
  `  { id:'egp',   label:'EGP',  field:'map_egp_nsw',  maxVal:280, labelFrac:0.55, labelOffset:[10, 30],`
);

// ── 7. SWP: label at true midpoint between Iona and VTS ───────────────────────
replace(
  'SWP — label at midpoint (frac 0.5)',
  `  { id:'swp',   label:'SWP',  field:'map_swp',       maxVal:400, labelFrac:0.4,`,
  `  { id:'swp',   label:'SWP',  field:'map_swp',       maxVal:400, labelFrac:0.5,`
);

fs.writeFileSync(FILE, src, 'utf8');
console.log(`\nDone — ${changed}/7 changes applied. Vite will hot-reload automatically.`);
