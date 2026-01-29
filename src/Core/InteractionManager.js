import * as THREE from 'three';
import { globalInputFactory } from '../SimCore/runtime/InputFactory.js';

/**
 * Manages all mouse/touch interactions strictly according to V3 Spec:
 * - One interaction per Mousedown-Mouseup cycle.
 * - Modes: SELECT, DESELECT, TERRAIN_DRAG, PATH_DRAW.
 *
 * R006: Delegates command creation to InputFactory for deterministic input handling.
 */
export class InteractionManager {
    constructor(game) {
        this.game = game;
        this.inputFactory = globalInputFactory;
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
        // Ensure Audio Context is assumed
        if (this.game.audioManager) {
            this.game.audioManager.resumeContext();
        }

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
            if (hitPoint && Number.isFinite(hitPoint.x) && Number.isFinite(hitPoint.y) && Number.isFinite(hitPoint.z)) {
                // Use ZONE SYSTEM for validation
                const unit = this.game.selectedUnit;
                const capabilities = unit?.capabilities || this.game.pathPlanner?.defaultCapabilities;
                const zoneType = this.game.pathPlanner?.getZoneType(hitPoint, capabilities) || 'FREE';
                
                // Zone validation - ONLY set isValidPosition flag
                // DO NOT CHANGE COLOR! Color is based on waypoint ID which doesn't change during drag
                if (zoneType === 'FORBIDDEN') {
                    this.mouseDownMarker.userData.isValidPosition = false;
                } else {
                    this.mouseDownMarker.userData.isValidPosition = true;
                }
                
                // Always move marker to show where user is dragging
                this.mouseDownMarker.position.copy(hitPoint);

                // Move label sprite too
                if (this.mouseDownMarker.userData.labelSprite) {
                    this.mouseDownMarker.userData.labelSprite.position.copy(hitPoint);
                }
                
                // Ensure marker is full size while being dragged
                this.mouseDownMarker.scale.setScalar(1.0);
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

        try {
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
                    // (1) Click on Unit -> SELECT ONLY (Don't fly)
                    // R006: Use InputFactory for deterministic command
                    this.inputFactory.select(this.mouseDownUnit.id, { skipCamera: true });
                } else if (this.mouseDownTerrain) {
                    // (2) Click on Terrain
                    if (event.shiftKey && this.game.selectedUnit) {
                        // Shift+Click -> ADD WAYPOINT
                        const unit = this.game.selectedUnit;
                        const capabilities = unit.capabilities || this.game.pathPlanner?.defaultCapabilities;

                        if (this.game.pathPlanner && !this.game.pathPlanner.isValidDestination(this.mouseDownTerrain, capabilities)) {
                            console.warn('[InteractionManager] Cannot place waypoint in FORBIDDEN zone (obstacle/water)');
                        } else {
                            // R006: Use InputFactory for deterministic command
                            this.inputFactory.move(unit.id, this.mouseDownTerrain);
                        }
                    } else {
                        // Normal Click -> DESELECT
                        // R006: Use InputFactory for deterministic command
                        this.inputFactory.deselect();
                    }
                } else {
                    // No hit -> DESELECT
                    // R006: Use InputFactory for deterministic command
                    this.inputFactory.deselect();
                }
            } else if (this.state === 'DRAWING_PATH') {
                // Finish Path
                this.game.finishPathDrawing();
            } else if (this.state === 'DRAGGING_MARKER') {
                // Finished Marker Drag - update control point
                const unit = this.game.selectedUnit;
                if (this.mouseDownMarker && unit && unit.waypointControlPoints) {
                    // Check if position was valid (set during drag)
                    const isValidPosition = this.mouseDownMarker.userData.isValidPosition !== false;
                    
                    if (!isValidPosition) {
                        // REVERT: Position is invalid (water/rock) - restore original position
                        const cpIndex = this.mouseDownMarker.userData.controlPointIndex;
                        if (unit.waypointControlPoints[cpIndex]) {
                            const originalPos = unit.waypointControlPoints[cpIndex];
                            this.mouseDownMarker.position.copy(originalPos);
                            if (this.mouseDownMarker.userData.labelSprite) {
                                this.mouseDownMarker.userData.labelSprite.position.copy(originalPos);
                            }
                        }
                        if (this.mouseDownMarker.material) {
                            this.mouseDownMarker.userData.lastHex = null;
                            this.mouseDownMarker.userData.lastOpacity = null;
                        }
                        console.log("Waypoint placement rejected: invalid position (water/rock)");
                        // Call updateWaypointCurve to restore proper colors
                        this.game.updateWaypointCurve();
                        this.mouseDownMarker = null;
                        this.state = 'IDLE';
                        return;
                    }
                    
                    const cpIndex = this.mouseDownMarker.userData.controlPointIndex;
                    const newPos = this.mouseDownMarker.position.clone();

                    if (unit.waypointControlPoints[cpIndex]) {
                        unit.waypointControlPoints[cpIndex] = newPos;
                        
                        // CRITICAL FIX: Sync the LOGICAL waypoint object too!
                        // Unit.js uses unit.waypoints[i].position for strict arrival checks.
                        // If we don't update this, the unit continues targeting the OLD position.
                        if (unit.waypoints && unit.waypoints[cpIndex]) {
                            unit.waypoints[cpIndex].position.copy(newPos);
                        }
                    }

                    unit.lastCommittedControlPointCount = 0;
                    unit.path = [];
                    if (this.mouseDownMarker.userData) {
                        this.mouseDownMarker.userData.lastHex = null;
                        this.mouseDownMarker.userData.lastOpacity = null;
                    }
                    
                    this.game.updateWaypointCurve();

                    // === SIMPLIFIED DRAG RELEASE ===
                    // Trust Game.js to handle path regeneration and index re-projection.
                    
                    if (unit.waypoints && unit.waypoints[cpIndex]) {
                         unit.waypoints[cpIndex].position.copy(newPos);
                    }
                    
                    // Force path regeneration
                    unit.lastCommittedControlPointCount = 0;
                    unit.path = []; // Clears dense path
                    
                    if (this.mouseDownMarker.userData) {
                        this.mouseDownMarker.userData.lastHex = null;
                        this.mouseDownMarker.userData.lastOpacity = null;
                    }
                    
                    // Regenerate visual curve & Re-project Unit Index (Game.js logic)
                    this.game.updateWaypointCurve();

                    // === RESUME MOVEMENT ===
                    // Ensure unit is ready to follow the new path structure immediately
                    if (unit.path && unit.path.length > 0) {
                        unit.isFollowingPath = true;
                        unit.pausedByCommand = false;
                        unit.waitTimer = 0;
                        unit.isInTransition = false; // Safety: Clear any transition state
                        unit.transitionPath = null;
                        
                        // NOTE: unit.pathIndex is already fixed by Game.js inside updateWaypointCurve
                        // console.log('[Interaction] Drag complete. Resumed at index:', unit.pathIndex);
                    }

                    if (this.game.isFocusMode && this.game.focusedUnit) {
                        this.game.updatePanelContent(this.game.focusedUnit);
                    }
                }
            } else if (this.state === 'DRAGGING_TERRAIN') {
                // Finished Drag
                if (this.game.cameraControls) {
                    this.game.cameraControls.onMouseUp(event);
                    this.game.cameraControls.isLMBDown = false;
                }
            }
        } catch (error) {
            console.error('[InteractionManager] Error in onMouseUp:', error);
        } finally {
            // CRITICAL: ALWAYS RELEASE DRAG STATE
            this.mouseDownMarker = null;
            this.state = 'IDLE';
            this.mouseDownUnit = null;
            this.mouseDownTerrain = null;
        }
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
        // Extra null safety filter
        const validUnits = this.game.units.filter(u => u && u.mesh);
        if (validUnits.length === 0) return null;
        const unitMeshes = validUnits.map(u => u.mesh);
        const intersects = this.raycaster.intersectObjects(unitMeshes, true);
        if (intersects.length > 0) {
            // Find parent Unit object
            const hitObject = intersects[0].object;
            return this.game.units.find(u => {
                if (!u || !u.mesh) return false; // NULL SAFETY FIX
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
        // 1. Raycast Unit (Direct Hit)
        let hitUnit = this.raycastUnit();

        // 2. Raycast Waypoint Marker (Direct Hit)
        let hitMarker = null;
        if (!hitUnit && this.game.selectedUnit) {
            hitMarker = this.raycastWaypointMarker();
        }

        // 3. Proximity Check (Screen Space) - Backup if no direct hit
        if (!hitUnit && !hitMarker) {
            const hoverRadiusScreen = 30; // Pixel radius
            let closestDist = Infinity;

            this.game.units.forEach(unit => {
                if (!unit) return;
                // Project unit position to screen space
                const screenPos = unit.position.clone().project(this.game.camera);
                const screenX = (screenPos.x + 1) / 2 * window.innerWidth;
                const screenY = (-screenPos.y + 1) / 2 * window.innerHeight;

                // Get mouse position in screen space
                const mouseX = (this.mouseNDC.x + 1) / 2 * window.innerWidth;
                const mouseY = (-this.mouseNDC.y + 1) / 2 * window.innerHeight; // Fixed variable usage

                const dist = Math.sqrt((screenX - mouseX) ** 2 + (screenY - mouseY) ** 2);

                if (dist < hoverRadiusScreen && dist < closestDist) {
                    closestDist = dist;
                    hitUnit = unit;
                }
            });
        }

        // === HANDLE MARKER HIGHLIGHT ===
        // Reset previous marker highlight
        if (this.hoveredMarker && this.hoveredMarker !== hitMarker) {
            // Restore to DEFAULT scale (50%)
            this.hoveredMarker.scale.setScalar(0.5);
            // Restore color/emissive if needed (though color is state-based)
            this.hoveredMarker = null;
        }

        if (hitMarker) {
            // Apply Highlight - Full size (100%)
            if (this.hoveredMarker !== hitMarker) {
                hitMarker.scale.setScalar(1.0); // Full size on hover
                this.hoveredMarker = hitMarker;
            }

            // Treat marker hover as Unit Interaction -> Find owner unit
            // If marker has unitId, find that unit. Or assume selectedUnit.
            const unitId = hitMarker.userData.unitId;
            const ownerUnit = this.game.units.find(u => u.id === unitId) || this.game.selectedUnit;

            if (ownerUnit) {
                hitUnit = ownerUnit; // Override hitUnit so we trigger stop/highlight on owner
            }
        }

        // === HANDLE UNIT HIGHLIGHT/STOP ===
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
                // User Request: Stop even if hovering waypoint (handled by hitMarker->hitUnit logic above)
                if (hitUnit.isFollowingPath && !hitUnit.isKeyboardOverriding) {
                    hitUnit.setHover(true);
                }

                // Show path visualization when hovering (50% scale and opacity)
                if (hitUnit.path && hitUnit.path.length > 0) {
                    // User Request: Same visual as tab hover - 50% size and more transparent
                    this.game.showUnitMarkers(hitUnit, 0.5);
                    
                    // Also make waypoint markers more transparent
                    if (hitUnit.waypointMarkers) {
                        hitUnit.waypointMarkers.forEach(m => {
                            if (m.material) m.material.opacity = 0.5;
                        });
                    }
                }

                // Set hover opacity (20%) - dimmer than selected
                if (hitUnit.waypointCurveLine && hitUnit !== this.game.selectedUnit) {
                    hitUnit.waypointCurveLine.material.opacity = 0.2;
                }
            }
            this.hoveredUnit = hitUnit;
        } else if (hitUnit) {
            // Already hovering handling - ensure stop persists if we transiently switched from Unit to Marker
            if (hitUnit.isFollowingPath && !hitUnit.isKeyboardOverriding) {
                hitUnit.setHover(true);
            }
        }
    }
}
