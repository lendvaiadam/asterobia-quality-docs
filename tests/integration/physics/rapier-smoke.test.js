/**
 * Rapier.js Smoke Test — Headless Node.js
 *
 * Verifies that @dimforge/rapier3d-compat loads, initializes, and can run
 * a minimal physics world in our server environment (Node.js ESM, no browser).
 *
 * This is Phase 3 PREP only — no gameplay physics yet.
 *
 * Run: npx vitest run tests/integration/physics/rapier-smoke.test.js
 */

import { describe, it, expect, beforeAll } from 'vitest';

let RAPIER;

beforeAll(async () => {
    const mod = await import('@dimforge/rapier3d-compat');
    RAPIER = mod.default ?? mod;
    await RAPIER.init();
});

describe('Rapier smoke test (headless)', () => {
    it('RAPIER.init() succeeds and exposes World constructor', () => {
        expect(typeof RAPIER.World).toBe('function');
        expect(typeof RAPIER.RigidBodyDesc).toBe('function');
        expect(typeof RAPIER.ColliderDesc).toBe('function');
    });

    it('creates a world with zero gravity', () => {
        const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
        expect(world).toBeDefined();
        expect(world.gravity.x).toBe(0);
        expect(world.gravity.y).toBe(0);
        expect(world.gravity.z).toBe(0);
        world.free();
    });

    it('creates a dynamic rigid body with a ball collider', () => {
        const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

        const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(0, 10, 0);
        const body = world.createRigidBody(bodyDesc);

        const colliderDesc = RAPIER.ColliderDesc.ball(0.5);
        world.createCollider(colliderDesc, body);

        const pos = body.translation();
        expect(pos.y).toBeCloseTo(10, 5);

        world.free();
    });

    it('steps the world and gravity moves the body downward', () => {
        const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
        world.timestep = 1 / 60;

        const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(0, 10, 0);
        const body = world.createRigidBody(bodyDesc);
        world.createCollider(RAPIER.ColliderDesc.ball(0.5), body);

        // Step 60 times (1 second of simulation)
        for (let i = 0; i < 60; i++) {
            world.step();
        }

        const pos = body.translation();
        // After 1s of free fall: y ≈ 10 - 0.5*9.81*1² = 5.095
        expect(pos.y).toBeLessThan(10);
        expect(pos.y).toBeGreaterThan(0);

        world.free();
    });

    it('supports spherical gravity (zero global, manual per-body force)', () => {
        const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
        world.timestep = 1 / 60;

        // Body at (0, 60, 0) — on sphere surface
        const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(0, 60, 0)
            .setGravityScale(0);
        const body = world.createRigidBody(bodyDesc);
        world.createCollider(RAPIER.ColliderDesc.ball(0.5), body);

        const GRAVITY = 9.81;

        // Apply spherical gravity (toward center) and step
        for (let i = 0; i < 60; i++) {
            const pos = body.translation();
            const len = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
            if (len > 0.001) {
                const mass = body.mass();
                body.addForce({
                    x: (-pos.x / len) * GRAVITY * mass,
                    y: (-pos.y / len) * GRAVITY * mass,
                    z: (-pos.z / len) * GRAVITY * mass
                }, true);
            }
            world.step();
        }

        // Body should have fallen toward center (y decreased)
        const finalPos = body.translation();
        expect(finalPos.y).toBeLessThan(60);
        // Should stay roughly on Y axis (no X/Z drift)
        expect(Math.abs(finalPos.x)).toBeLessThan(0.01);
        expect(Math.abs(finalPos.z)).toBeLessThan(0.01);

        world.free();
    });

    it('supports kinematic ↔ dynamic body type switch', () => {
        const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
        world.timestep = 1 / 60;

        // Start as kinematic
        const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
            .setTranslation(0, 10, 0);
        const body = world.createRigidBody(bodyDesc);
        world.createCollider(RAPIER.ColliderDesc.ball(0.5), body);

        // Kinematic: position doesn't change from gravity
        for (let i = 0; i < 10; i++) world.step();
        expect(body.translation().y).toBeCloseTo(10, 5);

        // Switch to dynamic
        body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);

        // Dynamic: gravity takes effect
        for (let i = 0; i < 30; i++) world.step();
        expect(body.translation().y).toBeLessThan(10);

        // Switch back to kinematic
        body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
        const yAfterSwitch = body.translation().y;

        // Kinematic: should not move further
        for (let i = 0; i < 10; i++) world.step();
        expect(body.translation().y).toBeCloseTo(yAfterSwitch, 3);

        world.free();
    });

    it('collision events fire between two dynamic bodies', () => {
        const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
        world.timestep = 1 / 60;
        const eventQueue = new RAPIER.EventQueue(true);

        // Body A: falling from y=5
        const bodyA = world.createRigidBody(
            RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 5, 0)
        );
        world.createCollider(
            RAPIER.ColliderDesc.ball(0.5)
                .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
            bodyA
        );

        // Body B: static floor at y=0
        const bodyB = world.createRigidBody(
            RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0)
        );
        world.createCollider(
            RAPIER.ColliderDesc.cuboid(10, 0.1, 10)
                .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
            bodyB
        );

        let collisionDetected = false;

        // Step until collision or timeout
        for (let i = 0; i < 120; i++) {
            world.step(eventQueue);
            eventQueue.drainCollisionEvents((h1, h2, started) => {
                if (started) collisionDetected = true;
            });
            if (collisionDetected) break;
        }

        expect(collisionDetected).toBe(true);

        eventQueue.free();
        world.free();
    });

    it('world.takeSnapshot() produces a Uint8Array', () => {
        const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
        world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 5, 0));

        const snapshot = world.takeSnapshot();
        expect(snapshot).toBeInstanceOf(Uint8Array);
        expect(snapshot.length).toBeGreaterThan(0);

        world.free();
    });

    it('fixed timestep produces deterministic results (same machine)', () => {
        function runSim() {
            const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
            world.timestep = 1 / 60;

            const body = world.createRigidBody(
                RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 10, 0)
            );
            world.createCollider(RAPIER.ColliderDesc.ball(1.0), body);

            for (let i = 0; i < 100; i++) world.step();

            const pos = body.translation();
            const result = { x: pos.x, y: pos.y, z: pos.z };
            world.free();
            return result;
        }

        const run1 = runSim();
        const run2 = runSim();

        expect(run1.x).toBe(run2.x);
        expect(run1.y).toBe(run2.y);
        expect(run1.z).toBe(run2.z);
    });
});
