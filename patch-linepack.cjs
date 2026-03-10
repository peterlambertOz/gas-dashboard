// Run this from your gas-dashboard project root:
//   node patch-linepack.js
//
// It patches two files in-place to add the pipeline linepack component.

const fs = require('fs');
const path = require('path');

// ── Patch 1: aemoParser.js ────────────────────────────────────────────────────
const parserPath = path.join(__dirname, 'src', 'utils', 'aemoParser.js');
let parser = fs.readFileSync(parserPath, 'utf8');

// Check if already patched
if (parser.includes('SE_LINEPACK_PIPES')) {
  console.log('aemoParser.js already patched — skipping');
} else {
  // 1a. Add module-level constant after the TERMINAL_LOCATIONS line
  parser = parser.replace(
    'const TERMINAL_LOCATIONS = new Set(Object.keys(TERMINAL_LOC_STATE));',
    `const TERMINAL_LOCATIONS = new Set(Object.keys(TERMINAL_LOC_STATE));

// SE pipeline linepack delta — SE trunk pipes only, EXCLUDING SWQP
// (SWQP net QLD\u2194SE flow is already captured in qld_net_flow / qld_supply)
const SE_LINEPACK_PIPES = new Set(['VTS','MSP','EGP','MAPS','PCA','PCI','TGP','MPL','SESA',
  'BPP','LYB Transmission Pipeline','Bomaderry Gas Pipeline','ColongraGP','CWP',
  'Tallawarra Pipeline']);`
  );

  // 1b. Add pipe_linepack_se to the ensure() initialiser
  parser = parser.replace(
    "storage_other: 0,   // Dandenong LNG + Moomba Storage + NGS (net withdrawal positive)\n      });",
    `storage_other: 0,   // Dandenong LNG + Moomba Storage + NGS (net withdrawal positive)
        // SE pipeline linepack change: \u03a3(S+TI-D-TO) across SE pipe nodes (excl. SWQP)
        pipe_linepack_se: 0,
      });`
  );

  // 1c. Add accumulation inside the PIPE block — after the existing map_ngp line
  parser = parser.replace(
    "if (name === 'NGP')                                      d.map_ngp      += supply + demand;\n    }",
    `if (name === 'NGP')                                      d.map_ngp      += supply + demand;

      // SE linepack delta: signed (S+TI-D-TO) for SE-state pipe nodes, SWQP excluded
      if (SE_LINEPACK_PIPES.has(name) && SE_STATES.has(state)) {
        d.pipe_linepack_se += (supply + ti_ - demand - to_);
      }
    }`
  );

  fs.writeFileSync(parserPath, parser, 'utf8');
  console.log('aemoParser.js patched OK');
}

// ── Patch 2: TabSupplyCapacity.jsx ────────────────────────────────────────────
const tabPath = path.join(__dirname, 'src', 'tabs', 'TabSupplyCapacity.jsx');
let tab = fs.readFileSync(tabPath, 'utf8');

if (tab.includes('linepack_draw')) {
  console.log('TabSupplyCapacity.jsx already patched — skipping');
} else {
  // 2a. Add linepack colour to SUP_COLORS
  tab = tab.replace(
    "  storage_south: '#22d3ee',   // cyan\n};",
    "  storage_south: '#22d3ee',   // cyan\n  linepack:      '#a78bfa',   // violet\n};"
  );

  // 2b. Replace the supplyDaily .map() body to add linepack fields
  tab = tab.replace(
    `      .map(r => ({
        date: r.date.substring(5),
        // Positive supply stack
        moomba:           Math.round(r.production_moomba || 0),
        longford:         Math.round(r.production_longford || 0),
        other_south:      Math.round(r.production_other_south || 0),
        qld_supply:       Math.round(r.qld_supply || 0),
        storage_south:    Math.round(r.storage_withdrawal || 0),
        demand:           Math.round(r.total_demand_se || 0),
        // Negative flows below x-axis — same colours as positive counterparts
        neg_storage:      -Math.round(r.storage_injection || 0),
        neg_qld:          -Math.round(r.se_to_qld || 0),  // SE gas entering SWQP northbound (summer only, small)
        gap:              Math.round(r.supply_demand_gap || 0),
      }))`,
    `      .map(r => {
        const lp = Math.round(r.pipe_linepack_se || 0);
        const gap = Math.round(r.supply_demand_gap || 0);
        const linepack_draw = lp < 0 ? -lp : 0;
        const linepack_fill = lp > 0 ? -lp : 0;
        return {
          date: r.date.substring(5),
          moomba:        Math.round(r.production_moomba || 0),
          longford:      Math.round(r.production_longford || 0),
          other_south:   Math.round(r.production_other_south || 0),
          qld_supply:    Math.round(r.qld_supply || 0),
          storage_south: Math.round(r.storage_withdrawal || 0),
          linepack_draw,
          demand:        Math.round(r.total_demand_se || 0),
          neg_storage:   -Math.round(r.storage_injection || 0),
          neg_qld:       -Math.round(r.se_to_qld || 0),
          linepack_fill,
          gap,
          residual_after_linepack: gap + lp,
        };
      })`
  );

  // 2c. Add linepack Area to supply stack chart (after storage_south Area)
  tab = tab.replace(
    `            <Area type="monotone" dataKey="storage_south" stackId="pos" name="Storage Withdrawal"  fill={SUP_COLORS.storage_south} stroke={SUP_COLORS.storage_south} fillOpacity={0.9} />
            {/* Negative flows — same colours, below x-axis */}`,
    `            <Area type="monotone" dataKey="storage_south"  stackId="pos" name="Storage Withdrawal"  fill={SUP_COLORS.storage_south} stroke={SUP_COLORS.storage_south} fillOpacity={0.9} />
            <Area type="monotone" dataKey="linepack_draw"  stackId="pos" name="Linepack Draw (+)"   fill={SUP_COLORS.linepack}      stroke={SUP_COLORS.linepack}      fillOpacity={0.85} />
            {/* Negative flows — below x-axis */}`
  );

  // 2d. Add linepack_fill Area after neg_qld
  tab = tab.replace(
    `            <Area type="monotone" dataKey="neg_qld"     stackId="neg" name="SE \u2192 QLD (\u2212)"
              fill={SUP_COLORS.qld_supply}    stroke={SUP_COLORS.qld_supply}    fillOpacity={0.7} />`,
    `            <Area type="monotone" dataKey="neg_qld"      stackId="neg" name="SE \u2192 QLD (\u2212)"
              fill={SUP_COLORS.qld_supply}    stroke={SUP_COLORS.qld_supply}    fillOpacity={0.7} />
            <Area type="monotone" dataKey="linepack_fill" stackId="neg" name="Linepack Refill (\u2212)"
              fill={SUP_COLORS.linepack}      stroke={SUP_COLORS.linepack}      fillOpacity={0.7} />`
  );

  // 2e. Add linepack to legend
  tab = tab.replace(
    "          { color: '#22c55e',                label: 'SE Demand' },",
    "          { color: SUP_COLORS.linepack,      label: 'Linepack drawdown (+) / refill (\u2212)' },\n          { color: '#22c55e',                label: 'SE Demand' },"
  );

  // 2f. Update residual gap chart to add residual_after_linepack line
  tab = tab.replace(
    `            <Bar dataKey="gap" name="Residual Gap" stroke="none">
              {supplyDaily.map((entry, i) => (
                <Cell key={i} fill={entry.gap > 0 ? '#f85149' : '#388bfd'} />
              ))}
            </Bar>`,
    `            <Bar dataKey="gap" name="Raw Residual Gap" stroke="none">
              {supplyDaily.map((entry, i) => (
                <Cell key={i} fill={entry.gap > 0 ? '#f8514966' : '#388bfd66'} />
              ))}
            </Bar>
            <Line type="monotone" dataKey="residual_after_linepack" name="Residual after Linepack"
              stroke={SUP_COLORS.linepack} strokeWidth={1.5} dot={false} />`
  );

  fs.writeFileSync(tabPath, tab, 'utf8');
  console.log('TabSupplyCapacity.jsx patched OK');
}

console.log('\nDone! Save this file then restart your dev server (npm run dev)');
