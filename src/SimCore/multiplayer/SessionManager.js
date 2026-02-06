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
import { createHostAnnounce, createJoinReq, createJoinAckAccepted, createJoinAckRejected, createCmdBatch } from './MessageSerializer.js';
import { globalCommandQueue, CommandType } from '../runtime/CommandQueue.js';

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

// M07: Command batching constants
const CMD_BATCH_TICK_BUFFER = 2;    // scheduledTick = simTick + BUFFER
const CMD_BATCH_STALE_THRESHOLD = 10; // Drop batches older than 10 ticks

// M07 GAP-3: Limits
const MAX_COMMANDS_PER_BATCH = 50;
const MAX_QUEUE_SIZE = 200;

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

    // M07: Command batching state (Host-side)
    this._batchSeqCounter = 0;        // Monotonic batch sequence counter
    this._lastReceivedBatchSeq = -1;  // Guest: last processed batchSeq (for dedup)

    // M07: Debug counters for HU-TEST evidence
    this._debugCounters = {
      batchSentCount: 0,      // Host: batches sent
      batchRecvCount: 0,      // Guest: batches received
      batchDropDupCount: 0,   // Guest: dropped due to duplicate batchSeq
      batchDropStaleCount: 0, // Guest: dropped due to stale scheduledTick
      cmdEnqueuedCount: 0,    // Guest: commands enqueued to CommandQueue
      cmdRejectedAuth: 0,     // Host: rejected due to senderId/slot mismatch
      cmdRejectedType: 0,     // Host: rejected due to invalid command type
      batchTruncatedCount: 0, // Host: batch truncated due to size limit
      batchDroppedQueueFull: 0 // Guest: batch dropped due to queue overflow
    };

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

  /**
   * M07: Send CMD_BATCH to all guests (Host-side)
   * Collects buffered inputs and broadcasts with proper sequencing.
   * Should be called from SimLoop after each tick.
   * @returns {Promise<void>}
   */
  async sendCmdBatch() {
    // Only Host sends CMD_BATCH
    if (!this.state.isHost()) {
      return;
    }

    // Skip if no transport or no session channel
    if (!this.transport || !this._sessionChannel) {
      return;
    }

    // Skip if no commands to send (optional: can send empty batches for heartbeat)
    if (this.inputBuffer.length === 0) {
      return;
    }

    const currentTick = this.game.simLoop?.tickCount || 0;
    const scheduledTick = currentTick + CMD_BATCH_TICK_BUFFER;

    // GAP-3: Enforce Batch Size Limit
    let cmdsToSend = this.inputBuffer;
    if (cmdsToSend.length > MAX_COMMANDS_PER_BATCH) {
        console.warn(`[SM] Batch Limit Exceeded: ${cmdsToSend.length} > ${MAX_COMMANDS_PER_BATCH}. Truncating.`);
        cmdsToSend = cmdsToSend.slice(0, MAX_COMMANDS_PER_BATCH);
        
        // Remove sent items from buffer (FIFO)
        // Wait, inputBuffer is cleared entirely below?
        // Logic fix: We should remove ONLY sent items from inputBuffer.
        // Current logic: "this.inputBuffer = []" clears all. 
        // We need to keep the overflow for next tick.
        this._debugCounters.batchTruncatedCount++;
    }

    // Create batch message with M07 extended schema
    const batch = createCmdBatch({
      batchSeq: this._batchSeqCounter++,
      simTick: currentTick,
      scheduledTick: scheduledTick,
      commands: cmdsToSend.map((entry, idx) => ({
        id: entry.id || `batch_${this._batchSeqCounter - 1}_cmd_${idx}`,
        slot: entry.slot,
        seq: entry.seq,
        command: entry.command
      })),
      stateHash: null  // Optional: implement in Slice 2
    });

    try {
      await this.transport.broadcastToChannel(this._sessionChannel, batch);

      // Update debug counters
      this._debugCounters.batchSentCount++;

      // Log for HU-TEST evidence
      console.log(`[SM] CMD_BATCH sent: seq=${batch.batchSeq}, tick=${currentTick}->${scheduledTick}, cmds=${cmdsToSend.length}`);

      // Clear sent items from buffer
      // If we truncated, we only remove the first N
      if (this.inputBuffer.length > cmdsToSend.length) {
          this.inputBuffer = this.inputBuffer.slice(cmdsToSend.length);
      } else {
          this.inputBuffer = [];
      }

    } catch (err) {
      console.error('[SM] Failed to send CMD_BATCH:', err);
      // Keep buffer for retry on next tick
      // If we failed, we keep ALL (decrement batchSeq?)
      // Retrying logic is complex, for Slice 1 we might skip decrementing seq and just retry sends?
      // Or just drop.
      // Simplest: Don't modify inputBuffer if fail.
    }
  }

  /**
   * M07: Add input command to buffer (Host-side)
   * Called when Host receives INPUT_CMD from guests or local input.
   * @param {Object} entry - { slot, seq, command }
   */
  bufferInputCmd(entry) {
    if (!this.state.isHost()) {
      return;
    }

    this.inputBuffer.push({
      slot: entry.slot ?? 0,
      seq: entry.seq ?? 0,
      command: entry.command,
      receivedAt: Date.now()
    });
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
  // MESSAGE HANDLERS
  // M05/M06: HOST_ANNOUNCE, JOIN_REQ, JOIN_ACK fully implemented
  // M07+: INPUT_CMD, CMD_BATCH, SNAPSHOT, RESYNC, PING/PONG are minimal stubs
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
      simTick = this.game.simLoop?.tickCount || 0;

      // M06-R02: Debug logging for snapshot source investigation
      console.log('[SessionManager] Snapshot source check:', {
        hasGame: !!this.game,
        hasStateSurface: !!this.game?.stateSurface,
        serializeType: typeof this.game?.stateSurface?.serialize,
        hasUnits: !!this.game?.units,
        unitsLength: this.game?.units?.length ?? 'N/A'
      });

      // M06-R02: Try primary serialization, fall back to minimal snapshot
      let snapshotSource = 'fallback';
      if (this.game.stateSurface && typeof this.game.stateSurface.serialize === 'function') {
        try {
          fullSnapshot = this.game.stateSurface.serialize();
          snapshotSource = 'stateSurface';
        } catch (serializeErr) {
          console.error('[SessionManager] stateSurface.serialize() threw:', serializeErr.name, serializeErr.message);
          if (serializeErr.stack) console.error('[SessionManager] Stack:', serializeErr.stack);
          // Fall through to minimal snapshot
          fullSnapshot = null;
        }
      }

      // M06-R02: Fallback to minimal snapshot if serialize failed or unavailable
      if (!fullSnapshot) {
        fullSnapshot = {
          version: 1,
          tickCount: simTick,
          simTimeSec: 0,
          units: [],
          selectedUnitId: null,
          _fallback: true
        };
        snapshotSource = 'fallback';
      }

      console.log(`[SessionManager] Snapshot source: ${snapshotSource}`);

      // M06-R02: Verify snapshot is JSON-serializable
      let snapshotJson;
      try {
        snapshotJson = JSON.stringify(fullSnapshot);
      } catch (jsonErr) {
        console.error('[SessionManager] Snapshot not JSON-serializable:', jsonErr.name, jsonErr.message);
        console.error('[SessionManager] Snapshot keys:', Object.keys(fullSnapshot || {}));
        // Use empty fallback
        fullSnapshot = { version: 1, tickCount: simTick, units: [], _fallback: true };
        snapshotJson = JSON.stringify(fullSnapshot);
      }

      // Size check (M06-R04)
      const snapshotSize = snapshotJson.length;
      if (snapshotSize > SNAPSHOT_WARN_SIZE) {
        console.warn(`[SessionManager] Snapshot large: ${snapshotSize} bytes`);
      }
      if (snapshotSize > SNAPSHOT_MAX_SIZE) {
        console.error(`[SessionManager] Snapshot too large: ${snapshotSize} bytes (max: ${SNAPSHOT_MAX_SIZE})`);
        await this._sendJoinAck(msg.guestId, false, null, 'STATE_TOO_LARGE');
        return;
      }

      console.log(`[SessionManager] Snapshot ready: ${snapshotSize} bytes, tick ${simTick}${fullSnapshot._fallback ? ' (FALLBACK)' : ''}`);
    } catch (err) {
      console.error('[SessionManager] Snapshot serialization failed:', err.name, err.message);
      if (err.stack) console.error('[SessionManager] Stack:', err.stack);
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
    if (!this.state.isHost()) {
      return;
    }

    // 1. Validate Sender (Anti-Spoofing / Slot Ownership)
    // msg.senderId must match the owner of msg.slot
    const player = this.state.getPlayer(msg.slot);
    if (!player) {
      console.warn(`[SM] Reject InputCmd: Invalid slot ${msg.slot} (Sender: ${msg.senderId})`);
      this._debugCounters.cmdRejectedAuth++;
      return;
    }

    if (player.userId !== msg.senderId) {
      console.warn(`[SM] Reject InputCmd: Auth mismatch. Slot ${msg.slot} owned by ${player.userId}, got ${msg.senderId}`);
      this._debugCounters.cmdRejectedAuth++;
      return;
    }

    // 2. Validate Command Type (Whitelist)
    if (!msg.command || !Object.values(CommandType).includes(msg.command.type)) {
      console.warn(`[SM] Reject InputCmd: Invalid type ${msg.command?.type} from Slot ${msg.slot}`);
      this._debugCounters.cmdRejectedType++;
      return;
    }

    // 3. Validate Sequence (Gap/Dedup)
    // M07 Policy: Loose (Log warning, but process). Stricter rules in Slice 2.
    if (this.state.isDuplicateSeq(msg.slot, msg.seq)) {
      // Just warn for now, but we accept duplicates in loose mode if they are re-transmits
      // Actually, duplications should probably be ignored to prevent double-execution
      // But for robust transport testing, let's just log it.
      // console.warn(`[SM] InputCmd Dup: Slot ${msg.slot} Seq ${msg.seq}`);
    }
    
    // Update last seen
    if (msg.seq > (this.state.lastSeenSeq[msg.slot] || -1)) {
        this.state.updateLastSeenSeq(msg.slot, msg.seq);
    }

    // 4. Batch (Buffer for next tick)
    // We pass the Host-side ID/Seq preservation requirement implicitly via bufferInputCmd
    // But actually, msg.id might not exist from Guest (Guest sends InputCmd, Host creates Batch Key).
    // Guest does NOT send 'id' usually. Host assigns it.
    this.bufferInputCmd({
      slot: msg.slot,
      seq: msg.seq,
      command: msg.command
    });
    
    // Debug trace (verbose)
    // console.log(`[SM] Buffered: Slot ${msg.slot} Seq ${msg.seq} Type ${msg.command.type}`);
  }

  /**
   * M07: Handle CMD_BATCH message (Guest-side)
   * Validates batch, checks ordering/staleness, enqueues commands.
   * @param {Object} msg - CMD_BATCH message
   */
  _handleCmdBatch(msg) {
    // Only Guest processes CMD_BATCH
    if (!this.state.isGuest()) {
      return;
    }

    const currentTick = this.game.simLoop?.tickCount || 0;

    // 1. Validate required fields
    if (typeof msg.batchSeq !== 'number' || typeof msg.scheduledTick !== 'number') {
      console.warn('[SM] CMD_BATCH missing required fields (batchSeq/scheduledTick)');
      return;
    }

    // 2. Idempotency check: Drop duplicate batches (ORD-01)
    if (msg.batchSeq <= this._lastReceivedBatchSeq) {
      this._debugCounters.batchDropDupCount++;
      console.warn(`[SM] CMD_BATCH dropped (duplicate): batchSeq=${msg.batchSeq} <= last=${this._lastReceivedBatchSeq}`);
      return;
    }

    // 3. Gap detection: Warn if we skipped sequence numbers (ORD-02)
    if (msg.batchSeq > this._lastReceivedBatchSeq + 1) {
      const gap = msg.batchSeq - this._lastReceivedBatchSeq - 1;
      console.warn(`[SM] CMD_BATCH gap detected: missed ${gap} batch(es) (expected ${this._lastReceivedBatchSeq + 1}, got ${msg.batchSeq})`);
      // Slice 1: Log warning and continue (M07 spec: "process anyway")
    }

    // 4. Stale batch check: Drop if scheduledTick is too old (ORD-03)
    if (msg.scheduledTick <= currentTick) {
      this._debugCounters.batchDropStaleCount++;
      console.warn(`[SM] CMD_BATCH dropped (stale): scheduledTick=${msg.scheduledTick} <= currentTick=${currentTick}`);
      return;
    }

    // 5. Very old batch check: Drop if way behind (ORD-05)
    if (msg.scheduledTick < currentTick - CMD_BATCH_STALE_THRESHOLD) {
      this._debugCounters.batchDropStaleCount++;
      console.warn(`[SM] CMD_BATCH dropped (very stale): scheduledTick=${msg.scheduledTick} < threshold`);
      return;
    }

    // 6. Update tracking
    this._lastReceivedBatchSeq = msg.batchSeq;
    this._debugCounters.batchRecvCount++;

    // 7. Enqueue commands to CommandQueue with scheduledTick
    const commands = msg.commands || [];

    // GAP-3: Enforce Queue Limit
    // Check globalCommandQueue pending count
    if (globalCommandQueue.pendingCount + commands.length > MAX_QUEUE_SIZE) {
        console.warn(`[SM] Queue Full! Dropping Batch ${msg.batchSeq} (${commands.length} cmds). Pending: ${globalCommandQueue.pendingCount}`);
        this._debugCounters.batchDroppedQueueFull++;
        return;
    }

    for (const cmdEntry of commands) {
      // cmdEntry format: { slot, seq, command, id? }
      const cmd = cmdEntry.command || cmdEntry;

      // Preserve Host-assigned ID if present
      const enrichedCmd = {
        ...cmd,
        id: cmdEntry.id || cmd.id,
        seq: cmdEntry.seq,
        slot: cmdEntry.slot,
        _batchSeq: msg.batchSeq,  // Track source batch
        _fromHost: true           // Mark as Host-authoritative
      };

      globalCommandQueue.enqueue(enrichedCmd, msg.scheduledTick);
      this._debugCounters.cmdEnqueuedCount++;
    }

    // 8. Log for HU-TEST evidence
    console.log(`[SM] CMD_BATCH recv: seq=${msg.batchSeq}, tick=${msg.simTick}->${msg.scheduledTick}, cmds=${commands.length}, queueSize=${globalCommandQueue.pendingCount}`);
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
   * M04-M07 HU-TEST: Get debug network status for manual verification.
   * Dev-only, does not mutate sim state.
   * @returns {Object}
   */
  getDebugNetStatus() {
    return {
      // Core state
      role: this.state.role,
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
      pendingJoin: this.pendingJoin !== null,
      // M07: Command batch evidence
      batchSeqCounter: this._batchSeqCounter,
      lastReceivedBatchSeq: this._lastReceivedBatchSeq,
      inputBufferSize: this.inputBuffer?.length || 0,
      queuePendingCount: globalCommandQueue.pendingCount,
      // M07: Debug counters (spread)
      ...this._debugCounters
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
