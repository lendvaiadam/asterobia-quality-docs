# R013 Lobby UI Contract — M06 Addendum (Join Flow)

**Version**: 0.13.0
**Status**: Draft
**Owner**: Frontend
**Parent**: `R013-LOBBY-UI-CONTRACT.md`
**Milestone**: M06

---

## 1. Overview

M06 adds join flow to the lobby. This addendum documents how future UI will integrate with SessionManager for joining games.

---

## 2. Entry Point: joinGame()

```javascript
/**
 * Join a host's game session
 * @param {string} hostId - Host's client ID (from getAvailableHosts())
 * @returns {Promise<boolean>} - true if accepted, throws on reject/timeout
 */
await game.sessionManager.joinGame(hostId)
```

**UI Usage**:
- User selects a host from list displayed by `getAvailableHosts()`
- UI calls `joinGame(host.hostId)`
- UI shows "Joining..." spinner during pending state

---

## 3. JOIN_ACK Shape (What UI Receives)

### On Accept

```javascript
{
  type: 'JOIN_ACK',
  accepted: true,
  slot: 1,                    // Guest's assigned slot (1-3)
  hostId: 'uuid-...',
  protocolVersion: '0.13.0',
  timestamp: 1707123456789
}
```

### On Reject

```javascript
{
  type: 'JOIN_ACK',
  accepted: false,
  reason: 'SESSION_FULL',     // or 'VERSION_MISMATCH'
  hostId: 'uuid-...',
  protocolVersion: '0.13.0',
  timestamp: 1707123456789
}
```

---

## 4. Reject Reasons (UI Should Display)

| Reason | User-Facing Message |
|:-------|:--------------------|
| `SESSION_FULL` | "Game is full (4/4 players)" |
| `VERSION_MISMATCH` | "Version mismatch. Please update your game." |

---

## 5. Pending State Behavior

| Aspect | Behavior |
|:-------|:---------|
| Guest retries JOIN_REQ | Every 2 seconds automatically |
| Overall timeout | 10 seconds |
| UI Guidance | Show spinner with "Joining..." text |
| Polling | NONE — use realtime events only |
| Render loop | Do NOT poll joinGame status per-frame |

---

## 6. Timeout Handling

If no JOIN_ACK after 10s:
- `joinGame()` throws/rejects with timeout error
- UI should show: "Connection timed out. Please try again."
- UI returns to host list

---

## 7. Cleanup Rules

| Scenario | UI Action |
|:---------|:----------|
| User cancels join | Call `game.sessionManager.leaveGame()` |
| Join rejected | No cleanup needed (state auto-resets) |
| Join accepted | Stop discovery: `stopDiscovery()` called automatically |
| User leaves game | Call `game.sessionManager.leaveGame()` |

---

## 8. State Checks for UI

```javascript
// Check if currently joining
game.sessionManager.isJoinPending()  // true during JOIN_REQ flow

// Check if in game
game.sessionManager.isGuest()        // true after successful join

// Get my slot
game.sessionManager.state.mySlot     // 1, 2, or 3
```

---

## 9. Sequence Diagram

```
┌─────────┐          ┌────────────────┐          ┌──────┐
│ Lobby UI│          │ SessionManager │          │ Host │
└────┬────┘          └───────┬────────┘          └───┬──┘
     │                       │                       │
     │ joinGame(hostId)      │                       │
     │──────────────────────>│                       │
     │                       │ JOIN_REQ              │
     │                       │──────────────────────>│
     │                       │                       │
     │  [UI shows spinner]   │    [2s retry loop]    │
     │                       │                       │
     │                       │      JOIN_ACK         │
     │                       │<──────────────────────│
     │                       │                       │
     │ Promise resolves      │                       │
     │<──────────────────────│                       │
     │                       │                       │
     │ [Navigate to game]    │                       │
     └───────────────────────┴───────────────────────┘
```

---

## 10. Out-of-Scope (M14)

- No UI components in this doc
- No actual widget implementation
- No CSS/HTML
- This is contract/interface documentation only
