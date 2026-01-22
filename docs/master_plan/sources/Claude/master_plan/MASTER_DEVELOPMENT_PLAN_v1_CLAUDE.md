# ASTEROBIA — MASTER DEVELOPMENT PLAN v1 (CLAUDE CODE)

**Status:** READY FOR PLAN REVIEW
**Date:** 2026-01-21
**Author:** Claude Code (Anthropic)
**Role:** Implementer / PR Sequencer
**Scope:** End-to-End Implementation Plan from Netcode Readiness through Full Multiplayer Gameplay

---

## PROOF-OF-READ: Sources Read (RAW Links Actually Opened)

### Reading Library RAW Links Opened (External)

**Core Docs (main):**
- https://raw.githubusercontent.com/lendvaiadam/asterobia/main/docs/START_HERE.md
- https://raw.githubusercontent.com/lendvaiadam/asterobia/main/docs/STATUS_WALKTHROUGH.md
- https://raw.githubusercontent.com/lendvaiadam/asterobia/main/docs/CHATGPT_OPENING_PACK.md
- https://raw.githubusercontent.com/lendvaiadam/asterobia/main/docs/PLANNING_PROTOCOL.md
- https://raw.githubusercontent.com/lendvaiadam/asterobia/main/docs/IMPLEMENTATION_GATES.md
- https://raw.githubusercontent.com/lendvaiadam/asterobia/main/docs/CANONICAL_SOURCES_INDEX.md
- https://raw.githubusercontent.com/lendvaiadam/asterobia/main/docs/CURRENT_SYSTEM_SPEC.md
- https://raw.githubusercontent.com/lendvaiadam/asterobia/main/docs/BUGBOOK.md
- https://raw.githubusercontent.com/lendvaiadam/asterobia/main/docs/RELEASE_PLAN.md
- https://raw.githubusercontent.com/lendvaiadam/asterobia/main/docs/RELEASE_SYSTEM.md
- https://raw.githubusercontent.com/lendvaiadam/asterobia/main/docs/VERSIONING_ROLLBACK.md
- https://raw.githubusercontent.com/lendvaiadam/asterobia/main/docs/MAILBOX.md
- https://raw.githubusercontent.com/lendvaiadam/asterobia/main/docs/NOTES_CHATGPT.md
- https://raw.githubusercontent.com/lendvaiadam/asterobia/main/docs/NOTES_ANTIGRAVITY.md
- https://raw.githubusercontent.com/lendvaiadam/asterobia/main/docs/IDEA_LOG.md

**Quality (main):**
- https://raw.githubusercontent.com/lendvaiadam/asterobia/main/quality/NETCODE_READINESS_AUDIT.md
- https://raw.githubusercontent.com/lendvaiadam/asterobia/main/quality/STATE_SURFACE_MAP.md
- https://raw.githubusercontent.com/lendvaiadam/asterobia/main/quality/MULTIPLAYER_TARGET_CHOICE.md

**Quality Archive (Read locally due to 404 on RAW - files exist in repo):**
- quality/archive/LOCAL_VS_GITHUB_PUBLISH_DIFF.md
- quality/archive/NETCODE_PREFLIGHT.md
- quality/archive/RELEASE_SYSTEM_REPORT.md
- quality/archive/REPO_REALITY_MAP.md

**Canonical Specs (main):**
- https://raw.githubusercontent.com/lendvaiadam/asterobia/main/publish/quality_docs_snapshot_2026-01-14/spec_sources/ASTROBIA_CANONICAL_MASTER_BIBLE_2026-01-13.md
- https://raw.githubusercontent.com/lendvaiadam/asterobia/main/publish/quality_docs_snapshot_2026-01-14/spec_sources/ASTROBIA_CANONICAL_GRFDTRDPU_SYSTEM_2026-01-13.md
- https://raw.githubusercontent.com/lendvaiadam/asterobia/main/publish/quality_docs_snapshot_2026-01-14/spec_sources/ASTROBIA_CANONICAL_REFACTOR_PROCESS_2026-01-13.md
- https://raw.githubusercontent.com/lendvaiadam/asterobia/main/publish/quality_docs_snapshot_2026-01-14/spec_sources/ASTROBIA_CANONICAL_VISION_MAX_SOURCES_POLICY_2026-01-13.md
- https://raw.githubusercontent.com/lendvaiadam/asterobia/main/publish/quality_docs_snapshot_2026-01-14/spec_sources/ASTROBIA_CANONICAL_FEATURE_MOVE_ROLL_2026-01-13.md
- https://raw.githubusercontent.com/lendvaiadam/asterobia/main/publish/quality_docs_snapshot_2026-01-14/spec_sources/ASTROBIA_CANONICAL_FEATURE_WPN_SHOOT_2026-01-13.md
- https://raw.githubusercontent.com/lendvaiadam/asterobia/main/publish/quality_docs_snapshot_2026-01-14/spec_sources/ASTROBIA_CANONICAL_FEATURE_PERCEPTION_OPTICAL_VISION_2026-01-13.md
- https://raw.githubusercontent.com/lendvaiadam/asterobia/main/publish/quality_docs_snapshot_2026-01-14/spec_sources/ASTROBIA_CANONICAL_FEATURE_PERCEPTION_SUBSURFACE_SCAN_2026-01-13.md
- https://raw.githubusercontent.com/lendvaiadam/asterobia/main/publish/quality_docs_snapshot_2026-01-14/spec_sources/ASTROBIA_CANONICAL_FEATURE_MATERA_MINING_2026-01-13.md
- https://raw.githubusercontent.com/lendvaiadam/asterobia/main/publish/quality_docs_snapshot_2026-01-14/spec_sources/ASTROBIA_CANONICAL_FEATURE_MATERA_TRANSPORT_2026-01-13.md
- https://raw.githubusercontent.com/lendvaiadam/asterobia/main/publish/quality_docs_snapshot_2026-01-14/spec_sources/ASTROBIA_CANONICAL_FEATURE_TERRAIN_SHAPING_2026-01-13.md
- https://raw.githubusercontent.com/lendvaiadam/asterobia/main/publish/quality_docs_snapshot_2026-01-14/spec_sources/ASTROBIA_CANONICAL_FEATURE_UNIT_CARRIER_2026-01-13.md

**Source Integrity:**
- https://raw.githubusercontent.com/lendvaiadam/asterobia/main/index.html
- https://raw.githubusercontent.com/lendvaiadam/asterobia/main/package.json
- https://raw.githubusercontent.com/lendvaiadam/asterobia/main/src/Main.js

### Repo-Local MD Files Read (All 60 files in MD_FILE_INDEX.txt)

All tracked markdown files enumerated via `git ls-files '*.md'` were read during the READ GATE process. The complete list is saved in:
- `docs/master_plan/Claude/appendices/MD_FILE_INDEX.txt`

---

## 1. Table of Contents

1. [Proof-of-Read](#proof-of-read-sources-read-raw-links-actually-opened)
2. [Big Picture "Done Means"](#2-big-picture-done-means)
3. [Scope Map](#3-scope-map)
4. [Architecture Overview](#4-architecture-overview)
5. [Multiplayer Endgame Plan](#5-multiplayer-endgame-plan)
6. [Backend & Persistence Plan](#6-backend--persistence-plan)
7. [GRFDTRDPU / R&D / Production System Plan](#7-grfdtrdpu--rd--production-system-plan)
8. [Full Feature Roadmap](#8-full-feature-roadmap)
9. [Delivery Plan: Releases + Sprints + PR Breakdown](#9-delivery-plan-releases--sprints--pr-breakdown)
10. [QA / Test Strategy](#10-qa--test-strategy)
11. [Risk Register + Mitigations](#11-risk-register--mitigations)
12. [Alternatives & Tradeoffs](#12-alternatives--tradeoffs)
13. [Open Decisions](#13-open-decisions)

**Appendices:**
- [Appendix A: Multiplayer & Internet Stack](./appendices/APPENDIX_A_MULTIPLAYER_INTERNET_STACK.md)
- [Appendix B: Backend Data Model](./appendices/APPENDIX_B_BACKEND_DATA_MODEL.md)
- [Appendix C: GRFDTRDPU Implementation](./appendices/APPENDIX_C_GRFDTRDPU_IMPLEMENTATION.md)
- [Appendix D: Feature Dependency Graph](./appendices/APPENDIX_D_FEATURE_DEPENDENCY_GRAPH.md)
- [Appendix E: Releases, Sprints & PR Plan](./appendices/APPENDIX_E_RELEASES_SPRINTS_PR_PLAN.md)
- [Appendix F: Testing, Risks & Observability](./appendices/APPENDIX_F_TESTING_RISKS_OBSERVABILITY.md)

---

## 2. Big Picture "Done Means"

### 2.1 What Currently Exists

Based on the codebase analysis from `CURRENT_SYSTEM_SPEC.md`, `REPO_REALITY_MAP.md`, and `NETCODE_READINESS_AUDIT.md`:

**Current State:**
- **Game.js**: Monolithic "god class" (~2000 lines) handling initialization, rendering, input, and game loop
- **Unit.js**: Monolithic entity (~1500 lines) mixing physics, animation, effects, and state
- **SimCore**: Skeletal framework exists in `src/SimCore/` with domain/rules/runtime/systems structure
- **FogOfWar/VisionSystem**: GPU-based rendering working but not gameplay-coupled
- **Pathfinding**: Functional Catmull-Rom smoothing with waypoint editing
- **Camera**: Mature system (v4) with multiple modes

**Critical Gaps:**
- Variable timestep using `clock.getDelta()` - non-deterministic
- Unseeded `Math.random()` throughout logic
- `Date.now()` used for entity IDs
- No command queue abstraction
- No state serialization
- No transport layer abstraction
- Authoritative state mixed with render state

### 2.2 What "Playable" Means (Acceptance Criteria)

The project is considered **playable** when:

1. **Single-Player Loop Works:**
   - Player can design and produce units using the Designer UI
   - Units move via MOVE_ROLL on spherical terrain with proper slope physics
   - Mining extracts Matera to surface piles
   - Transport units haul resources to base
   - Combat between units with WPN_SHOOT
   - Fog of war reveals based on unit perception

2. **Multiplayer Works:**
   - Two players can connect via WebRTC (P2P)
   - Host runs authoritative simulation
   - Clients send commands and receive state snapshots
   - No desync over 5 minutes of gameplay

3. **Persistence Works:**
   - Game state can be saved and loaded
   - Blueprint library persists across sessions
   - Explored fog-of-war state survives reload

### 2.3 What "Deployed" Means

**Deployment Acceptance:**
- Game accessible at play.asterobia.com (GitHub Pages)
- Version selector shows all releases
- Supabase backend handles auth and matchmaking
- Release tagged in git with entry in `public/versions.json`

### 2.4 Concrete "Done" Checklist

| Criterion | Verification Method |
|-----------|---------------------|
| Fixed 20Hz SimCore tick | Throttle CPU, verify logic stays 20Hz while render drops |
| Command-stream input | All inputs flow through CommandQueue, no direct state mutation |
| Deterministic IDs | No `Date.now()` or `Math.random()` in ID generation |
| Seeded PRNG | `Math.random()` only in render effects, `sim.rng()` in logic |
| State serialization | `SimCore.serialize()` produces identical output for identical state |
| ITransport abstraction | Can swap LocalTransport for WebRTCTransport without code changes |
| Two-player session | Host + Client play together with synchronized state |
| GRFDTRDPU pipeline active | Can research, design, produce, and upgrade units |
| All 7 features implemented | MOVE_ROLL, WPN_SHOOT, OPTICAL_VISION, SUBSURFACE_SCAN, MINING, TRANSPORT, TERRAIN_SHAPING |

---

## 3. Scope Map

### 3.1 Included (In Scope)

**Source:** Canonical specs in `spec_sources/` and `publish/quality_docs_snapshot_2026-01-14/`

| Category | Features | Source Document |
|----------|----------|-----------------|
| **Netcode Foundation** | Fixed timestep, Command queue, Deterministic IDs, Seeded RNG, State surface, ITransport | MASTER_BIBLE, REFACTOR_PROCESS |
| **Locomotion** | MOVE_ROLL (rolling physics, slope bands, inertia) | FEATURE_MOVE_ROLL |
| **Combat** | WPN_SHOOT (4-axis: power/rate/range/accuracy) | FEATURE_WPN_SHOOT |
| **Perception** | OPTICAL_VISION (passive FOW), SUBSURFACE_SCAN (active pulse) | FEATURE_OPTICAL_VISION, FEATURE_SUBSURFACE_SCAN |
| **Economy** | MATERA_MINING (extraction), MATERA_TRANSPORT (hauling with slowdown) | FEATURE_MINING, FEATURE_TRANSPORT |
| **World Modification** | TERRAIN_SHAPING (dig/build height changes) | FEATURE_TERRAIN_SHAPING |
| **Logistics** | UNIT_CARRIER (pickup and carry other units) | FEATURE_UNIT_CARRIER |
| **Meta-Game** | G-R-F-Tr-D-P-U pipeline (Goals, Research, Features, Training, Design, Production, Upgrade) | GRFDTRDPU_SYSTEM |
| **Multiplayer** | Host-Authoritative model, P2P WebRTC, Supabase signaling | MULTIPLAYER_TARGET_CHOICE |

### 3.2 Excluded (Out of Scope for v1)

**Based on canonical docs and explicit deferrals:**

| Excluded Item | Reason | Source |
|---------------|--------|--------|
| MOVE_FLY (flying locomotion) | Explicitly Phase 2 | MASTER_BIBLE |
| MOVE_SWIM (swimming) | Requires COLLISION_WATER trigger first | MASTER_BIBLE Goal mapping |
| Shields / Stealth | Mentioned but not specified | GRFDTRDPU_SYSTEM |
| Headless Server | Building Host-Auth first; dedicated server is Phase 2 | MULTIPLAYER_TARGET_CHOICE |
| Deep AI (Machine Learning) | Mirror AI is behavior stub only | MASTER_BIBLE |
| Mobile/Touch controls | Desktop browser only for v1 | Implicit |
| VR/AR support | Not mentioned in specs | Implicit |

### 3.3 Canonical Precedence

Per `MASTER_BIBLE` Section 1:

1. **Master Bible** (project philosophy, boundaries, invariants)
2. **Engine Contract** (GRFDTRDPU pipeline, data contracts)
3. **Feature Specs** (individual feature behavior)
4. **Runtime Service Specs** (FogOfWar, VisionSystem)
5. **Legacy snapshots** (non-canonical unless copied up)

**Conflict Resolution:** Higher-precedence document wins.

---

## 4. Architecture Overview

### 4.1 Current Architecture (As-Is)

```
[User Input]
     |
     v
[InteractionManager] --> direct mutation --> [Unit.js]
     |                                           |
     v                                           v
[Camera] <-- reads position -- [Game.js] -- owns --> [Scene/Renderer]
                                  |
                                  v
                         [FogOfWar] <-- [VisionSystem]
```

**Problems:**
- Input directly mutates state
- Game.js orchestrates everything (2000+ lines)
- Unit.js contains both logic and rendering
- No separation of authoritative vs render state
- Frame-rate dependent timing

### 4.2 Target Architecture (To-Be)

```
[User Input]
     |
     v
[CommandFactory] --> Command objects --> [ITransport]
                                              |
     +----------------------------------------+
     |                                        |
     v                                        v
[LocalTransport]                      [WebRTCTransport]
     |                                        |
     +----------------+------------------------+
                      |
                      v
              [SimCore (Authority)]
                 - 20Hz fixed tick
                 - CommandQueue consumer
                 - State tree owner
                 - Seeded RNG
                      |
                      v
              [State Snapshot]
                      |
        +-------------+--------------+
        |                            |
        v                            v
[HostView (interpolate)]    [ClientView (interpolate)]
        |                            |
        v                            v
[Three.js Renderer]         [Three.js Renderer]
```

### 4.3 Key Architectural Principles

**Source:** `REFACTOR_PROCESS`, `IMPLEMENTATION_GATES`

1. **SimCore is Renderer-Agnostic**
   - No Three.js imports
   - No DOM/window dependencies
   - Must run in Web Worker or Node.js

2. **View Layer is Stateless**
   - Reads from SimCore state
   - Interpolates between snapshots for smooth visuals
   - Never mutates game state

3. **Command Queue Only**
   - All player input becomes Command objects
   - Commands stamped with tick ID
   - SimCore processes commands at designated tick

4. **Determinism is Non-Negotiable**
   - Same inputs + same seed = same outputs
   - No wall-clock time in logic
   - No unseeded random in logic

### 4.4 Data Flow Diagram

```
Frame N (Host):
  1. Accumulator += delta
  2. While (accumulator >= 50ms):
       a. Read CommandQueue for this tick
       b. SimCore.step() - advance all systems
       c. Emit StateSnapshot
       d. accumulator -= 50ms
  3. View.interpolate(prevState, currState, alpha)
  4. Renderer.render()

Frame N (Client):
  1. Send local commands via ITransport
  2. Receive StateSnapshot from Host
  3. View.interpolate(prevSnapshot, currSnapshot, alpha)
  4. Renderer.render()
```

### 4.5 Determinism Strategy

**Source:** `NETCODE_READINESS_AUDIT`, `IMPLEMENTATION_GATES`

| Concern | Problem | Solution |
|---------|---------|----------|
| **Timestep** | `clock.getDelta()` varies with FPS | Accumulator pattern, fixed 50ms (20Hz) |
| **Random** | `Math.random()` unseeded | Mulberry32 PRNG with state in SimCore |
| **IDs** | `Date.now().toString(36)` | `sim.nextId++` (sequential integer) |
| **Floats** | IEEE 754 variance across browsers | Monitor for desync; fixed-point if needed |
| **Iteration** | Array order may vary | Explicit sort with tie-breaker (ID) |

---

## 5. Multiplayer Endgame Plan

### 5.1 Progression Path

**Source:** `MULTIPLAYER_TARGET_CHOICE`, `MASTER_BIBLE`

```
Phase 0: Local Loopback
    |
    v
Phase 1: LAN / Same Network (BroadcastChannel)
    |
    v
Phase 2: Real Internet (WebRTC P2P)
    |
    v
Phase 3 (Future): Dedicated Server
```

### 5.2 Transport Options Analysis

#### Option A: WebSocket (Client-Server)

**Pros:**
- Standard, well-supported
- Works through all firewalls
- Simple implementation

**Cons:**
- Requires always-on server
- Server relay adds latency
- Server costs for hosting

**Decision Trigger:** Choose if NAT traversal fails frequently in WebRTC

#### Option B: WebRTC DataChannels (P2P)

**Pros:**
- Direct peer connection (lowest latency)
- No game server costs (only signaling)
- Scales with players (host handles computation)

**Cons:**
- Complex NAT traversal (ICE/STUN/TURN)
- Host player has 0 latency advantage
- Requires signaling infrastructure

**Decision Trigger:** Prefer for Host-Authoritative model

#### Option C: Hybrid (WebRTC + WebSocket Fallback)

**Pros:**
- Best of both worlds
- Graceful degradation

**Cons:**
- Implementation complexity
- Two code paths to maintain

**SELECTED:** **Option B (WebRTC)** with **Supabase for Signaling**

**Rationale:** Aligns with Host-Authoritative decision. No dedicated game server needed for Phase 1. Can add WebSocket fallback in Phase 3 if NAT issues are severe.

### 5.3 Authority Model

**Model:** Host-Authoritative with Client Prediction (optional)

**Host Responsibilities:**
- Run SimCore at 20Hz
- Validate all incoming commands
- Broadcast state snapshots to clients
- Reject invalid commands (ownership, cooldowns, dead units)

**Client Responsibilities:**
- Send commands to Host via transport
- Receive and interpolate state snapshots
- Optionally predict local inputs (Phase 1.5)

**Tick-Rate:** 20Hz (50ms per tick)
- Balance between responsiveness and bandwidth
- Configurable via `config.tickRate`

### 5.4 Reconciliation Strategy

**Source:** `IMPLEMENTATION_GATES` Section 4

1. **State Hash Comparison:**
   - Host sends `stateHash` every 60 ticks (~3 seconds)
   - Clients compute local hash and compare
   - Mismatch triggers resync

2. **Resync Protocol:**
   - Client requests full snapshot
   - Host sends complete state
   - Client replaces local state
   - Game pauses briefly (acceptable for rare desyncs)

3. **Desync Prevention:**
   - Deterministic everything (RNG, IDs, iteration order)
   - Command validation on Host
   - No client-side state mutation

### 5.5 Session Orchestration

**Lobby Flow:**
1. Host creates lobby (writes to Supabase `lobbies` table)
2. Host starts PeerJS and registers `peer_id`
3. Client queries open lobbies
4. Client selects lobby and gets Host's `peer_id`
5. Client connects to Host via WebRTC
6. Host validates and accepts connection
7. Game starts when Host triggers

**Matchmaking (MVP):**
- Simple lobby browser (no skill-based matching)
- Host can set lobby as public or private
- Private lobbies use share code

### 5.6 Anti-Cheat Notes

**Phase 1 (Host-Auth):**
- Host can cheat (trusted player model)
- Gentleman's agreement for friendly games

**Phase 2+ (Future):**
- Relay server validates commands
- Server-side replay verification
- Ban system for confirmed cheaters

---

## 6. Backend & Persistence Plan

### 6.1 Backend Responsibilities

**Service:** Supabase (PostgreSQL + Auth + Realtime)

| Function | Implementation |
|----------|----------------|
| **Authentication** | Supabase Auth (Email, Discord, Anonymous) |
| **Player Profiles** | `profiles` table linked to auth.users |
| **Blueprint Library** | `blueprints` table (user's saved designs) |
| **Lobby/Matchmaking** | `lobbies` table with Realtime subscriptions |
| **Telemetry** | `events` table for analytics (optional) |

### 6.2 Database Schema

**Source:** Appendix B (detailed schema)

**Core Tables:**

```sql
-- Player profiles
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users,
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unit blueprints (designs)
CREATE TABLE blueprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES profiles(id),
  name TEXT NOT NULL, -- "MORDIG10"
  version INTEGER NOT NULL, -- 10 = 100% capacity
  data JSONB NOT NULL, -- full spec
  is_public BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(owner_id, name, version)
);

-- Game lobbies
CREATE TABLE lobbies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id UUID REFERENCES profiles(id),
  host_peer_id TEXT, -- PeerJS ID
  name TEXT,
  status TEXT DEFAULT 'OPEN', -- OPEN, PLAYING, CLOSED
  max_players INTEGER DEFAULT 2,
  players JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 6.3 Snapshot Strategy

**Local Persistence (Autosave):**
- Save to localStorage every 60 seconds
- Save on explicit "Save" command
- Save on tab close (beforeunload)

**Format:** JSON with compression (LZ-String)

**Contents:**
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

### 6.4 Migration Strategy

**Schema Versioning:**
- Store `schemaVersion` in save data
- Migration functions for each version bump
- Graceful degradation for unknown versions

**Backward Compatibility:**
- Support loading saves from previous 2 minor versions
- Warn user when loading old save
- Option to export save for manual migration

### 6.5 Observability

**Metrics to Track:**
- Tick execution time (p50, p95, p99)
- Command queue depth
- Entity count
- Network latency (RTT to host)
- Desync events

**Logging:**
- Console logs in development
- Structured logging to Supabase `events` in production (opt-in)

---

## 7. GRFDTRDPU / R&D / Production System Plan

### 7.1 Pipeline Overview

**Source:** `GRFDTRDPU_SYSTEM`, `MASTER_BIBLE`

```
[G] Goals/Needs
      |
      v
[R] Research (Invent / Extend)
      |
      v
[F] Features (Runtime modules)
      |
      v
[Tr] Training (Player skill multipliers)
      |
      v
[D] Design (Blueprint creation)
      |
      v
[P] Production (Unit manufacturing)
      |
      v
[U] Upgrade/Rebuild (Evolution)
```

### 7.2 Module Mapping

| Pipeline Stage | SimCore Module | Data Structure |
|----------------|----------------|----------------|
| **G (Goals)** | `SimCore/modules/GoalEvaluator.js` | `Goal { id, type, triggerEvent, reward, status }` |
| **R (Research)** | `SimCore/modules/ResearchLab.js` | `Research { id, featureId, type, progress, cost }` |
| **F (Features)** | `SimCore/features/*.js` | `Feature { id, category, status, baseStats }` |
| **Tr (Training)** | `SimCore/modules/TrainingCenter.js` | `Training { featureId, highScore, multiplier }` |
| **D (Design)** | `SimCore/modules/Designer.js` | `Blueprint { id, name, version, allocations }` |
| **P (Production)** | `SimCore/modules/Factory.js` | `ProductionJob { blueprintId, progress, output }` |
| **U (Upgrade)** | `SimCore/modules/Refitter.js` | `UpgradeJob { unitId, targetVersion, cost }` |

### 7.3 Prototype Limits Implementation

**Feature Unlock Progression:**

```javascript
// FeatureRegistry entry
{
  id: "MOVE_ROLL",
  status: "LOCKED", // or "UNLOCKED"
  baseStats: { maxSpeed: 10, grip: 0.8, torque: 50 },
  constraints: { maxClimbAngle: 40 },
  extend: {
    levels: { maxClimbAngle: 0 }, // current extend level
    caps: { maxClimbAngle: 5 } // max level 5
  }
}
```

**Extend Multiplier Formula:**
```javascript
ExtendMultiplier(level) = 1.0 + (level * 0.5)
// Level 0: 1.0x
// Level 5: 3.5x (cap)
```

**Testing Approach:**
- Unit test: Verify LOCKED features cannot be allocated
- Unit test: Verify ExtendMultiplier caps at 3.5x
- Integration test: Research flow unlocks feature

### 7.4 Release Sequencing

| Release | GRFDTRDPU Component | Dependency |
|---------|---------------------|------------|
| 001-006 | (Foundation) | - |
| 007 | **F** Feature Framework | 006 |
| 008 | **G** Goal System | 007 |
| 009 | **R** Research System | 008 |
| 010 | **D** Designer UI | 009 |
| 011 | **P** Production System | 010 |
| 012 | **Tr** Training System | 011 |
| 013 | **U** Upgrade System | 012 |

---

## 8. Full Feature Roadmap

### 8.1 Feature Dependency Graph

**Source:** Appendix D (visual diagram)

```
                    [Central Unit]
                          |
                    (has OPTICAL_VISION)
                          |
          +---------------+---------------+
          |                               |
    [See Surface]                   [Cannot Move]
          |                               |
          v                               v
    [Discover Matera]              [NEED: Explore]
          |                               |
          v                               v
    [SUBSURFACE_SCAN] <---------- [Invent MOVE_ROLL]
          |
          v
    [Find Matera Mass]
          |
          v
    [NEED: Gather] -----> [Invent MATERA_MINING]
          |
          v
    [Surface Pile Exists]
          |
          v
    [NEED: Collect] -----> [Invent MATERA_TRANSPORT]
          |
          v
    [Height Difference]
          |
          v
    [NEED: Surface Control] -----> [Invent TERRAIN_SHAPING]
          |
          v
    [Enemy Appears]
          |
          v
    [NEED: Combat] -----> [Invent WPN_SHOOT]
          |
          v
    [Deploy Unit Needed]
          |
          v
    [NEED: Deploy] -----> [Invent UNIT_CARRIER]
```

### 8.2 Goal/Need to Feature Unlock Mapping

**Source:** `MASTER_BIBLE` Demo 1.0 Unlock Chain

| Trigger Event | Need Label | Feature Unlocked |
|---------------|------------|------------------|
| Central Unit cannot move | "Explore" | MOVE_ROLL |
| Mobile unit sees surface Matera | "Discover Matera" | PERCEPTION_SUBSURFACE_SCAN |
| Subsurface scan finds Matera mass | "Gather Matera" | MATERA_MINING |
| Mining pile accumulates | "Collect Matera" | MATERA_TRANSPORT |
| Large height difference encountered | "Surface Control" | TERRAIN_SHAPING |
| Unit design needs deployment | "Deploy Unit" | UNIT_CARRIER |
| Enemy appears | "Combat Capability" | WPN_SHOOT |

### 8.3 Feature Implementation Status

| Feature | Current State | Target State | Priority |
|---------|---------------|--------------|----------|
| PERCEPTION_OPTICAL_VISION | Partially implemented (GPU only) | Full SimCore integration | HIGH |
| MOVE_ROLL | In Unit.js (non-deterministic) | SimCore/features/MoveRoll.js | CRITICAL |
| WPN_SHOOT | Not implemented | SimCore/features/WeaponShoot.js | HIGH |
| PERCEPTION_SUBSURFACE_SCAN | Not implemented | SimCore/features/SubsurfaceScan.js | MEDIUM |
| MATERA_MINING | Not implemented | SimCore/features/MateraMining.js | MEDIUM |
| MATERA_TRANSPORT | Not implemented | SimCore/features/MateraTransport.js | MEDIUM |
| TERRAIN_SHAPING | Not implemented | SimCore/features/TerrainShaping.js | LOW |
| UNIT_CARRIER | Not implemented | SimCore/features/UnitCarrier.js | LOW |

### 8.4 Feature Usability Timeline

| Release | Features Usable in Gameplay |
|---------|----------------------------|
| 006 | Basic unit exists, can be commanded (no locomotion) |
| 011 | MOVE_ROLL: Units can move on terrain |
| 012 | OPTICAL_VISION: FOW works per-player |
| 013 | MINING: Can extract resources |
| 014 | TRANSPORT: Can haul resources |
| 015 | COMBAT: Units can shoot |
| 016 | SUBSURFACE_SCAN: Can find underground deposits |
| 017 | TERRAIN_SHAPING: Can modify terrain |
| 018 | UNIT_CARRIER: Can transport units |
| 020 | Full GRFDTRDPU: Can research, design, produce, upgrade |

---

## 9. Delivery Plan: Releases + Sprints + PR Breakdown

### 9.1 Sprint Cadence

**Primary Option: 1-Week Sprints**

**Pros:**
- Rapid iteration
- Quick feedback loops
- Matches solo/small team velocity

**Cons:**
- May feel rushed for larger features
- Less buffer for unexpected issues

**Alternative Option: 2-Week Sprints**

**Pros:**
- More breathing room
- Better for complex features
- Easier planning

**Cons:**
- Slower feedback
- Longer to course-correct

**SELECTED:** 1-Week Sprints with flexibility to extend for complex releases

### 9.2 Release Overview

**Source:** `RELEASE_PLAN.md`, Appendix E (detailed breakdown)

**Phase 0: Netcode Readiness (Releases 001-010)**

| Release | Title | Goal |
|---------|-------|------|
| 001 | Fixed Timestep Authority | 20Hz SimCore heartbeat |
| 002 | Command Buffer Shim | Command objects replace direct mutation |
| 003 | Deterministic IDs | Sequential counter IDs |
| 004 | Seeded RNG | Mulberry32 PRNG in SimCore |
| 005 | State Surface Definition | Authoritative vs render state separation |
| 006 | Local Transport Shim | ITransport with LocalTransport |
| 007 | Snapshot Interpolation | Smooth visuals from state snapshots |
| 008 | Pathfinding Determinism | Deterministic path computation |
| 009 | Full Determinism Verification | Dual-instance hash comparison |
| 010 | Backend Readiness | Supabase integration scaffolding |

**Phase 1: Features (Releases 011-020)**

| Release | Title | Goal |
|---------|-------|------|
| 011 | MOVE_ROLL Implementation | Locomotion feature in SimCore |
| 012 | Perception System | Vision/FOW in SimCore |
| 013 | Mining System | Matera extraction |
| 014 | Transport System | Hauling mechanics |
| 015 | Combat System | WPN_SHOOT implementation |
| 016 | Subsurface Scanning | Underground detection |
| 017 | Terrain Shaping | Dig/build terrain |
| 018 | Unit Carrier | Transport other units |
| 019 | Designer UI | Blueprint creation interface |
| 020 | Full GRFDTRDPU | Complete meta-game pipeline |

**Phase 2: Multiplayer (Releases 021-025)**

| Release | Title | Goal |
|---------|-------|------|
| 021 | Supabase Signaling | Lobby/matchmaking backend |
| 022 | WebRTC Transport | P2P game data |
| 023 | Host Migration | Handle host disconnect |
| 024 | Late Join | Join in-progress games |
| 025 | Multiplayer Polish | UX improvements |

### 9.3 Example Sprint: Release 001 (Detailed PR Breakdown)

**Sprint Goal:** Establish 20Hz fixed-timestep SimCore heartbeat

**Duration:** 1 week

**PRs:**

#### PR 1.1: SimCore Loop Foundation
**Branch:** `pr1-1-simcore-loop`
**Files:**
- `src/SimCore/core/GameLoop.js` (new)
- `src/SimCore/core/TimeSource.js` (new)
- `src/SimCore/index.js` (modify)

**Tasks:**
1. Create `GameLoop` class with accumulator pattern
2. Implement `TimeSource` for deterministic tick counting
3. Export from SimCore index

**Done When:**
- `GameLoop.step()` executes exactly once per 50ms of accumulated time
- `TimeSource.tick` increments by 1 each step
- Unit test passes: 1000ms accumulated = 20 steps

**Tests:**
```javascript
describe('GameLoop', () => {
  it('executes correct number of steps', () => {
    const loop = new GameLoop({ tickRate: 20 });
    loop.accumulate(1000); // 1 second
    expect(loop.tick).toBe(20);
  });
});
```

**Rollback:** Delete new files, no legacy code touched

---

#### PR 1.2: Game.js Shim Integration
**Branch:** `pr1-2-game-shim`
**Files:**
- `src/Core/Game.js` (modify)

**Tasks:**
1. Import `SimCore.GameLoop`
2. Replace `clock.getDelta()` usage with accumulator feed
3. Keep all existing behavior via shim

**Done When:**
- Game runs identically to before
- Console logs show "Tick: N" incrementing at 20Hz
- FPS can vary without affecting tick rate

**Tests:**
- Manual: Throttle CPU, verify tick rate stable
- Manual: Verify gameplay unchanged

**Rollback:** Revert Game.js changes

---

#### PR 1.3: Visual Interpolation Setup
**Branch:** `pr1-3-interpolation`
**Files:**
- `src/Core/Game.js` (modify)
- `src/Entities/Unit.js` (modify)

**Tasks:**
1. Calculate `alpha` = accumulator / TIMESTEP
2. Pass `alpha` to Unit rendering
3. Unit interpolates position between `prevState` and `currState`

**Done When:**
- Movement appears smooth at any FPS
- No visual stuttering when tick rate < frame rate

**Tests:**
- Manual: 144Hz monitor shows smooth movement
- Manual: 20Hz forced render shows smooth movement

**Rollback:** Revert changes to Game.js and Unit.js

---

### 9.4 Sprint Summary Table

| Sprint | Releases | Focus Area |
|--------|----------|------------|
| S1 | 001-002 | Loop & Commands |
| S2 | 003-004 | Determinism |
| S3 | 005 | State Architecture |
| S4 | 006 | Transport Layer |
| S5 | 007-008 | Interpolation & Pathfinding |
| S6 | 009-010 | Verification & Backend |
| S7 | 011 | MOVE_ROLL |
| S8 | 012 | Perception |
| S9 | 013-014 | Mining & Transport |
| S10 | 015 | Combat |
| S11 | 016-018 | Remaining Features |
| S12 | 019-020 | Designer & GRFDTRDPU |
| S13-15 | 021-025 | Multiplayer |

---

## 10. QA / Test Strategy

### 10.1 Determinism Tests

**Critical Test: Dual-Instance Verification**

```javascript
// Run two instances with identical seed and inputs
const sim1 = new SimCore({ seed: 12345 });
const sim2 = new SimCore({ seed: 12345 });

const commands = generateTestCommands(1000);

commands.forEach(cmd => {
  sim1.queueCommand(cmd);
  sim2.queueCommand(cmd);
});

for (let i = 0; i < 1000; i++) {
  sim1.step();
  sim2.step();
  expect(sim1.stateHash()).toBe(sim2.stateHash());
}
```

**Run Frequency:** Every PR merge

### 10.2 Multiplayer Soak Test

**Test: 5-Minute Session Stability**

1. Start Host instance
2. Connect Client instance
3. Both players issue commands for 5 minutes
4. Compare state hashes every 60 ticks
5. No desync = PASS

**Run Frequency:** Before each Phase 2 release

### 10.3 Performance Budgets

| Metric | Budget | Measurement |
|--------|--------|-------------|
| Sim tick time | < 8ms (p95) | `performance.now()` around `step()` |
| Render frame time | < 16ms (60 FPS) | Chrome DevTools |
| Command queue depth | < 100 | Counter in SimCore |
| Entity count | < 500 | Stress test |
| Network bandwidth | < 50KB/s per client | WebRTC stats |

### 10.4 CI Pipeline

**Proposed GitHub Actions:**

```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm install
      - run: npm test # Jest unit tests
      - run: npm run test:determinism # Dual-instance test
```

### 10.5 Manual Smoke Test

**Checklist from `SMOKE_CHECKLIST.md`:**

Before every PR merge:
- [ ] Game loads without console errors
- [ ] Camera controls work (pan, orbit, zoom)
- [ ] Unit selection works
- [ ] Unit movement works (if implemented)
- [ ] FOW updates (if implemented)

---

## 11. Risk Register + Mitigations

### 11.1 Critical Risks

#### Risk 1: JavaScript Performance Ceiling
**Probability:** Medium
**Impact:** High
**Description:** JS is single-threaded. If SimCore.step() takes >10ms, browser freezes.

**Mitigations:**
1. Move SimCore to Web Worker (Release 006+)
2. Implement time budgeting (abort low-priority tasks if tick > 5ms)
3. Profile every PR for performance regression
4. Long-term: WASM for heavy math

**Early Warning:** Tick time > 5ms in profiler

---

#### Risk 2: Determinism Drift (Butterfly Effect)
**Probability:** High
**Impact:** Critical
**Description:** Tiny float difference causes divergent game states.

**Mitigations:**
1. State hash comparison every 60 ticks
2. Automatic resync on mismatch
3. Use integer math for critical checks
4. Fixed-point math library as fallback

**Early Warning:** Any desync in dual-instance test

---

#### Risk 3: Unit.js Monolith Coupling
**Probability:** High
**Impact:** Medium
**Description:** Unit.js is deeply coupled to Game.js and Three.js. Extraction is risky.

**Mitigations:**
1. Incremental extraction via shims
2. Never break existing behavior during migration
3. Comprehensive smoke tests after each PR
4. Feature flags to toggle new vs old code paths

**Early Warning:** Smoke test failures

---

#### Risk 4: WebRTC NAT Traversal Failures
**Probability:** Medium
**Impact:** Medium
**Description:** Some network configurations block P2P connections.

**Mitigations:**
1. Use TURN servers as fallback
2. WebSocket fallback option (Phase 3)
3. User-friendly error messaging
4. Connection diagnostics tool

**Early Warning:** > 10% connection failures in testing

---

### 11.2 Risk Severity Matrix

| Risk | Probability | Impact | Priority |
|------|-------------|--------|----------|
| Performance Ceiling | Medium | High | P1 |
| Determinism Drift | High | Critical | P0 |
| Unit.js Coupling | High | Medium | P1 |
| NAT Traversal | Medium | Medium | P2 |
| Scope Creep | High | Medium | P1 |
| Supabase Limits | Low | Medium | P3 |

---

## 12. Alternatives & Tradeoffs

### 12.1 Transport Layer Choice

| Option | Pros | Cons | Choose When |
|--------|------|------|-------------|
| **WebRTC (Selected)** | Low latency, no server costs | NAT complexity | Host-auth model |
| WebSocket | Simple, reliable | Server costs, latency | Dedicated server model |
| Hybrid | Best of both | Complexity | If WebRTC fails often |

**Constraint:** `MULTIPLAYER_TARGET_CHOICE.md` specifies Host-Authoritative, so WebRTC is preferred.

---

### 12.2 State Sync Strategy

| Option | Pros | Cons | Choose When |
|--------|------|------|-------------|
| **Full Snapshots (Selected)** | Simple, reliable | Bandwidth | < 100 entities |
| Delta Compression | Lower bandwidth | Complexity | > 100 entities |
| Input Replay | Minimal bandwidth | Requires perfect determinism | Competitive games |

**Constraint:** Phase 1 targets < 50 entities, so full snapshots are acceptable.

---

### 12.3 Tick Rate

| Option | Pros | Cons | Choose When |
|--------|------|------|-------------|
| 10Hz | Low CPU/bandwidth | Sluggish feel | Turn-based |
| **20Hz (Selected)** | Good balance | Moderate CPU | RTS games |
| 30Hz | Responsive | Higher CPU/bandwidth | Action games |
| 60Hz | Very responsive | High CPU/bandwidth | FPS games |

**Constraint:** `STATUS_WALKTHROUGH.md` suggests 20Hz as default.

---

### 12.4 Physics Library

| Option | Pros | Cons | Choose When |
|--------|------|------|-------------|
| **Custom (Selected)** | Full control, minimal deps | More code to write | Unique mechanics |
| Cannon.js | Feature-rich, stable | Large bundle, overkill | Complex physics |
| Rapier (WASM) | Fast, deterministic | WASM complexity | Performance critical |

**Constraint:** `MOVE_ROLL` requires spherical geometry which generic physics libs don't handle well.

---

## 13. Open Decisions

### OPEN DECISION 1: Authority Tick Rate

**Question:** Should we use 20Hz or 30Hz for SimCore tick rate?

**Options:**

| Option | Pros | Cons |
|--------|------|------|
| **20Hz (Recommended)** | Lower CPU/bandwidth, mentioned in docs | Slightly less responsive |
| 30Hz | More responsive | Higher resource usage |

**Decision Trigger:** Performance profiling during Release 001. If tick time < 5ms at 30Hz, consider upgrading.

**Current Default:** 20Hz per `STATUS_WALKTHROUGH.md`

---

### OPEN DECISION 2: Float vs Fixed-Point Math

**Question:** Should we use native JS floats or fixed-point integers for determinism?

**Options:**

| Option | Pros | Cons |
|--------|------|------|
| **Native Floats (Start here)** | Simple, fast, standard | Potential desync |
| Fixed-Point | Perfect determinism | Complexity, performance |

**Decision Trigger:** If desync occurs in dual-instance tests, migrate to fixed-point.

**Current Default:** Native floats with desync detection

---

### OPEN DECISION 3: Matera Storage Resolution

**Question:** How detailed should terrain modification storage be?

**Options:**

| Option | Pros | Cons |
|--------|------|------|
| Full Resolution | Exact terrain state | Large save files |
| **Variable Resolution (Recommended)** | Efficient storage | Some precision loss |
| Event Replay | Minimal storage | Requires full replay |

**Decision Trigger:** Save file size > 1MB triggers optimization.

**Current Default:** Variable resolution per `BIG_PICTURE_MASTER_PLAN_v1_ANTIGRAVITY.md`

---

### OPEN DECISION 4: Web Worker for SimCore

**Question:** When should SimCore move to a Web Worker?

**Options:**

| Option | Pros | Cons |
|--------|------|------|
| Release 006 (Early) | Unblocks main thread early | Complexity earlier |
| **Release 010 (Phase 0 End)** | Simpler initial development | May need to retrofit |
| Release 015 (When Needed) | Only if performance requires | Risk of late discovery |

**Decision Trigger:** If tick time exceeds 8ms during development.

**Current Default:** Release 010

---

### OPEN DECISION 5: Explored FOW Persistence Format

**Question:** How should we persist the explored fog-of-war state?

**Options:**

| Option | Pros | Cons |
|--------|------|------|
| **CPU Grid (Recommended)** | Easy to serialize, logic-accessible | Needs sync to GPU |
| GPU Readback | Exact visual state | Expensive, async |
| Event Replay | No storage | Impractical for long games |

**Decision Trigger:** Implement CPU grid if gameplay needs visibility checks.

**Current Default:** CPU Grid per `VISION_FOW_REFACTOR_AUDIT.md`

---

*End of Main Document. See Appendices for Implementation Details.*

---

**Word Count:** ~4,500 words (Main document)
**Total with Appendices:** See appendices for full count

---

## Document Metadata

| Field | Value |
|-------|-------|
| Author | Claude Code (Anthropic) |
| Created | 2026-01-21 |
| Status | READY FOR PLAN REVIEW |
| Target Branch | work/release-000-big-picture-master-plan-claude |
| Minimum Word Count | 12,000 (across all files) |
