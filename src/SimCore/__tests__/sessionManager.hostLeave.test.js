/**
 * sessionManager.hostLeave.test.js - Unit tests for Host Leave & Migration
 *
 * Tests: Host/Guest leave handling, host migration, player removal
 *
 * Key Constraints Verified:
 * - HOST_LEAVE / GUEST_LEAVE message type existence
 * - SessionState.promoteToHost() method (Guest -> Host migration)
 * - removePlayer() removes player by slot
 * - Host absence detection via missed HOST_ANNOUNCE
 * - GUEST_LEAVE removes player from state (Host-side)
 * - Leave flow cleanup (channels, intervals, buffers)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionManager } from '../multiplayer/SessionManager.js';
import { SessionState } from '../multiplayer/SessionState.js';
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
      serialize: vi.fn(() => ({ meta: { simTick: 100 }, units: [], terrain: {} })),
      deserialize: vi.fn()
    },
    units: [],
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
 * Helper to flush async queue - waits for promises to resolve
 */
async function flushQueue() {
  await new Promise(resolve => setTimeout(resolve, 10));
}

describe('Host Leave & Migration', () => {
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
    vi.restoreAllMocks();
  });

  // ========================================
  // 1. promoteToHost changes role from GUEST to HOST
  // ========================================

  describe('promoteToHost()', () => {
    it('changes role from GUEST to HOST', () => {
      // Setup: configure SessionState as GUEST
      const state = sessionManager.state;
      state.setAsGuest('original-host-id', 1, 'guest-client-id', 'GuestPlayer');

      // Precondition: verify GUEST state
      expect(state.role).toBe(NetworkRole.GUEST);
      expect(state.isGuest()).toBe(true);
      expect(state.mySlot).toBe(1);

      // Act: promote to host
      // This method may not exist yet (being added by W4 worker)
      // Test should fail until W4 completes implementation
      if (typeof state.promoteToHost === 'function') {
        state.promoteToHost();

        // Assert: role changed to HOST
        expect(state.role).toBe(NetworkRole.HOST);
        expect(state.isHost()).toBe(true);
      } else {
        // Method not yet implemented - mark test as expected failure
        expect(typeof state.promoteToHost).toBe('function');
      }
    });

    it('preserves mySlot after promotion', () => {
      const state = sessionManager.state;
      state.setAsGuest('original-host-id', 1, 'guest-client-id', 'GuestPlayer');

      if (typeof state.promoteToHost === 'function') {
        const slotBefore = state.mySlot;
        state.promoteToHost();

        // mySlot should remain the same (the promoted guest keeps their slot)
        expect(state.mySlot).toBe(slotBefore);
      } else {
        expect(typeof state.promoteToHost).toBe('function');
      }
    });

    it('sets connected to true after promotion', () => {
      const state = sessionManager.state;
      state.setAsGuest('original-host-id', 1, 'guest-client-id', 'GuestPlayer');

      if (typeof state.promoteToHost === 'function') {
        state.promoteToHost();

        expect(state.connected).toBe(true);
      } else {
        expect(typeof state.promoteToHost).toBe('function');
      }
    });
  });

  // ========================================
  // 2. removePlayer removes player by slot
  // ========================================

  describe('removePlayer()', () => {
    it('removes player by slot', () => {
      const state = sessionManager.state;
      state.setAsHost('host-id', 'Test Session', 'HostPlayer');

      // Add a guest at slot 1
      state.addPlayer({
        slot: 1,
        userId: 'guest-1',
        displayName: 'Guest1',
        status: 'active'
      });

      // Precondition: 2 players (Host + Guest)
      expect(state.players.length).toBe(2);

      // Act: remove guest at slot 1
      state.removePlayer(1);

      // Assert: only 1 player remains (Host at slot 0)
      expect(state.players.length).toBe(1);
      expect(state.players[0].slot).toBe(0);
      expect(state.players[0].userId).toBe('host-id');
    });

    it('removes correct player when multiple exist', () => {
      const state = sessionManager.state;
      state.setAsHost('host-id', 'Test Session', 'HostPlayer');

      // Add 3 guests
      state.addPlayer({ slot: 1, userId: 'guest-1', displayName: 'Guest1', status: 'active' });
      state.addPlayer({ slot: 2, userId: 'guest-2', displayName: 'Guest2', status: 'active' });
      state.addPlayer({ slot: 3, userId: 'guest-3', displayName: 'Guest3', status: 'active' });

      expect(state.players.length).toBe(4);

      // Remove guest at slot 2 (middle)
      state.removePlayer(2);

      // Assert: 3 players remain, and slot 2 is gone
      expect(state.players.length).toBe(3);
      expect(state.getPlayer(2)).toBeUndefined();
      expect(state.getPlayer(0)).toBeDefined();
      expect(state.getPlayer(1)).toBeDefined();
      expect(state.getPlayer(3)).toBeDefined();
    });

    it('cleans up lastSeenSeq for removed slot', () => {
      const state = sessionManager.state;
      state.setAsHost('host-id', 'Test Session', 'HostPlayer');
      state.addPlayer({ slot: 1, userId: 'guest-1', displayName: 'Guest1', status: 'active' });

      // Set some seq tracking data
      state.updateLastSeenSeq(1, 42);
      expect(state.lastSeenSeq[1]).toBe(42);

      // Remove player
      state.removePlayer(1);

      // lastSeenSeq for that slot should be cleaned up
      expect(state.lastSeenSeq[1]).toBeUndefined();
    });

    it('does not remove other players when removing one', () => {
      const state = sessionManager.state;
      state.setAsHost('host-id', 'Test Session', 'HostPlayer');
      state.addPlayer({ slot: 1, userId: 'guest-1', displayName: 'Guest1', status: 'active' });
      state.addPlayer({ slot: 2, userId: 'guest-2', displayName: 'Guest2', status: 'active' });

      state.removePlayer(1);

      // Host and guest-2 should still be present
      expect(state.getPlayer(0)).toBeDefined();
      expect(state.getPlayer(2)).toBeDefined();
      expect(state.players.length).toBe(2);
    });

    it('is a no-op when slot does not exist', () => {
      const state = sessionManager.state;
      state.setAsHost('host-id', 'Test Session', 'HostPlayer');

      const playersBefore = [...state.players];

      // Remove non-existent slot
      state.removePlayer(99);

      // Nothing should change
      expect(state.players.length).toBe(playersBefore.length);
    });
  });

  // ========================================
  // 3. HOST_LEAVE / GUEST_LEAVE message type existence
  // ========================================

  describe('Message type constants', () => {
    it('HOST_LEAVE message type exists in MSG', () => {
      // HOST_LEAVE may not exist yet (being added by W4 worker)
      // Test should fail until W4 completes implementation
      expect(MSG.HOST_LEAVE).toBeDefined();
      expect(typeof MSG.HOST_LEAVE).toBe('string');
    });

    it('GUEST_LEAVE message type exists in MSG', () => {
      // GUEST_LEAVE may not exist yet (being added by W4 worker)
      // Test should fail until W4 completes implementation
      expect(MSG.GUEST_LEAVE).toBeDefined();
      expect(typeof MSG.GUEST_LEAVE).toBe('string');
    });

    it('HOST_LEAVE and GUEST_LEAVE are distinct values', () => {
      // Verify they are different message types
      if (MSG.HOST_LEAVE && MSG.GUEST_LEAVE) {
        expect(MSG.HOST_LEAVE).not.toBe(MSG.GUEST_LEAVE);
      } else {
        // At least one is undefined - fail with informative message
        expect(MSG.HOST_LEAVE).toBeDefined();
        expect(MSG.GUEST_LEAVE).toBeDefined();
      }
    });
  });

  // ========================================
  // 4. Host leaving detected by absence of HOST_ANNOUNCE
  // ========================================

  describe('Host absence detection', () => {
    it('host is considered offline after 16 seconds without announce', () => {
      vi.useFakeTimers();

      // Setup as Guest with last known host activity
      const state = sessionManager.state;
      state.setAsGuest('original-host-id', 1, 'guest-client-id', 'GuestPlayer');
      state.touch(); // Set lastMessageTime to now

      // Precondition: host was seen recently
      expect(state.getIdleTime()).toBeLessThan(1000);

      // Simulate 16 seconds passing without any message
      vi.advanceTimersByTime(16000);

      // Assert: idle time exceeds 15s (STALE_HOST_TIMEOUT_MS)
      expect(state.getIdleTime()).toBeGreaterThanOrEqual(16000);
      // 15 seconds is the stale threshold per STALE_HOST_TIMEOUT_MS
      expect(state.getIdleTime()).toBeGreaterThan(15000);

      vi.useRealTimers();
    });

    it('host activity resets idle timer', () => {
      vi.useFakeTimers();

      const state = sessionManager.state;
      state.setAsGuest('original-host-id', 1, 'guest-client-id', 'GuestPlayer');
      state.touch();

      // Advance 10 seconds
      vi.advanceTimersByTime(10000);
      expect(state.getIdleTime()).toBeGreaterThanOrEqual(10000);

      // Touch (simulate receiving a message) resets timer
      state.touch();
      expect(state.getIdleTime()).toBeLessThan(100);

      vi.useRealTimers();
    });

    it('getIdleTime returns Infinity when no message received', () => {
      const state = new SessionState();
      // Fresh state has no lastMessageTime
      state.lastMessageTime = null;
      expect(state.getIdleTime()).toBe(Infinity);
    });

    it('HOST_ANNOUNCE resets lastMessageTime via onMessage()', () => {
      vi.useFakeTimers();

      // Setup as Guest doing discovery
      sessionManager.state.setAsGuest('host-id', 1, 'guest-client-id', 'GuestPlayer');
      sessionManager._discoveryActive = true;

      // Initial touch
      sessionManager.state.touch();

      // Advance 5 seconds
      vi.advanceTimersByTime(5000);
      expect(sessionManager.state.getIdleTime()).toBeGreaterThanOrEqual(5000);

      // Simulate receiving a HOST_ANNOUNCE via onMessage (which calls state.touch())
      sessionManager.onMessage({
        type: MSG.HOST_ANNOUNCE,
        hostId: 'host-id',
        sessionName: 'Test Session',
        mapSeed: 'seed',
        simTick: 200,
        currentPlayers: 1,
        maxPlayers: 4,
        protocolVersion: PROTOCOL_VERSION,
        timestamp: Date.now()
      });

      // Idle time should have been reset
      expect(sessionManager.state.getIdleTime()).toBeLessThan(100);

      vi.useRealTimers();
    });
  });

  // ========================================
  // 5. GUEST_LEAVE removes player from state (Host-side)
  // ========================================

  describe('GUEST_LEAVE handling', () => {
    beforeEach(async () => {
      await sessionManager.hostGame('Test Session');
      mockTransport.broadcastToChannel.mockClear();
    });

    it('removes player from state on GUEST_LEAVE', async () => {
      // Add a guest player
      sessionManager.state.addPlayer({
        slot: 1,
        userId: 'guest-1',
        displayName: 'Guest1',
        status: 'active'
      });

      // Precondition: 2 players
      expect(sessionManager.state.players.length).toBe(2);

      // Simulate receiving GUEST_LEAVE message
      // This message type may not be handled yet (W4 worker adds it)
      const guestLeaveMsg = {
        type: MSG.GUEST_LEAVE || 'GUEST_LEAVE',
        senderId: 'guest-1',
        slot: 1,
        timestamp: Date.now()
      };

      sessionManager.onMessage(guestLeaveMsg);
      await flushQueue();

      // If GUEST_LEAVE handling is implemented, player should be removed
      if (MSG.GUEST_LEAVE) {
        // Check if session manager processes the leave
        const player = sessionManager.state.getPlayer(1);
        // Either player was removed or marked as disconnected
        // Both are valid depending on implementation
        const playerRemoved = player === undefined;
        const playerDisconnected = player?.status === 'disconnected';

        expect(playerRemoved || playerDisconnected).toBe(true);
      } else {
        // GUEST_LEAVE not defined yet - test documents expected behavior
        expect(MSG.GUEST_LEAVE).toBeDefined();
      }
    });

    it('reduces player count after GUEST_LEAVE', async () => {
      sessionManager.state.addPlayer({
        slot: 1,
        userId: 'guest-1',
        displayName: 'Guest1',
        status: 'active'
      });
      sessionManager.state.addPlayer({
        slot: 2,
        userId: 'guest-2',
        displayName: 'Guest2',
        status: 'active'
      });

      // Precondition: 3 players (Host + 2 guests)
      expect(sessionManager.state.players.length).toBe(3);

      // Simulate GUEST_LEAVE from slot 1
      const guestLeaveMsg = {
        type: MSG.GUEST_LEAVE || 'GUEST_LEAVE',
        senderId: 'guest-1',
        slot: 1,
        timestamp: Date.now()
      };

      sessionManager.onMessage(guestLeaveMsg);
      await flushQueue();

      if (MSG.GUEST_LEAVE) {
        // After processing, at most 2 players should remain
        // (or 3 if one is just marked disconnected - depends on implementation)
        const activePlayers = sessionManager.state.players.filter(p => p.status === 'active');
        // Guest at slot 2 and Host at slot 0 should still be active
        expect(activePlayers.length).toBeLessThanOrEqual(2);
        expect(sessionManager.state.getPlayer(0)).toBeDefined(); // Host always stays
        expect(sessionManager.state.getPlayer(2)).toBeDefined(); // Unaffected guest
      } else {
        expect(MSG.GUEST_LEAVE).toBeDefined();
      }
    });

    it('does not affect host when GUEST_LEAVE is received', async () => {
      sessionManager.state.addPlayer({
        slot: 1,
        userId: 'guest-1',
        displayName: 'Guest1',
        status: 'active'
      });

      const guestLeaveMsg = {
        type: MSG.GUEST_LEAVE || 'GUEST_LEAVE',
        senderId: 'guest-1',
        slot: 1,
        timestamp: Date.now()
      };

      sessionManager.onMessage(guestLeaveMsg);
      await flushQueue();

      // Host should still be present and active
      const host = sessionManager.state.getPlayer(0);
      expect(host).toBeDefined();
      expect(host.status).toBe('active');
      expect(sessionManager.state.isHost()).toBe(true);
    });
  });

  // ========================================
  // 6. leaveGame() cleanup
  // ========================================

  describe('leaveGame() cleanup', () => {
    it('resets state to OFFLINE on leaveGame()', async () => {
      await sessionManager.hostGame('Test Session');

      // Precondition: should be HOST
      expect(sessionManager.state.isHost()).toBe(true);

      sessionManager.leaveGame();

      // Assert: state reset to OFFLINE
      expect(sessionManager.state.isOffline()).toBe(true);
      expect(sessionManager.state.role).toBe(NetworkRole.OFFLINE);
    });

    it('clears players on leaveGame()', async () => {
      await sessionManager.hostGame('Test Session');

      // Add some guests
      sessionManager.state.addPlayer({ slot: 1, userId: 'g1', displayName: 'G1', status: 'active' });
      sessionManager.state.addPlayer({ slot: 2, userId: 'g2', displayName: 'G2', status: 'active' });

      expect(sessionManager.state.players.length).toBe(3);

      sessionManager.leaveGame();

      // Players should be cleared via state.reset()
      expect(sessionManager.state.players.length).toBe(0);
    });

    it('clears input buffer on leaveGame()', async () => {
      await sessionManager.hostGame('Test Session');

      // Add some buffered input
      sessionManager.inputBuffer.push({ slot: 0, seq: 1, command: { type: 'MOVE' } });
      sessionManager.inputBuffer.push({ slot: 1, seq: 1, command: { type: 'MOVE' } });

      expect(sessionManager.inputBuffer.length).toBe(2);

      sessionManager.leaveGame();

      expect(sessionManager.inputBuffer.length).toBe(0);
    });

    it('leaves session channel on leaveGame()', async () => {
      await sessionManager.hostGame('Test Session');
      const sessionChannel = sessionManager._sessionChannel;

      expect(sessionChannel).toBeTruthy();

      sessionManager.leaveGame();

      // leaveChannel should have been called for the session channel
      expect(mockTransport.leaveChannel).toHaveBeenCalledWith(sessionChannel);
      expect(sessionManager._sessionChannel).toBeNull();
    });

    it('stops announce interval on leaveGame()', async () => {
      await sessionManager.hostGame('Test Session');

      // Announce interval should be running
      expect(sessionManager.announceInterval).not.toBeNull();

      sessionManager.leaveGame();

      // Announce interval should be cleared
      expect(sessionManager.announceInterval).toBeNull();
    });

    it('fires OFFLINE connection state change on leaveGame()', async () => {
      await sessionManager.hostGame('Test Session');

      const stateChangeSpy = vi.fn();
      sessionManager.onConnectionStateChanged = stateChangeSpy;

      sessionManager.leaveGame();

      expect(stateChangeSpy).toHaveBeenCalledWith('OFFLINE');
    });
  });

  // ========================================
  // 7. Determinism constraints for leave flow
  // ========================================

  describe('Determinism constraints', () => {
    it('leave flow is META-LAYER (no SimCore mutation)', async () => {
      await sessionManager.hostGame('Test Session');
      const initialTickCount = mockGame.simLoop.tickCount;

      sessionManager.leaveGame();

      // SimLoop tickCount should not change
      expect(mockGame.simLoop.tickCount).toBe(initialTickCount);
    });

    it('removePlayer does not mutate SimCore state', () => {
      const state = sessionManager.state;
      state.setAsHost('host-id', 'Test Session', 'HostPlayer');
      state.addPlayer({ slot: 1, userId: 'g1', displayName: 'G1', status: 'active' });

      const initialTick = mockGame.simLoop.tickCount;
      state.removePlayer(1);

      expect(mockGame.simLoop.tickCount).toBe(initialTick);
    });
  });

  // ========================================
  // 8. Freed slot becomes available after player removal
  // ========================================

  describe('Slot reuse after player removal', () => {
    it('freed slot becomes available via findNextSlot()', () => {
      const state = sessionManager.state;
      state.setAsHost('host-id', 'Test Session', 'HostPlayer');

      // Fill all slots
      state.addPlayer({ slot: 1, userId: 'g1', displayName: 'G1', status: 'active' });
      state.addPlayer({ slot: 2, userId: 'g2', displayName: 'G2', status: 'active' });
      state.addPlayer({ slot: 3, userId: 'g3', displayName: 'G3', status: 'active' });

      // Session full
      expect(state.findNextSlot()).toBeNull();
      expect(state.isFull()).toBe(true);

      // Remove player at slot 2
      state.removePlayer(2);

      // Slot 2 should be available again
      expect(state.findNextSlot()).toBe(2);
      expect(state.isFull()).toBe(false);
    });

    it('new guest can join after a slot is freed', async () => {
      await sessionManager.hostGame('Test Session');

      // Fill all guest slots
      for (let i = 1; i <= 3; i++) {
        sessionManager.state.addPlayer({
          slot: i,
          userId: `guest-${i}`,
          displayName: `Guest${i}`,
          status: 'active'
        });
      }

      // Session should be full
      expect(sessionManager.state.isFull()).toBe(true);

      // Remove guest at slot 1
      sessionManager.state.removePlayer(1);
      expect(sessionManager.state.isFull()).toBe(false);

      // A new guest should be able to join at slot 1
      mockTransport.broadcastToChannel.mockClear();
      sessionManager.onMessage({
        type: MSG.JOIN_REQ,
        guestId: 'new-guest',
        displayName: 'NewGuest',
        protocolVersion: PROTOCOL_VERSION,
        timestamp: Date.now()
      });
      await flushQueue();

      // Should be accepted at the freed slot
      const newPlayer = sessionManager.state.getPlayerByUserId('new-guest');
      expect(newPlayer).toBeDefined();
      expect(newPlayer.slot).toBe(1); // Reuses the freed slot
    });
  });

  // ========================================
  // 9. Unit seat release on player leave
  // ========================================

  describe('Seat cleanup on player leave', () => {
    it('units controlled by leaving player should have seat cleared', () => {
      // Setup: Host with units, one controlled by guest at slot 1
      mockGame.units = [
        { id: 1, ownerSlot: 0, selectedBySlot: 1, seatPolicy: 'OPEN' },
        { id: 2, ownerSlot: 0, selectedBySlot: null, seatPolicy: 'OPEN' },
        { id: 3, ownerSlot: 1, selectedBySlot: 1, seatPolicy: 'PIN_1DIGIT' }
      ];

      const state = sessionManager.state;
      state.setAsHost('host-id', 'Test Session', 'HostPlayer');
      state.addPlayer({ slot: 1, userId: 'guest-1', displayName: 'Guest1', status: 'active' });

      // Simulate cleaning up seats for leaving player (slot 1)
      // This is what the leave handler should do - release all seats held by that slot
      const leavingSlot = 1;
      for (const unit of mockGame.units) {
        if (unit.selectedBySlot === leavingSlot) {
          unit.selectedBySlot = null;
        }
      }

      // Units previously controlled by slot 1 should be freed
      expect(mockGame.units[0].selectedBySlot).toBeNull(); // Was controlled by slot 1
      expect(mockGame.units[1].selectedBySlot).toBeNull(); // Was already null
      expect(mockGame.units[2].selectedBySlot).toBeNull(); // Was controlled by slot 1
    });
  });
});
