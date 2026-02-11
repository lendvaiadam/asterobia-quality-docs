/**
 * messageSerializer.test.js - Unit tests for MessageSerializer
 *
 * Tests: R013-M01 Message Types & Serializer
 * Reference: docs/work_orders/WO-R013-M01.md
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MSG,
  PROTOCOL_VERSION,
  MESSAGE_SCHEMAS,
  VALID_MESSAGE_TYPES
} from '../multiplayer/MessageTypes.js';
import {
  encode,
  decode,
  validateMessage,
  MessageValidationError,
  createHello,
  createHostAnnounce,
  createJoinReq,
  createJoinAckAccepted,
  createJoinAckRejected,
  createInputCmd,
  createCmdBatch,
  createSnapshot,
  createResyncReq,
  createResyncAck,
  createPing,
  createPong
} from '../multiplayer/MessageSerializer.js';

describe('MessageTypes', () => {
  it('exports all 20 message types', () => {
    expect(Object.keys(MSG)).toHaveLength(20);
    expect(MSG.HELLO).toBe('HELLO');
    expect(MSG.HOST_ANNOUNCE).toBe('HOST_ANNOUNCE');
    expect(MSG.JOIN_REQ).toBe('JOIN_REQ');
    expect(MSG.JOIN_ACK).toBe('JOIN_ACK');
    expect(MSG.INPUT_CMD).toBe('INPUT_CMD');
    expect(MSG.CMD_BATCH).toBe('CMD_BATCH');
    expect(MSG.SNAPSHOT).toBe('SNAPSHOT');
    expect(MSG.RESYNC_REQ).toBe('RESYNC_REQ');
    expect(MSG.RESYNC_ACK).toBe('RESYNC_ACK');
    expect(MSG.PING).toBe('PING');
    expect(MSG.PONG).toBe('PONG');
    expect(MSG.SEAT_REQ).toBe('SEAT_REQ');
    expect(MSG.SEAT_ACK).toBe('SEAT_ACK');
    expect(MSG.SEAT_REJECT).toBe('SEAT_REJECT');
    expect(MSG.SEAT_RELEASE).toBe('SEAT_RELEASE');
    expect(MSG.HOST_LEAVE).toBe('HOST_LEAVE');
    expect(MSG.GUEST_LEAVE).toBe('GUEST_LEAVE');
    expect(MSG.POSITION_SYNC).toBe('POSITION_SYNC');
    // Phase 2A: Server authority messages
    expect(MSG.SERVER_SNAPSHOT).toBe('SERVER_SNAPSHOT');
    expect(MSG.MOVE_INPUT).toBe('MOVE_INPUT');
  });

  it('exports frozen MSG object', () => {
    expect(Object.isFrozen(MSG)).toBe(true);
  });

  it('exports protocol version', () => {
    expect(PROTOCOL_VERSION).toBe('0.13.0');
  });

  it('has schemas for all message types', () => {
    for (const type of Object.values(MSG)) {
      expect(MESSAGE_SCHEMAS[type]).toBeDefined();
      expect(Array.isArray(MESSAGE_SCHEMAS[type])).toBe(true);
    }
  });
});

describe('MessageSerializer - encode/decode round-trip', () => {
  it('HELLO round-trip', () => {
    const original = createHello('client-123');
    const encoded = encode(original);
    const decoded = decode(encoded);

    expect(decoded.type).toBe(MSG.HELLO);
    expect(decoded.clientId).toBe('client-123');
    expect(decoded.protocolVersion).toBe('0.13.0');
    expect(typeof decoded.timestamp).toBe('number');
  });

  it('HOST_ANNOUNCE round-trip', () => {
    const original = createHostAnnounce({
      hostId: 'host-abc',
      sessionName: 'Test Game',
      mapSeed: 'seed-12345',
      simTick: 100,
      currentPlayers: 1,
      maxPlayers: 4
    });
    const encoded = encode(original);
    const decoded = decode(encoded);

    expect(decoded.type).toBe(MSG.HOST_ANNOUNCE);
    expect(decoded.hostId).toBe('host-abc');
    expect(decoded.sessionName).toBe('Test Game');
    expect(decoded.mapSeed).toBe('seed-12345');
    expect(decoded.simTick).toBe(100);
    expect(decoded.currentPlayers).toBe(1);
    expect(decoded.maxPlayers).toBe(4);
  });

  it('JOIN_REQ round-trip', () => {
    const original = createJoinReq({
      guestId: 'guest-xyz',
      displayName: 'Player2'
    });
    const encoded = encode(original);
    const decoded = decode(encoded);

    expect(decoded.type).toBe(MSG.JOIN_REQ);
    expect(decoded.guestId).toBe('guest-xyz');
    expect(decoded.displayName).toBe('Player2');
  });

  it('JOIN_ACK (accepted) round-trip', () => {
    const snapshot = { meta: { simTick: 50 }, units: [] };
    const original = createJoinAckAccepted({
      assignedSlot: 1,
      simTick: 50,
      fullSnapshot: snapshot
    });
    const encoded = encode(original);
    const decoded = decode(encoded);

    expect(decoded.type).toBe(MSG.JOIN_ACK);
    expect(decoded.accepted).toBe(true);
    expect(decoded.assignedSlot).toBe(1);
    expect(decoded.simTick).toBe(50);
    expect(decoded.fullSnapshot).toEqual(snapshot);
  });

  it('JOIN_ACK (rejected) round-trip', () => {
    const original = createJoinAckRejected('SESSION_FULL');
    const encoded = encode(original);
    const decoded = decode(encoded);

    expect(decoded.type).toBe(MSG.JOIN_ACK);
    expect(decoded.accepted).toBe(false);
    expect(decoded.rejectReason).toBe('SESSION_FULL');
    expect(decoded.assignedSlot).toBeNull();
  });

  it('INPUT_CMD round-trip', () => {
    const command = { action: 'MOVE', entityId: 42, target: { x: 100, y: 200 } };
    const original = createInputCmd({
      senderId: 'sender-1',
      slot: 1,
      seq: 47,
      command
    });
    const encoded = encode(original);
    const decoded = decode(encoded);

    expect(decoded.type).toBe(MSG.INPUT_CMD);
    expect(decoded.senderId).toBe('sender-1');
    expect(decoded.slot).toBe(1);
    expect(decoded.seq).toBe(47);
    expect(decoded.command).toEqual(command);
  });

  it('CMD_BATCH round-trip', () => {
    const commands = [
      { slot: 0, seq: 10, command: { action: 'MOVE' } },
      { slot: 1, seq: 47, command: { action: 'STOP' } }
    ];
    const original = createCmdBatch({ simTick: 1043, commands, batchSeq: 5, scheduledTick: 1045 });
    const encoded = encode(original);
    const decoded = decode(encoded);

    expect(decoded.type).toBe(MSG.CMD_BATCH);
    expect(decoded.simTick).toBe(1043);
    expect(decoded.batchSeq).toBe(5);
    expect(decoded.scheduledTick).toBe(1045);
    expect(decoded.commands).toEqual(commands);
  });

  it('SNAPSHOT round-trip', () => {
    const state = { meta: { simTick: 200 }, units: [{ id: 1 }] };
    const original = createSnapshot({
      simTick: 200,
      stateHash: 'abc123',
      state
    });
    const encoded = encode(original);
    const decoded = decode(encoded);

    expect(decoded.type).toBe(MSG.SNAPSHOT);
    expect(decoded.simTick).toBe(200);
    expect(decoded.stateHash).toBe('abc123');
    expect(decoded.state).toEqual(state);
  });

  it('RESYNC_REQ round-trip', () => {
    const original = createResyncReq({
      guestId: 'guest-1',
      lastKnownTick: 100,
      reason: 'RECONNECT'
    });
    const encoded = encode(original);
    const decoded = decode(encoded);

    expect(decoded.type).toBe(MSG.RESYNC_REQ);
    expect(decoded.guestId).toBe('guest-1');
    expect(decoded.lastKnownTick).toBe(100);
    expect(decoded.reason).toBe('RECONNECT');
  });

  it('RESYNC_ACK round-trip', () => {
    const snapshot = { meta: { simTick: 150 } };
    const commandLog = [{ tick: 101, commands: [] }];
    const original = createResyncAck({
      simTick: 150,
      fullSnapshot: snapshot,
      commandLog
    });
    const encoded = encode(original);
    const decoded = decode(encoded);

    expect(decoded.type).toBe(MSG.RESYNC_ACK);
    expect(decoded.simTick).toBe(150);
    expect(decoded.fullSnapshot).toEqual(snapshot);
    expect(decoded.commandLog).toEqual(commandLog);
  });

  it('PING round-trip', () => {
    const original = createPing({ senderId: 'client-1', seq: 5 });
    const encoded = encode(original);
    const decoded = decode(encoded);

    expect(decoded.type).toBe(MSG.PING);
    expect(decoded.senderId).toBe('client-1');
    expect(decoded.seq).toBe(5);
  });

  it('PONG round-trip', () => {
    const original = createPong({
      responderId: 'host-1',
      pingSeq: 5,
      originalTimestamp: 1706700000000
    });
    const encoded = encode(original);
    const decoded = decode(encoded);

    expect(decoded.type).toBe(MSG.PONG);
    expect(decoded.responderId).toBe('host-1');
    expect(decoded.pingSeq).toBe(5);
    expect(decoded.originalTimestamp).toBe(1706700000000);
  });
});

describe('MessageSerializer - validation', () => {
  it('rejects null message', () => {
    const result = validateMessage(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Message must be a non-null object');
  });

  it('rejects non-object message', () => {
    const result = validateMessage('string');
    expect(result.valid).toBe(false);
  });

  it('rejects message without type', () => {
    const result = validateMessage({ foo: 'bar' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Message missing required "type" field');
  });

  it('rejects unknown message type', () => {
    const result = validateMessage({ type: 'UNKNOWN_TYPE' });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Unknown message type');
  });

  it('rejects message with missing required fields', () => {
    const result = validateMessage({ type: MSG.HELLO }); // missing clientId, protocolVersion, timestamp
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects message with wrong field types', () => {
    const msg = {
      type: MSG.INPUT_CMD,
      senderId: 'sender',
      slot: 'not-a-number', // should be number
      seq: 1,
      command: {},
      timestamp: Date.now()
    };
    const result = validateMessage(msg);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('slot must be a number');
  });

  it('validates correct JOIN_ACK (accepted)', () => {
    const msg = createJoinAckAccepted({
      assignedSlot: 1,
      simTick: 100,
      fullSnapshot: { meta: {} }
    });
    const result = validateMessage(msg);
    expect(result.valid).toBe(true);
  });

  it('validates correct JOIN_ACK (rejected)', () => {
    const msg = createJoinAckRejected('SESSION_FULL');
    const result = validateMessage(msg);
    expect(result.valid).toBe(true);
  });
});

describe('MessageSerializer - encode errors', () => {
  it('throws MessageValidationError for invalid message', () => {
    expect(() => {
      encode({ type: MSG.HELLO }); // missing fields
    }).toThrow(MessageValidationError);
  });

  it('includes error details in exception', () => {
    try {
      encode({ type: MSG.HELLO });
    } catch (e) {
      expect(e.name).toBe('MessageValidationError');
      expect(e.details.errors).toBeDefined();
      expect(e.details.errors.length).toBeGreaterThan(0);
    }
  });

  it('allows skipping validation', () => {
    const msg = { type: MSG.HELLO }; // invalid but we skip validation
    const encoded = encode(msg, false);
    expect(typeof encoded).toBe('string');
  });
});

describe('MessageSerializer - decode errors', () => {
  it('throws MessageValidationError for invalid JSON', () => {
    expect(() => {
      decode('not valid json');
    }).toThrow(MessageValidationError);
  });

  it('throws MessageValidationError for invalid message structure', () => {
    const invalidJson = JSON.stringify({ type: MSG.HELLO }); // missing fields
    expect(() => {
      decode(invalidJson);
    }).toThrow(MessageValidationError);
  });

  it('allows skipping validation on decode', () => {
    const invalidJson = JSON.stringify({ type: MSG.HELLO });
    const decoded = decode(invalidJson, false);
    expect(decoded.type).toBe(MSG.HELLO);
  });
});

describe('MessageSerializer - handle missing optional fields', () => {
  it('JOIN_ACK rejected can have null optional fields', () => {
    const msg = {
      type: MSG.JOIN_ACK,
      accepted: false,
      rejectReason: 'BANNED',
      assignedSlot: null,
      simTick: null,
      fullSnapshot: null,
      timestamp: Date.now()
    };
    const result = validateMessage(msg);
    expect(result.valid).toBe(true);
  });

  it('RESYNC_ACK commandLog is optional', () => {
    const msg = createResyncAck({
      simTick: 100,
      fullSnapshot: { meta: {} }
      // commandLog omitted
    });
    const result = validateMessage(msg);
    expect(result.valid).toBe(true);
  });
});

describe('MessageSerializer - edge cases', () => {
  it('handles large snapshot payload', () => {
    const largeUnits = Array.from({ length: 100 }, (_, i) => ({
      id: i,
      position: { x: i * 10, y: i * 20 },
      stats: { health: 100, speed: 5 }
    }));
    const msg = createSnapshot({
      simTick: 1000,
      stateHash: 'hash123',
      state: { units: largeUnits }
    });

    const encoded = encode(msg);
    const decoded = decode(encoded);

    expect(decoded.state.units).toHaveLength(100);
  });

  it('handles empty commands array in CMD_BATCH', () => {
    const msg = createCmdBatch({ simTick: 50, commands: [], batchSeq: 1, scheduledTick: 52 });
    const result = validateMessage(msg);
    expect(result.valid).toBe(true);
  });

  it('handles deeply nested command object', () => {
    const msg = createInputCmd({
      senderId: 'sender',
      slot: 0,
      seq: 1,
      command: {
        action: 'COMPLEX',
        params: {
          nested: {
            deep: {
              value: 42
            }
          }
        }
      }
    });
    const encoded = encode(msg);
    const decoded = decode(encoded);
    expect(decoded.command.params.nested.deep.value).toBe(42);
  });
});
