@echo off
REM Jarvis — arranque en Windows (doble clic).
REM Abre el servidor minimizado y el navegador en la interfaz.

setlocal
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 (
  echo No encuentro Python en el PATH.
  echo Instalalo desde https://www.python.org/downloads/windows/
  echo y marca "Add python.exe to PATH" durante la instalacion.
  pause
  exit /b 1
)

echo Arrancando Jarvis en http://127.0.0.1:8765
start "Jarvis" /min python "%~dp0server.py"
timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:8765
exit /b 0
