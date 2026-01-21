# APPENDIX 02: FEATURE IMPLEMENTATION CHAIN

**Parent Document:** [Big Picture Master Plan](../BIG_PICTURE_MASTER_PLAN_v1_ANTIGRAVITY.md)
**Scope:** The G-R-F-Tr-D-P-U Pipeline and the 7 Canonical Features.

---

## 1. The G-R-F-Tr-D-P-U Engine
*From: `ASTROBIA_CANONICAL_GRFDTRDPU_SYSTEM`*

This is the meta-game loop. It must be implemented as distinct Modules in `SimCore`.

1.  **G (Goals/Needs):** A background system evaluating "Player Pain".
    *   *Code:* `SimCore/modules/GoalEvaluator.js`
    *   *Logic:* If `EnemyRange > MyRange`, emit `NEED_RANGE`.
2.  **R (Research):** The response to Needs.
    *   *Code:* `SimCore/modules/ResearchLab.js`
    *   *Action:* Unlocks `WPN_SHOOT v2` or `Range Multiplier +10%`.
3.  **F (Feature):** The detailed ability behavior (see Section 2).
4.  **Tr (Training):** Global stat multipliers.
    *   *Code:* `SimCore/modules/TrainingCenter.js`
    *   *Effect:* Players spend XP to boost global `Accuracy` or `Speed`.
5.  **D (Design):** The Blueprint System.
    *   *Code:* `SimCore/modules/Designer.js`
    *   *Input:* Base Feature Stats + Capacity budget.
    *   *Generative Pipeline (Async):*
        1.  **Prompt Gen:** System generates prompt from stats.
        2.  **Image Gen (Nano Banana):** Generates 4 variations. User selects 1.
        3.  **3D Gen (MS Trellis):** Converts Image -> `.glb` model.
    *   *Output:* `UnitType` (Stats + linked `.glb` asset).
6.  **P (Production):** The Factory.
    *   *Code:* `SimCore/modules/Factory.js`
    *   *Input:* `UnitType` + Resources.
    *   *Output:* `UnitEntity` (Game Object).
7.  **U (Upgrade):** Runtime evolutions.
    *   *Action:* Replacing a distinct Unit's stats with a newer Blueprint version.

---

## 2. Feature Implementation Specs (Phase 1)

### 2.1 Feature 01: `MOVE_ROLL` (Locomotion)
*   **Lane:** LOCOMOTION
*   **Specs:** `ASTROBIA_CANONICAL_FEATURE_MOVE_ROLL`
*   **Behavior:**
    *   Physics-based rolling sphere.
    *   Mass affects acceleration (F=ma).
    *   Consumes Energy per meter.
*   **Implementation Note:** Must handle Slopes! If slope > `maxClimbAngle` (from generic stats), unit slides back.

### 2.2 Feature 02: `WPN_SHOOT` (Combat)
*   **Lane:** WEAPON
*   **Specs:** `ASTROBIA_CANONICAL_FEATURE_WPN_SHOOT`
*   **Behavior:**
    *   Direct line-of-fire check.
    *   Instantiates `Projectile` entity (not instant hitscan, to allow dodging).
    *   **Axes:** Power, Rate, Range, Accuracy.
*   **Input:** `CMD_ATTACK_TARGET(id)` or `CMD_ATTACK_GROUND(x,y)`.

### 2.3 Feature 03: `PERCEPTION_OPTICAL` (Vision)
*   **Lane:** PERCEPTION (Passive)
*   **Specs:** `ASTROBIA_CANONICAL_FEATURE_PERCEPTION_OPTICAL_VISION` & `VISION_MAX_SOURCES_POLICY`
*   **Logic:**
    *   Calculates `VisionRange`.
    *   Reveals `FogOfWar` texture.
    *   **MaxSources:** Limit strictly to N (e.g. 32) brightest/closest sources per player for performance.
*   **Multiplayer:** Strictly filters by `ownerId`. I cannot see your vision.

### 2.4 Feature 04: `PERCEPTION_SCAN` (Subsurface)
*   **Lane:** PERCEPTION (Active pulse)
*   **Specs:** `ASTROBIA_CANONICAL_FEATURE_PERCEPTION_SUBSURFACE_SCAN`
*   **Logic:**
    *   Spherical pulse that reveals `MateraDeposit` data (richness/depth).
    *   Raycasts *through* ground geometry.

### 2.5 Feature 05: `MATERA_MINING` (Harvest)
*   **Lane:** TOOL
*   **Specs:** `ASTROBIA_CANONICAL_FEATURE_MATERA_MINING`
*   **Logic:**
    *   Unit must be adjacent to Deposit.
    *   "Drills" per tick.
    *   Spawns `MateraPile` (Surface Object) near the drilling site. (Does NOT put directly into inventory).

### 2.6 Feature 06: `MATERA_TRANSPORT` (Logistics)
*   **Lane:** TOOL
*   **Specs:** `ASTROBIA_CANONICAL_FEATURE_MATERA_TRANSPORT`
*   **Logic:**
    *   `Pickup`: Takes from `MateraPile`. Fills `Cargo`.
    *   `Drop`: Deposits to Base / Factory.
    *   **Mechanic:** Mass increases -> `MOVE_ROLL` acceleration decreases (Heavy units move slow).

### 2.7 Feature 07: `TERRAIN_SHAPING` (Modification)
*   **Lane:** TOOL
*   **Specs:** `ASTROBIA_CANONICAL_FEATURE_TERRAIN_SHAPING`
*   **Logic:**
    *   Unit "paints" target heightmap.
    *   Terrain mesh updates gradually (Lerp towards target height).
    *   Costs huge Energy.

---

## 3. Interaction Matrix

| Active \ Passive | Move | Shoot | Shape | Mine |
| :--- | :--- | :--- | :--- | :--- |
| **Move** | - | **Allowed** | Pauses | Pauses |
| **Shoot** | **Allowed** | - | Allowed | Allowed |
| **Shape** | Pauses | Allowed | - | Mutually Exclusive |
| **Mine** | Pauses | Allowed | Mutually Exclusive | - |

*   **Move + Shoot:** Classic RTS kiting is supported.
*   **Move + Mine:** Impossible. Must stop to drill.
*   **Mine + Shape:** Impossible. Both use TOOL lane.

---
*End of Appendix 02*
