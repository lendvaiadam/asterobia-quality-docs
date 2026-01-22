# CHANGE REQUESTS FOR CLAUDE: Release 000 Merge

**Date:** 2026-01-22
**Objective:** Produce `MASTER_DEVELOPMENT_PLAN_MERGED_v1.md`

## 1. Plan Structure Directives

You (Claude) to create the SINGLE Canonical Plan by merging your detail with Antigravity's architecture.

**Source of Truth Rules:**
1.  **Architecture:** Use **Antigravity's SimLoop/State/Transport definitions** (Appendix A of AG plan).
    *   *Why:* It provided valid implementation code for the 20Hz accumulator and StateRegsitry.
2.  **Execution:** Use **Claude's PR Breakdown** (Appendix E of Claude plan).
    *   *Why:* It broke work into 3-file chunks, which is better for us agents.
3.  **Database:** Use **Claude's Supabase Schema**.
    *   *Why:* It was more detailed with SQL.

## 2. Specific Addition Requests

| Section | Action | Content Source |
|:--------|:-------|:---------------|
| **Replay System** | **ADD NEW SECTION** | Define "Input Recorder" (Tick/Cmd/Seed). See `OPEN_DECISIONS.md`. |
| **Snapshot Strategy** | **MODIFY** | Explicitly state "Full Snapshots for Phase 0/1". Remove "Delta" complexity for now. |
| **SimCore Folder** | **DEFINE** | `src/SimCore/` MUST be physically separate. Define the EXACT folder structure in Sec 4. |
| **UI Tech Stack** | **DECIDE** | If no user input, default to **Vanilla Custom Elements**. Write a brief standard for it. |
| **CI/CD** | **ADD** | Add a "Release 000.x" PR for `github-actions`: `npm test`, `eslint`. |

## 3. The "Merged" Artifact

**Filename:** `docs/master_plan/MASTER_DEVELOPMENT_PLAN_Merged_v1.md`
**Format:**
*   Frontmatter: Status "AUTHORIZED".
*   Appendix Links: Link to *existing* Claude/Antigravity appendices if stable, or (better) consolidate them into `docs/master_plan/appendices/`.
    *   *Recommendation:* Copy the best appendices to `docs/master_plan/appendices/MERGED_Appendix_X.md` to have a clean slate.

**Validation Rule:**
Every row in `docs/master_plan/merge/COVERAGE_MATRIX.md` must have a corresponding header in your final plan.
