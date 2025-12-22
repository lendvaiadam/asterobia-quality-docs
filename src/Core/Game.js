import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Planet } from '../World/Planet.js';
import { SphericalCameraController4 } from '../Camera/SphericalCameraController4.js';
import { Unit } from '../Entities/Unit.js';
import { DebugPanel } from '../UI/DebugPanel.js';
import { Input } from './Input.js';
import { FogOfWar } from '../World/FogOfWar.js';
import { TextureDebugger } from '../UI/TextureDebugger.js';

import { CameraDebug } from '../UI/CameraDebug.js';
import { InteractionManager } from './InteractionManager.js';
import { RockSystem } from '../World/RockSystem.js';
import { RockDebug } from '../UI/RockDebug.js';
import { SphericalNavMesh } from '../Navigation/SphericalNavMesh.js';
import { NavMeshDebug } from '../UI/NavMeshDebug.js';
import { RockCollisionSystem } from '../Physics/RockCollisionSystem.js';
import { AudioManager } from './AudioManager.js';

export class Game {
    constructor() {
        window.game = this; // Expose for UI interactions
        this.container = document.body;

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.container.appendChild(this.renderer.domElement);

        // Scene
        this.scene = new THREE.Scene();

        // Starfield
        this.starDistance = 500; // Distance to stars from origin

        const starGeometry = new THREE.BufferGeometry();
        const starCount = 10000;
        const positions = new Float32Array(starCount * 3);

        for (let i = 0; i < starCount; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const r = this.starDistance;

            positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            positions[i * 3 + 2] = r * Math.cos(phi);
        }

        starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const starMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 1.5 });
        this.stars = new THREE.Points(starGeometry, starMaterial);
        this.scene.add(this.stars);

        // Log star sizing info with adjustment instructions
        console.log("=== STAR PARAMETERS ===");
        console.log("Location: Planet.js water shader (~line 97-115)");
        console.log("Grid Size: 100x100 (starUV * 100.0)");
        console.log("Star Density: 15% (cellHash > 0.85) - lower = more stars");
        console.log("Star Size: 0.08 - 0.13");
        console.log("");
        console.log("TO ADJUST DENSITY: Edit 'cellHash > 0.85' value in Planet.js");
        console.log("  0.50 = 50% dense, 0.85 = 15% dense, 0.95 = 5% sparse");

        // Camera
        this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);

        // LIGHTING SETUP
        // Increased ambient light for better visibility in shadow (was 0.15)
        // Increased ambient light for better visibility in shadow (was 0.15)
        this.ambientLight = new THREE.AmbientLight(0x405060, 0.6);
        this.scene.add(this.ambientLight);

        // Hemisphere Light: Subtle sky/ground color difference
        const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x444422, 0.2);
        this.scene.add(hemiLight);

        // Main Sun Light - slightly brighter (was 2.0)
        const sunLight = new THREE.DirectionalLight(0xfffaf0, 2.3); // Warm white
        sunLight.position.set(400, 0, 0); // Pure side = exact 50/50 light/shadow
        sunLight.castShadow = true;
        sunLight.shadow.mapSize.width = 4096;
        sunLight.shadow.mapSize.height = 4096;
        sunLight.shadow.camera.near = 50;
        sunLight.shadow.camera.far = 600;
        // Shadow frustum size - adjustable via debug panel
        this.shadowDistance = 150;
        sunLight.shadow.camera.left = -this.shadowDistance;
        sunLight.shadow.camera.right = this.shadowDistance;
        sunLight.shadow.camera.top = this.shadowDistance;
        sunLight.shadow.camera.bottom = -this.shadowDistance;
        sunLight.shadow.bias = -0.0001;
        sunLight.shadow.camera.updateProjectionMatrix(); // CRITICAL: Apply shadow camera settings
        this.sunLight = sunLight;
        this.scene.add(sunLight);
        // CRITICAL: Add sunLight.target to scene for shadows to work
        sunLight.target.position.set(0, 0, 0);
        this.scene.add(sunLight.target);

        // Core Systems
        this.input = new Input();
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        // World
        this.planet = new Planet();
        this.scene.add(this.planet.mesh);
        this.scene.add(this.planet.waterMesh);
        this.scene.add(this.planet.starField);

        // Camera Controls (System 4.0 - Clean Rebuild)
        this.cameraControls = new SphericalCameraController4(this.camera, this.renderer.domElement, this.planet);
        this.cameraControls.game = this; // Reference for unit collision

        // Audio Manager
        this.audioManager = new AudioManager();

        // Entities
        this.units = [];
        this.selectedUnit = null;
        this.unitParams = {
            speed: 5.0,
            turnSpeed: 2.0,
            groundOffset: 0.22,
            smoothingRadius: 0.5 // Radius for terrain normal averaging
        };
        this.loadUnits();

        // Fog of War
        this.fogOfWar = new FogOfWar(this.renderer, this.planet.terrain.params.radius);

        // Rocks on terrain (System V2)
        this.rockSystem = new RockSystem(this, this.planet);
        this.rockSystem.generateRocks(); // Initial generation 
        this.planet.rockSystem = this.rockSystem; // Make accessible to Units

        // Rock Collision System (Broadphase + Slide)
        this.rockCollision = new RockCollisionSystem(this.planet, this.rockSystem);
        this.planet.rockCollision = this.rockCollision; // Make accessible to Units

        // Navigation Mesh (Spherical PathFinding)
        this.navMesh = new SphericalNavMesh(this.planet.terrain, this.rockSystem);
        this.navMesh.generate();
        this.scene.add(this.navMesh.debugMesh);
        const sphereGeo = new THREE.SphereGeometry(15, 16, 16);
        const sphereMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true, transparent: true, opacity: 0.2 });
        this.visionHelper = new THREE.Mesh(sphereGeo, sphereMat);
        this.visionHelper.visible = false; // Hidden by default
        console.log("Vision Helper is hidden. To enable: game.visionHelper.visible = true");
        this.scene.add(this.visionHelper);

        // UI
        this.unit = new Unit(this.planet); // Dummy for initial DebugPanel
        this.debugPanel = new DebugPanel(this);

        // Refinement: Rock Debugger
        this.rockDebug = new RockDebug(this);

        // Texture Debugger
        this.textureDebugger = new TextureDebugger(this.renderer, this.fogOfWar.exploredTarget.texture);

        // Camera Debug Overlay
        this.cameraDebug = new CameraDebug(this);

        // Navigation Mesh Debug Panel
        this.navMeshDebug = new NavMeshDebug(this);

        // Bindings
        this.onWindowResize = this.onWindowResize.bind(this);
        // this.onMouseDown... etc removed, handled by InteractionManager
        this.animate = this.animate.bind(this);

        window.addEventListener('resize', this.onWindowResize);

        // Path Drawing Visuals (hidden - using green waypoint curve instead)
        this.currentPath = [];
        this.pathGeometry = new THREE.BufferGeometry();
        this.pathMaterial = new THREE.LineBasicMaterial({ color: 0xffff00 });
        this.pathLine = new THREE.Line(this.pathGeometry, this.pathMaterial);
        this.pathLine.visible = false; // Hidden - we use the green tube now
        this.scene.add(this.pathLine);

        // Interaction Manager (System V3)
        this.interactionManager = new InteractionManager(this);

        // Audio Manager (Initialized above before loadUnits)
    }

    // Unit Loading handled below

    loadUnits() {
        const loader = new GLTFLoader();
        // All 5 units - Unit 1 spawns in front of camera
        const models = ['1.glb', '2.glb', '3.glb', '4.glb', '5.glb'];
        let loadedCount = 0;

        // Pre-allocate units array to preserve order
        this.units = new Array(models.length).fill(null);

        models.forEach((modelName, index) => {
            loader.load(`./modellek/${modelName}`, (gltf) => {
                const model = gltf.scene;

                // Create a Unit wrapper
                const unit = new Unit(this.planet);
                unit.name = `Unit ${index + 1}`; // Set unit name

                // Replace the default cube mesh with the loaded model
                this.scene.remove(unit.mesh);
                unit.mesh = model;
                unit.mesh.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                        child.renderOrder = 20;
                    }
                });
                this.scene.add(unit.mesh);

                // Scale model if needed
                unit.mesh.scale.set(0.5, 0.5, 0.5);

                // Unit position: Unit 1 at camera-facing position (preloader center), others random
                if (index === 0) {
                    // UNIT 1: Fixed position - directly in front of initial camera
                    // Camera starts looking at planet center, so place unit at "front" of planet
                    const radius = this.planet.terrain.params.radius + 0.5;
                    // Position at Z+ direction (initial camera typically looks toward this)
                    unit.position.set(0, 0, radius);
                } else {
                    // Other units: Random position on sphere
                    const theta = Math.random() * Math.PI * 2;
                    const phi = Math.acos(2 * Math.random() - 1);
                    const radius = this.planet.terrain.params.radius + 10;

                    unit.position.set(
                        radius * Math.sin(phi) * Math.cos(theta),
                        radius * Math.sin(phi) * Math.sin(theta),
                        radius * Math.cos(phi)
                    );
                }
                unit.snapToSurface();

                // Add unit sound
                this.audioManager.addUnitSound(unit);

                // Insert at specific index to preserve order
                this.units[index] = unit;
                loadedCount++;

                // Generate tabs after all units loaded
                if (loadedCount === models.length) {
                    this.generateUnitTabs();
                    this.setupPanelControls();
                }

                // Select first unit by default
                if (index === 0) {
                    this.selectedUnit = unit;
                    this.unit = unit;

                    // Position camera above unit 1 with side/top view
                    this.positionCameraAboveUnit(unit);
                }
            });
        });
    }

    // === Interaction Delegates (V3) ===

    selectUnit(unit, skipCamera = false) {
        if (this.selectedUnit === unit) return;

        this.deselectUnit();

        this.selectedUnit = unit;
        unit.setSelection(true);

        // Show path markers
        this.showUnitMarkers(unit);

        // ZOOM CAMERA TO SHOW FULL PATH (unless skipCamera = true)
        if (!skipCamera) {
            this.zoomCameraToPath(unit);
        }

        console.log("Unit Selected:", unit);

        // Update tab active state
        this.updateTabActiveState();

        // Update Panel Content if Panel is already OPEN
        if (document.body.classList.contains('split-screen')) {
            this.focusedUnit = unit;
            this.updatePanelContent(unit);
        }
    }

    // Zoom camera to show unit's entire path with smooth transition
    zoomCameraToPath(unit) {
        if (!unit || !this.cameraControls) return;

        // Get all path CONTROL POINTS (waypoints) including unit position
        const points = [unit.position.clone()];

        // Use waypointControlPoints - these are the actual user-defined waypoints
        if (unit.waypointControlPoints && unit.waypointControlPoints.length > 0) {
            for (const wp of unit.waypointControlPoints) {
                points.push(wp.clone());
            }
        }

        if (points.length === 1) {
            // No path - just fly to unit with standard flyTo
            this.cameraControls.flyTo(unit);
            return;
        }

        // === CALCULATE BOUNDING SPHERE ===
        const center = new THREE.Vector3();
        for (const p of points) {
            center.add(p);
        }
        center.divideScalar(points.length);

        // Find max distance from center (bounding radius)
        let maxDist = 0;
        for (const p of points) {
            const d = center.distanceTo(p);
            if (d > maxDist) maxDist = d;
        }

        // === CALCULATE CAMERA DISTANCE ===
        // Add 50% padding as specified for path visibility with environment context
        const fov = this.camera.fov * Math.PI / 180;
        const aspect = this.camera.aspect;
        const effectiveFov = Math.min(fov, fov * aspect);
        const cameraDistance = (maxDist * 1.8) / Math.tan(effectiveFov / 2);

        // Clamp distance to reasonable range
        const finalDistance = Math.max(20, Math.min(200, cameraDistance + 8));

        // === CALCULATE CAMERA POSITION ===
        // AXONOMETRIC VIEW: 45° from above, 45° from side, 45° from front
        // Like Civilization/SimCity drone perspective
        const centerDir = center.clone().normalize(); // "Up" direction at center

        // Get unit's forward direction
        const unitForward = new THREE.Vector3(0, 0, 1);
        if (unit.headingQuaternion) {
            unitForward.applyQuaternion(unit.headingQuaternion);
        }

        // Project forward onto tangent plane (remove radial component)
        const tangentForward = unitForward.clone()
            .sub(centerDir.clone().multiplyScalar(unitForward.dot(centerDir)))
            .normalize();

        // Create orthonormal basis on tangent plane
        const tangentRight = new THREE.Vector3().crossVectors(centerDir, tangentForward).normalize();

        // 45° angles: sin(45°) = cos(45°) = 0.707
        const angle45 = Math.PI / 4; // 45 degrees

        // Camera offset: 
        // - Height: finalDistance * sin(45°) above center 
        // - Forward: finalDistance * cos(45°) * cos(45°) back
        // - Side: finalDistance * cos(45°) * sin(45°) to the right
        const heightOffset = finalDistance * Math.sin(angle45);
        const horizontalDist = finalDistance * Math.cos(angle45);
        const forwardOffset = -horizontalDist * Math.cos(angle45); // Behind
        const sideOffset = horizontalDist * Math.sin(angle45);     // To the side

        const cameraPos = center.clone()
            .addScaledVector(centerDir, heightOffset)          // Up
            .addScaledVector(tangentForward, forwardOffset)    // Back
            .addScaledVector(tangentRight, sideOffset);        // Side

        // === SMOOTH TRANSITION ===
        // Look at center of bounding sphere
        this.cameraControls.smoothTransitionToTarget(cameraPos, center, 1.5);
    }

    // UNIT FULL VIEW: Frame unit + path + vision radius (Civilization-style top-down)
    flyToUnitFullView(unit) {
        if (!unit || !this.cameraControls) return;

        // === COLLECT BOUNDING POINTS ===
        // 1. Unit position
        const points = [unit.position.clone()];

        // 2. Path waypoints
        if (unit.waypointControlPoints && unit.waypointControlPoints.length > 0) {
            for (const wp of unit.waypointControlPoints) {
                points.push(wp.clone());
            }
        }

        // 3. Vision radius boundary points (8 samples around unit)
        const visionRadius = this.fogOfWar.currentVisionRadius || 15.0;
        const unitDir = unit.position.clone().normalize();

        // Create tangent basis at unit position
        const tangent1 = new THREE.Vector3(1, 0, 0).cross(unitDir).normalize();
        if (tangent1.lengthSq() < 0.01) {
            tangent1.set(0, 1, 0).cross(unitDir).normalize();
        }
        const tangent2 = new THREE.Vector3().crossVectors(unitDir, tangent1).normalize();

        // Sample 8 points around vision circle
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const offset = tangent1.clone().multiplyScalar(Math.cos(angle) * visionRadius)
                .add(tangent2.clone().multiplyScalar(Math.sin(angle) * visionRadius));

            // Project to terrain surface
            const visionPoint = unit.position.clone().add(offset);
            const visionDir = visionPoint.normalize();
            const terrainRadius = this.planet.terrain.getRadiusAt(visionDir);
            visionPoint.copy(visionDir.multiplyScalar(terrainRadius));

            points.push(visionPoint);
        }

        // === CALCULATE BOUNDING SPHERE ===
        const center = new THREE.Vector3();
        for (const p of points) {
            center.add(p);
        }
        center.divideScalar(points.length);

        // Find max distance from center
        let maxDist = 0;
        for (const p of points) {
            const d = center.distanceTo(p);
            if (d > maxDist) maxDist = d;
        }

        // === CALCULATE CAMERA DISTANCE ===
        // Tighter framing (reduced padding)
        const fov = this.camera.fov * Math.PI / 180;
        const aspect = this.camera.aspect;
        const effectiveFov = Math.min(fov, fov * aspect);
        const cameraDistance = (maxDist * 1.1) / Math.tan(effectiveFov / 2); // Reduced from 1.5x to 1.1x

        const finalDistance = Math.max(20, Math.min(200, cameraDistance + 10));

        // === CALCULATE CAMERA POSITION (Top-Down/Isometric, Closest Angle) ===
        // 1. Define ideal viewing circle parameters
        const angle45 = Math.PI / 4; // 45 degree elevation
        const heightOffset = finalDistance * Math.sin(angle45);
        const horizontalRadius = finalDistance * Math.cos(angle45);

        // 2. Determine current camera direction relative to center (in horizontal plane)
        // This ensures we fly to the CLOSEST point on the viewing circle
        const currentCamPos = this.camera.position.clone();
        const centerDir = center.clone().normalize(); // Up vector at target

        // Vector from center to camera
        const toCamera = currentCamPos.clone().sub(center);

        // Project onto tangent plane (remove up component)
        // This gives us the direction from center to camera "on the ground"
        let approachDir = toCamera.clone()
            .sub(centerDir.clone().multiplyScalar(toCamera.dot(centerDir)))
            .normalize();

        // Fallback if camera is perfectly above (length is 0) -> use South
        if (approachDir.lengthSq() < 0.01) {
            // Default to consistent direction if vertical
            // Use unit's forward or global Z
            const unitForward = new THREE.Vector3(0, 0, 1);
            if (unit.headingQuaternion) {
                unitForward.applyQuaternion(unit.headingQuaternion);
            }
            // Project forward onto plane
            approachDir = unitForward.clone()
                .sub(centerDir.clone().multiplyScalar(unitForward.dot(centerDir)))
                .normalize()
                .negate(); // View from behind/south
        }

        // 3. Calculate Target Position on the optimized circle point
        // Position = Center + Up * Height + ApproachDir * HorizontalRadius
        const cameraPos = center.clone()
            .addScaledVector(centerDir, heightOffset)       // Height (Up)
            .addScaledVector(approachDir, horizontalRadius); // Horizontal distance (preserving current angle)

        // 4. Create orthonormal basis for camera orientation?
        // Not needed for position calculation, lookAt handles orientation.

        // === SMOOTH TRANSITION (ballistic arc, ease-in/out) ===
        this.cameraControls.ballisticTransitionToTarget(cameraPos, center);
    }

    deselectUnit() {
        if (this.selectedUnit) {
            this.selectedUnit.setSelection(false);

            // HIDE this unit's path markers
            this.hideUnitMarkers(this.selectedUnit);

            this.selectedUnit = null;
        }

        // Also Exit Focus Mode if active
        this.exitFocusMode();

        // Update tab active state
        this.updateTabActiveState();
    }

    // === Unit Tab System ===

    generateUnitTabs() {
        const tabContainer = document.getElementById('unit-tabs');
        if (!tabContainer) return;

        tabContainer.innerHTML = '';

        this.units.forEach((unit, index) => {
            const tab = document.createElement('div');
            tab.className = 'unit-tab';
            tab.textContent = `Unit ${index + 1}`;
            tab.dataset.unitIndex = index;

            tab.addEventListener('click', () => {
                this.onUnitTabClick(index);
            });

            tabContainer.appendChild(tab);
        });

        // ADD TOGGLE BUTTON (expand/collapse) to top-right of tab bar
        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'panel-toggle-btn';
        toggleBtn.className = 'panel-toggle-btn';
        toggleBtn.innerHTML = '<span class="toggle-icon">▲</span>';
        toggleBtn.title = 'Expand/Collapse Panel';
        tabContainer.appendChild(toggleBtn);

        // Update active state if a unit is already selected
        this.updateTabActiveState();

        // Header Click DESELECT (Empty space)
        tabContainer.addEventListener('click', (e) => {
            // If clicked directly on the container (gap), not on a tab
            if (e.target === tabContainer) {
                console.log('Clicked header empty space -> Deselect');
                this.deselectUnit();
            }
        });

        console.log(`Generated ${this.units.length} unit tabs with toggle button`);
    }

    setupPanelControls() {
        const toggleBtn = document.getElementById('panel-toggle-btn');
        const unitTabs = document.getElementById('unit-tabs');
        const bottomPanel = document.getElementById('bottom-panel');

        // Toggle button click
        if (toggleBtn) {
            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.togglePanel();
            });
        }

        // Edge drag on unit-tabs row
        if (unitTabs && bottomPanel) {
            let startY = 0;
            let isDragging = false;
            let panelWasOpen = false;

            const onDragStart = (e) => {
                // Only start drag from top edge (first 20px)
                const rect = unitTabs.getBoundingClientRect();
                const y = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
                const offsetFromTop = y - rect.top;

                if (offsetFromTop > 20) return; // Only drag from top edge

                isDragging = true;
                startY = y;
                panelWasOpen = document.body.classList.contains('split-screen');

                // Disable transition during drag for responsive feel
                bottomPanel.style.transition = 'none';
            };

            const onDragMove = (e) => {
                if (!isDragging) return;
                e.preventDefault();

                const currentY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
                const deltaY = currentY - startY;

                // Real-time panel position update
                const panelHeight = bottomPanel.offsetHeight;
                const tabHeight = 52; // var(--tab-height)

                if (panelWasOpen) {
                    // Panel is open, dragging down should close
                    const newOffset = Math.max(0, Math.min(panelHeight - tabHeight, deltaY));
                    bottomPanel.style.transform = `translateY(${newOffset}px)`;
                } else {
                    // Panel is closed, dragging up should open
                    const closedOffset = panelHeight - tabHeight;
                    const newOffset = Math.max(0, closedOffset + deltaY);
                    bottomPanel.style.transform = `translateY(${newOffset}px)`;
                }
            };

            const onDragEnd = () => {
                if (!isDragging) return;
                isDragging = false;

                // Re-enable smooth transition
                bottomPanel.style.transition = '';
                bottomPanel.style.transform = '';

                // Get current position to decide snap direction
                const rect = bottomPanel.getBoundingClientRect();
                const screenHeight = window.innerHeight;
                const panelTop = rect.top;
                const threshold = screenHeight * 0.6; // 60% threshold

                if (panelTop < threshold) {
                    // Panel is mostly shown -> snap to open
                    this.openPanel();
                } else {
                    // Panel is mostly hidden -> snap to closed
                    this.closePanel();
                }
            };

            unitTabs.addEventListener('mousedown', onDragStart);
            window.addEventListener('mousemove', onDragMove);
            window.addEventListener('mouseup', onDragEnd);

            // Touch support
            unitTabs.addEventListener('touchstart', onDragStart, { passive: false });
            window.addEventListener('touchmove', onDragMove, { passive: false });
            window.addEventListener('touchend', onDragEnd);
        }
    }

    togglePanel() {
        if (document.body.classList.contains('split-screen')) {
            this.closePanel();
        } else {
            this.openPanel();
        }
    }

    openPanel() {
        document.body.classList.add('split-screen');
        // If a unit is selected, update panel content
        if (this.selectedUnit) {
            this.isFocusMode = true;
            this.focusedUnit = this.selectedUnit;
            this.updatePanelContent(this.selectedUnit);
        }
    }

    closePanel() {
        document.body.classList.remove('split-screen');
        this.isFocusMode = false;
        // Keep focusedUnit so it can be restored
    }

    onUnitTabClick(unitIndex) {
        const unit = this.units[unitIndex];
        if (!unit) return;

        const now = Date.now();
        const doubleClickThreshold = 300; // ms

        // Check for double click
        if (this.lastTabClickIndex === unitIndex &&
            this.lastTabClickTime &&
            (now - this.lastTabClickTime) < doubleClickThreshold) {
            // DOUBLE CLICK: Open panel if closed, or just re-focus
            this.enterFocusMode(unit);
            this.lastTabClickTime = 0; // Reset
            console.log(`Tab DOUBLE clicked: Unit ${unitIndex + 1} - Opening panel`);
        } else {
            // SINGLE CLICK
            if (this.isFocusMode) {
                // If panel is ALREADY open, single click should switch content seamlessly
                this.enterFocusMode(unit);
                console.log(`Tab clicked (Panel Open): Unit ${unitIndex + 1} - Switch content`);
            } else {
                // Panel is CLOSED: Just select and fly
                this.selectAndFlyToUnit(unit);
                console.log(`Tab clicked (Panel Closed): Unit ${unitIndex + 1} - Select only`);
            }
        }

        this.lastTabClickIndex = unitIndex;
        this.lastTabClickTime = now;

        this.updateTabActiveState();
    }

    /**
     * Select a unit and zoom camera to show its ENTIRE PATH.
     * Does NOT open the bottom panel.
     */
    selectAndFlyToUnit(unit) {
        if (!unit) return;

        const isNewUnit = (this.selectedUnit !== unit);

        // Select the unit (skip camera zoom - we call it manually below)
        this.selectUnit(unit, true);

        // Reset camera mode to drone (top-down view)
        // Third-person only activates when keyboard is pressed
        if (this.cameraControls) {
            this.cameraControls.chaseMode = 'drone';
            this.cameraControls.chaseTarget = null;
        }

        // Camera: Zoom to UNIT FULL VIEW (path + vision radius)
        if (isNewUnit) {
            this.flyToUnitFullView(unit);
        }

        // Keep panel closed (don't add split-screen class)
        // But update tab active state
        this.updateTabActiveState();
    }

    updateTabActiveState() {
        const tabs = document.querySelectorAll('.unit-tab');
        tabs.forEach((tab, index) => {
            if (this.units[index] === this.selectedUnit) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });
    }

    deselectUnit() {
        if (this.selectedUnit) {
            this.selectedUnit.setSelection(false);
            this.hideUnitMarkers(this.selectedUnit);
            this.selectedUnit = null;
        }

        // Close panel
        this.exitFocusMode();

        // Update tabs
        this.updateTabActiveState();
        console.log('Unit Deselected');
    }

    hideUnitMarkers(unit) {
        if (!unit) return;

        if (unit.waypointMarkers) {
            unit.waypointMarkers.forEach(m => {
                m.visible = false;
                if (m.userData.labelSprite) {
                    m.userData.labelSprite.visible = false;
                }
            });
        }
        if (unit.waypointCurveLine) {
            unit.waypointCurveLine.visible = false;
        }
    }

    showUnitMarkers(unit) {
        if (!unit) return;

        if (unit.waypointMarkers) {
            unit.waypointMarkers.forEach(m => {
                m.visible = true;
                if (m.userData.labelSprite) {
                    m.userData.labelSprite.visible = true;
                }
            });
        }
        if (unit.waypointCurveLine) {
            unit.waypointCurveLine.visible = true;
        }
    }

    setPathVisualizationVisible(visible) {
        // Legacy support / Helper for toggling CURRENT selection
        if (this.selectedUnit) {
            if (visible) {
                this.showUnitMarkers(this.selectedUnit);
            } else {
                this.hideUnitMarkers(this.selectedUnit);
            }
        }
    }

    createNumberSprite(number) {
        // Create a canvas with the number - NO circle background, thin font
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');

        // Clear (transparent background, no circle)
        ctx.clearRect(0, 0, 64, 64);

        // Draw number with thin font (like preloader "PLANET APPROACH" style)
        ctx.fillStyle = 'rgba(0, 255, 136, 1.0)';
        ctx.font = '200 24px "Inter", "Segoe UI", Arial'; // Thin weight (200), smaller size
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(number), 32, 32);

        // Create texture from canvas
        const texture = new THREE.CanvasTexture(canvas);

        // Create sprite material
        const spriteMat = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false,
            depthWrite: false
        });

        const sprite = new THREE.Sprite(spriteMat);
        sprite.scale.set(0.8, 0.8, 1); // Smaller scale

        return sprite;
    }

    addWaypoint(point) {
        if (!this.selectedUnit) return;

        // Use per-unit waypoint storage
        const unit = this.selectedUnit;

        // Switch camera to CONTROL MODE (close third-person) when user starts controlling
        if (this.cameraControls && this.cameraControls.chaseTarget === unit) {
            this.cameraControls.setChaseTarget(unit, true); // Control mode - close third-person
        }

        // GENERIC ID GENERATOR
        const generateID = () => Date.now().toString(36) + Math.random().toString(36).substr(2);

        // If first waypoint, start from unit's CURRENT position (not where it started)
        if (unit.waypointControlPoints.length === 0) {
            const startPos = unit.position.clone();
            const startID = generateID();
            startPos._id = startID; // Attach ID legacy

            unit.waypointControlPoints.push(startPos);
            // Spec Compliance: Populate persistent waypoints list
            if (!unit.waypoints) unit.waypoints = [];
            unit.waypoints.push({ id: startID, position: startPos });

            unit.isPathClosed = false;

            // AUTO-INITIALIZE: Mark start point as "passed" immediately
            unit.lastPassedControlPointID = startID;
            // NOTE: Do NOT set lastWaypointId here - let Unit.js handle it dynamically
            // unit.lastWaypointId = startID; // REMOVED - was causing "Start always Blue" bug
            unit.passedControlPointCount = 1;

            // Create START POINT sphere marker
            const startDir = startPos.clone().normalize();
            const startTerrainRadius = this.planet.terrain.getRadiusAt(startDir);
            const startMarkerPos = startDir.clone().multiplyScalar(startTerrainRadius);

            const startMarkerGeo = new THREE.SphereGeometry(0.4, 16, 16);
            const startMarkerMat = new THREE.MeshBasicMaterial({
                color: 0x00ff88,
                transparent: true,
                opacity: 0.7,
                depthTest: true,
                depthWrite: true
            });
            const startMarker = new THREE.Mesh(startMarkerGeo, startMarkerMat);
            startMarker.position.copy(startMarkerPos);
            startMarker.userData.isFilled = true; // Already passed (we started here!)
            startMarker.userData.controlPointIndex = 0;
            startMarker.userData.isStartMarker = true;
            startMarker.userData.waypointNumber = 0;
            startMarker.userData.id = startID; // Link marker via ID
            startMarker.userData.unitId = unit.id;

            const startLabelSprite = this.createNumberSprite(0);
            startLabelSprite.position.copy(startMarkerPos);
            startLabelSprite.renderOrder = 15;
            startMarker.userData.labelSprite = startLabelSprite;
            this.scene.add(startLabelSprite);

            this.scene.add(startMarker);
            unit.waypointMarkers.push(startMarker);
        }

        // Add the clicked point as a new waypoint
        const newPoint = point.clone();
        const newID = generateID();
        newPoint._id = newID; // Attach ID legacy

        unit.waypointControlPoints.push(newPoint);
        if (!unit.waypoints) unit.waypoints = [];
        unit.waypoints.push({ id: newID, position: newPoint });

        // Create visual marker (Transparent Sphere on terrain surface)
        const dir = newPoint.clone().normalize();
        const terrainRadius = this.planet.terrain.getRadiusAt(dir);
        const markerPos = dir.clone().multiplyScalar(terrainRadius);

        const markerGeo = new THREE.SphereGeometry(0.4, 16, 16);
        const markerMat = new THREE.MeshBasicMaterial({
            color: 0x00ff88,
            transparent: true,
            opacity: 0.7,
            depthTest: true,
            depthWrite: true
        });
        const marker = new THREE.Mesh(markerGeo, markerMat);
        marker.position.copy(markerPos);

        // Add NUMBER LABEL sprite
        const waypointNumber = unit.waypointMarkers.length;
        const labelSprite = this.createNumberSprite(waypointNumber);
        labelSprite.position.copy(markerPos);
        labelSprite.renderOrder = 15;
        marker.userData.labelSprite = labelSprite;
        marker.userData.unitId = unit.id;
        this.scene.add(labelSprite);

        // Store metadata
        marker.userData.isFilled = false;
        marker.userData.controlPointIndex = unit.waypointControlPoints.length - 1;
        marker.userData.waypointNumber = waypointNumber;
        marker.userData.id = newPoint._id; // Link marker via ID

        this.scene.add(marker);
        unit.waypointMarkers.push(marker);

        // Generate smooth curve and update visualization
        this.updateWaypointCurve();

        // Update Command Queue if panel is open
        if (this.isFocusMode && this.focusedUnit) {
            this.updatePanelContent(this.focusedUnit);
        }

        console.log("Waypoint added:", newPoint, "ID:", newPoint._id);
    }

    closePath() {
        // Called from InteractionManager when start marker is clicked
        if (!this.selectedUnit) return;
        const unit = this.selectedUnit;

        if (unit.waypointControlPoints && unit.waypointControlPoints.length >= 3 && !unit.isPathClosed) {
            unit.loopingEnabled = true;
            unit.isPathClosed = true;
            console.log("Path CLOSED - clicked on start marker!");

            // NOTE: Colors are managed by updateWaypointMarkerFill - do not hardcode here

            // Regenerate curve as closed loop
            this.updateWaypointCurve();

            // Update Command Queue if panel is open
            if (this.isFocusMode && this.focusedUnit) {
                this.updatePanelContent(this.focusedUnit);
            }
        }
    }

    updateWaypointCurve() {
        if (!this.selectedUnit) return;
        const unit = this.selectedUnit;

        if (!unit.waypointControlPoints || unit.waypointControlPoints.length < 2) return;

        // === CRITICAL: RE-EVALUATE TARGET BASED ON "LAST PASSED" ANCHOR ===
        // User Requirement: "Amikor a Command Queueben rendezem át, akkor mindíg azt célozza, ami az elhagyott állomás után következik."
        // We must ensure targetWaypointId is always Next(lastWaypointId) in the current list.
        if (unit.waypoints && unit.waypoints.length > 0) {
            // === PHASE 2 LOGIC: TARGET SELECTION RULE ===
            // Rule: target = nextWaypointAfter(lastWaypointId, queueOrder)
            // This runs on EVERY curve update (Drag, Reorder, Delete)

            let newTargetIndex = 1; // Default

            if (unit.lastWaypointId) {
                const lastIdx = unit.waypoints.findIndex(wp => wp.id === unit.lastWaypointId);

                if (lastIdx !== -1) {
                    // Anchor found. Target is Next.
                    newTargetIndex = lastIdx + 1;

                    // Loop Handling
                    if (newTargetIndex >= unit.waypoints.length) {
                        if (unit.isPathClosed) newTargetIndex = 0;
                        else newTargetIndex = unit.waypoints.length - 1; // Stay at end
                    }
                } else {
                    // Anchor (lastWaypointId) was DELETED.
                    // Fallback: Use the index that `lastPassedControlPointIndex` pointed to?
                    // OR: Unit is "lost".
                    // Logic: If Anchor is gone, we should pick a new Anchor.
                    // Simplified: Keep unit.lastWaypointId as is (stale) until we hit a new point?
                    // Better: If Anchor deleted, set Anchor to PREVIOUS of deleted node?
                    // Since we don't know who was deleted, we assume Unit is at start or maintain current Target.

                    // For now, if Anchor gone, logic defaults to Index 1 (reset).
                    // This might cause a jump, but is safe.
                    newTargetIndex = 1;
                    if (unit.waypoints.length < 2) newTargetIndex = 0;
                }
            } else {
                // No Anchor (Start)
                newTargetIndex = 1;
                if (unit.waypoints.length < 2) newTargetIndex = 0;
            }

            // Apply Target
            // Check bounds again to be safe
            if (newTargetIndex < unit.waypoints.length) {
                unit.targetWaypointId = unit.waypoints[newTargetIndex].id;
            }
        }

        const groundOffset = unit.groundOffset || 0.5;
        const controlPoints = unit.waypointControlPoints;

        // === STEP 1: SMOOTH THE CONTROL POINTS FIRST ===
        // Create smooth curve through user's waypoints (tangent continuity at each point)
        const controlCurve = new THREE.CatmullRomCurve3(
            controlPoints,
            unit.isPathClosed,
            'chordal',  // Best for C1 continuity
            0.0         // Tension: 0 = smooth
        );

        // Sample smooth curve at high density
        const numControlSamples = Math.max(300, controlPoints.length * 50);
        const smoothedControlPoints = controlCurve.getPoints(numControlSamples);

        // === STEP 2: PROJECT TO TERRAIN ===
        // Each smoothed point gets projected onto terrain surface
        const projectedPoints = smoothedControlPoints.map(p => {
            const dir = p.clone().normalize();
            const terrainRadius = this.planet.terrain.getRadiusAt(dir);
            return dir.multiplyScalar(terrainRadius + groundOffset);
        });

        // === STEP 3: OBSTACLE CHECK (optional - skip A* for now, use direct projection) ===
        // TODO: Add local obstacle avoidance if path intersects rocks
        // For now, the smooth terrain-following path is the final path

        // === VISUALIZATION ===
        // Create projected curve for TubeGeometry
        const projectedCurve = new THREE.CatmullRomCurve3(projectedPoints, unit.isPathClosed, 'catmullrom', 0.5);

        // Create/update THICK curve visualization
        if (unit.waypointCurveLine) {
            this.scene.remove(unit.waypointCurveLine);
            unit.waypointCurveLine.geometry.dispose();
            unit.waypointCurveLine.material.dispose();
        }

        const tubeGeo = new THREE.TubeGeometry(projectedCurve, numControlSamples, 0.08, 8, unit.isPathClosed);
        const tubeMat = new THREE.MeshBasicMaterial({
            color: unit.isPathClosed ? 0x00ff88 : 0x00cc66,
            transparent: true,
            opacity: 0.6,
            depthTest: true,
            depthWrite: true
        });
        unit.waypointCurveLine = new THREE.Mesh(tubeGeo, tubeMat);
        this.scene.add(unit.waypointCurveLine);

        // === PATH SYNC - FORWARD-ONLY REJOIN (FIX BACKTRACKING BUG) ===
        // When path changes, find the unit's current position on the path
        // and ensure we target a point that is FORWARD (in movement direction)
        const newCPCount = controlPoints.length;

        if (newCPCount >= 2) {
            // Store new permanent path
            unit.path = projectedPoints.map(p => p.clone());

            // === PATH SEGMENT MAPPING ===
            // Store which path index corresponds to each control point
            unit.pathSegmentIndices = [];
            // === PATH SEGMENT MAPPING (PRECISE) ===
            // Find exact path index closest to each Control Point for accurate Arrival detection.
            unit.pathSegmentIndices = [];

            for (let i = 0; i < controlPoints.length; i++) {
                const cp = controlPoints[i];
                let bestIdx = 0;
                let bestDist = Infinity;

                // Brute force search is fast enough (path length ~300-1000)
                // Optimization: Start search from previous bestIdx?
                // But path might loop or double back. Safe to search all.
                for (let j = 0; j < unit.path.length; j++) {
                    // Compare squared distance for speed
                    const dSq = unit.path[j].distanceToSquared(cp);
                    if (dSq < bestDist) {
                        bestDist = dSq;
                        bestIdx = j;
                    }
                }
                unit.pathSegmentIndices.push(bestIdx);
            }

            const unitPos = unit.position.clone();

            // Get unit's forward direction (velocity or heading)
            let unitForward = new THREE.Vector3(0, 0, 1);
            if (unit.velocityDirection && unit.velocityDirection.lengthSq() > 0.01) {
                unitForward = unit.velocityDirection.clone().normalize();
            } else if (unit.headingQuaternion) {
                unitForward = new THREE.Vector3(0, 0, 1).applyQuaternion(unit.headingQuaternion);
            }

            // SEGMENT RESTRICTION: Only search within the current active segment
            let startSearch = 0;
            let endSearch = unit.path.length;

            if (unit.targetWaypointId && unit.pathSegmentIndices && unit.waypoints) {
                const targetWPIndex = unit.waypoints.findIndex(wp => wp.id === unit.targetWaypointId);

                if (targetWPIndex !== -1) {
                    let prevCPIndex = targetWPIndex - 1;
                    if (prevCPIndex < 0) {
                        if (unit.isPathClosed) prevCPIndex = unit.waypoints.length - 1;
                        else prevCPIndex = 0;
                    }

                    const startPathIdx = unit.pathSegmentIndices[prevCPIndex] || 0;
                    const endPathIdx = unit.pathSegmentIndices[targetWPIndex] || unit.path.length;

                    if (startPathIdx <= endPathIdx) {
                        const buffer = 20;
                        startSearch = Math.max(0, startPathIdx - buffer);
                        endSearch = Math.min(unit.path.length, endPathIdx + buffer);
                    }
                }
            }

            // Find the closest point within search range
            let closestIdx = startSearch;
            let closestDist = Infinity;

            for (let i = startSearch; i < endSearch; i++) {
                const d = unitPos.distanceTo(unit.path[i]);
                if (d < closestDist) {
                    closestDist = d;
                    closestIdx = i;
                }
            }

            // === FORWARD CHECK ===
            // Search for a point that is IN FRONT of the unit
            const searchLimit = Math.min(50, Math.floor(unit.path.length * 0.2));
            let targetIdx = closestIdx;

            for (let offset = 1; offset <= searchLimit; offset++) {
                let checkIdx = closestIdx + offset;

                if (checkIdx >= unit.path.length) {
                    if (unit.isPathClosed) {
                        checkIdx = checkIdx % unit.path.length;
                    } else {
                        checkIdx = unit.path.length - 1;
                        break;
                    }
                }

                const toPoint = unit.path[checkIdx].clone().sub(unitPos).normalize();
                const dotProduct = toPoint.dot(unitForward);

                if (dotProduct > 0.1) {
                    targetIdx = checkIdx;
                    break;
                }
            }

            // Add significant lookahead to prevent stalling
            const lookahead = Math.max(15, Math.floor(unit.path.length * 0.05));
            targetIdx = targetIdx + lookahead;

            if (targetIdx >= unit.path.length) {
                if (unit.isPathClosed) {
                    targetIdx = targetIdx % unit.path.length;
                } else {
                    targetIdx = unit.path.length - 1;
                }
            }

            unit.pathIndex = targetIdx;
            unit.isFollowingPath = true;

            // Clear savedPath to prevent keyboard override from restoring OLD path
            unit.savedPath = null;
            unit.savedPathIndex = 0;
            unit.isKeyboardOverriding = false;

            console.log(`Path updated (forward-safe). Closest: ${closestIdx}, Target: ${targetIdx}, Dist: ${closestDist.toFixed(2)}`);
        }
    }

    /**
     * Create a geodesic (great-circle) path between two points on the sphere.
     * Used as fallback when A* fails.
     */
    _createGeodesicPath(start, end, numPoints) {
        const path = [];
        const startDir = start.clone().normalize();
        const endDir = end.clone().normalize();

        for (let i = 0; i <= numPoints; i++) {
            const t = i / numPoints;
            // Spherical linear interpolation (slerp)
            const dir = new THREE.Vector3().lerpVectors(startDir, endDir, t).normalize();
            const radius = this.planet.terrain.getRadiusAt(dir);
            path.push(dir.multiplyScalar(radius));
        }

        return path;
    }

    clearWaypointMarkers() {
        if (!this.selectedUnit) return;
        const unit = this.selectedUnit;

        if (unit.waypointMarkers) {
            unit.waypointMarkers.forEach(m => {
                // Remove label sprite if exists
                if (m.userData.labelSprite) {
                    this.scene.remove(m.userData.labelSprite);
                    m.userData.labelSprite.material.map.dispose();
                    m.userData.labelSprite.material.dispose();
                }
                this.scene.remove(m);
                m.geometry.dispose();
                m.material.dispose();
            });
            unit.waypointMarkers = [];
        }

        // Clear curve line
        if (unit.waypointCurveLine) {
            this.scene.remove(unit.waypointCurveLine);
            unit.waypointCurveLine.geometry.dispose();
            unit.waypointCurveLine.material.dispose();
            unit.waypointCurveLine = null;
        }

        // Clear control points
        unit.waypointControlPoints = [];
        unit.lastCommittedControlPointCount = 0;
        unit.passedControlPointCount = 0;
        unit.lastPassedControlPointID = null; // Reset ID tracking
        unit.loopingEnabled = false;
        unit.isPathClosed = false;
    }

    updateWaypointMarkerFill() {
        // User Request: "Minden egység folyamatosan frissíti... bármennyi unit esetén"
        // Iterate ALL units, not just selected.
        this.units.forEach(unit => {
            if (!unit) return;
            if (!unit.waypointMarkers || !unit.waypoints) return;
            if (unit.waypointMarkers.length === 0) return;
            if (unit.waypoints.length === 0) return;

            // === FALLBACK: Calculate IDs based on pathIndex if not set ===
            if (unit.pathSegmentIndices && unit.pathSegmentIndices.length > 0 && unit.waypoints.length > 1) {
                // Find which segment we're in based on pathIndex
                // Use > instead of >= so segment only changes when we LEAVE a waypoint, not when we arrive
                let currentSegmentIdx = 0;
                for (let i = 0; i < unit.pathSegmentIndices.length; i++) {
                    if (unit.pathIndex > unit.pathSegmentIndices[i]) {
                        currentSegmentIdx = i;
                    }
                }

                // Set lastWaypointId (BLUE) = current segment
                const expectedLastId = unit.waypoints[currentSegmentIdx]?.id;
                if (expectedLastId && unit.lastWaypointId !== expectedLastId) {
                    unit.lastWaypointId = expectedLastId;
                }

                // Set targetWaypointId (ORANGE) = next segment
                let nextIdx = currentSegmentIdx + 1;
                if (nextIdx >= unit.waypoints.length) {
                    if (unit.loopingEnabled || unit.isPathClosed) nextIdx = 0;
                    else nextIdx = unit.waypoints.length - 1;
                }
                const expectedTargetId = unit.waypoints[nextIdx]?.id;
                if (expectedTargetId && unit.targetWaypointId !== expectedTargetId) {
                    unit.targetWaypointId = expectedTargetId;
                }
            }
            // === INITIAL FALLBACK: If still not set, use first two waypoints ===
            if (!unit.lastWaypointId && unit.waypoints.length > 0) {
                unit.lastWaypointId = unit.waypoints[0].id;
            }
            if (!unit.targetWaypointId && unit.waypoints.length > 1) {
                unit.targetWaypointId = unit.waypoints[1].id;
            }

            // Determine target waypoint index (Local to unit)
            // Logic is robust: Unit tracks IDs. Visuals reflect IDs.
            unit.waypointMarkers.forEach((marker, index) => {
                if (!marker.material) return;

                let color = 0x00ff88; // Default: Green
                let opacity = 0.5;

                // ID-BASED COLORING using marker's own attached ID
                const markerId = marker.userData.id;

                // DEBUG: Log first marker of first unit to see what's happening
                if (index === 0 && this.units.indexOf(unit) === 0) {
                    console.log(`[COLOR DEBUG] markerId=${markerId?.slice(-4)} lastId=${unit.lastWaypointId?.slice(-4)} targetId=${unit.targetWaypointId?.slice(-4)}`);
                }

                if (markerId && unit.targetWaypointId && markerId === unit.targetWaypointId) {
                    // ORANGE: Current Target (Goes to)
                    color = 0xffaa00;
                    opacity = 1.0;
                } else if (markerId && unit.lastWaypointId && markerId === unit.lastWaypointId) {
                    // BLUE: Previous Anchor (Left behind)
                    color = 0x00aaff;
                    opacity = 0.85;
                }

                // OPTIMIZATION: Only update if changed
                // "sok 10ezer unit" -> Performance is key.
                if (marker.userData.lastHex !== color || marker.userData.lastOpacity !== opacity) {
                    marker.material.color.setHex(color);
                    marker.material.opacity = opacity;

                    marker.userData.lastHex = color;
                    marker.userData.lastOpacity = opacity;
                }
            });
        });
    }

    handlePathLooping() {
        if (!this.selectedUnit) return;
        const unit = this.selectedUnit;

        if (!unit.waypointControlPoints || unit.waypointControlPoints.length < 3) return;
        if (!unit.loopingEnabled || !unit.isPathClosed) return;

        if (unit.path && unit.path.length === 0) {
            const allFilled = unit.waypointMarkers && unit.waypointMarkers.length > 0 &&
                unit.waypointMarkers.every(m => m.userData.isFilled);

            if (allFilled) {
                // Create Catmull-Rom curve through ALL control points
                const loopCurve = new THREE.CatmullRomCurve3(unit.waypointControlPoints, true, 'centripetal', 0.5);

                // Increase sample density for smooth terrain following
                const loopSamples = Math.max(100, unit.waypointControlPoints.length * 30);
                const loopPointsRaw = loopCurve.getPoints(loopSamples);

                // PROJECT onto terrain (CRITICAL FIX)
                const loopPoints = loopPointsRaw.map(p => {
                    const dir = p.clone().normalize();
                    const terrainRadius = this.planet.terrain.getRadiusAt(dir);
                    // Add slight offset like updateWaypointCurve
                    return dir.multiplyScalar(terrainRadius + 0.3);
                });

                unit.path = loopPoints;

                unit.waypointMarkers.forEach((marker, idx) => {
                    marker.userData.isFilled = false;
                    // NOTE: Colors are managed by updateWaypointMarkerFill - do not set here
                });
                unit.passedControlPointCount = 0;

                console.log("Path looping (Projected on Terrain)!");
            }
        }
    }

    startPathDrawing(unit) {
        // Direct Steering Start
        // Maybe show a line to cursor?
        if (this.pathLine) this.scene.add(this.pathLine);

        // Start Moving Slowly (User requirement: "lassan induljon el")
        if (unit) {
            unit.isFollowingPath = false; // Not following path yet (drawing)
            // But maybe we want it to creep forward?
            // "Ha a user vonalat kezd rajzolni, akkor a unit lassan induljon el rajta"
            // Start moving on existing path or just idle?
            // If dragging unit -> Path Draw. The unit shouldn't move while drawing?
            // "unit lassan induljon el rajta" -> implies it starts following the path being drawn?
            // Impossible if path isn't finished.
            // Maybe they mean: When I click play?

            // "Ha a user vonalat kezd rajzolni" -> Dragging from Unit?
            // If dragging from unit, we are designing the path.
            // Let's assume they mean: When path is valid, start moving.

            // Actually, "unit lassan induljon el rajta" might mean "Start moving towards the first waypoint as soon as it is placed"?
            // If I drag, I place waypoints.
            // If I place Waypoint 1, 2, 3... Unit should start moving to WP1 immediately?
            // Yes.

            unit.setCommandPause(false); // Unpause
            unit.isFollowingPath = true; // Try to follow whatever path exists
        }
    }

    updatePathDrawing(unit, hitPoint) {
        // DIRECT STEERING: Drive unit towards cursor
        if (unit && hitPoint) {
            unit.steerTowards(hitPoint);

            // Visuals: Line from Unit to Cursor
            const points = [unit.position.clone(), hitPoint.clone()];
            if (this.pathLine) {
                this.pathLine.geometry.setFromPoints(points);
            }
        }
    }

    finishPathDrawing(unit) {
        // Stop Steering
        if (unit) {
            unit.stopSteering();
        }

        // Clear visuals
        if (this.pathLine) {
            this.pathLine.geometry.setFromPoints([]);
        }
    }

    onUnitDoubleClicked(unit) {
        console.log("Double Clicked:", unit);
        if (unit) {
            this.enterFocusMode(unit);
        }
    }

    // === Focus Mode (Split Screen) ===

    enterFocusMode(unit) {
        const isNewUnit = (this.focusedUnit !== unit);

        // Note: We allow re-entry to ensure UI syncing if panel was closed or camera drifted
        this.isFocusMode = true;
        this.focusedUnit = unit;

        // Ensure unit is selected
        this.selectUnit(unit);

        // UI Transition
        document.body.classList.add('split-screen');

        // Camera Logic - SMOOTH TRANSITION to overhead view for path editing
        if (this.cameraControls) {
            // STOP CHASING - we want static view for path editing
            this.cameraControls.setChaseTarget(null);

            // Calculate target camera position (same as positionCameraAboveUnit)
            const unitPos = unit.position.clone();
            const up = unitPos.clone().normalize();
            const distance = 30;

            const tangent = new THREE.Vector3(1, 0, 0).cross(up).normalize();
            if (tangent.lengthSq() < 0.01) {
                tangent.set(0, 1, 0).cross(up).normalize();
            }

            const cameraOffset = up.clone().multiplyScalar(0.6)
                .add(tangent.clone().multiplyScalar(0.4))
                .normalize()
                .multiplyScalar(distance);

            const targetCameraPos = unitPos.clone().add(cameraOffset);

            // Build target orientation
            const lookMatrix = new THREE.Matrix4();
            lookMatrix.lookAt(targetCameraPos, unitPos, up);
            const targetQuat = new THREE.Quaternion().setFromRotationMatrix(lookMatrix);

            // SMOOTH ANIMATION instead of instant jump
            // Use cameraControls internal smoothing by setting targets
            this.cameraControls.targetPosition.copy(targetCameraPos);
            this.cameraControls.targetQuaternion.copy(targetQuat);
            // Camera will smoothly interpolate with its built-in easing
        }

        // Ensure path visualization is VISIBLE when panel is open
        this.showUnitMarkers(unit);

        // Update Panel Content
        this.updatePanelContent(unit);

        // SHIFT VIEWPORT: Panel is ~38% of screen height
        // We shift the view UP so the unit is centered in the remaining space
        if (this.cameraControls) {
            this.cameraControls.setViewOffsetPixel(window.innerHeight * 0.38);
        }

        // NOTE: Removed resize trigger - map should not move when panel opens 
    }

    exitFocusMode() {
        if (!this.isFocusMode) return;

        this.isFocusMode = false;
        this.focusedUnit = null;

        // UI Transition
        document.body.classList.remove('split-screen');

        // NOTE: Removed resize trigger - map stays at full size

        // Restore Camera
        if (this.cameraControls) {
            // Stop chasing when exiting focus mode
            this.cameraControls.chaseTarget = null;
            // Reset Viewport
            this.cameraControls.setViewOffsetPixel(0);
        }
    }

    updatePanelContent(unit) {
        const panelContent = document.querySelector('#bottom-panel .panel-content');
        if (panelContent) {
            // Build Command Queue HTML from unit's waypoints
            let commandQueueHTML = '<div class="command-queue-list" id="command-queue-list">';

            if (unit.waypointControlPoints && unit.waypointControlPoints.length > 0) {
                // Determine target and last indices for UI coloring (ID-based)
                let targetIndex = -1;
                let lastIndex = -1;
                if (unit.waypoints) {
                    if (unit.targetWaypointId) {
                        targetIndex = unit.waypoints.findIndex(wp => wp.id === unit.targetWaypointId);
                    }
                    if (unit.lastWaypointId) {
                        lastIndex = unit.waypoints.findIndex(wp => wp.id === unit.lastWaypointId);
                    }
                }

                unit.waypointControlPoints.forEach((cp, index) => {
                    const coords = `${cp.x.toFixed(1)}, ${cp.y.toFixed(1)}, ${cp.z.toFixed(1)}`;
                    const label = index === 0 ? 'START' : `WP ${index}`;

                    // Determine State Class (ID-based)
                    let stateClass = '';
                    let icon = '📍';

                    if (index === targetIndex) {
                        stateClass = 'state-target'; // Orange
                        icon = '🎯';
                    } else if (index === lastIndex) {
                        stateClass = 'state-from'; // Blue
                        icon = '🔙';
                    }

                    commandQueueHTML += `
                    <div class="command-item ${stateClass}" draggable="true" data-index="${index}">
                        <div class="cmd-icon">${icon}</div>
                        <div class="cmd-info">
                            <div class="cmd-type">MOVE TO</div>
                            <div class="cmd-coords">${label}</div>
                            <div class="cmd-details">${coords}</div>
                        </div>
                        <div class="cmd-actions">
                            <button class="cmd-action-btn delete-btn" title="Remove" data-index="${index}">✕</button>
                        </div>
                    </div>
                `;
                });
            } else {
                commandQueueHTML += `
                    <div class="no-commands">
                        <div class="no-commands-icon">📋</div>
                        <div class="no-commands-text">No waypoints</div>
                        <div class="no-commands-hint">Shift+Click to add</div>
                    </div>
                `;
            }
            commandQueueHTML += '</div>';

            // Calculate altitude
            const altitude = (unit.position.length() - this.planet.terrain.params.radius).toFixed(2);
            const isFollowing = unit.isFollowingPath && !unit.pausedByCommand;
            const statusClass = isFollowing ? 'active' : (unit.pausedByCommand ? 'paused' : 'stopped');
            const statusText = isFollowing ? 'Following' : (unit.pausedByCommand ? 'Paused' : 'Idle');

            // SVG Icons
            const playIcon = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
            const pauseIcon = `<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
            const currentIcon = unit.pausedByCommand ? playIcon : pauseIcon;

            panelContent.innerHTML = `
                <div class="panel-container">
                    <div class="unit-info">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                            <h3 style="margin: 0;">Unit Status</h3>
                            <div class="unit-play-pause-btn ${unit.pausedByCommand ? 'paused' : 'playing'}" 
                                 onclick="window.game.toggleUnitPause()"
                                 title="${unit.pausedByCommand ? 'Resume' : 'Pause'}">
                                ${currentIcon}
                            </div>
                        </div>
                        <div class="stat-grid">
                            <div class="stat-item">
                                <div class="stat-label">Speed</div>
                                <div class="stat-value accent">${unit.speed.toFixed(1)}</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-label">Turn Rate</div>
                                <div class="stat-value">${unit.turnSpeed.toFixed(1)}</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-label">Altitude</div>
                                <div class="stat-value">${altitude}</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-label">Status</div>
                                <div class="stat-value">
                                    <span class="status-badge ${statusClass}">
                                        <span class="status-dot"></span>
                                        ${statusText}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="command-queue">
                        <h3>Command Queue</h3>
                        <div class="playback-controls">
                            <button class="ctrl-btn primary" id="play-btn">▶ Play</button>
                            <button class="ctrl-btn" id="pause-btn">⏸ Pause</button>
                            <button class="ctrl-btn danger" id="clear-btn">✕ Clear</button>
                        </div>
                        ${commandQueueHTML}
                        <p class="hint-text"><kbd>Shift</kbd> + <kbd>Click</kbd> to add waypoints</p>
                    </div>
                </div>
            `;

            // Setup drag reorder listeners
            this.setupCommandQueueDragListeners();

            // Setup playback button listeners
            this.setupPlaybackButtons();
        }
    }

    setupCommandQueueDragListeners() {
        const list = document.getElementById('command-queue-list');
        if (!list) return;

        let draggedItem = null;

        list.querySelectorAll('.command-item').forEach(item => {
            item.addEventListener('dragstart', (e) => {
                draggedItem = item;
                item.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            });

            item.addEventListener('dragend', () => {
                item.classList.remove('dragging');
                draggedItem = null;
            });

            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (draggedItem && draggedItem !== item) {
                    const rect = item.getBoundingClientRect();
                    const midY = rect.top + rect.height / 2;
                    if (e.clientY < midY) {
                        item.parentNode.insertBefore(draggedItem, item);
                    } else {
                        item.parentNode.insertBefore(draggedItem, item.nextSibling);
                    }
                }
            });

            item.addEventListener('drop', () => {
                // Reorder control points based on new DOM order
                this.reorderWaypointsFromDOM();
            });
        });
    }

    reorderWaypointsFromDOM() {
        const list = document.getElementById('command-queue-list');
        const unit = this.selectedUnit;
        if (!list || !unit || !unit.waypointControlPoints) return;

        const items = list.querySelectorAll('.command-item');
        const newOrderIndices = Array.from(items).map(item => parseInt(item.dataset.index));
        // 1. Reorder CONTROL POINTS
        const reorderedPoints = newOrderIndices.map(i => unit.waypointControlPoints[i]);
        unit.waypointControlPoints = reorderedPoints;

        // 1.5. Reorder WAYPOINTS (IDs) - Critical for robustness
        if (unit.waypoints) {
            const oldWaypoints = [...unit.waypoints];
            const reorderedWPs = newOrderIndices.map(i => oldWaypoints[i]);
            unit.waypoints = reorderedWPs;
        }

        // 2. Reorder MARKERS (Visuals) to match
        // Map old indices to markers, then reassemble
        // We have to accept that unit.waypointMarkers[i] corresponds to unit.waypointControlPoints[i] BEFORE sort
        const oldMarkers = [...unit.waypointMarkers];
        const reorderedMarkers = newOrderIndices.map(i => oldMarkers[i]);
        unit.waypointMarkers = reorderedMarkers;

        // 3. Update Labels (0, 1, 2...)
        // Renumber markers to reflect new sequence
        unit.waypointMarkers.forEach((marker, newIndex) => {
            // Update metadata
            marker.userData.controlPointIndex = newIndex;
            marker.userData.waypointNumber = newIndex;

            // Update Label Sprite
            if (marker.userData.labelSprite) {
                // Dispose old sprite material
                this.scene.remove(marker.userData.labelSprite);
                if (marker.userData.labelSprite.material.map) marker.userData.labelSprite.material.map.dispose();
                marker.userData.labelSprite.material.dispose();

                // Create new sprite with correct number
                const newLabel = this.createNumberSprite(newIndex);
                newLabel.position.copy(marker.position);
                newLabel.renderOrder = 15;
                marker.userData.labelSprite = newLabel;
                this.scene.add(newLabel);
            }
        });

        // Regenerate curve
        // Force full regenerate, no transition optimization for now? 
        // Logic in updateWaypointCurve will try to smooth rejoin.
        this.updateWaypointCurve();

        // Update panel to reflect new indices
        if (this.focusedUnit) {
            this.updatePanelContent(this.focusedUnit);
        }

        console.log("Waypoints & Markers reordered successfully.", newOrderIndices);
    }

    setupPlaybackButtons() {
        const playBtn = document.getElementById('play-btn');
        const pauseBtn = document.getElementById('pause-btn');
        const clearBtn = document.getElementById('clear-btn');

        if (playBtn) {
            playBtn.addEventListener('click', () => {
                const unit = this.selectedUnit;
                if (unit && unit.waypointControlPoints && unit.waypointControlPoints.length >= 2) {
                    // Reset command pause
                    unit.setCommandPause(false);

                    // CRITICAL: Reset water state so unit can move again
                    unit.waterState = 'normal';

                    // Resume path following
                    unit.isFollowingPath = true;

                    // Find closest point on path to resume
                    if (unit.path && unit.path.length > 0) {
                        let closest = 0;
                        let minDist = Infinity;
                        for (let i = 0; i < unit.path.length; i++) {
                            const d = unit.position.distanceTo(unit.path[i]);
                            if (d < minDist) { minDist = d; closest = i; }
                        }
                        unit.pathIndex = closest;
                    }

                    console.log("Playback: PLAY - Reset waterState and resumed path");
                }
            });
        }

        if (pauseBtn) {
            pauseBtn.addEventListener('click', () => {
                if (this.selectedUnit) {
                    this.selectedUnit.setCommandPause(true);
                    console.log("Playback: PAUSE (Command)");
                }
            });
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                this.clearWaypointMarkers(); // This method already uses this.selectedUnit
                if (this.selectedUnit) {
                    this.selectedUnit.path = [];
                    this.selectedUnit.isFollowingPath = false;
                }
                if (this.focusedUnit) {
                    this.updatePanelContent(this.focusedUnit);
                }
                console.log("Playback: CLEAR");
            });
        }
    }

    updatePathVisuals() {
        if (this.currentPath.length > 0) {
            this.pathGeometry.setFromPoints(this.currentPath);
        } else if (this.selectedUnit && this.selectedUnit.path && this.selectedUnit.path.length > 0) {
            // Show unit's path
            this.pathGeometry.setFromPoints(this.selectedUnit.path);
        } else {
            // Clear
            this.pathGeometry.setFromPoints([]);
        }
    }

    /**
     * Position camera above a unit with a combined side/top view.
     */
    positionCameraAboveUnit(unit) {
        const unitPos = unit.position.clone();
        const up = unitPos.clone().normalize();

        // Camera distance from unit
        const distance = 30;

        // Position above and slightly to the side
        // Mix of "up" (radial) and a tangent direction for side view
        const tangent = new THREE.Vector3(1, 0, 0).cross(up).normalize();
        if (tangent.lengthSq() < 0.01) {
            tangent.set(0, 1, 0).cross(up).normalize();
        }

        // 60% up, 40% side for combined view
        const cameraOffset = up.clone().multiplyScalar(0.6)
            .add(tangent.clone().multiplyScalar(0.4))
            .normalize()
            .multiplyScalar(distance);

        const cameraPos = unitPos.clone().add(cameraOffset);

        // Set camera position
        this.camera.position.copy(cameraPos);

        // Look at the unit
        const lookMatrix = new THREE.Matrix4();
        lookMatrix.lookAt(cameraPos, unitPos, up);
        this.camera.quaternion.setFromRotationMatrix(lookMatrix);

        // Sync camera controller targets
        this.cameraControls.targetPosition.copy(cameraPos);
        this.cameraControls.targetQuaternion.copy(this.camera.quaternion);
    }

    start() {
        // Initialize Audio Manager with camera
        if (this.audioManager) {
            this.audioManager.init(this.camera);
        }

        this.animate();
        // Preloader fade is handled by Main.js onFirstRender callback
    }

    onWindowResize() {
        const width = window.innerWidth;
        // Always use full height - panel is overlay, doesn't affect canvas
        const height = window.innerHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    update() {
        this.cameraControls.update(0.016); // Update State


        const keys = this.input.getKeys();

        // Auto-Chase: ONLY when Manual Driving
        if (this.selectedUnit && (keys.forward || keys.backward || keys.left || keys.right)) {
            // First keyboard press: transition to third-person view
            if (this.cameraControls.chaseMode === 'drone') {
                this.cameraControls.transitionToThirdPerson(this.selectedUnit);
                // Note: transitionToThirdPerson sets chaseTarget internally
            } else if (!this.cameraControls.isFlying) {
                // Only set chase target if NOT currently transitioning (no duplicate movement)
                this.cameraControls.setChaseTarget(this.selectedUnit);
            }
        } else if (this.selectedUnit && this.cameraControls.chaseMode === 'thirdPerson') {
            // Keep chase target ONLY in third-person mode for smooth following
            // Do NOT set chase target in drone mode (prevents auto third-person transition)
            if (!this.cameraControls.isFlying) {
                this.cameraControls.setChaseTarget(this.selectedUnit);
            }
        }

        // Update all units
        this.units.forEach(unit => {
            // Skip null units (not yet loaded)
            if (!unit) return;

            // Sync params
            unit.speed = this.unitParams.speed;
            unit.turnSpeed = this.unitParams.turnSpeed;
            unit.groundOffset = this.unitParams.groundOffset;
            unit.smoothingRadius = this.unitParams.smoothingRadius;

            if (unit === this.selectedUnit) {
                unit.update(keys, 0.016);
            } else {
                unit.update({ forward: false, backward: false, left: false, right: false }, 0.016);
            }

            // Update tire tracks for all units
            if (!unit.tireTrackSegments) {
                unit.initTireTracks(this.scene);
            }
            unit.updateTireTracks(0.016);
        });

        // Update waypoint marker fill states
        this.updateWaypointMarkerFill();

        // Update Command Queue UI colors if panel is open
        if (this.isFocusMode && this.focusedUnit && this.focusedUnit.waypointMarkers && this.focusedUnit.waypointMarkers.length > 0) {
            this.updatePanelContent(this.focusedUnit);
        }

        // Handle path looping (if unit reached end of path)
        this.handlePathLooping();

        // Update Vision Helper to follow selected unit
        if (this.visionHelper && this.selectedUnit) {
            this.visionHelper.position.copy(this.selectedUnit.position);
            const r = this.fogOfWar.currentVisionRadius || 40.0;
            this.visionHelper.scale.set(r / 15, r / 15, r / 15);
        }

        // Update visibility indicator
        const visIndicator = document.getElementById('visibility-indicator');
        if (visIndicator) {
            if (this.selectedUnit && this.cameraControls) {
                visIndicator.classList.remove('hidden');
                const obstructionHeight = this.cameraControls.currentObstructionHeight || 0;
                const isObstructed = obstructionHeight > 1.0; // If camera had to rise more than 1 unit

                if (isObstructed) {
                    visIndicator.classList.add('obstructed');
                    visIndicator.querySelector('.visibility-text').textContent = 'OBSTRUCTED';
                } else {
                    visIndicator.classList.remove('obstructed');
                    visIndicator.querySelector('.visibility-text').textContent = 'VISIBLE';
                }
            } else {
                visIndicator.classList.add('hidden');
            }
        }

        // Update FOW with ALL units
        if (this.units.length > 0) {
            this.fogOfWar.update(this.units);
        }

        // Update water animation (waves + FOW)
        if (this.planet && this.planet.updateWater) {
            const dt = this.clock ? this.clock.getDelta() : 1 / 60;
            this.planet.updateWater(dt, this.units, this.fogOfWar);
        }

        // Update Planet Uniforms
        if (this.planet.mesh.material.materialShader) {
            this.planet.mesh.material.materialShader.uniforms.uFogTexture.value = this.fogOfWar.exploredTarget.texture;
            this.planet.mesh.material.materialShader.uniforms.uVisibleTexture.value = this.fogOfWar.visibleTarget.texture;
        }
        if (this.planet.waterMesh.material.materialShader) {
            this.planet.waterMesh.material.materialShader.uniforms.uFogTexture.value = this.fogOfWar.exploredTarget.texture;
            this.planet.waterMesh.material.materialShader.uniforms.uVisibleTexture.value = this.fogOfWar.visibleTarget.texture;
        }
        // Update starField FOW texture
        if (this.planet.starField && this.planet.starField.material.uniforms) {
            this.planet.starField.material.uniforms.uFogTexture.value = this.fogOfWar.exploredTarget.texture;
        }

        // Update Camera
        if (this.cameraControls) {
            this.cameraControls.update(0.016);
        }

        // Update Path Visuals
        this.updatePathVisuals();

        // Update Audio System
        if (this.audioManager) {
            // Distance from planet center (Origin)
            const camDist = this.camera.position.length();
            this.audioManager.update(camDist, this.units);
        }
    }

    animate() {
        this.update();
        this.renderer.render(this.scene, this.camera);

        // Trigger onFirstRender callback after enough frames to ensure content visible
        // Wait for 30 frames (about 0.5s at 60fps) to ensure textures loaded
        if (!this._frameCount) this._frameCount = 0;
        this._frameCount++;

        if (this.onFirstRender && !this._firstRenderDone && this._frameCount > 30) {
            this._firstRenderDone = true;
            this.onFirstRender();
        }

        if (this.textureDebugger) {
            this.textureDebugger.update();
        }

        requestAnimationFrame(this.animate);
    }

    toggleUnitPause(unitId) {
        let unit = this.focusedUnit;
        if (unitId) {
            unit = this.units.find(u => u.id == unitId);
        }

        if (!unit) return;

        unit.pausedByCommand = !unit.pausedByCommand;

        console.log(`Unit ${unit.id} Paused: ${unit.pausedByCommand}`);

        if (this.isFocusMode && this.focusedUnit === unit) {
            this.updatePanelContent(unit);
        }
    }
}
