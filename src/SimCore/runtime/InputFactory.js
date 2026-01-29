/**
 * InputFactory - DOM Event to Command Translator
 *
 * R006: Converts DOM input events into deterministic Command structs.
 * No time-based or random values - pure input translation.
 *
 * Commands produced:
 * - SELECT: { type: 'SELECT', unitId }
 * - DESELECT: { type: 'DESELECT' }
 * - MOVE: { type: 'MOVE', unitId, position: {x,y,z} }
 * - SET_PATH: { type: 'SET_PATH', unitId, points: [{x,y,z}...] }
 * - CLOSE_PATH: { type: 'CLOSE_PATH', unitId }
 *
 * Usage:
 *   import { InputFactory } from './InputFactory.js';
 *   const factory = new InputFactory(commandQueue);
 *   factory.select(unitId);  // Creates and enqueues SELECT command
 */

import { CommandType, globalCommandQueue } from './CommandQueue.js';

/**
 * InputFactory converts user input into deterministic commands.
 */
export class InputFactory {
    /**
     * @param {CommandQueue} [queue] - Command queue to use (default: global)
     */
    constructor(queue = null) {
        this._queue = queue || globalCommandQueue;
    }

    /**
     * Create a SELECT command.
     * @param {number|string} unitId - Unit to select
     * @param {Object} [options] - Additional options
     * @param {boolean} [options.skipCamera] - Skip camera movement
     * @returns {Object} The created command
     */
    select(unitId, options = {}) {
        return this._queue.enqueue({
            type: CommandType.SELECT,
            unitId: unitId,
            skipCamera: options.skipCamera || false
        });
    }

    /**
     * Create a DESELECT command.
     * @returns {Object} The created command
     */
    deselect() {
        return this._queue.enqueue({
            type: CommandType.DESELECT
        });
    }

    /**
     * Create a MOVE command (single waypoint).
     * @param {number|string} unitId - Target unit
     * @param {{x: number, y: number, z: number}} position - Target position
     * @returns {Object} The created command
     */
    move(unitId, position) {
        return this._queue.enqueue({
            type: CommandType.MOVE,
            unitId: unitId,
            position: {
                x: position.x,
                y: position.y,
                z: position.z
            }
        });
    }

    /**
     * Create a SET_PATH command (multiple waypoints from drag).
     * @param {number|string} unitId - Target unit
     * @param {{x: number, y: number, z: number}[]} points - Path points
     * @returns {Object} The created command
     */
    setPath(unitId, points) {
        return this._queue.enqueue({
            type: CommandType.SET_PATH,
            unitId: unitId,
            points: points.map(p => ({
                x: p.x,
                y: p.y,
                z: p.z
            }))
        });
    }

    /**
     * Create a CLOSE_PATH command.
     * @param {number|string} unitId - Target unit
     * @returns {Object} The created command
     */
    closePath(unitId) {
        return this._queue.enqueue({
            type: CommandType.CLOSE_PATH,
            unitId: unitId
        });
    }

    /**
     * Get the underlying command queue.
     * @returns {CommandQueue}
     */
    get queue() {
        return this._queue;
    }
}

/**
 * Global InputFactory singleton using global command queue.
 */
export const globalInputFactory = new InputFactory();
