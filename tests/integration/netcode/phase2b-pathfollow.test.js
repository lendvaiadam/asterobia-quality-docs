/**
 * Phase 2B: Path-Follow Authority Tests
 *
 * Verifies server-side PATH_DATA handling:
 *   1. Valid path acceptance + waypoint-following movement
 *   2. Validation rejections (MaxWaypoints, MaxSegmentLength, ownership, types)
 *   3. MOVE_INPUT interrupt rule
 *   4. Closed loop wrapping
 *   5. Path arrival / stop behavior
 *   6. Multi-unit independent paths
 *
 * All tests run in-process. No real WebSockets.
 *
 * Run: npx vitest run tests/integration/netcode/phase2b-pathfollow.test.js
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameServer } from '../../../server/GameServer.js';
import { Vec3 } from '../../../server/SphereMath.js';
import { resetEntityIdCounter } from '../../../src/SimCore/runtime/IdGenerator.js';

// ========================================
// Mock Infrastructure
// ========================================

function createMockRelay() {
    return {
        channels: new Map(),
        clients: new Map(),
        _broadcast(ws, client, channelName, payload) {},
        _handleDisconnect(ws) {}
    };
}

function createMockWs() {
    return {
        readyState: 1,
        _sent: [],
        send(data) {
            this._sent.push(typeof data === 'string' ? JSON.parse(data) : data);
        }
    };
}

function subscribeToChannel(relay, channelName, ws) {
    if (!relay.channels.has(channelName)) {
        relay.channels.set(channelName, new Set());
    }
    relay.channels.get(channelName).add(ws);
}

function tickRoom(room, count, dtSec) {
    const dt = dtSec ?? room.simLoop.fixedDtSec;
    for (let i = 0; i < count; i++) {
        const tickNumber = room.simLoop.tickCount + 1;
        room._onSimTick(dt, tickNumber);
        room.simLoop.tickCount = tickNumber;
    }
}

/**
 * Bootstrap a room with one host unit at known position.
 * Unit 1 (ownerSlot 0) spawns at (0, 60, 0) direction.
 */
function bootstrapRoom(roomId = 'path-room-1') {
    resetEntityIdCounter();

    const server = new GameServer({ tickRate: 20 });
    const relay = createMockRelay();
    server.wireToRelay(relay);
    server.start();

    const hostWs = createMockWs();
    const hostClient = { id: 1 };
    relay.clients.set(hostWs, hostClient);

    const channel = `asterobia:session:${roomId}`;
    subscribeToChannel(relay, channel, hostWs);

    // Host announces
    relay._broadcast(hostWs, hostClient, channel, {
        type: 'HOST_ANNOUNCE',
        hostId: roomId,
        hostDisplayName: 'TestHost'
    });

    // Host sends manifest with 1 unit
    relay._broadcast(hostWs, hostClient, channel, {
        type: 'SPAWN_MANIFEST',
        units: [
            { id: 1, ownerSlot: 0, modelIndex: 0, px: 0, py: 60, pz: 0 }
        ]
    });

    const room = server.getRoom(roomId);
    return { server, relay, hostWs, hostClient, room, channel };
}

/**
 * Bootstrap a room with host (slot 0) + guest (slot 1) units.
 */
function bootstrapRoomWithGuest(roomId = 'path-room-2') {
    resetEntityIdCounter();

    const server = new GameServer({ tickRate: 20 });
    const relay = createMockRelay();
    server.wireToRelay(relay);
    server.start();

    const hostWs = createMockWs();
    const hostClient = { id: 1 };
    relay.clients.set(hostWs, hostClient);

    const guestWs = createMockWs();
    const guestClient = { id: 2 };
    relay.clients.set(guestWs, guestClient);

    const channel = `asterobia:session:${roomId}`;
    subscribeToChannel(relay, channel, hostWs);
    subscribeToChannel(relay, channel, guestWs);

    relay._broadcast(hostWs, hostClient, channel, {
        type: 'HOST_ANNOUNCE',
        hostId: roomId,
        hostDisplayName: 'TestHost'
    });

    relay._broadcast(hostWs, hostClient, channel, {
        type: 'SPAWN_MANIFEST',
        units: [
            { id: 1, ownerSlot: 0, modelIndex: 0, px: 0, py: 60, pz: 0 },
            { id: 2, ownerSlot: 1, modelIndex: 1, px: 60, py: 0, pz: 0 }
        ]
    });

    // Map guest to slot 1 via JOIN_ACK
    relay._broadcast(hostWs, hostClient, channel, {
        type: 'JOIN_ACK',
        accepted: true,
        assignedSlot: 1
    });

    // Guest's first MOVE_INPUT auto-maps them
    relay._broadcast(guestWs, guestClient, channel, {
        type: 'MOVE_INPUT',
        forward: false, backward: false, left: false, right: false
    });

    const room = server.getRoom(roomId);
    return { server, relay, hostWs, hostClient, guestWs, guestClient, room, channel };
}

// ========================================
// 1) Valid PATH_DATA acceptance
// ========================================

describe('Phase 2B: PATH_DATA acceptance', () => {
    let env;

    beforeEach(() => {
        env = bootstrapRoom();
    });

    afterEach(() => {
        env.server.stop();
    });

    it('accepts valid PATH_DATA and sets unit waypoints', () => {
        const unit = env.room.units[0];
        const startPos = { ...unit.position };

        // Send PATH_DATA with 3 waypoints near the unit
        const wp1 = { x: 1, y: 60, z: 0 };
        const wp2 = { x: 2, y: 60, z: 0 };
        const wp3 = { x: 3, y: 60, z: 0 };

        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'PATH_DATA',
            unitId: 1,
            waypoints: [wp1, wp2, wp3],
            closed: false
        });

        // Flush command queue by ticking
        tickRoom(env.room, 1);

        // Unit should have active path
        expect(unit.waypoints).not.toBeNull();
        expect(unit.waypoints.length).toBe(3);
        expect(unit.waypointIndex).toBeGreaterThanOrEqual(0);
    });

    it('unit moves toward first waypoint after PATH_DATA', () => {
        const unit = env.room.units[0];
        const startPos = { ...unit.position };

        // Waypoint 10 units away on X axis (within 200m segment limit)
        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'PATH_DATA',
            unitId: 1,
            waypoints: [{ x: 10, y: 60, z: 0 }],
            closed: false
        });

        // Tick several times (MOVE_SPEED=5, dt=0.05s → 0.25 units per tick)
        tickRoom(env.room, 10);

        // Unit should have moved toward the waypoint (x should increase)
        const dist = Vec3.length(Vec3.sub(unit.position, startPos));
        expect(dist).toBeGreaterThan(0);
    });

    it('unit speed is MOVE_SPEED while following path', () => {
        const unit = env.room.units[0];

        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'PATH_DATA',
            unitId: 1,
            waypoints: [{ x: 100, y: 0, z: 0 }],
            closed: false
        });

        tickRoom(env.room, 1);

        expect(unit.speed).toBe(5.0);
        expect(unit.waypoints).not.toBeNull();
    });

    it('snapshot shows MOVING state during path-follow', () => {
        const unit = env.room.units[0];

        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'PATH_DATA',
            unitId: 1,
            waypoints: [{ x: 100, y: 0, z: 0 }],
            closed: false
        });

        tickRoom(env.room, 1);

        const snap = unit.toSnapshot();
        expect(snap.state).toBe('MOVING');
        expect(snap.speed).toBe(5.0);
    });
});

// ========================================
// 2) PATH_DATA validation rejections
// ========================================

describe('Phase 2B: PATH_DATA validation', () => {
    let env;

    beforeEach(() => {
        env = bootstrapRoom();
    });

    afterEach(() => {
        env.server.stop();
    });

    it('rejects PATH_DATA with > 32 waypoints', () => {
        const unit = env.room.units[0];
        const waypoints = [];
        for (let i = 0; i < 33; i++) {
            waypoints.push({ x: i * 0.1, y: 60, z: 0 });
        }

        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'PATH_DATA',
            unitId: 1,
            waypoints,
            closed: false
        });

        tickRoom(env.room, 1);
        expect(unit.waypoints).toBeNull();
    });

    it('accepts PATH_DATA with exactly 32 waypoints', () => {
        const unit = env.room.units[0];
        const waypoints = [];
        for (let i = 0; i < 32; i++) {
            waypoints.push({ x: i * 0.1, y: 60, z: 0 });
        }

        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'PATH_DATA',
            unitId: 1,
            waypoints,
            closed: false
        });

        tickRoom(env.room, 1);
        expect(unit.waypoints).not.toBeNull();
        expect(unit.waypoints.length).toBe(32);
    });

    it('rejects PATH_DATA with empty waypoints', () => {
        const unit = env.room.units[0];

        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'PATH_DATA',
            unitId: 1,
            waypoints: [],
            closed: false
        });

        tickRoom(env.room, 1);
        expect(unit.waypoints).toBeNull();
    });

    it('rejects PATH_DATA with segment > 200m', () => {
        const unit = env.room.units[0];

        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'PATH_DATA',
            unitId: 1,
            waypoints: [
                { x: 0, y: 60, z: 0 },
                { x: 250, y: 60, z: 0 }  // ~250 units apart
            ],
            closed: false
        });

        tickRoom(env.room, 1);
        expect(unit.waypoints).toBeNull();
    });

    it('rejects PATH_DATA with NaN coordinates', () => {
        const unit = env.room.units[0];

        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'PATH_DATA',
            unitId: 1,
            waypoints: [{ x: NaN, y: 60, z: 0 }],
            closed: false
        });

        tickRoom(env.room, 1);
        expect(unit.waypoints).toBeNull();
    });

    it('rejects PATH_DATA with Infinity coordinates', () => {
        const unit = env.room.units[0];

        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'PATH_DATA',
            unitId: 1,
            waypoints: [{ x: Infinity, y: 60, z: 0 }],
            closed: false
        });

        tickRoom(env.room, 1);
        expect(unit.waypoints).toBeNull();
    });

    it('rejects PATH_DATA with non-numeric coordinates', () => {
        const unit = env.room.units[0];

        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'PATH_DATA',
            unitId: 1,
            waypoints: [{ x: 'hello', y: 60, z: 0 }],
            closed: false
        });

        tickRoom(env.room, 1);
        expect(unit.waypoints).toBeNull();
    });

    it('rejects PATH_DATA with non-numeric unitId', () => {
        const unit = env.room.units[0];

        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'PATH_DATA',
            unitId: 'bad',
            waypoints: [{ x: 1, y: 60, z: 0 }],
            closed: false
        });

        tickRoom(env.room, 1);
        expect(unit.waypoints).toBeNull();
    });

    it('rejects PATH_DATA with missing waypoints field', () => {
        const unit = env.room.units[0];

        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'PATH_DATA',
            unitId: 1
        });

        tickRoom(env.room, 1);
        expect(unit.waypoints).toBeNull();
    });

    it('rejects closed PATH_DATA with last→first segment > 200m', () => {
        const unit = env.room.units[0];

        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'PATH_DATA',
            unitId: 1,
            waypoints: [
                { x: 0, y: 60, z: 0 },
                { x: 10, y: 60, z: 0 },
                { x: 250, y: 60, z: 0 }  // close segment: 250→0 = 250m > limit
            ],
            closed: true
        });

        tickRoom(env.room, 1);
        expect(unit.waypoints).toBeNull();
    });
});

// ========================================
// 3) Ownership checks
// ========================================

describe('Phase 2B: PATH_DATA ownership', () => {
    let env;

    beforeEach(() => {
        env = bootstrapRoomWithGuest();
    });

    afterEach(() => {
        env.server.stop();
    });

    it('host can send PATH_DATA to own unit (slot 0)', () => {
        const hostUnit = env.room.units.find(u => u.ownerSlot === 0);

        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'PATH_DATA',
            unitId: hostUnit.id,
            waypoints: [{ x: 5, y: 60, z: 0 }],
            closed: false
        });

        tickRoom(env.room, 1);
        expect(hostUnit.waypoints).not.toBeNull();
    });

    it('host cannot send PATH_DATA to guest unit', () => {
        const guestUnit = env.room.units.find(u => u.ownerSlot === 1);

        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'PATH_DATA',
            unitId: guestUnit.id,
            waypoints: [{ x: 5, y: 60, z: 0 }],
            closed: false
        });

        tickRoom(env.room, 1);
        expect(guestUnit.waypoints).toBeNull();
    });

    it('guest can send PATH_DATA to own unit', () => {
        const guestUnit = env.room.units.find(u => u.ownerSlot === 1);

        env.relay._broadcast(env.guestWs, env.guestClient, env.channel, {
            type: 'PATH_DATA',
            unitId: guestUnit.id,
            waypoints: [{ x: 5, y: 60, z: 0 }],
            closed: false
        });

        tickRoom(env.room, 1);
        expect(guestUnit.waypoints).not.toBeNull();
    });

    it('guest cannot send PATH_DATA to host unit', () => {
        const hostUnit = env.room.units.find(u => u.ownerSlot === 0);

        env.relay._broadcast(env.guestWs, env.guestClient, env.channel, {
            type: 'PATH_DATA',
            unitId: hostUnit.id,
            waypoints: [{ x: 5, y: 60, z: 0 }],
            closed: false
        });

        tickRoom(env.room, 1);
        expect(hostUnit.waypoints).toBeNull();
    });

    it('PATH_DATA for non-existent unitId is silently dropped', () => {
        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'PATH_DATA',
            unitId: 9999,
            waypoints: [{ x: 5, y: 60, z: 0 }],
            closed: false
        });

        // Should not throw — silently dropped
        tickRoom(env.room, 1);
        // All units should have no path
        for (const u of env.room.units) {
            expect(u.waypoints).toBeNull();
        }
    });
});

// ========================================
// 4) MOVE_INPUT interrupt
// ========================================

describe('Phase 2B: MOVE_INPUT cancels path', () => {
    let env;

    beforeEach(() => {
        env = bootstrapRoom();
    });

    afterEach(() => {
        env.server.stop();
    });

    it('WASD input cancels active path-follow', () => {
        const unit = env.room.units[0];

        // Set a path
        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'PATH_DATA',
            unitId: 1,
            waypoints: [{ x: 100, y: 0, z: 0 }],
            closed: false
        });
        tickRoom(env.room, 1);
        expect(unit.waypoints).not.toBeNull();

        // Send MOVE_INPUT with actual key press
        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'MOVE_INPUT',
            unitId: 1,
            forward: true, backward: false, left: false, right: false
        });
        tickRoom(env.room, 1);

        // Path should be cleared
        expect(unit.waypoints).toBeNull();
    });

    it('idle MOVE_INPUT (all false) does NOT cancel path', () => {
        const unit = env.room.units[0];

        // Set a path
        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'PATH_DATA',
            unitId: 1,
            waypoints: [{ x: 100, y: 0, z: 0 }],
            closed: false
        });
        tickRoom(env.room, 1);
        expect(unit.waypoints).not.toBeNull();

        // Send idle MOVE_INPUT (no keys pressed — 20Hz heartbeat)
        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'MOVE_INPUT',
            unitId: 1,
            forward: false, backward: false, left: false, right: false
        });
        tickRoom(env.room, 1);

        // Path should still be active
        expect(unit.waypoints).not.toBeNull();
    });
});

// ========================================
// 5) Path arrival + closed loop
// ========================================

describe('Phase 2B: Path completion', () => {
    let env;

    beforeEach(() => {
        env = bootstrapRoom();
    });

    afterEach(() => {
        env.server.stop();
    });

    it('unit stops and clears path after reaching final waypoint (open path)', () => {
        const unit = env.room.units[0];

        // Waypoint very close to current position (~0.5 units away)
        const nearWp = {
            x: unit.position.x + 0.1,
            y: unit.position.y,
            z: unit.position.z
        };

        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'PATH_DATA',
            unitId: 1,
            waypoints: [nearWp],
            closed: false
        });

        // Tick enough times for unit to arrive (MOVE_SPEED=5, dt=0.05 → 0.25/tick)
        tickRoom(env.room, 10);

        // Path should be cleared and unit stopped
        expect(unit.waypoints).toBeNull();
        expect(unit.speed).toBe(0);
    });

    it('closed path wraps waypointIndex to 0 instead of clearing', () => {
        const unit = env.room.units[0];

        // Two close waypoints forming a tiny loop
        const wp1 = {
            x: unit.position.x + 0.1,
            y: unit.position.y,
            z: unit.position.z
        };
        const wp2 = {
            x: unit.position.x + 0.2,
            y: unit.position.y,
            z: unit.position.z
        };

        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'PATH_DATA',
            unitId: 1,
            waypoints: [wp1, wp2],
            closed: true
        });

        // Tick many times — should cycle through waypoints without stopping
        tickRoom(env.room, 40);

        // Path should still be active (looping)
        expect(unit.waypoints).not.toBeNull();
        expect(unit.speed).toBe(5.0);
    });
});

// ========================================
// 6) Multi-unit independent paths
// ========================================

describe('Phase 2B: Multi-unit path independence', () => {
    let env;

    beforeEach(() => {
        env = bootstrapRoomWithGuest();
    });

    afterEach(() => {
        env.server.stop();
    });

    it('two units can follow paths independently', () => {
        const hostUnit = env.room.units.find(u => u.ownerSlot === 0);
        const guestUnit = env.room.units.find(u => u.ownerSlot === 1);

        // Host sets path on own unit
        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'PATH_DATA',
            unitId: hostUnit.id,
            waypoints: [{ x: 10, y: 60, z: 0 }],
            closed: false
        });

        // Guest sets path on own unit
        env.relay._broadcast(env.guestWs, env.guestClient, env.channel, {
            type: 'PATH_DATA',
            unitId: guestUnit.id,
            waypoints: [{ x: -10, y: 60, z: 0 }],
            closed: false
        });

        tickRoom(env.room, 1);

        // Both should have active paths
        expect(hostUnit.waypoints).not.toBeNull();
        expect(guestUnit.waypoints).not.toBeNull();

        // Tick more — both should be moving
        tickRoom(env.room, 5);
        expect(hostUnit.speed).toBe(5.0);
        expect(guestUnit.speed).toBe(5.0);
    });

    it('cancelling one unit path does not affect another', () => {
        const hostUnit = env.room.units.find(u => u.ownerSlot === 0);
        const guestUnit = env.room.units.find(u => u.ownerSlot === 1);

        // Both set paths
        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'PATH_DATA',
            unitId: hostUnit.id,
            waypoints: [{ x: 100, y: 0, z: 0 }],
            closed: false
        });
        env.relay._broadcast(env.guestWs, env.guestClient, env.channel, {
            type: 'PATH_DATA',
            unitId: guestUnit.id,
            waypoints: [{ x: -100, y: 0, z: 0 }],
            closed: false
        });

        tickRoom(env.room, 1);
        expect(hostUnit.waypoints).not.toBeNull();
        expect(guestUnit.waypoints).not.toBeNull();

        // Host cancels via WASD
        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'MOVE_INPUT',
            unitId: hostUnit.id,
            forward: true, backward: false, left: false, right: false
        });

        tickRoom(env.room, 1);

        // Host path cancelled, guest path intact
        expect(hostUnit.waypoints).toBeNull();
        expect(guestUnit.waypoints).not.toBeNull();
    });
});

// ========================================
// 7) New path replaces existing path
// ========================================

describe('Phase 2B: Path replacement', () => {
    let env;

    beforeEach(() => {
        env = bootstrapRoom();
    });

    afterEach(() => {
        env.server.stop();
    });

    it('new PATH_DATA replaces active path', () => {
        const unit = env.room.units[0];

        // First path
        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'PATH_DATA',
            unitId: 1,
            waypoints: [{ x: 100, y: 0, z: 0 }],
            closed: false
        });
        tickRoom(env.room, 1);
        expect(unit.waypoints.length).toBe(1);
        expect(unit.waypoints[0].x).toBe(100);

        // Second path replaces first
        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'PATH_DATA',
            unitId: 1,
            waypoints: [
                { x: -10, y: 60, z: 0 },
                { x: -20, y: 60, z: 0 }
            ],
            closed: false
        });
        tickRoom(env.room, 1);
        expect(unit.waypoints.length).toBe(2);
        expect(unit.waypoints[0].x).toBe(-10);
        expect(unit.waypointIndex).toBe(0);
    });
});

// ========================================
// 8) Phase 2A regression guard
// ========================================

describe('Phase 2B: WASD still works (regression)', () => {
    let env;

    beforeEach(() => {
        env = bootstrapRoom();
    });

    afterEach(() => {
        env.server.stop();
    });

    it('MOVE_INPUT without active path still moves unit via WASD', () => {
        const unit = env.room.units[0];
        const startPos = { ...unit.position };

        // No path set — direct WASD
        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'MOVE_INPUT',
            unitId: 1,
            forward: true, backward: false, left: false, right: false
        });

        tickRoom(env.room, 5);

        const dist = Vec3.length(Vec3.sub(unit.position, startPos));
        expect(dist).toBeGreaterThan(0);
        expect(unit.waypoints).toBeNull();
    });

    it('snapshot format unchanged (no pathIndex/progress leak)', () => {
        const unit = env.room.units[0];

        // Set a path
        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'PATH_DATA',
            unitId: 1,
            waypoints: [{ x: 100, y: 0, z: 0 }],
            closed: false
        });
        tickRoom(env.room, 1);

        const snap = unit.toSnapshot();

        // Snapshot must NOT contain path internals
        expect(snap).not.toHaveProperty('waypoints');
        expect(snap).not.toHaveProperty('waypointIndex');
        expect(snap).not.toHaveProperty('pathIndex');
        expect(snap).not.toHaveProperty('pathProgress');
        expect(snap).not.toHaveProperty('pathClosed');

        // Snapshot should have standard fields
        expect(snap).toHaveProperty('id');
        expect(snap).toHaveProperty('px');
        expect(snap).toHaveProperty('py');
        expect(snap).toHaveProperty('pz');
        expect(snap).toHaveProperty('qx');
        expect(snap).toHaveProperty('speed');
        expect(snap).toHaveProperty('state');
        expect(snap).toHaveProperty('mode');
    });
});
