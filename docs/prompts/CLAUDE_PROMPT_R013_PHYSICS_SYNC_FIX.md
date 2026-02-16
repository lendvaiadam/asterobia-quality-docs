# CLAUDE CODE TASK: Fix Client-Side Interpolation Bug (Sync Fix)

**Current Situation:**
We are implementing the "Lift Before Solid" physics strategy to prevent terrain penetration.
You correctly identified a critical bug in the *visualization* layer that makes it look like the unit is stuck on the ground even if the server lifted it.

**The Bug Diagnosis (CONFIRMED):**
1.  **Server:** Sets `unit.position` to 10m (Lift) and sets `_serverDriven = true`.
2.  **Client (SimTick):** Correctly skips `unit.update()` because `_serverDriven` is true.
3.  **Client (Render):** `Game.js` calls `unit.applyInterpolatedRender(alpha)`.
4.  **Client (Unit.js):** `applyInterpolatedRender` blindly lerps between `_interpPrevPos` and `_interpCurrPos`.
5.  **The Issue:** `_interpPrevPos` contains the *old* (ground-level) position. The interpolation forces the mesh back to the ground, overriding the authoritative 10m position set by the server snapshot!

**Your Task:**
Fix this client-side rendering bug so we can verify if the "Lift Before Solid" physics fix actually works.

**Implementation Steps:**
1.  **Modify `src/Entities/Unit.js`** (or `src/Core/Game.js` call site):
    *   In `applyInterpolatedRender` (or before calling it), check if the unit is `_serverDriven` (or if it was just snapped by a server update).
    *   **If `_serverDriven` is true:** SKIP interpolation. Snap `this.mesh.position` directly to `this.position` (the authoritative value from server).
    *   *Alternative:* Ensure `_interpPrevPos` and `_interpCurrPos` are updated/reset when a server snapshot arrives, so interpolation happens between "Server Pos A" and "Server Pos B" (if applicable), or just snap if it's a discrete event.
    *   **Simplest Fix for now:** If `_serverDriven`, just copy `this.position` to `this.mesh.position` and return.

2.  **Verify:**
    *   Run the `DROP_TEST` again.
    *   The unit should visually appear at 10m, then fall (if physics is enabled).

**Context:**
We are still on the "Lift Before Solid" path. This visual bug was masking the actual physics behavior. Once visuals are correct, we can judge the physics fix.
