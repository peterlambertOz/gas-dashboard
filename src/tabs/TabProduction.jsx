import {
  ComposedChart, Area, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';
import { useMemo } from 'react';
import { ChartCard, KpiCard, CustomTooltip, AXIS_STYLE, GRID_STYLE, CHART_COLORS, YEAR_COLORS, Legend, fmtDate } from '../components/ChartCard';
import { exportToPowerPoint, exportToExcel } from '../utils/exportUtils';

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function TabProduction({ records, selectedYears, dateRange }) {
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

  // (monthlyProduction removed — placeholder for future monthly heatmap chart)

  // Production breakdown latest year — total incl QLD
  const latestProdBreakdown = useMemo(() =>
    records.filter(r => r.year === latestYear && r.date >= dateRange[0] && r.date <= dateRange[1])
      .map(r => ({
        date: r.date.substring(5),
        longford:      r.production_longford,
        moomba:        r.production_moomba,
        qld_roma:      r.production_qld_roma       || 0,
        qld_aplng:     r.production_qld_surat_aplng || 0,
        qld_glng:      r.production_qld_surat_glng  || 0,
        qld_other:     r.production_qld_other       || 0,
        other:         r.production_other_south,
      }))
  , [records, latestYear, dateRange]);

  // SE-only production breakdown
  const seBreakdown = useMemo(() =>
    records.filter(r => r.year === latestYear && r.date >= dateRange[0] && r.date <= dateRange[1])
      .map(r => ({
        date: r.date.substring(5),
        longford:   r.production_longford,
        moomba:     r.production_moomba,
        se_otway:   r.production_se_otway    || 0,
        se_gipps:   r.production_se_gippsland || 0,
        se_other:   r.production_se_other    || 0,
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
            <Tooltip content={<CustomTooltip formatter={(v) => `${Math.round(v).toLocaleString()} TJ`}  labelFormatter={fmtDate} /> } />
            {selectedYears.map(y => (
              <Line key={y} type="monotone" dataKey={y} name={String(y)}
                stroke={YEAR_COLORS[y] || '#888'} strokeWidth={y === latestYear ? 2.5 : 1.5} dot={false} connectNulls />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
        <Legend items={selectedYears.map(y => ({ color: YEAR_COLORS[y] || '#888', label: String(y) }))} />
      </ChartCard>

      {/* SE Production breakdown */}
      <ChartCard
        id="chart-prod-se"
        title={`${latestYear} SE Production by Source`}
        subtitle="Stacked daily SE production: Longford (Gippsland Basin) / Moomba (Cooper Basin) / Otway Basin / Gippsland Other / Other SE (TJ/day)"
        onExportPPT={() => handleExportPPT('chart-prod-se', `${latestYear} SE Production by Source`)}
        onExportXLSX={() => exportToExcel(records.filter(r => r.year === latestYear))}
      >
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={seBreakdown} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="date" {...AXIS_STYLE} tickFormatter={fmtDate} interval={Math.floor(seBreakdown.length / 12)} />
            <YAxis {...AXIS_STYLE} tickFormatter={v => `${v.toLocaleString()}`} />
            <Tooltip content={<CustomTooltip formatter={(v) => `${Math.round(v).toLocaleString()} TJ`} labelFormatter={fmtDate} />} />
            <Area type="monotone" dataKey="longford"  stackId="1" name="Longford (Gippsland Basin)"   fill={CHART_COLORS.longford} stroke={CHART_COLORS.longford} fillOpacity={0.85} />
            <Area type="monotone" dataKey="moomba"    stackId="1" name="Moomba (Cooper Basin, SE)"     fill={CHART_COLORS.moomba}   stroke={CHART_COLORS.moomba}   fillOpacity={0.85} />
            <Area type="monotone" dataKey="se_otway"  stackId="1" name="Otway Basin (Otway, ATHENA)"   fill="#34d399"               stroke="#34d399"               fillOpacity={0.85} />
            <Area type="monotone" dataKey="se_gipps"  stackId="1" name="Gippsland Other (Orbost, Lang Lang)" fill="#a78bfa"         stroke="#a78bfa"               fillOpacity={0.85} />
            <Area type="monotone" dataKey="se_other"  stackId="1" name="Other SE"                      fill="#484f58"               stroke="#484f58"               fillOpacity={0.85} />
          </ComposedChart>
        </ResponsiveContainer>
        <Legend items={[
          { color: CHART_COLORS.longford, label: 'Longford — Gippsland Basin (Bass Strait)' },
          { color: CHART_COLORS.moomba,   label: 'Moomba — Cooper Basin (SA/QLD border)' },
          { color: '#34d399',             label: 'Otway Basin — Otway, ATHENA (Port Campbell area)' },
          { color: '#a78bfa',             label: 'Gippsland Other — Orbost, Lang Lang' },
          { color: '#484f58',             label: 'Other SE' },
        ]} />
      </ChartCard>

      {/* Production source breakdown — total incl QLD */}
      <ChartCard
        id="chart-prod-breakdown"
        title={`${latestYear} Total Production by Source (incl. QLD)`}
        subtitle="Stacked daily production: SE sources + QLD CSG sub-groups (TJ/day)"
        onExportPPT={() => handleExportPPT('chart-prod-breakdown', `${latestYear} Production by Source`)}
        onExportXLSX={() => exportToExcel(records.filter(r => r.year === latestYear))}
      >
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={latestProdBreakdown} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="date" {...AXIS_STYLE} tickFormatter={fmtDate} interval={Math.floor(latestProdBreakdown.length / 12)} />
            <YAxis {...AXIS_STYLE} tickFormatter={v => `${v.toLocaleString()}`} />
            <Tooltip content={<CustomTooltip formatter={(v) => `${Math.round(v).toLocaleString()} TJ`} labelFormatter={fmtDate} />} />
            <Area type="monotone" dataKey="longford"  stackId="1" name="Longford (Gippsland)"          fill={CHART_COLORS.longford} stroke={CHART_COLORS.longford} fillOpacity={0.85} />
            <Area type="monotone" dataKey="moomba"    stackId="1" name="Moomba (Cooper Basin)"          fill={CHART_COLORS.moomba}   stroke={CHART_COLORS.moomba}   fillOpacity={0.85} />
            <Area type="monotone" dataKey="other"     stackId="1" name="Other SE (Otway/Gippsland)"     fill="#34d399"               stroke="#34d399"               fillOpacity={0.85} />
            <Area type="monotone" dataKey="qld_roma"  stackId="1" name="QLD — Roma/Wallumbilla area"    fill="#f59e0b"               stroke="#f59e0b"               fillOpacity={0.85} />
            <Area type="monotone" dataKey="qld_aplng" stackId="1" name="QLD — APLNG Surat Basin"        fill={CHART_COLORS.swqp}     stroke={CHART_COLORS.swqp}     fillOpacity={0.85} />
            <Area type="monotone" dataKey="qld_glng"  stackId="1" name="QLD — GLNG/Santos Surat Basin"  fill="#fb7185"               stroke="#fb7185"               fillOpacity={0.75} />
            <Area type="monotone" dataKey="qld_other" stackId="1" name="QLD — Other"                    fill="#484f58"               stroke="#484f58"               fillOpacity={0.85} />
          </ComposedChart>
        </ResponsiveContainer>
        <Legend items={[
          { color: CHART_COLORS.longford, label: 'Longford — Gippsland Basin' },
          { color: CHART_COLORS.moomba,   label: 'Moomba — Cooper Basin (SE)' },
          { color: '#34d399',             label: 'Other SE — Otway / Gippsland satellites' },
          { color: '#f59e0b',             label: 'QLD — Roma / Wallumbilla area (Ruby Jo, Combabula, Jordan, Roma)' },
          { color: CHART_COLORS.swqp,     label: 'QLD — APLNG Surat Basin (Condabri, Orana, Woleebee Creek etc.)' },
          { color: '#fb7185',             label: 'QLD — GLNG / Santos Surat Basin (Fairview, Kenya, Scotia etc.)' },
          { color: '#484f58',             label: 'QLD — Other' },
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
            <Tooltip content={<CustomTooltip formatter={(v) => `${v} labelFormatter={fmtDate}%`} />} />
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
