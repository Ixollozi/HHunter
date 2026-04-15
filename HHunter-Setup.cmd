@echo off
setlocal

REM HHunter one-click setup+run (Windows)
REM If PowerShell execution policy blocks scripts, this bypasses for this run only.

set SCRIPT_DIR=%~dp0
set PS1=%SCRIPT_DIR%HHunter-Setup.ps1

if not exist "%PS1%" (
  echo [HHunter] Не найден файл: %PS1%
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
set EC=%ERRORLEVEL%
if not "%EC%"=="0" (
  echo.
  echo [HHunter] Завершено с кодом %EC%
  pause
)
exit /b %EC%

