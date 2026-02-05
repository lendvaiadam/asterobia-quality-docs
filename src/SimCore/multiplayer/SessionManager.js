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
import { createHostAnnounce, createJoinReq, createJoinAckAccepted, createJoinAckRejected } from './MessageSerializer.js';

/**
 * R013 Constants
 */
const LOBBY_CHANNEL = 'asterobia:lobby';
const ANNOUNCE_INTERVAL_MS = 5000;

// M05: Discovery constants
const STALE_HOST_TIMEOUT_MS = 15000;  // 3 missed announces = stale
const MAX_AVAILABLE_HOSTS = 50;

// M06: Join handling constants
const SNAPSHOT_WARN_SIZE = 80000;   // 80KB warning threshold
const SNAPSHOT_MAX_SIZE = 100000;   // 100KB hard limit

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
     * META-GAME STATE: Do not serialize
     * @type {Map<string, Object>}
     */
    this.availableHosts = new Map();

    /**
     * M05: Discovery active flag
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

    /**
     * M06: Session channel name (asterobia:session:{hostId})
     * @type {string|null}
     */
    this._sessionChannel = null;

    /**
     * M06: Join request queue for sequential processing (M06-R01 mitigation)
     * @type {Array}
     */
    this._joinQueue = [];

    /**
     * M06: Flag to prevent concurrent join processing
     * @type {boolean}
     */
    this._processingJoin = false;

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

        // M06: Join session channel for JOIN_REQ messages
        this._sessionChannel = `asterobia:session:${clientId}`;
        await this.transport.joinChannel(this._sessionChannel, (msg) => this.onMessage(msg));
        console.log(`[SessionManager] Joined session channel: ${this._sessionChannel}`);

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
  // GUEST DISCOVERY (M05)
  // ========================================

  /**
   * M05: Start listening for HOST_ANNOUNCE messages.
   * Idempotent: safe to call when already active.
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
   * M05: Stop listening for HOST_ANNOUNCE messages.
   * Idempotent: safe to call when not active.
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
   * M05: Get available hosts with lazy stale pruning.
   * META-GAME STATE: Do not serialize.
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
   * M05: Check if discovery is currently active
   * @returns {boolean}
   */
  isDiscoveryActive() {
    return this._discoveryActive;
  }

  // ========================================
  // GUEST OPERATIONS
  // ========================================

  /**
   * M06: Join an existing game session via transport handshake
   * @param {string} hostId - The host's client ID
   * @returns {Promise<boolean>} Success status (resolves on JOIN_ACK)
   */
  async joinGame(hostId) {
    if (!hostId) {
      throw new Error('Host ID is required');
    }

    if (!this.state.isOffline()) {
      throw new Error('Already in a session. Call leaveGame() first.');
    }

    // Generate client ID if not set
    const clientId = this.game.clientId || this._generateClientId();
    if (!this.game.clientId) {
      this.game.clientId = clientId;
    }

    // M06: Verify transport is available
    if (!this.transport || typeof this.transport.joinChannel !== 'function') {
      throw new Error('No transport available for join');
    }

    console.log(`[SessionManager] Joining host: ${hostId}`);

    // M06: Join host's session channel
    const sessionChannel = `asterobia:session:${hostId}`;
    try {
      await this.transport.joinChannel(sessionChannel, (msg) => this.onMessage(msg));
      this._sessionChannel = sessionChannel;
      console.log(`[SessionManager] Joined session channel: ${sessionChannel}`);
    } catch (err) {
      console.error('[SessionManager] Failed to join session channel:', err);
      throw err;
    }

    // M06: Create and send JOIN_REQ
    const joinReq = createJoinReq({
      guestId: clientId,
      displayName: this.game.playerName || 'Guest'
    });

    // M06: Debug evidence (dev-only)
    if (this.game._isDevMode) {
      this._debugJoinReqSentCount = (this._debugJoinReqSentCount || 0) + 1;
      this._debugLastJoinReqAt = Date.now();
    }

    try {
      await this.transport.broadcastToChannel(sessionChannel, joinReq);
      console.log(`[SessionManager] JOIN_REQ sent to ${hostId}`);
    } catch (err) {
      console.error('[SessionManager] Failed to send JOIN_REQ:', err);
      // Leave session channel on failure
      this.transport.leaveChannel(sessionChannel).catch(() => {});
      this._sessionChannel = null;
      throw err;
    }

    // M06: Wait for JOIN_ACK with timeout
    return new Promise((resolve, reject) => {
      this.pendingJoin = { resolve, reject, hostId, clientId };

      // Timeout after 10s
      const timeoutId = setTimeout(() => {
        if (this.pendingJoin) {
          console.log('[SessionManager] Join timeout - no response from host');
          this.pendingJoin = null;
          // Cleanup session channel
          if (this._sessionChannel) {
            this.transport.leaveChannel(this._sessionChannel).catch(() => {});
            this._sessionChannel = null;
          }
          reject(new Error('Join timeout - no response from host'));
        }
      }, 10000);

      // Store timeout ID so _handleJoinAck can clear it
      this.pendingJoin.timeoutId = timeoutId;
    });
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

    // M05: Stop discovery if active
    this.stopDiscovery();

    // Clear ping interval
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    // Leave lobby channel if transport supports it (Host was on lobby)
    if (this.state.isHost() && this.transport && typeof this.transport.leaveChannel === 'function') {
      this.transport.leaveChannel(LOBBY_CHANNEL).catch(err => {
        console.warn('[SessionManager] Failed to leave lobby channel:', err);
      });
    }

    // M06: Leave session channel
    if (this._sessionChannel && this.transport && typeof this.transport.leaveChannel === 'function') {
      this.transport.leaveChannel(this._sessionChannel).catch(err => {
        console.warn('[SessionManager] Failed to leave session channel:', err);
      });
    }

    // M06: Clear session channel and join queue
    this._sessionChannel = null;
    this._joinQueue = [];
    this._processingJoin = false;

    // Clear buffers
    this.inputBuffer = [];
    this.pendingPings.clear();
    this.availableHosts.clear();

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
  // MESSAGE HANDLERS (placeholders for later M steps)
  // ========================================

  _handleHello(msg) {
    console.log('[SessionManager] HELLO from:', msg.clientId);
  }

  /**
   * M05: Handle HOST_ANNOUNCE message for guest discovery
   * @param {Object} msg - HOST_ANNOUNCE message
   */
  _handleHostAnnounce(msg) {
    // Only process if discovery is active
    if (!this._discoveryActive) {
      return;
    }

    // Strict protocol version match
    if (msg.protocolVersion !== PROTOCOL_VERSION) {
      return;
    }

    // Required fields validation
    if (!msg.hostId || !msg.sessionName) {
      return;
    }

    // Don't add self
    if (msg.hostId === this.game.clientId) {
      return;
    }

    // FIFO eviction if at max
    if (this.availableHosts.size >= MAX_AVAILABLE_HOSTS && !this.availableHosts.has(msg.hostId)) {
      const oldestKey = this.availableHosts.keys().next().value;
      this.availableHosts.delete(oldestKey);
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

    // Notify UI if callback registered
    if (this.onHostListUpdated) {
      this.onHostListUpdated(this.getAvailableHosts());
    }
  }

  /**
   * M06: Handle JOIN_REQ message (Host-side)
   * Queues requests for sequential processing to prevent race conditions (M06-R01)
   * @param {Object} msg - JOIN_REQ message
   */
  _handleJoinReq(msg) {
    // Only Host processes JOIN_REQ
    if (!this.state.isHost()) {
      return;
    }

    console.log('[SessionManager] JOIN_REQ from:', msg.guestId);

    // Queue the request for sequential processing
    this._joinQueue.push(msg);
    this._processJoinQueue();
  }

  /**
   * M06: Process join queue sequentially (M06-R01 mitigation)
   * Prevents race conditions when multiple guests join simultaneously
   * @private
   */
  async _processJoinQueue() {
    if (this._processingJoin || this._joinQueue.length === 0) {
      return;
    }

    this._processingJoin = true;

    const msg = this._joinQueue.shift();
    await this._doHandleJoinReq(msg);

    this._processingJoin = false;

    // Process next request if any
    if (this._joinQueue.length > 0) {
      this._processJoinQueue();
    }
  }

  /**
   * M06: Actual JOIN_REQ processing logic
   * @private
   * @param {Object} msg - JOIN_REQ message
   */
  async _doHandleJoinReq(msg) {
    // 1. Protocol version validation
    if (msg.protocolVersion !== PROTOCOL_VERSION) {
      console.log(`[SessionManager] JOIN_REQ rejected: version mismatch (${msg.protocolVersion} !== ${PROTOCOL_VERSION})`);
      await this._sendJoinAck(msg.guestId, false, null, 'VERSION_MISMATCH');
      return;
    }

    // 2. Required fields validation
    if (!msg.guestId) {
      console.log('[SessionManager] JOIN_REQ rejected: missing guestId');
      await this._sendJoinAck(null, false, null, 'INVALID_REQUEST');
      return;
    }
    if (!msg.displayName) {
      console.log('[SessionManager] JOIN_REQ rejected: missing displayName');
      await this._sendJoinAck(msg.guestId, false, null, 'INVALID_REQUEST');
      return;
    }

    // 3. Duplicate check (idempotency) - ignore if already joined
    if (this.state.getPlayerByUserId(msg.guestId)) {
      console.log(`[SessionManager] JOIN_REQ ignored: ${msg.guestId} already joined`);
      return;
    }

    // 4. Session full check
    const slot = this.state.findNextSlot();
    if (slot === null) {
      console.log('[SessionManager] JOIN_REQ rejected: session full');
      await this._sendJoinAck(msg.guestId, false, null, 'SESSION_FULL');
      return;
    }

    // 5. Serialize snapshot with error handling (M06-R02)
    let fullSnapshot;
    let simTick;
    try {
      fullSnapshot = this.game.stateSurface.serialize();
      simTick = this.game.simLoop?.tickCount || 0;

      // Size check (M06-R04)
      const snapshotSize = JSON.stringify(fullSnapshot).length;
      if (snapshotSize > SNAPSHOT_WARN_SIZE) {
        console.warn(`[SessionManager] Snapshot large: ${snapshotSize} bytes`);
      }
      if (snapshotSize > SNAPSHOT_MAX_SIZE) {
        console.error(`[SessionManager] Snapshot too large: ${snapshotSize} bytes (max: ${SNAPSHOT_MAX_SIZE})`);
        await this._sendJoinAck(msg.guestId, false, null, 'STATE_TOO_LARGE');
        return;
      }
    } catch (err) {
      console.error('[SessionManager] Snapshot serialization failed:', err);
      await this._sendJoinAck(msg.guestId, false, null, 'SNAPSHOT_ERROR');
      return;
    }

    // 6. Add player to session
    this.state.addPlayer({
      slot,
      userId: msg.guestId,
      displayName: msg.displayName,
      status: PlayerStatus.ACTIVE
    });

    // 7. Send JOIN_ACK with snapshot
    await this._sendJoinAck(msg.guestId, true, slot, null, simTick, fullSnapshot);

    console.log(`[SessionManager] Guest ${msg.displayName} joined as slot ${slot}`);
  }

  /**
   * M06: Send JOIN_ACK message to session channel
   * @private
   * @param {string} guestId - Target guest ID
   * @param {boolean} accepted - Whether join was accepted
   * @param {number|null} slot - Assigned slot (if accepted)
   * @param {string|null} reason - Rejection reason (if rejected)
   * @param {number|null} simTick - Current sim tick (if accepted)
   * @param {Object|null} fullSnapshot - Game state snapshot (if accepted)
   */
  async _sendJoinAck(guestId, accepted, slot = null, reason = null, simTick = null, fullSnapshot = null) {
    if (!this.transport || typeof this.transport.broadcastToChannel !== 'function') {
      console.warn('[SessionManager] Cannot send JOIN_ACK: no transport');
      return;
    }

    if (!this._sessionChannel) {
      console.warn('[SessionManager] Cannot send JOIN_ACK: no session channel');
      return;
    }

    let msg;
    if (accepted) {
      msg = createJoinAckAccepted({
        assignedSlot: slot,
        simTick,
        fullSnapshot
      });
    } else {
      msg = createJoinAckRejected(reason);
    }

    try {
      await this.transport.broadcastToChannel(this._sessionChannel, msg);
      console.log(`[SessionManager] JOIN_ACK sent to ${guestId}: ${accepted ? `ACCEPTED (slot ${slot})` : `REJECTED (${reason})`}`);
    } catch (err) {
      console.error('[SessionManager] Failed to send JOIN_ACK:', err);
    }
  }

  /**
   * M06: Handle JOIN_ACK response from host
   * Resolves or rejects the pending join promise
   * @param {Object} msg - JOIN_ACK message
   */
  _handleJoinAck(msg) {
    // Only process if we have a pending join
    if (!this.pendingJoin) {
      console.log('[SessionManager] JOIN_ACK received but no pending join');
      return;
    }

    // M06: Debug evidence (dev-only)
    if (this.game._isDevMode) {
      this._debugJoinAckRecvCount = (this._debugJoinAckRecvCount || 0) + 1;
      this._debugLastJoinAckAt = Date.now();
    }

    // Clear timeout
    if (this.pendingJoin.timeoutId) {
      clearTimeout(this.pendingJoin.timeoutId);
    }

    const { resolve, reject, hostId, clientId } = this.pendingJoin;

    if (msg.accepted) {
      // M06: Transition to GUEST state
      this.state.setAsGuest(hostId, msg.assignedSlot, clientId, this.game.playerName || 'Guest');

      // M06: Apply snapshot if provided
      if (msg.fullSnapshot && this.game.stateSurface) {
        console.log(`[SessionManager] Applying snapshot at tick ${msg.simTick}`);
        try {
          this.game.stateSurface.deserialize(msg.fullSnapshot);
          if (this.game.simLoop) {
            this.game.simLoop.tickCount = msg.simTick;
          }
        } catch (err) {
          console.error('[SessionManager] Failed to apply snapshot:', err);
        }
      }

      this._notifyConnectionStateChanged('CONNECTED');
      console.log(`[SessionManager] Joined as Guest (slot ${msg.assignedSlot})`);

      this.pendingJoin = null;
      resolve(true);
    } else {
      // M06: Join rejected - accept both field names for compatibility, coerce to UNKNOWN_ERROR if missing
      const reason = msg.rejectReason ?? msg.reason ?? 'UNKNOWN_ERROR';
      console.log(`[SessionManager] Join rejected: ${reason}`);

      // Cleanup session channel
      if (this._sessionChannel) {
        this.transport?.leaveChannel?.(this._sessionChannel).catch(() => {});
        this._sessionChannel = null;
      }

      this.pendingJoin = null;
      reject(new Error(`Join rejected: ${reason}`));
    }
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
      isGuest: this.state.isGuest(),
      sessionName: this.sessionName,
      transportType: this.transport ? this.transport.constructor.name : null,
      // M04: Host announce evidence
      announceIntervalActive: this.announceInterval !== null,
      announceTickCount: this._debugAnnounceTickCount,
      lastAnnounceAt: this._debugLastAnnounceAt,
      // M05: Discovery evidence
      discoveryActive: this._discoveryActive,
      availableHostsCount: this.availableHosts.size,
      // M06: Join handshake evidence
      joinReqSentCount: this._debugJoinReqSentCount || 0,
      joinAckRecvCount: this._debugJoinAckRecvCount || 0,
      lastJoinReqAt: this._debugLastJoinReqAt || null,
      lastJoinAckAt: this._debugLastJoinAckAt || null,
      pendingJoin: this.pendingJoin !== null
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
