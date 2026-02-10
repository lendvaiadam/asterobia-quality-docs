import * as THREE from 'three';

export class CameraControls {
    constructor(camera, domElement, planet) {
        this.camera = camera;
        this.domElement = domElement;
        this.planet = planet;

        // Configuration
        this.minAltitude = 2.0;
        this.maxAltitude = 200.0;
        this.zoomSpeed = 0.5;
        this.rotateSpeed = 0.005;
        this.dampingFactor = 0.1;

        // State (Pivot-based)
        // Pivot is the point on the planet surface we are looking at.
        this.pivot = new THREE.Vector3(0, 0, planet.terrain.params.radius); 
        this.radius = 100.0; // Distance from pivot to camera
        this.heading = 0.0; // Yaw (radians)
        this.pitch = -Math.PI / 4; // Tilt (radians), -90 deg is top down

        // Target State for Damping
        this.targetPivot = this.pivot.clone();
        this.targetRadius = this.radius;
        this.targetHeading = this.heading;
        this.targetPitch = this.pitch;

        // Input State
        this.isDragging = false;
        this.dragStartPoint = new THREE.Vector3(); // Point on sphere where drag started
        this.dragStartPivot = new THREE.Vector3(); // Pivot when drag started
        this.dragStartHeading = 0;
        this.dragStartPitch = 0;
        this.lastMouseX = 0;
        this.lastMouseY = 0;
        this.dragButton = -1; // 0: LMB, 2: RMB

        // Raycasting
        this.raycaster = new THREE.Raycaster();
        
        // Bind events
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

        // Initialize
        this.updateCameraPosition(true); // Force snap
    }

    // Helper: Get point on sphere under mouse
    getSpherePoint(clientX, clientY) {
        const rect = this.domElement.getBoundingClientRect();
        const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
        const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
        
        // Intersect with a mathematical sphere for smooth navigation
        // We use the radius at the PIVOT for consistency during a drag, 
        // or the planet radius + average height?
        // Let's use the planet radius + pivot height.
        const pivotDist = this.targetPivot.length();
        const sphere = new THREE.Sphere(new THREE.Vector3(0,0,0), pivotDist);
        const target = new THREE.Vector3();
        
        if (this.raycaster.ray.intersectSphere(sphere, target)) {
            return target;
        }
        return null;
    }

    onMouseDown(event) {
        this.isDragging = true;
        this.dragButton = event.button;
        this.lastMouseX = event.clientX;
        this.lastMouseY = event.clientY;

        if (this.dragButton === 0) { // LMB: Pan (Grab)
            const hit = this.getSpherePoint(event.clientX, event.clientY);
            if (hit) {
                this.dragStartPoint.copy(hit);
                this.dragStartPivot.copy(this.targetPivot);
            } else {
                // Missed planet, maybe fallback to rotation or ignore?
                this.isDragging = false;
            }
        } else if (this.dragButton === 2) { // RMB: Orbit
            this.dragStartHeading = this.targetHeading;
            this.dragStartPitch = this.targetPitch;
        }
    }

    onMouseMove(event) {
        if (!this.isDragging) return;

        if (this.dragButton === 0) { // LMB: Pan (Grab)
            const currentHit = this.getSpherePoint(event.clientX, event.clientY);
            if (currentHit) {
                // We want to rotate the world such that dragStartPoint moves to currentHit.
                // Equivalently, we rotate the CAMERA and PIVOT by the inverse.
                // Rotation from Current to Start.
                const q = new THREE.Quaternion().setFromUnitVectors(currentHit.clone().normalize(), this.dragStartPoint.clone().normalize());
                
                // Apply this rotation to the Pivot
                this.targetPivot.copy(this.dragStartPivot).applyQuaternion(q);
                
                // Note: We don't change Heading/Pitch here, they are relative to the Pivot's local frame.
                // However, moving the pivot changes the local frame.
                // To keep the view consistent (North stays North relative to screen), we might need to adjust heading?
                // For now, let's try simple pivot rotation.
            }
        } else if (this.dragButton === 2) { // RMB: Orbit
            const deltaX = event.clientX - this.lastMouseX;
            const deltaY = event.clientY - this.lastMouseY;

            // Check deadzone (optional, user asked for it)
            // But if we already started dragging, we ignore deadzone?
            // Let's implement deadzone check only on start? 
            // User said: "A középső területen legyen egy kis kerek rész, egy vakfolt, ahol nem működik a forgatás."
            // This implies we shouldn't even start rotating if clicked there.
            // But here we are in MouseMove.
            
            this.targetHeading = this.dragStartHeading - deltaX * this.rotateSpeed;
            this.targetPitch = this.dragStartPitch - deltaY * this.rotateSpeed;

            // Clamp Pitch with dynamic upper limit based on altitude
            // -90 deg (-PI/2) is top down. 0 is horizon.
            // When close to planet, restrict more; when far, allow more horizontal.
            const maxPitch = this.getMaxPitch();
            this.targetPitch = Math.max(-Math.PI / 2 + 0.1, Math.min(maxPitch, this.targetPitch));
        }
    }

    onMouseUp(event) {
        this.isDragging = false;
        this.dragButton = -1;
    }

    onWheel(event) {
        event.preventDefault();
        
        // Zoom towards cursor
        // 1. Raycast to find point under cursor
        const hit = this.getSpherePoint(event.clientX, event.clientY);
        
        const zoomFactor = 1.0 + Math.abs(event.deltaY * 0.001 * this.zoomSpeed);
        const zoomingIn = event.deltaY < 0;

        if (zoomingIn) {
            this.targetRadius /= zoomFactor;
            
            // Move pivot towards cursor hit to keep it centered?
            // Google Earth style: The point under cursor stays under cursor.
            // This is complex math. 
            // Simplified: Move pivot partially towards hit point.
            if (hit) {
                // Interpolate pivot towards hit point
                const t = 0.1; // Amount to move towards cursor
                // Rotate pivot towards hit
                const q = new THREE.Quaternion().setFromUnitVectors(this.targetPivot.clone().normalize(), hit.clone().normalize());
                // Scale rotation by t? Slerp?
                // Easier: Slerp vectors
                const newPivotDir = this.targetPivot.clone().normalize().lerp(hit.clone().normalize(), t).normalize();
                this.targetPivot.copy(newPivotDir.multiplyScalar(this.targetPivot.length()));
            }
        } else {
            this.targetRadius *= zoomFactor;
        }

        // Clamp Radius (Altitude)
        // We need terrain height at pivot to know altitude
        const terrainH = this.planet.terrain.getRadiusAt(this.targetPivot.clone().normalize());
        const minR = terrainH + this.minAltitude;
        const maxR = terrainH + this.maxAltitude;
        
        this.targetRadius = Math.max(minR, Math.min(maxR, this.targetRadius));
    }

    onContextMenu(event) {
        event.preventDefault();
    }

    // Dynamic pitch upper limit based on altitude.
    // Close to ground (small radius) -> more restricted (more top-down).
    // Far out (large radius) -> more freedom to look horizontally.
    // Returns the maximum (least negative) pitch allowed.
    getMaxPitch() {
        const altFraction = Math.min(1.0, Math.max(0.0,
            (this.targetRadius - this.minAltitude) / (this.maxAltitude - this.minAltitude)
        ));
        // At max altitude (altFraction=1): allow up to -0.15 (nearly horizontal)
        // At min altitude (altFraction=0): restrict to -0.45 (about 26 degrees from horizon)
        return -0.15 - (1.0 - altFraction) * 0.3;
    }

    update() {
        // Damping
        const dt = this.dampingFactor;
        
        // Slerp Pivot (it's a vector on sphere)
        // We normalize to ensure it stays on sphere (or correct height)
        // Actually pivot length might change if we support terrain following?
        // For now assume pivot is on a reference sphere, we get height later.
        
        // Interpolate Pivot Direction
        const currentDir = this.pivot.clone().normalize();
        const targetDir = this.targetPivot.clone().normalize();
        currentDir.lerp(targetDir, dt).normalize();
        
        // Interpolate Pivot Height (Terrain following)
        const targetH = this.planet.terrain.getRadiusAt(targetDir);
        const currentH = this.pivot.length();
        const nextH = currentH + (targetH - currentH) * dt;
        
        this.pivot.copy(currentDir.multiplyScalar(nextH));
        
        // Lerp Scalars
        this.radius += (this.targetRadius - this.radius) * dt;
        this.heading += (this.targetHeading - this.heading) * dt;
        this.pitch += (this.targetPitch - this.pitch) * dt;

        // Safety: re-clamp pitch after damping in case zoom changed altitude
        const maxPitch = this.getMaxPitch();
        if (this.targetPitch > maxPitch) {
            this.targetPitch = maxPitch;
        }
        if (this.pitch > maxPitch) {
            this.pitch = maxPitch;
        }

        this.updateCameraPosition();
    }

    updateCameraPosition(force = false) {
        if (force) {
            this.pivot.copy(this.targetPivot);
            this.radius = this.targetRadius;
            this.heading = this.targetHeading;
            this.pitch = this.targetPitch;
        }

        // Calculate Local Frame at Pivot
        const up = this.pivot.clone().normalize();
        
        // Calculate East (Right)
        // Handle pole singularity: if Up is close to Y, use Z as temp
        let tempUp = new THREE.Vector3(0, 1, 0);
        if (Math.abs(up.dot(tempUp)) > 0.99) {
            tempUp.set(0, 0, 1);
        }
        const right = new THREE.Vector3().crossVectors(tempUp, up).normalize();
        const north = new THREE.Vector3().crossVectors(up, right).normalize();

        // Construct Rotation
        // 1. Pitch (around Right)
        // 2. Heading (around Up)
        
        const qPitch = new THREE.Quaternion().setFromAxisAngle(right, this.pitch);
        const qHeading = new THREE.Quaternion().setFromAxisAngle(up, this.heading);
        const qRot = new THREE.Quaternion().multiplyQuaternions(qHeading, qPitch);

        // Camera Offset
        // Start with vector (0, 0, radius) if we were looking down Z?
        // No, in our frame:
        // We want to look at Pivot.
        // If Pitch is -90 (top down), Camera should be at Pivot + Up * Radius.
        // If Pitch is 0 (horizon), Camera should be at Pivot + South * Radius?
        
        // Let's define offset in local basis:
        // At pitch 0, heading 0: Camera is at -North * Radius? (Looking North)
        // At pitch -90: Camera is at Up * Radius.
        
        // Easier: Rotate the vector (0, 0, 1) * Radius?
        // Let's use a local vector `v` = (0, 0, radius)
        // Rotate `v` by pitch around X axis?
        
        // Let's do it vectorially:
        // Offset direction starts as UP.
        // Rotate by (90 + Pitch) around Right? 
        // Pitch is -90..0. 
        // If Pitch = -90, Angle = 0. Offset = Up.
        // If Pitch = 0, Angle = 90. Offset = South (Back).
        
        const offsetDir = up.clone();
        offsetDir.applyAxisAngle(right, this.pitch + Math.PI / 2);
        
        // Apply Heading?
        // Actually, we constructed qRot above. Let's use that.
        // But qRot combines Heading (around Up) and Pitch (around Right).
        // If we apply qRot to what?
        
        // Let's try:
        // Camera Position = Pivot + (Rotation * (0, 0, Radius))?
        // We need to align the rotation to the local frame.
        
        // Alternative:
        // Camera Position = Pivot + (Up * sin(pitch) + South * cos(pitch)) * Radius?
        // And then rotate that vector around Up by Heading.
        
        // Pitch is -90 (Top down) to 0 (Horizon).
        // Elevation angle = -Pitch (90 to 0).
        // Let phi = -pitch (90 to 0).
        // vertical component = sin(phi) = sin(-pitch) = -sin(pitch)? 
        // No, pitch is negative. -pitch is positive.
        // If pitch is -90, -pitch=90. sin(90)=1. Up component is 1. Correct.
        
        // horizontal component = cos(phi) = cos(-pitch).
        // If pitch is -90, cos(90)=0. Horizontal is 0. Correct.
        
        const phi = -this.pitch;
        const vUp = Math.sin(phi);
        const vHoriz = Math.cos(phi);
        
        // Horizontal direction: South rotated by Heading.
        // North is `north`. South is `-north`.
        // Rotate South by Heading around Up.
        const south = north.clone().negate();
        south.applyAxisAngle(up, this.heading);
        
        const offset = new THREE.Vector3()
            .addScaledVector(up, vUp)
            .addScaledVector(south, vHoriz)
            .multiplyScalar(this.radius);
            
        this.camera.position.copy(this.pivot).add(offset);
        this.camera.lookAt(this.pivot);
        
        // Sync Up vector to avoid roll
        // The camera's local up should be roughly the planet up, but tilted?
        // lookAt handles the forward vector. We just need to provide a stable up.
        // Planet Up is good enough usually, unless looking straight down.
        // If looking straight down, Up is North?
        this.camera.up.copy(up);
        
        // If we are looking straight down (pitch ~ -90), camera.up (Planet Up) is parallel to lookDir (Planet Down).
        // This causes instability.
        // In that case, we should set camera.up to North (rotated by heading).
        if (this.pitch < -Math.PI/2 + 0.01) {
             const northRot = north.clone().applyAxisAngle(up, this.heading);
             this.camera.up.copy(northRot);
        }
    }
}
