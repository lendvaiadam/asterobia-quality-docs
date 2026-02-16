# Atmosphere Phase 2 — Aerial Perspective & Tone Mapping

**Status:** PLANNED (not yet implemented)
**Depends on:** Phase 1 sky dome (implemented)

---

## Phase 2A: Aerial Perspective (Post-Process)

A **single full-screen post-process pass** that reads the depth buffer and applies atmospheric scattering to ALL scene objects (terrain, water, rocks, units). This replaces the need to inject shader chunks into every material.

### How it works
1. Render the scene to an offscreen `WebGLRenderTarget` with a `DepthTexture`
2. A full-screen quad reads the color + depth textures
3. For each pixel, reconstruct the world-space position from depth
4. Calculate the atmospheric path from camera to that position
5. Blend the pixel color toward the atmosphere's scatter color based on path length
6. Output the composited result

### Why this approach
- **Zero per-material changes** — one pass covers everything
- **Independent of unit count** — 1 unit or 500, same cost
- **Additive cost:** ~0.5ms at 1080p on integrated GPU (single full-screen quad)

### Key uniforms (reuse from Phase 1)
- `uSunDirection`, `uPlanetRadius`, `uAtmosphereRadius`
- `uRayleighCoeff`, `uMieCoeff`, `uScaleHeightR/M`
- `uDepthTexture`, `uColorTexture` (from render target)
- `uInverseProjection`, `uInverseView` (for depth → world reconstruction)

---

## Phase 2B: HDR Tone Mapping

A **minimal post-process pipeline** (no heavy EffectComposer) for:
- **ACES or Reinhard tone mapping** — sunset oranges pop, no clipping
- **Dithering** — 8-bit output banding prevention
- **Exposure control** — auto-exposure based on average luminance (optional)

### Performance budget
- Target: < 0.3ms overhead at 1080p
- Single additional full-screen pass (can be combined with aerial perspective)

### Adaptive integration
- `AdaptivePerformance` preset: `toneMapping: [false, false, true, true]`
- MIN/LOW: bypass tone mapping (direct sRGB output)
- MED/HIGH: enable tone mapping pass

---

## Phase 2C: Atmosphere Polish

- **Cloud layer** — procedural noise on a sphere at `planetRadius + 5`, animated
- **Night-side glow** — faint blue limb glow from scattered starlight
- **Atmosphere color presets** — Mars (red/thin), alien (green), Earth (blue)
- **Day/night cycle** — rotating sun position (if gameplay requires)

---

## Implementation order
1. Phase 2A (aerial perspective) — biggest visual impact
2. Phase 2B (tone mapping) — polish
3. Phase 2C (extras) — when gameplay demands it
