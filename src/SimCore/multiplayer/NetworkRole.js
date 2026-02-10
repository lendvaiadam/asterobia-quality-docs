/**
 * NetworkRole.js - R013 Multiplayer Network Role Enum
 *
 * Defines the three possible roles for a client in multiplayer.
 * Reference: docs/specs/R013_MULTIPLAYER_HANDSHAKE_HOST_AUTHORITY.md Section 2.3
 */

/**
 * Network role enum
 *
 * OFFLINE - Not connected to any multiplayer session
 * HOST - Running authoritative simulation, broadcasting state
 * GUEST - Receiving state from host, sending inputs only
 */
export const NetworkRole = Object.freeze({
  OFFLINE: 'OFFLINE',
  HOST: 'HOST',
  GUEST: 'GUEST'
});

/**
 * Check if a role is valid
 * @param {string} role
 * @returns {boolean}
 */
export function isValidRole(role) {
  return role === NetworkRole.OFFLINE ||
         role === NetworkRole.HOST ||
         role === NetworkRole.GUEST;
}

/**
 * Check if role allows running SimCore.step()
 * Only HOST and OFFLINE may step
 * @param {string} role
 * @returns {boolean}
 */
export function canStep(role) {
  return role === NetworkRole.HOST || role === NetworkRole.OFFLINE;
}

/**
 * Check if role sends inputs to network
 * Only GUEST sends inputs over network
 * @param {string} role
 * @returns {boolean}
 */
export function sendsInputsToNetwork(role) {
  return role === NetworkRole.GUEST;
}

/**
 * Check if role broadcasts state to network
 * Only HOST broadcasts state
 * @param {string} role
 * @returns {boolean}
 */
export function broadcastsState(role) {
  return role === NetworkRole.HOST;
}
