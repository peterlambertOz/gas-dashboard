/**
 * Integrated East Coast Gas Market Dashboard
 * Merges:
 *   - East Coast Gas Market Dashboard (AEMO actuals — GBB flow & storage)
 *   - Gas Demand Forecaster (ML forecast pipeline — 7-day outlook, scenarios, Monte Carlo)
 *
 * Key integrations:
 *   • Near-Term Forecast tab shows YTD AEMO actuals overlaid on model backcast/forecast
 *   • Scenarios tab shows YTD actuals on scenario charts for tracking vs forecasts
 *   • Unified dark theme, shared colour palette, single data-loading flow
 *   • AEMO fetch (actuals) + CSV/JSON upload (forecast files) both available
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  Legend as RechartLegend, ResponsiveContainer, ReferenceLine,
  ComposedChart, Area, ReferenceArea,
  ScatterChart, Scatter, ZAxis, Cell
} from "recharts";

// ── Shared colour palette (compatible with CSS vars used in AEMO tabs) ──────────
const C = {
  bg:       "#0d1117",
  surface:  "#161b22",
  surface2: "#1c2330",
  border:   "#30363d",
  text:     "#e6edf3",
  muted:    "#8b949e",
  dim:      "#484f58",
  blue:     "#7c9ef8",
  orange:   "#f0883e",
  cyan:     "#39d0d8",
  green:    "#3fb950",
  yellow:   "#d29922",
  purple:   "#bc8cff",
  red:      "#f85149",
  accent:   "#e6a817",
};

// Year colours matching AEMO dashboard
const YEAR_COLORS = {
  2019: "#8b949e", 2020: "#6e7681", 2021: "#79c0ff",
  2022: "#3fb950", 2023: "#ffa657", 2024: "#388bfd", 2025: "#e6a817",
};

// ── Forecast model error constants ────────────────────────────────────────────
const SIGMA_GPG      = 61.4;
const SIGMA_NONPOWER = 103.9;
const SIGMA_TOTAL    = 121.5;
const P10P90_HALF    = Math.round(1.28 * SIGMA_TOTAL);

// ── CSS injection (fonts + global resets) ─────────────────────────────────────
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@400;600;700;800&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,400&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${C.bg}; color: ${C.text}; font-family: 'DM Sans', sans-serif; font-size: 14px; }
  :root {
    --bg: ${C.bg}; --surface: ${C.surface}; --surface2: ${C.surface2};
    --border: ${C.border}; --accent: ${C.accent}; --text: ${C.text};
    --text-muted: ${C.muted}; --text-dim: ${C.dim};
    --col-gpg: #e6a817; --col-res: #388bfd; --col-ind: #3fb950;
  }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: ${C.bg}; }
  ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
  .upload-wrap:hover .upload-tooltip { display: block !important; }
  select option { background: ${C.surface}; }
`;

// ── Date / formatting helpers ─────────────────────────────────────────────────
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function parseDate(dateStr) {
  if (!dateStr) return null;
  const s = (dateStr || "").slice(0, 10);
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function fmtDate(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return "";
  return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
}
function fmtDateFull(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return "";
  return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
}
function fmtDateShort(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return "";
  return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
}
function toNum(v) { return parseFloat(v) || 0; }
function parseCSV(text) {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",").map(h => h.trim().replace(/"/g, ""));
  return lines.slice(1).map(line => {
    const vals = line.split(",").map(v => v.trim().replace(/"/g, ""));
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i]; });
    return obj;
  });
}

// ── Area/band chart keys (hidden from legend) ─────────────────────────────────
const AREA_KEYS = new Set([
  "pred_total_p90","pred_total_p10",
  "pred_gpg_p90","pred_gpg_p10",
  "pred_nonpower_p90","pred_nonpower_p10",
]);
const BAND_LEGEND_HIDE = new Set([
  "pred_total_p90","pred_total_p10",
  "pred_gpg_p90","pred_gpg_p10",
  "pred_nonpower_p90","pred_nonpower_p10",
]);

// ── Shared chart primitives ───────────────────────────────────────────────────
const AXIS_STYLE = {
  tick: { fill: C.muted, fontSize: 10, fontFamily: "DM Mono, monospace" },
  stroke: C.border,
};
const GRID_STYLE = { strokeDasharray: "3 3", stroke: C.border };

function ChartCard({ id, title, subtitle, children, style, onExportPPT, onExportXLSX }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div id={id} style={{
      background: C.surface, border: `1px solid ${hovered ? C.accent : C.border}`,
      borderRadius: 8, padding: "20px 20px 12px", position: "relative",
      transition: "border-color 0.2s", ...style,
    }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {title && (
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 15, color: C.text }}>{title}</div>
          {subtitle && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{subtitle}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

function KpiCard({ label, value, unit, sub, color = C.blue, border }) {
  return (
    <div style={{
      background: C.surface, border: `1px solid ${border || C.border}`,
      borderRadius: 10, padding: "16px 20px", flex: 1,
    }}>
      <div style={{ color: C.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6, fontFamily: "DM Mono, monospace" }}>{label}</div>
      <div style={{ color, fontSize: 28, fontWeight: 700, fontFamily: "DM Mono, monospace" }}>
        {value}<span style={{ fontSize: 14, fontWeight: 400, marginLeft: 4 }}>{unit}</span>
      </div>
      {sub && <div style={{ color: C.muted, fontSize: 11, marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

const SectionTitle = ({ children, color }) => (
  <div style={{ color: color || C.text, fontSize: 13, fontWeight: 600, marginBottom: 10, fontFamily: "Syne, sans-serif" }}>
    {children}
  </div>
);

function DarkTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px", fontSize: 11, fontFamily: "DM Mono, monospace" }}>
      <div style={{ color: C.muted, marginBottom: 4 }}>{payload[0]?.payload?.labelFull || label}</div>
      {payload.filter(p => p.value != null && !AREA_KEYS.has(p.dataKey)).map((p, i) => (
        <div key={i} style={{ color: p.color || C.muted, marginBottom: 2 }}>
          {p.name || p.dataKey}: <strong>{typeof p.value === "number" ? p.value.toFixed(1) : p.value}</strong>
        </div>
      ))}
    </div>
  );
}

function CustomTooltip({ active, payload, label, formatter, labelFormatter }) {
  if (!active || !payload?.length) return null;
  const displayLabel = labelFormatter ? labelFormatter(label) : label;
  return (
    <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px", fontSize: 11 }}>
      {displayLabel && <div style={{ color: C.muted, marginBottom: 4 }}>{displayLabel}</div>}
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || C.text, marginBottom: 2 }}>
          <span style={{ color: C.muted }}>{p.name}: </span>
          <strong>{formatter ? formatter(p.value, p.name) : p.value}</strong>
        </div>
      ))}
    </div>
  );
}

// Filtered legend: hides area/band fill keys
function FilteredLegend({ payload }) {
  const items = (payload || []).filter(p => !BAND_LEGEND_HIDE.has(p.dataKey));
  if (!items.length) return null;
  return (
    <div style={{ display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap", marginTop: 6, fontSize: 10, fontFamily: "DM Mono, monospace" }}>
      {items.map((p, i) => (
        <span key={i} style={{ display: "flex", alignItems: "center", gap: 4, color: C.muted }}>
          <span style={{ width: 16, height: 2, background: p.color, display: "inline-block", borderRadius: 1 }} />
          {p.value}
        </span>
      ))}
    </div>
  );
}

function LegendRow({ items }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginTop: 10, fontSize: 10, fontFamily: "DM Mono, monospace", color: C.muted }}>
      {items.map((item, i) => (
        <span key={i} style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 14, height: 2, background: item.color, borderRadius: 1, display: "inline-block" }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

// ── AEMO tab compatibility constants ─────────────────────────────────────────
const CHART_COLORS = {
  gpg: "#e6a817", residential: "#388bfd", industrial: "#3fb950",
  storage_shallow: "#bc8cff", storage_deep: "#9a6fd8",
  longford: "#ff7b72", moomba: "#ffa657", swqp: "#79c0ff",
  capacity: "#f85149",
};
// Legend component alias (AEMO tabs use <Legend items={...}/>)
function Legend({ items }) { return <LegendRow items={items} />; }

// ── Zoomable time series (from GasDemandDashboard.jsx) ───────────────────────
function ZoomableTimeSeries({ data, lines, height = 230, yWidth = 36, tooltipContent, yDomain }) {
  const [zoom, setZoom]       = useState(null);
  const [zoomStart, setZoomStart] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const stableKey = useRef(0);

  const displayData = zoom
    ? data.slice(zoom.start, zoom.end + 1)
    : data;

  const handleMouseDown = (e) => {
    if (!e?.activeLabel) return;
    const idx = data.findIndex((d, i) => (d.label || String(i)) === e.activeLabel);
    if (idx < 0) return;
    setZoomStart(idx);
    setIsDragging(true);
    setZoom(null);
    stableKey.current++;
  };
  const handleMouseMove = (e) => {
    if (!isDragging || !e?.activeLabel) return;
    const idx = data.findIndex((d, i) => (d.label || String(i)) === e.activeLabel);
    if (idx < 0 || zoomStart === null) return;
    const lo = Math.min(zoomStart, idx), hi = Math.max(zoomStart, idx);
    if (hi - lo >= 3) setZoom({ start: lo, end: hi });
  };
  const handleMouseUp = () => setIsDragging(false);

  const defaultTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    return (
      <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px", fontSize: 11, fontFamily: "DM Mono, monospace" }}>
        <div style={{ color: C.muted, marginBottom: 4 }}>{d?.labelFull || d?.label}</div>
        {payload.filter(p => p.value != null).map((p, i) => (
          <div key={i} style={{ color: p.color || C.muted }}>
            {p.name}: <strong>{p.value?.toFixed ? p.value.toFixed(1) : p.value}</strong>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={{ position: "relative" }}>
      {zoom && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4, fontSize: 10, color: C.muted, fontFamily: "DM Mono, monospace" }}>
          <span>Zoomed: {displayData[0]?.labelFull || displayData[0]?.label} → {displayData[displayData.length-1]?.labelFull || displayData[displayData.length-1]?.label}</span>
          <span onClick={() => setZoom(null)} style={{ cursor: "pointer", color: C.blue }}>✕ Reset</span>
        </div>
      )}
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={displayData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          style={{ userSelect: "none" }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
          <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 9 }} stroke={C.border} interval="preserveStartEnd" />
          <YAxis tick={{ fill: C.muted, fontSize: 9 }} stroke={C.border} width={yWidth} domain={yDomain} />
          <Tooltip content={tooltipContent || defaultTooltip} />
          {lines.map(l => (
            <Line key={l.key} dataKey={l.key} stroke={l.color} strokeWidth={l.width || 1.5}
              strokeDasharray={l.dashed ? "4 2" : undefined}
              dot={false} connectNulls name={l.name || l.key} isAnimationActive={false} />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
      {!zoom && <div style={{ textAlign: "center", fontSize: 9, color: C.dim, marginTop: 2, fontFamily: "DM Mono, monospace" }}>drag to zoom</div>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// ── FORECAST TABS (from GasDemandDashboard.jsx) ──────────────────────────────
// ════════════════════════════════════════════════════════════════════════════════

// ── Near-Term Forecast Tab ────────────────────────────────────────────────────
// Enhanced: overlays YTD AEMO actuals on backcast chart so model can be tracked
function ForecastTab({ allData, poeData, aemoRecords }) {
  const backcast = allData.filter(r => r.period === "backcast");
  const forecast = allData.filter(r => r.period === "forecast");
  const forecastRows = allData.filter(r => r.period === "forecast");
  const backcasts    = allData.filter(r => r.period === "backcast");
  const hasWrongData = allData.length > 0 && forecastRows.length === 0 && backcasts.length === 0;

  // Build AEMO actuals lookup by date (total_demand_se from real GBB records)
  const aemoByDate = useMemo(() => {
    if (!aemoRecords?.length) return {};
    const out = {};
    for (const r of aemoRecords) {
      if (r.date && r.total_demand_se > 0) out[r.date] = r.total_demand_se;
    }
    return out;
  }, [aemoRecords]);

  const hasAemo = Object.keys(aemoByDate).length > 0;

  if (!allData.length || hasWrongData) return (
    <div style={{ textAlign: "center", paddingTop: 80, color: C.muted }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>{allData.length ? "⚠️" : "📁"}</div>
      <div style={{ fontSize: 14, marginBottom: 8, color: allData.length ? C.yellow : C.muted }}>
        {allData.length ? "Wrong file loaded" : "No forecast data loaded"}
      </div>
      <div style={{ fontSize: 12, marginBottom: 4, color: C.text }}>
        Upload <code style={{ background: C.surface2, padding: "1px 6px", borderRadius: 3 }}>gas_forecast_YYYYMMDD.csv</code> via the Upload button above
      </div>
      <div style={{ fontSize: 11, color: C.muted, marginTop: 8 }}>
        ✓ period = "forecast" → 7-day ahead · ✓ period = "backcast" → YTD on actual weather
      </div>
      {hasAemo && (
        <div style={{ marginTop: 12, fontSize: 11, color: C.green }}>
          ✓ {Object.keys(aemoByDate).length.toLocaleString()} AEMO actual days loaded — will overlay on chart once forecast CSV is uploaded
        </div>
      )}
    </div>
  );

  const poeLookup = poeData ? Object.fromEntries(poeData.map(r => [r.date, r])) : {};
  const usingPoe  = poeData && poeData.length > 0;

  // Base chart: last 30 backcast days + 7 forecast days
  const chartData = [...backcast.slice(-30), ...forecast].map(r => {
    const poe = poeLookup[r.date];
    const aemoActual = aemoByDate[r.date];
    return {
      ...r,
      label:    fmtDateShort(r.date),
      labelFull: fmtDate(r.date),
      isForecast: r.period === "forecast",
      aemo_actual: aemoActual || null,            // ← AEMO actual overlay
      pred_total_p10:    r.period==="forecast" ? (poe ? poe.total_p10_tj    : r.pred_total_tj - 1.28*SIGMA_TOTAL)    : undefined,
      pred_total_p90:    r.period==="forecast" ? (poe ? poe.total_p90_tj    : r.pred_total_tj + 1.28*SIGMA_TOTAL)    : undefined,
      pred_gpg_p10:      r.period==="forecast" ? (poe ? poe.gpg_p10_tj      : Math.max(0, r.pred_gpg_tj - 1.28*SIGMA_GPG)) : undefined,
      pred_gpg_p90:      r.period==="forecast" ? (poe ? poe.gpg_p90_tj      : r.pred_gpg_tj + 1.28*SIGMA_GPG)       : undefined,
      pred_nonpower_p10: r.period==="forecast" ? (poe ? poe.nonpower_p10_tj : Math.max(0, r.pred_nonpower_tj - 1.28*SIGMA_NONPOWER)) : undefined,
      pred_nonpower_p90: r.period==="forecast" ? (poe ? poe.nonpower_p90_tj : r.pred_nonpower_tj + 1.28*SIGMA_NONPOWER) : undefined,
    };
  });

  // Extended YTD chart: all backcast rows + AEMO actuals for overlap analysis
  const ytdChartData = useMemo(() => {
    if (!hasAemo || !backcast.length) return [];
    const allDates = new Set([
      ...backcast.map(r => r.date),
      ...Object.keys(aemoByDate),
    ]);
    const sorted = [...allDates].sort();
    return sorted.map(date => ({
      date,
      label: fmtDateShort(date),
      labelFull: fmtDate(date),
      pred_total_tj: backcast.find(r => r.date === date)?.pred_total_tj || null,
      aemo_actual: aemoByDate[date] || null,
    }));
  }, [backcast, aemoByDate, hasAemo]);

  const splitDate = allData.find(r => r.period === "forecast")?.date ?? null;
  const todayIdx  = splitDate ? chartData.findIndex(r => r.date === splitDate) : -1;

  const avgTotal  = forecast.length ? (forecast.reduce((s,r)=>s+r.pred_total_tj,0)/forecast.length).toFixed(0) : "—";
  const avgGpg    = forecast.length ? (forecast.reduce((s,r)=>s+r.pred_gpg_tj,0)/forecast.length).toFixed(0) : "—";
  const avgNonpwr = forecast.length ? (forecast.reduce((s,r)=>s+r.pred_nonpower_tj,0)/forecast.length).toFixed(0) : "—";

  const weatherData = chartData.map(r => ({
    label: r.label, labelFull: r.labelFull,
    HDD: toNum(r.hdd18_se), CDD: toNum(r.cdd24_nem),
  }));

  const nemData = chartData.map(r => ({
    label: r.label, labelFull: r.labelFull,
    Wind:  Math.round(toNum(r.pred_wind_mwh)/1000),
    Solar: Math.round(toNum(r.pred_solar_mwh)/1000),
    Hydro: Math.round(toNum(r.pred_hydro_mwh)/1000),
    Coal:  Math.round(toNum(r.pred_coal_mwh)/1000),
    Gas:   Math.round(toNum(r.pred_gpg_tj) * 277.8 / 1000),
  }));

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ color: C.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: 2, marginBottom: 4 }}>SE AUSTRALIA AGGREGATED</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "Syne, sans-serif" }}>Near-Term Forecast — 30-Day History + Outlook</div>
          <div style={{ background: usingPoe ? "#1a3a1a" : "#1a2a3a", border: `1px solid ${usingPoe ? C.green : C.muted}`, borderRadius: 6, padding: "3px 10px", fontSize: 11, color: usingPoe ? C.green : C.muted }}>
            {usingPoe ? "✓ PoE from file" : "PoE from σ"}
          </div>
          {hasAemo && (
            <div style={{ background: "#1a2a3a", border: `1px solid ${C.blue}`, borderRadius: 6, padding: "3px 10px", fontSize: 11, color: C.blue }}>
              ✓ AEMO actuals overlaid
            </div>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        <KpiCard label="TOTAL P50 (AVG)" value={avgTotal} unit="TJ/d" sub="GPG + Non-Power" color={C.blue} />
        <KpiCard label="GPG P50 (AVG)"   value={avgGpg}   unit="TJ/d" sub="Gas-fired power gen" color={C.orange} />
        <KpiCard label="NON-POWER P50"   value={avgNonpwr} unit="TJ/d" sub="Industrial & residential" color={C.cyan} />
        <KpiCard label="P10–P90 SPREAD"  value={`±${P10P90_HALF}`} unit="TJ/d" sub="Confidence half-width" color={C.yellow} />
      </div>

      {/* Main total chart */}
      <ChartCard style={{ marginBottom: 16 }}>
        <SectionTitle color={C.blue}>Total Gas Demand — Past 30 Days + 7-Day Forecast (TJ/day)</SectionTitle>
        <ResponsiveContainer width="100%" height={230}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="bandFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.yellow} stopOpacity={0.15}/>
                <stop offset="100%" stopColor={C.green} stopOpacity={0.05}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
            <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 10 }} interval={4} stroke={C.border}/>
            <YAxis tick={{ fill: C.muted, fontSize: 10 }} stroke={C.border} width={40}/>
            <Tooltip content={<DarkTooltip/>}/>
            {todayIdx>=0 && <ReferenceLine x={chartData[todayIdx]?.label} stroke={C.muted} strokeDasharray="4 2" label={{ value: "Today", fill: C.muted, fontSize: 10, position: "top" }}/>}
            <Area dataKey="pred_total_p90" stroke="none" fill={C.yellow} fillOpacity={0.08} dot={false} connectNulls name="P90 (PoE10)"/>
            <Area dataKey="pred_total_p10" stroke="none" fill={C.bg}     fillOpacity={1}    dot={false} connectNulls name="P10 (PoE90)"/>
            <Line dataKey="pred_total_p90" stroke={C.yellow} strokeWidth={1} strokeDasharray="4 2" dot={false} connectNulls/>
            <Line dataKey="pred_total_p10" stroke={C.green}  strokeWidth={1} strokeDasharray="4 2" dot={false} connectNulls/>
            <Line dataKey="pred_total_tj"  stroke={C.blue}   strokeWidth={2}
              dot={r => r.payload?.isForecast ? <circle key={r.index} cx={r.cx} cy={r.cy} r={3} fill={C.blue}/> : null}
              name="P50 Model" connectNulls/>
            {hasAemo && <Line dataKey="aemo_actual" stroke={C.green} strokeWidth={2} dot={false} name="AEMO Actual" connectNulls strokeDasharray="none"/>}
            <FilteredLegend/>
          </ComposedChart>
        </ResponsiveContainer>
        {hasAemo && (
          <div style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>
            <span style={{ color: C.green }}>━</span> AEMO Actual (GBB flow)  <span style={{ color: C.blue, marginLeft: 12 }}>━</span> Model P50 (backcast/forecast)  <span style={{ color: C.yellow, marginLeft: 12 }}>╌</span> P90  <span style={{ color: C.green, marginLeft: 8 }}>╌</span> P10
          </div>
        )}
      </ChartCard>

      {/* GPG + Non-power side by side */}
      {(() => {
        const allMax = Math.ceil(Math.max(
          ...chartData.map(r => r.pred_gpg_p90    ?? r.pred_gpg_tj    ?? 0),
          ...chartData.map(r => r.pred_nonpower_p90 ?? r.pred_nonpower_tj ?? 0),
        ) / 50) * 50;
        const domain = [0, allMax || 800];
        return (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <ChartCard>
                <SectionTitle color={C.orange}>⚡ GPG (TJ/day)</SectionTitle>
                <ResponsiveContainer width="100%" height={180}>
                  <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                    <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 9 }} interval={4} stroke={C.border}/>
                    <YAxis tick={{ fill: C.muted, fontSize: 9 }} stroke={C.border} width={36} domain={domain}/>
                    <Tooltip content={<DarkTooltip/>}/>
                    {todayIdx>=0 && <ReferenceLine x={chartData[todayIdx]?.label} stroke={C.muted} strokeDasharray="4 2"/>}
                    <Area dataKey="pred_gpg_p90" stroke="none" fill={C.yellow} fillOpacity={0.08} dot={false} connectNulls legendType="none"/>
                    <Area dataKey="pred_gpg_p10" stroke="none" fill={C.bg}     fillOpacity={1}    dot={false} connectNulls legendType="none"/>
                    <Line dataKey="pred_gpg_p90" stroke={C.yellow} strokeWidth={1} strokeDasharray="4 2" dot={false} connectNulls/>
                    <Line dataKey="pred_gpg_p10" stroke={C.green}  strokeWidth={1} strokeDasharray="4 2" dot={false} connectNulls/>
                    <Line dataKey="pred_gpg_tj"  stroke={C.orange} strokeWidth={1.5}
                      dot={r => r.payload?.isForecast ? <circle key={r.index} cx={r.cx} cy={r.cy} r={3} fill={C.orange}/> : null}
                      name="GPG TJ" connectNulls/>
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartCard>
              <ChartCard>
                <SectionTitle color={C.yellow}>⚡ NEM Generation Stack (GWh/day)</SectionTitle>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={nemData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                    <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 9 }} interval={4} stroke={C.border}/>
                    <YAxis tick={{ fill: C.muted, fontSize: 9 }} stroke={C.border} width={36}/>
                    <Tooltip content={<DarkTooltip/>}/>
                    {todayIdx>=0 && <ReferenceLine x={chartData[todayIdx]?.label} stroke={C.muted} strokeDasharray="4 2"/>}
                    <Bar dataKey="Coal"  stackId="a" fill="#8b7355"/>
                    <Bar dataKey="Hydro" stackId="a" fill={C.blue}/>
                    <Bar dataKey="Wind"  stackId="a" fill={C.cyan}/>
                    <Bar dataKey="Solar" stackId="a" fill={C.yellow}/>
                    <Bar dataKey="Gas"   stackId="a" fill={C.orange}/>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <ChartCard>
                <SectionTitle color={C.cyan}>🏭 Non-Power (TJ/day)</SectionTitle>
                <ResponsiveContainer width="100%" height={180}>
                  <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                    <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 9 }} interval={4} stroke={C.border}/>
                    <YAxis tick={{ fill: C.muted, fontSize: 9 }} stroke={C.border} width={40} domain={domain}/>
                    <Tooltip content={<DarkTooltip/>}/>
                    {todayIdx>=0 && <ReferenceLine x={chartData[todayIdx]?.label} stroke={C.muted} strokeDasharray="4 2"/>}
                    <Area dataKey="pred_nonpower_p90" stroke="none" fill={C.yellow} fillOpacity={0.08} dot={false} connectNulls legendType="none"/>
                    <Area dataKey="pred_nonpower_p10" stroke="none" fill={C.bg}     fillOpacity={1}    dot={false} connectNulls legendType="none"/>
                    <Line dataKey="pred_nonpower_p90" stroke={C.yellow} strokeWidth={1} strokeDasharray="4 2" dot={false} connectNulls/>
                    <Line dataKey="pred_nonpower_p10" stroke={C.green}  strokeWidth={1} strokeDasharray="4 2" dot={false} connectNulls/>
                    <Line dataKey="pred_nonpower_tj"  stroke={C.cyan}   strokeWidth={1.5}
                      dot={r => r.payload?.isForecast ? <circle key={r.index} cx={r.cx} cy={r.cy} r={3} fill={C.cyan}/> : null}
                      name="Non-Power TJ" connectNulls/>
                  </ComposedChart>
                </ResponsiveContainer>
              </ChartCard>
              <ChartCard>
                <SectionTitle color={C.purple}>🌡 Forecast Weather Drivers</SectionTitle>
                {(() => {
                  const wMax = Math.ceil(Math.max(1, ...weatherData.map(r => Math.max(r.HDD, r.CDD))) / 5) * 5;
                  return (
                    <ResponsiveContainer width="100%" height={180}>
                      <ComposedChart data={weatherData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                        <XAxis dataKey="label" tick={{ fill: C.muted, fontSize: 9 }} interval={4} stroke={C.border}/>
                        <YAxis tick={{ fill: C.muted, fontSize: 9 }} stroke={C.border} width={28} domain={[0, wMax]}/>
                        <Tooltip content={<DarkTooltip/>}/>
                        {todayIdx>=0 && <ReferenceLine x={chartData[todayIdx]?.label} stroke={C.muted} strokeDasharray="4 2"/>}
                        <Bar  dataKey="HDD" fill={C.blue}   opacity={0.6} name="HDD18"/>
                        <Line dataKey="CDD" stroke={C.orange} strokeWidth={1.5} dot={{ r: 2.5, fill: C.orange }} name="CDD24"/>
                      </ComposedChart>
                    </ResponsiveContainer>
                  );
                })()}
              </ChartCard>
            </div>
          </div>
        );
      })()}

      {/* YTD Actuals vs Backcast chart — only shown when AEMO data is loaded */}
      {hasAemo && ytdChartData.length > 0 && (
        <ChartCard style={{ marginBottom: 16 }}>
          <SectionTitle color={C.green}>📈 YTD Tracking — AEMO Actuals vs Model Backcast (TJ/day)</SectionTitle>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 8 }}>
            Full year-to-date comparison: how the model backcast tracks against AEMO GBB actual flow data
          </div>
          <ZoomableTimeSeries
            data={ytdChartData}
            height={220}
            yWidth={40}
            lines={[
              { key: "aemo_actual",   color: C.green, width: 1.5, name: "AEMO Actual (GBB)" },
              { key: "pred_total_tj", color: C.blue,  width: 1.2, name: "Model P50 Backcast", dashed: true },
            ]}
          />
          {(() => {
            const overlap = ytdChartData.filter(r => r.aemo_actual && r.pred_total_tj);
            if (!overlap.length) return null;
            const mae  = overlap.reduce((s,r) => s + Math.abs(r.aemo_actual - r.pred_total_tj), 0) / overlap.length;
            const bias = overlap.reduce((s,r) => s + (r.pred_total_tj - r.aemo_actual), 0) / overlap.length;
            return (
              <div style={{ display: "flex", gap: 20, marginTop: 8, fontSize: 11, fontFamily: "DM Mono, monospace" }}>
                <span style={{ color: C.muted }}>Overlap: <strong style={{ color: C.text }}>{overlap.length} days</strong></span>
                <span style={{ color: C.muted }}>MAE: <strong style={{ color: C.yellow }}>{mae.toFixed(1)} TJ/d</strong></span>
                <span style={{ color: C.muted }}>Bias: <strong style={{ color: bias > 0 ? C.orange : C.blue }}>{bias >= 0 ? "+" : ""}{bias.toFixed(1)} TJ/d</strong></span>
              </div>
            );
          })()}
        </ChartCard>
      )}

      {/* 7-day detail table */}
      <ChartCard>
        <SectionTitle color={C.green}>📋 7-Day Forecast Detail</SectionTitle>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "DM Mono, monospace" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              {["Date","Day","GPG TJ","Non-Power TJ","Total TJ","P10 TJ","P90 TJ","HDD","CDD"].map(h => (
                <th key={h} style={{ color: C.muted, padding: "6px 10px", fontWeight: 500, fontSize: 10,
                  textTransform: "uppercase", letterSpacing: 0.5, textAlign: h==="Date"||h==="Day" ? "left" : "right" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {forecast.map((r, i) => {
              const d = parseDate(r.date);
              const aemo = aemoByDate[r.date];
              return (
                <tr key={i} style={{ borderBottom: `1px solid ${C.border}22`, background: i%2===0?"transparent":`${C.surface2}44` }}>
                  <td style={{ padding: "7px 10px", color: C.muted }}>{fmtDate(r.date)}</td>
                  <td style={{ padding: "7px 10px" }}>{d?.toLocaleDateString("en-AU",{weekday:"short"})}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right", color: C.orange }}>{r.pred_gpg_tj.toFixed(1)}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right", color: C.cyan   }}>{r.pred_nonpower_tj.toFixed(1)}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right", color: C.blue, fontWeight: 600 }}>{r.pred_total_tj.toFixed(1)}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right", color: C.green  }}>{(r.pred_total_tj-1.28*SIGMA_TOTAL).toFixed(1)}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right", color: C.yellow }}>{(r.pred_total_tj+1.28*SIGMA_TOTAL).toFixed(1)}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right", color: C.muted  }}>{toNum(r.hdd18_se).toFixed(1)}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right", color: C.muted  }}>{toNum(r.cdd24_nem).toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ChartCard>
    </div>
  );
}

// ── Scenarios Tab (enhanced: shows YTD actuals alongside scenario lines) ──────
const SCEN_COLORS = ["#7c9ef8","#f0883e","#39d0d8","#3fb950","#d29922","#bc8cff","#f87171","#94a3b8"];
const MONTHS_LIST = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function ScenariosTab({ scenarioData, allData, aemoRecords }) {
  const labels = Object.keys(scenarioData || {});
  const [selected, setSelected] = useState([]);
  const [showActuals, setShowActuals] = useState(true);

  useEffect(() => { if (labels.length) setSelected(labels); }, [labels.join(",")]);
  const toggleScen = (lbl) => setSelected(s => s.includes(lbl) ? s.filter(x => x !== lbl) : [...s, lbl]);

  // AEMO actuals by day-of-year for overlay
  const actualsByDoy = useMemo(() => {
    if (!aemoRecords?.length) return {};
    const out = {};
    for (const r of aemoRecords) {
      if (!r.date || !r.total_demand_se) continue;
      const d = new Date(r.date);
      const doy = Math.round((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
      if (!out[doy] || r.date > out[doy].date) out[doy] = { val: r.total_demand_se, date: r.date };
    }
    return out;
  }, [aemoRecords]);
  const hasActuals = Object.keys(actualsByDoy).length > 0;

  if (!labels.length) return (
    <div style={{ textAlign: "center", paddingTop: 80, color: C.muted }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>📂</div>
      <div style={{ fontSize: 14, marginBottom: 8 }}>No scenario files loaded</div>
      <div style={{ fontSize: 12, color: C.text, marginBottom: 4 }}>
        Upload <code style={{ background: C.surface2, padding: "1px 6px", borderRadius: 3 }}>gas_scenario_202x_Base.csv</code>
      </div>
    </div>
  );

  const colorMap = {};
  let ci = 0;
  labels.forEach(lbl => { colorMap[lbl] = SCEN_COLORS[ci++ % SCEN_COLORS.length]; });

  const yearOf = (lbl) => { const m = lbl.match(/20\d\d/); return m ? parseInt(m[0]) : 0; };
  const years = [...new Set(labels.map(yearOf))].sort((a,b) => b-a);
  const orderedLabels = years.flatMap(yr => {
    const ofYear = labels.filter(l => yearOf(l) === yr);
    return [...ofYear.filter(l => l.toLowerCase().includes("base")).sort(), ...ofYear.filter(l => !l.toLowerCase().includes("base")).sort()];
  });
  const allOrdered = [...orderedLabels, ...labels.filter(l => yearOf(l) === 0).sort()];

  const monthlyComparison = MONTHS_LIST.map((mon, m) => {
    const row = { month: mon };
    selected.forEach(lbl => {
      const rows = (scenarioData[lbl] || []).filter(r => parseInt(r.date.split("-")[1]) - 1 === m);
      row[lbl] = rows.length ? Math.max(...rows.map(r => r.pred_total_tj)) : 0;
    });
    return row;
  });

  // DOY-indexed scenario data
  const scenByDoy = {};
  allOrdered.forEach(lbl => {
    scenByDoy[lbl] = {};
    (scenarioData[lbl] || []).forEach(r => {
      const d = new Date(r.date);
      const doy = Math.round((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
      scenByDoy[lbl][doy] = r;
    });
  });

  const doyToLabel = (doy) => {
    const d = new Date(2024, 0, doy);
    return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
  };
  const doyMonthLabel = (doy) => {
    const starts = [1,32,60,91,121,152,182,213,244,274,305,335];
    const names  = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const idx = starts.findLastIndex(s => doy >= s);
    return idx >= 0 && doy === starts[idx] ? names[idx] : "";
  };

  const xData = Array.from({ length: 366 }, (_, i) => ({
    doy: i+1, label: doyMonthLabel(i+1), labelFull: doyToLabel(i+1),
  }));

  const baseScens = allOrdered.filter(l => l.toLowerCase().includes("base"));
  const altScens  = allOrdered.filter(l => !l.toLowerCase().includes("base"));

  const ScenChart = ({ title, color, scens, metricKey, yDomain }) => {
    const activeScens = scens.filter(l => selected.includes(l));
    const data = xData.map(({ doy, label, labelFull }) => {
      const row = { doy, label, labelFull };
      scens.forEach(lbl => {
        if (selected.includes(lbl)) {
          const r = scenByDoy[lbl][doy];
          row[lbl] = r ? (r[metricKey] > 0 ? r[metricKey] : null) : null;
        }
      });
      if (showActuals && hasActuals) row.aemo_2026 = actualsByDoy[doy]?.val || null;
      return row;
    });
    const lines = [
      ...scens.filter(lbl => selected.includes(lbl)).map(lbl => ({ key: lbl, color: colorMap[lbl], name: lbl, width: 1.2 })),
      ...(showActuals && hasActuals ? [{ key: "aemo_2026", color: C.green, name: "2026 Actual (AEMO)", width: 2 }] : []),
    ];
    return (
      <ChartCard>
        <SectionTitle color={color}>{title}</SectionTitle>
        {!activeScens.length
          ? <div style={{ height: 185, display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: 12 }}>No scenarios selected</div>
          : <ZoomableTimeSeries data={data} lines={lines} height={200} yWidth={40} yDomain={yDomain}/>
        }
      </ChartCard>
    );
  };

  const sharedYMax = (metricKey, s1, s2) => {
    const allS = [...s1, ...s2].filter(l => selected.includes(l));
    const max = Math.max(0, ...allS.flatMap(lbl => Object.values(scenByDoy[lbl] || {}).map(r => r[metricKey] || 0)));
    return [0, Math.ceil(max / 50) * 50 || "auto"];
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ color: C.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: 2, marginBottom: 4 }}>SE AUSTRALIA — WEATHER YEAR SCENARIOS</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "Syne, sans-serif" }}>Scenario Analysis</div>
          {hasActuals && (
            <button onClick={() => setShowActuals(s => !s)} style={{
              background: showActuals ? "#1a3a1a" : "transparent",
              border: `1px solid ${showActuals ? C.green : C.border}`,
              borderRadius: 6, padding: "3px 10px", fontSize: 11,
              color: showActuals ? C.green : C.muted, cursor: "pointer",
            }}>
              {showActuals ? "✓ AEMO actuals shown" : "Show AEMO actuals"}
            </button>
          )}
        </div>
        <div style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>
          Full-year demand projections using historic weather years · {labels.length} scenario{labels.length!==1?"s":""} loaded
          {hasActuals && showActuals && <span style={{ color: C.green }}> · 2026 YTD actuals overlaid in green</span>}
        </div>
      </div>

      {/* Scenario KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
        {allOrdered.map(lbl => {
          const rows = scenarioData[lbl] || [];
          const totalTJ = rows.reduce((s,r)=>s+r.pred_total_tj,0);
          const gpgTJ   = rows.reduce((s,r)=>s+r.pred_gpg_tj,0);
          const npTJ    = rows.reduce((s,r)=>s+r.pred_nonpower_tj,0);
          const peak    = rows.reduce((mx,r)=>r.pred_total_tj>mx?r.pred_total_tj:mx,0);
          const active  = selected.includes(lbl);
          return (
            <div key={lbl} onClick={() => toggleScen(lbl)} style={{
              background: C.surface, border: `1px solid ${active ? colorMap[lbl] : C.border}`,
              borderRadius: 10, padding: "12px 16px", cursor: "pointer",
              opacity: active ? 1 : 0.35, filter: active ? "none" : "grayscale(1)",
              transition: "opacity 0.15s, border-color 0.15s",
            }}>
              <div style={{ color: colorMap[lbl], fontSize: 11, fontWeight: 600, marginBottom: 8 }}>{lbl}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px" }}>
                {[["Annual Total", (totalTJ/1000).toFixed(1)+" PJ", C.blue],
                  ["GPG", (gpgTJ/1000).toFixed(1)+" PJ", C.orange],
                  ["Non-Power", (npTJ/1000).toFixed(1)+" PJ", C.cyan],
                  ["Peak Day", peak.toFixed(0)+" TJ", C.yellow]].map(([label, val, col]) => (
                  <div key={label}>
                    <div style={{ color: C.muted, fontSize: 9, textTransform: "uppercase" }}>{label}</div>
                    <div style={{ color: col, fontSize: 16, fontWeight: 700, fontFamily: "DM Mono, monospace" }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* 6 scenario charts */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        {(() => { const d = sharedYMax("pred_total_tj",    baseScens, altScens); return (<>
        <ScenChart title="📊 Total Demand — Base (TJ/day)"      color={C.blue}   scens={baseScens} metricKey="pred_total_tj"    yDomain={d}/>
        <ScenChart title="📊 Total Demand — Alt (TJ/day)"       color={C.blue}   scens={altScens}  metricKey="pred_total_tj"    yDomain={d}/>
        </>); })()}
        {(() => { const d = sharedYMax("pred_gpg_tj",      baseScens, altScens); return (<>
        <ScenChart title="⚡ GPG Demand — Base (TJ/day)"        color={C.orange} scens={baseScens} metricKey="pred_gpg_tj"      yDomain={d}/>
        <ScenChart title="⚡ GPG Demand — Alt (TJ/day)"         color={C.orange} scens={altScens}  metricKey="pred_gpg_tj"      yDomain={d}/>
        </>); })()}
        {(() => { const d = sharedYMax("pred_nonpower_tj", baseScens, altScens); return (<>
        <ScenChart title="🏭 Non-Power Demand — Base (TJ/day)"  color={C.cyan}   scens={baseScens} metricKey="pred_nonpower_tj" yDomain={d}/>
        <ScenChart title="🏭 Non-Power Demand — Alt (TJ/day)"   color={C.cyan}   scens={altScens}  metricKey="pred_nonpower_tj" yDomain={d}/>
        </>); })()}
      </div>

      {/* Monthly peak comparison */}
      <ChartCard style={{ marginBottom: 16 }}>
        <SectionTitle color={C.green}>📅 Monthly Peak Day Total Demand — Scenario Comparison (TJ/day)</SectionTitle>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={monthlyComparison} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
            <XAxis dataKey="month" tick={{ fill: C.muted, fontSize: 10 }} stroke={C.border}/>
            <YAxis tick={{ fill: C.muted, fontSize: 10 }} stroke={C.border} width={40}/>
            <Tooltip content={<DarkTooltip/>}/>
            <RechartLegend formatter={v=><span style={{ color: C.muted, fontSize: 10 }}>{v}</span>}/>
            {selected.map(lbl => <Bar key={lbl} dataKey={lbl} fill={colorMap[lbl]} name={lbl} opacity={0.85}/>)}
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Summary table */}
      <ChartCard>
        <SectionTitle color={C.green}>📋 Annual Summary — All Scenarios</SectionTitle>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "DM Mono, monospace" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              {["Scenario","Annual Total PJ","Annual GPG PJ","Annual Non-Power PJ","Peak Day TJ/d","Avg Total TJ/d"].map(h => (
                <th key={h} style={{ color: C.muted, padding: "6px 10px", fontWeight: 500, fontSize: 10,
                  textTransform: "uppercase", letterSpacing: 0.5, textAlign: h==="Scenario" ? "left" : "right" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allOrdered.map((lbl, i) => {
              const rows = scenarioData[lbl] || [];
              const totalTJ = rows.reduce((s,r)=>s+r.pred_total_tj,0);
              const gpgTJ   = rows.reduce((s,r)=>s+r.pred_gpg_tj,0);
              const npTJ    = rows.reduce((s,r)=>s+r.pred_nonpower_tj,0);
              const peak    = rows.reduce((mx,r)=>r.pred_total_tj>mx?r.pred_total_tj:mx,0);
              const avg     = rows.length ? totalTJ/rows.length : 0;
              const isSel   = selected.includes(lbl);
              return (
                <tr key={lbl} onClick={() => toggleScen(lbl)} style={{
                  borderBottom: `1px solid ${C.border}22`, background: isSel ? `${colorMap[lbl]}11` : "transparent", cursor: "pointer",
                }}>
                  <td style={{ padding: "7px 10px", display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: isSel ? colorMap[lbl] : C.border, flexShrink: 0 }}/>
                    <span style={{ color: isSel ? colorMap[lbl] : C.muted, fontWeight: 600 }}>{lbl}</span>
                  </td>
                  <td style={{ padding: "7px 10px", textAlign: "right", color: C.blue,   fontWeight: 600 }}>{(totalTJ/1000).toFixed(2)}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right", color: C.orange  }}>{(gpgTJ/1000).toFixed(2)}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right", color: C.cyan    }}>{(npTJ/1000).toFixed(2)}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right", color: C.yellow  }}>{peak.toFixed(1)}</td>
                  <td style={{ padding: "7px 10px", textAlign: "right", color: C.muted   }}>{avg.toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ChartCard>
    </div>
  );
}
function GPGModelTab({ crossData, modelSummary }) {
  const ms = modelSummary;

  const EMPTY_300 = Array.from({length:300}, () => ({ date:"", rawDate:"", actual:0, model:0 }));
  const demoCross = {
    wind: EMPTY_300, solar: EMPTY_300, coal: EMPTY_300,
    residual: EMPTY_300, hydro: EMPTY_300, gpg: EMPTY_300,
  };

  const cross = crossData || demoCross;

  // ── GPG historical fit — use real data if available, else zeros ──────────────
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const gpgHistory = (() => {
    if (crossData) {
      return crossData.gpg.map((r, i) => {
        // Show label on the 1st of every 3rd month (Jan, Apr, Jul, Oct)
        const d = r.rawDate ? new Date(r.rawDate) : null;
        const isQtrStart = d && d.getDate() <= 3 && d.getMonth() % 3 === 0;
        return {
          label:     isQtrStart ? `${MON[d.getMonth()]} ${d.getFullYear()}` : "",
          labelFull: fmtDateFull(r.rawDate),
          actual: isFinite(r.actual) && r.actual > 0 ? r.actual : null,
          model:  isFinite(r.model)  && r.model  > 0 ? r.model  : null,
        };
      });
    }
    // Demo fallback — all zeros until CSV is uploaded
    return Array.from({length:365}, (_, i) => ({
      label: "", labelFull: "", actual: 0, model: 0,
    }));
  })();

  // ── Pipeline stages ──────────────────────────────────────────────────────────
  const pipeline = [
    { icon:"🌤", label:"Weather",    sub:"Temp · Wind · Solar",         active:false },
    { icon:"📈", label:"NEM Demand", sub:"LightGBM: seasonal+DoW+HDD",  active:true  },
    { icon:"💨", label:"Wind Gen",   sub:"LightGBM: wind speed/dir",    active:true  },
    { icon:"☀️", label:"Solar Gen",  sub:"LightGBM: radiation+season",  active:true  },
    { icon:"⚫", label:"Coal Gen",   sub:"LightGBM: seasonal profile",  active:true  },
    { icon:"Σ",  label:"Residual",   sub:"NEM − Wind − Solar − Coal",   active:false },
    { icon:"💧", label:"Hydro Gen",  sub:"LightGBM: on residual",       active:true  },
    { icon:"🔥", label:"GPG NEM",    sub:"LightGBM: residual−hydro",    active:true  },
    { icon:"🌏", label:"SE Share",   sub:"37% efficiency conversion",   active:false },
  ];

  // ── Selected point state (shared across all crossplots) ─────────────────────
  const [selectedIdx, setSelectedIdx] = useState(null);

  // ── Colour by age — darker = older, lighter = newer ──────────────────────────
  // All crossplots use the same blue base so clicks line up visually
  const getColor = (index, total) => {
    if (total === 0) return "#58a6ff";
    const t = index / (total - 1);          // 0 = oldest, 1 = newest
    // Interpolate: dark navy (#0d2a4a) → bright blue (#58a6ff)
    const r = Math.round(13  + t * (88  - 13));
    const g = Math.round(42  + t * (166 - 42));
    const b = Math.round(74  + t * (255 - 74));
    return `rgb(${r},${g},${b})`;
  };

  // ── Reusable crossplot with age colouring + cross-highlight ──────────────────
  const CrossPlot = ({ data, title, unit="", r2, mape }) => {
    const n      = data.length;
    const [hoveredIdx, setHoveredIdx] = useState(null);

    // Convert MWh → GWh for display if unit is MWh
    const isMWh  = unit === "MWh";
    const dispUnit   = isMWh ? "GWh" : unit;
    const toDisp = (v) => isMWh ? v / 1000 : v;

    const maxVal = Math.max(1, ...data.map(d => Math.max(toDisp(d.actual || 0), toDisp(d.model || 0))));
    const diag   = [{ actual:0, model:0 }, { actual:maxVal, model:maxVal }];

    // Attach per-point colour, index, and converted display values
    const coloured = data.map((d, i) => ({
      ...d,
      actual: toDisp(d.actual),
      model:  toDisp(d.model),
      _i: i, _col: getColor(i, n),
      _actualRaw: d.actual,
      _modelRaw:  d.model,
    }));

    // Status bar: prefer hovered point, fall back to pinned selection
    const displayIdx  = hoveredIdx !== null ? hoveredIdx : selectedIdx;
    const isHoverMode = hoveredIdx !== null;
    const sel     = displayIdx !== null ? data[displayIdx]     : null;
    const selDisp = displayIdx !== null ? coloured[displayIdx] : null;

    return (
      <ChartCard>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
          <div style={{ color:C.blue, fontSize:13, fontWeight:600 }}>{title}</div>
          <div style={{ display:"flex", gap:10, flexShrink:0 }}>
            {r2   !== undefined && <span style={{ fontSize:11, color:C.green,  fontFamily:"monospace", fontWeight:600 }}>R² {(r2*100).toFixed(1)}%</span>}
            {mape !== undefined && <span style={{ fontSize:11, color:C.yellow, fontFamily:"monospace", fontWeight:600 }}>MAPE {mape.toFixed(1)}%</span>}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <ScatterChart margin={{ top:4, right:8, bottom:24, left:0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
            <XAxis type="number" dataKey="actual" domain={[0,"auto"]} name={`Actual ${dispUnit}`}
              tick={{ fill:C.muted, fontSize:9 }} stroke={C.border}
              tickFormatter={v => v.toFixed(1)}
              label={{ value:`Actual ${dispUnit}`, fill:C.muted, fontSize:9, position:"insideBottom", offset:-12 }}/>
            <YAxis type="number" dataKey="model" domain={[0,"auto"]} name={`Model ${dispUnit}`}
              tick={{ fill:C.muted, fontSize:9 }} stroke={C.border} width={42}
              tickFormatter={v => v.toFixed(1)}
              label={{ value:`Model ${dispUnit}`, fill:C.muted, fontSize:9, angle:-90, position:"insideLeft", offset:10 }}/>
            <ZAxis range={[24, 24]}/>
            <Tooltip cursor={{ strokeDasharray:"3 3" }} content={({ active, payload }) => {
              if (!active || !payload?.length) {
                setHoveredIdx(null);
                return null;
              }
              const d = payload[0]?.payload;
              if (!d) { setHoveredIdx(null); return null; }
              setHoveredIdx(d._i);
              return (
                <div style={{ background:C.surface2, border:`1px solid ${C.border}`, borderRadius:6, padding:"8px 12px", fontSize:11 }}>
                  <div style={{ color:C.muted, marginBottom:4 }}>{d.date}</div>
                  <div style={{ color:C.muted }}>Actual: <strong style={{ color:C.text }}>{d.actual?.toFixed(1)} {dispUnit}</strong></div>
                  <div style={{ color:"#58a6ff" }}>Model: <strong>{d.model?.toFixed(1)} {dispUnit}</strong></div>
                  <div style={{ color:C.muted, fontSize:10, marginTop:3 }}>Click to pin · pinned point shown below</div>
                </div>
              );
            }}/>
            {/* 1:1 diagonal — rendered as a Scatter with just 2 points */}
            <Scatter data={diag} dataKey="model" fill={C.muted} line={{ stroke:C.muted, strokeWidth:1, strokeDasharray:"4 3" }}
              shape={() => null} legendType="none" isAnimationActive={false}/>
            {/* Coloured scatter dots */}
            <Scatter data={coloured} dataKey="model" legendType="none" isAnimationActive={false}
              shape={(props) => {
                const { cx, cy, payload } = props;
                if (cx == null || cy == null) return null;
                const isSelected = selectedIdx === payload._i;
                const isHovered  = hoveredIdx  === payload._i;
                return (
                  <circle
                    key={payload._i}
                    cx={cx} cy={cy}
                    r={isSelected ? 6 : isHovered ? 5 : 3}
                    fill={payload._col}
                    fillOpacity={isSelected || isHovered ? 1 : 0.75}
                    stroke={isSelected ? "#ffffff" : isHovered ? "#ffffff88" : "none"}
                    strokeWidth={isSelected ? 1.5 : isHovered ? 1 : 0}
                    style={{ cursor:"pointer" }}
                    onClick={() => setSelectedIdx(selectedIdx === payload._i ? null : payload._i)}
                  />
                );
              }}/>
          </ScatterChart>
        </ResponsiveContainer>
        {/* Status bar — always rendered at fixed height to prevent layout reflow loop */}
        <div style={{ fontSize:10, color:C.muted, marginTop:4, paddingLeft:4,
          display:"flex", gap:16, alignItems:"center", minHeight:18 }}>
          {selDisp && sel && (<>
            <span style={{ color: isHoverMode ? C.muted : getColor(displayIdx, n), fontStyle: isHoverMode ? "italic" : "normal" }}>
              {isHoverMode ? "↖" : "📌"} {sel.date}
            </span>
            <span>Actual: <strong style={{ color:C.text }}>{selDisp.actual?.toFixed(1)} {dispUnit}</strong></span>
            <span>Model: <strong style={{ color:C.text }}>{selDisp.model?.toFixed(1)} {dispUnit}</strong></span>
            <span>Error: <strong style={{ color: Math.abs(sel.actual-sel.model) / (sel.actual||1) > 0.2 ? C.red : C.green }}>
              {((sel.model - sel.actual) / (sel.actual||1) * 100).toFixed(1)}%
            </strong></span>
            {!isHoverMode && selectedIdx !== null && (
              <span style={{ color:C.muted, cursor:"pointer", marginLeft:"auto" }}
                onClick={() => setSelectedIdx(null)}>✕ unpin</span>
            )}
          </>)}
        </div>
      </ChartCard>
    );
  };

  return (
    <div>
      {/* ── Title ── */}
      <div style={{ marginBottom:24 }}>
        <div style={{ color:C.muted, fontSize:10, textTransform:"uppercase", letterSpacing:2, marginBottom:4 }}>
          GAS-FIRED POWER GENERATION
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          <div style={{ fontSize:22, fontWeight:700 }}>GPG Demand Model — Multi-Stage Pipeline</div>
          <div style={{ background:"#1a2a3a", border:`1px solid ${C.blue}`,
            borderRadius:6, padding:"3px 10px", fontSize:11, color:C.blue, fontWeight:600 }}>ML READY</div>
        </div>
      </div>

      {/* ── Pipeline architecture ── */}
      <ChartCard style={{ marginBottom:16 }}>
        <div style={{ color:C.text, fontSize:13, fontWeight:600, marginBottom:16 }}>Pipeline Architecture</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(9,1fr)", gap:6, marginBottom:16 }}>
          {pipeline.map((s, i) => (
            <div key={i} style={{
              background: s.active ? "#1a2235" : C.surface2,
              border: `1px solid ${s.active ? C.blue : C.border}`,
              borderRadius:8, padding:"10px 6px", textAlign:"center", position:"relative",
            }}>
              {i < pipeline.length-1 && (
                <div style={{ position:"absolute", right:-8, top:"50%", transform:"translateY(-50%)",
                  color:C.border, fontSize:13, zIndex:1 }}>›</div>
              )}
              <div style={{ fontSize:16, marginBottom:5 }}>{s.icon}</div>
              <div style={{ fontSize:10, fontWeight:600, color:s.active?C.blue:C.text, marginBottom:2 }}>{s.label}</div>
              <div style={{ fontSize:8, color:C.muted, lineHeight:1.3 }}>{s.sub}</div>
            </div>
          ))}
        </div>
        <div style={{ background:C.bg, border:`1px solid ${C.border}`, borderLeft:`3px solid ${C.blue}`,
          borderRadius:4, padding:"8px 14px", fontSize:11, color:C.muted }}>
          <span style={{ color:C.blue, fontWeight:600 }}>ML Seam: </span>
          Train in Python (LightGBM/scikit-learn) → export as JSON → load into{" "}
          <span style={{ color:C.orange, fontFamily:"monospace" }}>MODEL_PARAMS.gpg</span>
        </div>
      </ChartCard>

      {/* ── GPG actual vs model time series ── */}
      <ChartCard style={{ marginBottom:16 }}>
        <SectionTitle color={C.orange}>
          GPG: Actual vs Model — Historical Fit (TJ/day)
          {crossData && <span style={{ color:C.muted, fontSize:10, fontWeight:400, marginLeft:8 }}>
            {crossData.gpg[0]?.date} → {crossData.gpg[crossData.gpg.length-1]?.date}
          </span>}
        </SectionTitle>
        <ZoomableTimeSeries
          data={gpgHistory}
          height={230}
          yWidth={36}
          lines={[
            { key:"actual", color:C.orange, width:1.2, name:"Actual GPG" },
            { key:"model",  color:C.blue,   width:1,   name:"Model GPG", dashed:true },
          ]}
        />
      </ChartCard>

      {/* ── GPG residuals ── */}
      <ChartCard style={{ marginBottom:16 }}>
        <SectionTitle color={C.purple}>
          GPG: Model Residuals — Actual minus Model (TJ/day)
          {crossData && <span style={{ color:C.muted, fontSize:10, fontWeight:400, marginLeft:8 }}>
            positive = model under-predicts · negative = model over-predicts
          </span>}
        </SectionTitle>
        {(() => {
          const residSigma = (() => {
            const vals = gpgHistory.map(r => (r.actual??0)-(r.model??0)).filter(v => isFinite(v));
            if (!vals.length) return 50;
            const mean = vals.reduce((s,v)=>s+v,0)/vals.length;
            return Math.sqrt(vals.reduce((s,v)=>s+(v-mean)**2,0)/vals.length);
          })();
          const residData = gpgHistory.map(r => ({
            ...r,
            resid: r.actual != null && r.model != null ? r.actual - r.model : null,
          }));
          return (
            <ZoomableTimeSeries
              data={residData}
              height={180}
              yWidth={40}
              lines={[{ key:"resid", color:C.purple, width:1, name:"Residual (TJ)" }]}
              tooltipContent={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const d = payload[0]?.payload;
                const v = d?.resid;
                return (
                  <div style={{ background:C.surface2, border:`1px solid ${C.border}`, borderRadius:6, padding:"8px 12px", fontSize:11 }}>
                    <div style={{ color:C.muted, marginBottom:4 }}>{d?.labelFull}</div>
                    <div style={{ color: v >= 0 ? C.green : C.red }}>
                      Residual: <strong>{v?.toFixed(1)} TJ</strong>
                    </div>
                    <div style={{ color:C.muted, fontSize:10 }}>Actual {d?.actual?.toFixed(1)} · Model {d?.model?.toFixed(1)}</div>
                  </div>
                );
              }}
            />
          );
        })()}
      </ChartCard>

      {/* ── Crossplots ── */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
        <SectionTitle color={C.muted}>Sub-Model Crossplots — Actual vs Predicted</SectionTitle>
        <div style={{ display:"flex", alignItems:"center", gap:16 }}>
          {/* Age gradient legend */}
          {(() => {
            const dates = cross.gpg.map(d => d.rawDate || d.date).filter(Boolean);
            const startYear = dates.length ? new Date(dates[0]).getFullYear() : "Older";
            const endYear   = dates.length ? new Date(dates[dates.length-1]).getFullYear() : "Newer";
            return (
              <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:10, color:C.muted }}>
                <span>{startYear}</span>
                <div style={{ width:80, height:8, borderRadius:4,
                  background:"linear-gradient(to right, rgb(13,42,74), rgb(88,166,255))" }}/>
                <span>{endYear}</span>
              </div>
            );
          })()}
          {/* Clear selection */}
          {selectedIdx !== null && (
            <div onClick={() => setSelectedIdx(null)} style={{
              background:"transparent", border:`1px solid ${C.border}`, borderRadius:6,
              padding:"3px 10px", cursor:"pointer", fontSize:11, color:C.muted,
              display:"flex", alignItems:"center", gap:4,
            }}>✕ Clear selection</div>
          )}
          {!crossData && (
            <span style={{ color:C.muted, fontSize:11, fontStyle:"italic" }}>
              upload gpg_crossplot_diagnostics.csv via header
            </span>
          )}
          {crossData && <span style={{ color:C.green, fontSize:11 }}>✓ {crossData.coal.length} training days loaded</span>}
        </div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:16 }}>
        {/* Row 1 */}
        <CrossPlot data={cross.wind}     title="💨 Wind Generation — Actual vs Model"   unit="MWh" r2={ms?.models?.wind?.r2}  mape={ms?.models?.wind?.mape}/>
        <CrossPlot data={cross.solar}    title="☀️ Solar Generation — Actual vs Model"  unit="MWh" r2={ms?.models?.solar?.r2} mape={ms?.models?.solar?.mape}/>
        {/* Row 2 */}
        <CrossPlot data={cross.coal}     title="⚫ Coal Generation — Actual vs Model"   unit="MWh" r2={ms?.models?.coal?.r2}  mape={ms?.models?.coal?.mape}/>
        <CrossPlot data={cross.residual} title="Σ Residual Demand — Actual vs Model"    unit="MWh"/>
        {/* Row 3 */}
        <CrossPlot data={cross.hydro}    title="💧 Hydro Generation — Actual vs Model"  unit="MWh" r2={ms?.models?.hydro?.r2} mape={ms?.models?.hydro?.mape}/>
        <CrossPlot data={cross.gpg}      title="🔥 GPG Dispatch — Actual vs Model"      unit="TJ"  r2={ms?.models?.gpg?.r2}  mape={ms?.models?.gpg?.mape}/>
      </div>
    </div>
  );
}

// ── NON-POWER MODEL TAB ────────────────────────────────────────────────────────
function NonPowerModelTab({ npData, modelSummary }) {
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  // ── Build history from real data or zeros ────────────────────────────────────
  const historyData = (() => {
    if (npData) {
      return npData.map((r, i) => {
        const d = r.rawDate ? new Date(r.rawDate) : null;
        const isQtrStart = d && d.getDate() <= 3 && d.getMonth() % 3 === 0;
        return {
          label:     isQtrStart ? `${MON[d.getMonth()]} ${d.getFullYear()}` : "",
          labelFull: r.date,
          actual:    r.actual_tj,
          model:     r.pred_tj,
          resid:     r.residual_tj,
          isTrain:   r.is_train,
        };
      });
    }
    return Array.from({length:365}, () => ({ label:"", labelFull:"", actual:0, model:0, resid:0, isTrain:1 }));
  })();

  // ── Metrics ──────────────────────────────────────────────────────────────────
  const n          = historyData.length;
  const residSigma = n ? Math.sqrt(historyData.reduce((s,r) => s + r.resid**2, 0) / n) : 0;
  const residMean  = n ? historyData.reduce((s,r) => s + r.resid, 0) / n : 0;
  const actMean    = n ? historyData.reduce((s,r) => s + r.actual, 0) / n : 1;
  const ssTot      = historyData.reduce((s,r) => s + (r.actual - actMean)**2, 0);
  const ssRes      = historyData.reduce((s,r) => s + (r.actual - r.model)**2, 0);
  const r2         = ssTot ? 1 - ssRes/ssTot : 0;
  const mape       = n ? historyData.reduce((s,r) => s + Math.abs(r.actual ? (r.actual-r.model)/r.actual : 0), 0) / n * 100 : 0;

  // Prefer model_summary values if available, fall back to computed
  const ms = modelSummary;
  const dispR2   = ms?.models?.nonpower?.r2   ?? r2;
  const dispMape = ms?.models?.nonpower?.mape ?? mape;

  // ── Crossplot ────────────────────────────────────────────────────────────────
  const crossPts = historyData.map(r => ({ actual: r.actual, model: r.model, label: r.labelFull }));
  const maxVal   = Math.max(1, ...crossPts.map(d => Math.max(d.actual, d.model)));
  const diag     = [{actual:0,model:0},{actual:maxVal,model:maxVal}];

  const dataLabel = npData
    ? `${historyData[0]?.labelFull} → ${historyData[historyData.length-1]?.labelFull}`
    : "upload nonpower_model_diagnostics.csv via header";

  return (
    <div>
      {/* ── Title ── */}
      <div style={{ marginBottom:24 }}>
        <div style={{ color:C.muted, fontSize:10, textTransform:"uppercase", letterSpacing:2, marginBottom:4 }}>
          NON-POWER GAS DEMAND
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          <div style={{ fontSize:22, fontWeight:700 }}>Non-Power Demand Model</div>
          <div style={{ background:"#1a3a2a", border:`1px solid ${C.cyan}`,
            borderRadius:6, padding:"3px 10px", fontSize:11, color:C.cyan, fontWeight:600 }}>OLS</div>
          {!npData && <span style={{ color:C.muted, fontSize:11, fontStyle:"italic" }}>no data — {dataLabel}</span>}
        </div>
      </div>

      {/* ── Actual vs model time series ── */}
      <ChartCard style={{ marginBottom:16 }}>
        <SectionTitle color={C.cyan}>
          Non-Power: Actual vs Model — Historical Fit (TJ/day)
          <span style={{ color:C.muted, fontSize:10, fontWeight:400, marginLeft:8 }}>{dataLabel}</span>
        </SectionTitle>
        <ZoomableTimeSeries
          data={historyData}
          height={230}
          yWidth={40}
          lines={[
            { key:"actual", color:C.cyan, width:1.2, name:"Actual Non-Power" },
            { key:"model",  color:C.blue, width:1,   name:"Model Non-Power", dashed:true },
          ]}
        />
      </ChartCard>

      {/* ── Crossplot + Residuals ── */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>

        {/* Actual vs predicted crossplot */}
        <ChartCard>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
            <div style={{ color:C.cyan, fontSize:13, fontWeight:600 }}>Actual vs Predicted (TJ/day)</div>
            <div style={{ display:"flex", gap:10 }}>
              <span style={{ fontSize:11, color:C.green,  fontFamily:"monospace", fontWeight:600 }}>R² {(dispR2*100).toFixed(1)}%</span>
              <span style={{ fontSize:11, color:C.yellow, fontFamily:"monospace", fontWeight:600 }}>MAPE {dispMape.toFixed(1)}%</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <ScatterChart margin={{ top:4, right:8, bottom:24, left:0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
              <XAxis type="number" dataKey="actual" domain={[0,"auto"]} name="Actual TJ/day"
                tick={{ fill:C.muted, fontSize:9 }} stroke={C.border}
                label={{ value:"Actual TJ/day", fill:C.muted, fontSize:9, position:"insideBottom", offset:-12 }}/>
              <YAxis type="number" dataKey="model" domain={[0,"auto"]} name="Model TJ/day"
                tick={{ fill:C.muted, fontSize:9 }} stroke={C.border} width={40}
                label={{ value:"Model TJ/day", fill:C.muted, fontSize:9, angle:-90, position:"insideLeft", offset:10 }}/>
              <ZAxis range={[24, 24]}/>
              <Tooltip content={({ active, payload }) => {
                if (!active||!payload?.length) return null;
                const d = payload[0]?.payload;
                return (
                  <div style={{ background:C.surface2, border:`1px solid ${C.border}`, borderRadius:6, padding:"8px 12px", fontSize:11 }}>
                    <div style={{ color:C.muted, marginBottom:3 }}>{d?.label}</div>
                    <div style={{ color:C.muted }}>Actual: <strong style={{ color:C.text }}>{d?.actual?.toFixed(1)}</strong></div>
                    <div style={{ color:C.cyan  }}>Model:  <strong>{d?.model?.toFixed(1)}</strong></div>
                  </div>
                );
              }}/>
              <Scatter data={diag}     fill={C.muted} line={{ stroke:C.muted, strokeWidth:1, strokeDasharray:"4 3" }} shape={() => null} legendType="none" isAnimationActive={false}/>
              <Scatter data={crossPts} legendType="none" isAnimationActive={false}
                shape={(props) => {
                  const { cx, cy } = props;
                  if (cx == null || cy == null) return null;
                  return <circle cx={cx} cy={cy} r={3} fill={C.cyan} fillOpacity={0.55}/>;
                }}/>
            </ScatterChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Residuals over time */}
        <ChartCard>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
            <div style={{ color:C.purple, fontSize:13, fontWeight:600 }}>Residuals Over Time (Actual − Model, TJ/day)</div>
            <div style={{ display:"flex", gap:10 }}>
              <span style={{ fontSize:11, color:C.muted,  fontFamily:"monospace", fontWeight:600 }}>σ {residSigma.toFixed(1)} TJ</span>
              <span style={{ fontSize:11, color: Math.abs(residMean) < 5 ? C.green : C.yellow, fontFamily:"monospace", fontWeight:600 }}>
                Bias {residMean >= 0 ? "+" : ""}{residMean.toFixed(1)} TJ
              </span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={historyData} margin={{ top:4, right:8, bottom:0, left:8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
              <XAxis dataKey="label" tick={{ fill:C.muted, fontSize:9 }} stroke={C.border} interval={0}/>
              <YAxis tick={{ fill:C.muted, fontSize:10 }} stroke={C.border} width={40}/>
              <Tooltip content={({ active, payload }) => {
                if (!active||!payload?.length) return null;
                const d = payload[0]?.payload;
                return (
                  <div style={{ background:C.surface2, border:`1px solid ${C.border}`, borderRadius:6, padding:"8px 12px", fontSize:11 }}>
                    <div style={{ color:C.muted, marginBottom:3 }}>{d?.labelFull}</div>
                    <div style={{ color: d?.resid >= 0 ? C.green : C.red }}>
                      Residual: <strong>{d?.resid?.toFixed(1)} TJ</strong>
                    </div>
                    <div style={{ color:C.muted, fontSize:10 }}>{d?.isTrain ? "Train" : "Test"}</div>
                  </div>
                );
              }}/>
              <ReferenceLine y={0}             stroke={C.muted} strokeWidth={1}/>
              <ReferenceLine y={ 2*residSigma} stroke={C.red}   strokeDasharray="3 3" strokeOpacity={0.5} label={{ value:"+2σ", fill:C.muted, fontSize:9, position:"right" }}/>
              <ReferenceLine y={-2*residSigma} stroke={C.red}   strokeDasharray="3 3" strokeOpacity={0.5} label={{ value:"−2σ", fill:C.muted, fontSize:9, position:"right" }}/>
              <Bar dataKey="resid" name="Residual" isAnimationActive={false} maxBarSize={6}
                fill={C.purple} fillOpacity={0.7}/>
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* ── State-level actual vs model time series ── */}
      {(() => {
        const STATES = [
          { key:"vic", label:"Victoria",       actualKey:"vic_actual", predKey:"vic_pred", color:C.blue   },
          { key:"nsw", label:"New South Wales", actualKey:"nsw_actual", predKey:"nsw_pred", color:C.green  },
          { key:"sa",  label:"South Australia", actualKey:"sa_actual",  predKey:"sa_pred",  color:C.orange },
          { key:"tas", label:"Tasmania",        actualKey:"tas_actual", predKey:"tas_pred", color:C.purple },
        ];
        const hasStateData = npData && npData.some(r => r.vic_actual > 0);
        return (
          <>
            <div style={{ color:C.muted, fontSize:10, textTransform:"uppercase", letterSpacing:2,
              margin:"24px 0 12px" }}>STATE-LEVEL BREAKDOWN</div>
            {!hasStateData && (
              <div style={{ color:C.muted, fontSize:11, fontStyle:"italic", marginBottom:12 }}>
                State columns (vic_actual_tj, vic_pred_tj, …) not yet present in uploaded CSV.
              </div>
            )}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
              {STATES.map(({ key, label, actualKey, predKey, color }) => {
                const stateData = (npData || []).map(r => ({
                  label:     r.label ?? "",
                  labelFull: r.date,
                  actual:    r[actualKey] > 0 ? r[actualKey] : null,
                  model:     r[predKey]   > 0 ? r[predKey]   : null,
                }));
                // Compute R² and MAPE for this state
                const valid = stateData.filter(r => r.actual != null && r.model != null);
                const aMean = valid.length ? valid.reduce((s,r)=>s+r.actual,0)/valid.length : 1;
                const ssTot = valid.reduce((s,r)=>s+(r.actual-aMean)**2,0);
                const ssRes = valid.reduce((s,r)=>s+(r.actual-r.model)**2,0);
                const stR2   = ssTot ? 1 - ssRes/ssTot : 0;
                const stMape = valid.length ? valid.reduce((s,r)=>s+Math.abs(r.actual?(r.actual-r.model)/r.actual:0),0)/valid.length*100 : 0;
                return (
                  <ChartCard key={key}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
                      <div style={{ color, fontSize:13, fontWeight:600 }}>
                        {label} — Non-Power Actual vs Model (TJ/day)
                      </div>
                      {valid.length > 0 && (
                        <div style={{ display:"flex", gap:10 }}>
                          <span style={{ fontSize:11, color:C.green,  fontFamily:"monospace", fontWeight:600 }}>R² {(stR2*100).toFixed(1)}%</span>
                          <span style={{ fontSize:11, color:C.yellow, fontFamily:"monospace", fontWeight:600 }}>MAPE {stMape.toFixed(1)}%</span>
                        </div>
                      )}
                    </div>
                    <ZoomableTimeSeries
                      data={stateData}
                      height={200}
                      yWidth={36}
                      lines={[
                        { key:"actual", color, width:1.2, name:`Actual ${label}` },
                        { key:"model",  color:C.blue, width:1, name:`Model ${label}`, dashed:true },
                      ]}
                    />
                  </ChartCard>
                );
              })}
            </div>
          </>
        );
      })()}
    </div>
  );
}

// ── MONTE CARLO TAB ────────────────────────────────────────────────────────────
const THRESHOLD_TJ = 2200;

function MonteCarloTab({ modelSummary, scenarioData }) {
  const [nSims, setNSims]         = useState(500);
  const [threshold, setThreshold] = useState(modelSummary?.monte_carlo?.threshold_tj ?? THRESHOLD_TJ);
  const [running, setRunning]     = useState(false);
  const [results, setResults]     = useState(null);

  const ms = modelSummary;

  // ── Sigma components from model_summary (with fallbacks) ─────────────────────
  const mc = ms?.monte_carlo;
  // End-to-end GPG σ: dispatch model residual + sub-model error propagation
  const sigma_gpg_base = Math.sqrt(
    ((mc?.sigma_model_gpg ?? 36.4) ** 2) +   // GPG dispatch model residual
    ((mc?.sigma_wind      ?? 14.7) ** 2) +   // wind gen model error → GPG
    ((mc?.sigma_solar     ??  8.7) ** 2) +   // solar gen model error → GPG
    ((mc?.sigma_coal      ?? 10.0) ** 2) +   // coal gen model error → GPG
    ((mc?.sigma_hydro     ??  9.0) ** 2)     // hydro gen model error → GPG
  ); // ≈ 42 TJ/day end-to-end
  const sigma_np_base = mc?.sigma_model_np ?? 31.2; // non-power model residual

  // User-tunable multipliers (applied on top of base σ values)
  const [sigmaGpgMult, setSigmaGpgMult] = useState(2.0); // default 2× — true σ likely larger
  const [sigmaNpMult,  setSigmaNpMult]  = useState(1.0);
  const [rho,          setRho]          = useState(0.25); // GPG/NP residual correlation
  const [arPhi,        setArPhi]        = useState(0.7);  // AR(1) persistence

  const sigma_gpg = sigma_gpg_base * sigmaGpgMult;
  const sigma_np  = sigma_np_base  * sigmaNpMult;

  // ── Build DOY-indexed paths from scenario data ────────────────────────────────
  // Returns { gpg: array[365], np: array[365] }
  const buildDoyPath = (label) => {
    const rows = scenarioData?.[label] || [];
    const gpgByDoy = new Array(366).fill(null);
    const npByDoy  = new Array(366).fill(null);
    rows.forEach(r => {
      const d = new Date(r.date);
      const doy = Math.round((d - new Date(d.getFullYear(), 0, 0)) / 86400000);
      if (doy >= 1 && doy <= 365) {
        gpgByDoy[doy] = r.pred_gpg_tj;
        npByDoy[doy]  = r.pred_nonpower_tj;
      }
    });
    const fill = (arr, fallback) => {
      const path = Array.from({length:365}, (_, i) => arr[i+1]);
      for (let i = 0; i < 365; i++) {
        if (path[i] == null) {
          let prev = i-1; while (prev >= 0  && path[prev] == null) prev--;
          let next = i+1; while (next < 365 && path[next] == null) next++;
          if (prev >= 0 && next < 365) path[i] = path[prev] + (path[next]-path[prev])*(i-prev)/(next-prev);
          else if (prev >= 0) path[i] = path[prev];
          else if (next < 365) path[i] = path[next];
          else path[i] = fallback;
        }
      }
      return path;
    };
    return { gpg: fill(gpgByDoy, 130), np: fill(npByDoy, 580) };
  };

  // ── Shared post-processing: paths (total) → results ──────────────────────────
  const finishSim = (paths) => {
    const n = paths.length;

    const DOY_LABELS = (() => {
      const starts = [1,32,60,91,121,152,182,213,244,274,305,335];
      const names  = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return Array.from({length:365}, (_, i) => {
        const idx = starts.findLastIndex(s => (i+1) >= s);
        return (i+1) === starts[idx] ? names[idx] : "";
      });
    })();

    const dailySims = Array.from({length:365}, (_, d) => {
      const vals = paths.map(p => p[d]).sort((a,b) => a-b);
      return {
        doy: d+1,
        label: DOY_LABELS[d],
        p10:  vals[Math.floor(n*0.10)],
        p50:  vals[Math.floor(n*0.50)],
        p90:  vals[Math.floor(n*0.90)],
        probExceed: vals.filter(v => v > threshold).length / n * 100,
      };
    });

    const peakSims = paths.map(p => Math.max(...p)).sort((a,b) => a-b);
    const peakP10 = peakSims[Math.floor(n*0.10)];
    const peakP50 = peakSims[Math.floor(n*0.50)];
    const peakP90 = peakSims[Math.floor(n*0.90)];

    const hMin = peakSims[0], hMax = peakSims[peakSims.length-1];
    const nBins = 20, bw = (hMax - hMin) / nBins;
    const hist = Array.from({length:nBins}, (_, i) => {
      const lo = hMin + i*bw, hi = hMin + (i+1)*bw;
      return {
        bin: +(hMin + (i+0.5)*bw).toFixed(0),
        pct: +(peakSims.filter(v => v >= lo && v < hi).length / n * 100).toFixed(1),
      };
    });

    setResults({ dailySims, peakP10, peakP50, peakP90, hist, peakSims });
    setRunning(false);
  };

  // ── Simulation engine ─────────────────────────────────────────────────────────
  const runSimulation = () => {
    const scenLabels = Object.keys(scenarioData || {});

    // Gaussian fallback if fewer than 2 scenarios loaded
    if (scenLabels.length < 2) {
      setRunning(true);
      setTimeout(() => {
        const randn = () => {
          let u=0,v=0;
          while(u===0) u=Math.random(); while(v===0) v=Math.random();
          return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);
        };
        const SEASONAL = Array.from({length:365}, (_,i) => {
          if (ms?.seasonal?.gpg_by_doy && ms?.seasonal?.np_by_doy)
            return { gpg: ms.seasonal.gpg_by_doy[i]??130, np: ms.seasonal.np_by_doy[i]??580 };
          const t = 2*Math.PI*(i-164)/365;
          return { gpg: 130 + 120*Math.cos(t), np: 580 + 80*Math.cos(t) };
        });
        const sqRho = Math.sqrt(Math.max(0, rho));
        const sqOneMinusRho = Math.sqrt(Math.max(0, 1 - rho));
        const paths = Array.from({length:nSims}, () => {
          let epsGpg = 0, epsNp = 0;
          return Array.from({length:365}, (_,d) => {
            const z1 = randn(), z2 = randn();
            const zGpg = z1;
            const zNp  = sqRho * z1 + sqOneMinusRho * z2;
            epsGpg = arPhi*epsGpg + Math.sqrt(1-arPhi**2)*sigma_gpg*zGpg;
            epsNp  = arPhi*epsNp  + Math.sqrt(1-arPhi**2)*sigma_np *zNp;
            return Math.max(0, SEASONAL[d].gpg + epsGpg) + Math.max(0, SEASONAL[d].np + epsNp);
          });
        });
        finishSim(paths);
      }, 50);
      return;
    }

    setRunning(true);
    setTimeout(() => {
      const baseLabels = scenLabels.filter(l => l.toLowerCase().includes("base"));
      const pool = (baseLabels.length > 0 ? baseLabels : scenLabels).map(buildDoyPath);

      const randn = () => {
        let u=0,v=0;
        while(u===0) u=Math.random(); while(v===0) v=Math.random();
        return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);
      };

      // Cholesky decomposition for bivariate correlated normals:
      // z_gpg = z1 (independent)
      // z_np  = ρ·z1 + √(1-ρ²)·z2 (correlated with GPG at ρ)
      const sqOneMinusRhoSq = Math.sqrt(Math.max(0, 1 - rho**2));

      const paths = Array.from({length:nSims}, () => {
        const base = pool[Math.floor(Math.random() * pool.length)];
        let epsGpg = 0, epsNp = 0;
        return Array.from({length:365}, (_, d) => {
          const z1 = randn(), z2 = randn();
          // Correlated shocks via Cholesky
          const zGpg = z1;
          const zNp  = rho * z1 + sqOneMinusRhoSq * z2;
          // AR(1) update for each component independently
          epsGpg = arPhi*epsGpg + Math.sqrt(1-arPhi**2)*sigma_gpg*zGpg;
          epsNp  = arPhi*epsNp  + Math.sqrt(1-arPhi**2)*sigma_np *zNp;
          // Apply shocks to separate components, floor each at zero
          return Math.max(0, base.gpg[d] + epsGpg) + Math.max(0, base.np[d] + epsNp);
        });
      });

      finishSim(paths);
    }, 50);
  };

  // Auto-run once scenarios are available (or on mount with fallback)
  const scenCount = Object.keys(scenarioData || {}).length;
  useEffect(() => { runSimulation(); }, [scenCount]);

  const r = results;
  const usingScenarios = scenCount >= 2;

  return (
    <div>
      {/* ── Title + controls ── */}
      <div style={{ marginBottom:20 }}>
        <div style={{ color:C.muted, fontSize:10, textTransform:"uppercase", letterSpacing:2, marginBottom:4 }}>
          PROBABILISTIC OUTLOOK · FULL YEAR
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:16 }}>
          <div style={{ fontSize:22, fontWeight:700 }}>Monte Carlo — Annual Risk Simulation</div>
          <div style={{ background: usingScenarios ? "#1a2a1a" : "#1a2a3a",
            border:`1px solid ${usingScenarios ? C.green : C.blue}`,
            borderRadius:6, padding:"3px 10px", fontSize:11,
            color: usingScenarios ? C.green : C.blue, fontWeight:600 }}>
            {usingScenarios ? `BOOTSTRAP · ${scenCount} WEATHER YEARS` : "GAUSSIAN FALLBACK"}
          </div>
        </div>
        {/* Method explanation */}
        <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderLeft:`3px solid ${usingScenarios ? C.green : C.blue}`,
          borderRadius:4, padding:"8px 14px", fontSize:11, color:C.muted, marginBottom:12 }}>
          {usingScenarios
            ? <><span style={{ color:C.green, fontWeight:600 }}>Resampling method: </span>
                Each of {nSims} paths bootstraps a Base weather year, then adds two correlated AR(1) residual
                processes — one for GPG (σ={sigma_gpg.toFixed(0)} TJ, end-to-end incl. sub-models) and one for
                Non-Power (σ={sigma_np.toFixed(0)} TJ), correlated at ρ={rho.toFixed(2)} via Cholesky decomposition.</>
            : <><span style={{ color:C.yellow, fontWeight:600 }}>⚠ No scenarios loaded — </span>
                using Gaussian noise around a sine-wave seasonal baseline. Load scenario CSVs for resampling.</>}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,auto) 1fr", alignItems:"center", gap:"8px 20px", flexWrap:"wrap" }}>
          {/* Row 1: sigma controls */}
          <label style={{ color:C.muted, fontSize:11, gridColumn:"1" }}>
            GPG σ multiplier:
            <input type="range" min={0.5} max={5} step={0.1} value={sigmaGpgMult}
              onChange={e=>setSigmaGpgMult(+e.target.value)}
              style={{ marginLeft:8, width:80, verticalAlign:"middle" }}/>
            <span style={{ marginLeft:6, color:C.orange, fontFamily:"monospace", fontWeight:600 }}>
              ×{sigmaGpgMult.toFixed(1)} → {sigma_gpg.toFixed(0)} TJ/day
            </span>
          </label>
          <label style={{ color:C.muted, fontSize:11, gridColumn:"2" }}>
            NP σ multiplier:
            <input type="range" min={0.5} max={3} step={0.1} value={sigmaNpMult}
              onChange={e=>setSigmaNpMult(+e.target.value)}
              style={{ marginLeft:8, width:80, verticalAlign:"middle" }}/>
            <span style={{ marginLeft:6, color:C.cyan, fontFamily:"monospace", fontWeight:600 }}>
              ×{sigmaNpMult.toFixed(1)} → {sigma_np.toFixed(0)} TJ/day
            </span>
          </label>
          <label style={{ color:C.muted, fontSize:11, gridColumn:"3" }}>
            GPG/NP correlation ρ:
            <input type="range" min={-0.5} max={0.99} step={0.05} value={rho}
              onChange={e=>setRho(+e.target.value)}
              style={{ marginLeft:8, width:80, verticalAlign:"middle" }}/>
            <span style={{ marginLeft:6, color:C.text, fontFamily:"monospace", fontWeight:600 }}>{rho.toFixed(2)}</span>
          </label>
          <label style={{ color:C.muted, fontSize:11, gridColumn:"4" }}>
            AR(1) φ (persistence):
            <input type="range" min={0} max={0.95} step={0.05} value={arPhi}
              onChange={e=>setArPhi(+e.target.value)}
              style={{ marginLeft:8, width:80, verticalAlign:"middle" }}/>
            <span style={{ marginLeft:6, color:C.text, fontFamily:"monospace", fontWeight:600 }}>{arPhi.toFixed(2)}</span>
          </label>
          {/* Row 2: sims, threshold, run button */}
          <div style={{ display:"flex", alignItems:"center", gap:16, gridColumn:"1 / -1", marginTop:6 }}>
            <label style={{ color:C.muted, fontSize:11 }}>Simulations:
              <select value={nSims} onChange={e=>setNSims(+e.target.value)} style={{
                marginLeft:8, background:C.surface2, border:`1px solid ${C.border}`,
                borderRadius:4, color:C.text, padding:"3px 8px", fontSize:11 }}>
                {[200,500,1000,2000].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label style={{ color:C.muted, fontSize:11 }}>Threshold (TJ/day):
              <input type="number" value={threshold} onChange={e=>setThreshold(+e.target.value)}
                style={{ marginLeft:8, width:70, background:C.surface2, border:`1px solid ${C.border}`,
                  borderRadius:4, color:C.text, padding:"3px 8px", fontSize:11 }}/>
            </label>
            <div onClick={runSimulation} style={{
              background: running ? C.surface2 : C.blue, border:`1px solid ${C.blue}`,
              borderRadius:6, padding:"6px 18px", cursor: running ? "wait" : "pointer",
              fontSize:12, color: running ? C.muted : "#0d1117", fontWeight:700,
              display:"flex", alignItems:"center", gap:6,
            }}>
              {running ? "⏳ Running…" : "▶ Re-run Simulation"}
            </div>
          </div>
        </div>
      </div>

      {/* ── Annual KPI cards ── */}
      {r && (
        <div style={{ display:"flex", gap:12, marginBottom:16 }}>
          {[
            { label:"PEAK DAY P50", value:`${r.peakP50.toFixed(0)} TJ/day`, sub:"Median annual peak day",      color:C.blue   },
            { label:"PEAK DAY P10 (POE90)", value:`${r.peakP10.toFixed(0)} TJ/day`, sub:"Low demand peak",     color:C.green  },
            { label:"PEAK DAY P90 (POE10)", value:`${r.peakP90.toFixed(0)} TJ/day`, sub:"High demand peak",    color:C.yellow },
            { label:"P10–P90 RANGE", value:`${(r.peakP90-r.peakP10).toFixed(0)} TJ/day`, sub:"Peak day uncertainty spread", color:C.orange },
          ].map((k,i) => (
            <div key={i} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:"16px 20px", flex:1 }}>
              <div style={{ color:C.muted, fontSize:10, textTransform:"uppercase", letterSpacing:1, marginBottom:6 }}>{k.label}</div>
              <div style={{ color:k.color, fontSize:28, fontWeight:700, fontFamily:"monospace" }}>{k.value}</div>
              <div style={{ color:C.muted, fontSize:11, marginTop:5 }}>{k.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── Peak day distribution histogram ── */}
      {r && (
        <ChartCard style={{ marginBottom:16 }}>
          <SectionTitle color={C.blue}>Peak Day Gas Demand Distribution — across {nSims} simulated years (TJ/day)</SectionTitle>
          <div style={{ display:"flex", justifyContent:"center", gap:40, marginBottom:8 }}>
            {[
              { label:"P10", value:`${r.peakP10.toFixed(0)} TJ/day`, color:C.green  },
              { label:"P50", value:`${r.peakP50.toFixed(0)} TJ/day`, color:C.blue   },
              { label:"P90", value:`${r.peakP90.toFixed(0)} TJ/day`, color:C.yellow },
            ].map(p => (
              <div key={p.label} style={{ textAlign:"center" }}>
                <div style={{ color:p.color, fontSize:11, fontWeight:600 }}>{p.label}</div>
                <div style={{ color:p.color, fontSize:16, fontWeight:700 }}>{p.value}</div>
              </div>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={r.hist} margin={{ top:4, right:8, bottom:20, left:0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
              <XAxis dataKey="bin" tick={{ fill:C.muted, fontSize:9 }} stroke={C.border}
                label={{ value:"Peak day demand (TJ/day)", fill:C.muted, fontSize:9, position:"insideBottom", offset:-12 }}/>
              <YAxis tick={{ fill:C.muted, fontSize:9 }} stroke={C.border} width={42}
                tickFormatter={v=>`${v}%`}
                label={{ value:"% of simulations", fill:C.muted, fontSize:9, angle:-90, position:"insideLeft", offset:14 }}/>
              <Tooltip content={({ active, payload }) => {
                if (!active||!payload?.length) return null;
                return <div style={{ background:C.surface2, border:`1px solid ${C.border}`, borderRadius:6, padding:"8px 12px", fontSize:11 }}>
                  <div style={{ color:C.muted }}>{payload[0]?.payload?.bin} TJ/day</div>
                  <div style={{ color:C.blue }}>{payload[0]?.value}% of simulations</div>
                </div>;
              }}/>
              <ReferenceLine x={r.peakP10.toFixed(0)} stroke={C.green}  strokeDasharray="4 2"
                label={{ value:"P10", fill:C.green,  fontSize:9, position:"top" }}/>
              <ReferenceLine x={r.peakP50.toFixed(0)} stroke={C.blue}   strokeDasharray="4 2"
                label={{ value:"P50", fill:C.blue,   fontSize:9, position:"top" }}/>
              <ReferenceLine x={r.peakP90.toFixed(0)} stroke={C.yellow} strokeDasharray="4 2"
                label={{ value:"P90", fill:C.yellow, fontSize:9, position:"top" }}/>
              <Bar dataKey="pct" fill={C.blue} fillOpacity={0.6} isAnimationActive={false}/>
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* ── Daily P10/P50/P90 ── */}
      {r && (
        <ChartCard style={{ marginBottom:16 }}>
          <SectionTitle color={C.blue}>Daily P10 / P50 / P90 — Full Year (TJ/day)</SectionTitle>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={r.dailySims} margin={{ top:4, right:8, bottom:0, left:0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
              <XAxis dataKey="label" tick={{ fill:C.muted, fontSize:9 }} stroke={C.border} interval={0}/>
              <YAxis tick={{ fill:C.muted, fontSize:10 }} stroke={C.border} width={40} domain={[0,"auto"]}/>
              <Tooltip content={({ active, payload }) => {
                if (!active||!payload?.length) return null;
                const d = payload[0]?.payload;
                return <div style={{ background:C.surface2, border:`1px solid ${C.border}`, borderRadius:6, padding:"8px 12px", fontSize:11 }}>
                  <div style={{ color:C.yellow }}>P90: <strong>{d?.p90?.toFixed(0)} TJ</strong></div>
                  <div style={{ color:C.blue   }}>P50: <strong>{d?.p50?.toFixed(0)} TJ</strong></div>
                  <div style={{ color:C.green  }}>P10: <strong>{d?.p10?.toFixed(0)} TJ</strong></div>
                </div>;
              }}/>
              <ReferenceLine y={threshold} stroke={C.red} strokeDasharray="4 2" strokeOpacity={0.6}
                label={{ value:`Threshold ${threshold} TJ`, fill:C.red, fontSize:9, position:"right" }}/>
              <Area dataKey="p90" stroke="none" fill={C.yellow} fillOpacity={0.08} dot={false} connectNulls isAnimationActive={false}/>
              <Area dataKey="p10" stroke="none" fill={C.bg}     fillOpacity={1}    dot={false} connectNulls isAnimationActive={false}/>
              <Line dataKey="p90" stroke={C.yellow} strokeWidth={1} strokeDasharray="4 2" dot={false} name="P90 (PoE10)" connectNulls isAnimationActive={false}/>
              <Line dataKey="p10" stroke={C.green}  strokeWidth={1} strokeDasharray="4 2" dot={false} name="P10 (PoE90)" connectNulls isAnimationActive={false}/>
              <Line dataKey="p50" stroke={C.blue}   strokeWidth={2} dot={false} name="P50 Total"    connectNulls isAnimationActive={false}/>
              <Legend content={<FilteredLegend/>}/>
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* ── Probability of exceeding threshold ── */}
      {r && (
        <ChartCard>
          <SectionTitle color={C.red}>
            Daily Probability of Exceeding {threshold.toLocaleString()} TJ/day — GPG + Non-Power Combined (%)
          </SectionTitle>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={r.dailySims} margin={{ top:4, right:8, bottom:0, left:0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
              <XAxis dataKey="label" tick={{ fill:C.muted, fontSize:9 }} stroke={C.border} interval={0}/>
              <YAxis tick={{ fill:C.muted, fontSize:10 }} stroke={C.border} width={40}
                domain={[0,100]} tickFormatter={v=>`${v}%`}/>
              <Tooltip content={({ active, payload }) => {
                if (!active||!payload?.length) return null;
                const d = payload[0]?.payload;
                return <div style={{ background:C.surface2, border:`1px solid ${C.border}`, borderRadius:6, padding:"8px 12px", fontSize:11 }}>
                  <div style={{ color:C.red }}>P(exceed {threshold} TJ): <strong>{d?.probExceed?.toFixed(1)}%</strong></div>
                </div>;
              }}/>
              <ReferenceLine y={50} stroke={C.yellow} strokeDasharray="4 2" strokeOpacity={0.6}
                label={{ value:"50%", fill:C.yellow, fontSize:9, position:"right" }}/>
              <Line dataKey="probExceed" stroke={C.red} strokeWidth={1.5} dot={false} name="P(exceed)" connectNulls isAnimationActive={false}/>
              <Area dataKey="probExceed" stroke="none" fill={C.red} fillOpacity={0.1} dot={false} connectNulls isAnimationActive={false}/>
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      )}
    </div>
  );
}

// ── DIAGNOSTICS TAB ────────────────────────────────────────────────────────────
function DiagnosticsTab({ crossData, npData, modelSummary }) {
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const ms  = modelSummary;

  // ── Helper: format σ with units ───────────────────────────────────────────────
  const fmtSigma = (val, unit) => val != null ? `${val > 1000 ? (val/1000).toFixed(1)+"k" : val.toFixed(0)} ${unit}` : "—";

  // ── Model spec cards — driven by modelSummary if present ─────────────────────
  const modelSpecs = [
    { label:"Non-Power",       color:C.cyan,   border:"#0f3a3c",
      sub:"OLS: seasonal sine + day-type × HDD/CDD",
      r2:    ms ? `${(ms.models.nonpower.r2*100).toFixed(1)}%`  : "—",
      mape:  ms ? `${ms.models.nonpower.mape.toFixed(1)}%`      : "—",
      sigma: ms ? fmtSigma(ms.models.nonpower.sigma, "TJ/d")    : "—",
    },
    { label:"NEM Demand",      color:C.blue,   border:"#2d3f6e",
      sub:"LightGBM: seasonal + DoW + HDD/CDD",
      r2:    ms ? `${(ms.models.nem.r2*100).toFixed(1)}%`       : "—",
      mape:  ms ? `${ms.models.nem.mape.toFixed(1)}%`           : "—",
      sigma: ms ? fmtSigma(ms.models.nem.sigma, "MWh/d")        : "—",
    },
    { label:"Wind Generation", color:C.green,  border:"#1a3a1a",
      sub:"LightGBM: wind speed + direction",
      r2:    ms ? `${(ms.models.wind.r2*100).toFixed(1)}%`      : "—",
      mape:  ms ? `${ms.models.wind.mape.toFixed(1)}%`          : "—",
      sigma: ms ? fmtSigma(ms.models.wind.sigma, "MWh/d")       : "—",
    },
    { label:"Solar Generation",color:C.yellow, border:"#3a2f0a",
      sub:"LightGBM: radiation + season",
      r2:    ms ? `${(ms.models.solar.r2*100).toFixed(1)}%`     : "—",
      mape:  ms ? `${ms.models.solar.mape.toFixed(1)}%`         : "—",
      sigma: ms ? fmtSigma(ms.models.solar.sigma, "MWh/d")      : "—",
    },
    { label:"Coal Generation", color:C.muted,  border:C.border,
      sub:"LightGBM: seasonal profile",
      r2:    ms ? `${(ms.models.coal.r2*100).toFixed(1)}%`      : "—",
      mape:  ms ? `${ms.models.coal.mape.toFixed(1)}%`          : "—",
      sigma: ms ? fmtSigma(ms.models.coal.sigma, "MWh/d")       : "—",
    },
    { label:"Hydro Generation",color:C.cyan,   border:"#0f3a3c",
      sub:"LightGBM: on residual demand",
      r2:    ms ? `${(ms.models.hydro.r2*100).toFixed(1)}%`     : "—",
      mape:  ms ? `${ms.models.hydro.mape.toFixed(1)}%`         : "—",
      sigma: ms ? fmtSigma(ms.models.hydro.sigma, "MWh/d")      : "—",
    },
    { label:"GPG Dispatch",    color:C.orange, border:"#4a3010",
      sub:"LightGBM: residual − hydro → TJ",
      r2:    ms ? `${(ms.models.gpg.r2*100).toFixed(1)}%`       : "—",
      mape:  ms ? `${ms.models.gpg.mape.toFixed(1)}%`           : "—",
      sigma: ms ? fmtSigma(ms.models.gpg.sigma, "TJ/d")         : "—",
    },
  ];

  // ── Historical stacked area — 2022-2024 ─────────────────────────────────────
  // Use real data if available, else generate demo
  const stackedData = (() => {
    if (crossData && npData && crossData.gpg.length > 0) {
      // Merge on index (both should be 2022-2024 daily)
      const gpgRows = crossData.gpg;
      return gpgRows.map((g, i) => {
        const np = npData[i];
        const d  = g.rawDate ? new Date(g.rawDate) : null;
        const isQtrStart = d && d.getDate() <= 3 && d.getMonth() % 3 === 0;
        return {
          label: isQtrStart ? `${d.getDate()} ${MON[d.getMonth()]}` : "",
          gpg:   g.actual > 0 ? +g.actual.toFixed(1) : null,
          nonpwr: np?.actual_tj > 0 ? +np.actual_tj.toFixed(1) : null,
        };
      });
    }
    // Demo fallback
    const rows = [];
    const start = new Date("2022-01-01");
    for (let d = 0; d < 1095; d++) {
      const dt = new Date(start); dt.setDate(dt.getDate() + d);
      const m = dt.getMonth();
      const isQtrStart = dt.getDate() <= 3 && m % 3 === 0;
      const cos = Math.cos(2 * Math.PI * (d - 15) / 365);
      rows.push({
        label: isQtrStart ? `${dt.getDate()} ${MON[m]}` : "",
        gpg:   Math.max(0, 130 + 120*cos + (Math.random()-.5)*60),
        nonpwr: Math.max(0, 580 + 80*cos + (Math.random()-.5)*40),
      });
    }
    return rows;
  })();

  const isRealData = crossData && npData;

  // ── Assumption cards ─────────────────────────────────────────────────────────
  const assumptionCards = [
    { title:"Seasonal Pattern", color:C.cyan, items:[
      "Sine wave: min ~Jan 15 (doy 15), max ~Jul 15 (doy 196)",
      "Formula: min+(max−min)×(0.5−0.5cos(2π(doy−15)/365))",
      "Solar uses inverse sine (max summer)",
      "Parameters fitted from 2022–2024 historical data",
    ]},
    { title:"Day-Type Groups", color:C.yellow, items:[
      "Tue–Thu: 100% (baseline)",
      "Mon/Fri: 92%",
      "Weekend: 72%",
      "Estimated from historical demand averages",
    ]},
    { title:"Weather Variables", color:C.blue, items:[
      "HDD base: 18°C (heating)",
      "CDD base: 24°C (cooling)",
      "Non-power HDD: 8.4 TJ/°Cd",
      "Population-weighted 8 SE cities",
    ]},
    { title:"GPG Sub-Models", color:C.orange, items:[
      "NEM: seasonal + DoW + HDD/CDD",
      "Wind: linear regression wind speed",
      "Solar: inverse seasonal sine",
      "Coal: seasonal profile",
    ]},
    { title:"Confidence Intervals", color:C.green, items:[
      "P10 = P50 − 1.28σ",
      "P90 = P50 + 1.28σ",
      "σ from in-sample OLS residuals",
      "MC: stochastic weather + model error",
    ]},
    { title:"Architecture", color:C.purple, items:[
      "Python: train LightGBM/sklearn",
      "Export: JSON → MODEL_PARAMS",
      "React: in-browser scoring & MC",
      "CSV upload for live weather input",
    ]},
  ];

  return (
    <div>
      {/* ── Title ── */}
      <div style={{ marginBottom:20 }}>
        <div style={{ color:C.muted, fontSize:10, textTransform:"uppercase", letterSpacing:2, marginBottom:4 }}>
          VALIDATION · ASSUMPTIONS · ARCHITECTURE
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          <div style={{ fontSize:22, fontWeight:700 }}>Model Diagnostics & Specifications</div>
          {ms
            ? <div style={{ background:"#1a3a1a", border:`1px solid ${C.green}`, borderRadius:6,
                padding:"3px 10px", fontSize:11, color:C.green, fontWeight:600 }}>
                ✓ model_summary.json · {ms.generated?.slice(0,10)}
              </div>
            : <span style={{ color:C.muted, fontSize:11, fontStyle:"italic" }}>
                upload model_summary.json to populate from real training run
              </span>
          }
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12, marginBottom:16 }}>
        {modelSpecs.map((m,i) => (
          <div key={i} style={{ background:C.surface, border:`1px solid ${m.border}`, borderRadius:10, padding:"16px 20px" }}>
            <div style={{ color:m.color, fontSize:13, fontWeight:600, marginBottom:4 }}>{m.label}</div>
            <div style={{ color:C.muted, fontSize:10, marginBottom:12 }}>{m.sub}</div>
            <div style={{ display:"flex", gap:20 }}>
              <div>
                <div style={{ color:C.muted, fontSize:9, textTransform:"uppercase", letterSpacing:1 }}>R²</div>
                <div style={{ color:m.color, fontSize:22, fontWeight:700, fontFamily:"monospace" }}>{m.r2}</div>
              </div>
              <div>
                <div style={{ color:C.muted, fontSize:9, textTransform:"uppercase", letterSpacing:1 }}>MAPE</div>
                <div style={{ color:C.text,  fontSize:22, fontWeight:700, fontFamily:"monospace" }}>{m.mape}</div>
              </div>
              <div>
                <div style={{ color:C.muted, fontSize:9, textTransform:"uppercase", letterSpacing:1 }}>σ</div>
                <div style={{ color:C.text,  fontSize:18, fontWeight:700, fontFamily:"monospace" }}>{m.sigma}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Historical stacked area chart ── */}
      <ChartCard style={{ marginBottom:16 }}>
        <SectionTitle color={C.text}>
          Historical Gas Demand — 2022–2024 (GPG + Non-Power stacked, TJ/day)
          {!isRealData && <span style={{ color:C.muted, fontSize:10, fontWeight:400, marginLeft:8 }}>demo data</span>}
        </SectionTitle>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={stackedData} margin={{ top:4, right:8, bottom:0, left:0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
            <XAxis dataKey="label" tick={{ fill:C.muted, fontSize:9 }} stroke={C.border} interval={0}/>
            <YAxis tick={{ fill:C.muted, fontSize:10 }} stroke={C.border} width={40} domain={[0,"auto"]}/>
            <Tooltip content={({ active, payload }) => {
              if (!active||!payload?.length) return null;
              const d = payload[0]?.payload;
              return <div style={{ background:C.surface2, border:`1px solid ${C.border}`, borderRadius:6, padding:"8px 12px", fontSize:11 }}>
                <div style={{ color:C.orange }}>GPG: <strong>{d?.gpg?.toFixed(1)} TJ</strong></div>
                <div style={{ color:C.cyan  }}>Non-Power: <strong>{d?.nonpwr?.toFixed(1)} TJ</strong></div>
                <div style={{ color:C.muted }}>Total: <strong>{((d?.gpg||0)+(d?.nonpwr||0)).toFixed(1)} TJ</strong></div>
              </div>;
            }}/>
            <Area dataKey="nonpwr" stackId="a" stroke={C.cyan}   strokeWidth={1}   fill={C.cyan}   fillOpacity={0.25} name="Non-Power (TJ)" connectNulls isAnimationActive={false}/>
            <Area dataKey="gpg"    stackId="a" stroke={C.orange} strokeWidth={1}   fill={C.orange} fillOpacity={0.35} name="GPG (TJ)"       connectNulls isAnimationActive={false}/>
            <Legend content={<FilteredLegend/>}/>
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* ── Assumption cards — 3 column ── */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:12 }}>
        {assumptionCards.map((a,i) => (
          <div key={i} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:"16px 20px" }}>
            <div style={{ color:a.color, fontSize:12, fontWeight:600, marginBottom:10 }}>{a.title}</div>
            {a.items.map((item,j) => (
              <div key={j} style={{ color:C.muted, fontSize:11, marginBottom:5, display:"flex", gap:6 }}>
                <span style={{ color:a.color, opacity:0.6 }}>·</span> {item}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── ROOT APP ───────────────────────────────────────────────────────────────────


// ════════════════════════════════════════════════════════════════════
// ── AEMO ACTUAL DATA TABS (from East Coast Gas Market Dashboard) ────
// ════════════════════════════════════════════════════════════════════


// ── TabDailyDemand ──

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// FIX 2: configurable threshold, default 2190
const DEFAULT_THRESHOLD = 2190;

const STATE_COLORS = { VIC: '#388bfd', NSW: '#3fb950', SA: '#e6a817', TAS: '#bc8cff' };

function TabDailyDemand({ records, selectedYears, dateRange }) {
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
    return `${MONTH_LABELS[d.getMonth()]} ${d.getDate()}`;
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
            <Tooltip content={<CustomTooltip formatter={v => `${Math.round(v).toLocaleString()} TJ`} />} />
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
            <XAxis dataKey="date" {...AXIS_STYLE} interval={Math.floor(stateDaily.length / 12)} />
            <YAxis {...AXIS_STYLE} tickFormatter={v => Math.round(v).toLocaleString()} />
            <Tooltip content={<CustomTooltip formatter={v => `${Math.round(v).toLocaleString()} TJ`} />} />
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
            <XAxis dataKey="date" {...AXIS_STYLE} interval={Math.floor(stackedDaily.length / 12)} />
            <YAxis {...AXIS_STYLE} tickFormatter={v => Math.round(v).toLocaleString()} />
            <Tooltip content={<CustomTooltip formatter={v => `${Math.round(v).toLocaleString()} TJ`} />} />
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
            <Tooltip content={<CustomTooltip formatter={v => `${Math.round(v).toLocaleString()} TJ/day`} />} />
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


// ── TabGPG ──

const THRESHOLDS = [400, 500, 600, 700];

function TabGPG({ records, selectedYears, dateRange }) {
  const latestYear = Math.max(...selectedYears);

  const filtered = useMemo(() =>
    records.filter(r => selectedYears.includes(r.year) && r.date >= dateRange[0] && r.date <= dateRange[1])
  , [records, selectedYears, dateRange]);

  // Daily GPG for latest year
  const latestGPG = useMemo(() =>
    records.filter(r => r.year === latestYear && r.date >= dateRange[0] && r.date <= dateRange[1])
      .map(r => ({
        date: r.date.substring(5),
        gpg: r.gpg_se,
        gpg_qld: r.gpg_qld,
        spike: r.gpg_se > 500 ? r.gpg_se : null,
      }))
  , [records, latestYear, dateRange]);

  // Year-on-year GPG overlay
  const yoyGPG = useMemo(() => {
    const pivot = {};
    for (const r of filtered) {
      if (!pivot[r.dayOfYear]) pivot[r.dayOfYear] = { day: r.dayOfYear };
      pivot[r.dayOfYear][r.year] = r.gpg_se;
    }
    return Object.values(pivot).sort((a, b) => a.day - b.day);
  }, [filtered]);

  // Threshold breach table by year
  const thresholdTable = useMemo(() => {
    const years = [...new Set(filtered.map(r => r.year))].sort();
    return years.map(y => {
      const gpgs = records.filter(r => r.year === y).map(r => r.gpg_se);
      const peak = Math.max(...gpgs);
      const peakDate = records.find(r => r.year === y && r.gpg_se === peak)?.date || '';
      return {
        year: y,
        peak: Math.round(peak),
        peakDate,
        ...Object.fromEntries(THRESHOLDS.map(t => [`d${t}`, gpgs.filter(v => v > t).length])),
      };
    });
  }, [filtered, records]);

  // Annual peak GPG bar chart
  const annualPeaks = useMemo(() =>
    thresholdTable.map(r => ({ year: r.year, peak: r.peak, ...Object.fromEntries(THRESHOLDS.map(t => [`d${t}`, r[`d${t}`]])) }))
  , [thresholdTable]);

  const latestStats = thresholdTable.find(r => r.year === latestYear) || {};

  const handleExportPPT = async (id, title) => {
    await exportToPowerPoint([{ id, title, subtitle: 'Gas Power Generation demand (TJ/day) — Source: AEMO' }]);
  };

  const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayLabel = (doy) => {
    const d = new Date(2024, 0, doy);
    return `${MONTH_LABELS[d.getMonth()]} ${d.getDate()}`;
  };
  const doyToDateStr = (doy) => {
    const d = new Date(2024, 0, doy);
    return `${d.getDate()} ${MONTH_LABELS[d.getMonth()]}`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <KpiCard label={`${latestYear} Peak GPG`} value={latestStats.peak?.toLocaleString() || '—'} unit="TJ" sub={latestStats.peakDate} color="var(--accent)" />
        <KpiCard label={`Days > 400 TJ`} value={latestStats.d400 ?? '—'} unit={`in ${latestYear}`} color="#ffa657" />
        <KpiCard label={`Days > 500 TJ`} value={latestStats.d500 ?? '—'} unit={`in ${latestYear}`} color="#ff7b72" />
        <KpiCard label={`Days > 600 TJ`} value={latestStats.d600 ?? '—'} unit={`in ${latestYear}`} color="var(--danger)" />
      </div>

      {/* Daily GPG with spike highlighting */}
      <ChartCard
        id="chart-gpg-daily"
        title={`${latestYear} Daily GPG Demand`}
        subtitle="SE States gas-fired power generation (TJ/day) — bars coloured by intensity"
        onExportPPT={() => handleExportPPT('chart-gpg-daily', `${latestYear} GPG Daily Demand`)}
        onExportXLSX={() => exportToExcel(filtered)}
      >
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={latestGPG} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="date" {...AXIS_STYLE} interval={Math.floor(latestGPG.length / 12)} />
            <YAxis {...AXIS_STYLE} />
            <Tooltip content={<CustomTooltip formatter={(v) => `${Math.round(v).toLocaleString()} TJ`} />} />
            <Bar dataKey="gpg" name="GPG SE" maxBarSize={6}>
              {latestGPG.map((entry, i) => (
                <Cell
                  key={i}
                  fill={
                    entry.gpg > 700 ? '#f85149' :
                    entry.gpg > 600 ? '#ff7b72' :
                    entry.gpg > 500 ? '#ffa657' :
                    entry.gpg > 400 ? '#e6a817' :
                    '#388bfd'
                  }
                />
              ))}
            </Bar>
            <ReferenceLine y={400} stroke="#e6a817" strokeDasharray="3 3" label={{ value: '400', fill: '#e6a817', fontSize: 9, position: 'insideTopRight' }} />
            <ReferenceLine y={500} stroke="#ffa657" strokeDasharray="3 3" label={{ value: '500', fill: '#ffa657', fontSize: 9, position: 'insideTopRight' }} />
            <ReferenceLine y={600} stroke="#ff7b72" strokeDasharray="3 3" label={{ value: '600', fill: '#ff7b72', fontSize: 9, position: 'insideTopRight' }} />
            <ReferenceLine y={700} stroke="#f85149" strokeDasharray="3 3" label={{ value: '700', fill: '#f85149', fontSize: 9, position: 'insideTopRight' }} />
          </ComposedChart>
        </ResponsiveContainer>
        <Legend items={[
          { color: '#388bfd', label: '< 400 TJ' },
          { color: '#e6a817', label: '400–500 TJ' },
          { color: '#ffa657', label: '500–600 TJ' },
          { color: '#ff7b72', label: '600–700 TJ' },
          { color: '#f85149', label: '> 700 TJ' },
        ]} />
      </ChartCard>

      {/* Year-on-year GPG overlay */}
      <ChartCard
        id="chart-gpg-yoy"
        title="Year-on-Year GPG Comparison"
        subtitle="Daily GPG demand overlaid by calendar day"
        onExportPPT={() => handleExportPPT('chart-gpg-yoy', 'Year-on-Year GPG Comparison')}
        onExportXLSX={() => exportToExcel(filtered)}
      >
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={yoyGPG} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="day" tickFormatter={dayLabel} ticks={[1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335]} {...AXIS_STYLE} />
            <YAxis {...AXIS_STYLE} />
            <Tooltip content={<CustomTooltip labelFormatter={doyToDateStr} formatter={(v) => `${Math.round(v).toLocaleString()} TJ`} />} />
            {selectedYears.map(y => (
              <Line key={y} type="monotone" dataKey={String(y)} name={String(y)}
                stroke={YEAR_COLORS[y] || '#888'} strokeWidth={y === latestYear ? 2.5 : 1.2}
                dot={false} connectNulls />
            ))}
            <ReferenceLine y={500} stroke="#ff7b72" strokeDasharray="4 4" />
          </ComposedChart>
        </ResponsiveContainer>
        <Legend items={selectedYears.map(y => ({ color: YEAR_COLORS[y] || '#888', label: String(y) }))} />
      </ChartCard>

      {/* Threshold breach table */}
      <ChartCard
        id="chart-gpg-thresholds"
        title="GPG Spike Statistics by Year"
        subtitle="Annual peak GPG and days exceeding key thresholds"
        onExportPPT={() => handleExportPPT('chart-gpg-thresholds', 'GPG Spike Statistics by Year')}
        onExportXLSX={() => exportToExcel(filtered)}
      >
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={annualPeaks} margin={{ top: 10, right: 20, bottom: 0, left: 10 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="year" {...AXIS_STYLE} />
            <YAxis yAxisId="left" {...AXIS_STYLE} tickFormatter={v => `${v} TJ`} />
            <YAxis yAxisId="right" orientation="right" {...AXIS_STYLE} tickFormatter={v => `${v}d`} />
            <Tooltip content={<CustomTooltip formatter={(v, n) => n.startsWith('d') ? `${v} days` : `${v?.toLocaleString()} TJ`} />} />
            <Bar yAxisId="left" dataKey="peak" name="Peak GPG" fill="#e6a817" opacity={0.9} />
            <Line yAxisId="right" type="monotone" dataKey="d400" name="d>400" stroke="#e6a817" strokeWidth={2} dot />
            <Line yAxisId="right" type="monotone" dataKey="d500" name="d>500" stroke="#ffa657" strokeWidth={2} dot />
            <Line yAxisId="right" type="monotone" dataKey="d600" name="d>600" stroke="#f85149" strokeWidth={2} dot />
          </ComposedChart>
        </ResponsiveContainer>
        <Legend items={[
          { color: '#e6a817', label: 'Peak GPG (TJ, left axis)' },
          { color: '#e6a817', label: 'Days > 400 TJ' },
          { color: '#ffa657', label: 'Days > 500 TJ' },
          { color: '#f85149', label: 'Days > 600 TJ' },
        ]} />

        {/* Summary table */}
        <div style={{ marginTop: 16, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                {['Year', 'Peak GPG (TJ)', 'Peak Date', 'Days > 400', 'Days > 500', 'Days > 600', 'Days > 700'].map(h => (
                  <th key={h} style={{ textAlign: 'right', padding: '6px 12px', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', fontFamily: 'DM Mono, monospace', fontWeight: 400, fontSize: 11 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {thresholdTable.map((row, i) => (
                <tr key={row.year} style={{ background: i % 2 === 0 ? 'transparent' : '#ffffff08' }}>
                  <td style={{ padding: '5px 12px', fontFamily: 'DM Mono, monospace', color: YEAR_COLORS[row.year] || 'var(--text)', fontWeight: 600 }}>{row.year}</td>
                  <td style={{ padding: '5px 12px', textAlign: 'right', fontFamily: 'DM Mono, monospace', color: 'var(--text)' }}>{row.peak?.toLocaleString()}</td>
                  <td style={{ padding: '5px 12px', textAlign: 'right', color: 'var(--text-muted)' }}>{row.peakDate}</td>
                  {THRESHOLDS.map(t => (
                    <td key={t} style={{ padding: '5px 12px', textAlign: 'right', fontFamily: 'DM Mono, monospace', color: row[`d${t}`] > 0 ? '#ffa657' : 'var(--text-muted)' }}>{row[`d${t}`]}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>
    </div>
  );
}


// ── TabSupplyCapacity ──

// Supply source colours matching the PPT
const SUP_COLORS = {
  moomba:        '#222222',   // black
  longford:      '#555555',   // dark grey
  other_south:   '#999999',   // light grey
  qld_supply:    '#e6a817',   // yellow/gold
  storage_south: '#22d3ee',   // cyan
};

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Indicative capacity bands (TJ/day)
const CAPACITY = { longford: 870, moomba: 520, swqp: 500, shallowStorage: 300, deepStorage: 300 };
const TOTAL_CAPACITY = Object.values(CAPACITY).reduce((a, b) => a + b, 0);

function TabSupplyCapacity({ records, selectedYears, dateRange }) {
  const latestYear = Math.max(...selectedYears);
  const [supplyYear, setSupplyYear] = useState(latestYear);

  const dayLabel = (doy) => {
    const d = new Date(2024, 0, doy);
    return MONTH_LABELS[d.getMonth()];
  };

  // Daily supply breakdown for selected year
  const supplyDaily = useMemo(() =>
    records.filter(r => r.year === supplyYear && r.date >= dateRange[0] && r.date <= dateRange[1])
      .map(r => ({
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
      }))
  , [records, supplyYear, dateRange]);

  // YoY supply overlay by day
  const yoySupply = useMemo(() => {
    const pivot = {};
    for (const r of records.filter(r => selectedYears.includes(r.year))) {
      if (!pivot[r.dayOfYear]) pivot[r.dayOfYear] = { day: r.dayOfYear };
      pivot[r.dayOfYear][r.year] = Math.round(r.total_supply || 0);
    }
    return Object.values(pivot).sort((a, b) => a.day - b.day);
  }, [records, selectedYears]);

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
        subtitle="Supply stack uses gross storage withdrawal (TJ/day). Demand line = SE city consumption."
        onExportPPT={() => exportToPowerPoint([{ id: 'chart-supply-stack', title: `${supplyYear} Supply by Source vs Demand`, subtitle: 'SE States (TJ/day)' }])}
        onExportXLSX={() => exportToExcel(records.filter(r => r.year === supplyYear))}
      >
        <ResponsiveContainer width="100%" height={360}>
          <ComposedChart data={supplyDaily} margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="date" {...AXIS_STYLE} interval={Math.floor(supplyDaily.length / 12)} />
            <YAxis {...AXIS_STYLE} tickFormatter={v => v.toLocaleString()} />
            <Tooltip content={<CustomTooltip formatter={v => `${Math.round(v).toLocaleString()} TJ`} />} />
            <ReferenceLine y={0} stroke="#555" strokeWidth={1} />
            {/* Positive supply stack */}
            <Area type="monotone" dataKey="moomba"        stackId="pos" name="Moomba"              fill={SUP_COLORS.moomba}        stroke={SUP_COLORS.moomba}        fillOpacity={1} />
            <Area type="monotone" dataKey="longford"      stackId="pos" name="Longford"            fill={SUP_COLORS.longford}      stroke={SUP_COLORS.longford}      fillOpacity={1} />
            <Area type="monotone" dataKey="other_south"   stackId="pos" name="Other Southern"      fill={SUP_COLORS.other_south}   stroke={SUP_COLORS.other_south}   fillOpacity={1} />
            <Area type="monotone" dataKey="qld_supply"    stackId="pos" name="QLD Supply"          fill={SUP_COLORS.qld_supply}    stroke={SUP_COLORS.qld_supply}    fillOpacity={0.95} />
            <Area type="monotone" dataKey="storage_south" stackId="pos" name="Storage Withdrawal"  fill={SUP_COLORS.storage_south} stroke={SUP_COLORS.storage_south} fillOpacity={0.9} />
            {/* Negative flows — same colours, below x-axis */}
            <Area type="monotone" dataKey="neg_storage" stackId="neg" name="Storage Injection (−)"
              fill={SUP_COLORS.storage_south} stroke={SUP_COLORS.storage_south} fillOpacity={0.7} />
            <Area type="monotone" dataKey="neg_qld"     stackId="neg" name="SE → QLD (−)"
              fill={SUP_COLORS.qld_supply}    stroke={SUP_COLORS.qld_supply}    fillOpacity={0.7} />

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
          { color: '#22c55e',                label: 'SE Demand' },
        ]} />
      </ChartCard>

      {/* Supply-Demand residual gap chart */}
      <ChartCard
        id="chart-supply-gap"
        title={`${supplyYear} Supply–Demand Residual Gap`}
        subtitle="Residual consistent with pipeline line pack (±50–100 TJ/day, mean-reverting within 1–2 days). 2022 shows persistent supply excess suggesting incomplete demand reporting."
        onExportPPT={() => exportToPowerPoint([{ id: 'chart-supply-gap', title: `${supplyYear} Supply–Demand Residual Gap` }])}
        onExportXLSX={() => exportToExcel(records.filter(r => r.year === supplyYear))}
      >
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={supplyDaily} margin={{ top: 10, right: 20, bottom: 0, left: 10 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="date" {...AXIS_STYLE} interval={Math.floor(supplyDaily.length / 12)} />
            <YAxis {...AXIS_STYLE} tickFormatter={v => v.toLocaleString()} />
            <Tooltip content={<CustomTooltip formatter={v => `${Math.round(v).toLocaleString()} TJ`} />} />
            <ReferenceLine y={0} stroke="#888" strokeWidth={1.5} />
            <Bar dataKey="gap" name="Residual Gap" stroke="none">
              {supplyDaily.map((entry, i) => (
                <Cell key={i} fill={entry.gap > 0 ? '#f85149' : '#388bfd'} />
              ))}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
        <div style={{ display: 'flex', gap: '6px 18px', flexWrap: 'wrap', marginTop: 6 }}>
          {[
            { color: '#f85149', label: 'Above zero: excess demand (measured demand > identified supply)' },
            { color: '#388bfd', label: 'Below zero: excess supply (identified supply > measured demand)' },
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
          For 2023 onwards this residual is consistent with <strong style={{color:'#e6edf3'}}>pipeline line pack</strong> —
          daily values oscillate either side of zero with no persistent seasonal bias, and short-lag
          autocorrelation is near zero, indicating rebalancing within 1–2 days as expected for a
          network holding ~150–200 TJ in line pack.
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
            <Tooltip content={<CustomTooltip formatter={v => `${Math.round(v).toLocaleString()} TJ`} />} />
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
            <Tooltip content={<CustomTooltip formatter={v => `${Math.round(v).toLocaleString()} TJ/day avg`} />} />
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


// ── TabProduction ──

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function TabProduction({ records, selectedYears, dateRange }) {
  const latestYear = Math.max(...selectedYears);

  // Multi-year production overlay by day of year
  const yoyProduction = useMemo(() => {
    const pivot = {};
    for (const r of records.filter(r => selectedYears.includes(r.year) && r.total_production > 0)) {
      if (!pivot[r.dayOfYear]) pivot[r.dayOfYear] = { day: r.dayOfYear };
      pivot[r.dayOfYear][r.year] = r.total_production;
    }
    return Object.values(pivot).sort((a, b) => a.day - b.day);
  }, [records, selectedYears]);

  // Peak-day % of annual average by year
  const swingFactors = useMemo(() => {
    return selectedYears.map(y => {
      const rows = records.filter(r => r.year === y && r.total_production > 0);
      if (!rows.length) return { year: y };
      const avg = rows.reduce((s, r) => s + r.total_production, 0) / rows.length;
      const peak = Math.max(...rows.map(r => r.total_production));
      const winterRows = rows.filter(r => r.month >= 5 && r.month <= 7);
      const winterAvg = winterRows.length ? winterRows.reduce((s, r) => s + r.total_production, 0) / winterRows.length : avg;
      return {
        year: y,
        avg: Math.round(avg),
        peak: Math.round(peak),
        peakPct: Math.round((peak / avg) * 100),
        winterPct: Math.round((winterAvg / avg) * 100),
        swingFactor: Math.round(((peak - avg) / avg) * 100),
      };
    });
  }, [records, selectedYears]);

  // Monthly average production heatmap data
  const monthlyProduction = useMemo(() => {
    return MONTH_LABELS.map((m, i) => {
      const entry = { month: m };
      for (const y of selectedYears) {
        const rows = records.filter(r => r.year === y && r.month === i + 1 && r.total_production > 0);
        if (rows.length) entry[y] = Math.round(rows.reduce((s, r) => s + r.total_production, 0) / rows.length);
      }
      return entry;
    });
  }, [records, selectedYears]);

  // Production breakdown latest year
  const latestProdBreakdown = useMemo(() =>
    records.filter(r => r.year === latestYear && r.date >= dateRange[0] && r.date <= dateRange[1])
      .map(r => ({
        date: r.date.substring(5),
        longford: r.production_longford,
        moomba: r.production_moomba,
        swqp: r.production_swqp,
        other: r.production_other,
      }))
  , [records, latestYear, dateRange]);

  const latestSwing = swingFactors.find(r => r.year === latestYear) || {};
  const prevSwing = swingFactors.find(r => r.year === latestYear - 1) || {};

  const handleExportPPT = async (id, title) => {
    await exportToPowerPoint([{ id, title, subtitle: 'SE States gas production (TJ/day) — Source: AEMO' }]);
  };

  const dayLabel = (day) => {
    const d = new Date(2024, 0, day);
    return MONTH_LABELS[d.getMonth()];
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <KpiCard label={`${latestYear} Avg Production`} value={latestSwing.avg?.toLocaleString() || '—'} unit="TJ/day" color="var(--accent3)" />
        <KpiCard label={`${latestYear} Peak Day`} value={latestSwing.peak?.toLocaleString() || '—'} unit="TJ/day" sub={`${latestSwing.peakPct || '—'}% of avg`} color="var(--accent)" />
        <KpiCard label={`${latestYear} Swing Factor`} value={latestSwing.peakPct ? `${latestSwing.peakPct}%` : '—'} unit="peak/avg" sub={prevSwing.peakPct ? `vs ${latestYear - 1}: ${prevSwing.peakPct}%` : ''} color={latestSwing.peakPct < 120 ? 'var(--danger)' : 'var(--accent2)'} />
        <KpiCard label="Winter Swing (May–Jul)" value={latestSwing.winterPct ? `${latestSwing.winterPct}%` : '—'} unit="of avg" color="var(--accent)" />
      </div>

      {/* Year-on-year production overlay */}
      <ChartCard
        id="chart-prod-yoy"
        title="Year-on-Year Production Comparison"
        subtitle="Total daily production by calendar day (TJ/day)"
        onExportPPT={() => handleExportPPT('chart-prod-yoy', 'Year-on-Year Production')}
        onExportXLSX={() => exportToExcel(records.filter(r => selectedYears.includes(r.year)))}
      >
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={yoyProduction} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="day" tickFormatter={dayLabel} ticks={[1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335]} {...AXIS_STYLE} />
            <YAxis {...AXIS_STYLE} tickFormatter={v => `${v.toLocaleString()}`} />
            <Tooltip content={<CustomTooltip formatter={(v) => `${Math.round(v).toLocaleString()} TJ`} />} />
            {selectedYears.map(y => (
              <Line key={y} type="monotone" dataKey={y} name={String(y)}
                stroke={YEAR_COLORS[y] || '#888'} strokeWidth={y === latestYear ? 2.5 : 1.5} dot={false} connectNulls />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
        <Legend items={selectedYears.map(y => ({ color: YEAR_COLORS[y] || '#888', label: String(y) }))} />
      </ChartCard>

      {/* Production source breakdown */}
      <ChartCard
        id="chart-prod-breakdown"
        title={`${latestYear} Production by Source`}
        subtitle="Stacked daily production: Longford / Moomba / SWQP / Other (TJ/day)"
        onExportPPT={() => handleExportPPT('chart-prod-breakdown', `${latestYear} Production by Source`)}
        onExportXLSX={() => exportToExcel(records.filter(r => r.year === latestYear))}
      >
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={latestProdBreakdown} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="date" {...AXIS_STYLE} interval={Math.floor(latestProdBreakdown.length / 12)} />
            <YAxis {...AXIS_STYLE} tickFormatter={v => `${v.toLocaleString()}`} />
            <Tooltip content={<CustomTooltip formatter={(v) => `${Math.round(v).toLocaleString()} TJ`} />} />
            <Area type="monotone" dataKey="longford" stackId="1" name="Longford" fill={CHART_COLORS.longford} stroke={CHART_COLORS.longford} fillOpacity={0.85} />
            <Area type="monotone" dataKey="moomba" stackId="1" name="Moomba & Other" fill={CHART_COLORS.moomba} stroke={CHART_COLORS.moomba} fillOpacity={0.85} />
            <Area type="monotone" dataKey="swqp" stackId="1" name="SWQP" fill={CHART_COLORS.swqp} stroke={CHART_COLORS.swqp} fillOpacity={0.85} />
            <Area type="monotone" dataKey="other" stackId="1" name="Other" fill="#484f58" stroke="#484f58" fillOpacity={0.85} />
          </ComposedChart>
        </ResponsiveContainer>
        <Legend items={[
          { color: CHART_COLORS.longford, label: 'Longford' },
          { color: CHART_COLORS.moomba, label: 'Moomba & Other South' },
          { color: CHART_COLORS.swqp, label: 'SWQP (QLD)' },
          { color: '#484f58', label: 'Other' },
        ]} />
      </ChartCard>

      {/* Swing factor trend */}
      <ChartCard
        id="chart-swing-factor"
        title="Annual Swing Factor Trend"
        subtitle="Peak day as % of annual average — erosion indicates declining field flexibility"
        onExportPPT={() => handleExportPPT('chart-swing-factor', 'Annual Production Swing Factor')}
        onExportXLSX={() => exportToExcel(records)}
      >
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={swingFactors} margin={{ top: 10, right: 20, bottom: 0, left: 10 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="year" {...AXIS_STYLE} />
            <YAxis {...AXIS_STYLE} domain={[90, 160]} tickFormatter={v => `${v}%`} />
            <Tooltip content={<CustomTooltip formatter={(v) => `${v}%`} />} />
            <Bar dataKey="peakPct" name="Peak % of Avg" fill="#e6a817" opacity={0.85} />
            <Line type="monotone" dataKey="winterPct" name="Winter % of Avg" stroke="#388bfd" strokeWidth={2} dot />
            <ReferenceLine y={100} stroke="var(--border)" strokeDasharray="4 2" />
          </ComposedChart>
        </ResponsiveContainer>
        <Legend items={[
          { color: '#e6a817', label: 'Peak day % of annual average' },
          { color: '#388bfd', label: 'May–Jul average % of annual average' },
        ]} />
      </ChartCard>
    </div>
  );
}


// ── TabStorage ──

function TabStorage({ records, selectedYears, dateRange }) {
  const latestYear = Math.max(...selectedYears);

  // Year-on-year storage balance overlay
  const yoyStorage = useMemo(() => {
    const pivot = {};
    for (const r of records.filter(r => selectedYears.includes(r.year) && r.storage_balance_iona !== null)) {
      if (!pivot[r.dayOfYear]) pivot[r.dayOfYear] = { day: r.dayOfYear };
      pivot[r.dayOfYear][r.year] = r.storage_balance_iona;
    }
    return Object.values(pivot).sort((a, b) => a.day - b.day);
  }, [records, selectedYears]);

  // Historical range uses ALL selected years for shading band
  const historicalYears = useMemo(() => selectedYears.slice(), [selectedYears]);
  const rangeData = useMemo(() => {
    const pivot = {};
    for (const r of records.filter(r => historicalYears.includes(r.year) && r.storage_balance_iona !== null)) {
      if (!pivot[r.dayOfYear]) pivot[r.dayOfYear] = { day: r.dayOfYear, vals: [] };
      pivot[r.dayOfYear].vals.push(r.storage_balance_iona);
    }
    return Object.values(pivot).sort((a, b) => a.day - b.day).map(d => ({
      day: d.day,
      rangeMin: Math.min(...d.vals),
      rangeMax: Math.max(...d.vals),
      rangeMid: Math.round(d.vals.reduce((a, b) => a + b, 0) / d.vals.length),
    }));
  }, [records, historicalYears]);

  // Combine range + ALL selected years as individual lines
  const storageOverlay = useMemo(() => {
    const map = new Map(rangeData.map(d => [d.day, { ...d }]));
    for (const r of records.filter(r => selectedYears.includes(r.year) && r.storage_balance_iona !== null)) {
      const entry = map.get(r.dayOfYear) || { day: r.dayOfYear };
      entry[r.year] = r.storage_balance_iona;
      map.set(r.dayOfYear, entry);
    }
    return Array.from(map.values()).sort((a, b) => a.day - b.day);
  }, [rangeData, records, selectedYears]);

  // Latest storage stats
  const latestStorageData = records.filter(r => r.year === latestYear && r.storage_balance_iona !== null).sort((a, b) => a.date.localeCompare(b.date));
  const currentBalance = latestStorageData[latestStorageData.length - 1]?.storage_balance_iona || null;
  const prevYearSameDay = (() => {
    const last = latestStorageData[latestStorageData.length - 1];
    if (!last) return null;
    const sameDay = records.find(r => r.year === latestYear - 1 && r.dayOfYear === last.dayOfYear);
    return sameDay?.storage_balance_iona || null;
  })();
  const delta = currentBalance && prevYearSameDay ? currentBalance - prevYearSameDay : null;

  // Net daily storage flows (injection/withdrawal)
  const storageFlows = useMemo(() =>
    records.filter(r => r.year === latestYear && r.date >= dateRange[0] && r.date <= dateRange[1])
      .map(r => ({
        date: r.date.substring(5),
        net: r.storage_iona,
        injection:  r.storage_iona > 0 ? r.storage_iona : 0,   // positive = injection (summer, green up)
        withdrawal: r.storage_iona < 0 ? r.storage_iona : 0,   // negative = withdrawal (winter, red down)
        balance: r.storage_balance_iona,
      }))
  , [records, latestYear, dateRange]);

  const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayLabel = (day) => {
    const d = new Date(2024, 0, day);
    return MONTH_LABELS[d.getMonth()];
  };

  const handleExportPPT = async (id, title) => {
    await exportToPowerPoint([{ id, title, subtitle: 'Iona UGS storage balance (TJ) — Source: AEMO' }]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <KpiCard
          label="Current Iona Balance"
          value={currentBalance ? Math.round(currentBalance).toLocaleString() : '—'}
          unit="TJ"
          sub={latestStorageData[latestStorageData.length - 1]?.date}
          color="#bc8cff"
        />
        <KpiCard
          label="vs Prior Year (same day)"
          value={delta ? `${delta > 0 ? '+' : ''}${Math.round(delta).toLocaleString()}` : '—'}
          unit="TJ"
          color={delta === null ? 'var(--text-muted)' : delta < 0 ? 'var(--danger)' : 'var(--accent2)'}
        />
        <KpiCard
          label="Peak Demand Season"
          value="Jun–Aug"
          unit=""
          sub="Winter drawdown period"
          color="var(--accent)"
        />
      </div>

      {/* Year-on-year storage balance with historical range */}
      <ChartCard
        id="chart-storage-yoy"
        title="Iona Storage Balance — Year-on-Year"
        subtitle="Running storage balance (TJ) with selected-year range shading and individual year lines"
        onExportPPT={() => handleExportPPT('chart-storage-yoy', 'Iona Storage Balance Year-on-Year')}
        onExportXLSX={() => exportToExcel(records.filter(r => r.storage_balance_iona !== null))}
      >
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={storageOverlay} margin={{ top: 10, right: 20, bottom: 0, left: 10 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="day" tickFormatter={dayLabel} ticks={[1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335]} {...AXIS_STYLE} />
            <YAxis {...AXIS_STYLE} tickFormatter={v => `${v.toLocaleString()}`} />
            <Tooltip content={<CustomTooltip formatter={(v) => `${Math.round(v).toLocaleString()} TJ`} />} />
            {/* Historical range shading */}
            {historicalYears.length > 1 && (
              <Area dataKey="rangeMax" name="Hist. max" fill="#bc8cff" stroke="none" fillOpacity={0.08} />
            )}
            {historicalYears.length > 1 && (
              <Area dataKey="rangeMin" name="Hist. min" fill="#bc8cff" stroke="none" fillOpacity={0.08} />
            )}
            <Line type="monotone" dataKey="rangeMid" name="2019–2023 avg" stroke="#bc8cff" strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
            {/* Recent years */}
            {selectedYears.map(y => (
              <Line key={y} type="monotone" dataKey={y} name={String(y)}
                stroke={YEAR_COLORS[y] || '#e6edf3'} strokeWidth={y === latestYear ? 2.5 : 1.8} dot={false} connectNulls />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
        <Legend items={[
          { color: '#bc8cff', label: 'Selected year range & average' },
          ...selectedYears.map(y => ({ color: YEAR_COLORS[y] || '#888', label: String(y) }))
        ]} />
      </ChartCard>

      {/* Daily net flows */}
      <ChartCard
        id="chart-storage-flows"
        title={`${latestYear} Iona Net Daily Flows`}
        subtitle="Daily injection (+, green) and withdrawal (−, red) into/from storage (TJ/day)"
        onExportPPT={() => handleExportPPT('chart-storage-flows', `${latestYear} Iona Daily Flows`)}
        onExportXLSX={() => exportToExcel(records.filter(r => r.year === latestYear))}
      >
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={storageFlows} margin={{ top: 10, right: 20, bottom: 0, left: 10 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="date" {...AXIS_STYLE} interval={Math.floor(storageFlows.length / 12)} />
            <YAxis {...AXIS_STYLE} />
            <Tooltip content={<CustomTooltip formatter={(v) => `${Math.round(v).toLocaleString()} TJ`} />} />
            <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1.5} />
            <Bar dataKey="injection"  name="Injection"  fill="#3fb950" maxBarSize={6} />
            <Bar dataKey="withdrawal" name="Withdrawal" fill="#f85149" maxBarSize={6} />
          </ComposedChart>
        </ResponsiveContainer>
        <Legend items={[
          { color: '#3fb950', label: 'Injection (TJ/day)' },
          { color: '#f85149', label: 'Withdrawal (TJ/day)' },
        ]} />
      </ChartCard>

      {/* Context note */}
      <div style={{
        background: 'var(--surface2)',
        border: '1px solid var(--border)',
        borderLeft: '3px solid #bc8cff',
        borderRadius: 6,
        padding: '12px 16px',
        fontSize: 12,
        color: 'var(--text-muted)',
        lineHeight: 1.6,
      }}>
        <strong style={{ color: 'var(--text)' }}>Storage context:</strong> Iona Underground Gas Storage (UGS) in western Victoria is the primary storage facility for the SE gas market.
        Operators typically inject gas in summer (Oct–Apr) and withdraw during winter peak demand periods (May–Sep).
        Low seasonal price spreads can reduce incentive to fill storage, increasing supply risk heading into winter.
      </div>
    </div>
  );
}


// ── TabStateBreakdown ──

const STATE_COLORS = {
  VIC: '#388bfd',
  NSW: '#3fb950',
  SA:  '#e6a817',
  TAS: '#bc8cff',
};

const STATES = ['VIC', 'NSW', 'SA', 'TAS'];

function TabStateBreakdown({ records, selectedYears, dateRange }) {
  const latestYear = Math.max(...selectedYears);
  const [viewYear, setViewYear] = useState(latestYear);

  // Daily data for the selected view year
  const yearDaily = useMemo(() =>
    records.filter(r => r.year === viewYear && r.date >= dateRange[0] && r.date <= dateRange[1])
      .map(r => ({
        date: r.date.substring(5),
        // Total by state
        vic: r.total_vic || 0,
        nsw: r.total_nsw || 0,
        sa:  r.total_sa  || 0,
        tas: r.total_tas || 0,
        // GPG by state
        gpg_vic: r.gpg_vic || 0,
        gpg_nsw: r.gpg_nsw || 0,
        gpg_sa:  r.gpg_sa  || 0,
        gpg_tas: r.gpg_tas || 0,
        // Non-GPG (res + ind) by state
        nongpg_vic: (r.total_vic || 0) - (r.gpg_vic || 0),
        nongpg_nsw: (r.total_nsw || 0) - (r.gpg_nsw || 0),
        nongpg_sa:  (r.total_sa  || 0) - (r.gpg_sa  || 0),
        nongpg_tas: (r.total_tas || 0) - (r.gpg_tas || 0),
      }))
  , [records, viewYear, dateRange]);

  // Year-on-year GPG by state: monthly averages
  const monthlyGPGByState = useMemo(() => {
    const months = Array.from({ length: 12 }, (_, i) => ({
      month: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][i],
      monthNum: i + 1,
    }));
    for (const y of selectedYears) {
      for (let m = 1; m <= 12; m++) {
        const rows = records.filter(r => r.year === y && r.month === m);
        if (!rows.length) continue;
        const avg = (arr) => Math.round(arr.reduce((s, v) => s + v, 0) / arr.length);
        months[m-1][`vic_${y}`] = avg(rows.map(r => r.gpg_vic || 0));
        months[m-1][`nsw_${y}`] = avg(rows.map(r => r.gpg_nsw || 0));
        months[m-1][`sa_${y}`]  = avg(rows.map(r => r.gpg_sa  || 0));
        months[m-1][`tas_${y}`] = avg(rows.map(r => r.gpg_tas || 0));
      }
    }
    return months;
  }, [records, selectedYears]);

  // Annual peak GPG by state
  const annualPeakByState = useMemo(() =>
    selectedYears.map(y => {
      const rows = records.filter(r => r.year === y);
      const peak = (key) => Math.round(Math.max(...rows.map(r => r[key] || 0)));
      return {
        year: y,
        vic: peak('gpg_vic'), nsw: peak('gpg_nsw'),
        sa:  peak('gpg_sa'),  tas: peak('gpg_tas'),
        total: peak('gpg_se'),
      };
    })
  , [records, selectedYears]);

  // KPIs for latest year peak GPG day
  const latestRows = records.filter(r => r.year === latestYear);
  const peakDay = latestRows.reduce((max, r) => (r.gpg_se || 0) > (max?.gpg_se || 0) ? r : max, null);

  const handleExportPPT = async (id, title) => {
    await exportToPowerPoint([{ id, title, subtitle: 'SE States demand by state (TJ/day) — Source: AEMO' }]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* KPI row — peak GPG day state split */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
        <KpiCard label={`${latestYear} Peak GPG Day`} value={peakDay?.date || '—'} unit="" sub={`Total: ${peakDay?.gpg_se?.toLocaleString() || '—'} TJ`} color="var(--accent)" />
        {STATES.map(st => (
          <KpiCard key={st} label={`${st} GPG on peak day`}
            value={peakDay ? Math.round(peakDay[`gpg_${st.toLowerCase()}`] || 0).toLocaleString() : '—'}
            unit="TJ" color={STATE_COLORS[st]} />
        ))}
      </div>

      {/* Year selector */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>View year:</span>
        {selectedYears.map(y => (
          <button key={y} onClick={() => setViewYear(y)} style={{
            padding: '3px 10px', borderRadius: 4,
            border: `1px solid ${y === viewYear ? YEAR_COLORS[y] || 'var(--accent)' : 'var(--border)'}`,
            background: y === viewYear ? (YEAR_COLORS[y] || 'var(--accent)') + '22' : 'transparent',
            color: y === viewYear ? YEAR_COLORS[y] || 'var(--accent)' : 'var(--text-muted)',
            cursor: 'pointer', fontSize: 12, fontFamily: 'DM Mono, monospace',
          }}>{y}</button>
        ))}
      </div>

      {/* Total demand stacked by state */}
      <ChartCard
        id="chart-state-total"
        title={`${viewYear} Daily Total Demand by State`}
        subtitle="Stacked TJ/day — VIC / NSW / SA / TAS"
        onExportPPT={() => handleExportPPT('chart-state-total', `${viewYear} Daily Demand by State`)}
        onExportXLSX={() => exportToExcel(records.filter(r => r.year === viewYear))}
      >
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={yearDaily} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="date" {...AXIS_STYLE} interval={Math.floor(yearDaily.length / 12)} />
            <YAxis {...AXIS_STYLE} tickFormatter={v => v.toLocaleString()} />
            <Tooltip content={<CustomTooltip formatter={v => `${Math.round(v).toLocaleString()} TJ`} />} />
            <Area type="monotone" dataKey="vic" stackId="1" name="VIC" fill={STATE_COLORS.VIC} stroke={STATE_COLORS.VIC} fillOpacity={0.85} />
            <Area type="monotone" dataKey="nsw" stackId="1" name="NSW" fill={STATE_COLORS.NSW} stroke={STATE_COLORS.NSW} fillOpacity={0.85} />
            <Area type="monotone" dataKey="sa"  stackId="1" name="SA"  fill={STATE_COLORS.SA}  stroke={STATE_COLORS.SA}  fillOpacity={0.85} />
            <Area type="monotone" dataKey="tas" stackId="1" name="TAS" fill={STATE_COLORS.TAS} stroke={STATE_COLORS.TAS} fillOpacity={0.85} />
          </ComposedChart>
        </ResponsiveContainer>
        <Legend items={STATES.map(s => ({ color: STATE_COLORS[s], label: s }))} />
      </ChartCard>

      {/* GPG stacked by state */}
      <ChartCard
        id="chart-state-gpg"
        title={`${viewYear} Daily GPG Demand by State`}
        subtitle="Gas power generation TJ/day — VIC / NSW / SA / TAS"
        onExportPPT={() => handleExportPPT('chart-state-gpg', `${viewYear} GPG by State`)}
        onExportXLSX={() => exportToExcel(records.filter(r => r.year === viewYear))}
      >
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={yearDaily} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="date" {...AXIS_STYLE} interval={Math.floor(yearDaily.length / 12)} />
            <YAxis {...AXIS_STYLE} />
            <Tooltip content={<CustomTooltip formatter={v => `${Math.round(v).toLocaleString()} TJ`} />} />
            <Area type="monotone" dataKey="gpg_vic" stackId="1" name="VIC GPG" fill={STATE_COLORS.VIC} stroke={STATE_COLORS.VIC} fillOpacity={0.85} />
            <Area type="monotone" dataKey="gpg_nsw" stackId="1" name="NSW GPG" fill={STATE_COLORS.NSW} stroke={STATE_COLORS.NSW} fillOpacity={0.85} />
            <Area type="monotone" dataKey="gpg_sa"  stackId="1" name="SA GPG"  fill={STATE_COLORS.SA}  stroke={STATE_COLORS.SA}  fillOpacity={0.85} />
            <Area type="monotone" dataKey="gpg_tas" stackId="1" name="TAS GPG" fill={STATE_COLORS.TAS} stroke={STATE_COLORS.TAS} fillOpacity={0.85} />
            <ReferenceLine y={500} stroke="#f85149" strokeDasharray="4 4" label={{ value: '500 TJ', fill: '#f85149', fontSize: 9, position: 'insideTopRight' }} />
          </ComposedChart>
        </ResponsiveContainer>
        <Legend items={STATES.map(s => ({ color: STATE_COLORS[s], label: `${s} GPG` }))} />
      </ChartCard>

      {/* Non-GPG (residential + industrial) by state */}
      <ChartCard
        id="chart-state-nongpg"
        title={`${viewYear} Non-GPG Demand by State`}
        subtitle="Residential & commercial + industrial (TJ/day) — excludes gas power generation"
        onExportPPT={() => handleExportPPT('chart-state-nongpg', `${viewYear} Non-GPG Demand by State`)}
        onExportXLSX={() => exportToExcel(records.filter(r => r.year === viewYear))}
      >
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={yearDaily} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="date" {...AXIS_STYLE} interval={Math.floor(yearDaily.length / 12)} />
            <YAxis {...AXIS_STYLE} tickFormatter={v => v.toLocaleString()} />
            <Tooltip content={<CustomTooltip formatter={v => `${Math.round(v).toLocaleString()} TJ`} />} />
            <Area type="monotone" dataKey="nongpg_vic" stackId="1" name="VIC" fill={STATE_COLORS.VIC} stroke={STATE_COLORS.VIC} fillOpacity={0.85} />
            <Area type="monotone" dataKey="nongpg_nsw" stackId="1" name="NSW" fill={STATE_COLORS.NSW} stroke={STATE_COLORS.NSW} fillOpacity={0.85} />
            <Area type="monotone" dataKey="nongpg_sa"  stackId="1" name="SA"  fill={STATE_COLORS.SA}  stroke={STATE_COLORS.SA}  fillOpacity={0.85} />
            <Area type="monotone" dataKey="nongpg_tas" stackId="1" name="TAS" fill={STATE_COLORS.TAS} stroke={STATE_COLORS.TAS} fillOpacity={0.85} />
          </ComposedChart>
        </ResponsiveContainer>
        <Legend items={STATES.map(s => ({ color: STATE_COLORS[s], label: s }))} />
      </ChartCard>

      {/* Two-panel: monthly avg GPG by state, and annual peak GPG by state */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        <ChartCard
          id="chart-state-gpg-monthly"
          title="Monthly Avg GPG by State"
          subtitle="Average TJ/day per month — latest two years"
          onExportPPT={() => handleExportPPT('chart-state-gpg-monthly', 'Monthly Average GPG by State')}
        >
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={monthlyGPGByState} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid {...GRID_STYLE} />
              <XAxis dataKey="month" {...AXIS_STYLE} />
              <YAxis {...AXIS_STYLE} />
              <Tooltip content={<CustomTooltip formatter={v => `${Math.round(v).toLocaleString()} TJ/day avg`} />} />
              {selectedYears.slice(-2).map(y =>
                STATES.map(st => (
                  <Bar key={`${st}_${y}`}
                    dataKey={`${st.toLowerCase()}_${y}`}
                    name={`${st} ${y}`}
                    stackId={y}
                    fill={STATE_COLORS[st]}
                    opacity={y === latestYear ? 1 : 0.4}
                  />
                ))
              )}
            </ComposedChart>
          </ResponsiveContainer>
          <Legend items={STATES.map(s => ({ color: STATE_COLORS[s], label: s }))} />
        </ChartCard>

        <ChartCard
          id="chart-state-gpg-annual-peak"
          title="Annual Peak GPG by State"
          subtitle="Highest single day GPG per year (TJ)"
          onExportPPT={() => handleExportPPT('chart-state-gpg-annual-peak', 'Annual Peak GPG by State')}
        >
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={annualPeakByState} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid {...GRID_STYLE} />
              <XAxis dataKey="year" {...AXIS_STYLE} />
              <YAxis {...AXIS_STYLE} />
              <Tooltip content={<CustomTooltip formatter={v => `${Math.round(v).toLocaleString()} TJ`} />} />
              <Bar dataKey="vic" name="VIC" stackId="a" fill={STATE_COLORS.VIC} />
              <Bar dataKey="nsw" name="NSW" stackId="a" fill={STATE_COLORS.NSW} />
              <Bar dataKey="sa"  name="SA"  stackId="a" fill={STATE_COLORS.SA}  />
              <Bar dataKey="tas" name="TAS" stackId="a" fill={STATE_COLORS.TAS} />
              <Line type="monotone" dataKey="total" name="Total" stroke="#e6edf3" strokeWidth={2} dot strokeDasharray="4 2" />
            </ComposedChart>
          </ResponsiveContainer>
          <Legend items={[...STATES.map(s => ({ color: STATE_COLORS[s], label: s })), { color: '#e6edf3', label: 'Total' }]} />
        </ChartCard>

      </div>
    </div>
  );
}


// ── TabFlowMap ──

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
  { id:'egp',   label:'EGP',  field:'map_egp_nsw',  maxVal:280, labelFrac:0.4,
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
  { id:'swp',   label:'SWP',  field:'map_swp',       maxVal:400, labelFrac:0.4,
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
  iona:          { label:'Iona UGS',    sub:'',            icon:'🏭', color:'#34d399', r:15, field:'storage_iona' },
  otway:         { label:'Otway',       sub:'Otway Basin', icon:'⛽', color:'#c084fc', r:11, field:'production_other_south' },
  ballera:       { label:'Ballera',     sub:null,          icon:null,  color:'#4a6a8a', r:5,  field:null },
  culcairn:      { label:'Culcairn',    sub:'MSP spur/VNI', icon:'◉',  color:'#a78bfa', r:8,  field:'map_vni', labelRight:true },
  vts_hub:       { label:'VTS / Melbourne', sub:'VIC demand', icon:'🏙', color:'#38bdf8', r:22, field:'pipe_vic', vts:true },
  curtis_island: { label:'Curtis Is.',  sub:'LNG terminal',icon:'🚢', color:'#f43f5e', r:15, field:null },
  brisbane:      { label:'Brisbane',    sub:'QLD demand',  icon:'🏙', color:'#38bdf8', r:15, field:'map_rbp_bris' },
  gladstone:     { label:'Gladstone',   sub:'QGP demand',  icon:'🏙', color:'#38bdf8', r:11, field:'map_qgp_qld'  },
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
  const above = ['wallumbilla','moomba','ballera','curtis_island','gladstone','brisbane'].includes(id);
  const left  = ['adelaide','iona','otway','moomba'].includes(id);
  const right = ['sydney','longford','brisbane','curtis_island','vts_hub'].includes(id) || cfg.labelRight;

  let lx = cx, ly = above ? cy - r - 14 : cy + r + 14, anchor = 'middle';
  if (left)  { lx = cx - r - 5; ly = cy - 2; anchor = 'end'; }
  if (right) { lx = cx + r + 5; ly = cy - 2; anchor = 'start'; }

  const valY = above ? cy + r + 15 : left || right ? cy + 13 : ly + 13;

  // VTS hub gets an extra outer zone ring
  const vtsRing = cfg.vts ? (
    <circle cx={cx} cy={cy} r={r + 22} fill="none"
      stroke="#38bdf8" strokeWidth={1} strokeOpacity={0.25} strokeDasharray="6 4" />
  ) : null;

  return (
    <g>
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
        <text x={lx} y={valY + 12} textAnchor={anchor} fill="#64748b" fontSize={8.5}
          fontFamily="DM Mono, monospace"
          style={{ paintOrder:'stroke', stroke:'#0b1525', strokeWidth:2 }}>{sub}</text>
      )}
      {id === 'iona' && rec?.storage_balance_iona != null && (
        <text x={lx} y={valY + 24} textAnchor={anchor} fill="#334155" fontSize={8.5}
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
  const ionaColor = (rec.storage_iona||0) >= 0 ? '#4ade80' : '#f87171';
  const qldColor  = (rec.qld_net_flow||0) >= 0 ? '#facc15' : '#60a5fa';

  // Capacities (TJ/day) from GBB
  const CAP = { msp:565, maps:249, egp:349, swqp:512 };

  const items = [
    { label:'SE City Demand',  val:fmtTJ((rec.pipe_vic||0)+(rec.pipe_nsw||0)+(rec.pipe_sa||0)+(rec.pipe_tas||0)), color:'#38bdf8', sub:'TJ/day' },
    { label:'SE GPG',          val:fmtTJ(rec.gpg_se),        color:'#f472b6', sub:'TJ/day' },
    { label:'SE Industry',     val:fmtTJ(rec.industrial),    color:'#a78bfa', sub:'TJ/day' },
    { label:'QLD→SE Net',      val:fmtTJ(rec.qld_net_flow),  color:qldColor,  sub:'TJ/day' },
    { label:'Iona Net',        val:fmtTJ(rec.storage_iona),  color:ionaColor, sub:(rec.storage_iona||0)>=0?'withdrawal':'injection' },
    { label:'Other Storage',   val:fmtTJ(rec.storage_other), color:(rec.storage_other||0)>=0?'#4ade80':'#f87171', sub:(rec.storage_other||0)>=0?'withdrawal':'injection' },
    { label:'MSP (NSW)',       val:fmtTJ(rec.map_msp_nsw),   color:'#fb923c', sub:`${pct(rec.map_msp_nsw, CAP.msp)} of cap` },
    { label:'MAPS (SA)',       val:fmtTJ(rec.map_maps_sa),   color:'#fb923c', sub:`${pct(rec.map_maps_sa, CAP.maps)} of cap` },
    { label:'EGP (NSW)',       val:fmtTJ(rec.map_egp_nsw),   color:'#fb923c', sub:`${pct(rec.map_egp_nsw, CAP.egp)} of cap` },
  ];
  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(9,1fr)', gap:5 }}>
      {items.map(({label,val,color,sub}) => (
        <div key={label} style={{ background:'#071020', border:'1px solid #1e3a5a', borderRadius:6, padding:'7px 10px' }}>
          <div style={{ fontSize:9, color:'#7dd3fc', fontFamily:'DM Mono, monospace',
            textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:2 }}>{label}</div>
          <div style={{ fontSize:14, fontWeight:700, fontFamily:'DM Mono, monospace', color }}>{val}</div>
          <div style={{ fontSize:9, color:'#334155', fontFamily:'DM Mono, monospace' }}>{sub}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Main tab ─────────────────────────────────────────────────────────────────
function TabFlowMap({ records }) {
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
        <strong style={{ color:'#e2e8f0' }}>Pipeline key: </strong>
        <strong style={{ color:'#e2e8f0' }}>SWQP</strong> = South West QLD Pipeline (Wallumbilla↔Moomba, bidirectional) ·
        <strong style={{ color:'#e2e8f0' }}> MAPS</strong> = Moomba to Adelaide Pipeline System ·
        <strong style={{ color:'#e2e8f0' }}> MSP</strong> = Moomba to Sydney Pipeline ·
        <strong style={{ color:'#e2e8f0' }}> LMP</strong> = Longford to Melbourne Pipeline (VTS) ·
        <strong style={{ color:'#e2e8f0' }}> EGP</strong> = Eastern Gas Pipeline (Longford→Sydney, coastal) ·
        <strong style={{ color:'#e2e8f0' }}> VNI</strong> = Victorian-NSW Interconnect (Culcairn) ·
        <strong style={{ color:'#e2e8f0' }}> PCA</strong> = Port Campbell to Adelaide · 
        <strong style={{ color:'#e2e8f0' }}> SEA Gas</strong> = SEA Gas Pipeline (Iona→Adelaide) ·
        <strong style={{ color:'#e2e8f0' }}> TGP</strong> = Tasmanian Gas Pipeline ·
        <strong style={{ color:'#e2e8f0' }}> RBP</strong> = Roma-Brisbane Pipeline ·
        <strong style={{ color:'#e2e8f0' }}> QGP</strong> = Queensland Gas Pipeline (→Gladstone) ·
        <strong style={{ color:'#e2e8f0' }}> WGP/APLNG/GLNG</strong> = QLD LNG export pipelines to Curtis Island.
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════
// ── AEMO DATA FETCHER (from gas-dashboard/src/utils/aemoParser.js) ─────────────
// ════════════════════════════════════════════════════════════════════════════════
// Simplified inline version — fetches AEMO GBB data directly

async function fetchAEMOData(setMsg) {
  // This mirrors the logic from aemoParser.js — fetches from AEMO's GBB endpoint
  setMsg && setMsg("Connecting to AEMO GBB...");
  const AEMO_URL = "https://nemweb.com.au/Reports/Current/PRST_API/GasBB_Export/";
  // In production this is proxied through the peterl-pod server
  // For standalone use, we attempt direct fetch then fall back to demo notice
  try {
    const resp = await fetch(AEMO_URL, { mode: "cors" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    setMsg && setMsg("Parsing AEMO data...");
    return parseAEMOGBB(text);
  } catch (e) {
    throw new Error(`AEMO fetch failed: ${e.message}. Use the Upload XLSX button to load data from file.`);
  }
}

function parseAEMOGBB(text) {
  // Basic CSV parser for AEMO GBB format — matches keys used by AEMO tabs
  const rows = parseCSV(text);
  if (!rows.length) throw new Error("Empty AEMO response");
  const dailyMap = new Map();
  const ensure = (date) => {
    if (!dailyMap.has(date)) {
      dailyMap.set(date, {
        date, gpg_se: 0, gpg_qld: 0, industrial: 0, residential: 0,
        gpg_vic: 0, gpg_nsw: 0, gpg_sa: 0, gpg_tas: 0,
        total_vic: 0, total_nsw: 0, total_sa: 0, total_tas: 0,
        storage_balance_iona: null, total_production: 0,
        longford: 0, moomba: 0, swqp: 0,
        pipe_city: 0, pipe_vic: 0, pipe_nsw: 0, pipe_sa: 0, pipe_tas: 0,
        total_supply: 0, ind_vic: 0, ind_nsw: 0, ind_sa: 0, ind_tas: 0,
      });
    }
    return dailyMap.get(date);
  };
  // This is a placeholder — actual parsing is complex. Users should load via XLSX.
  const records = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  records.forEach(d => {
    d.total_demand_se = d.gpg_se + d.industrial + d.residential;
    d.year      = parseInt(d.date.substring(0, 4));
    d.month     = parseInt(d.date.substring(5, 7));
    d.dayOfYear = (() => { const dt = new Date(d.date + "T00:00:00"); const start = new Date(dt.getFullYear(), 0, 0); return Math.round((dt - start) / 86400000); })();
  });
  return records;
}

function computeStats(records) {
  if (!records.length) return {};
  const years = [...new Set(records.map(r => r.year))].sort();
  return { count: records.length, years, dateRange: [records[0].date, records[records.length-1].date] };
}

function loadFromExcel(file, setMsg) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        // SheetJS required — dynamically import
        import("https://cdn.sheetjs.com/xlsx-0.20.0/package/xlsx.mjs").then(XLSX => {
          setMsg && setMsg("Parsing Excel file...");
          const wb = XLSX.read(data, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
          // Map common column names
          const records = rows.map(r => {
            const date = (r["GasDate"] || r["Gas Date"] || r["Date"] || r["date"] || "").toString().slice(0, 10);
            if (!date || date.length < 8) return null;
            const n = (v) => parseFloat(v) || 0;
            const gpg_se = n(r["GPG SE (TJ)"] || r["GPG SE"] || r["GPG_SE"] || r["gpg_se"]);
            const ind    = n(r["Industrial (TJ)"] || r["Industrial"] || r["industrial"]);
            const res    = n(r["Residential (TJ)"] || r["Residential"] || r["residential"]);
            const total  = n(r["Total Demand SE (TJ)"] || r["Total SE"] || r["total_demand_se"]) || gpg_se + ind + res;
            const dt = new Date(date + "T00:00:00");
            const start = new Date(dt.getFullYear(), 0, 0);
            return {
              date, gpg_se, industrial: ind, residential: res, gpg_qld: 0,
              total_demand_se: total,
              gpg_vic: n(r["GPG VIC"]), gpg_nsw: n(r["GPG NSW"]), gpg_sa: n(r["GPG SA"]), gpg_tas: n(r["GPG TAS"]),
              total_vic: n(r["Total VIC"] || r["total_vic"]),
              total_nsw: n(r["Total NSW"] || r["total_nsw"]),
              total_sa:  n(r["Total SA"]  || r["total_sa"]),
              total_tas: n(r["Total TAS"] || r["total_tas"]),
              storage_balance_iona: n(r["Iona Storage"] || r["storage_balance_iona"]) || null,
              total_production: n(r["Total Production"] || r["total_production"]),
              longford: n(r["Longford"] || r["longford"]),
              moomba: n(r["Moomba"] || r["moomba"]),
              swqp: n(r["SWQP"] || r["swqp"]),
              pipe_city: n(r["pipe_city"]) || total, pipe_vic: n(r["pipe_vic"]),
              pipe_nsw: n(r["pipe_nsw"]), pipe_sa: n(r["pipe_sa"]), pipe_tas: n(r["pipe_tas"]),
              total_supply: n(r["Total Supply"] || r["total_supply"]),
              supply_demand_gap: n(r["supply_demand_gap"]),
              res_vic: n(r["res_vic"]), res_nsw: n(r["res_nsw"]), res_sa: n(r["res_sa"]), res_tas: n(r["res_tas"]),
              ind_vic: 0, ind_nsw: 0, ind_sa: 0, ind_tas: 0,
              year: parseInt(date.substring(0, 4)),
              month: parseInt(date.substring(5, 7)),
              dayOfYear: Math.round((dt - start) / 86400000),
            };
          }).filter(Boolean);
          resolve(records.sort((a, b) => a.date.localeCompare(b.date)));
        }).catch(err => reject(new Error("SheetJS load failed: " + err.message)));
      } catch(err) { reject(err); }
    };
    reader.onerror = () => reject(new Error("File read failed"));
    reader.readAsArrayBuffer(file);
  });
}

// ════════════════════════════════════════════════════════════════════════════════
// ── MAIN APP ───────────────────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════════════

const AEMO_CACHE_KEY = "ecgm_records_v20";
const AEMO_CACHE_META = "ecgm_meta_v20";

// Tab definitions
const ALL_TABS = [
  // ── Forecast pipeline ──
  { id: "forecast",     label: "⬡ Near-Term Forecast",  group: "forecast" },
  { id: "scenarios",    label: "🌐 Scenarios",            group: "forecast" },
  { id: "montecarlo",   label: "🎲 Monte Carlo",          group: "forecast" },
  { id: "npmodel",      label: "📊 Non-Power Model",      group: "forecast" },
  { id: "gpgmodel",     label: "⚡ GPG Model",            group: "forecast" },
  { id: "diagnostics",  label: "🔬 Diagnostics",          group: "forecast" },
  // ── AEMO actuals ──
  { id: "demand",       label: "Daily Demand",           group: "aemo" },
  { id: "gpg",          label: "GPG Analysis",           group: "aemo" },
  { id: "supply",       label: "Supply & Capacity",      group: "aemo" },
  { id: "production",   label: "Production",             group: "aemo" },
  { id: "storage",      label: "Storage (Iona)",         group: "aemo" },
  { id: "states",       label: "State Breakdown",        group: "aemo" },
  { id: "flowmap",      label: "Flow Map",               group: "aemo" },
];

export default function IntegratedGasDashboard() {
  // ── AEMO actuals state ────────────────────────────────────────────────────────
  const [records, setRecords]           = useState([]);
  const [selectedYears, setSelectedYears] = useState([2023, 2024, 2025]);
  const [dateRange, setDateRange]       = useState(["2019-01-01", "2025-12-31"]);
  const [stats, setStats]               = useState({});
  const [lastFetch, setLastFetch]       = useState(null);
  const [aemoLoading, setAemoLoading]   = useState(false);
  const [aemoMsg, setAemoMsg]           = useState("");
  const [aemoError, setAemoError]       = useState("");

  // ── Forecast / model state ────────────────────────────────────────────────────
  const [allData, setAllData]           = useState([]);
  const [crossData, setCrossData]       = useState(null);
  const [npData, setNpData]             = useState(null);
  const [modelSummary, setModelSummary] = useState(null);
  const [poeData, setPoeData]           = useState(null);
  const [scenarioData, setScenarioData] = useState({});
  const [loadedFiles, setLoadedFiles]   = useState([]);
  const [forecastError, setForecastError] = useState(null);
  const [storageReady, setStorageReady] = useState(false);

  // ── UI state ──────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab]       = useState("forecast");
  const fileRef = useRef();
  const xlsxRef = useRef();

  // ── Parsers ───────────────────────────────────────────────────────────────────
  const parseForecast = (rows) => rows.map(r => ({
    ...r,
    date:             (r.date || "").slice(0, 10),
    period:           (r.period || "").trim(),
    pred_gpg_tj:      toNum(r.pred_gpg_tj),
    pred_nonpower_tj: toNum(r.pred_nonpower_tj),
    pred_total_tj:    toNum(r.pred_total_tj),
    hdd18_se:         toNum(r.hdd18_se),
    hdd18_nem:        toNum(r.hdd18_nem),
    cdd24_nem:        toNum(r.cdd24_nem),
    pred_wind_mwh:    toNum(r.pred_wind_mwh),
    pred_solar_mwh:   toNum(r.pred_solar_mwh),
    pred_coal_mwh:    toNum(r.pred_coal_mwh),
    pred_hydro_mwh:   toNum(r.pred_hydro_mwh),
  }));

  const parseCrossplot = (rows) => {
    const parsed = rows.map(r => ({
      date:                fmtDateFull((r.date||"").slice(0,10)),
      rawDate:             (r.date||"").slice(0,10),
      actual_wind_mwh:     toNum(r.actual_wind_mwh),  pred_wind_mwh:     toNum(r.pred_wind_mwh),
      actual_solar_mwh:    toNum(r.actual_solar_mwh), pred_solar_mwh:    toNum(r.pred_solar_mwh),
      actual_coal_mwh:     toNum(r.actual_coal_mwh),  pred_coal_mwh:     toNum(r.pred_coal_mwh),
      actual_residual_mwh: toNum(r.actual_residual_mwh), pred_residual_mwh: toNum(r.pred_residual_mwh),
      actual_hydro_mwh:    toNum(r.actual_hydro_mwh), pred_hydro_mwh:    toNum(r.pred_hydro_mwh),
      actual_gpg_mwh:      toNum(r.actual_gpg_mwh),   pred_gpg_mwh:      toNum(r.pred_gpg_mwh),
      actual_gpg_tj:       toNum(r.actual_gpg_tj),     pred_gpg_tj:       toNum(r.pred_gpg_tj),
    }));
    return {
      wind:     parsed.map(r => ({ date:r.date, actual:r.actual_wind_mwh,     model:r.pred_wind_mwh     })),
      solar:    parsed.map(r => ({ date:r.date, actual:r.actual_solar_mwh,    model:r.pred_solar_mwh    })),
      coal:     parsed.map(r => ({ date:r.date, actual:r.actual_coal_mwh,     model:r.pred_coal_mwh     })),
      residual: parsed.map(r => ({ date:r.date, actual:r.actual_residual_mwh, model:r.pred_residual_mwh })),
      hydro:    parsed.map(r => ({ date:r.date, actual:r.actual_hydro_mwh,    model:r.pred_hydro_mwh    })),
      gpg:      parsed.filter(r => r.actual_gpg_tj > 0).map(r => ({ date:r.date, rawDate:r.rawDate, actual:r.actual_gpg_tj, model:r.pred_gpg_tj })),
    };
  };

  const parseNonpower = (rows) => rows.map(r => ({
    date:        fmtDateFull((r.date||"").slice(0,10)),
    rawDate:     (r.date||"").slice(0,10),
    actual_tj:   toNum(r.actual_tj),     pred_tj:     toNum(r.pred_tj),
    residual_tj: toNum(r.residual_tj),   is_train:    toNum(r.is_train),
    vic_actual:  toNum(r.vic_actual_tj), vic_pred:    toNum(r.vic_pred_tj),
    nsw_actual:  toNum(r.nsw_actual_tj), nsw_pred:    toNum(r.nsw_pred_tj),
    sa_actual:   toNum(r.sa_actual_tj),  sa_pred:     toNum(r.sa_pred_tj),
    tas_actual:  toNum(r.tas_actual_tj), tas_pred:    toNum(r.tas_pred_tj),
  }));

  const parsePoe = (rows) => rows.map(r => ({
    date:               (r.date || "").slice(0, 10),
    total_p10_tj:       toNum(r.p10_total_tj  ?? r.total_p10_tj  ?? r.pred_total_p10),
    total_p90_tj:       toNum(r.p90_total_tj  ?? r.total_p90_tj  ?? r.pred_total_p90),
    gpg_p10_tj:         toNum(r.p10_gpg_tj    ?? r.gpg_p10_tj    ?? r.pred_gpg_p10),
    gpg_p90_tj:         toNum(r.p90_gpg_tj    ?? r.gpg_p90_tj    ?? r.pred_gpg_p90),
    nonpower_p10_tj:    toNum(r.p10_nonpwr_tj ?? r.p10_nonpower_tj ?? r.nonpower_p10_tj ?? r.pred_nonpower_p10),
    nonpower_p90_tj:    toNum(r.p90_nonpwr_tj ?? r.p90_nonpower_tj ?? r.nonpower_p90_tj ?? r.pred_nonpower_p90),
  }));

  const parseScenario = (rows) => rows.map(r => ({
    date:             (r.date || "").slice(0, 10),
    pred_gpg_tj:      toNum(r.pred_gpg_tj),
    pred_nonpower_tj: toNum(r.pred_nonpower_tj),
    pred_total_tj:    toNum(r.pred_total_tj ?? (toNum(r.pred_gpg_tj) + toNum(r.pred_nonpower_tj))),
    hdd18_se:         toNum(r.hdd18_se),
    cdd24_nem:        toNum(r.cdd24_nem),
    actual_total_tj:  toNum(r.actual_total_tj ?? r.actual_tj),
  }));

  // ── Restore persisted forecast CSVs on mount ──────────────────────────────────
  useEffect(() => {
    const restore = async () => {
      try {
        const csvKeys = { "csv:forecast":"forecast", "csv:crossplot":"crossplot", "csv:nonpower":"nonpower" };
        const restoredFiles = [];
        for (const [key, name] of Object.entries(csvKeys)) {
          try {
            const result = await window.storage.get(key);
            if (result?.value) {
              const rows = parseCSV(result.value);
              if (key === "csv:forecast")  { setAllData(parseForecast(rows));    restoredFiles.push(name); }
              if (key === "csv:crossplot") { setCrossData(parseCrossplot(rows)); restoredFiles.push(name); }
              if (key === "csv:nonpower")  { setNpData(parseNonpower(rows));     restoredFiles.push(name); }
            }
          } catch {}
        }
        try {
          const result = await window.storage.get("csv:poe");
          if (result?.value) { setPoeData(parsePoe(parseCSV(result.value))); restoredFiles.push("poe"); }
        } catch {}
        try {
          const result = await window.storage.get("json:scenarios");
          if (result?.value) {
            const map = JSON.parse(result.value);
            const parsed = {};
            for (const [k, v] of Object.entries(map)) {
              if (k.toLowerCase().startsWith("summary")) continue;
              parsed[k] = parseScenario(parseCSV(v));
              restoredFiles.push(`scen:${k}`);
            }
            setScenarioData(parsed);
          }
        } catch {}
        try {
          const result = await window.storage.get("json:model_summary");
          if (result?.value) { setModelSummary(JSON.parse(result.value)); restoredFiles.push("model_summary"); }
        } catch {}
        if (restoredFiles.length) setLoadedFiles(restoredFiles.map(n => `${n} (cached)`));
      } catch {}
      setStorageReady(true);
    };
    restore();
  }, []);

  // ── Restore AEMO cache on mount ───────────────────────────────────────────────
  useEffect(() => {
    try {
      const raw  = localStorage.getItem(AEMO_CACHE_KEY);
      const meta = localStorage.getItem(AEMO_CACHE_META);
      if (raw) {
        const data = JSON.parse(raw);
        const { fetchedAt } = meta ? JSON.parse(meta) : {};
        applyAEMOData(data, fetchedAt);
      }
    } catch (e) { console.warn("AEMO cache load failed:", e); }
  }, []);

  function applyAEMOData(data, fetchedAt) {
    setRecords(data);
    setStats(computeStats(data));
    setLastFetch(fetchedAt ? new Date(fetchedAt) : new Date());
    const years = [...new Set(data.map(r => r.year))].sort();
    setSelectedYears(years.slice(-3));
    if (data.length > 0) setDateRange([data[0].date, data[data.length-1].date]);
  }

  // ── AEMO fetch ────────────────────────────────────────────────────────────────
  const handleFetchAEMO = useCallback(async () => {
    setAemoLoading(true); setAemoError("");
    try {
      const data = await fetchAEMOData(setAemoMsg);
      const fetchedAt = new Date();
      applyAEMOData(data, fetchedAt.toISOString());
      try {
        localStorage.setItem(AEMO_CACHE_KEY, JSON.stringify(data));
        localStorage.setItem(AEMO_CACHE_META, JSON.stringify({ fetchedAt: fetchedAt.toISOString(), count: data.length }));
      } catch {}
    } catch (e) { setAemoError(e.message); }
    finally { setAemoLoading(false); setAemoMsg(""); }
  }, []);

  // ── XLSX upload (AEMO actuals) ────────────────────────────────────────────────
  const handleXLSXUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAemoLoading(true); setAemoError(""); setAemoMsg("Reading Excel file...");
    try {
      const data = await loadFromExcel(file, setAemoMsg);
      const fetchedAt = new Date();
      applyAEMOData(data, fetchedAt.toISOString());
      try {
        localStorage.setItem(AEMO_CACHE_KEY, JSON.stringify(data));
        localStorage.setItem(AEMO_CACHE_META, JSON.stringify({ fetchedAt: fetchedAt.toISOString(), count: data.length }));
      } catch {}
    } catch (e) { setAemoError("XLSX load failed: " + e.message); }
    finally { setAemoLoading(false); setAemoMsg(""); e.target.value = ""; }
  }, []);

  // ── Forecast CSV upload ───────────────────────────────────────────────────────
  const processForecastFile = async (name, text) => {
    const lname = name.toLowerCase();
    if (name.endsWith(".json") || lname.includes("model_summary")) {
      setModelSummary(JSON.parse(text));
      setLoadedFiles(f => [...f.filter(n => !n.includes("model_summary")), name]);
      try { await window.storage.set("json:model_summary", text); } catch {}
    } else if (lname.includes("forecast_poe") || lname.includes("gas_forecast_poe")) {
      setPoeData(parsePoe(parseCSV(text)));
      setLoadedFiles(f => [...f.filter(n => !n.includes("poe")), name]);
      try { await window.storage.set("csv:poe", text); } catch {}
    } else if (lname.includes("gas_scenario_")) {
      const label = name.replace(/\.csv$/i,"").replace(/^gas_scenario_/i,"").replace(/_/g," ");
      if (label.toLowerCase().startsWith("summary")) return;
      const parsed = parseScenario(parseCSV(text));
      setScenarioData(prev => {
        const next = { ...prev, [label]: parsed };
        try {
          window.storage.get("json:scenarios").then(ex => {
            const map = ex?.value ? JSON.parse(ex.value) : {};
            map[label] = text;
            window.storage.set("json:scenarios", JSON.stringify(map)).catch(()=>{});
          }).catch(()=>{});
        } catch {}
        return next;
      });
      setLoadedFiles(f => [...f.filter(n => !n.includes(`scen:${label}`)), `scen:${label}`]);
    } else if (lname.includes("nonpower")) {
      setNpData(parseNonpower(parseCSV(text)));
      setLoadedFiles(f => [...f.filter(n => !n.includes("nonpower")), name]);
      try { await window.storage.set("csv:nonpower", text); } catch {}
    } else if (lname.includes("crossplot")) {
      setCrossData(parseCrossplot(parseCSV(text)));
      setLoadedFiles(f => [...f.filter(n => !n.includes("crossplot")), name]);
      try { await window.storage.set("csv:crossplot", text); } catch {}
    } else {
      const rows = parseCSV(text);
      const cols = Object.keys(rows[0] || {});
      const hasForecastCols = cols.includes("period") || cols.includes("pred_gpg_tj") || cols.includes("pred_total_tj");
      if (!hasForecastCols) { setForecastError(`"${name}" missing required forecast columns.`); return; }
      const parsed = parseForecast(rows);
      setAllData(parsed);
      setLoadedFiles(f => [...f.filter(n => !n.toLowerCase().includes("forecast") && !n.includes("cached")), name]);
      try { await window.storage.set("csv:forecast", text); } catch {}
    }
  };

  const handleForecastFiles = (e) => {
    const files = Array.from(e.target.files);
    e.target.value = "";
    setForecastError(null);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        try { await processForecastFile(file.name, ev.target.result); }
        catch { setForecastError(`Could not parse ${file.name}`); }
      };
      reader.readAsText(file);
    });
  };

  const handleClearForecast = async () => {
    setAllData([]); setCrossData(null); setNpData(null); setModelSummary(null);
    setPoeData(null); setScenarioData({}); setLoadedFiles([]); setForecastError(null);
    for (const key of ["csv:forecast","csv:crossplot","csv:nonpower","json:model_summary","meta:forecast_dates","csv:poe","json:scenarios"]) {
      try { await window.storage.delete(key); } catch {}
    }
  };

  const toggleYear = (y) => {
    setSelectedYears(prev => prev.includes(y) ? (prev.length > 1 ? prev.filter(x => x !== y) : prev) : [...prev, y].sort());
  };

  const availableYears = records.length ? [...new Set(records.map(r => r.year))].sort() : [2019,2020,2021,2022,2023,2024,2025];
  const isAEMOTab = ALL_TABS.find(t => t.id === activeTab)?.group === "aemo";
  const isForecastTab = !isAEMOTab;

  const btnBase = (color, active) => ({
    padding: "4px 13px", borderRadius: 5,
    border: `1px solid ${active ? color : C.border}`,
    background: active ? color + "22" : "transparent",
    color: active ? color : C.muted,
    cursor: "pointer", fontSize: 12, fontFamily: "DM Mono, monospace",
    transition: "all 0.15s", whiteSpace: "nowrap",
  });

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", flexDirection: "column" }}>
      <style>{GLOBAL_CSS}</style>

      {/* ── Header ── */}
      <header style={{
        background: C.surface, borderBottom: `1px solid ${C.border}`,
        padding: "0 24px", display: "flex", alignItems: "center",
        justifyContent: "space-between", height: 52,
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 7, flexShrink: 0,
            background: "linear-gradient(135deg, #e6a817 0%, #39d0d8 100%)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15,
          }}>⚡</div>
          <div>
            <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: "-0.02em" }}>
              East Coast Gas Market — Integrated Dashboard
            </div>
            <div style={{ fontSize: 10, color: C.muted, fontFamily: "DM Mono, monospace" }}>
              AEMO GBB Actuals · ML Forecast Pipeline · Probabilistic Outlook · SE States
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
          {lastFetch && <span style={{ fontSize: 10, color: C.muted, fontFamily: "DM Mono, monospace" }}>
            AEMO ↻ {lastFetch.toLocaleDateString()}
          </span>}

          {/* AEMO buttons */}
          <button onClick={handleFetchAEMO} disabled={aemoLoading} style={btnBase("#388bfd", false)}>
            {aemoLoading ? (aemoMsg || "Loading...") : "↻ Fetch AEMO"}
          </button>
          <label style={{ ...btnBase("#bc8cff", false), cursor: aemoLoading ? "not-allowed" : "pointer", display: "inline-block" }}>
            ↑ Load XLSX
            <input ref={xlsxRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleXLSXUpload} disabled={aemoLoading} style={{ display: "none" }}/>
          </label>

          {/* Forecast CSV upload */}
          <div style={{ position: "relative" }} className="upload-wrap">
            <div onClick={() => fileRef.current?.click()} style={{
              ...btnBase(C.green, false), cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4,
            }}>
              📁 Forecast CSVs
            </div>
            <div style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 200,
              background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6,
              padding: "10px 14px", minWidth: 360, display: "none", boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
              lineHeight: 1.9, fontSize: 11, fontFamily: "DM Mono, monospace" }} className="upload-tooltip">
              <div style={{ color: C.muted, marginBottom: 6, fontWeight: 600 }}>Notebook output files (data/forecasts/):</div>
              <div><span style={{ color: C.green }}>gas_forecast_YYYYMMDD.csv</span> <span style={{ color: C.muted }}>→ Near-Term Forecast</span></div>
              <div><span style={{ color: C.green }}>gas_forecast_poe_YYYYMMDD.csv</span> <span style={{ color: C.muted }}>→ PoE bands</span></div>
              <div><span style={{ color: C.blue }}>gpg_crossplot_diagnostics.csv</span> <span style={{ color: C.muted }}>→ GPG Model tab</span></div>
              <div><span style={{ color: C.cyan }}>nonpower_model_diagnostics.csv</span> <span style={{ color: C.muted }}>→ Non-Power tab</span></div>
              <div><span style={{ color: C.purple }}>gas_scenario_202x_Base.csv</span> <span style={{ color: C.muted }}>→ Scenarios tab</span></div>
              <div><span style={{ color: C.yellow }}>model_summary.json</span> <span style={{ color: C.muted }}>→ Monte Carlo + Diagnostics</span></div>
            </div>
          </div>
          <input ref={fileRef} type="file" accept=".csv,.json" multiple onChange={handleForecastFiles} style={{ display: "none" }}/>

          {/* Loaded forecast file badges */}
          {(() => {
            const scenFiles  = loadedFiles.filter(f => f.startsWith("scen:"));
            const otherFiles = loadedFiles.filter(f => !f.startsWith("scen:"));
            return [...otherFiles, ...(scenFiles.length ? [`📋 ${scenFiles.length} scenario${scenFiles.length>1?"s":""}`] : [])].map((f, i) => (
              <span key={i} style={{ color: f.includes("cached") ? C.cyan : C.green, fontSize: 10, whiteSpace: "nowrap", fontFamily: "DM Mono, monospace" }}>
                {f.includes("cached") ? "⟳" : "✓"} {f.replace(/\(cached\)/,"").trim().slice(0,22)}
              </span>
            ));
          })()}
          {loadedFiles.length > 0 && (
            <button onClick={handleClearForecast} style={btnBase(C.muted, false)}>✕</button>
          )}

          {/* Record count */}
          {records.length > 0 && (
            <span style={{ fontSize: 10, color: C.dim, fontFamily: "DM Mono, monospace" }}>
              {records.length.toLocaleString()} records
            </span>
          )}
        </div>
      </header>

      {/* Error banners */}
      {aemoError && (
        <div style={{ background: "#f8514915", border: "1px solid #f8514966", margin: "8px 24px 0", borderRadius: 6, padding: "9px 14px", fontSize: 12, color: "#f85149", display: "flex", justifyContent: "space-between" }}>
          <span>⚠ {aemoError}</span>
          <span style={{ cursor: "pointer", opacity: 0.7 }} onClick={() => setAemoError("")}>✕</span>
        </div>
      )}
      {forecastError && (
        <div style={{ background: "#f8514915", border: "1px solid #f8514966", margin: "8px 24px 0", borderRadius: 6, padding: "9px 14px", fontSize: 12, color: "#f85149", display: "flex", justifyContent: "space-between" }}>
          <span>⚠ {forecastError}</span>
          <span style={{ cursor: "pointer", opacity: 0.7 }} onClick={() => setForecastError(null)}>✕</span>
        </div>
      )}

      {/* AEMO year/range controls — only shown on AEMO tabs */}
      {isAEMOTab && (
        <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "7px 24px", display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10, color: C.muted, fontFamily: "DM Mono, monospace", textTransform: "uppercase", letterSpacing: "0.07em" }}>Years</span>
            {availableYears.map(y => (
              <button key={y} onClick={() => toggleYear(y)} style={{
                padding: "3px 9px", borderRadius: 4,
                border: `1px solid ${selectedYears.includes(y) ? YEAR_COLORS[y] || "#888" : C.border}`,
                background: selectedYears.includes(y) ? (YEAR_COLORS[y] || "#888") + "22" : "transparent",
                color: selectedYears.includes(y) ? YEAR_COLORS[y] || "#888" : C.muted,
                cursor: "pointer", fontSize: 11, fontFamily: "DM Mono, monospace",
                fontWeight: selectedYears.includes(y) ? 600 : 400, transition: "all 0.15s",
              }}>{y}</button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10, color: C.muted, fontFamily: "DM Mono, monospace", textTransform: "uppercase", letterSpacing: "0.07em" }}>Range</span>
            {["from","to"].map((label, i) => (
              <input key={label} type="date" value={dateRange[i]}
                onChange={e => setDateRange(i===0 ? [e.target.value, dateRange[1]] : [dateRange[0], e.target.value])}
                style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 4, padding: "3px 8px", color: C.text, fontSize: 11, fontFamily: "DM Mono, monospace" }}/>
            ))}
          </div>
        </div>
      )}

      {/* ── Tab navigation ── */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "0 24px" }}>
        {/* Group labels */}
        <div style={{ display: "flex", gap: 0, flexWrap: "nowrap", overflowX: "auto" }}>
          {/* Forecast group header */}
          <div style={{ display: "flex", alignItems: "center", borderRight: `1px solid ${C.border}`, paddingRight: 0, marginRight: 0 }}>
            <span style={{ fontSize: 9, color: C.dim, fontFamily: "DM Mono, monospace", textTransform: "uppercase", letterSpacing: "0.08em", padding: "0 8px 0 0", whiteSpace: "nowrap" }}>Forecast Pipeline</span>
            {ALL_TABS.filter(t => t.group === "forecast").map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                padding: "11px 14px", border: "none",
                borderBottom: `2px solid ${activeTab === tab.id ? C.blue : "transparent"}`,
                background: "transparent",
                color: activeTab === tab.id ? C.text : C.muted,
                cursor: "pointer", fontSize: 12,
                fontFamily: "Syne, sans-serif",
                fontWeight: activeTab === tab.id ? 600 : 400,
                transition: "color 0.15s", whiteSpace: "nowrap",
              }}>{tab.label}</button>
            ))}
          </div>
          {/* AEMO group */}
          <div style={{ display: "flex", alignItems: "center", paddingLeft: 12 }}>
            <span style={{ fontSize: 9, color: C.dim, fontFamily: "DM Mono, monospace", textTransform: "uppercase", letterSpacing: "0.08em", padding: "0 8px 0 0", whiteSpace: "nowrap" }}>AEMO Actuals</span>
            {ALL_TABS.filter(t => t.group === "aemo").map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                padding: "11px 14px", border: "none",
                borderBottom: `2px solid ${activeTab === tab.id ? C.accent : "transparent"}`,
                background: "transparent",
                color: activeTab === tab.id ? C.text : C.muted,
                cursor: "pointer", fontSize: 12,
                fontFamily: "Syne, sans-serif",
                fontWeight: activeTab === tab.id ? 600 : 400,
                transition: "color 0.15s", whiteSpace: "nowrap",
              }}>{tab.label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Tab content ── */}
      <main style={{ flex: 1, padding: "24px 24px 40px", maxWidth: 1600, width: "100%", margin: "0 auto", alignSelf: "stretch" }}>
        {!storageReady ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 400, gap: 16 }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", border: `3px solid ${C.border}`, borderTopColor: C.blue, animation: "spin 0.8s linear infinite" }}/>
            <div style={{ fontFamily: "DM Mono, monospace", color: C.muted, fontSize: 12 }}>Restoring cached data…</div>
          </div>
        ) : (
          <>
            {/* ── Forecast pipeline tabs ── */}
            {activeTab === "forecast"    && <ForecastTab allData={allData} poeData={poeData} aemoRecords={records}/>}
            {activeTab === "scenarios"   && <ScenariosTab scenarioData={scenarioData} allData={allData} aemoRecords={records}/>}
            {activeTab === "montecarlo"  && <MonteCarloTab modelSummary={modelSummary} scenarioData={scenarioData}/>}
            {activeTab === "npmodel"     && <NonPowerModelTab npData={npData} modelSummary={modelSummary}/>}
            {activeTab === "gpgmodel"    && <GPGModelTab crossData={crossData} modelSummary={modelSummary}/>}
            {activeTab === "diagnostics" && <DiagnosticsTab crossData={crossData} npData={npData} modelSummary={modelSummary}/>}

            {/* ── AEMO actuals tabs ── */}
            {isAEMOTab && (aemoLoading && !records.length ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 400, gap: 16 }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", border: `3px solid ${C.border}`, borderTopColor: C.accent, animation: "spin 0.8s linear infinite" }}/>
                <div style={{ fontFamily: "DM Mono, monospace", color: C.muted, fontSize: 12 }}>{aemoMsg}</div>
              </div>
            ) : !records.length ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 400, gap: 18, textAlign: "center" }}>
                <div style={{ fontSize: 44 }}>⚡</div>
                <div style={{ fontFamily: "Syne, sans-serif", fontWeight: 700, fontSize: 20 }}>No AEMO data loaded</div>
                <div style={{ color: C.muted, maxWidth: 380, lineHeight: 1.6, fontSize: 13 }}>
                  Fetch live data from AEMO or upload an Excel export to explore historical charts.
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <button onClick={handleFetchAEMO} style={{ padding: "9px 22px", borderRadius: 6, border: `1px solid #388bfd`, background: "#388bfd22", color: "#388bfd", cursor: "pointer", fontSize: 13, fontFamily: "Syne, sans-serif", fontWeight: 600 }}>Fetch AEMO Data</button>
                  <label style={{ padding: "9px 22px", borderRadius: 6, border: `1px solid ${C.purple}`, background: C.purple+"22", color: C.purple, cursor: "pointer", fontSize: 13, fontFamily: "Syne, sans-serif", fontWeight: 600 }}>
                    Upload XLSX
                    <input type="file" accept=".xlsx,.xls,.csv" onChange={handleXLSXUpload} style={{ display: "none" }}/>
                  </label>
                </div>
              </div>
            ) : (
              <>
                {activeTab === "demand"    && <TabDailyDemand records={records} selectedYears={selectedYears} dateRange={dateRange} stats={stats}/>}
                {activeTab === "gpg"       && <TabGPG         records={records} selectedYears={selectedYears} dateRange={dateRange} stats={stats}/>}
                {activeTab === "supply"    && <TabSupplyCapacity records={records} selectedYears={selectedYears} dateRange={dateRange} stats={stats}/>}
                {activeTab === "production"&& <TabProduction  records={records} selectedYears={selectedYears} dateRange={dateRange} stats={stats}/>}
                {activeTab === "storage"   && <TabStorage     records={records} selectedYears={selectedYears} dateRange={dateRange} stats={stats}/>}
                {activeTab === "states"    && <TabStateBreakdown records={records} selectedYears={selectedYears} dateRange={dateRange} stats={stats}/>}
                {activeTab === "flowmap"   && <TabFlowMap     records={records} selectedYears={selectedYears} dateRange={dateRange} stats={stats}/>}
              </>
            ))}
          </>
        )}
      </main>

      {/* ── Footer ── */}
      <footer style={{ borderTop: `1px solid ${C.border}`, padding: "8px 24px", display: "flex", justifyContent: "space-between", fontSize: 10, color: C.dim, fontFamily: "DM Mono, monospace" }}>
        <span>Source: AEMO GBB Actual Flow &amp; Storage — nemweb.com.au · ML forecast pipeline — Broken Bay Associates</span>
        <span>SE States: VIC, NSW, SA, TAS · Capacity &amp; forecast figures are indicative only</span>
      </footer>
    </div>
  );
}
