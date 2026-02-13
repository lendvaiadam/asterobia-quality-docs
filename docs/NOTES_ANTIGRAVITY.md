# NOTES: ANTIGRAVITY (CTO)

## 🛑 NON-NEGOTIABLE RULE: NO CODING WITHOUT EXPLICIT PERMISSION
**Status: ENFORCED ALWAYS**

1.  **Default Mode**: **ANALYSIS-ONLY**. You may write specs, audits, docs, and plans.
    *   **FORBIDDEN**: Modifying any file in `src/` or `public/` (JS/TS/CSS/HTML).
    *   **FORBIDDEN**: Running `git merge` or destructive git commands without specific authorization.
2.  **Exception Gate**: You may only write code if:
    *   Ádám explicitly says: "Antigravity may code" (or equivalent).
    *   AND the task is labeled as an *exception* or *prototype*.
3.  **Stop Condition**: If the user says "STOP" or "Don't code", you must **IMMEDIATELY** freeze, revert uncommitted changes, and return to analysis mode.

## 🔒 Persistence / Workflow Changes
**Status: ENFORCED ALWAYS**

RULE:
Whenever the user requests a change to the Antigravity workflow/process (how Antigravity should operate, coordinate, verify, merge, tag, update docs, ask for confirmation, etc.), I MUST:
1) Write the change into my own calibration MD file (so it persists across new chats),
2) Reference that calibration entry in my reply (briefly),
3) Only then proceed with any operational steps (if explicitly requested).

## 🐛 BUG REPORTING PROTOCOL
**Status: ENFORCED**

1.  **Log First**: Every new bug must be logged in `docs/BUGLIST.md` BEFORE any code fix.
    -   Required: Observed, Expected, Touchpoints, Severity.
2.  **Handoff**: Antigravity does NOT patch code. Antigravity prepares a **Claude Code Prompt** referencing the Bug List.
3.  **Lifecycle**: `OPEN` -> `IN_PROGRESS` (Worker assigned) -> `FIXED` -> `VERIFIED` (HU-TEST).
4.  **Delegation Rule**: Delegate tasks among workers (W1-W4) by default. Do not wait for explicit user instruction to split work. Isolate changes per worker.

### Self-Check (Must perform at Session Start)
- [ ] **Am I about to edit code?**
- [ ] **If yes, do I have explicit written permission in this session?**
- [ ] **If no, STOP.**

### Incident Protocol (If Rule Violated)
1.  **Freeze**: Stop all edits immediately.
2.  **Revert**: If uncommitted, `git checkout .` (preserve docs if needed).
3.  **Receipt**: Produce a "Patch Receipt" of what was attempted (Branch/SHA/Files).
4.  **Handoff**: Mark as "DO NOT MERGE" and hand off to Claude/Worker.


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
- **Status**: M05 CLOSED (HU-TEST PASS). Verified Host List population + 15s Pruning Logic.
- **State Update**: M05 unit tests exist but NOT RUNNABLE (Test Runner Missing). HU-TEST used as primary gate.
- **Merge**: R013 M06 (Joined `infra-vitest` + `frontend` to `WO-R013`).
- **Test Note**: Vitest runs. 101 passed. 14 files "No test suite found". HU-TEST is the binding gate for M06.


- **Gate**: Added "Closure Receipt Gate" (Mandatory In-Chat Receipt) to Workflow.
- **Gate**: Added "Worker Utilization Gate" (Mandatory Table + Parallel Pack) to Workflow.
- **Refinement**: "Closure Receipt Gate" now mandates full `raw.githubusercontent.com` URLs.
- **Violation Log**: Receipt (`60cf319`) marked NON-COMPLIANT (Placeholders used).
- **Status**: M06 CLOSED (HU-TEST PASS). Verified Handshake (JoinReq/Ack/Role) + Snapshot Application (`serialize` exists).
- **Docs**: Added preflight branch+HEAD check for R013/M07 testing.












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

### Savepoint 004: R013-NB0 Phase 0 Audit (Netcode Scaffold)
- **Date**: 2026-02-10
- **Tag**: `savepoint/r013-nb0-phase0`
- **SHA**: `(pending merge)`
- **Scope**:
    - **SimCore Purity**: Verified NO `three.js` or `window` imports in `src/SimCore`. UnitFactory & TimeSource patched.
    - **Server Scaffold**: `server/` directory established with Node.js/WS config.
    - **Transport**: `MemoryTransport` implemented + `loopback.test.js` (741 lines) proves determinism.
- **Gates**:
    - **Determinism**: PASS (Test #8 in loopback.test.js).
    - **Purity**: PASS (grep check clean).
- **Risk notes**: None. Ready for Phase 1 (Real WebSocket).
- **Status**: OFFICIALLY CLOSED (Merged to Main)
### 2026-02-12: Phase 2A Commit 1 Merged (Manifest-Lite)
- **SHA**: `801b317` (Merge to Main)
- **Tag**: `savepoint/r013-phase2a-manifest-lite`
- **Scope**: Server Core (Manifest/Flight fields), Protocol Update.
- **Tests**: 690 PASS (Clean).
- **Decision**: Locked **Option 3: Manifest-Lite**. "Commit 1.5" integrated into Commit 2.
### 2026-02-12: Phase 2A Commit 1.1 Merged (Cleanup)
- **SHA**: `deba991` (Merge to Main)
- **Tag**: `savepoint/r013-phase2a-commit1.1`
- **Scope**: Migrated `Phase2A_Protocol.test.js` to canonical `tests/integration/netcode`.
### 2026-02-12: Phase 2A Commit 2 Merged (Client Wiring)
- **SHA**: `33e230d` (Reachable on Main)
- **Tag**: `savepoint/r013-phase2a-commit2`
- **Scope**: Client Spawn Guard, `SPAWN_MANIFEST`, `SERVER_SNAPSHOT` Mirroring, Input `unitId`.
- **Tests**: 712 PASS (Clean). +18 New Tests.
- **Next**: Commit 3 (Integration & Verification).




### 2026-02-01: Bootstrap Cleanup
- **Action**: Deleted temporary `docs/readable-export-ee26077` branch (readable export).
- **Status**: Not merged to main.

### 2026-02-12: Phase 2A Hardening & Docs Merged
- **SHA**: `40ea6ec` (Fast-forward merge on Main)
- **Tag**: `savepoint/r013-phase2a-hardening`
- **Scope**:
    - **Security**: `JOIN_ACK` gate, Manifest Caps, Rate Limit, Paylod Limit (`152d22a`).
    - **Docs**: `HYBRID_PHYSICS_MASTER.md`, `CLAUDE_HANDOFF_PHASE2B.md` (`c4cffaa`).
    - **Persistence**: Workflow Rule (`40ea6ec`).
- **Tests**: 761 PASS (Clean). +20 New Security Tests.
- **Status**: **READY FOR PHASE 2B**.

### 2026-02-13: Phase 2B Path-Follow Merged
- **SHA**: `86fb3fd` (Fast-forward Merge on Main)
- **Tag**: `savepoint/r013-phase2b-path-follow`
- **Scope**:
    - **Server**: `PATH_DATA` handling, 32-waypoint cap, `HeadlessUnit` path-follow tick.
    - **Client**: Shift+Click A* wiring, WASD interrupt logic.
    - **Tests**: +28 new tests (Path Validation). Total 789 PASS.
- **HU-PASS**: Confirmed by Human.
    - Known Issue: "Commands" error in WS transport (Legacy/Phase 1) - Non-blocking.
    - Mirror Mode: No client-side path markers (Expected/Spec-compliant).
- **Status**: **READY FOR PHASE 3 (PHYSICS)**.

### 2026-02-13: Phase 3 PREP Merged
- **SHA**: `bb54e5b`
- **Tag**: `savepoint/r013-phase3-rapier-tooling`
- **Scope**:
    - **Deps**: Added `@dimforge/rapier3d-compat@0.19.3`. Pinned `simplex-noise@4.0.3`.
    - **Tests**: Added `rapier-smoke.test.js` (9 tests PASS).
    - **Docs**: Added `RAPIER_BEST_PRACTICES.md`.
- **Status**: **READY FOR IMPLEMENTATION**.

### BLOCKER: R013-NB1 Phase 1 (Minimal Viable Loop)
- **Date**: 2026-02-10
- **Branch**: `work/r013-nb1-phase1`
- **Status**: 🛑 **MERGE BLOCKED** (Failed HU-TEST #2)
- **Symptom**: Guest join timeout. `transport.state: DISCONNECTED`, `wsReadyStateLabel: CLOSED (3)`.
- **Diagnostics**:
    - `joinReqsSent: 1`
    - `joinAcksRecv: 0`
    - `wsReadyStateLabel: CLOSED (3)`
    - `pendingMessageCount: 2` (Messages stuck in buffer)
    - `messagesSent: 0` (Transport failed to flush)
- **Root Cause Hypothesis**:
    1.  **Premature Close**: Transport `onOpen` fires, App queues `JOIN_REQ`, but socket closes immediately (Server reject? Network error?).
    2.  **Flush Bug**: `WebSocketTransport` queues messages but never attempts `socket.send()`.
    3.  **Lifecycle Race**: `send()` called before `OPEN`.
- **Action**: Fix required from Claude Code.
- **Audit Requirement**:
    1.  Verify `pendingMessageCount` drains to 0.
    2.  Verify `messagesSent` increments.
    3.  Verify server logs show connection `OPEN` and stable.

### 2026-02-13: Phase 3 Step 1 Merged (Rapier Foundation)
- **SHA**: `HEAD` (Merged `work/r013-phase3-rapier-foundation`)
- **Tag**: `savepoint/r013-phase3-rapier-foundation`
- **Scope**:
    - **PhysicsWorld.js**: Async init, sub-stepping, manual spherical gravity.
    - **Room.js**: Flag-gated async start (`enablePhysics`).
- **Status**: **READY FOR STEP 2 (TERRAIN COLLIDERS)**.
