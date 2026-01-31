# R013: Implementation Tasklist

**Status**: Implementation Roadmap
**Source Specs**:
- [R013_MULTIPLAYER_HANDSHAKE_HOST_AUTHORITY.md](./R013_MULTIPLAYER_HANDSHAKE_HOST_AUTHORITY.md)
- [R013_DB_SCHEMA_OPTIONAL.md](./R013_DB_SCHEMA_OPTIONAL.md)

**Constraints**:
- Must preserve R010 determinism gates
- Must use R007 ITransport abstraction (no bypass)
- Must extend R012 SupabaseTransport patterns
- All `simTick` authority; no wall-clock game logic

---

## Table of Contents

1. [Implementation Lanes](#1-implementation-lanes)
2. [Micro-Steps (MVP Lane)](#2-micro-steps-mvp-lane)
3. [Micro-Steps (Nice-to-Have Lane)](#3-micro-steps-nice-to-have-lane)
4. [Dependency Graph](#4-dependency-graph)
5. [Test Matrix](#5-test-matrix)
6. [HU Scripts](#6-hu-scripts)
7. [Critical Callouts](#7-critical-callouts)

---

## 1. Implementation Lanes

### MVP Lane (Required for R013 Complete)

| Step | Name | Est. Complexity |
|------|------|-----------------|
| M01 | Message Types & Serializer | Low |
| M02 | NetworkRole Enum & State | Low |
| M03 | SessionManager Skeleton | Medium |
| M04 | Host: Lobby Channel + Announce | Medium |
| M05 | Guest: Lobby Discovery | Low |
| M06 | Host: Session Channel + Join Handling | Medium |
| M07 | Guest: Join Flow + Snapshot Apply | Medium |
| M08 | Guest: Input Routing via Transport | Medium |
| M09 | Host: Input Buffer + CMD_BATCH Broadcast | High |
| M10 | Host: SNAPSHOT Broadcast | Medium |
| M11 | Guest: Snapshot Receive + Render | Medium |
| M12 | PING/PONG + RTT Display | Low |
| M13 | Basic Disconnect Detection | Low |
| M14 | UI: Lobby + Status HUD | Medium |

### Nice-to-Have Lane (Post-MVP Polish)

| Step | Name | Est. Complexity |
|------|------|-----------------|
| N01 | RESYNC_REQ/ACK Flow | High |
| N02 | Command Replay (Gap < 50) | High |
| N03 | Rate Limiting | Low |
| N04 | Snapshot Compression | Medium |
| N05 | DB: Sessions Table (Persistent Lobby) | Medium |
| N06 | DB: Command Log Table | Medium |

---

## 2. Micro-Steps (MVP Lane)

---

### M01: Message Types & Serializer

**Goal**: Define all R013 message schemas and encode/decode utilities.

**Files to Create**:
- `src/SimCore/multiplayer/MessageTypes.js`
- `src/SimCore/multiplayer/MessageSerializer.js`

**Files to Modify**: None (new module)

**Implementation Details**:
```javascript
// MessageTypes.js - Export constants + schema validators
export const MSG = {
  HELLO: 'HELLO',
  HOST_ANNOUNCE: 'HOST_ANNOUNCE',
  JOIN_REQ: 'JOIN_REQ',
  JOIN_ACK: 'JOIN_ACK',
  INPUT_CMD: 'INPUT_CMD',
  CMD_BATCH: 'CMD_BATCH',
  SNAPSHOT: 'SNAPSHOT',
  RESYNC_REQ: 'RESYNC_REQ',
  RESYNC_ACK: 'RESYNC_ACK',
  PING: 'PING',
  PONG: 'PONG'
};

// MessageSerializer.js - encode(obj) → JSON string, decode(str) → obj
// Include schema validation for each type
```

**Tests to Add**:
- `src/SimCore/__tests__/messageSerializer.test.js`
  - `encode/decode round-trip for all 10 message types`
  - `reject malformed messages`
  - `handle missing optional fields`

**Test Command**: `npm test -- messageSerializer`

**HU Check**: N/A (pure logic, no UI)

**Risk Notes**:
1. Schema drift if spec changes — validate against spec on each change
2. JSON size bloat — keep field names short, measure in tests

**Parallelizable**: YES (no dependencies)

---

### M02: NetworkRole Enum & State

**Goal**: Define Host/Guest/Offline roles and session state container.

**Files to Create**:
- `src/SimCore/multiplayer/NetworkRole.js`
- `src/SimCore/multiplayer/SessionState.js`

**Files to Modify**: None

**Implementation Details**:
```javascript
// NetworkRole.js
export const NetworkRole = {
  OFFLINE: 'OFFLINE',
  HOST: 'HOST',
  GUEST: 'GUEST'
};

// SessionState.js - holds current role, hostId, slot, seq counter, etc.
export class SessionState {
  constructor() {
    this.role = NetworkRole.OFFLINE;
    this.hostId = null;
    this.sessionId = null;
    this.mySlot = 0;
    this.seqCounter = 0;
    this.players = [];  // [{slot, userId, displayName, status}]
    this.lastSeenSeq = {}; // slot → seq (for Host dedup)
  }
}
```

**Tests to Add**:
- `src/SimCore/__tests__/sessionState.test.js`
  - `initial state is OFFLINE`
  - `transition to HOST sets correct fields`
  - `transition to GUEST sets correct fields`
  - `seqCounter increments correctly`

**Test Command**: `npm test -- sessionState`

**HU Check**: N/A

**Risk Notes**:
1. State leaks between sessions — ensure `reset()` method clears all
2. Slot assignment race — handled in M06

**Parallelizable**: YES (no dependencies)

---

### M03: SessionManager Skeleton

**Goal**: Central coordinator class that orchestrates handshake flow.

**Files to Create**:
- `src/SimCore/multiplayer/SessionManager.js`

**Files to Modify**:
- `src/Core/Game.js` (add `this.sessionManager = new SessionManager(this)`)

**Implementation Details**:
```javascript
export class SessionManager {
  constructor(game) {
    this.game = game;
    this.state = new SessionState();
    this.transport = null; // Set by setTransport()
  }

  setTransport(transport) { this.transport = transport; }

  async hostGame(sessionName) { /* M04 */ }
  async joinGame(hostId) { /* M06-M07 */ }
  async leaveGame() { /* M13 */ }

  onMessage(msg) { /* Router to handlers */ }
}
```

**Tests to Add**:
- `src/SimCore/__tests__/sessionManager.test.js`
  - `constructs with OFFLINE state`
  - `setTransport stores reference`
  - `onMessage routes to correct handler`

**Test Command**: `npm test -- sessionManager`

**HU Check**: N/A (skeleton only)

**Risk Notes**:
1. Circular dependency Game ↔ SessionManager — use late binding or events
2. Transport null check — always guard `this.transport?.send()`

**Parallelizable**: NO (depends on M01, M02)

---

### M04: Host: Lobby Channel + Announce

**Goal**: Host joins lobby channel and broadcasts HOST_ANNOUNCE every 5s.

**Files to Modify**:
- `src/SimCore/multiplayer/SessionManager.js`
- `src/SimCore/transport/SupabaseTransport.js` (add `joinChannel`, `broadcastToChannel`)

**Implementation Details**:
```javascript
// SessionManager.hostGame()
async hostGame(sessionName) {
  this.state.role = NetworkRole.HOST;
  this.state.hostId = this.game.clientId;
  this.state.sessionId = this.game.clientId; // Host = session owner

  await this.transport.joinChannel('asterobia:lobby');
  this.announceInterval = setInterval(() => this.sendAnnounce(), 5000);
  this.sendAnnounce(); // Immediate first announce
}

sendAnnounce() {
  const msg = {
    type: MSG.HOST_ANNOUNCE,
    hostId: this.state.hostId,
    sessionName: this.sessionName,
    mapSeed: this.game.mapSeed,
    simTick: this.game.simTick,
    currentPlayers: this.state.players.length,
    maxPlayers: 4,
    protocolVersion: '0.13.0',
    timestamp: Date.now()
  };
  this.transport.broadcastToChannel('asterobia:lobby', msg);
}
```

**Tests to Add**:
- `src/SimCore/__tests__/sessionManager.host.test.js`
  - `hostGame sets role to HOST`
  - `hostGame joins lobby channel`
  - `sendAnnounce broadcasts correct schema`
  - `announce repeats every 5s`

**Test Command**: `npm test -- sessionManager.host`

**HU Check**:
- Open DevTools → Network → Filter WS
- Click "Host Game" → See `HOST_ANNOUNCE` messages every 5s

**Risk Notes**:
1. Interval leak on disconnect — clear in `leaveGame()`
2. Supabase channel name typo — use constants

**Parallelizable**: NO (depends on M03)

---

### M05: Guest: Lobby Discovery

**Goal**: Guest subscribes to lobby channel and lists available hosts.

**Files to Modify**:
- `src/SimCore/multiplayer/SessionManager.js`
- `src/SimCore/transport/SupabaseTransport.js` (add `onChannelMessage` callback)

**Implementation Details**:
```javascript
// SessionManager
async discoverHosts() {
  this.availableHosts = new Map(); // hostId → HOST_ANNOUNCE data
  await this.transport.joinChannel('asterobia:lobby', (msg) => {
    if (msg.type === MSG.HOST_ANNOUNCE) {
      this.availableHosts.set(msg.hostId, msg);
      this.onHostListUpdated?.(); // Callback for UI
    }
  });
}

getHostList() {
  return Array.from(this.availableHosts.values())
    .filter(h => h.currentPlayers < h.maxPlayers);
}
```

**Tests to Add**:
- `src/SimCore/__tests__/sessionManager.discovery.test.js`
  - `discoverHosts populates availableHosts`
  - `getHostList filters full sessions`
  - `stale hosts removed after 15s without announce`

**Test Command**: `npm test -- sessionManager.discovery`

**HU Check**:
- Tab A: Host Game
- Tab B: Join Game → See Tab A in list within 5s

**Risk Notes**:
1. Stale host entries — prune after 15s (3 missed heartbeats)
2. Race if host leaves during join — handled in M06

**Parallelizable**: NO (depends on M04 conceptually, but code is independent)

---

### M06: Host: Session Channel + Join Handling

**Goal**: Host creates session channel, handles JOIN_REQ, responds with JOIN_ACK.

**Files to Modify**:
- `src/SimCore/multiplayer/SessionManager.js`

**Implementation Details**:
```javascript
// After hostGame() succeeds, also join session channel
await this.transport.joinChannel(`asterobia:session:${this.state.hostId}`,
  (msg) => this.onSessionMessage(msg));

handleJoinReq(msg) {
  // Validate
  if (msg.protocolVersion !== '0.13.0') {
    return this.sendJoinAck(msg.guestId, false, 'VERSION_MISMATCH');
  }
  if (this.state.players.length >= 4) {
    return this.sendJoinAck(msg.guestId, false, 'SESSION_FULL');
  }

  // Assign slot
  const slot = this.findNextSlot();
  this.state.players.push({
    slot, userId: msg.guestId, displayName: msg.displayName, status: 'active'
  });

  // Send ACK with snapshot
  const snapshot = this.game.stateSurface.serialize();
  this.sendJoinAck(msg.guestId, true, null, slot, snapshot);
}

sendJoinAck(guestId, accepted, reason, slot, snapshot) {
  const msg = {
    type: MSG.JOIN_ACK,
    accepted,
    rejectReason: reason,
    assignedSlot: slot,
    simTick: this.game.simTick,
    fullSnapshot: snapshot,
    timestamp: Date.now()
  };
  // Send directly to guest (or broadcast, guest filters by own id)
  this.transport.broadcastToChannel(`asterobia:session:${this.state.hostId}`, msg);
}
```

**Tests to Add**:
- `src/SimCore/__tests__/sessionManager.join.test.js`
  - `handleJoinReq accepts valid request`
  - `handleJoinReq rejects version mismatch`
  - `handleJoinReq rejects when full`
  - `slot assignment is sequential 0-3`
  - `JOIN_ACK contains full snapshot`

**Test Command**: `npm test -- sessionManager.join`

**HU Check**:
- Tab A: Host
- Tab B: Join → See "Connected" status

**Risk Notes**:
1. Concurrent JOIN_REQ race — process sequentially via queue
2. Snapshot serialization failure — wrap in try/catch, reject gracefully

**Parallelizable**: NO (depends on M04)

---

### M07: Guest: Join Flow + Snapshot Apply

**Goal**: Guest sends JOIN_REQ, receives JOIN_ACK, applies snapshot.

**Files to Modify**:
- `src/SimCore/multiplayer/SessionManager.js`
- `src/Core/Game.js` (add `applySnapshot(data)` method)

**Implementation Details**:
```javascript
// SessionManager
async joinGame(hostId) {
  this.state.role = NetworkRole.GUEST;
  this.state.hostId = hostId;

  await this.transport.joinChannel(`asterobia:session:${hostId}`,
    (msg) => this.onSessionMessage(msg));

  // Send join request
  const req = {
    type: MSG.JOIN_REQ,
    guestId: this.game.clientId,
    displayName: this.game.playerName || 'Guest',
    protocolVersion: '0.13.0',
    timestamp: Date.now()
  };
  this.transport.broadcastToChannel(`asterobia:session:${hostId}`, req);

  // Wait for ACK (with timeout)
  return new Promise((resolve, reject) => {
    this.pendingJoin = { resolve, reject };
    setTimeout(() => {
      if (this.pendingJoin) {
        this.pendingJoin.reject(new Error('JOIN_TIMEOUT'));
        this.pendingJoin = null;
      }
    }, 10000);
  });
}

handleJoinAck(msg) {
  if (msg.accepted) {
    this.state.mySlot = msg.assignedSlot;
    this.game.applySnapshot(msg.fullSnapshot);
    this.game.simTick = msg.simTick;
    this.pendingJoin?.resolve(true);
  } else {
    this.pendingJoin?.reject(new Error(msg.rejectReason));
  }
  this.pendingJoin = null;
}
```

**Critical**: Guest must NOT call `SimCore.step()` after joining. Set flag `this.game.isGuest = true`.

**Tests to Add**:
- `src/SimCore/__tests__/sessionManager.guest.test.js`
  - `joinGame sends JOIN_REQ`
  - `handleJoinAck applies snapshot`
  - `handleJoinAck sets mySlot`
  - `handleJoinAck rejection throws error`
  - `timeout after 10s if no ACK`

**Test Command**: `npm test -- sessionManager.guest`

**HU Check**:
- Tab B joins Tab A → Units appear in same positions

**Risk Notes**:
1. Snapshot apply corrupts local state — validate schema before apply
2. simTick misalignment — overwrite local tick with Host's tick

**Parallelizable**: NO (depends on M06)

---

### M08: Guest: Input Routing via Transport

**Goal**: Guest inputs go to Transport (not local queue), Host receives them.

**Files to Modify**:
- `src/SimCore/commands/CommandQueue.js` (add network routing)
- `src/SimCore/multiplayer/SessionManager.js`

**Implementation Details**:
```javascript
// CommandQueue.js
enqueue(command) {
  if (this.game.sessionManager?.state.role === NetworkRole.GUEST) {
    // Route to Host via transport
    this.game.sessionManager.sendInputCmd(command);
    return; // Do NOT add to local queue
  }
  // Normal local processing (Host or Offline)
  this.queue.push(command);
}

// SessionManager.js
sendInputCmd(command) {
  const msg = {
    type: MSG.INPUT_CMD,
    senderId: this.game.clientId,
    slot: this.state.mySlot,
    seq: this.state.seqCounter++,
    command: command,
    timestamp: Date.now()
  };
  this.transport.broadcastToChannel(`asterobia:session:${this.state.hostId}`, msg);
}
```

**CRITICAL INVARIANT**: Guest MUST NOT mutate state locally. `CommandQueue.enqueue` on Guest only sends to network.

**Tests to Add**:
- `src/SimCore/__tests__/commandQueue.network.test.js`
  - `Guest enqueue sends INPUT_CMD`
  - `Guest enqueue does NOT add to local queue`
  - `Host enqueue adds to local queue`
  - `seq increments per command`

**Test Command**: `npm test -- commandQueue.network`

**HU Check**:
- Tab B: Click to move unit → Console shows `[NET] INPUT_CMD sent`
- Tab A: Console shows `[NET] INPUT_CMD received`

**Risk Notes**:
1. Input bypass if role check fails — add assertion
2. Lost inputs if transport disconnects — queue locally, resend on reconnect (N01)

**Parallelizable**: NO (depends on M07)

---

### M09: Host: Input Buffer + CMD_BATCH Broadcast

**Goal**: Host collects inputs from all clients, broadcasts CMD_BATCH each tick.

**Files to Modify**:
- `src/SimCore/multiplayer/SessionManager.js`
- `src/SimCore/SimLoop.js` (call `sessionManager.flushBatch()` after step)

**Implementation Details**:
```javascript
// SessionManager
constructor() {
  this.inputBuffer = []; // Incoming INPUT_CMDs for current tick
}

handleInputCmd(msg) {
  // Dedup by seq
  const lastSeq = this.state.lastSeenSeq[msg.slot] ?? -1;
  if (msg.seq <= lastSeq) {
    console.warn(`[NET] Duplicate INPUT_CMD seq=${msg.seq} from slot=${msg.slot}`);
    return;
  }
  this.state.lastSeenSeq[msg.slot] = msg.seq;

  // Add to buffer
  this.inputBuffer.push({
    slot: msg.slot,
    seq: msg.seq,
    command: msg.command
  });

  // Also add to local CommandQueue for Host's SimCore
  this.game.commandQueue.enqueue(msg.command);
}

flushBatch() {
  if (this.state.role !== NetworkRole.HOST) return;
  if (this.inputBuffer.length === 0) return;

  const batch = {
    type: MSG.CMD_BATCH,
    simTick: this.game.simTick,
    commands: [...this.inputBuffer],
    timestamp: Date.now()
  };
  this.transport.broadcastToChannel(`asterobia:session:${this.state.hostId}`, batch);
  this.inputBuffer = [];
}

// SimLoop.js - after SimCore.step()
if (this.game.sessionManager?.state.role === NetworkRole.HOST) {
  this.game.sessionManager.flushBatch();
}
```

**Tests to Add**:
- `src/SimCore/__tests__/sessionManager.batch.test.js`
  - `handleInputCmd deduplicates by seq`
  - `flushBatch sends CMD_BATCH with all buffered commands`
  - `flushBatch clears buffer`
  - `flushBatch no-op if not HOST`

**Test Command**: `npm test -- sessionManager.batch`

**HU Check**:
- Tab A (Host): See `[NET] CMD_BATCH tick=X` logs each tick
- Tab B: See `[NET] CMD_BATCH received` logs

**Risk Notes**:
1. Order matters — preserve arrival order in buffer
2. Large batch size — cap at 50 commands per tick, log warning if exceeded

**Parallelizable**: NO (depends on M08)

---

### M10: Host: SNAPSHOT Broadcast

**Goal**: Host broadcasts SNAPSHOT every 10 ticks (configurable).

**Files to Modify**:
- `src/SimCore/multiplayer/SessionManager.js`
- `src/SimCore/SimLoop.js`

**Implementation Details**:
```javascript
// SessionManager
constructor() {
  this.snapshotInterval = 10; // ticks
}

maybeSendSnapshot() {
  if (this.state.role !== NetworkRole.HOST) return;
  if (this.game.simTick % this.snapshotInterval !== 0) return;

  const state = this.game.stateSurface.serialize();
  const hash = this.computeHash(state); // Simple JSON hash

  const msg = {
    type: MSG.SNAPSHOT,
    simTick: this.game.simTick,
    stateHash: hash,
    state: state,
    timestamp: Date.now()
  };
  this.transport.broadcastToChannel(`asterobia:session:${this.state.hostId}`, msg);
}

computeHash(obj) {
  // Simple hash for debugging
  const str = JSON.stringify(obj);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(16);
}

// SimLoop.js - after flushBatch()
this.game.sessionManager?.maybeSendSnapshot();
```

**Tests to Add**:
- `src/SimCore/__tests__/sessionManager.snapshot.test.js`
  - `maybeSendSnapshot sends at interval`
  - `maybeSendSnapshot skips non-interval ticks`
  - `SNAPSHOT contains valid state`
  - `stateHash is consistent for same state`

**Test Command**: `npm test -- sessionManager.snapshot`

**HU Check**:
- Tab A: See `[NET] SNAPSHOT tick=10,20,30...` logs
- Check payload size < 50KB

**Risk Notes**:
1. Snapshot too large — log warning if > 50KB, implement compression (N04)
2. Serialization perf — measure, should be < 10ms

**Parallelizable**: NO (depends on M09)

---

### M11: Guest: Snapshot Receive + Render

**Goal**: Guest applies received snapshots, does NOT run SimCore.step().

**Files to Modify**:
- `src/SimCore/multiplayer/SessionManager.js`
- `src/Core/Game.js` (add `isGuest` flag, skip step if true)
- `src/SimCore/SimLoop.js`

**Implementation Details**:
```javascript
// SessionManager
handleSnapshot(msg) {
  if (this.state.role !== NetworkRole.GUEST) return;

  // Optional: verify hash matches
  // const localHash = this.computeHash(msg.state);
  // if (localHash !== msg.stateHash) { trigger resync }

  // Apply state
  this.game.applySnapshot(msg.state);
  this.game.simTick = msg.simTick;
}

// SimLoop.js
step() {
  if (this.game.isGuest) {
    // Guest: do NOT step, just render interpolated state
    return;
  }
  // Host/Offline: normal step
  this.simCore.step();
}
```

**CRITICAL INVARIANT**: `SimCore.step()` MUST NOT run on Guest. Guest is render-only.

**Tests to Add**:
- `src/SimCore/__tests__/sessionManager.guestRender.test.js`
  - `handleSnapshot applies state`
  - `handleSnapshot updates simTick`
  - `Guest SimLoop.step is no-op`

**Test Command**: `npm test -- sessionManager.guestRender`

**HU Check**: HU-01 (see section 6)

**Risk Notes**:
1. Guest steps accidentally — add assertion, log error if detected
2. Interpolation jank — existing R008 interpolation should handle

**Parallelizable**: NO (depends on M10)

---

### M12: PING/PONG + RTT Display

**Goal**: Measure round-trip latency, display in HUD.

**Files to Modify**:
- `src/SimCore/multiplayer/SessionManager.js`
- HUD component (existing)

**Implementation Details**:
```javascript
// SessionManager
startPingLoop() {
  this.pingSeq = 0;
  this.pendingPings = new Map(); // seq → timestamp
  this.rtt = 0;

  this.pingInterval = setInterval(() => {
    const seq = this.pingSeq++;
    this.pendingPings.set(seq, Date.now());
    const msg = {
      type: MSG.PING,
      senderId: this.game.clientId,
      seq: seq,
      timestamp: Date.now()
    };
    this.transport.broadcastToChannel(`asterobia:session:${this.state.hostId}`, msg);
  }, 2000);
}

handlePing(msg) {
  // Respond with PONG
  const pong = {
    type: MSG.PONG,
    responderId: this.game.clientId,
    pingSeq: msg.seq,
    originalTimestamp: msg.timestamp,
    timestamp: Date.now()
  };
  this.transport.broadcastToChannel(`asterobia:session:${this.state.hostId}`, pong);
}

handlePong(msg) {
  const sent = this.pendingPings.get(msg.pingSeq);
  if (sent) {
    this.rtt = Date.now() - sent;
    this.pendingPings.delete(msg.pingSeq);
  }
}

getRTT() { return this.rtt; }
```

**Tests to Add**:
- `src/SimCore/__tests__/sessionManager.ping.test.js`
  - `PING sent every 2s`
  - `PONG response is immediate`
  - `RTT calculated correctly`

**Test Command**: `npm test -- sessionManager.ping`

**HU Check**:
- HUD shows "RTT: XXms" value
- Value updates every 2s

**Risk Notes**:
1. pendingPings memory leak — prune entries older than 10s
2. RTT spikes — use rolling average of last 5

**Parallelizable**: YES (independent of M09-M11, can start after M06)

---

### M13: Basic Disconnect Detection

**Goal**: Detect when Host or Guest disconnects, handle gracefully.

**Files to Modify**:
- `src/SimCore/multiplayer/SessionManager.js`
- `src/SimCore/transport/SupabaseTransport.js`

**Implementation Details**:
```javascript
// SessionManager
constructor() {
  this.lastMessageTime = {}; // slot → timestamp
  this.disconnectTimeout = 10000; // 10s
}

// Called on every message received
updateHeartbeat(slot) {
  this.lastMessageTime[slot] = Date.now();
}

checkDisconnects() {
  const now = Date.now();
  for (const [slot, time] of Object.entries(this.lastMessageTime)) {
    if (now - time > this.disconnectTimeout) {
      this.handlePlayerDisconnect(parseInt(slot));
    }
  }
}

handlePlayerDisconnect(slot) {
  const player = this.state.players.find(p => p.slot === slot);
  if (player) {
    player.status = 'disconnected';
    console.warn(`[NET] Player ${player.displayName} disconnected`);
    // Future: mark units as AI-controlled
  }
}

// SupabaseTransport - detect WebSocket close
onChannelClose(channelName) {
  if (channelName.includes('session:')) {
    this.sessionManager.handleHostDisconnect();
  }
}

handleHostDisconnect() {
  if (this.state.role === NetworkRole.GUEST) {
    console.error('[NET] Host disconnected. Session ended.');
    this.leaveGame();
    this.game.showDisconnectModal();
  }
}
```

**Tests to Add**:
- `src/SimCore/__tests__/sessionManager.disconnect.test.js`
  - `checkDisconnects marks player after timeout`
  - `handleHostDisconnect ends session for Guest`

**Test Command**: `npm test -- sessionManager.disconnect`

**HU Check**:
- Tab A: Close tab
- Tab B: See "Host disconnected" message within 10s

**Risk Notes**:
1. False positive on slow connection — use PING timeout, not just message gap
2. Guest reconnect — implement in N01

**Parallelizable**: YES (independent, can start after M06)

---

### M14: UI: Lobby + Status HUD

**Goal**: Add Host/Join buttons, lobby list, connection status HUD.

**Files to Modify**:
- `src/UI/LobbyPanel.js` (new or extend existing)
- `src/UI/HUD.js` (add network status)
- `game.html` (add lobby UI elements)

**Implementation Details**:
- Lobby Panel:
  - "Host Game" button → calls `sessionManager.hostGame()`
  - "Refresh" button → calls `sessionManager.discoverHosts()`
  - Host list with "Join" buttons
  - Display: sessionName, currentPlayers/maxPlayers, ping estimate

- HUD Status:
  - Mode: `OFFLINE | HOST | GUEST`
  - Connection: `Connected | Disconnected | Reconnecting`
  - RTT: `XXms` (from M12)
  - simTick: `#XXXX`

**Tests to Add**:
- `tests/e2e/lobby-ui.spec.js` (Playwright)
  - `Host button creates session`
  - `Join button connects to host`
  - `HUD shows correct status`

**Test Command**: `npx playwright test lobby-ui`

**HU Check**: HU-01, HU-02, HU-03 (see section 6)

**Risk Notes**:
1. UI blocks main thread — use requestAnimationFrame for updates
2. State sync with SessionManager — use events or polling

**Parallelizable**: PARTIAL (depends on M03-M07 for integration, but UI scaffolding can start early)

---

## 3. Micro-Steps (Nice-to-Have Lane)

---

### N01: RESYNC_REQ/ACK Flow

**Goal**: Guest can request resync after disconnect or desync detection.

**Files to Modify**:
- `src/SimCore/multiplayer/SessionManager.js`

**Implementation Details**:
- Guest sends `RESYNC_REQ` with `lastKnownTick`
- Host responds with `RESYNC_ACK` containing snapshot + command log (if gap < 50)
- Guest applies snapshot OR replays commands

**Tests to Add**:
- `src/SimCore/__tests__/sessionManager.resync.test.js`

**HU Check**: HU-02 (Disconnect/Reconnect)

**Risk Notes**:
1. Command replay determinism — must replay in exact order
2. Large gap handling — always fallback to full snapshot if unsure

**Parallelizable**: NO (depends on MVP completion)

---

### N02: Command Replay (Gap < 50)

**Goal**: Fast-forward by replaying missed commands instead of full snapshot.

**Files to Modify**:
- `src/SimCore/multiplayer/SessionManager.js`
- `src/SimCore/SimLoop.js` (add `replayCommands(log)` method)

**Implementation Details**:
- Store last 100 ticks of CMD_BATCH on Host
- On RESYNC_REQ, send commandLog for gap
- Guest replays commands via `SimCore.step()` with injected queue

**CRITICAL**: During replay, Guest temporarily runs SimCore. Flag must be set correctly.

**Tests to Add**:
- `src/SimCore/__tests__/commandReplay.test.js`

**HU Check**: Fast reconnect scenario

**Risk Notes**:
1. Determinism mismatch — verify hash after replay
2. Replay too slow — cap at 50 ticks, else full snapshot

**Parallelizable**: NO (depends on N01)

---

### N03: Rate Limiting

**Goal**: Prevent spam attacks on Host.

**Files to Create**:
- `src/SimCore/multiplayer/RateLimiter.js`

**Implementation Details**:
```javascript
class RateLimiter {
  constructor(maxPerSecond) {
    this.maxPerSecond = maxPerSecond;
    this.counts = {}; // senderId → {count, resetTime}
  }
  check(senderId) { /* return true if allowed */ }
}
```

**Tests to Add**:
- `src/SimCore/__tests__/rateLimiter.test.js`

**Risk Notes**:
1. Legit burst blocked — allow small burst buffer
2. Clock drift — use monotonic time

**Parallelizable**: YES (independent utility)

---

### N04: Snapshot Compression

**Goal**: Reduce SNAPSHOT payload size via gzip or delta encoding.

**Files to Modify**:
- `src/SimCore/multiplayer/SessionManager.js`
- Add pako or similar gzip library

**Implementation Details**:
- If serialized size > 20KB, compress with gzip
- Add `compressed: true` flag to message
- Guest decompresses before apply

**Tests to Add**:
- `src/SimCore/__tests__/snapshotCompression.test.js`

**Risk Notes**:
1. Compression CPU cost — measure, should be < 5ms
2. Decompression on Guest — same budget

**Parallelizable**: YES (independent utility)

---

### N05: DB: Sessions Table (Persistent Lobby)

**Goal**: Persist sessions to DB for lobby listing across page refreshes.

**Files to Modify**:
- Supabase SQL (see R013_DB_SCHEMA_OPTIONAL.md)
- `src/SimCore/multiplayer/SessionManager.js`

**Implementation Details**:
- On hostGame: INSERT into sessions
- On heartbeat: UPDATE last_heartbeat
- On leaveGame: DELETE or set is_active = false
- Discovery: SELECT from sessions WHERE is_active

**Tests to Add**:
- `src/SimCore/__tests__/sessionManager.db.test.js`

**HU Check**: Lobby persists after Host F5

**Risk Notes**:
1. Stale sessions — need cleanup cron or Host-side heartbeat
2. RLS misconfiguration — test with anon user

**Parallelizable**: YES (DB-only, no code deps beyond M04)

---

### N06: DB: Command Log Table

**Goal**: Persist command batches for resync support.

**Files to Modify**:
- Supabase SQL (see R013_DB_SCHEMA_OPTIONAL.md)
- `src/SimCore/multiplayer/SessionManager.js`

**Implementation Details**:
- On flushBatch: INSERT into command_log
- On RESYNC_REQ: SELECT commands WHERE tick > lastKnownTick
- Cleanup: DELETE WHERE created_at < 10 min ago

**Tests to Add**:
- `src/SimCore/__tests__/commandLog.db.test.js`

**Risk Notes**:
1. High write volume — batch inserts, use upsert
2. Query performance — index on (session_id, sim_tick)

**Parallelizable**: YES (DB-only)

---

## 4. Dependency Graph

```
                    ┌────────────────────────────────────┐
                    │           PARALLELIZABLE           │
                    └────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         │                    │                    │
         ▼                    ▼                    ▼
     ┌───────┐            ┌───────┐            ┌───────┐
     │  M01  │            │  M02  │            │  N03  │
     │ Msgs  │            │ State │            │ Rate  │
     └───┬───┘            └───┬───┘            │ Limit │
         │                    │                └───────┘
         └────────┬───────────┘
                  │
                  ▼
              ┌───────┐
              │  M03  │ SessionManager Skeleton
              └───┬───┘
                  │
         ┌────────┴────────┐
         │                 │
         ▼                 ▼
     ┌───────┐         ┌───────┐
     │  M04  │         │  N05  │ (DB: sessions - parallel)
     │ Host  │         └───────┘
     │Announce│
     └───┬───┘
         │
         ├────────────────────────────────────┐
         │                                    │
         ▼                                    ▼
     ┌───────┐                            ┌───────┐
     │  M05  │ Guest Discovery            │  M06  │ Join Handling
     └───┬───┘                            └───┬───┘
         │                                    │
         └──────────────┬─────────────────────┘
                        │
                        ▼
                    ┌───────┐
                    │  M07  │ Guest Join + Snapshot
                    └───┬───┘
                        │
         ┌──────────────┼──────────────┐
         │              │              │
         ▼              ▼              ▼
     ┌───────┐      ┌───────┐      ┌───────┐
     │  M08  │      │  M12  │      │  M13  │
     │ Input │      │ PING  │      │Disconn│
     │Routing│      │ PONG  │      └───────┘
     └───┬───┘      └───────┘
         │
         ▼
     ┌───────┐
     │  M09  │ CMD_BATCH
     └───┬───┘
         │
         ▼
     ┌───────┐
     │  M10  │ SNAPSHOT Broadcast
     └───┬───┘
         │
         ▼
     ┌───────┐
     │  M11  │ Guest Receive + Render
     └───┬───┘
         │
         ▼
     ┌───────┐
     │  M14  │ UI: Lobby + HUD
     └───┬───┘
         │
         ▼
    ═══════════════════════════════════════
              MVP COMPLETE
    ═══════════════════════════════════════
         │
         ├──────────────┬──────────────┐
         │              │              │
         ▼              ▼              ▼
     ┌───────┐      ┌───────┐      ┌───────┐
     │  N01  │      │  N04  │      │  N06  │
     │Resync │      │Compress│     │ DB:Log│
     └───┬───┘      └───────┘      └───────┘
         │
         ▼
     ┌───────┐
     │  N02  │ Command Replay
     └───────┘
```

### Safe for Parallel Claude Instances

| Parallel Group | Steps | Constraint |
|----------------|-------|------------|
| **Group A** | M01, M02, N03 | No shared files |
| **Group B** | M05, M06 | After M04, different concerns |
| **Group C** | M12, M13 | After M06, independent features |
| **Group D** | N04, N05, N06 | Post-MVP, independent utilities |

### Sequential Dependencies

| Step | Hard Dependency |
|------|-----------------|
| M03 | M01, M02 |
| M04 | M03 |
| M07 | M06 |
| M08 | M07 |
| M09 | M08 |
| M10 | M09 |
| M11 | M10 |
| M14 | M11 |
| N01 | M14 (MVP complete) |
| N02 | N01 |

---

## 5. Test Matrix

### Unit Tests

| Test File | Steps Covered | Mock Required |
|-----------|---------------|---------------|
| `messageSerializer.test.js` | M01 | None |
| `sessionState.test.js` | M02 | None |
| `sessionManager.test.js` | M03 | MockTransport |
| `sessionManager.host.test.js` | M04 | MockTransport |
| `sessionManager.discovery.test.js` | M05 | MockTransport |
| `sessionManager.join.test.js` | M06 | MockTransport, MockGame |
| `sessionManager.guest.test.js` | M07 | MockTransport, MockGame |
| `commandQueue.network.test.js` | M08 | MockTransport |
| `sessionManager.batch.test.js` | M09 | MockTransport |
| `sessionManager.snapshot.test.js` | M10 | MockTransport, MockStateSurface |
| `sessionManager.guestRender.test.js` | M11 | MockGame |
| `sessionManager.ping.test.js` | M12 | MockTransport |
| `sessionManager.disconnect.test.js` | M13 | MockTransport |
| `rateLimiter.test.js` | N03 | None |
| `snapshotCompression.test.js` | N04 | None |
| `sessionManager.resync.test.js` | N01 | MockTransport |
| `commandReplay.test.js` | N02 | MockSimCore |

### Integration Tests

| Test ID | Description | Setup | Validates |
|---------|-------------|-------|-----------|
| IT-01 | Host appears in lobby | 2 tabs | M04, M05 |
| IT-02 | Guest joins successfully | 2 tabs, join flow | M06, M07 |
| IT-03 | Input routed to Host | 2 tabs, move command | M08, M09 |
| IT-04 | Guest sees movement | 2 tabs, Host moves | M10, M11 |
| IT-05 | RTT displayed | 2 tabs | M12 |
| IT-06 | Disconnect detected | 2 tabs, close one | M13 |

### Test Commands

```bash
# Unit tests
npm test -- messageSerializer
npm test -- sessionState
npm test -- sessionManager

# All multiplayer tests
npm test -- --grep "sessionManager|commandQueue.network"

# Integration (requires Supabase running)
npm run test:integration

# E2E (Playwright)
npx playwright test multiplayer-handshake
```

---

## 6. HU Scripts

### HU-01: "A moves, B sees"

**Teszt celja**: Alapveto multiplayer szinkronizacio.

**Lepesek**:
1. Nyiss ket bongeszo tabot (Tab A, Tab B)
2. Tab A: Kattints "Host Game" gombra
3. Tab A: Varj amig megjelenik "Hosting: [Session Name]" a HUD-ban
4. Tab B: Kattints "Join Game" gombra
5. Tab B: Valaszd ki Tab A sessionjet a listabol
6. Tab B: Kattints "Join" → Varj "Connected" allapotra
7. Tab A: Valassz ki egy egyseg-et (kattints ra)
8. Tab A: Kattints a terkepen egy uj poziciora (MOVE parancs)
9. Tab B: Figyeld az egyseg mozgasat

**Elvart eredmeny**:
- Tab B-n az egyseg elindul az uj pozicio fele
- Mozgas 500ms-on belul lathatova valik
- Nincs "ugras" vagy teleportalas

**PASS kriterium**: Tab B megjeleníti a mozgást 500ms-on belül, pozíció eltérés < 5 pixel.

**FAIL kriterium**: Nincs mozgas Tab B-n 2 masodpercen belul, VAGY az egyseg mas poziciora mozog.

---

### HU-02: "Disconnect/Reconnect"

**Teszt celja**: Ujracsatlakozas utani allapot-helyreallitas.

**Lepesek**:
1. Hajtsd vegre HU-01 1-6. lepeseit (A host, B csatlakozik)
2. Tab A: Adj ki 3 MOVE parancsot kulonbozo egysegekkelsegeknek
3. Tab B: Nyisd meg F12 (DevTools) → Network tab → Kattints "Offline" gombra
4. Tab A: Adj ki meg 2 MOVE parancsot
5. Tab B: Kattints "Online" gombra (vagy frissitsd az oldalt)
6. Tab B: Ha szukseges, kattints "Rejoin" gombra
7. Varj 5 masodpercet

**Elvart eredmeny**:
- Tab B visszacsatlakozik
- Tab B allapota megegyezik Tab A-val (minden egyseg helyes pozicioban)
- Console-ban `[NET] RESYNC` log latszik

**PASS kriterium**: Tab B allapota 100%-ban megegyezik Tab A-val 10 masodpercen belul.

**FAIL kriterium**: Tab B nem csatlakozik ujra, VAGY az egysegek rossz pozicioban vannak.

---

### HU-03: "Hard Refresh Restore"

**Teszt celja**: Bongeszo ujratoltese utani folytathatosag.

**Lepesek**:
1. Hajtsd vegre HU-01 1-6. lepeseit
2. Tab A: Adj ki MOVE parancsot
3. Tab B: Nyomj Ctrl+Shift+R (hard refresh)
4. Tab B: Varj az oldal betoltesere
5. Tab B: Kattints "Rejoin Last Session" gombra (ha van), VAGY Join Game → valaszd ki Tab A-t
6. Ellenorizd az allapotot

**Elvart eredmeny**:
- Tab B visszaker a sessionbe
- Slot megtartva (Player 2)
- Jatekallas szinkronban Tab A-val

**PASS kriterium**: Sikeres ujracsatlakozas 15 masodpercen belul, helyes slot es allapot.

**FAIL kriterium**: Session elveszett, vagy rossz slot/allapot.

---

## 7. Critical Callouts

### 7.1 Tick Alignment Rules

| Rule ID | Description | Enforcement |
|---------|-------------|-------------|
| **TICK-01** | `simTick` is the ONLY time reference for game logic | Grep audit: no `Date.now()` in SimCore |
| **TICK-02** | Guest receives `simTick` from Host, does not increment locally | M11 implementation |
| **TICK-03** | Commands are tagged with tick at time of Host receipt | M09 implementation |
| **TICK-04** | SNAPSHOT includes `simTick` for ordering | M10 schema |
| **TICK-05** | Wall-clock timestamps in messages are for debugging only | All message schemas |

### 7.2 Message Ordering/Duplication Rules

| Rule ID | Description | Enforcement |
|---------|-------------|-------------|
| **ORD-01** | Every INPUT_CMD has monotonic `seq` per sender | M08: `seqCounter++` |
| **ORD-02** | Host tracks `lastSeenSeq[slot]` for dedup | M09: `if (msg.seq <= lastSeenSeq) discard` |
| **ORD-03** | CMD_BATCH array order is canonical | M09: preserve arrival order |
| **ORD-04** | Late commands (after tick) queued for next tick | M09: buffer design |
| **ORD-05** | Very old commands (> 10 ticks) discarded | M09: staleness check |

### 7.3 Resync Thresholds

| Threshold | Value | Action |
|-----------|-------|--------|
| Command Replay Max Gap | 50 ticks | Use snapshot pull if gap > 50 |
| Snapshot Timeout | 5 seconds | Trigger RESYNC_REQ |
| Tick Jump Threshold | 20 ticks | Trigger RESYNC_REQ |
| Reconnect Window | 60 seconds | Slot preserved; after 60s = new join |
| Command Log TTL | 10 minutes | Prune older entries |

### 7.4 Security Gates Checklist

| Gate ID | Description | Verification |
|---------|-------------|--------------|
| **SEC-01** | `SUPABASE_ANON_KEY` only in bundle | CI grep for `sbp_` patterns |
| **SEC-02** | Runtime JWT role check = `anon` | M03: assertion on connect |
| **SEC-03** | RLS on sessions table | SQL test: anon cannot see other hosts' private sessions |
| **SEC-04** | RLS on command_log | SQL test: anon cannot INSERT to other sessions |
| **SEC-05** | Host validates `senderId` matches slot | M09: `if (senderSlotMismatch) discard` |
| **SEC-06** | Rate limiting on INPUT_CMD | N03: 100 cmd/s cap per sender |

---

## Appendix: File Change Summary

### New Files (MVP)

| Path | Step | Purpose |
|------|------|---------|
| `src/SimCore/multiplayer/MessageTypes.js` | M01 | Message constants |
| `src/SimCore/multiplayer/MessageSerializer.js` | M01 | Encode/decode |
| `src/SimCore/multiplayer/NetworkRole.js` | M02 | Role enum |
| `src/SimCore/multiplayer/SessionState.js` | M02 | State container |
| `src/SimCore/multiplayer/SessionManager.js` | M03+ | Central coordinator |
| `src/UI/LobbyPanel.js` | M14 | Lobby UI |
| `src/SimCore/__tests__/messageSerializer.test.js` | M01 | Unit tests |
| `src/SimCore/__tests__/sessionState.test.js` | M02 | Unit tests |
| `src/SimCore/__tests__/sessionManager.*.test.js` | M03+ | Unit tests |
| `tests/e2e/multiplayer-handshake.spec.js` | M14 | E2E tests |

### Modified Files (MVP)

| Path | Step | Changes |
|------|------|---------|
| `src/Core/Game.js` | M03, M07, M11 | Add sessionManager, applySnapshot, isGuest flag |
| `src/SimCore/transport/SupabaseTransport.js` | M04 | Add joinChannel, broadcastToChannel |
| `src/SimCore/commands/CommandQueue.js` | M08 | Add network routing for Guest |
| `src/SimCore/SimLoop.js` | M09, M10, M11 | Call flushBatch, maybeSendSnapshot, skip step for Guest |
| `src/UI/HUD.js` | M14 | Add network status display |
| `game.html` | M14 | Add lobby UI elements |

---

*Document Version: 0.13.0*
*Last Updated: 2026-02-01*
*Author: Claude Code (Docs Worker #2)*
