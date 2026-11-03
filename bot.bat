@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is required. Install it from https://nodejs.org and open this again.
  echo.
  pause
  exit /b 1
)
if not exist node_modules (
  npm install
  if errorlevel 1 (
    echo.
    pause
    exit /b 1
  )
)
node bot.js
echo.
pause
