/**
 * Determinism tests for IdGenerator.
 *
 * Run: npx vitest run
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    nextEntityId,
    peekEntityId,
    resetEntityIdCounter,
    setEntityIdCounter
} from '../IdGenerator.js';

describe('IdGenerator', () => {
    beforeEach(() => {
        resetEntityIdCounter();
    });

    it('produces sequential integer IDs starting from 1', () => {
        const id1 = nextEntityId();
        const id2 = nextEntityId();
        const id3 = nextEntityId();

        expect(id1).toBe(1);
        expect(id2).toBe(2);
        expect(id3).toBe(3);
        expect(Number.isInteger(id1)).toBe(true);
        expect(Number.isInteger(id2)).toBe(true);
        expect(Number.isInteger(id3)).toBe(true);
    });

    it('resets counter back to 0 so next ID is 1', () => {
        nextEntityId();
        nextEntityId();

        resetEntityIdCounter();
        const afterReset = nextEntityId();

        expect(afterReset).toBe(1);
    });

    it('peek does not increment the counter', () => {
        nextEntityId(); // 1
        nextEntityId(); // 2

        const peek1 = peekEntityId();
        const peek2 = peekEntityId();
        const next = nextEntityId(); // 3

        expect(peek1).toBe(2);
        expect(peek2).toBe(2);
        expect(next).toBe(3);
    });

    it('setCounter advances the counter to a specific value', () => {
        setEntityIdCounter(100);

        const id = nextEntityId();
        expect(id).toBe(101);
    });

    it('produces identical sequences after reset (deterministic replay)', () => {
        const run1 = [nextEntityId(), nextEntityId(), nextEntityId()];

        resetEntityIdCounter();
        const run2 = [nextEntityId(), nextEntityId(), nextEntityId()];

        expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
    });
});
