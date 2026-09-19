@echo off
title Kalam Mess Digital System
echo =======================================================
echo   Starting Kalam Mess Digital System & Public Tunnel...
echo =======================================================
cd /d "%~dp0"

echo Launching Cloudflare Tunnel for public HTTPS & APK creation...
start "Kalam Tunnel" /min ".\cloudflared.exe" tunnel --protocol http2 --url http://127.0.0.1:3000

echo Starting Node.js Server...
node server.js
pause
