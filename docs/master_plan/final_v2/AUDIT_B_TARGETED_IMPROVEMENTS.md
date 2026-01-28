# AUDIT B: TARGETED IMPROVEMENTS

**Audit Date:** 2026-01-28
**Scope:** Address hygiene issue C-010/A-010 only
**Method:** Minimal edit to make decision record unambiguous

---

## B-001: Q1–Q20 Decision Record Hygiene

### Target Location
- **File:** `docs/master_plan/final_v2_prep/QUESTIONS_FOR_ADAM.md`
- **Section:** Summary table (lines 306-331)

### Problem
The summary table shows questions with "Default if No Answer" but does not record what was actually decided. The decisions exist inline in `MASTER_PLAN_FINAL_v2.md` but are not traceable back to the source question file.

### Change
Add a "Decision (per Plan v2)" column to the summary table showing the actual choice made, with reference to where it appears in the plan.

**Before:**
```markdown
| Question | Blocker? | Default if No Answer |
|----------|----------|----------------------|
| Q1 Replay | No | Defer |
...
```

**After:**
```markdown
| Question | Blocker? | Default | Decision (per Plan v2) |
|----------|----------|---------|------------------------|
| Q1 Replay | No | Defer | **B: Include** (line 1289) |
...
```

### Benefit
- Single source of truth for Q1-Q20 decisions
- Traceable: each decision links to plan line number
- Closes audit finding without touching the plan itself

---

## Summary

| ID | Issue | Status |
|----|-------|--------|
| B-001 | Q1-Q20 Decision Record | FIXED |

---

*End of Audit B*
