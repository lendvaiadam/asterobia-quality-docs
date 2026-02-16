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
                const ndir = Vec3.normalize(dir);
                unit.spawnOnSurface(dir, this.terrain);
                const up = Vec3.normalize(unit.position);
                console.log(`[Room] U${mu.id} spawn: dir=(${ndir.x.toFixed(3)},${ndir.y.toFixed(3)},${ndir.z.toFixed(3)}) up=(${up.x.toFixed(3)},${up.y.toFixed(3)},${up.z.toFixed(3)}) q=(${unit.orientation.x.toFixed(3)},${unit.orientation.y.toFixed(3)},${unit.orientation.z.toFixed(3)},${unit.orientation.w.toFixed(3)})`);
            } else {
                // Fallback: equatorial distribution
                const idx = this.units.length;
                const angle = idx * (Math.PI * 2 / this.maxPlayers);
                const dir = { x: Math.sin(angle), y: 0, z: Math.cos(angle) };
                unit.spawnOnSurface(dir, this.terrain);
            }

            // LAZY_PHYSICS_GATING: float 10m above terrain to avoid spawn-inside-terrain ejection.
            // Units float via altitude math; DROP test triggers DYNAMIC fall.
            if (this._enablePhysics) {
                unit.altitude = 10.0;
                unit._reprojectToTerrain();
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

            // LAZY: no rigid bodies at spawn. Rapier is per-unit, toggled from debug panel.
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

            this._checkRolloverTriggers();

            // Pre-step: kinematic proximity collisions (unit↔unit, unit↔obstacle)
            if (this.collisions) {
                this.collisions.checkKinematicCollisions(this.units, this.physics);
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

            // Post-step: sync DYNAMIC positions FROM Rapier, update takeover gate + blend.
            for (const unit of this.units) {
                if (unit.physicsMode !== 'DYNAMIC') continue;

                // If blending down, user is taking over — skip Rapier sync, update blend
                if (unit._blendDirection === 'BLEND_DOWN') {
                    unit.updateBlend(dtSec, this.physics);
                    continue;
                }

                const velocitySettled = unit.syncFromRigidBody();

                // Diagnostic: log DYNAMIC unit position for first 20 ticks
                if (unit._dynamicTickCounter == null) unit._dynamicTickCounter = 0;
                unit._dynamicTickCounter++;
                if (unit._dynamicTickCounter <= 20) {
                    const vel = unit.rigidBody ? unit.rigidBody.linvel() : { x: 0, y: 0, z: 0 };
                    const r = Vec3.length(unit.position);
                    const dir = Vec3.normalize(unit.position);
                    const terrainR = this.terrain ? this.terrain.getRadiusAt(dir) : 0;
                    console.log(`[Room] DYNAMIC U${unit.id} tick#${unit._dynamicTickCounter}: r=${r.toFixed(3)} terrainR=${terrainR.toFixed(3)} alt=${(r - terrainR).toFixed(3)} vel=(${vel.x.toFixed(2)},${vel.y.toFixed(2)},${vel.z.toFixed(2)}) settled=${velocitySettled}`);
                }

                unit.isTakeoverReady(); // updates _takeoverReadyCounter each tick

                // Natural settle: upright + slow → exit immediately
                if (unit.isUprightAndSlow()) {
                    unit.exitDynamic(this.physics);
                    continue;
                }

                // Fallback settle: velocity below threshold for SETTLE_TICK_COUNT OR Rapier sleep
                if (velocitySettled) {
                    unit.exitDynamic(this.physics);
                }
            }
        }

        // 3c. SAFETY: detect units clipped inside planet and teleport back
        if (this.terrain) {
            for (const unit of this.units) {
                if (unit.physicsMode !== 'DYNAMIC') continue;
                const r = Vec3.length(unit.position);
                const dir = Vec3.normalize(unit.position);
                const terrainR = this.terrain.getRadiusAt(dir);
                if (r < terrainR) {
                    // Unit is INSIDE the planet — emergency teleport above terrain
                    const safeR = terrainR + HeadlessUnit.CUBOID_HY + 0.5;
                    unit.position = Vec3.scale(dir, safeR);
                    if (unit.rigidBody) {
                        unit.rigidBody.setTranslation(unit.position, true);
                        unit.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
                        unit.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
                    }
                    console.log(`[Room] SAFETY U${unit.id}: inside planet r=${r.toFixed(1)} < terrainR=${terrainR.toFixed(1)}, teleported to ${safeR.toFixed(1)}`);
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
    /**
     * Toggle physics on a unit (KINEMATIC → DYNAMIC or DYNAMIC → KINEMATIC).
     * Used by PHY ON/OFF button in PhysicsDebugOverlay.
     * @param {number} unitId
     */
    toggleUnitPhysics(unitId) {
        const unit = this.units.find(u => u && u.id === unitId);
        if (!unit) return;
        if (!this.physics) {
            console.log(`[Room] toggleUnitPhysics: physics not initialized`);
            return;
        }
        if (unit.physicsMode === 'DYNAMIC') {
            unit.exitDynamic(this.physics);
            console.log(`[Room] U${unitId}: DYNAMIC → KINEMATIC`);
        } else {
            // Reset altitude so unit falls to ground (not back to spawn height)
            unit.altitude = 0;
            unit.enterDynamic(this.physics);
            console.log(`[Room] U${unitId}: KINEMATIC → DYNAMIC (drop)`);
        }
    }

    /**
     * DROP TEST: lift unit 10m above terrain, then let kinematic gravity bring it back.
     * No Rapier — uses existing AIRBORNE mode (altitude + verticalVelocity).
     * @param {number} unitId
     */
    _devDropTest(unitId, clientPos) {
        const unit = this.units.find(u => u && u.id === unitId);
        if (!unit) { console.log(`[Room] DROP_TEST: unit ${unitId} not found`); return; }
        if (!this.terrain) { console.log(`[Room] DROP_TEST: no terrain`); return; }
        // Sync server unit to HOST client's current position
        this._syncClientPos(unit, clientPos);

        // Set altitude and let kinematic gravity handle the fall
        unit.altitude = 10.0;
        unit.verticalVelocity = 0;
        unit.mode = 'AIRBORNE';
        unit.speed = 0;
        unit.velocity = { x: 0, y: 0, z: 0 };
        unit._reprojectToTerrain();
        unit._updateOrientation();
        console.log(`[Room] DROP_TEST U${unitId}: altitude=${unit.altitude}m, mode=AIRBORNE (kinematic gravity)`);
    }

    /** Set unit altitude above terrain (debug slider). Accepts client pos to sync. */
    _devSetAltitude(unitId, altitude, clientPos) {
        const unit = this.units.find(u => u && u.id === unitId);
        if (!unit) return;
        // Sync server position to client's current position (HOST doesn't send MOVE_INPUT)
        if (clientPos && isFinite(clientPos.px) && isFinite(clientPos.py) && isFinite(clientPos.pz)) {
            unit.position = { x: clientPos.px, y: clientPos.py, z: clientPos.pz };
        }
        unit.altitude = Math.max(0, Math.min(50, altitude));
        unit._reprojectToTerrain();
        unit._updateOrientation();
    }

    /** Toggle Rapier on/off for a single unit. */
    _devToggleRapier(unitId, enable, clientPos) {
        const unit = this.units.find(u => u && u.id === unitId);
        if (!unit || !this.physics) return;

        if (enable && !unit.rigidBody) {
            // Sync server unit to HOST client's current position/orientation
            this._syncClientPos(unit, clientPos);
            // ON: create body at current position, enter DYNAMIC (gravity drop)
            this._attachRigidBody(unit);
            unit.enterDynamic(this.physics);
            console.log(`[Room] RAPIER ON U${unitId} pos=(${unit.position.x.toFixed(2)},${unit.position.y.toFixed(2)},${unit.position.z.toFixed(2)})`);
        } else if (!enable && unit.rigidBody) {
            // OFF: exit dynamic, remove body completely
            if (unit.physicsMode === 'DYNAMIC' || unit.physicsMode === 'SETTLED') {
                unit.exitDynamic(this.physics);
            }
            this._bodyToUnit.delete(unit.rigidBody.handle);
            this.physics.removeBody(unit.rigidBody);
            unit.rigidBody = null;
            console.log(`[Room] RAPIER OFF U${unitId}`);
        }
    }

    _devTriggerExplosion(unitId, radius = 8, strength = 80, clientPos) {
        const unit = this.units.find(u => u && u.id === unitId);
        if (!unit) {
            console.log(`[Room] EXPLODE: unit ${unitId} not found. Available: [${this.units.map(u => u?.id).join(',')}]`);
            return null;
        }
        if (!this.physics) {
            console.log(`[Room] EXPLODE: physics not initialized`);
            return null;
        }
        // Sync server unit to HOST client's current position
        this._syncClientPos(unit, clientPos);

        // Explosion direction: radial "up" (away from planet center).
        const up = Vec3.normalize(unit.position);
        const impulse = Vec3.scale(up, strength);

        console.log(`[Room] EXPLODE U${unitId}: up=(${up.x.toFixed(3)},${up.y.toFixed(3)},${up.z.toFixed(3)}) strength=${strength}`);

        unit.enterDynamic(this.physics, impulse);

        // Apply random torque impulse for spin effect
        if (unit.rigidBody) {
            const torqueMag = 3.0;
            unit.rigidBody.applyTorqueImpulse({
                x: (Math.random() - 0.5) * torqueMag,
                y: (Math.random() - 0.5) * torqueMag,
                z: (Math.random() - 0.5) * torqueMag
            }, true);
        }

        return { unitId, impulse };
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
     * Sync a HeadlessUnit to the HOST client's current world position (and optionally orientation).
     * HOST drives units locally without MOVE_INPUT, so the server unit stays at spawn.
     * Dev commands must call this before acting on unit position.
     *
     * @param {HeadlessUnit} unit
     * @param {Object} [clientPos] - { px, py, pz, qx?, qy?, qz?, qw? }
     * @private
     */
    _syncClientPos(unit, clientPos) {
        if (!clientPos) return;
        if (isFinite(clientPos.px) && isFinite(clientPos.py) && isFinite(clientPos.pz)) {
            unit.position = { x: clientPos.px, y: clientPos.py, z: clientPos.pz };
        }
        if (isFinite(clientPos.qx) && isFinite(clientPos.qy) && isFinite(clientPos.qz) && isFinite(clientPos.qw)) {
            unit.orientation = { x: clientPos.qx, y: clientPos.qy, z: clientPos.qz, w: clientPos.qw };
        }
        // Ensure terrain colliders exist around the synced position
        if (this.terrainColliders) {
            this.terrainColliders.ensurePatchesAround(unit.position);
        }
    }

    /**
     * Attach a Rapier rigid body to a unit (kinematic by default).
     * No-op if physics is not enabled. Body starts at unit's current position.
     * Cuboid collider sized to HeadlessUnit half-extents for stable terrain contact.
     *
     * @param {HeadlessUnit} unit
     * @private
     */
    _attachRigidBody(unit) {
        if (!this.physics) return;

        const body = this.physics.createKinematicBody(unit.position);
        // Cuboid collider: stable flat contact with terrain trimesh (unlike ball).
        // Sensor in KINEMATIC mode: no physical blocking, only event detection.
        // enterDynamic() switches to non-sensor for Rapier physics.
        this.physics.addCuboidCollider(body,
            HeadlessUnit.CUBOID_HX,
            HeadlessUnit.CUBOID_HY,
            HeadlessUnit.CUBOID_HZ,
            {
                activeEvents: true,
                sensor: true,
                density: 5.0,        // ~10kg for a small vehicle
                friction: 0.6,       // moderate grip on terrain
                restitution: 0.15    // low bounce — doesn't ping-pong
            }
        );
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
     * Set rollover threshold (degrees) for all units in this room.
     * @param {number} degrees - Angle in degrees (5-90)
     */
    setRolloverThreshold(degrees) {
        HeadlessUnit.ROLLOVER_THRESHOLD_RAD = (degrees * Math.PI) / 180;
    }

    /**
     * Check slope triggers for all KINEMATIC units. If slope exceeds threshold
     * for enough consecutive ticks, transition to DYNAMIC with down-slope impulse.
     *
     * @private
     */
    /**
     * Check rollover for each KINEMATIC unit. If the unit's vertical axis
     * deviates too far from the planet's radial "up", switch to DYNAMIC
     * with no impulse — gravity naturally topples the unit.
     * @private
     */
    _checkRolloverTriggers() {
        for (const unit of this.units) {
            if (unit.checkRolloverTrigger()) {
                console.log(`[Room] ROLLOVER U${unit.id}: entering DYNAMIC (slope trigger)`);
                unit.enterDynamic(this.physics);
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
