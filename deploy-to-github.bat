@echo off
title Kalam Mess - Cloud Deployment Helper
color 0A

echo ========================================================
echo   KALAM MESS - 24/7 CLOUD DEPLOYMENT HELPER
echo ========================================================
echo.
echo This script prepares and pushes your code to GitHub so
echo Render.com can host your app 24/7 for free.
echo.

where git >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] Git is not yet recognized in this terminal.
    echo If Git was just installed, please close this window and run it again.
    pause
    exit /b
)

if not exist .git (
    echo [*] Initializing Git repository...
    git init
    git branch -M main
)

echo [*] Staging all files...
git add .

echo [*] Creating commit...
git commit -m "Deploy Kalam Mess Digital System with Two-Color Theme and Anti-Cheat Tokens"

echo.
echo ========================================================
echo STEP 1: Create a new repository on GitHub (https://github.com/new)
echo         Name it: kalam-mess
echo         Keep it Public or Private
echo ========================================================
echo.
set /p REPO_URL="Paste your GitHub repository URL (e.g. https://github.com/yourname/kalam-mess.git): "

if "%REPO_URL%"=="" (
    echo No URL entered. Aborting push.
    pause
    exit /b
)

git remote remove origin 2>nul
git remote add origin %REPO_URL%

echo [*] Pushing code to GitHub...
git push -u origin main

if %errorlevel% equ 0 (
    echo.
    echo ========================================================
    echo SUCCESS! Your code is on GitHub!
    echo.
    echo STEP 2: Now connect to Render for 24/7 Free Hosting:
    echo  1. Go to https://dashboard.render.com/
    echo  2. Click "New +" -> "Web Service"
    echo  3. Select your GitHub repository "kalam-mess"
    echo  4. Settings:
    echo     - Runtime: Node
    echo     - Build Command: npm install
    echo     - Start Command: node server.js
    echo  5. Click "Deploy Web Service"!
    echo.
    echo In 2 minutes, Render will give you a permanent HTTPS URL!
    echo ========================================================
) else (
    echo.
    echo [!] Push failed. Please check your GitHub credentials or repository URL.
)

echo.
pause
