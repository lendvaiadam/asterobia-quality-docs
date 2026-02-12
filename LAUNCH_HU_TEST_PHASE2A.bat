@echo off
setlocal EnableDelayedExpansion
echo ===========================================
echo   ASTEROBIA PHASE 2A HU TEST LAUNCHER
echo   (Server Authority - Manifest-Lite)
echo ===========================================
echo.

REM --- Change to repo root ---
cd /d "%~dp0"

REM --- Configurable port (default 8081 — single server serves both HTTP + WS) ---
if not defined PORT set PORT=8081

REM --- 1. Check if port is already in use ---
powershell -Command "try { $c = New-Object System.Net.Sockets.TcpClient('127.0.0.1', %PORT%); $c.Close(); exit 1 } catch { exit 0 }" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Port %PORT% is already in use!
    echo   Another server or previous test may still be running.
    echo   Fix: Close it, or set a different port:
    echo     set PORT=9000 ^&^& LAUNCH_HU_TEST_PHASE2A.bat
    echo.
    pause
    goto :eof
)

REM --- 2. Start combined server (static files + WS relay + GameServer) ---
echo 1. Starting Asterobia server on port %PORT% (PHASE2A=1)...
start "Asterobia Server (Phase 2A)" cmd /k "cd /d "%~dp0" && set PHASE2A=1 && set PORT=%PORT% && node server/index.js"
echo.

REM --- 3. Wait for port to accept connections ---
echo 2. Waiting for server on port %PORT%...
:waitloop
powershell -Command "try { $c = New-Object System.Net.Sockets.TcpClient('127.0.0.1', %PORT%); $c.Close(); exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
    timeout /t 1 /nobreak >nul
    goto waitloop
)
echo    Server is ready.
echo.

REM --- 4. Open browser tabs ---
echo 3. Opening Host Client (Tab 1)...
start http://127.0.0.1:%PORT%/game.html?net=ws^&dev=1
echo.
echo 4. Opening Guest Client (Tab 2)...
start http://127.0.0.1:%PORT%/game.html?net=ws^&dev=1
echo.

echo ===========================================
echo   PHASE 2A HU TEST RUNNING
echo ===========================================
echo.
echo   SERVER: http://127.0.0.1:%PORT%  (static + ws + Phase2A)
echo.
echo   EXPECTED BEHAVIOR:
echo   - Host: Click HOST GAME, wait for START GAME
echo   - Guest: Click JOIN GAME, enter room code, JOIN
echo   - Both: WASD movement should be smooth (interpolated)
echo   - Both: ~150ms input latency is EXPECTED (no prediction)
echo   - Both: Units should move on the sphere surface
echo   - Check 'Asterobia Server (Phase 2A)' window for logs
echo.
echo   PASS CRITERIA:
echo   - No visible snapping or teleporting at normal speed
echo   - Both tabs see each other's movement
echo   - Server window shows SPAWN_MANIFEST received
echo   - Server window shows MOVE_INPUT routing
echo.
echo ===========================================
echo   Press any key to stop server and exit.
pause >nul

REM --- Cleanup ---
taskkill /FI "WINDOWTITLE eq Asterobia Server (Phase 2A)" /F >nul 2>&1
echo Server stopped.
endlocal
