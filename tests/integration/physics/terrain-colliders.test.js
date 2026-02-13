/**
 * TerrainColliderManager Integration Tests
 *
 * Validates JIT terrain collider patches: mesh generation, collision with
 * dynamic bodies, caching/eviction, invalidation, bounds enforcement,
 * and determinism.
 *
 * Run: npx vitest run tests/integration/physics/terrain-colliders.test.js
 */

import { describe, it, expect, afterEach } from 'vitest';
import { PhysicsWorld } from '../../../server/PhysicsWorld.js';
import { ServerTerrain } from '../../../server/ServerTerrain.js';
import { TerrainColliderManager } from '../../../server/TerrainColliderManager.js';
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
 * Helper: create a PhysicsWorld + Terrain + Manager combo.
 * @param {Object} [opts]
 * @returns {Promise<{ pw: PhysicsWorld, terrain: ServerTerrain, mgr: TerrainColliderManager }>}
 */
async function createStack(opts = {}) {
    const pw = await PhysicsWorld.create({ subSteps: 1, gravity: 9.81, ...opts.physics });
    cleanup.push(pw);
    const terrain = new ServerTerrain(opts.terrain);
    const mgr = new TerrainColliderManager(pw, terrain, opts.manager);
    return { pw, terrain, mgr };
}

// ============================================================
// Mesh generation
// ============================================================

describe('generatePatchMesh', () => {
    it('produces valid vertices and indices', async () => {
        const { mgr } = await createStack();
        const dir = Vec3.normalize({ x: 0, y: 1, z: 0 });
        const { vertices, indices, gridW, gridH } = mgr.generatePatchMesh(dir, 10, 2);

        expect(vertices).toBeInstanceOf(Float32Array);
        expect(indices).toBeInstanceOf(Uint32Array);
        expect(gridW).toBe(11); // 10*2/2 + 1 = 11
        expect(gridH).toBe(11);
        expect(vertices.length).toBe(11 * 11 * 3); // 121 verts × 3
        expect(indices.length).toBe(10 * 10 * 2 * 3); // 200 tris × 3
    });

    it('vertices lie on the terrain surface', async () => {
        const { mgr, terrain } = await createStack();
        const dir = Vec3.normalize({ x: 1, y: 0, z: 0 });
        const { vertices } = mgr.generatePatchMesh(dir, 5, 2.5);

        // Check every vertex: distance from origin should equal terrain radius at that direction
        for (let i = 0; i < vertices.length; i += 3) {
            const vx = vertices[i], vy = vertices[i + 1], vz = vertices[i + 2];
            const dist = Math.sqrt(vx * vx + vy * vy + vz * vz);
            const vDir = Vec3.normalize({ x: vx, y: vy, z: vz });
            const expectedR = terrain.getRadiusAt(vDir);
            expect(dist).toBeCloseTo(expectedR, 2);
        }
    });

    it('indices reference valid vertex range', async () => {
        const { mgr } = await createStack();
        const { vertices, indices } = mgr.generatePatchMesh(
            Vec3.normalize({ x: 0, y: 0, z: 1 }), 5, 1
        );
        const maxIdx = vertices.length / 3 - 1;
        for (let i = 0; i < indices.length; i++) {
            expect(indices[i]).toBeGreaterThanOrEqual(0);
            expect(indices[i]).toBeLessThanOrEqual(maxIdx);
        }
    });

    it('mesh is deterministic (same input = same output)', async () => {
        const { mgr } = await createStack();
        const dir = Vec3.normalize({ x: 0.5, y: 0.5, z: 0.5 });
        const mesh1 = mgr.generatePatchMesh(dir, 10, 2);
        const mesh2 = mgr.generatePatchMesh(dir, 10, 2);

        expect(mesh1.vertices.length).toBe(mesh2.vertices.length);
        for (let i = 0; i < mesh1.vertices.length; i++) {
            expect(mesh1.vertices[i]).toBe(mesh2.vertices[i]);
        }
        for (let i = 0; i < mesh1.indices.length; i++) {
            expect(mesh1.indices[i]).toBe(mesh2.indices[i]);
        }
    });

    it('works at equator, poles, and arbitrary directions', async () => {
        const { mgr } = await createStack();
        const dirs = [
            { x: 1, y: 0, z: 0 },    // equator x
            { x: 0, y: 1, z: 0 },    // north pole
            { x: 0, y: -1, z: 0 },   // south pole
            { x: 0, y: 0, z: 1 },    // equator z
            { x: 0.577, y: 0.577, z: 0.577 } // diagonal
        ];
        for (const d of dirs) {
            const dir = Vec3.normalize(d);
            const { vertices, indices } = mgr.generatePatchMesh(dir, 5, 2.5);
            expect(vertices.length).toBeGreaterThan(0);
            expect(indices.length).toBeGreaterThan(0);
        }
    });
});

// ============================================================
// Patch lifecycle (create / evict / invalidate)
// ============================================================

describe('patch lifecycle', () => {
    it('ensurePatchesAround creates patches and caches them', async () => {
        const { mgr, terrain } = await createStack({ manager: { patchSize: 10, gridStep: 5 } });
        const pos = Vec3.scale(Vec3.normalize({ x: 1, y: 0, z: 0 }), terrain.params.radius);

        const created = mgr.ensurePatchesAround(pos, 10);
        expect(created).toBeGreaterThan(0);
        expect(mgr.patchCount).toBe(created);

        // Second call should create nothing new
        const created2 = mgr.ensurePatchesAround(pos, 10);
        expect(created2).toBe(0);
        expect(mgr.patchCount).toBe(created);
    });

    it('respects maxPatches cap', async () => {
        const { mgr, terrain } = await createStack({
            manager: { patchSize: 5, gridStep: 5, maxPatches: 4 }
        });
        const pos = Vec3.scale(Vec3.normalize({ x: 1, y: 0, z: 0 }), terrain.params.radius);

        mgr.ensurePatchesAround(pos, 50); // Request far more than cap
        expect(mgr.patchCount).toBeLessThanOrEqual(4);
    });

    it('evictDistant removes far patches', async () => {
        const { mgr, terrain } = await createStack({ manager: { patchSize: 10, gridStep: 5 } });
        const pos1 = Vec3.scale(Vec3.normalize({ x: 1, y: 0, z: 0 }), terrain.params.radius);
        const pos2 = Vec3.scale(Vec3.normalize({ x: -1, y: 0, z: 0 }), terrain.params.radius);

        mgr.ensurePatchesAround(pos1, 10);
        const before = mgr.patchCount;
        expect(before).toBeGreaterThan(0);

        // Evict: only pos2 is "active" — patches near pos1 should be removed
        const evicted = mgr.evictDistant([pos2], 30);
        expect(evicted).toBe(before);
        expect(mgr.patchCount).toBe(0);
        expect(mgr.totalEvicted).toBe(before);
    });

    it('invalidateRegion destroys overlapping patches', async () => {
        const { mgr, terrain } = await createStack({ manager: { patchSize: 10, gridStep: 5 } });
        const pos = Vec3.scale(Vec3.normalize({ x: 0, y: 1, z: 0 }), terrain.params.radius);

        mgr.ensurePatchesAround(pos, 10);
        const before = mgr.patchCount;

        const invalidated = mgr.invalidateRegion(pos, 15);
        expect(invalidated).toBeGreaterThan(0);
        expect(mgr.patchCount).toBeLessThan(before);
    });

    it('destroyAll removes everything', async () => {
        const { mgr, terrain } = await createStack({ manager: { patchSize: 10, gridStep: 5 } });
        const pos = Vec3.scale(Vec3.normalize({ x: 1, y: 0, z: 0 }), terrain.params.radius);

        mgr.ensurePatchesAround(pos, 15);
        expect(mgr.patchCount).toBeGreaterThan(0);

        mgr.destroyAll();
        expect(mgr.patchCount).toBe(0);
    });

    it('diagnostic counters track creates and evictions', async () => {
        const { mgr, terrain } = await createStack({ manager: { patchSize: 10, gridStep: 5 } });
        const pos = Vec3.scale(Vec3.normalize({ x: 1, y: 0, z: 0 }), terrain.params.radius);

        expect(mgr.totalCreated).toBe(0);
        expect(mgr.totalEvicted).toBe(0);

        mgr.ensurePatchesAround(pos, 10);
        expect(mgr.totalCreated).toBeGreaterThan(0);

        mgr.destroyAll();
        expect(mgr.totalEvicted).toBe(mgr.totalCreated);
    });
});

// ============================================================
// Physics collision (body rests on terrain)
// ============================================================

describe('physics collision with terrain', () => {
    it('dynamic body comes to rest on terrain surface (does not fall through)', async () => {
        const { pw, terrain, mgr } = await createStack({
            physics: { subSteps: 3, gravity: 9.81 },
            manager: { patchSize: 20, gridStep: 1 }
        });

        // Position: slightly above terrain at equator (+x)
        const dir = Vec3.normalize({ x: 1, y: 0, z: 0 });
        const surfaceR = terrain.getRadiusAt(dir);
        const dropHeight = 3; // meters above surface
        const startPos = Vec3.scale(dir, surfaceR + dropHeight);

        // Ensure terrain patches exist
        mgr.ensurePatchesAround(startPos);

        // Create a dynamic ball above the terrain
        const body = pw.createDynamicBody(startPos);
        pw.addBallCollider(body, 0.5);

        // Step for 5 simulated seconds (should be enough to settle)
        for (let i = 0; i < 100; i++) pw.step(); // 100 steps × 3 sub = 300 physics steps

        const finalPos = body.translation();
        const finalR = Math.sqrt(finalPos.x ** 2 + finalPos.y ** 2 + finalPos.z ** 2);

        // Ball should be near the surface (within ball radius + tolerance)
        // NOT at origin or far below surface
        expect(finalR).toBeGreaterThan(surfaceR - 1);
        expect(finalR).toBeLessThan(surfaceR + dropHeight);
    });

    it('body at north pole rests on terrain', async () => {
        const { pw, terrain, mgr } = await createStack({
            physics: { subSteps: 3, gravity: 9.81 },
            manager: { patchSize: 20, gridStep: 1 }
        });

        const dir = Vec3.normalize({ x: 0, y: 1, z: 0 });
        const surfaceR = terrain.getRadiusAt(dir);
        const startPos = Vec3.scale(dir, surfaceR + 2);

        mgr.ensurePatchesAround(startPos);

        const body = pw.createDynamicBody(startPos);
        pw.addBallCollider(body, 0.5);

        for (let i = 0; i < 100; i++) pw.step();

        const finalPos = body.translation();
        const finalR = Math.sqrt(finalPos.x ** 2 + finalPos.y ** 2 + finalPos.z ** 2);

        expect(finalR).toBeGreaterThan(surfaceR - 1);
        expect(finalR).toBeLessThan(surfaceR + 2);
    });

    it('without terrain patches, body does not stay on surface', async () => {
        const { pw, terrain } = await createStack({
            physics: { subSteps: 1, gravity: 9.81 }
        });
        // No mgr.ensurePatchesAround — no terrain collision

        const dir = Vec3.normalize({ x: 1, y: 0, z: 0 });
        const surfaceR = terrain.getRadiusAt(dir);
        const startPos = Vec3.scale(dir, surfaceR + 2);

        const body = pw.createDynamicBody(startPos);
        pw.addBallCollider(body, 0.5);

        // Step only 30 times (body should have fallen below surface level)
        for (let i = 0; i < 30; i++) pw.step();

        const finalPos = body.translation();
        const finalR = Math.sqrt(finalPos.x ** 2 + finalPos.y ** 2 + finalPos.z ** 2);

        // Without terrain collider, body passes through surface level
        // (it may oscillate through origin due to spherical gravity — just verify
        // it's NOT resting near the surface like the collider tests above)
        const distFromSurface = Math.abs(finalR - surfaceR);
        expect(distFromSurface).toBeGreaterThan(2);
    });
});

// ============================================================
// Determinism
// ============================================================

describe('determinism', () => {
    it('same terrain + same drop = same final position', async () => {
        async function runDrop() {
            const { pw, terrain, mgr } = await createStack({
                physics: { subSteps: 3, gravity: 9.81 },
                manager: { patchSize: 20, gridStep: 1 }
            });

            const dir = Vec3.normalize({ x: 0, y: 0, z: 1 });
            const surfaceR = terrain.getRadiusAt(dir);
            const startPos = Vec3.scale(dir, surfaceR + 2);

            mgr.ensurePatchesAround(startPos);

            const body = pw.createDynamicBody(startPos);
            pw.addBallCollider(body, 0.5);

            for (let i = 0; i < 60; i++) pw.step();

            const pos = body.translation();
            return { x: pos.x, y: pos.y, z: pos.z };
        }

        const run1 = await runDrop();
        const run2 = await runDrop();

        expect(run1.x).toBe(run2.x);
        expect(run1.y).toBe(run2.y);
        expect(run1.z).toBe(run2.z);
    });
});

// ============================================================
// Risk / bounds
// ============================================================

describe('bounds and safety', () => {
    it('small gridStep produces more vertices (bounded by patch size)', async () => {
        const { mgr } = await createStack();
        const dir = Vec3.normalize({ x: 1, y: 0, z: 0 });

        const coarse = mgr.generatePatchMesh(dir, 10, 5);
        const fine = mgr.generatePatchMesh(dir, 10, 1);

        expect(fine.vertices.length).toBeGreaterThan(coarse.vertices.length);
        // Fine: 21×21 = 441 verts; Coarse: 5×5 = 25 verts
    });

    it('patch count never exceeds maxPatches', async () => {
        const { mgr, terrain } = await createStack({
            manager: { patchSize: 5, gridStep: 5, maxPatches: 3 }
        });

        // Try to create patches at many positions
        for (let i = 0; i < 10; i++) {
            const angle = i * 0.5;
            const pos = Vec3.scale(
                Vec3.normalize({ x: Math.sin(angle), y: 0, z: Math.cos(angle) }),
                terrain.params.radius
            );
            mgr.ensurePatchesAround(pos, 5);
        }

        expect(mgr.patchCount).toBeLessThanOrEqual(3);
    });
});
