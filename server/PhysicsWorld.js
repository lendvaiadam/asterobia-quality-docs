/**
 * PhysicsWorld — Server-side Rapier physics wrapper.
 *
 * Owns a single RAPIER.World instance with spherical gravity.
 * Provides deterministic fixed-timestep stepping with configurable sub-steps.
 *
 * Lifecycle:
 *   1. PhysicsWorld.create(options)  — async factory (initializes WASM)
 *   2. pw.step(dtSec)               — advance physics (sub-stepped)
 *   3. pw.shutdown()                 — free WASM resources
 *
 * Phase 3 Step 1: Foundation only. No unit binding, no terrain colliders,
 * no snapshot integration. Just a tested, reliable physics engine wrapper.
 *
 * @module server/PhysicsWorld
 */

/** @type {import('@dimforge/rapier3d-compat') | null} Cached RAPIER module */
let _RAPIER = null;

/** @type {boolean} Whether RAPIER.init() has completed */
let _rapierReady = false;

/**
 * Initialize the RAPIER module (idempotent).
 * Safe to call multiple times — only the first call does real work.
 *
 * @returns {Promise<import('@dimforge/rapier3d-compat')>} The initialized RAPIER module
 * @throws {Error} If WASM initialization fails
 */
export async function initRapier() {
    if (_rapierReady && _RAPIER) return _RAPIER;

    const mod = await import('@dimforge/rapier3d-compat');
    _RAPIER = mod.default ?? mod;
    await _RAPIER.init();
    _rapierReady = true;
    return _RAPIER;
}

/**
 * Check whether Rapier has been initialized.
 * @returns {boolean}
 */
export function isRapierReady() {
    return _rapierReady;
}

/**
 * Get the cached RAPIER module (must call initRapier() first).
 * @returns {import('@dimforge/rapier3d-compat')}
 * @throws {Error} If not initialized
 */
export function getRapier() {
    if (!_rapierReady || !_RAPIER) {
        throw new Error('Rapier not initialized. Call initRapier() first.');
    }
    return _RAPIER;
}

export class PhysicsWorld {
    /**
     * Async factory — creates and initializes a PhysicsWorld.
     *
     * @param {Object} [options]
     * @param {number} [options.subSteps=3] - Physics sub-steps per step() call
     * @param {number} [options.physicsHz=60] - Internal physics rate in Hz
     * @param {number} [options.gravity=9.81] - Spherical gravity magnitude (m/s²)
     * @returns {Promise<PhysicsWorld>}
     */
    static async create(options = {}) {
        const RAPIER = await initRapier();
        return new PhysicsWorld(RAPIER, options);
    }

    /**
     * @param {import('@dimforge/rapier3d-compat')} RAPIER - Initialized module
     * @param {Object} [options]
     * @param {number} [options.subSteps=3]
     * @param {number} [options.physicsHz=60]
     * @param {number} [options.gravity=9.81]
     */
    constructor(RAPIER, options = {}) {
        /** @type {import('@dimforge/rapier3d-compat')} */
        this._RAPIER = RAPIER;

        /** @type {number} Sub-steps per step() */
        this.subSteps = options.subSteps ?? 3;

        /** @type {number} Internal physics rate */
        this.physicsHz = options.physicsHz ?? 60;

        /** @type {number} Spherical gravity acceleration (m/s²) */
        this.gravityMagnitude = options.gravity ?? 9.81;

        // Zero global gravity — we apply spherical gravity manually per body
        /** @type {import('@dimforge/rapier3d-compat').World} */
        this._world = new RAPIER.World({ x: 0, y: 0, z: 0 });
        this._world.timestep = 1 / this.physicsHz;

        /** @type {import('@dimforge/rapier3d-compat').EventQueue} */
        this._eventQueue = new RAPIER.EventQueue(true);

        /** @type {boolean} Whether this world has been shut down */
        this._destroyed = false;

        /** @type {number} Total physics sub-steps executed */
        this.totalSubSteps = 0;

        /** @type {number} Total step() calls */
        this.totalSteps = 0;
    }

    /**
     * Get the underlying Rapier World (for body/collider creation).
     * @returns {import('@dimforge/rapier3d-compat').World}
     * @throws {Error} If shutdown
     */
    get world() {
        this._assertAlive();
        return this._world;
    }

    /**
     * Get the RAPIER module (for type constructors like RigidBodyDesc).
     * @returns {import('@dimforge/rapier3d-compat')}
     */
    get RAPIER() {
        return this._RAPIER;
    }

    /**
     * Whether this PhysicsWorld has been shut down.
     * @returns {boolean}
     */
    get destroyed() {
        return this._destroyed;
    }

    /**
     * Step the physics world with sub-stepping and spherical gravity.
     *
     * Sub-stepping divides each server tick into multiple physics steps
     * for better stability (e.g., 20Hz server → 3 sub-steps → 60Hz physics).
     *
     * Spherical gravity is applied per dynamic body per sub-step:
     * force = -normalize(position) * gravity * mass
     *
     * @param {number} [_dtSec] - Ignored (fixed timestep is authoritative).
     *   Accepted for API compatibility with Room tick signature.
     */
    step(_dtSec) {
        this._assertAlive();

        for (let i = 0; i < this.subSteps; i++) {
            this._applySphericalGravity();
            this._world.step(this._eventQueue);
            this.totalSubSteps++;
        }
        this.totalSteps++;
    }

    /**
     * Drain collision events since the last drain.
     * Call after step() to process collision start/end.
     *
     * @param {(handle1: number, handle2: number, started: boolean) => void} callback
     */
    drainCollisionEvents(callback) {
        this._assertAlive();
        this._eventQueue.drainCollisionEvents(callback);
    }

    /**
     * Create a dynamic rigid body at a position with zero gravity scale
     * (since we apply spherical gravity manually).
     *
     * @param {{ x: number, y: number, z: number }} position
     * @returns {import('@dimforge/rapier3d-compat').RigidBody}
     */
    createDynamicBody(position) {
        this._assertAlive();
        const desc = this._RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(position.x, position.y, position.z)
            .setGravityScale(0);
        return this._world.createRigidBody(desc);
    }

    /**
     * Create a kinematic (position-based) rigid body.
     *
     * @param {{ x: number, y: number, z: number }} position
     * @returns {import('@dimforge/rapier3d-compat').RigidBody}
     */
    createKinematicBody(position) {
        this._assertAlive();
        const desc = this._RAPIER.RigidBodyDesc.kinematicPositionBased()
            .setTranslation(position.x, position.y, position.z);
        return this._world.createRigidBody(desc);
    }

    /**
     * Create a fixed (static) rigid body.
     *
     * @param {{ x: number, y: number, z: number }} position
     * @returns {import('@dimforge/rapier3d-compat').RigidBody}
     */
    createFixedBody(position) {
        this._assertAlive();
        const desc = this._RAPIER.RigidBodyDesc.fixed()
            .setTranslation(position.x, position.y, position.z);
        return this._world.createRigidBody(desc);
    }

    /**
     * Add a ball collider to a rigid body.
     *
     * @param {import('@dimforge/rapier3d-compat').RigidBody} body
     * @param {number} radius
     * @param {Object} [options]
     * @param {boolean} [options.activeEvents=false] - Enable collision events
     * @returns {import('@dimforge/rapier3d-compat').Collider}
     */
    addBallCollider(body, radius, options = {}) {
        this._assertAlive();
        const desc = this._RAPIER.ColliderDesc.ball(radius);
        if (options.activeEvents) {
            desc.setActiveEvents(this._RAPIER.ActiveEvents.COLLISION_EVENTS);
        }
        return this._world.createCollider(desc, body);
    }

    /**
     * Add a trimesh collider to a rigid body.
     * Used for static terrain patches. MUST only be attached to fixed bodies.
     *
     * @param {import('@dimforge/rapier3d-compat').RigidBody} body - Must be a fixed body
     * @param {Float32Array} vertices - Flat [x,y,z, x,y,z, ...] vertex positions
     * @param {Uint32Array} indices - Triangle indices [i0,i1,i2, ...]
     * @returns {import('@dimforge/rapier3d-compat').Collider}
     */
    addTrimeshCollider(body, vertices, indices) {
        this._assertAlive();
        const desc = this._RAPIER.ColliderDesc.trimesh(vertices, indices);
        return this._world.createCollider(desc, body);
    }

    /**
     * Remove a rigid body and all its colliders from the world.
     *
     * @param {import('@dimforge/rapier3d-compat').RigidBody} body
     */
    removeBody(body) {
        this._assertAlive();
        this._world.removeRigidBody(body);
    }

    /**
     * Get the rigid body that owns a collider, by collider handle.
     * Returns null if handle is invalid or world is destroyed.
     *
     * @param {number} colliderHandle - Rapier collider handle
     * @returns {import('@dimforge/rapier3d-compat').RigidBody|null}
     */
    getBodyByColliderHandle(colliderHandle) {
        if (this._destroyed) return null;
        const collider = this._world.getCollider(colliderHandle);
        if (!collider) return null;
        return collider.parent();
    }

    /**
     * Get count of rigid bodies currently in the world.
     * @returns {number}
     */
    get bodyCount() {
        if (this._destroyed) return 0;
        return this._world.bodies.len();
    }

    /**
     * Free all WASM resources. PhysicsWorld is unusable after this.
     * Safe to call multiple times (idempotent).
     */
    shutdown() {
        if (this._destroyed) return;
        this._destroyed = true;

        this._eventQueue.free();
        this._world.free();
        this._eventQueue = null;
        this._world = null;
    }

    // ========================================
    // Private
    // ========================================

    /**
     * Apply spherical gravity to every dynamic body in the world.
     * Force direction: toward origin (0,0,0).
     * Force magnitude: gravity * mass.
     *
     * @private
     */
    _applySphericalGravity() {
        const G = this.gravityMagnitude;
        if (G <= 0) return;

        this._world.bodies.forEach((body) => {
            // Only apply to dynamic (not kinematic or fixed) bodies
            if (!body.isDynamic()) return;

            const pos = body.translation();
            const lenSq = pos.x * pos.x + pos.y * pos.y + pos.z * pos.z;
            if (lenSq < 1e-6) return; // At origin — skip

            const len = Math.sqrt(lenSq);
            const mass = body.mass();
            const force = G * mass;

            body.addForce({
                x: (-pos.x / len) * force,
                y: (-pos.y / len) * force,
                z: (-pos.z / len) * force
            }, true);
        });
    }

    /**
     * @throws {Error} If world has been shutdown
     * @private
     */
    _assertAlive() {
        if (this._destroyed) {
            throw new Error('PhysicsWorld has been shut down.');
        }
    }
}
