@echo off
rem ---------------------------------------------------------------------------
rem  QQ Bot Console launcher
rem  This file is intentionally ASCII-only: cmd.exe parses UTF-8 batch files
rem  unreliably, which turns Chinese text into mojibake and can even break
rem  command parsing. All user-facing messages are printed by scripts\launch.mjs
rem  while chcp 65001 below makes the console render them as UTF-8.
rem ---------------------------------------------------------------------------
chcp 65001 >nul
cd /d "%~dp0"
title QQ Bot Console

where node >nul 2>nul
if errorlevel 1 goto :no_node

node "scripts\launch.mjs"
if errorlevel 1 pause
exit /b 0

:no_node
echo.
echo   [!] Node.js not found.
echo.
echo       Please install Node.js 18 or newer from https://nodejs.org
echo       Keep the default options during setup, then run this file again.
echo.
pause
exit /b 1
