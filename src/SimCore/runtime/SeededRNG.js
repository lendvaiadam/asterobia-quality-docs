/**
 * SeededRNG - Deterministic pseudo-random number generator for SimCore.
 *
 * R004: All authoritative random values must come from this seeded PRNG.
 * Math.random() is only allowed for visuals/particles.
 *
 * Algorithm: Mulberry32 (fast, good distribution, 32-bit state)
 * Reference: https://github.com/bryc/code/blob/master/jshash/PRNGs.md
 *
 * Usage:
 *   import { createRNG, globalRNG, resetGlobalRNG } from './SeededRNG.js';
 *
 *   // Create instance with specific seed
 *   const rng = createRNG(12345);
 *   rng.next();      // 0.0 - 1.0
 *   rng.nextInt(10); // 0 - 9
 *
 *   // Use global singleton (for SimCore)
 *   resetGlobalRNG(12345);
 *   globalRNG.next();
 */

/**
 * Mulberry32 PRNG - Fast 32-bit generator with good statistical properties.
 */
export class SeededRNG {
    /**
     * @param {number} seed - Initial seed (any integer)
     */
    constructor(seed = 0) {
        this._seed = seed >>> 0; // Ensure 32-bit unsigned
        this._state = this._seed;
        this._callCount = 0;
    }

    /**
     * Get current seed.
     * @returns {number}
     */
    get seed() {
        return this._seed;
    }

    /**
     * Get number of calls since creation/reset.
     * @returns {number}
     */
    get callCount() {
        return this._callCount;
    }

    /**
     * Reset to initial seed state.
     */
    reset() {
        this._state = this._seed;
        this._callCount = 0;
    }

    /**
     * Reseed with new value.
     * @param {number} seed - New seed
     */
    reseed(seed) {
        this._seed = seed >>> 0;
        this._state = this._seed;
        this._callCount = 0;
    }

    /**
     * Generate next random float in [0, 1).
     * @returns {number}
     */
    next() {
        this._callCount++;
        // Mulberry32 algorithm
        // R011: Wrap state to 32-bit for correct save/load serialization
        this._state = (this._state + 0x6D2B79F5) >>> 0;
        let t = this._state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    /**
     * Generate random integer in [0, max).
     * @param {number} max - Exclusive upper bound
     * @returns {number}
     */
    nextInt(max) {
        return Math.floor(this.next() * max);
    }

    /**
     * Generate random integer in [min, max].
     * @param {number} min - Inclusive lower bound
     * @param {number} max - Inclusive upper bound
     * @returns {number}
     */
    nextIntRange(min, max) {
        return min + Math.floor(this.next() * (max - min + 1));
    }

    /**
     * Generate random float in [min, max).
     * @param {number} min - Inclusive lower bound
     * @param {number} max - Exclusive upper bound
     * @returns {number}
     */
    nextFloat(min, max) {
        return min + this.next() * (max - min);
    }

    /**
     * Generate random boolean with given probability.
     * @param {number} [probability=0.5] - Probability of true
     * @returns {boolean}
     */
    nextBool(probability = 0.5) {
        return this.next() < probability;
    }

    /**
     * Pick random element from array.
     * @template T
     * @param {T[]} array
     * @returns {T}
     */
    pick(array) {
        return array[this.nextInt(array.length)];
    }

    /**
     * Shuffle array in place (Fisher-Yates).
     * @template T
     * @param {T[]} array
     * @returns {T[]}
     */
    shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = this.nextInt(i + 1);
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    /**
     * Get current state for serialization.
     * @returns {{ seed: number, state: number, callCount: number }}
     */
    getState() {
        return {
            seed: this._seed,
            state: this._state,
            callCount: this._callCount
        };
    }

    /**
     * Restore from serialized state.
     * @param {{ seed: number, state: number, callCount: number }} state
     */
    setState(state) {
        this._seed = state.seed >>> 0;
        this._state = state.state >>> 0;
        this._callCount = state.callCount;
    }
}

/**
 * Create a new SeededRNG instance.
 * @param {number} [seed=0] - Initial seed
 * @returns {SeededRNG}
 */
export function createRNG(seed = 0) {
    return new SeededRNG(seed);
}

// ============ Global Singleton for SimCore ============

/** @type {SeededRNG} Global RNG instance for SimCore */
let _globalRNG = new SeededRNG(0);

/**
 * Get global RNG instance.
 * @returns {SeededRNG}
 */
export function getGlobalRNG() {
    return _globalRNG;
}

/**
 * Reset global RNG with new seed.
 * Call on sim reset/restart for deterministic replay.
 * @param {number} seed - New seed
 */
export function resetGlobalRNG(seed) {
    _globalRNG.reseed(seed);
}

/**
 * Shorthand: get next random float from global RNG.
 * @returns {number}
 */
export function rngNext() {
    return _globalRNG.next();
}

/**
 * Shorthand: get next random int from global RNG.
 * @param {number} max - Exclusive upper bound
 * @returns {number}
 */
export function rngNextInt(max) {
    return _globalRNG.nextInt(max);
}

// Export global instance directly for convenience
export { _globalRNG as globalRNG };
