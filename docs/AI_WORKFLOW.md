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

### Human Absence Protocol
- No autonomous merge without explicit human PASS.
- If Ádám unavailable >4h: Orchestrator + Workers may continue up to “PR Candidate ready”.
- Work pauses at final merge/release gate until Ádám returns OR explicit delegation is documented in DECISIONS_LOG.

### Decision Tiebreaker
- If Antigravity PASS and Ádám FAIL: Ádám wins (product authority).
- If Antigravity FAIL and Ádám PASS: Antigravity wins (quality gate / safety).

---

## 3. Branching Strategy

- **`main`**: Protected. Production-ready. **NO DIRECT PUSH.**
- **Parent (Orchestrator)**: `work/WO-XXX` (Integration branch).
- **Worker (Worker)**: `work/WO-XXX-[backend|frontend|qa|refactor]`.

**Rule**: Orchestrator creates Parent; Worker creates Worker branch.
**Rule**: Only Antigravity performs the final merge to `main`.

---

## 4. The "Work Order" Protocol (Orchestrator -> Worker)

### 4.1 Work Order Template (JSON-compatible Markdown)

To assign a task, the Orchestrator MUST generate this block:

See: `docs/templates/WORK_ORDER_TEMPLATE.md` (Copy-Paste this).
Store actual Work Orders in: `docs/work_orders/WO-XXX-Name.md`.

To assign a task, the Orchestrator MUST generate a file based on the template, referencing Canonical Specs and Branches.

### 4.2 Worker Execution Protocol (BINDING)

1.  **ACK**: Worker reads Work Order and confirms "I understand".
2.  **CHECKOUT**: `git checkout -b [Worker Branch] [Parent Branch]`
3.  **EXECUTE**:
    - Write Code.
    - Write/Update Unit Tests (MANDATORY).
    - Run `npm test`.
1.  **ACK**: Worker reads Work Order and confirms "I understand".
2.  **CHECKOUT**: `git checkout -b [Worker Branch] [Parent Branch]`
3.  **EXECUTE**:
    - Write Code.
    - Write/Update Unit Tests (MANDATORY).
    - Run `npm test`.
4.  **COMMIT**: `git commit -m "feat(WO-XXX): [Description]"`
5.  **PUSH**: `git push origin [Worker Branch]`
6.  **HANDOFF**: Post to `docs/MAILBOX.md`:
    - `[Date] [WO-XXX] [Worker] [Branch] [PASS] [Notes]`

---

## 5. Branch Management Rules

- **Orchestrator** creates the `parent` branch (`work/feature-x`).
- **Worker** creates `child` branch (`work/feature-x-fe`) off the parent.
- **Orchestrator** merges child -> parent.
- **Antigravity** merges parent -> `main`.

---

## 6. Quality Gates

---

## 5. Quality Gates
Reference: `docs/IMPLEMENTATION_GATES.md`
**Every PR must pass:**
- Determinism Check.
- Lint/Syntax Check.
- HU Test Scenario (Human Verification).
