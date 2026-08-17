@echo off
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

echo Iniciando el servidor del calendario...
start "Calendario Hogar Colonia - Servidor (no cerrar)" cmd /k node server.js

timeout /t 2 /nobreak >nul
start "" http://localhost:3000

exit
