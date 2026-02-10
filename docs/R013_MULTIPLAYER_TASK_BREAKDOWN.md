# R013 Detailed Task Breakdown & Technical Decisions

**Basis**: `docs/prompts/ANTIGRAVITY_BRIEFING_2026-02-09.md`
**Author**: Antigravity

This document details the tasks required to complete Milestone R013, addressing the questions raised in the briefing and providing technical specifications for the defined goals.

---

## 1. Technical Decisions (Answers to Briefing)

### Q1: Fog of War - Global vs Per-User Texture?
**Decision: Per-User Textures (Multi-Texture approach).**
*   **Reasoning**: Using 4 distinct textures (e.g., `uFowTexture_0`, `uFowTexture_1`, ...) is simpler to implement in the shader than packing bits into a single texture's channels.
*   **VRAM**: 4 x 2048x2048 (R8 format) is ~16MB total. This is negligible for modern PC/Mobile.
*   **Implementation**: `FogOfWar` class will manage an array of `WebGLRenderTarget`s, indexed by slot.

### Q2: Strict Gap Policy - Stall vs Lenient?
**Decision: STALL with "Reconnecting..." UI.**
*   **Reasoning**: In an RTS with deterministic lockstep, *any* missing command causes immediate desync. We cannot "guess" what the missing command was.
*   **UX**: When a gap is detected, show a modal overlay: *"Waiting for Server... (Gap #105)"*. If it resolves quickly (<500ms), the user barely notices. If it takes long, they know why the game stopped.

### Q3: C1 Bug (Relative Waypoints) - Test or Fix?
**Decision: Test First.**
*   **Logic**: Since Slice 2 enables command execution on both ends, identical logic *should* produce identical waypoints. Fixing it blindly might introduce regressions.

### Q4: Owner Tinting (C2) - Glow vs Badge?
**Decision: Selection Ring Color + Floating Badge.**
*   **Reasoning**: Tinting the entire 3D model looks "arcade-like" and ruins the PBR aesthetics.
*   **Solution**:
    *   **Ring**: The selection ring on the ground acts as the primary color indicator (Blue=Self, Red=Enemy).
    *   **Badge**: A small UI billboard above the unit shows the player name/color.

### Q5: 50 User Scaling?
**Decision: Out of Scope for R013.**
*   The current architecture (N-to-N broadcast of all commands) scales to ~8-12 players.
*   For 50 players, we would need **Interest Management** (only send updates for units you can see).
*   **R013 Goal**: Perfect stability for 2-4 players.

---

## 2. Detailed Task List (Prioritized)

### Priority A: Network Hardening (Slice 2 Critical)

#### A1. Strict Gap Policy Implementation
*   **File**: `src/SimCore/multiplayer/SessionManager.js`
*   **Logic**:
    1.  Track `nextExpectedSeq`.
    2.  On `_handleCmdBatch(msg)`:
        *   If `msg.seq > nextExpectedSeq`: **STALL**. Buffer `msg`. Send `RESEND_REQ { from: nextExpectedSeq }`.
        *   If `msg.seq < nextExpectedSeq`: **DROP** (Stale).
        *   If `msg.seq == nextExpectedSeq`: **PROCESS** and increment. Check buffer for next.
*   **UI**: Trigger `Game.paused = true` (network-reason) and show overlay.

#### A2. Active StateHash Comparison
*   **File**: `src/SimCore/multiplayer/SessionManager.js`
*   **Logic**:
    *   Host includes `stateHash` in `CMD_BATCH`.
    *   Guest compares calculated hash after executing that batch.
    *   Mismatch -> `console.error("DESYNC DETECTED")` -> Send `DESYNC_REPORT` to host (optional) -> Show "Desync Error" to user.

### Priority B: Features

#### B1. Per-User Fog of War
*   **File**: `src/World/FogOfWar.js`
*   **Changes**:
    *   Change `rt` (RenderTarget) to `rts[]` (Array of RenderTargets).
    *   In `update()`, iterate through all units. Draw unit vision *only* to the RT corresponding to `unit.ownerSlot`.
*   **Shader**:
    *   Inject `uniform sampler2D uFowTexture[4];`
    *   Read from `uFowTexture[mySlot]`.

#### B2. Movement Interpolation
*   **File**: `src/Entities/Unit.js`
*   **Logic**:
    *   Separate `simPosition` (logic, discrete) from `renderPosition` (visual, smooth).
    *   On Tick: Update `simPosition`.
    *   On Frame: `renderPosition.lerp(simPosition, alpha)`.

### Priority C: Bug Fixes (Briefing List)

| ID | Task | Component | Notes |
|----|------|-----------|-------|
| **Fix-A1** | Add UI for `startDiscovery()` | `SessionManager` / `NetworkDebugPanel` | Add button "Find Match" to JoinOverlay. |
| **Fix-A3** | Supabase Join Timeout | `SupabaseTransport` | Increase timeout, improve error handling. |
| **Fix-C1** | Verify Relative Waypoints | `Unit.js` | Test script to spawn unit at variable coords and order move. |
| **Fix-C2** | Visual Distinction | `Unit.js` | implementation of Color Ring logic. |
| **Fix-D3** | FOW Pathfinding | `PathPlanner.js` | Treat `UNKNOWN` tiles as walkable but risky? Or strictly block? -> *Decision: Walkable.* |
| **Fix-G1** | Dust Leak | `Unit.js` | Ensure `particleSystem.dispose()` is called on unit death. |

---

## 3. Work Packages (assignment suggestion)

**Package 1: The Networking Core (You/Backend)**
*   Implement Strict Gap Policy.
*   Implement StateHash Comparison.
*   Fix Join Timeout (A3).

**Package 2: The Visuals (Graphics/Shader)**
*   Refactor FogOfWar for multi-user.
*   Implement Unit Ring Coloring (C2).
*   Fix Dust Leak (G1).

**Package 3: Gameplay Logic (Gameplay)**
*   Pathfinding updates (D3).
*   Interpolation (B2).
*   UI buttons (A1).

---

## 4. Immediate Next Step
Execute **Package 1 (Networking Core)** to enable safe toggling of `ENABLE_COMMAND_EXECUTION`.
