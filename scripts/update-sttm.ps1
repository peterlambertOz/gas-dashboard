# update-sttm.ps1
# Finds the most recently downloaded STTM price file and pushes it to the pod.
# Run after downloading the STTM Price and Withdrawals xlsx from:
# https://www.aemo.com.au/energy-systems/gas/short-term-trading-market-sttm/data-sttm/daily-sttm-reports

$pod     = "peterl@newpod"
$podDest = "~/apps/gas-dashboard/public/data/STTM.XLSX"

# Find the most recently downloaded STTM file in Downloads
$downloadsDir = "$env:USERPROFILE\Downloads"
$sttmFile = Get-ChildItem -Path $downloadsDir -Filter "*STTM*Price*" -File |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1

# Also check for the exact filename AEMO uses
if (-not $sttmFile) {
    $sttmFile = Get-ChildItem -Path $downloadsDir -Filter "*sttm*price*" -File |
                Sort-Object LastWriteTime -Descending |
                Select-Object -First 1
}

if (-not $sttmFile) {
    Write-Host "No STTM file found in Downloads folder."
    Write-Host "Please download the STTM Price and Withdrawals file from:"
    Write-Host "https://www.aemo.com.au/energy-systems/gas/short-term-trading-market-sttm/data-sttm/daily-sttm-reports"
    exit 1
}

Write-Host "Found: $($sttmFile.Name) ($('{0:N0}' -f $sttmFile.Length) bytes, $($sttmFile.LastWriteTime.ToString('dd/MM/yyyy HH:mm')))"
Write-Host "Uploading to pod as STTM.XLSX..."

scp $sttmFile.FullName "${pod}:${podDest}"

if ($LASTEXITCODE -eq 0) {
    Write-Host "Done. STTM data is now live on the dashboard."
} else {
    Write-Host "Upload failed."
    exit 1
}
