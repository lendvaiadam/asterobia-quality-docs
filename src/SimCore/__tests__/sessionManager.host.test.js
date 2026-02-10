/**
 * sessionManager.host.test.js - Unit tests for SessionManager Host functionality
 *
 * Tests: R013-M04 Host Lobby Channel + Announce
 * Reference: docs/work_orders/WO-R013-M04.md
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionManager } from '../multiplayer/SessionManager.js';
import { NetworkRole } from '../multiplayer/NetworkRole.js';
import { MSG } from '../multiplayer/MessageTypes.js';

/**
 * Mock Game object for testing
 */
function createMockGame() {
  return {
    clientId: null,
    mapSeed: 'test-seed-12345',
    simLoop: {
      tickCount: 100
    },
    stateSurface: {
      serialize: () => ({ meta: { simTick: 100 }, units: [] })
    }
  };
}

/**
 * Mock Transport with channel support for testing
 */
function createMockTransport() {
  const channels = new Map();

  return {
    _channels: channels,
    joinChannel: vi.fn(async (channelName, callback) => {
      channels.set(channelName, { callback });
    }),
    broadcastToChannel: vi.fn(async (channelName, msg) => {
      // Simulate broadcast success
    }),
    leaveChannel: vi.fn(async (channelName) => {
      channels.delete(channelName);
    }),
    isJoinedToChannel: vi.fn((channelName) => channels.has(channelName)),
    onMessage: vi.fn()
  };
}

describe('SessionManager Host Flow (M04)', () => {
  let sessionManager;
  let mockGame;
  let mockTransport;

  beforeEach(() => {
    vi.useFakeTimers();
    mockGame = createMockGame();
    mockTransport = createMockTransport();
    sessionManager = new SessionManager(mockGame);
    sessionManager.setTransport(mockTransport);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (sessionManager.announceInterval) {
      clearInterval(sessionManager.announceInterval);
    }
  });

  describe('hostGame with transport', () => {
    it('joins lobby channel on hostGame', async () => {
      await sessionManager.hostGame('Test Session');

      expect(mockTransport.joinChannel).toHaveBeenCalledWith(
        'asterobia:lobby',
        expect.any(Function)
      );
    });

    it('sends immediate first announce', async () => {
      await sessionManager.hostGame('Test Session');

      expect(mockTransport.broadcastToChannel).toHaveBeenCalledWith(
        'asterobia:lobby',
        expect.objectContaining({
          type: MSG.HOST_ANNOUNCE,
          sessionName: 'Test Session'
        })
      );
    });

    it('HOST_ANNOUNCE contains all required fields', async () => {
      await sessionManager.hostGame('Test Session');

      const call = mockTransport.broadcastToChannel.mock.calls[0];
      const msg = call[1];

      expect(msg.type).toBe(MSG.HOST_ANNOUNCE);
      expect(msg.hostId).toBeDefined();
      expect(msg.sessionName).toBe('Test Session');
      expect(msg.mapSeed).toBe('test-seed-12345');
      expect(msg.simTick).toBe(100);
      expect(msg.currentPlayers).toBe(1);
      expect(msg.maxPlayers).toBe(4);
      expect(msg.protocolVersion).toBe('0.13.0');
      expect(msg.timestamp).toBeDefined();
    });

    it('starts announce interval (5000ms)', async () => {
      await sessionManager.hostGame('Test Session');

      expect(sessionManager.announceInterval).not.toBeNull();

      // Clear the first call
      mockTransport.broadcastToChannel.mockClear();

      // Advance time by 5 seconds
      vi.advanceTimersByTime(5000);

      // Should have sent another announce
      expect(mockTransport.broadcastToChannel).toHaveBeenCalledTimes(1);
    });

    it('sends multiple announces over time', async () => {
      await sessionManager.hostGame('Test Session');

      // Clear the first call
      mockTransport.broadcastToChannel.mockClear();

      // Advance time by 15 seconds (3 intervals)
      vi.advanceTimersByTime(15000);

      // Should have sent 3 announces
      expect(mockTransport.broadcastToChannel).toHaveBeenCalledTimes(3);
    });

    it('sets role to HOST', async () => {
      await sessionManager.hostGame('Test Session');

      expect(sessionManager.getRole()).toBe(NetworkRole.HOST);
      expect(sessionManager.isHost()).toBe(true);
    });

    it('sets hostId to game.clientId', async () => {
      await sessionManager.hostGame('Test Session');

      expect(sessionManager.state.hostId).toBe(mockGame.clientId);
    });

    it('returns true on success', async () => {
      const result = await sessionManager.hostGame('Test Session');
      expect(result).toBe(true);
    });
  });

  describe('hostGame without transport', () => {
    it('works without transport (local only)', async () => {
      sessionManager.setTransport(null);

      const result = await sessionManager.hostGame('Test Session');

      expect(result).toBe(true);
      expect(sessionManager.isHost()).toBe(true);
    });

    it('warns when no transport available', async () => {
      const consoleSpy = vi.spyOn(console, 'warn');
      sessionManager.setTransport(null);

      await sessionManager.hostGame('Test Session');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('No transport')
      );
    });
  });

  describe('hostGame error handling', () => {
    it('resets state on join channel failure', async () => {
      mockTransport.joinChannel.mockRejectedValueOnce(new Error('Channel error'));

      await expect(sessionManager.hostGame('Test Session')).rejects.toThrow('Channel error');

      expect(sessionManager.isOffline()).toBe(true);
      expect(sessionManager.sessionName).toBeNull();
    });
  });

  describe('sendAnnounce', () => {
    it('sends HOST_ANNOUNCE with current state', async () => {
      await sessionManager.hostGame('Test Session');
      mockTransport.broadcastToChannel.mockClear();

      await sessionManager.sendAnnounce();

      expect(mockTransport.broadcastToChannel).toHaveBeenCalledWith(
        'asterobia:lobby',
        expect.objectContaining({
          type: MSG.HOST_ANNOUNCE
        })
      );
    });

    it('does nothing if not HOST', async () => {
      const consoleSpy = vi.spyOn(console, 'warn');

      await sessionManager.sendAnnounce();

      expect(mockTransport.broadcastToChannel).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('not HOST')
      );
    });

    it('includes updated simTick', async () => {
      await sessionManager.hostGame('Test Session');
      mockTransport.broadcastToChannel.mockClear();

      // Update tick count
      mockGame.simLoop.tickCount = 500;

      await sessionManager.sendAnnounce();

      const call = mockTransport.broadcastToChannel.mock.calls[0];
      const msg = call[1];
      expect(msg.simTick).toBe(500);
    });

    it('includes updated player count', async () => {
      await sessionManager.hostGame('Test Session');

      // Add a player
      sessionManager.state.addPlayer({
        slot: 1,
        userId: 'guest-1',
        displayName: 'Guest1',
        status: 'active'
      });

      mockTransport.broadcastToChannel.mockClear();
      await sessionManager.sendAnnounce();

      const call = mockTransport.broadcastToChannel.mock.calls[0];
      const msg = call[1];
      expect(msg.currentPlayers).toBe(2);
    });
  });

  describe('stopAnnouncing', () => {
    it('clears the announce interval', async () => {
      await sessionManager.hostGame('Test Session');
      expect(sessionManager.announceInterval).not.toBeNull();

      sessionManager.stopAnnouncing();

      expect(sessionManager.announceInterval).toBeNull();
    });

    it('can be called multiple times safely', async () => {
      await sessionManager.hostGame('Test Session');

      sessionManager.stopAnnouncing();
      sessionManager.stopAnnouncing();
      sessionManager.stopAnnouncing();

      expect(sessionManager.announceInterval).toBeNull();
    });

    it('stops further announces', async () => {
      await sessionManager.hostGame('Test Session');
      mockTransport.broadcastToChannel.mockClear();

      sessionManager.stopAnnouncing();

      // Advance time
      vi.advanceTimersByTime(15000);

      // No announces should have been sent
      expect(mockTransport.broadcastToChannel).not.toHaveBeenCalled();
    });
  });

  describe('leaveGame cleans up hosting', () => {
    it('stops announcing on leave', async () => {
      await sessionManager.hostGame('Test Session');
      expect(sessionManager.announceInterval).not.toBeNull();

      sessionManager.leaveGame();

      expect(sessionManager.announceInterval).toBeNull();
    });

    it('leaves lobby channel on leave', async () => {
      await sessionManager.hostGame('Test Session');

      sessionManager.leaveGame();

      expect(mockTransport.leaveChannel).toHaveBeenCalledWith('asterobia:lobby');
    });

    it('resets role to OFFLINE', async () => {
      await sessionManager.hostGame('Test Session');

      sessionManager.leaveGame();

      expect(sessionManager.isOffline()).toBe(true);
    });
  });

  describe('connection state callbacks', () => {
    it('calls onConnectionStateChanged with HOSTING', async () => {
      const callback = vi.fn();
      sessionManager.onConnectionStateChanged = callback;

      await sessionManager.hostGame('Test Session');

      expect(callback).toHaveBeenCalledWith('HOSTING');
    });
  });
});

describe('SupabaseTransport channel methods (mock verification)', () => {
  it('mock transport has all required methods', () => {
    const transport = createMockTransport();

    expect(typeof transport.joinChannel).toBe('function');
    expect(typeof transport.broadcastToChannel).toBe('function');
    expect(typeof transport.leaveChannel).toBe('function');
    expect(typeof transport.isJoinedToChannel).toBe('function');
  });
});
