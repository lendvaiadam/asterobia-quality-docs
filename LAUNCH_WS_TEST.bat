@echo off
setlocal EnableDelayedExpansion
echo ===========================================
echo   ASTEROBIA WEBSOCKET TEST LAUNCHER
echo   (Phase 1 - WS Relay Only)
echo ===========================================
echo.

REM --- Change to repo root (where package.json lives) ---
cd /d "%~dp0"

REM --- Configurable port (default 3000) ---
if not defined WS_PORT set WS_PORT=3000

REM --- 1. Check if WS port is already in use ---
powershell -Command "try { $c = New-Object System.Net.Sockets.TcpClient('127.0.0.1', %WS_PORT%); $c.Close(); exit 1 } catch { exit 0 }" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Port %WS_PORT% is already in use!
    echo   Another server or previous test may still be running.
    echo   Fix: Close it, or set a different port:
    echo     set WS_PORT=3001 ^&^& LAUNCH_WS_TEST.bat
    echo.
    pause
    goto :eof
)

REM --- 2. Start static file server (http-server on port 8081) ---
echo 1. Starting static file server (port 8081)...
start "Asterobia Static Server" cmd /c "cd /d "%~dp0" && npx http-server . -c-1 -p 8081"
echo.

REM --- 3. Start WS relay (Phase 1 only, no PHASE2A) ---
echo 2. Starting WS relay server (port %WS_PORT%)...
start "Asterobia WS Server" cmd /k "cd /d "%~dp0" && set PORT=%WS_PORT% && node server/index.js"
echo.

REM --- 4. Wait for WS port to accept connections ---
echo 3. Waiting for WS server on port %WS_PORT%...
:waitloop
powershell -Command "try { $c = New-Object System.Net.Sockets.TcpClient('127.0.0.1', %WS_PORT%); $c.Close(); exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
    timeout /t 1 /nobreak >nul
    goto waitloop
)
echo    WS server is ready.
echo.

REM --- 5. Open browser tabs ---
echo 4. Opening Host Client...
start http://127.0.0.1:8081/game.html?net=ws^&dev=1^&wsPort=%WS_PORT%
echo.
echo 5. Opening Guest Client...
start http://127.0.0.1:8081/game.html?net=ws^&dev=1^&wsPort=%WS_PORT%
echo.

echo ===========================================
echo   TEST RUNNING
echo   - Static files: http://127.0.0.1:8081
echo   - WS relay:     ws://127.0.0.1:%WS_PORT%
echo   Check 'Asterobia WS Server' window for logs.
echo ===========================================
echo   Press any key to stop all servers and exit.
pause >nul

REM --- Cleanup ---
taskkill /FI "WINDOWTITLE eq Asterobia WS Server" /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Asterobia Static Server" /F >nul 2>&1
echo Servers stopped.
endlocal
