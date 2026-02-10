/**
 * TimeSource - Simulation Time Manager for SimCore
 * @environment isomorphic
 *
 * Engine-agnostic time management with pause, speed control, and deterministic ticks.
 * No Three.js or rendering dependencies allowed here.
 *
 * PURITY AUDIT (2026-02-10):
 *   - Replaced bare `performance.now()` with `_perfNow()` abstraction that
 *     falls back to `Date.now()` when the Performance API is unavailable
 *     (older Node.js without globalThis.performance).
 *
 * @example
 * const time = new TimeSource();
 * time.setTimeScale(2); // 2x speed
 * time.tick(16.67); // Real milliseconds since last frame
 * console.log(time.now()); // Simulation time (affected by scale)
 */

/**
 * Isomorphic high-resolution timer.
 * Uses `performance.now()` when available (browser, Node 16+),
 * falls back to `Date.now()` otherwise.
 * @returns {number} milliseconds
 */
const _perfNow = (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? () => performance.now()
    : () => Date.now();

export class TimeSource {
    constructor() {
        /** @type {number} Accumulated simulation time in milliseconds */
        this._simulatedTime = 0;

        /** @type {number} Speed multiplier (0 = paused, 1 = normal, 2 = 2x speed) */
        this._timeScale = 1.0;

        /** @type {number} Delta time from last tick (in seconds, for convenience) */
        this._deltaTime = 0;

        /** @type {number} Delta time in milliseconds */
        this._deltaTimeMs = 0;

        /** @type {number} Total tick count since start */
        this._tickCount = 0;

        /** @type {number} Real wall-clock time at start */
        this._realStartTime = _perfNow();

        /** @type {number} Last real time we recorded */
        this._lastRealTime = this._realStartTime;

        /** @type {boolean} Paused state */
        this._paused = false;

        /** @type {number} Max delta time cap to prevent spiral of death (ms) */
        this.maxDeltaTime = 100; // 100ms = 10 FPS minimum
    }

    /**
     * Advance simulation time by real elapsed time
     * This should be called once per frame from the game loop.
     * 
     * @param {number} realDeltaMs - Real milliseconds since last tick
     */
    tick(realDeltaMs) {
        // Cap delta time to prevent physics explosions after tab-away
        const cappedDelta = Math.min(realDeltaMs, this.maxDeltaTime);
        
        // Calculate simulation delta (affected by pause and time scale)
        const simDeltaMs = this._paused ? 0 : cappedDelta * this._timeScale;
        
        this._deltaTimeMs = simDeltaMs;
        this._deltaTime = simDeltaMs / 1000; // Convert to seconds
        this._simulatedTime += simDeltaMs;
        this._tickCount++;
        
        this._lastRealTime = _perfNow();
    }

    /**
     * Get current simulation time in milliseconds
     * @returns {number}
     */
    now() {
        return this._simulatedTime;
    }

    /**
     * Get current simulation time in seconds
     * @returns {number}
     */
    nowSeconds() {
        return this._simulatedTime / 1000;
    }

    /**
     * Get delta time since last tick (in seconds)
     * @returns {number}
     */
    get deltaTime() {
        return this._deltaTime;
    }

    /**
     * Get delta time since last tick (in milliseconds)
     * @returns {number}
     */
    get deltaTimeMs() {
        return this._deltaTimeMs;
    }

    /**
     * Get current time scale
     * @returns {number}
     */
    get timeScale() {
        return this._timeScale;
    }

    /**
     * Set time scale (speed multiplier)
     * @param {number} scale - 0 = paused, 1 = normal, 2 = 2x speed, etc.
     */
    setTimeScale(scale) {
        this._timeScale = Math.max(0, scale);
    }

    /**
     * Check if simulation is paused
     * @returns {boolean}
     */
    get paused() {
        return this._paused;
    }

    /**
     * Pause the simulation
     */
    pause() {
        this._paused = true;
    }

    /**
     * Resume the simulation
     */
    resume() {
        this._paused = false;
    }

    /**
     * Toggle pause state
     * @returns {boolean} New paused state
     */
    togglePause() {
        this._paused = !this._paused;
        return this._paused;
    }

    /**
     * Get total tick count
     * @returns {number}
     */
    get tickCount() {
        return this._tickCount;
    }

    /**
     * Get real wall-clock time elapsed since start (ms)
     * @returns {number}
     */
    getRealElapsedTime() {
        return _perfNow() - this._realStartTime;
    }

    /**
     * Reset simulation time to zero
     */
    reset() {
        this._simulatedTime = 0;
        this._tickCount = 0;
        this._deltaTime = 0;
        this._deltaTimeMs = 0;
        this._realStartTime = _perfNow();
        this._lastRealTime = this._realStartTime;
    }

    /**
     * Get state snapshot for serialization
     * @returns {Object}
     */
    getSnapshot() {
        return {
            simulatedTime: this._simulatedTime,
            tickCount: this._tickCount,
            timeScale: this._timeScale,
            paused: this._paused
        };
    }

    /**
     * Load state from snapshot
     * @param {Object} snapshot 
     */
    loadSnapshot(snapshot) {
        if (snapshot.simulatedTime !== undefined) {
            this._simulatedTime = snapshot.simulatedTime;
        }
        if (snapshot.tickCount !== undefined) {
            this._tickCount = snapshot.tickCount;
        }
        if (snapshot.timeScale !== undefined) {
            this._timeScale = snapshot.timeScale;
        }
        if (snapshot.paused !== undefined) {
            this._paused = snapshot.paused;
        }
    }
}

// Singleton instance for global use
export const globalTimeSource = new TimeSource();
