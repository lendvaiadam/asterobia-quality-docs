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

## 2. Operator Copy/Paste Map (The Routing Protocol)

**Core Rule**: You do NOT need to guess. Wait for an agent to output a `[ROUTING]` block.

### Standard Routing Block
```text
[ROUTING]
TO: Worker (FE) - Terminal 3
PASTE: (Content of Work Order or Code)
CONTEXT: Assigning UI Task.
[/ROUTING]
```

**Operator Actions**:
1. **Read**: Look for `TO:` destination.
2. **Copy**: Copy content in `PASTE:` section (or file content if path is given).
3. **Paste**: Paste into the target Terminal.
4. **Loop**: Wait for next `[ROUTING]` block.

**Exceptions**:
- If an Agent seems stuck, ask: "Do you have a Routing Block for me?"
- If `MAILBOX.md` is updated, the Orchestrator will notice periodically (or you can nudge it). You do NOT need to read Mailbox.

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
