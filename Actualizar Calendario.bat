@echo off
setlocal enabledelayedexpansion
title Actualizar Calendario Hogar Colonia
cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
  echo No se encontro Git instalado en esta computadora.
  echo Instalalo desde https://git-scm.com/download/win y volve a intentar.
  echo.
  pause
  exit /b 1
)

git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
  echo Esta carpeta todavia no esta conectada a Git.
  echo Seguí primero los pasos de configuracion inicial ^(ver la guia^)
  echo antes de usar este archivo.
  echo.
  pause
  exit /b 1
)

echo Guardando una copia de seguridad de todo antes de actualizar...
if not exist "backups-actualizaciones" mkdir "backups-actualizaciones"
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmm"') do set STAMP=%%i
set "BACKUP_DIR=backups-actualizaciones\antes-de-actualizar-!STAMP!"
robocopy "." "!BACKUP_DIR!" /E /XD .git backups backups-actualizaciones node_modules >nul

REM Conserva solo los ultimos 10 respaldos de actualizacion, para no llenar el disco.
for /f "skip=10 delims=" %%f in ('dir /b /o-d /ad "backups-actualizaciones\antes-de-actualizar-*" 2^>nul') do rmdir /s /q "backups-actualizaciones\%%f"

echo.
echo Copia guardada en: !BACKUP_DIR!
echo.
echo Buscando actualizaciones...
git pull

if errorlevel 1 (
  echo.
  echo ============================================================
  echo  Algo fallo al actualizar. NO se perdio nada: la copia de
  echo  seguridad de justo antes de este intento quedo en:
  echo  !BACKUP_DIR!
  echo.
  echo  Contame que dice el mensaje de arriba y lo solucionamos.
  echo ============================================================
  echo.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo  Listo — el calendario ya esta actualizado a la ultima version.
echo.
echo  Si algo no funciona como esperabas, avisame y volvemos a la
echo  copia de seguridad de antes de este cambio:
echo  !BACKUP_DIR!
echo ============================================================
echo.
pause
