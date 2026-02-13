# PHYSICS GAMEPLAY SLICE: BEST PRACTICES (Rapier)

**Status:** REFERENCE
**Date:** 2026-02-13
**Scope:** Phase 3 Step 5/6 (Gameplay Events)

## 1. Executive Summary
1.  **Kinematics Don't Roll:** Rapier Kinematic bodies ignore forces/gravity. We MUST manually switch them to `DYNAMIC` state to simulate rollover or knockback.
2.  **Explicit Gravity:** The moment a unit enters `DYNAMIC`, we must ensure gravity is applied (via `SimCore` global gravity or helper).
3.  **Sensor vs. Event:** Use **Sensors** for Mines/Triggers (cheaper, no solver noise). Use **Collision Events** for Unit-Rock/Unit-Unit interactions.
4.  **Impulse Safety:** Explosions must clamp distance to avoid `NaN` (singularity at r=0). Always add an "Up" component to prevent ground-friction sticking.
5.  **Determinism:** WASM is robust, but `Math.random` is forbidden. Use a seeded PRNG for "random" scatter.
6.  **Terrain Patching:** When a unit becomes Dynamic, it might tunnel through the floor if the TerrainCollider isn't patched in that chunk. Ensure `Room.js` checks dynamic bounds.

## 2. Architecture & Ownership
| Feature | Owner Module | Responsibility |
| :--- | :--- | :--- |
| **Rollover Logic** | `SimCore/Physics/HybridLifecycle.js` | Detecting slope angle > 45°. Switching KIN -> DYN. |
| **Explosion Math** | `SimCore/Services/PhysicsEventService.js` | Calculating falloff vectors. Clamping values. |
| **Mine Triggers** | `SimCore/Entities/Mine.js` (Future) | Owning the Sensor Collider. Emitting 'Explode' event to Room. |
| **Orchestrator** | `Room.js` | Routing events: Mine -> Room -> EventService -> Unit. |

## 3. Implementation Patterns (Do/Don't)

### A. Slope Rollover (The "Tumble" Effect)
*   **DO:** Cast a ray downwards (or check collision normal) every tick.
    *   If `angle > 45deg`: Call `enterDynamic(pushVector)`.
    *   `pushVector` should be `downSlope * 2.0` to initiate movement.
*   **DON'T:** Try to simulate sliding while keeping the body Kinematic (too complex, mimics KCC). Let Rapier solve the tumble.

### B. Explosions & Impulses
*   **DO (Formula):**
    ```javascript
    // Linear Falloff
    let dist = vec3.dist(origin, bodyPos);
    let factor = Math.max(0, 1.0 - (dist / radius));
    let dir = vec3.normalize(bodyPos - origin); 
    if (dist < 0.001) dir = vec3.UP; // Singularity Guard
    let impulse = dir * strength * factor;
    impulse.y += strength * 0.2; // The "Pop"
    unit.enterDynamic(impulse); 
    ```
*   **DON'T:** Apply impulse to a Kinematic body. It does nothing. You MUST switch state first.

### C. Collisions (Kinematic-Kinematic)
*   **Problem:** Rapier K-K collisions generate no forces and sometimes silence events.
*   **Solution:**
    *   **Option 1 (Cheap):** Use `ActiveEvents.COLLISION_EVENTS`. If `Unit A` hits `Unit B`:
        *   Calculate overlap.
        *   If `overlap > threshold`, switch BOTH to `DYNAMIC`.
    *   **Option 2 (Robust):** Give units a slightly larger "Sensor" ghost. Detecting ghost overlap warns of proximity.

## 4. Determinism & Safety Checklist
*   [ ] **No Math.random():** If debris needs random spread, use `((unitId * 17) % 100) / 100.0`.
*   [ ] **NaN Guards:** `isFinite(impulse.x)` check before application.
*   [ ] **Order of Operations:** Iterate units by `ID` (sorted), not by `Set` iterator order (which varies in JS).
*   [ ] **Sub-steps:** If units tunnel, increase Rapier timestep precision (set `maxSubsteps: 2` or `4`).

## 5. Terrain Validation (Test Strategy)
*   **Goal:** Ensure 45° slopes exist for testing.
*   **Method:**
    *   In `TerrainColliderManager.test.js`, inject a "Test Ramp" using a manual heightmap modifier.
    *   Create a "steepness probe": `getGradientAt(x, z)`. Assert `gradient > 1.0` (45 deg) at specific coordinates.
*   **Invalidation:** If terrain deforms under a Dynamic unit, `Room.js` must enable `forceUpdate` on that chunk immediately.

## 6. Sources
*   [Rapier JS Docs - RigidBody](https://rapier.rs/docs/user_guides/javascript/rigid_bodies)
*   [Rapier Determinism](https://rapier.rs/docs/user_guides/javascript/determinism)
*   [Game Physics - Explosion Implementation](https://www.iforce2d.net/b2dtut/explosions) (Box2D concepts apply)
