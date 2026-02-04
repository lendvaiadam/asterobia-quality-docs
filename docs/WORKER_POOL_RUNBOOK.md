# WORKER POOL RUNBOOK (BINDING)

**Orchestration Tool:** Windows Terminal (Multi-Tab/Pane) + Git
**Worker Type:** 5x Claude Code (CLI) or 5x Web Instances
**Controller:** Antigravity (Role Assignment) + Ádám (Ideas/Decisions/Testing)

---

## 1. Orchestration Setup
The pool is NOT a single automated script but a **State Protocol**.
We use **Git Branch Isolation** to separate workers.

### **Command: Spawn Pool (Manual)**
Run in 5 separate terminal tabs:

**Note**: Branch naming follows `docs/AI_WORKFLOW.md` §3 (canonical).

`# Worker 1`
`git checkout main`
`git pull`
`git checkout -b work/WO-XXX-backend work/WO-XXX`

`# Worker 2`
`git checkout main`
`git pull`
`git checkout -b work/WO-XXX-frontend work/WO-XXX`

*(Repeat for W3, W4, W5)*

---

## 2. Ops Checklist (Start/Stop)

### **START (Spin-up)**
1. [ ] **Antigravity:** Publish Role Map in `docs/STATUS_WALKTHROUGH.md`.
2. [ ] **Ádám:** Verify Work Package scope is clear.
3. [ ] **Ádám:** Open 5 Terminal Tabs (or Claude Windows).
4. [ ] **Orchestration:** checkout fresh branches for assigned roles.
1. [ ] **Reference**: `docs/STATUS_WALKTHROUGH.md` > "Role Map (Active Workers)" table.

## 2. Stop Protocol (Shutdown)

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
