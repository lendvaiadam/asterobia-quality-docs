# Physics HU Debug Tooling Spec
**Status:** BINDING
**Target:** Phase 3 Physics (HU-TEST Unblocking)
**Context:** Enable visual verification of physics events without CLI/Code access.
**Based on:** `ADR-003`

---

## 1. Requirement Summary
We need browser-based controls to:
1.  **Enable Physics** (Server-side Rapier runtime).
2.  **Spawn Obstacles** (Rocks/Mines) for collision testing.
3.  **Trigger Events** (Explosions) for impulse testing.

**Constraint:** Minimal code surface. No protocol changes (reuse `INPUT_CMD` or add minimal `CMD_ADMIN`). No renderer authority.

---

## 2. Server-Side Architecture (`src/SimCore`)

### A. Protocol: `CMD_ADMIN`
Add a single new Message Type or reuse `INPUT_CMD` with a privileged type.
**Decision:** Use `InputCmd` struct with specific `command` strings to avoid schema changes if possible. If cleaner, add `MSG.CMD_ADMIN`.
*   **Structure:**
    ```json
    {
      "type": "CMD_ADMIN",
      "action": "PHYSICS_TOGGLE",
      "payload": { "enable": true }
    }
    ```
    ```json
    {
      "type": "CMD_ADMIN",
      "action": "SPAWN_OBSTACLE",
      "payload": { "type": "ROCK", "targetUnitId": 123, "offset": { "x": 0, "y": 0, "z": 5 } }
    }
    ```

### B. Action Handlers (in `GameServer.js` or `Room.js`)
1.  **`PHYSICS_TOGGLE`**:
    *   Payload: `{ enable: boolean }`
    *   Logic: If `true` and not enabled, `await PhysicsWorld.create()`. Set `room.enablePhysics = true`.
    *   **Async Safety:** It is acceptable to block the loop for init (100ms) in DEV mode.
2.  **`SPAWN_OBSTACLE`**:
    *   Payload: `{ type: 'ROCK' | 'MINE', targetUnitId: number, offset: {x,y,z} }`
    *   Logic: Look up `targetUnit`, apply offset (local space or world space), `room.spawnEntity(...)`.
3.  **`TRIGGER_EXPLOSION`**:
    *   Payload: `{ targetUnitId: number, force: number }`
    *   Logic: Look up unit, apply radial impulse `PhysicsEventService.applyBlast(...)`.

### C. Security & Gating (MANDATORY)
*   **Gate:** `isDevCommandAllowed(client)` check.
*   **Conditions:** `CONFIG.devMode === true` AND (`client.isHost` OR `client.isLocal`).
*   **Production:** These commands must be silently ignored or rejected in non-dev builds.
*   **Test:** Add an integration test that sends `CMD_ADMIN` as a Guest and verifies rejection.

---

## 3. Client-Side Tooling (`src/UI`)

### A. DebugPanel Expansion
Add a **"Physics Tools"** folder to the existing Tweakpane/GUI.
*   **[Checkbox] Enable Physics**: Sends `PHYSICS_TOGGLE` (Default off).
*   **[Button] Spawn Rock (+5m)**: Sends `SPAWN_OBSTACLE` (Rock, Offset +5m Z).
*   **[Button] Spawn Mine (-2m)**: Sends `SPAWN_OBSTACLE` (Mine, Offset -2m Z).
*   **[Button] EXPLODE**: Sends `TRIGGER_EXPLOSION` on Selected Unit.

### B. Visual Feedback
*   Use the existing **CSS Status Panel** (or expand it).
*   Show `Physics: ON/OFF` status.
*   (Optional) If a unit is `DYNAMIC`, add a small text marker in the DOM or color the status panel red.

---

## 4. Claude Implementation Checklist

### Files to Touch
*   [ ] `src/SimCore/multiplayer/MessageTypes.js` (Add `CMD_ADMIN` if strictly needed, or document `INPUT_CMD` usage).
*   [ ] `server/GameServer.js` (Handle admin routing).
*   [ ] `server/Room.js` (Implement `enablePhysics` runtime toggle & spawn logic).
*   [ ] `src/UI/DebugPanel.js` (Add buttons/checkbox).
*   [ ] `server/PhysicsEventService.js` (Ensure explosion math handles "Admin Trigger").


### Acceptance Criteria (HU-PASS)
1.  **Toggle:** Clicking "Enable Physics" changes server logs to "Physics: ON" and enables rollover logic.
2.  **Spawn:** Clicking "Spawn Rock" creates a rock at the expected position relative to the unit.
3.  **Interaction:** Driving into the spawned rock triggers a collision event (bounce).
4.  **Explode:** Clicking "Explode" sends the unit flying.

### Non-Negotiables
*   **No Math.random**: Use a deterministic definition for "Spawn Rock" (e.g., exactly 5m forward).
*   **No Render Authority**: Client UI sends **Commands**, server decides where the rock puts.
*   **Safety**: If physics is OFF, `Spawn Rock` should verify/enable it or warn.
