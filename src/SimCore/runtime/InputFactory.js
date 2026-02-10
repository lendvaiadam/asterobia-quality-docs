/**
 * InputFactory - DOM Event to Command Translator
 *
 * R006: Converts DOM input events into deterministic Command structs.
 * R007: Commands are sent through Transport layer (not directly to queue).
 *
 * No time-based or random values - pure input translation.
 *
 * Commands produced:
 * - SELECT: { type: 'SELECT', unitId }
 * - DESELECT: { type: 'DESELECT' }
 * - MOVE: { type: 'MOVE', unitId, position: {x,y,z} }
 * - SET_PATH: { type: 'SET_PATH', unitId, points: [{x,y,z}...] }
 * - CLOSE_PATH: { type: 'CLOSE_PATH', unitId }
 *
 * Architecture (R007):
 *   DOM Event → InputFactory.select/move/etc → Transport.send → CommandQueue
 *
 * Usage:
 *   import { InputFactory } from './InputFactory.js';
 *   import { initializeTransport } from '../transport/index.js';
 *   const transport = initializeTransport();
 *   const factory = new InputFactory(transport);
 *   factory.select(unitId);  // Sends SELECT command through transport
 */

import { CommandType, globalCommandQueue } from './CommandQueue.js';
import { getGlobalTransport } from '../transport/index.js';

/**
 * InputFactory converts user input into deterministic commands.
 * R007: Uses transport layer for command delivery.
 */
export class InputFactory {
    /**
     * @param {TransportBase} [transport] - Transport to use (default: global transport)
     */
    constructor(transport = null) {
        this._transport = transport;
    }

    /**
     * Get the transport, falling back to global if not set.
     * @returns {TransportBase}
     * @private
     */
    _getTransport() {
        return this._transport || getGlobalTransport();
    }

    /**
     * Send a command through the transport.
     * R013 M07: SELECT and DESELECT are UI-only (per-client visual state).
     * They bypass transport and enqueue directly to local CommandQueue.
     * @param {Object} command - Command to send
     * @returns {Object} The command that was sent
     * @private
     */
    _send(command) {
        // R013 M07: UI-only commands (SELECT/DESELECT) are per-client visual state.
        // They apply locally immediately - no network round-trip needed.
        if (command.type === CommandType.SELECT || command.type === CommandType.DESELECT) {
            globalCommandQueue.enqueue(command);
            return command;
        }

        // All other commands: go through transport for network sync
        const transport = this._getTransport();
        if (!transport) {
            console.error('[InputFactory] No transport available. Call initializeTransport() first.');
            return command;
        }
        transport.send(command);
        return command;
    }

    /**
     * Create a SELECT command.
     * @param {number|string} unitId - Unit to select
     * @param {Object} [options] - Additional options
     * @param {boolean} [options.skipCamera] - Skip camera movement
     * @returns {Object} The created command
     */
    select(unitId, options = {}) {
        return this._send({
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
        return this._send({
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
        return this._send({
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
        return this._send({
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
        return this._send({
            type: CommandType.CLOSE_PATH,
            unitId: unitId
        });
    }

    /**
     * Get the underlying transport.
     * @returns {TransportBase}
     */
    get transport() {
        return this._getTransport();
    }
}

/**
 * Global InputFactory singleton.
 * R007: Uses global transport (must call initializeTransport() before use).
 */
export const globalInputFactory = new InputFactory();
