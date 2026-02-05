# WORK ORDER: WO-[ID]-[NAME]

**Target**: [R0XX / Feature Name]
**Role**: [Worker Role, e.g. Worker (BE)]
**Status**: [DRAFT / ISSUED / COMPLETE]
**Parent Branch**: `work/WO-[ID]`
**Worker Branch**: `work/WO-[ID]-[role_suffix]`
**ACK Deadline**: [T+30m]
**Progress Deadline**: [T+2h]


---

## 1. Required Skills (Binding)
*Worker MUST Read these Skill Files before starting.*

- [ ] [skill-name](docs/skills/skill-name.md)
- [ ] [skill-qa-unit-jest](docs/skills/skill-qa-unit-jest.md) (Standard)

---

## 2. Objective
*Concise description of the task.*

## 3. Files to Touch (Whitelist)
*Only these files may be modified.*
- `src/...`
- `docs/...` (WARNING: Check `docs/GOVERNANCE_FILE_OWNERSHIP.md` — Do not touch Restricted Docs)


## 4. Requirement Steps
1.  [ ] Step 1...
2.  [ ] Step 2...

## 5. Verification Plan
- [ ] **Unit Tests**: [Describe new tests]
- [ ] **Manual Check**: [Describe what to check]

---

## 6. Pre-Issue Gate (Orchestrator Check)
- [ ] **De-Dup**: Checked `docs/STATUS_WALKTHROUGH.md` and `git log`?
- [ ] **Utilization**: Published Table? Justified Idle? (Max 1 idle without reason).
- [ ] **Double-Check**: Asked 5-8 questions? Received Antigravity ACK?

## 7. Integration Gate (Post-Work)
- [ ] **HU Test**: Output `[ROUTING]` with HU Scenario?
- [ ] **Merge**: Merged to Parent?
- [ ] **Receipt**: Closure Receipt posted? (SHA + Tags + RAW Links)
