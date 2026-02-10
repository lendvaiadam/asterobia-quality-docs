/**
 * WsRelay - WebSocket Channel Relay Server
 *
 * A dumb channel-based message relay that acts as a drop-in replacement
 * for Supabase Realtime. Clients subscribe to named channels and broadcast
 * JSON payloads to other subscribers on the same channel.
 *
 * Wire Protocol (JSON over WebSocket text frames):
 *
 * Client -> Server:
 *   { "type": "subscribe",   "channel": "asterobia:lobby" }
 *   { "type": "unsubscribe", "channel": "asterobia:lobby" }
 *   { "type": "broadcast",   "channel": "asterobia:session:xxx", "payload": { ... } }
 *
 * Server -> Client:
 *   { "type": "message", "channel": "asterobia:session:xxx", "payload": { ... } }
 *   { "type": "error",   "message": "Not subscribed to channel: ..." }
 *
 * Semantics:
 *   - Broadcast delivers to ALL subscribers EXCEPT the sender (Supabase semantics)
 *   - Sender must be subscribed to a channel before broadcasting on it
 *   - Unknown message types and invalid JSON are handled with error responses
 */

import { WebSocketServer } from 'ws';

export class WsRelay {
    constructor(options = {}) {
        this.port = options.port || 3000;
        this.wss = null;

        // Track clients: ws -> { id, channels: Set<string> }
        this.clients = new Map();

        // Track channels: channelName -> Set<ws>
        this.channels = new Map();

        this._nextClientId = 1;
    }

    /**
     * Start the relay on a fixed port (standalone mode).
     */
    start() {
        this.wss = new WebSocketServer({ port: this.port });
        this._attachConnectionHandler();
        console.log(`[WsRelay] Listening on ws://localhost:${this.port}`);
    }

    /**
     * Start the relay on an existing HTTP server (for tests with ephemeral ports).
     * @param {import('http').Server} server
     */
    startOnServer(server) {
        this.wss = new WebSocketServer({ server });
        this._attachConnectionHandler();
    }

    /**
     * Cleanly close all client connections and shut down the server.
     * Returns a Promise that resolves when the server is fully closed.
     */
    stop() {
        return new Promise((resolve) => {
            if (!this.wss) {
                this.clients.clear();
                this.channels.clear();
                resolve();
                return;
            }

            // Close all client connections
            for (const ws of this.clients.keys()) {
                ws.close();
            }

            this.wss.close(() => {
                this.wss = null;
                this.clients.clear();
                this.channels.clear();
                resolve();
            });
        });
    }

    /**
     * Attach the connection handler to the WebSocketServer instance.
     * Shared between start() and startOnServer().
     */
    _attachConnectionHandler() {
        this.wss.on('connection', (ws) => {
            const clientId = this._nextClientId++;
            this.clients.set(ws, { id: clientId, channels: new Set() });
            console.log(`[WsRelay] Client ${clientId} connected (${this.clients.size} total)`);

            ws.on('message', (data) => {
                this._handleMessage(ws, data);
            });

            ws.on('close', () => {
                this._handleDisconnect(ws);
            });

            ws.on('error', (err) => {
                console.error(`[WsRelay] Client ${clientId} error:`, err.message);
            });
        });
    }

    /**
     * Parse and dispatch an incoming message from a client.
     */
    _handleMessage(ws, rawData) {
        let msg;
        try {
            msg = JSON.parse(rawData.toString());
        } catch (e) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
            return;
        }

        const client = this.clients.get(ws);
        if (!client) return;

        switch (msg.type) {
            case 'subscribe':
                this._subscribe(ws, client, msg.channel);
                break;
            case 'unsubscribe':
                this._unsubscribe(ws, client, msg.channel);
                break;
            case 'broadcast':
                this._broadcast(ws, client, msg.channel, msg.payload);
                break;
            default:
                ws.send(JSON.stringify({
                    type: 'error',
                    message: `Unknown message type: ${msg.type}`
                }));
        }
    }

    /**
     * Subscribe a client to a named channel.
     */
    _subscribe(ws, client, channelName) {
        if (!channelName) return;

        client.channels.add(channelName);

        if (!this.channels.has(channelName)) {
            this.channels.set(channelName, new Set());
        }
        this.channels.get(channelName).add(ws);

        console.log(`[WsRelay] Client ${client.id} subscribed to ${channelName}`);
    }

    /**
     * Unsubscribe a client from a named channel.
     */
    _unsubscribe(ws, client, channelName) {
        if (!channelName) return;

        client.channels.delete(channelName);

        const subs = this.channels.get(channelName);
        if (subs) {
            subs.delete(ws);
            if (subs.size === 0) {
                this.channels.delete(channelName);
            }
        }
    }

    /**
     * Broadcast a payload to all subscribers on a channel except the sender.
     * Sender must be subscribed to the channel.
     */
    _broadcast(ws, client, channelName, payload) {
        if (!channelName || !payload) return;

        // Verify sender is subscribed
        if (!client.channels.has(channelName)) {
            ws.send(JSON.stringify({
                type: 'error',
                message: `Not subscribed to channel: ${channelName}`
            }));
            return;
        }

        const subs = this.channels.get(channelName);
        if (!subs) return;

        const outMsg = JSON.stringify({
            type: 'message',
            channel: channelName,
            payload
        });

        // Broadcast to ALL subscribers EXCEPT sender (Supabase semantics)
        for (const sub of subs) {
            if (sub !== ws && sub.readyState === 1 /* WebSocket.OPEN */) {
                sub.send(outMsg);
            }
        }
    }

    /**
     * Clean up when a client disconnects: remove from all channels and the client map.
     */
    _handleDisconnect(ws) {
        const client = this.clients.get(ws);
        if (!client) return;

        // Remove from all channels
        for (const channelName of client.channels) {
            const subs = this.channels.get(channelName);
            if (subs) {
                subs.delete(ws);
                if (subs.size === 0) {
                    this.channels.delete(channelName);
                }
            }
        }

        this.clients.delete(ws);
        console.log(`[WsRelay] Client ${client.id} disconnected (${this.clients.size} remaining)`);
    }

    /**
     * Get the number of currently connected clients.
     */
    get clientCount() {
        return this.clients.size;
    }
}
