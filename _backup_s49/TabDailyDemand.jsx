import {
  ComposedChart, Area, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';
import { useMemo, useState } from 'react';
import { ChartCard, KpiCard, CustomTooltip, AXIS_STYLE, GRID_STYLE, CHART_COLORS, YEAR_COLORS, Legend, fmtDate } from '../components/ChartCard';
import { exportToPowerPoint, exportToExcel } from '../utils/exportUtils';

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// FIX 2: configurable threshold, default 2190
const DEFAULT_THRESHOLD = 2190;

const STATE_COLORS = { VIC: '#388bfd', NSW: '#3fb950', SA: '#e6a817', TAS: '#bc8cff' };

export default function TabDailyDemand({ records, selectedYears, dateRange }) {
  const latestYear = Math.max(...selectedYears);
  // FIX 1: separate year selectors for each stacked chart
  const [stackYear, setStackYear] = useState(latestYear);
  const [stateYear, setStateYear] = useState(latestYear);
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [editingThreshold, setEditingThreshold] = useState(false);
  const [thresholdInput, setThresholdInput] = useState(String(DEFAULT_THRESHOLD));

  const filtered = useMemo(() =>
    records.filter(r => selectedYears.includes(r.year) && r.date >= dateRange[0] && r.date <= dateRange[1])
  , [records, selectedYears, dateRange]);

  // Year-on-year overlay
  const yoyData = useMemo(() => {
    const pivot = {};
    for (const r of filtered) {
      if (!pivot[r.dayOfYear]) pivot[r.dayOfYear] = { day: r.dayOfYear };
      pivot[r.dayOfYear][r.year] = r.total_demand_se;
    }
    return Object.values(pivot).sort((a, b) => a.day - b.day);
  }, [filtered]);

  // Stacked daily for selected year
  const stackedDaily = useMemo(() =>
    records.filter(r => r.year === stackYear && r.date >= dateRange[0] && r.date <= dateRange[1])
      .map(r => ({
        date: r.date.substring(5),
        residential: Math.round(r.residential),
        industrial:  Math.round(r.industrial),
        gpg:         Math.round(r.gpg_se),
      }))
  , [records, stackYear, dateRange]);

  // Daily demand by state
  const stateDaily = useMemo(() =>
    records.filter(r => r.year === stateYear && r.date >= dateRange[0] && r.date <= dateRange[1])
      .map(r => ({
        date: r.date.substring(5),
        vic: Math.round(r.total_vic || 0),
        nsw: Math.round(r.total_nsw || 0),
        sa:  Math.round(r.total_sa  || 0),
        tas: Math.round(r.total_tas || 0),
      }))
  , [records, stateYear, dateRange]);

  // Monthly average bars — FIX 4: labeled by year
  const monthlyAvg = useMemo(() => {
    const out = MONTH_LABELS.map((m, i) => ({ month: m, monthNum: i + 1 }));
    for (const y of selectedYears) {
      for (let m = 1; m <= 12; m++) {
        const rows = filtered.filter(r => r.year === y && r.month === m);
        if (!rows.length) continue;
        const avg = arr => Math.round(arr.reduce((s, v) => s + v, 0) / arr.length);
        out[m-1][`res_${y}`] = avg(rows.map(r => r.residential));
        out[m-1][`ind_${y}`] = avg(rows.map(r => r.industrial));
        out[m-1][`gpg_${y}`] = avg(rows.map(r => r.gpg_se));
      }
    }
    return out;
  }, [filtered, selectedYears]);

  // KPIs — FIX 3: no decimals
  const latestData = records.filter(r => r.year === latestYear && r.total_demand_se > 0);
  const peakDay = latestData.reduce((max, r) => r.total_demand_se > (max?.total_demand_se || 0) ? r : max, null);
  const avgDemand = latestData.length ? Math.round(latestData.reduce((s, r) => s + r.total_demand_se, 0) / latestData.length) : 0;
  const daysOverThreshold = latestData.filter(r => r.total_demand_se > threshold).length;

  // DOY → date label for YoY chart (FIX 5 analogous — applied here too)
  const dayLabel = (doy) => {
    const d = new Date(2024, 0, doy);
    return `${d.getDate()}-${MONTH_LABELS[d.getMonth()]}`;
  };

  const commitThreshold = () => {
    const v = parseInt(thresholdInput);
    if (!isNaN(v) && v > 0) setThreshold(v);
    else setThresholdInput(String(threshold));
    setEditingThreshold(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <KpiCard label={`${latestYear} Peak Day`}
          value={peakDay ? Math.round(peakDay.total_demand_se).toLocaleString() : '—'}
          unit="TJ" sub={peakDay?.date} color="var(--accent)" />
        <KpiCard label={`${latestYear} Average`} value={avgDemand.toLocaleString()} unit="TJ/day" color="var(--accent3)" />
        <KpiCard label={`Days > ${threshold.toLocaleString()} TJ`} value={daysOverThreshold} unit={`in ${latestYear}`} color="var(--danger)" />
        <KpiCard label="Years shown" value={selectedYears.length} unit="years" sub={selectedYears.join(', ')} color="var(--accent2)" />
      </div>

      {/* Threshold control */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>THRESHOLD LINE</span>
        {editingThreshold ? (
          <>
            <input
              value={thresholdInput}
              onChange={e => setThresholdInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitThreshold(); if (e.key === 'Escape') { setEditingThreshold(false); setThresholdInput(String(threshold)); }}}
              autoFocus
              style={{ width: 80, background: 'var(--surface2)', border: '1px solid var(--accent)', borderRadius: 4, padding: '3px 8px', color: 'var(--text)', fontSize: 12, fontFamily: 'DM Mono, monospace' }}
            />
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>TJ</span>
            <button onClick={commitThreshold} style={{ padding: '3px 10px', borderRadius: 4, border: '1px solid var(--accent2)', background: 'transparent', color: 'var(--accent2)', cursor: 'pointer', fontSize: 11 }}>✓</button>
          </>
        ) : (
          <button onClick={() => { setEditingThreshold(true); setThresholdInput(String(threshold)); }}
            style={{ padding: '3px 12px', borderRadius: 4, border: '1px solid var(--danger)', background: 'transparent', color: 'var(--danger)', cursor: 'pointer', fontSize: 12, fontFamily: 'DM Mono, monospace' }}>
            {threshold.toLocaleString()} TJ ✎
          </button>
        )}
      </div>

      {/* YoY overlay */}
      <ChartCard
        id="chart-yoy-demand"
        title="Year-on-Year Daily Demand Comparison"
        subtitle="SE States total demand (TJ/day) — overlay by calendar day"
        onExportPPT={() => exportToPowerPoint([{ id: 'chart-yoy-demand', title: 'Year-on-Year Daily Demand', subtitle: 'SE States (TJ/day)' }])}
        onExportXLSX={() => exportToExcel(filtered)}
      >
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={yoyData} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="day" tickFormatter={dayLabel}
              ticks={[1,32,60,91,121,152,182,213,244,274,305,335]} {...AXIS_STYLE} />
            <YAxis {...AXIS_STYLE} tickFormatter={v => Math.round(v).toLocaleString()} />
            <Tooltip content={<CustomTooltip formatter={v => `${Math.round(v).toLocaleString()} TJ`}  labelFormatter={dayLabel} /> } />
            {selectedYears.map(y => (
              <Line key={y} type="monotone" dataKey={String(y)} name={String(y)}
                stroke={YEAR_COLORS[y] || '#888'} strokeWidth={y === latestYear ? 2.5 : 1.5}
                dot={false} connectNulls />
            ))}
            <ReferenceLine y={threshold} stroke="#f85149" strokeDasharray="4 4"
              label={{ value: `${threshold.toLocaleString()} TJ`, fill: '#f85149', fontSize: 10, position: 'insideTopLeft' }} />
          </ComposedChart>
        </ResponsiveContainer>
        <Legend items={selectedYears.map(y => ({ color: YEAR_COLORS[y] || '#888', label: String(y) }))} />
      </ChartCard>

      {/* Daily demand by state */}
      <ChartCard
        id="chart-state-demand-daily"
        title="Daily Demand by State"
        subtitle="Stacked TJ/day — VIC / NSW / SA / TAS"
        onExportPPT={() => exportToPowerPoint([{ id: 'chart-state-demand-daily', title: `${stateYear} Daily Demand by State` }])}
        onExportXLSX={() => exportToExcel(records.filter(r => r.year === stateYear))}
      >
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {selectedYears.map(y => (
            <button key={y} onClick={() => setStateYear(y)} style={{
              padding: '2px 9px', borderRadius: 4, cursor: 'pointer', fontSize: 11,
              fontFamily: 'DM Mono, monospace',
              border: `1px solid ${y === stateYear ? YEAR_COLORS[y] || 'var(--accent)' : 'var(--border)'}`,
              background: y === stateYear ? (YEAR_COLORS[y] || 'var(--accent)') + '22' : 'transparent',
              color: y === stateYear ? YEAR_COLORS[y] || 'var(--accent)' : 'var(--text-muted)',
            }}>{y}</button>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={stateDaily} margin={{ top: 5, right: 10, bottom: 0, left: 10 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="date" {...AXIS_STYLE} tickFormatter={fmtDate} interval={Math.floor(stateDaily.length / 12)} />
            <YAxis {...AXIS_STYLE} tickFormatter={v => Math.round(v).toLocaleString()} />
            <Tooltip content={<CustomTooltip formatter={v => `${Math.round(v).toLocaleString()} TJ`}  labelFormatter={fmtDate} /> } />
            <Area type="monotone" dataKey="vic" stackId="1" name="VIC" fill={STATE_COLORS.VIC} stroke={STATE_COLORS.VIC} fillOpacity={0.85} />
            <Area type="monotone" dataKey="nsw" stackId="1" name="NSW" fill={STATE_COLORS.NSW} stroke={STATE_COLORS.NSW} fillOpacity={0.85} />
            <Area type="monotone" dataKey="sa"  stackId="1" name="SA"  fill={STATE_COLORS.SA}  stroke={STATE_COLORS.SA}  fillOpacity={0.85} />
            <Area type="monotone" dataKey="tas" stackId="1" name="TAS" fill={STATE_COLORS.TAS} stroke={STATE_COLORS.TAS} fillOpacity={0.85} />
          </ComposedChart>
        </ResponsiveContainer>
        <Legend items={Object.entries(STATE_COLORS).map(([s, c]) => ({ color: c, label: s }))} />
      </ChartCard>

      {/* Stacked daily — FIX 1: year selector */}
      <ChartCard
        id="chart-stacked-demand"
        title="Daily Demand by Segment"
        subtitle="Stacked area: Residential & Commercial / Industrial / GPG (TJ/day)"
        onExportPPT={() => exportToPowerPoint([{ id: 'chart-stacked-demand', title: `${stackYear} Daily Demand by Segment` }])}
        onExportXLSX={() => exportToExcel(records.filter(r => r.year === stackYear))}
      >
        {/* Year selector */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {selectedYears.map(y => (
            <button key={y} onClick={() => setStackYear(y)} style={{
              padding: '2px 9px', borderRadius: 4, cursor: 'pointer', fontSize: 11,
              fontFamily: 'DM Mono, monospace',
              border: `1px solid ${y === stackYear ? YEAR_COLORS[y] || 'var(--accent)' : 'var(--border)'}`,
              background: y === stackYear ? (YEAR_COLORS[y] || 'var(--accent)') + '22' : 'transparent',
              color: y === stackYear ? YEAR_COLORS[y] || 'var(--accent)' : 'var(--text-muted)',
            }}>{y}</button>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={stackedDaily} margin={{ top: 5, right: 10, bottom: 0, left: 10 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="date" {...AXIS_STYLE} tickFormatter={fmtDate} interval={Math.floor(stackedDaily.length / 12)} />
            <YAxis {...AXIS_STYLE} tickFormatter={v => Math.round(v).toLocaleString()} />
            <Tooltip content={<CustomTooltip formatter={v => `${Math.round(v).toLocaleString()} TJ`}  labelFormatter={fmtDate} /> } />
            <Area type="monotone" dataKey="residential" stackId="1" name="Res & Comm" fill={CHART_COLORS.residential} stroke={CHART_COLORS.residential} fillOpacity={0.85} />
            <Area type="monotone" dataKey="industrial"  stackId="1" name="Industrial" fill={CHART_COLORS.industrial}  stroke={CHART_COLORS.industrial}  fillOpacity={0.85} />
            <Area type="monotone" dataKey="gpg"         stackId="1" name="GPG"        fill={CHART_COLORS.gpg}         stroke={CHART_COLORS.gpg}         fillOpacity={0.9}  />
            <ReferenceLine y={threshold} stroke="#f85149" strokeDasharray="4 4" />
          </ComposedChart>
        </ResponsiveContainer>
        <Legend items={[
          { color: CHART_COLORS.residential, label: 'Residential & Commercial' },
          { color: CHART_COLORS.industrial,  label: 'Industrial' },
          { color: CHART_COLORS.gpg,         label: 'GPG' },
        ]} />
      </ChartCard>

      {/* Monthly average — FIX 4: labeled bars */}
      <ChartCard
        id="chart-monthly-avg"
        title="Average Monthly Demand by Segment"
        subtitle="Mean TJ/day per month"
        onExportPPT={() => exportToPowerPoint([{ id: 'chart-monthly-avg', title: 'Average Monthly Demand by Segment' }])}
        onExportXLSX={() => exportToExcel(filtered)}
      >
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={monthlyAvg} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="month" {...AXIS_STYLE} />
            <YAxis {...AXIS_STYLE} tickFormatter={v => Math.round(v).toLocaleString()} />
            <Tooltip content={<CustomTooltip formatter={v => `${Math.round(v).toLocaleString()} TJ/day`}  labelFormatter={fmtDate} /> } />
            {selectedYears.map(y => [
              <Bar key={`gpg_${y}`} dataKey={`gpg_${y}`} name={`GPG ${y}`} stackId={String(y)}
                fill={CHART_COLORS.gpg} opacity={y === latestYear ? 1 : 0.45} />,
              <Bar key={`ind_${y}`} dataKey={`ind_${y}`} name={`Industrial ${y}`} stackId={String(y)}
                fill={CHART_COLORS.industrial} opacity={y === latestYear ? 1 : 0.45} />,
              <Bar key={`res_${y}`} dataKey={`res_${y}`} name={`Res & Comm ${y}`} stackId={String(y)}
                fill={CHART_COLORS.residential} opacity={y === latestYear ? 1 : 0.45} />,
            ])}
          </ComposedChart>
        </ResponsiveContainer>
        {/* FIX 4: legend showing all selected years with labels */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px', marginTop: 8 }}>
          {selectedYears.map(y => (
            <div key={y} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: YEAR_COLORS[y] || '#888', fontFamily: 'DM Mono, monospace', fontWeight: 600 }}>{y}</span>
              {[
                { color: CHART_COLORS.gpg, label: 'GPG' },
                { color: CHART_COLORS.industrial, label: 'Industrial' },
                { color: CHART_COLORS.residential, label: 'Res & Comm' },
              ].map(({ color, label }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4, opacity: y === latestYear ? 1 : 0.6 }}>
                  <div style={{ width: 9, height: 9, borderRadius: 2, background: color }} />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </ChartCard>
    </div>
  );
}
