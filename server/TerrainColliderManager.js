/**
 * TerrainColliderManager — JIT static terrain collider patches for Rapier.
 *
 * Generates trimesh collider patches around active physics regions on the
 * spherical planet surface. Patches are cached, evicted when distant, and
 * invalidatable for terrain deformation.
 *
 * Key design:
 *   - Patches are keyed by quantized spherical coordinates (iLat, iLon)
 *   - Each patch is a grid of vertices sampled from ServerTerrain.getRadiusAt()
 *   - Patches are STATIC (Rapier fixed bodies) — never dynamic trimesh
 *   - Hard cap on max active patches prevents runaway memory
 *   - invalidateRegion() destroys overlapping patches (deformation hook)
 *
 * Phase 3 Step 2: Foundation. Not yet wired to unit lifecycle events.
 *
 * @module server/TerrainColliderManager
 */

import { Vec3 } from './SphereMath.js';

/** @type {number} Default patch half-extent in world units (meters on surface) */
const DEFAULT_PATCH_SIZE = 20;

/** @type {number} Default grid spacing within a patch (meters) */
const DEFAULT_GRID_STEP = 1.0;

/** @type {number} Maximum number of active patches (hard cap) */
const DEFAULT_MAX_PATCHES = 64;

export class TerrainColliderManager {
    /**
     * @param {import('./PhysicsWorld.js').PhysicsWorld} physicsWorld
     * @param {import('./ServerTerrain.js').ServerTerrain} terrain
     * @param {Object} [options]
     * @param {number} [options.patchSize=20] - Patch half-extent (meters on surface arc)
     * @param {number} [options.gridStep=1.0] - Grid spacing within a patch (meters)
     * @param {number} [options.maxPatches=16] - Hard cap on active patches
     */
    constructor(physicsWorld, terrain, options = {}) {
        /** @type {import('./PhysicsWorld.js').PhysicsWorld} */
        this._physics = physicsWorld;

        /** @type {import('./ServerTerrain.js').ServerTerrain} */
        this._terrain = terrain;

        /** @type {number} */
        this.patchSize = options.patchSize ?? DEFAULT_PATCH_SIZE;

        /** @type {number} */
        this.gridStep = options.gridStep ?? DEFAULT_GRID_STEP;

        /** @type {number} */
        this.maxPatches = options.maxPatches ?? DEFAULT_MAX_PATCHES;

        /**
         * Active patches keyed by "iLat:iLon" string.
         * @type {Map<string, { body: import('@dimforge/rapier3d-compat').RigidBody, center: {x:number,y:number,z:number}, vertexCount: number }>}
         */
        this._patches = new Map();

        /** @type {number} Total patches ever created (diagnostic) */
        this.totalCreated = 0;

        /** @type {number} Total patches ever evicted (diagnostic) */
        this.totalEvicted = 0;
    }

    /**
     * Number of active patches.
     * @returns {number}
     */
    get patchCount() {
        return this._patches.size;
    }

    /**
     * Ensure terrain collider patches exist around a world position.
     * Generates any missing patches within `radius` of the position.
     * Respects maxPatches cap — will not generate beyond the limit.
     *
     * @param {{ x: number, y: number, z: number }} position - World position
     * @param {number} [radius] - Coverage radius (defaults to patchSize)
     * @returns {number} Number of patches created this call
     */
    ensurePatchesAround(position, radius) {
        const coverRadius = radius ?? this.patchSize;
        const dir = Vec3.normalize(position);

        // Compute latitude/longitude of center
        const lat = Math.asin(Math.max(-1, Math.min(1, dir.y)));
        const lon = Math.atan2(dir.x, dir.z);

        // Compute angular extent of coverage
        const terrainRadius = this._terrain.params.radius;
        const angularCoverage = coverRadius / terrainRadius;

        // Quantized patch angular size
        const patchAngular = this.patchSize / terrainRadius;

        // Range of patch indices to cover
        const iLatCenter = Math.round(lat / patchAngular);
        const iLonCenter = Math.round(lon / patchAngular);
        const patchRange = Math.ceil(angularCoverage / patchAngular);

        let created = 0;

        for (let di = -patchRange; di <= patchRange; di++) {
            for (let dj = -patchRange; dj <= patchRange; dj++) {
                if (this._patches.size >= this.maxPatches) return created;

                const iLat = iLatCenter + di;
                const iLon = iLonCenter + dj;
                const key = `${iLat}:${iLon}`;

                if (this._patches.has(key)) continue;

                // Compute patch center in world space
                const pLat = iLat * patchAngular;
                const pLon = iLon * patchAngular;
                const patchCenter = this._latLonToDir(pLat, pLon);

                this._createPatch(key, patchCenter);
                created++;
            }
        }

        return created;
    }

    /**
     * Evict patches that are too far from any of the given positions.
     *
     * @param {Array<{ x: number, y: number, z: number }>} activePositions
     * @param {number} [maxDistance] - Maximum distance before eviction (defaults to 3× patchSize)
     * @returns {number} Number of patches evicted
     */
    evictDistant(activePositions, maxDistance) {
        const maxDist = maxDistance ?? (this.patchSize * 3);
        const maxDistSq = maxDist * maxDist;
        let evicted = 0;

        for (const [key, patch] of this._patches) {
            let withinRange = false;
            for (const pos of activePositions) {
                const dx = patch.center.x - pos.x;
                const dy = patch.center.y - pos.y;
                const dz = patch.center.z - pos.z;
                if (dx * dx + dy * dy + dz * dz <= maxDistSq) {
                    withinRange = true;
                    break;
                }
            }
            if (!withinRange) {
                this._destroyPatch(key);
                evicted++;
            }
        }

        return evicted;
    }

    /**
     * Invalidate (destroy) all patches overlapping a region.
     * Deformation hook: when terrain changes, call this to force re-generation.
     *
     * @param {{ x: number, y: number, z: number }} center - Center of invalidation
     * @param {number} radius - Invalidation radius
     * @returns {number} Number of patches invalidated
     */
    invalidateRegion(center, radius) {
        const radiusSq = radius * radius;
        let invalidated = 0;

        for (const [key, patch] of this._patches) {
            const dx = patch.center.x - center.x;
            const dy = patch.center.y - center.y;
            const dz = patch.center.z - center.z;
            // Use generous overlap check: patch diagonal + invalidation radius
            const patchDiag = this.patchSize * Math.SQRT2;
            const threshold = radius + patchDiag;
            if (dx * dx + dy * dy + dz * dz <= threshold * threshold) {
                this._destroyPatch(key);
                invalidated++;
            }
        }

        return invalidated;
    }

    /**
     * Destroy all active patches and free physics resources.
     */
    destroyAll() {
        for (const key of [...this._patches.keys()]) {
            this._destroyPatch(key);
        }
    }

    /**
     * Generate trimesh vertex/index data for a terrain patch.
     * Public for testing — normally called internally by _createPatch.
     *
     * @param {{ x: number, y: number, z: number }} centerDir - Normalized direction from origin
     * @param {number} [halfExtent] - Half-extent in meters on surface (defaults to patchSize)
     * @param {number} [step] - Grid spacing in meters (defaults to gridStep)
     * @returns {{ vertices: Float32Array, indices: Uint32Array, gridW: number, gridH: number }}
     */
    generatePatchMesh(centerDir, halfExtent, step) {
        const ext = halfExtent ?? this.patchSize;
        const gridStep = step ?? this.gridStep;
        const terrain = this._terrain;

        // Build local tangent frame at centerDir
        const up = Vec3.normalize(centerDir);
        let tangentU = Vec3.cross({ x: 0, y: 1, z: 0 }, up);
        if (Vec3.lengthSq(tangentU) < 1e-6) {
            tangentU = Vec3.cross({ x: 1, y: 0, z: 0 }, up);
        }
        tangentU = Vec3.normalize(tangentU);
        const tangentV = Vec3.normalize(Vec3.cross(up, tangentU));

        // Grid dimensions
        const gridW = Math.floor(ext * 2 / gridStep) + 1;
        const gridH = gridW;
        const totalVerts = gridW * gridH;
        const totalTris = (gridW - 1) * (gridH - 1) * 2;

        const vertices = new Float32Array(totalVerts * 3);
        const indices = new Uint32Array(totalTris * 3);

        // Sample terrain at grid points
        const terrainRadius = terrain.params.radius;
        for (let iy = 0; iy < gridH; iy++) {
            for (let ix = 0; ix < gridW; ix++) {
                // Offset from center in meters on the surface
                const u = (ix - (gridW - 1) / 2) * gridStep;
                const v = (iy - (gridH - 1) / 2) * gridStep;

                // Convert tangent-plane offset to angular offset, then to direction
                const angU = u / terrainRadius;
                const angV = v / terrainRadius;

                // Rotate centerDir by angU around tangentV, then angV around tangentU
                let dir = this._rotateAround(centerDir, tangentV, angU);
                dir = this._rotateAround(dir, tangentU, angV);
                dir = Vec3.normalize(dir);

                // Get terrain radius at this direction
                const r = terrain.getRadiusAt(dir);

                // World position
                const idx = (iy * gridW + ix) * 3;
                vertices[idx]     = dir.x * r;
                vertices[idx + 1] = dir.y * r;
                vertices[idx + 2] = dir.z * r;
            }
        }

        // Build triangle indices (two triangles per grid cell)
        let triIdx = 0;
        for (let iy = 0; iy < gridH - 1; iy++) {
            for (let ix = 0; ix < gridW - 1; ix++) {
                const i00 = iy * gridW + ix;
                const i10 = i00 + 1;
                const i01 = i00 + gridW;
                const i11 = i01 + 1;

                // Triangle 1: i00, i10, i01 — outward normals (away from planet center)
                indices[triIdx++] = i00;
                indices[triIdx++] = i10;
                indices[triIdx++] = i01;

                // Triangle 2: i10, i11, i01 — outward normals (away from planet center)
                indices[triIdx++] = i10;
                indices[triIdx++] = i11;
                indices[triIdx++] = i01;
            }
        }

        return { vertices, indices, gridW, gridH };
    }

    // ========================================
    // Private
    // ========================================

    /**
     * Create and register a terrain collider patch.
     * @param {string} key - Patch key "iLat:iLon"
     * @param {{ x: number, y: number, z: number }} centerDir - Normalized patch center
     * @private
     */
    _createPatch(key, centerDir) {
        const { vertices, indices } = this.generatePatchMesh(centerDir);

        // Create a fixed body at origin (vertices are in world space)
        const body = this._physics.createFixedBody({ x: 0, y: 0, z: 0 });
        this._physics.addTrimeshCollider(body, vertices, indices);

        // Compute world-space center for distance checks
        const r = this._terrain.getRadiusAt(centerDir);
        const center = Vec3.scale(centerDir, r);

        this._patches.set(key, {
            body,
            center,
            vertexCount: vertices.length / 3
        });
        this.totalCreated++;
    }

    /**
     * Destroy a terrain collider patch.
     * @param {string} key
     * @private
     */
    _destroyPatch(key) {
        const patch = this._patches.get(key);
        if (!patch) return;
        this._physics.removeBody(patch.body);
        this._patches.delete(key);
        this.totalEvicted++;
    }

    /**
     * Convert latitude/longitude to normalized direction vector.
     * @param {number} lat - Latitude in radians
     * @param {number} lon - Longitude in radians
     * @returns {{ x: number, y: number, z: number }}
     * @private
     */
    _latLonToDir(lat, lon) {
        const cosLat = Math.cos(lat);
        return {
            x: cosLat * Math.sin(lon),
            y: Math.sin(lat),
            z: cosLat * Math.cos(lon)
        };
    }

    /**
     * Rotate a vector around an axis by an angle (Rodrigues' rotation).
     * @param {{ x: number, y: number, z: number }} v
     * @param {{ x: number, y: number, z: number }} axis - Must be normalized
     * @param {number} angle - Radians
     * @returns {{ x: number, y: number, z: number }}
     * @private
     */
    _rotateAround(v, axis, angle) {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const dot = Vec3.dot(v, axis);
        const cross = Vec3.cross(axis, v);
        return {
            x: v.x * cos + cross.x * sin + axis.x * dot * (1 - cos),
            y: v.y * cos + cross.y * sin + axis.y * dot * (1 - cos),
            z: v.z * cos + cross.z * sin + axis.z * dot * (1 - cos)
        };
    }
}
