# M07 Unit Authority v0 - Session Handoff

**Date:** 2026-02-07
**Branch:** `work/WO-R013`
**Last Commits:** `cbca4aa`, `8cd482a`

---

## Current Status: HU-TEST PENDING

M07 Slice 1 implementation is COMPLETE. Waiting for manual verification.

---

## What Was Implemented

### Unit Authority v0 (Canonical Spec)
- **`selectedBySlot`**: The driver (who controls the unit). Exclusive, can be null.
- **`ownerSlot`**: Economic owner. Changes only on takeover.
- **Takeover**: Only allowed if `selectedBySlot == null`
- **OCCUPIED denial**: If someone else is seated, deny immediately (no keypad)

### Key Files Changed
| File | Changes |
|------|---------|
| `src/Entities/Unit.js` | `selectedBySlot`, `ownerSlot`, lock indicators |
| `src/SimCore/multiplayer/SessionManager.js` | SEAT_REQ/ACK/REJECT, `getNetEvidence()` |
| `src/Core/InteractionManager.js` | Seat flow trigger, OCCUPIED feedback |
| `src/Core/Game.js` | Keyboard gating, evidence dump |
| `src/SimCore/runtime/InputFactory.js` | SELECT/DESELECT local-only |

### Tests: 333/333 PASS
- `sessionManager.seat.test.js` (22 tests)
- `seatAuthority.test.js` (33 tests)
- All other existing tests pass

---

## HU-TEST Steps (Console-Based)

```bash
npm run dev
```

### Tab 1 (Host)
```javascript
// Get hostId
const hostId = sessionManager.state.hostId;
console.log('Host ID:', hostId);

// Set up test unit with PIN
game.units[0].ownerSlot = 0;
game.units[0].seatPolicy = 'PIN_1DIGIT';
game.units[0].seatPinDigit = 5;
game.units[0].selectedBySlot = null;
```

### Tab 2 (Guest)
```javascript
await sessionManager.joinGame('<paste-hostId>');

// Test 1: Click ground -> deselect instant
// Test 2: Click PIN unit -> keypad appears
// Test 3: Wrong PIN (3) -> "WRONG PIN"
// Test 4: Correct PIN (5) -> seat granted, can WASD
// Test 5: Evidence dump
JSON.stringify(sessionManager.getNetEvidence(), null, 2);
```

---

## What's Next After HU-TEST PASS

### Slice 2: Command Execution
1. Set `ENABLE_COMMAND_EXECUTION = true`
2. Implement execute-at-tick logic
3. StateHash comparison (Host == Guest)
4. Goal: "Units move in sync"

### Slice 3: Full Multiplayer
- 2 clients see the same thing
- Commands execute on both sides
- 60 sec stable gameplay

---

## Canonical Docs
- `docs/specs/R013_M07_UNIT_AUTHORITY_V0.md` - Unit Authority spec
- `docs/specs/R013_M07_GAME_LOOP.md` - Game loop spec
- `task.md` - Current task status

---

## Governance Rules (Non-Negotiable)
1. **Parallel workers**: Always split work across W1/W2/W3/W4
2. **UI honesty**: Never claim UI exists unless implemented
3. **Determinism**: No sim mutations outside CommandQueue
4. **Privacy**: `seatPinDigit` never in snapshots/messages/evidence
