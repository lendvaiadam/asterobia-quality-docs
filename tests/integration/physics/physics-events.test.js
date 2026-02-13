/**
 * Physics Events Integration Tests (Phase 3 Step 5)
 *
 * Validates PhysicsEventService:
 *   - Radial impulse (explosion/knockback) with linear falloff
 *   - Directed impulse (single target knockback)
 *   - Determinism: same inputs → same results (sort by unitId)
 *   - NaN/Infinity defense (zero distance, NaN coords, Infinity)
 *   - Safety caps: maxRadius, maxImpulse, maxAffected
 *   - enablePhysics=false regression
 *   - Multi-unit independence (no state contamination)
 *   - Room integration (triggerExplosion + settle-back flow)
 *
 * Run: npx vitest run tests/integration/physics/physics-events.test.js
 */

import { describe, it, expect, afterEach } from 'vitest';
import { PhysicsEventService } from '../../../server/PhysicsEventService.js';
import { HeadlessUnit } from '../../../server/HeadlessUnit.js';
import { PhysicsWorld } from '../../../server/PhysicsWorld.js';
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

/**
 * Create a PhysicsWorld + attach a rigid body to a unit.
 * Returns the PhysicsWorld instance (also pushed to cleanup).
 */
async function setupPhysics(unit) {
    const pw = await PhysicsWorld.create({ subSteps: 1, gravity: 9.81 });
    cleanup.push(pw);
    const body = pw.createKinematicBody(unit.position);
    pw.addBallCollider(body, 0.5, { activeEvents: true });
    unit.rigidBody = body;
    return pw;
}

/**
 * Create a PhysicsWorld + attach rigid bodies to multiple units.
 */
async function setupPhysicsMulti(units) {
    const pw = await PhysicsWorld.create({ subSteps: 1, gravity: 9.81 });
    cleanup.push(pw);
    for (const unit of units) {
        const body = pw.createKinematicBody(unit.position);
        pw.addBallCollider(body, 0.5, { activeEvents: true });
        unit.rigidBody = body;
    }
    return pw;
}

// ============================================================
// Radial impulse
// ============================================================

describe('radial impulse', () => {
    it('affects units within radius', async () => {
        const service = new PhysicsEventService();
        const u1 = new HeadlessUnit(1, 0);
        const u2 = new HeadlessUnit(2, 0);
        u1.position = { x: 100, y: 0, z: 0 };
        u2.position = { x: 105, y: 0, z: 0 }; // 5 units from center
        const pw = await setupPhysicsMulti([u1, u2]);

        const center = { x: 100, y: 0, z: 0 }; // At u1, 5 from u2
        const results = service.applyRadialImpulse({
            center,
            radius: 10,
            strength: 10,
            units: [u1, u2],
            physicsWorld: pw
        });

        // u1 is at center (distance 0) → skipped
        // u2 is 5 units away → affected
        expect(results).toHaveLength(1);
        expect(results[0].unitId).toBe(2);
        expect(results[0].distance).toBeCloseTo(5, 1);
        expect(u2.physicsMode).toBe('DYNAMIC');
    });

    it('applies linear falloff', async () => {
        const service = new PhysicsEventService();
        const u1 = new HeadlessUnit(1, 0);
        const u2 = new HeadlessUnit(2, 0);
        u1.position = { x: 100, y: 2, z: 0 }; // 2 from center
        u2.position = { x: 100, y: 8, z: 0 }; // 8 from center
        const pw = await setupPhysicsMulti([u1, u2]);

        const center = { x: 100, y: 0, z: 0 };
        const results = service.applyRadialImpulse({
            center,
            radius: 10,
            strength: 10,
            units: [u1, u2],
            physicsWorld: pw
        });

        expect(results).toHaveLength(2);

        // u1 at dist 2: falloff = 1 - 2/10 = 0.8, magnitude = 10 * 0.8 = 8
        const r1 = results.find(r => r.unitId === 1);
        const mag1 = Vec3.length(r1.impulse);
        expect(mag1).toBeCloseTo(8, 1);

        // u2 at dist 8: falloff = 1 - 8/10 = 0.2, magnitude = 10 * 0.2 = 2
        const r2 = results.find(r => r.unitId === 2);
        const mag2 = Vec3.length(r2.impulse);
        expect(mag2).toBeCloseTo(2, 1);
    });

    it('impulse direction is outward from center', async () => {
        const service = new PhysicsEventService();
        const unit = new HeadlessUnit(1, 0);
        unit.position = { x: 100, y: 5, z: 0 };
        const pw = await setupPhysics(unit);

        const center = { x: 100, y: 0, z: 0 };
        const results = service.applyRadialImpulse({
            center,
            radius: 10,
            strength: 10,
            units: [unit],
            physicsWorld: pw
        });

        expect(results).toHaveLength(1);
        // Direction should be +Y (from center toward unit)
        expect(results[0].impulse.y).toBeGreaterThan(0);
        expect(Math.abs(results[0].impulse.x)).toBeLessThan(0.01);
        expect(Math.abs(results[0].impulse.z)).toBeLessThan(0.01);
    });

    it('does not affect units outside radius', async () => {
        const service = new PhysicsEventService();
        const unit = new HeadlessUnit(1, 0);
        unit.position = { x: 100, y: 15, z: 0 };
        const pw = await setupPhysics(unit);

        const results = service.applyRadialImpulse({
            center: { x: 100, y: 0, z: 0 },
            radius: 10,
            strength: 10,
            units: [unit],
            physicsWorld: pw
        });

        expect(results).toHaveLength(0);
        expect(unit.physicsMode).toBe('KINEMATIC');
    });

    it('skips units already in DYNAMIC mode', async () => {
        const service = new PhysicsEventService();
        const unit = new HeadlessUnit(1, 0);
        unit.position = { x: 100, y: 3, z: 0 };
        const pw = await setupPhysics(unit);

        // Pre-enter dynamic
        unit.enterDynamic(pw, { x: 0, y: 1, z: 0 });
        expect(unit.physicsMode).toBe('DYNAMIC');

        const results = service.applyRadialImpulse({
            center: { x: 100, y: 0, z: 0 },
            radius: 10,
            strength: 10,
            units: [unit],
            physicsWorld: pw
        });

        expect(results).toHaveLength(0);
    });

    it('skips units in reentry cooldown', async () => {
        const service = new PhysicsEventService();
        const unit = new HeadlessUnit(1, 0);
        unit.position = { x: 100, y: 3, z: 0 };
        const pw = await setupPhysics(unit);

        // Simulate reentry cooldown
        unit._reentryCooldown = 10;

        const results = service.applyRadialImpulse({
            center: { x: 100, y: 0, z: 0 },
            radius: 10,
            strength: 10,
            units: [unit],
            physicsWorld: pw
        });

        expect(results).toHaveLength(0);
        expect(unit.physicsMode).toBe('KINEMATIC');
    });

    it('returns empty array for empty units', async () => {
        const service = new PhysicsEventService();
        const results = service.applyRadialImpulse({
            center: { x: 0, y: 0, z: 0 },
            radius: 10,
            strength: 10,
            units: [],
            physicsWorld: {}
        });
        expect(results).toHaveLength(0);
    });
});

// ============================================================
// Directed impulse
// ============================================================

describe('directed impulse', () => {
    it('transitions unit to DYNAMIC with given direction', async () => {
        const service = new PhysicsEventService();
        const unit = new HeadlessUnit(1, 0);
        unit.position = { x: 100, y: 0, z: 0 };
        const pw = await setupPhysics(unit);

        const result = service.applyDirectedImpulse({
            unit,
            direction: { x: 0, y: 1, z: 0 },
            strength: 5,
            physicsWorld: pw
        });

        expect(result).not.toBeNull();
        expect(result.unitId).toBe(1);
        expect(unit.physicsMode).toBe('DYNAMIC');

        // Impulse should be normalized direction * strength
        expect(result.impulse.y).toBeCloseTo(5, 1);
        expect(Math.abs(result.impulse.x)).toBeLessThan(0.01);
    });

    it('normalizes non-unit direction', async () => {
        const service = new PhysicsEventService();
        const unit = new HeadlessUnit(1, 0);
        unit.position = { x: 100, y: 0, z: 0 };
        const pw = await setupPhysics(unit);

        const result = service.applyDirectedImpulse({
            unit,
            direction: { x: 0, y: 3, z: 0 }, // Not normalized
            strength: 5,
            physicsWorld: pw
        });

        expect(result).not.toBeNull();
        // Magnitude should be exactly strength (direction normalized)
        const mag = Vec3.length(result.impulse);
        expect(mag).toBeCloseTo(5, 4);
    });

    it('caps strength at maxImpulse', async () => {
        const service = new PhysicsEventService({ maxImpulse: 8 });
        const unit = new HeadlessUnit(1, 0);
        unit.position = { x: 100, y: 0, z: 0 };
        const pw = await setupPhysics(unit);

        const result = service.applyDirectedImpulse({
            unit,
            direction: { x: 1, y: 0, z: 0 },
            strength: 100, // Way over cap
            physicsWorld: pw
        });

        expect(result).not.toBeNull();
        const mag = Vec3.length(result.impulse);
        expect(mag).toBeCloseTo(8, 4);
    });

    it('returns null for DYNAMIC unit', async () => {
        const service = new PhysicsEventService();
        const unit = new HeadlessUnit(1, 0);
        unit.position = { x: 100, y: 0, z: 0 };
        const pw = await setupPhysics(unit);
        unit.enterDynamic(pw);

        const result = service.applyDirectedImpulse({
            unit,
            direction: { x: 1, y: 0, z: 0 },
            strength: 5,
            physicsWorld: pw
        });

        expect(result).toBeNull();
    });

    it('returns null for unit without rigidBody', () => {
        const service = new PhysicsEventService();
        const unit = new HeadlessUnit(1, 0);
        unit.position = { x: 100, y: 0, z: 0 };
        // No rigid body attached

        const result = service.applyDirectedImpulse({
            unit,
            direction: { x: 1, y: 0, z: 0 },
            strength: 5,
            physicsWorld: {}
        });

        expect(result).toBeNull();
    });
});

// ============================================================
// Determinism
// ============================================================

describe('determinism', () => {
    it('same inputs produce identical results regardless of array order', async () => {
        const service = new PhysicsEventService();

        // Create two sets of identical units in different array order
        async function runWithOrder(order) {
            const units = [
                new HeadlessUnit(1, 0),
                new HeadlessUnit(2, 0),
                new HeadlessUnit(3, 0),
            ];
            units[0].position = { x: 100, y: 2, z: 0 };
            units[1].position = { x: 100, y: 5, z: 0 };
            units[2].position = { x: 100, y: 8, z: 0 };

            const pw = await setupPhysicsMulti(units);
            const ordered = order.map(i => units[i]);

            return service.applyRadialImpulse({
                center: { x: 100, y: 0, z: 0 },
                radius: 10,
                strength: 10,
                units: ordered,
                physicsWorld: pw
            });
        }

        const results1 = await runWithOrder([0, 1, 2]); // natural order
        const results2 = await runWithOrder([2, 0, 1]); // shuffled order

        // Both should produce same 3 results in same unit ID order
        expect(results1).toHaveLength(3);
        expect(results2).toHaveLength(3);

        for (let i = 0; i < 3; i++) {
            expect(results1[i].unitId).toBe(results2[i].unitId);
            expect(results1[i].impulse.x).toBeCloseTo(results2[i].impulse.x, 6);
            expect(results1[i].impulse.y).toBeCloseTo(results2[i].impulse.y, 6);
            expect(results1[i].impulse.z).toBeCloseTo(results2[i].impulse.z, 6);
            expect(results1[i].distance).toBeCloseTo(results2[i].distance, 6);
        }
    });

    it('results are sorted by unitId', async () => {
        const service = new PhysicsEventService();
        const units = [
            new HeadlessUnit(42, 0),
            new HeadlessUnit(7, 0),
            new HeadlessUnit(99, 0),
        ];
        units[0].position = { x: 100, y: 3, z: 0 };
        units[1].position = { x: 100, y: 5, z: 0 };
        units[2].position = { x: 100, y: 7, z: 0 };

        const pw = await setupPhysicsMulti(units);

        const results = service.applyRadialImpulse({
            center: { x: 100, y: 0, z: 0 },
            radius: 10,
            strength: 10,
            units,
            physicsWorld: pw
        });

        expect(results).toHaveLength(3);
        expect(results[0].unitId).toBe(7);
        expect(results[1].unitId).toBe(42);
        expect(results[2].unitId).toBe(99);
    });
});

// ============================================================
// NaN / Infinity defense
// ============================================================

describe('NaN/Infinity defense', () => {
    it('skips unit at exactly center (zero distance)', async () => {
        const service = new PhysicsEventService();
        const unit = new HeadlessUnit(1, 0);
        unit.position = { x: 100, y: 0, z: 0 };
        const pw = await setupPhysics(unit);

        const results = service.applyRadialImpulse({
            center: { x: 100, y: 0, z: 0 }, // Same as unit position
            radius: 10,
            strength: 10,
            units: [unit],
            physicsWorld: pw
        });

        expect(results).toHaveLength(0);
        expect(unit.physicsMode).toBe('KINEMATIC'); // Unchanged
    });

    it('skips unit at extremely small distance (< epsilon)', async () => {
        const service = new PhysicsEventService();
        const unit = new HeadlessUnit(1, 0);
        unit.position = { x: 100, y: 1e-10, z: 0 };
        const pw = await setupPhysics(unit);

        const results = service.applyRadialImpulse({
            center: { x: 100, y: 0, z: 0 },
            radius: 10,
            strength: 10,
            units: [unit],
            physicsWorld: pw
        });

        expect(results).toHaveLength(0);
    });

    it('rejects NaN center coordinates', async () => {
        const service = new PhysicsEventService();
        const unit = new HeadlessUnit(1, 0);
        unit.position = { x: 100, y: 5, z: 0 };
        const pw = await setupPhysics(unit);

        const results = service.applyRadialImpulse({
            center: { x: NaN, y: 0, z: 0 },
            radius: 10,
            strength: 10,
            units: [unit],
            physicsWorld: pw
        });

        expect(results).toHaveLength(0);
    });

    it('rejects Infinity center coordinates', async () => {
        const service = new PhysicsEventService();
        const unit = new HeadlessUnit(1, 0);
        unit.position = { x: 100, y: 5, z: 0 };
        const pw = await setupPhysics(unit);

        const results = service.applyRadialImpulse({
            center: { x: Infinity, y: 0, z: 0 },
            radius: 10,
            strength: 10,
            units: [unit],
            physicsWorld: pw
        });

        expect(results).toHaveLength(0);
    });

    it('rejects NaN radius', async () => {
        const service = new PhysicsEventService();
        const results = service.applyRadialImpulse({
            center: { x: 100, y: 0, z: 0 },
            radius: NaN,
            strength: 10,
            units: [new HeadlessUnit(1, 0)],
            physicsWorld: {}
        });
        expect(results).toHaveLength(0);
    });

    it('rejects negative radius', async () => {
        const service = new PhysicsEventService();
        const results = service.applyRadialImpulse({
            center: { x: 100, y: 0, z: 0 },
            radius: -5,
            strength: 10,
            units: [new HeadlessUnit(1, 0)],
            physicsWorld: {}
        });
        expect(results).toHaveLength(0);
    });

    it('rejects NaN strength', async () => {
        const service = new PhysicsEventService();
        const results = service.applyRadialImpulse({
            center: { x: 100, y: 0, z: 0 },
            radius: 10,
            strength: NaN,
            units: [new HeadlessUnit(1, 0)],
            physicsWorld: {}
        });
        expect(results).toHaveLength(0);
    });

    it('directed impulse rejects zero-length direction', async () => {
        const service = new PhysicsEventService();
        const unit = new HeadlessUnit(1, 0);
        unit.position = { x: 100, y: 0, z: 0 };
        const pw = await setupPhysics(unit);

        const result = service.applyDirectedImpulse({
            unit,
            direction: { x: 0, y: 0, z: 0 },
            strength: 5,
            physicsWorld: pw
        });

        expect(result).toBeNull();
    });

    it('directed impulse rejects NaN direction', async () => {
        const service = new PhysicsEventService();
        const unit = new HeadlessUnit(1, 0);
        unit.position = { x: 100, y: 0, z: 0 };
        const pw = await setupPhysics(unit);

        const result = service.applyDirectedImpulse({
            unit,
            direction: { x: NaN, y: 1, z: 0 },
            strength: 5,
            physicsWorld: pw
        });

        expect(result).toBeNull();
    });

    it('handles units at very large coordinates', async () => {
        const service = new PhysicsEventService();
        const unit = new HeadlessUnit(1, 0);
        unit.position = { x: 1e6, y: 5, z: 0 };
        const pw = await setupPhysics(unit);

        const results = service.applyRadialImpulse({
            center: { x: 1e6, y: 0, z: 0 },
            radius: 10,
            strength: 10,
            units: [unit],
            physicsWorld: pw
        });

        expect(results).toHaveLength(1);
        expect(isFinite(results[0].impulse.x)).toBe(true);
        expect(isFinite(results[0].impulse.y)).toBe(true);
        expect(isFinite(results[0].impulse.z)).toBe(true);
    });
});

// ============================================================
// Safety caps
// ============================================================

describe('safety caps', () => {
    it('caps radius at maxRadius', async () => {
        const service = new PhysicsEventService({ maxRadius: 5 });
        const unit = new HeadlessUnit(1, 0);
        unit.position = { x: 100, y: 7, z: 0 }; // 7 from center, within 100 but outside cap 5
        const pw = await setupPhysics(unit);

        const results = service.applyRadialImpulse({
            center: { x: 100, y: 0, z: 0 },
            radius: 100,
            strength: 10,
            units: [unit],
            physicsWorld: pw
        });

        // Distance 7 > capped radius 5 → not affected
        expect(results).toHaveLength(0);
    });

    it('caps impulse magnitude at maxImpulse', async () => {
        const service = new PhysicsEventService({ maxImpulse: 3 });
        const unit = new HeadlessUnit(1, 0);
        unit.position = { x: 100, y: 1, z: 0 }; // Very close to center → high falloff factor
        const pw = await setupPhysics(unit);

        const results = service.applyRadialImpulse({
            center: { x: 100, y: 0, z: 0 },
            radius: 10,
            strength: 100, // Way over cap → capped to 3
            units: [unit],
            physicsWorld: pw
        });

        expect(results).toHaveLength(1);
        const mag = Vec3.length(results[0].impulse);
        // Max possible = cappedStrength * falloff(1/10) = 3 * 0.9 = 2.7
        expect(mag).toBeLessThanOrEqual(3.01);
    });

    it('caps affected units at maxAffected', async () => {
        const service = new PhysicsEventService({ maxAffected: 2 });
        const units = [];
        for (let i = 0; i < 5; i++) {
            const u = new HeadlessUnit(i + 1, 0);
            u.position = { x: 100, y: (i + 1) * 1.5, z: 0 };
            units.push(u);
        }
        const pw = await setupPhysicsMulti(units);

        const results = service.applyRadialImpulse({
            center: { x: 100, y: 0, z: 0 },
            radius: 20,
            strength: 10,
            units,
            physicsWorld: pw
        });

        // Should be capped at 2 despite 5 units in range
        expect(results).toHaveLength(2);
        // First 2 by sorted ID
        expect(results[0].unitId).toBe(1);
        expect(results[1].unitId).toBe(2);
    });

    it('uses default caps when none specified', () => {
        const service = new PhysicsEventService();
        expect(service.maxRadius).toBe(50);
        expect(service.maxImpulse).toBe(20);
        expect(service.maxAffected).toBe(16);
    });
});

// ============================================================
// Multi-unit independence
// ============================================================

describe('multi-unit independence', () => {
    it('radial impulse does not contaminate unaffected units', async () => {
        const service = new PhysicsEventService();
        const nearUnit = new HeadlessUnit(1, 0);
        const farUnit = new HeadlessUnit(2, 0);
        nearUnit.position = { x: 100, y: 3, z: 0 };
        farUnit.position = { x: 200, y: 0, z: 0 }; // Far away
        const pw = await setupPhysicsMulti([nearUnit, farUnit]);

        service.applyRadialImpulse({
            center: { x: 100, y: 0, z: 0 },
            radius: 10,
            strength: 10,
            units: [nearUnit, farUnit],
            physicsWorld: pw
        });

        expect(nearUnit.physicsMode).toBe('DYNAMIC');
        expect(farUnit.physicsMode).toBe('KINEMATIC'); // Unchanged
        expect(farUnit.speed).toBe(0);
    });

    it('each affected unit gets independent impulse vector', async () => {
        const service = new PhysicsEventService();
        const u1 = new HeadlessUnit(1, 0);
        const u2 = new HeadlessUnit(2, 0);
        u1.position = { x: 100, y: 3, z: 0 };  // Offset in +Y
        u2.position = { x: 100, y: 0, z: 3 };  // Offset in +Z
        const pw = await setupPhysicsMulti([u1, u2]);

        const results = service.applyRadialImpulse({
            center: { x: 100, y: 0, z: 0 },
            radius: 10,
            strength: 10,
            units: [u1, u2],
            physicsWorld: pw
        });

        expect(results).toHaveLength(2);
        const r1 = results.find(r => r.unitId === 1);
        const r2 = results.find(r => r.unitId === 2);

        // u1 should have impulse mostly in +Y
        expect(r1.impulse.y).toBeGreaterThan(0);
        expect(Math.abs(r1.impulse.z)).toBeLessThan(0.1);

        // u2 should have impulse mostly in +Z
        expect(r2.impulse.z).toBeGreaterThan(0);
        expect(Math.abs(r2.impulse.y)).toBeLessThan(0.1);
    });
});

// ============================================================
// Room integration
// ============================================================

describe('Room integration', () => {
    it('room.triggerExplosion applies radial impulse to units', async () => {
        const room = new Room('test-explosion', {
            enablePhysics: true,
            physicsOptions: { subSteps: 1, gravity: 9.81 }
        });
        await room.start();
        cleanup.push(room.physics);

        const u1 = room.createUnitForPlayer(1, 100);
        const u2 = room.createUnitForPlayer(2, 200);

        // Place u2 near u1
        const offset = Vec3.normalize(u1.position);
        u2.position = Vec3.add(u1.position, Vec3.scale(offset, 3));
        u2.rigidBody.setTranslation(u2.position, true);

        const results = room.triggerExplosion(u1.position, 10, 8);

        // u1 at center → skipped (zero distance)
        // u2 at dist 3 → affected
        expect(results.length).toBeGreaterThanOrEqual(1);
        const hitU2 = results.find(r => r.unitId === u2.id);
        expect(hitU2).toBeTruthy();
        expect(u2.physicsMode).toBe('DYNAMIC');
    });

    it('room.triggerExplosion returns empty if physics disabled', async () => {
        const room = new Room('test-no-physics', {
            enablePhysics: false
        });
        await room.start();

        const u1 = room.createUnitForPlayer(1, 100);
        const results = room.triggerExplosion({ x: 100, y: 0, z: 0 }, 10, 8);

        expect(results).toHaveLength(0);
        expect(u1.physicsMode).toBe('KINEMATIC');
    });

    it('units settle back to KINEMATIC after explosion', async () => {
        const room = new Room('test-settle', {
            enablePhysics: true,
            physicsOptions: { subSteps: 1, gravity: 9.81 }
        });
        await room.start();
        cleanup.push(room.physics);

        const unit = room.createUnitForPlayer(1, 100);
        const offset = Vec3.normalize(unit.position);
        // Move unit slightly so it's not at center
        const blastCenter = Vec3.add(unit.position, Vec3.scale(offset, -5));

        room.triggerExplosion(blastCenter, 10, 5);
        expect(unit.physicsMode).toBe('DYNAMIC');

        // Tick enough times for physics to settle
        const dtSec = 0.05;
        for (let i = 0; i < 200; i++) {
            room._onSimTick(dtSec, i + 1);
            if (unit.physicsMode === 'KINEMATIC') break;
        }

        expect(unit.physicsMode).toBe('KINEMATIC');
    });

    it('room._devTriggerExplosion fires explosion at unit position', async () => {
        const room = new Room('test-dev-trigger', {
            enablePhysics: true,
            physicsOptions: { subSteps: 1, gravity: 9.81 }
        });
        await room.start();
        cleanup.push(room.physics);

        const u1 = room.createUnitForPlayer(1, 100);
        const u2 = room.createUnitForPlayer(2, 200);

        // Place u2 near u1
        const offset = Vec3.normalize(u1.position);
        u2.position = Vec3.add(u1.position, Vec3.scale(offset, 3));
        u2.rigidBody.setTranslation(u2.position, true);

        const results = room._devTriggerExplosion(u1.id);

        expect(results).not.toBeNull();
        expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it('room._devTriggerExplosion returns null for invalid unit ID', async () => {
        const room = new Room('test-dev-invalid', {
            enablePhysics: true,
            physicsOptions: { subSteps: 1, gravity: 9.81 }
        });
        await room.start();
        cleanup.push(room.physics);

        const result = room._devTriggerExplosion(999);
        expect(result).toBeNull();
    });
});

// ============================================================
// Regression: enablePhysics=false
// ============================================================

describe('regression: enablePhysics=false', () => {
    it('PhysicsEventService returns empty when no rigid bodies exist', () => {
        const service = new PhysicsEventService();
        const unit = new HeadlessUnit(1, 0);
        unit.position = { x: 100, y: 3, z: 0 };
        // No rigid body

        const results = service.applyRadialImpulse({
            center: { x: 100, y: 0, z: 0 },
            radius: 10,
            strength: 10,
            units: [unit],
            physicsWorld: null
        });

        expect(results).toHaveLength(0);
    });

    it('room without physics handles triggerExplosion gracefully', async () => {
        const room = new Room('test-no-physics-2', { enablePhysics: false });
        await room.start();

        const unit = room.createUnitForPlayer(1, 100);
        const results = room.triggerExplosion(unit.position, 10, 10);

        expect(results).toHaveLength(0);
        expect(unit.physicsMode).toBe('KINEMATIC');
    });
});
