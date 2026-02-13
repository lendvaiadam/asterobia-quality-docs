# TERRAIN DEFORMATION SPECIFICATION
**Phase 3 Requirement: Mutable Surface**

**Status:** ACTIVE
**Date:** 2026-02-13
**Version:** 1.0

## 1. Core Concept
The planet surface is no longer static. Players (and potentially game events) can modify the terrain height at runtime.
*   **Mechanism:** Grayscale Heightmap Painting.
*   **Operation:** Additive/Subtractive modifications to a scalar height field.
*   **Visuals:** Darker = Lower, Lighter = Higher.

## 2. Data Model
*   **Structure:** A 2D scalar grid (or equivalent spherical mapping) representing `heightOffset` from the base procedural noise.
*   **Base:** The existing `ServerTerrain` noise functions define the "Zero" baseline.
*   **Mutation:** `FinalHeight = BaseNoiseHeight + DeformationOffset`.

## 3. Authority & Determinism
**The Renderer is NEVER Authoritative.**
*   **Client:** Sends `TERRAIN_EDIT` command (Intent).
*   **Server:**
    1.  Validates command (Range, Rate, Cooldown).
    2.  Applies deformation to Authoritative Heightmap.
    3.  Increments `TerrainVersion`.
    4.  Broadcasts `TERRAIN_UPDATE` (or Delta) to all clients.
*   **Determinism:** All clients applying the same sequence of updates must result in the exact same heightmap.

## 4. Edit Command Schema
Deformation is applied via "Brush" strokes to ensure smoothness. Direct pixel setting is forbidden (to prevent spikes/tearing).

```javascript
// Command: TERRAIN_EDIT
{
  type: "TERRAIN_EDIT",
  op: "RAISE" | "LOWER" | "FLATTEN",
  center: { x, y, z }, // World space center on surface
  radius: 15.0,        // Effect radius in world units
  strength: 5.0,       // Max height change at center
  falloff: "SMOOTH",   // Radial falloff curve (e.g., Cosine/Gaussian)
  sign: 1              // Positive (raise) or Negative (lower)
}
```

**Constraints:**
*   **Smoothness:** Hard edges are banned. Changes must blend.
*   **Clamping:** `MinHeight` and `MaxHeight` caps relative to sea level.
*   **Rate Limit:** Max N edits per second per player.

## 5. Architectural Implications

### A. Physics (Rapier)
*   **Static to Dynamic:** The terrain collider is `Static`, but it changes.
*   **Patching:** We CANNOT mesh the whole planet every frame.
    *   *Solution:* Divide world into Chunks (e.g., 32x32m).
    *   When a chunk is modified, **Destroy** its old Collider and **Create** a new one (Trimesh/Heightfield) in the next physics tick.
    *   *Note:* This is expensive. Rate limiting is crucial.

### B. Pathfinding (NavMesh/Grid)
*   **Invalidation:** Changing terrain invalidates cached paths.
*   **Versioning:**
    *   Server maintains `TerrainRevision` ID.
    *   Pathfinder checks: `if (Path.terrainRevision !== CurrentRevision) Recalculate()`.
    *   *Optimization:* Only invalidate paths crossing the modified chunk.

### C. Networking
*   **Snapshots:** Full heightmap is too big for 20Hz snapshots.
*   **Deltas:** Send `TERRAIN_UPDATE` events (reliable) for small changes.
*   **Sync:** New clients download full Heightmap (compressed) on Join.

## 6. Implementation Stages
1.  **Phase 3 (Now):** Define the Spec (This Doc).
2.  **Phase 4:** Implement Heightmap data structure & visual shader.
3.  **Phase 4:** Implement Physics Patching (Rapier).
