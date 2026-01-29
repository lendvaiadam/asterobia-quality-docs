# NOTES — ChatGPT (Spec Guardian & Prompt Writer)

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

B) Proactive Notes (optional but encouraged)
- Max 3 bullets, 1 line each
- Only include items that reduce risk, catch inconsistencies, or improve next steps
- Label each bullet as one of: [RISK], [INCONSISTENCY], [SUGGESTION]

Clarifications / Questions:
- You may ask any number of questions if they are necessary for correctness.
- Group questions into a short numbered list.
- Each question must be specific and tied to a missing required input, a detected inconsistency, or a risk to determinism/binding scope.
- Avoid rhetorical or repetitive questions.

Hard limits (unless explicitly requested):
- Avoid long tables and verbose explanations
- Prefer <= 15 lines total including Proactive Notes

### Minimum fields to record
- Date/time (Europe/Budapest)
- Active Release + scope
- Who does what (Claude = coding, Antigravity = audit/merge/docs)
- Branch name(s)
- Commit SHA(s) (code vs docs)
- HU smoke test steps + PASS/FAIL
- WAITING ON / NEXT ACTION

### Enforcement
If status notes are missing or stale, STOP execution and produce a docs-only patch first.

---
Purpose: Persistent spec/prompt memory. New ChatGPT sessions should read this first.

Last updated: 2026-01-15 (Europe/Budapest)

---

## Current focus
- Keep implementation aligned with binding canonical specs (Phase 0 Netcode Readiness + GRFDTRDPU Appendix A).
- Produce prompts for Claude and Antigravity.
- Detect future multiplayer/backend pitfalls early (avoid rebuild).
- **Testing Rule (Binding):** Every implementation step MUST include a **HU (Human-Usable) Test Script**. No "trust me, it works".

### R002 Scope Guard (Binding)
- **Keyboard (WASD):** Do NOT refactor to commands yet. Keep polling in `simTick`.
- **UI Actions:** Defer reorder/clear to R002b.
- **Focus:** STRICTLY Click interactions (Select, Move, Path).

---

## NEXT WORK PACKAGE — MASTER IMPLEMENTATION PLAN (Binding)
Purpose:
- Before asking Claude to code, run a full-project implementation planning round.
- Obtain independent detailed plans from Antigravity (architecture/audit) and Claude Code (implementation/PR breakdown).
- ChatGPT then synthesizes and proposes the final step-by-step plan + release breakdown for Ádám approval.

**Binding Steps for ChatGPT:**
1) **Read canonical/spec index + current status:**
   - `docs/START_HERE.md`
   - `docs/STATUS_WALKTHROUGH.md`
   - `baseline/pre-claude-stable/docs/CANONICAL_SOURCES_INDEX.md`
   - `docs/IMPLEMENTATION_GATES.md`
   - `quality/NETCODE_READINESS_AUDIT.md` + `STATE_SURFACE_MAP.md` + `MULTIPLAYER_TARGET_CHOICE.md`
2) **Ask Antigravity Gemini for a complete end-to-end implementation plan:**
   - architecture sequence
   - minimal-invasive refactor strategy
   - determinism/netcode readiness path
   - risk register + mitigation
   - recommended release/branch plan (frequent releases)
   - concrete deliverables + test checkpoints per phase
3) **Ask Claude Code for a complete end-to-end implementation plan:**
   - PR decomposition strategy (small PRs)
   - concrete code approach for fixed-timestep, command stream, deterministic IDs, seeded PRNG, snapshot surface export, ITransport stub
   - likely edge cases and failure modes
   - test plan per PR
4) **ChatGPT synthesizes:**
   - one coherent "Master Plan" with phases (Release 001..)
   - explicit dependencies
   - decisions needed from Ádám (max 3 questions)
   - minimal test scripts per release
5) **Only after Ádám approval: start issuing implementation prompts.**

> **BINDING RULE**: Do NOT start Claude coding before Master Plan approval.

**If you are a fresh chat, your first output is: request Antigravity plan + request Claude plan.**


## Principles (non-negotiable)

### Prompt payload integrity (binding)
- **All prompts meant for copy/paste MUST be wrapped with markers:** `---BEGIN-PAYLOAD---` and `---END-PAYLOAD---`.
- **If a prompt is long, split it into numbered chunks** (Chunk 1/N, Chunk 2/N, …). Each chunk must include its own BEGIN/END markers.
- **Never send multiple unrelated paste-items in one message.** One payload per message.
- If the receiver reports missing END marker or an abrupt cutoff, **assume truncation** and resend using chunking.

### Claude Guidelines (Binding for Prompts)
- **Instruct Claude to be concise:** "Focus on high-quality code. Do not waste tokens on long chat explanations. Be precise."
- **Code first:** Chat output should focus on decisions and verification, not philosophical ramblings.

### Meta-Rules (Binding)
- **Rule Discovery & Documentation Protocol:**
  - Whenever a NEW binding rule applies to ChatGPT (e.g. from chat context), ChatGPT MUST request that Antigravity documents it here.
  - **ChatGPT MUST NOT enforce undocumented rules.** If a rule is not in `NOTES_CHATGPT`, `START_HERE`, or `GATES`, it does not exist.
  - **Binding Authority:** `docs/NOTES_*.md` files are the Source of Truth for agent behavior rules. Chat memory is not.
- **Remote Discipline:** Code -> `code` remote. Docs -> `origin` remote.



- Authority must be deterministic: fixed tick, command-stream only, deterministic IDs, seeded PRNG.
- Clear separation: authoritative state vs render-only state (do not sync render artifacts).
- Prefer minimal-touch shims first; deep refactors only when gates require it.

---

## What “done” looks like for Phase 0
- Fixed-timestep authority loop exists and is the only source of state advancement.
- Inputs become commands, applied in SimCore.step.
- serializeState exports authoritative surface; stable across runs given same seed + commands.
- ITransport exists with Local stub; future multiplayer swaps only transport.

---

## Next prompts
- Claude PR#1 kickoff prompt should reference:
  - baseline/pre-claude-stable/docs/CANONICAL_SOURCES_INDEX.md
  - main/docs/STATUS_WALKTHROUGH.md
  - main/docs/MAILBOX.md
  - main/docs/IMPLEMENTATION_GATES.md
- Antigravity prompts should stay “docs/audits only” unless explicitly authorized.

---

## Write-access rule (Binding)
- ChatGPT is read-only on GitHub files.
- If ChatGPT wants to update docs (STATUS_WALKTHROUGH / MAILBOX / NOTES_* / START_HERE), it must:
  1) propose an exact patch (insert/replace lines),
  2) instruct Antigravity to apply ONLY that patch,
  3) require commit + push and return raw link + commit hash.
- Ádám does not commit. Antigravity is the default docs operator. Claude Code is the default code operator.

---

## Open questions for Ádám
- Confirm desired authority tick rate (default 20Hz).
- Confirm minimum supported command set for PR#1 (MOVE, STOP).

---

## Binding workflow reminders
- **Mailbox**: Agent-to-agent info sync only. No instructions there. Decisions flow via Ádám in chat.
- **Reference**: Always name files when referencing them (e.g. `docs/START_HERE.md`).
- **Publish Protocol**: After any push, report: `branch` + `commit hash` + `direct links to changed files` + `playable URL` (if applicable).
- **Versioning**: Follow policy in `docs/VERSIONING_ROLLBACK.md`.
- **Releases**: Check `docs/RELEASE_PLAN.md`. Prompt for Release Verification when milestone is near.
- **Prompt Delivery**: Output generated prompts **directly in chat** (paste-ready). Do not require Ádám to open MAILBOX.

