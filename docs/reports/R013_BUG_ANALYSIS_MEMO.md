# R013 Bug Analysis & Diagnostic Memo

**Date:** 2026-02-07
**Status:** DRAFT (Ready for Implementation)
**Author:** Antigravity

This memo provides a deep-dive analysis of the bugs listed in `docs/BUGLIST.md`. It is intended to guide the implementation work by Claude Code.

## 1. Top Priority: Authority & Gating (M07)

### **B1. Keypad / PIN Flow Missing** (FIXED via `seatPolicy` init)
*   **Root Cause:** Units were spawned with default `seatPolicy = 'OPEN'` instead of `'PIN_1DIGIT'` in `Main.js` / `Game.js` initialization.
*   **Verification:** Confirmed that `Unit.js` defaults verify correct behavior `_triggerSeatFlow`.
*   **Status:** **FIXED** (as per previous analysis, verified in code).

### **B2. Seat Exclusivity Not Enforced**
*   **Touchpoint:** `src/SimCore/multiplayer/SessionManager.js` -> `_handleSeatReq`.
*   **Analysis:**
    *   **Logic:** The Host MUST check `unit.selectedBySlot` before granting a seat.
    *   **Review:** Code at lines 1333-1340 correctly implements strict checking: `if (unit.selectedBySlot !== null && unit.selectedBySlot !== requesterSlot)`.
    *   **Conclusion:** The simulation logic is sound. Any observed "double driving" is likely **B4 (Ghost Driving)** where a client *thinks* it's driving locally but has no authority.
*   **Recommendation:** Mark as FIXED/DUPLICATE of B4 once B4 is resolved.

### **B3. Guest Select/Deselect Broken**
*   **Touchpoint:** `InputFactory.js` / `InteractionManager.js`.
*   **Analysis:** Selection is a *local* UI state, but `InteractionManager` might be routing it through the network command queue or it's being blocked by command gating.
*   **Fix:** Ensure `Select` / `Deselect` commands are processed **locally/immediately** and do not require `ENABLE_COMMAND_EXECUTION` gating.
*   **Code Evidence:** `Game.js` `_processInputCommands` gates commands. Selection events shouldn't be "Commands" in the simulation sense.

### **B4. Guest Inputs Not Gated (Ghost Driving)**
*   **Touchpoint:** `Game.js` -> `_processInputCommands`.
*   **Analysis:** The loop processes valid commands from the network buffer. It assumes the Host validated them. But the *Guest* client also predicts local movement via `InputFactory`.
*   **Fix:** 
    1.  **Client-Side Prediction:** In `InputFactory.js`, only generate `Move` commands if `unit.selectedBySlot === mySlot`.
    2.  **Host-Side Validation:** (Already partially present?) In `bufferInputCmd`, ensure we validate authority again or rely on `_handleSeatReq`.
    3.  **Local Execution:** In `Game.js` `update()`, ignore WASD keys if `game.selectedUnit.selectedBySlot !== game.mySlot`. **This is the critical missing piece.**

## 2. Multiplayer & Debug (A)

### **A1. startDiscovery() Confusion**
*   **Touchpoint:** `src/UI/NetworkDebugPanel.js`.
*   **Analysis:** `SessionManager.js` has `getAvailableHosts()` which prunes stale hosts. The UI likely doesn't poll it.
*   **Fix:** Add `setInterval` in `NetworkDebugPanel` to poll `game.sessionManager.getAvailableHosts()` and re-render the list.

### **A3. Join Timeout**
*   **Touchpoint:** `SessionManager.js`.
*   **Analysis:** Timeout is 10s. If Host is "busy" or RTT is high (simulated), this triggers.
*   **Fix:** Bump to 15s. Add console log on Host when `JOIN_REQ` received to debug if it's arriving.

### **A4. dumpNetEvidence Circular JSON**
*   **Touchpoint:** `Game.js` -> `_dumpNetEvidence`.
*   **Analysis:** `JSON.stringify(game.units)` tries to serialize Three.js objects (circular).
*   **Fix:** Map units to a clean DTO: `{ id, pos: {x,y,z}, ownerSlot, selectedBySlot }`.

## 3. Pathfinding & FOW (D/E)

### **D3. Straight line through obstacles (FOW)**
*   **Touchpoint:** `PathPlanner.js`.
*   **Analysis:** `planPath` checks `navMesh`. If start/end in separate zones (blocked), it fails.
*   **Hypothesis:** When target is in FOW (Unknown), `PathPlanner` might not know it's "valid" or "invalid" and just fails or returns start->end.
*   **Fix Idea:**
    *   If `isTargetInFOW`: Return `[start, target]` (Greedy assumption).
    *   `PathPlanner` needs a reference to `FogOfWar` system or `Terrain.isKnown()`.
    *   **Crucial:** "Replanning on Discovery" logic is needed in `Unit.update()`.

### **E1. FOW Path Visualization**
*   **Touchpoint:** `Game.js` / `Unit.js` -> `drawPath`.
*   **Analysis:** Current path drawing is one color.
*   **Fix:**
    *   Iterate path segments.
    *   Check `terrain.isKnown(segment)`.
    *   If unknown: Use `DashedLine` or `Orange` color.
    *   If known: Use `SolidLine` or `Green` color.

## 4. Performance & FX (G)

### **G1. Dust Accumulation (Visual Pop)**
*   **Touchpoint:** `Unit.js`.
*   **Analysis:**
    *   `dustMaxParticles` is typically 25 (Low) or 50 (High).
    *   `dustSpawnInterval` = 0.05s (20 per sec).
    *   Lifetime = 4.0s.
    *   **Required Buffer = 20 * 4 = 80 particles**.
    *   **BUG:** 50 < 80. Buffer wraps around while particles are still alive/visible.
*   **Fix:** Increase `dustMaxParticles` to 100 or reduce lifetime to 2.0s.

## 5. Camera (F)

### **F1. Lateral Move Constraint**
*   **Touchpoint:** `SphericalCameraController4.js`.
*   **Analysis:** Camera can orbit freely.
*   **Fix:** "Lateral" usually means "Don't go too low/high" or "Don't go too far". On a sphere, only Altitude matters.
*   **Clarification:** If the user means "don't let the planet go off-screen", `enforceTerrainDistance` helps, but `checkPlanetVisibility` (if it exists) is better. `SphericalCameraController4.js` lines 1200+ don't seem to have strict "keep planet in view" logic in `update` loop other than distance.

---

## Technical Handoff Checklist for Claude

1.  **Refactor `NetworkDebugPanel.js`**: Implement polling loop for Discovery.
2.  **Patch `Game.js`**:
    *   Implement `_dumpNetEvidence` with safe DTOs.
    *   Add WASD gating in `update()`.
3.  **Patch `SessionManager.js`**:
    *   Bump Join Timeout to 15s.
4.  **Patch `Unit.js`**:
    *   Fix Dust calculation (`dustMaxParticles` -> 100).
5.  **Patch `PathPlanner.js`**:
    *   Implement "Assumption Mode" for FOW paths.

