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
 * Hybrid physics lifecycle (Phase 3):
 *   - physicsMode: 'KINEMATIC' (default) or 'DYNAMIC'
 *   - KINEMATIC: existing math-driven movement. If rigidBody exists, position synced TO body.
 *   - DYNAMIC: Rapier drives position. Unit reads back from rigidBody. WASD/path ignored.
 *   - enterDynamic(impulse): switch to DYNAMIC, apply optional impulse
 *   - exitDynamic(): settle back to KINEMATIC, snap to terrain, derive heading
 *   - Settle: auto-exit after linear velocity < threshold for N consecutive ticks
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

    /** @type {number} Linear velocity threshold for settle detection (m/s) */
    static SETTLE_VELOCITY_THRESHOLD = 0.1;

    /** @type {number} Angular velocity threshold for settle detection (rad/s) */
    static SETTLE_ANGVEL_THRESHOLD = 0.1;

    /** @type {number} Consecutive ticks below threshold to trigger settle (100 = 5s @ 20Hz) */
    static SETTLE_TICK_COUNT = 100;

    /** @type {number} Rollover trigger: angle between unit up and radial up (radians). Default 25° */
    static ROLLOVER_THRESHOLD_RAD = (25 * Math.PI) / 180;

    /** @type {number} Consecutive ticks on steep slope before entering DYNAMIC */
    static SLOPE_DEBOUNCE_TICKS = 3;

    /** @type {number} Impulse magnitude for slope-triggered rollover (m/s) */
    static SLOPE_IMPULSE_STRENGTH = 5.0;

    /** @type {number} Impulse magnitude for collision-triggered knockback (m/s) */
    static COLLISION_IMPULSE_STRENGTH = 5.0;

    // ── Cuboid collider half-extents (match GLB unit visual size) ──
    /** @type {number} Cuboid half-extent X (width/2) */
    static CUBOID_HX = 0.3;
    /** @type {number} Cuboid half-extent Y (height/2 — vertical) */
    static CUBOID_HY = 0.25;
    /** @type {number} Cuboid half-extent Z (depth/2) */
    static CUBOID_HZ = 0.5;

    // ── Soft terrain-following (KINEMATIC mode) ──
    /** @type {number} Spring constant for terrain correction (0.2=slow, 0.8=tight) */
    static SPRING_K = 0.4;
    /** @type {number} Max position correction per tick in world units (5cm) */
    static MAX_CORRECTION_STEP = 0.05;

    // ── DYNAMIC mode damping ──
    // Raised from 0.5/1.0 to compensate for smaller per-substep dt under 4× slowmo.
    // Rapier damping ≈ v *= (1 - damping*dt) per step; smaller dt → less decay per step.
    // 2× bump restores comparable wall-clock energy drain.
    /** @type {number} Linear damping during DYNAMIC (air resistance) */
    static LINEAR_DAMPING = 1.0;
    /** @type {number} Angular damping during DYNAMIC (spin resistance) */
    static ANGULAR_DAMPING = 2.0;

    /** @type {number} Minimum ticks in KINEMATIC after exiting DYNAMIC before re-triggering */
    static REENTRY_COOLDOWN_TICKS = 20;

    // ── Takeover gate (DYNAMIC → user control) ──
    /** @type {number} Max clearance error for grounding check (world units) */
    static TAKEOVER_CLEARANCE_EPS = 0.15;
    /** @type {number} cos(15°) — max tilt for orientation alignment */
    static TAKEOVER_TILT_COS = Math.cos(15 * Math.PI / 180);
    /** @type {number} Max linear velocity for takeover (m/s) */
    static TAKEOVER_LINVEL_THRESH = 0.5;
    /** @type {number} Max angular velocity for takeover (rad/s) */
    static TAKEOVER_ANGVEL_THRESH = 0.3;
    /** @type {number} Consecutive ticks TAKEOVER_READY must hold before allowing (5 = 0.25s @ 20Hz) */
    static TAKEOVER_DEBOUNCE_TICKS = 5;

    // ── Blend transition ──
    /** @type {number} Duration of Rapier→user blend-down in seconds */
    static BLEND_DURATION = 1.0;

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

        // Phase 3: Hybrid physics lifecycle
        /** @type {'KINEMATIC' | 'DYNAMIC'} Physics mode */
        this.physicsMode = 'KINEMATIC';

        /** @type {import('@dimforge/rapier3d-compat').RigidBody|null} Rapier rigid body (set by Room) */
        this.rigidBody = null;

        /** @type {number} Consecutive ticks with velocity below settle threshold */
        this._settleCounter = 0;

        /** @type {number} Consecutive ticks on steep slope (for debounce) */
        this._slopeTriggerCounter = 0;

        /** @type {number} Cooldown ticks remaining after exiting DYNAMIC (or after spawn) */
        this._reentryCooldown = HeadlessUnit.REENTRY_COOLDOWN_TICKS;

        /** @type {number} Consecutive ticks isTakeoverReady() has been true */
        this._takeoverReadyCounter = 0;

        /** @type {number} Blend factor: 1.0 = full Rapier, 0.0 = full user */
        this._rapierBlend = 0;

        /** @type {'NONE'|'BLEND_DOWN'} Active blend direction */
        this._blendDirection = 'NONE';

        /** @type {{ x: number, y: number, z: number }} Velocity inherited from Rapier at blend start */
        this._blendInheritedVelocity = { x: 0, y: 0, z: 0 };

        /** @type {number} Remaining orientation blend ticks after exiting DYNAMIC (smooth transition) */
        this._orientationBlendTicks = 0;

        /** @type {{ x:number, y:number, z:number, w:number }|null} Rapier quaternion to slerp FROM */
        this._rapierExitOrientation = null;
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
        // Place cuboid center above terrain: bottom face touches surface
        this.position = Vec3.scale(dir, radius + HeadlessUnit.CUBOID_HY);
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
            physicsMode: this.physicsMode,
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

        // SETTLED: always block
        if (this.physicsMode === 'SETTLED') return;

        // DYNAMIC: allow only when takeover-ready (debounced) → triggers blend-down
        if (this.physicsMode === 'DYNAMIC') {
            const hasInput = command.forward || command.backward || command.left || command.right;
            if (!hasInput) return;
            if (this._takeoverReadyCounter < HeadlessUnit.TAKEOVER_DEBOUNCE_TICKS) return;
            this._startBlendDown();
            // Fall through to process WASD normally
        }

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
        // SETTLED: unit stays fallen, no movement.
        if (this.physicsMode === 'SETTLED') return;

        // DYNAMIC blend-down: cross-fade Rapier inherited velocity with user WASD velocity
        if (this.physicsMode === 'DYNAMIC' && this._blendDirection === 'BLEND_DOWN') {
            const blend = this._rapierBlend; // 1→0 over BLEND_DURATION
            const userVel = this.velocity;
            const rapierVel = this._blendInheritedVelocity;

            const mixedVel = {
                x: userVel.x * (1 - blend) + rapierVel.x * blend,
                y: userVel.y * (1 - blend) + rapierVel.y * blend,
                z: userVel.z * (1 - blend) + rapierVel.z * blend
            };

            const displacement = Vec3.scale(mixedVel, dtSec);
            this.position = Vec3.add(this.position, displacement);

            // Sync blended position to Rapier body so it doesn't fight
            if (this.rigidBody) {
                this.rigidBody.setTranslation(this.position, true);
                this.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
            }

            this._softTerrainCorrection();
            this._updateOrientation();
            return;
        }

        // DYNAMIC (not blending): Rapier drives position.
        if (this.physicsMode === 'DYNAMIC') return;

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

        // Terrain following: hard snap for active movement, soft correction for idle
        if (this.speed > 0 || this.mode === 'AIRBORNE') {
            this._reprojectToTerrain();
        } else {
            this._softTerrainCorrection();
        }

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

    // ========================================
    // Hybrid physics lifecycle (Phase 3)
    // ========================================

    /**
     * Transition to DYNAMIC mode. Rapier takes over position control.
     * The rigid body type is switched to dynamic and an optional impulse is applied.
     * WASD input and path-follow are ignored while DYNAMIC.
     *
     * @param {import('./PhysicsWorld.js').PhysicsWorld} physicsWorld - For body type descriptors
     * @param {{ x: number, y: number, z: number }} [impulse] - Optional impulse to apply
     */
    enterDynamic(physicsWorld, impulse) {
        if (this.physicsMode === 'DYNAMIC') return;
        if (!this.rigidBody) return;

        this.physicsMode = 'DYNAMIC';
        this._settleCounter = 0;
        this._takeoverReadyCounter = 0;
        this._blendDirection = 'NONE';
        this._rapierBlend = 1.0;
        this._blendInheritedVelocity = { x: 0, y: 0, z: 0 };
        this._dynamicTickCounter = 0;

        // Cancel any active path or WASD movement
        this.clearPath();
        this.speed = 0;
        this.velocity = { x: 0, y: 0, z: 0 };

        // Switch body type to dynamic
        const RAPIER = physicsWorld.RAPIER;
        this.rigidBody.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
        this.rigidBody.setGravityScale(0, true); // We use manual spherical gravity

        // Disable sensor so terrain trimesh collider can physically support the unit
        const numColliders = this.rigidBody.numColliders();
        for (let i = 0; i < numColliders; i++) {
            this.rigidBody.collider(i).setSensor(false);
        }

        // Damping: prevent endless flying/spinning
        this.rigidBody.setLinearDamping(HeadlessUnit.LINEAR_DAMPING);
        this.rigidBody.setAngularDamping(HeadlessUnit.ANGULAR_DAMPING);

        // CCD: prevent tunneling through terrain during fast flight
        this.rigidBody.enableCcd(true);

        // Pre-snap: lift unit center well above terrain so collider doesn't
        // intersect the trimesh. The cuboid bottom must clear all nearby terrain
        // vertices (grid step = 1m, so ±0.5m variance is possible).
        if (this.terrain) {
            const dir = Vec3.normalize(this.position);
            const terrainR = this.terrain.getRadiusAt(dir);
            const liftR = terrainR + HeadlessUnit.CUBOID_HY + 1.0;

            const currentR = Vec3.length(this.position);
            if (currentR < liftR) {
                this.position = Vec3.scale(dir, liftR);
            }
        }

        // Sync position AND rotation TO body before physics takes over
        this.rigidBody.setTranslation(this.position, true);
        this.rigidBody.setRotation(this.orientation, true);
        this.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        this.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);

        // Apply impulse if provided
        if (impulse) {
            this.rigidBody.applyImpulse(impulse, true);
            const vel = this.rigidBody.linvel();
            console.log(`[HU] enterDynamic U${this.id}: impulse=(${impulse.x.toFixed(2)},${impulse.y.toFixed(2)},${impulse.z.toFixed(2)}) -> linvel=(${vel.x.toFixed(2)},${vel.y.toFixed(2)},${vel.z.toFixed(2)}) mass=${this.rigidBody.mass().toFixed(2)}`);
        }
    }

    /**
     * Transition back to KINEMATIC mode. Math-driven movement resumes.
     * Reads final position from rigid body, snaps to terrain, derives heading.
     *
     * @param {import('./PhysicsWorld.js').PhysicsWorld} physicsWorld - For body type descriptors
     */
    exitDynamic(physicsWorld) {
        if (this.physicsMode !== 'DYNAMIC') return;
        if (!this.rigidBody) return;

        // Read final position and rotation from Rapier
        const pos = this.rigidBody.translation();
        this.position = { x: pos.x, y: pos.y, z: pos.z };
        const rot = this.rigidBody.rotation();

        // Inherit tangential velocity for motion continuity
        const vel = this.rigidBody.linvel();
        const rapierVel = { x: vel.x, y: vel.y, z: vel.z };
        const up = this._getSurfaceUp();
        const tangentVel = Vec3.projectOnPlane(rapierVel, up);
        const tangentSpeed = Vec3.length(tangentVel);
        this.velocity = tangentVel;
        this.speed = tangentSpeed;

        // Switch body type back to kinematic
        const RAPIER = physicsWorld.RAPIER;
        this.rigidBody.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
        this.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);

        // Re-enable sensor so terrain trimesh doesn't fight kinematic movement
        const numColliders = this.rigidBody.numColliders();
        for (let i = 0; i < numColliders; i++) {
            this.rigidBody.collider(i).setSensor(true);
        }

        // Reset damping and CCD (not needed for kinematic)
        this.rigidBody.setLinearDamping(0);
        this.rigidBody.setAngularDamping(0);
        this.rigidBody.enableCcd(false);

        this.physicsMode = 'KINEMATIC';
        this._settleCounter = 0;
        this._slopeTriggerCounter = 0;
        this._reentryCooldown = HeadlessUnit.REENTRY_COOLDOWN_TICKS;
        this._takeoverReadyCounter = 0;
        this._blendDirection = 'NONE';
        this._rapierBlend = 0;
        this._blendInheritedVelocity = { x: 0, y: 0, z: 0 };

        this.mode = 'GROUNDED';
        this.altitude = 0;
        this.verticalVelocity = 0;

        // NO _reprojectToTerrain() — keep exact Rapier landing position.
        // Store Rapier's quaternion for smooth orientation blend (slerp over ~1s).
        this._rapierExitOrientation = { x: rot.x, y: rot.y, z: rot.z, w: rot.w };
        this._orientationBlendTicks = 20; // 20 ticks = 1s @ 20Hz

        // Derive heading from velocity direction (if moving) or from Rapier rotation
        if (tangentSpeed > 0.1) {
            const dir = Vec3.scale(tangentVel, 1 / tangentSpeed);
            const refFwd = this._getReferenceForward(up);
            const refRight = Vec3.normalize(Vec3.cross(refFwd, up));
            this.heading = Math.atan2(Vec3.dot(dir, refRight), Vec3.dot(dir, refFwd));
        } else {
            this._deriveHeadingFromRotation(rot);
        }

        // Start with Rapier's orientation; _updateOrientation will slerp toward correct pose
        this.orientation = this._rapierExitOrientation;
    }

    /**
     * Transition to SETTLED mode. Unit stays fallen (preserves Rapier quaternion).
     * Rapier body switched to kinematic to stop simulation, but orientation is NOT
     * reset to surface-normal. Unit does not move until explicitly reset.
     *
     * @param {import('./PhysicsWorld.js').PhysicsWorld} physicsWorld
     */
    settleDynamic(physicsWorld) {
        if (this.physicsMode !== 'DYNAMIC') return;
        if (!this.rigidBody) return;

        // Read final position and rotation from Rapier
        const pos = this.rigidBody.translation();
        this.position = { x: pos.x, y: pos.y, z: pos.z };
        const rot = this.rigidBody.rotation();
        this.orientation = { x: rot.x, y: rot.y, z: rot.z, w: rot.w };

        // Switch body back to kinematic (stop Rapier simulation)
        const RAPIER = physicsWorld.RAPIER;
        this.rigidBody.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
        this.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);

        // Re-enable sensor
        const numColliders = this.rigidBody.numColliders();
        for (let i = 0; i < numColliders; i++) {
            this.rigidBody.collider(i).setSensor(true);
        }

        // Reset damping and CCD (not needed for settled/kinematic)
        this.rigidBody.setLinearDamping(0);
        this.rigidBody.setAngularDamping(0);
        this.rigidBody.enableCcd(false);

        // SETTLED: stays fallen, no movement, no terrain re-alignment
        this.physicsMode = 'SETTLED';
        this._settleCounter = 0;
        this.speed = 0;
        this.velocity = { x: 0, y: 0, z: 0 };
    }

    /**
     * Check terrain slope at current position and update debounce counter.
     * Returns a down-slope impulse vector if the trigger threshold is met,
     * or null if slope is safe / on cooldown / already DYNAMIC.
     *
     * @returns {{ x: number, y: number, z: number } | null} Impulse vector or null
     */
    /**
     * Check rollover condition: angle between unit's local Y axis and radial "up".
     * If the angle exceeds ROLLOVER_THRESHOLD_RAD, the unit should start tumbling.
     * No impulse needed — gravity naturally topples the tilted unit.
     *
     * @returns {boolean} True if rollover should trigger
     */
    checkRolloverTrigger() {
        if (this.physicsMode === 'DYNAMIC' || this.physicsMode === 'SETTLED') return false;
        if (this._reentryCooldown > 0) {
            this._reentryCooldown--;
            return false;
        }

        // Unit's local Y axis in world space (from orientation quaternion)
        const unitUp = Quat.rotateVec3(this.orientation, { x: 0, y: 1, z: 0 });

        // Radial "up" = planet radius direction
        const radialUp = Vec3.normalize(this.position);

        // Angle between unit up and radial up
        const dot = Math.min(1, Math.max(-1, Vec3.dot(unitUp, radialUp)));
        const angle = Math.acos(dot);

        if (angle > HeadlessUnit.ROLLOVER_THRESHOLD_RAD) {
            this._slopeTriggerCounter++;
            if (this._slopeTriggerCounter >= HeadlessUnit.SLOPE_DEBOUNCE_TICKS) {
                this._slopeTriggerCounter = 0;
                return true;
            }
        } else {
            this._slopeTriggerCounter = 0;
        }

        return false;
    }

    /**
     * Orientation-based settle: check if unit is upright and slow enough to restore control.
     * "Upright" = unit's local Y axis (from Rapier rotation) is within ~18° of radial up.
     * "Slow" = linear speed < 2 m/s (not mid-bounce).
     * @returns {boolean} True if unit should exit DYNAMIC and return to KINEMATIC
     */
    isUprightAndSlow() {
        if (!this.rigidBody) return false;
        if (this.physicsMode !== 'DYNAMIC') return false;

        // Unit's local Y axis from Rapier rotation
        const rot = this.rigidBody.rotation();
        const unitUp = Quat.rotateVec3(rot, { x: 0, y: 1, z: 0 });

        // Radial "up" at unit position
        const pos = this.rigidBody.translation();
        const lenSq = pos.x * pos.x + pos.y * pos.y + pos.z * pos.z;
        if (lenSq < 1e-6) return false;
        const len = Math.sqrt(lenSq);
        const radialUp = { x: pos.x / len, y: pos.y / len, z: pos.z / len };

        // Ground-proximity check: must be within 0.5m of expected standing height
        if (this.terrain) {
            const terrainR = this.terrain.getRadiusAt(radialUp);
            const expectedR = terrainR + HeadlessUnit.CUBOID_HY;
            if (Math.abs(len - expectedR) > 0.5) return false;
        }

        // Angle check: dot > 0.95 ≈ within 18°
        const dot = unitUp.x * radialUp.x + unitUp.y * radialUp.y + unitUp.z * radialUp.z;
        if (dot < 0.95) return false;

        // Speed check: not mid-bounce
        const vel = this.rigidBody.linvel();
        const speedSq = vel.x * vel.x + vel.y * vel.y + vel.z * vel.z;
        return speedSq < 4.0; // < 2 m/s
    }

    /**
     * Strict takeover gate: all conditions must be true simultaneously.
     * 1) Grounding: unit center near expected standing height above terrain
     * 2) Orientation: unit up-axis aligns with terrain normal (within 15°)
     * 3) Low motion: linvel and angvel below thresholds
     *
     * Call each tick for DYNAMIC units. Increments _takeoverReadyCounter
     * when all conditions hold, resets to 0 otherwise.
     *
     * @returns {boolean} True if all conditions hold this tick
     */
    isTakeoverReady() {
        if (!this.rigidBody) return false;
        if (this.physicsMode !== 'DYNAMIC') return false;
        if (this._blendDirection === 'BLEND_DOWN') return false; // Already blending

        const pos = this.rigidBody.translation();
        const posLen = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
        if (posLen < 1e-6) { this._takeoverReadyCounter = 0; return false; }

        const dir = { x: pos.x / posLen, y: pos.y / posLen, z: pos.z / posLen };

        // 1) Grounding: |posLen - terrainR - CUBOID_HY| < eps
        const terrainR = this.terrain ? this.terrain.getRadiusAt(dir) : 60;
        const expectedR = terrainR + HeadlessUnit.CUBOID_HY;
        if (Math.abs(posLen - expectedR) > HeadlessUnit.TAKEOVER_CLEARANCE_EPS) {
            this._takeoverReadyCounter = 0;
            return false;
        }

        // 2) Orientation: dot(unitUp, terrainNormal) >= cos(15°)
        const rot = this.rigidBody.rotation();
        const unitUp = Quat.rotateVec3(rot, { x: 0, y: 1, z: 0 });
        const terrainNormal = this.terrain
            ? Vec3.normalize(this.terrain.getNormalAt({ x: pos.x, y: pos.y, z: pos.z }))
            : dir;
        const dot = unitUp.x * terrainNormal.x + unitUp.y * terrainNormal.y + unitUp.z * terrainNormal.z;
        if (dot < HeadlessUnit.TAKEOVER_TILT_COS) {
            this._takeoverReadyCounter = 0;
            return false;
        }

        // 3) Low motion
        const vel = this.rigidBody.linvel();
        const linSpeed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
        if (linSpeed > HeadlessUnit.TAKEOVER_LINVEL_THRESH) {
            this._takeoverReadyCounter = 0;
            return false;
        }
        const angVel = this.rigidBody.angvel();
        const angSpeed = Math.sqrt(angVel.x * angVel.x + angVel.y * angVel.y + angVel.z * angVel.z);
        if (angSpeed > HeadlessUnit.TAKEOVER_ANGVEL_THRESH) {
            this._takeoverReadyCounter = 0;
            return false;
        }

        this._takeoverReadyCounter++;
        return true;
    }

    /**
     * Begin blend-down: Rapier influence 1→0 over BLEND_DURATION.
     * Captures Rapier linear velocity projected onto tangent plane.
     * @private
     */
    _startBlendDown() {
        if (this._blendDirection === 'BLEND_DOWN') return;

        this._blendDirection = 'BLEND_DOWN';
        this._rapierBlend = 1.0;

        // Capture Rapier velocity projected to tangent plane
        if (this.rigidBody) {
            const vel = this.rigidBody.linvel();
            const up = this._getSurfaceUp();
            this._blendInheritedVelocity = Vec3.projectOnPlane(
                { x: vel.x, y: vel.y, z: vel.z }, up
            );

            // Switch body to kinematic so Rapier stops simulating forces
            // but we keep driving position via blended velocity
            const pw = this.rigidBody;
            // Note: body type switch handled by caller or at blend end
        }
    }

    /**
     * Update blend factor. Called every tick for DYNAMIC units in BLEND_DOWN.
     * Ramps _rapierBlend from 1→0 over BLEND_DURATION.
     * When blend reaches 0, calls exitDynamic (no reproject).
     *
     * @param {number} dtSec - Tick delta
     * @param {import('./PhysicsWorld.js').PhysicsWorld} physicsWorld
     * @returns {boolean} True if blend completed (unit exited DYNAMIC)
     */
    updateBlend(dtSec, physicsWorld) {
        if (this._blendDirection !== 'BLEND_DOWN') return false;

        this._rapierBlend = Math.max(0, this._rapierBlend - dtSec / HeadlessUnit.BLEND_DURATION);

        // Decay inherited velocity naturally
        const decay = 0.95;
        this._blendInheritedVelocity = Vec3.scale(this._blendInheritedVelocity, decay);

        if (this._rapierBlend <= 0) {
            this._rapierBlend = 0;
            this._blendDirection = 'NONE';
            this._blendInheritedVelocity = { x: 0, y: 0, z: 0 };
            this.exitDynamic(physicsWorld);
            return true;
        }

        return false;
    }

    /**
     * Derive heading angle from a Rapier rotation quaternion.
     * Projects the unit's forward direction (local -Z) onto the tangent plane,
     * then computes heading relative to the reference forward.
     *
     * @param {{ x: number, y: number, z: number, w: number }} rot - Rapier quaternion
     * @private
     */
    _deriveHeadingFromRotation(rot) {
        const up = this._getSurfaceUp();
        const refFwd = this._getReferenceForward(up);
        const refRight = Vec3.normalize(Vec3.cross(refFwd, up));

        // Unit's forward from Rapier rotation (local -Z convention for Three.js meshes)
        const localFwd = Quat.rotateVec3(rot, { x: 0, y: 0, z: -1 });
        const tangentFwd = Vec3.projectOnPlane(localFwd, up);
        const tangentLen = Vec3.length(tangentFwd);

        if (tangentLen < 1e-6) return; // Pointing straight up/down, keep current heading

        const normFwd = Vec3.scale(tangentFwd, 1 / tangentLen);
        this.heading = Math.atan2(Vec3.dot(normFwd, refRight), Vec3.dot(normFwd, refFwd));
    }

    /**
     * Sync kinematic unit position TO rigid body.
     * Called before physics step for KINEMATIC units so terrain colliders
     * can interact with other dynamic bodies nearby.
     */
    syncToRigidBody() {
        if (!this.rigidBody) return;
        if (this.physicsMode !== 'KINEMATIC') return;
        this.rigidBody.setNextKinematicTranslation(this.position);
        this.rigidBody.setNextKinematicRotation(this.orientation);
    }

    /**
     * Sync DYNAMIC unit position FROM rigid body.
     * Called after physics step. Also checks settle condition.
     *
     * @returns {boolean} True if the unit has settled (ready to exit DYNAMIC)
     */
    syncFromRigidBody() {
        if (!this.rigidBody) return false;
        if (this.physicsMode !== 'DYNAMIC') return false;

        // Read position back from Rapier
        const pos = this.rigidBody.translation();
        this.position = { x: pos.x, y: pos.y, z: pos.z };

        // DYNAMIC: read rotation directly from Rapier (tumble effect)
        // Do NOT call _updateOrientation() — that derives from sphere surface and destroys tumble
        const rot = this.rigidBody.rotation();
        this.orientation = { x: rot.x, y: rot.y, z: rot.z, w: rot.w };

        // Settle detection: both linear AND angular velocity must be near zero
        const vel = this.rigidBody.linvel();
        const linSpeedSq = vel.x * vel.x + vel.y * vel.y + vel.z * vel.z;
        const angVel = this.rigidBody.angvel();
        const angSpeedSq = angVel.x * angVel.x + angVel.y * angVel.y + angVel.z * angVel.z;

        const linThresh = HeadlessUnit.SETTLE_VELOCITY_THRESHOLD;
        const angThresh = HeadlessUnit.SETTLE_ANGVEL_THRESHOLD;

        if (linSpeedSq < linThresh * linThresh && angSpeedSq < angThresh * angThresh) {
            this._settleCounter++;
        } else {
            this._settleCounter = 0;
        }

        // Settle: manual counter OR Rapier native sleep (whichever triggers first)
        return this._settleCounter >= HeadlessUnit.SETTLE_TICK_COUNT
            || this.rigidBody.isSleeping();
    }

    /**
     * Reproject position to terrain surface + cuboid half-height offset.
     * Hard snap — the cuboid bottom sits on the terrain, center is HY above.
     *
     * @private
     */
    _reprojectToTerrain() {
        const dir = Vec3.normalize(this.position);
        const terrainRadius = this.terrain
            ? this.terrain.getRadiusAt(dir)
            : 60;
        const finalRadius = terrainRadius + HeadlessUnit.CUBOID_HY + this.altitude;
        this.position = Vec3.scale(dir, finalRadius);
    }

    /**
     * Soft spring-based terrain following for GROUNDED mode.
     * Instead of hard-snap, smoothly corrects toward the ideal terrain surface position.
     * The unit "rides" the terrain with a spring that prevents clipping and floating.
     *
     * d = currentR - targetR:
     *   d < 0 → unit is inside terrain → push outward
     *   d > 0 → unit is floating → pull down
     *
     * @private
     */
    _softTerrainCorrection() {
        const dir = Vec3.normalize(this.position);
        const terrainR = this.terrain
            ? this.terrain.getRadiusAt(dir)
            : 60;
        const targetR = terrainR + HeadlessUnit.CUBOID_HY + this.altitude;
        const currentR = Vec3.length(this.position);
        const d = currentR - targetR;

        // Spring correction: clamp to max step per tick
        const K = HeadlessUnit.SPRING_K;
        const maxStep = HeadlessUnit.MAX_CORRECTION_STEP;
        const correction = Math.max(-maxStep, Math.min(maxStep, -d * K));

        const newR = currentR + correction;
        this.position = Vec3.scale(dir, newR);
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

        const target = Quat.lookRotation(forward, up);

        // Smooth orientation blend after exiting DYNAMIC (slerp from Rapier pose)
        if (this._orientationBlendTicks > 0 && this._rapierExitOrientation) {
            const t = 1 - (this._orientationBlendTicks / 20); // 0→1 over 20 ticks
            this.orientation = Quat.slerp(this._rapierExitOrientation, target, t);
            this._orientationBlendTicks--;
            if (this._orientationBlendTicks <= 0) {
                this._rapierExitOrientation = null;
            }
        } else {
            this.orientation = target;
        }
    }
}
