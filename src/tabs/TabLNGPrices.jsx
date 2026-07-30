import {
  LineChart, Line, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';
import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import {
  ChartCard, CustomTooltip, AXIS_STYLE, GRID_STYLE, Legend,
} from '../components/ChartCard';
import { exportToPowerPoint, exportToExcel } from '../utils/exportUtils';
import { idbGet, idbSet } from '../utils/idbCache';
import { parseLngWorkbookFile, buildChartDatasets, recomputeJkmForward, recomputeBrentTermStructure, backfillBrentNetbackFromSpot } from '../utils/lngPriceParser';
import { parseCmePasteText } from '../utils/cmeSettlementParser';
import { parseOfxAudUsdFile, parseOfxAudUsdWorkbook, mergeAudUsdSeries } from '../utils/audUsdOfxParser';
import { fetchLatestGshBenchmark } from '../utils/gshBenchmarkParser';
import { parseBrentSpotFile, fetchBrentSpotFile } from '../utils/brentSpotParser';

const ACCC_LNG_PAGE = 'https://www.accc.gov.au/inquiries-and-consultations/gas-inquiry-2017-30/lng-netback-price-series';
const CACHE_KEY = 'lng_netback_price_series_v1';
const OFX_CACHE_KEY = 'lng_audusd_ofx_override_v1';
const GSH_CACHE_KEY = 'lng_gsh_wallumbilla_benchmark_v1';
const BRENT_SPOT_CACHE_KEY = 'lng_brent_spot_backfill_v1';

const COLORS = {
  jkm: '#79c0ff',
  jkmForward: '#79c0ff',
  brent: '#ffa657',
  aud: '#3fb950',
  audAvg: '#8b949e',
  jkmNetback: '#79c0ff',
  brentNetback: '#ffa657',
  cme: '#e6a817',
  ofx: '#3fb950',
  gsh: '#d16bf5',
  brentSpot: '#f0883e',
};

function mergeExtraByMonth(baseArray, extra, key) {
  if (!extra?.length) return baseArray;
  const map = new Map(baseArray.map(r => [r.month, { ...r }]));
  for (const { month, value } of extra) {
    if (!map.has(month)) map.set(month, { month });
    map.get(month)[key] = value;
  }
  return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
}

// ── Formatting helpers ───────────────────────────────────────────────────────
function monthLabel(m) {
  if (!m) return '';
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1, 1));
  return d.toLocaleDateString('en-AU', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}
function monthLabelLong(m) {
  if (!m) return '';
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1, 1));
  return d.toLocaleDateString('en-AU', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}
function dayLabel(dstr) {
  if (!dstr) return '';
  const [y, mo, da] = dstr.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1, da));
  return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
function dayTick(dstr) {
  if (!dstr) return '';
  const [y, mo] = dstr.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1, 1));
  return d.toLocaleDateString('en-AU', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}
function fmtNum(n, dp = 2) {
  return typeof n === 'number' ? n.toFixed(dp) : '–';
}

function monthTickInterval(len) {
  return Math.max(1, Math.floor(len / 14));
}

export default function TabLNGPrices() {
  const [parsed, setParsed] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [sourceLabel, setSourceLabel] = useState('');
  const fileInputRef = useRef(null);

  // ── OFX AUD/USD override (cleaner, longer-history FX source; on by default) ──
  const [ofxAudUsd, setOfxAudUsd] = useState(null); // { series, warnings, fileName, sourceKind }
  const [ofxDisabled, setOfxDisabled] = useState(false); // "revert to ACCC FX" toggle
  const [ofxError, setOfxError] = useState('');
  const ofxFileInputRef = useRef(null);

  // Candidate paths for the locally-updated OFX extract, matching this app's
  // existing convention of serving local data files from /data/ (see the
  // hourly-forecast auto-fetch below). Peter updates this file from time to
  // time at C:\Users\peter\Python\data\USD per AUD from 20150101.xlsx, which
  // is expected to be served at the same relative path.
  const OFX_AUTOFETCH_CANDIDATES = [
    '/data/USD per AUD from 20150101.xlsx',
    '/data/USD_per_AUD_from_20150101.xlsx',
    '/data/USD per AUD from 20150101.xls',
  ];

  // ── Wallumbilla GSH Benchmark Price (actual domestic spot, auto-fetched daily) ──
  const [gshBenchmark, setGshBenchmark] = useState(null); // { daily, monthly, sourceDate }
  const [gshError, setGshError] = useState('');

  // ── Brent spot backfill (EIA, extends Brent netback before ACCC's Aug-2022 start) ──
  const [brentSpot, setBrentSpot] = useState(null); // { daily, monthly, fileName, sourceKind }
  const [brentSpotError, setBrentSpotError] = useState('');
  const brentSpotFileInputRef = useRef(null);
  const BRENT_SPOT_AUTOFETCH_CANDIDATES = ['/data/Europe_Brent_Spot_Price_FOB.csv'];

  const handleBrentSpotFile = useCallback(async (file) => {
    if (!file) return;
    setBrentSpotError('');
    try {
      const { daily, monthly } = await parseBrentSpotFile(file);
      const record = { daily, monthly, fileName: file.name, sourceKind: 'uploaded', cachedAt: new Date().toISOString() };
      setBrentSpot(record);
      try { await idbSet(BRENT_SPOT_CACHE_KEY, record); } catch (e) { console.warn('Brent spot cache write failed:', e); }
    } catch (e) {
      setBrentSpotError(`Could not parse Brent spot file: ${e.message}`);
    }
  }, []);

  const handleOfxFile = useCallback(async (file) => {
    if (!file) return;
    setOfxError('');
    try {
      const { series, warnings } = await parseOfxAudUsdFile(file);
      const record = { series, warnings, fileName: file.name, sourceKind: 'uploaded', cachedAt: new Date().toISOString() };
      setOfxAudUsd(record);
      setOfxDisabled(false);
      try { await idbSet(OFX_CACHE_KEY, record); } catch (e) { console.warn('OFX cache write failed:', e); }
    } catch (e) {
      setOfxError(`Could not parse OFX file: ${e.message}`);
    }
  }, []);

  const toggleOfxDisabled = useCallback(() => {
    setOfxDisabled(d => !d);
  }, []);

  // ── CME daily update (paste-based; see panel below for why) ─────────────
  const [cmeJkmText, setCmeJkmText] = useState('');
  const [cmeBrentText, setCmeBrentText] = useState('');
  const [cmeSlope, setCmeSlope] = useState('');
  const [cmeJkmResult, setCmeJkmResult] = useState(null);
  const [cmeBrentResult, setCmeBrentResult] = useState(null);
  const [cmeError, setCmeError] = useState('');
  const [cmePanelOpen, setCmePanelOpen] = useState(false);

  // AUD/USD merge must be declared before any callback that closes over it
  const effectiveParsed = useMemo(() => {
    if (!parsed) return null;
    if (ofxDisabled || !ofxAudUsd?.series?.length) return parsed;
    return { ...parsed, audUsd: mergeAudUsdSeries(ofxAudUsd.series, parsed.audUsd) };
  }, [parsed, ofxAudUsd, ofxDisabled]);

  const applyCmeJkm = useCallback(() => {
    setCmeError('');
    try {
      const { rows, skippedCount } = parseCmePasteText(cmeJkmText);
      const result = recomputeJkmForward(effectiveParsed, rows);
      setCmeJkmResult({ ...result, rowCount: rows.length, skippedCount });
    } catch (e) {
      setCmeError(`JKM paste: ${e.message}`);
    }
  }, [cmeJkmText, effectiveParsed]);

  const applyCmeBrent = useCallback(() => {
    setCmeError('');
    try {
      const { rows, skippedCount } = parseCmePasteText(cmeBrentText);
      const slopeOverride = cmeSlope.trim() ? Number(cmeSlope) : undefined;
      const result = recomputeBrentTermStructure(effectiveParsed, rows, { slopePercent: slopeOverride });
      setCmeBrentResult({ ...result, rowCount: rows.length, skippedCount });
    } catch (e) {
      setCmeError(`Brent paste: ${e.message}`);
    }
  }, [cmeBrentText, cmeSlope, effectiveParsed]);

  const applyParsed = useCallback((p, source) => {
    setParsed(p);
    setSourceLabel(source);
    setLastUpdated(new Date());
    if (p.warnings?.length) {
      console.warn('LNG netback parser warnings:', p.warnings);
    }
  }, []);

  // On mount: load cached parsed data if available. We cache the already
  // -parsed (small) dataset rather than the raw workbook, since the raw
  // file is ~1MB and re-parsing on every load is unnecessary.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cached = await idbGet(CACHE_KEY);
        if (cached && !cancelled) {
          setParsed(cached.parsed);
          setSourceLabel(cached.sourceLabel || 'cached upload');
          setLastUpdated(cached.cachedAt ? new Date(cached.cachedAt) : null);
        }
      } catch (e) {
        console.warn('LNG price cache read failed:', e);
      }
      try {
        const cachedOfx = await idbGet(OFX_CACHE_KEY);
        if (cachedOfx && !cancelled) setOfxAudUsd(cachedOfx);
      } catch (e) {
        console.warn('OFX cache read failed:', e);
      }
      try {
        const cachedGsh = await idbGet(GSH_CACHE_KEY);
        if (cachedGsh && !cancelled) setGshBenchmark(cachedGsh);
      } catch (e) {
        console.warn('GSH benchmark cache read failed:', e);
      }
      try {
        const cachedBrentSpot = await idbGet(BRENT_SPOT_CACHE_KEY);
        if (cachedBrentSpot && !cancelled) setBrentSpot(cachedBrentSpot);
      } catch (e) {
        console.warn('Brent spot cache read failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Try to auto-load Peter's locally-updated OFX AUD/USD extract from the
  // app's /data/ folder (same convention as the hourly forecast auto-fetch
  // elsewhere in this app). Runs after any cached copy is shown, so the
  // chart appears instantly and silently refreshes if a newer file is found.
  // Not finding it here is expected/normal (e.g. this file simply hasn't
  // been placed in /data/ yet, or this build isn't served from that root),
  // so failures here are logged, not surfaced as an error.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const path of OFX_AUTOFETCH_CANDIDATES) {
        try {
          const res = await fetch(encodeURI(path));
          if (!res.ok) continue;
          const buf = await res.arrayBuffer();
          const { series, warnings } = parseOfxAudUsdWorkbook(buf);
          if (cancelled) return;
          const record = { series, warnings, fileName: path.split('/').pop(), sourceKind: 'auto-fetched', cachedAt: new Date().toISOString() };
          setOfxAudUsd(record);
          try { await idbSet(OFX_CACHE_KEY, record); } catch (e) { console.warn('OFX cache write failed:', e); }
          return;
        } catch (e) {
          // Not found / not served from this path — try the next candidate
        }
      }
      console.info('LNG Prices: no local OFX AUD/USD file found at', OFX_AUTOFETCH_CANDIDATES, '— using ACCC FX data unless one is uploaded.');
    })();
    return () => { cancelled = true; };
  }, []);

  // Auto-fetch the Wallumbilla GSH Benchmark Price via the app's AEMO proxy.
  // Each daily file contains the FULL history (back to 2014), so this is a
  // single fetch, not a backfill loop — same /aemo-proxy/ route the
  // DWGM/STTM fetchers already use for CORS. Runs after any cached copy is
  // shown, so the chart appears instantly and silently refreshes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await fetchLatestGshBenchmark();
        if (cancelled) return;
        const record = { ...result, cachedAt: new Date().toISOString() };
        setGshBenchmark(record);
        try { await idbSet(GSH_CACHE_KEY, record); } catch (e) { console.warn('GSH benchmark cache write failed:', e); }
      } catch (e) {
        console.info('LNG Prices: GSH Benchmark Price auto-fetch failed —', e.message);
        if (!cancelled) setGshError(e.message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Try to auto-load the EIA Brent spot price extract from /data/ (same
  // local-file convention as the OFX AUD/USD file). Not finding it here is
  // expected/normal — falls through to manual upload, and the Brent netback
  // chart just won't extend before the ACCC's own Aug-2022 start.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const path of BRENT_SPOT_AUTOFETCH_CANDIDATES) {
        try {
          const { daily, monthly } = await fetchBrentSpotFile(encodeURI(path));
          if (cancelled) return;
          const record = { daily, monthly, fileName: path.split('/').pop(), sourceKind: 'auto-fetched', cachedAt: new Date().toISOString() };
          setBrentSpot(record);
          try { await idbSet(BRENT_SPOT_CACHE_KEY, record); } catch (e) { console.warn('Brent spot cache write failed:', e); }
          return;
        } catch (e) {
          // Not found / not served from this path — try the next candidate
        }
      }
      console.info('LNG Prices: no local Brent spot file found at', BRENT_SPOT_AUTOFETCH_CANDIDATES, '— Brent netback backfill unavailable unless uploaded.');
    })();
    return () => { cancelled = true; };
  }, []);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      const p = await parseLngWorkbookFile(file);
      applyParsed(p, `uploaded: ${file.name}`);
      try {
        await idbSet(CACHE_KEY, { parsed: p, sourceLabel: `uploaded: ${file.name}`, cachedAt: new Date().toISOString() });
      } catch (e) {
        console.warn('LNG price cache write failed:', e);
      }
    } catch (e) {
      setError(`Could not parse file: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [applyParsed]);

  const datasets = useMemo(() => (effectiveParsed ? buildChartDatasets(effectiveParsed) : null), [effectiveParsed]);

  const brentBackfill = useMemo(() => {
    if (!effectiveParsed || !brentSpot?.monthly?.length) return null;
    try {
      return backfillBrentNetbackFromSpot(effectiveParsed, brentSpot.monthly);
    } catch (e) {
      console.warn('Brent netback backfill failed:', e.message);
      return null;
    }
  }, [effectiveParsed, brentSpot]);

  const mergedJkmChart = useMemo(() => {
    if (!datasets) return null;
    return mergeExtraByMonth(datasets.jkmChart, cmeJkmResult?.forward, 'cme');
  }, [datasets, cmeJkmResult]);

  const mergedBrentChart = useMemo(() => {
    if (!datasets) return null;
    const spotRows = brentBackfill?.rows.map(r => ({ month: r.month, value: r.avgBrentUsdBbl }));
    return mergeExtraByMonth(datasets.brentChart, spotRows, 'spotBackfill');
  }, [datasets, brentBackfill]);

  const mergedNetbackChart = useMemo(() => {
    if (!datasets) return null;
    let chart = mergeExtraByMonth(datasets.netbackChart, cmeJkmResult?.netbackForward, 'jkmCme');
    chart = mergeExtraByMonth(chart, gshBenchmark?.monthly, 'wallumbillaSpot');
    const backfillRows = brentBackfill?.rows.map(r => ({ month: r.month, value: r.netbackAudGj }));
    chart = mergeExtraByMonth(chart, backfillRows, 'brentSpotBackfill');
    return chart;
  }, [datasets, cmeJkmResult, gshBenchmark, brentBackfill]);

  const handleExportPPT = (id, title) => exportToPowerPoint?.(id, title);
  const handleExportXLSX = (rows, name) => exportToExcel?.(rows, name);

  if (!parsed) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 420, gap: 16, textAlign: 'center' }}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 20 }}>LNG Prices</div>
        <div style={{ color: 'var(--text-muted)', maxWidth: 460, lineHeight: 1.6, fontSize: 13 }}>
          This tab is built from the ACCC's LNG netback price series workbook, published twice a month.
          Since the file name changes with every release and the ACCC site doesn't allow direct
          browser fetches, download the latest file and upload it here.
        </div>
        <a href={ACCC_LNG_PAGE} target="_blank" rel="noreferrer" style={{ color: '#388bfd', fontSize: 12, fontFamily: 'DM Mono, monospace' }}>
          → Open ACCC LNG netback price series page
        </a>
        <input
          ref={fileInputRef} type="file" accept=".xlsx" style={{ display: 'none' }}
          onChange={e => handleFile(e.target.files?.[0])}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={loading}
          style={{
            padding: '9px 22px', borderRadius: 6, border: '1px solid #388bfd',
            background: '#388bfd22', color: '#388bfd', cursor: 'pointer',
            fontSize: 13, fontFamily: 'Syne, sans-serif', fontWeight: 600,
          }}
        >
          {loading ? 'Parsing...' : 'Upload LNG netback price series (.xlsx)'}
        </button>
        {error && <div style={{ color: '#f85149', fontSize: 12, maxWidth: 460 }}>⚠ {error}</div>}
      </div>
    );
  }

  const { audChart, latest } = datasets;
  const jkmChart = mergedJkmChart;
  const brentChart = mergedBrentChart;
  const netbackChart = mergedNetbackChart;
  const jkmForwardStartMonth = parsed.jkmSettlement.forward[0]?.month;
  const netbackForwardStartMonth = parsed.jkmNetback.forward[0]?.month;
  const audTickInterval = Math.max(1, Math.floor(audChart.length / 16));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header / refresh controls */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
        background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 16px',
      }}>
        <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: 'var(--text-muted)' }}>
          Source: ACCC LNG netback price series ({sourceLabel})
          {lastUpdated && <> · loaded {lastUpdated.toLocaleDateString('en-GB')} {lastUpdated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</>}
          {latest.asOf && <> · latest JKM quote {dayLabel(latest.asOf)}</>}
          {gshBenchmark && <> · Wallumbilla spot to {gshBenchmark.daily.at(-1)?.date}</>}
        </div>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <a href={ACCC_LNG_PAGE} target="_blank" rel="noreferrer" style={{
            fontSize: 11, fontFamily: 'DM Mono, monospace', color: '#388bfd', alignSelf: 'center',
          }}>
            ACCC page ↗
          </a>
          <input
            ref={fileInputRef} type="file" accept=".xlsx" style={{ display: 'none' }}
            onChange={e => handleFile(e.target.files?.[0])}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            style={{
              padding: '5px 12px', borderRadius: 4, border: '1px solid #388bfd',
              background: '#388bfd22', color: '#388bfd', cursor: 'pointer',
              fontSize: 11, fontFamily: 'DM Mono, monospace', fontWeight: 600,
            }}
          >
            {loading ? 'Parsing...' : '↻ Upload newer file'}
          </button>
          <input
            ref={ofxFileInputRef} type="file" accept=".xlsx" style={{ display: 'none' }}
            onChange={e => handleOfxFile(e.target.files?.[0])}
          />
          <button
            onClick={() => ofxFileInputRef.current?.click()}
            style={{
              padding: '5px 12px', borderRadius: 4, border: `1px solid ${COLORS.ofx}`,
              background: `${COLORS.ofx}22`, color: COLORS.ofx, cursor: 'pointer',
              fontSize: 11, fontFamily: 'DM Mono, monospace', fontWeight: 600,
            }}
          >
            {ofxAudUsd ? '↻ Replace OFX AUD/USD' : 'Upload OFX AUD/USD'}
          </button>
          {ofxAudUsd && (
            <button
              onClick={toggleOfxDisabled}
              style={{
                padding: '5px 10px', borderRadius: 4, border: '1px solid var(--border)',
                background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
                fontSize: 11, fontFamily: 'DM Mono, monospace',
              }}
            >
              {ofxDisabled ? '↺ use OFX AUD/USD' : '✕ revert to ACCC FX'}
            </button>
          )}
          <input
            ref={brentSpotFileInputRef} type="file" accept=".csv" style={{ display: 'none' }}
            onChange={e => handleBrentSpotFile(e.target.files?.[0])}
          />
          <button
            onClick={() => brentSpotFileInputRef.current?.click()}
            style={{
              padding: '5px 12px', borderRadius: 4, border: `1px solid ${COLORS.brentSpot}`,
              background: `${COLORS.brentSpot}22`, color: COLORS.brentSpot, cursor: 'pointer',
              fontSize: 11, fontFamily: 'DM Mono, monospace', fontWeight: 600,
            }}
          >
            {brentSpot ? '↻ Replace Brent spot (EIA)' : 'Upload Brent spot (EIA)'}
          </button>
        </div>
        {ofxAudUsd && !ofxDisabled && (
          <div style={{ width: '100%', fontSize: 11, color: COLORS.ofx, fontFamily: 'DM Mono, monospace' }}>
            ✓ Using OFX AUD/USD ({ofxAudUsd.fileName}, {ofxAudUsd.sourceKind === 'auto-fetched' ? 'auto-loaded from /data/' : ofxAudUsd.sourceKind}) as the primary FX source,
            {' '}{ofxAudUsd.series.length.toLocaleString()} daily rates ({ofxAudUsd.series[0]?.date} → {ofxAudUsd.series.at(-1)?.date}); ACCC's own FX data fills in dates after that.
            {ofxAudUsd.warnings?.length > 0 && <> {ofxAudUsd.warnings.join(' ')}</>}
          </div>
        )}
        {ofxAudUsd && ofxDisabled && (
          <div style={{ width: '100%', fontSize: 11, color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>
            Using ACCC's own AUD/USD data (OFX override disabled — {ofxAudUsd.fileName} is still loaded, click "use OFX AUD/USD" to re-enable it).
          </div>
        )}
        {brentBackfill && (
          <div style={{ width: '100%', fontSize: 11, color: COLORS.brentSpot, fontFamily: 'DM Mono, monospace' }}>
            ✓ Brent netback backfilled {brentBackfill.rows[0]?.month} → {brentBackfill.rows.at(-1)?.month} using EIA spot price ({brentSpot.sourceKind === 'auto-fetched' ? 'auto-loaded from /data/' : brentSpot.sourceKind}),
            {' '}earliest available slope/freight/efficiency held flat.
          </div>
        )}
        {ofxError && <div style={{ width: '100%', color: '#f85149', fontSize: 11 }}>⚠ {ofxError}</div>}
        {brentSpotError && <div style={{ width: '100%', color: '#f85149', fontSize: 11 }}>⚠ {brentSpotError}</div>}
        {error && <div style={{ width: '100%', color: '#f85149', fontSize: 11 }}>⚠ {error}</div>}
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        {[
          ['Latest JKM settlement', latest.jkmSettlement, 'US$/MMBtu', COLORS.jkm],
          ['Brent Year-1 futures', latest.brentYear1, 'US$/bbl', COLORS.brent],
          ['AUD/USD', latest.audUsd, '', COLORS.aud],
          ['JKM netback @ Wallumbilla', latest.jkmNetback, 'A$/GJ', COLORS.jkmNetback],
          ['Brent Y1 netback @ Wallumbilla', latest.brentNetback, 'A$/GJ', COLORS.brentNetback],
        ].map(([label, value, unit, color]) => (
          <div key={label} style={{
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px',
          }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'Syne, sans-serif', color }}>
              {value != null ? fmtNum(value, unit === '' ? 4 : 2) : '–'}
              {unit && <span style={{ fontSize: 11, marginLeft: 4, color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>{unit}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* CME daily update panel */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 16px' }}>
        <div
          onClick={() => setCmePanelOpen(o => !o)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}
        >
          <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: 13 }}>
            {cmePanelOpen ? '▾' : '▸'} Update JKM / Brent with CME daily settlements
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>
            (extends the curve &amp; refreshes between ACCC releases)
          </span>
        </div>
        {cmePanelOpen && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              CME's settlement pages are rendered client-side and don't allow direct browser fetches, so copy the
              settlement table (including its header row) from{' '}
              <a href="https://www.cmegroup.com/markets/energy/natural-gas/lng-japan-korea-marker-platts-swap.settlements.html" target="_blank" rel="noreferrer" style={{ color: '#388bfd' }}>
                CME's JKM Swap futures page
              </a>{' '}
              and/or{' '}
              <a href="https://www.cmegroup.com/markets/energy/crude-oil/brent-crude-oil.settlements.html" target="_blank" rel="noreferrer" style={{ color: '#388bfd' }}>
                CME's Brent Crude futures page
              </a>, then paste below. Netback prices are recomputed from these prices using the ACCC's own
              published freight / AUD-USD / plant-cost / efficiency assumptions (held flat beyond the ACCC's own
              horizon, where noted).
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <div style={{ fontSize: 11, fontFamily: 'DM Mono, monospace', marginBottom: 4 }}>JKM Swap futures (Month + Settle)</div>
                <textarea
                  value={cmeJkmText} onChange={e => setCmeJkmText(e.target.value)}
                  placeholder={'Month\tSettle\nAUG 2026\t16.90\nSEP 2026\t17.10\n...'}
                  rows={6}
                  style={{ width: '100%', fontFamily: 'DM Mono, monospace', fontSize: 11, background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, resize: 'vertical' }}
                />
                <button
                  onClick={applyCmeJkm} disabled={!cmeJkmText.trim()}
                  style={{ marginTop: 6, padding: '5px 14px', borderRadius: 4, border: '1px solid #e6a817', background: '#e6a81722', color: '#e6a817', cursor: 'pointer', fontSize: 11, fontFamily: 'DM Mono, monospace', fontWeight: 600 }}
                >
                  Apply JKM update
                </button>
                {cmeJkmResult && (
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                    Parsed {cmeJkmResult.rowCount} month(s){cmeJkmResult.skippedCount ? `, skipped ${cmeJkmResult.skippedCount} unrecognised line(s)` : ''}.
                  </div>
                )}
              </div>

              <div>
                <div style={{ fontSize: 11, fontFamily: 'DM Mono, monospace', marginBottom: 4 }}>Brent Crude futures (Month + Settle, all listed months)</div>
                <textarea
                  value={cmeBrentText} onChange={e => setCmeBrentText(e.target.value)}
                  placeholder={'Month\tSettle\nSEP 2026\t70.12\nOCT 2026\t69.98\n...'}
                  rows={6}
                  style={{ width: '100%', fontFamily: 'DM Mono, monospace', fontSize: 11, background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, resize: 'vertical' }}
                />
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                  <button
                    onClick={applyCmeBrent} disabled={!cmeBrentText.trim()}
                    style={{ padding: '5px 14px', borderRadius: 4, border: '1px solid #e6a817', background: '#e6a81722', color: '#e6a817', cursor: 'pointer', fontSize: 11, fontFamily: 'DM Mono, monospace', fontWeight: 600 }}
                  >
                    Apply Brent update
                  </button>
                  <input
                    value={cmeSlope} onChange={e => setCmeSlope(e.target.value)}
                    placeholder={`slope % (default ${parsed.brentRawRows.at(-1)?.slopePercent ?? '–'})`}
                    style={{ width: 170, fontSize: 11, fontFamily: 'DM Mono, monospace', background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '4px 8px' }}
                  />
                </div>
                {cmeBrentResult && (
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                    Parsed {cmeBrentResult.rowCount} month(s) → {cmeBrentResult.years.length} year(s) of annualised term structure.
                  </div>
                )}
              </div>
            </div>
            {cmeError && <div style={{ color: '#f85149', fontSize: 11 }}>⚠ {cmeError}</div>}
          </div>
        )}
      </div>

      {/* Chart 1: JKM settlement prices */}
      <ChartCard
        id="chart-lng-jkm-settlement"
        title="JKM Settlement Prices"
        subtitle="ICE JKM futures — front-month settlement history (solid) and latest published forward curve (dashed), US$/MMBtu"
        onExportPPT={() => handleExportPPT('chart-lng-jkm-settlement', 'JKM Settlement Prices')}
        onExportXLSX={() => handleExportXLSX(jkmChart, 'jkm_settlement_prices')}
      >
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={jkmChart} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="month" tickFormatter={monthLabel} interval={monthTickInterval(jkmChart.length)} {...AXIS_STYLE} />
            <YAxis {...AXIS_STYLE} tickFormatter={v => v.toFixed(0)} />
            <Tooltip content={<CustomTooltip formatter={(v) => `${Number(v).toFixed(3)} US$/MMBtu`} labelFormatter={monthLabelLong} />} />
            {jkmForwardStartMonth && <ReferenceLine x={jkmForwardStartMonth} stroke="var(--border)" strokeDasharray="3 3" />}
            <Line type="monotone" dataKey="historical" name="Historical (front-month settlement)" stroke={COLORS.jkm} strokeWidth={2} dot={false} connectNulls />
            <Line type="monotone" dataKey="forward" name="Latest forward curve (ACCC)" stroke={COLORS.jkmForward} strokeWidth={2} strokeDasharray="5 3" dot={false} connectNulls />
            {cmeJkmResult && <Line type="monotone" dataKey="cme" name="CME-updated forward curve" stroke={COLORS.cme} strokeWidth={2} dot={{ r: 2 }} connectNulls />}
          </ComposedChart>
        </ResponsiveContainer>
        <Legend items={[
          { color: COLORS.jkm, label: 'Historical — nearest contract month settlement at each publication date' },
          { color: COLORS.jkmForward, label: 'Forward — full futures curve as of the ACCC\'s latest publication', opacity: 0.7 },
          ...(cmeJkmResult ? [{ color: COLORS.cme, label: `CME-updated forward curve (${cmeJkmResult.rowCount} months pasted)` }] : []),
        ]} />
      </ChartCard>

      {/* Chart 2: Brent Crude Year-1 futures */}
      <ChartCard
        id="chart-lng-brent-futures"
        title="Brent Crude — Year 1 Futures"
        subtitle="Annualised 12-month-forward Brent futures strip used in the medium-term LNG netback calculation, US$/bbl (with EIA spot price history before the ACCC series starts)"
        onExportPPT={() => handleExportPPT('chart-lng-brent-futures', 'Brent Crude Year 1 Futures')}
        onExportXLSX={() => handleExportXLSX(brentChart, 'brent_year1_futures')}
      >
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={brentChart} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="month" tickFormatter={monthLabel} interval={monthTickInterval(brentChart.length)} {...AXIS_STYLE} />
            <YAxis {...AXIS_STYLE} tickFormatter={v => v.toFixed(0)} />
            <Tooltip content={<CustomTooltip formatter={(v) => `${Number(v).toFixed(2)} US$/bbl`} labelFormatter={monthLabelLong} />} />
            {brentBackfill && <Line type="monotone" dataKey="spotBackfill" name="Brent spot (EIA, pre-2022 context)" stroke={COLORS.brentSpot} strokeWidth={1.5} strokeDasharray="4 2" dot={false} connectNulls />}
            <Line type="monotone" dataKey="value" name="Brent Year 1 futures" stroke={COLORS.brent} strokeWidth={2} dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
        <Legend items={[
          { color: COLORS.brent, label: 'Annualised Year-1 Brent futures terminal price, published monthly' },
          ...(brentBackfill ? [{ color: COLORS.brentSpot, label: 'Brent monthly-average spot price (EIA) — context only, before ACCC\'s Brent series starts', opacity: 0.8 }] : []),
        ]} />
      </ChartCard>

      {cmeBrentResult && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: 13, marginBottom: 2 }}>
            CME-derived Brent term structure (as of {monthLabelLong(cmeBrentResult.meta.quoteMonth)})
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
            Each year is a simple average of the 12 monthly CME Brent settlements in that forward window, then LNG-slope-adjusted
            ({cmeBrentResult.meta.slopePercent}%) and netted back to Wallumbilla. Years beyond 5 use the ACCC's Year-5 freight estimate held flat.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cmeBrentResult.years.length}, 1fr)`, gap: 8 }}>
            {cmeBrentResult.years.map(y => (
              <div key={y.year} style={{ textAlign: 'center', padding: '8px 4px', borderRadius: 6, background: 'var(--surface2)' }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'DM Mono, monospace' }}>Year {y.year}{y.extrapolatedFreight ? ' *' : ''}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.brent }}>{fmtNum(y.avgBrentUsdBbl, 2)}</div>
                <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>US$/bbl</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.cme, marginTop: 4 }}>{fmtNum(y.netbackAudGj, 2)}</div>
                <div style={{ fontSize: 9, color: 'var(--text-dim)' }}>A$/GJ netback</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 8 }}>
            * freight estimate extrapolated flat from the ACCC's Year-5 figure (no published freight beyond 5 years)
          </div>
        </div>
      )}

      {/* Chart 3: AUD/USD */}
      <ChartCard
        id="chart-lng-audusd"
        title="AUD/USD Exchange Rate"
        subtitle={(ofxAudUsd && !ofxDisabled) ? "Daily AUD/USD (OFX-sourced) used to convert US$ LNG prices into A$/GJ netback values" : "Daily AUD/USD (ACCC file) used to convert US$ LNG prices into A$/GJ netback values"}
        onExportPPT={() => handleExportPPT('chart-lng-audusd', 'AUD/USD Exchange Rate')}
        onExportXLSX={() => handleExportXLSX(audChart, 'aud_usd_exchange_rate')}
      >
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={audChart} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="date" tickFormatter={dayTick} interval={audTickInterval} {...AXIS_STYLE} />
            <YAxis {...AXIS_STYLE} domain={['auto', 'auto']} tickFormatter={v => v.toFixed(2)} />
            <Tooltip content={<CustomTooltip formatter={(v) => Number(v).toFixed(4)} labelFormatter={dayLabel} />} />
            <Line type="monotone" dataKey="rate" name="AUD/USD (daily)" stroke={COLORS.aud} strokeWidth={1.25} dot={false} connectNulls />
            <Line type="monotone" dataKey="avg5day" name="5-day average" stroke={COLORS.audAvg} strokeWidth={1.5} strokeDasharray="4 2" dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
        <Legend items={[
          { color: COLORS.aud, label: 'Daily AUD/USD spot rate' },
          { color: COLORS.audAvg, label: '5-day average (used in the netback calculation)', opacity: 0.7 },
        ]} />
      </ChartCard>

      {/* Chart 4: Netback price at Wallumbilla */}
      <ChartCard
        id="chart-lng-wallumbilla-netback"
        title="Netback Price at Wallumbilla"
        subtitle="A$/GJ — short-term JKM-based netback, medium-term Year-1 Brent-based netback, and the actual Wallumbilla GSH spot price"
        onExportPPT={() => handleExportPPT('chart-lng-wallumbilla-netback', 'Netback Price at Wallumbilla')}
        onExportXLSX={() => handleExportXLSX(netbackChart, 'wallumbilla_netback_prices')}
      >
        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={netbackChart} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis dataKey="month" tickFormatter={monthLabel} interval={monthTickInterval(netbackChart.length)} {...AXIS_STYLE} />
            <YAxis {...AXIS_STYLE} tickFormatter={v => v.toFixed(0)} />
            <Tooltip content={<CustomTooltip formatter={(v, name) => `${Number(v).toFixed(2)} A$/GJ`} labelFormatter={monthLabelLong} />} />
            {netbackForwardStartMonth && <ReferenceLine x={netbackForwardStartMonth} stroke="var(--border)" strokeDasharray="3 3" />}
            {brentBackfill && <ReferenceLine x={brentBackfill.meta.cutoffMonth} stroke={COLORS.brentSpot} strokeDasharray="2 2" strokeOpacity={0.5} />}
            <Line type="monotone" dataKey="jkmHistorical" name="JKM netback (historical)" stroke={COLORS.jkmNetback} strokeWidth={2} dot={false} connectNulls />
            <Line type="monotone" dataKey="jkmForward" name="JKM netback (forward curve)" stroke={COLORS.jkmNetback} strokeWidth={2} strokeDasharray="5 3" dot={false} connectNulls />
            <Line type="monotone" dataKey="brentYear1" name="Brent Year-1 netback" stroke={COLORS.brentNetback} strokeWidth={2} dot={false} connectNulls />
            {brentBackfill && <Line type="monotone" dataKey="brentSpotBackfill" name="Brent netback (spot-based estimate, pre-2022)" stroke={COLORS.brentSpot} strokeWidth={1.5} strokeDasharray="4 2" dot={false} connectNulls />}
            {cmeJkmResult && <Line type="monotone" dataKey="jkmCme" name="JKM netback (CME-updated)" stroke={COLORS.cme} strokeWidth={2} dot={{ r: 2 }} connectNulls />}
            {gshBenchmark && <Line type="monotone" dataKey="wallumbillaSpot" name="Wallumbilla GSH spot (actual)" stroke={COLORS.gsh} strokeWidth={2} dot={false} connectNulls />}
          </ComposedChart>
        </ResponsiveContainer>
        <Legend items={[
          { color: COLORS.jkmNetback, label: 'Short-term JKM netback — historical (solid) / ACCC forward curve (dashed)' },
          { color: COLORS.brentNetback, label: 'Medium-term Brent Year-1 netback (oil-linked contract proxy)' },
          ...(brentBackfill ? [{ color: COLORS.brentSpot, label: `Brent netback estimate before ${monthLabelLong(brentBackfill.meta.cutoffMonth)} — spot price × ${brentBackfill.meta.slopePercent}% slope (earliest available), approximate`, opacity: 0.8 }] : []),
          ...(cmeJkmResult ? [{ color: COLORS.cme, label: 'JKM netback recomputed from CME-updated settlement prices' }] : []),
          ...(gshBenchmark ? [{ color: COLORS.gsh, label: `Wallumbilla GSH benchmark spot price, actual (monthly avg, since ${gshBenchmark.monthly[0]?.month})` }] : []),
        ]} />
        {gshError && !gshBenchmark && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
            Wallumbilla spot price unavailable: {gshError}
          </div>
        )}
        {brentSpotError && !brentSpot && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
            Brent netback backfill unavailable: {brentSpotError}
          </div>
        )}
      </ChartCard>


      <div style={{ fontSize: 10, color: 'var(--text-dim)', fontFamily: 'DM Mono, monospace', lineHeight: 1.6 }}>
        Sources: S&amp;P Global Platts (historical LNG &amp; freight), ICE (LNG &amp; Brent futures via Bloomberg),
        GaffneyCline (LNG oil slope estimates), Argus Media / FTI Consulting (forward freight). Figures are for
        information only and do not represent ACCC price forecasts or endorsements. See the ACCC's LNG netback
        price series page for full methodology and disclaimers.
      </div>
    </div>
  );
}
