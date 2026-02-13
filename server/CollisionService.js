/**
 * CollisionService — Deterministic kinematic collision detection + mine system.
 *
 * Separation: Room.js delegates gameplay collision logic here.
 * Called each sim tick for proximity-based collision detection between
 * KINEMATIC units and obstacles/mines (does not rely on Rapier kinematic events).
 *
 * Design:
 *   - Distance-based overlap check (predictable, deterministic)
 *   - Units sorted by ID before processing (determinism guarantee)
 *   - NaN/Infinity defense on all inputs
 *   - Bounded: caps on mines, impulse magnitudes
 *   - No Math.random
 *
 * @module server/CollisionService
 */

import { Vec3 } from './SphereMath.js';

// ============================================================
// Constants
// ============================================================

/** @type {number} Minimum distance to prevent div-by-zero in direction calc */
const EPSILON = 1e-6;

/** @type {number} Default collision radius for unit↔unit (sum of radii) */
const DEFAULT_UNIT_COLLISION_RADIUS = 1.0;

/** @type {number} Default collision impulse for unit↔unit knockback (m/s) */
const DEFAULT_COLLISION_IMPULSE = 5.0;

/** @type {number} Default mine trigger radius */
const DEFAULT_MINE_TRIGGER_RADIUS = 1.5;

/** @type {number} Default mine upward impulse magnitude */
const DEFAULT_MINE_UPWARD_IMPULSE = 8.0;

/** @type {number} Default mine radial impulse magnitude */
const DEFAULT_MINE_RADIAL_IMPULSE = 5.0;

/** @type {number} Default mine blast radius */
const DEFAULT_MINE_BLAST_RADIUS = 6.0;

/** @type {number} Hard cap on active mines */
const DEFAULT_MAX_MINES = 32;

/**
 * @param {number} v
 * @returns {boolean}
 */
function isFiniteNum(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

/**
 * @param {{ x: number, y: number, z: number }} v
 * @returns {boolean}
 */
function isValidVec3(v) {
    return v != null && isFiniteNum(v.x) && isFiniteNum(v.y) && isFiniteNum(v.z);
}

/**
 * @typedef {Object} Mine
 * @property {number} id - Unique mine ID
 * @property {{ x: number, y: number, z: number }} position - World position
 * @property {number} triggerRadius - Detonation trigger distance
 * @property {number} upwardImpulse - Upward (surface normal) impulse strength
 * @property {number} radialImpulse - Radial blast impulse strength
 * @property {number} blastRadius - Radial blast radius
 */

/**
 * @typedef {Object} CollisionResult
 * @property {number} unitIdA - First unit ID
 * @property {number} unitIdB - Second unit ID
 * @property {{ x: number, y: number, z: number }} impulseA - Impulse applied to unit A
 * @property {{ x: number, y: number, z: number }} impulseB - Impulse applied to unit B
 * @property {number} distance - Distance between units at collision
 */

/**
 * @typedef {Object} DetonationResult
 * @property {number} mineId - Detonated mine ID
 * @property {number} triggerUnitId - Unit that triggered the mine
 * @property {number} affectedCount - Number of units hit by blast
 */

export class CollisionService {
    /**
     * @param {Object} [options]
     * @param {number} [options.unitCollisionRadius=1.0] - Distance for unit↔unit collision
     * @param {number} [options.collisionImpulse=5.0] - Knockback impulse for unit↔unit
     * @param {number} [options.maxMines=32] - Hard cap on active mines
     */
    constructor(options = {}) {
        /** @type {number} */
        this.unitCollisionRadius = options.unitCollisionRadius ?? DEFAULT_UNIT_COLLISION_RADIUS;

        /** @type {number} */
        this.collisionImpulse = options.collisionImpulse ?? DEFAULT_COLLISION_IMPULSE;

        /** @type {number} */
        this.maxMines = options.maxMines ?? DEFAULT_MAX_MINES;

        /** @type {Map<number, Mine>} Active mines */
        this._mines = new Map();

        /** @type {number} Next mine ID (deterministic counter) */
        this._nextMineId = 1;
    }

    // ============================================================
    // Mine management
    // ============================================================

    /**
     * Place a mine on the terrain.
     *
     * @param {{ x: number, y: number, z: number }} position - World position
     * @param {Object} [options]
     * @param {number} [options.triggerRadius] - Override default trigger radius
     * @param {number} [options.upwardImpulse] - Override default upward impulse
     * @param {number} [options.radialImpulse] - Override default radial impulse
     * @param {number} [options.blastRadius] - Override default blast radius
     * @returns {number|null} Mine ID, or null if at cap or invalid position
     */
    addMine(position, options = {}) {
        if (!isValidVec3(position)) return null;
        if (this._mines.size >= this.maxMines) return null;

        const id = this._nextMineId++;
        this._mines.set(id, {
            id,
            position: { x: position.x, y: position.y, z: position.z },
            triggerRadius: options.triggerRadius ?? DEFAULT_MINE_TRIGGER_RADIUS,
            upwardImpulse: options.upwardImpulse ?? DEFAULT_MINE_UPWARD_IMPULSE,
            radialImpulse: options.radialImpulse ?? DEFAULT_MINE_RADIAL_IMPULSE,
            blastRadius: options.blastRadius ?? DEFAULT_MINE_BLAST_RADIUS
        });

        return id;
    }

    /**
     * Remove a mine by ID.
     * @param {number} id
     * @returns {boolean} True if removed
     */
    removeMine(id) {
        return this._mines.delete(id);
    }

    /** @returns {number} Active mine count */
    get mineCount() {
        return this._mines.size;
    }

    /** @returns {Mine|undefined} Get mine by ID */
    getMine(id) {
        return this._mines.get(id);
    }

    // ============================================================
    // Kinematic collision detection (unit↔unit)
    // ============================================================

    /**
     * Check kinematic proximity collisions between units.
     * For each overlapping pair of KINEMATIC units, applies mutual knockback
     * by calling enterDynamic() on both.
     *
     * Deterministic: units sorted by ID, pairs processed in consistent order.
     *
     * @param {import('./HeadlessUnit.js').HeadlessUnit[]} units
     * @param {import('./PhysicsWorld.js').PhysicsWorld} physicsWorld
     * @returns {CollisionResult[]} Collisions detected and applied
     */
    checkKinematicCollisions(units, physicsWorld) {
        if (!units || units.length < 2 || !physicsWorld) return [];

        // Sort by ID for determinism
        const sorted = [...units]
            .filter(u => u != null && u.physicsMode === 'KINEMATIC' && u._reentryCooldown <= 0 && u.rigidBody)
            .sort((a, b) => a.id - b.id);

        const results = [];
        const radiusSq = this.unitCollisionRadius * this.unitCollisionRadius;

        // Check all pairs (O(n²) — bounded by unit count which is small)
        for (let i = 0; i < sorted.length; i++) {
            const a = sorted[i];
            // Skip if already transitioned this tick
            if (a.physicsMode !== 'KINEMATIC') continue;

            for (let j = i + 1; j < sorted.length; j++) {
                const b = sorted[j];
                if (b.physicsMode !== 'KINEMATIC') continue;

                const sep = Vec3.sub(a.position, b.position);
                const distSq = Vec3.lengthSq(sep);

                if (distSq > radiusSq) continue;

                const dist = Math.sqrt(distSq);
                if (dist < EPSILON) continue; // Overlapping centers — skip (undefined direction)

                // Compute knockback direction (A pushes away from B and vice versa)
                const dir = Vec3.scale(sep, 1 / dist);

                // Validate direction
                if (!isValidVec3(dir)) continue;

                const impulseA = Vec3.scale(dir, this.collisionImpulse);
                const impulseB = Vec3.scale(dir, -this.collisionImpulse);

                a.enterDynamic(physicsWorld, impulseA);
                b.enterDynamic(physicsWorld, impulseB);

                results.push({
                    unitIdA: a.id,
                    unitIdB: b.id,
                    impulseA: { ...impulseA },
                    impulseB: { ...impulseB },
                    distance: dist
                });
            }
        }

        return results;
    }

    // ============================================================
    // Kinematic collision detection (unit↔obstacle)
    // ============================================================

    /**
     * Check kinematic proximity collisions between units and static obstacles.
     *
     * @param {import('./HeadlessUnit.js').HeadlessUnit[]} units
     * @param {Map<number, { body: any, position: { x: number, y: number, z: number } }>} obstacles
     * @param {import('./PhysicsWorld.js').PhysicsWorld} physicsWorld
     * @param {number} [obstacleRadius=1.0] - Obstacle collision radius
     * @returns {{ unitId: number, impulse: { x: number, y: number, z: number }, distance: number }[]}
     */
    checkObstacleCollisions(units, obstacles, physicsWorld, obstacleRadius = 1.0) {
        if (!units || !obstacles || obstacles.size === 0 || !physicsWorld) return [];

        const results = [];
        const collisionDist = (this.unitCollisionRadius / 2) + obstacleRadius;
        const collisionDistSq = collisionDist * collisionDist;

        // Sort units by ID for determinism
        const sorted = [...units]
            .filter(u => u != null && u.physicsMode === 'KINEMATIC' && u._reentryCooldown <= 0 && u.rigidBody)
            .sort((a, b) => a.id - b.id);

        // Sort obstacles by handle for determinism
        const sortedObstacles = [...obstacles.entries()].sort((a, b) => a[0] - b[0]);

        for (const unit of sorted) {
            if (unit.physicsMode !== 'KINEMATIC') continue;

            for (const [, obs] of sortedObstacles) {
                const sep = Vec3.sub(unit.position, obs.position);
                const distSq = Vec3.lengthSq(sep);

                if (distSq > collisionDistSq) continue;

                const dist = Math.sqrt(distSq);
                if (dist < EPSILON) continue;

                const dir = Vec3.scale(sep, 1 / dist);
                if (!isValidVec3(dir)) continue;

                const impulse = Vec3.scale(dir, this.collisionImpulse);
                unit.enterDynamic(physicsWorld, impulse);

                results.push({
                    unitId: unit.id,
                    impulse: { ...impulse },
                    distance: dist
                });

                break; // Unit already DYNAMIC, skip remaining obstacles
            }
        }

        return results;
    }

    // ============================================================
    // Mine detonation
    // ============================================================

    /**
     * Check if any unit is within trigger radius of any mine.
     * Detonates triggered mines: applies upward impulse to trigger unit,
     * optional radial blast to nearby units, then removes the mine.
     *
     * Deterministic: mines sorted by ID, units sorted by ID.
     *
     * @param {import('./HeadlessUnit.js').HeadlessUnit[]} units
     * @param {import('./PhysicsWorld.js').PhysicsWorld} physicsWorld
     * @param {import('./PhysicsEventService.js').PhysicsEventService} [eventService] - For radial blast
     * @returns {DetonationResult[]} Detonations that occurred
     */
    checkMineContacts(units, physicsWorld, eventService) {
        if (!units || units.length === 0 || !physicsWorld || this._mines.size === 0) return [];

        const results = [];

        // Sort mines by ID for determinism
        const sortedMines = [...this._mines.values()].sort((a, b) => a.id - b.id);

        // Sort KINEMATIC units by ID
        const sortedUnits = [...units]
            .filter(u => u != null && u.physicsMode === 'KINEMATIC' && u.rigidBody)
            .sort((a, b) => a.id - b.id);

        // Track mines to remove (don't modify map during iteration)
        const minesToRemove = [];

        for (const mine of sortedMines) {
            const triggerRadiusSq = mine.triggerRadius * mine.triggerRadius;

            for (const unit of sortedUnits) {
                // Skip units already blown up this tick
                if (unit.physicsMode !== 'KINEMATIC') continue;

                const sep = Vec3.sub(unit.position, mine.position);
                const distSq = Vec3.lengthSq(sep);

                if (distSq > triggerRadiusSq) continue;

                // --- Mine detonation ---

                // 1. Upward impulse on the trigger unit (along surface normal = radial direction)
                const radialDir = Vec3.normalize(unit.position);
                if (!isValidVec3(radialDir)) continue;

                const upwardImpulse = Vec3.scale(radialDir, mine.upwardImpulse);
                unit.enterDynamic(physicsWorld, upwardImpulse);

                // 2. Radial blast to nearby units (if eventService available)
                let affectedCount = 1; // The trigger unit
                if (eventService && mine.radialImpulse > 0 && mine.blastRadius > 0) {
                    const blastResults = eventService.applyRadialImpulse({
                        center: mine.position,
                        radius: mine.blastRadius,
                        strength: mine.radialImpulse,
                        units,
                        physicsWorld
                    });
                    affectedCount += blastResults.length;
                }

                results.push({
                    mineId: mine.id,
                    triggerUnitId: unit.id,
                    affectedCount
                });

                minesToRemove.push(mine.id);
                break; // Mine consumed, don't check more units for this mine
            }
        }

        // Remove detonated mines
        for (const id of minesToRemove) {
            this._mines.delete(id);
        }

        return results;
    }

    /**
     * Reset all mines and counters.
     */
    reset() {
        this._mines.clear();
        this._nextMineId = 1;
    }
}
