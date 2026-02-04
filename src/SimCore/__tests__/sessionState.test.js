/**
 * sessionState.test.js - Unit tests for NetworkRole and SessionState
 *
 * Tests: R013-M02 NetworkRole Enum & SessionState
 * Reference: docs/work_orders/WO-R013-M02.md
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  NetworkRole,
  isValidRole,
  canStep,
  sendsInputsToNetwork,
  broadcastsState
} from '../multiplayer/NetworkRole.js';
import {
  SessionState,
  PlayerStatus
} from '../multiplayer/SessionState.js';

describe('NetworkRole', () => {
  it('exports enum with OFFLINE, HOST, GUEST', () => {
    expect(NetworkRole.OFFLINE).toBe('OFFLINE');
    expect(NetworkRole.HOST).toBe('HOST');
    expect(NetworkRole.GUEST).toBe('GUEST');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(NetworkRole)).toBe(true);
  });

  describe('isValidRole', () => {
    it('returns true for valid roles', () => {
      expect(isValidRole(NetworkRole.OFFLINE)).toBe(true);
      expect(isValidRole(NetworkRole.HOST)).toBe(true);
      expect(isValidRole(NetworkRole.GUEST)).toBe(true);
    });

    it('returns false for invalid roles', () => {
      expect(isValidRole('INVALID')).toBe(false);
      expect(isValidRole(null)).toBe(false);
      expect(isValidRole(undefined)).toBe(false);
    });
  });

  describe('canStep', () => {
    it('HOST can step', () => {
      expect(canStep(NetworkRole.HOST)).toBe(true);
    });

    it('OFFLINE can step', () => {
      expect(canStep(NetworkRole.OFFLINE)).toBe(true);
    });

    it('GUEST cannot step', () => {
      expect(canStep(NetworkRole.GUEST)).toBe(false);
    });
  });

  describe('sendsInputsToNetwork', () => {
    it('GUEST sends inputs to network', () => {
      expect(sendsInputsToNetwork(NetworkRole.GUEST)).toBe(true);
    });

    it('HOST does not send inputs to network', () => {
      expect(sendsInputsToNetwork(NetworkRole.HOST)).toBe(false);
    });

    it('OFFLINE does not send inputs to network', () => {
      expect(sendsInputsToNetwork(NetworkRole.OFFLINE)).toBe(false);
    });
  });

  describe('broadcastsState', () => {
    it('HOST broadcasts state', () => {
      expect(broadcastsState(NetworkRole.HOST)).toBe(true);
    });

    it('GUEST does not broadcast state', () => {
      expect(broadcastsState(NetworkRole.GUEST)).toBe(false);
    });

    it('OFFLINE does not broadcast state', () => {
      expect(broadcastsState(NetworkRole.OFFLINE)).toBe(false);
    });
  });
});

describe('SessionState', () => {
  let state;

  beforeEach(() => {
    state = new SessionState();
  });

  describe('constructor and initial state', () => {
    it('initial role is OFFLINE', () => {
      expect(state.role).toBe(NetworkRole.OFFLINE);
    });

    it('initial hostId is null', () => {
      expect(state.hostId).toBeNull();
    });

    it('initial sessionId is null', () => {
      expect(state.sessionId).toBeNull();
    });

    it('initial mySlot is 0', () => {
      expect(state.mySlot).toBe(0);
    });

    it('initial seqCounter is 0', () => {
      expect(state.seqCounter).toBe(0);
    });

    it('initial players is empty array', () => {
      expect(state.players).toEqual([]);
    });

    it('initial lastSeenSeq is empty object', () => {
      expect(state.lastSeenSeq).toEqual({});
    });

    it('initial connected is false', () => {
      expect(state.connected).toBe(false);
    });
  });

  describe('reset()', () => {
    it('clears all fields to initial values', () => {
      // Modify state
      state.role = NetworkRole.HOST;
      state.hostId = 'host-123';
      state.sessionId = 'session-456';
      state.mySlot = 2;
      state.seqCounter = 100;
      state.players = [{ slot: 0, userId: 'user', displayName: 'User', status: 'active' }];
      state.lastSeenSeq = { 0: 50 };
      state.connected = true;

      // Reset
      state.reset();

      // Verify all fields are reset
      expect(state.role).toBe(NetworkRole.OFFLINE);
      expect(state.hostId).toBeNull();
      expect(state.sessionId).toBeNull();
      expect(state.mySlot).toBe(0);
      expect(state.seqCounter).toBe(0);
      expect(state.players).toEqual([]);
      expect(state.lastSeenSeq).toEqual({});
      expect(state.connected).toBe(false);
    });
  });

  describe('setAsHost()', () => {
    it('sets role to HOST', () => {
      state.setAsHost('client-1', 'My Game');
      expect(state.role).toBe(NetworkRole.HOST);
    });

    it('sets hostId to clientId', () => {
      state.setAsHost('client-1', 'My Game');
      expect(state.hostId).toBe('client-1');
    });

    it('sets sessionId to clientId', () => {
      state.setAsHost('client-1', 'My Game');
      expect(state.sessionId).toBe('client-1');
    });

    it('sets sessionName', () => {
      state.setAsHost('client-1', 'My Game');
      expect(state.sessionName).toBe('My Game');
    });

    it('sets mySlot to 0 (host is always slot 0)', () => {
      state.setAsHost('client-1', 'My Game');
      expect(state.mySlot).toBe(0);
    });

    it('resets seqCounter to 0', () => {
      state.seqCounter = 50;
      state.setAsHost('client-1', 'My Game');
      expect(state.seqCounter).toBe(0);
    });

    it('initializes players with host as first player', () => {
      state.setAsHost('client-1', 'My Game');
      expect(state.players).toHaveLength(1);
      expect(state.players[0]).toEqual({
        slot: 0,
        userId: 'client-1',
        displayName: 'Host',
        status: PlayerStatus.ACTIVE
      });
    });

    it('sets connected to true', () => {
      state.setAsHost('client-1', 'My Game');
      expect(state.connected).toBe(true);
    });
  });

  describe('setAsGuest()', () => {
    it('sets role to GUEST', () => {
      state.setAsGuest('host-1', 1, 'client-2', 'Player2');
      expect(state.role).toBe(NetworkRole.GUEST);
    });

    it('sets hostId', () => {
      state.setAsGuest('host-1', 1, 'client-2', 'Player2');
      expect(state.hostId).toBe('host-1');
    });

    it('sets mySlot to assigned slot', () => {
      state.setAsGuest('host-1', 2, 'client-2', 'Player2');
      expect(state.mySlot).toBe(2);
    });

    it('resets seqCounter to 0', () => {
      state.seqCounter = 50;
      state.setAsGuest('host-1', 1, 'client-2', 'Player2');
      expect(state.seqCounter).toBe(0);
    });

    it('sets connected to true', () => {
      state.setAsGuest('host-1', 1, 'client-2', 'Player2');
      expect(state.connected).toBe(true);
    });
  });

  describe('player management', () => {
    beforeEach(() => {
      state.setAsHost('host-1', 'Test Game');
    });

    it('addPlayer adds a new player', () => {
      state.addPlayer({ slot: 1, userId: 'guest-1', displayName: 'Guest1', status: PlayerStatus.ACTIVE });
      expect(state.players).toHaveLength(2);
      expect(state.getPlayer(1)).toEqual({
        slot: 1,
        userId: 'guest-1',
        displayName: 'Guest1',
        status: PlayerStatus.ACTIVE
      });
    });

    it('addPlayer updates existing player if slot matches', () => {
      state.addPlayer({ slot: 1, userId: 'guest-1', displayName: 'Guest1', status: PlayerStatus.ACTIVE });
      state.addPlayer({ slot: 1, userId: 'guest-1', displayName: 'Updated Name', status: PlayerStatus.ACTIVE });
      expect(state.players).toHaveLength(2);
      expect(state.getPlayer(1).displayName).toBe('Updated Name');
    });

    it('addPlayer initializes lastSeenSeq for the slot', () => {
      state.addPlayer({ slot: 1, userId: 'guest-1', displayName: 'Guest1', status: PlayerStatus.ACTIVE });
      expect(state.lastSeenSeq[1]).toBe(-1);
    });

    it('removePlayer removes player by slot', () => {
      state.addPlayer({ slot: 1, userId: 'guest-1', displayName: 'Guest1', status: PlayerStatus.ACTIVE });
      state.removePlayer(1);
      expect(state.players).toHaveLength(1);
      expect(state.getPlayer(1)).toBeUndefined();
    });

    it('removePlayer cleans up lastSeenSeq', () => {
      state.addPlayer({ slot: 1, userId: 'guest-1', displayName: 'Guest1', status: PlayerStatus.ACTIVE });
      state.removePlayer(1);
      expect(state.lastSeenSeq[1]).toBeUndefined();
    });

    it('markDisconnected sets player status', () => {
      state.addPlayer({ slot: 1, userId: 'guest-1', displayName: 'Guest1', status: PlayerStatus.ACTIVE });
      state.markDisconnected(1);
      expect(state.getPlayer(1).status).toBe(PlayerStatus.DISCONNECTED);
    });

    it('markReconnecting sets player status', () => {
      state.addPlayer({ slot: 1, userId: 'guest-1', displayName: 'Guest1', status: PlayerStatus.DISCONNECTED });
      state.markReconnecting(1);
      expect(state.getPlayer(1).status).toBe(PlayerStatus.RECONNECTING);
    });

    it('markActive sets player status', () => {
      state.addPlayer({ slot: 1, userId: 'guest-1', displayName: 'Guest1', status: PlayerStatus.DISCONNECTED });
      state.markActive(1);
      expect(state.getPlayer(1).status).toBe(PlayerStatus.ACTIVE);
    });
  });

  describe('slot management', () => {
    beforeEach(() => {
      state.setAsHost('host-1', 'Test Game');
    });

    it('findNextSlot returns first available slot', () => {
      expect(state.findNextSlot()).toBe(1); // Slot 0 taken by host
    });

    it('findNextSlot skips occupied slots', () => {
      state.addPlayer({ slot: 1, userId: 'guest-1', displayName: 'Guest1', status: PlayerStatus.ACTIVE });
      expect(state.findNextSlot()).toBe(2);
    });

    it('findNextSlot returns null when full', () => {
      state.addPlayer({ slot: 1, userId: 'guest-1', displayName: 'Guest1', status: PlayerStatus.ACTIVE });
      state.addPlayer({ slot: 2, userId: 'guest-2', displayName: 'Guest2', status: PlayerStatus.ACTIVE });
      state.addPlayer({ slot: 3, userId: 'guest-3', displayName: 'Guest3', status: PlayerStatus.ACTIVE });
      expect(state.findNextSlot()).toBeNull();
    });

    it('isFull returns false when not full', () => {
      expect(state.isFull()).toBe(false);
    });

    it('isFull returns true when at maxPlayers', () => {
      state.addPlayer({ slot: 1, userId: 'guest-1', displayName: 'Guest1', status: PlayerStatus.ACTIVE });
      state.addPlayer({ slot: 2, userId: 'guest-2', displayName: 'Guest2', status: PlayerStatus.ACTIVE });
      state.addPlayer({ slot: 3, userId: 'guest-3', displayName: 'Guest3', status: PlayerStatus.ACTIVE });
      expect(state.isFull()).toBe(true);
    });
  });

  describe('sequence counter', () => {
    it('nextSeq increments and returns seq', () => {
      expect(state.nextSeq()).toBe(0);
      expect(state.nextSeq()).toBe(1);
      expect(state.nextSeq()).toBe(2);
      expect(state.seqCounter).toBe(3);
    });
  });

  describe('deduplication', () => {
    beforeEach(() => {
      state.setAsHost('host-1', 'Test Game');
      state.addPlayer({ slot: 1, userId: 'guest-1', displayName: 'Guest1', status: PlayerStatus.ACTIVE });
    });

    it('isDuplicateSeq returns false for new seq', () => {
      expect(state.isDuplicateSeq(1, 0)).toBe(false);
    });

    it('isDuplicateSeq returns true for seen seq', () => {
      state.updateLastSeenSeq(1, 5);
      expect(state.isDuplicateSeq(1, 5)).toBe(true);
      expect(state.isDuplicateSeq(1, 3)).toBe(true);
    });

    it('isDuplicateSeq returns false for higher seq', () => {
      state.updateLastSeenSeq(1, 5);
      expect(state.isDuplicateSeq(1, 6)).toBe(false);
    });

    it('updateLastSeenSeq updates the tracking', () => {
      state.updateLastSeenSeq(1, 10);
      expect(state.lastSeenSeq[1]).toBe(10);
    });
  });

  describe('role checks', () => {
    it('isHost returns true when HOST', () => {
      state.setAsHost('host-1', 'Test');
      expect(state.isHost()).toBe(true);
      expect(state.isGuest()).toBe(false);
      expect(state.isOffline()).toBe(false);
    });

    it('isGuest returns true when GUEST', () => {
      state.setAsGuest('host-1', 1, 'client-2', 'Player2');
      expect(state.isHost()).toBe(false);
      expect(state.isGuest()).toBe(true);
      expect(state.isOffline()).toBe(false);
    });

    it('isOffline returns true when OFFLINE', () => {
      expect(state.isHost()).toBe(false);
      expect(state.isGuest()).toBe(false);
      expect(state.isOffline()).toBe(true);
    });
  });

  describe('getPlayer methods', () => {
    beforeEach(() => {
      state.setAsHost('host-1', 'Test Game');
      state.addPlayer({ slot: 1, userId: 'guest-1', displayName: 'Guest1', status: PlayerStatus.ACTIVE });
    });

    it('getPlayer returns player by slot', () => {
      const player = state.getPlayer(1);
      expect(player.userId).toBe('guest-1');
    });

    it('getPlayer returns undefined for invalid slot', () => {
      expect(state.getPlayer(99)).toBeUndefined();
    });

    it('getPlayerByUserId returns player by userId', () => {
      const player = state.getPlayerByUserId('guest-1');
      expect(player.slot).toBe(1);
    });

    it('getPlayerByUserId returns undefined for invalid userId', () => {
      expect(state.getPlayerByUserId('invalid')).toBeUndefined();
    });
  });

  describe('timing', () => {
    it('touch updates lastMessageTime', () => {
      const before = Date.now();
      state.touch();
      const after = Date.now();
      expect(state.lastMessageTime).toBeGreaterThanOrEqual(before);
      expect(state.lastMessageTime).toBeLessThanOrEqual(after);
    });

    it('getIdleTime returns time since last message', async () => {
      state.touch();
      await new Promise(resolve => setTimeout(resolve, 10));
      const idle = state.getIdleTime();
      expect(idle).toBeGreaterThanOrEqual(10);
    });

    it('getIdleTime returns Infinity if never touched', () => {
      state.lastMessageTime = null;
      expect(state.getIdleTime()).toBe(Infinity);
    });
  });

  describe('toJSON', () => {
    it('serializes state to object', () => {
      state.setAsHost('host-1', 'Test Game');
      const json = state.toJSON();

      expect(json.role).toBe(NetworkRole.HOST);
      expect(json.hostId).toBe('host-1');
      expect(json.sessionId).toBe('host-1');
      expect(json.mySlot).toBe(0);
      expect(json.seqCounter).toBe(0);
      expect(json.players).toHaveLength(1);
      expect(json.sessionName).toBe('Test Game');
      expect(json.maxPlayers).toBe(4);
      expect(json.connected).toBe(true);
    });
  });
});

describe('PlayerStatus', () => {
  it('exports ACTIVE, DISCONNECTED, RECONNECTING', () => {
    expect(PlayerStatus.ACTIVE).toBe('active');
    expect(PlayerStatus.DISCONNECTED).toBe('disconnected');
    expect(PlayerStatus.RECONNECTING).toBe('reconnecting');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(PlayerStatus)).toBe(true);
  });
});
