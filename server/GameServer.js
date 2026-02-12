/**
 * GameServer - Main server class for the Asterobia authoritative server.
 *
 * Manages Room instances (each Room is one active match).
 * Phase 2A: Server authority — owns entity lifecycle, routes inputs via
 * transport-authenticated identity, broadcasts SERVER_SNAPSHOT.
 *
 * Security: NEVER trusts payload.sourceSlot. Uses _clientSlots map
 * populated from relay's server-assigned client.id.
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

        /**
         * Transport-authenticated identity mapping.
         * Maps WsRelay client.id (server-assigned, trusted) -> { roomId, slot }.
         * NEVER populated from client payload.
         * @type {Map<number, { roomId: string, slot: number }>}
         */
        this._clientSlots = new Map();

        /** @type {import('./WsRelay.js').WsRelay|null} */
        this._relay = null;
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
        this._clientSlots.clear();
    }

    /**
     * Wire this GameServer to a WsRelay instance.
     * Intercepts channel broadcasts to create rooms and route inputs.
     *
     * Phase 2A: Listens for HOST_ANNOUNCE, SPAWN_MANIFEST, MOVE_INPUT, JOIN_REQ.
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
            if (!payload || !payload.type) return;

            switch (payload.type) {
                case 'HOST_ANNOUNCE':
                    this._onHostAnnounce(channelName, payload, client);
                    break;
                case 'SPAWN_MANIFEST':
                    this._onSpawnManifest(channelName, payload, client);
                    break;
                case 'MOVE_INPUT':
                    this._onMoveInput(channelName, payload, client);
                    break;
                case 'JOIN_ACK':
                    this._onJoinAck(channelName, payload, client);
                    break;
            }
        };

        // Hook into disconnect to clean up slot mapping
        const originalDisconnect = relay._handleDisconnect?.bind(relay);
        if (originalDisconnect) {
            relay._handleDisconnect = (ws) => {
                const client = relay.clients.get(ws);
                if (client) {
                    this._onClientDisconnect(client);
                }
                originalDisconnect(ws);
            };
        }

        console.log('[GameServer] Wired to WsRelay (Phase 2A authority mode)');
    }

    /**
     * Handle HOST_ANNOUNCE: create a Room in WAITING state.
     * Room does NOT start ticking — waits for SPAWN_MANIFEST.
     * @private
     */
    _onHostAnnounce(channelName, payload, client) {
        const roomId = payload.hostId;
        if (!roomId || this.rooms.has(roomId)) return;

        // Create room with broadcast callback (stays in WAITING state)
        const room = this.createRoom(roomId, {
            broadcast: (rid, snapshot) => {
                this._injectToChannel(`asterobia:session:${rid}`, snapshot);
            }
        });

        // Map host: transport-authenticated client.id -> slot 0
        const hostSlot = 0;
        this._clientSlots.set(client.id, { roomId, slot: hostSlot });

        room.addPlayer(roomId, payload.hostDisplayName || 'Host', null);

        console.log(`[GameServer] Room ${roomId} created (WAITING for SPAWN_MANIFEST)`);
    }

    /**
     * Handle SPAWN_MANIFEST: create HeadlessUnits from host's entity list.
     * Uses client-provided IDs — guarantees 1:1 mapping by construction.
     * Transitions room from WAITING to RUNNING.
     * @private
     */
    _onSpawnManifest(channelName, payload, client) {
        // Only accept from authenticated host (slot 0)
        const auth = this._clientSlots.get(client.id);
        if (!auth || auth.slot !== 0) {
            console.warn(`[GameServer] SPAWN_MANIFEST rejected: client ${client.id} is not host`);
            return;
        }

        const room = this.rooms.get(auth.roomId);
        if (!room) return;

        // Only accept manifest once (room must be in WAITING state)
        if (room.state !== 'WAITING') {
            console.warn(`[GameServer] SPAWN_MANIFEST rejected: room ${auth.roomId} already in ${room.state}`);
            return;
        }

        if (!Array.isArray(payload.units) || payload.units.length === 0) {
            console.warn('[GameServer] SPAWN_MANIFEST rejected: empty or invalid units array');
            return;
        }

        // Create HeadlessUnits from manifest (client-provided IDs)
        room.createUnitsFromManifest(payload.units);

        // Start ticking
        room.start();
        console.log(`[GameServer] Room ${auth.roomId} received manifest (${payload.units.length} units) — RUNNING`);
    }

    /**
     * Handle JOIN_ACK (sent by host to guest): learn the guest's assigned slot.
     * This lets us map the guest's WebSocket to their slot when they send MOVE_INPUT.
     *
     * We observe the JOIN_ACK broadcast to learn {guestId -> slot} without modifying
     * the Phase 1 join flow.
     * @private
     */
    _onJoinAck(channelName, payload, client) {
        if (!payload.accepted || payload.assignedSlot == null) return;

        const roomId = this._extractRoomId(channelName);
        if (!roomId) return;

        const room = this.rooms.get(roomId);
        if (!room) return;

        // Note: we can't map the GUEST's client.id here because this broadcast
        // comes from the HOST's WebSocket. We'll map the guest when they send
        // their first MOVE_INPUT (see _onMoveInput fallback).
        // For now, create a guest unit on the server so it appears in snapshots.
        const guestSlot = payload.assignedSlot;
        const unitId = nextEntityId();
        const modelIndex = unitId % 5;
        room.createUnitForPlayer(guestSlot, unitId, { modelIndex });

        console.log(`[GameServer] Guest unit created for slot ${guestSlot} (id=${unitId}) in room ${roomId}`);
    }

    /**
     * Handle MOVE_INPUT: route to the correct room using transport-auth identity.
     * NEVER trusts payload.sourceSlot.
     * @private
     */
    _onMoveInput(channelName, payload, client) {
        const roomId = this._extractRoomId(channelName);
        if (!roomId) return;

        const room = this.rooms.get(roomId);
        if (!room) return;

        // Look up transport-authenticated slot
        let auth = this._clientSlots.get(client.id);

        // Fallback: if this client isn't mapped yet (guest's first message),
        // try to find their slot by checking room players.
        // This handles the race between JOIN_ACK and first MOVE_INPUT.
        if (!auth && roomId) {
            // Find unmatched guest slot by checking which slots have no client mapping
            for (const [slot] of room.players) {
                const alreadyMapped = [...this._clientSlots.values()].some(
                    a => a.roomId === roomId && a.slot === slot
                );
                if (!alreadyMapped && slot > 0) {
                    // This is likely the guest — map them
                    this._clientSlots.set(client.id, { roomId, slot });
                    auth = { roomId, slot };
                    console.log(`[GameServer] Auto-mapped client ${client.id} to slot ${slot} in room ${roomId}`);
                    break;
                }
            }
        }

        if (!auth) return; // Unknown client, silently drop

        const command = {
            type: 'MOVE_INPUT',
            forward: !!payload.forward,
            backward: !!payload.backward,
            left: !!payload.left,
            right: !!payload.right
        };

        // Pass unitId if present (multi-unit control)
        if (payload.unitId != null) {
            command.unitId = payload.unitId;
        }

        room.receiveInput(auth.slot, command);
    }

    /**
     * Clean up client slot mapping on disconnect.
     * @private
     */
    _onClientDisconnect(client) {
        if (this._clientSlots.has(client.id)) {
            const auth = this._clientSlots.get(client.id);
            console.log(`[GameServer] Client ${client.id} disconnected (was slot ${auth.slot} in room ${auth.roomId})`);
            this._clientSlots.delete(client.id);
        }
    }

    /**
     * Extract roomId from channel name: "asterobia:session:<roomId>"
     * @private
     */
    _extractRoomId(channelName) {
        const parts = channelName.split(':');
        return parts.length >= 3 ? parts[2] : null;
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
