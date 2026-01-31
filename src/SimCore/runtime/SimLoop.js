/**
 * SimLoop - Fixed-timestep simulation loop with accumulator pattern.
 *
 * Provides deterministic simulation by running sim ticks at a fixed interval (50ms default),
 * while allowing render updates at variable frame rates with interpolation alpha.
 *
 * @example
 * const simLoop = new SimLoop();
 * simLoop.onSimTick = (fixedDtSec, tickCount) => { ... };
 * simLoop.onRender = (alpha) => { ... };
 *
 * function animate(frameMs) {
 *     simLoop.step(frameMs);
 *     requestAnimationFrame(animate);
 * }
 * requestAnimationFrame(animate);
 */
export class SimLoop {
    /**
     * @param {Object} options
     * @param {number} [options.fixedDtMs=50] - Fixed timestep in milliseconds (default 50ms = 20 ticks/sec)
     * @param {number} [options.maxFrameMs=250] - Maximum frame delta to prevent spiral of death
     */
    constructor(options = {}) {
        this.fixedDtMs = options.fixedDtMs ?? 50;
        this.fixedDtSec = this.fixedDtMs / 1000;
        this.maxFrameMs = options.maxFrameMs ?? 250;

        this.accumulatorMs = 0;
        this.tickCount = 0;
        this.lastFrameMs = 0;

        /**
         * Callback invoked for each fixed simulation tick.
         * All sim state mutations MUST happen here.
         * @type {((fixedDtSec: number, tickCount: number) => void) | null}
         */
        this.onSimTick = null;

        /**
         * Callback invoked after sim ticks, for rendering.
         * Should be read-only with respect to sim state.
         * @type {((alpha: number) => void) | null}
         */
        this.onRender = null;
    }

    /**
     * Advance the simulation loop by one frame.
     * Call this from requestAnimationFrame with performance.now().
     *
     * @param {number} frameMs - Current frame timestamp in milliseconds (performance.now())
     */
    step(frameMs) {
        // First frame initialization - just record time and return
        if (this.lastFrameMs === 0) {
            this.lastFrameMs = frameMs;
            return;
        }

        // Calculate delta, capped to prevent spiral of death
        const rawDelta = frameMs - this.lastFrameMs;
        const delta = Math.min(rawDelta, this.maxFrameMs);
        this.lastFrameMs = frameMs;

        // Accumulate time
        this.accumulatorMs += delta;

        // Run fixed-timestep simulation ticks
        while (this.accumulatorMs >= this.fixedDtMs) {
            const nextTickCount = this.tickCount + 1;

            if (this.onSimTick) {
                this.onSimTick(this.fixedDtSec, nextTickCount);
            }

            this.tickCount = nextTickCount;
            this.accumulatorMs -= this.fixedDtMs;
        }

        // Calculate interpolation alpha for rendering
        const alpha = this.accumulatorMs / this.fixedDtMs;

        if (this.onRender) {
            this.onRender(alpha);
        }
    }

    /**
     * Reset the loop state. Call when restarting simulation.
     */
    reset() {
        this.accumulatorMs = 0;
        this.tickCount = 0;
        this.lastFrameMs = 0;
    }

    /**
     * Get current tick count (number of completed simulation ticks).
     * @returns {number}
     */
    getTickCount() {
        return this.tickCount;
    }

    /**
     * Set tick count (for save/load restore).
     * R011: Required for restoring simulation state from save.
     * @param {number} tick - Tick count to restore to
     */
    setTickCount(tick) {
        this.tickCount = tick;
    }

    /**
     * Get loop state for save/load.
     * R011: Returns minimal state needed for deterministic restore.
     * @returns {{ tickCount: number, accumulatorMs: number }}
     */
    getState() {
        return {
            tickCount: this.tickCount,
            accumulatorMs: this.accumulatorMs
        };
    }

    /**
     * Set loop state from save data.
     * R011: Restores loop to saved state.
     * @param {{ tickCount: number, accumulatorMs: number }} state
     */
    setState(state) {
        this.tickCount = state.tickCount;
        this.accumulatorMs = state.accumulatorMs ?? 0;
        // Reset lastFrameMs to prevent large delta on next step()
        this.lastFrameMs = 0;
    }

    /**
     * Get simulation time in seconds (tickCount * fixedDtSec).
     * @returns {number}
     */
    getSimTimeSec() {
        return this.tickCount * this.fixedDtSec;
    }
}
