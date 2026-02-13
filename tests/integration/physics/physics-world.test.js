/**
 * PhysicsWorld Integration Tests — server/PhysicsWorld.js
 *
 * Validates the Rapier wrapper: init, lifecycle, stepping, spherical gravity,
 * body management, collision events, determinism, error handling.
 *
 * Run: npx vitest run tests/integration/physics/physics-world.test.js
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { PhysicsWorld, initRapier, isRapierReady, getRapier } from '../../../server/PhysicsWorld.js';
import { Room } from '../../../server/Room.js';

/** @type {PhysicsWorld[]} Track worlds for cleanup */
const cleanup = [];

afterEach(() => {
    for (const pw of cleanup) {
        if (!pw.destroyed) pw.shutdown();
    }
    cleanup.length = 0;
});

// ============================================================
// Module-level init
// ============================================================

describe('initRapier / isRapierReady / getRapier', () => {
    it('isRapierReady returns false before any init (or true if already cached)', () => {
        // May be true if another test file ran first — that's fine (idempotent)
        const result = isRapierReady();
        expect(typeof result).toBe('boolean');
    });

    it('initRapier succeeds and returns a module with World constructor', async () => {
        const RAPIER = await initRapier();
        expect(typeof RAPIER.World).toBe('function');
        expect(typeof RAPIER.RigidBodyDesc).toBe('function');
        expect(isRapierReady()).toBe(true);
    });

    it('initRapier is idempotent — second call returns same module', async () => {
        const r1 = await initRapier();
        const r2 = await initRapier();
        expect(r1).toBe(r2);
    });

    it('getRapier returns module after init', async () => {
        await initRapier();
        const RAPIER = getRapier();
        expect(typeof RAPIER.World).toBe('function');
    });
});

// ============================================================
// Factory & lifecycle
// ============================================================

describe('PhysicsWorld.create / lifecycle', () => {
    it('creates a PhysicsWorld via async factory', async () => {
        const pw = await PhysicsWorld.create();
        cleanup.push(pw);

        expect(pw).toBeInstanceOf(PhysicsWorld);
        expect(pw.destroyed).toBe(false);
        expect(pw.bodyCount).toBe(0);
        expect(pw.totalSteps).toBe(0);
        expect(pw.totalSubSteps).toBe(0);
    });

    it('accepts configuration options', async () => {
        const pw = await PhysicsWorld.create({
            subSteps: 2,
            physicsHz: 120,
            gravity: 4.0
        });
        cleanup.push(pw);

        expect(pw.subSteps).toBe(2);
        expect(pw.physicsHz).toBe(120);
        expect(pw.gravityMagnitude).toBe(4.0);
    });

    it('defaults to 3 sub-steps, 60Hz, 9.81 gravity', async () => {
        const pw = await PhysicsWorld.create();
        cleanup.push(pw);

        expect(pw.subSteps).toBe(3);
        expect(pw.physicsHz).toBe(60);
        expect(pw.gravityMagnitude).toBe(9.81);
    });

    it('world getter returns the Rapier World', async () => {
        const pw = await PhysicsWorld.create();
        cleanup.push(pw);

        const world = pw.world;
        expect(world).toBeDefined();
        expect(world.gravity).toBeDefined();
        expect(world.gravity.x).toBe(0);
        expect(world.gravity.y).toBe(0);
        expect(world.gravity.z).toBe(0);
    });

    it('RAPIER getter returns the module', async () => {
        const pw = await PhysicsWorld.create();
        cleanup.push(pw);

        expect(typeof pw.RAPIER.World).toBe('function');
    });

    it('shutdown frees resources and marks destroyed', async () => {
        const pw = await PhysicsWorld.create();

        pw.shutdown();
        expect(pw.destroyed).toBe(true);
        expect(pw.bodyCount).toBe(0);
    });

    it('shutdown is idempotent', async () => {
        const pw = await PhysicsWorld.create();

        pw.shutdown();
        pw.shutdown(); // No throw
        expect(pw.destroyed).toBe(true);
    });

    it('methods throw after shutdown', async () => {
        const pw = await PhysicsWorld.create();
        pw.shutdown();

        expect(() => pw.step()).toThrow('shut down');
        expect(() => pw.world).toThrow('shut down');
        expect(() => pw.createDynamicBody({ x: 0, y: 60, z: 0 })).toThrow('shut down');
        expect(() => pw.createKinematicBody({ x: 0, y: 60, z: 0 })).toThrow('shut down');
        expect(() => pw.createFixedBody({ x: 0, y: 60, z: 0 })).toThrow('shut down');
    });
});

// ============================================================
// Body creation
// ============================================================

describe('body creation', () => {
    it('creates a dynamic body at given position', async () => {
        const pw = await PhysicsWorld.create();
        cleanup.push(pw);

        const body = pw.createDynamicBody({ x: 0, y: 60, z: 0 });
        const pos = body.translation();
        expect(pos.x).toBeCloseTo(0, 5);
        expect(pos.y).toBeCloseTo(60, 5);
        expect(pos.z).toBeCloseTo(0, 5);
        expect(pw.bodyCount).toBe(1);
    });

    it('creates a kinematic body', async () => {
        const pw = await PhysicsWorld.create();
        cleanup.push(pw);

        const body = pw.createKinematicBody({ x: 10, y: 0, z: 0 });
        const pos = body.translation();
        expect(pos.x).toBeCloseTo(10, 5);
        expect(pw.bodyCount).toBe(1);
    });

    it('creates a fixed body', async () => {
        const pw = await PhysicsWorld.create();
        cleanup.push(pw);

        const body = pw.createFixedBody({ x: 0, y: 0, z: 0 });
        expect(body).toBeDefined();
        expect(pw.bodyCount).toBe(1);
    });

    it('addBallCollider attaches a ball collider', async () => {
        const pw = await PhysicsWorld.create();
        cleanup.push(pw);

        const body = pw.createDynamicBody({ x: 0, y: 60, z: 0 });
        const collider = pw.addBallCollider(body, 0.5);
        expect(collider).toBeDefined();
    });

    it('removeBody removes from world', async () => {
        const pw = await PhysicsWorld.create();
        cleanup.push(pw);

        const body = pw.createDynamicBody({ x: 0, y: 60, z: 0 });
        expect(pw.bodyCount).toBe(1);

        pw.removeBody(body);
        expect(pw.bodyCount).toBe(0);
    });

    it('supports multiple bodies', async () => {
        const pw = await PhysicsWorld.create();
        cleanup.push(pw);

        pw.createDynamicBody({ x: 0, y: 60, z: 0 });
        pw.createDynamicBody({ x: 60, y: 0, z: 0 });
        pw.createFixedBody({ x: 0, y: 0, z: 0 });
        expect(pw.bodyCount).toBe(3);
    });
});

// ============================================================
// Stepping
// ============================================================

describe('step()', () => {
    it('increments totalSteps and totalSubSteps', async () => {
        const pw = await PhysicsWorld.create({ subSteps: 3 });
        cleanup.push(pw);

        pw.step();
        expect(pw.totalSteps).toBe(1);
        expect(pw.totalSubSteps).toBe(3);

        pw.step();
        expect(pw.totalSteps).toBe(2);
        expect(pw.totalSubSteps).toBe(6);
    });

    it('step with 1 sub-step increments by 1', async () => {
        const pw = await PhysicsWorld.create({ subSteps: 1 });
        cleanup.push(pw);

        pw.step();
        expect(pw.totalSubSteps).toBe(1);
    });

    it('stepping empty world is a no-op (does not throw)', async () => {
        const pw = await PhysicsWorld.create();
        cleanup.push(pw);

        // 100 steps on empty world — should be fast and safe
        for (let i = 0; i < 100; i++) pw.step();
        expect(pw.totalSteps).toBe(100);
    });
});

// ============================================================
// Spherical gravity
// ============================================================

describe('spherical gravity', () => {
    it('pulls a dynamic body toward the origin', async () => {
        const pw = await PhysicsWorld.create({ subSteps: 1, gravity: 9.81 });
        cleanup.push(pw);

        const body = pw.createDynamicBody({ x: 0, y: 60, z: 0 });
        pw.addBallCollider(body, 0.5);

        const startY = body.translation().y;

        // Step 60 times (~1 second at 60Hz)
        for (let i = 0; i < 60; i++) pw.step();

        const endY = body.translation().y;
        expect(endY).toBeLessThan(startY);
        // Gravity pulled it significantly (no minimum floor — just checking delta)
        expect(startY - endY).toBeGreaterThan(1);
    });

    it('does not drift off-axis for an on-axis body', async () => {
        const pw = await PhysicsWorld.create({ subSteps: 1, gravity: 9.81 });
        cleanup.push(pw);

        const body = pw.createDynamicBody({ x: 0, y: 60, z: 0 });
        pw.addBallCollider(body, 0.5);

        for (let i = 0; i < 60; i++) pw.step();

        const pos = body.translation();
        expect(Math.abs(pos.x)).toBeLessThan(0.01);
        expect(Math.abs(pos.z)).toBeLessThan(0.01);
    });

    it('works for bodies on any axis', async () => {
        const pw = await PhysicsWorld.create({ subSteps: 1, gravity: 9.81 });
        cleanup.push(pw);

        const bodyX = pw.createDynamicBody({ x: 60, y: 0, z: 0 });
        pw.addBallCollider(bodyX, 0.5);

        const bodyZ = pw.createDynamicBody({ x: 0, y: 0, z: 60 });
        pw.addBallCollider(bodyZ, 0.5);

        for (let i = 0; i < 60; i++) pw.step();

        expect(bodyX.translation().x).toBeLessThan(60);
        expect(bodyZ.translation().z).toBeLessThan(60);
    });

    it('does not affect kinematic bodies', async () => {
        const pw = await PhysicsWorld.create({ subSteps: 1, gravity: 9.81 });
        cleanup.push(pw);

        const body = pw.createKinematicBody({ x: 0, y: 60, z: 0 });
        pw.addBallCollider(body, 0.5);

        for (let i = 0; i < 60; i++) pw.step();

        expect(body.translation().y).toBeCloseTo(60, 3);
    });

    it('does not affect fixed bodies', async () => {
        const pw = await PhysicsWorld.create({ subSteps: 1, gravity: 9.81 });
        cleanup.push(pw);

        const body = pw.createFixedBody({ x: 0, y: 60, z: 0 });
        for (let i = 0; i < 60; i++) pw.step();
        expect(body.translation().y).toBeCloseTo(60, 3);
    });

    it('respects custom gravity magnitude', async () => {
        // Low gravity
        const pwLow = await PhysicsWorld.create({ subSteps: 1, gravity: 1.0 });
        cleanup.push(pwLow);
        const bodyLow = pwLow.createDynamicBody({ x: 0, y: 60, z: 0 });
        pwLow.addBallCollider(bodyLow, 0.5);

        // High gravity
        const pwHigh = await PhysicsWorld.create({ subSteps: 1, gravity: 20.0 });
        cleanup.push(pwHigh);
        const bodyHigh = pwHigh.createDynamicBody({ x: 0, y: 60, z: 0 });
        pwHigh.addBallCollider(bodyHigh, 0.5);

        for (let i = 0; i < 60; i++) {
            pwLow.step();
            pwHigh.step();
        }

        // Higher gravity → further from start
        expect(bodyHigh.translation().y).toBeLessThan(bodyLow.translation().y);
    });

    it('zero gravity means no movement', async () => {
        const pw = await PhysicsWorld.create({ subSteps: 1, gravity: 0 });
        cleanup.push(pw);

        const body = pw.createDynamicBody({ x: 0, y: 60, z: 0 });
        pw.addBallCollider(body, 0.5);

        for (let i = 0; i < 60; i++) pw.step();

        expect(body.translation().y).toBeCloseTo(60, 3);
    });
});

// ============================================================
// Collision events
// ============================================================

describe('collision events', () => {
    it('drainCollisionEvents fires on body impact', async () => {
        const pw = await PhysicsWorld.create({ subSteps: 1, gravity: 9.81 });
        cleanup.push(pw);

        // Falling ball
        const ball = pw.createDynamicBody({ x: 0, y: 65, z: 0 });
        pw.addBallCollider(ball, 0.5, { activeEvents: true });

        // Static floor (at radius ~60)
        const floor = pw.createFixedBody({ x: 0, y: 60, z: 0 });
        pw.addBallCollider(floor, 2.0, { activeEvents: true });

        let collided = false;

        for (let i = 0; i < 300; i++) {
            pw.step();
            pw.drainCollisionEvents((h1, h2, started) => {
                if (started) collided = true;
            });
            if (collided) break;
        }

        expect(collided).toBe(true);
    });
});

// ============================================================
// Determinism
// ============================================================

describe('determinism', () => {
    it('two identical worlds produce identical results', async () => {
        async function runSim() {
            const pw = await PhysicsWorld.create({ subSteps: 3, gravity: 9.81 });
            const body = pw.createDynamicBody({ x: 0, y: 60, z: 0 });
            pw.addBallCollider(body, 0.5);

            for (let i = 0; i < 20; i++) pw.step(); // 20 ticks × 3 sub = 60 physics steps

            const pos = body.translation();
            const result = { x: pos.x, y: pos.y, z: pos.z };
            pw.shutdown();
            return result;
        }

        const run1 = await runSim();
        const run2 = await runSim();

        expect(run1.x).toBe(run2.x);
        expect(run1.y).toBe(run2.y);
        expect(run1.z).toBe(run2.z);
    });
});

// ============================================================
// Room integration (enablePhysics flag)
// ============================================================

describe('Room + PhysicsWorld integration', () => {
    /** @type {Room[]} Track rooms for cleanup */
    const roomCleanup = [];

    afterEach(() => {
        for (const r of roomCleanup) {
            if (r.state !== 'ENDED') r.stop();
        }
        roomCleanup.length = 0;
    });

    it('Room without enablePhysics has no physics world', () => {
        const room = new Room('test-no-physics');
        roomCleanup.push(room);
        expect(room.physics).toBeNull();
    });

    it('Room with enablePhysics initializes PhysicsWorld on start()', async () => {
        const room = new Room('test-physics', { enablePhysics: true });
        roomCleanup.push(room);

        expect(room.physics).toBeNull(); // Not yet started

        await room.start();
        expect(room.physics).toBeInstanceOf(PhysicsWorld);
        expect(room.physics.destroyed).toBe(false);
    });

    it('Room passes physicsOptions to PhysicsWorld', async () => {
        const room = new Room('test-opts', {
            enablePhysics: true,
            physicsOptions: { subSteps: 2, gravity: 4.0 }
        });
        roomCleanup.push(room);

        await room.start();
        expect(room.physics.subSteps).toBe(2);
        expect(room.physics.gravityMagnitude).toBe(4.0);
    });

    it('Room.stop() shuts down physics and nulls the reference', async () => {
        const room = new Room('test-stop', { enablePhysics: true });
        roomCleanup.push(room);

        await room.start();
        const pw = room.physics;
        expect(pw.destroyed).toBe(false);

        room.stop();
        expect(pw.destroyed).toBe(true);
        expect(room.physics).toBeNull();
    });

    it('physics steps alongside kinematic units in _onSimTick', async () => {
        const room = new Room('test-tick', { enablePhysics: true });
        roomCleanup.push(room);

        await room.start();

        // Add a dynamic body directly to physics world
        const body = room.physics.createDynamicBody({ x: 0, y: 60, z: 0 });
        room.physics.addBallCollider(body, 0.5);

        const startY = body.translation().y;

        // Drive ticks manually (same pattern as server-authority tests)
        const dt = room.simLoop.fixedDtSec;
        for (let i = 0; i < 20; i++) {
            room._onSimTick(dt, i + 1);
        }

        // Physics body should have moved (spherical gravity)
        expect(body.translation().y).toBeLessThan(startY);
        // Counters should reflect 20 step() calls
        expect(room.physics.totalSteps).toBe(20);
    });

    it('Room without physics still ticks units normally', async () => {
        const room = new Room('test-no-phys-tick');
        roomCleanup.push(room);

        // Create a unit manually
        const unit = room.createUnitForPlayer(0, 1, { modelIndex: 0 });
        const startPos = { ...unit.position };

        await room.start();

        // Feed WASD input and tick
        room.receiveInput(0, { type: 'MOVE_INPUT', forward: true, backward: false, left: false, right: false });
        const dt = room.simLoop.fixedDtSec;
        room._onSimTick(dt, 1);

        // Unit should have moved
        const dist = Math.sqrt(
            (unit.position.x - startPos.x) ** 2 +
            (unit.position.y - startPos.y) ** 2 +
            (unit.position.z - startPos.z) ** 2
        );
        expect(dist).toBeGreaterThan(0);
        expect(room.physics).toBeNull(); // No physics
    });
});
