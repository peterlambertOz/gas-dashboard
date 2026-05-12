import { useState, useEffect, useMemo } from "react";
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";

// ── Shared styles (mirrors TabForecast) ───────────────────────────────────────
const C = {
  bg:       '#0d1117', surface:  '#161b22', surface2: '#1c2128',
  border:   '#30363d', text:     '#e6edf3', muted:    '#8b949e',
  dim:      '#484f58', blue:     '#388bfd', orange:   '#e6a817',
  green:    '#3fb950', red:      '#f85149', purple:   '#bc8cff',
  teal:     '#39d0d8', forecast: '#388bfd', actual:   '#e6a817',
};

const AXIS  = { tick: { fill: C.muted, fontSize: 11 }, axisLine: false, tickLine: false };
const GRID  = { stroke: C.border, strokeDasharray: '3 3', vertical: false };

const YEAR_COLORS = {
  2020: '#6e7681', 2021: '#79c0ff', 2022: '#3fb950',
  2023: '#ffa657', 2024: '#388bfd', 2025: '#e6a817',
};

const AVAILABLE_YEARS = [2020, 2021, 2022, 2023, 2024, 2025];

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtDate = (d) => {
  if (!d) return '';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [, m, dd] = d.split('-');
  return `${parseInt(dd)}-${months[parseInt(m) - 1]}`;
};

const calcR2 = (rows, predKey, actKey) => {
  const valid = rows.filter(r => r[predKey] != null && r[actKey] != null);
  if (valid.length < 2) return null;
  const mean = valid.reduce((s, r) => s + r[actKey], 0) / valid.length;
  const ssTot = valid.reduce((s, r) => s + (r[actKey] - mean) ** 2, 0);
  const ssRes = valid.reduce((s, r) => s + (r[actKey] - r[predKey]) ** 2, 0);
  if (ssTot === 0) return null;
  return 1 - ssRes / ssTot;
};

const fmtR2 = (r2) => r2 == null ? '—' : r2.toFixed(4);

// ── CSV parser ────────────────────────────────────────────────────────────────
const parseValidationCsv = (text) => {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = line.split(',');
    const raw = Object.fromEntries(headers.map((h, i) => [h, vals[i]?.trim()]));
    const p = (k) => { const v = parseFloat(raw[k]); return isNaN(v) ? null : v; };
    return {
      date:                    raw.date,
      pred_total_tj:           p('pred_total_tj'),
      actual_total_tj:         p('actual_total_tj'),
      pred_gpg_tj:             p('pred_gpg_tj'),
      actual_gpg_tj:           p('actual_gpg_tj'),
      pred_nonpower_tj:        p('pred_nonpower_tj'),
      actual_nonpower_tj:      p('actual_nonpower_tj'),
      pred_vic_nonpower_tj:    p('pred_vic_nonpower_tj'),
      actual_vic_nonpower_tj:  p('actual_vic_nonpower_tj'),
      pred_nsw_nonpower_tj:    p('pred_nsw_nonpower_tj'),
      actual_nsw_nonpower_tj:  p('actual_nsw_nonpower_tj'),
      pred_sa_nonpower_tj:     p('pred_sa_nonpower_tj'),
      actual_sa_nonpower_tj:   p('actual_sa_nonpower_tj'),
      pred_tas_nonpower_tj:    p('pred_tas_nonpower_tj'),
      actual_tas_nonpower_tj:  p('actual_tas_nonpower_tj'),
    };
  });
};

// ── Tooltip ───────────────────────────────────────────────────────────────────
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: C.surface2, border: `1px solid ${C.border}`,
      borderRadius: 6, padding: '8px 12px', fontSize: 11,
      fontFamily: 'DM Mono, monospace',
    }}>
      <div style={{ color: C.muted, marginBottom: 4 }}>{fmtDate(label)}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, marginBottom: 1 }}>
          {p.name}: {p.value != null ? p.value.toFixed(1) : '—'} TJ
        </div>
      ))}
    </div>
  );
};

// ── R² badge ──────────────────────────────────────────────────────────────────
const R2Badge = ({ r2 }) => (
  <div style={{
    position: 'absolute', top: 10, right: 16,
    fontFamily: 'DM Mono, monospace', fontSize: 10,
    color: C.muted, display: 'flex', alignItems: 'center', gap: 4,
  }}>
    <span style={{ color: C.dim }}>R²</span>
    <span style={{
      color: r2 == null ? C.dim
           : r2 >= 0.95 ? C.green
           : r2 >= 0.85 ? C.orange
           : C.red,
      fontWeight: 700, fontSize: 11,
    }}>
      {fmtR2(r2)}
    </span>
  </div>
);

// ── Single validation chart ───────────────────────────────────────────────────
const ValidationChart = ({ title, subtitle, data, predKey, actKey, color, yDomain }) => {
  const r2 = useMemo(() => calcR2(data, predKey, actKey), [data, predKey, actKey]);
  const hasActuals = data.some(r => r[actKey] != null);

  return (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 8, padding: '12px 16px 8px', position: 'relative',
    }}>
      <R2Badge r2={r2} />
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{title}</div>
        <div style={{ fontSize: 11, color: C.muted }}>{subtitle}</div>
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="date" {...AXIS} tickFormatter={fmtDate} minTickGap={40} />
          <YAxis {...AXIS} width={48} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(1)}k` : v} domain={yDomain} />
          <Tooltip content={<ChartTooltip />} />
          {/* Forecast line */}
          <Line
            dataKey={predKey} name="Forecast" type="monotone"
            stroke={color} strokeWidth={1.5} dot={false} connectNulls
          />
          {/* Actuals dots */}
          {hasActuals && (
            <Line
              dataKey={actKey} name="Actual" type="monotone"
              stroke="none" dot={{ fill: C.actual, r: 2.5, strokeWidth: 0 }}
              activeDot={{ r: 4 }} connectNulls
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, marginTop: 4, paddingLeft: 4 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: C.muted }}>
          <span style={{ width: 16, height: 2, background: color, display: 'inline-block', borderRadius: 1 }} />
          Forecast
        </span>
        {hasActuals && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: C.muted }}>
            <span style={{ width: 8, height: 8, background: C.actual, borderRadius: '50%', display: 'inline-block' }} />
            Actual (GBB)
          </span>
        )}
      </div>
    </div>
  );
};

// ── Main component ────────────────────────────────────────────────────────────
export default function TabValidation() {
  const [selectedYear, setSelectedYear] = useState(2025);
  const [data, setData]                 = useState(null);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState(null);

  // Auto-fetch when year changes
  useEffect(() => {
    setLoading(true);
    setError(null);
    setData(null);
    fetch(`/data/gas_validation_${selectedYear}.csv`)
      .then(r => {
        if (!r.ok) throw new Error(`File not found (${r.status})`);
        return r.text();
      })
      .then(text => {
        setData(parseValidationCsv(text));
        setLoading(false);
      })
      .catch(e => {
        setError(e.message);
        setLoading(false);
      });
  }, [selectedYear]);

  const yc = YEAR_COLORS[selectedYear] || C.blue;

  return (
    <div style={{ padding: '20px 24px', background: C.bg, minHeight: '100vh' }}>

      {/* Year selector */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20,
        flexWrap: 'wrap',
      }}>
        <span style={{
          fontSize: 10, color: C.muted, fontFamily: 'DM Mono, monospace',
          textTransform: 'uppercase', letterSpacing: '0.07em', marginRight: 2,
        }}>
          View year
        </span>
        {AVAILABLE_YEARS.map(y => {
          const active = y === selectedYear;
          const yColor = YEAR_COLORS[y] || '#888';
          return (
            <button key={y} onClick={() => setSelectedYear(y)} style={{
              padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
              fontSize: 11, fontFamily: 'DM Mono, monospace',
              border: `1px solid ${active ? yColor : C.border}`,
              background: active ? yColor + '22' : 'transparent',
              color: active ? yColor : C.muted,
              fontWeight: active ? 700 : 400,
              transition: 'all 0.15s',
            }}>
              {y}
            </button>
          );
        })}
      </div>

      {/* Loading / error states */}
      {loading && (
        <div style={{ color: C.muted, fontFamily: 'DM Mono, monospace', fontSize: 12, padding: '40px 0', textAlign: 'center' }}>
          Loading {selectedYear} validation data…
        </div>
      )}
      {error && (
        <div style={{ color: C.red, fontFamily: 'DM Mono, monospace', fontSize: 12, padding: '40px 0', textAlign: 'center' }}>
          {error} — run notebook cell 9d to generate gas_validation_{selectedYear}.csv
        </div>
      )}

      {/* Charts */}
      {data && !loading && (() => {
        const totalR2   = calcR2(data, 'pred_total_tj',   'actual_total_tj');
        const gpgR2     = calcR2(data, 'pred_gpg_tj',     'actual_gpg_tj');
        const npR2      = calcR2(data, 'pred_nonpower_tj','actual_nonpower_tj');

        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Summary banner */}
            <div style={{
              background: C.surface, border: `1px solid ${C.border}`,
              borderRadius: 8, padding: '10px 16px',
              display: 'flex', gap: 32, alignItems: 'center', flexWrap: 'wrap',
            }}>
              <div style={{ fontSize: 12, color: C.text, fontWeight: 700 }}>
                {selectedYear} Model Validation
              </div>
              <div style={{ fontSize: 11, color: C.muted, fontFamily: 'DM Mono, monospace' }}>
                {data.length} days
              </div>
              {[
                { label: 'Total R²',    r2: totalR2,  color: C.blue   },
                { label: 'GPG R²',      r2: gpgR2,    color: C.orange },
                { label: 'Non-pwr R²',  r2: npR2,     color: C.green  },
              ].map(({ label, r2, color }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, color: C.muted, fontFamily: 'DM Mono, monospace' }}>{label}</span>
                  <span style={{
                    fontSize: 12, fontWeight: 700, fontFamily: 'DM Mono, monospace',
                    color: r2 == null ? C.dim : r2 >= 0.95 ? C.green : r2 >= 0.85 ? C.orange : C.red,
                  }}>
                    {fmtR2(r2)}
                  </span>
                </div>
              ))}
            </div>

            {/* Row 1: Total demand (full width) */}
            <ValidationChart
              title="Total Gas Demand — SE NEM"
              subtitle="GPG + non-power · TJ/day"
              data={data}
              predKey="pred_total_tj"
              actKey="actual_total_tj"
              color={yc}
            />

            {/* Row 2: GPG + Non-power */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <ValidationChart
                title="Gas Power Generation Demand"
                subtitle="TJ/day"
                data={data}
                predKey="pred_gpg_tj"
                actKey="actual_gpg_tj"
                color={C.orange}
              />
              <ValidationChart
                title="Non-Power Gas Demand"
                subtitle="Domestic + industrial · TJ/day"
                data={data}
                predKey="pred_nonpower_tj"
                actKey="actual_nonpower_tj"
                color={C.green}
              />
            </div>

            {/* Row 3: States */}
            <div style={{ fontSize: 11, color: C.muted, marginBottom: -8 }}>
              Non-Power Demand by State
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <ValidationChart
                title="Victoria"
                subtitle="Non-power TJ/day"
                data={data}
                predKey="pred_vic_nonpower_tj"
                actKey="actual_vic_nonpower_tj"
                color={C.blue}
              />
              <ValidationChart
                title="NSW"
                subtitle="Non-power TJ/day"
                data={data}
                predKey="pred_nsw_nonpower_tj"
                actKey="actual_nsw_nonpower_tj"
                color={C.purple}
              />
              <ValidationChart
                title="South Australia"
                subtitle="Non-power TJ/day"
                data={data}
                predKey="pred_sa_nonpower_tj"
                actKey="actual_sa_nonpower_tj"
                color={C.teal}
              />
              <ValidationChart
                title="Tasmania"
                subtitle="Non-power TJ/day"
                data={data}
                predKey="pred_tas_nonpower_tj"
                actKey="actual_tas_nonpower_tj"
                color={C.red}
              />
            </div>

          </div>
        );
      })()}
    </div>
  );
}
