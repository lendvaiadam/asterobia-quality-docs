/**
 * SimCore Transport Module
 *
 * R007: Transport layer abstraction for command delivery.
 * All player input commands flow through transport to reach the simulation.
 *
 * Exports:
 * - TransportBase, TransportState - Base class and state enum
 * - LocalTransport, globalLocalTransport - Synchronous loopback implementation
 * - SupabaseTransport - R012: Supabase Realtime broadcast transport
 * - MemoryTransportHub, MemoryTransportEndpoint - R013: In-memory transport for testing
 * - initializeTransport, getGlobalTransport - Setup and access functions
 */

export { TransportBase, TransportState } from './ITransport.js';
export { LocalTransport, globalLocalTransport } from './LocalTransport.js';
export { SupabaseTransport } from './SupabaseTransport.js';
export { MemoryTransportHub, MemoryTransportEndpoint } from './MemoryTransport.js';

import { globalLocalTransport } from './LocalTransport.js';
import { globalCommandQueue } from '../runtime/CommandQueue.js';

/**
 * The active global transport instance.
 * @type {TransportBase}
 */
let _globalTransport = null;

/**
 * Get the current global transport.
 * @returns {TransportBase}
 */
export function getGlobalTransport() {
    return _globalTransport;
}

/**
 * Initialize the global transport and wire it to the command queue.
 *
 * CRITICAL: This is the ONLY approved path for commands to enter the simulation.
 * The transport's onReceive callback enqueues commands into the CommandQueue.
 *
 * @param {TransportBase} [transport] - Transport to use (default: globalLocalTransport)
 * @returns {TransportBase} The initialized transport
 */
export function initializeTransport(transport = null) {
    // Use provided transport or default to local
    _globalTransport = transport || globalLocalTransport;

    // Wire transport to command queue
    // This is the SINGLE POINT where commands enter the authoritative simulation
    _globalTransport.onReceive = (command) => {
        globalCommandQueue.enqueue(command);
    };

    // Connect the transport
    _globalTransport.connect();

    return _globalTransport;
}

/**
 * Disconnect and reset the global transport.
 * Useful for testing or switching transport implementations.
 */
export function disconnectTransport() {
    if (_globalTransport) {
        _globalTransport.disconnect();
        _globalTransport.onReceive = null;
        _globalTransport = null;
    }
}
