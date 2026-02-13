# PHYSICS EVENTS & IMPULSE AUDIT (Phase 3 Step 5)

**Status:** REFERENCE (Binding for Implementation)
**Auditor:** Antigravity
**Date:** 2026-02-13

## 1. Architectural Strategy
**Rule:** `Room.js` is the Orchestrator, NOT the Logic Container.

*   **Logic Location:** `src/SimCore/server/PhysicsEventService.js` (NEW).
    *   **Responsibility:** Pure logic for calculating impulses, filtering targets, and applying forces.
    *   **Input:** `PhysicsWorld`, `Unit[]`, `EventParams` (pos, radius, strength).
    *   **Output:** State mutations on Units (enterDynamic) + Physics Body applications.
*   **Delegation:** `Room.js` imports `PhysicsEventService` and calls methods like `applyExplosion()` or `applyDirectionalImpulse()`.
*   **Separation:** Do NOT put explosion math inside `HeadlessUnit` or `Room`. Keep it functional and testable.

## 2. Deterministic Impulse Model
**Rule:** NO `Math.random`. NO Floating Point non-determinism (strict order).

### A. Radial Falloff (Explosions)
*   **Formula:** Linear or Quadratic falloff, but **CLAMPED**.
    ```javascript
    // Example (Conceptual)
    const dist = distance(center, unitPos);
    if (dist > radius) return 0;
    const factor = 1.0 - (dist / radius); // Linear 1.0 -> 0.0
    const impulseMag = strength * factor;
    ```
*   **Zero-Distance Singularity:**
    *   **Risk:** `normalize(vector(0,0,0))` -> `NaN`.
    *   **Fix:** If `dist < epsilon`, use a **Deterministic Fallback Axis**.
    *   **Fallback:** `Vector3(0, 1, 0)` (Up) OR `Vector3(hash(unitId), 1, hash(unitId))` to scatter them distinctly. NEVER random.

### B. Caps & Safety
*   **Max Impulse:** Clamp magnitude to `50.0 m/s` (Sanity check to prevent tunneling).
*   **Max Radius:** Clamp radius to `50.0 m`.
*   **Max Targets:** Limit affected units to `32` nearest (Spatial Grid query or bound).

## 3. NaN/Infinity Hardening (Rapier Safety)
**Rule:** `NaN` poisons the simulation. Fail fast.

### Checklist (Must implementation)
1.  [ ] **Input Sanitization:** Check `params.center`, `params.strength` for `isFinite()`.
2.  [ ] **Vector Normalization Guard:**
    ```javascript
    if (lengthSq < EPSILON) {
        dir = UP; // Safe default
    } else {
        dir = normalize(dir);
    }
    ```
3.  [ ] **Output Clamping:** Ensure final impulse vector components are finite and within bounds before calling `body.applyImpulse()`.

## 4. Test Strategy
**Rule:** Prove safety without enabling full physics.

1.  **Determinism Test:** Call `applyExplosion(seedParams)` 10 times. Assert `unit.position` and `unit.velocity` are IDENTICAL bit-for-bit.
2.  **Regression:** Run with `enablePhysics: false`. Assert NO crashes, NO state changes (events should no-op safely).
3.  **Singularity Test:** Spawn unit exactly at `{0, 0, 0}`. Trigger explosion at `{0, 0, 0}`. Assert unit flies UP (or stable axis), NOT `NaN`.
4.  **Do Not Disturb:** Ensure units outside radius satisfy `velocity == {0,0,0}` and `mode == KINEMATIC`.

## 5. Integration Pitfalls
*   **JIT Patches:** If an explosion pushes a unit into a new terrain chunk, `TerrainColliderManager` MUST generate the patch *before* the unit tunnels through.
    *   *Mitigation:* The existing `ensurePatchesAround` in `Room._onSimTick` should handle this, provided `enterDynamic` sets the unit to active.
*   **Event Storms:** If `enterDynamic` triggers a collision which triggers another impulse...
    *   *Mitigation:* Impulses usually push units *away*. Collisions happen later. Ensure `COLLISION_COOLDOWN` (Step 4) is respected.
*   **Settle Thrashing:** High impulses might make units bounce forever.
    *   *Mitigation:* Ensure `SETTLE_VELOCITY_THRESHOLD` is high enough to allow stopping.

## 6. Antigravity Review Checklist (For PR)
*   [ ] Does `PhysicsEventService.js` exist?
*   [ ] Are `NaN` checks explicit in the impulse math?
*   [ ] Is `enablePhysics: false` handling explicitly tested?
*   [ ] Are caps (max force, max radius) defined as constants?
*   [ ] Is there a test case for `distance == 0`?
