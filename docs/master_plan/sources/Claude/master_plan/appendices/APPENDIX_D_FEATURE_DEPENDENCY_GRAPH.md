# APPENDIX D: FEATURE DEPENDENCY GRAPH

**Parent Document:** [Master Development Plan v1 (Claude)](../MASTER_DEVELOPMENT_PLAN_v1_CLAUDE.md)
**Scope:** Visual dependency maps, unlock chains, interaction matrices

---

## 1. Core Feature Dependency Tree

### 1.1 ASCII Dependency Graph

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
        │ See surroundings  │  │ Unlock features│  │ Create types   │
        └─────────┬─────────┘  └────────────────┘  └────────────────┘
                  │
                  │ "Unit cannot move"
                  ▼
        ┌───────────────────┐
        │ NEED: EXPLORE     │ ───────────────┐
        └─────────┬─────────┘                │
                  │ Research                  │
                  ▼                           │
        ┌───────────────────┐                │
        │ MOVE_ROLL         │ ◄──────────────┘
        │ (Unlocked)        │
        │ Wheeled movement  │
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
        │ SUBSURFACE_SCAN   │
        │ (Unlocked)        │
        │ Find underground  │
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
        │ MATERA_MINING     │
        │ (Unlocked)        │
        │ Extract resources │
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
        │ MATERA_TRANSPORT  │
        │ (Unlocked)        │
        │ Haul to base      │
        └─────────┬─────────┘
                  │
          ┌───────┴───────┐
          │               │
          ▼               ▼
┌─────────────────┐  ┌─────────────────┐
│ NEED: COMBAT    │  │ NEED: SURFACE   │
│ (Enemy appears) │  │ CONTROL (Height)│
└────────┬────────┘  └────────┬────────┘
         │ Research           │ Research
         ▼                    ▼
┌─────────────────┐  ┌─────────────────┐
│ WPN_SHOOT       │  │ TERRAIN_SHAPING │
│ (Unlocked)      │  │ (Unlocked)      │
│ Combat ability  │  │ Modify terrain  │
└─────────────────┘  └─────────────────┘

         │
         │ "Need to deploy designed units"
         ▼
┌─────────────────┐
│ NEED: DEPLOY    │
└────────┬────────┘
         │ Research
         ▼
┌─────────────────┐
│ UNIT_CARRIER    │
│ (Unlocked)      │
│ Transport units │
└─────────────────┘
```

### 1.2 Tabular Unlock Chain

| Order | Feature | Trigger | Prerequisite |
|-------|---------|---------|--------------|
| 0 | OPTICAL_VISION | Game Start | None |
| 0 | SYS_RESEARCH | Game Start | None |
| 0 | SYS_DESIGN | Game Start | None |
| 0 | SYS_PRODUCTION | Game Start | None |
| 1 | MOVE_ROLL | "Explore" need | SYS_RESEARCH |
| 2 | SUBSURFACE_SCAN | "Discover" need | MOVE_ROLL, OPTICAL_VISION |
| 3 | MATERA_MINING | "Gather" need | SUBSURFACE_SCAN |
| 4 | MATERA_TRANSPORT | "Collect" need | MATERA_MINING |
| 5a | WPN_SHOOT | "Combat" need | Any enemy encounter |
| 5b | TERRAIN_SHAPING | "Surface Control" need | Height obstacle |
| 6 | UNIT_CARRIER | "Deploy" need | SYS_PRODUCTION, design exists |

---

## 2. Feature Interaction Matrix

### 2.1 Lane Exclusivity

Features occupy lanes. Within a lane, only one action can execute at a time.

| Lane | Features | Mutual Exclusivity |
|------|----------|-------------------|
| LOCOMOTION | MOVE_ROLL, UNIT_CARRIER, MATERA_TRANSPORT | Only one active |
| TOOL | MATERA_MINING, TERRAIN_SHAPING | Only one active |
| WEAPON | WPN_SHOOT | N/A (only one weapon) |
| PERCEPTION | SUBSURFACE_SCAN | N/A |
| None (Passive) | OPTICAL_VISION | Always active |

### 2.2 Cross-Lane Compatibility

```
              │ MOVE  │ SHOOT │ MINE  │ TRANS │ SHAPE │ SCAN  │ VISION│
─────────────────────────────────────────────────────────────────────────
MOVE_ROLL     │   -   │  ✓    │  ✗    │  ✗    │  ✗    │  ✓    │  ✓    │
WPN_SHOOT     │   ✓   │   -   │  ✓    │  ✓    │  ✓    │  ✓    │  ✓    │
MATERA_MINING │   ✗   │  ✓    │   -   │  ✗    │  ✗    │  ✓    │  ✓    │
MATERA_TRANS  │   ✗   │  ✓    │  ✗    │   -   │  ✗    │  ✓    │  ✓    │
TERRAIN_SHAPE │   ✗   │  ✓    │  ✗    │  ✗    │   -   │  ✓    │  ✓    │
SUBSURFACE    │   ✓   │  ✓    │  ✓    │  ✓    │  ✓    │   -   │  ✓    │
OPTICAL       │   ✓   │  ✓    │  ✓    │  ✓    │  ✓    │  ✓    │   -   │
```

**Legend:**
- ✓ = Can execute simultaneously
- ✗ = Mutually exclusive (one pauses)

### 2.3 Key Interactions

| Combo | Behavior | Example |
|-------|----------|---------|
| Move + Shoot | Kiting enabled | Fire while retreating |
| Move + Mine | Mining pauses | Must stop to drill |
| Move + Transport | Hauling active | Carry Matera while moving |
| Mine + Shape | Mutually exclusive | Same tool lane |
| Scan + Move | Both active | Scout while scanning |

---

## 3. Central Unit Starting Configuration

### 3.1 Default Allocations

The Central Unit starts with four system features:

| Feature | Allocation | Purpose |
|---------|------------|---------|
| OPTICAL_VISION | 25% | See surroundings |
| SYS_RESEARCH | 25% | Unlock new features |
| SYS_DESIGN | 25% | Create blueprints |
| SYS_PRODUCTION | 25% | Build units |

**Total:** 100%

### 3.2 Limitation: Cannot Move

The Central Unit has no MOVE_* feature, making it stationary until MOVE_ROLL is invented and a mobile unit is produced.

```
Central Unit Blueprint:
┌────────────────────────────────────────┐
│  Name: CENTRAL  Version: 10            │
├────────────────────────────────────────┤
│  [■■■■■░░░░░░░░░░░░░░] OPTICAL_VISION  │
│  [■■■■■░░░░░░░░░░░░░░] SYS_RESEARCH    │
│  [■■■■■░░░░░░░░░░░░░░] SYS_DESIGN      │
│  [■■■■■░░░░░░░░░░░░░░] SYS_PRODUCTION  │
├────────────────────────────────────────┤
│  MOVE_ROLL: Not included               │
│  Status: STATIONARY                    │
└────────────────────────────────────────┘
```

---

## 4. Feature Implementation Dependencies

### 4.1 Code Dependencies

```
SimCore Foundation (Releases 001-006)
    │
    ├── CommandQueue
    ├── StateRegistry
    ├── EventBus
    └── ITransport
          │
          ▼
Feature Framework (Release 007)
    │
    ├── FeatureRegistry
    ├── StatsEngine
    └── IFeatureModule interface
          │
          ├─────────────────────────────────────────────┐
          │                   │                         │
          ▼                   ▼                         ▼
    MOVE_ROLL (011)    OPTICAL_VISION (012)    SUBSURFACE_SCAN (016)
          │                   │                         │
          │                   │                         │
          │                   └─────────────────────────┤
          │                                             │
          ├─────────────────────────────────────────────┤
          │                   │                         │
          ▼                   ▼                         ▼
    MINING (013)       TRANSPORT (014)         WPN_SHOOT (015)
          │                   │
          │                   │
          └───────────────────┤
                              │
                              ▼
                    TERRAIN_SHAPING (017)
                              │
                              ▼
                    UNIT_CARRIER (018)
```

### 4.2 Data Dependencies

| Feature | Requires Data From |
|---------|-------------------|
| MOVE_ROLL | TerrainQuery (height, slope) |
| OPTICAL_VISION | Entity positions, FOW state |
| SUBSURFACE_SCAN | Deposit registry |
| MATERA_MINING | Deposit data, pile registry |
| MATERA_TRANSPORT | Pile positions, base positions |
| WPN_SHOOT | Target entity positions |
| TERRAIN_SHAPING | TerrainModification system |
| UNIT_CARRIER | Entity attachment system |

---

## 5. Gameplay Flow Visualization

### 5.1 Early Game Loop

```
┌──────────────────────────────────────────────────────────────────────┐
│                        EARLY GAME LOOP                                │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  1. OBSERVE (Optical Vision reveals terrain)                         │
│         │                                                             │
│         ▼                                                             │
│  2. IDENTIFY NEED ("I can't explore!")                               │
│         │                                                             │
│         ▼                                                             │
│  3. RESEARCH (Unlock MOVE_ROLL)                                      │
│         │                                                             │
│         ▼                                                             │
│  4. DESIGN (Create mobile unit blueprint)                            │
│         │                                                             │
│         ▼                                                             │
│  5. PRODUCE (Build the mobile unit)                                  │
│         │                                                             │
│         ▼                                                             │
│  6. EXPLORE (Move unit, reveal map)                                  │
│         │                                                             │
│         └───────────────────────────────────────────────────────────►│
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

### 5.2 Resource Loop

```
┌──────────────────────────────────────────────────────────────────────┐
│                        RESOURCE LOOP                                  │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  1. SCAN (Subsurface Scan finds deposit)                             │
│         │                                                             │
│         ▼                                                             │
│  2. MINE (Mining unit extracts Matera)                               │
│         │                                                             │
│         ▼                                                             │
│  3. PILE (Surface pile accumulates)                                  │
│         │                                                             │
│         ▼                                                             │
│  4. TRANSPORT (Hauler collects and delivers)                         │
│         │                                                             │
│         ▼                                                             │
│  5. PRODUCE (Factory uses resources)                                 │
│         │                                                             │
│         └───────────────────────────────────────────────────────────►│
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

### 5.3 Combat Loop

```
┌──────────────────────────────────────────────────────────────────────┐
│                        COMBAT LOOP                                    │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  1. DETECT (Optical Vision spots enemy)                              │
│         │                                                             │
│         ▼                                                             │
│  2. EVALUATE (Compare unit capabilities)                             │
│         │                                                             │
│         ├─── Advantage? ──► ENGAGE (Attack with WPN_SHOOT)           │
│         │                          │                                  │
│         └─── Disadvantage? ──► RETREAT (Use MOVE_ROLL)               │
│                                    │                                  │
│                                    ▼                                  │
│                              RESEARCH (Improve weapons/armor)         │
│                                    │                                  │
│                                    ▼                                  │
│                              DESIGN (Better combat units)             │
│                                    │                                  │
│                                    └────────────────────────────────►│
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 6. Feature Statistics Overview

### 6.1 MOVE_ROLL Stats

| Stat | Base Value | Affected By |
|------|------------|-------------|
| maxSpeed | 10 m/s | Allocation, Extend, Training |
| acceleration | 5 m/s² | Allocation, Training |
| grip | 0.8 | Allocation, Training |
| torque | 50 | Allocation, Extend, Training |

**Constraints:**
| Constraint | Base | Extendable |
|------------|------|------------|
| maxClimbAngle | 40° | Yes (to 60°) |

### 6.2 WPN_SHOOT Stats (4-Axis)

| Axis | Base | Range | Effect |
|------|------|-------|--------|
| Power | 25% | 0-100% | Damage per shot |
| Rate | 25% | 0-100% | Shots per second |
| Range | 25% | 0-100% | Effective distance |
| Accuracy | 25% | 0-100% | Hit probability |

### 6.3 OPTICAL_VISION Stats

| Stat | Base Value | Affected By |
|------|------------|-------------|
| visionRange | 30 m | Allocation, Extend, Training |

### 6.4 MATERA_MINING Stats

| Stat | Base Value | Affected By |
|------|------------|-------------|
| extractionRate | 5 units/s | Allocation, Training |

### 6.5 MATERA_TRANSPORT Stats

| Stat | Base Value | Affected By |
|------|------------|-------------|
| cargoCapacity | 100 units | Allocation, Extend |
| speedPenalty | 50% when full | - |

---

## 7. Testing Feature Dependencies

### 7.1 Unit Tests

```javascript
describe('Feature Dependencies', () => {
  it('MOVE_ROLL cannot be allocated when LOCKED', () => {
    const registry = new FeatureRegistry();
    expect(registry.get('MOVE_ROLL').status).toBe('LOCKED');

    const designer = new Designer(simCore);
    expect(() => designer.createBlueprint({
      features: { 'MOVE_ROLL': { allocation: 50 } }
    })).toThrow('Feature MOVE_ROLL is not unlocked');
  });

  it('Unlocking MOVE_ROLL allows allocation', () => {
    simCore.featureRegistry.get('MOVE_ROLL').status = 'UNLOCKED';

    const blueprint = designer.createBlueprint({
      features: {
        'MOVE_ROLL': { allocation: 50 },
        'OPTICAL_VISION': { allocation: 50 }
      }
    });

    expect(blueprint.features['MOVE_ROLL'].allocation).toBe(50);
  });

  it('Lane exclusivity prevents simultaneous MINE and SHAPE', () => {
    const unit = createTestUnit(['MATERA_MINING', 'TERRAIN_SHAPING']);

    unit.queueCommand({ type: 'MINE', depositId: 'd1' });
    unit.queueCommand({ type: 'SHAPE', position: [0, 0, 0] });

    simCore.step();

    expect(unit.unitData.activeLane.TOOL).toBe('MATERA_MINING');
    expect(unit.pendingCommands).toContainEqual(expect.objectContaining({ type: 'SHAPE' }));
  });
});
```

### 7.2 Integration Tests

```javascript
describe('Unlock Chain Integration', () => {
  it('completes full early game unlock chain', async () => {
    // Start game
    const game = new GameSession();
    expect(game.featureRegistry.get('MOVE_ROLL').status).toBe('LOCKED');

    // Trigger NEED_EXPLORE
    game.eventBus.emit('CENTRAL_UNIT_STUCK');
    expect(game.goalEvaluator.activeNeeds.has('NEED_EXPLORE')).toBe(true);

    // Research MOVE_ROLL
    await game.researchLab.completeResearch('MOVE_ROLL');
    expect(game.featureRegistry.get('MOVE_ROLL').status).toBe('UNLOCKED');

    // Design mobile unit
    const blueprint = game.designer.createBlueprint({
      features: {
        'MOVE_ROLL': { allocation: 50 },
        'OPTICAL_VISION': { allocation: 50 }
      }
    });

    // Produce unit
    const unit = await game.factory.produceAndWait(blueprint.id);
    expect(unit.unitData.blueprintId).toBe(blueprint.id);

    // Move unit
    game.queueCommand({ type: 'MOVE', unitIds: [unit.id], position: [100, 0, 0] });
    game.advanceTicks(100);
    expect(unit.position[0]).toBeGreaterThan(0);
  });
});
```

---

*End of Appendix D*
