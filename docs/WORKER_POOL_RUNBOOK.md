# WORKER POOL RUNBOOK (BINDING)

**Orchestration Tool:** Windows Terminal (Multi-Tab/Pane) + Git
**Worker Type:** 5x Claude Code (CLI) or 5x Web Instances
**Controller:** Antigravity (Role Assignment) + Ádám (Ideas/Decisions/Testing)

---

## 1. Orchestration Setup (The 5-Window Roster)

**Operator (Ádám)**: Open exactly **5 Terminal Tabs**.
Start `claude` (or web instance) in each. Assign roles mentally or via prompt.

| Window | Role | Branch Pattern |
| :--- | :--- | :--- |
| **1** | **Orchestrator** | `work/WO-XXX` (Parent) |
| **2** | **Worker (BE)** | `work/WO-XXX-backend` |
| **3** | **Worker (FE)** | `work/WO-XXX-frontend` |
| **4** | **Worker (QA)** | `work/WO-XXX-qa` |
| **5** | **Worker (RF)** | `work/WO-XXX-refactor` |

### **Command: Spawn Pool (Manual)**
Run in the respective terminals:
`# W1 (Orch)`: `git checkout -b work/WO-XXX main`
`# W2 (BE)`: `git checkout -b work/WO-XXX-backend work/WO-XXX`
`# ... etc`

**Note**: Branch naming follows `docs/AI_WORKFLOW.md` §3 (canonical).

---

## 2. Operator Copy/Paste Map (How to Run)

**A. Assigning Work (Orchestrator -> Worker)**
1. **Orchestrator** generates `docs/work_orders/WO-XXX.md`.
2. **Operator**: Copy the content of `WO-XXX.md`.
3. **Operator**: Paste into **Worker Terminal (2-5)**.
4. **Worker**: ACKs and starts coding.

**B. Escalation (Worker -> Antigravity)**
1. **Worker**: "I need to Escalate: [Reason]".
2. **Operator**: Copy reason to `docs/MAILBOX.md` under `[ESCALATION]`.
3. **Operator**: Show MAILBOX to **Antigravity**.
4. **Antigravity**: Write decision in MAILBOX.
5. **Operator**: Paste decision back to Worker.

**C. Handoff (Worker -> Orchestrator)**
1. **Worker**: "Work Order Complete. Branch: [X]. Tests: [Y]."
2. **Operator**: Copy this text.
3. **Operator**: Paste into **Orchestrator Terminal (1)**.
4. **Orchestrator**: `git merge`, run integration tests.

---

## 3. Stop Protocol (Shutdown)

1. **Check STATUS**: Are all branches pushed?
2. **Merge**:
   - Orchestrator: Merge Worker -> Parent (if PASS).
   - Antigravity: Merge to main (after explicit human PASS).
3. **Completion Signal**:
   - Posting to `docs/MAILBOX.md` with: `[WO-XXX] [Worker] [Complete]`.

---

## 3. Work Isolation Strategy
- **FileSystem:** Shared local repo (careful with concurrent edits).
- **Git:** Strictly **Separate Branches** per worker.
- **Merge Order:** Sequential. W1 merges -> W2 rebases/merges -> W3 rebases/merges.

---

## 4. HU Test Scenario: Pool Verification
**(How Ádám verifies the pool is running)**

**Teszt célja:** Ellenőrizni, hogy az 5 agent készen áll és izolált.
**Lépések:**
1. Nyisd meg a `docs/STATUS_WALKTHROUGH.md`-t: a **Role Map** ki van töltve 5 workerre?
2. Futtasd: `git branch` -> Látszódik 5 aktív `wX-...` branch?
3. Ellenőrizd a terminálokat: 5 külön ablak/tab nyitva van?
**Elvárt eredmény:**
- Role Map Publiálva.
- 5 feature branch létezik.
- A környezet készen áll a párhuzamos munkára.
**Gyors PASS/FAIL:** HA nincs Role Map VAGY nincs 5 branch -> FAIL.
