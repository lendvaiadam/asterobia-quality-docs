# Antigravity Briefing — Asterobia Multiplayer Status & Next Steps

> **From**: Claude Code Orchestrator
> **Date**: 2026-02-09
> **Branch**: `work/r013-buglist-docs`
> **Tests**: 455/455 PASS (22 test files)

---

## 1. Mi készült el (R013 Multiplayer)

### Transport Pipeline (Slice 1) — KÉSZ
- `MessageTypes.js` + `MessageSerializer.js`: 14 üzenettípus (HOST_ANNOUNCE, JOIN_REQ/ACK, CMD_BATCH, SEAT_REQ/ACK/RELEASE, HOST_LEAVE, GUEST_LEAVE, stb.)
- `SessionManager.js`: ~2000 sor — Host/Guest/Offline kezelés, lobby discovery, join flow, command batching
- `SessionState.js`: Role + slot + player tracking
- `SupabaseTransport`: Realtime channel-ek (lobby + session)

### Command Execution (Slice 2) — KÉSZ
- Guest is végrehajtja a parancsokat (`_guestExecutionEnabled = true`)
- CMD_BATCH broadcast: Host összegyűjti a parancsokat, tickenként elküldi
- StateHash sampling: 60 tickenként hash a sim-state-ről (debug logolás)
- SELECT/DESELECT lokális (nem megy hálózaton)
- MOVE/SET_PATH/CLOSE_PATH hálózaton keresztül

### Unit Authority (M07) — KÉSZ
- `selectedBySlot`: ki vezeti éppen (exclusive, null = üres)
- `ownerSlot`: kié gazdaságilag (utolsó beülő)
- `ownerHistory[]`: teljes tulajdonlási történet (slot, simTick, method)
- PIN rendszer: 1-9 számjegy, keypad overlay
- SEAT_REQ → Host validálja → SEAT_ACK/REJECT
- SEAT_RELEASE: deselect = broadcast, mindenki tudja hogy szabad
- OCCUPIED: ha valaki benne ül, mások nem ülhetnek be
- Host is respektálja az OCCUPIED-ot (nincs speciális jog)
- Tab szűrés: Guest csak a saját unitjait látja

### UI — KÉSZ
- JoinOverlay v2: single-screen, HOST GAME / JOIN GAME gombok, room code, player count
- Multiplayer HUD: jobb felső sarok (role, status, player count, room code)
- Debug Console: toggle gomb, consolidált panelek
- Seat Keypad: PIN bevitel overlay
- Indikátorok: lakat, OCCUPIED felirat, zöld pont (saját kijelölt unit)

### Host Migration — KÉSZ
- Host kilép → első Guest automatikusan HOST lesz
- HOST_LEAVE / GUEST_LEAVE üzenettípusok
- `_hostLastSeenAt` tracking + timeout detection

### Determinism Hardening (M08) — KÉSZ
- `Date.now()` → `simTick` csere (TypeBlueprint, Store, UnitTypeBinder)
- A* tie-breaking: determinisztikus (node index compare)
- `isKeyboardOverriding` clear on deselect
- PathPlanner debug alapból kikapcsolva
- Indikátor sprite-ok: `depthTest: true` (bolygó takarja)

### Guest Spawn — KÉSZ
- Guest csatlakozáskor kap 1 saját unitot
- Kamera a spawned unitra fókuszál

---

## 2. Mi van TERVBEN (következő lépések)

### 2.1 Strict Gap Policy (hálózati megbízhatóság)
- **Mi**: Ha CMD_BATCH szekvencia-szám hiányzik (pl. #5 megvan, #6 nincs, #7 megvan), a sim megáll és kéri az újraküldést
- **Miért**: RTS-ben 1 tick kiesés = desync, ami láthatatlanul szétválasztja a két kliens állapotát
- **Hogyan**: CMD_BATCH seq tracking, gap detection, stall + resend request

### 2.2 Aktív StateHash összehasonlítás
- **Jelenlegi**: Hash logolás 60 tickenként (debug only)
- **Szükséges**: Host elküldi a hash-t → Guest összehasonlítja → desync esetén RESYNC
- **Cél**: Azonnal detektálni, ha a két kliens mást lát

### 2.3 FOW Per-User (Fog of War átalakítás)
- **Jelenlegi**: Egy globális `FogOfWar` textúra, MINDEN unit vision-je belekerül
- **Szükséges**: Per-user (per-slot) explored textúra
  - Minden unit annak a usernek gyűjt "explored" területet, akinél éppen van
  - Ha a unit gazdát cserél: az új owner kap visiont, a régi megtartja amit eddig felderített
  - A felderített adat NEM vándorol a unittal
- **Meglévő renderer**: Gömbfelszíni shader (equirectangular projekció, 2048x2048 textúra) — EZT NEM BÁNTJUK
- **Módosítás**: Adatréteg: `exploredTarget` slot-onként + update logika owner-alapú

### 2.4 Open Bug Fixek
| # | Bug | Prioritás |
|---|-----|-----------|
| A1 | startDiscovery() nincs UI | P1 |
| A3 | Join timeout néha (Supabase race) | P2 |
| C1 | Relatív waypoints (Slice 2 elvileg megoldja) | P1 |
| C2 | Unit vizuális megkülönböztetés (owner tinting) | P2 |
| D3 | Egyenes vonal akadályon át (FOW design) | P2 |
| D4 | Waypoint pöttyök alapból látszanak | P3 |
| G1 | Dust partikli memóriaszivárgás | P2 |

### 2.5 Tesztelés
- Manuális dual-client teszt (két böngésző tab)
- Egyszerű, 12 éves szintű tesztforgatókönyv
- Későbbi: Playwright automatizált smoke test

---

## 3. Architektúra — fejben tartandó

### Multi-Asteroid jövőkép
- Minden regisztrált usernek saját aszteroida
- A unitok átrepülhetnek aszteroidák között (1 unittal utazás)
- Egy aszteroidán akár 50 user is lehet
- FOW per-user PER-ASTEROID (nem globális!)
- A "Host" szerepkör technikai (hálózati authority), NEM játékbeli
- Ideális jövő: backend (Supabase) a host, nem kliens

### Feature-ök (későbbi fázisok)
- Combat rendszer
- Resource rendszer
- Base building
- Research & Design & Production rendszer
- Backend-as-host (kliens host kiváltása)

---

## 4. Kérdések Antigravity-nek

1. **FOW per-user implementáció**: A jelenlegi shader 1 globális `exploredTarget`-et kezel. Per-user-hez slot-onként kellene külön textúra (4 slot = 4 × 2048x2048). Ez GPU memória szempontból ok, de bonyolítja a renderelést. Alternatíva: 1 textúra, de a shader-ben per-pixel tracking (melyik slot fedezte fel). Melyik irány tetszik?

2. **Strict Gap Policy**: A CMD_BATCH gap kezeléshez kell egy `RESEND_REQ` üzenettípus. Ha a Guest gap-et detektál, kéri az újraküldést. Eközben a sim megáll (stall). Ez a felhasználó számára "fagyás"-nak tűnhet rossz hálózaton. Alternatíva: lenient mód (továbbmegy, de logol). Legyen dev-toggle?

3. **C1 bug (Relatív waypoints)**: Slice 2 elvileg megoldja (mindkét kliens végrehajtja a parancsokat). De nem teszteltük manuálisan. Érdemes-e előbb tesztelni, mielőtt fixet írnánk?

4. **Owner tinting (C2)**: A unitok vizuális megkülönböztetéséhez emissive glow-t terveztünk (Kék=Host, Piros=Guest1, Zöld=Guest2, Sárga=Guest3). Ez a korábbi implementáció vissza lett vonva. Újra implementáljuk, vagy más vizuális jelzés legyen (pl. zászló, szín overlay, UI badge)?

5. **A jelenlegi kódbázis mennyire skálázható 50 user-re?** A SessionManager max 4 slot-ot kezel. A CMD_BATCH broadcast minden tickben megy. 50 user-rel ez hálózati bottleneck lehet. Mikor érdemes ezen gondolkodni?

---

## 5. Fájl referenciák

| Fájl | Szerepe |
|------|---------|
| `src/SimCore/multiplayer/SessionManager.js` | Központi multiplayer koordinátor (~2000 sor) |
| `src/SimCore/multiplayer/MessageTypes.js` | Üzenettípusok + sémák |
| `src/SimCore/multiplayer/MessageSerializer.js` | Encode/decode |
| `src/SimCore/multiplayer/SessionState.js` | Role + slot + player state |
| `src/Core/Game.js` | Fő játék loop, SM bekötés, unit management |
| `src/Core/InteractionManager.js` | Seat flow, OCCUPIED check, kattintás kezelés |
| `src/Entities/Unit.js` | Unit entitás, ownerSlot, selectedBySlot, ownerHistory |
| `src/World/FogOfWar.js` | Gömbfelszíni FOW shader renderer |
| `docs/BUGLIST.md` | Összes bug tracking |
| `docs/specs/ASTEROBIA_GAME_VISION.md` | Game vision specifikáció |
| `docs/MULTIPLAYER_ROADMAP_R013.md` | Multiplayer roadmap (M01-M14 + N01-N06) |
