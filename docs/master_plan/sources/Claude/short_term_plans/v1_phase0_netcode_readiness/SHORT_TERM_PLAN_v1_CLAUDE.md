# SHORT-TERM PLAN v1: Phase 0 Netcode Readiness (Claude Code)

**Status:** READY FOR REVIEW
**Date:** 2026-01-21
**Author:** Claude Code (Anthropic)
**Scope:** Phase 0 ONLY - Local loopback, NO real internet multiplayer

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

### Quality Audits Read
- quality/NETCODE_READINESS_AUDIT.md
- quality/STATE_SURFACE_MAP.md
- quality/MULTIPLAYER_TARGET_CHOICE.md

### Reference
- docs/master_plan/Claude/MASTER_DEVELOPMENT_PLAN_v1_CLAUDE.md
- docs/master_plan/Claude/appendices/APPENDIX_E_RELEASES_SPRINTS_PR_PLAN.md

---

## 1. Scope Definition

### 1.1 What Phase 0 IS

Phase 0 is the **Netcode Readiness** phase. It establishes the architectural foundation required for deterministic simulation and future multiplayer, but does **NOT** implement real internet multiplayer.

**Deliverables:**
- Fixed 20Hz SimCore authority loop
- Command queue abstraction (all inputs as Command objects)
- Deterministic ID generation (sequential integers)
- Seeded PRNG (Mulberry32)
- State surface separation (authoritative vs render state)
- ITransport abstraction with LocalTransport
- Snapshot interpolation for smooth visuals
- Deterministic pathfinding
- Dual-instance verification (determinism proof)
- Backend scaffolding (Supabase auth stubs)

### 1.2 What Phase 0 is NOT

**Explicitly Excluded:**
- WebRTC implementation
- Supabase signaling/matchmaking
- Any real network transport
- Feature implementations (MOVE_ROLL, MINING, etc.)
- Designer UI
- GRFDTRDPU pipeline
- Combat system

**The only "multiplayer" is local loopback** - running two SimCore instances in the same browser and verifying they produce identical results.

### 1.3 Success Criteria

| Criterion | Verification |
|-----------|--------------|
| Fixed 20Hz tick rate | Throttle CPU, verify tick count stable |
| Command-only input | No direct state mutation from InteractionManager |
| Deterministic IDs | No Date.now() or Math.random() in ID generation |
| Seeded RNG | console.log(sim.rng.random()) produces same sequence for same seed |
| State serialization | JSON.stringify(sim.serialize()) is identical for identical states |
| Transport abstraction | Can swap LocalTransport instance without code changes |
| Dual-instance match | Two instances produce identical stateHash for 1000 ticks |

---

## 2. Current State Analysis

### 2.1 Verified Problems (from NETCODE_READINESS_AUDIT.md)

| Component | Issue | Risk Level |
|-----------|-------|------------|
| Game.js | GOD CLASS - manages everything | CRITICAL |
| Unit.js | HYBRID - physics + rendering mixed | CRITICAL |
| Time Delta | `clock.getDelta()` frame-dependent | CRITICAL |
| Randomness | `Math.random()` unseeded | CRITICAL |
| IDs | `Date.now().toString(36)` non-deterministic | CRITICAL |
| Input | Direct state mutation | CRITICAL |
| SimCore | Exists but incomplete | MEDIUM |

### 2.2 Existing Foundation

**Assets We Have:**
- `src/SimCore/` directory structure exists
- `src/SimCore/runtime/Store.js` skeleton present
- `src/SimCore/runtime/VisionSystem.js` partially implemented
- Three.js rendering pipeline functional
- Pathfinding with Catmull-Rom smoothing working
- Camera system mature (v4)

### 2.3 Files to Modify vs Create

**Files to CREATE (new):**
```
src/SimCore/core/GameLoop.js
src/SimCore/core/TimeSource.js
src/SimCore/core/IdGenerator.js
src/SimCore/core/PRNG.js
src/SimCore/commands/CommandTypes.js
src/SimCore/commands/CommandQueue.js
src/SimCore/commands/CommandProcessor.js
src/SimCore/input/InputFactory.js
src/SimCore/state/StateRegistry.js
src/SimCore/state/EntityState.js
src/SimCore/state/Serializer.js
src/SimCore/transport/ITransport.js
src/SimCore/transport/LocalTransport.js
tests/SimCore/determinism.test.js
tests/SimCore/gameloop.test.js
tests/SimCore/commands.test.js
```

**Files to MODIFY (shim integration):**
```
src/Core/Game.js - integrate GameLoop, remove Date.now()/Math.random()
src/Core/InteractionManager.js - use InputFactory instead of direct mutation
src/Entities/Unit.js - add interpolation, separate auth/render state
src/SimCore/index.js - export new modules
```

---

## 3. Release Breakdown

### Release 001: Fixed Timestep Authority

**Goal:** Establish 20Hz SimCore heartbeat independent of render frame rate.

**Duration Estimate:** 1 week

#### PR 001.1: SimCore Loop Foundation
**Branch:** `pr/001-1-simcore-loop`
**Size:** S (< 200 lines)

**Files:**
- `+ src/SimCore/core/GameLoop.js` (new)
- `+ src/SimCore/core/TimeSource.js` (new)
- `~ src/SimCore/index.js` (modify exports)

**Implementation:**
```javascript
// src/SimCore/core/GameLoop.js
export class GameLoop {
  constructor(config = {}) {
    this.tickRate = config.tickRate || 20; // Hz
    this.timestep = 1000 / this.tickRate; // ms (50ms at 20Hz)
    this.accumulator = 0;
    this.tick = 0;
    this.systems = [];
  }

  accumulate(deltaMs) {
    this.accumulator += deltaMs;
    let stepsThisFrame = 0;

    while (this.accumulator >= this.timestep) {
      this.step();
      this.accumulator -= this.timestep;
      stepsThisFrame++;

      // Safety: prevent spiral of death
      if (stepsThisFrame > 5) {
        this.accumulator = 0;
        console.warn('GameLoop: Dropped frames due to slow step()');
        break;
      }
    }

    // Return alpha for interpolation (0..1)
    return this.accumulator / this.timestep;
  }

  step() {
    this.tick++;
    for (const system of this.systems) {
      system.update(this.timestep);
    }
  }

  registerSystem(system) {
    this.systems.push(system);
  }
}
```

**Tests:**
```javascript
describe('GameLoop', () => {
  test('accumulates time correctly', () => {
    const loop = new GameLoop({ tickRate: 20 });
    loop.accumulate(100); // 100ms = 2 ticks at 20Hz (50ms each)
    expect(loop.tick).toBe(2);
  });

  test('returns interpolation alpha', () => {
    const loop = new GameLoop({ tickRate: 20 }); // 50ms timestep
    const alpha = loop.accumulate(75); // 75ms = 1 tick + 25ms
    expect(loop.tick).toBe(1);
    expect(alpha).toBeCloseTo(0.5); // 25/50
  });

  test('prevents spiral of death', () => {
    const loop = new GameLoop({ tickRate: 20 });
    loop.accumulate(10000); // 10 seconds
    expect(loop.tick).toBeLessThanOrEqual(5); // Capped at 5
  });
});
```

**Done When:**
- [ ] Unit tests pass
- [ ] GameLoop.step() executes exactly once per 50ms accumulated
- [ ] No direct dependencies on Three.js or DOM

**Rollback:** Delete new files, no existing code touched.

---

#### PR 001.2: Game.js Shim Integration
**Branch:** `pr/001-2-game-shim`
**Size:** S

**Files:**
- `~ src/Core/Game.js` (modify)

**Implementation:**
```javascript
// In Game.js constructor:
import { GameLoop } from '../SimCore/core/GameLoop.js';

this.gameLoop = new GameLoop({ tickRate: 20 });

// In Game.js animate():
const delta = this.clock.getDelta() * 1000; // Convert to ms
const alpha = this.gameLoop.accumulate(delta);

// Log for verification
if (this.gameLoop.tick % 20 === 0) {
  console.log(`Tick: ${this.gameLoop.tick}, FPS: ${Math.round(1000/delta)}`);
}

// Existing update code continues unchanged for now
```

**Done When:**
- [ ] Console shows "Tick: N" incrementing at ~20 per second
- [ ] Game behavior unchanged from before
- [ ] FPS can vary without affecting tick count

**Rollback:** Revert Game.js changes (single file).

---

#### PR 001.3: Visual Interpolation Setup
**Branch:** `pr/001-3-interpolation`
**Size:** M (200-500 lines)

**Files:**
- `~ src/Core/Game.js` (modify)
- `~ src/Entities/Unit.js` (modify)

**Implementation:**
```javascript
// In Unit.js:
setRenderPosition(alpha) {
  // Interpolate between previous and current authoritative positions
  const prev = this.prevPosition || this.position;
  const curr = this.position;

  this.mesh.position.lerpVectors(prev, curr, alpha);
}

// Before step() in Game.js:
for (const unit of this.units) {
  unit.prevPosition = unit.position.clone();
}

// After accumulate() in Game.js:
const alpha = this.gameLoop.accumulate(delta);
for (const unit of this.units) {
  unit.setRenderPosition(alpha);
}
```

**Done When:**
- [ ] Movement appears smooth at any FPS
- [ ] No visual stuttering when tick rate < frame rate

**Rollback:** Revert changes to Game.js and Unit.js.

---

### Release 002: Command Buffer Shim

**Goal:** All input flows through Command objects, no direct state mutation.

**Duration Estimate:** 1 week

#### PR 002.1: Command Type Definitions
**Branch:** `pr/002-1-command-types`
**Size:** S

**Files:**
- `+ src/SimCore/commands/CommandTypes.js` (new)
- `+ src/SimCore/commands/index.js` (new)

**Implementation:**
```javascript
// src/SimCore/commands/CommandTypes.js
export const CommandType = {
  MOVE: 'MOVE',
  STOP: 'STOP',
  ATTACK: 'ATTACK',
  MINE: 'MINE',
  BUILD: 'BUILD'
};

export function createMoveCommand(playerId, unitIds, targetPosition) {
  return {
    id: null, // Assigned by queue
    type: CommandType.MOVE,
    tick: null, // Assigned by queue
    playerId,
    unitIds,
    payload: { targetPosition }
  };
}

export function createStopCommand(playerId, unitIds) {
  return {
    id: null,
    type: CommandType.STOP,
    tick: null,
    playerId,
    unitIds,
    payload: {}
  };
}
```

---

#### PR 002.2: Command Queue Implementation
**Branch:** `pr/002-2-command-queue`
**Size:** M

**Files:**
- `+ src/SimCore/commands/CommandQueue.js` (new)

**Implementation:**
```javascript
export class CommandQueue {
  constructor(simCore) {
    this.simCore = simCore;
    this.pending = []; // Commands waiting for execution tick
    this.nextId = 0;
  }

  enqueue(command) {
    command.id = `cmd_${this.nextId++}`;
    command.tick = this.simCore.tick + 1; // Execute next tick
    this.pending.push(command);
    return command;
  }

  getCommandsForTick(tick) {
    const commands = this.pending.filter(cmd => cmd.tick === tick);
    this.pending = this.pending.filter(cmd => cmd.tick !== tick);
    return commands;
  }

  clear() {
    this.pending = [];
  }
}
```

---

#### PR 002.3: Input Factory (UI -> Commands)
**Branch:** `pr/002-3-input-factory`
**Size:** M

**Files:**
- `+ src/SimCore/input/InputFactory.js` (new)
- `~ src/Core/InteractionManager.js` (modify)

**Implementation:**
```javascript
// src/SimCore/input/InputFactory.js
import { createMoveCommand, createStopCommand } from '../commands/CommandTypes.js';

export class InputFactory {
  constructor(simCore, playerId) {
    this.simCore = simCore;
    this.playerId = playerId;
  }

  moveSelectedUnits(targetPosition) {
    const selectedIds = this.simCore.getSelectedUnitIds();
    if (selectedIds.length === 0) return null;

    const command = createMoveCommand(this.playerId, selectedIds, targetPosition);
    return this.simCore.commandQueue.enqueue(command);
  }

  stopSelectedUnits() {
    const selectedIds = this.simCore.getSelectedUnitIds();
    if (selectedIds.length === 0) return null;

    const command = createStopCommand(this.playerId, selectedIds);
    return this.simCore.commandQueue.enqueue(command);
  }
}

// In InteractionManager.js - REPLACE:
// OLD: unit.setTarget(targetPosition);
// NEW: this.inputFactory.moveSelectedUnits(targetPosition);
```

---

#### PR 002.4: Command Processor
**Branch:** `pr/002-4-command-processor`
**Size:** M

**Files:**
- `+ src/SimCore/commands/CommandProcessor.js` (new)

**Implementation:**
```javascript
import { CommandType } from './CommandTypes.js';

export class CommandProcessor {
  constructor(simCore) {
    this.simCore = simCore;
    this.handlers = new Map();
    this.registerDefaultHandlers();
  }

  registerDefaultHandlers() {
    this.handlers.set(CommandType.MOVE, this.handleMove.bind(this));
    this.handlers.set(CommandType.STOP, this.handleStop.bind(this));
  }

  processCommands(tick) {
    const commands = this.simCore.commandQueue.getCommandsForTick(tick);

    for (const command of commands) {
      const handler = this.handlers.get(command.type);
      if (handler) {
        handler(command);
      } else {
        console.warn(`No handler for command type: ${command.type}`);
      }
    }
  }

  handleMove(command) {
    for (const unitId of command.unitIds) {
      const unit = this.simCore.getEntity(unitId);
      if (unit && unit.ownerId === command.playerId) {
        unit.setTarget(command.payload.targetPosition);
      }
    }
  }

  handleStop(command) {
    for (const unitId of command.unitIds) {
      const unit = this.simCore.getEntity(unitId);
      if (unit && unit.ownerId === command.playerId) {
        unit.stop();
      }
    }
  }
}
```

**Done When:**
- [ ] Right-clicking to move creates a MOVE command
- [ ] Commands appear in queue with tick stamp
- [ ] Units move only after command is processed next tick
- [ ] Direct mutation code removed from InteractionManager

---

### Release 003: Deterministic IDs

**Goal:** Replace all `Date.now()` and `Math.random()` in ID generation.

**Duration Estimate:** 3 days

#### PR 003.1: Sequential ID Generator
**Branch:** `pr/003-1-sequential-ids`
**Size:** S

**Files:**
- `+ src/SimCore/core/IdGenerator.js` (new)
- `~ src/SimCore/index.js` (modify)

**Implementation:**
```javascript
// src/SimCore/core/IdGenerator.js
export class IdGenerator {
  constructor(startId = 0) {
    this.nextId = startId;
  }

  next(prefix = 'e') {
    return `${prefix}_${this.nextId++}`;
  }

  // For save/load
  getState() {
    return this.nextId;
  }

  setState(id) {
    this.nextId = id;
  }
}
```

---

#### PR 003.2: Remove Date.now() from Codebase
**Branch:** `pr/003-2-remove-date-now`
**Size:** M

**Files to Search and Modify:**
```bash
grep -r "Date.now()" src/ --include="*.js"
grep -r "Math.random()" src/ --include="*.js"
```

**Changes:**
- Replace ID generation in Game.js, Unit.js
- Keep Date.now() ONLY for UI display and logging (not logic)
- Replace Math.random() with sim.rng calls (Release 004)

**Done When:**
- [ ] `grep -r "Date.now()" src/` finds only UI/logging uses
- [ ] All entity IDs are sequential integers

---

### Release 004: Seeded RNG

**Goal:** All gameplay randomness uses seeded PRNG.

**Duration Estimate:** 3 days

#### PR 004.1: Mulberry32 Implementation
**Branch:** `pr/004-1-prng`
**Size:** S

**Files:**
- `+ src/SimCore/core/PRNG.js` (new)

**Implementation:**
```javascript
// Mulberry32 - fast 32-bit PRNG
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

export class SeededRNG {
  constructor(seed) {
    this.seed = seed;
    this.rng = createPRNG(seed);
  }

  random() {
    return this.rng();
  }

  randomInt(min, max) {
    return Math.floor(this.random() * (max - min + 1)) + min;
  }

  randomFloat(min, max) {
    return this.random() * (max - min) + min;
  }

  getState() {
    return this.seed;
  }
}
```

---

#### PR 004.2: Replace Math.random() with SimCore RNG
**Branch:** `pr/004-2-replace-random`
**Size:** M

**Files to modify:** All files using Math.random() for gameplay logic

**Done When:**
- [ ] `grep -r "Math.random()" src/` finds only visual effects (particles, etc.)
- [ ] All gameplay random uses `simCore.rng.random()`
- [ ] Same seed produces same game sequence

---

### Release 005: State Surface Definition

**Goal:** Clear separation of authoritative vs render state.

**Duration Estimate:** 1 week

#### PR 005.1: State Registry
**Branch:** `pr/005-1-state-registry`
**Size:** M

**Files:**
- `+ src/SimCore/state/StateRegistry.js` (new)
- `+ src/SimCore/state/EntityState.js` (new)

**EntityState Contract:**
```javascript
// Authoritative state (must serialize)
{
  id: string,
  type: 'UNIT' | 'MATERA_PILE' | 'DEPOSIT',
  ownerId: string,
  position: [number, number, number],
  rotation: [number, number, number, number], // quaternion

  // Unit-specific
  unitData?: {
    typeId: string,
    hp: number,
    maxHp: number,
    energy: number,
    maxEnergy: number,
    cargo: number,
    maxCargo: number,
    commandQueueIndex: number,
    status: 'IDLE' | 'MOVING' | 'MINING' | 'COMBAT' | 'OFFLINE'
  }
}
```

---

#### PR 005.2: Serialization Interface
**Branch:** `pr/005-2-serialization`
**Size:** M

**Files:**
- `+ src/SimCore/state/Serializer.js` (new)

**Implementation:**
```javascript
export class Serializer {
  static serialize(simCore) {
    return JSON.stringify({
      version: '1.0.0',
      tick: simCore.tick,
      seed: simCore.rng.seed,
      nextId: simCore.idGenerator.nextId,
      entities: simCore.serializeEntities(),
      terrain: simCore.serializeTerrain(),
      players: simCore.serializePlayers()
    });
  }

  static deserialize(json, simCore) {
    const data = JSON.parse(json);
    simCore.tick = data.tick;
    simCore.rng = new SeededRNG(data.seed);
    simCore.idGenerator.nextId = data.nextId;
    simCore.deserializeEntities(data.entities);
    // ... etc
  }

  static hash(simCore) {
    // Fast hash for desync detection
    const state = this.serialize(simCore);
    return cyrb53(state); // Simple hash function
  }
}

// cyrb53 hash function
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
```

**Done When:**
- [ ] `simCore.serialize()` returns JSON snapshot
- [ ] `simCore.deserialize(json)` restores state
- [ ] `simCore.hash()` returns consistent hash for identical state

---

### Release 006: Local Transport Shim

**Goal:** Abstract transport layer with local implementation.

**Duration Estimate:** 3 days

#### PR 006.1: ITransport Interface
**Branch:** `pr/006-1-itransport`
**Size:** S

**Files:**
- `+ src/SimCore/transport/ITransport.js` (new)

**Interface Definition:**
```javascript
// src/SimCore/transport/ITransport.js
export class ITransport {
  // Send command to authority (host or self)
  send(command) {
    throw new Error('Not implemented');
  }

  // Register callback for received commands
  onReceive(callback) {
    throw new Error('Not implemented');
  }

  // Register callback for state snapshots (client only)
  onSnapshot(callback) {
    throw new Error('Not implemented');
  }

  // Broadcast snapshot to clients (host only)
  broadcastSnapshot(snapshot) {
    throw new Error('Not implemented');
  }

  // Connection lifecycle
  connect() {
    throw new Error('Not implemented');
  }

  disconnect() {
    throw new Error('Not implemented');
  }
}
```

---

#### PR 006.2: Local Transport Implementation
**Branch:** `pr/006-2-local-transport`
**Size:** S

**Files:**
- `+ src/SimCore/transport/LocalTransport.js` (new)

**Implementation:**
```javascript
import { ITransport } from './ITransport.js';

export class LocalTransport extends ITransport {
  constructor() {
    super();
    this.receiveCallbacks = [];
    this.snapshotCallbacks = [];
  }

  send(command) {
    // In local mode, immediately deliver to self
    for (const callback of this.receiveCallbacks) {
      callback(command);
    }
  }

  onReceive(callback) {
    this.receiveCallbacks.push(callback);
  }

  onSnapshot(callback) {
    this.snapshotCallbacks.push(callback);
  }

  broadcastSnapshot(snapshot) {
    // In local mode, no-op (we are both host and client)
  }

  connect() {
    return Promise.resolve();
  }

  disconnect() {
    this.receiveCallbacks = [];
    this.snapshotCallbacks = [];
  }
}
```

**Done When:**
- [ ] Game runs with LocalTransport injected
- [ ] Commands flow through transport layer
- [ ] Can swap transport implementation without other code changes

---

### Release 007: Snapshot Interpolation

**Goal:** Smooth visual rendering from discrete state snapshots.

**Duration Estimate:** 3 days

#### PR 007.1: Interpolation Framework
**Branch:** `pr/007-1-interpolation-framework`
**Size:** M

**Implements:**
- Previous/current snapshot storage
- Alpha-based lerping for all entity positions
- Quaternion slerp for rotations

---

### Release 008: Pathfinding Determinism

**Goal:** Deterministic path computation.

**Duration Estimate:** 3 days

#### PR 008.1: Stable Path Computation
**Branch:** `pr/008-1-stable-pathfinding`
**Size:** M

**Requirements:**
- Same inputs = same path output
- No dependency on frame timing
- Stable waypoint ordering

---

### Release 009: Full Determinism Verification

**Goal:** Prove determinism with dual-instance test.

**Duration Estimate:** 1 week

#### PR 009.1: Dual-Instance Test Framework
**Branch:** `pr/009-1-dual-instance`
**Size:** M

**Implementation:**
```javascript
// tests/SimCore/determinism.test.js
describe('Determinism Verification', () => {
  test('two instances produce identical state after 1000 ticks', () => {
    const sim1 = new SimCore({ seed: 12345 });
    const sim2 = new SimCore({ seed: 12345 });

    // Generate deterministic command sequence
    const commands = generateTestCommands(100);

    // Feed same commands to both
    commands.forEach(cmd => {
      sim1.queueCommand({ ...cmd });
      sim2.queueCommand({ ...cmd });
    });

    // Run 1000 ticks
    for (let i = 0; i < 1000; i++) {
      sim1.step();
      sim2.step();

      // Verify hash every 60 ticks
      if (i % 60 === 0) {
        const hash1 = Serializer.hash(sim1);
        const hash2 = Serializer.hash(sim2);
        expect(hash1).toBe(hash2);
      }
    }
  });
});
```

**Done When:**
- [ ] Test passes consistently
- [ ] No hash mismatches over 1000 ticks
- [ ] CI pipeline runs this on every PR

---

### Release 010: Backend Readiness

**Goal:** Supabase integration scaffolding (no actual multiplayer).

**Duration Estimate:** 3 days

#### PR 010.1: Supabase Client Scaffold
**Branch:** `pr/010-1-supabase-scaffold`
**Size:** S

**Files:**
- `+ src/Backend/SupabaseClient.js` (new)
- `+ src/Backend/AuthService.js` (new)

**Implements:**
- Supabase client initialization
- Anonymous auth flow
- Profile creation on first login
- Connection status indicator

**Done When:**
- [ ] Can sign in anonymously
- [ ] Profile row created in Supabase
- [ ] Connection status shown in UI

---

## 4. Sprint Schedule

| Sprint | Week | Releases | Focus |
|--------|------|----------|-------|
| S1 | 1 | 001, 002 | Fixed timestep + Commands |
| S2 | 2 | 003, 004 | Determinism (IDs + RNG) |
| S3 | 3 | 005 | State architecture |
| S4 | 4 | 006 | Transport abstraction |
| S5 | 5 | 007, 008 | Interpolation + Pathfinding |
| S6 | 6 | 009, 010 | Verification + Backend |

**Total Duration:** 6 weeks

---

## 5. PR Checklist Template

Before opening any PR:
- [ ] Code compiles without errors
- [ ] All new code has unit tests
- [ ] Existing tests still pass
- [ ] Manual smoke test completed
- [ ] No console errors in browser
- [ ] PR description includes:
  - Goal/purpose
  - Files changed
  - Testing performed
  - Rollback instructions

---

## 6. Rollback Procedures

Each release is designed for easy rollback:

| Release | Rollback Action |
|---------|-----------------|
| 001 | Delete new files, revert Game.js |
| 002 | Delete command files, revert InteractionManager |
| 003 | Revert ID generator, restore Date.now() calls |
| 004 | Delete PRNG, restore Math.random() calls |
| 005 | Delete state files |
| 006 | Delete transport files |
| 007-010 | Revert specific files |

---

## 7. Open Decisions for Phase 0

### OPEN DECISION: Authority Tick Rate
**Question:** 20Hz or 30Hz?
**Default:** 20Hz (per STATUS_WALKTHROUGH.md)
**Decision Trigger:** Performance profiling during Release 001

### OPEN DECISION: Float vs Fixed-Point
**Question:** Native floats or fixed-point integers?
**Default:** Native floats with desync detection
**Decision Trigger:** If desync occurs in dual-instance tests

---

## 8. What Comes After Phase 0

Phase 0 completion enables:
- **Phase 1:** Feature implementation (MOVE_ROLL, MINING, etc.)
- **Phase 2:** Real multiplayer (WebRTC, Supabase signaling)

Phase 0 does NOT enable:
- Playing the game with multiple features
- Real internet multiplayer
- GRFDTRDPU pipeline

---

**End of SHORT-TERM PLAN v1**

**Word Count:** ~3,800 words
