@echo off
setlocal enabledelayedexpansion
title Calendario Hogar Colonia
cd /d "%~dp0"

if not exist "server.js" (
  echo No se encontro server.js en esta carpeta.
  echo Asegurate de que este archivo este en la misma carpeta que el resto del calendario.
  echo.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo No se encontro Node.js instalado en esta computadora.
  echo Instalalo desde https://nodejs.org ^(version LTS^) y volve a intentar.
  echo.
  pause
  exit /b 1
)

if exist "data.json" (
  echo Guardando copia de seguridad...
  if not exist "backups" mkdir "backups"
  for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmm"') do set STAMP=%%i
  copy /y "data.json" "backups\data-!STAMP!.json" >nul
  copy /y "data.json" "backups\latest.json" >nul
  REM Conserva solo los ultimos 30 respaldos con fecha (latest.json no cuenta).
  for /f "skip=30 delims=" %%f in ('dir /b /o-d "backups\data-*.json" 2^>nul') do del "backups\%%f"
)

echo Iniciando el servidor del calendario...
start "Calendario Hogar Colonia - Servidor (no cerrar)" cmd /k node server.js

timeout /t 2 /nobreak >nul
start "" http://localhost:3000

exit
