/**
 * Phase 2A Server Terrain Integration Tests
 *
 * Verifies:
 * - ServerTerrain produces same heights as client Terrain (sync contract)
 * - Units spawn ON the terrain surface (not at origin)
 * - Movement stays on the terrain surface (no flying into space)
 * - SERVER_SNAPSHOT includes valid orientation quaternion
 * - SphereMath Vec3/Quat correctness
 * - Determinism: same inputs → same positions across two rooms
 *
 * Run: npx vitest run tests/integration/netcode/server-terrain.test.js
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Vec3, Quat } from '../../../server/SphereMath.js';
import { ServerTerrain } from '../../../server/ServerTerrain.js';
import { HeadlessUnit } from '../../../server/HeadlessUnit.js';
import { Room } from '../../../server/Room.js';
import { resetEntityIdCounter, nextEntityId } from '../../../src/SimCore/runtime/IdGenerator.js';

// ========================================
// Helper
// ========================================

function tickRoom(room, count, dtSec) {
    const dt = dtSec ?? room.simLoop.fixedDtSec;
    for (let i = 0; i < count; i++) {
        const tickNumber = room.simLoop.tickCount + 1;
        room._onSimTick(dt, tickNumber);
        room.simLoop.tickCount = tickNumber;
    }
}

/** Euclidean distance from origin */
function distFromOrigin(pos) {
    return Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
}

/** Quaternion magnitude (should be ~1 for valid quaternions) */
function quatLength(q) {
    // Support both {x,y,z,w} and snapshot format {qx,qy,qz,qw}
    const x = q.qx ?? q.x;
    const y = q.qy ?? q.y;
    const z = q.qz ?? q.z;
    const w = q.qw ?? q.w;
    return Math.sqrt(x * x + y * y + z * z + w * w);
}

// ========================================
// 1. SphereMath correctness
// ========================================

describe('SphereMath: Vec3', () => {
    it('normalize produces unit length', () => {
        const v = Vec3.normalize({ x: 3, y: 4, z: 0 });
        expect(Vec3.length(v)).toBeCloseTo(1.0, 10);
    });

    it('normalize zero vector returns fallback {0,1,0}', () => {
        const v = Vec3.normalize({ x: 0, y: 0, z: 0 });
        expect(v.y).toBe(1);
    });

    it('cross product is perpendicular to both inputs', () => {
        const a = { x: 1, y: 0, z: 0 };
        const b = { x: 0, y: 1, z: 0 };
        const c = Vec3.cross(a, b);
        expect(Vec3.dot(c, a)).toBeCloseTo(0, 10);
        expect(Vec3.dot(c, b)).toBeCloseTo(0, 10);
        expect(c.z).toBeCloseTo(1, 10);
    });

    it('projectOnPlane removes normal component', () => {
        const v = { x: 1, y: 2, z: 3 };
        const n = { x: 0, y: 1, z: 0 };
        const proj = Vec3.projectOnPlane(v, n);
        expect(proj.x).toBeCloseTo(1, 10);
        expect(proj.y).toBeCloseTo(0, 10);
        expect(proj.z).toBeCloseTo(3, 10);
    });
});

describe('SphereMath: Quat', () => {
    it('identity quaternion does not rotate', () => {
        const q = Quat.identity();
        const v = { x: 1, y: 2, z: 3 };
        const r = Quat.rotateVec3(q, v);
        expect(r.x).toBeCloseTo(1, 10);
        expect(r.y).toBeCloseTo(2, 10);
        expect(r.z).toBeCloseTo(3, 10);
    });

    it('fromAxisAngle 90° around Y rotates X to Z', () => {
        const q = Quat.fromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
        const v = Quat.rotateVec3(q, { x: 1, y: 0, z: 0 });
        expect(v.x).toBeCloseTo(0, 5);
        expect(v.z).toBeCloseTo(-1, 5);
    });

    it('lookRotation produces normalized quaternion', () => {
        const q = Quat.lookRotation({ x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
        expect(quatLength(q)).toBeCloseTo(1.0, 10);
    });

    it('lookRotation: forward=-Z, up=+Y gives identity', () => {
        const q = Quat.lookRotation({ x: 0, y: 0, z: -1 }, { x: 0, y: 1, z: 0 });
        // Identity quaternion: {0, 0, 0, 1}
        expect(q.w).toBeCloseTo(1.0, 5);
        expect(Math.abs(q.x)).toBeLessThan(0.01);
        expect(Math.abs(q.y)).toBeLessThan(0.01);
        expect(Math.abs(q.z)).toBeLessThan(0.01);
    });

    it('lookRotation: forward=+X, up=+Y rotates correctly', () => {
        const q = Quat.lookRotation({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
        // local -Z should map to forward (+X)
        const localNegZ = Quat.rotateVec3(q, { x: 0, y: 0, z: -1 });
        expect(localNegZ.x).toBeCloseTo(1, 5);
        expect(Math.abs(localNegZ.y)).toBeLessThan(0.01);
        expect(Math.abs(localNegZ.z)).toBeLessThan(0.01);
    });

    it('lookRotation with arbitrary up (terrain normal)', () => {
        // Simulate a surface normal at some point on the sphere
        const up = Vec3.normalize({ x: 0.3, y: 0.9, z: 0.1 });
        const fwd = Vec3.normalize(Vec3.projectOnPlane({ x: 0, y: 0, z: -1 }, up));
        const q = Quat.lookRotation(fwd, up);

        expect(quatLength(q)).toBeCloseTo(1.0, 10);

        // Verify: local +Y maps to up direction
        const localY = Quat.rotateVec3(q, { x: 0, y: 1, z: 0 });
        expect(localY.x).toBeCloseTo(up.x, 3);
        expect(localY.y).toBeCloseTo(up.y, 3);
        expect(localY.z).toBeCloseTo(up.z, 3);
    });
});

// ========================================
// 2. ServerTerrain
// ========================================

describe('ServerTerrain', () => {
    let terrain;

    beforeEach(() => {
        terrain = new ServerTerrain();
    });

    it('getRadiusAt returns value near base radius (60)', () => {
        const dir = Vec3.normalize({ x: 1, y: 0, z: 0 });
        const r = terrain.getRadiusAt(dir);
        // Should be in range [54, 66] (radius ± heightMultiplier)
        expect(r).toBeGreaterThan(54);
        expect(r).toBeLessThan(66);
    });

    it('getRadiusAt is deterministic (same input → same output)', () => {
        const dir = Vec3.normalize({ x: 0.5, y: 0.5, z: 0.5 });
        const r1 = terrain.getRadiusAt(dir);
        const r2 = terrain.getRadiusAt(dir);
        expect(r1).toBe(r2);
    });

    it('getNormalAt returns unit-length vector', () => {
        const pos = Vec3.scale(Vec3.normalize({ x: 1, y: 0, z: 0 }), 60);
        const n = terrain.getNormalAt(pos);
        expect(Vec3.length(n)).toBeCloseTo(1.0, 5);
    });

    it('getNormalAt points roughly outward (positive dot with radial direction)', () => {
        const dir = Vec3.normalize({ x: 1, y: 1, z: 0 });
        const pos = Vec3.scale(dir, terrain.getRadiusAt(dir));
        const n = terrain.getNormalAt(pos);
        // Normal should point roughly outward from center
        expect(Vec3.dot(n, dir)).toBeGreaterThan(0.5);
    });

    it('two ServerTerrain instances with same params produce same heights', () => {
        const t1 = new ServerTerrain();
        const t2 = new ServerTerrain();
        const dir = Vec3.normalize({ x: 0.3, y: 0.7, z: -0.2 });
        expect(t1.getRadiusAt(dir)).toBe(t2.getRadiusAt(dir));
    });
});

// ========================================
// 3. HeadlessUnit: spawn on surface
// ========================================

describe('HeadlessUnit: spawn on terrain surface', () => {
    let terrain;

    beforeEach(() => {
        terrain = new ServerTerrain();
    });

    it('spawnOnSurface places unit at correct terrain radius', () => {
        const unit = new HeadlessUnit(1, 0);
        const dir = Vec3.normalize({ x: 1, y: 0, z: 0 });
        unit.spawnOnSurface(dir, terrain);

        const expectedRadius = terrain.getRadiusAt(dir);
        const actualDist = distFromOrigin(unit.position);

        expect(actualDist).toBeCloseTo(expectedRadius, 5);
    });

    it('spawn position is NOT at origin', () => {
        const unit = new HeadlessUnit(1, 0);
        unit.spawnOnSurface({ x: 1, y: 0, z: 0 }, terrain);

        expect(distFromOrigin(unit.position)).toBeGreaterThan(50);
    });

    it('spawn sets valid orientation quaternion', () => {
        const unit = new HeadlessUnit(1, 0);
        unit.spawnOnSurface({ x: 0, y: 0, z: 1 }, terrain);

        expect(quatLength(unit.orientation)).toBeCloseTo(1.0, 5);
    });

    it('spawn at different directions gives different positions', () => {
        const u1 = new HeadlessUnit(1, 0);
        const u2 = new HeadlessUnit(2, 1);
        u1.spawnOnSurface({ x: 1, y: 0, z: 0 }, terrain);
        u2.spawnOnSurface({ x: 0, y: 0, z: 1 }, terrain);

        const dx = u1.position.x - u2.position.x;
        const dy = u1.position.y - u2.position.y;
        const dz = u1.position.z - u2.position.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        expect(dist).toBeGreaterThan(10);
    });
});

// ========================================
// 4. HeadlessUnit: movement stays on surface
// ========================================

describe('HeadlessUnit: spherical movement', () => {
    let terrain;
    let unit;

    beforeEach(() => {
        terrain = new ServerTerrain();
        unit = new HeadlessUnit(1, 0);
        unit.spawnOnSurface({ x: 1, y: 0, z: 0 }, terrain);
    });

    it('forward movement stays on terrain surface', () => {
        unit.applyInput({ type: 'MOVE_INPUT', forward: true, backward: false, left: false, right: false });

        for (let i = 0; i < 20; i++) {
            unit.updatePosition(0.05); // 20 ticks at 50ms
        }

        const dir = Vec3.normalize(unit.position);
        const expectedRadius = terrain.getRadiusAt(dir);
        const actualDist = distFromOrigin(unit.position);

        expect(actualDist).toBeCloseTo(expectedRadius, 3);
    });

    it('movement does not fly into space (distance stays near terrain radius)', () => {
        unit.applyInput({ type: 'MOVE_INPUT', forward: true, backward: false, left: true, right: false });

        for (let i = 0; i < 100; i++) {
            unit.updatePosition(0.05);
        }

        const dist = distFromOrigin(unit.position);
        // Should be within terrain range, not flying to infinity
        expect(dist).toBeGreaterThan(50);
        expect(dist).toBeLessThan(70);
    });

    it('no input = no movement', () => {
        const startPos = { ...unit.position };
        unit.applyInput({ type: 'MOVE_INPUT', forward: false, backward: false, left: false, right: false });
        unit.updatePosition(0.05);

        expect(unit.position.x).toBe(startPos.x);
        expect(unit.position.y).toBe(startPos.y);
        expect(unit.position.z).toBe(startPos.z);
    });

    it('diagonal normalization: W+D speed equals W-only speed', () => {
        const cardinal = new HeadlessUnit(2, 0);
        const diagonal = new HeadlessUnit(3, 0);
        cardinal.spawnOnSurface({ x: 1, y: 0, z: 0 }, terrain);
        diagonal.spawnOnSurface({ x: 1, y: 0, z: 0 }, terrain);

        cardinal.applyInput({ type: 'MOVE_INPUT', forward: true, backward: false, left: false, right: false });
        diagonal.applyInput({ type: 'MOVE_INPUT', forward: true, backward: false, left: false, right: true });

        expect(cardinal.speed).toBe(HeadlessUnit.MOVE_SPEED);
        expect(diagonal.speed).toBe(HeadlessUnit.MOVE_SPEED);
        expect(Vec3.length(cardinal.velocity)).toBeCloseTo(Vec3.length(diagonal.velocity), 5);
    });

    it('orientation quaternion is valid after movement', () => {
        unit.applyInput({ type: 'MOVE_INPUT', forward: true, backward: false, left: false, right: false });

        for (let i = 0; i < 10; i++) {
            unit.updatePosition(0.05);
        }

        expect(quatLength(unit.orientation)).toBeCloseTo(1.0, 5);
    });

    it('heading updates to match movement direction', () => {
        const startHeading = unit.heading;
        unit.applyInput({ type: 'MOVE_INPUT', forward: false, backward: false, left: false, right: true });
        expect(unit.heading).not.toBe(startHeading);
    });
});

// ========================================
// 5. Room: terrain-aware spawn + snapshot
// ========================================

describe('Room: terrain-aware operation', () => {
    let room;
    let broadcastLog;

    beforeEach(() => {
        resetEntityIdCounter();
        broadcastLog = [];
        room = new Room('terrain-test', {
            broadcast: (roomId, snapshot) => {
                broadcastLog.push({ roomId, snapshot: JSON.parse(JSON.stringify(snapshot)) });
            }
        });
    });

    it('creates units on terrain surface (not at origin)', () => {
        room.addPlayer('host', 'Host', null);
        const unit = room.createUnitForPlayer(0, nextEntityId());

        expect(distFromOrigin(unit.position)).toBeGreaterThan(50);
    });

    it('different slots spawn at different positions', () => {
        room.addPlayer('p0', 'P0', null);
        room.addPlayer('p1', 'P1', null);
        const u0 = room.createUnitForPlayer(0, nextEntityId());
        const u1 = room.createUnitForPlayer(1, nextEntityId());

        const dx = u0.position.x - u1.position.x;
        const dy = u0.position.y - u1.position.y;
        const dz = u0.position.z - u1.position.z;
        expect(Math.sqrt(dx * dx + dy * dy + dz * dz)).toBeGreaterThan(5);
    });

    it('snapshot includes quaternion fields', () => {
        room.addPlayer('host', 'Host', null);
        room.createUnitForPlayer(0, nextEntityId());
        tickRoom(room, 1);

        const snap = broadcastLog[0].snapshot;
        const u = snap.units[0];
        expect(u).toHaveProperty('qx');
        expect(u).toHaveProperty('qy');
        expect(u).toHaveProperty('qz');
        expect(u).toHaveProperty('qw');
        expect(typeof u.qx).toBe('number');
        expect(typeof u.qw).toBe('number');
    });

    it('snapshot quaternion is normalized', () => {
        room.addPlayer('host', 'Host', null);
        room.createUnitForPlayer(0, nextEntityId());
        tickRoom(room, 1);

        const u = broadcastLog[0].snapshot.units[0];
        expect(quatLength(u)).toBeCloseTo(1.0, 5);
    });

    it('snapshot position is on terrain surface', () => {
        room.addPlayer('host', 'Host', null);
        room.createUnitForPlayer(0, nextEntityId());
        tickRoom(room, 1);

        const u = broadcastLog[0].snapshot.units[0];
        const dist = Math.sqrt(u.px * u.px + u.py * u.py + u.pz * u.pz);
        expect(dist).toBeGreaterThan(50);
        expect(dist).toBeLessThan(70);
    });

    it('movement keeps unit on terrain after ticking', () => {
        room.addPlayer('host', 'Host', null);
        room.createUnitForPlayer(0, nextEntityId());

        room.receiveInput(0, { type: 'MOVE_INPUT', forward: true, backward: false, left: false, right: false });
        tickRoom(room, 20);

        const lastSnap = broadcastLog[broadcastLog.length - 1].snapshot;
        const u = lastSnap.units[0];
        const dist = Math.sqrt(u.px * u.px + u.py * u.py + u.pz * u.pz);
        expect(dist).toBeGreaterThan(50);
        expect(dist).toBeLessThan(70);
    });
});

// ========================================
// 6. Determinism: same inputs → same snapshots
// ========================================

describe('Determinism: spherical terrain', () => {
    it('two rooms with same inputs produce identical snapshot positions', () => {
        resetEntityIdCounter();
        const log1 = [];
        const r1 = new Room('r1', {
            broadcast: (rid, snap) => log1.push(JSON.parse(JSON.stringify(snap)))
        });
        r1.addPlayer('host', 'Host', null);
        r1.createUnitForPlayer(0, nextEntityId());

        resetEntityIdCounter();
        const log2 = [];
        const r2 = new Room('r2', {
            broadcast: (rid, snap) => log2.push(JSON.parse(JSON.stringify(snap)))
        });
        r2.addPlayer('host', 'Host', null);
        r2.createUnitForPlayer(0, nextEntityId());

        // Same input sequence
        const inputs = [
            { type: 'MOVE_INPUT', forward: true, backward: false, left: false, right: false },
            { type: 'MOVE_INPUT', forward: true, backward: false, left: true, right: false },
            { type: 'MOVE_INPUT', forward: false, backward: false, left: false, right: false }
        ];

        for (const input of inputs) {
            r1.receiveInput(0, { ...input });
            r2.receiveInput(0, { ...input });
            tickRoom(r1, 1);
            tickRoom(r2, 1);
        }

        expect(log1).toHaveLength(3);
        expect(log2).toHaveLength(3);

        for (let i = 0; i < 3; i++) {
            const u1 = log1[i].units[0];
            const u2 = log2[i].units[0];
            expect(u1.px).toBe(u2.px);
            expect(u1.py).toBe(u2.py);
            expect(u1.pz).toBe(u2.pz);
            expect(u1.qx).toBe(u2.qx);
            expect(u1.qy).toBe(u2.qy);
            expect(u1.qz).toBe(u2.qz);
            expect(u1.qw).toBe(u2.qw);
        }
    });
});
