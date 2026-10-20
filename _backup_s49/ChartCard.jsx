import { useState } from 'react';

export function ChartCard({ id, title, subtitle, children, onExportPPT, onExportXLSX, style }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      id={id}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '20px 20px 12px',
        position: 'relative',
        transition: 'border-color 0.2s',
        borderColor: hovered ? 'var(--accent)' : 'var(--border)',
        ...style,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <div>
          <div style={{
            fontFamily: 'Syne, sans-serif',
            fontWeight: 700,
            fontSize: 15,
            color: 'var(--text)',
            letterSpacing: '-0.01em',
          }}>
            {title}
          </div>
          {subtitle && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>
          )}
        </div>
        <div style={{
          display: 'flex', gap: 6, opacity: hovered ? 1 : 0,
          transition: 'opacity 0.2s', pointerEvents: hovered ? 'auto' : 'none',
        }}>
          {onExportXLSX && (
            <ExportButton onClick={onExportXLSX} label="XLSX" color="#3fb950" />
          )}
          {onExportPPT && (
            <ExportButton onClick={onExportPPT} label="PPT" color="#e6a817" />
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

function ExportButton({ onClick, label, color }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'transparent',
        border: `1px solid ${color}`,
        color,
        borderRadius: 4,
        padding: '3px 10px',
        fontSize: 11,
        fontFamily: 'DM Mono, monospace',
        cursor: 'pointer',
        fontWeight: 500,
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = color + '22'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
      ↓ {label}
    </button>
  );
}

export function KpiCard({ label, value, unit, sub, color = 'var(--accent)' }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '16px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'DM Mono, monospace' }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 28, fontFamily: 'Syne, sans-serif', fontWeight: 800, color, lineHeight: 1 }}>
          {value}
        </span>
        {unit && <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sub}</div>}
    </div>
  );
}

export function Legend({ items }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', marginTop: 8 }}>
      {items.map(({ color, label }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-muted)' }}>
          <div style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
          {label}
        </div>
      ))}
    </div>
  );
}

export const CHART_COLORS = {
  gpg: '#e6a817',
  residential: '#388bfd',
  industrial: '#3fb950',
  longford: '#ff7b72',
  moomba: '#ffa657',
  swqp: '#79c0ff',
  storageShallow: '#bc8cff',
  storageDeep: '#9a6fd8',
  capacity: '#f85149',
  year2019: '#8b949e',
  year2020: '#6e7681',
  year2021: '#79c0ff',
  year2022: '#3fb950',
  year2023: '#ffa657',
  year2024: '#388bfd',
  year2025: '#e6a817',
};

export const YEAR_COLORS = {
  2019: '#8b949e',
  2020: '#6e7681',
  2021: '#79c0ff',
  2022: '#3fb950',
  2023: '#ffa657',
  2024: '#388bfd',
  2025: '#e6a817',
};

// Custom tooltip for recharts
export function CustomTooltip({ active, payload, label, formatter, labelFormatter }) {
  if (!active || !payload?.length) return null;
  const displayLabel = labelFormatter ? labelFormatter(label) : label;
  return (
    <div style={{
      background: '#1c2330',
      border: '1px solid #30363d',
      borderRadius: 6,
      padding: '10px 14px',
      fontSize: 12,
      maxWidth: 240,
    }}>
      <div style={{ color: '#7d8590', marginBottom: 6, fontFamily: 'DM Mono, monospace', fontSize: 11 }}>{displayLabel}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
          <span style={{ color: p.color || '#e6edf3' }}>{p.name}</span>
          <span style={{ color: '#e6edf3', fontFamily: 'DM Mono, monospace', fontWeight: 500 }}>
            {formatter ? formatter(p.value, p.name) : Math.round(p.value)?.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

// Format a date string (YYYY-MM-DD or MM-DD) → DD-MMM  e.g. "26-Jun"
const _MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export function fmtDate(dateStr) {
  if (!dateStr) return dateStr;
  const parts = String(dateStr).split('-');
  if (parts.length === 3) { // YYYY-MM-DD
    return `${parseInt(parts[2])}-${_MONTHS[parseInt(parts[1]) - 1]}`;
  } else if (parts.length === 2) { // MM-DD
    return `${parseInt(parts[1])}-${_MONTHS[parseInt(parts[0]) - 1]}`;
  }
  return dateStr;
}

export const AXIS_STYLE = {
  tick: { fill: '#7d8590', fontSize: 11, fontFamily: 'DM Mono, monospace' },
  axisLine: { stroke: '#30363d' },
  tickLine: { stroke: '#30363d' },
};

export const GRID_STYLE = {
  stroke: '#21262d',
  strokeDasharray: '3 3',
};
