// Chart exports that match the chart (Dashboard-Refresh-Plan.md, principle 2).
//
// Every ChartCard can take an `exportSpec` (object, or a function returning one so it is built only
// on click):
//   {
//     title, subtitle,            // shown in the file / slide
//     units: 'TJ/day',
//     xKey: 'date', xLabel: 'Date', xFormat: v => string,   // category axis (optional formatter)
//     series: [{ key, label, color, type: 'line'|'area'|'bar' }],   // exactly the plotted series
//     rows,                       // the array the chart plots
//     chartType: 'line'|'area'|'bar', stacked: false,        // default for series without `type`
//     source: 'AEMO Gas Bulletin Board', modelVersion: '2.0-test', note,
//   }
// Excel: metadata block (title, units, range, source, model version, generated) then one row per
// chart point. PPT: a native (editable) chart from the same rows + the same metadata as a footer.
import * as XLSX from 'xlsx';
import PptxGenJS from 'pptxgenjs';

const resolve = spec => (typeof spec === 'function' ? spec() : spec);
const slug = s => String(s || 'chart').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 80);
const num = v => (v === null || v === undefined || v === '' || Number.isNaN(+v) ? null : +v);
const fmtX = (spec, v) => (spec.xFormat ? spec.xFormat(v) : v);

function meta(spec) {
  const rows = spec.rows || [];
  const first = rows.length ? fmtX(spec, rows[0][spec.xKey]) : '';
  const last = rows.length ? fmtX(spec, rows[rows.length - 1][spec.xKey]) : '';
  return [
    ['Title', spec.title || ''],
    ...(spec.subtitle ? [['Description', spec.subtitle]] : []),
    ['Units', spec.units || ''],
    ['Range', `${first} to ${last} (${rows.length} points)`],
    ['Source', spec.source || 'AEMO Gas Bulletin Board'],
    ...(spec.modelVersion ? [['Model version', spec.modelVersion]] : []),
    ...(spec.note ? [['Note', spec.note]] : []),
    ['Generated', new Date().toLocaleString('en-AU')],
  ];
}

export function exportChartXLSX(specIn) {
  const spec = resolve(specIn);
  if (!spec || !spec.rows) return;
  const series = spec.series || [];
  const header = [spec.xLabel || spec.xKey, ...series.map(s => (spec.units ? `${s.label} (${spec.units})` : s.label))];
  const body = spec.rows.map(r => [fmtX(spec, r[spec.xKey]), ...series.map(s => num(r[s.key]))]);
  const aoa = [...meta(spec), [], header, ...body];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 16 }, ...series.map(s => ({ wch: Math.max(12, String(s.label).length + 8) }))];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Chart data');
  XLSX.writeFile(wb, `${slug(spec.title)}.xlsx`);
}

export async function exportChartPPT(specIn) {
  const spec = resolve(specIn);
  if (!spec || !spec.rows) return;
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  const slide = pptx.addSlide();
  slide.addText(spec.title || '', { x: 0.4, y: 0.25, w: 12.5, h: 0.5, fontSize: 22, bold: true, color: '1F2937' });
  if (spec.subtitle) slide.addText(spec.subtitle, { x: 0.4, y: 0.75, w: 12.5, h: 0.4, fontSize: 12, color: '6B7280' });

  const labels = spec.rows.map(r => String(fmtX(spec, r[spec.xKey])));
  const series = spec.series || [];
  const T = { line: pptx.ChartType.line, area: pptx.ChartType.area, bar: pptx.ChartType.bar };
  const typeOf = s => s.type || spec.chartType || 'line';
  const groups = {};
  series.forEach(s => { (groups[typeOf(s)] = groups[typeOf(s)] || []).push(s); });
  const dataFor = list => list.map(s => ({ name: s.label, labels, values: spec.rows.map(r => num(r[s.key])) }));
  const colors = list => list.map(s => (s.color || '#64748B').replace('#', ''));
  const every = Math.max(1, Math.ceil(labels.length / 24));
  const common = {
    x: 0.4, y: 1.2, w: 12.5, h: 5.4,
    showLegend: true, legendPos: 'b', legendFontSize: 10,
    catAxisLabelFontSize: 9, valAxisLabelFontSize: 9, catAxisLabelFrequency: every,
    valAxisTitle: spec.units || '', showValAxisTitle: !!spec.units, valAxisTitleFontSize: 10,
    lineSize: 1.5, lineDataSymbol: 'none',
  };
  const kinds = Object.keys(groups);
  if (kinds.length === 1) {
    const k = kinds[0];
    slide.addChart(T[k], dataFor(groups[k]), {
      ...common, chartColors: colors(groups[k]),
      ...(k === 'bar' ? { barDir: 'col', barGrouping: spec.stacked ? 'stacked' : 'clustered' } : {}),
      ...(k === 'area' && spec.stacked ? { barGrouping: 'stacked' } : {}),
    });
  } else {                                           // combo, e.g. stacked areas + a demand line
    const parts = kinds.map(k => ({
      type: T[k], data: dataFor(groups[k]),
      options: { chartColors: colors(groups[k]), ...(spec.stacked && k !== 'line' ? { barGrouping: 'stacked' } : {}) },
    }));
    slide.addChart(parts, common);
  }
  const foot = meta(spec).filter(([k]) => k !== 'Title' && k !== 'Description').map(([k, v]) => `${k}: ${v}`).join('   ·   ');
  slide.addText(foot, { x: 0.4, y: 6.75, w: 12.5, h: 0.4, fontSize: 9, color: '6B7280' });
  await pptx.writeFile({ fileName: `${slug(spec.title)}.pptx` });
}
