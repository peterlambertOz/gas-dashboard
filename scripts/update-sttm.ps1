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

# Download latest AEMO price files
$aemoDir = $forecastsDir
Write-Host "Downloading AEMO price files..."

$dwgmDest = "$aemoDir\dwgm-prices-and-demand.xlsx"
try {
    Invoke-WebRequest -Uri "https://www.aemo.com.au/-/media/files/gas/dwgm/dwgm-prices-and-demand.xlsx" `
        -OutFile $dwgmDest -UseBasicParsing
    Write-Host "  DWGM OK ($([math]::Round((Get-Item $dwgmDest).Length/1KB))KB)"
} catch {
    Write-Host "  DWGM download failed: $_" -ForegroundColor Yellow
}

$sttmDest = "$aemoDir\sttm-price-and-withdrawals.xlsx"
try {
    Invoke-WebRequest -Uri "https://www.aemo.com.au/-/media/files/gas/sttm/data/sttm-price-and-withdrawals.xlsx" `
        -OutFile $sttmDest -UseBasicParsing
    Write-Host "  STTM OK ($([math]::Round((Get-Item $sttmDest).Length/1KB))KB)"
} catch {
    Write-Host "  STTM download failed: $_" -ForegroundColor Yellow
}

# Push AEMO price files to pod
foreach ($priceFile in @("dwgm-prices-and-demand.xlsx", "sttm-price-and-withdrawals.xlsx")) {
    $src = "$aemoDir\$priceFile"
    if (Test-Path $src) {
        scp $src "${pod}:${podData}/$priceFile"
        if ($LASTEXITCODE -eq 0) { Write-Host "  $priceFile OK" } else { Write-Host "  $priceFile FAILED" }
    }
}

# Validation CSVs (one per year - only changes when models are retrained)
$validationFiles = Get-ChildItem -Path $forecastsDir -Filter "gas_validation_202?.csv" -File
if ($validationFiles.Count -eq 0) {
    Write-Host "No validation CSV files found in $forecastsDir"
} else {
    Write-Host "Validation files: $($validationFiles.Count) years"
    foreach ($vf in $validationFiles) {
        scp $vf.FullName "${pod}:${podData}/$($vf.Name)"
        if ($LASTEXITCODE -eq 0) { Write-Host "  $($vf.Name) OK" } else { Write-Host "  $($vf.Name) FAILED" }
    }
}

# Forecast (hourly)
$hourlyFile = Get-ChildItem -Path $forecastsDir -Filter "gas_forecast_hourly_????????.csv" -File |
              Sort-Object Name -Descending |
              Select-Object -First 1

if (-not $hourlyFile) {
    Write-Host "No hourly forecast file found in $forecastsDir"
} else {
    Write-Host "Hourly forecast: $($hourlyFile.Name)"
    scp $hourlyFile.FullName "${pod}:${podData}/$($hourlyFile.Name)"
    if ($LASTEXITCODE -eq 0) { Write-Host "  OK" } else { Write-Host "  FAILED" }
}

# Regime thresholds (static - only changes when notebook 1g-thresholds reruns)
$thresholdsFile = "$forecastsDir\regime_thresholds.json"
if (-not (Test-Path $thresholdsFile)) {
    Write-Host "regime_thresholds.json not found in $forecastsDir — skipping"
} else {
    Write-Host "Regime thresholds: regime_thresholds.json"
    scp $thresholdsFile "${pod}:${podData}/regime_thresholds.json"
    if ($LASTEXITCODE -eq 0) { Write-Host "  OK" } else { Write-Host "  FAILED" }
}

Write-Host ""
$doneTime = Get-Date -Format "dd/MM/yyyy HH:mm"
Write-Host "Done: $doneTime"
