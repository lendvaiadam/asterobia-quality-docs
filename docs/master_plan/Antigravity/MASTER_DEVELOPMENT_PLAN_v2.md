# ASTEROBIA — MASTER DEVELOPMENT PLAN (v2)
**Date:** 2026-01-20
**Status:** IMPLEMENTATION_READY
**Author:** Antigravity (Gemini)
**Target Branch:** `work/release-000-master-plan-antigravity-v2`
**Objective:** Phase 0 Netcode Readiness & Phase 1 Core Feature Implementation

---

## Table of Contents
1. [Definition of Done & Read Gate](#1-definition-of-done--read-gate)
2. [Executive Summary](#2-executive-summary)
3. [Current State Analysis (The Reality)](#3-current-state-analysis-the-reality)
4. [Target Architecture (Host-Authoritative)](#4-target-architecture-host-authoritative)
5. [Feature Roadmap](#5-feature-roadmap)
6. [Work Breakdown Structure (PR-by-PR Plan)](#6-work-breakdown-structure-pr-by-pr-plan)
7. [Testing & Quality Assurance](#7-testing--quality-assurance)
8. [Risk Register & Mitigation](#8-risk-register--mitigation)
9. [Open Decisions](#9-open-decisions)
10. [Appendices](#10-appendices)

---

## 1. Definition of Done & Read Gate

This Master Plan conforms to the **Release 000** requirements set forth in `docs/STATUS_WALKTHROUGH.md` and `docs/master_plan/README.md`.

### 1.1 Read Gate Compliance
I have verified the existence and content of the Canonical Sources.
- **Proof of Read:** [Appendices/PROOF_OF_READ_GATE.md](./appendices/PROOF_OF_READ_GATE.md)
- **Tracked MD Index:** [Appendices/MD_FILE_INDEX.txt](./appendices/MD_FILE_INDEX.txt)
- **Missing Documentation:** `docs/KB-INDEX.md` is confirmed missing. `UNIT_DESIGNER` spec is only present in snapshot folder (`publish/...`).

### 1.2 Done Means For This Plan
- [x] **Comprehensive Scope:** Covers Architecture, Multiplayer, Persistence, Roadmaps, WBS, Testing, Risks.
- [x] **Implementation Grade:** Detailed enough for Claude Code to execute without "interpreting" high-level fuzziness.
- [x] **Canonical Alignment:** Strictly follows `MASTER_BIBLE` and `GRFDTRDPU_SYSTEM`.
- [x] **Format:** Detailed Markdown, no broken links, accurate references.

---

## 2. Executive Summary

Asterobia is transitioning from a prototyping/exploration phase to a stable, multiplayer-ready foundation (**Phase 0: Netcode Readiness**). The current codebase is Client-Authoritative, coupled to the render loop, and uses non-deterministic logic. This plan details the rigorous refactoring required to implement a **Host-Authoritative, Fixed-Timestep, Deterministic** engine ("SimCore") that drives the game state, while the "View" (Three.js) merely interpolates that state.

Upon completion of Phase 0, the project will immediately proceed to **Phase 1**, implementing the canonical feature set (Movement, Perception, Mining, Transport) atop this robust new kernel.

---

## 3. Current State Analysis (The Reality)

Based on `quality/NETCODE_READINESS_AUDIT.md` and `quality/REPO_REALITY_MAP.md`, the current codebase is **NOT READY** for multiplayer.

### 3.1 Critical Deficiencies
| Component | Status | Issue |
| :--- | :--- | :--- |
| **Game Loop** | coupled | `Game.js` drives logic inside `requestAnimationFrame`. Logic speed depends on FPS. |
| **Determinism** | FAILED | Use of `Date.now()`, `Math.random()`, and `performance.now()` in logic. |
| **Authority** | MIXED | `Unit.js` is a hybrid God Class containing logic, state, and rendering mesh references. |
| **Inputs** | DIRECT | `Input.js` directly calls methods like `unit.setTarget()`, bypassing any command queue. |
| **State** | OPAQUE | No clear serialization boundary; state is "whatever is on the object". |

### 3.2 Assets (Good News)
- **SimCore Structure:** A skeleton `src/SimCore` exists (`Store.js`, `EventBus.js`).
- **Feature Registry:** Concepts exist but need unification.
- **Visuals:** Three.js rendering and terrain systems are robust and can be "wrapped" as View consumers.

---

## 4. Target Architecture (Host-Authoritative)

**Canonical Reference:** `quality/MULTIPLAYER_TARGET_CHOICE.md` and `GRFDTRDPU` Appendix A.

### 4.1 The Stack
1.  **Transport Layer (ITransport)**:
    -   Abstracts P2P/Server communication.
    -   **Phase 0:** Implement `LocalLoopbackTransport` (tab-to-tab or in-memory) to enforce decoupling immediately.
2.  **SimCore (The Kernel)**:
    -   **Tick Loop:** Runs at strict 20Hz (50ms).
    -   **State Store:** `SimState` (Current Tick, Entities, Random Seed).
    -   **Input:** Consumes `CommandQueue` (commands from Transport).
    -   **Output:** Emits `StateSnapshot` (serialized JSON/binary) or delta.
3.  **The View (Game.js / Three.js)**:
    -   **Loop:** Runs at Monitor Hz (VSync).
    -   **Role:** Read-Only consumer of `SimState`.
    -   **Interpolation:** Smooths movement between Tick N and Tick N+1.
    -   **Input:** Captures mouse/keyboard -> sends `Command` to Transport. **NEVER mutates SimState directly.**

### 4.2 Data Flow
`User Input` -> `Command Factory` -> `Transport.send()` -> `Host (SimCore)` -> `CommandQueue` -> `SimCore.step()` -> `State Update` -> `Transport.broadcast()` -> `View.sync()`

---

## 5. Feature Roadmap

### Phase 0: Netcode Readiness (The Foundation)
*Refactoring the engine to support the features.*
-   **Release 001:** Fixed Timestep Loop & State Separation.
-   **Release 002:** Command Pattern & Input Queue.
-   **Release 003:** Deterministic IDs & Seeded RNG.
-   **Release 004:** State Surface Export (Serialization).
-   **Release 005:** Feature-First Refactor (Unit.js breakup).

### Phase 1: Canonical Feature Implementation
*Implementing the behavior defined in Spec Sources.*
-   **Release 006:** `MOVE_ROLL` (Locomotion Lane).
-   **Release 007:** `PERCEPTION` (Optical Vision + Fow Service).
-   **Release 008:** `SUB_SCAN` (Subsurface Scan + Matera Discovery).
-   **Release 009:** `MATERA_MINING` & `TRANSPORT` (Tool & Hauling).
-   **Release 010:** `TERRAIN_SHAPING` (Tool Lane).

---

## 6. Work Breakdown Structure (PR-by-PR Plan)

**Constraint:** Each Release is a sequence of small, verifiable Pull Requests. Do not merge broken code to `dev`.

### 🚀 Release 001: The Heartbeat (Fixed Timestep)
*Goal: Decouple logic from rendering.*
-   **PR 1.1: SimCore Loop:** Create `SimCore/runtime/Loop.js`. Implement Accumulator pattern (fixed dt=50ms). Verify ticking independent of render.
-   **PR 1.2: Game.js Bridge:** Mod Game.js to instantiate SimCore. In `animate()`, feed `delta` to `SimCore.update(dt)`. Remove logic from `animate()`.
-   **PR 1.3: Unit Shim:** Refactor `Unit.update()` to accept `isSimTick` flag. Only advance physics when `isSimTick=true`.
-   **Verify:** Game runs at variable FPS, but unit speed is constant/correct.

### 🚀 Release 002: The Command Gate
*Goal: Inputs become data.*
-   **PR 2.1: Command Objects:** Define `src/SimCore/commands/CommandFactory.js`. Schema: `{ tick, type, payload, issuer }`.
-   **PR 2.2: InputShim:** Modify `Input.js`. Instead of `unit.setTarget()`, create `CMD_MOVE`. Push to `SimCore.queue`.
-   **PR 2.3: SimCore Consumer:** In `SimCore.step()`, process queue. Route commands to Units.
-   **Verify:** Clicking triggers move. Console logs "Processing Tick X, Cmd Y".

### 🚀 Release 003: Determinism (IDs & RNG)
*Goal: Identical output for identical input.*
-   **PR 3.1: Seeded RNG:** Implement `SimCore/runtime/SeededRNG.js` (Mulberry32). Replace `Math.random` in Sim logic.
-   **PR 3.2: Deterministic IDs:** Replace `Date.now()` IDs with `Sim.nextId++`. Ensure entity creation order is stable.
-   **Verify:** Two reloaded tabs produce identical Unit IDs and random rocks.

### 🚀 Release 004: State Surface
*Goal: Snapshot capability.*
-   **PR 4.1: State Registry:** Create `SimCore/runtime/StateRegistry.js`.
-   **PR 4.2: Unit State Extraction:** Move properties `pos`, `vel`, `hp`, `queue` from `Unit.js` to `UnitState` (POJO). `Unit.js` becomes a View wrapper reading `UnitState`.
-   **PR 4.3: Snapshot:** Implement `SimCore.getSnapshot()`. Returns full JSON of Registry.
-   **Verify:** `console.log(JSON.stringify(getSnapshot()))` works and contains no circular refs or Three.js objects.

### 🚀 Release 005: Perception (Feature Refactor)
*Goal: Implement Canonical Perception.*
-   **PR 5.1: PerceptionFeature Module:** Create `src/features/perception/PerceptionFeature.js`. Implement spec math (Allocation to Range).
-   **PR 5.2: Ownership Filter:** Update `VisionSystem.js` to filter sources by `ownerId`.
-   **PR 5.3: Stable Sort:** Fix `VisionSystem` sorting to be deterministic (ID tie-breaker).
-   **Verify:** Player only sees their own FOW clearing.

### 🚀 Release 006: Locomotion (MOVE_ROLL)
*Goal: Physics-based rolling with inertia.*
-   **PR 6.1: Feature Shell:** `src/features/movement/MoveRoll.js`. Register in FeatureRegistry.
-   **PR 6.2: Physics:** Implement inertia, acceleration, braking (from Spec).
-   **PR 6.3: Timeline Lane:** Hook into `LOCOMOTION` lane in CommandQueue.
-   **Verify:** Unit accelerates/brakes relative to mass/slope.

---

## 7. Testing & Quality Assurance

### 7.1 Automated Smoke Tests (Manual for Phase 0)
With every PR, run:
1.  **Boot Test:** Does the game load without error?
2.  **Move Test:** Can I select a unit and move it?
3.  **Command Log:** Do I see commands in the console (Release 002+)?
4.  **FPS Independence:** Throttle CPU (DevTools) -> does Unit speed stay constant?

### 7.2 Determinism Verification (Release 003+)
1.  Open two tabs.
2.  Seed them identically.
3.  Refresh both.
4.  Check if Rock placement and Unit IDs match exactly.

### 7.3 Unit Tests (Jest)
*Constraint: Only test pure functions in SimCore.*
-   Command Serialization/Deserialization.
-   RNG Sequence consistency.
-   Allocation Math (Perception range calculation).

---

## 8. Risk Register & Mitigation

**Risk 1: Performance of JS Fixed Tick**
-   *Impact:* Spiral of death if `SimCore.step` takes > 10ms.
-   *Mitigation:* Profiling `SimCore`. strictly limit logic per tick. `VisionSystem` runs throttled (e.g. every 5 ticks).

**Risk 2: Three.js coupling in Unit.js**
-   *Impact:* Hard to extract state.
-   *Mitigation:* Gradual refactor. PR 4.2 is the hardest step. We will accept "Hybrid" state for Release 001-003, then strict split in 004.

**Risk 3: Feature Complexity (G-R-F-Tr-D-P-U)**
-   *Impact:* Over-engineering.
-   *Mitigation:* Implement STUBS first. e.g. `Allocation` is just a number `0.5` hardcoded until `SYS_DESIGN` is built.

---

## 9. Open Decisions

1.  **Physics Engine:** Are we keeping custom physics in `Unit.js` or moving to a library (Cannon/Rapier)?
    -   *Recommendation:* Keep custom for `MOVE_ROLL` (sphere surface logic is unique). Refactor into `SimCore/physics/MomentumSolver.js`.
2.  **Target Frame Rate:** Is SimCore 20Hz (50ms) or 30Hz (33ms)?
    -   *Decision:* **20Hz** (from Mailbox/Notes). Better for network bandwidth.
3.  **Persistence format:** Binary or JSON?
    -   *Decision:* **JSON** for Phase 0 (Debuggability). Optimize later.

---

## 10. Appendices

*   [Detailed file list of Markdown docs tracked](./appendices/MD_FILE_INDEX.txt)
*   [Proof of Read Gate](./appendices/PROOF_OF_READ_GATE.md)
