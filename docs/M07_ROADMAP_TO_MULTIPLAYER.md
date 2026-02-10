# M07 Roadmap: Path to Working Multiplayer

**Cél:** "Két kliens ugyanazt látja, ugyanazok a parancsok ugyanúgy hajtódnak végre"
**Státusz:** DRAFT - Antigravity egyeztetés szükséges
**Dátum:** 2026-02-05

---

## Milestone Definíció

| Milestone | Jelentés | Verifikáció |
|-----------|----------|-------------|
| **M06 PASS** | Guest csatlakozik, snapshot megérkezik | ✅ DONE |
| **M07 Slice1 PASS** | CMD_BATCH transport működik, queue nő | ⏳ IN PROGRESS |
| **M07 Slice2 PASS** | Parancsok végrehajtódnak, state egyezik | 🔜 NEXT |
| **"Multiplayer Működik"** | 2 kliens ugyanazt látja realtime | 🎯 TARGET |

---

## Slice 1: Transport Pipeline

### Valós Státusz (Őszinte)

| Feladat | Státusz | Megjegyzés |
|---------|---------|------------|
| M07 Spec (CMD_BATCH schema) | ✅ DONE | `R013_M07_GAME_LOOP.md` |
| HU-TEST sablon | ❌ **HIÁNYZIK** | Létre kell hozni |
| Host `sendCmdBatch()` | ✅ DONE | batchSeq, scheduledTick |
| Guest `_handleCmdBatch()` | ✅ DONE | Dedup, stale, gap, enqueue |
| Guest→Host `_handleInputCmd()` | ❌ **STUB** | Nincs slot/sender validáció |
| CommandQueue ID preservation | ✅ DONE | Host ID megőrzés |
| Safety Gate flag | ✅ DONE | `ENABLE_COMMAND_EXECUTION=false` |
| Debug counters | ✅ DONE | `getDebugNetStatus()` |
| NetworkDebugPanel | ✅ DONE | UI overlay |
| Ring buffer logging | ❌ **HIÁNYZIK** | Per-tick spam kockázat |
| MAX_BATCH/QUEUE limits | ❌ **HIÁNYZIK** | Nincs guardrail |
| Unit tests | ⚠️ PARTIAL | CMD_BATCH tesztek megvannak |

### Hiányzó Slice1 Feladatok (P0)

```
┌─────────────────────────────────────────────────────────────────┐
│  SLICE 1 GAPS - MUST FIX BEFORE HU-TEST                        │
├─────────────────────────────────────────────────────────────────┤
│  1. _handleInputCmd() implementáció                             │
│     - Slot/sender validáció                                     │
│     - Command type whitelist                                    │
│     - Dedup by seq                                              │
│     - Buffer for CMD_BATCH                                      │
│                                                                 │
│  2. HU-TEST sablon létrehozása                                  │
│     - Evidence mezők definiálása                                │
│     - Console dump formátum                                     │
│     - PASS/FAIL kritériumok                                     │
│                                                                 │
│  3. Batch/Queue limit konstansok                                │
│     - MAX_COMMANDS_PER_BATCH = 50                               │
│     - MAX_QUEUE_SIZE = 200                                      │
│     - Truncation counter                                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Slice 1 → Slice 2 Átmenet

### Slice 1 Lezárás Feltételei

- [ ] `_handleInputCmd()` implementálva és tesztelve
- [ ] HU-TEST sablon kész
- [ ] Batch/Queue limitek beállítva
- [ ] HU-TEST PASS (Ádám): BatchSent == BatchRecv, Queue > 0
- [ ] Antigravity Audit PASS
- [ ] Merge + SHA-pinned receipt

### Slice 2 Előfeltételek (Bebetonozandók)

| Téma | Slice 1 | Slice 2 |
|------|---------|---------|
| Snapshot round-trip teszt | Optional | **REQUIRED** |
| Command canonicalization | Optional | **REQUIRED** |
| StateHash integer-only | Optional | **REQUIRED** |
| Tick ledger strukturált | Optional | **REQUIRED** |
| Choke point audit | Optional | **REQUIRED** |
| Logging policy | Optional | **REQUIRED** |

---

## Slice 2: Execution Pipeline

### Feladatok

| # | Feladat | Leírás |
|---|---------|--------|
| S2.1 | `ENABLE_COMMAND_EXECUTION = true` | Flag aktiválás |
| S2.2 | Execute-at-tick logika | `scheduledTick` alapján flush |
| S2.3 | Strict gap policy | Gap → STALL (nem warn) |
| S2.4 | Strict stale policy | Stale → ERROR (nem drop) |
| S2.5 | StateHash comparison | Host vs Guest hash egyezés |
| S2.6 | Snapshot reliability | Real serialize/deserialize |
| S2.7 | HU-TEST Slice2 | Units move in sync |

### Slice 2 Verifikáció

```
HU-TEST PASS Kritérium:
┌─────────────────────────────────────────────────────────────────┐
│  1. Host MOVE parancs → Guest-en is mozog az egység            │
│  2. StateHash(Host, tick=100) == StateHash(Guest, tick=100)    │
│  3. Nincs "desync detected" hiba                               │
│  4. 60 másodperc stabil játék crash nélkül                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Teljes Roadmap Vizualizáció

```
M06 JOIN PASS (✅)
    │
    ▼
┌───────────────────────────────────────┐
│         M07 SLICE 1                    │
│  "Transport Pipeline"                  │
├───────────────────────────────────────┤
│  ✅ CMD_BATCH send/receive             │
│  ✅ Ordering + dedup                   │
│  ✅ Debug counters                     │
│  ❌ INPUT_CMD validation   ◄── GAP    │
│  ❌ HU-TEST template       ◄── GAP    │
│  ❌ Batch/Queue limits     ◄── GAP    │
├───────────────────────────────────────┤
│  Gate: HU-TEST PASS (Queue grows)     │
└───────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────┐
│         M07 SLICE 2                    │
│  "Execution & Determinism"             │
├───────────────────────────────────────┤
│  ⬜ Execute-at-tick                    │
│  ⬜ Strict gap/stale policy            │
│  ⬜ StateHash comparison               │
│  ⬜ Snapshot reliability               │
├───────────────────────────────────────┤
│  Gate: HU-TEST PASS (State matches)   │
└───────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────┐
│     🎯 "MULTIPLAYER MŰKÖDIK"          │
│  Két kliens ugyanazt látja            │
│  Ugyanazok a parancsok végrehajtódnak │
└───────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────┐
│         M07b / M08                     │
│  "Resync & Recovery"                   │
├───────────────────────────────────────┤
│  ⬜ Gap → resync flow                  │
│  ⬜ Reconnect handling                 │
│  ⬜ Loss tolerance                     │
└───────────────────────────────────────┘
```

---

## Döntések Antigravity-nek

### 1. Slice 1 Gap Pótlás
Implementáljuk most a hiányzó elemeket (INPUT_CMD, limits, HU-TEST sablon)?
- **Opció A:** Igen, Slice 1 nem PASS amíg nincs
- **Opció B:** HU-TEST nélkül haladunk, visszatérünk

### 2. Bebetonozandók Időzítése
Mikor implementáljuk a P1 elemeket (StateHash, canonical, etc.)?
- **Opció A:** Slice 1 és 2 között
- **Opció B:** Slice 2-vel párhuzamosan

### 3. task.md Korrekció
Frissítsem a task.md-t az őszinte státuszra?
- **Opció A:** Igen, most (GAP-ek jelölve)
- **Opció B:** Nem, először implementálás

---

## Worker Elosztás - Frissített

| Worker | Slice 1 GAP Fix | Slice 2 |
|--------|-----------------|---------|
| **BE** | `_handleInputCmd()`, Limits | Execute-at-tick |
| **Protocol** | - | StateHash, Canonical |
| **QA** | HU-TEST sablon | Slice 2 tesztek |
| **W7** | - | Determinism verification |
| **FE** | - | State diff overlay |
| **RF** | task.md korrekció | Cleanup |

---

*Dokumentum: M07_ROADMAP_TO_MULTIPLAYER.md*
*Szerző: Claude Orchestrator*
*Review: Antigravity egyeztetés szükséges*
