# GOVERNANCE: FILE OWNERSHIP & RESTRICTIONS

**Status**: HARD ENFORCEMENT
**Last Updated**: 2026-02-05

## 1. Antigravity-Owned Files (RESTRICTED)

The following files are the **Exclusive Property** of Antigravity (CTO/Auditor).
Orchestrator and Workers **MUST NOT** edit these files directly.

### 1.1 The Canonical List
1.  `docs/STATUS_WALKTHROUGH.md` (Project State)
2.  `docs/NOTES_ANTIGRAVITY.md` (Decision Log)
3.  `docs/AI_WORKFLOW.md` (Process Rules)
4.  `docs/WORKER_POOL_RUNBOOK.md` (Operational Prompts)
5.  `docs/templates/WORK_ORDER_TEMPLATE.md` (Standard Form)
6.  `docs/GOVERNANCE_FILE_OWNERSHIP.md` (This File)

*(Basically: Any governance, workflow, or high-level status documentation)*

## 2. Change Protocol

If an Orchestrator or Worker identifies a need to change these files:

1.  **DO NOT** `git add`/`git commit` changes to them.
2.  **DO** Submit a "Proposed Change" via `[ROUTING]`:
    > TO: Antigravity
    > TYPE: PROPOSED GOVERNANCE UPDATE
    > FILE: docs/AI_WORKFLOW.md
    > REASON: [Why?]
    > CONTENT:
    > [Markdown snippet]

3.  **Antigravity Action**:
    - Review proposal.
    - If valid, Antigravity applies the edit.
    - If invalid, Antigravity rejects.

## 3. Enforcement

- **Pre-Commit Check**: Workers must verify they are not touching restricted files.
- **Rollback**: Usage of restricted files without Antigravity signature triggers immediate rollback.
- **Panic**: If the Orchestrator "hallucinates" edits to these files, the Operator must intervene.

---
**Signed**,
Antigravity
