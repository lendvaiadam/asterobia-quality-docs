# APPENDIX F: RELEASE, SPRINT & PR BREAKDOWN

**Parent Document:** [MASTER_PLAN_FINAL_v2.md](../MASTER_PLAN_FINAL_v2.md)
**Scope:** Detailed work breakdown, PR granularity, done criteria per release

---

## 1. Phase 0: Netcode Readiness (Releases 001-010)

### Release 001: Fixed Timestep Authority

**Goal:** Establish 20Hz SimCore heartbeat independent of render frame rate.

#### PR 001.1: SimCore Loop Foundation
**Branch:** `pr/001-1-simcore-loop`
**Size:** S (<200 lines)

**Files:**
```
+ src/SimCore/core/GameLoop.js (new)
+ src/SimCore/core/TimeSource.js (new)
~ src/SimCore/index.js (modify exports)
```

**Done When:**
- [ ] GameLoop.step() executes exactly once per 50ms accumulated
- [ ] Spiral of death prevented (max 5 steps/frame)
- [ ] No direct dependencies on Three.js or DOM
- [ ] Unit tests pass

**Rollback:** Delete new files, no existing code touched.

---

#### PR 001.2: Game.js Shim Integration
**Branch:** `pr/001-2-game-shim`
**Size:** S

**Files:**
```
~ src/Core/Game.js (modify)
```

**Changes:**
```javascript
// In Game.js constructor:
import { GameLoop } from '../SimCore/core/GameLoop.js';
this.gameLoop = new GameLoop({ tickRate: 20 });

// In Game.js animate():
const delta = this.clock.getDelta() * 1000;
const alpha = this.gameLoop.accumulate(delta);
```

**Done When:**
- [ ] Console shows tick count incrementing at ~20/second
- [ ] Game behavior unchanged from before
- [ ] FPS can vary without affecting tick count

**Rollback:** Revert Game.js changes.

---

#### PR 001.3: Visual Interpolation Setup
**Branch:** `pr/001-3-interpolation`
**Size:** M (200-500 lines)

**Files:**
```
~ src/Core/Game.js (modify)
~ src/Entities/Unit.js (modify)
```

**Done When:**
- [ ] Movement appears smooth at any FPS
- [ ] No visual stuttering when tick rate < frame rate
- [ ] prevPosition/position interpolation working

**Rollback:** Revert changes to Game.js and Unit.js.

---

### Release 002: Command Buffer Shim

**Goal:** All input flows through Command objects, no direct state mutation.

#### PR 002.1: Command Type Definitions
**Branch:** `pr/002-1-command-types`
**Size:** S

**Files:**
```
+ src/SimCore/commands/CommandTypes.js (new)
+ src/SimCore/commands/index.js (new)
```

**Commands defined:** MOVE, STOP, ATTACK, MINE, BUILD

---

#### PR 002.2: Command Queue Implementation
**Branch:** `pr/002-2-command-queue`
**Size:** M

**Files:**
```
+ src/SimCore/commands/CommandQueue.js (new)
```

**Done When:**
- [ ] Commands enqueued with tick stamp
- [ ] Commands retrieved by tick
- [ ] Unit tests pass

---

#### PR 002.3: Input Factory
**Branch:** `pr/002-3-input-factory`
**Size:** M

**Files:**
```
+ src/SimCore/input/InputFactory.js (new)
~ src/Core/InteractionManager.js (modify)
```

**Done When:**
- [ ] Mouse clicks create MOVE commands
- [ ] No direct unit.setTarget() calls from UI

---

#### PR 002.4: Command Processor
**Branch:** `pr/002-4-command-processor`
**Size:** M

**Files:**
```
+ src/SimCore/commands/CommandProcessor.js (new)
```

**Done When:**
- [ ] Commands processed on correct tick
- [ ] Handler registry for command types
- [ ] Invalid commands rejected (wrong owner)

---

### Release 003: Deterministic IDs

**Goal:** Replace all Date.now() and Math.random() in ID generation.

#### PR 003.1: Sequential ID Generator
**Branch:** `pr/003-1-sequential-ids`
**Size:** S

**Files:**
```
+ src/SimCore/core/IdGenerator.js (new)
```

---

#### PR 003.2: Remove Date.now() from Codebase
**Branch:** `pr/003-2-remove-date-now`
**Size:** M

**Search and replace:** `Date.now()` in logic files (not UI/logging)

**Done When:**
- [ ] grep -r "Date.now()" src/ returns only acceptable locations
- [ ] All entity IDs use IdGenerator

---

### Release 004: Seeded RNG

**Goal:** All gameplay randomness uses seeded PRNG.

#### PR 004.1: Mulberry32 Implementation
**Branch:** `pr/004-1-prng`
**Size:** S

**Files:**
```
+ src/SimCore/core/PRNG.js (new)
```

**Done When:**
- [ ] Same seed produces same sequence
- [ ] Passes statistical randomness tests
- [ ] Unit tests pass

---

### Release 005: State Surface Definition

**Goal:** Clear separation of authoritative vs render state.

#### PR 005.1: State Registry
**Branch:** `pr/005-1-state-registry`
**Size:** M

**Files:**
```
+ src/SimCore/state/StateRegistry.js (new)
+ src/SimCore/state/EntityState.js (new)
```

---

#### PR 005.2: Serialization Interface
**Branch:** `pr/005-2-serialization`
**Size:** M

**Files:**
```
+ src/SimCore/state/Serializer.js (new)
```

**Done When:**
- [ ] Can serialize entire game state to JSON
- [ ] Can deserialize and restore exact state
- [ ] Round-trip test passes

---

### Release 006: Local Transport Shim

**Goal:** Abstract transport layer with local implementation.

#### PR 006.1: ITransport Interface
**Branch:** `pr/006-1-itransport`
**Size:** S

**Files:**
```
+ src/SimCore/transport/ITransport.js (new)
```

**Interface:**
```javascript
interface ITransport {
  send(message): void;
  onReceive(callback): void;
  isHost(): boolean;
}
```

---

#### PR 006.2: Local Transport
**Branch:** `pr/006-2-local-transport`
**Size:** S

**Files:**
```
+ src/SimCore/transport/LocalTransport.js (new)
```

**Done When:**
- [ ] Single-player uses LocalTransport
- [ ] Commands flow through transport (even locally)

---

### Release 007-008: Interpolation & Command Log

**PR 007.1:** Enhanced interpolation for all entities
**PR 008.1:** CommandLog class for recording
**PR 008.2:** CommandLog persistence to game save

---

### Release 009: Replay Playback

#### PR 009.1: Replay Player
**Branch:** `pr/009-1-replay-player`
**Size:** M

**Files:**
```
+ src/SimCore/replay/ReplayPlayer.js (new)
```

**Done When:**
- [ ] Can load command log
- [ ] Can feed commands at correct ticks
- [ ] Produces identical end state

---

### Release 010: Verification

#### PR 010.1: Determinism Test Suite
**Branch:** `pr/010-1-determinism-tests`
**Size:** M

**Files:**
```
+ tests/SimCore/determinism.test.js (new)
```

**Done When:**
- [ ] 1000-tick replay test passes
- [ ] CI gate configured
- [ ] Phase 0 milestone verified

---

## 2. Phase 1: Feature Implementation (Releases 011-020)

### Release 011: MOVE_ROLL

#### PR 011.1: Feature Module Stub
**Branch:** `pr/011-1-move-roll-stub`
**Size:** S

**Files:**
```
+ src/SimCore/features/modules/MOVE_ROLL.js (new)
```

---

#### PR 011.2: Physics Integration
**Branch:** `pr/011-2-move-roll-physics`
**Size:** L

**Files:**
```
~ src/SimCore/features/modules/MOVE_ROLL.js (modify)
+ src/SimCore/physics/SlopePhysics.js (new)
```

**Done When:**
- [ ] Slope bands implemented (0-10, 10-40, 40-60, >60)
- [ ] Speed penalty on slopes
- [ ] Blocked at >60° unless extended

---

#### PR 011.3: Unit.js State Extraction
**Branch:** `pr/011-3-unit-state-extraction`
**Size:** L

**Files:**
```
~ src/Entities/Unit.js (modify - shim)
~ src/SimCore/state/EntityState.js (modify)
```

**Done When:**
- [ ] Movement state in SimCore
- [ ] Unit.js reads from SimCore for render
- [ ] Direct Control still works

---

### Release 012-018: Remaining Features

Each feature follows same pattern:
1. Feature module stub
2. Core logic implementation
3. Integration tests
4. UI hooks (if applicable)

---

### Release 019: Designer UI

#### PR 019.1: Design Screen Component
**Branch:** `pr/019-1-design-screen`
**Size:** L

**Files:**
```
+ src/UI/components/design-screen.js (Web Component)
+ src/UI/components/allocation-slider.js (Web Component)
```

---

### Release 020: GRFDTRDPU Integration

#### PR 020.1: Full Pipeline Test
**Branch:** `pr/020-1-grfdtrdpu-integration`
**Size:** M

**Done When:**
- [ ] Can complete: Need → Research → Design → Produce → Command
- [ ] Training outcome slider works
- [ ] Specialization bonus applies

---

## 3. Phase 2: Multiplayer (Releases 021-025)

### Release 021: Supabase Signaling

#### PR 021.1: Supabase Client Setup
**Branch:** `pr/021-1-supabase-client`
**Size:** S

**Files:**
```
+ src/backend/supabase.js (new)
+ .env.example (new)
```

---

#### PR 021.2: Lobby System
**Branch:** `pr/021-2-lobby-system`
**Size:** M

**Files:**
```
+ src/backend/LobbyManager.js (new)
+ src/UI/components/lobby-screen.js (new)
```

**Done When:**
- [ ] Can create lobby
- [ ] Can list lobbies
- [ ] Can join lobby
- [ ] Realtime channel subscription works

---

### Release 022: WebRTC

#### PR 022.1: WebRTC Transport
**Branch:** `pr/022-1-webrtc-transport`
**Size:** L

**Files:**
```
+ src/SimCore/transport/WebRTCTransport.js (new)
```

**Done When:**
- [ ] DataChannel established between host and client
- [ ] Messages flow bidirectionally
- [ ] TURN fallback works

---

### Release 023-025: State Sync, Host Authority, Late Join

Each release adds networking capability building on previous.

---

## 4. Sprint Schedule

| Sprint | Releases | Focus |
|--------|----------|-------|
| S1 | 001-002 | Fixed timestep + Commands |
| S2 | 003-004 | Determinism (IDs + RNG) |
| S3 | 005-006 | State + Transport |
| S4 | 007-008 | Interpolation + Command Log |
| S5 | 009-010 | Replay + Verification |
| S6 | 011 | MOVE_ROLL |
| S7 | 012-013 | Vision + Mining |
| S8 | 014-015 | Transport + Combat |
| S9 | 016-018 | Scan + Stretch features |
| S10 | 019-020 | Designer + GRFDTRDPU |
| S11 | 021-022 | Signaling + WebRTC |
| S12 | 023-025 | Sync + Auth + Late Join |

---

*End of Appendix F*
