# R013-M06 Implementation Map

**Date**: 2026-02-05
**Author**: Worker (BE)
**Scope**: M06 (Host: Session Channel + Join Handling)
**Type**: Pre-implementation codebase analysis

---

## 1. Current State Analysis

### 1.1 SessionManager.js (783 lines)

**Existing Infrastructure Ready for M06**:
- `onMessage()` router at line 479 — already routes MSG.JOIN_REQ to `_handleJoinReq()` stub
- `_handleJoinReq()` stub at line 593 — currently just logs, needs implementation
- `hostGame()` at line 188 — joins LOBBY_CHANNEL but NOT session channel yet
- `leaveGame()` at line 435 — cleanup logic exists, needs session channel cleanup

**M06 Required Additions**:
1. Session channel join in `hostGame()` after lobby join
2. Full `_handleJoinReq()` implementation with validation
3. New `sendJoinAck()` method
4. New `_sendSnapshot()` helper
5. Join queue for concurrent JOIN_REQ handling (per R013-M06-JOIN-FLOW-RISKS.md)

### 1.2 SessionState.js (307 lines)

**Existing Infrastructure Ready for M06**:
- `findNextSlot()` at line 185 — returns lowest available slot 0-3, or null if full
- `isFull()` at line 199 — checks if players.length >= maxPlayers (4)
- `addPlayer()` at line 126 — adds PlayerInfo to players array
- `getPlayerByUserId()` at line 217 — for duplicate JOIN_REQ detection

**No M06 changes needed to SessionState.js** — existing API is sufficient.

### 1.3 MessageTypes.js

**Existing MSG constants**:
- `MSG.JOIN_REQ` — defined
- `MSG.JOIN_ACK` — defined
- `MSG.SNAPSHOT` — defined

**Existing PROTOCOL_VERSION**: '0.13.0' — used for validation

### 1.4 MessageSerializer.js

**Factory functions needed for M06**:
- `createJoinAck()` — EXISTS (needs verification)
- `createSnapshot()` — EXISTS (needs verification)

---

## 2. Implementation Touchpoints

### 2.1 Files to MODIFY

| File | Lines Affected | Changes |
|------|----------------|---------|
| `SessionManager.js` | ~100 lines added | Session channel, join handling, snapshot send |
| `package.json` | 2 lines | Task 0: vitest devDep + test script |

### 2.2 Files to CREATE

| File | Purpose |
|------|---------|
| `src/SimCore/__tests__/sessionManager.join.test.js` | M06 unit tests |

### 2.3 Files UNCHANGED

- `SessionState.js` — existing API sufficient
- `NetworkRole.js` — no changes
- `MessageTypes.js` — no changes
- `SupabaseTransport.js` — existing channel methods sufficient

---

## 3. Method Implementation Plan

### 3.1 hostGame() Modifications (Line ~210)

**Current**: Joins LOBBY_CHANNEL only
**M06 Change**: Also join session channel `asterobia:session:{hostId}`

```javascript
// After LOBBY_CHANNEL join, before sendAnnounce():
const sessionChannel = `asterobia:session:${clientId}`;
await this.transport.joinChannel(sessionChannel, (msg) => this._onSessionMessage(msg));
this._sessionChannel = sessionChannel;
```

### 3.2 _handleJoinReq() Implementation (Line 593)

**Current**: Stub with console.log
**M06 Implementation**:

```javascript
_handleJoinReq(msg) {
  // Only Host processes JOIN_REQ
  if (!this.state.isHost()) return;

  // 1. Protocol version check
  if (msg.protocolVersion !== PROTOCOL_VERSION) {
    return this.sendJoinAck(msg.guestId, false, null, 'VERSION_MISMATCH');
  }

  // 2. Required fields validation
  if (!msg.guestId || !msg.guestName) return;

  // 3. Duplicate check (idempotency)
  if (this.state.getPlayerByUserId(msg.guestId)) return;

  // 4. Session full check
  const slot = this.state.findNextSlot();
  if (slot === null) {
    return this.sendJoinAck(msg.guestId, false, null, 'SESSION_FULL');
  }

  // 5. Add player
  this.state.addPlayer({
    slot,
    userId: msg.guestId,
    displayName: msg.guestName,
    status: PlayerStatus.ACTIVE
  });

  // 6. Send JOIN_ACK + SNAPSHOT
  this.sendJoinAck(msg.guestId, true, slot);
  this._sendSnapshot(msg.guestId);
}
```

### 3.3 sendJoinAck() New Method

```javascript
async sendJoinAck(guestId, accepted, slot = null, reason = null) {
  const msg = createJoinAck({
    accepted,
    slot,
    hostId: this.state.hostId,
    reason
  });

  await this.transport.broadcastToChannel(this._sessionChannel, msg);
  console.log(`[SessionManager] JOIN_ACK sent to ${guestId}: ${accepted ? 'ACCEPTED' : 'REJECTED'}`);
}
```

### 3.4 _sendSnapshot() New Method

```javascript
async _sendSnapshot(guestId) {
  try {
    const state = this.game.stateSurface.serialize();
    const payload = JSON.stringify(state);

    // Size check
    if (payload.length > 80000) {
      console.warn(`[SessionManager] Snapshot large: ${payload.length} bytes`);
    }
    if (payload.length > 100000) {
      console.error('[SessionManager] Snapshot too large, rejecting');
      return this.sendJoinAck(guestId, false, null, 'STATE_TOO_LARGE');
    }

    const msg = createSnapshot({
      simTick: this.game.simLoop?.tickCount || 0,
      state
    });

    await this.transport.broadcastToChannel(this._sessionChannel, msg);
    console.log(`[SessionManager] SNAPSHOT sent to ${guestId}`);
  } catch (err) {
    console.error('[SessionManager] Snapshot serialization failed:', err);
    this.sendJoinAck(guestId, false, null, 'SNAPSHOT_ERROR');
  }
}
```

---

## 4. Risk Mitigations (from R013-M06-JOIN-FLOW-RISKS.md)

| Risk ID | Mitigation | Implementation |
|---------|------------|----------------|
| M06-R01 | Join queue for concurrent requests | Add `joinQueue` array + `_processJoinQueue()` |
| M06-R02 | Snapshot serialization try-catch | Wrap in try-catch, reject on error |
| M06-R04 | Size check before send | 80KB warn, 100KB reject |

### 4.1 Join Queue Addition

```javascript
// In constructor:
this.joinQueue = [];
this.processingJoin = false;

// Modify _handleJoinReq to queue:
_handleJoinReq(msg) {
  this.joinQueue.push(msg);
  this._processJoinQueue();
}

async _processJoinQueue() {
  if (this.processingJoin || this.joinQueue.length === 0) return;
  this.processingJoin = true;

  const req = this.joinQueue.shift();
  await this._doHandleJoinReq(req); // Actual logic moved here

  this.processingJoin = false;
  this._processJoinQueue(); // Process next
}
```

---

## 5. Test Coverage Plan

### 5.1 sessionManager.join.test.js Structure

```javascript
describe('SessionManager Join Flow (M06)', () => {
  describe('Session Channel', () => {
    it('joins session channel on hostGame');
    it('leaves session channel on leaveGame');
  });

  describe('_handleJoinReq validation', () => {
    it('rejects wrong protocolVersion');
    it('rejects missing guestId');
    it('rejects missing guestName');
    it('ignores duplicate guestId');
    it('rejects when session full');
    it('accepts valid request');
  });

  describe('sendJoinAck', () => {
    it('sends JOIN_ACK with accepted=true and slot');
    it('sends JOIN_ACK with accepted=false and reason');
  });

  describe('Snapshot', () => {
    it('sends SNAPSHOT after JOIN_ACK accept');
    it('warns on large snapshot (>80KB)');
    it('rejects on oversized snapshot (>100KB)');
    it('handles serialization error gracefully');
  });

  describe('Concurrent joins', () => {
    it('processes queue sequentially');
    it('assigns unique slots to concurrent requests');
  });
});
```

---

## 6. Integration Points

### 6.1 Transport Layer

**Required Methods** (all exist in SupabaseTransport.js):
- `joinChannel(channelName, callback)` — line 369
- `broadcastToChannel(channelName, msg)` — line 431
- `leaveChannel(channelName)` — line 462

### 6.2 Game.stateSurface

**Required Method**:
- `serialize()` — used for SNAPSHOT, must exist from R011

### 6.3 MessageSerializer

**Required Factory Functions**:
- `createJoinAck(data)` — verify exists and signature
- `createSnapshot(data)` — verify exists and signature

---

## 7. Verification Checklist

After M06 implementation, verify:

- [ ] `npm test` passes (Task 0 gate)
- [ ] `hostGame()` creates session channel
- [ ] JOIN_REQ validation rejects invalid messages
- [ ] Slot assignment works (0=Host, 1-3=Guests)
- [ ] JOIN_ACK sent on session channel
- [ ] SNAPSHOT sent after accept
- [ ] Concurrent joins get unique slots
- [ ] leaveGame() cleans up session channel

---

## 8. Dependencies

| Dependency | Status | Blocking |
|------------|--------|----------|
| Task 0 (Vitest) | PENDING | YES — must complete first |
| M05 (Discovery) | COMPLETE | No |
| stateSurface.serialize() | EXISTS | No |
| MessageSerializer factories | VERIFY | Check before impl |

---

*Generated by Worker (BE) — R013-M06 Implementation Map*
