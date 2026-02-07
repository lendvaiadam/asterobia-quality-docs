/**
 * MessageSerializer.js - R013 Multiplayer Message Encoding/Decoding
 *
 * Provides encode/decode utilities with schema validation.
 * Reference: docs/specs/R013_MULTIPLAYER_HANDSHAKE_HOST_AUTHORITY.md Section 4
 */

import { MSG, MESSAGE_SCHEMAS, VALID_MESSAGE_TYPES, PROTOCOL_VERSION } from './MessageTypes.js';

/**
 * Error thrown when message validation fails
 */
export class MessageValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'MessageValidationError';
    this.details = details;
  }
}

/**
 * Validates a message object against its schema
 * @param {Object} msg - Message object to validate
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateMessage(msg) {
  const errors = [];

  // Check if message is an object
  if (!msg || typeof msg !== 'object') {
    return { valid: false, errors: ['Message must be a non-null object'] };
  }

  // Check for type field
  if (!msg.type) {
    return { valid: false, errors: ['Message missing required "type" field'] };
  }

  // Check if type is valid
  if (!VALID_MESSAGE_TYPES.has(msg.type)) {
    return { valid: false, errors: [`Unknown message type: ${msg.type}`] };
  }

  // Get schema for this message type
  const schema = MESSAGE_SCHEMAS[msg.type];
  if (!schema) {
    return { valid: false, errors: [`No schema defined for type: ${msg.type}`] };
  }

  // Check required fields
  for (const field of schema) {
    if (msg[field] === undefined) {
      // Special handling for JOIN_ACK conditional fields
      if (msg.type === MSG.JOIN_ACK) {
        if (field === 'rejectReason' && msg.accepted === true) continue;
        if (field === 'assignedSlot' && msg.accepted === false) continue;
        if (field === 'simTick' && msg.accepted === false) continue;
        if (field === 'fullSnapshot' && msg.accepted === false) continue;
      }
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Type-specific validation
  switch (msg.type) {
    case MSG.HELLO:
      if (typeof msg.clientId !== 'string') {
        errors.push('clientId must be a string');
      }
      break;

    case MSG.HOST_ANNOUNCE:
      if (typeof msg.hostId !== 'string') errors.push('hostId must be a string');
      if (typeof msg.simTick !== 'number') errors.push('simTick must be a number');
      if (typeof msg.currentPlayers !== 'number') errors.push('currentPlayers must be a number');
      if (typeof msg.maxPlayers !== 'number') errors.push('maxPlayers must be a number');
      break;

    case MSG.JOIN_REQ:
      if (typeof msg.guestId !== 'string') errors.push('guestId must be a string');
      break;

    case MSG.JOIN_ACK:
      if (typeof msg.accepted !== 'boolean') errors.push('accepted must be a boolean');
      if (msg.accepted === true) {
        if (typeof msg.assignedSlot !== 'number') errors.push('assignedSlot must be a number');
        if (typeof msg.simTick !== 'number') errors.push('simTick must be a number');
        if (!msg.fullSnapshot || typeof msg.fullSnapshot !== 'object') {
          errors.push('fullSnapshot must be an object when accepted');
        }
      }
      break;

    case MSG.INPUT_CMD:
      if (typeof msg.slot !== 'number') errors.push('slot must be a number');
      if (typeof msg.seq !== 'number') errors.push('seq must be a number');
      if (!msg.command || typeof msg.command !== 'object') {
        errors.push('command must be an object');
      }
      break;

    case MSG.CMD_BATCH:
      // M07: Extended validation
      if (typeof msg.batchSeq !== 'number') errors.push('batchSeq must be a number');
      if (typeof msg.simTick !== 'number') errors.push('simTick must be a number');
      if (typeof msg.scheduledTick !== 'number') errors.push('scheduledTick must be a number');
      if (!Array.isArray(msg.commands)) errors.push('commands must be an array');
      // stateHash is optional (can be null or string)
      if (msg.stateHash !== null && typeof msg.stateHash !== 'string') {
        errors.push('stateHash must be null or a string');
      }
      break;

    case MSG.SNAPSHOT:
      if (typeof msg.simTick !== 'number') errors.push('simTick must be a number');
      if (typeof msg.stateHash !== 'string') errors.push('stateHash must be a string');
      if (!msg.state || typeof msg.state !== 'object') {
        errors.push('state must be an object');
      }
      break;

    case MSG.RESYNC_REQ:
      if (typeof msg.lastKnownTick !== 'number') errors.push('lastKnownTick must be a number');
      if (typeof msg.reason !== 'string') errors.push('reason must be a string');
      break;

    case MSG.RESYNC_ACK:
      if (typeof msg.simTick !== 'number') errors.push('simTick must be a number');
      if (!msg.fullSnapshot || typeof msg.fullSnapshot !== 'object') {
        errors.push('fullSnapshot must be an object');
      }
      break;

    case MSG.PING:
      if (typeof msg.seq !== 'number') errors.push('seq must be a number');
      break;

    case MSG.PONG:
      if (typeof msg.pingSeq !== 'number') errors.push('pingSeq must be a number');
      if (typeof msg.originalTimestamp !== 'number') errors.push('originalTimestamp must be a number');
      break;

    // M07 GAP-0: Seat acquisition message validation
    case MSG.SEAT_REQ:
      if (typeof msg.targetUnitId !== 'number') errors.push('targetUnitId must be a number');
      if (typeof msg.requesterSlot !== 'number') errors.push('requesterSlot must be a number');
      // auth is optional, but if present must have method and guess
      if (msg.auth) {
        if (msg.auth.method !== 'PIN_1DIGIT') {
          errors.push('auth.method must be PIN_1DIGIT');
        }
        if (typeof msg.auth.guess !== 'number' || msg.auth.guess < 1 || msg.auth.guess > 9) {
          errors.push('auth.guess must be a number 1-9');
        }
      }
      break;

    case MSG.SEAT_ACK:
      if (typeof msg.targetUnitId !== 'number') errors.push('targetUnitId must be a number');
      if (typeof msg.controllerSlot !== 'number') errors.push('controllerSlot must be a number');
      break;

    case MSG.SEAT_REJECT:
      if (typeof msg.targetUnitId !== 'number') errors.push('targetUnitId must be a number');
      if (!['OCCUPIED', 'LOCKED', 'BAD_PIN', 'COOLDOWN'].includes(msg.reason)) {
        errors.push('reason must be one of: OCCUPIED, LOCKED, BAD_PIN, COOLDOWN');
      }
      // retryAfterMs is optional
      if (msg.retryAfterMs !== undefined && typeof msg.retryAfterMs !== 'number') {
        errors.push('retryAfterMs must be a number if provided');
      }
      break;
  }

  // Validate timestamp is a number
  if (typeof msg.timestamp !== 'number') {
    errors.push('timestamp must be a number');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Encodes a message object to JSON string
 * @param {Object} msg - Message object to encode
 * @param {boolean} [validate=true] - Whether to validate before encoding
 * @returns {string} JSON string
 * @throws {MessageValidationError} If validation fails
 */
export function encode(msg, validate = true) {
  if (validate) {
    const result = validateMessage(msg);
    if (!result.valid) {
      throw new MessageValidationError(
        `Invalid message: ${result.errors.join(', ')}`,
        { message: msg, errors: result.errors }
      );
    }
  }

  return JSON.stringify(msg);
}

/**
 * Decodes a JSON string to a message object
 * @param {string} str - JSON string to decode
 * @param {boolean} [validate=true] - Whether to validate after decoding
 * @returns {Object} Decoded message object
 * @throws {MessageValidationError} If parsing or validation fails
 */
export function decode(str, validate = true) {
  let msg;

  try {
    msg = JSON.parse(str);
  } catch (e) {
    throw new MessageValidationError(
      `Failed to parse message JSON: ${e.message}`,
      { raw: str }
    );
  }

  if (validate) {
    const result = validateMessage(msg);
    if (!result.valid) {
      throw new MessageValidationError(
        `Invalid message: ${result.errors.join(', ')}`,
        { message: msg, errors: result.errors }
      );
    }
  }

  return msg;
}

/**
 * Creates a HELLO message
 * @param {string} clientId
 * @returns {Object}
 */
export function createHello(clientId) {
  return {
    type: MSG.HELLO,
    clientId,
    protocolVersion: '0.13.0',
    timestamp: Date.now()
  };
}

/**
 * Creates a HOST_ANNOUNCE message
 * @param {Object} params
 * @returns {Object}
 */
export function createHostAnnounce({ hostId, sessionName, mapSeed, simTick, currentPlayers, maxPlayers }) {
  return {
    type: MSG.HOST_ANNOUNCE,
    hostId,
    sessionName,
    mapSeed,
    simTick,
    currentPlayers,
    maxPlayers,
    protocolVersion: '0.13.0',
    timestamp: Date.now()
  };
}

/**
 * Creates a JOIN_REQ message
 * @param {Object} params
 * @returns {Object}
 */
export function createJoinReq({ guestId, displayName }) {
  return {
    type: MSG.JOIN_REQ,
    guestId,
    displayName: displayName || `Guest-${(guestId || '').slice(0, 4)}`,
    protocolVersion: PROTOCOL_VERSION,
    timestamp: Date.now()
  };
}

/**
 * Creates a JOIN_ACK message (accepted)
 * @param {Object} params
 * @returns {Object}
 */
export function createJoinAckAccepted({ assignedSlot, simTick, fullSnapshot }) {
  return {
    type: MSG.JOIN_ACK,
    accepted: true,
    rejectReason: null,
    assignedSlot,
    simTick,
    fullSnapshot,
    timestamp: Date.now()
  };
}

/**
 * Creates a JOIN_ACK message (rejected)
 * @param {string} reason - Rejection reason
 * @returns {Object}
 */
export function createJoinAckRejected(reason) {
  const normalizedReason = reason || 'UNKNOWN_ERROR';
  return {
    type: MSG.JOIN_ACK,
    accepted: false,
    rejectReason: normalizedReason,  // CANONICAL field per Antigravity
    reason: normalizedReason,        // Alias for backwards compatibility
    assignedSlot: null,
    simTick: null,
    fullSnapshot: null,
    timestamp: Date.now()
  };
}

/**
 * Creates an INPUT_CMD message
 * @param {Object} params
 * @returns {Object}
 */
export function createInputCmd({ senderId, slot, seq, command }) {
  return {
    type: MSG.INPUT_CMD,
    senderId,
    slot,
    seq,
    command,
    timestamp: Date.now()
  };
}

/**
 * Creates a CMD_BATCH message
 * M07: Extended schema with batchSeq, scheduledTick, stateHash
 * @param {Object} params
 * @returns {Object}
 */
export function createCmdBatch({ batchSeq, simTick, scheduledTick, commands, stateHash = null }) {
  return {
    type: MSG.CMD_BATCH,
    batchSeq,              // M07: Monotonic sequence for idempotency
    simTick,               // "Created at" tick
    scheduledTick,         // M07: "Execute at" tick (simTick + BUFFER)
    commands,
    stateHash,             // M07: Optional checksum for debugging
    timestamp: Date.now()
  };
}

/**
 * Creates a SNAPSHOT message
 * @param {Object} params
 * @returns {Object}
 */
export function createSnapshot({ simTick, stateHash, state }) {
  return {
    type: MSG.SNAPSHOT,
    simTick,
    stateHash,
    state,
    timestamp: Date.now()
  };
}

/**
 * Creates a RESYNC_REQ message
 * @param {Object} params
 * @returns {Object}
 */
export function createResyncReq({ guestId, lastKnownTick, reason }) {
  return {
    type: MSG.RESYNC_REQ,
    guestId,
    lastKnownTick,
    reason,
    timestamp: Date.now()
  };
}

/**
 * Creates a RESYNC_ACK message
 * @param {Object} params
 * @returns {Object}
 */
export function createResyncAck({ simTick, fullSnapshot, commandLog = null }) {
  return {
    type: MSG.RESYNC_ACK,
    simTick,
    fullSnapshot,
    commandLog,
    timestamp: Date.now()
  };
}

/**
 * Creates a PING message
 * @param {Object} params
 * @returns {Object}
 */
export function createPing({ senderId, seq }) {
  return {
    type: MSG.PING,
    senderId,
    seq,
    timestamp: Date.now()
  };
}

/**
 * Creates a PONG message
 * @param {Object} params
 * @returns {Object}
 */
export function createPong({ responderId, pingSeq, originalTimestamp }) {
  return {
    type: MSG.PONG,
    responderId,
    pingSeq,
    originalTimestamp,
    timestamp: Date.now()
  };
}

// ========================================
// M07 GAP-0: Seat Acquisition Messages
// ========================================

/**
 * Creates a SEAT_REQ message (Guest -> Host)
 * @param {Object} params
 * @param {number} params.targetUnitId - Unit to request control of
 * @param {number} params.requesterSlot - Requesting player's slot
 * @param {Object} [params.auth] - Optional auth challenge { method: 'PIN_1DIGIT', guess: 1-9 }
 * @returns {Object}
 */
export function createSeatReq({ targetUnitId, requesterSlot, auth }) {
  const msg = {
    type: MSG.SEAT_REQ,
    targetUnitId,
    requesterSlot,
    timestamp: Date.now()
  };
  if (auth) {
    msg.auth = auth;
  }
  return msg;
}

/**
 * Creates a SEAT_ACK message (Host -> Broadcast)
 * @param {Object} params
 * @param {number} params.targetUnitId - Unit that was granted
 * @param {number} params.controllerSlot - New controller slot
 * @returns {Object}
 */
export function createSeatAck({ targetUnitId, controllerSlot }) {
  return {
    type: MSG.SEAT_ACK,
    targetUnitId,
    controllerSlot,
    timestamp: Date.now()
  };
}

/**
 * Creates a SEAT_REJECT message (Host -> Private/Broadcast)
 * @param {Object} params
 * @param {number} params.targetUnitId - Unit that was denied
 * @param {string} params.reason - 'OCCUPIED' | 'LOCKED' | 'BAD_PIN' | 'COOLDOWN'
 * @param {number} [params.retryAfterMs] - Optional backoff hint in ms
 * @returns {Object}
 */
export function createSeatReject({ targetUnitId, reason, retryAfterMs }) {
  const msg = {
    type: MSG.SEAT_REJECT,
    targetUnitId,
    reason,
    timestamp: Date.now()
  };
  if (retryAfterMs !== undefined) {
    msg.retryAfterMs = retryAfterMs;
  }
  return msg;
}
