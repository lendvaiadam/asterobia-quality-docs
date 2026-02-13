# CLAUDE HANDOFF: PHASE 2B (Path-Follow & Hybrid Physics)

**Context:** Phase 2A is complete (Manifest-Lite, Server Authority, Mirror Mode).
**Mandate:** We are now executing the **HYBRID PHYSICS MASTER PLAN**.

**Core Document (THE BIBLE):**
`docs/specs/HYBRID_PHYSICS_MASTER.md`
*(Read this immediately. It defines the architecture for Phase 2B and Phase 3.)*

## Objective: Phase 2B (Path-Follow Authority)
The goal is to enable strategic unit movement (click-to-move) while maintaining strict server authority.

### Key Rules (from Spec):
1.  **Pathfinding is Client-Side:** The expensive A* runs on the client.
2.  **Path Following is Server-Side:** The client sends `PATH_DATA` (waypoints). The server *validates* and *executes* the movement (using `HeadlessUnit.js` math).
3.  **Hybrid State:**
    - **GROUNDED (Kinematic):** Server moves unit via math (RadiusAt/NormalAt). This is 90% of gameplay.
    - **DYNAMIC (Rapier):** (Phase 3 Prep) Reserved for collisions/explosions.

## Instructions for Claude:
1.  **Read `docs/specs/HYBRID_PHYSICS_MASTER.md`**.
2.  **Verify Phase 2A state:** Check `GameServer.js` and `HeadlessUnit.js` to see the current "Manifest-Lite" implementation.
3.  **Implement `PATH_DATA` handling on Server:**
    - Receive waypoints.
    - Validate (sanity check).
    - Store in `HeadlessUnit`.
    - Tick: Move towards next waypoint (Kinematic).
4.  **Do NOT implement Rapier yet.** Phase 2B is about *movement logic*, not physics engine integration.

**Command:** "Read the Master Spec and start Phase 2B implementation."

---

## CLAUDE IMPLEMENTATION NOTES (2026-02-13)
<!-- These are open decisions to resolve when starting Phase 2B. -->

### Decision 1: Naming — `SET_PATH` vs `PATH_DATA`
**DECISION: (B) Rename to `PATH_DATA`.**
The Master Spec mandates `PATH_DATA`. We must deprecate `SET_PATH` and implement `PATH_DATA`.

### Decision 2: Waypoint Validation — what is "valid"?
**DECISION: (c) Sanity check only (MVP).**
- MaxWaypoints: **32**.
- MaxSegmentLength: **200m**.
- **NO Raycast** in Phase 2B (deferred to Phase 3).


### Decision 3: Spherical path-follow — tangent-plane vs great-circle arc
Current `HeadlessUnit.updatePosition()` uses tangent-plane approximation (displace + reproject).
- **(A) Stay tangent-plane** — simple, client A* produces many close waypoints anyway.
- **(B) Slerp between waypoints** — accurate great-circle arcs, different movement model.
**Leaning:** (A). Small steps + reproject is good enough.

### Decision 4: Path storage on HeadlessUnit
- Single active path per unit (`waypoints[]` + `waypointIndex`), matching client `Unit.js` pattern.
- New `SET_PATH` / `PATH_DATA` overwrites any existing path.
- `closed: boolean` flag in the message replaces a separate `CLOSE_PATH` command on server.

### Decision 5: `CLOSE_PATH` on server
Client has `CLOSE_PATH` (loop closure). Options:
- **(A)** Client sends full point list + `closed: boolean` flag. No separate `CLOSE_PATH` message.
- **(B)** Mirror the client pattern: separate `CLOSE_PATH` command.
**Leaning:** (A). Simpler protocol.

### Pre-existing State (what's already built):
- `HeadlessUnit.mode` = `GROUNDED` / `AIRBORNE` (state machine ready)
- `HeadlessUnit.toSnapshot()` includes `qx,qy,qz,qw,mode,altitude`
- `ServerTerrain.getRadiusAt()` / `getNormalAt()` work on server
- Security hardening done: manifest cap, JOIN_ACK gate, rate limit, maxPayload
- Path drawing blocked in mirror mode with dev-mode warning (`Game.js:3052`)
