@echo off
title WalkWell Deployment
cd /d "%~dp0"
echo Starting WalkWell deployment JAR on http://localhost:3000 ...
java -jar "%~dp0walking-app-deploy.jar" --port 3000
if errorlevel 1 (
  echo.
  echo [ERROR] Launcher failed. Make sure Java and Node.js are installed.
  pause
)
