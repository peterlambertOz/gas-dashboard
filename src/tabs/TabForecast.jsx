import { useState, useMemo, useEffect } from "react";
import {
  ComposedChart, LineChart, AreaChart,
  Area, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
  ReferenceArea
} from "recharts";

// ── Helpers ────────────────────────────────────────────────────────────────────
const fmtDate = (d) => {
  const [,, dd] = d.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const m = parseInt(d.split('-')[1]) - 1;
  return `${parseInt(dd)}-${months[m]}`;
};

// Actuals sourced from GBB records — no dummy data needed

// Styles
const C = {
  bg:        '#0d1117',
  surface:   '#161b22',
  surface2:  '#1c2128',
  border:    '#30363d',
  text:      '#e6edf3',
  muted:     '#8b949e',
  dim:       '#484f58',
  blue:      '#388bfd',
  orange:    '#e6a817',
  green:     '#3fb950',
  red:       '#f85149',
  purple:    '#bc8cff',
  teal:      '#39d0d8',
  // NEM stack colours
  coal:      '#6e7681',
  wind:      '#3fb950',
  solar:     '#e6a817',
  hydro:     '#39d0d8',
  gas:       '#388bfd',
  other:     '#bc8cff',
  // Forecast colours
  forecast:  '#388bfd',
  actual:    '#e6a817',
  poe:       'rgba(56,139,253,0.15)',
};

const AXIS = { tick: { fill: C.muted, fontSize: 11 }, axisLine: false, tickLine: false };
const GRID = { stroke: C.border, strokeDasharray: '3 3', vertical: false };

// ── Shared chart elements ──────────────────────────────────────────────────────
const ChartCard = ({ title, subtitle, children, style = {} }) => (
  <div style={{
    background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
    padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12, ...style
  }}>
    <div>
      <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 13, color: C.text }}>{title}</div>
      {subtitle && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{subtitle}</div>}
    </div>
    {children}
  </div>
);

const CustomTooltip = ({ active, payload, label, unit = 'TJ/day' }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '10px 14px', fontSize: 12 }}>
      <div style={{ color: C.muted, marginBottom: 6, fontFamily: 'DM Mono, monospace' }}>{label}</div>
      {payload.filter(p => p.value != null && !String(p.name).startsWith('__')).map((p, i) => (
        <div key={i} style={{ color: p.color || C.text, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <span>{p.name}</span>
          <span style={{ fontFamily: 'DM Mono, monospace' }}>{typeof p.value === 'number' ? p.value.toFixed(1) : p.value} {unit}</span>
        </div>
      ))}
    </div>
  );
};

const NEMTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '10px 14px', fontSize: 12 }}>
      <div style={{ color: C.muted, marginBottom: 6, fontFamily: 'DM Mono, monospace' }}>{label}</div>
      {[...payload].reverse().map((p, i) => (
        <div key={i} style={{ color: p.fill || C.text, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <span>{p.name}</span>
          <span style={{ fontFamily: 'DM Mono, monospace' }}>{p.value.toFixed(0)} GWh</span>
        </div>
      ))}
      <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 6, paddingTop: 6, color: C.text, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
        <span>Total</span>
        <span style={{ fontFamily: 'DM Mono, monospace' }}>{total.toFixed(0)} GWh</span>
      </div>
    </div>
  );
};

// ── Main component ─────────────────────────────────────────────────────────────
export default function TabForecast({ records = [], selectedYears = [2026], forecastData = null, forecastPoeData = null, forecastDate = null, onLoadForecast }) {
  const [resolvedDate, setResolvedDate] = useState(forecastDate);

  // Scan /data/ directory listing to find most recent dated forecast files
  useEffect(() => {
    if (forecastDate) { setResolvedDate(forecastDate); return; }
    fetch('/data/')
      .then(r => r.ok ? r.json() : null)
      .then(entries => {
        if (!Array.isArray(entries)) return;
        const dates = entries
          .map(e => e.name?.match(/^gas_forecast_(\d{8})\.csv$/)?.[1])
          .filter(Boolean)
          .sort();
        if (dates.length) setResolvedDate(dates[dates.length - 1]);
      })
      .catch(() => {});
  }, [forecastDate]);

  const resolvedForecast = forecastData ?? [];
  const resolvedPoe      = forecastPoeData ?? {};

  // Build chart data
  // Build date-keyed lookup from GBB records for actuals
  const gbbByDate = useMemo(() => {
    const m = {};
    for (const r of records) {
      m[r.date] = r;
    }
    return m;
  }, [records]);

  const chartData = useMemo(() => {
    return resolvedForecast.map(r => {
      const poe = resolvedPoe[r.date];
      const gbb = gbbByDate[r.date];
      // Actuals from GBB records where available
      const actual_total  = gbb ? Math.round(gbb.total_demand_se * 10) / 10 : null;
      const actual_gpg    = gbb ? Math.round(gbb.gpg_se          * 10) / 10 : null;
      const actual_nonpwr = gbb ? Math.round((gbb.industrial + gbb.residential) * 10) / 10 : null;
      const actual_vic    = gbb ? Math.round((gbb.pipe_vic - gbb.gpg_vic) * 10) / 10 : null;
      const actual_nsw    = gbb ? Math.round((gbb.pipe_nsw - gbb.gpg_nsw) * 10) / 10 : null;
      const actual_sa     = gbb ? Math.round((gbb.pipe_sa  - gbb.gpg_sa)  * 10) / 10 : null;
      const actual_tas    = gbb ? Math.round((gbb.pipe_tas - gbb.gpg_tas) * 10) / 10 : null;
      // NEM stack
      const residual = Math.max(0, r.pred_nem - r.pred_wind - r.pred_solar - r.pred_hydro - r.pred_coal - r.pred_gas_mwh);
      return {
        ...r,
        label: fmtDate(r.date),
        actual_total, actual_gpg, actual_nonpwr,
        actual_vic, actual_nsw, actual_sa, actual_tas,
        // POE band: PoE90 = floor (lower value), PoE10 = ceiling (higher value)
        poe_total_lo:  poe ? poe.p90_total  : null,
        poe_total_hi:  poe ? poe.p10_total  : null,
        poe_gpg_lo:    poe ? poe.p90_gpg    : null,
        poe_gpg_hi:    poe ? poe.p10_gpg    : null,
        poe_nonpwr_lo: poe ? poe.p90_nonpwr : null,
        poe_nonpwr_hi: poe ? poe.p10_nonpwr : null,
        // NEM stack (MWh)
        coal:     r.pred_coal,
        wind:     r.pred_wind,
        solar:    r.pred_solar,
        hydro:    r.pred_hydro,
        gas_mwh:  r.pred_gas_mwh,
        residual,
      };
    });
  }, [resolvedForecast, resolvedPoe, gbbByDate]);

  const forecastStart = resolvedForecast.find(r => r.period === 'forecast')?.date;
  const latestDate = resolvedForecast[resolvedForecast.length - 1]?.date;

  // ── Empty state (must be before todayRow which requires data) ─────────────────
  if (!resolvedForecast?.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 400, gap: 20, textAlign: 'center' }}>
        <div style={{ fontSize: 40 }}>📈</div>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 18, color: 'var(--text)' }}>No forecast data loaded</div>

        {/* File download links */}
        <div style={{ background: 'var(--surface-2, #161b22)', border: '1px solid var(--border, #30363d)', borderRadius: 8, padding: '16px 24px', maxWidth: 480, width: '100%', textAlign: 'left' }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10, fontFamily: 'DM Mono, monospace' }}>Available data files</div>
          {[
            { label: 'Gas demand forecast', file: resolvedDate ? `gas_forecast_${resolvedDate}.csv` : 'gas_forecast_latest.csv' },
          ].map(({ label, file }) => (
            <div key={file} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border, #30363d)' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
              <a href={`/data/${file}`} download style={{ fontSize: 12, fontFamily: 'DM Mono, monospace', color: '#39d0d8', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                ⬇ {file}
              </a>
            </div>
          ))}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10, fontFamily: 'DM Mono, monospace' }}>
            Files updated daily · use ↑ Load forecasts below to upload
          </div>
        </div>

        <label style={{
          padding: '8px 20px', borderRadius: 6, cursor: 'pointer', fontSize: 13,
          fontFamily: 'Syne, sans-serif', fontWeight: 600,
          border: '1px solid #bc8cff', background: '#bc8cff22', color: '#bc8cff',
        }}>
          ↑ Load forecasts
          <input
            type="file"
            accept=".csv"
            multiple
            onChange={async e => {
              const files = Array.from(e.target.files || []);
              e.target.value = '';
              for (const file of files) {
                if (onLoadForecast) await onLoadForecast(file);
              }
            }}
            style={{ display: 'none' }}
          />
        </label>
      </div>
    );
  }

  // ── Gas demand chart (with actuals + forecast + POE band) ─────────────────────
  const GasDemandChart = ({ title, subtitle, predKey, actualKey, poeLoKey, poeHiKey, color = C.blue, yDomain }) => {
    const data = chartData.map(r => ({
      label: r.label,
      date:  r.date,
      period: r.period,
      forecast: r[predKey],
      actual:   r[actualKey],
      poe_lo:   r[poeLoKey],
      poe_hi:   r[poeHiKey],
      // For area rendering: floor at min, span = abs difference
      poe_base: r[poeLoKey] != null ? r[poeLoKey] : null,
      poe_span: (r[poeLoKey] != null && r[poeHiKey] != null) ? r[poeHiKey] - r[poeLoKey] : null,
    }));

    return (
      <ChartCard title={title} subtitle={subtitle}>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="label" {...AXIS} interval={9} />
            <YAxis {...AXIS} width={38} domain={yDomain || ['auto','auto']} unit="" tickFormatter={v => v} />
            <Tooltip content={<CustomTooltip unit="TJ/day" />} />
            {/* POE band: invisible floor + shaded span */}
            <Area dataKey="poe_base" stackId="poe" stroke="none" fill="none" legendType="none" name="__hidden__" connectNulls />
            <Area dataKey="poe_span" stackId="poe" stroke="none" fill={color} fillOpacity={0.35} legendType="none" name="__hidden__" connectNulls />
            {/* PoE boundary lines */}
            <Line dataKey="poe_lo" stroke={color} strokeWidth={1} strokeDasharray="3 3" dot={false} name="PoE 90" connectNulls />
            <Line dataKey="poe_hi" stroke={color} strokeWidth={1} strokeDasharray="3 3" dot={false} name="PoE 10" connectNulls />
            {/* Forecast */}
            <Line dataKey="forecast" stroke={color} strokeWidth={2} dot={false} name="Forecast" connectNulls />
            {/* Actual dots */}
            <Line dataKey="actual" stroke={C.actual} strokeWidth={0} dot={{ r: 2, fill: C.actual }} name="Actual (GBB)" connectNulls />
            {/* Forecast / backcast divider */}
            {forecastStart && <ReferenceLine x={fmtDate(forecastStart)} stroke={C.dim} strokeDasharray="4 3" label={{ value: 'Fcast →', fill: C.muted, fontSize: 10, position: 'insideTopRight' }} />}
          </ComposedChart>
        </ResponsiveContainer>
        <div style={{ display: 'flex', gap: 16, fontSize: 11, color: C.muted }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 16, height: 8, background: color, opacity: 0.35, display: 'inline-block', borderRadius: 2 }}></span> PoE 10–90</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 16, height: 2, background: color, display: 'inline-block' }}></span> Forecast</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: C.actual, display: 'inline-block' }}></span> Actual (GBB)</span>
        </div>
      </ChartCard>
    );
  };

  // ── State non-power chart (compact) ──────────────────────────────────────────
  const StateChart = ({ title, predKey, actualKey, color }) => {
    const data = chartData.map(r => ({
      label:    r.label,
      forecast: r[predKey],
      actual:   r[actualKey],
    }));
    return (
      <ChartCard title={title} subtitle="Non-power TJ/day" style={{ flex: '1 1 calc(50% - 8px)', minWidth: 280 }}>
        <ResponsiveContainer width="100%" height={160}>
          <ComposedChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="label" {...AXIS} interval={9} />
            <YAxis {...AXIS} width={34} />
            <Tooltip content={<CustomTooltip unit="TJ/day" />} />
            {forecastStart && <ReferenceLine x={fmtDate(forecastStart)} stroke={C.dim} strokeDasharray="4 3" label={{ value: 'Fcast →', fill: C.muted, fontSize: 10, position: 'insideTopRight' }} />}
            <Line dataKey="forecast" stroke={color} strokeWidth={1.5} dot={false} name="Forecast" />
            <Line dataKey="actual" stroke={C.actual} strokeWidth={0} dot={{ r: 2, fill: C.actual }} name="Actual" />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>
    );
  };

  // ── NEM stack chart ───────────────────────────────────────────────────────────
  const NEMStackChart = () => {
    const data = chartData.map(r => ({
      label:    r.label,
      coal:     Math.round(r.coal / 1000),   // → GWh
      wind:     Math.round(r.wind / 1000),
      solar:    Math.round(r.solar / 1000),
      hydro:    Math.round(r.hydro / 1000),
      gas:      Math.round(r.gas_mwh / 1000),
      residual: Math.round(r.residual / 1000),
    }));
    return (
      <ChartCard title="NEM Generation Stack — Daily Forecast" subtitle="GWh/day  ·  stacked area by source">
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="label" {...AXIS} interval={9} />
            <YAxis {...AXIS} width={38} unit="" />
            <Tooltip content={<NEMTooltip />} />
            {forecastStart && <ReferenceLine x={fmtDate(forecastStart)} stroke={C.dim} strokeDasharray="4 3" label={{ value: 'Fcast →', fill: C.muted, fontSize: 10, position: 'insideTopRight' }} />}
            <Area type="monotone" dataKey="coal"  stackId="nem" fill={C.coal}  stroke="none" name="Coal" />
            <Area type="monotone" dataKey="wind"  stackId="nem" fill={C.wind}  stroke="none" name="Wind" />
            <Area type="monotone" dataKey="solar" stackId="nem" fill={C.solar} stroke="none" name="Solar" />
            <Area type="monotone" dataKey="hydro" stackId="nem" fill={C.hydro} stroke="none" name="Hydro" />
            <Area type="monotone" dataKey="gas"   stackId="nem" fill={C.gas}   stroke="none" name="Gas" />
            <Area type="monotone" dataKey="residual" stackId="nem" fill={C.other} stroke="none" name="Other incl BESS and oil" fillOpacity={0.8} />
          </ComposedChart>
        </ResponsiveContainer>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11 }}>
          {[['Coal', C.coal], ['Wind', C.wind], ['Solar', C.solar], ['Hydro', C.hydro], ['Gas', C.gas], ['Other incl BESS/oil', C.other]].map(([label, color]) => (
            <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4, color: C.muted }}>
              <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: 'inline-block' }}></span>
              {label}
            </span>
          ))}
        </div>
      </ChartCard>
    );
  };

  // ── Header KPIs ──────────────────────────────────────────────────────────────
  // KPI strip: show today's forecast if available, else nearest date
  const todayStr = (() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  })();
  const todayRow = resolvedForecast.find(r => r.date === todayStr)
    ?? resolvedForecast.reduce((best, r) =>
        Math.abs(new Date(r.date) - new Date(todayStr)) < Math.abs(new Date(best.date) - new Date(todayStr)) ? r : best
      , resolvedForecast[resolvedForecast.length - 1]);
  const poeLatest = todayRow ? resolvedPoe[todayRow.date] ?? null : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '4px 0' }}>

      {/* Header strip */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 15, color: C.text }}>
          2026 Gas Demand Forecast
        </div>
        <div style={{ fontSize: 11, color: C.muted, fontFamily: 'DM Mono, monospace' }}>
          run: {fmtDate(forecastStart ? resolvedForecast.find(r => r.date < forecastStart && r.period === 'backcast')?.date ?? forecastStart : latestDate)} · today: {fmtDate(todayRow?.date)} · horizon: {fmtDate(latestDate)}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {[
            { label: 'Total (P50)',    value: todayRow ? `${todayRow.pred_total.toFixed(0)} TJ` : '—', sub: poeLatest ? `P10 ${poeLatest.p10_total} – P90 ${poeLatest.p90_total}` : null, color: C.blue },
            { label: 'GPG (P50)',      value: todayRow ? `${todayRow.pred_gpg.toFixed(0)} TJ` : '—',   sub: poeLatest ? `P10 ${poeLatest.p10_gpg} – P90 ${poeLatest.p90_gpg}` : null,   color: C.orange },
            { label: 'Non-power (P50)',value: todayRow ? `${todayRow.pred_nonpwr.toFixed(0)} TJ` : '—',sub: poeLatest ? `P10 ${poeLatest.p10_nonpwr} – P90 ${poeLatest.p90_nonpwr}` : null, color: C.green },
          ].map(kpi => (
            <div key={kpi.label} style={{
              background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6,
              padding: '8px 14px', textAlign: 'right', minWidth: 130,
            }}>
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 2 }}>{kpi.label}</div>
              <div style={{ fontFamily: 'DM Mono, monospace', fontWeight: 700, fontSize: 16, color: kpi.color }}>{kpi.value}</div>
              {kpi.sub && <div style={{ fontSize: 10, color: C.dim, marginTop: 1 }}>{kpi.sub}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* Upload notice */}
      <div style={{
        background: 'rgba(56,139,253,0.06)', border: `1px solid rgba(56,139,253,0.2)`,
        borderRadius: 6, padding: '8px 14px', fontSize: 12, color: C.muted,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ color: C.blue }}>ℹ</span>
        To update: use <strong style={{ color: C.text }}>↑ Load XLSX/CSV</strong> to upload a new forecast CSV file. Files named <code style={{ fontFamily: 'DM Mono, monospace', color: C.teal }}>gas_forecast_*.csv</code> and <code style={{ fontFamily: 'DM Mono, monospace', color: C.teal }}>gas_forecast_poe_*.csv</code> will be auto-detected.
      </div>

      {/* Row 1 — three main gas demand charts */}
      <GasDemandChart
        title="Total Gas Demand — SE NEM"
        subtitle="GPG + non-power  ·  TJ/day  ·  P10/P90 band shown for forward forecast only"
        predKey="pred_total" actualKey="actual_total"
        poeLoKey="poe_total_lo" poeHiKey="poe_total_hi"
        color={C.blue}
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <GasDemandChart
          title="Gas Power Generation Demand"
          subtitle="TJ/day"
          predKey="pred_gpg" actualKey="actual_gpg"
          poeLoKey="poe_gpg_lo" poeHiKey="poe_gpg_hi"
          color={C.orange}
        />
        <GasDemandChart
          title="Non-Power Gas Demand"
          subtitle="Domestic + industrial  ·  TJ/day"
          predKey="pred_nonpwr" actualKey="actual_nonpwr"
          poeLoKey="poe_nonpwr_lo" poeHiKey="poe_nonpwr_hi"
          color={C.green}
        />
      </div>

      {/* Row 2 — four state non-power charts */}
      <div style={{ fontSize: 12, color: C.muted, fontFamily: 'Syne, sans-serif', fontWeight: 600 }}>Non-Power Demand by State</div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <StateChart title="Victoria" predKey="pred_vic" actualKey="actual_vic" color={C.blue} />
        <StateChart title="NSW" predKey="pred_nsw" actualKey="actual_nsw" color={C.purple} />
        <StateChart title="South Australia" predKey="pred_sa" actualKey="actual_sa" color={C.teal} />
        <StateChart title="Tasmania" predKey="pred_tas" actualKey="actual_tas" color={C.red} />
      </div>

      {/* Row 3 — NEM generation stack */}
      <NEMStackChart />
    </div>
  );
}
