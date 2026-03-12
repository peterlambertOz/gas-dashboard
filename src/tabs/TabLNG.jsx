import {
  LineChart, Line, AreaChart, Area, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Label
} from 'recharts';
import { useMemo, useState } from 'react';
import {
  ChartCard, KpiCard, CustomTooltip, AXIS_STYLE, GRID_STYLE,
  CHART_COLORS, YEAR_COLORS, Legend, fmtDate
} from '../components/ChartCard';
import { exportToPowerPoint, exportToExcel } from '../utils/exportUtils';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── Nameplate capacity constants ───────────────────────────────────────────────
// Published LNG export capacity (Mtpa) → gas input to Curtis Island (TJ/day)
// 1 Mtpa LNG × 54.4 MJ/kg ÷ 365 = ~149 TJ/day LNG out
// Gas input = LNG out ÷ (1 − 0.055) liquefaction efficiency
// i.e. 5.5% of gas input is consumed in the liquefaction process
// 1 Mtpa = 1e6 t/yr × 0.0544 TJ/t ÷ 365 days ÷ 0.945 liquefaction efficiency
const LNG_MTPA_TO_GAS_TJDAY = (mtpa) => (mtpa * 1e6 * 0.0544) / 365 / 0.945; // TJ/day gas input

const NAMEPLATE = {
  aplng: { mtpa: 9.0,   label: 'APLNG (9 Mtpa nameplate)', color: '#f85149' },
  qclng: { mtpa: 8.5,   label: 'QCLNG (8.5 Mtpa nameplate)', color: '#ffa657' },
  glng:  { mtpa: 7.8,   label: 'GLNG (7.8 Mtpa nameplate)', color: '#3fb950' },
};
Object.keys(NAMEPLATE).forEach(k => {
  NAMEPLATE[k].capacity = Math.round(LNG_MTPA_TO_GAS_TJDAY(NAMEPLATE[k].mtpa));
});

// Pipeline colours (for area chart + year series)
const PIPE_COLORS = {
  aplng: '#388bfd',   // blue  — WGP/APLNG pipeline
  qclng: '#e6a817',   // amber — QCLNG/WGP pipeline
  glng:  '#3fb950',   // green — GLNG pipeline
};

function dayLabel(day) {
  const d = new Date(2024, 0, day);
  return MONTH_LABELS[d.getMonth()];
}

// Day ticks for X axis (1st of each month in a non-leap year)
const MONTH_TICKS = [1, 32, 61, 92, 122, 153, 183, 214, 245, 275, 306, 336];

export default function TabLNG({ records, selectedYears, dateRange }) {
  const latestYear = Math.max(...selectedYears);
  const [areaYear, setAreaYear] = useState(latestYear);

  // ── Year-on-year data pivots ───────────────────────────────────────────────
  const yoyTotal = useMemo(() => {
    const pivot = {};
    for (const r of records) {
      if (!selectedYears.includes(r.year)) continue;
      const total = (r.map_aplng || 0) + (r.map_wgp_lng || 0) + (r.map_glng || 0);
      if (total <= 0) continue;
      const key = r.dayOfYear;
      if (!pivot[key]) pivot[key] = { day: key };
      pivot[key][r.year] = total;
    }
    return Object.values(pivot).sort((a, b) => a.day - b.day);
  }, [records, selectedYears]);

  const yoyAPLNG = useMemo(() => {
    const pivot = {};
    for (const r of records) {
      if (!selectedYears.includes(r.year)) continue;
      const val = r.map_aplng || 0;
      if (val <= 0) continue;
      const key = r.dayOfYear;
      if (!pivot[key]) pivot[key] = { day: key };
      pivot[key][r.year] = val;
    }
    return Object.values(pivot).sort((a, b) => a.day - b.day);
  }, [records, selectedYears]);

  const yoyQCLNG = useMemo(() => {
    const pivot = {};
    for (const r of records) {
      if (!selectedYears.includes(r.year)) continue;
      const val = r.map_wgp_lng || 0;
      if (val <= 0) continue;
      const key = r.dayOfYear;
      if (!pivot[key]) pivot[key] = { day: key };
      pivot[key][r.year] = val;
    }
    return Object.values(pivot).sort((a, b) => a.day - b.day);
  }, [records, selectedYears]);

  const yoyGLNG = useMemo(() => {
    const pivot = {};
    for (const r of records) {
      if (!selectedYears.includes(r.year)) continue;
      const val = r.map_glng || 0;
      if (val <= 0) continue;
      const key = r.dayOfYear;
      if (!pivot[key]) pivot[key] = { day: key };
      pivot[key][r.year] = val;
    }
    return Object.values(pivot).sort((a, b) => a.day - b.day);
  }, [records, selectedYears]);

  // ── Area chart: single year, split by pipeline ────────────────────────────
  const areaData = useMemo(() => {
    return records
      .filter(r => r.year === areaYear && ((r.map_aplng || 0) + (r.map_wgp_lng || 0) + (r.map_glng || 0)) > 0)
      .map(r => ({
        date: r.date.substring(5),
        aplng: r.map_aplng   || 0,
        qclng: r.map_wgp_lng || 0,
        glng:  r.map_glng    || 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [records, areaYear]);

  // ── KPIs for latest year ──────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const rows = records.filter(r => r.year === latestYear &&
      ((r.map_aplng || 0) + (r.map_wgp_lng || 0) + (r.map_glng || 0)) > 0);
    if (!rows.length) return {};
    const totals = rows.map(r => (r.map_aplng || 0) + (r.map_wgp_lng || 0) + (r.map_glng || 0));
    const avg = totals.reduce((s, v) => s + v, 0) / totals.length;
    const peak = Math.max(...totals);
    const totalNameplate = NAMEPLATE.aplng.capacity + NAMEPLATE.qclng.capacity + NAMEPLATE.glng.capacity;
    return {
      avg: Math.round(avg),
      peak: Math.round(peak),
      utilisation: Math.round((avg / totalNameplate) * 100),
      totalNameplate,
    };
  }, [records, latestYear]);

  const availableYears = useMemo(() => {
    const yrs = [...new Set(records
      .filter(r => (r.map_aplng || 0) + (r.map_wgp_lng || 0) + (r.map_glng || 0) > 0)
      .map(r => r.year)
    )].sort();
    return yrs;
  }, [records]);

  const handleExportPPT = async (id, title) =>
    exportToPowerPoint([{ id, title, subtitle: 'Daily gas supply to Curtis Island LNG terminal (TJ/day) — Source: AEMO GBB' }]);

  const pipeLegend = selectedYears.map(y => ({
    color: YEAR_COLORS[y] || '#888',
    label: String(y),
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── KPI Strip ───────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <KpiCard
          label={`${latestYear} Avg Daily Supply`}
          value={kpis.avg?.toLocaleString() ?? '—'}
          unit="TJ/day"
          color="var(--accent)"
        />
        <KpiCard
          label={`${latestYear} Peak Day`}
          value={kpis.peak?.toLocaleString() ?? '—'}
          unit="TJ/day"
          color="var(--col-gpg)"
        />
        <KpiCard
          label="Combined Nameplate Capacity"
          value={kpis.totalNameplate?.toLocaleString() ?? '—'}
          unit="TJ/day gas input"
          sub={`APLNG ${NAMEPLATE.aplng.capacity} + QCLNG ${NAMEPLATE.qclng.capacity} + GLNG ${NAMEPLATE.glng.capacity}`}
          color="var(--text-muted)"
        />
        <KpiCard
          label={`${latestYear} Utilisation`}
          value={kpis.utilisation ? `${kpis.utilisation}%` : '—'}
          unit="of combined nameplate"
          color={kpis.utilisation > 85 ? 'var(--col-res)' : kpis.utilisation > 70 ? 'var(--accent)' : 'var(--danger, #f85149)'}
        />
      </div>

      {/* ── Total Curtis Island supply — year-on-year ───────────────────────── */}
      <ChartCard
        id="chart-lng-total-yoy"
        title="Total Curtis Island LNG Supply — Year on Year"
        subtitle="Combined daily gas supply across all three pipelines (APLNG + QCLNG/WGP + GLNG) — TJ/day"
        onExportPPT={() => handleExportPPT('chart-lng-total-yoy', 'Total Curtis Island LNG Supply YoY')}
        onExportXLSX={() => exportToExcel(records.filter(r => selectedYears.includes(r.year)))}
      >
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={yoyTotal} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis
              dataKey="day"
              tickFormatter={dayLabel}
              ticks={MONTH_TICKS}
              {...AXIS_STYLE}
            />
            <YAxis {...AXIS_STYLE} tickFormatter={v => v.toLocaleString()} />
            <Tooltip
              content={
                <CustomTooltip
                  formatter={v => `${Math.round(v).toLocaleString()} TJ`}
                  labelFormatter={dayLabel}
                />
              }
            />
            {selectedYears.map(y => (
              <Line
                key={y} type="monotone" dataKey={y} name={String(y)}
                stroke={YEAR_COLORS[y] || '#888'}
                strokeWidth={y === latestYear ? 2.5 : 1.5}
                dot={false} connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <Legend items={pipeLegend} />
      </ChartCard>

      {/* ── Individual pipeline charts ──────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>

        {/* APLNG */}
        <ChartCard
          id="chart-lng-aplng-yoy"
          title="APLNG Pipeline to Curtis Island"
          subtitle={`Year-on-year (TJ/day) — Nameplate: ${NAMEPLATE.aplng.capacity.toLocaleString()} TJ/day (9 Mtpa @ 94.5% conv.)`}
          onExportPPT={() => handleExportPPT('chart-lng-aplng-yoy', 'APLNG Pipeline YoY')}
          onExportXLSX={() => exportToExcel(records.filter(r => selectedYears.includes(r.year)))}
        >
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={yoyAPLNG} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
              <CartesianGrid {...GRID_STYLE} />
              <XAxis dataKey="day" tickFormatter={dayLabel} ticks={MONTH_TICKS} {...AXIS_STYLE} />
              <YAxis {...AXIS_STYLE} tickFormatter={v => v.toLocaleString()} domain={[0, 'auto']} />
              <Tooltip
                content={
                  <CustomTooltip
                    formatter={v => `${Math.round(v).toLocaleString()} TJ`}
                    labelFormatter={dayLabel}
                  />
                }
              />
              <ReferenceLine
                y={NAMEPLATE.aplng.capacity}
                stroke={NAMEPLATE.aplng.color}
                strokeDasharray="6 3"
                strokeWidth={1.5}
              >
                <Label
                  value={`Nameplate ${NAMEPLATE.aplng.capacity.toLocaleString()} TJ/day`}
                  position="insideTopRight"
                  style={{ fill: NAMEPLATE.aplng.color, fontSize: 10, fontFamily: 'DM Mono, monospace' }}
                />
              </ReferenceLine>
              {selectedYears.map(y => (
                <Line
                  key={y} type="monotone" dataKey={y} name={String(y)}
                  stroke={YEAR_COLORS[y] || '#888'}
                  strokeWidth={y === latestYear ? 2.5 : 1.5}
                  dot={false} connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <Legend items={[
            ...pipeLegend,
            { color: NAMEPLATE.aplng.color, label: `Nameplate capacity (9 Mtpa)` },
          ]} />
        </ChartCard>

        {/* QCLNG / WGP */}
        <ChartCard
          id="chart-lng-qclng-yoy"
          title="QCLNG Pipeline (WGP) to Curtis Island"
          subtitle={`Year-on-year (TJ/day) — Nameplate: ${NAMEPLATE.qclng.capacity.toLocaleString()} TJ/day (8.5 Mtpa @ 94.5% conv.)`}
          onExportPPT={() => handleExportPPT('chart-lng-qclng-yoy', 'QCLNG Pipeline YoY')}
          onExportXLSX={() => exportToExcel(records.filter(r => selectedYears.includes(r.year)))}
        >
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={yoyQCLNG} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
              <CartesianGrid {...GRID_STYLE} />
              <XAxis dataKey="day" tickFormatter={dayLabel} ticks={MONTH_TICKS} {...AXIS_STYLE} />
              <YAxis {...AXIS_STYLE} tickFormatter={v => v.toLocaleString()} domain={[0, 'auto']} />
              <Tooltip
                content={
                  <CustomTooltip
                    formatter={v => `${Math.round(v).toLocaleString()} TJ`}
                    labelFormatter={dayLabel}
                  />
                }
              />
              <ReferenceLine
                y={NAMEPLATE.qclng.capacity}
                stroke={NAMEPLATE.qclng.color}
                strokeDasharray="6 3"
                strokeWidth={1.5}
              >
                <Label
                  value={`Nameplate ${NAMEPLATE.qclng.capacity.toLocaleString()} TJ/day`}
                  position="insideTopRight"
                  style={{ fill: NAMEPLATE.qclng.color, fontSize: 10, fontFamily: 'DM Mono, monospace' }}
                />
              </ReferenceLine>
              {selectedYears.map(y => (
                <Line
                  key={y} type="monotone" dataKey={y} name={String(y)}
                  stroke={YEAR_COLORS[y] || '#888'}
                  strokeWidth={y === latestYear ? 2.5 : 1.5}
                  dot={false} connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <Legend items={[
            ...pipeLegend,
            { color: NAMEPLATE.qclng.color, label: `Nameplate capacity (8.5 Mtpa)` },
          ]} />
        </ChartCard>

        {/* GLNG */}
        <ChartCard
          id="chart-lng-glng-yoy"
          title="GLNG Pipeline to Curtis Island"
          subtitle={`Year-on-year (TJ/day) — Nameplate: ${NAMEPLATE.glng.capacity.toLocaleString()} TJ/day (7.8 Mtpa @ 94.5% conv.)`}
          onExportPPT={() => handleExportPPT('chart-lng-glng-yoy', 'GLNG Pipeline YoY')}
          onExportXLSX={() => exportToExcel(records.filter(r => selectedYears.includes(r.year)))}
        >
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={yoyGLNG} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
              <CartesianGrid {...GRID_STYLE} />
              <XAxis dataKey="day" tickFormatter={dayLabel} ticks={MONTH_TICKS} {...AXIS_STYLE} />
              <YAxis {...AXIS_STYLE} tickFormatter={v => v.toLocaleString()} domain={[0, 'auto']} />
              <Tooltip
                content={
                  <CustomTooltip
                    formatter={v => `${Math.round(v).toLocaleString()} TJ`}
                    labelFormatter={dayLabel}
                  />
                }
              />
              <ReferenceLine
                y={NAMEPLATE.glng.capacity}
                stroke={NAMEPLATE.glng.color}
                strokeDasharray="6 3"
                strokeWidth={1.5}
              >
                <Label
                  value={`Nameplate ${NAMEPLATE.glng.capacity.toLocaleString()} TJ/day`}
                  position="insideTopRight"
                  style={{ fill: NAMEPLATE.glng.color, fontSize: 10, fontFamily: 'DM Mono, monospace' }}
                />
              </ReferenceLine>
              {selectedYears.map(y => (
                <Line
                  key={y} type="monotone" dataKey={y} name={String(y)}
                  stroke={YEAR_COLORS[y] || '#888'}
                  strokeWidth={y === latestYear ? 2.5 : 1.5}
                  dot={false} connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <Legend items={[
            ...pipeLegend,
            { color: NAMEPLATE.glng.color, label: `Nameplate capacity (7.8 Mtpa)` },
          ]} />
        </ChartCard>
      </div>

      {/* ── Stacked area chart: pipeline split for selected year ─────────────── */}
      <ChartCard
        id="chart-lng-area-split"
        title={`${areaYear} Curtis Island Supply — Pipeline Split`}
        subtitle="Stacked daily gas deliveries by pipeline (TJ/day) — APLNG Pipeline / WGP (QCLNG) / GLNG Pipeline"
        onExportPPT={() => handleExportPPT('chart-lng-area-split', `${areaYear} Curtis Island Pipeline Split`)}
        onExportXLSX={() => exportToExcel(records.filter(r => r.year === areaYear))}
      >
        {/* Year selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>Show year:</span>
          {availableYears.map(y => (
            <button
              key={y}
              onClick={() => setAreaYear(y)}
              style={{
                padding: '3px 12px',
                borderRadius: 4,
                border: `1px solid ${areaYear === y ? YEAR_COLORS[y] || '#888' : 'var(--border)'}`,
                background: areaYear === y ? (YEAR_COLORS[y] || '#888') + '22' : 'transparent',
                color: areaYear === y ? YEAR_COLORS[y] || '#888' : 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: 12,
                fontFamily: 'DM Mono, monospace',
                fontWeight: areaYear === y ? 600 : 400,
                transition: 'all 0.15s',
              }}
            >
              {y}
            </button>
          ))}
        </div>

        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={areaData} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis
              dataKey="date"
              tickFormatter={fmtDate}
              interval={Math.max(1, Math.floor(areaData.length / 12))}
              {...AXIS_STYLE}
            />
            <YAxis {...AXIS_STYLE} tickFormatter={v => v.toLocaleString()} />
            <Tooltip
              content={
                <CustomTooltip
                  formatter={(v, name) => `${Math.round(v).toLocaleString()} TJ`}
                  labelFormatter={fmtDate}
                />
              }
            />
            <Area
              type="monotone" dataKey="aplng" stackId="1"
              name="APLNG Pipeline"
              fill={PIPE_COLORS.aplng} stroke={PIPE_COLORS.aplng} fillOpacity={0.75}
            />
            <Area
              type="monotone" dataKey="qclng" stackId="1"
              name="QCLNG Pipeline (WGP)"
              fill={PIPE_COLORS.qclng} stroke={PIPE_COLORS.qclng} fillOpacity={0.75}
            />
            <Area
              type="monotone" dataKey="glng" stackId="1"
              name="GLNG Pipeline"
              fill={PIPE_COLORS.glng} stroke={PIPE_COLORS.glng} fillOpacity={0.75}
            />
          </AreaChart>
        </ResponsiveContainer>
        <Legend items={[
          { color: PIPE_COLORS.aplng, label: 'APLNG Pipeline (Australia Pacific LNG)' },
          { color: PIPE_COLORS.qclng, label: 'QCLNG Pipeline / WGP (QGC / Shell)' },
          { color: PIPE_COLORS.glng,  label: 'GLNG Pipeline (Gladstone LNG / Santos)' },
        ]} />
      </ChartCard>

    </div>
  );
}
