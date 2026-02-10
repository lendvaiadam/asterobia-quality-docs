/**
 * VisionSystem.js
 * @environment client-only
 *
 * Collects vision sources from units and builds GPU-ready instance buffers
 * for per-unit vision rendering on spherical FogOfWar.
 *
 * PURITY AUDIT (2026-02-10):
 *   - Marked @environment client-only (builds GPU buffers, references camera).
 *   - Guarded `performance.now()` default via _perfNow for safe import on Node.js.
 *   - No Three.js import (uses duck-typed position objects).
 *
 * Part of Prompt 06: Per-Unit Vision System
 */

/** Isomorphic high-resolution timer (mirrors TimeSource._perfNow) */
const _perfNow = (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? () => performance.now()
    : () => Date.now();

const DEFAULT_VISION_PERCENT = 50; // Default vision percentage if not set
const PI = Math.PI;
const TWO_PI = Math.PI * 2;

/**
 * Vision source data for a single unit
 * @typedef {Object} VisionSource
 * @property {THREE.Vector3} position - World position
 * @property {number} radius - Vision radius in meters
 * @property {number} uvX - UV X coordinate (0-1)
 * @property {number} uvY - UV Y coordinate (0-1)
 * @property {number} uvRadX - Approximate UV radius in X
 * @property {number} uvRadY - Approximate UV radius in Y
 */

export class VisionSystem {
    /**
     * @param {FogOfWar} fogOfWar - The FogOfWar instance
     * @param {Object} config - Configuration options
     */
    constructor(fogOfWar, config = {}) {
        this.fogOfWar = fogOfWar;
        
        // Planet radius (from FogOfWar)
        this.planetRadius = fogOfWar?.planetRadius || 100;
        
        // Configuration with defaults
        // maxVisionRadius: max vision at 100% stat (default: ~25% of planet circumference)
        this.config = {
            enabled: true,
            maxSources: config.maxSources ?? 64,
            updateHz: config.updateHz ?? 30,  // Updates per second
            softEdge: config.softEdge ?? 0.3,
            debugSources: config.debugSources ?? false,
            maxVisionRadius: config.maxVisionRadius ?? (this.planetRadius * 0.4), // Max vision in meters at 100% stat
            minVisionRadius: config.minVisionRadius ?? 5, // Minimum vision radius in meters
            ...config
        };
        
        // State
        this.sources = [];
        this.lastUpdateTime = 0;
        this.updateInterval = 1000 / this.config.updateHz;
        
        // Instance buffers (pre-allocated for performance)
        // NEW: Localized UV quad buffers
        this.maxBufferSize = 256; // Max instances supported
        this.uvCenterBuffer = new Float32Array(this.maxBufferSize * 2);    // vec2 per instance
        this.uvHalfSizeBuffer = new Float32Array(this.maxBufferSize * 2);  // vec2 per instance
        this.sourceDirBuffer = new Float32Array(this.maxBufferSize * 3);   // vec3 per instance
        this.radiusBuffer = new Float32Array(this.maxBufferSize);          // float per instance
        this.activeSourceCount = 0;
    }

    /**
     * Set configuration value at runtime
     * @param {string} key - Config key
     * @param {*} value - New value
     */
    setConfig(key, value) {
        this.config[key] = value;
        
        if (key === 'updateHz') {
            this.updateInterval = 1000 / value;
        }
    }

    /**
     * Main update - collects vision sources and triggers FogOfWar stamp
     * @param {Unit[]} units - Array of game units
     * @param {THREE.Camera} camera - Current camera (for distance culling)
     * @param {number} now - Current timestamp (performance.now())
     */
    update(units, camera, now = _perfNow()) {
        if (!this.config.enabled) {
            return;
        }
        
        // Throttle updates
        if (now - this.lastUpdateTime < this.updateInterval) {
            return;
        }
        this.lastUpdateTime = now;
        
        // Collect sources
        this.collectSources(units, camera);
        
        // Trigger FogOfWar stamp if we have the method
        if (this.fogOfWar && this.fogOfWar.stampVisionInstanced) {
            this.fogOfWar.stampVisionInstanced(this);
        }
    }

    /**
     * Collect vision sources from units
     * @param {Unit[]} units - Game units
     * @param {THREE.Camera} camera - Camera for distance-based culling
     */
    collectSources(units, camera) {
        this.sources = [];
        
        if (!units || units.length === 0) {
            this.activeSourceCount = 0;
            return;
        }
        
        const cameraPos = camera?.position;
        
        // Build source list with vision radii
        for (const unit of units) {
            if (!unit || !unit.position) continue;
            
            // Get vision PERCENTAGE from effectiveStats (0-100)
            const visionPercent = unit.model?.effectiveStats?.vision ?? DEFAULT_VISION_PERCENT;
            
            // Skip units with 0 vision
            if (visionPercent <= 0) continue;
            
            // Convert percentage to meters: lerp(minRadius, maxRadius, percent/100)
            const t = Math.min(visionPercent, 100) / 100;
            const visionRadius = this.config.minVisionRadius + t * (this.config.maxVisionRadius - this.config.minVisionRadius);
            
            // Calculate UV coordinates from world position
            const uv = this.worldToUV(unit.position);
            
            // Calculate UV radius approximation
            const angularRadius = visionRadius / this.planetRadius;
            const uvRadX = angularRadius / TWO_PI;
            const uvRadY = angularRadius / PI;
            
            // Distance to camera (for sorting/culling)
            const distToCamera = cameraPos ? unit.position.distanceTo(cameraPos) : 0;
            
            this.sources.push({
                position: unit.position.clone(),
                radius: visionRadius,
                uvX: uv.x,
                uvY: uv.y,
                uvRadX,
                uvRadY,
                distToCamera
            });
        }
        
        // Sort by distance to camera (closest first)
        this.sources.sort((a, b) => a.distToCamera - b.distToCamera);
        
        // Cull to maxSources
        if (this.sources.length > this.config.maxSources) {
            this.sources = this.sources.slice(0, this.config.maxSources);
        }
        
        // Handle seam wrapping - duplicate sources near U=0/1
        this.handleSeamWrapping();
        
        // Build GPU buffers
        this.buildBuffers();
        
        if (this.config.debugSources) {
            console.log(`[VisionSystem] ${this.activeSourceCount} sources (${units.length} units)`);
        }
    }

    /**
     * Convert world position to equirectangular UV
     * @param {THREE.Vector3} position - World position
     * @returns {{x: number, y: number}} UV coordinates
     */
    worldToUV(position) {
        const dir = position.clone().normalize();
        
        // Equirectangular projection:
        // u = 0.5 + atan2(z, x) / (2π)
        // v = 0.5 + asin(y) / π
        const u = 0.5 + Math.atan2(dir.z, dir.x) / TWO_PI;
        const v = 0.5 + Math.asin(Math.max(-1, Math.min(1, dir.y))) / PI;
        
        return { x: u, y: v };
    }

    /**
     * Duplicate sources near U=0/1 seam to prevent popping
     */
    handleSeamWrapping() {
        const seamThreshold = 0.15; // 15% of UV width
        const wrappedSources = [];
        
        for (const src of this.sources) {
            // Check if near left seam (U close to 0)
            if (src.uvX - src.uvRadX < seamThreshold) {
                wrappedSources.push({
                    ...src,
                    uvX: src.uvX + 1.0, // Wrap to right
                    isWrapped: true
                });
            }
            
            // Check if near right seam (U close to 1)
            if (src.uvX + src.uvRadX > 1.0 - seamThreshold) {
                wrappedSources.push({
                    ...src,
                    uvX: src.uvX - 1.0, // Wrap to left
                    isWrapped: true
                });
            }
        }
        
        // Add wrapped sources (up to buffer limit)
        const totalAllowed = Math.min(this.maxBufferSize, this.config.maxSources * 2);
        const spaceForWrapped = totalAllowed - this.sources.length;
        
        if (wrappedSources.length > 0 && spaceForWrapped > 0) {
            this.sources.push(...wrappedSources.slice(0, spaceForWrapped));
        }
    }

    /**
     * Build Float32Array buffers for GPU instancing
     * NEW: Builds localized UV quad data instead of world positions
     */
    buildBuffers() {
        const count = Math.min(this.sources.length, this.maxBufferSize);
        
        for (let i = 0; i < count; i++) {
            const src = this.sources[i];
            
            // UV center (vec2)
            this.uvCenterBuffer[i * 2 + 0] = src.uvX;
            this.uvCenterBuffer[i * 2 + 1] = src.uvY;
            
            // UV half-size with pole stretch compensation
            // dv = alpha / π (latitude coverage)
            // du = alpha / (2π * max(cos(latitude), ε)) (longitude coverage, stretched at poles)
            const angularRadius = src.radius / this.planetRadius;
            const latitude = (src.uvY - 0.5) * Math.PI; // -π/2 to π/2
            const cosLat = Math.max(Math.abs(Math.cos(latitude)), 0.01); // Clamp to avoid division by zero
            
            const halfSizeU = (angularRadius / (TWO_PI * cosLat)) * 1.1; // 10% padding
            const halfSizeV = (angularRadius / PI) * 1.1;
            
            this.uvHalfSizeBuffer[i * 2 + 0] = halfSizeU;
            this.uvHalfSizeBuffer[i * 2 + 1] = halfSizeV;
            
            // Source direction (normalized world position)
            const pos = src.position;
            const len = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
            this.sourceDirBuffer[i * 3 + 0] = pos.x / len;
            this.sourceDirBuffer[i * 3 + 1] = pos.y / len;
            this.sourceDirBuffer[i * 3 + 2] = pos.z / len;
            
            // Radius in meters
            this.radiusBuffer[i] = src.radius;
        }
        
        this.activeSourceCount = count;
    }

    /**
     * Get UV center buffer for GPU
     * @returns {Float32Array}
     */
    getUvCenterBuffer() {
        return this.uvCenterBuffer;
    }

    /**
     * Get UV half-size buffer for GPU
     * @returns {Float32Array}
     */
    getUvHalfSizeBuffer() {
        return this.uvHalfSizeBuffer;
    }

    /**
     * Get source direction buffer for GPU
     * @returns {Float32Array}
     */
    getSourceDirBuffer() {
        return this.sourceDirBuffer;
    }

    /**
     * Get radius buffer for GPU
     * @returns {Float32Array}
     */
    getRadiusBuffer() {
        return this.radiusBuffer;
    }

    /**
     * Get current source count
     * @returns {number}
     */
    getSourceCount() {
        return this.activeSourceCount;
    }

    /**
     * Get sources array (for debugging)
     * @returns {VisionSource[]}
     */
    getSources() {
        return this.sources;
    }

    /**
     * Check if system is enabled
     * @returns {boolean}
     */
    isEnabled() {
        return this.config.enabled;
    }

    /**
     * Get soft edge value
     * @returns {number}
     */
    getSoftEdge() {
        return this.config.softEdge;
    }

    /**
     * Get current statistics for debug display
     * @returns {Object} Stats object
     */
    getStats() {
        return {
            mode: 'INSTANCED',
            activeSourceCount: this.activeSourceCount,
            maxSources: this.config.maxSources,
            updateHz: this.config.updateHz,
            enabled: this.config.enabled,
            resolution: this.fogOfWar?.resolution || 2048
        };
    }
}
