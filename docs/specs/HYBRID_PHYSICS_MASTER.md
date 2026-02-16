Asterobia: Hibrid Fizikai és Mozgásrendszer Terv
1. Alapkoncepció: A Hibrid Modell
A döntés értelmében a játék nem használ állandó, teljes fizikai szimulációt (Full Physics) minden egységre minden pillanatban, hanem egy hibrid állapotgépet alkalmaz.
• Alapállapot (Grounded / Kinematic):
    ◦ Ez a jelenlegi működés. A unit pozícióját és orientációját tiszta matematika határozza meg (Terrain.js logikája alapján).
    ◦ Magasság: A terep adott pontjának sugara (getRadiusAt).
    ◦ Dőlés: A terep normálvektora (getNormalAt).
    ◦ Előnye: Stabil, determinisztikus, kis számítási igényű, nincs "remegés" vagy véletlen elcsúszás állás közben,.
• Esemény Állapot (Dynamic / Airborne):
    ◦ Akkor kapcsol be, ha egy "Esemény" történik: ütközés, robbanás, túl meredek lejtő miatti borulás, vagy zuhanás (nincs talaj a unit alatt).
    ◦ Ekkor a unit átvált Rapier RigidBody szimulációra.
    ◦ A fizika átveszi az uralmat a pozíció és rotáció felett.
• Visszatérés:
    ◦ Ha a unit sebessége lecsökken (megáll/stabilizálódik) és a talajon van, a rendszer visszavált Alapállapotba (Kinematic).
2. Technológiai Döntések
Kiválasztott Motor: Rapier.js (WASM)
A megbeszélések alapján a Rapier került kiválasztásra a következő okokból,:
• Determinisztikus működés: Kritikus a multiplayer szinkronizációhoz (bár böngészők között nem bit-pontos, de szerver oldalon stabil).
• Teljesítmény: WASM alapú, gyorsabb, mint a tisztán JS motorok (pl. Cannon.js vagy Matter.js).
• Gömb támogatás: Lehetővé teszi a gravitációs vektorok manuális manipulálását (nem csak lefelé húz Y tengelyen).
• Stabil stacking: Jól kezeli, ha objektumok egymásra kerülnek.
Architektúra: Szerver Oldali Autoritás (Server Authority)
Ez a legfontosabb architekturális döntés a Phase 2A/2B fázisokban,:
• Single Source of Truth: A szerver (Node.js) futtatja a fizikai szimulációt és a terep-matekot is.
• Headless Server: A szerveren nincs grafika (Three.js render), de fut a Terrain.js (pure math) és a Rapier szimuláció,.
• Kliens szerepe: A kliens "dumb mirror" (buta tükör). Nem számol fizikát, csak megjeleníti (interpolálja) a szerver által küldött pozíciót és orientációt (quaternion),.
3. Megvalósítási Részletek (Eldöntött Tények)
3.1. Gravitáció a Gömbfelszínen
A Rapier alapbeállítása (konstans lefelé gravitáció) nem használható.
• Megoldás: A fizikai világ gravitációját 0-ra állítjuk (World gravity = 0).
• Implementáció: Minden fizikai lépésben (tick) manuálisan alkalmazunk egy erőt (force) minden dinamikus egységre, amely a unit aktuális pozíciójából a bolygó középpontja (0,0,0) felé mutat,.
3.2. Ütközők (Colliders)
• Unitok: Egyszerű primitívek használata kötelező (Box, Capsule, Convex Hull). A Trimesh (bonyolult háló) használata dinamikus testeken kerülendő a stabilitás miatt.
• Terep (Terrain): Mivel a terep gömbölyű, nem lehet egyszerű Heightfield-et használni.
    ◦ Döntés: Chunk-olt statikus colliderek használata, vagy "compound colliders" (sok kicsi primitívből felépítve) a szerveren.
3.3. Adatkommunikáció (Snapshot)
A hálózati csomagoknak támogatniuk kell a hibrid működést. A szerver snapshot a következőket tartalmazza,:
• Position (px, py, pz): Hol van.
• Orientation (qx, qy, qz, qw): Quaternion formában (így a borulás is átmegy).
• Mode / State: Jelzőbit: GROUNDED (tapad a talajhoz) vagy AIRBORNE (repül/zuhan/borul). Ez mondja meg a kliensnek, hogy kell-e interpolálnia a terephez, vagy szabadon hagyja a levegőben.
3.4. Lifecycle (Életciklus) és "Lift Before Solid"
A "Space Launch" (azonnali kirepülés) hiba elkerülése végett, amikor a Collider a terep belsejéből indulna:
• A kliens soha nem hoz létre (spawn) egységet saját hatáskörben.
• **Lift Before Solid:** Amikor egy egység Kinematic (Sensor) módból Dynamic (Solid) módba vált:
    ◦ A rendszer kiszámolja a biztonságos, ütközésmentes pozíciót (Terrain Radius + Collider Radius + Epsilon).
    ◦ A testet **még a Solid mód bekapcsolása előtt** erre a pozícióra (kifelé, a sugár mentén) mozgatja.
    ◦ Csak a pozíció korrekció után vált át DYNAMIC típusra és kapcsolja be a Solid Collidert.
• Ez biztosítja, hogy a fizika aktiválásakor a test már "tiszta" helyzetben legyen, így nem keletkezik hatalmas "kiszabadító erő" (penetration resolution force).
4. Események Kezelése (Use Cases)
Az alábbi esetekben aktiválódik a Rapier fizika:
1. Ütközés (Collision): Ha két unit vagy egy unit és egy tereptárgy (szikla) ütközik.
    ◦ Hatás: A unitok lökődnek, a kinematic mód kikapcsol, a fizika számolja a visszapattanást.
2. Borulás (Tipping): Ha a terep normálvektora egy határértéknél meredekebb (pl. 45 fok).
    ◦ Hatás: A "tapadás" megszűnik, a unit legurul a lejtőn.
3. Robbanás (Blast):
    ◦ Hatás: Sugaras impulzus (impulse) éri a RigidBody-t, ami ellöki a tömegközéppontjától függően (forgást is okozva).
4. Zuhanás (Falling/Jumping): Ha a unit alatt megszűnik a talaj (pl. szakadék vagy ugrató).
    ◦ Hatás: A getRadiusAt alapú magasságtartás kikapcsol, a gravitációs erő húzza lefelé a testet.
5. Nyitott Kérdések és Döntésre Váró Pontok
Ezek azok a területek, ahol az irány megvan, de a konkrét implementációs részlet még tisztázásra szorul a fejlesztés során:
1. Terep Collider Pontossága a Szerveren:
    ◦ Kérdés: A szerver pontosan milyen geometriát használjon a terep ütközéshez?
    ◦ Opciók: (A) Egyszerűsített gömb collider (gyors, de pontatlan). (B) Trimesh collider a terep generált geometriájából (pontos, de lassabb).
    ◦ Javaslat: Kezdetben (B) Trimesh vagy Heightfield patch-ek használata a szerveren a kritikus zónákban, mivel a Terrain.js determinisztikus, így a szerver le tudja generálni ugyanazt a geometriát, mint a kliens,.
2. Visszaállás (Recovery):
    ◦ Kérdés: Ha egy unit felborult (és megállt az oldalán), hogyan áll talpra?
    ◦ Opciók: (A) "Varázslat" (lerp-pel visszaáll). (B) Fizikai daru/csörlő mechanika. (C) Manuális "flip" gomb.
    ◦ Irány: A daru/emelő mechanika felmerült mint realisztikus opció, de MVP-nek (Minimum Viable Product) egy automatikus vagy gombnyomásra történő visszafordulás is megfelelhet.
3. Pathfinding vs. Physics:
    ◦ Kérdés: Hogyan kerüli ki az akadályokat (kövek) az útvonalkereső?
    ◦ Döntés: A Pathfinding (A*) kliens oldalon futhat "javaslatként", de a szervernek validálnia kell. A szervernek ismernie kell a sziklák pozícióját (bounding sphere/box) a validáláshoz, de nem feltétlenül kell teljes fizikai ütközést számolnia az útvonaltervezés fázisában.
6. Összegzés (A Terv)
A fejlesztés következő lépései (Roadmap) ezen döntések alapján:
1. Phase 2A lezárása (Jelenlegi állapot): Stabil hálózati alap (Snapshot, Mirroring, Server Authority) gömb felszíni matematikai mozgással. Ez már majdnem kész (Commit 3).
2. Phase 2B (Path-Follow): A szerver megtanul útvonalat követni (még mindig matematikai alapon), hogy a SET_PATH parancsok is szerver-autoritatívak legyenek.
3. Phase 3 (Physics Integration):
    ◦ Rapier beüzemelése a szerveren (Headless).
    ◦ Állapotgép implementálása (GROUNDED <-> DYNAMIC).
    ◦ Gravitációs erő bekötése.
    ◦ Ütközési események (robbanás/lökés) esetén módváltás.
Ez az architektúra biztosítja, hogy a játékmenet 90%-a (mozgás A-ból B-be) stabil és gyors legyen, de a kaotikus, látványos események (borulás, robbanás) is fizikailag korrektek és szinkronizáltak legyenek.
Milyen szempontok alapján dől el, hogy egy unit mikor vált kinematikusból dinamikus fizikai módba?
Hogyan kezeli a Rapier motor a gravitációt a gömb alakú bolygófelszínen?
Melyek a legfontosabb még nyitott kérdések a terep ütközésmodelljének (Terrain Collider) megvalósításakor?
Kérdés, hogy van benne olyan, ami a szerverrel való kommunikációról és az ahhoz szükséges eszközökről szól?

Igen, a források tartalmaznak információt a szerverrel való kommunikációról és az eszközökről, de két különböző szinten:
1. A Rapier_ThreeJS_Asterobia_Guide.md (Fizikai útmutató) Ez a dokumentum nem tárgyalja a kommunikációs eszközöket (pl. WebSocket könyvtárakat), de rögzíti a kommunikációs stratégiát a 10. pontban („Multiplayer / determinisztika”):
• Kimondja, hogy a böngészős fizika nem bit-pontos, ezért szerver oldali autoritásra („server side truth”) és snapshotokra van szükség.
• Meghatározza a kliens feladatát: prediction + reconciliation (jóslás és korrekció) a szerver által küldött állapot alapján.
2. A Beszélgetési Naplók (Notebook_lm_nek_1.md) A beszélgetések tartalmazzák a konkrét megvalósítást és az eszközöket, amelyeket a Phase 2A során építettetek ki. Itt vannak a részletek:
A kommunikációhoz kiválasztott eszközök és protokollok:
• Platform: Node.js alapú szerver (server/index.js, GameServer.js).
• Protokoll: WebSocket (ws) alapú kommunikáció (WsRelay.js). Nem használtok binary serialization-t egyelőre, csak JSON-t.
• Üzenetkezelés:
    ◦ Szerver -> Kliens: SERVER_SNAPSHOT üzenetek (20 Hz-es frissítéssel), amelyek tartalmazzák a pozíciót, orientációt (quaternion) és állapotot.
    ◦ Kliens -> Szerver: MOVE_INPUT (WASD lenyomások) és SPAWN_MANIFEST (kezdeti egységlista kérése).
    ◦ Útvonaltervezés (Phase 2B): A PATH_DATA üzenet viszi majd át a kliens által tervezett útvonal pontjait (waypoints) a szervernek, hogy az hajtsa végre a mozgást.
Architektúra (Manifest-Lite):
A beszélgetésekben rögzítettétek a „Path-Follow Authority” modellt:
• A szerver a Single Source of Truth (egyetlen igazságforrás).
• A kliens „dumb mirror” (buta tükör): nem számol fizikát a hálózati egységekre, csak megjeleníti a szerver által küldött snapshotokat a SnapshotBuffer segítségével, ami interpolálja (simítja) a mozgást,.
Összefoglalva: A fizikai útmutató megadta az elméleti kényszert (miért kell szerver), a beszélgetések pedig definiálták a technológiát (Node.js + WebSocket + JSON Snapshotok + Manifest alapú lifecycle).
Mikor vált a unit kinematikus mozgásról Rapier dinamikus fizikai szimulációra?
Hogyan oldható meg a domborzat ütközésvizsgálata a gömbfelszíni terepen a szerveren?
Milyen módon történik a borulás és a talpra állítás folyamatának vezérlése?
Ez utóbbit is illesszük be az anyagba és a teljes dokumentumot letölteném!

Rendben, elindítottam a teljes, részletes anyag generálását.
Ez a dokumentum egyesíti az összes eddigi döntést:
1. Phase 2A (Jelenlegi állapot): A "Manifest-Lite" architektúra (szerver vezérelt spawn, nincs double-update, SnapshotBuffer, tükör mód), amivel a hálózati alap stabil.
2. Phase 2B (Következő lépés): A "Path-Follow Authority" (szerver vezérelt útvonalkövetés), hogy a pathfinding kliens oldalon maradjon, de az eredmény determinisztikus és szinkronizált legyen.
3. Phase 3 (Fizikai integráció - Rapier): A hibrid mozgásrendszer részletes terve. Itt fejtettem ki bővebben az általad kért "latter part"-ot:
    ◦ Hibrid modell: Alapesetben matematikai mozgás (kinematic) a gömb felszínén (stabil, gyors), de eseményekkor (ütközés, borulás, robbanás) átváltás Rapier (dynamic) szimulációra.
    ◦ Rapier technika: Fix timestep (60Hz), manuális gömb-gravitáció (erő a középpont felé), primitív colliderek a unitoknak és "patch" colliderek a terepnek.
4. Jövőkép: A skálázhatóság (10 -> 100 unit) és a desktop/Steam irány (Electron/Tauri) összefoglalása.
A dokumentum néhány percen belül elkészül és letölthető lesz.
Mikor vált a unit matematikai mozgásról fizikai szimulációra a hibrid rendszerben?
Hogyan kezeli a szerver a gömbi gravitációt a Rapier motor használatakor?
Milyen biztonsági megoldások védik a szervert a kliens oldali manipulációtól?
Ebben most hivatkozások vannak. Olyan dokumentum kell, amiben nincsenek hivatkozások, hanem minden tartalom közvetlenük bele van szerkesztve.

rendben, összeállítottam a teljes, egységes dokumentumot. Ebben már nincsenek hivatkozások, hanem minden technikai döntés, a hálózati kommunikáció részletei, a fizikai megvalósítás és a jövőbeli tervek egyetlen koherens anyagba vannak szerkesztve.
Ez a dokumentum szolgálhat "bibliaként" a fejlesztés további szakaszaihoz.

--------------------------------------------------------------------------------
Asterobia: Hibrid Fizikai, Mozgásrendszer és Hálózati Architektúra Terv
Ez a dokumentum összefoglalja az Asterobia projekt fizikai szimulációjára, egységmozgatására és hálózati kommunikációjára vonatkozó véglegesített döntéseket, a választott technológiákat és a megvalósítási ütemtervet.
1. Alapkoncepció: A Hibrid Mozgásrendszer
A játék nem alkalmaz állandó, teljes fizikai szimulációt minden egységre minden pillanatban. Ehelyett egy teljesítmény-optimalizált hibrid állapotgépet használunk, amely elválasztja a stabil haladást a kaotikus eseményektől.
A. Alapállapot (Grounded / Kinematic)
Ez a rendszer alapértelmezett működési módja (a játékidő 90-95%-a).
• Működés: Az egység pozícióját és orientációját tiszta matematikai számítások határozzák meg a gömbfelszínen.
• Magasság: A terep adott pontjának sugara (getRadiusAt).
• Dőlés: A terep normálvektora (getNormalAt) alapján az egység mindig merőleges a felszínre.
• Előnye: Stabil, determinisztikus, alacsony számítási igényű, és kiküszöböli a fizikai motorokra jellemző "remegést" (jitter) állás vagy sima haladás közben.
B. Esemény Állapot (Dynamic / Airborne)
Akkor kapcsol be, ha külső behatás éri az egységet vagy a terepviszonyok megkövetelik.
• Kiváltó okok: Ütközés más egységgel/sziklával, robbanás lökéshulláma, túl meredek lejtő miatti borulás, vagy ha megszűnik a talaj az egység alatt (zuhanás).
• Működés: Az egység átvált Rapier RigidBody szimulációra. A fizikai motor átveszi az irányítást a pozíció és rotáció felett.
• Visszatérés: Ha az egység sebessége lecsökken és stabilan talajt ér, a rendszer visszavált Alapállapotba (Kinematic).
2. Hálózati Architektúra és Kommunikáció
A többjátékos mód alapja a Szerver Oldali Autoritás (Server Authority). A kliensek nem döntenek a játékállapotról, csak megjelenítik azt.
Architektúra: "Manifest-Lite" és Path-Follow Authority
A fejlesztés során a "Manifest-Lite" modellt fogadtuk el a "Double Spawn" (dupla létrehozás) és "Double Update" (dupla frissítés) hibák elkerülésére.
1. Single Source of Truth:
    ◦ A szerver (Node.js) az egyetlen igazságforrás.
    ◦ A szerver ismeri a terep matematikáját (ugyanaz a Terrain.js fut Node-ban, mint a kliensen), így pontosan tudja, hol van a felszín.
    ◦ A szerveren nincs grafikus megjelenítés (Headless), csak a szimuláció fut.
2. Életciklus (Lifecycle) és Manifest:
    ◦ A kliens soha nem hoz létre (spawn) egységet saját hatáskörben a játékmenet során.
    ◦ A játék indításakor a Host küld egy SPAWN_MANIFEST üzenetet a szervernek (igénybejelentés).
    ◦ A szerver validálja, létrehozza a hivatalos egységeket, és SERVER_SNAPSHOT-ban küldi vissza őket.
    ◦ A kliensek kizárólag a szerver snapshotjai alapján hoznak létre vizuális "proxy" egységeket.
3. Tükör Mód (Mirror Mode):
    ◦ A kliens "buta tükörként" (dumb mirror) viselkedik.
    ◦ Nem futtat fizikai szimulációt a hálózati egységeken.
    ◦ A SnapshotBuffer segítségével interpolálja (simítja) a szerverről érkező pozíciókat és orientációkat (quaternion), így a mozgás folyamatosnak tűnik a hálózati késleltetés ellenére is.
Kommunikációs Eszközök és Protokoll
• Platform: Node.js szerver.
• Protokoll: WebSocket (ws). Jelenleg JSON formátumú üzenetekkel (később binárisra váltható).
• Üzenettípusok:
    ◦ SERVER_SNAPSHOT: A szerver küldi (kb. 20 Hz), tartalmazza az egységek ID-ját, pozícióját, rotációját (quaternion) és állapotát.
    ◦ MOVE_INPUT: A kliens küldi (WASD lenyomások), ha közvetlen irányítás van (Phase 2A).
    ◦ PATH_DATA: A kliens küldi az útvonal pontjait (Phase 2B). (Max 32 pont, Max 200m szegmens).
    ◦ SPAWN_MANIFEST: A host küldi a játék kezdetekor az egységek listájáról.
3. Mozgásvezérlés és Útvonalkeresés (Phase 2B)
A hálózati stabilitás érdekében az útvonalkeresés (Pathfinding) és az útvonalkövetés (Path Following) feladatait szétválasztottuk.
• Kliens szerepe (Pathfinding):
    ◦ A drága A* útvonalkeresés a kliensen fut.
    ◦ A kliens kiszámolja az utat, és elküldi a szervernek az útvonal sarokpontjait (waypoints) a PATH_DATA üzenetben.
    ◦ Ez csak "javaslat" a szerver felé.
• Szerver szerepe (Path Following & Validation):
    ◦ A szerver megkapja a pontokat (PATH_DATA).
    ◦ Validálás (Szigorú):
        - MaxWaypoints: 32 pont (ezen felül eldobja/vágja).
        - MaxSegmentLength: 200m (sanity check; ha nagyobb, a path érvénytelen).
        - Owner check: Csak a saját egységnek küldhető parancs.
        - Raycast (Line-of-Sight): Phase 2B-ben MÉG NINCS, csak távolság alapú "sanity check".
    ◦ Vezérlés és Megszakítás:
        - A szerver vezérli az egységet pontról pontra (Waypoint Following).
        - MEGSZAKÍTÁS (INTERRUPT): Bármilyen direkt irányítás (WASD / Joystick / MOVE_INPUT) azonnal törli az aktív útvonalat és átveszi az irányítást.
    ◦ Az eredményt (az egység tényleges mozgását) a snapshotokon keresztül küldi vissza. A snapshot NEM tartalmaz pathIndex-et, csak a pozíciót/orientációt interpolálja a kliens.
4. Fizikai Megvalósítás (Phase 3 - Rapier)
Amikor esemény történik (ütközés, borulás), a rendszer átvált a fizikai motorra.
Technológia: Rapier.js (WASM)
Azért választottuk a Rapiert, mert:
• Determinisztikus: Kritikus a multiplayer szinkronizációhoz.
• Gyors: WASM alapú, képes 100+ egységet kezelni.
• Testreszabható: Támogatja a manuális gravitációs erőket (gömb felszín).
Megvalósítási Részletek
1. Gravitáció a Gömbfelszínen:
    ◦ A fizikai világ globális gravitációját 0-ra állítjuk.
    ◦ Minden fizikai lépésben (tick) manuálisan alkalmazunk egy erőt minden dinamikus egységre, amely a bolygó középpontja (0,0,0) felé mutat.
2. Ütközők (Colliders):
    ◦ Unitok: Egyszerű primitívek (Doboz, Kapszula). Kerüljük a bonyolult hálókat (Trimesh) a stabilitás érdekében.
    ◦ Terep: Mivel a terep gömbölyű, a szerver a Terrain.js matematika alapján generál "compound collidereket" (sok kis statikus elemből) vagy egyszerűsített gömböt használ, ahol a pontos illesztést a matematikai réteg végzi utólag.
3. Kliens-Szerver Szinkronizáció Fizika esetén:
    ◦ A snapshot tartalmaz egy állapotjelzőt (GROUNDED vagy AIRBORNE/DYNAMIC).
    ◦ Ha DYNAMIC, a kliens nem próbálja a terephez igazítani az egységet, hanem pontosan azt a pozíciót és dőlést rajzolja ki, amit a szerver a fizikai szimulációból küld (pl. ha egy egység épp a levegőben pörögve zuhan).
5. Nyitott Kérdések és Döntési Pontok
A fejlesztés során ezekre a területekre kell figyelni:
1. Terep Ütközés Pontossága: A szerveren kezdetben egyszerűsített terepmodellt használunk. Ha a "fizikai" eseményeknél (pl. szikláról lepattanás) ez pontatlan, akkor a szerveren is részletesebb (Trimesh) ütközőket kell generálni a kritikus zónákban.
2. Visszaállás (Recovery): Ha egy egység felborul, hogyan áll talpra? A jelenlegi döntés egy automatikus vagy gombnyomásra történő visszafordulás (MVP), de a rendszer nyitott egy későbbi, realisztikusabb "daru/csörlő" mechanika beépítésére is.
6. Biztonsági Réteg (Security Hardening) — Phase 2A-ban megépítve
<!-- CLAUDE NOTE (2026-02-13): Az alábbi védelmi réteg elkészült, de a Master Spec nem tartalmazta.
     Ide illesztve a teljesség kedvéért. -->
A szerver oldali autoritás megköveteli, hogy a kliens ne tudjon manipulálni:
• JOIN_ACK host-only gate: Csak a host (slot 0) hozhat létre guest unitot a szerveren. Guest-től érkező JOIN_ACK elutasítva.
• Manifest méretkorlát: Max 200 unit per manifest (OOM védelem). Minden unit id-ja szám, ownerSlot 0..maxSlot tartományban.
• WsRelay maxPayload: 512 KB limit a WebSocket frame-ekre. Broadcast méretellenőrzés az amplification attack ellen.
• Rate limiting: Per-kliens 100 msg/sec csúszóablakos limit. Túllépés → csendes eldobás (JSON parse előtt).
7. Összefoglaló Ütemterv (Roadmap)
A fejlesztés lépései a stabilizált alapoktól a teljes fizikai szimulációig:
1. Phase 2A (Kész/Zárás): Stabil hálózati alap. Szerver oldali autoritás a gömb felszínén való mozgáshoz (még fizika nélkül, tisztán matematikai alapon). Manifest-alapú életciklus, tükör mód a kliensen.
2. Phase 2B (Következő lépés): Szerver oldali útvonalkövetés (PATH_DATA). A kliens pathfindingot számol, a szerver végrehajtja. Ezzel a stratégiai mozgás is biztonságossá válik.
3. Phase 3 (Fizika): Rapier integrálása a szerverre. A hibrid modell aktiválása: ütközéskor és boruláskor a szerver átvált fizikai szimulációra, és a kliens ezt tükrözi.
4. Desktop/Steam Migráció (Opcionális jövőkép): Ha a böngészős teljesítmény korlátokba ütközik, a játék (mivel WebGL/JS alapú) könnyen csomagolható Electron vagy Tauri segítségével asztali alkalmazássá, ami lehetővé teszi a Steam megjelenést.