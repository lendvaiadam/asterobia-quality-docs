// Rock Collision System for Spherical Terrain
// Lightweight broadphase + precise collision with slide response

import * as THREE from 'three';

export class RockCollisionSystem {
    constructor(planet, rockSystem) {
        this.planet = planet;
        this.rockSystem = rockSystem;
        
        // Config
        this.unitRadius = 0.6;           // Unit bounding sphere
        this.broadphaseRadius = 5.0;     // Distance to check for nearby rocks
        this.slideStrength = 0.8;        // How much to slide (vs stop)
        
        // Debug
        this.debugEnabled = false;
        this.debugVisuals = null;
        
        // Cache
        this.nearbyRocksCache = [];
        this.lastCachePosition = new THREE.Vector3();
        this.cacheValidDistance = 2.0;   // Recalculate if moved this far
        
        console.log('[RockCollision] System initialized');
    }
    
    /**
     * Check collision and return corrected position
     * @param {THREE.Vector3} currentPos - Current unit position
     * @param {THREE.Vector3} desiredPos - Where unit wants to move
     * @returns {{ position: THREE.Vector3, collided: boolean, slideVector: THREE.Vector3 | null }}
     */
    checkAndSlide(currentPos, desiredPos) {
        if (!this.rockSystem || !this.rockSystem.rocks || this.rockSystem.rocks.length === 0) {
            return { position: desiredPos.clone(), collided: false, slideVector: null };
        }
        
        // === BROADPHASE: Find nearby rocks ===
        const nearbyRocks = this.getNearbyRocks(currentPos);
        
        if (nearbyRocks.length === 0) {
            return { position: desiredPos.clone(), collided: false, slideVector: null };
        }
        
        // === PRECISE CHECK: Raycast against actual mesh ===
        let finalPos = desiredPos.clone();
        let collided = false;
        let slideVector = null;
        
        // Movement direction
        const moveDir = desiredPos.clone().sub(currentPos);
        const moveDist = moveDir.length();
        if (moveDist < 0.001) {
            return { position: desiredPos.clone(), collided: false, slideVector: null };
        }
        moveDir.normalize();
        
        // Raycast setup - check slightly ahead
        const raycaster = new THREE.Raycaster(currentPos, moveDir, 0, moveDist + 0.5);
        
        for (const rock of nearbyRocks) {
            // Check ray intersection with rock mesh
            const intersects = raycaster.intersectObject(rock, false);
            
            if (intersects.length > 0) {
                const hit = intersects[0];
                
                // Only block if we would actually reach the rock
                if (hit.distance < moveDist + this.unitRadius) {
                    collided = true;
                    
                    // SIMPLE RESPONSE: Stop at safe distance from hit point
                    // Move along ray to just before the hit point
                    const safeDistance = Math.max(0, hit.distance - this.unitRadius - 0.1);
                    finalPos.copy(currentPos).addScaledVector(moveDir, safeDistance);
                    
                    // Re-project to terrain surface
                    const dir = finalPos.clone().normalize();
                    const terrainRadius = this.planet.terrain.getRadiusAt(dir);
                    finalPos.copy(dir.multiplyScalar(terrainRadius + 0.22));
                    
                    if (this.debugEnabled) {
                        console.log(`[RockCollision] Stop at dist: ${safeDistance.toFixed(2)}`);
                    }
                    
                    break;
                }
            }
        }
        
        // Return bounceDir as opposite of movement direction
        const bounceDir = collided ? moveDir.clone().negate() : null;
        return { position: finalPos, collided, slideVector, bounceDir, moveDist };
    }
    
    /**
     * Get rocks within broadphase radius (cached)
     */
    getNearbyRocks(pos) {
        // Check if cache is still valid
        if (pos.distanceTo(this.lastCachePosition) > this.cacheValidDistance) {
            this.updateNearbyRocksCache(pos);
        }
        return this.nearbyRocksCache;
    }
    
    updateNearbyRocksCache(pos) {
        this.lastCachePosition.copy(pos);
        this.nearbyRocksCache = [];
        
        const rocks = this.rockSystem.rocks;
        for (const rock of rocks) {
            if (!rock.position) continue;
            
            const dist = pos.distanceTo(rock.position);
            if (dist < this.broadphaseRadius) {
                this.nearbyRocksCache.push(rock);
            }
        }
    }
    
    getRockRadius(rock) {
        // Use stored collision radius if available (based on deformed mesh)
        if (rock.userData && rock.userData.collisionRadius) {
            return rock.userData.collisionRadius;
        }
        // Fallback: use scale
        if (rock.scale) {
            return rock.scale.x * 1.2;
        }
        return 1.5; // Default
    }
    
    setDebug(enabled) {
        this.debugEnabled = enabled;
    }
}
