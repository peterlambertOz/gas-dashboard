#!/bin/bash
# update-prices.sh
# Downloads latest STTM and DWGM price files to the dashboard data folder.
# Run manually: ~/update-prices.sh
# Or add to crontab for daily automatic updates:
#   crontab -e
#   Add this line: 0 8 * * * /home/peterl/update-prices.sh >> /home/peterl/update-prices.log 2>&1

DATA_DIR="$HOME/apps/gas-dashboard/public/data"

echo "=== $(date) ==="

# DWGM — Declared Wholesale Gas Market (Victorian gas market)
echo "Downloading DWGM..."
curl -s -o "$DATA_DIR/DWGM.XLSX" \
  "https://www.nemweb.com.au/REPORTS/CURRENT/VicGas/INT310_V4_PRICE_AND_WITHDRAWALS_1.CSV" \
  && echo "  DWGM OK ($(du -h "$DATA_DIR/DWGM.XLSX" | cut -f1))" \
  || echo "  DWGM FAILED"

# STTM — Short Term Trading Market (Sydney, Adelaide, Brisbane)
echo "Downloading STTM..."
curl -s -L -o "$DATA_DIR/STTM.XLSX" \
  "https://www.aemo.com.au/-/media/files/gas/sttm/data/sttm-price-and-withdrawals.xlsx" \
  && echo "  STTM OK ($(du -h "$DATA_DIR/STTM.XLSX" | cut -f1))" \
  || echo "  STTM FAILED"

echo "Done."
