/**
 * Security Hardening Tests
 *
 * Verifies server-side defenses against the four critical threat vectors:
 *   1. JOIN_ACK spoofing (guest impersonating host to spawn phantom units)
 *   2. Manifest abuse (OOM via oversized manifest, invalid ownerSlot)
 *   3. Broadcast amplification (oversized payloads relayed to N clients)
 *   4. Rate limiting (message flood protection)
 *
 * All tests run in-process. No real WebSockets.
 *
 * Run: npx vitest run tests/integration/netcode/security-hardening.test.js
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameServer } from '../../../server/GameServer.js';
import { WsRelay } from '../../../server/WsRelay.js';
import { resetEntityIdCounter } from '../../../src/SimCore/runtime/IdGenerator.js';

// ========================================
// Mock Infrastructure (reused from phase2a-lifecycle tests)
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
 * Bootstrap a standard host+guest test scenario.
 * Returns { server, relay, hostWs, hostClient, guestWs, guestClient, room }.
 */
function bootstrapRoom(roomId = 'sec-room-1', options = {}) {
    resetEntityIdCounter();

    const server = new GameServer({ tickRate: 20, ...options });
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

    // Host announces
    relay._broadcast(hostWs, hostClient, channel, {
        type: 'HOST_ANNOUNCE',
        hostId: roomId,
        hostDisplayName: 'TestHost'
    });

    // Host sends manifest (2 units, valid)
    relay._broadcast(hostWs, hostClient, channel, {
        type: 'SPAWN_MANIFEST',
        units: [
            { id: 1, ownerSlot: 0, modelIndex: 0, px: 0, py: 60, pz: 0 },
            { id: 2, ownerSlot: 0, modelIndex: 1, px: 60, py: 0, pz: 0 }
        ]
    });

    const room = server.getRoom(roomId);
    return { server, relay, hostWs, hostClient, guestWs, guestClient, room, channel };
}

// ========================================
// 1) JOIN_ACK Spoofing
// ========================================

describe('Security: JOIN_ACK host-only gate', () => {
    let env;

    beforeEach(() => {
        env = bootstrapRoom();
    });

    afterEach(() => {
        env.server.stop();
    });

    it('accepts JOIN_ACK from authenticated host (slot 0)', () => {
        const unitsBefore = env.room.units.length;

        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'JOIN_ACK',
            accepted: true,
            assignedSlot: 1
        });

        expect(env.room.units.length).toBe(unitsBefore + 1);
        const guestUnit = env.room.units[env.room.units.length - 1];
        expect(guestUnit.ownerSlot).toBe(1);
    });

    it('rejects JOIN_ACK from guest (not slot 0) — no phantom unit created', () => {
        const unitsBefore = env.room.units.length;

        // Guest tries to send JOIN_ACK — should be rejected
        env.relay._broadcast(env.guestWs, env.guestClient, env.channel, {
            type: 'JOIN_ACK',
            accepted: true,
            assignedSlot: 5
        });

        // No unit should have been created
        expect(env.room.units.length).toBe(unitsBefore);
    });

    it('rejects JOIN_ACK from unknown client (not in _clientSlots)', () => {
        const unitsBefore = env.room.units.length;
        const unknownWs = createMockWs();
        const unknownClient = { id: 999 };
        env.relay.clients.set(unknownWs, unknownClient);

        env.relay._broadcast(unknownWs, unknownClient, env.channel, {
            type: 'JOIN_ACK',
            accepted: true,
            assignedSlot: 3
        });

        expect(env.room.units.length).toBe(unitsBefore);
    });

    it('rejects JOIN_ACK with out-of-range slot (> maxSlot)', () => {
        const unitsBefore = env.room.units.length;

        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'JOIN_ACK',
            accepted: true,
            assignedSlot: 999
        });

        expect(env.room.units.length).toBe(unitsBefore);
    });

    it('rejects JOIN_ACK with slot 0 (cannot create guest at host slot)', () => {
        const unitsBefore = env.room.units.length;

        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'JOIN_ACK',
            accepted: true,
            assignedSlot: 0
        });

        // Slot 0 is host-only — guestSlot must be >= 1
        expect(env.room.units.length).toBe(unitsBefore);
    });

    it('rejects JOIN_ACK with non-number slot', () => {
        const unitsBefore = env.room.units.length;

        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'JOIN_ACK',
            accepted: true,
            assignedSlot: 'admin'
        });

        expect(env.room.units.length).toBe(unitsBefore);
    });
});

// ========================================
// 2) Manifest Abuse
// ========================================

describe('Security: Manifest size limit and validation', () => {
    afterEach(() => {
        resetEntityIdCounter();
    });

    it('rejects manifest exceeding maxManifestUnits', () => {
        const server = new GameServer({ tickRate: 20, maxManifestUnits: 5 });
        const relay = createMockRelay();
        server.wireToRelay(relay);
        server.start();

        const hostWs = createMockWs();
        const hostClient = { id: 1 };
        relay.clients.set(hostWs, hostClient);
        const channel = 'asterobia:session:abuse-room';
        subscribeToChannel(relay, channel, hostWs);

        relay._broadcast(hostWs, hostClient, channel, {
            type: 'HOST_ANNOUNCE',
            hostId: 'abuse-room',
            hostDisplayName: 'Abuser'
        });

        // Try to send 10 units when limit is 5
        const bigManifest = Array.from({ length: 10 }, (_, i) => ({
            id: i + 1, ownerSlot: 0, modelIndex: 0
        }));

        relay._broadcast(hostWs, hostClient, channel, {
            type: 'SPAWN_MANIFEST',
            units: bigManifest
        });

        const room = server.getRoom('abuse-room');
        // Room should still be WAITING (manifest was rejected)
        expect(room.state).toBe('WAITING');
        expect(room.units.length).toBe(0);

        server.stop();
    });

    it('accepts manifest within size limit', () => {
        const server = new GameServer({ tickRate: 20, maxManifestUnits: 5 });
        const relay = createMockRelay();
        server.wireToRelay(relay);
        server.start();

        const hostWs = createMockWs();
        const hostClient = { id: 1 };
        relay.clients.set(hostWs, hostClient);
        const channel = 'asterobia:session:ok-room';
        subscribeToChannel(relay, channel, hostWs);

        relay._broadcast(hostWs, hostClient, channel, {
            type: 'HOST_ANNOUNCE',
            hostId: 'ok-room',
            hostDisplayName: 'GoodHost'
        });

        const okManifest = Array.from({ length: 5 }, (_, i) => ({
            id: i + 1, ownerSlot: 0, modelIndex: 0
        }));

        relay._broadcast(hostWs, hostClient, channel, {
            type: 'SPAWN_MANIFEST',
            units: okManifest
        });

        const room = server.getRoom('ok-room');
        expect(room.state).toBe('RUNNING');
        expect(room.units.length).toBe(5);

        server.stop();
    });

    it('skips units with out-of-range ownerSlot', () => {
        const server = new GameServer({ tickRate: 20, maxSlot: 4 });
        const relay = createMockRelay();
        server.wireToRelay(relay);
        server.start();

        const hostWs = createMockWs();
        const hostClient = { id: 1 };
        relay.clients.set(hostWs, hostClient);
        const channel = 'asterobia:session:slot-room';
        subscribeToChannel(relay, channel, hostWs);

        relay._broadcast(hostWs, hostClient, channel, {
            type: 'HOST_ANNOUNCE',
            hostId: 'slot-room',
            hostDisplayName: 'Host'
        });

        relay._broadcast(hostWs, hostClient, channel, {
            type: 'SPAWN_MANIFEST',
            units: [
                { id: 1, ownerSlot: 0, modelIndex: 0 },   // valid
                { id: 2, ownerSlot: 4, modelIndex: 0 },   // valid (at max)
                { id: 3, ownerSlot: 5, modelIndex: 0 },   // INVALID (> maxSlot)
                { id: 4, ownerSlot: -1, modelIndex: 0 },  // INVALID (negative)
                { id: 5, ownerSlot: 999, modelIndex: 0 }  // INVALID (way out)
            ]
        });

        const room = server.getRoom('slot-room');
        expect(room.state).toBe('RUNNING');
        // Only 2 valid units should have been created
        expect(room.units.length).toBe(2);
        expect(room.units[0].ownerSlot).toBe(0);
        expect(room.units[1].ownerSlot).toBe(4);

        server.stop();
    });

    it('skips units with non-number id', () => {
        resetEntityIdCounter();
        const server = new GameServer({ tickRate: 20 });
        const relay = createMockRelay();
        server.wireToRelay(relay);
        server.start();

        const hostWs = createMockWs();
        const hostClient = { id: 1 };
        relay.clients.set(hostWs, hostClient);
        const channel = 'asterobia:session:id-room';
        subscribeToChannel(relay, channel, hostWs);

        relay._broadcast(hostWs, hostClient, channel, {
            type: 'HOST_ANNOUNCE',
            hostId: 'id-room',
            hostDisplayName: 'Host'
        });

        relay._broadcast(hostWs, hostClient, channel, {
            type: 'SPAWN_MANIFEST',
            units: [
                { id: 1, ownerSlot: 0, modelIndex: 0 },              // valid
                { id: 'evil-string', ownerSlot: 0, modelIndex: 0 },  // INVALID
                { id: null, ownerSlot: 0, modelIndex: 0 },           // INVALID
                { id: 2, ownerSlot: 0, modelIndex: 0 }               // valid
            ]
        });

        const room = server.getRoom('id-room');
        expect(room.units.length).toBe(2);
        expect(room.units[0].id).toBe(1);
        expect(room.units[1].id).toBe(2);

        server.stop();
    });

    it('rejects manifest where ALL units are invalid', () => {
        resetEntityIdCounter();
        const server = new GameServer({ tickRate: 20, maxSlot: 2 });
        const relay = createMockRelay();
        server.wireToRelay(relay);
        server.start();

        const hostWs = createMockWs();
        const hostClient = { id: 1 };
        relay.clients.set(hostWs, hostClient);
        const channel = 'asterobia:session:all-bad';
        subscribeToChannel(relay, channel, hostWs);

        relay._broadcast(hostWs, hostClient, channel, {
            type: 'HOST_ANNOUNCE',
            hostId: 'all-bad',
            hostDisplayName: 'Host'
        });

        relay._broadcast(hostWs, hostClient, channel, {
            type: 'SPAWN_MANIFEST',
            units: [
                { id: 'x', ownerSlot: 99 },  // both invalid
                { id: null, ownerSlot: -1 }   // both invalid
            ]
        });

        const room = server.getRoom('all-bad');
        // Room should remain WAITING (no valid units → rejected)
        expect(room.state).toBe('WAITING');
        expect(room.units.length).toBe(0);

        server.stop();
    });
});

// ========================================
// 3) Broadcast Amplification (WsRelay size check)
// ========================================

describe('Security: Broadcast payload size limit', () => {
    it('rejects oversized broadcast and sends error to sender', () => {
        // Create a relay with a very small maxPayload for testing
        const relay = new WsRelay({ maxPayload: 200 });

        // Manually set up clients + channels (no real WebSocket)
        const senderWs = createMockWs();
        const receiverWs = createMockWs();
        const senderClient = { id: 1, channels: new Set(['test-ch']), msgTimestamps: [] };
        const receiverClient = { id: 2, channels: new Set(['test-ch']), msgTimestamps: [] };

        relay.clients.set(senderWs, senderClient);
        relay.clients.set(receiverWs, receiverClient);
        relay.channels.set('test-ch', new Set([senderWs, receiverWs]));

        // Build an oversized payload (> 200 bytes when serialized as outMsg)
        const bigPayload = { data: 'x'.repeat(300) };

        relay._broadcast(senderWs, senderClient, 'test-ch', bigPayload);

        // Sender should get an error
        const errors = senderWs._sent.filter(m => m.type === 'error');
        expect(errors.length).toBe(1);
        expect(errors[0].message).toContain('too large');

        // Receiver should NOT have received anything
        expect(receiverWs._sent.length).toBe(0);
    });

    it('allows normal-sized broadcast', () => {
        const relay = new WsRelay({ maxPayload: 10000 });

        const senderWs = createMockWs();
        const receiverWs = createMockWs();
        const senderClient = { id: 1, channels: new Set(['test-ch']), msgTimestamps: [] };
        const receiverClient = { id: 2, channels: new Set(['test-ch']), msgTimestamps: [] };

        relay.clients.set(senderWs, senderClient);
        relay.clients.set(receiverWs, receiverClient);
        relay.channels.set('test-ch', new Set([senderWs, receiverWs]));

        const normalPayload = { type: 'MOVE_INPUT', forward: true };

        relay._broadcast(senderWs, senderClient, 'test-ch', normalPayload);

        // Receiver should get the message
        expect(receiverWs._sent.length).toBe(1);
        expect(receiverWs._sent[0].payload.type).toBe('MOVE_INPUT');

        // Sender should NOT get an error
        const errors = senderWs._sent.filter(m => m.type === 'error');
        expect(errors.length).toBe(0);
    });
});

// ========================================
// 4) Rate Limiting
// ========================================

describe('Security: Per-client rate limiting', () => {
    it('drops messages exceeding rate limit', () => {
        const relay = new WsRelay({ rateLimit: 5 });

        const ws = createMockWs();
        // Override send to track raw calls (before JSON parse)
        const rawSent = [];
        ws.send = (data) => { rawSent.push(data); };

        const client = { id: 1, channels: new Set(['ch']), msgTimestamps: [] };
        relay.clients.set(ws, client);
        relay.channels.set('ch', new Set([ws]));

        // Send 10 messages rapidly — only first 5 should be processed
        for (let i = 0; i < 10; i++) {
            relay._handleMessage(ws, JSON.stringify({
                type: 'broadcast',
                channel: 'ch',
                payload: { seq: i }
            }));
        }

        // client.msgTimestamps should have exactly 5 entries (rate limit)
        expect(client.msgTimestamps.length).toBe(5);
    });

    it('allows messages after rate window expires', () => {
        const relay = new WsRelay({ rateLimit: 3 });

        const ws = createMockWs();
        const client = { id: 1, channels: new Set(['ch']), msgTimestamps: [] };
        relay.clients.set(ws, client);
        relay.channels.set('ch', new Set([ws]));

        // Fill up rate limit
        for (let i = 0; i < 3; i++) {
            relay._handleMessage(ws, JSON.stringify({
                type: 'broadcast', channel: 'ch', payload: { seq: i }
            }));
        }
        expect(client.msgTimestamps.length).toBe(3);

        // Simulate time passing (move all timestamps to the past)
        const pastTime = Date.now() - 2000;
        client.msgTimestamps = [pastTime, pastTime, pastTime];

        // Now should accept new messages again
        relay._handleMessage(ws, JSON.stringify({
            type: 'broadcast', channel: 'ch', payload: { seq: 'after-window' }
        }));

        // Old timestamps evicted, new one added
        expect(client.msgTimestamps.length).toBe(1);
    });

    it('unlimited when rateLimit is 0', () => {
        const relay = new WsRelay({ rateLimit: 0 });

        const ws = createMockWs();
        const client = { id: 1, channels: new Set(['ch']), msgTimestamps: [] };
        relay.clients.set(ws, client);
        relay.channels.set('ch', new Set([ws]));

        // Send 50 messages — all should be processed (no rate limiting)
        for (let i = 0; i < 50; i++) {
            relay._handleMessage(ws, JSON.stringify({
                type: 'broadcast', channel: 'ch', payload: { seq: i }
            }));
        }

        // With rateLimit=0, msgTimestamps is never touched
        expect(client.msgTimestamps.length).toBe(0);
    });
});

// ========================================
// 5) Regression: existing Phase 2A lifecycle still works
// ========================================

describe('Security: Phase 2A lifecycle unbroken', () => {
    let env;

    beforeEach(() => {
        env = bootstrapRoom();
    });

    afterEach(() => {
        env.server.stop();
    });

    it('room reaches RUNNING after valid manifest from host', () => {
        expect(env.room.state).toBe('RUNNING');
        expect(env.room.units.length).toBe(2);
    });

    it('MOVE_INPUT from host still routes to unit', () => {
        const unit = env.room.units[0];
        const posBefore = { ...unit.position };

        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'MOVE_INPUT',
            forward: true
        });

        tickRoom(env.room, 5);

        // Unit should have moved
        const dist = Math.sqrt(
            (unit.position.x - posBefore.x) ** 2 +
            (unit.position.y - posBefore.y) ** 2 +
            (unit.position.z - posBefore.z) ** 2
        );
        expect(dist).toBeGreaterThan(0);
    });

    it('SERVER_SNAPSHOT still broadcasts to subscribers', () => {
        tickRoom(env.room, 1);

        // Both host and guest should receive snapshots
        const hostSnaps = env.hostWs._sent.filter(m => m.payload?.type === 'SERVER_SNAPSHOT');
        const guestSnaps = env.guestWs._sent.filter(m => m.payload?.type === 'SERVER_SNAPSHOT');

        expect(hostSnaps.length).toBeGreaterThan(0);
        expect(guestSnaps.length).toBeGreaterThan(0);
    });

    it('valid JOIN_ACK from host still creates guest unit', () => {
        const before = env.room.units.length;

        env.relay._broadcast(env.hostWs, env.hostClient, env.channel, {
            type: 'JOIN_ACK',
            accepted: true,
            assignedSlot: 2
        });

        expect(env.room.units.length).toBe(before + 1);
    });
});
