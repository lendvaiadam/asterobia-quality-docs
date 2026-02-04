/**
 * sessionManager.test.js - Unit tests for SessionManager
 *
 * Tests: R013-M03 SessionManager Skeleton
 * Reference: docs/work_orders/WO-R013-M03.md
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionManager } from '../multiplayer/SessionManager.js';
import { NetworkRole } from '../multiplayer/NetworkRole.js';
import { MSG } from '../multiplayer/MessageTypes.js';

/**
 * Mock Game object for testing
 */
function createMockGame() {
  return {
    clientId: null,
    simTick: 0,
    stateSurface: {
      serialize: () => ({ meta: { simTick: 0 }, units: [] })
    }
  };
}

/**
 * Mock Transport for testing
 */
function createMockTransport() {
  return {
    send: vi.fn(),
    onMessage: vi.fn(),
    joinChannel: vi.fn(),
    broadcastToChannel: vi.fn()
  };
}

describe('SessionManager', () => {
  let sessionManager;
  let mockGame;

  beforeEach(() => {
    mockGame = createMockGame();
    sessionManager = new SessionManager(mockGame);
  });

  describe('constructor', () => {
    it('requires a game instance', () => {
      expect(() => new SessionManager(null)).toThrow('SessionManager requires a game instance');
      expect(() => new SessionManager(undefined)).toThrow('SessionManager requires a game instance');
    });

    it('stores game reference', () => {
      expect(sessionManager.game).toBe(mockGame);
    });

    it('initializes state as SessionState instance', () => {
      expect(sessionManager.state).toBeDefined();
      expect(sessionManager.state.role).toBe(NetworkRole.OFFLINE);
    });

    it('initializes transport as null', () => {
      expect(sessionManager.transport).toBeNull();
    });

    it('initializes with OFFLINE role', () => {
      expect(sessionManager.getRole()).toBe(NetworkRole.OFFLINE);
      expect(sessionManager.isOffline()).toBe(true);
      expect(sessionManager.isHost()).toBe(false);
      expect(sessionManager.isGuest()).toBe(false);
    });
  });

  describe('setTransport', () => {
    it('stores transport reference', () => {
      const transport = createMockTransport();
      sessionManager.setTransport(transport);
      expect(sessionManager.transport).toBe(transport);
    });

    it('accepts null transport', () => {
      sessionManager.setTransport(null);
      expect(sessionManager.transport).toBeNull();
    });

    it('wires up onMessage callback if transport supports it', () => {
      const transport = createMockTransport();
      sessionManager.setTransport(transport);
      expect(transport.onMessage).toHaveBeenCalled();
    });
  });

  describe('getTransport', () => {
    it('returns current transport', () => {
      const transport = createMockTransport();
      sessionManager.setTransport(transport);
      expect(sessionManager.getTransport()).toBe(transport);
    });

    it('returns null when no transport set', () => {
      expect(sessionManager.getTransport()).toBeNull();
    });
  });

  describe('hostGame', () => {
    it('requires session name', async () => {
      await expect(sessionManager.hostGame('')).rejects.toThrow('Session name is required');
      await expect(sessionManager.hostGame(null)).rejects.toThrow('Session name is required');
    });

    it('throws if already in a session', async () => {
      await sessionManager.hostGame('Test');
      await expect(sessionManager.hostGame('Another')).rejects.toThrow('Already in a session');
    });

    it('sets role to HOST', async () => {
      await sessionManager.hostGame('My Game');
      expect(sessionManager.getRole()).toBe(NetworkRole.HOST);
      expect(sessionManager.isHost()).toBe(true);
    });

    it('sets session name', async () => {
      await sessionManager.hostGame('My Game');
      expect(sessionManager.sessionName).toBe('My Game');
    });

    it('generates client ID if not set', async () => {
      expect(mockGame.clientId).toBeNull();
      await sessionManager.hostGame('My Game');
      expect(mockGame.clientId).toBeDefined();
      expect(typeof mockGame.clientId).toBe('string');
    });

    it('uses existing client ID if set', async () => {
      mockGame.clientId = 'existing-id';
      await sessionManager.hostGame('My Game');
      expect(mockGame.clientId).toBe('existing-id');
      expect(sessionManager.state.hostId).toBe('existing-id');
    });

    it('returns true on success', async () => {
      const result = await sessionManager.hostGame('My Game');
      expect(result).toBe(true);
    });

    it('assigns host to slot 0', async () => {
      await sessionManager.hostGame('My Game');
      expect(sessionManager.getMySlot()).toBe(0);
    });
  });

  describe('joinGame', () => {
    it('requires host ID', async () => {
      await expect(sessionManager.joinGame('')).rejects.toThrow('Host ID is required');
      await expect(sessionManager.joinGame(null)).rejects.toThrow('Host ID is required');
    });

    it('throws if already in a session', async () => {
      await sessionManager.hostGame('Test');
      await expect(sessionManager.joinGame('host-123')).rejects.toThrow('Already in a session');
    });

    it('sets role to GUEST', async () => {
      await sessionManager.joinGame('host-123');
      expect(sessionManager.getRole()).toBe(NetworkRole.GUEST);
      expect(sessionManager.isGuest()).toBe(true);
    });

    it('stores host ID in state', async () => {
      await sessionManager.joinGame('host-123');
      expect(sessionManager.state.hostId).toBe('host-123');
    });

    it('generates client ID if not set', async () => {
      expect(mockGame.clientId).toBeNull();
      await sessionManager.joinGame('host-123');
      expect(mockGame.clientId).toBeDefined();
    });

    it('returns true on success (stub)', async () => {
      const result = await sessionManager.joinGame('host-123');
      expect(result).toBe(true);
    });
  });

  describe('leaveGame', () => {
    it('resets state to OFFLINE', async () => {
      await sessionManager.hostGame('Test');
      sessionManager.leaveGame();
      expect(sessionManager.getRole()).toBe(NetworkRole.OFFLINE);
      expect(sessionManager.isOffline()).toBe(true);
    });

    it('clears session name', async () => {
      await sessionManager.hostGame('Test');
      sessionManager.leaveGame();
      expect(sessionManager.sessionName).toBeNull();
    });

    it('clears input buffer', async () => {
      await sessionManager.hostGame('Test');
      sessionManager.inputBuffer.push({ test: 'data' });
      sessionManager.leaveGame();
      expect(sessionManager.inputBuffer).toEqual([]);
    });

    it('clears pending pings', async () => {
      await sessionManager.hostGame('Test');
      sessionManager.pendingPings.set(1, Date.now());
      sessionManager.leaveGame();
      expect(sessionManager.pendingPings.size).toBe(0);
    });

    it('resets RTT', async () => {
      await sessionManager.hostGame('Test');
      sessionManager.rtt = 100;
      sessionManager.leaveGame();
      expect(sessionManager.rtt).toBe(0);
    });

    it('can be called when already offline', () => {
      expect(() => sessionManager.leaveGame()).not.toThrow();
    });
  });

  describe('onMessage', () => {
    it('handles null message gracefully', () => {
      expect(() => sessionManager.onMessage(null)).not.toThrow();
    });

    it('handles message without type gracefully', () => {
      expect(() => sessionManager.onMessage({})).not.toThrow();
    });

    it('routes HELLO messages', () => {
      const spy = vi.spyOn(sessionManager, '_handleHello');
      sessionManager.onMessage({ type: MSG.HELLO, clientId: 'test' });
      expect(spy).toHaveBeenCalled();
    });

    it('routes HOST_ANNOUNCE messages', () => {
      const spy = vi.spyOn(sessionManager, '_handleHostAnnounce');
      sessionManager.onMessage({ type: MSG.HOST_ANNOUNCE, hostId: 'test' });
      expect(spy).toHaveBeenCalled();
    });

    it('routes JOIN_REQ messages', () => {
      const spy = vi.spyOn(sessionManager, '_handleJoinReq');
      sessionManager.onMessage({ type: MSG.JOIN_REQ, guestId: 'test' });
      expect(spy).toHaveBeenCalled();
    });

    it('routes JOIN_ACK messages', () => {
      const spy = vi.spyOn(sessionManager, '_handleJoinAck');
      sessionManager.onMessage({ type: MSG.JOIN_ACK, accepted: true });
      expect(spy).toHaveBeenCalled();
    });

    it('routes INPUT_CMD messages', () => {
      const spy = vi.spyOn(sessionManager, '_handleInputCmd');
      sessionManager.onMessage({ type: MSG.INPUT_CMD, slot: 1 });
      expect(spy).toHaveBeenCalled();
    });

    it('routes CMD_BATCH messages', () => {
      const spy = vi.spyOn(sessionManager, '_handleCmdBatch');
      sessionManager.onMessage({ type: MSG.CMD_BATCH, simTick: 100 });
      expect(spy).toHaveBeenCalled();
    });

    it('routes SNAPSHOT messages', () => {
      const spy = vi.spyOn(sessionManager, '_handleSnapshot');
      sessionManager.onMessage({ type: MSG.SNAPSHOT, simTick: 100 });
      expect(spy).toHaveBeenCalled();
    });

    it('routes RESYNC_REQ messages', () => {
      const spy = vi.spyOn(sessionManager, '_handleResyncReq');
      sessionManager.onMessage({ type: MSG.RESYNC_REQ, guestId: 'test' });
      expect(spy).toHaveBeenCalled();
    });

    it('routes RESYNC_ACK messages', () => {
      const spy = vi.spyOn(sessionManager, '_handleResyncAck');
      sessionManager.onMessage({ type: MSG.RESYNC_ACK, simTick: 100 });
      expect(spy).toHaveBeenCalled();
    });

    it('routes PING messages', () => {
      const spy = vi.spyOn(sessionManager, '_handlePing');
      sessionManager.onMessage({ type: MSG.PING, senderId: 'test' });
      expect(spy).toHaveBeenCalled();
    });

    it('routes PONG messages', () => {
      const spy = vi.spyOn(sessionManager, '_handlePong');
      sessionManager.onMessage({ type: MSG.PONG, pingSeq: 1 });
      expect(spy).toHaveBeenCalled();
    });

    it('updates heartbeat timing', () => {
      const before = sessionManager.state.lastMessageTime;
      sessionManager.onMessage({ type: MSG.HELLO, clientId: 'test' });
      expect(sessionManager.state.lastMessageTime).toBeGreaterThanOrEqual(before || 0);
    });
  });

  describe('canStep', () => {
    it('returns true when OFFLINE', () => {
      expect(sessionManager.canStep()).toBe(true);
    });

    it('returns true when HOST', async () => {
      await sessionManager.hostGame('Test');
      expect(sessionManager.canStep()).toBe(true);
    });

    it('returns false when GUEST', async () => {
      await sessionManager.joinGame('host-123');
      expect(sessionManager.canStep()).toBe(false);
    });
  });

  describe('accessors', () => {
    it('getRTT returns current RTT', () => {
      sessionManager.rtt = 50;
      expect(sessionManager.getRTT()).toBe(50);
    });

    it('getMySlot returns current slot', async () => {
      await sessionManager.hostGame('Test');
      expect(sessionManager.getMySlot()).toBe(0);
    });

    it('getPlayers returns players array', async () => {
      await sessionManager.hostGame('Test');
      const players = sessionManager.getPlayers();
      expect(Array.isArray(players)).toBe(true);
      expect(players.length).toBeGreaterThan(0);
    });
  });

  describe('toJSON', () => {
    it('serializes state for debugging', async () => {
      await sessionManager.hostGame('Test Game');
      sessionManager.rtt = 42;

      const json = sessionManager.toJSON();

      expect(json.role).toBe(NetworkRole.HOST);
      expect(json.sessionName).toBe('Test Game');
      expect(json.rtt).toBe(42);
      expect(json.mySlot).toBe(0);
      expect(Array.isArray(json.players)).toBe(true);
    });
  });

  describe('callbacks', () => {
    it('calls onConnectionStateChanged when hosting', async () => {
      const callback = vi.fn();
      sessionManager.onConnectionStateChanged = callback;

      await sessionManager.hostGame('Test');

      expect(callback).toHaveBeenCalledWith('HOSTING');
    });

    it('calls onConnectionStateChanged when joining', async () => {
      const callback = vi.fn();
      sessionManager.onConnectionStateChanged = callback;

      await sessionManager.joinGame('host-123');

      expect(callback).toHaveBeenCalledWith('CONNECTED');
    });

    it('calls onConnectionStateChanged when leaving', async () => {
      const callback = vi.fn();
      sessionManager.onConnectionStateChanged = callback;

      await sessionManager.hostGame('Test');
      callback.mockClear();

      sessionManager.leaveGame();

      expect(callback).toHaveBeenCalledWith('OFFLINE');
    });
  });

  describe('PONG handling', () => {
    it('calculates RTT from pending ping', () => {
      const pingTime = Date.now() - 50;
      sessionManager.pendingPings.set(5, pingTime);

      sessionManager.onMessage({
        type: MSG.PONG,
        pingSeq: 5,
        originalTimestamp: pingTime,
        timestamp: Date.now()
      });

      expect(sessionManager.rtt).toBeGreaterThanOrEqual(50);
      expect(sessionManager.pendingPings.has(5)).toBe(false);
    });
  });
});

describe('SessionManager integration with Game', () => {
  it('Game constructor would create SessionManager', () => {
    // This is a documentation test - actual integration tested at runtime
    // The Game.js modification adds: this.sessionManager = new SessionManager(this);
    const mockGame = createMockGame();
    const sm = new SessionManager(mockGame);
    expect(sm.game).toBe(mockGame);
  });
});
