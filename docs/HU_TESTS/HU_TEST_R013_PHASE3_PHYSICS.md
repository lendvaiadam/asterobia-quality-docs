# HU-TEST: R013 Phase 3 — Physics Visual Test

**Status:** READY
**Launcher:** `LAUNCH_HU_TEST_PHYSICS.bat`
**Prereq:** Node.js, `npm install` done

---

## Előkészületek (Setup)

1. **Terminálban** futtasd: `LAUNCH_HU_TEST_PHYSICS.bat`
   - Elindul a szerver physics-szel (`ENABLE_PHYSICS=1`)
   - Megnyílik 2 böngészőtab (Host + Guest)
   - Konzolban látnod kell: `[Asterobia Server] Physics ENABLED (Rapier)`

2. **Mindkét tabban:**
   - URL: `http://localhost:8081/game.html?net=ws&dev=1&wsPort=8081`
   - Dev mode aktív (debug panelek láthatók)

---

## Teszt 1: Csatlakozás és Physics Debug Panel

### Lépések:
1. **Host tab:** Kattints "HOST GAME" gombra
2. **Guest tab:** Írd be a room kódot, kattints "JOIN GAME"
3. **Host tab:** Kattints "START GAME"
4. **Mindkét tab:** Nézd a jobb felső sarokban az **orange keretű "PHYSICS DEBUG"** panelt

### Elvárt eredmény:
- A PHYSICS DEBUG panel látható (narancs keret, fekete háttér)
- Mutatja az unitok listáját: `U1 [KINEMATIC] IDLE alt:X.X spd:0.0`
- A `physicsMode` mező `KINEMATIC` (zöld szín)
- EXPLODE és MINE gombok láthatók

### HA NEM LÁTOD a panelt:
- Ellenőrizd, hogy `?dev=1` van az URL-ben
- F12 → Console: keress hibát

---

## Teszt 2: Normál mozgás (KINEMATIC állapot)

### Lépések:
1. **Host tab:** Kattints duplán egy unitodra (beülsz)
2. **Host tab:** WASD billentyűkkel mozgass
3. **Figyeld** a PHYSICS DEBUG panelt

### Elvárt eredmény:
- Unit mozog a bolygó felszínén
- PHYSICS DEBUG: `U1 [KINEMATIC] MOVING spd:X.X`
- Az állapot végig **KINEMATIC** marad (zöld)
- Guest tabban is látnod kell a mozgást (interpolálva)

---

## Teszt 3: Robbanás (EXPLODE gomb → DYNAMIC átmenet)

### Lépések:
1. **Host tab:** Válassz ki egy unitot (kattints rá)
2. **Host tab:** A PHYSICS DEBUG panelen kattints az **EXPLODE** gombra
3. **Figyeld** a panelt és a unitot

### Elvárt eredmény:
- A unit elrepül/felpattog a robbanástól
- PHYSICS DEBUG: `U1 [DYNAMIC]` → **piros szín**
- A unit mozgása kaotikus (fizika vezérli, nem terrain-snap)
- Néhány másodperc múlva a unit lelassul és visszaáll: `[KINEMATIC]` → **zöld**
- Guest tabban is láthatónak kell lennie a repülésnek

### Ismételd meg többször — mindegyiknél:
- DYNAMIC → piros → mozgás → lassulás → KINEMATIC → zöld

---

## Teszt 4: Akna lehelyezése és detonáció

### Lépések:
1. **Host tab:** Válassz ki egy unitot
2. **Host tab:** Kattints a **MINE** gombra → akna lehelyezve a unit pozíciójánál
3. **Host tab:** Mozgasd el a unitot (WASD-val pár lépést)
4. **Host tab:** Mozgasd VISSZA a unitot az akna pozíciójára

### Elvárt eredmény:
- Az akna detonál, amikor a unit közel ér (trigger radius ~1.5 egység)
- A unit felugrik/elrepül (upward + radial impulse)
- PHYSICS DEBUG: `[DYNAMIC]` piros → majd visszaáll `[KINEMATIC]` zöldre
- Ha több unit van a közelben, azokat is érinti a robbanás

---

## Teszt 5: Meredek lejtő → Gurulás (Slope Rollover)

### Lépések:
1. **Host tab:** Keresd meg a bolygón a legmeredekebb terepet
   - Tipikusan a hegyek csúcsai közelében vannak >45°-os lejtők
   - Nézd az `alt` (altitude) értéket a PHYSICS DEBUG panelen
2. **Host tab:** Hajtsd a unitot a meredek lejtő felé
3. **Figyeld** mi történik, amikor a lejtő >45°

### Elvárt eredmény:
- A unit elveszti a tapadást és legurul
- PHYSICS DEBUG: `[DYNAMIC]` piros
- A unit a gravitáció miatt lefelé csúszik/gurul
- Amikor elér egy laposabb részt: `[KINEMATIC]` visszaáll

### Megjegyzés:
- Az alapértelmezett terep viszonylag sima — lehet, hogy nehéz 45°-os lejtőt találni
- Ha nem találsz elég meredek terepet, az EXPLODE teszttel is igazolható a fizika

---

## Teszt 6: Többjátékos szinkronizáció

### Lépések:
1. **Host tab:** Válassz ki egy unitot, nyomj EXPLODE-t
2. **Guest tab:** Figyeld, hogy a Guest is látja-e a repülést
3. **Guest tab:** Ellenőrizd a PHYSICS DEBUG panelt

### Elvárt eredmény:
- Mindkét tabban ugyanaz a fizikai viselkedés látható
- A DYNAMIC/KINEMATIC állapotváltás mindkét oldalon megjelenik
- A pozíciók konvergálnak (lehet kis késés az interpoláció miatt)

---

## Hibakeresés (Troubleshooting)

| Tünet | Ok | Megoldás |
|-------|-----|---------|
| PHYSICS DEBUG panel nem jelenik meg | `?dev=1` hiányzik az URL-ből | Add hozzá: `?net=ws&dev=1` |
| `physicsMode: N/A` a panelen | Szerver physics nélkül indult | Ellenőrizd: `ENABLE_PHYSICS=1` a szerver konzolon |
| EXPLODE gomb nem csinál semmit | Nincs kiválasztott unit | Kattints duplán egy unitra előbb |
| Unit nem áll vissza KINEMATIC-ra | Settle detection túl lassú | Várj 5-10 másodpercet — a sebesség küszöb 0.5 m/s |
| Guest nem látja a fizikát | Nem csatlakozott | Ellenőrizd, hogy mindkét tab "PLAYING" állapotban van |

---

## Összefoglaló: Pass/Fail Kritériumok

| # | Teszt | Pass feltétel |
|---|-------|---------------|
| 1 | Debug panel | PHYSICS DEBUG panel látható, unitok listázva |
| 2 | Normál mozgás | KINEMATIC végig, mozgás sima |
| 3 | Robbanás | DYNAMIC → piros → repülés → KINEMATIC → zöld |
| 4 | Akna | Detonáció + felrepülés → visszaállás |
| 5 | Lejtő | >45° → DYNAMIC → gurulás → visszaállás |
| 6 | Szinkron | Mindkét tab azonos viselkedést mutat |
