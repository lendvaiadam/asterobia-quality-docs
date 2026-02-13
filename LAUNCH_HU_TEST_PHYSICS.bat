@echo off
REM ============================================================
REM  ASTEROBIA - Physics Visual Test
REM ============================================================

set PORT=8081
set PHASE2A=1
set ENABLE_PHYSICS=1

echo ============================================================
echo  ASTEROBIA - Physics Visual Test
echo  Starting server on port %PORT% with physics...
echo ============================================================
echo.

node server/index.js

echo.
echo ============================================================
echo  SERVER STOPPED. If you see an error above, copy it.
echo ============================================================
pause
