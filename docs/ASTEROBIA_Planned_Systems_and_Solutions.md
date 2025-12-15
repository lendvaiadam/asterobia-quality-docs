
# ASTEROBIA – Planned Systems & Detailed Solution Design

## Notice About This Document
This document is a **design and planning reference**, not a progress report.

At the time of writing, it is **not fully known which of the following systems were completed, partially implemented, postponed, or abandoned**. The purpose of this file is to:
- preserve **design intent**,
- document **target-quality solutions**,
- and provide a **shared mental model** for future development.

Always verify the current codebase before assuming implementation status.

---

## 1. Pathfinding & Movement Systems

### 1.1 Runtime Unit–Rock Collision & Sliding

**Goal**
Prevent units from visually or physically passing through rock meshes during movement, even when navigation paths are valid.

**Problem**
Navmesh/path planning can avoid obstacles globally, but local smoothing, spline following, and steering can still cause mesh penetration.

**Planned Solution**
- Lightweight runtime collision layer (non-physics):
  - Broadphase: bounding sphere / distance checks against nearby rocks.
  - Narrowphase: selective raycast or closest-point distance.
- Collision response:
  - Project movement onto tangent plane of the spherical surface.
  - Apply tangential sliding instead of hard stopping.

**Why This Works**
- Maintains smooth movement feel.
- Avoids expensive physics engines.
- Deterministic and scalable for many units.

---

### 1.2 Stuck Detection & Repath Policy

**Goal**
Units recover autonomously when blocked by terrain, geometry, or other units.

**Detection Criteria**
- Low path progress over time.
- Velocity below threshold.
- Duration exceeding configurable window (e.g. 1–1.5 seconds).

**Recovery Strategy**
- Phase 1: short escape steering.
- Phase 2: limited replan (mini A* from current position to next anchor).
- Cooldown prevents repeated replanning.

**Benefits**
- Avoids infinite A* loops.
- Removes need for manual player correction.
- Keeps CPU usage predictable.

---

### 1.3 Unit–Unit Avoidance (Multiplayer)

**Goal**
Allow dense clusters of units (5–10+) to move naturally without overlapping or jitter.

**Approach**
- Local neighbor queries using spherical spatial hashing.
- Separation forces applied in tangent space.
- Priority bias (units closer to destination yield less).
- Soft collision tolerance (visual separation without rigid blocking).

**Why**
- Avoids global replanning.
- Visually believable group motion.
- Scales well in multiplayer scenarios.

---

### 1.4 Controlled A* Pathfinding Usage

**Goal**
High-quality navigation without excessive computation.

**Design**
- Macro path: A* over spherical node graph (great-circle heuristic).
- Micro path: smoothed waypoints via Catmull–Rom splines.
- A* triggers:
  - new destination,
  - stuck recovery only.
- Short-lived path cache for repeated queries.

**Outcome**
- Optimal routes when needed.
- Minimal runtime cost.

---

### 1.5 Path Rejoin Logic

**Goal**
Smoothly reattach units to paths after deviations.

**Rules**
- Detect off-path state.
- Rejoin to a future anchor (never snap backward).
- Options:
  - spline projection,
  - mini A* fallback.

**Result**
- No rubber-banding.
- Natural correction behavior.

---

### 1.6 Pathfinding Debug & Metrics

**Purpose**
Enable informed quality decisions.

**Metrics**
- A* time (ms).
- Repath count.
- Stuck count.
- Avoidance force magnitude.
- Reroute cause tracking.

---

## 2. Visual Systems

### 2.1 Hybrid Dust System (A + C)

**Goal**
Cinematic dust near camera, cheap rendering at scale.

**System**
- Near: instanced sprite-based puff particles (texture-driven).
- Far: ground-aligned dust decals.
- Distance-based LOD switching.
- Pooling and instancing.

**Why**
- Texture-based effects outperform procedural math.
- Handles 100–300 units smoothly.
- Scalable visual fidelity.

---

### 2.2 Headlights & Darkness-Based Lighting

**Goal**
Units visually respond to darkness without performance collapse.

**Logic**
- Darkness signal from sun direction + surface normal.
- Hysteresis to avoid flicker.

**Rendering**
- Near camera: limited SpotLights (few shadow-casters).
- Far: emissive meshes + bloom + ground light decals.

**Result**
- High perceived realism.
- Strict performance bounds.

---

## 3. Planet Surface Texturing

### 3.1 Pole-Free Texturing

**Problem**
UV-mapped spheres suffer from polar distortion.

**Preferred Solution**
- Tri-planar shader projection:
  - X/Y/Z projection blended by surface normal.
  - No UV seams.
  - Compatible with procedural terrain.

**Alternatives**
- Cube projection (acceptable seams).
- UV masking (temporary workaround).

**Why Tri-Planar**
- Clean at any latitude.
- Works with underground/radar overlays.

---

## 4. Design Principles Recap

- Prefer **texture-driven illusions** over computation-heavy realism.
- Use **hybrid LOD systems** for scalability.
- Separate **macro planning** from **micro movement**.
- Always expose **debug metrics** before optimizing.

---

## 5. Final Note
This file captures the **intended quality bar and architectural direction**.
Actual implementation status must always be confirmed against the live repository.
