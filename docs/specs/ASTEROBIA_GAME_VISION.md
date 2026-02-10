# Asterobia - Game Vision & Specification
> Version: 0.1 | Date: 2026-02-08

## Core Concept

Asterobia is a **multiplayer real-time strategy game** where each player owns an asteroid. Players can visit each other's asteroids, capture units, form alliances, and betray each other. The game is both **cooperative and competitive** - allies can turn into enemies and vice versa.

---

## World Model

### Asteroids (Per-User Worlds)
- Each registered user has their own asteroid (persistent world)
- The asteroid is created when the user first starts the game
- The asteroid persists even when the owner is offline
- Other players can visit the asteroid at any time
- The **asteroid owner** is always the user who created it (independent of who is "Host" technically)

### Technical Host vs Game Owner
- The "Host" role is purely technical (network authority, CMD_BATCH, JOIN_REQ handling)
- Host role should be invisible to gameplay - no special in-game privileges
- Host role transfers automatically when current host disconnects
- **Ideal future**: Backend (Supabase) acts as host, eliminating client-side host role
- **Current**: Client-side host with automatic migration

---

## Units

### Ownership Model
- Every unit tracks a **full ownership history** (not just current owner):
  ```
  unit.ownerHistory = [
    { slot: 0, userId: 'abc', displayName: 'Player1', acquiredAt: simTick, method: 'SPAWN' },
    { slot: 1, userId: 'def', displayName: 'Player2', acquiredAt: simTick, method: 'PIN_CAPTURE' },
    { slot: 0, userId: 'abc', displayName: 'Player1', acquiredAt: simTick, method: 'PIN_RECAPTURE' },
  ]
  ```
- `ownerSlot` = current owner (last entry in history)
- `originalOwnerSlot` = first owner (first entry in history)
- `selectedBySlot` = who is currently "seated" (driving)

### Capture Mechanics
- **PIN system** = simulates hacking a unit's defense system
- Anyone can attempt to capture anyone's unit (like stealing a car)
- The original owner (or anyone) can recapture it
- Captured units can be taken to another asteroid

### Unit Spawning
- When a Guest joins an asteroid, they get 1 Unit spawned on the map
- Their camera immediately focuses on this unit
- This unit belongs to the Guest (ownerSlot = guest's slot)

---

## Cross-Asteroid Travel

### Visiting Another Asteroid
- From the menu, select another user's asteroid to visit
- Player brings exactly 1 Unit (chosen from their owned units)
- **Animation**: Unit launches vertically from current asteroid, lands vertically on destination
- Player can bring back 1 Unit (can be someone else's captured unit)

### Connection Loss
- If connection drops, player respawns on the asteroid they were on
- Must use a unit to travel back to their own asteroid

### Short-term Implementation
- Menu lists online users/asteroids
- Select destination → travel with 1 unit
- Return with 1 unit

---

## Fog of War (FOW)

### Per-User, 3 States
| State | Description | Visual |
|-------|-------------|--------|
| **A: Never Seen** | Completely unknown territory | Full black/fog |
| **B: Explored** | Seen before but no current vision | Dimmed/greyed |
| **C: Currently Visible** | Active vision from owned units | Full brightness |

### Vision Rules
- Vision comes from **units you currently own** (ownerSlot = mySlot)
- When a unit moves, state C expands and state B grows (explored area)
- Losing a unit: its contribution to C is removed, but B (explored) stays
- Regaining a unit: its vision area returns to C

### FOW Sharing
- Toggle per-player: "Share my FOW with Player X"
- Sharing is **global** (applies across all asteroids, not per-asteroid)
- Both players can independently toggle sharing
- Allies share FOW, enemies don't (but alliances can change)

---

## Multiplayer Architecture

### Session Lifecycle
1. User registers → gets persistent asteroid
2. User launches game → authenticated, loads their asteroid
3. Other users can join at any time (lobby shows active asteroids)
4. Players join/leave freely (no "game start" barrier in the future)
5. Game state persists in real-time (no save/load needed)
6. Session ends only when explicitly deleted (console button)

### Lobby & Discovery
- On game start, show list of active asteroids anyone can join
- Console button to delete/reset running games
- Room code system for direct invite

### State Sync
- New player joining receives full state snapshot
- Must see exactly what everyone else sees
- All state mutations go through deterministic command pipeline

---

## Social Dynamics

### Alliances
- No formal alliance system (initially)
- FOW sharing = implicit alliance signal
- Players can cooperate or compete freely

### Scenario Example
> Two users visit Player A's asteroid and establish a base. Player A tries to fight them off but fails. Player A calls friends for help. Together they defeat the invaders, capturing their disabled units. The captured units become Player A's property (in ownership history).

---

## Implementation Phases

### Phase 1: CURRENT (R013 M07-M08)
- [x] Unit seat/ownership model (selectedBySlot + ownerSlot)
- [x] PIN capture mechanic
- [x] Join UI (JoinOverlay v2)
- [x] Host migration on disconnect
- [x] Slice 2: Command execution on Guest
- [x] StateHash sampling
- [ ] Bug fixes (5 CRITICAL determinism issues)
- [ ] Guest gets unit on join
- [ ] Ownership history array on Unit

### Phase 2: FOW (R013 M09)
- [ ] Per-user explored texture (state A/B/C)
- [ ] Vision from owned units
- [ ] FOW sharing toggle

### Phase 3: Multi-Asteroid (R014+)
- [ ] User registration + persistent asteroid per user
- [ ] Asteroid list / lobby browser
- [ ] Cross-asteroid travel (vertical launch/land)
- [ ] Bring 1 unit / take 1 unit
- [ ] Real-time persistence (Supabase state)

### Phase 4: Gameplay (R015+)
- [ ] Combat system
- [ ] Resource system
- [ ] Base building
- [ ] Backend-as-host (eliminate client host)
