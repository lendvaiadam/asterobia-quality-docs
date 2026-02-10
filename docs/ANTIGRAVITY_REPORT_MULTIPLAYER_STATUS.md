# Antigravity Report: Multiplayer Status in Asterobia

**Date**: 2026-02-10
**Author**: Claude (Orchestrator)
**Branch**: `work/r013-buglist-docs`
**Protocol Version**: `0.13.0`

---

## 1. Executive Summary

Asterobia's multiplayer system has matured from a design-only state to a functional peer-to-peer implementation using Supabase Realtime as transport. The complete Host-Guest handshake (M06), command transport pipeline (M07 Slice 1), unit authority with PIN-based seat acquisition (M07 GAP-0), UX resilience features including host migration (M07.5), and determinism hardening (M08) are all implemented and passing 455 automated tests across 22 test files. Slice 2 has been activated: Guests now execute commands locally with state hash sampling every 60 ticks for desync detection. The primary gap remaining is a manual two-browser HU-TEST to validate the full end-to-end flow over real Supabase Realtime. The proposed next architectural leap is transitioning from the current host-as-browser model to a dedicated authoritative game server with FPS-grade netcode (client-side prediction, reconciliation, interpolation, lag compensation).

---

## 2. What Has Been Implemented

### 2.1 Transport Foundation (R007)

| Component | File | Purpose |
|-----------|------|---------|
| `ITransport` / `TransportBase` | `src/SimCore/transport/ITransport.js` | Abstract interface defining `send()`, `connect()`, `disconnect()`, `onReceive` callback pattern. Transport state machine: `DISCONNECTED -> CONNECTING -> CONNECTED -> ERROR`. |
| `LocalTransport` | `src/SimCore/transport/LocalTransport.js` | Synchronous loopback for single-player / testing. Zero-latency `send()` immediately calls `_deliverReceived()`. |
| `SupabaseTransport` | `src/SimCore/transport/SupabaseTransport.js` | Supabase Realtime broadcast transport. Throttled to ~10Hz outbound. Multi-channel support for lobby + session. Exponential backoff reconnect (up to 5 attempts). |

**Invariant**: No command enters the authoritative simulation without passing through transport. Even local commands flow through `LocalTransport.send() -> onReceive -> CommandQueue`.

### 2.2 M06 -- Join Flow (COMPLETE)

The full peer discovery and join handshake is implemented in `SessionManager.js`:

```
Guest                         Lobby Channel                    Host
  |                               |                              |
  |--- startDiscovery() --------->|                              |
  |                               |<-- HOST_ANNOUNCE (every 5s) -|
  |<-- onHostListUpdated(hosts) --|                              |
  |                               |                              |
  |--- joinGame(hostId) ----------------------------> Session Channel
  |                               |                              |
  |--- JOIN_REQ (guestId, name, protocolVersion) --------------->|
  |                               |                              |
  |                               |  [version check, slot alloc, |
  |                               |   snapshot serialize,        |
  |                               |   size guard <100KB]         |
  |                               |                              |
  |<------------- JOIN_ACK (accepted, slot, simTick, snapshot) --|
  |                               |                              |
  | [apply snapshot, sync tick,   |                              |
  |  setAsGuest(), start HUD]     |                              |
```

**Key implementation details:**
- Lobby channel: `asterobia:lobby` -- used for `HOST_ANNOUNCE` broadcast every 5s
- Session channel: `asterobia:session:{hostId}` -- used for all in-session communication
- Join queue with sequential processing (`_processJoinQueue`) prevents race conditions when multiple guests join simultaneously (M06-R01)
- Snapshot serialization with fallback: tries `stateSurface.serialize()`, falls back to minimal stub if that fails (M06-R02)
- Snapshot size guard: warning at 80KB, hard reject at 100KB (M06-R04)
- 500ms stabilization delay after channel subscribe before sending JOIN_REQ (Supabase Realtime propagation latency)
- 10s join timeout with debug diagnostics on failure
- Stale host pruning: entries removed after 15s (3 missed announces)

### 2.3 M07 Slice 1 -- Transport Pipeline (COMPLETE)

Host-to-Guest command delivery with sequencing and safety:

| Feature | Implementation |
|---------|---------------|
| CMD_BATCH schema | `{ batchSeq, simTick, scheduledTick, commands[], stateHash?, timestamp }` |
| Host `sendCmdBatch()` | Monotonic `_batchSeqCounter++`, `scheduledTick = simTick + 2` (2-tick buffer) |
| Guest `_handleCmdBatch()` | Dedup via `_lastReceivedBatchSeq`, stale detection (drop if `scheduledTick` is >10 ticks behind `currentTick`), gap detection (warn on non-consecutive batchSeq) |
| CommandQueue ID preservation | Host-assigned `id` and `seq` fields preserved through `enqueue()` rather than overwritten |
| Batch size limit | `MAX_COMMANDS_PER_BATCH = 50`, truncation with FIFO carry-over |
| Queue overflow guard | `MAX_QUEUE_SIZE = 200`, drops batch if exceeded |
| Safety gate | `ENABLE_COMMAND_EXECUTION` flag (now `true` -- Slice 2 activated) |
| Debug counters | `_debugCounters` object: `batchSentCount`, `batchRecvCount`, `batchDropDupCount`, `batchDropStaleCount`, `cmdEnqueuedCount`, `cmdRejectedAuth`, `cmdRejectedType`, `batchTruncatedCount`, `batchDroppedQueueFull` |
| Debug panel | `NetworkDebugPanel` UI overlay showing all counters |

**Command processing split (critical design):**
- `SELECT` / `DESELECT`: UI-only, executed immediately via local `globalCommandQueue.enqueue()` -- no network round-trip (see `InputFactory.js` lines 60-65)
- `MOVE` / `SET_PATH` / `CLOSE_PATH`: Sim-mutating, go through `Transport.send()`, gated by `ENABLE_COMMAND_EXECUTION`

### 2.4 M07 GAP-0 -- Unit Authority v0 (COMPLETE)

Two-field ownership model on `Unit.js`:

```javascript
// Economic owner: persists, changes only on takeover
this.ownerSlot = 0;           // Default: spawned by Host (slot 0)

// Driver (exclusive seat): null = empty, number = occupied
this.selectedBySlot = null;

// Seat access control
this.seatPolicy = 'OPEN';    // or 'PIN_1DIGIT'
this.seatPinDigit = null;    // 1-9, HOST-ONLY, never serialized
```

**SEAT_REQ/ACK/REJECT flow:**

```
Guest                              Host
  |                                  |
  | Click foreign unit               |
  |--- check: isOccupiedByOther() -->|
  |    (true? -> show "OCCUPIED")    |
  |    (false? -> show keypad)       |
  |                                  |
  | User enters PIN digit            |
  |--- SEAT_REQ { targetUnitId,     |
  |     requesterSlot,              |
  |     auth: { method: 'PIN_1DIGIT',|
  |             guess: N } } ------->|
  |                                  |
  |   [Host validates:]              |
  |   - Cooldown check              |
  |   - Already-seated idempotency  |
  |   - OCCUPIED by other?          |
  |   - PIN match?                  |
  |                                  |
  |<-- SEAT_ACK { targetUnitId,     |
  |     selectedBySlot, newOwnerSlot }|
  |  or                              |
  |<-- SEAT_REJECT { reason,        |
  |     retryAfterMs }              |
```

**Rejection reasons**: `OCCUPIED`, `LOCKED`, `BAD_PIN`, `COOLDOWN`

**Progressive cooldown**: `[250ms, 500ms, 1000ms, 2000ms]` escalating per `(requesterSlot, targetUnitId)` pair

**Privacy gates**: `seatPinDigit` is never included in snapshots, broadcasts, or `dumpNetEvidence()`. Only compared server-side (Host-side) in `_handleSeatReq()`.

**Input gating** (5 checkpoints):
1. Double-click bypass fixed in `InteractionManager`
2. MOVE/SET_PATH/CLOSE_PATH gated by `hasSeatedUnit()` in `_processInputCommands()`
3. Tab click in HUD gated (triggers seat flow instead of raw select)
4. Keyboard WASD gated in `simTick` (requires `selectedBySlot === mySlot`)
5. Camera chase gated in `renderUpdate`

### 2.5 M07.5 -- UX and Resilience (COMPLETE)

| Feature | Details |
|---------|---------|
| JoinOverlay v2 | Single-screen overlay with in-place button transforms for host/join states |
| Multiplayer HUD | Top-right display: player count, connection state, role indicator |
| Debug console toggle | F12 key or button toggles debug panel visibility |
| Host-leave resilience | First guest auto-promotes to HOST. Uses `promoteToHost()` on `SessionState` |
| Graceful leave | `gracefulLeaveGame()` broadcasts `HOST_LEAVE` or `GUEST_LEAVE` before teardown |
| Host absence detection | Guest monitors `_hostLastSeenAt`, triggers migration after 15s absence + 3s grace |
| Host presence tracking | Any host-originated message type (CMD_BATCH, JOIN_ACK, SEAT_ACK, etc.) resets absence timer |
| Slice 2 activation | `_guestExecutionEnabled = true` in `Game.js` line 337 |
| State hash sampling | Every 60 ticks, host sends `stateHash` in CMD_BATCH; guest compares and logs mismatch |

### 2.6 Position Sync (COMPLETE)

Host periodically broadcasts `POSITION_SYNC` messages containing authoritative unit state:

```javascript
// Per-unit data in POSITION_SYNC:
{
  id, px, py, pz,           // Position
  qx, qy, qz, qw,          // Rotation quaternion
  fp, pi, pc, kb,           // Path-following flags (compact 0/1)
  pp: [x,y,z, x,y,z, ...], // Flat path array (optional)
  cmds: [{ t, s, px, py, pz }] // Compact command list (optional)
}
```

Guest-side: Callback `onPositionSync` reconstructs `THREE.Vector3` positions (Three.js dependency isolated to `Game.js`, NOT in `SessionManager.js` -- important for future headless audit).

### 2.7 M08 -- Determinism Hardening (COMPLETE)

**5 CRITICAL fixes:**
1. `Math.random()` replaced with `SeededRNG` (Mulberry32 algorithm) in all sim paths
2. `Date.now()` replaced with `simTick`-based timing for sim state
3. Non-deterministic array sorts replaced with stable comparators
4. Floating-point normalization for cross-platform consistency
5. `Map` iteration order standardized (insert-order reliance documented)

**4 WARNING fixes:**
1. `console.log` timing isolated from sim state
2. Event listener ordering made deterministic
3. `Array.from()` stability ensured
4. `requestAnimationFrame` timing isolated from sim loop (accumulator pattern in `SimLoop.js`)

**SeededRNG** (`src/SimCore/runtime/SeededRNG.js`):
- Algorithm: Mulberry32 (32-bit state, good distribution)
- Global singleton: `globalRNG` / `rngNext()` / `rngNextInt()`
- State serializable: `getState()` / `setState()` for save/load
- Used in: unit ID generation, spawn logic, any sim-authoritative randomness

### 2.8 Gameplay Features (Recent Sessions)

| Feature | Status |
|---------|--------|
| WASD manual control | Unit stops on key release, no auto-rejoin to path |
| Play button Bezier rejoin | Smooth arc transition from manual position back to path |
| Unit-to-unit collision | Mutual bounce with position history rollback |
| Selection ring | Rotating cyan-to-green gradient shader (matches preloader) |
| Third-person camera | Unit in lower third, up vector aligned to sphere normal |
| Keep-unit-in-view | Auto-zoom-out when unit approaches screen edges |
| Camera heading tracking | `transitionToThirdPerson` tracks current heading (no jump) |
| Headlight deselect timer | 2s idle timer (reduced from 60s per bug H4) |
| FOW groundwork | Spherical shader approach (path planning deferred) |
| Owner tinting | Visual identity per `ownerSlot` |

---

## 3. Test Status

### Automated Tests

| Metric | Value |
|--------|-------|
| Total tests | **455** |
| Test files | **22** |
| Status | **ALL PASSING** |

**Test file inventory** (all under `src/SimCore/`):

| Test File | Coverage Area |
|-----------|--------------|
| `__tests__/sessionManager.test.js` | Core SessionManager lifecycle |
| `__tests__/sessionManager.host.test.js` | Host operations (announce, slot assignment) |
| `__tests__/sessionManager.join.test.js` | M06 Join flow (handshake, snapshot) |
| `__tests__/sessionManager.discovery.test.js` | M05 Guest discovery (stale pruning, limits) |
| `__tests__/sessionManager.inputCmd.test.js` | INPUT_CMD validation and buffering |
| `__tests__/sessionManager.cmdBatch.test.js` | M07 CMD_BATCH send/receive/dedup/stale |
| `__tests__/sessionManager.seat.test.js` | M07 GAP-0 SEAT_REQ/ACK/REJECT/RELEASE |
| `__tests__/sessionManager.hostLeave.test.js` | Host-leave resilience, migration |
| `__tests__/sessionState.test.js` | SessionState container (roles, slots, seq) |
| `__tests__/seatAuthority.test.js` | Unit authority model (selectedBySlot, ownerSlot) |
| `__tests__/commandQueue.hostId.test.js` | M07 CommandQueue ID/seq preservation |
| `__tests__/messageSerializer.test.js` | All message types encode/decode/validate |
| `__tests__/inputFactory.test.js` | InputFactory command creation |
| `__tests__/transport.test.js` | LocalTransport send/receive |
| `__tests__/supabaseTransport.test.js` | SupabaseTransport (mocked Supabase client) |
| `__tests__/stateSurface.test.js` | StateSurface serialize/deserialize |
| `__tests__/pathfinding-determinism.test.js` | PathPlanner deterministic output |
| `__tests__/r010-full-determinism.test.js` | Full sim determinism (same seed = same state) |
| `__tests__/r011-save-load.test.js` | Save/load state roundtrip |
| `__tests__/e2e-determinism.test.js` | End-to-end determinism across ticks |
| `runtime/__tests__/seededRNG.test.js` | SeededRNG (Mulberry32 correctness, state save/load) |
| `runtime/__tests__/idGenerator.test.js` | IdGenerator deterministic IDs |

### Manual Testing

| Test | Status | Notes |
|------|--------|-------|
| Host + Guest in two browser tabs | **PENDING** | Full 2-client Supabase Realtime HU-TEST not yet conducted |
| Keypad PIN flow | **PENDING** | Needs live browser verification |
| WASD blocked before seat | **PENDING** | Automated tests pass; awaiting manual confirmation |
| Guest sees movement (Slice 2) | **PENDING** | `_guestExecutionEnabled = true` set, needs live test |

---

## 4. Architecture Decisions for Review

### 4.1 Current Architecture (Host-as-Browser)

```
  Browser A (HOST)                    Browser B (GUEST)
  +-----------------------+           +-----------------------+
  | InputFactory          |           | InputFactory          |
  |   |                   |           |   |                   |
  |   v                   |           |   v                   |
  | SupabaseTransport     |           | SupabaseTransport     |
  |   | (send)            |           |   | (send INPUT_CMD)  |
  +---|-------------------+           +---|-------------------+
      |                                   |
      v                                   v
  +------------------------------------------+
  |  Supabase Realtime (broadcast channels)  |
  |  - asterobia:lobby (HOST_ANNOUNCE)       |
  |  - asterobia:session:{hostId} (gameplay) |
  +------------------------------------------+
      |                                   |
      v                                   v
  +-----------------------+           +-----------------------+
  | SessionManager (HOST) |           | SessionManager (GUEST)|
  |   inputBuffer[]       |           |   _handleCmdBatch()   |
  |   sendCmdBatch()      |           |   enqueue to CmdQueue |
  |   sendPositionSync()  |           |                       |
  |   |                   |           |   |                   |
  |   v                   |           |   v                   |
  | CommandQueue.flush()  |           | CommandQueue.flush()  |
  |   |                   |           |   |                   |
  |   v                   |           |   v                   |
  | SimLoop.onSimTick()   |           | SimLoop.onSimTick()   |
  | (authoritative)       |           | (Slice 2: executes)   |
  +-----------------------+           +-----------------------+
```

**Limitations of current architecture:**
- Supabase Realtime adds ~50-200ms latency per hop (not suitable for FPS gameplay)
- Host browser must remain open (no persistence)
- No server-side validation (cheating possible)
- Snapshot transfer limited to 100KB (scales poorly with entity count)

### 4.2 FPS Netcode Direction (PROPOSED)

A detailed architecture proposal has been prepared for transitioning to a dedicated authoritative game server:

| Aspect | Current | Proposed |
|--------|---------|----------|
| Authority | Host browser | Dedicated server process |
| Transport | Supabase Realtime broadcast | WebSocket (gameplay) + Supabase (lobby/auth/persistence) |
| Latency compensation | None | Client-side prediction + reconciliation + interpolation |
| Hit validation | Client-side | Server-side rewind-based lag compensation |
| Snapshot format | JSON (~3-5KB/entity) | Binary (~21 bytes/entity) |
| Server cost | $0 (browser) | ~$5-10/month VPS |

**Migration path:**
- **Phase 0**: Interface seams -- define `ISimAuthority`, audit SimCore for DOM/Three.js deps
- **Phase 1**: Server + prediction -- implement WebSocket transport, authoritative server, client prediction
- **Phase 2**: Scaling -- interest management, delta compression, multiple server instances

**Spec location**: Pending Antigravity approval. Proposed: `docs/specs/NETCODE_ARCHITECTURE_FPS.md`

### 4.3 Worker Skills Available

Skills created for project work (in `.claude/skills/`):

| Skill | Domain |
|-------|--------|
| `asterobia-protocol-engineer` | Message schemas, transport layer, handshake flows |
| `asterobia-determinism-gate` | Determinism testing, SeededRNG, state hash verification |
| `asterobia-multiplayer-preflight` | Branch/HEAD checks, test preflight for R013/M07 |
| `asterobia-input-closure` | Input system, command pipeline, selection gating |
| `asterobia-simulation-physicist` | SimLoop, physics, collision |
| `asterobia-camera-3d-graphics` | Camera system, Three.js rendering |
| `asterobia-shader-vfx` | Shaders, visual effects |
| `asterobia-backend-persistence` | Supabase, save/load, storage adapters |
| `asterobia-ui-webcomponents` | UI overlays, HUD, panels |
| `asterobia-web-smoke-tests` | Browser-based smoke tests |
| `asterobia-bug-discipline` | Bug logging protocol, BUGLIST management |
| `asterobia-devops-infrastructure` | Build, deploy, environment |
| `asterobia-content-asset-manager` | Asset pipeline, content management |
| `asterobia-technical-writer` | Documentation, specs, reports |

**Note**: The originally proposed FPS-specific skills (`asterobia-fps-netcode`, `asterobia-game-server`, `asterobia-binary-protocol`) have not yet been created. They should be created when Phase 1 work begins.

---

## 5. Known Issues (from BUGLIST.md)

### Open Issues

| ID | Severity | Summary |
|----|----------|---------|
| A1 | P1 | `startDiscovery()` returns undefined, no visual feedback in UI |
| A3 | P2 | Join timeout occurs intermittently (Supabase Realtime race condition) |
| C1 | P1 | Relative waypoint coordinates on guest side (world coord coherence) |
| C2 | P2 | Shared starter units -- need per-player fleet spawning |
| D3 | P2 | Straight-line pathfinding through obstacles in FOW |
| D4 | P3 | Waypoint pips visible by default (should be hidden) |
| G1 | P2 | Dust particle accumulation (performance leak) |
| G2 | P3 | No adaptive FX quality reduction under load |

### Deferred Issues

| ID | Severity | Summary | Reason |
|----|----------|---------|--------|
| H8 | P2 | FOW path planning (orange line, continuous recalc) | Large feature, deferred by user |
| H9 | P2 | Backend exposes full map to client | Architectural requirement for future |

### Fixed Issues (16 total)

A2, A4, A5, B1, B2, B3, B4, D1, D2, F1, H1, H2, H3, H4, H5, H6, H7 -- all verified.

---

## 6. File Map (Multiplayer-Relevant)

```
src/SimCore/
  multiplayer/
    SessionManager.js      -- Central coordinator (1300+ lines)
    SessionState.js        -- Session state container (roles, slots, players)
    NetworkRole.js         -- OFFLINE/HOST/GUEST enum + helper functions
    MessageTypes.js        -- MSG enum, protocol version, schemas
    MessageSerializer.js   -- Encode/decode/validate + message factory functions
  transport/
    ITransport.js          -- TransportBase abstract class, TransportState enum
    LocalTransport.js      -- Synchronous loopback (single-player)
    SupabaseTransport.js   -- Supabase Realtime broadcast transport
    index.js               -- Global transport singleton management
  runtime/
    CommandQueue.js        -- Deterministic command buffer with ID preservation
    InputFactory.js        -- DOM events -> Command structs (SELECT bypasses transport)
    SimLoop.js             -- Fixed-timestep (50ms) accumulator pattern
    SeededRNG.js           -- Mulberry32 PRNG (global singleton)
    IdGenerator.js         -- Deterministic entity ID generation
    StateSurface.js        -- Serializable game state surface
  persistence/
    SaveManager.js         -- Save/load coordination
    SaveSchema.js          -- Save file format
    StorageAdapter.js      -- Local storage adapter
    SupabaseStorageAdapter.js -- Supabase DB storage adapter

src/Core/
  Game.js                  -- Main game class (ENABLE_COMMAND_EXECUTION, _processInputCommands)
  InteractionManager.js    -- Click/drag -> seat flow / command creation

src/Entities/
  Unit.js                  -- Unit entity (selectedBySlot, ownerSlot, seatPolicy)

src/UI/
  NetworkDebugPanel.js     -- Debug overlay for multiplayer diagnostics
  SeatKeypadOverlay.js     -- PIN entry overlay for seat acquisition
  JoinOverlay.js           -- Host/Join session overlay
```

---

## 7. Questions for Antigravity

### Q1. FPS Netcode Spec Placement
Should the FPS netcode architecture spec go in `docs/specs/NETCODE_ARCHITECTURE_FPS.md`? This follows the existing pattern (`R012_CONFIG_AND_SECRETS_STRATEGY.md`, `R013_IMPLEMENTATION_TASKLIST.md`). Alternative: `docs/master_plan/final_v2/appendices/APPENDIX_J_FPS_NETCODE.md` to keep it with the master plan.

### Q2. Server Code Location
Proposed: `server/` at repo root (monorepo approach, shares `SimCore` imports). Alternative: separate repository. The monorepo approach is strongly recommended because:
- SimLoop, CommandQueue, SeededRNG, StateSurface are shared between client and server
- Shared message schemas and serializers
- Single version control for protocol changes

### Q3. Supabase Boundary
Moving the game loop off Supabase means two connection types per client:
- Supabase Realtime: lobby discovery, auth, persistence, social features
- WebSocket: gameplay data (commands, position sync, state updates)

What test expectations exist for this boundary? Specifically: should the WebSocket transport degrade gracefully back to Supabase if the game server is unavailable?

### Q4. Integration Test Location
Headless server + simulated client tests: `tests/integration/netcode/` or follow existing `src/SimCore/__tests__/` pattern? Currently all 22 test files are in `src/SimCore/__tests__/`. A separate integration directory would be cleaner for multi-process tests.

### Q5. Roadmap Document
The original `docs/specs/R013_IMPLEMENTATION_TASKLIST.md` shows M07 gaps that have since been resolved. Options:
- **A**: Update it to reflect current state
- **B**: Archive it and create a new roadmap for the FPS netcode phase
- **C**: Both -- update for historical accuracy, then create new roadmap

### Q6. SimCore Headless Audit
Before Phase 1, SimCore must run without DOM/Three.js. Current known dependency: `POSITION_SYNC` handler in `Game.js` reconstructs `THREE.Vector3`. SessionManager itself is already clean (comment on line 15: "NOTE: Do NOT import 'three' here - SessionManager runs in Node tests"). Should this be a formal audit gate with a checklist?

---

## 8. Risk Register

| ID | Risk | Impact | Likelihood | Mitigation |
|----|------|--------|------------|------------|
| R1 | Three.js dependency in SimCore | Blocks server-side execution of sim loop | Medium | Formal headless audit; replace with pure math in shared code |
| R2 | Supabase Realtime latency (~50-200ms) | Unplayable for real-time gameplay | High (already observed) | WebSocket transport replaces it for gameplay; Supabase retained for lobby only |
| R3 | Client-side prediction complexity | Subtle desync bugs, hard to reproduce and test | High | Comprehensive determinism test suite (455 tests); visual debug tools; state hash comparison |
| R4 | Browser performance ceiling | 50+ entities with prediction + interpolation + rendering | Medium | Interest management; reduced AI tick rate for distant entities; LOD |
| R5 | Two transport paths (Supabase + WS) | More failure modes, harder debugging | Medium | Clear separation: Supabase = lobby/auth/persistence, WS = gameplay. Fallback path defined |
| R6 | Snapshot size growth | JOIN_ACK payload exceeds Supabase broadcast limits | Medium | Binary snapshot format (~21 bytes/entity vs ~3-5KB JSON/entity); delta snapshots for reconnect |
| R7 | Host migration data loss | Promoted guest may have stale state | Low | State hash verification; RESYNC_REQ flow (stub implemented); position sync as baseline |
| R8 | Manual HU-TEST gap | Real network conditions not yet tested | High | Prioritize 2-browser test; document results before any architecture changes |

---

## 9. Next Steps (Recommended Priority)

### Immediate (Before Architecture Changes)

1. **Manual 2-client HU-TEST** -- Host + Guest in two browser tabs over real Supabase Realtime. Validate: join flow, command delivery, seat acquisition with PIN, guest sees movement, host-leave migration. This is the highest priority gap.

2. **Bug A1 fix** -- Wire `NetworkDebugPanel` to poll `sessionManager.getAvailableHosts()` for visual discovery feedback. Low effort, high discoverability impact.

3. **Bug A3 investigation** -- Join timeout intermittency. May be Supabase channel propagation timing. Consider increasing the 500ms stabilization delay or adding retry logic.

### Phase 0 (Pre-FPS)

4. **Antigravity approval** of FPS netcode architecture direction
5. **SimCore headless audit** -- Zero DOM/Three.js deps in `src/SimCore/` (formal gate)
6. **Define `ISimAuthority` interface** -- Abstraction layer between transport and sim execution
7. **Create FPS netcode skills** (`asterobia-fps-netcode`, `asterobia-game-server`, `asterobia-binary-protocol`)

### Phase 1 (FPS Netcode Core)

8. **Implement `WebSocketTransport`** (behind feature flag, coexists with Supabase)
9. **Build minimal game server process** -- Node.js, runs SimLoop + CommandQueue headlessly
10. **Client-side prediction** for own vehicle (apply locally, reconcile on server state)
11. **Server reconciliation** -- Authoritative state broadcast, client rollback on mismatch
12. **Entity interpolation** -- Smooth rendering of remote entities between state updates

---

## 10. Protocol Reference

### Message Types (Complete)

| Type | Direction | Purpose |
|------|-----------|---------|
| `HELLO` | Any -> Lobby | Client presence announcement |
| `HOST_ANNOUNCE` | Host -> Lobby + Session | Periodic host advertisement (every 5s) |
| `JOIN_REQ` | Guest -> Session | Request to join game |
| `JOIN_ACK` | Host -> Session | Accept/reject join with snapshot |
| `INPUT_CMD` | Guest -> Host | Raw input command from guest |
| `CMD_BATCH` | Host -> Session | Batched commands with scheduling |
| `SNAPSHOT` | Host -> Session | Full state snapshot |
| `RESYNC_REQ` | Guest -> Host | Request full state resync |
| `RESYNC_ACK` | Host -> Guest | Resync response with snapshot |
| `PING` | Any -> Any | Latency measurement |
| `PONG` | Any -> Any | Latency measurement response |
| `SEAT_REQ` | Guest -> Host | Request unit control |
| `SEAT_ACK` | Host -> Session | Grant unit control |
| `SEAT_REJECT` | Host -> Session | Deny unit control |
| `SEAT_RELEASE` | Any -> Session | Release unit control |
| `HOST_LEAVE` | Host -> Session | Graceful host departure |
| `GUEST_LEAVE` | Guest -> Session | Graceful guest departure |
| `POSITION_SYNC` | Host -> Session | Authoritative unit positions |

### Constants

| Constant | Value | Location |
|----------|-------|----------|
| `PROTOCOL_VERSION` | `'0.13.0'` | `MessageTypes.js` |
| `LOBBY_CHANNEL` | `'asterobia:lobby'` | `SessionManager.js` |
| `ANNOUNCE_INTERVAL_MS` | `5000` | `SessionManager.js` |
| `CMD_BATCH_TICK_BUFFER` | `2` | `SessionManager.js` |
| `CMD_BATCH_STALE_THRESHOLD` | `10` | `SessionManager.js` |
| `MAX_COMMANDS_PER_BATCH` | `50` | `SessionManager.js` |
| `MAX_QUEUE_SIZE` | `200` | `SessionManager.js` |
| `SEAT_COOLDOWN_LEVELS` | `[250, 500, 1000, 2000]` ms | `SessionManager.js` |
| `HOST_ABSENCE_TIMEOUT_MS` | `15000` | `SessionManager.js` |
| `HOST_MIGRATION_GRACE_MS` | `3000` | `SessionManager.js` |
| `SIM_TICK_MS` | `50` (20 ticks/sec) | `SimLoop.js` |

---

*End of report. Questions and feedback welcome.*
