/**
 * M07: CommandQueue Host ID Preservation Tests
 *
 * Tests that CommandQueue preserves Host-assigned IDs when present,
 * and generates local IDs when not.
 *
 * Reference: docs/specs/R013_M07_GAME_LOOP.md
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CommandQueue, globalCommandQueue } from '../runtime/CommandQueue.js';

describe('CommandQueue Host ID Preservation (M07)', () => {
  let queue;

  beforeEach(() => {
    queue = new CommandQueue();
  });

  describe('ID Preservation', () => {
    it('should preserve existing id when present', () => {
      const cmd = {
        type: 'MOVE',
        id: 'host-assigned-id-123',
        unitId: 1
      };

      const stamped = queue.enqueue(cmd);

      expect(stamped.id).toBe('host-assigned-id-123');
    });

    it('should generate local id when not present', () => {
      const cmd = {
        type: 'MOVE',
        unitId: 1
        // No id field
      };

      const stamped = queue.enqueue(cmd);

      expect(stamped.id).toMatch(/^icmd_\d+$/);
    });

    it('should preserve existing seq when present', () => {
      const cmd = {
        type: 'MOVE',
        id: 'host-cmd',
        seq: 42,
        unitId: 1
      };

      const stamped = queue.enqueue(cmd);

      expect(stamped.seq).toBe(42);
    });

    it('should generate local seq when not present', () => {
      const cmd1 = { type: 'MOVE', unitId: 1 };
      const cmd2 = { type: 'MOVE', unitId: 2 };

      const stamped1 = queue.enqueue(cmd1);
      const stamped2 = queue.enqueue(cmd2);

      expect(stamped1.seq).toBe(0);
      expect(stamped2.seq).toBe(1);
    });

    it('should preserve seq=0 when explicitly set', () => {
      const cmd = {
        type: 'MOVE',
        seq: 0, // Explicitly set to 0
        unitId: 1
      };

      const stamped = queue.enqueue(cmd);

      // Using ?? should preserve 0
      expect(stamped.seq).toBe(0);
    });
  });

  describe('scheduledTick Support', () => {
    it('should store scheduledTick when provided', () => {
      const cmd = { type: 'MOVE', unitId: 1 };

      const stamped = queue.enqueue(cmd, 105);

      expect(stamped.scheduledTick).toBe(105);
    });

    it('should default scheduledTick to null', () => {
      const cmd = { type: 'MOVE', unitId: 1 };

      const stamped = queue.enqueue(cmd);

      expect(stamped.scheduledTick).toBeNull();
    });

    it('should flush only commands with scheduledTick <= currentTick', () => {
      queue.enqueue({ type: 'A', id: 'a' }, 100);
      queue.enqueue({ type: 'B', id: 'b' }, 102);
      queue.enqueue({ type: 'C', id: 'c' }, 105);
      queue.enqueue({ type: 'D', id: 'd' }, null); // Immediate

      const flushed = queue.flush(102);

      expect(flushed.map(c => c.id)).toEqual(['a', 'b', 'd']);
      expect(queue.pendingCount).toBe(1); // 'c' still pending
    });
  });

  describe('Host Command Flow', () => {
    it('should handle typical Host CMD_BATCH flow', () => {
      // Simulate Host sending batch with assigned IDs
      const hostCommands = [
        { id: 'batch_5_cmd_0', seq: 100, slot: 0, type: 'MOVE', unitId: 1 },
        { id: 'batch_5_cmd_1', seq: 101, slot: 1, type: 'MOVE', unitId: 2 },
        { id: 'batch_5_cmd_2', seq: 102, slot: 0, type: 'MOVE', unitId: 3 }
      ];

      const scheduledTick = 55;

      for (const cmd of hostCommands) {
        queue.enqueue(cmd, scheduledTick);
      }

      expect(queue.pendingCount).toBe(3);

      // Flush at scheduled tick
      const flushed = queue.flush(55);

      expect(flushed.length).toBe(3);
      expect(flushed[0].id).toBe('batch_5_cmd_0');
      expect(flushed[0].seq).toBe(100);
      expect(flushed[1].id).toBe('batch_5_cmd_1');
      expect(flushed[2].id).toBe('batch_5_cmd_2');
    });

    it('should maintain order by seq after flush', () => {
      // Commands enqueued out of order
      queue.enqueue({ type: 'C', seq: 102 }, 50);
      queue.enqueue({ type: 'A', seq: 100 }, 50);
      queue.enqueue({ type: 'B', seq: 101 }, 50);

      const flushed = queue.flush(50);

      // Should be sorted by seq
      expect(flushed[0].seq).toBe(100);
      expect(flushed[1].seq).toBe(101);
      expect(flushed[2].seq).toBe(102);
    });
  });
});
