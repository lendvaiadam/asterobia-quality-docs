# R013 M07 Bug List (Canonical)

**Status**: ACTIVE
**Owner**: Antigravity
**Last Updated**: 2026-02-08

> **Protocol**:
> 1. New bugs must be logged here before coding.
> 2. Each bug requires: Observed, Expected, Touchpoints, Fix Idea.
> 3. Status flow: `OPEN` -> `IN_PROGRESS` -> `FIXED` -> `VERIFIED`.

---

## A) Multiplayer / Session / Debug

### A1. startDiscovery() confusion / discovery missing
- **Status**: `OPEN`
- **Severity**: P1 (Major)
- **Observed**: `await game.sessionManager.startDiscovery()` returns undefined. No visible UI updates.
- **Expected**: Visual feedback of "Searching..." and a list of found sessions, or a clear console log of available hosts.
- **Touchpoints**:
    - `src/SimCore/multiplayer/SessionManager.js`: `startDiscovery`, `getAvailableHosts`.
    - `src/UI/NetworkDebugPanel.js`: Needs to poll `sessionManager.availableHosts`.
- **Fix Idea**: Wire `NetworkDebugPanel` to poll `sessionManager.getAvailableHosts()` every 1s and display buttons to `joinGame(hostId)`.

### A2. globalCommandQueue undefined
- **Status**: `FIXED`
- **Severity**: P1 (Major)
- **Observed**: `ReferenceError: globalCommandQueue is not defined` when accessing `pendingCount`.
- **Expected**: `globalCommandQueue` to be exported singleton from `CommandQueue.js` and imported where needed.
- **Touchpoints**:
    - `src/SimCore/runtime/CommandQueue.js`: Ensure `export const globalCommandQueue` exists.
    - `src/Core/Game.js`: Ensure correct import.
- **Fix Applied**: Exposed `this.commandQueue = globalCommandQueue` on Game instance. All cross-module refs now use `game.commandQueue` with fallback. SessionManager uses `this.game?.commandQueue || globalCommandQueue`.

### A3. Join timeout happens sometimes
- **Status**: `OPEN`
- **Severity**: P2 (Minor/Flake)
- **Observed**: `Uncaught Error: Join timeout - no response from host`.
- **Expected**: Join should be reliable on local transport.
- **Touchpoints**:
    - `src/SimCore/multiplayer/SessionManager.js`: `joinGame()` timeout handling.
- **Fix Idea**: Add retry logic or increase timeout. Investigate race condition in Supabase Realtime channel subscription.

### A4. dumpNetEvidence circular JSON
- **Status**: `FIXED`
- **Severity**: P1 (Major - Blocks Debugging)
- **Observed**: `JSON.stringify` crashes on `dumpNetEvidence()`.
- **Expected**: Clean JSON with primitives only.
- **Touchpoints**:
    - `src/Core/Game.js`: `_dumpNetEvidence`.
    - `src/SimCore/multiplayer/SessionManager.js`: `getNetEvidence`.
- **Fix Applied**: Both `_dumpNetEvidence()` and `getNetEvidence()` wrapped in try/catch. Fixed stale `controllerSlot` → `selectedBySlot`. Position coords guarded with `Number()`. `seatPinDigit` never included (privacy). Returns `{ error }` on failure instead of throwing.

### A5. UI Debug Clutter
- **Status**: `FIXED`
- **Severity**: P2 (UX)
- **Observed**: Overlapping panels (DebugPanel, NetworkDebugPanel, Stats).
- **Expected**: Clean layout or tabs.
- **Touchpoints**:
    - `src/UI/NetworkDebugPanel.js`: positioning.
- **Fix Applied**: Console toggle button added and debug panel consolidation done in Wave 2. Panels no longer overlap by default.

---

## B) Authority / Seat / Control Gating

### B1. Keypad / PIN flow missing
- **Status**: `FIXED`
- **Severity**: P0 (Blocker)
- **Observed**: Clicking unit does not show keypad (locks hidden, guest drives instantly).
- **Expected**: M07 v0 Spec - Foreign units require PIN.
- **Touchpoints**:
    - `src/Entities/Unit.js`: `seatPolicy` default (is it 'OPEN'? Should be 'PIN_1DIGIT' for test).
    - `src/Core/InteractionManager.js`: `_triggerSeatFlow` logic.
    - `src/UI/SeatKeypadOverlay.js`: `show()` method.
- **Fix Applied**: Root cause was units spawning with `seatPolicy='OPEN'`. Now units[1+] spawn with `seatPolicy='PIN_1DIGIT'` and deterministic PIN `(index%9)+1`. Overlay, z-index, `_triggerSeatFlow()` were already correctly wired. Added green "my seated unit" indicator.

### B2. Seat exclusivity not enforced
- **Status**: `FIXED`
- **Severity**: P0 (Blocker)
- **Observed**: Multiple players might drive same unit (race condition) or Guest ignores Occupied status.
- **Expected**: `OCCUPIED` rejection if `selectedBySlot` != null.
- **Touchpoints**:
    - `src/Core/InteractionManager.js`: `_triggerSeatFlow` -> check `unit.selectedBySlot`.
    - `src/SimCore/multiplayer/SessionManager.js`: `_handleSeatReq` (Host side validation).
- **Fix Applied**: Added already-seated short-circuit in `_handleSeatReq` (idempotent re-grant). Race condition impossible due to JS single-threading + synchronous state mutation before async broadcast. OCCUPIED check was already correct.

### B3. Guest select/deselect broken
- **Status**: `FIXED`
- **Severity**: P1 (Major)
- **Observed**: Guest deselect used to work, now inconsistent.
- **Expected**: Local selection (UI focus) should separate from Seat Control.
- **Touchpoints**:
    - `src/Core/InteractionManager.js`: `onMouseUp` -> `inputFactory.deselect()`.
    - `src/Core/Game.js`: `_processInputCommands`.
- **Fix Applied**: SELECT/DESELECT are now local-only commands that bypass network transport and go directly to local CommandQueue. Implemented in prior commit (InputFactory.js lines 59-65). Not gated by ENABLE_COMMAND_EXECUTION.

### B4. Guest inputs not gated (Ghost Driving)
- **Status**: `FIXED`
- **Severity**: P0 (Blocker)
- **Observed**: Keyboard controls work even without seat.
- **Expected**: Inputs ignored unless `unit.selectedBySlot == mySlot`.
- **Touchpoints**:
    - `src/Core/Game.js`: `update()` loop checking `Input.js`.
    - `src/SimCore/runtime/InputFactory.js`: `createMoveCommand`.
- **Fix Applied**: 5 gating points added: (1) double-click bypass fixed in InteractionManager, (2) MOVE/SET_PATH/CLOSE_PATH execution gated by `hasSeatedUnit()` in `_processInputCommands`, (3) tab click in HUD gated, (4) keyboard WASD already gated in `simTick`, (5) camera chase gated in `renderUpdate`.

---

## C) Cross-client Coherence

### C1. Relative Waypoints
- **Status**: `OPEN`
- **Severity**: P1 (Major)
- **Observed**: Guest sees unit move relative to itself?
- **Expected**: Shared world coordinates.
- **Touchpoints**:
    - `src/SimCore/runtime/InputFactory.js`: Coordinate system for commands.
    - `src/SimCore/multiplayer/SessionManager.js`: Command serialization.

### C2. Unit Identity Confusion
- **Status**: `OPEN`
- **Severity**: P2 (Design)
- **Observed**: Shared starter units.
- **Fix Idea**: (Future) Spawn separate fleets. (Current) Use `ownerSlot` visual tinting.

---

## D) Path / UI Issues

### D1. Unit "Clear" broken / Path Deletion Ghosting
- **Status**: `FIXED`
- **Severity**: P1
- **Touchpoints**: `src/Core/Game.js`: `clearWaypoints()`.
- **Fix Applied**: `clearWaypoints()` now clears ALL backing arrays: `commands`, `waypoints`, `waypointControlPoints`, `pathSegmentIndices`, command cursor, segment tracking. Previously only cleared visuals, leaving data structures intact → ghost resurrection on next addCommand.

### D2. Manual override breaks heading
- **Status**: `FIXED`
- **Severity**: P2
- **Fix Applied**: Root cause: `[]` (empty array) is truthy in JS, so `setCommandPause(false)` was re-enabling `isFollowingPath` after clear. Fixed guard to `this.path && this.path.length > 0`. Also: `headingQuaternion.copy(mesh.quaternion)` on keyboard override engagement and on clearWaypoints.

### D3. Straight line through obstacles
- **Status**: `OPEN`
- **Severity**: P2 (FOW Design)
- **Touchpoints**: `src/Navigation/PathPlanner.js`.
- **Fix Idea**: If target is in FOW (Unknown), return `[start, target]` (straight line). Do not try to A* through invalid/unknown nodes.

### D4. Pips visible by default
- **Status**: `OPEN`
- **Severity**: P3 (Cosmetic)
- **Touchpoints**: `src/Core/Game.js`: `syncWaypointsFromCommands` marker creation.
- **Fix Idea**: Set `marker.visible = false` by default, show via `showUnitMarkers()` on select/hover.

---

## E) Fog of War (FOW)

### E1-E3. FOW Planning Logic
- **Status**: `OPEN`
- **Severity**: P2 (Enhancement)
- **Expected**: Path in unknown = Orange dashed line. Path in known = Green solid line.
- **Fix Idea**: Start with "Assumption Mode" (straight line) for user clicks in FOW.

---

## F) Camera / Bounds

### F1. Lateral move constraint
- **Status**: `FIXED`
- **Severity**: P2
- **Touchpoints**: `src/Camera/SphericalCameraController4.js`.
- **Fix Applied**: Added radial clamp in `update()` after all position modifications. Both `camera.position` and `targetPosition` clamped to `maxDistance`. Camera slides along sphere surface instead of punching through.

---

## G) Performance / FX

### G1. Dust Accumulation
- **Status**: `OPEN`
- **Severity**: P2 (Perf)
- **Touchpoints**: `src/Entities/Unit.js` (Dust system).
- **Fix Idea**: Remove particles from dustGroup (not scene). Add Unit.dispose() for cleanup.

### G2. Adaptive FX
- **Status**: `OPEN`
- **Severity**: P3
- **Fix Idea**: `if (dt > 30ms) dust.enabled = false`.

---

## H) New Items (from 2026-02-08 User Bug Report)

### H1. Startup auto-select removed
- **Status**: `FIXED`
- **Severity**: P1
- **Observed**: Game opens with Unit 0 pre-selected for both players. Two different "selected states" existed.
- **Fix Applied**: Removed `game.selectAndFlyToUnit(game.units[0])` from Main.js. No unit selected at startup.

### H2. Sticky selection ring on deselect
- **Status**: `FIXED`
- **Severity**: P1
- **Observed**: Host deselects unit but blinking selection ring stays. Green dot disappears correctly.
- **Fix Applied**: `isKeyboardOverriding = false` added to deselect branch in `setSelection()`. Ring now correctly hides.

### H3. Dual selection visuals (ring + dot)
- **Status**: `FIXED`
- **Severity**: P1
- **Observed**: Ring and overhead indicator not always both visible when selected.
- **Fix Applied**: `_myUnitIndicatorSprite` synced in `setSelection()` (immediate on/off) and in `updateSelectionVisuals()` (per-frame sync).

### H4. Headlight stays on too long
- **Status**: `FIXED`
- **Severity**: P2
- **Observed**: Headlight stays on 60s after deselect.
- **Fix Applied**: Idle timer threshold reduced from 60s to 2s. Lights off quickly when not selected + not moving.

### H5. Guest tab selection triggers seat flow
- **Status**: `FIXED`
- **Severity**: P1
- **Observed**: Guest bottom tab clicks blocked entirely (B4-FIX-5 was too aggressive).
- **Fix Applied**: Tab click now calls `_triggerSeatFlow(unit)` instead of returning. Shows keypad/OCCUPIED as appropriate.

### H6. Debug squares (PathPlanner)
- **Status**: `FIXED`
- **Severity**: P3
- **Observed**: Green/orange/red debug squares visible around rocks and water by default.
- **Fix Applied**: Set `debugEnabled: false` in PathPlanner.js.

### H7. Guest movement visualization (Slice 2)
- **Status**: `FIXED`
- **Severity**: P1
- **Observed**: Guest path commands only move unit on Host screen.
- **Fix Applied**: Slice 2 enabled: `_guestExecutionEnabled = true` in SessionManager. Both Host and Guest now execute commands from CMD_BATCH. StateHash sampling every 60 ticks for desync detection.

### H8. FOW path planning (Backlog)
- **Status**: `DEFERRED`
- **Severity**: P2
- **Observed**: Path goes straight through rocks in unknown territory. No orange line. No continuous recalculation.
- **Reason**: Large feature work (PathPlanner + FogOfWar integration). Deferred per user decision.

### H9. Backend security - full map exposure
- **Status**: `DEFERRED`
- **Severity**: P2
- **Observed**: Backend gives full map to client.
- **Reason**: Backend architectural requirement. Logged for future implementation.
