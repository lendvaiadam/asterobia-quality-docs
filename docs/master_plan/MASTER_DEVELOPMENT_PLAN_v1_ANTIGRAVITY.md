# MASTER DEVELOPMENT PLAN v1 (ANTIGRAVITY)

**Author:** Antigravity (Gemini)
**Date:** 2026-01-21
**Status:** DRAFT (Release 000 Candidate)
**Scope:** Full Project End-to-End Architecture & Roadmap

---

## PROOF-OF-READ (Source Integrity)
**I verify that I have read the following sources before drafting this plan:**

**Core Documentation:**
- `docs/START_HERE.md`
- `docs/STATUS_WALKTHROUGH.md`
- `docs/PLANNING_PROTOCOL.md`
- `docs/IMPLEMENTATION_GATES.md`
- `docs/CANONICAL_SOURCES_INDEX.md`
- `docs/CURRENT_SYSTEM_SPEC.md`

**Quality & Audits:**
- `quality/NETCODE_READINESS_AUDIT.md` (Verdict: NOT READY)
- `quality/STATE_SURFACE_MAP.md`
- `quality/MULTIPLAYER_TARGET_CHOICE.md` (Target: Host-Authoritative)
- `quality/archive/NETCODE_PREFLIGHT.md`
- `quality/archive/REPO_REALITY_MAP.md`

**Canonical Specifications (Snapshot 2026-01-14):**
- `ASTEROBIA_CANONICAL_MASTER_BIBLE_2026-01-13.md`
- `ASTEROBIA_CANONICAL_GRFDTRDPU_SYSTEM_2026-01-13.md`
- `ASTEROBIA_CANONICAL_REFACTOR_PROCESS_2026-01-13.md`
- All Feature Specs including `UNIT_DESIGNER` (v2026-01-18), `MOVE_ROLL`, `WPN_SHOOT`, etc.

---

## 1. EXECUTIVE SUMMARY

**The Goal:** Transition Asterobia from a "Client-Side Prototype" into a **Host-Authoritative, Deterministic Engine** capable of multiplayer, replay, and robust persistence.

**The Shift:**
- **From:** `Game.js` (God Class) running logic at propertities of `requestAnimationFrame` (60Hz+).
- **To:** `SimCore` running logic at a fixed **20Hz**, utilizing discrete `Command` objects, with `WebeGL` rendering simply interpolating between state snapshots.

**Phase 0 Mandate:** We do not build new features until the "Netcode Kernel" is proven. All future features (Mining, Combat) must be built *into* this new kernel, not added to the legacy `Unit.js`.

---

## 2. ENGINEERING ARCHITECTURE

### 2.1 The "Wall" (Sim vs World)
We enforce a strict separation of concerns.

| Layer | Frequency | Responsibility | Access Rules |
| :--- | :--- | :--- | :--- |
| **SimCore** | **20 Hz** (Fixed) | Truth, Physics, Logic, State. | **Write:** Commands only. **Read:** Own State. |
| **World** | **FPS** (Variable) | Interpolation, Visuals, Audio. | **Read:** Sim Snapshots. **No Writes.** |
| **UI** | **DOM** (Event) | Inputs, overlay. | **Write:** Emits Commands. |

### 2.2 Directory Structure
```text
src/
├── SimCore/                      # THE AUTHORITY
│   ├── runtime/                  # The Execution Environment
│   │   ├── Loop.js               # Fixed-Timestep Accumulator
│   │   ├── Store.js              # The "Database" (Entities, Terrain)
│   │   ├── EventBus.js           # Sim-Internal Events
│   │   └── Random.js             # Seeded PRNG
│   ├── transport/                # The I/O Layer
│   │   ├── CommandQueue.js       # Input Buffer
│   │   └── ITransport.js         # Network Abstraction
│   └── features/                 # LOGIC MODULES (Pure Functions preferred)
│       ├── MoveRoll.js           # Rolling Physics
│       ├── WpnShoot.js           # Combat Logic
│       └── MateraMining.js       # Resource Logic
├── World/                        # THE RENDERER
│   ├── shim/                     # Adapter (Game.js hooks)
│   ├── systems/                  # Three.js Systems
│   │   ├── RenderLoop.js         # Interpolator
│   │   └── FogRenderer.js        # Visual-only Fog
│   └── input/                    # Interaction
│       └── InputCapture.js       # Mouse -> Command
└── UI/                           # THE INTERFACE
```

---

## 3. FEATURE ROADMAP (Phased Execution)

### 🟡 Phase 0: NETCODE KERNEL (The Foundation)
**Focus:** Refactoring the existing movement/gameplay into the new `SimCore` pattern. No new gameplay mechanics.

*   **Release 001: The Heartbeat**
    *   Objective: Decouple Physics from Render Loop.
    *   Deliverable: `SimCore` running at 20Hz. `Game.js` rendering interpolated state.
*   **Release 002: Command Shim**
    *   Objective: Remove direct state mutation.
    *   Deliverable: `Input.js` emits `MoveCommand`. `SimCore` processes it.
*   **Release 003: Deterministic IDs**
    *   Objective: Replay stability.
    *   Deliverable: `Sim.nextId` replaces `Date.now()`.
*   **Release 004: Seeded RNG**
    *   Objective: Map generation stability.
    *   Deliverable: `Sim.rng` replaces `Math.random()`.
*   **Release 005: State Export**
    *   Objective: Save/Load readiness.
    *   Deliverable: `serializeState()` returns full JSON truth.
*   **Release 006: Local Transport**
    *   Objective: Network readiness proof.
    *   Deliverable: `LoopbackTransport` passes commands via delay/serialization.

### 🟢 Phase 1: THE ACTION LAYER
**Focus:** Implementing the core "Action" lanes (`TOOL`, `WEAPON`) in the new architecture.

*   **R-101: Terrain Shaping**
    *   Impl: `features/TerrainShaping.js` (Tool Lane).
    *   Tech: Keyframed Target Profile algorithm.
*   **R-102: Mining & Transport**
    *   Impl: `features/MateraMining.js` + `Cargo.js`.
    *   Tech: Resource inventory state.
*   **R-103: Optical Vision (Fog)**
    *   Impl: `World/services/FogRenderer.js`.
    *   Tech: GPU-based FOW driven by Sim unit positions.
*   **R-104: Weapon Shooting**
    *   Impl: `features/WpnShoot.js` (Weapon Lane).
    *   Tech: Projectile logic (hitscan or deterministic ballistics).

### 🔵 Phase 2: THE META LOOP
**Focus:** The "Game" around the mechanics.

*   **R-201: Unit Designer**
    *   Impl: `UI/panels/Designer`.
    *   Tech: `TypeBlueprint` generation and validation (20-100% allocations).
*   **R-202: Production**
    *   Impl: `features/Production.js`.
    *   Tech: Spawning instances from Blueprints using Resources.

### 🟣 Phase 3: CONNECTIVITY
**Focus:** Multiplayer.

*   **R-301: Serialization Pipeline**
    *   Impl: Compression / Delta updates.
*   **R-302: Host-Client Handshake**
    *   Impl: WebRTC via PeerJS (or Supabase).
    *   Mode: Host-Authoritative (One player is the Server).

---

## 4. NETCODE STRATEGY

### 4.1 Determinism Rules
1.  **Fixed Tick:** Logic ONLY updates on accum += dt.
2.  **Seeded Random:** NEVER use `Math.random()`. Use `sim.rng.float()`.
3.  **Order of Execution:**
    *   Apply Inputs (Commands).
    *   Run Feature Systems (Move -> Tool -> Weapon).
    *   Resolve Collisions.
    *   Emit Events.
4.  **Floating Point:** Accept JS `number` (float64) risks for Phase 0. If desyncs occur, switch to fixed-point libraries (Risk Register Item).

### 4.2 State Surface (Snapshot)
The Authoritative State (`serializeState()`) must contain:
```json
{
  "tick": 1204,
  "seed": 993842,
  "nextId": 55,
  "entities": [
    {
      "id": 1,
      "type": "MORDIG10",
      "pos": { "x": 10.2, "y": 0, "z": 5.5 },
      "vel": { "x": 0.1, "y": 0, "z": 0 },
      "queue": [ { "type": "MOVE", "target": "..." } ]
    }
  ],
  "terrainMods": []
}
```
**Excluded:** Meshes, Textures, Sounds, Particles.

---

## 5. QUALITY ASSURANCE & GATES

### 5.1 Verification Gates
Every PR in Phase 0 must pass:
1.  **Preflight Check:** `node scripts/netcode_preflight.js` (No forbidden tokens).
2.  **Determinism Test:**
    *   Run Sim A and Sim B with Seed `12345`.
    *   Feed identical Commands.
    *   Assert `JSON.stringify(SimA.state) === JSON.stringify(SimB.state)` after 1000 ticks.

### 5.2 Risk Register
| Risk | Probability | Impact | Mitigation |
| :--- | :--- | :--- | :--- |
| **Float Desync** | Med | High | Use `Math.fround` or switch to fixed-point math lib if verifying cross-browser. |
| **Legacy Drag** | High | Med | `Unit.js` is sticky. Extract aggressively; do not coexist longer than needed. |
| **Render Lag** | High | Low | Interpolation adds ~50ms delay. Acceptable for RTS/Strategy. |
| **Missing Spec** | Low | High | `UNIT_DESIGNER` was missing but recovered. Monitor for others. |

---

## 6. WORK PACKAGE ORCHESTRATION (5-Worker Pool)

**Parallelization Strategy:**

*   **Worker 1 (ARCHITECT):** `SimCore` Infrastructure (Loop, Transport, Store).
    *   *Focus:* Releases 001, 002, 006.
*   **Worker 2 (PHYSICS):** `MOVE_ROLL` Feature Extraction.
    *   *Focus:* Migrating `Unit.js` physics logic to pure functions.
*   **Worker 3 (RENDER):** `World` / Visual Shim.
    *   *Focus:* Updating `Game.js` to read Snapshots.
*   **Worker 4 (INPUT):** `InputCapture` & Command Generation.
    *   *Focus:* Converting UI clicks to JSON Commands.
*   **Worker 5 (QUALITY):** Test Harness & Audits.
    *   *Focus:* Writing the Determinism Test Runner.

---

## 7. BLOCKING QUESTIONS (Decisions Needed)
1.  **Tick Rate:** 20Hz is proposed. Is this fast enough for "Rolling" physics feel? (Recommendation: Start 20Hz, easy to increase to 30Hz if needed).
2.  **Legacy Types:** Can we bypass the `UNIT_DESIGNER` requirement for Phase 0 and use hardcoded `UnitType` definitions? (Recommendation: YES).
3.  **Shim Strategy:** Should we refactor `Game.js` in-place (Shim inside) or create `GameCore.js` (Parallel)? (Recommendation: In-place Shim to keep "Play" button working).

---
