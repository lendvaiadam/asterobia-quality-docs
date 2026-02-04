# HU-TEST: R013-M05 Guest Lobby Listen

**Feature**: Guest Discovery — `startDiscovery()`, `getAvailableHosts()`, stale pruning
**Antigravity Binding**: 2026-02-04 (Pre-WO Double-Check ACK)
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

### STEP 1: Host indítása (Tab A)
**Művelet**:
```js
await game.sessionManager.hostGame('M05-TestHost')
```

**Elvárt eredmény**:
- Konzol: `[SessionManager] Now hosting as "M05-TestHost"`
- `game.sessionManager.isHost()` === `true`
- `game.sessionManager.announceInterval` !== `null`

**PASS/FAIL**: ____

---

### STEP 2: Guest Discovery indítása (Tab B)
**Művelet**:
```js
await game.sessionManager.startDiscovery()
```

**Elvárt eredmény**:
- Konzol: `[SessionManager] Discovery started`
- `game.sessionManager._discoveryActive` === `true`

**PASS/FAIL**: ____

---

### STEP 3: Host lista lekérése (Tab B)
**Művelet** (várj 5-10 másodpercet, majd):
```js
game.sessionManager.getAvailableHosts()
```

**Elvárt eredmény**:
- Visszaad egy tömböt 1 elemmel
- Elem tartalma:
  ```js
  {
    hostId: "<Tab A clientId>",
    sessionName: "M05-TestHost",
    playerCount: 1,
    maxPlayers: 4,
    mapSeed: "<bármi>",
    lastSeenAt: <recent timestamp>
  }
  ```
- NEM tartalmaz nyers üzenet mezőket (`type`, `protocolVersion`, `timestamp`)

**PASS/FAIL**: ____

---

### STEP 4: Host bezárása (Tab A)
**Művelet**:
- Zárd be Tab A-t (vagy futtasd: `game.sessionManager.leaveGame()`)

**Elvárt eredmény**:
- Tab A bezárva vagy leaveGame() lefutott

**PASS/FAIL**: ____

---

### STEP 5: Stale prune ellenőrzés (Tab B)
**Művelet** (várj **15+ másodpercet**, majd Tab B-ben):
```js
game.sessionManager.getAvailableHosts()
```

**Elvárt eredmény**:
- Visszaad **üres tömböt** `[]`
- A host eltűnt, mert 15 másodpercnél régebben láttuk (stale timeout)

**PASS/FAIL**: ____

---

### STEP 6: Discovery leállítása (Tab B)
**Művelet**:
```js
game.sessionManager.stopDiscovery()
```

**Elvárt eredmény**:
- Konzol: `[SessionManager] Discovery stopped`
- `game.sessionManager._discoveryActive` === `false`
- `game.sessionManager.availableHosts.size` === `0`

**PASS/FAIL**: ____

---

## 2. Összesített Eredmény

| Step | Leírás | Eredmény |
|------|--------|----------|
| 1 | Host indítás | ____ |
| 2 | Discovery indítás | ____ |
| 3 | Host lista (1 elem) | ____ |
| 4 | Host bezárás | ____ |
| 5 | Stale prune (üres lista) | ____ |
| 6 | Discovery leállítás | ____ |

**VÉGSŐ ÍTÉLET**: ____

---

## 3. Low-End Performance Checklist

Ezek a teljesítmény követelmények biztosítják, hogy lassabb gépeken is jól fusson:

| # | Ellenőrzés | Státusz |
|---|------------|---------|
| P1 | Nincs háttér timer a discovery-hez (lazy prune only) | [ ] |
| P2 | `getAvailableHosts()` nem allokál új objektumokat feleslegesen | [ ] |
| P3 | Max 50 host limit FIFO eviction-nel (nem nő korlátlanul) | [ ] |
| P4 | Nincs `setInterval` a stale check-hez | [ ] |
| P5 | HostEntry tárolja csak a szükséges mezőket (6 mező, nem 10+) | [ ] |

**Ellenőrzési módszer**:
```js
// Nincs háttér timer
game.sessionManager._pruneTimer === undefined  // PASS

// Max 50 host
// (nehéz tesztelni 50 host nélkül, de kód review-val ellenőrizhető)
```

---

## 4. Determinism Guardrails

A `availableHosts` **META-GAME STATE** — nem érintheti a szimulációt.

| # | Constraint | Ellenőrzés |
|---|------------|------------|
| D1 | `availableHosts` NEM szerepel `toJSON()`-ban | `game.sessionManager.toJSON()` nem tartalmaz `availableHosts` kulcsot |
| D2 | Discovery kód NEM hív `CommandQueue` metódust | Kód review |
| D3 | Discovery kód NEM hív `SimLoop` metódust | Kód review |
| D4 | `startDiscovery()` NEM változtat SimCore állapotot | `game.simLoop.tickCount` változatlan discovery előtt/után |

**Ellenőrzési lépések**:
```js
// D1: toJSON() nem tartalmaz availableHosts-t
const json = game.sessionManager.toJSON();
'availableHosts' in json  // MUST be false

// D4: tickCount változatlan
const before = game.simLoop.tickCount;
await game.sessionManager.startDiscovery();
const after = game.simLoop.tickCount;
before === after  // PASS (no forced tick)
```

---

## 5. Edge Case Tesztek (Opcionális)

| Edge Case | Teszt | Elvárt |
|-----------|-------|--------|
| Duplicate hostId | Ugyanaz a host kétszer announce-ol | Map felülírja, csak 1 entry |
| Protocol mismatch | Host más `protocolVersion`-t küld | Guest **droppolja**, nem jelenik meg |
| Malformed message | Hiányzó `hostId` vagy `sessionName` | Guest **droppolja** |
| Self-filter | Guest saját magát hostolva is discovery-zik | Saját host NEM jelenik meg |

---

**Készítette**: Worker (QA)
**Dátum**: 2026-02-04
