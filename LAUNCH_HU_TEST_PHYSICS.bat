@echo off
REM ============================================================
REM  HU TEST: Physics Visual Test (Phase 3)
REM  Starts server with physics ENABLED + opens 2 browser tabs
REM ============================================================

set PORT=8081
set PHASE2A=1
set ENABLE_PHYSICS=1

echo ============================================================
echo  ASTEROBIA - Physics Visual Test
echo  Server: http://localhost:%PORT%
echo  Physics: ENABLED (Rapier)
echo ============================================================
echo.
echo Starting server...

start "Asterobia Server (Physics)" cmd /c "set PORT=%PORT% && set PHASE2A=1 && set ENABLE_PHYSICS=1 && node server/index.js"

timeout /t 2 >nul

echo Opening Host tab...
start "" "http://localhost:%PORT%/game.html?net=ws&dev=1&wsPort=%PORT%"

timeout /t 2 >nul

echo Opening Guest tab...
start "" "http://localhost:%PORT%/game.html?net=ws&dev=1&wsPort=%PORT%"

echo.
echo ============================================================
echo  Both tabs opened. Follow the test script in:
echo  docs/HU_TESTS/HU_TEST_R013_PHASE3_PHYSICS.md
echo ============================================================
echo.
pause
