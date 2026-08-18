@echo off
REM pull-backup.bat — baja el ultimo respaldo del servidor a esta PC.
REM
REM Requisitos (una sola vez):
REM   1. Tener una clave SSH generada en esta PC y copiada al servidor
REM      (ver GUIA-SERVIDOR-PROPIO.md, seccion "SSH: entrar con clave").
REM   2. Completar las 3 variables de aca abajo con tus datos reales.
REM
REM Uso manual: doble clic en este archivo.
REM Uso automatico: agregalo al Programador de tareas de Windows con el
REM disparador "Al iniciar sesion" (no una hora fija, porque la PC no
REM esta siempre prendida) — ver el paso a paso en la guia.

set SERVIDOR_USUARIO=TU_USUARIO
set SERVIDOR_IP=TU_IP_O_DOMINIO
set SERVIDOR_RUTA=/home/TU_USUARIO/calendario-hogar-colonia

set DESTINO=%USERPROFILE%\Respaldos-Calendario-HogarColonia
if not exist "%DESTINO%" mkdir "%DESTINO%"

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmm"') do set STAMP=%%i

scp %SERVIDOR_USUARIO%@%SERVIDOR_IP%:%SERVIDOR_RUTA%/backups/latest.json "%DESTINO%\respaldo-%STAMP%.json"

echo.
echo Listo. Respaldo guardado en: %DESTINO%
