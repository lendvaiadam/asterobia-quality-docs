/**
 * Netcode Integration: Loopback Tests
 *
 * End-to-end integration tests for the authoritative server loop:
 * GameServer + Room + HeadlessUnit + MemoryTransport + CommandQueue
 *
 * All tests run in-process using MemoryTransport (no real network).
 * Room ticks are driven deterministically via direct _onSimTick() calls
 * (no setInterval).
 *
 * Run: npx vitest run tests/integration/netcode/loopback.test.js
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameServer } from '../../../server/GameServer.js';
import { Room } from '../../../server/Room.js';
import { HeadlessUnit } from '../../../server/HeadlessUnit.js';
import { MemoryTransportHub } from '../../../src/SimCore/transport/MemoryTransport.js';
import { CommandQueue, CommandType } from '../../../src/SimCore/runtime/CommandQueue.js';
import { resetEntityIdCounter } from '../../../src/SimCore/runtime/IdGenerator.js';

// ========================================
// Helper: Deterministic tick driver
// ========================================

/**
 * Manually tick a room N times at its fixed timestep.
 * Bypasses setInterval for deterministic testing.
 *
 * @param {Room} room - The room to tick
 * @param {number} count - Number of ticks to execute
 * @param {number} [dtSec] - Override fixed timestep (default: room's fixedDtSec)
 */
function tickRoom(room, count, dtSec) {
    const dt = dtSec ?? room.simLoop.fixedDtSec;
    for (let i = 0; i < count; i++) {
        const tickNumber = room.simLoop.tickCount + 1;
        room._onSimTick(dt, tickNumber);
        room.simLoop.tickCount = tickNumber;
    }
}

// ========================================
// 1. Server boots and creates room
// ========================================

describe('Netcode Integration: Loopback', () => {
    let server;
    let hub;
    let serverEndpoint, client1Endpoint, client2Endpoint;
    let room;

    beforeEach(() => {
        // Reset deterministic ID counter for reproducible test runs
        resetEntityIdCounter();

        server = new GameServer({ tickRate: 20 });
        hub = new MemoryTransportHub();
        serverEndpoint = hub.createEndpoint('server');
        client1Endpoint = hub.createEndpoint('client1');
        client2Endpoint = hub.createEndpoint('client2');

        // Connect all endpoints
        serverEndpoint.connect();
        client1Endpoint.connect();
        client2Endpoint.connect();

        room = server.createRoom('test-room');
    });

    afterEach(() => {
        // Clean up: stop room if running, stop server
        if (room && room.state === 'RUNNING') {
            room.stop();
        }
        server?.stop?.();
        serverEndpoint?.disconnect();
        client1Endpoint?.disconnect();
        client2Endpoint?.disconnect();
    });

    // ========================================
    // Test 1: Server boots and creates room
    // ========================================

    describe('1. Server boots and creates room', () => {
        it('creates a GameServer with correct tick rate', () => {
            expect(server.tickRate).toBe(20);
            expect(server.isRunning).toBe(false);
        });

        it('creates a room in WAITING state', () => {
            expect(room).toBeInstanceOf(Room);
            expect(room.roomId).toBe('test-room');
            expect(room.state).toBe('WAITING');
        });

        it('room is registered in server.rooms', () => {
            expect(server.rooms.size).toBe(1);
            expect(server.getRoom('test-room')).toBe(room);
        });

        it('room has empty player list and unit list', () => {
            expect(room.players.size).toBe(0);
            expect(room.units.length).toBe(0);
        });

        it('rejects duplicate room IDs', () => {
            expect(() => server.createRoom('test-room')).toThrow('Room test-room already exists');
        });
    });

    // ========================================
    // Test 2: Two clients join a room
    // ========================================

    describe('2. Two clients join a room', () => {
        it('adds two players with correct slots and names', () => {
            const slot1 = room.addPlayer('player-1', 'Alice', client1Endpoint);
            const slot2 = room.addPlayer('player-2', 'Bob', client2Endpoint);

            expect(slot1).toBe(1);
            expect(slot2).toBe(2);
            expect(room.players.size).toBe(2);
        });

        it('stores player info correctly', () => {
            room.addPlayer('player-1', 'Alice', client1Endpoint);
            room.addPlayer('player-2', 'Bob', client2Endpoint);

            const p1 = room.players.get(1);
            const p2 = room.players.get(2);

            expect(p1.id).toBe('player-1');
            expect(p1.name).toBe('Alice');
            expect(p1.endpoint).toBe(client1Endpoint);

            expect(p2.id).toBe('player-2');
            expect(p2.name).toBe('Bob');
            expect(p2.endpoint).toBe(client2Endpoint);
        });

        it('all endpoints join the same session channel', async () => {
            const channel = 'asterobia:session:test';

            await serverEndpoint.joinChannel(channel, () => {});
            await client1Endpoint.joinChannel(channel, () => {});
            await client2Endpoint.joinChannel(channel, () => {});

            expect(serverEndpoint.isJoinedToChannel(channel)).toBe(true);
            expect(client1Endpoint.isJoinedToChannel(channel)).toBe(true);
            expect(client2Endpoint.isJoinedToChannel(channel)).toBe(true);
        });

        it('rejects players when room is full', () => {
            const smallRoom = server.createRoom('small-room', { maxPlayers: 2 });
            smallRoom.addPlayer('p1', 'A', client1Endpoint);
            smallRoom.addPlayer('p2', 'B', client2Endpoint);

            const ep3 = hub.createEndpoint('client3');
            ep3.connect();

            expect(() => smallRoom.addPlayer('p3', 'C', ep3)).toThrow('full');
            ep3.disconnect();
        });
    });

    // ========================================
    // Test 3: Room starts and ticks
    // ========================================

    describe('3. Room ticks deterministically', () => {
        beforeEach(() => {
            room.addPlayer('player-1', 'Alice', client1Endpoint);
            room.addPlayer('player-2', 'Bob', client2Endpoint);
        });

        it('tick count advances correctly', () => {
            expect(room.simLoop.getTickCount()).toBe(0);

            tickRoom(room, 5);

            expect(room.simLoop.getTickCount()).toBe(5);
        });

        it('snapshot reflects tick count', () => {
            tickRoom(room, 10);

            const snapshot = room.getSnapshot();
            expect(snapshot.tick).toBe(10);
        });

        it('snapshot includes players', () => {
            tickRoom(room, 1);

            const snapshot = room.getSnapshot();
            expect(snapshot.players.length).toBe(2);
            expect(snapshot.players[0][0]).toBe(1); // slot 1
            expect(snapshot.players[0][1].name).toBe('Alice');
            expect(snapshot.players[1][0]).toBe(2); // slot 2
            expect(snapshot.players[1][1].name).toBe('Bob');
        });

        it('snapshot includes units with correct data', () => {
            const unit = new HeadlessUnit(1, 1);
            unit.position = { x: 10, y: 20, z: 30 };
            room.units.push(unit);

            tickRoom(room, 1);

            const snapshot = room.getSnapshot();
            expect(snapshot.units.length).toBe(1);
            expect(snapshot.units[0].id).toBe(1);
            expect(snapshot.units[0].ownerSlot).toBe(1);
            expect(snapshot.units[0].px).toBe(10);
            expect(snapshot.units[0].py).toBe(20);
            expect(snapshot.units[0].pz).toBe(30);
        });

        it('unit position updates with velocity on tick', () => {
            const unit = new HeadlessUnit(1, 1);
            // Start on sphere surface (spherical movement reprojects to terrain)
            unit.position = { x: 60, y: 0, z: 0 };
            unit.velocity = { x: 0, y: 0, z: 10 };
            unit.speed = 10; // Must be > 0 for position update
            room.units.push(unit);

            const startPos = { ...unit.position };
            tickRoom(room, 1);

            // Unit should have moved (position changed from start)
            const moved = Math.sqrt(
                (unit.position.x - startPos.x) ** 2 +
                (unit.position.y - startPos.y) ** 2 +
                (unit.position.z - startPos.z) ** 2
            );
            expect(moved).toBeGreaterThan(0);
            // Unit stays near sphere surface (~60 radius)
            const dist = Math.sqrt(unit.position.x ** 2 + unit.position.y ** 2 + unit.position.z ** 2);
            expect(dist).toBeGreaterThan(50);
            expect(dist).toBeLessThan(70);
        });

        it('unit with speed=0 does not move', () => {
            const unit = new HeadlessUnit(1, 1);
            unit.position = { x: 5, y: 5, z: 5 };
            unit.velocity = { x: 100, y: 100, z: 100 };
            unit.speed = 0; // speed=0 means no movement update
            room.units.push(unit);

            tickRoom(room, 10);

            expect(unit.position.x).toBe(5);
            expect(unit.position.y).toBe(5);
            expect(unit.position.z).toBe(5);
        });
    });

    // ========================================
    // Test 4: Client sends input command, server processes it
    // ========================================

    describe('4. Client sends input command, server processes it', () => {
        beforeEach(() => {
            room.addPlayer('player-1', 'Alice', client1Endpoint);
            room.addPlayer('player-2', 'Bob', client2Endpoint);
        });

        it('receiveInput enqueues command in commandQueue', () => {
            room.receiveInput(1, {
                type: CommandType.MOVE,
                unitId: 1,
                targetX: 100,
                targetZ: 200
            });

            expect(room.commandQueue.pendingCount).toBe(1);
        });

        it('command is tagged with sourceSlot', () => {
            room.receiveInput(1, {
                type: CommandType.MOVE,
                unitId: 1
            });

            const pending = room.commandQueue.getPending();
            expect(pending[0].sourceSlot).toBe(1);
        });

        it('flush returns commands after tick', () => {
            room.receiveInput(1, {
                type: CommandType.MOVE,
                unitId: 1
            });

            tickRoom(room, 1);

            // After tick, command should be in history (processed)
            expect(room.commandQueue.pendingCount).toBe(0);
            expect(room.commandQueue.historyCount).toBe(1);
        });

        it('command history records processedAtTick', () => {
            room.receiveInput(1, {
                type: CommandType.MOVE,
                unitId: 1
            });

            tickRoom(room, 1);

            const history = room.commandQueue.getRecentHistory(1);
            expect(history[0].processedAtTick).toBe(1);
            expect(history[0].type).toBe(CommandType.MOVE);
            expect(history[0].sourceSlot).toBe(1);
        });
    });

    // ========================================
    // Test 5: Server broadcasts snapshot to clients via MemoryTransport
    // ========================================

    describe('5. Server broadcasts snapshot to clients via MemoryTransport', () => {
        const SESSION_CHANNEL = 'asterobia:session:test';

        beforeEach(async () => {
            room.addPlayer('player-1', 'Alice', client1Endpoint);
            room.addPlayer('player-2', 'Bob', client2Endpoint);

            // All endpoints join session channel
            await serverEndpoint.joinChannel(SESSION_CHANNEL, () => {});
            await client1Endpoint.joinChannel(SESSION_CHANNEL, () => {});
            await client2Endpoint.joinChannel(SESSION_CHANNEL, () => {});
        });

        it('both clients receive snapshot broadcast from server', async () => {
            const client1Received = [];
            const client2Received = [];

            // Replace channel callbacks to capture messages
            // (leaveChannel + rejoin with new callback)
            await client1Endpoint.leaveChannel(SESSION_CHANNEL);
            await client2Endpoint.leaveChannel(SESSION_CHANNEL);
            await client1Endpoint.joinChannel(SESSION_CHANNEL, (msg) => client1Received.push(msg));
            await client2Endpoint.joinChannel(SESSION_CHANNEL, (msg) => client2Received.push(msg));

            // Tick room and broadcast snapshot
            tickRoom(room, 3);
            const snapshot = room.getSnapshot();

            await serverEndpoint.broadcastToChannel(SESSION_CHANNEL, {
                type: 'STATE_SYNC',
                snapshot
            });

            // Both clients should receive
            expect(client1Received.length).toBe(1);
            expect(client2Received.length).toBe(1);

            expect(client1Received[0].type).toBe('STATE_SYNC');
            expect(client1Received[0].snapshot.tick).toBe(3);

            expect(client2Received[0].type).toBe('STATE_SYNC');
            expect(client2Received[0].snapshot.tick).toBe(3);
        });

        it('server does NOT receive its own broadcast', async () => {
            const serverReceived = [];

            await serverEndpoint.leaveChannel(SESSION_CHANNEL);
            await serverEndpoint.joinChannel(SESSION_CHANNEL, (msg) => serverReceived.push(msg));

            const snapshot = room.getSnapshot();
            await serverEndpoint.broadcastToChannel(SESSION_CHANNEL, {
                type: 'STATE_SYNC',
                snapshot
            });

            // Server should NOT receive its own message (Supabase broadcast semantics)
            expect(serverReceived.length).toBe(0);
        });

        it('snapshot data matches room state', async () => {
            const unit = new HeadlessUnit(42, 1);
            unit.position = { x: 5, y: 10, z: 15 };
            unit.hp = 80;
            room.units.push(unit);

            const received = [];
            await client1Endpoint.leaveChannel(SESSION_CHANNEL);
            await client1Endpoint.joinChannel(SESSION_CHANNEL, (msg) => received.push(msg));

            tickRoom(room, 7);
            const snapshot = room.getSnapshot();

            await serverEndpoint.broadcastToChannel(SESSION_CHANNEL, {
                type: 'STATE_SYNC',
                snapshot
            });

            expect(received.length).toBe(1);
            const snap = received[0].snapshot;
            expect(snap.tick).toBe(7);
            expect(snap.units.length).toBe(1);
            expect(snap.units[0].id).toBe(42);
            expect(snap.units[0].hp).toBe(80);
            expect(snap.units[0].px).toBe(5);
            expect(snap.units[0].py).toBe(10);
            expect(snap.units[0].pz).toBe(15);
            expect(snap.players.length).toBe(2);
        });
    });

    // ========================================
    // Test 6: Two clients send simultaneous inputs
    // ========================================

    describe('6. Two clients send simultaneous inputs', () => {
        beforeEach(() => {
            room.addPlayer('player-1', 'Alice', client1Endpoint);
            room.addPlayer('player-2', 'Bob', client2Endpoint);
        });

        it('both commands are enqueued', () => {
            room.receiveInput(1, {
                type: CommandType.MOVE,
                unitId: 1,
                targetX: 50,
                targetZ: 50
            });

            room.receiveInput(2, {
                type: CommandType.MOVE,
                unitId: 2,
                targetX: -50,
                targetZ: -50
            });

            expect(room.commandQueue.pendingCount).toBe(2);
        });

        it('both commands are processed in same tick', () => {
            room.receiveInput(1, {
                type: CommandType.MOVE,
                unitId: 1,
                targetX: 50,
                targetZ: 50
            });

            room.receiveInput(2, {
                type: CommandType.MOVE,
                unitId: 2,
                targetX: -50,
                targetZ: -50
            });

            tickRoom(room, 1);

            expect(room.commandQueue.pendingCount).toBe(0);
            expect(room.commandQueue.historyCount).toBe(2);

            const history = room.commandQueue.getRecentHistory(2);
            // Both processed at tick 1
            expect(history[0].processedAtTick).toBe(1);
            expect(history[1].processedAtTick).toBe(1);
        });

        it('commands maintain deterministic ordering by sequence number', () => {
            room.receiveInput(1, {
                type: CommandType.MOVE,
                unitId: 1,
                targetX: 50,
                targetZ: 50
            });

            room.receiveInput(2, {
                type: CommandType.MOVE,
                unitId: 2,
                targetX: -50,
                targetZ: -50
            });

            tickRoom(room, 1);

            const history = room.commandQueue.getRecentHistory(2);
            // getRecentHistory returns newest first, so reverse for seq order
            const inOrder = [...history].reverse();
            // seq numbers should be ascending (deterministic ordering)
            expect(inOrder[0].seq).toBeLessThan(inOrder[1].seq);
        });

        it('commands from different ticks are processed separately', () => {
            room.receiveInput(1, {
                type: CommandType.MOVE,
                unitId: 1,
                targetX: 10,
                targetZ: 10
            });

            tickRoom(room, 1);

            room.receiveInput(2, {
                type: CommandType.MOVE,
                unitId: 2,
                targetX: 20,
                targetZ: 20
            });

            tickRoom(room, 1);

            expect(room.commandQueue.historyCount).toBe(2);

            const history = room.commandQueue.getRecentHistory(2);
            // Most recent first
            expect(history[0].processedAtTick).toBe(2);
            expect(history[0].sourceSlot).toBe(2);
            expect(history[1].processedAtTick).toBe(1);
            expect(history[1].sourceSlot).toBe(1);
        });
    });

    // ========================================
    // Test 7: Client disconnects gracefully
    // ========================================

    describe('7. Client disconnects gracefully', () => {
        beforeEach(() => {
            room.addPlayer('player-1', 'Alice', client1Endpoint);
            room.addPlayer('player-2', 'Bob', client2Endpoint);
        });

        it('removePlayer removes the player from room', () => {
            expect(room.players.size).toBe(2);

            room.removePlayer(2);

            expect(room.players.size).toBe(1);
            expect(room.players.has(1)).toBe(true);
            expect(room.players.has(2)).toBe(false);
        });

        it('remaining player still functional after disconnect', () => {
            room.removePlayer(2);

            // Remaining player can still send inputs
            room.receiveInput(1, {
                type: CommandType.MOVE,
                unitId: 1,
                targetX: 100,
                targetZ: 100
            });

            tickRoom(room, 1);

            expect(room.commandQueue.historyCount).toBe(1);
            expect(room.commandQueue.getRecentHistory(1)[0].sourceSlot).toBe(1);
        });

        it('snapshot reflects disconnected player removal', () => {
            room.removePlayer(2);

            const snapshot = room.getSnapshot();
            expect(snapshot.players.length).toBe(1);
            expect(snapshot.players[0][0]).toBe(1);
            expect(snapshot.players[0][1].name).toBe('Alice');
        });

        it('room continues ticking after player disconnect', () => {
            const unit = new HeadlessUnit(1, 1);
            // Start on sphere surface with tangential velocity
            unit.position = { x: 60, y: 0, z: 0 };
            unit.velocity = { x: 0, y: 0, z: 20 };
            unit.speed = 20;
            room.units.push(unit);

            const startPos = { ...unit.position };
            room.removePlayer(2);

            tickRoom(room, 5);

            expect(room.simLoop.getTickCount()).toBe(5);
            // Unit should have moved from start position
            const moved = Math.sqrt(
                (unit.position.x - startPos.x) ** 2 +
                (unit.position.y - startPos.y) ** 2 +
                (unit.position.z - startPos.z) ** 2
            );
            expect(moved).toBeGreaterThan(0);
        });

        it('transport endpoint disconnect cleans up channels', async () => {
            const channel = 'asterobia:session:test';
            await client2Endpoint.joinChannel(channel, () => {});

            expect(client2Endpoint.isJoinedToChannel(channel)).toBe(true);

            client2Endpoint.disconnect();

            expect(client2Endpoint.isConnected).toBe(false);
            expect(client2Endpoint.joinedChannels.length).toBe(0);
        });
    });

    // ========================================
    // Test 8: Determinism check - same inputs produce same state
    // ========================================

    describe('8. Determinism check: same inputs produce same state', () => {
        it('two rooms with identical inputs produce identical snapshots', () => {
            // Create two independent rooms
            const roomA = server.createRoom('determinism-A');
            const roomB = server.createRoom('determinism-B');

            // Add same players to both
            roomA.addPlayer('p1', 'Alice', client1Endpoint);
            roomA.addPlayer('p2', 'Bob', client2Endpoint);
            roomB.addPlayer('p1', 'Alice', client1Endpoint);
            roomB.addPlayer('p2', 'Bob', client2Endpoint);

            // Add identical units to both rooms
            const unitA = new HeadlessUnit(100, 1);
            unitA.position = { x: 0, y: 0, z: 0 };
            unitA.velocity = { x: 5, y: 0, z: 3 };
            unitA.speed = 5;
            roomA.units.push(unitA);

            const unitB = new HeadlessUnit(100, 1);
            unitB.position = { x: 0, y: 0, z: 0 };
            unitB.velocity = { x: 5, y: 0, z: 3 };
            unitB.speed = 5;
            roomB.units.push(unitB);

            // Send identical commands to both rooms
            const moveCmd = {
                type: CommandType.MOVE,
                unitId: 100,
                targetX: 50,
                targetZ: 50
            };

            roomA.receiveInput(1, { ...moveCmd });
            roomB.receiveInput(1, { ...moveCmd });

            // Tick both rooms the same number of times
            const TICK_COUNT = 20;
            tickRoom(roomA, TICK_COUNT);
            tickRoom(roomB, TICK_COUNT);

            // Snapshots should be identical
            const snapA = roomA.getSnapshot();
            const snapB = roomB.getSnapshot();

            // Tick count must match
            expect(snapA.tick).toBe(snapB.tick);
            expect(snapA.tick).toBe(TICK_COUNT);

            // Unit positions must be identical
            expect(snapA.units.length).toBe(snapB.units.length);
            expect(snapA.units[0].px).toBe(snapB.units[0].px);
            expect(snapA.units[0].py).toBe(snapB.units[0].py);
            expect(snapA.units[0].pz).toBe(snapB.units[0].pz);
            expect(snapA.units[0].vx).toBe(snapB.units[0].vx);
            expect(snapA.units[0].vy).toBe(snapB.units[0].vy);
            expect(snapA.units[0].vz).toBe(snapB.units[0].vz);

            // Player lists must match
            expect(snapA.players.length).toBe(snapB.players.length);

            // Clean up
            roomA.stop();
            roomB.stop();
        });

        it('unit positions are deterministic over many ticks', () => {
            const roomA = server.createRoom('det-pos-A');
            const roomB = server.createRoom('det-pos-B');

            // Create identical multi-unit setups
            for (let i = 1; i <= 5; i++) {
                const uA = new HeadlessUnit(i, i % 2 === 0 ? 2 : 1);
                uA.position = { x: i * 10, y: 0, z: i * 5 };
                uA.velocity = { x: i * 2, y: 0, z: -i };
                uA.speed = i * 2;
                roomA.units.push(uA);

                const uB = new HeadlessUnit(i, i % 2 === 0 ? 2 : 1);
                uB.position = { x: i * 10, y: 0, z: i * 5 };
                uB.velocity = { x: i * 2, y: 0, z: -i };
                uB.speed = i * 2;
                roomB.units.push(uB);
            }

            // Tick both 100 times
            const TICK_COUNT = 100;
            tickRoom(roomA, TICK_COUNT);
            tickRoom(roomB, TICK_COUNT);

            const snapA = roomA.getSnapshot();
            const snapB = roomB.getSnapshot();

            // Verify every unit matches exactly
            for (let i = 0; i < 5; i++) {
                expect(snapA.units[i].px).toBe(snapB.units[i].px);
                expect(snapA.units[i].py).toBe(snapB.units[i].py);
                expect(snapA.units[i].pz).toBe(snapB.units[i].pz);
                expect(snapA.units[i].vx).toBe(snapB.units[i].vx);
                expect(snapA.units[i].vy).toBe(snapB.units[i].vy);
                expect(snapA.units[i].vz).toBe(snapB.units[i].vz);
            }

            roomA.stop();
            roomB.stop();
        });

        it('command processing order is deterministic', () => {
            const roomA = server.createRoom('det-cmd-A');
            const roomB = server.createRoom('det-cmd-B');

            roomA.addPlayer('p1', 'Alice', client1Endpoint);
            roomA.addPlayer('p2', 'Bob', client2Endpoint);
            roomB.addPlayer('p1', 'Alice', client1Endpoint);
            roomB.addPlayer('p2', 'Bob', client2Endpoint);

            // Send same commands in same order to both rooms
            const commands = [
                { type: CommandType.MOVE, unitId: 1, targetX: 10, targetZ: 10 },
                { type: CommandType.MOVE, unitId: 2, targetX: 20, targetZ: 20 },
                { type: CommandType.SELECT, unitId: 3 },
                { type: CommandType.MOVE, unitId: 1, targetX: 30, targetZ: 30 },
            ];

            for (const cmd of commands) {
                roomA.receiveInput(1, { ...cmd });
                roomB.receiveInput(1, { ...cmd });
            }

            tickRoom(roomA, 1);
            tickRoom(roomB, 1);

            // History should be identical
            const histA = roomA.commandQueue.getRecentHistory(10);
            const histB = roomB.commandQueue.getRecentHistory(10);

            expect(histA.length).toBe(histB.length);
            for (let i = 0; i < histA.length; i++) {
                expect(histA[i].type).toBe(histB[i].type);
                expect(histA[i].unitId).toBe(histB[i].unitId);
                expect(histA[i].seq).toBe(histB[i].seq);
                expect(histA[i].processedAtTick).toBe(histB[i].processedAtTick);
            }

            roomA.stop();
            roomB.stop();
        });
    });
});
