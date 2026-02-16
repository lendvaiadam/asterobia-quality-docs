import * as THREE from 'three';

/**
 * Atmosphere - Physically-based atmospheric scattering for spherical planet
 *
 * Phase 1: Sky dome with Rayleigh + Mie single-pass scattering.
 * Renders on a sphere mesh with dynamic side-switching:
 *   - BackSide when camera is inside the atmosphere (ground / low orbit)
 *   - FrontSide when camera is outside (deep space view)
 *
 * Additive blending ensures stars remain visible through the atmosphere.
 * Shadow check per-sample ensures the dark side has no atmospheric glow.
 *
 * Performance: 8 primary + 4 light samples, dithered to eliminate banding.
 * Target: Intel HD 4000 at 1080p.
 */

// ─── Vertex Shader ─────────────────────────────────────────────────────────────

const VERTEX_SHADER = /* glsl */ `
varying vec3 vWorldPosition;

void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

// ─── Fragment Shader ────────────────────────────────────────────────────────────

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform vec3  uSunDirection;
uniform vec3  uCameraPosition;
uniform float uPlanetRadius;
uniform float uAtmosphereRadius;
uniform vec3  uRayleighCoeff;
uniform float uMieCoeff;
uniform float uMieG;
uniform float uSunIntensity;
uniform float uScaleHeightR;
uniform float uScaleHeightM;

varying vec3 vWorldPosition;

#define PI 3.14159265359
#define NUM_SAMPLES 8
#define NUM_LIGHT_SAMPLES 4

// Ray-sphere intersection.
// Returns (tNear, tFar). Both negative means no hit.
vec2 raySphereIntersect(vec3 ro, vec3 rd, float radius) {
    float b = dot(ro, rd);
    float c = dot(ro, ro) - radius * radius;
    float d = b * b - c;
    if (d < 0.0) return vec2(-1.0, -1.0);
    d = sqrt(d);
    return vec2(-b - d, -b + d);
}

void main() {
    vec3 rayDir = normalize(vWorldPosition - uCameraPosition);

    // Intersect view ray with atmosphere shell and planet core
    vec2 atmoHit   = raySphereIntersect(uCameraPosition, rayDir, uAtmosphereRadius);
    vec2 planetHit = raySphereIntersect(uCameraPosition, rayDir, uPlanetRadius);

    // Ray misses atmosphere entirely
    if (atmoHit.y < 0.0) discard;

    float tStart = max(atmoHit.x, 0.0); // clamp entry to camera position
    float tEnd   = atmoHit.y;           // atmosphere exit

    // If ray hits planet surface, stop integration there
    if (planetHit.x > 0.0) {
        tEnd = min(tEnd, planetHit.x);
    }

    if (tStart >= tEnd) discard;

    // ── Numerical integration along view ray ──
    float stepSize = (tEnd - tStart) / float(NUM_SAMPLES);

    vec3  totalR    = vec3(0.0); // accumulated Rayleigh in-scatter (per-channel)
    vec3  totalM    = vec3(0.0); // accumulated Mie in-scatter (per-channel)
    float optDepthR = 0.0;      // view-ray optical depth (Rayleigh)
    float optDepthM = 0.0;      // view-ray optical depth (Mie)

    for (int i = 0; i < NUM_SAMPLES; i++) {
        float t   = tStart + stepSize * (float(i) + 0.5);
        vec3  pos = uCameraPosition + rayDir * t;
        float alt = length(pos) - uPlanetRadius;

        // Local density × step
        float hr = exp(-alt / uScaleHeightR) * stepSize;
        float hm = exp(-alt / uScaleHeightM) * stepSize;

        optDepthR += hr;
        optDepthM += hm;

        // ── Light (sun) ray from sample point ──
        // Shadow: if sun ray hits planet, this point receives no light
        vec2 sunPlanet = raySphereIntersect(pos, uSunDirection, uPlanetRadius);
        if (sunPlanet.x > 0.0) continue; // in planet shadow → dark side

        vec2  sunAtmo   = raySphereIntersect(pos, uSunDirection, uAtmosphereRadius);
        float lightStep = sunAtmo.y / float(NUM_LIGHT_SAMPLES);
        float lightOptR = 0.0;
        float lightOptM = 0.0;

        for (int j = 0; j < NUM_LIGHT_SAMPLES; j++) {
            float tl   = lightStep * (float(j) + 0.5);
            vec3  lpos = pos + uSunDirection * tl;
            float lalt = length(lpos) - uPlanetRadius;
            lightOptR += exp(-lalt / uScaleHeightR) * lightStep;
            lightOptM += exp(-lalt / uScaleHeightM) * lightStep;
        }

        // Combined extinction (view path + light path)
        vec3 tau = uRayleighCoeff * (optDepthR + lightOptR)
                 + vec3(uMieCoeff) * (optDepthM + lightOptM);
        vec3 atten = exp(-tau);

        totalR += hr * atten;
        totalM += hm * atten;
    }

    // ── Phase functions ──
    float cosTheta = dot(rayDir, uSunDirection);
    float cos2     = cosTheta * cosTheta;

    // Rayleigh phase:  3 / (16π) · (1 + cos²θ)
    float phaseR = 0.0596831 * (1.0 + cos2);

    // Mie phase (Henyey-Greenstein)
    float g  = uMieG;
    float g2 = g * g;
    float phaseM = 0.1193662 * (1.0 - g2) * (1.0 + cos2)
                 / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5));

    // Final scattered radiance
    vec3 color = uSunIntensity * (
        totalR * uRayleighCoeff * phaseR +
        totalM * vec3(uMieCoeff) * phaseM
    );

    // ── Dithering (eliminates banding on smooth gradients) ──
    float noise = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    color += (noise - 0.5) / 255.0;

    gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
}
`;

// ─── Atmosphere Class ───────────────────────────────────────────────────────────

export class Atmosphere extends THREE.Mesh {
    /**
     * @param {number} planetRadius     - Planet surface radius (default 60)
     * @param {number} atmosphereRadius - Outer atmosphere radius (default 75)
     */
    constructor(planetRadius = 60, atmosphereRadius = 75) {
        const geometry = new THREE.SphereGeometry(atmosphereRadius, 64, 32);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uSunDirection:     { value: new THREE.Vector3(1, 0, 0) },
                uCameraPosition:   { value: new THREE.Vector3() },
                uPlanetRadius:     { value: planetRadius },
                uAtmosphereRadius: { value: atmosphereRadius },
                uRayleighCoeff:    { value: new THREE.Vector3(0.005, 0.012, 0.030) },
                uMieCoeff:         { value: 0.01 },
                uMieG:             { value: 0.76 },
                uSunIntensity:     { value: 15.0 },
                uScaleHeightR:     { value: 5.0 },
                uScaleHeightM:     { value: 2.0 },
            },
            vertexShader:   VERTEX_SHADER,
            fragmentShader: FRAGMENT_SHADER,
            transparent: true,
            depthWrite:  false,
            depthTest:   true,
            side:        THREE.BackSide,
            blending:    THREE.AdditiveBlending,
        });

        super(geometry, material);

        this.planetRadius     = planetRadius;
        this.atmosphereRadius = atmosphereRadius;
        this.renderOrder      = -1;  // render before other transparent objects
        this.frustumCulled    = false;

        // Hysteresis flag for side-switching at atmosphere boundary
        this._wasInside = true;
    }

    /**
     * Update atmosphere every frame.
     * @param {THREE.Camera} camera
     * @param {THREE.Vector3} sunPosition - world-space sun position
     */
    update(camera, sunPosition) {
        const camDist = camera.position.length();

        // Dynamic side switching with 2% hysteresis to prevent flicker
        if (this._wasInside && camDist > this.atmosphereRadius * 1.01) {
            this._wasInside = false;
        } else if (!this._wasInside && camDist < this.atmosphereRadius * 0.99) {
            this._wasInside = true;
        }
        this.material.side = this._wasInside ? THREE.BackSide : THREE.FrontSide;

        // Uniforms
        this.material.uniforms.uCameraPosition.value.copy(camera.position);
        this.material.uniforms.uSunDirection.value.copy(sunPosition).normalize();
    }

    dispose() {
        this.geometry.dispose();
        this.material.dispose();
    }
}
