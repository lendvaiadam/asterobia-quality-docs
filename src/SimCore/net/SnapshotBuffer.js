/**
 * SnapshotBuffer — Ring buffer for server snapshot interpolation.
 *
 * Stores SERVER_SNAPSHOT messages and provides interpolation pairs
 * for smooth client-side rendering between server ticks.
 *
 * Features:
 *   - Fixed-capacity ring buffer (default 60 = ~3 sec at 20Hz)
 *   - Smooth clock via EMA on local↔server time offset
 *   - Snap-on-start: first snapshot sets clock instantly (no EMA warmup)
 *   - Out-of-order and duplicate rejection (monotonic tick enforcement)
 *   - Per-unit teleport detection (configurable threshold)
 *   - getInterpolationPair() returns { prev, next, alpha, teleports }
 *
 * Pure logic — no Three.js, no DOM, no side effects. Fully testable.
 *
 * @module SimCore/net/SnapshotBuffer
 */

/** @typedef {{ type: string, version: number, tick: number, serverTimeMs: number, units: Array<Object> }} ServerSnapshot */

/**
 * @typedef {Object} InterpolationResult
 * @property {ServerSnapshot|null} prev - Earlier snapshot (or null if buffer empty)
 * @property {ServerSnapshot|null} next - Later snapshot (or null if buffer empty)
 * @property {number} alpha - Interpolation factor [0, 1] between prev and next
 * @property {Set<number>} teleports - Set of unit IDs that exceed teleport threshold
 */

export class SnapshotBuffer {
    /**
     * @param {Object} [options]
     * @param {number} [options.capacity=60]           - Ring buffer size (snapshots)
     * @param {number} [options.interpDelayMs=100]      - Render delay behind server time (ms)
     * @param {number} [options.teleportThreshold=10]   - Distance for snap-instead-of-lerp
     * @param {number} [options.emaAlpha=0.1]           - EMA smoothing factor for clock offset
     * @param {number} [options.maxExtrapolateMs=100]   - Max ms to extrapolate past latest snapshot
     */
    constructor(options = {}) {
        /** @type {number} Maximum snapshots to retain */
        this.capacity = options.capacity ?? 60;

        /** @type {number} Render delay behind estimated server time (ms) */
        this.interpDelayMs = options.interpDelayMs ?? 100;

        /** @type {number} Euclidean distance threshold for teleport detection */
        this.teleportThreshold = options.teleportThreshold ?? 10;

        /** @type {number} EMA smoothing factor (0 < α ≤ 1) */
        this._emaAlpha = options.emaAlpha ?? 0.1;

        /** @type {number} Maximum extrapolation beyond latest snapshot (ms) */
        this._maxExtrapolateMs = options.maxExtrapolateMs ?? 100;

        /** @type {ServerSnapshot[]} Ring buffer storage */
        this._buffer = [];

        /** @type {number} Highest tick number seen (for monotonic enforcement) */
        this._highestTick = -1;

        /** @type {number} Smoothed local-to-server time offset (ms) */
        this._smoothedOffset = 0;

        /** @type {boolean} True until the first snapshot is pushed */
        this._firstSnapshot = true;

        /** @type {number} Total snapshots pushed (including rejected) */
        this._pushCount = 0;

        /** @type {number} Rejected snapshot count (out-of-order / duplicate) */
        this._rejectedCount = 0;

        // Diagnostics
        /** @type {number} Underflow count (render time past all snapshots) */
        this._underflowCount = 0;

        /** @type {number[]} Recent snapshot arrival intervals (ms), last N */
        this._arrivalIntervals = [];

        /** @type {number} Local time of last push (for interval tracking) */
        this._lastPushLocalMs = 0;

        /** @type {number} Max arrival intervals to track */
        this._maxIntervalSamples = 60;
    }

    /**
     * Push a SERVER_SNAPSHOT into the buffer.
     *
     * Rejects snapshots with tick ≤ highestTick (out-of-order or duplicate).
     * Updates the smooth clock offset via EMA (or snap on first push).
     *
     * @param {ServerSnapshot} snapshot - Must have .tick (number) and .serverTimeMs (number)
     * @param {number} [localNowMs] - Local timestamp override (for deterministic testing)
     * @returns {boolean} True if accepted, false if rejected
     */
    push(snapshot, localNowMs) {
        this._pushCount++;
        const now = localNowMs ?? Date.now();

        // Monotonic tick enforcement: reject out-of-order and duplicates
        if (snapshot.tick <= this._highestTick) {
            this._rejectedCount++;
            return false;
        }

        this._highestTick = snapshot.tick;

        // Clock synchronization: compute local-to-server offset
        const rawOffset = now - snapshot.serverTimeMs;

        if (this._firstSnapshot) {
            // Snap-on-start: set offset immediately, no EMA warmup
            this._smoothedOffset = rawOffset;
            this._firstSnapshot = false;
        } else {
            // EMA smoothing: smoothedOffset += α * (rawOffset - smoothedOffset)
            this._smoothedOffset += this._emaAlpha * (rawOffset - this._smoothedOffset);
        }

        // Track arrival intervals for diagnostics
        if (this._lastPushLocalMs > 0) {
            const interval = now - this._lastPushLocalMs;
            this._arrivalIntervals.push(interval);
            if (this._arrivalIntervals.length > this._maxIntervalSamples) {
                this._arrivalIntervals.shift();
            }
        }
        this._lastPushLocalMs = now;

        // Insert into ring buffer (sorted by tick, newest at end)
        this._buffer.push(snapshot);

        // Trim to capacity
        while (this._buffer.length > this.capacity) {
            this._buffer.shift();
        }

        return true;
    }

    /**
     * Compute the render time: where the client should be rendering relative to server time.
     *
     * renderTime = localNow - smoothedOffset - interpDelay
     *
     * This places the render point ~interpDelayMs behind the estimated current server time,
     * ensuring two bracketing snapshots are usually available for interpolation.
     *
     * @param {number} [localNowMs] - Local timestamp override (for deterministic testing)
     * @returns {number} Estimated server time to render at (ms)
     */
    getRenderTimeMs(localNowMs) {
        const now = localNowMs ?? Date.now();
        return now - this._smoothedOffset - this.interpDelayMs;
    }

    /**
     * Get the interpolation pair for smooth rendering.
     *
     * Finds two snapshots bracketing renderTimeMs and computes alpha ∈ [0, 1].
     * Also detects per-unit teleports (position delta > threshold).
     *
     * Edge cases:
     *   - Empty buffer: returns { prev: null, next: null, alpha: 0, teleports: empty }
     *   - One snapshot: returns { prev: snap, next: snap, alpha: 0, teleports: empty }
     *   - renderTime before all snapshots: clamps to earliest pair
     *   - renderTime after all snapshots: clamps to latest snapshot (no extrapolation)
     *
     * @param {number} [localNowMs] - Local timestamp override (for deterministic testing)
     * @returns {InterpolationResult}
     */
    getInterpolationPair(localNowMs) {
        const emptyResult = { prev: null, next: null, alpha: 0, teleports: new Set() };

        if (this._buffer.length === 0) {
            return emptyResult;
        }

        if (this._buffer.length === 1) {
            return { prev: this._buffer[0], next: this._buffer[0], alpha: 0, teleports: new Set() };
        }

        const renderTime = this.getRenderTimeMs(localNowMs);

        // Find the bracketing pair: prev.serverTimeMs ≤ renderTime < next.serverTimeMs
        let prevIdx = 0;
        let nextIdx = 1;

        for (let i = 0; i < this._buffer.length - 1; i++) {
            if (this._buffer[i + 1].serverTimeMs <= renderTime) {
                prevIdx = i + 1;
                nextIdx = i + 2;
            } else {
                break;
            }
        }

        // Clamp indices
        if (nextIdx >= this._buffer.length) {
            // renderTime is past all snapshots — bounded extrapolation
            this._underflowCount++;

            if (this._buffer.length >= 2) {
                // Extrapolate using the last two snapshots, bounded by maxExtrapolateMs
                const prev = this._buffer[this._buffer.length - 2];
                const next = this._buffer[this._buffer.length - 1];
                const span = next.serverTimeMs - prev.serverTimeMs;

                if (span > 0) {
                    const overshoot = renderTime - next.serverTimeMs;
                    const clampedOvershoot = Math.min(overshoot, this._maxExtrapolateMs);
                    const alpha = Math.min(2.0, 1.0 + clampedOvershoot / span);
                    const teleports = this._detectTeleports(prev, next);
                    return { prev, next, alpha, teleports };
                }
            }

            // Fallback: hold at latest
            const latest = this._buffer[this._buffer.length - 1];
            return { prev: latest, next: latest, alpha: 0, teleports: new Set() };
        }

        const prev = this._buffer[prevIdx];
        const next = this._buffer[nextIdx];

        // Compute alpha: how far between prev and next
        const span = next.serverTimeMs - prev.serverTimeMs;
        let alpha = 0;
        if (span > 0) {
            alpha = Math.max(0, Math.min(1, (renderTime - prev.serverTimeMs) / span));
        }

        // Detect teleports per unit
        const teleports = this._detectTeleports(prev, next);

        return { prev, next, alpha, teleports };
    }

    /**
     * Detect which units exceed the teleport threshold between two snapshots.
     *
     * @param {ServerSnapshot} prev
     * @param {ServerSnapshot} next
     * @returns {Set<number>} Set of unit IDs that should snap instead of lerp
     * @private
     */
    _detectTeleports(prev, next) {
        const teleports = new Set();
        const thresholdSq = this.teleportThreshold * this.teleportThreshold;

        // Build lookup for prev units by ID
        const prevMap = new Map();
        for (const u of prev.units) {
            prevMap.set(u.id, u);
        }

        for (const nextUnit of next.units) {
            const prevUnit = prevMap.get(nextUnit.id);
            if (!prevUnit) continue; // New unit — not a teleport, just appeared

            const dx = nextUnit.px - prevUnit.px;
            const dy = nextUnit.py - prevUnit.py;
            const dz = nextUnit.pz - prevUnit.pz;
            const distSq = dx * dx + dy * dy + dz * dz;

            if (distSq > thresholdSq) {
                teleports.add(nextUnit.id);
            }
        }

        return teleports;
    }

    // ========================================
    // Diagnostics / accessors
    // ========================================

    /** @returns {number} Number of snapshots currently in the buffer */
    get size() {
        return this._buffer.length;
    }

    /** @returns {number} Highest tick number accepted */
    get highestTick() {
        return this._highestTick;
    }

    /** @returns {number} Current smoothed clock offset (ms) */
    get smoothedOffset() {
        return this._smoothedOffset;
    }

    /** @returns {boolean} Whether the buffer has received at least one snapshot */
    get initialized() {
        return !this._firstSnapshot;
    }

    /** @returns {number} Total push() calls */
    get pushCount() {
        return this._pushCount;
    }

    /** @returns {number} Rejected (out-of-order/duplicate) count */
    get rejectedCount() {
        return this._rejectedCount;
    }

    /** @returns {ServerSnapshot|null} Latest snapshot in buffer */
    get latest() {
        return this._buffer.length > 0 ? this._buffer[this._buffer.length - 1] : null;
    }

    /** @returns {number} Underflow count (render time past all snapshots) */
    get underflowCount() {
        return this._underflowCount;
    }

    /**
     * Get snapshot arrival interval statistics.
     * @returns {{ min: number, avg: number, max: number, count: number }}
     */
    getArrivalStats() {
        const intervals = this._arrivalIntervals;
        if (intervals.length === 0) {
            return { min: 0, avg: 0, max: 0, count: 0 };
        }
        let min = Infinity, max = -Infinity, sum = 0;
        for (const v of intervals) {
            if (v < min) min = v;
            if (v > max) max = v;
            sum += v;
        }
        return {
            min: Math.round(min),
            avg: Math.round(sum / intervals.length),
            max: Math.round(max),
            count: intervals.length
        };
    }

    /**
     * Reset the buffer to initial state. Used for reconnect or mode change.
     */
    reset() {
        this._buffer = [];
        this._highestTick = -1;
        this._smoothedOffset = 0;
        this._firstSnapshot = true;
        this._pushCount = 0;
        this._rejectedCount = 0;
        this._underflowCount = 0;
        this._arrivalIntervals = [];
        this._lastPushLocalMs = 0;
    }
}
