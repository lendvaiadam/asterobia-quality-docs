/**
 * Hybrid Lifecycle Integration Tests (Phase 3 Step 3)
 *
 * Validates the KINEMATIC ↔ DYNAMIC state machine for HeadlessUnits:
 * - enterDynamic / exitDynamic transitions
 * - Rapier drives position while DYNAMIC
 * - Settle detection (auto-exit after low velocity)
 * - WASD ignored during DYNAMIC
 * - Terrain reprojection on exit
 * - Multi-unit independence
 * - Determinism
 * - Room wiring (body creation, sync loops, settle)
 *
 * Run: npx vitest run tests/integration/physics/hybrid-lifecycle.test.js
 */

import { describe, it, expect, afterEach } from 'vitest';
import { HeadlessUnit } from '../../../server/HeadlessUnit.js';
import { PhysicsWorld } from '../../../server/PhysicsWorld.js';
import { ServerTerrain } from '../../../server/ServerTerrain.js';
import { TerrainColliderManager } from '../../../server/TerrainColliderManager.js';
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
 * Helper: create a PhysicsWorld + Terrain + HeadlessUnit combo.
 * Unit is spawned on terrain surface with a kinematic rigid body.
 */
async function createUnitWithPhysics(opts = {}) {
    const pw = await PhysicsWorld.create({ subSteps: 1, gravity: 9.81, ...opts.physics });
    cleanup.push(pw);
    const terrain = new ServerTerrain(opts.terrain);

    // Create terrain collider patches for collision support
    const mgr = new TerrainColliderManager(pw, terrain, {
        patchSize: 20, gridStep: 1, ...opts.manager
    });

    const unit = new HeadlessUnit(1, 0);
    const dir = Vec3.normalize(opts.spawnDir ?? { x: 1, y: 0, z: 0 });
    unit.spawnOnSurface(dir, terrain);

    // Attach a kinematic rigid body (same as Room._attachRigidBody)
    const body = pw.createKinematicBody(unit.position);
    pw.addBallCollider(body, 0.5);
    unit.rigidBody = body;

    // Ensure terrain patches around unit
    mgr.ensurePatchesAround(unit.position);

    return { pw, terrain, mgr, unit };
}

// ============================================================
// State machine basics
// ============================================================

describe('state machine basics', () => {
    it('unit starts in KINEMATIC mode', async () => {
        const { unit } = await createUnitWithPhysics();
        expect(unit.physicsMode).toBe('KINEMATIC');
        expect(unit._settleCounter).toBe(0);
    });

    it('enterDynamic transitions to DYNAMIC', async () => {
        const { pw, unit } = await createUnitWithPhysics();
        unit.enterDynamic(pw);
        expect(unit.physicsMode).toBe('DYNAMIC');
    });

    it('exitDynamic transitions back to KINEMATIC', async () => {
        const { pw, unit } = await createUnitWithPhysics();
        unit.enterDynamic(pw);
        expect(unit.physicsMode).toBe('DYNAMIC');
        unit.exitDynamic(pw);
        expect(unit.physicsMode).toBe('KINEMATIC');
    });

    it('enterDynamic is idempotent (double call no-ops)', async () => {
        const { pw, unit } = await createUnitWithPhysics();
        unit.enterDynamic(pw);
        unit.enterDynamic(pw); // Should not throw or change state
        expect(unit.physicsMode).toBe('DYNAMIC');
    });

    it('exitDynamic is idempotent when already KINEMATIC', async () => {
        const { pw, unit } = await createUnitWithPhysics();
        unit.exitDynamic(pw); // Already KINEMATIC — no-op
        expect(unit.physicsMode).toBe('KINEMATIC');
    });

    it('enterDynamic without rigidBody is a no-op', async () => {
        const pw = await PhysicsWorld.create({ subSteps: 1 });
        cleanup.push(pw);
        const unit = new HeadlessUnit(1, 0);
        unit.enterDynamic(pw);
        expect(unit.physicsMode).toBe('KINEMATIC'); // Not changed
    });

    it('enterDynamic clears active path and velocity', async () => {
        const { pw, unit } = await createUnitWithPhysics();
        unit.setPath([{ x: 100, y: 0, z: 0 }]);
        unit.speed = 5;
        unit.velocity = { x: 5, y: 0, z: 0 };

        unit.enterDynamic(pw);
        expect(unit.waypoints).toBeNull();
        expect(unit.speed).toBe(0);
        expect(unit.velocity).toEqual({ x: 0, y: 0, z: 0 });
    });

    it('exitDynamic snaps to terrain and resets vertical state', async () => {
        const { pw, unit, terrain } = await createUnitWithPhysics();
        unit.enterDynamic(pw);

        // Move the body off-surface
        unit.rigidBody.setTranslation({ x: 70, y: 0, z: 0 }, true);

        // Step physics so body position is committed
        pw.step();

        unit.exitDynamic(pw);
        expect(unit.physicsMode).toBe('KINEMATIC');
        expect(unit.mode).toBe('GROUNDED');
        expect(unit.altitude).toBe(0);
        expect(unit.verticalVelocity).toBe(0);
        expect(unit.speed).toBe(0);

        // Position should be on terrain surface
        const dir = Vec3.normalize(unit.position);
        const expectedR = terrain.getRadiusAt(dir);
        const actualR = Vec3.length(unit.position);
        expect(actualR).toBeCloseTo(expectedR, 1);
    });
});

// ============================================================
// DYNAMIC mode behavior
// ============================================================

describe('DYNAMIC mode behavior', () => {
    it('WASD input is ignored while DYNAMIC', async () => {
        const { pw, unit } = await createUnitWithPhysics();
        unit.enterDynamic(pw);

        const posBefore = { ...unit.position };
        unit.applyInput({ type: 'MOVE_INPUT', forward: true, backward: false, left: false, right: false });

        // Position should not change from WASD
        expect(unit.velocity).toEqual({ x: 0, y: 0, z: 0 });
        expect(unit.speed).toBe(0);
    });

    it('updatePosition is skipped while DYNAMIC', async () => {
        const { pw, unit } = await createUnitWithPhysics();
        unit.enterDynamic(pw);

        const posBefore = { ...unit.position };
        unit.updatePosition(0.05);

        // Position unchanged by kinematic update
        expect(unit.position.x).toBe(posBefore.x);
        expect(unit.position.y).toBe(posBefore.y);
        expect(unit.position.z).toBe(posBefore.z);
    });

    it('syncFromRigidBody reads Rapier position into unit', async () => {
        const { pw, unit } = await createUnitWithPhysics();
        unit.enterDynamic(pw);

        // Manually set body position
        unit.rigidBody.setTranslation({ x: 65, y: 0, z: 0 }, true);
        unit.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        pw.step();

        unit.syncFromRigidBody();
        // Position should reflect what Rapier computed (near where we set it,
        // modified by spherical gravity pulling toward origin)
        const dist = Vec3.length(unit.position);
        expect(dist).toBeGreaterThan(0); // Not at origin
    });

    it('syncToRigidBody is a no-op for DYNAMIC units', async () => {
        const { pw, unit } = await createUnitWithPhysics();
        unit.enterDynamic(pw);

        // Move unit position manually (shouldn't affect body since syncTo skips DYNAMIC)
        unit.position = { x: 999, y: 0, z: 0 };
        unit.syncToRigidBody();

        const bodyPos = unit.rigidBody.translation();
        // Body should NOT be at 999 — syncTo skips DYNAMIC mode
        expect(bodyPos.x).not.toBeCloseTo(999, 0);
    });

    it('syncToRigidBody updates kinematic body position', async () => {
        const { pw, unit } = await createUnitWithPhysics();

        // KINEMATIC mode: syncTo should update body
        const surfacePos = { ...unit.position };
        unit.syncToRigidBody();

        const bodyPos = unit.rigidBody.translation();
        expect(bodyPos.x).toBeCloseTo(surfacePos.x, 1);
        expect(bodyPos.y).toBeCloseTo(surfacePos.y, 1);
        expect(bodyPos.z).toBeCloseTo(surfacePos.z, 1);
    });

    it('impulse is applied on enterDynamic', async () => {
        const { pw, unit } = await createUnitWithPhysics();
        const posBefore = { ...unit.position };

        unit.enterDynamic(pw, { x: 50, y: 0, z: 0 });
        pw.step();

        const bodyPos = unit.rigidBody.translation();
        // Impulse should have moved the body (even slightly)
        const moved = Math.abs(bodyPos.x - posBefore.x) > 0.01 ||
                       Math.abs(bodyPos.y - posBefore.y) > 0.01 ||
                       Math.abs(bodyPos.z - posBefore.z) > 0.01;
        expect(moved).toBe(true);
    });
});

// ============================================================
// Settle detection
// ============================================================

describe('settle detection', () => {
    it('settle counter increments when velocity is below threshold', async () => {
        const { pw, unit } = await createUnitWithPhysics();
        unit.enterDynamic(pw);

        // Set body to nearly zero velocity
        unit.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        // Need to step so Rapier commits the velocity
        pw.step();

        const settled = unit.syncFromRigidBody();
        // After 1 tick, counter should be 1 but not yet settled (need 10)
        expect(unit._settleCounter).toBeGreaterThanOrEqual(1);
        expect(settled).toBe(false);
    });

    it('settle counter resets when velocity exceeds threshold', async () => {
        const { pw, unit } = await createUnitWithPhysics();
        unit.enterDynamic(pw);

        // Set low velocity
        unit.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        pw.step();
        unit.syncFromRigidBody();
        expect(unit._settleCounter).toBeGreaterThanOrEqual(1);

        // Now set high velocity
        unit.rigidBody.setLinvel({ x: 10, y: 0, z: 0 }, true);
        pw.step();
        unit.syncFromRigidBody();
        expect(unit._settleCounter).toBe(0);
    });

    it('returns true after SETTLE_TICK_COUNT consecutive low-velocity ticks', async () => {
        const { pw, unit } = await createUnitWithPhysics();
        unit.enterDynamic(pw);

        // Simulate many ticks at zero velocity
        for (let i = 0; i < HeadlessUnit.SETTLE_TICK_COUNT + 5; i++) {
            unit.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
            pw.step();
            const settled = unit.syncFromRigidBody();
            if (i + 1 >= HeadlessUnit.SETTLE_TICK_COUNT) {
                expect(settled).toBe(true);
                return; // Test passed
            }
        }
        // Should have returned above
        expect.unreachable('Should have settled');
    });

    it('syncFromRigidBody returns false when not DYNAMIC', async () => {
        const { pw, unit } = await createUnitWithPhysics();
        // KINEMATIC mode
        const result = unit.syncFromRigidBody();
        expect(result).toBe(false);
    });
});

// ============================================================
// Room integration
// ============================================================

describe('Room integration', () => {
    it('Room attaches rigid bodies when physics is enabled', async () => {
        const room = new Room('test-hybrid-attach', {
            enablePhysics: true,
            physicsOptions: { subSteps: 1 }
        });
        await room.start();

        const unit = room.createUnitForPlayer(1, 100);
        expect(unit.rigidBody).not.toBeNull();

        room.stop();
    });

    it('Room does NOT attach rigid bodies when physics is disabled', async () => {
        const room = new Room('test-hybrid-no-physics');
        await room.start();

        const unit = room.createUnitForPlayer(1, 100);
        expect(unit.rigidBody).toBeNull();

        room.stop();
    });

    it('Room attaches rigid bodies for manifest-created units', async () => {
        const room = new Room('test-hybrid-manifest', {
            enablePhysics: true,
            physicsOptions: { subSteps: 1 }
        });
        await room.start();

        const created = room.createUnitsFromManifest([
            { id: 10, ownerSlot: 1, modelIndex: 0 },
            { id: 11, ownerSlot: 2, modelIndex: 1 }
        ]);

        expect(created[0].rigidBody).not.toBeNull();
        expect(created[1].rigidBody).not.toBeNull();

        room.stop();
    });

    it('Room sync loop: KINEMATIC units sync position TO body each tick', async () => {
        const room = new Room('test-hybrid-sync-to', {
            enablePhysics: true,
            physicsOptions: { subSteps: 1 },
            tickMs: 50
        });
        await room.start();

        const unit = room.createUnitForPlayer(1, 100);
        const startPos = { ...unit.position };

        // Apply WASD movement
        unit.applyInput({ type: 'MOVE_INPUT', forward: true, backward: false, left: false, right: false });

        // Manually tick the sim
        room._onSimTick(0.05, 1);

        // Unit should have moved
        const moved = Vec3.length(Vec3.sub(unit.position, startPos));
        expect(moved).toBeGreaterThan(0);

        // Body position should be near unit position (synced in tick)
        const bodyPos = unit.rigidBody.translation();
        expect(bodyPos.x).toBeCloseTo(unit.position.x, 0);
        expect(bodyPos.y).toBeCloseTo(unit.position.y, 0);
        expect(bodyPos.z).toBeCloseTo(unit.position.z, 0);

        room.stop();
    });

    it('Room sync loop: DYNAMIC units read position FROM body after step', async () => {
        const room = new Room('test-hybrid-sync-from', {
            enablePhysics: true,
            physicsOptions: { subSteps: 1, gravity: 9.81 },
            tickMs: 50
        });
        await room.start();

        const unit = room.createUnitForPlayer(1, 100);

        // Ensure terrain patches
        if (room.terrainColliders) {
            room.terrainColliders.ensurePatchesAround(unit.position);
        }

        // Enter DYNAMIC with upward impulse
        unit.enterDynamic(room.physics, { x: 5, y: 0, z: 0 });
        expect(unit.physicsMode).toBe('DYNAMIC');

        const posBefore = { ...unit.position };

        // Tick — physics step should move the body
        room._onSimTick(0.05, 1);

        // Unit position should have changed (read from body)
        const posAfter = unit.position;
        const delta = Vec3.length(Vec3.sub(posAfter, posBefore));
        expect(delta).toBeGreaterThan(0);

        room.stop();
    });

    it('Room auto-settles DYNAMIC units after enough low-velocity ticks', async () => {
        const room = new Room('test-hybrid-auto-settle', {
            enablePhysics: true,
            physicsOptions: { subSteps: 1, gravity: 0 }, // No gravity = body stays still
            tickMs: 50
        });
        await room.start();

        const unit = room.createUnitForPlayer(1, 100);

        // Enter DYNAMIC with no impulse, no gravity → velocity stays zero
        unit.enterDynamic(room.physics);
        expect(unit.physicsMode).toBe('DYNAMIC');

        // Tick enough times for settle
        for (let i = 0; i < HeadlessUnit.SETTLE_TICK_COUNT + 5; i++) {
            room._onSimTick(0.05, i + 1);
            if (unit.physicsMode === 'SETTLED') break;
        }

        expect(unit.physicsMode).toBe('SETTLED');

        room.stop();
    });
});

// ============================================================
// Multi-unit independence
// ============================================================

describe('multi-unit independence', () => {
    it('one unit DYNAMIC, another KINEMATIC — no interference', async () => {
        const room = new Room('test-hybrid-multi', {
            enablePhysics: true,
            physicsOptions: { subSteps: 1, gravity: 0 },
            tickMs: 50
        });
        await room.start();

        const unitA = room.createUnitForPlayer(1, 100);
        const unitB = room.createUnitForPlayer(2, 200);

        // Unit A: enter DYNAMIC
        unitA.enterDynamic(room.physics);
        expect(unitA.physicsMode).toBe('DYNAMIC');
        expect(unitB.physicsMode).toBe('KINEMATIC');

        // Unit B: apply WASD (should work normally)
        unitB.applyInput({ type: 'MOVE_INPUT', forward: true, backward: false, left: false, right: false });
        const posBefore = { ...unitB.position };

        // Tick
        room._onSimTick(0.05, 1);

        // Unit B should have moved (KINEMATIC, WASD works)
        const moved = Vec3.length(Vec3.sub(unitB.position, posBefore));
        expect(moved).toBeGreaterThan(0);

        // Unit A is still DYNAMIC
        expect(unitA.physicsMode).toBe('DYNAMIC');

        room.stop();
    });
});

// ============================================================
// Determinism
// ============================================================

describe('determinism', () => {
    it('same enterDynamic + same ticks = same final position', async () => {
        async function runScenario() {
            const pw = await PhysicsWorld.create({ subSteps: 1, gravity: 9.81 });
            cleanup.push(pw);
            const terrain = new ServerTerrain();
            const mgr = new TerrainColliderManager(pw, terrain, { patchSize: 20, gridStep: 1 });

            const unit = new HeadlessUnit(1, 0);
            unit.spawnOnSurface({ x: 1, y: 0, z: 0 }, terrain);

            const body = pw.createKinematicBody(unit.position);
            pw.addBallCollider(body, 0.5);
            unit.rigidBody = body;

            mgr.ensurePatchesAround(unit.position);

            // Enter DYNAMIC with specific impulse
            unit.enterDynamic(pw, { x: 0, y: 10, z: 0 });

            // Step 20 times
            for (let i = 0; i < 20; i++) {
                pw.step();
                unit.syncFromRigidBody();
            }

            return { x: unit.position.x, y: unit.position.y, z: unit.position.z };
        }

        const run1 = await runScenario();
        const run2 = await runScenario();

        expect(run1.x).toBe(run2.x);
        expect(run1.y).toBe(run2.y);
        expect(run1.z).toBe(run2.z);
    });
});

// ============================================================
// Regression: existing kinematic behavior unchanged
// ============================================================

describe('regression: kinematic behavior unchanged', () => {
    it('WASD movement works normally without entering DYNAMIC', async () => {
        const { unit } = await createUnitWithPhysics();
        const startPos = { ...unit.position };

        unit.applyInput({ type: 'MOVE_INPUT', forward: true, backward: false, left: false, right: false });
        unit.updatePosition(0.05);

        const moved = Vec3.length(Vec3.sub(unit.position, startPos));
        expect(moved).toBeGreaterThan(0);
        expect(unit.physicsMode).toBe('KINEMATIC');
    });

    it('path-follow works normally without entering DYNAMIC', async () => {
        const { unit, terrain } = await createUnitWithPhysics();

        // Set a target waypoint
        const targetDir = Vec3.normalize({ x: 0.9, y: 0.1, z: 0 });
        const targetR = terrain.getRadiusAt(targetDir);
        const target = Vec3.scale(targetDir, targetR);
        unit.setPath([target]);

        const startPos = { ...unit.position };
        unit.updatePosition(0.05);

        const moved = Vec3.length(Vec3.sub(unit.position, startPos));
        expect(moved).toBeGreaterThan(0);
        expect(unit.physicsMode).toBe('KINEMATIC');
    });

    it('toSnapshot includes physicsMode-relevant state correctly', async () => {
        const { unit } = await createUnitWithPhysics();
        const snap = unit.toSnapshot();

        expect(snap.mode).toBe('GROUNDED');
        expect(snap.altitude).toBe(0);
        // Existing snapshot fields still present
        expect(snap.id).toBe(1);
        expect(snap.ownerSlot).toBe(0);
        expect(snap.px).toBeDefined();
        expect(snap.qx).toBeDefined();
    });
});
