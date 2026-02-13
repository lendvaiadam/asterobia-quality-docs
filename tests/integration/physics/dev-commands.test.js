/**
 * CMD_ADMIN Dev-Command Tests (ADR-003)
 *
 * Verifies the unified CMD_ADMIN handler in GameServer:
 *   1-3: Action tests (TRIGGER_EXPLOSION, PLACE_MINE, SPAWN_ROCK)
 *   4-8: Security gates (non-host, unauth, unknown action, malformed, physics-off)
 *
 * All tests run in-process. No real WebSockets.
 *
 * Run: npx vitest run tests/integration/physics/dev-commands.test.js
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameServer } from '../../../server/GameServer.js';
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

/**
 * Wait for room to reach RUNNING state (physics WASM init is async).
 * @param {import('../../../server/Room.js').Room} room
 * @param {number} [timeoutMs=5000]
 */
async function waitForRunning(room, timeoutMs = 5000) {
    const start = Date.now();
    while (room.state !== 'RUNNING') {
        if (Date.now() - start > timeoutMs) {
            throw new Error(`Room did not reach RUNNING within ${timeoutMs}ms (state: ${room.state})`);
        }
        await new Promise(r => setTimeout(r, 20));
    }
}

/**
 * Bootstrap a room with physics enabled and HOST as slot 0.
 * Waits for RUNNING state (Rapier WASM init).
 */
async function bootstrapPhysicsRoom(roomId = 'dev-cmd-room') {
    resetEntityIdCounter();

    const server = new GameServer({ tickRate: 20, enablePhysics: true });
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

    // Host sends manifest: unit 1 at pole, unit 2 nearby (within blast radius)
    relay._broadcast(hostWs, hostClient, channel, {
        type: 'SPAWN_MANIFEST',
        units: [
            { id: 1, ownerSlot: 0, modelIndex: 0, px: 0, py: 60, pz: 0 },
            { id: 2, ownerSlot: 0, modelIndex: 1, px: 2, py: 60, pz: 0 }
        ]
    });

    const room = server.getRoom(roomId);
    await waitForRunning(room);

    return { server, relay, hostWs, hostClient, room, channel };
}

/**
 * Bootstrap a room WITHOUT physics (for gate tests).
 */
function bootstrapNoPhysicsRoom(roomId = 'no-phys-room') {
    resetEntityIdCounter();

    const server = new GameServer({ tickRate: 20, enablePhysics: false });
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

    // Host sends manifest
    relay._broadcast(hostWs, hostClient, channel, {
        type: 'SPAWN_MANIFEST',
        units: [
            { id: 1, ownerSlot: 0, modelIndex: 0, px: 0, py: 60, pz: 0 }
        ]
    });

    const room = server.getRoom(roomId);
    return { server, relay, hostWs, hostClient, room, channel };
}

// ========================================
// Action Tests (require physics)
// ========================================

describe('CMD_ADMIN action tests', () => {
    let env;

    afterEach(() => {
        if (env?.server) env.server.stop();
    });

    it('TRIGGER_EXPLOSION → nearby unit enters DYNAMIC mode', async () => {
        env = await bootstrapPhysicsRoom('explode-room');
        const unit1 = env.room.units.find(u => u.id === 1);
        const unit2 = env.room.units.find(u => u.id === 2);
        expect(unit1).toBeDefined();
        expect(unit2).toBeDefined();
        expect(unit2.physicsMode).toBe('KINEMATIC');

        // Explode centered on unit 1 — unit 2 is nearby (within radius 8)
        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'CMD_ADMIN',
            action: 'TRIGGER_EXPLOSION',
            unitId: 1,
            radius: 8,
            strength: 6
        });

        // Unit at center is skipped (zero distance), but nearby unit goes DYNAMIC
        expect(unit2.physicsMode).toBe('DYNAMIC');
    });

    it('PLACE_MINE → mine registered in CollisionService', async () => {
        env = await bootstrapPhysicsRoom('mine-room');
        const minesBefore = env.room.collisions._mines.size;

        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'CMD_ADMIN',
            action: 'PLACE_MINE',
            unitId: 1
        });

        expect(env.room.collisions._mines.size).toBe(minesBefore + 1);
    });

    it('SPAWN_ROCK → obstacle in Room._obstacles', async () => {
        env = await bootstrapPhysicsRoom('rock-room');
        expect(env.room._obstacles.size).toBe(0);

        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'CMD_ADMIN',
            action: 'SPAWN_ROCK',
            unitId: 1
        });

        expect(env.room._obstacles.size).toBe(1);
    });
});

// ========================================
// Security Gate Tests
// ========================================

describe('CMD_ADMIN security gates', () => {
    let env;

    afterEach(() => {
        if (env?.server) env.server.stop();
    });

    it('rejects CMD_ADMIN from non-host (slot > 0)', async () => {
        env = await bootstrapPhysicsRoom('gate-nonhost');

        // Add a guest client
        const guestWs = createMockWs();
        const guestClient = { id: 2 };
        env.relay.clients.set(guestWs, guestClient);
        subscribeToChannel(env.relay, env.channel, guestWs);

        // Map guest to slot 1
        env.server._clientSlots.set(2, { roomId: 'gate-nonhost', slot: 1 });

        const minesBefore = env.room.collisions._mines.size;

        // Guest tries CMD_ADMIN — should be silently rejected
        env.relay._broadcast(guestWs, guestClient, env.channel, {
            type: 'CMD_ADMIN',
            action: 'PLACE_MINE',
            unitId: 1
        });

        expect(env.room.collisions._mines.size).toBe(minesBefore);
    });

    it('rejects CMD_ADMIN from unauthenticated client', async () => {
        env = await bootstrapPhysicsRoom('gate-unauth');

        // Unknown client (not in _clientSlots)
        const unknownWs = createMockWs();
        const unknownClient = { id: 99 };

        const minesBefore = env.room.collisions._mines.size;

        env.relay._broadcast(unknownWs, unknownClient, env.channel, {
            type: 'CMD_ADMIN',
            action: 'PLACE_MINE',
            unitId: 1
        });

        expect(env.room.collisions._mines.size).toBe(minesBefore);
    });

    it('unknown action → no crash', async () => {
        env = await bootstrapPhysicsRoom('gate-unknown');

        // Should not throw
        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'CMD_ADMIN',
            action: 'TOTALLY_FAKE_ACTION',
            unitId: 1
        });

        // Room still running
        expect(env.room.state).toBe('RUNNING');
    });

    it('malformed payload → no crash', async () => {
        env = await bootstrapPhysicsRoom('gate-malformed');

        // Missing action field
        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'CMD_ADMIN'
        });

        // unitId is a string instead of number
        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'CMD_ADMIN',
            action: 'TRIGGER_EXPLOSION',
            unitId: 'not-a-number'
        });

        // Room still running
        expect(env.room.state).toBe('RUNNING');
    });

    it('rejects CMD_ADMIN when enablePhysics=false', async () => {
        env = bootstrapNoPhysicsRoom('gate-nophysics');

        // Room is not RUNNING (physics init is async, won't start without physics path)
        // But the _assertDevAllowed check happens before room lookup, so it's rejected at gate level
        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'CMD_ADMIN',
            action: 'TRIGGER_EXPLOSION',
            unitId: 1
        });

        // No crash — and since enablePhysics=false, room has no collisions
        expect(env.room.collisions).toBeNull();
    });
});
