# RAPIER INTEGRATION AUDIT & PRE-FLIGHT CHECK
**Phase 3: Hybrid Physics / Dynamic Events**

**Date:** 2026-02-13
**Target:** `work/r013-phase3-rapier-audit`
**Based on:** `HEAD` (aa42272)

---

## 1. Codebase Map: The "Blast Radius"
The following modules will require direct modification to support Rapier.

### A. Primary Targets (Server Core)
| Module | Current Role | Phase 3 Change | Risk Level |
|---|---|---|---|
| **`server/Room.js`** | Orchestrates SimLoop (20Hz). | **Must initialize `Rapier.World`.** Needs `physicsWorld.step()` in `_onSimTick`. Likely needs **sub-stepping** (3x20Hz = 60Hz physics tick) for stability. | **HIGH** |
| **`server/HeadlessUnit.js`** | Kinematic math state. | Adds `this.rigidBody` (Rapier handle). Logic to sync `Kinematic -> RigidBody` (Grounded) and `RigidBody -> Unit` (Dynamic). | **HIGH** |
| **`server/ServerTerrain.js`** | Pure Math Height/Normal. | Needs to generate **Collider Geometry** (Trimesh/Heightfield) for Rapier. Cannot rely on math functions for physics engine. | **HIGH** |

### B. Secondary Targets (Shared/Glue)
| Module | Current Role | Phase 3 Change | Risk Level |
|---|---|---|---|
| `package.json` | Dependencies. | Add `@dimforge/rapier3d-compat`. | Low |
| `src/SimCore/runtime/IdGenerator.js` | Entity IDs. | No change, but IDs must map to RigidBody `userData` for lookup. | Low |
| `server/GameServer.js` | Input routing. | No logic change, but needs to handle new Physics Debug commands (optional). | Low |

---

## 2. Best Practices: Rapier on Authoritative Server

### A. Library Choice & Setup
*   **Package:** Use `@dimforge/rapier3d-compat`.
    *   *Why:* WASM-based (fast), deterministic (mostly), compatible with Node.js and Browser (shared logic potential).
*   **Initialization:** Requires `await RAPIER.init()`.
    *   *Constraint:* Server startup must become async or wait for init before accepting `createRoom`.

### B. Timestep & Sub-stepping
*   **Current SimLoop:** 20 Hz (50ms).
*   **Rapier Ideal:** 60 Hz (16.6ms).
*   **Strategy:** **Sub-stepping**.
    *   In `Room._onSimTick(dt)` (50ms), call `world.step()` **3 times**.
    *   This ensures stable stacking and collisions while keeping netcode tick low (20Hz).

### C. Terrain Collision Strategy (The Hard Part)
*   **Problem:** The planet is a sphere with noise. Rapier has no "Spherical Heightfield".
*   **Solution 1 (Global):** Mesh the entire planet? **NO.** Too much memory.
*   **Solution 2 (Local Patch - RECOMMENDED):**
    *   Generate `Trimesh` colliders *only* for chunks near active "Dynamic" units.
    *   For "Grounded" units (95%), no collider is needed (Math handles it).
    *   When an event (Explosion) occurs:
        1.  Generate/Cache Terrain Collider patch (r=50m).
        2.  Wake up units.
        3.  Simulate.
    *   Simulate.
        4.  Sleep/Destroy collider when units stabilize.

### E. Deformable Terrain (Phase 3+ Requirement)
*   **Spec:** [TERRAIN_DEFORMATION.md](../specs/TERRAIN_DEFORMATION.md)
*   **Implication:** We MUST support **Dynamic Regeneration** of Static Terrain Colliders.
*   **Strategy:** When `TERRAIN_EDIT` occurs, invalidate the local Chunk's collider. Regenerate it (asynchronously if possible) and swap it in for the next physics tick.
*   **Constraint:** Do NOT act on deformation instantly in the same tick if it causes a lag spike. Queue the update.

### D. The Hybrid Switch (State Machine)
*   **Kinematic (Default):**
    *   Rapier Body Type: `KinematicPositionBased`.
    *   Sync: `Unit.position` -> `RigidBody.setTranslation`.
    *   Wait for event.
*   **Dynamic (Active):**
    *   Rapier Body Type: `Dynamic`.
    *   Sync: `RigidBody.translation()` -> `Unit.position`.
    *   Forces: Gravity (applied manually per tick towards center).

---

## 3. Phase 3 Proposed Implementation Plan

### Step 1: Foundation (Hello World)
*   [ ] Add `@dimforge/rapier3d-compat`.
*   [ ] Update `GameServer` to await `RAPIER.init()`.
*   [ ] Add `physicsWorld` to `Room.js`.
*   [ ] Create a "Floor" (Static Plane) and a "Ball" (Dynamic Unit) in a test room.
*   [ ] Verify the Ball falls.

### Step 2: Spherical Gravity & Terrain
*   [ ] Remove Static Plane.
*   [ ] Implement `ServerTerrain.generateCollider(center, radius)` -> Trimesh.
*   [ ] Implement `HeadlessUnit.applyGravity()`: force vector = `normalize(0 - pos) * 9.81 * mass`.
*   [ ] Verify unit rests on procedural terrain surface.

### Step 3: Hybrid Lifecycle
*   [ ] Add `HeadlessUnit.setDynamic(true/false)`.
*   [ ] Hook `Room._onSimTick`:
    *   Move Kinematic bodies (Path-Follow).
    *   Step Physics (Sub-step 3x).
    *   Sync Dynamic bodies back to Unit state.

### Step 4: Event Triggers
*   [ ] `Collision`: Detect "Kinematic Unit hits Dynamic Unit".
*   [ ] `Blast`: Apply `impulse` to RigidBody.

---

## 4. Risks & Security

### A. Determinism
*   **Risk:** WASM floating point can vary slightly between OS/Arch (Float consistency).
*   **Impact:** Replays might diverge over long sessions.
*   **Mitigation:** Accept "Eventual Consistency". Server is Authority. Clients snap to Snapshot. We do NOT simulate physics on client for netcode units (Mirror Mode mandated by Phase 2A).

### B. Performance (Scaling)
*   **Limit:** 300-500 RigidBodies max on Node.js single thread (conservative).
*   **Bottleneck:** Trimesh generation for terrain.
*   **Mitigation:** Cache terrain colliders aggressively. Only physics-enable units involved in events. " Sleeping" bodies don't cost CPU.

### C. Security
*   **DoS:** Physics explosion (spawn 1000 bodies close together).
*   **Defense:** Cap max Dynamic bodies per room. Cap `AngularVelocity` / `LinearVelocity` to prevent NaN/Infinity glitches.

---

## 5. Summary & Recommendation

1.  **Go with Rapier WASM.**
2.  **Use Sub-stepping (20Hz Net / 60Hz Phys).**
3.  **Strict Mirror Mode:** Client never runs Rapier for network units. Visuals only.
4.  **Just-in-Time Terrain:** Don't mesh the whole world. Mesh where the action is.
