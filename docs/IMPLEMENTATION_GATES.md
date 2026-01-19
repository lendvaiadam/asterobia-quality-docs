# IMPLEMENTATION_GATES — Astrobia (Canonical Quality Gates)

**Purpose:** This file defines hard quality gates that every PR must satisfy when touching:
- Movement / pathing / physics
- Fog of War / Vision / Perception
- Command queue / time & determinism
- Core runtime state and serialization boundaries

**Source of truth:** This gate file is strictly derived from canonical refactor process documents (2026-01-13).

---

## 1) Core Invariants (Non-Negotiable)

### 1.1 Determinism & Stability
**Rule:** Identical inputs must yield identical outputs within a single tick for all authoritative logic.

**Concrete Requirements:**
- Fixed-tick simulation: core simulation outcomes must not depend on render FPS
- Deterministic ordering: any list processing that affects outcomes must use stable sort keys with explicit tie-breakers
- No hidden randomness: any randomness must be seeded and recorded; default is no randomness
- Reproducible replays: given same initial state and command stream, results must match

**Verification Evidence Required:**
- Deterministic replay check: record input sequence, replay twice, compare final state checksums
- Logs showing stable ordering (e.g., unit ID tie-breaker when distance difference < 0.001)
- Performance counters showing no frame-dependent variance in sim outcomes

### 1.2 Lane Scheduling & Ownership

**Lane Assignment Rules:**
- **LOCOMOTION lane:** Rolling/swim/fly/climb/tunnel (mutually exclusive per tick per unit)
- **TOOL lane:** Terrain shaping, mining actions
- **WEAPON lane:** Shooting actions
- **PERCEPTION lane:** Subsurface scan (active perception)
- **No lane (Passive):** Optical vision runs continuously without queue participation

**Within-Lane Exclusivity:** Mutually exclusive actions cannot execute simultaneously in the same lane.

**Cross-Lane Concurrency:** Actions in different lanes may overlap unless explicit incompatibility declared.

**Canonical Lane Assignments:**

| Feature | Lane | Type |
|---------|------|------|
| MOVE_ROLL | LOCOMOTION | Action |
| UNIT_CARRIER | LOCOMOTION | Action |
| WPN_SHOOT | WEAPON | Action |
| TERRAIN_SHAPING | TOOL | Action |
| MATERA_MINING | TOOL | Action |
| PERCEPTION_OPTICAL_VISION | None | Passive |
| PERCEPTION_SUBSURFACE_SCAN | PERCEPTION | Action |

**Verification Evidence Required:**
- Command queue logs showing mutually exclusive LOCOMOTION actions never overlap
- Test case: attempt simultaneous roll+swim, verify only one executes per tick
- Logs confirming passive features run every tick without queue participation

### 1.3 Perception Ownership

**Strict Rules:**
- Local player units reveal fog-of-war exclusively to that player
- Allies only reveal if explicitly enabled
- Enemies cannot expose the local player's vision layer
- Team filtering precedes all maxSources caps and ordering

**Anti-Pattern (Prohibited):**
- Enemy/neutral units contributing to the player's FogOfWar reveal

**Verification Evidence Required:**
- Team filtering logs showing enemy units excluded before rendering
- Screenshot: enemy unit visible but not revealing fog-of-war around it
- Test case: spawn enemy unit, verify no fog reveal in player's vision layer

### 1.4 Seam Wrapping Behavior

**Rule:** Existing ±180° wrapping behavior preserved as-is; no seam artifacts in vision/FOW.

**Deterministic Duplication:** If sources must be duplicated across seams, duplication rules must be stable and predictable.

**Wrapping Risk Threshold:** Setting `config.maxSources` above 128 poses overflow risk, as seam wrapping can double effective count toward 256 hard ceiling.

**Verification Evidence Required:**
- Visual test: unit moving across ±180° seam shows no visibility flicker or gaps
- Counter logs: verify wrapped sources do not exceed hard ceiling (256)
- Screenshot: no banding/popping artifacts at seam under camera movement

### 1.5 maxSources Cap & Buffer Limits

**Soft Cap (Gameplay Configuration):**
- Config Key: `config.maxSources` (Default: **64**)
- Enforcement: select closest units first via distance-to-camera sort
- Applied before seam wrapping

**Hard Ceiling (GPU Buffer):**
- Config Key: `maxBufferSize` (Hardcoded: **256**)
- Fixed allocation prevents buffer overflow
- Prevents "popping" (missing wrapped instances)

**Deterministic Ordering Requirements:**
- Primary sort: distance to camera (`distToCamera`)
- Tie-breaker: unit ID comparison when distance difference < 0.001
- Must be stable across browser environments (no `Array.sort()` variance)

**Verification Evidence Required:**
- Logs showing closest N units selected deterministically
- Repeatability test: restart app, verify same sources chosen given identical setup
- Counter: active source count never exceeds soft cap (pre-wrap) or hard ceiling (post-wrap)
- Tie-breaker logs: units at identical distance always sorted by unit ID

### 1.6 Command Queue Timeline Integrity

**Rules:**
- Per-unit play/pause affects only that unit's queue
- Elastic clip extension: clip endpoints never cross "Now" prematurely
- Loop toggles and repeat markers required for Demo 1.0
- Timeline authoring is map-first; waypoints are reordered/adjusted, not added arbitrarily

**Verification Evidence Required:**
- Test case: pause one unit, verify others continue executing commands
- Timeline replay: verify commands execute at correct tick index, not "whenever frame updates"
- Idempotence check: same command does not execute twice for same time slice

### 1.7 Current Update Throttle

**Rule:** Current update throttle (30Hz example) remains unless formally revised.

**Verification Evidence Required:**
- Performance counter: confirm updates run at configured rate (e.g., 30Hz)
- No "stale fog" artifacts beyond acceptable limits

---

## 2) Feature vs. World Service Ownership

**Feature Module Responsibility:**
- FeatureId, passive/action designation
- Intent/contribution computation hooks
- Serialization contracts for persistent state
- Data structures (VisionSource, action structs)

**World Service Responsibility (Non-Delegable):**
- FogOfWar render target ownership and stamping
- VisionSystem aggregation orchestration
- GPU resource lifecycle and shader integration

**Anti-Pattern (Prohibited):**
- Features owning rendering infrastructure
- Feature logic embedded in engine contract documentation

**Verification Evidence Required:**
- Architecture diagram: feature provides data, world service owns rendering
- Code review: no `new THREE.WebGLRenderTarget()` calls inside feature modules

---

## 3) Terrain Constraint Thresholds (MOVE_ROLL Canonical)

| Slope Range | Status | Rule |
|---|---|---|
| 0–10° | Stable | Full speed and grip applied |
| 10–40° | Penalty | Speed multiplied by `cos(slope)` monotonically |
| 40–60° | Critical | Torque vs. gravity determines stall/slide behavior |
| >60° | Blocked | Hard rejection; emits `BLOCKED_BY_SLOPE` event |

**Verification Evidence Required:**
- Acceptance test #4: validate critical band (40–60°) behavior with varying torque levels
- Event emission logs: `BLOCKED_BY_SLOPE` fired when slope >60°
- Screenshot: unit stalled/sliding on 40–60° slope with low torque

---

## 4) State Machine Ordering (MOVE_ROLL Canonical)

**Canonical Transition Sequence:**
```
STOPPED → ROLLING → STALLING → SLIDING → (recovery or BLOCKED)
ROLLING → STOPPING → STOPPED
Any state → BLOCKED (water/rock/slope >60°)
BLOCKED → ROLLING (blocking condition removed AND intent persists)
```

**Verification Evidence Required:**
- Acceptance test #2: water contact → `COLLISION_WATER` → `movementStatus=BLOCKED`
- Acceptance test #3: slope >60° → `BLOCKED_BY_SLOPE` event
- State machine logs showing legal transitions only

---

## 5) Event Emission Requirements (MOVE_ROLL Canonical)

**Required GameEvents:**
- `COLLISION_WATER` or `ENTER_WATER` → triggers `NEED_INVENT_SWIM`
- `BLOCKED_BY_SLOPE` → triggers climbing/flying invention needs
- `BLOCKED_BY_ROCK` / `BLOCKED_BY_GEOMETRY` → collision telemetry
- Optional: `UNIT_STALLED`, `UNIT_SLIDING` for debug metrics

**Event Payload Minimum:** `{ unitId, position, time }`

**Ownership:** GoalManager listens; events must be fired by feature, not by world service.

**Verification Evidence Required:**
- Event logs showing three required event types emitted
- Test case: trigger water collision, verify `NEED_INVENT_SWIM` card generated
- Payload validation: all events contain required fields

---

## 6) Feature Allocation Gates (MOVE_ROLL Canonical)

**Rule:** If `MOVE_ROLL` is included in a Type, allocation must be ≥ **25%** (configurable minimum); 0% allocation means feature is not included.

**Verification Evidence Required:**
- StatsEngine configuration confirming allocation percentage per unit type
- Type designer UI screenshot showing allocation ≥25% for types with MOVE_ROLL

---

## 7) PR Verification Checklist

> Every PR must state which checklist items it satisfies and provide concrete verification evidence.

### 7.1 Movement / MOVE_ROLL Verification
- [ ] **Single-unit sanity:** unit reaches destination reliably on flat terrain
- [ ] **Multiple units:** no divergence or ordering bugs with simultaneous movement
- [ ] **Slope bands:** verify 0–10° (full speed), 10–40° (penalty), 40–60° (critical), >60° (blocked)
- [ ] **Blocking materials:** rock/water respected (if applicable)
- [ ] **Inertia:** acceleration/deceleration stable and not FPS-dependent
- [ ] **Waypoint integrity:** post-path-edit, unit proceeds toward `ApproachWaypointID` only; no regression

### 7.2 Fog of War Seam Wrap Verification
- [ ] **Cross-seam movement:** no visibility flicker when unit crosses ±180° seam
- [ ] **Source duplication correctness:** no double-count artifacts or gaps
- [ ] **No artifacts:** no banding/popping at seam under camera movement
- [ ] **Throttle/perf:** verify stamping throttle does not cause stale fog beyond limits

### 7.3 maxSources Truncation Determinism Verification
- [ ] **Team filtering:** only relevant team sources contribute (enemies excluded)
- [ ] **Stable ordering:** same sources kept every run when exceeding max
- [ ] **Repeatability:** restarting app yields same chosen sources given same setup
- [ ] **Tie-breaker:** distance-tied units always sorted by unit ID
- [ ] **Logging:** counter logs prove ordering/cap behavior (remove before merge if noisy)

### 7.4 Performance Counters
- [ ] Active sources count logged
- [ ] Stamps per tick / per second logged
- [ ] Time spent in perception update logged
- [ ] No O(N²) growth under expected unit counts

### 7.5 Event System Verification (if touched)
- [ ] Events are deterministic and ordered
- [ ] No render-frame events mutate sim state outside fixed-tick update
- [ ] No "double fire" across frames

### 7.6 Training & Stats Verification (if touched)
- [ ] Stats application is deterministic
- [ ] Type/Blueprint changes do not corrupt existing units unless explicitly intended
- [ ] Serialization of type/stats is stable

---

## 8) Acceptance Criteria (MOVE_ROLL Canonical Must-Pass Tests)

1. **Flat Movement:** Unit reaches `maxSpeed` smoothly on 0–10° terrain
2. **Water Blocking:** Water contact emits `COLLISION_WATER`; unit sets `movementStatus=BLOCKED`
3. **Slope Blocking:** Slope >60° emits `BLOCKED_BY_SLOPE` event and blocks movement
4. **Critical Uphill:** Low-torque units stall/slide on 40–60° grades; high-torque units climb (slowly)
5. **Waypoint Integrity:** Post-path-edit, unit proceeds toward `ApproachWaypointID` only; no backward regression
6. **Training Visibility:** Increased training raises grip/torque, reducing slides and improving climb performance

**Verification Evidence Required:**
- Test run logs or video for each of six criteria
- Pass/fail status per test

---

## 9) Anti-Patterns (Hard NOs)

### 9.1 Architecture Anti-Patterns (Prohibited)
- Editing `Unit.js` monolith to "just make it work" without extracting into agreed lanes
- Mixing render and sim authority (render deciding physics, sim depending on camera state)
- Feature logic embedded in engine contract documentation
- Named unit classes canonized (e.g., sniper/tank); use allocations/configs instead

### 9.2 Perception Anti-Patterns (Prohibited)
- FogOfWar renderer computing visibility decisions
- Vision logic split between multiple places without single authoritative pipeline
- Enemy units revealing local player's fog-of-war

### 9.3 World Service Anti-Patterns (Prohibited)
- Mutable world state implemented ad-hoc (random arrays, non-deterministic edits) without deterministic update model
- Terrain shaping implemented by direct mesh edits in render lane

### 9.4 Serialization Anti-Patterns (Prohibited)
- Saving only partial authoritative state
- Storing transient render-only values as authoritative state

### 9.5 Ordering Anti-Patterns (Prohibited)
- Non-deterministic source tie-breaking
- Sorting without explicit tie-breaker (unit ID) for equidistant units

### 9.6 Backwards-Compat Anti-Patterns (Prohibited)
- Breaking legacy IDs/feature references without alias/migration path
- Changing public APIs without minimal shims or clear deprecation

---

## 10) Ownership & Component Responsibilities (MOVE_ROLL Canonical)

| Component | Owner | Responsibility |
|---|---|---|
| StatsEngine | Central System | Compute `effectiveStats` per feature (maxSpeed, accel, brake, turnRate, torque, grip, maxSlopeDeg) |
| PathFollower | Command Queue | Produce `desiredDirectionTangent` and speed cap from curvature awareness |
| `MOVE_ROLL` module | Movement Feature | Consume intent; simulate rolling physics; emit status and events |
| TerrainQuery | SimCore / Engine | Provide height, normal, slope calculations; support raycasts |
| GoalManager | Central System | Listen for blocked/stall events; generate Need Cards |
| VisionSystem | World Service | Aggregation orchestration, maxSources enforcement, GPU buffer management |
| FogOfWar | World Service | Render target ownership, stamping, shader integration |

---

## 11) Quick Reference — "What Goes Where"

- **SimCore/runtime:** Fixed-tick, authoritative state, command execution, deterministic perception
- **Entities/Unit.js:** Legacy; changes here must be minimized and scheduled for extraction
- **World/:** Read-only queries unless explicitly upgraded to deterministic world service
- **UI/:** Reads state + schedules commands only; never mutates sim state directly
- **Rendering (Three.js):** Mirrors sim state; no authority

---

## 12) Gate Workflow (How We Use This)

1. PR description states which gates apply
2. PR includes "Verification Evidence" section with concrete checks performed (logs, counters, screenshots, test results)
3. If a gate is violated, PR must be revised before merge
4. Post-merge violations trigger immediate revert and regression documentation

---

## 13) Emergency Procedures

If a gate is violated post-merge:
1. Revert the PR immediately
2. Add regression note to `docs/quality/KNOWN_RISK_AREAS.md`
3. Re-implement with explicit determinism checks, stable ordering, and tie-breakers
4. Add new acceptance test to prevent recurrence

---

## 14) Traceability Map

**Purpose:** Links each gate rule to its canonical source document.

### Core Invariants (Section 1)
- **1.1 Determinism:** "Identical inputs must yield identical outputs within a single tick for all authoritative logic." — Source: ASTROBIA_CANONICAL_REFACTOR_PROCESS_2026-01-13.md § Core Invariants
- **1.2 Lane Scheduling:** "Action features use command queue lanes: LOCOMOTION, TOOL, WEAPON, or PERCEPTION." — Source: ASTROBIA_CANONICAL_REFACTOR_PROCESS_2026-01-13.md § Scheduling Rules + Lane Assignment Reference Table
- **1.3 Perception Ownership:** "Local player units reveal fog-of-war exclusively to that player; allies only if explicitly enabled." — Source: ASTROBIA_CANONICAL_REFACTOR_PROCESS_2026-01-13.md § Perception Ownership
- **1.4 Seam Wrapping:** "Existing ±180° wrapping behavior preserved as-is." — Source: ASTROBIA_CANONICAL_REFACTOR_PROCESS_2026-01-13.md § Seam Wrapping & Throttling
- **1.5 maxSources Cap:** "Config Key: `config.maxSources` (Default: 64)" + "Hardcoded: 256" — Source: ASTROBIA_CANONICAL_VISION_MAX_SOURCES_POLICY_2026-01-13.md § Source Limits & Caps
- **1.5 Deterministic Ordering:** "Apply unit ID comparison when distance difference is negligible (< 0.001 threshold suggested)" — Source: ASTROBIA_CANONICAL_VISION_MAX_SOURCES_POLICY_2026-01-13.md § Deterministic Ordering Requirements
- **1.6 Command Queue:** "Per-unit play/pause affects only that unit's queue." + "Elastic clip extension: clip endpoints never cross 'Now' prematurely." — Source: ASTROBIA_CANONICAL_REFACTOR_PROCESS_2026-01-13.md § Command Queue Integrity
- **1.7 Throttle:** "Current update throttle (30Hz example) remains unless formally revised." — Source: ASTROBIA_CANONICAL_REFACTOR_PROCESS_2026-01-13.md § Seam Wrapping & Throttling

### Feature vs. World Service (Section 2)
- **Feature Responsibility:** "Features provide data structures (VisionSource, action structs) to world services; they do not own rendering infrastructure." — Source: ASTROBIA_CANONICAL_REFACTOR_PROCESS_2026-01-13.md § Feature vs. World Service Ownership
- **World Service Responsibility:** "FogOfWar render target ownership and stamping" + "VisionSystem aggregation orchestration" — Source: ASTROBIA_CANONICAL_REFACTOR_PROCESS_2026-01-13.md § World Service Responsibility (Non-Delegable)

### Terrain Thresholds (Section 3)
- **Slope Bands:** "0–10° Stable", "10–40° Penalty", "40–60° Critical", ">60° Blocked" — Source: ASTROBIA_CANONICAL_FEATURE_MOVE_ROLL_2026-01-13.md § Terrain Constraint Thresholds (Canonical)

### State Machine (Section 4)
- **Transition Sequence:** "STOPPED → ROLLING → STALLING → SLIDING → (recovery or BLOCKED)" — Source: ASTROBIA_CANONICAL_FEATURE_MOVE_ROLL_2026-01-13.md § State Machine Ordering

### Event Emission (Section 5)
- **Required Events:** "`COLLISION_WATER`, `BLOCKED_BY_SLOPE`, `BLOCKED_BY_ROCK`" — Source: ASTROBIA_CANONICAL_FEATURE_MOVE_ROLL_2026-01-13.md § Event Emission Checkpoints

### Allocation Gates (Section 6)
- **25% Minimum:** "allocation must be ≥ 25% (configurable minimum)" — Source: ASTROBIA_CANONICAL_FEATURE_MOVE_ROLL_2026-01-13.md § Feature Inclusion Gates

### Acceptance Tests (Section 8)
- **Six Must-Pass Tests:** "Flat Movement", "Water Blocking", "Slope Blocking", "Critical Uphill", "Waypoint Integrity", "Training Visibility" — Source: ASTROBIA_CANONICAL_FEATURE_MOVE_ROLL_2026-01-13.md § Must-Pass Tests

### Anti-Patterns (Section 9)
- **9.1–9.6:** Compiled from prohibited patterns across all three source documents — Sources: ASTROBIA_CANONICAL_REFACTOR_PROCESS_2026-01-13.md § Anti-Patterns Prohibited + ASTROBIA_CANONICAL_VISION_MAX_SOURCES_POLICY_2026-01-13.md § Ownership & Team Filtering

### Component Ownership (Section 10)
- **Ownership Table:** StatsEngine, PathFollower, MOVE_ROLL module, TerrainQuery, GoalManager responsibilities — Source: ASTROBIA_CANONICAL_FEATURE_MOVE_ROLL_2026-01-13.md § Ownership Assignments & Responsibilities

---

**End of IMPLEMENTATION_GATES.md**
