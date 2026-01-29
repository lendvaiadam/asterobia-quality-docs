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
import { PathPlanner } from '../Navigation/PathPlanner.js';
import { SimLoop } from '../SimCore/runtime/SimLoop.js';
import { nextEntityId } from '../SimCore/runtime/IdGenerator.js';
import { rngNext } from '../SimCore/runtime/SeededRNG.js';
import { globalCommandQueue, CommandType } from '../SimCore/runtime/CommandQueue.js';

import { WaypointDebugOverlay } from '../UI/WaypointDebugOverlay.js';
import { globalCommandDebugOverlay } from '../UI/CommandDebugOverlay.js';

export class Game {
    constructor() {
        // ... (existing)
        this.debugOverlay = new WaypointDebugOverlay(this);
        this.commandDebugOverlay = globalCommandDebugOverlay; // R006: Command debug overlay
        window.game = this; // Expose for UI interactions

        // R001: Fixed-timestep simulation loop (50ms tick)
        this.simLoop = new SimLoop({ fixedDtMs: 50 });
        this.simLoop.onSimTick = (dt, tick) => this.simTick(dt, tick);
        this.container = document.body;

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.container.appendChild(this.renderer.domElement);

        // R006-fix: Enable canvas to receive keyboard focus
        this._setupCanvasFocus();

        // Scene
        this.scene = new THREE.Scene();

        // Starfield
        this.starDistance = 500; // Distance to stars from origin

        const starGeometry = new THREE.BufferGeometry();
        const starCount = 10000;
        const positions = new Float32Array(starCount * 3);

        // visual-only randomness, nondeterministic allowed (starfield cosmetics)
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
        this.ambientLight = new THREE.AmbientLight(0x405060, 0.9);
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

        // Asset Loading Manager
        this.loadingManager = new THREE.LoadingManager();
        this.assetsLoaded = false;

        this.loadingManager.onLoad = () => {
            console.log('[Game] All assets loaded!');
            this.assetsLoaded = true;
        };

        this.loadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
            console.log(`[Game] Loading file: ${url}.\nLoaded ${itemsLoaded} of ${itemsTotal} files.`);
        };

        this.loadingManager.onError = (url) => {
            console.error('[Game] There was an error loading ' + url);
        };

        // World
        this.planet = new Planet(this.scene, this.loadingManager);
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
        this.rockSystem = new RockSystem(this, this.planet); // Rocks are procedural, no external assets effectively
        this.rockSystem.generateRocks(); // Initial generation 
        this.planet.rockSystem = this.rockSystem; // Make accessible to Units

        // Rock Collision System (Broadphase + Slide)
        this.rockCollision = new RockCollisionSystem(this.planet, this.rockSystem);
        this.planet.rockCollision = this.rockCollision; // Make accessible to Units

        // Navigation Mesh (Spherical PathFinding)
        this.navMesh = new SphericalNavMesh(this.planet.terrain, this.rockSystem);
        this.navMesh.generate();
        this.scene.add(this.navMesh.debugMesh);
        
        // Path Planner (Hierarchical: Global A* + Local Refinement)
        this.pathPlanner = new PathPlanner(this.navMesh, this.rockSystem, this.planet.terrain);
        const sphereGeo = new THREE.SphereGeometry(15, 16, 16);
        const sphereMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true, transparent: true, opacity: 0.2 });
        this.visionHelper = new THREE.Mesh(sphereGeo, sphereMat);
        this.visionHelper.visible = false; // Hidden by default
        console.log("Vision Helper is hidden. To enable: game.visionHelper.visible = true");
        this.scene.add(this.visionHelper);

        // UI
        this.unit = new Unit(this.planet, nextEntityId()); // Dummy for initial DebugPanel (R003: deterministic ID)
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
        // Use the centralized loading manager
        const loader = new GLTFLoader(this.loadingManager);
        // All 5 units - Unit 1 spawns in front of camera
        const models = ['1.glb', '2.glb', '3.glb', '4.glb', '5.glb'];
        let loadedCount = 0;

        // Pre-allocate units array to preserve order
        this.units = new Array(models.length).fill(null);

        models.forEach((modelName, index) => {
            loader.load(`./modellek/${modelName}`, (gltf) => {
                const model = gltf.scene;

                // Create a Unit wrapper (R003: deterministic ID)
                const unitId = nextEntityId();
                const unit = new Unit(this.planet, unitId);
                unit.name = `Unit ${unitId}`; // Set unit name from ID

                // Replace the default cube mesh with the loaded model
                // CRITICAL FIX: Do NOT replace unit.mesh (Group). Add model TO it.
                // Remove the dummy body mesh first (if exposed, or try finding it)
                if (unit.bodyMesh) {
                    unit.mesh.remove(unit.bodyMesh);
                } else {
                    // Fallback: Remove first mesh child that isn't the ring
                    // But expose worked, so we use unit.bodyMesh
                }
                
                // Add GLTF model to the Unit's Group
                unit.mesh.add(model);
                
                // Apply shadow props to model
                model.traverse((child) => {
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                        child.renderOrder = 20;
                    }
                });
                
                // Ensure unit.mesh is in scene (it is added by default? No need to remove/add)
                // If it was already in scene, this update is visible immediately.
                this.scene.add(unit.mesh); // Ensure it's there

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
                    // Phase 1: Spawn Safety - Retry to avoid rocks
                    const randomPos = new THREE.Vector3();
                    let safeFound = false;
                    const maxRetries = 15;

                    for (let r = 0; r < maxRetries; r++) {
                        // R004: seeded RNG for deterministic spawn positions
                        const theta = rngNext() * Math.PI * 2;
                        const phi = Math.acos(2 * rngNext() - 1);
                        const radius = this.planet.terrain.params.radius + 10;

                        randomPos.set(
                            radius * Math.sin(phi) * Math.cos(theta),
                            radius * Math.sin(phi) * Math.sin(theta),
                            radius * Math.cos(phi)
                        );
                        
                        // Check against rocks
                        let collision = false;
                        if (this.rockSystem && this.rockSystem.rocks) {
                            for (const rock of this.rockSystem.rocks) {
                                // Safe distance check: Rock radius (~2-3) + Unit (~1) + Buffer
                                // Fix: Increased from 4.0 to 7.0 to account for large rocks (scale 3.0)
                                if (rock.position.distanceTo(randomPos) < 7.0) {
                                    collision = true;
                                    break;
                                }
                            }
                        }
                        
                        // FIX: Also check for WATER - unit cannot spawn underwater
                        if (!collision && this.planet && this.planet.terrain) {
                            const waterLevel = this.planet.terrain.params.waterLevel || 0;
                            const baseRadius = this.planet.terrain.params.radius;
                            const waterRadius = baseRadius + waterLevel;
                            
                            // Project spawn pos to terrain surface to check actual height
                            const dir = randomPos.clone().normalize();
                            const actualTerrainRadius = this.planet.terrain.getRadiusAt(dir);
                            
                            if (actualTerrainRadius < waterRadius + 0.5) {
                                collision = true; // Underwater - try again
                            }
                        }

                        if (!collision) {
                            safeFound = true;
                            break;
                        }
                    }

                    if (!safeFound) {
                        console.warn(`[Game] Could not find safe spawn for Unit ${index+1} after ${maxRetries} tries.`);
                    }

                    unit.position.copy(randomPos);
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
                    
                    // FIX: Activate selection visuals immediately
                    // Without this, selectUnit() skips setSelection() because isSameUnit === true
                    unit.setSelection(true);

                    // Position camera above unit 1 with side/top view
                    this.positionCameraAboveUnit(unit);
                }
            });
        });
    }

    // === Interaction Delegates (V3) ===

    selectUnit(unit, skipCamera = false) {
        const isSameUnit = (this.selectedUnit === unit);
        
        // Only do visual selection changes if different unit
        if (!isSameUnit) {
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
        }

        // ALWAYS sync focusedUnit and update panel (even for same unit)
        this.focusedUnit = unit;
        this.updatePanelContent(unit);
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

            // Tab Hover Events: Show waypoints at 50% scale when hovering
            tab.addEventListener('mouseenter', () => {
                const hoveredUnit = this.units[index];
                if (hoveredUnit && hoveredUnit !== this.selectedUnit) {
                    hoveredUnit.isHovered = true;
                    this.showUnitMarkers(hoveredUnit, 0.5); // 50% scale
                }
            });

            tab.addEventListener('mouseleave', () => {
                const hoveredUnit = this.units[index];
                if (hoveredUnit && hoveredUnit !== this.selectedUnit) {
                    hoveredUnit.isHovered = false;
                    this.hideUnitMarkers(hoveredUnit);
                }
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

    showUnitMarkers(unit, scale = 0.5) {
        if (!unit) return;

        if (unit.waypointMarkers) {
            unit.waypointMarkers.forEach(m => {
                m.visible = true;
                m.scale.setScalar(scale); // Apply scale (1.0 = full, 0.5 = half)
                if (m.userData.labelSprite) {
                    m.userData.labelSprite.visible = true;
                    m.userData.labelSprite.scale.setScalar(scale);
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

    // === UNIFIED COMMAND QUEUE METHODS ===

    addCommand(unit, type, params = {}) {
        // R004: deterministic command ID from entity counter
        const id = 'cmd_' + nextEntityId();
        
        const command = {
            id: id,
            type: type, // 'Move', 'Wait', 'Attack', 'Build'
            params: params, // { position: Vector3, seconds: Number, etc. }
            status: 'pending'
        };

        // AUTO-INIT: If this is the FIRST Move command, add unit's current position as Start Point
        // This replicates legacy behavior where the first waypoint is the start position.
        const moveCommands = unit.commands.filter(c => c.type === 'Move');
        if (moveCommands.length === 0 && type === 'Move') {
             // R004: deterministic start command ID
             const startCmdId = 'cmd_start_' + nextEntityId();
             const startCmd = {
                 id: startCmdId,
                 type: 'Move',
                 params: { position: unit.position.clone() },
                 status: 'completed' // Start point is implicitly completed/passed
             };
             // Insert at beginning
             unit.commands.unshift(startCmd);
        }
        
        unit.commands.push(command);
        
        this.syncWaypointsFromCommands(unit);
        
        if (this.isFocusMode && this.focusedUnit === unit) {
            this.updatePanelContent(unit);
        }
        
        return command;
    }

    syncWaypointsFromCommands(unit) {
        // 1. Rebuild unit.waypoints from commands
        unit.waypoints = [];
        unit.waypointControlPoints = [];
        
        // Map commands to waypoints (Spatial commands only)
        unit.commands.forEach((cmd, index) => {
            if (cmd.type === 'Move' || (cmd.type === 'Build' && cmd.params.position)) {
                // Ensure position is a Vector3
                const pos = cmd.params.position instanceof THREE.Vector3 ? cmd.params.position : new THREE.Vector3().copy(cmd.params.position);
                
                const wp = {
                    id: cmd.id, // Link: Waypoint ID == Command ID
                    position: pos,
                    commandIndex: index,
                    // Preserve legacy states
                    logicalState: (cmd.status === 'completed') ? 'left' : 'neutral',
                    actionStartedCount: 0,
                    isStartMarker: (unit.waypoints.length === 0)
                };
                
                unit.waypoints.push(wp);
                unit.waypointControlPoints.push(wp.position);
            }
        });
        
        // 2. Sync Visual Markers
        // Ensure unit.waypointMarkers matches unit.waypoints length
        
        // Remove excess markers
        while (unit.waypointMarkers.length > unit.waypoints.length) {
            const m = unit.waypointMarkers.pop();
            this.scene.remove(m);
            if (m.userData.labelSprite) this.scene.remove(m.userData.labelSprite);
            if (m.geometry) m.geometry.dispose();
            if (m.material) m.material.dispose();
        }
        
        // Update/Create markers
        unit.waypoints.forEach((wp, i) => {
            let marker = unit.waypointMarkers[i];
            
            if (!marker) {
                // CREATE NEW MARKER
                const markerGeo = new THREE.SphereGeometry(0.8, 16, 16);
                const markerMat = new THREE.MeshBasicMaterial({
                    color: 0x00ff88,
                    transparent: true,
                    opacity: 0.7,
                    depthTest: false,
                    depthWrite: false
                });
                marker = new THREE.Mesh(markerGeo, markerMat);
                unit.waypointMarkers.push(marker);
                this.scene.add(marker);
                
                // Label
                const label = this.createNumberSprite(i);
                label.renderOrder = 15;
                marker.userData.labelSprite = label;
                this.scene.add(label);
            }
            
            // Sync Position (Snap to surface)
            const dir = wp.position.clone().normalize();
            // Safety: if position is (0,0,0) or invalid?
            if (dir.lengthSq() < 0.1) dir.set(0, 1, 0); 
            
            const terrainRadius = this.planet.terrain.getRadiusAt(dir);
            const markerPos = dir.clone().multiplyScalar(terrainRadius);
            
            marker.position.copy(markerPos);
            // Also update internal position to match snapped surface
            // wp.position.copy(markerPos); // Optional: force snap
            
            if (marker.userData.labelSprite) {
                marker.userData.labelSprite.position.copy(markerPos);
            }
            
            // Check label number consistency
            if (marker.userData.waypointNumber !== i) {
                 this.scene.remove(marker.userData.labelSprite);
                 const label = this.createNumberSprite(i);
                 label.position.copy(marker.position);
                 label.renderOrder = 15;
                 marker.userData.labelSprite = label;
                 this.scene.add(label);
            }
            
            // Update Metadata
            marker.userData.id = wp.id;
            marker.userData.unitId = unit.id;
            marker.userData.waypointNumber = i;
            marker.userData.controlPointIndex = i;
            marker.userData.isStartMarker = (i === 0);
            marker.userData.isFilled = (i === 0); 
            
            marker.scale.setScalar(0.5);
        });
        
        // 3. Update Curve Visualization
        this.updateWaypointCurve();
    }

    addWaypoint(point) {
        if (!this.selectedUnit) return;
        // Wrapper for legacy calls -> New Command System
        this.addCommand(this.selectedUnit, 'Move', { position: point.clone() });
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

        // === CRITICAL: RE-CALCULATE TARGET BASED ON CURRENT SEQUENCE ===
        // User Requirement: lastWaypointId is STABLE on reorder/drag.
        // targetWaypointId = next waypoint AFTER lastWaypointId in CURRENT order.
        // This MUST run on every curve update to handle reordering!
        if (unit.waypoints && unit.waypoints.length > 0) {
            let newTargetIndex = 1; // Default

            if (unit.lastWaypointId) {
                const lastIdx = unit.waypoints.findIndex(wp => wp.id === unit.lastWaypointId);

                if (lastIdx !== -1) {
                    // Anchor found. Target is Next in current sequence.
                    newTargetIndex = lastIdx + 1;

                    // Loop Handling
                    if (newTargetIndex >= unit.waypoints.length) {
                        if (unit.isPathClosed) newTargetIndex = 0;
                        else newTargetIndex = unit.waypoints.length - 1; // Stay at end
                    }
                    
                    // ALWAYS update targetWaypointId to reflect current sequence order
                    const newTarget = unit.waypoints[newTargetIndex];
                    const oldTargetId = unit.targetWaypointId;
                    
                    if (newTarget && newTarget.id !== oldTargetId) {
                        unit.targetWaypointId = newTarget.id;
                        console.log(`[REORDER] Target updated: ${oldTargetId?.slice(-4)} → ${newTarget.id?.slice(-4)} (after lastWaypointId ${unit.lastWaypointId?.slice(-4)})`);
                        
                        // Update logical states
                        unit.waypoints.forEach(wp => {
                            if (wp.id === unit.lastWaypointId) {
                                wp.logicalState = 'left';
                            } else if (wp.id === unit.targetWaypointId) {
                                wp.logicalState = 'approaching';
                            } else {
                                wp.logicalState = 'neutral';
                            }
                        });
                    }
                } else {
                    // Anchor (lastWaypointId) was DELETED.
                    // Default to Index 1 (reset), but preserve lastWaypointId as stale reference
                    newTargetIndex = 1;
                    if (unit.waypoints.length < 2) newTargetIndex = 0;
                    
                    const newTarget = unit.waypoints[newTargetIndex];
                    if (newTarget) {
                        unit.targetWaypointId = newTarget.id;
                    }
                }
            } else {
                // No Anchor (Start) - Initialize
                newTargetIndex = 1;
                if (unit.waypoints.length < 2) newTargetIndex = 0;
                
                const newTarget = unit.waypoints[newTargetIndex];
                if (newTarget && !unit.targetWaypointId) {
                    unit.targetWaypointId = newTarget.id;
                    newTarget.logicalState = 'approaching';
                    
                    // Initialize lastWaypointId to first waypoint if not set
                    if (!unit.lastWaypointId && unit.waypoints.length > 0) {
                        unit.lastWaypointId = unit.waypoints[0].id;
                        unit.waypoints[0].logicalState = 'left';
                    }
                }
            }
        }

        // ============================================================================
        // BEZIER PATH GENERATION SYSTEM
        // ============================================================================
        // This system generates smooth, continuous paths through waypoints using
        // Cubic Bezier curves. Key features:
        // 
        // 1. AUTOMATIC TANGENT CALCULATION
        //    - Direction: (nextPoint - prevPoint).normalize()
        //    - Length: 40% of distance to neighbor
        //    - Collinear: in-tangent and out-tangent are on same line (C1 continuity)
        //
        // 2. OBSTACLE AVOIDANCE INTEGRATION
        //    - PathPlanner provides key detour points around rocks
        //    - These become additional Bezier waypoints
        //
        // 3. TERRAIN PROJECTION
        //    - Every sampled point is projected to terrain surface
        //    - Maintains correct altitude on hills/valleys
        //
        // 4. LOOP PATH SUPPORT
        //    - Closed paths connect last waypoint back to first
        //    - Tangents wrap around correctly
        // ============================================================================
        
        const groundOffset = unit.groundOffset || 0.5;
        const controlPoints = unit.waypointControlPoints;
        
        if (!controlPoints || controlPoints.length < 2) {
            // Not enough points for a path
            unit.path = [];
            return;
        }
        
        // ============================================================================
        // STEP 1: COLLECT ALL PATH WAYPOINTS (User waypoints + Obstacle detours)
        // ============================================================================
        // First, we need to build a complete list of waypoints that includes:
        // - Original user-placed control points
        // - Additional points from PathPlanner to navigate around obstacles
        
        let allWaypoints = [];
        const unitRadius = unit.collisionRadius || 1.5;
        
        if (this.pathPlanner && controlPoints.length >= 2) {
            for (let i = 0; i < controlPoints.length - 1; i++) {
                const segStart = controlPoints[i];
                const segEnd = controlPoints[i + 1];
                
                // Always add the start point
                allWaypoints.push(segStart.clone());
                
                // Check if this segment has obstacles
                if (this.pathPlanner.hasObstacle(segStart, segEnd)) {
                    // Get detour path from PathPlanner (A* around obstacles)
                    const detourPath = this.pathPlanner.refineSegment(segStart, segEnd, unitRadius);
                    
                    // SIMPLIFY detour: We don't need every A* grid point
                    // Keep only significant direction changes (Douglas-Peucker style)
                    // For now, sample every 5m along the detour
                    const minSpacing = 5.0;
                    let lastAdded = segStart;
                    
                    for (let j = 1; j < detourPath.length - 1; j++) {
                        const pt = detourPath[j];
                        if (pt.distanceTo(lastAdded) >= minSpacing) {
                            // NaN safety check
                            if (!isNaN(pt.x) && !isNaN(pt.y) && !isNaN(pt.z)) {
                                allWaypoints.push(pt.clone());
                                lastAdded = pt;
                            }
                        }
                    }
                }
                // End point is handled by next iteration (or final push)
            }
            
            // Add final control point
            const lastCP = controlPoints[controlPoints.length - 1];
            if (lastCP && !isNaN(lastCP.x)) {
                allWaypoints.push(lastCP.clone());
            }
            
            // Handle closed path: check segment from last to first
            if (unit.isPathClosed) {
                const lastWP = controlPoints[controlPoints.length - 1];
                const firstWP = controlPoints[0];
                
                if (this.pathPlanner.hasObstacle(lastWP, firstWP)) {
                    const detourPath = this.pathPlanner.refineSegment(lastWP, firstWP, unitRadius);
                    const minSpacing = 5.0;
                    let lastAdded = lastWP;
                    
                    for (let j = 1; j < detourPath.length - 1; j++) {
                        const pt = detourPath[j];
                        if (pt.distanceTo(lastAdded) >= minSpacing) {
                            if (!isNaN(pt.x) && !isNaN(pt.y) && !isNaN(pt.z)) {
                                allWaypoints.push(pt.clone());
                                lastAdded = pt;
                            }
                        }
                    }
                }
            }
        } else {
            // No PathPlanner - use raw control points
            allWaypoints = controlPoints.map(p => p.clone());
        }
        
        // ============================================================================
        // STEP 2: CALCULATE AUTOMATIC TANGENTS FOR EACH WAYPOINT
        // ============================================================================
        // For smooth C1 continuity, each waypoint needs:
        // - inTangent: direction arriving at this point
        // - outTangent: direction leaving this point
        // 
        // These must be COLLINEAR (on same line) for smooth curves.
        // 
        // Tangent direction = (nextPoint - prevPoint).normalize()
        // Tangent length = 40% of distance to respective neighbor
        // ============================================================================
        
        const waypointsWithTangents = [];
        const n = allWaypoints.length;
        const tangentScale = 0.35; // 35% of segment length (increased for smoother curves)
        
        for (let i = 0; i < n; i++) {
            const current = allWaypoints[i];
            
            // Determine neighbors (with wrap-around for closed paths)
            let prev, next;
            
            if (i === 0) {
                // FIRST POINT
                if (unit.isPathClosed) {
                    prev = allWaypoints[n - 1];
                    next = allWaypoints[1];
                } else {
                    // Open path: use direction TO next point (no prev)
                    prev = current; // Will be handled below
                    next = allWaypoints[Math.min(1, n - 1)];
                }
            } else if (i === n - 1) {
                // LAST POINT
                if (unit.isPathClosed) {
                    prev = allWaypoints[n - 2];
                    next = allWaypoints[0];
                } else {
                    // Open path: use direction FROM prev point (no next)
                    prev = allWaypoints[n - 2];
                    next = current; // Will be handled below
                }
            } else {
                prev = allWaypoints[i - 1];
                next = allWaypoints[i + 1];
            }
            
            // Calculate tangent DIRECTION (collinear for C1 continuity)
            // IMPORTANT: Use AVERAGE of NORMALIZED directions, NOT (next - prev)
            // This ensures distance doesn't affect tangent direction - only direction matters
            let tangentDir;
            
            if (prev === current && next !== current) {
                // First point of open path: use direction TO next
                tangentDir = next.clone().sub(current).normalize();
            } else if (next === current && prev !== current) {
                // Last point of open path: use direction FROM prev
                tangentDir = current.clone().sub(prev).normalize();
            } else if (prev === current && next === current) {
                // Degenerate case: single point path
                tangentDir = new THREE.Vector3(0, 0, 1);
            } else {
                // Normal case: AVERAGE of normalized directions (ignores distance)
                const dirFromPrev = current.clone().sub(prev).normalize();
                const dirToNext = next.clone().sub(current).normalize();
                tangentDir = dirFromPrev.add(dirToNext).normalize();
            }
            
            // Safety check for zero-length tangent
            if (tangentDir.lengthSq() < 0.001) {
                tangentDir.set(0, 0, 1);
            }
            
            // Calculate tangent LENGTHS (proportional to segment distances)
            // REDUCED to 25% to prevent loops and breaks
            const distToPrev = current.distanceTo(prev);
            const distToNext = current.distanceTo(next);
            
            // MAX TANGENT LENGTH to prevent self-crossing (loop prevention)
            const maxTangentLength = 10.0; // Increased for smoother curves at waypoints
            const inTangentLength = Math.min(distToPrev * tangentScale, maxTangentLength);
            const outTangentLength = Math.min(distToNext * tangentScale, maxTangentLength);
            
            // Calculate actual tangent vectors
            // inTangent points TOWARD this waypoint (from previous direction)
            // outTangent points AWAY from this waypoint (toward next)
            const inTangent = tangentDir.clone().multiplyScalar(-inTangentLength);
            const outTangent = tangentDir.clone().multiplyScalar(outTangentLength);
            
            waypointsWithTangents.push({
                position: current,
                inTangent: inTangent,   // Control point = position + inTangent
                outTangent: outTangent  // Control point = position + outTangent
            });
        }
        
        // ============================================================================
        // STEP 3: GENERATE CUBIC BEZIER CURVE SEGMENTS
        // ============================================================================
        // For each pair of waypoints, create a cubic Bezier segment:
        // 
        // P0 = start waypoint position
        // P1 = P0 + start.outTangent (control point 1)
        // P2 = P3 + end.inTangent (control point 2)
        // P3 = end waypoint position
        //
        // Cubic Bezier formula:
        // B(t) = (1-t)³P0 + 3(1-t)²tP1 + 3(1-t)t²P2 + t³P3
        // ============================================================================
        
        const sampledPath = [];
        const sampleSpacing = 0.5; // Sample every 0.5 meters
        
        const numSegments = unit.isPathClosed ? n : n - 1;
        
        for (let i = 0; i < numSegments; i++) {
            const startIdx = i;
            const endIdx = (i + 1) % n;
            
            const start = waypointsWithTangents[startIdx];
            const end = waypointsWithTangents[endIdx];
            
            // Bezier control points
            const P0 = start.position;
            const P1 = P0.clone().add(start.outTangent);
            const P2 = end.position.clone().add(end.inTangent);
            const P3 = end.position;
            
            // Calculate segment length (approximate)
            const chordLength = P0.distanceTo(P3);
            const numSamples = Math.max(10, Math.ceil(chordLength / sampleSpacing));
            
            // Sample the Bezier curve
            for (let j = 0; j < numSamples; j++) {
                const t = j / numSamples;
                const oneMinusT = 1 - t;
                
                // Cubic Bezier formula
                // B(t) = (1-t)³P0 + 3(1-t)²tP1 + 3(1-t)t²P2 + t³P3
                const point = P0.clone().multiplyScalar(oneMinusT * oneMinusT * oneMinusT)
                    .add(P1.clone().multiplyScalar(3 * oneMinusT * oneMinusT * t))
                    .add(P2.clone().multiplyScalar(3 * oneMinusT * t * t))
                    .add(P3.clone().multiplyScalar(t * t * t));
                
                sampledPath.push(point);
            }
        }
        
        // Add final point for open paths
        if (!unit.isPathClosed && waypointsWithTangents.length > 0) {
            sampledPath.push(waypointsWithTangents[n - 1].position.clone());
        }
        
        // ============================================================================
        // STEP 4: PROJECT ALL POINTS TO TERRAIN SURFACE
        // ============================================================================
        // Each sampled point needs to be placed on the actual terrain surface.
        // This ensures the unit follows hills and valleys correctly.
        // ============================================================================
        
        const projectedPoints = sampledPath.map(p => {
            const dir = p.clone().normalize();
            const terrainRadius = this.planet.terrain.getRadiusAt(dir);
            return dir.multiplyScalar(terrainRadius + groundOffset);
        });
        
        // ============================================================================
        // STEP 5: CREATE VISUALIZATION (TubeGeometry)
        // ============================================================================
        // The projected path is visualized as a thick tube for clarity.
        // CatmullRomCurve3 is used here ONLY for the visual tube, not for pathfinding.
        // ============================================================================
        
        const visualCurve = new THREE.CatmullRomCurve3(projectedPoints, unit.isPathClosed, 'catmullrom', 0.5);

        // Create/update THICK curve visualization
        if (unit.waypointCurveLine) {
            this.scene.remove(unit.waypointCurveLine);
            unit.waypointCurveLine.geometry.dispose();
            unit.waypointCurveLine.material.dispose();
        }

        const tubeGeo = new THREE.TubeGeometry(visualCurve, projectedPoints.length, 0.08, 12, unit.isPathClosed);
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
            
            // === PATH SYNC (LOGICAL SEGMENT-BASED) ===
            // Use targetWaypointId to determine which segment we're in (A→B)
            // Only search within that segment, never skip to further waypoints
            // This fixes the bug where dragging B behind unit causes it to skip B
            
            let segmentStart = 0;
            let segmentEnd = unit.path.length;
            
            // === MANDATORY PATH RE-PROJECTION ===
            // When path geometry changes (drag), the old unit.pathIndex is invalid (points to old array).
            // We MUST find where the unit is on the NEW path.
            
            if (unit.waypoints && unit.waypoints.length > 0) {
                 // 1. Determine Search Range (Current Logical Segment)
                 // This prevents jumping to other parts of the track (e.g. adjacent loops).
                 let searchStart = 0;
                 let searchEnd = unit.path.length;

                 if (unit.targetWaypointId && unit.lastWaypointId && unit.pathSegmentIndices) {
                     // Use ACTUAL lastWaypointId and targetWaypointId for segment search
                     const lastWPIndex = unit.waypoints.findIndex(wp => wp.id === unit.lastWaypointId);
                     const targetWPIndex = unit.waypoints.findIndex(wp => wp.id === unit.targetWaypointId);
                     
                     if (lastWPIndex !== -1 && targetWPIndex !== -1) {
                         // Get path indices for this segment
                         const idxA = unit.pathSegmentIndices[lastWPIndex] || 0;
                         const idxB = unit.pathSegmentIndices[targetWPIndex] || unit.path.length;
                         
                         // Handle Wrap-around or normal case
                         if (idxA < idxB) {
                             // Normal case: A before B
                             searchStart = Math.max(0, idxA);
                             searchEnd = Math.min(unit.path.length, idxB + 10);
                         } else {
                             // Wrapped segment (End -> Start in closed loop)
                             // Search from A to end, then from 0 to B
                             // For simplicity, search whole path but prefer forward direction
                             searchStart = 0;
                             searchEnd = unit.path.length;
                         }
                         
                         // console.log(`[SEGMENT] Searching between lastWp=${lastWPIndex} (pathIdx=${idxA}) and targetWp=${targetWPIndex} (pathIdx=${idxB})`);
                     }
                 }

                 // 2. Find Closest Point in Range
                 let bestIdx = searchStart;
                 let bestDist = Infinity;
                 
                 // Optimization: Step 1 vs Step 10? Dense path (0.5m) so Step 1 is fine.
                 for (let k = searchStart; k < searchEnd; k++) {
                     const dSq = unit.position.distanceToSquared(unit.path[k]);
                     if (dSq < bestDist) {
                         bestDist = dSq;
                         bestIdx = k;
                     }
                 }
                 
                 // 3. Forward Bias (Prevent "Stuck/Turn" Bug)
                 // If the best point is slightly behind, we might get stuck turning back.
                 // Prefer the next point if it's close enough.
                 // Simple hack: Just add +1 or +2 to index to "push" unit forward along the new curve.
                 const lookAhead = 2; // ~1 meter forward
                 let newIndex = bestIdx + lookAhead;
                 if (newIndex >= unit.path.length) newIndex = 0; // Wrap safe
                 
                 // Apply
                 unit.pathIndex = newIndex;
                 // console.log(`[PathRegen] Re-projected Unit to index ${newIndex} (was ${bestIdx})`);
            }

            // SEGMENT RESTRICTION: Only search within the current active segment
            // Use lastWaypointId and targetWaypointId for accurate segment bounds
            let startSearch = 0;
            let endSearch = unit.path.length;

            if (unit.targetWaypointId && unit.lastWaypointId && unit.pathSegmentIndices && unit.waypoints) {
                const lastWPIndex = unit.waypoints.findIndex(wp => wp.id === unit.lastWaypointId);
                const targetWPIndex = unit.waypoints.findIndex(wp => wp.id === unit.targetWaypointId);

                if (lastWPIndex !== -1 && targetWPIndex !== -1) {
                    const startPathIdx = unit.pathSegmentIndices[lastWPIndex] || 0;
                    const endPathIdx = unit.pathSegmentIndices[targetWPIndex] || unit.path.length;

                    if (startPathIdx <= endPathIdx) {
                        const buffer = 5;
                        startSearch = Math.max(0, startPathIdx);
                        endSearch = Math.min(unit.path.length, endPathIdx + buffer);
                    }
                    // For wrapped segments, keep full path search
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

            // === FORWARD CHECK: Use closest point + small lookahead ===
            // Don't use large lookahead - it causes waypoint skipping when new points are added
            const minLookahead = 2; // Just 2 points ahead for smoothness
            let targetIdx = closestIdx + minLookahead;
            
            // Handle wrap/clamp
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

            // === TRANSITION PATH GENERATION (User Requirement) ===
            // If the re-projected point is far away (e.g. dragged curve), 
            // generate a safe path using PathPlanner to avoid obstacles (rocks/water).
            // THROTTLE: Only run every 200ms to prevent freezing during drag.
            const now = Date.now();
            if (this.pathPlanner && (!unit._lastTransitionCheck || now - unit._lastTransitionCheck > 200)) {
                unit._lastTransitionCheck = now;
                
                const targetPoint = unit.path[unit.pathIndex];
                if (targetPoint) {
                    const distToTarget = unit.position.distanceTo(targetPoint);
                    const TRANSITION_THRESHOLD = 3.0; // Meters
                    
                    if (distToTarget > TRANSITION_THRESHOLD) {
                         // Check if we already have a valid transition path close to this target
                         let reusePath = false;
                         if (unit.transitionPath && unit.transitionPath.length > 0) {
                             const lastPt = unit.transitionPath[unit.transitionPath.length - 1];
                             if (lastPt.distanceToSquared(targetPoint) < 4.0) { // 2m tolerance for reuse
                                 reusePath = true; 
                             }
                         }
                         
                         if (!reusePath) {
                             // PLAN PATH (Sync but hierarchical - should be fast)
                             // Use generous radius to ensure clearance
                             const path = this.pathPlanner.planPath(unit.position, targetPoint, { margin: 1.5 });
                             if (path && path.length > 0) {
                                 unit.transitionPath = path;
                                 unit.transitionIndex = 0;
                                 unit.isInTransition = true;
                                 // console.log("[Transition] Generated path to re-join curve", path.length);
                             }
                         }
                    } else if (unit.isInTransition) {
                        // We are close enough to the main path, cancel transition
                        unit.isInTransition = false;
                        unit.transitionPath = null;
                    }
                }
            }
            unit.savedPathIndex = 0;
            unit.isKeyboardOverriding = false;

            console.log(`Path sync: closest=${closestIdx}, target=${targetIdx}`);
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
            // === FALLBACK: Calculate IDs based on pathIndex if not set ===
            // DISABLED: This logic overrides strict ID sequencing based on spatial proximity!
            // When dragging, the path shape changes, and this logic might decide the unit is now
            // "closer" to a previous segment, resetting the target backward.
            // We TRUST the strict transition logic (Unit.js) and initial setup (Game.js).
            
            /*
            if (unit.pathSegmentIndices && unit.pathSegmentIndices.length > 0 && unit.waypoints.length > 1) {
                // ... (Logic removed to prevent "Order Chaos/Color Swap" bug) ...
            }
            */
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
        
        // DEBUG: Show pathfinding walkable/blocked nodes
        this.updatePathPlannerDebug();
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

    /**
     * Get the unit that should be shown in the panel.
     * Priority: focusedUnit > selectedUnit
     */
    getPanelUnit() {
        return this.focusedUnit || this.selectedUnit;
    }

    /**
     * Update the bottom panel content.
     * @param {Unit} [unitOverride] - Optional unit to show. If not provided, uses getPanelUnit().
     */
    updatePanelContent(unitOverride = null) {
        const unit = unitOverride || this.getPanelUnit();
        const panelContent = document.querySelector('#bottom-panel .panel-content');

        // DEBUG LOG
        console.log('[Panel] updatePanelContent', {
            unit: unit?.name || 'NO UNIT',
            waypointControlPoints: unit?.waypointControlPoints?.length || 0,
            focusedUnit: this.focusedUnit?.name || 'none',
            selectedUnit: this.selectedUnit?.name || 'none',
            panelFound: !!panelContent
        });

        // BLOCK UPDATES DURING DRAG to prevent DOM thrashing and killing the drag event
        if (this.isCommandQueueDragging) {
            return;
        }

        // If no unit or no panel, show placeholder
        if (!unit || !panelContent) {
            if (panelContent) {
                panelContent.innerHTML = '<div class="placeholder-text">Select a unit.</div>';
            }
            return;
        }

        if (panelContent) {
            // console.log('[Panel] panelContent found! Building HTML...');
            // Build Command Queue HTML from unit's waypoints
            let commandQueueHTML = '<div class="command-queue-list" id="command-queue-list">';

            if (unit.commands && unit.commands.length > 0) {
                let waypointCounter = 0;

                unit.commands.forEach((cmd, index) => {
                    // State Logic
                    // We need to know which command is "current"
                    // Unit.js needs to track currentCommandIndex
                    const isCurrent = (index === unit.currentCommandIndex);
                    const isCompleted = (index < unit.currentCommandIndex);
                    const isPending = (index > unit.currentCommandIndex);
                    
                    let stateClass = '';
                    if (isCompleted) stateClass = 'state-to'; // Reuse "To" style (Blue) -> maybe "Completed"?
                    if (isCurrent) stateClass = 'state-active'; // "Active" (Orange)
                    if (isPending) stateClass = ''; // Default
                    
                    if (cmd.type === 'Move') {
                        // MOVE CARD
                        // Only increment counter for Move commands to keep "Waypoint 0, 1, 2" logic consistent
                        const wpCount = waypointCounter++;
                        const label = `WAYPOINT ${wpCount}`;
                        
                        let coords = "0, 0, 0";
                        if (cmd.params.position) {
                            coords = `${cmd.params.position.x.toFixed(0)}, ${cmd.params.position.y.toFixed(0)}, ${cmd.params.position.z.toFixed(0)}`;
                        }
                        
                        const icon = isCurrent ? '🎯' : (isCompleted ? '🔙' : '📍');
                        
                        commandQueueHTML += `
                        <div class="command-item ${stateClass}" draggable="true" data-index="${index}" data-cmd-id="${cmd.id}">
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
                    } else {
                        // ACTION CARD
                        const actionTypes = [
                                'Move To', 'Go', 'Climbs a rock', 'Digs a tunnel', 'Jumps', 'Flies over terrain', 
                                'Flies to another asteroid', 'Swims on water', 'Swims in water', 'Rolls on the waterbed',
                                'Mine Material', 'Build Wall', 'Build Road', 'Land leveling', 'Production', 'Load', 'Produce Power',
                                'Laser shot', 'Missile shot', 'Canon shot', 'Shell', 'Bomb',
                                'Freezes', 'Takes control', 'Slow down', 'Blinds', 'Block', 'Jam', 'Smoke', 
                                'Launches a drone', 'Building a minefield', 'Becomes invisible', 'Dig in', 'Projecting a unit',
                                'Wait'
                        ];

                        const optionsHTML = actionTypes.map(type => 
                            `<option value="${type}" ${cmd.type === type ? 'selected' : ''}>${type}</option>`
                        ).join('');
                        
                        let paramInputs = '';
                        if (cmd.type === 'Wait' || cmd.params.seconds !== undefined) {
                            const sec = cmd.params.seconds || 3.0;
                            paramInputs = `
                            <div class="action-seconds">
                                <input type="number" class="seconds-input" value="${sec}" min="0" step="0.5" data-index="${index}">
                                <span class="seconds-label">sec</span>
                            </div>`;
                        }

                        commandQueueHTML += `
                        <div class="command-item action-card ${stateClass}" draggable="true" data-index="${index}" data-cmd-id="${cmd.id}">
                            <div class="cmd-icon">⏱️</div>
                            <div class="cmd-info action-card-content">
                                <select class="action-dropdown" data-index="${index}">
                                    ${optionsHTML}
                                </select>
                                ${paramInputs}
                            </div>
                            <div class="cmd-actions">
                                <button class="cmd-action-btn delete-btn" title="Remove Action" data-index="${index}">✕</button>
                            </div>
                        </div>
                        `;
                    }
                });
            } else {
                commandQueueHTML += `
                    <div class="no-commands">
                        <div class="no-commands-icon">📋</div>
                        <div class="no-commands-text">No commands</div>
                        <div class="no-commands-hint">Shift+Click map or +Action</div>
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
                            <button class="ctrl-btn action-btn" id="add-action-btn">+ Action</button>
                        </div>
                        ${commandQueueHTML}
                        <p class="hint-text"><kbd>Shift</kbd> + <kbd>Click</kbd> to add waypoints</p>
                    </div>
                </div>
            `;

            // Setup drag reorder listeners (must run every time - innerHTML overwrites DOM)
            this.setupCommandQueueDragListeners();

            // Setup playback button listeners
            this.setupPlaybackButtons();
        }
    }

    setupCommandQueueDragListeners() {
        const list = document.getElementById('command-queue-list');
        if (!list) return;

        let draggedItem = null;
        let dragStartOrder = null;

        const items = list.querySelectorAll('.command-item'); // Select ALL items

        // Enable drop on the list container itself
        list.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });

        items.forEach((item) => {
            item.addEventListener('dragstart', (e) => {
                this.isCommandQueueDragging = true; // LOCK UPDATES
                draggedItem = item;
                item.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                // Store original order to compare later
                dragStartOrder = Array.from(list.querySelectorAll('.command-item')).map(i => i.dataset.index);
            });

            item.addEventListener('dragend', () => {
                this.isCommandQueueDragging = false; // UNLOCK UPDATES
                item.classList.remove('dragging');

                // Check if order changed
                const newOrder = Array.from(list.querySelectorAll('.command-item')).map(i => i.dataset.index);
                const orderChanged = JSON.stringify(dragStartOrder) !== JSON.stringify(newOrder);

                if (orderChanged) {
                    // Order changed - apply to game logic
                    this.reorderCommandsFromDOM();
                }

                draggedItem = null;
                dragStartOrder = null;
            });

            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (draggedItem && draggedItem !== item) {
                    const rect = item.getBoundingClientRect();
                    // Horizontal layout: compare X position
                    const midX = rect.left + rect.width / 2;
                    if (e.clientX < midX) {
                        item.parentNode.insertBefore(draggedItem, item);
                    } else {
                        item.parentNode.insertBefore(draggedItem, item.nextSibling);
                    }
                }
            });
        });

        // === DELETE BUTTON HANDLERS ===
        const deleteButtons = list.querySelectorAll('.delete-btn');
        deleteButtons.forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                const index = parseInt(btn.dataset.index);
                console.log(`[UI] Delete command at index ${index}`);
                this.deleteCommandAtIndex(index);
            });
        });

        // === ACTION DROPDOWN HANDLER ===
        const dropdowns = list.querySelectorAll('.action-dropdown');
        dropdowns.forEach((dd) => {
            dd.addEventListener('change', (e) => {
                const index = parseInt(dd.dataset.index);
                const newType = e.target.value;
                if (this.selectedUnit && this.selectedUnit.commands[index]) {
                    this.selectedUnit.commands[index].type = newType;
                    // Auto-sync if type structure changes (e.g. Move vs Wait), but here mostly types are compatible
                }
            });
        });

        // === SECONDS INPUT HANDLER ===
        const inputs = list.querySelectorAll('.seconds-input');
        inputs.forEach((inp) => {
            inp.addEventListener('change', (e) => {
                const index = parseInt(inp.dataset.index);
                const val = parseFloat(e.target.value);
                if (this.selectedUnit && this.selectedUnit.commands[index]) {
                     if (!this.selectedUnit.commands[index].params) this.selectedUnit.commands[index].params = {};
                     this.selectedUnit.commands[index].params.seconds = val;
                }
            });
        });
    }

    reorderCommandsFromDOM() {
        const list = document.getElementById('command-queue-list');
        const unit = this.selectedUnit;
        if (!list || !unit || !unit.commands) return;

        const items = list.querySelectorAll('.command-item');
        const newOrderIndices = Array.from(items).map(item => parseInt(item.dataset.index));
        
        // Reorder COMMANDS
        const reorderedCommands = newOrderIndices.map(i => unit.commands[i]);
        unit.commands = reorderedCommands;
        
        // Adjust currentCommandIndex if necessary?
        // For simple logic, maybe reset or try to track the active one via ID?
        // Let's assume simpler: Reset logic or trust the user knows what they are doing.
        // Sync Derived Waypoints
        this.syncWaypointsFromCommands(unit);

        // Update panel to reflect new indices
        if (this.focusedUnit) {
            this.updatePanelContent(this.focusedUnit);
        }

        console.log("Commands reordered successfully.", newOrderIndices);
    }

    clearWaypoints() {
        const unit = this.getPanelUnit();
        if (!unit) {
            console.log("[Game] clearWaypoints: No unit");
            return;
        }
        
        this.clearWaypointMarkers(); // Clears markers and resets waypoints/controlPoints arrays on unit
        unit.path = [];
        unit.isFollowingPath = false;
        unit.setCommandPause(false);
        unit.waterState = 'normal';
        
        // Remove curve line
        if (unit.waypointCurveLine) {
            this.scene.remove(unit.waypointCurveLine);
            unit.waypointCurveLine.geometry.dispose();
            unit.waypointCurveLine = null;
        }
        
        // Update panel (no argument needed - will use getPanelUnit)
        this.updatePanelContent();
        console.log("[Game] Waypoints cleared via UI");
    }

    /**
     * Delete a single waypoint at the given index.
     * Removes control point, waypoint data, and marker.
     * Regenerates the path curve after deletion.
     */
    deleteCommandAtIndex(index) {
        const unit = this.getPanelUnit();
        if (!unit || !unit.commands) return;
        
        // Remove command
        unit.commands.splice(index, 1);
        
        // Adjust current index if needed
        if (unit.currentCommandIndex > index) unit.currentCommandIndex--;
        
        // Sync derived data
        this.syncWaypointsFromCommands(unit);
        
        // Update UI
        this.updatePanelContent();
        console.log(`[Game] Deleted command at index ${index}. Remaining: ${unit.commands.length}`);
    }
    setupPlaybackButtons() {
        // Clone buttons to remove all existing listeners (prevents duplication)
        const playBtnOld = document.getElementById('play-btn');
        const pauseBtnOld = document.getElementById('pause-btn');
        const clearBtnOld = document.getElementById('clear-btn');

        // Replace with clones to remove old listeners
        const playBtn = playBtnOld ? playBtnOld.cloneNode(true) : null;
        const pauseBtn = pauseBtnOld ? pauseBtnOld.cloneNode(true) : null;
        const clearBtn = clearBtnOld ? clearBtnOld.cloneNode(true) : null;

        if (playBtnOld && playBtn) playBtnOld.replaceWith(playBtn);
        if (pauseBtnOld && pauseBtn) pauseBtnOld.replaceWith(pauseBtn);
        if (clearBtnOld && clearBtn) clearBtnOld.replaceWith(clearBtn);

        if (playBtn) {
            playBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log("[UI] Play button clicked");
                
                const unit = this.selectedUnit || this.focusedUnit;
                if (unit && unit.waypointControlPoints && unit.waypointControlPoints.length >= 2) {
                    // Reset command pause
                    unit.setCommandPause(false);

                    // CRITICAL: Reset water state so unit can move again
                    unit.waterState = 'normal';

                    // Resume path following
                    unit.isFollowingPath = true;

                    // Only find closest point if starting fresh (not resuming from pause)
                    // This prevents jerking when pressing Play repeatedly
                    const wasAlreadyFollowing = unit.isFollowingPath && unit.pathIndex !== undefined && unit.pathIndex >= 0;
                    
                    if (!wasAlreadyFollowing && unit.path && unit.path.length > 0) {
                        let closest = 0;
                        let minDist = Infinity;
                        for (let i = 0; i < unit.path.length; i++) {
                            const d = unit.position.distanceTo(unit.path[i]);
                            if (d < minDist) { minDist = d; closest = i; }
                        }
                        unit.pathIndex = closest;
                        console.log("[UI] Play: Found closest path point:", closest);
                    }

                    console.log("[UI] Playback: PLAY - Resumed path following");
                } else {
                    console.log("[UI] Play: No unit or insufficient waypoints");
                }
            });
        }

        if (pauseBtn) {
            pauseBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log("[UI] Pause button clicked");
                
                const unit = this.selectedUnit || this.focusedUnit;
                if (unit) {
                    unit.setCommandPause(true);
                    console.log("[UI] Playback: PAUSE (Command)");
                }
            });
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log("[UI] Clear button clicked");
                
                this.clearWaypoints();
            });
        }

        // === ADD ACTION BUTTON ===
        const addActionBtnOld = document.getElementById('add-action-btn');
        const addActionBtn = addActionBtnOld ? addActionBtnOld.cloneNode(true) : null;
        if (addActionBtnOld && addActionBtn) addActionBtnOld.replaceWith(addActionBtn);

        if (addActionBtn) {
            addActionBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log("[UI] Add Action button clicked");
                
                const unit = this.selectedUnit || this.focusedUnit;
                if (unit) {
                     this.addCommand(unit, 'Wait', { seconds: 3.0 });
                }
            });
        }


        // === ACTION CARD EVENT LISTENERS ===
        // Dropdown change
        document.querySelectorAll('.action-dropdown').forEach(dropdown => {
            dropdown.addEventListener('change', (e) => {
                const index = parseInt(e.target.dataset.actionIndex);
                const unit = this.selectedUnit || this.focusedUnit;
                if (unit && unit.actionCards && unit.actionCards[index]) {
                    unit.actionCards[index].type = e.target.value;
                    console.log(`[UI] Action ${index} type changed to: ${e.target.value}`);
                }
            });
        });

        // Seconds input change
        document.querySelectorAll('.seconds-input').forEach(input => {
            input.addEventListener('change', (e) => {
                const index = parseInt(e.target.dataset.actionIndex);
                const unit = this.selectedUnit || this.focusedUnit;
                if (unit && unit.actionCards && unit.actionCards[index]) {
                    unit.actionCards[index].seconds = parseFloat(e.target.value) || 0;
                    console.log(`[UI] Action ${index} seconds changed to: ${e.target.value}`);
                }
            });
        });

        // Delete action button
        document.querySelectorAll('.delete-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const index = parseInt(e.target.dataset.actionIndex);
                const unit = this.selectedUnit || this.focusedUnit;
                if (unit && unit.actionCards) {
                    unit.actionCards.splice(index, 1);
                    console.log(`[UI] Action ${index} deleted`);
                    this.updatePanelContent();
                }
            });
        });
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

    /**
     * R001: Fixed-timestep simulation tick (50ms).
     * All sim state mutations (unit positions, path logic) happen here.
     * @param {number} fixedDt - Fixed delta time in seconds (0.050)
     * @param {number} tickCount - Current tick number
     */
    simTick(fixedDt, tickCount) {
        // R006: Process input commands from queue first
        this._processInputCommands(tickCount);

        const keys = this.input.getKeys();

        // Update all units on fixed timestep
        this.units.forEach(unit => {
            if (!unit) return;

            // Sync params
            unit.speed = this.unitParams.speed;
            unit.turnSpeed = this.unitParams.turnSpeed;
            unit.groundOffset = this.unitParams.groundOffset;
            unit.smoothingRadius = this.unitParams.smoothingRadius;

            if (unit === this.selectedUnit) {
                unit.update(keys, fixedDt, this.pathPlanner);
            } else {
                unit.update({ forward: false, backward: false, left: false, right: false }, fixedDt, this.pathPlanner);
            }
        });

        // Handle path looping (sim state mutation)
        this.handlePathLooping();
    }

    /**
     * R006-fix: Setup canvas to receive keyboard focus.
     * Ensures document.hasFocus() and keyboard events work reliably.
     */
    _setupCanvasFocus() {
        const canvas = this.renderer.domElement;

        // Make canvas focusable
        canvas.tabIndex = 0;
        canvas.style.outline = 'none'; // Hide focus ring

        // Focus canvas on first interaction
        const focusOnce = () => {
            canvas.focus();
            canvas.removeEventListener('pointerdown', focusOnce);
            canvas.removeEventListener('click', focusOnce);
        };
        canvas.addEventListener('pointerdown', focusOnce);
        canvas.addEventListener('click', focusOnce);

        // Also focus when clicking anywhere on body (for edge cases)
        document.body.addEventListener('click', () => {
            if (document.activeElement !== canvas) {
                canvas.focus();
            }
        }, { once: false, passive: true });
    }

    /**
     * R006: Process input commands from the queue.
     * Called at the start of each simTick for deterministic command execution.
     * @param {number} tickCount - Current tick number
     */
    _processInputCommands(tickCount) {
        const commands = globalCommandQueue.flush(tickCount);

        for (const cmd of commands) {
            switch (cmd.type) {
                case CommandType.SELECT: {
                    const unit = this.units.find(u => u && u.id === cmd.unitId);
                    if (unit) {
                        this.selectUnit(unit, cmd.skipCamera);
                    }
                    break;
                }
                case CommandType.DESELECT: {
                    this.deselectUnit();
                    break;
                }
                case CommandType.MOVE: {
                    const unit = this.units.find(u => u && u.id === cmd.unitId);
                    if (unit) {
                        const pos = new THREE.Vector3(cmd.position.x, cmd.position.y, cmd.position.z);
                        this.addCommand(unit, 'Move', { position: pos });
                    }
                    break;
                }
                case CommandType.SET_PATH: {
                    const unit = this.units.find(u => u && u.id === cmd.unitId);
                    if (unit && cmd.points && cmd.points.length > 0) {
                        // Clear existing path and add new waypoints
                        unit.commands = [];
                        unit.waypoints = [];
                        unit.waypointControlPoints = [];
                        for (const pt of cmd.points) {
                            const pos = new THREE.Vector3(pt.x, pt.y, pt.z);
                            this.addCommand(unit, 'Move', { position: pos });
                        }
                    }
                    break;
                }
                case CommandType.CLOSE_PATH: {
                    const unit = this.units.find(u => u && u.id === cmd.unitId);
                    if (unit && unit === this.selectedUnit) {
                        this.closePath();
                    }
                    break;
                }
                default:
                    console.warn('[Game] Unknown input command type:', cmd.type);
            }
        }
    }

    /**
     * R001: Render-only updates (camera, visuals, UI).
     * Called every frame after simTick(s). Does NOT mutate sim state.
     */
    renderUpdate() {
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

        // Update tire tracks (render-only, visual trails)
        this.units.forEach(unit => {
            if (!unit) return;
            if (!unit.tireTrackSegments) {
                unit.initTireTracks(this.scene);
            }
            unit.updateTireTracks(0.016);
        });

        // Update waypoint marker fill states
        this.updateWaypointMarkerFill();

        // NOTE: updatePanelContent is now called ONLY on events (waypoint add/delete/reorder)
        // NOT per-frame, because rebuilding DOM destroys event listeners

        // NOTE: handlePathLooping() moved to simTick() for R001 determinism

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

        // Update Rock FOW textures
        if (this.planet.rockSystem && this.planet.rockSystem.materials) {
            for (let i = 0; i < this.planet.rockSystem.materials.length; i++) {
                const mat = this.planet.rockSystem.materials[i];
                if (mat.materialShader && mat.materialShader.uniforms) {
                    mat.materialShader.uniforms.uFogTexture.value = this.fogOfWar.exploredTarget.texture;
                    mat.materialShader.uniforms.uVisibleTexture.value = this.fogOfWar.visibleTarget.texture;
                }
            }
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
        // R001: Run fixed-timestep sim ticks, then render
        this.simLoop.step(performance.now());
        this.renderUpdate();
        this.renderer.render(this.scene, this.camera);

        // Trigger onFirstRender callback after enough frames to ensure content visible
        // Wait for 30 frames (about 0.5s at 60fps) to ensure textures loaded
        if (!this._frameCount) this._frameCount = 0;
        this._frameCount++;

        if (this.onFirstRender && !this._firstRenderDone && this.assetsLoaded && this._frameCount > 30) {
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

    // === PATH PLANNER DEBUG VISUALIZATION ===
    updatePathPlannerDebug() {
        if (!this.pathPlanner) return;
        
        // Remove old debug mesh
        if (this.pathPlannerDebugMesh) {
            this.scene.remove(this.pathPlannerDebugMesh);
            this.pathPlannerDebugMesh.geometry.dispose();
            this.pathPlannerDebugMesh.material.dispose();
            this.pathPlannerDebugMesh = null;
        }
        
        const debugPoints = this.pathPlanner.getDebugPoints();
        if (!debugPoints || debugPoints.length === 0) return;
        
        // Create geometry
        const positions = new Float32Array(debugPoints.length * 3);
        const colors = new Float32Array(debugPoints.length * 3);
        
        // 3-ZONE COLOR SYSTEM
        const freeColor = new THREE.Color(0x00ff88);       // Green - FREE
        const avoidanceColor = new THREE.Color(0xffaa00);  // Yellow/Orange - AVOIDANCE
        const forbiddenColor = new THREE.Color(0xff4444); // Red - FORBIDDEN
        
        for (let i = 0; i < debugPoints.length; i++) {
            const pt = debugPoints[i];
            positions[i * 3] = pt.position.x;
            positions[i * 3 + 1] = pt.position.y;
            positions[i * 3 + 2] = pt.position.z;
            
            // Determine color based on zone type
            let color;
            if (pt.zoneType === 'FORBIDDEN') {
                color = forbiddenColor;
            } else if (pt.zoneType === 'AVOIDANCE') {
                color = avoidanceColor;
            } else {
                color = freeColor;
            }
            
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }
        
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        
        const material = new THREE.PointsMaterial({
            size: 0.5,
            vertexColors: true,
            sizeAttenuation: true,
            depthTest: true,
            depthWrite: false,
            transparent: true,
            opacity: 0.9
        });
        
        this.pathPlannerDebugMesh = new THREE.Points(geometry, material);
        this.pathPlannerDebugMesh.renderOrder = 200; // Render on top
        this.scene.add(this.pathPlannerDebugMesh);
        
        console.log(`[Game] PathPlanner debug: ${debugPoints.length} points visualized`);
    }
}
