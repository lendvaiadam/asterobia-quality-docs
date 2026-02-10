/**
 * InputFactory & CommandQueue Tests
 *
 * R006: Verifies InputFactory produces deterministic commands.
 * R007: Tests updated to use transport layer architecture.
 * R013 M07: SELECT/DESELECT bypass transport (local-only UI commands).
 *
 * Run: npx vitest run
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CommandQueue, CommandType, globalCommandQueue } from '../runtime/CommandQueue.js';
import { InputFactory } from '../runtime/InputFactory.js';
import { LocalTransport } from '../transport/LocalTransport.js';
import { resetEntityIdCounter } from '../runtime/IdGenerator.js';

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

describe('InputFactory & CommandQueue', () => {
    beforeEach(() => {
        resetEntityIdCounter();
        globalCommandQueue.reset();
    });

    it('CommandQueue assigns sequence numbers', () => {
        const queue = new CommandQueue();
        const cmd1 = queue.enqueue({ type: 'TEST' });
        const cmd2 = queue.enqueue({ type: 'TEST' });

        expect(cmd1.seq).toBe(0);
        expect(cmd2.seq).toBe(1);
    });

    it('CommandQueue flush returns ordered commands', () => {
        const queue = new CommandQueue();
        queue.enqueue({ type: 'A' });
        queue.enqueue({ type: 'B' });
        queue.enqueue({ type: 'C' });

        const flushed = queue.flush(1);

        expect(flushed.length).toBe(3);
        expect(flushed[0].type).toBe('A');
        expect(flushed[1].type).toBe('B');
        expect(flushed[2].type).toBe('C');
    });

    it('CommandQueue flush clears pending', () => {
        const queue = new CommandQueue();
        queue.enqueue({ type: 'TEST' });
        queue.flush(1);

        expect(queue.pendingCount).toBe(0);
        expect(queue.historyCount).toBe(1);
    });

    // R013 M07: SELECT bypasses transport, goes directly to globalCommandQueue
    it('InputFactory SELECT goes to globalCommandQueue (local-only)', () => {
        const { transport, queue } = createTestTransportWithQueue();
        const factory = new InputFactory(transport);

        const cmd = factory.select(42, { skipCamera: true });

        expect(cmd.type).toBe(CommandType.SELECT);
        expect(cmd.unitId).toBe(42);
        expect(cmd.skipCamera).toBe(true);

        // SELECT bypasses transport, goes to globalCommandQueue
        expect(queue.pendingCount).toBe(0);
        expect(globalCommandQueue.pendingCount).toBe(1);
    });

    // R013 M07: DESELECT also bypasses transport
    it('InputFactory DESELECT goes to globalCommandQueue (local-only)', () => {
        const { transport, queue } = createTestTransportWithQueue();
        const factory = new InputFactory(transport);

        const cmd = factory.deselect();

        expect(cmd.type).toBe(CommandType.DESELECT);
        expect(queue.pendingCount).toBe(0);
        expect(globalCommandQueue.pendingCount).toBe(1);
    });

    it('InputFactory creates MOVE command via transport', () => {
        const { transport, queue } = createTestTransportWithQueue();
        const factory = new InputFactory(transport);

        const cmd = factory.move(1, { x: 10, y: 5, z: 20 });

        expect(cmd.type).toBe(CommandType.MOVE);
        expect(cmd.unitId).toBe(1);
        expect(cmd.position.x).toBe(10);
        expect(cmd.position.y).toBe(5);
        expect(cmd.position.z).toBe(20);
        expect(queue.pendingCount).toBe(1);
    });

    it('Commands have deterministic IDs', () => {
        // Use MOVE commands (which go through transport) for deterministic ID test
        resetEntityIdCounter();
        const { transport: t1, queue: q1 } = createTestTransportWithQueue();
        const factory1 = new InputFactory(t1);

        factory1.move(1, { x: 0, y: 0, z: 0 });
        factory1.move(2, { x: 1, y: 0, z: 1 });

        resetEntityIdCounter();
        const { transport: t2, queue: q2 } = createTestTransportWithQueue();
        const factory2 = new InputFactory(t2);

        factory2.move(1, { x: 0, y: 0, z: 0 });
        factory2.move(2, { x: 1, y: 0, z: 1 });

        // Commands should have deterministic sequence numbers from queue
        const flushed1 = q1.flush(1);
        const flushed2 = q2.flush(1);

        expect(flushed1[0].seq).toBe(flushed2[0].seq);
        expect(flushed1[1].seq).toBe(flushed2[1].seq);
    });

    it('InputFactory creates SET_PATH command via transport', () => {
        const { transport, queue } = createTestTransportWithQueue();
        const factory = new InputFactory(transport);

        const points = [
            { x: 0, y: 0, z: 0 },
            { x: 10, y: 0, z: 10 },
            { x: 20, y: 0, z: 0 }
        ];

        const cmd = factory.setPath(1, points);

        expect(cmd.type).toBe(CommandType.SET_PATH);
        expect(cmd.points.length).toBe(3);
        expect(cmd.points[1].x).toBe(10);
        expect(queue.pendingCount).toBe(1);
    });

    it('Transport must be connected for delivery (MOVE)', () => {
        const queue = new CommandQueue();
        const transport = new LocalTransport();
        transport.onReceive = (cmd) => queue.enqueue(cmd);
        // Note: NOT calling transport.connect() yet

        const factory = new InputFactory(transport);
        // Use MOVE (transport-routed) instead of SELECT (local-only)
        factory.move(1, { x: 0, y: 0, z: 0 });

        // Command should be queued in transport's pending, not delivered yet
        expect(queue.pendingCount).toBe(0);

        // Now connect - should flush pending
        transport.connect();
        expect(queue.pendingCount).toBe(1);
    });
});
