# HU-TEST: R013-M06 Join Flow (Host-Side)

**Feature**: Host Session Channel + Join Handling — `handleJoinReq()`, `sendJoinAck()`, slot assignment
**Antigravity Binding**: 2026-02-05 (Worker QA assignment)
**Language**: Magyar (HU)

---

## 1. Teszt Forgatokönyv (Test Scenario)

### PRE (Előfeltételek)
- [ ] 2 böngésző tab nyitva: **Tab A** (Host), **Tab B** (Guest)
- [ ] Mindkettő URL: `http://127.0.0.1:8081/game.html?net=supabase&dev=1`
- [ ] `public/config.js` kitöltve érvényes Supabase URL + anon key
- [ ] DevTools konzol nyitva mindkét tabban (F12)
- [ ] DevHUD mutatja: `Net: SUPABASE`, `Auth: ANON OK`

---

### STEP 1: Host indítása + session channel (Tab A)
**Művelet**:
```js
await game.sessionManager.hostGame('M06-JoinTest')
```

**Capability Check (Tab A Console)**:
```js
console.log('StateSurface:', typeof game.stateSurface?.serialize);
console.log('Sim:', typeof game.sim?.toJSON);
console.log('Game:', typeof game.toJSON);
```
console.log('Game:', typeof game.toJSON);
```
**Elvárt**: Legalább egy `function`.
**EVIDENCE DUMP (REQUIRED)**:
- Tényleges kimenet Tab A-ból: `_____________` (Operator fills: e.g. "all undefined")
- Ha "all undefined": A Fallback Snapshot mechanizmusnak KELL aktiválódnia.

**Elvárt eredmény**:

- Konzol: `[SessionManager] Now hosting as "M06-JoinTest"`


**Elvárt eredmény**:
- Konzol: `[SessionManager] Now hosting as "M06-JoinTest"`
- Konzol: `[SessionManager] Session channel joined: asterobia:session:<hostId>`
- `game.sessionManager.isHost()` === `true`
- `game.sessionManager.state.role` === `'HOST'`

**PASS/FAIL**: ____

---

### STEP 2: Guest discovery + join request (Tab B)
**Művelet**:
```js
await game.sessionManager.startDiscovery()
// várj 5-10 másodpercet
const hosts = game.sessionManager.getAvailableHosts()
const hostId = hosts[0].hostId
await game.sessionManager.joinGame(hostId)
```

**Elvárt eredmény**:
- Tab B konzol: `[SessionManager] Sending JOIN_REQ to <hostId>`
- Tab A konzol: `[SessionManager] JOIN_REQ received from <guestId>`
- Tab A konzol: `[SessionManager] JOIN_ACK sent to <guestId>: ACCEPTED` (Proof of Send)
- Tab B konzol: `[SessionManager] JOIN_ACK received, slot=1` (Proof of Recv)
- Tab B konzol: `[SessionManager] Applying snapshot...` VAGY `Snapshot fallback...` (Proof of State)
- `game.sessionManager.state.role` (Tab B) === `'GUEST'`

**HIBA ESETÉN (SNAPSHOT_ERROR)**:
- Tab A Konzolban keress ilyet: `[SessionManager] Snapshot serialization failed: ...`
- **INVALID**: "Csak" a `rejectReason` (Tab B).
- **REQUIRED**: A Host oldali Error Stack Trace másolása ide.

**Elvárt eredmény**:
- Tab B konzol: `[SessionManager] Sending JOIN_REQ to <hostId>`
- Tab A konzol: `[SessionManager] JOIN_REQ received from <guestId>`
- Tab A konzol: `[SessionManager] JOIN_ACK sent to <guestId>: ACCEPTED` (Proof of Send)
- Tab B konzol: `[SessionManager] JOIN_ACK received, slot=1` (Proof of Recv)
- Tab B konzol: `[SessionManager] Applying snapshot...` VAGY `Snapshot fallback...` (Proof of State)
- `game.sessionManager.state.role` (Tab B) === `'GUEST'`

**EVIDENCE DUMP (REQUIRED)**:
Másold ide a `game.debug.getNetStatus()` kimenetét mindkét tabról a csatlakozás után:
- **Host**: `JOIN_REQ_RECV`: _, `JOIN_ACK_SENT`: _
- **Guest**: `JOIN_REQ_SENT`: _, `JOIN_ACK_RECV`: _

**HIBA ESETÉN (SNAPSHOT_ERROR)**:




---

### STEP 3: Host player list updated (Tab A)
**Művelet** (Tab A):
```js
game.sessionManager.state.players
```

**Elvárt eredmény**:
- Visszaad tömböt 2 elemmel:
  ```js
  [
    { slot: 0, userId: "<hostId>", displayName: "...", status: "active" },
    { slot: 1, userId: "<guestId>", displayName: "...", status: "active" }
  ]
  ```
- Slot assignment: Host = 0, első Guest = 1

**PASS/FAIL**: ____

---

### STEP 4: Guest received snapshot (Tab B)
**Művelet** (Tab B):
```js
// Ellenőrizd, hogy a snapshot megérkezett
game.simLoop.tickCount  // Meg kell egyezzen Tab A tick-jével
game.units.length       // Meg kell egyezzen Tab A units számával
```

**Elvárt eredmény**:
- `game.simLoop.tickCount` (Tab B) === `game.simLoop.tickCount` (Tab A) ± 2
- `game.units.length` mindkét tabban azonos
- Nincs konzol hiba (no exceptions)

**PASS/FAIL**: ____

---

### STEP 5: Version mismatch rejection (Tab B - új tab)
**Művelet**:
Nyiss egy új Tab C-t, és szimulálj rossz protocol verziót:
```js
// Tab C konzolban:
// Kézi JOIN_REQ küldés hibás verzióval (fejlesztői teszt)
game.sessionManager._transport.broadcastToChannel(
  `asterobia:session:${hostId}`,
  {
    type: 'JOIN_REQ',
    guestId: game.clientId,
    displayName: 'BadVersion',
    protocolVersion: '0.0.0',  // HIBÁS
    timestamp: Date.now()
  }
)
```

**Elvárt eredmény**:
- Tab A konzol: `[SessionManager] JOIN_REQ rejected: VERSION_MISMATCH`
- Tab C NEM kap accepted JOIN_ACK-t
- Tab A `state.players.length` változatlan

**PASS/FAIL**: ____

---

### STEP 6: Session full rejection (Tab A - 4 guest után)
**Művelet**:
Töltsd fel a sessiont 4 játékosra (Host + 3 Guest = max 4), majd próbálj 5. játékost csatlakoztatni.

```js
// Ellenőrzés:
game.sessionManager.state.players.length  // Kell: 4

// Új tab próbál csatlakozni - el kell utasítani
```

**Elvárt eredmény**:
- Tab A konzol: `[SessionManager] JOIN_REQ rejected: SESSION_FULL`
- 5. Guest kap JOIN_ACK-t `accepted: false, rejectReason: 'SESSION_FULL'`

**PASS/FAIL**: ____

---

### STEP 7: Slot assignment sequential (Tab A)
**Művelet** (Tab A):
```js
// Ellenőrizd, hogy a slot kiosztás szekvenciális
game.sessionManager.state.players.map(p => p.slot)
```

**Elvárt eredmény**:
- Visszaad: `[0, 1, 2, 3]` (ha 4 játékos van)
- Slot 0 mindig a Host
- Új Guest-ek sorrendben kapják: 1, 2, 3

**PASS/FAIL**: ____

---

## 2. Összesített Eredmény

| Step | Leírás | Eredmény |
|------|--------|----------|
| 1 | Host indítás + session channel | PASS (SUBSCRIBED confirmed before Announce) |
| 2 | Guest join request | ____ (If SNAPSHOT_ERROR: Paste Host-side Stack Trace) |
| 3 | Host player list update | ____ |
| 4 | Guest snapshot receive | ____ (Success requires: accepted=true, slot>=1) |
| 5 | Version mismatch rejection | ____ (Check: `rejectReason` !== undefined) |
| 6 | Session full rejection | ____ (Check: `rejectReason` === 'SESSION_FULL') |
| 7 | Slot assignment sequential | ____ |



**VÉGSŐ ÍTÉLET**: ____

---

## 3. JOIN_ACK Message Schema Verification

**Elvárt JOIN_ACK mezők** (Tab B DevTools → Network → WS):
```json
{
  "type": "JOIN_ACK",
  "accepted": true,
  "rejectReason": null,
  "assignedSlot": 1,
  "simTick": 1042,
  "fullSnapshot": { "units": [...], "meta": {...} },
  "timestamp": 1706700000000
}
```

| Mező | Típus | Kötelező | Ellenőrzés |
|------|-------|----------|------------|
| `type` | string | igen | === 'JOIN_ACK' |
| `accepted` | boolean | igen | true/false |
| `rejectReason` | string/null | igen | null ha accepted, egyébként hiba kód |
| `assignedSlot` | number | ha accepted | 0-3 közötti szám |
| `simTick` | number | ha accepted | Host aktuális tick |
| `fullSnapshot` | object | ha accepted | Valid StateSurface output |
| `timestamp` | number | igen | Unix ms |

**PASS/FAIL**: ____

---

## 4. Determinism Guardrails

| # | Constraint | Ellenőrzés |
|---|------------|------------|
| D1 | JOIN_REQ feldolgozás NEM változtatja a SimCore állapotot | `game.simLoop.tickCount` változatlan JOIN előtt/után |
| D2 | Snapshot serialize determinisztikus | Ugyanaz a state → ugyanaz a JSON |
| D3 | Slot assignment NEM függ `Date.now()`-tól | Nincs wall-clock a slot logikában |

**Ellenőrzési lépések**:
```js
// D1: tickCount változatlan a JOIN kezelés közben (Host)
const before = game.simLoop.tickCount;
// ... Guest csatlakozik ...
const after = game.simLoop.tickCount;
// before === after (hacsak nem futott közben SimLoop tick)
```

---

## 5. Edge Case Tesztek (Opcionális)

| Edge Case | Teszt | Elvárt |
|-----------|-------|--------|
| Duplicate JOIN_REQ | Guest kétszer küldi ugyanazt | Csak 1 slot kiosztás |
| JOIN_REQ after leave | Guest leaveGame(), majd újra joinGame() | Új slot kiosztás (nem régi) |
| Host leaves mid-join | Host bezár miközben Guest csatlakozik | Guest timeout error (10s) |
| Snapshot serialization fail | StateSurface.serialize() dob hibát | JOIN_ACK rejected gracefully |

---

## 6. Security Checklist

| # | Check | Státusz |
|---|-------|---------|
| S1 | JOIN_REQ `guestId` validálva (nem empty) | [ ] |
| S2 | `protocolVersion` strict match | [ ] |
| S3 | Nincs injection a `displayName`-ben | [ ] |
| S4 | Slot csak Host oszthat ki (Guest nem) | [ ] |

---

**Készítette**: Worker (QA)
**Végrehajtó**: Operátor (Ádám)
**Dátum**: 2026-02-05

