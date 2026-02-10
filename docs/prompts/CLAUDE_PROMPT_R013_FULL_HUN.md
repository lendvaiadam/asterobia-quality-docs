# Claude Code Prompt: R013 Comprehensive Bug Fixes

**Role:** You are an expert Gameplay Engineer / Full Stack dev.
**Objective:** You are receiving a comprehensive bug list from the Product Owner (PO). Your goal is to distribute these issues among your internal "agents" (concepts), analyze the provided code context, and fix the bugs cooperatively.
**Language:** The bug list below is translated from Hungarian to English.
**Constraint:** Ask the user for clarification or testing steps if *anything* is ambiguous.

---

## 🛑 Protocol: How to Execute
1.  **Read** the entire lists below.
2.  **Analyze** `src/Main.js`, `src/Core/InteractionManager.js`, `src/Entities/Unit.js`, `src/SimCore/multiplayer/SessionManager.js`, `src/Navigation/PathPlanner.js`.
3.  **Plan** your fixes in batches (Priority 1 -> Priority 2).
4.  **Execute** fixes one by one.

---

## 🛠️ PRIORITY 1: Core Interaction & Authority (The "Ghost" Bugs)

### 1. Startup Selection & Dual Selection States (Prob: 90%)
**Bug:** When the game starts, a unit is already selected for *both* players (Host/Guest). There seem to be "two types" of selection:
    1.  **Startup Default:** Unit has a selection ring but *no* green dot/indicator above it.
    2.  **Explicit Click:** Unit has *both* ring and green dot.
**User Requirement:**
    *   **Remove Startup Selection:** No unit should be selected by default on load.
    *   **Unify Visuals:** When selected, *both* the ring (ground) and the green circle (overhead) must be visible.
**Code Touchpoints:**
    *   `src/Main.js` (Line ~127): `game.selectAndFlyToUnit(game.units[0])` <- **REMOVE THIS**.
    *   `src/Entities/Unit.js` (`updateSelectionVisuals`, Line ~680): Check why `spotLight` / `glowRing` / `terrainRing` have different activation logic (`isSelected` vs `isActive`). Ensure consistent visuals.

### 2. Seat Exclusivity & Pin Logic (Prob: 95%)
**Bug:**
    *   **Shared Seat:** Host and Guest can currently "sit" in the same unit (Ghost Driving).
    *   **Pin Bypass:** The PIN entry screen should ONLY appear if the unit is *actually* free.
**User Requirement:**
    *   Strict enforcement: If `unit.selectedBySlot` is not null, NO ONE else can enter/drive.
    *   Show "Occupied" feedback instead of PIN pad if taken.
**Code Touchpoints:**
    *   `src/SimCore/multiplayer/SessionManager.js` (`_handleSeatReq`): Logic to reject `SEAT_REQ` if `selectedBySlot !== null`.
    *   `src/Core/InteractionManager.js` (`_triggerSeatFlow`): Check locally before showing UI? (Better to rely on Server REJECT).

### 3. Guest Input Gating ("Ghost Driving") (Prob: 98%)
**Bug:** Guests can move a unit with WASD/Keys even if they don't hold the seat.
**User Requirement:**
    *   Strict Input Gating: WASD/Arrow keys must do *nothing* if `mySlot !== unit.selectedBySlot`.
**Code Touchpoints:**
    *   `src/Core/Game.js` (`update` loop): Wrap input command generation in `if (hasAuthority)`.
    *   `src/Entities/Unit.js`: Ensure `applyInput` doesn't run for non-owners.

### 4. Guest Bottom Tab Selection
**Bug:** Guest cannot select different units using the bottom UI tab. No highlight/response.
**Code Touchpoints:**
    *   `src/UI/UnitControlPanel.js`: Check click handlers.
    *   `src/Core/Game.js` (`updatePanelContent`): Ensure it updates for Guests too.

---

## 🛠️ PRIORITY 2: Visual Polish & Sync

### 5. Sticky Selection Visuals
**Bug:** When Host deselects, the "Green Glowing Circle" (ground ring) sometimes stays visible on multiple units.
**Code Touchpoints:**
    *   `src/Entities/Unit.js` (`updateSelectionVisuals`): Logic check at line ~690 (`!this.isSelected && !isActive`).
    *   **Hypothesis:** `isActive` (keyboard override) might be remaining TRUE even after deselect. Ensure `deselect()` clears `isKeyboardOverriding`.

### 6. Headlights Logic
**Bug:** Headlights stay ON after deselect.
**User Requirement:** Headlights should be OFF if unit is (1) Not Selected AND (2) Not Moving/Active.
**Code Touchpoints:**
    *   `src/Entities/Unit.js` (`setHeadlightsOn`, Line ~830): Current logic has a 60-second idle timer.
    *   **Fix:** Reduce idle timer to ~2s or 0s if deselected.

### 7. Guest Path Visualization (Sync)
**Bug:**
    *   Guest places movement points -> Unit moves on Host screen.
    *   **Guest screen:** Unit does NOT move.
    *   **Realtime:** No smooth movement updates seen by "other" player.
**Code Touchpoints:**
    *   `src/SimCore/multiplayer/SessionManager.js`: Ensure `CMD_BATCH` is broadcast.
    *   `src/Entities/Unit.js` (`applyInterpolatedRender`): Ensure Guest is receiving and interpolating `state.pos`.

### 8. Path Deletion "Ghosting"
**Bug:** Deleting a path (Clear) -> Placing new point -> Old deleted points reappear.
**Code Touchpoints:**
    *   `src/Core/Game.js` (`clearWaypoints`): Ensure it deeply clears `unit.waypointControlPoints` AND `unit.waypoints`.
    *   **Hypothesis:** The "Edit History" or a secondary array isn't being cleared.

---

## 🛠️ PRIORITY 3: Advanced Systems (FOW & Camera)

### 9. Fog of War (FOW) Pathfinding (Critical New Feature)
**Bug/Requirement:**
    *   **Issue:** Pathfinding fails/stops when targeting Unknown (FOW) area, or cheaty (knows obstacles).
    *   **Requirement:**
        1.  If target is in FOW: Draw a **Straight Line** (Orange/Dashed).
        2.  **Re-eval:** Every 1-2 seconds while moving, re-check the path against *newly discovered* FOW.
        3.  Backend must NOT send full map to client (Security). (Note: Address client-side logic first).
**Code Touchpoints:**
    *   `src/Navigation/PathPlanner.js`: Add `planPath({ useKnowledge: true })`.
    *   `src/World/FogOfWar.js`: Need a way to query `isExplored(position)`.
    *   `src/Entities/Unit.js`: Add `updatePath` loop (setInterval or tick check).

### 10. Camera Star Collision
**Bug:** Simple: Camera limits work for Zoom (scroll) but not for Pan (side). Can clip through stars.
**Code Touchpoints:**
    *   `src/Camera/SphericalCameraController4.js`: Apply `checkPlanetVisibility` or radius constraints to `rotate/pan` methods, not just zoom.

### 11. Dust Performance
**Requirement:** If FPS < 50, reduce dust duration/density.
**Code Touchpoints:**
    *   `src/Entities/Unit.js` (`updateDustParticles`): Read `game.fps` (if avail) and modulation `maxLife` in shader or spawn rate.

---
**Agent Action:** Please start with **Priority 1 (Authority/Selection)**. Ask me if you need to verify the "Startup Selection" fix since it involves changing the main entry point.
