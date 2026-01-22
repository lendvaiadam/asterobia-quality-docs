# SHORT-TERM PLAN v2: Phase 0 + Phase 1 Core Features (Claude Code)

**Status:** READY FOR REVIEW
**Date:** 2026-01-21
**Author:** Claude Code (Anthropic)
**Scope:** Phase 0 (Netcode Readiness) + Phase 1 (Core Canonical Features)

---

## PROOF-OF-READ: Sources Consulted

### Core Documents Read
- docs/START_HERE.md
- docs/STATUS_WALKTHROUGH.md
- docs/CHATGPT_OPENING_PACK.md
- docs/IMPLEMENTATION_GATES.md
- docs/CANONICAL_SOURCES_INDEX.md

### Canonical Specifications Read
- spec_sources/ASTEROBIA_CANONICAL_MASTER_BIBLE_2026-01-13.md
- spec_sources/ASTEROBIA_CANONICAL_GRFDTRDPU_SYSTEM_2026-01-13.md
- spec_sources/ASTEROBIA_CANONICAL_REFACTOR_PROCESS_2026-01-13.md

### Feature Specifications Read
- spec_sources/ASTEROBIA_CANONICAL_FEATURE_MOVE_ROLL_2026-01-13.md
- spec_sources/ASTEROBIA_CANONICAL_FEATURE_PERCEPTION_OPTICAL_VISION_2026-01-13.md
- spec_sources/ASTEROBIA_CANONICAL_FEATURE_PERCEPTION_SUBSURFACE_SCAN_2026-01-13.md
- spec_sources/ASTEROBIA_CANONICAL_FEATURE_MATERA_MINING_2026-01-13.md
- spec_sources/ASTEROBIA_CANONICAL_FEATURE_MATERA_TRANSPORT_2026-01-13.md
- spec_sources/ASTEROBIA_CANONICAL_FEATURE_TERRAIN_SHAPING_2026-01-13.md

### Quality Audits Read
- quality/NETCODE_READINESS_AUDIT.md
- quality/STATE_SURFACE_MAP.md
- quality/MULTIPLAYER_TARGET_CHOICE.md

### Reference
- docs/master_plan/Claude/MASTER_DEVELOPMENT_PLAN_v1_CLAUDE.md
- docs/master_plan/Claude/appendices/APPENDIX_E_RELEASES_SPRINTS_PR_PLAN.md

---

## 1. Scope Definition

### 1.1 What This Plan Covers

This plan covers **Phase 0 (Netcode Readiness)** plus **Phase 1 (Core Canonical Features)**:

**Phase 0 (Releases 001-010):**
- Fixed 20Hz SimCore authority loop
- Command queue abstraction
- Deterministic ID generation
- Seeded PRNG
- State surface separation
- ITransport abstraction with LocalTransport
- Snapshot interpolation
- Deterministic pathfinding
- Dual-instance verification
- Backend scaffolding

**Phase 1 (Releases 011-020):**
- MOVE_ROLL locomotion
- PERCEPTION_OPTICAL_VISION (FOW integration)
- PERCEPTION_SUBSURFACE_SCAN
- MATERA_MINING
- MATERA_TRANSPORT
- TERRAIN_SHAPING
- WPN_SHOOT (combat)
- UNIT_CARRIER
- Designer UI
- Full GRFDTRDPU pipeline

### 1.2 What This Plan Does NOT Cover

**Explicitly Excluded:**
- Real internet multiplayer (WebRTC, signaling)
- Phase 2 releases (021-025)
- MOVE_FLY, MOVE_SWIM, MOVE_CLIMB (future locomotion)
- Shields, Stealth features
- Mobile/touch controls
- Dedicated server infrastructure

### 1.3 Success Criteria

| Phase | Criterion | Verification |
|-------|-----------|--------------|
| 0 | Fixed 20Hz tick rate | CPU throttle test |
| 0 | Deterministic simulation | Dual-instance hash match |
| 0 | Command-only input | No direct state mutation |
| 1 | MOVE_ROLL works | Unit navigates terrain with slope physics |
| 1 | FOW works per-player | Vision reveals only own units' sight |
| 1 | Mining works | Matera extracted to surface piles |
| 1 | Transport works | Cargo hauled to base with slowdown |
| 1 | Combat works | Units can shoot and damage |
| 1 | GRFDTRDPU works | Can research, design, produce, upgrade |

---

## 2. Phase 0 Summary (See v1 Plan for Details)

Phase 0 is fully documented in `SHORT_TERM_PLAN_v1_CLAUDE.md`. This section provides a summary.

### 2.1 Release Overview

| Release | Title | Key Deliverable |
|---------|-------|-----------------|
| 001 | Fixed Timestep Authority | 20Hz SimCore heartbeat |
| 002 | Command Buffer Shim | Command objects |
| 003 | Deterministic IDs | Sequential counter |
| 004 | Seeded RNG | Mulberry32 PRNG |
| 005 | State Surface Definition | Authoritative vs render separation |
| 006 | Local Transport Shim | ITransport abstraction |
| 007 | Snapshot Interpolation | Smooth visuals |
| 008 | Pathfinding Determinism | Stable path computation |
| 009 | Full Determinism Verification | Dual-instance test |
| 010 | Backend Readiness | Supabase scaffold |

### 2.2 Phase 0 Duration
**Estimated:** 6 weeks

---

## 3. Phase 1: Core Feature Implementation

### 3.1 Feature Lane Taxonomy

**Source:** IMPLEMENTATION_GATES.md, GRFDTRDPU_SYSTEM

| Lane | Features | Type |
|------|----------|------|
| LOCOMOTION | MOVE_ROLL, UNIT_CARRIER, MATERA_TRANSPORT | Action |
| TOOL | TERRAIN_SHAPING, MATERA_MINING | Action |
| WEAPON | WPN_SHOOT | Action |
| PERCEPTION | SUBSURFACE_SCAN | Action |
| (none) | OPTICAL_VISION | Passive |

**Lane Rules:**
- Within a lane: mutually exclusive (cannot overlap in time)
- Across lanes: may run in parallel unless constraint flags prevent

### 3.2 Feature Dependency Chain

**Source:** MASTER_BIBLE Demo 1.0 Unlock Chain

```
Central Unit (has OPTICAL_VISION, SYS_RESEARCH, SYS_DESIGN, SYS_PRODUCTION)
    |
    v
[Cannot Move] --> NEED: "Explore" --> Invent MOVE_ROLL
    |
    v
[See Surface Matera] --> NEED: "Discover Matera" --> Invent SUBSURFACE_SCAN
    |
    v
[Find Matera Mass] --> NEED: "Gather Matera" --> Invent MATERA_MINING
    |
    v
[Pile Accumulates] --> NEED: "Collect Matera" --> Invent MATERA_TRANSPORT
    |
    v
[Height Difference] --> NEED: "Surface Control" --> Invent TERRAIN_SHAPING
    |
    v
[Non-mobile Design] --> NEED: "Deploy Unit" --> Invent UNIT_CARRIER
    |
    v
[Enemy Appears] --> NEED: "Combat Capability" --> Invent WPN_SHOOT
```

---

## 4. Release 011: MOVE_ROLL Implementation

**Goal:** Implement rolling locomotion in SimCore with full slope physics.

**Duration Estimate:** 1 week

### 4.1 Feature Contract

**Source:** ASTEROBIA_CANONICAL_FEATURE_MOVE_ROLL_2026-01-13.md

**Inputs (per tick):**
- `unitState`: position, velocity, up vector, mass, effectiveStats
- `intent`: desiredDirectionTangent, desiredSpeed01, stop flag
- `environment`: terrainQuery, waterMask, rockMask
- `dt`: timestep in seconds

**Outputs:**
- Updated velocity, position
- `movementStatus`: ROLLING | STALLING | SLIDING | BLOCKED | STOPPING | STOPPED
- GameEvents: COLLISION_WATER, BLOCKED_BY_SLOPE, BLOCKED_BY_ROCK

### 4.2 Effective Stats

```javascript
{
  "MOVE_ROLL": {
    "maxSpeed_mps": 4.0,
    "accel_mps2": 1.6,
    "brake_mps2": 2.4,
    "turnRate_radps": 1.8,
    "torque_unitless": 1.0,
    "grip_unitless": 0.85,
    "maxSlopeDeg": 60
  }
}
```

### 4.3 Slope Bands (Canonical)

| Range | Behavior |
|-------|----------|
| 0-10° | Stable - full speed |
| 10-40° | Penalty - speed *= cos(slope) |
| 40-60° | Critical - stall/slide possible based on torque/grip |
| >60° | Blocked - emit BLOCKED_BY_SLOPE |

### 4.4 PRs

#### PR 011.1: Feature Framework
**Branch:** `pr/011-1-feature-framework`
**Size:** M

**Files:**
- `+ src/SimCore/features/FeatureBase.js`
- `+ src/SimCore/features/FeatureRegistry.js`
- `+ src/SimCore/features/index.js`

**Implementation:**
```javascript
// src/SimCore/features/FeatureBase.js
export class FeatureBase {
  constructor(id, config = {}) {
    this.id = id;
    this.isPassive = config.isPassive || false;
    this.lane = config.lane || null; // LOCOMOTION, TOOL, WEAPON, PERCEPTION
  }

  // Override in subclasses
  getEffectiveStats(unit, allocPercent, extendLevel, trainingMultiplier) {
    throw new Error('Not implemented');
  }

  // Override in subclasses
  update(unit, intent, environment, dt) {
    throw new Error('Not implemented');
  }

  // Override for features with persistent state
  serialize() { return null; }
  deserialize(data) {}
}
```

---

#### PR 011.2: MOVE_ROLL Core Physics
**Branch:** `pr/011-2-move-roll-physics`
**Size:** L (500-1000 lines)

**Files:**
- `+ src/SimCore/features/locomotion/MoveRoll.js`
- `+ src/SimCore/features/locomotion/TerrainQuery.js`
- `+ tests/features/MoveRoll.test.js`

**Implementation:**
```javascript
// src/SimCore/features/locomotion/MoveRoll.js
import { FeatureBase } from '../FeatureBase.js';
import { CommandType } from '../../commands/CommandTypes.js';

export class MoveRoll extends FeatureBase {
  constructor() {
    super('MOVE_ROLL', { isPassive: false, lane: 'LOCOMOTION' });
    this.baseStats = {
      maxSpeed: 10,
      accel: 2.0,
      brake: 3.0,
      turnRate: 2.0,
      torque: 1.0,
      grip: 0.85,
      maxSlopeDeg: 60
    };
  }

  getEffectiveStats(unit, allocPercent, extendLevel, trainingMultiplier) {
    const extendMult = 1.0 + (extendLevel * 0.5);
    return {
      maxSpeed: this.baseStats.maxSpeed * allocPercent * extendMult * trainingMultiplier,
      accel: this.baseStats.accel * allocPercent,
      brake: this.baseStats.brake * allocPercent,
      turnRate: this.baseStats.turnRate * allocPercent,
      torque: this.baseStats.torque * extendMult * trainingMultiplier,
      grip: this.baseStats.grip * extendMult * trainingMultiplier,
      maxSlopeDeg: this.baseStats.maxSlopeDeg
    };
  }

  update(unit, intent, environment, dt) {
    const stats = unit.effectiveStats.MOVE_ROLL;
    const terrain = environment.terrainQuery;

    // Get terrain info at unit position
    const normal = terrain.getNormalAt(unit.position);
    const slopeDeg = this.calculateSlope(normal);

    // Check blocking conditions
    if (slopeDeg > stats.maxSlopeDeg) {
      return this.handleBlocked(unit, 'BLOCKED_BY_SLOPE', { slopeDeg });
    }

    if (terrain.isWater(unit.position)) {
      return this.handleBlocked(unit, 'COLLISION_WATER', {});
    }

    // Apply speed penalty for slope
    let speedMult = 1.0;
    if (slopeDeg >= 10 && slopeDeg <= 40) {
      speedMult = Math.cos(slopeDeg * Math.PI / 180);
    } else if (slopeDeg > 40 && slopeDeg <= 60) {
      // Critical band - check torque vs gravity
      speedMult = this.calculateCriticalSpeedMult(unit, stats, slopeDeg);
    }

    // Calculate target velocity
    const targetSpeed = stats.maxSpeed * intent.desiredSpeed01 * speedMult;

    // Apply acceleration/braking with inertia
    const currentSpeed = unit.velocity.length();
    let newSpeed;
    if (currentSpeed < targetSpeed) {
      newSpeed = Math.min(currentSpeed + stats.accel * dt, targetSpeed);
    } else {
      newSpeed = Math.max(currentSpeed - stats.brake * dt, targetSpeed);
    }

    // Apply turning
    const targetDir = intent.desiredDirectionTangent;
    const currentDir = unit.velocity.clone().normalize();
    const maxTurnThisFrame = stats.turnRate * dt;
    const newDir = currentDir.lerp(targetDir, Math.min(1.0, maxTurnThisFrame));

    // Update velocity
    unit.velocity.copy(newDir).multiplyScalar(newSpeed);

    // Update position
    unit.position.add(unit.velocity.clone().multiplyScalar(dt));

    // Update movement status
    unit.movementStatus = newSpeed > 0.01 ? 'ROLLING' : 'STOPPED';

    return { status: unit.movementStatus, events: [] };
  }

  calculateSlope(normal) {
    // Assuming up is (0, 1, 0) in local space
    const up = new Vector3(0, 1, 0);
    const dot = normal.dot(up);
    return Math.acos(dot) * 180 / Math.PI;
  }

  calculateCriticalSpeedMult(unit, stats, slopeDeg) {
    // In critical band, torque fights gravity
    const gravityComponent = Math.sin(slopeDeg * Math.PI / 180);
    const torqueRatio = stats.torque / gravityComponent;

    if (torqueRatio < 0.5) {
      // Stalling/sliding
      unit.movementStatus = 'STALLING';
      return 0.1;
    } else if (torqueRatio < 1.0) {
      // Slow climb
      return 0.3;
    }
    return 0.5;
  }

  handleBlocked(unit, eventType, payload) {
    unit.movementStatus = 'BLOCKED';
    return {
      status: 'BLOCKED',
      events: [{ type: eventType, unitId: unit.id, ...payload }]
    };
  }
}
```

---

#### PR 011.3: Unit.js Integration
**Branch:** `pr/011-3-unit-integration`
**Size:** M

**Files:**
- `~ src/Entities/Unit.js` - integrate MOVE_ROLL feature
- `~ src/Core/Game.js` - call feature update in tick

**Done When:**
- [ ] Unit moves on flat terrain
- [ ] Unit slows on 10-40° slopes
- [ ] Unit stalls/slides on 40-60° slopes (low torque)
- [ ] Unit blocks on >60° slopes with BLOCKED_BY_SLOPE event
- [ ] Unit blocks on water with COLLISION_WATER event
- [ ] Movement is deterministic (dual-instance test passes)

---

## 5. Release 012: Perception System

**Goal:** Implement OPTICAL_VISION as passive feature with FOW integration.

**Duration Estimate:** 1 week

### 5.1 Feature Contract

**Source:** ASTEROBIA_CANONICAL_FEATURE_PERCEPTION_OPTICAL_VISION_2026-01-13.md

**Key Rules:**
- OPTICAL_VISION is **passive** (no command queue lane)
- Only the **local player's units** reveal FOW
- VisionRange is the only numeric stat
- 50% allocation = baseline (current game behavior)
- 100% allocation = 2x baseline

### 5.2 PRs

#### PR 012.1: Perception Feature
**Branch:** `pr/012-1-perception-feature`
**Size:** M

**Files:**
- `+ src/SimCore/features/perception/OpticalVision.js`
- `~ src/SimCore/runtime/VisionSystem.js` - add ownership filter

**Implementation:**
```javascript
// src/SimCore/features/perception/OpticalVision.js
import { FeatureBase } from '../FeatureBase.js';

export class OpticalVision extends FeatureBase {
  constructor() {
    super('PERCEPTION_OPTICAL_VISION', { isPassive: true, lane: null });
    this.baseRangeAt50Percent = 50; // meters - calibratable
  }

  getEffectiveStats(unit, allocPercent, extendLevel, trainingMultiplier) {
    const extendMult = 1.0 + (extendLevel * 0.5);
    const allocScale = Math.min(allocPercent / 0.5, 2.0); // Cap at 2x

    return {
      visionRange: this.baseRangeAt50Percent * allocScale * extendMult * trainingMultiplier
    };
  }

  getVisionSource(unit) {
    const stats = unit.effectiveStats.PERCEPTION_OPTICAL_VISION;
    if (!stats || stats.visionRange <= 0) return null;

    return {
      sourceId: `${unit.ownerId}:${unit.id}:OPTICAL_VISION`,
      ownerId: unit.ownerId,
      worldPos: unit.position.clone(),
      radiusMeters: stats.visionRange,
      channel: 'OPTICAL_VISION'
    };
  }
}
```

---

#### PR 012.2: VisionSystem Ownership Filter
**Branch:** `pr/012-2-ownership-filter`
**Size:** M

**Files:**
- `~ src/SimCore/runtime/VisionSystem.js`

**Key Changes:**
```javascript
collectSources(units, localPlayerId) {
  const sources = [];

  for (const unit of units) {
    // CRITICAL: Only local player units contribute
    if (unit.ownerId !== localPlayerId) continue;

    const feature = unit.getFeature('PERCEPTION_OPTICAL_VISION');
    if (!feature) continue;

    const source = feature.getVisionSource(unit);
    if (source) sources.push(source);
  }

  // Deterministic sort: distance to camera, then unitId tie-breaker
  sources.sort((a, b) => {
    const distDiff = a.distToCamera - b.distToCamera;
    if (Math.abs(distDiff) > 0.001) return distDiff;
    return a.sourceId.localeCompare(b.sourceId); // Stable tie-breaker
  });

  // Apply cap
  return sources.slice(0, this.config.maxSources);
}
```

**Done When:**
- [ ] FOW updates only for local player units
- [ ] Enemy units visible but don't reveal fog
- [ ] Deterministic source ordering (tie-breaker works)
- [ ] maxSources cap respected

---

## 6. Release 013: Mining System

**Goal:** Implement MATERA_MINING for resource extraction.

**Duration Estimate:** 1 week

### 6.1 Feature Contract

**Source:** ASTEROBIA_CANONICAL_FEATURE_MATERA_MINING_2026-01-13.md

**Key Rules:**
- Mining is **continuous** (output proportional to time)
- Requires deposit beneath/near the unit
- Creates surface piles near miner
- Deposit depletes as mining continues
- Lane: TOOL

### 6.2 PRs

#### PR 013.1: World Objects (Deposits and Piles)
**Branch:** `pr/013-1-world-objects`
**Size:** M

**Files:**
- `+ src/SimCore/world/MateraDeposit.js`
- `+ src/SimCore/world/MateraPile.js`
- `+ src/SimCore/world/WorldRegistry.js`

**Implementation:**
```javascript
// src/SimCore/world/MateraDeposit.js
export class MateraDeposit {
  constructor(id, config) {
    this.id = id;
    this.position = config.position;
    this.totalAmount = config.totalAmount;
    this.remainingAmount = config.remainingAmount || config.totalAmount;
    this.materaColor = config.materaColor;
    this.discoveredState = new Map(); // playerId -> discovered volume
  }

  extract(amount) {
    const extracted = Math.min(amount, this.remainingAmount);
    this.remainingAmount -= extracted;
    return extracted;
  }

  isExhausted() {
    return this.remainingAmount <= 0;
  }

  serialize() {
    return {
      id: this.id,
      position: [this.position.x, this.position.y, this.position.z],
      totalAmount: this.totalAmount,
      remainingAmount: this.remainingAmount,
      materaColor: this.materaColor
    };
  }
}
```

---

#### PR 013.2: Mining Feature
**Branch:** `pr/013-2-mining-feature`
**Size:** M

**Files:**
- `+ src/SimCore/features/tool/MateraMining.js`

**Implementation:**
```javascript
// src/SimCore/features/tool/MateraMining.js
import { FeatureBase } from '../FeatureBase.js';

export class MateraMining extends FeatureBase {
  constructor() {
    super('MATERA_MINING', { isPassive: false, lane: 'TOOL' });
    this.baseMiningRate = 1.0; // units per second at 100% allocation
    this.miningRayDepth = 50; // meters
  }

  getEffectiveStats(unit, allocPercent, extendLevel, trainingMultiplier) {
    const extendMult = 1.0 + (extendLevel * 0.5);
    return {
      miningRate: this.baseMiningRate * allocPercent * extendMult * trainingMultiplier
    };
  }

  update(unit, intent, environment, dt) {
    const stats = unit.effectiveStats.MATERA_MINING;
    if (!stats || !intent.miningActive) {
      return { status: 'IDLE', events: [] };
    }

    // Find deposit below unit
    const deposit = environment.worldRegistry.findDepositBelow(
      unit.position,
      this.miningRayDepth
    );

    if (!deposit || deposit.isExhausted()) {
      return { status: 'NO_DEPOSIT', events: [] };
    }

    // Extract matera
    const extracted = deposit.extract(stats.miningRate * dt);
    if (extracted > 0) {
      // Add to nearby pile (or create one)
      const pile = environment.worldRegistry.getOrCreatePileNear(unit.position);
      pile.addAmount(extracted, deposit.materaColor);
    }

    return {
      status: 'MINING',
      events: [],
      extracted: extracted
    };
  }
}
```

**Done When:**
- [ ] Mining extracts from deposit when enabled
- [ ] Surface pile grows with extracted matera
- [ ] Deposit remainingAmount decreases
- [ ] Mining rate scales with allocation
- [ ] Mining persists across save/load

---

## 7. Release 014: Transport System

**Goal:** Implement MATERA_TRANSPORT for hauling resources.

**Duration Estimate:** 1 week

### 7.1 Feature Contract

**Source:** ASTEROBIA_CANONICAL_FEATURE_MATERA_TRANSPORT_2026-01-13.md

**Key Rules:**
- Transport moves matera from piles to base
- Movement slowdown proportional to cargo fill
- Auto pickup/unload at waypoints
- Lane: LOCOMOTION

### 7.2 Slowdown Formula

```javascript
// Canonical formula from spec
transportSpeedFactor = lerp(1.0, transportEff, cargoFill)
// = 1.0 - cargoFill * (1.0 - transportEff)

// Empty: factor = 1.0 (no slowdown)
// Full:  factor = transportEff
// Half:  factor = 0.5 * (1 + transportEff)
```

### 7.3 PRs

#### PR 014.1: Transport Feature
**Branch:** `pr/014-1-transport-feature`
**Size:** M

**Files:**
- `+ src/SimCore/features/locomotion/MateraTransport.js`

**Done When:**
- [ ] Transporter picks up from piles
- [ ] Transporter unloads at base
- [ ] Movement slows with cargo
- [ ] Transport persists across save/load

---

## 8. Release 015: Combat System

**Goal:** Implement WPN_SHOOT for unit combat.

**Duration Estimate:** 1 week

### 8.1 Feature Contract

**Source:** ASTEROBIA_CANONICAL_FEATURE_WPN_SHOOT (referenced in GRFDTRDPU)

**Key Stats (4-axis):**
- Power: damage per shot
- Rate: shots per second
- Range: effective distance
- Accuracy: hit probability

**Lane:** WEAPON

### 8.2 PRs

#### PR 015.1: Combat Feature
**Branch:** `pr/015-1-combat-feature`
**Size:** L

**Files:**
- `+ src/SimCore/features/weapon/WeaponShoot.js`
- `+ src/SimCore/combat/DamageSystem.js`
- `+ src/SimCore/combat/Projectile.js`

**Done When:**
- [ ] Unit can target and shoot enemy
- [ ] Damage applies to target HP
- [ ] Unit dies at 0 HP (becomes wreck)
- [ ] Combat is deterministic

---

## 9. Release 016: Subsurface Scanning

**Goal:** Implement SUBSURFACE_SCAN for finding underground deposits.

**Duration Estimate:** 1 week

### 9.1 Feature Contract

**Source:** ASTEROBIA_CANONICAL_FEATURE_PERCEPTION_SUBSURFACE_SCAN_2026-01-13.md

**Key Rules:**
- Action feature (toggleable ON/OFF)
- Reveals intersection of scan sphere and deposit volume
- Discovery is persistent (survives unit leaving range)
- Lane: PERCEPTION

### 9.2 PRs

#### PR 016.1: Subsurface Scan Feature
**Branch:** `pr/016-1-subsurface-scan`
**Size:** M

**Files:**
- `+ src/SimCore/features/perception/SubsurfaceScan.js`

**Done When:**
- [ ] Scan reveals underground deposits
- [ ] Discovery persists when unit moves away
- [ ] Discovery is per-player (not shared)

---

## 10. Release 017: Terrain Shaping

**Goal:** Implement TERRAIN_SHAPING for modifying terrain height.

**Duration Estimate:** 1 week

### 10.1 Feature Contract

**Source:** ASTEROBIA_CANONICAL_FEATURE_TERRAIN_SHAPING_2026-01-13.md

**Key Rules:**
- Continuous work action (height change per tick)
- Target height keyframes along route
- Convergence by repeated passes
- Lane: TOOL

### 10.2 PRs

#### PR 017.1: Terrain Modification System
**Branch:** `pr/017-1-terrain-modification`
**Size:** L

**Files:**
- `+ src/SimCore/features/tool/TerrainShaping.js`
- `+ src/SimCore/world/TerrainModifications.js`

**Done When:**
- [ ] Can raise/lower terrain at waypoints
- [ ] Terrain changes persist
- [ ] Unit moves with terrain (digs down, builds up)

---

## 11. Release 018: Unit Carrier

**Goal:** Implement UNIT_CARRIER for transporting other units.

**Duration Estimate:** 1 week

### 11.1 Feature Contract

**Source:** Referenced in MASTER_BIBLE Goal mapping

**Key Rules:**
- Can pick up and carry other units
- Carried units are inactive
- Lane: LOCOMOTION

### 11.2 PRs

#### PR 018.1: Carrier Feature
**Branch:** `pr/018-1-carrier-feature`
**Size:** M

**Files:**
- `+ src/SimCore/features/locomotion/UnitCarrier.js`

**Done When:**
- [ ] Can pick up friendly units
- [ ] Carried units invisible/inactive
- [ ] Can deploy carried units

---

## 12. Release 019: Designer UI

**Goal:** Implement blueprint creation interface.

**Duration Estimate:** 1 week

### 12.1 Requirements

**Source:** GRFDTRDPU_SYSTEM Section 6.4

**Key Rules:**
- Allocation sum = 100%
- Minimum allocation = 25% (when included)
- 0% = feature not included
- Nested allocations for some features (e.g., WPN_SHOOT axes)
- Blueprint versioning

### 12.2 PRs

#### PR 019.1: Designer Module
**Branch:** `pr/019-1-designer-module`
**Size:** L

**Files:**
- `+ src/SimCore/modules/Designer.js`
- `+ src/UI/DesignerPanel.js`

**Done When:**
- [ ] Can create new blueprint
- [ ] Can allocate features (100% total)
- [ ] Can set nested allocations
- [ ] Blueprint saved to Supabase

---

## 13. Release 020: Full GRFDTRDPU Pipeline

**Goal:** Implement complete G-R-F-Tr-D-P-U pipeline.

**Duration Estimate:** 1-2 weeks

### 13.1 Module Breakdown

| Stage | Module | Responsibility |
|-------|--------|----------------|
| G | GoalEvaluator | Event -> Need Card generation |
| R | ResearchLab | Invent/Extend features |
| F | FeatureRegistry | Feature availability tracking |
| Tr | TrainingCenter | Mini-game -> global multiplier |
| D | Designer | Blueprint creation |
| P | Factory | Unit production |
| U | Refitter | Unit upgrades |

### 13.2 PRs

#### PR 020.1: Goal System
**Branch:** `pr/020-1-goal-system`
**Size:** M

**Implementation:**
```javascript
// src/SimCore/modules/GoalEvaluator.js
export class GoalEvaluator {
  constructor(simCore) {
    this.simCore = simCore;
    this.activeGoals = new Map();
    this.eventMappings = this.initEventMappings();
  }

  initEventMappings() {
    return {
      'COLLISION_WATER': { needLabel: 'Traverse Water', feature: 'MOVE_SWIM' },
      'BLOCKED_BY_SLOPE': { needLabel: 'Climb Obstacles', feature: 'MOVE_CLIMB' },
      // ... etc from MASTER_BIBLE
    };
  }

  onEvent(event) {
    const mapping = this.eventMappings[event.type];
    if (!mapping) return;

    // Check if feature already unlocked
    if (this.simCore.featureRegistry.isUnlocked(mapping.feature)) return;

    // Check if goal already active
    const goalKey = `INVENT_${mapping.feature}`;
    if (this.activeGoals.has(goalKey)) return;

    // Create need card
    this.createNeedCard(goalKey, mapping);
  }
}
```

---

#### PR 020.2: Research System
**Branch:** `pr/020-2-research-system`
**Size:** M

---

#### PR 020.3: Production System
**Branch:** `pr/020-3-production-system`
**Size:** M

---

#### PR 020.4: Training System
**Branch:** `pr/020-4-training-system`
**Size:** M

---

**Done When:**
- [ ] Need cards appear from gameplay events
- [ ] Can research to unlock features
- [ ] Can design blueprints with unlocked features
- [ ] Can produce units from blueprints
- [ ] Can upgrade existing units
- [ ] Full pipeline works end-to-end

---

## 14. Sprint Schedule

### Phase 0 (from v1 Plan)

| Sprint | Week | Releases | Focus |
|--------|------|----------|-------|
| S1 | 1 | 001, 002 | Fixed timestep + Commands |
| S2 | 2 | 003, 004 | Determinism (IDs + RNG) |
| S3 | 3 | 005 | State architecture |
| S4 | 4 | 006 | Transport abstraction |
| S5 | 5 | 007, 008 | Interpolation + Pathfinding |
| S6 | 6 | 009, 010 | Verification + Backend |

### Phase 1

| Sprint | Week | Releases | Focus |
|--------|------|----------|-------|
| S7 | 7 | 011 | MOVE_ROLL locomotion |
| S8 | 8 | 012 | Perception/FOW |
| S9 | 9 | 013, 014 | Mining + Transport |
| S10 | 10 | 015 | Combat |
| S11 | 11 | 016, 017, 018 | Scan + Terrain + Carrier |
| S12 | 12 | 019, 020 | Designer + GRFDTRDPU |

### Total Duration

| Phase | Weeks |
|-------|-------|
| Phase 0 | 6 |
| Phase 1 | 6 |
| **Total** | **12 weeks** |

---

## 15. Testing Strategy

### 15.1 Unit Tests (Per Feature)

Each feature implementation must include:
- Stats calculation tests
- Update logic tests
- Edge case tests (0% allocation, max values)

### 15.2 Integration Tests

| Test | Description |
|------|-------------|
| Dual-Instance | Two SimCores produce identical state |
| Feature Chain | MINING -> TRANSPORT -> BASE flow works |
| Combat Resolution | Deterministic damage and death |
| GRFDTRDPU Flow | Research -> Design -> Produce -> Deploy |

### 15.3 Acceptance Tests (from IMPLEMENTATION_GATES.md)

**MOVE_ROLL:**
1. Flat movement: Unit reaches maxSpeed on 0-10° terrain
2. Water blocking: Water contact emits COLLISION_WATER and BLOCKED
3. Slope blocking: >60° emits BLOCKED_BY_SLOPE
4. Critical uphill: Low torque stalls; high torque climbs slowly
5. Waypoint integrity: No backward regression after path edit
6. Training effect: Increased training improves grip/torque

**Perception:**
1. Ownership isolation: Enemy units don't reveal player FOW
2. Deterministic ordering: Same sources selected across runs
3. Cap behavior: No crash when sources > maxSources

---

## 16. Risk Register

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Unit.js coupling | High | Medium | Incremental extraction via shims |
| Feature complexity | Medium | High | Start with simplest implementations |
| GRFDTRDPU scope | High | Medium | Stub systems first, add UI later |
| Performance | Medium | Medium | Profile each release |
| Determinism drift | Medium | Critical | Dual-instance test every PR |

---

## 17. Open Decisions

### OPEN DECISION: Feature Allocation Minimum
**Question:** 25% minimum or configurable?
**Default:** 25% (per MASTER_BIBLE)
**Decision Trigger:** Gameplay testing shows need for finer granularity

### OPEN DECISION: Nested Allocation UI
**Question:** How to present nested axes (e.g., WPN_SHOOT power/rate/range/accuracy)?
**Options:** Sliders, pie chart, numeric input
**Decision Trigger:** Designer UI implementation (Release 019)

### OPEN DECISION: Training Mini-Game
**Question:** What is the training mini-game for each feature?
**Default:** Placeholder score input (no actual game)
**Decision Trigger:** Gameplay testing priority

---

## 18. What Comes After Phase 1

Phase 1 completion enables:
- **Phase 2 (Releases 021-025):** Real internet multiplayer
  - Supabase signaling
  - WebRTC transport
  - Host migration
  - Late join

Phase 1 does NOT enable:
- Real internet multiplayer
- MOVE_FLY, MOVE_SWIM (require specific events to unlock)
- Shields, Stealth features

---

**End of SHORT-TERM PLAN v2**

**Word Count:** ~4,200 words
