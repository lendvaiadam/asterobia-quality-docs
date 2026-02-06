# R013 M07: Game Loop & Command Batching (Slice 1 & 2)

**Status**: DRAFT
**Owner**: Antigravity
**Slice**: 1 (Transport) & 2 (Execution)

---

## 1. Overview
This specification defines the "Host-Authoritative Command Batching" mechanism.

**Phases**:
1.  **Slice 1 (Transport)**: Verify `CMD_BATCH` travels from Host to Guest's `CommandQueue` with correct sequencing. **NO EXECUTION**.
2.  **Slice 2 (Execution)**: Enable `processCommands` in SimLoop. Verify Determinism.

---

## 2. Message Schema & Canonicalization

### 2.1 INPUT_CMD (Guest -> Host)
User intent. **MUST BE SANITIZED** by Host before batching.

```javascript
{
  type: 'INPUT_CMD',
  cmdType: 'MOVE',      // Enum: MOVE, PATROL, HOLD, STOP
  payload: {            // STRICT JSON-Safe only. No functions.
    x: 10,              // Clamped Integer (Grid)
    y: 20
  },
  // Host overwrites/adds:
  // - slot (from socket)
  // - timestamp (now)
}
```

### 2.2 CMD_BATCH (Host -> Broadcast)
The authoritative list for Tick T.

```javascript
{
  type: 'CMD_BATCH',
  batchSeq: 105,          // Monotonic (Gap Detection)
  simTick: 500,           // Created At
  scheduledTick: 502,     // Execute At (Fixed Buffer)
  commands: [             // Array of VALIDATED commands
    {
      id: "cmd_123",
      type: "MOVE",
      slot: 1,            // Authenticated Slot
      params: { x: 10, y: 20 }
    }
  ],
  stateHash: "0xFE32...", // Integer XOR Checksum
  timestamp: 170000...
}
```

---

## 3. Critical Policies (Locked NOW)

### 3.1 Host Validation (Slice 1)
Host **MUST** validate `INPUT_CMD` before accepting into `inputBuffer`:
1.  **Auth**: `msg.slot` must match socket's assigned slot.
2.  **Schema**: `cmdType` must be valid. `payload` must match schema.
3.  **Sanitization**: `payload` numbers clamped/truncated. No arbitrary props.

### 3.2 Choke Point Guarantee
- **Rule**: `CommandQueue.enqueue()` is the **ONLY** way to mutation.
- **Transport**: `onMessage` -> `_handleCmdBatch` -> `queue.enqueue`.
- **Local**: `InputFactory` -> `send` -> (Network) -> ... -> `queue.enqueue`.
- **Bypass**: Direct calls to `sim.units[0].move()` are **FORBIDDEN**.

### 3.3 StateHash (Determinism Evidence)
- **Algorithm**: Rolling XOR of Integer Unit Props (`id`, `hp`, `gridX`, `gridY`).
- **Exclusion**: No Floats, No Visual State, No Particles.
- **Sampling**: Every 60 ticks.
- **Goal**: `Host.Hash === Guest.Hash`.

### 3.4 Performance Limits
- **Max Commands/Batch**: 20 (Truncate/Warn remainder).
- **Max Queue Size**: 500 (Drop oldest + Error Counter).
- **Logging**:
  - **SimLoop**: `console.log` is **BANNED**.
  - **Network**: Sampled (1/60) or RingBuffer (Post-mortem). Meta-only.

---

## 4. Unit Authority & Seats (Canonical Model)

### 4.1 Concept: Owner vs Controller
To support future takeover/hacking while maintaining strict authority:
- **`ownerSlot`**: Who "possesses" the unit (Color, Scoring).
- **`controllerSlot`**: Who currently "drives" the unit (Input Authority).
- **`lockState`**: `OPEN` (Anyone can sit), `LOCKED` (Only owner/assigned), `HACKED` (Forced).

**Initial State**:
- All units: `ownerSlot: 0` (Host), `controllerSlot: null` (AI/Idle), `lockState: OPEN`.

### 4.2 Seating Flow (Host Authoritative)
1.  **Request**: Guest clicks unit -> Sends `SEAT_REQ { targetUnitId, requesterSlot }`.
2.  **Validation**: Host checks `lockState` and if `controllerSlot` is empty.
3.  **Assignment**:
    - If Valid: Host sets `unit.controllerSlot = requesterSlot`.
    - Broadcasts: `SEAT_ACK { targetUnitId, controllerSlot }`.
4.  **Rejection**: Host sends `SEAT_REJECT { reason }` (Private or Broadcast).

### 4.3 Command Authority Rule
Host **MUST** reject `INPUT_CMD` if:
`msg.slot !== unit.controllerSlot`
(Exception: Admin/Host overrides if defined later).

### 4.4 Schema Additions

#### 4.4.1 SEAT_REQ (Guest -> Host)
```json
{
  "type": "SEAT_REQ",
  "targetUnitId": 42,
  "requesterSlot": 1,
  "timestamp": 17000...
}
```

#### 4.4.2 SEAT_ACK (Broadcast)
```json
{
  "type": "SEAT_ACK",
  "targetUnitId": 42,
  "controllerSlot": 1, // Now controlled by Slot 1
  "timestamp": 17000...
}
```

---

## 5. Slice Difference Table

| Feature | Slice 1 (Plumbing) | Slice 2 (Execution) |
|---|---|---|
| **Execution** | Disabled (Queue Only) | Enabled (`processCommands`) |
| **Gap Policy** | Warn + Continue | **STALL** (Wait for missing) |
| **Stale Policy** | Drop + Warn | **ERROR** (Desync/Resync) |
| **Snapshot** | Fallback OK | **FULL SNAPSHOT REQUIRED** |
| **Validation** | **STRICT/REQUIRED** | Strict |

---

## 6. Verification Constraints

1.  **Snapshot**: Slice 2 CANNOT start until `serialize/deserialize` is proven (no fallback).
2.  **API**: `getDebugNetStatus()` must return sanitized counters for HU-TEST.
3.  **Tests**: Unit tests must verify `enqueue` is called with correct `scheduledTick`.
