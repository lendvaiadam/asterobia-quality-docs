---
name: asterobia-multiplayer-preflight
description: Pre-flight checks before enabling multiplayer features.
---

# Asterobia Multiplayer Preflight Skill

## When to use
- Before merging any feature tagged "Multiplayer" or "Networking".
- When integrating Supabase or WebRTC.
- When expanding the `Release 012` scope.

## The Checklist
Multiplayer readiness requires **Strict Determinism** and **State Isolation**.

1.  **Transport Layer**:
    - [ ] Is `LocalTransport` fully functional?
    - [ ] Is `NetworkTransport` (if present) implementing the same Interface?
    - [ ] Are messages serialized cleanly (JSON-safe)?

2.  **State Surface**:
    - [ ] Is `serializeState()` comprehensive? (Includes all gameplay data).
    - [ ] Is `StateSurface.js` free of Three.js objects (Mesh, Material)?
    - [ ] Are all IDs deterministic (no random UUIDs)?

3.  **SimLoop**:
    - [ ] Is the update loop fixed-timestep?
    - [ ] Are we using `SeededRNG` for all gameplay logic?
    - [ ] Are `Math.random()` calls restricted to visual-only effects?

## Architecture Reminder (Host-Authoritative)
-   **Server (Host)** is the source of truth.
-   **Clients** send Inputs, receive State Updates (or Input streams for lockstep).
-   Do **NOT** trust client-side positions. Use inputs to drive simulation on Host.

## Migration Path
-   R011 verified Save/Load (Persistence).
-   R012 will verify Realtime Sync (Supabase).
-   Ensure your changes support **Snapshot Interpolation** (rendering state is separate from authoritative state).

## M07 CMD_BATCH Checklist (Slice 1)

### Host-Side Requirements
- [ ] Host creates CMD_BATCH with `{type, simTick, seq, commands[], timestamp}`
- [ ] Commands collected from local input during tick
- [ ] Batch sent to all connected guests via `SessionManager.broadcast()`
- [ ] State hash included for validation (optional in Slice 1)

### Guest-Side Requirements
- [ ] Guest receives CMD_BATCH via WebSocket message handler
- [ ] Validate message schema before processing
- [ ] Enqueue commands in `CommandQueue` with correct tick association
- [ ] Log received batch (tick, seq, command count)
- [ ] Handle gaps: log warning, continue (no STALL in Slice 1)

### Integration Points
```
Host SimLoop.tick()
    ↓
InputFactory.flush() → commands[]
    ↓
SessionManager.broadcast(CMD_BATCH)
    ↓ (WebSocket)
Guest.onMessage(CMD_BATCH)
    ↓
CommandQueue.enqueueBatch(tick, commands)
```

### Test Scenarios
1. Single command in batch → received and logged
2. Multiple commands in batch → all received in order
3. Empty batch (no commands this tick) → handled gracefully
4. Out-of-order batch arrival → logged, not executed yet (Slice 1)
