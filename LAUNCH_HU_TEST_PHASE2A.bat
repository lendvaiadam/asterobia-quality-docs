@echo off
echo ===========================================
echo   ASTEROBIA PHASE 2A HU TEST LAUNCHER
echo   (Server Authority - Manifest-Lite)
echo ===========================================
echo.
echo 1. Starting Node.js WebSocket Server with PHASE2A=1...
set PHASE2A=1
start "Asterobia Server (Phase 2A)" npm run start:server
echo.
echo 2. Waiting for server to initialize...
timeout /t 3 /nobreak >nul
echo.
echo 3. Opening Host Client (Tab 1)...
start http://127.0.0.1:8081/game.html?net=ws^&dev=1
echo.
echo 4. Opening Guest Client (Tab 2)...
start http://127.0.0.1:8081/game.html?net=ws^&dev=1
echo.
echo ===========================================
echo   PHASE 2A HU TEST RUNNING
echo ===========================================
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
pause
