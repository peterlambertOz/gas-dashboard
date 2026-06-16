# update-sttm.ps1
# 1. Downloads fresh AEMO DWGM, STTM, and NEMWEB rolling CSV
# 2. Saves to both $forecastsDir (source of truth) and $localPublicData (local dev server)
# 3. Pushes all three to the pod
# Run after downloading the STTM Price and Withdrawals xlsx from:
# https://www.aemo.com.au/energy-systems/gas/short-term-trading-market-sttm/data-sttm/daily-sttm-reports

$pod            = "peterl@newpod"
$podData        = "~/apps/gas-dashboard/public/data"
$forecastsDir   = "C:\Users\peter\Python\data\forecasts"
$localPublicData = "C:\Users\peter\Python\gas-dashboard\public\data"
$downloadsDir   = "$env:USERPROFILE\Downloads"

New-Item -ItemType Directory -Force -Path $localPublicData | Out-Null

# ── Helper: download a URL to both $forecastsDir and $localPublicData ─────────
function Download-MarketFile($url, $fileName, $label, $headers = @{}) {
    $dest1 = "$forecastsDir\$fileName"
    $dest2 = "$localPublicData\$fileName"

    $allHeaders = @{
        "User-Agent"    = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
        "Cache-Control" = "no-cache, no-store"
        "Pragma"        = "no-cache"
    }
    foreach ($k in $headers.Keys) { $allHeaders[$k] = $headers[$k] }

    Write-Host "  Downloading $label..." -NoNewline
    try {
        Invoke-WebRequest -Uri $url -OutFile $dest1 -UseBasicParsing -Headers $allHeaders
        Copy-Item $dest1 $dest2 -Force
        $kb = [math]::Round((Get-Item $dest1).Length / 1KB)
        Write-Host " OK  ($kb KB)" -ForegroundColor Green
    } catch {
        Write-Host " FAILED: $_" -ForegroundColor Red
    }
}

# ── STTM file from Downloads (manually downloaded) ───────────────────────────
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

# ── Download AEMO + NEMWEB market data files ──────────────────────────────────
Write-Host "Downloading market data files..."

Download-MarketFile `
    "https://www.aemo.com.au/-/media/files/gas/dwgm/dwgm-prices-and-demand.xlsx" `
    "dwgm-prices-and-demand.xlsx" `
    "DWGM prices + demand" `
    @{ Referer = "https://www.aemo.com.au/" }

Download-MarketFile `
    "https://www.aemo.com.au/-/media/files/gas/sttm/data/sttm-price-and-withdrawals.xlsx" `
    "sttm-price-and-withdrawals.xlsx" `
    "STTM prices (SYD/ADL/BRI)" `
    @{ Referer = "https://www.aemo.com.au/" }

Download-MarketFile `
    "https://www.nemweb.com.au/Reports/CURRENT/VicGas/int310_v4_price_and_withdrawals_1.csv" `
    "int310_v4_price_and_withdrawals_1.csv" `
    "NEMWEB DWGM rolling 365 d"

# ── Push all three market data files to pod ───────────────────────────────────
Write-Host "Pushing market data files to pod..."
foreach ($priceFile in @("dwgm-prices-and-demand.xlsx", "sttm-price-and-withdrawals.xlsx", "int310_v4_price_and_withdrawals_1.csv")) {
    $src = "$forecastsDir\$priceFile"
    if (Test-Path $src) {
        scp $src "${pod}:${podData}/$priceFile"
        if ($LASTEXITCODE -eq 0) { Write-Host "  $priceFile OK" -ForegroundColor Green }
        else { Write-Host "  $priceFile FAILED" -ForegroundColor Red }
    } else {
        Write-Host "  SKIP: $priceFile not found (download failed above)" -ForegroundColor Yellow
    }
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

# ── Hourly forecast ───────────────────────────────────────────────────────────
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

# ── Validation CSVs ───────────────────────────────────────────────────────────
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

# ── Regime thresholds ─────────────────────────────────────────────────────────
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
