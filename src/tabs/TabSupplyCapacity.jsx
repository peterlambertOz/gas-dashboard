import {
  ComposedChart, Area, Bar, Cell, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';
import { useMemo, useState } from 'react';
import { ChartCard, KpiCard, CustomTooltip, AXIS_STYLE, GRID_STYLE, CHART_COLORS, YEAR_COLORS, Legend, fmtDate } from '../components/ChartCard';
import { exportToPowerPoint, exportToExcel } from '../utils/exportUtils';

// Supply source colours matching the PPT
const SUP_COLORS = {
  moomba:        '#6b7280',   // mid grey (visible on dark bg)
  longford:      '#9ca3af',   // light grey
  other_south:   '#d1d5db',   // near-white grey
  qld_supply:    '#e6a817',   // yellow/gold
  storage_south: '#22d3ee',   // cyan
  linepack:      '#a78bfa',   // violet — distinct from all existing colours
};

// MONTH_LABELS kept for potential future use in axis formatters
const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Indicative capacity bands (TJ/day)
const CAPACITY = { longford: 870, moomba: 520, swqp: 500, shallowStorage: 300, deepStorage: 300 };
const TOTAL_CAPACITY = Object.values(CAPACITY).reduce((a, b) => a + b, 0);

export default function TabSupplyCapacity({ records, selectedYears, dateRange }) {
  const latestYear = Math.max(...selectedYears);
  const [supplyYear, setSupplyYear] = useState(latestYear);

  // (dayLabel was removed — not used in rendered charts)

  // Daily supply breakdown for selected year
  const supplyDaily = useMemo(() =>
    records.filter(r => r.year === supplyYear && r.date >= dateRange[0] && r.date <= dateRange[1])
      .map(r => {
        const lp = Math.round(r.pipe_linepack_se || 0);
        const gap = Math.round(r.supply_demand_gap || 0);
        // linepack_draw: when lp is negative (pipelines being drawn down), show as positive supply
        // linepack_fill: when lp is positive (pipelines refilling), show below x-axis as negative demand
        const linepack_draw =  lp < 0 ? -lp : 0;   // positive area in supply stack
        const linepack_fill =  lp > 0 ? -lp : 0;   // negative area (below x-axis, absorbing supply)
        return {
          date: r.date.substring(5),
          // Positive supply stack
          moomba:           Math.round(r.production_moomba || 0),
          longford:         Math.round(r.production_longford || 0),
          other_south:      Math.round(r.production_other_south || 0),
          qld_supply:       Math.round(r.qld_supply || 0),
          storage_south:    Math.round(r.storage_withdrawal || 0),
          linepack_draw,    // pipeline linepack drawdown contributing to supply
          demand:           Math.round(r.total_demand_se || 0),
          // Negative flows below x-axis
          neg_storage:      -Math.round(r.storage_injection || 0),
          neg_qld:          -Math.round(r.se_to_qld || 0),
          linepack_fill,    // pipeline linepack refilling (absorbing surplus)
          gap,
          residual_after_linepack: gap + lp,  // gap once linepack accounted for
        };
      })
  , [records, supplyYear, dateRange]);

  // (yoySupply removed — placeholder for future YoY supply overlay chart)

  // Production by source annual average
  const productionData = useMemo(() => {
    return selectedYears.map(y => {
      const rows = records.filter(r => r.year === y && r.total_production > 0);
      if (!rows.length) return { year: y };
      const avg = key => Math.round(rows.reduce((s, r) => s + (r[key] || 0), 0) / rows.length);
      return {
        year: y,
        longford:    avg('production_longford'),
        moomba:      avg('production_moomba'),
        other_south: avg('production_other_south'),
        swqp:        avg('production_swqp'),
        total:       avg('total_production'),
      };
    });
  }, [records, selectedYears]);

  // Peak demand vs capacity
  const peakVsCapacity = useMemo(() =>
    selectedYears.map(y => {
      const rows = records.filter(r => r.year === y && r.total_demand_se > 0);
      const peak = Math.round(Math.max(...rows.map(r => r.total_demand_se)));
      return { year: y, peak, headroom: TOTAL_CAPACITY - peak, capacity: TOTAL_CAPACITY };
    })
  , [records, selectedYears]);

  const latestPeak = peakVsCapacity.find(r => r.year === latestYear) || {};
  const headroomPct = latestPeak.headroom ? Math.round((latestPeak.headroom / TOTAL_CAPACITY) * 100) : null;

  // Peak supply day stats
  const latestSupplyRows = records.filter(r => r.year === latestYear);
  const peakSupplyDay = latestSupplyRows.reduce((max, r) =>
    (r.total_supply || 0) > (max?.total_supply || 0) ? r : max, null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <KpiCard label="Total Indicative Capacity" value={TOTAL_CAPACITY.toLocaleString()} unit="TJ/day"
          sub="Longford + Moomba + SWQP + Storage" color="var(--danger)" />
        <KpiCard label={`${latestYear} Peak Demand`} value={latestPeak.peak?.toLocaleString() || '—'} unit="TJ/day" color="var(--accent)" />
        <KpiCard label={`${latestYear} Capacity Headroom`} value={latestPeak.headroom?.toLocaleString() || '—'} unit="TJ/day"
          sub={headroomPct !== null ? `${headroomPct}% of capacity` : ''}
          color={latestPeak.headroom < 200 ? 'var(--danger)' : 'var(--accent2)'} />
        <KpiCard label={`${latestYear} Peak Supply Day`}
          value={peakSupplyDay ? Math.round(peakSupplyDay.total_supply).toLocaleString() : '—'}
          unit="TJ" sub={peakSupplyDay?.date} color={SUP_COLORS.qld_supply} />
      </div>

      {/* Year selector */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>View year:</span>
        {selectedYears.map(y => (
          <button key={y} onClick={() => setSupplyYear(y)} style={{
            padding: '3px 10px', borderRadius: 4,
            border: `1px solid ${y === supplyYear ? YEAR_COLORS[y] || 'var(--accent)' : 'var(--border)'}`,
            background: y === supplyYear ? (YEAR_COLORS[y] || 'var(--accent)') + '22' : 'transparent',
            color: y === supplyYear ? YEAR_COLORS[y] || 'var(--accent)' : 'var(--text-muted)',
            cursor: 'pointer', fontSize: 12, fontFamily: 'DM Mono, monospace',
          }}>{y}</button>
        ))}
      </div>

      {/* Supply stack with demand line */}
      <ChartCard
        id="chart-supply-stack"
        title={`${supplyYear} Daily Supply by Source vs Demand`}
        subtitle="Supply stack uses gross storage withdrawal (TJ/day). Violet = pipeline linepack drawdown (+) / refill (−). Demand line = SE city consumption."
        onExportPPT={() => exportToPowerPoint([{ id: 'chart-supply-stack', title: `${supplyYear} Supply by Source vs Demand`, subtitle: 'SE States (TJ/day)' }])}
        onExportXLSX={() => exportToExcel(records.filter(r => r.year === supplyYear))}
      >
        <ResponsiveContainer width="100%" height={360}>
          <ComposedChart data={supplyDaily} margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="date" {...AXIS_STYLE} tickFormatter={fmtDate} interval={Math.floor(supplyDaily.length / 12)} />
            <YAxis {...AXIS_STYLE} tickFormatter={v => v.toLocaleString()} />
            <Tooltip content={<CustomTooltip formatter={v => `${Math.round(v).toLocaleString()} TJ`}  labelFormatter={fmtDate} /> } />
            <ReferenceLine y={0} stroke="#555" strokeWidth={1} />
            {/* Positive supply stack */}
            <Area type="monotone" dataKey="moomba"        stackId="pos" name="Moomba"              fill={SUP_COLORS.moomba}        stroke={SUP_COLORS.moomba}        fillOpacity={1} />
            <Area type="monotone" dataKey="longford"      stackId="pos" name="Longford"            fill={SUP_COLORS.longford}      stroke={SUP_COLORS.longford}      fillOpacity={1} />
            <Area type="monotone" dataKey="other_south"   stackId="pos" name="Other Southern"      fill={SUP_COLORS.other_south}   stroke={SUP_COLORS.other_south}   fillOpacity={1} />
            <Area type="monotone" dataKey="qld_supply"    stackId="pos" name="QLD Supply"          fill={SUP_COLORS.qld_supply}    stroke={SUP_COLORS.qld_supply}    fillOpacity={0.95} />
            <Area type="monotone" dataKey="storage_south" stackId="pos" name="Storage Withdrawal"  fill={SUP_COLORS.storage_south} stroke={SUP_COLORS.storage_south} fillOpacity={0.9} />
            <Area type="monotone" dataKey="linepack_draw" stackId="pos" name="Linepack Draw (+)"   fill={SUP_COLORS.linepack}      stroke={SUP_COLORS.linepack}      fillOpacity={0.85} />
            {/* Negative flows — below x-axis */}
            <Area type="monotone" dataKey="neg_storage"   stackId="neg" name="Storage Injection (−)"
              fill={SUP_COLORS.storage_south} stroke={SUP_COLORS.storage_south} fillOpacity={0.7} />
            <Area type="monotone" dataKey="neg_qld"       stackId="neg" name="SE → QLD (−)"
              fill={SUP_COLORS.qld_supply}    stroke={SUP_COLORS.qld_supply}    fillOpacity={0.7} />
            <Area type="monotone" dataKey="linepack_fill" stackId="neg" name="Linepack Refill (−)"
              fill={SUP_COLORS.linepack}      stroke={SUP_COLORS.linepack}      fillOpacity={0.7} />

            {/* Demand line */}
            <Line type="monotone" dataKey="demand" name="SE Demand" stroke="#22c55e" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
        <Legend items={[
          { color: SUP_COLORS.moomba,        label: 'Moomba' },
          { color: SUP_COLORS.longford,      label: 'Longford' },
          { color: SUP_COLORS.other_south,   label: 'Other Southern prod' },
          { color: SUP_COLORS.qld_supply,    label: 'QLD supply / SE→QLD backflow (−)' },
          { color: SUP_COLORS.storage_south, label: 'Storage withdrawal / injection (−)' },
          { color: SUP_COLORS.linepack,      label: 'Linepack drawdown (+) / refill (−)' },
          { color: '#22c55e',                label: 'SE Demand' },
        ]} />
      </ChartCard>

      {/* Supply-Demand residual gap chart */}
      <ChartCard
        id="chart-supply-gap"
        title={`${supplyYear} Supply–Demand Residual Gap`}
        subtitle="Bars = raw residual (gap before linepack). Violet line = residual after removing measured SE linepack Δ — should be near zero if all flows are captured."
        onExportPPT={() => exportToPowerPoint([{ id: 'chart-supply-gap', title: `${supplyYear} Supply–Demand Residual Gap` }])}
        onExportXLSX={() => exportToExcel(records.filter(r => r.year === supplyYear))}
      >
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={supplyDaily} margin={{ top: 10, right: 20, bottom: 0, left: 10 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="date" {...AXIS_STYLE} tickFormatter={fmtDate} interval={Math.floor(supplyDaily.length / 12)} />
            <YAxis {...AXIS_STYLE} tickFormatter={v => v.toLocaleString()} />
            <Tooltip content={<CustomTooltip formatter={v => `${Math.round(v).toLocaleString()} TJ`}  labelFormatter={fmtDate} /> } />
            <ReferenceLine y={0} stroke="#888" strokeWidth={1.5} />
            <Bar dataKey="gap" name="Raw Residual Gap" stroke="none">
              {supplyDaily.map((entry, i) => (
                <Cell key={i} fill={entry.gap > 0 ? '#f8514966' : '#388bfd66'} />
              ))}
            </Bar>
            <Line type="monotone" dataKey="residual_after_linepack" name="Residual after Linepack"
              stroke={SUP_COLORS.linepack} strokeWidth={1.5} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
        <div style={{ display: 'flex', gap: '6px 18px', flexWrap: 'wrap', marginTop: 6 }}>
          {[
            { color: '#f85149', label: 'Bars above zero: demand > supply (linepack drawdown day)' },
            { color: '#388bfd', label: 'Bars below zero: supply > demand (linepack refill day)' },
            { color: SUP_COLORS.linepack, label: 'Line: residual after SE linepack Δ — unaccounted flows only' },
          ].map(({color, label}) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, marginRight: 14 }}>
              <div style={{ width: 9, height: 9, borderRadius: 2, background: color }} />
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
            </div>
          ))}
        </div>
        <div style={{
          marginTop: 10, padding: '10px 14px',
          background: '#161b22', border: '1px solid #30363d', borderRadius: 6,
          fontSize: 11, color: '#7d8590', lineHeight: 1.7,
        }}>
          <span style={{ color: '#e6edf3', fontWeight: 600 }}>Interpretation: </span>
          The raw residual (bars) reflects daily changes in SE <strong style={{color:'#e6edf3'}}>pipeline linepack</strong> —
          gas physically stored under compression in the transmission network (~3,500–5,000 TJ total, with ±150–300 TJ
          daily swings on high-demand winter days). After subtracting the measured SE pipe linepack Δ, the violet line
          should trend near zero for well-reported periods. Persistent non-zero values indicate either missing measurement
          nodes or cross-boundary flow imbalances (e.g. SWQP QLD-side nodes, ColongraGP artefacts).
          <br/><br/>
          <span style={{color:'#f85149', fontWeight:600}}>Pre-2023 demand undercount:</span> before
          March 2023 (BBGPG) and May 2023 (BBLarge), several large sites were not captured in
          terminal pipeline demand nodes. Sites confirmed as genuinely missing include Newport PS,
          Torrens Island PS, and Tallawarra GPG (~45 TJ/day), plus industrial consumers Orica
          Kooragang Island and BlueScope Steel (~55 TJ/day NSW combined) — all on dedicated
          pipeline connections outside standard city distribution nodes. This accounts for an
          estimated 60–100 TJ/day of missing demand in 2019–2022, consistent with the persistent
          negative residual seen in those years. Pre-2023 supply/demand comparisons should be
          interpreted with this undercount in mind.
        </div>
      </ChartCard>

      {/* Capacity headroom */}
      <ChartCard
        id="chart-headroom"
        title="Peak Demand vs Capacity Headroom by Year"
        subtitle="Annual peak day demand and remaining headroom to indicative capacity (TJ/day)"
        onExportPPT={() => exportToPowerPoint([{ id: 'chart-headroom', title: 'Peak Demand vs Capacity Headroom' }])}
        onExportXLSX={() => exportToExcel(records)}
      >
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={peakVsCapacity} margin={{ top: 10, right: 20, bottom: 0, left: 10 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="year" {...AXIS_STYLE} />
            <YAxis {...AXIS_STYLE} domain={[0, 2800]} tickFormatter={v => v.toLocaleString()} />
            <Tooltip content={<CustomTooltip formatter={v => `${Math.round(v).toLocaleString()} TJ`}  labelFormatter={fmtDate} /> } />
            <Bar dataKey="peak"     name="Peak Demand" fill="#e6a817" stackId="a" />
            <Bar dataKey="headroom" name="Headroom"    fill="#30363d" stackId="a" />
            <ReferenceLine y={TOTAL_CAPACITY} stroke="#f85149" strokeWidth={2} strokeDasharray="5 3"
              label={{ value: `Capacity ${TOTAL_CAPACITY} TJ`, fill: '#f85149', fontSize: 10 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Average production by source */}
      <ChartCard
        id="chart-production-source"
        title="Average Daily Production by Source"
        subtitle="Mean TJ/day — southern field production trend by year"
        onExportPPT={() => exportToPowerPoint([{ id: 'chart-production-source', title: 'Average Daily Production by Source' }])}
        onExportXLSX={() => exportToExcel(records)}
      >
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={productionData} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="year" {...AXIS_STYLE} />
            <YAxis {...AXIS_STYLE} tickFormatter={v => v.toLocaleString()} />
            <Tooltip content={<CustomTooltip formatter={v => `${Math.round(v).toLocaleString()} TJ/day avg`}  labelFormatter={fmtDate} /> } />
            <Bar dataKey="moomba"      name="Moomba"          stackId="p" fill={SUP_COLORS.moomba} />
            <Bar dataKey="longford"    name="Longford"        stackId="p" fill={SUP_COLORS.longford} />
            <Bar dataKey="other_south" name="Other Southern"  stackId="p" fill={SUP_COLORS.other_south} />
            <Bar dataKey="swqp"        name="SWQP (QLD prod)" stackId="p" fill={CHART_COLORS.swqp} />
            <Line type="monotone" dataKey="total" name="Total" stroke="#e6edf3" strokeWidth={2} dot strokeDasharray="4 2" />
          </ComposedChart>
        </ResponsiveContainer>
        <Legend items={[
          { color: SUP_COLORS.moomba,      label: 'Moomba' },
          { color: SUP_COLORS.longford,    label: 'Longford' },
          { color: SUP_COLORS.other_south, label: 'Other Southern' },
          { color: CHART_COLORS.swqp,      label: 'SWQP (QLD production)' },
        ]} />
      </ChartCard>

      {/* Capacity components */}
      <ChartCard id="chart-capacity-breakdown" title="Indicative Supply Capacity Components"
        subtitle="Daily TJ/day capacity by source (approximate, indicative only)">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, padding: '12px 0' }}>
          {[
            { label: 'Longford',       value: CAPACITY.longford,       color: SUP_COLORS.longford },
            { label: 'Moomba & Other', value: CAPACITY.moomba,         color: SUP_COLORS.moomba },
            { label: 'SWQP',           value: CAPACITY.swqp,           color: CHART_COLORS.swqp },
            { label: 'Shallow Storage',value: CAPACITY.shallowStorage, color: SUP_COLORS.storage_south },
            { label: 'Deep Storage',   value: CAPACITY.deepStorage,    color: '#0e9db5' },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background: 'var(--surface2)', borderRadius: 8, padding: '16px 12px', border: `1px solid ${color}44` }}>
              <div style={{ width: '100%', height: 4, background: color, borderRadius: 2, marginBottom: 12 }} />
              <div style={{ fontSize: 22, fontFamily: 'Syne, sans-serif', fontWeight: 800, color }}>{value.toLocaleString()}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>TJ/day</div>
              <div style={{ fontSize: 12, color: 'var(--text)', marginTop: 6 }}>{label}</div>
            </div>
          ))}
        </div>
        <div style={{ padding: '8px 12px', background: 'var(--surface2)', borderRadius: 6, fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
          ⚠ Capacity figures are indicative. Storage availability depends on injection season and commercial decisions.
        </div>
      </ChartCard>

    </div>
  );
}
