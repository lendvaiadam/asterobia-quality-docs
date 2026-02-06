/**
 * StateSurface - Authoritative State Serialization
 *
 * R005: Explicitly separate Authoritative State from Render State.
 * This module provides serializeState() to export ONLY gameplay data.
 *
 * INCLUDED (authoritative):
 * - Unit: id, position, velocity, health, commands, waypoints, pathIndex
 * - Sim: tickCount, seed
 *
 * EXCLUDED (render-only):
 * - Three.js objects (mesh, material, geometry)
 * - Audio references
 * - UI state (isSelected, isHovered)
 * - Visual effects (dust, glow, particles)
 *
 * Usage:
 *   import { serializeState, serializeUnit } from './StateSurface.js';
 *   const snapshot = serializeState(game);
 *   const hash = hashState(snapshot);
 */

/**
 * Convert Three.js Vector3 to plain object.
 * @param {THREE.Vector3|{x,y,z}} vec
 * @returns {{x: number, y: number, z: number}}
 */
function vec3ToPlain(vec) {
    if (!vec) return { x: 0, y: 0, z: 0 };
    return {
        x: vec.x ?? 0,
        y: vec.y ?? 0,
        z: vec.z ?? 0
    };
}

/**
 * Convert Three.js Quaternion to plain object.
 * @param {THREE.Quaternion|{x,y,z,w}} quat
 * @returns {{x: number, y: number, z: number, w: number}}
 */
function quatToPlain(quat) {
    if (!quat) return { x: 0, y: 0, z: 0, w: 1 };
    return {
        x: quat.x ?? 0,
        y: quat.y ?? 0,
        z: quat.z ?? 0,
        w: quat.w ?? 1
    };
}

/**
 * Sanitize command params for JSON serialization.
 * Only includes known safe primitive/vector fields.
 * @param {Object} params - Command params object
 * @returns {Object} JSON-safe params
 */
function sanitizeCommandParams(params) {
    if (!params) return {};

    const safe = {};

    // Known Vector3 fields - convert to plain
    if (params.position) safe.position = vec3ToPlain(params.position);
    if (params.target) safe.target = vec3ToPlain(params.target);
    if (params.destination) safe.destination = vec3ToPlain(params.destination);

    // Known primitive fields - copy directly
    if (typeof params.unitId === 'number' || typeof params.unitId === 'string') {
        safe.unitId = params.unitId;
    }
    if (typeof params.targetId === 'number' || typeof params.targetId === 'string') {
        safe.targetId = params.targetId;
    }
    if (typeof params.waypointId === 'number' || typeof params.waypointId === 'string') {
        safe.waypointId = params.waypointId;
    }
    if (typeof params.radius === 'number') safe.radius = params.radius;
    if (typeof params.speed === 'number') safe.speed = params.speed;
    if (typeof params.action === 'string') safe.action = params.action;

    return safe;
}

/**
 * Serialize a single unit's authoritative state.
 * Excludes all render-only properties.
 *
 * @param {Unit} unit - Game unit instance
 * @returns {Object} Plain serializable object
 */
export function serializeUnit(unit) {
    if (!unit) return null;

    return {
        // Identity
        id: unit.id,
        name: unit.name,
        ownerSlot: unit.ownerSlot ?? 0, // R013 M07: Ownership tracking

        // Position & Orientation (convert Vector3/Quaternion to plain)
        position: vec3ToPlain(unit.position),
        quaternion: quatToPlain(unit.quaternion),
        velocity: vec3ToPlain(unit.velocity),
        velocityDirection: vec3ToPlain(unit.velocityDirection),

        // Movement
        speed: unit.speed ?? 5.0,
        currentSpeed: unit.currentSpeed ?? 0,
        turnSpeed: unit.turnSpeed ?? 2.0,
        groundOffset: unit.groundOffset ?? 0.22,

        // Path following
        pathIndex: unit.pathIndex ?? 0,
        isFollowingPath: unit.isFollowingPath ?? false,
        loopingEnabled: unit.loopingEnabled ?? false,
        isPathClosed: unit.isPathClosed ?? false,

        // Waypoints (serialize positions only, not visual markers)
        waypoints: (unit.waypoints || []).map(wp => ({
            id: wp.id,
            position: vec3ToPlain(wp.position),
            logicalState: wp.logicalState
        })),
        targetWaypointId: unit.targetWaypointId,
        lastWaypointId: unit.lastWaypointId,

        // Commands (sanitized for JSON - no circular refs or Three.js objects)
        commands: (unit.commands || []).map(cmd => ({
            id: cmd.id,
            type: cmd.type,
            params: sanitizeCommandParams(cmd.params),
            status: cmd.status
        })),
        currentCommandIndex: unit.currentCommandIndex ?? 0,

        // Combat / Health
        health: unit.health ?? 100,
        maxHealth: unit.maxHealth ?? 100,
        shieldLevel: unit.shieldLevel ?? 0,
        disabled: unit.disabled ?? false,

        // State flags (gameplay-relevant only)
        pausedByCommand: unit.pausedByCommand ?? false,
        waterState: unit.waterState ?? 'normal',
        isStuck: unit.isStuck ?? false
    };
}

/**
 * Serialize full game state for snapshot/replay/sync.
 *
 * @param {Game} game - Game instance
 * @param {Object} [options] - Serialization options
 * @param {boolean} [options.includeCommands=true] - Include command queues
 * @returns {Object} Complete authoritative state snapshot
 */
export function serializeState(game, options = {}) {
    const includeCommands = options.includeCommands !== false;

    const state = {
        // Simulation metadata
        version: 1,
        tickCount: game.simLoop?.tickCount ?? 0,
        simTimeSec: game.simLoop?.getSimTimeSec?.() ?? 0,

        // Units
        units: (game.units || [])
            .filter(u => u != null)
            .map(u => serializeUnit(u)),

        // Command queue (if requested)
        commandQueue: includeCommands && game.commandQueue ? {
            pendingCount: game.commandQueue.pendingCount,
            historyCount: game.commandQueue.historyCount
        } : undefined,

        // Selected unit ID (gameplay-relevant for commands)
        selectedUnitId: game.selectedUnit?.id ?? null
    };

    return state;
}

/**
 * Deserialize a unit state back to plain object.
 * Note: Does NOT create Three.js objects - use UnitFactory for that.
 *
 * @param {Object} data - Serialized unit data
 * @returns {Object} Unit data (ready for UnitModel or reconstruction)
 */
export function deserializeUnit(data) {
    // Return as-is since it's already plain objects
    return { ...data };
}

/**
 * Compute a simple hash of the state for comparison.
 * Uses position precision to detect drift.
 *
 * @param {Object} state - Serialized state from serializeState()
 * @returns {string} Hash string
 */
export function hashState(state) {
    // Simple deterministic hash based on unit positions
    let hash = state.tickCount.toString();

    for (const unit of state.units) {
        // Use fixed precision to catch any floating-point drift
        const px = unit.position.x.toFixed(6);
        const py = unit.position.y.toFixed(6);
        const pz = unit.position.z.toFixed(6);
        hash += `|${unit.id}:${px},${py},${pz}`;
    }

    return hash;
}

/**
 * Compare two state snapshots for equality.
 *
 * @param {Object} state1
 * @param {Object} state2
 * @param {Object} [options]
 * @param {number} [options.positionEpsilon=0] - Position comparison tolerance (0 = exact)
 * @returns {{ equal: boolean, differences: string[] }}
 */
export function compareStates(state1, state2, options = {}) {
    const epsilon = options.positionEpsilon ?? 0;
    const differences = [];

    if (state1.tickCount !== state2.tickCount) {
        differences.push(`tickCount: ${state1.tickCount} vs ${state2.tickCount}`);
    }

    if (state1.units.length !== state2.units.length) {
        differences.push(`unit count: ${state1.units.length} vs ${state2.units.length}`);
        return { equal: false, differences };
    }

    for (let i = 0; i < state1.units.length; i++) {
        const u1 = state1.units[i];
        const u2 = state2.units[i];

        if (u1.id !== u2.id) {
            differences.push(`unit[${i}].id: ${u1.id} vs ${u2.id}`);
        }

        // Position comparison
        const dx = Math.abs(u1.position.x - u2.position.x);
        const dy = Math.abs(u1.position.y - u2.position.y);
        const dz = Math.abs(u1.position.z - u2.position.z);

        if (dx > epsilon || dy > epsilon || dz > epsilon) {
            differences.push(`unit[${i}].position: (${u1.position.x},${u1.position.y},${u1.position.z}) vs (${u2.position.x},${u2.position.y},${u2.position.z})`);
        }

        // Health comparison
        if (u1.health !== u2.health) {
            differences.push(`unit[${i}].health: ${u1.health} vs ${u2.health}`);
        }
    }

    return {
        equal: differences.length === 0,
        differences
    };
}
