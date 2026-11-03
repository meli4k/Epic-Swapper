@echo off
cd /d "%~dp0"
if exist "Epic Swapper.exe" (
  start "" "Epic Swapper.exe"
  exit /b 0
)
echo Epic Swapper.exe is not in this folder yet.
echo.
pause
