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
import { createHostAnnounce, createJoinReq, createJoinAckAccepted, createJoinAckRejected, createCmdBatch, createSeatReq, createSeatAck, createSeatReject, createSeatRelease, createHostLeave, createGuestLeave } from './MessageSerializer.js';
import { globalCommandQueue, CommandType } from '../runtime/CommandQueue.js';
// NOTE: Do NOT import 'three' here - SessionManager runs in Node tests.
// Vector3 reconstruction happens in Game.js via onPositionSync callback.

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

// M07 GAP-0: Seat cooldown levels (progressive backoff)
const SEAT_COOLDOWN_LEVELS = [250, 500, 1000, 2000]; // ms, capped at 2000
// Tick-based equivalents (50ms/tick): [5, 10, 20, 40] ticks
const SIM_TICK_MS = 50;
const SEAT_COOLDOWN_TICKS = SEAT_COOLDOWN_LEVELS.map(ms => Math.round(ms / SIM_TICK_MS));

// Host-leave resilience constants
const HOST_ABSENCE_TIMEOUT_MS = 15000;  // No HOST_ANNOUNCE for 15s = host absent
const HOST_MIGRATION_GRACE_MS = 3000;   // Wait 3s grace period before promoting
const HOST_ABSENCE_CHECK_INTERVAL_MS = 2000; // Check for host absence every 2s

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
      batchDroppedQueueFull: 0, // Guest: batch dropped due to queue overflow
      // M07 GAP-0: Seat counters
      seatReqCount: 0,        // Total SEAT_REQ received
      seatAckCount: 0,        // Total SEAT_ACK sent/received
      seatRejectCount: 0,     // Total SEAT_REJECT sent
      seatCooldownHitCount: 0 // Cooldowns triggered
    };

    // M07 GAP-0: Seat cooldown tracking (Host-side)
    // Key: `${requesterSlot}_${targetUnitId}`, Value: { until: timestamp, level: 0-3 }
    this._seatCooldowns = new Map();

    // Host-leave resilience state (Guest-side)
    /** @type {number|null} Timestamp of last HOST_ANNOUNCE received */
    this._hostLastSeenAt = null;
    /** @type {boolean} Whether migration grace period is active */
    this._migrationGraceActive = false;
    /** @type {number|null} Timestamp when grace period started */
    this._migrationGraceStartedAt = null;
    /** @type {number|null} Interval ID for host absence checking */
    this._hostAbsenceCheckInterval = null;

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
    this.state.setAsHost(clientId, sessionName, this.game.playerName);
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

    // Host-leave resilience: after migration, the Host may not be slot 0
    const hostPlayer = this.state.getPlayer(this.state.mySlot) || this.state.getPlayer(0);
    const msg = createHostAnnounce({
      hostId: this.state.hostId,
      sessionName: this.sessionName,
      hostDisplayName: hostPlayer?.displayName || this.game.playerName || 'Host',
      mapSeed: this.game.mapSeed || 'default-seed',
      simTick: this.game.simLoop?.tickCount || 0,
      currentPlayers: this.state.players.length,
      maxPlayers: this.state.maxPlayers
    });

    try {
      await this.transport.broadcastToChannel(LOBBY_CHANNEL, msg);

      // Also broadcast HOST_ANNOUNCE on the session channel so in-session
      // Guests can track host presence for host-leave resilience.
      // Without this, Guests that are NOT on the lobby channel would never
      // receive HOST_ANNOUNCE and would falsely trigger host migration.
      if (this._sessionChannel) {
        await this.transport.broadcastToChannel(this._sessionChannel, msg);
      }

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
      stateHash: this.game._lastStateHash || null  // Slice 2: determinism verification
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
   * Send authoritative unit positions to all guests (Host-side).
   * Called periodically from SimLoop or game tick to broadcast local
   * unit positions to the other client(s). Both Host and Guest send.
   * @returns {Promise<void>}
   */
  async sendPositionSync() {
    // Both Host and Guest send position sync in networked mode
    if (this.state.isOffline()) return;
    if (!this.transport || !this._sessionChannel) return;

    const units = this.game.units;
    if (!units || units.length === 0) return;

    const currentTick = this.game.simLoop?.tickCount || 0;

    // Build full state array for all units (position + rotation + path state)
    const unitStates = [];
    for (const unit of units) {
        if (!unit) continue;
        const entry = {
            id: unit.id,
            // Position
            px: unit.position.x,
            py: unit.position.y,
            pz: unit.position.z,
            // Rotation (mesh quaternion)
            qx: unit.mesh?.quaternion?.x || 0,
            qy: unit.mesh?.quaternion?.y || 0,
            qz: unit.mesh?.quaternion?.z || 0,
            qw: unit.mesh?.quaternion?.w || 1,
            // Path-following state
            fp: unit.isFollowingPath ? 1 : 0,
            pi: unit.pathIndex || 0,
            pc: unit.isPathClosed ? 1 : 0,
            kb: unit.isKeyboardOverriding ? 1 : 0
        };
        // Include path points (compact: flat array of x,y,z triples)
        if (unit.path && unit.path.length > 0) {
            const flatPath = [];
            for (const p of unit.path) {
                flatPath.push(p.x, p.y, p.z);
            }
            entry.pp = flatPath;
        }
        // Include waypoint commands (compact: type + position)
        if (unit.commands && unit.commands.length > 0) {
            entry.cmds = unit.commands.map(c => ({
                t: c.type,
                s: c.status,
                px: c.params?.position?.x,
                py: c.params?.position?.y,
                pz: c.params?.position?.z
            }));
        }
        unitStates.push(entry);
    }

    try {
        await this.transport.broadcastToChannel(this._sessionChannel, {
            type: 'POSITION_SYNC',
            tick: currentTick,
            units: unitStates,
            timestamp: Date.now()
        });
        this._debugCounters.positionSyncSentCount = (this._debugCounters.positionSyncSentCount || 0) + 1;
    } catch (err) {
        if (this.game._isDevMode) {
            console.warn('[SM] POSITION_SYNC send failed:', err.message);
        }
    }
  }

  /**
   * Phase 2A: Send MOVE_INPUT to server (client intent-based input).
   * Called at ~20Hz by Game.js when in mirror mode.
   * @param {Object} keys - { forward, backward, left, right } booleans
   * @param {number} [unitId] - Optional target unit ID (seated/selected unit)
   * @returns {Promise<void>}
   */
  async sendMoveInput(keys, unitId) {
    if (this.state.isOffline()) return;
    if (!this.transport || !this._sessionChannel) return;

    const msg = {
      type: 'MOVE_INPUT',
      forward: !!keys.forward,
      backward: !!keys.backward,
      left: !!keys.left,
      right: !!keys.right,
      timestamp: Date.now()
    };

    if (unitId != null) {
      msg.unitId = unitId;
    }

    try {
      await this.transport.broadcastToChannel(this._sessionChannel, msg);
      this._debugCounters.moveInputSentCount = (this._debugCounters.moveInputSentCount || 0) + 1;
    } catch (err) {
      if (this.game._isDevMode) {
        console.warn('[SessionManager] sendMoveInput failed:', err.message);
      }
    }
  }

  /**
   * Phase 2B: Send PATH_DATA to server for server-authoritative path-follow.
   * Client computes A* waypoints, server validates and executes kinematic movement.
   *
   * @param {number} unitId - Target unit ID (must be owned by sender)
   * @param {Array<{x:number,y:number,z:number}>} waypoints - Path waypoints
   * @param {boolean} [closed=false] - Whether path loops
   * @returns {Promise<void>}
   */
  async sendPathData(unitId, waypoints, closed = false) {
    if (this.state.isOffline()) return;
    if (!this.transport || !this._sessionChannel) return;

    const msg = {
      type: 'PATH_DATA',
      unitId,
      waypoints: waypoints.map(wp => ({ x: wp.x, y: wp.y, z: wp.z })),
      closed: !!closed,
      timestamp: Date.now()
    };

    try {
      await this.transport.broadcastToChannel(this._sessionChannel, msg);
      this._debugCounters.pathDataSentCount = (this._debugCounters.pathDataSentCount || 0) + 1;
    } catch (err) {
      if (this.game._isDevMode) {
        console.warn('[SessionManager] sendPathData failed:', err.message);
      }
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
    console.log(`[SessionManager] Transport: ${this.transport?.constructor?.name || 'NONE'}, channels: ${this.transport?._channels?.size ?? 'N/A'}`);

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

    // R013: Stabilization delay - Supabase Realtime needs a brief moment after
    // SUBSCRIBED status before broadcast messages reliably propagate to all members.
    // Without this, JOIN_REQ may be sent before the Host's channel sees the Guest.
    await new Promise(resolve => setTimeout(resolve, 500));
    console.log('[SessionManager] Channel stabilization delay complete, sending JOIN_REQ');

    // M06: Create and send JOIN_REQ
    const joinReq = createJoinReq({
      guestId: clientId,
      displayName: this.game.playerName || 'Guest'
    });

    // Always track join diagnostic counters (not gated by _isDevMode)
    this._debugJoinReqSentCount = (this._debugJoinReqSentCount || 0) + 1;
    this._debugLastJoinReqAt = Date.now();

    try {
      await this.transport.broadcastToChannel(sessionChannel, joinReq);
      console.log(`[SessionManager] JOIN_REQ sent to ${hostId} (count: ${this._debugJoinReqSentCount})`);
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

      const timeoutId = setTimeout(() => {
        if (this.pendingJoin) {
          // Comprehensive debug info for HU-test diagnostics
          const transportDebug = typeof this.transport?.getDebugInfo === 'function'
            ? this.transport.getDebugInfo()
            : { type: this.transport?.constructor?.name || 'NONE' };
          const debugInfo = {
            hostId: this.pendingJoin.hostId,
            clientId: this.pendingJoin.clientId,
            sessionChannel: this._sessionChannel,
            channelJoined: this.transport?.isJoinedToChannel?.(this._sessionChannel) ?? 'unknown',
            joinReqsSent: this._debugJoinReqSentCount || 0,
            joinAcksRecv: this._debugJoinAckRecvCount || 0,
            transport: transportDebug
          };
          console.error('[SessionManager] Join timeout - no response from host. Debug:', JSON.stringify(debugInfo, null, 2));
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
   * Gracefully leave the current session.
   * Broadcasts HOST_LEAVE or GUEST_LEAVE to remaining players, then tears down.
   * Call this from UI instead of leaveGame() so other players are notified immediately.
   * @returns {Promise<void>}
   */
  async gracefulLeaveGame() {
    // Broadcast leave message BEFORE tearing down channels
    if (this.transport && this._sessionChannel && typeof this.transport.broadcastToChannel === 'function') {
      try {
        if (this.state.isHost()) {
          const msg = createHostLeave({ hostId: this.state.hostId });
          await this.transport.broadcastToChannel(this._sessionChannel, msg);
          if (this.game._isDevMode) {
            console.log('[SM] HOST_LEAVE broadcast sent');
          }
        } else if (this.state.isGuest()) {
          const msg = createGuestLeave({ slot: this.state.mySlot });
          await this.transport.broadcastToChannel(this._sessionChannel, msg);
          if (this.game._isDevMode) {
            console.log('[SM] GUEST_LEAVE broadcast sent');
          }
        }
      } catch (err) {
        if (this.game._isDevMode) {
          console.warn('[SM] Failed to broadcast leave message:', err);
        }
      }
    }

    // Now do the full teardown
    this.leaveGame();
  }

  /**
   * Leave the current session and reset state.
   * Low-level teardown - does NOT broadcast a leave message.
   * Use gracefulLeaveGame() from UI to notify other players before disconnecting.
   */
  leaveGame() {
    console.log('[SessionManager] Leaving game...');

    // Stop announcing (clears interval)
    this.stopAnnouncing();

    // M05: Stop discovery if active
    this.stopDiscovery();

    // Stop host absence checking
    this._stopHostAbsenceCheck();

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

    // Reset host-leave resilience state
    this._hostLastSeenAt = null;
    this._migrationGraceActive = false;
    this._migrationGraceStartedAt = null;

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

    // Host-leave resilience: Track host presence from ANY message type
    // on the session channel. CMD_BATCH, JOIN_ACK, SEAT_ACK etc. all prove host is alive.
    if (this.state.isGuest() && this._hostLastSeenAt !== null) {
      // Only certain message types come from the Host
      const hostMessageTypes = [
        MSG.HOST_ANNOUNCE, MSG.JOIN_ACK, MSG.CMD_BATCH,
        MSG.SNAPSHOT, MSG.RESYNC_ACK, MSG.SEAT_ACK, MSG.SEAT_REJECT
      ];
      if (hostMessageTypes.includes(msg.type)) {
        this._hostLastSeenAt = Date.now();
        // Cancel grace period if host is back
        if (this._migrationGraceActive) {
          this._migrationGraceActive = false;
          this._migrationGraceStartedAt = null;
          if (this.game._isDevMode) {
            console.log('[SM] Host presence restored via message - cancelling migration grace');
          }
        }
      }
    }

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

      // M07 GAP-0: Seat messages
      case MSG.SEAT_REQ:
        this._handleSeatReq(msg);
        break;

      case MSG.SEAT_ACK:
        this._handleSeatAck(msg);
        break;

      case MSG.SEAT_REJECT:
        this._handleSeatReject(msg);
        break;

      case MSG.SEAT_RELEASE:
        this._handleSeatRelease(msg);
        break;

      // Host-leave resilience
      case MSG.HOST_LEAVE:
        this._handleHostLeave(msg);
        break;

      case MSG.GUEST_LEAVE:
        this._handleGuestLeave(msg);
        break;

      case MSG.POSITION_SYNC:
        this._handlePositionSync(msg);
        break;

      case MSG.SERVER_SNAPSHOT:
        this._handleServerSnapshot(msg);
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
   * Host presence tracking for in-session guests is handled centrally in onMessage().
   * @param {Object} msg - HOST_ANNOUNCE message
   */
  _handleHostAnnounce(msg) {
    // Only process discovery logic if discovery is active
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
      hostDisplayName: msg.hostDisplayName || msg.sessionName,
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
    console.log(`[SessionManager] JOIN_REQ version check: msg=${msg.protocolVersion}, expected=${PROTOCOL_VERSION}`);
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

    // 7. Send JOIN_ACK with snapshot (include host display name for Guest HUD)
    const hostPlayer = this.state.getPlayer(0) || this.state.getPlayer(this.state.mySlot);
    const hostDisplayName = hostPlayer?.displayName || this.game.playerName || 'Host';
    await this._sendJoinAck(msg.guestId, true, slot, null, simTick, fullSnapshot, hostDisplayName);

    console.log(`[SessionManager] Guest ${msg.displayName} joined as slot ${slot}`);

    // Notify Host-side UI that a guest connected (triggers overlay hide, tab refresh)
    this._notifyConnectionStateChanged('HOSTING');
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
  async _sendJoinAck(guestId, accepted, slot = null, reason = null, simTick = null, fullSnapshot = null, hostDisplayName = null) {
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
        fullSnapshot,
        hostDisplayName
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

    // Always track join diagnostic counters (not gated by _isDevMode)
    this._debugJoinAckRecvCount = (this._debugJoinAckRecvCount || 0) + 1;
    this._debugLastJoinAckAt = Date.now();
    console.log(`[SessionManager] JOIN_ACK received (count: ${this._debugJoinAckRecvCount}, accepted: ${msg.accepted})`);

    // Clear timeout
    if (this.pendingJoin.timeoutId) {
      clearTimeout(this.pendingJoin.timeoutId);
    }

    const { resolve, reject, hostId, clientId } = this.pendingJoin;

    if (msg.accepted) {
      // M06: Transition to GUEST state (pass host display name for HUD)
      this.state.setAsGuest(hostId, msg.assignedSlot, clientId, this.game.playerName || 'Guest', msg.hostDisplayName);

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

      // Host-leave resilience: Start tracking host presence
      this._hostLastSeenAt = Date.now();
      this._startHostAbsenceCheck();

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

    // M07 Unit Authority v0: Validate seat authority
    // If command targets a unit, verify sender has seat on that unit
    const targetUnitId = msg.command?.unitId;
    if (targetUnitId !== undefined && targetUnitId !== null) {
      const unit = this.game.units?.find(u => u && u.id === targetUnitId);
      if (unit && unit.selectedBySlot !== null && unit.selectedBySlot !== undefined && unit.selectedBySlot !== msg.slot) {
        console.warn(`[SM] Reject InputCmd: Slot ${msg.slot} not seated on unit ${targetUnitId} (selectedBySlot: ${unit.selectedBySlot})`);
        this._debugCounters.cmdRejectedAuth++;
        return;
      }
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

    // 4. If batch is for current or past tick, execute immediately (don't drop)
    if (msg.scheduledTick <= currentTick) {
      // Late batch - reschedule to next tick instead of dropping
      msg.scheduledTick = currentTick + 1;
      if (this.game._isDevMode) {
        console.warn(`[SM] CMD_BATCH late: rescheduled to tick ${msg.scheduledTick}`);
      }
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
    const cmdQueue = this.game?.commandQueue || globalCommandQueue;
    if (cmdQueue.pendingCount + commands.length > MAX_QUEUE_SIZE) {
        console.warn(`[SM] Queue Full! Dropping Batch ${msg.batchSeq} (${commands.length} cmds). Pending: ${cmdQueue.pendingCount}`);
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

      cmdQueue.enqueue(enrichedCmd, msg.scheduledTick);
      this._debugCounters.cmdEnqueuedCount++;
    }

    // 8. Slice 2: State hash comparison for determinism verification
    if (msg.stateHash && this.game._lastStateHash) {
      const match = msg.stateHash === this.game._lastStateHash;
      if (!match && this.game._isDevMode) {
        console.warn(`[SessionManager] StateHash MISMATCH at tick ${msg.simTick}! Host: ${msg.stateHash.substring(0, 30)} vs Local: ${this.game._lastStateHash.substring(0, 30)}`);
      }
    }

    // 9. Log for HU-TEST evidence
    console.log(`[SM] CMD_BATCH recv: seq=${msg.batchSeq}, tick=${msg.simTick}->${msg.scheduledTick}, cmds=${commands.length}, queueSize=${cmdQueue.pendingCount}`);
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
  // M07 GAP-0: SEAT HANDLERS
  // ========================================

  /**
   * Handle SEAT_REQ message (Host-side only)
   * M07 Unit Authority v0: Validates seat request with OCCUPIED-first check.
   * Takeover: If selectedBySlot == null AND ownerSlot != requesterSlot,
   *   set BOTH ownerSlot and selectedBySlot to requesterSlot.
   * @param {Object} msg - SEAT_REQ message
   */
  _handleSeatReq(msg) {
    // Only Host processes SEAT_REQ
    if (!this.state.isHost()) {
      return;
    }

    this._debugCounters.seatReqCount++;
    const { targetUnitId, requesterSlot, auth } = msg;

    if (this.game._isDevMode) {
      console.log(`[SM] SEAT_REQ: slot=${requesterSlot} wants unit=${targetUnitId}`);
    }

    // 1. Find the target unit
    const unit = this.game.units?.find(u => u && u.id === targetUnitId);
    if (!unit) {
      console.warn(`[SM] SEAT_REQ rejected: unit ${targetUnitId} not found`);
      this._sendSeatReject(targetUnitId, requesterSlot, 'LOCKED');
      return;
    }

    // 2a. ALREADY SEATED: short-circuit (M07 B2-fix: idempotent re-request)
    if (unit.selectedBySlot === requesterSlot) {
      if (this.game._isDevMode) {
        console.log(`[SM] SEAT_REQ: slot=${requesterSlot} already seated on unit ${targetUnitId} (noop)`);
      }
      this._grantSeat(unit, requesterSlot);
      return;
    }

    // 2b. OCCUPIED CHECK - If unit has a driver and it's not the requester, reject immediately
    // M07 Unit Authority v0: OCCUPIED denial takes priority (no keypad shown)
    if (unit.selectedBySlot !== null && unit.selectedBySlot !== requesterSlot) {
      if (this.game._isDevMode) {
        console.log(`[SM] SEAT_REQ rejected: unit ${targetUnitId} OCCUPIED by slot ${unit.selectedBySlot}`);
      }
      this._sendSeatReject(targetUnitId, requesterSlot, 'OCCUPIED');
      // No cooldown for OCCUPIED - unit genuinely has another driver
      return;
    }

    // 3. Check cooldown (progressive backoff for PIN failures)
    // Uses tick-based timing for determinism (Issue 9).
    const cooldownKey = `${requesterSlot}_${targetUnitId}`;
    const cooldownEntry = this._seatCooldowns.get(cooldownKey);
    const currentTick = this._getSimTick();

    if (cooldownEntry && currentTick < cooldownEntry.untilTick) {
      // Still in cooldown
      this._debugCounters.seatCooldownHitCount++;
      const retryAfterMs = (cooldownEntry.untilTick - currentTick) * SIM_TICK_MS;
      if (this.game._isDevMode) {
        console.log(`[SM] SEAT_REQ rejected: cooldown (${retryAfterMs}ms remaining)`);
      }
      this._sendSeatReject(targetUnitId, requesterSlot, 'COOLDOWN', retryAfterMs);
      return;
    }

    // 4. Check seat policy
    const seatPolicy = unit.seatPolicy || 'OPEN';

    // 4a. OWNER RE-ENTRY: Owner doesn't need to re-authenticate
    if (unit.ownerSlot === requesterSlot) {
      if (this.game._isDevMode) {
        console.log(`[SM] SEAT_REQ: owner re-entry (slot=${requesterSlot} owns unit ${targetUnitId})`);
      }
      this._grantSeat(unit, requesterSlot);
      this._seatCooldowns.delete(cooldownKey);
      return;
    }

    if (seatPolicy === 'OPEN') {
      // No challenge required - grant immediately (may be takeover)
      this._grantSeat(unit, requesterSlot);
      this._seatCooldowns.delete(cooldownKey);
      return;
    }

    if (seatPolicy === 'PIN_1DIGIT') {
      // PIN challenge required
      if (!auth || auth.method !== 'PIN_1DIGIT') {
        if (this.game._isDevMode) {
          console.log(`[SM] SEAT_REQ rejected: unit ${targetUnitId} requires PIN_1DIGIT auth`);
        }
        this._sendSeatReject(targetUnitId, requesterSlot, 'LOCKED');
        return;
      }

      // Validate PIN (Host-only field: unit.seatPinDigit)
      const correctPin = unit.seatPinDigit;
      if (typeof correctPin !== 'number' || correctPin < 1 || correctPin > 9) {
        console.warn(`[SM] SEAT_REQ rejected: unit ${targetUnitId} has invalid seatPinDigit`);
        this._sendSeatReject(targetUnitId, requesterSlot, 'LOCKED');
        return;
      }

      if (auth.guess === correctPin) {
        // Correct PIN - grant seat (may be takeover)
        this._grantSeat(unit, requesterSlot);
        this._seatCooldowns.delete(cooldownKey);
        return;
      } else {
        // Wrong PIN - reject with BAD_PIN and apply cooldown
        if (this.game._isDevMode) {
          console.log(`[SM] SEAT_REQ rejected: BAD_PIN (guess=${auth.guess})`);
        }
        this._applySeatCooldown(cooldownKey, cooldownEntry);
        const newCooldown = this._seatCooldowns.get(cooldownKey);
        const retryMs = newCooldown ? (newCooldown.untilTick - currentTick) * SIM_TICK_MS : SEAT_COOLDOWN_LEVELS[0];
        this._sendSeatReject(targetUnitId, requesterSlot, 'BAD_PIN', retryMs);
        return;
      }
    }

    // Unknown seat policy - treat as LOCKED
    console.warn(`[SM] SEAT_REQ rejected: unknown seatPolicy '${seatPolicy}'`);
    this._sendSeatReject(targetUnitId, requesterSlot, 'LOCKED');
  }

  /**
   * Get current simulation tick for deterministic timing.
   * Uses real simLoop tickCount in production; falls back to
   * Date.now()-derived pseudo-tick for tests/standalone (Issue 9).
   * @private
   * @returns {number} Current tick
   */
  _getSimTick() {
    const simLoop = this.game?.simLoop;
    if (simLoop && typeof simLoop.fixedDtMs === 'number') {
      return simLoop.tickCount || 0;
    }
    // Fallback: derive pseudo-tick from wall clock (compatible with vi.useFakeTimers)
    return Math.floor(Date.now() / SIM_TICK_MS);
  }

  /**
   * Apply progressive cooldown for seat requests.
   * Uses tick-based timing for determinism (Issue 9).
   * @private
   */
  _applySeatCooldown(cooldownKey, currentEntry) {
    const currentTick = this._getSimTick();
    let level = 0;

    if (currentEntry) {
      level = Math.min(currentEntry.level + 1, SEAT_COOLDOWN_LEVELS.length - 1);
    }

    const cooldownTicks = SEAT_COOLDOWN_TICKS[level];
    this._seatCooldowns.set(cooldownKey, {
      untilTick: currentTick + cooldownTicks,
      level
    });
  }

  /**
   * Grant seat to requester and broadcast SEAT_ACK
   * M07 Unit Authority v0: Handles takeover - sets BOTH ownerSlot and selectedBySlot.
   *
   * DETERMINISM NOTE (Audit Issue #5):
   * Direct mutation of unit.selectedBySlot and unit.ownerSlot outside the
   * CommandQueue is intentional and determinism-safe for these reasons:
   *
   * - selectedBySlot: Per-client visual/authority state (like SELECT/DESELECT).
   *   The Host sets it locally here, then broadcasts SEAT_ACK to ALL clients.
   *   All clients apply the identical mutation in _handleSeatAck(), so state
   *   converges across all peers.
   *
   * - ownerSlot (takeover case): Economic/authority state change. The Host is
   *   the single authority that decides takeover. The SEAT_ACK broadcast
   *   includes newOwnerSlot, and ALL clients apply the same ownerSlot mutation
   *   in _handleSeatAck(). Since only the Host can grant seats (SEAT_REQ is
   *   Host-only), there is no race condition - all clients see the same
   *   SEAT_ACK and converge to the same state.
   *
   * @private
   */
  async _grantSeat(unit, requesterSlot) {
    const prevOwner = unit.ownerSlot;
    const isTakeover = unit.selectedBySlot === null && unit.ownerSlot !== requesterSlot;

    // M07: On successful seat grant, update BOTH fields (Host-authoritative, broadcast below)
    unit.selectedBySlot = requesterSlot;

    // M07: If this is a takeover (empty seat + different owner), transfer ownership
    if (isTakeover) {
      unit.ownerSlot = requesterSlot;
      if (unit.recordOwnershipChange) {
        unit.recordOwnershipChange(requesterSlot, prevOwner, this.game.simLoop?.tickCount || 0, 'PIN_CAPTURE');
      }
      this._logOwnershipChange(unit, prevOwner, requesterSlot, 'TAKEOVER');
    }

    this._debugCounters.seatAckCount++;
    if (this.game._isDevMode) {
      console.log(`[SM] SEAT_ACK: unit ${unit.id} now controlled by slot ${requesterSlot}${isTakeover ? ' (TAKEOVER)' : ''}`);
    }

    if (this.transport && this._sessionChannel) {
      const ack = createSeatAck({
        targetUnitId: unit.id,
        selectedBySlot: requesterSlot,
        newOwnerSlot: isTakeover ? requesterSlot : unit.ownerSlot
      });

      try {
        await this.transport.broadcastToChannel(this._sessionChannel, ack);
      } catch (err) {
        console.error('[SM] Failed to broadcast SEAT_ACK:', err);
      }
    }
  }

  /**
   * Log ownership changes for audit trail
   * M07 Unit Authority v0: Best-effort logging (dev-mode warn if fails)
   * @private
   * @param {Object} unit - The unit whose ownership changed
   * @param {number} prevOwner - Previous ownerSlot value
   * @param {number} newOwner - New ownerSlot value
   * @param {string} eventType - Type of event ('TAKEOVER', 'SPAWN', etc.)
   */
  _logOwnershipChange(unit, prevOwner, newOwner, eventType) {
    const currentTick = this.game.simLoop?.tickCount || 0;
    const sessionId = this.state.hostId || 'LOCAL';

    // Create log entry with safe serialization (no circular refs)
    const logEntry = {
      sessionId,
      unitId: unit.id,
      tick: currentTick,
      prevOwner,
      newOwner,
      eventType,
      timestamp: Date.now()
    };

    try {
      console.log(`[SM] OWNERSHIP_CHANGE: ${JSON.stringify(logEntry)}`);
    } catch (err) {
      // Dev-mode warn if logging fails
      if (this.game._isDevMode) {
        console.warn('[SM] _logOwnershipChange failed:', err.message);
      }
    }
  }

  /**
   * Send SEAT_REJECT to session channel
   * @private
   * @param {number} targetUnitId - Unit that was denied
   * @param {number} requesterSlot - Slot that was denied (for future targeted messaging)
   * @param {string} reason - Rejection reason
   * @param {number} [retryAfterMs] - Optional backoff hint
   */
  async _sendSeatReject(targetUnitId, requesterSlot, reason, retryAfterMs) {
    this._debugCounters.seatRejectCount++;

    if (!this.transport || !this._sessionChannel) {
      return;
    }

    const reject = createSeatReject({
      targetUnitId,
      reason,
      retryAfterMs
    });

    try {
      await this.transport.broadcastToChannel(this._sessionChannel, reject);
      if (this.game._isDevMode) {
        console.log(`[SM] SEAT_REJECT sent: unit=${targetUnitId}, slot=${requesterSlot}, reason=${reason}`);
      }
    } catch (err) {
      console.error('[SM] Failed to send SEAT_REJECT:', err);
    }
  }

  /**
   * Handle SEAT_ACK message (Both sides)
   * M07 Unit Authority v0: Updates unit.selectedBySlot and unit.ownerSlot
   *
   * DETERMINISM NOTE (Audit Issue #5):
   * This handler runs on ALL clients (Host + all Guests) when SEAT_ACK is
   * broadcast. Every client applies the identical selectedBySlot and ownerSlot
   * mutations from the same authoritative message, ensuring state convergence.
   * This is analogous to how SELECT/DESELECT are per-client visual state -
   * the difference is that seat state is synchronized via broadcast rather
   * than being purely local. The Host is the single authority (via _grantSeat)
   * so there are no conflicting mutations.
   *
   * @param {Object} msg - SEAT_ACK message
   */
  _handleSeatAck(msg) {
    // M07: Support both old and new field names for compatibility
    const { targetUnitId, selectedBySlot, controllerSlot, newOwnerSlot } = msg;
    const effectiveSelectedBy = selectedBySlot ?? controllerSlot; // Fallback to old name

    const unit = this.game.units?.find(u => u && u.id === targetUnitId);

    if (unit) {
      // Direct mutation from network handler - determinism-safe because ALL
      // clients receive the same SEAT_ACK and apply the same values.
      unit.selectedBySlot = effectiveSelectedBy;
      // M07: Update ownerSlot if newOwnerSlot is provided (takeover case)
      if (newOwnerSlot !== undefined && newOwnerSlot !== null) {
        const prevOwner = unit.ownerSlot;
        unit.ownerSlot = newOwnerSlot;
        if (prevOwner !== newOwnerSlot && unit.recordOwnershipChange) {
          unit.recordOwnershipChange(newOwnerSlot, prevOwner, this.game.simLoop?.tickCount || 0, 'PIN_CAPTURE');
        }
      }
      if (this.game._isDevMode) {
        console.log(`[SM] SEAT_ACK recv: unit ${targetUnitId} -> selectedBySlot=${effectiveSelectedBy}, ownerSlot=${unit.ownerSlot}`);
      }
    }

    // Notify game UI (if callback registered)
    if (this.game.onSeatGranted) {
      this.game.onSeatGranted(targetUnitId, effectiveSelectedBy);
    }
  }

  /**
   * Handle SEAT_REJECT message (Guest-side)
   * Shows error in UI
   * @param {Object} msg - SEAT_REJECT message
   */
  _handleSeatReject(msg) {
    const { targetUnitId, reason, retryAfterMs } = msg;

    if (this.game._isDevMode) {
      console.log(`[SM] SEAT_REJECT recv: unit=${targetUnitId}, reason=${reason}, retry=${retryAfterMs}ms`);
    }

    // Show error in keypad overlay if visible
    if (this.game.seatKeypadOverlay && this.game.seatKeypadOverlay.isVisible) {
      const errorMsg = reason === 'BAD_PIN' ? 'Wrong PIN' :
                       reason === 'COOLDOWN' ? 'Too fast!' :
                       reason === 'OCCUPIED' ? 'Occupied' : 'Locked';
      this.game.seatKeypadOverlay.showError(errorMsg, retryAfterMs || 0);
    } else {
      // Keypad not visible - show toast feedback so rejection isn't silent
      const unit = this.game.units?.find(u => u && u.id === targetUnitId);
      if (this.game.interactionManager && unit) {
        this.game.interactionManager._showOccupiedFeedback(unit, reason);
      }
    }
  }

  /**
   * M07 GAP-0: Send SEAT_REQ to host
   * Called from InteractionManager when user clicks a unit
   * @param {Object} options - { targetUnitId, auth? }
   */
  async sendSeatReq(options) {
    const { targetUnitId, auth } = options;

    if (!this.transport || !this._sessionChannel) {
      console.warn('[SM] sendSeatReq: No transport or channel');
      return;
    }

    const req = createSeatReq({
      targetUnitId,
      requesterSlot: this.state.mySlot,
      auth
    });

    try {
      await this.transport.broadcastToChannel(this._sessionChannel, req);
      if (this.game._isDevMode) {
        console.log(`[SM] SEAT_REQ sent: unit=${targetUnitId}, auth=${auth ? auth.method : 'none'}`);
      }
    } catch (err) {
      console.error('[SM] Failed to send SEAT_REQ:', err);
    }
  }

  /**
   * Broadcast seat claim to all clients when a player selects a unit.
   * Called from Game.selectUnit() so other clients see OCCUPIED.
   * Re-uses SEAT_ACK message format (same effect: sets selectedBySlot on all clients).
   * @param {Object} unit - The unit being claimed
   * @param {number} slot - The slot claiming the seat
   */
  async broadcastSeatClaim(unit, slot) {
    if (!unit || !this.transport || !this._sessionChannel) return;

    const ack = createSeatAck({
      targetUnitId: unit.id,
      selectedBySlot: slot,
      newOwnerSlot: unit.ownerSlot
    });

    try {
      await this.transport.broadcastToChannel(this._sessionChannel, ack);
      if (this.game._isDevMode) {
        console.log(`[SM] broadcastSeatClaim: unit=${unit.id}, slot=${slot}`);
      }
    } catch (err) {
      console.error('[SM] Failed to broadcast seat claim:', err);
    }
  }

  /**
   * Release seat on a unit and broadcast SEAT_RELEASE to all clients.
   * Called from Game.deselectUnit() when a player exits a unit.
   *
   * DETERMINISM NOTE (Audit Issue #5):
   * selectedBySlot is per-client visual/authority state. The releasing client
   * clears it locally and broadcasts SEAT_RELEASE. All other clients apply
   * the same null-assignment in _handleSeatRelease(), so state converges.
   * ownerSlot is NOT changed on release (economic identity persists).
   *
   * @param {Object} unit - The unit to release
   */
  async releaseSeat(unit) {
    if (!unit) return;
    const mySlot = this.state.mySlot;

    // Only release if we actually hold the seat
    if (unit.selectedBySlot !== mySlot) return;

    // Clear locally first (broadcast below ensures all clients converge)
    unit.selectedBySlot = null;

    if (this.game._isDevMode) {
      console.log(`[SM] SEAT_RELEASE: slot=${mySlot} releasing unit ${unit.id}`);
    }

    // Broadcast to all clients
    if (this.transport && this._sessionChannel) {
      const msg = createSeatRelease({
        targetUnitId: unit.id,
        releasedBySlot: mySlot
      });
      try {
        await this.transport.broadcastToChannel(this._sessionChannel, msg);
      } catch (err) {
        console.error('[SM] Failed to broadcast SEAT_RELEASE:', err);
      }
    }

    // Notify game for tab refresh
    if (this.game.onSeatReleased) {
      this.game.onSeatReleased(unit.id, mySlot);
    }
  }

  /**
   * Handle SEAT_RELEASE message (All clients)
   * Clears selectedBySlot on the target unit.
   *
   * DETERMINISM NOTE (Audit Issue #5):
   * All clients receive SEAT_RELEASE and apply the same null-assignment,
   * guarded by the releasedBySlot match check. This ensures convergence.
   * Only selectedBySlot is cleared - ownerSlot persists (economic identity).
   *
   * @param {Object} msg - SEAT_RELEASE message
   */
  _handleSeatRelease(msg) {
    const { targetUnitId, releasedBySlot } = msg;
    const unit = this.game.units?.find(u => u && u.id === targetUnitId);

    if (unit && unit.selectedBySlot === releasedBySlot) {
      // Direct mutation from network handler - determinism-safe because ALL
      // clients receive the same SEAT_RELEASE and apply the same null value.
      unit.selectedBySlot = null;
      if (this.game._isDevMode) {
        console.log(`[SM] SEAT_RELEASE recv: unit ${targetUnitId} freed by slot ${releasedBySlot}`);
      }
    }

    // Notify game for tab refresh
    if (this.game.onSeatReleased) {
      this.game.onSeatReleased(targetUnitId, releasedBySlot);
    }
  }

  /**
   * Handle POSITION_SYNC message (bidirectional).
   * Applies remote unit positions, skipping the local client's own
   * currently controlled unit to avoid overriding local movement.
   * @param {Object} msg - POSITION_SYNC message
   */
  _handlePositionSync(msg) {
    if (this.state.isOffline()) return;

    const units = msg.units;
    if (!units || !Array.isArray(units)) return;

    // Delegate to Game.js which has THREE.Vector3 for path reconstruction
    if (this.game?.applyPositionSync) {
        this.game.applyPositionSync(msg);
    }

    // Track for diagnostics
    this._debugCounters.positionSyncRecvCount = (this._debugCounters.positionSyncRecvCount || 0) + 1;
  }

  /**
   * Phase 2A: Handle SERVER_SNAPSHOT from authoritative server.
   * Delegates to Game.applyServerSnapshot() for SnapshotBuffer push + mirror mode.
   * @param {Object} msg - SERVER_SNAPSHOT message
   */
  _handleServerSnapshot(msg) {
    if (this.state.isOffline()) return;

    // Delegate to Game.js which has SnapshotBuffer and Three.js
    if (this.game?.applyServerSnapshot) {
      this.game.applyServerSnapshot(msg);
    }

    // Track for diagnostics
    this._debugCounters.serverSnapshotRecvCount = (this._debugCounters.serverSnapshotRecvCount || 0) + 1;
  }

  /**
   * M07 Unit Authority v0: Check if local client has seat on a unit
   * @param {Object} unit - Unit to check
   * @returns {boolean}
   */
  hasSeatedUnit(unit) {
    if (!unit) return false;
    // Offline: always has authority (single player)
    if (this.state.isOffline()) return true;
    const mySlot = this.state.mySlot;
    // OCCUPIED by someone else -> no authority (applies to Host too)
    if (unit.selectedBySlot !== null && unit.selectedBySlot !== mySlot) return false;
    // Host: has authority on free or own-seated units
    if (this.state.isHost()) return true;
    // Guest: only if actually seated
    return unit.selectedBySlot === mySlot;
  }

  // ========================================
  // HOST-LEAVE RESILIENCE
  // ========================================

  /**
   * Handle HOST_LEAVE message (Guest-side).
   * Immediately starts migration without waiting for the 15s absence timeout.
   * @param {Object} msg - HOST_LEAVE message
   */
  _handleHostLeave(msg) {
    // Only guests process HOST_LEAVE
    if (!this.state.isGuest()) {
      return;
    }

    // Verify this is from our Host
    if (msg.hostId !== this.state.hostId) {
      return;
    }

    console.log(`[SM] HOST_LEAVE received from ${msg.hostId} - starting immediate migration`);

    // Remove Host (slot 0) from player list
    this.state.removePlayer(0);

    // Release any units seated by the departing host (slot 0)
    this._releaseSeatsForSlot(0);

    // Skip grace period, go straight to migration evaluation
    this._evaluateMigration();
  }

  /**
   * Handle GUEST_LEAVE message (Host-side and Guest-side).
   * Removes the departing guest from the player list and releases their seats.
   * @param {Object} msg - GUEST_LEAVE message
   */
  _handleGuestLeave(msg) {
    // Don't process our own leave messages
    if (msg.slot === this.state.mySlot) {
      return;
    }

    // Only process if we're in a session
    if (this.state.isOffline()) {
      return;
    }

    if (this.game._isDevMode) {
      console.log(`[SM] GUEST_LEAVE received: slot=${msg.slot}`);
    }

    // Remove player from session
    this.state.removePlayer(msg.slot);

    // Release any units seated by the departing guest
    this._releaseSeatsForSlot(msg.slot);

    // Check if session is now empty (game end condition)
    if (this.state.players.length === 0) {
      console.log('[SM] All players left - ending session');
      this.leaveGame();
      return;
    }

    // Notify UI of player count change
    if (this.state.isHost()) {
      this._notifyConnectionStateChanged('HOSTING');
    }
  }

  /**
   * Release all unit seats held by a departing player slot.
   * Clears selectedBySlot on units controlled by the given slot.
   *
   * DETERMINISM NOTE: Called from HOST_LEAVE / GUEST_LEAVE handlers which
   * are broadcast to all clients. All clients apply the same seat release
   * for the departing slot, so state converges.
   *
   * @private
   * @param {number} slot - Slot of the departing player
   */
  _releaseSeatsForSlot(slot) {
    if (!this.game.units) return;

    for (const unit of this.game.units) {
      if (unit && unit.selectedBySlot === slot) {
        unit.selectedBySlot = null;
        if (this.game._isDevMode) {
          console.log(`[SM] Released seat on unit ${unit.id} (was held by departing slot ${slot})`);
        }
      }
    }
  }

  /**
   * Start periodic check for host absence (Guest-side).
   * Called when a guest successfully joins a session.
   * @private
   */
  _startHostAbsenceCheck() {
    // Stop any existing check first
    this._stopHostAbsenceCheck();

    this._hostAbsenceCheckInterval = setInterval(() => {
      this._checkHostAbsence();
    }, HOST_ABSENCE_CHECK_INTERVAL_MS);

    if (this.game._isDevMode) {
      console.log('[SM] Host absence check started');
    }
  }

  /**
   * Stop the host absence check interval.
   * @private
   */
  _stopHostAbsenceCheck() {
    if (this._hostAbsenceCheckInterval) {
      clearInterval(this._hostAbsenceCheckInterval);
      this._hostAbsenceCheckInterval = null;
    }
  }

  /**
   * Check if Host has been absent for too long (Guest-side).
   * If HOST_ANNOUNCE hasn't been received for HOST_ABSENCE_TIMEOUT_MS,
   * enters a 3-second grace period before triggering migration.
   * @private
   */
  _checkHostAbsence() {
    // Only check if we're a Guest in a session
    if (!this.state.isGuest()) {
      this._stopHostAbsenceCheck();
      return;
    }

    // No timestamp yet means we haven't received any HOST_ANNOUNCE since joining
    if (!this._hostLastSeenAt) {
      return;
    }

    const now = Date.now();
    const timeSinceLastSeen = now - this._hostLastSeenAt;

    // Host is still present - nothing to do
    if (timeSinceLastSeen < HOST_ABSENCE_TIMEOUT_MS) {
      return;
    }

    // Host is absent - start or check grace period
    if (!this._migrationGraceActive) {
      // Enter grace period
      this._migrationGraceActive = true;
      this._migrationGraceStartedAt = now;
      console.log(`[SM] Host absent for ${timeSinceLastSeen}ms - entering ${HOST_MIGRATION_GRACE_MS}ms grace period`);
      return;
    }

    // Check if grace period has elapsed
    const graceElapsed = now - this._migrationGraceStartedAt;
    if (graceElapsed < HOST_MIGRATION_GRACE_MS) {
      return;
    }

    // Grace period expired - time to migrate
    console.log('[SM] Host absent and grace period expired - evaluating migration');
    this._migrationGraceActive = false;
    this._migrationGraceStartedAt = null;

    // Remove Host from player list (they're gone)
    this.state.removePlayer(0);

    // Release any units seated by the departed host
    this._releaseSeatsForSlot(0);

    this._evaluateMigration();
  }

  /**
   * Evaluate whether this client should promote to Host.
   * The Guest with the lowest active slot number becomes the new Host.
   * @private
   */
  _evaluateMigration() {
    // Stop the absence check - we're about to resolve this
    this._stopHostAbsenceCheck();

    const lowestSlot = this.state.getLowestActiveSlot();

    if (lowestSlot === null) {
      // No active players left - session is dead
      console.log('[SM] No active players remaining - ending session');
      this.leaveGame();
      return;
    }

    if (lowestSlot === this.state.mySlot) {
      // We are the lowest slot - promote to Host
      console.log(`[SM] Promoting self to HOST (mySlot=${this.state.mySlot} is lowest active slot)`);
      this._promoteToHost();
    } else {
      // Another Guest has lower slot - they should promote
      // Re-start absence check to wait for the new Host's announces
      console.log(`[SM] Waiting for slot ${lowestSlot} to become new Host (mySlot=${this.state.mySlot})`);
      this._hostLastSeenAt = Date.now(); // Reset timer for new Host detection
      this._startHostAbsenceCheck();
    }
  }

  /**
   * Promote this Guest to HOST role.
   * Starts announcing on lobby channel, accepts JOIN_REQ, notifies UI.
   * @private
   */
  async _promoteToHost() {
    // Transition state from GUEST to HOST
    this.state.promoteToHost();

    // Update sessionName if available
    if (!this.sessionName) {
      this.sessionName = `Migrated Session`;
    }

    // Join lobby channel to start announcing (if not already on it)
    if (this.transport && typeof this.transport.joinChannel === 'function') {
      try {
        await this.transport.joinChannel(LOBBY_CHANNEL, (msg) => this.onMessage(msg));
        if (this.game._isDevMode) {
          console.log('[SM] Promoted Host joined lobby channel');
        }
      } catch (err) {
        console.error('[SM] Promoted Host failed to join lobby:', err);
        // Continue anyway - local hosting still works
      }
    }

    // Start periodic announcing
    try {
      await this.sendAnnounce();
    } catch (err) {
      if (this.game._isDevMode) {
        console.warn('[SM] Promoted Host first announce failed:', err);
      }
    }

    this.announceInterval = setInterval(() => {
      if (this.game._isDevMode) {
        this._debugAnnounceTickCount++;
        this._debugLastAnnounceAt = Date.now();
      }
      this.sendAnnounce().catch(err => {
        if (this.game._isDevMode) {
          console.error('[SM] Promoted Host announce failed:', err);
        }
      });
    }, ANNOUNCE_INTERVAL_MS);

    // Notify UI of role change
    this._notifyConnectionStateChanged('HOSTING');

    console.log(`[SM] Host migration complete. Now hosting as slot ${this.state.mySlot}`);
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
   * M07: Get network evidence as clean, JSON-safe object.
   * No circular references, no Three.js objects, no Supabase client refs.
   * Safe to call JSON.stringify() on the result.
   * @returns {Object} JSON-safe evidence object
   */
  getNetEvidence() {
    try {
      return {
      role: this.state.role,
      mySlot: this.state.mySlot,
      units: this.game.units?.filter(u => u).map(u => ({
        id: u.id,
        ownerSlot: u.ownerSlot ?? 0,
        selectedBySlot: u.selectedBySlot ?? null,  // M07: Canonical field name
        seatPolicy: u.seatPolicy ?? 'OPEN'
        // NOTE: seatPinDigit is Host-only, intentionally NOT included (privacy)
      })) || [],
      debugCounters: { ...this._debugCounters },
      // Gating state
      batchSeqCounter: this._batchSeqCounter,
      lastReceivedBatchSeq: this._lastReceivedBatchSeq,
      inputBufferSize: this.inputBuffer?.length || 0,
      discoveryActive: this._discoveryActive,
      availableHostsCount: this.availableHosts?.size || 0
      };
    } catch (err) {
      return { error: err.message, role: this.state?.role || 'UNKNOWN' };
    }
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
      queuePendingCount: (this.game?.commandQueue || globalCommandQueue)?.pendingCount ?? 0,
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
