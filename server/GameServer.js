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
}
