# CLAUDE CODE TASK: Implement "Lazy Rigid Body" & Float-Drop Debug Toggle

**Context:**
We are experiencing "space launch" bugs where units spawn inside the terrain and get ejected by the physics engine.
**Decision:** We will switch to a "Lazy Initialization" strategy. Units spawn without physics bodies (floating). Physics bodies are only created when explicitly toggled ON.

## Goal
1.  **Default Spawn:** All units spawn floating **5.0m** above the terrain. Rapier RigidBody is **NOT** created. Physics is OFF.
2.  **PHY ON (Toggle):** When user toggles physics ON for a unit:
    *   Create the DYNAMIC RigidBody at the *current* floating position.
    *   Allow gravity to pull it down ("Drop Test").
    *   This verifies terrain collider accuracy without initial intersection.
3.  **PHY OFF (Toggle):** When user toggles physics OFF:
    *   **Destroy** the RigidBody and Collider completely.
    *   Reset unit altitude to **5.0m** (snap back to safety).
    *   **IMPORTANT:** Zero out velocity and angular velocity to prevent "launch" on next enablement.

## Implementation Steps

### 1. `server/Room.js`
*   **Remove Eager Init:** In `start()`, `createUnitForPlayer()`, and `createUnitsFromManifest()`, **REMOVE** the calls to `_attachRigidBody(unit)`.
*   **Implement `toggleUnitPhysics(unitId)`:**
    *   *If enabling:* Call `_attachRigidBody(unit)`, then `unit.enterDynamic(this.physics)`.
    *   *If disabling:* Call `unit.exitDynamic()`, then remove the body from world (`this.physics.removeBody(...)`), set `unit.rigidBody = null`, and force `unit.altitude = 5.0`.

### 2. `server/HeadlessUnit.js`
*   **Add Guards:** Ensure **ALL** physics-related methods (`checkRolloverTrigger`, `checkSlopeTrigger`, `syncFromRigidBody`, etc.) have a guard clause at the top:
    ```javascript
    if (!this.rigidBody) return false; // or null
    ```
*   **Update `exitDynamic()`:** Ensure it resets `verticalVelocity` and `velocity` to zero.

### 3. `src/UI/PhysicsDebugOverlay.js`
*   **Update Button State:**
    *   If `unit.physicsMode === 'DYNAMIC'`, button should say "PHY OFF" (Red).
    *   If `unit.physicsMode === 'KINEMATIC'` (or null/undefined), button should say "PHY ON" (Green).

## Verification
*   **Launch:** `LAUNCH_HU_TEST_2TABS.bat`
*   **Expectation:** Units hover 5m above ground. No chaos.
*   **Test:** Select unit -> Press PHY ON -> Unit drops and lands. Press PHY OFF -> Unit snaps back to 5m air.

---

## Reference Specs

### 1. From `docs/specs/SPHERICAL_GRAVITY.md` (Already Implemented Pattern)

**The Strategy: "Zero Global, Manual Local"**
Instead of hacking the engine, we use its standard API in a specific way:
1.  **Initialize World with Zero Gravity:** Tell Rapier there is *no* global gravity.
2.  **Apply Force Per Tick:** In the physics loop, iterate over every dynamic body, calculate the direction to `(0,0,0)`, and push it.

**Implementation Reference (server/PhysicsWorld.js):**
```javascript
_applySphericalGravity() {
    const G = this.gravityMagnitude; // 9.81
    if (G <= 0) return;
    this._world.bodies.forEach((body) => {
        if (!body.isDynamic()) return;
        const pos = body.translation();
        // Direction to center = -position (normalized)
        const lenSq = pos.x * pos.x + pos.y * pos.y + pos.z * pos.z;
        if (lenSq < 1e-6) return;
        const len = Math.sqrt(lenSq);
        const mass = body.mass();       
        const forceMagnitude = G * mass; // F=ma
        body.addForce({
            x: (-pos.x / len) * forceMagnitude,
            y: (-pos.y / len) * forceMagnitude,
            z: (-pos.z / len) * forceMagnitude
        }, true);
    });
}
```

### 2. From `docs/specs/HYBRID_PHYSICS_MASTER.md`

**3.4. Lifecycle (Életciklus) és "Lazy Physics"**
A "Double Spawn" és "Exploding Spawn" hibák elkerülése végett:
• A kliens soha nem hoz létre (spawn) egységet saját hatáskörben.
• **Lazy Initialization:** A szerver a spawn pillanatában **NEM** hoz létre Rapier RigidBody-t.
    ◦ Az egységek "lebegő" (floating) állapotban jönnek létre, tisztán matematikai pozícionálással (pl. 5 méterrel a felszín felett).
    ◦ A RigidBody és a Collider csak akkor jön létre, amikor a fizika **aktiválódik** (első esemény vagy manuális trigger).
• Ez biztosítja, hogy a betöltéskor/spawn-kor véletlenül se lógjon bele a collider a terepbe, elkerülve az azonnali "kirepülést" (Space Launch).

---

## Critical Refinements (Apply these strictly)

**1. No Immediate Snap-to-Ground on Enable**
*   **Problem:** If enabling physics sets `altitude=0` and triggers a "snap to terrain" logic within the same frame *before* the physics step, the unit might be teleported inside the terrain, causing an explosion.
*   **Requirement:**
    *   Initialize the RigidBody at the unit's **current floating transform** (e.g., 5m Air).
    *   Do **NOT** run `_reprojectToTerrain()` or similar snapping logic in the same tick that physics is enabled.
    *   Let Rapier's gravity pull the unit down naturally ("Drop Test").

**2. Clean Cleanup on Disable**
*   **Problem:** Leaving tailored colliders or handles behind causes memory leaks or ghost collisions.
*   **Requirement:**
    *   Ensure `this.physics.removeBody(unit.rigidBody)` fully removes the body **AND** its attached colliders/joints.
    *   Clean up `this._bodyToUnit` map.
    *   **Only then** reset `unit.altitude = 5.0` and `velocity = {0,0,0}`.

**3. Fix Debug Lines**
*   **Task:** The Blue (Forward) and Yellow (Velocity) debug lines currently stick to the spawn position.
*   **Requirement:** Ensure these lines update every frame in `PhysicsDebugOverlay` (or wherever they are drawn) to follow the unit's **current interpolated position**, especially during the drop test.

*   Verify that `PhysicsWorld.js` gravity application (`_applySphericalGravity`) correctly pushes towards `(0,0,0)`. The Drop Test is invalid if gravity is wrong.

---

## Coding Style & Safety

**Minimal Invasiveness**
*   Keep the original file-level edits (Room.js eager init removal, rollover guards in Room.js & HeadlessUnit.js, tests updated).
*   Implement the enabling toggle in a way that is minimally invasive to existing logic.
*   **Leave brief comments** explaining the gating (float vs physics-enabled) to prevent future regressions.

**Optional Tuning**
*   Consider enabling CCD (Continuous Collision Detection) for fast-moving bodies **only if** you still see tunneling during the drop test. This is an optional optimization.
