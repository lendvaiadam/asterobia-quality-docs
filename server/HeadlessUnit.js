/**
 * HeadlessUnit - Server-side unit on spherical terrain.
 *
 * Authoritative position and orientation on a procedural sphere.
 * No Three.js, no mesh, no rendering. Suitable for server tick loop.
 *
 * Movement model:
 *   - Position is always ON the terrain surface (reprojected each tick)
 *   - WASD input moves in the tangent plane (not flat XZ)
 *   - Heading is a scalar angle relative to a reference-forward in the tangent plane
 *   - Orientation quaternion computed each tick, included in snapshot for client rendering
 *   - Diagonal normalization prevents √2 speed boost
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

export class HeadlessUnit {
    /** @type {number} Fixed movement speed (world units per second) */
    static MOVE_SPEED = 2.0;

    /**
     * @param {number} id - Deterministic entity ID (from IdGenerator)
     * @param {number} ownerSlot - Player slot that owns this unit (economic identity)
     */
    constructor(id, ownerSlot) {
        /** @type {number} */
        this.id = id;

        /** @type {number} Economic owner slot */
        this.ownerSlot = ownerSlot;

        /** @type {{ x: number, y: number, z: number }} World position (on terrain surface) */
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
            px: this.position.x,
            py: this.position.y,
            pz: this.position.z,
            qx: this.orientation.x,
            qy: this.orientation.y,
            qz: this.orientation.z,
            qw: this.orientation.w,
            heading: this.heading,
            speed: this.speed,
            hp: this.hp
        };
    }

    /**
     * Process a MOVE_INPUT command: convert WASD booleans to tangential velocity on sphere.
     * Movement directions are in the tangent-plane reference frame (not heading-relative).
     * Diagonal normalization prevents √2 speed boost.
     *
     * @param {Object} command - { type: 'MOVE_INPUT', forward, backward, left, right }
     */
    applyInput(command) {
        if (command.type !== 'MOVE_INPUT') return;

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
     * Advance position by velocity and reproject to terrain surface.
     * Called by Room._onSimTick() after all applyInput() calls.
     *
     * @param {number} dtSec - Timestep in seconds
     */
    updatePosition(dtSec) {
        if (this.speed <= 0) return;

        // Move in tangent direction
        const displacement = Vec3.scale(this.velocity, dtSec);
        const newPos = Vec3.add(this.position, displacement);

        // Reproject onto terrain surface
        const dir = Vec3.normalize(newPos);
        if (this.terrain) {
            const radius = this.terrain.getRadiusAt(dir);
            this.position = Vec3.scale(dir, radius);
        } else {
            // Fallback: bare sphere with default radius
            this.position = Vec3.scale(dir, 60);
        }

        // Update cached orientation for snapshot
        this._updateOrientation();
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
