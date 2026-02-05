# HU-TEST: R013-M07 Game Loop Slice 1 (Transport)

**Feature**: Host `CMD_BATCH` Broadcast & Guest Queuing (No Execution)
**Antigravity Binding**: Slice 1 Closure Gate
**Language**: Magyar (HU)

---

## 1. Teszt Forgatokönyv (Test Scenario)

### PRE (Előfeltételek)
- [ ] 2 böngésző tab nyitva: **Tab A** (Host), **Tab B** (Guest)
- [ ] URL: `http://127.0.0.1:8081/game.html?net=supabase&dev=1`
- [ ] DevTools Console nyitva mindkét tabban.

### STEP 1: Session Setup (M06 Recap)
**Művelet**:
1. Tab A: `game.sessionManager.hostGame('M07-Test')`
2. Tab B: `game.sessionManager.joinGame(hostId)`

**Elvárt**:
- Host: `role='HOST'`
- Guest: `role='GUEST'`, `mySlot=1`
- Handshake logs (JOIN_REQ/ACK) rendben.

---

### STEP 2: Command Injection (Simulated Input)
**Művelet**:
Mivel nincs UI binding, manuálisan injektálunk inputot a Host-on.
Tab A (Host Console):
```js
// Host szimulál egy inputot (amit be kell csomagolnia batchbe)
// Jelenleg M07 Slice1-ben ez automatikus lehet a SimLoop-ban,
// VAGY ha a SimLoop még nem generál batchet, manuális hívás:
// game.sessionManager.sendCmdBatch(...)
```
*Megjegyzés: Ha a SimLoop M07-ben már automatikusan küld üres vagy heartbeat batcheket, akkor csak várni kell.*

**Elvárt (Logs)**:
- **Host**: `[SM] CMD_BATCH sent: seq=1, tick=..., cmds=...`
- **Guest**: `[SM] CMD_BATCH recv: seq=1, tick=...`
- **Guest**: `[SM] Enqueued batch 1`

**EVIDENCE DUMP (REQUIRED)**:
Futtasd: `game.sessionManager.getDebugNetStatus()`
- **Host**:
  - `cmdBatchSentCount`: `______` (Should be > 0)
- **Guest**:
  - `cmdBatchRecvCount`: `______` (Should match Sent roughly)
  - `cmdEnqueuedCount`: `______` (Should > 0)
  - `cmdDroppedLateCount`: `0`
  - `cmdDroppedDupeCount`: `0`

---

### STEP 3: Ordering & Gaps (Optional Stress Test)
**Művelet (Guest Console)**:
Szimulálj egy gap-et (kézzel meghívva a handlert):
```js
// Tab B Guest
const batchGap = { type: 'CMD_BATCH', batchSeq: 999, scheduledTick: 10000, commands: [] };
game.sessionManager.onMessage(batchGap);
```

**Elvárt**:
- Konzol Warning: `[SessionManager] Gap detected...`
- `netStatus.gapCount` (ha van ilyen) növekszik.

---

### 4. VÉGSŐ ÍTÉLET

**PASS Kritériumok**:
1.  **Transport**: A Host által küldött batch megérkezik a Guest-hez.
2.  **Queue**: A Guest queue mérete nő (mivel nincs execution, ami ürítené, vagy ha van, akkor is látszik a flow).
3.  **Logs**: Nincs "Late" drop normál működés mellett (LAN/Localhost).

**Döntés**: PASS / FAIL (?)
**Dátum**: 2026-02-xx
