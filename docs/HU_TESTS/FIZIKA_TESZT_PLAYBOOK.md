# Fizika Teszt - Lépésről lépésre

## Indítás
1. **Dupla klikk** erre a fájlra: `LAUNCH_HU_TEST_PHYSICS.bat`
2. Megnyílik egy fekete ablak (szerver) és utána a böngésző
3. Várd meg amíg betölt a játék (bolygó megjelenik)

---

## Belépés a játékba

1. Kattints a **HOST GAME** gombra
2. Megjelenik egy kód — **ne törődj vele**
3. Kattints a **START GAME** gombra
4. Most a bolygón látnod kell kis figurákat (unit-okat)

---

## Ülj be egy unitba

1. **Dupla klikk** egy unitra (kis figurára a bolygón)
2. Ha sikerült, megjelenik egy világító gyűrű körülötte
3. Most WASD-vel tudod mozgatni

> Ha nem jelenik meg gyűrű → kattints máshova, próbáld újra

---

## Narancssárga panel (PHYSICS DEBUG)

A képernyő jobb felső sarkában kell legyen egy **narancssárga fejlécű** panel:
**"PHYSICS DEBUG"**

Ezen 3 gomb van:
- 🔴 **EXPLODE** (piros)
- 🟡 **MINE** (sárga)
- 🔵 **ROCK** (kék)

> Ha NEM látod ezt a panelt → valami baj van, szólj nekem!

---

## TESZT 1: Robbanás (EXPLODE)

**Mi fog történni:** A unitod közelében lévő másik unit felrepül a levegőbe, majd visszaesik.

1. Ülj be egy unitba (dupla klikk) — kellenek legalább 2 unitok egymás közelében
2. WASD-vel menj egy másik unit KÖZELÉBE (de ne rá)
3. Kattints az **EXPLODE** gombra a narancssárga panelen
4. **Figyeld:** a közeli unit felrepül!

**Amit látnod kell:**
- A narancssárga panelen az érintett unit neve mellé **[DYNAMIC]** jelenik meg **PIROSSAL**
- Pár másodperc múlva visszaesik → visszavált **[KINEMATIC]** **ZÖLDDEL**

✅ **TESZT OK ha:** unit felrepült ÉS visszaesett
❌ **TESZT FAIL ha:** semmi nem történt, VAGY a unit nem esett vissza

---

## TESZT 2: Akna (MINE)

**Mi fog történni:** Egy akna jelenik meg a unitod helyén. Ha rásétálsz → robbantás.

1. Ülj be egy unitba (dupla klikk)
2. Kattints a **MINE** gombra
3. A panelen megjelenik: "MINE placed at U..."
4. Most **sétálj el** a unittól (WASD-vel menjél el messzire)
5. Majd **sétálj VISSZA** a régi helyre

**Amit látnod kell:**
- Amikor visszaérsz az akna helyére → a unit felrepül (mint a robbanásnál)
- Az akna LÁTHATATLAN — csak az eredményt (repülés) fogod látni

✅ **TESZT OK ha:** visszasétáltál ÉS felrepültél
❌ **TESZT FAIL ha:** semmi nem történt visszasétáláskor

---

## TESZT 3: Szikla (ROCK)

**Mi fog történni:** Egy láthatatlan akadály jelenik meg a unit előtt. Ha nekimész → megpattansz.

1. Ülj be egy unitba (dupla klikk)
2. **Jegyezd meg merre néz** a unit (ez fontos!)
3. Kattints a **ROCK** gombra
4. A panelen megjelenik: "ROCK spawned near U..."
5. Most **sétálj ELŐRE** (W gomb) abba az irányba amerre nézett a unit

**Amit látnod kell:**
- ~2 lépés után **megpattansz** egy láthatatlan falon
- Mintha üvegfalba ütköztél volna

> A szikla LÁTHATATLAN — ez normális! Még nincs vizuális megjelenítése.
> Csak az ütközés bizonyítja hogy ott van.

✅ **TESZT OK ha:** megállt / megpattant a unit valamin
❌ **TESZT FAIL ha:** simán átsétáltál mindenütt, semmi nem állította meg

---

## Teszt vége

1. Menj vissza a fekete ablakra (szerver)
2. Nyomj **ENTER**-t
3. Kész, a szerver leáll

---

## Ha valami nem működik

| Probléma | Mit csinálj |
|----------|-------------|
| Nem jelenik meg a narancssárga panel | Nézd meg hogy a böngésző URL-jében van-e `dev=1` |
| EXPLODE-ra semmi nem történik | Kell 2 unit egymás közelében! Egyedül nem repül fel |
| Fekete ablak hibát ír | Screenshot-old le és küldd el nekem |
| Böngésző nem nyílik meg | Nyisd meg kézzel: `http://127.0.0.1:8081/game.html?net=ws&dev=1` |
