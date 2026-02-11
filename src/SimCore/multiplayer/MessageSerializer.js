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
      // M07 Unit Authority v0: Support both selectedBySlot (canonical) and controllerSlot (deprecated)
      const hasSelectedBy = typeof msg.selectedBySlot === 'number';
      const hasController = typeof msg.controllerSlot === 'number';
      if (!hasSelectedBy && !hasController) {
        errors.push('selectedBySlot or controllerSlot must be a number');
      }
      // newOwnerSlot is optional (only present on takeover)
      if (msg.newOwnerSlot !== undefined && typeof msg.newOwnerSlot !== 'number') {
        errors.push('newOwnerSlot must be a number if provided');
      }
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

    // Host-leave resilience messages
    case MSG.HOST_LEAVE:
      if (typeof msg.hostId !== 'string') errors.push('hostId must be a string');
      break;

    case MSG.GUEST_LEAVE:
      if (typeof msg.slot !== 'number') errors.push('slot must be a number');
      break;

    // Position sync messages
    case MSG.POSITION_SYNC:
      if (typeof msg.tick !== 'number') errors.push('tick must be a number');
      if (!Array.isArray(msg.units)) errors.push('units must be an array');
      break;

    // Phase 2A: Server-authority messages
    case MSG.SERVER_SNAPSHOT:
      if (typeof msg.version !== 'number') errors.push('version must be a number');
      if (typeof msg.tick !== 'number') errors.push('tick must be a number');
      if (typeof msg.serverTimeMs !== 'number') errors.push('serverTimeMs must be a number');
      if (!Array.isArray(msg.units)) errors.push('units must be an array');
      break;

    case MSG.MOVE_INPUT:
      if (typeof msg.forward !== 'boolean') errors.push('forward must be a boolean');
      if (typeof msg.backward !== 'boolean') errors.push('backward must be a boolean');
      if (typeof msg.left !== 'boolean') errors.push('left must be a boolean');
      if (typeof msg.right !== 'boolean') errors.push('right must be a boolean');
      break;
  }

  // Validate timestamp is a number (SERVER_SNAPSHOT uses serverTimeMs instead)
  if (msg.type !== MSG.SERVER_SNAPSHOT && typeof msg.timestamp !== 'number') {
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
export function createHostAnnounce({ hostId, sessionName, hostDisplayName, mapSeed, simTick, currentPlayers, maxPlayers }) {
  return {
    type: MSG.HOST_ANNOUNCE,
    hostId,
    sessionName,
    hostDisplayName: hostDisplayName || sessionName,
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
export function createJoinAckAccepted({ assignedSlot, simTick, fullSnapshot, hostDisplayName }) {
  return {
    type: MSG.JOIN_ACK,
    accepted: true,
    rejectReason: null,
    assignedSlot,
    simTick,
    fullSnapshot,
    hostDisplayName: hostDisplayName || null,
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
 * M07 Unit Authority v0: Uses selectedBySlot (canonical) and includes newOwnerSlot for takeover.
 * @param {Object} params
 * @param {number} params.targetUnitId - Unit that was granted
 * @param {number} params.selectedBySlot - New driver slot (canonical name)
 * @param {number} [params.controllerSlot] - Deprecated alias for selectedBySlot
 * @param {number} [params.newOwnerSlot] - New owner slot (only on takeover)
 * @returns {Object}
 */
export function createSeatAck({ targetUnitId, selectedBySlot, controllerSlot, newOwnerSlot }) {
  // M07: Prefer selectedBySlot, fall back to controllerSlot for compatibility
  const effectiveSelectedBy = selectedBySlot ?? controllerSlot;

  const msg = {
    type: MSG.SEAT_ACK,
    targetUnitId,
    selectedBySlot: effectiveSelectedBy,
    controllerSlot: effectiveSelectedBy, // Deprecated alias for backwards compat
    timestamp: Date.now()
  };

  // Include newOwnerSlot only if provided (takeover case)
  if (newOwnerSlot !== undefined && newOwnerSlot !== null) {
    msg.newOwnerSlot = newOwnerSlot;
  }

  return msg;
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

/**
 * Creates a SEAT_RELEASE message (Any player -> Broadcast)
 * Sent when a player deselects/exits a unit, freeing the seat for others.
 * @param {Object} params
 * @param {number} params.targetUnitId - Unit being released
 * @param {number} params.releasedBySlot - Slot of the player releasing
 * @returns {Object}
 */
export function createSeatRelease({ targetUnitId, releasedBySlot }) {
  return {
    type: MSG.SEAT_RELEASE,
    targetUnitId,
    releasedBySlot,
    timestamp: Date.now()
  };
}

// ========================================
// Position Sync Messages
// ========================================

/**
 * Creates a POSITION_SYNC message (Host -> Broadcast)
 * Periodic authoritative unit positions from the host for reconciliation.
 * @param {Object} params
 * @param {number} params.tick - The simulation tick this sync corresponds to
 * @param {Array} params.units - Array of unit position data
 * @returns {Object}
 */
export function createPositionSync({ tick, units }) {
  return {
    type: MSG.POSITION_SYNC,
    tick,
    units,
    timestamp: Date.now()
  };
}

// ========================================
// Host-Leave Resilience Messages
// ========================================

/**
 * Creates a HOST_LEAVE message (Host -> Broadcast)
 * Sent by the Host when it gracefully leaves the session.
 * @param {Object} params
 * @param {string} params.hostId - The departing host's ID
 * @returns {Object}
 */
export function createHostLeave({ hostId }) {
  return {
    type: MSG.HOST_LEAVE,
    hostId,
    timestamp: Date.now()
  };
}

/**
 * Creates a GUEST_LEAVE message (Guest -> Broadcast)
 * Sent by a Guest when it gracefully leaves the session.
 * @param {Object} params
 * @param {number} params.slot - The departing guest's slot
 * @returns {Object}
 */
export function createGuestLeave({ slot }) {
  return {
    type: MSG.GUEST_LEAVE,
    slot,
    timestamp: Date.now()
  };
}

// ========================================
// Phase 2A: Server-Authority Messages
// ========================================

/**
 * Creates a SERVER_SNAPSHOT message (Server -> Broadcast)
 * Phase 2A authoritative server snapshot with full unit state.
 * Uses serverTimeMs instead of timestamp for server-authoritative timing.
 * @param {Object} params
 * @param {number} params.version - Snapshot schema version
 * @param {number} params.tick - The simulation tick this snapshot corresponds to
 * @param {number} params.serverTimeMs - Server-authoritative timestamp in ms
 * @param {Array} params.units - Array of authoritative unit state data
 * @returns {Object}
 */
export function createServerSnapshot({ version, tick, serverTimeMs, units }) {
  return {
    type: MSG.SERVER_SNAPSHOT,
    version,
    tick,
    serverTimeMs,
    units
  };
}

/**
 * Creates a MOVE_INPUT message (Client -> Server)
 * Phase 2A intent-based input: client sends directional intent, server resolves movement.
 * @param {Object} params
 * @param {boolean} params.forward - Forward key pressed
 * @param {boolean} params.backward - Backward key pressed
 * @param {boolean} params.left - Left key pressed
 * @param {boolean} params.right - Right key pressed
 * @returns {Object}
 */
export function createMoveInput({ forward, backward, left, right }) {
  return {
    type: MSG.MOVE_INPUT,
    forward: !!forward,
    backward: !!backward,
    left: !!left,
    right: !!right,
    timestamp: Date.now()
  };
}
