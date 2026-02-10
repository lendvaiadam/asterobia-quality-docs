# PROMPT FOR CLAUDE CODE: R013 Bug List & Technical Context

**User Instruction:**
Please analyze the following bug list (translated from Hungarian). For each item, I have provided relevant code sections (File, Line Numbers) and a non-binding suggestion for the fix.
Do not code yet. Read this list, ask clarifying questions if needed, and distribute the work among your internal agents.

---

## 1. Startup Selection Issue
**User Description:** "When the game opens, the same Unit is already selected for both players. If you don't see this selection, check for another type of on/off switching for selection, because it's always been suspicious to me that there is a default selection at the start, and during the game I feel like there is another type. It is definitely a problem that it allows multiple players to take possession of and control the same Unit."
**Code Context:**
*   **File:** `src/Main.js`
*   **Lines:** 125-130
*   **Snippet:** `game.selectAndFlyToUnit(game.units[0]);`
**Suggestion:**
*   This line expressly forces a selection on startup. Removing it should solve the default selection issue.
*   **Fix Idea:** Delete or comment out this line to ensure no unit is selected by default.

## 2. Pin / Seat Logic
**User Description:** "The Pin entry should only appear if the Unit the Guest clicked on is currently free, meaning the Host or another guest is not sitting in it. Currently, the Guest and Host can sit in the same Unit."
**Code Context:**
*   **File:** `src/SimCore/multiplayer/SessionManager.js`
*   **Lines:** 1330-1340 (`_handleSeatReq`)
*   **Snippet:** `if (unit.selectedBySlot !== null && unit.selectedBySlot !== requesterSlot)`
**Suggestion:**
*   The logic seems to exist but might be failing if the client (Guest) bypasses the check or if the UI shows the PIN pad *before* asking the server.
*   **Fix Idea:** Ensure the UI (`InteractionManager.js`) waits for the server's `SEAT_ACK` or `SEAT_REJECT` before showing the PIN pad, or the server must strictly enforce the `OCCUPIED` rejection.

## 3. Guest Bottom Tab Selection
**User Description:** "For the Guest, selection on the bottom tab doesn't work, where I should be able to select other Units."
**Code Context:**
*   **File:** `src/Core/Game.js`
*   **Lines:** 2800-2900 (`updatePanelContent`)
*   **Probable Cause:** Elements in the bottom panel might have click listeners that check for `isHost` or local authority incorrectly.
**Suggestion:**
*   Check the event listeners for the bottom panel icons. Ensure they trigger `game.selectUnit(u)` locally even for Guests.

## 4. Sticky Selection Rings (Host)
**User Description:** "If the Host deselects a Unit, for some of them the blinking Selection Ring around the Unit does not disappear. The green dot we added recently does disappear. These blinking circles remain on multiple deselected Units."
**Code Context:**
*   **File:** `src/Entities/Unit.js`
*   **Lines:** 680-700 (`updateSelectionVisuals`)
**Suggestion:**
*   The `updateSelectionVisuals` function checks `this.isSelected` AND `this.isKeyboardOverriding`.
*   **Fix Idea:** It is likely that `isKeyboardOverriding` remains `true` (stuck) even after deselect. Ensure `deselect()` explicitly sets `isKeyboardOverriding = false`.

## 5. Dual Selection Visuals (Ring + Dot)
**User Description:** "Now visually there is that selection (the ring around the Unit) which was there before, and you also put a circle above the Unit. Now let's make it so that *both* selections remain. We will give the circle above the Unit more complex behavior later, but for now let it stay like this (just tidy it up!)."
**Code Context:**
*   **File:** `src/Entities/Unit.js`
*   **Lines:** 680-748
**Suggestion:**
*   Currently `updateSelectionVisuals` might be toggling one or the other based on state.
*   **Fix Idea:** Ensure both the `glowRing` (ground) and the new overhead indicator are set to `visible = true` when `this.isSelected` is true.

## 6. Headlights Logic
**User Description:** "The Unit's lamp now stays on after deselect. Here it should be that if the Unit is not selected and is executing no action, then the lamp should not be on."
**Code Context:**
*   **File:** `src/Entities/Unit.js`
*   **Lines:** 1830-1850 (`update` loop)
*   **Snippet:** `this.headlightIdleTimer > 60`
**Suggestion:**
*   The current code explicitly waits 60 seconds before turning off lights.
*   **Fix Idea:** Change the condition to turn off lights immediately (or after 2s) if `!this.isSelected` and `!isMoving`.

## 7. Guest Movement Visualization
**User Description:** "If the Guest places a movement point for the Unit, then the Unit only moves on the Host's screen, not at the Guest. ... There is no realtime movement either, when I would see the other player going with a Unit."
**Code Context:**
*   **File:** `src/SimCore/multiplayer/SessionManager.js`
*   **Lines:** 370-440 (`sendCmdBatch`)
*   **File:** `src/Entities/Unit.js`
*   **Lines:** 2060-2080 (`applyInterpolatedRender`)
**Suggestion:**
*   The Host is likely simulating the movement but not broadcasting the *result* (Unit State / Position) back to the Guest frequently enough, or the Guest is not applying the received state.
*   **Fix Idea:** Ensure `STATE_SYNC` messages are being sent by Host and applied by Guest to `unit.position`.

## 8. FOW Shortest Path (Unknown Territory)
**User Description:** "If the unit starts into the unknown, the shortest path calculation should always only consider information discovered according to FOW. We need another shortest path calculation (theoretically exists, just doesn't work), which while moving in the unknown checks the freshly revealed area every 1-2 seconds and modifies the shortest path based on that (still imagining the possible route as straight in the unknown)."
**Code Context:**
*   **File:** `src/Navigation/PathPlanner.js`
*   **Lines:** 1-200
*   **File:** `src/World/FogOfWar.js`
**Suggestion:**
*   The `PathPlanner` currently likely reads the Global NavMesh which might have "god mode" knowledge of rocks.
*   **Fix Idea:** Inject a dependency on `FogOfWar` into `PathPlanner`. If a node is "Unknown", assume cost is 1 (Flat/Safe). If "Known" and "Blocked", use actual cost.
*   Implement a loop in `Unit.js` to trigger `recalculatePath()` every 1s.

## 9. Startup Selection States (Detailed)
**User Description:** "I think there are two selected states for the units... There is a default at the beginning... I can control this immediately. Then if I deselect and re-select, that is a different kind of selected state... The initial selection doesn't have the green small sphere above it... Let's eliminate the initial selection! Initially, let neither be selected."
**Code Context:**
*   **File:** `src/Main.js` (Line 127)
*   **File:** `src/Core/InteractionManager.js`
**Suggestion:**
*   This confirms Issue #1. The "Initial State" is likely a bypass of the standard `selectUnit` flow in `Game.js`.
*   **Fix Idea:** Remove the auto-select in `Main.js`.

## 10. Guest Keypad/Selection Confusion
**User Description:** "It is also a bug now that if the Guest selects a unit, the Host can also select it and start driving it, and take the unit completely elsewhere... If I select a unit with the Guest and place key points... those key points do not appear on the map and timeline for the Guest, but at the Host I can select the same one... and the key points appear there."
**Code Context:**
*   **File:** `src/SimCore/multiplayer/SessionManager.js`
*   **Lines:** 1320-1340
**Suggestion:**
*   This implies "Shared Authority" is currently active.
*   **Fix Idea:** Strict enforcement in `_handleSeatReq`: If `selectedBySlot` is NOT null, reject the request.

## 11. Guest Bottom Tab (No Highlight)
**User Description:** "For the Guest, it doesn't switch unit if I try on the bottom tab. It can only select number 1, but even when selecting this, it doesn't indicate on the tab below, doesn't highlight the selected unit."
**Code Context:**
*   **File:** `src/UI/` (UnitControlPanel or similar)
**Suggestion:**
*   The UI highlighting logic might be bound to `game.selectedUnit`. If the Guest's local `game.selectedUnit` isn't updating correctly, the UI won't highlight.

## 12. Straight Line in Unknown (Hitting Rocks)
**User Description:** "Giving a distant unknown area as the next move target point, it continues to draw an arrow straight line and wants to go along that, but obviously hits a rock... The expected behavior is... path planning should happens exclusively on the revealed area. On the unknown area, connect the target and the entry point to the unknown area with a straight conditional line."
**Code Context:**
*   **File:** `src/Navigation/PathPlanner.js`
**Suggestion:**
*   **Fix Idea:** In the A* algorithm, if a node is Unexplored, do not check for collisions (Rocks). Just assume it's traversable. This will naturally create a straight line through the unknown (as A* seeks shortest distance).

## 13. Heading Shift after Manual Override
**User Description:** "If I defined a path for the Unit... but meanwhile I take over control with keys... and then I delete from the planned path key points and then try to control with keys again, then the unit doesn't want to go in the direction pressed by keys, but behaves like its sight is misaligned!"
**Code Context:**
*   **File:** `src/Entities/Unit.js`
*   **Lines:** ~1850-1870 (`drift fix`, `headingQuaternion`)
**Suggestion:**
*   The code manipulates `headingQuaternion` to match the sphere normal.
*   **Fix Idea:** When re-engaging manual control, ensure `headingQuaternion` is reset or re-aligned to the current camera/mesh forward to avoid "gimbal lock" or offset issues.

## 14. Camera Star Clipping
**User Description:** "If I zoom out completely with the camera... it doesn't let the camera go through the star sphere surface (this is good!). However, if I move the camera sideways, I can go through the stars (not good!)."
**Code Context:**
*   **File:** `src/Camera/SphericalCameraController4.js`
*   **Lines:** 1200+ (`update` or `pan` methods)
**Suggestion:**
*   The Zoom limit (`min/maxDistance`) is working. The Pan limit is missing.
*   **Fix Idea:** In the `update` loop, check `camera.position.length()`. If it exceeds the Star Sphere radius (minus buffer), clamp the position vector length.

## 15. Backend Security (Map)
**User Description:** "I'm not saying anti-hacking protection is the highest priority now, but let's write it into the material so we need this... ensure the Backend doesn't give the full map to the client."
**Suggestion:**
*   **Note:** This is a backend architectural requirement. Place this in the backlog or `docs/specs/TODO.md`.

## 16. Continuous Path Calculation (Unknown)
**User Description:** "As it proceeds, the unknown area is gradually revealed. In this case, while moving, the Unit must calculate how the new information modifies the path planning... calculated say every 2 seconds."
**Code Context:**
*   **File:** `src/Entities/Unit.js`
*   **Lines:** `update` method
**Suggestion:**
*   **Fix Idea:** Add a timer `this.repathTimer`. If `isFollowingPath` AND `isTraversingUnknown`, decrement timer. On 0, call `game.recalculatePath(this)`.

## 17. Orange Line for Assumed Path
**User Description:** "That green line we immediately draw when placing a key point in unknown territory, let's modify it to be orange. This means we hope we can go there... As the Unit proceeds... it should continuously recalculate."
**Code Context:**
*   **File:** `src/Entities/Unit.js`
*   **Lines:** `drawPath`
**Suggestion:**
*   **Fix Idea:** When iterating the waypoints to draw the line/tube, check the FOW status of the segment. If Unknown -> Material Color = Orange. If Known -> Green.

## 18. Debug Squares
**User Description:** "Now if the Unit plans a path, green, orange and red small squares appear around rocks and water... let's turn this off by default."
**Code Context:**
*   **File:** `src/Navigation/PathPlanner.js`
*   **Lines:** 37 (`debugEnabled: true`)
**Suggestion:**
*   **Fix Idea:** Set `debugEnabled: false`.

## 19. Path Deletion Ghosting
**User Description:** "If I delete the path assigned to the Unit, then place a new path dot, all the deleted dots appear and it places the next one continuing those. Meaning the problem is deletion doesn't actually delete the timeline..."
**Code Context:**
*   **File:** `src/Core/Game.js`
*   **Lines:** 2900 (`clearWaypoints`)
**Suggestion:**
*   **Fix Idea:** The function `clearWaypoints` likely clears the *visuals* but fails to empty the specific array `unit.waypointControlPoints` or `unit.waypoints` effectively, or `InputFactory` state isn't synced.

## 20. Dust Performance / FPS
**User Description:** "It would also be important to try to reduce the resource heavy display load based on FPS value. For example if FPS is lower than 50... start reducing Dust duration and density..."
**Code Context:**
*   **File:** `src/Entities/Unit.js`
*   **Lines:** `updateDustParticles`
**Suggestion:**
*   **Fix Idea:** In the update loop, access `game.fps` (if exists). `if (fps < 50) maxLife = 2.0; else maxLife = 4.0;`.

