/**
 * SupabaseTransport - Supabase Realtime Broadcast Transport
 *
 * R012: Implements ITransport using Supabase Realtime broadcast channels.
 * Commands sent are broadcast to all connected clients in the same room.
 *
 * Architecture:
 *   InputFactory → SupabaseTransport.send() → Supabase Realtime → onReceive → CommandQueue
 *
 * INVARIANT: No command enters the authoritative simulation without passing through transport.
 * INVARIANT: ALL sim-affecting commands flow through transport, even from local client.
 *
 * Design notes:
 * - Uses Supabase Realtime broadcast (not database changes) for low latency
 * - Throttles outbound messages to ~10Hz max
 * - Queues commands while connecting
 * - Batches multiple commands per message when possible
 */

import { TransportBase, TransportState } from './ITransport.js';

/**
 * Default throttle interval (ms) - limits network traffic to ~10Hz
 */
const DEFAULT_THROTTLE_MS = 100;

/**
 * R013-M06: Channel subscribe timeout (ms) - fail fast if channel doesn't connect
 */
const CHANNEL_SUBSCRIBE_TIMEOUT_MS = 10000;

/**
 * Default room name for single-room multiplayer
 */
const DEFAULT_ROOM = 'asterobia-main';

/**
 * SupabaseTransport provides command relay via Supabase Realtime broadcast.
 * @extends TransportBase
 */
export class SupabaseTransport extends TransportBase {
    /**
     * @param {Object} options
     * @param {Object} options.supabaseClient - Initialized Supabase client instance
     * @param {string} [options.room] - Room/channel name (default: 'asterobia-main')
     * @param {number} [options.throttleMs] - Throttle interval in ms (default: 100)
     * @param {boolean} [options.echoLocal] - Echo local commands back (default: true for testing)
     */
    constructor(options = {}) {
        super();

        if (!options.supabaseClient) {
            throw new Error('SupabaseTransport requires supabaseClient option');
        }

        /** @type {Object} Supabase client */
        this._supabase = options.supabaseClient;

        /** @type {string} Room/channel name */
        this._room = options.room || DEFAULT_ROOM;

        /** @type {number} Throttle interval */
        this._throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;

        /** @type {boolean} Echo local commands back to self */
        this._echoLocal = options.echoLocal ?? true;

        /** @type {Object|null} Supabase Realtime channel */
        this._channel = null;

        /** @type {Array} Commands queued while connecting */
        this._pendingBeforeConnect = [];

        /** @type {Array} Outbound command batch for throttling */
        this._outboundBatch = [];

        /** @type {number|null} Throttle timer ID */
        this._throttleTimer = null;

        /** @type {string|null} Local client ID for echo filtering */
        this._clientId = null;

        /** @type {number} Sequence number for ordering */
        this._sequence = 0;

        /** @type {number} Reconnect attempt count */
        this._reconnectAttempts = 0;

        /** @type {number} Max reconnect attempts */
        this._maxReconnectAttempts = options.maxReconnectAttempts ?? 5;

        /** @type {number} Reconnect delay in ms */
        this._reconnectDelayMs = options.reconnectDelayMs ?? 2000;

        /** @type {number|null} Reconnect timer ID */
        this._reconnectTimer = null;

        /**
         * R013: Map of additional channels for multiplayer (lobby, session)
         * Key: channelName, Value: { channel, callback }
         * @type {Map<string, Object>}
         */
        this._channels = new Map();
    }

    /**
     * Initialize the transport and connect to Supabase Realtime.
     * @returns {Promise<void>}
     */
    async connect() {
        if (this._state === TransportState.CONNECTED) {
            return;
        }

        if (this._state === TransportState.CONNECTING) {
            return;
        }

        this._state = TransportState.CONNECTING;

        try {
            // Generate unique client ID
            this._clientId = crypto.randomUUID ? crypto.randomUUID() : `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            // Create and subscribe to Realtime channel
            this._channel = this._supabase.channel(this._room, {
                config: {
                    broadcast: {
                        // Don't acknowledge broadcasts (fire-and-forget for speed)
                        ack: false,
                        // Receive own broadcasts (for local echo)
                        self: this._echoLocal
                    }
                }
            });

            // Set up message handler
            this._channel.on('broadcast', { event: 'command' }, (payload) => {
                this._handleBroadcast(payload);
            });

            // Subscribe and wait for connection
            await new Promise((resolve, reject) => {
                this._channel.subscribe((status) => {
                    if (status === 'SUBSCRIBED') {
                        resolve();
                    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                        reject(new Error(`Channel subscription failed: ${status}`));
                    }
                });
            });

            this._state = TransportState.CONNECTED;

            // Flush pending commands
            if (this._pendingBeforeConnect.length > 0) {
                const pending = this._pendingBeforeConnect;
                this._pendingBeforeConnect = [];
                for (const cmd of pending) {
                    this.send(cmd);
                }
            }

            console.log(`[SupabaseTransport] Connected to room: ${this._room}`);

        } catch (err) {
            this._state = TransportState.ERROR;
            console.error('[SupabaseTransport] Connection failed:', err);

            // Schedule reconnect attempt
            this._scheduleReconnect();

            throw err;
        }
    }

    /**
     * Schedule a reconnect attempt after delay.
     * @private
     */
    _scheduleReconnect() {
        if (this._reconnectAttempts >= this._maxReconnectAttempts) {
            console.error(`[SupabaseTransport] Max reconnect attempts (${this._maxReconnectAttempts}) reached`);
            return;
        }

        if (this._reconnectTimer) {
            return; // Already scheduled
        }

        this._reconnectAttempts++;
        const delay = this._reconnectDelayMs * Math.pow(1.5, this._reconnectAttempts - 1); // Exponential backoff

        console.log(`[SupabaseTransport] Scheduling reconnect attempt ${this._reconnectAttempts}/${this._maxReconnectAttempts} in ${delay}ms`);

        this._reconnectTimer = setTimeout(async () => {
            this._reconnectTimer = null;
            this._state = TransportState.DISCONNECTED; // Reset state for connect()

            try {
                await this.connect();
                this._reconnectAttempts = 0; // Reset on success
                console.log('[SupabaseTransport] Reconnected successfully');
            } catch (err) {
                // connect() will schedule another reconnect if needed
            }
        }, delay);
    }

    /**
     * Disconnect from Supabase Realtime.
     */
    async disconnect() {
        if (this._throttleTimer) {
            clearTimeout(this._throttleTimer);
            this._throttleTimer = null;
        }

        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }

        if (this._channel) {
            await this._supabase.removeChannel(this._channel);
            this._channel = null;
        }

        this._state = TransportState.DISCONNECTED;
        this._outboundBatch = [];
        this._reconnectAttempts = 0;
        console.log('[SupabaseTransport] Disconnected');
    }

    /**
     * Send a command through the transport.
     * Commands are batched and throttled for network efficiency.
     *
     * @param {Object} command - The command to send
     */
    send(command) {
        this._messagesSent++;

        if (this._state !== TransportState.CONNECTED) {
            // Queue for delivery when connected
            this._pendingBeforeConnect.push(command);
            return;
        }

        // Add metadata for ordering and deduplication
        const envelope = {
            ...command,
            _meta: {
                clientId: this._clientId,
                seq: this._sequence++,
                ts: Date.now()
            }
        };

        // Add to outbound batch
        this._outboundBatch.push(envelope);

        // Schedule flush if not already pending
        if (!this._throttleTimer) {
            this._throttleTimer = setTimeout(() => this._flushOutbound(), this._throttleMs);
        }
    }

    /**
     * Flush outbound batch to Supabase.
     * @private
     */
    async _flushOutbound() {
        this._throttleTimer = null;

        if (this._outboundBatch.length === 0) {
            return;
        }

        const batch = this._outboundBatch;
        this._outboundBatch = [];

        try {
            // Send as single broadcast with command array
            await this._channel.send({
                type: 'broadcast',
                event: 'command',
                payload: {
                    clientId: this._clientId,
                    commands: batch
                }
            });
        } catch (err) {
            console.error('[SupabaseTransport] Send failed:', err);
            // Re-queue failed commands (front of batch for ordering)
            this._outboundBatch = batch.concat(this._outboundBatch);
        }
    }

    /**
     * Handle incoming broadcast from Supabase.
     * @private
     * @param {Object} payload - Broadcast payload
     */
    _handleBroadcast(payload) {
        const { clientId, commands } = payload.payload || {};

        if (!commands || !Array.isArray(commands)) {
            return;
        }

        // If echoLocal is false, skip our own commands
        if (!this._echoLocal && clientId === this._clientId) {
            return;
        }

        // Deliver each command to the receive callback
        for (const cmd of commands) {
            // Strip internal metadata before delivery
            const { _meta, ...command } = cmd;
            this._deliverReceived(command);
        }
    }

    /**
     * Get transport type identifier.
     * @returns {string}
     */
    get type() {
        return 'supabase';
    }

    /**
     * Get the current room name.
     * @returns {string}
     */
    get room() {
        return this._room;
    }

    /**
     * Get the client ID.
     * @returns {string|null}
     */
    get clientId() {
        return this._clientId;
    }

    /**
     * Force immediate flush of outbound batch.
     * Useful for testing or time-critical commands.
     * @returns {Promise<void>}
     */
    async flush() {
        if (this._throttleTimer) {
            clearTimeout(this._throttleTimer);
            this._throttleTimer = null;
        }
        await this._flushOutbound();
    }

    // ========================================
    // R013: MULTIPLAYER CHANNEL METHODS
    // ========================================

    /**
     * Join an arbitrary Realtime channel for multiplayer messaging.
     * Used for lobby discovery and session communication.
     *
     * R013-M06: Includes timeout and comprehensive status handling to ensure
     * channel is truly SUBSCRIBED before returning.
     *
     * @param {string} channelName - Channel name (e.g., 'asterobia:lobby')
     * @param {Function} [callback] - Optional callback for incoming messages
     * @returns {Promise<void>}
     */
    async joinChannel(channelName, callback = null) {
        if (!channelName) {
            throw new Error('Channel name is required');
        }

        // Check if already joined
        if (this._channels.has(channelName)) {
            console.log(`[SupabaseTransport] Already joined channel: ${channelName}`);
            return;
        }

        console.log(`[SupabaseTransport] Joining channel: ${channelName}`);

        let channel = null;

        try {
            // Create channel with broadcast config
            channel = this._supabase.channel(channelName, {
                config: {
                    broadcast: {
                        ack: false,
                        self: true // Receive own broadcasts for debugging
                    }
                }
            });

            // Set up message handler for 'message' event
            channel.on('broadcast', { event: 'message' }, (payload) => {
                const msg = payload.payload;
                if (msg && callback) {
                    callback(msg);
                }
            });

            // R013-M06: Subscribe with timeout to prevent hanging
            await Promise.race([
                // Subscribe promise
                new Promise((resolve, reject) => {
                    channel.subscribe((status) => {
                        console.log(`[SupabaseTransport] Channel ${channelName} status: ${status}`);
                        if (status === 'SUBSCRIBED') {
                            resolve();
                        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
                            reject(new Error(`Channel subscription failed: ${status}`));
                        }
                        // SUBSCRIBING status is ignored (intermediate state)
                    });
                }),
                // Timeout promise
                new Promise((_, reject) => {
                    setTimeout(() => {
                        reject(new Error(`Channel subscribe timeout after ${CHANNEL_SUBSCRIBE_TIMEOUT_MS}ms`));
                    }, CHANNEL_SUBSCRIBE_TIMEOUT_MS);
                })
            ]);

            // R013-M06: Store channel reference ONLY after confirmed SUBSCRIBED
            this._channels.set(channelName, { channel, callback });

            // R013-M06: Verify storage succeeded (defensive)
            if (!this._channels.has(channelName)) {
                throw new Error(`Channel storage verification failed: ${channelName}`);
            }

            console.log(`[SupabaseTransport] Joined channel: ${channelName} (ready)`);

        } catch (err) {
            // Clean up channel on failure
            if (channel) {
                try {
                    await this._supabase.removeChannel(channel);
                } catch (cleanupErr) {
                    console.warn(`[SupabaseTransport] Cleanup failed for ${channelName}:`, cleanupErr);
                }
            }
            console.error(`[SupabaseTransport] Failed to join channel ${channelName}:`, err);
            throw err;
        }
    }

    /**
     * Broadcast a message to a specific channel.
     * Used for HOST_ANNOUNCE, JOIN_REQ, etc.
     *
     * R013-M06: Enhanced validation to ensure channel is ready before broadcast.
     *
     * @param {string} channelName - Channel name
     * @param {Object} msg - Message object to broadcast
     * @returns {Promise<void>}
     */
    async broadcastToChannel(channelName, msg) {
        if (!channelName) {
            throw new Error('Channel name is required');
        }

        const channelEntry = this._channels.get(channelName);
        if (!channelEntry || !channelEntry.channel) {
            throw new Error(`Not joined to channel: ${channelName}. Call joinChannel() first.`);
        }

        try {
            await channelEntry.channel.send({
                type: 'broadcast',
                event: 'message',
                payload: msg
            });

            console.log(`[SupabaseTransport] Broadcast to ${channelName}: ${msg.type || 'unknown'}`);

        } catch (err) {
            console.error(`[SupabaseTransport] Broadcast to ${channelName} failed:`, err);
            throw err;
        }
    }

    /**
     * Leave a specific channel.
     *
     * @param {string} channelName - Channel name to leave
     * @returns {Promise<void>}
     */
    async leaveChannel(channelName) {
        const channelEntry = this._channels.get(channelName);
        if (!channelEntry) {
            return; // Not joined
        }

        try {
            await this._supabase.removeChannel(channelEntry.channel);
            this._channels.delete(channelName);
            console.log(`[SupabaseTransport] Left channel: ${channelName}`);
        } catch (err) {
            console.error(`[SupabaseTransport] Failed to leave channel ${channelName}:`, err);
        }
    }

    /**
     * Leave all joined channels.
     * Called during disconnect cleanup.
     *
     * @returns {Promise<void>}
     */
    async leaveAllChannels() {
        const channelNames = Array.from(this._channels.keys());
        for (const name of channelNames) {
            await this.leaveChannel(name);
        }
    }

    /**
     * Check if joined to a specific channel.
     *
     * @param {string} channelName - Channel name
     * @returns {boolean}
     */
    isJoinedToChannel(channelName) {
        return this._channels.has(channelName);
    }
}
