@echo off
setlocal EnableDelayedExpansion
echo ===========================================
echo   ASTEROBIA - FIZIKA TESZT INDITO
echo ===========================================
echo.

REM --- Change to repo root ---
cd /d "%~dp0"

REM --- Port config ---
if not defined PORT set PORT=8081

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

REM --- 2. Start server with physics enabled ---
echo 1. Szerver inditas (fizika BEKAPCSOLVA)...
start "Asterobia Server (Physics)" cmd /k "cd /d "%~dp0" && set PHASE2A=1 && set ENABLE_PHYSICS=1 && set PORT=%PORT% && node server/index.js"
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

REM --- 4. Open ONE browser tab (host only - single player test) ---
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
endlocal
