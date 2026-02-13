/**
 * HeadlessUnit - Server-side unit on spherical terrain.
 *
 * Authoritative position and orientation on a procedural sphere.
 * No Three.js, no mesh, no rendering. Suitable for server tick loop.
 *
 * Movement model:
 *   - GROUNDED: position reprojected to terrain surface each tick
 *   - AIRBORNE: position above terrain, subject to gravity (no terrain snap)
 *   - WASD input moves in the tangent plane (not flat XZ)
 *   - PATH_DATA: server walks waypoints kinematically (Phase 2B)
 *   - Heading is a scalar angle relative to a reference-forward in the tangent plane
 *   - Orientation quaternion computed each tick, included in snapshot for client rendering
 *   - Diagonal normalization prevents √2 speed boost
 *   - MOVE_INPUT (WASD) cancels active path-follow immediately
 *
 * Coordinate system:
 *   - "Up" = terrain surface normal at unit position
 *   - "Reference forward" = projection of world {0,1,0} onto tangent plane (→ "north")
 *   - WASD maps to reference-frame directions (W=north, S=south, A=west, D=east)
 *   - Heading tracks movement direction (same semantics as flat XZ version)
 *
 * @module server/HeadlessUnit
 */

import { Vec3, Quat } from './SphereMath.js';

/** @type {number} Gravity acceleration (world units per second²) */
const GRAVITY = 9.81;

export class HeadlessUnit {
    /** @type {number} Fixed movement speed (world units per second) — matches client Unit.speed */
    static MOVE_SPEED = 5.0;

    /**
     * @param {number} id - Deterministic entity ID (from IdGenerator or manifest)
     * @param {number} ownerSlot - Player slot that owns this unit (economic identity)
     * @param {Object} [options]
     * @param {number} [options.modelIndex=0] - Index into the client model array (for rendering)
     */
    constructor(id, ownerSlot, options = {}) {
        /** @type {number} */
        this.id = id;

        /** @type {number} Economic owner slot */
        this.ownerSlot = ownerSlot;

        /** @type {number} Index into client model array (0-4 for 5 GLB models) */
        this.modelIndex = options.modelIndex ?? 0;

        /** @type {{ x: number, y: number, z: number }} World position (on terrain surface or above) */
        this.position = { x: 0, y: 60, z: 0 };

        /** @type {{ x: number, y: number, z: number }} Current velocity (tangential to sphere) */
        this.velocity = { x: 0, y: 0, z: 0 };

        /** @type {number} Heading angle in radians (rotation around surface normal) */
        this.heading = 0;

        /** @type {number} Current speed scalar */
        this.speed = 0;

        /** @type {number} Hit points */
        this.hp = 100;

        /** @type {number|null} Slot currently controlling this unit (driver) */
        this.selectedBySlot = null;

        /** @type {{ x: number, y: number, z: number, w: number }} Cached orientation quaternion */
        this.orientation = Quat.identity();

        /** @type {import('./ServerTerrain.js').ServerTerrain|null} Terrain reference (set by Room) */
        this.terrain = null;

        // Flight-readiness fields
        /** @type {'GROUNDED' | 'AIRBORNE'} Movement mode */
        this.mode = 'GROUNDED';

        /** @type {number} Height above terrain surface (0 = on surface) */
        this.altitude = 0;

        /** @type {number} Velocity along radial direction (m/s, negative = falling) */
        this.verticalVelocity = 0;

        // Phase 2B: Path-follow state
        /** @type {Array<{x:number,y:number,z:number}>|null} Active waypoint list */
        this.waypoints = null;

        /** @type {number} Index of current target waypoint */
        this.waypointIndex = 0;

        /** @type {boolean} Whether path loops back to start */
        this.pathClosed = false;
    }

    /**
     * Spawn this unit at a position on the terrain surface.
     *
     * @param {{ x: number, y: number, z: number }} direction - Unit vector from center (spawn direction)
     * @param {import('./ServerTerrain.js').ServerTerrain} terrain - Terrain instance for height lookup
     */
    spawnOnSurface(direction, terrain) {
        this.terrain = terrain;
        const dir = Vec3.normalize(direction);
        const radius = terrain.getRadiusAt(dir);
        this.position = Vec3.scale(dir, radius);
        this.mode = 'GROUNDED';
        this.altitude = 0;
        this.verticalVelocity = 0;
        this._updateOrientation();
    }

    /**
     * Produce a minimal JSON-safe snapshot for network transmission.
     * Includes position + orientation quaternion for correct client rendering.
     * Uses short keys to minimize bandwidth.
     *
     * @returns {Object} Snapshot data
     */
    toSnapshot() {
        return {
            id: this.id,
            ownerSlot: this.ownerSlot,
            modelIndex: this.modelIndex,
            px: this.position.x,
            py: this.position.y,
            pz: this.position.z,
            qx: this.orientation.x,
            qy: this.orientation.y,
            qz: this.orientation.z,
            qw: this.orientation.w,
            heading: this.heading,
            speed: this.speed,
            state: this.speed > 0 ? 'MOVING' : 'IDLE',
            hp: this.hp,
            mode: this.mode,
            altitude: this.altitude
        };
    }

    /**
     * Set an active path for this unit to follow.
     * Replaces any existing path. Called when server validates a PATH_DATA command.
     *
     * @param {Array<{x:number,y:number,z:number}>} waypoints - Validated waypoint positions
     * @param {boolean} [closed=false] - Whether the path loops
     */
    setPath(waypoints, closed = false) {
        this.waypoints = waypoints;
        this.waypointIndex = 0;
        this.pathClosed = closed;
    }

    /**
     * Clear the active path. Unit stops path-following and becomes idle.
     */
    clearPath() {
        this.waypoints = null;
        this.waypointIndex = 0;
        this.pathClosed = false;
    }

    /**
     * Process a MOVE_INPUT command: convert WASD booleans to tangential velocity on sphere.
     * Movement directions are in the tangent-plane reference frame (not heading-relative).
     * Diagonal normalization prevents √2 speed boost.
     *
     * Interrupt rule: actual WASD input (any key true) cancels active path-follow.
     *
     * @param {Object} command - { type: 'MOVE_INPUT', forward, backward, left, right }
     */
    applyInput(command) {
        if (command.type !== 'MOVE_INPUT') return;

        // Interrupt rule: direct WASD input cancels active path-follow
        const hasInput = command.forward || command.backward || command.left || command.right;
        if (hasInput && this.waypoints) {
            this.clearPath();
        }

        // Map WASD to tangent-plane input components
        // forward/backward = along reference forward, left/right = along reference right
        let inputFwd = 0;
        let inputRight = 0;

        if (command.forward)  inputFwd += 1;
        if (command.backward) inputFwd -= 1;
        if (command.left)     inputRight -= 1;
        if (command.right)    inputRight += 1;

        // Diagonal normalization: prevent √2 speed boost
        const len = Math.sqrt(inputFwd * inputFwd + inputRight * inputRight);
        if (len > 0) {
            inputFwd /= len;
            inputRight /= len;
        }

        this.speed = len > 0 ? HeadlessUnit.MOVE_SPEED : 0;

        // Compute tangent basis at current position
        const up = this._getSurfaceUp();
        const refFwd = this._getReferenceForward(up);
        const refRight = Vec3.normalize(Vec3.cross(refFwd, up));

        // Set velocity in world space (tangential to sphere)
        if (len > 0) {
            const fwdComponent = Vec3.scale(refFwd, inputFwd * HeadlessUnit.MOVE_SPEED);
            const rightComponent = Vec3.scale(refRight, inputRight * HeadlessUnit.MOVE_SPEED);
            this.velocity = Vec3.add(fwdComponent, rightComponent);

            // Update heading: angle from reference forward to movement direction
            this.heading = Math.atan2(inputRight, inputFwd);
        } else {
            this.velocity = { x: 0, y: 0, z: 0 };
            // Heading persists from last movement (unit keeps facing last direction)
        }
    }

    /**
     * Advance position by velocity and reproject to terrain surface (GROUNDED)
     * or apply gravity (AIRBORNE). Called by Room._onSimTick().
     *
     * @param {number} dtSec - Timestep in seconds
     */
    updatePosition(dtSec) {
        // Phase 2B: delegate to path-follow if active
        if (this.waypoints && this.waypoints.length > 0) {
            this._followPath(dtSec);
            return;
        }

        if (this.speed <= 0 && this.mode === 'GROUNDED') return;

        // Horizontal: tangent-plane movement
        const displacement = Vec3.scale(this.velocity, dtSec);
        this.position = Vec3.add(this.position, displacement);

        // Vertical: gravity for airborne units
        if (this.mode === 'AIRBORNE') {
            this.verticalVelocity -= GRAVITY * dtSec;
            this.altitude += this.verticalVelocity * dtSec;
            if (this.altitude <= 0) {
                this.altitude = 0;
                this.verticalVelocity = 0;
                this.mode = 'GROUNDED';
            }
        }

        // Reproject to terrain surface
        this._reprojectToTerrain();

        // Update cached orientation for snapshot
        this._updateOrientation();
    }

    // ========================================
    // Path-follow (Phase 2B)
    // ========================================

    /**
     * Move toward the current waypoint. When close enough, advance to the next.
     * Uses tangent-plane displacement + terrain reprojection (same approach as WASD).
     *
     * @param {number} dtSec - Timestep in seconds
     * @private
     */
    _followPath(dtSec) {
        const target = this.waypoints[this.waypointIndex];
        const toTarget = Vec3.sub(target, this.position);
        const dist = Vec3.length(toTarget);

        const stepSize = HeadlessUnit.MOVE_SPEED * dtSec;

        // Arrival check: close enough to snap to waypoint
        if (dist <= stepSize) {
            this.waypointIndex++;
            if (this.waypointIndex >= this.waypoints.length) {
                if (this.pathClosed) {
                    this.waypointIndex = 0;
                } else {
                    // Path complete — stop
                    this.clearPath();
                    this.speed = 0;
                    this.velocity = { x: 0, y: 0, z: 0 };
                    this._reprojectToTerrain();
                    this._updateOrientation();
                    return;
                }
            }
            // Continue toward next waypoint next tick (keep moving)
            this.speed = HeadlessUnit.MOVE_SPEED;
            this._reprojectToTerrain();
            this._updateOrientation();
            return;
        }

        // Move toward target
        const direction = Vec3.normalize(toTarget);
        const displacement = Vec3.scale(direction, stepSize);
        this.position = Vec3.add(this.position, displacement);

        // Update heading to face movement direction
        const up = this._getSurfaceUp();
        const refFwd = this._getReferenceForward(up);
        const refRight = Vec3.normalize(Vec3.cross(refFwd, up));
        const tangentDir = Vec3.normalize(Vec3.projectOnPlane(direction, up));
        const fwdComp = Vec3.dot(tangentDir, refFwd);
        const rightComp = Vec3.dot(tangentDir, refRight);
        this.heading = Math.atan2(rightComp, fwdComp);

        this.speed = HeadlessUnit.MOVE_SPEED;
        this.velocity = Vec3.scale(direction, HeadlessUnit.MOVE_SPEED);

        this._reprojectToTerrain();
        this._updateOrientation();
    }

    /**
     * Reproject position to terrain surface (GROUNDED) or terrain + altitude (AIRBORNE).
     * Extracted for reuse by both WASD and path-follow movement.
     *
     * @private
     */
    _reprojectToTerrain() {
        const dir = Vec3.normalize(this.position);
        const terrainRadius = this.terrain
            ? this.terrain.getRadiusAt(dir)
            : 60;
        const finalRadius = terrainRadius + this.altitude;
        this.position = Vec3.scale(dir, finalRadius);
    }

    // ========================================
    // Private helpers
    // ========================================

    /**
     * Get surface "up" direction at current position.
     * Uses terrain normal if available, otherwise sphere radial direction.
     *
     * @returns {{ x: number, y: number, z: number }} Normalized up vector
     * @private
     */
    _getSurfaceUp() {
        if (this.terrain) {
            return Vec3.normalize(this.terrain.getNormalAt(this.position));
        }
        return Vec3.normalize(this.position);
    }

    /**
     * Get the reference "forward" direction in the tangent plane at current position.
     * Projects world {0,1,0} ("north") onto the tangent plane. Falls back to {0,0,1}
     * when at the poles (where {0,1,0} is parallel to the normal).
     *
     * @param {{ x: number, y: number, z: number }} up - Surface normal (must be normalized)
     * @returns {{ x: number, y: number, z: number }} Normalized reference forward
     * @private
     */
    _getReferenceForward(up) {
        let refFwd = Vec3.projectOnPlane({ x: 0, y: 1, z: 0 }, up);
        if (Vec3.lengthSq(refFwd) < 1e-6) {
            // At poles: {0,1,0} is parallel to normal. Fall back to {0,0,1}.
            refFwd = Vec3.projectOnPlane({ x: 0, y: 0, z: 1 }, up);
        }
        return Vec3.normalize(refFwd);
    }

    /**
     * Compute and cache the orientation quaternion from current position + heading.
     * The quaternion maps local -Z to the unit's facing direction and local +Y to the
     * terrain surface normal (Three.js mesh convention).
     *
     * @private
     */
    _updateOrientation() {
        const up = this._getSurfaceUp();
        const refFwd = this._getReferenceForward(up);

        // Rotate reference forward by heading angle around the surface normal
        const headingQuat = Quat.fromAxisAngle(up, this.heading);
        const forward = Quat.rotateVec3(headingQuat, refFwd);

        this.orientation = Quat.lookRotation(forward, up);
    }
}
