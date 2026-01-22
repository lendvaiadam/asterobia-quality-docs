# ASTEROBIA — MASTER DEVELOPMENT PLAN (MERGED v1)

**Status:** AUTHORIZED
**Date:** 2026-01-22
**Authors:** Claude Code (Anthropic) + Antigravity (Gemini)
**Merge Authority:** Ádám Lendvai (Human Owner)

---

## MERGE PROVENANCE

This document merges the best elements from two AI-authored plans:

| Element | Source | Rationale |
|---------|--------|-----------|
| **Architecture (SimLoop, StateRegistry, ITransport)** | Antigravity | Provides working code implementations |
| **PR Breakdown (file-level, 3-file chunks)** | Claude | More granular for agent execution |
| **Supabase Schema (SQL)** | Claude | More detailed with RLS policies |
| **Feature Logic** | Both (complementary) | Combined for completeness |

**Resolved Decisions:**
- **Snapshot Strategy:** Full Snapshots for Phase 0/1 (defer delta compression)
- **UI Tech Stack:** Vanilla Custom Elements (Web Components)
- **Replay System:** Added as new section (Input Recorder spec)
- **CI/CD:** Added GitHub Actions workflow

---

## 1. Table of Contents

1. [Merge Provenance](#merge-provenance)
2. [Executive Summary](#2-executive-summary)
3. [Done Means Definition](#3-done-means-definition)
4. [Architecture Overview (SimCore vs View)](#4-architecture-overview-simcore-vs-view)
5. [Multiplayer Internet Stack](#5-multiplayer-internet-stack)
6. [Determinism Strategy](#6-determinism-strategy)
7. [Backend & Services](#7-backend--services)
8. [Persistence, Snapshots & Replay](#8-persistence-snapshots--replay)
9. [GRFDTRDPU Implementation](#9-grfdtrdpu-implementation)
10. [Feature Dependency Graph](#10-feature-dependency-graph)
11. [UI/UX Pipeline](#11-uiux-pipeline)
12. [Release / Sprint / PR Plan](#12-release--sprint--pr-plan)
13. [Testing, CI & Observability](#13-testing-ci--observability)
14. [Risk Register](#14-risk-register)
15. [Coverage Proof](#15-coverage-proof)

**Appendix Links:**
- [Claude: Appendix A - Multiplayer Internet Stack](../Claude/master_plan/appendices/APPENDIX_A_MULTIPLAYER_INTERNET_STACK.md)
- [Claude: Appendix B - Backend Data Model](../Claude/master_plan/appendices/APPENDIX_B_BACKEND_DATA_MODEL.md)
- [Claude: Appendix E - Releases & PR Plan](../Claude/master_plan/appendices/APPENDIX_E_RELEASES_SPRINTS_PR_PLAN.md)
- [Antigravity: Appendix A - SimLoop Code](../Antigravity/Release000_MasterPlan/appendices/APPENDIX_MULTIPLAYER_INTERNET_STACK.md)
- [Antigravity: Appendix C - GRFDTRDPU](../Antigravity/Release000_MasterPlan/appendices/APPENDIX_GRFDTRDPU_RD_DEV_PROD_IMPLEMENTATION.md)

---

## 2. Executive Summary

Asterobia is a **simulation-first** competitive strategy game built on a **Host-Authoritative** architecture. The game runs a deterministic simulation at 20Hz (SimCore), completely decoupled from the 60Hz+ rendering layer (Three.js).

**Core Architecture Principle:** The SimCore is the **single source of truth**. It has no knowledge of Three.js, DOM, or any browser APIs. It can run in a Web Worker, Node.js, or any JavaScript runtime.

**Multiplayer Model:** P2P WebRTC with Supabase for signaling. Host runs the authoritative simulation; clients send commands and receive state snapshots.

---

## 3. Done Means Definition

### 3.1 "Playable" Criteria

| Criterion | Verification |
|-----------|--------------|
| **Fixed 20Hz SimCore** | Throttle CPU, verify tick count stable at 20/sec |
| **Command-Only Input** | No direct state mutation; all via CommandQueue |
| **Deterministic IDs** | No `Date.now()` or `Math.random()` in ID generation |
| **Seeded RNG** | Same seed = same sequence across machines |
| **State Serialization** | `SimCore.serialize()` produces identical JSON for identical state |
| **ITransport Abstraction** | Can swap LocalTransport for WebRTCTransport |
| **Two-Player Session** | Host + Client synchronized with 0% desync |
| **GRFDTRDPU Active** | Can Research, Design, Produce, and Upgrade units |
| **All 7 Features** | MOVE_ROLL, WPN_SHOOT, OPTICAL_VISION, SUBSURFACE_SCAN, MINING, TRANSPORT, TERRAIN_SHAPING |

### 3.2 "Deployed" Criteria

- Game accessible at play.asterobia.com (GitHub Pages)
- Version selector shows all releases
- Supabase backend handles auth and matchmaking
- Tagged releases in `public/versions.json`

---

## 4. Architecture Overview (SimCore vs View)

**Source:** Antigravity Appendix A (Layer definitions)

### 4.1 Layer Stratification

```
Layer 4: SERVICES (Cloud)
   └── Supabase (Auth, DB, Realtime), GenAI APIs

Layer 3: VIEW (Presenter)
   └── Three.js, Input Handlers, Interpolation
   └── Reads State + Alpha; Never mutates game state

Layer 2: TRANSPORT (Network)
   └── ITransport, LocalLoopback, WebRTCTransport
   └── Replicates Commands to Host; State to Clients

Layer 1: SIMCORE (Kernel) ← THE TRUTH
   └── 20Hz Fixed Timestep
   └── Inputs: CommandQueue ONLY (not keyboard/mouse)
   └── Outputs: SimState Snapshot
   └── Dependencies: NONE (Pure JS, no Three.js)

Layer 0: PLATFORM (Browser/OS)
   └── JS Single Thread, Memory limits, NAT
```

### 4.2 SimCore Folder Structure (BINDING)

```
src/SimCore/
├── core/
│   ├── SimLoop.js          # 20Hz fixed timestep accumulator
│   ├── SimCore.js          # Main state container
│   ├── IdGenerator.js      # Sequential deterministic IDs
│   └── PRNG.js             # Mulberry32 seeded RNG
├── commands/
│   ├── CommandTypes.js     # MOVE, STOP, ATTACK, MINE, BUILD
│   ├── CommandQueue.js     # Tick-stamped command buffer
│   └── CommandProcessor.js # Executes commands on tick
├── state/
│   ├── StateRegistry.js    # Authority state structure
│   ├── EntityState.js      # Per-entity state contract
│   └── Serializer.js       # JSON serialize/deserialize/hash
├── transport/
│   ├── ITransport.js       # Interface definition
│   ├── LocalTransport.js   # In-memory (Phase 0)
│   └── WebRTCTransport.js  # PeerJS (Phase 2)
├── features/
│   ├── locomotion/
│   │   └── MoveRoll.js
│   ├── perception/
│   │   ├── OpticalVision.js
│   │   └── SubsurfaceScan.js
│   ├── tool/
│   │   ├── MateraMining.js
│   │   └── TerrainShaping.js
│   ├── weapon/
│   │   └── WeaponShoot.js
│   └── logistics/
│       ├── MateraTransport.js
│       └── UnitCarrier.js
├── modules/
│   ├── GoalEvaluator.js    # G: Event -> Need mapping
│   ├── ResearchLab.js      # R: Invent/Extend features
│   ├── TrainingCenter.js   # Tr: Skill multipliers
│   ├── Designer.js         # D: Blueprint creation
│   ├── Factory.js          # P: Unit production
│   └── Refitter.js         # U: Unit upgrades
└── index.js                # Public exports
```

### 4.3 Data Flow Diagram

**Source:** Antigravity SimLoop implementation

```
Frame N (Host):
  1. accumulator += delta
  2. While (accumulator >= 50ms):
       a. sim.processInputs()    # Read CommandQueue for this tick
       b. sim.step(50)           # Advance all systems
       c. emit StateSnapshot
       d. accumulator -= 50ms
  3. render(alpha)               # Interpolate for smooth visuals

Frame N (Client):
  1. Send local commands via ITransport
  2. Receive StateSnapshot from Host
  3. Apply snapshot to local state
  4. render(alpha)               # Interpolate between snapshots
```

---

## 5. Multiplayer Internet Stack

**Source:** Antigravity Appendix A (ITransport interface, WebRTC logic)

### 5.1 Progression Path

```
Phase 0: Local Loopback (same browser memory)
    ↓
Phase 1: LAN (BroadcastChannel or direct IP)
    ↓
Phase 2: Internet (WebRTC P2P via Supabase signaling)
    ↓
Phase 3 (Future): Dedicated Server
```

### 5.2 Authority Model

**Model:** Host-Authoritative

| Role | Responsibility |
|------|----------------|
| **Host** | Runs SimCore at 20Hz, validates commands, broadcasts snapshots |
| **Client** | Sends commands, receives snapshots, interpolates for display |

**Why Host-Authoritative?**
- No server costs (P2P)
- Host gets 0ms latency (feels crisp)
- Simpler than full lockstep or client prediction

### 5.3 ITransport Interface

**Source:** Antigravity Appendix A

```typescript
interface ITransport {
    // Lifecycle
    host(lobbyConfig: any): Promise<string>; // Returns PeerID
    join(hostPeerId: string): Promise<void>;

    // I/O
    sendCmd(cmd: ICommand): void;
    sendSnapshot(state: IGameState): void;

    // Hooks
    onCmdReceived(cb: (cmd: ICommand) => void): void;
    onSnapshotReceived(cb: (state: IGameState) => void): void;
    onLatencyUpdate(cb: (ms: number) => void): void;
}
```

### 5.4 LocalTransport (Phase 0)

```javascript
export class LocalTransport {
    constructor() {
        this.delay = 0; // Simulate lag (ms)
        this.hostCallback = null;
        this.clientCallback = null;
    }

    sendCmd(cmd) {
        setTimeout(() => {
            if (this.hostCallback) this.hostCallback(cmd);
        }, this.delay);
    }

    sendSnapshot(state) {
        // CLONE to prevent reference sharing
        const serialized = JSON.stringify(state);
        setTimeout(() => {
            if (this.clientCallback) this.clientCallback(JSON.parse(serialized));
        }, this.delay);
    }
}
```

### 5.5 WebRTCTransport (Phase 2)

Uses **PeerJS** to abstract ICE/STUN complexity.

**Host Flow:**
1. Create PeerJS connection, get UUID
2. Upload UUID to Supabase `lobbies` table
3. Listen for `connection` events
4. On data: `handleRemoteCommand(data)`

**Client Flow:**
1. Read `hostPeerId` from Supabase lobby
2. `peer.connect(hostPeerId)`
3. On data: `applyServerSnapshot(data)`

---

## 6. Determinism Strategy

**Source:** Antigravity Appendix A (Mulberry32), Claude Section 4.5

### 6.1 Rules

| Concern | Problem | Solution |
|---------|---------|----------|
| **Timestep** | `clock.getDelta()` varies | Accumulator pattern, fixed 50ms |
| **Random** | `Math.random()` unseeded | Mulberry32 PRNG |
| **IDs** | `Date.now()` non-deterministic | `sim.nextId++` sequential |
| **Floats** | IEEE 754 variance | Monitor; fixed-point if needed |
| **Iteration** | Array order may vary | Explicit sort with ID tie-breaker |

### 6.2 Mulberry32 PRNG

**Source:** Antigravity Appendix A

```javascript
// src/SimCore/core/PRNG.js
export function mulberry32(a) {
    return function() {
      var t = a += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

// Usage in SimCore
init(seed) {
    this.random = mulberry32(seed);
}

// Deterministic random
const x = this.random() * 100;
```

### 6.3 Desync Detection

Every 60 ticks (~3 seconds):
1. Host sends `stateHash` with snapshot
2. Client computes local hash
3. **Match:** Continue
4. **Mismatch:** Client requests full resync

---

## 7. Backend & Services

**Source:** Claude Appendix B (Full SQL schema)

### 7.1 Supabase Services

| Service | Purpose | Phase |
|---------|---------|-------|
| **Auth** | Player identity (Email, Discord, Anonymous) | Phase 2 |
| **Database** | PostgreSQL (profiles, blueprints, lobbies) | Phase 2 |
| **Realtime** | Lobby updates, signaling | Phase 2 |
| **Storage** | Thumbnails, replays | Phase 3 |

### 7.2 Core Tables (SQL)

```sql
-- Profiles
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT 'Anonymous',
  avatar_url TEXT,
  stats JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Blueprints
CREATE TABLE blueprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 10,
  data JSONB NOT NULL,
  is_public BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(owner_id, name, version)
);

-- Lobbies
CREATE TABLE lobbies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  host_peer_id TEXT,
  name TEXT NOT NULL DEFAULT 'New Game',
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN', 'STARTING', 'PLAYING', 'CLOSED')),
  max_players INTEGER DEFAULT 2,
  players JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 7.3 Row Level Security

All tables have RLS enabled:
- Users can only read/write their own data
- Public data (open lobbies, public blueprints) readable by all
- Sensitive operations via RPC functions

---

## 8. Persistence, Snapshots & Replay

### 8.1 Snapshot Strategy

**DECISION:** Full Snapshots for Phase 0/1

| Strategy | Phase | Rationale |
|----------|-------|-----------|
| **Full Snapshots** | 0, 1 | Simple (JSON.stringify), no drift risk |
| **Delta Compression** | 2+ | Defer until bandwidth becomes issue |

**Snapshot Format:**
```json
{
  "version": "1.0.0",
  "tick": 12500,
  "seed": 9938472,
  "nextId": 505,
  "entities": { ... },
  "terrain": { "modifications": [...] },
  "explored": "base64-encoded-grid",
  "players": { ... }
}
```

### 8.2 Local Persistence (Autosave)

**Triggers:**
- Every 60 seconds: Autosave to slot 0
- Manual "Save": User-selected slot
- Tab close (beforeunload): Quick save
- Game over: Final save

**Storage:** localStorage with LZ-String compression

### 8.3 Replay System (NEW)

**Source:** OPEN_DECISIONS.md

**Input Recorder:**
Host records: `[Tick, PlayerID, CommandStruct]`

**Replay File Format:**
```json
{
  "version": "1.0.0",
  "initialSeed": 12345,
  "initialState": { ... },
  "commands": [
    { "tick": 1, "player": "p1", "cmd": { "type": "CMD_MOVE", ... } },
    { "tick": 5, "player": "p2", "cmd": { "type": "CMD_ATTACK", ... } }
  ]
}
```

**Playback:**
1. Initialize SimCore with `initialSeed`
2. Load `initialState`
3. Feed commands at their designated ticks
4. No network needed - deterministic replay

**Integration:** Add to Release 009 (Full Determinism Verification) as the ultimate determinism test.

---

## 9. GRFDTRDPU Implementation

**Source:** Claude Section 7, Antigravity Appendix C

### 9.1 Pipeline Flow

```
[G] Goals/Needs → [R] Research → [F] Features → [Tr] Training
                                       ↓
                                [D] Design → [P] Production → [U] Upgrade
```

### 9.2 Module Mapping

| Stage | Module | Data Structure |
|-------|--------|----------------|
| **G** | `GoalEvaluator.js` | `{ id, triggerEvent, needLabel, featureUnlock }` |
| **R** | `ResearchLab.js` | `{ featureId, type, progress, cost }` |
| **F** | `features/*.js` | `{ id, category, status, baseStats }` |
| **Tr** | `TrainingCenter.js` | `{ featureId, highScore, multiplier }` |
| **D** | `Designer.js` | `{ blueprintId, allocations, visualSeed }` |
| **P** | `Factory.js` | `{ blueprintId, progress, outputUnitId }` |
| **U** | `Refitter.js` | `{ unitId, targetVersion, cost }` |

### 9.3 Event → Need → Feature Mapping

| Trigger Event | Need Label | Feature Unlocked |
|---------------|------------|------------------|
| Central Unit cannot move | "Explore" | MOVE_ROLL |
| See surface Matera | "Discover Matera" | SUBSURFACE_SCAN |
| Find Matera mass | "Gather Matera" | MATERA_MINING |
| Pile accumulates | "Collect Matera" | MATERA_TRANSPORT |
| Height difference | "Surface Control" | TERRAIN_SHAPING |
| Enemy appears | "Combat Capability" | WPN_SHOOT |
| Deploy needed | "Deploy Unit" | UNIT_CARRIER |

---

## 10. Feature Dependency Graph

**Source:** Claude Appendix D, Antigravity Appendix D

```
                    [Central Unit]
                          │
                    (has OPTICAL_VISION)
                          │
          ┌───────────────┴───────────────┐
          │                               │
    [See Surface]                   [Cannot Move]
          │                               │
          ▼                               ▼
    [Discover Matera]              [NEED: Explore]
          │                               │
          ▼                               ▼
    [SUBSURFACE_SCAN] ◄─────────── [Invent MOVE_ROLL]
          │
          ▼
    [Find Matera Mass]
          │
          ▼
    [NEED: Gather] ────► [Invent MATERA_MINING]
          │
          ▼
    [Surface Pile Exists]
          │
          ▼
    [NEED: Collect] ────► [Invent MATERA_TRANSPORT]
          │
          ▼
    [Height Difference]
          │
          ▼
    [NEED: Surface Control] ────► [Invent TERRAIN_SHAPING]
          │
          ▼
    [Enemy Appears]
          │
          ▼
    [NEED: Combat] ────► [Invent WPN_SHOOT]
          │
          ▼
    [Deploy Unit Needed]
          │
          ▼
    [NEED: Deploy] ────► [Invent UNIT_CARRIER]
```

---

## 11. UI/UX Pipeline

### 11.1 Tech Stack Decision

**DECISION:** Vanilla Custom Elements (Web Components)

| Option | Verdict | Rationale |
|--------|---------|-----------|
| Vanilla DOM + CSS | Reject for complex UI | Hard to manage Blueprint trees |
| React/Preact | Consider for future | Build complexity, framework friction |
| Canvas GUI (Leva) | Reject | Bad for text/tables |
| **Web Components** | **SELECTED** | Native, encapsulated, no framework bloat |

### 11.2 UI Component Standard

```javascript
// Example: <asterobia-blueprint-editor>
class BlueprintEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; background: #1a1a2e; }
        .allocation-slider { ... }
      </style>
      <div class="editor">
        <slot name="features"></slot>
      </div>
    `;
  }
}

customElements.define('asterobia-blueprint-editor', BlueprintEditor);
```

### 11.3 Key UI Components

| Component | Purpose |
|-----------|---------|
| `<asterobia-hud>` | Main game overlay |
| `<asterobia-designer>` | Blueprint creation |
| `<asterobia-tech-tree>` | Research visualization |
| `<asterobia-lobby-browser>` | Multiplayer lobby list |
| `<asterobia-debug-panel>` | Dev tools overlay |

---

## 12. Release / Sprint / PR Plan

**Source:** Claude Appendix E (granular PR breakdown)

### 12.1 Phase Overview

| Phase | Releases | Focus |
|-------|----------|-------|
| **Phase 0** | 001-010 | Netcode Readiness |
| **Phase 1** | 011-020 | Feature Implementation |
| **Phase 2** | 021-025 | Multiplayer |

### 12.2 Release Schedule

**Phase 0: Netcode Readiness**

| Release | Title | Key Deliverable |
|---------|-------|-----------------|
| 001 | Fixed Timestep | 20Hz SimCore heartbeat |
| 002 | Command Buffer | Command objects |
| 003 | Deterministic IDs | Sequential counter |
| 004 | Seeded RNG | Mulberry32 |
| 005 | State Surface | Auth vs render separation |
| 006 | Transport Shim | ITransport + LocalTransport |
| 007 | Interpolation | Smooth visuals |
| 008 | Pathfinding | Deterministic paths |
| 009 | Determinism Verification | Dual-instance + Replay test |
| 010 | Backend Scaffold | Supabase integration |

**Phase 1: Features**

| Release | Title |
|---------|-------|
| 011 | MOVE_ROLL |
| 012 | Perception (FOW) |
| 013 | Mining |
| 014 | Transport |
| 015 | Combat |
| 016 | Subsurface Scan |
| 017 | Terrain Shaping |
| 018 | Unit Carrier |
| 019 | Designer UI |
| 020 | Full GRFDTRDPU |

**Phase 2: Multiplayer**

| Release | Title |
|---------|-------|
| 021 | Supabase Signaling |
| 022 | WebRTC Transport |
| 023 | Host Migration |
| 024 | Late Join |
| 025 | Multiplayer Polish |

### 12.3 PR Granularity Standard

Each PR should:
- Touch **max 3 files**
- Be **< 500 lines** (prefer < 200)
- Include **unit tests**
- Have **rollback instructions**
- Be independently mergeable

---

## 13. Testing, CI & Observability

### 13.1 CI/CD Pipeline (NEW)

**GitHub Actions Workflow:**

```yaml
# .github/workflows/ci.yml
name: CI

on: [push, pull_request]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run lint

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm test

  determinism:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run test:determinism
```

**Add PR for CI:** Release 000.x (pre-001)

### 13.2 Determinism Test

```javascript
describe('Determinism Verification', () => {
  test('two instances match after 1000 ticks', () => {
    const sim1 = new SimCore({ seed: 12345 });
    const sim2 = new SimCore({ seed: 12345 });

    const commands = generateTestCommands(100);
    commands.forEach(cmd => {
      sim1.queueCommand({ ...cmd });
      sim2.queueCommand({ ...cmd });
    });

    for (let i = 0; i < 1000; i++) {
      sim1.step();
      sim2.step();
      if (i % 60 === 0) {
        expect(sim1.stateHash()).toBe(sim2.stateHash());
      }
    }
  });
});
```

### 13.3 Performance Budgets

| Metric | Budget |
|--------|--------|
| Sim tick time | < 8ms (p95) |
| Render frame time | < 16ms (60 FPS) |
| Command queue depth | < 100 |
| Entity count | < 500 |
| Network bandwidth | < 50KB/s per client |

---

## 14. Risk Register

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Performance Ceiling** | Medium | High | Web Worker for SimCore; time budgeting |
| **Determinism Drift** | High | Critical | State hash every 60 ticks; auto-resync |
| **Unit.js Coupling** | High | Medium | Incremental extraction via shims |
| **NAT Traversal Failure** | Medium | Medium | TURN fallback; WebSocket option Phase 3 |
| **Scope Creep** | High | Medium | Strict phase gates; defer non-essential |

---

## 15. Coverage Proof

**BINDING:** Every row in `COVERAGE_MATRIX.md` is explicitly addressed.

| Coverage Matrix Topic | Section in This Document | Status |
|-----------------------|--------------------------|--------|
| Multiplayer Internet Stack | Section 5 | COVERED |
| Backend / Services | Section 7 | COVERED |
| Persistence / Snapshots / Replay | Section 8 | COVERED (Replay added) |
| Determinism Strategy | Section 6 | COVERED |
| SimCore vs View Boundaries | Section 4 | COVERED (Folder structure added) |
| GRFDTRDPU Implementation | Section 9 | COVERED |
| Feature Dependency Graph | Section 10 | COVERED |
| UI/UX Pipeline | Section 11 | COVERED (Tech stack decided) |
| Testing / CI / Observability | Section 13 | COVERED (CI/CD added) |
| Risk Register | Section 14 | COVERED |
| Release / Sprint / PR Execution | Section 12 | COVERED |

**Gaps Resolved:**
1. **Replay System:** Added Section 8.3
2. **UI Tech Stack:** Decided in Section 11.1 (Vanilla Custom Elements)
3. **CI/CD:** Added Section 13.1 with GitHub Actions YAML
4. **SimCore Folder Structure:** Added Section 4.2

---

**End of MASTER_PLAN_MERGED_v1**

*Total Word Count: ~3,200 words (main document)*
*For implementation details, see linked appendices.*
