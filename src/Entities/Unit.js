import * as THREE from 'three';
import { SphericalMath } from '../Math/SphericalMath.js';

export class Unit {
    constructor(planet) {
        this.planet = planet;
        this.speed = 5.0;
        this.currentSpeed = 0.0; // Actual speed for audio/visuals
        this.turnSpeed = 2.0;
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
        
        // State
        // Start at North Pole for simplicity, or any point
        this.position = new THREE.Vector3(0, 10, 0); 
        
        // Initial Orientation: Up aligned with Y (Normal at pole), Forward aligned with Z
        this.quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0);
        
        // Align to initial surface
        this.snapToSurface();
        this.alignToSurfaceInitial();
        
        // === PER-UNIT COMMAND QUEUE (Independent waypoints) ===
        this.waypointControlPoints = [];
        this.waypointMarkers = [];
        this.waypointCurveLine = null;
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
        
        // Unit identity
        this.id = Math.floor(Math.random() * 10000);
        this.name = `Unit ${this.id}`;
    }

    createMesh() {
        const group = new THREE.Group();

        // 1. Main Body (Cone)
        const coneGeo = new THREE.ConeGeometry(0.3, 1, 8);
        const geo = coneGeo.clone(); // Clone to manipulating
        geo.rotateX(Math.PI / 2); // Point Z+
        geo.translate(0, 0.3, 0);

        this.bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 });
        const body = new THREE.Mesh(geo, this.bodyMaterial);
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);
        
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
        this.spotLight.castShadow = true; // Enable shadow for terrain lighting effect
        this.spotLight.shadow.mapSize.width = 512;
        this.spotLight.shadow.mapSize.height = 512;
        this.spotLight.shadow.camera.near = 0.5;
        this.spotLight.shadow.camera.far = 25;
        // Target needs to be added to scene or hierarchy to work correctly
        this.spotLight.target.position.set(0, 0, 0);
        
        group.add(this.spotLight);
        group.add(this.spotLight.target);
        
        // 4. SELECTION RING (Ground Projected)
        // Simple Ring Geometry as fallback/requested style
        const glowRingGeo = new THREE.RingGeometry(1.6, 2.0, 32); // Slightly wider ring
        glowRingGeo.rotateX(-Math.PI / 2);
        this.glowMaterial = new THREE.MeshBasicMaterial({ 
            color: 0x00d4ff, // Preloader Blue
            transparent: true, 
            opacity: 0.0,
            side: THREE.DoubleSide,
            depthWrite: false // Avoid z-fighting
        });
        this.glowRing = new THREE.Mesh(glowRingGeo, this.glowMaterial);
        this.glowRing.position.y = 0.15; // Clearly above ground
        group.add(this.glowRing);
        
        // 5. HEADLIGHTS (Front spotlights that cast shadows)
        // Start OFF - only enabled when player controls this unit
        this.headlightLeft = new THREE.SpotLight(0xffffee, 0); // Start OFF
        this.headlightLeft.angle = Math.PI / 8; // Narrow beam
        this.headlightLeft.penumbra = 0.5;
        this.headlightLeft.distance = 15; // Effective range
        this.headlightLeft.decay = 2.0;
        this.headlightLeft.castShadow = true;
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
        this.headlightRight.castShadow = true;
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
        
        // === DUST PARTICLE SYSTEM ===
        this.dustParticles = [];
        this.dustMaxParticles = 100; // Refined count
        this.dustSpawnRate = 0.03; 
        this.dustSpawnTimer = 0;
        
        // Use PlaneGeometry for textured dust puffs
        const dustGeo = new THREE.PlaneGeometry(1.0, 1.0);
        
        // Create soft dust texture
        const dustTexture = this.createDustTexture();
        this.dustMaterial = new THREE.MeshBasicMaterial({
            map: dustTexture,
            transparent: true,
            opacity: 0.0,
            depthWrite: false, // Don't write depth to allow seamless blending overlay
            depthTest: true,
            side: THREE.DoubleSide
        });
        
        for (let i = 0; i < this.dustMaxParticles; i++) {
            const p = new THREE.Mesh(dustGeo, this.dustMaterial.clone());
            p.visible = false;
            p.userData.life = 0;
            p.userData.maxLife = 3600; // 1 hour life
            p.userData.heading = new THREE.Vector3(); // Store movement dir
            p.castShadow = false;
            p.receiveShadow = true;
            this.dustParticles.push(p);
        }
        
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
                // No hover, no selection = no glow
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
        // If unpaused, ensure we are in path following mode if path exists
        if (!paused && this.path) {
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
        // Selection visuals handled in update() for smooth transition
    }

    updateSelectionVisuals(dt) {
        const targetIntensity = this.isSelected ? 1.0 : 0.0;
        
        // Smooth transition (Ease-out)
        const lerpSpeed = this.isSelected ? 5.0 : 3.0;
        this.selectionIntensity = THREE.MathUtils.lerp(this.selectionIntensity, targetIntensity, dt * lerpSpeed);
        
        // === KEYBOARD ACTIVE GLOW (orange, more intense) ===
        const isActive = this.isKeyboardOverriding;
        
        if (this.selectionIntensity < 0.01 && !isActive) {
            this.spotLight.intensity = 0;
            this.glowMaterial.opacity = 0;
            this.bodyMaterial.emissiveIntensity = 0;
            this.glowRing.visible = false;
            // Hide terrain ring
            if (this.terrainRing) this.terrainRing.visible = false;
            return;
        }
        
        this.glowRing.visible = true;
        this.timeAccumulator += dt;
        
        // Pulse Logic (Sine wave) - FASTER when keyboard active
        const pulseFreq = isActive ? 6.0 : 4.0; // Faster pulse when active
        const pulse = (Math.sin(this.timeAccumulator * pulseFreq) * 0.5 + 0.5); // 0 to 1
        
        // Determine which intensity to use (active overrides selection)
        const visualIntensity = isActive ? 1.0 : this.selectionIntensity;
        
        // 1. Spotlight Intensity - Projects visible ring on terrain
        const spotMax = isActive ? 80.0 : 60.0; // Brighter when active
        this.spotLight.intensity = visualIntensity * (spotMax * 0.7 + spotMax * 0.3 * pulse);
        
        // 2. Glow Ring - ORANGE when active, BLUE when just selected
        const ringOpacity = isActive ? (0.7 + 0.3 * pulse) : (0.5 + 0.3 * pulse);
        this.glowMaterial.opacity = visualIntensity * ringOpacity;
        this.glowMaterial.color.set(isActive ? 0xff8800 : 0x00d4ff); // Orange vs Blue
        
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
        console.log(`[Unit ${this.id}] Headlights: ${enabled ? 'ON' : 'OFF'} (intensity: ${intensity})`);
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
        
        console.log(`Path Set. Closest Node: ${closestIndex}, Next Target: ${this.pathIndex}`);
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

    update(input, dt) {
        const startPos = this.position.clone();

        // === ROCK SPAWN-OUT CHECK ===
        // If unit somehow ends up inside a rock, push it out immediately
        // Rock collision is handled by RockCollisionSystem.checkAndSlide() 
        // which uses raycast against actual mesh and bounces on arrival direction.
        // No sphere-based overlap push needed (it was causing sideways push).
        
        // Selection Visuals (also run for keyboard-controlled units for active glow)
        if (this.isSelected || this.selectionIntensity > 0.01 || this.isKeyboardOverriding) {
            this.updateSelectionVisuals(dt);
        }

        const turnSpeed = this.turnSpeed * dt;
        
        // Hover Speed Logic (Easy In / Easy Out)
        // If hovered, target factor is 0.0. If not, 1.0.
        const targetFactor = this.hoverState ? 0.0 : 1.0;
        // Smoothly interpolate factor - FAST stop (8.0), slower resume (4.0)
        const lerpSpeed = this.hoverState ? 8.0 : 4.0;
        this.speedFactor = THREE.MathUtils.lerp(this.speedFactor, targetFactor, dt * lerpSpeed);
        
        // Effective Speed
        let moveSpeed = (this.speed || 10) * dt * this.speedFactor * this.waterSlowdownFactor;
        
        // If "effectively stopped", clamp to 0 to avoid micro-movements
        if (this.speedFactor < 0.05 && this.hoverState) {
             moveSpeed = 0;
             this.speedFactor = 0; // Snap to fully stopped
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
            
            // Stop completely when very slow
            if (this.bounceVelocity < 0.05) {
                this.bounceVelocity = 0;
                this.bounceDirection = null;
                this.bounceLockTimer = 0;
                // Stop camera shake
                this.cameraShakeIntensity = 0;
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
                        console.log(`[Unit ${this.id}] STUCK detected after ${this.stuckTimer.toFixed(1)}s`);
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


        // ========================================================
        // PATH FOLLOWING LOGIC - SIMPLIFIED & TERRAIN-SAFE
        // ========================================================
        // Rules:
        // 1. NEVER teleport - only incremental movement
        // 2. NEVER reverse - always forward toward goal
        // 3. ALWAYS project to terrain after any movement
        // 4. Follow path[] array sequentially via pathIndex
        // ========================================================
        
        if (this.path && this.path.length > 0 && this.isFollowingPath && !this.pausedByCommand && !this.isBouncing) {
            // One-time log
            if (!this._pathFollowingLogged) {
                this._pathFollowingLogged = true;
                console.log(`[Unit] Path following ACTIVE! Path length: ${this.path.length}`);
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
                    console.log("Path completed.");
                }
            }
            
            // Get current target point on path
            const currentTarget = this.path[this.pathIndex];
            if (!currentTarget) {
                // Invalid target, stop
                this.isFollowingPath = false;
            } else {
                // Calculate remaining distance we can travel this frame
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
                    const targetDir = target.clone().normalize();
                    const targetTerrainRadius = this.planet.terrain.getRadiusAt(targetDir);
                    const targetIsUnderwater = targetTerrainRadius < pathWaterRadius;
                    
                    if (targetIsUnderwater && !canEnterWater) {
                        console.log("Path leads to water! Starting water pushback.");
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
                    } else {
                        // Move towards target incrementally
                        const dir = target.clone().sub(this.position).normalize();
                        
                        // Calculate desired position
                        const desiredPos = this.position.clone().addScaledVector(dir, remainingMove);
                        
                        // === ROCK COLLISION CHECK ===
                        if (this.planet && this.planet.rockCollision) {
                            const result = this.planet.rockCollision.checkAndSlide(this.position, desiredPos);
                            
                            if (result.collided && this.bounceCooldown <= 0) {
                                if (result.bounceDir) {
                                    this.bounceDirection = result.bounceDir;
                                    this.bounceVelocity = (remainingMove / (1/60)) * 0.2;
                                    this.bounceCooldown = 0.5;
                                }
                            } else if (!result.collided) {
                                this.position.copy(result.position);
                            }
                        } else {
                            this.position.copy(desiredPos);
                        }
                        
                        // Store velocity direction
                        this.velocityDirection = dir.clone();
                        remainingMove = 0;
                    }
                    
                    // === CRITICAL: PROJECT TO TERRAIN AFTER EVERY MOVEMENT ===
                    // This ensures we NEVER go through the ground
                    const posDir = this.position.clone().normalize();
                    const terrainRadius = this.planet.terrain.getRadiusAt(posDir);
                    const groundOffset = this.groundOffset || 0.5;
                    this.position.copy(posDir.multiplyScalar(terrainRadius + groundOffset));
                }
            }
            
            // ORIENTATION: Look toward path direction
            // Look ahead to next point(s) for smooth tangent
            let lookAhead = this.pathIndex + 3;
            if (lookAhead >= this.path.length && (this.loopingEnabled || this.isPathClosed)) {
                lookAhead = lookAhead % this.path.length;
            } else {
                lookAhead = Math.min(lookAhead, this.path.length - 1);
            }
            
            let tangent = new THREE.Vector3();
            
            if (this.path[lookAhead]) {
                // Tangent is direction from current position to look-ahead point
                tangent = this.path[lookAhead].clone().sub(this.position).normalize();
            } else if (this.pathIndex < this.path.length && this.path[this.pathIndex]) {
                // Use current target direction
                tangent = this.path[this.pathIndex].clone().sub(this.position).normalize();
            }
            
            // Project tangent onto SMOOTHED terrain plane (for tilt + smoothness)
            // Visual tilt is handled here directly
            const sphereNormal = this.getSmoothedNormal(); // Use smoothed normal instead of rigid sphere normal
            const projectedTangent = tangent.clone().sub(
                sphereNormal.clone().multiplyScalar(tangent.dot(sphereNormal))
            ).normalize();
            
            if (projectedTangent.lengthSq() > 0.01) {
                // Build orientation from Smoothed Normal (up) and curve tangent (forward)
                const up = sphereNormal;
                const forward = projectedTangent;
                const right = new THREE.Vector3().crossVectors(up, forward).normalize();
                
                // Re-orthogonalize forward
                const orthoForward = new THREE.Vector3().crossVectors(right, up).normalize();
                
                // Build rotation matrix
                const m = new THREE.Matrix4().makeBasis(right, up, orthoForward);
                const targetHeading = new THREE.Quaternion().setFromRotationMatrix(m);
                
                // SET headingQuaternion directly (not just slerp) for proper curve following
                this.headingQuaternion.copy(targetHeading);
            }
            
            // Skip normal movement
            autoMove = 0;
            autoTurn = 0;
        } else if (this.isFollowingPath && this.path && this.path.length > 0) {
            // Legacy steering-based path following (only if actively following)
            const target = this.path[0];
            const dist = this.position.distanceTo(target);
            
            if (dist < 1.0) {
                this.path.shift();
            } else {
                const basis = SphericalMath.getBasis(this.headingQuaternion);
                const toTarget = target.clone().sub(this.position).normalize();
                const up = basis.up;
                const tangentTarget = toTarget.clone().sub(up.clone().multiplyScalar(toTarget.dot(up))).normalize();
                const forward = basis.forward;
                const right = basis.right;
                const dot = forward.dot(tangentTarget);
                const cross = right.dot(tangentTarget);
                
                if (Math.abs(cross) > 0.05) autoTurn = Math.sign(cross);
                if (dot > -0.3) autoMove = 1;
            }
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
            
            const dot = forward.dot(tangentTarget);
            const cross = right.dot(tangentTarget);
            
            if (Math.abs(cross) > 0.05) autoTurn = Math.sign(cross);
            
            // Move if facing roughly target
            if (dot > 0.0) autoMove = 1; // Allow move even if turning, for smooth arc
            else autoMove = 0; // Pivot if behind?
            // User wants "Vehicle goes in direction".
            // If angle is large, maybe slow down?
            // For now, simple drive.
             if (dot > -0.5) autoMove = 1; // Drive unless backwards
        }

        // Calculate manual input values
        const manualTurn = (input.right ? 1 : 0) - (input.left ? 1 : 0);
        const manualMove = (input.forward ? 1 : 0) - (input.backward ? 1 : 0);
        
        // KEYBOARD OVERRIDE SYSTEM
        // When user uses keyboard while following a path, pause and save path
        // After 4 seconds of no keyboard input, auto-resume the saved path
        const hasKeyboardInput = manualTurn !== 0 || manualMove !== 0;
        
        if (hasKeyboardInput) {
            // User is using keyboard
            this.keyboardOverrideTimer = 0; // Reset timer
            
            if (!this.isKeyboardOverriding && this.isFollowingPath && this.path && this.path.length > 0) {
                // FIRST keyboard input while on a path - SAVE the path!
                console.log("Keyboard Override: Saving path at index", this.pathIndex);
                this.savedPath = [...this.path]; // Clone the path
                this.savedPathIndex = this.pathIndex || 0;
                this.isKeyboardOverriding = true;
                this.isFollowingPath = false;
                this.pausedByCommand = true;
                this.setHeadlightsOn(true); // Turn on headlights when player takes control
            } else if (!this.isKeyboardOverriding && !this.savedPath) {
                // Keyboard control without any path - just mark as overriding
                this.isKeyboardOverriding = true;
                if (this.isFollowingPath) {
                    this.isFollowingPath = false;
                    this.pausedByCommand = true;
                }
                this.setHeadlightsOn(true); // Turn on headlights when player takes control
            }
        } else {
            // No keyboard input
            if (this.isKeyboardOverriding) {
                // Was overriding, now stopped - start counting
                this.keyboardOverrideTimer += dt;
                
                // After 4 seconds, resume saved path
                if (this.keyboardOverrideTimer >= 4.0 && this.savedPath && this.savedPath.length > 0) {
                    console.log("Keyboard Override: Resuming path at index", this.savedPathIndex);
                    this.path = this.savedPath;
                    this.pathIndex = this.savedPathIndex;
                    this.savedPath = null;
                    this.savedPathIndex = 0;
                    this.isKeyboardOverriding = false;
                    this.pausedByCommand = false;
                    this.isFollowingPath = true;
                    this.setHeadlightsOn(false); // Turn off headlights when player releases control
                } else if (this.keyboardOverrideTimer >= 4.0 && !this.savedPath) {
                    // No saved path, just reset override state
                    this.isKeyboardOverriding = false;
                    this.setHeadlightsOn(false); // Turn off headlights
                }
            }
        }
        
        // Calculate final input (manual or auto)
        // BLOCK INPUT DURING BOUNCE OR WATER PUSH - unit is uncontrollable
        const isLocked = this.isBouncing || this.isWaterPushing;
        const turnInput = isLocked ? 0 : (this.pausedByCommand ? manualTurn : (manualTurn || autoTurn));
        let moveInput = isLocked ? 0 : (this.pausedByCommand ? manualMove : (manualMove || autoMove));
        
        // Initialize heading quaternion if needed
        if (!this.headingQuaternion) {
            this.headingQuaternion = this.mesh.quaternion.clone();
        }
        
        // DRIFT FIX: Force HeadingQuaternion to Align with Sphere Normal
        // This ensures the "Vertical Axis" of the quaternion is always the Sphere Normal
        const currentSphereNormal = this.position.clone().normalize();
        const headingForward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.headingQuaternion).normalize();
        // Project forward to be orthogonal to sphere normal
        const orthoForward = headingForward.clone().sub(currentSphereNormal.clone().multiplyScalar(headingForward.dot(currentSphereNormal))).normalize();
        
        const sphereRight = new THREE.Vector3().crossVectors(currentSphereNormal, orthoForward).normalize();
        const sphereBasis = new THREE.Matrix4().makeBasis(sphereRight, currentSphereNormal, orthoForward);
        this.headingQuaternion.setFromRotationMatrix(sphereBasis);
        
        // 1. Handle Turning (Local Y Axis)
        if (turnInput !== 0) {
            let dir = turnInput > 0 ? -1 : 1; // Invert because Right is Negative Rotation
            
            // INVERTED REVERSE STEERING
            // If we are strictly reversing (manual input < 0 or auto-reverse), flip steering.
            // Check moveInput (which captures manual or auto move command)
            if (moveInput < 0) {
                dir *= -1;
            }

            // Rotate around World Up (Sphere Normal) to ensure correct Yaw
            const axis = this.position.clone().normalize();
            const rot = new THREE.Quaternion().setFromAxisAngle(axis, dir * turnSpeed);
            this.headingQuaternion.premultiply(rot);
        }

        // 2. Handle Movement (Local Z Axis)
        const forwardLocal = new THREE.Vector3(0, 0, 1);
        const forwardWorld = forwardLocal.applyQuaternion(this.headingQuaternion).normalize();


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
                        this.bounceVelocity = Math.abs(adjustedDist) / (1/60) * 0.2; // Reduced from 0.5 for gentler shake
                        this.bounceCooldown = 0.5;
                        finalPos = oldPos; // DON'T move toward rock
                        console.log('[Unit] Rock collision (keyboard)! Bouncing back on path...');
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
        const visualHeadingForward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.headingQuaternion).normalize();
        
        // Construct Basis aligned to Terrain Normal but facing Heading
        const up = terrainNormal;
        
        // Project Heading Forward onto Terrain Plane
        let forward = visualHeadingForward.clone().sub(up.clone().multiplyScalar(visualHeadingForward.dot(up))).normalize();
        
        // Calculate Right (Up x Forward)
        const right = new THREE.Vector3().crossVectors(up, forward).normalize();
        
        // Re-calculate Forward to ensure orthogonality (Forward = Right x Up)
        forward.crossVectors(right, up).normalize();
        
        // Create Target Rotation Matrix
        const m = new THREE.Matrix4().makeBasis(right, up, forward);
        const targetQuat = new THREE.Quaternion().setFromRotationMatrix(m);
        
        // Smoothly rotate mesh towards target
        this.mesh.quaternion.slerp(targetQuat, 0.2); 
        
        // Sync mesh position
        this.mesh.position.copy(this.position);
        
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
    
    // === DUST PARTICLE SYSTEM ===
    updateDustParticles(dt, isMoving) {
        // Initialize particles in scene on first call
        if (!this.dustInitialized && this.dustParticles.length > 0) {
            // Find scene - traverse up until we find it
            let scene = null;
            if (this.game && this.game.scene) {
                scene = this.game.scene;
            } else if (this.mesh && this.mesh.parent) {
                let obj = this.mesh.parent;
                while (obj.parent) obj = obj.parent;
                scene = obj;
            }
            
            if (scene) {
                for (const p of this.dustParticles) {
                    scene.add(p);
                }
                this.dustInitialized = true;
                console.log('[Dust] Initialized', this.dustParticles.length, 'particles');
            }
        }
        
        // Spawn new particles when moving (NOT in water)
        const inWater = this.waterState && this.waterState !== 'normal';
        if (isMoving && !this.isBouncing && !inWater) {
            this.dustSpawnTimer -= dt;
            
            if (this.dustSpawnTimer <= 0) {
                this.dustSpawnTimer = 0.03; 
                
                // Spawn at BACK wheel positions matches tracks
                // We calculate them just like tracks: pBL and pBR
                const wheelOffsetSide = 0.15; 
                const wheelOffsetFront = 0.2; // Back is -1 * this
                const basis = SphericalMath.getBasis(this.headingQuaternion);
                
                const getWheelPos = (sideMul, frontMul) => {
                    const pos = this.position.clone()
                        .add(basis.right.clone().multiplyScalar(sideMul * wheelOffsetSide))
                        .add(basis.forward.clone().multiplyScalar(frontMul * wheelOffsetFront));
                    const dir = pos.normalize();
                    const radius = this.planet.terrain.getRadiusAt(dir);
                    return dir.multiplyScalar(radius + 0.05); // Just above ground
                };

                const pBL = getWheelPos(-1, -1);
                const pBR = getWheelPos(1, -1);
                
                const spawnPoints = [pBL, pBR];
                
                for (const pos of spawnPoints) {
                    // Find an inactive particle
                    for (const p of this.dustParticles) {
                        if (!p.visible) {
                            p.position.copy(pos);
                            
                            // Align flat on ground
                            const sphereUp = pos.clone().normalize();
                            const forward = basis.forward.clone(); 
                            const right = new THREE.Vector3().crossVectors(sphereUp, forward).normalize();
                            const adjustedForward = new THREE.Vector3().crossVectors(right, sphereUp).normalize();
                            
                            const m = new THREE.Matrix4();
                            m.makeBasis(right, adjustedForward, sphereUp);
                            p.quaternion.setFromRotationMatrix(m);
                            
                            // Random rotation around Up axis for variety
                            p.rotateZ(Math.random() * Math.PI * 2);
                            
                            p.userData.life = 240;  // 4 seconds at 60 FPS
                            p.userData.maxLife = 240;
                            p.visible = true;
                            p.scale.setScalar(1.5); // Start size
                            p.material.opacity = 0.25; // More visible
                            p.material.color.setHex(0xA67B5B); 
                            break;
                        }
                    }
                }
            }
        }
        
        // Update all active particles
        for (const p of this.dustParticles) {
            if (p.visible) {
                p.userData.life -= dt;
                
                const lifeFrac = Math.max(0, p.userData.life / p.userData.maxLife);
                
                // Opacity: 0.25 -> 0.0 (fade out)
                p.material.opacity = lifeFrac * 0.25;
                
                // Scale: 20x growth from 1.5 to 30 in 4 seconds
                const growthCrv = 1.0 - Math.pow(lifeFrac, 0.3); // Very fast initial expansion
                const newScale = 1.5 + growthCrv * 28.5; // 1.5 * 20 = 30
                p.scale.setScalar(newScale);
                
                // Color remains constant
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
        // Sample radius (footprint size)
        const radius = this.smoothingRadius; 
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
                console.log("Water: Entering -> Slowing down...");
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
                // Stopped. Lock controls and switch to Pushing Out.
                this.waterState = 'pushing_out';
                this.waterSlowdownFactor = 0; // Frozen
                this.waterExitTime = 0;
                this.isWaterPushing = true; // LOCK INPUT during pushback
                console.log("Water: Stopped. Locking controls -> Pushing out.");
                return 0; // Force stop input
            }
            return effectiveInput;
        }

        // STATE: Pushing Out (Automated Exit)
        if (this.waterState === 'pushing_out') {
            // Ignore user input.
            // Push BACKWARDS (assuming entered forwards)
            // Or push towards higher ground?
            // Simple approach: Reverse
            
            this.waterExitTime += dt;
            
            // "Shiver" Effect: Rotate around local Y (Up)
            // oscillate
            const shiverFreq = 25.0;
            const shiverAmp = 0.02; // Radian wobble
            const shiver = Math.sin(this.waterExitTime * shiverFreq) * shiverAmp;
            // Apply shiver to mesh (visual only) without affecting physics heading? 
            // Better to apply as a temporary rotation in render, but here we can just jitter the heading slightly?
            // Or better: Apply to a visual offset if possible. 
            // For now, jittering heading slightly is acceptable for "struggling" effect.
            this.mesh.rotation.y += shiver * 0.5; // Visual jitter hack
            
            // Acceleration for push out
            const pushSpeed = Math.min(0.5, this.waterExitTime * 0.5); // Ramp up speed
            
            let autoInput = -pushSpeed; // Reverse!
            
            // Check if out of water
            if (!isUnderwater) {
                this.waterState = 'recovering';
                this.waterRecoverTime = 0;
                console.log("Water: Exited -> Recovering (Ease-out stop).");
            }
            return autoInput;
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
                 console.log("Water: Recovered. Controls restored.");
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
                        varying float vBirthTime;
                        const float LIFETIME = 600.0; 
                    ` + shader.fragmentShader;
                    shader.fragmentShader = shader.fragmentShader.replace(
                        '#include <map_fragment>',
                        `
                        #include <map_fragment>
                        
                        // Fade Logic for Multiply Blending
                        // WHITE (1.0) = invisible, DARKER = visible
                        // User wants: 20% base opacity (0.8 color = near white)
                        //             60% max opacity (0.4 color) when layers overlap
                        // So we start at 0.8 and let Multiply darken to min 0.4
                        float age = uTime - vBirthTime;
                        
                        // Base brightness = 0.9 (10% dark = 90% brightness)
                        float baseBrightness = 0.9;
                        
                        if (age > LIFETIME) {
                            diffuseColor.rgb = vec3(1.0); // Invisible
                        } else {
                            // Fade out over last 15 seconds
                            float fadeStart = LIFETIME - 15.0;
                            if (age > fadeStart) {
                                float fade = (age - fadeStart) / 15.0;
                                diffuseColor.rgb = mix(diffuseColor.rgb * baseBrightness, vec3(1.0), fade);
                            } else {
                                // Apply base brightness (makes tracks lighter/more transparent)
                                diffuseColor.rgb = diffuseColor.rgb * baseBrightness;
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
            const trackHeightOffset = 0.02; 
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
            
            // Dust
            this.generateDustParticles(pFL, pFR);

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

        // CHECK DISTANCE
        let distToCam = 0;
        if (this.game && this.game.camera) {
            distToCam = this.mesh.position.distanceTo(this.game.camera.position);
        }
        if (distToCam > 80) return; 

        // Create particles at both wheel positions
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
                // User Request: "kezdetben is 50% transparenciája" (Opacity = 0.5)
                opacity: 0.5, 
                depthWrite: false, 
                side: THREE.FrontSide,
            });
            
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.copy(particlePos);
            mesh.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
            
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
            let lifeTime = 4.0; // Fixed 4 second duration
            if (isSlowOne) {
                 lifeTime *= 1.5; // Some even longer
            }

            if (!this.dustParticles) this.dustParticles = [];
            this.dustParticles.push({
                mesh: mesh,
                age: 0,
                lifetime: lifeTime, 
                // User Request: 20x growth (size * 20)
                maxSize: size * 20.0, 
                startOpacity: 0.3, // More visible
            });
        };
        
        if (Math.random() > 0.7) spawnParticle(posLeft);
        if (Math.random() > 0.7) spawnParticle(posRight);
    }
    
    updateDustParticles(dt) {
        if (!this.dustParticles) return;
        
        for (let i = this.dustParticles.length - 1; i >= 0; i--) {
            const p = this.dustParticles[i];
            p.age += dt;
            
            if (p.age >= p.lifetime) {
                if (p.mesh) {
                    this.scene.remove(p.mesh);
                    if (p.mesh.geometry) p.mesh.geometry.dispose();
                    if (p.mesh.material) p.mesh.material.dispose();
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
}
