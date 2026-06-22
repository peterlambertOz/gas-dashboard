# Merge-SttmRecent.ps1
# Downloads the NEMWEB rolling 7-day STTM ex-ante and ex-post CSVs,
# merges them into a persistent sttm-recent.json accumulator, and
# writes the result to public\data\ and $forecastsDir.
#
# Priority within this file: ex-ante price preferred, ex-post as fallback.
# The XLSX monthly data takes priority over this file in the dashboard itself.
#
# Run weekly (via update-sttm.ps1). Safe to run multiple times — re-running
# the same week just overwrites identical data.

param(
    [string]$ForecastsDir    = "C:\Users\peter\Python\data\forecasts",
    [string]$LocalPublicData = "C:\Users\peter\Python\gas-dashboard\public\data"
)

$exAnteUrl  = "https://www.nemweb.com.au/Reports/CURRENT/STTM/int651_v1_ex_ante_market_price_rpt_1.csv"
$exPostUrl  = "https://www.nemweb.com.au/Reports/CURRENT/STTM/int657_v2_ex_post_market_data_rpt_1.csv"
$outputName = "sttm-recent.json"
$outputPath = Join-Path $ForecastsDir $outputName
$localPath  = Join-Path $LocalPublicData $outputName

$headers = @{
    "User-Agent"    = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
    "Cache-Control" = "no-cache, no-store"
    "Pragma"        = "no-cache"
}

# ── Helper: download CSV text ─────────────────────────────────────────────────
function Get-CsvText($url, $label) {
    Write-Host "  Downloading $label..." -NoNewline
    try {
        $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -Headers $headers
        Write-Host " OK  ($([math]::Round($resp.Content.Length/1KB)) KB)" -ForegroundColor Green
        return $resp.Content
    } catch {
        Write-Host " FAILED: $_" -ForegroundColor Red
        return $null
    }
}

# ── Helper: flexibly find a column index by name pattern ─────────────────────
function Find-Col($headers, [string[]]$patterns) {
    foreach ($pat in $patterns) {
        for ($i = 0; $i -lt $headers.Count; $i++) {
            if ($headers[$i] -match $pat) { return $i }
        }
    }
    return -1
}

# ── Helper: normalise date to YYYY-MM-DD ─────────────────────────────────────
function Normalize-Date($raw) {
    $raw = $raw.Trim().Trim('"')
    # DD/MM/YYYY
    if ($raw -match '^(\d{2})/(\d{2})/(\d{4})$') {
        return "$($Matches[3])-$($Matches[2])-$($Matches[1])"
    }
    # YYYY-MM-DD or YYYY/MM/DD
    if ($raw -match '^(\d{4})[-/](\d{2})[-/](\d{2})') {
        return "$($Matches[1])-$($Matches[2])-$($Matches[3])"
    }
    return $null
}

# ── Helper: parse a STTM CSV into { dateStr -> { syd, adl, bri } } ───────────
function Parse-SttmCsv($text, $priceType) {
    if (-not $text) { return @{} }

    $result = @{}
    $lines  = $text -split "`n" | Where-Object { $_.Trim() -ne "" }

    # Skip any NEMWEB preamble rows (lines starting with 'I,' or 'C,')
    $dataStart = 0
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -notmatch '^[IC],') { $dataStart = $i; break }
    }

    if ($dataStart -ge $lines.Count) {
        Write-Host "    WARNING: no data rows found in $priceType CSV" -ForegroundColor Yellow
        return @{}
    }

    # Parse header
    $headerLine = $lines[$dataStart]
    $cols = $headerLine -split "," | ForEach-Object { $_.Trim().Trim('"').ToUpper() }

    $dateCol  = Find-Col $cols @('TRADING_DATE','GAS_DATE','DATE')
    $hubCol   = Find-Col $cols @('HUB_ID','HUB','LOCATION')
    $priceCol = Find-Col $cols @('PRICE','MARKET_PRICE','EX_ANTE','EX_POST')

    if ($dateCol -lt 0 -or $hubCol -lt 0 -or $priceCol -lt 0) {
        Write-Host "    WARNING: could not identify columns in $priceType CSV" -ForegroundColor Yellow
        Write-Host "    Headers found: $($cols -join ', ')" -ForegroundColor Yellow
        return @{}
    }

    $rowCount = 0
    for ($i = $dataStart + 1; $i -lt $lines.Count; $i++) {
        $parts = $lines[$i] -split ","
        if ($parts.Count -le [Math]::Max($dateCol, [Math]::Max($hubCol, $priceCol))) { continue }

        $dateStr = Normalize-Date $parts[$dateCol]
        if (-not $dateStr) { continue }

        $hub = $parts[$hubCol].Trim().Trim('"').ToUpper()
        # Normalise hub names: SYD/SYDNEY→syd, ADL/ADELAIDE→adl, BRI/BRISBANE→bri
        $hubKey = switch -Regex ($hub) {
            'SYD|SYDNEY'    { 'syd' }
            'ADL|ADEL'      { 'adl' }
            'BRI|BRIS'      { 'bri' }
            default         { $null }
        }
        if (-not $hubKey) { continue }

        $priceRaw = $parts[$priceCol].Trim().Trim('"')
        $price    = $null
        if ($priceRaw -ne '' -and $priceRaw -ne 'null') {
            $parsed = 0.0
            if ([double]::TryParse($priceRaw, [ref]$parsed)) { $price = $parsed }
        }
        if ($null -eq $price) { continue }

        if (-not $result.ContainsKey($dateStr)) { $result[$dateStr] = @{} }
        $result[$dateStr][$hubKey] = $price
        $rowCount++
    }

    Write-Host "    Parsed $rowCount rows from $priceType CSV" -ForegroundColor Gray
    return $result
}

# ── Load existing accumulator ────────────────────────────────────────────────
$existing = @{}
if (Test-Path $outputPath) {
    try {
        $json = Get-Content $outputPath -Raw | ConvertFrom-Json
        # ConvertFrom-Json gives a PSCustomObject — convert to hashtable
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
    Write-Host "  No existing accumulator found — starting fresh" -ForegroundColor Gray
}

# ── Download and parse both CSVs ─────────────────────────────────────────────
$exAnteText  = Get-CsvText $exAnteUrl  "ex-ante  (INT651)"
$exPostText  = Get-CsvText $exPostUrl  "ex-post  (INT657)"

$exAnteData  = Parse-SttmCsv $exAnteText  "ex-ante"
$exPostData  = Parse-SttmCsv $exPostText  "ex-post"

# ── Merge: ex-ante preferred, ex-post as fallback ────────────────────────────
$newDates = [System.Collections.Generic.HashSet[string]]::new()
foreach ($d in $exAnteData.Keys)  { [void]$newDates.Add($d) }
foreach ($d in $exPostData.Keys)  { [void]$newDates.Add($d) }

$mergedNew = 0
foreach ($dateStr in $newDates) {
    $dayData = @{}
    foreach ($hub in @('syd','adl','bri')) {
        $val = $null
        if ($exAnteData.ContainsKey($dateStr) -and $exAnteData[$dateStr].ContainsKey($hub)) {
            $val = $exAnteData[$dateStr][$hub]
        } elseif ($exPostData.ContainsKey($dateStr) -and $exPostData[$dateStr].ContainsKey($hub)) {
            $val = $exPostData[$dateStr][$hub]
        }
        if ($null -ne $val) { $dayData[$hub] = $val }
    }
    if ($dayData.Count -gt 0) {
        $existing[$dateStr] = $dayData
        $mergedNew++
    }
}

Write-Host "  Merged $mergedNew dates from new download (accumulator now covers $($existing.Count) dates)" -ForegroundColor Green

# ── Write output ─────────────────────────────────────────────────────────────
# Sort by date for readability
$sorted = [ordered]@{}
$existing.Keys | Sort-Object | ForEach-Object { $sorted[$_] = $existing[$_] }

$json = $sorted | ConvertTo-Json -Depth 3
New-Item -ItemType Directory -Force -Path $ForecastsDir    | Out-Null
New-Item -ItemType Directory -Force -Path $LocalPublicData | Out-Null
Set-Content -Path $outputPath -Value $json -Encoding UTF8
Copy-Item $outputPath $localPath -Force

Write-Host "  Written $outputName ($([math]::Round((Get-Item $outputPath).Length/1KB)) KB)" -ForegroundColor Green
