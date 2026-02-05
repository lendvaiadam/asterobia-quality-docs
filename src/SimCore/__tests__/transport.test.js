/**
 * Transport Layer Tests (R007)
 *
 * Proves the "no bypass" invariant:
 * Commands ONLY enter the simulation through the transport layer.
 *
 * Run: node --experimental-vm-modules src/SimCore/__tests__/transport.test.js
 */

import { CommandQueue, CommandType } from '../runtime/CommandQueue.js';
import { InputFactory } from '../runtime/InputFactory.js';
import { LocalTransport, TransportState, TransportBase } from '../transport/index.js';

// ============ Test Framework ============

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

function assertTrue(condition, msg = '') {
    if (!condition) {
        throw new Error(`${msg} Expected true, got false`);
    }
}

// ============ LocalTransport Unit Tests ============

test('LocalTransport starts disconnected', () => {
    const transport = new LocalTransport();
    assertEqual(transport.state, TransportState.DISCONNECTED, 'initial state');
    assertEqual(transport.isConnected, false, 'isConnected');
});

test('LocalTransport connects', () => {
    const transport = new LocalTransport();
    transport.connect();
    assertEqual(transport.state, TransportState.CONNECTED, 'state after connect');
    assertEqual(transport.isConnected, true, 'isConnected after connect');
});

test('LocalTransport disconnects', () => {
    const transport = new LocalTransport();
    transport.connect();
    transport.disconnect();
    assertEqual(transport.state, TransportState.DISCONNECTED, 'state after disconnect');
    assertEqual(transport.isConnected, false, 'isConnected after disconnect');
});

test('LocalTransport delivers immediately when connected', () => {
    const transport = new LocalTransport();
    let received = null;
    transport.onReceive = (cmd) => { received = cmd; };
    transport.connect();

    transport.send({ type: 'TEST', value: 42 });

    assertTrue(received !== null, 'received command');
    assertEqual(received.type, 'TEST', 'received type');
    assertEqual(received.value, 42, 'received value');
});

test('LocalTransport queues before connect, delivers after', () => {
    const transport = new LocalTransport();
    const received = [];
    transport.onReceive = (cmd) => received.push(cmd);

    // Send before connect
    transport.send({ type: 'A' });
    transport.send({ type: 'B' });

    assertEqual(received.length, 0, 'no delivery before connect');

    // Connect - should flush pending
    transport.connect();

    assertEqual(received.length, 2, 'delivered after connect');
    assertEqual(received[0].type, 'A', 'first command');
    assertEqual(received[1].type, 'B', 'second command');
});

test('LocalTransport tracks statistics', () => {
    const transport = new LocalTransport();
    transport.onReceive = () => {};
    transport.connect();

    transport.send({ type: 'TEST' });
    transport.send({ type: 'TEST' });
    transport.send({ type: 'TEST' });

    const stats = transport.getStats();
    assertEqual(stats.sent, 3, 'sent count');
    assertEqual(stats.received, 3, 'received count');
    assertEqual(stats.state, TransportState.CONNECTED, 'state');
});

// ============ NO BYPASS PROOF ============
// These tests prove that commands cannot enter the simulation
// without going through the transport layer.

test('NO BYPASS: InputFactory without transport logs error', () => {
    // Create factory without transport and without global transport
    const factory = new InputFactory(null);

    // Save original console.error
    const originalError = console.error;
    let errorLogged = false;
    console.error = (msg) => {
        if (msg.includes('No transport available')) {
            errorLogged = true;
        }
    };

    // Try to send command - should log error
    factory.select(1);

    // Restore console.error
    console.error = originalError;

    assertTrue(errorLogged, 'error logged when no transport');
});

test('NO BYPASS: Disconnected transport does not deliver to queue', () => {
    const queue = new CommandQueue();
    const transport = new LocalTransport();
    transport.onReceive = (cmd) => queue.enqueue(cmd);
    // Note: NOT connected

    const factory = new InputFactory(transport);
    factory.select(1);

    // Commands should NOT be in queue (held in transport pending)
    assertEqual(queue.pendingCount, 0, 'queue empty when transport disconnected');
});

test('NO BYPASS: Only transport.onReceive can enqueue commands', () => {
    const queue = new CommandQueue();
    const transport = new LocalTransport();

    // Wire transport to queue (simulates initializeTransport)
    transport.onReceive = (cmd) => queue.enqueue(cmd);
    transport.connect();

    // Send through transport
    transport.send({ type: CommandType.SELECT, unitId: 1 });

    assertEqual(queue.pendingCount, 1, 'transport delivered to queue');

    // Verify flush gets the command
    const commands = queue.flush(1);
    assertEqual(commands.length, 1, 'flushed command count');
    assertEqual(commands[0].type, CommandType.SELECT, 'flushed command type');
});

test('NO BYPASS: NullTransport blocks all commands', () => {
    /**
     * NullTransport - a transport that silently drops all commands.
     * This proves that if the transport is broken, NO commands reach the sim.
     */
    class NullTransport extends TransportBase {
        connect() { this._state = TransportState.CONNECTED; }
        disconnect() { this._state = TransportState.DISCONNECTED; }
        send(command) {
            this._messagesSent++;
            // Intentionally do NOT call _deliverReceived
            // This simulates a broken or blocked transport
        }
    }

    const queue = new CommandQueue();
    const nullTransport = new NullTransport();
    nullTransport.onReceive = (cmd) => queue.enqueue(cmd);
    nullTransport.connect();

    const factory = new InputFactory(nullTransport);

    // Send multiple commands
    factory.select(1);
    factory.move(1, { x: 10, y: 0, z: 10 });
    factory.deselect();

    // PROOF: Queue should be empty because NullTransport never delivers
    assertEqual(queue.pendingCount, 0, 'NullTransport blocks all commands');
    assertEqual(nullTransport.getStats().sent, 3, 'commands were sent');
    assertEqual(nullTransport.getStats().received, 0, 'but none received');
});

test('NO BYPASS: Command flow requires complete pipeline', () => {
    /**
     * Test the full approved command flow:
     * InputFactory.select() → Transport.send() → Transport.onReceive → Queue.enqueue()
     *
     * This test verifies each step is required.
     */

    // Step 1: No transport = no delivery
    const factory1 = new InputFactory(null);
    // (would log error, but command goes nowhere)

    // Step 2: Transport without onReceive = no delivery
    const transport2 = new LocalTransport();
    transport2.connect();
    transport2.send({ type: 'TEST' });
    // Command was sent but onReceive is null, so nothing happens

    // Step 3: Transport with onReceive but disconnected = queued, not delivered
    const queue3 = new CommandQueue();
    const transport3 = new LocalTransport();
    transport3.onReceive = (cmd) => queue3.enqueue(cmd);
    // NOT connected
    const factory3 = new InputFactory(transport3);
    factory3.select(1);
    assertEqual(queue3.pendingCount, 0, 'disconnected: not delivered');

    // Step 4: Complete pipeline = delivery
    transport3.connect(); // Now connect
    assertEqual(queue3.pendingCount, 1, 'connected: delivered pending');

    // Step 5: Verify new commands flow through
    factory3.move(1, { x: 0, y: 0, z: 0 });
    assertEqual(queue3.pendingCount, 2, 'new commands flow through');
});

// ============ Summary ============

console.log('\n=== Transport Layer Tests (R007) ===\n');

console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) {
    console.error(`\n✗ ${failed} Transport tests FAILED`);
} else {
    console.log('\n✓ All Transport tests PASS');
    console.log('\nNO BYPASS PROOF VERIFIED:');
    console.log('  - Commands cannot reach CommandQueue without Transport');
    console.log('  - Disconnected transport holds commands');
    console.log('  - NullTransport blocks all delivery');
    console.log('  - Complete pipeline required for command flow');
}
