# ADR-003: Physics Tooling & Protocol Decisions

**Status:** DECIDED
**Date:** 2026-02-13
**Context:** Phase 3 Physics Integration (Rapier) needs runtime tooling for HU-TEST.

## 1. Protocol: Use `CMD_ADMIN` (Single Message Type)
**Decision:** Do **NOT** creates new top-level `MSG` types for multiple debug actions.  Use one `CMD_ADMIN` message.
**Rationale:** Debug commands are rare and shouldn't pollute the main optimized switch.
**Implementation:**
- Add `MSG.CMD_ADMIN` to `MessageTypes.js`.
- Payload: `{ type: 'CMD_ADMIN', action: 'PHYSICS_TOGGLE', enable: boolean }`.
- Payload: `{ type: 'CMD_ADMIN', action: 'SPAWN_OBSTACLE', objectType: 'ROCK', pos: ... }`.
- Server `GameServer.js` handles `CMD_ADMIN` in a separate method (privileged/dev-only).

## 2. Runtime Toggle: Async Init via "Pause"
**Decision:** Allow blocking init (1-2 ticks) inside `CMD_ADMIN`.
**Rationale:** This is a DEV/TEST feature. A small hiccup while WASM loads is acceptable.
**Flow:**
1.  Receive `CMD_ADMIN` (Physics=True).
2.  If `!this.physics`, `await PhysicsWorld.create()`.
3.  SimLoop might skip a beat (acceptable).
4.  Set `this._enablePhysics = true`.
5.  Broadcast `PHYSICS_STATE` (optional) or just log.

## 3. The "Smoothing Merge" (7b1aacf)
**Verdict:** **PHANTOM COMMIT**.
**Fact:** `git show 7b1aacf` returns `fatal: bad object`.
**Action:** The features claimed in that commit (Smoothing) are MISSING. You must Re-Implement them if they are needed. Do not try to merge a ghost.

## 4. Visual Feedback: CSS Overlay (Priority)
**Decision:** Use **Option B (CSS Overlay)** for Phase 3.
**Rationale:**
- Cheaper to implement (no Three.js sprite logic).
- Non-intrusive.
- Sufficient for "Is Physics On?" verification.
**Future:** Phase 4 can add 3D debug gizmos.

## Summary Checklist for Claude
*   [ ] Add `MSG.CMD_ADMIN`.
*   [ ] Implement `GameServer.handleAdminCommand()`.
*   [ ] Wire `DebugPanel` checks to send `CMD_ADMIN`.
*   [ ] Re-implement "Smoothing" logic (since 7b1aacf is lost).
*   [ ] Use CSS Panel for "Physics: ON/OFF" status.
