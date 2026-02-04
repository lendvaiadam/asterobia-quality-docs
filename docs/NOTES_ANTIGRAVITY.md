# NOTES: ANTIGRAVITY (CTO)

**Status**: HARD GATES ENFORCED
**Updates**:
- **WO De-Dup**: Mandatory check of Status+Git before issuance.
- **HU Test**: Mandatory after Integration Merge.
- **Skills**: Mandatory `Required Skills` block in WO.
- **Docs**: Added Supabase "Anon Auth" troubleshooting & refined M04 verification criteria.
- **Status**: M04 CLOSED (HU-TEST PASS). Verified via `_debugAnnounceTickCount` increment. Code SHA: `1d32fd3`.

- **Gate**: Added "Pre-WO Double-Check" (5-8 Questions Rule) to Workflow & Runbook. (SHA: 6ec2f4c)
- **Consultation**: R013-M05 (Guest Lobby) - Approved with explicit pruning/validation rules.
- **Gate**: Added "Worker Liveness / Progress Gate" (ACK 30m / Progress 2h) to Workflow.







## Output Discipline (MANDATORY)

Purpose:
Reduce token waste and context bloat by removing narrative “play-by-play” logs,
while still encouraging proactive high-value insights.

Core rule:
- Do NOT write long progress diaries of what you did.
- DO provide concise deliverables + concise proactive recommendations.

Required default response format (use this unless asked otherwise):

A) Required Deliverables (compact)
- Branch:
- Commit SHA(s):
- Files changed: (max 3 lines)
- Exact run command(s):
- PASS/FAIL: (1 line)

B) Proactive Suggestions (Mandatory if applicable)
- Max 3 bullets, 1 line each.
- Include: [RISK], [INCONSISTENCY], [SUGGESTION] (better approach/next small step).
- Do NOT narrate steps. keep it minimal.
- Questions are NOT limited: ask as many as needed to clarify inputs/scope.

C) Bug Backlog Protocol (MANDATORY)
- Canonical Source: `docs/BUGLIST.md`
- Rule: If a bug is found (dev or HU), record it IMMEDIATELY in BUGLIST.
- Fixing is optional; recording is mandatory.
- Use the standard BUGLIST template.

D) Bug Triage (MANDATORY)
- On each delivery / before next steps: scan `docs/BUGLIST.md`.
- Surface up to 3 "Fix Now" candidates (high leverage/blocking/risk).
- Format: `ID`: `Rationale`.
- Do NOT auto-fix; just flag.

Clarifications / Questions:
- You may ask any number of questions if they are necessary for correctness.
- Group questions into a short numbered list.
- Each question must be specific and tied to a missing required input, a detected inconsistency, or a risk to determinism/binding scope.
- Avoid rhetorical or repetitive questions.

Hard limits (unless explicitly requested):
- Avoid long tables and verbose explanations
- Prefer <= 15 lines total including Proactive Notes

## Human Test Gate (MANDATORY)

Applies to: Claude, Antigravity, ChatGPT, and any future agent.

Rule:
If ANY change affects:
- game boot / intro / preloader
- UI, fonts, CSS, assets
- scene initialization or scene transitions
- loading logic or gating conditions
- ANY merge to main that is not strictly pure SimCore logic

THEN:
- Automated tests are NOT sufficient.
- The agent MUST explicitly notify the user:
  “Human verification required — please run locally and confirm.”
- The agent MUST provide:
  - branch name
  - commit SHA
  - exact local test steps (≤5 lines)

NO further work or merges may proceed until the user confirms.

Failure to trigger this gate is a protocol violation.

## Double-Check Auditor Protocol
For every delivery (Claude branch):
1. **Hidden Risk Audit:** Proactively look for inconsistencies and netcode pitfalls.
2. **Block on Violation:** Stop merge if binding docs or determinism are compromised.
3. **Value Add:** Propose 1–3 "next small steps" (≤1 day) to reduce risk (OPTIONAL).

---
Purpose: Persistent auditor memory. New Antigravity chat windows must read this first.

Last updated: 2026-01-15 (Europe/Budapest)

---

## Role boundaries
Allowed:
- Audits, repo mapping, risk registers, documentation snapshots, link indexing.
- Preflight checks / detection tooling (search for forbidden patterns).
- Small doc updates when requested.
- **Skills Packaging**: Maintain `/.claude/skills/` and `docs/CLAUDE_CODE_SKILLS.md`.

Not allowed (unless explicitly asked by Ádám):
- Deep refactors in Game.js / Unit.js
- Implementing Phase 0 code changes (fixed tick / command pipeline / seeded RNG)
Default output: MD files under /quality or /docs.

---

## Current status
- Baseline branch prepared: baseline/pre-claude-stable
- Published: docs/STATUS_WALKTHROUGH.md and docs/MAILBOX.md
- Published: docs/NOTES_CLAUDE.md
- Preflight exists: quality/NETCODE_PREFLIGHT.md (baseline branch)

---

## What to do next (if asked)
- Append RAW-friendly absolute links to CANONICAL_SOURCES_INDEX (append-only, no edits).
- Update audits when code changes (netcode readiness, state surface).
- Keep REPO_REALITY_MAP current after structural changes.

---

## Handoff expectations
- If Claude requests proof/audit, respond with a short MD file + raw link.
- If anything looks like deep refactor, stop and ask Ádám for explicit permission.

---

## Binding workflow reminders
- **Mailbox**: Agent-to-agent info sync only. No instructions there. Decisions flow via Ádám in chat.
- **Reference**: Always name files when referencing them (e.g. `docs/START_HERE.md`).
- **Publish Protocol**: After any push, report: `branch` + `commit hash` + `direct links to changed files` + `playable URL` (if applicable).
- **Versioning**: Follow policy in `docs/VERSIONING_ROLLBACK.md`.
- **Releases**: Suggest release when milestone matches `docs/RELEASE_PLAN.md` (YES/NO + reason).
- **Release Execution**: If approved, tag + update `public/versions.json`.
- **Prompt Delivery**: If generating a prompt for Claude, return it **directly in chat**. Do not tell Ádám to read MAILBOX.
- **Ádám Test Checklist (Mandatory)**: After every implementation step, output a checklist (Steps + Expected + Risk Focus).



## Snapshot Log



### Savepoint 003
- **Date**: 2026-02-01
- **Tag**: `savepoint/context-reset-pack`
- **SHA**: `(pending merge)`
- **Scope**: Docs-only: Added `CONTEXT_RESET_PACK.md` + Multi-Claude Roster rules.
- **Gates**: Consistency verified. Links validated.
- **Risk notes**: None.
- **Rollback**: `git checkout savepoint/context-reset-pack`

### Savepoint 002
- **Date**: 2026-02-01
- **Tag**: `savepoint/r013-docs-pack-merged`
- **SHA**: `bd083aa` (Merge Commit)
- **Scope**: R013 Specs (Handshake/Schema) + Entrypoint wiring.
- **Gates**: 
    - Docs only (No runtime risk).
    - Compliance verified (Absolute Scope Lock).
- **Risk notes**: None (docs only).
- **Rollback**: `git checkout savepoint/r013-docs-pack-merged`

### Savepoint 001
- **Date**: 2026-01-31
- **Tag**: `savepoint/r012-hud-fix-verified`
- **SHA**: `80b511aa573868704fc698b89d81e6a3103680f9`
- **Scope**: Game.js structure repair (methods moved out of constructor), R012 HUD implementation, Config loading safety.
- **Gates**: 
    - Automated Tests: PASS (Lint/Syntax fixed)
    - HU Golden Path: PASS (Verified http://localhost:8081/game.html?net=supabase&dev=1)
- **Risk notes**: 
    - 1. Requires `public/config.js` for full green HUD.
    - 2. Dev HUD restricted to `?dev=1` or `#dev=1`.
- **Rollback**: `git checkout savepoint/r012-hud-fix-verified`

### 2026-02-01: Docs Opening Pack Readability Fix
- **Context**: User requested improved readability for ChatGPT bootstrapping.
- **Action**:
  - Rewrote `docs/CHATGPT_OPENING_PACK.md` with `---BEGIN-PAYLOAD---` markers and stricter formatting.
  - Added "Consultation Round (Mandatory)" rule.
  - Refactored `docs/STATUS_WALKTHROUGH.md` to clear `## NOW` and move completed items to "Release Status".
- **Ref**: `savepoint/docs-opening-pack-fixed` (`41f8475`)

### 2026-02-01: Opening Pack V3 (Full Links)
- **Context**: Truncation issues persisted; user required full link library + workflow embedding.
- **Action**:
  - Rewrote `CHATGPT_OPENING_PACK.md` with explicit `---BEGIN-OPENING-PAYLOAD---` markers.
  - Embedded full canonical link library (no stubs).
  - Embedded "Consultation Round" + "Doc-Answer Gate" rules directly in the payload.
  - Cleaned `STATUS_WALKTHROUGH.md` to point strictly to the Consultation step.
- **Ref**: `savepoint/opening-pack-v3-full-links` (`b3929c5`)



