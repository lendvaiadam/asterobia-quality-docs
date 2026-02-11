/**
 * GameServer - Main server class for the Asterobia authoritative server.
 *
 * Manages Room instances (each Room is one active match).
 * Phase 0: No networking -- rooms are created and ticked in-process.
 * Phase 1 will add WebSocket listener and client connection handling.
 *
 * @module server/GameServer
 */

import { Room } from './Room.js';
import { nextEntityId, resetEntityIdCounter } from '../src/SimCore/runtime/IdGenerator.js';

export class GameServer {
    /**
     * @param {Object} [options]
     * @param {number} [options.tickRate=20] - Server tick rate in Hz (default 20 = 50ms per tick)
     */
    constructor(options = {}) {
        /** @type {number} Target tick rate in Hz */
        this.tickRate = options.tickRate || 20;

        /** @type {Map<string, Room>} roomId -> Room */
        this.rooms = new Map();

        /** @type {boolean} Whether the server is running */
        this.isRunning = false;
    }

    /**
     * Create a new room/match.
     *
     * @param {string} roomId - Unique room identifier
     * @param {Object} [options] - Room options (passed to Room constructor)
     * @returns {Room} The created room
     * @throws {Error} If room with this ID already exists
     */
    createRoom(roomId, options = {}) {
        if (this.rooms.has(roomId)) {
            throw new Error(`Room ${roomId} already exists`);
        }

        const tickMs = Math.round(1000 / this.tickRate);
        const room = new Room(roomId, { tickMs, ...options });
        this.rooms.set(roomId, room);
        return room;
    }

    /**
     * Get a room by ID.
     *
     * @param {string} roomId
     * @returns {Room|undefined}
     */
    getRoom(roomId) {
        return this.rooms.get(roomId);
    }

    /**
     * Remove and stop a room.
     *
     * @param {string} roomId
     * @returns {boolean} True if room was found and removed
     */
    removeRoom(roomId) {
        const room = this.rooms.get(roomId);
        if (!room) return false;

        room.stop();
        this.rooms.delete(roomId);
        return true;
    }

    /**
     * Start the server. In Phase 0, this just marks the server as running.
     * Phase 1 will start a WebSocket listener here.
     */
    start() {
        this.isRunning = true;
    }

    /**
     * Stop the server. Stops all rooms and cleans up.
     */
    stop() {
        this.isRunning = false;

        for (const [roomId, room] of this.rooms) {
            room.stop();
        }
        this.rooms.clear();
    }

    /**
     * Wire this GameServer to a WsRelay instance.
     * Intercepts channel broadcasts to create rooms and route inputs.
     *
     * Phase 2A: Listens for HOST_ANNOUNCE to create rooms, MOVE_INPUT to route inputs.
     * Injects SERVER_SNAPSHOT back into the relay for delivery to clients.
     *
     * @param {import('./WsRelay.js').WsRelay} relay - The relay to wire to
     */
    wireToRelay(relay) {
        this._relay = relay;

        // Hook into relay's broadcast path
        const originalBroadcast = relay._broadcast.bind(relay);
        relay._broadcast = (ws, client, channelName, payload) => {
            // Let the relay do its normal broadcast first
            originalBroadcast(ws, client, channelName, payload);

            // Then intercept for server authority
            if (payload && payload.type === 'HOST_ANNOUNCE') {
                this._onHostAnnounce(channelName, payload, client);
            } else if (payload && payload.type === 'MOVE_INPUT') {
                this._onMoveInput(channelName, payload, client);
            }
        };

        console.log('[GameServer] Wired to WsRelay (Phase 2A authority mode)');
    }

    /**
     * Handle HOST_ANNOUNCE: create a Room and start ticking.
     * @private
     */
    _onHostAnnounce(channelName, payload, client) {
        // Use hostId as roomId (matches client session channel naming)
        const roomId = payload.hostId;
        if (!roomId || this.rooms.has(roomId)) return;

        // Create room with broadcast callback that injects into relay
        const room = this.createRoom(roomId, {
            broadcast: (rid, snapshot) => {
                this._injectToChannel(`asterobia:session:${rid}`, snapshot);
            }
        });

        // Create a unit for the host (slot 0)
        const hostSlot = 0;
        room.addPlayer(roomId, payload.hostDisplayName || 'Host', null);
        room.createUnitForPlayer(hostSlot, nextEntityId());

        room.start();
        console.log(`[GameServer] Room ${roomId} created and started (Phase 2A)`);
    }

    /**
     * Handle MOVE_INPUT: route to the correct room.
     * @private
     */
    _onMoveInput(channelName, payload, client) {
        // Extract roomId from channel name: "asterobia:session:<roomId>"
        const parts = channelName.split(':');
        if (parts.length < 3) return;
        const roomId = parts[2];

        const room = this.rooms.get(roomId);
        if (!room) return;

        // Determine source slot from client ID (simple: host=0, guests=1+)
        // For Phase 2A, use the sourceSlot from payload if present, otherwise client.id - 1
        const sourceSlot = payload.sourceSlot ?? (client.id - 1);

        room.receiveInput(sourceSlot, {
            type: 'MOVE_INPUT',
            forward: !!payload.forward,
            backward: !!payload.backward,
            left: !!payload.left,
            right: !!payload.right
        });
    }

    /**
     * Inject a message into a relay channel (server -> all subscribers).
     * Used for broadcasting SERVER_SNAPSHOT to clients.
     * @private
     */
    _injectToChannel(channelName, payload) {
        if (!this._relay) return;

        const subs = this._relay.channels.get(channelName);
        if (!subs) return;

        const outMsg = JSON.stringify({
            type: 'message',
            channel: channelName,
            payload
        });

        // Send to ALL subscribers (server is not a subscriber, so no self-exclude needed)
        for (const ws of subs) {
            if (ws.readyState === 1) {
                ws.send(outMsg);
            }
        }
    }
}
