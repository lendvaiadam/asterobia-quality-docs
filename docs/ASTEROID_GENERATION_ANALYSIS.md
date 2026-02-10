# Procedural Asteroid Generation Analysis & Plan (R013)

## 1. Current State Analysis (`Planet.js` & `Terrain.js`)

The current implementation in `Planet.js` and `Terrain.js` uses a classic **"Displaced Sphere"** approach.
*   **Base Geometry**: A high-resolution `BoxGeometry` mapped to a sphere (CubeSphere).
*   **Displacement**: Uses multiple layers of `SimplexNoise` (Continent, Mountain, Detail layers) to push vertices outward along their normal vector.
*   **Texturing**: Uses standard UV mapping with a tiled sand texture.

**Pros:**
*   Fast to generate.
*   Great for "Planets" (large scale features like continents/oceans).
*   Easy collision detection (height = radius + noise).

**Cons (Why it fails the "Asteroid Test"):**
*   **"Potato-ness" Limit**: The displacement is always radial (along the normal). It cannot create overhangs, deep chasms, or the chaotic, non-spherical shapes seen in real asteroids (e.g., Eros, Itokawa).
*   **Soft Features**: Simplex noise tends to be "smooth" and "cloud-like". Asteroids are jagged, crystalline, and fractured.
*   **No Impact History**: Real asteroids are defined by **craters**. The current noise generator creates bumps, but not the specific ring-and-depression shape of craters.
*   **Texture Distortion**: Standard UV mapping on a distorted sphere leads to stretching at poles or irregular areas.

## 2. Requirement Analysis: "The Rover Perspective"

Since the player is **driving a rover on the surface**, two conflicting requirements emerge:
1.  **Macro Shape**: The asteroid must look cool from orbit (irregular, cratered).
2.  **Micro Detail**: The ground under the wheels must have high-frequency detail (pebbles, dust flow, sharp rocks) and accurate collision.

**The "Infinite Variation" Constraint**:
We need a seed-based generator that produces consistent results (positions of craters/mountains) without storing gigabytes of mesh data.

## 3. Proposed "State-of-the-Art" Solution (Web/Three.js)

To achieve the look of the reference images, we need to upgrade the pipeline:

### A. Shape Generation (The "Potato" Factor)
Instead of just `Radius + Noise`, we need a **Composition of Modifiers**:

1.  **Base Distortion (Low Frequency)**:
    *   Start with a Sphere.
    *   Apply a strong 3D Perlin Noise to the *vertex positions* (x, y, z), not just the radius. This warps the sphere into a random blob.
2.  **Voronoi/Cellular Noise (Medium Frequency)**:
    *   Use 3D Cellular Noise (Voronoi) to create "facets" or "plates". This gives the asteroid a blocky, chiseled look, rather than a smooth organic blobs look.
3.  **Crater Bombing (The Key Feature)**:
    *   **Algorithm**: Not noise! We generate a `CraterList` based on the seed (e.g., 50 large craters, 200 small ones).
    *   **Data**: Each crater has a center (lat/long or vector), radius, and depth.
    *   **Application**: For every vertex, we check distance to nearest craters. If inside a crater radius:
        *   Push vertex IN (Bowl).
        *   Push rim vertices OUT (Rim).
        *   *Optimization*: Use a spatial hash or grid to only check nearby craters.

### B. Surface Material (The "Regolith" Look)
The photos show **Dust (Regolith)** in hollows and **Sharp Rock** on ridges.

1.  **Tri-Planar Mapping (Shader)**:
    *   Eliminates UV distortion.
    *   Projects textures from X, Y, Z axes and blends them based on surface normal.
    *   Essential for irregular asteroid shapes.
2.  **Vertex Colors / Splat Map**:
    *   **Rule**: `Color = mix(Rock, Dust, curvature)`.
    *   Calculate **Curvature/Convexity** of the mesh. concave areas (hollows, crater floors) get "Dust" material. Convex areas (rims, ridges) get "Rock" material.
    *   This automatically places dust in craters!
3.  **Detail Normals**:
    *   A high-frequency tiling normal map (rock grain) helps the rover-scale visuals look crisp even if geometry is low-poly.

### C. The Geometry Strategy (LOD vs. Collision)

Since we are ON the planet:
*   **Chunked System**: We cannot render the whole detailed asteroid at once if it's huge.
*   **ROVER View**: The area around the rover needs high-res physics.
*   **Solution**:
    *   **Visual Mesh**: The whole asteroid is one mesh (LOD 0) or 6 faces (QuadSphere).
    *   **Physics Mesh**: Only generate high-res physics mesh *under the rover*.
    *   *Alternative (Simpler)*: keep the asteroid small (e.g. 1-2km diameter) and just use one medium-high res mesh (60k vertices) which modern GPUs handle fine.

## 4. Implementation Steps (Refactoring `Planet.js`)

1.  **`AsteroidShape.js`**: Create a specialized geometry builder.
    *   Input: `seed`, `radius`.
    *   Step 1: Base Sphere -> Warp with Noise (Potato).
    *   Step 2: Generate Crater Data (List of {pos, radius}).
    *   Step 3: Iterate vertices -> Apply Craters -> Apply Noise Detail.
2.  **`AsteroidShader.js`**:
    *   Custom ShaderMaterial with Tri-planar support.
    *   Inputs: `uRockTexture`, `uDustTexture`, `uNormalMap`.
    *   Logic: Blend based on slope/curvature.
3.  **Physics Integration**:
    *   Ensure the rover drives on this modified mesh (using raycasting or physics engine mesh collider).

## Recommended "Tech Stack" for Generator
*   **Noise Lib**: `simplex-noise` (current) is fine.
*   **Geometry**: `THREE.IcosahedronGeometry` (better uniform triangles than Box/Sphere).
*   **Texturing**: 3 distinct textures (Dust, Rock, Cliff).
