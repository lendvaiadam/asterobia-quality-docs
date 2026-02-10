# HU-TEST-R013-M07-LOOP: Slice 1 Transport

**Date:** [DATE]
**Tester:** [NAME]
**Version:** M07-Slice1
**Status:** [PASS/FAIL]

## Preflight: Ensure correct branch + HEAD commit
**Why:** Prevents testing on the wrong branch or stale head, ensuring verification against the exact approved snapshot.

### Commands (Run in Terminal)
```powershell
cd "D:\___AI_PROJECTEK___\AI_GAME\_GAME_3_"
git checkout work/WO-R013
git log --oneline -5
```

### PASS Criteria
- The **FIRST (top) line** of output starts with: `6383f84`

### FAIL Handling
1.  **STOP** the test immediately.
2.  Paste the output into chat.
3.  Run `git branch --show-current` and confirm the active branch.
4.  **Do NOT proceed** until HEAD matches `6383f84`.

## Objective
Verify robust command transport from Host to Guest without execution.
Ensure `CMD_BATCH` integrity, sequencing, and queue accumulation.

## Setup
1. **Reset**: Refresh both browser windows.
2. **Host**: Create "M07 Test" (Slot 0).
3. **Guest**: Join "M07 Test" (Slot 1).
4. **Debug**: Open `NetworkDebugPanel` (Press `~` or check UI).

## Test Cases

### TC-00: Unit Seating (Req for Control)
*Goal: Guest assumes control of a specific unit.*
1. Guest: Click on a Unit (ID: `____`).
2. Verify: Unit selection indicator appears.
3. Verify: `SEAT_REQ` -> `SEAT_ACK` flow in console/debug panel.
4. **EXPECT**: `unit.controllerSlot` becomes `1` (Guest).
   - [ ] Result: `Seat Assigned`

### TC-00b: Seat Challenge (PIN 1-9)
*Goal: Guest unlocks a protected unit.*
1. Host: Set `unit.seatPolicy = 'PIN_1DIGIT'` and `pin = 5` (via console).
2. Guest: Click Unit -> Verify Keypad appears (1-9).
3. Guest: Enter `9` (Wrong). -> Verify `SEAT_REJECT (BAD_PIN)`.
4. Guest: Enter `5` (Correct). -> Verify `SEAT_ACK`.
   - [ ] Result: `Challenge Passed`

### TC-01: Heartbeat Flow (Idle)
*Goal: Confirm CMD_BATCH is broadcast every tick.*
1. Wait 5 seconds.
2. Check Host `BatchSent` counter.
3. Check Guest `BatchRecv` counter.
4. **EXPECT**: `BatchSent` ≈ `BatchRecv` > 0.
   - [ ] Result: `Sent: ____` / `Recv: ____`

### TC-02: Command Injection (No Execution)
*Goal: Verify commands are buffered, NOT executed.*
1. Guest: Press `T` (Test Command) 5 times.
2. Check Guest `CmdEnqueued`.
3. Check Guest `QueuePending`.
4. Check SimLoop `ProcessedCmds` (Should be 0).
5. **EXPECT**:
    - `CmdEnqueued` increases by 5.
    - `QueuePending` increases by 5 (and stays there).
    - `ProcessedCmds` == 0 (Execution Gate working).
   - [ ] Result: `Enq: ____` / `Pend: ____` / `Proc: ____`

### TC-03: Batch Limits (Traffic)
*Goal: Verify 50-command limit enforcement.*
1. Guest: Spam inputs (hold key) or use console `stressTest()`.
2. Check Host `BatchTruncated` counter.
3. **EXPECT**: If traffic > 50/tick, `BatchTruncated` > 0.
   - [ ] Result: `Truncated: ____`

## Evidence Dump
*Paste `SessionManager.getDebugNetStatus()` output from console:*

**HOST:**
```json

```

**GUEST:**
```json

```

## Pass Criteria
- [ ] **Seating Successful** (Control acquired).
- [ ] No `cmdRejectedAuth` errors.
- [ ] No `cmdRejectedType` errors.
- [ ] `BatchRecv` matches `BatchSent` (within margin).
- [ ] Queue grows, does NOT drain (Execution Gate = Closed).
