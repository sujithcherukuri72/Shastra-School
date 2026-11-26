@echo off
rem Double-click this file to start Shastra Connect on this computer.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
if errorlevel 1 pause
