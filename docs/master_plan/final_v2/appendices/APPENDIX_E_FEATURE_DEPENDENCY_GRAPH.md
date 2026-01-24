# APPENDIX E: FEATURE DEPENDENCY GRAPH

**Parent Document:** [MASTER_PLAN_FINAL_v2.md](../MASTER_PLAN_FINAL_v2.md)
**Canonical Source:** `spec_sources/ASTEROBIA_CANONICAL_MASTER_BIBLE_2026-01-13.md`
**Scope:** Feature unlock chains, interaction matrix, implementation dependencies

---

## 1. Unlock Chain (Demo 1.0)

### 1.1 ASCII Dependency Tree

```
                              ┌─────────────────────┐
                              │   GAME START        │
                              │   Central Unit      │
                              │   (Stationary)      │
                              └─────────┬───────────┘
                                        │
                    ┌───────────────────┼───────────────────┐
                    │                   │                   │
                    ▼                   ▼                   ▼
        ┌───────────────────┐  ┌────────────────┐  ┌────────────────┐
        │ OPTICAL_VISION    │  │ SYS_RESEARCH   │  │ SYS_DESIGN     │
        │ (Pre-unlocked)    │  │ (Pre-unlocked) │  │ (Pre-unlocked) │
        └─────────┬─────────┘  └────────────────┘  └────────────────┘
                  │
                  │ "Unit cannot move"
                  ▼
        ┌───────────────────┐
        │ NEED: EXPLORE     │
        └─────────┬─────────┘
                  │ Research
                  ▼
        ┌───────────────────┐
        │ MOVE_ROLL         │◄──────────────── Unlock #1
        │ (Wheeled movement)│
        └─────────┬─────────┘
                  │
                  │ "See surface Matera"
                  ▼
        ┌───────────────────┐
        │ NEED: DISCOVER    │
        └─────────┬─────────┘
                  │ Research
                  ▼
        ┌───────────────────┐
        │ SUBSURFACE_SCAN   │◄──────────────── Unlock #2
        │ (Underground scan)│
        └─────────┬─────────┘
                  │
                  │ "Underground Matera found"
                  ▼
        ┌───────────────────┐
        │ NEED: GATHER      │
        └─────────┬─────────┘
                  │ Research
                  ▼
        ┌───────────────────┐
        │ MATERA_MINING     │◄──────────────── Unlock #3
        │ (Extract resource)│
        └─────────┬─────────┘
                  │
                  │ "Surface pile exists"
                  ▼
        ┌───────────────────┐
        │ NEED: COLLECT     │
        └─────────┬─────────┘
                  │ Research
                  ▼
        ┌───────────────────┐
        │ MATERA_TRANSPORT  │◄──────────────── Unlock #4
        │ (Haul resources)  │
        └─────────┬─────────┘
                  │
          ┌───────┴───────┐
          │               │
          ▼               ▼
┌─────────────────┐ ┌─────────────────┐
│ NEED: COMBAT    │ │ NEED: SURFACE   │
│ (Enemy appears) │ │ CONTROL (Height)│
└────────┬────────┘ └────────┬────────┘
         │ Research          │ Research
         ▼                   ▼
┌─────────────────┐ ┌─────────────────┐
│ WPN_SHOOT       │ │ TERRAIN_SHAPING │◄─── Stretch
│ (Combat)        │ │ (Modify terrain)│
│ Unlock #7       │ │ Unlock #5       │
└─────────────────┘ └─────────────────┘


        ┌───────────────────┐
        │ NEED: DEPLOY      │ (Non-mobile design created)
        └─────────┬─────────┘
                  │ Research
                  ▼
        ┌───────────────────┐
        │ UNIT_CARRIER      │◄──────────────── Stretch (#6)
        │ (Transport units) │
        └───────────────────┘
```

### 1.2 Tabular Unlock Chain

| Order | Trigger Condition | Need Label | Feature ID | Lane |
|-------|-------------------|------------|------------|------|
| 0 | Game Start | - | OPTICAL_VISION | Passive |
| 0 | Game Start | - | SYS_RESEARCH | N/A |
| 0 | Game Start | - | SYS_DESIGN | N/A |
| 0 | Game Start | - | SYS_PRODUCTION | N/A |
| 1 | Central Unit stuck | "Explore" | MOVE_ROLL | LOCOMOTION |
| 2 | Surface Matera visible | "Discover" | SUBSURFACE_SCAN | PERCEPTION |
| 3 | Underground Matera found | "Gather" | MATERA_MINING | TOOL |
| 4 | Pile accumulates | "Collect" | MATERA_TRANSPORT | LOCOMOTION |
| 5* | Height obstacle | "Surface Control" | TERRAIN_SHAPING | TOOL |
| 6* | Non-mobile design | "Deploy" | UNIT_CARRIER | LOCOMOTION |
| 7 | Enemy detected | "Combat" | WPN_SHOOT | WEAPON |

*Stretch features - may occur in different order based on gameplay

---

## 2. Feature Interaction Matrix

### 2.1 Lane Exclusivity

| Lane | Features | Rule |
|------|----------|------|
| LOCOMOTION | MOVE_ROLL, MATERA_TRANSPORT, UNIT_CARRIER | Only one active at a time |
| TOOL | MATERA_MINING, TERRAIN_SHAPING | Only one active at a time |
| WEAPON | WPN_SHOOT | Single weapon per unit |
| PERCEPTION | SUBSURFACE_SCAN | Toggleable action |
| N/A | OPTICAL_VISION | Always on (passive) |

### 2.2 Cross-Lane Compatibility

```
              │ MOVE │SHOOT │ MINE │TRANS │SHAPE │ SCAN │VISION
──────────────┼──────┼──────┼──────┼──────┼──────┼──────┼──────
MOVE_ROLL     │  -   │  ✓   │  ✗   │  ✗   │  ✗   │  ✓   │  ✓
WPN_SHOOT     │  ✓   │  -   │  ✓   │  ✓   │  ✓   │  ✓   │  ✓
MATERA_MINING │  ✗   │  ✓   │  -   │  ✗   │  ✗   │  ✓   │  ✓
MATERA_TRANS  │  ✗   │  ✓   │  ✗   │  -   │  ✗   │  ✓   │  ✓
TERRAIN_SHAPE │  ✗   │  ✓   │  ✗   │  ✗   │  -   │  ✓   │  ✓
SUBSURFACE    │  ✓   │  ✓   │  ✓   │  ✓   │  ✓   │  -   │  ✓
OPTICAL       │  ✓   │  ✓   │  ✓   │  ✓   │  ✓   │  ✓   │  -
```

**Legend:**
- ✓ = Can run simultaneously
- ✗ = Mutually exclusive (one pauses the other)

### 2.3 Key Interactions

| Combo | Behavior |
|-------|----------|
| Move + Shoot | Kiting enabled (fire while retreating) |
| Move + Mine | Mining pauses (requires stationary) |
| Move + Scan | Both active (scout while scanning) |
| Mine + Shape | Mutually exclusive (same TOOL lane) |
| Transport + Move | Only one LOCOMOTION active |

---

## 3. Code Dependencies

### 3.1 SimCore Module Dependencies

```
SimCore Foundation (Releases 001-006)
    │
    ├── GameLoop (001)
    ├── CommandQueue (002)
    ├── IdGenerator (003)
    ├── SeededRNG (004)
    ├── StateRegistry (005)
    └── ITransport (006)
          │
          ▼
Feature Framework (Release 007)
    │
    ├── FeatureRegistry
    ├── StatsEngine
    └── IFeatureModule interface
          │
          ├─────────────────────────────────────────┐
          │                   │                     │
          ▼                   ▼                     ▼
    MOVE_ROLL (011)    OPTICAL_VISION (012)  SUBSURFACE_SCAN (016)
          │                   │                     │
          ├───────────────────┴─────────────────────┤
          │                   │                     │
          ▼                   ▼                     ▼
    MINING (013)       TRANSPORT (014)       WPN_SHOOT (015)
          │                   │
          └───────────────────┤
                              │
                              ▼
                    TERRAIN_SHAPING (017)
                              │
                              ▼
                    UNIT_CARRIER (018)
```

### 3.2 Data Dependencies

| Feature | Requires Data From |
|---------|-------------------|
| MOVE_ROLL | TerrainQuery (height, slope, normal) |
| OPTICAL_VISION | Entity positions, FOW service |
| SUBSURFACE_SCAN | Deposit registry, terrain depth |
| MATERA_MINING | Deposit data, pile registry |
| MATERA_TRANSPORT | Pile positions, base positions |
| WPN_SHOOT | Target entity positions, LOS check |
| TERRAIN_SHAPING | TerrainModification system |
| UNIT_CARRIER | Entity attachment system |

---

## 4. Central Unit Configuration

### 4.1 Starting Allocation (Canonical)

| Feature | Allocation |
|---------|------------|
| OPTICAL_VISION | 25% |
| SYS_RESEARCH | 25% |
| SYS_DESIGN | 25% |
| SYS_PRODUCTION | 25% |
| **Total** | 100% |

### 4.2 Limitations

- **Cannot move:** No MOVE_* feature
- **Stationary:** Until MOVE_ROLL invented and mobile unit produced
- **Vision only:** Can see surroundings but cannot explore

---

## 5. Future Features (Post-Demo)

| Feature | Lane | Trigger |
|---------|------|---------|
| MOVE_SWIM | LOCOMOTION | Water collision |
| MOVE_FLY | LOCOMOTION | Altitude need |
| MOVE_CLIMB | LOCOMOTION | Slope > 60° |
| MOVE_TUNNEL | LOCOMOTION | Underground access |
| SUP_SHIELD | N/A | Instant death |
| SUP_STEALTH | N/A | Detection loss |
| ECO_GENERATOR | N/A | Low energy |
| ECO_TRANSMIT | N/A | Distant units offline |

---

*End of Appendix E*