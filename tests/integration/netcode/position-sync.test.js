/**
 * Phase 1 POSITION_SYNC Bidirectional Tests
 *
 * Verifies that both Host and Guest send/receive POSITION_SYNC,
 * so movement is visible in both directions.
 *
 * Run: npx vitest run tests/integration/netcode/position-sync.test.js
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionManager } from '../../../src/SimCore/multiplayer/SessionManager.js';
import { MSG } from '../../../src/SimCore/multiplayer/MessageTypes.js';

// ========================================
// Helpers
// ========================================

function createMockTransport() {
    return {
        send: vi.fn(),
        onMessage: vi.fn(),
        joinChannel: vi.fn().mockResolvedValue(undefined),
        leaveChannel: vi.fn().mockResolvedValue(undefined),
        broadcastToChannel: vi.fn().mockResolvedValue(undefined)
    };
}

function createMockGame(units = []) {
    return {
        clientId: 'test-client',
        _isDevMode: false,
        units,
        selectedUnit: null,
        simLoop: { tickCount: 10 },
        applyPositionSync: vi.fn()
    };
}

function createMockUnit(id, px, py, pz) {
    return {
        id,
        position: { x: px, y: py, z: pz },
        mesh: { quaternion: { x: 0, y: 0, z: 0, w: 1 } },
        isFollowingPath: false,
        pathIndex: 0,
        isPathClosed: false,
        isKeyboardOverriding: false,
        path: [],
        commands: [],
        selectedBySlot: null
    };
}

// ========================================
// Tests
// ========================================

describe('Phase 1 POSITION_SYNC: Bidirectional', () => {

    describe('Sending', () => {
        it('Host sends POSITION_SYNC', async () => {
            const unit = createMockUnit(1, 10, 20, 30);
            const game = createMockGame([unit]);
            const transport = createMockTransport();
            const sm = new SessionManager(game);
            sm.transport = transport;
            sm._sessionChannel = 'test-channel';
            sm.state.role = 'HOST';

            await sm.sendPositionSync();

            expect(transport.broadcastToChannel).toHaveBeenCalledTimes(1);
            const [channel, msg] = transport.broadcastToChannel.mock.calls[0];
            expect(channel).toBe('test-channel');
            expect(msg.type).toBe('POSITION_SYNC');
            expect(msg.units).toHaveLength(1);
            expect(msg.units[0].px).toBe(10);
            expect(msg.units[0].py).toBe(20);
            expect(msg.units[0].pz).toBe(30);
        });

        it('Guest sends POSITION_SYNC', async () => {
            const unit = createMockUnit(2, 5, 15, 25);
            const game = createMockGame([unit]);
            const transport = createMockTransport();
            const sm = new SessionManager(game);
            sm.transport = transport;
            sm._sessionChannel = 'test-channel';
            sm.state.role = 'GUEST';

            await sm.sendPositionSync();

            expect(transport.broadcastToChannel).toHaveBeenCalledTimes(1);
            const msg = transport.broadcastToChannel.mock.calls[0][1];
            expect(msg.type).toBe('POSITION_SYNC');
            expect(msg.units).toHaveLength(1);
            expect(msg.units[0].px).toBe(5);
        });

        it('Offline mode does NOT send POSITION_SYNC', async () => {
            const game = createMockGame([createMockUnit(1, 0, 0, 0)]);
            const transport = createMockTransport();
            const sm = new SessionManager(game);
            sm.transport = transport;
            sm._sessionChannel = 'test-channel';
            // Default role is OFFLINE

            await sm.sendPositionSync();

            expect(transport.broadcastToChannel).not.toHaveBeenCalled();
        });
    });

    describe('Receiving', () => {
        it('Host receives and applies Guest POSITION_SYNC', () => {
            const game = createMockGame();
            const sm = new SessionManager(game);
            sm.state.role = 'HOST';

            const msg = {
                type: MSG.POSITION_SYNC,
                tick: 5,
                units: [{ id: 2, px: 1, py: 2, pz: 3 }],
                timestamp: Date.now()
            };

            sm._handlePositionSync(msg);

            expect(game.applyPositionSync).toHaveBeenCalledTimes(1);
            expect(game.applyPositionSync).toHaveBeenCalledWith(msg);
        });

        it('Guest receives and applies Host POSITION_SYNC', () => {
            const game = createMockGame();
            const sm = new SessionManager(game);
            sm.state.role = 'GUEST';

            const msg = {
                type: MSG.POSITION_SYNC,
                tick: 5,
                units: [{ id: 1, px: 10, py: 20, pz: 30 }],
                timestamp: Date.now()
            };

            sm._handlePositionSync(msg);

            expect(game.applyPositionSync).toHaveBeenCalledTimes(1);
            expect(game.applyPositionSync).toHaveBeenCalledWith(msg);
        });

        it('Offline mode does NOT process POSITION_SYNC', () => {
            const game = createMockGame();
            const sm = new SessionManager(game);
            // Default role is OFFLINE

            sm._handlePositionSync({
                type: MSG.POSITION_SYNC,
                tick: 5,
                units: [{ id: 1, px: 0, py: 0, pz: 0 }]
            });

            expect(game.applyPositionSync).not.toHaveBeenCalled();
        });
    });

    describe('End-to-end bidirectional flow', () => {
        it('Host and Guest both send units with correct positions', async () => {
            // Host side
            const hostUnit = createMockUnit(1, 100, 200, 300);
            const guestUnit = createMockUnit(2, 50, 60, 70);
            const hostGame = createMockGame([hostUnit, guestUnit]);
            const hostTransport = createMockTransport();
            const hostSm = new SessionManager(hostGame);
            hostSm.transport = hostTransport;
            hostSm._sessionChannel = 'session';
            hostSm.state.role = 'HOST';

            // Guest side
            const guestGame = createMockGame([
                createMockUnit(1, 100, 200, 300),  // Host's unit (stale local copy)
                createMockUnit(2, 55, 65, 75)       // Guest's unit (moved)
            ]);
            const guestTransport = createMockTransport();
            const guestSm = new SessionManager(guestGame);
            guestSm.transport = guestTransport;
            guestSm._sessionChannel = 'session';
            guestSm.state.role = 'GUEST';

            // Both send
            await hostSm.sendPositionSync();
            await guestSm.sendPositionSync();

            // Both sent a POSITION_SYNC message
            expect(hostTransport.broadcastToChannel).toHaveBeenCalledTimes(1);
            expect(guestTransport.broadcastToChannel).toHaveBeenCalledTimes(1);

            const hostMsg = hostTransport.broadcastToChannel.mock.calls[0][1];
            const guestMsg = guestTransport.broadcastToChannel.mock.calls[0][1];

            // Simulate cross-delivery: Host receives Guest's message
            hostSm._handlePositionSync(guestMsg);
            expect(hostGame.applyPositionSync).toHaveBeenCalledWith(guestMsg);

            // Guest receives Host's message
            guestSm._handlePositionSync(hostMsg);
            expect(guestGame.applyPositionSync).toHaveBeenCalledWith(hostMsg);
        });
    });
});
