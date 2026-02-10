/**
 * Determinism tests for SeededRNG.
 *
 * Run: npx vitest run
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    SeededRNG,
    createRNG,
    resetGlobalRNG,
    rngNext,
    globalRNG
} from '../SeededRNG.js';

describe('SeededRNG', () => {
    beforeEach(() => {
        resetGlobalRNG(0);
    });

    it('same seed produces same sequence', () => {
        const rng1 = createRNG(12345);
        const rng2 = createRNG(12345);

        const seq1 = [rng1.next(), rng1.next(), rng1.next(), rng1.next(), rng1.next()];
        const seq2 = [rng2.next(), rng2.next(), rng2.next(), rng2.next(), rng2.next()];

        for (let i = 0; i < seq1.length; i++) {
            expect(seq1[i]).toBe(seq2[i]);
        }
    });

    it('different seeds produce different sequences', () => {
        const rng1 = createRNG(12345);
        const rng2 = createRNG(54321);

        const seq1 = [rng1.next(), rng1.next(), rng1.next()];
        const seq2 = [rng2.next(), rng2.next(), rng2.next()];

        let allSame = true;
        for (let i = 0; i < seq1.length; i++) {
            if (seq1[i] !== seq2[i]) {
                allSame = false;
                break;
            }
        }

        expect(allSame).toBe(false);
    });

    it('reset returns to the same sequence', () => {
        const rng = createRNG(99999);

        const first = [rng.next(), rng.next(), rng.next()];
        rng.reset();
        const second = [rng.next(), rng.next(), rng.next()];

        for (let i = 0; i < first.length; i++) {
            expect(first[i]).toBe(second[i]);
        }
    });

    it('output is in [0, 1) range', () => {
        const rng = createRNG(42);

        for (let i = 0; i < 1000; i++) {
            const val = rng.next();
            expect(val >= 0).toBe(true);
            expect(val < 1).toBe(true);
        }
    });

    it('nextInt produces integers in [0, max) range', () => {
        const rng = createRNG(777);

        for (let i = 0; i < 100; i++) {
            const val = rng.nextInt(10);
            expect(Number.isInteger(val)).toBe(true);
            expect(val >= 0).toBe(true);
            expect(val < 10).toBe(true);
        }
    });

    it('global RNG is deterministic across resets with same seed', () => {
        resetGlobalRNG(88888);
        const first = [rngNext(), rngNext(), rngNext()];

        resetGlobalRNG(88888);
        const second = [rngNext(), rngNext(), rngNext()];

        for (let i = 0; i < first.length; i++) {
            expect(first[i]).toBe(second[i]);
        }
    });

    it('state serialization roundtrip preserves sequence', () => {
        const rng = createRNG(11111);
        rng.next();
        rng.next();

        const state = rng.getState();
        const val1 = rng.next();

        // Create new RNG and restore state
        const rng2 = createRNG(0);
        rng2.setState(state);
        const val2 = rng2.next();

        expect(val1).toBe(val2);
    });

    it('tracks call count and resets it', () => {
        const rng = createRNG(22222);

        expect(rng.callCount).toBe(0);

        rng.next();
        rng.next();
        rng.next();

        expect(rng.callCount).toBe(3);

        rng.reset();

        expect(rng.callCount).toBe(0);
    });
});
