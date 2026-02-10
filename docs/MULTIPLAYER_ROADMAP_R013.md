# R013 Multiplayer Roadmap & Action Plan

Ez a dokumentum összefoglalja a multiplayer fejlesztés jelenlegi állását és a következő kritikus lépéseket (R013 Milestone).

## 1. Executive Summary (Helyzetkép)

Jelenleg a **Slice 1 (Transport Pipeline)** fázis végén járunk.
*   ✅ **Kész**: A hálózati kommunikáció (parancsok küldése/fogadása) működik. A kliensek megkapják a szervertől a csomagokat (`CMD_BATCH`), és sorba rendezik őket.
*   ⚠️ **Folyamatban**: A parancsok **VÉGREHAJTÁSA** még le van tiltva (`ENABLE_COMMAND_EXECUTION = false`). Ez szándékos, hogy először a hálózati stabilitást bizonyítsuk.
*   ❌ **Hiányosság**: A kliens oldali szinkronizáció (interpoláció), a jogosultság-kezelés (ki mit vezethet) és a determinisztikus állapotkövetés még hátravan.

---

### 1.1 Netcode Bootstrap (NB0) - Phase 0 COMPLETE
**Dátum:** 2026-02-10
**Audit Status:** PASS (Antigravity)
*   ✅ **SimCore Purity**: `src/SimCore` megtisztítva (nincs többé `three.js` import az üzleti logikában). Izomorf kód (Node.js + Browser).
*   ✅ **Server Scaffold**: Létrejött a `/server` mappa Node.js környezettel.
*   ✅ **MemoryTransport**: In-Memory tesztkörnyezet (`loopback.test.js`) bizonyítja a determinisztikus működést TCP/IP nélkül.
*   **Következmény**: A technikai alapok stabilak a "valódi" szerver fejlesztéséhez (Phase 1).

---

## 2. A Következő Lépés: Slice 2 (Execution & Determinism)

A következő napok legfontosabb feladata a "rendszer élesítése".

### 2.1. Végrehajtás Engedélyezése
*   **Feladat**: `ENABLE_COMMAND_EXECUTION = true` átállítása.
*   **Logika**: A `SessionManager` által összegyűjtött parancsokat (`Queue`) a `SimLoop`-nak fel kell dolgoznia minden Tick-ben.
*   **Kockázat**: Ha a kliensek nem ugyanabban a Tick-ben hajtják végre a parancsot, a játék szétesik (Desync).

### 2.2. Szigorú Hálózati Szabályok (Strict Policy)
*   Jelenleg a rendszer "megengedő" (figyelmeztet, ha csomagvesztés van, de továbbmegy).
*   **Új szabály**: Ha hiányzik egy csomag (Gap), a játéknak **MEG KELL ÁLLNIA** (Stall), amíg a szerver újra el nem küldi.
*   **Indoklás**: RTS játékban 1 tick kiesés is végzetes eltérést okoz.

### 2.3. Determinisztikus Állapot-ellenőrzés (StateHash)
*   **Feladat**: Minden Tick végén a Host és a Guest kiszámol egy "kódot" (Hash) a játékállásból.
*   **Mechanizmus**: A Host elküldi a saját Hash-ét. A Guest összehasonlítja a sajátjával.
*   **Cél**: Azonnal detektálni, ha a két játékos mást lát (pl. az egyiknél a tank jobbra ment, a másiknál balra).

---

## 3. R013 Kritikus Funkciók (Features)

A hálózati alapokon túl ezeket a játékmenet-funkciókat kell beépíteni a multiplayerbe:

### 3.1. Jogosultság és Ülésrend ("Seat Exclusivity")
*   **Probléma**: Jelenleg bárki "bárhova ülhet", akár egyszerre is (Ghost Driving).
*   **Megoldás**:
    *   Szerver oldali validáció: Egy `SEAT_REQ` kérést csak akkor fogadunk el, ha a hely üres (`selectedBySlot === null`).
    *   **Ghost Input Gating**: Ha a kliensnél lenyomod a "W"-t, de nem te vagy a sofőr (Server szerint), a parancsot el sem küldjük.

### 3.2. Mozgás Szinkronizáció (Interpoláció)
*   **Probléma**: A "távoli" játékos egységei akadozva mozoghatnak (csak 10-20 FPS-el frissülnek a hálózaton).
*   **Megoldás**:
    *   A kliens nem a "nyers" pozíciót rajzolja ki, hanem interpolál (simít) az utolsó két ismert pozíció között.
    *   Ez elengedhetetlen a sima ("vajpuha") vizuális élményhez.

### 3.3. Fog of War (FOW) Szinkronizáció
*   **Kihívás**: A szerver nem küldheti át a teljes térképet (csalás lenne).
*   **Terv**:
    *   A kliens csak a saját egységei látómezejét ismeri.
    *   A "csapattársak" látómezeje opcionálisan megosztható (Shared Vision), de ezt hálózaton kell szinkronizálni.

---

## 4. Tesztelési Stratégia (HU-TEST)

A fejlesztést szigorú tesztekkel biztosítjuk:

1.  **Dual-Client Test (Helyi MP)**:
    *   Két böngészőablak megnyitása.
    *   Belépés ugyanabba a szobába.
    *   **Teszt 1**: "A" játékos mozog -> "B" játékos látja.
    *   **Teszt 2**: "A" játékos kilép -> "B" játékosnál felszabadul a hely.

2.  **Latency Simulation (Lag Teszt)**:
    *   Mesterséges késleltetés (pl. 200ms) bekapcsolása.
    *   Ellenőrizni, hogy a játék "ugrál-e" vagy szépen simít (predikció/interpoláció).

---

## 5. Összegzés és Ütemezés

1.  **Azonnal (Ma/Holnap)**:
    *   `ENABLE_COMMAND_EXECUTION = true` bekapcsolása.
    *   `GAP-1` (Input validáció) befejezése.
2.  **Hét vége**:
    *   Determinisztikus tesztek futtatása (Desync vadászat).
    *   Interpoláció alapjainak lerakása.
3.  **Jövő hét eleje**:
    *   R013 Bug Fixek (Ghost Driving, Pin Pad javítás).

Ez a terv biztosítja, hogy a multiplayer stabil alapokra épüljön, és elkerüljük a "spagetti-kód" okozta hálózati hibákat.
