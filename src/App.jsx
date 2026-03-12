import { useState, useEffect, useCallback } from 'react';
import { fetchAEMOData, loadFromExcel, generateSampleData, computeStats } from './utils/aemoParser';
import { exportToExcel, exportToPowerPoint } from './utils/exportUtils';
import TabDailyDemand from './tabs/TabDailyDemand';
import TabGPG from './tabs/TabGPG';
import TabSupplyCapacity from './tabs/TabSupplyCapacity';
import TabStorage from './tabs/TabStorage';
import TabProduction from './tabs/TabProduction';
import TabStateBreakdown from './tabs/TabStateBreakdown';
import TabFlowMap from './tabs/TabFlowMap';

const TABS = [
  { id: 'demand',     label: 'Daily Demand' },
  { id: 'gpg',        label: 'GPG Analysis' },
  { id: 'supply',     label: 'Supply & Capacity' },
  { id: 'production', label: 'Production' },
  { id: 'storage',    label: 'Storage (Iona)' },
  { id: 'states',     label: 'State Breakdown' },
  { id: 'flowmap',    label: 'Flow Map' },
];

const YEAR_COLORS = {
  2019: '#8b949e', 2020: '#6e7681', 2021: '#79c0ff',
  2022: '#3fb950', 2023: '#ffa657', 2024: '#388bfd', 2025: '#e6a817',
};

const CACHE_KEY = 'ecgm_records_v24';
const CACHE_META_KEY = 'ecgm_records_meta_v24';

function applyData(data, setRecords, setStats, setLastFetch, setSelectedYears, setDateRange, setUsingDemo, fetchedAt) {
  setRecords(data);
  setStats(computeStats(data));
  setLastFetch(fetchedAt ? new Date(fetchedAt) : new Date());
  setUsingDemo(false);
  const years = [...new Set(data.map(r => r.year))].sort();
  setSelectedYears(years.slice(-3));
  if (data.length > 0) setDateRange([data[0].date, data[data.length - 1].date]);
}

export default function App() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadMsg, setLoadMsg] = useState('');
  const [error, setError] = useState('');
  const [usingDemo, setUsingDemo] = useState(false);
  const [activeTab, setActiveTab] = useState('demand');
  const [selectedYears, setSelectedYears] = useState([2023, 2024, 2025]);
  const [dateRange, setDateRange] = useState(['2019-01-01', '2025-12-31']);
  const [stats, setStats] = useState({});
  const [lastFetch, setLastFetch] = useState(null);
  const [exportingPPT, setExportingPPT] = useState(false);

  const loadData = useCallback(async (demo = false) => {
    setLoading(true);
    setError('');
    setLoadMsg(demo ? 'Generating demo data...' : 'Connecting to AEMO...');
    try {
      let data;
      if (demo) {
        data = generateSampleData();
        setUsingDemo(true);
        setRecords(data);
        setStats(computeStats(data));
        setLastFetch(new Date());
        const years = [...new Set(data.map(r => r.year))].sort();
        setSelectedYears(years.slice(-3));
        if (data.length > 0) setDateRange([data[0].date, data[data.length - 1].date]);
      } else {
        data = await fetchAEMOData(setLoadMsg);
        const fetchedAt = new Date();
        applyData(data, setRecords, setStats, setLastFetch, setSelectedYears, setDateRange, setUsingDemo, fetchedAt);
        // Persist to localStorage for next session
        try {
          setLoadMsg('Saving to local cache...');
          localStorage.setItem(CACHE_KEY, JSON.stringify(data));
          localStorage.setItem(CACHE_META_KEY, JSON.stringify({ fetchedAt: fetchedAt.toISOString(), count: data.length }));
        } catch (cacheErr) {
          console.warn('Cache save failed (storage full?):', cacheErr);
        }
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setLoadMsg('');
    }
  }, []);

  // On mount: load from cache if available, otherwise show empty state
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      const meta = localStorage.getItem(CACHE_META_KEY);
      if (raw) {
        setLoadMsg('Loading cached data...');
        setLoading(true);
        const data = JSON.parse(raw);
        const { fetchedAt } = meta ? JSON.parse(meta) : {};
        applyData(data, setRecords, setStats, setLastFetch, setSelectedYears, setDateRange, setUsingDemo, fetchedAt);
        setLoading(false);
        setLoadMsg('');
      }
    } catch (e) {
      console.warn('Cache load failed:', e);
      setLoading(false);
      setLoadMsg('');
    }
  }, []);


  const handleExcelUpload = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setError('');
    setLoadMsg('Reading Excel file...');
    try {
      const data = await loadFromExcel(file, setLoadMsg);
      const fetchedAt = new Date();
      applyData(data, setRecords, setStats, setLastFetch, setSelectedYears, setDateRange, setUsingDemo, fetchedAt);
      // Persist to cache
      try {
        setLoadMsg('Saving to local cache...');
        localStorage.setItem(CACHE_KEY, JSON.stringify(data));
        localStorage.setItem(CACHE_META_KEY, JSON.stringify({ fetchedAt: fetchedAt.toISOString(), count: data.length }));
      } catch (cacheErr) {
        console.warn('Cache save failed:', cacheErr);
      }
    } catch (e) {
      setError('Excel load failed: ' + e.message);
    } finally {
      setLoading(false);
      setLoadMsg('');
      e.target.value = '';
    }
  }, []);

  const toggleYear = (y) => {
    setSelectedYears(prev =>
      prev.includes(y) ? (prev.length > 1 ? prev.filter(x => x !== y) : prev) : [...prev, y].sort()
    );
  };

  const availableYears = records.length ? [...new Set(records.map(r => r.year))].sort() : [2019,2020,2021,2022,2023,2024,2025];

  const handleExportAllPPT = async () => {
    setExportingPPT(true);
    try {
      const charts = [
        { id: 'chart-yoy-demand', title: 'Year-on-Year Daily Demand', subtitle: 'SE States total gas demand (TJ/day)' },
        { id: 'chart-stacked-demand', title: 'Daily Demand by Segment', subtitle: 'Residential / Industrial / GPG (TJ/day)' },
        { id: 'chart-gpg-daily', title: 'GPG Daily Demand', subtitle: 'Gas-fired power generation demand with thresholds' },
        { id: 'chart-gpg-yoy', title: 'GPG Year-on-Year', subtitle: 'Daily GPG overlay by calendar day' },
        { id: 'chart-gpg-thresholds', title: 'GPG Spike Statistics', subtitle: 'Annual threshold breach counts' },
        { id: 'chart-supply-capacity', title: 'Demand vs Supply Capacity', subtitle: 'Stacked demand vs indicative capacity' },
        { id: 'chart-storage-yoy', title: 'Iona Storage Balance', subtitle: 'Year-on-year with historical range' },
        { id: 'chart-prod-yoy', title: 'Production Year-on-Year', subtitle: 'Total daily production by calendar day' },
      ];
      await exportToPowerPoint(charts, 'East_Coast_Gas_Dashboard');
    } catch (e) { alert('PPT export failed: ' + e.message); }
    finally { setExportingPPT(false); }
  };

  const handleExportXLSX = () => {
    if (records.length) exportToExcel(records.filter(r => selectedYears.includes(r.year)));
  };

  const ActiveTab = { demand: TabDailyDemand, gpg: TabGPG, supply: TabSupplyCapacity, production: TabProduction, storage: TabStorage, states: TabStateBreakdown, flowmap: TabFlowMap }[activeTab];

  const btnBase = (color, active) => ({
    padding: '4px 13px', borderRadius: 5,
    border: `1px solid ${active ? color : 'var(--border)'}`,
    background: active ? color + '22' : 'transparent',
    color: active ? color : 'var(--text-muted)',
    cursor: 'pointer', fontSize: 12,
    fontFamily: 'DM Mono, monospace',
    transition: 'all 0.15s', whiteSpace: 'nowrap',
  });

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <header style={{
        background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        padding: '0 24px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', height: 52,
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 7, flexShrink: 0,
            background: 'linear-gradient(135deg, #e6a817 0%, #ff7b72 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15,
          }}>⚡</div>
          <div>
            <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 14, letterSpacing: '-0.02em' }}>
              East Coast Gas Market Dashboard
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>
              AEMO GBB Actual Flow & Storage · SE States
            </div>
          </div>
          {usingDemo && (
            <span style={{
              background: '#e6a81720', border: '1px solid #e6a817',
              borderRadius: 4, padding: '2px 8px',
              fontSize: 10, fontFamily: 'DM Mono, monospace', color: '#e6a817',
            }}>DEMO DATA</span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
          {lastFetch && <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>
            ↻ {lastFetch.toLocaleDateString('en-GB')} {lastFetch.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </span>}
          <button onClick={() => loadData(false)} disabled={loading} style={btnBase('#388bfd', false)}>
            {loading && !usingDemo ? (loadMsg || 'Loading...') : '↻ Fetch AEMO'}
          </button>
          <button onClick={() => loadData(true)} disabled={loading} style={btnBase('var(--text-muted)', false)}>
            Demo
          </button>
          <label style={{
            ...btnBase('#bc8cff', false),
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.5 : 1,
            display: 'inline-block',
          }}>
            ↑ Load XLSX
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleExcelUpload}
              disabled={loading}
              style={{ display: 'none' }}
            />
          </label>
          <button onClick={handleExportXLSX} disabled={!records.length} style={btnBase('#3fb950', false)}>
            ↓ XLSX
          </button>
          <button onClick={handleExportAllPPT} disabled={!records.length || exportingPPT} style={btnBase('#e6a817', false)}>
            {exportingPPT ? 'Exporting...' : '↓ All → PPT'}
          </button>
        </div>
      </header>

      {error && (
        <div style={{
          background: '#f8514915', border: '1px solid #f8514966',
          margin: '10px 24px 0', borderRadius: 6,
          padding: '9px 14px', fontSize: 12, color: '#f85149',
          display: 'flex', justifyContent: 'space-between',
        }}>
          <span>⚠ {error}</span>
          <span style={{ cursor: 'pointer', opacity: 0.7 }} onClick={() => setError('')}>✕</span>
        </div>
      )}

      {/* Controls */}
      <div style={{
        background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        padding: '7px 24px', display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Years</span>
          {availableYears.map(y => (
            <button key={y} onClick={() => toggleYear(y)} style={{
              padding: '3px 9px', borderRadius: 4,
              border: `1px solid ${selectedYears.includes(y) ? YEAR_COLORS[y] || '#888' : 'var(--border)'}`,
              background: selectedYears.includes(y) ? (YEAR_COLORS[y] || '#888') + '22' : 'transparent',
              color: selectedYears.includes(y) ? YEAR_COLORS[y] || '#888' : 'var(--text-muted)',
              cursor: 'pointer', fontSize: 11, fontFamily: 'DM Mono, monospace',
              fontWeight: selectedYears.includes(y) ? 600 : 400, transition: 'all 0.15s',
            }}>{y}</button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Range</span>
          {['from', 'to'].map((label, i) => (
            <input key={label} type="date" value={dateRange[i]}
              onChange={e => setDateRange(i === 0 ? [e.target.value, dateRange[1]] : [dateRange[0], e.target.value])}
              style={{
                background: 'var(--surface2)', border: '1px solid var(--border)',
                borderRadius: 4, padding: '3px 8px', color: 'var(--text)',
                fontSize: 11, fontFamily: 'DM Mono, monospace',
              }} />
          ))}
        </div>

        {records.length > 0 && (
          <span style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'DM Mono, monospace', marginLeft: 'auto' }}>
            {records.length.toLocaleString()} records
          </span>
        )}
      </div>

      {/* Tab nav */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 24px', background: 'var(--surface)' }}>
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            padding: '11px 18px', border: 'none',
            borderBottom: `2px solid ${activeTab === tab.id ? 'var(--accent)' : 'transparent'}`,
            background: 'transparent',
            color: activeTab === tab.id ? 'var(--text)' : 'var(--text-muted)',
            cursor: 'pointer', fontSize: 13,
            fontFamily: 'Syne, sans-serif',
            fontWeight: activeTab === tab.id ? 600 : 400,
            transition: 'color 0.15s', whiteSpace: 'nowrap',
          }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <main style={{ flex: 1, padding: '24px 24px 32px', maxWidth: 1600, width: '100%', margin: '0 auto', alignSelf: 'stretch' }}>
        {loading && records.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 400, gap: 16 }}>
            <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid var(--border)', borderTopColor: 'var(--accent)', animation: 'spin 0.8s linear infinite' }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <div style={{ fontFamily: 'DM Mono, monospace', color: 'var(--text-muted)', fontSize: 12 }}>{loadMsg}</div>
          </div>
        ) : records.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 400, gap: 18, textAlign: 'center' }}>
            <div style={{ fontSize: 44 }}>⚡</div>
            <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 20 }}>No data loaded</div>
            <div style={{ color: 'var(--text-muted)', maxWidth: 380, lineHeight: 1.6, fontSize: 13 }}>
              Fetch live data from AEMO or load demo data to explore the dashboard.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              {[['Fetch AEMO Data', () => loadData(false), '#388bfd'], ['Load Demo Data', () => loadData(true), '#e6a817']].map(([label, fn, color]) => (
                <button key={label} onClick={fn} style={{
                  padding: '9px 22px', borderRadius: 6,
                  border: `1px solid ${color}`, background: color + '22',
                  color, cursor: 'pointer', fontSize: 13,
                  fontFamily: 'Syne, sans-serif', fontWeight: 600,
                }}>{label}</button>
              ))}
            </div>
          </div>
        ) : (
          <ActiveTab records={records} selectedYears={selectedYears} dateRange={dateRange} stats={stats} />
        )}
      </main>

      <footer style={{
        borderTop: '1px solid var(--border)', padding: '8px 24px',
        display: 'flex', justifyContent: 'space-between',
        fontSize: 10, color: 'var(--text-dim)', fontFamily: 'DM Mono, monospace',
      }}>
        <span>Source: AEMO GBB Actual Flow &amp; Storage — nemweb.com.au</span>
        <span>SE States: VIC, NSW, SA, TAS · Capacity figures are indicative only</span>
      </footer>
    </div>
  );
}
