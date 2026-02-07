/**
 * MessageTypes.js - R013 Multiplayer Message Type Constants
 *
 * Defines all message types for Host-Guest communication.
 * Reference: docs/specs/R013_MULTIPLAYER_HANDSHAKE_HOST_AUTHORITY.md Section 4
 */

/**
 * Message type constants for multiplayer protocol
 */
export const MSG = Object.freeze({
  HELLO: 'HELLO',
  HOST_ANNOUNCE: 'HOST_ANNOUNCE',
  JOIN_REQ: 'JOIN_REQ',
  JOIN_ACK: 'JOIN_ACK',
  INPUT_CMD: 'INPUT_CMD',
  CMD_BATCH: 'CMD_BATCH',
  SNAPSHOT: 'SNAPSHOT',
  RESYNC_REQ: 'RESYNC_REQ',
  RESYNC_ACK: 'RESYNC_ACK',
  PING: 'PING',
  PONG: 'PONG',
  // M07 GAP-0: Seat acquisition messages
  SEAT_REQ: 'SEAT_REQ',
  SEAT_ACK: 'SEAT_ACK',
  SEAT_REJECT: 'SEAT_REJECT'
});

/**
 * Protocol version for compatibility checking
 */
export const PROTOCOL_VERSION = '0.13.0';

/**
 * Required fields per message type (for validation)
 */
export const MESSAGE_SCHEMAS = Object.freeze({
  [MSG.HELLO]: ['type', 'clientId', 'protocolVersion', 'timestamp'],

  [MSG.HOST_ANNOUNCE]: [
    'type', 'hostId', 'sessionName', 'mapSeed', 'simTick',
    'currentPlayers', 'maxPlayers', 'protocolVersion', 'timestamp'
  ],

  [MSG.JOIN_REQ]: ['type', 'guestId', 'displayName', 'protocolVersion', 'timestamp'],

  [MSG.JOIN_ACK]: [
    'type', 'accepted', 'timestamp'
    // rejectReason, assignedSlot, simTick, fullSnapshot are conditional
  ],

  [MSG.INPUT_CMD]: ['type', 'senderId', 'slot', 'seq', 'command', 'timestamp'],

  // M07: Extended CMD_BATCH schema with batchSeq, scheduledTick
  [MSG.CMD_BATCH]: ['type', 'batchSeq', 'simTick', 'scheduledTick', 'commands', 'timestamp'],
  // stateHash is optional

  [MSG.SNAPSHOT]: ['type', 'simTick', 'stateHash', 'state', 'timestamp'],

  [MSG.RESYNC_REQ]: ['type', 'guestId', 'lastKnownTick', 'reason', 'timestamp'],

  [MSG.RESYNC_ACK]: ['type', 'simTick', 'fullSnapshot', 'timestamp'],
  // commandLog is optional

  [MSG.PING]: ['type', 'senderId', 'seq', 'timestamp'],

  [MSG.PONG]: ['type', 'responderId', 'pingSeq', 'originalTimestamp', 'timestamp'],

  // M07 GAP-0: Seat acquisition schemas
  [MSG.SEAT_REQ]: ['type', 'targetUnitId', 'requesterSlot', 'timestamp'],
  // auth field is optional: { method: 'PIN_1DIGIT', guess: 1-9 }

  [MSG.SEAT_ACK]: ['type', 'targetUnitId', 'controllerSlot', 'timestamp'],

  [MSG.SEAT_REJECT]: ['type', 'targetUnitId', 'reason', 'timestamp']
  // reason: 'OCCUPIED' | 'LOCKED' | 'BAD_PIN' | 'COOLDOWN'
  // retryAfterMs is optional
});

/**
 * Valid message types set for quick lookup
 */
export const VALID_MESSAGE_TYPES = new Set(Object.values(MSG));
