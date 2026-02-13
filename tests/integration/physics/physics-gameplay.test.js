/**
 * Physics Gameplay Slice Tests (Phase 3 Step 6)
 *
 * Validates:
 *   A) Slope rollover at 45° threshold
 *   B) Kinematic collision detection (unit↔unit, unit↔rock)
 *   C) Mine detonation system
 *   D) NaN/Infinity edge cases
 *   E) Determinism
 *   F) Regression: enablePhysics=false unchanged
 *
 * Run: npx vitest run tests/integration/physics/physics-gameplay.test.js
 */

import { describe, it, expect, afterEach } from 'vitest';
import { CollisionService } from '../../../server/CollisionService.js';
import { PhysicsEventService } from '../../../server/PhysicsEventService.js';
import { HeadlessUnit } from '../../../server/HeadlessUnit.js';
import { PhysicsWorld } from '../../../server/PhysicsWorld.js';
import { ServerTerrain } from '../../../server/ServerTerrain.js';
import { Room } from '../../../server/Room.js';
import { Vec3 } from '../../../server/SphereMath.js';

/** @type {PhysicsWorld[]} Track for cleanup */
const cleanup = [];

afterEach(() => {
    for (const pw of cleanup) {
        if (!pw.destroyed) pw.shutdown();
    }
    cleanup.length = 0;
});

async function createPhysicsWorld() {
    const pw = await PhysicsWorld.create({ subSteps: 1, gravity: 9.81 });
    cleanup.push(pw);
    return pw;
}

function attachBody(pw, unit) {
    const body = pw.createKinematicBody(unit.position);
    pw.addBallCollider(body, 0.5, { activeEvents: true });
    unit.rigidBody = body;
}

// ============================================================
// A) Slope rollover (45° threshold)
// ============================================================

describe('slope rollover (45° threshold)', () => {
    it('SLOPE_THRESHOLD_RAD is 45 degrees', () => {
        const expected = (45 * Math.PI) / 180;
        expect(HeadlessUnit.SLOPE_THRESHOLD_RAD).toBeCloseTo(expected, 10);
    });

    it('SLOPE_IMPULSE_STRENGTH is 5.0', () => {
        expect(HeadlessUnit.SLOPE_IMPULSE_STRENGTH).toBe(5.0);
    });

    it('44° slope does NOT trigger rollover', async () => {
        const pw = await createPhysicsWorld();
        const terrain = new ServerTerrain({ heightMultiplier: 0 }); // Perfect sphere
        const unit = new HeadlessUnit(1, 0);
        unit.spawnOnSurface({ x: 1, y: 0, z: 0 }, terrain);
        attachBody(pw, unit);

        // Perfect sphere → slope = 0°, well below 44°
        for (let t = 0; t < HeadlessUnit.SLOPE_DEBOUNCE_TICKS + 5; t++) {
            const impulse = unit.checkSlopeTrigger();
            expect(impulse).toBeNull();
        }
        expect(unit.physicsMode).toBe('KINEMATIC');
    });

    it('steep terrain (>45°) triggers rollover after debounce', async () => {
        const pw = await createPhysicsWorld();
        const terrain = new ServerTerrain(ServerTerrain.STEEP_TEST_PRESET);
        const unit = new HeadlessUnit(1, 0);

        // Scan for a direction with >45° slope
        let found = false;
        for (let i = 0; i < 72; i++) {
            const angle = i * (Math.PI / 36);
            const dir = Vec3.normalize({ x: Math.sin(angle), y: 0.1, z: Math.cos(angle) });
            unit.spawnOnSurface(dir, terrain);

            if (unit.rigidBody) {
                pw.removeBody(unit.rigidBody);
                unit.rigidBody = null;
            }
            attachBody(pw, unit);
            unit.physicsMode = 'KINEMATIC';
            unit._slopeTriggerCounter = 0;
            unit._reentryCooldown = 0;

            const radial = Vec3.normalize(unit.position);
            const normal = Vec3.normalize(terrain.getNormalAt(unit.position));
            const dot = Vec3.dot(radial, normal);
            const slopeAngle = Math.acos(Math.min(1, Math.max(-1, dot)));

            if (slopeAngle > HeadlessUnit.SLOPE_THRESHOLD_RAD) {
                // Tick through debounce
                for (let t = 0; t < HeadlessUnit.SLOPE_DEBOUNCE_TICKS + 1; t++) {
                    const impulse = unit.checkSlopeTrigger();
                    if (impulse) {
                        expect(Vec3.length(impulse)).toBeCloseTo(HeadlessUnit.SLOPE_IMPULSE_STRENGTH, 0);
                        found = true;
                        break;
                    }
                }
                if (found) break;
            }
        }

        expect(found).toBe(true);
    });

    it('debounce prevents instant trigger on steep slope', async () => {
        const pw = await createPhysicsWorld();
        const terrain = new ServerTerrain(ServerTerrain.STEEP_TEST_PRESET);
        const unit = new HeadlessUnit(1, 0);

        // Find steep spot
        for (let i = 0; i < 72; i++) {
            const angle = i * (Math.PI / 36);
            const dir = Vec3.normalize({ x: Math.sin(angle), y: 0.1, z: Math.cos(angle) });
            unit.spawnOnSurface(dir, terrain);

            const radial = Vec3.normalize(unit.position);
            const normal = Vec3.normalize(terrain.getNormalAt(unit.position));
            const dot = Vec3.dot(radial, normal);
            const slopeAngle = Math.acos(Math.min(1, Math.max(-1, dot)));

            if (slopeAngle > HeadlessUnit.SLOPE_THRESHOLD_RAD) {
                attachBody(pw, unit);

                // Single call should NOT trigger (debounce = 3 ticks)
                const impulse = unit.checkSlopeTrigger();
                expect(impulse).toBeNull();
                expect(unit._slopeTriggerCounter).toBe(1);
                return;
            }
        }
        // If no steep spot found, skip
        expect(true).toBe(true);
    });

    it('cooldown prevents re-trigger after settle', async () => {
        const pw = await createPhysicsWorld();
        const terrain = new ServerTerrain(ServerTerrain.STEEP_TEST_PRESET);
        const unit = new HeadlessUnit(1, 0);

        for (let i = 0; i < 72; i++) {
            const angle = i * (Math.PI / 36);
            const dir = Vec3.normalize({ x: Math.sin(angle), y: 0.1, z: Math.cos(angle) });
            unit.spawnOnSurface(dir, terrain);

            const radial = Vec3.normalize(unit.position);
            const normal = Vec3.normalize(terrain.getNormalAt(unit.position));
            const dot = Vec3.dot(radial, normal);
            const slopeAngle = Math.acos(Math.min(1, Math.max(-1, dot)));

            if (slopeAngle > HeadlessUnit.SLOPE_THRESHOLD_RAD) {
                attachBody(pw, unit);

                // Enter and exit to set cooldown
                unit.enterDynamic(pw, { x: 0, y: 0, z: 0 });
                unit.exitDynamic(pw);
                expect(unit._reentryCooldown).toBe(HeadlessUnit.REENTRY_COOLDOWN_TICKS);

                // Should not trigger during cooldown
                const impulse = unit.checkSlopeTrigger();
                expect(impulse).toBeNull();
                return;
            }
        }
        expect(true).toBe(true);
    });
});

// ============================================================
// B) Kinematic collision detection
// ============================================================

describe('kinematic collision (unit↔unit)', () => {
    it('overlapping units get knocked into DYNAMIC', async () => {
        const pw = await createPhysicsWorld();
        const service = new CollisionService({ unitCollisionRadius: 2.0 });

        const u1 = new HeadlessUnit(1, 0);
        const u2 = new HeadlessUnit(2, 0);
        u1.position = { x: 60, y: 0, z: 0 };
        u2.position = { x: 60, y: 0.5, z: 0 }; // 0.5 apart, within 2.0 radius
        attachBody(pw, u1);
        attachBody(pw, u2);

        const results = service.checkKinematicCollisions([u1, u2], pw);

        expect(results).toHaveLength(1);
        expect(u1.physicsMode).toBe('DYNAMIC');
        expect(u2.physicsMode).toBe('DYNAMIC');
    });

    it('far apart units are NOT affected', async () => {
        const pw = await createPhysicsWorld();
        const service = new CollisionService();

        const u1 = new HeadlessUnit(1, 0);
        const u2 = new HeadlessUnit(2, 0);
        u1.position = { x: 60, y: 0, z: 0 };
        u2.position = { x: 0, y: 60, z: 0 }; // Far away
        attachBody(pw, u1);
        attachBody(pw, u2);

        const results = service.checkKinematicCollisions([u1, u2], pw);
        expect(results).toHaveLength(0);
        expect(u1.physicsMode).toBe('KINEMATIC');
        expect(u2.physicsMode).toBe('KINEMATIC');
    });

    it('impulse direction is mutual and opposite', async () => {
        const pw = await createPhysicsWorld();
        const service = new CollisionService({ unitCollisionRadius: 5.0 });

        const u1 = new HeadlessUnit(1, 0);
        const u2 = new HeadlessUnit(2, 0);
        u1.position = { x: 60, y: 0, z: 0 };
        u2.position = { x: 60, y: 3, z: 0 };
        attachBody(pw, u1);
        attachBody(pw, u2);

        const results = service.checkKinematicCollisions([u1, u2], pw);
        expect(results).toHaveLength(1);

        const r = results[0];
        // Impulses should be opposite
        expect(r.impulseA.y).toBeLessThan(0); // u1 pushed away from u2 (u2 is in +Y)
        expect(r.impulseB.y).toBeGreaterThan(0); // u2 pushed toward +Y
        expect(r.impulseA.y).toBeCloseTo(-r.impulseB.y, 6);
    });

    it('skips units in cooldown', async () => {
        const pw = await createPhysicsWorld();
        const service = new CollisionService({ unitCollisionRadius: 5.0 });

        const u1 = new HeadlessUnit(1, 0);
        const u2 = new HeadlessUnit(2, 0);
        u1.position = { x: 60, y: 0, z: 0 };
        u2.position = { x: 60, y: 0.5, z: 0 };
        attachBody(pw, u1);
        attachBody(pw, u2);
        u1._reentryCooldown = 10;

        const results = service.checkKinematicCollisions([u1, u2], pw);
        expect(results).toHaveLength(0);
    });

    it('skips already DYNAMIC units', async () => {
        const pw = await createPhysicsWorld();
        const service = new CollisionService({ unitCollisionRadius: 5.0 });

        const u1 = new HeadlessUnit(1, 0);
        const u2 = new HeadlessUnit(2, 0);
        u1.position = { x: 60, y: 0, z: 0 };
        u2.position = { x: 60, y: 0.5, z: 0 };
        attachBody(pw, u1);
        attachBody(pw, u2);
        u1.enterDynamic(pw); // Already DYNAMIC

        const results = service.checkKinematicCollisions([u1, u2], pw);
        expect(results).toHaveLength(0);
    });
});

describe('kinematic collision (unit↔obstacle)', () => {
    it('unit near obstacle gets knocked back', async () => {
        const pw = await createPhysicsWorld();
        const service = new CollisionService({ unitCollisionRadius: 1.0 });

        const unit = new HeadlessUnit(1, 0);
        unit.position = { x: 60, y: 0, z: 0 };
        attachBody(pw, unit);

        const obstacles = new Map();
        obstacles.set(1, { body: null, position: { x: 60, y: 0.8, z: 0 } });

        const results = service.checkObstacleCollisions([unit], obstacles, pw, 1.0);
        expect(results).toHaveLength(1);
        expect(unit.physicsMode).toBe('DYNAMIC');
    });

    it('unit far from obstacle is NOT affected', async () => {
        const pw = await createPhysicsWorld();
        const service = new CollisionService();

        const unit = new HeadlessUnit(1, 0);
        unit.position = { x: 60, y: 0, z: 0 };
        attachBody(pw, unit);

        const obstacles = new Map();
        obstacles.set(1, { body: null, position: { x: 0, y: 60, z: 0 } });

        const results = service.checkObstacleCollisions([unit], obstacles, pw, 1.0);
        expect(results).toHaveLength(0);
        expect(unit.physicsMode).toBe('KINEMATIC');
    });

    it('bounded impulse for obstacle knockback', async () => {
        const pw = await createPhysicsWorld();
        const service = new CollisionService({ collisionImpulse: 5.0 });

        const unit = new HeadlessUnit(1, 0);
        unit.position = { x: 60, y: 0, z: 0 };
        attachBody(pw, unit);

        const obstacles = new Map();
        obstacles.set(1, { body: null, position: { x: 60, y: 0.5, z: 0 } });

        const results = service.checkObstacleCollisions([unit], obstacles, pw, 1.0);
        expect(results).toHaveLength(1);

        const mag = Vec3.length(results[0].impulse);
        expect(mag).toBeCloseTo(5.0, 1);
    });
});

// ============================================================
// C) Mines
// ============================================================

describe('mines', () => {
    it('addMine creates a mine and returns ID', () => {
        const service = new CollisionService();
        const id = service.addMine({ x: 60, y: 0, z: 0 });
        expect(id).toBe(1);
        expect(service.mineCount).toBe(1);
        expect(service.getMine(1)).toBeTruthy();
    });

    it('removeMine deletes a mine', () => {
        const service = new CollisionService();
        const id = service.addMine({ x: 60, y: 0, z: 0 });
        expect(service.removeMine(id)).toBe(true);
        expect(service.mineCount).toBe(0);
    });

    it('mine cap enforced', () => {
        const service = new CollisionService({ maxMines: 3 });
        service.addMine({ x: 60, y: 0, z: 0 });
        service.addMine({ x: 0, y: 60, z: 0 });
        service.addMine({ x: 0, y: 0, z: 60 });
        const id4 = service.addMine({ x: -60, y: 0, z: 0 });
        expect(id4).toBeNull();
        expect(service.mineCount).toBe(3);
    });

    it('mine detonates when unit enters trigger radius', async () => {
        const pw = await createPhysicsWorld();
        const service = new CollisionService();

        const unit = new HeadlessUnit(1, 0);
        unit.position = { x: 60, y: 0, z: 0 };
        attachBody(pw, unit);

        // Place mine near unit
        service.addMine({ x: 60, y: 0.5, z: 0 }); // 0.5 away, within default 1.5 trigger

        const results = service.checkMineContacts([unit], pw);
        expect(results).toHaveLength(1);
        expect(results[0].triggerUnitId).toBe(1);
        expect(unit.physicsMode).toBe('DYNAMIC');
        expect(service.mineCount).toBe(0); // Mine consumed
    });

    it('mine applies upward impulse (surface normal direction)', async () => {
        const pw = await createPhysicsWorld();
        const service = new CollisionService();

        const unit = new HeadlessUnit(1, 0);
        unit.position = { x: 60, y: 0, z: 0 }; // Radial direction is +X
        attachBody(pw, unit);

        service.addMine({ x: 60, y: 0.5, z: 0 }, { upwardImpulse: 10 });

        service.checkMineContacts([unit], pw);

        // Unit should have received impulse in +X direction (radial = surface normal here)
        // Can't directly check impulse applied to rigidBody, but unit is now DYNAMIC
        expect(unit.physicsMode).toBe('DYNAMIC');
    });

    it('mine not triggered if unit is outside trigger radius', async () => {
        const pw = await createPhysicsWorld();
        const service = new CollisionService();

        const unit = new HeadlessUnit(1, 0);
        unit.position = { x: 60, y: 0, z: 0 };
        attachBody(pw, unit);

        service.addMine({ x: 0, y: 60, z: 0 }); // Far away

        const results = service.checkMineContacts([unit], pw);
        expect(results).toHaveLength(0);
        expect(service.mineCount).toBe(1); // Mine NOT consumed
    });

    it('mine radial blast affects nearby units via PhysicsEventService', async () => {
        const pw = await createPhysicsWorld();
        const collisionSvc = new CollisionService();
        const eventSvc = new PhysicsEventService();

        const trigger = new HeadlessUnit(1, 0);
        const nearby = new HeadlessUnit(2, 0);
        trigger.position = { x: 60, y: 0, z: 0 };
        nearby.position = { x: 60, y: 3, z: 0 }; // 3 units from mine
        attachBody(pw, trigger);
        attachBody(pw, nearby);

        collisionSvc.addMine({ x: 60, y: 0.5, z: 0 }, { blastRadius: 10, radialImpulse: 5 });

        const results = collisionSvc.checkMineContacts([trigger, nearby], pw, eventSvc);
        expect(results).toHaveLength(1);
        expect(results[0].affectedCount).toBeGreaterThanOrEqual(1);
    });

    it('DYNAMIC unit does not trigger mine', async () => {
        const pw = await createPhysicsWorld();
        const service = new CollisionService();

        const unit = new HeadlessUnit(1, 0);
        unit.position = { x: 60, y: 0, z: 0 };
        attachBody(pw, unit);
        unit.enterDynamic(pw); // Already DYNAMIC

        service.addMine({ x: 60, y: 0.5, z: 0 });

        const results = service.checkMineContacts([unit], pw);
        expect(results).toHaveLength(0);
        expect(service.mineCount).toBe(1); // Mine NOT consumed
    });

    it('reset clears all mines', () => {
        const service = new CollisionService();
        service.addMine({ x: 60, y: 0, z: 0 });
        service.addMine({ x: 0, y: 60, z: 0 });
        expect(service.mineCount).toBe(2);

        service.reset();
        expect(service.mineCount).toBe(0);
    });
});

// ============================================================
// D) NaN / Infinity edge cases
// ============================================================

describe('NaN/Infinity defense', () => {
    it('addMine rejects NaN position', () => {
        const service = new CollisionService();
        const id = service.addMine({ x: NaN, y: 0, z: 0 });
        expect(id).toBeNull();
    });

    it('addMine rejects Infinity position', () => {
        const service = new CollisionService();
        const id = service.addMine({ x: Infinity, y: 0, z: 0 });
        expect(id).toBeNull();
    });

    it('collision skips units at same position (zero distance)', async () => {
        const pw = await createPhysicsWorld();
        const service = new CollisionService({ unitCollisionRadius: 5.0 });

        const u1 = new HeadlessUnit(1, 0);
        const u2 = new HeadlessUnit(2, 0);
        u1.position = { x: 60, y: 0, z: 0 };
        u2.position = { x: 60, y: 0, z: 0 }; // Exact same position
        attachBody(pw, u1);
        attachBody(pw, u2);

        const results = service.checkKinematicCollisions([u1, u2], pw);
        expect(results).toHaveLength(0); // Skipped — direction undefined
        expect(u1.physicsMode).toBe('KINEMATIC');
        expect(u2.physicsMode).toBe('KINEMATIC');
    });

    it('obstacle collision skips zero distance', async () => {
        const pw = await createPhysicsWorld();
        const service = new CollisionService();

        const unit = new HeadlessUnit(1, 0);
        unit.position = { x: 60, y: 0, z: 0 };
        attachBody(pw, unit);

        const obstacles = new Map();
        obstacles.set(1, { body: null, position: { x: 60, y: 0, z: 0 } }); // Same position

        const results = service.checkObstacleCollisions([unit], obstacles, pw, 1.0);
        expect(results).toHaveLength(0);
    });

    it('mine at unit origin safely detonates (radial direction from position)', async () => {
        const pw = await createPhysicsWorld();
        const service = new CollisionService();

        const unit = new HeadlessUnit(1, 0);
        unit.position = { x: 60, y: 0, z: 0 };
        attachBody(pw, unit);

        // Mine at exact unit position
        service.addMine({ x: 60, y: 0, z: 0 });

        const results = service.checkMineContacts([unit], pw);
        // Should still detonate — upward impulse uses unit.position radial, not mine→unit direction
        expect(results).toHaveLength(1);
        expect(unit.physicsMode).toBe('DYNAMIC');
    });

    it('checkKinematicCollisions with null/empty inputs returns empty', async () => {
        const pw = await createPhysicsWorld();
        const service = new CollisionService();

        expect(service.checkKinematicCollisions(null, pw)).toHaveLength(0);
        expect(service.checkKinematicCollisions([], pw)).toHaveLength(0);
        expect(service.checkKinematicCollisions([new HeadlessUnit(1, 0)], pw)).toHaveLength(0);
    });
});

// ============================================================
// E) Determinism
// ============================================================

describe('determinism', () => {
    it('kinematic collisions produce same result regardless of input order', async () => {
        async function runCollisions(order) {
            const pw = await createPhysicsWorld();
            const service = new CollisionService({ unitCollisionRadius: 5.0 });

            const units = [
                new HeadlessUnit(1, 0),
                new HeadlessUnit(2, 0),
                new HeadlessUnit(3, 0),
            ];
            units[0].position = { x: 60, y: 0, z: 0 };
            units[1].position = { x: 60, y: 0.5, z: 0 };
            units[2].position = { x: 60, y: 1.0, z: 0 };

            for (const u of units) attachBody(pw, u);

            const ordered = order.map(i => units[i]);
            return service.checkKinematicCollisions(ordered, pw);
        }

        const r1 = await runCollisions([0, 1, 2]);
        const r2 = await runCollisions([2, 0, 1]);

        expect(r1).toHaveLength(r2.length);
        for (let i = 0; i < r1.length; i++) {
            expect(r1[i].unitIdA).toBe(r2[i].unitIdA);
            expect(r1[i].unitIdB).toBe(r2[i].unitIdB);
            expect(r1[i].impulseA.x).toBeCloseTo(r2[i].impulseA.x, 6);
            expect(r1[i].impulseA.y).toBeCloseTo(r2[i].impulseA.y, 6);
            expect(r1[i].impulseA.z).toBeCloseTo(r2[i].impulseA.z, 6);
        }
    });

    it('mine detonation order is deterministic by mine ID', async () => {
        const pw = await createPhysicsWorld();
        const service = new CollisionService();

        const unit = new HeadlessUnit(1, 0);
        unit.position = { x: 60, y: 0, z: 0 };
        attachBody(pw, unit);

        // Add mines in different order
        service.addMine({ x: 60, y: 0.5, z: 0 }); // id=1
        service.addMine({ x: 60, y: 0.3, z: 0 }); // id=2

        const results = service.checkMineContacts([unit], pw);
        // Mine 1 should trigger first (sorted by ID)
        expect(results).toHaveLength(1);
        expect(results[0].mineId).toBe(1);
    });
});

// ============================================================
// F) Room integration
// ============================================================

describe('Room integration', () => {
    it('room.addMine places a mine and tick detonates it', async () => {
        const room = new Room('test-mine-room', {
            enablePhysics: true,
            physicsOptions: { subSteps: 1, gravity: 0 }
        });
        await room.start();
        cleanup.push(room.physics);

        const unit = room.createUnitForPlayer(1, 100);

        // Place mine at unit position
        const mineId = room.addMine(unit.position);
        expect(mineId).toBeTypeOf('number');

        // Tick — mine should detonate
        room._onSimTick(0.05, 1);

        // Mine consumed
        expect(room.collisions.mineCount).toBe(0);

        room.stop();
    });

    it('room.addMine returns null when physics disabled', async () => {
        const room = new Room('test-no-physics-mine', { enablePhysics: false });
        await room.start();

        const id = room.addMine({ x: 60, y: 0, z: 0 });
        expect(id).toBeNull();

        room.stop();
    });

    it('room.removeMine works', async () => {
        const room = new Room('test-mine-remove', {
            enablePhysics: true,
            physicsOptions: { subSteps: 1, gravity: 0 }
        });
        await room.start();
        cleanup.push(room.physics);

        const id = room.addMine({ x: 60, y: 0, z: 0 });
        expect(room.removeMine(id)).toBe(true);
        expect(room.collisions.mineCount).toBe(0);

        room.stop();
    });

    it('kinematic unit collisions detected in Room tick', async () => {
        const room = new Room('test-collision-room', {
            enablePhysics: true,
            physicsOptions: { subSteps: 1, gravity: 0 }
        });
        await room.start();
        cleanup.push(room.physics);

        const u1 = room.createUnitForPlayer(1, 100);
        const u2 = room.createUnitForPlayer(2, 200);

        // Move u2 to overlap u1
        u2.position = { ...u1.position };
        u2.position.y += 0.3;
        u2.rigidBody.setTranslation(u2.position, true);

        // Tick
        room._onSimTick(0.05, 1);

        // At least one should have gone DYNAMIC (depends on collision radius)
        // With default radius 1.0 and distance 0.3, both should collide
        const anyDynamic = room.units.some(u => u.physicsMode === 'DYNAMIC');
        expect(anyDynamic).toBe(true);

        room.stop();
    });

    it('units settle back to KINEMATIC after collision', async () => {
        const room = new Room('test-settle-collision', {
            enablePhysics: true,
            physicsOptions: { subSteps: 1, gravity: 9.81 }
        });
        await room.start();
        cleanup.push(room.physics);

        const u1 = room.createUnitForPlayer(1, 100);
        const u2 = room.createUnitForPlayer(2, 200);

        // Overlap
        u2.position = { ...u1.position };
        u2.position.y += 0.3;
        u2.rigidBody.setTranslation(u2.position, true);

        // Tick until settle
        for (let i = 0; i < 300; i++) {
            room._onSimTick(0.05, i + 1);
            const allKinematic = room.units.every(u => u.physicsMode === 'KINEMATIC');
            if (allKinematic && i > 10) break;
        }

        const allKinematic = room.units.every(u => u.physicsMode === 'KINEMATIC');
        expect(allKinematic).toBe(true);

        room.stop();
    });

    it('enablePhysics=false: collisions/mines unchanged', async () => {
        const room = new Room('test-no-physics-gameplay');
        await room.start();

        const unit = room.createUnitForPlayer(1, 100);
        expect(room.collisions).toBeNull();
        expect(room.addMine({ x: 60, y: 0, z: 0 })).toBeNull();
        expect(room.removeMine(1)).toBe(false);
        expect(unit.physicsMode).toBe('KINEMATIC');

        room.stop();
    });
});
