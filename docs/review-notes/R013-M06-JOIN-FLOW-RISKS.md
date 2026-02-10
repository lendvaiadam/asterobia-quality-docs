# R013-M06 Join Flow Risk Assessment

**Date**: 2026-02-05
**Reviewer**: Worker (RF)
**Scope**: M06 (Host: Session Channel + Join Handling)
**Type**: Pre-implementation risk review (doc-only)

---

## 1. M06 Scope Summary

**Goal**: Host creates session channel, handles JOIN_REQ, responds with JOIN_ACK.

**Key Operations**:
1. Host joins session channel `asterobia:session:{hostId}`
2. Host listens for JOIN_REQ messages
3. Host validates: protocol version, slot availability
4. Host assigns slot (0-3)
5. Host serializes full snapshot
6. Host sends JOIN_ACK with snapshot

**Files to Modify** (per tasklist):
- `src/SimCore/multiplayer/SessionManager.js`

---

## 2. Risk Matrix

| ID | Risk | Likelihood | Impact | Priority |
|----|------|------------|--------|----------|
| M06-R01 | Concurrent JOIN_REQ race | MEDIUM | HIGH | P1 |
| M06-R02 | Snapshot serialization failure | LOW | HIGH | P1 |
| M06-R03 | JOIN_ACK lost in transit | MEDIUM | MEDIUM | P2 |
| M06-R04 | Large snapshot exceeds payload limit | MEDIUM | HIGH | P1 |
| M06-R05 | Channel subscription timing | LOW | MEDIUM | P3 |
| M06-R06 | Slot assignment non-determinism | LOW | HIGH | P2 |
| M06-R07 | Bandwidth spike on mass join | LOW | LOW | P4 |

---

## 3. Risk Details

### M06-R01: Concurrent JOIN_REQ Race Condition

**Description**: Two guests send JOIN_REQ simultaneously. Without queue, both may be assigned same slot.

**Scenario**:
```
T0: Host has 1 player (slot 0)
T1: Guest A sends JOIN_REQ
T2: Guest B sends JOIN_REQ (before A processed)
T3: Host.findNextSlot() returns 1 for both
T4: Both assigned slot 1 → CONFLICT
```

**Impact**: Slot collision, undefined behavior, potential state corruption.

**Mitigation Options**:
1. **Sequential processing queue** (RECOMMENDED)
   - Buffer JOIN_REQ in array
   - Process one at a time via `setImmediate` or microtask
2. **Atomic slot assignment**
   - Lock `players` array during assignment
   - Check slot availability after assignment, rollback if conflict

**Recommended Implementation**:
```javascript
// SessionManager.js
constructor() {
  this.joinQueue = [];
  this.processingJoin = false;
}

onSessionMessage(msg) {
  if (msg.type === MSG.JOIN_REQ) {
    this.joinQueue.push(msg);
    this._processJoinQueue();
  }
}

async _processJoinQueue() {
  if (this.processingJoin || this.joinQueue.length === 0) return;
  this.processingJoin = true;

  const req = this.joinQueue.shift();
  await this.handleJoinReq(req);

  this.processingJoin = false;
  this._processJoinQueue(); // Process next
}
```

**Verification**: Unit test with 3 simultaneous JOIN_REQ → all get unique slots.

---

### M06-R02: Snapshot Serialization Failure

**Description**: `stateSurface.serialize()` throws error during JOIN_ACK construction.

**Causes**:
- Circular reference in state
- Entity with undefined/NaN values
- Out-of-memory on large state

**Impact**: Guest receives rejection or no response; join fails silently.

**Mitigation**:
```javascript
handleJoinReq(msg) {
  // ... validation ...

  let snapshot;
  try {
    snapshot = this.game.stateSurface.serialize();
  } catch (err) {
    console.error('[SessionManager] Snapshot serialization failed:', err);
    return this.sendJoinAck(msg.guestId, false, 'SNAPSHOT_ERROR');
  }

  this.sendJoinAck(msg.guestId, true, null, slot, snapshot);
}
```

**Verification**: Unit test with mock `stateSurface.serialize()` that throws.

---

### M06-R03: JOIN_ACK Lost in Transit

**Description**: Host sends JOIN_ACK but Guest never receives it (network drop, channel issue).

**Impact**: Guest waits indefinitely (or until M07 timeout).

**Mitigation** (M07 scope, but M06 should support):
- M07 implements 10s timeout on JOIN_ACK wait
- M06 should log JOIN_ACK sent for debugging
- Future: Retry mechanism (Guest re-sends JOIN_REQ after timeout)

**Note**: Supabase Realtime does not guarantee delivery. Fire-and-forget.

**Recommended**: M06 adds `console.log('[SessionManager] JOIN_ACK sent to ${guestId}')` for traceability.

---

### M06-R04: Large Snapshot Exceeds Payload Limit

**Description**: Full snapshot in JOIN_ACK exceeds Supabase broadcast limit or causes timeout.

**Reference**: Spec states JOIN_ACK max 100KB, SNAPSHOT max 50KB.

**Causes**:
- Large unit count (100+ units with full state)
- Verbose entity data (long displayNames, etc.)
- Uncompressed terrain data

**Impact**: JOIN_ACK fails to deliver; Guest can't join.

**Mitigation**:
1. **Pre-flight size check**:
```javascript
const snapshot = this.game.stateSurface.serialize();
const size = JSON.stringify(snapshot).length;
if (size > 80000) { // 80KB warning threshold
  console.warn(`[SessionManager] JOIN_ACK snapshot large: ${size} bytes`);
}
if (size > 100000) { // 100KB hard limit
  return this.sendJoinAck(msg.guestId, false, 'STATE_TOO_LARGE');
}
```

2. **Compression** (N04 scope): gzip if > 20KB

**Verification**: Integration test with 100-unit game state.

---

### M06-R05: Channel Subscription Timing

**Description**: Guest sends JOIN_REQ before Host has fully subscribed to session channel.

**Scenario**:
```
T0: Host calls joinChannel()
T1: Guest sees HOST_ANNOUNCE (from lobby)
T2: Guest sends JOIN_REQ to session channel
T3: Host channel subscription completes
T4: JOIN_REQ was sent before subscription → LOST
```

**Impact**: Guest's JOIN_REQ never reaches Host; join fails.

**Mitigation**:
- M04 already ensures Host joins session channel before starting announce
- M06 should verify channel subscription is complete before processing
- Consider: Host sends `HOST_READY` on session channel after subscription

**Current M04 Flow** (already safe):
```javascript
async hostGame(sessionName) {
  // ...
  await this.transport.joinChannel(LOBBY_CHANNEL, ...); // Wait for subscription
  await this.transport.joinChannel(`asterobia:session:${hostId}`, ...); // Wait
  // THEN start announcing
  this.sendAnnounce();
}
```

**Verification**: Timing test - Guest joins immediately after seeing HOST_ANNOUNCE.

---

### M06-R06: Slot Assignment Non-Determinism

**Description**: Slot assignment order varies based on message arrival timing.

**Impact**: LOW for gameplay (slots are interchangeable), but confusing for debugging.

**Consideration**: Slot 0 is always Host. Slots 1-3 are first-come-first-served.

**Current `findNextSlot()` Implementation** (SessionState.js:185-193):
```javascript
findNextSlot() {
  const usedSlots = new Set(this.players.map(p => p.slot));
  for (let slot = 0; slot < this.maxPlayers; slot++) {
    if (!usedSlots.has(slot)) {
      return slot;
    }
  }
  return null;
}
```

**Assessment**: Deterministic (always returns lowest available slot). No change needed.

---

### M06-R07: Bandwidth Spike on Mass Join

**Description**: All 3 guests join within 1 second; Host sends 3 full snapshots simultaneously.

**Impact**: ~150-300KB burst; possible throttling or delay.

**Assessment**: LOW priority for R013 (max 4 players).

**Future Mitigation** (R014+): Stagger JOIN_ACK responses by 100ms.

---

## 4. Security Considerations

### M06-S01: Sender Validation

**Risk**: Malicious client sends JOIN_REQ with spoofed `guestId`.

**Current Protection**: None explicit in M06 spec.

**Mitigation**:
```javascript
handleJoinReq(msg) {
  // Validate guestId is UUID format
  if (!isValidUUID(msg.guestId)) {
    console.warn('[SessionManager] Invalid guestId format:', msg.guestId);
    return; // Silently drop
  }
  // ... proceed
}
```

### M06-S02: Replay Attack

**Risk**: Attacker re-sends captured JOIN_REQ to flood Host.

**Mitigation**:
- Track `lastJoinTime[guestId]`
- Reject if < 5s since last JOIN_REQ from same guestId

---

## 5. Dependencies and Blockers

| Dependency | Status | Notes |
|------------|--------|-------|
| M04 (Host Announce) | COMPLETE | Session channel join is there |
| M05 (Guest Discovery) | IN FLIGHT | Not blocking M06 |
| `stateSurface.serialize()` | EXISTS | From R011 |
| `findNextSlot()` | EXISTS | In SessionState.js |

**No blockers identified for M06 implementation.**

---

## 6. Test Coverage Recommendations

| Test ID | Description | Priority |
|---------|-------------|----------|
| M06-T01 | Single guest join - happy path | P0 |
| M06-T02 | Concurrent 3-guest join - no slot collision | P0 |
| M06-T03 | Protocol version mismatch rejection | P1 |
| M06-T04 | Session full rejection (4 players) | P1 |
| M06-T05 | Snapshot serialization error handling | P1 |
| M06-T06 | Large snapshot warning (>80KB) | P2 |
| M06-T07 | Invalid guestId format rejection | P2 |

---

## 7. Summary

| Category | Count | Critical |
|----------|-------|----------|
| High-Impact Risks | 3 | M06-R01, M06-R02, M06-R04 |
| Medium-Impact Risks | 2 | M06-R03, M06-R06 |
| Low-Impact Risks | 2 | M06-R05, M06-R07 |
| Security Items | 2 | M06-S01, M06-S02 |

**Recommendation**: M06 implementation should prioritize:
1. **JOIN_REQ queue** for sequential processing (M06-R01)
2. **Try-catch on serialization** with graceful rejection (M06-R02)
3. **Size check before JOIN_ACK send** (M06-R04)

All three can be addressed with ~20 lines of defensive code.

---

*Generated by Worker (RF) — R013-M06 Pre-Implementation Risk Review*
