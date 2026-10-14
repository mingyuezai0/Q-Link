@echo off
rem ---------------------------------------------------------------------------
rem  Q-Link desktop launcher
rem  ASCII-only on purpose: cmd.exe mis-parses UTF-8 batch files. All Chinese
rem  messages are printed by desktop\launch.mjs under chcp 65001 below.
rem ---------------------------------------------------------------------------
chcp 65001 >nul
cd /d "%~dp0"
title Q-Link

where node >nul 2>nul
if errorlevel 1 goto :no_node

node "desktop\launch.mjs"
if errorlevel 1 pause
exit /b 0

:no_node
echo.
echo   [!] Node.js not found.
echo.
echo       Please install Node.js 18 or newer from https://nodejs.org
echo.
pause
exit /b 1
