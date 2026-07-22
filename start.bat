@echo off
title Amethyst main by ricky 
:loop
node index.js
echo.
echo Node process exited. Restarting in 3 seconds...
timeout /t 3 /nobreak >nul
goto loop
