# APPENDIX G: RISK REGISTER (v3)

**Parent Document:** [Big Picture Master Plan v3](../BIG_PICTURE_MASTER_PLAN_v1_ANTIGRAVITY.md)
**Scope:** Specific trigger conditions for project risks and pre-planned code mitigations.

---

## 1. Technical Risks

### R01: "The Spiral of Death" (Sim Lag)
*   **Scenario:** Sim takes 60ms to process a 50ms tick.
*   **Result:** Accumulator grows infinite. Game hangs.
*   **Trigger:** `accumulator > 250ms` (5 frames behind).
*   **Code Mitigation:**
    ```javascript
    // In SimLoop.js
    if (this.accumulator > 250) {
        console.warn("Spiral of Death detected. Resetting accumulator.");
        this.accumulator = 0; // Hard Skip (Teleport)
        this.events.emit('LAG_SPIKE');
    }
    ```

### R02: Floating Point Drift
*   **Scenario:** Apple Silicon vs Intel calculation differs by `0.0000001`.
*   **Result:** Client A sees Unit at `x=10`, Client B sees `x=10.00001`. Collision check behaves differently.
*   **Trigger:** Hash Mismatch Event.
*   **Code Mitigation:**
    *   Use `Math.fround()` for critical state positions.
    *   Or migrate `SimCore` to **WASM** (Rust) where math is strictly typed.

---

## 2. Production Risks

### R03: Feature Scope Creep
*   **Scenario:** "Let's add Flying Units now!"
*   **Impact:** Destroys Phase 1 timeline.
*   **Mitigation:** **Strict G-R-F pipeline.**
    *   If it's not in the Pipeline spec (Appendix C), it is REJECTED.
    *   Flying is explicitly Phase 2.

### R04: Asset Generation Failure
*   **Scenario:** Generative AI (Nano Banana/Trellis) API goes down or costs too much.
*   **Mitigation:**
    *   Fallback to "Placeholder Primitives" (Cubes/Spheres).
    *   The `UnitDesigner` must support `usePlaceholders: true` config.

---

## 3. Multiplayer Risks

### R05: Host Disconnect
*   **Scenario:** Host closes tab.
*   **Result:** Game ends for everyone.
*   **Mitigation (Phase 1):**
    *   Show "Host Left" message.
    *   Auto-Download `Replica.json` (Last Snapshot) so players can inspect/save the game.

### R06: NAT Traversal Failure
*   **Scenario:** Corporate Firewall blocks P2P.
*   **Result:** Connection Timeout.
*   **Mitigation:**
    *   Display "Connection Failed. Try using Mobile Hotspot or VPN".
    *   (Phase 2) Rent TURN server.

---
*End of Appendix*
