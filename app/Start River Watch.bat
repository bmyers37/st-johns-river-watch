@echo off
setlocal
title St. Johns River Watch
cd /d "%~dp0"

echo.
echo   St. Johns River Watch
echo   ---------------------
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js is not installed. It is free: download the "LTS" version from https://nodejs.org
  echo   then run this file again.
  start "" https://nodejs.org/en/download
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo   First run: installing components. This takes a minute or two...
  call npm install --no-fund --no-audit
  if errorlevel 1 goto :fail
)

if not exist "dist\index.html" goto :build
if not exist "dist-server\index.js" goto :build
goto :run

:build
echo   Building the app...
call npm run build
if errorlevel 1 goto :fail

:run
echo   Opening http://127.0.0.1:5179 in your browser...
if /i "%~1"=="--kiosk" (
  start "" cmd /c "timeout /t 3 /nobreak >nul & start msedge --kiosk http://127.0.0.1:5179 --edge-kiosk-type=fullscreen"
) else (
  start "" cmd /c "timeout /t 3 /nobreak >nul & start "" http://127.0.0.1:5179"
)
node dist-server\index.js
echo.
echo   The app has stopped.
pause
exit /b 0

:fail
echo.
echo   Something went wrong (see the messages above). Check your internet connection and try again.
pause
exit /b 1
