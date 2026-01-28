# GATE 01: DETERMINISM PREFLIGHT

**Gate ID:** GATE-01
**Status:** PENDING
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

## Evidence Template

### E1: Variable Timestep Findings
```
| File | Line | Code Snippet | Classification |
|------|------|--------------|----------------|
| ... | ... | ... | BLOCKER/SAFE |
```
**Total BLOCKERS:** _

### E2: Unseeded Random Findings
```
| File | Line | Code Snippet | Classification |
|------|------|--------------|----------------|
| ... | ... | ... | BLOCKER/SAFE |
```
**Total BLOCKERS:** _

### E3: Date.now() ID Findings
```
| File | Line | Code Snippet | Classification |
|------|------|--------------|----------------|
| ... | ... | ... | BLOCKER/SAFE |
```
**Total BLOCKERS:** _

### E4: Capability Assessment
- **Replay Capable:** Yes / No
- **Blocking Issues:**
  1. ...
  2. ...

### E5: Remediation Summary
| Issue Type | Count | Fix Release | Effort |
|------------|-------|-------------|--------|
| Variable timestep | _ | 001 | _ files |
| Math.random() | _ | 004 | _ files |
| Date.now() IDs | _ | 003 | _ files |

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
| Auditor | | | |
| Human Owner | | | |

---

*End of GATE_01_DETERMINISM_PREFLIGHT.md*
