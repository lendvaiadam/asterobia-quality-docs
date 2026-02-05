# M07 Implementation Plan: Game Loop (Slice 1 & 2)

## Strategy
Split into two distinct verifiable slices to isolate networking bugs from simulation bugs.

## Slice 1: Transport & Queuing (Current)
**Objective**: Prove commands travel Host->Guest and sit in the queue correctly ordered.
**Constraints**:
- **NO EXECUTION**: `SimLoop` does not process the queue yet.
- **Policies**: Loose (Warn/Continue) for gaps.
- **Validation**: Strict Input Sanitization NOW (don't wait).
- **Logging**: Minimal (Meta-only), protected by Sampling/RingBuffer.

## Slice 2: Execution & Determinism (Next)
**Objective**: Enable execution and prove identical state.
**Pre-Requisite**: **Real Snapshotting** (Fallback is banned for Slice 2).
**Constraints**:
- **Policies**: Strict (Stall on Gap, Error on Stale).
- **Check**: StateHash comparison (Host vs Guest).

## Changes (Slice 1)

### src/SimCore/multiplayer
- `MessageSerializer.js`: Add `INPUT_CMD`, `CMD_BATCH` schemas.
- `SessionManager.js`:
    - `sendCmdBatch()`: Collection & Broadcast.
    - `_handleCmdBatch()`: Validation, Ordering, Enqueue.
    - `_debugCounters`: For HU-TEST.

### src/SimCore/runtime
- `CommandQueue.js`: Add scheduling support (`tick` parameter).

### src/utils
- `Logger.js`: Add RingBuffer capability (optional, or inline in SessionManager).

## Verification
- **Slice 1**: HU-TEST logs show `BatchSent` == `BatchRecv`, `Queue > 0`.
- **Slice 2**: HU-TEST logs show `HostHash` == `GuestHash`.
