/**
 * Room - Represents one active match/game session on the server.
 *
 * Owns:
 *   - A SimLoop instance (fixed timestep, server-driven)
 *   - A CommandQueue for incoming player inputs
 *   - A list of connected players (slot -> endpoint mapping)
 *   - Game state: HeadlessUnit[] (pure data, no Three.js)
 *   - A ServerTerrain instance (same procedural sphere as client)
 *
 * Units spawn ON the terrain surface and move tangentially.
 *
 * Lifecycle: WAITING -> RUNNING -> ENDED
 *   WAITING: Room created, no units yet. Waits for SPAWN_MANIFEST.
 *   RUNNING: Manifest received, units exist, ticking at 20Hz.
 *   ENDED:   Stopped, cleaned up.
 *
 * @module server/Room
 */

import { SimLoop } from '../src/SimCore/runtime/SimLoop.js';
import { CommandQueue, CommandType } from '../src/SimCore/runtime/CommandQueue.js';
import { HeadlessUnit } from './HeadlessUnit.js';
import { ServerTerrain } from './ServerTerrain.js';

/** @typedef {'WAITING' | 'RUNNING' | 'ENDED'} RoomState */

export class Room {
    /**
     * @param {string} roomId - Unique room identifier
     * @param {Object} [options]
     * @param {number} [options.tickMs=50] - Fixed timestep in ms (default 50ms = 20 Hz)
     * @param {number} [options.maxPlayers=10] - Maximum player slots
     * @param {Object} [options.terrainParams] - Terrain parameters (passed to ServerTerrain)
     * @param {Function} [options.broadcast] - Callback for broadcasting snapshots
     */
    constructor(roomId, options = {}) {
        /** @type {string} */
        this.roomId = roomId;

        /** @type {SimLoop} Fixed-timestep simulation loop */
        this.simLoop = new SimLoop({ fixedDtMs: options.tickMs || 50 });

        /** @type {CommandQueue} Deterministic command buffer */
        this.commandQueue = new CommandQueue();

        /** @type {Map<number, { id: string, name: string, endpoint: any }>} slot -> player info */
        this.players = new Map();

        /** @type {HeadlessUnit[]} All units in the room (pure data) */
        this.units = [];

        /** @type {RoomState} Current room lifecycle state */
        this.state = 'WAITING';

        /** @type {number} Maximum player count */
        this.maxPlayers = options.maxPlayers || 10;

        /** @type {number} Next slot to assign */
        this._nextSlot = 1;

        /** @type {Function|null} Optional broadcast callback for sending snapshots */
        this._broadcastFn = options.broadcast || null;

        /** @type {ReturnType<typeof setInterval>|null} Server tick interval handle */
        this._tickInterval = null;

        /** @type {ServerTerrain} Authoritative terrain (same math as client) */
        this.terrain = new ServerTerrain(options.terrainParams);
    }

    /**
     * Add a player to the room and assign a slot.
     *
     * @param {string} playerId - Unique player identifier
     * @param {string} name - Display name
     * @param {*} endpoint - Transport endpoint (WebSocket, MemoryTransport, etc.)
     * @returns {number} Assigned slot number
     * @throws {Error} If room is full
     */
    addPlayer(playerId, name, endpoint) {
        if (this.players.size >= this.maxPlayers) {
            throw new Error(`Room ${this.roomId} is full (${this.maxPlayers} max)`);
        }

        const slot = this._nextSlot++;
        this.players.set(slot, { id: playerId, name, endpoint });
        return slot;
    }

    /**
     * Create a HeadlessUnit for a player, spawned ON the terrain surface.
     *
     * Units are distributed around the equator, spaced by slot index.
     * Each unit spawns at the terrain surface height for its direction.
     *
     * @param {number} slot - Player slot
     * @param {number} unitId - Deterministic entity ID
     * @param {Object} [options]
     * @param {number} [options.modelIndex=0] - Client model index for rendering
     * @returns {HeadlessUnit}
     */
    createUnitForPlayer(slot, unitId, options = {}) {
        const unit = new HeadlessUnit(unitId, slot, { modelIndex: options.modelIndex ?? 0 });

        // Distribute spawn positions around the equator
        const angle = slot * (Math.PI * 2 / this.maxPlayers);
        const direction = { x: Math.sin(angle), y: 0, z: Math.cos(angle) };

        unit.spawnOnSurface(direction, this.terrain);
        this.units.push(unit);
        return unit;
    }

    /**
     * Create units from a SPAWN_MANIFEST sent by the host client.
     * Uses client-provided IDs and positions — this guarantees 1:1 mapping.
     *
     * @param {Array<{id: number, ownerSlot: number, modelIndex: number, px?: number, py?: number, pz?: number}>} manifestUnits
     * @returns {HeadlessUnit[]} Created units
     */
    createUnitsFromManifest(manifestUnits) {
        const created = [];
        for (const mu of manifestUnits) {
            const unit = new HeadlessUnit(mu.id, mu.ownerSlot, { modelIndex: mu.modelIndex ?? 0 });

            // If manifest includes a position, use it as spawn direction
            if (mu.px != null && mu.py != null && mu.pz != null) {
                const dir = { x: mu.px, y: mu.py, z: mu.pz };
                unit.spawnOnSurface(dir, this.terrain);
            } else {
                // Fallback: equatorial distribution
                const idx = this.units.length;
                const angle = idx * (Math.PI * 2 / this.maxPlayers);
                const dir = { x: Math.sin(angle), y: 0, z: Math.cos(angle) };
                unit.spawnOnSurface(dir, this.terrain);
            }

            this.units.push(unit);
            created.push(unit);
        }
        return created;
    }

    /**
     * Remove a player from the room.
     *
     * @param {number} slot - Player slot to remove
     */
    removePlayer(slot) {
        this.players.delete(slot);
    }

    /**
     * Transition room to RUNNING state.
     * Wires up the SimLoop onSimTick callback.
     */
    start() {
        if (this.state !== 'WAITING') {
            throw new Error(`Cannot start room ${this.roomId} in state ${this.state}`);
        }

        this.state = 'RUNNING';

        // Wire SimLoop tick callback
        this.simLoop.onSimTick = (fixedDtSec, tickCount) => {
            this._onSimTick(fixedDtSec, tickCount);
        };

        // Server-driven tick: push time into SimLoop at fixed intervals
        const tickMs = this.simLoop.fixedDtMs;

        this._tickInterval = setInterval(() => {
            const nowMs = Date.now();
            this.simLoop.step(nowMs);
        }, tickMs);
    }

    /**
     * Transition room to ENDED state and clean up.
     */
    stop() {
        this.state = 'ENDED';

        if (this._tickInterval !== null) {
            clearInterval(this._tickInterval);
            this._tickInterval = null;
        }

        this.simLoop.onSimTick = null;
        this.simLoop.onRender = null;
    }

    /**
     * Called by SimLoop on each fixed simulation tick.
     * Processes commands and advances unit state on the spherical terrain.
     *
     * @param {number} dtSec - Fixed timestep in seconds
     * @param {number} tickCount - Current tick number
     * @private
     */
    _onSimTick(dtSec, tickCount) {
        // 1. Flush commands ready for this tick
        const commands = this.commandQueue.flush(tickCount);

        // 2. Route commands to target units
        for (const cmd of commands) {
            if (cmd.type === 'MOVE_INPUT') {
                // Route by unitId if present, else fall back to ownerSlot
                let unit = null;
                if (cmd.unitId != null) {
                    unit = this.units.find(u => u.id === cmd.unitId);
                    // Authority check: sender must own this unit
                    if (unit && cmd.sourceSlot != null && unit.ownerSlot !== cmd.sourceSlot) {
                        unit = null; // Rejected: not your unit
                    }
                } else if (cmd.sourceSlot != null) {
                    // Legacy fallback: route by ownerSlot (pre-manifest mode)
                    unit = this.units.find(u => u.ownerSlot === cmd.sourceSlot);
                }
                if (unit) {
                    unit.applyInput(cmd);
                }
            }
        }

        // 3. Update unit positions (spherical terrain movement)
        for (const unit of this.units) {
            unit.updatePosition(dtSec);
        }

        // 4. Broadcast SERVER_SNAPSHOT to all connected clients
        this._broadcastSnapshot(tickCount);
    }

    /**
     * Broadcast a SERVER_SNAPSHOT to all connected players.
     * Only runs if a broadcast function was provided.
     *
     * @param {number} tickCount - Current tick number
     * @private
     */
    _broadcastSnapshot(tickCount) {
        if (!this._broadcastFn) return;

        const snapshot = {
            type: 'SERVER_SNAPSHOT',
            version: 1,
            tick: tickCount,
            serverTimeMs: Date.now(),
            units: this.units.map(u => u.toSnapshot())
        };

        this._broadcastFn(this.roomId, snapshot);
    }

    /**
     * Get a serializable state snapshot of the room.
     * Used for state sync to clients.
     *
     * @returns {{ tick: number, units: Object[], players: [number, Object][] }}
     */
    getSnapshot() {
        return {
            tick: this.simLoop.getTickCount(),
            units: this.units.map(u => u.toSnapshot()),
            players: Array.from(this.players.entries())
        };
    }

    /**
     * Accept an input command from a client.
     * The command is buffered in the CommandQueue for deterministic processing.
     *
     * @param {number} slot - Player slot that sent the command (transport-authenticated)
     * @param {Object} command - Command object (must have .type from CommandType)
     */
    receiveInput(slot, command) {
        // Tag command with source slot for authority checks
        command.sourceSlot = slot;
        this.commandQueue.enqueue(command);
    }
}
