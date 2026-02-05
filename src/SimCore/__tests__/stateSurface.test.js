/**
 * StateSurface Verification Test
 *
 * Validates serializeState/serializeUnit produce correct authoritative snapshots.
 *
 * Run: node --experimental-vm-modules src/SimCore/__tests__/stateSurface.test.js
 */

import {
    serializeState,
    serializeUnit,
    hashState,
    compareStates
} from '../runtime/StateSurface.js';

// ============ Mock Data ============

function createMockUnit(id, overrides = {}) {
    return {
        id,
        name: `Unit_${id}`,
        position: { x: 10 + id, y: 0, z: 20 + id },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        velocity: { x: 1, y: 0, z: 0 },
        velocityDirection: { x: 1, y: 0, z: 0 },
        speed: 5.0,
        currentSpeed: 5.0,
        turnSpeed: 2.0,
        groundOffset: 0.22,
        pathIndex: 0,
        isFollowingPath: false,
        loopingEnabled: false,
        isPathClosed: false,
        waypoints: [],
        targetWaypointId: null,
        lastWaypointId: null,
        commands: [],
        currentCommandIndex: 0,
        health: 100,
        maxHealth: 100,
        shieldLevel: 0,
        disabled: false,
        pausedByCommand: false,
        waterState: 'normal',
        isStuck: false,
        ...overrides
    };
}

function createMockGame(units = []) {
    return {
        units,
        simLoop: { tickCount: 50, getSimTimeSec: () => 2.5 },
        commandQueue: { pendingCount: 0, historyCount: 10 },
        selectedUnit: units[0] || null
    };
}

// ============ Tests ============

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`✓ ${name}`);
        passed++;
    } catch (err) {
        console.log(`✗ ${name}`);
        console.log(`  Error: ${err.message}`);
        failed++;
    }
}

function assertEqual(actual, expected, msg = '') {
    if (actual !== expected) {
        throw new Error(`${msg} Expected ${expected}, got ${actual}`);
    }
}

function assertDeepEqual(actual, expected, msg = '') {
    const aStr = JSON.stringify(actual);
    const eStr = JSON.stringify(expected);
    if (aStr !== eStr) {
        throw new Error(`${msg}\nExpected: ${eStr}\nGot: ${aStr}`);
    }
}

// Test 1: serializeUnit produces correct structure
test('serializeUnit returns authoritative fields only', () => {
    const unit = createMockUnit(1);
    // Add render-only fields that should be EXCLUDED
    unit.mesh = { visible: true };
    unit.isSelected = true;
    unit.isHovered = true;
    unit.dustEffect = {};

    const serialized = serializeUnit(unit);

    // Check authoritative fields present
    assertEqual(serialized.id, 1, 'id');
    assertEqual(serialized.health, 100, 'health');
    assertDeepEqual(serialized.position, { x: 11, y: 0, z: 21 }, 'position');

    // Check render-only fields EXCLUDED
    assertEqual(serialized.mesh, undefined, 'mesh should be excluded');
    assertEqual(serialized.isSelected, undefined, 'isSelected should be excluded');
    assertEqual(serialized.isHovered, undefined, 'isHovered should be excluded');
    assertEqual(serialized.dustEffect, undefined, 'dustEffect should be excluded');
});

// Test 2: serializeUnit handles null/undefined gracefully
test('serializeUnit handles null input', () => {
    const result = serializeUnit(null);
    assertEqual(result, null, 'null input returns null');
});

// Test 3: serializeState produces correct structure
test('serializeState captures game state', () => {
    const units = [createMockUnit(1), createMockUnit(2)];
    const game = createMockGame(units);

    const state = serializeState(game);

    assertEqual(state.version, 1, 'version');
    assertEqual(state.tickCount, 50, 'tickCount');
    assertEqual(state.units.length, 2, 'unit count');
    assertEqual(state.selectedUnitId, 1, 'selectedUnitId');
});

// Test 4: hashState produces deterministic hash
test('hashState is deterministic', () => {
    const units = [createMockUnit(1), createMockUnit(2)];
    const game = createMockGame(units);

    const state = serializeState(game);
    const hash1 = hashState(state);
    const hash2 = hashState(state);

    assertEqual(hash1, hash2, 'same state produces same hash');
    assertEqual(typeof hash1, 'string', 'hash is string');
});

// Test 5: compareStates detects identical states
test('compareStates returns equal for identical states', () => {
    const units1 = [createMockUnit(1)];
    const units2 = [createMockUnit(1)];

    const state1 = serializeState(createMockGame(units1));
    const state2 = serializeState(createMockGame(units2));

    const result = compareStates(state1, state2);

    assertEqual(result.equal, true, 'states are equal');
    assertEqual(result.differences.length, 0, 'no differences');
});

// Test 6: compareStates detects position differences
test('compareStates detects position drift', () => {
    const unit1 = createMockUnit(1);
    const unit2 = createMockUnit(1);
    unit2.position.x += 0.001; // Small drift

    const state1 = serializeState(createMockGame([unit1]));
    const state2 = serializeState(createMockGame([unit2]));

    const result = compareStates(state1, state2);

    assertEqual(result.equal, false, 'states differ');
    assertEqual(result.differences.length > 0, true, 'has differences');
});

// Test 7: compareStates respects epsilon tolerance
test('compareStates with epsilon tolerance', () => {
    const unit1 = createMockUnit(1);
    const unit2 = createMockUnit(1);
    unit2.position.x += 0.0001; // Tiny drift

    const state1 = serializeState(createMockGame([unit1]));
    const state2 = serializeState(createMockGame([unit2]));

    // With epsilon = 0, should detect difference
    const exactResult = compareStates(state1, state2, { positionEpsilon: 0 });
    assertEqual(exactResult.equal, false, 'exact comparison detects drift');

    // With epsilon = 0.001, should be equal
    const tolerantResult = compareStates(state1, state2, { positionEpsilon: 0.001 });
    assertEqual(tolerantResult.equal, true, 'tolerant comparison ignores small drift');
});

// Test 8: serializeUnit handles commands correctly
test('serializeUnit serializes commands', () => {
    const unit = createMockUnit(1, {
        commands: [
            { id: 'cmd1', type: 'MOVE', params: { position: { x: 5, y: 0, z: 10 } }, status: 'pending' },
            { id: 'cmd2', type: 'STOP', params: {}, status: 'completed' }
        ]
    });

    const serialized = serializeUnit(unit);

    assertEqual(serialized.commands.length, 2, 'command count');
    assertEqual(serialized.commands[0].type, 'MOVE', 'first command type');
    assertEqual(serialized.commands[1].type, 'STOP', 'second command type');
});

// ============ Summary ============

console.log('\n=== StateSurface Tests ===\n');

// Run all tests (already run above via test() calls)

console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) {
    console.error(`\n✗ ${failed} StateSurface tests FAILED`);
} else {
    console.log('\n✓ All StateSurface tests PASS');
}
