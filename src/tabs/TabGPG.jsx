import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Cell
} from 'recharts';
import { useMemo } from 'react';
import { ChartCard, KpiCard, CustomTooltip, AXIS_STYLE, GRID_STYLE, CHART_COLORS, YEAR_COLORS, Legend, fmtDate } from '../components/ChartCard';
import { exportToPowerPoint, exportToExcel } from '../utils/exportUtils';

const THRESHOLDS = [400, 500, 600, 700];

export default function TabGPG({ records, selectedYears, dateRange }) {
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
            <XAxis dataKey="date" {...AXIS_STYLE} tickFormatter={fmtDate} interval={Math.floor(latestGPG.length / 12)} />
            <YAxis {...AXIS_STYLE} />
            <Tooltip content={<CustomTooltip formatter={(v) => `${Math.round(v).toLocaleString()} TJ`}  labelFormatter={fmtDate} /> } />
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
            <Tooltip content={<CustomTooltip formatter={(v, n) => n.startsWith('d') ? `${v} labelFormatter={fmtDate} days` : `${v?.toLocaleString()} TJ`} />} />
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
