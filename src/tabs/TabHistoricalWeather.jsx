import { useState, useEffect, useRef, useCallback } from 'react';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';

// ── Colour palette ────────────────────────────────────────────────────────────
const C = {
  p50line:  '#388bfd',
  selected: '#ff7b72',
  grid:     '#30363d',
  text:     '#8b949e',
  surface:  '#161b22',
  border:   '#30363d',
};

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_TICKS  = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];

const NOTABLE_YEARS = {
  1982: 'El Niño 1982–83', 1983: 'El Niño 1982–83',
  1997: 'El Niño 1997–98', 1998: 'La Niña follows',
  2009: 'Black Saturday heatwave',
  2010: 'La Niña 2010–11', 2011: 'La Niña 2010–11',
  2019: 'Record drought & heat',
};

const fmt1 = v => (v == null ? '–' : v.toFixed(1));

// ── Shared sub-components ─────────────────────────────────────────────────────
function Card({ children, style = {} }) {
  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 8, padding: '16px 20px', ...style,
    }}>
      {children}
    </div>
  );
}

function ChartTitle({ title, sub }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: 13 }}>{title}</div>
      {sub && <div style={{ fontSize: 11, color: C.text, fontFamily: 'DM Mono, monospace', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function StatBadge({ label, value, color = C.p50line, sub }) {
  return (
    <div style={{
      background: color + '12', border: `1px solid ${color}44`,
      borderRadius: 6, padding: '10px 16px', minWidth: 120,
    }}>
      <div style={{ fontSize: 10, color: C.text, fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: 'DM Mono, monospace', fontWeight: 700, fontSize: 20, color }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: C.text, fontFamily: 'DM Mono, monospace', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// ── Drop zone for upload panel (hoisted outside UploadPanel to avoid remount) ──
function DropZone({ slot, file, inputRef, dragOver, setDragOver, onDrop, acceptFile }) {
  const active = dragOver === slot;
  const label  = slot === 'poe' ? 'gas_historical_poe.json' : 'gas_historical_traces.json';
  const desc   = slot === 'poe' ? 'Fan chart bands (cell 9d)' : 'Per-year traces (cell 9e)';
  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragOver(slot); }}
      onDragLeave={() => setDragOver(null)}
      onDrop={e => onDrop(e, slot)}
      onClick={() => inputRef.current?.click()}
      style={{
        flex: 1, minWidth: 200, border: `2px dashed ${file ? '#3fb950' : active ? '#388bfd' : C.border}`,
        borderRadius: 8, padding: '24px 16px', cursor: 'pointer', textAlign: 'center',
        background: file ? '#3fb95010' : active ? '#388bfd10' : 'transparent',
        transition: 'all 0.15s',
      }}
    >
      <input ref={inputRef} type="file" accept=".json" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files[0]; if (f) { e.target.value = ''; acceptFile(f, slot); } }} />
      <div style={{ fontSize: 26, marginBottom: 8 }}>{file ? '✅' : '📄'}</div>
      <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: file ? '#3fb950' : '#e6edf3', fontWeight: 600, marginBottom: 4 }}>
        {file ? file.name : label}
      </div>
      <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: C.text }}>
        {file ? `${(file.size / 1024).toFixed(0)} KB — ready` : desc}
      </div>
      {!file && <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: C.text, marginTop: 6 }}>Drop here or click to browse</div>}
    </div>
  );
}

// ── Upload panel ──────────────────────────────────────────────────────────────
function UploadPanel({ onLoad }) {
  const [poeFile,    setPoeFile]    = useState(null);
  const [tracesFile, setTracesFile] = useState(null);
  const [parseError, setParseError] = useState(null);
  const [parsing,    setParsing]    = useState(false);
  const [dragOver,   setDragOver]   = useState(null);
  const poeRef    = useRef();
  const tracesRef = useRef();

  const acceptFile = useCallback((file, forceSlot) => {
    setParseError(null);
    const slot = forceSlot ?? (file.name.toLowerCase().includes('poe') ? 'poe' : file.name.toLowerCase().includes('traces') ? 'traces' : null);
    if (slot === 'poe')    { setPoeFile(file);    return; }
    if (slot === 'traces') { setTracesFile(file); return; }
    setParseError(`Unrecognised file: ${file.name}. Expected gas_historical_poe.json or gas_historical_traces.json`);
  }, []);

  const handleDrop = (e, slot) => {
    e.preventDefault();
    setDragOver(null);
    const file = e.dataTransfer.files[0];
    if (file) acceptFile(file, slot);
  };

  const handleLoad = useCallback(async () => {
    if (!poeFile || !tracesFile) return;
    setParsing(true);
    setParseError(null);
    try {
      const readJson = f => new Promise((res, rej) => {
        const r = new FileReader();
        r.onload  = e => { try { res(JSON.parse(e.target.result)); } catch { rej(new Error(`${f.name} is not valid JSON`)); } };
        r.onerror = ()  => rej(new Error(`Could not read ${f.name}`));
        r.readAsText(f);
      });
      const [poe, traces] = await Promise.all([readJson(poeFile), readJson(tracesFile)]);
      if (!poe.poe_by_target) throw new Error('gas_historical_poe.json missing poe_by_target — re-run cell 9d');
      if (!traces.years)      throw new Error('gas_historical_traces.json missing years — re-run cell 9e');
      onLoad(poe, traces);
    } catch (err) {
      setParseError(err.message);
    } finally {
      setParsing(false);
    }
  }, [poeFile, tracesFile, onLoad]);



  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 420, padding: 24 }}>
      <div style={{ maxWidth: 620, width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>📊</div>
          <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Historical Weather Data</div>
          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: C.text, lineHeight: 1.7, maxWidth: 460, margin: '0 auto' }}>
            Upload the two JSON files produced by notebook cells 9d and 9e to explore the historic demand range and what-if year scenarios.
          </div>
          <div style={{ marginTop: 8, fontFamily: 'DM Mono, monospace', fontSize: 11, color: C.text }}>
            Files are in:{' '}
            <span style={{ color: '#e6edf3' }}>C:\Users\peter\Python\data\forecasts\</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
          <DropZone slot="poe"    file={poeFile}    inputRef={poeRef}    dragOver={dragOver} setDragOver={setDragOver} onDrop={handleDrop} acceptFile={acceptFile} />
          <DropZone slot="traces" file={tracesFile} inputRef={tracesRef} dragOver={dragOver} setDragOver={setDragOver} onDrop={handleDrop} acceptFile={acceptFile} />
        </div>

        {parseError && (
          <div style={{
            background: '#f8514915', border: '1px solid #f8514966', borderRadius: 6,
            padding: '9px 14px', fontSize: 11, fontFamily: 'DM Mono, monospace',
            color: '#f85149', marginBottom: 14,
          }}>⚠ {parseError}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'center', gap: 14, alignItems: 'center' }}>
          <button onClick={handleLoad} disabled={!poeFile || !tracesFile || parsing} style={{
            padding: '9px 28px', borderRadius: 6, cursor: (poeFile && tracesFile && !parsing) ? 'pointer' : 'not-allowed',
            border: `1px solid ${poeFile && tracesFile ? '#388bfd' : C.border}`,
            background: poeFile && tracesFile ? '#388bfd22' : 'transparent',
            color: poeFile && tracesFile ? '#388bfd' : C.text,
            fontFamily: 'Syne, sans-serif', fontWeight: 600, fontSize: 13, transition: 'all 0.15s',
          }}>
            {parsing ? 'Loading…' : 'Load data'}
          </button>
          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: C.text }}>
            or copy to <code style={{ color: '#e6edf3' }}>public/data/</code> for auto-load
          </div>
        </div>

        <div style={{ marginTop: 24, borderTop: `1px solid ${C.border}`, paddingTop: 18 }}>
          <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: C.text, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>How to generate the files</div>
          {[
            ['9a–9b', 'Configure paths and build feature frames from nem_historical_*.csv'],
            ['9c',    'Run counterfactual cascade — replay each weather year with current fleet'],
            ['9d',    'Aggregate POE bands → gas_historical_poe.json'],
            ['9e',    'Export per-year traces → gas_historical_traces.json'],
          ].map(([cell, desc]) => (
            <div key={cell} style={{ display: 'flex', gap: 10, marginBottom: 5 }}>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: '#388bfd', minWidth: 40, fontWeight: 600 }}>{cell}</span>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: C.text }}>{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Fan chart tooltip ─────────────────────────────────────────────────────────
function FanTooltip({ active, payload, label, selectedYear, poeData, target }) {
  if (!active || !payload?.length) return null;
  const band    = poeData?.poe_by_target?.[target];
  const doyIdx  = band?.doy?.indexOf(label);
  const hasMinMax = Array.isArray(band?.min) && Array.isArray(band?.median);
  const minVal  = doyIdx >= 0 ? (hasMinMax ? band.min[doyIdx]    : band.p10?.[doyIdx])    : null;
  const maxVal  = doyIdx >= 0 ? (hasMinMax ? band.max[doyIdx]    : band.p90?.[doyIdx])    : null;
  const median  = doyIdx >= 0 ? (hasMinMax ? band.median[doyIdx] : band.p50?.[doyIdx])    : null;
  const minYear = doyIdx >= 0 ? band.min_year?.[doyIdx] : null;
  const maxYear = doyIdx >= 0 ? band.max_year?.[doyIdx] : null;
  const selPayload  = payload.find(p => p.dataKey === 'selected');
  const selVal      = selPayload?.value ?? null;
  const ytd2026Payload = payload.find(p => p.dataKey === 'ytd2026');
  const ytd2026     = ytd2026Payload?.value ?? null;
  const approxDate = (() => {
    const d = new Date(2001, 0, label);
    return `${MONTH_LABELS[d.getMonth()]} ${d.getDate()}`;
  })();
  return (
    <div style={{
      background: '#0d1117', border: `1px solid ${C.border}`, borderRadius: 6,
      padding: '10px 14px', fontSize: 11, fontFamily: 'DM Mono, monospace', minWidth: 200,
    }}>
      <div style={{ marginBottom: 8, color: '#fff', fontWeight: 600, borderBottom: `1px solid ${C.border}`, paddingBottom: 6 }}>
        {approxDate} <span style={{ color: '#8b949e', fontWeight: 400 }}>(DOY {label})</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {maxVal != null && (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <span style={{ color: '#8b949e' }}>Highest{maxYear ? ` (${maxYear})` : ''}</span>
            <b style={{ color: '#ff7b72' }}>{fmt1(maxVal)} TJ</b>
          </div>
        )}
        {median != null && (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <span style={{ color: '#8b949e' }}>Median</span>
            <b style={{ color: '#e6edf3' }}>{fmt1(median)} TJ</b>
          </div>
        )}
        {minVal != null && (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <span style={{ color: '#8b949e' }}>Lowest{minYear ? ` (${minYear})` : ''}</span>
            <b style={{ color: '#2ea870' }}>{fmt1(minVal)} TJ</b>
          </div>
        )}
        {selVal != null && (
          <>
            <div style={{ borderTop: `1px solid ${C.border}`, margin: '4px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
              <span style={{ color: '#8b949e' }}>{selectedYear} weather</span>
              <b style={{ color: '#e6a817' }}>{fmt1(selVal)} TJ</b>
            </div>
            {median != null && (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                <span style={{ color: '#8b949e' }}>vs median</span>
                <b style={{ color: selVal > median ? '#ff7b72' : '#2ea870' }}>
                  {selVal > median ? '+' : ''}{fmt1(selVal - median)} TJ
                </b>
              </div>
            )}
          </>
        )}
        {ytd2026 != null && (
          <>
            <div style={{ borderTop: `1px solid ${C.border}`, margin: '4px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
              <span style={{ color: '#8b949e' }}>2026 YTD</span>
              <b style={{ color: '#3fb950' }}>{fmt1(ytd2026)} TJ</b>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── POE fan chart tooltip ─────────────────────────────────────────────────────
function PoeFanTooltip({ active, payload, label, displayYear, target, hasActuals, chartData }) {
  if (!active || !payload?.length) return null;
  // p50 and actual come from rendered series; p10/p90 are not rendered as
  // individual lines so look them up directly from the chartData array by DOY
  const get  = key => payload.find(p => p.dataKey === key)?.value ?? null;
  const mid    = get('p50');
  const actual = get('actual');
  const point  = chartData?.find(d => d.doy === label);
  const hi     = point?.p10 ?? null;   // scaled POE10 (high demand)
  const lo     = point?.p90 ?? null;   // scaled POE90 (low demand)
  const approxDate = (() => {
    const d = new Date(2001, 0, label);
    return `${MONTH_LABELS[d.getMonth()]} ${d.getDate()}`;
  })();
  const targetLabel = { total: 'Total', gpg: 'GPG', nonpower: 'Non-power' }[target] ?? target;
  return (
    <div style={{
      background: '#0d1117', border: `1px solid ${C.border}`, borderRadius: 6,
      padding: '10px 14px', fontSize: 11, fontFamily: 'DM Mono, monospace', minWidth: 220,
    }}>
      <div style={{ marginBottom: 8, color: '#fff', fontWeight: 600, borderBottom: `1px solid ${C.border}`, paddingBottom: 6 }}>
        {displayYear} · {approxDate}
        <span style={{ color: '#8b949e', fontWeight: 400 }}> (DOY {label})</span>
      </div>
      <div style={{ fontSize: 10, color: C.text, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Model uncertainty — {targetLabel}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {hi != null && (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <span style={{ color: '#8b949e' }}>POE10 (high demand)</span>
            <b style={{ color: '#ff7b72' }}>{fmt1(hi)} TJ</b>
          </div>
        )}
        {mid != null && (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <span style={{ color: '#8b949e' }}>POE50 (central)</span>
            <b style={{ color: '#388bfd' }}>{fmt1(mid)} TJ</b>
          </div>
        )}
        {lo != null && (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <span style={{ color: '#8b949e' }}>POE90 (low demand)</span>
            <b style={{ color: '#2ea870' }}>{fmt1(lo)} TJ</b>
          </div>
        )}
        {hi != null && lo != null && (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginTop: 2 }}>
            <span style={{ color: '#8b949e' }}>P10–P90 spread</span>
            <b style={{ color: C.text }}>{fmt1(hi - lo)} TJ</b>
          </div>
        )}
        {actual != null && (
          <>
            <div style={{ borderTop: `1px solid ${C.border}`, margin: '4px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
              <span style={{ color: '#8b949e' }}>Actual (GBB)</span>
              <b style={{ color: '#e6a817' }}>{fmt1(actual)} TJ</b>
            </div>
            {mid != null && (
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                <span style={{ color: '#8b949e' }}>vs POE50</span>
                <b style={{ color: actual > mid ? '#ff7b72' : '#2ea870' }}>
                  {actual > mid ? '+' : ''}{fmt1(actual - mid)} TJ
                </b>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── POE fan chart ─────────────────────────────────────────────────────────────
// Shows model uncertainty (P10/P50/P90) for the selected year's weather replay.
// When no year is selected, falls back to the median year from year_stats.
// For years 2019-2025, overlays actual GBB demand from the records prop.
const ACTUALS_YEARS = new Set([2019, 2020, 2021, 2022, 2023, 2024, 2025]);

function PoeFanChart({ tracesData, selectedYear, target, targetLabels, records = [] }) {
  if (!tracesData?.years) return null;

  // Resolve which year's trace to display
  const yearStats = tracesData?.meta?.year_stats ?? [];

  // Find median year by peak_total rank
  const medianYear = (() => {
    if (!yearStats.length) return null;
    const sorted = [...yearStats].sort((a, b) => b.peak_total - a.peak_total);
    return sorted[Math.floor(sorted.length / 2)]?.year ?? null;
  })();

  const displayYear = selectedYear ?? medianYear;
  const daily = displayYear ? tracesData.years[String(displayYear)]?.daily : null;

  if (!daily?.doy?.length) return null;

  // Column names for this target
  const cols = {
    total:    { p50: 'pred_total_tj',    p10: 'poe10_total_tj',  p90: 'poe90_total_tj'  },
    gpg:      { p50: 'pred_gpg_tj',      p10: 'poe10_gpg_tj',    p90: 'poe90_gpg_tj'    },
    nonpower: { p50: 'pred_nonpower_tj', p10: 'poe10_nonpwr_tj', p90: 'poe90_nonpwr_tj' },
  }[target] ?? { p50: 'pred_total_tj', p10: 'poe10_total_tj', p90: 'poe90_total_tj' };

  // ── Interim scaling factors to achieve ~80% empirical coverage ───────────────
  // Derived from 2019–2025 out-of-sample residuals vs the raw xplot bands.
  // TODO: replace with empirical quantile offsets by DOY bin once notebook
  //       cell is updated to compute and export them.
  const SCALE = { total: 4.20, gpg: 2.64, nonpower: 10.00 };
  const scale = SCALE[target] ?? 1;

  // Build actuals-by-DOY from GBB records for this year, if available
  const hasActuals = ACTUALS_YEARS.has(displayYear);
  const actualsByDoy = (() => {
    if (!hasActuals) return {};
    const recs = records.filter(r => r.year === displayYear);
    const m = {};
    recs.forEach(r => {
      if (!r.date) return;
      const d = new Date(r.date);
      const start = new Date(d.getFullYear(), 0, 0);
      const doy = Math.floor((d - start) / 86400000);
      if (doy < 1 || doy > 366) return;
      let val;
      if (target === 'gpg')           val = r.gpg_se;
      else if (target === 'nonpower') val = (r.industrial ?? 0) + (r.residential ?? 0);
      else                            val = r.total_demand_se;
      if (val != null && !isNaN(val) && val > 0) m[doy] = val;
    });
    return m;
  })();

  const chartData = daily.doy.map((doy, i) => {
    const p50 = daily[cols.p50]?.[i] ?? null;
    const p10raw = daily[cols.p10]?.[i] ?? null;  // higher demand (raw)
    const p90raw = daily[cols.p90]?.[i] ?? null;  // lower demand (raw)
    let scaledLo = null, scaledHi = null, scaledP10 = null, scaledP90 = null;
    if (p50 != null && p10raw != null && p90raw != null) {
      // Expand half-band symmetrically around p50 by scale factor
      const halfBandP10 = Math.abs(p10raw - p50) * scale;
      const halfBandP90 = Math.abs(p90raw - p50) * scale;
      scaledP10 = p50 + halfBandP10;          // scaled high-demand bound
      scaledP90 = Math.max(0.1, p50 - halfBandP90); // scaled low-demand bound, floor at 0.1
      scaledLo = scaledP90;
      scaledHi = scaledP10;
    }
    return {
      doy,
      band: (scaledLo != null && scaledHi != null) ? [scaledLo, scaledHi] : null,
      p50,
      p10: scaledP10,
      p90: scaledP90,
      actual: actualsByDoy[doy] ?? null,
    };
  });

  const isMedianFallback = !selectedYear && displayYear === medianYear;
  const actualsCount = Object.keys(actualsByDoy).length;
  const scalePct = ((scale - 1) * 100).toFixed(0);

  return (
    <Card>
      <ChartTitle
        title={`Model uncertainty range — ${targetLabels[target]}`}
        sub={
          `${displayYear} weather replay · shaded band = POE10–POE90 model uncertainty` +
          (isMedianFallback ? ' · showing median year (select a year above to change)' : '') +
          (hasActuals && actualsCount > 0 ? ` · ${actualsCount} days of GBB actuals` : '')
        }
      />

      {/* Interim band notice */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10,
        background: '#e6a81710', border: '1px solid #e6a81740',
        borderRadius: 5, padding: '6px 10px',
        fontSize: 10, fontFamily: 'DM Mono, monospace', color: '#e6a817', lineHeight: 1.5,
      }}>
        <span style={{ flexShrink: 0 }}>⚠</span>
        <span>
          <b>Interim bands:</b> raw xplot offsets scaled ×{scale.toFixed(2)} ({scalePct}% wider) to achieve ~80% empirical coverage
          against 2019–2025 GBB actuals. To be replaced with empirical quantile offsets by DOY bin
          once notebook recalibration is complete.
        </span>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
        {[
          { bg: '#388bfd28', stroke: '#388bfd66', label: 'POE10–POE90 range (model uncertainty)' },
          { line: '#388bfd', label: 'POE50 (central forecast)' },
          ...(hasActuals && actualsCount > 0 ? [{ dot: '#e6a817', label: `${displayYear} actual (GBB)` }] : []),
        ].map(({ bg, stroke, line, dot, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontFamily: 'DM Mono, monospace', color: C.text }}>
            {dot
              ? <div style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />
              : line
              ? <div style={{ width: 24, height: 0, borderTop: `2px solid ${line}` }} />
              : <div style={{ width: 16, height: 10, background: bg, border: `1px solid ${stroke}`, borderRadius: 2 }} />
            }
            {label}
          </div>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
          <XAxis
            dataKey="doy"
            ticks={MONTH_TICKS}
            tickFormatter={doy => MONTH_LABELS[MONTH_TICKS.indexOf(doy)] ?? ''}
            tick={{ fill: C.text, fontSize: 11, fontFamily: 'DM Mono, monospace' }}
            axisLine={{ stroke: C.grid }} tickLine={false}
          />
          <YAxis
            tick={{ fill: C.text, fontSize: 11, fontFamily: 'DM Mono, monospace' }}
            axisLine={false} tickLine={false} width={50}
          />
          <Tooltip content={<PoeFanTooltip displayYear={displayYear} target={target} hasActuals={hasActuals && actualsCount > 0} chartData={chartData} />} />

          {/* POE10–POE90 shaded band — matching historic demand range style */}
          <Area dataKey="band" stroke="#388bfd66" fill="#388bfd28" strokeWidth={1} legendType="none" />

          {/* POE50 central forecast */}
          <Line dataKey="p50" stroke="#388bfd" strokeWidth={2} dot={false} legendType="none" connectNulls />

          {/* Actual GBB demand — yellow dots, for years 2019–2025 */}
          {hasActuals && actualsCount > 0 && (
            <Line
              dataKey="actual"
              stroke="none"
              dot={{ r: 2.5, fill: '#e6a817', stroke: 'none' }}
              activeDot={{ r: 4, fill: '#e6a817' }}
              legendType="none"
              connectNulls={false}
              isAnimationActive={false}
            />
          )}

          <ReferenceLine x={196} stroke={C.grid} strokeDasharray="4 4"
            label={{ value: 'Winter', fill: C.text, fontSize: 10, fontFamily: 'DM Mono, monospace', position: 'insideTopRight' }} />
          <ReferenceLine x={15} stroke={C.grid} strokeDasharray="4 4"
            label={{ value: 'Summer', fill: C.text, fontSize: 10, fontFamily: 'DM Mono, monospace', position: 'insideTopRight' }} />
        </ComposedChart>
      </ResponsiveContainer>
    </Card>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function TabHistoricalWeather({ histPoe, histTraces, records = [] }) {
  const [selectedYear, setSelectedYear] = useState(null);
  const [target,     setTarget]     = useState('total');
  const [loading,    setLoading]    = useState(false);
  const [poeData,    setPoeData]    = useState(histPoe    ?? null);
  const [tracesData, setTracesData] = useState(histTraces ?? null);
  const [showUpload, setShowUpload] = useState(false);
  const fetchedRef = useRef(false);

  // ── Auto-fetch from /data/ on first render ──────────────────────────────────
  useEffect(() => {
    if (fetchedRef.current || poeData) return;
    fetchedRef.current = true;
    setLoading(true);
    Promise.all([
      fetch('/data/gas_historical_poe.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
      fetch('/data/gas_historical_traces.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
    ])
      .then(([poe, traces]) => { setPoeData(poe); setTracesData(traces); })
      .catch(() => setShowUpload(true))   // silently fall through to upload panel
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 400, flexDirection: 'column', gap: 16 }}>
      <div style={{ width: 32, height: 32, borderRadius: '50%', border: '3px solid var(--border)', borderTopColor: '#388bfd', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ fontFamily: 'DM Mono, monospace', color: C.text, fontSize: 12 }}>Loading historical weather data…</div>
    </div>
  );

  if (showUpload || !poeData || !tracesData) return (
    <UploadPanel onLoad={(poe, traces) => {
      setPoeData(poe);
      setTracesData(traces);
      setShowUpload(false);
    }} />
  );

  // ── Derived data ────────────────────────────────────────────────────────────
  const yearList  = tracesData?.meta?.year_list  ?? [];
  const yearStats = tracesData?.meta?.year_stats ?? [];
  const meta      = poeData?.meta;
  const nYears    = meta?.years_all  ?? 0;
  const nFull     = meta?.years_full ?? 0;
  const targetLabels = { total: 'Total demand', gpg: 'GPG only', nonpower: 'Non-power only' };

  // ── 2026 YTD line — from GBB actuals, segmented by target ──────────────────
  const ytd2026ByDoy = (() => {
    const recs2026 = records.filter(r => r.year === 2026);
    if (!recs2026.length) return {};
    const m = {};
    recs2026.forEach(r => {
      if (!r.date) return;
      const d = new Date(r.date);
      const start = new Date(d.getFullYear(), 0, 0);
      const doy = Math.floor((d - start) / 86400000);
      if (doy < 1 || doy > 366) return;
      let val;
      if (target === 'gpg')      val = r.gpg_se;
      else if (target === 'nonpower') val = (r.industrial ?? 0) + (r.residential ?? 0);
      else                       val = r.total_demand_se;
      if (val != null && !isNaN(val) && val > 0) m[doy] = val;
    });
    return m;
  })();

  const fanChartData = (() => {
    const band = poeData?.poe_by_target?.[target];
    if (!band) return [];
    const selectedTrace = selectedYear ? tracesData?.years?.[String(selectedYear)]?.daily : null;
    const traceCol = { total: 'pred_total_tj', gpg: 'pred_gpg_tj', nonpower: 'pred_nonpower_tj' }[target] ?? 'pred_total_tj';
    const traceByDoy = {};
    if (selectedTrace) selectedTrace.doy.forEach((doy, i) => { traceByDoy[doy] = selectedTrace[traceCol]?.[i] ?? null; });
    // Support both new structure (min/max/median) and old (p10/p50/p90)
    const hasMinMax = Array.isArray(band.min) && Array.isArray(band.median);
    return band.doy.map((doy, i) => ({
      doy,
      range:    hasMinMax ? [band.min[i], band.max[i]] : [band.p10?.[i], band.p90?.[i]],
      median:   hasMinMax ? band.median[i] : band.p50?.[i],
      selected: traceByDoy[doy] ?? null,
      ytd2026:  ytd2026ByDoy[doy] ?? null,
      minYear:  band.min_year?.[i],
      maxYear:  band.max_year?.[i],
      nYears:   band.n_years?.[i],
    }));
  })();

  const selStats    = selectedYear ? yearStats.find(y => y.year === selectedYear) : null;
  const leagueTable = [...yearStats].sort((a, b) => b.peak_total - a.peak_total);
  const winterRow   = fanChartData.find(d => d.doy === 196);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── KPI strip ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <StatBadge label="Historic years"    value={nYears}  sub={`${nFull} full-coverage years`}  color="#388bfd" />
        <StatBadge label="Highest demand"  value={`${fmt1(leagueTable[0]?.peak_total ?? null)} TJ`}  sub={`${leagueTable[0]?.peak_date ?? '–'} · ${leagueTable[0]?.year ?? '–'}`}   color="#ff7b72" />
        <StatBadge label="Median winter"   value={`${fmt1(winterRow?.median ?? null)} TJ`}         sub="DOY 196 · median year"  color="#388bfd" />
        <StatBadge
          label="Fleet anchor"
          value={`${meta?.fleet_anchor?.wind_gw ?? '–'} GW wind`}
          sub={`${meta?.fleet_anchor?.solar_gw ?? '–'} GW solar · ${meta?.fleet_anchor?.coal_gw ?? '–'} GW coal`}
          color="#3fb950"
        />
        {selStats && (
          <StatBadge label={`${selectedYear} peak`} value={`${fmt1(selStats.peak_total)} TJ`}
            sub={`${selStats.peak_date} · ${selStats.n_sites}/43 sites`} color={C.selected} />
        )}
        <button onClick={() => setShowUpload(true)} style={{
          marginLeft: 'auto', alignSelf: 'center', padding: '6px 14px', borderRadius: 5,
          cursor: 'pointer', border: `1px solid ${C.border}`, background: 'transparent',
          color: C.text, fontFamily: 'DM Mono, monospace', fontSize: 11, transition: 'all 0.15s',
        }}>↑ Upload new files</button>
      </div>

      {/* ── Controls ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: C.text, fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Show</span>
          {Object.entries(targetLabels).map(([k, v]) => (
            <button key={k} onClick={() => setTarget(k)} style={{
              padding: '3px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 11,
              fontFamily: 'DM Mono, monospace', transition: 'all 0.15s',
              border: `1px solid ${target === k ? '#388bfd' : C.border}`,
              background: target === k ? '#388bfd22' : 'transparent',
              color: target === k ? '#388bfd' : C.text,
              fontWeight: target === k ? 600 : 400,
            }}>{v}</button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: C.text, fontFamily: 'DM Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.07em' }}>What-if year</span>
          <button onClick={() => setSelectedYear(null)} style={{
            padding: '3px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 11,
            fontFamily: 'DM Mono, monospace', transition: 'all 0.15s',
            border: `1px solid ${selectedYear === null ? C.text : C.border}`,
            background: selectedYear === null ? '#ffffff18' : 'transparent',
            color: selectedYear === null ? '#fff' : C.text,
          }}>None</button>
          {yearList.map(yr => {
            const stat      = yearStats.find(s => s.year === yr);
            const isNotable = !!NOTABLE_YEARS[yr];
            const isFull    = stat?.full_data;
            const active    = selectedYear === yr;
            return (
              <button key={yr} onClick={() => setSelectedYear(active ? null : yr)}
                title={NOTABLE_YEARS[yr] ?? (isFull ? 'Full coverage' : `${stat?.n_sites ?? '?'}/43 sites`)}
                style={{
                  padding: '3px 9px', borderRadius: 4, cursor: 'pointer', fontSize: 11,
                  fontFamily: 'DM Mono, monospace', transition: 'all 0.15s',
                  border: `1px solid ${active ? C.selected : isNotable ? '#e6a81760' : C.border}`,
                  background: active ? C.selected + '33' : isNotable ? '#e6a81714' : 'transparent',
                  color: active ? C.selected : isNotable ? '#e6a817' : isFull ? C.text : C.text + '80',
                  fontWeight: active ? 700 : isNotable ? 500 : 400,
                }}>
                {yr}{!isFull ? ' ⚠' : ''}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Fan chart ─────────────────────────────────────────────────────── */}
      <Card>
        <ChartTitle
          title={`Historic demand range — ${targetLabels[target]}`}
          sub={`${nYears} weather years (${meta?.year_list?.[0] ?? '?'}–${meta?.year_list?.slice(-1)[0] ?? '?'}) replayed with ${meta?.fleet_anchor?.wind_gw ?? '?'} GW wind / ${meta?.fleet_anchor?.solar_gw ?? '?'} GW solar fleet`}
        />
        <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
          {[
            { bg: '#2ea87028', stroke: '#2ea87066', label: `Range across ${poeData?.meta?.years_all ?? ''} years` },
            { line: '#e6edf3', label: 'Median year' },
            ...(selectedYear ? [{ line: '#e6a817', dashed: true, label: `${selectedYear} weather` }] : []),
            ...(Object.keys(ytd2026ByDoy).length > 0 ? [{ line: '#3fb950', label: '2026 YTD actual / forecast' }] : []),
          ].map(({ bg, stroke, line, dashed, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontFamily: 'DM Mono, monospace', color: C.text }}>
              {line
                ? <div style={{ width: 24, height: 0, borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${line}` }} />
                : <div style={{ width: 16, height: 10, background: bg, border: `1px solid ${stroke}`, borderRadius: 2 }} />
              }
              {label}
            </div>
          ))}
        </div>

        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={fanChartData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
            <XAxis
              dataKey="doy"
              ticks={MONTH_TICKS}
              tickFormatter={doy => MONTH_LABELS[MONTH_TICKS.indexOf(doy)] ?? ''}
              tick={{ fill: C.text, fontSize: 11, fontFamily: 'DM Mono, monospace' }}
              axisLine={{ stroke: C.grid }} tickLine={false}
            />
            <YAxis
              tick={{ fill: C.text, fontSize: 11, fontFamily: 'DM Mono, monospace' }}
              axisLine={false} tickLine={false} width={50}
            />
            <Tooltip content={<FanTooltip selectedYear={selectedYear} poeData={poeData} target={target} />} />
            {/* Min–max range across all years */}
            <Area dataKey="range" stroke="#2ea87066" fill="#2ea87028" strokeWidth={1} legendType="none" />
            {/* Median year — white */}
            <Line dataKey="median" stroke="#e6edf3" strokeWidth={2} dot={false} legendType="none" />
            {/* Selected year — amber dashed */}
            {selectedYear && (
              <Line dataKey="selected" stroke="#e6a817" strokeWidth={2.5} strokeDasharray="6 3" dot={false} legendType="none" connectNulls />
            )}
            {Object.keys(ytd2026ByDoy).length > 0 && (
              <Line dataKey="ytd2026" stroke="#3fb950" strokeWidth={2} dot={false} legendType="none" connectNulls />
            )}
            <ReferenceLine x={196} stroke={C.grid} strokeDasharray="4 4"
              label={{ value: 'Winter', fill: C.text, fontSize: 10, fontFamily: 'DM Mono, monospace', position: 'insideTopRight' }} />
            <ReferenceLine x={15} stroke={C.grid} strokeDasharray="4 4"
              label={{ value: 'Summer', fill: C.text, fontSize: 10, fontFamily: 'DM Mono, monospace', position: 'insideTopRight' }} />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      {/* ── POE fan chart ─────────────────────────────────────────────────── */}
      <PoeFanChart
        tracesData={tracesData}
        selectedYear={selectedYear}
        target={target}
        targetLabels={targetLabels}
        records={records}
      />

      {/* ── Daily profile for selected year ───────────────────────────────── */}
      {selectedYear && (() => {
        const daily = tracesData?.years?.[String(selectedYear)]?.daily;
        if (!daily?.date?.length) return null;
        // Build chart data — one point per day, tick every ~30 days
        const chartData = daily.date.map((date, i) => ({
          date,
          doy:   daily.doy[i],
          label: date.slice(5),   // MM-DD for x-axis
          total: daily.pred_total_tj?.[i]    ?? null,
          gpg:   daily.pred_gpg_tj?.[i]      ?? null,
          np:    daily.pred_nonpower_tj?.[i]  ?? null,
          hdd:   daily.hdd18_nem?.[i]         ?? null,
          temp:  daily.temp?.[i]              ?? null,
        }));
        // Tick every ~month (every 30th point)
        const tickIndices = chartData.filter((_, i) => i % 30 === 0).map(d => d.label);
        // Peak day marker
        const peakIdx = chartData.reduce((best, d, i) => d.total > (chartData[best]?.total ?? 0) ? i : best, 0);
        const peakLabel = chartData[peakIdx]?.label;
        return (
          <Card>
            <ChartTitle
              title={`${selectedYear} — daily demand profile`}
              sub={`TJ/day by segment · counterfactual with current fleet${NOTABLE_YEARS[selectedYear] ? ' · ' + NOTABLE_YEARS[selectedYear] : ''}`}
            />
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
                <XAxis
                  dataKey="label"
                  ticks={tickIndices}
                  tick={{ fill: C.text, fontSize: 11, fontFamily: 'DM Mono, monospace' }}
                  axisLine={{ stroke: C.grid }} tickLine={false}
                />
                <YAxis tick={{ fill: C.text, fontSize: 11, fontFamily: 'DM Mono, monospace' }} axisLine={false} tickLine={false} width={50} />
                <Tooltip
                  contentStyle={{ background: '#0d1117', border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11, fontFamily: 'DM Mono, monospace' }}
                  itemStyle={{ color: '#ccc' }}
                  formatter={(v, name) => [`${typeof v === 'number' ? v.toFixed(1) : '–'} TJ`, name]}
                  labelFormatter={l => `${selectedYear}-${l}`}
                />
                {/* Stacked segment areas */}
                <Area type="monotone" dataKey="np"    stackId="a" fill="#3fb95044" stroke="#3fb950" strokeWidth={1} name="Non-power" />
                <Area type="monotone" dataKey="gpg"   stackId="a" fill="#388bfd44" stroke="#388bfd" strokeWidth={1} name="GPG" />
                {/* Total line */}
                <Line type="monotone" dataKey="total" stroke={C.selected} strokeWidth={1.5} dot={false} name="Total" />

                {peakLabel && (
                  <ReferenceLine x={peakLabel} stroke={C.selected} strokeDasharray="4 3"
                    label={{ value: `Peak ${chartData[peakIdx]?.total?.toFixed(0)} TJ`, fill: C.selected, fontSize: 10, fontFamily: 'DM Mono, monospace', position: 'insideTopRight' }} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </Card>
        );
      })()}

      {/* ── League table ──────────────────────────────────────────────────── */}
      <Card>
        <ChartTitle title="Peak demand by year" sub="Ranked by peak day total demand (TJ/day) — click any row to select that year" />
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'DM Mono, monospace' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {['Rank','Year','Peak TJ/d','Peak date','Ann. total PJ','Ann. GPG PJ','Mean HDD','Sites','Note'].map(h => (
                  <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: C.text, fontWeight: 500, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leagueTable.map((row, i) => {
                const active    = selectedYear === row.year;
                const isNotable = !!NOTABLE_YEARS[row.year];
                return (
                  <tr key={row.year} onClick={() => setSelectedYear(active ? null : row.year)}
                    style={{ borderBottom: `1px solid ${C.border}44`, cursor: 'pointer', background: active ? C.selected + '14' : 'transparent', transition: 'background 0.1s' }}
                  >
                    <td style={{ padding: '6px 10px', color: C.text }}>{i + 1}</td>
                    <td style={{ padding: '6px 10px', fontWeight: active ? 700 : 400, color: active ? C.selected : isNotable ? '#e6a817' : '#e6edf3' }}>{row.year}</td>
                    <td style={{ padding: '6px 10px', color: active ? C.selected : '#e6edf3', fontWeight: 600 }}>{fmt1(row.peak_total)}</td>
                    <td style={{ padding: '6px 10px', color: C.text }}>{row.peak_date}</td>
                    <td style={{ padding: '6px 10px', color: '#e6edf3' }}>{fmt1(row.ann_total_pj)}</td>
                    <td style={{ padding: '6px 10px', color: '#e6edf3' }}>{fmt1(row.ann_gpg_pj)}</td>
                    <td style={{ padding: '6px 10px', color: C.text }}>{row.mean_hdd?.toFixed(2)}</td>
                    <td style={{ padding: '6px 10px', color: row.full_data ? C.text : '#f8514999' }}>{row.n_sites}/43{!row.full_data ? ' ⚠' : ''}</td>
                    <td style={{ padding: '6px 10px', color: '#e6a817', fontSize: 11 }}>{NOTABLE_YEARS[row.year] ?? ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ marginTop: 8, fontSize: 10, color: C.text, fontFamily: 'DM Mono, monospace' }}>
          ⚠ = fewer than 20 sites — treat with caution in POE analysis
        </div>
      </Card>

    </div>
  );
}
