# CLAUDE CODE REBOOT: R013 Physics & Sync Fix

**Project:** Asterobia (Space RTS)
**Current Phase:** Release 013 - Phase 3: Physics & Netcode Reconciliation.
**Goal:** Fix "Space Launch" bugs (units spawning inside terrain and ejecting) and verify proper physics transitions.

---

## 1. Where We Are (Context)
*   We use a **Hybrid Physics** model:
    *   **Kinematic:** Default movement (math-driven, adhering to terrain).
    *   **Dynamic:** Events (collision, drops) use Rapier physics.
*   **The Problem:** When switching from Kinematic -> Dynamic, units often clip into the terrain and get "launched" into space by the physics engine.
*   **The Strategy:** We decided on **"Option 1: Lift Before Solid"**.
    *   Before enabling the solid collider, we calculate a safe altitude (`radius + collider + epsilon`) and teleport the RigidBody there.

## 2. Immediate Crisis: Visual Desync
We implemented the "Lift" logic on the server, but the client visualizes the unit stuck on the ground.
**We have DIAGNOSED this:**
*   The server correctly lifts the unit and flags it `_serverDriven`.
*   The client's **Render Loop** (`Game.js` -> `Unit.js:applyInterpolatedRender`) blindly interpolates between old snapshots (ground level) and ignores the server's authoritative lift.
*   This visual glitch creates the illusion that the physics fix failed.

## 3. Your Mission (The To-Do List)
You are a senior engineer. You have no previous memory of this session. Here is your job:

### Step 1: Fix the Client Visualization (Priority High)
*   **File:** `src/Entities/Unit.js` (method `applyInterpolatedRender`) OR `src/Core/Game.js` (call site).
*   **Task:** Identify if a unit is `_serverDriven` (or significantly desynced/teleported).
*   **Action:** If `_serverDriven`, **SKIP** interpolation. Force `this.mesh.position` to match `this.position` (the authoritative server value).
*   *Why:* This ensures we see the unit where the server actually put it (10m up).

### Step 2: Verify the "Lift Before Solid" Logic
*   **File:** `server/HeadlessUnit.js` (method `enterDynamic` or similar).
*   **Task:** Ensure the "Lift" logic is robust.
    *   **CRITICAL:** When calling `terrain.getRadiusAt(pos)`, pass the **World Position** (`this.position`), NOT the normalized `up` vector. (Passing `up` returns garbage radius -> crash/bug).
*   **File:** `server/Room.js`.
*   **Task:** Ensure `CMD_ADMIN` -> `DROP_TEST` command exists to trigger this flow for testing.

## 4. Key Files & Resources
*   **Specs:** `docs/specs/HYBRID_PHYSICS_MASTER.md` (The Bible).
*   **Server Physics:** `server/HeadlessUnit.js`, `server/PhysicsWorld.js`.
*   **Client Visuals:** `src/Core/Game.js`, `src/Entities/Unit.js`.
*   **Admin Commands:** `server/Room.js`.

## 5. Constraints
*   **Do NOT change baseline movement:** Kinematic movement is fine. Only touch the transitions (Kinematic <-> Dynamic).
*   **Do NOT use `up` for `getRadiusAt`:** Always use `position`.
*   **Output:** Show code diffs for the Visual Fix first.

**Command:** Acknowledge this context and propose the code change for `src/Entities/Unit.js` (or Game.js) to fix the interpolation bug.
