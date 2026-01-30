# Current System Spec (Reality)

## 1. Scope & Rule of Precedence
This document represents the **current implementations state** of the `asterobia` repository.
**Precedence Rule:** If this document conflicts with Canonical Specs, **Canonical Specs win**. This document describes *what is*, while specs describe *what must be*.

## 1.1 Determinism Invariant (Binding)
*   **Effective:** Post-Release 001 (Fixed Timestep).
*   **Rule:** The Simulation Loop MUST be purely deterministic.
*   **Forbidden:** `Date.now()`, `Math.random()`, `dt` variance in logic.

## 1.2 Rule Discovery Protocol (Binding)
*   **Protocol:** Rule Discovery → Documentation (`docs/NOTES_*.md`) → Notification.
*   **Mandatory:** Rules must never live only in chat.
*   **Operator:** Antigravity is the preferred agent for rule documentation.
*   **Scope:** Applies to all future work packages.

## 1.3 Implementation Checklist (Binding)
*   **Mandatory:** After EVERY implementation step (commit/PR), the implementer MUST output an "**Ádám Test Checklist**".
*   **Trigger:** Any change to behavior (logic, features, fixes).
*   **Format:**
    *   3–10 concrete steps.
    *   "Expected Result" for each step.
    *   "Risk Focus": 1-line summary of what might have broken.




## 2. Runtime Architecture Snapshot
*   **Game Loop:** Hybrid.
    *   **SimLoop:** Fixed 50ms (20Hz) authoritative tick (`SimLoop.acc`).
    *   **RenderLoop:** `requestAnimationFrame` (interpolated visuals).
    *   *Evidence:* `src/SimCore/runtime/SimLoop.js` (R001 Merged).
*   **SimCore Boundary:** `SimCore` initialization wired into `Game.js`.

*   **SimCore Boundary:** `SimCore` exists as a skeleton (`runtime/Store.js`), but major logic (physics, movement) remains in `Unit.js`.
    *   *Evidence:* `quality/REPO_REALITY_MAP.md` (SimCore structure exists but partial)

## 3. Authority & Determinism Status
*   **Time Model:** **Fixed Timestep (50ms)**.
    *   `dt` is strictly controlled by `SimLoop` accumulator.
    *   *Evidence:* `src/SimCore/runtime/SimLoop.js` (R001 Merged).
*   **Randomness:** **Seeded PRNG (Mulberry32)**.
    *   `SimCore.rng` provides deterministic randoms. `Math.random` removed from logic.
    *   *Evidence:* `src/SimCore/runtime/SeededRNG.js` (R004 Merged).
*   **IDs:** **Deterministic Sequential**.
    *   `IdGenerator` replaces `Date.now()`/UUIDs.
    *   *Evidence:* `src/SimCore/runtime/IdGenerator.js` (R003 Merged).

## 4. Command Pipeline Status
*   **Mechanism:** **Strict Command Queue**.
    *   UI/Input -> `InputFactory` -> `CommandQueue` -> `SimCore`.
    *   Direct state mutation via Input is ABOLISHED.
    *   *Evidence:* `src/Core/Input.js` (delegates to Factory), `src/SimCore/commands/Command.js` (R002/R006 Merged).
*   **Overlay:** Command History overlay (`Shift+C`) confirms stream.

## 5. State Surface Map
*   **Authoritative State:** **Defined & Serializeable**.
    *   `serializeState()` captures Sim-only data (ticks, unit props, queue).
    *   Render state (meshes) excluded from serialization.
    *   *Evidence:* `src/SimCore/runtime/StateSurface.js` (R005 Merged).

## 6. Vision/FOW Status
*   **Pipeline:** Shader-based visual effect. State persistence is unclear/partial.
    *   *Reference:* `ASTROBIA_CANONICAL_FEATURE_PERCEPTION_OPTICAL_VISION_2026-01-13.md` (Target) vs Current Reality (Shader-heavy).

## 7. Terrain Status
*   **Implementation:** Heightmap-based, mutable via `TerrainMod`.
    *   *Evidence:* `quality/STATE_SURFACE_MAP.md` Section 1.3 (Terrain Mods list).

## 8. Multiplayer/Backend Readiness Status
*   **Status:** **NOT READY**.
*   **Verdict:** Requires `ITransport` injection, fixed timestep, and state separation.
    *   *Evidence:* `quality/NETCODE_READINESS_AUDIT.md` Verdict.

## 9. Known Deviations from Canonical
1.  **Loop:** Variable `dt` vs Canonical Fixed Timestep [NETCODE_AUDIT].
2.  **IDs:** `Date.now()` vs Canonical Deterministic IDs [NETCODE_AUDIT].
3.  **Input:** Direct mutation vs Canonical Command Queue [NETCODE_AUDIT].
4.  **Unit State:** Hybrid Render/Logic object vs Canonical Entity/View separation [STATE_MAP].
5.  **SimCore:** Skeleton only vs Canonical Logic Kernel [REPO_MAP].

## 10. Update Rules (Binding)
*   Update this file after **every Release PR merge** to reflect the new reality.
*   Antigravity is the owner of this file.
