@echo off
cd /d "%~dp0"
powershell -NoProfile -File "%~dp0source\scripts\build.ps1"
pause
