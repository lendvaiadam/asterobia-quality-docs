@echo off
echo ===========================================
echo   ASTEROBIA - FIZIKA TESZT INDITO
echo ===========================================
echo.

REM --- Change to repo root ---
cd /d "%~dp0"

REM --- Port config ---
if not defined PORT set PORT=8081

REM --- Set env vars BEFORE start (inherited by child process) ---
set PHASE2A=1
set ENABLE_PHYSICS=1

REM --- 1. Check if port is already in use ---
powershell -Command "try { $c = New-Object System.Net.Sockets.TcpClient('127.0.0.1', %PORT%); $c.Close(); exit 1 } catch { exit 0 }" >nul 2>&1
if errorlevel 1 (
    echo [HIBA] A %PORT%-es port mar foglalt!
    echo   Lehet, hogy egy elozo szerver meg fut.
    echo   Zard be, vagy valassz masik portot:
    echo     set PORT=9000 ^&^& LAUNCH_HU_TEST_PHYSICS.bat
    echo.
    pause
    goto :eof
)

REM --- 2. Start server (env vars inherited) ---
echo 1. Szerver inditas (PHASE2A + PHYSICS)...
start "Asterobia Server (Physics)" node server/index.js
echo.

REM --- 3. Wait for server ---
echo 2. Varakozas a szerverre...
:waitloop
powershell -Command "try { $c = New-Object System.Net.Sockets.TcpClient('127.0.0.1', %PORT%); $c.Close(); exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
    timeout /t 1 /nobreak >nul
    goto waitloop
)
echo    Szerver KESZ.
echo.

REM --- 4. Open browser ---
echo 3. Bongeszo megnyitas...
start http://127.0.0.1:%PORT%/game.html?net=ws^&dev=1
echo.

echo ===========================================
echo   FIZIKA TESZT FUT!
echo ===========================================
echo.
echo   A bongeszot nezd - a teszt ott tortenik.
echo   Narancssarga "PHYSICS DEBUG" panel fog megjelenni.
echo.
echo   Ha VEGEZTEL: nyomj ENTER-t itt a leallitashoz.
echo.
pause >nul

REM --- Cleanup ---
taskkill /FI "WINDOWTITLE eq Asterobia Server (Physics)" /F >nul 2>&1
echo Szerver leallitva.
