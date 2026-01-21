# APPENDIX C: GRFDTRDPU IMPLEMENTATION

**Parent Document:** [Master Development Plan v1 (Claude)](../MASTER_DEVELOPMENT_PLAN_v1_CLAUDE.md)
**Scope:** Detailed implementation of the Goal-Research-Feature-Training-Design-Production-Upgrade pipeline

---

## 1. Pipeline Overview

The GRFDTRDPU pipeline is the meta-game loop that drives player progression. Each stage feeds into the next, creating an evolutionary gameplay experience.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           GRFDTRDPU PIPELINE                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  [G] GOALS     → Events trigger Needs ("I can't move!")                 │
│       │                                                                  │
│       ▼                                                                  │
│  [R] RESEARCH  → Invent new features or Extend existing ones            │
│       │                                                                  │
│       ▼                                                                  │
│  [F] FEATURES  → Unlocked capabilities become available                 │
│       │                                                                  │
│       ▼                                                                  │
│  [Tr] TRAINING → Player skill multipliers (mini-games)                  │
│       │                                                                  │
│       ▼                                                                  │
│  [D] DESIGN    → Create Blueprints with feature allocations             │
│       │                                                                  │
│       ▼                                                                  │
│  [P] PRODUCTION → Manufacture Units from Blueprints                     │
│       │                                                                  │
│       ▼                                                                  │
│  [U] UPGRADE   → Refit existing Units to new Blueprint versions         │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Goals (G) — Need Generation System

### 2.1 Event-Driven Architecture

Goals are generated reactively based on GameEvents. The GoalEvaluator subscribes to the EventBus and creates Need objects when trigger conditions are met.

```javascript
// src/SimCore/modules/GoalEvaluator.js
export class GoalEvaluator {
  constructor(simCore) {
    this.simCore = simCore;
    this.activeNeeds = new Map();
    this.cooldowns = new Map(); // Prevent spam

    // Subscribe to events
    simCore.eventBus.on('COLLISION_WATER', this.onCollisionWater.bind(this));
    simCore.eventBus.on('BLOCKED_BY_SLOPE', this.onBlockedBySlope.bind(this));
    simCore.eventBus.on('MATERA_DISCOVERED', this.onMateraDiscovered.bind(this));
    simCore.eventBus.on('ENEMY_SPOTTED', this.onEnemySpotted.bind(this));
    // ... more event handlers
  }

  onCollisionWater(event) {
    this.createNeed({
      id: 'NEED_SWIM',
      type: 'INVENT',
      label: 'Water Traversal',
      description: 'Units cannot cross water. Research swimming capability.',
      triggerEvent: 'COLLISION_WATER',
      reward: { featureId: 'MOVE_SWIM' },
      priority: 1
    });
  }

  onBlockedBySlope(event) {
    if (event.slopeAngle > 60) {
      this.createNeed({
        id: 'NEED_CLIMB',
        type: 'INVENT',
        label: 'Steep Terrain',
        description: 'Slopes above 60° are impassable. Research climbing or flying.',
        triggerEvent: 'BLOCKED_BY_SLOPE',
        reward: { featureId: 'MOVE_CLIMB' }, // or MOVE_FLY
        priority: 2
      });
    }
  }

  createNeed(needSpec) {
    // Cooldown check
    const cooldownKey = `${needSpec.type}_${needSpec.reward.featureId}`;
    if (this.cooldowns.has(cooldownKey)) {
      const lastTime = this.cooldowns.get(cooldownKey);
      if (this.simCore.tick - lastTime < 600) { // 30 seconds at 20Hz
        return; // Too soon, skip
      }
    }

    // Deduplication check
    if (this.activeNeeds.has(needSpec.id)) {
      return; // Already active
    }

    const need = {
      ...needSpec,
      status: 'AVAILABLE',
      createdAt: this.simCore.tick
    };

    this.activeNeeds.set(need.id, need);
    this.cooldowns.set(cooldownKey, this.simCore.tick);

    // Emit for UI
    this.simCore.eventBus.emit('NEED_CREATED', need);
  }

  resolveNeed(needId) {
    const need = this.activeNeeds.get(needId);
    if (need) {
      need.status = 'RESOLVED';
      this.activeNeeds.delete(needId);
      this.simCore.eventBus.emit('NEED_RESOLVED', need);
    }
  }
}
```

### 2.2 Canonical Need Mappings

**Source:** `MASTER_BIBLE` Demo 1.0 Unlock Chain

| Trigger Event | Need ID | Label | Reward |
|---------------|---------|-------|--------|
| Central Unit exists | NEED_EXPLORE | "Explore" | MOVE_ROLL |
| Surface Matera visible | NEED_DISCOVER_MATERA | "Discover Matera" | SUBSURFACE_SCAN |
| Underground Matera found | NEED_GATHER | "Gather Matera" | MATERA_MINING |
| Surface pile exists | NEED_COLLECT | "Collect Matera" | MATERA_TRANSPORT |
| Height diff > threshold | NEED_SURFACE_CONTROL | "Surface Control" | TERRAIN_SHAPING |
| Enemy unit spotted | NEED_COMBAT | "Combat Capability" | WPN_SHOOT |
| Design complete, no carrier | NEED_DEPLOY | "Deploy Unit" | UNIT_CARRIER |

### 2.3 Need UI Integration

```javascript
// UI displays active needs as cards
// Clicking a need opens the Research panel for that feature
```

---

## 3. Research (R) — Unlock System

### 3.1 Research Types

**INVENT:** Unlock a new feature (LOCKED → UNLOCKED)
**EXTEND:** Increase a constraint multiplier (Level 0 → Level 1...5)

### 3.2 Research Job Structure

```typescript
interface ResearchJob {
  id: string;
  type: 'INVENT' | 'EXTEND';
  featureId: string;
  constraintKey?: string; // For EXTEND only
  progress: number; // 0.0 to 1.0
  energyCost: number;
  timeCost: number; // Seconds
  researcherId: string; // Unit performing research
  status: 'QUEUED' | 'IN_PROGRESS' | 'COMPLETE' | 'CANCELLED';
}
```

### 3.3 Research Lab Implementation

```javascript
// src/SimCore/modules/ResearchLab.js
export class ResearchLab {
  constructor(simCore) {
    this.simCore = simCore;
    this.jobs = new Map();
    this.featureRegistry = simCore.featureRegistry;
  }

  canResearch(featureId, type, constraintKey = null) {
    const feature = this.featureRegistry.get(featureId);

    if (type === 'INVENT') {
      return feature.status === 'LOCKED';
    }

    if (type === 'EXTEND') {
      if (feature.status === 'LOCKED') return false;
      const currentLevel = feature.extend.levels[constraintKey] || 0;
      const maxLevel = feature.extend.caps[constraintKey] || 5;
      return currentLevel < maxLevel;
    }

    return false;
  }

  startResearch(unitId, featureId, type, constraintKey = null) {
    if (!this.canResearch(featureId, type, constraintKey)) {
      throw new Error('Cannot research: requirements not met');
    }

    const feature = this.featureRegistry.get(featureId);
    const cost = this.calculateCost(featureId, type, constraintKey);

    const job = {
      id: `research_${this.simCore.nextId++}`,
      type,
      featureId,
      constraintKey,
      progress: 0,
      energyCost: cost.energy,
      timeCost: cost.time,
      researcherId: unitId,
      status: 'IN_PROGRESS',
      startTick: this.simCore.tick
    };

    this.jobs.set(job.id, job);
    this.simCore.eventBus.emit('RESEARCH_STARTED', job);

    return job;
  }

  update() {
    for (const job of this.jobs.values()) {
      if (job.status !== 'IN_PROGRESS') continue;

      // Progress based on elapsed time
      const elapsedTicks = this.simCore.tick - job.startTick;
      const elapsedSeconds = elapsedTicks / 20; // 20Hz tick rate
      job.progress = Math.min(1.0, elapsedSeconds / job.timeCost);

      // Consume energy
      const energyPerTick = job.energyCost / (job.timeCost * 20);
      const researcher = this.simCore.getEntity(job.researcherId);
      if (researcher && researcher.unitData.energy >= energyPerTick) {
        researcher.unitData.energy -= energyPerTick;
      } else {
        // Pause research if no energy
        job.status = 'PAUSED';
        continue;
      }

      if (job.progress >= 1.0) {
        this.completeResearch(job);
      }
    }
  }

  completeResearch(job) {
    job.status = 'COMPLETE';
    job.progress = 1.0;

    const feature = this.featureRegistry.get(job.featureId);

    if (job.type === 'INVENT') {
      feature.status = 'UNLOCKED';
      this.simCore.eventBus.emit('FEATURE_UNLOCKED', { featureId: job.featureId });

      // Resolve associated need
      this.simCore.goalEvaluator.resolveNeed(`NEED_${job.featureId}`);
    }

    if (job.type === 'EXTEND') {
      feature.extend.levels[job.constraintKey] =
        (feature.extend.levels[job.constraintKey] || 0) + 1;
      this.simCore.eventBus.emit('FEATURE_EXTENDED', {
        featureId: job.featureId,
        constraintKey: job.constraintKey,
        newLevel: feature.extend.levels[job.constraintKey]
      });
    }

    this.jobs.delete(job.id);
    this.simCore.eventBus.emit('RESEARCH_COMPLETE', job);
  }

  calculateCost(featureId, type, constraintKey) {
    // Base costs (tunable)
    const baseCosts = {
      INVENT: { energy: 100, time: 30 }, // 30 seconds
      EXTEND: { energy: 50, time: 15 }   // 15 seconds per level
    };

    const base = baseCosts[type];

    if (type === 'EXTEND') {
      const feature = this.featureRegistry.get(featureId);
      const currentLevel = feature.extend.levels[constraintKey] || 0;
      // Exponential cost increase
      return {
        energy: base.energy * Math.pow(1.5, currentLevel),
        time: base.time * Math.pow(1.3, currentLevel)
      };
    }

    return base;
  }
}
```

### 3.4 Extend Multiplier Formula

**Canonical Formula:**
```javascript
ExtendMultiplier(level) = 1.0 + (level * 0.5)
```

| Level | Multiplier |
|-------|------------|
| 0 | 1.0x |
| 1 | 1.5x |
| 2 | 2.0x |
| 3 | 2.5x |
| 4 | 3.0x |
| 5 | 3.5x (cap) |

---

## 4. Features (F) — Runtime Modules

### 4.1 Feature Registry Structure

```javascript
// src/SimCore/domain/FeatureRegistry.js
export class FeatureRegistry {
  constructor() {
    this.features = new Map();
    this.initializeFeatures();
  }

  initializeFeatures() {
    // Movement
    this.register({
      id: 'MOVE_ROLL',
      category: 'LOCOMOTION',
      lane: 'LOCOMOTION',
      type: 'ACTION',
      status: 'LOCKED',
      baseStats: {
        maxSpeed: 10,
        acceleration: 5,
        grip: 0.8,
        torque: 50
      },
      constraints: {
        maxClimbAngle: 40
      },
      extend: {
        levels: {},
        caps: { maxClimbAngle: 5, maxSpeed: 5 }
      },
      training: {
        highScore: 0,
        multiplier: 1.0
      }
    });

    // Combat
    this.register({
      id: 'WPN_SHOOT',
      category: 'COMBAT',
      lane: 'WEAPON',
      type: 'ACTION',
      status: 'LOCKED',
      baseStats: {
        baseDamage: 10,
        baseFireRate: 1.0,
        baseRange: 50,
        baseAccuracy: 0.8
      },
      constraints: {},
      extend: {
        levels: {},
        caps: { baseDamage: 5, baseRange: 5 }
      },
      axes: {
        power: { default: 25, min: 0, max: 100 },
        rate: { default: 25, min: 0, max: 100 },
        range: { default: 25, min: 0, max: 100 },
        accuracy: { default: 25, min: 0, max: 100 }
      },
      training: { highScore: 0, multiplier: 1.0 }
    });

    // Perception (Passive)
    this.register({
      id: 'PERCEPTION_OPTICAL',
      category: 'PERCEPTION',
      lane: null, // Passive, no lane
      type: 'PASSIVE',
      status: 'UNLOCKED', // Central unit starts with this
      baseStats: {
        visionRange: 30
      },
      constraints: {},
      extend: {
        levels: {},
        caps: { visionRange: 5 }
      },
      training: { highScore: 0, multiplier: 1.0 }
    });

    // ... more features
  }

  register(featureSpec) {
    this.features.set(featureSpec.id, featureSpec);
  }

  get(featureId) {
    return this.features.get(featureId);
  }

  getUnlocked() {
    return Array.from(this.features.values())
      .filter(f => f.status === 'UNLOCKED');
  }

  getLocked() {
    return Array.from(this.features.values())
      .filter(f => f.status === 'LOCKED');
  }
}
```

### 4.2 Feature Module Interface

```javascript
// Each feature implements this interface
export interface IFeatureModule {
  id: string;
  update(entity: Entity, deltaTime: number): void;
  onActivate(entity: Entity): void;
  onDeactivate(entity: Entity): void;
  getEffectiveStats(entity: Entity): EffectiveStats;
}
```

---

## 5. Training (Tr) — Player Skill Multipliers

### 5.1 Training Mechanic

Training is a mini-game that tests player skill with a specific feature. Higher scores provide permanent multipliers.

```javascript
// src/SimCore/modules/TrainingCenter.js
export class TrainingCenter {
  constructor(simCore) {
    this.simCore = simCore;
    this.activeSessions = new Map();
  }

  startTraining(featureId) {
    const feature = this.simCore.featureRegistry.get(featureId);
    if (!feature || feature.status !== 'UNLOCKED') {
      throw new Error('Cannot train locked feature');
    }

    const session = {
      id: `train_${this.simCore.nextId++}`,
      featureId,
      startTime: Date.now(),
      duration: 60000, // 60 seconds
      score: 0,
      status: 'IN_PROGRESS'
    };

    this.activeSessions.set(session.id, session);
    return session;
  }

  submitScore(sessionId, score) {
    const session = this.activeSessions.get(sessionId);
    if (!session || session.status !== 'IN_PROGRESS') return;

    session.score = Math.max(0, Math.min(100, score)); // Clamp 0-100
    session.status = 'COMPLETE';

    const feature = this.simCore.featureRegistry.get(session.featureId);

    // Update high score if beaten
    if (session.score > feature.training.highScore) {
      feature.training.highScore = session.score;
      feature.training.multiplier = 1.0 + (session.score / 100);

      this.simCore.eventBus.emit('TRAINING_HIGH_SCORE', {
        featureId: session.featureId,
        score: session.score,
        multiplier: feature.training.multiplier
      });
    }

    this.activeSessions.delete(sessionId);
    return feature.training;
  }
}
```

### 5.2 Training Multiplier Formula

```javascript
TrainingMultiplier = 1.0 + (HighScore / 100)
```

| High Score | Multiplier |
|------------|------------|
| 0 | 1.0x |
| 50 | 1.5x |
| 100 | 2.0x |

### 5.3 Training Mini-Game Ideas

| Feature | Training Type |
|---------|---------------|
| MOVE_ROLL | Navigate obstacle course |
| WPN_SHOOT | Target shooting accuracy |
| PERCEPTION_OPTICAL | Spot hidden enemies |
| MATERA_MINING | Click timing puzzle |

---

## 6. Design (D) — Blueprint System

### 6.1 Blueprint Structure

```typescript
interface Blueprint {
  id: string;
  ownerId: string;
  name: string; // "MORDIG"
  version: number; // 10 = 100% capacity
  features: Record<string, FeatureAllocation>;
  visualSeed: number;
  modelUrl?: string;
  createdAt: number;
}

interface FeatureAllocation {
  allocation: number; // 0-100, sum must equal 100
  axes?: Record<string, number>; // For features with internal axes
}
```

### 6.2 Designer Module

```javascript
// src/SimCore/modules/Designer.js
export class Designer {
  constructor(simCore) {
    this.simCore = simCore;
    this.blueprints = new Map();
  }

  createBlueprint(spec) {
    // Validate allocations sum to 100
    const totalAllocation = Object.values(spec.features)
      .reduce((sum, f) => sum + f.allocation, 0);

    if (totalAllocation !== 100) {
      throw new Error(`Allocations must sum to 100, got ${totalAllocation}`);
    }

    // Validate minimum allocation (20% if included)
    for (const [featureId, alloc] of Object.entries(spec.features)) {
      if (alloc.allocation > 0 && alloc.allocation < 20) {
        throw new Error(`Feature ${featureId} must have >= 20% allocation`);
      }

      // Validate feature is unlocked
      const feature = this.simCore.featureRegistry.get(featureId);
      if (!feature || feature.status !== 'UNLOCKED') {
        throw new Error(`Feature ${featureId} is not unlocked`);
      }
    }

    // Generate name if not provided
    const name = spec.name || this.generateName();
    const version = Math.floor(totalAllocation / 10); // 100% = version 10

    const blueprint = {
      id: `bp_${this.simCore.nextId++}`,
      ownerId: spec.ownerId,
      name,
      version,
      features: spec.features,
      visualSeed: spec.visualSeed || Math.floor(this.simCore.rng() * 1000000),
      createdAt: this.simCore.tick
    };

    this.blueprints.set(blueprint.id, blueprint);
    this.simCore.eventBus.emit('BLUEPRINT_CREATED', blueprint);

    return blueprint;
  }

  generateName() {
    // C-V-C-C-V-C pattern
    const consonants = 'BCDFGHJKLMNPRSTVWXZ';
    const vowels = 'AEIOU';

    const pick = (str) => str[Math.floor(this.simCore.rng() * str.length)];

    return pick(consonants) + pick(vowels) + pick(consonants) +
           pick(consonants) + pick(vowels) + pick(consonants);
  }

  upgradeBlueprint(blueprintId, additionalCapacity) {
    const blueprint = this.blueprints.get(blueprintId);
    if (!blueprint) throw new Error('Blueprint not found');

    // Validate increment (10% steps)
    if (additionalCapacity % 10 !== 0) {
      throw new Error('Capacity must increase in 10% steps');
    }

    // Create new version
    const newVersion = blueprint.version + (additionalCapacity / 10);
    const newBlueprint = {
      ...blueprint,
      id: `bp_${this.simCore.nextId++}`,
      version: newVersion,
      createdAt: this.simCore.tick
    };

    this.blueprints.set(newBlueprint.id, newBlueprint);
    return newBlueprint;
  }
}
```

### 6.3 Specialization Bonus

Units with fewer features get a bonus multiplier:

| Feature Count | Bonus |
|---------------|-------|
| 1 | 2.0x |
| 2 | 1.5x |
| 3 | 1.2x |
| 4+ | 1.0x |

```javascript
function getSpecializationBonus(blueprint) {
  const featureCount = Object.values(blueprint.features)
    .filter(f => f.allocation > 0).length;

  switch (featureCount) {
    case 1: return 2.0;
    case 2: return 1.5;
    case 3: return 1.2;
    default: return 1.0;
  }
}
```

---

## 7. Production (P) — Unit Manufacturing

### 7.1 Factory Module

```javascript
// src/SimCore/modules/Factory.js
export class Factory {
  constructor(simCore) {
    this.simCore = simCore;
    this.productionQueues = new Map(); // producerId -> Queue
  }

  canProduce(producerId, blueprintId) {
    const producer = this.simCore.getEntity(producerId);
    if (!producer) return false;

    // Check producer has SYS_PRODUCTION feature
    const hasProduction = producer.unitData.features
      .some(f => f.id === 'SYS_PRODUCTION' && f.allocation > 0);
    if (!hasProduction) return false;

    // Check blueprint exists and is accessible
    const blueprint = this.simCore.designer.blueprints.get(blueprintId);
    if (!blueprint) return false;

    return true;
  }

  startProduction(producerId, blueprintId, size = 1) {
    if (!this.canProduce(producerId, blueprintId)) {
      throw new Error('Cannot produce: requirements not met');
    }

    const blueprint = this.simCore.designer.blueprints.get(blueprintId);
    const cost = this.calculateCost(blueprint, size);

    const job = {
      id: `prod_${this.simCore.nextId++}`,
      producerId,
      blueprintId,
      size,
      cost,
      progress: 0,
      status: 'IN_PROGRESS',
      startTick: this.simCore.tick
    };

    // Add to producer's queue
    if (!this.productionQueues.has(producerId)) {
      this.productionQueues.set(producerId, []);
    }
    this.productionQueues.get(producerId).push(job);

    this.simCore.eventBus.emit('PRODUCTION_STARTED', job);
    return job;
  }

  update() {
    for (const [producerId, queue] of this.productionQueues) {
      if (queue.length === 0) continue;

      const job = queue[0]; // Process first in queue
      if (job.status !== 'IN_PROGRESS') continue;

      // Progress based on production rate
      const producer = this.simCore.getEntity(producerId);
      const productionRate = this.getProductionRate(producer);
      const progressPerTick = productionRate / (job.cost.time * 20);

      job.progress = Math.min(1.0, job.progress + progressPerTick);

      if (job.progress >= 1.0) {
        this.completeProduction(job);
      }
    }
  }

  completeProduction(job) {
    job.status = 'COMPLETE';

    const producer = this.simCore.getEntity(job.producerId);
    const blueprint = this.simCore.designer.blueprints.get(job.blueprintId);

    // Spawn new unit near producer
    const spawnPosition = this.findSpawnPosition(producer.position);

    const newUnit = this.simCore.spawnUnit({
      blueprintId: job.blueprintId,
      ownerId: producer.ownerId,
      position: spawnPosition,
      size: job.size
    });

    // Remove from queue
    const queue = this.productionQueues.get(job.producerId);
    queue.shift();

    this.simCore.eventBus.emit('PRODUCTION_COMPLETE', { job, unit: newUnit });
  }

  calculateCost(blueprint, size) {
    const baseCost = 100; // Base resource cost
    const baseTime = 10; // Base time in seconds

    // Cost scales with version (higher capacity = more expensive)
    const versionMultiplier = blueprint.version / 10;

    // Cost scales with size
    const sizeMultiplier = size;

    return {
      resources: Math.floor(baseCost * versionMultiplier * sizeMultiplier),
      time: baseTime * versionMultiplier * sizeMultiplier
    };
  }

  getProductionRate(producer) {
    // Based on SYS_PRODUCTION allocation
    const prodFeature = producer.unitData.features
      .find(f => f.id === 'SYS_PRODUCTION');
    return prodFeature ? prodFeature.allocation / 25 : 0; // 25% = 1.0 rate
  }

  findSpawnPosition(producerPosition) {
    // Find nearby valid position
    // Implementation depends on terrain system
    return producerPosition; // Simplified
  }
}
```

### 7.2 Unit Size System

| Size | Scale | Stat Multiplier |
|------|-------|-----------------|
| 1 | 100% | 1.0x |
| 2 | 200% | 2.0x |
| 3 | 300% | 3.0x |
| ... | ... | ... |
| 9 | 900% | 9.0x |

---

## 8. Upgrade (U) — Unit Evolution

### 8.1 Refit System

```javascript
// src/SimCore/modules/Refitter.js
export class Refitter {
  constructor(simCore) {
    this.simCore = simCore;
  }

  canRefit(unitId, newBlueprintId) {
    const unit = this.simCore.getEntity(unitId);
    const newBlueprint = this.simCore.designer.blueprints.get(newBlueprintId);

    if (!unit || !newBlueprint) return false;

    // Must be same base type (same name)
    const currentBlueprint = this.simCore.designer.blueprints.get(unit.unitData.blueprintId);
    if (currentBlueprint.name !== newBlueprint.name) return false;

    // New version must be higher
    if (newBlueprint.version <= currentBlueprint.version) return false;

    return true;
  }

  startRefit(unitId, newBlueprintId, producerId) {
    if (!this.canRefit(unitId, newBlueprintId)) {
      throw new Error('Cannot refit: requirements not met');
    }

    const unit = this.simCore.getEntity(unitId);
    const currentBlueprint = this.simCore.designer.blueprints.get(unit.unitData.blueprintId);
    const newBlueprint = this.simCore.designer.blueprints.get(newBlueprintId);

    // Calculate delta cost
    const deltaCost = this.calculateDeltaCost(currentBlueprint, newBlueprint);

    const job = {
      id: `refit_${this.simCore.nextId++}`,
      unitId,
      producerId,
      fromBlueprintId: unit.unitData.blueprintId,
      toBlueprintId: newBlueprintId,
      cost: deltaCost,
      progress: 0,
      status: 'IN_PROGRESS',
      startTick: this.simCore.tick
    };

    // Unit becomes inactive during refit
    unit.unitData.status = 'REFITTING';

    this.simCore.eventBus.emit('REFIT_STARTED', job);
    return job;
  }

  calculateDeltaCost(fromBlueprint, toBlueprint) {
    const versionDiff = toBlueprint.version - fromBlueprint.version;
    return {
      resources: versionDiff * 10,
      time: versionDiff * 5
    };
  }
}
```

---

## 9. Effective Stats Pipeline

### 9.1 Full Formula

```javascript
EffectiveStat = BaseStat
  × AllocationMultiplier
  × SpecializationBonus
  × ExtendMultiplier
  × TrainingMultiplier
  × TuningMultiplier
  × ContextMultiplier
```

### 9.2 Implementation

```javascript
// src/SimCore/rules/StatsEngine.js
export class StatsEngine {
  constructor(simCore) {
    this.simCore = simCore;
  }

  getEffectiveStats(entity, featureId) {
    const blueprint = this.simCore.designer.blueprints.get(entity.unitData.blueprintId);
    const featureAlloc = blueprint.features[featureId];
    const feature = this.simCore.featureRegistry.get(featureId);

    if (!featureAlloc || featureAlloc.allocation === 0) {
      return null; // Feature not included
    }

    const stats = {};

    for (const [statName, baseStat] of Object.entries(feature.baseStats)) {
      const allocation = featureAlloc.allocation / 100;
      const specialization = this.getSpecializationBonus(blueprint);
      const extend = this.getExtendMultiplier(feature, statName);
      const training = feature.training.multiplier;
      const tuning = entity.unitData.tuning?.[featureId]?.[statName] || 1.0;
      const context = 1.0; // Situational modifiers

      stats[statName] = baseStat
        * allocation
        * specialization
        * extend
        * training
        * tuning
        * context;
    }

    return stats;
  }

  getSpecializationBonus(blueprint) {
    const count = Object.values(blueprint.features)
      .filter(f => f.allocation > 0).length;
    return [2.0, 1.5, 1.2, 1.0, 1.0][Math.min(count - 1, 4)];
  }

  getExtendMultiplier(feature, statName) {
    const level = feature.extend.levels[statName] || 0;
    return 1.0 + (level * 0.5);
  }
}
```

---

*End of Appendix C*
