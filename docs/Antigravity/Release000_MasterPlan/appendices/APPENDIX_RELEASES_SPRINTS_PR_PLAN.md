# APPENDIX E: RELEASES, SPRINTS & PR PLAN (v3)

**Parent Document:** [Big Picture Master Plan v3](../BIG_PICTURE_MASTER_PLAN_v1_ANTIGRAVITY.md)
**Scope:** Detailed Work Breakdown Structure (WBS) with PR-level granularity.

---

## 1. Execution Strategy

We do not just "code". We execute **Atomic Pull Requests**.
*   **Rule:** 1 PR = 1 Feature or 1 Fix.
*   **Rule:** Every PR must include Unit Tests.
*   **Rule:** Every PR must pass the "Smoke Test" (Appendix F).

---

## 2. Phase 0: Netcode Foundation (Weeks 1-5)

**Objective:** A reliable 20Hz Loop sending deterministic state between two browser tabs.

### Sprint 1: The Heartbeat
*   **Goal:** `SimCore` running in isolation.
*   **PR 1.0 (Scaffold):** Create `src/sim/SimCore.js`, `SimLoop.js`, `StateRegistry.js`.
    *   *Test:* `SimLoop` accumulates time correctly (e.g. 1000ms real time = 20 ticks).
*   **PR 1.1 (Loop Integration):** Hook `SimLoop` into `Game.animate()`.
    *   *Test:* Console logs "TICK 1... TICK 2..." while `Game.js` renders 60fps.

### Sprint 2: The Command Chain
*   **Goal:** Inputs travel via Queue, not direct execution.
*   **PR 2.0 (Types):** Define `Command` interfaces in `types/Net.ts`.
*   **PR 2.1 (Factory):** Create `CommandFactory.js`.
    *   *Impl:* `onMouseClick -> createMoveCommand(target)`.
*   **PR 2.2 (Consumer):** Implement `SimCore.processInputs()`.
    *   *Test:* Push fake command -> Verify Entity position changes after tick.

### Sprint 3: Deterministic Data
*   **Goal:** Remove all non-deterministic factors.
*   **PR 3.0 (RNG):** Replace `Math.random` with `Mulberry32`.
    *   *Test:* Run Sim twice with Seed 12345. Output states must be `JSON.stringify` identical.
*   **PR 3.1 (IDs):** Replace `Date.now()` with `sim.nextId++`.

### Sprint 4: The Transport (Local)
*   **Goal:** Two SimCores talking.
*   **PR 4.0 (Interface):** Define `ITransport`.
*   **PR 4.1 (Loopback):** Implement `LocalLoopbackTransport`.
*   **PR 4.2 (Dual Sim):** Modify `Main.js` to optionally spawn 2 SimCores (Host/Client) for debug.
*   **PR 4.3 (Sync):** Verify Command Sent on A executes on B.

### Sprint 5: State Serialization
*   **Goal:** Snapshots.
*   **PR 5.0 (Partitions):** Separate `GameState` from `RenderState`.
*   **PR 5.1 (Snapshot):** Implement `sim.createSnapshot()`.
*   **PR 5.2 (Hydrate):** Implement `sim.loadSnapshot()`.
    *   *Test:* Save -> Load -> Sim continues correctly.

---

## 3. Phase 1: Feature Implementation (Weeks 6-14)

**Objective:** The 7 Features fully implemented.

### Sprint 6: Locomotion (Physics)
*   **PR 6.0:** `LocomotionSystem` framework.
*   **PR 6.1:** Rolling Physics (Torque/Friction logic).
*   **PR 6.2:** Slope Constraints (Dot Product check).

### Sprint 7: Vision (F03)
*   **PR 7.0:** `VisionSystem` (Distance checks).
*   **PR 7.1:** `FOW` Shader upgrade (consume Vision data).

### Sprint 8: Mining & Economy (F05)
*   **PR 8.0:** `MateraDeposit` entity.
*   **PR 8.1:** `MiningSystem` (Tick logic).
*   **PR 8.2:** Resource Inventory logic.

### Sprint 9: Transport (F06)
*   **PR 9.0:** `Cargo` component.
*   **PR 9.1:** Mass penalty logic in Locomotion.

### Sprint 10: Shaping (F07)
*   **PR 10.0:** `TerrainSystem` state (Grid).
*   **PR 10.1:** `Modify` command logic.

### Sprint 11: Combat (F02)
*   **PR 11.0:** `CombatSystem`.
*   **PR 11.1:** `Projectile` entity logic.
*   **PR 11.2:** Damage/HP logic.

### Sprint 12-14: The Pipeline (GRFDTRDPU)
*   **PR 12.0:** `GoalEvaluator` stub.
*   **PR 13.0:** `ResearchManager` (Unlock logic).
*   **PR 14.0:** `Factory` (Production Queue logic).

---
*End of Appendix*
