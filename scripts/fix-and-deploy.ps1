# fix-and-deploy.ps1
# Deploys the gas-dashboard to the pod by syncing source files and rebuilding.
# Also copies latest data files to local public/data/ for the dev server.
# Run from: C:\Users\peter\Python\gas-dashboard

$pod          = "peterl@100.67.124.18"
$appDir       = "~/apps/gas-dashboard"
$localDir     = "C:\Users\peter\Python\gas-dashboard"
$localData    = "C:\Users\peter\Python\gas-dashboard\public\data"
$forecastsDir = "C:\Users\peter\Python\data\forecasts"

# ── Helper: copy a file to both local public/data and pod ────────────────────
function Deploy-DataFile($path) {
    $name = Split-Path $path -Leaf
    # Local
    if (Test-Path $path) {
        Copy-Item $path "$localData\$name" -Force
        Write-Host "  [local] $name OK" -ForegroundColor Green
        # Pod
        scp $path "${pod}:${appDir}/public/data/$name"
        if ($LASTEXITCODE -eq 0) { Write-Host "  [pod]   $name OK" -ForegroundColor Green }
        else { Write-Host "  [pod]   WARNING: $name failed" -ForegroundColor Yellow }
    } else {
        Write-Host "  SKIP: $name not found at $path" -ForegroundColor Yellow
    }
}

Write-Host "=== Step 1: Sync source files to pod ===" -ForegroundColor Cyan
$srcFiles = @(
    "src\App.jsx",
    "src\tabs\TabForecast.jsx",
    "src\tabs\TabHistoricalWeather.jsx"
)
foreach ($f in $srcFiles) {
    $remote = $f -replace "\\", "/"
    scp "$localDir\$f" "${pod}:${appDir}/${remote}"
    if ($LASTEXITCODE -eq 0) { Write-Host "  $f OK" -ForegroundColor Green }
    else { Write-Host "  WARNING: $f failed" -ForegroundColor Yellow }
}

Write-Host ""
Write-Host "=== Step 2: Rebuild container on pod ===" -ForegroundColor Cyan
ssh $pod "cd $appDir && docker compose up -d --build --force-recreate"
if ($LASTEXITCODE -ne 0) { Write-Host "  FAILED" -ForegroundColor Red; exit 1 }
Write-Host "  Container rebuilt OK" -ForegroundColor Green

Write-Host ""
Write-Host "=== Step 3: Deploy data files (local + pod) ===" -ForegroundColor Cyan

# Latest forecast CSV
$forecastFile = Get-ChildItem -Path $forecastsDir -Filter "gas_forecast_????????.csv" |
                Where-Object { $_.Name -notmatch "hourly" } |
                Sort-Object Name -Descending | Select-Object -First 1
if ($forecastFile) { Deploy-DataFile $forecastFile.FullName }
else { Write-Host "  SKIP: no forecast CSV found" -ForegroundColor Yellow }

# Latest hourly forecast CSV
$hourlyFile = Get-ChildItem -Path $forecastsDir -Filter "gas_forecast_hourly_????????.csv" |
              Sort-Object Name -Descending | Select-Object -First 1
if ($hourlyFile) { Deploy-DataFile $hourlyFile.FullName }
else { Write-Host "  SKIP: no hourly CSV found (run cell 8h-hourly first)" -ForegroundColor Yellow }

# Historical JSON files
foreach ($file in @("gas_historical_poe.json", "gas_historical_traces.json")) {
    Deploy-DataFile "$forecastsDir\$file"
}

Write-Host ""
Write-Host "=== Done $(Get-Date -Format 'dd/MM/yyyy HH:mm') ===" -ForegroundColor Cyan
Write-Host "Local:  http://localhost:5173/" -ForegroundColor Green
Write-Host "Pod:    http://gas-dashboard.peterl.bba.internal/" -ForegroundColor Green
