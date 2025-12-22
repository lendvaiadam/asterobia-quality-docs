import * as THREE from 'three';
import { SphericalMath } from '../Math/SphericalMath.js';

/**
 * SphericalCameraController 4.0 (Precise Control)
 * 
 * Implements specific control behaviors:
 * - Zoom: Anchor-locked, moves along ray, resets on timeout.
 * - Drag (LMB): "Grab & Drag" surface interaction (1:1 feel).
 * - Orbit (RMB): Rotates around a fixed pivot point.
 * - Free Look (LMB+RMB): FPS-style rotation around camera center.
 */
export class SphericalCameraController4 {
    constructor(camera, domElement, planet) {
        this.camera = camera;
        this.domElement = domElement;
        this.planet = planet;

        // Configuration
        this.config = {
            orbitSensitivity: 0.005,
            freeLookSensitivity: 0.002,
            minDistance: 2.0,          // Min distance from terrain surface
            maxDistance: 500.0,
            minPitch: -Math.PI / 2 + 0.1,
            maxPitch: Math.PI / 2 - 0.1,
            dampingFactor: 0.05,
            // Orbit Behavior (RMB)
            orbitAlignmentSpeed: 0.6,      // Roll to horizontal speed (doubled)
            orbitCenteringSpeed: 0.0015,    // Pull pivot to center speed (1/10th)
            // Cinematic Zoom Config (Smooth ease-in/out)
            zoomInImpulse: 0.04,         // Gentler start (was 0.08)
            zoomOutImpulse: 0.025,       // Gentler start (was 0.05)
            zoomDamping: 0.96,           // Much smoother ease-out (was 0.92)
            zoomMinVelocity: 0.0005,     // Stop later for longer tail (was 0.001)
            zoomTimeout: 500,            // Longer reset time (was 300)
            // Chase Config
            chaseDistance: 12.0, // Was 8.0 - Further back
            chaseHeight: 2.5,    // Was 4.0 - Lower down (TPS view)
            chaseResponsiveness: 0.015, // Ultra smooth, heavy balloon-like inertia
            // Collision Config
            minRockDistance: 2.0,      // Min distance from rock surface
            minUnitDistance: 1.5,      // Min distance from unit surface
        };

        // Log camera config to console for tuning
        console.log('[Camera Config]', {
            damping: this.config.dampingFactor,
            chaseResponsiveness: this.config.chaseResponsiveness,
            zoomDamping: this.config.zoomDamping,
            zoomInImpulse: this.config.zoomInImpulse,
            zoomOutImpulse: this.config.zoomOutImpulse
        });

        // State Flags
        this.isDragging = false;
        this.isOrbiting = false;
        this.isFreeLooking = false;

        // Input State
        this.lastMouseX = 0;
        this.lastMouseY = 0;
        this.isLMBDown = false;
        this.isRMBDown = false;

        // Zoom State (Cinematic)
        this.zoomAnchor = null;         // Fixed target point on terrain
        this.zoomAnchorNormal = null;   // Normal at anchor (up direction)
        this.zoomVelocity = 0;          // Current zoom speed
        this.targetZoomVelocity = 0;    // Target speed for smoothing input
        this.zoomTimer = null;          // Reset timer

        this.orbitPivot = null;

        this.dragLastHit = null; // For incremental drag

        // Raycaster
        this.raycaster = new THREE.Raycaster();

        // Bind event handlers
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
        this.onWheel = this.onWheel.bind(this);
        this.onContextMenu = this.onContextMenu.bind(this);

        this.domElement.addEventListener('mousedown', this.onMouseDown);
        window.addEventListener('mousemove', this.onMouseMove);
        window.addEventListener('mouseup', this.onMouseUp);
        this.domElement.addEventListener('wheel', this.onWheel, { passive: false });
        this.domElement.addEventListener('contextmenu', this.onContextMenu);

        // Initial Setup
        this.ensureUpright();

        // Target State for Smoothing
        this.targetPosition = this.camera.position.clone();
        this.targetQuaternion = this.camera.quaternion.clone();

        // Chase State
        this.chaseTarget = null;
        this.targetObstructionHeight = 0;
        this.currentObstructionHeight = 0;

        // Camera Mode: 'drone' (top-down civ-style) or 'thirdPerson' (behind unit)
        this.chaseMode = 'drone';
        this.isTransitioningMode = false;

        // Relative Orbit Offsets (Radians)
        this.chaseAzimuthOffset = 0;
        this.chaseElevationOffset = 0;

        // Balloon Drift State
        this.balloonDriftTimer = 0; // Time since unit started moving
        this.balloonDriftDuration = 5.0; // 5 seconds to drift behind
        this.unitWasStationary = true; // Track if unit was standing still
        this.lastUnitPosition = null;

        // Dynamic Chase State
        this.currentChaseDistance = this.config.chaseDistance;
        this.lastObstructionCheckPos = new THREE.Vector3();

        // Orbit Alignment State
        this.orbitPivotNormal = null;
        this.orbitAlignWeight = 0;

        // Flying State
        this.isFlying = false;
        this.flyFn = null;

        // Smooth Transition State (for zoomCameraToPath)
        this.transitionFn = null;

        // View Offset State (Vertical Shift)
        this.currentViewOffsetY = 0;
        this.targetViewOffsetY = 0;
    }

    /**
     * Smooth transition to a target position and look-at point.
     * Uses quintic ease-in-out for premium feel.
     */
    smoothTransitionToTarget(targetPos, lookAtPoint, duration = 1.5) {
        this.isFlying = true;
        this.chaseTarget = null;

        const startPos = this.camera.position.clone();
        const startForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        const startLookAt = startPos.clone().addScaledVector(startForward, 50);
        const startUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);

        // End up vector: surface normal at target position
        const endUp = targetPos.clone().normalize();

        let elapsed = 0;

        this.flyFn = (dt) => {
            elapsed += dt;
            const t = Math.min(1.0, elapsed / duration);

            // Quintic ease-in-out
            const ease = t < 0.5
                ? 16 * t * t * t * t * t
                : 1 - Math.pow(-2 * t + 2, 5) / 2;

            // Interpolate position
            const currentPos = new THREE.Vector3().lerpVectors(startPos, targetPos, ease);

            // Interpolate look-at point
            const currentLookAt = new THREE.Vector3().lerpVectors(startLookAt, lookAtPoint, ease);

            // Interpolate up vector
            const currentUp = new THREE.Vector3().lerpVectors(startUp, endUp, ease).normalize();

            // Apply
            this.camera.position.copy(currentPos);
            this.targetPosition.copy(currentPos);

            // Look at target
            const lookM = new THREE.Matrix4();
            lookM.lookAt(currentPos, currentLookAt, currentUp);
            const targetQuat = new THREE.Quaternion().setFromRotationMatrix(lookM);

            this.camera.quaternion.copy(targetQuat);
            this.targetQuaternion.copy(targetQuat);

            if (t >= 1.0) {
                this.isFlying = false;
                return true;
            }
            return false;
        };
    }

    /**
     * Ballistic camera transition with arc trajectory.
     * - Duration based on surface distance
     * - Arc height based on distance (low for short, high for long)
     * - Avoids gimbal lock with proper quaternion interpolation
     */
    ballisticTransitionToTarget(targetPos, lookAtPoint) {
        this.isFlying = true;
        this.chaseTarget = null;

        const startPos = this.camera.position.clone();
        const planetCenter = new THREE.Vector3(0, 0, 0);
        const planetRadius = this.planet.terrain.params.radius;

        // === 1. CALCULATE SURFACE ARC DISTANCE ===
        const startDir = startPos.clone().normalize();
        const endDir = targetPos.clone().normalize();
        const arcAngle = Math.acos(THREE.MathUtils.clamp(startDir.dot(endDir), -1, 1));
        const surfaceDistance = arcAngle * planetRadius;

        // === 2. CALCULATE DURATION (distance-based) ===
        // Short distance (0-50): 1s
        // Medium distance (50-200): 1-2.5s
        // Long distance (>200): 2.5-4s
        const minDuration = 1.5;
        const maxDuration = 5.5;
        const distanceRatio = THREE.MathUtils.clamp(surfaceDistance / (planetRadius * Math.PI), 0, 1);
        const duration = THREE.MathUtils.lerp(minDuration, maxDuration, distanceRatio);

        // === 3. CALCULATE ARC APEX HEIGHT ===
        // Short distance: low arc (camera stays close)
        // Long distance (opposite side): high arc (see whole planet)
        const minArcHeight = planetRadius + 30; // Low arc
        const maxArcHeight = planetRadius * 2.5; // High enough to see whole planet
        const apexRadius = THREE.MathUtils.lerp(minArcHeight, maxArcHeight, distanceRatio);

        // Apex position: midpoint direction at apex radius
        const midDir = new THREE.Vector3().addVectors(startDir, endDir).normalize();
        const apexPos = midDir.multiplyScalar(apexRadius);

        // === 4. SETUP LOOK-AT POINTS ===
        const startForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        const startLookAt = startPos.clone().addScaledVector(startForward, 50);
        const startUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
        const endUp = targetPos.clone().normalize();

        // Apex position calculation (not needed for Slerp, but kept for height ref)

        // Apex position calculation (not needed for Slerp, but kept for height ref)

        let elapsed = 0;

        this.flyFn = (dt) => {
            elapsed += dt;
            const t = Math.min(1.0, elapsed / duration);

            // === EASE-OUT START (quintic ease-in-out) ===
            const ease = t < 0.5
                ? 16 * t * t * t * t * t
                : 1 - Math.pow(-2 * t + 2, 5) / 2;

            // === SPHERICAL BALLISTIC ARC (Slerp + Height Parabola) ===
            // 1. Interpolate Direction (Slerp) - follows planet curvature
            const currentDir = startPos.clone().normalize().lerp(targetPos.clone().normalize(), ease).normalize();
            // Note: normal lerp + normalize approximates slerp well for small angles, 
            // but for full planet slerp is better. Let's use proper Slerp logic via Quaternion or manually.
            // Actually, Vector3.slerp is not built-in for vectors in older Three.js, but lerp+normalize is "nlerp".
            // For strictly accurate Slerp:
            const startQuatRot = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), startDir);
            const endQuatRot = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), endDir);
            const curQuatRot = startQuatRot.clone().slerp(endQuatRot, ease);
            const slerpDir = new THREE.Vector3(0, 1, 0).applyQuaternion(curQuatRot);

            // 2. Interpolate Height (Parabolic Arc)
            // Height(t) = lerp(startH, endH, t) + arcHeight * (1 - (2t-1)^2)
            const startHeight = startPos.length();
            const endHeight = targetPos.length();

            // Parabola: 4 * t * (1-t) peaks at 1 when t=0.5
            const arcFactor = 4 * ease * (1 - ease);
            // Base height interpolation
            const baseHeight = THREE.MathUtils.lerp(startHeight, endHeight, ease);
            // Add arc (apexRadius is the peak height)
            // We want peak height to be apexRadius. 
            // apexRadius is absolute from center.
            const heightBoost = Math.max(0, apexRadius - Math.max(startHeight, endHeight));
            const currentHeight = baseHeight + (heightBoost * arcFactor);

            const currentPos = slerpDir.multiplyScalar(currentHeight);

            // === LOOK-AT INTERPOLATION ===
            const currentLookAt = new THREE.Vector3().lerpVectors(startLookAt, lookAtPoint, ease);

            // === UP VECTOR INTERPOLATION (prevents roll) ===
            const currentUp = new THREE.Vector3().lerpVectors(startUp, endUp, ease).normalize();

            // === APPLY ===
            this.camera.position.copy(currentPos);
            this.targetPosition.copy(currentPos);

            // Build look-at matrix (no roll)
            const lookM = new THREE.Matrix4();
            lookM.lookAt(currentPos, currentLookAt, currentUp);
            const targetQuat = new THREE.Quaternion().setFromRotationMatrix(lookM);

            this.camera.quaternion.copy(targetQuat);
            this.targetQuaternion.copy(targetQuat);

            if (t >= 1.0) {
                this.isFlying = false;
                return true;
            }
            return false;
        };
    }

    /**
     * Smoothly transition from drone view to third-person behind the unit.
     * Called when user starts keyboard control.
     * Uses slow, balloon-like movement for a premium feel.
     */
    transitionToThirdPerson(unit) {
        if (!unit || this.chaseMode === 'thirdPerson') return;

        this.chaseMode = 'thirdPerson';
        this.isTransitioningMode = true;
        this.chaseTarget = unit;

        const startPos = this.camera.position.clone();
        const startQuat = this.camera.quaternion.clone();

        // Calculate third-person target position (behind and slightly above unit)
        const strictUp = unit.position.clone().normalize();
        const rawForward = new THREE.Vector3(0, 0, 1);
        if (unit.headingQuaternion) rawForward.applyQuaternion(unit.headingQuaternion);

        const strictRight = new THREE.Vector3().crossVectors(strictUp, rawForward).normalize();
        const strictForward = new THREE.Vector3().crossVectors(strictRight, strictUp).normalize();

        // Target: behind and above
        const targetPos = unit.position.clone()
            .addScaledVector(strictForward, -this.config.chaseDistance)
            .addScaledVector(strictUp, this.config.chaseHeight);

        // Look at unit
        const lookAt = unit.position.clone();
        const endUp = strictUp.clone();

        // SLOW transition for balloon-like feel
        const duration = 2.5;
        let elapsed = 0;

        this.flyFn = (dt) => {
            elapsed += dt;
            const t = Math.min(1.0, elapsed / duration);

            // Smooth cubic ease-in-out (softer than quintic for balloon feel)
            // Position ease - starts immediately
            const ease = t < 0.5
                ? 4 * t * t * t
                : 1 - Math.pow(-2 * t + 2, 3) / 2;

            // POI/Look-at ease - starts 0.15s LATER for cinematic camera-leads-focus effect
            const poiDelay = 0.15 / duration; // Delay as fraction of duration
            const poiT = Math.max(0, Math.min(1.0, (elapsed - 0.15) / (duration - 0.15)));
            const poiEase = poiT < 0.5
                ? 4 * poiT * poiT * poiT
                : 1 - Math.pow(-2 * poiT + 2, 3) / 2;

            // Interpolate position (starts first)
            const currentPos = new THREE.Vector3().lerpVectors(startPos, targetPos, ease);
            this.camera.position.copy(currentPos);
            this.targetPosition.copy(currentPos);

            // Track unit position for look-at (unit may have moved)
            // Use delayed poiEase for orientation
            const currentLookAt = unit.position.clone();
            const currentUp = unit.position.clone().normalize();

            // Build look-at matrix
            const lookM = new THREE.Matrix4();
            lookM.lookAt(currentPos, currentLookAt, currentUp);
            const targetQuat = new THREE.Quaternion().setFromRotationMatrix(lookM);

            // Slerp quaternion with DELAYED ease (camera look trails position)
            this.camera.quaternion.slerpQuaternions(startQuat, targetQuat, poiEase);
            this.targetQuaternion.copy(this.camera.quaternion);

            if (t >= 1.0) {
                this.isFlying = false;
                this.isTransitioningMode = false;
                return true;
            }
            return false;
        };

        this.isFlying = true;
    }

    /**
     * Ensures the camera is roughly upright relative to the planet surface.
     */
    ensureUpright() {
        const planetCenter = new THREE.Vector3(0, 0, 0);
        const cameraPos = this.camera.position.clone();
        const idealUp = cameraPos.clone().sub(planetCenter).normalize();
        const lookDir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);

        const matrix = new THREE.Matrix4();
        matrix.lookAt(cameraPos, cameraPos.clone().add(lookDir), idealUp);
        this.camera.quaternion.setFromRotationMatrix(matrix);
    }

    update(dt) {
        // === FLYING UPDATE ===
        if (this.isFlying && this.flyFn) {
            const finished = this.flyFn(dt);
            if (finished) {
                this.isFlying = false;
                this.flyFn = null;
            }
            // While flying, we override position/rotation directly.
            // Still enforce terrain distance
            this.enforceTerrainDistance(this.camera.position);
            this.camera.updateMatrixWorld();
            return;
        }

        // === CINEMATIC ZOOM UPDATE ===
        // === CINEMATIC ZOOM UPDATE ===
        // Smoothly accelerate velocity
        // === CINEMATIC ZOOM UPDATE ===
        // Smoothly accelerate velocity
        if (this.targetZoomVelocity !== 0 || this.zoomVelocity !== 0) {
            // Determine if we are Accelerating (Start) or Decelerating (Stop)
            const isAccelerating = Math.abs(this.targetZoomVelocity) > Math.abs(this.zoomVelocity);

            // User requested "Smooth Easy In and Out" (Slow start, Slow stop)
            // Acceleration Factor: Lower = Smoother start (heavier feel)
            // Deceleration Factor: Lower = Smoother stop (slide)

            // Start: 0.05 (Very soft)
            // Stop: 0.1 (Responsive but smooth)
            const damping = isAccelerating ? 0.05 : 0.1;

            this.zoomVelocity += (this.targetZoomVelocity - this.zoomVelocity) * damping;

            // Apply decay to target (Friction) allows user to "coast"
            this.targetZoomVelocity *= 0.95; // Slower decay for longer smooth slide

            if (Math.abs(this.targetZoomVelocity) < 0.001) this.targetZoomVelocity = 0;

            if (Math.abs(this.zoomVelocity) > 0.001) {
                this.updateCinematicZoom();
            } else if (this.targetZoomVelocity === 0) {
                this.zoomVelocity = 0;
            }
        }

        // === CHASE MODE UPDATE ===
        // Only run chase update if NOT currently in flying animation (prevents interference)
        if (this.chaseTarget && !this.isFlying) {
            this.updateChaseMode();

            // === UNIT OCCLUSION CHECK ===
            // If unit is blocked by terrain, raise camera
            this.checkUnitVisibility(dt);
        }

        // === ORBIT ALIGNMENT UPDATE ===
        // === ORBIT ALIGNMENT UPDATE ===
        // Restored Orbit Alignment (Auto-leveling) per user request to avoid "broken" feel.
        // This gently aligns the camera up-vector to the orbit pivot normal.
        if (this.isOrbiting && this.orbitPivot && this.orbitPivotNormal) {
            this.updateOrbitAlignment(dt);
        }

        // === VIEW OFFSET REMOVED ===
        // User request: "Semmi ne történjen akkor, amikor a unit tab-ot kinyitom"
        // The map stays exactly where it is, panel just overlays on top.

        // Damping: Smoothly interpolate Camera towards Target
        // Use specific damping for Chase mode to keep alignment tight, else smooth (Zoom/Orbit)
        const damping = this.chaseTarget ? this.config.chaseResponsiveness : this.config.dampingFactor;

        // Position Lerp
        this.camera.position.lerp(this.targetPosition, damping);

        // === TERRAIN COLLISION ===
        // Enforce minimum distance from terrain surface
        this.enforceTerrainDistance(this.camera.position);



        // Quaternion Slerp
        this.camera.quaternion.slerp(this.targetQuaternion, damping);

        // === CAMERA SHAKE (from rock collision) ===
        // Read cameraShakeIntensity from chaseTarget and apply shake
        if (this.chaseTarget && this.chaseTarget.cameraShakeIntensity > 0) {
            const intensity = this.chaseTarget.cameraShakeIntensity;
            const time = performance.now() * 0.001;
            const shakeFreq = 15; // 15 Hz shake

            // Shake amplitude: intensity * base (max ~10 degrees for intensity 3)
            const maxAngle = intensity * 3.5 * (Math.PI / 180); // ~10 degrees at intensity 3
            const shakeAngle = maxAngle * Math.sin(time * shakeFreq * 2 * Math.PI);

            // Apply shake around camera's local Y axis
            const shakeQuat = new THREE.Quaternion().setFromAxisAngle(
                new THREE.Vector3(0, 1, 0),
                shakeAngle
            );
            this.camera.quaternion.multiply(shakeQuat);
        }

        // Ensure matrix update
        this.camera.updateMatrixWorld();

        // === PLANET VISIBILITY CONSTRAINT ===
        // User Request: "Távoli nézetben a bolygót kényszerítsük bele a képkeretbe"
        // Prevent looking away from planet when zoomed out.
        this.checkPlanetVisibility(dt);

        // === DISTANCE-BASED CENTERING ===
        // User Request: "Ha teljesen kizoomolok, a bolygó egyre kevésbé mozduljon el középről"
        // As camera moves farther from planet, gently pull camera position so planet stays centered.
        // This is a position offset, NOT a rotation change.
        this.applyDistanceCentering(dt);
    }

    /**
     * Gently pulls the camera so the planet stays centered as distance increases.
     * Uses a gradual force that increases with distance.
     */
    applyDistanceCentering(dt) {
        // DISABLED: User requested no auto-centering behavior
        // The camera should stay where the user positions it
        return;

        if (!this.planet) return;
        if (this.isFlying || this.isDragging || this.isOrbiting) return; // Don't interfere with user input

        const dist = this.targetPosition.length();
        const radius = this.planet.terrain.params.radius;

        // Start centering at 1.5x radius, full strength at 3x radius
        const startDist = radius * 1.5;
        const fullDist = radius * 3.0;

        if (dist < startDist) return; // Close enough, no centering needed

        // Calculate centering strength (0 to 1)
        const t = THREE.MathUtils.clamp((dist - startDist) / (fullDist - startDist), 0, 1);
        // Ease-in for smooth onset
        const strength = t * t; // Quadratic ease-in

        // Calculate ideal "centered" position: same distance, but looking straight at planet center
        // We want the camera to be positioned such that planet center is in the middle of the view.
        // This means moving the camera towards the line from planet center through current camera direction.

        // Current camera forward
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.targetQuaternion);

        // Ideal position: on the ray from planet center, at current distance
        const idealPos = forward.clone().negate().normalize().multiplyScalar(dist);

        // Blend towards ideal position
        const centeringSpeed = 0.02 * strength; // Gentle pull, stronger when far
        this.targetPosition.lerp(idealPos, centeringSpeed);
    }

    /**
     * Constraints the camera so the planet is always visible in distant views.
     * Implements "Easy-In" soft stop at the limit.
     */
    checkPlanetVisibility(dt) {
        if (!this.planet) return;

        const dist = this.targetPosition.length();
        const radius = this.planet.terrain.params.radius;

        // Define "Distant View": > 1.2x radius altitude (approx)
        // If close to surface, full freedom is needed (e.g. looking at horizon).
        if (dist < radius * 1.2) return;

        // Calculate limit angle
        // Angular radius of planet from camera
        // sin(theta) = R / D
        // angle = asin(R / D)
        const planetAngularRadius = Math.asin(radius / dist);

        // Camera FOV (vertical is usually smaller/restrictive)
        const fovRad = THREE.MathUtils.degToRad(this.camera.fov);

        // Max deviation angle from center
        // If we look away by (PlanetRadius + HalfFOV), the edge touches the screen edge.
        // We want to KEEP it inside.
        // So Limit = PlanetAngularRadius + (HalfFOV * 0.8); // 0.8 buffer to be safe
        const limitAngle = planetAngularRadius + (fovRad * 0.5 * 0.9);

        // Current Angle
        const toCenter = this.targetPosition.clone().negate().normalize();
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.targetQuaternion);

        const currentAngle = forward.angleTo(toCenter);

        // Check violation
        if (currentAngle > limitAngle) {
            // Calculate correction needed
            const correction = currentAngle - limitAngle;

            // "Easy-In" Soft Stop?
            // If we are strictly overriding targetQuaternion here, input feels "blocked".
            // To make it smooth, we can slerp towards the valid boundary.

            // Axis of rotation (Vertical axis perpendicular to deviation)
            const axis = new THREE.Vector3().crossVectors(forward, toCenter).normalize();

            // Create correction rotation (rotate Forward TOWARDS Center)
            const corrQuat = new THREE.Quaternion().setFromAxisAngle(axis, correction);

            // Apply correction to targetQuaternion
            this.targetQuaternion.premultiply(corrQuat);
            this.targetQuaternion.normalize();
        }
    }

    /**
     * Sets the chase target unit and enables chase mode.
     */
    setChaseTarget(unit, isControlMode = false) {
        this.chaseTarget = unit;
        if (isControlMode) {
            this.chaseMode = 'thirdPerson';
        }
        // If we are NOT in a transition, stop flying so we can chase immediately
        if (!this.isTransitioningMode) {
            this.isFlying = false;
        }
    }

    /**
     * Updates the camera position during Chase Mode.
     * Implements "Balloon" logic: gently drifts behind the unit.
     */
    updateChaseMode() {
        if (!this.chaseTarget) return;

        // 1. Calculate Ideal Chase Position (Behind and Above)
        const unit = this.chaseTarget;
        const strictUp = unit.position.clone().normalize();

        let forwardDef = new THREE.Vector3(0, 0, 1);
        if (unit.headingQuaternion) forwardDef.applyQuaternion(unit.headingQuaternion);

        // Remove up component to get pure tangent forward
        const right = new THREE.Vector3().crossVectors(strictUp, forwardDef).normalize();
        const forward = new THREE.Vector3().crossVectors(right, strictUp).normalize();

        const idealPos = unit.position.clone()
            .addScaledVector(forward, -this.config.chaseDistance) // Behind
            .addScaledVector(strictUp, this.config.chaseHeight);  // Above

        // 2. Apply Drift (Balloon Effect)
        // If user is orbiting, we apply a weaker pull, allowing them to look around.
        // If not orbiting, we apply a stronger (but still smooth) pull.

        // Drift factor: how fast we align to the ideal position
        // 0.02 = very loose balloon
        // 0.05 = tighter leash
        const driftFactor = this.isOrbiting ? 0.005 : 0.03;

        // INTERPOLATE TargetPosition towards IdealPos
        // We modify targetPosition to pull the camera anchor
        this.targetPosition.lerp(idealPos, driftFactor);

        // 3. Ensure Looking At Unit (Point of Interest)
        // We continuously update the target rotation to look at the unit
        // UNLESS the user is actively Looking Around (FreeLook)
        if (!this.isFreeLooking) {
            const currentPos = this.camera.position.clone();
            const lookAtPoint = unit.position.clone(); // Center of unit
            const up = currentPos.clone().normalize(); // Planet Up

            const lookM = new THREE.Matrix4();
            lookM.lookAt(currentPos, lookAtPoint, up);
            const idealQuat = new THREE.Quaternion().setFromRotationMatrix(lookM);

            // Slerp for smooth rotation (don't snap)
            this.targetQuaternion.slerp(idealQuat, 0.1);
        }
    }

    /**
     * Check if chaseTarget (unit) is visible from camera.
     * If occluded by terrain, smoothly raise camera.
     * Throttled to run every 250ms for performance.
     */
    checkUnitVisibility(dt) {
        // TEMPORARILY DISABLED - testing if this causes stutter
        return;

        if (!this.chaseTarget || !this.planet) return;

        // Throttle raycast check (every 250ms)
        if (!this.lastOcclusionCheck) this.lastOcclusionCheck = 0;
        this.lastOcclusionCheck += dt;

        // Initialize occlusion state
        if (this.targetOcclusionElevation === undefined) this.targetOcclusionElevation = 0;
        if (this.currentOcclusionElevation === undefined) this.currentOcclusionElevation = 0;

        const shouldCheck = this.lastOcclusionCheck >= 0.5; // 500ms = 2 times per second
        if (shouldCheck) {
            this.lastOcclusionCheck = 0;

            const unitPos = this.chaseTarget.position.clone();
            const up = unitPos.clone().normalize();

            // BINARY SEARCH: Find minimum elevation needed for clear line of sight
            let minElev = 0;
            let maxElev = 25;
            let requiredElev = 0;

            for (let i = 0; i < 3; i++) { // 3 iterations (reduced for performance)
                const testElev = (minElev + maxElev) / 2;
                const testCamPos = this.targetPosition.clone().addScaledVector(up, testElev);

                const dir = unitPos.clone().sub(testCamPos).normalize();
                const distToUnit = testCamPos.distanceTo(unitPos);

                this.raycaster.set(testCamPos, dir);
                this.raycaster.far = distToUnit;

                const intersects = this.raycaster.intersectObject(this.planet.mesh, false);
                const isOccluded = intersects.length > 0 && intersects[0].distance < distToUnit - 0.5;

                if (isOccluded) {
                    // Need more elevation
                    minElev = testElev;
                    requiredElev = maxElev;
                } else {
                    // This works, try lower
                    maxElev = testElev;
                    requiredElev = testElev;
                }
            }

            // Camera STAYS ELEVATED - only update target if need MORE elevation
            // Never go back down automatically
            if (requiredElev > 0.5) {
                this.targetOcclusionElevation = Math.max(this.targetOcclusionElevation, requiredElev + 2);
            }
            // Note: targetOcclusionElevation only decreases to the minimum needed, NOT to zero
        }

        // SMOOTH LERP: easeOut interpolation towards target (every frame)
        const lerpSpeed = this.targetOcclusionElevation > this.currentOcclusionElevation ? 0.12 : 0.06;
        this.currentOcclusionElevation += (this.targetOcclusionElevation - this.currentOcclusionElevation) * lerpSpeed;

        // Apply elevation to target position
        if (this.currentOcclusionElevation > 0.1) {
            const up = this.chaseTarget.position.clone().normalize();
            this.targetPosition.addScaledVector(up, this.currentOcclusionElevation);
        }
    }

    /**
     * Enforce minimum distance from terrain surface AND obstacles (rocks, units).
     * Uses distance-based throttling for performance optimization.
     */
    enforceTerrainDistance(position) {
        // 1. TERRAIN COLLISION (always check - cheap)
        const dir = position.clone().normalize();
        const terrainRadius = this.planet.terrain.getRadiusAt(dir);
        const minAllowed = terrainRadius + this.config.minDistance;

        if (position.length() < minAllowed) {
            position.normalize().multiplyScalar(minAllowed);
            if (this.targetPosition.length() < minAllowed) {
                this.targetPosition.normalize().multiplyScalar(minAllowed);
            }
        }

        // 2. OBSTACLE COLLISION (throttled based on distance)
        // Initialize throttle state
        if (!this.obstacleCheckTimer) this.obstacleCheckTimer = 0;
        if (!this.closestObstacleDistance) this.closestObstacleDistance = Infinity;

        // Calculate check interval based on closest obstacle distance
        // Close (<15): check every frame (0ms)
        // Medium (<30): check every 100ms  
        // Far (>30): check every 300ms
        let checkInterval = 0;
        if (this.closestObstacleDistance > 30) {
            checkInterval = 0.3; // 300ms
        } else if (this.closestObstacleDistance > 15) {
            checkInterval = 0.1; // 100ms
        }
        // else: check every frame

        this.obstacleCheckTimer += 0.016; // Approximate frame time

        if (this.obstacleCheckTimer < checkInterval) {
            return position; // Skip this frame
        }

        // Reset timer and perform check
        this.obstacleCheckTimer = 0;
        let closestDist = Infinity;
        const camPos = position;

        // 2a. ROCK COLLISION
        if (this.planet.rockSystem && this.planet.rockSystem.rocks) {
            for (const rock of this.planet.rockSystem.rocks) {
                const rockPos = rock.position;
                const dist = camPos.distanceTo(rockPos);

                // Track closest for next frame throttle decision
                if (dist < closestDist) closestDist = dist;

                // Only check collision if within danger zone
                const rockRadius = rock.scale.x * 1.2;
                const safeDistance = rockRadius + this.config.minRockDistance;

                if (dist < safeDistance) {
                    // Push camera away from rock
                    const pushDir = camPos.clone().sub(rockPos).normalize();
                    const pushAmount = safeDistance - dist;
                    position.addScaledVector(pushDir, pushAmount);

                    if (this.targetPosition.distanceTo(rockPos) < safeDistance) {
                        this.targetPosition.addScaledVector(pushDir, pushAmount);
                    }
                }
            }
        }

        // 2b. UNIT COLLISION (Skip the chase target)
        if (this.game && this.game.units) {
            for (const unit of this.game.units) {
                if (!unit || unit === this.chaseTarget) continue;

                const unitPos = unit.position;
                const dist = camPos.distanceTo(unitPos);

                // Track closest for throttle
                if (dist < closestDist) closestDist = dist;

                const unitRadius = 1.5;
                const safeDistance = unitRadius + this.config.minUnitDistance;

                if (dist < safeDistance) {
                    const pushDir = camPos.clone().sub(unitPos).normalize();
                    const pushAmount = safeDistance - dist;
                    position.addScaledVector(pushDir, pushAmount);

                    if (this.targetPosition.distanceTo(unitPos) < safeDistance) {
                        this.targetPosition.addScaledVector(pushDir, pushAmount);
                    }
                }
            }
        }

        // Store for next frame throttle decision
        this.closestObstacleDistance = closestDist;

        return position;
    }

    /**
     * Cinematic Zoom: Straight-line approach, bend to frontal view near minDistance.
     */
    updateCinematicZoom() {
        const anchor = this.zoomAnchor;
        const minDist = this.config.minDistance;

        // Current state
        const camPos = this.targetPosition.clone();
        const distToAnchor = camPos.distanceTo(anchor);

        // Direction from camera to anchor
        const toAnchor = anchor.clone().sub(camPos).normalize();

        // Apply velocity (positive = zoom in, negative = zoom out)
        // Use logarithmic scaling for smooth ease-out
        const moveAmount = this.zoomVelocity * distToAnchor;

        // Calculate new position
        let newPos = camPos.clone();

        if (this.zoomVelocity > 0) {
            // ZOOM IN: Straight line TOWARDS anchor
            newPos.addScaledVector(toAnchor, moveAmount);
        } else {
            // ZOOM OUT: Straight line AWAY FROM anchor
            // User Request: Symmetric behavior. Zoom center is the raycast point.
            // Moving away from anchor while looking at it = effectively "backing up" from that point.
            // Note: moveAmount is negative here if zoomVelocity is negative? 
            // My calc: moveAmount = zoomVelocity * dist. If vel < 0, moveAmount < 0.
            // So if I ADD (toAnchor * moveAmount) where moveAmount is negative, it moves AWAY from anchor.
            newPos.addScaledVector(toAnchor, moveAmount);
        }

        // Clamp to minDistance
        const finalDist = newPos.distanceTo(anchor);
        if (finalDist < minDist) {
            const dir = newPos.clone().sub(anchor).normalize();
            newPos = anchor.clone().add(dir.multiplyScalar(minDist));
            this.zoomVelocity *= 0.5; // Slow down when hitting limit
        }

        // Clamp to maxDistance
        const newAlt = newPos.length();
        if (newAlt > this.config.maxDistance) {
            newPos.normalize().multiplyScalar(this.config.maxDistance);
            this.zoomVelocity *= 0.5;
        }

        // Update target position
        this.targetPosition.copy(newPos);

        // Enforce terrain distance on target
        this.enforceTerrainDistance(this.targetPosition);

        // Update target quaternion with CENTER-AWARE rotation
        // Near screen center = less rotation, edges = full rotation
        // Calculate how far anchor is from screen center (0 = center, 1 = edge)
        const screenAnchor = anchor.clone().project(this.camera);
        const distFromCenter = Math.sqrt(screenAnchor.x * screenAnchor.x + screenAnchor.y * screenAnchor.y);

        // Rotation blend factor: 0 at center, 1 at edge (0.5 radius)
        const centerFalloff = Math.min(1.0, distFromCenter / 0.5);
        // Apply ease-out curve (quintic) for smooth transition
        const rotationBlend = 1 - Math.pow(1 - centerFalloff, 3);

        // Calculate target look quaternion
        const lookMatrix = new THREE.Matrix4();
        const up = this.targetPosition.clone().normalize();
        lookMatrix.lookAt(this.targetPosition, anchor, up);
        const anchorLookQuat = new THREE.Quaternion().setFromRotationMatrix(lookMatrix);

        // Blend between current orientation (no rotation) and anchor look (full rotation)
        // At center: keep current orientation, at edges: look at anchor
        // Use zoom velocity for ease-in/ease-out: faster zoom = more rotation, slowing zoom = less
        const velocityFactor = Math.min(1.0, Math.abs(this.zoomVelocity) / 0.1);
        const easedVelocity = velocityFactor * velocityFactor; // Quadratic ease-in
        const blendSpeed = 0.08 * (0.3 + 0.7 * easedVelocity); // Base 0.08, max ~0.08 when fast
        this.targetQuaternion.slerp(anchorLookQuat, rotationBlend * blendSpeed);

        // Apply damping to velocity (ease-out)
        this.zoomVelocity *= this.config.zoomDamping;

        // Stop if velocity is too small
        if (Math.abs(this.zoomVelocity) < this.config.zoomMinVelocity) {
            this.zoomVelocity = 0;
        }
    }

    // ===== Input Handling =====

    onMouseDown(event) {
        this.lastMouseX = event.clientX;
        this.lastMouseY = event.clientY;

        // Manual camera control breaks chase mode ONLY if Pan (LMB)
        // Orbit (RMB) adjusts relative angle, doesn't break chase.
        if (event.button === 0) {
            this.chaseTarget = null;
            this.chaseMode = 'drone'; // Stop Game.js from re-enabling chase
        }

        if (event.button === 0) this.isLMBDown = true;
        if (event.button === 2) this.isRMBDown = true;

        // 1. FREE LOOK (LMB + RMB) - Can trigger mid-action!
        if (this.isLMBDown && this.isRMBDown) {
            // End any existing mode
            if (this.isDragging) this.endDrag();
            if (this.isOrbiting) this.endOrbit();

            this.startFreeLook();
            return;
        }

        // 2. ORBIT (RMB)
        if (event.button === 2 && !this.isLMBDown) {
            let hit = this.pickSurfacePoint(event.clientX, event.clientY);

            // "Space Click" Logic
            if (!hit) {
                // If we click in space:
                // 1. Don't let planet go off screen -> Orbit around Planet Center (0,0,0)
                // 2. "Slowly approach" -> Maybe move targetPosition closer to 0,0,0?
                // For now, let's just enable Orbit around (0,0,0) so it's controllable.
                // This prevents "sliding off".
                hit = new THREE.Vector3(0, 0, 0);

                // TODO: Implement "Approach" logic if needed, but rotation is key.
            }

            if (this.chaseTarget) {
                this.isOrbiting = true;
                this.orbitPivot = this.chaseTarget.position.clone();
            } else {
                this.startOrbit(hit);
            }
        }

        // 3. DRAG (LMB)
        if (event.button === 0 && !this.isRMBDown) {
            const hit = this.pickSurfacePoint(event.clientX, event.clientY);
            if (hit) {
                this.startDrag(hit);
            }
        }
    }

    onMouseMove(event) {
        // ROBUSTNESS FIX: Update button states from events.buttons bitmask
        // This handles cases where mousedown events are missed or notebook trackpads behave weirdly
        if (event.buttons !== undefined) {
            this.isLMBDown = (event.buttons & 1) === 1;
            this.isRMBDown = (event.buttons & 2) === 2;
        }

        // Calculate Delta
        const dx = event.clientX - this.lastMouseX;
        const dy = event.clientY - this.lastMouseY;

        // MID-ACTION FREELOOK TRANSITION: If both buttons become pressed during orbit/drag
        if (this.isLMBDown && this.isRMBDown && !this.isFreeLooking) {
            if (this.isDragging) this.endDrag();
            if (this.isOrbiting) this.endOrbit();
            this.startFreeLook();
        }

        if (this.isFreeLooking) {
            this.handleFreeLook(dx, dy);
            this.lastMouseX = event.clientX;
            this.lastMouseY = event.clientY;
        } else if (this.isOrbiting) {
            this.handleOrbit(dx, dy);
            this.lastMouseX = event.clientX;
            this.lastMouseY = event.clientY;
        } else if (this.isDragging) {
            this.handleDrag(event.clientX, event.clientY);
            // handleDrag updates lastMouseX/Y internally
        } else {
            this.lastMouseX = event.clientX;
            this.lastMouseY = event.clientY;
        }
    }

    onMouseUp(event) {
        if (event.button === 0) this.isLMBDown = false;
        if (event.button === 2) this.isRMBDown = false;

        if (this.isFreeLooking) {
            // Released one button while in FreeLook
            if (event.button === 0 && this.isRMBDown) {
                // Released LMB, RMB still down → return to Orbit
                this.endFreeLook();
                this.isOrbiting = true;
                this.isDragging = false;

                // IMPORTANT: If we transitioned from Drag -> FreeLook -> Orbit, we might lack a pivot.
                if (!this.orbitPivot) {
                    // We need a pivot. Try picking under cursor.
                    const hit = this.pickSurfacePoint(event.clientX, event.clientY);
                    if (hit) {
                        this.orbitPivot = hit;
                        this.orbitPivotNormal = hit.clone().normalize();
                        // Reset camera target pos to maintain current view but start orbiting this new pivot?
                        // Or just set pivot and let handleOrbit work? 
                        // handleOrbit expects orbitPivot to stay fixed and camera to rotate around it.
                        // If we just set it now, the next mouse move will rotate around THIS point. Correct.
                    } else {
                        // Fallback: Planet Center? Or current LookAt?
                        this.orbitPivot = new THREE.Vector3(0, 0, 0); // Fallback
                    }
                }
                return;
            } else if (event.button === 2 && this.isLMBDown) {
                // Released RMB, LMB still down → return to Drag
                this.endFreeLook();
                this.isOrbiting = false;
                this.isDragging = true;

                // CRITICAL: Set dragLastHit so LMB drag works properly
                const hit = this.pickSurfacePoint(event.clientX, event.clientY);
                if (hit) {
                    this.dragLastHit = hit;
                } else {
                    // Fallback: use current camera focus
                    this.dragLastHit = this.targetPosition.clone();
                }
                return;
            } else {
                // Released both or only one was down
                // If we were in FreeLook, and now NO buttons are down, reset.
                this.endFreeLook();
                this.isOrbiting = false;
                this.isDragging = false;
                return;
            }
        }

        // General Cleanup (failsafe)
        if (!this.isRMBDown && this.isOrbiting) this.endOrbit();
        if (!this.isLMBDown && this.isDragging) this.endDrag();
    }

    onWheel(event) {
        event.preventDefault();
        const delta = event.deltaY;

        // Chase Mode Zoom: Modify distance
        if (this.chaseTarget) {
            if (delta < 0) this.currentChaseDistance -= 1.0;
            else this.currentChaseDistance += 1.0;
            // Clamp
            this.currentChaseDistance = Math.max(2.0, Math.min(50.0, this.currentChaseDistance));
            return;
        }

        // === CINEMATIC ZOOM: Set anchor and add velocity impulse ===

        // 1. Set anchor if new gesture
        if (!this.zoomAnchor) {
            const hit = this.pickSurfacePoint(event.clientX, event.clientY);
            if (hit) {
                this.zoomAnchor = hit.clone();
                this.zoomAnchorNormal = hit.clone().normalize();
            } else {
                // Fallback: point on sphere in front of camera
                const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
                this.zoomAnchor = this.camera.position.clone().addScaledVector(forward, 100);
                this.zoomAnchorNormal = this.zoomAnchor.clone().normalize();
            }
        }

        // 2. Add impulse to velocity (separate speeds for in/out)

        // 2. Add impulse to TARGET velocity (separate speeds for in/out)

        if (delta < 0) {
            // Scroll up = Zoom IN
            this.targetZoomVelocity += this.config.zoomInImpulse;
        } else {
            // Scroll down = Zoom OUT
            this.targetZoomVelocity -= this.config.zoomOutImpulse;
        }

        // Clamp max target velocity
        this.targetZoomVelocity = Math.max(-0.5, Math.min(0.5, this.targetZoomVelocity));

        // 3. Reset timer
        if (this.zoomTimer) clearTimeout(this.zoomTimer);
        this.zoomTimer = setTimeout(() => {
            this.zoomAnchor = null;
            this.zoomAnchorNormal = null;
            this.zoomVelocity = 0;
            this.targetZoomVelocity = 0; // Reset target too
        }, this.config.zoomTimeout);
    }

    onContextMenu(event) {
        event.preventDefault();
    }

    // ===== Cinematic / UI Control =====

    /**
     * Shifts the camera projection center to account for the bottom UI panel.
     * @param {boolean} isOpen - Whether the panel is open
     */
    /**
     * Set the view offset Y directly (in pixels).
     * Called by Game.js loop to sync with UI panel.
     */
    setViewOffsetPixel(amount) {
        this.currentViewOffsetY = amount;

        if (amount > 0) {
            // Shift center UP = Shift Window DOWN (positive Y offset)
            // We use 50% of the amount to center the remaining view area
            // setViewOffset(fullWidth, fullHeight, x, y, width, height)
            const val = amount * 0.5;
            this.camera.setViewOffset(window.innerWidth, window.innerHeight, 0, val, window.innerWidth, window.innerHeight);
        } else {
            this.camera.clearViewOffset();
        }
        this.camera.updateProjectionMatrix();
    }

    // Legacy support (Deprecated by direct loop sync)
    setBottomPanelOffset(isOpen) {
        // No-op or trigger logic if needed.
        // We rely on Game.js querying the DOM now.
    }

    /**
     * Cinematic Fly-To Transition
     * 1. Lift Off (Ease Out)
     * 2. Rapid Orbit (Great Circle)
     * 3. Descend (Ease In)
     */
    flyTo(unit, onComplete) {
        this.isFlying = true;
        this.chaseTarget = null;
        this.isOrbiting = false;
        this.isDragging = false;

        // Reset manual offsets so we arrive at canonical "behind" view
        this.chaseAzimuthOffset = 0;
        this.chaseElevationOffset = 0;
        this.currentOcclusionHeight = 0; // Reset occlusion
        this.targetObstructionHeight = 0; // Also reset target

        // CRITICAL: Sync currentChaseDistance with config
        // Prevents jump when updateChaseMode takes over (it uses currentChaseDistance)
        this.currentChaseDistance = this.config.chaseDistance;

        const startPos = this.camera.position.clone();

        // --- 1. PRECISE TARGET CALCULATION (Match updateChaseMode logic) ---
        const unitPos = unit.position.clone();
        const strictUp = unitPos.clone().normalize();

        // Orthonormal Basis (matches updateChaseMode)
        const rawForward = new THREE.Vector3(0, 0, 1);
        if (unit.headingQuaternion) rawForward.applyQuaternion(unit.headingQuaternion);

        const strictRight = new THREE.Vector3().crossVectors(strictUp, rawForward).normalize();
        const strictForward = new THREE.Vector3().crossVectors(strictRight, strictUp).normalize();

        // Ideal Landing Position (Standard Chase Params)
        // Note: We ignore obstruction height for initial landing to keep it standard.
        // If it's obstructed, the chase mode will smoothly lift it AFTER arrival.
        // But to avoid snap, maybe checking it would be good? 
        // Let's stick to standard height.
        let landPos = unitPos.clone()
            .addScaledVector(strictForward, -this.currentChaseDistance)
            .addScaledVector(strictUp, this.config.chaseHeight);

        // Enforce Terrain (Crucial for snap prevention)
        landPos = this.enforceTerrainDistance(landPos);

        // --- 2. PRECISE LOOK TARGETS ---
        const startForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        const startDist = startPos.distanceTo(this.orbitPivot || unitPos);
        const startFocus = startPos.clone().addScaledVector(startForward, Math.max(10, startDist));

        // End Focus: Look at unit's base (slightly under) for better view
        const endFocus = unitPos.clone().addScaledVector(strictUp, -0.3);

        // --- 3. PRECISE UP VECTOR ---
        // Start Up (Current Camera Up)
        const startUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);

        // End Up (Match updateChaseMode: Averaged Normal)
        const unitSphereNormal = unitPos.clone().normalize();
        const unitTerrainNormal = unit.getSmoothedNormal ? unit.getSmoothedNormal() : this.planet.terrain.getNormalAt(unitPos);
        const endUp = unitSphereNormal.clone().add(unitTerrainNormal).normalize();

        const duration = 5.0; // Slower, cinematic feel (was 3.5)
        let elapsed = 0;
        console.log(`[Camera] flyTo started - duration: ${duration}s, distance: ${startPos.distanceTo(landPos).toFixed(1)}`);

        this.flyFn = (dt) => {
            elapsed += dt;
            const t = Math.min(1.0, elapsed / duration);

            // === PREMIUM EASING ===
            // Super smooth ease in/out with extended hold at ends
            // Uses quintic (power of 5) for more dramatic ease
            const easeInOutQuint = t < 0.5
                ? 16 * t * t * t * t * t
                : 1 - Math.pow(-2 * t + 2, 5) / 2;

            // Position uses QUINTIC for stronger ease-in at landing (soft arrival)
            // Power of 5 = very slow start and very slow end
            const easePosition = t < 0.5
                ? 16 * t * t * t * t * t   // Same slow start
                : 1 - Math.pow(-2 * t + 2, 6) / 2; // POWER 6 = even slower landing

            // Focus point moves smoothly with separate easing
            // USER REQUEST: POI arrives 20% EARLIER than camera
            // Map focus time to 0.8x the position time (leads by 20%)
            const focusT = Math.min(1.0, t * 1.25); // Focus completes when t = 0.8
            const easeFocus = focusT < 0.3
                ? 1.5 * focusT * focusT // Slow start
                : focusT < 0.7
                    ? 0.135 + (focusT - 0.3) * 1.825 // Linear middle (faster)
                    : 1 - 1.5 * Math.pow(1 - focusT, 2); // Slow end

            // A. POSITION: Ballistic Arc with elegant curve
            const currentPos = new THREE.Vector3().copy(startPos).lerp(landPos, easePosition);

            // Arc: HIGH arc for dramatic planet flyover
            // Longer distances = higher arc for better planet visibility
            const totalDist = startPos.distanceTo(landPos);
            const peakHeight = Math.min(totalDist * 0.8, 600.0); // Much higher arc
            // Sin curve with smooth entry/exit
            const arcT = Math.sin(easePosition * Math.PI);
            const arcOffset = arcT * peakHeight * (1 - 0.2 * easePosition); // Gradual descent

            const posUp = currentPos.clone().normalize();
            currentPos.addScaledVector(posUp, arcOffset);

            this.targetPosition.copy(currentPos);
            this.camera.position.copy(this.targetPosition);

            // B. LOOKAT TARGET: Smooth separate interpolation
            // Focus transitions smoothly from current view to unit
            const currentFocus = new THREE.Vector3().copy(startFocus).lerp(endFocus, easeFocus);

            // C. UP VECTOR: Smooth slerp
            const currentUp = new THREE.Vector3().copy(startUp).lerp(endUp, easeInOutQuint).normalize();

            // D. ORIENTATION
            const lookM = new THREE.Matrix4();
            lookM.lookAt(currentPos, currentFocus, currentUp);
            const targetQuat = new THREE.Quaternion().setFromRotationMatrix(lookM);

            // SHORTEST PATH: If dot product is negative, negate target quaternion
            // This ensures rotation is never more than 180 degrees
            if (this.camera.quaternion.dot(targetQuat) < 0) {
                targetQuat.set(-targetQuat.x, -targetQuat.y, -targetQuat.z, -targetQuat.w);
            }

            this.camera.quaternion.copy(targetQuat);
            this.targetQuaternion.copy(targetQuat);

            if (t >= 1.0) {
                if (onComplete) onComplete();
                // Ensure perfect final state
                this.targetPosition.copy(landPos);
                this.camera.position.copy(landPos);

                // Final Look Matrix
                lookM.lookAt(landPos, endFocus, endUp);
                targetQuat.setFromRotationMatrix(lookM);
                this.camera.quaternion.copy(targetQuat);
                this.targetQuaternion.copy(targetQuat);

                // Set cooldown to skip occlusion check immediately after landing
                this.postFlyToCooldown = 1.0; // 1 second cooldown

                return true;
            }
            return false;
        };
    }

    // ===== Logic Implementations =====

    // --- Free Look ---
    startFreeLook() {
        this.isFreeLooking = true;
        this.isOrbiting = false;
        this.isDragging = false;
        this.domElement.style.cursor = 'move';
    }

    endFreeLook() {
        this.isFreeLooking = false;
        this.domElement.style.cursor = 'default';
    }

    handleFreeLook(dx, dy) {
        const sensitivity = this.config.freeLookSensitivity;

        // === SMOOTH FREE LOOK (Delta-Based, Target-Based) ===
        // Goal: Smooth rotation with ease-in/ease-out, position fixed.

        // Use TARGET quaternion for stable reference frame
        const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.targetQuaternion).normalize();
        const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.targetQuaternion).normalize();

        // Yaw: Rotate around Up
        const qYaw = new THREE.Quaternion().setFromAxisAngle(camUp, -dx * sensitivity);

        // Pitch: Rotate around Right
        const qPitch = new THREE.Quaternion().setFromAxisAngle(camRight, -dy * sensitivity);

        // Combined rotation
        const qRot = new THREE.Quaternion().multiplyQuaternions(qYaw, qPitch);

        // Calculate new target quaternion
        const newQuat = this.targetQuaternion.clone().premultiply(qRot).normalize();

        // Pitch Clamp check (relative to planet up)
        const planetUp = this.targetPosition.clone().normalize();
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(newQuat);
        const dot = forward.dot(planetUp);
        const angle = Math.asin(dot);

        if (angle < this.config.minPitch || angle > this.config.maxPitch) {
            // Apply only Yaw if pitch is OOB
            this.targetQuaternion.premultiply(qYaw).normalize();
        } else {
            this.targetQuaternion.copy(newQuat);
        }

        // Position stays fixed (no update to targetPosition)
        // Camera update happens in update()
    }

    // --- Orbit ---
    startOrbit(hitPoint) {
        this.isOrbiting = true;
        this.orbitPivot = hitPoint.clone();
        this.domElement.style.cursor = 'crosshair';

        // NEW: Capture Surface Normal for Alignment
        this.orbitPivotNormal = this.planet.terrain.getNormalAt(hitPoint);
        this.orbitAlignWeight = 0; // Reset easing
    }

    endOrbit() {
        this.isOrbiting = false;
        this.orbitPivot = null;
        this.orbitPivotNormal = null;
        this.domElement.style.cursor = 'default';
    }

    updateOrbitAlignment(dt) {
        // Align camera "up" to planet surface normal at pivot
        // Rotation happens around the CAMERA-TO-PIVOT axis (view direction)
        // This keeps the raycast point fixed on screen
        if (!this.orbitPivot) return;

        // 1. Get Camera Frame
        const camQuat = this.targetQuaternion.clone();
        const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camQuat);

        // 2. View direction = Camera to Pivot (this is our rotation axis)
        const viewDir = new THREE.Vector3().subVectors(this.orbitPivot, this.targetPosition).normalize();

        // 3. Target Up = Planet surface normal at pivot
        const targetNormal = this.orbitPivot.clone().normalize();

        // If looking straight down/up at pivot, can't align
        const dot = viewDir.dot(targetNormal);
        if (Math.abs(dot) > 0.99) return;

        // 4. Project target normal onto plane perpendicular to view direction
        // This gives us the "ideal" up direction when looking at the pivot
        const projectedUp = targetNormal.clone()
            .sub(viewDir.clone().multiplyScalar(dot))
            .normalize();

        // 5. Calculate roll angle needed
        // We need to rotate camUp towards projectedUp around viewDir axis
        const currentRight = new THREE.Vector3().crossVectors(camUp, viewDir).normalize();
        const targetRight = new THREE.Vector3().crossVectors(projectedUp, viewDir).normalize();

        // Angle between current and target right vectors
        let angle = currentRight.angleTo(targetRight);

        // Determine sign of angle
        const cross = new THREE.Vector3().crossVectors(currentRight, targetRight);
        if (cross.dot(viewDir) < 0) angle = -angle;

        // 6. Apply roll rotation around view direction (camera-to-pivot axis)
        // EASE IN/OUT: Slower near start and end, faster in middle
        const absAngle = Math.abs(angle);
        const maxAngle = Math.PI; // Maximum possible misalignment

        // Normalize angle to 0-1 range for easing
        const t = Math.min(1.0, absAngle / (maxAngle * 0.5));

        // Smooth ease-in-out curve (cubic)
        const easeInOut = t < 0.5
            ? 4 * t * t * t
            : 1 - Math.pow(-2 * t + 2, 3) / 2;

        // Alignment speed with easing (from config)
        const baseSpeed = this.config.orbitAlignmentSpeed;
        const alpha = Math.min(1.0, dt * baseSpeed * (0.3 + 0.7 * easeInOut));
        const rollAmount = angle * alpha;

        const rollQuat = new THREE.Quaternion().setFromAxisAngle(viewDir, rollAmount);
        this.targetQuaternion.premultiply(rollQuat).normalize();
    }

    handleOrbit(dx, dy) {
        if (this.chaseTarget) {
            // RELATIVE ORBIT for chase mode
            const sensitivity = this.config.orbitSensitivity;
            this.chaseAzimuthOffset -= dx * sensitivity;
            this.chaseElevationOffset += dy * sensitivity;
            this.chaseElevationOffset = Math.max(-1.0, Math.min(1.0, this.chaseElevationOffset));
        } else {
            if (!this.orbitPivot) return;
            const sensitivity = this.config.orbitSensitivity;

            // === SCREEN-SPACE ORBIT ===
            // The pivot point stays FIXED on screen.
            // Camera moves on an orbital path around the pivot.
            // Axes are the SCREEN horizontal and vertical directions passing through pivot.

            // Get camera's screen-space axes
            // Camera Right = Screen Horizontal (X-axis movement)
            // Camera Up = Screen Vertical (Y-axis movement)
            const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion).normalize();
            const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion).normalize();

            // Vector from pivot to camera
            const pivotToCam = new THREE.Vector3().subVectors(this.targetPosition, this.orbitPivot);
            const distance = pivotToCam.length();

            // Create rotation quaternions
            // Horizontal mouse movement (dx) -> rotate around screen UP axis (camUp)
            const qHorizontal = new THREE.Quaternion().setFromAxisAngle(camUp, -dx * sensitivity);

            // Vertical mouse movement (dy) -> rotate around screen RIGHT axis (camRight)
            // Drag down (+dy) should move camera UP on the orbital sphere
            const qVertical = new THREE.Quaternion().setFromAxisAngle(camRight, -dy * sensitivity);

            // Combine rotations
            const qCombined = new THREE.Quaternion().multiplyQuaternions(qHorizontal, qVertical);

            // Apply rotation to the pivot-to-camera vector
            pivotToCam.applyQuaternion(qCombined);

            // Calculate new camera position
            const newCamPos = this.orbitPivot.clone().add(pivotToCam);

            // Pitch limit check - don't let camera go underground
            const pivotNormal = this.orbitPivot.clone().normalize();
            const newDir = pivotToCam.clone().normalize();
            const angle = newDir.angleTo(pivotNormal);

            // Limit: 5° from top, 85° from horizon (don't go underground)
            const minAngle = THREE.MathUtils.degToRad(5);
            const maxAngle = THREE.MathUtils.degToRad(88);

            if (angle >= minAngle && angle <= maxAngle) {
                // Apply the new position
                this.targetPosition.copy(newCamPos);

                // CRITICAL: Rotate camera orientation by the SAME quaternion as position
                // This keeps the pivot point at the exact same screen location
                this.targetQuaternion.premultiply(qCombined).normalize();
            }
        }
    }

    // --- Drag ---
    startDrag(hitPoint) {
        this.isDragging = true;
        this.dragLastHit = hitPoint.clone(); // Initial hit
        this.domElement.style.cursor = 'grabbing';
    }

    endDrag() {
        this.isDragging = false;
        this.dragLastHit = null;
        this.domElement.style.cursor = 'default';
    }

    handleDrag(mouseX, mouseY) {
        if (!this.dragLastHit) return;

        // === PURE TRANSLATION DRAG ===
        // Goal: Move the entire view (camera) in the opposite direction of drag
        // NO ROTATION - just translate camera position
        // This is like Google Maps drag - you're sliding the map under your finger

        const dx = mouseX - this.lastMouseX;
        const dy = mouseY - this.lastMouseY;

        if (dx === 0 && dy === 0) return;

        // Calculate pan speed based on distance and FOV (1:1 feel)
        const dist = this.camera.position.distanceTo(this.dragLastHit);
        const fovRad = THREE.MathUtils.degToRad(this.camera.fov);
        const viewHeightWorld = 2.0 * dist * Math.tan(fovRad * 0.5);
        const panSpeed = viewHeightWorld / window.innerHeight;

        // Get camera local axes from target quaternion
        const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.targetQuaternion);
        const camUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.targetQuaternion);

        // Calculate world movement vector (opposite of drag direction)
        // Drag right → camera moves left (view slides right)
        const worldMove = new THREE.Vector3();
        worldMove.addScaledVector(camRight, -dx * panSpeed);
        worldMove.addScaledVector(camUp, dy * panSpeed);

        // Apply PURE translation to camera position - NO rotation
        this.targetPosition.add(worldMove);

        // NO rotation applied - camera orientation stays the same
        // This makes it feel like dragging a map, not rotating the globe

        this.lastMouseX = mouseX;
        this.lastMouseY = mouseY;
    }

    // ===== Helpers =====

    /**
     * Finds the surface point under screen coordinates.
     * If ray misses, finds the CLOSEST point on the planet horizon.
     */
    pickSurfacePoint(mouseX, mouseY) {
        const rect = this.domElement.getBoundingClientRect();
        const ndcX = ((mouseX - rect.left) / rect.width) * 2 - 1;
        const ndcY = -((mouseY - rect.top) / rect.height) * 2 + 1;
        const mouseNDC = new THREE.Vector2(ndcX, ndcY);

        this.raycaster.setFromCamera(mouseNDC, this.camera);

        const intersects = this.raycaster.intersectObject(this.planet.mesh, false);
        console.log('pickSurfacePoint:', {
            intersectsCount: intersects.length,
            firstHit: intersects[0] ? intersects[0].point.toArray() : null,
            firstDistance: intersects[0] ? intersects[0].distance : null,
            cameraPos: this.camera.position.toArray()
        });
        if (intersects.length > 0) return intersects[0].point.clone();

        // --- Off-Planet Logic (Horizon Point) ---
        // Find intersection of the line from Camera to PlanetCenter with the Sphere?
        // No, user said: "intersection of line from CURSOR to CENTER".
        // Use the Ray. 
        // We want the point on the sphere surface that is "closest" to the ray.

        const ray = this.raycaster.ray;
        const sphereCenter = new THREE.Vector3(0, 0, 0);
        const radius = this.planet.terrain.params.radius; // Base radius

        // 1. Closest Point on Ray to Center
        const closestOnRay = new THREE.Vector3();
        ray.closestPointToPoint(sphereCenter, closestOnRay);

        // 2. Project that point onto the sphere
        // Vector from Center to ClosestOnRay
        const dir = new THREE.Vector3().subVectors(closestOnRay, sphereCenter);

        // If ray passes perfectly through center (unlikely), fallback to ray direction
        if (dir.lengthSq() < 0.0001) {
            dir.copy(ray.direction).negate(); // Towards camera?
        }

        dir.normalize();

        // 3. Point on Surface
        const surfacePoint = sphereCenter.clone().addScaledVector(dir, radius);

        return surfacePoint;
    }

    checkObstruction(unitPos, cameraPos) {
        // Check if line of sight from unit to camera is blocked by terrain OR rocks
        const dir = cameraPos.clone().sub(unitPos);
        const dist = dir.length();
        dir.normalize();

        // Offset start slightly to avoid self-collision with unit ground
        const start = unitPos.clone().add(dir.clone().multiplyScalar(1.0));

        this.raycaster.set(start, dir);

        // 1. Check terrain
        const terrainHits = this.raycaster.intersectObject(this.planet.mesh, false);
        if (terrainHits.length > 0 && terrainHits[0].distance < dist - 1.0) {
            return true; // Blocked by terrain
        }

        // 2. Check rocks (if available)
        if (this.planet.rockSystem && this.planet.rockSystem.rocks) {
            for (const rock of this.planet.rockSystem.rocks) {
                const rockHits = this.raycaster.intersectObject(rock, false);
                if (rockHits.length > 0 && rockHits[0].distance < dist - 0.5) {
                    return true; // Blocked by rock
                }
            }
        }

        return false; // Clear line of sight
    }
    /**
     * Set a target unit to chase.
     */
    setChaseTarget(unit) {
        const wasNull = this.chaseTarget === null;
        this.chaseTarget = unit;

        if (unit && wasNull) {
            // Starting to chase - initialize balloon drift state
            this.lastUnitPosition = unit.position.clone();
            this.unitWasStationary = true;
            this.balloonDriftTimer = 0;

            // Initialize obstruction check state
            this.lastObstructionCheck = 0; // Force immediate check
            this.lastObstructionCheckPos = unit.position.clone();
            this.targetObstructionHeight = 0;
            this.currentObstructionHeight = 0;
        }
    }

    /**
     * Updates camera target position/rotation to follow the chase target.
     */
    updateChaseMode() {
        // DEBUG: Confirm this function is called
        console.log("[UCM START]", { hasChaseTarget: !!this.chaseTarget });

        if (!this.chaseTarget) return;

        const unit = this.chaseTarget;
        // DEBUG: Check for early return
        console.log("[UCM UNIT]", { hasHeadingQuat: !!unit.headingQuaternion, unitName: unit.name });

        // Ensure unit has headingQuaternion
        if (!unit.headingQuaternion) return;

        // Logic 1s check (User Request)
        // Logic 1s check OR Distance check
        const now = performance.now();

        // DEBUG: Check throttle conditions
        const timeSinceLastCheck = now - (this.lastObstructionCheck || 0);
        console.log("[OBSTRUCTION THROTTLE]", {
            cooldown: this.postFlyToCooldown,
            timeSinceLastCheck: timeSinceLastCheck,
            willRun: timeSinceLastCheck > 500 && !(this.postFlyToCooldown > 0)
        });

        // Skip occlusion check during post-flyTo cooldown
        if (this.postFlyToCooldown && this.postFlyToCooldown > 0) {
            this.postFlyToCooldown -= 0.016;
            // During cooldown, keep obstruction at 0
            this.targetObstructionHeight = 0;
        } else if (now - (this.lastObstructionCheck || 0) > 500) {
            // Check every 500ms REGARDLESS of unit movement
            // This ensures camera rises even when unit is stationary but occluded
            this.lastObstructionCheck = now;
            this.lastObstructionCheckPos.copy(unit.position);

            // Iterative "Find Clear Height"
            const testOffsets = [0, 5, 10, 15, 20];

            const rawForward = new THREE.Vector3(0, 0, 1).applyQuaternion(unit.headingQuaternion);
            const strictUp = unit.position.clone().normalize();
            const strictRight = new THREE.Vector3().crossVectors(strictUp, rawForward).normalize();
            const strictForward = new THREE.Vector3().crossVectors(strictRight, strictUp).normalize();

            let foundClear = false;
            let clearOffset = 0;

            for (let hOffset of testOffsets) {
                const testTotalHeight = this.config.chaseHeight + hOffset;
                const testOffset = strictForward.clone().multiplyScalar(-this.currentChaseDistance)
                    .add(strictUp.clone().multiplyScalar(testTotalHeight));
                const testPos = unit.position.clone().add(testOffset);

                if (!this.checkObstruction(unit.position, testPos)) {
                    clearOffset = hOffset;
                    foundClear = true;
                    break;
                }
            }

            this.targetObstructionHeight = foundClear ? clearOffset : 20.0;

            // DEBUG: Log obstruction detection
            console.log("[OBSTRUCTION]", {
                foundClear,
                clearOffset,
                target: this.targetObstructionHeight,
                current: this.currentObstructionHeight
            });
        }

        // Smooth obstruction height with ease-out/ease-in curves
        // Rising: ease-out (fast start, slow approach) for responsive obstacle avoidance
        // Descending: ease-in (slow start, fast at end) for smooth settling
        const heightDiff = Math.abs(this.targetObstructionHeight - this.currentObstructionHeight);
        const isRising = this.targetObstructionHeight > this.currentObstructionHeight;

        // Larger difference = faster movement (exponential approach)
        const baseLerpFactor = isRising ? 0.06 : 0.02;
        const speedBoost = Math.min(heightDiff / 10.0, 1.0) * 0.04; // Extra speed for large differences
        const obstructionLerpFactor = baseLerpFactor + speedBoost;

        this.currentObstructionHeight = THREE.MathUtils.lerp(
            this.currentObstructionHeight,
            this.targetObstructionHeight,
            obstructionLerpFactor
        );

        // Recalculate basis (clean) for final positioning
        const rawForward = new THREE.Vector3(0, 0, 1).applyQuaternion(unit.headingQuaternion);
        const strictUp = unit.position.clone().normalize();
        const strictRight = new THREE.Vector3().crossVectors(strictUp, rawForward).normalize();
        const strictForward = new THREE.Vector3().crossVectors(strictRight, strictUp).normalize();

        // Ideal Position: Behind and Above
        // Behind = -Forward
        // Above = +Up (Sphere Normal)
        const totalHeight = this.config.chaseHeight + this.currentObstructionHeight;

        // Base Offset (No Rotation)
        // Base Offset (No Rotation)
        const baseOffset = strictForward.clone().multiplyScalar(-this.currentChaseDistance)
            .add(strictUp.clone().multiplyScalar(totalHeight));

        // === BALLOON DRIFT LOGIC (Smart Auto-Align) ===
        // Requirement: "Starts getting moving -> Camera slowly aligns behind"

        const isMoving = this.lastUnitPosition ?
            unit.position.distanceTo(this.lastUnitPosition) > 0.01 : false;

        if (isMoving) {
            if (this.unitWasStationary) {
                this.unitWasStationary = false;
                this.balloonDriftTimer = 0;
            }

            this.balloonDriftTimer += 0.016; // dt approximation

            // Only drift if NOT mechanically overridden
            if (!this.isOrbiting && !this.isFreeLooking) {
                // Ease-In-Out drift towards 0 (Back view)
                // Use a stronger factor for "Noticeable" alignment
                const driftStrength = 0.01; // 1% per frame linear? No, lerp.

                // If Azimuth is Large, drift faster?
                // User wants "Slowly stand behind".

                // Simple exponential decay towards 0 (back view)
                this.chaseAzimuthOffset = THREE.MathUtils.lerp(this.chaseAzimuthOffset, 0, 0.01);

                // Also drift ELEVATION towards ideal 3rd-person view
                // Ideal elevation: slightly above (0.3 = ~17 degrees up from behind)
                // This ensures horizon is visible above unit
                const idealElevation = 0.3;
                this.chaseElevationOffset = THREE.MathUtils.lerp(this.chaseElevationOffset, idealElevation, 0.01);
            }
        } else {
            this.unitWasStationary = true;
            this.balloonDriftTimer = 0;
        }

        // Update last position
        if (this.lastUnitPosition) {
            this.lastUnitPosition.copy(unit.position);
        } else {
            this.lastUnitPosition = unit.position.clone();
        }

        // Apply Relative Orbit Rotation (Azimuth/Elevation)
        // Azimuth: Rotate around Up
        baseOffset.applyAxisAngle(strictUp, this.chaseAzimuthOffset);

        // Elevation: Rotate around Transformed Right
        // We need the Right vector relative to the NEW forward.
        const rotatedForward = strictForward.clone().applyAxisAngle(strictUp, this.chaseAzimuthOffset);
        const rotatedRight = new THREE.Vector3().crossVectors(strictUp, rotatedForward).normalize();
        baseOffset.applyAxisAngle(rotatedRight, this.chaseElevationOffset);

        const idealPos = unit.position.clone().add(baseOffset);

        // Update Target (Let existing update() handle lerp)
        this.targetPosition.copy(idealPos);

        // Enforce terrain
        this.enforceTerrainDistance(this.targetPosition);

        // Look At: Unit Position slightly below for better view
        // Must match flyTo endFocus to prevent jerk when transitioning
        const lookTarget = unit.position.clone().add(strictUp.clone().multiplyScalar(-0.3));

        const lookMatrix = new THREE.Matrix4();
        // Up vector: AVERAGE of sphere normal + terrain normal
        // This provides stability (sphere) while respecting terrain tilt (terrain)
        const unitSphereNormal = unit.position.clone().normalize();
        const unitTerrainNormal = unit.getSmoothedNormal ? unit.getSmoothedNormal() : this.planet.terrain.getNormalAt(unit.position);
        const safeUp = unitSphereNormal.clone().add(unitTerrainNormal).normalize();

        lookMatrix.lookAt(this.targetPosition, lookTarget, safeUp);

        this.targetQuaternion.setFromRotationMatrix(lookMatrix);
    }
}
