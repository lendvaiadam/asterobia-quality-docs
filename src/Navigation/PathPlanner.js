import * as THREE from 'three';

/**
 * PathPlanner - Hierarchical pathfinding for spherical planet.
 * 
 * Two-level approach:
 * 1. Global A* on SphericalNavMesh (coarse, ~2000 nodes)
 * 2. Local refinement per segment where obstacles exist (fine, ~50 nodes)
 * 
 * Output is a smooth path that avoids rocks and water.
 */
export class PathPlanner {
    constructor(navMesh, rockSystem, terrain) {
        this.navMesh = navMesh;
        this.rockSystem = rockSystem;
        this.terrain = terrain;
        
        // Configuration - STABLE VALUES
        this.config = {
            // Zone margins
            avoidanceMargin: 1.0,         // Buffer around obstacles
            avoidanceCostMultiplier: 10,  // Cost penalty for avoidance zones
            
            // Local refinement parameters
            unitCollisionRadius: 1.5,
            channelMargin: 3.0,
            localNodeSpacing: 0.5,        // STABLE: not too dense
            obstacleCheckRadius: 1.0,
            
            // Obstacle detection
            segmentSampleCount: 25,       // STABLE: original value
            
            // Performance
            maxLocalNodes: 1000,          // STABLE: original value
            
            // Debug
            debugEnabled: false,
            debugPoints: [],
            debugMesh: null
        };
        
        // Default unit capabilities
        this.defaultCapabilities = {
            canSwim: false,
            canClimb: false,
            canFly: false
        };
        
        // Reusable vectors
        this._v1 = new THREE.Vector3();
        this._v2 = new THREE.Vector3();
        this._v3 = new THREE.Vector3();
    }
    
    /**
     * Get the zone type for a position based on unit capabilities.
     * 
     * ZONE DEFINITION:
     * - FORBIDDEN: Inside actual obstacle (terrain below water, inside rock mesh)
     * - AVOIDANCE: Buffer zone OUTSIDE the obstacle edge
     * - FREE: Normal walkable area
     * 
     * @param {THREE.Vector3} pos - World position
     * @param {Object} capabilities - Unit capabilities {canSwim, canClimb, canFly}
     * @returns {'FORBIDDEN' | 'AVOIDANCE' | 'FREE'}
     */
    getZoneType(pos, capabilities = null) {
        const caps = capabilities || this.defaultCapabilities;
        const surfacePos = this.projectToTerrain(pos);
        
        // === ROCK ZONES ===
        // Check if INSIDE rock (forbidden)
        if (this.isInsideRockCore(surfacePos)) {
            return 'FORBIDDEN';
        }
        // Check if in rock AVOIDANCE buffer (outside rock but within margin)
        if (this.isInRockAvoidanceZone(surfacePos)) {
            if (!caps.canClimb && !caps.canFly) {
                return 'AVOIDANCE';
            }
        }
        
        // === WATER ZONES ===
        // Check if UNDERWATER (forbidden for non-swimmers)
        if (this.isActuallyUnderwater(surfacePos)) {
            if (!caps.canSwim) {
                return 'FORBIDDEN';
            }
            // Can swim - water is FREE
        } else {
            // Check if in water AVOIDANCE buffer (near shore, above water)
            if (this.isNearWaterEdge(surfacePos)) {
                if (!caps.canSwim) {
                    return 'AVOIDANCE';
                }
            }
        }
        
        return 'FREE';
    }
    
    /**
     * Check if position is INSIDE a rock (collision radius, no margin).
     */
    isInsideRockCore(pos) {
        if (!this.rockSystem || !this.rockSystem.rocks) return false;
        
        for (const rockMesh of this.rockSystem.rocks) {
            if (!rockMesh) continue;
            
            const rockPos = rockMesh.position;
            let rockRadius;
            if (rockMesh.userData && rockMesh.userData.collisionRadius) {
                rockRadius = rockMesh.userData.collisionRadius;
            } else {
                const rockScale = rockMesh.scale;
                rockRadius = Math.max(rockScale.x, rockScale.y, rockScale.z) * 1.5;
            }
            
            if (pos.distanceTo(rockPos) < rockRadius) {
                return true;
            }
        }
        return false;
    }
    
    /**
     * Check if position is in rock AVOIDANCE zone (outside rock but within buffer).
     */
    isInRockAvoidanceZone(pos) {
        if (!this.rockSystem || !this.rockSystem.rocks) return false;
        const buffer = this.config.avoidanceMargin;
        
        for (const rockMesh of this.rockSystem.rocks) {
            if (!rockMesh) continue;
            
            const rockPos = rockMesh.position;
            let rockRadius;
            if (rockMesh.userData && rockMesh.userData.collisionRadius) {
                rockRadius = rockMesh.userData.collisionRadius;
            } else {
                const rockScale = rockMesh.scale;
                rockRadius = Math.max(rockScale.x, rockScale.y, rockScale.z) * 1.5;
            }
            
            const dist = pos.distanceTo(rockPos);
            // In avoidance zone: outside rock but within buffer
            if (dist >= rockRadius && dist < rockRadius + buffer) {
                return true;
            }
        }
        return false;
    }
    
    /**
     * Check if position is ACTUALLY underwater (terrain below water level).
     */
    isActuallyUnderwater(pos) {
        const waterLevel = this.terrain.params.waterLevel || 0;
        const baseRadius = this.terrain.params.radius;
        const waterRadius = baseRadius + waterLevel;
        
        const dir = pos.clone().normalize();
        const terrainRadius = this.terrain.getRadiusAt(dir);
        
        // Actually underwater if terrain is below water level
        return terrainRadius < waterRadius;
    }
    
    /**
     * Check if position is near water edge by finding nearest shoreline.
     * Shoreline = where terrain intersects water surface.
     * We search for the nearest shoreline point and check if within avoidance margin.
     */
    isNearWaterEdge(pos) {
        const waterLevel = this.terrain.params.waterLevel || 0;
        const baseRadius = this.terrain.params.radius;
        const waterRadius = baseRadius + waterLevel;
        const buffer = this.config.avoidanceMargin;
        
        const dir = pos.clone().normalize();
        const terrainRadius = this.terrain.getRadiusAt(dir);
        
        // If underwater, this is FORBIDDEN not avoidance
        if (terrainRadius < waterRadius) {
            return false;
        }
        
        // Search for nearest shoreline in 8 directions
        const up = dir.clone();
        const searchSteps = 10;
        const stepSize = buffer / searchSteps;
        
        // Get a perpendicular vector for searching
        const randomPerp = new THREE.Vector3(1, 0, 0);
        if (Math.abs(up.dot(randomPerp)) > 0.9) {
            randomPerp.set(0, 1, 0);
        }
        const tangent1 = new THREE.Vector3().crossVectors(up, randomPerp).normalize();
        const tangent2 = new THREE.Vector3().crossVectors(up, tangent1).normalize();
        
        // Search in 8 directions
        for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
            const searchDir = new THREE.Vector3()
                .addScaledVector(tangent1, Math.cos(angle))
                .addScaledVector(tangent2, Math.sin(angle))
                .normalize();
            
            // Walk along surface in this direction
            for (let step = 1; step <= searchSteps; step++) {
                const testPos = pos.clone().addScaledVector(searchDir, step * stepSize);
                const testDir = testPos.normalize();
                const testTerrainRadius = this.terrain.getRadiusAt(testDir);
                
                // Found shoreline (terrain at water level)
                if (testTerrainRadius < waterRadius) {
                    // Distance to this shoreline point is approximately step * stepSize
                    const distToShoreline = step * stepSize;
                    if (distToShoreline < buffer) {
                        return true; // Near water edge
                    }
                    break; // Found shore in this direction, stop searching
                }
            }
        }
        
        return false;
    }
    
    /**
     * Check if a position is valid as a destination.
     * FORBIDDEN zones cannot be targeted by user.
     */
    isValidDestination(pos, capabilities = null) {
        return this.getZoneType(pos, capabilities) !== 'FORBIDDEN';
    }
    
    /**
     * Check if position is inside rock zone with margin.
     */
    isInsideRockZone(pos, margin) {
        if (!this.rockSystem || !this.rockSystem.rocks) return false;
        
        for (const rockMesh of this.rockSystem.rocks) {
            if (!rockMesh) continue;
            
            const rockPos = rockMesh.position;
            let rockRadius;
            if (rockMesh.userData && rockMesh.userData.collisionRadius) {
                rockRadius = rockMesh.userData.collisionRadius;
            } else {
                const rockScale = rockMesh.scale;
                rockRadius = Math.max(rockScale.x, rockScale.y, rockScale.z) * 1.5;
            }
            
            const dist = pos.distanceTo(rockPos);
            if (dist < rockRadius + margin) {
                return true;
            }
        }
        return false;
    }
    
    /**
     * Check if position is underwater with margin.
     * Compares actual terrain height to water level.
     */
    isUnderwaterZone(pos, margin) {
        const waterLevel = this.terrain.params.waterLevel || 0;
        const baseRadius = this.terrain.params.radius;
        const waterRadius = baseRadius + waterLevel;
        
        // Get actual terrain height at this direction
        const dir = pos.clone().normalize();
        const terrainRadius = this.terrain.getRadiusAt(dir);
        
        // Underwater if terrain is below water level (with margin)
        return terrainRadius < waterRadius + margin;
    }
    
    /**
     * Plan a path from start to goal using hierarchical approach.
     */
    planPath(startPos, goalPos, options = {}) {
        const startTime = performance.now();
        this.config.debugPoints = []; // Clear debug
        
        // Step 1: Global A*
        const globalResult = this.navMesh.findPath(startPos, goalPos, { smoothPath: false });
        
        if (!globalResult.success) {
            console.warn('[PathPlanner] Global A* failed:', globalResult.reason);
            // Fallback: Check if start/goal are safe?
            // For now, return direct (game logic usually handles this fallback)
            return [startPos.clone(), goalPos.clone()];
        }
        
        let path = globalResult.path;
        console.log(`[PathPlanner] Global A* found ${path.length} points`);
        
        // Step 2: Refine Segments
        const refinedPath = [path[0].clone()];
        
        for (let i = 0; i < path.length - 1; i++) {
            const segStart = path[i];
            const segEnd = path[i + 1];
            
            if (this.hasObstacle(segStart, segEnd)) {
                // Obstacle detected - run local refinement
                // TRY 1: Default margin
                let localPath = this._attemptRefineSegment(segStart, segEnd, this.config.channelMargin);
                
                // TRY 2: Wider margin (detour) if failed
                if (!localPath) {
                    console.log(`[PathPlanner] Segment ${i} refinement failed. Retrying with wider channel...`);
                    localPath = this._attemptRefineSegment(segStart, segEnd, this.config.channelMargin * 3.0);
                }

                if (localPath) {
                    // Add all points except first
                    for (let j = 1; j < localPath.length; j++) {
                        refinedPath.push(localPath[j]);
                    }
                } else {
                    // Start/End might be blocked. Stop path to avoid clipping.
                    console.warn(`[PathPlanner] Segment ${i} blocked. Stopping path to avoid clipping.`);
                    break;
                }
            } else {
                refinedPath.push(segEnd.clone());
            }
        }
        
        // Step 3: Project
        const projectedPath = refinedPath.map(p => this.projectToTerrain(p));
        const totalTime = performance.now() - startTime;
        console.log(`[PathPlanner] Complete: ${projectedPath.length} points in ${totalTime.toFixed(1)}ms`);
        
        return projectedPath;
    }

    /**
     * Check if a segment passes through any obstacle (rock or water).
     * 
     * @param {THREE.Vector3} from - Segment start
     * @param {THREE.Vector3} to - Segment end
     * @returns {boolean} True if obstacle exists along segment
     */
    hasObstacle(from, to) {
        const samples = this.config.segmentSampleCount;
        
        for (let i = 0; i <= samples; i++) {
            const t = i / samples;
            this._v1.lerpVectors(from, to, t);
            const surfacePos = this.projectToTerrain(this._v1);
            
            // Simple direct checks - more reliable
            if (this.isInsideRockCore(surfacePos)) {
                return true;
            }
            if (this.isActuallyUnderwater(surfacePos)) {
                return true;
            }
            // Also check avoidance zones (unit should go around these)
            if (this.isInRockAvoidanceZone(surfacePos) || this.isNearWaterEdge(surfacePos)) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * Internal helper to refine a segment with specific margin.
     * Returns null on failure.
     */
    _attemptRefineSegment(from, to, marginOverride = null) {
        const { unitCollisionRadius, channelMargin, localNodeSpacing, maxLocalNodes } = this.config;
        
        // DYNAMIC CHANNEL WIDTH
        const obsRadius = this.getMaxIntersectingRadius(from, to, 15);
        const dynamicMargin = marginOverride !== null ? marginOverride : Math.max(channelMargin, obsRadius * 1.5);
        
        const effectiveRadius = unitCollisionRadius;
        const channelWidth = (effectiveRadius + dynamicMargin) * 2;
        
        const length = from.distanceTo(to);
        if (length < 0.01) return [from.clone()];
        
        const dir = this._v1.subVectors(to, from).normalize();
        const midpoint = this._v2.lerpVectors(from, to, 0.5);
        const surfaceMid = this.projectToTerrain(midpoint);
        const up = surfaceMid.clone().normalize();
        const side = this._v3.crossVectors(dir, up).normalize();
        
        const lengthSteps = Math.min(Math.ceil(length / localNodeSpacing), 160); // 2x for density
        const widthSteps = Math.min(Math.ceil(channelWidth / localNodeSpacing), 100); // 2x for density
        const halfWidth = widthSteps / 2;
        
        // Safety check on total nodes
        if (lengthSteps * widthSteps > maxLocalNodes) {
             // Too big for local grid - maybe return null to force simpler path?
             // Or construct coarser grid? For now, allow it but warn.
             // console.warn("[PathPlanner] Local grid too large, capping.");
        }

        // Generate grid nodes
        const nodes = [];
        const nodeMap = new Map();
        
        for (let row = 0; row <= lengthSteps; row++) {
            for (let col = 0; col <= widthSteps; col++) {
                const alongT = row / lengthSteps;
                const sideOffset = (col - halfWidth) * localNodeSpacing;
                
                const pos = from.clone()
                    .addScaledVector(dir, alongT * length)
                    .addScaledVector(side, sideOffset);
                
                const surfacePos = this.projectToTerrain(pos);
                
                // Use zone system for walkability
                const zoneType = this.getZoneType(surfacePos);
                const walkable = zoneType !== 'FORBIDDEN';
                const isAvoidance = zoneType === 'AVOIDANCE';
                
                const index = nodes.length;
                nodes.push({
                    index,
                    position: surfacePos,
                    walkable,
                    isAvoidance,  // For A* cost penalty
                    zoneType,
                    row,
                    col,
                    neighbors: []
                });
                nodeMap.set(`${row},${col}`, index);

                // Debug - now with 3 colors
                if (this.config.debugEnabled) {
                    this.config.debugPoints.push({ 
                        position: surfacePos.clone(), 
                        walkable,
                        zoneType  // 'FORBIDDEN', 'AVOIDANCE', or 'FREE'
                    });
                }
            }
        }
        
        // Build neighbors
        const directions = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
        for (const node of nodes) {
            for (const [dr, dc] of directions) {
                const key = `${node.row + dr},${node.col + dc}`;
                if (nodeMap.has(key)) node.neighbors.push(nodeMap.get(key));
            }
        }
        
        // Find best start/goal nodes - Scan WIDER in the row if closest is blocked
        const startNode = this.findBestNodeInRow(nodes, from, 0);
        const goalNode = this.findBestNodeInRow(nodes, to, lengthSteps);
        
        if (!startNode || !goalNode) return null;
        
        // A*
        const localPath = this.localAStar(nodes, startNode.index, goalNode.index);
        
        if (localPath.length === 0) return null; // Failure
        
        return localPath.map(idx => nodes[idx].position.clone());
    }

    /**
     * Find best walkable node in row, closest to target position.
     */
    findBestNodeInRow(nodes, targetPos, rowIdx) {
        let bestNode = null;
        let minDist = Infinity;
        
        for (const node of nodes) {
            if (node.row !== rowIdx) continue;
            if (!node.walkable) continue;
            
            const dist = node.position.distanceToSquared(targetPos);
            if (dist < minDist) {
                minDist = dist;
                bestNode = node;
            }
        }
        return bestNode;
    }

    // OLD FUNCTIONS TO REMOVE/IGNORE (Defined above in new methods)
    refineSegment(from, to, unitRadius) {
        // Wrapper for compatibility if called directly
        return this._attemptRefineSegment(from, to) || [from.clone(), to.clone()];
    }

    findClosestNode(nodes, pos, targetRow) { return this.findBestNodeInRow(nodes, pos, targetRow); } // Alias

    /**
     * Helper methods
     */
    
    /**
     * Simple A* implementation for local grid.
     */
    localAStar(nodes, startIdx, goalIdx) {
        const openSet = new Set([startIdx]);
        const cameFrom = new Map();
        
        const gScore = new Map();
        const fScore = new Map();
        
        gScore.set(startIdx, 0);
        fScore.set(startIdx, nodes[startIdx].position.distanceTo(nodes[goalIdx].position));
        
        const maxSteps = 2000;
        let steps = 0;

        while (openSet.size > 0) {
            steps++;
            if (steps > maxSteps) {
                console.warn('[PathPlanner] Local A* limit exceeded!');
                break;
            }

            // Find node with lowest fScore in openSet
            // Deterministic tie-breaking: when fScores are equal, prefer lower node index (Issue 7).
            let current = null;
            let lowestF = Infinity;
            for (const idx of openSet) {
                const f = fScore.get(idx) || Infinity;
                if (f < lowestF || (f === lowestF && idx < current)) {
                    lowestF = f;
                    current = idx;
                }
            }
            
            if (current === goalIdx) {
                // Reconstruct path
                const path = [current];
                let safety = 0;
                while (cameFrom.has(current)) {
                    current = cameFrom.get(current);
                    path.unshift(current);
                    if (++safety > 1000) break; // Safety break
                }
                return path;
            }
            
            openSet.delete(current);
            
            for (const neighborIdx of nodes[current].neighbors) {
                const neighbor = nodes[neighborIdx];
                if (!neighbor.walkable) continue;
                
                // Base cost is distance
                let moveCost = nodes[current].position.distanceTo(neighbor.position);
                
                // AVOIDANCE PENALTY: Multiply cost for avoidance zones
                if (neighbor.isAvoidance) {
                    moveCost *= this.config.avoidanceCostMultiplier;
                }
                
                const tentativeG = gScore.get(current) + moveCost;
                
                if (tentativeG < (gScore.get(neighborIdx) || Infinity)) {
                    cameFrom.set(neighborIdx, current);
                    gScore.set(neighborIdx, tentativeG);
                    fScore.set(neighborIdx, tentativeG + 
                        neighbor.position.distanceTo(nodes[goalIdx].position));
                    openSet.add(neighborIdx);
                }
            }
        }
        
        return []; // No path found
    }
    
    /**
     * Find the closest walkable node to a position in a specific row.
     */
    findClosestNode(nodes, pos, targetRow) {
        let closest = null;
        let minDist = Infinity;
        
        for (const node of nodes) {
            if (node.row !== targetRow) continue;
            if (!node.walkable) continue;
            
            const dist = node.position.distanceToSquared(pos);
            if (dist < minDist) {
                minDist = dist;
                closest = node;
            }
        }
        
        return closest;
    }
    
    /**
     * Project a position onto the terrain surface.
     */
    projectToTerrain(pos) {
        const dir = pos.clone().normalize();
        const radius = this.terrain.getRadiusAt(dir);
        return dir.multiplyScalar(radius);
    }
    
    /**
     * Scan a segment for intersecting rocks and return the maximum radius found.
     */
    getMaxIntersectingRadius(from, to, samples = 10) {
        let maxRadius = 0;
        
        // DYNAMIC SAMPLING: Sample every 2 meters to ensure we catch rocks
        const dist = from.distanceTo(to);
        const dynamicSamples = Math.ceil(dist / 2.0);
        const numSamples = Math.max(samples, dynamicSamples);
        
        for (let i = 0; i <= numSamples; i++) {
            const t = i / numSamples;
            const pos = this._v1.lerpVectors(from, to, t);
            // Project to terrain surface (approx)? Rock check usually handles height.
            // But rocks are on terrain. We should ideally project.
            // Using logic similar to isInsideRock
            
            const surfacePos = this.projectToTerrain(pos);
            
            for (const rock of this.rockSystem.rocks) {
                const rockPos = rock.position;
                 // Quick bounding check (assume max rock size ~20 if not specified)
                if (Math.abs(rockPos.x - surfacePos.x) > 30 || Math.abs(rockPos.z - surfacePos.z) > 30) continue;

                // Get radius (collision or scale-based)
                const r = rock.userData.collisionRadius || (rock.scale.x * 2.5); // Fallback estimate
                
                const distSq = rockPos.distanceToSquared(surfacePos);
                if (distSq < r * r) {
                    if (r > maxRadius) maxRadius = r;
                }
            }
        }
        return maxRadius;
    }

    /**
     * Check if position is inside any rock's collision radius.
     */
    isInsideRock(pos) {
        if (!this.rockSystem || !this.rockSystem.rocks) return false;
        
        const checkRadius = this.config.obstacleCheckRadius;
        
        for (const rockMesh of this.rockSystem.rocks) {
            if (!rockMesh) continue;
            
            const rockPos = rockMesh.position;
            
            // Use stored collision radius if available, otherwise estimate
            let rockRadius;
            if (rockMesh.userData && rockMesh.userData.collisionRadius) {
                rockRadius = rockMesh.userData.collisionRadius;
            } else {
                const rockScale = rockMesh.scale;
                rockRadius = Math.max(rockScale.x, rockScale.y, rockScale.z) * 1.5;
            }
            
            const dist = pos.distanceTo(rockPos);
            if (dist < rockRadius + checkRadius) {
                return true;
            }
        }
        
        return false;
    }
    
    /**
     * Check if position is below water level.
     */
    isUnderwater(pos) {
        const waterLevel = this.terrain.params.waterLevel || 0;
        const baseRadius = this.terrain.params.radius;
        const waterRadius = baseRadius + waterLevel;
        
        // FIX: Changed from -0.5 to +0.5 margin
        // The +0.5 makes it MORE sensitive (detects water earlier)
        // Previously -0.5 was making it LESS sensitive (missing water areas)
        const isWater = pos.length() < waterRadius + 0.5;
        return isWater;
    }
    
    /**
     * Enable/disable debug visualization.
     */
    setDebugEnabled(enabled) {
        this.config.debugEnabled = enabled;
    }

    /**
     * Clear existing debug points.
     */
    clearDebug() {
        this.config.debugPoints = [];
    }
    
    /**
     * Get debug points for visualization (call after planPath).
     */
    getDebugPoints() {
        return this.config.debugPoints;
    }
}
