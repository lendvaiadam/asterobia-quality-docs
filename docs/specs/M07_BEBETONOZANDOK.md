# M07 Bebetonozandók - Kritikus Döntések

**Státusz:** DRAFT - Antigravity Review Required
**Cél:** Slice 2 előtt rögzítendő architektúrális döntések

---

## 1. Snapshot Serialize/Deserialize Megbízhatóság

### Jelenlegi Állapot
- ✅ `serializeState()` - működik, JSON-safe
- ✅ `serializeUnit()` - sanitizeCommandParams() van
- ⚠️ `deserialize` - csak shallow copy (`{ ...data }`)
- ❌ Round-trip teszt NINCS

### Szükséges Változtatások
```javascript
// KELL: Round-trip validáció
function validateRoundTrip(game) {
    const snapshot = serializeState(game);
    const json = JSON.stringify(snapshot);
    const parsed = JSON.parse(json);
    const hash1 = hashState(snapshot);
    const hash2 = hashState(parsed);
    if (hash1 !== hash2) throw new Error('Round-trip hash mismatch');
}
```

### Teszt Követelmény
- [ ] `stateSurface.roundtrip.test.js` - serialize → JSON → parse → hash egyezés

---

## 2. Command Payload Kanonikalizálás

### Jelenlegi Állapot
- ✅ `sanitizeCommandParams()` - whitelist mezők
- ⚠️ Float értékek NEM clampelve
- ❌ Kulcs sorrend NEM garantált
- ❌ Típus validáció gyenge

### Szükséges Változtatások
```javascript
// KELL: Canonical command format
const COMMAND_LIMITS = {
    MOVE: {
        position: { min: -1000, max: 1000, precision: 3 }  // 3 decimals
    }
};

function canonicalizeCommand(cmd) {
    const canonical = {
        type: cmd.type,
        // Sorted keys, clamped values
        params: sortKeys(clampParams(cmd.params, COMMAND_LIMITS[cmd.type]))
    };
    return canonical;
}

function clampParams(params, limits) {
    const result = {};
    for (const [key, limit] of Object.entries(limits)) {
        if (params[key] !== undefined) {
            if (typeof params[key] === 'number') {
                result[key] = clamp(
                    roundTo(params[key], limit.precision),
                    limit.min,
                    limit.max
                );
            } else if (params[key]?.x !== undefined) {
                // Vector3
                result[key] = {
                    x: clamp(roundTo(params[key].x, limit.precision), limit.min, limit.max),
                    y: clamp(roundTo(params[key].y, limit.precision), limit.min, limit.max),
                    z: clamp(roundTo(params[key].z, limit.precision), limit.min, limit.max)
                };
            }
        }
    }
    return result;
}
```

### Döntés Szükséges
- [ ] Position precision: 3 decimals? Integer grid?
- [ ] Coordinate range: ±1000? Bolygó méret alapján?

---

## 3. Host Validáció (INPUT_CMD)

### Jelenlegi Állapot
- ❌ `_handleInputCmd()` - STUB ONLY (line 1071)
- ❌ Slot/sender egyezés ellenőrzés NINCS
- ❌ Command type whitelist NINCS
- ❌ Param range validáció NINCS

### Szükséges Implementáció
```javascript
// SessionManager.js
_handleInputCmd(msg) {
    if (!this.state.isHost()) return;

    // 1. Slot/Sender validation
    const player = this.state.players.find(p => p.slot === msg.slot);
    if (!player || player.clientId !== msg.senderId) {
        console.warn(`[SM] INPUT_CMD rejected: slot/sender mismatch`);
        this._debugCounters.cmdRejectedAuth++;
        return;
    }

    // 2. Command type whitelist
    const ALLOWED_TYPES = ['MOVE', 'SELECT', 'DESELECT', 'SET_PATH', 'CLOSE_PATH'];
    if (!ALLOWED_TYPES.includes(msg.command?.type)) {
        console.warn(`[SM] INPUT_CMD rejected: unknown type ${msg.command?.type}`);
        this._debugCounters.cmdRejectedType++;
        return;
    }

    // 3. Canonicalize and validate params
    const canonical = canonicalizeCommand(msg.command);
    if (!canonical) {
        console.warn(`[SM] INPUT_CMD rejected: invalid params`);
        this._debugCounters.cmdRejectedParams++;
        return;
    }

    // 4. Dedup by seq
    const lastSeq = this.state.lastSeenSeq[msg.slot] ?? -1;
    if (msg.seq <= lastSeq) {
        this._debugCounters.cmdRejectedDup++;
        return;
    }
    this.state.lastSeenSeq[msg.slot] = msg.seq;

    // 5. Buffer for batch
    this.bufferInputCmd({
        slot: msg.slot,
        seq: msg.seq,
        command: canonical
    });
}
```

### Debug Counters Szükséges
```javascript
_debugCounters = {
    // ... existing
    cmdRejectedAuth: 0,    // Slot/sender mismatch
    cmdRejectedType: 0,    // Unknown command type
    cmdRejectedParams: 0,  // Invalid params
    cmdRejectedDup: 0      // Duplicate seq
};
```

---

## 4. ExpectedTick / Missing Tick Ledger

### Jelenlegi Állapot
- ✅ `_lastReceivedBatchSeq` - van
- ⚠️ Gap detection - csak log, nincs strukturált tracking
- ❌ Missing tick lista NINCS
- ❌ lastProcessedTick NINCS

### Szükséges Implementáció
```javascript
// SessionManager.js constructor
this._tickLedger = {
    lastProcessedTick: -1,
    expectedNextBatchSeq: 0,
    missingSeqs: [],           // Array of missing batchSeq numbers
    gapCount: 0,               // Total gaps detected
    maxGapSize: 0,             // Largest gap ever seen
    lastGapAt: null            // Timestamp of last gap
};

// In _handleCmdBatch:
_updateTickLedger(msg) {
    const expected = this._tickLedger.expectedNextBatchSeq;

    if (msg.batchSeq > expected) {
        // Gap detected
        const gap = msg.batchSeq - expected;
        for (let i = expected; i < msg.batchSeq; i++) {
            this._tickLedger.missingSeqs.push(i);
        }
        this._tickLedger.gapCount++;
        this._tickLedger.maxGapSize = Math.max(this._tickLedger.maxGapSize, gap);
        this._tickLedger.lastGapAt = Date.now();

        // Trim missing list (keep last 100)
        if (this._tickLedger.missingSeqs.length > 100) {
            this._tickLedger.missingSeqs = this._tickLedger.missingSeqs.slice(-100);
        }
    }

    this._tickLedger.expectedNextBatchSeq = msg.batchSeq + 1;
    this._tickLedger.lastProcessedTick = msg.scheduledTick;
}

// Accessor for debug/HU-TEST
getTickLedger() {
    return { ...this._tickLedger };
}
```

---

## 5. StateHash Definíció és Sampling

### Jelenlegi Állapot
- ⚠️ `hashState()` - float.toFixed(6) használ
- ❌ Integer-only hash NINCS
- ❌ Sampling szabály (every N tick) NINCS
- ❌ Mezők listája NEM explicit

### Szükséges Specifikáció
```javascript
// STATE HASH SPECIFICATION v1.0
// FROZEN - Do not change after Slice 2 launch

const STATE_HASH_CONFIG = {
    version: 1,

    // Hash calculation interval
    sampleEveryNTicks: 60,  // ~3 seconds at 20Hz

    // Fields included in hash (explicit whitelist)
    includedFields: {
        tickCount: true,
        units: {
            id: true,
            position: { precision: 1000 },  // Multiply by 1000, floor to int
            health: true
        }
    }
};

function computeIntegerHash(state) {
    let hash = state.tickCount;

    for (const unit of state.units) {
        hash ^= unit.id;
        hash ^= Math.floor(unit.position.x * 1000);
        hash ^= Math.floor(unit.position.y * 1000);
        hash ^= Math.floor(unit.position.z * 1000);
        hash ^= unit.health;
        hash = (hash * 31) | 0;  // Force 32-bit integer
    }

    return (hash >>> 0).toString(16);  // Unsigned hex
}
```

### Döntés Szükséges
- [ ] Sample interval: 60 ticks? 20 ticks?
- [ ] Position precision: *1000 (mm)? *100 (cm)?
- [ ] Include velocity? commands?

---

## 6. Choke Point Garancia

### Jelenlegi Állapot
- ✅ `InputClosure` skill létezik
- ⚠️ Nincs runtime assertion
- ❌ Audit nem történt M07-re

### Szükséges Intézkedések

```javascript
// In Game.js or SimLoop.js - Runtime invariant check
if (process.env.NODE_ENV !== 'production') {
    // DEBUG MODE: Verify no state mutation outside approved paths
    const APPROVED_MUTATORS = [
        '_processInputCommands',
        'applySnapshot'
    ];

    // Proxy-based detection (dev only)
    // ... implementation
}
```

### Audit Checklist
- [ ] Grep: `this.units` mutation outside approved
- [ ] Grep: `globalCommandQueue.enqueue` calls (should only be InputFactory/SessionManager)
- [ ] Grep: `simLoop.tickCount =` (should only be snapshot apply)

---

## 7. Message Size / Batch Limit Policy

### Jelenlegi Állapot
- ❌ MAX_COMMANDS_PER_BATCH - NEM definiált
- ❌ MAX_QUEUE_SIZE - NEM definiált
- ❌ Truncation/drop counter - NINCS

### Szükséges Konstansok
```javascript
// In SessionManager.js or constants file
const BATCH_LIMITS = {
    MAX_COMMANDS_PER_BATCH: 50,     // Drop/warn if exceeded
    MAX_QUEUE_SIZE: 200,            // Reject new if exceeded
    MAX_MESSAGE_BYTES: 64 * 1024,   // 64KB (Supabase limit)
    SNAPSHOT_WARN_SIZE: 80 * 1024,  // Log warning
    SNAPSHOT_MAX_SIZE: 100 * 1024   // Reject/compress
};

// Enforcement in sendCmdBatch:
if (this.inputBuffer.length > BATCH_LIMITS.MAX_COMMANDS_PER_BATCH) {
    console.warn(`[SM] Batch truncated: ${this.inputBuffer.length} > ${BATCH_LIMITS.MAX_COMMANDS_PER_BATCH}`);
    this._debugCounters.batchTruncatedCount++;
    this.inputBuffer = this.inputBuffer.slice(0, BATCH_LIMITS.MAX_COMMANDS_PER_BATCH);
}

// Enforcement in _handleCmdBatch:
if (globalCommandQueue.pendingCount >= BATCH_LIMITS.MAX_QUEUE_SIZE) {
    console.error(`[SM] Queue full, dropping batch`);
    this._debugCounters.batchDroppedQueueFull++;
    return;
}
```

---

## 8. Logging Tiltások és Performance Szabályok

### Jelenlegi Állapot
- ❌ Per-tick logging szabály NINCS
- ❌ Ring buffer NINCS
- ❌ Lint rule NINCS

### Szükséges Szabályok

```javascript
// LOGGING POLICY - M07+
//
// FORBIDDEN in SimLoop.step(), _processInputCommands():
// - console.log() per tick
// - JSON.stringify() per tick
//
// ALLOWED:
// - Sampled logging (every N ticks)
// - Error logging (always)
// - Meta-only logging (counts, not payloads)

// Ring buffer implementation
class RingBufferLog {
    constructor(maxSize = 100) {
        this._buffer = [];
        this._maxSize = maxSize;
    }

    log(category, message, data = null) {
        this._buffer.push({
            t: Date.now(),
            c: category,
            m: message,
            d: data
        });
        if (this._buffer.length > this._maxSize) {
            this._buffer.shift();
        }
    }

    dump() {
        return [...this._buffer];
    }

    clear() {
        this._buffer = [];
    }
}

// Usage
const netLog = new RingBufferLog(100);
netLog.log('BATCH', 'recv', { seq: msg.batchSeq, cmds: msg.commands.length });

// Sampled logging helper
let _sampleCounter = 0;
function logSampled(message, data, sampleRate = 60) {
    if (++_sampleCounter % sampleRate === 0) {
        console.log(message, data);
    }
}
```

### ESLint Rule (Optional)
```json
{
    "rules": {
        "no-restricted-syntax": [
            "error",
            {
                "selector": "CallExpression[callee.object.name='console'][callee.property.name='log']",
                "message": "Use ringBufferLog or logSampled instead of console.log in SimCore"
            }
        ]
    }
}
```

---

## Összefoglaló - Prioritás

| Prioritás | Téma | Slice 1 | Slice 2 |
|-----------|------|---------|---------|
| **P0** | Host INPUT_CMD validáció | ⬜ KELLENE | ✅ KELL |
| **P0** | Batch/Queue limits | ⬜ KELLENE | ✅ KELL |
| **P1** | StateHash integer-only | ⬜ Optional | ✅ KELL |
| **P1** | Tick ledger strukturált | ⬜ Optional | ✅ KELL |
| **P1** | Command canonicalization | ⬜ Optional | ✅ KELL |
| **P2** | Snapshot round-trip test | ⬜ Optional | ✅ KELL |
| **P2** | Logging policy | ⬜ Optional | ✅ KELL |
| **P2** | Choke point audit | ⬜ Optional | ✅ KELL |

---

## Döntések Antigravity-nek

1. **Position precision**: `*1000` (mm) vagy `*100` (cm)?
2. **StateHash sample rate**: 60 tick vagy 20 tick?
3. **MAX_COMMANDS_PER_BATCH**: 50 vagy más?
4. **Slice 1-ben implementáljuk P0-kat?**

---

*Dokumentum: M07_BEBETONOZANDOK.md*
*Szerző: Claude Orchestrator*
*Dátum: 2026-02-05*
