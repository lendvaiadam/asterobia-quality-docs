# SKILL: Render Interpolation

**ID**: `skill-render-interpolation`
**Role**: Frontend / Visuals
**Status**: ACTIVE

---

## 1. Purpose
Provide visual smoothing between authoritative simulation ticks to ensure fluid (60fps+) rendering despite lower simulation tick rates (e.g., 20Hz).

## 2. Scope
- Linear interpolation (lerp) of position/rotation.
- Client-side prediction visualization (ghosts).
- Lag compensation visuals.

## 3. Hard Constraints (MUST NOT)
- **NO State Mutation**: Must NOT modify the authoritative `SimCore` state. Visuals are derivative.
- **NO Logic Change**: Must NOT alter tick rate or simulation logic to fit frame rate.
- **NO Network Prediction**: Must NOT implement network rollback/resimulation logic here (that is Backend/Architecture).

## 4. Triggers (When to Use)
- Smoothing unit movement.
- Implementing smooth camera following.
- Multiplayer visual polish (hiding network jitter).

## 5. Checklist
- [ ] Interpolation handles 0-1 alpha factor correctly.
- [ ] "Teleport" threshold exists (don't lerp across map wraps or respawns).
- [ ] Visual object is separated from logic object (SimState vs RenderState).

## 6. Usage Examples

### A. Basic Position Lerp
```javascript
// On Render Frame
const alpha = accumulator / TICK_RATE;
visualMesh.position.lerpVectors(prevPos, nextPos, alpha);
```

## 7. Out of Scope
- Shader effects (Use `skill-shader-effects`).
- Logic state updates (Use SimCore).
