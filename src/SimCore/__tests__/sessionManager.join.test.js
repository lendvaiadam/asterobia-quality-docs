/**
 * sessionManager.join.test.js - Unit tests for SessionManager Join Flow (M06)
 *
 * Tests: R013-M06 Host Join Handling + Session Channel
 * Reference: docs/work_orders/WO-R013-M06.md
 *
 * Key Constraints Verified:
 * - Session channel creation on hostGame()
 * - JOIN_REQ validation (protocol, guestId, displayName)
 * - Slot assignment (0=Host, 1-3=Guests)
 * - JOIN_ACK response (accept/reject)
 * - Snapshot serialization and size limits
 * - Concurrent join queue (M06-R01 mitigation)
 * - Idempotency (duplicate guestId ignored)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionManager } from '../multiplayer/SessionManager.js';
import { NetworkRole } from '../multiplayer/NetworkRole.js';
import { MSG, PROTOCOL_VERSION } from '../multiplayer/MessageTypes.js';

/**
 * Mock Game object for testing
 */
function createMockGame() {
  return {
    clientId: 'host-client-id',
    mapSeed: 'test-seed-12345',
    simLoop: {
      tickCount: 100
    },
    stateSurface: {
      serialize: vi.fn(() => ({ meta: { simTick: 100 }, units: [], terrain: {} }))
    },
    _isDevMode: false
  };
}

/**
 * Mock Transport with channel support
 */
function createMockTransport() {
  const channels = new Map();
  const broadcastLog = [];

  const transport = {
    _channels: channels,
    _broadcastLog: broadcastLog,
    joinChannel: vi.fn(async (channelName, callback) => {
      channels.set(channelName, { callback });
    }),
    broadcastToChannel: vi.fn(async (channelName, msg) => {
      broadcastLog.push({ channel: channelName, msg });
    }),
    leaveChannel: vi.fn(async (channelName) => {
      channels.delete(channelName);
    }),
    isJoinedToChannel: vi.fn((channelName) => channels.has(channelName)),
    onMessage: vi.fn(),
    // Helper to simulate incoming message on a channel
    simulateMessage: function(channelName, msg) {
      const entry = channels.get(channelName);
      if (entry && entry.callback) {
        entry.callback(msg);
      }
    }
  };

  return transport;
}

/**
 * Create a valid JOIN_REQ message
 */
function createJoinReq(overrides = {}) {
  return {
    type: MSG.JOIN_REQ,
    guestId: 'guest-123',
    displayName: 'TestGuest',
    protocolVersion: PROTOCOL_VERSION,
    timestamp: Date.now(),
    ...overrides
  };
}

describe('SessionManager Join Flow (M06)', () => {
  let sessionManager;
  let mockGame;
  let mockTransport;

  beforeEach(() => {
    mockGame = createMockGame();
    mockTransport = createMockTransport();
    sessionManager = new SessionManager(mockGame);
    sessionManager.setTransport(mockTransport);
  });

  afterEach(() => {
    // Stop announce interval to prevent timer leaks
    if (sessionManager.announceInterval) {
      clearInterval(sessionManager.announceInterval);
      sessionManager.announceInterval = null;
    }
  });

  /**
   * Helper to flush async queue - waits for promises to resolve
   */
  async function flushJoinQueue() {
    // Give async operations time to complete
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  // ========================================
  // 4.2 Session Channel
  // ========================================

  describe('Session Channel', () => {
    it('joins session channel on hostGame()', async () => {
      await sessionManager.hostGame('Test Session');

      // Should join both lobby and session channels
      expect(mockTransport.joinChannel).toHaveBeenCalledWith(
        'asterobia:lobby',
        expect.any(Function)
      );
      expect(mockTransport.joinChannel).toHaveBeenCalledWith(
        `asterobia:session:${mockGame.clientId}`,
        expect.any(Function)
      );
    });

    it('stores session channel name', async () => {
      await sessionManager.hostGame('Test Session');

      expect(sessionManager._sessionChannel).toBe(`asterobia:session:${mockGame.clientId}`);
    });

    it('leaves session channel on leaveGame()', async () => {
      await sessionManager.hostGame('Test Session');
      const sessionChannel = sessionManager._sessionChannel;

      sessionManager.leaveGame();

      expect(mockTransport.leaveChannel).toHaveBeenCalledWith(sessionChannel);
      expect(sessionManager._sessionChannel).toBeNull();
    });

    it('clears join queue on leaveGame()', async () => {
      await sessionManager.hostGame('Test Session');
      sessionManager._joinQueue.push(createJoinReq());

      sessionManager.leaveGame();

      expect(sessionManager._joinQueue).toHaveLength(0);
      expect(sessionManager._processingJoin).toBe(false);
    });
  });

  // ========================================
  // 4.3 JOIN_REQ Handling
  // ========================================

  describe('_handleJoinReq validation', () => {
    beforeEach(async () => {
      await sessionManager.hostGame('Test Session');
      mockTransport.broadcastToChannel.mockClear();
    });

    it('ignores JOIN_REQ when not HOST', async () => {
      sessionManager.leaveGame(); // Reset to OFFLINE

      sessionManager.onMessage(createJoinReq());

      // Should not process
      expect(mockTransport.broadcastToChannel).not.toHaveBeenCalled();
    });

    it('rejects wrong protocolVersion', async () => {
      const msg = createJoinReq({ protocolVersion: '0.0.0' });

      sessionManager.onMessage(msg);
      await flushJoinQueue();

      expect(mockTransport.broadcastToChannel).toHaveBeenCalledWith(
        sessionManager._sessionChannel,
        expect.objectContaining({
          type: MSG.JOIN_ACK,
          accepted: false,
          rejectReason: 'VERSION_MISMATCH'
        })
      );
    });

    it('rejects missing guestId with INVALID_REQUEST', async () => {
      const msg = createJoinReq({ guestId: null });

      sessionManager.onMessage(msg);
      await flushJoinQueue();

      // Should send JOIN_ACK rejected with INVALID_REQUEST
      expect(mockTransport.broadcastToChannel).toHaveBeenCalledWith(
        sessionManager._sessionChannel,
        expect.objectContaining({
          type: MSG.JOIN_ACK,
          accepted: false,
          rejectReason: 'INVALID_REQUEST'
        })
      );
    });

    it('rejects missing displayName with INVALID_REQUEST', async () => {
      // Force displayName to be empty (bypass createJoinReq default)
      const msg = {
        type: MSG.JOIN_REQ,
        guestId: 'guest-no-name',
        displayName: '',
        protocolVersion: PROTOCOL_VERSION,
        timestamp: Date.now()
      };

      sessionManager.onMessage(msg);
      await flushJoinQueue();

      // Should send JOIN_ACK rejected with INVALID_REQUEST
      expect(mockTransport.broadcastToChannel).toHaveBeenCalledWith(
        sessionManager._sessionChannel,
        expect.objectContaining({
          type: MSG.JOIN_ACK,
          accepted: false,
          rejectReason: 'INVALID_REQUEST'
        })
      );
    });

    it('ignores duplicate guestId (idempotency)', async () => {
      const msg = createJoinReq({ guestId: 'guest-dup' });

      // First join
      sessionManager.onMessage(msg);
      await flushJoinQueue();

      mockTransport.broadcastToChannel.mockClear();

      // Second join with same guestId
      sessionManager.onMessage(msg);
      await flushJoinQueue();

      // Should not send another JOIN_ACK
      expect(mockTransport.broadcastToChannel).not.toHaveBeenCalled();
    });

    it('rejects when session full (4 players)', async () => {
      // Fill up slots 1, 2, 3
      for (let i = 1; i <= 3; i++) {
        sessionManager.state.addPlayer({
          slot: i,
          userId: `guest-${i}`,
          displayName: `Guest${i}`,
          status: 'active'
        });
      }

      mockTransport.broadcastToChannel.mockClear();

      const msg = createJoinReq({ guestId: 'guest-4' });
      sessionManager.onMessage(msg);
      await flushJoinQueue();

      expect(mockTransport.broadcastToChannel).toHaveBeenCalledWith(
        sessionManager._sessionChannel,
        expect.objectContaining({
          type: MSG.JOIN_ACK,
          accepted: false,
          rejectReason: 'SESSION_FULL'
        })
      );
    });

    it('accepts valid JOIN_REQ', async () => {
      const msg = createJoinReq();

      sessionManager.onMessage(msg);
      await flushJoinQueue();

      expect(mockTransport.broadcastToChannel).toHaveBeenCalledWith(
        sessionManager._sessionChannel,
        expect.objectContaining({
          type: MSG.JOIN_ACK,
          accepted: true,
          assignedSlot: 1 // First guest gets slot 1
        })
      );
    });
  });

  // ========================================
  // 4.4 JOIN_ACK Response
  // ========================================

  describe('JOIN_ACK response', () => {
    beforeEach(async () => {
      await sessionManager.hostGame('Test Session');
      mockTransport.broadcastToChannel.mockClear();
    });

    it('sends JOIN_ACK with slot on accept', async () => {
      sessionManager.onMessage(createJoinReq({ guestId: 'guest-a' }));
      await flushJoinQueue();

      const call = mockTransport.broadcastToChannel.mock.calls.find(
        c => c[1].type === MSG.JOIN_ACK
      );
      expect(call).toBeDefined();
      expect(call[1].accepted).toBe(true);
      expect(call[1].assignedSlot).toBe(1);
    });

    it('sends JOIN_ACK with simTick on accept', async () => {
      sessionManager.onMessage(createJoinReq());
      await flushJoinQueue();

      const call = mockTransport.broadcastToChannel.mock.calls.find(
        c => c[1].type === MSG.JOIN_ACK
      );
      expect(call[1].simTick).toBe(100);
    });

    it('sends JOIN_ACK with fullSnapshot on accept', async () => {
      sessionManager.onMessage(createJoinReq());
      await flushJoinQueue();

      const call = mockTransport.broadcastToChannel.mock.calls.find(
        c => c[1].type === MSG.JOIN_ACK
      );
      expect(call[1].fullSnapshot).toBeDefined();
      expect(call[1].fullSnapshot.meta).toBeDefined();
    });

    it('adds player to state on accept', async () => {
      sessionManager.onMessage(createJoinReq({ guestId: 'new-guest', displayName: 'NewPlayer' }));
      await flushJoinQueue();

      const player = sessionManager.state.getPlayerByUserId('new-guest');
      expect(player).toBeDefined();
      expect(player.slot).toBe(1);
      expect(player.displayName).toBe('NewPlayer');
    });

    it('sends JOIN_ACK with reason on reject', async () => {
      // Fill session
      for (let i = 1; i <= 3; i++) {
        sessionManager.state.addPlayer({
          slot: i,
          userId: `guest-${i}`,
          displayName: `Guest${i}`,
          status: 'active'
        });
      }

      mockTransport.broadcastToChannel.mockClear();

      sessionManager.onMessage(createJoinReq({ guestId: 'guest-overflow' }));
      await flushJoinQueue();

      const call = mockTransport.broadcastToChannel.mock.calls.find(
        c => c[1].type === MSG.JOIN_ACK
      );
      expect(call[1].accepted).toBe(false);
      expect(call[1].rejectReason).toBe('SESSION_FULL');
    });
  });

  // ========================================
  // 4.6 Slot Assignment
  // ========================================

  describe('Slot Assignment', () => {
    beforeEach(async () => {
      await sessionManager.hostGame('Test Session');
      mockTransport.broadcastToChannel.mockClear();
    });

    it('Host is always slot 0', async () => {
      expect(sessionManager.state.mySlot).toBe(0);
      expect(sessionManager.state.players[0].slot).toBe(0);
    });

    it('First Guest gets slot 1', async () => {
      sessionManager.onMessage(createJoinReq({ guestId: 'guest-1' }));
      await flushJoinQueue();

      const player = sessionManager.state.getPlayerByUserId('guest-1');
      expect(player.slot).toBe(1);
    });

    it('Second Guest gets slot 2', async () => {
      sessionManager.onMessage(createJoinReq({ guestId: 'guest-1' }));
      await flushJoinQueue();

      sessionManager.onMessage(createJoinReq({ guestId: 'guest-2' }));
      await flushJoinQueue();

      const player = sessionManager.state.getPlayerByUserId('guest-2');
      expect(player.slot).toBe(2);
    });

    it('Third Guest gets slot 3', async () => {
      sessionManager.onMessage(createJoinReq({ guestId: 'guest-1' }));
      await flushJoinQueue();
      sessionManager.onMessage(createJoinReq({ guestId: 'guest-2' }));
      await flushJoinQueue();
      sessionManager.onMessage(createJoinReq({ guestId: 'guest-3' }));
      await flushJoinQueue();

      const player = sessionManager.state.getPlayerByUserId('guest-3');
      expect(player.slot).toBe(3);
    });
  });

  // ========================================
  // 4.7 Snapshot Serialization
  // ========================================

  describe('Snapshot', () => {
    beforeEach(async () => {
      await sessionManager.hostGame('Test Session');
      mockTransport.broadcastToChannel.mockClear();
    });

    it('calls stateSurface.serialize()', async () => {
      sessionManager.onMessage(createJoinReq());
      await flushJoinQueue();

      expect(mockGame.stateSurface.serialize).toHaveBeenCalled();
    });

    it('warns on large snapshot (>80KB)', async () => {
      const consoleSpy = vi.spyOn(console, 'warn');
      // Create large snapshot
      const largeData = { big: 'x'.repeat(85000) };
      mockGame.stateSurface.serialize.mockReturnValue(largeData);

      sessionManager.onMessage(createJoinReq());
      await flushJoinQueue();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Snapshot large'));
    });

    it('rejects on oversized snapshot (>100KB)', async () => {
      // Create oversized snapshot
      const hugeData = { huge: 'x'.repeat(110000) };
      mockGame.stateSurface.serialize.mockReturnValue(hugeData);

      sessionManager.onMessage(createJoinReq());
      await flushJoinQueue();

      expect(mockTransport.broadcastToChannel).toHaveBeenCalledWith(
        sessionManager._sessionChannel,
        expect.objectContaining({
          type: MSG.JOIN_ACK,
          accepted: false,
          rejectReason: 'STATE_TOO_LARGE'
        })
      );
    });

    it('handles serialization error gracefully with fallback snapshot', async () => {
      // M06-R02: When serialize throws, use fallback snapshot instead of rejecting
      mockGame.stateSurface.serialize.mockImplementation(() => {
        throw new Error('Serialization failed');
      });

      sessionManager.onMessage(createJoinReq());
      await flushJoinQueue();

      // Should ACCEPT with fallback snapshot, not reject
      expect(mockTransport.broadcastToChannel).toHaveBeenCalledWith(
        sessionManager._sessionChannel,
        expect.objectContaining({
          type: MSG.JOIN_ACK,
          accepted: true,
          fullSnapshot: expect.objectContaining({
            version: 1,
            units: [],
            _fallback: true
          })
        })
      );
    });
  });

  // ========================================
  // Concurrent joins (M06-R01)
  // ========================================

  describe('Concurrent joins', () => {
    beforeEach(async () => {
      await sessionManager.hostGame('Test Session');
      mockTransport.broadcastToChannel.mockClear();
    });

    it('processes queue sequentially', async () => {
      // Send 3 JOIN_REQs rapidly
      sessionManager.onMessage(createJoinReq({ guestId: 'guest-a', displayName: 'A' }));
      sessionManager.onMessage(createJoinReq({ guestId: 'guest-b', displayName: 'B' }));
      sessionManager.onMessage(createJoinReq({ guestId: 'guest-c', displayName: 'C' }));

      await flushJoinQueue();

      // All should get unique slots
      const players = sessionManager.state.players;
      const slots = players.map(p => p.slot);
      const uniqueSlots = new Set(slots);

      expect(players.length).toBe(4); // Host + 3 guests
      expect(uniqueSlots.size).toBe(4); // All unique
    });

    it('assigns unique slots to concurrent requests', async () => {
      // Simulate rapid concurrent joins
      const joinPromises = [
        createJoinReq({ guestId: 'concurrent-1', displayName: 'C1' }),
        createJoinReq({ guestId: 'concurrent-2', displayName: 'C2' }),
        createJoinReq({ guestId: 'concurrent-3', displayName: 'C3' })
      ];

      joinPromises.forEach(msg => sessionManager.onMessage(msg));
      await flushJoinQueue();

      // Verify no slot collision
      const guestSlots = sessionManager.state.players
        .filter(p => p.userId !== mockGame.clientId)
        .map(p => p.slot);

      expect(guestSlots).toEqual([1, 2, 3]);
    });
  });

  // ========================================
  // Determinism constraints
  // ========================================

  describe('Determinism constraints', () => {
    it('join flow is META-LAYER (no SimCore mutation)', async () => {
      await sessionManager.hostGame('Test Session');
      const initialTickCount = mockGame.simLoop.tickCount;

      sessionManager.onMessage(createJoinReq());
      await flushJoinQueue();

      // SimLoop tickCount should not change
      expect(mockGame.simLoop.tickCount).toBe(initialTickCount);
    });

    it('state.players is meta-game state (not in toJSON sim state)', async () => {
      await sessionManager.hostGame('Test Session');
      sessionManager.onMessage(createJoinReq());
      await flushJoinQueue();

      const json = sessionManager.toJSON();

      // players is present in toJSON (meta-game)
      expect(json.players).toBeDefined();
      // But this is meta-game state, not sim state
      expect(json.players.length).toBe(2);
    });
  });

  // ========================================
  // Rejection reason validation (no undefined)
  // ========================================

  describe('Rejection reason validation', () => {
    beforeEach(async () => {
      await sessionManager.hostGame('Test Session');
      mockTransport.broadcastToChannel.mockClear();
    });

    it('reject reason is never undefined for VERSION_MISMATCH', async () => {
      const msg = {
        type: MSG.JOIN_REQ,
        guestId: 'guest-wrong-version',
        displayName: 'WrongVersion',
        protocolVersion: '0.0.0-invalid',
        timestamp: Date.now()
      };

      sessionManager.onMessage(msg);
      await flushJoinQueue();

      const calls = mockTransport.broadcastToChannel.mock.calls;
      const ackCall = calls.find(c => c[1]?.type === MSG.JOIN_ACK);

      expect(ackCall).toBeDefined();
      expect(ackCall[1].accepted).toBe(false);
      expect(ackCall[1].rejectReason).toBe('VERSION_MISMATCH');
      expect(ackCall[1].rejectReason).not.toBeUndefined();
    });

    it('reject reason is never undefined for SESSION_FULL', async () => {
      // Fill session (host + 3 guests = max 4)
      sessionManager.onMessage(createJoinReq({ guestId: 'g1', displayName: 'G1' }));
      sessionManager.onMessage(createJoinReq({ guestId: 'g2', displayName: 'G2' }));
      sessionManager.onMessage(createJoinReq({ guestId: 'g3', displayName: 'G3' }));
      await flushJoinQueue();

      mockTransport.broadcastToChannel.mockClear();

      // Try to join when full
      sessionManager.onMessage(createJoinReq({ guestId: 'g4', displayName: 'G4' }));
      await flushJoinQueue();

      const calls = mockTransport.broadcastToChannel.mock.calls;
      const ackCall = calls.find(c => c[1]?.type === MSG.JOIN_ACK && !c[1]?.accepted);

      expect(ackCall).toBeDefined();
      expect(ackCall[1].rejectReason).toBe('SESSION_FULL');
      expect(ackCall[1].rejectReason).not.toBeUndefined();
    });

    it('reject reason is never undefined for INVALID_REQUEST', async () => {
      const msg = {
        type: MSG.JOIN_REQ,
        guestId: 'guest-no-name',
        displayName: '',  // Empty displayName
        protocolVersion: PROTOCOL_VERSION,
        timestamp: Date.now()
      };

      sessionManager.onMessage(msg);
      await flushJoinQueue();

      const calls = mockTransport.broadcastToChannel.mock.calls;
      const ackCall = calls.find(c => c[1]?.type === MSG.JOIN_ACK);

      expect(ackCall).toBeDefined();
      expect(ackCall[1].accepted).toBe(false);
      expect(ackCall[1].rejectReason).toBe('INVALID_REQUEST');
      expect(ackCall[1].rejectReason).not.toBeUndefined();
    });

    it('all rejection paths have explicit reason strings', async () => {
      // This test ensures createJoinAckRejected always sets a reason
      const rejectionScenarios = [
        { name: 'VERSION_MISMATCH', msg: { ...createJoinReq(), protocolVersion: 'bad' } },
        { name: 'INVALID_REQUEST', msg: { type: MSG.JOIN_REQ, guestId: 'x', displayName: '', protocolVersion: PROTOCOL_VERSION } }
      ];

      for (const scenario of rejectionScenarios) {
        mockTransport.broadcastToChannel.mockClear();
        sessionManager.onMessage(scenario.msg);
        await flushJoinQueue();

        const calls = mockTransport.broadcastToChannel.mock.calls;
        const ackCall = calls.find(c => c[1]?.type === MSG.JOIN_ACK && !c[1]?.accepted);

        if (ackCall) {
          expect(typeof ackCall[1].rejectReason).toBe('string');
          expect(ackCall[1].rejectReason.length).toBeGreaterThan(0);
        }
      }
    });
  });

  // ========================================
  // Host connection state notification on guest join
  // ========================================

  describe('Host onConnectionStateChanged after guest join', () => {
    beforeEach(async () => {
      await sessionManager.hostGame('Test Session');
      // Clear the callback mock after hostGame() which fires HOSTING once on init
    });

    it('fires onConnectionStateChanged("HOSTING") when guest joins', async () => {
      const stateChangeSpy = vi.fn();
      sessionManager.onConnectionStateChanged = stateChangeSpy;

      sessionManager.onMessage(createJoinReq({ guestId: 'guest-notify', displayName: 'NotifyGuest' }));
      await flushJoinQueue();

      // Should have been called with 'HOSTING' after the guest was accepted
      expect(stateChangeSpy).toHaveBeenCalledWith('HOSTING');
      expect(stateChangeSpy).toHaveBeenCalledTimes(1);
    });

    it('has playerCount > 1 when HOSTING notification fires after guest join', async () => {
      let playerCountAtNotification = 0;

      sessionManager.onConnectionStateChanged = (state) => {
        if (state === 'HOSTING') {
          // Capture the player count at the moment the notification fires
          playerCountAtNotification = sessionManager.state.players.length;
        }
      };

      sessionManager.onMessage(createJoinReq({ guestId: 'guest-count', displayName: 'CountGuest' }));
      await flushJoinQueue();

      // Guest should already be in the players list when notification fires
      expect(playerCountAtNotification).toBeGreaterThan(1);
      // Specifically: Host (slot 0) + Guest (slot 1) = 2
      expect(playerCountAtNotification).toBe(2);
    });

    it('does NOT fire onConnectionStateChanged on rejected join', async () => {
      const stateChangeSpy = vi.fn();
      sessionManager.onConnectionStateChanged = stateChangeSpy;

      // Send a join request with wrong protocol version (will be rejected)
      sessionManager.onMessage(createJoinReq({ guestId: 'guest-bad', protocolVersion: '0.0.0' }));
      await flushJoinQueue();

      // Should NOT have been called - rejections should not trigger HOSTING notification
      expect(stateChangeSpy).not.toHaveBeenCalled();
    });
  });
});
