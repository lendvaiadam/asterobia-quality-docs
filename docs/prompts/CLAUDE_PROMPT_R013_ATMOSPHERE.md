# CLAUDE CODE TASK: Implement SOTA Atmosphere System

**Objective:**
Implement a "State of the Art" (physically based, cinematic quality) Atmosphere System for Asterobia.
The user explicitly rejected generic ChatGPT solutions and wants a **"100x better"** solution that is:
1.  **Visually Stunning:** "Sfumato" layers, seamless space-to-ground transitions, beautiful limb darkening/brightening.
2.  **Performance Optimized:** Zero impact on low-end machines (use smart shaders/LUTs, not brute-force raymarching).
3.  **Robust:** Handles camera inside/outside atmosphere, sun below horizon, and arbitrary planet radii.

**Technical Approach (The "100x Better" Plan):**
We will implement a **Single-Pass Analytic Atmosphere** (based on O'Neil/Hillaire simplified) applied to a **Full-Screen Quad** (or a large back-face culled sphere) to render the sky/space view, and a modular shader chunk for aerial perspective on terrain/objects.

*   **Reference:** "Scatter" theory (Rayleigh + Mie).
*   **Key Feature:** The "Feathered" transparency (sfumato) at the planet limb when viewed from space.

**Implementation Steps:**

### 1. Create `src/World/Atmosphere.js`
*   Class `Atmosphere` extending `THREE.Object3D`.
*   **Geometry:** A large high-res sphere (slightly larger than atmosphere radius) or a Full-Screen Quad (if post-process, but sphere is easier to integrate in scene depth). Let's use an **inverted sphere** (back-side) for the sky dome.
*   **Material:** `THREE.ShaderMaterial`.

### 2. The Shader (Vertex + Fragment)
*   **Math:** Implement a robust Ray-Sphere intersection.
*   **Scattering:**
    *   **Rayleigh:** For the blue sky (small particles).
    *   **Mie:** For the white halo/sun glare (larger particles/dust).
*   **Optical Depth:** Numerical integration (loop) with ~8-16 samples is sufficient for high quality if dithered.
*   **Dithering:** CRITICAL for smooth gradients (prevent banding). Use a noise texture or blue noise.
*   **Inputs (Uniforms):**
    *   `uSunPosition` (Vector3)
    *   `uPlanetRadius` (float)
    *   `uAtmosphereRadius` (float)
    *   `uViewPosition` (Vector3 - camera pos)
    *   `uDensityScale` (float)
    *   `uRayleighCoeff` (Vector3)
    *   `uMieCoeff` (float)

### 3. Integration in `PlaceUtils` or `Planet.js`
*   Instantiate `Atmosphere` in `Game.js` or `Planet.js`.
*   Update `uSunPosition` every frame.
*   **Aerial Perspective:** This is the "100x" touch.
    *   The terrain/units need to blend with the sky color based on depth.
    *   *Challenge:* We might not want to rewrite all standard materials.
    *   *Solution:* Use a **Fog-like** approach. If we can, inject a custom Fog shader chunk into `THREE.MeshStandardMaterial` (Terrain/Units/Rocks).

**Constraint & Quality Bar:**
*   **No Banding:** Dithering is mandatory.
*   **Seamless Transition:** Camera moving from R=100 (ground) to R=500 (space) must show smooth horizon depression and sky darkening.
*   **Performance:** Cap raymarch steps (e.g., 8-12 primary, 4-8 secondary/light).
*   **Visuals:** "Feathered" edge means the alpha channel must fade out smoothly at the atmosphere radius, not a hard cut.

**Deliverables:**
1.  `src/World/Atmosphere.js` (The class).
2.  Integration lines in `Game.js` (adding it to scene, updating loop).
3.  (Optional) A `ShaderChunk` injection for Terrain/Rocks to apply the same scattering math to the fog.

**Prompt for You:**
Write the full code for `src/World/Atmosphere.js` using a high-quality, single-pass scattering shader.
Then show how to modify `Game.js` to add it.
