import {
  ComposedChart, Area, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';
import { useMemo } from 'react';
import { ChartCard, KpiCard, CustomTooltip, AXIS_STYLE, GRID_STYLE, YEAR_COLORS, Legend, fmtDate } from '../components/ChartCard';
import { exportToPowerPoint, exportToExcel } from '../utils/exportUtils';

export default function TabStorage({ records, selectedYears, dateRange }) {
  const latestYear = Math.max(...selectedYears);

  // (yoyStorage removed — data is incorporated in storageOverlay below)

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
        // aemoParser convention: storage_iona = supply − demand (STOR rows)
        // positive → withdrawal (gas leaving storage, winter supply): show as positive green bar
        // negative → injection (gas entering storage, summer surplus): show as negative red bar
        withdrawal: r.storage_iona > 0 ? -r.storage_iona : 0,  // negative = withdrawal (bars down)
        injection:  r.storage_iona < 0 ? -r.storage_iona : 0,  // positive = injection (bars up)
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
            <Tooltip content={<CustomTooltip formatter={(v) => `${Math.round(v).toLocaleString()} TJ`}  labelFormatter={fmtDate} /> } />
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
            <XAxis dataKey="date" {...AXIS_STYLE} tickFormatter={fmtDate} interval={Math.floor(storageFlows.length / 12)} />
            <YAxis {...AXIS_STYLE} />
            <Tooltip content={<CustomTooltip formatter={(v) => `${Math.round(v).toLocaleString()} TJ`}  labelFormatter={fmtDate} /> } />
            <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1.5} />
            <Bar dataKey="withdrawal" name="Withdrawal" fill="#3fb950" maxBarSize={6} />
            <Bar dataKey="injection"  name="Injection"  fill="#f85149" maxBarSize={6} />
          </ComposedChart>
        </ResponsiveContainer>
        <Legend items={[
          { color: '#3fb950', label: 'Injection (TJ/day, positive = gas into storage)' },
          { color: '#f85149', label: 'Withdrawal (TJ/day, negative = gas out of storage)' },
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
