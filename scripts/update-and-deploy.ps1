# update-and-deploy.ps1
# Runs the full dashboard update pipeline:
#   1. Run gas demand forecast (run_gas_forecast.py)
#   2. Git commit and push source changes
#   3. Push latest STTM and forecast data files
#   4. Sync source files, rebuild container, and deploy to pod

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$dashDir   = Split-Path -Parent $scriptDir

Set-Location $dashDir

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  East Coast Gas Dashboard - Full Update    " -ForegroundColor Cyan
Write-Host "  $(Get-Date -Format 'dd/MM/yyyy HH:mm')    " -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Run gas demand forecast
Write-Host "-- Step 1: Gas demand forecast --------------" -ForegroundColor Yellow
$forecastScript = "C:\Users\peter\Python\run_gas_forecast.py"
if (Test-Path $forecastScript) {
    python $forecastScript
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Forecast OK" -ForegroundColor Green
    } else {
        Write-Host "  WARNING: Forecast script failed (exit code $LASTEXITCODE) -- continuing" -ForegroundColor Yellow
    }
} else {
    Write-Host "  WARNING: $forecastScript not found -- skipping forecast" -ForegroundColor Yellow
}
Write-Host ""

# Step 2: Git commit and push
Write-Host "-- Step 2: Git commit and push --------------" -ForegroundColor Yellow

# Stage all source files (tabs, scripts, config)
git add src/
git add scripts/
git add index.html vite.config.js package.json Dockerfile nginx.conf docker-compose.yml

$status = git status --porcelain
if ($status) {
    $msg = "Deploy $(Get-Date -Format 'yyyy-MM-dd HH:mm') - dashboard update"
    git commit -m $msg
    if ($LASTEXITCODE -eq 0) {
        git push origin master
        if ($LASTEXITCODE -eq 0) { Write-Host "  Git push OK" -ForegroundColor Green }
        else { Write-Host "  WARNING: git push failed" -ForegroundColor Yellow }
    } else {
        Write-Host "  WARNING: git commit failed" -ForegroundColor Yellow
    }
} else {
    Write-Host "  No source changes to commit" -ForegroundColor Gray
}
Write-Host ""

# Step 3: Push data files (STTM, forecast CSVs, historical JSONs)
Write-Host "-- Step 3: Push data files ------------------" -ForegroundColor Yellow
& "$scriptDir\update-sttm.ps1"
Write-Host ""

# Step 4: Deploy to pod (sync source, rebuild, restart)
Write-Host "-- Step 4: Deploy to pod --------------------" -ForegroundColor Yellow
& "$scriptDir\fix-and-deploy.ps1"
Write-Host ""

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  Done: $(Get-Date -Format 'dd/MM/yyyy HH:mm')" -ForegroundColor Cyan
Write-Host "  http://gas-dashboard.peterl.bba.internal/ " -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Cyan
