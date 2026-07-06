@echo off
REM ============================================================
REM  Daily dashboard update wrapper for Task Scheduler
REM   - Forces UTF-8 so the forecast's Unicode output (checkmarks,
REM     dashes, arrows) no longer crashes Step 1 when logged to a file.
REM   - Shows output in the console AND writes it to update.log.
REM ============================================================

REM Make Python emit UTF-8. This is what fixes the Step 1 forecast crash.
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8

cd /d "C:\Users\peter\Python\gas-dashboard"

powershell -NoProfile -ExecutionPolicy Bypass -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; & '.\scripts\update-and-deploy.ps1' *>&1 | Tee-Object -FilePath '.\update.log'"
