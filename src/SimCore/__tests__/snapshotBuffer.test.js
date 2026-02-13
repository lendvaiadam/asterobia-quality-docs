/**
 * SnapshotBuffer — Comprehensive unit tests.
 *
 * Tests cover:
 *   - Ring buffer capacity and ordering
 *   - Out-of-order and duplicate rejection
 *   - Snap-on-start clock initialization
 *   - EMA clock smoothing stability
 *   - Interpolation alpha correctness
 *   - Buffer empty / single-snapshot behavior
 *   - Teleport threshold detection
 *   - Edge cases: exact threshold, zero-span, reset
 *
 * All tests are deterministic (no Date.now() dependency — localNowMs overrides used).
 *
 * Run: npx vitest run src/SimCore/__tests__/snapshotBuffer.test.js
 */

import { describe, it, expect } from 'vitest';
import { SnapshotBuffer } from '../net/SnapshotBuffer.js';

// ========================================
// Helpers
// ========================================

/**
 * Create a minimal SERVER_SNAPSHOT for testing.
 * @param {number} tick
 * @param {number} serverTimeMs
 * @param {Array} [units] - Unit snapshot array
 */
function makeSnapshot(tick, serverTimeMs, units = []) {
    return {
        type: 'SERVER_SNAPSHOT',
        version: 1,
        tick,
        serverTimeMs,
        units
    };
}

/** Create a unit snapshot entry. */
function makeUnit(id, px = 0, py = 0, pz = 0) {
    return { id, ownerSlot: 0, px, py, pz, heading: 0, speed: 0, hp: 100 };
}

// ========================================
// 1. Ring buffer basics
// ========================================

describe('SnapshotBuffer: ring buffer', () => {
    it('starts empty', () => {
        const buf = new SnapshotBuffer();
        expect(buf.size).toBe(0);
        expect(buf.highestTick).toBe(-1);
        expect(buf.initialized).toBe(false);
        expect(buf.latest).toBeNull();
    });

    it('accepts snapshots and tracks size', () => {
        const buf = new SnapshotBuffer();
        buf.push(makeSnapshot(1, 1000), 1000);
        buf.push(makeSnapshot(2, 1050), 1050);
        buf.push(makeSnapshot(3, 1100), 1100);
        expect(buf.size).toBe(3);
        expect(buf.highestTick).toBe(3);
    });

    it('trims to capacity', () => {
        const buf = new SnapshotBuffer({ capacity: 3 });
        for (let i = 1; i <= 5; i++) {
            buf.push(makeSnapshot(i, 1000 + i * 50), 1000 + i * 50);
        }
        expect(buf.size).toBe(3);
        // Oldest should be trimmed, latest retained
        expect(buf.latest.tick).toBe(5);
    });

    it('latest returns most recent snapshot', () => {
        const buf = new SnapshotBuffer();
        buf.push(makeSnapshot(1, 1000), 1000);
        buf.push(makeSnapshot(2, 1050), 1050);
        expect(buf.latest.tick).toBe(2);
    });

    it('reset clears all state', () => {
        const buf = new SnapshotBuffer();
        buf.push(makeSnapshot(1, 1000), 1000);
        buf.push(makeSnapshot(2, 1050), 1050);
        expect(buf.size).toBe(2);
        expect(buf.initialized).toBe(true);

        buf.reset();
        expect(buf.size).toBe(0);
        expect(buf.highestTick).toBe(-1);
        expect(buf.initialized).toBe(false);
        expect(buf.pushCount).toBe(0);
        expect(buf.rejectedCount).toBe(0);
    });
});

// ========================================
// 2. Monotonic tick enforcement
// ========================================

describe('SnapshotBuffer: ordering / rejection', () => {
    it('rejects duplicate tick', () => {
        const buf = new SnapshotBuffer();
        expect(buf.push(makeSnapshot(5, 1000), 1000)).toBe(true);
        expect(buf.push(makeSnapshot(5, 1050), 1050)).toBe(false);
        expect(buf.size).toBe(1);
        expect(buf.rejectedCount).toBe(1);
    });

    it('rejects out-of-order tick (older than highest)', () => {
        const buf = new SnapshotBuffer();
        buf.push(makeSnapshot(3, 1000), 1000);
        buf.push(makeSnapshot(5, 1100), 1100);
        const accepted = buf.push(makeSnapshot(4, 1050), 1050);
        expect(accepted).toBe(false);
        expect(buf.size).toBe(2);
        expect(buf.highestTick).toBe(5);
    });

    it('accepts strictly increasing ticks', () => {
        const buf = new SnapshotBuffer();
        expect(buf.push(makeSnapshot(1, 1000), 1000)).toBe(true);
        expect(buf.push(makeSnapshot(2, 1050), 1050)).toBe(true);
        expect(buf.push(makeSnapshot(3, 1100), 1100)).toBe(true);
        expect(buf.rejectedCount).toBe(0);
    });

    it('accepts non-consecutive ticks (gaps are OK)', () => {
        const buf = new SnapshotBuffer();
        expect(buf.push(makeSnapshot(1, 1000), 1000)).toBe(true);
        expect(buf.push(makeSnapshot(10, 1500), 1500)).toBe(true);
        expect(buf.push(makeSnapshot(20, 2000), 2000)).toBe(true);
        expect(buf.size).toBe(3);
    });

    it('tracks pushCount for both accepted and rejected', () => {
        const buf = new SnapshotBuffer();
        buf.push(makeSnapshot(1, 1000), 1000);
        buf.push(makeSnapshot(1, 1050), 1050); // rejected
        buf.push(makeSnapshot(2, 1100), 1100);
        expect(buf.pushCount).toBe(3);
        expect(buf.rejectedCount).toBe(1);
    });
});

// ========================================
// 3. Snap-on-start clock initialization
// ========================================

describe('SnapshotBuffer: snap-on-start', () => {
    it('first snapshot sets smoothedOffset immediately (no EMA warmup)', () => {
        const buf = new SnapshotBuffer();
        // localNow=5000, serverTimeMs=4900 → offset = 100
        buf.push(makeSnapshot(1, 4900), 5000);
        expect(buf.smoothedOffset).toBe(100);
        expect(buf.initialized).toBe(true);
    });

    it('large initial offset is snapped instantly', () => {
        const buf = new SnapshotBuffer();
        // localNow=10000, serverTimeMs=2000 → offset = 8000
        buf.push(makeSnapshot(1, 2000), 10000);
        expect(buf.smoothedOffset).toBe(8000);
    });

    it('negative offset (server ahead of local) is handled', () => {
        const buf = new SnapshotBuffer();
        // localNow=1000, serverTimeMs=3000 → offset = -2000
        buf.push(makeSnapshot(1, 3000), 1000);
        expect(buf.smoothedOffset).toBe(-2000);
    });
});

// ========================================
// 4. EMA clock smoothing
// ========================================

describe('SnapshotBuffer: EMA smoothing', () => {
    it('second snapshot applies EMA (not snap)', () => {
        const buf = new SnapshotBuffer({ emaAlpha: 0.1 });

        // First: snap to offset = 100
        buf.push(makeSnapshot(1, 4900), 5000);
        expect(buf.smoothedOffset).toBe(100);

        // Second: raw offset = 120, EMA: 100 + 0.1 * (120 - 100) = 102
        buf.push(makeSnapshot(2, 4930), 5050);
        expect(buf.smoothedOffset).toBeCloseTo(102, 5);
    });

    it('EMA converges toward stable offset over many samples', () => {
        const buf = new SnapshotBuffer({ emaAlpha: 0.1 });

        // Push 100 snapshots with constant offset of 200ms
        for (let i = 1; i <= 100; i++) {
            buf.push(makeSnapshot(i, i * 50), i * 50 + 200);
        }

        // After 100 samples, EMA should have converged very close to 200
        expect(buf.smoothedOffset).toBeCloseTo(200, 0);
    });

    it('EMA absorbs ±25ms jitter without large deviation', () => {
        const buf = new SnapshotBuffer({ emaAlpha: 0.1 });

        const baseOffset = 150;
        // Push snapshots with jittery arrival times
        for (let i = 1; i <= 50; i++) {
            const jitter = (i % 2 === 0) ? 25 : -25;
            const serverTime = i * 50;
            const localTime = serverTime + baseOffset + jitter;
            buf.push(makeSnapshot(i, serverTime), localTime);
        }

        // Smoothed offset should be close to baseOffset despite jitter
        expect(Math.abs(buf.smoothedOffset - baseOffset)).toBeLessThan(10);
    });

    it('higher emaAlpha reacts faster to offset changes', () => {
        const slowBuf = new SnapshotBuffer({ emaAlpha: 0.05 });
        const fastBuf = new SnapshotBuffer({ emaAlpha: 0.5 });

        // Both start at offset = 100
        slowBuf.push(makeSnapshot(1, 1000), 1100);
        fastBuf.push(makeSnapshot(1, 1000), 1100);

        // Both get offset = 200 on second push
        slowBuf.push(makeSnapshot(2, 1050), 1250);
        fastBuf.push(makeSnapshot(2, 1050), 1250);

        // Fast should be closer to 200 than slow
        expect(fastBuf.smoothedOffset).toBeGreaterThan(slowBuf.smoothedOffset);
    });
});

// ========================================
// 5. getRenderTimeMs
// ========================================

describe('SnapshotBuffer: getRenderTimeMs', () => {
    it('render time is localNow - offset - interpDelay', () => {
        const buf = new SnapshotBuffer({ interpDelayMs: 100 });
        // Snap offset to 50
        buf.push(makeSnapshot(1, 950), 1000);
        expect(buf.smoothedOffset).toBe(50);

        // renderTime = 2000 - 50 - 100 = 1850
        const rt = buf.getRenderTimeMs(2000);
        expect(rt).toBe(1850);
    });

    it('interpDelayMs is configurable', () => {
        const buf = new SnapshotBuffer({ interpDelayMs: 200 });
        buf.push(makeSnapshot(1, 1000), 1000); // offset = 0

        // renderTime = 2000 - 0 - 200 = 1800
        expect(buf.getRenderTimeMs(2000)).toBe(1800);
    });
});

// ========================================
// 6. Interpolation pair extraction
// ========================================

describe('SnapshotBuffer: getInterpolationPair', () => {
    it('empty buffer returns nulls and alpha 0', () => {
        const buf = new SnapshotBuffer();
        const result = buf.getInterpolationPair(5000);
        expect(result.prev).toBeNull();
        expect(result.next).toBeNull();
        expect(result.alpha).toBe(0);
        expect(result.teleports.size).toBe(0);
    });

    it('single snapshot returns same snapshot for both with alpha 0', () => {
        const buf = new SnapshotBuffer({ interpDelayMs: 0 });
        buf.push(makeSnapshot(1, 1000, [makeUnit(1)]), 1000);

        const result = buf.getInterpolationPair(1000);
        expect(result.prev).toBe(result.next);
        expect(result.prev.tick).toBe(1);
        expect(result.alpha).toBe(0);
    });

    it('returns correct bracketing pair and alpha', () => {
        const buf = new SnapshotBuffer({ interpDelayMs: 0 });
        // Push 3 snapshots at t=1000, t=1050, t=1100 with offset=0
        buf.push(makeSnapshot(1, 1000, [makeUnit(1)]), 1000);
        buf.push(makeSnapshot(2, 1050, [makeUnit(1)]), 1050);
        buf.push(makeSnapshot(3, 1100, [makeUnit(1)]), 1100);

        // renderTime at 1025 (midpoint between snap 1 and snap 2)
        const result = buf.getInterpolationPair(1025);
        expect(result.prev.tick).toBe(1);
        expect(result.next.tick).toBe(2);
        expect(result.alpha).toBeCloseTo(0.5, 5);
    });

    it('alpha is 0 at prev boundary', () => {
        const buf = new SnapshotBuffer({ interpDelayMs: 0 });
        buf.push(makeSnapshot(1, 1000, [makeUnit(1)]), 1000);
        buf.push(makeSnapshot(2, 1050, [makeUnit(1)]), 1050);

        const result = buf.getInterpolationPair(1000);
        expect(result.alpha).toBeCloseTo(0, 5);
    });

    it('alpha approaches 1 near next boundary', () => {
        const buf = new SnapshotBuffer({ interpDelayMs: 0 });
        buf.push(makeSnapshot(1, 1000, [makeUnit(1)]), 1000);
        buf.push(makeSnapshot(2, 1050, [makeUnit(1)]), 1050);
        buf.push(makeSnapshot(3, 1100, [makeUnit(1)]), 1100);

        // At 1049 (just before snap 2), alpha ≈ 0.98
        const result = buf.getInterpolationPair(1049);
        expect(result.prev.tick).toBe(1);
        expect(result.next.tick).toBe(2);
        expect(result.alpha).toBeCloseTo(0.98, 1);
    });

    it('at exactly latest serverTimeMs, uses bounded extrapolation', () => {
        const buf = new SnapshotBuffer({ interpDelayMs: 0 });
        buf.push(makeSnapshot(1, 1000, [makeUnit(1)]), 1000);
        buf.push(makeSnapshot(2, 1050, [makeUnit(1)]), 1050);

        // renderTime === latest serverTimeMs → extrapolation pair with alpha = 1.0
        const result = buf.getInterpolationPair(1050);
        expect(result.prev.tick).toBe(1);
        expect(result.next.tick).toBe(2);
        expect(result.alpha).toBeCloseTo(1.0, 5);
    });

    it('past all snapshots holds at latest by default (alpha=1, no extrapolation)', () => {
        const buf = new SnapshotBuffer({ interpDelayMs: 0 });
        buf.push(makeSnapshot(1, 1000, [makeUnit(1)]), 1000);
        buf.push(makeSnapshot(2, 1050, [makeUnit(1)]), 1050);

        // renderTime = 9999 (way past latest) → default maxExtrapolateMs=0 → alpha capped at 1.0
        const result = buf.getInterpolationPair(9999);
        expect(result.prev.tick).toBe(1);
        expect(result.next.tick).toBe(2);
        expect(result.alpha).toBeCloseTo(1.0, 5);
    });

    it('explicit maxExtrapolateMs allows bounded extrapolation', () => {
        const buf = new SnapshotBuffer({ interpDelayMs: 0, maxExtrapolateMs: 100 });
        buf.push(makeSnapshot(1, 1000, [makeUnit(1)]), 1000);
        buf.push(makeSnapshot(2, 1050, [makeUnit(1)]), 1050);

        // renderTime = 9999 (way past latest) → alpha capped at (50+100)/50 = 3.0
        const result = buf.getInterpolationPair(9999);
        expect(result.prev.tick).toBe(1);
        expect(result.next.tick).toBe(2);
        expect(result.alpha).toBeCloseTo(3.0, 5);
    });

    it('clamps to earliest pair when renderTime is before all snapshots', () => {
        const buf = new SnapshotBuffer({ interpDelayMs: 0 });
        buf.push(makeSnapshot(1, 1000, [makeUnit(1)]), 1000);
        buf.push(makeSnapshot(2, 1050, [makeUnit(1)]), 1050);

        // renderTime = 500 (before first snapshot)
        const result = buf.getInterpolationPair(500);
        expect(result.prev.tick).toBe(1);
        expect(result.next.tick).toBe(2);
        expect(result.alpha).toBe(0); // clamped to 0
    });

    it('interpDelay offsets render time correctly', () => {
        const buf = new SnapshotBuffer({ interpDelayMs: 100 });

        // offset = 0 (localNow === serverTimeMs)
        buf.push(makeSnapshot(1, 1000, [makeUnit(1)]), 1000);
        buf.push(makeSnapshot(2, 1050, [makeUnit(1)]), 1050);
        buf.push(makeSnapshot(3, 1100, [makeUnit(1)]), 1100);
        buf.push(makeSnapshot(4, 1150, [makeUnit(1)]), 1150);

        // localNow=1150, renderTime = 1150 - 0 - 100 = 1050
        // Should bracket between snap at t=1000 and t=1050, alpha ≈ 1.0
        const result = buf.getInterpolationPair(1150);
        expect(result.prev.serverTimeMs).toBeLessThanOrEqual(1050);
        expect(result.next.serverTimeMs).toBeGreaterThanOrEqual(1050);
    });

    it('handles identical serverTimeMs (zero span) without division by zero', () => {
        const buf = new SnapshotBuffer({ interpDelayMs: 0 });
        // Two snapshots with same serverTimeMs but different ticks
        buf.push(makeSnapshot(1, 1000, [makeUnit(1)]), 1000);
        buf.push(makeSnapshot(2, 1000, [makeUnit(1)]), 1000);

        // Should not throw, alpha should be 0
        const result = buf.getInterpolationPair(1000);
        expect(result.alpha).toBe(0);
    });
});

// ========================================
// 7. Teleport threshold detection
// ========================================

describe('SnapshotBuffer: teleport detection', () => {
    it('detects teleport when distance exceeds threshold', () => {
        const buf = new SnapshotBuffer({ interpDelayMs: 0, teleportThreshold: 10 });

        buf.push(makeSnapshot(1, 1000, [makeUnit(1, 0, 0, 0)]), 1000);
        buf.push(makeSnapshot(2, 1050, [makeUnit(1, 50, 0, 0)]), 1050); // moved 50 units

        const result = buf.getInterpolationPair(1025);
        expect(result.teleports.has(1)).toBe(true);
    });

    it('does NOT flag teleport when distance is below threshold', () => {
        const buf = new SnapshotBuffer({ interpDelayMs: 0, teleportThreshold: 10 });

        buf.push(makeSnapshot(1, 1000, [makeUnit(1, 0, 0, 0)]), 1000);
        buf.push(makeSnapshot(2, 1050, [makeUnit(1, 5, 0, 0)]), 1050); // moved 5 units

        const result = buf.getInterpolationPair(1025);
        expect(result.teleports.has(1)).toBe(false);
    });

    it('exact threshold distance does NOT trigger teleport (strictly greater)', () => {
        const buf = new SnapshotBuffer({ interpDelayMs: 0, teleportThreshold: 10 });

        // Distance = exactly 10 → threshold² = 100, distSq = 100 → NOT > 100
        buf.push(makeSnapshot(1, 1000, [makeUnit(1, 0, 0, 0)]), 1000);
        buf.push(makeSnapshot(2, 1050, [makeUnit(1, 10, 0, 0)]), 1050);

        const result = buf.getInterpolationPair(1025);
        expect(result.teleports.has(1)).toBe(false);
    });

    it('just above threshold triggers teleport', () => {
        const buf = new SnapshotBuffer({ interpDelayMs: 0, teleportThreshold: 10 });

        buf.push(makeSnapshot(1, 1000, [makeUnit(1, 0, 0, 0)]), 1000);
        buf.push(makeSnapshot(2, 1050, [makeUnit(1, 10.01, 0, 0)]), 1050);

        const result = buf.getInterpolationPair(1025);
        expect(result.teleports.has(1)).toBe(true);
    });

    it('detects teleport in 3D (diagonal distance)', () => {
        const buf = new SnapshotBuffer({ interpDelayMs: 0, teleportThreshold: 10 });

        // Distance = sqrt(6² + 6² + 6²) = sqrt(108) ≈ 10.39 > 10
        buf.push(makeSnapshot(1, 1000, [makeUnit(1, 0, 0, 0)]), 1000);
        buf.push(makeSnapshot(2, 1050, [makeUnit(1, 6, 6, 6)]), 1050);

        const result = buf.getInterpolationPair(1025);
        expect(result.teleports.has(1)).toBe(true);
    });

    it('per-unit: only teleporting units are flagged', () => {
        const buf = new SnapshotBuffer({ interpDelayMs: 0, teleportThreshold: 10 });

        const unitA_start = makeUnit(1, 0, 0, 0);
        const unitB_start = makeUnit(2, 10, 0, 0);

        const unitA_end = makeUnit(1, 100, 0, 0); // teleported
        const unitB_end = makeUnit(2, 12, 0, 0);  // normal move (2 units)

        buf.push(makeSnapshot(1, 1000, [unitA_start, unitB_start]), 1000);
        buf.push(makeSnapshot(2, 1050, [unitA_end, unitB_end]), 1050);

        const result = buf.getInterpolationPair(1025);
        expect(result.teleports.has(1)).toBe(true);  // unit 1 teleported
        expect(result.teleports.has(2)).toBe(false); // unit 2 normal
    });

    it('new unit (not in prev) is not flagged as teleport', () => {
        const buf = new SnapshotBuffer({ interpDelayMs: 0, teleportThreshold: 10 });

        buf.push(makeSnapshot(1, 1000, [makeUnit(1, 0, 0, 0)]), 1000);
        buf.push(makeSnapshot(2, 1050, [makeUnit(1, 0, 0, 0), makeUnit(2, 999, 0, 0)]), 1050);

        const result = buf.getInterpolationPair(1025);
        expect(result.teleports.has(2)).toBe(false); // unit 2 is new, not teleport
    });

    it('empty teleports set when no units teleport', () => {
        const buf = new SnapshotBuffer({ interpDelayMs: 0, teleportThreshold: 10 });

        buf.push(makeSnapshot(1, 1000, [makeUnit(1, 0, 0, 0)]), 1000);
        buf.push(makeSnapshot(2, 1050, [makeUnit(1, 1, 0, 0)]), 1050);

        const result = buf.getInterpolationPair(1025);
        expect(result.teleports.size).toBe(0);
    });

    it('teleportThreshold is configurable', () => {
        // Threshold = 5 → distance 6 triggers
        const buf = new SnapshotBuffer({ interpDelayMs: 0, teleportThreshold: 5 });

        buf.push(makeSnapshot(1, 1000, [makeUnit(1, 0, 0, 0)]), 1000);
        buf.push(makeSnapshot(2, 1050, [makeUnit(1, 6, 0, 0)]), 1050);

        const result = buf.getInterpolationPair(1025);
        expect(result.teleports.has(1)).toBe(true);
    });
});

// ========================================
// 8. Integration: realistic 20Hz stream
// ========================================

describe('SnapshotBuffer: realistic 20Hz scenario', () => {
    it('smooth interpolation over 20Hz snapshot stream', () => {
        const buf = new SnapshotBuffer({ interpDelayMs: 100, teleportThreshold: 10 });
        const tickIntervalMs = 50; // 20Hz

        // Push 10 snapshots (500ms of game time)
        // Unit 1 moves steadily: px increases by 0.1 per tick
        for (let i = 1; i <= 10; i++) {
            const serverTime = 1000 + i * tickIntervalMs;
            buf.push(
                makeSnapshot(i, serverTime, [makeUnit(1, i * 0.1, 0, 0)]),
                serverTime // offset = 0 for simplicity
            );
        }

        expect(buf.size).toBe(10);

        // At localNow = 1450 (latest server = 1500)
        // renderTime = 1450 - 0 - 100 = 1350
        // Brackets: snap at 1300 (tick 6) and snap at 1350 (tick 7)
        const result = buf.getInterpolationPair(1450);

        expect(result.prev).not.toBeNull();
        expect(result.next).not.toBeNull();
        expect(result.alpha).toBeGreaterThanOrEqual(0);
        expect(result.alpha).toBeLessThanOrEqual(1);
        expect(result.teleports.size).toBe(0); // smooth movement
    });

    it('survives packet loss (tick gaps)', () => {
        const buf = new SnapshotBuffer({ interpDelayMs: 100, teleportThreshold: 10 });

        // Push ticks 1, 2, 3, then skip 4, push 5
        buf.push(makeSnapshot(1, 1050, [makeUnit(1, 0, 0, 0)]), 1050);
        buf.push(makeSnapshot(2, 1100, [makeUnit(1, 0.1, 0, 0)]), 1100);
        buf.push(makeSnapshot(3, 1150, [makeUnit(1, 0.2, 0, 0)]), 1150);
        // tick 4 lost
        buf.push(makeSnapshot(5, 1250, [makeUnit(1, 0.4, 0, 0)]), 1250);

        expect(buf.size).toBe(4);
        expect(buf.highestTick).toBe(5);

        // Interpolation still works — buffer has 4 valid snapshots
        const result = buf.getInterpolationPair(1200);
        expect(result.prev).not.toBeNull();
        expect(result.next).not.toBeNull();
    });

    it('after buffer full, oldest snapshots are trimmed', () => {
        const buf = new SnapshotBuffer({ capacity: 5, interpDelayMs: 0 });

        for (let i = 1; i <= 10; i++) {
            buf.push(makeSnapshot(i, 1000 + i * 50, [makeUnit(1)]), 1000 + i * 50);
        }

        expect(buf.size).toBe(5);
        // Oldest retained should be tick 6
        const result = buf.getInterpolationPair(1000 + 7 * 50);
        expect(result.prev.tick).toBeGreaterThanOrEqual(6);
    });
});

// ========================================
// 9. Bounded extrapolation & underflow
// ========================================

describe('SnapshotBuffer: bounded extrapolation', () => {
    it('underflow counter increments when renderTime past all snapshots', () => {
        const buf = new SnapshotBuffer({ interpDelayMs: 0 });
        buf.push(makeSnapshot(1, 1000, [makeUnit(1)]), 1000);
        buf.push(makeSnapshot(2, 1050, [makeUnit(1)]), 1050);

        expect(buf.underflowCount).toBe(0);
        buf.getInterpolationPair(1060); // past latest → underflow
        expect(buf.underflowCount).toBe(1);
        buf.getInterpolationPair(1070); // still past latest
        expect(buf.underflowCount).toBe(2);
    });

    it('no underflow when renderTime is within buffer range', () => {
        const buf = new SnapshotBuffer({ interpDelayMs: 0 });
        buf.push(makeSnapshot(1, 1000, [makeUnit(1)]), 1000);
        buf.push(makeSnapshot(2, 1050, [makeUnit(1)]), 1050);
        buf.push(makeSnapshot(3, 1100, [makeUnit(1)]), 1100);

        buf.getInterpolationPair(1025); // between snap 1 and 2
        expect(buf.underflowCount).toBe(0);
    });

    it('extrapolation alpha is bounded by maxExtrapolateMs', () => {
        // span=50ms, maxExtrapolateMs=50 → maxAlpha = (50+50)/50 = 2.0
        const buf = new SnapshotBuffer({ interpDelayMs: 0, maxExtrapolateMs: 50 });
        buf.push(makeSnapshot(1, 1000, [makeUnit(1)]), 1000);
        buf.push(makeSnapshot(2, 1050, [makeUnit(1)]), 1050);

        // renderTime = 1200 (150ms past prev) → uncapped alpha = 4.0 → capped at 2.0
        const result = buf.getInterpolationPair(1200);
        expect(result.alpha).toBeCloseTo(2.0, 5);
    });

    it('single-snapshot underflow returns alpha 0 (no extrapolation base)', () => {
        const buf = new SnapshotBuffer({ interpDelayMs: 0 });
        buf.push(makeSnapshot(1, 1000, [makeUnit(1)]), 1000);

        const result = buf.getInterpolationPair(2000);
        expect(result.prev.tick).toBe(1);
        expect(result.next.tick).toBe(1);
        expect(result.alpha).toBe(0);
    });

    it('teleport detection works during extrapolation', () => {
        const buf = new SnapshotBuffer({ interpDelayMs: 0, teleportThreshold: 10 });
        buf.push(makeSnapshot(1, 1000, [makeUnit(1, 0, 0, 0)]), 1000);
        buf.push(makeSnapshot(2, 1050, [makeUnit(1, 50, 0, 0)]), 1050); // teleport

        const result = buf.getInterpolationPair(1060); // underflow
        expect(result.teleports.has(1)).toBe(true);
    });

    it('maxExtrapolateMs=0 caps alpha at 1.0 (no extrapolation)', () => {
        const buf = new SnapshotBuffer({ interpDelayMs: 0, maxExtrapolateMs: 0 });
        buf.push(makeSnapshot(1, 1000, [makeUnit(1)]), 1000);
        buf.push(makeSnapshot(2, 1050, [makeUnit(1)]), 1050);

        const result = buf.getInterpolationPair(1200);
        expect(result.alpha).toBeCloseTo(1.0, 5);
    });
});

// ========================================
// 10. Arrival interval diagnostics
// ========================================

describe('SnapshotBuffer: arrival diagnostics', () => {
    it('getArrivalStats returns zeroes when no pushes', () => {
        const buf = new SnapshotBuffer();
        const stats = buf.getArrivalStats();
        expect(stats.count).toBe(0);
        expect(stats.mean).toBe(0);
    });

    it('tracks arrival intervals between pushes', () => {
        const buf = new SnapshotBuffer();
        buf.push(makeSnapshot(1, 1000), 1000);
        buf.push(makeSnapshot(2, 1050), 1050); // interval = 50
        buf.push(makeSnapshot(3, 1100), 1110); // interval = 60

        const stats = buf.getArrivalStats();
        expect(stats.count).toBe(2);
        expect(stats.mean).toBeCloseTo(55, 1);
        expect(stats.min).toBe(50);
        expect(stats.max).toBe(60);
    });

    it('reset clears diagnostics', () => {
        const buf = new SnapshotBuffer();
        buf.push(makeSnapshot(1, 1000), 1000);
        buf.push(makeSnapshot(2, 1050), 1050);
        buf.getInterpolationPair(9999); // trigger underflow

        expect(buf.underflowCount).toBe(1);
        expect(buf.getArrivalStats().count).toBe(1);

        buf.reset();
        expect(buf.underflowCount).toBe(0);
        expect(buf.getArrivalStats().count).toBe(0);
    });
});
