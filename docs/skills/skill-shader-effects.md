# SKILL: Shader Effects

**ID**: `skill-shader-effects`
**Role**: Frontend / Graphics
**Status**: ACTIVE

---

## 1. Purpose
Create custom visual effects using GLSL shaders, post-processing filters, and custom materials to enhance game aesthetics.

## 2. Scope
- `ShaderMaterial` and `RawShaderMaterial` authoring.
- Post-processing effects (Bloom, Fog, Color Grading).
- Particle system shaders.
- Procedural textures.

## 3. Hard Constraints (MUST NOT)
- **NO Determinism Impact**: Effects MUST be purely visual. They cannot affect gameplay outcomes.
- **NO Core Mod**: Do not modify Three.js internals. Use injection points `onBeforeCompile`.
- **NO Logic Compute**: Do not use GPGPU/Compute shaders for game logic (SimCore is CPU-only).

## 4. Triggers (When to Use)
- Adding shield impacts, explosions, lasers.
- Procedural planet/asteroid surfaces.
- Global atmosphere or fog effects.

## 5. Checklist
- [ ] Shader compiles without errors.
- [ ] Performance: complexity is scalable (can be disabled/lowered).
- [ ] Uniforms are updated efficiently.
- [ ] Handles context loss (rare but possible).

## 6. Usage Examples

### A. Simple Glow Shader
```glsl
void main() {
  float intensity = pow(0.7 - dot(vNormal, vViewPosition), 4.0);
  gl_FragColor = vec4(1.0, 0.5, 0.0, 1.0) * intensity;
}
```

## 7. Out of Scope
- Game Logic.
- CPU Mesh generation (Use `skill-threejs`).
