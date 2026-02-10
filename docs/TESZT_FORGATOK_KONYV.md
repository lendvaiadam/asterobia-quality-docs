# Asterobia — Teszt Forgatókönyv

> **Verzió**: 2026-02-09
> **Szükséges**: Két böngésző tab (Chrome ajánlott)
> **URL**: `http://localhost:8081/game.html?net=supabase&dev=1`

---

## TESZT 1: Offline alap (1 tab elég)

**Nyisd meg** a játékot 1 tabban. NE nyomj HOST/JOIN gombot — csak zárd be az overlay-t.

### 1.1 Unit kijelölés
- Kattints egy kúpra (unit) → **zöld pont** jelenik meg felette, **kék fénygyűrű** pulzál körülötte
- Kattints egy üres helyre → a kijelölés eltűnik (nincs pont, nincs gyűrű)
- Kattints újra a unitra → megint kijelölve

**OK ha**: Pont megjelenik/eltűnik, gyűrű pulzál/eltűnik. Semmi nem ragad be.

### 1.2 Mozgatás
- Jelölj ki egy unitot (klikk rá)
- Nyomd a **W** billentyűt → a unit előre megy
- **A/D** → balra/jobbra fordul
- Engedd el → megáll
- **Shift + bal klikk** a felszínre → a unit odamegy

**OK ha**: Mozog WASD-ra, megáll ha elengedem, Shift+klikk célba megy.

### 1.3 Útvonal (waypoints)
- Jelölj ki egy unitot
- Shift+klikk ide, Shift+klikk oda, Shift+klikk oda → 3 pont, zöld vonal összekötve
- A unit végigmegy az úton
- Ha a sziklák között van a cél → **körbekerüli**, nem megy át rajtuk

**OK ha**: Vonal megjelenik, unit követi, sziklákat kikerüli.

### 1.4 Kamera
- **Scroll** → zoom be/ki
- **Jobb egérgomb + húzás** → kamera forog a bolygó körül
- A kamera NEM megy be a bolygóba

**OK ha**: Zoom és forgatás működik, kamera nem tűnik el.

---

## TESZT 2: Multiplayer belépés (2 tab kell)

### 2.1 Host létrehozása
- **Tab A**: Nyisd meg a játékot
- Írd be a neved a "Commander" mezőbe (pl. "Jani")
- Kattints **HOST GAME** → megjelenik egy **4 jegyű aszteroida kód** (pl. 3847)
- A kód alatt "Waiting for players..." felirat

### 2.2 Guest csatlakozás
- **Tab B**: Nyisd meg a játékot (ugyanaz az URL)
- Írd be a neved (pl. "Beni")
- Kattints **JOIN GAME** → megjelenik egy beviteli mező
- Írd be Tab A aszteroida kódját (pl. 3847) → kattints **JOIN**
- Kis várakozás után a Guest bekerül a játékba

### 2.3 Host indítja a játékot
- **Tab A**: A JOIN GAME gomb átvált **START GAME**-re
- Kattints **START GAME** → az overlay eltűnik, a játék elindul mindkét tabban

**OK ha**: Mindkét tab játékot mutat, a jobb felső sarokban "Online" + player count.

**NEM OK ha**: "Join timeout" hiba, vagy az egyik tab üres marad.

---

## TESZT 3: Seat rendszer (2 tab, játékban)

### 3.1 Host kijelöl egy unitot
- **Tab A** (Host): Kattints egy unitra → kijelölődik (zöld pont, gyűrű)
- **Tab B** (Guest): Ugyanaz a unit → legyen **lakat** vagy **OCCUPIED** felirat felette

### 3.2 Guest megpróbál beülni
- **Tab B**: Kattints a Host által foglalt unitra → **OCCUPIED** felirat jelenik meg (piros)
- NEM jelölheted ki, NEM mozgathatod

### 3.3 Host elenged, Guest beül
- **Tab A**: Kattints egy üres helyre (deselect) → a unit felszabadul
- **Tab B**: Kattints a most felszabadult unitra → **számkód kérés** (keypad) jelenik meg
- Írd be a helyes számot (1-9 között próbálkozz) → ha eltalálod, beültél!
- Most **Tab B** mozgathatja a unitot

### 3.4 Guest saját unitja
- **Tab B**: A Guest-nek van egy saját unitja (automatikusan kap egyet csatlakozáskor)
- Ez a unit szabadon kijelölhető, nincs PIN kérés
- A tab sávban (alul) csak a saját unitod látszik

**OK ha**: OCCUPIED megjelenik, keypad működik, beülés után mozgatható, saját unit szabad.

---

## TESZT 4: Mozgás szinkron (2 tab)

### 4.1 Host mozgat
- **Tab A**: Jelölj ki egy unitot, Shift+bal klikk valahova
- **Tab B**: UGYANAZ a unit elindul UGYANODA
- A mozgás legyen sima (ne ugráljon)

### 4.2 Guest mozgat
- **Tab B**: Jelöld ki a saját unitodat, Shift+bal klikk valahova
- **Tab A**: A Guest unitja elindul Tab A képernyőjén is

### 4.3 WASD szinkron
- **Tab A**: Jelölj ki unitot, nyomj WASD-t → mozog
- **Tab B**: Látja a mozgást

**OK ha**: Mindkét tabban ugyanaz történik, max fél másodperc késéssel.

**NEM OK ha**: Az egyik tabban mozog, a másikban nem. Vagy más irányba megy.

---

## TESZT 5: HUD és debug (2 tab)

### 5.1 HUD
- Jobb felső sarok: látszik a **role** (Host/Guest), **Online** státusz, **player count**
- Guest csatlakozik → player count nő
- Guest kilép → player count csökken

### 5.2 Console toggle
- Bal felső sarok: **Console** gomb
- Kattintás → debug panelek megjelennek
- Ismét kattintás → eltűnnek

### 5.3 Tabok (alul)
- Host: látja az összes unitot a tab sávban
- Guest: csak a saját unitjait látja
- Ha a Guest beül egy Host unitba (PIN-nel) → az is megjelenik a Guest tabjain

**OK ha**: HUD frissül, console ki/be, tabok szűrnek.

---

## TESZT 6: Host kilépés (2 tab)

- **Tab A** (Host): Zárd be a tabot (Ctrl+W)
- **Tab B** (Guest): NEM fagy le!
- Megjelenik "Host disconnected" vagy hasonló üzenet
- A Guest automatikusan HOST-tá válik
- A játék folytatódik

**OK ha**: Guest nem fagy le, HOST-tá válik, játék megy tovább.

---

## TESZT 7: Vizuális ellenőrzés

### 7.1 Indikátorok takarása
- Forgasd a kamerát úgy, hogy egy unit a **bolygó túloldalán** legyen
- A lakat/OCCUPIED/zöld pont NEM látszhat át a bolygón

### 7.2 Por effekt
- Mozgass egy unitot → porfelleg jelenik meg mögötte
- Állítsd meg → a por eloszlik
- NE maradjon vizuális szemét a felszínen

### 7.3 Fények
- Kijelölt unit: fénygyűrű + headlight (erős fény előre)
- ESC / kattintás máshova → fény eltűnik 2 másodpercen belül

**OK ha**: Indikátorok eltűnnek a bolygó mögött, por eltűnik, fény nem ragad be.

---

## GYORS CHECKLIST

| # | Mit tesztelj | OK? |
|---|-------------|-----|
| 1.1 | Unit kijelölés be/ki | ☐ |
| 1.2 | WASD mozgatás | ☐ |
| 1.3 | Waypoint útvonal + szikla kikerülés | ☐ |
| 1.4 | Kamera zoom + forgatás | ☐ |
| 2.1 | Host game + aszteroida kód | ☐ |
| 2.2 | Guest join + kód beírás | ☐ |
| 2.3 | Start game → mindkét tab indul | ☐ |
| 3.1 | OCCUPIED jelzés | ☐ |
| 3.2 | Keypad PIN bevitel | ☐ |
| 3.3 | Seat release + beülés | ☐ |
| 3.4 | Guest saját unit szabad | ☐ |
| 4.1 | Host mozgás → Guest látja | ☐ |
| 4.2 | Guest mozgás → Host látja | ☐ |
| 5.1 | HUD player count | ☐ |
| 5.2 | Console toggle | ☐ |
| 5.3 | Tab szűrés (Guest csak sajátot) | ☐ |
| 6 | Host kilép → Guest átveszi | ☐ |
| 7.1 | Indikátorok bolygó mögött eltűnnek | ☐ |
| 7.2 | Por eltűnik megálláskor | ☐ |
| 7.3 | Fény nem ragad be | ☐ |
