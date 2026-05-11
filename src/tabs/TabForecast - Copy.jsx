import { useState, useMemo, useEffect } from "react";
import {
  ComposedChart, LineChart, AreaChart,
  Area, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine,
  ReferenceArea
} from "recharts";
import { fetchGBBNominations, parseGBBNominations } from '../utils/aemoParser';

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
  // Merge residual_pos and residual_neg back into a single "Other incl BESS/oil" entry
  const merged = [];
  let otherVal = null;
  let otherFill = null;
  for (const p of [...payload].reverse()) {
    if (p.name === '__hidden__') continue;
    if (p.dataKey === 'residual_pos' || p.dataKey === 'residual_neg') {
      otherVal = (otherVal ?? 0) + (p.value || 0);
      otherFill = p.fill;
    } else {
      merged.push(p);
    }
  }
  if (otherFill !== null) merged.push({ name: 'Other incl BESS/oil', value: otherVal, fill: otherFill, dataKey: 'other' });
  const total = merged.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, padding: '10px 14px', fontSize: 12 }}>
      <div style={{ color: C.muted, marginBottom: 6, fontFamily: 'DM Mono, monospace' }}>{label}</div>
      {merged.map((p, i) => (
        <div key={i} style={{ color: p.fill || C.text, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <span>{p.name}{p.dataKey === 'other' && p.value < 0 ? ' (charging)' : ''}</span>
          <span style={{ fontFamily: 'DM Mono, monospace' }}>{p.value.toFixed(1)} GWh</span>
        </div>
      ))}
      <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 6, paddingTop: 6, color: C.text, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
        <span>Total</span>
        <span style={{ fontFamily: 'DM Mono, monospace' }}>{total.toFixed(1)} GWh</span>
      </div>
    </div>
  );
};

// ── NEM daily generation stack — top-level to prevent remount on parent re-render
function NEMStackChart({ chartData, forecastStart }) {
  const data = chartData.map(r => ({
    label:    r.label,
    coal:     Math.round(r.coal / 1000),
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
          <Area type="monotone" dataKey="coal"     stackId="nem" fill={C.coal}  stroke="none" name="Coal" />
          <Area type="monotone" dataKey="wind"     stackId="nem" fill={C.wind}  stroke="none" name="Wind" />
          <Area type="monotone" dataKey="solar"    stackId="nem" fill={C.solar} stroke="none" name="Solar" />
          <Area type="monotone" dataKey="hydro"    stackId="nem" fill={C.hydro} stroke="none" name="Hydro" />
          <Area type="monotone" dataKey="gas"      stackId="nem" fill={C.gas}   stroke="none" name="Gas" />
          <Area type="monotone" dataKey="residual" stackId="nem" fill={C.other} stroke="none" name="Other incl BESS and oil" fillOpacity={0.8} />
        </ComposedChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11 }}>
        {[['Coal',C.coal],['Wind',C.wind],['Solar',C.solar],['Hydro',C.hydro],['Gas',C.gas],['Other incl BESS/oil',C.other]].map(([label, color]) => (
          <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4, color: C.muted }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: 'inline-block' }}></span>
            {label}
          </span>
        ))}
      </div>
    </ChartCard>
  );
}

// ── Hourly dispatch chart — top-level so it doesn't remount on parent re-render
function HourlyDispatchChart({ hourlyData, hourlyDay, setHourlyDay }) {
  const source = hourlyData;
  if (!source?.length) return null;

  const dates = [...new Set(source.map(r => r.date))].sort();
  const firstFcDate = source.find(r => r.period === 'forecast')?.date ?? dates[0];
  const activeDay = hourlyDay ?? firstFcDate;

  const dayData = useMemo(() => source
    .filter(r => r.date === activeDay)
    .sort((a, b) => parseInt(a.hour) - parseInt(b.hour))
    .map(r => ({
      hour:         parseInt(r.hour),
      label:        `${String(parseInt(r.hour)).padStart(2,'0')}:00`,
      coal:         Math.round(parseFloat(r.pred_coal_mwh)    / 100) / 10,
      wind:         Math.round(parseFloat(r.pred_wind_mwh)    / 100) / 10,
      solar:        Math.round(parseFloat(r.pred_solar_mwh)   / 100) / 10,
      hydro:        Math.round(parseFloat(r.pred_hydro_mwh)   / 100) / 10,
      gas:          Math.round(parseFloat(r.pred_gpg_mwh)     / 100) / 10,
      residual_pos: Math.max(0, Math.round(parseFloat(r.pred_residual_mwh) / 100) / 10),
      residual_neg: Math.min(0, Math.round(parseFloat(r.pred_residual_mwh) / 100) / 10),
      period:       r.period,
    })), [source, activeDay]);

  if (!dayData.length) return null;

  const isForecast = source.find(r => r.date === activeDay)?.period === 'forecast';

  return (
    <ChartCard
      title="NEM Hourly Dispatch — Power Generation Mix"
      subtitle={`GWh/hour · ${activeDay}${isForecast ? ' · forecast' : ' · backcast'}`}
    >
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {dates.map(d => {
          const isFc = source.find(r => r.date === d)?.period === 'forecast';
          const active = (hourlyDay ?? firstFcDate) === d;
          return (
            <button key={d} onClick={() => setHourlyDay(d)} style={{
              padding: '2px 8px', borderRadius: 4, fontSize: 10,
              fontFamily: 'DM Mono, monospace', cursor: 'pointer',
              border: `1px solid ${active ? (isFc ? C.blue : C.orange) : C.border}`,
              background: active ? (isFc ? '#388bfd22' : '#e6a81722') : 'transparent',
              color: active ? (isFc ? C.blue : C.orange) : C.muted,
            }}>
              {d.slice(8)}/{d.slice(5,7)}
            </button>
          );
        })}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={dayData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="label" {...AXIS} interval={2} />
          <YAxis {...AXIS} width={38} unit="" />
          <Tooltip content={<NEMTooltip />} />
          <Area type="monotone" dataKey="coal"         stackId="h" fill={C.coal}  stroke="none" name="Coal" />
          <Area type="monotone" dataKey="wind"         stackId="h" fill={C.wind}  stroke="none" name="Wind" />
          <Area type="monotone" dataKey="solar"        stackId="h" fill={C.solar} stroke="none" name="Solar" />
          <Area type="monotone" dataKey="hydro"        stackId="h" fill={C.hydro} stroke="none" name="Hydro" />
          <Area type="monotone" dataKey="gas"          stackId="h" fill={C.gas}   stroke="none" name="Gas" />
          <Area type="monotone" dataKey="residual_pos" stackId="h" fill={C.other} stroke="none" name="Other incl BESS/oil" fillOpacity={0.8} />
          <Area type="monotone" dataKey="residual_neg" stackId="neg" fill={C.other} stroke="none" name="__hidden__" fillOpacity={0.5} />
        </ComposedChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11 }}>
        {[['Coal',C.coal],['Wind',C.wind],['Solar',C.solar],['Hydro',C.hydro],['Gas',C.gas],['Other incl BESS/oil',C.other]].map(([label, color]) => (
          <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4, color: C.muted }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: 'inline-block' }} />
            {label}
          </span>
        ))}
      </div>
    </ChartCard>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function TabForecast({ records = [], selectedYears = [2026], forecastData = null, forecastPoeData = null, forecastDate = null, onLoadForecast, onForecastAutoLoaded, hourlyData = null }) {
  const [resolvedDate,   setResolvedDate]   = useState(forecastDate);
  const [autoFetching,   setAutoFetching]   = useState(false);
  const [autoFetchDone,  setAutoFetchDone]  = useState(false);
  const [autoFetchError, setAutoFetchError] = useState(null);
  const [hourlyDay,      setHourlyDay]      = useState(null);

  // GBB Nomination state
  const [gbbNomData,      setGbbNomData]      = useState(null);   // parsed nomination rows
  const [gbbNomFetching,  setGbbNomFetching]  = useState(false);
  const [gbbNomError,     setGbbNomError]     = useState(null);
  const [gbbNomLastFetch, setGbbNomLastFetch] = useState(null);

  // Build a YYYYMMDD string for today minus N days
  const dateStr = (daysAgo = 0) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('');
  };

  // Parse forecast CSV text into rows + poeMap (mirrors App.jsx routeFile)
  const parseForecastCsv = (text) => {
    const lines   = text.trim().split('\n').map(l => l.endsWith('\r') ? l.slice(0,-1) : l).filter(Boolean);
    const headers = lines[0].split(',').map(h => h.trim());
    const rows = lines.slice(1).map(l => {
      const vals = l.split(',');
      const raw  = Object.fromEntries(headers.map((h, i) => [h, vals[i]?.trim() ?? '']));
      const gpg_tj = parseFloat(raw.pred_gpg_tj) || 0;
      let date = raw.date;
      if (date && date.includes('/')) { const [d,m,y] = date.split('/'); date = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`; }
      return {
        date, period: raw.period,
        pred_total:   parseFloat(raw.pred_total_tj)         || 0,
        pred_gpg:     gpg_tj,
        pred_nonpwr:  parseFloat(raw.pred_nonpower_tj)      || 0,
        pred_vic:     parseFloat(raw.pred_vic_nonpower_tj)  || 0,
        pred_nsw:     parseFloat(raw.pred_nsw_nonpower_tj)  || 0,
        pred_sa:      parseFloat(raw.pred_sa_nonpower_tj)   || 0,
        pred_tas:     parseFloat(raw.pred_tas_nonpower_tj)  || 0,
        pred_nem:     parseFloat(raw.pred_nem_mwh)          || 0,
        pred_wind:    parseFloat(raw.pred_wind_mwh)         || 0,
        pred_solar:   parseFloat(raw.pred_solar_mwh)        || 0,
        pred_hydro:   parseFloat(raw.pred_hydro_mwh)        || 0,
        pred_coal:    parseFloat(raw.pred_coal_mwh)         || 0,
        pred_gas_mwh: Math.round(gpg_tj * 1000 / 8.5),
        actual_gpg_tj:          parseFloat(raw.actual_gpg_tj)         || null,
        actual_nonpower_tj:     parseFloat(raw.actual_nonpower_tj)    || null,
        actual_vic_nonpower_tj: parseFloat(raw.actual_vic_nonpower_tj)|| null,
        actual_nsw_nonpower_tj: parseFloat(raw.actual_nsw_nonpower_tj)|| null,
        actual_sa_nonpower_tj:  parseFloat(raw.actual_sa_nonpower_tj) || null,
        actual_tas_nonpower_tj: parseFloat(raw.actual_tas_nonpower_tj)|| null,
      };
    });
    const poeMap = {};
    lines.slice(1).forEach(l => {
      const vals = l.split(',');
      const raw  = Object.fromEntries(headers.map((h, i) => [h, vals[i]?.trim() ?? '']));
      if (!raw.date) return;
      let pd = raw.date;
      if (pd.includes('/')) { const [d,m,y] = pd.split('/'); pd = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`; }
      const p10 = parseFloat(raw.poe10_total_tj ?? raw.p10_total_tj);
      if (isNaN(p10)) return;
      const p = v => { const n = parseFloat(v); return isNaN(n) ? null : n === 0 ? 0.1 : n; };
      poeMap[pd] = {
        p10_total:  p(raw.poe10_total_tj  ?? raw.p10_total_tj),
        p90_total:  p(raw.poe90_total_tj  ?? raw.p90_total_tj),
        p10_gpg:    p(raw.poe10_gpg_tj    ?? raw.p10_gpg_tj),
        p90_gpg:    p(raw.poe90_gpg_tj    ?? raw.p90_gpg_tj),
        p10_nonpwr: p(raw.poe10_nonpwr_tj ?? raw.p10_nonpwr_tj),
        p90_nonpwr: p(raw.poe90_nonpwr_tj ?? raw.p90_nonpwr_tj),
      };
    });
    return { rows, poeMap };
  };

  // Auto-fetch: try today then walk back up to 7 days
  useEffect(() => {
    if (forecastData?.length || autoFetchDone) return;
    let cancelled = false;
    (async () => {
      setAutoFetching(true);
      setAutoFetchError(null);
      for (let daysAgo = 0; daysAgo <= 7; daysAgo++) {
        const ds  = dateStr(daysAgo);
        const url = `/data/gas_forecast_${ds}.csv`;
        try {
          const r = await fetch(url);
          if (!r.ok) continue;
          const text = await r.text();
          if (!text.trim().toLowerCase().startsWith('date')) continue; // HTML 404 guard
          if (cancelled) return;
          const { rows, poeMap } = parseForecastCsv(text);
          if (rows.length) {
            setResolvedDate(ds);
            if (onForecastAutoLoaded) onForecastAutoLoaded(rows, Object.keys(poeMap).length ? poeMap : null);
            setAutoFetching(false);
            setAutoFetchDone(true);
            return;
          }
        } catch { /* try next */ }
      }
      if (!cancelled) {
        setAutoFetching(false);
        setAutoFetchDone(true);
        setAutoFetchError('No forecast file found in /data/ for the last 7 days.');
      }
    })();
    return () => { cancelled = true; };
  }, [forecastData, autoFetchDone]);



  const resolvedForecast = forecastData ?? [];
  const resolvedPoe      = forecastPoeData ?? {};

  // Build chart data
  // Build date-keyed lookup from GBB records for actuals
  // ── GBB Nomination fetch ──────────────────────────────────────────────────────
  const handleFetchGBBNom = async () => {
    setGbbNomFetching(true);
    setGbbNomError(null);
    try {
      const rows = await fetchGBBNominations((msg) => console.log('[GBB Nom]', msg));
      setGbbNomData(rows);
      setGbbNomLastFetch(new Date().toISOString());
    } catch (e) {
      setGbbNomError(e.message);
    } finally {
      setGbbNomFetching(false);
    }
  };

  const handleUploadGBBNom = async (file) => {
    setGbbNomFetching(true);
    setGbbNomError(null);
    try {
      const text = await file.text();
      const Papa = (await import('papaparse')).default;
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true, transformHeader: h => h.trim() });
      const rows = parseGBBNominations(parsed.data);
      setGbbNomData(rows);
      setGbbNomLastFetch(new Date().toISOString());
    } catch (e) {
      setGbbNomError(e.message);
    } finally {
      setGbbNomFetching(false);
    }
  };

  // Lookup nominations by date
  const gbbNomByDate = useMemo(() => {
    if (!gbbNomData) return {};
    const m = {};
    for (const r of gbbNomData) m[r.date] = r;
    return m;
  }, [gbbNomData]);

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
      const nom = gbbNomByDate[r.date];
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
        // GBB nomination supply total
        gbb_nom: nom ? nom.gbb_se_total : null,
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
  }, [resolvedForecast, resolvedPoe, gbbByDate, gbbNomByDate]);

  const forecastStart = resolvedForecast.find(r => r.period === 'forecast')?.date;
  const latestDate = resolvedForecast[resolvedForecast.length - 1]?.date;

  // ── Empty / loading state ─────────────────────────────────────────────────────
  if (!resolvedForecast?.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 400, gap: 20, textAlign: 'center' }}>

        {/* Spinner while auto-fetching */}
        {autoFetching ? (
          <>
            <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid #30363d', borderTopColor: '#388bfd', animation: 'spin 0.8s linear infinite' }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <div style={{ fontFamily: 'DM Mono, monospace', color: '#8b949e', fontSize: 12 }}>
              Looking for forecast file in /data/…
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 40 }}>📈</div>
            <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 18, color: 'var(--text)' }}>No forecast data loaded</div>

            {/* Auto-fetch error or success hint */}
            {autoFetchError ? (
              <div style={{ background: '#f8514912', border: '1px solid #f8514944', borderRadius: 6, padding: '8px 16px', fontSize: 11, fontFamily: 'DM Mono, monospace', color: '#f85149', maxWidth: 460 }}>
                ⚠ {autoFetchError}
                <span style={{ color: '#8b949e' }}> — Upload a CSV file below, or copy it to the dashboard public/data/ folder.</span>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: '#8b949e', fontFamily: 'DM Mono, monospace' }}>
                Run the forecast notebook then upload the CSV, or copy it to <code style={{ color: '#e6edf3' }}>public/data/</code>
              </div>
            )}

            {/* File path hint */}
            <div style={{ fontSize: 11, color: '#8b949e', fontFamily: 'DM Mono, monospace' }}>
              Expected: <span style={{ color: '#e6edf3' }}>C:\Users\peter\Python\data\forecasts\gas_forecast_YYYYMMDD.csv</span>
            </div>

            {/* Upload button */}
            <label style={{
              padding: '8px 20px', borderRadius: 6, cursor: 'pointer', fontSize: 13,
              fontFamily: 'Syne, sans-serif', fontWeight: 600,
              border: '1px solid #bc8cff', background: '#bc8cff22', color: '#bc8cff',
            }}>
              ↑ Upload forecast CSV
              <input type="file" accept=".csv" multiple onChange={async e => {
                const files = Array.from(e.target.files || []);
                e.target.value = '';
                for (const file of files) { if (onLoadForecast) await onLoadForecast(file); }
              }} style={{ display: 'none' }} />
            </label>

            {/* Retry auto-fetch */}
            <button onClick={() => setAutoFetchDone(false)} style={{
              padding: '5px 14px', borderRadius: 5, cursor: 'pointer', fontSize: 12,
              fontFamily: 'DM Mono, monospace', border: '1px solid #30363d',
              background: 'transparent', color: '#8b949e',
            }}>↻ Retry auto-fetch</button>
          </>
        )}
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
      // Range band: null if either value missing or zero (undefined floor)
      poe_band: (r[poeLoKey] != null && r[poeHiKey] != null) ? [r[poeLoKey], r[poeHiKey]] : null,
    }));

    return (
      <ChartCard title={title} subtitle={subtitle}>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="label" {...AXIS} interval={9} />
            <YAxis {...AXIS} width={38} domain={yDomain || ['auto','auto']} unit="" tickFormatter={v => v} />
            <Tooltip content={<CustomTooltip unit="TJ/day" />} />
            {/* PoE band using native range area */}
            <Area type="monotone" dataKey="poe_band" stroke="none" fill={color} fillOpacity={0.35} legendType="none" name="__hidden__" />
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

  // ── GBB Nomination comparison chart ──────────────────────────────────────────
  const GBBNomChart = () => {
    const data = chartData.map(r => ({
      label:    r.label,
      date:     r.date,
      forecast: r.pred_total,
      actual:   r.actual_total,
      gbb_nom:  r.gbb_nom,
      poe_lo:   r.poe_total_lo,
      poe_hi:   r.poe_total_hi,
      poe_band: (r.poe_total_lo != null && r.poe_total_hi != null) ? [r.poe_total_lo, r.poe_total_hi] : null,
    }));

    const hasNom = data.some(r => r.gbb_nom != null);

    // Pearson correlation — only backcast rows where both series have actuals
    const pearson = (xs, ys) => {
      const n = xs.length;
      if (n < 3) return null;
      const mx = xs.reduce((a, b) => a + b, 0) / n;
      const my = ys.reduce((a, b) => a + b, 0) / n;
      const num = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
      const den = Math.sqrt(
        xs.reduce((s, x) => s + (x - mx) ** 2, 0) *
        ys.reduce((s, y) => s + (y - my) ** 2, 0)
      );
      return den === 0 ? null : num / den;
    };

    const baccastWithActual = data.filter(r =>
      r.actual != null && r.actual > 0 && r.forecast != null
    );
    const rForecast = pearson(
      baccastWithActual.map(r => r.forecast),
      baccastWithActual.map(r => r.actual)
    );
    const nomPairs = data.filter(r =>
      r.actual != null && r.actual > 0 && r.gbb_nom != null
    );
    const rNom = pearson(
      nomPairs.map(r => r.gbb_nom),
      nomPairs.map(r => r.actual)
    );

    const fmtR = (r) => r != null ? r.toFixed(3) : '—';
    const rColor = (r) => r == null ? C.muted : r > 0.75 ? C.green : r > 0.5 ? C.orange : C.red;

    return (
      <ChartCard
        title="Total SE Demand — Dashboard Forecast vs GBB Nominations"
        subtitle="Dashboard P50 + POE band · GBB supply-side nomination total · GBB actuals (TJ/day)"
      >
        {/* Fetch / upload controls */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
          <button
            onClick={handleFetchGBBNom}
            disabled={gbbNomFetching}
            style={{
              padding: '4px 12px', borderRadius: 5, cursor: gbbNomFetching ? 'not-allowed' : 'pointer',
              fontSize: 11, fontFamily: 'DM Mono, monospace',
              border: `1px solid #e879f9`, background: gbbNomFetching ? C.surface : `#e879f922`,
              color: gbbNomFetching ? C.muted : '#e879f9', opacity: gbbNomFetching ? 0.6 : 1,
            }}
          >
            {gbbNomFetching ? '⟳ Fetching…' : '↓ Fetch latest AEMO nominations'}
          </button>
          <label style={{
            padding: '4px 12px', borderRadius: 5, cursor: 'pointer', fontSize: 11,
            fontFamily: 'DM Mono, monospace', border: `1px solid ${C.border}`,
            background: 'transparent', color: C.muted,
          }}>
            ↑ Upload ZIP / CSV
            <input type="file" accept=".zip,.csv,.CSV" style={{ display: 'none' }}
              onChange={async e => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                if (file.name.toLowerCase().endsWith('.zip')) {
                  setGbbNomFetching(true);
                  setGbbNomError(null);
                  try {
                    const JSZip = (await import('jszip')).default;
                    const Papa  = (await import('papaparse')).default;
                    const buf   = await file.arrayBuffer();
                    const zip   = await JSZip.loadAsync(buf);
                    const csvFiles = Object.keys(zip.files).filter(f => f.toLowerCase().endsWith('.csv'));
                    let allRows = [];
                    for (const fn of csvFiles) {
                      const text   = await zip.files[fn].async('string');
                      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true, transformHeader: h => h.trim() });
                      allRows = allRows.concat(parsed.data);
                    }
                    setGbbNomData(parseGBBNominations(allRows));
                    setGbbNomLastFetch(new Date().toISOString());
                  } catch (err) {
                    setGbbNomError(err.message);
                  } finally {
                    setGbbNomFetching(false);
                  }
                } else {
                  await handleUploadGBBNom(file);
                }
              }}
            />
          </label>
          {gbbNomLastFetch && (
            <span style={{ fontSize: 10, color: C.muted, fontFamily: 'DM Mono, monospace' }}>
              loaded {new Date(gbbNomLastFetch).toLocaleTimeString()} · {gbbNomData?.length ?? 0} days
            </span>
          )}
          {gbbNomError && (
            <span style={{ fontSize: 10, color: C.red, fontFamily: 'DM Mono, monospace', maxWidth: 360 }}>
              ⚠ {gbbNomError}
            </span>
          )}
        </div>

        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="label" {...AXIS} interval={9} />
            <YAxis {...AXIS} width={38} domain={['auto', 'auto']} />
            <Tooltip content={<CustomTooltip unit="TJ/day" />} />
            {/* POE band */}
            <Area type="monotone" dataKey="poe_band" stroke="none" fill={C.blue} fillOpacity={0.2} legendType="none" name="__hidden__" />
            <Line dataKey="poe_lo" stroke={C.blue} strokeWidth={1} strokeDasharray="3 3" dot={false} name="PoE 90" connectNulls />
            <Line dataKey="poe_hi" stroke={C.blue} strokeWidth={1} strokeDasharray="3 3" dot={false} name="PoE 10" connectNulls />
            {/* Dashboard forecast P50 */}
            <Line dataKey="forecast" stroke={C.blue} strokeWidth={2} dot={false} name="Forecast P50" connectNulls />
            {/* GBB nomination line — only rendered when data present */}
            {hasNom && (
              <Line dataKey="gbb_nom" stroke="#e879f9" strokeWidth={1.5} strokeDasharray="6 3"
                dot={false} name="GBB nomination" connectNulls />
            )}
            {/* Actuals */}
            <Line dataKey="actual" stroke={C.actual} strokeWidth={0}
              dot={{ r: 2.5, fill: C.actual }} name="Actual (GBB)" connectNulls />
            {forecastStart && (
              <ReferenceLine x={fmtDate(forecastStart)} stroke={C.dim} strokeDasharray="4 3"
                label={{ value: 'Fcast →', fill: C.muted, fontSize: 10, position: 'insideTopRight' }} />
            )}
          </ComposedChart>
        </ResponsiveContainer>

        <div style={{ display: 'flex', gap: 16, fontSize: 11, color: C.muted, flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 16, height: 8, background: C.blue, opacity: 0.2, display: 'inline-block', borderRadius: 2 }} />
            PoE 10–90
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 16, height: 2, background: C.blue, display: 'inline-block' }} />
            Dashboard P50
          </span>
          {hasNom && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 16, height: 0, borderTop: `2px dashed #e879f9`, display: 'inline-block' }} />
              GBB nomination
            </span>
          )}
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: C.actual, display: 'inline-block' }} />
            Actual (GBB)
          </span>
          {!hasNom && (
            <span style={{ color: C.dim, fontStyle: 'italic' }}>
              ↑ fetch or upload AEMO nominations to add GBB comparison line
            </span>
          )}
        </div>

        {/* Correlation stats strip */}
        <div style={{
          display: 'flex', gap: 0, borderTop: `1px solid ${C.border}`,
          paddingTop: 10, marginTop: 2, flexWrap: 'wrap',
        }}>
          {/* P50 vs Actual */}
          <div style={{ flex: '1 1 200px', paddingRight: 20 }}>
            <div style={{ fontSize: 10, color: C.muted, fontFamily: 'DM Mono, monospace', marginBottom: 3 }}>
              P50 vs Actual ({baccastWithActual.length} days)
            </div>
            <div style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
              <span style={{ fontSize: 10, color: C.muted }}>r =</span>
              <span style={{
                fontFamily: 'DM Mono, monospace', fontSize: 16, fontWeight: 700,
                color: rColor(rForecast),
              }}>{fmtR(rForecast)}</span>
              {rForecast != null && (
                <span style={{ fontSize: 10, color: C.muted }}>
                  r² = {(rForecast ** 2).toFixed(3)}
                </span>
              )}
            </div>
          </div>

          {/* Divider */}
          <div style={{ width: 1, background: C.border, margin: '0 4px', alignSelf: 'stretch', minHeight: 36 }} />

          {/* GBB Nom vs Actual */}
          <div style={{ flex: '1 1 200px', paddingLeft: 20 }}>
            <div style={{ fontSize: 10, color: C.muted, fontFamily: 'DM Mono, monospace', marginBottom: 3 }}>
              {hasNom ? `GBB nomination vs Actual (${nomPairs.length} days)` : 'GBB nomination vs Actual'}
            </div>
            <div style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
              <span style={{ fontSize: 10, color: C.muted }}>r =</span>
              <span style={{
                fontFamily: 'DM Mono, monospace', fontSize: 16, fontWeight: 700,
                color: hasNom ? rColor(rNom) : C.dim,
              }}>{hasNom ? fmtR(rNom) : '—'}</span>
              {hasNom && rNom != null && (
                <span style={{ fontSize: 10, color: C.muted }}>
                  r² = {(rNom ** 2).toFixed(3)}
                </span>
              )}
              {!hasNom && (
                <span style={{ fontSize: 10, color: C.dim, fontStyle: 'italic' }}>
                  load nominations to compute
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Methodology note */}
        <details style={{ marginTop: 6 }}>
          <summary style={{
            fontSize: 11, color: C.muted, fontFamily: 'DM Mono, monospace',
            cursor: 'pointer', userSelect: 'none', listStyle: 'none',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{ fontSize: 10 }}>▶</span>
            How GBB nominated demand is calculated
          </summary>
          <div style={{
            marginTop: 8, padding: '10px 14px',
            background: C.surface2, borderRadius: 6,
            fontSize: 11, color: C.muted, fontFamily: 'DM Mono, monospace',
            lineHeight: 1.8,
          }}>
            <div style={{ color: C.text, marginBottom: 8, fontFamily: 'Syne, sans-serif', fontSize: 12, fontWeight: 700 }}>
              SE nominated demand = SE production + net QLD inflow + SE storage net withdrawal
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 16px' }}>
              <span style={{ color: C.blue }}>SE production</span>
              <span>Sum of <code style={{ color: C.text }}>PROD.Supply</code> for all SE-state facilities — Longford, Otway, Moomba, ATHENA/Orbost, Lang Lang, etc.</span>

              <span style={{ color: C.blue }}>Net QLD inflow</span>
              <span><code style={{ color: C.text }}>SWQP @ Moomba Hub: Supply − TransferOut</code> — positive when QLD gas flows net into SE (winter), negative when SE gas flows to QLD (summer)</span>

              <span style={{ color: C.blue }}>Storage net withdrawal</span>
              <span>Sum of <code style={{ color: C.text }}>STOR.Supply − STOR.Demand</code> for SE storage facilities (Iona UGS, Moomba Storage, Dandenong LNG, NGS) — positive = net withdrawal supplying the market</span>

              <span style={{ color: C.orange }}>VIC (implied)</span>
              <span>Victorian city demand is not reported as a terminal node in GBB nominations — VTS city delivery nodes (Melbourne, Geelong, etc.) show near-zero demand. VIC is inferred as: SE total − NSW − SA − TAS</span>

              <span style={{ color: C.green }}>NSW / SA / TAS</span>
              <span><code style={{ color: C.text }}>PIPE.Demand</code> at terminal city and regional nodes — Sydney, Canberra, Regional–NSW, Adelaide, Regional–SA, Regional–TAS</span>
            </div>
            <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${C.border}`, color: C.dim }}>
              Days where the SE total falls outside 400–1,600 TJ are excluded as incomplete nominations (typically outer days of the 7-day window where Longford or SWQP have not yet submitted).
              The nominated total tracks actual demand closely on day 1 but carries a structural positive bias in summer when storage injection reduces the apparent net withdrawal used in the implied VIC residual.
            </div>
          </div>
        </details>

      </ChartCard>
    );
  };

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

      {/* Update strip */}
      <div style={{
        background: 'rgba(56,139,253,0.06)', border: `1px solid rgba(56,139,253,0.2)`,
        borderRadius: 6, padding: '7px 14px', fontSize: 12, color: C.muted,
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      }}>
        <span style={{ color: C.blue }}>ℹ</span>
        <span>Loaded: <code style={{ fontFamily: 'DM Mono, monospace', color: C.teal }}>gas_forecast_{resolvedDate ?? '…'}.csv</code> — auto-fetched from <code style={{ fontFamily: 'DM Mono, monospace', color: C.teal }}>/data/</code></span>
        <label style={{ marginLeft: 'auto', padding: '3px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 11, fontFamily: 'DM Mono, monospace', border: `1px solid ${C.border}`, background: 'transparent', color: C.muted }}>
          ↑ Upload new CSV
          <input type="file" accept=".csv" multiple onChange={async e => {
            const files = Array.from(e.target.files || []);
            e.target.value = '';
            for (const file of files) { if (onLoadForecast) await onLoadForecast(file); }
          }} style={{ display: 'none' }} />
        </label>
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

      {/* Row 3 — GBB Nomination comparison */}
      <GBBNomChart />

      {/* Row 4 — NEM generation stack */}
      <NEMStackChart chartData={chartData} forecastStart={forecastStart} />

      {/* Row 4 — Hourly dispatch */}
      <HourlyDispatchChart hourlyData={hourlyData} hourlyDay={hourlyDay} setHourlyDay={setHourlyDay} />
    </div>
  );
}
