@echo off
title HERO99HE Light Lab
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Serve.ps1"
if errorlevel 1 pause
