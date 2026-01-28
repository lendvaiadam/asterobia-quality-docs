# QUESTIONS FOR ADAM: Final v2 Plan Clarifications

**Date:** 2026-01-24
**Purpose:** All clarifying questions needed before writing MASTER_PLAN_FINAL_v2.md

---

## Format

Each question includes:
- **Decision it unlocks**
- **Section affected**
- **Blocker level:** BLOCKER (cannot write section without answer) or NON-BLOCKER (can proceed with default)

---

## Questions

### Q1: Replay System Scope
**Question:** Should Demo 1.0 include a replay system (command-log replay for debugging/review)?

**Options:**
- A) Defer to post-Demo 1.0 (no replay in initial release)
- B) Include basic command-log replay (store commands, replay deterministically)

**Decision Unlocks:** Whether to add ~1 release to Phase 1 for replay infrastructure.
**Section Affected:** Release Plan (Phase 1), Testing Strategy
**Blocker Level:** NON-BLOCKER (default: A - defer)

---

### Q2: UI Framework Choice
**Question:** Which UI approach should the plan specify for the Command Queue Timeline and other UI elements?

**Options:**
- A) HTML/CSS overlays with vanilla JS (current approach, simplest)
- B) React integration (modern component model, more setup)
- C) Defer framework choice to implementation time (plan specifies behavior, not tech)

**Decision Unlocks:** Whether plan should mandate UI technology or remain technology-agnostic.
**Section Affected:** Architecture section, all UI-related releases
**Blocker Level:** NON-BLOCKER (default: C - defer to implementation)

---

### Q3: PR Granularity
**Question:** Should the plan use Claude-style granular PRs (001.1, 001.2, etc.) or single-PR-per-release?

**Options:**
- A) Granular PRs (Claude style: multiple small PRs per release, more review checkpoints)
- B) Single PR per release (less overhead, faster merges)
- C) Flexible (plan describes work breakdown, implementer chooses PR granularity)

**Decision Unlocks:** How detailed to make the PR breakdown in the execution plan.
**Section Affected:** Release/Sprint/PR Plan (Section 12)
**Blocker Level:** NON-BLOCKER (default: C - flexible)

---

### Q4: Command Queue Timeline Complexity
**Question:** The canonical spec (GRFDTRDPU 8.6) describes a full After Effects-style timeline. Should Demo 1.0 implement the full spec or a simplified subset?

**Options:**
- A) Full spec (per-unit PLAY/PAUSE, gummy stretch, loop toggle, repeat markers)
- B) Simplified (waypoint list only, no timeline visualization, basic loop support)
- C) Phased (basic in Phase 1, full timeline UI in Phase 2)

**Decision Unlocks:** UI scope for Phase 1 releases, affects complexity estimates.
**Section Affected:** Feature Implementation (Phase 1), UI Releases
**Blocker Level:** BLOCKER (affects scope of Phase 1)

---

### Q5: Direct Control Priority
**Question:** Direct Control (keyboard/gamepad input) is specified in canonical spec 8.6.9. When should it be implemented?

**Options:**
- A) Phase 1 (include with MOVE_ROLL, Release 011)
- B) Phase 2 (after multiplayer foundation)
- C) Post-Demo 1.0

**Decision Unlocks:** Whether Direct Control adds to Phase 1 scope.
**Section Affected:** Phase 1 releases, Feature Implementation
**Blocker Level:** NON-BLOCKER (default: B - Phase 2)

---

### Q6: Training Mini-Games Scope
**Question:** The GRFDTRDPU spec requires training sessions (60 seconds, score 0-100). Should Demo 1.0 include actual mini-games or placeholder scoring?

**Options:**
- A) Full mini-games per feature (MOVE_ROLL training, WPN_SHOOT training, etc.)
- B) Placeholder (stub training scene, fixed score for testing)
- C) Deferred (training system exists but mini-games post-Demo)

**Decision Unlocks:** Whether to allocate releases for training game design/implementation.
**Section Affected:** GRFDTRDPU Implementation (Phase 1)
**Blocker Level:** NON-BLOCKER (default: B - placeholder)

---

### Q7: Dark Side AI Complexity
**Question:** The canonical spec defines Dark Side mimicry, raids, and wreck capture. Should Demo 1.0 implement full AI or simplified behavior?

**Options:**
- A) Full spec (periodic mimicry polling, dynamic raid frequency, wreck capture mechanics)
- B) Simplified (scripted waves, no adaptive mimicry)
- C) Phased (basic raids in Demo 1.0, full mimicry post-Demo)

**Decision Unlocks:** AI complexity and release allocation.
**Section Affected:** Dark Side Implementation, Phase 2 scope
**Blocker Level:** NON-BLOCKER (default: C - phased)

---

### Q8: Energy Network Visualization
**Question:** Should the plan include explicit UI for energy network coverage (transmission range visualization)?

**Options:**
- A) Yes - show coverage rings/network on map
- B) No - just show global pool and unit OFFLINE state
- C) Debug-only (developer overlay, not player-facing)

**Decision Unlocks:** UI scope for energy system.
**Section Affected:** Economy UI releases
**Blocker Level:** NON-BLOCKER (default: B - minimal)

---

### Q9: Matera Color Mixing UI
**Question:** Generators use complementary colors for 200% efficiency. Should Demo 1.0 include color mixing UI/feedback?

**Options:**
- A) Yes - show color wheel, efficiency preview
- B) Minimal - show input slots, show efficiency number
- C) Defer - single Matera type for Demo 1.0, colors post-Demo

**Decision Unlocks:** Economy system complexity.
**Section Affected:** Economy features, Resource UI
**Blocker Level:** NON-BLOCKER (default: C - defer colors)

---

### Q10: Multiplayer Scope Clarification
**Question:** Should Demo 1.0 target 2-player P2P only, or up to 4 players?

**Options:**
- A) 2-player P2P only (simpler networking, easier testing)
- B) 4-player mesh (full P2P mesh, more complex)
- C) 4-player with host (star topology, host-authoritative)

**Decision Unlocks:** Network architecture complexity, testing scope.
**Section Affected:** Multiplayer Stack (Phase 2)
**Blocker Level:** BLOCKER (affects architecture design)

---

### Q11: WebRTC Fallback Strategy
**Question:** If WebRTC fails (NAT issues), what fallback should Demo 1.0 support?

**Options:**
- A) TURN relay only (no additional fallback, use TURN servers)
- B) WebSocket fallback (additional code path, higher latency)
- C) No fallback (fail with helpful message, require good NAT)

**Decision Unlocks:** Network reliability vs complexity trade-off.
**Section Affected:** Multiplayer Stack, Risk Mitigation
**Blocker Level:** NON-BLOCKER (default: A - TURN only)

---

### Q12: Supabase Tier Constraints
**Question:** The plan references Supabase. Are there tier/cost constraints to consider?

**Options:**
- A) Free tier only (must work within free limits)
- B) Pro tier acceptable (budget allocated)
- C) Self-hosted option required

**Decision Unlocks:** Backend architecture, rate limiting approach.
**Section Affected:** Backend & Services (Section 7)
**Blocker Level:** NON-BLOCKER (default: A - free tier)

---

### Q13: Testing Automation Level
**Question:** What level of automated testing should the plan mandate?

**Options:**
- A) Unit tests only (Jest for SimCore)
- B) Unit + Integration (multi-instance tests)
- C) Unit + Integration + E2E (Playwright/Cypress)

**Decision Unlocks:** CI/CD pipeline complexity, testing release scope.
**Section Affected:** Testing Strategy (Section 13)
**Blocker Level:** NON-BLOCKER (default: B - Unit + Integration)

---

### Q14: Performance Targets
**Question:** The Claude plan specifies tick time < 8ms at 50 units. Should the plan include explicit performance gates?

**Options:**
- A) Yes - hard gates (PR blocked if p95 > 8ms)
- B) Soft targets (log warnings, don't block)
- C) Monitor only (metrics captured, no enforcement)

**Decision Unlocks:** CI/CD strictness, performance regression approach.
**Section Affected:** Testing Strategy, Risk Register
**Blocker Level:** NON-BLOCKER (default: B - soft targets)

---

### Q15: Documentation Deliverables
**Question:** Beyond the plan itself, what documentation should be produced alongside implementation?

**Options:**
- A) API docs only (JSDoc or similar)
- B) API + Architecture diagrams
- C) API + Architecture + User-facing guides

**Decision Unlocks:** Documentation scope in release plan.
**Section Affected:** Release Plan, deliverables per release
**Blocker Level:** NON-BLOCKER (default: A - API docs)

---

### Q16: Existing Code Preservation
**Question:** The codebase has existing Unit.js (~1500 lines). Should the plan mandate refactor-in-place or parallel rewrite?

**Options:**
- A) Shim-based extraction (Claude plan approach: keep Unit.js, extract state incrementally)
- B) Parallel rewrite (new SimCore modules, then swap)
- C) Flexible (implementer chooses based on risk assessment)

**Decision Unlocks:** Refactor strategy and risk mitigation approach.
**Section Affected:** Phase 0 architecture, Risk Register
**Blocker Level:** NON-BLOCKER (default: A - shim-based, per Claude plan)

---

### Q17: Release Branch Strategy
**Question:** Should the plan specify a git branching model?

**Options:**
- A) GitFlow (develop + main + release branches)
- B) Trunk-based (main + short-lived feature branches)
- C) Current approach (release/XXX branches, PR to main)

**Decision Unlocks:** Git workflow section of plan.
**Section Affected:** Workflow, CI/CD
**Blocker Level:** NON-BLOCKER (default: C - current approach)

---

### Q18: Feature Flag System
**Question:** Should Demo 1.0 include a feature flag system for progressive rollout?

**Options:**
- A) Yes - full feature flag system
- B) No - features are on/off at code level
- C) Calibration console only (existing console variables)

**Decision Unlocks:** Feature management complexity.
**Section Affected:** Architecture, Deployment
**Blocker Level:** NON-BLOCKER (default: C - calibration console)

---

### Q19: Error Reporting
**Question:** Should the plan include error reporting/telemetry for Demo 1.0?

**Options:**
- A) Yes - Sentry or similar
- B) Console logging only
- C) Local error log file

**Decision Unlocks:** Observability infrastructure.
**Section Affected:** Testing & Observability
**Blocker Level:** NON-BLOCKER (default: B - console logging)

---

### Q20: Demo 1.0 End State Definition
**Question:** What constitutes "Demo 1.0 complete"? Please confirm the acceptance criteria.

**Proposed criteria:**
1. Single-player loop works (research -> design -> produce -> move -> mine -> combat)
2. 2-player P2P multiplayer works (lobby -> connect -> synchronized gameplay)
3. All 8 core features implemented (MOVE_ROLL, OPTICAL_VISION, SUBSURFACE_SCAN, MATERA_MINING, MATERA_TRANSPORT, WPN_SHOOT, TERRAIN_SHAPING, UNIT_CARRIER)
4. Dark Side basic raids functional
5. Save/load works
6. No critical bugs in smoke test

**Options:**
- A) Confirm proposed criteria
- B) Add criteria (specify)
- C) Reduce criteria (specify what to defer)

**Decision Unlocks:** Scope boundary for plan.
**Section Affected:** All sections (scope definition)
**Blocker Level:** BLOCKER (must know scope to write plan)

---

## Summary

| Question | Blocker? | Default | Decision (per Plan v2) |
|----------|----------|---------|------------------------|
| Q1 Replay | No | Defer | **B: Include** (plan line 1289) |
| Q2 UI Framework | No | Defer | **Web Components** (appendix I) |
| Q3 PR Granularity | No | Flexible | **A: Granular PRs** (plan line 1489) |
| Q4 Timeline Complexity | **YES** | - | **C: Phased** (plan line 595) |
| Q5 Direct Control | No | Phase 2 | *(default)* |
| Q6 Training Mini-Games | No | Placeholder | **Slider** (plan line 873) |
| Q7 Dark Side AI | No | Phased | *(default)* |
| Q8 Energy Network UI | No | Minimal | *(default)* |
| Q9 Matera Colors | No | Defer colors | *(default)* |
| Q10 Multiplayer Scope | **YES** | - | **C: 4-player host** (plan line 1111) |
| Q11 WebRTC Fallback | No | TURN only | *(default)* |
| Q12 Supabase Tier | No | Free tier | **B: Pro acceptable** (plan line 1198) |
| Q13 Testing Level | No | Unit + Integration | *(default)* (plan line 1526) |
| Q14 Performance Gates | No | Soft targets | *(default)* (plan line 1623) |
| Q15 Documentation | No | API docs only | *(default)* |
| Q16 Code Preservation | No | Shim-based | *(default)* (plan line 1712) |
| Q17 Branch Strategy | No | Current approach | *(default)* (plan line 1480) |
| Q18 Feature Flags | No | Calibration console | *(default)* |
| Q19 Error Reporting | No | Console logging | *(default)* |
| Q20 End State | **YES** | - | **A: Confirmed** (plan line 99) |

**BLOCKERS:** Q4, Q10, Q20 - answered, plan written.

---

*End of QUESTIONS_FOR_ADAM.md*
