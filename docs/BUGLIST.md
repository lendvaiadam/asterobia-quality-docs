# R013 M07 Bug List (Canonical)

**Status**: ACTIVE
**Owner**: Antigravity
**Last Updated**: 2026-02-07

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
- **Status**: `OPEN`
- **Severity**: P1 (Major)
- **Observed**: `ReferenceError: globalCommandQueue is not defined` when accessing `pendingCount`.
- **Expected**: `globalCommandQueue` to be exported singleton from `CommandQueue.js` and imported where needed.
- **Touchpoints**:
    - `src/SimCore/runtime/CommandQueue.js`: Ensure `export const globalCommandQueue` exists.
    - `src/Core/Game.js`: Ensure correct import.

### A3. Join timeout happens sometimes
- **Status**: `OPEN`
- **Severity**: P2 (Minor/Flake)
- **Observed**: `Uncaught Error: Join timeout - no response from host`.
- **Expected**: Join should be reliable on local transport.
- **Touchpoints**:
    - `src/SimCore/multiplayer/SessionManager.js`: `joinGame` timeout (10s).
    - `src/SimCore/transport/LocalTransport.js`: Check latency simulation or channel subscription timing.
- **Fix Idea**: Increase timeout to 15s? Investigate if Host is actually receiving `JOIN_REQ`.

### A4. dumpNetEvidence circular JSON
- **Status**: `OPEN`
- **Severity**: P1 (Major - Blocks Debugging)
- **Observed**: `JSON.stringify` crashes on `dumpNetEvidence()`.
- **Expected**: Clean JSON with primitives only.
- **Touchpoints**:
    - `src/Core/Game.js`: `_dumpNetEvidence`.
    - `src/SimCore/multiplayer/SessionManager.js`: `getNetEvidence`.
- **Fix Idea**: Ensure `getNetEvidence` (and `_dumpNetEvidence`) creates a *new* object copying only specific fields (id, tick, counts), never passing full objects/references.

### A5. UI Debug Clutter
- **Status**: `OPEN`
- **Severity**: P2 (UX)
- **Observed**: Overlapping panels (DebugPanel, NetworkDebugPanel, Stats).
- **Expected**: Clean layout or tabs.
- **Touchpoints**:
    - `src/UI/NetworkDebugPanel.js`: positioning.
- **Fix Idea**: Add a "Toggle UI" hotkey or consolidate into a single tabbed Debug UI.

---

## B) Authority / Seat / Control Gating

### B1. Keypad / PIN flow missing
- **Status**: `OPEN`
- **Severity**: P0 (Blocker)
- **Observed**: Clicking unit does not show keypad (locks hidden, guest drives instantly).
- **Expected**: M07 v0 Spec - Foreign units require PIN.
- **Touchpoints**:
    - `src/Entities/Unit.js`: `seatPolicy` default (is it 'OPEN'? Should be 'PIN_1DIGIT' for test).
    - `src/Core/InteractionManager.js`: `_triggerSeatFlow` logic.
    - `src/UI/SeatKeypadOverlay.js`: `show()` method.
- **Fix Idea**: 
    1. Ensure Host initializes test units with `seatPolicy = 'PIN_1DIGIT'`.
    2. Verify `InteractionManager` calls `overlay.show()`.
    3. Verify overlay z-index > canvas.

### B2. Seat exclusivity not enforced
- **Status**: `OPEN`
- **Severity**: P0 (Blocker)
- **Observed**: Multiple players might drive same unit (race condition) or Guest ignores Occupied status.
- **Expected**: `OCCUPIED` rejection if `selectedBySlot` != null.
- **Touchpoints**:
    - `src/Core/InteractionManager.js`: `_triggerSeatFlow` -> check `unit.selectedBySlot`.
    - `src/SimCore/multiplayer/SessionManager.js`: `_handleSeatReq` (Host side validation).

### B3. Guest select/deselect broken
- **Status**: `OPEN`
- **Severity**: P1 (Major)
- **Observed**: Guest deselect used to work, now inconsistent.
- **Expected**: Local selection (UI focus) should separate from Seat Control.
- **Touchpoints**:
    - `src/Core/InteractionManager.js`: `onMouseUp` -> `inputFactory.deselect()`.
    - `src/Core/Game.js`: `_processInputCommands`.
- **Fix Idea**: Allow `SELECT`/`DESELECT` commands to bypass `ENABLE_COMMAND_EXECUTION` check (since they are local UI state, not sim state).

### B4. Guest inputs not gated (Ghost Driving)
- **Status**: `OPEN`
- **Severity**: P0 (Blocker)
- **Observed**: Keyboard controls work even without seat.
- **Expected**: Inputs ignored unless `unit.selectedBySlot == mySlot`.
- **Touchpoints**:
    - `src/Core/Game.js`: `update()` loop checking `Input.js`.
    - `src/SimCore/runtime/InputFactory.js`: `createMoveCommand`.
- **Fix Idea**: In `Game.update`, wrap input reading in `if (selectedUnit.selectedBySlot === mySlot)`.

---

## C) Cross-client Coherence

### C1. Relative Waypoints
- **Status**: `OPEN`
- **Severity**: P1 (Major)
- **Observed**: Guest sees unit move relative to itself?
- **Expected**: Shared world coordinates.
- **Fix Idea**: Ensure `CMD_BATCH` contains absolute world coordinates. Verify `Unit.setPath` uses world space.

### C2. Unit Identity Confusion
- **Status**: `OPEN`
- **Severity**: P2 (Design)
- **Observed**: Shared starter units.
- **Fix Idea**: (Future) Spawn separate fleets. (Current) Use `ownerSlot` visual tinting.

---

## D) Path / UI Issues

### D1. Unit "Clear" broken
- **Status**: `OPEN`
- **Severity**: P1
- **Touchpoints**: `src/UI/UnitControlPanel.js` (presumably).
- **Fix Idea**: Ensure "Clear" button sends a `SET_PATH` command with empty array.

### D2. Manual override breaks heading
- **Status**: `OPEN`
- **Severity**: P2
- **Fix Idea**: Reset `currentSegmentIndex` or `pathIndex` when taking manual control.

### D3. Straight line through obstacles
- **Status**: `OPEN`
- **Severity**: P2 (FOW Design)
- **Touchpoints**: `src/Navigation/PathPlanner.js`.
- **Fix Idea**: If target is in FOW (Unknown), return `[start, target]` (straight line). Do not try to A* through invalid/unknown nodes.

### D4. Pips visible by default
- **Status**: `OPEN`
- **Severity**: P3 (Cosmetic)
- **Touchpoints**: `src/Entities/Unit.js`: `waypointMarkers`.
- **Fix Idea**: visual toggle in `Game.js` or `DebugPanel`. Default `visible = false`.

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
- **Status**: `OPEN`
- **Severity**: P2
- **Touchpoints**: `src/Camera/SphericalCameraController4.js`.
- **Fix Idea**: `enforceTerrainDistance` implies some bounds, but lateral movement needs `clamp` to star-sphere radius (or `planetRadius + offset`).

---

## G) Performance / FX

### G1. Dust Accumulation
- **Status**: `OPEN`
- **Severity**: P2 (Perf)
- **Touchpoints**: `src/Entities/Unit.js` (Dust system).
- **Fix Idea**: Ensure particles are disposed/recycled. Use `InstancedMesh` for dust if not already.

### G2. Adaptive FX
- **Status**: `OPEN`
- **Severity**: P3
- **Fix Idea**: `if (dt > 30ms) dust.enabled = false`.
