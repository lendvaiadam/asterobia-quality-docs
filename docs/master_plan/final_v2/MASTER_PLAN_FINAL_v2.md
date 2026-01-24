# ASTEROBIA: MASTER DEVELOPMENT PLAN v2 (FINAL)

**Version:** 2.0.0
**Date:** 2026-01-24
**Status:** READY FOR PLAN REVIEW
**Scope:** Demo 1.0 end-to-end development plan
**Prepared By:** Claude Code (Opus 4.5) + Human Owner (Adam)

---

## Document Hierarchy

This document is the **authoritative development plan** for Asterobia Demo 1.0.

**Precedence (binding):**
1. Canonical spec files in `spec_sources/` (gameplay rules, formulas, constraints)
2. This plan (development approach, releases, architecture decisions)
3. Appendices to this plan (deep technical detail)

**Source:** Reconciled from:
- `sources/Claude/master_plan/` (execution detail, PR structure)
- `sources/Antigravity/Release000_MasterPlan/` (code samples, physics)
- `spec_sources/ASTEROBIA_CANONICAL_*.md` (binding game design)
- Human owner decisions (Q1-Q20 in `final_v2_prep/QUESTIONS_FOR_ADAM.md`)

---

## Table of Contents

### Part I: Foundation
1. [Executive Summary](#1-executive-summary)
2. [Demo 1.0 Done Means (Acceptance Criteria)](#2-demo-10-done-means)
3. [Current State vs Target State](#3-current-state-vs-target-state)

### Part II: Architecture
4. [System Architecture](#4-system-architecture)
5. [SimCore & Determinism](#5-simcore--determinism)
6. [Command Queue Timeline](#6-command-queue-timeline)
7. [Direct Control Integration](#7-direct-control-integration)

### Part III: Features
8. [Feature Roadmap](#8-feature-roadmap)
9. [G-R-F-Tr-D-P-U Pipeline](#9-g-r-f-tr-d-p-u-pipeline)
10. [Core Features (Demo 1.0)](#10-core-features-demo-10)

### Part IV: Multiplayer & Backend
11. [Multiplayer Architecture](#11-multiplayer-architecture)
12. [Backend & Persistence](#12-backend--persistence)
13. [Replay System](#13-replay-system)

### Part V: Execution
14. [Release Plan (Phase 0-2)](#14-release-plan-phase-0-2)
15. [PR Workflow & Gates](#15-pr-workflow--gates)
16. [Testing & CI Strategy](#16-testing--ci-strategy)
17. [Risk Register](#17-risk-register)
18. [Alternatives & Tradeoffs](#18-alternatives--tradeoffs)

### Appendices (Separate Files)
- [Appendix A: Multiplayer Deep Spec](appendices/APPENDIX_A_MULTIPLAYER_DEEP_SPEC.md)
- [Appendix B: Backend & Persistence Deep Spec](appendices/APPENDIX_B_BACKEND_PERSISTENCE_DEEP_SPEC.md)
- [Appendix C: Replay System Spec](appendices/APPENDIX_C_REPLAY_SYSTEM_SPEC.md)
- [Appendix D: GRFDTRDPU Implementation Guide](appendices/APPENDIX_D_GRFDTRDPU_IMPLEMENTATION.md)
- [Appendix E: Feature Dependency Graph](appendices/APPENDIX_E_FEATURE_DEPENDENCY_GRAPH.md)
- [Appendix F: Release/Sprint/PR Breakdown](appendices/APPENDIX_F_RELEASE_SPRINT_PR_PLAN.md)
- [Appendix G: Testing & QA Strategy](appendices/APPENDIX_G_TESTING_QA_STRATEGY.md)
- [Appendix H: Risk Register Detail](appendices/APPENDIX_H_RISK_REGISTER_DETAIL.md)
- [Appendix I: UI/UX Pipeline](appendices/APPENDIX_I_UI_UX_PIPELINE.md)

---

# PART I: FOUNDATION

---

## 1. Executive Summary

Asterobia is an evolutionary RTS on a spherical world where units evolve capabilities through the **G-R-F-Tr-D-P-U** pipeline (Goal → Research → Feature → Training → Design → Production → Unit).

**Demo 1.0 delivers:**
- Single-player core loop (research → design → produce → command → execute)
- 6 required features + 2 stretch features
- Deterministic SimCore with command-log replay
- 2-4 player host-authoritative multiplayer (LAN + internet)
- Save/Load persistence

**Key architectural decisions (binding):**
- **Tick rate:** 20 Hz (50ms timestep)
- **Determinism:** Mulberry32 PRNG, sequential IDs, no Date.now() in logic
- **Transport:** Host-authoritative star topology (host = "server-shaped")
- **UI:** Web Components / Vanilla Custom Elements
- **Refactor:** Shim-based extraction (preserve existing code, extract to SimCore)

**Source:** `spec_sources/ASTEROBIA_CANONICAL_MASTER_BIBLE_2026-01-13.md` (philosophy), Human owner decisions Q1-Q20.

---

## 2. Demo 1.0 Done Means

**Status:** BINDING (per Human Owner Q20)

Demo 1.0 is **DONE** when ALL of the following are verified:

### 2.1 Single-Player Core Loop
| Gate | Verification |
|------|--------------|
| Research works | Can research MOVE_ROLL from Need Card, unlock completes |
| Design works | Can create Type Blueprint with 2+ features, allocations sum to 100% |
| Production works | Can produce unit from blueprint at Central Unit |
| Command Queue works | Can queue movement, see duration estimates, pause/resume unit |
| Movement works | Unit follows path, respects slope bands (0-10/10-40/40-60/>60) |
| Scan works | Subsurface Scan reveals underground Matera deposits |
| Mining works | Mining unit extracts Matera, creates surface pile |
| Transport works | Transport unit collects pile, delivers to base |
| Combat works | WPN_SHOOT damages enemy units, wreck state triggers |

### 2.2 Determinism & Replay
| Gate | Verification |
|------|--------------|
| Determinism | Same seed + same commands → identical state after 1000 ticks |
| Command log | All commands logged with tick number |
| Replay playback | Can replay command log, verify identical end state |

### 2.3 Multiplayer
| Gate | Verification |
|------|--------------|
| LAN connection | 2 players connect via LAN, see each other's units |
| Internet connection | 2 players connect via TURN relay, gameplay synchronized |
| Host authority | All state changes flow through host |
| 4-player support | 4 players can join same session |
| Late join | Player can join in-progress game, receives state sync |

### 2.4 Save/Load
| Gate | Verification |
|------|--------------|
| World snapshot | Terrain, entities, deposits serialized |
| Player state | Research progress, blueprints, command queue saved |
| Load restore | Loading snapshot restores exact game state |

### 2.5 Core Features (6 Required + 2 Stretch)

**Required (MUST ship):**
| Feature | Lane | Done When |
|---------|------|-----------|
| MOVE_ROLL | LOCOMOTION | Unit moves via wheeled locomotion, respects slope physics |
| OPTICAL_VISION | Passive | Unit reveals FOW, vision range scales with allocation |
| SUBSURFACE_SCAN | PERCEPTION | Scan reveals underground deposits within range |
| MATERA_MINING | TOOL | Unit extracts Matera from deposit, creates pile |
| MATERA_TRANSPORT | LOCOMOTION | Unit carries Matera, speed penalty when loaded |
| WPN_SHOOT | WEAPON | Unit damages targets, 4-axis system (Power/Rate/Range/Accuracy) |

**Stretch (SHOULD ship):**
| Feature | Lane | Done When |
|---------|------|-----------|
| TERRAIN_SHAPING | TOOL | Unit modifies terrain height, converges over passes |
| UNIT_CARRIER | LOCOMOTION | Unit transports other units, load/unload mechanics |

### 2.6 CI Baseline Gates
| Gate | Type | Threshold |
|------|------|-----------|
| Determinism smoke | Hard | MUST pass (identical state after replay) |
| Multiplayer sync smoke | Hard | MUST pass (no desync in 5-minute session) |
| Tick time p95 | Soft | < 8ms with 50 units (measure + trend, no block) |
| Test coverage | Soft | SimCore > 80% (measure + trend) |

### 2.7 Minimal Acceptance Tests (Per Gate)

Each Done Means gate has a minimal test that must pass:

```javascript
// 2.1 Single-Player Core Loop
test('research completes and unlocks feature', async () => {
  const sim = createTestSim();
  sim.eventBus.emit('UNIT_STUCK', { unitId: 'central' });
  const job = sim.research.start('MOVE_ROLL', 'central');
  while (job.status !== 'DONE') sim.step();
  expect(sim.features.isUnlocked('MOVE_ROLL')).toBe(true);
});

test('design creates valid blueprint', () => {
  const sim = createTestSim();
  const bp = sim.design.create('central', {
    features: [{ id: 'MOVE_ROLL', allocation: 50 }, { id: 'OPTICAL_VISION', allocation: 50 }]
  });
  expect(bp.allocations.reduce((a,b) => a+b, 0)).toBe(100);
});

test('production creates unit from blueprint', async () => {
  const sim = createTestSim();
  const job = sim.production.build('central', 'type_1');
  while (job.status !== 'DONE') sim.step();
  expect(sim.getUnitsByType('type_1').length).toBe(1);
});

// 2.2 Determinism
test('replay produces identical state', () => {
  const log = recordGame(seed, commands, 1000);
  const result = replayAndVerify(log);
  expect(result.hashMatch).toBe(true);
});

// 2.3 Multiplayer
test('host and client sync after 5 minutes', async () => {
  const { host, client } = await createTestSession();
  await playFor(5 * 60 * 1000); // 5 minutes
  expect(host.getStateHash()).toBe(client.getStateHash());
});

// 2.4 Save/Load
test('save round-trips correctly', () => {
  const sim = createTestSim();
  playFor(1000);
  const saved = sim.serialize();
  const sim2 = new SimCore();
  sim2.deserialize(saved);
  expect(sim2.getStateHash()).toBe(sim.getStateHash());
});
```

**Source:** Human Owner Q20 answer, `spec_sources/ASTEROBIA_CANONICAL_MASTER_BIBLE_2026-01-13.md` Section: Goal/Need → Feature Unlock Mappings.

---

## 3. Current State vs Target State

### 3.1 Current State (As Of 2026-01-24)

| Component | Status | Location | Notes |
|-----------|--------|----------|-------|
| **Unit.js** | Working | `src/Entities/Unit.js` | ~1500 lines, monolithic, contains movement + visuals |
| **Direct Control** | Working | `Unit.js:88-91, 1474-1502` | Keyboard override with path save/resume, 0.5s timeout |
| **Camera** | Working | `src/Camera/SphericalCameraController4.js` | Third-person follow for Direct Control |
| **Path System** | Working | `Unit.js` | Spline-based, waypoint editing exists |
| **FOW** | Partial | `src/World/FogOfWar.js` | GPU-based, needs CPU serialization |
| **Terrain** | Working | `src/World/` | Spherical planet, height displacement |
| **SimCore** | Stub | `src/SimCore/` | Folder exists, minimal implementation |
| **Multiplayer** | None | - | Not implemented |
| **Backend** | None | - | Supabase account exists, no schema |
| **Command Queue UI** | None | - | Data model not implemented |

### 3.2 Target State (Demo 1.0)

| Component | Target | Implementation |
|-----------|--------|----------------|
| **SimCore** | Authoritative | Fixed 20Hz tick, deterministic, all game logic |
| **Unit.js** | Render-only | State extracted to SimCore, Unit.js does interpolation + visuals |
| **Direct Control** | Preserved | Integrated with SimCore command queue (pause queue on DC) |
| **Command Queue** | Full data model | Duration estimates, loop, repeat, pause/resume per unit |
| **Command Queue UI** | Phase 1: Hybrid | List view + simple timeline bar; Phase 2: full AE-style |
| **FOW** | Serializable | CPU-readable explored state for save/load |
| **Multiplayer** | Host-authoritative | Star topology, 2-4 players, WebRTC + TURN |
| **Backend** | Supabase Pro | Auth, snapshots, signaling, RLS |
| **Replay** | Command log | Debug + anti-cheat foundation |

### 3.3 Migration Path

```
CURRENT                          TARGET
─────────────────────────────────────────────────────
Unit.js (monolith)     ──shim──► SimCore (authoritative)
                                      │
                                      ▼
                               Unit.js (render-only)
                                      │
                                      ▼
Direct Control         ──preserve──► DC ←→ SimCore.pause()
                                      │
                                      ▼
FOW (GPU-only)         ──extract──► CPU state + GPU render
                                      │
                                      ▼
Local-only             ──add──────► Transport layer
                                      │
                                      ▼
                               Host-authoritative MP
```

**Source:** Codebase inspection, `sources/Claude/master_plan/MASTER_DEVELOPMENT_PLAN_v1_CLAUDE.md` Section 2 (Current State).

---

# PART II: ARCHITECTURE

---

## 4. System Architecture

### 4.1 Layer Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         PRESENTATION LAYER                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │
│  │   Three.js   │  │  Web Comp.   │  │   Command Queue UI       │   │
│  │   Renderer   │  │     UI       │  │   (List + Timeline)      │   │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬─────────────┘   │
└─────────┼─────────────────┼────────────────────────┼─────────────────┘
          │                 │                        │
          ▼                 ▼                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         APPLICATION LAYER                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │
│  │    Game.js   │  │InputFactory  │  │    DebugOverlay          │   │
│  │   (Shim)     │  │              │  │                          │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────────────────────┘   │
└─────────┼─────────────────┼──────────────────────────────────────────┘
          │                 │
          ▼                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         SIMCORE (AUTHORITATIVE)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │
│  │  GameLoop    │  │ CommandQueue │  │    FeatureRegistry       │   │
│  │  (20 Hz)     │  │              │  │                          │   │
│  ├──────────────┤  ├──────────────┤  ├──────────────────────────┤   │
│  │ StateRegistry│  │CommandProc.  │  │    StatsEngine           │   │
│  ├──────────────┤  ├──────────────┤  ├──────────────────────────┤   │
│  │  IdGenerator │  │  EventBus    │  │    GoalManager           │   │
│  ├──────────────┤  ├──────────────┤  ├──────────────────────────┤   │
│  │  SeededRNG   │  │  Serializer  │  │    ResearchManager       │   │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘   │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    FEATURE MODULES                             │  │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐  │  │
│  │  │MOVE_ROLL│ │OPTICAL_ │ │SUBSURFA│ │MATERA_  │ │WPN_     │  │  │
│  │  │         │ │VISION   │ │CE_SCAN │ │MINING   │ │SHOOT    │  │  │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘  │  │
│  └───────────────────────────────────────────────────────────────┘  │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         TRANSPORT LAYER                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │
│  │ITransport    │  │LocalTransport│  │    WebRTCTransport       │   │
│  │(Interface)   │  │(Single)      │  │    (Multiplayer)         │   │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘   │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         BACKEND (SUPABASE)                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │
│  │     Auth     │  │   Realtime   │  │      Storage             │   │
│  │              │  │  (Signaling) │  │   (Snapshots)            │   │
│  └──────────────┘  └──────────────┘  └──────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 Key Architectural Principles

| Principle | Rule | Rationale |
|-----------|------|-----------|
| **Single Source of Truth** | SimCore owns all authoritative game state | Determinism, multiplayer sync |
| **Render Interpolation** | Presentation layer interpolates between ticks | Smooth visuals at any FPS |
| **Command Pattern** | All input becomes Commands, processed on tick | Replay, networking, undo |
| **Feature Isolation** | Each feature is independent module | Testability, maintainability |
| **Transport Abstraction** | ITransport interface hides network details | Easy local → multiplayer transition |

### 4.3 File Structure (Target)

```
src/
├── SimCore/
│   ├── core/
│   │   ├── GameLoop.js          # 20Hz fixed timestep
│   │   ├── IdGenerator.js       # Sequential deterministic IDs
│   │   ├── PRNG.js              # Mulberry32
│   │   └── TimeSource.js        # Tick counter
│   ├── state/
│   │   ├── StateRegistry.js     # Entity state storage
│   │   ├── EntityState.js       # Per-entity authoritative state
│   │   └── Serializer.js        # Save/load
│   ├── commands/
│   │   ├── CommandTypes.js      # MOVE, STOP, ATTACK, etc.
│   │   ├── CommandQueue.js      # Per-unit queues + lanes
│   │   ├── CommandProcessor.js  # Execute commands on tick
│   │   └── CommandLog.js        # Replay log
│   ├── features/
│   │   ├── FeatureRegistry.js   # Feature availability + base stats
│   │   ├── StatsEngine.js       # Effective stat computation
│   │   └── modules/
│   │       ├── MOVE_ROLL.js
│   │       ├── OPTICAL_VISION.js
│   │       ├── SUBSURFACE_SCAN.js
│   │       ├── MATERA_MINING.js
│   │       ├── MATERA_TRANSPORT.js
│   │       ├── WPN_SHOOT.js
│   │       ├── TERRAIN_SHAPING.js   # Stretch
│   │       └── UNIT_CARRIER.js      # Stretch
│   ├── systems/
│   │   ├── GoalManager.js       # Event → Need card
│   │   ├── ResearchManager.js   # Invent/Extend jobs
│   │   ├── DesignManager.js     # Blueprint storage
│   │   ├── ProductionManager.js # Build/refit queues
│   │   └── TrainingManager.js   # Training outcome slider
│   ├── transport/
│   │   ├── ITransport.js        # Interface
│   │   ├── LocalTransport.js    # Single-player
│   │   └── WebRTCTransport.js   # Multiplayer
│   └── index.js                 # SimCore entry point
├── Core/
│   ├── Game.js                  # Shim: accumulates delta, calls SimCore
│   └── InteractionManager.js    # Input → InputFactory
├── Entities/
│   └── Unit.js                  # Render-only (interpolation + visuals)
├── UI/
│   ├── components/              # Web Components
│   │   ├── command-queue-list.js
│   │   ├── command-queue-timeline.js
│   │   └── ...
│   └── DebugOverlay.js
└── World/
    ├── FogOfWar.js              # GPU render + CPU state
    └── VisionSystem.js          # Source aggregation
```

**Source:** `sources/Claude/master_plan/MASTER_DEVELOPMENT_PLAN_v1_CLAUDE.md` (file structure), adapted per Human Owner Q16 (shim-based).

---

## 5. SimCore & Determinism

### 5.1 Fixed Timestep Loop

```javascript
// src/SimCore/core/GameLoop.js
export class GameLoop {
  constructor(config = {}) {
    this.tickRate = config.tickRate || 20; // Hz
    this.timestep = 1000 / this.tickRate;  // 50ms
    this.accumulator = 0;
    this.tick = 0;
  }

  accumulate(deltaMs) {
    this.accumulator += deltaMs;
    let stepsThisFrame = 0;

    while (this.accumulator >= this.timestep) {
      this.step();
      this.accumulator -= this.timestep;
      stepsThisFrame++;

      // Spiral of death prevention: max 5 steps per frame
      if (stepsThisFrame > 5) {
        this.accumulator = 0;
        console.warn('GameLoop: Dropped frames');
        break;
      }
    }

    return this.accumulator / this.timestep; // Alpha for interpolation
  }

  step() {
    this.tick++;
    // Process commands, update features, emit events
  }
}
```

### 5.2 Determinism Requirements

| Requirement | Implementation | Verification |
|-------------|----------------|--------------|
| **No Math.random()** | Use `SeededRNG.random()` | Grep codebase, CI check |
| **No Date.now() in logic** | Use `simCore.tick` | Grep codebase, CI check |
| **Sequential IDs** | `IdGenerator.next('e')` → `e_0`, `e_1`, ... | Unit test |
| **Fixed iteration order** | Arrays, not Sets/Maps for ordered ops | Code review |
| **Same inputs → same output** | Replay test: 1000 ticks, compare state hash | CI gate |

### 5.3 Determinism Invariants Checklist

**Pre-commit checklist for any SimCore change:**

- [ ] No `Math.random()` calls (use `simCore.rng.random()`)
- [ ] No `Date.now()` or `performance.now()` in game logic (use `simCore.tick`)
- [ ] No `new Date()` in game logic
- [ ] No `crypto.randomUUID()` (use `simCore.idGen.next()`)
- [ ] No `Object.keys()` iteration where order matters (use sorted arrays)
- [ ] No `Set` or `Map` iteration where order matters
- [ ] No floating-point accumulation without bounds (e.g., `+=` in tight loop)
- [ ] No `async/await` in step() path (all sync)
- [ ] State hash unchanged after identical command sequence

**Determinism test (must pass before merge):**
```javascript
// Two SimCore instances, same seed, same commands
const sim1 = new SimCore({ seed: 12345 });
const sim2 = new SimCore({ seed: 12345 });
applyCommands(sim1, commands);
applyCommands(sim2, commands);
for (let i = 0; i < 1000; i++) { sim1.step(); sim2.step(); }
assert(sim1.getStateHash() === sim2.getStateHash());
```

### 5.4 Data Invariants Checklist

**State consistency rules (must hold at all times):**

| Invariant | Rule | Checked By |
|-----------|------|------------|
| Entity ownership | Every entity has exactly one owner (player or neutral) | StateRegistry.validate() |
| ID uniqueness | No two entities share same ID | IdGenerator guarantees |
| Tick monotonicity | `simCore.tick` always increases by 1 | GameLoop enforces |
| RNG state | `simCore.rng.state` updated deterministically | Mulberry32 algorithm |
| Command ordering | Commands processed in tick order, then seq order | CommandQueue.sort() |
| Position bounds | Entity positions within world bounds | Feature modules clamp |
| HP bounds | Entity HP ∈ [0, maxHP] | applyDamage() clamps |
| Allocation sum | Type blueprint allocations sum to 100% | DesignManager validates |

**Snapshot consistency:**
- Serialized state must round-trip perfectly: `serialize(deserialize(s)) === s`
- Hash of loaded state equals hash of saved state

### 5.3 Seeded PRNG (Mulberry32)

```javascript
// src/SimCore/core/PRNG.js
export function createPRNG(seed) {
  let state = seed;
  return function() {
    state |= 0;
    state = state + 0x6D2B79F5 | 0;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
```

**Source:** `sources/Antigravity/Release000_MasterPlan/appendices/APPENDIX_MULTIPLAYER_INTERNET_STACK.md` (Mulberry32 code), `sources/Claude/master_plan/appendices/APPENDIX_E_RELEASES_SPRINTS_PR_PLAN.md` Release 004.

---

## 6. Command Queue Timeline

### 6.1 Data Model (Phase 1 - Demo 1.0)

The Command Queue Timeline is the **canonical scheduling mechanism** for all Action Features.

**Canonical reference:** `spec_sources/ASTEROBIA_CANONICAL_GRFDTRDPU_SYSTEM_2026-01-13.md` Section 8.6

#### 6.1.1 Core Concepts

| Concept | Definition |
|---------|------------|
| **Lane** | Category of actions (LOCOMOTION, PERCEPTION, TOOL, WEAPON) |
| **Clip** | A scheduled action with start tick, estimated duration |
| **Gummy Stretch** | Clip end is estimated; if action runs long, clip stretches |
| **Now Line** | Current tick; clips left of Now are past, right are future |
| **Per-Unit Pause** | Each unit can be paused independently; queue clock freezes |

#### 6.1.2 Lane Taxonomy (Demo 1.0)

| Lane | Features | Exclusivity |
|------|----------|-------------|
| LOCOMOTION | MOVE_ROLL, MATERA_TRANSPORT, UNIT_CARRIER | In-lane mutual exclusion |
| PERCEPTION | SUBSURFACE_SCAN | In-lane mutual exclusion |
| TOOL | MATERA_MINING, TERRAIN_SHAPING | In-lane mutual exclusion |
| WEAPON | WPN_SHOOT | In-lane mutual exclusion |

**Note:** OPTICAL_VISION is passive (always-on, no lane).

#### 6.1.3 Data Structures

```javascript
// Per-unit queue state
{
  unitId: "u_123",
  isPlaying: true,           // false = queue frozen
  loopEnabled: false,        // repeat sequence
  repeatStart: null,         // tick marker
  repeatEnd: null,           // tick marker
  lanes: {
    LOCOMOTION: [
      {
        clipId: "clip_1",
        actionType: "MOVE",
        startTick: 100,
        estimatedDuration: 50,  // ticks
        actualEndTick: null,    // set when complete
        payload: { waypointId: "wp_5" }
      }
    ],
    TOOL: [...],
    WEAPON: [...],
    PERCEPTION: [...]
  }
}
```

### 6.2 UI Strategy (Phased)

Per Human Owner Q4: **Phased approach with "profi alapokkal"** (professional foundations).

| Phase | UI Scope | Data Scope |
|-------|----------|------------|
| **Phase 1 (Demo 1.0)** | Hybrid: stable list + simple timeline bar | Full data model |
| **Phase 2 (Post-Demo)** | Full After Effects-style timeline | Same data model |

**Phase 1 UI Components:**
- `<command-queue-list>`: Ordered list of queued actions per unit
- `<command-queue-bar>`: Simple horizontal bar showing clip positions
- Play/Pause button per unit
- Loop toggle per unit

**Phase 2 UI Components (deferred):**
- Full timeline with drag-to-reorder
- Gummy stretch handles
- Repeat region markers
- Multi-unit view

**Source:** Human Owner Q4 answer, `spec_sources/ASTEROBIA_CANONICAL_GRFDTRDPU_SYSTEM_2026-01-13.md` Section 8.6.

---

## 7. Direct Control Integration

### 7.1 Current Implementation (PRESERVE)

**Status:** WORKING - DO NOT REGRESS

**Location:** `src/Entities/Unit.js` lines 88-91, 1474-1502

**Current behavior:**
```javascript
// Unit.js constructor (lines 88-91)
this.savedPath = null;           // Saved path when keyboard takes over
this.savedPathIndex = 0;         // Where we were on the path
this.keyboardOverrideTimer = 0;  // Time since last keyboard input
this.isKeyboardOverriding = false; // Currently being controlled by keyboard

// Unit.js update (lines 1474-1502)
// When keyboard input detected:
//   1. Save current path (if any)
//   2. Set isKeyboardOverriding = true
//   3. Reset keyboardOverrideTimer
// When no keyboard input for 0.5s:
//   1. Set isKeyboardOverriding = false
//   2. Resume saved path
```

**Visual feedback:** Orange glow when keyboard active (faster pulse: 6Hz vs 4Hz)

**Camera integration:** `SphericalCameraController4.js` transitions to third-person behind unit on keyboard control start.

### 7.2 SimCore Integration (Phase 0)

Direct Control must integrate with Command Queue without breaking existing behavior.

**Canonical requirement:** `spec_sources/ASTEROBIA_CANONICAL_GRFDTRDPU_SYSTEM_2026-01-13.md` Section 8.6.9

| State | Queue Behavior | Visual |
|-------|----------------|--------|
| Enter DC | Pause unit's command queue (all lanes) | Orange glow |
| During DC | MoveIntent from keyboard, queue frozen | Orange glow |
| Exit DC | Queue remains PAUSED until player presses PLAY | Selection glow |
| Resume | Engine computes return path to queued plan | Normal |

**Implementation approach:**
1. Extract DC state to SimCore (`simCore.directControl.activeUnitId`)
2. On DC enter: `unit.queueState.isPlaying = false`
3. On DC exit: queue stays paused, wait for explicit PLAY
4. On PLAY: compute return path internally, resume queue

**Migration path:**
```
CURRENT (Unit.js)              TARGET (SimCore + Unit.js render)
────────────────────────────────────────────────────────────────
isKeyboardOverriding    ──►    simCore.directControl.activeUnitId
savedPath              ──►    simCore.queueState[unitId].savedPlan
keyboardOverrideTimer  ──►    simCore.directControl.idleTimer
```

**Source:** Codebase inspection (`Unit.js:88-91, 1474-1502`), `spec_sources/ASTEROBIA_CANONICAL_GRFDTRDPU_SYSTEM_2026-01-13.md` Section 8.6.9.

---

# PART III: FEATURES

---

## 8. Feature Roadmap

### 8.1 Feature Categories

| Category | Features | Lane |
|----------|----------|------|
| **Locomotion** | MOVE_ROLL, MATERA_TRANSPORT, UNIT_CARRIER | LOCOMOTION |
| **Perception** | OPTICAL_VISION (passive), SUBSURFACE_SCAN | PERCEPTION / N/A |
| **Tool** | MATERA_MINING, TERRAIN_SHAPING | TOOL |
| **Weapon** | WPN_SHOOT | WEAPON |
| **System** | SYS_RESEARCH, SYS_DESIGN, SYS_PRODUCTION | N/A (jobs) |

### 8.2 Demo 1.0 Feature Status

| Feature | Priority | Status | Release |
|---------|----------|--------|---------|
| MOVE_ROLL | Required | Planned | 011 |
| OPTICAL_VISION | Required | Partial (FOW exists) | 012 |
| SUBSURFACE_SCAN | Required | Planned | 016 |
| MATERA_MINING | Required | Planned | 013 |
| MATERA_TRANSPORT | Required | Planned | 014 |
| WPN_SHOOT | Required | Planned | 015 |
| TERRAIN_SHAPING | Stretch | Planned | 017 |
| UNIT_CARRIER | Stretch | Planned | 018 |

### 8.3 Feature Unlock Sequence (Canonical)

**Source:** `spec_sources/ASTEROBIA_CANONICAL_MASTER_BIBLE_2026-01-13.md` Section: Goal/Need → Feature Unlock Mappings

| Order | Trigger | Need Label | Unlocked Feature |
|-------|---------|------------|------------------|
| 1 | Central Unit cannot move | "Explore" | MOVE_ROLL |
| 2 | Mobile unit sees surface Matera | "Discover Matera" | SUBSURFACE_SCAN |
| 3 | Subsurface Scan finds underground mass | "Gather Matera" | MATERA_MINING |
| 4 | Mining creates pile | "Collect Matera" | MATERA_TRANSPORT |
| 5 | Height difference encountered | "Surface Control" | TERRAIN_SHAPING |
| 6 | Non-mobile design created | "Deploy Unit" | UNIT_CARRIER |
| 7 | First enemy appears | "Combat Capability" | WPN_SHOOT |

### 8.4 Feature Dependency Graph

```
                         ┌─────────────────┐
                         │   GAME START    │
                         │  Central Unit   │
                         └────────┬────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
          ▼                       ▼                       ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ OPTICAL_VISION  │     │  SYS_RESEARCH   │     │   SYS_DESIGN    │
│  (Pre-unlocked) │     │  (Pre-unlocked) │     │  (Pre-unlocked) │
└────────┬────────┘     └─────────────────┘     └─────────────────┘
         │
         │ "Cannot explore"
         ▼
┌─────────────────┐
│   MOVE_ROLL     │
│   (Unlock #1)   │
└────────┬────────┘
         │
         │ "See surface Matera"
         ▼
┌─────────────────┐
│ SUBSURFACE_SCAN │
│   (Unlock #2)   │
└────────┬────────┘
         │
         │ "Find underground"
         ▼
┌─────────────────┐
│  MATERA_MINING  │
│   (Unlock #3)   │
└────────┬────────┘
         │
         │ "Pile accumulates"
         ▼
┌─────────────────┐
│MATERA_TRANSPORT │
│   (Unlock #4)   │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌───────┐ ┌───────┐
│TERRAIN│ │  WPN  │
│SHAPING│ │ SHOOT │
│(#5)   │ │(#7)   │
└───────┘ └───────┘
```

**Full dependency graph:** See [Appendix E: Feature Dependency Graph](appendices/APPENDIX_E_FEATURE_DEPENDENCY_GRAPH.md)

---

## 9. G-R-F-Tr-D-P-U Pipeline

### 9.1 Pipeline Overview

**Source:** `spec_sources/ASTEROBIA_CANONICAL_GRFDTRDPU_SYSTEM_2026-01-13.md`

```
┌───────┐    ┌──────────┐    ┌─────────┐    ┌──────────┐
│   G   │───►│    R     │───►│    F    │───►│    Tr    │
│ Goal  │    │ Research │    │ Feature │    │ Training │
└───────┘    └──────────┘    └─────────┘    └──────────┘
                                                  │
                                                  ▼
┌───────┐    ┌──────────┐    ┌─────────┐    ┌──────────┐
│   U   │◄───│    P     │◄───│    D    │◄───│          │
│ Unit  │    │Production│    │ Design  │    │          │
└───────┘    └──────────┘    └─────────┘    └──────────┘
```

### 9.2 G - Goal System (Need Generator)

**Purpose:** Convert GameEvents into Need Cards for player action.

| Component | Responsibility |
|-----------|----------------|
| EventBus | Emits canonical events (COLLISION_WATER, BLOCKED_BY_SLOPE, etc.) |
| GoalManager | Subscribes to EventBus, maps events to Goals, deduplicates |
| Need Card UI | Displays goals as draggable cards |

**Canonical events (Demo 1.0):**
- `UNIT_STUCK` → Need "Explore" → Invent MOVE_ROLL
- `SURFACE_MATERA_VISIBLE` → Need "Discover" → Invent SUBSURFACE_SCAN
- `UNDERGROUND_MATERA_FOUND` → Need "Gather" → Invent MATERA_MINING
- `MATERA_PILE_EXISTS` → Need "Collect" → Invent MATERA_TRANSPORT
- `ENEMY_DETECTED` → Need "Combat" → Invent WPN_SHOOT

### 9.3 R - Research (Invent & Extend)

**Two research types:**

| Type | Effect | Cap |
|------|--------|-----|
| **Invent** | Unlocks new feature (`LOCKED` → `UNLOCKED`) | N/A |
| **Extend** | Improves constraint by level | Level 5 max |

**Extend formula (canonical):**
```
ExtendMultiplier(Level) = 1.0 + (Level * 0.5)
Max Level = 5 → Max Multiplier = 3.5x
```

**Source:** `spec_sources/ASTEROBIA_CANONICAL_GRFDTRDPU_SYSTEM_2026-01-13.md` Section 3.1

**Interaction:**
1. Player drags Need Card to Research-capable unit (has SYS_RESEARCH)
2. Research job created with energy/time cost
3. On completion: FeatureRegistry updated

### 9.4 F - Feature Runtime

**Each feature is an independent module with:**
- Feature ID and category
- Base stats and constraints
- Status (LOCKED/UNLOCKED)
- Extend levels per constraint
- Code module path

**Feature Registry entry:**
```javascript
{
  id: "MOVE_ROLL",
  category: "locomotion",
  status: "LOCKED",
  baseStats: {
    maxSpeed: 10,        // m/s
    acceleration: 5,     // m/s²
    grip: 0.8,
    torque: 50
  },
  constraints: {
    maxClimbAngle: 40    // degrees (extendable to 60)
  },
  extend: {
    levelByConstraint: {
      maxClimbAngle: 0
    }
  }
}
```

### 9.5 Tr - Training (Outcome Slider)

**Status:** Per Human Owner Q6 - implement **Training Outcome Slider** instead of mini-games.

**Phase 1 implementation:**
- Training screen shows slider: -50% to +50%
- User sets desired outcome
- Outcome stored as `highScore` (mapped: -50% = 0, 0% = 50, +50% = 100)
- Multiplier computed: `1.0 + (highScore / 100)`

**Formula (canonical):**
```
TrainingMultiplier = 1.0 + (HighScore / 100)
Range: 0.5x to 2.0x
```

**Scope:** Per user, per feature (global across all units using that feature)

**Source:** `spec_sources/ASTEROBIA_CANONICAL_GRFDTRDPU_SYSTEM_2026-01-13.md` Section 6.3, Human Owner Q6.

### 9.6 D - Design (Type Blueprints)

**Rules (canonical):**
- Sum of allocations = 100%
- 0% allocation = feature not included
- Minimum included allocation = 25% (configurable via `MIN_FEATURE_ALLOCATION`)
- Designer unit slot capacity = `floor(DesignAllocation / 25%)`

**Specialization bonus (fewer features → higher bonus):**

| Features | Bonus |
|----------|-------|
| 1 | +100% (2.0x) |
| 2 | +50% (1.5x) |
| 3 | +20% (1.2x) |
| 4+ | +0% (1.0x) |

**Source:** `spec_sources/ASTEROBIA_CANONICAL_GRFDTRDPU_SYSTEM_2026-01-13.md` Section 3.4

### 9.7 P - Production (Build & Refit)

**Locality rule:** Production occurs at world position of producer unit (SYS_PRODUCTION).

| Operation | Description |
|-----------|-------------|
| **Build** | Create new unit from Type blueprint |
| **Refit** | Update existing unit to newer Type version (cost = delta) |

**Production queue:** Each producer maintains own queue; parallel production requires multiple producers.

### 9.8 U - Unit Lifecycle

**Unit instance contains:**
- `typeId` + `typeVersion`
- HP, energy buffer
- Per-feature tuning modifiers
- Effective stats cache

**Wreck state:** When HP = 0, unit becomes WRECK (interactable for capture/repair).

**Full implementation guide:** See [Appendix D: GRFDTRDPU Implementation](appendices/APPENDIX_D_GRFDTRDPU_IMPLEMENTATION.md)

---

## 10. Core Features (Demo 1.0)

### 10.1 MOVE_ROLL (Locomotion)

**Source:** `spec_sources/ASTEROBIA_CANONICAL_FEATURE_MOVE_ROLL_2026-01-13.md`

| Property | Value |
|----------|-------|
| Lane | LOCOMOTION |
| Type | Action |
| Base Stats | maxSpeed: 10 m/s, acceleration: 5 m/s², grip: 0.8, torque: 50 |
| Constraint | maxClimbAngle: 40° (extendable to 60°) |

**Slope bands (canonical):**
| Slope | Behavior |
|-------|----------|
| 0-10° | Flat (no penalty) |
| 10-40° | Standard (speed penalty: `speed *= cos(slope)`) |
| 40-60° | Critical (requires torque check) |
| >60° | Blocked (unless extended or different locomotion) |

**Done When:**
- [ ] Unit moves along path with correct physics
- [ ] Slope bands respected (blocked >60°)
- [ ] Speed penalty on slopes
- [ ] Extend increases maxClimbAngle

### 10.2 OPTICAL_VISION (Perception - Passive)

**Source:** `spec_sources/ASTEROBIA_CANONICAL_FEATURE_PERCEPTION_OPTICAL_VISION_2026-01-13.md`

| Property | Value |
|----------|-------|
| Lane | N/A (passive) |
| Type | Passive (always-on) |
| Base Stat | visionRange: 30m |
| Max Sources | 64 (per `VISION_MAX_SOURCES_POLICY`) |

**FOW integration:**
- Vision sources stamped to FOW render target
- CPU-serializable explored state for persistence
- Only player's own units reveal FOW (ownership filter)

**Done When:**
- [ ] Unit reveals FOW based on visionRange
- [ ] Range scales with allocation %
- [ ] Explored state persists across save/load

### 10.3 SUBSURFACE_SCAN (Perception - Action)

**Source:** `spec_sources/ASTEROBIA_CANONICAL_FEATURE_PERCEPTION_SUBSURFACE_SCAN_2026-01-13.md`

| Property | Value |
|----------|-------|
| Lane | PERCEPTION |
| Type | Action (toggleable) |
| Base Stat | scanRange: 20m |

**Behavior:**
- Reveals underground Matera deposits within scanRange
- Toggleable on/off (consumes energy while active)
- Triggers UNDERGROUND_MATERA_FOUND event

**Done When:**
- [ ] Scan reveals underground deposits
- [ ] Toggle on/off works
- [ ] Range scales with allocation %

### 10.4 MATERA_MINING (Tool)

**Source:** `spec_sources/ASTEROBIA_CANONICAL_FEATURE_MATERA_MINING_2026-01-13.md`

| Property | Value |
|----------|-------|
| Lane | TOOL |
| Type | Action |
| Base Stat | extractionRate: 5 units/s |
| Constraint | requiresStationary: true |

**Behavior:**
- Unit must be stationary to mine
- Extracts Matera from deposit
- Creates surface pile at deposit location

**Done When:**
- [ ] Mining extracts Matera
- [ ] Surface pile created
- [ ] Rate scales with allocation %
- [ ] Cannot mine while moving

### 10.5 MATERA_TRANSPORT (Locomotion)

**Source:** `spec_sources/ASTEROBIA_CANONICAL_FEATURE_MATERA_TRANSPORT_2026-01-13.md`

| Property | Value |
|----------|-------|
| Lane | LOCOMOTION |
| Type | Action |
| Base Stat | cargoCapacity: 100 units |
| Speed Penalty | 50% when loaded |

**Behavior:**
- Collect Matera from pile
- Deliver to base/storage
- Speed reduced when carrying cargo

**Done When:**
- [ ] Can collect from pile
- [ ] Can deliver to base
- [ ] Speed penalty when loaded
- [ ] Capacity scales with allocation %

### 10.6 WPN_SHOOT (Weapon)

**Source:** `spec_sources/ASTEROBIA_CANONICAL_FEATURE_WPN_SHOOT_2026-01-13.md`

| Property | Value |
|----------|-------|
| Lane | WEAPON |
| Type | Action |
| 4-Axis System | Power, Rate, Range, Accuracy |

**4-axis allocation (nested):**
| Axis | Effect |
|------|--------|
| Power | Damage per shot |
| Rate | Shots per second |
| Range | Effective distance |
| Accuracy | Hit probability |

**Default split:** 25% each (auto-managed unless user edits)

**Done When:**
- [ ] Unit can damage targets
- [ ] 4-axis system affects behavior
- [ ] Wreck state triggers on HP=0

### 10.7 TERRAIN_SHAPING (Tool) - Stretch

**Source:** `spec_sources/ASTEROBIA_CANONICAL_FEATURE_TERRAIN_SHAPING_2026-01-13.md`

| Property | Value |
|----------|-------|
| Lane | TOOL |
| Type | Action |
| Constraint | requiresStationary: true |

**Behavior:**
- Set target height at waypoints
- Height converges over multiple passes
- Mutual exclusion with MATERA_MINING (same lane)

### 10.8 UNIT_CARRIER (Locomotion) - Stretch

**Source:** `spec_sources/ASTEROBIA_CANONICAL_FEATURE_UNIT_CARRIER_2026-01-13.md`

| Property | Value |
|----------|-------|
| Lane | LOCOMOTION |
| Type | Action |

**Behavior:**
- Load/unload other units
- Transport non-mobile units
- Speed penalty when loaded

---

# PART IV: MULTIPLAYER & BACKEND

---

## 11. Multiplayer Architecture

### 11.1 Topology (Binding)

**Decision:** Per Human Owner Q10 - **Host-authoritative star topology**

```
        ┌─────────────┐
        │    HOST     │
        │  (Server-   │
        │   shaped)   │
        └──────┬──────┘
               │
    ┌──────────┼──────────┐
    │          │          │
    ▼          ▼          ▼
┌───────┐  ┌───────┐  ┌───────┐
│Client1│  │Client2│  │Client3│
└───────┘  └───────┘  └───────┘
```

**Properties:**
- Host runs authoritative SimCore
- Clients send commands to host
- Host broadcasts state snapshots
- 2-4 players supported
- Host is "server-shaped" for future dedicated server migration

### 11.2 Connection Flow

```
1. LOBBY CREATION
   Host → Supabase: Create lobby row
   Host → Supabase: Subscribe to lobby channel

2. CLIENT JOIN
   Client → Supabase: Find lobby, subscribe
   Client ↔ Host: WebRTC signaling via Supabase Realtime
   Client ↔ Host: DataChannel established

3. GAMEPLAY
   Client → Host: Commands (via DataChannel)
   Host: Process commands in SimCore
   Host → Clients: State snapshots (every N ticks)
   Clients: Apply snapshots, interpolate

4. LATE JOIN
   New Client → Host: Request full state
   Host → New Client: Full state snapshot
   New Client: Initialize from snapshot
```

### 11.3 Staging Path

| Stage | Scope | Transport |
|-------|-------|-----------|
| **Local** | Single player | LocalTransport (sync) |
| **LAN** | Same network | WebRTC (no TURN) |
| **Internet** | Any network | WebRTC + TURN relay |
| **Matchmaking** | Public lobbies | Supabase + WebRTC |

### 11.4 State Synchronization

**Snapshot frequency:** Every 3 ticks (150ms at 20Hz)

**Snapshot contents:**
```javascript
{
  tick: 1234,
  seed: 42,
  nextId: 567,
  entities: { /* all entity state */ },
  terrain: { /* modified terrain */ },
  players: { /* research/design/production state */ },
  commandLog: [ /* commands since last snapshot */ ]
}
```

**Desync detection:**
- Host computes state hash every 60 ticks
- Clients compute local hash, compare
- Mismatch → request full resync

**Full spec:** See [Appendix A: Multiplayer Deep Spec](appendices/APPENDIX_A_MULTIPLAYER_DEEP_SPEC.md)

---

## 12. Backend & Persistence

### 12.1 Supabase Architecture

**Decision:** Per Human Owner Q12 - **Supabase Pro acceptable** with degrade paths

```
┌─────────────────────────────────────────────────────────────┐
│                      SUPABASE                                │
├─────────────────┬─────────────────┬─────────────────────────┤
│      Auth       │    Realtime     │        Storage          │
│                 │   (Signaling)   │      (Snapshots)        │
├─────────────────┼─────────────────┼─────────────────────────┤
│   PostgreSQL    │    Channels     │    Object Storage       │
│   (User data)   │    (Pub/Sub)    │    (Game saves)         │
└─────────────────┴─────────────────┴─────────────────────────┘
```

### 12.2 Schema (Demo 1.0)

```sql
-- Users (managed by Supabase Auth)
-- profiles table for game-specific data
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Game saves
CREATE TABLE game_saves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id),
  name TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  command_log JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Lobbies (for matchmaking)
CREATE TABLE lobbies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id UUID REFERENCES profiles(id),
  name TEXT NOT NULL,
  max_players INT DEFAULT 4,
  current_players INT DEFAULT 1,
  status TEXT DEFAULT 'waiting', -- waiting, in_game, finished
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Lobby members
CREATE TABLE lobby_members (
  lobby_id UUID REFERENCES lobbies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (lobby_id, user_id)
);
```

### 12.3 Row Level Security (RLS)

```sql
-- Profiles: users can only read/update their own
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Game saves: users can only access their own
ALTER TABLE game_saves ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own saves" ON game_saves
  FOR ALL USING (auth.uid() = user_id);
```

### 12.4 Cost Management (Degrade Paths)

| Tier | Limits | Mitigation |
|------|--------|------------|
| Free | 500MB DB, 1GB storage | Snapshot compression, cleanup old saves |
| Pro | 8GB DB, 100GB storage | Monitor usage, alert at 80% |

**Degrade triggers:**
- Storage > 80%: Auto-delete saves older than 30 days
- Realtime connections > limit: Queue lobby joins

**Full spec:** See [Appendix B: Backend & Persistence Deep Spec](appendices/APPENDIX_B_BACKEND_PERSISTENCE_DEEP_SPEC.md)

---

## 13. Replay System

### 13.1 Purpose

**Decision:** Per Human Owner Q1 - **Include basic command-log replay**

**Use cases:**
1. **Debug:** Reproduce bugs by replaying command log
2. **Anti-cheat foundation:** Verify game outcomes
3. **Analysis:** Review gameplay decisions

### 13.2 Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   RECORDING     │     │    STORAGE      │     │    PLAYBACK     │
├─────────────────┤     ├─────────────────┤     ├─────────────────┤
│ CommandLog.js   │────►│ game_saves.     │────►│ ReplayPlayer.js │
│ - Capture cmds  │     │ command_log     │     │ - Feed cmds     │
│ - Tick stamp    │     │ (JSONB)         │     │ - Verify state  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### 13.3 Command Log Format

```javascript
{
  version: "1.0",
  seed: 42,
  initialState: { /* snapshot at tick 0 */ },
  commands: [
    { tick: 10, type: "MOVE", playerId: "p1", unitIds: ["u1"], payload: { target: [100,0,0] } },
    { tick: 25, type: "ATTACK", playerId: "p1", unitIds: ["u1"], payload: { targetId: "e1" } },
    // ...
  ]
}
```

### 13.4 Playback Verification

```javascript
// Replay verification
const original = loadSnapshot("game_end.json");
const replay = new SimCore({ seed: original.seed });
replay.loadState(commandLog.initialState);

for (const cmd of commandLog.commands) {
  while (replay.tick < cmd.tick) {
    replay.step();
  }
  replay.commandQueue.enqueue(cmd);
}

// Run to same tick as original
while (replay.tick < original.tick) {
  replay.step();
}

// Verify
assert.deepEqual(replay.getStateHash(), original.stateHash);
```

**Full spec:** See [Appendix C: Replay System Spec](appendices/APPENDIX_C_REPLAY_SYSTEM_SPEC.md)

---

# PART V: EXECUTION

---

## 14. Release Plan (Phase 0-2)

### 14.1 Phase Overview

| Phase | Releases | Focus | Goal |
|-------|----------|-------|------|
| **Phase 0** | 001-010 | Netcode Readiness | Deterministic SimCore foundation |
| **Phase 1** | 011-020 | Feature Implementation | Core gameplay loop |
| **Phase 2** | 021-025 | Multiplayer | Network play + polish |

### 14.2 Phase 0: Netcode Readiness (Releases 001-010)

**Goal:** Establish deterministic SimCore that can later support multiplayer.

| Release | Title | Key Deliverable | Done When |
|---------|-------|-----------------|-----------|
| 001 | Fixed Timestep | GameLoop at 20Hz | Tick count stable regardless of FPS |
| 002 | Command Buffer | CommandQueue + CommandProcessor | All input flows through commands |
| 003 | Deterministic IDs | IdGenerator (sequential) | No Date.now() or Math.random() in IDs |
| 004 | Seeded RNG | Mulberry32 PRNG | Same seed → same random sequence |
| 005 | State Registry | StateRegistry + EntityState | Clear authoritative state separation |
| 006 | Transport Shim | ITransport + LocalTransport | Transport abstraction in place |
| 007 | Interpolation | Render interpolation | Smooth visuals at any FPS |
| 008 | Command Log | CommandLog recording | All commands logged with tick |
| 009 | Replay Playback | ReplayPlayer | Can replay command log |
| 010 | Verification | Determinism test | Same inputs → identical state hash |

**PR Breakdown (Release 001 example):**

| PR | Branch | Scope | Size |
|----|--------|-------|------|
| 001.1 | `pr/001-1-gameloop` | GameLoop class | S (<200 lines) |
| 001.2 | `pr/001-2-game-shim` | Game.js integration | S |
| 001.3 | `pr/001-3-interpolation-prep` | Unit.js render position hook | M |

**Full breakdown:** See [Appendix F: Release/Sprint/PR Plan](appendices/APPENDIX_F_RELEASE_SPRINT_PR_PLAN.md)

### 14.3 Phase 1: Feature Implementation (Releases 011-020)

**Goal:** Implement core gameplay features on SimCore foundation.

| Release | Title | Feature | Done When |
|---------|-------|---------|-----------|
| 011 | Locomotion | MOVE_ROLL | Unit moves with slope physics |
| 012 | Vision | OPTICAL_VISION | FOW reveals, CPU-serializable |
| 013 | Mining | MATERA_MINING | Extraction creates piles |
| 014 | Transport | MATERA_TRANSPORT | Collect/deliver with speed penalty |
| 015 | Combat | WPN_SHOOT | 4-axis damage, wreck state |
| 016 | Scan | SUBSURFACE_SCAN | Underground deposit reveal |
| 017 | Terrain (Stretch) | TERRAIN_SHAPING | Height modification |
| 018 | Carrier (Stretch) | UNIT_CARRIER | Unit transport |
| 019 | Designer | SYS_DESIGN + Blueprints | Type creation UI |
| 020 | GRFDTRDPU | Full pipeline | Goal→Research→Feature→Train→Design→Produce→Unit |

### 14.4 Phase 2: Multiplayer (Releases 021-025)

**Goal:** Enable network play with host-authoritative architecture.

| Release | Title | Scope | Done When |
|---------|-------|-------|-----------|
| 021 | Signaling | Supabase Realtime channels | Lobby create/join works |
| 022 | WebRTC | DataChannel establishment | P2P connection works |
| 023 | State Sync | Snapshot broadcast + apply | Clients see host state |
| 024 | Host Authority | Command relay + validation | All changes via host |
| 025 | Late Join | Full state sync on join | Player can join in-progress |

### 14.5 Milestone Checkpoints

| Milestone | After Release | Verification |
|-----------|---------------|--------------|
| **M1: Determinism** | 010 | Replay produces identical state |
| **M2: Core Loop** | 014 | Research→Design→Produce→Move→Mine→Transport |
| **M3: Combat** | 015 | Attack, damage, wreck |
| **M4: Local Complete** | 020 | Full single-player Demo 1.0 |
| **M5: Multiplayer** | 025 | 2-4 player networked game |

### 14.6 Phase Transition Decision Triggers

**When to advance from Phase 0 to Phase 1:**

| Trigger | Condition | Verification |
|---------|-----------|--------------|
| Determinism proven | Replay test passes 100/100 runs | CI gate |
| Transport abstraction working | LocalTransport + stub WebRTCTransport compile | Smoke test |
| State separation complete | Unit.js reads from SimCore state | Code review |
| No regressions | All existing features still work | Full smoke test |

**When to advance from Phase 1 to Phase 2:**

| Trigger | Condition | Verification |
|---------|-----------|--------------|
| All required features implemented | 6/6 features pass acceptance | Feature tests |
| Single-player loop complete | Can play research→build→fight | Manual playtest |
| Save/Load working | Snapshot round-trip verified | Unit test |
| Ready for network | ITransport interface used everywhere | Code review |

**When to ship Demo 1.0:**

| Trigger | Condition | Verification |
|---------|-----------|--------------|
| All Demo 1.0 Done Means | Section 2 checklist 100% | Manual verification |
| CI gates pass | Determinism + MP sync + perf | GitHub Actions |
| No P0 bugs | Bug tracker clean | Triage review |
| Playtest successful | 30-minute session without crash | Manual test |

### 14.7 Rollback Triggers

**Immediate rollback (revert PR within 1 hour):**
- Smoke test fails
- Determinism test fails
- Direct Control regression
- Build failure

**Planned rollback (revert after investigation):**
- Performance regression > 20%
- Memory growth > 2x
- New console errors
- Feature interaction bug

---

## 15. PR Workflow & Gates

### 15.1 Branch Naming

**Decision:** Per Human Owner Q17 - current release-branch approach

```
release/{XXX}              # Release branch (e.g., release/001)
pr/{XXX}-{N}-{description} # PR branch (e.g., pr/001-1-gameloop)
```

### 15.2 PR Granularity

**Decision:** Per Human Owner Q3 - **Granular PRs** (Claude style)

- Multiple small PRs per release
- Each PR: single responsibility, <500 lines ideal
- Easier review, safer rollback

### 15.3 PR Checklist (Binding)

**Before opening PR:**
- [ ] Code compiles without errors
- [ ] All new code has unit tests
- [ ] Existing tests still pass
- [ ] Manual smoke test completed
- [ ] No console errors in browser
- [ ] PR description includes: goal, files changed, testing performed, rollback instructions

**Review criteria:**
- [ ] Code follows existing patterns
- [ ] No new dependencies without justification
- [ ] Determinism rules followed (no Date.now/Math.random in logic)
- [ ] State surface rules followed (authoritative vs render)

### 15.4 Merge Process

1. PR approved by reviewer
2. Squash and merge to release branch
3. Run full smoke test
4. If smoke fails, revert immediately
5. When release complete, merge release branch to `main`
6. Tag release (`v0.{release}`)

---

## 16. Testing & CI Strategy

### 16.1 Test Pyramid

**Decision:** Per Human Owner Q13 - **Unit + Integration**

```
            ┌─────────────┐
            │   Manual    │  <- Few
            │  Smoke Test │
            ├─────────────┤
            │ Integration │  <- Some
            │   Tests     │
            ├─────────────┤
            │    Unit     │  <- Many
            │   Tests     │
            └─────────────┘
```

### 16.2 Coverage Targets

| Component | Target | Focus |
|-----------|--------|-------|
| SimCore | 80% | All logic modules |
| Commands | 90% | All command types |
| Features | 75% | Core behavior |
| Transport | 70% | Message handling |
| UI | 30% | Critical paths only |

### 16.3 Test Categories

#### Unit Tests (Jest)

```javascript
// Determinism test
describe('Determinism', () => {
  test('same inputs produce same outputs', () => {
    const sim1 = new SimCore({ seed: 12345 });
    const sim2 = new SimCore({ seed: 12345 });

    // Apply identical commands
    applyCommands(sim1, commands);
    applyCommands(sim2, commands);

    // Run 1000 ticks
    for (let i = 0; i < 1000; i++) {
      sim1.step();
      sim2.step();
    }

    expect(sim1.getStateHash()).toBe(sim2.getStateHash());
  });
});
```

#### Integration Tests

```javascript
// Multiplayer sync test
describe('Multiplayer Sync', () => {
  test('host and client stay synchronized', async () => {
    const host = new SimCore({ seed: 42, isHost: true });
    const client = new SimCore({ seed: 42, isHost: false });

    // Client sends command
    const cmd = createMoveCommand('p2', ['u1'], [100, 0, 0]);
    client.sendCommand(cmd);

    // Simulate network
    await transport.flush();

    // Process and sync
    host.step();
    client.applySnapshot(host.getSnapshot());

    // Verify
    expect(host.getEntity('u1').position)
      .toEqual(client.getEntity('u1').position);
  });
});
```

### 16.4 Smoke Test Checklist

**Quick Smoke (before every commit):**
- [ ] `npm start` runs without errors
- [ ] Game loads at localhost:8081
- [ ] Can select unit
- [ ] Can issue move command
- [ ] Unit moves to destination

**Full Smoke (before each release):**
- [ ] All Quick Smoke items
- [ ] Camera controls work (pan, orbit, zoom)
- [ ] Direct Control works (keyboard moves unit)
- [ ] FOW reveals correctly
- [ ] No console errors during gameplay
- [ ] 60 FPS with 10 units

### 16.5 CI Pipeline

**Decision:** Per Human Owner Q14 - **Soft targets** (measure + trend)

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm test
      - run: npm run test:determinism  # Must pass (hard gate)
      - run: npm run test:coverage     # Report only (soft)
      - run: npm run perf:measure      # Report only (soft)
```

**Hard gates (block merge):**
- Determinism test passes
- Multiplayer sync smoke passes
- No TypeScript errors

**Soft targets (report, trend):**
- Tick time p95 < 8ms
- Test coverage > 80%
- Memory stable over 10-minute run

**Full strategy:** See [Appendix G: Testing & QA Strategy](appendices/APPENDIX_G_TESTING_QA_STRATEGY.md)

---

## 17. Risk Register

### 17.1 Risk Summary

| ID | Risk | Probability | Impact | Mitigation |
|----|------|-------------|--------|------------|
| R1 | Performance ceiling | Medium | High | Time budget, Web Worker, WASM fallback |
| R2 | Determinism drift | High | Critical | State hash checks, auto-resync |
| R3 | Unit.js monolith | High | Medium | Shim-based extraction, full smoke tests |
| R4 | WebRTC NAT issues | Medium | Medium | TURN servers, connection quality UI |
| R5 | Supabase limits | Low | Medium | Compression, cleanup, monitor usage |
| R6 | Scope creep | Medium | High | Demo 1.0 Done Means as hard boundary |

### 17.2 Risk Details

#### R1: Performance Ceiling

**Description:** JavaScript single-threaded nature may cause frame drops when SimCore.step() > 10ms.

**Triggers:**
- Unit count > 50
- Complex pathfinding
- Large state serialization

**Indicators:**
- Tick time p95 > 5ms (warning)
- Tick time p95 > 8ms (critical)

**Mitigations:**
1. **Immediate:** Time budget with early abort (spiral of death prevention)
2. **Short-term:** Move SimCore to Web Worker
3. **Long-term:** WASM for physics calculations

#### R2: Determinism Drift

**Description:** Floating-point variance between browsers/machines causes state divergence.

**Triggers:**
- Extended gameplay sessions
- Different CPU architectures

**Indicators:**
- State hash mismatch
- Visual desync

**Mitigations:**
1. **Immediate:** State hash comparison every 60 ticks
2. **Short-term:** Auto-resync on mismatch
3. **Long-term:** Fixed-point math library

#### R3: Unit.js Monolith

**Description:** Tightly coupled Unit.js (~1500 lines) makes extraction risky.

**Mitigations:**
1. **Approach:** Shim-based extraction per Human Owner Q16
2. **Rule:** Never modify Unit.js without full smoke test
3. **Rollback:** Revert immediately on failure

#### R4: WebRTC NAT Traversal

**Description:** Symmetric NAT prevents P2P connection.

**Mitigations:**
1. **Immediate:** Use STUN servers
2. **Short-term:** Deploy TURN servers (per Q11)
3. **Fallback:** Display connection quality indicator

**Full register:** See [Appendix H: Risk Register Detail](appendices/APPENDIX_H_RISK_REGISTER_DETAIL.md)

### 17.3 Top 10 Failure Modes & Early Warning Signals

| # | Failure Mode | Early Warning Signal | Response |
|---|--------------|---------------------|----------|
| 1 | **Desync in multiplayer** | State hash mismatch alarm | Trigger auto-resync, log diff for debug |
| 2 | **Tick time spike** | p95 tick time > 5ms | Profile hot paths, defer non-critical work |
| 3 | **Memory leak** | Heap growth > 1MB/min | Check entity cleanup, event listener removal |
| 4 | **Spiral of death** | > 3 catch-up steps/frame | Clamp accumulator, drop frames, warn user |
| 5 | **Connection drop** | ICE state = "disconnected" | Show reconnect UI, attempt reconnect ×3 |
| 6 | **Save corruption** | Snapshot parse failure | Keep last-known-good save, alert user |
| 7 | **Determinism drift** | Different hash same tick | Log RNG state, entity counts; force resync |
| 8 | **Unit.js regression** | Smoke test fails | Immediate revert, no merge without fix |
| 9 | **Supabase quota** | Usage > 80% of tier | Alert, trigger cleanup of old data |
| 10 | **Feature interaction bug** | Unexpected lane conflict | Log feature states, fallback to safe state |

**Monitoring implementation (Post-Demo):**
- Console warnings for #2, #4
- Automated hash checks for #1, #7
- Browser beforeunload for save integrity
- Supabase dashboard alerts for #9

---

## 18. Alternatives & Tradeoffs

This section documents key architectural decisions, rejected alternatives, and the rationale for choices made.

### 18.1 Network Architecture

| Decision | Chosen | Rejected | Rationale |
|----------|--------|----------|-----------|
| Topology | Host-authoritative star | Peer-to-peer mesh | Simpler state management, one authoritative source, easier to migrate to dedicated server |
| Transport | WebRTC DataChannels | WebSockets | P2P reduces server load, lower latency, TURN fallback available |
| Signaling | Supabase Realtime | Custom WebSocket server | Managed service, already have Supabase for auth/storage |

**Why not P2P mesh?**
- Requires N×N connections for N players
- State reconciliation complexity grows quadratically
- No clear "truth" on conflict
- Harder to debug desyncs

**Why not WebSockets?**
- Requires dedicated server infrastructure
- Higher latency (server hop)
- Server costs scale with player count
- BUT: Easier NAT traversal (future consideration)

### 18.2 State Authority

| Decision | Chosen | Rejected | Rationale |
|----------|--------|----------|-----------|
| Simulation | Host runs authoritative SimCore | Lockstep | Lockstep requires perfect sync, any drift = desync; host authority allows correction |
| Client prediction | None (snapshot interpolation) | Full prediction + rollback | Simpler, acceptable latency for RTS, avoids visual jitter from rollbacks |

**Why not lockstep?**
- Floating-point variance between browsers
- One slow client slows everyone
- Complex to implement rollback

**Why no client prediction?**
- RTS tolerates 100-150ms latency
- Prediction + rollback causes visual jitter
- Snapshot interpolation simpler and sufficient

### 18.3 Persistence Layer

| Decision | Chosen | Rejected | Rationale |
|----------|--------|----------|-----------|
| Backend | Supabase | Firebase, Custom server | Postgres + Auth + Storage + Realtime in one; good free tier; SQL familiarity |
| Save format | JSONB in Postgres | Files in Storage | Queryable, smaller saves; Storage for large replays only |

**Why not Firebase?**
- NoSQL less flexible for queries
- Realtime database has different model
- Already committed to Supabase for auth

### 18.4 UI Framework

| Decision | Chosen | Rejected | Rationale |
|----------|--------|----------|-----------|
| UI Components | Web Components (vanilla) | React, Vue, Svelte | No framework dependency, native browser support, encapsulation via Shadow DOM |

**Why not React?**
- Additional dependency for game overlay
- Virtual DOM overhead unnecessary for game UI
- Web Components are framework-agnostic

### 18.5 Refactoring Strategy

| Decision | Chosen | Rejected | Rationale |
|----------|--------|----------|-----------|
| Unit.js migration | Shim-based extraction | Full rewrite | Lower risk, preserve working code, incremental migration, easy rollback |

**Why not full rewrite?**
- Unit.js works today (Direct Control, movement, visuals)
- Rewrite risks losing features
- Can't afford timeline slip
- Shim allows parallel operation during migration

### 18.6 Command Queue UI

| Decision | Chosen | Rejected | Rationale |
|----------|--------|----------|-----------|
| Phase 1 UI | List + simple timeline bar | Full AE-style timeline | Data model first, complex UI later; demo can ship with simpler UI |
| Timeline complexity | Phased (P1 simple, P2 full) | All at once | Reduces Demo 1.0 scope; full timeline is Post-Demo |

### 18.7 Determinism Approach

| Decision | Chosen | Rejected | Rationale |
|----------|--------|----------|-----------|
| Random numbers | Seeded PRNG (Mulberry32) | Fixed-point math | Mulberry32 is sufficient for our needs, simpler than fixed-point |
| ID generation | Sequential integers | UUIDs | Deterministic, shorter, predictable order |

**Why not fixed-point math?**
- Overkill for our precision needs
- Significant code complexity
- Mulberry32 + careful float usage is sufficient
- Can add later if determinism issues persist

---

# APPENDICES (Summary)

The following appendices provide deep technical detail. Each is a separate file in `appendices/`.

| Appendix | Purpose | Status |
|----------|---------|--------|
| A | Multiplayer Deep Spec | Complete |
| B | Backend & Persistence Deep Spec | Complete |
| C | Replay System Spec | Complete |
| D | GRFDTRDPU Implementation Guide | Complete |
| E | Feature Dependency Graph | Complete |
| F | Release/Sprint/PR Breakdown | Complete |
| G | Testing & QA Strategy | Complete |
| H | Risk Register Detail | Complete |
| I | UI/UX Pipeline | Complete |

---

## Open Decisions

Decisions marked for future resolution:

| ID | Topic | Options | Decision Trigger |
|----|-------|---------|------------------|
| OD-1 | Error reporting service | Sentry vs Console | Post-Demo 1.0 based on bug frequency |
| OD-2 | Full timeline UI | Phase 2 scope | After Demo 1.0 feedback |
| OD-3 | Dedicated server | Host migration vs server | Based on player count growth |

---

## Glossary

| Term | Definition |
|------|------------|
| **SimCore** | Authoritative simulation core running at 20Hz |
| **Tick** | Single SimCore update step (50ms) |
| **Command** | Input event with tick stamp, processed deterministically |
| **Feature** | Capability module (e.g., MOVE_ROLL, WPN_SHOOT) |
| **Type** | Blueprint defining unit feature allocations |
| **Lane** | Command Queue category (LOCOMOTION, TOOL, WEAPON, PERCEPTION) |
| **Clip** | Scheduled action on timeline with duration |
| **Gummy Stretch** | Clip extension when action runs longer than estimated |
| **Host** | Authoritative player in multiplayer (server-shaped) |
| **Snapshot** | Serialized game state at a tick |
| **PRNG** | Pseudorandom Number Generator (Mulberry32) |

---

## Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 2.0.0 | 2026-01-24 | Claude Code + Adam | Initial v2 from reconciled sources |
| 2.0.1 | 2026-01-24 | Claude Code | Added Part III (Features) + Part IV (MP/Backend) |
| 2.0.2 | 2026-01-24 | Claude Code | Added Part V (Execution) + Appendix summary |
| 2.1.0 | 2026-01-24 | Claude Code | Polish pass: Added Section 18 (Alternatives & Tradeoffs), Determinism/Data invariants, Top 10 Failure Modes, Decision Triggers, Minimal Acceptance Tests |

---

*End of MASTER_PLAN_FINAL_v2.md*

*Appendices follow as separate files.*
