@echo off
REM Double-click this once to add a searchable "Wally" entry to your Start Menu.
title Add Wally to Start Menu
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0create_wally_shortcut.ps1"
echo.
pause
