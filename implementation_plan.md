# M07 Implementation Plan: Game Loop (Slice 1 & 2)

**Last Updated**: 2026-02-06
**Status**: Slice 1 GAPS FIXED. Ready for HU-TEST.

## Strategy
Split into two distinct verifiable slices to isolate networking bugs from simulation bugs.

## Slice 1: Transport & Queuing ✅ IMPLEMENTED
**Objective**: Prove commands travel Host->Guest and sit in the queue correctly ordered.
**Constraints**:
- **NO EXECUTION**: `SimLoop` does not process the queue yet. ✅
- **Policies**: Loose (Warn/Continue) for gaps. ✅
- **Validation**: Strict Input Sanitization NOW (don't wait). ✅
- **Logging**: Minimal (Meta-only), protected by Sampling/RingBuffer. ✅

## Slice 2: Execution & Determinism (Next)
**Objective**: Enable execution and prove identical state.
**Pre-Requisite**: **Real Snapshotting** (Fallback is banned for Slice 2).
**Constraints**:
- **Policies**: Strict (Stall on Gap, Error on Stale).
- **Check**: StateHash comparison (Host vs Guest).

## Changes (Slice 1) - ✅ ALL COMPLETE

### src/SimCore/multiplayer
- ✅ `MessageSerializer.js`: Extended `CMD_BATCH` schema with `batchSeq`, `scheduledTick`, `stateHash`
- ✅ `MessageTypes.js`: Updated schema validation for extended CMD_BATCH
- ✅ `SessionManager.js`:
    - ✅ `sendCmdBatch()`: Collection & Broadcast with batchSeq counter
    - ✅ `_handleCmdBatch()`: Validation, Ordering, Dedup, Stale check, Enqueue
    - ✅ `bufferInputCmd()`: Add commands to Host buffer
    - ✅ `getDebugNetStatus()`: For HU-TEST evidence
    - ✅ `_debugCounters`: batchSentCount, batchRecvCount, cmdEnqueuedCount, etc.

### src/SimCore/runtime
- ✅ `CommandQueue.js`:
  - ✅ Preserve Host-assigned `id` when present
  - ✅ Preserve Host-assigned `seq` when present
  - ✅ `scheduledTick` support in enqueue()
- `SimLoop.js`: No changes needed (Generic).

### src/Core
- ✅ `Game.js`:
  - ✅ `ENABLE_COMMAND_EXECUTION = false` (Default for Slice 1)
  - ✅ `_processInputCommands`: Respects flag, early-returns when false
  - ✅ `NetworkDebugPanel` initialization in dev mode

### src/UI
- ✅ `NetworkDebugPanel.js`: New debug overlay for M07 HU-TEST evidence

### Tests
- ✅ `sessionManager.cmdBatch.test.js`: Unit tests for CMD_BATCH flow + Limits (GAP-3)
- ✅ `commandQueue.hostId.test.js`: Unit tests for ID preservation
- ✅ `sessionManager.inputCmd.test.js`: Unit tests for InputCmd Validation (GAP-1)

### Audit
- ✅ `docs/TEST_LOGS/M07_DETERMINISM_AUDIT.md`: W7 audit PASSED
- ✅ `docs/TEST_LOGS/HU-TEST-R013-M07-LOOP.md`: Template created (GAP-2)

## Verification
- **Slice 1**: HU-TEST logs show `BatchSent` == `BatchRecv`, `Queue > 0`.
- **Slice 2**: HU-TEST logs show `HostHash` == `GuestHash`.
