# APPENDIX E: RELEASES, SPRINTS & PR PLAN

**Parent Document:** [Master Development Plan v1 (Claude)](../MASTER_DEVELOPMENT_PLAN_v1_CLAUDE.md)
**Scope:** Detailed work breakdown, PR granularity, done criteria, rollback procedures

---

## 1. Release Strategy Overview

### 1.1 Phase Structure

| Phase | Releases | Focus | Duration Est. |
|-------|----------|-------|---------------|
| Phase 0 | 001-010 | Netcode Readiness | 5-6 weeks |
| Phase 1 | 011-020 | Feature Implementation | 8-10 weeks |
| Phase 2 | 021-025 | Multiplayer | 4-5 weeks |

### 1.2 Release Naming Convention

```
release/{XXX}[-optional-suffix]
```

Examples:
- `release/001` - Fixed Timestep Authority
- `release/011-locomotion` - MOVE_ROLL Implementation
- `release/021-signaling` - Supabase Signaling

---

## 2. Phase 0: Netcode Readiness (Detailed)

### Release 001: Fixed Timestep Authority

**Goal:** Establish 20Hz SimCore heartbeat independent of render frame rate.

**PRs:**

#### PR 001.1: SimCore Loop Foundation
**Branch:** `pr/001-1-simcore-loop`
**Estimated Size:** S (< 200 lines)

**Files Changed:**
```
+ src/SimCore/core/GameLoop.js (new)
+ src/SimCore/core/TimeSource.js (new)
~ src/SimCore/index.js (modify exports)
```

**Implementation:**
```javascript
// src/SimCore/core/GameLoop.js
export class GameLoop {
  constructor(config = {}) {
    this.tickRate = config.tickRate || 20; // Hz
    this.timestep = 1000 / this.tickRate; // ms
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

    return this.accumulator / this.timestep; // Alpha for interpolation
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
    loop.accumulate(100); // 100ms = 2 ticks at 20Hz
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
    expect(loop.tick).toBeLessThanOrEqual(5); // Capped
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
**Estimated Size:** S

**Files Changed:**
```
~ src/Core/Game.js (modify)
```

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
  console.log(`Tick: ${this.gameLoop.tick}, FPS: ${Math.round(1/delta*1000)}`);
}

// Existing update code continues unchanged
```

**Tests:**
- Manual: Throttle CPU to 30 FPS, verify tick rate stays at 20Hz
- Manual: Run at 144 FPS, verify tick rate stays at 20Hz

**Done When:**
- [ ] Console shows "Tick: N" incrementing at ~20 per second
- [ ] Game behavior unchanged from before
- [ ] FPS can vary without affecting tick count

**Rollback:** Revert Game.js changes.

---

#### PR 001.3: Visual Interpolation Setup
**Branch:** `pr/001-3-interpolation`
**Estimated Size:** M (200-500 lines)

**Files Changed:**
```
~ src/Core/Game.js (modify)
~ src/Entities/Unit.js (modify)
```

**Implementation:**
```javascript
// In Unit.js:
setRenderPosition(alpha) {
  // Interpolate between previous and current authoritative positions
  const prev = this.prevPosition || this.position;
  const curr = this.position;

  this.mesh.position.lerpVectors(prev, curr, alpha);
}

// In Game.js animate():
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

**PRs:**

#### PR 002.1: Command Type Definitions
**Branch:** `pr/002-1-command-types`
**Estimated Size:** S

**Files Created:**
```
+ src/SimCore/commands/CommandTypes.js
+ src/SimCore/commands/index.js
```

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
**Estimated Size:** M

**Files Created:**
```
+ src/SimCore/commands/CommandQueue.js
```

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

#### PR 002.3: Input Factory (UI → Commands)
**Branch:** `pr/002-3-input-factory`
**Estimated Size:** M

**Files Changed:**
```
+ src/SimCore/input/InputFactory.js
~ src/Core/InteractionManager.js (modify)
```

**Implementation:**
```javascript
// src/SimCore/input/InputFactory.js
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

// In InteractionManager.js:
// Replace direct unit.setTarget() calls with:
this.inputFactory.moveSelectedUnits(targetPosition);
```

---

#### PR 002.4: Command Processor
**Branch:** `pr/002-4-command-processor`
**Estimated Size:** M

**Files Created:**
```
+ src/SimCore/commands/CommandProcessor.js
```

**Implementation:**
```javascript
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

---

### Release 003: Deterministic IDs

**Goal:** Replace all `Date.now()` and `Math.random()` in ID generation.

#### PR 003.1: Sequential ID Generator
**Branch:** `pr/003-1-sequential-ids`
**Estimated Size:** S

**Files Changed:**
```
+ src/SimCore/core/IdGenerator.js
~ src/SimCore/index.js
```

**Implementation:**
```javascript
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
**Estimated Size:** M

**Files Changed:**
```
~ src/Entities/Unit.js (find and replace)
~ src/Core/Game.js (find and replace)
~ src/World/FogOfWar.js (if any)
```

**Search Pattern:** `Date.now()` in logic files (not UI/logging)

---

### Release 004: Seeded RNG

**Goal:** All gameplay randomness uses seeded PRNG.

#### PR 004.1: Mulberry32 Implementation
**Branch:** `pr/004-1-prng`
**Estimated Size:** S

**Files Created:**
```
+ src/SimCore/core/PRNG.js
```

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

  // For save/load - recreate from seed with same call count
  getState() {
    return this.seed;
  }
}
```

---

### Release 005: State Surface Definition

**Goal:** Clear separation of authoritative vs render state.

#### PR 005.1: State Registry
**Branch:** `pr/005-1-state-registry`
**Estimated Size:** M

**Files Created:**
```
+ src/SimCore/state/StateRegistry.js
+ src/SimCore/state/EntityState.js
```

---

#### PR 005.2: Serialization Interface
**Branch:** `pr/005-2-serialization`
**Estimated Size:** M

**Files Created:**
```
+ src/SimCore/state/Serializer.js
```

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
}
```

---

### Release 006: Local Transport Shim

**Goal:** Abstract transport layer with local implementation.

#### PR 006.1: ITransport Interface
**Branch:** `pr/006-1-itransport`
**Estimated Size:** S

**Files Created:**
```
+ src/SimCore/transport/ITransport.js
```

---

#### PR 006.2: Local Transport Implementation
**Branch:** `pr/006-2-local-transport`
**Estimated Size:** S

**Files Created:**
```
+ src/SimCore/transport/LocalTransport.js
```

---

## 3. Sprint Schedule Summary

| Sprint | Week | Releases | Key Deliverable |
|--------|------|----------|-----------------|
| S1 | 1 | 001, 002 | Fixed timestep + Commands |
| S2 | 2 | 003, 004 | Determinism (IDs + RNG) |
| S3 | 3 | 005 | State architecture |
| S4 | 4 | 006 | Transport abstraction |
| S5 | 5 | 007, 008 | Interpolation + Pathfinding |
| S6 | 6 | 009, 010 | Verification + Backend prep |
| S7 | 7 | 011 | MOVE_ROLL |
| S8 | 8 | 012 | Perception/FOW |
| S9 | 9 | 013, 014 | Mining + Transport |
| S10 | 10 | 015 | Combat |
| S11 | 11 | 016, 017, 018 | Scan, Shape, Carrier |
| S12 | 12 | 019, 020 | Designer + GRFDTRDPU |
| S13 | 13 | 021 | Supabase signaling |
| S14 | 14 | 022, 023 | WebRTC + Host migration |
| S15 | 15 | 024, 025 | Late join + Polish |

---

## 4. PR Workflow

### 4.1 PR Checklist

Before opening PR:
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

### 4.2 Review Criteria

- [ ] Code follows existing patterns
- [ ] No new dependencies without justification
- [ ] Determinism rules followed (no Date.now/Math.random in logic)
- [ ] State surface rules followed (authoritative vs render)

### 4.3 Merge Process

1. PR approved by reviewer
2. Squash and merge to `main`
3. Run full smoke test
4. If smoke fails, revert immediately
5. Update `docs/STATUS_WALKTHROUGH.md` if milestone reached
6. Consider release if milestone complete

---

*End of Appendix E*
