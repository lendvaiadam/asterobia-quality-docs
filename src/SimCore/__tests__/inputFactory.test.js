/**
 * InputFactory & CommandQueue Tests
 *
 * R006: Verifies InputFactory produces deterministic commands.
 *
 * Run: node --experimental-vm-modules src/SimCore/__tests__/inputFactory.test.js
 */

import { CommandQueue, CommandType } from '../runtime/CommandQueue.js';
import { InputFactory } from '../runtime/InputFactory.js';
import { resetEntityIdCounter } from '../runtime/IdGenerator.js';

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

// Reset state before tests
resetEntityIdCounter();

// Test 1: CommandQueue enqueues with sequence numbers
test('CommandQueue assigns sequence numbers', () => {
    const queue = new CommandQueue();
    const cmd1 = queue.enqueue({ type: 'TEST' });
    const cmd2 = queue.enqueue({ type: 'TEST' });

    assertEqual(cmd1.seq, 0, 'first seq');
    assertEqual(cmd2.seq, 1, 'second seq');
});

// Test 2: CommandQueue flush returns commands in order
test('CommandQueue flush returns ordered commands', () => {
    const queue = new CommandQueue();
    queue.enqueue({ type: 'A' });
    queue.enqueue({ type: 'B' });
    queue.enqueue({ type: 'C' });

    const flushed = queue.flush(1);

    assertEqual(flushed.length, 3, 'flushed count');
    assertEqual(flushed[0].type, 'A', 'first type');
    assertEqual(flushed[1].type, 'B', 'second type');
    assertEqual(flushed[2].type, 'C', 'third type');
});

// Test 3: CommandQueue flush clears pending
test('CommandQueue flush clears pending', () => {
    const queue = new CommandQueue();
    queue.enqueue({ type: 'TEST' });
    queue.flush(1);

    assertEqual(queue.pendingCount, 0, 'pending after flush');
    assertEqual(queue.historyCount, 1, 'history after flush');
});

// Test 4: InputFactory creates SELECT command
test('InputFactory creates SELECT command', () => {
    const queue = new CommandQueue();
    const factory = new InputFactory(queue);

    const cmd = factory.select(42, { skipCamera: true });

    assertEqual(cmd.type, CommandType.SELECT, 'type');
    assertEqual(cmd.unitId, 42, 'unitId');
    assertEqual(cmd.skipCamera, true, 'skipCamera');
});

// Test 5: InputFactory creates DESELECT command
test('InputFactory creates DESELECT command', () => {
    const queue = new CommandQueue();
    const factory = new InputFactory(queue);

    const cmd = factory.deselect();

    assertEqual(cmd.type, CommandType.DESELECT, 'type');
});

// Test 6: InputFactory creates MOVE command with position
test('InputFactory creates MOVE command', () => {
    const queue = new CommandQueue();
    const factory = new InputFactory(queue);

    const cmd = factory.move(1, { x: 10, y: 5, z: 20 });

    assertEqual(cmd.type, CommandType.MOVE, 'type');
    assertEqual(cmd.unitId, 1, 'unitId');
    assertEqual(cmd.position.x, 10, 'position.x');
    assertEqual(cmd.position.y, 5, 'position.y');
    assertEqual(cmd.position.z, 20, 'position.z');
});

// Test 7: Commands have deterministic IDs
test('Commands have deterministic IDs', () => {
    resetEntityIdCounter();
    const queue1 = new CommandQueue();
    const factory1 = new InputFactory(queue1);

    const cmd1a = factory1.select(1);
    const cmd1b = factory1.move(1, { x: 0, y: 0, z: 0 });

    resetEntityIdCounter();
    const queue2 = new CommandQueue();
    const factory2 = new InputFactory(queue2);

    const cmd2a = factory2.select(1);
    const cmd2b = factory2.move(1, { x: 0, y: 0, z: 0 });

    assertEqual(cmd1a.id, cmd2a.id, 'first command ID');
    assertEqual(cmd1b.id, cmd2b.id, 'second command ID');
});

// Test 8: SET_PATH command serializes points
test('InputFactory creates SET_PATH command', () => {
    const queue = new CommandQueue();
    const factory = new InputFactory(queue);

    const points = [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 10 },
        { x: 20, y: 0, z: 0 }
    ];

    const cmd = factory.setPath(1, points);

    assertEqual(cmd.type, CommandType.SET_PATH, 'type');
    assertEqual(cmd.points.length, 3, 'points count');
    assertEqual(cmd.points[1].x, 10, 'point[1].x');
});

// ============ Summary ============

console.log('\n=== InputFactory Tests ===\n');

console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) {
    process.exit(1);
} else {
    console.log('\n✓ All InputFactory tests PASS');
    process.exit(0);
}
