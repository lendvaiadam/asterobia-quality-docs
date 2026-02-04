# WORK ORDER: [Task Name]

**Target Worker**: [Backend / Frontend / QA / Refactor]
**Parent Branch**: `work/[parent-task]`
**Worker Branch**: `work/[parent-task]-[worker-type]`

**CTO Escalation**: [Required / Not Required]
**Escalation Triggers**:
- [ ] Spec Ambiguity
- [ ] Architecture Change
- [ ] Determinism Risk

## 1. Context
[1-2 sentences explaining WHY this tasks exists and what it solves.]

## 2. In-Scope Files (Whitelist)
- `src/SimCore/...`
- `docs/specs/...`

## 3. Strict Out-of-Scope (Blacklist)
- `src/Main.js` (Never touch entry point)
- `package.json` (No dependency changes)

## 4. Acceptance Criteria ("Done When")
- [ ] Unit tests pass for new module.
- [ ] Linter is green.
- [ ] No regression in determinism test.

## 5. Antigravity Decision Log
(Paste any Escalation Decisions here from MAILBOX)
