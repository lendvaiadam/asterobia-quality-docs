# APPENDIX C: GRFDTRDPU & FEATURE IMPLEMENTATION (v3)

**Parent Document:** [Big Picture Master Plan v3](../BIG_PICTURE_MASTER_PLAN_v1_ANTIGRAVITY.md)
**Scope:** The R&D Pipeline, Feature Modules, and specific Game Logic implementations.

---

## 1. The G-R-F-Tr-D-P-U Pipeline Implementation

This pipeline is the "Meta-Loop" of the game implementation.

### 1.1 Goals (G) - Evaluator Logic

The `GoalEvaluator` runs every 1 second (20 ticks) to check for user "pain points".

```javascript
// src/sim/modules/GoalEvaluator.js
export class GoalEvaluator {
    check(state) {
        // Example: Detect Need for Anti-Air
        if (state.enemyHasFlyingUnits && !state.playerHasAntiAir) {
            this.emitNeed({
                id: 'NEED_AA',
                urgency: 0.8,
                recommendedFeature: 'WPN_MISSILE'
            });
        }
        
        // Example: Detect Need for Mining (Economy Stall)
        if (state.resources.matera < 100 && state.miningRate < 1.0) {
             this.emitNeed({
                id: 'NEED_ECONOMY',
                urgency: 0.9,
                recommendedFeature: 'MATERA_MINING'
            });
        }
    }
}
```

### 1.2 Research (R) - The Tech Tree

Research is a simple state toggle combined with a "Time/Cost" gate.

```javascript
// src/sim/modules/ResearchManager.js
unlockFeature(featureKey) {
    if (this.state.tech[featureKey].unlocked) return;
    
    // consume cost
    this.economy.deduct('energy', 1000);
    
    // set timer
    this.scheduler.schedule(30 * 20, () => {
        this.state.tech[featureKey].unlocked = true;
        this.events.emit('RESEARCH_COMPLETE', featureKey);
    });
}
```

### 1.3 Design (D) - The Blueprint Generator

The Designer is a Client-Side UI state machine that outputs the JSON blob defined in Appendix B.

**Validation Logic:**
1.  Sum(Allocations) <= Capacity?
2.  Required Dependencies met? (e.g. `WPN_SHOOT` needs `PERCEPTION_OPTICAL`).

**Generative Logic (The "Nano Banana" Hook):**
```javascript
async generateVisuals(blueprintData) {
    // 1. Construct Prompt
    const prompt = `Sci-fi unit, ${blueprintData.features.includes('ROLL') ? 'wheels' : 'legs'}, 
                    ${blueprintData.features.includes('MINE') ? 'drill' : 'gun'}, 
                    style: astrobia_faction_1`;
    
    // 2. Call Nano Banana (Mock)
    const imgUrl = await ExternalAPI.genImage(prompt);
    
    // 3. Call MS Trellis (Mock)
    const glbUrl = await ExternalAPI.imgTo3D(imgUrl);
    
    return { imgUrl, glbUrl };
}
```

---

## 2. Canonical Features (The "Big 7")

Each feature is a `System` in the ECS architecture.

### Feature 01: `MOVE_ROLL` (Locomotion)

**Physics Model:**
Instead of Raycast vehicle physics (unstable), we use **Rolling Sphere Physics**.
*   **Mass:** `100kg` base.
*   **Friction:** `0.8`.
*   **Torque:** Applied to the sphere in direction of travel.

```javascript
// src/sim/systems/LocomotionSystem.js
update(input, entity) {
    // 1. Check Terrain Gradient
    const normal = this.map.getNormal(entity.pos.x, entity.pos.z);
    const slopeAngle = Vector3.angleTo(normal, UP);
    
    // 2. Slope Constraint check
    if (slopeAngle > entity.stats.maxClimbAngle) {
        // Slide back
        entity.velocity.add(normal.multiply(-1 * GRAVITY));
        this.events.emit('BLOCKED_BY_SLOPE');
        return;
    }
    
    // 3. Apply Rolling Force
    if (input.move) {
        const force = input.dir.multiply(entity.stats.torque);
        entity.velocity.add(force.divide(entity.mass));
    }
    
    // 4. Integrate
    entity.pos.add(entity.velocity);
    entity.velocity.multiply(0.95); // Drag
}
```

### Feature 02: `WPN_SHOOT` (Combat)

**Logic:**
*   **Cooldown:** `1.0s / fireRate`.
*   **Projectile:** Spawns a deterministic entity (Linear Velocity).
*   **Hit:** Simple Distance Check (`dist < radius`).

```javascript
fire(shooter, targetPos) {
    if (Date.now() < shooter.nextFireTime) return;
    
    const proj = this.spawnEntity('PROJECTILE', {
        pos: shooter.pos,
        vel: targetPos.sub(shooter.pos).normalize().multiply(50), // 50m/s
        damage: shooter.stats.damage
    });
    
    shooter.nextFireTime = Date.now() + (1000 / shooter.stats.fireRate);
}
```

### Feature 03: `PERCEPTION_OPTICAL` (Vision)

**Optimization Strategy:**
We do NOT do per-pixel Fog of War in the Sim.
*   **Sim:** Checks `dist(A, B) < A.visionRange`.
*   **View:** Draws the beautiful FOW texture using RenderTargets.

**Line of Sight (LOS):**
We use a simple **Heightmap Raycast**. If `Ray(A, B)` intersects `TerrainHeight`, then Blocked.

### Feature 04: `PERCEPTION_SCAN` (Subsurface)

**Effect:**
Reveals `Hidden` entities (Matera Deposits) in radius.
*   **State:** `Deposit` entities have `visibleTo: [playerIds]`.
*   **Action:** When Scan pulses, add `player` to `visibleTo` array for all deposits in range.

### Feature 05: `MATERA_MINING` (Harvest)

**Logic:**
1.  Must be `State.STOPPED`.
2.  Must be `dist(Unit, Deposit) < 5m`.
3.  Every 1s:
    *   `Deposit.amount -= Rate`.
    *   Spawn `MateraPile` at Unit Position (or add to internal buffer if Transport installed).

### Feature 06: `MATERA_TRANSPORT` (Logistics)

**Inventory System:**
```javascript
interface Container {
    maxVolume: number; // m3
    contents: Array<{ material: string, qty: number }>;
}

// Weight Penalty
const cargoMass = container.contents.reduce((sum, c) => sum + c.qty * DENSITY[c.material], 0);
entity.effectiveMass = entity.baseMass + cargoMass;
// Physics engine automatically handles this via F=ma (heavier = slower accel)
```

### Feature 07: `TERRAIN_SHAPING` (Modification)

**Grid Logic:**
The map is a grid of `Heights`.
*   **Action:** `Flatten(TargetHeight)`.
*   **Loop:** Every tick, `CurrentHeight` moves 0.1m towards `TargetHeight`.
*   **Cost:** Energy consumed per tick per active cell.

---
*End of Appendix*
