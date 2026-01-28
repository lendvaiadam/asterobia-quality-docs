# GATE 01: DETERMINISM PREFLIGHT

**Gate ID:** GATE-01
**Status:** PASS
**Baseline:** `master-plan-v2-audited-2026-01-28` (commit `06ada1c`)
**Source:** `docs/IMPLEMENTATION_GATES.md` Section 1.1 (Determinism & Stability)

---

## Purpose

This gate establishes the foundational determinism requirements before any netcode or multiplayer work begins. Determinism is the single most critical invariant for multiplayer: if two instances receive the same inputs, they must produce identical outputs. This preflight verifies the codebase can achieve determinism and identifies blockers that must be fixed in Phase 0.

---

## Entry Criteria

Before starting this gate, confirm:

| Criterion | Check |
|-----------|-------|
| Master Plan v2 audited and tagged | `master-plan-v2-audited-2026-01-28` exists |
| `docs/IMPLEMENTATION_GATES.md` read | Section 1.1 requirements understood |
| Codebase access | Can read `src/` files to audit current state |

---

## Exit Criteria (Testable)

This gate PASSES when ALL of the following are verified:

### E1: Variable Timestep Audit
- [ ] Locate all uses of `clock.getDelta()` or equivalent frame-time in simulation logic
- [ ] Document each occurrence with file:line
- [ ] Classify: BLOCKER (affects sim state) vs SAFE (render-only)
- [ ] Count of BLOCKER occurrences recorded

### E2: Unseeded Randomness Audit
- [ ] Locate all uses of `Math.random()` in simulation logic
- [ ] Document each occurrence with file:line
- [ ] Classify: BLOCKER (affects sim state) vs SAFE (visual-only)
- [ ] Count of BLOCKER occurrences recorded

### E3: Non-Deterministic ID Generation Audit
- [ ] Locate all uses of `Date.now()` for entity IDs or state keys
- [ ] Document each occurrence with file:line
- [ ] Count of occurrences recorded

### E4: Determinism Capability Assessment
- [ ] Assess: Can the codebase support replay? (Yes with fixes / No fundamental blocker)
- [ ] List blocking issues that must be fixed before Release 001

### E5: Remediation Plan
- [ ] For each BLOCKER, document the fix approach:
  - Variable timestep → Fixed timestep accumulator
  - Math.random() → Mulberry32 seeded PRNG
  - Date.now() IDs → Sequential ID generator
- [ ] Estimate: number of files requiring changes

---

## Verification Procedure

### Step 1: Audit Variable Timestep
```bash
# Search for frame-dependent timing in src/
grep -rn "getDelta\|deltaTime\|clock\.delta" src/ --include="*.js"
```
Record results in Evidence section.

### Step 2: Audit Unseeded Randomness
```bash
# Search for Math.random in src/
grep -rn "Math\.random" src/ --include="*.js"
```
Record results in Evidence section.

### Step 3: Audit Non-Deterministic IDs
```bash
# Search for Date.now() usage
grep -rn "Date\.now" src/ --include="*.js"
```
Record results in Evidence section.

### Step 4: Classify Each Finding
For each finding, determine if it affects authoritative simulation state:
- **BLOCKER:** Used in game logic, physics, unit state, command processing
- **SAFE:** Used only in rendering, UI, logging, performance metrics

### Step 5: Document Remediation Path
For each BLOCKER, specify the fix per Master Plan v2:
- Timestep: Implement `SimLoop` with fixed 50ms accumulator (Release 001)
- Random: Implement `Mulberry32` PRNG in SimCore (Release 004)
- IDs: Implement `nextEntityId` counter in state registry (Release 003)

---

## Evidence (Audit Run 2026-01-28)

### E1: Variable Timestep Findings

| File | Line | Code Snippet | Classification |
|------|------|--------------|----------------|
| `src/Core/Game.js` | 2709 | `const dt = this.clock ? this.clock.getDelta() : 1 / 60;` | **BLOCKER** |
| `src/Core/Game.js` | 2772 | `requestAnimationFrame(this.animate)` | **BLOCKER** |
| `src/SimCore/runtime/TimeSource.js` | 22-93 | `_deltaTime` infrastructure (getters/setters) | SAFE |
| `src/UI/DebugPanel.js` | 46, 48 | rAF for stats update | SAFE |

*Backup files (`*_old.js`, `*_restore_0332.js`) excluded from counts.*

**Total BLOCKERS: 2**

---

### E2: Unseeded Random Findings

**BLOCKERS (affect sim state):**

| File | Line | Code Snippet | Classification |
|------|------|--------------|----------------|
| `src/Entities/Unit.js` | 143 | `this.id = Math.floor(Math.random() * 10000)` | **BLOCKER** |
| `src/Entities/Unit.js` | 155 | `Math.random().toString(36)...` (station ID hash) | **BLOCKER** |
| `src/Entities/Unit.js` | 542 | `Math.random() * 2.0` (replanning timer init) | **BLOCKER** |
| `src/Entities/Unit.js` | 546 | `2.0 + Math.random() * 2.0` (replanning interval) | **BLOCKER** |
| `src/Core/Game.js` | 281-282 | `Math.random()` (spawn position retry) | **BLOCKER** |
| `src/Core/Game.js` | 956 | `Math.random().toString(36)` (command ID) | **BLOCKER** |
| `src/SimCore/domain/TypeBlueprint.js` | 21 | `Math.random() * 16` (UUID fallback) | **BLOCKER** |
| `src/SimCore/domain/UnitModel.js` | 94 | `Math.random().toString(36)` (unit model ID) | **BLOCKER** |
| `src/SimCore/runtime/UnitFactory.js` | 69 | `Math.random() * Math.PI * 2` (spawn angle) | **BLOCKER** |

**SAFE (render/visual only):**

| File | Line | Code Snippet | Classification |
|------|------|--------------|----------------|
| `src/Core/Game.js` | 49-50 | star generation theta/phi (constructor) | SAFE |
| `src/Entities/Unit.js` | 1865, 1910, 1938 | particle rotation/noise/shake | SAFE |
| `src/Entities/Unit.js` | 2555-2614 | dust particle visuals | SAFE |
| `src/World/RockMeshGenerator.js` | 166 | mesh LOD selection | SAFE |
| `src/World/Planet.js` | 350-351 | planet feature placement | SAFE |
| `src/UI/NavMeshDebug.js` | 212, 215 | debug random path test | SAFE |

**Total BLOCKERS: 9**

---

### E3: Date.now() / performance.now() Findings

**Date.now() BLOCKERS:**

| File | Line | Code Snippet | Classification |
|------|------|--------------|----------------|
| `src/Core/Game.js` | 956 | `Date.now().toString(36)` (command ID) | **BLOCKER** |
| `src/Core/Game.js` | 969 | `Date.now().toString(36)` (start command ID) | **BLOCKER** |
| `src/SimCore/domain/UnitModel.js` | 93 | `Date.now().toString(36)` (unit ID) | **BLOCKER** |

**Date.now() SAFE:**

| File | Line | Code Snippet | Classification |
|------|------|--------------|----------------|
| `src/Main.js` | 86, 91, 95, 100 | game/music timing UI | SAFE |
| `src/Core/Game.js` | 788 | UI double-click detection | SAFE |
| `src/Core/Game.js` | 1674 | transition path throttle | SAFE |
| `src/SimCore/domain/TypeBlueprint.js` | 55, 131, 145, 193, 194, 203 | metadata timestamps | SAFE |
| `src/SimCore/runtime/Store.js` | 182 | sessionStartTime metadata | SAFE |
| `src/SimCore/runtime/UnitTypeBinder.js` | 79 | boundAt metadata | SAFE |

**performance.now() (all SAFE - metrics/render timing):**

| File | Lines | Usage |
|------|-------|-------|
| `src/Navigation/SphericalNavMesh.js` | 66, 86, 347, 364, 375, 425, 481 | pathfinding metrics |
| `src/Navigation/PathPlanner.js` | 285, 336 | planning metrics |
| `src/Camera/SphericalCameraController4.js` | 496, 1721 | camera animation |
| `src/Entities/Unit.js` | 2062, 2270, 2465, 2509 | animation timing |
| `src/UI/NavMeshDebug.js` | 134, 136, 157, 159 | debug metrics |
| `src/SimCore/runtime/TimeSource.js` | 31, 61, 156, 167 | real-time reference |
| `src/SimCore/runtime/VisionSystem.js` | 83 | update throttle |

**Total BLOCKERS: 3**

---

### E4: Capability Assessment

- **Replay Capable:** **Yes, with fixes**
- **Fundamental Blockers:** None (all issues have known remediation paths)

**Blocking Issues Summary:**
1. Main loop uses `clock.getDelta()` + `requestAnimationFrame` → variable timestep
2. Entity IDs generated with `Math.random()` and `Date.now()` → non-deterministic
3. Command IDs use `Date.now() + Math.random()` → non-deterministic
4. Unit replanning timer uses `Math.random()` → simulation divergence
5. Unit spawn angle/position uses `Math.random()` → initial state divergence

---

### E5: Remediation Summary

| Issue Type | Count | Fix Release | Files Affected |
|------------|-------|-------------|----------------|
| Variable timestep | 2 | 001 | 1 (`Game.js`) |
| Math.random() | 9 | 004 | 5 (`Unit.js`, `Game.js`, `TypeBlueprint.js`, `UnitModel.js`, `UnitFactory.js`) |
| Date.now() IDs | 3 | 003 | 2 (`Game.js`, `UnitModel.js`) |

**Total BLOCKERS: 14**
**Files requiring changes: 5**

**Remediation Approach per Master Plan v2:**
- **Timestep (R001):** Implement `SimLoop` with fixed 50ms accumulator, decouple render from sim
- **Random (R004):** Implement `Mulberry32` seeded PRNG in SimCore, replace all sim-affecting `Math.random()`
- **IDs (R003):** Implement `nextEntityId` sequential counter in state registry

---

## Pass/Fail Criteria

| Outcome | Condition |
|---------|-----------|
| **PASS** | All audits complete, blockers documented, remediation plan exists |
| **FAIL** | Audit incomplete OR fundamental blocker with no remediation path |

---

## Next Gate

Upon PASS, proceed to:
- **Release 001 Implementation** (Fixed Timestep Loop)
- OR **GATE-02** if additional preflight needed

---

## Approvals

| Role | Name | Date | Status |
|------|------|------|--------|
| Auditor | Claude Opus 4.5 | 2026-01-28 | COMPLETE |
| Human Owner | | | PENDING |

---

*End of GATE_01_DETERMINISM_PREFLIGHT.md*
