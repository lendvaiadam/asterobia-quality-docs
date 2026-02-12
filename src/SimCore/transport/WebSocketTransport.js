/**
 * WebSocketTransport - Browser-Side WebSocket Transport
 *
 * R013: Implements ITransport using a native browser WebSocket connection
 * to the WS relay server (server/WsRelay.js). Acts as a Supabase Realtime
 * replacement for multiplayer channel communication.
 *
 * Architecture:
 *   SessionManager -> WebSocketTransport.broadcastToChannel() -> WebSocket -> WsRelay -> other clients
 *   WsRelay -> WebSocket -> WebSocketTransport._onWsMessage() -> channel callback -> SessionManager
 *
 * Wire Protocol (JSON over WebSocket text frames):
 *   Client -> Server:
 *     { type: "subscribe",   channel: "asterobia:lobby" }
 *     { type: "unsubscribe", channel: "asterobia:lobby" }
 *     { type: "broadcast",   channel: "asterobia:session:xxx", payload: { ... } }
 *
 *   Server -> Client:
 *     { type: "message", channel: "asterobia:session:xxx", payload: { ... } }
 *     { type: "error",   message: "..." }
 *
 * Key behaviors:
 *   - Uses native browser WebSocket (no npm imports)
 *   - One WebSocket connection carries all channels (multiplexed via relay protocol)
 *   - joinChannel/broadcastToChannel auto-reconnect if WS is dead (_ensureConnected)
 *   - Channel subscriptions are tracked for re-subscribe on reconnect
 *   - onopen: re-subscribes all channels, then flushes pending messages
 *   - CLIENT-ONLY: The server uses the `ws` npm library instead
 *
 * INVARIANT: Does NOT import DOM, Three.js, or Node.js-only APIs.
 * INVARIANT: payload passed to broadcastToChannel is forwarded as-is (no wrapping).
 */

import { TransportBase, TransportState } from './ITransport.js';

/**
 * WebSocketTransport provides channel-based multiplayer communication
 * over a native browser WebSocket connection to the WS relay server.
 *
 * @extends TransportBase
 */
export class WebSocketTransport extends TransportBase {
    /**
     * @param {Object} [options]
     * @param {string} [options.url='ws://localhost:8081'] - WebSocket server URL
     * @param {number} [options.connectTimeoutMs=5000] - Max wait for WS connection
     */
    constructor(options = {}) {
        super();

        /** @type {string} WebSocket server URL */
        this._url = options.url || 'ws://localhost:8081';

        /** @type {number} Connection timeout in ms */
        this._connectTimeoutMs = options.connectTimeoutMs || 5000;

        /** @type {WebSocket|null} Native browser WebSocket instance */
        this._ws = null;

        /** @type {Function|null} Global message handler (set by SessionManager via onMessage()) */
        this._globalMessageHandler = null;

        /**
         * Channel-specific callbacks: channelName -> callback
         * @type {Map<string, Function>}
         */
        this._channelCallbacks = new Map();

        /**
         * Names of channels we've subscribed to.
         * Tracked so we can re-subscribe on reconnect.
         * @type {string[]}
         */
        this._subscribedChannels = [];

        /**
         * Messages queued before WebSocket connection is open.
         * Flushed in onopen handler after channel re-subscriptions.
         * @type {string[]}
         */
        this._pendingMessages = [];

        /**
         * Count of messages actually sent over the wire (not queued).
         * @type {number}
         */
        this._wireSendCount = 0;

        /**
         * Whether disconnect() was called intentionally (prevents auto-reconnect).
         * @type {boolean}
         */
        this._intentionalDisconnect = false;
    }

    // ========================================
    // CHANNEL API (matches SupabaseTransport / MemoryTransportEndpoint)
    // ========================================

    /**
     * Join a named channel and subscribe to its messages.
     * Ensures the WS connection is open before sending the subscribe frame.
     * If WS is dead, auto-reconnects (like SupabaseTransport waits for SUBSCRIBED).
     *
     * @param {string} channelName - Channel name (e.g., 'asterobia:lobby')
     * @param {Function} [callback] - Callback for incoming messages on this channel
     * @returns {Promise<void>}
     */
    async joinChannel(channelName, callback = null) {
        if (!channelName) {
            throw new Error('Channel name is required');
        }

        // Store callback for message routing
        if (callback) {
            this._channelCallbacks.set(channelName, callback);
        }

        // Track for reconnect re-subscription
        if (!this._subscribedChannels.includes(channelName)) {
            this._subscribedChannels.push(channelName);
        }

        // Ensure WS is open (reconnects if needed)
        await this._ensureConnected();

        // Send subscribe frame to relay server
        this._sendWsMessage({ type: 'subscribe', channel: channelName });
    }

    /**
     * Broadcast a message to all other subscribers of a named channel.
     * Ensures the WS connection is open before sending.
     *
     * @param {string} channelName - Channel name
     * @param {Object} msg - Message payload (forwarded as-is, no wrapping)
     * @returns {Promise<void>}
     */
    async broadcastToChannel(channelName, msg) {
        if (!channelName) {
            throw new Error('Channel name is required');
        }

        // Ensure WS is open (reconnects if needed)
        await this._ensureConnected();

        this._sendWsMessage({
            type: 'broadcast',
            channel: channelName,
            payload: msg
        });
    }

    /**
     * Register a global message handler.
     * Called by SessionManager.setTransport() to wire up message routing.
     * Used as fallback when no channel-specific callback exists.
     *
     * @param {Function} callback - Global message handler
     */
    onMessage(callback) {
        this._globalMessageHandler = callback;
    }

    /**
     * Leave a named channel.
     * Sends an "unsubscribe" frame to the relay server.
     *
     * @param {string} channelName - Channel name to leave
     * @returns {Promise<void>}
     */
    async leaveChannel(channelName) {
        this._channelCallbacks.delete(channelName);

        const idx = this._subscribedChannels.indexOf(channelName);
        if (idx !== -1) {
            this._subscribedChannels.splice(idx, 1);
        }

        this._sendWsMessage({ type: 'unsubscribe', channel: channelName });
    }

    /**
     * Check if this transport is subscribed to a specific channel.
     *
     * @param {string} channelName - Channel name
     * @returns {boolean}
     */
    isJoinedToChannel(channelName) {
        return this._subscribedChannels.includes(channelName);
    }

    // ========================================
    // BASE TRANSPORT API
    // ========================================

    /**
     * Send a command through the base transport API.
     * Uses the '__commands__' default channel for compatibility.
     *
     * @param {Object} command - The command to send
     */
    send(command) {
        this._messagesSent++;
        this._sendWsMessage({
            type: 'broadcast',
            channel: '__commands__',
            payload: command
        });
    }

    /**
     * Initialize the WebSocket connection to the relay server.
     * On successful open, re-subscribes to all tracked channels
     * and flushes any pending messages.
     */
    connect() {
        if (this._state === TransportState.CONNECTED ||
            this._state === TransportState.CONNECTING) {
            return;
        }

        this._intentionalDisconnect = false;

        // Clean up old socket if reconnecting (e.g., after disconnect/error)
        this._cleanupSocket();

        this._state = TransportState.CONNECTING;

        try {
            this._ws = new WebSocket(this._url);
        } catch (err) {
            console.error('[WebSocketTransport] Failed to create WebSocket:', err.message);
            this._state = TransportState.ERROR;
            return;
        }

        this._ws.onopen = () => {
            console.log('[WebSocketTransport] Connected to', this._url);
            this._state = TransportState.CONNECTED;

            // Re-subscribe to all tracked channels (critical for reconnection)
            for (const ch of this._subscribedChannels) {
                this._ws.send(JSON.stringify({ type: 'subscribe', channel: ch }));
                this._wireSendCount++;
            }

            // Flush pending messages (subscribe + broadcast frames queued while disconnected)
            const flushed = this._pendingMessages.length;
            for (const msg of this._pendingMessages) {
                this._ws.send(msg);
                this._wireSendCount++;
            }
            this._pendingMessages = [];

            if (flushed > 0) {
                console.log(`[WebSocketTransport] Flushed ${flushed} pending messages`);
            }
        };

        this._ws.onmessage = (event) => {
            this._onWsMessage(event.data);
        };

        this._ws.onclose = (event) => {
            console.log(`[WebSocketTransport] Disconnected: code=${event.code} reason="${event.reason || ''}"`);
            this._state = TransportState.DISCONNECTED;
        };

        this._ws.onerror = () => {
            console.error('[WebSocketTransport] WebSocket error to', this._url);
            this._state = TransportState.ERROR;
        };
    }

    /**
     * Disconnect the WebSocket and clean up all state.
     * Marks this as intentional so _ensureConnected won't auto-reconnect.
     */
    disconnect() {
        this._intentionalDisconnect = true;
        this._cleanupSocket();
        this._state = TransportState.DISCONNECTED;
        this._channelCallbacks.clear();
        this._subscribedChannels = [];
        this._pendingMessages = [];
        this._globalMessageHandler = null;
    }

    /**
     * Get transport type identifier.
     * @returns {string}
     */
    get type() {
        return 'websocket';
    }

    /**
     * Get diagnostic info about the transport's current state.
     * Used by SessionManager for timeout debugging and HU-test diagnostics.
     *
     * @returns {Object} Debug info snapshot
     */
    getDebugInfo() {
        return {
            type: 'websocket',
            url: this._url,
            state: this._state,
            wsReadyState: this._ws?.readyState ?? null,
            wsReadyStateLabel: this._ws ? ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][this._ws.readyState] || 'UNKNOWN' : 'NO_SOCKET',
            subscribedChannels: [...this._subscribedChannels],
            channelCallbackCount: this._channelCallbacks.size,
            pendingMessageCount: this._pendingMessages.length,
            hasGlobalHandler: !!this._globalMessageHandler,
            messagesSent: this._messagesSent,
            messagesReceived: this._messagesReceived,
            wireSendCount: this._wireSendCount,
            intentionalDisconnect: this._intentionalDisconnect
        };
    }

    // ========================================
    // INTERNAL
    // ========================================

    /**
     * Ensure the WebSocket is connected and ready to send.
     * If disconnected/errored, attempts to reconnect and waits for OPEN.
     * If intentionally disconnected (via disconnect()), throws immediately.
     *
     * @param {number} [timeoutMs] - Max wait time (default: this._connectTimeoutMs)
     * @returns {Promise<void>} Resolves when WS is OPEN
     * @throws {Error} If connection fails or times out
     * @private
     */
    async _ensureConnected(timeoutMs) {
        const timeout = timeoutMs || this._connectTimeoutMs;

        // Already connected and socket is OPEN
        if (this._state === TransportState.CONNECTED && this._ws?.readyState === 1) {
            return;
        }

        // If intentionally disconnected, don't auto-reconnect
        if (this._intentionalDisconnect) {
            throw new Error('[WebSocketTransport] Transport was intentionally disconnected');
        }

        // If not already connecting, initiate (re)connection
        if (this._state !== TransportState.CONNECTING) {
            console.log(`[WebSocketTransport] Auto-reconnecting (was ${this._state})...`);
            this.connect();
        }

        // Wait for connection to resolve
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(
                    `[WebSocketTransport] Connection timeout (${timeout}ms) to ${this._url}. ` +
                    `State: ${this._state}, readyState: ${this._ws?.readyState ?? 'null'}`
                ));
            }, timeout);

            const check = setInterval(() => {
                if (this._state === TransportState.CONNECTED && this._ws?.readyState === 1) {
                    clearInterval(check);
                    clearTimeout(timer);
                    resolve();
                } else if (this._state === TransportState.ERROR ||
                           (this._state === TransportState.DISCONNECTED)) {
                    clearInterval(check);
                    clearTimeout(timer);
                    reject(new Error(
                        `[WebSocketTransport] Connection failed to ${this._url} (state: ${this._state}). ` +
                        `Is the relay server running on ${this._url}?`
                    ));
                }
            }, 25);
        });
    }

    /**
     * Clean up the current WebSocket instance.
     * Removes event handlers and closes the socket if still open.
     *
     * @private
     */
    _cleanupSocket() {
        if (this._ws) {
            this._ws.onopen = null;
            this._ws.onmessage = null;
            this._ws.onclose = null;
            this._ws.onerror = null;
            if (this._ws.readyState === 0 || this._ws.readyState === 1) {
                this._ws.close();
            }
            this._ws = null;
        }
    }

    /**
     * Send a JSON message over the WebSocket.
     * If the socket is not yet open, the message is queued
     * and will be flushed when the connection opens.
     *
     * @param {Object} msg - Message object to serialize and send
     * @private
     */
    _sendWsMessage(msg) {
        const json = JSON.stringify(msg);

        // WebSocket.OPEN === 1
        if (this._ws && this._ws.readyState === 1) {
            this._ws.send(json);
            this._wireSendCount++;
        } else {
            // Queue for delivery when socket opens
            this._pendingMessages.push(json);
        }
    }

    /**
     * Handle an incoming WebSocket message from the relay server.
     * Routes the payload to the channel-specific callback if one exists,
     * otherwise falls back to the global handler. Only ONE dispatch path
     * fires per message to prevent double-processing in SessionManager.
     *
     * @param {string} rawData - Raw JSON string from the WebSocket
     * @private
     */
    _onWsMessage(rawData) {
        let msg;
        try {
            msg = JSON.parse(rawData);
        } catch (e) {
            console.warn('[WebSocketTransport] Invalid JSON from server:', rawData);
            return;
        }

        if (msg.type === 'message' && msg.channel && msg.payload) {
            this._messagesReceived++;

            // Route to channel-specific callback OR global handler (NOT both).
            // Both paths ultimately call SessionManager.onMessage(), so dispatching
            // to both causes every message to be processed twice (double JOIN_REQ,
            // double JOIN_ACK, etc). Channel callback takes priority.
            const channelCb = this._channelCallbacks.get(msg.channel);
            if (channelCb) {
                channelCb(msg.payload);
            } else if (this._globalMessageHandler) {
                this._globalMessageHandler(msg.payload);
            }
        } else if (msg.type === 'error') {
            console.warn('[WebSocketTransport] Server error:', msg.message);
        }
    }
}
