/**
 * CommandQueue - Deterministic Command Buffer
 *
 * R006: Buffers input commands for processing during simTick.
 * Commands are stamped with tick number and processed in order.
 *
 * Usage:
 *   import { CommandQueue, globalCommandQueue } from './CommandQueue.js';
 *   globalCommandQueue.enqueue({ type: 'SELECT', unitId: 1 });
 *   const commands = globalCommandQueue.flush(currentTick);
 */

import { nextEntityId } from './IdGenerator.js';

/**
 * Command types produced by InputFactory.
 */
export const CommandType = {
    SELECT: 'SELECT',
    DESELECT: 'DESELECT',
    MOVE: 'MOVE',
    SET_PATH: 'SET_PATH',
    CLOSE_PATH: 'CLOSE_PATH'
};

/**
 * CommandQueue buffers input commands for deterministic processing.
 */
export class CommandQueue {
    constructor() {
        this._pending = [];
        this._history = [];
        this._seqCounter = 0;
        this._maxHistory = 100;
    }

    /**
     * Enqueue a command for processing.
     * @param {Object} command - Command object with type and payload
     * @param {number} [scheduledTick] - Tick to execute (default: next tick)
     * @returns {Object} The stamped command
     */
    enqueue(command, scheduledTick = null) {
        const stamped = {
            ...command,
            id: 'icmd_' + nextEntityId(),
            seq: this._seqCounter++,
            enqueuedAt: this._seqCounter, // For ordering
            scheduledTick: scheduledTick  // null = immediate (next flush)
        };

        this._pending.push(stamped);
        return stamped;
    }

    /**
     * Flush commands ready for the given tick.
     * @param {number} currentTick - Current simulation tick
     * @returns {Object[]} Commands to process this tick
     */
    flush(currentTick) {
        // Get commands scheduled for this tick or earlier, or immediate (null)
        const ready = this._pending.filter(cmd =>
            cmd.scheduledTick === null || cmd.scheduledTick <= currentTick
        );

        // Remove from pending
        this._pending = this._pending.filter(cmd =>
            cmd.scheduledTick !== null && cmd.scheduledTick > currentTick
        );

        // Sort by sequence for determinism
        ready.sort((a, b) => a.seq - b.seq);

        // Add to history
        for (const cmd of ready) {
            cmd.processedAtTick = currentTick;
            this._history.push(cmd);
        }

        // Trim history
        while (this._history.length > this._maxHistory) {
            this._history.shift();
        }

        return ready;
    }

    /**
     * Get pending command count.
     */
    get pendingCount() {
        return this._pending.length;
    }

    /**
     * Get history count.
     */
    get historyCount() {
        return this._history.length;
    }

    /**
     * Get recent history for debug overlay.
     * @param {number} [count=10] - Number of recent commands
     * @returns {Object[]} Recent commands (newest first)
     */
    getRecentHistory(count = 10) {
        return this._history.slice(-count).reverse();
    }

    /**
     * Get pending commands for debug overlay.
     * @returns {Object[]} Pending commands
     */
    getPending() {
        return [...this._pending];
    }

    /**
     * Reset the queue (for testing/replay).
     */
    reset() {
        this._pending = [];
        this._history = [];
        this._seqCounter = 0;
    }
}

/**
 * Global command queue singleton.
 */
export const globalCommandQueue = new CommandQueue();
