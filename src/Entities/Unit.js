import * as THREE from 'three';
import { SphericalMath } from '../Math/SphericalMath.js';
import { rngNext, rngNextInt } from '../SimCore/runtime/SeededRNG.js';

export class Unit {
    /**
     * @param {Object} planet - Planet reference for terrain
     * @param {number} id - Deterministic entity ID from SimCore.nextEntityId()
     */
    constructor(planet, id) {
        this.planet = planet;
        this.speed = 5.0;
        this.currentSpeed = 0.0; // Actual speed for audio/visuals
        this.turnSpeed = 2.0;
        this.currentTurnSpeed = 0.0; // Smoothed turn velocity for inertia
        this.groundOffset = 0.22; // Hover height
        this.smoothingRadius = 0.0; // Default 0, adjustable via slider

        // Speed control for hover slowdown
        this.speedFactor = 1.0; // Start at full speed
        this.hoverState = false;

        // Water capabilities (for future use)
        this.canWalkUnderwater = false; // Can walk on sea floor
        this.canSwim = false; // Can swim on water surface

        // Water reaction state machine
        // States: 'normal', 'wading', 'escaping', 'shaking', 'backing', 'stopped'
        this.waterState = 'normal';
        this.waterSlowdownFactor = 1.0;
        this.isWaterPushing = false; // True during automated pushback (blocks user input)
        this.waterShakeTimer = 0;
        this.waterBackupTimer = 0;
        this.waterWadeTimer = 0; // Time spent wading in water
        this.waterEntryPosition = null; // Position where we entered water

        this.mesh = this.createMesh();
        
        // EXPLICIT: Ensure glowRing is attached to mesh (fixes scene hierarchy bug)
        if (this.glowRing && this.mesh) {
            this.mesh.add(this.glowRing);
        }

        // State
        // Start at North Pole for simplicity, or any point
        this.position = new THREE.Vector3(0, 10, 0);

        // Initial Orientation: Up aligned with Y (Normal at pole), Forward aligned with Z
        this.quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0);

        // Initialize velocity vectors
        this.velocity = new THREE.Vector3(0, 0, 0);
        this.velocityDirection = new THREE.Vector3(0, 0, 1);

        // Align to initial surface
        this.snapToSurface();
        this.alignToSurfaceInitial();

        // R008: Sync mesh position immediately after construction
        // This ensures the mesh is positioned correctly before first render/interpolation
        this.mesh.position.copy(this.position);

        // === PER-UNIT COMMAND QUEUE (Independent waypoints) ===
        this.waypointControlPoints = [];
        this.waypointMarkers = []; // Visual markers
        this.waypointCurveLine = null;

        // === NEW WAYPOINT SYSTEM (ID-BASED) ===
        // Replaces simple vectors with Objects: { id, name, position, originalIndex }
        this.waypoints = [];
        this.targetWaypointId = null; // ID of the station we are currently heading to (ORANGE)
        this.lastWaypointId = null;   // ID of the station we just left (BLUE)

        this.loopingEnabled = false;
        this.isPathClosed = false;
        this.lastCommittedControlPointCount = 0;
        this.passedControlPointCount = 0;

        // === ANCHOR INDEX SYSTEM ===
        // Tracks which control point was last passed - persists across path edits
        this.lastPassedControlPointIndex = -1; // -1 = hasn't started, 0+ = control point index
        this.targetControlPointIndex = 0; // Current target control point

        // === SEGMENT-BASED PATH TRACKING (NEW) ===
        // Track position as: which segment (A→B) and progress (0-1) within it
        this.currentSegmentIndex = 0;  // Index of START control point of current segment
        this.segmentProgress = 0.0;    // 0.0 = at segment start, 1.0 = at segment end
        this.lastControlPointIds = []; // Cache of control point IDs for change detection

        // === TERRAIN-PROJECTED SELECTION RING ===
        this.selectionRingRadius = 2.5;  // World units from unit center
        this.selectionRingSegments = 48; // Ring resolution
        this.terrainRing = null;         // THREE.Mesh - created on demand
        this.terrainRingMaterial = null;

        // === KEYBOARD OVERRIDE SYSTEM ===
        // When user takes manual control, save path state for later resume
        this.savedPath = null;           // Saved path when keyboard takes over
        this.savedPathIndex = 0;         // Where we were on the path
        this.keyboardOverrideTimer = 0;  // Time since last keyboard input (4s to resume)
        this.isKeyboardOverriding = false; // Currently being controlled by keyboard

        // === TRANSITION ARC SYSTEM ===
        // Used for smooth rejoin when waypoints are edited mid-path
        this.transitionPath = null;        // Temporary path to rejoin main path
        this.transitionIndex = 0;          // Current index in transition path
        this.isInTransition = false;       // Currently following transition arc
        this.transitionVelocityDir = null; // Unit's velocity direction when transition started

        // Action Card System
        this.activeAction = null;           // Currently executing action card
        this.actionState = 'idle';          // idle, stopping, waiting, resuming
        this.actionTimer = 0;               // Timer for current state
        this.actionSpeedFactor = 1.0;       // Multiplier for smooth stop/start (0..1)
        
        // === UNIFIED COMMAND QUEUE ===
        this.commands = [];                 // Master list of commands (Move, Wait, etc.)
        this.currentCommandIndex = 0;       // Index of the command currently being executed
        this.lastCompletedCommandIndex = -1; 

        // Legacy / Derived
        this.actionCards = [];              // DEPRECATED: Use this.commands


        // === STUCK DETECTION ===
        this.stuckTimer = 0;              // Time with no progress
        this.stuckThreshold = 1.5;        // Seconds before stuck
        this.lastProgressPosition = null; // Position at last progress check
        this.isStuck = false;             // Currently stuck
        this.stuckCheckInterval = 0.2;    // Check every 0.2s
        this.stuckCheckTimer = 0;
        this.minProgressDistance = 0.1;   // Minimum movement to count as progress

        // === BOUNCE/ROLL-BACK COLLISION STATE ===
        this.bounceVelocity = 0;           // Current roll-back speed (decays to 0)
        this.bounceDirection = null;       // Direction to roll back (exact arrival path)
        this.bounceDecay = 5.0;            // Lower = slower stop = longer visible roll-back
        this.bounceLockTimer = 0;          // Time since roll-back started
        this.bounceLockDuration = 0.15;    // Return control 0.15s before full stop
        this.bounceCooldown = 0;           // Prevents double-collision

        // Position history for EXACT path roll-back
        this.positionHistory = [];         // Ring buffer of recent positions
        this.positionHistoryMaxSize = 30;  // ~0.5 sec at 60fps
        this.positionHistoryTimer = 0;     // Throttle history recording

        // === DUST PARTICLE CONFIG ===
        this.dustOpacity = 0.1;            // Default transparency
        this.dustMaxParticles = 50;        // Default density
        this.dustSpawnInterval = 0.03;     // Default frequency

        // Unit identity (R003: deterministic integer ID from SimCore)
        if (id === undefined || id === null) {
            console.warn('[Unit] No ID provided - using seeded RNG fallback.');
            this.id = rngNextInt(10000); // R004: seeded RNG for determinism
        } else {
            this.id = id;
        }
        this.name = `Unit ${this.id}`;

        // === M07: Unit Authority v0 - Canonical Data Model ===
        // ownerSlot: Economic owner. Defaults to spawner slot. Changes ONLY on successful takeover.
        this.ownerSlot = 0; // Default: spawned by Host (slot 0)
        // ownerHistory: Tracks every ownership change for audit/replay
        // Each entry: { slot, previousSlot, acquiredAt, method }
        this.ownerHistory = [];
        // selectedBySlot: The driver. Exclusive - only one driver per unit. null = empty seat.
        this.selectedBySlot = null;
        // seatPolicy: 'OPEN' (anyone can seat) | 'PIN_1DIGIT' (requires PIN challenge)
        this.seatPolicy = 'OPEN';
        // seatPinDigit: 1-9 (Host-only, NOT serialized to guests)
        this.seatPinDigit = null;

        // === POOLED OBJECTS FOR HOT-PATH REUSE (avoid GC pressure) ===
        // These are reused every frame in update() instead of allocating new objects.
        // NEVER pass these to async code or store references - they are overwritten each tick.
        this._poolBlendedDir = new THREE.Vector3();
        this._poolTempDir = new THREE.Vector3();
        this._poolTangent = new THREE.Vector3();
        this._poolRight = new THREE.Vector3();
        this._poolOrthoFwd = new THREE.Vector3();
        this._poolTargetQuat = new THREE.Quaternion();
        this._poolRotMatrix = new THREE.Matrix4();
        this._poolSphereNormal = new THREE.Vector3();
        this._poolForward = new THREE.Vector3();
        this._poolMoveDir = new THREE.Vector3();
        this._poolAxis = new THREE.Vector3();
        this._poolTempQuat = new THREE.Quaternion();
        this._poolSlopeDir = new THREE.Vector3();
        this._poolSlopeCross = new THREE.Vector3();

        // === R008: RENDER INTERPOLATION STATE ===
        // Stores authoritative position/quaternion at tick boundaries for smooth rendering.
        // These are RENDER-ONLY and do NOT affect sim state.
        this._interpPrevPos = new THREE.Vector3();
        this._interpCurrPos = new THREE.Vector3();
        this._interpPrevQuat = new THREE.Quaternion();
        this._interpCurrQuat = new THREE.Quaternion();
        this._interpInitialized = false; // First tick needs both prev/curr set to same
    }

    // === Ownership History Helpers ===

    /**
     * Returns the slot of the original owner (first entry in ownerHistory).
     * Falls back to current ownerSlot if no history exists.
     */
    get originalOwner() {
        return this.ownerHistory.length > 0 ? this.ownerHistory[0].slot : this.ownerSlot;
    }

    /**
     * Returns the number of ownership changes recorded.
     */
    get ownershipCount() {
        return this.ownerHistory.length;
    }

    /**
     * Record an ownership change in the history.
     * @param {number} newSlot - The new owner's slot
     * @param {number} previousSlot - The previous owner's slot
     * @param {number} simTick - The sim tick when the change occurred
     * @param {string} method - How: 'SPAWN' | 'PIN_CAPTURE' | 'SEAT_CLAIM' | 'TRANSFER'
     */
    recordOwnershipChange(newSlot, previousSlot, simTick, method) {
        this.ownerHistory.push({
            slot: newSlot,
            previousSlot: previousSlot,
            acquiredAt: simTick,
            method: method
        });
    }

    /**
     * Generate a unique 16-char Station ID: "ST-[USERID 4]-[HASH 8]"
     * @param {string} userId - The current user's ID
     */
    generateStationId(userId = "0000") {
        const prefix = "ST";
        const userPart = userId.substring(0, 4).padEnd(4, '0');
        // R004: seeded RNG for deterministic hash
        const hash = rngNext().toString(36).substring(2, 10).toUpperCase().padEnd(8, 'X');
        return `${prefix}-${userPart}-${hash}`;
    }

    createMesh() {
        const group = new THREE.Group();

        // 1. Main Body (Cone)
        const coneGeo = new THREE.ConeGeometry(0.3, 1, 8);
        const geo = coneGeo.clone(); // Clone to manipulating
        geo.rotateX(Math.PI / 2); // Point Z+
        geo.translate(0, 0.3, 0);

        this.bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 });
        this.bodyMesh = new THREE.Mesh(geo, this.bodyMaterial); // Expose as property
        this.bodyMesh.castShadow = true;
        this.bodyMesh.receiveShadow = true;
        group.add(this.bodyMesh);

        // CONTACT SHADOW (Blob shadow directly under unit to prevent "floating" look)
        const contactShadowGeo = new THREE.CircleGeometry(0.6, 32);
        contactShadowGeo.rotateX(-Math.PI / 2); // Flat on ground
        const contactShadowMat = new THREE.ShaderMaterial({
            uniforms: {},
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                varying vec2 vUv;
                void main() {
                    // Soft radial falloff from center
                    float dist = length(vUv - vec2(0.5, 0.5)) * 2.0;
                    float alpha = smoothstep(1.0, 0.0, dist) * 0.5; // Max 50% opacity at center
                    gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
                }
            `,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        this.contactShadow = new THREE.Mesh(contactShadowGeo, contactShadowMat);
        this.contactShadow.position.y = 0.02; // Just above terrain to avoid z-fighting
        this.contactShadow.renderOrder = -1; // Render before other elements
        group.add(this.contactShadow);

        // 2. Selection Ring
        const ringGeo = new THREE.RingGeometry(0.8, 0.9, 32);
        ringGeo.rotateX(-Math.PI / 2); // Flat on ground (Local X-Z plane)

        // Highlight Ring (Thin, Faint)
        this.highlightMaterial = new THREE.MeshBasicMaterial({
            color: 0xffaa00,
            transparent: true,
            opacity: 0.0, // Hidden by default
            side: THREE.DoubleSide
        });
        this.highlightRing = new THREE.Mesh(ringGeo, this.highlightMaterial);
        this.highlightRing.position.y = 0.05;
        group.add(this.highlightRing);

        // 3. Selection Spotlight (Cone of light from above - projects ring on terrain)
        this.spotLight = new THREE.SpotLight(0x00ff88, 0.0); // Start off
        this.spotLight.angle = Math.PI / 3; // 60 degrees - wider light cone for visible ring
        this.spotLight.penumbra = 0.5; // Softer edge
        this.spotLight.distance = 25; // Longer range
        this.spotLight.decay = 1.5;
        this.spotLight.position.set(0, 8, 0); // Higher above unit for wider spread
        this.spotLight.castShadow = false; // DISABLED SHADOWS to save Texture Units (Max 16 limit)
        this.spotLight.shadow.mapSize.width = 512;
        this.spotLight.shadow.mapSize.height = 512;
        this.spotLight.shadow.camera.near = 0.5;
        this.spotLight.shadow.camera.far = 25;
        // Target needs to be added to scene or hierarchy to work correctly
        this.spotLight.target.position.set(0, 0, 0);

        group.add(this.spotLight);
        group.add(this.spotLight.target);

        // 4. SELECTION RING (Ground Projected)
        // Light blue pulsing ring, occluded by planet (depthTest: true)
        // User Request: 1.5x larger than previous (1.76, 2.2)
        // New: 2.64, 3.3
        const glowRingGeo = new THREE.RingGeometry(2.64, 3.3, 32);

        // Compute UVs for shader gradient
        const pos = glowRingGeo.attributes.position;
        const uvs = new Float32Array(pos.count * 2);
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const y = pos.getY(i);
            uvs[i * 2] = (x / 3.3) * 0.5 + 0.5;     // Normalize to 0..1
            uvs[i * 2 + 1] = (y / 3.3) * 0.5 + 0.5;  // Normalize to 0..1
        }
        glowRingGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

        this.glowMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0.0 },
                uOpacity: { value: 0.8 }
            },
            vertexShader: `
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform float uTime;
                uniform float uOpacity;
                varying vec2 vUv;
                void main() {
                    // Convert UV to angle around center
                    vec2 center = vUv - 0.5;
                    float angle = atan(center.y, center.x);
                    // Rotate over time (matches preloader 3s spin)
                    float rotatedAngle = angle - uTime * 2.094; // ~2PI/3 per second
                    // Normalize to 0..1
                    float t = fract(rotatedAngle / 6.2832 + 0.5);
                    // Conic gradient: cyan (#00d4ff) -> green (#00ff9d) -> transparent -> cyan
                    vec3 cyan = vec3(0.0, 0.831, 1.0);
                    vec3 green = vec3(0.0, 1.0, 0.616);
                    vec3 color;
                    float minAlpha = uOpacity * 0.05; // 5% minimum opacity everywhere
                    float alpha = uOpacity;
                    if (t < 0.25) {
                        // dim region
                        color = cyan;
                        alpha = minAlpha;
                    } else if (t < 0.35) {
                        // fade in from dim to cyan
                        float ft = (t - 0.25) / 0.1;
                        color = cyan;
                        alpha = mix(minAlpha, uOpacity, ft);
                    } else if (t < 0.5) {
                        // cyan to green
                        float ft = (t - 0.35) / 0.15;
                        color = mix(cyan, green, ft);
                    } else if (t < 0.65) {
                        // green to cyan
                        float ft = (t - 0.5) / 0.15;
                        color = mix(green, cyan, ft);
                    } else if (t < 0.75) {
                        // fade out from cyan to dim
                        float ft = (t - 0.65) / 0.1;
                        color = cyan;
                        alpha = mix(uOpacity, minAlpha, ft);
                    } else {
                        // dim region
                        color = cyan;
                        alpha = minAlpha;
                    }
                    gl_FragColor = vec4(color, alpha);
                }
            `,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            side: THREE.DoubleSide
        });

        this.glowRing = new THREE.Mesh(glowRingGeo, this.glowMaterial);
        this.glowRing.rotation.x = -Math.PI / 2; 
        this.glowRing.position.y = 0.5; // Raised clearly above ground
        this.glowRing.renderOrder = 999; // Render on top of terrain
        // this.glowRing.visible = false; // Keep it potentially visible for now if opacity is handled
        
        group.add(this.glowRing);

        // 5. HEADLIGHTS (Front spotlights that cast shadows)
        // Start OFF - only enabled when player controls this unit
        this.headlightLeft = new THREE.SpotLight(0xffffee, 0); // Start OFF
        this.headlightLeft.angle = Math.PI / 8; // Narrow beam
        this.headlightLeft.penumbra = 0.5;
        this.headlightLeft.distance = 15; // Effective range
        this.headlightLeft.decay = 2.0;
        this.headlightLeft.castShadow = false; // DISABLED SHADOWS to save Texture Units
        this.headlightLeft.shadow.mapSize.width = 512;
        this.headlightLeft.shadow.mapSize.height = 512;
        this.headlightLeft.shadow.camera.near = 0.1;
        this.headlightLeft.shadow.camera.far = 15;
        this.headlightLeft.position.set(-0.2, 0.3, 0.5); // Front-left of vehicle
        this.headlightLeft.target.position.set(-0.2, 0.0, 5); // Aim forward
        group.add(this.headlightLeft);
        group.add(this.headlightLeft.target);

        this.headlightRight = new THREE.SpotLight(0xffffee, 0); // Start OFF
        this.headlightRight.angle = Math.PI / 8;
        this.headlightRight.penumbra = 0.5;
        this.headlightRight.distance = 15;
        this.headlightRight.decay = 2.0;
        this.headlightRight.castShadow = false; // DISABLED SHADOWS to save Texture Units
        this.headlightRight.shadow.mapSize.width = 512;
        this.headlightRight.shadow.mapSize.height = 512;
        this.headlightRight.shadow.camera.near = 0.1;
        this.headlightRight.shadow.camera.far = 15;
        this.headlightRight.position.set(0.2, 0.3, 0.5); // Front-right
        this.headlightRight.target.position.set(0.2, 0.0, 5);
        group.add(this.headlightRight);
        group.add(this.headlightRight.target);

        this.selectionIntensity = 0.0; // 0 to 1 smooth transition state
        this.timeAccumulator = 0.0; // For pulsing

        // Hover & Speed Smooth
        this.hoverState = false;
        this.speedFactor = 1.0; // 0.0 (Stopped) to 1.0 (Full Speed)
        this.pausedByCommand = false; // Manual Pause (Stop Button or Manual Steer)

        // === DUST PARTICLE SYSTEM (OPTIMIZED) ===
        // Initialization moved to updateDustParticles (Lazy Init with InstancedMesh)
        this.dustMaxParticles = this.dustMaxParticles || 50;
        this.dustSpawnInterval = this.dustSpawnInterval || 0.05; // Slightly slower spawn (was 0.03)
        this.dustSpawnTimer = 0;
        this.dustInitialized = false;

        this.dustInitialized = false; // Will add to scene on first update

        return group;
    }

    setHover(state) {
        this.hoverState = state;
        this.isHovered = state; // Track hover state for visuals

        // STRONG HOVER HIGHLIGHT (brighter than selection)
        if (this.bodyMaterial) {
            if (state && !this.isSelected) {
                // Hover = bright white highlight
                this.bodyMaterial.emissive = new THREE.Color(0xffffff);
                this.bodyMaterial.emissiveIntensity = 2.0;
            } else if (!state && !this.isSelected) {
                this.bodyMaterial.emissiveIntensity = 0;
            }
            // If selected, updateSelectionVisuals handles the glow
        }

        // Show/hide highlight ring
        if (this.highlightMaterial) {
            this.highlightMaterial.opacity = (state && !this.isSelected) ? 0.6 : 0.0;
        }
    }

    setCommandPause(paused) {
        this.pausedByCommand = paused;
        // If unpaused, ensure we are in path following mode if path exists AND has points
        // Bug #13 fix: [] is truthy in JS, so check length to avoid re-enabling
        // isFollowingPath on a cleared/empty path
        if (!paused && this.path && this.path.length > 0) {
            this.isFollowingPath = true;
        }
    }

    alignToSurfaceInitial() {
        // If mesh is Group, we rotate the Group
        const normal = this.position.clone().normalize();
        const up = new THREE.Vector3(0, 1, 0);
        const q = new THREE.Quaternion().setFromUnitVectors(up, normal);
        this.mesh.quaternion.copy(q);
    }

    setHighlight(active) {
        // This is now handled by setHover for consistency
        if (this.isSelected) return; // Selection overrides highlight
        if (this.highlightMaterial) {
            this.highlightMaterial.opacity = active ? 0.4 : 0.0;
        }
    }

    setSelection(active) {
        this.isSelected = active;
        if (window.game?._isDevMode) console.log(`[Unit ${this.id}] setSelection(${active}) - glowRing exists: ${!!this.glowRing}, glowMaterial exists: ${!!this.glowMaterial}`);

        // IMMEDIATE minimum visibility when selected (don't wait for lerp)
        if (active) {
            if (this.glowMaterial) {
                if (this.glowMaterial.uniforms) {
                    this.glowMaterial.uniforms.uOpacity.value = 0.3;
                } else {
                    this.glowMaterial.opacity = 0.3;
                } // Start visible immediately
                this.glowRing.visible = true;
                // FIX: Jumpstart intensity so updateSelectionVisuals doesn't hide it immediately (it hides if < 0.01)
                this.selectionIntensity = Math.max(this.selectionIntensity, 0.2);
            }
            // Bug #5: Immediately show overhead green indicator on selection
            if (!this._myUnitIndicatorSprite) {
                this._createIndicatorSprite('myUnit');
            }
            if (this._myUnitIndicatorSprite) {
                this._myUnitIndicatorSprite.visible = true;
            }
        } else {
            // IMMEDIATE HIDE on deselect (Phase 2 Fix)
            this.selectionIntensity = 0;
            this.isKeyboardOverriding = false; // Bug #4: Clear keyboard override to kill selection ring
            // Start headlight deselect countdown
            this._deselectTimestamp = performance.now();
            if (this.glowMaterial) {
                if (this.glowMaterial.uniforms) {
                    this.glowMaterial.uniforms.uOpacity.value = 0;
                } else {
                    this.glowMaterial.opacity = 0;
                }
            }
            if (this.glowRing) this.glowRing.visible = false;
            if (this.terrainRing) this.terrainRing.visible = false;
            // Bug #5: Immediately hide overhead green indicator on deselect
            if (this._myUnitIndicatorSprite) {
                this._myUnitIndicatorSprite.visible = false;
            }
        }
        // Full visuals handled in update() for smooth transition ONLY if active
    }

    // === M07: Unit Authority v0 - Getters ===

    /**
     * M07: Check if this unit has a driver (seat is occupied).
     * @returns {boolean} true if selectedBySlot !== null
     */
    get isOccupied() {
        return this.selectedBySlot !== null;
    }

    /**
     * M07: Compatibility getter - maps controllerSlot to selectedBySlot.
     * @deprecated Use selectedBySlot directly
     * @returns {number|null}
     */
    get controllerSlot() {
        return this.selectedBySlot;
    }

    /**
     * M07: Compatibility setter - maps controllerSlot to selectedBySlot.
     * @deprecated Use selectedBySlot directly
     */
    set controllerSlot(value) {
        this.selectedBySlot = value;
    }

    // === W2: LOCK INDICATOR SYSTEM ===

    /**
     * W2: Check if this unit is locked for the current guest.
     * Returns true if:
     * - We're in multiplayer as a guest
     * - The unit's selectedBySlot doesn't match our slot
     * @returns {boolean}
     */
    get isLockedForGuest() {
        const sm = window.game?.sessionManager;
        if (!sm || sm.state.isOffline() || sm.state.isHost()) return false;
        return this.selectedBySlot !== sm.state.mySlot;
    }

    /**
     * M07: Check if this unit should show a LOCK indicator (padlock).
     * Shows lock when:
     * - seatPolicy == 'PIN_1DIGIT' AND
     * - selectedBySlot == null (empty seat) AND
     * - ownerSlot != mySlot
     * @returns {boolean}
     */
    get shouldShowLockIndicator() {
        const sm = window.game?.sessionManager;
        // Only show in multiplayer guest mode
        if (!sm || sm.state.isOffline() || sm.state.isHost()) return false;
        const mySlot = sm.state.mySlot;
        // Must be PIN-protected
        if (this.seatPolicy !== 'PIN_1DIGIT') return false;
        // Seat must be empty
        if (this.selectedBySlot !== null) return false;
        // Must be a foreign unit (not mine)
        return this.ownerSlot !== mySlot;
    }

    /**
     * M07: Check if this unit should show an OCCUPIED indicator (person icon).
     * Shows occupied when:
     * - selectedBySlot != null AND
     * - selectedBySlot != mySlot
     * @returns {boolean}
     */
    get shouldShowOccupiedIndicator() {
        const sm = window.game?.sessionManager;
        // Only show in multiplayer mode (both Host and Guest see occupied)
        if (!sm || sm.state.isOffline()) return false;
        const mySlot = sm.state.mySlot;
        // Seat is occupied by someone else
        return this.selectedBySlot !== null && this.selectedBySlot !== mySlot;
    }

    /**
     * M07: Check if this unit should show "My Unit" indicator (green glow).
     * Shows when: selectedBySlot == mySlot
     * @returns {boolean}
     */
    get isMySeatedUnit() {
        const sm = window.game?.sessionManager;
        // Offline/Host always "owns" selected units
        if (!sm || sm.state.isOffline() || sm.state.isHost()) {
            return this.isSelected;
        }
        const mySlot = sm.state.mySlot;
        return this.selectedBySlot === mySlot;
    }

    /**
     * M07: Get display name of the player occupying this unit.
     * @returns {string|null}
     */
    get occupantDisplayName() {
        if (this.selectedBySlot === null) return null;
        const sm = window.game?.sessionManager;
        if (!sm) return null;
        const player = sm.state.getPlayer(this.selectedBySlot);
        if (player?.displayName) return player.displayName;
        return this.selectedBySlot === 0 ? 'Host' : `Player ${this.selectedBySlot}`;
    }

    /**
     * M07: Create or update indicator sprites (lock/occupied).
     * Called during unit update to reflect current seat state.
     */
    updateSeatIndicators() {
        const shouldShowLock = this.shouldShowLockIndicator;
        const shouldShowOccupied = this.shouldShowOccupiedIndicator;

        // Detect occupant change to recreate name label
        const currentOccupant = shouldShowOccupied ? this.selectedBySlot : null;
        const occupantChanged = this._lastOccupantSlot !== currentOccupant;

        const newState = `${shouldShowLock}-${shouldShowOccupied}-${currentOccupant}`;
        if (this._lastIndicatorState !== newState) {
            this._lastIndicatorState = newState;
        }

        // Update lock indicator
        if (shouldShowLock && !this._lockIndicatorSprite) {
            this._createIndicatorSprite('lock');
        }
        if (this._lockIndicatorSprite) {
            this._lockIndicatorSprite.visible = shouldShowLock;
        }

        // Update occupied indicator (recreate if occupant changed for name update)
        if (shouldShowOccupied && (occupantChanged || !this._occupiedIndicatorSprite)) {
            if (this._occupiedIndicatorSprite) {
                this._occupiedIndicatorSprite.removeFromParent();
                this._occupiedIndicatorSprite = null;
            }
            this._createIndicatorSprite('occupied', this.occupantDisplayName);
            this._lastOccupantSlot = currentOccupant;
        }
        if (!shouldShowOccupied && this._occupiedIndicatorSprite) {
            this._occupiedIndicatorSprite.visible = false;
            this._lastOccupantSlot = null;
        }
        if (this._occupiedIndicatorSprite && shouldShowOccupied) {
            this._occupiedIndicatorSprite.visible = true;
        }

        // Update myUnit green glow indicator
        const shouldShowMyUnit = this.isMySeatedUnit;
        if (shouldShowMyUnit && !this._myUnitIndicatorSprite) {
            this._createIndicatorSprite('myUnit');
        }
        if (this._myUnitIndicatorSprite) {
            this._myUnitIndicatorSprite.visible = shouldShowMyUnit;
        }
    }

    /**
     * W2: Create or update the lock indicator sprite.
     * @deprecated Use updateSeatIndicators() instead
     */
    updateLockIndicator() {
        this.updateSeatIndicators();
    }

    /**
     * M07: Create an indicator sprite (lock, occupied, or myUnit).
     * @private
     * @param {string} type - 'lock', 'occupied', or 'myUnit'
     * @param {string} [playerName] - Display name for 'occupied' type
     */
    _createIndicatorSprite(type, playerName) {
        let canvas, ctx, sprite;

        if (type === 'occupied' && playerName) {
            // Wider canvas for person icon + name
            canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 64;
            ctx = canvas.getContext('2d');

            // Person silhouette icon
            ctx.font = '40px Arial';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText('\u{1F464}', 8, 32);

            // Player name
            ctx.fillStyle = '#ff6666';
            ctx.font = 'bold 24px "Inter", "Segoe UI", Arial';
            ctx.textAlign = 'left';
            ctx.fillText(playerName, 52, 32);
        } else {
            canvas = document.createElement('canvas');
            canvas.width = 64;
            canvas.height = 64;
            ctx = canvas.getContext('2d');
            ctx.font = '48px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            if (type === 'lock') {
                ctx.fillText('\u{1F512}', 32, 32);
            } else if (type === 'occupied') {
                ctx.fillText('\u{1F464}', 32, 32);
            } else if (type === 'myUnit') {
                ctx.fillStyle = '#00ff44';
                ctx.beginPath();
                ctx.arc(32, 32, 24, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#ffffff';
                ctx.font = '32px Arial';
                ctx.fillText('\u2713', 32, 34);
            }
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;

        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: true,
            depthWrite: false
        });

        sprite = new THREE.Sprite(material);
        // Occupied with name is wider
        if (type === 'occupied' && playerName) {
            sprite.scale.set(4, 1, 1);
        } else {
            sprite.scale.set(1.5, 1.5, 1);
        }
        sprite.position.set(0, 2.5, 0);
        sprite.renderOrder = 100;

        this.mesh.add(sprite);

        if (type === 'lock') {
            this._lockIndicatorSprite = sprite;
        } else if (type === 'occupied') {
            this._occupiedIndicatorSprite = sprite;
        } else if (type === 'myUnit') {
            this._myUnitIndicatorSprite = sprite;
        }
    }

    /**
     * W2: Create the lock indicator sprite (emoji-based).
     * @private
     * @deprecated Use _createIndicatorSprite('lock') instead
     */
    _createLockIndicatorSprite() {
        this._createIndicatorSprite('lock');
    }

    /**
     * M07: Remove all seat indicator sprites.
     */
    removeSeatIndicators() {
        this.removeLockIndicator();
        this.removeOccupiedIndicator();
        this.removeMyUnitIndicator();
    }

    /**
     * W2: Remove the lock indicator sprite.
     */
    removeLockIndicator() {
        if (this._lockIndicatorSprite) {
            this.mesh.remove(this._lockIndicatorSprite);
            if (this._lockIndicatorSprite.material.map) {
                this._lockIndicatorSprite.material.map.dispose();
            }
            this._lockIndicatorSprite.material.dispose();
            this._lockIndicatorSprite = null;
        }
    }

    /**
     * M07: Remove the occupied indicator sprite.
     */
    removeOccupiedIndicator() {
        if (this._occupiedIndicatorSprite) {
            this.mesh.remove(this._occupiedIndicatorSprite);
            if (this._occupiedIndicatorSprite.material.map) {
                this._occupiedIndicatorSprite.material.map.dispose();
            }
            this._occupiedIndicatorSprite.material.dispose();
            this._occupiedIndicatorSprite = null;
        }
    }

    /**
     * M07: Remove the myUnit indicator sprite.
     */
    removeMyUnitIndicator() {
        if (this._myUnitIndicatorSprite) {
            this.mesh.remove(this._myUnitIndicatorSprite);
            if (this._myUnitIndicatorSprite.material.map) {
                this._myUnitIndicatorSprite.material.map.dispose();
            }
            this._myUnitIndicatorSprite.material.dispose();
            this._myUnitIndicatorSprite = null;
        }
    }

    updateSelectionVisuals(dt) {
        const targetIntensity = this.isSelected ? 1.0 : 0.0;

        // Smooth transition (Ease-out)
        const lerpSpeed = this.isSelected ? 5.0 : 3.0;
        this.selectionIntensity = THREE.MathUtils.lerp(this.selectionIntensity, targetIntensity, dt * lerpSpeed);

        // === KEYBOARD ACTIVE GLOW (orange, more intense) ===
        const isActive = this.isKeyboardOverriding;

        // FIX: Early exit if not selected AND not active (prevents flicker on deselect)
        if (!this.isSelected && !isActive) {
            this.spotLight.intensity = 0;
            if (this.glowMaterial.uniforms) { this.glowMaterial.uniforms.uOpacity.value = 0; } else { this.glowMaterial.opacity = 0; }
            if (this.bodyMaterial) {
                this.bodyMaterial.emissiveIntensity = 0;
            }
            this.glowRing.visible = false;
            if (this.terrainRing) this.terrainRing.visible = false;
            this.selectionIntensity = 0; // Reset for next selection
            return;
        }

        if (this.selectionIntensity < 0.01 && !isActive) {
            this.spotLight.intensity = 0;
            if (this.glowMaterial.uniforms) { this.glowMaterial.uniforms.uOpacity.value = 0; } else { this.glowMaterial.opacity = 0; }
            if (this.bodyMaterial) {
                this.bodyMaterial.emissiveIntensity = 0;
            }
            this.glowRing.visible = false;
            // Hide terrain ring
            if (this.terrainRing) this.terrainRing.visible = false;
            return;
        }

        // Only make visible if we passed the checks above (selected or active)
        if (this.isSelected || isActive) {
            this.glowRing.visible = true;
        }
        this.timeAccumulator += dt;

        // Pulse Logic (Sine wave)
        // Selection ring: slow 3.5s cycle (full transparent to opaque and back)
        // Keyboard active: faster pulse
        const pulseFreq = isActive ? 6.0 : (2.0 * Math.PI / 3.5); // ~1.795 for 3.5s cycle
        const pulse = (Math.sin(this.timeAccumulator * pulseFreq) * 0.5 + 0.5); // 0 to 1

        // Determine which intensity to use (active overrides selection)
        const visualIntensity = isActive ? 1.0 : this.selectionIntensity;

        // 1. Spotlight Intensity - Projects visible ring on terrain
        const spotMax = isActive ? 80.0 : 60.0; // Brighter when active
        this.spotLight.intensity = visualIntensity * (spotMax * 0.7 + spotMax * 0.3 * pulse);

        // 2. Glow Ring - ORANGE when active, LIGHT BLUE when just selected
        // Selection: slow pulse from 0.0 (transparent) to 0.8 (opaque) and back
        // Active: stays bright with subtle pulse
        const ringOpacity = isActive ? (0.8 + 0.2 * pulse) : (0.8 * pulse);
        if (this.glowMaterial.uniforms) {
            this.glowMaterial.uniforms.uOpacity.value = visualIntensity * ringOpacity;
            this.glowMaterial.uniforms.uTime.value = performance.now() * 0.001;
        } else {
            this.glowMaterial.opacity = visualIntensity * ringOpacity;
        }
        // Color handled by shader gradient (no .color on ShaderMaterial)

        // 3. Unit Emissive Glow - ORANGE when active, BLUE when selected
        if (this.bodyMaterial) {
            this.bodyMaterial.emissive = new THREE.Color(isActive ? 0xff6600 : 0x00d4ff);
            const emissiveMax = isActive ? 0.8 : 0.5;
            this.bodyMaterial.emissiveIntensity = visualIntensity * (emissiveMax + 0.3 * pulse);
        }

        // 4. PULSING GLOW (simpler effect, spotlight casts light on terrain)
        this.updateSelectionGlow(pulse);

        // Hide highlight ring if selected/transitioning
        if (this.highlightMaterial) {
            this.highlightMaterial.opacity = 0.0;
        }
    }

    /**
     * Enhanced selection glow - uses spotlight to cast light on terrain around unit.
     * No complex terrain ring, just pulsing glow and light projection.
     */
    updateSelectionGlow(pulse) {
        // The spotlight already casts light on the terrain around the unit
        // Just ensure it's positioned correctly above the unit
        if (this.spotLight) {
            // Position spotlight above unit in local space (already done in createMesh)
            // Intensity is already pulsed in updateSelectionVisuals
        }

        // The glowRing is a flat ring that follows the unit
        // It provides the visual "glow" effect at the unit's feet
        if (this.glowRing) {
            // Scale the glow ring slightly with pulse for breathing effect
            const scale = 1.0 + 0.1 * pulse;
            this.glowRing.scale.set(scale, 1, scale);
        }

        // Remove terrain ring if it exists (we're not using it anymore)
        if (this.terrainRing) {
            const scene = this.mesh.parent;
            if (scene) {
                scene.remove(this.terrainRing);
                this.terrainRing.geometry.dispose();
                this.terrainRingMaterial.dispose();
            }
            this.terrainRing = null;
            this.terrainRingMaterial = null;
        }
    }

    /**
     * Turn headlights on/off. Only the player-controlled unit should have lights ON.
     * Intensity is high (25) to be visible even in bright daylight.
     */
    setHeadlightsOn(enabled) {
        const intensity = enabled ? 25.0 : 0; // Very bright for daylight visibility
        if (this.headlightLeft) this.headlightLeft.intensity = intensity;
        if (this.headlightRight) this.headlightRight.intensity = intensity;
    }

    setPath(points) {
        // Smart Path Update (No Backtracking)
        // If unit is already past start, don't reset index to 0.

        if (!points || points.length === 0) return;

        let closestIndex = 0;
        let minDist = Infinity;

        // Find closest point on NEW path
        for (let i = 0; i < points.length; i++) {
            const d = this.position.distanceToSquared(points[i]);
            if (d < minDist) {
                minDist = d;
                closestIndex = i;
            }
        }

        // If we are strictly "between" two points, we want the next one.
        // Heuristic: Set target to Closest + 1.
        // Limit to end of path.
        // Exception: If closest is 0 (Start), target 1.
        let nextIndex = closestIndex + 1;
        if (nextIndex >= points.length) nextIndex = points.length - 1;

        this.path = points;
        this.pathIndex = nextIndex;

        this.isFollowingPath = true;
        this.pausedByCommand = false;

        if (window.game?._isDevMode) console.log(`Path Set. Closest Node: ${closestIndex}, Next Target: ${this.pathIndex}`);
    }

    steerTowards(point) {
        this.steerTarget = point;
        this.isSteering = true;
        this.path = null; // Override path
    }

    stopSteering() {
        this.isSteering = false;
        this.steerTarget = null;
    }

    update(input, dt, pathPlanner = null) {
        const startPos = this.position.clone();

        // === DYNAMIC REPLANNING (User Request) ===
        // Check for obstacles appearing in FOW or dynamic changes
        if (pathPlanner && this.isFollowingPath && !this.isInTransition) {
            // R004: seeded RNG for deterministic stagger
            this.replanningTimer = (this.replanningTimer || rngNext() * 2.0); // Stagger init
            this.replanningTimer -= dt;

            if (this.replanningTimer <= 0) {
                this.replanningTimer = 2.0 + rngNext() * 2.0; // Check every 2-4 seconds
                this.scanForObstacles(pathPlanner);
            }
        }

        // === ROCK SPAWN-OUT CHECK ===
        // If unit somehow ends up inside a rock, push it out immediately
        // Rock collision is handled by RockCollisionSystem.checkAndSlide() 
        // which uses raycast against actual mesh and bounces on arrival direction.
        // No sphere-based overlap push needed (it was causing sideways push).

        // Selection Visuals (also run for keyboard-controlled units for active glow)
        if (this.isSelected || this.selectionIntensity > 0.01 || this.isKeyboardOverriding) {
            this.updateSelectionVisuals(dt);
        }

        // W2: Update lock indicator for multiplayer seat protection
        this.updateLockIndicator();

        const turnSpeed = this.turnSpeed * dt;

        // Hover Speed Logic (Easy In / Easy Out)
        // Also include pausedByCommand for smooth stop/start
        const targetFactor = (this.hoverState || this.pausedByCommand) ? 0.0 : 1.0;
        // Smoothly interpolate factor - inertia: gradual decel (~0.8s) and accel (~1.1s)
        const lerpSpeed = (this.hoverState || this.pausedByCommand) ? 2.5 : 1.8;
        this.speedFactor = THREE.MathUtils.lerp(this.speedFactor, targetFactor, dt * lerpSpeed);

        // Effective Speed
        let moveSpeed = (this.speed || 10) * dt * this.speedFactor * this.waterSlowdownFactor;

        // If "effectively stopped", clamp to 0 to avoid micro-movements
        if (this.speedFactor < 0.001) {
            moveSpeed = 0;
            this.speedFactor = 0; // Snap to fully stopped
        }

        // === TERRAIN SLOPE PHYSICS ===
        // Uphill slows unit down, downhill speeds it up
        if (this.velocityDirection && this.velocityDirection.lengthSq() > 0.001) {
            const surfaceNormal = this._poolAxis.copy(this.position).normalize(); // Radial "up" direction
            // Dot product: positive = moving uphill, negative = moving downhill
            const slopeDot = this.velocityDirection.dot(surfaceNormal);
            // Clamp influence to reasonable range (-0.3 to +0.3)
            const slopeInfluence = THREE.MathUtils.clamp(slopeDot, -0.3, 0.3);
            // Convert to speed factor: uphill reduces speed, downhill increases
            // 0.0 slope = 1.0 factor, +0.3 (steep uphill) = 0.7, -0.3 (steep downhill) = 1.3
            const slopeSpeedFactor = 1.0 - slopeInfluence;
            moveSpeed *= slopeSpeedFactor;
        }

        // Lateral drift on cross-slopes (gravity pulls unit downhill on traversals)
        if (this.velocityDirection && moveSpeed > 0 && this.velocityDirection.lengthSq() > 0.001) {
            const surfaceNormal = this._poolSphereNormal.copy(this.position).normalize();
            const terrainNormal = this.getSmoothedNormal();

            // "Downhill" direction on the surface via double cross product
            const slopeDir = this._poolSlopeDir.crossVectors(
                this._poolSlopeCross.crossVectors(terrainNormal, surfaceNormal),
                terrainNormal
            ).normalize();

            // Only apply if there IS a slope (slopeDir is meaningful)
            if (slopeDir.lengthSq() > 0.001) {
                // How steep is the slope? (1 - dot of terrain normal and sphere normal)
                const steepness = 1.0 - Math.abs(terrainNormal.dot(surfaceNormal));

                // How much are we moving across the slope? (perpendicular to fall line)
                const crossSlopeFactor = 1.0 - Math.abs(this.velocityDirection.dot(slopeDir));

                // Apply small lateral drift
                const driftStrength = steepness * crossSlopeFactor * 0.3 * dt;
                if (driftStrength > 0.001) {
                    this.position.addScaledVector(slopeDir, driftStrength * moveSpeed);
                }
            }
        }

        // === ROLL-BACK UPDATE (collision push-back on EXACT arrival path) ===
        // Countdown cooldown (prevents double-collision)
        if (this.bounceCooldown > 0) {
            this.bounceCooldown -= dt;
        }

        // Track if actively rolling back (physics active, user has no control)
        const isRollingBack = (this.bounceVelocity > 0.05 && this.bounceDirection);

        if (isRollingBack) {
            this.bounceLockTimer += dt;

            // Apply roll-back movement along STORED direction (exact arrival path)
            const rollbackMove = this.bounceVelocity * dt;
            const newPos = this.position.clone().addScaledVector(this.bounceDirection, rollbackMove);

            // Re-project to terrain
            const dir = newPos.clone().normalize();
            const terrainRadius = this.planet.terrain.getRadiusAt(dir);
            this.position.copy(dir.multiplyScalar(terrainRadius + (this.groundOffset || 0.22)));

            // Decay velocity with ease-in (exponential) - fast initial, slow near stop
            this.bounceVelocity *= Math.exp(-this.bounceDecay * dt);

            // CAMERA SHAKE during rock bounce (3x stronger than normal)
            // Camera controller reads this and applies shake to camera
            const normalizedBounceVel = Math.min(1.0, this.bounceVelocity / 5.0);
            this.cameraShakeIntensity = normalizedBounceVel * 1.5; // 1.5x amplitude (reduced from 3x)

            // FIX: Maximum 2 seconds of rollback, then force-restore control
            const maxRollbackTime = 2.0;
            const forceStop = (this.bounceVelocity < 0.05) || (this.bounceLockTimer > maxRollbackTime);
            
            if (forceStop) {
                this.bounceVelocity = 0;
                this.bounceDirection = null;
                this.bounceLockTimer = 0;
                // Stop camera shake
                this.cameraShakeIntensity = 0;
                
                if (this.bounceLockTimer > maxRollbackTime) {
                    if (window.game?._isDevMode) console.log("Rock: Max rollback time (2s) reached. Control restored.");
                }
            }
        } else {
            this.bounceLockTimer = 0;
        }

        // User control is LOCKED during roll-back
        // Control returns when velocity drops below threshold (not based on time)

        // isBouncing = user has NO CONTROL (locked during roll-back)
        this.isBouncing = isRollingBack;

        let autoTurn = 0;
        let autoMove = 0;

        // === STUCK DETECTION ===
        if (this.isFollowingPath && !this.hoverState) {
            this.stuckCheckTimer += dt;

            if (this.stuckCheckTimer >= this.stuckCheckInterval) {
                this.stuckCheckTimer = 0;

                if (!this.lastProgressPosition) {
                    this.lastProgressPosition = this.position.clone();
                }

                const progressDist = this.position.distanceTo(this.lastProgressPosition);

                if (progressDist < this.minProgressDistance) {
                    // No significant progress
                    this.stuckTimer += this.stuckCheckInterval;

                    if (this.stuckTimer >= this.stuckThreshold && !this.isStuck) {
                        this.isStuck = true;
                        if (window.game?._isDevMode) console.log(`[Unit ${this.id}] STUCK detected after ${this.stuckTimer.toFixed(1)}s`);
                        // TODO: Trigger repath here
                    }
                } else {
                    // Making progress - reset
                    this.stuckTimer = 0;
                    this.isStuck = false;
                    this.lastProgressPosition = this.position.clone();
                }
            }
        } else {
            // Not following path - reset stuck state
            this.stuckTimer = 0;
            this.isStuck = false;
        }

        // === WAIT TIMER LOGIC ===
        if (this.waitTimer > 0) {
            this.waitTimer -= dt;
            if (this.waitTimer <= 0) {
                this.waitTimer = 0;
                if (window.game?._isDevMode) console.log("Wait finished, resuming...");
            } else {
                // Determine braking/idle state
                // Use friction to stop smoothly if needed, or hard stop?
                // User said "Stop and wait".
                this.velocity.set(0, 0, 0); // Force stop to hold position
                // R011: Sync authoritative quaternion before early return
                if (this.headingQuaternion) {
                    this.quaternion.copy(this.headingQuaternion);
                }
                return; // Skip rest of update
            }
        }

        // === PAUSE / HOVER - speedFactor handles smooth stop ===
        // When paused or hovered, speedFactor lerps to 0 (see above)
        // We still need to update visuals
        if (this.pausedByCommand || this.hoverState) {
            // Update dust to show slowing/stopped
            this.updateDustParticles(dt, this.speedFactor > 0.1);
            
            // If fully stopped, skip movement but continue visuals
            if (this.speedFactor < 0.01) {
                this.velocity.set(0, 0, 0);
                // R011: Sync authoritative quaternion before early return
                if (this.headingQuaternion) {
                    this.quaternion.copy(this.headingQuaternion);
                }
                return;
            }
            // Otherwise continue with reduced speed (smooth deceleration)
        }

        // === SAFETY: ANTI-BLOCK MECHANISM ===
        // If unit should be moving (isFollowingPath=true, has path) but is stuck, auto-unlock after 3 seconds
        const shouldBeMoving = this.isFollowingPath && this.path && this.path.length > 0 && !this.hoverState;
        const isBlocked = this.pausedByCommand || this.isWaterPushing || this.isBouncing || this.isInTransition;
        
        if (shouldBeMoving && isBlocked && this.velocity.lengthSq() < 0.01) {
            this.blockSafetyTimer = (this.blockSafetyTimer || 0) + dt;
            
            if (this.blockSafetyTimer > 3.0) {
                // SAFETY: Force unlock all blocking states
                console.warn(`[SAFETY] Unit ${this.id} was blocked for 3s. Force unlocking all states.`);
                this.pausedByCommand = false;
                this.isWaterPushing = false;
                this.isBouncing = false;
                this.isInTransition = false;
                this.bounceVelocity = 0;
                this.bounceDirection = null;
                this.waterState = 'normal';
                this.waterSlowdownFactor = 1.0;
                this.blockSafetyTimer = 0;
            }
        } else {
            this.blockSafetyTimer = 0;
        }


        // ========================================================
        // TRANSITION ARC FOLLOWING (smooth rejoin after waypoint edit)
        // ========================================================
        if (this.isInTransition && this.transitionPath && this.transitionPath.length > 0 && !this.pausedByCommand && !this.isBouncing) {
            // Follow transition path (exactly like main path, but temporary)
            if (this.transitionIndex >= this.transitionPath.length) {
                // Transition complete - switch to main path
                this.isInTransition = false;
                this.transitionPath = null;
                this.transitionIndex = 0;
                if (window.game?._isDevMode) console.log("Transition arc complete, now following main path");
            } else {
                // Move along transition path
                const target = this.transitionPath[this.transitionIndex];
                if (target) {
                    const distToTarget = this.position.distanceTo(target);

                    // Direction to current target
                    const dir = this._poolTangent.copy(target).sub(this.position).normalize();

                    // CRITICAL FIX: Update velocityDirection explicitly before using it
                    this.velocityDirection.copy(dir);

                    // === SMOOTH HEADING ROTATION (STABILIZED) ===
                    // Use look-ahead to prevent jitter/spinning
                    // CRITICAL FIX: If lookAhead falls off transition path, peek into MAIN path
                    // This ensures smooth rotation blend at the merge point
                    let lookDest = null;
                    const lookAheadCount = 4;

                    if (this.transitionIndex + lookAheadCount < this.transitionPath.length) {
                        // Look ahead on transition path
                        lookDest = this.transitionPath[this.transitionIndex + lookAheadCount];
                    } else if (this.path && this.path.length > 0) {
                        // Look ahead ONTO MAIN PATH
                        // We need the index on main path where we will spawn
                        // this.pathIndex holds the merge point index
                        let mainLookIdx = this.pathIndex + (lookAheadCount - (this.transitionPath.length - this.transitionIndex));

                        // Handle wrap
                        if (mainLookIdx >= this.path.length) {
                            if (this.isPathClosed) mainLookIdx = mainLookIdx % this.path.length;
                            else mainLookIdx = this.path.length - 1;
                        }
                        lookDest = this.path[mainLookIdx];
                    }

                    // VALIDATE LOOK DESTINATION distance
                    // If point is too close, rotation vector is unstable -> leads to spinning
                    if (lookDest) {
                        let attempts = 0;
                        while (this.position.distanceTo(lookDest) < 0.5 && attempts < 5) {
                            // Point too close, look further ahead
                            // (Simplified logic: just push lookDest forward along expected vector or grab next point)
                            // Here we just grab next point
                            // Note: Real robustness involves iterating indices, but this is a heuristic patch
                            // For now, if too close, just use current dir which is stable
                            lookDest = null;
                            break;
                            attempts++;
                        }
                    }

                    const lookDir = lookDest ? this._poolTempDir.copy(lookDest).sub(this.position).normalize() : dir;

                    if (this.headingQuaternion && lookDir.lengthSq() > 0.001) {
                        const sphereNormal = this.getSmoothedNormal();

                        // Project look direction onto terrain tangent plane
                        const tangentDir = this._poolTangent.copy(lookDir).sub(
                            this._poolSphereNormal.copy(sphereNormal).multiplyScalar(lookDir.dot(sphereNormal))
                        ).normalize();

                        if (tangentDir.lengthSq() > 0.001) {
                            // Build orientation: Up=Normal, Forward=Tangent
                            const up = sphereNormal;
                            const forward = tangentDir;
                            const right = this._poolRight.crossVectors(up, forward).normalize();
                            const orthoForward = this._poolOrthoFwd.crossVectors(right, up).normalize();

                            const rotMatrix = this._poolRotMatrix.makeBasis(right, up, orthoForward);
                            const targetQuat = this._poolTargetQuat.setFromRotationMatrix(rotMatrix);

                            // Smooth rotation (dt-independent slerp for inertia)
                            this.headingQuaternion.slerp(targetQuat, 1.0 - Math.pow(0.002, dt));
                        }
                    }
                    // Track velocity direction for arc continuity
                    // this.velocityDirection already updated above
                    this.currentSpeed = moveSpeed;

                    // Advance transition index when close to current target point
                    // (This drives the transition to completion - without it, the unit
                    // would orbit the first transition point forever)
                    if (distToTarget < 1.0) {
                        this.transitionIndex++;
                        if (this.transitionIndex >= this.transitionPath.length) {
                            // Transition complete - switch to main path
                            this.isInTransition = false;
                            this.transitionPath = null;
                            this.transitionIndex = 0;
                            if (window.game?._isDevMode) console.log("Transition arc complete (point advance), now following main path");
                        }
                    }

                    // Project to terrain
                    const posDir = this._poolTempDir.copy(this.position).normalize();
                    const terrainRadius = this.planet.terrain.getRadiusAt(posDir);
                    const groundOffset = this.groundOffset || 0.5;
                    this.position.copy(posDir.multiplyScalar(terrainRadius + groundOffset));
                }
            }
        }

        // ========================================================
        // PATH FOLLOWING LOGIC - SIMPLIFIED & TERRAIN-SAFE
        // ========================================================
        // Rules:
        // 1. NEVER teleport - only incremental movement
        // 2. NEVER reverse - always forward toward goal
        // 3. ALWAYS project to terrain after any movement
        // 4. Follow path[] array sequentially via pathIndex
        // ========================================================

        // Skip main path following if we're in transition
        if (this.path && this.path.length > 0 && this.isFollowingPath && !this.pausedByCommand && !this.isBouncing && !this.isInTransition) {
            // One-time log
            if (!this._pathFollowingLogged) {
                this._pathFollowingLogged = true;
                if (window.game?._isDevMode) console.log(`[Unit] Path following ACTIVE! Path length: ${this.path.length}`);
            }

            // Initialize path index if needed
            if (this.pathIndex === undefined || this.pathIndex < 0) this.pathIndex = 0;

            // Handle path completion / looping
            if (this.pathIndex >= this.path.length) {
                if (this.loopingEnabled || this.isPathClosed) {
                    this.pathIndex = 0;
                } else {
                    // Path completed
                    this.isFollowingPath = false;
                    if (window.game?._isDevMode) console.log("Path completed.");
                }
            }

            // Get current target point on path
            const currentTarget = this.path[this.pathIndex];
            if (!currentTarget) {
                // Invalid target, stop
                this.isFollowingPath = false;
            } else {
                // Calculate remaining distance we can travel this frame
                // Ensure declared only once in this block scope
                let remainingMove = moveSpeed;

                // END-OF-PATH SLOWDOWN (Only for non-looping paths)
                if (!this.loopingEnabled && !this.isPathClosed) {
                    const remainingPoints = this.path.length - this.pathIndex;
                    const slowdownZone = Math.min(30, this.path.length * 0.2);
                    if (remainingPoints < slowdownZone) {
                        const slowdownFactor = Math.max(0.1, remainingPoints / slowdownZone);
                        remainingMove *= slowdownFactor;
                    }
                }

                // === TANGENT-BASED SPEED MODULATION (User Request) ===
                // Compare CURRENT path tangent with FUTURE path tangent (~1s ahead).
                // If they differ (curve ahead), slow down.
                
                let tangentSpeedFactor = 1.0;

                // === UNIFIED COMMAND EXECUTION LOGIC ===
                // Check current command
                const currentCmd = this.commands && this.commands[this.currentCommandIndex];
                
                // If current command is an ACTION (not Move), we execute it
                // 'Move' commands are handled by the pathfinding/movement code below, 
                // but we also check if we need to STOP for an action.
                
                if (currentCmd && currentCmd.type !== 'Move') {
                     // We are performing a non-spatial action (Wait, Build, Attack, etc.)
                     const stopDuration = 1.5; 
                     
                     // Initialize state if needed
                     if (this.actionState === 'idle') {
                         if (window.game?._isDevMode) console.log(`[Unit] Starting Action: ${currentCmd.type}`);
                         this.activeAction = currentCmd; // Keep reference for legacy property if needed, or just use currentCmd
                         this.actionState = 'stopping';
                         this.actionTimer = 0;
                     }
                     
                     if (this.actionState === 'stopping') {
                        // Decelerate
                        this.actionTimer += dt;
                        const progress = Math.min(1, this.actionTimer / stopDuration);
                        this.actionSpeedFactor = 0.5 * (1 + Math.cos(progress * Math.PI)); // 1 -> 0
                        
                        if (progress >= 1.0) {
                            this.actionState = 'waiting';
                            this.actionTimer = 0;
                            this.actionSpeedFactor = 0;
                        }
                    } else if (this.actionState === 'waiting') {
                        // execution
                        this.actionSpeedFactor = 0;
                        this.actionTimer += dt;
                        const duration = currentCmd.params.seconds || 3.0;
                        
                        // Execute payload (if any)
                        // ...
                        
                        if (this.actionTimer >= duration) {
                            if (window.game?._isDevMode) console.log(`[Unit] Action Completed: ${currentCmd.type}`);
                            this.actionState = 'resuming';
                            this.actionTimer = 0;
                        }
                    } else if (this.actionState === 'resuming') {
                        // Accelerate
                        this.actionTimer += dt;
                        const progress = Math.min(1, this.actionTimer / stopDuration);
                        this.actionSpeedFactor = 0.5 * (1 - Math.cos(progress * Math.PI)); // 0 -> 1
                        
                        if (progress >= 1.0) {
                            // Done
                            this.actionState = 'idle';
                            this.actionSpeedFactor = 1.0;
                            this.activeAction = null;
                            
                            // ADVANCE COMMAND QUEUE
                            this.currentCommandIndex++;
                            if (window.game?._isDevMode) console.log(`[Unit] Advanced to command index ${this.currentCommandIndex}`);
                        }
                    }
                } else {
                    // We are either Moving or Idle (no commands)
                    this.actionSpeedFactor = 1.0;
                    this.actionState = 'idle';
                }
                
                if (this.path && this.path.length > 1 && this.pathIndex !== undefined) {
                    const currentIdx = this.pathIndex;
                    const nextIdx = Math.min(this.path.length - 1, currentIdx + 1);
                    
                    if (nextIdx > currentIdx) {
                        // 1. Current Tangent (Direction of current segment)
                        const currentTangent = this._poolTangent.copy(this.path[nextIdx]).sub(this.path[currentIdx]).normalize();

                        // 2. Future Tangent (approx 1s ahead)
                        const lookAheadDist = Math.max(3.0, this.speed * 1.5); 
                        let futureIdx = currentIdx;
                        let distAccum = 0;
                        
                        for (let i = currentIdx; i < this.path.length - 1; i++) {
                            distAccum += this.path[i].distanceTo(this.path[i+1]);
                            if (distAccum >= lookAheadDist) {
                                futureIdx = i;
                                break;
                            }
                        }
                        
                        // If we reached end of path, future tangent is same as last segment
                        const futureNextIdx = Math.min(this.path.length - 1, futureIdx + 1);
                        
                        if (futureNextIdx > futureIdx) {
                            const futureTangent = this._poolTempDir.copy(this.path[futureNextIdx]).sub(this.path[futureIdx]).normalize();

                            // 3. Compare Tangents (Dot Product)
                            // dot = 1.0 (Aligned) -> Max Speed
                            // dot = -1.0 (Opposite) -> Min Speed (Don't stop!)
                            // FIX: Allow negative dot for turnaround, map -1..1 to 0.2..1.0
                            let rawDot = currentTangent.dot(futureTangent);
                            const dot = (rawDot + 1.0) * 0.5; // Map -1..1 to 0..1
                            
                            // === ASYMMETRIC CURVE EASING (User Request) ===
                            // Approach curve: Slow down more (power > 1.0)
                            // Exit curve: Speed up faster (power < 1.0)
                            
                            // Track curve state: Compare with last frame's dot
                            const prevDot = this._lastCurveDot || 1.0;
                            this._lastCurveDot = dot;
                            
                            // Entering curve (dot decreasing) vs Exiting curve (dot increasing)
                            const isEnteringCurve = dot < prevDot;
                            
                            if (isEnteringCurve) {
                                // Approaching curve: More aggressive slowdown (power 1.5)
                                tangentSpeedFactor = Math.pow(Math.max(0, dot), 1.5);
                            } else {
                                // Exiting curve: Faster recovery (power 0.5)
                                tangentSpeedFactor = Math.pow(Math.max(0, dot), 0.5);
                            }
                            
                            // Minimum speed for turnarounds
                            tangentSpeedFactor = Math.max(0.1, tangentSpeedFactor);
                        }
                    }
                }
                
                // Combine with global speed factor AND Action Speed Factor
                let speedFactor = this.speedFactor * tangentSpeedFactor * this.actionSpeedFactor; 
                
                // Force stop ONLY if speedFactor is practically zero (e.g. pause)
                if (speedFactor < 0.001) speedFactor = 0.0;
                
                moveSpeed *= speedFactor;

                // Get water level for path checking
                const waterLevel = this.planet.terrain.params.waterLevel || 0;
                const baseRadius = this.planet.terrain.params.radius || 10;
                const pathWaterRadius = baseRadius + waterLevel;
                const canEnterWater = this.canWalkUnderwater || this.canSwim;

                // SIMPLE FORWARD MOVEMENT along the path
                let iterations = 0;
                const maxIterations = 100;

                while (remainingMove > 0 && this.waterState === 'normal' && iterations < maxIterations) {
                    iterations++;

                    // Bounds check
                    if (this.pathIndex >= this.path.length) {
                        if (this.loopingEnabled || this.isPathClosed) {
                            this.pathIndex = 0;
                        } else {
                            this.isFollowingPath = false;
                            break;
                        }
                    }

                    const target = this.path[this.pathIndex];
                    if (!target) break;

                    // CHECK IF TARGET IS UNDERWATER
                    const targetDir = this._poolTempDir.copy(target).normalize();
                    const targetTerrainRadius = this.planet.terrain.getRadiusAt(targetDir);
                    const targetIsUnderwater = targetTerrainRadius < pathWaterRadius;

                    if (targetIsUnderwater && !canEnterWater) {
                        if (window.game?._isDevMode) console.log("Path leads to water! Starting water pushback.");
                        this.waterState = 'slowing';  // FIXED: was 'backing' which is not handled!
                        this.isFollowingPath = false;
                        break;
                    }

                    const distToTarget = this.position.distanceTo(target);

                    if (distToTarget <= remainingMove) {
                        // Reached this point, move to next
                        // But DON'T teleport - just advance pathIndex
                        this.position.copy(target);
                        remainingMove -= distToTarget;
                        this.pathIndex++;

                        // === WAYPOINT ARRIVAL ===
                        // (Wait logic removed - user request)
                    } else {
                        // Move towards target incrementally
                        const dir = this._poolTangent.copy(target).sub(this.position).normalize();

                        // Calculate desired position
                        const desiredPos = this._poolForward.copy(this.position).addScaledVector(dir, remainingMove);

                        // === ROCK COLLISION CHECK ===
                        if (this.planet && this.planet.rockCollision) {
                            const result = this.planet.rockCollision.checkAndSlide(this.position, desiredPos);

                            if (result.collided && this.bounceCooldown <= 0) {
                                if (result.bounceDir) {
                                    this.bounceDirection = result.bounceDir;
                                    this.bounceVelocity = (remainingMove / (1 / 60)) * 0.2;
                                    this.bounceCooldown = 0.5;
                                }
                            } else if (!result.collided) {
                                this.position.copy(result.position);
                            }
                        } else {
                            this.position.copy(desiredPos);
                        }

                        // Store velocity direction
                        this.velocityDirection.copy(dir);
                        remainingMove = 0;
                    }

                    // === CRITICAL: PROJECT TO TERRAIN AFTER EVERY MOVEMENT ===
                    // This ensures we NEVER go through the ground
                    const posDir = this._poolTempDir.copy(this.position).normalize();
                    const terrainRadius = this.planet.terrain.getRadiusAt(posDir);
                    const groundOffset = this.groundOffset || 0.5;
                    this.position.copy(posDir.multiplyScalar(terrainRadius + groundOffset));

                    // === WAYPOINT ARRIVAL DETECTION (Event-Based) ===
                    // CRITICAL: lastWaypointId is STABLE - only changes when unit ARRIVES at target
                    // targetWaypointId = next waypoint after lastWaypointId in current order
                    //
                    // RULE: Dragging/reordering waypoints does NOT change lastWaypointId!
                    // Only actual arrival (pathIndex crossing target's pathSegmentIndex) triggers update.
                    if (this.pathSegmentIndices && this.waypoints && this.waypoints.length > 0 && this.targetWaypointId) {
                        // Find target waypoint's index in waypoints array
                        const targetWpIdx = this.waypoints.findIndex(wp => wp.id === this.targetWaypointId);
                        
                        if (targetWpIdx !== -1) {
                            // Get the path index where we "arrive" at this waypoint
                            const arrivalPathIdx = this.pathSegmentIndices[targetWpIdx];
                            
                            // Track previous pathIndex to detect CROSSING (not just being past)
                            const prevPathIdx = this._prevPathIndex || 0;
                            this._prevPathIndex = this.pathIndex;
                            
                            // === CROSSING DETECTION ===
                            // Normal case: prevPathIdx < arrivalPathIdx && pathIndex >= arrivalPathIdx
                            // Wrap case (loop from end to start): 
                            //   - Target is waypoint 0, arrivalPathIdx is near 0
                            //   - pathIndex just wrapped from high to low
                            //   - prevPathIdx was high, pathIndex is now low (near 0)
                            
                            let crossed = false;
                            
                            if (targetWpIdx === 0 && (this.loopingEnabled || this.isPathClosed)) {
                                // WRAP-AROUND CASE: Going from last waypoint to first
                                // Detect when we wrapped (pathIndex decreased significantly)
                                const didWrap = prevPathIdx > this.path.length * 0.5 && this.pathIndex < this.path.length * 0.2;
                                crossed = didWrap && this.pathIndex >= arrivalPathIdx;
                            } else {
                                // NORMAL CASE: Simple crossing detection
                                crossed = prevPathIdx < arrivalPathIdx && this.pathIndex >= arrivalPathIdx;
                            }
                            
                            // Check if we've crossed this threshold
                            if (arrivalPathIdx !== undefined && crossed) {
                                // === ARRIVAL DETECTED ===
                                const arrivedWp = this.waypoints[targetWpIdx];
                                
                                // Update lastWaypointId to the waypoint we just arrived at
                                this.lastWaypointId = arrivedWp.id;
                                
                                // Mark as 'left' (we're now leaving it)
                                arrivedWp.logicalState = 'left';
                                arrivedWp.actionCompletedCount = (arrivedWp.actionCompletedCount || 0) + 1;
                                
                                // Find NEXT target in current sequence
                                let nextWpIdx = targetWpIdx + 1;
                                if (nextWpIdx >= this.waypoints.length) {
                                    if (this.loopingEnabled || this.isPathClosed) nextWpIdx = 0;
                                    else nextWpIdx = this.waypoints.length - 1;
                                }
                                
                                const newTargetWp = this.waypoints[nextWpIdx];
                                if (newTargetWp && newTargetWp.id !== arrivedWp.id) {
                                    this.targetWaypointId = newTargetWp.id;
                                    newTargetWp.logicalState = 'approaching';
                                    newTargetWp.actionStartedCount = (newTargetWp.actionStartedCount || 0) + 1;
                                }
                                
                                // Set all other waypoints to 'neutral'
                                this.waypoints.forEach(wp => {
                                    if (wp.id !== this.lastWaypointId && wp.id !== this.targetWaypointId) {
                                        wp.logicalState = 'neutral';
                                    }
                                });
                                
                                if (window.game?._isDevMode) console.log(`[ARRIVAL] Arrived at ${arrivedWp.id?.slice(-4)}, next target: ${newTargetWp?.id?.slice(-4)}`);
                            
                                // === COMMAND PROGRESSION ===
                                // Check if the waypoint we arrived at corresponds to the current command
                                if (this.commands && this.commands[this.currentCommandIndex]) {
                                    const currentCmd = this.commands[this.currentCommandIndex];
                                    
                                    // Match IDs (arrivedWp.id IS the command ID)
                                    if (currentCmd && arrivedWp.id === currentCmd.id) {
                                        if (window.game?._isDevMode) console.log(`[Unit] Finished Move Command: ${currentCmd.id}`);
                                        this.currentCommandIndex++;
                                        
                                        // Update status
                                        currentCmd.status = 'completed';
                                    }
                                }
                            }
                        }
                    }
                    
                    // === FIRST-TIME INITIALIZATION ===
                    // If no targetWaypointId yet, initialize from lastWaypointId (or start)
                    if (this.waypoints && this.waypoints.length > 1 && !this.targetWaypointId) {
                        // Find lastWaypointId index, default to 0
                        let lastIdx = 0;
                        if (this.lastWaypointId) {
                            const foundIdx = this.waypoints.findIndex(wp => wp.id === this.lastWaypointId);
                            if (foundIdx !== -1) lastIdx = foundIdx;
                        } else {
                            // No lastWaypointId - initialize to first waypoint
                            this.lastWaypointId = this.waypoints[0].id;
                            this.waypoints[0].logicalState = 'left';
                        }
                        
                        // Next target is after lastIdx
                        let nextIdx = lastIdx + 1;
                        if (nextIdx >= this.waypoints.length) {
                            if (this.loopingEnabled || this.isPathClosed) nextIdx = 0;
                            else nextIdx = this.waypoints.length - 1;
                        }
                        
                        this.targetWaypointId = this.waypoints[nextIdx].id;
                        this.waypoints[nextIdx].logicalState = 'approaching';
                        if (window.game?._isDevMode) console.log(`[INIT] last=${this.lastWaypointId?.slice(-4)} target=${this.targetWaypointId?.slice(-4)}`);
                    }
                }
            }

            // ========================================================
            // GENERAL MOVEMENT & BRAKING (Transition, Manual, or Idle)
            // ========================================================
            // Runs if:
            // 1. We are in Transition (Main path logic skipped)
            // 2. We are NOT following path (Manual or Braking)
            // Does NOT run if following Main Path (handled above to avoid double-move)

            if (this.isInTransition || !this.isFollowingPath) {
                // Apply movement
                if (this.isFollowingPath) {
                    // TRANSITION MOVEMENT (Path logic uses velocityDirection set by transition arc)
                    const currentSpeed = this.speed; // Could add turn speed logic here too if needed

                    if (this.velocityDirection) {
                        this.position.addScaledVector(this.velocityDirection, currentSpeed * dt);
                        this.velocity.copy(this.velocityDirection).multiplyScalar(currentSpeed);
                    }
                    this.isBraking = false;
                } else if (autoMove !== 0) {
                    // MANUAL / AUTO MOVEMENT (Smooth Acceleration)
                    const targetSpeed = this.speed * autoMove;
                    const moveDir = this._poolMoveDir.set(0, 0, 1).applyQuaternion(this.headingQuaternion); // Forward

                    const targetVel = this._poolTempDir.copy(moveDir).multiplyScalar(targetSpeed);

                    // Smooth Ease-In (Acceleration)
                    // Lerp velocity towards target (dt * factor)
                    const accelFactor = 3.0; // Adjust for "weight" feel
                    this.velocity.lerp(targetVel, dt * accelFactor);

                    // Scale position by ACTUAL velocity, not target
                    this.position.addScaledVector(this.velocity, dt);

                    if (!this.velocityDirection) this.velocityDirection = new THREE.Vector3();
                    // Use velocity for direction if moving, otherwise keep last
                    if (this.velocity.lengthSq() > 0.01) {
                        this.velocityDirection.copy(this.velocity).normalize();
                    }
                    this.isBraking = false;
                } else {
                    // IDLE / BRAKING ("Easy In" Stop)
                    const speedSq = this.velocity.lengthSq();
                    if (speedSq > 0.01) {
                        const friction = 0.92;
                        this.velocity.multiplyScalar(friction);
                        this.position.addScaledVector(this.velocity, dt);

                        // Update direction to match slide
                        if (!this.velocityDirection) this.velocityDirection = new THREE.Vector3();
                        this.velocityDirection.copy(this.velocity).normalize();
                    } else {
                        this.velocity.set(0, 0, 0);
                        // Optional: Clear velocityDirection when fully stopped? No, keep facing last dir.
                    }
                }
            }

            // === LOOK-AHEAD STEERING for smooth curves ===
            // Override velocityDirection with a blended look-ahead direction so the unit
            // anticipates turns instead of reacting AFTER reaching each sample point.
            // Only active during autonomous path-following (not keyboard override).
            if (this.isFollowingPath && this.path && this.path.length > 0 && !this.isKeyboardOverriding) {
                const lookAheadPoints = 8; // ~4 meters ahead at 0.5m spacing
                const blendedDir = this._poolBlendedDir.set(0, 0, 0);
                let totalWeight = 0;
                const tempDir = this._poolTempDir;

                for (let la = 0; la < lookAheadPoints; la++) {
                    let idx = this.pathIndex + la;
                    if (idx >= this.path.length) {
                        if (this.isPathClosed || this.loopingEnabled) {
                            idx = idx % this.path.length;
                        } else {
                            idx = this.path.length - 1;
                        }
                    }
                    tempDir.copy(this.path[idx]).sub(this.position);
                    if (tempDir.lengthSq() < 0.001) continue;
                    tempDir.normalize();
                    const weight = 1.0 / (1.0 + la * 0.5); // Closer points weigh more
                    blendedDir.addScaledVector(tempDir, weight);
                    totalWeight += weight;
                }

                if (totalWeight > 0 && blendedDir.lengthSq() > 0.001) {
                    blendedDir.divideScalar(totalWeight).normalize();
                    // Use blended direction for heading calculation
                    this.velocityDirection.copy(blendedDir);
                }
            }

            // ORIENTATION: Look toward path direction
            // STRICT RULE: "Unit mindíg abba az irányba fordul, amerre megy."
            // Use velocityDirection (actual movement) instead of theoretical path tangent

            const tangent = this._poolTangent.set(0, 0, 0);

            if (this.velocityDirection && this.velocityDirection.lengthSq() > 0.001) {
                tangent.copy(this.velocityDirection).normalize();
            } else {
                // Fallback if stationary: look ahead
                let lookAhead = this.pathIndex + 1; // Look immediate next
                if (lookAhead >= this.path.length) {
                    if (this.loopingEnabled || this.isPathClosed) lookAhead = lookAhead % this.path.length;
                    else lookAhead = this.path.length - 1;
                }

                if (this.path[lookAhead]) {
                    tangent.copy(this.path[lookAhead]).sub(this.position).normalize();
                } else if (this.path[this.pathIndex]) {
                    tangent.copy(this.path[this.pathIndex]).sub(this.position).normalize();
                }
            }

            // Project tangent onto SMOOTHED terrain plane (for tilt + smoothness)
            // Visual tilt is handled here directly
            const sphereNormal = this.getSmoothedNormal(); // Use smoothed normal instead of rigid sphere normal
            const dotTN = tangent.dot(sphereNormal);
            const projectedTangent = this._poolForward.copy(tangent).sub(
                this._poolSphereNormal.copy(sphereNormal).multiplyScalar(dotTN)
            ).normalize();

            if (projectedTangent.lengthSq() > 0.01) {
                // Build orientation from Smoothed Normal (up) and curve tangent (forward)
                const up = sphereNormal;
                const forward = projectedTangent;
                const right = this._poolRight.crossVectors(up, forward).normalize();

                // Re-orthogonalize forward
                const orthoForward = this._poolOrthoFwd.crossVectors(right, up).normalize();

                // Build rotation matrix
                const m = this._poolRotMatrix.makeBasis(right, up, orthoForward);
                const targetHeading = this._poolTargetQuat.setFromRotationMatrix(m);

                // STRICT ORIENTATION: Heading (Forward)
                // User requirement: "Unit mindíg abba az irányba fordul, amerre megy."
                // But Normal (Up) must be SMOOTH to avoid JITTER ("remegés").
                
                // 1. Calculate Target Orientation
                // Note: 'm' and 'targetHeading' were calculated above (lines 1106-1107)
                // We use them directly.
                const targetQuaternion = targetHeading;

                // 2. Separate Heading vs Tilt
                // We want strict Heading but Smooth Tilt?
                // Actually, full slerp with high speed (e.g., 20) is usually best for both.
                // The previous "Strict Copy" was causing the jitter because terrain normals are noisy.
                
                // RE-ENABLE SMOOTH ROTATION (High speed = fast but not instant)
                const rotateSpeed = 12.0; // Inertia: physical objects don't snap-turn instantly
                this.headingQuaternion.slerp(targetQuaternion, dt * rotateSpeed);
                this.mesh.quaternion.copy(this.headingQuaternion);
            }

            // Skip normal movement
            autoMove = 0;
            autoTurn = 0;
        } else if (this.isInTransition && this.transitionPath && this.transitionPath.length > 0) {
            // TRANSITION PATH FOLLOWING (Simple Point-to-Point for Smooth Curve)
            const target = this.transitionPath[0];
            const dist = this.position.distanceTo(target);

            // Move towards target
            const toTarget = target.clone().sub(this.position).normalize();

            // Speed control (Smooth Ease-In during transition - gradual for inertia)
            const targetVel = toTarget.multiplyScalar(this.speed);
            this.velocity.lerp(targetVel, dt * 2.0);
            this.velocityDirection = toTarget.clone();

            // Advance point (Simpler threshold for smooth curve traversal)
            if (dist < 1.0) {
                this.lastWaypoint = target.clone();
                this.transitionPath.shift();
                this.transitionIndex++;
                if (this.transitionPath.length === 0) {
                    this.isInTransition = false;
                    this.transitionPath = null;
                    // Resume normal path: Skip points that we merged past
                    // InteractionManager sets pathIndex to the merge point index
                    // Resume normal path. Path indices are preserved.
                    // DO NOT SPLICE.
                }
            }
        } else if (this.isFollowingPath && this.path && this.path.length > 0) {
            // === INITIAL STATE: At start, Blue = waypoints[0], Orange = waypoints[1] ===
            // This runs ONCE when path following begins. Sequence order, not proximity.
            if (this.waypoints && this.waypoints.length > 1 && !this.targetWaypointId) {
                this.lastWaypointId = this.waypoints[0].id;    // Start point = Blue (just left)
                this.targetWaypointId = this.waypoints[1].id; // First destination = Orange
                if (window.game?._isDevMode) console.log(`[Unit ${this.id || 'unknown'}] INIT: last=${this.lastWaypointId?.slice(-4)} target=${this.targetWaypointId?.slice(-4)}`);
            }


            // NOTE: Main waypoint state updates are now handled in the movement loop above.
            // This else-if block only runs when NOT in main movement (edge cases).

            // === AUTOMATIC STATE INITIALIZATION ===
            // This MUST run every frame, not just when close to a point!
            // Ensures we always have a target if waypoints exist.
            if (this.waypoints && this.waypoints.length > 0) {
                // 1. Validate Existing ID (remove stale references)
                if (this.targetWaypointId && !this.waypoints.find(wp => wp.id === this.targetWaypointId)) {
                    this.targetWaypointId = null;
                }

                // 2. If No Target, Find One
                if (!this.targetWaypointId) {
                    // First, try to find one marked as 'approaching'
                    const approachingWP = this.waypoints.find(wp => wp.logicalState === 'approaching');
                    if (approachingWP) {
                        this.targetWaypointId = approachingWP.id;
                    } else {
                        // Default to the second point (index 1) if available, or first (0)
                        const nextIdx = this.waypoints.length > 1 ? 1 : 0;
                        const defaultTarget = this.waypoints[nextIdx];
                        if (defaultTarget) {
                            this.targetWaypointId = defaultTarget.id;
                            defaultTarget.logicalState = 'approaching';
                        }
                    }
                }
            }

            // SEGMENT TRACKING LOGIC (Non-destructive)
            if (this.pathIndex >= this.path.length) {
                if (this.loopingEnabled) this.pathIndex = 0;
            }

            if (this.pathIndex < this.path.length) {
                const target = this.path[this.pathIndex];
                const dist = this.position.distanceTo(target);

                if (dist < 1.0) {
                    // Reached path point - advance index
                    this.lastWaypoint = target.clone();
                    this.lastPassedControlPointIndex = this.pathIndex;
                    this.pathIndex++;
                    this.targetControlPointIndex = this.pathIndex;
                    
                    // Wrap check
                    if (this.pathIndex >= this.path.length) {
                         if (this.loopingEnabled) this.pathIndex = 0;
                    }
                }
                
                // NOTE: Waypoint state updates are now handled exclusively in the main movement loop.
                // This block only handles basic path point arrival.
            }
            // NOTE: Removed 'else' block that used undefined 'target' variable.
            // Fallback movement is handled elsewhere.
        }

        // Manual Steering Logic (Mouse Hold)
        if (this.isSteering && this.steerTarget) {
            const target = this.steerTarget;
            // Calculate steering
            const basis = SphericalMath.getBasis(this.headingQuaternion);
            const toTarget = target.clone().sub(this.position).normalize();
            const up = basis.up;
            const tangentTarget = toTarget.clone().sub(up.clone().multiplyScalar(toTarget.dot(up))).normalize();

            const forward = basis.forward;
            const right = basis.right;

            const cross = right.dot(tangentTarget);

            if (Math.abs(cross) > 0.05) autoTurn = Math.sign(cross);

            // FIX: ALWAYS move toward target - NO direction restriction!
            autoMove = 1;
        }

        // Calculate manual input values
        const manualTurn = (input.right ? 1 : 0) - (input.left ? 1 : 0);
        const manualMove = (input.forward ? 1 : 0) - (input.backward ? 1 : 0);

        // KEYBOARD OVERRIDE SYSTEM
        // When user uses keyboard, take IMMEDIATE control
        const hasKeyboardInput = manualTurn !== 0 || manualMove !== 0;

        if (hasKeyboardInput) {
            // User is using keyboard - ALWAYS take control
            this.keyboardOverrideTimer = 0;
            
            // If not already overriding, save path state and take control
            if (!this.isKeyboardOverriding) {
                if (this.isFollowingPath && this.path && this.path.length > 0) {
                    // Save path for potential resume later
                    this.savedPath = [...this.path];
                    this.savedPathIndex = this.pathIndex || 0;
                }
                this.isKeyboardOverriding = true;
                this.isFollowingPath = false;
                // Cancel any active transition arc (user is taking manual control)
                if (this.isInTransition) {
                    this.isInTransition = false;
                    this.transitionPath = null;
                    this.transitionIndex = 0;
                }
                // Bug #13 fix: Re-align headingQuaternion to current mesh orientation
                // when transitioning from path-following to manual control. Without this,
                // headingQuaternion retains the last path-following direction which may
                // not match the mesh's visual forward after drift fix re-projection.
                if (this.headingQuaternion && this.mesh) {
                    this.headingQuaternion.copy(this.mesh.quaternion);
                }
                // Don't set pausedByCommand here - we're actively controlling
                this.setHeadlightsOn(true);
            }
            
            // CRITICAL: Clear pausedByCommand during active keyboard control
            // Otherwise input is blocked by line 1467
            this.pausedByCommand = false;
            
        } else {
            // No keyboard input
            if (this.isKeyboardOverriding) {
                // Was overriding, now stopped - start countdown
                this.keyboardOverrideTimer += dt;
                
                // After 0.5s of no input, end override mode but KEEP CONTROL AVAILABLE
                // User can resume keyboard control at any time without pressing Play
                if (this.keyboardOverrideTimer > 0.5) {
                    this.isKeyboardOverriding = false;

                    // Do NOT auto-rejoin path - user must press Play to resume
                    // Just stop the unit and keep saved path for later
                    this.velocity.set(0, 0, 0);
                    this.velocityDirection.set(0, 0, 0);
                    // Keep savedPath intact so Play button can use it later
                }
            }
        }

        // Calculate final input (manual or auto)
        // BLOCK INPUT DURING BOUNCE OR WATER PUSH - unit is uncontrollable
        const isLocked = this.isBouncing || this.isWaterPushing;
        const turnInput = isLocked ? 0 : (this.pausedByCommand ? manualTurn : (manualTurn || autoTurn));
        let moveInput = isLocked ? 0 : (this.pausedByCommand ? manualMove : (manualMove || autoMove));

        // === HEADLIGHTS LOGIC ===
        // Rule: ON when selected OR moving/following path
        // After deselect: stay on for 3 seconds if no movement action, then turn off
        const isMoving = this.velocity.lengthSq() > 0.05; // ~0.22 speed threshold
        const isActive = isMoving || hasKeyboardInput || this.isFollowingPath || this.isInTransition;

        if (this.isSelected) {
            // Selected: always keep headlights on
            this.headlightIdleTimer = 0;
            this.setHeadlightsOn(true);
        } else if (isActive) {
            // Not selected but has movement - keep on, reset timer
            this.headlightIdleTimer = 0;
            this.setHeadlightsOn(true);
        } else {
            // Not selected and idle - use 3 second countdown from deselect
            const timeSinceDeselect = this._deselectTimestamp
                ? (performance.now() - this._deselectTimestamp) / 1000
                : 999;

            if (timeSinceDeselect > 3) {
                this.setHeadlightsOn(false);
            } else {
                this.setHeadlightsOn(true); // Keep on during 3s grace period
            }
        }

        // Initialize heading quaternion if needed
        if (!this.headingQuaternion) {
            this.headingQuaternion = this.mesh.quaternion.clone();
        }

        // DRIFT FIX: Force HeadingQuaternion to Align with Sphere Normal
        // This ensures the "Vertical Axis" of the quaternion is always the Sphere Normal
        // SKIP during path following - orientation is already handled by slerp in path logic
        if (!this.isFollowingPath || this.isInTransition) {
            const currentSphereNormal = this._poolSphereNormal.copy(this.position).normalize();
            const headingForward = this._poolForward.set(0, 0, 1).applyQuaternion(this.headingQuaternion).normalize();
            // Project forward to be orthogonal to sphere normal
            const dotHF = headingForward.dot(currentSphereNormal);
            const orthoForward = this._poolOrthoFwd.copy(headingForward).sub(this._poolTempDir.copy(currentSphereNormal).multiplyScalar(dotHF)).normalize();

            const sphereRight = this._poolRight.crossVectors(currentSphereNormal, orthoForward).normalize();
            const sphereBasis = this._poolRotMatrix.makeBasis(sphereRight, currentSphereNormal, orthoForward);
            this.headingQuaternion.setFromRotationMatrix(sphereBasis);
        }

        // 1. Handle Turning (Local Y Axis) - with rotational inertia
        {
            let targetTurnSpeed = 0;
            if (turnInput !== 0) {
                let dir = turnInput > 0 ? -1 : 1; // Invert because Right is Negative Rotation

                // INVERTED REVERSE STEERING
                // If we are strictly reversing (manual input < 0 or auto-reverse), flip steering.
                // Check moveInput (which captures manual or auto move command)
                if (moveInput < 0) {
                    dir *= -1;
                }
                targetTurnSpeed = dir * this.turnSpeed;
            }

            // Smooth turn velocity: ease-in when starting, ease-out when stopping
            const turnLerpRate = turnInput !== 0 ? 4.0 : 6.0; // Faster decel than accel
            this.currentTurnSpeed = THREE.MathUtils.lerp(this.currentTurnSpeed, targetTurnSpeed, dt * turnLerpRate);

            // Snap to zero if negligible (avoid micro-rotation drift)
            if (Math.abs(this.currentTurnSpeed) < 0.01) this.currentTurnSpeed = 0;

            if (this.currentTurnSpeed !== 0) {
                // Rotate around World Up (Sphere Normal) to ensure correct Yaw
                const axis = this._poolAxis.copy(this.position).normalize();
                const rot = this._poolTempQuat.setFromAxisAngle(axis, this.currentTurnSpeed * dt);
                this.headingQuaternion.premultiply(rot);
            }
        }

        // 2. Handle Movement (Local Z Axis)
        const forwardWorld = this._poolMoveDir.set(0, 0, 1).applyQuaternion(this.headingQuaternion).normalize();


        // === WATER BEHAVIOR (Delegated) ===
        moveInput = this.updateWaterBehavior(dt, moveInput);

        if (moveInput !== 0) {

            const oldPos = this.position.clone();
            const oldSphereNormal = oldPos.clone().normalize();

            const baseRadius = this.planet.terrain.params.radius || 10;

            // CRITICAL: During pushback, moveSpeed is 0 because waterSlowdownFactor is 0.
            // Use raw speed calculation during pushback so the unit actually moves!
            const isPushbackState = (this.waterState === 'pushing_out' || this.waterState === 'recovering');
            const effectiveMoveSpeed = isPushbackState
                ? (this.speed || 10) * dt * this.speedFactor  // Raw speed without waterSlowdownFactor
                : moveSpeed;
            const dist = moveInput * effectiveMoveSpeed;

            // Calculate potential new position
            const newPosRaw = SphericalMath.moveAlongGreatCircle(
                oldPos,
                forwardWorld,
                dist,
                baseRadius
            );

            // Apply movement (including backing/wading slowdown)
            {
                // IMPORTANT: Don't apply slowdown during pushback - use raw moveInput
                const isPushbackState = (this.waterState === 'pushing_out' || this.waterState === 'recovering');
                const adjustedDist = isPushbackState ? dist : (dist * this.waterSlowdownFactor);

                let finalPos = SphericalMath.moveAlongGreatCircle(
                    oldPos,
                    forwardWorld,
                    adjustedDist,
                    baseRadius
                );

                // === ROCK COLLISION CHECK (Manual/Keyboard movement) ===
                if (this.planet && this.planet.rockCollision) {
                    const result = this.planet.rockCollision.checkAndSlide(oldPos, finalPos);

                    if (result.collided && result.bounceDir && this.bounceCooldown <= 0) {
                        // COLLISION: Stay at current position (oldPos), trigger bounce back
                        this.bounceDirection = result.bounceDir; // Opposite of movement
                        this.bounceVelocity = Math.abs(adjustedDist) / (1 / 60) * 0.2; // Reduced from 0.5 for gentler shake
                        this.bounceCooldown = 0.5;
                        finalPos = oldPos; // DON'T move toward rock
                        if (window.game?._isDevMode) console.log('[Unit] Rock collision (keyboard)! Bouncing back on path...');
                    }
                    // If no collision, finalPos stays as calculated (normal movement)
                }

                this.position.copy(finalPos);

                // Update Orientation (Parallel Transport)
                const newSphereNormal = this.position.clone().normalize();
                const newHeading = SphericalMath.applyParallelTransport(
                    this.headingQuaternion,
                    oldSphereNormal,
                    newSphereNormal
                );
                this.headingQuaternion.copy(newHeading);
            }
        } else {
            // Not moving - reset water state if in transitional state
            // Don't reset if shaking/backing (those need to complete)
            if (this.waterState === 'wading' || this.waterState === 'escaping' || this.waterState === 'stopped') {
                this.waterState = 'normal';
                this.waterSlowdownFactor = 1.0;
            }
        }

        // 3. Apply Terrain Slope (Visual Only)
        // We calculate the precise orientation:
        // Up = Terrain Normal
        // Forward = Heading Forward projected on Terrain Plane

        // SKIP snapToSurface when following path - path points are already on terrain
        if (!this.isFollowingPath) {
            this.snapToSurface();
        }

        // Use smoothed normal for better alignment
        const terrainNormal = this.getSmoothedNormal();

        // Get forward from heading (which is sphere-aligned)
        // const basis = SphericalMath.getBasis(this.headingQuaternion); // Already declared above
        // Reuse existing basis or just get forward from heading directly if basis changed?
        // Actually basis above (line 77) was from headingQuaternion BEFORE movement.
        // Heading quaternion might have changed in step 1 (turn) or step 2 (transport).
        // So we should re-calculate basis or just use getBasis again but assign to new var or let.

        // Compute target orientation:
        // 1. Start with Heading (Sphere aligned).
        // 2. Rotate to match Terrain Normal (Tilt).

        // Heading basis (Sphere space)
        const visualHeadingForward = this._poolForward.set(0, 0, 1).applyQuaternion(this.headingQuaternion).normalize();

        // Construct Basis aligned to Terrain Normal but facing Heading
        const up = terrainNormal;

        // Project Heading Forward onto Terrain Plane
        const dotVU = visualHeadingForward.dot(up);
        const forward = this._poolOrthoFwd.copy(visualHeadingForward).sub(this._poolTempDir.copy(up).multiplyScalar(dotVU)).normalize();

        // Calculate Right (Up x Forward)
        const right = this._poolRight.crossVectors(up, forward).normalize();

        // Re-calculate Forward to ensure orthogonality (Forward = Right x Up)
        forward.crossVectors(right, up).normalize();

        // Create Target Rotation Matrix
        const m = this._poolRotMatrix.makeBasis(right, up, forward);
        const targetQuat = this._poolTargetQuat.setFromRotationMatrix(m);

        // Smoothly rotate mesh towards target (dt-independent visual smoothing)
        this.mesh.quaternion.slerp(targetQuat, 1.0 - Math.pow(0.001, dt));

        // R008: Removed direct mesh.position.copy(this.position)
        // Mesh position is now set by applyInterpolatedRender() for smooth 60fps motion.
        // The authoritative this.position is snapshotted before/after update() by Game.

        // Update logical quaternion for Camera (Sphere Aligned)
        this.quaternion.copy(this.headingQuaternion);

        // === DUST PARTICLE UPDATE ===
        this.updateDustParticles(dt, moveInput !== 0 && this.speedFactor > 0.1);

        // Update Selection Effects
        this.updateSelectionVisuals(dt);

        // Calculate Actual Speed (for Audio)
        const moveDist = this.position.distanceTo(startPos);
        this.currentSpeed = moveDist / Math.max(dt, 0.001);
    }

    // === R008: RENDER INTERPOLATION METHODS ===
    // These are called by Game to enable smooth 60fps rendering while sim runs at 20Hz.

    /**
     * R008: Snapshot the PREVIOUS authoritative state BEFORE sim tick.
     * Called at start of Game.simTick().
     */
    snapshotPrevAuthState() {
        if (!this._interpInitialized) {
            // First tick: initialize both to current position
            this._interpPrevPos.copy(this.position);
            this._interpCurrPos.copy(this.position);
            this._interpPrevQuat.copy(this.mesh.quaternion);
            this._interpCurrQuat.copy(this.mesh.quaternion);
            this._interpInitialized = true;
        } else {
            // Subsequent ticks: prev = old curr
            this._interpPrevPos.copy(this._interpCurrPos);
            this._interpPrevQuat.copy(this._interpCurrQuat);
        }
    }

    /**
     * R008: Snapshot the CURRENT authoritative state AFTER sim tick.
     * Called at end of Game.simTick().
     */
    snapshotCurrAuthState() {
        this._interpCurrPos.copy(this.position);
        this._interpCurrQuat.copy(this.mesh.quaternion);
    }

    /**
     * R008: Apply interpolated position/rotation to mesh for smooth rendering.
     * Called every frame by Game.applyInterpolatedRender(alpha).
     *
     * @param {number} alpha - Interpolation factor [0, 1] from SimLoop accumulator
     */
    applyInterpolatedRender(alpha) {
        if (!this._interpInitialized) {
            // Fallback: just use authoritative position if not yet initialized
            this.mesh.position.copy(this.position);
            return;
        }

        // Lerp position between prev and curr
        this.mesh.position.lerpVectors(this._interpPrevPos, this._interpCurrPos, alpha);

        // Slerp quaternion between prev and curr
        this.mesh.quaternion.copy(this._interpPrevQuat);
        this.mesh.quaternion.slerp(this._interpCurrQuat, alpha);
    }

    // === DUST PARTICLE SYSTEM ===
    updateDustParticles(dt, isMoving) {
        // === LAZY INIT (INSTANCED MESH) ===
        if (!this.dustInstancedMesh) {
             const dustGeo = new THREE.PlaneGeometry(1.0, 1.0);
             const dustTex = this.createDustTexture();
             
             // Base Material
             const mat = new THREE.MeshBasicMaterial({
                 map: dustTex,
                 transparent: true, 
                 opacity: 1.0,
                 depthWrite: false,
                 depthTest: true,
                 side: THREE.DoubleSide
             });
             
             // Shader Injection for GPU Animation
             mat.onBeforeCompile = (shader) => {
                 shader.uniforms.uTime = { value: 0 };
                 
                 shader.vertexShader = `
                     attribute float aBirthTime;
                     uniform float uTime;
                     varying float vLife;
                 ` + shader.vertexShader;
                 
                 shader.vertexShader = shader.vertexShader.replace(
                     '#include <begin_vertex>',
                     `
                     vec3 transformed = vec3( position );
                     float age = uTime - aBirthTime;
                     float maxLife = 4.0; // 4 seconds lifetime
                     
                     if (age < 0.0 || age > maxLife) {
                         transformed = vec3(0.0); // Hide by collapsing
                         vLife = 0.0;
                     } else {
                         float lifeFrac = age / maxLife; // 0 to 1
                         
                         // Expansion: 1.5 -> 30.0 (Fast initial growth)
                         // Curve: 1 - (1-t)^3 (Ease Out Cubic-ish)
                         float growth = 1.0 - pow(1.0 - lifeFrac, 3.0);
                         float scale = 1.5 + (28.5 * growth); 
                         
                         transformed *= scale; 
                         vLife = 1.0 - lifeFrac; // Alpha: 1 -> 0
                     }
                     `
                 ).replace('#include <project_vertex>', 
                    '#include <project_vertex>'
                 );
                 
                 shader.fragmentShader = `
                     varying float vLife;
                 ` + shader.fragmentShader;
                 
                 shader.fragmentShader = shader.fragmentShader.replace(
                     '#include <map_fragment>',
                     `
                     #include <map_fragment>
                     // Apply fade out
                     diffuseColor.a *= vLife * 0.5; // Base opacity 0.5 max
                     `
                 );
                 mat.userData.shader = shader;
             };
             
             // Create InstancedMesh
             this.dustInstancedMesh = new THREE.InstancedMesh(dustGeo, mat, this.dustMaxParticles);
             this.dustInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
             this.dustInstancedMesh.count = this.dustMaxParticles;
             this.dustInstancedMesh.frustumCulled = false; // Always draw, shader handles visibility
             
             // Attribute: Birth Time
             const birthTimes = new Float32Array(this.dustMaxParticles).fill(-9999);
             const birthAttr = new THREE.InstancedBufferAttribute(birthTimes, 1);
             birthAttr.setUsage(THREE.DynamicDrawUsage);
             this.dustInstancedMesh.geometry.setAttribute('aBirthTime', birthAttr);
             
             // Add to Scene
             // We need to find the scene (traversal)
             let scene = this.game?.scene;
             if (!scene && this.mesh) {
                let p = this.mesh.parent;
                while (p && p.parent) p = p.parent;
                scene = p;
             }
             
             if (scene) {
                 scene.add(this.dustInstancedMesh);
                 this.dustInitialized = true;
                 console.log('[Dust] Optimized System Initialized');
             }
             
             this.dustCursor = 0;
             this.dustTime = 0;
        }
        
        // Update Time Uniform
        this.dustTime = (this.dustTime || 0) + dt;
        if (this.dustInstancedMesh && this.dustInstancedMesh.material.userData.shader) {
            this.dustInstancedMesh.material.userData.shader.uniforms.uTime.value = this.dustTime;
        }
        
        // Spawn Logic
         const inWater = this.waterState && this.waterState !== 'normal';
         if (isMoving && !this.isBouncing && !inWater) {
             this.dustSpawnTimer -= dt;
             
             if (this.dustSpawnTimer <= 0) {
                 this.dustSpawnTimer = this.dustSpawnInterval || 0.05;
                 
                  // Calc Spawn Positions (Back wheels)
                  const wheelOffsetSide = 0.15;
                  const wheelOffsetFront = 0.2; 
                  const basis = SphericalMath.getBasis(this.headingQuaternion);
                  
                  const getWheelPos = (sideMul, frontMul) => {
                        const pos = this.position.clone()
                            .add(basis.right.clone().multiplyScalar(sideMul * wheelOffsetSide))
                            .add(basis.forward.clone().multiplyScalar(frontMul * wheelOffsetFront));
                        const dir = pos.normalize();
                        const radius = this.planet.terrain.getRadiusAt(dir);
                        return dir.multiplyScalar(radius + 0.05);
                  };

                  const pBL = getWheelPos(-1, -1);
                  const pBR = getWheelPos(1, -1);
                  const spawnPoints = [pBL, pBR];
                  
                  const dummy = new THREE.Object3D();
                  
                  for (const pos of spawnPoints) {
                      const idx = this.dustCursor;
                      
                      // Position & Orientation
                      dummy.position.copy(pos);
                      
                      // Align to surface
                      const up = pos.clone().normalize();
                      const forward = basis.forward.clone();
                      const right = new THREE.Vector3().crossVectors(up, forward).normalize();
                      const adjForward = new THREE.Vector3().crossVectors(right, up).normalize();
                      
                      const m = new THREE.Matrix4();
                      m.makeBasis(right, adjForward, up);
                      dummy.quaternion.setFromRotationMatrix(m);
                      
                      // visual-only randomness, nondeterministic allowed
                      dummy.rotateZ(Math.random() * Math.PI * 2);
                      dummy.updateMatrix();
                      
                      // Update Instance
                      this.dustInstancedMesh.setMatrixAt(idx, dummy.matrix);
                      this.dustInstancedMesh.geometry.attributes.aBirthTime.setX(idx, this.dustTime);
                      
                      // Move cursor
                      this.dustCursor = (this.dustCursor + 1) % this.dustMaxParticles;
                  }
                  
                  // Mark updates
                  this.dustInstancedMesh.instanceMatrix.needsUpdate = true;
                  this.dustInstancedMesh.geometry.attributes.aBirthTime.needsUpdate = true;
             }
         }
    }

    createDustTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');

        // Dust texture: fluffy cloud-like edges, 50% overall transparency
        // Create irregular/fluffy edge by using multiple overlapping gradients
        const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        grad.addColorStop(0.0, 'rgba(255, 255, 255, 0.5)');  // Center: 50% opacity
        grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.45)'); // Mid: slightly less
        grad.addColorStop(0.75, 'rgba(255, 255, 255, 0.25)'); // Outer: fading
        grad.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');   // Edge: transparent

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 64, 64);

        // Add noise/irregularity for cloud-like fluffy edges
        const imageData = ctx.getImageData(0, 0, 64, 64);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            const x = (i / 4) % 64;
            const y = Math.floor((i / 4) / 64);
            const dist = Math.sqrt((x - 32) ** 2 + (y - 32) ** 2);

            // Add noise to outer regions for fluffy edge
            // visual-only randomness, nondeterministic allowed
            if (dist > 16) {
                const noise = (Math.random() - 0.5) * 0.3;
                data[i + 3] = Math.max(0, Math.min(255, data[i + 3] * (1 + noise)));
            }
        }
        ctx.putImageData(imageData, 0, 0);

        return new THREE.CanvasTexture(canvas);
    }

    /**
     * Apply shake effect with amplitude tied to velocity.
     * Shake dampens as velocity decreases.
     * Used for water exit and rock collision bounce.
     */
    applyVelocityShake(dt, velocity) {
        if (!velocity || velocity < 0.01) {
            // Stopped - cleanup shake
            if (this.shakeBaseHeading) {
                this.headingQuaternion.copy(this.shakeBaseHeading);
                this.shakeBaseHeading = null;
            }
            this.shakeSeed = undefined;
            this.shakeTime = 0;
            return;
        }

        // Initialize shake state
        // visual-only randomness, nondeterministic allowed
        if (this.shakeSeed === undefined) {
            this.shakeSeed = Math.random();
            this.shakeTime = 0;
        }
        if (!this.shakeBaseHeading) {
            this.shakeBaseHeading = this.headingQuaternion.clone();
        }

        this.shakeTime += dt;

        // WATER UNIT SHAKE: max 40 degrees at full speed (dramatic shuddering)
        const maxAmplitude = (40 * Math.PI) / 180;
        const amplitude = maxAmplitude * velocity;

        // Higher frequency: 10-14 Hz (rapid shudder)
        const baseFreq = 12;
        const freqVariation = 1.0 + (this.shakeSeed - 0.5) * 0.4;
        const frequency = baseFreq * freqVariation;

        const shakeAngle = amplitude * Math.sin(this.shakeTime * frequency * 2 * Math.PI);
        const terrainNormal = this.position.clone().normalize();
        const shakeQuat = new THREE.Quaternion().setFromAxisAngle(terrainNormal, shakeAngle);

        this.headingQuaternion.copy(this.shakeBaseHeading).premultiply(shakeQuat);
    }

    // === ROCK COLLISION DETECTION ===
    checkRockCollision(position) {
        // Debug: Check if rockSystem is accessible
        if (!this.planet) {
            console.warn('[Collision] No planet reference');
            return { hit: false };
        }
        if (!this.planet.rockSystem) {
            console.warn('[Collision] No rockSystem on planet');
            return { hit: false };
        }
        if (!this.planet.rockSystem.rocks || this.planet.rockSystem.rocks.length === 0) {
            console.warn('[Collision] No rocks array or empty');
            return { hit: false };
        }

        const unitRadius = 0.8; // Unit bounding sphere radius
        const rocks = this.planet.rockSystem.rocks;

        for (const rock of rocks) {
            if (!rock.position) continue;

            const dist = position.distanceTo(rock.position);
            // Extended rock radius: base size + vertical buffer to catch units trying to go under
            // This prevents units from sliding under rocks when terrain dips below rock base
            const rockRadius = rock.scale ? rock.scale.x * 1.5 + 1.5 : 3.0;

            if (dist < unitRadius + rockRadius) {
                // Collision detected - calculate normal (away from rock center)
                const normal = position.clone().sub(rock.position).normalize();
                return { hit: true, normal: normal, rock: rock };
            }
        }

        return { hit: false };
    }

    snapToSurface() {
        // Use TERRAIN radius directly, ignoring water
        const dir = this.position.clone().normalize();
        const radius = this.planet.terrain.getRadiusAt(dir);
        this.position.copy(dir.multiplyScalar(radius + this.groundOffset));
    }

    getSmoothedNormal() {
        // Center normal
        const n0 = this.planet.terrain.getNormalAt(this.position);

        // Sample radius (footprint size)
        const radius = this.smoothingRadius;

        // headingQuaternion may not be initialized yet (before first WASD input)
        if (!this.headingQuaternion) {
            return n0;
        }

        const basis = SphericalMath.getBasis(this.headingQuaternion);

        // Sample 4 points around
        // Need to project radius onto sphere surface approximately
        const pFront = this.position.clone().add(basis.forward.clone().multiplyScalar(radius));
        const pBack = this.position.clone().add(basis.forward.clone().multiplyScalar(-radius));
        const pRight = this.position.clone().add(basis.right.clone().multiplyScalar(radius));
        const pLeft = this.position.clone().add(basis.right.clone().multiplyScalar(-radius));

        const nFront = this.planet.terrain.getNormalAt(pFront);
        const nBack = this.planet.terrain.getNormalAt(pBack);
        const nRight = this.planet.terrain.getNormalAt(pRight);
        const nLeft = this.planet.terrain.getNormalAt(pLeft);

        // Average them (simple unweighted average for now, improves stability significantly)
        const avgNormal = new THREE.Vector3()
            .add(n0).add(n0) // Weight center more (2x)
            .add(nFront).add(nBack)
            .add(nRight).add(nLeft)
            .normalize();

        return avgNormal;
    }

    // === TIRE TRACKS SYSTEM ===
    initTireTracks(scene) {
        this.scene = scene;
        this.tireTrackSegments = []; // Array of {mesh, opacity, age, createdAt}
        this.lastTrackPosition = null;
        this.trackSpacing = 0.075; // 4x denser (was 0.3)
        this.trackWidth = 0.15;

        // INSTANCED TRACK SYSTEM (Ring Buffer)
        this.maxTrackSegments = 40000; // Increased to 40k for ~750m history
        this.trackCursor = 0; // Current index in ring buffer
        this.trackInstancedMesh = null;
        this.trackBirthTimes = new Float32Array(this.maxTrackSegments);
        this.trackLifetime = 600.0; // Seconds before fade

        this.trackFadeStep = 0.02;
        this.trackFadeInterval = 1.0;
        this.trackFadeTimer = 0;

        // Performance monitoring
        this.frameTimeHistory = [];
        this.frameTimeHistoryMax = 30;
        this.performanceCheckInterval = 2.0;
        this.performanceCheckTimer = 0;
        this.lastFrameTime = performance.now();

        // Shared geometry for all tracks (optimization) - CROSSWISE
        this.sharedTrackGeo = new THREE.PlaneGeometry(0.15, 0.10);
        this.trackInitialOpacity = 0.6;
    }

    createSoftTrackTexture() {
        if (this._softTrackTex) return this._softTrackTex;

        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');

        // Background: White (Invisible in Multiply)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 64, 64);

        // Gradient: Lighter Grey-Brown (More transparent/subtle in Multiply)
        // Was: '#4a3c30' -> '#5c4b3d'
        const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 28);
        grad.addColorStop(0.0, '#7d6c5b'); // Core: Lighter Grey-Brown
        grad.addColorStop(0.6, '#a89f91'); // Mid: Fades to light grey
        grad.addColorStop(1.0, '#ffffff'); // Edge: White (Invisible)

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(32, 32, 28, 0, Math.PI * 2);
        ctx.fill();

        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        this._softTrackTex = tex;
        return tex;
    }

    // === REBUILT WATER LOGIC ===
    updateWaterBehavior(dt, moveInput) {
        // 1. Check current depth and state
        const waterLevel = this.planet.terrain.params.waterLevel || 0;
        const currentRadius = this.planet.terrain.getRadiusAt(this.position.clone().normalize());
        const baseRadius = this.planet.terrain.params.radius;
        const waterDepth = Math.max(0, (baseRadius + waterLevel) - currentRadius);
        const isUnderwater = waterDepth > 0.05; // Tolerance
        this.isUnderwater = isUnderwater; // Store for other systems (Dust)

        // Debug helper
        // if (this.game.debug && isUnderwater) console.log(`Water State: ${this.waterState}, Depth: ${waterDepth.toFixed(2)}`);

        // INITIAL STATE: Normal
        if (this.waterState === 'normal') {
            this.waterSlowdownFactor = 1.0;
            this.isWaterPushing = false; // Not pushing

            if (isUnderwater) {
                // Enter water -> Switch to Slowing
                this.waterState = 'slowing';
                this.waterEntryVector = this.headingQuaternion.clone(); // Remember entry direction? Or just velocity?
                if (window.game?._isDevMode) console.log("Water: Entering -> Slowing down...");
            }
            return moveInput; // Allow control
        }

        // STATE: Slowing (Decelerate to stop)
        if (this.waterState === 'slowing') {
            // Force deceleration override
            this.waterSlowdownFactor = Math.max(0.0, this.waterSlowdownFactor - dt * 2.5); // Rapid stop

            // Still allow input effect? No, damp it heavily or ignore.
            // User said: "elkezd lelassulni és amikor megáll... nem rögzítjük a user irányítását"

            // Effective Input is dampened
            let effectiveInput = moveInput * this.waterSlowdownFactor;

            if (this.waterSlowdownFactor <= 0.05) {
                // Stopped. Switch to simple shore exit.
                this.waterState = 'shore_exit';
                this.waterSlowdownFactor = 0;
                this.waterExitTime = 0;
                this.isWaterPushing = true; // LOCK INPUT
                
                // Find shore direction: move UPHILL (terrain gets higher = out of water)
                // Save current position as water entry position
                this.waterEntryPosition = this.position.clone();
                
                if (window.game?._isDevMode) console.log(`Water: Stopped. Will reverse to shore.`);
                return 0;
            }
            return effectiveInput;
        }
        
        // STATE: Shore Exit (Move uphill until out of water, then stop)
        if (this.waterState === 'shore_exit') {
            this.waterExitTime += dt;
            
            // Safety timeout
            const maxExitTime = 3.0;
            
            // Check if we're out of water
            const dir = this.position.clone().normalize();
            const currentTerrainRadius = this.planet.terrain.getRadiusAt(dir);
            const isStillUnderwater = currentTerrainRadius < (this.planet.terrain.params.radius + (this.planet.terrain.params.waterLevel || 0));
            
            if (!isStillUnderwater || this.waterExitTime > maxExitTime) {
                // Out of water - stop and restore control
                this.waterState = 'normal';
                this.waterSlowdownFactor = 1.0;
                this.isWaterPushing = false;
                if (window.game?._isDevMode) console.log(`Water: Reached shore. Control restored.`);
                return 0;
            }
            
            // Find uphill direction by sampling nearby terrain heights
            const up = this.position.clone().normalize();
            const randomPerp = new THREE.Vector3(1, 0, 0);
            if (Math.abs(up.dot(randomPerp)) > 0.9) randomPerp.set(0, 1, 0);
            const tangent1 = new THREE.Vector3().crossVectors(up, randomPerp).normalize();
            const tangent2 = new THREE.Vector3().crossVectors(up, tangent1).normalize();
            
            // Sample 8 directions, find highest
            let bestDir = null;
            let bestHeight = currentTerrainRadius;
            const sampleDist = 0.5;
            
            for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
                const sampleDir = new THREE.Vector3()
                    .addScaledVector(tangent1, Math.cos(angle))
                    .addScaledVector(tangent2, Math.sin(angle))
                    .normalize();
                    
                const samplePos = this.position.clone().addScaledVector(sampleDir, sampleDist);
                const sampleNorm = samplePos.normalize();
                const sampleHeight = this.planet.terrain.getRadiusAt(sampleNorm);
                
                if (sampleHeight > bestHeight) {
                    bestHeight = sampleHeight;
                    bestDir = sampleDir.clone();
                }
            }
            
            // Move toward highest terrain (uphill = out of water)
            if (bestDir) {
                const moveSpeed = 3.0 * dt;
                const newPos = this.position.clone().addScaledVector(bestDir, moveSpeed);
                
                // Project to terrain
                const newDir = newPos.normalize();
                const newTerrainRadius = this.planet.terrain.getRadiusAt(newDir);
                this.position.copy(newDir.multiplyScalar(newTerrainRadius + (this.groundOffset || 0.22)));
            }
            
            return 0; // No player input during exit
        }

        // STATE: Recovering (Ease-out on land before returning control)
        if (this.waterState === 'recovering') {
            // Ease out deceleration
            this.waterRecoverTime += dt;
            // Decelerate from pushSpeed (approx 0.5) to 0
            // Let's perform a scripted slowdown
            let recoverSpeed = Math.max(0, 0.5 - (this.waterRecoverTime * 1.0)); // Stop in 0.5s

            if (recoverSpeed <= 0.05) {
                // Done.
                this.waterState = 'normal';
                this.waterSlowdownFactor = 1.0;
                this.isWaterPushing = false; // RESTORE control
                
                // FIX: Restore path following if we had a path before water entry
                if (this.path && this.path.length > 0) {
                    this.isFollowingPath = true;
                    if (window.game?._isDevMode) console.log("Water: Recovered. Path following restored.");
                } else {
                    if (window.game?._isDevMode) console.log("Water: Recovered. No path to resume.");
                }
                return 0;
            }

            return -recoverSpeed; // Continue moving back slowly
        }

        return moveInput;
    }

    handleCollision(velocityReflected) {
        // ... (existing logic)
        // REDUCED SHAKE: was 0.5, now 0.2
        if (this.game.camera && this.game.camera.triggerShake) {
            const impactSpeed = velocityReflected.length();
            if (impactSpeed > 1.0) {
                this.game.camera.triggerShake(impactSpeed * 0.2); // Reduced from 0.5 to 0.2
            }
        }
    }

    /* 
    // OLD WATER BEHAVIOR (Replaced)
    // updateWaterBehavior(dt, moveInput) { ... }
    */

    updateTireTracks(dt) {
        if (!this.scene || !this.tireTrackSegments) return;
        // Phase 2A safety: headingQuaternion may not exist if Unit.update() was never called (mirror mode)
        if (!this.headingQuaternion) return;

        // CHECK TOGGLE
        if (Unit.enableTracks === false) return;

        // === PERFORMANCE MONITORING ===
        const now = performance.now();
        const frameTime = now - this.lastFrameTime;
        this.lastFrameTime = now;

        // Track frame times
        this.frameTimeHistory.push(frameTime);
        if (this.frameTimeHistory.length > this.frameTimeHistoryMax) {
            this.frameTimeHistory.shift();
        }

        // Periodic performance check
        this.performanceCheckTimer += dt;
        if (this.performanceCheckTimer >= this.performanceCheckInterval) {
            this.performanceCheckTimer = 0;

            // Calculate average frame time
            const avgFrameTime = this.frameTimeHistory.reduce((a, b) => a + b, 0) / this.frameTimeHistory.length;

            // Target: 16.67ms (60fps). If above 25ms (40fps), reduce lifetime. If below 20ms, increase.
            if (avgFrameTime > 25) {
                // Performance struggling - reduce lifetime (faster fade)
                this.trackCurrentLifetime = Math.max(this.trackMinLifetime, this.trackCurrentLifetime * 0.8);
                // console.log(`Track lifetime reduced to ${this.trackCurrentLifetime.toFixed(1)}s (avg frame: ${avgFrameTime.toFixed(1)}ms)`);
            } else if (avgFrameTime < 20 && this.trackCurrentLifetime < this.trackMaxLifetime) {
                // Performance good - increase lifetime
                this.trackCurrentLifetime = Math.min(this.trackMaxLifetime, this.trackCurrentLifetime * 1.1);
            }

            // Recalculate fade step based on current lifetime
            // USER REQUEST: 12 opacity levels for smoother fading
            // Starting opacity is 0.6 (for multiply blend), divide into 12 steps
            const numFadeLevels = 12;
            const stepsPerSecond = numFadeLevels / this.trackCurrentLifetime;
            this.trackFadeStep = 0.6 / numFadeLevels; // Each step reduces by 0.05
            this.trackFadeInterval = 1.0 / stepsPerSecond; // Time between steps
        }

        // Check if we've moved enough to add a new track segment
        const currentPos = this.position.clone();
        if (!this.lastTrackPosition) {
            this.lastTrackPosition = currentPos.clone();
            return;
        }

        const distMoved = currentPos.distanceTo(this.lastTrackPosition);

        // Detect rotation in place (for tank-style turning)
        let isRotatingInPlace = false;
        if (this.lastTrackHeading && distMoved < this.trackSpacing) {
            const angleDiff = this.headingQuaternion.angleTo(this.lastTrackHeading);
            // If rotated more than 30 degrees but didn't move much, generate tracks (sparser rotation tracks)
            isRotatingInPlace = angleDiff > (30 * Math.PI / 180);
        }


        if (distMoved >= this.trackSpacing || isRotatingInPlace) {
            // Lazy initialization of InstancedMesh
            if (!this.trackInstancedMesh) {
                // Use Soft Texture + Multiply Blending
                const softTex = this.createSoftTrackTexture();

                // Material Color MUST be White for Multiply Blending to work with texture colors
                const mat = new THREE.MeshBasicMaterial({
                    color: 0xffffff,
                    map: softTex,
                    transparent: true,
                    opacity: 1.0, // Control via color mix in shader
                    depthWrite: false,
                    side: THREE.DoubleSide,
                    blending: THREE.MultiplyBlending, // Darkens the ground
                    polygonOffset: true,
                    polygonOffsetFactor: -4,
                    polygonOffsetUnits: -4
                });

                // Shader injection for Fading (Fading to WHITE = Disappearing in Multiply)
                mat.onBeforeCompile = (shader) => {
                    shader.uniforms.uTime = { value: 0 };
                    // User Request: Opacity Slider Control
                    shader.uniforms.uTrackOpacity = { value: this.trackOpacity || 0.1 };

                    // Save reference to shader for updates
                    mat.userData.shader = shader;

                    shader.vertexShader = `
                        attribute float aBirthTime;
                        varying float vBirthTime;
                    ` + shader.vertexShader;
                    shader.vertexShader = shader.vertexShader.replace(
                        '#include <begin_vertex>',
                        `
                        #include <begin_vertex>
                        vBirthTime = aBirthTime;
                        `
                    );
                    shader.fragmentShader = `
                        uniform float uTime;
                        uniform float uTrackOpacity;
                        varying float vBirthTime;
                        const float LIFETIME = 600.0; 
                    ` + shader.fragmentShader;
                    shader.fragmentShader = shader.fragmentShader.replace(
                        '#include <map_fragment>',
                        `
                        #include <map_fragment>
                        
                        // Fade Logic for Multiply Blending
                        float age = uTime - vBirthTime;
                        
                        // Opacity Control: Use uTrackOpacity to mix between WHITE (invisible) and TEXTURE COLOR
                        // uTrackOpacity = 1.0 -> Full Texture
                        // uTrackOpacity = 0.0 -> Full White (Invisible)
                        // Make sure we clamp it
                        float opacity = clamp(uTrackOpacity, 0.0, 1.0);
                        
                        // Apply user opacity setting FIRST
                        vec3 targetColor = mix(vec3(1.0), diffuseColor.rgb, opacity);
                        
                        if (age > LIFETIME) {
                            diffuseColor.rgb = vec3(1.0); // Invisible
                        } else {
                            // Fade out over last 15 seconds
                            float fadeStart = LIFETIME - 15.0;
                            if (age > fadeStart) {
                                float fade = (age - fadeStart) / 15.0; // 0 to 1
                                // Fade from targetColor to White/Invisible
                                diffuseColor.rgb = mix(targetColor, vec3(1.0), fade);
                            } else {
                                // Just target color (with user opacity applied)
                                diffuseColor.rgb = targetColor;
                            }
                        }
                        // Note: With Multiply blending, overlapping tracks will darken more
                        // but won't go below the texture's base color (approx 40% = 0.4)
                        `
                    );
                    mat.userData.shader = shader;
                };

                this.trackInstancedMesh = new THREE.InstancedMesh(this.sharedTrackGeo, mat, this.maxTrackSegments);
                this.trackInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
                this.trackInstancedMesh.count = 0;
                this.trackInstancedMesh.frustumCulled = false;

                // Init attribute
                for (let i = 0; i < this.maxTrackSegments; i++) {
                    this.trackBirthTimes[i] = -99999;
                }
                const birthAttr = new THREE.InstancedBufferAttribute(this.trackBirthTimes, 1);
                birthAttr.setUsage(THREE.DynamicDrawUsage);
                this.trackInstancedMesh.geometry.setAttribute('aBirthTime', birthAttr);

                // Add to Track Group
                if (!this.trackGroup) {
                    this.trackGroup = new THREE.Group();
                    this.scene.add(this.trackGroup);
                    this.trackGroup.visible = (Unit.enableTracks !== false);
                }
                this.trackGroup.add(this.trackInstancedMesh);
            }

            // Create new track segment
            const basis = SphericalMath.getBasis(this.headingQuaternion);

            // === 4 WHEEL POSITIONS ===
            const wheelOffsetSide = 0.15;
            const wheelOffsetFront = 0.2;

            // Helper to get terrain pos
            const trackHeightOffset = 0.05; // Raised from 0.02 to prevent terrain clipping
            const getWheelPos = (sideMul, frontMul) => {
                const pos = this.position.clone()
                    .add(basis.right.clone().multiplyScalar(sideMul * wheelOffsetSide))
                    .add(basis.forward.clone().multiplyScalar(frontMul * wheelOffsetFront));
                const dir = pos.normalize();
                const radius = this.planet.terrain.getRadiusAt(dir);
                return dir.multiplyScalar(radius + trackHeightOffset);
            };

            const pFL = getWheelPos(-1, 1);
            const pFR = getWheelPos(1, 1);
            const pBL = getWheelPos(-1, -1);
            const pBR = getWheelPos(1, -1);

            // Dust Logic (User Request: Frequency Slider Controlled)
            this.dustSpawnTimer += dt;
            const interval = this.dustSpawnInterval || 0.03;

            if (this.dustSpawnTimer >= interval) {
                this.generateDustParticles(pFL, pFR);
                this.dustSpawnTimer = 0;
            }

            // Update InstancedMesh (4 instances)
            const dummy = new THREE.Object3D();
            const nowTime = performance.now() / 1000.0;

            // Helper to update instance
            const updateInstance = (pos) => {
                const cursor = this.trackCursor;

                // Orient dummy
                const normal = this.planet.terrain.getNormalAt(pos);
                dummy.position.copy(pos);

                // Align to terrain
                const projForward = basis.forward.clone().sub(normal.clone().multiplyScalar(basis.forward.dot(normal))).normalize();
                const lookTarget = pos.clone().add(normal);
                dummy.lookAt(lookTarget);
                const currentUp = new THREE.Vector3(0, 1, 0).applyQuaternion(dummy.quaternion);
                const angle = Math.atan2(
                    new THREE.Vector3().crossVectors(currentUp, projForward).dot(normal),
                    currentUp.dot(projForward)
                );
                dummy.rotateZ(angle);
                dummy.updateMatrix();

                this.trackInstancedMesh.setMatrixAt(cursor, dummy.matrix);
                // Update birth time attribute manually
                this.trackInstancedMesh.geometry.attributes.aBirthTime.setX(cursor, nowTime);

                this.trackCursor = (this.trackCursor + 1) % this.maxTrackSegments;
            };

            updateInstance(pFL);
            updateInstance(pFR);
            updateInstance(pBL);
            updateInstance(pBR);

            this.trackInstancedMesh.instanceMatrix.needsUpdate = true;
            this.trackInstancedMesh.geometry.attributes.aBirthTime.needsUpdate = true;
            this.trackInstancedMesh.count = Math.min(this.maxTrackSegments, this.trackInstancedMesh.count + 4);

            this.lastTrackPosition = this.position.clone();
            this.lastTrackHeading = this.headingQuaternion.clone();
        }

        // Update Time Uniform for Shader
        if (this.trackInstancedMesh && this.trackInstancedMesh.material.userData.shader) {
            this.trackInstancedMesh.material.userData.shader.uniforms.uTime.value = performance.now() / 1000.0;
        }

        this.updateDustParticles(dt);
    }

    generateDustParticles(posLeft, posRight) {
        if (!this.dustTexture) {
            // Load texture once
            if (!Unit.dustTextureLoaded) {
                Unit.dustTextureLoaded = true;
                new THREE.TextureLoader().load('assets/textures/dust.png', (tex) => {
                    Unit.sharedDustTexture = tex;
                    this.dustTexture = tex;
                });
            } else if (Unit.sharedDustTexture) {
                this.dustTexture = Unit.sharedDustTexture;
            }
        }

        if (!this.dustTexture) return;

        // Initialize dust group if not exists
        if (!this.dustGroup) {
            this.dustGroup = new THREE.Group();
            this.scene.add(this.dustGroup);
            // Sync visibility with static flag immediately
            this.dustGroup.visible = (Unit.enableDust !== false);
        }

        // CHECK TOGGLE (Optimization: Don't spawn if invisible)
        if (Unit.enableDust === false) return;

        // Cap total particles per unit to prevent accumulation
        const MAX_DUST_PER_UNIT = 40;
        if (this.dustParticles && this.dustParticles.length >= MAX_DUST_PER_UNIT) return;

        // CHECK UNDERWATER (User Request: No dust in water)
        if (this.isUnderwater) return;

        // CHECK DISTANCE
        let distToCam = 0;
        if (this.game && this.game.camera) {
            distToCam = this.mesh.position.distanceTo(this.game.camera.position);
        }
        if (distToCam > 80) return;

        // Create particles at both wheel positions
        // visual-only randomness, nondeterministic allowed (entire spawnParticle function)
        const spawnParticle = (pos) => {
            const offset = new THREE.Vector3(
                (Math.random() - 0.5) * 0.3,
                (Math.random() - 0.5) * 0.3,
                (Math.random() - 0.5) * 0.3
            );
            const particlePos = pos.clone().add(offset);

            // User Request: 4 sec, 20x growth, more visible
            // Bigger initial size for visibility
            const size = (0.1 + Math.random() * 0.1); // Much bigger starting size

            const geo = new THREE.SphereGeometry(size, 8, 8);

            const mat = new THREE.MeshBasicMaterial({
                map: this.dustTexture,
                color: 0xddccbb,
                transparent: true,
                // User Request: Dust transparency controlled by dustOpacity property
                opacity: this.dustOpacity || 0.5,
                depthWrite: false,
                side: THREE.FrontSide,
            });

            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.copy(particlePos);
            mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);

            this.dustGroup.add(mesh); // Add to GROUP instead of SCENE
            mesh.renderOrder = 100; // Render ABOVE tire tracks (which are on ground)

            // Random Variance for Speed
            // User Request: "Legyen a gömbök fele olyan, ami mindezt fele ilyen gyorsan csinálja"
            const isSlowOne = Math.random() > 0.5;

            // User Request: "fele ilyen gyorsan növekedjen" -> "fele ilyen gyorsan" means SLOWER speed => LONGER lifetime?
            // "Half as fast" usually means "Twice the duration".
            // Previous Lifetime: 0.4 + rand*0.4 (Avg 0.6s)
            // New "Normal" Lifetime (Half Speed -> 2x duration): ~1.2s
            // "Slow One" Lifetime (Half of THAT speed -> 4x duration? Or just relative to original?)
            // Interpretation: 
            // - Normal: Slower than before.
            // - Special Half: Even slower.
            // User Request: 4 second lifetime
            let lifeTime = 2.0; // Reduced from 4.0 to prevent particle buildup
            if (isSlowOne) {
                lifeTime *= 1.3; // Slightly longer for variation
            }

            if (!this.dustParticles) this.dustParticles = [];
            this.dustParticles.push({
                mesh: mesh,
                age: 0,
                lifetime: lifeTime,
                // User Request: 20x growth (size * 20)
                maxSize: size * 20.0,
                startOpacity: this.dustOpacity || 0.5, // Use configurable opacity
            });
        };

        if (Math.random() > 0.7) spawnParticle(posLeft);
        if (Math.random() > 0.7) spawnParticle(posRight);
    }

    updateDustParticles(dt) {
        if (!this.dustParticles) return;

        // Clean up all particles if dust is disabled
        if (Unit.enableDust === false && this.dustParticles.length > 0) {
            for (const p of this.dustParticles) {
                if (p.mesh) {
                    if (this.dustGroup) this.dustGroup.remove(p.mesh);
                    if (p.mesh.geometry) p.mesh.geometry.dispose();
                    if (p.mesh.material) p.mesh.material.dispose();
                    p.mesh = null;
                }
            }
            this.dustParticles = [];
            return;
        }

        for (let i = this.dustParticles.length - 1; i >= 0; i--) {
            const p = this.dustParticles[i];
            p.age += dt;

            if (p.age >= p.lifetime) {
                if (p.mesh) {
                    this.dustGroup.remove(p.mesh);
                    if (p.mesh.geometry) p.mesh.geometry.dispose();
                    if (p.mesh.material) p.mesh.material.dispose();
                    p.mesh = null;
                }
                this.dustParticles.splice(i, 1);
                continue;
            }

            if (!p.mesh || !p.mesh.geometry) {
                this.dustParticles.splice(i, 1);
                continue;
            }

            const t = p.age / p.lifetime;

            // Grow
            const scale = 1.0 + (p.maxSize / p.mesh.geometry.parameters.radius - 1.0) * t;
            p.mesh.scale.setScalar(scale);

            // Fade (Standard Material)
            p.mesh.material.opacity = p.startOpacity * (1.0 - t);

            // Move (Rise and drift) - VERY SLOW rise, stays near ground\n            const up = p.mesh.position.clone().normalize();\n            p.mesh.position.addScaledVector(up, dt * 0.03); // Barely rises - stays at ground level
            p.mesh.rotation.x += dt;
            p.mesh.rotation.y += dt * 0.5;
        }
    }
    // === SELECTION & HIGHLIGHT VISUALS ===

    setHighlight(active) {
        this.isHovered = active;
    }

    setHover(active) {
        // "Hover" here means "Pause Movement due to cursor proximity"
        this.hoverState = active;

        // If hovered, dampen speed to target 0
        // (Handled in update loop via hoverState)
    }

    updateSelectionVisuals(dt) {
        // Initialize if first run or missing (safety)
        if (this.selectionIntensity === undefined) this.selectionIntensity = 0;
        if (this.timeAccumulator === undefined) this.timeAccumulator = 0;

        // Determine Target Intensity
        // Selected = 1.0, Hovered = 0.5 (or pulsing), None = 0.0
        let targetIntensity = 0.0;

        if (this.isSelected) {
            targetIntensity = 1.0;
        } else if (this.isHovered) {
            targetIntensity = 0.6;
        }

        // Smooth transition
        this.selectionIntensity += (targetIntensity - this.selectionIntensity) * dt * 5.0;

        // Visual Parameters
        if (this.glowRing && this.glowMaterial) {
            if (this.selectionIntensity < 0.01) {
                this.glowRing.visible = false;
            } else {
                this.glowRing.visible = true;

                this.timeAccumulator += dt;

                // Color Logic
                if (this.isSelected) {
                    // Selected: Solid Blue, slight pulse
                    // Color handled by shader gradient
                    const pulse = 0.8 + 0.2 * Math.sin(this.timeAccumulator * 3.0);
                    if (this.glowMaterial.uniforms) {
                        this.glowMaterial.uniforms.uOpacity.value = this.selectionIntensity * 0.4 * pulse;
                        this.glowMaterial.uniforms.uTime.value = performance.now() * 0.001;
                    } else {
                        this.glowMaterial.opacity = this.selectionIntensity * 0.4 * pulse;
                    }
                } else if (this.isHovered) {
                    // Hovered: Lighter/Cyan, faster pulse
                    // Color handled by shader gradient
                    const pulse = 0.6 + 0.4 * Math.sin(this.timeAccumulator * 8.0); // Fast pulse
                    if (this.glowMaterial.uniforms) {
                        this.glowMaterial.uniforms.uOpacity.value = this.selectionIntensity * 0.3 * pulse;
                        this.glowMaterial.uniforms.uTime.value = performance.now() * 0.001;
                    } else {
                        this.glowMaterial.opacity = this.selectionIntensity * 0.3 * pulse;
                    } // Lower opacity
                }

                // Rotation (Slow spin)
                this.glowRing.rotation.z += dt * 0.2;
            }
        }

        // Bug #5 fix: Sync overhead green indicator with selection state
        if (this._myUnitIndicatorSprite) {
            this._myUnitIndicatorSprite.visible = this.isSelected;
        }
    }

    // === DYNAMIC REPLANNING SYSTEMS ===
    
    /**
     * Check if upcoming path points are blocked by obstacles.
     */
    scanForObstacles(pathPlanner) {
        if (!this.path || this.pathIndex >= this.path.length - 1) return;

        // Look ahead ~5 meters (10 points at 0.5m spacing)
        const lookAhead = 10;
        let blocked = false;
        
        for (let i = 1; i <= lookAhead; i++) {
             const idx = this.pathIndex + i;
             if (idx >= this.path.length) break;
             const pt = this.path[idx];
             
             // Check if point is now FORBIDDEN
             if (pathPlanner.getZoneType(pt, { canSwim: this.canSwim, canClimb: false }) === 'FORBIDDEN') {
                 blocked = true;
                 break;
             }
        }
        
        if (blocked) {
            // console.log("Obstacle detected ahead! Replanning...");
            this.replanPath(pathPlanner);
        }
    }

    /**
     * Generate a smooth Bezier transition arc from current position to a path rejoin point.
     * Used when auto-rejoining path after keyboard override.
     *
     * Creates a cubic Bezier curve that:
     * - Starts at the unit's current position with tangent matching current heading
     * - Ends at the path rejoin point with tangent matching the path direction there
     * - Projects all points onto the terrain surface
     *
     * @param {number} targetIdx - Index in this.path to rejoin at
     */
    _generateRejoinArc(targetIdx) {
        if (!this.path || targetIdx >= this.path.length || targetIdx < 0) return;

        const startPos = this.position.clone();
        const endPos = this.path[targetIdx].clone();
        const distance = startPos.distanceTo(endPos);

        // If already very close, no arc needed - just resume directly
        if (distance < 0.5) return;

        // Start tangent: current heading direction (where the unit is facing)
        const startTangent = new THREE.Vector3();
        if (this.velocityDirection && this.velocityDirection.lengthSq() > 0.001) {
            startTangent.copy(this.velocityDirection).normalize();
        } else if (this.headingQuaternion) {
            startTangent.set(0, 0, 1).applyQuaternion(this.headingQuaternion).normalize();
        } else {
            // Fallback: direction toward rejoin point
            startTangent.copy(endPos).sub(startPos).normalize();
        }

        // End tangent: path direction at the rejoin point (look a few points ahead)
        const endTangent = new THREE.Vector3();
        const pathLen = this.path.length;
        let lookIdx = targetIdx + 6; // ~3 meters ahead on path
        if (this.isPathClosed || this.loopingEnabled) {
            lookIdx = lookIdx % pathLen;
        } else {
            lookIdx = Math.min(lookIdx, pathLen - 1);
        }

        if (lookIdx !== targetIdx) {
            endTangent.copy(this.path[lookIdx]).sub(this.path[targetIdx]).normalize();
        } else {
            // At end of path, use direction from previous point
            const prevIdx = Math.max(0, targetIdx - 3);
            endTangent.copy(this.path[targetIdx]).sub(this.path[prevIdx]).normalize();
        }

        // Cubic Bezier control points
        // Scale tangent influence by distance for natural-looking curves
        const tangentScale = distance * 0.35;
        const cp1 = startPos.clone().addScaledVector(startTangent, tangentScale);
        const cp2 = endPos.clone().addScaledVector(endTangent, -tangentScale);

        // Sample the Bezier curve into discrete points
        // More samples for longer distances (minimum 8, ~2 points per meter)
        const numSamples = Math.max(8, Math.ceil(distance * 2));
        const transPath = [];

        for (let i = 1; i <= numSamples; i++) {
            const t = i / numSamples;
            const it = 1 - t;

            // Cubic Bezier: B(t) = (1-t)^3*P0 + 3(1-t)^2*t*P1 + 3(1-t)*t^2*P2 + t^3*P3
            const point = new THREE.Vector3();
            point.addScaledVector(startPos, it * it * it);
            point.addScaledVector(cp1, 3 * it * it * t);
            point.addScaledVector(cp2, 3 * it * t * t);
            point.addScaledVector(endPos, t * t * t);

            // Project point onto terrain surface
            if (this.planet && this.planet.terrain) {
                const dir = point.clone().normalize();
                const terrainRadius = this.planet.terrain.getRadiusAt(dir);
                const groundOffset = this.groundOffset || 0.22;
                point.copy(dir.multiplyScalar(terrainRadius + groundOffset));
            }

            transPath.push(point);
        }

        // Activate transition arc system
        this.transitionPath = transPath;
        this.transitionIndex = 0;
        this.isInTransition = true;
        this.transitionVelocityDir = startTangent.clone();

        if (window.game?._isDevMode) {
            console.log(`[Unit ${this.id}] Rejoin arc: ${transPath.length} points, ${distance.toFixed(1)}m`);
        }
    }

    /**
     * Calculate a detour around the obstacle to a point further ahead.
     */
    replanPath(pathPlanner) {
        // Target a point FURTHER ahead (e.g. 15m) to bypass obstacle completely
        const lookAhead = 30; // ~15m
        const targetIdx = Math.min(this.pathIndex + lookAhead, this.path.length - 1);
        const targetPos = this.path[targetIdx];
        
        const newPath = pathPlanner.planPath(this.position, targetPos);
        if (newPath && newPath.length > 0) {
            // Enter transition mode (detour)
            this.transitionPath = newPath;
            this.transitionIndex = 0;
            this.isInTransition = true;
            this.transitionVelocityDir = this.velocityDirection.clone();
            
            // console.log("Detour found:", newPath.length, "points");
        }
    }

    /**
     * Check for collision with other units and apply mutual bounce.
     * Both units get pushed apart when they're within collision radius.
     * @param {Unit[]} allUnits - Array of all units in the game
     */
    checkUnitCollisions(allUnits) {
        if (this.isBouncing || this.bounceCooldown > 0) return; // Already bouncing
        
        const COLLISION_RADIUS = 1.5; // Distance threshold for collision
        const BOUNCE_STRENGTH = 3.0;  // Initial bounce velocity
        
        for (const other of allUnits) {
            if (!other || other === this) continue;
            if (other.isBouncing || other.bounceCooldown > 0) continue;
            
            const dist = this.position.distanceTo(other.position);
            if (dist < COLLISION_RADIUS && dist > 0.01) {
                // Calculate bounce directions (apart from each other)
                // On a sphere, use the tangent plane direction
                const sphereNormal = this.position.clone().normalize();
                
                // Direction from other to this (push this unit away)
                const pushDir = this.position.clone().sub(other.position);
                // Project onto tangent plane
                const dot = pushDir.dot(sphereNormal);
                pushDir.sub(sphereNormal.clone().multiplyScalar(dot)).normalize();
                
                // Apply bounce to THIS unit
                this.bounceDirection = pushDir;
                this.bounceVelocity = BOUNCE_STRENGTH;
                this.bounceCooldown = 0.5;
                this.bounceLockTimer = 0;
                
                // Apply bounce to OTHER unit (opposite direction)
                const otherPushDir = pushDir.clone().negate();
                other.bounceDirection = otherPushDir;
                other.bounceVelocity = BOUNCE_STRENGTH;
                other.bounceCooldown = 0.5;
                other.bounceLockTimer = 0;
                
                if (window.game?._isDevMode) {
                    console.log(`[Unit] Collision: Unit ${this.id} <-> Unit ${other.id} at dist ${dist.toFixed(2)}m`);
                }
                
                break; // Only handle one collision per frame
            }
        }
    }
}
