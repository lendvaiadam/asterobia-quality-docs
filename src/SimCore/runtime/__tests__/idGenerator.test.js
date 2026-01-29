/**
 * Determinism tests for IdGenerator.
 *
 * Run in browser console:
 *   import('./src/SimCore/runtime/__tests__/idGenerator.test.js')
 *     .then(m => m.runAllTests())
 */

import {
    nextEntityId,
    peekEntityId,
    resetEntityIdCounter,
    setEntityIdCounter
} from '../IdGenerator.js';

/**
 * Test: IDs are sequential integers starting from 1
 */
function testSequentialIds() {
    resetEntityIdCounter();

    const id1 = nextEntityId();
    const id2 = nextEntityId();
    const id3 = nextEntityId();

    if (id1 !== 1 || id2 !== 2 || id3 !== 3) {
        throw new Error(`Expected 1,2,3 but got ${id1},${id2},${id3}`);
    }

    if (!Number.isInteger(id1) || !Number.isInteger(id2) || !Number.isInteger(id3)) {
        throw new Error('IDs must be integers');
    }

    console.log('✓ testSequentialIds passed');
    return true;
}

/**
 * Test: Reset counter returns to 0
 */
function testResetCounter() {
    resetEntityIdCounter();
    nextEntityId();
    nextEntityId();

    resetEntityIdCounter();
    const afterReset = nextEntityId();

    if (afterReset !== 1) {
        throw new Error(`Expected 1 after reset, got ${afterReset}`);
    }

    console.log('✓ testResetCounter passed');
    return true;
}

/**
 * Test: Peek doesn't increment counter
 */
function testPeekCounter() {
    resetEntityIdCounter();
    nextEntityId(); // 1
    nextEntityId(); // 2

    const peek1 = peekEntityId();
    const peek2 = peekEntityId();
    const next = nextEntityId(); // 3

    if (peek1 !== 2 || peek2 !== 2 || next !== 3) {
        throw new Error(`Peek should not increment: peek=${peek1},${peek2} next=${next}`);
    }

    console.log('✓ testPeekCounter passed');
    return true;
}

/**
 * Test: Set counter to specific value
 */
function testSetCounter() {
    resetEntityIdCounter();
    setEntityIdCounter(100);

    const id = nextEntityId();
    if (id !== 101) {
        throw new Error(`Expected 101 after setCounter(100), got ${id}`);
    }

    console.log('✓ testSetCounter passed');
    return true;
}

/**
 * Test: Deterministic replay (same sequence after reset)
 */
function testDeterministicReplay() {
    resetEntityIdCounter();
    const run1 = [nextEntityId(), nextEntityId(), nextEntityId()];

    resetEntityIdCounter();
    const run2 = [nextEntityId(), nextEntityId(), nextEntityId()];

    if (JSON.stringify(run1) !== JSON.stringify(run2)) {
        throw new Error(`Runs not identical: ${run1} vs ${run2}`);
    }

    console.log('✓ testDeterministicReplay passed');
    return true;
}

/**
 * Run all tests
 */
export function runAllTests() {
    console.log('=== IdGenerator Determinism Tests ===');
    let passed = 0;
    let failed = 0;

    const tests = [
        testSequentialIds,
        testResetCounter,
        testPeekCounter,
        testSetCounter,
        testDeterministicReplay,
    ];

    for (const test of tests) {
        try {
            test();
            passed++;
        } catch (err) {
            console.error(`✗ ${test.name} FAILED:`, err.message);
            failed++;
        }
    }

    // Cleanup
    resetEntityIdCounter();

    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
    return { passed, failed };
}

if (typeof window !== 'undefined') {
    console.log('IdGenerator tests loaded. Call runAllTests() to execute.');
}
