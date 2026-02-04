# R013 Multiplayer Module Hygiene Review

**Date**: 2026-02-05
**Reviewer**: Worker (RF)
**Scope**: `src/SimCore/multiplayer/`
**Type**: Doc-only findings (no code changes)

---

## 1. Unused Imports

| File | Line | Import | Status |
|------|------|--------|--------|
| `SessionManager.js` | 10 | `PlayerStatus` | UNUSED — imported from SessionState but never referenced |
| `SessionManager.js` | 11 | `NetworkRole` | UNUSED DIRECT — only accessed via `this.state.isHost()` etc. |
| `SessionManager.js` | 11 | `sendsInputsToNetwork` | UNUSED — imported but never called |
| `SessionManager.js` | 11 | `broadcastsState` | UNUSED — imported but never called |
| `SessionManager.js` | 12 | `PROTOCOL_VERSION` | UNUSED — imported but never referenced |

**Impact**: Minor. Dead imports increase bundle size marginally and reduce clarity.

**Recommended Action** (for future RF task):
```js
// SessionManager.js line 10-12 - Replace with:
import { SessionState } from './SessionState.js';
import { canStep } from './NetworkRole.js';
import { MSG } from './MessageTypes.js';
import { createHostAnnounce } from './MessageSerializer.js';
```

---

## 2. Naming Inconsistencies

| Pattern | Location | Issue |
|---------|----------|-------|
| Private field prefix | `SessionManager.js:105-117` | Mix of underscore (`_debugAnnounceTickCount`) and no underscore (`rtt`, `pingSeq`) for private-ish fields |
| Debug fields | `SessionManager.js:137-139` | `_debug*` prefix used inconsistently — only for M04 debug fields |
| Method naming | `SessionManager.js` | `onMessage()` public vs `_handleHello()` private — intentional but undocumented |

**Impact**: Low. Maintainability concern only.

**Recommendation**: Establish convention in codebase style guide:
- All truly private fields: `_` prefix
- All public/API fields: no prefix
- Debug-only fields: `_debug` prefix (current pattern is acceptable)

---

## 3. Circular Dependency Risk Assessment

**Result**: NO CIRCULAR DEPENDENCIES DETECTED

Dependency graph (verified):
```
MessageTypes.js       ← (leaf, no imports)
NetworkRole.js        ← (leaf, no imports)
SessionState.js       → NetworkRole.js
MessageSerializer.js  → MessageTypes.js
SessionManager.js     → SessionState.js, NetworkRole.js, MessageTypes.js, MessageSerializer.js
```

**Risk areas to monitor**:
- If `MessageSerializer` ever imports `SessionManager` → CIRCULAR
- If `SessionState` ever imports `SessionManager` → CIRCULAR

---

## 4. Performance Concerns (Low-End Device Impact)

### 4.1 Timer Accumulation Risk
| File | Line | Issue |
|------|------|-------|
| `SessionManager.js` | 214 | `setInterval()` for announce — potential leak if `leaveGame()` not called |
| `SessionManager.js` | 346-349 | `pingInterval` cleared in `leaveGame()` but never started (M12 stub) |

**Mitigation**: `stopAnnouncing()` exists and is called in `leaveGame()`. Safe if protocol followed.

### 4.2 Per-Message Allocations
| File | Function | Issue |
|------|----------|-------|
| `MessageSerializer.js` | All `create*()` functions | New object allocated per message + `Date.now()` call |
| `SessionManager.js:536` | `_generateClientId()` | `Math.random().toString(36).substr(2,9)` creates temp strings |

**Impact**: ~10-20 messages/sec at peak. Negligible on modern devices. May cause GC spikes on very low-end mobile.

**Recommendation** (if perf issues arise):
- Object pool for message templates
- Cache `Date.now()` per tick instead of per message

### 4.3 Linear Searches
| File | Method | Complexity |
|------|--------|------------|
| `SessionState.js:126-136` | `addPlayer()` | `O(n)` find for slot collision check |
| `SessionState.js:143-146` | `removePlayer()` | `O(n)` filter |
| `SessionState.js:152-157` | `markDisconnected()` | `O(n)` find |
| `SessionState.js:185-193` | `findNextSlot()` | `O(n)` set creation + `O(maxPlayers)` loop |

**Impact**: With `maxPlayers=4`, all O(n) operations are O(4) — negligible.

**No action needed** unless maxPlayers increases significantly (>16).

---

## 5. Additional Observations

### 5.1 Stub Methods
The following handlers are stubs awaiting implementation in later milestones:
- `_handleHostAnnounce()` — M05
- `_handleJoinReq()` — M06
- `_handleJoinAck()` — M07
- `_handleInputCmd()` — M09
- `_handleCmdBatch()` — M09
- `_handleSnapshot()` — M11
- `_handleResyncReq()` — N01
- `_handleResyncAck()` — N01
- `_handlePing()` — M12

**Note**: Console logs in stubs are appropriate for debugging during development.

### 5.2 Magic Numbers
| File | Line | Value | Context |
|------|------|-------|---------|
| `SessionManager.js` | 19 | `5000` | `ANNOUNCE_INTERVAL_MS` — properly named constant |
| `SessionManager.js` | 135 | `10` | `snapshotInterval` — should be constant or configurable |

---

## Summary

| Category | Severity | Count |
|----------|----------|-------|
| Unused Imports | LOW | 5 |
| Naming Inconsistencies | LOW | 3 patterns |
| Circular Dependency Risk | NONE | 0 |
| Performance Concerns | LOW | 3 patterns |

**Overall Assessment**: Module is clean and well-structured. No blocking issues. Recommend addressing unused imports in a future cleanup pass after M05+ stabilizes.

---

*Generated by Worker (RF) — R013 Hygiene Review*
