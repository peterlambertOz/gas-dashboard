import sys, re
root = sys.argv[1]
# ---- ChartCard: exportSpec + always-visible buttons
p = f"{root}/src/components/ChartCard.jsx"; s = open(p, encoding="utf-8").read()
s = s.replace("import { useState } from 'react';",
              "import { useState } from 'react';\nimport { exportChartXLSX, exportChartPPT } from '../utils/chartExport';", 1)
s = s.replace("export function ChartCard({ id, title, subtitle, children, onExportPPT, onExportXLSX, style }) {\n  const [hovered, setHovered] = useState(false);",
              "export function ChartCard({ id, title, subtitle, children, onExportPPT, onExportXLSX, exportSpec, style }) {\n  const [hovered, setHovered] = useState(false);\n  // exportSpec (utils/chartExport.js) exports exactly the plotted rows; legacy handlers kept for unconverted charts\n  const doXLSX = exportSpec ? () => exportChartXLSX(exportSpec) : onExportXLSX;\n  const doPPT = exportSpec ? () => exportChartPPT(exportSpec) : onExportPPT;", 1)
s = s.replace("""          display: 'flex', gap: 6, opacity: hovered ? 1 : 0,
          transition: 'opacity 0.2s', pointerEvents: hovered ? 'auto' : 'none',""",
              """          display: 'flex', gap: 6, opacity: hovered ? 1 : 0.55,
          transition: 'opacity 0.2s',""", 1)
s = s.replace("""          {onExportXLSX && (
            <ExportButton onClick={onExportXLSX} label="XLSX" color="#3fb950" />
          )}
          {onExportPPT && (
            <ExportButton onClick={onExportPPT} label="PPT" color="#e6a817" />
          )}""", """          {doXLSX && (
            <ExportButton onClick={doXLSX} label="XLSX" color="#3fb950" />
          )}
          {doPPT && (
            <ExportButton onClick={doPPT} label="PPT" color="#e6a817" />
          )}""", 1)
assert s.count("doXLSX") == 3 and "exportSpec, style" in s, "ChartCard patch failed"
open(p, "w", encoding="utf-8", newline="\n").write(s)

# ---- TabDailyDemand: exportSpec for all four charts
p = f"{root}/src/tabs/TabDailyDemand.jsx"; s = open(p, encoding="utf-8").read()
reps = [
("""        onExportPPT={() => exportToPowerPoint([{ id: 'chart-yoy-demand', title: 'Year-on-Year Daily Demand', subtitle: 'SE States (TJ/day)' }])}
        onExportXLSX={() => exportToExcel(filtered)}""",
"""        exportSpec={() => ({
          title: 'Year-on-Year Daily Demand Comparison', subtitle: 'SE states total demand, overlay by calendar day',
          units: 'TJ/day', xKey: 'day', xLabel: 'Day', xFormat: dayLabel, chartType: 'line', rows: yoyData,
          series: [...selectedYears].sort().map(y => ({ key: String(y), label: String(y), color: YEAR_COLORS[y] })),
        })}"""),
("""        onExportPPT={() => exportToPowerPoint([{ id: 'chart-state-demand-daily', title: `${stateYear} Daily Demand by State` }])}
        onExportXLSX={() => exportToExcel(records.filter(r => r.year === stateYear))}""",
"""        exportSpec={() => ({
          title: `${stateYear} Daily Demand by State`, subtitle: 'Stacked: VIC / NSW / SA / TAS',
          units: 'TJ/day', xKey: 'date', xLabel: `Date (${stateYear}, mm-dd)`, chartType: 'area', stacked: true, rows: stateDaily,
          series: [{ key: 'vic', label: 'VIC', color: STATE_COLORS.VIC }, { key: 'nsw', label: 'NSW', color: STATE_COLORS.NSW },
                   { key: 'sa', label: 'SA', color: STATE_COLORS.SA }, { key: 'tas', label: 'TAS', color: STATE_COLORS.TAS }],
        })}"""),
("""        onExportPPT={() => exportToPowerPoint([{ id: 'chart-stacked-demand', title: `${stackYear} Daily Demand by Segment` }])}
        onExportXLSX={() => exportToExcel(records.filter(r => r.year === stackYear))}""",
"""        exportSpec={() => ({
          title: `${stackYear} Daily Demand by Segment`, subtitle: 'Stacked: Residential & Commercial / Industrial / GPG',
          units: 'TJ/day', xKey: 'date', xLabel: `Date (${stackYear}, mm-dd)`, chartType: 'area', stacked: true, rows: stackedDaily,
          series: [{ key: 'residential', label: 'Res & Comm', color: CHART_COLORS.residential },
                   { key: 'industrial', label: 'Industrial', color: CHART_COLORS.industrial },
                   { key: 'gpg', label: 'GPG', color: CHART_COLORS.gpg }],
        })}"""),
("""        onExportPPT={() => exportToPowerPoint([{ id: 'chart-monthly-avg', title: 'Average Monthly Demand by Segment' }])}
        onExportXLSX={() => exportToExcel(filtered)}""",
"""        exportSpec={() => ({
          title: 'Average Monthly Demand by Segment', subtitle: 'Mean TJ/day per month, by year',
          units: 'TJ/day', xKey: 'month', xLabel: 'Month', chartType: 'bar', rows: monthlyAvg,
          series: [...selectedYears].sort().flatMap(y => [
            { key: `gpg_${y}`, label: `GPG ${y}`, color: CHART_COLORS.gpg },
            { key: `ind_${y}`, label: `Industrial ${y}`, color: CHART_COLORS.industrial },
            { key: `res_${y}`, label: `Res & Comm ${y}`, color: CHART_COLORS.residential }]),
        })}"""),
]
for a, b in reps:
    assert s.count(a) == 1, a[:60]
    s = s.replace(a, b)
open(p, "w", encoding="utf-8", newline="\n").write(s)
print("patched ChartCard + TabDailyDemand")
