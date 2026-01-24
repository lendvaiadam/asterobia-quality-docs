# APPENDIX D: G-R-F-Tr-D-P-U IMPLEMENTATION GUIDE

**Parent Document:** [MASTER_PLAN_FINAL_v2.md](../MASTER_PLAN_FINAL_v2.md)
**Canonical Source:** `spec_sources/ASTEROBIA_CANONICAL_GRFDTRDPU_SYSTEM_2026-01-13.md`
**Scope:** Complete implementation guide for the evolutionary pipeline

---

## 1. Pipeline Overview

```
┌─────────┐   ┌──────────┐   ┌─────────┐   ┌──────────┐
│    G    │──►│    R     │──►│    F    │──►│    Tr    │
│  Goal   │   │ Research │   │ Feature │   │ Training │
│ Manager │   │ Manager  │   │Registry │   │ Manager  │
└─────────┘   └──────────┘   └─────────┘   └──────────┘
     │                            │              │
     │  Events                    │  Unlocks     │  Multipliers
     ▼                            ▼              ▼
┌─────────┐   ┌──────────┐   ┌─────────┐   ┌──────────┐
│    U    │◄──│    P     │◄──│    D    │◄──│  Stats   │
│  Unit   │   │Production│   │ Design  │   │ Engine   │
│Instance │   │ Manager  │   │ Manager │   │          │
└─────────┘   └──────────┘   └─────────┘   └──────────┘
```

---

## 2. Data Schemas (Canonical)

### 2.1 Feature Registry Entry

```javascript
// src/SimCore/features/FeatureRegistry.js
const featureSchema = {
  id: "MOVE_ROLL",                    // Unique identifier
  category: "locomotion",              // locomotion|combat|economy|system|support
  status: "LOCKED",                    // LOCKED|UNLOCKED

  baseStats: {
    maxSpeed: 10,                      // m/s
    acceleration: 5,                   // m/s²
    grip: 0.8,
    torque: 50
  },

  constraints: {
    maxClimbAngle: 40                  // degrees (extendable)
  },

  extend: {
    levelByConstraint: {
      maxClimbAngle: 0                 // 0-5
    }
  },

  training: {
    highScore: 0,                      // 0-100 (from Training Outcome Slider)
    globalMultiplier: 1.0              // 1.0 + (highScore/100)
  },

  code: {
    modulePath: "src/SimCore/features/modules/MOVE_ROLL.js",
    docPath: "spec_sources/ASTEROBIA_CANONICAL_FEATURE_MOVE_ROLL_2026-01-13.md"
  },

  design: {
    supportsNestedAllocation: false,
    nestedAxes: null
  }
};
```

### 2.2 Goal / Need Object

```javascript
// src/SimCore/systems/GoalManager.js
const goalSchema = {
  id: "GOAL_INVENT_ROLL",
  type: "INVENT",                      // INVENT|EXTEND
  triggerEvent: "UNIT_STUCK",
  reward: {
    featureId: "MOVE_ROLL",
    constraintKey: null                // For EXTEND: which constraint
  },
  description: "Central Unit cannot move. Invent wheeled movement.",
  status: "AVAILABLE",                 // AVAILABLE|IN_PROGRESS|RESOLVED
  createdAt: 0                         // Tick when created
};
```

### 2.3 Research Job

```javascript
const researchJobSchema = {
  jobId: "RJOB_001",
  goalId: "GOAL_INVENT_ROLL",
  researcherUnitId: "UNIT_CENTRAL_001",
  type: "INVENT",
  featureId: "MOVE_ROLL",
  constraintKey: null,
  energyCost: 100,
  timeCostTicks: 200,                  // 10 seconds at 20Hz
  progress01: 0.0,
  status: "QUEUED"                     // QUEUED|RUNNING|DONE|CANCELLED
};
```

### 2.4 Training Record

```javascript
// Per user, per feature
const trainingRecordSchema = {
  userId: "USER_001",
  featureId: "MOVE_ROLL",
  highScore: 80,                       // From Training Outcome Slider
  globalMultiplier: 1.8,               // 1.0 + (80/100) = 1.8
  updatedAt: 0
};
```

### 2.5 Type Blueprint

```javascript
const typeBlueprintSchema = {
  typeId: "TYPE_ROVER_MK1",
  version: 1,
  features: [
    {
      featureId: "MOVE_ROLL",
      allocation01: 0.50,              // 50%
      nested: null
    },
    {
      featureId: "OPTICAL_VISION",
      allocation01: 0.30,              // 30%
      nested: null
    },
    {
      featureId: "WPN_SHOOT",
      allocation01: 0.20,              // 20%
      nested: {
        axes: {
          power01: 0.25,
          rate01: 0.25,
          range01: 0.25,
          accuracy01: 0.25
        },
        defaultsAutoManaged: true
      }
    }
  ],
  // Sum = 100%
  visualSeed: 12345,
  createdAt: 0,
  updatedAt: 0
};
```

### 2.6 Unit Instance

```javascript
const unitInstanceSchema = {
  unitId: "UNIT_123",
  ownerUserId: "USER_001",
  typeId: "TYPE_ROVER_MK1",
  typeVersion: 1,
  hp: 100,
  energyBuffer: {
    capacity: 50,
    current: 50
  },
  tuning: {
    byFeature: {
      "MOVE_ROLL": { torqueMult: 1.0 },
      "WPN_SHOOT": { rateMult: 1.0 }
    }
  },
  effectiveStatsCache: null           // Computed on demand
};
```

---

## 3. G - Goal Manager

### 3.1 Implementation

```javascript
// src/SimCore/systems/GoalManager.js
export class GoalManager {
  constructor(simCore) {
    this.simCore = simCore;
    this.goals = new Map();           // goalId -> Goal
    this.cooldowns = new Map();       // dedupe key -> cooldown tick

    this.setupEventListeners();
  }

  setupEventListeners() {
    const { eventBus } = this.simCore;

    eventBus.on('UNIT_STUCK', (e) => this.handleUnitStuck(e));
    eventBus.on('SURFACE_MATERA_VISIBLE', (e) => this.handleMateraVisible(e));
    eventBus.on('UNDERGROUND_MATERA_FOUND', (e) => this.handleUndergroundMatera(e));
    eventBus.on('MATERA_PILE_EXISTS', (e) => this.handlePileExists(e));
    eventBus.on('ENEMY_DETECTED', (e) => this.handleEnemyDetected(e));
  }

  handleUnitStuck(event) {
    // Check if MOVE_ROLL already unlocked
    if (this.simCore.featureRegistry.isUnlocked('MOVE_ROLL')) return;

    // Check cooldown
    const dedupeKey = 'INVENT:MOVE_ROLL';
    if (this.isOnCooldown(dedupeKey)) return;

    // Create goal
    this.createGoal({
      type: 'INVENT',
      featureId: 'MOVE_ROLL',
      triggerEvent: 'UNIT_STUCK',
      description: 'Central Unit cannot move. Research wheeled movement.'
    });

    this.setCooldown(dedupeKey, 600); // 30 second cooldown
  }

  createGoal(config) {
    const goal = {
      id: `GOAL_${this.simCore.idGenerator.next('g')}`,
      type: config.type,
      triggerEvent: config.triggerEvent,
      reward: {
        featureId: config.featureId,
        constraintKey: config.constraintKey || null
      },
      description: config.description,
      status: 'AVAILABLE',
      createdAt: this.simCore.tick
    };

    this.goals.set(goal.id, goal);
    this.simCore.eventBus.emit('GOAL_CREATED', { goal });

    return goal;
  }

  isOnCooldown(key) {
    const cooldownUntil = this.cooldowns.get(key);
    return cooldownUntil && this.simCore.tick < cooldownUntil;
  }

  setCooldown(key, ticks) {
    this.cooldowns.set(key, this.simCore.tick + ticks);
  }
}
```

### 3.2 Demo 1.0 Event Mappings (Canonical)

| Event | Condition | Goal Type | Feature |
|-------|-----------|-----------|---------|
| UNIT_STUCK | Central Unit has no MOVE_* | INVENT | MOVE_ROLL |
| SURFACE_MATERA_VISIBLE | Mobile unit sees Matera | INVENT | SUBSURFACE_SCAN |
| UNDERGROUND_MATERA_FOUND | Scan reveals deposit | INVENT | MATERA_MINING |
| MATERA_PILE_EXISTS | Mining creates pile | INVENT | MATERA_TRANSPORT |
| HEIGHT_OBSTACLE | Large slope encountered | INVENT | TERRAIN_SHAPING |
| NON_MOBILE_DESIGN | Design has no MOVE_* | INVENT | UNIT_CARRIER |
| ENEMY_DETECTED | First enemy visible | INVENT | WPN_SHOOT |

---

## 4. R - Research Manager

### 4.1 Implementation

```javascript
// src/SimCore/systems/ResearchManager.js
export class ResearchManager {
  constructor(simCore) {
    this.simCore = simCore;
    this.jobs = new Map();            // jobId -> ResearchJob
    this.unitQueues = new Map();      // unitId -> [jobIds]
  }

  startResearch(goalId, researcherUnitId) {
    const goal = this.simCore.goalManager.goals.get(goalId);
    if (!goal) throw new Error(`Goal not found: ${goalId}`);

    // Verify unit has SYS_RESEARCH
    const unit = this.simCore.getEntity(researcherUnitId);
    if (!unit.hasFeature('SYS_RESEARCH')) {
      throw new Error('Unit cannot research');
    }

    const job = {
      jobId: this.simCore.idGenerator.next('rjob'),
      goalId,
      researcherUnitId,
      type: goal.type,
      featureId: goal.reward.featureId,
      constraintKey: goal.reward.constraintKey,
      energyCost: this.calculateEnergyCost(goal),
      timeCostTicks: this.calculateTimeCost(goal),
      progress01: 0,
      status: 'QUEUED'
    };

    this.jobs.set(job.jobId, job);
    this.addToUnitQueue(researcherUnitId, job.jobId);

    goal.status = 'IN_PROGRESS';

    return job;
  }

  tick() {
    for (const [unitId, jobIds] of this.unitQueues) {
      if (jobIds.length === 0) continue;

      const activeJobId = jobIds[0];
      const job = this.jobs.get(activeJobId);

      if (job.status === 'QUEUED') {
        job.status = 'RUNNING';
      }

      if (job.status === 'RUNNING') {
        // Check energy
        if (!this.consumeEnergy(unitId, job.energyCost / job.timeCostTicks)) {
          continue; // Stalled due to energy
        }

        // Progress
        job.progress01 += 1 / job.timeCostTicks;

        if (job.progress01 >= 1.0) {
          this.completeJob(job);
        }
      }
    }
  }

  completeJob(job) {
    job.status = 'DONE';
    job.progress01 = 1.0;

    // Apply reward
    if (job.type === 'INVENT') {
      this.simCore.featureRegistry.unlock(job.featureId);
    } else if (job.type === 'EXTEND') {
      this.simCore.featureRegistry.extendConstraint(
        job.featureId,
        job.constraintKey
      );
    }

    // Update goal
    const goal = this.simCore.goalManager.goals.get(job.goalId);
    goal.status = 'RESOLVED';

    // Remove from queue
    this.removeFromUnitQueue(job.researcherUnitId, job.jobId);

    // Emit event
    this.simCore.eventBus.emit('RESEARCH_COMPLETE', { job });
  }

  calculateEnergyCost(goal) {
    // Base cost, can be configured
    return goal.type === 'INVENT' ? 100 : 50;
  }

  calculateTimeCost(goal) {
    // Base time in ticks (20Hz)
    return goal.type === 'INVENT' ? 200 : 100; // 10s or 5s
  }
}
```

### 4.2 Extend Formula (Canonical)

```javascript
// In FeatureRegistry
extendConstraint(featureId, constraintKey) {
  const feature = this.features.get(featureId);
  const currentLevel = feature.extend.levelByConstraint[constraintKey];

  if (currentLevel >= 5) {
    throw new Error(`Extend cap reached for ${featureId}.${constraintKey}`);
  }

  feature.extend.levelByConstraint[constraintKey] = currentLevel + 1;
}

getExtendMultiplier(featureId, constraintKey) {
  const feature = this.features.get(featureId);
  const level = feature.extend.levelByConstraint[constraintKey] || 0;

  // Canonical formula: 1.0 + (level * 0.5)
  // Level 0 = 1.0x, Level 5 = 3.5x
  return 1.0 + (level * 0.5);
}
```

---

## 5. F - Feature Registry

### 5.1 Implementation

```javascript
// src/SimCore/features/FeatureRegistry.js
export class FeatureRegistry {
  constructor() {
    this.features = new Map();
    this.initializeFeatures();
  }

  initializeFeatures() {
    // Pre-unlocked features
    this.register({
      id: 'OPTICAL_VISION',
      category: 'perception',
      status: 'UNLOCKED',
      baseStats: { visionRange: 30 },
      constraints: {},
      extend: { levelByConstraint: {} }
    });

    this.register({
      id: 'SYS_RESEARCH',
      category: 'system',
      status: 'UNLOCKED',
      baseStats: { researchSpeed: 1.0 },
      constraints: {},
      extend: { levelByConstraint: {} }
    });

    this.register({
      id: 'SYS_DESIGN',
      category: 'system',
      status: 'UNLOCKED',
      baseStats: { designSlots: 4 },
      constraints: {},
      extend: { levelByConstraint: {} }
    });

    this.register({
      id: 'SYS_PRODUCTION',
      category: 'system',
      status: 'UNLOCKED',
      baseStats: { productionSpeed: 1.0 },
      constraints: {},
      extend: { levelByConstraint: {} }
    });

    // Locked features (unlocked via research)
    this.register({
      id: 'MOVE_ROLL',
      category: 'locomotion',
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
        levelByConstraint: {
          maxClimbAngle: 0
        }
      }
    });

    // ... other features
  }

  unlock(featureId) {
    const feature = this.features.get(featureId);
    if (!feature) throw new Error(`Unknown feature: ${featureId}`);
    feature.status = 'UNLOCKED';
  }

  isUnlocked(featureId) {
    const feature = this.features.get(featureId);
    return feature && feature.status === 'UNLOCKED';
  }
}
```

---

## 6. Tr - Training Manager

### 6.1 Training Outcome Slider (Demo 1.0)

Per Human Owner Q6: Implement slider instead of mini-games.

```javascript
// src/SimCore/systems/TrainingManager.js
export class TrainingManager {
  constructor(simCore) {
    this.simCore = simCore;
    this.records = new Map(); // `${userId}:${featureId}` -> TrainingRecord
  }

  /**
   * Set training outcome via slider.
   * @param {string} userId - User ID
   * @param {string} featureId - Feature being trained
   * @param {number} outcomePercent - Slider value: -50 to +50
   */
  setTrainingOutcome(userId, featureId, outcomePercent) {
    // Clamp to valid range
    outcomePercent = Math.max(-50, Math.min(50, outcomePercent));

    // Convert to highScore (0-100)
    // -50% -> 0, 0% -> 50, +50% -> 100
    const highScore = outcomePercent + 50;

    // Calculate multiplier: 1.0 + (highScore / 100)
    // Range: 0.5x to 1.5x for Demo 1.0
    // (Canonical allows up to 2.0x with score 100, but slider caps at +50%)
    const globalMultiplier = 1.0 + (highScore / 100);

    const key = `${userId}:${featureId}`;
    const existingRecord = this.records.get(key);

    // Only update if better score (or first time)
    if (!existingRecord || highScore > existingRecord.highScore) {
      this.records.set(key, {
        userId,
        featureId,
        highScore,
        globalMultiplier,
        updatedAt: this.simCore.tick
      });

      // Also update FeatureRegistry for quick access
      const feature = this.simCore.featureRegistry.features.get(featureId);
      feature.training.highScore = highScore;
      feature.training.globalMultiplier = globalMultiplier;
    }

    return this.records.get(key);
  }

  getMultiplier(userId, featureId) {
    const key = `${userId}:${featureId}`;
    const record = this.records.get(key);
    return record ? record.globalMultiplier : 1.0;
  }
}
```

### 6.2 Training Screen UI

```javascript
// src/UI/components/training-screen.js
class TrainingScreen extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        .container { padding: 20px; }
        .slider-container { margin: 20px 0; }
        input[type="range"] { width: 100%; }
        .labels { display: flex; justify-content: space-between; }
        .value { font-size: 24px; text-align: center; }
      </style>
      <div class="container">
        <h2>Training: ${this.featureId}</h2>
        <p>Set training outcome (simulates mini-game result)</p>
        <div class="slider-container">
          <div class="labels">
            <span>-50%</span>
            <span>0%</span>
            <span>+50%</span>
          </div>
          <input type="range" min="-50" max="50" value="0" id="outcome-slider">
          <div class="value" id="outcome-value">0%</div>
        </div>
        <button id="apply-btn">Apply Training</button>
      </div>
    `;

    const slider = this.shadowRoot.getElementById('outcome-slider');
    const valueDisplay = this.shadowRoot.getElementById('outcome-value');
    const applyBtn = this.shadowRoot.getElementById('apply-btn');

    slider.addEventListener('input', () => {
      const value = parseInt(slider.value);
      valueDisplay.textContent = `${value >= 0 ? '+' : ''}${value}%`;
    });

    applyBtn.addEventListener('click', () => {
      const outcome = parseInt(slider.value);
      this.dispatchEvent(new CustomEvent('training-complete', {
        detail: { featureId: this.featureId, outcomePercent: outcome }
      }));
    });
  }

  set featureId(id) {
    this._featureId = id;
    if (this.isConnected) this.render();
  }

  get featureId() {
    return this._featureId;
  }
}

customElements.define('training-screen', TrainingScreen);
```

---

## 7. D - Design Manager

### 7.1 Implementation

```javascript
// src/SimCore/systems/DesignManager.js
export class DesignManager {
  constructor(simCore) {
    this.simCore = simCore;
    this.blueprints = new Map(); // typeId -> TypeBlueprint
    this.MIN_ALLOCATION = 0.25;  // Configurable
  }

  createBlueprint(designerUnitId, config) {
    const designer = this.simCore.getEntity(designerUnitId);
    if (!designer.hasFeature('SYS_DESIGN')) {
      throw new Error('Unit cannot design');
    }

    // Validate allocations
    this.validateAllocations(config.features);

    // Check slot capacity
    const usedSlots = this.getBlueprintsByDesigner(designerUnitId).length;
    const maxSlots = this.getSlotCapacity(designer);
    if (usedSlots >= maxSlots) {
      throw new Error('No design slots available');
    }

    const blueprint = {
      typeId: this.simCore.idGenerator.next('type'),
      version: 1,
      designerUnitId,
      features: config.features,
      visualSeed: this.simCore.rng.randomInt(0, 999999),
      createdAt: this.simCore.tick,
      updatedAt: this.simCore.tick
    };

    this.blueprints.set(blueprint.typeId, blueprint);

    return blueprint;
  }

  validateAllocations(features) {
    // Check all features unlocked
    for (const f of features) {
      if (!this.simCore.featureRegistry.isUnlocked(f.featureId)) {
        throw new Error(`Feature not unlocked: ${f.featureId}`);
      }
    }

    // Check sum = 100%
    const sum = features.reduce((acc, f) => acc + f.allocation01, 0);
    if (Math.abs(sum - 1.0) > 0.001) {
      throw new Error(`Allocations must sum to 100%, got ${sum * 100}%`);
    }

    // Check minimum allocation
    for (const f of features) {
      if (f.allocation01 > 0 && f.allocation01 < this.MIN_ALLOCATION) {
        throw new Error(
          `Allocation ${f.allocation01 * 100}% below minimum ${this.MIN_ALLOCATION * 100}%`
        );
      }
    }

    // Validate nested allocations
    for (const f of features) {
      if (f.nested && f.nested.axes) {
        const axisSum = Object.values(f.nested.axes).reduce((a, b) => a + b, 0);
        if (Math.abs(axisSum - 1.0) > 0.001) {
          throw new Error(`Nested axes for ${f.featureId} must sum to 100%`);
        }
      }
    }
  }

  getSlotCapacity(designer) {
    // Slot capacity = floor(DesignAllocation / 25%)
    const designAlloc = designer.getFeatureAllocation('SYS_DESIGN');
    return Math.floor(designAlloc / 0.25);
  }

  getSpecializationBonus(blueprint) {
    const featureCount = blueprint.features.filter(f => f.allocation01 > 0).length;

    // Canonical bonus table
    switch (featureCount) {
      case 1: return 2.0;  // +100%
      case 2: return 1.5;  // +50%
      case 3: return 1.2;  // +20%
      default: return 1.0; // +0%
    }
  }
}
```

---

## 8. P - Production Manager

### 8.1 Implementation

```javascript
// src/SimCore/systems/ProductionManager.js
export class ProductionManager {
  constructor(simCore) {
    this.simCore = simCore;
    this.queues = new Map(); // producerUnitId -> [ProductionJob]
  }

  queueBuild(producerUnitId, typeId) {
    const producer = this.simCore.getEntity(producerUnitId);
    if (!producer.hasFeature('SYS_PRODUCTION')) {
      throw new Error('Unit cannot produce');
    }

    const blueprint = this.simCore.designManager.blueprints.get(typeId);
    if (!blueprint) throw new Error(`Blueprint not found: ${typeId}`);

    const job = {
      jobId: this.simCore.idGenerator.next('pjob'),
      producerUnitId,
      typeId,
      typeVersion: blueprint.version,
      operation: 'BUILD',
      energyCost: this.calculateBuildCost(blueprint),
      timeCostTicks: this.calculateBuildTime(blueprint),
      progress01: 0,
      status: 'QUEUED'
    };

    this.addToQueue(producerUnitId, job);
    return job;
  }

  tick() {
    for (const [producerId, jobs] of this.queues) {
      if (jobs.length === 0) continue;

      const job = jobs[0];

      if (job.status === 'QUEUED') {
        job.status = 'RUNNING';
      }

      if (job.status === 'RUNNING') {
        // Consume energy
        if (!this.consumeEnergy(producerId, job.energyCost / job.timeCostTicks)) {
          continue;
        }

        job.progress01 += 1 / job.timeCostTicks;

        if (job.progress01 >= 1.0) {
          this.completeBuild(job);
        }
      }
    }
  }

  completeBuild(job) {
    job.status = 'DONE';

    const producer = this.simCore.getEntity(job.producerUnitId);
    const blueprint = this.simCore.designManager.blueprints.get(job.typeId);

    // Spawn unit at producer position
    const unit = this.simCore.spawnUnit({
      typeId: job.typeId,
      typeVersion: job.typeVersion,
      position: producer.position.clone(),
      ownerId: producer.ownerId
    });

    this.removeFromQueue(job.producerUnitId, job.jobId);

    this.simCore.eventBus.emit('UNIT_PRODUCED', { unit, job });

    return unit;
  }

  calculateBuildCost(blueprint) {
    // Base cost + feature complexity
    let cost = 50;
    for (const f of blueprint.features) {
      cost += f.allocation01 * 100;
    }
    return cost;
  }

  calculateBuildTime(blueprint) {
    // Base time + feature complexity
    return 100 + blueprint.features.length * 20; // Ticks
  }
}
```

---

## 9. Stats Engine

### 9.1 Effective Stat Calculation (Canonical)

```javascript
// src/SimCore/features/StatsEngine.js
export class StatsEngine {
  constructor(simCore) {
    this.simCore = simCore;
  }

  /**
   * Calculate effective stat for a unit/feature/stat combination.
   *
   * Formula (canonical):
   * EffectiveStat = BaseStat
   *   * AllocationMultiplier
   *   * SpecializationBonus
   *   * ExtendMultiplier
   *   * TrainingMultiplier
   *   * TuningMultiplier
   *   * ContextMultiplier
   */
  getEffectiveStat(unitId, featureId, statKey) {
    const unit = this.simCore.getEntity(unitId);
    const blueprint = this.simCore.designManager.blueprints.get(unit.typeId);
    const feature = this.simCore.featureRegistry.features.get(featureId);

    // Base stat
    const baseStat = feature.baseStats[statKey];
    if (baseStat === undefined) return 0;

    // Allocation multiplier
    const featureAlloc = blueprint.features.find(f => f.featureId === featureId);
    const allocationMult = featureAlloc ? featureAlloc.allocation01 : 0;
    if (allocationMult === 0) return 0;

    // Specialization bonus
    const specBonus = this.simCore.designManager.getSpecializationBonus(blueprint);

    // Extend multiplier (for constraints, not stats - but included for completeness)
    const extendMult = 1.0; // Stats don't use extend, constraints do

    // Training multiplier
    const trainingMult = this.simCore.trainingManager.getMultiplier(
      unit.ownerId,
      featureId
    );

    // Tuning multiplier (per-unit)
    const tuningMult = unit.tuning?.byFeature?.[featureId]?.[statKey + 'Mult'] || 1.0;

    // Context multiplier (e.g., slope, environment)
    const contextMult = this.getContextMultiplier(unit, featureId, statKey);

    return baseStat
      * allocationMult
      * specBonus
      * extendMult
      * trainingMult
      * tuningMult
      * contextMult;
  }

  /**
   * Get effective constraint value (uses Extend).
   */
  getEffectiveConstraint(unitId, featureId, constraintKey) {
    const feature = this.simCore.featureRegistry.features.get(featureId);
    const baseConstraint = feature.constraints[constraintKey];

    const extendMult = this.simCore.featureRegistry.getExtendMultiplier(
      featureId,
      constraintKey
    );

    return baseConstraint * extendMult;
  }

  getContextMultiplier(unit, featureId, statKey) {
    // Example: slope penalty for MOVE_ROLL speed
    if (featureId === 'MOVE_ROLL' && statKey === 'maxSpeed') {
      const slope = this.simCore.terrain.getSlopeAt(unit.position);
      if (slope > 10 && slope <= 40) {
        return Math.cos(slope * Math.PI / 180);
      }
    }
    return 1.0;
  }
}
```

---

## 10. Integration Test

```javascript
// tests/SimCore/grfdtrdpu.integration.test.js
describe('GRFDTRDPU Pipeline Integration', () => {
  test('complete pipeline from Goal to Unit', async () => {
    const simCore = new SimCore({ seed: 42 });

    // 1. G - Trigger goal via event
    simCore.eventBus.emit('UNIT_STUCK', { unitId: 'central' });
    expect(simCore.goalManager.goals.size).toBe(1);

    const goal = [...simCore.goalManager.goals.values()][0];
    expect(goal.reward.featureId).toBe('MOVE_ROLL');

    // 2. R - Start research
    const job = simCore.researchManager.startResearch(goal.id, 'central');
    expect(job.status).toBe('QUEUED');

    // Run until research complete
    while (job.status !== 'DONE') {
      simCore.step();
    }

    // 3. F - Feature unlocked
    expect(simCore.featureRegistry.isUnlocked('MOVE_ROLL')).toBe(true);

    // 4. Tr - Set training outcome
    simCore.trainingManager.setTrainingOutcome('user1', 'MOVE_ROLL', 30);
    expect(simCore.trainingManager.getMultiplier('user1', 'MOVE_ROLL')).toBe(1.8);

    // 5. D - Create blueprint
    const blueprint = simCore.designManager.createBlueprint('central', {
      features: [
        { featureId: 'MOVE_ROLL', allocation01: 0.5, nested: null },
        { featureId: 'OPTICAL_VISION', allocation01: 0.5, nested: null }
      ]
    });
    expect(blueprint.typeId).toBeDefined();

    // 6. P - Produce unit
    const prodJob = simCore.productionManager.queueBuild('central', blueprint.typeId);

    while (prodJob.status !== 'DONE') {
      simCore.step();
    }

    // 7. U - Unit exists with correct stats
    const units = simCore.getUnitsByType(blueprint.typeId);
    expect(units.length).toBe(1);

    const newUnit = units[0];
    const effectiveSpeed = simCore.statsEngine.getEffectiveStat(
      newUnit.id,
      'MOVE_ROLL',
      'maxSpeed'
    );

    // Base 10 * 0.5 allocation * 1.5 spec bonus * 1.8 training = 13.5
    expect(effectiveSpeed).toBeCloseTo(13.5);
  });
});
```

---

*End of Appendix D*