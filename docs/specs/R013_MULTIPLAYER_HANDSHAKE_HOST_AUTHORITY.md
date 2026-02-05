# R013: Multiplayer Handshake & Host Authority

**Status**: Specification (Pending Implementation)
**Depends On**: R012 (Supabase Integration)
**Objective**: Define the authority model, handshake protocol, and synchronization mechanisms for multi-client gameplay.

---

## Table of Contents

1. [Objective & Non-Goals](#1-objective--non-goals)
2. [Authority Model Selection](#2-authority-model-selection)
3. [Handshake Protocol](#3-handshake-protocol)
4. [Message Schemas](#4-message-schemas)
5. [Ordering Rules](#5-ordering-rules)
6. [Reconnect & Resync Strategy](#6-reconnect--resync-strategy)
7. [Persistence vs Realtime Separation](#7-persistence-vs-realtime-separation)
8. [Security Gates](#8-security-gates)
9. [Performance Gates](#9-performance-gates)
10. [Determinism Invariants](#10-determinism-invariants)
11. [Test Plan](#11-test-plan)
12. [Definition of Done](#12-definition-of-done)
13. [Risk Register](#13-risk-register)

---

## 1. Objective & Non-Goals

### 1.1 Objective

Implement a host-authoritative multiplayer system where:

- One client acts as the **Host** (runs authoritative simulation)
- Other clients act as **Guests** (send inputs, receive state updates)
- All game state mutations flow through the Host's `SimCore.step()`
- Determinism is preserved: identical inputs produce identical outputs

### 1.2 Scope Boundary: R012 vs R013

| Concern | R012 (Supabase Setup) | R013 (Handshake/Authority) |
|---------|----------------------|---------------------------|
| Transport Layer | SupabaseTransport (ITransport) | Uses existing transport |
| Auth | Anonymous sign-in | Uses existing auth |
| Persistence | Single-user save/load | Host-owned world state |
| Realtime | Echo test (own data) | Multi-client broadcast |
| Authority | Client = Host (solo) | Host vs Guest roles |
| Lobbies | N/A | Host discovery + join |
| Command Routing | Local queue only | Client → Host → Broadcast |

### 1.3 Non-Goals (Explicitly Deferred)

- **Dedicated Server**: R013 uses browser-hosted authority (no backend tick loop)
- **Server-Side Anti-Cheat**: Deferred to R014+
- **Spectator Mode**: Deferred to R015+
- **Matchmaking Service**: Deferred (manual lobby join)
- **NAT Traversal / P2P**: Uses Supabase Realtime (WebSocket relay)
- **Large-Scale (10+ players)**: R013 targets 2-4 players max

---

## 2. Authority Model Selection

### 2.1 Options Considered

| Model | Description | Pros | Cons |
|-------|-------------|------|------|
| **Lockstep** | All clients simulate; exchange only inputs; wait for all inputs before advancing | Perfect sync, minimal bandwidth | High latency sensitivity; one slow client stalls all |
| **Host-Authoritative** | Host runs simulation; sends state to clients; clients are "dumb terminals" | Simple, latency-tolerant | Host CPU load; trust in host |
| **Hybrid (Predicted)** | Client predicts locally; server corrects | Responsive feel | Complex rollback/reconciliation |

### 2.2 Recommended Model: Host-Authoritative (No Prediction)

**Rationale**:

1. **Simplicity**: Asterobia is turn-strategic, not twitch-reflex. Input latency < 200ms is acceptable.
2. **Determinism by Default**: Host is single source of truth. No reconciliation logic needed.
3. **R012 Continuity**: R012 already treats the single client as Host. R013 extends this naturally.
4. **CPU Budget**: Host bears full sim cost, but at 20Hz fixed tick, this is trivial.
5. **Trust Model**: For friends/LAN play, Host trust is acceptable. Anti-cheat is future scope.

**Tradeoff Acknowledged**: Guests see ~1-2 tick latency (50-100ms). This is acceptable for strategy gameplay.

### 2.3 Authority Rules

| Rule | Description |
|------|-------------|
| **RULE-AUTH-01** | Only Host executes `SimCore.step()` |
| **RULE-AUTH-02** | Guests send `INPUT_CMD` messages; they do NOT mutate local state |
| **RULE-AUTH-03** | Host broadcasts `CMD_BATCH` (confirmed inputs) + `SNAPSHOT` (state) |
| **RULE-AUTH-04** | Guest rendering interpolates between received snapshots |
| **RULE-AUTH-05** | If Host disconnects, session ends (no host migration in R013) |

---

## 3. Handshake Protocol

### 3.1 Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        HANDSHAKE FLOW                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [Host Client]                         [Guest Client]           │
│       │                                      │                  │
│       │ 1. HOST_ANNOUNCE ───────────────────>│ (Realtime)       │
│       │    {hostId, mapSeed, simTick}        │                  │
│       │                                      │                  │
│       │<─────────────────── 2. JOIN_REQ ─────│                  │
│       │    {guestId, protocolVersion}        │                  │
│       │                                      │                  │
│       │ 3. JOIN_ACK ────────────────────────>│                  │
│       │    {accepted, assignedSlot,          │                  │
│       │     fullSnapshot, simTick}           │                  │
│       │                                      │                  │
│       │         [SESSION ACTIVE]             │                  │
│       │                                      │                  │
│       │<─────────────────── INPUT_CMD ───────│ (continuous)     │
│       │                                      │                  │
│       │ CMD_BATCH + SNAPSHOT ───────────────>│ (each tick)      │
│       │                                      │                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Host Discovery

1. **Host creates session**: User clicks "Host Game" in UI
2. **Host broadcasts `HOST_ANNOUNCE`** via Supabase Realtime channel `asterobia:lobby`
3. **Announce includes**: `hostId`, `mapSeed`, `simTick`, `maxPlayers`, `sessionName`
4. **Announce is periodic**: Every 5 seconds while hosting (heartbeat)
5. **Guests list visible hosts**: Filter by `maxPlayers > currentPlayers`

### 3.3 Join Request/Accept

1. **Guest sends `JOIN_REQ`** to Host's session channel `asterobia:session:{hostId}`
2. **Host validates**:
   - Protocol version match
   - Slot available
   - Not banned (future)
3. **Host responds with `JOIN_ACK`**:
   - `accepted: true/false`
   - `assignedSlot` (player index 0-3)
   - `fullSnapshot` (current world state)
   - `simTick` (Host's current tick for sync)
4. **Guest applies snapshot**: Overwrites local state, sets `simTick`

### 3.4 Seed Negotiation

- **R013 Approach**: Host owns the seed. No negotiation.
- `mapSeed` is included in `HOST_ANNOUNCE` and `JOIN_ACK.fullSnapshot.meta`
- Guest initializes `SeededRNG(mapSeed)` but does NOT advance it (Host-only)

### 3.5 Tick Alignment

- Guest receives `simTick` in `JOIN_ACK`
- Guest sets local `simTick = received.simTick`
- Guest does NOT run `SimCore.step()` autonomously
- Guest's "tick" is purely for interpolation reference

---

## 4. Message Schemas

All messages are JSON objects transmitted via Supabase Realtime broadcast.

### 4.1 HELLO (Ping/Discovery)

```json
{
  "type": "HELLO",
  "clientId": "uuid-string",
  "protocolVersion": "0.13.0",
  "timestamp": 1706700000000
}
```

### 4.2 HOST_ANNOUNCE

```json
{
  "type": "HOST_ANNOUNCE",
  "hostId": "uuid-string",
  "sessionName": "Adam's Game",
  "mapSeed": "asterobia-seed-12345",
  "simTick": 1042,
  "currentPlayers": 1,
  "maxPlayers": 4,
  "protocolVersion": "0.13.0",
  "timestamp": 1706700000000
}
```

### 4.3 JOIN_REQ

```json
{
  "type": "JOIN_REQ",
  "guestId": "uuid-string",
  "displayName": "Player2",
  "protocolVersion": "0.13.0",
  "timestamp": 1706700001000
}
```

### 4.4 JOIN_ACK

```json
{
  "type": "JOIN_ACK",
  "accepted": true,
  "rejectReason": null,
  "assignedSlot": 1,
  "simTick": 1042,
  "fullSnapshot": {
    "meta": {
      "mapSeed": "asterobia-seed-12345",
      "simTick": 1042,
      "nextEntityId": 500
    },
    "units": [ /* ... StateSurface format ... */ ],
    "terrain": { /* ... */ },
    "resources": [ /* ... */ ]
  },
  "timestamp": 1706700001500
}
```

**Rejection example**:
```json
{
  "type": "JOIN_ACK",
  "accepted": false,
  "rejectReason": "SESSION_FULL",
  "assignedSlot": null,
  "simTick": null,
  "fullSnapshot": null,
  "timestamp": 1706700001500
}
```

### 4.5 INPUT_CMD

```json
{
  "type": "INPUT_CMD",
  "senderId": "uuid-string",
  "slot": 1,
  "seq": 47,
  "command": {
    "action": "MOVE",
    "entityId": 42,
    "target": { "x": 150.5, "y": 200.3 }
  },
  "timestamp": 1706700010000
}
```

### 4.6 CMD_BATCH

Host broadcasts confirmed commands for a tick:

```json
{
  "type": "CMD_BATCH",
  "batchSeq": 105,          // Monotonic batch sequence (Gap Detection)
  "simTick": 1043,          // Created at tick
  "scheduledTick": 1045,    // Execute at tick (Fixed Buffer)
  "commands": [
    {
      "slot": 0,
      "seq": 102,
      "command": { "action": "MOVE", "entityId": 10, "target": { "x": 50, "y": 50 } }
    },
    {
      "slot": 1,
      "seq": 47,
      "command": { "action": "MOVE", "entityId": 42, "target": { "x": 150.5, "y": 200.3 } }
    }
  ],
  "stateHash": "0xFE32...", // Optional state checksum
  "timestamp": 1706700010050
}

```

### 4.7 SNAPSHOT

```json
{
  "type": "SNAPSHOT",
  "simTick": 1043,
  "stateHash": "sha256-abc123...",
  "state": {
    "meta": { "simTick": 1043, "nextEntityId": 502 },
    "units": [ /* StateSurface.serialize() output */ ],
    "terrain": { /* ... */ }
  },
  "timestamp": 1706700010100
}
```

**Note**: `stateHash` is for debugging/verification. Guests can optionally verify.

### 4.8 RESYNC_REQ / RESYNC_ACK

Guest requests full resync after detecting desync or reconnect:

```json
{
  "type": "RESYNC_REQ",
  "guestId": "uuid-string",
  "lastKnownTick": 1000,
  "reason": "RECONNECT",
  "timestamp": 1706700050000
}
```

Host responds:

```json
{
  "type": "RESYNC_ACK",
  "simTick": 1050,
  "fullSnapshot": { /* ... */ },
  "commandLog": [
    { "tick": 1001, "commands": [ /* ... */ ] },
    { "tick": 1002, "commands": [ /* ... */ ] }
    /* ... up to current tick or capped at 50 ticks */
  ],
  "timestamp": 1706700050500
}
```

### 4.9 PING / PONG

Latency measurement and keepalive:

```json
{
  "type": "PING",
  "senderId": "uuid-string",
  "seq": 1,
  "timestamp": 1706700060000
}
```

```json
{
  "type": "PONG",
  "responderId": "uuid-string",
  "pingSeq": 1,
  "originalTimestamp": 1706700060000,
  "timestamp": 1706700060050
}
```

---

## 5. Ordering Rules

### 5.1 Tick-Based Ordering

| Rule | Description |
|------|-------------|
| **ORD-01** | All game state changes are tagged with `simTick` |
| **ORD-02** | Host processes inputs in arrival order within each tick |
| **ORD-03** | Host's `CMD_BATCH` defines canonical input order for that tick |
| **ORD-04** | Guests apply `CMD_BATCH` commands in listed order (array index) |

### 5.2 Sequence Numbers

| Rule | Description |
|------|-------------|
| **SEQ-01** | Each client maintains a per-session `seq` counter starting at 0 |
| **SEQ-02** | Every `INPUT_CMD` increments sender's `seq` |
| **SEQ-03** | Host tracks `lastSeenSeq[slot]` per player |
| **SEQ-04** | Duplicate detection: `if (msg.seq <= lastSeenSeq[slot]) { discard }` |

### 5.3 Out-of-Order Handling

| Scenario | Handling |
|----------|----------|
| **Late command** (arrives after tick processed) | Host queues for next tick |
| **Duplicate command** (same seq) | Discard silently |
| **Future seq gap** (seq 50 arrives, expected 48) | Accept; log warning; assume 48-49 lost |
| **Very old command** (> 10 ticks stale) | Discard; log warning |

### 5.4 Message Deduplication

- All messages include `type`, `senderId`, `seq` (or `simTick` for Host messages)
- Receiver maintains sliding window of last 100 message hashes
- Duplicate hash → discard

---

## 6. Reconnect & Resync Strategy

### 6.1 Detection

Guest detects potential desync when:

1. **Timeout**: No `SNAPSHOT` received for 5+ seconds
2. **Tick gap**: Received `simTick` jumps by > 20 from last known
3. **Hash mismatch**: Local computed hash differs from `SNAPSHOT.stateHash`

### 6.2 Resync Modes

| Mode | When to Use | Bandwidth | Latency |
|------|-------------|-----------|---------|
| **Command Replay** | Gap < 50 ticks, Guest has base snapshot | Low | Medium |
| **Snapshot Pull** | Gap >= 50 ticks OR corrupted state | High | Low |

### 6.3 Minimum Viable Approach (R013)

1. Guest sends `RESYNC_REQ` with `lastKnownTick`
2. Host calculates gap: `currentTick - lastKnownTick`
3. If gap <= 50:
   - Host sends `RESYNC_ACK` with `commandLog` (ticks lastKnown+1 to current)
   - Guest fast-forwards by replaying commands
4. If gap > 50:
   - Host sends `RESYNC_ACK` with `fullSnapshot` only (no log)
   - Guest overwrites state entirely
5. Guest resumes normal operation

### 6.4 Host Disconnection

- R013: Session ends. Guests see "Host disconnected" and return to menu.
- Host migration is OUT OF SCOPE for R013.

### 6.5 Guest Disconnection

- Host removes Guest from `activePlayers` after 10s timeout
- Guest's units become AI-controlled OR pause (configurable)
- If Guest reconnects within 60s: resync and resume
- If Guest reconnects after 60s: treated as new join (may get different slot)

---

## 7. Persistence vs Realtime Separation

### 7.1 Channel Architecture

| Channel | Purpose | Data | Frequency |
|---------|---------|------|-----------|
| `asterobia:lobby` | Host discovery | `HOST_ANNOUNCE` | Every 5s per host |
| `asterobia:session:{hostId}` | Game session | All gameplay messages | 20Hz (tick rate) |

### 7.2 What Goes to Realtime Broadcast

| Message Type | Channel | Notes |
|--------------|---------|-------|
| `HOST_ANNOUNCE` | `lobby` | Periodic heartbeat |
| `JOIN_REQ` | `session:{hostId}` | One-time |
| `JOIN_ACK` | `session:{hostId}` | One-time |
| `INPUT_CMD` | `session:{hostId}` | Per input event |
| `CMD_BATCH` | `session:{hostId}` | Every tick (20Hz) |
| `SNAPSHOT` | `session:{hostId}` | Every N ticks (configurable) |
| `PING/PONG` | `session:{hostId}` | Every 2s per client |

### 7.3 What Goes to Database Tables

| Data | Table | Frequency | Purpose |
|------|-------|-----------|---------|
| Session metadata | `sessions` | On create/update | Lobby listing, reconnect |
| World snapshots | `world_states` | Every 60s OR on save | Crash recovery, spectate join |
| Command log | `command_log` (optional) | Every tick | Replay, debug, resync |
| Player stats | `player_sessions` | On join/leave | Analytics |

### 7.4 R013 Database Scope

**Minimal required tables**:

1. `sessions` - Active game sessions
2. `world_states` - Periodic snapshots (reuse R012 table)

**Optional (recommended)**:

3. `command_log` - For resync; can be ephemeral (TTL 10 min)

See [R013_DB_SCHEMA_OPTIONAL.md](./R013_DB_SCHEMA_OPTIONAL.md) for SQL.

---

## 8. Security Gates

### 8.1 RLS Policy Requirements

| Table | Policy | Rule |
|-------|--------|------|
| `sessions` | SELECT | `auth.uid() = host_id OR public = true` |
| `sessions` | INSERT | `auth.uid() = host_id` |
| `sessions` | UPDATE | `auth.uid() = host_id` |
| `sessions` | DELETE | `auth.uid() = host_id` |
| `world_states` | SELECT | `auth.uid() = owner_id` |
| `world_states` | INSERT/UPDATE | `auth.uid() = owner_id` |
| `command_log` | SELECT | `session_id IN (SELECT id FROM sessions WHERE host_id = auth.uid() OR ...)` |

### 8.2 Key Hygiene Checklist

- [ ] **GATE-SEC-01**: `SUPABASE_ANON_KEY` only in client bundle
- [ ] **GATE-SEC-02**: `SUPABASE_SERVICE_ROLE_KEY` NEVER in client bundle
- [ ] **GATE-SEC-03**: CI grep check for `sbp_` patterns in source
- [ ] **GATE-SEC-04**: Runtime JWT decode assertion: `role === 'anon'`

### 8.3 Anti-Griefing Notes (R013 Scope)

| Threat | Mitigation | Implementation |
|--------|------------|----------------|
| Spam `JOIN_REQ` | Rate limit: 1 req/5s per client | Client-side + Host ignore |
| Spam `INPUT_CMD` | Rate limit: 100 cmd/s per client | Host drops excess |
| Malformed commands | Schema validation | Host discards invalid JSON |
| Impersonation (slot) | Verify `senderId` matches `slot` ownership | Host validates |
| Host cheating | None (trusted host model) | Deferred to R014 |

### 8.4 Realtime Channel Security

- Supabase Realtime channels are authenticated via JWT
- `anon` users can join public channels
- RLS on underlying tables still applies to DB operations
- Broadcast messages are NOT filtered by RLS (anyone in channel sees all)
- **Implication**: Don't broadcast sensitive data; Guests should not see other players' fog-of-war

---

## 9. Performance Gates

### 9.1 Outbound Throttle Caps

| Message Type | Max Frequency | Notes |
|--------------|---------------|-------|
| `HOST_ANNOUNCE` | 0.2 Hz (1 per 5s) | Lobby heartbeat |
| `INPUT_CMD` | 20 Hz per client | Matches tick rate |
| `CMD_BATCH` | 20 Hz | Every tick |
| `SNAPSHOT` | 2 Hz (configurable) | Every 10 ticks default |
| `PING` | 0.5 Hz (1 per 2s) | Keepalive |

### 9.2 Payload Size Budgets

| Message Type | Max Size | Enforcement |
|--------------|----------|-------------|
| `INPUT_CMD` | 1 KB | Validation; reject if over |
| `CMD_BATCH` | 10 KB | If over, split across messages |
| `SNAPSHOT` | 50 KB | Compression (gzip) if over 20 KB |
| `JOIN_ACK` | 100 KB | One-time; includes full state |

### 9.3 Snapshot Frequency Tuning

| Player Count | Snapshot Interval | Rationale |
|--------------|-------------------|-----------|
| 1-2 | Every 10 ticks (0.5s) | Low bandwidth |
| 3-4 | Every 20 ticks (1s) | Reduce load |

### 9.4 Backpressure Behavior

| Condition | Action |
|-----------|--------|
| Outbound queue > 50 messages | Drop oldest non-critical (PING) |
| Inbound processing > 100ms | Log warning; skip render frame |
| Snapshot serialization > 50ms | Reduce snapshot frequency |
| WebSocket buffer full | Supabase handles; reconnect on disconnect |

---

## 10. Determinism Invariants

### 10.1 Core Rules

| Invariant | Description |
|-----------|-------------|
| **DET-01** | `SimCore.step()` is the ONLY function that mutates authoritative state |
| **DET-02** | `simTick` is the sole time reference for game logic; wall-clock is forbidden |
| **DET-03** | All random values come from `SeededRNG` seeded by Host |
| **DET-04** | Entity IDs are assigned by `IdGenerator` (deterministic counter) |
| **DET-05** | Pathfinding is synchronous within `SimCore.step()` |

### 10.2 No-Bypass Rules

| Rule | Description |
|------|-------------|
| **BYPASS-01** | Guest MUST NOT call `SimCore.step()` locally |
| **BYPASS-02** | Guest MUST NOT mutate `units`, `terrain`, or `resources` directly |
| **BYPASS-03** | Guest MUST NOT use `Date.now()` or `performance.now()` for game logic |
| **BYPASS-04** | Guest MUST NOT use `Math.random()` for anything affecting state |
| **BYPASS-05** | `Transport.send()` is the ONLY exit path for Guest inputs |

### 10.3 Verification

- **Hash check**: Host includes `stateHash` in `SNAPSHOT`
- **Debug mode**: Guests can compute local hash and compare
- **Desync detection**: Hash mismatch triggers `RESYNC_REQ`

---

## 11. Test Plan

### 11.1 Unit Tests (Mock Transport)

| Test ID | Description | Assertions |
|---------|-------------|------------|
| `UT-01` | `MessageSerializer.encode/decode` round-trip | All message types |
| `UT-02` | `SessionManager.handleJoinReq` validation | Accept/reject logic |
| `UT-03` | `InputBuffer.deduplicate` | Drops duplicate seq |
| `UT-04` | `SnapshotManager.compress` | Output < input size |
| `UT-05` | `ResyncManager.calculateGap` | Correct tick delta |
| `UT-06` | `RateLimiter.check` | Blocks after threshold |

### 11.2 Integration Tests (Two Clients)

| Test ID | Description | Setup | Expected |
|---------|-------------|-------|----------|
| `IT-01` | Host announces, Guest discovers | 2 browser tabs | Guest sees Host in list |
| `IT-02` | Guest joins, receives snapshot | Join flow | Guest state matches Host |
| `IT-03` | Guest sends input, Host processes | Move command | Unit moves on both |
| `IT-04` | Host broadcasts batch | Multiple inputs | All clients see same order |
| `IT-05` | Latency measurement | PING/PONG | RTT displayed in HUD |
| `IT-06` | Guest disconnects/reconnects | Network toggle | Resync successful |

### 11.3 HU (Human User) Test Scripts

#### HU-01: "A moves, B sees"

**Teszt celja**: Alapveto multiplayer szinkronizacio ellenorzese.

**Lepesek**:
1. Nyiss ket bongeszo tabot (Tab A, Tab B)
2. Tab A: Kattints "Host Game" → Varj "Hosting..." allapotra
3. Tab B: Kattints "Join Game" → Valaszd ki Tab A hostjat → Kattints "Join"
4. Tab B: Varj a "Connected" allapotra
5. Tab A: Valassz ki egy egyseg-et es adj ki MOVE parancsot
6. Tab B: Figyeld, hogy az egyseg elmozdul-e

**Elvart eredmeny**:
- Tab B-n az egyseg ugyanarra a poziciora mozog, mint Tab A-n
- Nincs lathato desync (pozicio elter max 1 pixel)

**PASS/FAIL kriterium**: Tab B megjeleníti a mozgást 500ms-on belül.

---

#### HU-02: "Disconnect/Reconnect"

**Teszt celja**: Ujracsatlakozas utan a jatekallas helyreall.

**Lepesek**:
1. Inditsd el a HU-01 tesztet (A host, B csatlakozik)
2. Tab A: Adj ki 3 MOVE parancsot
3. Tab B: Nyomd meg F12 → Network → Offline mode (vagy zard be a lapot)
4. Tab A: Adj ki meg 2 MOVE parancsot
5. Tab B: Kapcsold vissza Online-ra (vagy nyisd ujra a lapot es csatlakozz)
6. Varj 5 masodpercet

**Elvart eredmeny**:
- Tab B visszaszinkronizal
- Tab B-n az osszes egyseg a helyes pozicioban van
- Console-ban "RESYNC" uzenet latszik

**PASS/FAIL kriterium**: Tab B allapota megegyezik Tab A-val a resync utan.

---

#### HU-03: "Hard Refresh Restore"

**Teszt celja**: Bongeszo ujratoltese utan a session folytatodik.

**Lepesek**:
1. Inditsd el a HU-01 tesztet
2. Tab A: Adj ki MOVE parancsot
3. Tab B: Nyomj F5-ot (hard refresh)
4. Tab B: Automatikusan ujracsatlakozik VAGY kattints "Rejoin"
5. Ellenorizd az allapotot

**Elvart eredmeny**:
- Tab B visszaker a sessionbe
- Jatekallas megegyezik Tab A-val
- Slot megtartva (Player 2)

**PASS/FAIL kriterium**: Ujracsatlakozas sikeres 10 masodpercen belul.

---

### 11.4 Automated Browser Tests (Playwright)

```javascript
// tests/e2e/multiplayer-handshake.spec.js
test('Guest joins Host and sees unit movement', async ({ browser }) => {
  const hostPage = await browser.newPage();
  const guestPage = await browser.newPage();

  await hostPage.goto('/?mode=host');
  await hostPage.click('[data-testid="host-game-btn"]');
  await expect(hostPage.locator('[data-testid="hosting-status"]')).toHaveText('Hosting...');

  await guestPage.goto('/?mode=join');
  await guestPage.click('[data-testid="join-game-btn"]');
  await expect(guestPage.locator('[data-testid="connection-status"]')).toHaveText('Connected');

  // Host moves unit
  await hostPage.click('[data-testid="unit-0"]');
  await hostPage.click('[data-testid="map-position-100-100"]');

  // Verify Guest sees movement
  await expect(guestPage.locator('[data-testid="unit-0"]')).toHaveAttribute(
    'data-position',
    '100,100',
    { timeout: 2000 }
  );
});
```

---

## 12. Definition of Done

### 12.1 Functional Requirements

- [ ] **DOD-01**: Host can create session and appear in lobby
- [ ] **DOD-02**: Guest can discover and join Host session
- [ ] **DOD-03**: Guest receives initial snapshot on join
- [ ] **DOD-04**: Guest inputs are routed to Host
- [ ] **DOD-05**: Host broadcasts `CMD_BATCH` every tick
- [ ] **DOD-06**: Host broadcasts `SNAPSHOT` periodically
- [ ] **DOD-07**: Guest renders state from snapshots (not local sim)
- [ ] **DOD-08**: Disconnect/reconnect triggers resync
- [ ] **DOD-09**: Session ends cleanly when Host leaves

### 12.2 Quality Gates

- [ ] **DOD-10**: All unit tests pass (`npm test`)
- [ ] **DOD-11**: Integration tests pass (2-client scenario)
- [ ] **DOD-12**: HU-01, HU-02, HU-03 PASS
- [ ] **DOD-13**: No `Math.random` or `Date.now` in SimCore paths (grep audit)
- [ ] **DOD-14**: Snapshot payload < 50 KB for 100-unit game
- [ ] **DOD-15**: RTT < 200ms on local network

### 12.3 Documentation

- [ ] **DOD-16**: `CURRENT_SYSTEM_SPEC.md` updated with R013 features
- [ ] **DOD-17**: HUD shows multiplayer status (Host/Guest/Disconnected)
- [ ] **DOD-18**: Console logs include `[NET]` prefix for network events

---

## 13. Risk Register

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|------------|--------|------------|
| **RISK-01** | Supabase Realtime latency > 200ms | Medium | Medium | Monitor RTT; fallback to snapshot-only if spiky |
| **RISK-02** | Snapshot size exceeds 50KB budget | Medium | High | Implement delta compression; reduce snapshot frequency |
| **RISK-03** | Guest desync due to floating-point drift | Low | High | Use `toFixed(6)` everywhere; hash verification |
| **RISK-04** | Host browser tab throttled (background) | High | High | Warn user; require foreground; consider Web Worker |
| **RISK-05** | Realtime channel message ordering not guaranteed | Medium | High | Use `seq` numbers; reorder buffer |
| **RISK-06** | Multiple Guests join simultaneously → race condition | Medium | Medium | Queue join requests; process sequentially |
| **RISK-07** | Host cheating (modified client) | High | Medium | Accept for R013 (friends mode); defer anti-cheat |
| **RISK-08** | Supabase free tier rate limits hit | Low | Medium | Implement client-side throttling; monitor usage |
| **RISK-09** | Guest reconnect gets different slot | Low | Low | Store slot in `localStorage`; validate on rejoin |
| **RISK-10** | Full resync takes > 5s on slow connection | Medium | Medium | Show loading indicator; timeout after 30s |

---

## Appendix A: State Diagram

```
                    ┌──────────────┐
                    │   OFFLINE    │
                    └──────┬───────┘
                           │ Click "Host" or "Join"
                           ▼
         ┌─────────────────┴─────────────────┐
         │                                   │
         ▼                                   ▼
┌────────────────┐                 ┌─────────────────┐
│    HOSTING     │                 │    JOINING      │
│  (announcing)  │                 │  (discovering)  │
└────────┬───────┘                 └────────┬────────┘
         │                                  │
         │ Guest connects                   │ Select host
         │                                  ▼
         │                         ┌─────────────────┐
         │                         │  CONNECTING     │
         │                         │  (JOIN_REQ)     │
         │                         └────────┬────────┘
         │                                  │
         │                                  │ JOIN_ACK received
         │                                  ▼
         │                         ┌─────────────────┐
         │◄────────────────────────│    SYNCING      │
         │  Session active         │  (apply snap)   │
         │                         └────────┬────────┘
         │                                  │
         ▼                                  ▼
┌────────────────────────────────────────────────────┐
│                     IN_GAME                        │
│  Host: step() + broadcast                          │
│  Guest: receive + render                           │
└────────────────────────┬───────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         │               │               │
         ▼               ▼               ▼
┌────────────┐   ┌──────────────┐   ┌─────────────┐
│ DISCONNECT │   │   RESYNC     │   │    LEAVE    │
│ (timeout)  │   │  (recover)   │   │  (manual)   │
└─────┬──────┘   └──────┬───────┘   └──────┬──────┘
      │                 │                  │
      │ reconnect       │ success          │
      ▼                 ▼                  ▼
┌─────────────┐   ┌──────────────┐   ┌─────────────┐
│  REJOINING  │──►│   IN_GAME    │   │   OFFLINE   │
└─────────────┘   └──────────────┘   └─────────────┘
```

---

## Appendix B: Quick Reference Card

### Message Type Summary

| Type | Direction | Frequency | Size |
|------|-----------|-----------|------|
| `HELLO` | Any → Any | On connect | ~100B |
| `HOST_ANNOUNCE` | Host → Lobby | 0.2Hz | ~200B |
| `JOIN_REQ` | Guest → Host | Once | ~150B |
| `JOIN_ACK` | Host → Guest | Once | ~50KB |
| `INPUT_CMD` | Guest → Host | Event-driven | ~200B |
| `CMD_BATCH` | Host → All | 20Hz | ~1KB |
| `SNAPSHOT` | Host → All | 2Hz | ~20KB |
| `RESYNC_REQ` | Guest → Host | On desync | ~100B |
| `RESYNC_ACK` | Host → Guest | On request | ~50KB |
| `PING` | Any → Any | 0.5Hz | ~50B |
| `PONG` | Any → Any | Response | ~60B |

### Channel Naming

- Lobby: `asterobia:lobby`
- Session: `asterobia:session:{hostId}`

### Key Config Values

| Parameter | Default | Range |
|-----------|---------|-------|
| `TICK_RATE_HZ` | 20 | 10-60 |
| `SNAPSHOT_INTERVAL_TICKS` | 10 | 5-30 |
| `ANNOUNCE_INTERVAL_MS` | 5000 | 3000-10000 |
| `PING_INTERVAL_MS` | 2000 | 1000-5000 |
| `DISCONNECT_TIMEOUT_MS` | 10000 | 5000-30000 |
| `RESYNC_TICK_THRESHOLD` | 50 | 20-100 |
| `MAX_PLAYERS` | 4 | 2-8 |

---

*Document Version: 0.13.0*
*Last Updated: 2026-01-31*
*Author: Claude Code (Docs Worker)*
