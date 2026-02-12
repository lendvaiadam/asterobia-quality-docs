/**
 * ServerTerrain — Pure JavaScript terrain for authoritative server.
 *
 * Identical math to src/World/Terrain.js (same noise seed, same parameters)
 * but without any Three.js dependency. Server-side only.
 *
 * SYNC CONTRACT: The height functions (getHeight, getRadiusAt, sampleNoise,
 * applyDomainWarp) MUST produce bitwise-identical results to Terrain.js.
 * Any change in Terrain.js height math must be mirrored here.
 *
 * getNormalAt() uses pure-JS Vec3 instead of THREE.Vector3, but the
 * finite-difference algorithm is identical to Terrain.getNormalAt().
 *
 * @module server/ServerTerrain
 */

import { createNoise3D } from 'simplex-noise';
import { Vec3 } from './SphereMath.js';

export class ServerTerrain {
    /**
     * @param {Object} [params] - Terrain parameters (same defaults as client Terrain.js)
     */
    constructor(params = {}) {
        // Same deterministic seed as client: createNoise3D(() => 0.5)
        this.noise3D = createNoise3D(() => 0.5);

        this.params = Object.assign({
            radius: 60,
            heightMultiplier: 6.0,
            noiseType: 'ridged',
            domainWarpStrength: 0.0,
            domainWarpOctaves: 4,
            domainWarpScale: 0.4,
            continentScale: 0.6,
            continentStrength: 0.0,
            mountainScale: 3.0,
            mountainStrength: 0.5,
            detailScale: 2.5,
            detailStrength: 0.5,
            ridgePower: 1.5,
            erosionStrength: 0.05
        }, params);
    }

    // ========================================
    // Height functions — IDENTICAL to Terrain.js
    // ========================================

    applyDomainWarp(x, y, z) {
        let warpX = x, warpY = y, warpZ = z;
        const strength = this.params.domainWarpStrength;
        const scale = this.params.domainWarpScale;

        for (let i = 0; i < this.params.domainWarpOctaves; i++) {
            const freq = Math.pow(2, i) * scale;
            const amp = strength / Math.pow(2, i);

            warpX += this.noise3D(warpY * freq, warpZ * freq, 100 + i) * amp;
            warpY += this.noise3D(warpZ * freq, warpX * freq, 200 + i) * amp;
            warpZ += this.noise3D(warpX * freq, warpY * freq, 300 + i) * amp;
        }

        return { x: warpX, y: warpY, z: warpZ };
    }

    sampleNoise(x, y, z, scale, octaves = 4, persistence = 0.5) {
        let value = 0, amplitude = 1, frequency = scale, maxValue = 0;

        for (let i = 0; i < octaves; i++) {
            let sample = this.noise3D(x * frequency, y * frequency, z * frequency);

            if (this.params.noiseType === 'ridged') {
                sample = 1 - Math.abs(sample);
                sample = Math.pow(sample, this.params.ridgePower);
            } else if (this.params.noiseType === 'billow') {
                sample = Math.abs(sample) * 2 - 1;
            }

            value += sample * amplitude;
            maxValue += amplitude;
            amplitude *= persistence;
            frequency *= 2;
        }

        return value / maxValue;
    }

    getHeight(x, y, z) {
        const warped = this.applyDomainWarp(x, y, z);

        const continent = this.sampleNoise(warped.x, warped.y, warped.z,
            this.params.continentScale, 3, 0.5) * this.params.continentStrength;
        const mountains = this.sampleNoise(warped.x, warped.y, warped.z,
            this.params.mountainScale, 5, 0.5) * this.params.mountainStrength;
        const detail = this.sampleNoise(x, y, z,
            this.params.detailScale, 3, 0.4) * this.params.detailStrength;

        let height = continent + mountains * 0.5 + detail;
        const erosion = this.params.erosionStrength;
        height = height * (1 - erosion) +
            Math.sign(height) * Math.pow(Math.abs(height), 1 + erosion * 0.5) * erosion;

        return height * this.params.heightMultiplier;
    }

    /**
     * Get total radius (base + terrain height) at a given direction from center.
     * @param {{ x: number, y: number, z: number }} direction - Normalized direction vector
     * @returns {number} Radius at that point on the sphere
     */
    getRadiusAt(direction) {
        return this.params.radius + this.getHeight(direction.x, direction.y, direction.z);
    }

    // ========================================
    // Server-only: pure JS terrain normal
    // ========================================

    /**
     * Compute terrain surface normal at a position using finite differences.
     * Pure JS equivalent of Terrain.getNormalAt() (same epsilon, same algorithm).
     *
     * @param {{ x: number, y: number, z: number }} position - World position on/near terrain
     * @returns {{ x: number, y: number, z: number }} Normalized surface normal
     */
    getNormalAt(position) {
        const epsilon = 0.01;
        const normal = Vec3.normalize(position);

        // Build tangent basis at this point on the sphere
        let tangent1 = Vec3.cross({ x: 0, y: 1, z: 0 }, normal);
        if (Vec3.lengthSq(tangent1) < 0.001) {
            tangent1 = Vec3.cross({ x: 1, y: 0, z: 0 }, normal);
        }
        tangent1 = Vec3.normalize(tangent1);

        const tangent2 = Vec3.normalize(Vec3.cross(normal, tangent1));

        // Sample three surface points via finite differences
        const p1Dir = Vec3.normalize(Vec3.add(position, Vec3.scale(tangent1, epsilon)));
        const p2Dir = Vec3.normalize(Vec3.add(position, Vec3.scale(tangent2, epsilon)));

        const v0 = Vec3.scale(normal, this.getRadiusAt(normal));
        const v1 = Vec3.scale(p1Dir, this.getRadiusAt(p1Dir));
        const v2 = Vec3.scale(p2Dir, this.getRadiusAt(p2Dir));

        const edge1 = Vec3.sub(v1, v0);
        const edge2 = Vec3.sub(v2, v0);

        return Vec3.normalize(Vec3.cross(edge1, edge2));
    }
}
