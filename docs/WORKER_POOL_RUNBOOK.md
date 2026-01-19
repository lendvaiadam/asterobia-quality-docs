# WORKER POOL RUNBOOK (BINDING)

**Orchestration Tool:** Windows Terminal (Multi-Tab/Pane) + Git
**Worker Type:** 5x Claude Code (CLI) or 5x Web Instances
**Controller:** Antigravity (Role Assignment) + Ádám (Execution)

---

## 1. Orchestration Setup
The pool is NOT a single automated script but a **State Protocol**.
We use **Git Branch Isolation** to separate workers.

### **Command: Spawn Pool (Manual)**
Run in 5 separate terminal tabs:

`# Worker 1`
`git checkout main`
`git pull`
`git checkout -b w1-task-name`

`# Worker 2`
`git checkout main`
`git pull`
`git checkout -b w2-task-name`

*(Repeat for W3, W4, W5)*

---

## 2. Ops Checklist (Start/Stop)

### **START (Spin-up)**
1. [ ] **Antigravity:** Publish Role Map in `docs/STATUS_WALKTHROUGH.md`.
2. [ ] **Ádám:** Verify Work Package scope is clear.
3. [ ] **Ádám:** Open 5 Terminal Tabs (or Claude Windows).
4. [ ] **Orchestration:** checkout fresh branches for assigned roles.

### **STOP (Merge & Teardown)**
1. [ ] **Worker:** Push Branch + verify CI (if any).
2. [ ] **Antigravity:** Approve Merge (PASS).
3. [ ] **Worker/Ádám:** Merge to main.
4. [ ] **Orchestration:** `git checkout main`, `git branch -d wX-task-name`.

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
