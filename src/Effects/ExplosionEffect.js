/**
 * ExplosionEffect — One-shot visual explosion (flash + particle burst).
 *
 * Fire-and-forget: call ExplosionEffect.spawn(position, scene).
 * Auto-cleans up after 2 seconds.
 *
 * @module Effects/ExplosionEffect
 */

import * as THREE from 'three';

/** Shared geometry and material (lazy-init) */
let _sharedGeo = null;
let _sharedMat = null;

const PARTICLE_COUNT = 40;
const LIFETIME = 1.5;  // seconds
const FLASH_DURATION = 0.3; // seconds

function ensureShared() {
    if (_sharedGeo) return;

    _sharedGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const velocities = new Float32Array(PARTICLE_COUNT * 3);
    const ages = new Float32Array(PARTICLE_COUNT);

    _sharedGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    // Store velocities and ages as custom attributes (managed per-instance)

    _sharedMat = new THREE.PointsMaterial({
        color: 0xffaa33,
        size: 0.8,
        transparent: true,
        opacity: 1.0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true
    });
}

export class ExplosionEffect {
    /**
     * Spawn a one-shot explosion at a world position.
     * @param {THREE.Vector3} position - World position
     * @param {THREE.Scene} scene - Scene to add effect to
     */
    static spawn(position, scene) {
        if (!scene) return;
        ensureShared();
        new ExplosionEffect(position.clone(), scene);
    }

    /** @private */
    constructor(center, scene) {
        this._scene = scene;
        this._center = center;
        this._elapsed = 0;
        this._velocities = [];

        // Particle system
        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(PARTICLE_COUNT * 3);
        const up = center.clone().normalize();

        for (let i = 0; i < PARTICLE_COUNT; i++) {
            // Start at explosion center
            positions[i * 3] = center.x;
            positions[i * 3 + 1] = center.y;
            positions[i * 3 + 2] = center.z;

            // Random outward velocity biased upward (away from planet)
            const speed = 3 + Math.random() * 8;
            const dir = new THREE.Vector3(
                (Math.random() - 0.5) * 2,
                (Math.random() - 0.5) * 2,
                (Math.random() - 0.5) * 2
            ).normalize();

            // Bias toward surface normal (60% up, 40% random)
            dir.lerp(up, 0.6).normalize().multiplyScalar(speed);

            this._velocities.push(dir);
        }

        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const mat = new THREE.PointsMaterial({
            color: 0xffaa33,
            size: 0.6,
            transparent: true,
            opacity: 1.0,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            sizeAttenuation: true
        });

        this._points = new THREE.Points(geo, mat);
        this._points.frustumCulled = false;
        scene.add(this._points);

        // Point light flash
        this._light = new THREE.PointLight(0xff8800, 0, 25);
        this._light.position.copy(center);
        scene.add(this._light);

        // Start update loop
        this._raf = null;
        this._lastTime = performance.now();
        this._tick = this._tick.bind(this);
        this._raf = requestAnimationFrame(this._tick);
    }

    /** @private */
    _tick(now) {
        const dt = Math.min((now - this._lastTime) / 1000, 0.1);
        this._lastTime = now;
        this._elapsed += dt;

        if (this._elapsed > LIFETIME + 0.5) {
            this._cleanup();
            return;
        }

        // Update light flash
        if (this._elapsed < FLASH_DURATION) {
            const t = this._elapsed / FLASH_DURATION;
            // Quick ramp up then decay
            this._light.intensity = (t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8) * 50;
        } else {
            this._light.intensity = 0;
        }

        // Update particles
        const positions = this._points.geometry.attributes.position.array;
        const lifeFrac = Math.min(this._elapsed / LIFETIME, 1);

        for (let i = 0; i < PARTICLE_COUNT; i++) {
            const vel = this._velocities[i];
            positions[i * 3] += vel.x * dt;
            positions[i * 3 + 1] += vel.y * dt;
            positions[i * 3 + 2] += vel.z * dt;

            // Apply gravity toward planet center (decelerate particles)
            const px = positions[i * 3], py = positions[i * 3 + 1], pz = positions[i * 3 + 2];
            const len = Math.sqrt(px * px + py * py + pz * pz);
            if (len > 0.1) {
                const gForce = 3.0 * dt;
                vel.x -= (px / len) * gForce;
                vel.y -= (py / len) * gForce;
                vel.z -= (pz / len) * gForce;
            }
        }

        this._points.geometry.attributes.position.needsUpdate = true;

        // Fade out opacity
        this._points.material.opacity = Math.max(0, 1 - lifeFrac);
        this._points.material.size = 0.6 + lifeFrac * 1.5; // Grow slightly as they fade

        this._raf = requestAnimationFrame(this._tick);
    }

    /** @private */
    _cleanup() {
        if (this._raf) cancelAnimationFrame(this._raf);
        if (this._points) {
            this._scene.remove(this._points);
            this._points.geometry.dispose();
            this._points.material.dispose();
        }
        if (this._light) {
            this._scene.remove(this._light);
            this._light.dispose();
        }
    }
}
