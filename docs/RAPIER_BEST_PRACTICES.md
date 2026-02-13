# Rapier.js Best Practices — Asterobia Server Integration

> Phase 3 PREP reference. Summarizes integration guidelines for
> `@dimforge/rapier3d-compat@0.19.3` on our Node.js headless server.

## 1. Package & Initialization

```javascript
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();  // must await before any API use
```

- **`rapier3d-compat`** (not `rapier3d`): WASM is base64-inlined, works in
  Node.js ESM without bundler or `.wasm` file handling.
- `RAPIER.init()` is async (decodes WASM). Call once at server startup,
  before creating any World.
- Store the module reference globally — do NOT re-init per room.

## 2. Server Authority Model

The server is the **single source of truth** for physics state.

- Server creates `RAPIER.World`, steps it at fixed rate, broadcasts snapshots.
- Clients are dumb mirrors — they render interpolated positions, never run
  their own physics world.
- This matches our existing Phase 2A/2B architecture (HeadlessUnit → SNAPSHOT).

## 3. Fixed Timestep (Critical)

```javascript
world.timestep = 1 / 60;  // 60Hz physics
// In server tick (20Hz), sub-step 3x:
for (let i = 0; i < 3; i++) world.step();
```

- **Never** use variable dt with Rapier — breaks determinism.
- Our server ticks at 20Hz. Use 3 sub-steps at 60Hz (3 × 16.67ms = 50ms)
  for stability without overhead.
- Alternative: 2 sub-steps at 40Hz if CPU-constrained.

## 4. Spherical Gravity

Rapier's global gravity is linear (constant direction). Asterobia needs
radial gravity toward planet center (0,0,0).

```javascript
const world = new RAPIER.World({ x: 0, y: 0, z: 0 }); // zero global gravity

// Per body, per step:
function applySphericalGravity(body, G) {
    const pos = body.translation();
    const len = Math.sqrt(pos.x * pos.x + pos.y * pos.y + pos.z * pos.z);
    if (len < 0.001) return;
    const mass = body.mass();
    body.addForce({
        x: (-pos.x / len) * G * mass,
        y: (-pos.y / len) * G * mass,
        z: (-pos.z / len) * G * mass
    }, true);
}
```

- Set `gravityScale(0)` on each body to suppress any residual global gravity.
- Apply radial force **before** `world.step()` each sub-step.
- Verified in smoke test: body falls toward center, no X/Z drift.

## 5. Hybrid State Machine (GROUNDED ↔ DYNAMIC)

Per HYBRID_PHYSICS_MASTER.md, units spend ~90% of time in GROUNDED (kinematic
math) and switch to DYNAMIC (Rapier) only on events.

```javascript
// GROUNDED → DYNAMIC (on collision/explosion/fall)
body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);

// DYNAMIC → GROUNDED (on stabilization)
body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
```

- Rapier supports runtime body type switching (verified in smoke test).
- When switching to Kinematic: body stops responding to forces immediately.
- When switching to Dynamic: set initial velocity to prevent visual pop.
- **Recovery condition**: speed < threshold AND surface contact for N ticks.

## 6. Collision Events

```javascript
const eventQueue = new RAPIER.EventQueue(true);

// Enable on colliders that need events:
RAPIER.ColliderDesc.ball(0.5)
    .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);

// After world.step():
world.step(eventQueue);
eventQueue.drainCollisionEvents((handle1, handle2, started) => {
    if (started) { /* collision began */ }
    else { /* collision ended */ }
});
```

- Only enable `COLLISION_EVENTS` on colliders that need them (perf).
- `drainCollisionEvents` fires for both start and end.
- Use collider handles to look up parent rigid body via
  `world.getCollider(handle).parent()`.
- **Free** the EventQueue when the room is destroyed.

## 7. Determinism Caveats

Rapier is deterministic **on the same platform** (same WASM binary, same
CPU, same execution order):

- ✅ Same Node.js version on same server → bitwise identical (verified).
- ⚠️ Different platforms (x86 vs ARM, different WASM runtimes) → may differ
  due to floating-point rounding.
- **Our guarantee**: Server is authoritative, so cross-platform determinism
  is NOT required. Only the server runs physics; clients mirror.
- If we ever need client-side prediction with physics, we'd need rollback +
  reconciliation (Phase 4+ concern).

## 8. Memory Management

Rapier uses WASM heap memory. Objects must be explicitly freed:

```javascript
// Always free in reverse creation order:
eventQueue.free();
world.free();  // frees all bodies + colliders in the world
```

- `world.free()` releases all child bodies and colliders.
- Call `world.free()` when a Room is destroyed (player disconnect, game end).
- **Never** let worlds accumulate — each room gets exactly one world.
- Snapshot via `world.takeSnapshot()` returns a `Uint8Array` — useful for
  debugging or save/restore, but NOT needed for normal gameplay snapshots
  (we use our own lean format).

## 9. Collider Guidelines

| Shape | Use Case | Notes |
|-------|----------|-------|
| `ball(r)` | Units | Fast, rotation-invariant |
| `capsule(half_h, r)` | Tall units | Better than cylinder |
| `cuboid(hx, hy, hz)` | Terrain chunks, buildings | Static only preferred |
| `trimesh(verts, indices)` | Terrain patches | Static bodies ONLY |
| `convexHull(points)` | Complex units | Max ~64 verts for perf |

- **Never** use `trimesh` on dynamic bodies — Rapier doesn't support
  dynamic-dynamic trimesh collisions (silent no-op).
- Keep collider count per room under ~500 for 20Hz+ perf.
- Use `ColliderDesc.sensor()` for trigger zones (no physical response).

## 10. Performance Budget

Target: 3 sub-steps × N bodies completes within 25ms (half of 50ms tick).

| Bodies | Expected Step Time | Notes |
|--------|-------------------|-------|
| 10 | < 0.5ms | Trivial |
| 100 | ~2ms | Comfortable |
| 500 | ~8ms | Monitor |
| 1000+ | 15ms+ | May need LOD physics |

- Profile with `console.time('physics')` around the step loop.
- If over budget: reduce sub-steps to 2, simplify colliders, or
  sleep distant bodies via `body.sleep()`.

## References

- [Rapier docs](https://rapier.rs/docs/)
- `docs/specs/HYBRID_PHYSICS_MASTER.md` — Hybrid state machine design
- `tests/integration/physics/rapier-smoke.test.js` — Verified capabilities
- `docs/specs/NETCODE_ARCHITECTURE_FPS.md` — Server authority architecture
