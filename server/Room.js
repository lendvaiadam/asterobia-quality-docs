/**
 * Room - Represents one active match/game session on the server.
 *
 * Owns:
 *   - A SimLoop instance (fixed timestep, server-driven)
 *   - A CommandQueue for incoming player inputs
 *   - A list of connected players (slot -> endpoint mapping)
 *   - Game state: HeadlessUnit[] (pure data, no Three.js)
 *   - A ServerTerrain instance (same procedural sphere as client)
 *
 * Units spawn ON the terrain surface and move tangentially.
 *
 * Lifecycle: WAITING -> RUNNING -> ENDED
 *   WAITING: Room created, no units yet. Waits for SPAWN_MANIFEST.
 *   RUNNING: Manifest received, units exist, ticking at 20Hz.
 *   ENDED:   Stopped, cleaned up.
 *
 * @module server/Room
 */

import { SimLoop } from '../src/SimCore/runtime/SimLoop.js';
import { CommandQueue, CommandType } from '../src/SimCore/runtime/CommandQueue.js';
import { HeadlessUnit } from './HeadlessUnit.js';
import { ServerTerrain } from './ServerTerrain.js';
import { PhysicsWorld } from './PhysicsWorld.js';
import { TerrainColliderManager } from './TerrainColliderManager.js';
import { PhysicsEventService } from './PhysicsEventService.js';
import { CollisionService } from './CollisionService.js';
import { Vec3 } from './SphereMath.js';

/** @typedef {'WAITING' | 'RUNNING' | 'ENDED'} RoomState */

export class Room {
    /**
     * @param {string} roomId - Unique room identifier
     * @param {Object} [options]
     * @param {number} [options.tickMs=50] - Fixed timestep in ms (default 50ms = 20 Hz)
     * @param {number} [options.maxPlayers=10] - Maximum player slots
     * @param {Object} [options.terrainParams] - Terrain parameters (passed to ServerTerrain)
     * @param {Function} [options.broadcast] - Callback for broadcasting snapshots
     * @param {boolean} [options.enablePhysics=false] - Initialize Rapier PhysicsWorld (Phase 3)
     * @param {Object} [options.physicsOptions] - Options for PhysicsWorld (subSteps, physicsHz, gravity)
     */
    constructor(roomId, options = {}) {
        /** @type {string} */
        this.roomId = roomId;

        /** @type {SimLoop} Fixed-timestep simulation loop */
        this.simLoop = new SimLoop({ fixedDtMs: options.tickMs || 50 });

        /** @type {CommandQueue} Deterministic command buffer */
        this.commandQueue = new CommandQueue();

        /** @type {Map<number, { id: string, name: string, endpoint: any }>} slot -> player info */
        this.players = new Map();

        /** @type {HeadlessUnit[]} All units in the room (pure data) */
        this.units = [];

        /** @type {RoomState} Current room lifecycle state */
        this.state = 'WAITING';

        /** @type {number} Maximum player count */
        this.maxPlayers = options.maxPlayers || 10;

        /** @type {number} Next slot to assign */
        this._nextSlot = 1;

        /** @type {Function|null} Optional broadcast callback for sending snapshots */
        this._broadcastFn = options.broadcast || null;

        /** @type {ReturnType<typeof setInterval>|null} Server tick interval handle */
        this._tickInterval = null;

        /** @type {ServerTerrain} Authoritative terrain (same math as client) */
        this.terrain = new ServerTerrain(options.terrainParams);

        /** @type {boolean} Whether Rapier physics is enabled for this room */
        this._enablePhysics = !!options.enablePhysics;

        /** @type {Object} Physics configuration (passed to PhysicsWorld.create) */
        this._physicsOptions = options.physicsOptions || {};

        /** @type {PhysicsWorld|null} Rapier physics world (null until initialized) */
        this.physics = null;

        /** @type {TerrainColliderManager|null} Terrain collider patch manager (null until initialized) */
        this.terrainColliders = null;

        /**
         * Body handle → HeadlessUnit lookup (populated when rigid bodies are attached).
         * @type {Map<number, HeadlessUnit>}
         */
        this._bodyToUnit = new Map();

        /**
         * Static obstacle registry (rocks, etc). Body handle → obstacle info.
         * @type {Map<number, { body: import('@dimforge/rapier3d-compat').RigidBody, position: {x:number,y:number,z:number} }>}
         */
        this._obstacles = new Map();

        /** @type {number} Hard cap on static obstacles */
        this._maxObstacles = options.maxObstacles || 64;

        /** @type {PhysicsEventService|null} Gameplay impulse/event service (null until physics init) */
        this.physicsEvents = null;

        /** @type {CollisionService|null} Kinematic collision + mine service (null until physics init) */
        this.collisions = null;
    }

    /**
     * Add a player to the room and assign a slot.
     *
     * @param {string} playerId - Unique player identifier
     * @param {string} name - Display name
     * @param {*} endpoint - Transport endpoint (WebSocket, MemoryTransport, etc.)
     * @returns {number} Assigned slot number
     * @throws {Error} If room is full
     */
    addPlayer(playerId, name, endpoint) {
        if (this.players.size >= this.maxPlayers) {
            throw new Error(`Room ${this.roomId} is full (${this.maxPlayers} max)`);
        }

        const slot = this._nextSlot++;
        this.players.set(slot, { id: playerId, name, endpoint });
        return slot;
    }

    /**
     * Create a HeadlessUnit for a player, spawned ON the terrain surface.
     *
     * Units are distributed around the equator, spaced by slot index.
     * Each unit spawns at the terrain surface height for its direction.
     *
     * @param {number} slot - Player slot
     * @param {number} unitId - Deterministic entity ID
     * @param {Object} [options]
     * @param {number} [options.modelIndex=0] - Client model index for rendering
     * @returns {HeadlessUnit}
     */
    createUnitForPlayer(slot, unitId, options = {}) {
        const unit = new HeadlessUnit(unitId, slot, { modelIndex: options.modelIndex ?? 0 });

        // Distribute spawn positions around the equator
        const angle = slot * (Math.PI * 2 / this.maxPlayers);
        const direction = { x: Math.sin(angle), y: 0, z: Math.cos(angle) };

        unit.spawnOnSurface(direction, this.terrain);
        this.units.push(unit);
        this._attachRigidBody(unit);
        return unit;
    }

    /**
     * Create units from a SPAWN_MANIFEST sent by the host client.
     * Uses client-provided IDs and positions — this guarantees 1:1 mapping.
     *
     * @param {Array<{id: number, ownerSlot: number, modelIndex: number, px?: number, py?: number, pz?: number}>} manifestUnits
     * @returns {HeadlessUnit[]} Created units
     */
    createUnitsFromManifest(manifestUnits) {
        const created = [];
        for (const mu of manifestUnits) {
            const unit = new HeadlessUnit(mu.id, mu.ownerSlot, { modelIndex: mu.modelIndex ?? 0 });

            // If manifest includes a position, use it as spawn direction
            if (mu.px != null && mu.py != null && mu.pz != null) {
                const dir = { x: mu.px, y: mu.py, z: mu.pz };
                unit.spawnOnSurface(dir, this.terrain);
            } else {
                // Fallback: equatorial distribution
                const idx = this.units.length;
                const angle = idx * (Math.PI * 2 / this.maxPlayers);
                const dir = { x: Math.sin(angle), y: 0, z: Math.cos(angle) };
                unit.spawnOnSurface(dir, this.terrain);
            }

            this.units.push(unit);
            this._attachRigidBody(unit);
            created.push(unit);
        }
        return created;
    }

    /**
     * Remove a player from the room.
     *
     * @param {number} slot - Player slot to remove
     */
    removePlayer(slot) {
        this.players.delete(slot);
    }

    /**
     * Transition room to RUNNING state.
     * Wires up the SimLoop onSimTick callback.
     * If enablePhysics was set, initializes the Rapier PhysicsWorld first.
     *
     * @returns {Promise<void>} Resolves when room is running (async for physics init)
     */
    async start() {
        if (this.state !== 'WAITING') {
            throw new Error(`Cannot start room ${this.roomId} in state ${this.state}`);
        }

        // Phase 3: Initialize Rapier physics if enabled
        if (this._enablePhysics) {
            this.physics = await PhysicsWorld.create(this._physicsOptions);
            this.terrainColliders = new TerrainColliderManager(
                this.physics, this.terrain, this._physicsOptions.terrain
            );
            this.physicsEvents = new PhysicsEventService(this._physicsOptions.events);
            this.collisions = new CollisionService(this._physicsOptions.collisions);

            // Attach rigid bodies to units created before physics init (SPAWN_MANIFEST flow)
            for (const unit of this.units) {
                if (!unit.rigidBody) {
                    this._attachRigidBody(unit);
                }
            }
        }

        this.state = 'RUNNING';

        // Wire SimLoop tick callback
        this.simLoop.onSimTick = (fixedDtSec, tickCount) => {
            this._onSimTick(fixedDtSec, tickCount);
        };

        // Server-driven tick: push time into SimLoop at fixed intervals
        const tickMs = this.simLoop.fixedDtMs;

        this._tickInterval = setInterval(() => {
            const nowMs = Date.now();
            this.simLoop.step(nowMs);
        }, tickMs);
    }

    /**
     * Transition room to ENDED state and clean up.
     */
    stop() {
        this.state = 'ENDED';

        if (this._tickInterval !== null) {
            clearInterval(this._tickInterval);
            this._tickInterval = null;
        }

        this.simLoop.onSimTick = null;
        this.simLoop.onRender = null;

        // Phase 3: Free Rapier resources
        this._obstacles.clear();
        this._bodyToUnit.clear();
        if (this.terrainColliders) {
            this.terrainColliders.destroyAll();
            this.terrainColliders = null;
        }
        if (this.physics) {
            this.physics.shutdown();
            this.physics = null;
        }
    }

    /**
     * Called by SimLoop on each fixed simulation tick.
     * Processes commands and advances unit state on the spherical terrain.
     *
     * @param {number} dtSec - Fixed timestep in seconds
     * @param {number} tickCount - Current tick number
     * @private
     */
    _onSimTick(dtSec, tickCount) {
        // 1. Flush commands ready for this tick
        const commands = this.commandQueue.flush(tickCount);

        // 2. Route commands to target units
        for (const cmd of commands) {
            if (cmd.type === 'MOVE_INPUT') {
                // Route by unitId if present, else fall back to ownerSlot
                let unit = null;
                if (cmd.unitId != null) {
                    unit = this.units.find(u => u.id === cmd.unitId);
                    // Authority check: sender must own this unit
                    if (unit && cmd.sourceSlot != null && unit.ownerSlot !== cmd.sourceSlot) {
                        unit = null; // Rejected: not your unit
                    }
                } else if (cmd.sourceSlot != null) {
                    // Legacy fallback: route by ownerSlot (pre-manifest mode)
                    unit = this.units.find(u => u.ownerSlot === cmd.sourceSlot);
                }
                if (unit) {
                    unit.applyInput(cmd);
                }
            } else if (cmd.type === 'PATH_DATA') {
                // Phase 2B: Set path on target unit (ownership validated by GameServer)
                const unit = cmd.unitId != null
                    ? this.units.find(u => u.id === cmd.unitId)
                    : null;
                if (unit && cmd.sourceSlot != null && unit.ownerSlot === cmd.sourceSlot) {
                    unit.setPath(cmd.waypoints, cmd.closed);
                }
            }
        }

        // 3. Update unit positions (spherical terrain movement)
        for (const unit of this.units) {
            unit.updatePosition(dtSec);
        }

        // 3b. Step physics world (Phase 3)
        if (this.physics) {
            // Ensure terrain collider patches around unit positions
            if (this.terrainColliders) {
                const positions = this.units.map(u => u.position);
                for (const pos of positions) {
                    this.terrainColliders.ensurePatchesAround(pos);
                }
                // Evict distant patches every 20 ticks (~1 second)
                if (tickCount % 20 === 0 && positions.length > 0) {
                    this.terrainColliders.evictDistant(positions);
                }
            }

            // Pre-step: check slope triggers (may transition units to DYNAMIC)
            // DISABLED for HU-test: auto-triggers cause chaos at spawn.
            // TODO: Re-enable when spawn spacing and slope debounce are tuned.
            // this._checkSlopeTriggers();

            // Pre-step: kinematic proximity collisions (unit↔unit, unit↔obstacle)
            // Only check obstacle and mine contacts (CMD_ADMIN spawned).
            // Unit↔unit auto-collision disabled for same reason as slope triggers.
            if (this.collisions) {
                // this.collisions.checkKinematicCollisions(this.units, this.physics);
                this.collisions.checkObstacleCollisions(this.units, this._obstacles, this.physics);
                this.collisions.checkMineContacts(this.units, this.physics, this.physicsEvents);
            }

            // Pre-step: sync KINEMATIC unit positions TO their rigid bodies
            for (const unit of this.units) {
                unit.syncToRigidBody();
            }

            this.physics.step(dtSec);

            // Post-step: handle collision events (may transition units to DYNAMIC)
            this._handleCollisionEvents();

            // Post-step: sync DYNAMIC unit positions FROM their rigid bodies + settle check
            for (const unit of this.units) {
                if (unit.physicsMode === 'DYNAMIC') {
                    const settled = unit.syncFromRigidBody();
                    if (settled) {
                        unit.settleDynamic(this.physics);
                    }
                }
            }
        }

        // 4. Broadcast SERVER_SNAPSHOT to all connected clients
        this._broadcastSnapshot(tickCount);
    }

    /**
     * Broadcast a SERVER_SNAPSHOT to all connected players.
     * Only runs if a broadcast function was provided.
     *
     * @param {number} tickCount - Current tick number
     * @private
     */
    _broadcastSnapshot(tickCount) {
        if (!this._broadcastFn) return;

        const snapshot = {
            type: 'SERVER_SNAPSHOT',
            version: 1,
            tick: tickCount,
            serverTimeMs: Date.now(),
            units: this.units.map(u => u.toSnapshot())
        };

        this._broadcastFn(this.roomId, snapshot);
    }

    /**
     * Get a serializable state snapshot of the room.
     * Used for state sync to clients.
     *
     * @returns {{ tick: number, units: Object[], players: [number, Object][] }}
     */
    getSnapshot() {
        return {
            tick: this.simLoop.getTickCount(),
            units: this.units.map(u => u.toSnapshot()),
            players: Array.from(this.players.entries())
        };
    }

    /**
     * Accept an input command from a client.
     * The command is buffered in the CommandQueue for deterministic processing.
     *
     * @param {number} slot - Player slot that sent the command (transport-authenticated)
     * @param {Object} command - Command object (must have .type from CommandType)
     */
    receiveInput(slot, command) {
        // Tag command with source slot for authority checks
        command.sourceSlot = slot;
        this.commandQueue.enqueue(command);
    }

    // ========================================
    // Gameplay physics API (delegates to PhysicsEventService)
    // ========================================

    /**
     * Trigger a radial explosion at a world position.
     * All KINEMATIC units within radius are knocked back with linear falloff.
     *
     * No-op if physics is not enabled.
     *
     * @param {{ x: number, y: number, z: number }} center - World position of explosion
     * @param {number} radius - Blast radius (world units)
     * @param {number} strength - Base impulse magnitude at center
     * @returns {import('./PhysicsEventService.js').ImpulseResult[]} Affected units
     */
    triggerExplosion(center, radius, strength) {
        if (!this.physicsEvents || !this.physics) return [];

        return this.physicsEvents.applyRadialImpulse({
            center,
            radius,
            strength,
            units: this.units,
            physicsWorld: this.physics
        });
    }

    /**
     * Dev/test verification hook: trigger an explosion centered on a unit.
     * Uses moderate defaults (radius=8, strength=6) for visual verification.
     *
     * Server-only. No protocol message — callable from test harness or console.
     *
     * @param {number} unitId - Target unit ID (explosion centered on this unit)
     * @param {number} [radius=8] - Blast radius
     * @param {number} [strength=6] - Impulse strength
     * @returns {import('./PhysicsEventService.js').ImpulseResult[]|null} Results, or null if unit not found
     */
    _devTriggerExplosion(unitId, radius = 8, strength = 6) {
        const unit = this.units.find(u => u && u.id === unitId);
        if (!unit) return null;
        if (!this.physics) return null;

        // Direct upward impulse on target unit (radial blast skips zero-distance)
        const up = Vec3.normalize(unit.position);
        const impulse = Vec3.scale(up, strength);
        unit.enterDynamic(this.physics, impulse);

        // Also blast nearby units (other units within radius)
        const results = this.triggerExplosion(unit.position, radius, strength);
        return results;
    }

    /**
     * Place a mine at a world position.
     * No-op if physics is not enabled.
     *
     * @param {{ x: number, y: number, z: number }} position
     * @param {Object} [options] - Override mine defaults (triggerRadius, upwardImpulse, etc.)
     * @returns {number|null} Mine ID, or null
     */
    addMine(position, options) {
        if (!this.collisions) return null;
        return this.collisions.addMine(position, options);
    }

    /**
     * Remove a mine by ID.
     * @param {number} id
     * @returns {boolean}
     */
    removeMine(id) {
        if (!this.collisions) return false;
        return this.collisions.removeMine(id);
    }

    /**
     * Attach a Rapier rigid body to a unit (kinematic by default).
     * No-op if physics is not enabled. Body starts at unit's current position.
     * Ball collider added for collision detection with terrain and other units.
     *
     * @param {HeadlessUnit} unit
     * @private
     */
    _attachRigidBody(unit) {
        if (!this.physics) return;

        const body = this.physics.createKinematicBody(unit.position);
        // Sensor: detects collisions for events but does NOT physically block movement.
        // Without sensor, terrain trimesh collider fights with kinematic position sync.
        this.physics.addBallCollider(body, 0.5, { activeEvents: true, sensor: true });
        unit.rigidBody = body;
        this._bodyToUnit.set(body.handle, unit);
    }

    /**
     * Add a static obstacle (rock) at a position on the terrain.
     * Creates a fixed body with a ball collider. Collision events enabled.
     * Returns the body handle for later removal, or null if at cap / no physics.
     *
     * @param {{ x: number, y: number, z: number }} position - World position
     * @param {number} [radius=1.0] - Collider radius
     * @returns {number|null} Body handle, or null
     */
    addObstacle(position, radius = 1.0) {
        if (!this.physics) return null;
        if (this._obstacles.size >= this._maxObstacles) return null;

        const body = this.physics.createFixedBody(position);
        this.physics.addBallCollider(body, radius, { activeEvents: true });
        this._obstacles.set(body.handle, { body, position: { ...position } });
        return body.handle;
    }

    /**
     * Remove a static obstacle by body handle.
     * @param {number} handle
     */
    removeObstacle(handle) {
        const info = this._obstacles.get(handle);
        if (!info || !this.physics) return;
        this.physics.removeBody(info.body);
        this._obstacles.delete(handle);
    }

    /**
     * Check slope triggers for all KINEMATIC units. If slope exceeds threshold
     * for enough consecutive ticks, transition to DYNAMIC with down-slope impulse.
     *
     * @private
     */
    _checkSlopeTriggers() {
        for (const unit of this.units) {
            const impulse = unit.checkSlopeTrigger();
            if (impulse) {
                unit.enterDynamic(this.physics, impulse);
            }
        }
    }

    /**
     * Drain Rapier collision events and trigger DYNAMIC transitions for
     * unit-unit and unit-obstacle collisions.
     *
     * @private
     */
    _handleCollisionEvents() {
        this.physics.drainCollisionEvents((handle1, handle2, started) => {
            if (!started) return; // Only handle collision start

            const body1 = this.physics.getBodyByColliderHandle(handle1);
            const body2 = this.physics.getBodyByColliderHandle(handle2);
            if (!body1 || !body2) return;

            const unitA = this._bodyToUnit.get(body1.handle);
            const unitB = this._bodyToUnit.get(body2.handle);
            const obsA = this._obstacles.get(body1.handle);
            const obsB = this._obstacles.get(body2.handle);

            if (unitA && unitB) {
                // Unit-unit collision: mutual knockback
                this._applyCollisionKnockback(unitA, unitB);
            } else if (unitA && obsB) {
                // Unit hits obstacle
                this._applyObstacleKnockback(unitA, obsB.position);
            } else if (unitB && obsA) {
                // Unit hits obstacle (reversed order)
                this._applyObstacleKnockback(unitB, obsA.position);
            }
        });
    }

    /**
     * Apply mutual knockback impulse between two colliding units.
     * @param {HeadlessUnit} unitA
     * @param {HeadlessUnit} unitB
     * @private
     */
    _applyCollisionKnockback(unitA, unitB) {
        const sep = Vec3.sub(unitA.position, unitB.position);
        const len = Vec3.length(sep);
        if (len < 1e-6) return;

        const dir = Vec3.scale(sep, 1 / len);
        const strength = HeadlessUnit.COLLISION_IMPULSE_STRENGTH;

        if (unitA.physicsMode === 'KINEMATIC' && unitA._reentryCooldown <= 0) {
            unitA.enterDynamic(this.physics, Vec3.scale(dir, strength));
        }
        if (unitB.physicsMode === 'KINEMATIC' && unitB._reentryCooldown <= 0) {
            unitB.enterDynamic(this.physics, Vec3.scale(dir, -strength));
        }
    }

    /**
     * Apply knockback impulse from an obstacle collision.
     * @param {HeadlessUnit} unit
     * @param {{ x: number, y: number, z: number }} obstaclePos
     * @private
     */
    _applyObstacleKnockback(unit, obstaclePos) {
        if (unit.physicsMode !== 'KINEMATIC') return;
        if (unit._reentryCooldown > 0) return;

        const sep = Vec3.sub(unit.position, obstaclePos);
        const len = Vec3.length(sep);
        if (len < 1e-6) return;

        const dir = Vec3.scale(sep, 1 / len);
        unit.enterDynamic(this.physics, Vec3.scale(dir, HeadlessUnit.COLLISION_IMPULSE_STRENGTH));
    }
}
