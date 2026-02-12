@echo off
setlocal EnableDelayedExpansion
echo ===========================================
echo   ASTEROBIA WEBSOCKET TEST LAUNCHER
echo   (Phase 1 - WS Relay Only)
echo ===========================================
echo.

REM --- Change to repo root ---
cd /d "%~dp0"

REM --- Configurable port (default 8081) ---
if not defined PORT set PORT=8081

REM --- 1. Check if port is already in use ---
powershell -Command "try { $c = New-Object System.Net.Sockets.TcpClient('127.0.0.1', %PORT%); $c.Close(); exit 1 } catch { exit 0 }" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Port %PORT% is already in use!
    echo   Another server or previous test may still be running.
    echo   Fix: Close it, or set a different port:
    echo     set PORT=9000 ^&^& LAUNCH_WS_TEST.bat
    echo.
    pause
    goto :eof
)

REM --- 2. Start combined server (static files + WS relay, Phase 1) ---
echo 1. Starting Asterobia server on port %PORT%...
start "Asterobia WS Server" cmd /k "cd /d "%~dp0" && set PORT=%PORT% && node server/index.js"
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
echo 3. Opening Host Client...
start http://127.0.0.1:%PORT%/game.html?net=ws^&dev=1
echo.
echo 4. Opening Guest Client...
start http://127.0.0.1:%PORT%/game.html?net=ws^&dev=1
echo.

echo ===========================================
echo   TEST RUNNING
echo   SERVER: http://127.0.0.1:%PORT%  (static + ws)
echo   Check 'Asterobia WS Server' window for logs.
echo ===========================================
echo   Press any key to stop server and exit.
pause >nul

REM --- Cleanup ---
taskkill /FI "WINDOWTITLE eq Asterobia WS Server" /F >nul 2>&1
echo Server stopped.
endlocal
