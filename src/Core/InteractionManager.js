import * as THREE from 'three';

/**
 * Manages all mouse/touch interactions strictly according to V3 Spec:
 * - One interaction per Mousedown-Mouseup cycle.
 * - Modes: SELECT, DESELECT, TERRAIN_DRAG, PATH_DRAW.
 */
export class InteractionManager {
    constructor(game) {
        this.game = game;
        this.domElement = game.renderer.domElement;
        
        // Configuration
        this.DRAG_THRESHOLD = 3; // pixels
        
        // State
        this.state = 'IDLE'; // IDLE, MOUSE_DOWN, DRAGGING_TERRAIN, DRAWING_PATH
        this.startMouse = new THREE.Vector2();
        this.currentMouse = new THREE.Vector2();
        this.mouseDownUnit = null; // Unit hit on mousedown
        this.mouseDownTerrain = null; // Terrain point hit on mousedown
        this.isLeftButton = false;
        
        this.hoveredUnit = null;
        
        // Raycaster
        this.raycaster = new THREE.Raycaster();
        this.mouseNDC = new THREE.Vector2();

        // Bindings
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
        this.onDblClick = this.onDblClick.bind(this);

        // Listeners
        // USE CAPTURE PHASE for MouseDown to intercept events before CameraController
        this.domElement.addEventListener('mousedown', this.onMouseDown, { capture: true });
        window.addEventListener('mousemove', this.onMouseMove); // Window for drag continuation
        window.addEventListener('mouseup', this.onMouseUp);
        this.domElement.addEventListener('dblclick', this.onDblClick);
    }

    onMouseDown(event) {
        // RMB Handling
        if (event.button === 2) {
            if (this.state === 'DRAWING_PATH') {
                // RMB during Path Draw = ATTACK COMMAND Logic
                event.stopImmediatePropagation(); // Block Camera Orbit
                this.isRightButtonInPathMode = true;
                
                // Show Attack Range Visualization?
                // User: "Jelenjen meg egy lőtávolság gömb...". 
                // We'll trigger this in MouseMove or just here?
                // For now, toggle "Attack Mode" pending click.
                return;
            }
            // Normal RMB (Orbit) - let it pass to CameraControls
            return;
        }

        if (event.button !== 0) return; // Only Left Button for Drag/Select
        this.isLeftButton = true;
        
        this.startMouse.set(event.clientX, event.clientY);
        this.currentMouse.copy(this.startMouse);
        
        // If we were already in DRAWING_PATH (from Shift+Select?), we continue?
        // Actually, DRAWING_PATH state usually resets on MouseUp unless Shift held?
        // Let's assume Drag initiates Drawing.
        
        this.state = 'MOUSE_DOWN';
        
        this.updateMouseNDC(event.clientX, event.clientY);
        
        // ... rest of logic ...
        
        // 0. Raycast Waypoint Markers (for dragging)
        const hitMarker = this.raycastWaypointMarker();
        if (hitMarker) {
            this.mouseDownMarker = hitMarker;
            this.mouseDownUnit = null;
            this.mouseDownTerrain = null;
            
            // PRIORITY: Stop camera controls from seeing this event
            event.stopImmediatePropagation();
            // event.preventDefault(); // Optional, but good practice to prevent text selection etc
            
            return; 
        }
        
        // 1. Raycast Unit
        const hitUnit = this.raycastUnit();
        if (hitUnit) {
            this.mouseDownUnit = hitUnit;
            this.mouseDownTerrain = null;
            this.mouseDownMarker = null;
            // Potential Select or Path Draw
        } else {
            // 2. Raycast Terrain
            const hitTerrain = this.raycastTerrain();
            this.mouseDownUnit = null;
            this.mouseDownTerrain = hitTerrain;
            this.mouseDownMarker = null;
            // Potential Deselect or Terrain Drag
        }
        
        // Stop Camera Controller's default drag if we might draw path
        // Actually, we want to control Camera entirely if Terrain Drag.
        // For now, let's assume we call camera controls manually if needed.
        if (this.game.cameraControls) {
            // Disable default drag until we decide it IS a drag
            this.game.cameraControls.isLMBDown = false; 
        }
    }
    
    raycastWaypointMarker() {
        const unit = this.game.selectedUnit;
        if (!unit || !unit.waypointMarkers || unit.waypointMarkers.length === 0) return null;
        
        this.raycaster.setFromCamera(this.mouseNDC, this.game.camera);
        const intersects = this.raycaster.intersectObjects(unit.waypointMarkers, false);
        
        if (intersects.length > 0) {
            return intersects[0].object;
        }
        return null;
    }

    onMouseMove(event) {
        // ALWAYS update hover if Idle
        this.updateMouseNDC(event.clientX, event.clientY);
        if (this.state === 'IDLE') {
            this.handleHover();
            return;
        }

        if (this.state === 'MOUSE_DOWN') {
            this.currentMouse.set(event.clientX, event.clientY);
            const dist = this.currentMouse.distanceTo(this.startMouse);
            
            if (dist > this.DRAG_THRESHOLD) {
                // DECISION POINT
                if (this.mouseDownMarker) {
                    // Drag on Marker -> Marker Drag
                    this.state = 'DRAGGING_MARKER';
                    console.log("Started dragging marker:", this.mouseDownMarker.userData.waypointNumber);
                } else if (this.mouseDownUnit) {
                    // Drag on Unit -> Path Draw
                    this.state = 'DRAWING_PATH';
                    this.game.startPathDrawing(this.mouseDownUnit); // Delegate to Game
                    // Ensure camera doesn't move
                } else if (this.mouseDownTerrain) {
                    // Drag on Terrain -> Terrain/Camera Drag
                    this.state = 'DRAGGING_TERRAIN';
                    // Enable Camera Pan?
                    // Or manually call pan.
                    // For System 4.0, we might need to tell it "Start Dragging Now".
                    if (this.game.cameraControls) {
                        this.game.cameraControls.startDrag(this.mouseDownTerrain);
                        this.game.cameraControls.isLMBDown = true; // Hand back control
                    }
                }
            }
        }
        
        // Handle active marker dragging
        if (this.state === 'DRAGGING_MARKER' && this.mouseDownMarker) {
            const hitPoint = this.raycastTerrain();
            if (hitPoint) {
                // Move marker to terrain hit point
                const dir = hitPoint.clone().normalize();
                const terrainRadius = this.game.planet.terrain.getRadiusAt(dir);
                const newPos = dir.multiplyScalar(terrainRadius);
                
                this.mouseDownMarker.position.copy(newPos);
                
                // Move label sprite too
                if (this.mouseDownMarker.userData.labelSprite) {
                    this.mouseDownMarker.userData.labelSprite.position.copy(newPos);
                }
            }
        }
        
        if (this.state === 'DRAWING_PATH') {
            // Update Path
            this.game.updatePathDrawing(this.mouseNDC);
        }
        
        if (this.state === 'DRAGGING_TERRAIN') {
            // Camera Controller handles this via its own listeners? 
            // Yes, CameraController listens to window.
            // But we disabled isLMBDown in onMouseDown.
            // So we enabled it back above. It should work.
        }
    }

    onMouseUp(event) {
        if (!this.isLeftButton) return;
        this.isLeftButton = false;

        if (this.state === 'MOUSE_DOWN') {
            // CLICK (No Drag)
            if (this.mouseDownMarker) {
                // Click on Marker - check if it's the START marker for path closure
                const unit = this.game.selectedUnit;
                if (this.mouseDownMarker.userData.isStartMarker && 
                    unit && unit.waypointControlPoints && 
                    unit.waypointControlPoints.length >= 3 &&
                    !unit.isPathClosed) {
                    // Close the path loop!
                    this.game.closePath();
                }
                // Clear marker reference (no drag happened)
                this.mouseDownMarker = null;
            } else if (this.mouseDownUnit) {
                // (1) Click on Unit -> SELECT + FLY (no panel)
                this.game.selectAndFlyToUnit(this.mouseDownUnit);
            } else if (this.mouseDownTerrain) {
                // (2) Click on Terrain
                if (event.shiftKey && this.game.selectedUnit) {
                    // Shift+Click -> ADD WAYPOINT
                    this.game.addWaypoint(this.mouseDownTerrain);
                } else {
                    // Normal Click -> DESELECT
                    this.game.deselectUnit();
                }
            } else {
                // No hit -> DESELECT
                this.game.deselectUnit();
            }
        } else if (this.state === 'DRAWING_PATH') {
            // Finish Path
            this.game.finishPathDrawing();
        } else if (this.state === 'DRAGGING_MARKER') {
            // Finished Marker Drag - update control point
            const unit = this.game.selectedUnit;
            if (this.mouseDownMarker && unit && unit.waypointControlPoints) {
                const cpIndex = this.mouseDownMarker.userData.controlPointIndex;
                const newPos = this.mouseDownMarker.position.clone();
                
                // Store unit's current position for smooth rejoin
                const unitCurrentPos = unit.position.clone();
                const wasFollowingPath = unit.isFollowingPath;
                
                // Update control point
                if (cpIndex >= 0 && cpIndex < unit.waypointControlPoints.length) {
                    unit.waypointControlPoints[cpIndex] = newPos;
                    
                    // Regenerate curve and path
                    unit.lastCommittedControlPointCount = 0;
                    unit.path = [];
                    this.game.updateWaypointCurve();
                    
                    // === SMOOTH REJOIN LOGIC ===
                    // If unit was following path, smoothly transition to new path
                    if (wasFollowingPath && unit.path && unit.path.length > 0) {
                        // Find nearest point on new path
                        let nearestIdx = 0;
                        let nearestDist = Infinity;
                        for (let i = 0; i < unit.path.length; i++) {
                            const d = unitCurrentPos.distanceTo(unit.path[i]);
                            if (d < nearestDist) {
                                nearestDist = d;
                                nearestIdx = i;
                            }
                        }
                        
                        // Insert unit's current position at the start of path
                        // Then set pathIndex to skip to AFTER nearest point (no backtracking)
                        unit.path.unshift(unitCurrentPos.clone());
                        // +1 because we inserted current pos at start, +1 more to skip past nearest
                        unit.pathIndex = Math.min(nearestIdx + 2, unit.path.length - 1);
                        unit.isFollowingPath = true;
                        
                        console.log("Marker dragged: smooth rejoin from current pos, skipping to index", unit.pathIndex);
                    }
                    
                    // Update panel if open
                    if (this.game.isFocusMode && this.game.focusedUnit) {
                        this.game.updatePanelContent(this.game.focusedUnit);
                    }
                    
                    console.log("Marker dragged to new position:", newPos, "CP index:", cpIndex);
                }
            }
            this.mouseDownMarker = null;
        } else if (this.state === 'DRAGGING_TERRAIN') {
            // Finished Drag
            if (this.game.cameraControls) {
                this.game.cameraControls.onMouseUp(event); // Ensure it stops
                this.game.cameraControls.isLMBDown = false;
            }
        }
        
        this.state = 'IDLE';
        this.mouseDownUnit = null;
        this.mouseDownTerrain = null;
    }
    
    onDblClick(event) {
        // Phase 2: Double click on unit
        this.updateMouseNDC(event.clientX, event.clientY);
        const hitUnit = this.raycastUnit();
        if (hitUnit) {
             this.game.onUnitDoubleClicked(hitUnit);
        }
    }

    // --- Helpers ---

    updateMouseNDC(clientX, clientY) {
        this.mouseNDC.x = (clientX / window.innerWidth) * 2 - 1;
        this.mouseNDC.y = -(clientY / window.innerHeight) * 2 + 1;
    }

    raycastUnit() {
        this.raycaster.setFromCamera(this.mouseNDC, this.game.camera);
        const unitMeshes = this.game.units.map(u => u.mesh);
        const intersects = this.raycaster.intersectObjects(unitMeshes, true);
        if (intersects.length > 0) {
            // Find parent Unit object
            const hitObject = intersects[0].object;
            return this.game.units.find(u => {
                let current = hitObject;
                while (current) {
                    if (current === u.mesh) return true;
                    current = current.parent;
                }
                return false;
            });
        }
        return null;
    }

    raycastTerrain() {
        this.raycaster.setFromCamera(this.mouseNDC, this.game.camera);
        const intersects = this.raycaster.intersectObject(this.game.planet.mesh, false);
        if (intersects.length > 0) return intersects[0].point;
        return null;
    }
    
    handleHover() {
        // First try raycast (for direct hits)
        let hitUnit = this.raycastUnit();
        
        // If no direct hit, check screen-space proximity to each unit
        // This creates a larger "hover zone" around units
        if (!hitUnit) {
            const hoverRadiusScreen = 80; // pixels - larger detection radius for easier interaction
            let closestDist = Infinity;
            
            this.game.units.forEach(unit => {
                // Project unit position to screen space
                const screenPos = unit.position.clone().project(this.game.camera);
                const screenX = (screenPos.x + 1) / 2 * window.innerWidth;
                const screenY = (-screenPos.y + 1) / 2 * window.innerHeight;
                
                // Get mouse position in screen space
                const mouseX = (this.mouseNDC.x + 1) / 2 * window.innerWidth;
                const mouseY = (-this.mouseNDC.y + 1) / 2 * window.innerHeight;
                
                const dist = Math.sqrt((screenX - mouseX) ** 2 + (screenY - mouseY) ** 2);
                
                if (dist < hoverRadiusScreen && dist < closestDist) {
                    closestDist = dist;
                    hitUnit = unit;
                }
            });
        }
        
        if (hitUnit !== this.hoveredUnit) {
            // Clear previous hover
            if (this.hoveredUnit) {
                this.hoveredUnit.setHighlight(false);
                // Resume movement (smoothly via setHover)
                this.hoveredUnit.setHover(false); 
                
                // Hide path visualization if not selected
                if (this.hoveredUnit !== this.game.selectedUnit) {
                    this.game.hideUnitMarkers(this.hoveredUnit);
                } else {
                    // Restore selected opacity (40%)
                    if (this.hoveredUnit.waypointCurveLine) {
                        this.hoveredUnit.waypointCurveLine.material.opacity = 0.4;
                    }
                }
            }
            
            // Set new hover
            if (hitUnit) {
                hitUnit.setHighlight(true);
                
                // ONLY stop unit if it's AUTO-FOLLOWING a path
                // Don't block manual keyboard control
                if (hitUnit.isFollowingPath && !hitUnit.isKeyboardOverriding) {
                    hitUnit.setHover(true);
                }
                
                // Show path visualization when hovering
                if (hitUnit.path && hitUnit.path.length > 0) {
                    this.game.showUnitMarkers(hitUnit);
                }
                
                // Set hover opacity (20%) - dimmer than selected
                if (hitUnit.waypointCurveLine && hitUnit !== this.game.selectedUnit) {
                    hitUnit.waypointCurveLine.material.opacity = 0.2;
                }
            }
            this.hoveredUnit = hitUnit;
        }
    }
}
