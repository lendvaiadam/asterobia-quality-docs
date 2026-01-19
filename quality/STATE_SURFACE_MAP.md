# State Surface Map

**Objective:** Define what data must be synchronized/serialized for multiplayer.

## 1. Authoritative State (Must Serialize)
These fields define the "True Game Reality". If this data is lost, the game state is corrupt.

### Global
*   **Tick Counter:** `sim.tick` (Integer)
*   **Random Seed:** `sim.seed` (Initial + Current state)
*   **Next Entity ID:** `sim.nextId` (Integer)

### Entities (Units)
*   **Identity:** `id`, `ownerId`, `typeId`
*   **Physics:**
    *   `position` (Vector3 - quantized?)
    *   `velocity` (Vector3)
    *   `targetPosition` (Vector3/null)
*   **Logic:**
    *   `commandQueue` (Array of Command Objects)
    *   `currentCommandIndex` (Integer)
    *   `hp`, `energy`, `cargo` (Gameplay stats)
*   **Modes:**
    *   `stance` (Passive/Aggressive)
    *   `isHoldingFire` (Boolean)

### World (Terrain/Matera)
*   **Rocks:** List of ID + Position + Health (if destructible).
*   **Matera Deposits:** ID + Amount remaining.
*   **Terrain Mods:** List of Applied Delta-Maps (since terrain is heightmap based).

## 2. Render State (Do NOT Serialize)
Visual-only data derived from Authoritative State. Syncing this is waste.

*   `mesh.rotation` (Derived from velocity/target, unless physics-based rotation is gameplay relevant)
*   `animationState` / `mixer` time
*   `particles`
*   `audio` state
*   `selectionRing` visibility
*   `fogOfWar` texture (Derived from unit positions)
*   `hoverState`, `highlightMaterial`

## 3. Serialization Strategy
*   **Snapshot:** Full JSON dump of Category 1.
*   **Delta:** List of changed fields (Optimization for later).
*   **Input-Stream:** Replaying inputs from Tick 0 (Deterministic Lockstep).

## 4. Critical Refactor Targets
| File | Field | Action |
| :--- | :--- | :--- |
| `Unit.js` | `this.waypoints` | **EXTRACT**. Move to `SimCore` state store. |
| `Unit.js` | `this.speedFactor` | **STANDARDIZE**. Use integer logic or fixed-point if possible. |
| `Game.js` | `this.units[]` | **EXTRACT**. Move to `EntityRegistry`. |
