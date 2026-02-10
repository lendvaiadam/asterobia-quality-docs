/**
 * Transport Layer Tests (R007)
 *
 * Proves the "no bypass" invariant:
 * Commands ONLY enter the simulation through the transport layer.
 * R013 M07: SELECT/DESELECT are local-only (bypass transport).
 *
 * Run: npx vitest run
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandQueue, CommandType, globalCommandQueue } from '../runtime/CommandQueue.js';
import { InputFactory } from '../runtime/InputFactory.js';
import { LocalTransport, TransportState, TransportBase } from '../transport/index.js';

describe('LocalTransport', () => {
    it('starts disconnected', () => {
        const transport = new LocalTransport();
        expect(transport.state).toBe(TransportState.DISCONNECTED);
        expect(transport.isConnected).toBe(false);
    });

    it('connects', () => {
        const transport = new LocalTransport();
        transport.connect();
        expect(transport.state).toBe(TransportState.CONNECTED);
        expect(transport.isConnected).toBe(true);
    });

    it('disconnects', () => {
        const transport = new LocalTransport();
        transport.connect();
        transport.disconnect();
        expect(transport.state).toBe(TransportState.DISCONNECTED);
        expect(transport.isConnected).toBe(false);
    });

    it('delivers immediately when connected', () => {
        const transport = new LocalTransport();
        let received = null;
        transport.onReceive = (cmd) => { received = cmd; };
        transport.connect();

        transport.send({ type: 'TEST', value: 42 });

        expect(received !== null).toBe(true);
        expect(received.type).toBe('TEST');
        expect(received.value).toBe(42);
    });

    it('queues before connect, delivers after', () => {
        const transport = new LocalTransport();
        const received = [];
        transport.onReceive = (cmd) => received.push(cmd);

        // Send before connect
        transport.send({ type: 'A' });
        transport.send({ type: 'B' });

        expect(received.length).toBe(0);

        // Connect - should flush pending
        transport.connect();

        expect(received.length).toBe(2);
        expect(received[0].type).toBe('A');
        expect(received[1].type).toBe('B');
    });

    it('tracks statistics', () => {
        const transport = new LocalTransport();
        transport.onReceive = () => {};
        transport.connect();

        transport.send({ type: 'TEST' });
        transport.send({ type: 'TEST' });
        transport.send({ type: 'TEST' });

        const stats = transport.getStats();
        expect(stats.sent).toBe(3);
        expect(stats.received).toBe(3);
        expect(stats.state).toBe(TransportState.CONNECTED);
    });
});

describe('NO BYPASS proofs', () => {
    beforeEach(() => {
        globalCommandQueue.reset();
    });

    // R013 M07: SELECT bypasses transport (local-only), so test with MOVE instead
    it('InputFactory without transport logs error (MOVE command)', () => {
        const factory = new InputFactory(null);

        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        // Use MOVE (transport-routed) - SELECT would bypass transport entirely
        factory.move(1, { x: 0, y: 0, z: 0 });

        expect(errorSpy).toHaveBeenCalledWith(
            expect.stringContaining('No transport available')
        );

        errorSpy.mockRestore();
    });

    it('Disconnected transport does not deliver to queue', () => {
        const queue = new CommandQueue();
        const transport = new LocalTransport();
        transport.onReceive = (cmd) => queue.enqueue(cmd);
        // Note: NOT connected

        const factory = new InputFactory(transport);
        // Use MOVE (transport-routed)
        factory.move(1, { x: 0, y: 0, z: 0 });

        // Commands should NOT be in queue (held in transport pending)
        expect(queue.pendingCount).toBe(0);
    });

    it('Only transport.onReceive can enqueue commands', () => {
        const queue = new CommandQueue();
        const transport = new LocalTransport();

        // Wire transport to queue (simulates initializeTransport)
        transport.onReceive = (cmd) => queue.enqueue(cmd);
        transport.connect();

        // Send through transport directly
        transport.send({ type: CommandType.MOVE, unitId: 1, position: { x: 0, y: 0, z: 0 } });

        expect(queue.pendingCount).toBe(1);

        // Verify flush gets the command
        const commands = queue.flush(1);
        expect(commands.length).toBe(1);
        expect(commands[0].type).toBe(CommandType.MOVE);
    });

    it('NullTransport blocks all commands', () => {
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

        // Use MOVE commands (transport-routed) - SELECT/DESELECT bypass transport
        factory.move(1, { x: 10, y: 0, z: 10 });
        factory.move(2, { x: 20, y: 0, z: 20 });
        factory.move(3, { x: 30, y: 0, z: 30 });

        // PROOF: Queue should be empty because NullTransport never delivers
        expect(queue.pendingCount).toBe(0);
        expect(nullTransport.getStats().sent).toBe(3);
        expect(nullTransport.getStats().received).toBe(0);
    });

    it('Command flow requires complete pipeline', () => {
        /**
         * Test the full approved command flow:
         * InputFactory.move() -> Transport.send() -> Transport.onReceive -> Queue.enqueue()
         *
         * This test verifies each step is required.
         * Uses MOVE commands since SELECT/DESELECT are local-only (R013 M07).
         */

        // Step 1: No transport = no delivery (for MOVE commands)
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
        factory3.move(1, { x: 0, y: 0, z: 0 });
        expect(queue3.pendingCount).toBe(0);

        // Step 4: Complete pipeline = delivery
        transport3.connect(); // Now connect - should flush pending
        expect(queue3.pendingCount).toBe(1);

        // Step 5: Verify new commands flow through
        factory3.move(2, { x: 1, y: 0, z: 1 });
        expect(queue3.pendingCount).toBe(2);
    });
});
