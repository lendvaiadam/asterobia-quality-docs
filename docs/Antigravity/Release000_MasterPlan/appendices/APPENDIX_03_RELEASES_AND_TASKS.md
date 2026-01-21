# APPENDIX 03: RELEASES, SPRINTS & PR PLAN

**Parent Document:** [Big Picture Master Plan](../BIG_PICTURE_MASTER_PLAN_v1_ANTIGRAVITY.md)
**Scope:** Detailed Work Breakdown Structure (WBS) for Phase 0 and Phase 1.

---

## 1. Development Process & Cadence

### 1.1 Sprint Strategy
*   **Cadence:** **1 Sprint = 1 Week** (Flexible for Worker Pool).
*   **Goal:** Each Sprint must end with a **Deployable Snapshot** (even if features are hidden).
*   **Release vs Sprint:** Releases are Milestones. They can happen mid-sprint.

### 1.2 The "PR Shim" Rule
*   Do not break `Game.js` in one giant PR.
*   **Pattern:**
    1.  Write new `SimCore` module.
    2.  Unit Test it.
    3.  Create a "Shim" in `Game.js` to route data to it.
    4.  Verify functionality.
    5.  **Merge**.
    6.  (Later) Remove the old code.

---

## 2. Phase 0: Netcode Readiness (Est. 5 Sprints)

### Release 001: The Heartbeat (Fixed Timestep)
*Reference: `NETCODE_PREFLIGHT.md` / `Loop.js`*
- **PR 1.1: SimCore/Loop**: Implement `Accumulator` loop logic. (Pure JS).
- **PR 1.2: Game Shim**: Update `Game.animate()` to feed `clock.getDelta()` into `SimCore.accumulate()`.
- **PR 1.3: Visual Interp**: Modify `Unit.js` slightly to accept `alpha` (interpolation factor).
    *   *Test:* Throttle Chrome CPU -> Logic stays 20Hz, FPS drops.

### Release 002: Command Queue
*Reference: `GRFDTRDPU_SYSTEM` Appendix A*
- **PR 2.1: Command Types**: Define `MoveCommand`, `StopCommand` schemas.
- **PR 2.2: Input Factory**: Create `InputFactory.js`. Mouse clicks -> `Command` objects.
- **PR 2.3: Queue Consumer**: SimCore processes queue before `step()`.
- **PR 2.4: Unit Refactor**: Break `unit.setTarget()` into `unit.processCommand(cmd)`.

### Release 003: Deterministic IDs
- **PR 3.1: Sequential IDs**: Remove `Date.now()`. Use `sim.nextId++`.
- **PR 3.2: Map Gen**: Ensure Map entities spawn in stable order.

### Release 004: Seeded RNG
- **PR 4.1: Mulberry32**: Import/Write 32-bit PRNG.
- **PR 4.2: Global Seed**: Store seed in `SimState`.
- **PR 4.3: Injection**: Replace `Math.random` in `Unit.js` logic with `sim.rng()`.

### Release 005: State Surface Partition
*Reference: `quality/STATE_SURFACE_MAP.md`*
- **PR 5.1: State Tree**: Create `StateRegistry` to hold the "Master JSON".
- **PR 5.2: Unit State Extract**: Move properties (`hp`, `pos`) from Unit object to State Registry. Unit object becomes a "View Proxy".
- **PR 5.3: Serialize**: Implement `SimCore.toJSON()`.

### Release 006: Local Transport
- **PR 6.1: ITransport**: Interface definition.
- **PR 6.2: LocalLoopback**: Memory-buffer implementation.
- **PR 6.3: Transport Injection**: SimCore uses `transport.send()` instead of direct queue push.

---

## 3. Phase 1: Canonical Features (Est. 8 Sprints)

### Release 011: LOCOMOTION (Move Roll)
- **PR 11.1: Physics Engine**: Implement Sphere-rolling logic in SimCore.
- **PR 11.2: Terrain Constraints**: Implement Slope/Water checking.
- **PR 11.3: Inertia**: Add Mass/Accel stats.
- **PR 11.4: View Sync**: Update Three.js mesh to follow Rolling physics output.

### Release 012: PERCEPTION (Optical)
- **PR 12.1: VisionSystem v2**: Rewrite `VisionSystem` to use `ownerId` filtering.
- **PR 12.2: MaxSources Cap**: Implement priority sorting (Distance + Intensity).
- **PR 12.3: FOW Integration**: Feed filtered visible set to FOW Shader.

### Release 013: MINING (Tool Lane)
- **PR 13.1: Matera Deposit**: Create World Entity `Deposit`.
- **PR 13.2: Drill Action**: Implement `DrillCommand`.
- **PR 13.3: Surface Piles**: Logic to spawn `Pile` entities.

### Release 014: TRANSPORT (Hauling)
- **PR 14.1: Cargo State**: Add `cargo` field to Unit State.
- **PR 14.2: Pickup/Drop**: Helper logic for interacting with Piles/Bases.
- **PR 14.3: Weight Penalty**: Slow down unit based on `cargo.mass`.

### Release 015: COMBAT (Basic)
- **PR 15.1: Weapon Lane**: Add parallel command processing.
- **PR 15.2: Projectiles**: Spawn deterministic projectile entities.
- **PR 15.3: Damage**: HP reduction logic.

---

## 4. Phase 2: Online Multiplayer (Est. 4 Sprints)

### Release 020: Supabase Signaling
- **PR 20.1**: Schema Migration (Lobbies table).
- **PR 20.2**: Host Signaling Logic (Create Lobby).
- **PR 20.3**: Client Signaling Logic (Join Lobby).

### Release 021: P2P Transport
- **PR 21.1**: PeerJS Integration.
- **PR 21.2**: `WebRTCTransport` implements `ITransport`.
- **PR 21.3**: STUN/TURN Config.

---

## 5. Summary Schedule
| SPRINT | FOCUS | DELIVERABLE |
| :--- | :--- | :--- |
| **S1** | Loop & Commands | Release 001-002 |
| **S2** | Determinism | Release 003-004 |
| **S3** | State Architecture | Release 005 |
| **S4** | Transport Layer | Release 006 |
| **S5** | Feature Framework | Release 010 (Prep) |
| **S6** | Move Roll | Release 011 |
| **S7** | Perception | Release 012 |
| **S8** | Mining | Release 013 |
| **S9** | Transport | Release 014 |
| **S10** | Combat | Release 015 |

---
*End of Appendix 03*
