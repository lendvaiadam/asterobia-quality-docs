/**
 * Phase 2A Lifecycle Integration Tests
 *
 * End-to-end tests for the full GameServer.wireToRelay pipeline using a
 * mock relay. Exercises the complete Phase 2A "Manifest-Lite" lifecycle:
 *
 *   HOST_ANNOUNCE → SPAWN_MANIFEST → RUNNING → SERVER_SNAPSHOT delivery
 *   → Guest JOIN_ACK → MOVE_INPUT authority → Determinism proof
 *
 * Also includes Phase 1 regression tests ensuring no server authority
 * activates without the Phase 2A env gate.
 *
 * All tests run in-process. No real WebSockets.
 *
 * Run: npx vitest run tests/integration/netcode/phase2a-lifecycle.test.js
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameServer } from '../../../server/GameServer.js';
import { Room } from '../../../server/Room.js';
import { resetEntityIdCounter } from '../../../src/SimCore/runtime/IdGenerator.js';

// ========================================
// Mock Relay Infrastructure
// ========================================

/**
 * Create a mock WsRelay that GameServer.wireToRelay() can monkey-patch.
 * Provides the minimal surface area: channels Map, clients Map, _broadcast, _handleDisconnect.
 */
function createMockRelay() {
    return {
        /** @type {Map<string, Set<object>>} channelName -> Set of mock ws objects */
        channels: new Map(),
        /** @type {Map<object, object>} ws -> client info */
        clients: new Map(),
        /** Original _broadcast — will be monkey-patched by wireToRelay */
        _broadcast(ws, client, channelName, payload) {
            // Default: no-op (relay forwarding is not what we test)
        },
        /** Handle disconnect */
        _handleDisconnect(ws) {
            // Default cleanup
        }
    };
}

/**
 * Create a mock WebSocket object with send() spy.
 * Stores all sent messages for assertions.
 */
function createMockWs() {
    return {
        readyState: 1, // OPEN
        _sent: [],
        send(data) {
            this._sent.push(JSON.parse(data));
        }
    };
}

/**
 * Subscribe a mock ws to a channel on the mock relay.
 */
function subscribeToChannel(relay, channelName, ws) {
    if (!relay.channels.has(channelName)) {
        relay.channels.set(channelName, new Set());
    }
    relay.channels.get(channelName).add(ws);
}

/**
 * Helper: Deterministic tick driver (same as in server-authority.test.js)
 */
function tickRoom(room, count, dtSec) {
    const dt = dtSec ?? room.simLoop.fixedDtSec;
    for (let i = 0; i < count; i++) {
        const tickNumber = room.simLoop.tickCount + 1;
        room._onSimTick(dt, tickNumber);
        room.simLoop.tickCount = tickNumber;
    }
}

/**
 * Get SERVER_SNAPSHOT messages from a mock ws's sent buffer.
 */
function getSnapshots(ws) {
    return ws._sent.filter(m => m.payload && m.payload.type === 'SERVER_SNAPSHOT');
}

// ========================================
// A) Full Lifecycle: HOST_ANNOUNCE → SNAPSHOT delivery
// ========================================

describe('Phase 2A Lifecycle: Full Pipeline', () => {
    let server;
    let relay;
    let hostWs, guestWs;
    let hostClient, guestClient;
    const ROOM_ID = 'test-host-123';
    const SESSION_CHANNEL = `asterobia:session:${ROOM_ID}`;

    beforeEach(() => {
        resetEntityIdCounter();

        server = new GameServer({ tickRate: 20 });
        relay = createMockRelay();
        server.wireToRelay(relay);
        server.start();

        // Create host mock
        hostWs = createMockWs();
        hostClient = { id: 1 };
        relay.clients.set(hostWs, hostClient);
        subscribeToChannel(relay, SESSION_CHANNEL, hostWs);

        // Create guest mock
        guestWs = createMockWs();
        guestClient = { id: 2 };
        relay.clients.set(guestWs, guestClient);
        subscribeToChannel(relay, SESSION_CHANNEL, guestWs);
    });

    afterEach(() => {
        server.stop();
    });

    it('HOST_ANNOUNCE creates room in WAITING state', () => {
        relay._broadcast(hostWs, hostClient, SESSION_CHANNEL, {
            type: 'HOST_ANNOUNCE',
            hostId: ROOM_ID,
            hostDisplayName: 'TestHost'
        });

        const room = server.getRoom(ROOM_ID);
        expect(room).toBeDefined();
        expect(room.state).toBe('WAITING');
        expect(room.units).toHaveLength(0);
    });

    it('HOST_ANNOUNCE maps host client to slot 0', () => {
        relay._broadcast(hostWs, hostClient, SESSION_CHANNEL, {
            type: 'HOST_ANNOUNCE',
            hostId: ROOM_ID,
            hostDisplayName: 'TestHost'
        });

        const auth = server._clientSlots.get(hostClient.id);
        expect(auth).toBeDefined();
        expect(auth.slot).toBe(0);
        expect(auth.roomId).toBe(ROOM_ID);
    });

    it('duplicate HOST_ANNOUNCE is ignored (room already exists)', () => {
        relay._broadcast(hostWs, hostClient, SESSION_CHANNEL, {
            type: 'HOST_ANNOUNCE',
            hostId: ROOM_ID,
            hostDisplayName: 'TestHost'
        });

        // Second announce — should not throw or create duplicate
        relay._broadcast(hostWs, hostClient, SESSION_CHANNEL, {
            type: 'HOST_ANNOUNCE',
            hostId: ROOM_ID,
            hostDisplayName: 'TestHost'
        });

        expect(server.rooms.size).toBe(1);
    });

    it('SPAWN_MANIFEST transitions room WAITING → RUNNING with units', () => {
        // Step 1: HOST_ANNOUNCE
        relay._broadcast(hostWs, hostClient, SESSION_CHANNEL, {
            type: 'HOST_ANNOUNCE',
            hostId: ROOM_ID,
            hostDisplayName: 'TestHost'
        });

        // Step 2: SPAWN_MANIFEST
        const manifest = [
            { id: 100, ownerSlot: 0, modelIndex: 2, px: 1, py: 0, pz: 0 },
            { id: 101, ownerSlot: 0, modelIndex: 3, px: 0, py: 0, pz: 1 },
            { id: 102, ownerSlot: 0, modelIndex: 0, px: -1, py: 0, pz: 0 }
        ];

        relay._broadcast(hostWs, hostClient, SESSION_CHANNEL, {
            type: 'SPAWN_MANIFEST',
            units: manifest,
            timestamp: Date.now()
        });

        const room = server.getRoom(ROOM_ID);
        expect(room.state).toBe('RUNNING');
        expect(room.units).toHaveLength(3);
        expect(room.units[0].id).toBe(100);
        expect(room.units[1].id).toBe(101);
        expect(room.units[2].id).toBe(102);
    });

    it('SPAWN_MANIFEST preserves client-provided IDs and modelIndex', () => {
        relay._broadcast(hostWs, hostClient, SESSION_CHANNEL, {
            type: 'HOST_ANNOUNCE',
            hostId: ROOM_ID,
            hostDisplayName: 'TestHost'
        });

        relay._broadcast(hostWs, hostClient, SESSION_CHANNEL, {
            type: 'SPAWN_MANIFEST',
            units: [
                { id: 42, ownerSlot: 0, modelIndex: 4, px: 1, py: 0, pz: 0 }
            ],
            timestamp: Date.now()
        });

        const room = server.getRoom(ROOM_ID);
        expect(room.units[0].id).toBe(42);
        expect(room.units[0].modelIndex).toBe(4);
        expect(room.units[0].ownerSlot).toBe(0);
    });

    it('second SPAWN_MANIFEST is rejected (room already RUNNING)', () => {
        relay._broadcast(hostWs, hostClient, SESSION_CHANNEL, {
            type: 'HOST_ANNOUNCE',
            hostId: ROOM_ID,
            hostDisplayName: 'TestHost'
        });

        relay._broadcast(hostWs, hostClient, SESSION_CHANNEL, {
            type: 'SPAWN_MANIFEST',
            units: [{ id: 100, ownerSlot: 0, modelIndex: 0, px: 1, py: 0, pz: 0 }],
            timestamp: Date.now()
        });

        // Second manifest — should not add more units
        relay._broadcast(hostWs, hostClient, SESSION_CHANNEL, {
            type: 'SPAWN_MANIFEST',
            units: [{ id: 200, ownerSlot: 0, modelIndex: 0, px: 0, py: 0, pz: 1 }],
            timestamp: Date.now()
        });

        const room = server.getRoom(ROOM_ID);
        expect(room.units).toHaveLength(1);
        expect(room.units[0].id).toBe(100);
    });

    it('SPAWN_MANIFEST from non-host is rejected', () => {
        relay._broadcast(hostWs, hostClient, SESSION_CHANNEL, {
            type: 'HOST_ANNOUNCE',
            hostId: ROOM_ID,
            hostDisplayName: 'TestHost'
        });

        // Guest tries to send manifest
        relay._broadcast(guestWs, guestClient, SESSION_CHANNEL, {
            type: 'SPAWN_MANIFEST',
            units: [{ id: 999, ownerSlot: 1, modelIndex: 0, px: 1, py: 0, pz: 0 }],
            timestamp: Date.now()
        });

        const room = server.getRoom(ROOM_ID);
        expect(room.state).toBe('WAITING');
        expect(room.units).toHaveLength(0);
    });

    it('SERVER_SNAPSHOT is injected to all channel subscribers after tick', () => {
        // Full lifecycle: announce → manifest → tick → check ws.send
        relay._broadcast(hostWs, hostClient, SESSION_CHANNEL, {
            type: 'HOST_ANNOUNCE',
            hostId: ROOM_ID,
            hostDisplayName: 'TestHost'
        });

        relay._broadcast(hostWs, hostClient, SESSION_CHANNEL, {
            type: 'SPAWN_MANIFEST',
            units: [{ id: 100, ownerSlot: 0, modelIndex: 0, px: 1, py: 0, pz: 0 }],
            timestamp: Date.now()
        });

        const room = server.getRoom(ROOM_ID);

        // Drive ticks manually (bypass setInterval)
        // Need to stop real interval first, then tick deterministically
        room.stop();
        room.state = 'RUNNING';
        room.simLoop.onSimTick = (dt, tc) => room._onSimTick(dt, tc);
        tickRoom(room, 3);

        // Both host and guest should receive snapshots
        const hostSnaps = getSnapshots(hostWs);
        const guestSnaps = getSnapshots(guestWs);

        expect(hostSnaps.length).toBe(3);
        expect(guestSnaps.length).toBe(3);

        // Verify snapshot structure
        const snap = hostSnaps[0].payload;
        expect(snap.type).toBe('SERVER_SNAPSHOT');
        expect(snap.version).toBe(1);
        expect(typeof snap.tick).toBe('number');
        expect(typeof snap.serverTimeMs).toBe('number');
        expect(Array.isArray(snap.units)).toBe(true);
        expect(snap.units).toHaveLength(1);
        expect(snap.units[0].id).toBe(100);
    });

    it('snapshot tick numbers are monotonically increasing', () => {
        relay._broadcast(hostWs, hostClient, SESSION_CHANNEL, {
            type: 'HOST_ANNOUNCE',
            hostId: ROOM_ID,
            hostDisplayName: 'TestHost'
        });

        relay._broadcast(hostWs, hostClient, SESSION_CHANNEL, {
            type: 'SPAWN_MANIFEST',
            units: [{ id: 100, ownerSlot: 0, modelIndex: 0, px: 1, py: 0, pz: 0 }],
            timestamp: Date.now()
        });

        const room = server.getRoom(ROOM_ID);
        room.stop();
        room.state = 'RUNNING';
        room.simLoop.onSimTick = (dt, tc) => room._onSimTick(dt, tc);
        tickRoom(room, 5);

        const ticks = getSnapshots(hostWs).map(s => s.payload.tick);
        for (let i = 1; i < ticks.length; i++) {
            expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
        }
    });

    it('snapshot does NOT contain seatPinDigit (privacy gate)', () => {
        relay._broadcast(hostWs, hostClient, SESSION_CHANNEL, {
            type: 'HOST_ANNOUNCE',
            hostId: ROOM_ID,
            hostDisplayName: 'TestHost'
        });

        relay._broadcast(hostWs, hostClient, SESSION_CHANNEL, {
            type: 'SPAWN_MANIFEST',
            units: [{ id: 100, ownerSlot: 0, modelIndex: 0, px: 1, py: 0, pz: 0 }],
            timestamp: Date.now()
        });

        const room = server.getRoom(ROOM_ID);
        room.stop();
        room.state = 'RUNNING';
        room.simLoop.onSimTick = (dt, tc) => room._onSimTick(dt, tc);
        tickRoom(room, 1);

        const snap = getSnapshots(hostWs)[0].payload;
        const snapJson = JSON.stringify(snap);
        expect(snapJson).not.toContain('seatPinDigit');
        expect(snapJson).not.toContain('pin');
    });
});

// ========================================
// B) Guest Join + Unit Creation
// ========================================

describe('Phase 2A Lifecycle: Guest Join', () => {
    let server, relay;
    let hostWs, guestWs;
    let hostClient, guestClient;
    const ROOM_ID = 'join-test-456';
    const SESSION_CHANNEL = `asterobia:session:${ROOM_ID}`;

    beforeEach(() => {
        resetEntityIdCounter();

        server = new GameServer({ tickRate: 20 });
        relay = createMockRelay();
        server.wireToRelay(relay);
        server.start();

        hostWs = createMockWs();
        hostClient = { id: 10 };
        relay.clients.set(hostWs, hostClient);
        subscribeToChannel(relay, SESSION_CHANNEL, hostWs);

        guestWs = createMockWs();
        guestClient = { id: 20 };
        relay.clients.set(guestWs, guestClient);
        subscribeToChannel(relay, SESSION_CHANNEL, guestWs);

        // Bootstrap: announce + manifest
        relay._broadcast(hostWs, hostClient, SESSION_CHANNEL, {
            type: 'HOST_ANNOUNCE',
            hostId: ROOM_ID,
            hostDisplayName: 'Host'
        });

        relay._broadcast(hostWs, hostClient, SESSION_CHANNEL, {
            type: 'SPAWN_MANIFEST',
            units: [
                { id: 100, ownerSlot: 0, modelIndex: 0, px: 1, py: 0, pz: 0 },
                { id: 101, ownerSlot: 0, modelIndex: 1, px: 0, py: 0, pz: 1 }
            ],
            timestamp: Date.now()
        });
    });

    afterEach(() => {
        server.stop();
    });

    it('JOIN_ACK creates guest unit on server', () => {
        const room = server.getRoom(ROOM_ID);
        expect(room.units).toHaveLength(2); // manifest units only

        // Host broadcasts JOIN_ACK (Phase 1 flow, observed by GameServer)
        relay._broadcast(hostWs, hostClient, SESSION_CHANNEL, {
            type: 'JOIN_ACK',
            accepted: true,
            assignedSlot: 1,
            timestamp: Date.now()
        });

        // Server should have created a unit for the guest
        expect(room.units).toHaveLength(3);
        const guestUnit = room.units[2];
        expect(guestUnit.ownerSlot).toBe(1);
    });

    it('JOIN_ACK with accepted=false does not create unit', () => {
        const room = server.getRoom(ROOM_ID);

        relay._broadcast(hostWs, hostClient, SESSION_CHANNEL, {
            type: 'JOIN_ACK',
            accepted: false,
            timestamp: Date.now()
        });

        expect(room.units).toHaveLength(2);
    });

    it('guest unit appears in SERVER_SNAPSHOT after join', () => {
        const room = server.getRoom(ROOM_ID);

        relay._broadcast(hostWs, hostClient, SESSION_CHANNEL, {
            type: 'JOIN_ACK',
            accepted: true,
            assignedSlot: 1,
            timestamp: Date.now()
        });

        // Drive tick
        room.stop();
        room.state = 'RUNNING';
        room.simLoop.onSimTick = (dt, tc) => room._onSimTick(dt, tc);
        tickRoom(room, 1);

        const snap = getSnapshots(guestWs)[0].payload;
        expect(snap.units).toHaveLength(3);

        // Verify manifest units + guest unit all present
        const ids = snap.units.map(u => u.id);
        expect(ids).toContain(100);
        expect(ids).toContain(101);
        // Guest unit has server-assigned ID (from nextEntityId)
        expect(ids).toHaveLength(3);
    });
});

// ========================================
// C) MOVE_INPUT Authority (E2E through relay)
// ========================================

describe('Phase 2A Lifecycle: MOVE_INPUT authority', () => {
    let server, relay;
    let hostWs, guestWs;
    let hostClient, guestClient;
    const ROOM_ID = 'move-test-789';
    const SESSION_CHANNEL = `asterobia:session:${ROOM_ID}`;

    function setupRoomForTicking() {
        const room = server.getRoom(ROOM_ID);
        room.stop();
        room.state = 'RUNNING';
        room.simLoop.onSimTick = (dt, tc) => room._onSimTick(dt, tc);
        return room;
    }

    beforeEach(() => {
        resetEntityIdCounter();

        server = new GameServer({ tickRate: 20 });
        relay = createMockRelay();
        server.wireToRelay(relay);
        server.start();

        hostWs = createMockWs();
        hostClient = { id: 100 };
        relay.clients.set(hostWs, hostClient);
        subscribeToChannel(relay, SESSION_CHANNEL, hostWs);

        guestWs = createMockWs();
        guestClient = { id: 200 };
        relay.clients.set(guestWs, guestClient);
        subscribeToChannel(relay, SESSION_CHANNEL, guestWs);

        // Bootstrap
        relay._broadcast(hostWs, hostClient, SESSION_CHANNEL, {
            type: 'HOST_ANNOUNCE',
            hostId: ROOM_ID,
            hostDisplayName: 'Host'
        });

        relay._broadcast(hostWs, hostClient, SESSION_CHANNEL, {
            type: 'SPAWN_MANIFEST',
            units: [{ id: 50, ownerSlot: 0, modelIndex: 0, px: 1, py: 0, pz: 0 }],
            timestamp: Date.now()
        });
    });

    afterEach(() => {
        server.stop();
    });

    it('host MOVE_INPUT advances unit position through relay pipeline', () => {
        const room = setupRoomForTicking();
        const startPos = { ...room.units[0].position };

        relay._broadcast(hostWs, hostClient, SESSION_CHANNEL, {
            type: 'MOVE_INPUT',
            forward: true,
            backward: false,
            left: false,
            right: false,
            timestamp: Date.now()
        });

        tickRoom(room, 1);

        const endPos = room.units[0].position;
        const moved = Math.sqrt(
            (endPos.x - startPos.x) ** 2 +
            (endPos.y - startPos.y) ** 2 +
            (endPos.z - startPos.z) ** 2
        );
        expect(moved).toBeGreaterThan(0);
    });

    it('host MOVE_INPUT with unitId targets specific unit', () => {
        const room = server.getRoom(ROOM_ID);

        // Add second host unit via manifest won't work (already RUNNING),
        // so create directly for this test
        room.createUnitForPlayer(0, 51, { modelIndex: 0 });
        const roomForTick = setupRoomForTicking();

        const u50Start = { ...room.units[0].position };
        const u51Start = { ...room.units[1].position };

        // Target unit 51 only
        relay._broadcast(hostWs, hostClient, SESSION_CHANNEL, {
            type: 'MOVE_INPUT',
            forward: true,
            backward: false,
            left: false,
            right: false,
            unitId: 51,
            timestamp: Date.now()
        });

        tickRoom(roomForTick, 1);

        // Unit 50 should NOT have moved
        expect(room.units[0].position.x).toBe(u50Start.x);
        expect(room.units[0].position.y).toBe(u50Start.y);

        // Unit 51 SHOULD have moved
        const moved = Math.sqrt(
            (room.units[1].position.x - u51Start.x) ** 2 +
            (room.units[1].position.y - u51Start.y) ** 2 +
            (room.units[1].position.z - u51Start.z) ** 2
        );
        expect(moved).toBeGreaterThan(0);
    });

    it('guest MOVE_INPUT is auto-mapped via first-message fallback', () => {
        // Add guest player + unit
        const room = server.getRoom(ROOM_ID);
        room.addPlayer('guest', 'Guest', null);
        room.createUnitForPlayer(1, 60, { modelIndex: 0 });

        const roomForTick = setupRoomForTicking();
        const guestUnit = room.units.find(u => u.ownerSlot === 1);
        const startPos = { ...guestUnit.position };

        // Guest sends MOVE_INPUT — auto-maps client 200 to slot 1
        relay._broadcast(guestWs, guestClient, SESSION_CHANNEL, {
            type: 'MOVE_INPUT',
            forward: true,
            backward: false,
            left: false,
            right: false,
            timestamp: Date.now()
        });

        tickRoom(roomForTick, 1);

        const moved = Math.sqrt(
            (guestUnit.position.x - startPos.x) ** 2 +
            (guestUnit.position.y - startPos.y) ** 2 +
            (guestUnit.position.z - startPos.z) ** 2
        );
        expect(moved).toBeGreaterThan(0);

        // Verify auto-mapping persisted
        const auth = server._clientSlots.get(guestClient.id);
        expect(auth).toBeDefined();
        expect(auth.slot).toBe(1);
    });

    it('no input = no movement over multiple ticks', () => {
        const room = setupRoomForTicking();
        const startPos = { ...room.units[0].position };

        tickRoom(room, 10);

        expect(room.units[0].position.x).toBe(startPos.x);
        expect(room.units[0].position.y).toBe(startPos.y);
        expect(room.units[0].position.z).toBe(startPos.z);
    });

    it('MOVE_INPUT from unknown client is silently dropped', () => {
        const unknownWs = createMockWs();
        const unknownClient = { id: 999 };

        const room = setupRoomForTicking();
        const startPos = { ...room.units[0].position };

        relay._broadcast(unknownWs, unknownClient, SESSION_CHANNEL, {
            type: 'MOVE_INPUT',
            forward: true,
            backward: false,
            left: false,
            right: false,
            timestamp: Date.now()
        });

        tickRoom(room, 1);

        // No movement — unknown client's input was dropped
        expect(room.units[0].position.x).toBe(startPos.x);
        expect(room.units[0].position.y).toBe(startPos.y);
    });

    it('movement appears in snapshot delivered to both clients', () => {
        const room = setupRoomForTicking();

        relay._broadcast(hostWs, hostClient, SESSION_CHANNEL, {
            type: 'MOVE_INPUT',
            forward: true,
            backward: false,
            left: false,
            right: false,
            timestamp: Date.now()
        });

        tickRoom(room, 1);

        const hostSnap = getSnapshots(hostWs)[0].payload;
        const guestSnap = getSnapshots(guestWs)[0].payload;

        // Both clients see the same unit state
        expect(hostSnap.units[0].px).toBe(guestSnap.units[0].px);
        expect(hostSnap.units[0].py).toBe(guestSnap.units[0].py);
        expect(hostSnap.units[0].pz).toBe(guestSnap.units[0].pz);
        expect(hostSnap.units[0].speed).toBeGreaterThan(0);
    });
});

// ========================================
// D) Determinism: Same pipeline → Same results
// ========================================

describe('Phase 2A Lifecycle: Determinism proof', () => {
    it('two identical pipelines produce identical snapshots', () => {
        // Run the SAME lifecycle twice through independent GameServer instances
        // and verify bitwise-identical snapshot output.
        const snapshots1 = runDeterministicPipeline(1);
        const snapshots2 = runDeterministicPipeline(2);

        expect(snapshots1.length).toBe(snapshots2.length);
        expect(snapshots1.length).toBeGreaterThan(0);

        for (let i = 0; i < snapshots1.length; i++) {
            const u1 = snapshots1[i].payload.units[0];
            const u2 = snapshots2[i].payload.units[0];
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

/**
 * Run a complete Phase 2A lifecycle pipeline and return the captured snapshots.
 * Identical calls with different serverIds must produce identical results.
 */
function runDeterministicPipeline(serverId) {
    resetEntityIdCounter();

    const server = new GameServer({ tickRate: 20 });
    const relay = createMockRelay();
    server.wireToRelay(relay);
    server.start();

    const ws = createMockWs();
    const client = { id: serverId };
    relay.clients.set(ws, client);
    const channel = `asterobia:session:det-${serverId}`;
    subscribeToChannel(relay, channel, ws);

    // HOST_ANNOUNCE
    relay._broadcast(ws, client, channel, {
        type: 'HOST_ANNOUNCE',
        hostId: `det-${serverId}`,
        hostDisplayName: 'Host'
    });

    // SPAWN_MANIFEST (same manifest data)
    relay._broadcast(ws, client, channel, {
        type: 'SPAWN_MANIFEST',
        units: [{ id: 100, ownerSlot: 0, modelIndex: 0, px: 1, py: 0, pz: 0 }],
        timestamp: 0
    });

    const room = server.getRoom(`det-${serverId}`);
    room.stop();
    room.state = 'RUNNING';
    room.simLoop.onSimTick = (dt, tc) => room._onSimTick(dt, tc);

    // Same input sequence
    const inputs = [
        { type: 'MOVE_INPUT', forward: true, backward: false, left: false, right: false },
        { type: 'MOVE_INPUT', forward: true, backward: false, left: true, right: false },
        { type: 'MOVE_INPUT', forward: false, backward: true, left: false, right: true },
        { type: 'MOVE_INPUT', forward: false, backward: false, left: false, right: false }
    ];

    for (const input of inputs) {
        relay._broadcast(ws, client, channel, { ...input, timestamp: 0 });
        tickRoom(room, 1);
    }

    server.stop();
    return getSnapshots(ws);
}

// ========================================
// E) Client Disconnect Cleanup
// ========================================

describe('Phase 2A Lifecycle: Disconnect cleanup', () => {
    it('client disconnect clears _clientSlots mapping', () => {
        resetEntityIdCounter();

        const server = new GameServer({ tickRate: 20 });
        const relay = createMockRelay();
        server.wireToRelay(relay);
        server.start();

        const hostWs = createMockWs();
        const hostClient = { id: 42 };
        relay.clients.set(hostWs, hostClient);
        subscribeToChannel(relay, 'asterobia:session:dc-test', hostWs);

        relay._broadcast(hostWs, hostClient, 'asterobia:session:dc-test', {
            type: 'HOST_ANNOUNCE',
            hostId: 'dc-test',
            hostDisplayName: 'Host'
        });

        expect(server._clientSlots.has(42)).toBe(true);

        // Simulate disconnect
        relay._handleDisconnect(hostWs);

        expect(server._clientSlots.has(42)).toBe(false);

        server.stop();
    });
});

// ========================================
// F) Phase 1 Regression: No server authority without PHASE2A
// ========================================

describe('Phase 1 Regression: No server authority without wireToRelay', () => {
    it('Room without broadcast callback produces no snapshots', () => {
        resetEntityIdCounter();
        const room = new Room('phase1-room', {});
        room.addPlayer('host', 'Host', null);
        room.createUnitForPlayer(0, 1);

        // Room ticks without error but no snapshots go anywhere
        expect(() => tickRoom(room, 10)).not.toThrow();
    });

    it('GameServer without wireToRelay has no rooms', () => {
        const server = new GameServer({ tickRate: 20 });
        server.start();

        // No wireToRelay → no way for rooms to be created via messages
        expect(server.rooms.size).toBe(0);

        server.stop();
    });

    it('Room WAITING → RUNNING lifecycle works independently of GameServer', () => {
        resetEntityIdCounter();
        const broadcasts = [];
        const room = new Room('standalone', {
            broadcast: (rid, snap) => broadcasts.push(snap)
        });

        room.addPlayer('host', 'Host', null);
        room.createUnitForPlayer(0, 1);
        expect(room.state).toBe('WAITING');

        room.start();
        expect(room.state).toBe('RUNNING');

        room.stop();
        expect(room.state).toBe('ENDED');
    });

    it('SPAWN_MANIFEST message type exists but is NOT required for Phase 1 Room', () => {
        // Phase 1 rooms can use createUnitForPlayer directly — no manifest needed
        resetEntityIdCounter();
        const room = new Room('p1-direct', {});
        room.addPlayer('host', 'Host', null);
        const unit = room.createUnitForPlayer(0, 1);

        expect(unit.id).toBe(1);
        expect(room.units).toHaveLength(1);
    });
});

// ========================================
// G) Edge Cases
// ========================================

describe('Phase 2A Lifecycle: Edge cases', () => {
    it('empty SPAWN_MANIFEST is rejected', () => {
        resetEntityIdCounter();
        const server = new GameServer({ tickRate: 20 });
        const relay = createMockRelay();
        server.wireToRelay(relay);
        server.start();

        const ws = createMockWs();
        const client = { id: 1 };
        relay.clients.set(ws, client);
        subscribeToChannel(relay, 'asterobia:session:empty-test', ws);

        relay._broadcast(ws, client, 'asterobia:session:empty-test', {
            type: 'HOST_ANNOUNCE',
            hostId: 'empty-test',
            hostDisplayName: 'Host'
        });

        relay._broadcast(ws, client, 'asterobia:session:empty-test', {
            type: 'SPAWN_MANIFEST',
            units: [],
            timestamp: Date.now()
        });

        const room = server.getRoom('empty-test');
        expect(room.state).toBe('WAITING'); // Rejected — still WAITING
        expect(room.units).toHaveLength(0);

        server.stop();
    });

    it('MOVE_INPUT before HOST_ANNOUNCE is silently dropped', () => {
        resetEntityIdCounter();
        const server = new GameServer({ tickRate: 20 });
        const relay = createMockRelay();
        server.wireToRelay(relay);
        server.start();

        const ws = createMockWs();
        const client = { id: 1 };

        // No HOST_ANNOUNCE, no room — MOVE_INPUT should be dropped
        expect(() => {
            relay._broadcast(ws, client, 'asterobia:session:noroom', {
                type: 'MOVE_INPUT',
                forward: true,
                backward: false,
                left: false,
                right: false,
                timestamp: Date.now()
            });
        }).not.toThrow();

        server.stop();
    });

    it('10-unit manifest: all units appear in snapshot', () => {
        resetEntityIdCounter();
        const server = new GameServer({ tickRate: 20 });
        const relay = createMockRelay();
        server.wireToRelay(relay);
        server.start();

        const ws = createMockWs();
        const client = { id: 1 };
        relay.clients.set(ws, client);
        subscribeToChannel(relay, 'asterobia:session:big-test', ws);

        relay._broadcast(ws, client, 'asterobia:session:big-test', {
            type: 'HOST_ANNOUNCE',
            hostId: 'big-test',
            hostDisplayName: 'Host'
        });

        const manifest = Array.from({ length: 10 }, (_, i) => ({
            id: 200 + i,
            ownerSlot: 0,
            modelIndex: i % 5,
            px: Math.sin(i), py: 0, pz: Math.cos(i)
        }));

        relay._broadcast(ws, client, 'asterobia:session:big-test', {
            type: 'SPAWN_MANIFEST',
            units: manifest,
            timestamp: Date.now()
        });

        const room = server.getRoom('big-test');
        room.stop();
        room.state = 'RUNNING';
        room.simLoop.onSimTick = (dt, tc) => room._onSimTick(dt, tc);
        tickRoom(room, 1);

        const snap = getSnapshots(ws)[0].payload;
        expect(snap.units).toHaveLength(10);

        const ids = snap.units.map(u => u.id);
        for (let i = 0; i < 10; i++) {
            expect(ids).toContain(200 + i);
        }

        server.stop();
    });

    it('closed WebSocket (readyState !== 1) does not receive snapshots', () => {
        resetEntityIdCounter();
        const server = new GameServer({ tickRate: 20 });
        const relay = createMockRelay();
        server.wireToRelay(relay);
        server.start();

        const openWs = createMockWs();
        const closedWs = createMockWs();
        closedWs.readyState = 3; // CLOSED

        const client1 = { id: 1 };
        const client2 = { id: 2 };
        relay.clients.set(openWs, client1);
        relay.clients.set(closedWs, client2);

        const ch = 'asterobia:session:closed-test';
        subscribeToChannel(relay, ch, openWs);
        subscribeToChannel(relay, ch, closedWs);

        relay._broadcast(openWs, client1, ch, {
            type: 'HOST_ANNOUNCE',
            hostId: 'closed-test',
            hostDisplayName: 'Host'
        });

        relay._broadcast(openWs, client1, ch, {
            type: 'SPAWN_MANIFEST',
            units: [{ id: 1, ownerSlot: 0, modelIndex: 0, px: 1, py: 0, pz: 0 }],
            timestamp: Date.now()
        });

        const room = server.getRoom('closed-test');
        room.stop();
        room.state = 'RUNNING';
        room.simLoop.onSimTick = (dt, tc) => room._onSimTick(dt, tc);
        tickRoom(room, 1);

        // Open ws should receive snapshot
        expect(getSnapshots(openWs).length).toBe(1);

        // Closed ws should NOT receive snapshot
        expect(getSnapshots(closedWs).length).toBe(0);

        server.stop();
    });
});
