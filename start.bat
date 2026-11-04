@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js wurde nicht gefunden.
  echo Installation: winget install OpenJS.NodeJS.LTS
  echo oder https://nodejs.org/ herunterladen und installieren, danach ein neues Terminal oeffnen.
  pause
  exit /b 1
)
start "" http://127.0.0.1:4321
node server.js
pause
