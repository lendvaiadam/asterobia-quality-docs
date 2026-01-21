# MASTER DEVELOPMENT PLAN v1 (ANTIGRAVITY)

> **Status**: DRAFT
> **Date**: 2026-01-21
> **Author**: Antigravity
> **Objective**: Define the roadmap to "Netcode Readiness" (Phase 0) via Host-Authoritative Architecture.

---

## 1. PROOF-OF-READ (Source Verification)

I certify that I have read the following canonical documents before constructing this plan:

### **Core Workflow & Rules**
- [x] `docs/START_HERE.md`
- [x] `docs/STATUS_WALKTHROUGH.md`
- [x] `docs/PLANNING_PROTOCOL.md` (Implementation Gates)
- [x] `docs/IMPLEMENTATION_GATES.md`
- [x] `docs/WORKER_POOL_RUNBOOK.md`
- [x] `docs/CANONICAL_SOURCES_INDEX.md`

### **Architecture & Quality Audits**
- [x] `spec_sources/ASTEROBIA_CANONICAL_MASTER_BIBLE_2026-01-13.md`
- [x] `spec_sources/ASTEROBIA_CANONICAL_GRFDTRDPU_SYSTEM_2026-01-13.md`
- [x] `spec_sources/ASTEROBIA_CANONICAL_REFACTOR_PROCESS_2026-01-13.md`
- [x] `quality/NETCODE_READINESS_AUDIT.md`
- [x] `quality/STATE_SURFACE_MAP.md`
- [x] `quality/MULTIPLAYER_TARGET_CHOICE.md` (Host-Authoritative decision)
- [x] `KNOWN_RISK_AREAS.md` (Unit.js Monolith, Game.js God Object)

### **Feature Specifications**
- [x] `spec_sources/ASTEROBIA_CANONICAL_FEATURE_MOVE_ROLL_2026-01-13.md`
- [x] `spec_sources/ASTEROBIA_CANONICAL_FEATURE_WPN_SHOOT_2026-01-13.md`
- [x] `spec_sources/ASTEROBIA_CANONICAL_FEATURE_PERCEPTION_OPTICAL_VISION_2026-01-13.md`
- [x] `spec_sources/ASTEROBIA_CANONICAL_FEATURE_PERCEPTION_SUBSURFACE_SCAN_2026-01-13.md`
- [x] `spec_sources/ASTEROBIA_CANONICAL_FEATURE_MATERA_MINING_2026-01-13.md`
- [x] `spec_sources/ASTEROBIA_CANONICAL_FEATURE_MATERA_TRANSPORT_2026-01-13.md`
- [x] `spec_sources/ASTEROBIA_CANONICAL_FEATURE_TERRAIN_SHAPING_2026-01-13.md`
- [x] `spec_sources/ASTEROBIA_CANONICAL_FEATURE_UNIT_CARRIER_2026-01-13.md`
- [x] `spec_sources/VISION_MAX_SOURCES_SPEC.md`
- [x] `spec_sources/VISION_FOW_REFACTOR_AUDIT.md`
- [x] `spec_sources/VISION_FOW_SYSTEM_AUDIT.md`

### **Missing / Not Found**
- [ ] `docs/KB-INDEX.md` (Referenced in known risks, but file is missing from repo)

---

## 2. TARGET DEFINITION: "NETCODE READINESS"

**Goal:** Transform the prototype into a **Host-Authoritative** system where game logic is deterministic, headless-capable, and completely decoupled from rendering.

**Concrete Success Criteria:**
1.  **Strict State Separation:**
    *   **SimCore (Authoritative):** Contains ALL gameplay data (Position, Health, Inventory, Cooldowns). NO visual types (Three.js, Meshes, Textures).
    *   **World (Render):** Pure view layer. Reads SimCore state to update meshes. NO game logic.
2.  **Deterministic Loop:**
    *   Logic updates at fixed timestep (e.g., 20Hz or 30Hz).
    *   No `Date.now()`, `Math.random()`, or `requestAnimationFrame` delta times in SimCore.
    *   Input via **Command Queue** only.
3.  **Headless Capability:** `SimCore` can run in a Node.js worker without a window/DOM.
4.  **Serialization:** Full game state can be snapshotted to JSON and restored identically.

**The "Phase 0" Gate:**
We are NOT building the multiplayer server yet. We are building the **Single-Player Local Host** architecture that *allows* multiplayer to be added later by simply moving SimCore to a server.

---

## 3. FEATURE ROADMAP (GRFDTRDPU EVOLUTION)

We follow the **G-R-F-Tr-D-P-U** pipeline. Most features are currently in **F (Functional)** or **Tr (Training/Refinement)** but technologically debt-ridden. We must retro-fit them to the new architecture.

| Feature | Current State | Target State | Refactor Priority |
| :--- | :--- | :--- | :--- |
| **SimLoop** | `Game.js` (Coupled) | `SimCore/GameLoop.js` (Fixed Step) | **CRITICAL (Blocking)** |
| **Unit State** | `Unit.js` (Monolith) | `SimCore/Entities/UnitState.js` | **CRITICAL** |
| **Movement** | `Unit.js` update() | `SimCore/Systems/MoveSystem.js` | **HIGH** |
| **Input** | `InteractionManager` | `SimCore/Input/CommandQueue.js` | **HIGH** |
| **Vision** | `VisionSystem` + `FogOfWar` | `SimCore/Perception` (Logic) vs `World/VisionRenderer` | **MEDIUM** |
| **Mining** | `Unit.js` logic | `SimCore/Systems/MiningSystem.js` | **MEDIUM** |
| **Terrain** | `Planet.js` | `SimCore/World/TerrainState.js` | **LOW** (Static for now) |

---

## 4. ARCHITECTURE: SIMCORE vs WORLD

### **4.1 The Boundary (Invariant)**
*   **src/SimCore/**: The "Host".
    *   Dependencies: `gl-matrix` (or similar math lib), `seeded-random`.
    *   Forbidden: `three.js`, `DOM`, `window`, `document`.
*   **src/World/** & **src/Entities/** (View): The "Client".
    *   Dependencies: `three.js`, `SimCore`.
    *   role: Interpolate and Render state from SimCore.

### **4.2 Data Flow**
1.  **Input:** User clicks -> `CommandGenerator` -> `CommandQueue` (SimCore).
2.  **Tick:** `GameLoop` processes Queue -> `SimSystems` update `Accessors` (State).
3.  **Output:** `RenderLoop` (rAF) reads `Accessors` -> Updates `Three.js Meshes`.

### **4.3 The "Adapter" Pattern**
We will implement **View Adapters** to bridge the gap during migration.
*   `UnitAdapter.js`: Owns the `THREE.Mesh`. Reads `UnitState` (Position, Rotation) every frame and updates the mesh.

---

## 5. PERSISTENCE & MULTIPLAYER STRATEGY

### **5.1 Persistence (Save/Load)**
*   **Mechanism:** `SimCore` root object must support `serialize()` returning a JSON string.
*   **Content:**
    *   `Tick`: Current turn number.
    *   `Seed`: PRNG state.
    *   `Entities`: List of all unit IDs and their data components.
    *   `TerrainDiffs`: Any changes to the base terrain.
*   **Validation:** `load(saveData)` must restore exact state.

### **5.2 Multiplayer (Host-Authoritative)**
*   **Phase 0 Strategy:** Local Loopback.
    *   Input is wrapped in "Network Packets" locally to simulate latency (optional) and enforce API strictness.
    *   We do not need WebSockets for Phase 0, but the *interface* must behave as if it were remote.

---

## 6. RELEASE SCHEDULE (001 - 010)

**Cadence:** 1 Release per ~2-3 days (Flexible). Sequence is strict.

*   **REL-001: The Kernel**
    *   **Goal:** Establish `src/SimCore`, `InputQueue`, and `FixedTimestepLoop`.
    *   **Deliverable:** A moving cube controlled by commands in a deterministic loop (headless capable). No legacy code migration yet.

*   **REL-002: Unit State Extraction**
    *   **Goal:** Break `Unit.js` dependency on logic.
    *   **Deliverable:** `UnitState` in SimCore. `Unit.js` becomes a dumb view.

*   **REL-003: Movement System Migration**
    *   **Goal:** Move `pathFollowing` logic to SimCore.
    *   **Deliverable:** Units move deterministically. Sync checks pass.

*   **REL-004: Command Pipeline & Selection**
    *   **Goal:** Formalize `InteractionManager` -> `CommandQueue`.
    *   **Deliverable:** Multi-unit selection and command issuing via formal protocol.

*   **REL-005: Perception Split (Vision)**
    *   **Goal:** Separate `VisionSystem` (Logic) from `FogOfWar` (Render).
    *   **Deliverable:** CPU-side distinct vision source list.

*   **REL-006: Terrain & Physics Stub**
    *   **Goal:** Abstract terrain height queries.
    *   **Deliverable:** SimCore can query height without accessing `Planet.mesh`.

*   **REL-007: Gameplay Features I (Mining/Transport)**
    *   **Goal:** Port Mining logic.
    *   **Deliverable:** Resource collection via Command Queue.

*   **REL-008: Gameplay Features II (Combat/Shooting)**
    *   **Goal:** Port Shooting logic (stub).
    *   **Deliverable:** Firing events generated by SimCore, visualized by World.

*   **REL-009: Persistence & Determinism Verification**
    *   **Goal:** Save/Load and Replay.
    *   **Deliverable:** `save()` -> Reload -> Game continues identically.

*   **REL-010: Phase 0 Gold Master (Netcode Ready)**
    *   **Goal:** Full Regression Test.
    *   **Deliverable:** All tests pass. Ready for "Phase 1: Networking".

---

## 7. WORKER POOL PLAN

We have 5 parallel Workers (Claude instances). We will use them to parallelize **non-conflicting** migrations.

### **Parallelization Strategy**
*   **Controller (Antigravity/Ádám):** Merges PRs, handles "The Kernel" (Core Architecture).
*   **Workers:** Assigned specific "Systems" or "Modules".

### **Example Assignment (Mid-Phase)**
*   **Worker 1 (Core):** Working on `SimCore/GameLoop` and Infrastructure.
*   **Worker 2 (Unit A):** Migrating `MoveSystem`.
*   **Worker 3 (Unit B):** Migrating `MiningSystem`.
*   **Worker 4 (Vision):** Migrating `PerceptionSystem`.
*   **Worker 5 (Tests/Docs):** Writing Acceptance Tests and updating Spec docs.

### **Conflict Avoidance**
*   Strict file ownership rules.
*   Worker 2 touches `MoveSystem.js`; Worker 3 touches `MiningSystem.js`.
*   Shared types must be defined in `Core` (Worker 1) first, or mocked until merge.

---

**Next Steps via `STATUS_WALKTHROUGH.md`:**
1.  Review this plan.
2.  Harmonize with Claude's Independent Plan.
3.  Create consolidated `MASTER_DEVELOPMENT_PLAN_FINAL.md`.
4.  Begin RELEASE-001.
