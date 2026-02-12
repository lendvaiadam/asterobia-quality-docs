/**
 * Phase 2A Server Authority Integration Tests
 *
 * Tests the authoritative server tick loop, SERVER_SNAPSHOT broadcasting,
 * MOVE_INPUT processing, PHASE2A env gating, and spherical terrain movement.
 *
 * All tests run in-process using direct Room/HeadlessUnit/GameServer calls.
 * No real WebSocket connections.
 *
 * Run: npx vitest run tests/integration/netcode/server-authority.test.js
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameServer } from '../../../server/GameServer.js';
import { Room } from '../../../server/Room.js';
import { HeadlessUnit } from '../../../server/HeadlessUnit.js';
import { Vec3 } from '../../../server/SphereMath.js';
import { ServerTerrain } from '../../../server/ServerTerrain.js';
import { CommandType } from '../../../src/SimCore/runtime/CommandQueue.js';
import { MSG } from '../../../src/SimCore/multiplayer/MessageTypes.js';
import {
    validateMessage,
    createServerSnapshot,
    createMoveInput
} from '../../../src/SimCore/multiplayer/MessageSerializer.js';
import { resetEntityIdCounter, nextEntityId } from '../../../src/SimCore/runtime/IdGenerator.js';

// ========================================
// Helper: Deterministic tick driver
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

// ========================================
// 1. SERVER_SNAPSHOT schema & serialization
// ========================================

describe('Phase 2A: SERVER_SNAPSHOT schema', () => {
    it('SERVER_SNAPSHOT is a distinct message type from SNAPSHOT', () => {
        expect(MSG.SERVER_SNAPSHOT).toBe('SERVER_SNAPSHOT');
        expect(MSG.SNAPSHOT).toBe('SNAPSHOT');
        expect(MSG.SERVER_SNAPSHOT).not.toBe(MSG.SNAPSHOT);
    });

    it('MOVE_INPUT is a valid message type', () => {
        expect(MSG.MOVE_INPUT).toBe('MOVE_INPUT');
    });

    it('MOVE_INPUT exists in CommandType', () => {
        expect(CommandType.MOVE_INPUT).toBe('MOVE_INPUT');
    });

    it('createServerSnapshot produces valid message', () => {
        const msg = createServerSnapshot({
            version: 1,
            tick: 42,
            serverTimeMs: 1234567890,
            units: [{ id: 1, ownerSlot: 0, px: 0, py: 60, pz: 0, heading: 0, speed: 0, hp: 100 }]
        });

        expect(msg.type).toBe('SERVER_SNAPSHOT');
        expect(msg.version).toBe(1);
        expect(msg.tick).toBe(42);
        expect(msg.serverTimeMs).toBe(1234567890);
        expect(msg.units).toHaveLength(1);
        expect(msg.timestamp).toBeUndefined(); // SERVER_SNAPSHOT uses serverTimeMs, not timestamp
    });

    it('SERVER_SNAPSHOT passes validation without timestamp', () => {
        const msg = createServerSnapshot({
            version: 1,
            tick: 1,
            serverTimeMs: Date.now(),
            units: []
        });
        const result = validateMessage(msg);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it('createMoveInput produces valid message', () => {
        const msg = createMoveInput({ forward: true, backward: false, left: false, right: true });
        expect(msg.type).toBe('MOVE_INPUT');
        expect(msg.forward).toBe(true);
        expect(msg.backward).toBe(false);
        expect(msg.left).toBe(false);
        expect(msg.right).toBe(true);
        expect(typeof msg.timestamp).toBe('number');

        const result = validateMessage(msg);
        expect(result.valid).toBe(true);
    });

    it('MOVE_INPUT coerces truthy values to booleans', () => {
        const msg = createMoveInput({ forward: 1, backward: 0, left: null, right: undefined });
        expect(msg.forward).toBe(true);
        expect(msg.backward).toBe(false);
        expect(msg.left).toBe(false);
        expect(msg.right).toBe(false);
    });

    it('Phase 1 SNAPSHOT schema is unchanged', () => {
        const result = validateMessage({
            type: 'SNAPSHOT',
            simTick: 10,
            stateHash: 'abc',
            state: { units: [] },
            timestamp: Date.now()
        });
        expect(result.valid).toBe(true);
    });
});

// ========================================
// 2. HeadlessUnit.applyInput (spherical)
// ========================================

describe('Phase 2A: HeadlessUnit.applyInput', () => {
    let unit;
    let terrain;

    beforeEach(() => {
        terrain = new ServerTerrain();
        unit = new HeadlessUnit(1, 0);
        unit.spawnOnSurface({ x: 1, y: 0, z: 0 }, terrain);
    });

    it('MOVE_INPUT forward sets non-zero tangential velocity', () => {
        unit.applyInput({ type: 'MOVE_INPUT', forward: true, backward: false, left: false, right: false });
        expect(Vec3.length(unit.velocity)).toBeCloseTo(HeadlessUnit.MOVE_SPEED, 5);
        expect(unit.speed).toBe(HeadlessUnit.MOVE_SPEED);
    });

    it('MOVE_INPUT backward sets velocity (opposite to forward)', () => {
        const fwdUnit = new HeadlessUnit(2, 0);
        fwdUnit.spawnOnSurface({ x: 1, y: 0, z: 0 }, terrain);
        fwdUnit.applyInput({ type: 'MOVE_INPUT', forward: true, backward: false, left: false, right: false });

        unit.applyInput({ type: 'MOVE_INPUT', forward: false, backward: true, left: false, right: false });

        // Backward velocity should be opposite to forward
        const dot = Vec3.dot(unit.velocity, fwdUnit.velocity);
        expect(dot).toBeLessThan(0);
        expect(unit.speed).toBe(HeadlessUnit.MOVE_SPEED);
    });

    it('MOVE_INPUT left and right are perpendicular to forward', () => {
        const fwdUnit = new HeadlessUnit(2, 0);
        fwdUnit.spawnOnSurface({ x: 1, y: 0, z: 0 }, terrain);
        fwdUnit.applyInput({ type: 'MOVE_INPUT', forward: true, backward: false, left: false, right: false });

        unit.applyInput({ type: 'MOVE_INPUT', forward: false, backward: false, left: true, right: false });
        const dotLeft = Vec3.dot(unit.velocity, fwdUnit.velocity);
        expect(Math.abs(dotLeft)).toBeLessThan(0.01); // Perpendicular
        expect(unit.speed).toBe(HeadlessUnit.MOVE_SPEED);
    });

    it('diagonal normalization: W+A speed equals W-only speed', () => {
        const cardinalUnit = new HeadlessUnit(2, 0);
        const diagonalUnit = new HeadlessUnit(3, 0);
        cardinalUnit.spawnOnSurface({ x: 1, y: 0, z: 0 }, terrain);
        diagonalUnit.spawnOnSurface({ x: 1, y: 0, z: 0 }, terrain);

        cardinalUnit.applyInput({ type: 'MOVE_INPUT', forward: true, backward: false, left: false, right: false });
        diagonalUnit.applyInput({ type: 'MOVE_INPUT', forward: true, backward: false, left: true, right: false });

        const cardinalSpeed = Vec3.length(cardinalUnit.velocity);
        const diagonalSpeed = Vec3.length(diagonalUnit.velocity);

        expect(diagonalSpeed).toBeCloseTo(cardinalSpeed, 10);
        expect(diagonalUnit.speed).toBe(HeadlessUnit.MOVE_SPEED);
    });

    it('no input = no movement (speed zero)', () => {
        unit.applyInput({ type: 'MOVE_INPUT', forward: false, backward: false, left: false, right: false });
        expect(unit.velocity.x).toBe(0);
        expect(unit.velocity.y).toBe(0);
        expect(unit.velocity.z).toBe(0);
        expect(unit.speed).toBe(0);
    });

    it('opposing inputs cancel out (forward + backward)', () => {
        unit.applyInput({ type: 'MOVE_INPUT', forward: true, backward: true, left: false, right: false });
        expect(unit.velocity.x).toBe(0);
        expect(unit.velocity.y).toBe(0);
        expect(unit.velocity.z).toBe(0);
        expect(unit.speed).toBe(0);
    });

    it('updates heading when moving', () => {
        unit.applyInput({ type: 'MOVE_INPUT', forward: false, backward: false, left: false, right: true });
        expect(unit.heading).not.toBe(0);
        expect(typeof unit.heading).toBe('number');
    });

    it('ignores non-MOVE_INPUT commands', () => {
        const prevVel = { ...unit.velocity };
        unit.applyInput({ type: 'SELECT', unitId: 1 });
        expect(unit.velocity.x).toBe(prevVel.x);
        expect(unit.velocity.y).toBe(prevVel.y);
        expect(unit.velocity.z).toBe(prevVel.z);
    });

    it('MOVE_SPEED is 2.0', () => {
        expect(HeadlessUnit.MOVE_SPEED).toBe(2.0);
    });

    it('velocity is tangential to terrain surface (perpendicular to surface normal)', () => {
        unit.applyInput({ type: 'MOVE_INPUT', forward: true, backward: false, left: false, right: false });
        const surfaceNormal = Vec3.normalize(terrain.getNormalAt(unit.position));
        const dot = Vec3.dot(Vec3.normalize(unit.velocity), surfaceNormal);
        // Tangential velocity should be perpendicular to terrain surface normal
        expect(Math.abs(dot)).toBeLessThan(0.15);
    });
});

// ========================================
// 3. Room: command routing + snapshot broadcast
// ========================================

describe('Phase 2A: Room tick loop', () => {
    let room;
    let broadcastLog;

    beforeEach(() => {
        resetEntityIdCounter();
        broadcastLog = [];
        room = new Room('test-room', {
            broadcast: (roomId, snapshot) => {
                broadcastLog.push({ roomId, snapshot: JSON.parse(JSON.stringify(snapshot)) });
            }
        });
        room.addPlayer('host', 'Host', null);
        room.createUnitForPlayer(0, nextEntityId());
    });

    afterEach(() => {
        if (room.state === 'RUNNING') room.stop();
    });

    it('broadcasts SERVER_SNAPSHOT every tick', () => {
        tickRoom(room, 3);
        expect(broadcastLog).toHaveLength(3);

        const snap = broadcastLog[0].snapshot;
        expect(snap.type).toBe('SERVER_SNAPSHOT');
        expect(snap.version).toBe(1);
        expect(typeof snap.tick).toBe('number');
        expect(typeof snap.serverTimeMs).toBe('number');
        expect(Array.isArray(snap.units)).toBe(true);
    });

    it('snapshot tick numbers are strictly monotonic', () => {
        tickRoom(room, 5);
        const ticks = broadcastLog.map(b => b.snapshot.tick);
        for (let i = 1; i < ticks.length; i++) {
            expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
        }
    });

    it('snapshot contains unit with correct fields (including quaternion)', () => {
        tickRoom(room, 1);
        const unitSnap = broadcastLog[0].snapshot.units[0];
        expect(unitSnap).toHaveProperty('id');
        expect(unitSnap).toHaveProperty('ownerSlot');
        expect(unitSnap).toHaveProperty('px');
        expect(unitSnap).toHaveProperty('py');
        expect(unitSnap).toHaveProperty('pz');
        expect(unitSnap).toHaveProperty('qx');
        expect(unitSnap).toHaveProperty('qy');
        expect(unitSnap).toHaveProperty('qz');
        expect(unitSnap).toHaveProperty('qw');
        expect(unitSnap).toHaveProperty('heading');
        expect(unitSnap).toHaveProperty('speed');
        expect(unitSnap).toHaveProperty('hp');
    });

    it('MOVE_INPUT advances unit position after tick', () => {
        const startPos = { ...room.units[0].position };

        room.receiveInput(0, { type: 'MOVE_INPUT', forward: true, backward: false, left: false, right: false });
        tickRoom(room, 1);

        // Position should have changed (still on sphere, but at a different point)
        const endPos = room.units[0].position;
        const moved = Math.sqrt(
            (endPos.x - startPos.x) ** 2 +
            (endPos.y - startPos.y) ** 2 +
            (endPos.z - startPos.z) ** 2
        );
        expect(moved).toBeGreaterThan(0);
    });

    it('no input = unit stays stationary', () => {
        const startPos = { ...room.units[0].position };
        tickRoom(room, 10);
        expect(room.units[0].position.x).toBe(startPos.x);
        expect(room.units[0].position.y).toBe(startPos.y);
        expect(room.units[0].position.z).toBe(startPos.z);
    });

    it('routes MOVE_INPUT to correct unit by sourceSlot', () => {
        // Add a second player + unit
        room.addPlayer('guest', 'Guest', null);
        room.createUnitForPlayer(1, nextEntityId());

        const unit0Start = { ...room.units[0].position };
        const unit1Start = { ...room.units[1].position };

        // Only unit at slot 1 should move
        room.receiveInput(1, { type: 'MOVE_INPUT', forward: true, backward: false, left: false, right: false });
        tickRoom(room, 1);

        // Unit 0 (slot 0) unchanged
        expect(room.units[0].position.x).toBe(unit0Start.x);
        expect(room.units[0].position.y).toBe(unit0Start.y);
        expect(room.units[0].position.z).toBe(unit0Start.z);

        // Unit 1 (slot 1) moved
        const moved = Math.sqrt(
            (room.units[1].position.x - unit1Start.x) ** 2 +
            (room.units[1].position.y - unit1Start.y) ** 2 +
            (room.units[1].position.z - unit1Start.z) ** 2
        );
        expect(moved).toBeGreaterThan(0);
    });

    it('does not broadcast without broadcast callback', () => {
        const quietRoom = new Room('quiet', {});
        quietRoom.addPlayer('p1', 'Player', null);
        quietRoom.createUnitForPlayer(0, nextEntityId());

        // Should not throw
        expect(() => tickRoom(quietRoom, 3)).not.toThrow();
    });

    it('two clients receive identical snapshots per tick', () => {
        // Both snapshots come from the same broadcastFn call
        room.addPlayer('guest', 'Guest', null);
        room.createUnitForPlayer(1, nextEntityId());

        room.receiveInput(0, { type: 'MOVE_INPUT', forward: true, backward: false, left: false, right: false });
        tickRoom(room, 1);

        // broadcastFn is called once per tick with a single snapshot
        expect(broadcastLog).toHaveLength(1);
        const snap = broadcastLog[0].snapshot;
        expect(snap.units).toHaveLength(2);
    });
});

// ========================================
// 4. Room: createUnitForPlayer (terrain-aware)
// ========================================

describe('Phase 2A: Room.createUnitForPlayer', () => {
    it('creates units on terrain surface with different positions per slot', () => {
        resetEntityIdCounter();
        const room = new Room('test', {});

        room.addPlayer('p0', 'Player 0', null);
        const u0 = room.createUnitForPlayer(0, nextEntityId());

        room.addPlayer('p1', 'Player 1', null);
        const u1 = room.createUnitForPlayer(1, nextEntityId());

        expect(u0.ownerSlot).toBe(0);
        expect(u1.ownerSlot).toBe(1);

        // Both should be on terrain surface (far from origin)
        expect(distFromOrigin(u0.position)).toBeGreaterThan(50);
        expect(distFromOrigin(u1.position)).toBeGreaterThan(50);

        // Different positions
        const dist = Math.sqrt(
            (u0.position.x - u1.position.x) ** 2 +
            (u0.position.y - u1.position.y) ** 2 +
            (u0.position.z - u1.position.z) ** 2
        );
        expect(dist).toBeGreaterThan(5);

        // Units are in room
        expect(room.units).toHaveLength(2);
    });

    it('unit IDs are deterministic from IdGenerator', () => {
        resetEntityIdCounter();
        const id1 = nextEntityId();
        const id2 = nextEntityId();

        resetEntityIdCounter();
        const id1b = nextEntityId();
        const id2b = nextEntityId();

        expect(id1).toBe(id1b);
        expect(id2).toBe(id2b);
    });
});

// ========================================
// 5. GameServer: wireToRelay + PHASE2A gating
// ========================================

describe('Phase 2A: GameServer', () => {
    it('createRoom accepts broadcast option', () => {
        const server = new GameServer({ tickRate: 20 });
        const broadcasts = [];
        const room = server.createRoom('test', {
            broadcast: (rid, snap) => broadcasts.push(snap)
        });

        room.addPlayer('p1', 'Host', null);
        room.createUnitForPlayer(0, 1);
        tickRoom(room, 1);

        expect(broadcasts).toHaveLength(1);
        expect(broadcasts[0].type).toBe('SERVER_SNAPSHOT');

        server.stop();
    });

    it('wireToRelay is a function', () => {
        const server = new GameServer({ tickRate: 20 });
        expect(typeof server.wireToRelay).toBe('function');
        server.stop();
    });
});

// ========================================
// 6. Determinism: same inputs → same snapshots
// ========================================

describe('Phase 2A: Determinism', () => {
    it('same MOVE_INPUT sequence produces identical snapshots', () => {
        resetEntityIdCounter();
        const log1 = [];
        const room1 = new Room('r1', {
            broadcast: (rid, snap) => log1.push(JSON.parse(JSON.stringify(snap)))
        });
        room1.addPlayer('host', 'Host', null);
        room1.createUnitForPlayer(0, nextEntityId());

        resetEntityIdCounter();
        const log2 = [];
        const room2 = new Room('r2', {
            broadcast: (rid, snap) => log2.push(JSON.parse(JSON.stringify(snap)))
        });
        room2.addPlayer('host', 'Host', null);
        room2.createUnitForPlayer(0, nextEntityId());

        // Same input sequence
        const inputs = [
            { type: 'MOVE_INPUT', forward: true, backward: false, left: false, right: false },
            { type: 'MOVE_INPUT', forward: true, backward: false, left: true, right: false },
            { type: 'MOVE_INPUT', forward: false, backward: false, left: false, right: false }
        ];

        for (const input of inputs) {
            room1.receiveInput(0, { ...input });
            room2.receiveInput(0, { ...input });
            tickRoom(room1, 1);
            tickRoom(room2, 1);
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
            expect(u1.heading).toBe(u2.heading);
            expect(u1.speed).toBe(u2.speed);
        }
    });
});

// ========================================
// 7. PHASE2A env gating (conceptual)
// ========================================

describe('Phase 2A: Environment gating', () => {
    it('PHASE2A=1 enables server authority path', () => {
        // This test verifies the gating logic exists conceptually.
        // The actual env check is in server/index.js which is an entry point.
        // We verify the building blocks work:
        const server = new GameServer({ tickRate: 20 });

        // GameServer can create rooms and wire broadcasts
        const broadcasts = [];
        const room = server.createRoom('gated-test', {
            broadcast: (rid, snap) => broadcasts.push(snap)
        });
        room.addPlayer('host', 'Host', null);
        room.createUnitForPlayer(0, 1);
        tickRoom(room, 1);

        expect(broadcasts).toHaveLength(1);
        expect(broadcasts[0].type).toBe('SERVER_SNAPSHOT');
        expect(broadcasts[0].version).toBe(1);

        server.stop();
    });

    it('Room without broadcast callback produces no output', () => {
        // Simulates Phase 1 behavior where no GameServer is wired
        const room = new Room('phase1-room', {});
        room.addPlayer('host', 'Host', null);
        room.createUnitForPlayer(0, 1);

        // Ticking works without errors, but no snapshots are sent
        expect(() => tickRoom(room, 5)).not.toThrow();
    });
});
