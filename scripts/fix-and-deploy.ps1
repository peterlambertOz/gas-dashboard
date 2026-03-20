# fix-and-deploy.ps1
# Deploys the gas-dashboard to the pod by syncing source files and rebuilding.
# Run from: C:\Users\peter\Python\gas-dashboard

$pod          = "peterl@newpod"
$appDir       = "~/apps/gas-dashboard"
$localDir     = "C:\Users\peter\Python\gas-dashboard"
$forecastsDir = "C:\Users\peter\Python\data\forecasts"

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
Write-Host "=== Step 2: Rebuild and restart container on pod ===" -ForegroundColor Cyan
ssh $pod "cd $appDir && docker compose up -d --build --force-recreate"
if ($LASTEXITCODE -ne 0) { Write-Host "  FAILED" -ForegroundColor Red; exit 1 }
Write-Host "  Container rebuilt OK" -ForegroundColor Green

Write-Host ""
Write-Host "=== Step 3: Push data files ===" -ForegroundColor Cyan
# Also push latest hourly forecast CSV
$hourlyFile = Get-ChildItem -Path $forecastsDir -Filter "gas_forecast_hourly_????????.csv" |
              Sort-Object Name -Descending | Select-Object -First 1
if ($hourlyFile) {
    scp $hourlyFile.FullName "${pod}:${appDir}/public/data/$($hourlyFile.Name)"
    if ($LASTEXITCODE -eq 0) { Write-Host "  $($hourlyFile.Name) OK" -ForegroundColor Green }
    else { Write-Host "  WARNING: hourly CSV failed" -ForegroundColor Yellow }
} else {
    Write-Host "  SKIP: no hourly forecast CSV found (run cell 8h-hourly first)" -ForegroundColor Yellow
}

foreach ($file in @("gas_historical_poe.json", "gas_historical_traces.json")) {
    $path = "$forecastsDir\$file"
    if (Test-Path $path) {
        scp $path "${pod}:${appDir}/public/data/$file"
        if ($LASTEXITCODE -eq 0) { Write-Host "  $file OK" -ForegroundColor Green }
        else { Write-Host "  WARNING: $file failed" -ForegroundColor Yellow }
    } else {
        Write-Host "  SKIP: $file not found" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "=== Done $(Get-Date -Format 'dd/MM/yyyy HH:mm') ===" -ForegroundColor Cyan
Write-Host "Live at: http://gas-dashboard.peterl.bba.internal/" -ForegroundColor Green
