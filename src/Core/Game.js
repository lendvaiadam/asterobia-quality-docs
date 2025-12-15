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

export class Game {
    constructor() {
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
        const stars = new THREE.Points(starGeometry, starMaterial);
        this.scene.add(stars);
        
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
        
        // Lighting
        // Ambient: Dim base light for shadow side (simulates space ambient)
        const ambientLight = new THREE.AmbientLight(0x334466, 0.15);
        this.scene.add(ambientLight);
        
        // Hemisphere Light: Subtle sky/ground color difference
        const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x444422, 0.2);
        this.scene.add(hemiLight);
        
        // SUNLIGHT: Main directional light for day/night
        const sunLight = new THREE.DirectionalLight(0xfffaf0, 2.0); // Warm white
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
        this.sunLight = sunLight;
        this.scene.add(sunLight);

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
    }
    
    // Unit Loading handled below

    loadUnits() {
        const loader = new GLTFLoader();
        // All 5 units - Unit 1 spawns in front of camera
        const models = ['1.glb', '2.glb', '3.glb', '4.glb', '5.glb'];
        let loadedCount = 0;
        
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
                
                this.units.push(unit);
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
        
        // Camera: Zoom to show ENTIRE PATH (not just unit)
        if (isNewUnit) {
            // Call zoomCameraToPath which calculates bounding sphere of all waypoints
            this.zoomCameraToPath(unit);
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
        
        // If first waypoint, start from unit's CURRENT position (not where it started)
        if (unit.waypointControlPoints.length === 0) {
            const startPos = unit.position.clone();
            unit.waypointControlPoints.push(startPos);
            unit.isPathClosed = false;
            
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
            startMarker.userData.isFilled = false;
            startMarker.userData.controlPointIndex = 0;
            startMarker.userData.isStartMarker = true;
            startMarker.userData.waypointNumber = 0;
            startMarker.userData.unitId = unit.id; // Link marker to unit
            
            const startLabelSprite = this.createNumberSprite(0);
            startLabelSprite.position.copy(startMarkerPos);
            startLabelSprite.renderOrder = 15;
            startMarker.userData.labelSprite = startLabelSprite;
            this.scene.add(startLabelSprite);
            
            this.scene.add(startMarker);
            unit.waypointMarkers.push(startMarker);
        }
        
        // Add the clicked point as a new waypoint
        unit.waypointControlPoints.push(point.clone());
        
        // Create visual marker (Transparent Sphere on terrain surface)
        const dir = point.clone().normalize();
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
        marker.userData.unitId = unit.id; // Link marker to unit
        this.scene.add(labelSprite);
        
        // Store fill state
        marker.userData.isFilled = false;
        marker.userData.controlPointIndex = unit.waypointControlPoints.length - 1;
        marker.userData.waypointNumber = waypointNumber;
        
        this.scene.add(marker);
        unit.waypointMarkers.push(marker);
        
        // Generate smooth curve and update visualization
        this.updateWaypointCurve();
        
        // Update Command Queue if panel is open
        if (this.isFocusMode && this.focusedUnit) {
            this.updatePanelContent(this.focusedUnit);
        }
        
        console.log("Waypoint added:", point, "Control points:", unit.waypointControlPoints.length);
    }
    
    closePath() {
        // Called from InteractionManager when start marker is clicked
        if (!this.selectedUnit) return;
        const unit = this.selectedUnit;
        
        if (unit.waypointControlPoints && unit.waypointControlPoints.length >= 3 && !unit.isPathClosed) {
            unit.loopingEnabled = true;
            unit.isPathClosed = true;
            console.log("Path CLOSED - clicked on start marker!");
            
            // Visual indicator: Change start marker color to orange
            if (unit.waypointMarkers && unit.waypointMarkers[0]) {
                unit.waypointMarkers[0].material.color.setHex(0xffaa00);
            }
            
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
        
        // === PATH SYNC - SMOOTH REJOIN (NO TELEPORT) ===
        const newCPCount = controlPoints.length;
        
        if (newCPCount >= 2) {
            const oldPath = unit.path ? unit.path.slice() : null;
            const oldPathIndex = unit.pathIndex || 0;
            
            // Store new permanent path
            unit.path = projectedPoints.map(p => p.clone());
            
            // === SMOOTH REJOIN LOGIC ===
            // If unit was already moving, create transition curve instead of teleporting
            if (oldPath && oldPath.length > 0 && unit.isFollowingPath) {
                const unitPos = unit.position.clone();
                const unitVelocity = unit.velocityDirection ? unit.velocityDirection.clone() : null;
                
                // Find the best rejoin point on NEW path:
                // - Must be AHEAD of current position (towards next waypoint)
                // - Should minimize transition distance while maintaining smooth curve
                let bestRejoinIdx = 0;
                let bestScore = Infinity;
                
                for (let i = 0; i < unit.path.length; i++) {
                    const pathPoint = unit.path[i];
                    const dist = unitPos.distanceTo(pathPoint);
                    
                    // Check if this point is "forward" relative to unit direction
                    let isForward = true;
                    if (unitVelocity && unitVelocity.lengthSq() > 0.001) {
                        const toPoint = pathPoint.clone().sub(unitPos).normalize();
                        const dot = toPoint.dot(unitVelocity);
                        isForward = dot > -0.3; // Allow some side movement, reject pure backwards
                    }
                    
                    if (isForward) {
                        // Score: prefer closer points that are forward
                        const score = dist;
                        if (score < bestScore) {
                            bestScore = score;
                            bestRejoinIdx = i;
                        }
                    }
                }
                
                // If unit is already close to path, just continue normally
                const rejoinDist = unitPos.distanceTo(unit.path[bestRejoinIdx]);
                
                if (rejoinDist < 0.3) {
                    // Already on path, no transition needed
                    unit.pathIndex = bestRejoinIdx;
                    unit.transitionPath = null;
                } else {
                    // === BEZIER-LIKE TRANSITION CURVE ===
                    // Goal: Continue current direction, then smooth arc to rejoin path
                    // Target the ORIGINAL waypoint, not just the closest point
                    
                    const groundOffset = unit.groundOffset || 0.5;
                    
                    // The unit should aim towards its ORIGINAL target (next waypoint)
                    // Find a rejoin point that's BETWEEN current position and target
                    const originalTargetIdx = oldPathIndex < oldPath.length ? oldPathIndex : 0;
                    
                    // Calculate a blend point between closest path point and forward
                    let blendedRejoinIdx = bestRejoinIdx;
                    const lookAhead = Math.min(20, Math.floor(unit.path.length * 0.1)); // Look up to 10% forward
                    if (bestRejoinIdx + lookAhead < unit.path.length) {
                        // Pick a point slightly ahead for smoother entry
                        blendedRejoinIdx = bestRejoinIdx + Math.floor(lookAhead / 2);
                    }
                    
                    const rejoinPoint = unit.path[blendedRejoinIdx];
                    
                    // === CUBIC BEZIER CONTROL POINTS ===
                    // P0: Current position
                    // P1: Continue in current direction (creates smooth exit tangent)
                    // P2: Approach point (creates smooth entry tangent)  
                    // P3: Rejoin point
                    
                    let forwardProjection = 2.0; // How far to project current direction
                    let approachDistance = rejoinDist * 0.3; // Approach control point distance
                    
                    let continuationPoint;
                    if (unitVelocity && unitVelocity.lengthSq() > 0.001) {
                        // Project forward based on velocity (continue current direction)
                        continuationPoint = unitPos.clone().add(unitVelocity.clone().multiplyScalar(forwardProjection));
                    } else {
                        // Fallback: use tangent
                        const radialDir = unitPos.clone().normalize();
                        const tangent = new THREE.Vector3(-radialDir.y, radialDir.x, 0).normalize();
                        continuationPoint = unitPos.clone().add(tangent.multiplyScalar(forwardProjection));
                    }
                    
                    // Approach point: positioned to create smooth entry angle
                    // Vector from rejoin back towards continuation point
                    let afterRejoinIdx = blendedRejoinIdx + 1;
                    if (afterRejoinIdx >= unit.path.length) {
                        afterRejoinIdx = unit.isPathClosed ? 0 : unit.path.length - 1;
                    }
                    const afterRejoin = unit.path[afterRejoinIdx];
                    const rejoinDirection = afterRejoin.clone().sub(rejoinPoint).normalize();
                    const approachPoint = rejoinPoint.clone().sub(rejoinDirection.multiplyScalar(approachDistance));
                    
                    // Build cubic Bezier via CatmullRom (using extension points for tangent matching)
                    const transitionControlPoints = [
                        unitPos.clone().sub(unitVelocity ? unitVelocity.clone().multiplyScalar(1) : new THREE.Vector3(0,0,0)), // Extension for entry tangent
                        unitPos.clone(),
                        continuationPoint,
                        approachPoint,
                        rejoinPoint.clone(),
                        afterRejoin.clone() // Extension for exit tangent
                    ];
                    
                    // Create smooth transition curve
                    const transitionCurve = new THREE.CatmullRomCurve3(
                        transitionControlPoints, false, 'chordal', 0.0
                    );
                    
                    // Sample transition - more samples for smoother curve
                    const numTransitionSamples = 40;
                    const transitionSamples = transitionCurve.getPoints(numTransitionSamples);
                    
                    // Project ALL transition points onto terrain (terrain-following)
                    // AND check for obstacles (water, etc.) - same as normal path
                    const waterLevel = this.planet.terrain.params.waterLevel || 0;
                    const baseRadius = this.planet.terrain.params.radius || 10;
                    const waterRadius = baseRadius + waterLevel;
                    const canEnterWater = unit.canWalkUnderwater || unit.canSwim;
                    
                    let transitionValid = true;
                    const transitionProjected = transitionSamples.slice(1, -1).map(p => {
                        const dir = p.clone().normalize();
                        const terrainRadius = this.planet.terrain.getRadiusAt(dir);
                        
                        // Check if point is underwater
                        if (!canEnterWater && terrainRadius < waterRadius) {
                            transitionValid = false; // Mark transition as invalid
                        }
                        
                        return dir.multiplyScalar(terrainRadius + groundOffset);
                    });
                    
                    // If transition goes through water, skip transition and stay on current path
                    if (!transitionValid) {
                        unit.transitionPath = null;
                        unit.isOnTransition = false;
                        // Keep current position, let unit find closest valid path point naturally
                    } else {
                    
                    // Store as TEMPORARY transition path
                    unit.transitionPath = transitionProjected;
                    unit.transitionIndex = 0;
                    unit.transitionRejoinIdx = blendedRejoinIdx;
                    unit.isOnTransition = true;
                    
                    // pathIndex points to where we'll rejoin after transition
                    unit.pathIndex = blendedRejoinIdx;
                    } // End of transitionValid else block
                }
            } else {
                // First path setup - find closest point
                let closestIdx = 0;
                let bestDist = Infinity;
                
                for (let i = 0; i < unit.path.length; i++) {
                    const dist = unit.position.distanceTo(unit.path[i]);
                    if (dist < bestDist) {
                        bestDist = dist;
                        closestIdx = i;
                    }
                }
                
                unit.pathIndex = closestIdx;
                unit.transitionPath = null;
                unit.isOnTransition = false;
            }
            
            // Clamp pathIndex
            if (unit.pathIndex >= unit.path.length) {
                unit.pathIndex = (unit.loopingEnabled || unit.isPathClosed) ? 0 : unit.path.length - 1;
            }
            if (unit.pathIndex < 0) unit.pathIndex = 0;
            
            unit.isFollowingPath = true;
            unit.lastCommittedControlPointCount = newCPCount;
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
        unit.loopingEnabled = false;
        unit.isPathClosed = false;
    }
    
    updateWaypointMarkerFill() {
        if (!this.selectedUnit) return;
        const unit = this.selectedUnit;
        if (!unit.waypointMarkers || !unit.waypointControlPoints) return;
        
        const unitPos = unit.position;
        
        // Check each marker (control point)
        unit.waypointMarkers.forEach((marker, index) => {
            if (marker.userData.isFilled) return; // Already filled
            
            const cpIndex = index + 1;
            if (cpIndex >= unit.waypointControlPoints.length) return;
            
            const controlPoint = unit.waypointControlPoints[cpIndex];
            const dist = unitPos.distanceTo(controlPoint);
            
            if (dist < 2.0) {
                marker.userData.isFilled = true;
                marker.material.opacity = 0.9;
                marker.material.color.setHex(0x00ffaa);
                unit.passedControlPointCount = Math.max(unit.passedControlPointCount, cpIndex);
            }
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
                    marker.material.opacity = 0.5;
                    marker.material.color.setHex(idx === 0 ? 0x00ff88 : 0x00ff88); // All Green
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
        
        // Camera Logic
        if (this.cameraControls) {
            // Cinematic Flight if needed
            // If new unit OR we are not chasing/flying, trigger cinematic
            if (isNewUnit || !this.cameraControls.chaseTarget) {
                this.cameraControls.flyTo(unit, () => {
                    this.cameraControls.setChaseTarget(unit);
                });
            } else {
                // Ensure chase target is set if we are already close/chasing
                this.cameraControls.setChaseTarget(unit);
            }
            
            // NOTE: We no longer change camera config on panel open
            // This was causing jumps. Camera stays at its current distance.
        }
        
        // Ensure path visualization is VISIBLE when panel is open
        this.showUnitMarkers(unit);
        
        // Update Panel Content
        this.updatePanelContent(unit);
        
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
        }
    }
    
    updatePanelContent(unit) {
        const panelContent = document.querySelector('#bottom-panel .panel-content');
        if (panelContent) {
            // Build Command Queue HTML from unit's waypoints
            let commandQueueHTML = '<div class="command-queue-list" id="command-queue-list">';
            
            if (unit.waypointControlPoints && unit.waypointControlPoints.length > 0) {
                unit.waypointControlPoints.forEach((cp, index) => {
                    const coords = `${cp.x.toFixed(1)}, ${cp.y.toFixed(1)}, ${cp.z.toFixed(1)}`;
                    const label = index === 0 ? 'START' : `WP ${index}`;
                    const isStart = index === 0;
                    
                    commandQueueHTML += `
                        <div class="command-item ${isStart ? 'start-point' : ''}" draggable="true" data-index="${index}">
                            <div class="cmd-icon">${isStart ? '🚀' : '📍'}</div>
                            <div class="cmd-info">
                                <div class="cmd-type">MOVE TO</div>
                                <div class="cmd-coords">${label}</div>
                                <div class="cmd-details">${coords}</div>
                            </div>
                            <div class="cmd-actions">
                                <button class="cmd-action-btn" title="Remove">✕</button>
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
            
            panelContent.innerHTML = `
                <div class="panel-container">
                    <div class="unit-info">
                        <h3>Unit Status</h3>
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
            });
            
            item.addEventListener('dragend', () => {
                item.classList.remove('dragging');
                draggedItem = null;
            });
            
            item.addEventListener('dragover', (e) => {
                e.preventDefault();
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
        const newOrder = Array.from(items).map(item => parseInt(item.dataset.index));
        
        // Reorder control points
        const reorderedPoints = newOrder.map(i => unit.waypointControlPoints[i]);
        unit.waypointControlPoints = reorderedPoints;
        
        // Regenerate curve
        unit.lastCommittedControlPointCount = 0; // Force full regenerate
        unit.path = []; // Clear current path
        this.updateWaypointCurve();
        
        // Update panel
        if (this.focusedUnit) {
            this.updatePanelContent(this.focusedUnit);
        }
        
        console.log("Waypoints reordered:", newOrder);
    }
    
    setupPlaybackButtons() {
        const playBtn = document.getElementById('play-btn');
        const pauseBtn = document.getElementById('pause-btn');
        const clearBtn = document.getElementById('clear-btn');
        
        if (playBtn) {
            playBtn.addEventListener('click', () => {
                const unit = this.selectedUnit;
                if (unit && unit.waypointControlPoints && unit.waypointControlPoints.length >= 2) {
                    // Manual Override Release: Resume path logic
                    unit.setCommandPause(false);
                    
                    // IF user modified position significantly (e.g. manual drive), maybe regenerate?
                    // But requirement says "visszamegy az útvonalhoz".
                    // Standard path following logic will steer towards path[pathIndex].
                    // So we just unpause.
                    
                    console.log("Playback: PLAY (Unpause Command)");
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
        } else if (this.selectedUnit) {
            // Keep chase target for obstruction detection even when not keyboard driving
            // But only if NOT flying (transition animation takes priority)
            if (!this.cameraControls.isFlying) {
                this.cameraControls.setChaseTarget(this.selectedUnit);
            }
        }

        // Update all units
        this.units.forEach(unit => {
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
        
        // Handle path looping (if unit reached end of path)
        this.handlePathLooping();
        
        // Update Vision Helper to follow selected unit
        if (this.visionHelper && this.selectedUnit) {
            this.visionHelper.position.copy(this.selectedUnit.position);
            const r = this.fogOfWar.currentVisionRadius || 40.0;
            this.visionHelper.scale.set(r/15, r/15, r/15);
        }
        
        // Update FOW with ALL units
        if (this.units.length > 0) {
            this.fogOfWar.update(this.units);
        }
        
        // Update water animation (waves + FOW)
        if (this.planet && this.planet.updateWater) {
            const dt = this.clock ? this.clock.getDelta() : 1/60;
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
}
