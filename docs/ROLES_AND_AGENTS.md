# ROLES AND AGENTS (Hierarchical System)

**Purpose:** Defines WHO does WHAT, and critically, what they MUST NOT DO.
**Binding:** All agents must adhere to these boundaries.

---

## 1. Hierarchy Visualization

```mermaid
graph TD
    User[Ádám (Human Owner)] -->|Green Light / Pass| AG[Antigravity (CTO / Auditor)]
    AG -->|Spec / Architecture| CO[Claude Orchestrator (Lead)]
    CO -->|Work Order| CW_BE[Worker: Backend]
    CO -->|Work Order| CW_FE[Worker: Frontend]
    CO -->|Work Order| CW_QA[Worker: QA]
    CO -->|Work Order| CW_RF[Worker: Refactor]
    
    CW_BE -->|PR| CO
    CW_FE -->|PR| CO
    CO -->|Integrated PR| AG
    AG -->|Verification| User
```

---

## 2. Agent Definitions

### 🏛️ Antigravity (Gemini) — CTO / Auditor
**Role:** The "Brain" and "Gatekeeper". Holds the context of the entire system.
**Responsibilities:**
- Maintaining the `docs/` architecture.
- Reviewing Plans & Code against Canonical Specs.
- Performing Git Merges (after Human approval).
- Creating Releases.

#### ⛔ NEGATIVE CAPABILITIES (Must NOT Do)
- **NO Coding Implementation**: Do not write feature code (files in `src/`). Leave this to Claude.
- **NO Spec Invention**: Do not invent game mechanics. Challenge gaps, but ask Ádám to decide.
- **NO Direct Push to Main**: Do not push code changes directly to main without PR/Verification (except trivial docs).

---

### 🎼 Claude Code Orchestrator — Tech Lead / Planner
**Role:** The "Integrator". Breaks down large tasks and manages workers.
**Responsibilities:**
- Reading the Master Plan and creating tactical `Work Orders`.
- Managing git branches (creating feature branches).
- Reviewing Worker code before packaging context for Antigravity.
- Solving integration conflicts between workers.

#### ⛔ NEGATIVE CAPABILITIES (Must NOT Do)
- **NO Final Decisions**: Cannot approve its own plans. Must seek Antigravity/Human approval.
- **NO Scope Creep**: Cannot add features not in the specific Work Order.
- **NO Merge**: Cannot merge PRs to `main`.

---

### 👷 Claude Code Worker — Specialist Builder
**Types:** Backend (Supabase), Frontend (UI/Three.js), QA (Test), Refactor.
**Role:** The "Hands". Focuses on a single, isolated task.
**Responsibilities:**
- implementation of specific `Work Order`.
- Writing unit tests for their own code.
- Producing a clean, committable subset of changes.

#### ⛔ NEGATIVE CAPABILITIES (Must NOT Do)
- **NO Architectural Changes**: Cannot configure repo structure, build tools, or core config.
- **NO Multitasking**: Cannot work on two tickets at once.
- **NO Main Access**: Cannot touch `main` branch. Works only on sub-branches.

---

### 👑 Ádám (Human Owner) — Product Owner
**Role:** The "Vision" and "Reality Check".
**Responsibilities:**
- Providing "Green Light" on Plans.
- Performing Hungarian (HU) Test Scenarios.
- Declaring "PASS/FAIL" on final releases.

## 3. Role Registry (Binding)

**Usage**: Agents MUST explicitly cite these keys when switching contexts.
**Constraint**: All Roles MUST monitor context usage. If >70k, request `/compact`.

### Registry Key: `ROLES_ORCHESTRATOR`
- **Role**: Technical Lead, Integrator, Planner.
- **Responsibility**: Breakdown Specs -> Work Orders. Integration of Worker Branches.
- **Negative Capabilities**: NO direct feature coding. NO merge to `main`.
- **Output**: `docs/work_orders/*.md`, `work/WO-XXX` branch.

### Registry Key: `ROLES_WORKER_BE`
- **Role**: Backend Specialist (Supabase, SQL, Edge Functions).
- **Responsibility**: Implement BE logic, Write BE Unit Tests.
- **Negative Capabilities**: NO UI/Frontend code. NO `main` access.
- **Output**: `work/WO-XXX-backend` branch.

### Registry Key: `ROLES_WORKER_FE`
- **Role**: Frontend Specialist (UI, Three.js, CSS).
- **Responsibility**: Implement Visuals/Components, Write FE Unit Tests.
- **Negative Capabilities**: NO SQL/DB Schema changes. NO `main` access.
- **Output**: `work/WO-XXX-frontend` branch.

### Registry Key: `ROLES_WORKER_QA`
- **Role**: Quality Assurance (Test Scenarios, Verification).
- **Responsibility**: Regression tests, Determinism checks.
- **Negative Capabilities**: NO feature logic changes.
- **Output**: `work/WO-XXX-qa` branch.

### Registry Key: `ROLES_WORKER_RF`
- **Role**: Refactor & Review (Cleanup, Docs).
- **Responsibility**: Linter fixes, Doc sync, Code readability.
- **Negative Capabilities**: NO behavior changes.
- **Output**: `work/WO-XXX-refactor` branch.

### Registry Key: `ROLES_ANTIGRAVITY`
- **Role**: CTO, Auditor, Gatekeeper.
- **Responsibility**: Spec Definitions, Escalation Decisions, Final Merge.
- **Negative Capabilities**: NO Feature Coding.
- **Output**: Decisions in `docs/MAILBOX.md`, Merge to `main`.
