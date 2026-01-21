# APPENDIX 04: RISKS, QA & OBSERVABILITY

**Parent Document:** [Big Picture Master Plan](../BIG_PICTURE_MASTER_PLAN_v1_ANTIGRAVITY.md)
**Scope:** Risk Management, Test Protocol, and Debugging Tools.

---

## 1. Risk Register

### Risk 01: JavaScript Performance Ceiling
*   **Description:** JS is single-threaded. If `SimCore` logic takes >10ms per 50ms tick, the browser freezes ("Spiral of Death").
*   **Probability:** Medium (with 20+ units and complex pathfinding).
*   **Mitigation:**
    1.  **Web Workers:** Move `SimCore` to a Worker thread early (Release 006+).
    2.  **Time Budgeting:** Abort low-priority tasks (e.g., pathfinding) if tick time > 5ms.
    3.  **WASM:** Rewrite heavy math (physics) in Rust/WASM (Long term).

### Risk 02: Determinism Drift ("The Butterfly Effect")
*   **Description:** One tiny float difference (0.0000001) causes Unit A to go left instead of right. 10 seconds later, the game state is totally different.
*   **Probability:** High (WebRTC + Different Browsers).
*   **Mitigation:**
    1.  **Sync Hash:** Host sends `StateHash` every 60 ticks. Clients compare.
    2.  **Desync Detection:** If Hash mismatch -> Pause Game -> Request Full Snapshot from Host (Resync).
    3.  **Avoid Floats:** Use integers for critical Logic Checks (e.g. `if (dist < 100)` -> `if (distSq < 10000)`).

### Risk 03: Feature Scope Creep
*   **Description:** "Features" document gets bigger faster than implementation.
*   **Probability:** High.
*   **Mitigation:** **Strict G-R-F-Tr-D-P-U Pipeline implementation**. Do not implement features ad-hoc. Only implement what the Pipeline supports.

---

## 2. QA & Test Strategy

### 2.1 Automated Unit Tests (Jest)
We focus testing on the **SimCore** (Pure Logic).
*   **Goal:** 90% coverage of `SimCore/modules`.
*   **Critical Tests:**
    *   `SerializationTest`: Save -> Load -> Save. Output must be identical.
    *   `DeterminismTest`: Run Sim for 1000 ticks with Seed A. Reset. Run again. States must match.
    *   `CommandTest`: Queue Move Command -> Unit Position changes correctly.

### 2.2 Manual Verification (The "Smoke Test")
*   **Frequency:** Every PR Merge.
*   **Checklist:** `SMOKE_CHECKLIST.md`
*   **Phase 0 Addition:**
    *   Open 2 Tabs.
    *   Move Unit in Tab 1 (Host).
    *   Verify Unit moves in Tab 2 (Client).

### 2.3 Performance Budget
*   **Sim Tick:** Max 8ms (on avg hardware).
*   **Render Frame:** Max 16ms (60 FPS).
*   **Bandwidth:** Max 50KB/s per client (Phase 2).

---

## 3. Observability & Debugging

### 3.1 The "God Console"
We need a visible Debug Overlay (already partially implemented).
*   **Additions:**
    *   `Tick`: Current Sim Tick.
    *   `Ping`: Latency to Host.
    *   `CmdQueue`: # of pending commands.
    *   `Entities`: Count of active entities.

### 3.2 Visual Debugging
*   **Path Lines:** Draw lines showing where the Pathfinder *thinks* the unit is going.
*   **Server Ghost:** In Client mode, verify where the "Server Position" is vs "Interpolated Position". Draw a Ghost mesh.

---
*End of Appendix 04*
