/**
 * Room - Represents one active match/game session on the server.
 *
 * Owns:
 *   - A SimLoop instance (fixed timestep, server-driven)
 *   - A CommandQueue for incoming player inputs
 *   - A list of connected players (slot -> endpoint mapping)
 *   - Game state: HeadlessUnit[] (pure data, no Three.js)
 *
 * Lifecycle: WAITING -> RUNNING -> ENDED
 *
 * @module server/Room
 */

import { SimLoop } from '../src/SimCore/runtime/SimLoop.js';
import { CommandQueue, CommandType } from '../src/SimCore/runtime/CommandQueue.js';
import { HeadlessUnit } from './HeadlessUnit.js';

/** @typedef {'WAITING' | 'RUNNING' | 'ENDED'} RoomState */

export class Room {
    /**
     * @param {string} roomId - Unique room identifier
     * @param {Object} [options]
     * @param {number} [options.tickMs=50] - Fixed timestep in ms (default 50ms = 20 Hz)
     * @param {number} [options.maxPlayers=10] - Maximum player slots
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
     * Create a HeadlessUnit for a player at a deterministic start position.
     *
     * @param {number} slot - Player slot
     * @param {number} unitId - Deterministic entity ID
     * @returns {HeadlessUnit}
     */
    createUnitForPlayer(slot, unitId) {
        const unit = new HeadlessUnit(unitId, slot);
        // Deterministic start position based on slot (spread on X axis)
        unit.position.x = slot * 5;
        unit.position.y = 0;
        unit.position.z = 0;
        this.units.push(unit);
        return unit;
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
        let lastMs = Date.now();

        this._tickInterval = setInterval(() => {
            const nowMs = Date.now();
            this.simLoop.step(nowMs);
            lastMs = nowMs;
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
     * Processes commands and advances unit state.
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
            if (cmd.type === 'MOVE_INPUT' && cmd.sourceSlot != null) {
                const unit = this.units.find(u => u.ownerSlot === cmd.sourceSlot);
                if (unit) {
                    unit.applyInput(cmd);
                }
            }
        }

        // 3. Update unit positions (velocity * dt)
        for (const unit of this.units) {
            if (unit.speed > 0) {
                unit.position.x += unit.velocity.x * dtSec;
                unit.position.y += unit.velocity.y * dtSec;
                unit.position.z += unit.velocity.z * dtSec;
            }
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
     * @param {number} slot - Player slot that sent the command
     * @param {Object} command - Command object (must have .type from CommandType)
     */
    receiveInput(slot, command) {
        // Tag command with source slot for authority checks
        command.sourceSlot = slot;
        this.commandQueue.enqueue(command);
    }
}
