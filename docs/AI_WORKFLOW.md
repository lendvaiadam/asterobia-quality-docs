# AI WORKFLOW & PROTOCOLS

**Purpose:** Defines HOW the hierarchy executes tasks, ensuring strict authority and quality control.
**Operator Model:** Human acts as Router. Mailbox is AI-only.
**Replaces:** `PLANNING_PROTOCOL.md`

---

## 0. Operator Communication Standard (BINDING)

Humans do NOT read `docs/MAILBOX.md`. Agents must output this block to trigger action:

```text
[ROUTING]
TO: <Agent/Terminal Name>
PASTE: <exact text to paste or file path to copy>
CONTEXT: <1 sentence why>
[/ROUTING]
```

### 0.b Context Threshold Rule (70k Tokens)
**Trigger**: If Context > 70,000 tokens OR "High Context" warning appears.
**Action**: Agent MUST output a Routing Block:
```text
[ROUTING]
TO: Current Chat
PASTE: /compact
CONTEXT: Context threshold (70k) exceeded. Preventing brain fog.
[/ROUTING]
```

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

### Step 3: Execution (Fixed Roster)
- **Setup**: 5 Fixed Windows (Orchestrator + 4 Workers).
- **Input**: Single Work Order.
- **Action**: Implement code + unit tests.
- **Check**: Trigger "Antigravity Escalation" if risks detected.
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

### Mid-flight Antigravity Escalation (MANDATORY)
Workers/Orchestrator MUST pause and summon Antigravity if:
- Scope ambiguity / unclear spec interpretation.
- Potential architecture impact (e.g. adding dependencies).
- Determinism or authority concerns.
- Any "unknown unknown" risk flagged.

**Mechanics:**
1. Post to `docs/MAILBOX.md` with: `[ESCALATION] [WO-XXX] [Reason]`.
2. Antigravity responds with: `[DECISION] [APPROVE/REJECT/MODIFY]`.
3. Work resumes only after decision is logged in Work Order.

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

---

## 4. The "Work Order" Protocol (Orchestrator -> Worker)

### 4.A Pre-Issue Gate (Mandatory Checks)
**Before issuing ANY Work Order**, Orchestrator MUST:
1.  **De-Dup Check**: Read `docs/STATUS_WALKTHROUGH.md` & `git log`. If done, SKIP.
2.  **Double-Check (CTO Ping #1)**:
    - **Trigger**: Before finalizing the plan.
    - **Action**: Ask Antigravity **5–8 targeted questions** regarding:
      - *Best practices / Patterns*
      - *Performance risks*
      - *Determinism constraints*
      - *Documentation alignment*
    - **Wait**: Do not proceed until Antigravity responds with `[ACK]`.
3.  **Result**: Proceed only after De-Dup PASS and Antigravity ACK.

### 4.0 Parallel Execution Policy (Safe-by-Default)

**Policy**: Orchestrator MUST decompose suitable Work Orders into **Parallel Tasks** for W1–W4.
**Default**: Parallel execution is the standard, not the exception.

**Independence Criteria (Must all be true)**:
1.  **No Shared Files**: Tasks touch disjoint file sets (or Orchestrator explicitly partitions ownership).
2.  **No Shared API Churn**: Contracts are stable or defined upfront.
3.  **No Architecture Risk**: No new dependencies or structural changes (otherwise: CTO Ping first).
4.  **Determinism**: Network/Visuals must not mutually corrupt SimCore state.

**Safety Constraints**:
- **Integration**: Serialized by Orchestrator (Merge A -> Merge B).
- **Merge to Main**: Antigravity Only.
- **Artifact**: Orchestrator MUST publish a "Parallelization Map" in `STATUS_WALKTHROUGH.md` or the Work Order, listing which Worker owns which files.

---

### 4.1 Fixed 5-Window Roster (Binding)
This roster is **IMMUTABLE**. Even if idle, these 5 agents always exist.

| Role | Window | Specialization |
| :--- | :--- | :--- |
| **Orchestrator** | Terminal 1 | Manager, Integrator, Planner. |
| **Worker (BE)** | Terminal 2 | Backend, Supabase, SQL. |
| **Worker (FE)** | Terminal 3 | Frontend, UI, Three.js, CSS. |
| **Worker (QA)** | Terminal 4 | Test Writing, Regression, Verification. |
| **Worker (RF)** | Terminal 5 | Refactor, Review, Generalist. |

### 4.2 Role Header Requirement (No Starter Prompts)
> "You are **[Role Name]**. Read `docs/ROLES_AND_AGENTS.md` **Role Registry** and follow it.
> Your Registry Key is: `ROLES_[KEY]`.
> Required Skills: `[List from docs/SKILLS_GOVERNANCE.md]`."

### 4.B Skill Loading Enforcement (Binding)
1.  **Orchestrator**: MUST list specific `docs/skills/skill-*.md` files in the "Required Skills" section of every WO.
2.  **Worker**: MUST ACK by confirming "Read loadout and [Skill Files]".
3.  **Reject**: If Worker fails to ACK skills, Orchestrator REJECTS the handoff.

### 4.3 Worker Execution Protocol (BINDING)

1.  **ACK**: Worker reads Header, verifies Role Registry, and confirms.
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

## 6. Production-Ready Review Gate (MANDATORY)

**When**: Before "Ping #3 (Pre-Merge)".
**Who**: Orchestrator.

**Checklist**:
1. **Determinism**: Does the change preserve simulation determinism?
2. **Tests**: Are unit tests included and passing?
3. **Observability**: Are errors logged correctly (no silent failures)?
4. **Docs**: Is `docs/specs/` or `System Overview` updated?
5. **Edge Cases**: Checked boundary conditions (empty lists, disconnects)?
6. **Ops**: Any new Environment Variables or DB Migrations?

**Output**: Orchestrator summarizes this checklist in the Handoff Note.

---

## 7. Operator Test Scenario Check-ins (Mandatory)

**Trigger**: Orchestrator MUST report short **HU Test Scenarios** to Ádám:
1.  After **each integration merge** into parent branch.
2.  Before **CTO Ping #3 (Pre-Merge)**.
3.  When a Worker completes a logic-impacting Work Order.

**Gate Rule**: If this block is missing after integration, the process enters **STOP** state. The next output MUST be the HU block.

**Format (Copy-Paste Friendly)**:
```text
[ROUTING]
TO: Current Chat
PASTE:
**HU-TEST REQUEST**:
- **Pre**: [e.g. Clean save, 2 clients open]
- **Step**: [e.g. Move unit A to (10,10)]
- **Expected**: [e.g. Unit moves on both screens, no lag]
**DECISION REQUIRED**: PASS / FAIL?
[/ROUTING]
```

---

---

## 7. Quality Gates

---

## 5. Quality Gates
Reference: `docs/IMPLEMENTATION_GATES.md`
**Every PR must pass:**
- Determinism Check.
- Lint/Syntax Check.
- HU Test Scenario (Human Verification).
