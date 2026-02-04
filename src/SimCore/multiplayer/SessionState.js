/**
 * SessionState.js - R013 Multiplayer Session State Container
 *
 * Holds all session-related state for multiplayer coordination.
 * Reference: docs/specs/R013_MULTIPLAYER_HANDSHAKE_HOST_AUTHORITY.md Section 2.3
 */

import { NetworkRole } from './NetworkRole.js';

/**
 * Player status enum
 */
export const PlayerStatus = Object.freeze({
  ACTIVE: 'active',
  DISCONNECTED: 'disconnected',
  RECONNECTING: 'reconnecting'
});

/**
 * Player info structure
 * @typedef {Object} PlayerInfo
 * @property {number} slot - Player slot index (0-3)
 * @property {string} userId - Unique user/client ID
 * @property {string} displayName - Display name
 * @property {string} status - PlayerStatus value
 */

/**
 * SessionState - Holds current multiplayer session state
 *
 * Used by SessionManager to track:
 * - Current role (HOST/GUEST/OFFLINE)
 * - Session identification (hostId, sessionId)
 * - Player slot assignment
 * - Sequence counters for message ordering
 * - Connected players list
 * - Deduplication tracking (lastSeenSeq)
 */
export class SessionState {
  constructor() {
    this.reset();
  }

  /**
   * Reset all session state to initial values.
   * Call this when leaving a session or starting fresh.
   */
  reset() {
    // Role: OFFLINE, HOST, or GUEST
    this.role = NetworkRole.OFFLINE;

    // Session identification
    this.hostId = null;      // The host's client ID
    this.sessionId = null;   // Session identifier (same as hostId for now)

    // Player's own slot (0-3), assigned by Host on join
    this.mySlot = 0;

    // Sequence counter for outgoing INPUT_CMD messages
    // Incremented on each command sent
    this.seqCounter = 0;

    // List of players in the session
    // Array of PlayerInfo objects
    this.players = [];

    // For Host: track last seen seq per slot for deduplication
    // { [slot: number]: number }
    this.lastSeenSeq = {};

    // Session metadata
    this.sessionName = null;
    this.maxPlayers = 4;

    // Connection state
    this.connected = false;
    this.lastMessageTime = null;
  }

  /**
   * Transition to HOST role
   * @param {string} clientId - This client's ID (becomes hostId)
   * @param {string} sessionName - Session display name
   */
  setAsHost(clientId, sessionName) {
    this.role = NetworkRole.HOST;
    this.hostId = clientId;
    this.sessionId = clientId;
    this.sessionName = sessionName;
    this.mySlot = 0; // Host is always slot 0
    this.seqCounter = 0;
    this.players = [{
      slot: 0,
      userId: clientId,
      displayName: 'Host',
      status: PlayerStatus.ACTIVE
    }];
    this.lastSeenSeq = {};
    this.connected = true;
    this.lastMessageTime = Date.now();
  }

  /**
   * Transition to GUEST role
   * @param {string} hostId - The host's client ID
   * @param {number} assignedSlot - Slot assigned by host
   * @param {string} clientId - This client's ID
   * @param {string} displayName - This client's display name
   */
  setAsGuest(hostId, assignedSlot, clientId, displayName) {
    this.role = NetworkRole.GUEST;
    this.hostId = hostId;
    this.sessionId = hostId;
    this.mySlot = assignedSlot;
    this.seqCounter = 0;
    this.players = []; // Will be populated from snapshot
    this.lastSeenSeq = {};
    this.connected = true;
    this.lastMessageTime = Date.now();
  }

  /**
   * Add a player to the session (Host-side)
   * @param {PlayerInfo} player
   */
  addPlayer(player) {
    // Check if slot already taken
    const existing = this.players.find(p => p.slot === player.slot);
    if (existing) {
      // Update existing player
      Object.assign(existing, player);
    } else {
      this.players.push(player);
    }
    // Initialize seq tracking
    this.lastSeenSeq[player.slot] = -1;
  }

  /**
   * Remove a player from the session
   * @param {number} slot
   */
  removePlayer(slot) {
    this.players = this.players.filter(p => p.slot !== slot);
    delete this.lastSeenSeq[slot];
  }

  /**
   * Mark a player as disconnected
   * @param {number} slot
   */
  markDisconnected(slot) {
    const player = this.players.find(p => p.slot === slot);
    if (player) {
      player.status = PlayerStatus.DISCONNECTED;
    }
  }

  /**
   * Mark a player as reconnecting
   * @param {number} slot
   */
  markReconnecting(slot) {
    const player = this.players.find(p => p.slot === slot);
    if (player) {
      player.status = PlayerStatus.RECONNECTING;
    }
  }

  /**
   * Mark a player as active
   * @param {number} slot
   */
  markActive(slot) {
    const player = this.players.find(p => p.slot === slot);
    if (player) {
      player.status = PlayerStatus.ACTIVE;
    }
  }

  /**
   * Find next available slot (Host-side)
   * @returns {number|null} Next available slot, or null if full
   */
  findNextSlot() {
    const usedSlots = new Set(this.players.map(p => p.slot));
    for (let slot = 0; slot < this.maxPlayers; slot++) {
      if (!usedSlots.has(slot)) {
        return slot;
      }
    }
    return null; // Session full
  }

  /**
   * Check if session is full
   * @returns {boolean}
   */
  isFull() {
    return this.players.length >= this.maxPlayers;
  }

  /**
   * Get player by slot
   * @param {number} slot
   * @returns {PlayerInfo|undefined}
   */
  getPlayer(slot) {
    return this.players.find(p => p.slot === slot);
  }

  /**
   * Get player by userId
   * @param {string} userId
   * @returns {PlayerInfo|undefined}
   */
  getPlayerByUserId(userId) {
    return this.players.find(p => p.userId === userId);
  }

  /**
   * Increment and return the next seq number
   * @returns {number}
   */
  nextSeq() {
    return this.seqCounter++;
  }

  /**
   * Check if a seq has been seen (for dedup)
   * @param {number} slot
   * @param {number} seq
   * @returns {boolean} True if this is a duplicate
   */
  isDuplicateSeq(slot, seq) {
    const lastSeen = this.lastSeenSeq[slot] ?? -1;
    return seq <= lastSeen;
  }

  /**
   * Update last seen seq for a slot
   * @param {number} slot
   * @param {number} seq
   */
  updateLastSeenSeq(slot, seq) {
    this.lastSeenSeq[slot] = seq;
  }

  /**
   * Update last message time (for disconnect detection)
   */
  touch() {
    this.lastMessageTime = Date.now();
  }

  /**
   * Get time since last message
   * @returns {number} Milliseconds since last message
   */
  getIdleTime() {
    if (!this.lastMessageTime) return Infinity;
    return Date.now() - this.lastMessageTime;
  }

  /**
   * Check if this client is the host
   * @returns {boolean}
   */
  isHost() {
    return this.role === NetworkRole.HOST;
  }

  /**
   * Check if this client is a guest
   * @returns {boolean}
   */
  isGuest() {
    return this.role === NetworkRole.GUEST;
  }

  /**
   * Check if this client is offline (not in a session)
   * @returns {boolean}
   */
  isOffline() {
    return this.role === NetworkRole.OFFLINE;
  }

  /**
   * Serialize state for debugging/logging
   * @returns {Object}
   */
  toJSON() {
    return {
      role: this.role,
      hostId: this.hostId,
      sessionId: this.sessionId,
      mySlot: this.mySlot,
      seqCounter: this.seqCounter,
      players: this.players,
      lastSeenSeq: this.lastSeenSeq,
      sessionName: this.sessionName,
      maxPlayers: this.maxPlayers,
      connected: this.connected
    };
  }
}
