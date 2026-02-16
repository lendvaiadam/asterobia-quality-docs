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
import { Vec3 } from './SphereMath.js';
import { nextEntityId, resetEntityIdCounter } from '../src/SimCore/runtime/IdGenerator.js';

/** @type {number} Maximum units allowed in a single SPAWN_MANIFEST */
const MAX_MANIFEST_UNITS = 200;

/** @type {number} Maximum valid player slot index */
const MAX_SLOT = 10;

/** @type {number} Maximum waypoints in a PATH_DATA message (Phase 2B) */
const MAX_WAYPOINTS = 32;

/** @type {number} Maximum distance between consecutive waypoints in world units (Phase 2B) */
const MAX_SEGMENT_LENGTH = 200;

export class GameServer {
    /**
     * @param {Object} [options]
     * @param {number} [options.tickRate=20] - Server tick rate in Hz (default 20 = 50ms per tick)
     * @param {number} [options.maxManifestUnits=200] - Max units per manifest
     * @param {number} [options.maxSlot=10] - Max valid player slot index
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

        /** @type {number} Max units per manifest (OOM prevention) */
        this._maxManifestUnits = options.maxManifestUnits || MAX_MANIFEST_UNITS;

        /** @type {number} Max valid slot index */
        this._maxSlot = options.maxSlot || MAX_SLOT;

        /** @type {boolean} Pass enablePhysics to new rooms */
        this._enablePhysics = !!options.enablePhysics;

        /** @type {Object} Physics options (gravity, subSteps, etc.) passed to rooms */
        this._physicsOptions = options.physicsOptions || {};
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
        const room = new Room(roomId, { tickMs, enablePhysics: this._enablePhysics, physicsOptions: this._physicsOptions, ...options });
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
                case 'PATH_DATA':
                    this._onPathData(channelName, payload, client);
                    break;
                case 'CMD_ADMIN':
                    this._onAdminCommand(channelName, payload, client);
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

        console.log('[GameServer] Wired to WsRelay (Phase 2B: MOVE_INPUT + PATH_DATA authority)');
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

        // Security: cap manifest size to prevent OOM from malicious host
        if (payload.units.length > this._maxManifestUnits) {
            console.warn(`[GameServer] SPAWN_MANIFEST rejected: ${payload.units.length} units exceeds limit of ${this._maxManifestUnits}`);
            return;
        }

        // Security: validate and normalize each unit entry
        const sanitized = [];
        for (const mu of payload.units) {
            // ownerSlot must be a number within valid range
            const slot = typeof mu.ownerSlot === 'number' ? mu.ownerSlot : 0;
            if (slot < 0 || slot > this._maxSlot) {
                console.warn(`[GameServer] SPAWN_MANIFEST: skipping unit with invalid ownerSlot ${mu.ownerSlot}`);
                continue;
            }
            // id must be a number
            if (typeof mu.id !== 'number') continue;
            sanitized.push({
                id: mu.id,
                ownerSlot: slot,
                modelIndex: typeof mu.modelIndex === 'number' ? mu.modelIndex : 0,
                px: typeof mu.px === 'number' ? mu.px : undefined,
                py: typeof mu.py === 'number' ? mu.py : undefined,
                pz: typeof mu.pz === 'number' ? mu.pz : undefined
            });
        }

        if (sanitized.length === 0) {
            console.warn('[GameServer] SPAWN_MANIFEST rejected: no valid units after sanitization');
            return;
        }

        // Create HeadlessUnits from sanitized manifest (client-provided IDs)
        room.createUnitsFromManifest(sanitized);

        // Start ticking (async: physics WASM init needs await)
        room.start().then(() => {
            console.log(`[GameServer] Room ${auth.roomId} received manifest (${payload.units.length} units) — RUNNING`);
            if (room.physics) {
                console.log(`[GameServer] Room ${auth.roomId} physics initialized (Rapier)`);
            }
        }).catch(err => {
            console.error(`[GameServer] Room ${auth.roomId} failed to start:`, err);
        });
    }

    /**
     * Handle JOIN_ACK (sent by host to guest): learn the guest's assigned slot.
     * This lets us map the guest's WebSocket to their slot when they send MOVE_INPUT.
     *
     * Security: Only the host (slot 0) can trigger server-side unit creation via JOIN_ACK.
     * A guest sending a fake JOIN_ACK is rejected.
     *
     * We observe the JOIN_ACK broadcast to learn {guestId -> slot} without modifying
     * the Phase 1 join flow.
     * @private
     */
    _onJoinAck(channelName, payload, client) {
        if (!payload.accepted || payload.assignedSlot == null) return;

        // Security: Only accept JOIN_ACK from the authenticated host (slot 0).
        // Without this gate, any client could send a fake JOIN_ACK to spawn
        // phantom units at arbitrary slots.
        const auth = this._clientSlots.get(client.id);
        if (!auth || auth.slot !== 0) {
            console.warn(`[GameServer] JOIN_ACK rejected: client ${client.id} is not host`);
            return;
        }

        const roomId = this._extractRoomId(channelName);
        if (!roomId) return;

        const room = this.rooms.get(roomId);
        if (!room) return;

        // Validate assignedSlot is within bounds
        const guestSlot = payload.assignedSlot;
        if (typeof guestSlot !== 'number' || guestSlot < 1 || guestSlot > this._maxSlot) {
            console.warn(`[GameServer] JOIN_ACK rejected: invalid slot ${guestSlot}`);
            return;
        }

        // Note: we can't map the GUEST's client.id here because this broadcast
        // comes from the HOST's WebSocket. We'll map the guest when they send
        // their first MOVE_INPUT (see _onMoveInput fallback).
        // For now, create a guest unit on the server so it appears in snapshots.
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
     * Handle PATH_DATA: validate waypoints and route to room for server-side path-follow.
     * Phase 2B: Client sends A* waypoints, server validates and executes kinematic movement.
     *
     * Validation:
     *   - unitId must be a number
     *   - waypoints must be array, 1..MAX_WAYPOINTS entries
     *   - Each waypoint must have finite numeric x, y, z
     *   - Consecutive segment distance must be <= MAX_SEGMENT_LENGTH
     *   - If closed, last→first segment also checked
     *   - Ownership: unit.ownerSlot must match sender's slot
     *
     * @private
     */
    _onPathData(channelName, payload, client) {
        const roomId = this._extractRoomId(channelName);
        if (!roomId) return;

        const room = this.rooms.get(roomId);
        if (!room || room.state !== 'RUNNING') return;

        // Auth: transport-authenticated identity
        let auth = this._clientSlots.get(client.id);
        if (!auth) return;

        // Validate unitId
        const unitId = payload.unitId;
        if (typeof unitId !== 'number') return;

        // Validate waypoints array
        const waypoints = payload.waypoints;
        if (!Array.isArray(waypoints)) return;
        if (waypoints.length === 0 || waypoints.length > MAX_WAYPOINTS) return;

        // Validate each waypoint + segment distances
        const validated = [];
        let prevWp = null;
        for (const wp of waypoints) {
            if (typeof wp.x !== 'number' || typeof wp.y !== 'number' || typeof wp.z !== 'number') return;
            if (!isFinite(wp.x) || !isFinite(wp.y) || !isFinite(wp.z)) return;

            const point = { x: wp.x, y: wp.y, z: wp.z };

            if (prevWp) {
                const segDist = Vec3.length(Vec3.sub(point, prevWp));
                if (segDist > MAX_SEGMENT_LENGTH) return;
            }

            validated.push(point);
            prevWp = point;
        }

        // Closed loop: check last→first segment
        const closed = !!payload.closed;
        if (closed && validated.length > 1) {
            const segDist = Vec3.length(Vec3.sub(validated[0], validated[validated.length - 1]));
            if (segDist > MAX_SEGMENT_LENGTH) return;
        }

        // Route to room as command (ownership check happens in Room._onSimTick)
        room.receiveInput(auth.slot, {
            type: 'PATH_DATA',
            unitId,
            waypoints: validated,
            closed
        });
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
     * Check if client is allowed to use dev/admin commands.
     * Requires enablePhysics flag AND host-only (slot 0).
     * @private
     * @param {Object} client
     * @returns {boolean}
     */
    _assertDevAllowed(client) {
        if (!this._enablePhysics) {
            console.log(`[GameServer] CMD_ADMIN rejected: enablePhysics=${this._enablePhysics}`);
            return false;
        }
        const auth = this._clientSlots.get(client.id);
        if (!auth || auth.slot !== 0) {
            console.log(`[GameServer] CMD_ADMIN rejected: client=${client.id} auth=${!!auth} slot=${auth?.slot}`);
            return false;
        }
        return true;
    }

    /**
     * Unified handler for CMD_ADMIN messages (ADR-003).
     * Dispatches to action-specific logic after dev gate check.
     * @private
     */
    _onAdminCommand(channelName, payload, client) {
        console.log(`[GameServer] CMD_ADMIN received: action=${payload.action} unitId=${payload.unitId} client=${client.id} channel=${channelName}`);
        if (!this._assertDevAllowed(client)) return;
        const roomId = this._extractRoomId(channelName);
        if (!roomId) { console.log(`[GameServer] CMD_ADMIN: no roomId from channel "${channelName}"`); return; }
        const room = this.rooms.get(roomId);
        if (!room) { console.log(`[GameServer] CMD_ADMIN: room "${roomId}" not found. rooms: [${[...this.rooms.keys()]}]`); return; }
        if (room.state !== 'RUNNING') { console.log(`[GameServer] CMD_ADMIN: room "${roomId}" state=${room.state}`); return; }

        try {
            switch (payload.action) {
                case 'TRIGGER_EXPLOSION': {
                    const unitId = typeof payload.unitId === 'string' ? parseInt(payload.unitId, 10) : payload.unitId;
                    if (typeof unitId !== 'number' || isNaN(unitId)) { console.log(`[GameServer] TRIGGER_EXPLOSION: invalid unitId=${payload.unitId} (${typeof payload.unitId})`); return; }
                    const radius = typeof payload.radius === 'number' && isFinite(payload.radius) ? payload.radius : 8;
                    const strength = typeof payload.strength === 'number' && isFinite(payload.strength) ? payload.strength : 6;
                    room._devTriggerExplosion(unitId, radius, strength, payload);
                    break;
                }
                case 'PLACE_MINE': {
                    const unitId = payload.unitId;
                    if (typeof unitId !== 'number') return;
                    const unit = room.units.find(u => u && u.id === unitId);
                    if (!unit) return;
                    room._syncClientPos(unit, payload);
                    room.addMine({ x: unit.position.x, y: unit.position.y, z: unit.position.z });
                    break;
                }
                case 'SPAWN_ROCK': {
                    const unitId = payload.unitId;
                    if (typeof unitId !== 'number') return;
                    const unit = room.units.find(u => u && u.id === unitId);
                    if (!unit) return;
                    room._syncClientPos(unit, payload);
                    const heading = unit.heading || 0;
                    const offset = 2.0;
                    const pos = {
                        x: unit.position.x + Math.sin(heading) * offset,
                        y: unit.position.y,
                        z: unit.position.z + Math.cos(heading) * offset
                    };
                    room.addObstacle(pos, 0.8);
                    break;
                }
                case 'TOGGLE_UNIT_PHYSICS': {
                    const unitId = payload.unitId;
                    if (typeof unitId !== 'number') return;
                    room.toggleUnitPhysics(unitId);
                    break;
                }
                case 'DROP_TEST': {
                    const unitId = payload.unitId;
                    if (typeof unitId !== 'number') return;
                    room._devDropTest(unitId, payload);
                    break;
                }
                case 'SET_ALTITUDE': {
                    const unitId = payload.unitId;
                    if (typeof unitId !== 'number') return;
                    const alt = typeof payload.altitude === 'number' ? payload.altitude : 0;
                    room._devSetAltitude(unitId, alt, payload);
                    break;
                }
                case 'TOGGLE_RAPIER': {
                    const unitId = payload.unitId;
                    if (typeof unitId !== 'number') return;
                    room._devToggleRapier(unitId, !!payload.enable, payload);
                    break;
                }
                case 'SET_ROLLOVER_THRESHOLD': {
                    const degrees = payload.degrees;
                    if (typeof degrees !== 'number' || !isFinite(degrees)) return;
                    const clamped = Math.max(5, Math.min(90, degrees));
                    room.setRolloverThreshold(clamped);
                    console.log(`[GameServer] Rollover threshold set to ${clamped}°`);
                    break;
                }
                default:
                    break;
            }
        } catch (err) {
            console.error(`[GameServer] CMD_ADMIN error:`, err.message);
        }
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
