# Merge-SttmRecent.ps1
# Downloads the NEMWEB rolling STTM CSVs and merges them into a persistent
# sttm-recent.json accumulator covering the current month.
#
# Sources (in priority order per date):
#   INT651 ex-ante confirmed price  (7 days, one row per hub per day)
#   INT654 provisional price        (8 days incl 2 days ahead; D-2 preferred over D-3)
#
# The monthly XLSX overrides this file in the dashboard for settled dates.
#
# Run weekly via update-sttm.ps1. Safe to re-run - same data is idempotent.

param(
    [string]$ForecastsDir    = "C:\Users\peter\Python\data\forecasts",
    [string]$LocalPublicData = "C:\Users\peter\Python\gas-dashboard\public\data"
)

$exAnteUrl      = "https://www.nemweb.com.au/Reports/CURRENT/STTM/int651_v1_ex_ante_market_price_rpt_1.csv"
$provisionalUrl = "https://www.nemweb.com.au/Reports/CURRENT/STTM/int654_v1_provisional_market_price_rpt_1.csv"
$outputName     = "sttm-recent.json"
$outputPath     = Join-Path $ForecastsDir $outputName
$localPath      = Join-Path $LocalPublicData $outputName

$dlHeaders = @{
    "User-Agent"    = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
    "Cache-Control" = "no-cache, no-store"
    "Pragma"        = "no-cache"
}

# Helper: download CSV text
function Get-CsvText($url, $label) {
    Write-Host "  Downloading $label..." -NoNewline
    try {
        $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -Headers $dlHeaders
        Write-Host " OK  ($([math]::Round($resp.Content.Length/1KB)) KB)" -ForegroundColor Green
        return $resp.Content
    } catch {
        Write-Host " FAILED: $_" -ForegroundColor Red
        return $null
    }
}

# Helper: normalise DD MMM YYYY to YYYY-MM-DD
function Normalize-Date($raw) {
    $raw = $raw.Trim().Trim('"')
    # "23 Jun 2026" format
    if ($raw -match '^(\d{1,2}) (\w{3}) (\d{4})') {
        try {
            $dt = [datetime]::ParseExact($raw, "d MMM yyyy", $null)
            return $dt.ToString("yyyy-MM-dd")
        } catch {}
    }
    # DD/MM/YYYY
    if ($raw -match '^(\d{2})/(\d{2})/(\d{4})$') {
        return "$($Matches[3])-$($Matches[2])-$($Matches[1])"
    }
    # YYYY-MM-DD
    if ($raw -match '^(\d{4})-(\d{2})-(\d{2})') {
        return "$($Matches[1])-$($Matches[2])-$($Matches[3])"
    }
    return $null
}

# Parse INT651 ex-ante CSV
# Columns: gas_date, hub_identifier, hub_name, schedule_identifier,
#          ex_ante_market_price, ...
# One confirmed row per hub per day.
function Parse-ExAnte($text) {
    if (-not $text) { return @{} }
    $result = @{}
    $lines = $text -split "`n" | Where-Object { $_.Trim() -ne "" }
    if ($lines.Count -lt 2) { return @{} }

    $cols = $lines[0] -split "," | ForEach-Object { $_.Trim().ToLower() }
    $dateIdx  = [array]::IndexOf($cols, "gas_date")
    $hubIdx   = [array]::IndexOf($cols, "hub_identifier")
    $priceIdx = [array]::IndexOf($cols, "ex_ante_market_price")

    if ($dateIdx -lt 0 -or $hubIdx -lt 0 -or $priceIdx -lt 0) {
        Write-Host "    WARNING: unexpected columns in ex-ante CSV: $($cols -join ',')" -ForegroundColor Yellow
        return @{}
    }

    $rowCount = 0
    for ($i = 1; $i -lt $lines.Count; $i++) {
        $parts = $lines[$i] -split ","
        if ($parts.Count -le [Math]::Max($dateIdx, [Math]::Max($hubIdx, $priceIdx))) { continue }
        $dateStr = Normalize-Date $parts[$dateIdx]
        if (-not $dateStr) { continue }
        $hub = $parts[$hubIdx].Trim().ToUpper()
        if ($hub -eq 'ADL') { $hubKey = 'adl' }
        elseif ($hub -eq 'BRI') { $hubKey = 'bri' }
        elseif ($hub -eq 'SYD') { $hubKey = 'syd' }
        else { continue }
        $priceRaw = $parts[$priceIdx].Trim()
        $parsed = 0.0
        if (-not [double]::TryParse($priceRaw, [ref]$parsed)) { continue }
        if (-not $result.ContainsKey($dateStr)) { $result[$dateStr] = @{} }
        $result[$dateStr][$hubKey] = $parsed
        $rowCount++
    }
    Write-Host "    Parsed $rowCount rows from ex-ante CSV ($([math]::Round($rowCount/3)) days)" -ForegroundColor Gray
    return $result
}

# Parse INT654 provisional CSV
# Columns: gas_date, hub_identifier, hub_name, schedule_identifier,
#          provisional_price, provisional_schedule_type, report_datetime
# Multiple rows per hub per day (D-2 and D-3 schedules); prefer D-2 as more settled.
function Parse-Provisional($text) {
    if (-not $text) { return @{} }

    # Collect all rows keyed by date+hub, keeping best schedule type
    # D-2 = day-2 (more settled), D-3 = day-3 (earlier estimate)
    # Priority: D-2 > D-3
    $best = @{}   # "$dateStr|$hubKey" -> @{ price, schedType }

    $lines = $text -split "`n" | Where-Object { $_.Trim() -ne "" }
    if ($lines.Count -lt 2) { return @{} }

    $cols = $lines[0] -split "," | ForEach-Object { $_.Trim().ToLower() }
    $dateIdx  = [array]::IndexOf($cols, "gas_date")
    $hubIdx   = [array]::IndexOf($cols, "hub_identifier")
    $priceIdx = [array]::IndexOf($cols, "provisional_price")
    $typeIdx  = [array]::IndexOf($cols, "provisional_schedule_type")

    if ($dateIdx -lt 0 -or $hubIdx -lt 0 -or $priceIdx -lt 0) {
        Write-Host "    WARNING: unexpected columns in provisional CSV: $($cols -join ',')" -ForegroundColor Yellow
        return @{}
    }

    $rowCount = 0
    for ($i = 1; $i -lt $lines.Count; $i++) {
        $parts = $lines[$i] -split ","
        if ($parts.Count -le [Math]::Max($dateIdx, [Math]::Max($hubIdx, $priceIdx))) { continue }
        $dateStr = Normalize-Date $parts[$dateIdx]
        if (-not $dateStr) { continue }
        $hub = $parts[$hubIdx].Trim().ToUpper()
        if ($hub -eq 'ADL') { $hubKey = 'adl' }
        elseif ($hub -eq 'BRI') { $hubKey = 'bri' }
        elseif ($hub -eq 'SYD') { $hubKey = 'syd' }
        else { continue }
        $priceRaw = $parts[$priceIdx].Trim()
        $parsed = 0.0
        if (-not [double]::TryParse($priceRaw, [ref]$parsed)) { continue }
        $schedType = if ($typeIdx -ge 0 -and $parts.Count -gt $typeIdx) { $parts[$typeIdx].Trim() } else { "D-3" }

        $key = "$dateStr|$hubKey"
        $isD2 = ($schedType -eq 'D-2')
        $existingIsD2 = $best.ContainsKey($key) -and ($best[$key].schedType -eq 'D-2')

        # Store if no existing entry, or if this is D-2 and existing is only D-3
        if (-not $best.ContainsKey($key) -or ($isD2 -and -not $existingIsD2)) {
            $best[$key] = @{ price = $parsed; schedType = $schedType }
            $rowCount++
        }
    }

    # Reshape into { dateStr -> { hubKey -> price } }
    $result = @{}
    foreach ($key in $best.Keys) {
        $parts = $key -split '\|'
        $dateStr = $parts[0]; $hubKey = $parts[1]
        if (-not $result.ContainsKey($dateStr)) { $result[$dateStr] = @{} }
        $result[$dateStr][$hubKey] = $best[$key].price
    }

    Write-Host "    Parsed $([math]::Round($rowCount/3)) best-schedule rows from provisional CSV" -ForegroundColor Gray
    return $result
}

# Load existing accumulator
$existing = @{}
if (Test-Path $outputPath) {
    try {
        $json = Get-Content $outputPath -Raw | ConvertFrom-Json
        $json.PSObject.Properties | ForEach-Object {
            $dateStr = $_.Name
            $existing[$dateStr] = @{}
            $_.Value.PSObject.Properties | ForEach-Object {
                $existing[$dateStr][$_.Name] = $_.Value
            }
        }
        Write-Host "  Loaded existing accumulator: $($existing.Count) dates" -ForegroundColor Gray
    } catch {
        Write-Host "  WARNING: could not parse existing $outputName, starting fresh: $_" -ForegroundColor Yellow
        $existing = @{}
    }
} else {
    Write-Host "  No existing accumulator found - starting fresh" -ForegroundColor Gray
}

# Download
$exAnteText      = Get-CsvText $exAnteUrl      "ex-ante confirmed (INT651)"
$provisionalText = Get-CsvText $provisionalUrl "provisional       (INT654)"

$exAnteData      = Parse-ExAnte      $exAnteText
$provisionalData = Parse-Provisional $provisionalText

# Merge into accumulator:
#   Ex-ante (confirmed) takes priority over provisional for the same date.
#   Both override whatever was previously stored (fresh download = ground truth).
$allNewDates = [System.Collections.Generic.HashSet[string]]::new()
foreach ($d in $exAnteData.Keys)      { [void]$allNewDates.Add($d) }
foreach ($d in $provisionalData.Keys) { [void]$allNewDates.Add($d) }

$mergedNew = 0
foreach ($dateStr in $allNewDates) {
    $dayData = @{}
    foreach ($hub in @('syd','adl','bri')) {
        # Ex-ante preferred; provisional as fallback
        if ($exAnteData.ContainsKey($dateStr) -and $exAnteData[$dateStr].ContainsKey($hub)) {
            $dayData[$hub] = $exAnteData[$dateStr][$hub]
        } elseif ($provisionalData.ContainsKey($dateStr) -and $provisionalData[$dateStr].ContainsKey($hub)) {
            $dayData[$hub] = $provisionalData[$dateStr][$hub]
        }
    }
    if ($dayData.Count -gt 0) {
        $existing[$dateStr] = $dayData
        $mergedNew++
    }
}

Write-Host "  Merged $mergedNew dates (accumulator now covers $($existing.Count) dates)" -ForegroundColor Green

# Write sorted output
$sorted = [ordered]@{}
$existing.Keys | Sort-Object | ForEach-Object { $sorted[$_] = $existing[$_] }

$jsonOut = $sorted | ConvertTo-Json -Depth 3
New-Item -ItemType Directory -Force -Path $ForecastsDir    | Out-Null
New-Item -ItemType Directory -Force -Path $LocalPublicData | Out-Null
Set-Content -Path $outputPath -Value $jsonOut -Encoding UTF8
Copy-Item $outputPath $localPath -Force

Write-Host "  Written $outputName ($([math]::Round((Get-Item $outputPath).Length/1KB)) KB)" -ForegroundColor Green
