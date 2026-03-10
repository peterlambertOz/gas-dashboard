import * as XLSX from 'xlsx';
import PptxGenJS from 'pptxgenjs';
import html2canvas from 'html2canvas';

// ─── Excel Export ────────────────────────────────────────────────────────────

export function exportToExcel(records, filename = 'AEMOGasDemand.xlsx') {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Full daily data
  const dailyData = records.map(r => ({
    Date: r.date,
    Year: r.year,
    Month: r.month,
    // SE aggregate demand
    'GPG SE (TJ)': r.gpg_se,
    'GPG QLD (TJ)': r.gpg_qld,
    'Residential & Commercial (TJ)': r.residential,
    'Industrial (TJ)': r.industrial,
    'Total Demand SE (TJ)': r.total_demand_se,
    // State-level pipeline demand
    'VIC Demand (TJ)': r.pipe_vic,
    'NSW Demand (TJ)': r.pipe_nsw,
    'SA Demand (TJ)': r.pipe_sa,
    'TAS Demand (TJ)': r.pipe_tas,
    // State-level GPG
    'VIC GPG (TJ)': r.gpg_vic,
    'NSW GPG (TJ)': r.gpg_nsw,
    'SA GPG (TJ)': r.gpg_sa,
    'TAS GPG (TJ)': r.gpg_tas,
    // State-level non-GPG demand
    'VIC Non-GPG (TJ)': (r.pipe_vic || 0) - (r.gpg_vic || 0),
    'NSW Non-GPG (TJ)': (r.pipe_nsw || 0) - (r.gpg_nsw || 0),
    'SA Non-GPG (TJ)':  (r.pipe_sa  || 0) - (r.gpg_sa  || 0),
    'TAS Non-GPG (TJ)': (r.pipe_tas || 0) - (r.gpg_tas || 0),
    // Production
    'Production Longford (TJ)': r.production_longford,
    'Production Moomba (TJ)': r.production_moomba,
    'Production Other South (TJ)': r.production_other_south,
    'Production SWQP (TJ)': r.production_swqp,
    'Total Production (TJ)': r.total_production,
    // QLD net flow
    'QLD Supply to SE (TJ)': r.qld_supply,
    'SE to QLD (TJ)': r.se_to_qld,
    'QLD Net Flow (TJ)': r.qld_net_flow,
    // Storage
    'Storage Withdrawal (TJ)': r.storage_withdrawal,
    'Storage Injection (TJ)': r.storage_injection,
    'Storage Iona Net (TJ)': r.storage_iona,
    'Storage Other Net (TJ)': r.storage_other,
    'Storage Iona Balance (TJ)': r.storage_balance_iona,
  }));

  const ws1 = XLSX.utils.json_to_sheet(dailyData);
  styleWorksheet(ws1, dailyData.length);
  XLSX.utils.book_append_sheet(wb, ws1, 'Daily Data');

  // Sheet 2: Annual summary
  const years = [...new Set(records.map(r => r.year))].sort();
  const annualData = years.map(y => {
    const yr = records.filter(r => r.year === y && r.total_demand_se > 0);
    const gpgs = yr.map(r => r.gpg_se);
    return {
      Year: y,
      'Peak Demand SE (TJ)': Math.round(Math.max(...yr.map(r => r.total_demand_se))),
      'Avg Demand SE (TJ)': Math.round(yr.reduce((a, r) => a + r.total_demand_se, 0) / yr.length),
      'Peak GPG (TJ)': Math.round(Math.max(...gpgs)),
      'Days GPG > 400': gpgs.filter(v => v > 400).length,
      'Days GPG > 500': gpgs.filter(v => v > 500).length,
      'Days GPG > 600': gpgs.filter(v => v > 600).length,
      'Avg Production (TJ)': Math.round(yr.reduce((a, r) => a + r.total_production, 0) / yr.length),
    };
  });
  const ws2 = XLSX.utils.json_to_sheet(annualData);
  XLSX.utils.book_append_sheet(wb, ws2, 'Annual Summary');

  // Sheet 3: Monthly averages
  const monthlyData = [];
  for (const y of years) {
    for (let m = 1; m <= 12; m++) {
      const mo = records.filter(r => r.year === y && r.month === m);
      if (mo.length === 0) continue;
      const avg = (field) => Math.round(mo.reduce((a, r) => a + (r[field] || 0), 0) / mo.length);
      monthlyData.push({
        Year: y,
        Month: m,
        'Month Name': new Date(y, m - 1, 1).toLocaleString('default', { month: 'short' }),
        'Avg GPG SE (TJ)': avg('gpg_se'),
        'Avg Residential (TJ)': avg('residential'),
        'Avg Industrial (TJ)': avg('industrial'),
        'Avg Total SE (TJ)': avg('total_demand_se'),
        'Peak Day SE (TJ)': Math.round(Math.max(...mo.map(r => r.total_demand_se))),
        'Avg VIC (TJ)': avg('pipe_vic'),
        'Avg NSW (TJ)': avg('pipe_nsw'),
        'Avg SA (TJ)':  avg('pipe_sa'),
        'Avg TAS (TJ)': avg('pipe_tas'),
        'Avg Longford (TJ)': avg('production_longford'),
        'Avg Moomba (TJ)': avg('production_moomba'),
        'Avg QLD Net (TJ)': avg('qld_net_flow'),
      });
    }
  }
  const ws3 = XLSX.utils.json_to_sheet(monthlyData);
  XLSX.utils.book_append_sheet(wb, ws3, 'Monthly Averages');

  // Sheet 4: State breakdown — monthly averages per state
  const stateMonthly = [];
  for (const y of years) {
    for (let m = 1; m <= 12; m++) {
      const mo = records.filter(r => r.year === y && r.month === m && r.pipe_vic != null);
      if (mo.length === 0) continue;
      const avg = (field) => Math.round(mo.reduce((a, r) => a + (r[field] || 0), 0) / mo.length);
      stateMonthly.push({
        Year: y,
        Month: m,
        'Month Name': new Date(y, m - 1, 1).toLocaleString('default', { month: 'short' }),
        'VIC Total (TJ)':    avg('pipe_vic'),
        'VIC GPG (TJ)':      avg('gpg_vic'),
        'VIC Non-GPG (TJ)':  Math.round(mo.reduce((a,r) => a + (r.pipe_vic||0) - (r.gpg_vic||0), 0) / mo.length),
        'NSW Total (TJ)':    avg('pipe_nsw'),
        'NSW GPG (TJ)':      avg('gpg_nsw'),
        'NSW Non-GPG (TJ)':  Math.round(mo.reduce((a,r) => a + (r.pipe_nsw||0) - (r.gpg_nsw||0), 0) / mo.length),
        'SA Total (TJ)':     avg('pipe_sa'),
        'SA GPG (TJ)':       avg('gpg_sa'),
        'SA Non-GPG (TJ)':   Math.round(mo.reduce((a,r) => a + (r.pipe_sa||0) - (r.gpg_sa||0), 0) / mo.length),
        'TAS Total (TJ)':    avg('pipe_tas'),
        'TAS GPG (TJ)':      avg('gpg_tas'),
        'SE Total (TJ)':     avg('total_demand_se'),
      });
    }
  }
  const ws4 = XLSX.utils.json_to_sheet(stateMonthly);
  styleWorksheet(ws4, stateMonthly.length);
  XLSX.utils.book_append_sheet(wb, ws4, 'State Breakdown');

  // Sheet 5: Annual state totals
  const stateAnnual = years.map(y => {
    const yr = records.filter(r => r.year === y && r.pipe_vic != null);
    if (yr.length === 0) return null;
    const avg = (field) => Math.round(yr.reduce((a, r) => a + (r[field] || 0), 0) / yr.length);
    return {
      Year: y,
      Days: yr.length,
      'VIC Avg (TJ/day)': avg('pipe_vic'),
      'VIC GPG Avg (TJ/day)': avg('gpg_vic'),
      'NSW Avg (TJ/day)': avg('pipe_nsw'),
      'NSW GPG Avg (TJ/day)': avg('gpg_nsw'),
      'SA Avg (TJ/day)': avg('pipe_sa'),
      'SA GPG Avg (TJ/day)': avg('gpg_sa'),
      'TAS Avg (TJ/day)': avg('pipe_tas'),
      'SE Total Avg (TJ/day)': avg('total_demand_se'),
      'Longford Avg (TJ/day)': avg('production_longford'),
      'Moomba Avg (TJ/day)': avg('production_moomba'),
      'QLD Net Avg (TJ/day)': avg('qld_net_flow'),
    };
  }).filter(Boolean);
  const ws5 = XLSX.utils.json_to_sheet(stateAnnual);
  styleWorksheet(ws5, stateAnnual.length);
  XLSX.utils.book_append_sheet(wb, ws5, 'Annual State Summary');

  XLSX.writeFile(wb, filename);
}

function styleWorksheet(ws, rowCount) {
  // Auto-width columns
  const cols = [];
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  for (let c = range.s.c; c <= range.e.c; c++) {
    let maxLen = 10;
    for (let r = range.s.r; r <= range.e.r; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.v) maxLen = Math.max(maxLen, String(cell.v).length);
    }
    cols.push({ wch: Math.min(maxLen + 2, 30) });
  }
  ws['!cols'] = cols;
}

// ─── Chart PNG capture ───────────────────────────────────────────────────────

export async function captureChartAsImage(elementId) {
  const el = document.getElementById(elementId);
  if (!el) throw new Error(`Element #${elementId} not found`);
  const canvas = await html2canvas(el, {
    backgroundColor: '#161b22',
    scale: 2,
    logging: false,
  });
  return canvas.toDataURL('image/png');
}

// ─── PowerPoint Export ───────────────────────────────────────────────────────

export async function exportToPowerPoint(charts, title = 'East Coast Gas Market Dashboard') {
  const pptx = new PptxGenJS();

  pptx.layout = 'LAYOUT_WIDE'; // 13.33" x 7.5"
  pptx.author = 'Gas Market Dashboard';
  pptx.company = 'AEMO Data';
  pptx.subject = 'East Coast Gas Demand Analysis';

  const BG = '0d1117';
  const SURFACE = '161b22';
  const ACCENT = 'e6a817';
  const TEXT = 'e6edf3';
  const MUTED = '7d8590';

  // ── Title slide ──────────────────────────────────────────────────────────
  const titleSlide = pptx.addSlide();
  titleSlide.background = { fill: BG };

  // Accent bar
  titleSlide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 0.18, h: 7.5,
    fill: { color: ACCENT },
    line: { color: ACCENT },
  });

  titleSlide.addText(title, {
    x: 0.45, y: 2.2, w: 12, h: 1.2,
    fontFace: 'Calibri', bold: true, fontSize: 36,
    color: TEXT,
  });

  const today = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  titleSlide.addText(`Source: AEMO GBB Actual Flow & Storage  ·  Generated ${today}`, {
    x: 0.45, y: 3.5, w: 12, h: 0.4,
    fontFace: 'Calibri', fontSize: 13, color: MUTED,
  });

  titleSlide.addText('East Coast Australia (SE States: VIC, NSW, SA, TAS + QLD)', {
    x: 0.45, y: 4.0, w: 12, h: 0.4,
    fontFace: 'Calibri', fontSize: 14, color: TEXT, italic: true,
  });

  // ── Chart slides ─────────────────────────────────────────────────────────
  for (const { id, title: chartTitle, subtitle } of charts) {
    let imageData;
    try {
      imageData = await captureChartAsImage(id);
    } catch (e) {
      console.warn(`Could not capture ${id}:`, e);
      continue;
    }

    const slide = pptx.addSlide();
    slide.background = { fill: BG };

    // Top accent bar
    slide.addShape(pptx.ShapeType.rect, {
      x: 0, y: 0, w: 13.33, h: 0.07,
      fill: { color: ACCENT },
      line: { color: ACCENT },
    });

    // Title
    slide.addText(chartTitle, {
      x: 0.3, y: 0.15, w: 12, h: 0.5,
      fontFace: 'Calibri', bold: true, fontSize: 20, color: TEXT,
    });

    if (subtitle) {
      slide.addText(subtitle, {
        x: 0.3, y: 0.63, w: 10, h: 0.28,
        fontFace: 'Calibri', fontSize: 11, color: MUTED,
      });
    }

    // Chart image
    slide.addImage({
      data: imageData,
      x: 0.25, y: 0.95, w: 12.83, h: 6.1,
    });

    // Footer
    slide.addText(`Source: AEMO GBB Actual Flow & Storage  ·  ${today}`, {
      x: 0.25, y: 7.2, w: 13, h: 0.22,
      fontFace: 'Calibri', fontSize: 9, color: MUTED,
    });
  }

  await pptx.writeFile({ fileName: `${title.replace(/\s+/g, '_')}.pptx` });
}

// Convenience: export just the visible/selected charts from the active tab
export async function exportCurrentTabToPPT(tabName, chartIds) {
  const charts = chartIds.map(({ id, title, subtitle }) => ({ id, title, subtitle }));
  await exportToPowerPoint(charts, `Gas_Dashboard_${tabName}`);
}
