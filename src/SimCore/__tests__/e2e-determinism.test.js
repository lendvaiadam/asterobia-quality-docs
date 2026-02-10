/**
 * End-to-End Determinism Verification Test
 *
 * Proves that two separate sim instances with:
 * - same seed
 * - same initial conditions
 * - same command stream
 * produce identical authoritative state after N ticks.
 *
 * Run: npx vitest run src/SimCore/__tests__/e2e-determinism.test.js
 *
 * Position comparison: EXACT equality (no epsilon).
 * Rationale: Deterministic sim with same seed + same inputs MUST produce
 * bit-identical results. Any floating-point divergence indicates a bug.
 */

import { describe, it, expect } from 'vitest';
import { SimLoop } from '../runtime/SimLoop.js';
import { resetGlobalRNG, rngNext } from '../runtime/SeededRNG.js';
import { resetEntityIdCounter, nextEntityId } from '../runtime/IdGenerator.js';

// ============ Minimal Headless Unit Model (test-only) ============

/**
 * Minimal unit state for determinism testing.
 * No Three.js, no rendering - pure authoritative state.
 */
class HeadlessUnit {
    constructor(id) {
        this.id = id;
        this.position = { x: 0, y: 0, z: 0 };
        this.velocity = { x: 0, y: 0, z: 0 };
        this.speed = 5.0;
    }

    /**
     * Update position based on velocity.
     * @param {number} dt - Delta time in seconds
     */
    update(dt) {
        this.position.x += this.velocity.x * this.speed * dt;
        this.position.y += this.velocity.y * this.speed * dt;
        this.position.z += this.velocity.z * this.speed * dt;
    }

    /**
     * Set movement direction (normalized).
     */
    setDirection(dx, dy, dz) {
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (len > 0) {
            this.velocity.x = dx / len;
            this.velocity.y = dy / len;
            this.velocity.z = dz / len;
        } else {
            this.velocity.x = 0;
            this.velocity.y = 0;
            this.velocity.z = 0;
        }
    }

    /**
     * Stop movement.
     */
    stop() {
        this.velocity.x = 0;
        this.velocity.y = 0;
        this.velocity.z = 0;
    }

    /**
     * Get serializable state for comparison.
     */
    getState() {
        return {
            id: this.id,
            position: { ...this.position },
            velocity: { ...this.velocity }
        };
    }
}

// ============ Minimal Command System (test-only) ============

const CommandTypes = {
    SPAWN: 'SPAWN',
    MOVE: 'MOVE',
    STOP: 'STOP'
};

/**
 * Minimal command queue for testing.
 */
class TestCommandQueue {
    constructor() {
        this._pending = [];
        this._seqCounter = 0;
    }

    enqueue(type, payload, tick) {
        this._pending.push({
            type,
            payload,
            tick,
            seq: this._seqCounter++
        });
    }

    flush(currentTick) {
        // Return commands scheduled for this tick
        const ready = this._pending.filter(cmd => cmd.tick <= currentTick);
        this._pending = this._pending.filter(cmd => cmd.tick > currentTick);
        return ready.sort((a, b) => a.seq - b.seq);
    }

    reset() {
        this._pending = [];
        this._seqCounter = 0;
    }
}

// ============ Headless Sim Instance ============

/**
 * Minimal sim instance for determinism testing.
 */
class HeadlessSim {
    constructor(seed) {
        this.seed = seed;
        this.units = [];
        this.commandQueue = new TestCommandQueue();
        this.simLoop = new SimLoop({ fixedDtMs: 50 });
        this.simLoop.onSimTick = (dt, tick) => this.simTick(dt, tick);

        // Reset global state with seed
        resetGlobalRNG(seed);
        resetEntityIdCounter();
    }

    /**
     * Add a command to be executed at a specific tick.
     */
    scheduleCommand(type, payload, tick) {
        this.commandQueue.enqueue(type, payload, tick);
    }

    /**
     * Process one simulation tick.
     */
    simTick(dt, tickCount) {
        // Process commands
        const commands = this.commandQueue.flush(tickCount);
        for (const cmd of commands) {
            this.executeCommand(cmd);
        }

        // Update all units
        for (const unit of this.units) {
            unit.update(dt);
        }
    }

    /**
     * Execute a single command.
     */
    executeCommand(cmd) {
        switch (cmd.type) {
            case CommandTypes.SPAWN: {
                const id = nextEntityId();
                const unit = new HeadlessUnit(id);
                // Use seeded RNG for initial position variation
                unit.position.x = cmd.payload.x + rngNext() * 0.001;
                unit.position.y = cmd.payload.y + rngNext() * 0.001;
                unit.position.z = cmd.payload.z + rngNext() * 0.001;
                this.units.push(unit);
                break;
            }
            case CommandTypes.MOVE: {
                const unit = this.units.find(u => u.id === cmd.payload.unitId);
                if (unit) {
                    unit.setDirection(
                        cmd.payload.dx,
                        cmd.payload.dy,
                        cmd.payload.dz
                    );
                }
                break;
            }
            case CommandTypes.STOP: {
                const unit = this.units.find(u => u.id === cmd.payload.unitId);
                if (unit) {
                    unit.stop();
                }
                break;
            }
        }
    }

    /**
     * Run simulation for N ticks.
     * Uses synthetic time (not real time) for determinism.
     */
    runTicks(numTicks) {
        const fixedDtMs = this.simLoop.fixedDtMs;
        let syntheticTime = fixedDtMs; // Start at first tick time

        for (let i = 0; i < numTicks; i++) {
            // Advance by exactly one tick worth of time
            syntheticTime += fixedDtMs;
            this.simLoop.step(syntheticTime);
        }
    }

    /**
     * Get full state snapshot for comparison.
     */
    getStateSnapshot() {
        return {
            tickCount: this.simLoop.tickCount,
            units: this.units.map(u => u.getState())
        };
    }

    /**
     * Reset for new run.
     */
    reset() {
        this.units = [];
        this.commandQueue.reset();
        this.simLoop.reset();
        resetGlobalRNG(this.seed);
        resetEntityIdCounter();
    }
}

// ============ Snapshot Comparison ============

/**
 * Compare two state snapshots for exact equality.
 * @returns {{ equal: boolean, differences: string[] }}
 */
function compareSnapshots(snap1, snap2) {
    const differences = [];

    if (snap1.tickCount !== snap2.tickCount) {
        differences.push(`tickCount: ${snap1.tickCount} vs ${snap2.tickCount}`);
    }

    if (snap1.units.length !== snap2.units.length) {
        differences.push(`unit count: ${snap1.units.length} vs ${snap2.units.length}`);
        return { equal: false, differences };
    }

    for (let i = 0; i < snap1.units.length; i++) {
        const u1 = snap1.units[i];
        const u2 = snap2.units[i];

        if (u1.id !== u2.id) {
            differences.push(`unit[${i}].id: ${u1.id} vs ${u2.id}`);
        }

        // EXACT equality for positions (no epsilon)
        // Deterministic sim must produce bit-identical results
        if (u1.position.x !== u2.position.x) {
            differences.push(`unit[${i}].position.x: ${u1.position.x} vs ${u2.position.x}`);
        }
        if (u1.position.y !== u2.position.y) {
            differences.push(`unit[${i}].position.y: ${u1.position.y} vs ${u2.position.y}`);
        }
        if (u1.position.z !== u2.position.z) {
            differences.push(`unit[${i}].position.z: ${u1.position.z} vs ${u2.position.z}`);
        }
    }

    return {
        equal: differences.length === 0,
        differences
    };
}

// ============ Tests ============

describe('E2E Determinism Verification', () => {
    it('dual-run produces identical state after 100 ticks', () => {
        const SEED = 42;
        const TICKS = 100;

        // Create two independent sim instances with same seed
        const sim1 = new HeadlessSim(SEED);
        const sim2 = new HeadlessSim(SEED);

        // Schedule identical command streams for both sims
        const commands = [
            { tick: 1, type: CommandTypes.SPAWN, payload: { x: 0, y: 10, z: 0 } },
            { tick: 1, type: CommandTypes.SPAWN, payload: { x: 5, y: 10, z: 0 } },
            { tick: 5, type: CommandTypes.MOVE, payload: { unitId: 1, dx: 1, dy: 0, dz: 0 } },
            { tick: 5, type: CommandTypes.MOVE, payload: { unitId: 2, dx: 0, dy: 0, dz: 1 } },
            { tick: 30, type: CommandTypes.MOVE, payload: { unitId: 1, dx: 0, dy: 0, dz: -1 } },
            { tick: 50, type: CommandTypes.STOP, payload: { unitId: 2 } },
            { tick: 70, type: CommandTypes.MOVE, payload: { unitId: 2, dx: -1, dy: 0, dz: 0 } },
            { tick: 90, type: CommandTypes.STOP, payload: { unitId: 1 } },
        ];

        for (const cmd of commands) {
            sim1.scheduleCommand(cmd.type, cmd.payload, cmd.tick);
            sim2.scheduleCommand(cmd.type, cmd.payload, cmd.tick);
        }

        // Run both sims for 100 ticks
        // CRITICAL: Reset globals before execution logic starts
        resetGlobalRNG(SEED);
        resetEntityIdCounter();
        sim1.runTicks(TICKS);
        const snap1 = sim1.getStateSnapshot();

        // CRITICAL: Reset globals again for the second instance
        resetGlobalRNG(SEED);
        resetEntityIdCounter();
        sim2.runTicks(TICKS);
        const snap2 = sim2.getStateSnapshot();

        // Compare
        const result = compareSnapshots(snap1, snap2);

        expect(result.equal).toBe(true);
        expect(snap1.units.length).toBe(2);
    });

    it('stress test: 10 seeds produce identical state', () => {
        const iterations = 10;
        let passedCount = 0;
        let failedCount = 0;

        for (let i = 0; i < iterations; i++) {
            // Use different seeds to test various scenarios
            const seed = 1000 + i;

            const sim1 = new HeadlessSim(seed);
            const sim2 = new HeadlessSim(seed);

            // Random but deterministic command generation
            resetGlobalRNG(seed * 100);
            const commands = [];
            for (let t = 1; t <= 50; t += 5) {
                commands.push({
                    tick: t,
                    type: CommandTypes.SPAWN,
                    payload: { x: rngNext() * 10, y: 10, z: rngNext() * 10 }
                });
            }

            // Apply commands to both sims (commands already generated above)
            for (const cmd of commands) {
                sim1.scheduleCommand(cmd.type, cmd.payload, cmd.tick);
                sim2.scheduleCommand(cmd.type, cmd.payload, cmd.tick);
            }

            // CRITICAL: Reset globals before each run (same pattern as dual-run test)
            resetGlobalRNG(seed);
            resetEntityIdCounter();
            sim1.runTicks(100);

            resetGlobalRNG(seed);
            resetEntityIdCounter();
            sim2.runTicks(100);

            const result = compareSnapshots(sim1.getStateSnapshot(), sim2.getStateSnapshot());

            if (result.equal) {
                passedCount++;
            } else {
                failedCount++;
            }
        }

        expect(failedCount).toBe(0);
        expect(passedCount).toBe(iterations);
    });
});
