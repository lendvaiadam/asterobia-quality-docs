/**
 * MemoryTransport - In-Process Transport for Integration Testing
 *
 * R013: Provides an in-memory transport layer that supports the channel-based API
 * expected by SessionManager, enabling server<->client communication without
 * a real network (Supabase Realtime).
 *
 * Architecture:
 *   MemoryTransportHub (central router)
 *     - createEndpoint('host') -> MemoryTransportEndpoint
 *     - createEndpoint('guest') -> MemoryTransportEndpoint
 *
 *   Each endpoint can:
 *     - joinChannel(name, cb) -> subscribe to a named channel
 *     - broadcastToChannel(name, msg) -> send to all OTHER subscribers
 *     - onMessage(cb) -> global message handler (SessionManager wiring)
 *     - send(cmd) -> base transport API (broadcasts on default channel)
 *
 * Key behaviors:
 *   - Messages are delivered synchronously (same process, no setTimeout)
 *   - broadcastToChannel delivers to ALL endpoints EXCEPT the sender (mimics Supabase)
 *   - Optional latencyMs parameter for simulating network delay (default 0)
 *   - Thread-safe for single-threaded JS (synchronous delivery is fine)
 *
 * INVARIANT: Does NOT modify SupabaseTransport or LocalTransport behavior.
 */

import { TransportBase, TransportState } from './ITransport.js';

/**
 * Default channel name used by send() for base transport API.
 * @type {string}
 */
const DEFAULT_COMMAND_CHANNEL = '__commands__';

// ========================================
// MemoryTransportHub - Central Message Router
// ========================================

/**
 * Central message router for in-memory transport.
 * One hub per test scenario. Manages all endpoints and channel subscriptions.
 */
export class MemoryTransportHub {
    /**
     * @param {Object} [options]
     * @param {number} [options.latencyMs=0] - Simulated network latency (ms). 0 = synchronous.
     */
    constructor(options = {}) {
        /**
         * Registered endpoints: name -> MemoryTransportEndpoint
         * @type {Map<string, MemoryTransportEndpoint>}
         */
        this.endpoints = new Map();

        /**
         * Channel subscriptions: channelName -> Map<endpointName, callback>
         * @type {Map<string, Map<string, Function>>}
         */
        this.channels = new Map();

        /**
         * Simulated network latency in milliseconds.
         * 0 = synchronous delivery (default for deterministic tests).
         * @type {number}
         */
        this.latencyMs = options.latencyMs || 0;

        /**
         * Message log for debugging/assertions.
         * Each entry: { channel, msg, senderName, timestamp }
         * @type {Array<Object>}
         */
        this._messageLog = [];

        /**
         * Whether to keep a message log (disable for perf in large tests).
         * @type {boolean}
         */
        this._enableLog = options.enableLog ?? false;
    }

    /**
     * Create a named endpoint and register it with this hub.
     *
     * @param {string} name - Unique endpoint name (e.g., 'host', 'guest1')
     * @returns {MemoryTransportEndpoint} The created endpoint
     * @throws {Error} If an endpoint with this name already exists
     */
    createEndpoint(name) {
        if (this.endpoints.has(name)) {
            throw new Error(`MemoryTransportHub: endpoint '${name}' already exists`);
        }

        const endpoint = new MemoryTransportEndpoint(name, this);
        this.endpoints.set(name, endpoint);
        return endpoint;
    }

    /**
     * Remove an endpoint and clean up its channel subscriptions.
     *
     * @param {string} name - Endpoint name to remove
     */
    removeEndpoint(name) {
        const endpoint = this.endpoints.get(name);
        if (!endpoint) return;

        // Remove from all channels
        for (const [, subscribers] of this.channels) {
            subscribers.delete(name);
        }

        this.endpoints.delete(name);
    }

    /**
     * Register an endpoint's callback for a channel.
     * Called by MemoryTransportEndpoint.joinChannel().
     *
     * @param {string} channelName - Channel to subscribe to
     * @param {string} endpointName - Name of the subscribing endpoint
     * @param {Function} callback - Message handler
     * @internal
     */
    _subscribe(channelName, endpointName, callback) {
        if (!this.channels.has(channelName)) {
            this.channels.set(channelName, new Map());
        }
        this.channels.get(channelName).set(endpointName, callback);
    }

    /**
     * Unsubscribe an endpoint from a channel.
     *
     * @param {string} channelName - Channel to unsubscribe from
     * @param {string} endpointName - Name of the endpoint
     * @internal
     */
    _unsubscribe(channelName, endpointName) {
        const subscribers = this.channels.get(channelName);
        if (subscribers) {
            subscribers.delete(endpointName);
            // Clean up empty channels
            if (subscribers.size === 0) {
                this.channels.delete(channelName);
            }
        }
    }

    /**
     * Route a message from a sender to all other subscribers on a channel.
     * Mimics Supabase broadcast behavior: sender does NOT receive own message.
     *
     * @param {string} channelName - Target channel
     * @param {Object} msg - Message payload
     * @param {string} senderName - Name of the sending endpoint (excluded from delivery)
     * @internal
     */
    _routeMessage(channelName, msg, senderName) {
        // Log if enabled
        if (this._enableLog) {
            this._messageLog.push({
                channel: channelName,
                msg,
                senderName,
                timestamp: Date.now()
            });
        }

        const subscribers = this.channels.get(channelName);
        if (!subscribers) return;

        // Deliver to all subscribers EXCEPT the sender
        for (const [endpointName, callback] of subscribers) {
            if (endpointName === senderName) continue;

            if (this.latencyMs > 0) {
                // Asynchronous delivery with simulated latency
                setTimeout(() => {
                    callback(msg);
                }, this.latencyMs);
            } else {
                // Synchronous delivery (default for deterministic tests)
                callback(msg);
            }
        }
    }

    /**
     * Get the message log (for test assertions).
     * Only populated if enableLog was set to true in constructor.
     *
     * @returns {Array<Object>}
     */
    getMessageLog() {
        return this._messageLog;
    }

    /**
     * Clear all state. Useful between test cases.
     */
    reset() {
        this.endpoints.clear();
        this.channels.clear();
        this._messageLog = [];
    }
}

// ========================================
// MemoryTransportEndpoint - Per-Participant Transport
// ========================================

/**
 * In-memory transport endpoint for a single participant.
 * Implements the full channel API expected by SessionManager.
 *
 * @extends TransportBase
 */
export class MemoryTransportEndpoint extends TransportBase {
    /**
     * @param {string} name - Unique endpoint name (e.g., 'host', 'guest1')
     * @param {MemoryTransportHub} hub - The central hub this endpoint belongs to
     */
    constructor(name, hub) {
        super();

        /**
         * Unique name for this endpoint.
         * @type {string}
         */
        this.name = name;

        /**
         * Reference to the central hub.
         * @type {MemoryTransportHub}
         */
        this._hub = hub;

        /**
         * Global message handler (set by SessionManager.setTransport).
         * @type {Function|null}
         * @private
         */
        this._globalMessageHandler = null;

        /**
         * Channels this endpoint has joined: channelName -> callback
         * @type {Map<string, Function>}
         * @private
         */
        this._joinedChannels = new Map();
    }

    // ========================================
    // CHANNEL API (what SessionManager expects)
    // ========================================

    /**
     * Join a named channel and register a callback for incoming messages.
     * Registers with the hub so broadcastToChannel from other endpoints
     * will invoke the callback.
     *
     * @param {string} channelName - Channel name (e.g., 'asterobia:lobby')
     * @param {Function} [callback] - Handler for messages on this channel
     * @returns {Promise<void>}
     */
    async joinChannel(channelName, callback = null) {
        if (!channelName) {
            throw new Error('Channel name is required');
        }

        // Already joined - idempotent
        if (this._joinedChannels.has(channelName)) {
            return;
        }

        // Create the channel callback that dispatches to both
        // the channel-specific callback and the global message handler
        const dispatcher = (msg) => {
            // Channel-specific callback
            if (callback) {
                callback(msg);
            }
            // Global message handler (if set via onMessage)
            if (this._globalMessageHandler) {
                this._globalMessageHandler(msg);
            }
        };

        this._joinedChannels.set(channelName, dispatcher);
        this._hub._subscribe(channelName, this.name, dispatcher);
    }

    /**
     * Broadcast a message to all other subscribers of a named channel.
     * The sender does NOT receive its own broadcast (mimics Supabase).
     *
     * @param {string} channelName - Channel name
     * @param {Object} msg - Message payload
     * @returns {Promise<void>}
     */
    async broadcastToChannel(channelName, msg) {
        if (!channelName) {
            throw new Error('Channel name is required');
        }

        if (!this._joinedChannels.has(channelName)) {
            throw new Error(`Not joined to channel: ${channelName}. Call joinChannel() first.`);
        }

        this._hub._routeMessage(channelName, msg, this.name);
    }

    /**
     * Register a global message handler.
     * Called by SessionManager.setTransport() to wire up message routing.
     *
     * Note: With MemoryTransport, the global handler receives messages
     * from ALL channels this endpoint has joined. Channel-specific
     * callbacks (from joinChannel) also fire independently.
     *
     * @param {Function} callback - Global message handler
     */
    onMessage(callback) {
        this._globalMessageHandler = callback;
    }

    /**
     * Leave a named channel.
     *
     * @param {string} channelName - Channel to leave
     * @returns {Promise<void>}
     */
    async leaveChannel(channelName) {
        if (!this._joinedChannels.has(channelName)) {
            return;
        }

        this._hub._unsubscribe(channelName, this.name);
        this._joinedChannels.delete(channelName);
    }

    /**
     * Check if this endpoint is joined to a specific channel.
     *
     * @param {string} channelName - Channel name
     * @returns {boolean}
     */
    isJoinedToChannel(channelName) {
        return this._joinedChannels.has(channelName);
    }

    // ========================================
    // BASE TRANSPORT API
    // ========================================

    /**
     * Send a command through the transport.
     * Uses the default command channel for base transport API compatibility.
     *
     * @param {Object} command - The command to send
     */
    send(command) {
        this._messagesSent++;

        if (this._state !== TransportState.CONNECTED) {
            return;
        }

        // Route through default command channel
        this._hub._routeMessage(DEFAULT_COMMAND_CHANNEL, command, this.name);
    }

    /**
     * Initialize the transport connection.
     * For MemoryTransport, this just sets the state to CONNECTED
     * and auto-joins the default command channel.
     */
    connect() {
        if (this._state === TransportState.CONNECTED) {
            return;
        }

        this._state = TransportState.CONNECTED;

        // Auto-join the default command channel for base transport API
        // (so send() works out of the box)
        if (!this._joinedChannels.has(DEFAULT_COMMAND_CHANNEL)) {
            const dispatcher = (msg) => {
                this._deliverReceived(msg);
            };
            this._joinedChannels.set(DEFAULT_COMMAND_CHANNEL, dispatcher);
            this._hub._subscribe(DEFAULT_COMMAND_CHANNEL, this.name, dispatcher);
        }
    }

    /**
     * Disconnect the transport and clean up all channel subscriptions.
     */
    disconnect() {
        // Leave all channels
        for (const channelName of this._joinedChannels.keys()) {
            this._hub._unsubscribe(channelName, this.name);
        }
        this._joinedChannels.clear();

        this._state = TransportState.DISCONNECTED;
        this._globalMessageHandler = null;
    }

    /**
     * Get transport type identifier.
     * @returns {string}
     */
    get type() {
        return 'memory';
    }

    /**
     * Get the list of channels this endpoint has joined.
     * @returns {string[]}
     */
    get joinedChannels() {
        return Array.from(this._joinedChannels.keys());
    }
}
