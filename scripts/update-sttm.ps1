# update-sttm.ps1
# 1. Finds the most recently downloaded STTM price file and pushes it to the pod
# 2. Finds the latest forecast files and pushes them to the pod
# Run after downloading the STTM Price and Withdrawals xlsx from:
# https://www.aemo.com.au/energy-systems/gas/short-term-trading-market-sttm/data-sttm/daily-sttm-reports

$pod          = "peterl@newpod"
$podData      = "~/apps/gas-dashboard/public/data"
$forecastsDir = "C:\Users\peter\Python\data\forecasts"
$downloadsDir = "$env:USERPROFILE\Downloads"

# ── STTM ─────────────────────────────────────────────────────────────────────
$sttmFile = Get-ChildItem -Path $downloadsDir -File |
            Where-Object { $_.Name -match "(?i)STTM.*Price|Price.*STTM" } |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1

if (-not $sttmFile) {
    Write-Host "No STTM file found in Downloads. Please download it from AEMO first."
    Write-Host "https://www.aemo.com.au/energy-systems/gas/short-term-trading-market-sttm/data-sttm/daily-sttm-reports"
} else {
    Write-Host "STTM: $($sttmFile.Name) ($($sttmFile.LastWriteTime.ToString('dd/MM/yyyy HH:mm')))"
    scp $sttmFile.FullName "${pod}:${podData}/STTM.XLSX"
    if ($LASTEXITCODE -eq 0) { Write-Host "  OK" } else { Write-Host "  FAILED" }
}

# ── Forecast (main) ───────────────────────────────────────────────────────────
$forecastFile = Get-ChildItem -Path $forecastsDir -Filter "gas_forecast_????????.csv" -File |
                Sort-Object Name -Descending |
                Select-Object -First 1

if (-not $forecastFile) {
    Write-Host "No forecast file found in $forecastsDir"
} else {
    Write-Host "Forecast: $($forecastFile.Name)"
    scp $forecastFile.FullName "${pod}:${podData}/$($forecastFile.Name)"
    if ($LASTEXITCODE -eq 0) { Write-Host "  OK" } else { Write-Host "  FAILED" }
}

Write-Host ""
Write-Host "Done: $(Get-Date -Format 'dd/MM/yyyy HH:mm')"
