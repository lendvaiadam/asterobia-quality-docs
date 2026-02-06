/**
 * M07: CMD_BATCH Unit Tests
 *
 * Tests for _handleCmdBatch() and sendCmdBatch() functionality.
 * Reference: docs/specs/R013_M07_GAME_LOOP.md
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionManager } from '../multiplayer/SessionManager.js';
import { SessionState } from '../multiplayer/SessionState.js';
import { NetworkRole } from '../multiplayer/NetworkRole.js';
import { globalCommandQueue } from '../runtime/CommandQueue.js';

// Mock game object
function createMockGame() {
  return {
    clientId: 'test-client-id',
    playerName: 'TestPlayer',
    mapSeed: 'test-seed',
    _isDevMode: false,
    simLoop: {
      tickCount: 100
    },
    stateSurface: {
      serialize: () => ({ units: [], tickCount: 100 }),
      deserialize: vi.fn()
    }
  };
}

// Mock transport
function createMockTransport() {
  return {
    joinChannel: vi.fn().mockResolvedValue(true),
    leaveChannel: vi.fn().mockResolvedValue(true),
    broadcastToChannel: vi.fn().mockResolvedValue(true),
    onMessage: vi.fn()
  };
}

describe('SessionManager CMD_BATCH (M07)', () => {
  let sessionManager;
  let mockGame;
  let mockTransport;

  beforeEach(() => {
    mockGame = createMockGame();
    mockTransport = createMockTransport();

    sessionManager = new SessionManager(mockGame);
    sessionManager.setTransport(mockTransport);

    // Reset command queue
    globalCommandQueue.reset();
  });

  describe('_handleCmdBatch (Guest-side)', () => {
    beforeEach(() => {
      // Set as GUEST
      sessionManager.state.role = NetworkRole.GUEST;
      sessionManager.state.hostId = 'host-123';
      sessionManager._lastReceivedBatchSeq = -1;
    });

    it('should enqueue commands from valid CMD_BATCH', () => {
      const msg = {
        type: 'CMD_BATCH',
        batchSeq: 0,
        simTick: 100,
        scheduledTick: 102,
        commands: [
          { id: 'cmd-1', slot: 0, seq: 1, command: { type: 'MOVE', unitId: 1 } },
          { id: 'cmd-2', slot: 1, seq: 2, command: { type: 'MOVE', unitId: 2 } }
        ],
        stateHash: null,
        timestamp: Date.now()
      };

      sessionManager._handleCmdBatch(msg);

      expect(sessionManager._debugCounters.batchRecvCount).toBe(1);
      expect(sessionManager._debugCounters.cmdEnqueuedCount).toBe(2);
      expect(globalCommandQueue.pendingCount).toBe(2);
    });

    it('should drop duplicate batchSeq (idempotency)', () => {
      sessionManager._lastReceivedBatchSeq = 5;

      const msg = {
        type: 'CMD_BATCH',
        batchSeq: 5, // Duplicate
        simTick: 100,
        scheduledTick: 102,
        commands: [{ id: 'cmd-1', slot: 0, seq: 1, command: { type: 'MOVE' } }],
        stateHash: null,
        timestamp: Date.now()
      };

      sessionManager._handleCmdBatch(msg);

      expect(sessionManager._debugCounters.batchDropDupCount).toBe(1);
      expect(sessionManager._debugCounters.batchRecvCount).toBe(0);
      expect(globalCommandQueue.pendingCount).toBe(0);
    });

    it('should drop stale scheduledTick', () => {
      mockGame.simLoop.tickCount = 105; // Current tick is past scheduledTick

      const msg = {
        type: 'CMD_BATCH',
        batchSeq: 0,
        simTick: 100,
        scheduledTick: 102, // Already past
        commands: [{ id: 'cmd-1', slot: 0, seq: 1, command: { type: 'MOVE' } }],
        stateHash: null,
        timestamp: Date.now()
      };

      sessionManager._handleCmdBatch(msg);

      expect(sessionManager._debugCounters.batchDropStaleCount).toBe(1);
      expect(sessionManager._debugCounters.batchRecvCount).toBe(0);
    });

    it('should warn but process on gap in batchSeq', () => {
      sessionManager._lastReceivedBatchSeq = 5;
      const consoleSpy = vi.spyOn(console, 'warn');

      const msg = {
        type: 'CMD_BATCH',
        batchSeq: 8, // Gap: expected 6, got 8
        simTick: 100,
        scheduledTick: 102,
        commands: [{ id: 'cmd-1', slot: 0, seq: 1, command: { type: 'MOVE' } }],
        stateHash: null,
        timestamp: Date.now()
      };

      sessionManager._handleCmdBatch(msg);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('gap detected')
      );
      expect(sessionManager._debugCounters.batchRecvCount).toBe(1); // Still processed
      expect(sessionManager._lastReceivedBatchSeq).toBe(8);

      consoleSpy.mockRestore();
    });

    it('should not process CMD_BATCH when HOST', () => {
      sessionManager.state.role = NetworkRole.HOST;

      const msg = {
        type: 'CMD_BATCH',
        batchSeq: 0,
        simTick: 100,
        scheduledTick: 102,
        commands: [{ id: 'cmd-1', slot: 0, seq: 1, command: { type: 'MOVE' } }],
        stateHash: null,
        timestamp: Date.now()
      };

      sessionManager._handleCmdBatch(msg);

      expect(sessionManager._debugCounters.batchRecvCount).toBe(0);
    });

    it('should preserve Host-assigned command IDs', () => {
      const msg = {
        type: 'CMD_BATCH',
        batchSeq: 0,
        simTick: 100,
        scheduledTick: 102,
        commands: [
          { id: 'host-cmd-123', slot: 0, seq: 42, command: { type: 'MOVE', unitId: 1 } }
        ],
        stateHash: null,
        timestamp: Date.now()
      };

      sessionManager._handleCmdBatch(msg);

      const pending = globalCommandQueue.getPending();
      expect(pending[0].id).toBe('host-cmd-123');
      expect(pending[0].seq).toBe(42);
    });

    it('should drop batch if Queue Limit Exceeded (GAP-3)', () => {
       // Fill queue to limit (200)
       // We can just spy on pendingCount if we can't easily push 200 items,
       // but GlobalCommandQueue is real. Let's push 200 dummy items.
       for (let i = 0; i < 200; i++) {
           globalCommandQueue.enqueue({ type: 'MOVE' });
       }
       expect(globalCommandQueue.pendingCount).toBe(200);

       const msg = {
        type: 'CMD_BATCH',
        batchSeq: 0,
        simTick: 100,
        scheduledTick: 102,
        commands: [{ id: 'fail', command: { type: 'MOVE' } }], // 1 more
        timestamp: Date.now()
       };

       sessionManager._handleCmdBatch(msg);

       expect(sessionManager._debugCounters.batchDroppedQueueFull).toBe(1);
       expect(globalCommandQueue.pendingCount).toBe(200); // Should not increase
    });
  });

  describe('sendCmdBatch (Host-side)', () => {
    beforeEach(async () => {
      // Set as HOST with session channel
      sessionManager.state.role = NetworkRole.HOST;
      sessionManager.state.hostId = mockGame.clientId;
      sessionManager._sessionChannel = `asterobia:session:${mockGame.clientId}`;
    });

    it('should send CMD_BATCH with buffered commands', async () => {
      sessionManager.bufferInputCmd({
        slot: 0,
        seq: 1,
        command: { type: 'MOVE', unitId: 1 }
      });
      sessionManager.bufferInputCmd({
        slot: 1,
        seq: 2,
        command: { type: 'MOVE', unitId: 2 }
      });

      await sessionManager.sendCmdBatch();

      expect(mockTransport.broadcastToChannel).toHaveBeenCalled();
      const [channel, msg] = mockTransport.broadcastToChannel.mock.calls[0];
      expect(channel).toBe(sessionManager._sessionChannel);
      expect(msg.type).toBe('CMD_BATCH');
      expect(msg.batchSeq).toBe(0);
      expect(msg.simTick).toBe(100);
      expect(msg.scheduledTick).toBe(102); // simTick + 2
      expect(msg.commands.length).toBe(2);
    });

    it('should increment batchSeq monotonically', async () => {
      sessionManager.bufferInputCmd({ slot: 0, seq: 1, command: { type: 'MOVE' } });
      await sessionManager.sendCmdBatch();

      sessionManager.bufferInputCmd({ slot: 0, seq: 2, command: { type: 'MOVE' } });
      await sessionManager.sendCmdBatch();

      sessionManager.bufferInputCmd({ slot: 0, seq: 3, command: { type: 'MOVE' } });
      await sessionManager.sendCmdBatch();

      const calls = mockTransport.broadcastToChannel.mock.calls;
      expect(calls[0][1].batchSeq).toBe(0);
      expect(calls[1][1].batchSeq).toBe(1);
      expect(calls[2][1].batchSeq).toBe(2);
    });

    it('should clear inputBuffer after successful send', async () => {
      sessionManager.bufferInputCmd({ slot: 0, seq: 1, command: { type: 'MOVE' } });
      expect(sessionManager.inputBuffer.length).toBe(1);

      await sessionManager.sendCmdBatch();

      expect(sessionManager.inputBuffer.length).toBe(0);
    });

    it('should skip sending when inputBuffer is empty', async () => {
      await sessionManager.sendCmdBatch();

      expect(mockTransport.broadcastToChannel).not.toHaveBeenCalled();
    });

    it('should not send when not HOST', async () => {
      sessionManager.state.role = NetworkRole.GUEST;
      sessionManager.bufferInputCmd({ slot: 0, seq: 1, command: { type: 'MOVE' } });

      await sessionManager.sendCmdBatch();

      expect(mockTransport.broadcastToChannel).not.toHaveBeenCalled();
    });

    it('should update debug counters on send', async () => {
      sessionManager.bufferInputCmd({ slot: 0, seq: 1, command: { type: 'MOVE' } });
      await sessionManager.sendCmdBatch();

      expect(sessionManager._debugCounters.batchSentCount).toBe(1);
    });

    it('should truncate batch if MAX_COMMANDS_PER_BATCH exceeded (GAP-3)', async () => {
        // Buffer 55 commands (Limit is 50)
        for (let i=0; i<55; i++) {
            sessionManager.bufferInputCmd({ slot: 0, seq: i, command: { type: 'MOVE' } });
        }

        await sessionManager.sendCmdBatch();

        expect(sessionManager._debugCounters.batchTruncatedCount).toBe(1);
        expect(sessionManager._debugCounters.batchSentCount).toBe(1); // Sent 1 batch

        const calls = mockTransport.broadcastToChannel.mock.calls;
        expect(calls[0][1].commands.length).toBe(50); // Truncated to 50
        
        // Remaining 5 should remain in buffer? 
        // Logic implemented: "If we truncated... slice(cmdsToSend.length)"
        // Since we sliced to 50, we remove 50. 5 remain.
        expect(sessionManager.inputBuffer.length).toBe(5);
    });
  });

  describe('getDebugNetStatus', () => {
    it('should return all debug counters', () => {
      sessionManager.state.role = NetworkRole.HOST;
      sessionManager._batchSeqCounter = 5;
      sessionManager._lastReceivedBatchSeq = 3;
      sessionManager._debugCounters.batchSentCount = 10;
      sessionManager._debugCounters.batchRecvCount = 8;

      const status = sessionManager.getDebugNetStatus();

      expect(status.role).toBe(NetworkRole.HOST);
      expect(status.batchSeqCounter).toBe(5);
      expect(status.lastReceivedBatchSeq).toBe(3);
      expect(status.batchSentCount).toBe(10);
      expect(status.batchRecvCount).toBe(8);
      expect(status.queuePendingCount).toBe(0);
    });
  });
});
