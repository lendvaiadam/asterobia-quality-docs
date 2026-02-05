/**
 * InputFactory & CommandQueue Tests
 *
 * R006: Verifies InputFactory produces deterministic commands.
 * R007: Tests updated to use transport layer architecture.
 *
 * Run: node --experimental-vm-modules src/SimCore/__tests__/inputFactory.test.js
 */

import { CommandQueue, CommandType } from '../runtime/CommandQueue.js';
import { InputFactory } from '../runtime/InputFactory.js';
import { LocalTransport } from '../transport/LocalTransport.js';
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

/**
 * R007: Create a test transport wired to a queue.
 * This simulates how initializeTransport() works.
 */
function createTestTransportWithQueue() {
    const queue = new CommandQueue();
    const transport = new LocalTransport();
    transport.onReceive = (cmd) => queue.enqueue(cmd);
    transport.connect();
    return { transport, queue };
}

// Test 4: InputFactory creates SELECT command via transport
test('InputFactory creates SELECT command via transport', () => {
    const { transport, queue } = createTestTransportWithQueue();
    const factory = new InputFactory(transport);

    const cmd = factory.select(42, { skipCamera: true });

    assertEqual(cmd.type, CommandType.SELECT, 'returned type');
    assertEqual(cmd.unitId, 42, 'returned unitId');
    assertEqual(cmd.skipCamera, true, 'returned skipCamera');

    // Verify command reached queue via transport
    assertEqual(queue.pendingCount, 1, 'queue received command');
});

// Test 5: InputFactory creates DESELECT command via transport
test('InputFactory creates DESELECT command via transport', () => {
    const { transport, queue } = createTestTransportWithQueue();
    const factory = new InputFactory(transport);

    const cmd = factory.deselect();

    assertEqual(cmd.type, CommandType.DESELECT, 'type');
    assertEqual(queue.pendingCount, 1, 'queue received command');
});

// Test 6: InputFactory creates MOVE command with position via transport
test('InputFactory creates MOVE command via transport', () => {
    const { transport, queue } = createTestTransportWithQueue();
    const factory = new InputFactory(transport);

    const cmd = factory.move(1, { x: 10, y: 5, z: 20 });

    assertEqual(cmd.type, CommandType.MOVE, 'type');
    assertEqual(cmd.unitId, 1, 'unitId');
    assertEqual(cmd.position.x, 10, 'position.x');
    assertEqual(cmd.position.y, 5, 'position.y');
    assertEqual(cmd.position.z, 20, 'position.z');
    assertEqual(queue.pendingCount, 1, 'queue received command');
});

// Test 7: Commands have deterministic IDs
test('Commands have deterministic IDs', () => {
    resetEntityIdCounter();
    const { transport: t1, queue: q1 } = createTestTransportWithQueue();
    const factory1 = new InputFactory(t1);

    const cmd1a = factory1.select(1);
    const cmd1b = factory1.move(1, { x: 0, y: 0, z: 0 });

    resetEntityIdCounter();
    const { transport: t2, queue: q2 } = createTestTransportWithQueue();
    const factory2 = new InputFactory(t2);

    const cmd2a = factory2.select(1);
    const cmd2b = factory2.move(1, { x: 0, y: 0, z: 0 });

    // Commands should have deterministic sequence numbers from queue
    const flushed1 = q1.flush(1);
    const flushed2 = q2.flush(1);

    assertEqual(flushed1[0].seq, flushed2[0].seq, 'first command seq');
    assertEqual(flushed1[1].seq, flushed2[1].seq, 'second command seq');
});

// Test 8: SET_PATH command serializes points via transport
test('InputFactory creates SET_PATH command via transport', () => {
    const { transport, queue } = createTestTransportWithQueue();
    const factory = new InputFactory(transport);

    const points = [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 10 },
        { x: 20, y: 0, z: 0 }
    ];

    const cmd = factory.setPath(1, points);

    assertEqual(cmd.type, CommandType.SET_PATH, 'type');
    assertEqual(cmd.points.length, 3, 'points count');
    assertEqual(cmd.points[1].x, 10, 'point[1].x');
    assertEqual(queue.pendingCount, 1, 'queue received command');
});

// Test 9: Transport must be connected for delivery
test('Transport queues commands before connect', () => {
    const queue = new CommandQueue();
    const transport = new LocalTransport();
    transport.onReceive = (cmd) => queue.enqueue(cmd);
    // Note: NOT calling transport.connect() yet

    const factory = new InputFactory(transport);
    factory.select(1);

    // Command should be queued in transport's pending, not delivered yet
    assertEqual(queue.pendingCount, 0, 'queue empty before connect');

    // Now connect - should flush pending
    transport.connect();
    assertEqual(queue.pendingCount, 1, 'queue has command after connect');
});

// ============ Summary ============

console.log('\n=== InputFactory Tests (R007 Transport) ===\n');

console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) {
    console.error(`\n✗ ${failed} InputFactory tests FAILED`);
} else {
    console.log('\n✓ All InputFactory tests PASS');
}
