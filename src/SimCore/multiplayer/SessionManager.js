/**
 * SessionManager.js - R013 Multiplayer Session Coordinator
 *
 * Central coordinator for all multiplayer operations.
 * Orchestrates handshake flow between Host and Guest clients.
 *
 * Reference: docs/specs/R013_MULTIPLAYER_HANDSHAKE_HOST_AUTHORITY.md Section 3
 */

import { SessionState, PlayerStatus } from './SessionState.js';
import { NetworkRole, canStep, sendsInputsToNetwork, broadcastsState } from './NetworkRole.js';
import { MSG, PROTOCOL_VERSION } from './MessageTypes.js';
import { createHostAnnounce } from './MessageSerializer.js';

/**
 * R013 Constants
 */
const LOBBY_CHANNEL = 'asterobia:lobby';
const ANNOUNCE_INTERVAL_MS = 5000;

// M05: Discovery constants
const STALE_HOST_TIMEOUT_MS = 15000;  // 3 missed announces = stale
const MAX_AVAILABLE_HOSTS = 50;       // FIFO eviction if exceeded

/**
 * SessionManager - Central multiplayer coordinator
 *
 * Responsibilities:
 * - Managing session state (Host/Guest/Offline)
 * - Coordinating handshake flow
 * - Routing incoming messages to handlers
 * - Interfacing with Transport layer
 *
 * Usage:
 * ```js
 * const sessionManager = new SessionManager(game);
 * sessionManager.setTransport(transport);
 * await sessionManager.hostGame('My Session');
 * ```
 */
export class SessionManager {
  /**
   * @param {Object} game - Game instance reference
   */
  constructor(game) {
    if (!game) {
      throw new Error('SessionManager requires a game instance');
    }

    /**
     * Reference to the Game instance
     * @type {Object}
     */
    this.game = game;

    /**
     * Session state container
     * @type {SessionState}
     */
    this.state = new SessionState();

    /**
     * Transport layer reference (ITransport implementation)
     * Set via setTransport() before network operations
     * @type {Object|null}
     */
    this.transport = null;

    /**
     * Session name (for Host)
     * @type {string|null}
     */
    this.sessionName = null;

    /**
     * Available hosts map (for Guest discovery)
     * META-GAME STATE: Do not serialize. Not referenced by SimCore.
     * @type {Map<string, Object>}
     */
    this.availableHosts = new Map();

    /**
     * M05: Discovery active flag (idempotency guard)
     * @type {boolean}
     */
    this._discoveryActive = false;

    /**
     * Input buffer for incoming commands (Host-side)
     * @type {Array}
     */
    this.inputBuffer = [];

    /**
     * Pending join promise resolver (Guest-side)
     * @type {Object|null}
     */
    this.pendingJoin = null;

    /**
     * Announce interval ID (Host-side)
     * @type {number|null}
     */
    this.announceInterval = null;

    /**
     * Ping interval ID
     * @type {number|null}
     */
    this.pingInterval = null;

    /**
     * RTT measurement in milliseconds
     * @type {number}
     */
    this.rtt = 0;

    /**
     * Ping sequence counter
     * @type {number}
     */
    this.pingSeq = 0;

    /**
     * Pending pings awaiting PONG response
     * @type {Map<number, number>}
     */
    this.pendingPings = new Map();

    /**
     * Callback when host list updates (for UI)
     * @type {Function|null}
     */
    this.onHostListUpdated = null;

    /**
     * Callback when connection state changes (for UI)
     * @type {Function|null}
     */
    this.onConnectionStateChanged = null;

    /**
     * Snapshot broadcast interval in ticks
     * @type {number}
     */
    this.snapshotInterval = 10;

    // M04 Debug: announce tick evidence (dev-only, no sim mutation)
    this._debugAnnounceTickCount = 0;
    this._debugLastAnnounceAt = null;

    // Bind methods for callbacks
    this._onTransportMessage = this._onTransportMessage.bind(this);
  }

  /**
   * Set the transport layer for network operations
   * @param {Object} transport - ITransport implementation
   */
  setTransport(transport) {
    this.transport = transport;

    // Wire up message callback if transport supports it
    if (transport && typeof transport.onMessage === 'function') {
      transport.onMessage(this._onTransportMessage);
    }

    console.log('[SessionManager] Transport set:', transport ? transport.constructor.name : 'null');
  }

  /**
   * Get the current transport
   * @returns {Object|null}
   */
  getTransport() {
    return this.transport;
  }

  // ========================================
  // HOST OPERATIONS
  // ========================================

  /**
   * Start hosting a game session
   * @param {string} sessionName - Display name for the session
   * @returns {Promise<boolean>} Success status
   */
  async hostGame(sessionName) {
    if (!sessionName) {
      throw new Error('Session name is required');
    }

    if (!this.state.isOffline()) {
      throw new Error('Already in a session. Call leaveGame() first.');
    }

    console.log(`[SessionManager] Starting host: "${sessionName}"`);

    // Generate client ID if not set
    const clientId = this.game.clientId || this._generateClientId();
    if (!this.game.clientId) {
      this.game.clientId = clientId;
    }

    // Transition to HOST state
    this.state.setAsHost(clientId, sessionName);
    this.sessionName = sessionName;

    // R013-M04: Join lobby channel and start announcing
    if (this.transport && typeof this.transport.joinChannel === 'function') {
      try {
        // Join the lobby channel
        await this.transport.joinChannel(LOBBY_CHANNEL, (msg) => this.onMessage(msg));
        console.log(`[SessionManager] Joined lobby channel: ${LOBBY_CHANNEL}`);

        // Send immediate first announce
        await this.sendAnnounce();
        // M04 debug evidence (dev-only)
        if (this.game._isDevMode) {
          this._debugAnnounceTickCount = 1;
          this._debugLastAnnounceAt = Date.now();
        }

        // Start periodic announce (every 5 seconds)
        this.announceInterval = setInterval(() => {
          // M04 debug evidence (dev-only)
          if (this.game._isDevMode) {
            this._debugAnnounceTickCount++;
            this._debugLastAnnounceAt = Date.now();
          }
          this.sendAnnounce().catch(err => {
            console.error('[SessionManager] Announce failed:', err);
          });
        }, ANNOUNCE_INTERVAL_MS);

        console.log(`[SessionManager] Announce interval started (${ANNOUNCE_INTERVAL_MS}ms)`);

      } catch (err) {
        console.error('[SessionManager] Failed to join lobby:', err);
        // Reset state on failure
        this.state.reset();
        this.sessionName = null;
        throw err;
      }
    } else {
      console.warn('[SessionManager] No transport or transport does not support channels. Hosting locally only.');
    }

    // Notify UI
    this._notifyConnectionStateChanged('HOSTING');

    console.log(`[SessionManager] Now hosting as "${sessionName}" (slot 0)`);

    return true;
  }

  /**
   * Send HOST_ANNOUNCE message to lobby channel
   * @returns {Promise<void>}
   */
  async sendAnnounce() {
    if (!this.state.isHost()) {
      console.warn('[SessionManager] sendAnnounce called but not HOST');
      return;
    }

    if (!this.transport || typeof this.transport.broadcastToChannel !== 'function') {
      console.warn('[SessionManager] Cannot announce: no transport or broadcastToChannel');
      return;
    }

    const msg = createHostAnnounce({
      hostId: this.state.hostId,
      sessionName: this.sessionName,
      mapSeed: this.game.mapSeed || 'default-seed',
      simTick: this.game.simLoop?.tickCount || 0,
      currentPlayers: this.state.players.length,
      maxPlayers: this.state.maxPlayers
    });

    try {
      await this.transport.broadcastToChannel(LOBBY_CHANNEL, msg);
      console.log(`[SessionManager] HOST_ANNOUNCE sent (tick: ${msg.simTick}, players: ${msg.currentPlayers}/${msg.maxPlayers})`);
    } catch (err) {
      console.error('[SessionManager] Failed to send announce:', err);
      throw err;
    }
  }

  /**
   * Stop the announce interval (called on leave or disconnect)
   */
  stopAnnouncing() {
    if (this.announceInterval) {
      clearInterval(this.announceInterval);
      this.announceInterval = null;
      console.log('[SessionManager] Announce interval stopped');
    }
  }

  // ========================================
  // GUEST OPERATIONS
  // ========================================

  /**
   * Join an existing game session
   * @param {string} hostId - The host's client ID
   * @returns {Promise<boolean>} Success status
   */
  async joinGame(hostId) {
    if (!hostId) {
      throw new Error('Host ID is required');
    }

    if (!this.state.isOffline()) {
      throw new Error('Already in a session. Call leaveGame() first.');
    }

    console.log(`[SessionManager] Joining host: ${hostId}`);

    // Generate client ID if not set
    const clientId = this.game.clientId || this._generateClientId();
    if (!this.game.clientId) {
      this.game.clientId = clientId;
    }

    // Note: Full join flow will be implemented in M06-M07
    // For now, just set the role to GUEST as a stub

    // Create promise for join completion (will be resolved in M06)
    return new Promise((resolve, reject) => {
      // Stub: immediately transition to GUEST for testing
      // In M06+, this will wait for JOIN_ACK from host
      this.state.setAsGuest(hostId, 1, clientId, 'Guest');

      this._notifyConnectionStateChanged('CONNECTED');

      console.log(`[SessionManager] Joined as Guest (slot 1) - STUB`);
      resolve(true);
    });
  }

  // ========================================
  // M05: DISCOVERY OPERATIONS
  // ========================================

  /**
   * Start listening for HOST_ANNOUNCE messages on the lobby channel.
   * Must be called explicitly - discovery does NOT auto-start.
   * Idempotent: safe to call multiple times.
   *
   * @returns {Promise<void>}
   */
  async startDiscovery() {
    // Idempotency guard
    if (this._discoveryActive) {
      console.log('[SessionManager] Discovery already active');
      return;
    }

    if (!this.transport || typeof this.transport.joinChannel !== 'function') {
      console.warn('[SessionManager] No transport for discovery');
      return;
    }

    try {
      await this.transport.joinChannel(LOBBY_CHANNEL, (msg) => this.onMessage(msg));
      this._discoveryActive = true;
      console.log('[SessionManager] Discovery started');
    } catch (err) {
      console.error('[SessionManager] Failed to start discovery:', err);
      throw err;
    }
  }

  /**
   * Stop listening for HOST_ANNOUNCE messages and clear available hosts.
   * Idempotent: safe to call when discovery is not running.
   */
  stopDiscovery() {
    // Idempotency guard
    if (!this._discoveryActive) {
      return;
    }

    if (this.transport && typeof this.transport.leaveChannel === 'function') {
      this.transport.leaveChannel(LOBBY_CHANNEL).catch(err => {
        console.warn('[SessionManager] Failed to leave lobby channel:', err);
      });
    }

    this.availableHosts.clear();
    this._discoveryActive = false;
    console.log('[SessionManager] Discovery stopped');
  }

  /**
   * Get list of available hosts with lazy stale pruning.
   * META-GAME STATE: This data is NOT part of SimCore determinism.
   *
   * @returns {Array<Object>} Array of HostEntry objects
   */
  getAvailableHosts() {
    const now = Date.now();
    const result = [];

    // Lazy pruning: remove stale entries as we iterate
    for (const [hostId, entry] of this.availableHosts) {
      if (now - entry.lastSeenAt > STALE_HOST_TIMEOUT_MS) {
        // Stale entry - prune it
        this.availableHosts.delete(hostId);
      } else {
        result.push(entry);
      }
    }

    return result;
  }

  /**
   * Check if discovery is currently active
   * @returns {boolean}
   */
  isDiscoveryActive() {
    return this._discoveryActive;
  }

  // ========================================
  // LEAVE / DISCONNECT
  // ========================================

  /**
   * Leave the current session and reset state
   */
  leaveGame() {
    console.log('[SessionManager] Leaving game...');

    // Stop announcing (clears interval)
    this.stopAnnouncing();

    // Stop discovery (clears availableHosts, leaves lobby channel)
    this.stopDiscovery();

    // Clear ping interval
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    // Clear buffers
    this.inputBuffer = [];
    this.pendingPings.clear();

    // Reset pending join
    if (this.pendingJoin) {
      this.pendingJoin.reject?.(new Error('Session left'));
      this.pendingJoin = null;
    }

    // Reset state
    this.state.reset();
    this.sessionName = null;
    this.rtt = 0;
    this.pingSeq = 0;

    this._notifyConnectionStateChanged('OFFLINE');

    console.log('[SessionManager] Left game. State reset to OFFLINE.');
  }

  // ========================================
  // MESSAGE ROUTING
  // ========================================

  /**
   * Route incoming message to appropriate handler
   * @param {Object} msg - Decoded message object
   */
  onMessage(msg) {
    if (!msg || !msg.type) {
      console.warn('[SessionManager] Received invalid message:', msg);
      return;
    }

    // Update heartbeat timing
    this.state.touch();

    // Route based on message type
    switch (msg.type) {
      case MSG.HELLO:
        this._handleHello(msg);
        break;

      case MSG.HOST_ANNOUNCE:
        this._handleHostAnnounce(msg);
        break;

      case MSG.JOIN_REQ:
        this._handleJoinReq(msg);
        break;

      case MSG.JOIN_ACK:
        this._handleJoinAck(msg);
        break;

      case MSG.INPUT_CMD:
        this._handleInputCmd(msg);
        break;

      case MSG.CMD_BATCH:
        this._handleCmdBatch(msg);
        break;

      case MSG.SNAPSHOT:
        this._handleSnapshot(msg);
        break;

      case MSG.RESYNC_REQ:
        this._handleResyncReq(msg);
        break;

      case MSG.RESYNC_ACK:
        this._handleResyncAck(msg);
        break;

      case MSG.PING:
        this._handlePing(msg);
        break;

      case MSG.PONG:
        this._handlePong(msg);
        break;

      default:
        console.warn(`[SessionManager] Unknown message type: ${msg.type}`);
    }
  }

  // ========================================
  // MESSAGE HANDLERS (STUBS - implemented in later M steps)
  // ========================================

  _handleHello(msg) {
    console.log('[SessionManager] HELLO from:', msg.clientId);
  }

  _handleHostAnnounce(msg) {
    // M05: Guest discovery - validate and store host entry
    // META-GAME STATE: availableHosts is NOT part of SimCore determinism

    // Strict protocol version validation
    if (msg.protocolVersion !== PROTOCOL_VERSION) {
      console.log(`[SessionManager] HOST_ANNOUNCE rejected: protocol mismatch (${msg.protocolVersion} !== ${PROTOCOL_VERSION})`);
      return;
    }

    // Required fields validation
    if (!msg.hostId || !msg.sessionName) {
      console.log('[SessionManager] HOST_ANNOUNCE rejected: missing hostId or sessionName');
      return;
    }

    // Don't add self to available hosts
    if (msg.hostId === this.game.clientId) {
      return;
    }

    // FIFO eviction if at max capacity and this is a new host
    if (this.availableHosts.size >= MAX_AVAILABLE_HOSTS && !this.availableHosts.has(msg.hostId)) {
      const oldestKey = this.availableHosts.keys().next().value;
      this.availableHosts.delete(oldestKey);
      console.log(`[SessionManager] Evicted oldest host for FIFO: ${oldestKey}`);
    }

    // Store normalized HostEntry
    this.availableHosts.set(msg.hostId, {
      hostId: msg.hostId,
      sessionName: msg.sessionName,
      playerCount: msg.currentPlayers ?? 1,
      maxPlayers: msg.maxPlayers ?? 4,
      mapSeed: msg.mapSeed ?? '',
      lastSeenAt: Date.now()
    });

    console.log(`[SessionManager] HOST_ANNOUNCE from: ${msg.hostId} (${msg.sessionName})`);

    // Notify UI if callback set
    if (this.onHostListUpdated) {
      this.onHostListUpdated();
    }
  }

  _handleJoinReq(msg) {
    // M06: Host handles join requests
    console.log('[SessionManager] JOIN_REQ from:', msg.guestId);
  }

  _handleJoinAck(msg) {
    // M07: Guest handles join response
    console.log('[SessionManager] JOIN_ACK:', msg.accepted ? 'ACCEPTED' : 'REJECTED');
  }

  _handleInputCmd(msg) {
    // M09: Host processes guest inputs
    console.log('[SessionManager] INPUT_CMD from slot:', msg.slot);
  }

  _handleCmdBatch(msg) {
    // M09: Guest receives command batch
    console.log('[SessionManager] CMD_BATCH for tick:', msg.simTick);
  }

  _handleSnapshot(msg) {
    // M11: Guest applies snapshot
    console.log('[SessionManager] SNAPSHOT for tick:', msg.simTick);
  }

  _handleResyncReq(msg) {
    // N01: Host handles resync request
    console.log('[SessionManager] RESYNC_REQ from:', msg.guestId);
  }

  _handleResyncAck(msg) {
    // N01: Guest applies resync
    console.log('[SessionManager] RESYNC_ACK for tick:', msg.simTick);
  }

  _handlePing(msg) {
    // M12: Respond to ping
    console.log('[SessionManager] PING from:', msg.senderId);
  }

  _handlePong(msg) {
    // M12: Calculate RTT
    const sent = this.pendingPings.get(msg.pingSeq);
    if (sent) {
      this.rtt = Date.now() - sent;
      this.pendingPings.delete(msg.pingSeq);
    }
  }

  // ========================================
  // TRANSPORT CALLBACK
  // ========================================

  /**
   * Internal callback for transport messages
   * @private
   */
  _onTransportMessage(msg) {
    this.onMessage(msg);
  }

  // ========================================
  // UTILITY METHODS
  // ========================================

  /**
   * Generate a unique client ID
   * @private
   * @returns {string}
   */
  _generateClientId() {
    // Use crypto.randomUUID if available, fallback to timestamp-based
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Notify UI of connection state change
   * @private
   * @param {string} state
   */
  _notifyConnectionStateChanged(state) {
    if (this.onConnectionStateChanged) {
      this.onConnectionStateChanged(state);
    }
  }

  // ========================================
  // ACCESSORS
  // ========================================

  /**
   * Get current network role
   * @returns {string}
   */
  getRole() {
    return this.state.role;
  }

  /**
   * Check if this client is the host
   * @returns {boolean}
   */
  isHost() {
    return this.state.isHost();
  }

  /**
   * Check if this client is a guest
   * @returns {boolean}
   */
  isGuest() {
    return this.state.isGuest();
  }

  /**
   * Check if this client is offline
   * @returns {boolean}
   */
  isOffline() {
    return this.state.isOffline();
  }

  /**
   * Check if SimCore.step() should run
   * Based on NetworkRole - only HOST and OFFLINE can step
   * @returns {boolean}
   */
  canStep() {
    return canStep(this.state.role);
  }

  /**
   * Get current RTT measurement
   * @returns {number}
   */
  getRTT() {
    return this.rtt;
  }

  /**
   * Get my player slot
   * @returns {number}
   */
  getMySlot() {
    return this.state.mySlot;
  }

  /**
   * Get connected players list
   * @returns {Array}
   */
  getPlayers() {
    return this.state.players;
  }

  /**
   * M04 HU-TEST: Get debug network status for manual verification.
   * Dev-only, does not mutate sim state.
   * @returns {Object}
   */
  getDebugNetStatus() {
    return {
      isHost: this.state.isHost(),
      sessionName: this.sessionName,
      transportType: this.transport ? this.transport.constructor.name : null,
      announceIntervalActive: this.announceInterval !== null,
      announceTickCount: this._debugAnnounceTickCount,
      lastAnnounceAt: this._debugLastAnnounceAt
    };
  }

  /**
   * Serialize state for debugging
   * @returns {Object}
   */
  toJSON() {
    return {
      role: this.state.role,
      hostId: this.state.hostId,
      sessionName: this.sessionName,
      mySlot: this.state.mySlot,
      players: this.state.players,
      rtt: this.rtt,
      connected: this.state.connected
    };
  }
}
