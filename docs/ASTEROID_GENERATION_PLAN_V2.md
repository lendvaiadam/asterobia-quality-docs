# Procedural Asteroid Generation Plan (v2) - The "Fragmented Body" Approach

## 1. Core Observation: "It is NOT a Sphere"

The user correctly identified the fundamental flaw in standard "Displaced Sphere" generation. Real asteroids (and the reference images) are **irregular fragments**, **contact binaries**, or **rubble piles**. They have sharp ridges, flat facets, and deep concavities that cannot be represented by simple heightmaps on a sphere.

**The Failure of Heightmaps:**
- Heightmaps (Radius + Noise) push vertices in/out along a normal.
- They cannot create overhangs, caves, or sharp 90-degree cliffs easily.
- The underlying topology always "feels" spherical.

**The Goal:**
Create a **Volume-based** or **Vector-displaced** shape that looks like a broken shard of rock, while maintaining a walkable surface for the rover.

## 2. Proposed "True Asteroid" Pipeline

### A. Phase 1: The "Block" (Base Shape)
Instead of starting with a sphere and adding noise, we start with a sphere and **cut it down**.

**Technique: Voronoi Slicing / Planar Deformation**
1.  **Base Mesh**: High-resolution Icosahedron (uniform triangles).
2.  **Slicing (The "Gem Cut" Effect)**:
    - Generate random planes cutting through the mesh volume.
    - If a vertex is "outside" the plane, flatten it onto the plane or smooth it towards the center.
    - This creates flat facets and sharp edges (like a d20 die or a raw gemstone).
3.  **Non-Uniform Scaling**:
    - Warp the mesh along arbitrary axes (e.g., stretch X by 1.5, squash Y by 0.8) to creating an oblong "potato" shape.
4.  **Result**: A jagged, irregular convex hull that defines the primary mass.

### B. Phase 2: The "Bombardment" (Macro-Detail)
The "craters" in the reference are chaotic and overlapping.

**Technique: Volumetric Crater Carving**
1.  **Iterative Deformation**:
    - Pick a random point on surface.
    - Push vertices *away* from center (radially) based on a crater profile curve.
    - **Crucial**: This is a direct vertex modification (x += dx, y += dy, z += dz), NOT a heightmap offset. This physically indents the mesh geometry.
2.  **Overlapping**:
    - Run this 50-200 times.
    - Large impacts first (basin formation).
    - Small impacts later (surface noise).
3.  **Ejecta/Rims**:
    - The displaced vertices pile up at the crater rim, creating sharp ridges.

### C. Phase 3: The "Surface" (Micro-Detail & Material)
Visual fidelity comes from the **Material Shader**, not just geometry.

**Technique: Tri-Planar Material & Regolith Flow**
1.  **Tri-Planar Mapping (Texture)**:
    - Eliminates UV stretching on the distorted mesh.
    - Projects `Rock_Albedo`, `Rock_Normal`, `Rock_Roughness` from 3 axes.
2.  **Regolith (Dust) Simulation**:
    - Calculate **Concavity/Curvature** per pixel (or vertex).
    - **Logic**: Deep/flat/concave areas = Accumulate Dust (Smooth, Darker).
    - **Logic**: Sharp/steep/convex areas = Exposed Rock (Rough, Lighter).
    - This creates the visual of "dust ponds" in crater bottoms automatically.
3.  **Detail Normals**:
    - An ultra-high frequency normal map adds the "grain" look when the camera is close (Rover view).

## 3. Technology Strategy (Web & Performance)

**Constraint**: Multiplayer, Browser-based, High FPS.

**Solution: "Compute-Once, Render-Instanced"**
*   **Generation Time**: We can afford 100-500ms at generation time (loading screen or async worker) to build the complex geometry on CPU.
*   **Physics**:
    *   **Rover**: Needs accurate collision. We use the *generated visual mesh* as the physics collider (MeshCollider).
    *   *Optimization*: If the mesh is too dense (e.g., 50k verts), we generate a lower-res version (5k verts) for physics using the same seed but lower subdivision.
*   **LOD (Level of Detail)**:
    *   **Close**: Full resolution mesh.
    *   **Far**: Low-poly version or Imposter.
    *   Since we are *on* the asteroid, we prioritize the local area.

## 4. Implementation Sandbox: "Asteroid Lab"

I propose creating a specialized "Asteroid Lab" scene/class to iterate on this generator without loading the full game loop.

**Class: `ProceduralAsteroid`**
- **Inputs**: `Seed`, `Radius`, `Irregularity`, `CraterDensity`.
- **Method**: `generateMesh()` returns a `THREE.Mesh`.
- **Debug**: Toggle wireframe, normals, curvature map to verify the "shard" look.

## 5. Comparison: Old vs. New

| Feature | Old (`Planet.js`) | New (`ProceduralAsteroid`) |
| :--- | :--- | :--- |
| **Shape** | Spherical Blob (Heightmap) | Faceted/Irregular (Vector Displacement) |
| **Features** | Smooth Noise Bumps | Sharp Craters & Ridges |
| **Material** | Stretched UV Texture | Tri-Planar + Curvature Masking |
| **Feel** | "Lumpy Planet" | "Broken Rock Shard" |
| **Physics** | Sphere + Height Lookup | Mesh Collider (Arbitrary Shape) |

This approach directly addresses the user's critique: **It stops treating the object as a modified sphere and starts treating it as a sculpted rock.**
