import {
  ComposedChart, AreaChart, Area, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';
import { useMemo, useState } from 'react';
import { ChartCard, KpiCard, CustomTooltip, AXIS_STYLE, GRID_STYLE, YEAR_COLORS, Legend } from '../components/ChartCard';
import { exportToPowerPoint, exportToExcel } from '../utils/exportUtils';

const STATE_COLORS = {
  VIC: '#388bfd',
  NSW: '#3fb950',
  SA:  '#e6a817',
  TAS: '#bc8cff',
};

const STATES = ['VIC', 'NSW', 'SA', 'TAS'];

export default function TabStateBreakdown({ records, selectedYears, dateRange }) {
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
            <XAxis dataKey="date" {...AXIS_STYLE} tickFormatter={fmtDate} interval={Math.floor(yearDaily.length / 12)} />
            <YAxis {...AXIS_STYLE} tickFormatter={v => v.toLocaleString()} />
            <Tooltip content={<CustomTooltip formatter={v => `${Math.round(v).toLocaleString()} TJ`}  labelFormatter={fmtDate} /> } />
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
            <XAxis dataKey="date" {...AXIS_STYLE} tickFormatter={fmtDate} interval={Math.floor(yearDaily.length / 12)} />
            <YAxis {...AXIS_STYLE} />
            <Tooltip content={<CustomTooltip formatter={v => `${Math.round(v).toLocaleString()} TJ`}  labelFormatter={fmtDate} /> } />
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
            <XAxis dataKey="date" {...AXIS_STYLE} tickFormatter={fmtDate} interval={Math.floor(yearDaily.length / 12)} />
            <YAxis {...AXIS_STYLE} tickFormatter={v => v.toLocaleString()} />
            <Tooltip content={<CustomTooltip formatter={v => `${Math.round(v).toLocaleString()} TJ`}  labelFormatter={fmtDate} /> } />
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
              <Tooltip content={<CustomTooltip formatter={v => `${Math.round(v).toLocaleString()} TJ/day avg`}  labelFormatter={fmtDate} /> } />
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
              <Tooltip content={<CustomTooltip formatter={v => `${Math.round(v).toLocaleString()} TJ`}  labelFormatter={fmtDate} /> } />
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
