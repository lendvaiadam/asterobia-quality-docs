# Task: R013 M07 Game Loop Integration

## Phase 1: Specifications & Baseline (NOW)
- [x] **Spec**: `docs/specs/R013_M07_GAME_LOOP.md` (Strict Policies Locked) <!-- id: 0 -->
- [ ] **Repo**: Ensure `task.md`, `implementation_plan.md` exist in repo root <!-- id: 1 -->
- [ ] **Docs**: Set `STATUS_WALKTHROUGH` to M07 Slice 1 <!-- id: 2 -->
- [ ] **Test**: Create `docs/TEST_LOGS/HU-TEST-R013-M07-LOOP.md` <!-- id: 3 -->

## Phase 2: Slice 1 (Transport Pipeline)
**Goal**: `CMD_BATCH` integrity, sequencing, queuing. **NO EXECUTION.**

### W1 (Backend)
- [ ] **Protocol**: Implement `INPUT_CMD` (Sanitization) & `CMD_BATCH` (Creation) <!-- id: 4 -->
- [ ] **Validation**: Host-side Slot/Schema verification (Anti-Cheat/Bug) <!-- id: 5 -->
- [ ] **Transport**: Host Broadcast (`sentCount++`) -> Guest Recv (`_handleCmdBatch`) <!-- id: 6 -->
- [ ] **Queue Logic**: Update `CommandQueue` to accept Host IDs (don't overwrite) <!-- id: 21 -->
- [ ] **Safety Gate**: Add `Game.ENABLE_COMMAND_EXECUTION` flag (Disable for Slice 1) <!-- id: 22 -->
- [ ] **Queue**: Guest `enqueue(cmd, scheduledTick)` (Accumulate ONLY) <!-- id: 7 -->
- [ ] **Policies**: Dedup (Ignore), Gap (Warn), Stale (Drop - Slice 1 Mode) <!-- id: 8 -->
- [ ] **Debug**: `getDebugNetStatus` (Counters), RingBuffer Logger (No Spam) <!-- id: 9 -->

### W3 (QA)
- [ ] **Unit Tests**: `cmdBatch` logic (ordering, limits, counters) <!-- id: 10 -->
- [ ] **Stability**: Fix `sessionState.test.js` flake <!-- id: 11 -->

### W2 (Frontend)
- [ ] **UI**: Lobby "Mission Control" & Network Pulse Widget <!-- id: 12 -->

### Gates (Slice 1 Closure)
- [ ] **Code Audit**: Spec Compliance Check <!-- id: 13 -->
- [ ] **HU-TEST**: Dual Console Evidence (Queue Growth) <!-- id: 14 -->

## Phase 3: Slice 2 Preparation (The "Real" Multiplayer)
**Goal**: Execution, Determinism, Snapshot Reliance.

- [ ] **Snapshot**: **MUST FIX** `serialize/deserialize` (Real Data) <!-- id: 15 -->
- [ ] **Limit Check**: Verify MAX_COMMANDS/MAX_QUEUE limits <!-- id: 16 -->
- [ ] **StateHash**: Implement Integer-XOR Checksum <!-- id: 17 -->

## Phase 4: Slice 2 Execution
- [ ] **SimLoop**: Enable `processCommands(tick)` <!-- id: 18 -->
- [ ] **Policies**: Switch Gap/Stale to **STRICT** (Stall/Error) <!-- id: 19 -->
- [ ] **Verification**: HU-TEST PASS (Units move in sync) <!-- id: 20 -->
