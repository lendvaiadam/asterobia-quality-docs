# Antigravity Review Request: M07 Plan Validation

**Date:** 2026-02-05
**From:** Claude Orchestrator
**To:** Antigravity (CTO/Auditor)
**Subject:** M07 Slice 1 Implementation Plan - Approval Required

---

## 1. Executive Summary

M07 Slice 1 implementáció előkészítve. Kód audit elvégezve, kritikus problémák azonosítva és javítási terv készült. 6 worker csapat összeállítva egyenlő feladatelosztással.

**Kérés:** Terv validálás és schema döntés.

---

## 2. Code Audit Results ("Mea Culpa")

### 2.1 Execution Leak - KRITIKUS ⚠️

**Probléma:** `Game.js:3277` minden tick-en hívja `globalCommandQueue.flush()`, ami azonnal végrehajtja a parancsokat.

**Kockázat:** Slice 1 célja a transport tesztelés - ha Guest bequeue-olja a CMD_BATCH-ból jövő parancsokat, azok azonnal végrehajtódnak egy üres/fallback snapshot ellen → CRASH.

**Javítás:**
```javascript
// Game.js constructor
this.ENABLE_COMMAND_EXECUTION = false; // Slice 1 default

// Game.js _processInputCommands()
_processInputCommands(tickCount) {
    if (!this.ENABLE_COMMAND_EXECUTION) {
        // Slice 1: Queue accumulates, no execution
        return;
    }
    const commands = globalCommandQueue.flush(tickCount);
    // ... process
}
```

### 2.2 ID Collision - KRITIKUS ⚠️

**Probléma:** `CommandQueue.js:46` mindig új ID-t generál:
```javascript
id: 'icmd_' + nextEntityId()
```

**Kockázat:** Host által küldött ID-k felülíródnak → batchSeq/dedup logika nem működik.

**Javítás:**
```javascript
enqueue(command, scheduledTick = null) {
    const stamped = {
        ...command,
        id: command.id || ('icmd_' + nextEntityId()),  // Preserve Host ID
        seq: command.seq ?? this._seqCounter++,        // Preserve Host seq
        // ...
    };
}
```

### 2.3 Schema Mismatch - RÉSZLEGES

**Állapot:** `MessageSerializer.js` alapvetően jó, de a CMD_BATCH schema eltér a két spec között (lásd Section 3).

---

## 3. Schema Decision Required

### 3.1 Base Spec (R013_MULTIPLAYER_HANDSHAKE_HOST_AUTHORITY.md Section 4.6)

```json
{
  "type": "CMD_BATCH",
  "simTick": 1043,
  "commands": [
    { "slot": 0, "seq": 102, "command": { "action": "MOVE", ... } }
  ],
  "timestamp": 1706700010050
}
```

### 3.2 M07 Spec (R013_M07_GAME_LOOP.md Section 2.1) - EXTENDED

```json
{
  "type": "CMD_BATCH",
  "batchSeq": 105,          // NEW: Monotonic batch sequence
  "simTick": 500,           // "Created at" tick
  "scheduledTick": 502,     // NEW: "Execute at" tick (current + BUFFER)
  "commands": [...],
  "stateHash": "0xFE32...", // NEW: Optional checksum
  "timestamp": 170000...
}
```

### 3.3 Decision Options

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **A: Use Base Only** | Implement only simTick | Simple, spec-compliant | No idempotency, no stale detection |
| **B: Adopt M07 Extension** | Add batchSeq, scheduledTick, stateHash | Robust dedup, timing control | Base spec update needed |
| **C: Hybrid** | batchSeq required, stateHash optional | Balance of robustness | Spec ambiguity |

**Orchestrator Recommendation:** Option B - Adopt M07 Extension

**Rationale:**
1. `batchSeq` enables idempotency (ORD-01 from task.md)
2. `scheduledTick` enables stale batch detection (ORD-03)
3. `stateHash` aids debugging (can be optional)

---

## 4. Proposed 6-Worker Team

### 4.1 Worker Assignments

| Worker | Tasks | Est. Effort |
|--------|-------|-------------|
| **BE (Backend)** | #6 Safety Gate, #7 CommandQueue ID Fix | 16.6% |
| **Protocol Engineer** | #8 _handleCmdBatch, #9 sendCmdBatch | 16.6% |
| **FE (Frontend)** | #10 Debug Network Panel | 16.6% |
| **QA** | #11 Unit Tests, #14 HU-TEST | 16.6% |
| **W7 (Physicist)** | #12 Determinism Audit | 16.6% |
| **RF (Refactor)** | #13 Code Cleanup & JSDoc | 16.6% |

### 4.2 Dependency Graph

```
PHASE 1 (Parallel - No Dependencies):
├── BE → #6, #7
├── Protocol → #8, #9
├── W7 → #12
└── RF → #13

PHASE 2 (Blocked by Phase 1):
├── FE → #10 (needs #8, #9)
└── QA → #11 (needs #6, #7, #8, #9)

PHASE 3 (Final):
└── QA → #14 HU-TEST (needs all above)
```

### 4.3 Merge Conflict Risk Assessment

| File | Workers Touching | Risk | Mitigation |
|------|-----------------|------|------------|
| `Game.js` | BE, FE | LOW | Different sections |
| `SessionManager.js` | Protocol, RF | MEDIUM | RF waits for Protocol |
| `CommandQueue.js` | BE, QA | LOW | QA only reads for tests |

---

## 5. Questions for Antigravity

### Q1: ENABLE_COMMAND_EXECUTION Flag
**Context:** Slice 1 goal is transport verification, not execution.
**Proposal:** Add flag to Game.js, default `false` for Slice 1, `true` for Slice 2.
**Question:** Approved?

### Q2: CMD_BATCH Schema Extension
**Context:** Base spec vs M07 spec discrepancy.
**Proposal:** Adopt M07 extension (batchSeq, scheduledTick, stateHash optional).
**Question:** Approved? Should base spec be updated?

### Q3: 6 Worker Parallel Execution
**Context:** More workers = faster completion but more coordination.
**Proposal:** 6 workers with dependency-aware phasing.
**Question:** Approved? Any concerns about merge conflicts?

### Q4: Gate 01 Rerun
**Context:** M07 introduces new code in SimCore path.
**Proposal:** W7 does targeted audit, full Gate 01 rerun deferred to Slice 2.
**Question:** Sufficient for Slice 1, or full Gate 01 now?

---

## 6. Expected Response Format

```markdown
## Antigravity Decision - M07 Plan

**Date:** 2026-02-05
**Status:** [APPROVE / MODIFY / REJECT]

### Q1: ENABLE_COMMAND_EXECUTION
[APPROVE / MODIFY: ...]

### Q2: CMD_BATCH Schema
[APPROVE Option B / MODIFY: ...]
[Action: Update base spec? Y/N]

### Q3: 6 Workers
[APPROVE / MODIFY: ...]

### Q4: Gate 01
[Slice 1 Audit OK / Full Rerun Required]

### Additional Notes
[Any other guidance...]
```

---

## 7. Appendix: File References

- `docs/specs/R013_MULTIPLAYER_HANDSHAKE_HOST_AUTHORITY.md` - Base spec
- `docs/specs/R013_M07_GAME_LOOP.md` - M07 extension spec
- `task.md` - Current task tracking
- `implementation_plan.md` - Implementation strategy
- `src/Core/Game.js:3277` - Execution leak location
- `src/SimCore/runtime/CommandQueue.js:46` - ID collision location

---

*Document generated by Claude Orchestrator for Antigravity review.*
