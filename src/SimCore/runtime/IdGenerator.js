/**
 * IdGenerator - Deterministic entity ID generation for SimCore.
 *
 * R003: All entity IDs must be deterministic integers from a per-sim counter.
 * No Date.now(), Math.random(), or crypto.randomUUID() for authority-state IDs.
 *
 * Usage:
 *   import { nextEntityId, resetEntityIdCounter } from './IdGenerator.js';
 *   const id = nextEntityId(); // Returns 1, 2, 3, ...
 *
 * For multiplayer/replay: call resetEntityIdCounter() on sim reset.
 */

/** @type {number} Current entity ID counter (per sim instance) */
let _entityIdCounter = 0;

/**
 * Get next deterministic entity ID.
 * IDs start at 1 and increment sequentially.
 * @returns {number} Unique integer ID
 */
export function nextEntityId() {
    return ++_entityIdCounter;
}

/**
 * Get current counter value without incrementing.
 * Useful for debugging/inspection.
 * @returns {number}
 */
export function peekEntityId() {
    return _entityIdCounter;
}

/**
 * Reset entity ID counter to 0.
 * Call on sim reset/restart for deterministic replay.
 */
export function resetEntityIdCounter() {
    _entityIdCounter = 0;
}

/**
 * Set entity ID counter to specific value.
 * Used for loading saved games or syncing multiplayer state.
 * @param {number} value - New counter value
 */
export function setEntityIdCounter(value) {
    if (!Number.isInteger(value) || value < 0) {
        throw new Error(`Invalid entity ID counter value: ${value}`);
    }
    _entityIdCounter = value;
}
