/**
 * PhysicsEventService — Gameplay impulse/event API for server-side physics.
 *
 * Separation: Room.js delegates to this service for gameplay events (explosions,
 * knockback, etc.) rather than accumulating logic in Room._onSimTick().
 *
 * Design:
 *   - Pure computation: no state persisted between calls
 *   - NaN/Infinity defense on all inputs
 *   - Deterministic: units processed in sorted-by-id order, no Math.random
 *   - Bounded: hard caps on radius, impulse magnitude, affected unit count
 *   - Integrates with HeadlessUnit.enterDynamic() → existing settle → exitDynamic flow
 *
 * @module server/PhysicsEventService
 */

import { Vec3 } from './SphereMath.js';

// ============================================================
// Safety caps (prevent unbounded physics events)
// ============================================================

/** @type {number} Maximum blast radius (world units) */
const DEFAULT_MAX_RADIUS = 50;

/** @type {number} Maximum impulse magnitude per unit (m/s) */
const DEFAULT_MAX_IMPULSE = 20;

/** @type {number} Maximum units affected by a single radial event */
const DEFAULT_MAX_AFFECTED = 16;

/** @type {number} Minimum distance to use for impulse direction (avoids div-by-zero) */
const EPSILON = 1e-6;

/**
 * @param {number} v
 * @returns {boolean} True if v is a finite number (not NaN, not ±Infinity)
 */
function isFiniteNum(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Validate a Vec3-like object. Returns true if all components are finite.
 * @param {{ x: number, y: number, z: number }} v
 * @returns {boolean}
 */
function isValidVec3(v) {
    return v != null && isFiniteNum(v.x) && isFiniteNum(v.y) && isFiniteNum(v.z);
}

/**
 * @typedef {Object} ImpulseResult
 * @property {number} unitId - ID of the affected unit
 * @property {{ x: number, y: number, z: number }} impulse - Applied impulse vector
 * @property {number} distance - Distance from blast center
 */

export class PhysicsEventService {
    /**
     * @param {Object} [options]
     * @param {number} [options.maxRadius=50]     - Hard cap on blast radius
     * @param {number} [options.maxImpulse=20]    - Hard cap on impulse magnitude
     * @param {number} [options.maxAffected=16]   - Hard cap on units per radial event
     */
    constructor(options = {}) {
        /** @type {number} */
        this.maxRadius = options.maxRadius ?? DEFAULT_MAX_RADIUS;

        /** @type {number} */
        this.maxImpulse = options.maxImpulse ?? DEFAULT_MAX_IMPULSE;

        /** @type {number} */
        this.maxAffected = options.maxAffected ?? DEFAULT_MAX_AFFECTED;
    }

    /**
     * Apply a radial (explosion) impulse from a center point.
     *
     * All KINEMATIC units within `radius` of `center` are transitioned to DYNAMIC
     * with an outward impulse proportional to (1 - distance/radius) * strength.
     *
     * Deterministic: units sorted by ID before processing.
     *
     * @param {Object} params
     * @param {{ x: number, y: number, z: number }} params.center - Explosion center (world coords)
     * @param {number} params.radius - Blast radius (world units, capped by maxRadius)
     * @param {number} params.strength - Base impulse magnitude at center (capped by maxImpulse)
     * @param {import('./HeadlessUnit.js').HeadlessUnit[]} params.units - All units to consider
     * @param {import('./PhysicsWorld.js').PhysicsWorld} params.physicsWorld - Physics world instance
     * @returns {ImpulseResult[]} Array of applied impulses (empty if no units affected)
     */
    applyRadialImpulse({ center, radius, strength, units, physicsWorld }) {
        // --- Input validation ---
        if (!isValidVec3(center)) return [];
        if (!isFiniteNum(radius) || radius <= 0) return [];
        if (!isFiniteNum(strength) || strength <= 0) return [];
        if (!units || units.length === 0) return [];
        if (!physicsWorld) return [];

        // --- Apply caps ---
        const cappedRadius = Math.min(radius, this.maxRadius);
        const cappedStrength = Math.min(strength, this.maxImpulse);

        // --- Sort by ID for deterministic processing ---
        const sortedUnits = [...units].filter(u => u != null).sort((a, b) => a.id - b.id);

        const results = [];
        const radiusSq = cappedRadius * cappedRadius;

        for (const unit of sortedUnits) {
            if (results.length >= this.maxAffected) break;

            // Skip non-KINEMATIC units (already DYNAMIC or invalid)
            if (unit.physicsMode !== 'KINEMATIC') continue;

            // Skip units in reentry cooldown
            if (unit._reentryCooldown > 0) continue;

            // Skip units without rigid bodies
            if (!unit.rigidBody) continue;

            // --- Distance check ---
            const sep = Vec3.sub(unit.position, center);
            const distSq = Vec3.lengthSq(sep);

            if (distSq > radiusSq) continue;

            const dist = Math.sqrt(distSq);

            // --- Zero-distance: skip (impulse direction undefined) ---
            if (dist < EPSILON) continue;

            // --- Compute outward impulse with linear falloff ---
            const falloff = 1 - (dist / cappedRadius);
            const magnitude = cappedStrength * falloff;

            // Normalize direction (center → unit)
            const dir = Vec3.scale(sep, 1 / dist);
            const impulse = Vec3.scale(dir, magnitude);

            // --- Final NaN guard on impulse ---
            if (!isValidVec3(impulse)) continue;

            // --- Apply ---
            unit.enterDynamic(physicsWorld, impulse);

            results.push({
                unitId: unit.id,
                impulse: { x: impulse.x, y: impulse.y, z: impulse.z },
                distance: dist
            });
        }

        return results;
    }

    /**
     * Apply a directed impulse to a single unit.
     *
     * Transitions the unit to DYNAMIC with the given impulse direction and strength.
     *
     * @param {Object} params
     * @param {import('./HeadlessUnit.js').HeadlessUnit} params.unit - Target unit
     * @param {{ x: number, y: number, z: number }} params.direction - Impulse direction (will be normalized)
     * @param {number} params.strength - Impulse magnitude (capped by maxImpulse)
     * @param {import('./PhysicsWorld.js').PhysicsWorld} params.physicsWorld - Physics world instance
     * @returns {ImpulseResult|null} Applied impulse info, or null if skipped
     */
    applyDirectedImpulse({ unit, direction, strength, physicsWorld }) {
        // --- Input validation ---
        if (!unit) return null;
        if (!isValidVec3(direction)) return null;
        if (!isFiniteNum(strength) || strength <= 0) return null;
        if (!physicsWorld) return null;

        // Skip non-KINEMATIC units
        if (unit.physicsMode !== 'KINEMATIC') return null;

        // Skip units in reentry cooldown
        if (unit._reentryCooldown > 0) return null;

        // Skip units without rigid bodies
        if (!unit.rigidBody) return null;

        // --- Normalize direction ---
        const len = Vec3.length(direction);
        if (len < EPSILON) return null;

        const dir = Vec3.scale(direction, 1 / len);

        // --- Apply cap ---
        const cappedStrength = Math.min(strength, this.maxImpulse);
        const impulse = Vec3.scale(dir, cappedStrength);

        // --- Final NaN guard ---
        if (!isValidVec3(impulse)) return null;

        // --- Apply ---
        unit.enterDynamic(physicsWorld, impulse);

        return {
            unitId: unit.id,
            impulse: { x: impulse.x, y: impulse.y, z: impulse.z },
            distance: 0
        };
    }
}
