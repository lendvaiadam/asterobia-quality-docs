# AI WORKFLOW & PROTOCOLS

**Purpose:** Defines HOW the hierarchy executes tasks, ensuring strict authority and quality control.
**Replaces:** `PLANNING_PROTOCOL.md`

---

## 1. The Work Cycle

### Step 1: Definition (Antigravity)
- **Input**: User Request or Roadmap Item.
- **Action**: Antigravity reviews `master_plan` and `specs`.
- **Output**: Validated Requirement / Spec Gap Analysis.

### Step 2: Orchestration (Claude Orchestrator)
- **Input**: Validated Requirement.
- **Action**: Breakdown into `Work Orders`.
- **Action**: Create Branch `feature/task-name`.
- **Output**: Markdown Plan + Branch.

### Step 3: Execution (Claude Workers)
- **Input**: Single Work Order.
- **Action**: Implement code + unit tests.
- **Output**: Code Commit on Feature Branch + Test Result.

### Step 4: Integration (Claude Orchestrator)
- **Input**: Worker Commits.
- **Action**: Run Integration Tests. Resolve Conflicts.
- **Output**: "Ready for Review" PR candidate.

### Step 5: Audit & Merge (Antigravity + Ádám)
- **Input**: PR Candidate.
- **Action (Antigravity)**: Check against `IMPLEMENTATION_GATES.md`.
- **Action (Ádám)**: Run HU Test Scenario.
- **Decision**: PASS / FAIL.
- **Output**: Merge to `main` (if PASS).

---

## 2. Authority & Decision Rights (BINDING)

| Activity | Who Proposes? | Who Decides (Veto)? | Who Executes? |
| :--- | :--- | :--- | :--- |
| **New Feature Scope** | Orchestrator / User | **Ádám (Owner)** | Antigravity (Docs) |
| **Architecture Change** | Orchestrator | **Antigravity (CTO)** | Workers |
| **Code Implementation** | Workers | **Orchestrator (Lead)** | Workers |
| **Merge to Main** | Orchestrator | **Antigravity + Ádám** | **Antigravity Only** |
| **Release Tagging** | Antigravity | **Ádám** | Antigravity |

### Conflict Resolution
1.  **Code Conflict**: Orchestrator resolves worker conflicts.
2.  **Spec Conflict**: Antigravity rules on Canonical constraints.
3.  **Vision Conflict**: Ádám has final say.

---

## 3. Branching Strategy

- **`main`**: Protected. Production-ready. **NO DIRECT PUSH.**
- **`work/task-name`**: Orchestrator's integration branch.
- **`work/task-name-backend`**: Worker sub-branch (optional, usually shared work branch if sequential).

**Rule**: Only Antigravity performs the final merge to `main`.

---

## 4. The "Work Order" Protocol
To assign a task to a Worker, the Orchestrator MUST provide:
1.  **Context**: 1-2 sentence summary.
2.  **In-Scope Files**: Explicit list.
3.  **Out-of-Scope**: What strictly NOT to touch.
4.  **Acceptance Criteria**: "Done when...".

---

## 5. Quality Gates
Reference: `docs/IMPLEMENTATION_GATES.md`
**Every PR must pass:**
- Determinism Check.
- Lint/Syntax Check.
- HU Test Scenario (Human Verification).
