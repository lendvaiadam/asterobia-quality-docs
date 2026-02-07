# Task: R013 M07 Game Loop Integration

**Last Updated:** 2026-02-07
**Status:** Slice 1 COMPLETE (Unit Authority v0) - HU-TEST PENDING
**Branch:** `work/WO-R013`
**Commits:** `cbca4aa`, `8cd482a`
**Tests:** 333/333 PASS
**Roadmap:** `docs/M07_ROADMAP_TO_MULTIPLAYER.md`

---

## Phase 1: Specifications & Baseline
- [x] **Spec**: `docs/specs/R013_M07_GAME_LOOP.md` (Locked)
- [x] **Repo**: `task.md`, `implementation_plan.md` exist
- [x] **Bebetonozandók**: `docs/specs/M07_BEBETONOZANDOK.md` (Draft)
- [x] **HU-TEST Template**: `docs/TEST_LOGS/HU-TEST-R013-M07-LOOP.md` ✅ CREATED

---

## Phase 2: Slice 1 (Transport Pipeline)

**Goal**: CMD_BATCH integrity, sequencing, queuing. **NO EXECUTION.**

### ✅ DONE
- [x] Host `sendCmdBatch()` - batchSeq, scheduledTick, broadcast
- [x] Guest `_handleCmdBatch()` - dedup, stale, gap, enqueue
- [x] `CommandQueue` ID preservation - Host ID/seq megőrzés
- [x] Safety Gate - `ENABLE_COMMAND_EXECUTION = false`
- [x] Debug counters - `getDebugNetStatus()`
- [x] NetworkDebugPanel - UI overlay
- [x] Unit tests - `sessionManager.cmdBatch.test.js`
- [x] Determinism audit - `M07_DETERMINISM_AUDIT.md` PASSED

### ❌ GAPS (Must Fix Before HU-TEST)

#### GAP-0: Unit Authority & Seating (Spec Update) - P0 ✅ COMPLETE
*Ref: `docs/specs/R013_M07_GAME_LOOP.md` Section 4 & 4.3 (PIN)*
- [x] **W1 BE**: `SEAT_REQ` (PIN check, Cooldown), `controllerSlot`, Auth check.
- [x] **W2 UI**: Click-to-seat, Keypad Overlay (1-9), Lock Indicator.
- [x] **W3 QA**: Test `seat.test.js` (Takeover, BAD_PIN, COOLDOWN) - 22/22 PASS.
- [x] **W4 REV**: PID digit privacy check - seatPinDigit excluded from snapshots.

#### GAP-1: INPUT_CMD Path (Guest → Host) - P0
```
Jelenlegi: _handleInputCmd() STUB (csak console.log)
Szükséges:
- Slot/sender validáció
- Command type whitelist
- Param range check
- Dedup by seq
- Buffer for CMD_BATCH
```
- [x] Implement `_handleInputCmd()` full validation
- [x] Add `cmdRejectedAuth`, `cmdRejectedType` counters
- [x] Unit test: `sessionManager.inputCmd.test.js`

#### GAP-2: HU-TEST Template - P0
```
Hiányzik: docs/TEST_LOGS/HU-TEST-R013-M07-LOOP.md
Szükséges:
- Evidence mezők (BatchSent, BatchRecv, QueuePending)
- PASS/FAIL kritériumok
- Console dump formátum
```
- [x] Create HU-TEST template
- [x] Define evidence requirements

#### GAP-3: Batch/Queue Limits - P0
```
Hiányzik: MAX konstansok és enforcement
Szükséges:
- MAX_COMMANDS_PER_BATCH = 50
- MAX_QUEUE_SIZE = 200
- Truncation/drop counters
```
- [x] Add `BATCH_LIMITS` constants
- [x] Implement enforcement in `sendCmdBatch()` and `_handleCmdBatch()`
- [x] Add `batchTruncatedCount`, `batchDroppedQueueFull` counters

#### GAP-4: Ring Buffer Logging - P2
```
Kockázat: Per-tick console.log spam
Szükséges:
- RingBufferLog class
- Sampled logging helper
- Meta-only format
```
- [ ] Implement `RingBufferLog`
- [ ] Replace per-tick logs with sampled

### Gates (Slice 1 Closure)
- [x] **GAP Fix**: All P0 gaps resolved (GAP-0, GAP-1, GAP-2, GAP-3)
- [ ] **HU-TEST**: Dual Console Evidence (Queue Growth)
- [ ] **Antigravity Audit**: PASS
- [ ] **Merge**: SHA-pinned receipt

---

## Phase 3: Slice 1 → Slice 2 Transition

**Pre-Requisites (Bebetonozandók):**
- [ ] Snapshot round-trip test
- [ ] Command canonicalization (clamp, precision)
- [ ] StateHash integer-only definition
- [ ] Tick ledger strukturált tracking
- [ ] Choke point audit

---

## Phase 4: Slice 2 (Execution Pipeline)

**Goal**: Execute commands, prove determinism.

- [ ] `ENABLE_COMMAND_EXECUTION = true`
- [ ] Execute-at-tick logic (`scheduledTick` flush)
- [ ] Strict gap policy (STALL, not warn)
- [ ] Strict stale policy (ERROR, not drop)
- [ ] StateHash comparison (Host == Guest)
- [ ] HU-TEST PASS: "Units move in sync"

---

## Phase 5: "Multiplayer Működik" 🎯

**Definition of Done:**
- [ ] 2 kliens ugyanazt látja
- [ ] Parancsok mindkét oldalon végrehajtódnak
- [ ] StateHash egyezik
- [ ] 60 sec stabil játék

---

## Worker Assignment (Current)

| Worker | GAP Fix | Slice 2 Prep |
|--------|---------|--------------|
| BE | GAP-1, GAP-3 | Execute-at-tick |
| QA | GAP-2 | Slice 2 tests |
| RF | GAP-4 (optional) | Cleanup |
