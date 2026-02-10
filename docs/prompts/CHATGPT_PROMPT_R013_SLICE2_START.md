# ChatGPT Indító Prompt: R013 Slice 2 (Execution & Determinism)

**Role**: Senior Gameplay Engineer / Architect
**Project**: Asterobia (RTS, Three.js, Supabase Multiplayer)
**Milestone**: R013 (Multiplayer Handshake & Game Loop)
**Current Phase**: Slice 2 (Execution Pipeline)

---

## 1. Context & Status
A **Slice 1 (Transport Pipeline)** fázis sikeresen lezárult.
*   ✅ **Kész**: `MessageSerializer` rendben, `SessionManager` kezeli a csatlakozást.
*   ✅ **Kész**: A host `CMD_BATCH`-eket küld, a kliensek megkapják és sorba rendezik (`CommandQueue`).
*   ⚠️ **Jelenlegi Állapot**: `ENABLE_COMMAND_EXECUTION = false`. A parancsok beérkeznek, de a szimuláció még nem hajtja végre őket.
*   **Cél**: A végrehajtás engedélyezése (`true`), de csak szigorú determinisztikus szabályok mellett.

## 2. A Feladat (Immediate Task)
A te feladatod az **"Execution Pipeline" élesítése** és a **Hálózati Stabilitás** garantálása.
Az alábbi csomagot ("Package 1: Networking Core") kell implementálnod:

### A. Strict Gap Policy (Szigorú Hiánykezelés)
*   **Probléma**: Jelenleg a rendszer csak figyelmeztet (`warn`), ha kimarad egy `batchSeq` (pl. 105 után 107 jön), de továbbmegy. Ez RTS-ben tilos (desync).
*   **Követelmény**:
    1.  Ha `msg.seq > nextExpectedSeq`: **STALL** (A szimuláció megáll).
    2.  A beérkező csomagot puffereljük (`pendingBatches`).
    3.  Azonnal küldjünk `RESEND_REQ { from: nextExpectedSeq }` üzenetet a Hostnak.
    4.  Ha a hiányzó csomag megérkezik, a szimuláció folytatódik (gyorsított ütemben, hogy utolérje magát).
*   **UI**: `Game.paused = true` és egy "Waiting for Server..." overlay megjelenítése.

### B. Active StateHash (Determinizmus Ellenőrzés)
*   **Probléma**: Nem tudjuk, ha a kliensek állapota eltér.
*   **Követelmény**:
    1.  A Host minden `CMD_BATCH`-be tegye bele a `stateHash`-t (az előző tick végén számolt hash).
    2.  A Guest a parancsok végrehajtása után számolja ki a saját hash-ét.
    3.  Ha `LocalHash !== RemoteHash`: **CRITICAL ERROR**.
    4.  Hiba esetén: `console.error` dump + Opcionálisan `DESYNC_REPORT` küldése.

### C. FOW Per-User (Többfelhasználós Köd)
*   **Jelenlegi**: Egy globális `FogOfWar` textúra van.
*   **Követelmény**:
    1.  A `FogOfWar` osztály kezeljen többet (pl. 4 db) `WebGLRenderTarget`-ből.
    2.  Minden unit csak a *saját tulajdonosa* (slot) textúrájára rajzoljon ("clear" a ködöt).
    3.  A Shader (`Planet.js`) kapja meg mind a 4 textúrát, és a renderelésnél döntse el, melyiket (vagy melyek unióját) mutatja a helyi játékosnak.

---

## 3. Fontos Szabályok (Constraints)
1.  **Choke Point**: Minden módosítás csak parancson keresztül történhet (`queue.enqueue`). Közvetlen `unit.position.x = ...` tilos!
2.  **No Ghost Driving**: A `SessionManager`-ben már van `controllerSlot` validáció. Ezt tartsd tiszteletben.
3.  **Performance**: A `StateHash` számítás ne legyen lassú (optimális rolling hash vagy ritkább mintavételezés).

## 4. Referencia Fájlok (Olvasd el őket!)
*   `docs/MULTIPLAYER_ROADMAP_R013.md` (A nagy terv)
*   `docs/R013_MULTIPLAYER_TASK_BREAKDOWN.md` (Konkrét technikai részletek)
*   `docs/Known_RISK_AREAS.md` (Game.js és Unit.js veszélyei)

**Indítás**: Kezdd a `Strict Gap Policy` implementálásával a `SessionManager.js`-ben!
