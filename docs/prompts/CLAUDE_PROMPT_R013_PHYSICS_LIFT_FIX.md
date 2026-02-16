# CLAUDE CODE TASK: Implement "Lift Before Solid" Physics Fix (Option 1)

**Context:**
We are experiencing "space launch" bugs where units spawn inside the terrain and get ejected by the physics engine.
**Decision:** We rejected "Lazy Rigid Body" (Float). We chose **Option 1: Lift Before Solid**.

## Goal (Binding)
When switching a unit from KINEMATIC (sensor) to DYNAMIC (solid) mode (in `enterDynamic` or similar transitions):
1.  **Calculate Safe Position:** Compute a position that guarantees the collider does not overlap the terrain.
    *   `safeR = terrainR + colliderRadius + EPSILON` (e.g., EPS ~ 0.05).
2.  **Lift FIRST:** Move the rigid body to this safe position *before* enabling the solid collider or dynamic mode.
3.  **Then Switch:** Only after lifting, switch the body to DYNAMIC and the collider to Solid.
4.  **Drop Test:** Implement a `DROP_TEST` dev command that places a unit high up and lets it fall, to verify this logic without baseline changes.

## Critical Implementation Details

### 1. Correctness of `getRadiusAt`
*   **WARNING:** Do **NOT** pass the normalized `up` vector to `terrain.getRadiusAt()`.
*   **CORRECT:** Pass `unit.position` (or the full world position vector).
    *   `up` is a direction (length 1). Passing it acts like querying the radius at the planet core (r=1), which returns garbage/noise.
    *   `unit.position` is a location on the surface (length ~60). This returns the correct local terrain radius.
*   **Rule:** `const terrainR = this.terrain.getRadiusAt(unit.position);`

### 2. Implementation Steps (Scope: Increment 1 only)
*   **Target:** `server/HeadlessUnit.js` (or wherever `enterDynamic` lives).
*   **Logic:**
    ```javascript
    // Pseudo-code for enterDynamic
    const up = Vec3.normalize(this.position);
    const terrainR = this.terrain.getRadiusAt(this.position); // USE POSITION, NOT UP
    const safeR = terrainR + this.colliderRadius + 0.1; // Lift clearance

    // Apply lift immediately
    const liftedPos = Vec3.scale(up, safeR);
    this.rigidBody.setTranslation(liftedPos, true);
    this.position = liftedPos;

    // Now switch state
    this.rigidBody.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    // ... enable solid collider ...
    ```

### 3. Dev Command: `DROP_TEST`
*   Implement `CMD_ADMIN` -> `DROP_TEST` in `server/Room.js`.
*   Logic:
    1.  Select unit.
    2.  Teleport to `safeR` (e.g., 5-10m height).
    3.  Enable Physics (enterDynamic).
    4.  Verify it falls via gravity and lands on the mesh without penetrating/ejecting.

## Guardrails
*   **No Baseline Changes:** Do NOT change the default spawn behavior or kinematic movement. This is a fix for *transitions* to dynamic.
*   **Determinism:** Do not use random numbers. Use fixed epsilon.
*   **Collider Shape:** Ensure DYNAMIC mode uses a **Box** (Cuboid) collider, not a Sphere, if that was part of the previous discussion. (Check `HeadlessUnit` implementation).

## Deliverable
*   Update `HeadlessUnit.js` with the "Lift before Solid" logic.
*   Implement `DROP_TEST` command.
*   Verify with HU-Test (UI).
