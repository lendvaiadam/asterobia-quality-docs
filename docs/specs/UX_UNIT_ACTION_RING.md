# UX SPEC: UNIT ACTION RING
**Feature:** Radial Action Selector (Future Binding)
**Status:** PLANNED (Backlog)
**Version:** 1.0

## 1. Concept: The "Arc Menu"
Currently, selected units show a simple "Selection Ring" on the ground and a status circle above.
**New Requirement:** The overhead circle evolves into an interactive **Radial/Arc Action Selector**.

*   **Trigger:** Hover/Click on the unit's overhead status circle.
*   **Visual:** An arc of icons expands around the unit (or overhead).
*   **Interaction:** User clicks an icon to enter a specific **Action Mode**.

## 2. Action Modes
Selecting an icon changes the mouse cursor and input semantics (Left-Click behavior).

| Mode | Icon | Cursor | Left-Click Behavior |
|---|---|---|---|
| **Move (Default)** | Arrow | Pointer | Emits `PATH_DATA` (Green Line). Standard movement. |
| **Terraform** | Shovel/Mountain | Brush Circle | Emits `TERRAIN_EDIT` (Intent). "Paints" heightmap changes. |
| **Fire** | Crosshair | Reticle | Emits `FIRE_AT_TARGET` (Entity/Point). Unit attacks target. |
| **Bombard** | Explosion | Area Circle | Emits `CALL_AIRSTRIKE` (Area). Marks zone for external support. |
| **Build** | Wrench/Hammer | Ghost | Opens Build Sub-menu (if applicable). |

## 3. Interaction Flow
1.  **Select Unit:** Left-click unit. Ground ring appears. Overhead circle appears.
2.  **Open Menu:** Hover/Click overhead circle. Arc menu expands.
3.  **Select Mode:** Click "Terraform" icon.
4.  **Preview:** Cursor becomes a "Brush" matching server constraints (Radius/Falloff).
5.  **Execute:** Left-click drag on terrain.
    *   **Client:** Renders *preview* of deformation (ghost mesh).
    *   **Network:** Sends `TERRAIN_EDIT` command stream to Server.
    *   **Server:** Validates & Applies.
    *   **Response:** Server sends `TERRAIN_UPDATE`. Client terrain snaps to truth.

## 4. Authority Constraints
**The Renderer is NEVER Authoritative.**
*   **UI Role:** Visualization & Intent Collection.
*   **Validation:** The Client UI must clamp inputs to "plausible" values (e.g., max brush size), but the Server performs the final check.
*   **Outcome:** The UI does *not* apply the effect locally (except for ephemeral prediction/ghosting). The actual state change comes from the Server.

## 5. Visual Hierarchy
1.  **Selection Ring (Ground):** "I am selected."
2.  **Status Circle (Overhead):** "I am healthy/active."
3.  **Action Ring (Overhead Arc):** "What can I do?" (Only visible when interacting/active).

## 6. Implementation Note (Future)
*   **Phase:** Post-Phase 3.
*   **Dependencies:** `TERRAIN_DEFORMATION.md` (for Terraform mode), `HeadlessUnit` (for Fire/Bombard logic).
